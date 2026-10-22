/**
 * 被動生物（雞／豬／羊／牛）的模型與 AI（B4 Task 6）。
 *
 * **純邏輯層**（no Three/DOM；渲染在後續任務的 `render/passive-mobs.ts`）—— 與
 * `world/mobs.ts`（敵對生物）同一套慣例：純資料實體 + 注入的 `isSolidAt`／
 * `isWaterAt` 回呼（不 import `World`）+ 每一步都有 NaN 防護 + 純函式（回傳新
 * 物件，不改輸入）。
 *
 * **與敵對生物的差異（設計決策）**：
 * - **不主動攻擊**：`stepPassiveMob` **不產生任何事件**（沒有攻擊欄位、沒有
 *   `MobEvent`）→ 被動生物永遠不會對玩家造成傷害。
 * - **不摔傷**：本作的生物本來就沒有摔傷機制（`fallDamage` 只用於玩家，
 *   見 `player/physics.ts`）→ 「雞從高處掉下來不會受傷」**自然成立**，不需要額外
 *   程式碼。這裡特別記錄下來，免得後續有人以為漏寫了傷害判定。
 * - **不 despawn**：原版被動生物不會自然消失（只有怪物／環境／水生類會）→
 *   本作的被動生物也不設距離過濾（對接線層的約束，不是這裡的程式碼）。
 *
 * **速度換算（要寫進 README 差異清單）**：表內同時存 `vanillaSpeed`（原版的
 * 「移動速度屬性」值，與 spec 表一致）與 `speed`（本作的格/秒）。本作的怪物
 * 一律比原版慢（既有殭屍 3.2 格/秒 vs 原版約 4.6）→ 換算方式是「**保留原版的
 * 比例、套用本作的慢速尺度**」：牛最慢 1.5、羊 1.7、雞／豬 1.9 格/秒。panic 時
 * 再乘 {@link PANIC_SPEED_MULTIPLIER}。
 */

// 物理常數直接沿用 `mobs.ts` 的既有值（單一真值來源，不另立一套）：
// `MOB_GRAVITY`（重力 32）、`JUMP_IMPULSE`（跳上 1 格台階的衝量 8）、
// `KNOCKBACK_SPEED`（擊退衝量 6）、`KNOCKBACK_DECAY_PER_SEC`（衰減 0.1/秒）、
// `KNOCKBACK_MIN`（衰減到這個值以下就歸零）。
import {
  MOB_GRAVITY,
  JUMP_IMPULSE,
  KNOCKBACK_SPEED,
  KNOCKBACK_DECAY_PER_SEC,
  KNOCKBACK_MIN,
} from './mobs';
import { rayAabbEntry } from './raycast';

// ---- 定義表 -------------------------------------------------------------

/** 被動生物的種類（四種）。
 *
 *  **與 `world/mob-drops.ts` 的 `MobDropKind` 結構相容**（後者是前者的超集）→
 *  `rollMobDrops(m.kind)` / `dropsForDeaths(…)` 可以直接傳入，不需要轉型。 */
export type PassiveKind = 'chicken' | 'pig' | 'sheep' | 'cow';

/** 一種被動生物的靜態資料。 */
export interface PassiveMobDef {
  kind: PassiveKind;
  /** 血量（原版值）。 */
  hp: number;
  /** 命中盒的寬度（X/Z 方向，原版值）。 */
  width: number;
  /** 命中盒的高度（Y 方向，原版值）。 */
  height: number;
  /** 原版的「移動速度屬性」值（wiki，2026-10-20 查證）：雞 0.25／豬 0.25／羊 0.23／
   *  牛 0.2。**不是本作的格/秒** → 對齊原版的比例用。 */
  vanillaSpeed: number;
  /** 本作的水平移動速度（格/秒）：保留原版比例、套用本作的慢速尺度。 */
  speed: number;
}

/**
 * 四種被動生物的定義表（wiki，2026-10-20 查證）。
 *
 * - 雞：4 血、0.7 高 × 0.4 寬、速度屬性 0.25 → 本作 1.9 格/秒
 * - 豬：10 血、0.9 × 0.9、0.25 → 本作 1.9 格/秒
 * - 羊：8 血、1.3 高 × 0.9 寬、0.23 → 本作 1.7 格/秒
 * - 牛：10 血、1.4 高 × 0.9 寬、0.2 → 本作 1.5 格/秒
 */
export const PASSIVE_DEFS: Readonly<Record<PassiveKind, PassiveMobDef>> = {
  chicken: { kind: 'chicken', hp: 4, width: 0.4, height: 0.7, vanillaSpeed: 0.25, speed: 1.9 },
  pig: { kind: 'pig', hp: 10, width: 0.9, height: 0.9, vanillaSpeed: 0.25, speed: 1.9 },
  sheep: { kind: 'sheep', hp: 8, width: 0.9, height: 1.3, vanillaSpeed: 0.23, speed: 1.7 },
  cow: { kind: 'cow', hp: 10, width: 0.9, height: 1.4, vanillaSpeed: 0.2, speed: 1.5 },
};

/** 同時存在的被動生物上限（原版沒有硬上限，這裡是本作成的保護值）。 */
export const MAX_PASSIVE_MOBS = 12;

/** panic（受驚逃跑）時的速度倍率。 */
export const PANIC_SPEED_MULTIPLIER = 1.4;

/** 受擊後 panic 的持續秒數。 */
export const PANIC_SEC = 5;

/** 漫遊換向的秒數區間（與敵對生物的 `WANDER_TURN_MIN/MAX` 同形）。 */
export const PASSIVE_WANDER_TURN_MIN = 2;
export const PASSIVE_WANDER_TURN_MAX = 4;

// 擊退的強度、衰減與歸零門檻**全部沿用 `mobs.ts` 的既有常數**
// （`KNOCKBACK_SPEED` = 6、`KNOCKBACK_DECAY_PER_SEC` = 0.1、`KNOCKBACK_MIN` = 0.1，
// 見檔頭的 import）→ 這裡不另訂一份。擊退衝量放在獨立於 `vel` 的
// {@link PassiveMob.kbVel} 欄位裡（與 `mobs.ts` 的 `Mob.kbVel` 同一個做法）：
// AI 每幀都會把 `vel` 的水平速度換成自己的目標值 → 寫在 `vel` 上的衝量下一幀就
// 被抹掉（那樣的「擊退」是**觀察不到的死碼**）。

/**
 * 前方探測的**最小**前導距離（格）。
 *
 * **探測距離必須蓋到身體前端**（半寬 `width / 2`）：探測只走到中心前方
 * `PROBE_LEAD`、而牛的半寬是 0.45 → 前端比探測點更遠 → 生物會先走進牆裡約
 * 0.15 格。所以實際的探測距離是 `max(PROBE_LEAD, 半寬)`（見 `stepPassiveMob`）。
 * 這裡保留 0.3 作為**下限**（沿用 `mobs.ts` 的 `PROBE_LEAD` 值）：比身體前端
 * 還多探一點點 → 生物停下來時不會貼著牆面。
 */
const PROBE_LEAD = 0.3;

// ---- 實體 ----------------------------------------------------------------

/** 一隻站在世界裡的被動生物（腳底中心 `pos`）。純資料 → 由 `stepPassiveMob` 步進。 */
export interface PassiveMob {
  id: number;
  kind: PassiveKind;
  hp: number;
  /** 命中盒的寬度（X/Z），建立時從定義表複製。 */
  width: number;
  /** 命中盒的高度（Y），建立時從定義表複製。 */
  height: number;
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  /** 面向（弧度，atan2(x, z)）：停下時保留（不會突然轉回去）。 */
  yaw: number;
  /** 漫遊方向（弧度）＋ 距離下一次換向的秒數。 */
  wanderDir: number;
  wanderTimer: number;
  /** 受驚剩餘秒數（> 0 = 正在逃跑）與逃跑方向（弧度）。 */
  panicTimer: number;
  panicDir: number;
  /** 擊退衝量（水平、格/秒），**獨立於 `vel`** —— AI 每幀會把 `vel` 的水平速度
   *  換成自己的目標值，所以衝量必須另存一個欄位（與 `mobs.ts` 的 `Mob.kbVel`
   *  同一個做法）。以 `0.1^dt` 衰減，低於 `KNOCKBACK_MIN` 就歸零。 */
  kbVel: { x: number; z: number };
}

/** `stepPassiveMob` 的上下文：玩家位置、注入的世界查詢、這一幀的 dt、可注入的
 *  rng（測試可重現；省略＝`Math.random`）。 */
export interface PassiveCtx {
  /** 玩家的腳底位置（panic 時用來避免「朝玩家跑」）。 */
  playerPos: { x: number; y: number; z: number };
  /** 該格是不是實心方塊（注入，不 import `World`；水**不**算實心）。 */
  isSolidAt: (x: number, y: number, z: number) => boolean;
  /** 該格是不是水（腳下格是水 → 漂浮）。 */
  isWaterAt: (x: number, y: number, z: number) => boolean;
  /** 這一幀的 dt（秒）。 */
  dt: number;
  /** 隨機數來源（可注入 → 測試可重現；省略＝`Math.random`）。 */
  rng?: () => number;
}

/** 單調遞增的 id 計數器（模組層級；同一個 session 內唯一，跟 `mobs.ts` 的
 *  `nextMobId` 同一個慣例）。 */
let nextPassiveId = -1;

/** 在 `pos` 產生一隻被動生物（位置會被複製，不會與呼叫端共用參考）。
 *
 *  `hp`／`width`／`height` 取自定義表；`yaw = 0`；漫遊方向與「距離下一次換向的
 *  秒數（2–4 秒）」由 rng 決定（rng 可注入 → 測試可重現；省略＝`Math.random`）。 */
export function createPassiveMob(
  kind: PassiveKind,
  pos: { x: number; y: number; z: number },
  rng: () => number = Math.random,
): PassiveMob {
  nextPassiveId += 1;
  const def = PASSIVE_DEFS[kind];
  return {
    id: nextPassiveId,
    kind,
    hp: def.hp,
    width: def.width,
    height: def.height,
    pos: { x: pos.x, y: pos.y, z: pos.z }, // 複製 —— 絕不與呼叫端共用參考
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    wanderDir: rng() * Math.PI * 2,
    wanderTimer:
      PASSIVE_WANDER_TURN_MIN +
      rng() * (PASSIVE_WANDER_TURN_MAX - PASSIVE_WANDER_TURN_MIN),
    panicTimer: 0,
    panicDir: 0,
    kbVel: { x: 0, z: 0 },
  };
}

/** 血量歸零（死亡）→ 呼叫端把它從名單裡移除（掉落由呼叫端處理）。 */
export function isPassiveDead(m: PassiveMob): boolean {
  return m.hp <= 0;
}

/**
 * 施加傷害：回傳一隻**新的**被動生物，血量夾在 0（不會是負數）。
 *
 * **兩個參數各自只管一件事（互相獨立）**：
 * - `from`（**攻擊者的位置**，brief 釘死的第三個參數）→ 決定 `panicDir`
 *   （**背離攻擊者**）：`atan2(m.pos.x - from.x, m.pos.z - from.z)`；沒有 `from`
 *   時用「原本的漫遊方向 + π」＝往回跑。
 * - `knockbackDir`（**擊退方向**，任何水平向量；3D 的也吃得下，y 會被忽略）→
 *   決定 `kbVel` 的衝量：方向正規化後 × `KNOCKBACK_SPEED`（**照 `mobs.ts` 的
 *   `damageMob` 的數學**），由 `stepPassiveMob` 逐幀衰減並推動位置。方向長度 0
 *   或非有限 → 不施加。
 *
 * 其他規則：
 * - **NaN／非有限的傷害 → 不扣血**（repo 的 NaN 防護慣例）。
 * - **負數／0 的傷害 → 不扣血、也不 panic**（「沒有受傷就沒有反應」）。
 * - **真的受傷 → panic**：{@link PANIC_SEC} 秒的逃跑時間。
 * - **永遠回傳新物件**（與 `damageMob` 同一個慣例；不在任何分支回同一個參考）。 */
export function damagePassiveMob(
  m: PassiveMob,
  dmg: number,
  from?: { x: number; z: number },
  knockbackDir?: { x: number; y?: number; z: number },
): PassiveMob {
  const hurt = Number.isFinite(dmg) && dmg > 0;
  const hp = hurt ? Math.max(0, m.hp - dmg) : m.hp;

  // ---- 擊退：與 `mobs.ts` 的 `damageMob` 同一段數學（與 panic 互相獨立）----
  const kbVel = { x: m.kbVel.x, z: m.kbVel.z };
  const len = knockbackDir ? Math.hypot(knockbackDir.x, knockbackDir.z) : 0;
  const hasDir = Number.isFinite(len) && len > 0;
  if (knockbackDir && hasDir) {
    kbVel.x += (knockbackDir.x / len) * KNOCKBACK_SPEED;
    kbVel.z += (knockbackDir.z / len) * KNOCKBACK_SPEED;
  }

  // ---- 驚慌：受傷才開始；方向＝背離攻擊者（`from`） ----
  const panicTimer = hurt ? PANIC_SEC : m.panicTimer;
  let panicDir = m.panicDir;
  if (hurt) {
    panicDir = from
      ? Math.atan2(m.pos.x - from.x, m.pos.z - from.z)
      : m.wanderDir + Math.PI;
  }

  return { ...m, hp, kbVel, panicTimer, panicDir };
}

/**
 * 一幀的 AI + 物理（回傳**新的**生物，不改輸入）。
 *
 * 順序：NaN 防護 dt → panic 計時 → 方向與速度（panic／漫遊）→ 前方探測（擋住就
 * 停下、1 格台階跳上去）→ 重力（水中漂浮）→ **擊退推位＋衰減** → 積分 → 落地
 * 吸附 → 朝向。
 *
 * **擊退**的那一段數學**逐行照抄 `mobs.ts` 的 `stepMob`**（推一下位置 → 以
 * `0.1^dt` 衰減 → 低於 `KNOCKBACK_MIN` 歸零 → 目的地格是實心就不推）。
 */
export function stepPassiveMob(m: PassiveMob, ctx: PassiveCtx): PassiveMob {
  const step = Number.isFinite(ctx.dt) && ctx.dt > 0 ? ctx.dt : 0;
  const def = PASSIVE_DEFS[m.kind];
  const rng = ctx.rng ?? Math.random;

  const pos = { x: m.pos.x, y: m.pos.y, z: m.pos.z };
  const vel = { x: m.vel.x, y: m.vel.y, z: m.vel.z };
  const kbVel = { x: m.kbVel.x, z: m.kbVel.z };
  let wanderDir = m.wanderDir;
  let wanderTimer = m.wanderTimer - step;
  const panicTimer = Math.max(0, m.panicTimer - step);

  // ---- 方向與速度 ----
  // panic 中：沿著 `panicDir` 以 1.4 倍速逃跑（**不重新漫遊**）。
  // 否則：漫遊計時歸零就換一個新方向（2–4 秒換一次，與敵對生物同形）。
  let dirX: number;
  let dirZ: number;
  let speed: number;
  if (panicTimer > 0) {
    dirX = Math.sin(m.panicDir);
    dirZ = Math.cos(m.panicDir);
    speed = def.speed * PANIC_SPEED_MULTIPLIER;
    // **panic 期間不靠近玩家**：`panicDir` 是背離「攻擊者」的方向，而攻擊者未必
    // 是玩家（例如被箭射中）→ 若這個方向會朝玩家靠近，就翻面逃跑。
    const toPlayerX = ctx.playerPos.x - pos.x;
    const toPlayerZ = ctx.playerPos.z - pos.z;
    if (dirX * toPlayerX + dirZ * toPlayerZ > 0) {
      dirX = -dirX;
      dirZ = -dirZ;
    }
  } else {
    if (wanderTimer <= 0) {
      wanderDir = rng() * Math.PI * 2;
      wanderTimer =
        PASSIVE_WANDER_TURN_MIN +
        rng() * (PASSIVE_WANDER_TURN_MAX - PASSIVE_WANDER_TURN_MIN);
    }
    dirX = Math.sin(wanderDir);
    dirZ = Math.cos(wanderDir);
    speed = def.speed;
  }

  // ---- 前方探測：被擋住就停下（不穿牆）；腳底被擋 → 1 格台階 → 跳上去 ----
  let desX = dirX * speed;
  let desZ = dirZ * speed;
  const hSpeed = Math.hypot(desX, desZ);
  let stepUp = false;
  if (hSpeed > 0) {
    // **探測距離要蓋到身體前端**（半寬 `width / 2`）：只探 `PROBE_LEAD`（0.3）
    // 而牛的半寬 0.45 → 前端比探測點更遠 → 生物會先走進牆裡約 0.15 格。
    const lead = hSpeed * step + Math.max(PROBE_LEAD, def.width / 2);
    const nx = Math.floor(pos.x + (desX / hSpeed) * lead);
    const nz = Math.floor(pos.z + (desZ / hSpeed) * lead);
    const feetBlocked = ctx.isSolidAt(nx, Math.floor(pos.y + 0.1), nz);
    const headBlocked = ctx.isSolidAt(nx, Math.floor(pos.y + def.height + 0.1), nz);
    if (feetBlocked || headBlocked) {
      desX = 0;
      desZ = 0;
    }
    // 腳底被擋 → 那是 1 格高的台階 → 站在地上時給一個跳躍衝量（跨上去）。
    stepUp = feetBlocked;
  }

  // ---- 重力／水中漂浮 ----
  const cx = Math.floor(pos.x);
  const cz = Math.floor(pos.z);
  // 「腳下格是水」的判定與 `mobs.ts` 的 `stepSunBurn` 同一個慣例：身體所在的那一格。
  const inWater = ctx.isWaterAt(cx, Math.floor(pos.y), cz);
  const grounded = ctx.isSolidAt(cx, Math.floor(pos.y - 0.05), cz);
  if (inWater) {
    // **水中漂浮**：不施加重力（`vel.y = 0`）、也不做落地吸附 → 不會慢慢沉下去；
    // 水平移動照常。
    vel.y = 0;
  } else if (grounded && vel.y <= 0) {
    vel.y = 0;
  } else {
    vel.y -= MOB_GRAVITY * step;
  }
  // 自動跳上 1 格台階：衝量在重力之後給（數值才精確）；水裡不跳。
  if (stepUp && grounded && !inWater) vel.y = JUMP_IMPULSE;

  vel.x = desX;
  vel.z = desZ;

  // ---- 擊退：推一下位置，然後以 0.1^dt 衰減（`mobs.ts` 的 `stepMob` 同一段數學）----
  // 衝量**疊加在 AI 的水平速度之上**（不是取代）→ 被砍的那一下真的會被推開。
  if (kbVel.x !== 0 || kbVel.z !== 0) {
    const kbX = pos.x + kbVel.x * step;
    const kbZ = pos.z + kbVel.z * step;
    // embed guard: skip the step when the destination cell is solid — a hit
    // near a wall must not push the mob permanently inside the geometry.
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

  // ---- 積分 ----
  const prevY = pos.y;
  pos.x += vel.x * step;
  pos.z += vel.z * step;
  pos.y += vel.y * step;

  // 落地：從前一格往下掃到新進的那一格 → 第一個實心格的頂面（`mobs.ts` 同一個
  // 做法 → 掉得再快也不會穿過地板）。**水中不做**（漂浮不下潛）。
  if (!inWater && vel.y <= 0) {
    const toY = Math.floor(pos.y - 0.05);
    for (let cy = Math.floor(prevY - 0.05); cy >= toY; cy--) {
      if (!ctx.isSolidAt(Math.floor(pos.x), cy, Math.floor(pos.z))) continue;
      pos.y = cy + 1;
      vel.y = 0;
      break;
    }
  }

  // ---- 朝向：水平速度真的在動才轉（停下時保留上一次的方向） ----
  let yaw = m.yaw;
  if (Math.hypot(vel.x, vel.z) > 0.01) yaw = Math.atan2(vel.x, vel.z);

  return { ...m, pos, vel, kbVel, yaw, wanderDir, wanderTimer, panicTimer };
}

/** 步進整個名單（回傳**新的**陣列；輸入沒被改）。 */
export function stepPassiveMobs(
  mobs: readonly PassiveMob[],
  ctx: PassiveCtx,
): PassiveMob[] {
  return mobs.map((m) => stepPassiveMob(m, ctx));
}

/**
 * 準星命中的被動生物 id（`reach` 內**最近**的那一隻）或 null（沒打中）。
 *
 * 命中盒＝`x ± width/2`、`y .. y + height`（用定義表的體型）→ 雞比較矮，瞄準牠的
 * 頭頂會從上面掠過。射線／盒子的運算與敵對生物共用 `raycast.ts` 的
 * `rayAabbEntry`。
 *
 * NaN／零長度的方向、非有限的 reach 都不會命中（repo 的 NaN 防護慣例）。
 */
export function hitPassiveMobId(
  mobs: readonly PassiveMob[],
  eyePos: { x: number; y: number; z: number },
  lookDir: { x: number; y: number; z: number },
  reach: number,
): number | null {
  if (!Number.isFinite(reach) || reach <= 0) return null;
  if (
    ![eyePos.x, eyePos.y, eyePos.z, lookDir.x, lookDir.y, lookDir.z].every(Number.isFinite)
  ) {
    return null;
  }
  const len = Math.hypot(lookDir.x, lookDir.y, lookDir.z);
  if (len === 0) return null;
  const dir = { x: lookDir.x / len, y: lookDir.y / len, z: lookDir.z / len };

  let bestT = Infinity;
  let bestId: number | null = null;
  for (const m of mobs) {
    if (![m.pos.x, m.pos.y, m.pos.z].every(Number.isFinite)) continue;
    const half = m.width / 2;
    const t = rayAabbEntry(
      eyePos,
      dir,
      { x: m.pos.x - half, y: m.pos.y, z: m.pos.z - half },
      { x: m.pos.x + half, y: m.pos.y + m.height, z: m.pos.z + half },
    );
    if (t === null || t > reach) continue;
    if (t < bestT) {
      bestT = t;
      bestId = m.id; // 嚴格 < → 同距離時名單裡前面的先贏
    }
  }
  return bestId;
}

/** 一次揮擊的結果：套用了傷害與擊退的生物名單＋被打中的那一隻的 id（沒打中 →
 *  `hitId: null`）。 */
export interface PassiveAttackResult {
  mobs: PassiveMob[];
  hitId: number | null;
}

/**
 * 一次近戰揮擊：找出準星下最近的那隻被動生物（`reach` 內），扣血並沿著**水平
 * 視線方向**給一個擊退。
 *
 * - **攻擊者位置**＝`eyePos`（玩家的眼睛）→ 傳給 `damagePassiveMob` 的 `from`，
 *   生物的 panic 方向＝**背離玩家**。
 * - **擊退方向**＝`knockDir`（玩家的水平視線方向 → 把生物推離玩家）→ 傳給
 *   `damagePassiveMob` 的 `knockbackDir`，衝量寫進 {@link PassiveMob.kbVel}
 *   （`KNOCKBACK_SPEED`，與 `mobs.ts` 同一個常數）→ 由 `stepPassiveMob` 逐幀衰減
 *   並**推動位置**（疊加在 AI 的水平速度之上）。
 * - 兩個方向在遊戲內一致：玩家在 +z 看著生物 → 背離玩家 ＝ -z ＝ 視線方向。
 * - 沒打中 → 回傳**同一個陣列參考**與 `hitId: null`（與 `attackMob` 同一個慣例）。
 */
export function attackPassiveMob(
  mobs: PassiveMob[],
  eyePos: { x: number; y: number; z: number },
  lookDir: { x: number; y: number; z: number },
  reach: number,
  damage: number,
  knockDir: { x: number; y?: number; z: number },
): PassiveAttackResult {
  const hitId = hitPassiveMobId(mobs, eyePos, lookDir, reach);
  if (hitId === null) return { mobs, hitId: null }; // 沒打中 → 同一個參考
  let applied = false;
  const next = mobs.map((m) => {
    if (applied || m.id !== hitId) return m; // 其他生物保留原參考
    applied = true;
    // 傷害＋擊退＋驚慌：一次完成。
    // `from` ＝攻擊者位置（玩家的眼睛）→ panic 方向＝背離玩家；
    // `knockbackDir` ＝擊退方向（水平視線方向）→ kbVel 衝量。
    return damagePassiveMob(m, damage, { x: eyePos.x, z: eyePos.z }, knockDir);
  });
  return { mobs: next, hitId };
}

/**
 * 四種被動生物的**等機率**選種（rng 可注入 → 測試可重現；省略＝`Math.random`）。
 *
 * **範圍說明**：本任務只提供「選哪一種」這個純函式；**生成群的統計**（生成距離、
 * 光照門檻、群體大小、地面材質…）是後續任務的事 → 那邊會把這裡的等機率接上
 * 真正的生成規則（必要時會調整機率）。
 */
export function choosePassiveKind(rng: () => number = Math.random): PassiveKind {
  const kinds: readonly PassiveKind[] = ['chicken', 'pig', 'sheep', 'cow'];
  const i = Math.floor(rng() * kinds.length);
  return kinds[Math.min(kinds.length - 1, Math.max(0, i))];
}
