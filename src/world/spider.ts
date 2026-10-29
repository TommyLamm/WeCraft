import {
  KNOCKBACK_DECAY_PER_SEC,
  KNOCKBACK_MIN,
  KNOCKBACK_SPEED,
  MOB_GRAVITY,
  WANDER_TURN_MAX,
  WANDER_TURN_MIN,
} from './mobs';
import { rayAabbEntry } from './raycast';
import type { SpawnLight } from './spawn-rules';

// ---- 蜘蛛（B9 Task 6）----
//
// 數值全部來自 Java 版（minecraft.wiki/Spider，2026-10-20 查證）：
// - HP 16、碰撞盒 0.9 高 × 1.4 寬、攻擊 2（Normal）、冷卻 1 秒；
// - **敵對門檻：亮度 ≤ 11 → 敵對、≥ 12 → 中立**（原版「spiders are hostile
//   when light level ≤ 11」）；被玩家攻擊後（`angry`）不論亮度都追擊；
// - 察覺距離 16 格、**可隔牆察覺**（原版明文 "A spider pursuing a player can
//   detect a player through blocks"）→ 狀態機不看視線；只有**咬擊**要視線；
// - 速度屬性 0.3 對殭屍 0.23 ≈ 1.30 倍；本作殭屍 3.2 → 3.2 × 1.30 ≈ 4.17，
//   取 4.0（本作整體比原版慢，是既有簡化）；
// - 攀牆：只能爬完整方塊、只在追擊時爬、每次最多 3 格（本作自訂上限，見下）。
//
// **中立判準吃的是 B6 的「內部天空光」**（`internalSky`），不是客戶端天空光
// （`sky`）：客戶端天空光白天永遠是 15（時間無關），用它會讓蜘蛛在午夜也中立。
// 原版的「亮度」在夜間會下降 → `max(internalSky, block)` 才是原版的語意：
// 白天開闊地表（internalSky 15）→ 中立；午夜地表（4）→ 敵對；火把旁（block
// 13/14）→ 中立；洞穴（0）→ 敵對。與 B6 的 `canSpawnPassive`（客戶端天空光）
// ／`canSpawnHostile`（內部天空光）是同一套判準分工。
//
// **攀牆狀態機（計畫〈已查證與設計決策〉§6）**：
// 1. 只在 `chase`、著地、正前方那一格從腳底往上連續實心、且障礙頂面距腳底
//    ≤ `SPIDER_MAX_CLIMB`（3）時進入 `climb`；
// 2. `climb` 是**純垂直上升**，**不套重力、不跑落地掃描**（否則每幀會被吸附回
//    腳下的地面，永遠爬不上去）、也不做攻擊與水平移動；
// 3. 頭部格離開障礙柱 → 登頂：腳底對齊障礙頂面，並沿 `climbDir` **跨上頂面**
//    （只對齊 y 而中心仍停在牆外時，下一幀就會被前方探測擋住、掉回地面）；
// 4. 累積爬升 > 3 格仍未登頂 → 放棄（安全網；進入條件已保證 ≤ 3 格）。
//
// **兩個刻意簡化**：
// - **不做 `JUMP_IMPULSE` 自動上台階**（`mobs.ts` 有）：1 格台階在 `chase` 由
//   `climb` 處理（0.5 秒爬上）；`wander` 遇到障礙就停下。跳躍會讓「4 格牆完全
//   不上升」這條驗收斷言依賴取樣相位，而且蜘蛛的識別性行為是爬、不是跳。
// - **不白天燃燒**（不是不死系）→ 不進 B4 的 `stepSunBurn`（它只認
//   `zombie`／`skeleton`）。

export const SPIDER_HP = 16;
/** 碰撞盒寬（X/Z）1.4、高 0.9（原版 Spider 的尺寸）。 */
export const SPIDER_WIDTH = 1.4;
export const SPIDER_HEIGHT = 0.9;
/** 4.0 格/秒：原版速度屬性 0.3 ÷ 殭屍 0.23 × 本作殭屍 3.2 ≈ 4.17 → 取 4.0。 */
export const SPIDER_CHASE_SPEED = 4.0;
export const SPIDER_WANDER_SPEED = 1.5;
/** 原版攻擊 2（Normal，無裝甲）。 */
export const SPIDER_ATTACK_DAMAGE = 2;
/** 原版攻擊冷卻 1 秒。 */
export const SPIDER_ATTACK_COOLDOWN = 1.0;
/** 近戰距離：與殭屍相同（3D，可咬到站在矮台上的玩家）。 */
export const SPIDER_ATTACK_RANGE = 1.6;
/** **敵對門檻**：亮度 ≤ 11 → 敵對、≥ 12 → 中立（原版值）。 */
export const SPIDER_HOSTILE_LIGHT_MAX = 11;
/** 察覺距離 16 格（原版：可隔牆察覺）。 */
export const SPIDER_DETECT_RANGE = 16;
/** 攀爬速度 2.0 格/秒（本作值：1.5 秒爬 3 格，讓玩家有反應時間）。 */
export const SPIDER_CLIMB_SPEED = 2.0;
/** 單次攀爬上限：障礙頂面 − 腳底 ≤ 3 格（本作自訂；原版可一路爬到牆頂）。 */
export const SPIDER_MAX_CLIMB = 3;

/** 眼睛高度（咬擊視線用）：蜘蛛只有 0.9 高 → 取身體中段。 */
const SPIDER_EYE_HEIGHT = SPIDER_HEIGHT / 2;
/** 前方探測的基礎距離；`mobs.ts` 的 `PROBE_LEAD` 是私有常數 → 照抄同值，並用
 *  身體半寬補足探測點到身體前端的距離（與 `stepMob` 同一條公式）。 */
const PROBE_LEAD = 0.3;

export type SpiderState = 'wander' | 'chase' | 'climb';

export interface Spider {
  id: number;
  hp: number;
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  state: SpiderState;
  /** 被玩家攻擊過 → 不再因亮度中立（原版：被打後不論亮度都追擊）。 */
  angry: boolean;
  /** 咬擊冷卻剩餘秒數（計畫的介面清單漏了這一欄；攻擊測試需要它）。 */
  attackCooldown: number;
  wanderDir: number;
  wanderTimer: number;
  target: { x: number; y: number; z: number } | null;
  kbVel: { x: number; z: number };
  /** 本次攀爬已上升的距離（安全網與渲染用）。 */
  climbHeight: number;
  /** 攀爬時貼牆的水平法線（**指向牆面**）。 */
  climbDir: { x: number; z: number };
}

export interface SpiderCtx {
  playerPos: { x: number; y: number; z: number };
  isSolidAt: (x: number, y: number, z: number) => boolean;
  hasLineOfSight: (
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
  ) => boolean;
  /** B6 的 `lighting.spawnLightAt`（內部天空光 ＋ 方塊光）。 */
  lightAt: (x: number, y: number, z: number) => SpawnLight;
  dt: number;
  rng?: () => number;
}

export type SpiderEvent = {
  type: 'damage';
  target: 'player';
  amount: number;
  spiderId: number;
};

/** 模組層級遞增 id（比照 `mobs.ts` 的 `nextMobId`）。 */
let nextSpiderId = 1;

export function createSpider(
  pos: { x: number; y: number; z: number },
  rng: () => number = Math.random,
): Spider {
  return {
    id: nextSpiderId++,
    hp: SPIDER_HP,
    pos: { x: pos.x, y: pos.y, z: pos.z },
    vel: { x: 0, y: 0, z: 0 },
    state: 'wander',
    angry: false,
    attackCooldown: 0,
    // 0..2π：讓漫遊方向分佈在整圈（只乘 rng() 會落在 0..1 弧度的窄扇形）。
    wanderDir: rng() * Math.PI * 2,
    wanderTimer: WANDER_TURN_MIN + rng() * (WANDER_TURN_MAX - WANDER_TURN_MIN),
    target: null,
    kbVel: { x: 0, z: 0 },
    climbHeight: 0,
    climbDir: { x: 0, z: 0 },
  };
}

/** 中立判準：`max(內部天空光, 方塊光) <= 11` → 敵對。
 *
 *  **未知不是暗**（B6／B3 公約）：`spawnLightAt` 對還沒點光的區塊回
 *  `{sky:0, internalSky:0, block:0, lit:false}`——照數值讀會是「全黑 → 敵對」，
 *  白天的蜘蛛也會撲人。`lit:false` 一律回中立（與 `canSpawnHostile` 的第一道
 *  閘門同一個理由）。 */
export function spiderAggression(light: SpawnLight): 'hostile' | 'neutral' {
  if (!light.lit) return 'neutral';
  return Math.max(light.internalSky, light.block) <= SPIDER_HOSTILE_LIGHT_MAX
    ? 'hostile'
    : 'neutral';
}

/** 一步 AI ＋ 物理（回傳新物件與事件，不改輸入）。 */
export function stepSpider(
  s: Spider,
  ctx: SpiderCtx,
): { spider: Spider; events: SpiderEvent[] } {
  const step = Number.isFinite(ctx.dt) && ctx.dt > 0 ? ctx.dt : 0;
  const events: SpiderEvent[] = [];
  const pos = { x: s.pos.x, y: s.pos.y, z: s.pos.z };
  const vel = { x: s.vel.x, y: s.vel.y, z: s.vel.z };
  const kbVel = { x: s.kbVel.x, z: s.kbVel.z };
  let state: SpiderState = s.state;
  let attackCooldown = Math.max(0, s.attackCooldown - step);
  let wanderDir = s.wanderDir;
  let wanderTimer = s.wanderTimer - step;
  let climbHeight = s.climbHeight;
  const climbDir = { x: s.climbDir.x, z: s.climbDir.z };
  const rng = ctx.rng ?? Math.random;

  const p = ctx.playerPos;
  const dx = p.x - pos.x;
  const dz = p.z - pos.z;
  const distXZ = Math.hypot(dx, dz);
  const dist3D = Math.hypot(dx, p.y - pos.y, dz);

  const light = ctx.lightAt(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
  const hostile = s.angry || spiderAggression(light) === 'hostile';

  const finish = (): { spider: Spider; events: SpiderEvent[] } => ({
    spider: {
      ...s,
      pos,
      vel,
      state,
      attackCooldown,
      wanderDir,
      wanderTimer,
      target: state === 'wander' ? null : { x: p.x, y: p.y, z: p.z },
      kbVel,
      climbHeight,
      climbDir,
    },
    events,
  });

  // ---- 攀爬分支：純垂直上升；跳過重力、著地、擊退、攻擊 ----
  if (state === 'climb') {
    // 先檢查頭部是否已離開障礙柱（要在上升**之前**判斷：1 格台階在進入
    // climb 的第一幀頭部就已經在柱外，若先上升再判斷會多跳一格）。
    const colX = Math.floor(pos.x + climbDir.x * (SPIDER_WIDTH / 2 + 0.35));
    const colZ = Math.floor(pos.z + climbDir.z * (SPIDER_WIDTH / 2 + 0.35));
    const headY = Math.floor(pos.y + SPIDER_HEIGHT + 0.1);
    if (!ctx.isSolidAt(colX, headY, colZ)) {
      // 登頂：腳底對齊障礙頂面，並沿 climbDir 跨上頂面（見檔頭第 3 點）。
      pos.y = Math.floor(pos.y + SPIDER_HEIGHT) + 1;
      pos.x += climbDir.x * (SPIDER_WIDTH / 2 + 0.05);
      pos.z += climbDir.z * (SPIDER_WIDTH / 2 + 0.05);
      state = 'chase';
      climbHeight = 0;
      vel.x = 0;
      vel.y = 0;
      vel.z = 0;
    } else {
      pos.y += SPIDER_CLIMB_SPEED * step;
      climbHeight += SPIDER_CLIMB_SPEED * step;
      if (climbHeight > SPIDER_MAX_CLIMB) {
        // 安全網：正常情況下進入條件已保證障礙 ≤ 3 格。
        state = 'chase';
        climbHeight = 0;
      }
    }
    return finish();
  }

  // ---- 狀態機（追擊／漫遊；可隔牆察覺 → 不看視線）----
  state = hostile && distXZ <= SPIDER_DETECT_RANGE ? 'chase' : 'wander';

  // ---- 期望水平速度 ----
  let desX = 0;
  let desZ = 0;
  if (state === 'chase' && distXZ > 0) {
    desX = (dx / distXZ) * SPIDER_CHASE_SPEED;
    desZ = (dz / distXZ) * SPIDER_CHASE_SPEED;
  } else if (state === 'wander') {
    if (wanderTimer <= 0) {
      wanderDir = rng() * Math.PI * 2;
      wanderTimer = WANDER_TURN_MIN + rng() * (WANDER_TURN_MAX - WANDER_TURN_MIN);
    }
    desX = Math.sin(wanderDir) * SPIDER_WANDER_SPEED;
    desZ = Math.cos(wanderDir) * SPIDER_WANDER_SPEED;
  }

  const cx = Math.floor(pos.x);
  const cz = Math.floor(pos.z);
  const grounded = ctx.isSolidAt(cx, Math.floor(pos.y - 0.05), cz);

  // ---- 前方探測＋攀爬判定 ----
  let blocked = false;
  let enteringClimb = false;
  const hSpeed = Math.hypot(desX, desZ);
  if (hSpeed > 0) {
    const lead = hSpeed * step + Math.max(PROBE_LEAD, SPIDER_WIDTH / 2);
    const nx = Math.floor(pos.x + (desX / hSpeed) * lead);
    const nz = Math.floor(pos.z + (desZ / hSpeed) * lead);
    const feetBlocked = ctx.isSolidAt(nx, Math.floor(pos.y + 0.1), nz);
    const headBlocked = ctx.isSolidAt(nx, Math.floor(pos.y + SPIDER_HEIGHT - 0.2), nz);
    blocked = feetBlocked || headBlocked;

    if (feetBlocked && state === 'chase' && grounded) {
      // 障礙頂面：從腳底那一格起往上 4 格（SPIDER_MAX_CLIMB + 1）有界掃描。
      // 4 格全實心 → 比 3 格還高 → 不可爬；否則第一個非實心格就是頂面。
      const base = Math.floor(pos.y);
      let topY = -1;
      for (let y = base; y <= base + SPIDER_MAX_CLIMB; y++) {
        if (!ctx.isSolidAt(nx, y, nz)) {
          topY = y;
          break;
        }
      }
      if (topY > 0 && topY - pos.y <= SPIDER_MAX_CLIMB) {
        state = 'climb';
        enteringClimb = true;
        // 貼齊牆面：中心與障礙柱的**近面**距離 = 半寬（身體前端剛好碰到牆）。
        // 只沿主軸貼齊（斜向移動時取較大的分量），避免把身體塞進側面的方塊。
        if (Math.abs(desX) >= Math.abs(desZ)) {
          const halfW = SPIDER_WIDTH / 2;
          pos.x = nx + 0.5 - Math.sign(desX) * (0.5 + halfW);
        } else {
          const halfW = SPIDER_WIDTH / 2;
          pos.z = nz + 0.5 - Math.sign(desZ) * (0.5 + halfW);
        }
        climbDir.x = desX / hSpeed;
        climbDir.z = desZ / hSpeed;
        climbHeight = 0;
        vel.x = 0;
        vel.z = 0;
        vel.y = 0;
      }
    }

    if (blocked && !enteringClimb) {
      desX = 0;
      desZ = 0;
    }
  }
  if (enteringClimb) {
    // 本幀不移動（攀爬從下一幀開始）；也不做重力／落地／擊退。
    return finish();
  }

  // ---- 攻擊（僅追擊；咬擊要視線）----
  if (state === 'chase') {
    const from = { x: pos.x, y: pos.y + SPIDER_EYE_HEIGHT, z: pos.z };
    const to = { x: p.x, y: p.y + SPIDER_EYE_HEIGHT, z: p.z };
    if (
      dist3D <= SPIDER_ATTACK_RANGE &&
      attackCooldown <= 0 &&
      ctx.hasLineOfSight(from, to)
    ) {
      events.push({
        type: 'damage',
        target: 'player',
        amount: SPIDER_ATTACK_DAMAGE,
        spiderId: s.id,
      });
      attackCooldown = SPIDER_ATTACK_COOLDOWN;
    }
  }

  // ---- 重力（比照 mobs.ts；沒有自動上台階，見檔頭）----
  if (grounded && vel.y <= 0) vel.y = 0;
  else vel.y -= MOB_GRAVITY * step;

  vel.x = desX;
  vel.z = desZ;

  // ---- 擊退（與 mobs.ts 同規則：衰減 0.1^dt、低於 0.1 歸零、撞牆不嵌入）----
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

  // ---- 積分與落地掃描 ----
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

  return finish();
}

/** 步進整批蜘蛛（回傳新陣列；事件串接）。 */
export function stepSpiders(
  list: readonly Spider[],
  ctx: SpiderCtx,
): { spiders: Spider[]; events: SpiderEvent[] } {
  const spiders: Spider[] = [];
  const events: SpiderEvent[] = [];
  for (const s of list) {
    const r = stepSpider(s, ctx);
    spiders.push(r.spider);
    events.push(...r.events);
  }
  return { spiders, events };
}

/** 扣血（hp 夾在 0；非有限／非正傷害是 no-op）→ **一定變成 angry**。
 *  `from`（任意水平向量，通常傳玩家的視線方向）→ 沿該方向加
 *  `KNOCKBACK_SPEED` 的擊退（與 `mobs.ts` 的 `damageMob` 同一套正常化寫法）。 */
export function damageSpider(
  s: Spider,
  dmg: number,
  from?: { x: number; z: number },
  opts: { angry?: boolean } = {},
): Spider {
  const valid = Number.isFinite(dmg) && dmg > 0;
  const hp = valid ? Math.max(0, s.hp - dmg) : s.hp;
  const kbVel = { x: s.kbVel.x, z: s.kbVel.z };
  if (from) {
    const len = Math.hypot(from.x, from.z);
    if (Number.isFinite(len) && len > 0) {
      kbVel.x += (from.x / len) * KNOCKBACK_SPEED;
      kbVel.z += (from.z / len) * KNOCKBACK_SPEED;
    }
  }
  // 即使傷害無效（<= 0／NaN），被「攻擊」仍然會激怒（與原版一致）。
  // B9 修正：`opts.angry === false` 給**爆炸**用——原版只有玩家（或寵物狼）傷害
  // 才會激怒蜘蛛，苦力怕爆炸不是玩家攻擊；否則被炸到的蜘蛛會永久敵對、連白天
  // 都追人，與 README 的「亮處／白天中立（被攻擊後才不論亮度）」矛盾。
  return { ...s, hp, angry: opts.angry ?? true, kbVel };
}

export function isSpiderDead(s: Spider): boolean {
  return s.hp <= 0;
}

/** 準心命中的蜘蛛 id（最近的一隻，`t ≤ reach`）；沒有 → null。
 *  命中盒＝X/Z ± `SPIDER_WIDTH/2`、Y 從腳到 `SPIDER_HEIGHT`。 */
export function hitSpiderId(
  spiders: readonly Spider[],
  eye: { x: number; y: number; z: number },
  lookDir: { x: number; y: number; z: number },
  reach: number,
): number | null {
  let bestId: number | null = null;
  let bestT = Infinity;
  for (const s of spiders) {
    const t = rayAabbEntry(
      eye,
      lookDir,
      {
        x: s.pos.x - SPIDER_WIDTH / 2,
        y: s.pos.y,
        z: s.pos.z - SPIDER_WIDTH / 2,
      },
      {
        x: s.pos.x + SPIDER_WIDTH / 2,
        y: s.pos.y + SPIDER_HEIGHT,
        z: s.pos.z + SPIDER_WIDTH / 2,
      },
    );
    if (t !== null && t <= reach && t < bestT) {
      bestT = t;
      bestId = s.id;
    }
  }
  return bestId;
}

/** 玩家近戰攻擊：命中 → 扣血＋擊退＋激怒，回傳新陣列與命中 id。 */
export function attackSpider(
  spiders: readonly Spider[],
  eye: { x: number; y: number; z: number },
  lookDir: { x: number; y: number; z: number },
  reach: number,
  damage: number,
  knockDir: { x: number; z: number },
): { spiders: Spider[]; hitId: number | null } {
  const hitId = hitSpiderId(spiders, eye, lookDir, reach);
  if (hitId === null) return { spiders: [...spiders], hitId: null };
  return {
    spiders: spiders.map((s) =>
      s.id === hitId ? damageSpider(s, damage, knockDir) : s,
    ),
    hitId,
  };
}
