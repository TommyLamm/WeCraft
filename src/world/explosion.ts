import type { ItemId } from '../core/items';
import { BLOCK, blastResistanceOf } from './blocks';
import { dropItemFor } from './drops';

// ---- 爆炸純邏輯（B9 Task 3）----
//
// 數值全部來自 Java 版（minecraft.wiki/Explosion，2026-10-20 查證）：
// - 傷害：impact = (1 - distance / (2·power)) · exposure；
//   damage = floor(((impact² + impact) / 2) · 7·(2·power) + 1)
//   → power 3、distance 0、exposure 1 得 43（與 Creeper 頁 infobox 的 Normal
//   43HP 雙向驗證）。
// - 擊退：magnitude = impact · knockbackMultiplier · (1 − 抗性)（每 tick 的
//   blocks/tick）× 20 → blocks/s；苦力怕的這兩個係數都是 1。
// - 破壞半徑 ≈ 4/3 × power；每 1 格空氣行進消耗 0.75 強度、每格方塊額外消耗
//   (blastResistance + 0.3) × 0.3。
// - 破壞方塊的掉落機率 1/power（苦力怕 = 1/3；原版 TNT 才是 100%，本作沒有 TNT）。
//
// **與原版的差異（README〈與原版的差異〉）**：
// 1. 原版用 16×16×16 = 256 條隨機方向的射線逐格消耗強度；本作改成「以爆炸中心
//    為心的球形候選 ＋ 逐格強度衰減（`power − 0.75·d`）」。保留原版的兩個可觀察
//    性質——半徑 ≈ 4/3·power、抗性越高越靠近核心才會碎——但**不再隨機**（原版每條
//    射線的強度是 power×0.7–1.3；本作取確定值 power）→ 同一位置每次結果相同，
//    測試可重現。
// 2. `isSolidAt` 會先濾掉非實心方塊（水、火把、花草）——不是靠抗性表，而是「爆炸
//    不破壞非實心方塊」這條本作規則；水另外有抗性 100 當第二道保險。
// 3. exposure 二值化（通視 1.0／遮蔽 0.4），原版是 27 個取樣點的連續值。

/** 原版苦力怕爆炸威力（minecraft.wiki/Creeper：power 3）。 */
export const CREEPER_EXPLOSION_POWER = 3;

/** 原版：破壞半徑 ≈ 4/3 × power（power 3 → 4 格）。 */
export const EXPLOSION_REACH_FACTOR = 4 / 3;

/** 原版：每 0.3 格空氣行進消耗 0.225 強度 ⇒ 每 1 格 0.75。
 *  本作把「沿射線行進」改寫成「與中心距離 d」的等效消耗。 */
export const EXPLOSION_AIR_COST = 0.75;

/** 原版：破壞一格方塊額外消耗 (blastResistance + 0.3) × 0.3。 */
export const EXPLOSION_RESISTANCE_FACTOR = 0.3;

/** 玩家垂直擊退的上限（格/秒）。原版最高可達 20 格/秒（1 block/tick）；
 *  本作壓到 8，避免一次爆炸把玩家直接彈出視野。水平擊退不設上限。 */
export const EXPLOSION_KNOCKBACK_MAX_Y = 8;

export interface ExplosionCtx {
  power: number;
  center: { x: number; y: number; z: number };
  blockIdAt: (x: number, y: number, z: number) => number;
  isSolidAt: (x: number, y: number, z: number) => boolean;
  rng?: () => number;
}

export interface DestroyedBlock {
  x: number;
  y: number;
  z: number;
  blockId: number;
}

export interface ExplosionDrop {
  item: ItemId;
  count: number;
  at: { x: number; y: number; z: number };
}

export interface ExplosionResult {
  destroyed: DestroyedBlock[];
  drops: ExplosionDrop[];
}

/** 暴露度（簡化為二值）：從爆炸中心到目標眼睛的線段沒有被實心方塊擋住 →
 *  1.0；被擋住 → 0.4（保守值，避免「躲在牆後仍吃滿傷」）。原版是 27 個取樣點
 *  的 0–1 連續值。 */
export function explosionExposure(hasLineOfSight: boolean): number {
  return hasLineOfSight ? 1 : 0.4;
}

/** 原版爆炸傷害（見檔頭公式）。非有限距離或超出 2×power → 0；2×power 內最少 1。 */
export function explosionDamage(power: number, distance: number, exposure: number): number {
  if (!Number.isFinite(distance) || !Number.isFinite(power) || power <= 0) return 0;
  if (!Number.isFinite(exposure)) return 0;
  const span = 2 * power;
  const d = Math.max(0, distance);
  if (d > span) return 0;
  const impact = Math.max(0, 1 - d / span) * exposure;
  return Math.floor(((impact * impact + impact) / 2) * 7 * span + 1);
}

/** 原版爆炸擊退（blocks/s）：impact × 20。非有限距離或超出 2×power → 0。 */
export function explosionKnockback(power: number, distance: number, exposure: number): number {
  if (!Number.isFinite(distance) || !Number.isFinite(power) || power <= 0) return 0;
  if (!Number.isFinite(exposure)) return 0;
  const span = 2 * power;
  const d = Math.max(0, distance);
  if (d > span) return 0;
  return Math.max(0, 1 - d / span) * exposure * 20;
}

/** 算出一次爆炸會破壞哪些方塊、以及每一格掉什麼（純函式；套用到世界由
 *  main.ts 的 `runExplosion` 負責）。
 *
 *  球形候選（半徑 power·4/3）＋ 逐格判定：
 *  1. 空氣不消耗也不被破壞；
 *  2. 非實心方塊（水／火把／花草）不被爆炸破壞（本作規則，見檔頭）；
 *  3. `intensity = power − 0.75·d`（d＝方塊中心到爆炸中心的距離）；
 *     `cost = (blastResistance + 0.3) × 0.3`；`intensity <= cost` → 這一格活下來。
 *  4. 掉落：每格以 1/power 機率掉 1 個 `dropItemFor(blockId)`（無工具門檻，
 *     等同原版的「無附魔鑽石鎬」）。
 */
export function explodeAt(ctx: ExplosionCtx): ExplosionResult {
  const power = ctx.power;
  if (!Number.isFinite(power) || power <= 0) return { destroyed: [], drops: [] };
  const reach = power * EXPLOSION_REACH_FACTOR;
  const r = Math.ceil(reach);
  const bx0 = Math.floor(ctx.center.x);
  const by0 = Math.floor(ctx.center.y);
  const bz0 = Math.floor(ctx.center.z);
  const destroyed: DestroyedBlock[] = [];

  for (let dy = -r; dy <= r; dy++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = bx0 + dx;
        const y = by0 + dy;
        const z = bz0 + dz;
        const id = ctx.blockIdAt(x, y, z);
        if (id === BLOCK.AIR) continue; // 空氣不消耗、也不被破壞
        if (!ctx.isSolidAt(x, y, z)) continue; // 水／火把等非實心方塊
        const cx = x + 0.5;
        const cy = y + 0.5;
        const cz = z + 0.5;
        const d = Math.hypot(cx - ctx.center.x, cy - ctx.center.y, cz - ctx.center.z);
        if (d > reach) continue;
        const resistance = blastResistanceOf(id);
        const intensity = power - EXPLOSION_AIR_COST * d; // 走到這裡還剩多少爆力
        const cost = (resistance + 0.3) * EXPLOSION_RESISTANCE_FACTOR; // 破壞這一格要花多少
        if (intensity <= cost) continue; // 爆力不夠 → 這一格活下來
        destroyed.push({ x, y, z, blockId: id });
      }
    }
  }

  // 掉落：每格 1/power 機率（power 3 → 1/3），掉落物 = dropItemFor。
  const drops: ExplosionDrop[] = [];
  const rng = ctx.rng ?? Math.random;
  for (const b of destroyed) {
    if (rng() >= 1 / power) continue;
    const item = dropItemFor(b.blockId);
    if (!item) continue;
    drops.push({ item, count: 1, at: { x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 } });
  }
  return { destroyed, drops };
}
