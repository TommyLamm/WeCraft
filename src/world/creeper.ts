import {
  EYE_OFFSET,
  JUMP_IMPULSE,
  KNOCKBACK_DECAY_PER_SEC,
  KNOCKBACK_MIN,
  KNOCKBACK_SPEED,
  MOB_GRAVITY,
} from './mobs';
import { rayAabbEntry } from './raycast';

// ---- 苦力怕（B9 Task 4）----
//
// 數值全部來自 Java 版（minecraft.wiki/Creeper，2026-10-20 查證）：
// - HP 20、碰撞盒 1.7 高 × 0.6 寬；
// - 玩家在 3 格內且**視線暢通** → 停止移動、嘶嘶、1.5 秒（30 tick）後爆炸；
// - 引信全程需要視線（中斷即取消）；玩家離開 **7 格**（三維距離、嚴格大於才取消）
//   → 取消（vanilla `SwellGoal#tick` 的 `distanceToSqr > 49.0`）；
// - 爆炸威力 3（見 explosion.ts）；
// - 追擊距離 16 格（原版 "Creepers chase any player within a 16-block radius"）；
// - **白天不燃燒**（非不死系）→ 不進 B4 的 `stepSunBurn`（該函式只認
//   `zombie`／`skeleton`）。
//
// 物理沿用 `mobs.ts` 的慣例：重力 32、前方探測（腳／頭兩點、探測距離蓋到身體
// 半寬）、被擋且著地 → `JUMP_IMPULSE` 跨 1 格台階、擊退走獨立的 `kbVel`
// （`0.1^dt` 衰減、低於 0.1 歸零、撞牆不嵌入）、落地用逐格掃描（不穿地板）。
//
// **與 mobs.ts 的差異**：
// 1. 苦力怕是獨立型別（不合進 `Mob`）——引信狀態機與「爆炸後消失且不掉落」是
//    殭屍／骷髏沒有的行為，塞進 `Mob` 會讓 `ranged`／`attackCooldown` 多義。
// 2. 引信期間**完全不動**（水平與重力都停）：原文明文 "stops moving"。這也讓
//    `explode` 事件的座標就是開始引信時的位置（Task 9 的爆炸中心）。
// 3. 爆炸後 `state === 'exploded'` 是**終態**——不再倒數、不再產生事件；實體的
//    移除與「不掉火藥」由 `main.ts` 負責（Task 9）。

export const CREEPER_HP = 20;
export const CREEPER_WIDTH = 0.6;
export const CREEPER_HEIGHT = 1.7;
/** 引信長度：1.5 秒 = 30 tick（原版 Entity data `Fuse` 預設 30）。 */
export const CREEPER_FUSE_SEC = 1.5;
/** 觸發距離 3 格（vanilla `SwellGoal#canUse`：`distanceToSqr < 9.0`，嚴格小於）。 */
export const CREEPER_TRIGGER_DIST = 3;
/** 取消距離 7 格（vanilla `SwellGoal#tick`：`distanceToSqr > 49.0`，嚴格大於才取消）。 */
export const CREEPER_CANCEL_DIST = 7;
/** 追擊速度：原版苦力怕與殭屍同速（移動速度屬性 0.25）→ 沿用本作殭屍的
 *  3.2 格/秒（本作整體比原版慢，是既有簡化）。 */
export const CREEPER_CHASE_SPEED = 3.2;
/** 漫遊速度沿用 mobs.ts 的 1.5 格/秒。 */
export const CREEPER_WANDER_SPEED = 1.5;
/** 追擊距離 16 格（原版 Creeper 頁："Creepers chase any player within a
 *  16-block radius"）——與殭屍的 `CHASE_RANGE = 35`（follow_range）不同，
 *  這是苦力怕自己的值。 */
const CREEPER_CHASE_RANGE = 16;
/** 前方探測的基礎距離；`mobs.ts` 的 `PROBE_LEAD` 是模組私有常數 → 這裡照抄
 *  同一個值（0.3），並用身體半寬補足探測點到身體前端的距離。 */
const PROBE_LEAD = 0.3;
/** 漫遊換方向的區間（秒），沿用 mobs.ts 的 2–4 秒。 */
const WANDER_TURN_MIN = 2;
const WANDER_TURN_MAX = 4;

export type CreeperState = 'wander' | 'chase' | 'fuse' | 'exploded';

export interface Creeper {
  id: number;
  hp: number;
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  state: CreeperState;
  fuse: number; // 引信剩餘秒數；0 = 未引信
  fuseTotal: number; // 引信總長（渲染閃白用）
  wanderDir: number;
  wanderTimer: number;
  target: { x: number; y: number; z: number } | null;
  kbVel: { x: number; z: number };
}

export interface CreeperCtx {
  playerPos: { x: number; y: number; z: number };
  isSolidAt: (x: number, y: number, z: number) => boolean;
  hasLineOfSight: (
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
  ) => boolean;
  dt: number;
  rng?: () => number;
}

export type CreeperEvent = {
  type: 'explode';
  creeperId: number;
  at: { x: number; y: number; z: number };
};

/** 模組層級遞增 id（比照 mobs.ts 的 `nextMobId`）。 */
let nextCreeperId = 1;

export function createCreeper(
  pos: { x: number; y: number; z: number },
  rng: () => number = Math.random,
): Creeper {
  return {
    id: nextCreeperId++,
    hp: CREEPER_HP,
    pos: { x: pos.x, y: pos.y, z: pos.z },
    vel: { x: 0, y: 0, z: 0 },
    state: 'wander',
    fuse: 0,
    fuseTotal: 0,
    // 0..2π：讓漫遊方向分佈在整圈（只乘 rng() 會落在 0..1 弧度的窄扇形）。
    wanderDir: rng() * Math.PI * 2,
    wanderTimer: WANDER_TURN_MIN + rng() * (WANDER_TURN_MAX - WANDER_TURN_MIN),
    target: null,
    kbVel: { x: 0, z: 0 },
  };
}

/** 一步 AI ＋ 物理（回傳新物件與事件，不改輸入）。
 *
 *  順序：NaN 防護 → 狀態機（exploded 終態／fuse 的取消與倒數／chase→fuse 的
 *  觸發）→ 移動（fuse 期間不做）→ 重力與台階探測 → 擊退 → 積分 → 落地掃描。
 *
 *  **開始引信的那一幀不倒數**：`fuse` 從 1.5 開始，下一幀才 `fuse -= dt`，
 *  因此引信總長是 1.5 秒（dt 0.05 → 30 次倒數）。浮點累減會讓引爆落在第
 *  30／31 次倒數（±1 幀，±0.05 秒）——原版是整數 tick，可接受；測試用 dt 0.05
 *  釘死。 */
export function stepCreeper(
  c: Creeper,
  ctx: CreeperCtx,
): { creeper: Creeper; events: CreeperEvent[] } {
  const step = Number.isFinite(ctx.dt) && ctx.dt > 0 ? ctx.dt : 0;
  const events: CreeperEvent[] = [];
  if (c.state === 'exploded') return { creeper: c, events }; // 終態：不再倒數、不再發事件

  const pos = { x: c.pos.x, y: c.pos.y, z: c.pos.z };
  const vel = { x: c.vel.x, y: c.vel.y, z: c.vel.z };
  const kbVel = { x: c.kbVel.x, z: c.kbVel.z };
  let state: CreeperState = c.state; // 上面已提前返回 exploded → 明確標註型別
  let fuse = c.fuse;
  let fuseTotal = c.fuseTotal;
  let wanderDir = c.wanderDir;
  let wanderTimer = c.wanderTimer - step;
  const rng = ctx.rng ?? Math.random;

  const p = ctx.playerPos;
  const dx = p.x - pos.x;
  const dz = p.z - pos.z;
  const distXZ = Math.hypot(dx, dz);
  const dist3 = Math.hypot(dx, p.y - pos.y, dz);
  const eyeFrom = { x: pos.x, y: pos.y + EYE_OFFSET, z: pos.z };
  const eyeTo = { x: p.x, y: p.y + EYE_OFFSET, z: p.z };

  // ---- 狀態機 ----
  let frozen = false; // 引信（含剛開始的那一幀）→ 水平與重力都不動
  if (state === 'fuse') {
    const cancelled =
      dist3 > CREEPER_CANCEL_DIST || !ctx.hasLineOfSight(eyeFrom, eyeTo);
    if (cancelled) {
      state = 'chase';
      fuse = 0;
    } else {
      frozen = true;
      fuse -= step;
      if (fuse <= 0) {
        fuse = 0;
        state = 'exploded';
        events.push({ type: 'explode', creeperId: c.id, at: { ...pos } });
        // 爆炸後實體由 main.ts 移除；這一幀不再移動、不再套重力。
        return {
          creeper: {
            ...c,
            pos,
            vel,
            state,
            fuse,
            fuseTotal,
            wanderDir,
            wanderTimer,
            target: null,
            kbVel,
          },
          events,
        };
      }
    }
  } else {
    state = distXZ <= CREEPER_CHASE_RANGE ? 'chase' : 'wander';
    if (
      state === 'chase' &&
      dist3 < CREEPER_TRIGGER_DIST &&
      ctx.hasLineOfSight(eyeFrom, eyeTo)
    ) {
      state = 'fuse';
      fuse = CREEPER_FUSE_SEC;
      fuseTotal = CREEPER_FUSE_SEC;
      frozen = true;
    }
  }

  // ---- 移動（fuse 期間不做，含重力）----
  if (!frozen) {
    let desX = 0;
    let desZ = 0;
    if (state === 'chase' && distXZ > 0) {
      desX = (dx / distXZ) * CREEPER_CHASE_SPEED;
      desZ = (dz / distXZ) * CREEPER_CHASE_SPEED;
    } else if (state === 'wander') {
      if (wanderTimer <= 0) {
        wanderDir = rng() * Math.PI * 2;
        wanderTimer = WANDER_TURN_MIN + rng() * (WANDER_TURN_MAX - WANDER_TURN_MIN);
      }
      desX = Math.sin(wanderDir) * CREEPER_WANDER_SPEED;
      desZ = Math.cos(wanderDir) * CREEPER_WANDER_SPEED;
    }

    const cx = Math.floor(pos.x);
    const cz = Math.floor(pos.z);
    const grounded = ctx.isSolidAt(cx, Math.floor(pos.y - 0.05), cz);

    let blocked = false;
    let stepUp = false;
    const hSpeed = Math.hypot(desX, desZ);
    if (hSpeed > 0) {
      const lead = hSpeed * step + Math.max(PROBE_LEAD, CREEPER_WIDTH / 2);
      const nx = Math.floor(pos.x + (desX / hSpeed) * lead);
      const nz = Math.floor(pos.z + (desZ / hSpeed) * lead);
      const feetBlocked = ctx.isSolidAt(nx, Math.floor(pos.y + 0.1), nz);
      const headBlocked = ctx.isSolidAt(nx, Math.floor(pos.y + CREEPER_HEIGHT - 0.2), nz);
      blocked = feetBlocked || headBlocked;
      stepUp = feetBlocked;
      if (blocked) {
        desX = 0;
        desZ = 0;
      }
    }

    if (grounded && vel.y <= 0) vel.y = 0;
    else vel.y -= MOB_GRAVITY * step;
    if (stepUp && grounded) vel.y = JUMP_IMPULSE;

    vel.x = desX;
    vel.z = desZ;
  }

  // ---- 擊退（fuse 期間仍可被推；爆炸幀已提前返回）----
  if (kbVel.x !== 0 || kbVel.z !== 0) {
    const kbX = pos.x + kbVel.x * step;
    const kbZ = pos.z + kbVel.z * step;
    if (!ctx.isSolidAt(Math.floor(kbX), Math.floor(pos.y), Math.floor(kbZ))) {
      pos.x = kbX;
      pos.z = kbZ;
    }
    const decay = Math.pow(KNOCKBACK_DECAY_PER_SEC, step);
    kbVel.x *= decay;
    kbVel.z *= decay;
    if (Math.hypot(kbVel.x, kbVel.z) < KNOCKBACK_MIN) {
      kbVel.x = 0;
      kbVel.z = 0;
    }
  }

  // ---- 積分與落地掃描（fuse 期間整段跳過）----
  if (!frozen) {
    pos.x += vel.x * step;
    pos.z += vel.z * step;
    const prevY = pos.y;
    pos.y += vel.y * step;

    if (vel.y <= 0) {
      const toY = Math.floor(pos.y - 0.05);
      for (let cy = Math.floor(prevY - 0.05); cy >= toY; cy--) {
        if (!ctx.isSolidAt(Math.floor(pos.x), cy, Math.floor(pos.z))) continue;
        pos.y = cy + 1;
        vel.y = 0;
        break;
      }
    }
  }

  // exploded 已在上面提前返回（target: null）→ 這裡只剩 chase／fuse／wander。
  const target = state === 'wander' ? null : { x: p.x, y: p.y, z: p.z };

  return {
    creeper: {
      ...c,
      pos,
      vel,
      state,
      fuse,
      fuseTotal,
      wanderDir,
      wanderTimer,
      target,
      kbVel,
    },
    events,
  };
}

/** 步進整批苦力怕（回傳新陣列；事件串接）。 */
export function stepCreepers(
  list: readonly Creeper[],
  ctx: CreeperCtx,
): { creepers: Creeper[]; events: CreeperEvent[] } {
  const creepers: Creeper[] = [];
  const events: CreeperEvent[] = [];
  for (const c of list) {
    const r = stepCreeper(c, ctx);
    creepers.push(r.creeper);
    events.push(...r.events);
  }
  return { creepers, events };
}

/** 扣血（hp 夾在 0）；非有限／非正傷害是 no-op。`from`（任意水平向量，
 *  通常傳玩家的視線方向）→ 沿該方向加 `KNOCKBACK_SPEED` 的擊退（與
 *  `mobs.ts` 的 `damageMob` 同一套正常化寫法）。 */
export function damageCreeper(
  c: Creeper,
  dmg: number,
  from?: { x: number; z: number },
): Creeper {
  const hp = Number.isFinite(dmg) && dmg > 0 ? Math.max(0, c.hp - dmg) : c.hp;
  const kbVel = { x: c.kbVel.x, z: c.kbVel.z };
  if (from) {
    const len = Math.hypot(from.x, from.z);
    if (Number.isFinite(len) && len > 0) {
      kbVel.x += (from.x / len) * KNOCKBACK_SPEED;
      kbVel.z += (from.z / len) * KNOCKBACK_SPEED;
    }
  }
  return { ...c, hp, kbVel };
}

export function isCreeperDead(c: Creeper): boolean {
  return c.hp <= 0;
}

/** 準心命中的苦力怕 id（最近的一隻，`t ≤ reach`）；沒有 → null。
 *  命中盒＝X/Z ± `CREEPER_WIDTH/2`、Y 從腳到 `CREEPER_HEIGHT`；
 *  幾何運算重用 `raycast.ts` 的 `rayAabbEntry`（與其他生物同一套規則）。 */
export function hitCreeperId(
  creepers: readonly Creeper[],
  eye: { x: number; y: number; z: number },
  lookDir: { x: number; y: number; z: number },
  reach: number,
): number | null {
  let bestId: number | null = null;
  let bestT = Infinity;
  for (const c of creepers) {
    const t = rayAabbEntry(
      eye,
      lookDir,
      {
        x: c.pos.x - CREEPER_WIDTH / 2,
        y: c.pos.y,
        z: c.pos.z - CREEPER_WIDTH / 2,
      },
      {
        x: c.pos.x + CREEPER_WIDTH / 2,
        y: c.pos.y + CREEPER_HEIGHT,
        z: c.pos.z + CREEPER_WIDTH / 2,
      },
    );
    if (t !== null && t <= reach && t < bestT) {
      bestT = t;
      bestId = c.id;
    }
  }
  return bestId;
}

/** 玩家近戰攻擊：命中 → 扣血＋擊退，回傳新陣列與命中 id（沒中 → 原清單的
 *  複本、`hitId: null`）。 */
export function attackCreeper(
  creepers: readonly Creeper[],
  eye: { x: number; y: number; z: number },
  lookDir: { x: number; y: number; z: number },
  reach: number,
  damage: number,
  knockDir: { x: number; z: number },
): { creepers: Creeper[]; hitId: number | null } {
  const hitId = hitCreeperId(creepers, eye, lookDir, reach);
  if (hitId === null) return { creepers: [...creepers], hitId: null };
  return {
    creepers: creepers.map((c) =>
      c.id === hitId ? damageCreeper(c, damage, knockDir) : c,
    ),
    hitId,
  };
}

/** 引信進度 0..1（1 ＝ 即將爆炸；渲染閃白用）。 */
export function creeperFuseProgress(c: Creeper): number {
  if (!(c.fuseTotal > 0)) return 0;
  const p = 1 - c.fuse / c.fuseTotal;
  return Math.min(1, Math.max(0, p));
}
