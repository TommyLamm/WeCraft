/**
 * 被動生物（雞／豬／羊／牛）的模型與 AI（B4 Task 6）＋**生成規則**（B4 Task 7）。
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
  surfaceYAt,
} from './mobs';
import { rayAabbEntry } from './raycast';
import { BLOCK } from './blocks';
import { canSpawnPassive, type SpawnLight } from './spawn-rules';

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

/**
 * 同時存在的被動生物上限（原版沒有硬上限，這裡是本作成的保護值）。
 *
 * **這是「全場上限」**（spec §B4.2）：場上的被動生物總數**永不超過 12** → 生成時
 * 就夾制（見 `trySpawnPassiveGroup`），不是只在「開始嘗試」時擋一次。存檔（Task 10）
 * 用的是**同一個常數**（超過 12 筆只保留前 12 筆）→ 兩邊一致，不會有生物在存／讀
 * 之間無聲消失。
 */
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
 * **範圍說明**：本函式只提供「選哪一種」這個純函式；生成群的統計（生成距離、
 * 光照門檻、群體大小、地面材質…）在檔尾的「生成規則」那一段。
 *
 * **等機率是簡化（要寫進 README 的簡化清單）**：原版依**生態**（biome）加權
 * （例如牛只在新版本草原大量生成），本作目前是四種等機率 → B3 的 8 個生態落地後
 * 可以再調成跟生態走。
 */
export function choosePassiveKind(rng: () => number = Math.random): PassiveKind {
  const kinds: readonly PassiveKind[] = ['chicken', 'pig', 'sheep', 'cow'];
  const i = Math.floor(rng() * kinds.length);
  return kinds[Math.min(kinds.length - 1, Math.max(0, i))];
}

// ---- 生成規則（B4 Task 7）------------------------------------------------

/**
 * 被動生物的生成間隔（秒）。**與敵對生物的 5 秒排程並列**（`main.ts` 的
 * `state === 'playing'` 區塊），但更慢：被動生物**不會 despawn**（離開視線也
 * 還在）→ 補得太快會讓世界塞滿雞豬羊牛（上限 {@link MAX_PASSIVE_MOBS}）。
 */
export const PASSIVE_SPAWN_INTERVAL_SEC = 10;

/**
 * **spec §B4.2 的硬下限**：成員的**實際距離**（離玩家）不得小於這個值（24）。
 *
 * **與 {@link PASSIVE_SPAWN_MOTHER_MIN_DIST} 的界線要分清楚**（2026-10-20 稽核修正）：
 * - `PASSIVE_SPAWN_MIN_DIST = 24` ＝ **成員實際距離的下界**（＝測試門檻）。
 * - `PASSIVE_SPAWN_MOTHER_MIN_DIST = 28` ＝ **母點距離的下界**。
 *
 * 成員在母點附近 ±2 格取位 → 最壞的位移是 `√(2²+2²) ≈ 2.83` → 成員實際距離
 * 最壞是 `28 − 2.83 ≈ 25.2 ≥ 24` → 兩條規則自洽。
 * （母點若從 24 起算，成員會掉到 `24 − 2.83 ≈ 21.2 < 24` → 與「離玩家 ≥ 24」
 * 的測試互相矛盾、會間歇性紅。）
 */
export const PASSIVE_SPAWN_MIN_DIST = 24;

/**
 * 生成距離的**上限**（格）：世界半徑有限，遠處生成的動物玩家走不到（B6 可調）。
 *
 * **這個上限是「母點距離」的上限**（母點的區間是
 * {@link PASSIVE_SPAWN_MOTHER_MIN_DIST}–{@link PASSIVE_SPAWN_MAX_DIST}）；成員在母點
 * 附近 ±2 格取位 → 成員的實際距離最多再多 `√(2²+2²) ≈ 2.83` 格。
 */
export const PASSIVE_SPAWN_MAX_DIST = 48;

/**
 * **母點**（整群的中心）距離的**下限**（格）——見 {@link PASSIVE_SPAWN_MIN_DIST}
 * 的推導：母點從 28 起算，成員偏移 ±2 之後仍然 ≥ 24（spec 的硬下限）。
 */
export const PASSIVE_SPAWN_MOTHER_MIN_DIST = 28;

/**
 * 一群的成員數下／上限（wiki，2026-10-20：Bedrock 2–4、Java 4）→ 本作取 **2–4**。
 */
export const PASSIVE_SPAWN_MIN_GROUP = 2;
export const PASSIVE_SPAWN_MAX_GROUP = 4;

/** 成員在母點附近的偏移半寬（格）：母點附近 ±2 格內隨機取位。 */
const PASSIVE_SPAWN_OFFSET = 2;

/**
 * 被動生物生成的上下文（純邏輯；`main.ts` 注入世界的查詢）。
 *
 * 與敵對生物的 `mobs.ts` 的 `SpawnCtx` 同一個形狀（光照門檻 ＋ 注入的世界讀取
 * ＋ 可注入的 rng）→ B6 起 `lightAt` 注入 `lighting.spawnLightAt`（真的 per-block
 * 光照），判準常數（亮度 ≥ 9）不用動。
 */
export interface PassiveSpawnCtx {
  /**
   * 現在是不是白天（`spawn-rules.ts` 的 `isDaylight(clock.t)`）。
   *
   * **A5 的修正**：亮度判準（`canSpawnPassive`）看的是**客戶端**天空光，它
   * **不隨時間衰減**（夜間地表仍是 15）→ 只靠亮度會讓被動生物在夜間地表生成，
   * 違反 B4 交付的「白天生成」（spec §B4.2）。**時間**是另一條閘門，由呼叫端
   * 注入時鐘（純邏輯層不 import 時鐘）。
   */
  isDaylight: () => boolean;
  /**
   * 生成點的 per-block 光照查詢（`lighting.spawnLightAt`）：B4 用 `clockLight(t)`
   * 近似（天空光 15／0）→ 被動生物**只在白天生成**；B6 改成**逐隻**在自己的位置
   * 檢查（亮度 = max(客戶端天空光, 方塊光) ≥ 9；MC 的規則是逐隻）→ 夜間地表
   * （客戶端天空光 15，時間無關）仍可生成（與原版一致），全黑才擋。
   *
   * A5 之後「白天」由上面的 `isDaylight` 負責；這裡只回答「亮不亮」
   * （遮蔽的天空／洞穴＋無方塊光 → 擋；火把旁 → 可以）。
   */
  lightAt: (x: number, y: number, z: number) => SpawnLight;
  /** 該格是不是實心方塊（注入，不 import `World`；水**不**算實心）。 */
  isSolidAt: (x: number, y: number, z: number) => boolean;
  /** 該格的方塊 id（注入）。 */
  blockIdAt: (x: number, y: number, z: number) => number;
  /** 隨機數來源（可注入 → 測試可重現；省略＝`Math.random`）。 */
  rng?: () => number;
}

/**
 * 母點（整群的中心）：與玩家相距 {@link PASSIVE_SPAWN_MOTHER_MIN_DIST}–{@link PASSIVE_SPAWN_MAX_DIST}
 * 格、角度均勻（rng 可注入 → 測試可重現）。
 *
 * **為什麼母點的下界（28）比成員的下界（24）大**：成員在母點附近 ±2 格取位
 * → 母點 28 最壞也會讓成員落在 `28 − 2.83 ≈ 25.2`（≥ 24 ✓）。
 */
export function passiveMotherPoint(
  playerPos: { x: number; y: number; z: number },
  rng: () => number = Math.random,
): { x: number; z: number; dist: number } {
  const angle = rng() * Math.PI * 2;
  const dist =
    PASSIVE_SPAWN_MOTHER_MIN_DIST +
    rng() * (PASSIVE_SPAWN_MAX_DIST - PASSIVE_SPAWN_MOTHER_MIN_DIST);
  return {
    x: playerPos.x + Math.sin(angle) * dist,
    z: playerPos.z + Math.cos(angle) * dist,
    dist,
  };
}

/** 可生長的地面：草地（`BLOCK.GRASS`）或泥土（`BLOCK.DIRT`）（spec §B4.2）。 */
function isSpawnGround(id: number): boolean {
  return id === BLOCK.GRASS || id === BLOCK.DIRT;
}

/**
 * 一柱的「地面」高度（最高的一個草地／泥土實心塊的 y）；沒有可生長的地面 → null。
 *
 * **為什麼不直接用 `surfaceYAt` 的結果當地面**：`surfaceYAt` 回的是「**最高**的
 * 實心塊 + 1」→ 若地面上方有天花板（石頭／樹葉），那個天花板會變成「地面」，
 * 生物會站在天花板上，而「頭頂空間」的檢查也會永遠成立（形同虛設）。所以在
 * 最高的實心塊不是草地／泥土時，往下找**真正的地面**，讓頭頂空間的檢查有意義
 * （天花板正下方就沒有空間 → 不生成）。
 */
function groundYAt(
  x: number,
  z: number,
  isSolidAt: (x: number, y: number, z: number) => boolean,
  blockIdAt: (x: number, y: number, z: number) => number,
): number | null {
  // **格座標一定要先 floor**：`world.getBlock(x, y, z)` 只 floor 到 chunk，
  // 格子內的座標是**原樣**送進 `chunk.get` 的（不 floor）→ 傳小數會讀到
  // `undefined` → 地面判定全數落空（瀏覽器實測：整個遊戲都不生成）。
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  const surface = surfaceYAt(cx, cz, isSolidAt, blockIdAt);
  if (surface === null) return null; // 整柱沒有實心塊（未生成）或只有基岩
  const top = surface - 1;
  if (isSpawnGround(blockIdAt(cx, top, cz))) return top;
  for (let y = top - 1; y >= 1; y--) {
    if (!isSolidAt(cx, y, cz)) continue;
    if (isSpawnGround(blockIdAt(cx, y, cz))) return y;
  }
  return null;
}

/**
 * 頭頂空間：身體要佔 `Math.ceil(height)` 格 → 這些格都必須是空的。
 *
 * **空間是依高度推導的**（不是原版一律 2 格）：雞／豬 1 格、羊／牛 2 格。
 * 原版是「至少兩格空間」，但雞只有 0.7 高 → 不需要 2 格；用高度推導比較合理。
 */
function hasRoomAbove(
  x: number,
  feetY: number,
  z: number,
  height: number,
  isSolidAt: (x: number, y: number, z: number) => boolean,
): boolean {
  const cells = Math.ceil(height);
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  for (let i = 0; i < cells; i++) {
    if (isSolidAt(cx, feetY + i, cz)) return false;
  }
  return true;
}

/**
 * 「這一輪沒有生成 → 回**同一個參考**」的統一寫法。
 *
 * 參數是 `readonly PassiveMob[]`（**我們不會 mutate 輸入**），回傳型別卻要是
 * `PassiveMob[]`（呼叫端要能直接賦回自己的名單）→ 這裡只做一次型別轉身：
 * **不複製、不修改**，回傳的就是同一個陣列。
 */
function unchanged(mobs: readonly PassiveMob[]): PassiveMob[] {
  return mobs as PassiveMob[];
}

/**
 * 嘗試生成**一群**被動生物（2–4 隻、同一種類）。
 *
 * **回傳值的語意**：成功 → **新陣列**（`[...mobs, ...created]`）；沒有生成 →
 * **同一個參考**（`mobs`）→ 呼叫端可以直接 `mobs = trySpawnPassiveGroup(...)`。
 *
 * 流程（任何一步不通就整輪不生成）：
 * 0. **白天閘門（A5）**：`!ctx.isDaylight()` → 不生成（回同一個參考）。在**最
 *    前面**——夜間連一次世界查詢都不做（生成排程每 10 秒跑一次，整夜都在跑）。
 *    為什麼時鐘不在亮度裡：`canSpawnPassive` 看客戶端天空光（時間無關）。
 * 1. **總量上限**：達 {@link MAX_PASSIVE_MOBS} 就不生成（回同一個參考）。
 * 2. **母點**：距玩家 28–48 格、角度均勻（`passiveMotherPoint`）。
 * 3. **母點的地面**：沒有地面／不是草地泥土 → 不生成。
 * 4. **群組成**：2–4 隻、同一種類（四種等機率 → 見 `choosePassiveKind` 的簡化說明）。
 * 5. **成員取位**：母點附近 ±2 格 → 每一隻都重做**光照／地面／頭頂空間**的檢查；
 *    不通過就**跳過該隻**。
 *    **光照門檻（B6）**：每隻在自己的位置查 per-block 光照
 *    `canSpawnPassive(ctx.lightAt(...))`（MC 的規則是逐隻；B4 是群組前用單一
 *    `clockLight` 值粗判＝只在白天生成）→ 位置在暗處的成員被略過。
 * 6. **全場上限的夾制**：加入成員的**過程中**一旦當前總數達到
 *    {@link MAX_PASSIVE_MOBS} 就停止再加入（場上的總數**永不超過 12**；存檔也用
 *    同一個常數 → 存／讀之間不會有生物無聲消失）。
 * 7. **成群 2–4（A6）**：成員**少於 2 隻** → **整輪失敗**（回同一個參考，下一次
 *    排程再試）。理由：B4 交付的是「成群 2–4」——1 隻的「群」不是群；上限夾制
 *    把 4 隻截成 1 隻時（只剩 1 個名額）寧可這一輪不生成。
 *
 * **被動生物不會 despawn**（spec §B4.2；原版被動生物也不會自然消失）→ 這裡
 * 沒有「離太遠就移除」的分支（那是接線層的約束，`main.ts` 也沒有距離過濾）。
 */
export function trySpawnPassiveGroup(
  mobs: readonly PassiveMob[],
  playerPos: { x: number; y: number; z: number },
  ctx: PassiveSpawnCtx,
): PassiveMob[] {
  const rng = ctx.rng ?? Math.random;
  // 0) 白天閘門（A5）：被動生物**只在白天**生成（B4 交付／spec §B4.2）。這是
  //    獨立於亮度的**時間**判準——`canSpawnPassive` 看的是客戶端天空光，夜間
  //    地表仍是 15，不會擋。放在最前面：夜間不做任何世界查詢。
  if (!ctx.isDaylight()) return unchanged(mobs);
  // 1) 總量上限（**全場上限**：達上限就不發起這一次嘗試 → 回同一個參考；
  //    「加入時也要夾制」見下面第 6 步的註解）
  if (mobs.length >= MAX_PASSIVE_MOBS) return unchanged(mobs);
  // 2) 母點：距玩家 28–48 格
  const mother = passiveMotherPoint(playerPos, rng);
  // 3) 母點的地面（沒有可生長的地面 → 這一輪不生成）
  if (groundYAt(mother.x, mother.z, ctx.isSolidAt, ctx.blockIdAt) === null) return unchanged(mobs);
  // 4) 群組成：2–4 隻、同一種類
  const count =
    PASSIVE_SPAWN_MIN_GROUP +
    Math.floor(rng() * (PASSIVE_SPAWN_MAX_GROUP - PASSIVE_SPAWN_MIN_GROUP + 1));
  const kind = choosePassiveKind(rng);
  const def = PASSIVE_DEFS[kind];
  // 5) 成員取位：母點附近 ±2 格 → 每一隻重做光照／地面／頭頂空間的檢查
  const created: PassiveMob[] = [];
  for (let i = 0; i < count; i++) {
    // **全場上限（spec §B4.2「全場上限 12」）＝ 場上的總數永不超過 12** → 加入的
    // 過程中就要夾制（不是只在「開始嘗試」時擋一次）：11 隻時生成一整群會到 15，
    // 而存檔只留前 12 筆（Task 10，與本常數同一個）→ 存／讀之間最多 3 隻無聲
    // 消失。夾制後**群可以只加一部分**（與「取位失敗就跳過該隻、群可以少於 2 隻」
    // 同一個語意）。
    if (mobs.length + created.length >= MAX_PASSIVE_MOBS) break;
    const dx = rng() * PASSIVE_SPAWN_OFFSET * 2 - PASSIVE_SPAWN_OFFSET;
    const dz = rng() * PASSIVE_SPAWN_OFFSET * 2 - PASSIVE_SPAWN_OFFSET;
    const x = mother.x + dx;
    const z = mother.z + dz;
    const ground = groundYAt(x, z, ctx.isSolidAt, ctx.blockIdAt);
    if (ground === null) continue; // 這一隻的地面不對 → 跳過
    const feetY = ground + 1;
    // **光照門檻（B6）：逐隻檢查**——在自己的位置查 per-block 光照（亮度 =
    // max(客戶端天空光, 方塊光) ≥ 9）。B4 是群組前用 `clockLight` 單值粗判
    // （＝只在白天生成）；B6 起夜間地表（客戶端天空光 15）仍可生成、全黑才擋。
    if (!canSpawnPassive(ctx.lightAt(Math.floor(x), feetY, Math.floor(z)))) continue;
    if (!hasRoomAbove(x, feetY, z, def.height, ctx.isSolidAt)) continue; // 頭頂空間不足
    created.push(createPassiveMob(kind, { x, y: feetY, z }, rng));
  }
  // 7) **成群 2–4（A6）**：少於 2 隻 → 整輪失敗（回同一個參考）。這同時涵蓋
  //    「一隻都沒有」與「只成得出 1 隻」兩種情形——1 隻的「群」不是群。
  if (created.length < PASSIVE_SPAWN_MIN_GROUP) return unchanged(mobs);
  return [...mobs, ...created];
}
