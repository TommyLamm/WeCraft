// 經驗球實體（B17）：純邏輯模組——不吃 DOM／Three，也**不 import** `drops.ts`；
// 落地物理刻意與 `stepDrops`（src/world/drops.ts）同型：semi-implicit Euler ＋
// 水平阻力＋cell sweep 防穿地（單次反彈 0.3、settle offset 0.01）。磁吸與吸收
// 的距離都量到「眼睛高度」（`playerPos.y + 1`），`isSolidAt` 由呼叫端注入
// （水不算固體）——本模組不碰世界，自然不會對未載入區塊寫任何東西。
// 數值來源：B17 設計 spec §5（docs/superpowers/specs/2026-11-11-wecraft-xp-enchanting-design.md）。

/** 世界中的一顆經驗球（純資料——渲染在 render/、撿取結果由 stepXpOrbs 回傳）。 */
export interface XpOrb {
  id: number;
  value: number; // 經驗點數；合併時相加、飽和 MAX_ORB_VALUE
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  age: number; // seconds since spawn
  pickupDelay: number; // seconds remaining before pickable (spawn = 0.3)
  /** 單次反彈旗標（內部狀態，刻意**只在 true 時寫入鍵**——沒反彈過的球維持
   *  上面六個欄位，與介面約定一致；與 drops.ts 的 `dur` 同一招）。 */
  bounced?: boolean;
}

// ---- Tuning constants（spec §5 釘死；後續任務依這些名字接線） ----

/** Downward acceleration, blocks/s² — same feel as dropped items (`drops.ts`). */
export const ORB_GRAVITY = 20;
/** Horizontal velocity multiplier per second: vel · 0.1^dt — the spawn pop
 *  slides ≈½ block then stops, instead of skating across the floor. */
export const ORB_HORIZONTAL_DRAG_PER_SEC = 0.1;
/** Resting gap above the supporting block's top face — keeps the orb's feet
 *  cell in the air instead of re-colliding with the floor every frame. */
export const ORB_SETTLE_OFFSET = 0.01;
/** Impact velocity (blocks/s, downward) below which an orb lands without a
 *  bounce; above it the orb bounces ONCE (restitution 0.3). */
export const ORB_BOUNCE_THRESHOLD = 3;
/** Seconds a fresh orb ignores both pickup and magnetism — lets the spawn pop
 *  land first (0.3 s / 6 tick；drops 是 0.5，經驗球故意更短）。 */
export const ORB_SPAWN_PICKUP_DELAY = 0.3;
/** Default 3D pickup reach to the eye point, blocks. */
export const ORB_PICKUP_RADIUS = 1.2;
/** 磁吸半徑（到眼睛點，格）——半徑內朝玩家等速直線飛行。 */
export const ORB_MAGNET_RADIUS = 4;
/** Seconds before magnetism kicks in（與 spawn pickup delay 分開計）。 */
export const ORB_MAGNET_DELAY = 0.5;
/** 磁吸飛行速度（格/秒）——朝眼睛點的等速直線移動。 */
export const ORB_MAGNET_SPEED = 9;
/** 兩顆球中心距離 ≤ 此值 → 新點數直接併入最近的球（生成時的合併機制）。 */
export const ORB_MERGE_RADIUS = 2.5;
/** Seconds before an uncollected orb despawns（與 drops 的 DESPAWN_AGE 同值；
 *  消失的球**不**入帳——未吸收的點數就消失了）。 */
export const ORB_DESPAWN_AGE = 300;
/** 世界同時存在的經驗球上限；已達上限時新點數改併入最近的球。 */
export const MAX_XP_ORBS = 128;
/** 單顆球點數上限（合併時的飽和值）。 */
export const MAX_ORB_VALUE = 32767;

/** `orbs` 裡離 `pos` 最近的球索引；距離 > `maxDist` 的不考慮；找不到 → -1。
 *  邊界採**內含**（= maxDist 算在內）；距離相同時取較後面的（較大 id）；
 *  座標含 NaN 時該球直接跳過（NaN 比較恆 false）。 */
function nearestOrbIndex(
  orbs: readonly XpOrb[],
  pos: { x: number; y: number; z: number },
  maxDist: number,
): number {
  let best = -1;
  let bestD2 = maxDist * maxDist;
  orbs.forEach((o, i) => {
    const dx = o.pos.x - pos.x;
    const dy = o.pos.y - pos.y;
    const dz = o.pos.z - pos.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 <= bestD2) {
      best = i;
      bestD2 = d2;
    }
  });
  return best;
}

/**
 * 在 `pos` 生出 `value` 點經驗——優先**合併**，不夠近才新增：
 *  - `value` 不是 ≥ 1 的有限整數 → 刻意的不動作，回傳**同一參考**（與
 *    `addExperience` 的垃圾輸入語意一致）；
 *  - `ORB_MERGE_RADIUS` 內有球 → 併入**最近**的一顆（value 相加，飽和
 *    `MAX_ORB_VALUE`；位置／速度不動）；
 *  - 已達 `MAX_XP_ORBS` → 一律併入最近的球（**不限距離**——上限優先於半徑，
 *    世界永遠不超過 128 顆）；
 *  - 否則新增一顆（`id = max+1`、隨機水平初速 ±1 ＋向上 2.5 的 pop、
 *    `pickupDelay = ORB_SPAWN_PICKUP_DELAY`）。
 *  `pos`／`opts.vel` 一律被**複製**——實體不引用呼叫端的物件。
 */
export function spawnXpOrbs(
  orbs: readonly XpOrb[],
  value: number,
  pos: { x: number; y: number; z: number },
  opts: { vel?: { x: number; y: number; z: number } } = {},
): XpOrb[] {
  if (!Number.isInteger(value) || value < 1) return orbs as XpOrb[];

  // 上限優先：世界滿了就只能在既有球上做文章（沒有「丟棄後超上限」這條路）。
  if (orbs.length >= MAX_XP_ORBS) {
    const idx = nearestOrbIndex(orbs, pos, Infinity);
    if (idx < 0) return orbs as XpOrb[]; // 防禦：上限 ≥ 1 → 陣列非空，不可達
    return orbs.map((o, i) =>
      i === idx ? { ...o, value: Math.min(MAX_ORB_VALUE, o.value + value) } : o,
    );
  }

  const near = nearestOrbIndex(orbs, pos, ORB_MERGE_RADIUS);
  if (near >= 0) {
    return orbs.map((o, i) =>
      i === near ? { ...o, value: Math.min(MAX_ORB_VALUE, o.value + value) } : o,
    );
  }

  let maxId = -1;
  for (const o of orbs) if (o.id > maxId) maxId = o.id;
  return [
    ...orbs,
    {
      id: maxId + 1,
      value,
      pos: { x: pos.x, y: pos.y, z: pos.z }, // copy — never alias the caller's vector
      vel: opts.vel
        ? { x: opts.vel.x, y: opts.vel.y, z: opts.vel.z } // copy — never alias the caller's vector
        : { x: Math.random() * 2 - 1, y: 2.5, z: Math.random() * 2 - 1 },
      age: 0,
      pickupDelay: ORB_SPAWN_PICKUP_DELAY,
    },
  ];
}

/**
 * One physics tick for every orb — returns `{ orbs, collected }`（全新陣列，
 * collected = 本幀被玩家吸收的點數總和；純函式，不碰世界）。Per orb, in order:
 *
 *  1. `dt` 非有限或 ≤ 0 → 整批原樣帶過（`{ orbs: [...orbs], collected: 0 }`，
 *     不讓 NaN 汙染任何位置）；
 *  2. `age += step`；`age >= ORB_DESPAWN_AGE` → 移除（**不**入帳）；
 *  3. 吸收：`pickupDelay` 歸零且與**眼睛點**（`playerPos.y + 1`）距離 ≤
 *     `ORB_PICKUP_RADIUS` → `collected += value` 並移除；
 *  4. 磁吸：`age >= ORB_MAGNET_DELAY` 且距離眼睛點 ≤ `ORB_MAGNET_RADIUS` →
 *     朝眼睛點等速 `ORB_MAGNET_SPEED · step` 直線移動（**不**套重力、**不**
 *     吸附地面；抵達後由下一幀的吸收分支收掉）；
 *  5. 其餘：重力＋積分＋水平阻力＋cell sweep 地面吸附——與 `stepDrops` 同型：
 *     往下墜時從前一格掃到進入格，第一個固體格勝出（快速下墜穿不透 1 格地
 *     板），吸附到該格上緣 ＋ `ORB_SETTLE_OFFSET`；首次衝擊快於
 *     `−ORB_BOUNCE_THRESHOLD` 反彈一次（·0.3），其餘就地停住。
 */
export function stepXpOrbs(
  orbs: readonly XpOrb[],
  dt: number,
  playerPos: { x: number; y: number; z: number },
  isSolidAt: (x: number, y: number, z: number) => boolean,
): { orbs: XpOrb[]; collected: number } {
  if (!Number.isFinite(dt) || dt <= 0) return { orbs: [...orbs], collected: 0 };
  const step = dt;
  const eye = { x: playerPos.x, y: playerPos.y + 1, z: playerPos.z }; // 吸收／磁吸都量到眼高
  const out: XpOrb[] = [];
  let collected = 0;

  for (const d of orbs) {
    const age = d.age + step;
    if (age >= ORB_DESPAWN_AGE) continue; // despawned — 未吸收的點數消失

    const pickupDelay = Math.max(0, d.pickupDelay - step);
    const pos = { x: d.pos.x, y: d.pos.y, z: d.pos.z };
    const vel = { x: d.vel.x, y: d.vel.y, z: d.vel.z };

    const dx = eye.x - pos.x;
    const dy = eye.y - pos.y;
    const dz = eye.z - pos.z;
    const dist2 = dx * dx + dy * dy + dz * dz;

    // 吸收：延遲已過且進入拾取半徑 → 點數入帳，球移除
    if (pickupDelay <= 0 && dist2 <= ORB_PICKUP_RADIUS * ORB_PICKUP_RADIUS) {
      collected += d.value;
      continue;
    }

    // 磁吸：朝眼睛點等速直線飛行（不重力、不落地；dist 為 0 就原地下一步吸收）
    if (age >= ORB_MAGNET_DELAY && dist2 <= ORB_MAGNET_RADIUS * ORB_MAGNET_RADIUS) {
      const dist = Math.sqrt(dist2);
      if (dist > 0) {
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;
        pos.x += nx * ORB_MAGNET_SPEED * step;
        pos.y += ny * ORB_MAGNET_SPEED * step;
        pos.z += nz * ORB_MAGNET_SPEED * step;
        vel.x = nx * ORB_MAGNET_SPEED; // vel 與實際位移一致——之後脫離磁吸範圍也合理
        vel.y = ny * ORB_MAGNET_SPEED;
        vel.z = nz * ORB_MAGNET_SPEED;
      }
      out.push({ ...d, pos, vel, age, pickupDelay });
      continue;
    }

    // 物理：與 stepDrops 同型（重力 → 積分 → 水平阻力 → cell sweep 落地）
    let bounced = d.bounced ?? false;
    vel.y -= ORB_GRAVITY * step;
    const prevY = pos.y;
    pos.x += vel.x * step;
    pos.y += vel.y * step;
    pos.z += vel.z * step;
    const drag = Math.pow(ORB_HORIZONTAL_DRAG_PER_SEC, step);
    vel.x *= drag;
    vel.z *= drag;

    if (vel.y < 0) {
      const fromY = Math.floor(prevY);
      const toY = Math.floor(pos.y);
      const cx = Math.floor(pos.x);
      const cz = Math.floor(pos.z);
      for (let cy = fromY; cy >= toY; cy--) {
        if (!isSolidAt(cx, cy, cz)) continue;
        pos.y = cy + 1 + ORB_SETTLE_OFFSET; // snap to the solid cell's top face
        if (!bounced && vel.y < -ORB_BOUNCE_THRESHOLD) {
          vel.y = -vel.y * 0.3; // restitution 0.3 — the single allowed bounce
          bounced = true;
        } else {
          vel.y = 0;
        }
        break;
      }
    }

    out.push({
      ...d,
      pos,
      vel,
      age,
      pickupDelay,
      // bounced 只在 true 時寫入鍵：沒反彈過的球維持介面約定的六個欄位
      ...(bounced ? { bounced: true } : {}),
    });
  }
  return { orbs: out, collected };
}
