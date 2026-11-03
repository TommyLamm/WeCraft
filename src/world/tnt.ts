import { MOB_GRAVITY } from './mobs';

// ---- 引信 TNT 純邏輯（B11 Task 4）----
//
// 數值全部來自 Java 版（minecraft.wiki/TNT，2026-11-03 查證）：
// - 碰撞盒 0.98 × 0.98、受重力、引信 80 tick ＝ **4 秒**；
// - 起爆瞬間的初始速度：向上 0.2 格/tick（＝**4 格/秒**）＋隨機方向 0.02 格/tick
//   （＝**0.4 格/秒**）；
// - 爆炸威力 **4**、爆炸中心在實體位置上方 **0.06125 格**；
// - 被其他爆炸波及的 TNT：隨機 10–30 tick（**0.5–1.5 秒**）後引爆；
// - 外觀每 **0.5 秒**在正常貼圖與接近全白的亮版之間切換。
//
// **與原版的差異（README〈與原版的差異〉）**：
// 1. 重力用本作生物的 `MOB_GRAVITY = 32`（原版約 16）——本作整體的實體物理尺度。
// 2. 水平初速只在起爆瞬間給一次，落地後歸零（不做原版的逐 tick 空氣阻力）。
// 3. 連鎖引爆上限 `MAX_PRIMED_TNT = 32`（本作自訂，防單幀爆炸風暴；超出上限的
//    TNT 格不誘爆，改走正常掉落——呼叫端負責）。
// 4. 引信實體**不跨存檔**（與敵對生物同級）：儲存並離開時未爆的 TNT 消失。

/** 原版 primed TNT 的碰撞盒：0.98 × 0.98（minecraft.wiki/TNT infobox）。 */
export const TNT_WIDTH = 0.98;
export const TNT_HEIGHT = 0.98;

/** 引信 80 tick ＝ 4 秒（原版 `fuse` 預設 80）。 */
export const TNT_FUSE_SEC = 4;

/** 被爆炸波及的 TNT 引信：隨機 10–30 tick（0.5–1.5 秒）。 */
export const TNT_CHAIN_FUSE_MIN_SEC = 0.5;
export const TNT_CHAIN_FUSE_MAX_SEC = 1.5;

/** 原版 TNT 爆炸威力 4（minecraft.wiki/TNT：「power of 4」）。 */
export const TNT_EXPLOSION_POWER = 4;

/** 起爆瞬間的初始速度（格/秒）：+0.2 格/tick 向上、0.02 格/tick 隨機水平。 */
export const TNT_LAUNCH_UP = 4;
export const TNT_LAUNCH_SIDE = 0.4;

/** 重力沿用本作生物尺度（原版約 16——已揭露的簡化）。 */
export const TNT_GRAVITY = MOB_GRAVITY;

/** 原版爆炸中心＝實體位置上方 0.98/16 ＝ 0.06125 格。 */
export const TNT_EXPLOSION_Y_OFFSET = 0.06125;

/** 貼圖閃爍半週期：每 0.5 秒切換一次。 */
export const TNT_BLINK_SEC = 0.5;

/** 同時存在的引信 TNT 上限（本作自訂，防連鎖爆炸風暴）。 */
export const MAX_PRIMED_TNT = 32;

export interface PrimedTnt {
  id: number;
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  /** 引信剩餘秒數；<= 0 的那一步爆炸並從清單移除。 */
  fuse: number;
  /** 引信總長（渲染閃爍相位用；與 creeper 的 `fuseTotal` 同一語意）。 */
  fuseTotal: number;
}

export interface TntCtx {
  isSolidAt: (x: number, y: number, z: number) => boolean;
  dt: number;
}

export type TntEvent = {
  type: 'explode';
  tntId: number;
  /** 爆炸中心＝實體位置 +0.06125（原版）。 */
  at: { x: number; y: number; z: number };
};

/** 模組層級遞增 id（比照 mobs.ts／creeper.ts）。 */
let nextTntId = 1;

/** 建立一顆引信 TNT。`fuse` 覆寫用於連鎖引爆（0.5–1.5 秒）；`rng` 只用來抽
 *  起爆的水平方向（呼叫端傳固定值即可得到可重現的速度）。 */
export function createPrimedTnt(
  pos: { x: number; y: number; z: number },
  opts: { fuse?: number; rng?: () => number } = {},
): PrimedTnt {
  const rng = opts.rng ?? Math.random;
  const fuse = Number.isFinite(opts.fuse) && (opts.fuse as number) > 0 ? (opts.fuse as number) : TNT_FUSE_SEC;
  const angle = rng() * Math.PI * 2;
  return {
    id: nextTntId++,
    pos: { x: pos.x, y: pos.y, z: pos.z },
    vel: {
      x: Math.sin(angle) * TNT_LAUNCH_SIDE,
      y: TNT_LAUNCH_UP,
      z: Math.cos(angle) * TNT_LAUNCH_SIDE,
    },
    fuse,
    fuseTotal: fuse,
  };
}

/** 把一次爆炸波及的 TNT 方塊轉成新的引信實體（隨機 0.5–1.5 秒）。
 *  依 `positions` 順序逐顆建立，總數達到 `cap`（預設 `MAX_PRIMED_TNT`）即停；
 *  `primedCount` 回報前幾顆成功——呼叫端用它決定哪些格位不該掉道具。 */
export function primeTntChain(
  list: readonly PrimedTnt[],
  positions: ReadonlyArray<{ x: number; y: number; z: number }>,
  opts: { rng?: () => number; cap?: number } = {},
): { tnts: PrimedTnt[]; primedCount: number } {
  const rng = opts.rng ?? Math.random;
  const cap = Number.isFinite(opts.cap) ? Math.max(0, Math.floor(opts.cap as number)) : MAX_PRIMED_TNT;
  const tnts = [...list];
  let primedCount = 0;
  for (const pos of positions) {
    if (tnts.length >= cap) break;
    const fuse = TNT_CHAIN_FUSE_MIN_SEC + rng() * (TNT_CHAIN_FUSE_MAX_SEC - TNT_CHAIN_FUSE_MIN_SEC);
    tnts.push(createPrimedTnt(pos, { fuse, rng }));
    primedCount++;
  }
  return { tnts, primedCount };
}

/** 一步物理＋引信（回傳新陣列與事件；爆炸的實體直接從清單移除，事件恰一次）。
 *
 *  順序：NaN dt → 每顆先扣引信 → 到期爆炸（不進回傳清單）→ 重力 → 逐軸碰撞
 *  （撞牆停該軸、落地掃描不穿地板）→ 落地後水平速度歸零。 */
export function stepPrimedTnts(
  list: readonly PrimedTnt[],
  ctx: TntCtx,
): { tnts: PrimedTnt[]; events: TntEvent[] } {
  const step = Number.isFinite(ctx.dt) ? Math.max(0, ctx.dt) : 0;
  const tnts: PrimedTnt[] = [];
  const events: TntEvent[] = [];

  for (const t of list) {
    const fuse = Math.max(0, t.fuse - step);
    if (fuse <= 0) {
      events.push({
        type: 'explode',
        tntId: t.id,
        at: { x: t.pos.x, y: t.pos.y + TNT_EXPLOSION_Y_OFFSET, z: t.pos.z },
      });
      continue; // 爆炸的實體不進回傳清單（呼叫端不必再過濾）
    }

    const pos = { ...t.pos };
    const vel = { ...t.vel };

    // 重力與垂直積分＋落地掃描（比照 creeper.ts：從上一格往下掃，不穿地板）。
    vel.y -= TNT_GRAVITY * step;
    const prevY = pos.y;
    pos.y += vel.y * step;
    let landed = false;
    if (vel.y <= 0) {
      const from = Math.floor(prevY - 0.05);
      const to = Math.floor(pos.y - 0.05);
      for (let cy = from; cy >= to; cy--) {
        if (!ctx.isSolidAt(Math.floor(pos.x), cy, Math.floor(pos.z))) continue;
        pos.y = cy + 1;
        vel.y = 0;
        landed = true;
        break;
      }
    }

    // 水平：逐軸判定（撞牆停該軸，不嵌入）。
    const nextX = pos.x + vel.x * step;
    if (!ctx.isSolidAt(Math.floor(nextX), Math.floor(pos.y), Math.floor(pos.z))) pos.x = nextX;
    const nextZ = pos.z + vel.z * step;
    if (!ctx.isSolidAt(Math.floor(pos.x), Math.floor(pos.y), Math.floor(nextZ))) pos.z = nextZ;

    // 落地後水平速度歸零（已揭露的簡化：不做原版的逐 tick 空氣阻力）。
    if (landed || (vel.y === 0 && ctx.isSolidAt(Math.floor(pos.x), Math.floor(pos.y - 0.05), Math.floor(pos.z)))) {
      vel.x = 0;
      vel.z = 0;
    }

    tnts.push({ id: t.id, pos, vel, fuse, fuseTotal: t.fuseTotal });
  }

  return { tnts, events };
}

/** 閃爍相位：每 0.5 秒切換一次，起爆瞬間為暗版（原版外觀行為）。 */
export function tntBlinkBright(t: PrimedTnt): boolean {
  if (!Number.isFinite(t.fuseTotal) || t.fuseTotal <= 0) return false;
  const elapsed = t.fuseTotal - t.fuse;
  return Math.floor(elapsed / TNT_BLINK_SEC) % 2 === 1;
}
