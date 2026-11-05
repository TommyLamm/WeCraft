/** 農業純邏輯（B13）：小麥階段換算、鋤地／播種／骨粉規則、耕地濕潤判定、
 *  批次成長與收成。不碰 DOM／Three／計時器——main.ts 只負責每 5 秒餵一次
 *  `growWheatBatch` 並套用回傳的方塊更新。
 *
 *  規則出處與明示簡化（README〈與原版的差異〉）：小麥 4 階段、光照 ≥9、
 *  濕潤 25%／乾燥 10%（原版是隨機 tick；本作每 5 秒一批）、骨粉一次 +2、
 *  耕地滿格且無濕潤貼圖、無踩踏退化。 */

import { BLOCK, type BlockId } from './blocks';
import type { ItemId } from '../core/items';

/** 小麥階段數（0..3；3 = 成熟）。 */
export const WHEAT_STAGES = 4;
/** 成長批次間隔（秒）：本作以固定 5 秒取代原版隨機 tick。 */
export const WHEAT_GROWTH_INTERVAL_SEC = 5;
/** 每批最多推進的株數（效能護欄；超過由游標輪替）。 */
export const WHEAT_MAX_GROWTH_PER_TICK = 64;
/** 濕潤耕地上每一株的成長機率。 */
export const WHEAT_WET_GROWTH_CHANCE = 0.25;
/** 乾燥耕地上每一株的成長機率。 */
export const WHEAT_DRY_GROWTH_CHANCE = 0.1;
/** 成長所需的最低光照（內部天空光或方塊光的大者）。 */
export const WHEAT_MIN_LIGHT = 9;
/** 水源的水平偵測半徑（垂直 ±1）。 */
export const FARMLAND_WATER_RADIUS = 4;
/** 成熟小麥一次最多掉落的種子數（0..3）。 */
export const WHEAT_SEED_MAX = 3;
/** 短草掉落小麥種子的機率（原版 12.5%）。 */
export const SHORT_GRASS_SEED_CHANCE = 0.125;

/** 五種鋤的物品 id（右鍵泥土／草地墾地）。 */
export const HOE_ITEM_IDS: readonly ItemId[] = [
  'wooden_hoe', 'stone_hoe', 'iron_hoe', 'golden_hoe', 'diamond_hoe',
];

export function isHoeItem(item: ItemId | null): boolean {
  return item !== null && HOE_ITEM_IDS.includes(item);
}

/** 方塊 id → 小麥階段 0..3；不是小麥（含空氣）→ null。 */
export function wheatStageOf(blockId: number): number | null {
  if (blockId < BLOCK.WHEAT_0 || blockId > BLOCK.WHEAT_3) return null;
  return blockId - BLOCK.WHEAT_0;
}

/** 階段 → 方塊 id：非有限值當 0、超出範圍夾到 0..3（NaN 不會做出非法 id）。 */
export function wheatBlockForStage(stage: number): BlockId {
  const n = Number.isFinite(stage) ? Math.floor(stage) : 0;
  const clamped = Math.min(WHEAT_STAGES - 1, Math.max(0, n));
  return (BLOCK.WHEAT_0 + clamped) as BlockId;
}

export function isWheatBlock(blockId: number): boolean {
  return wheatStageOf(blockId) !== null;
}

/** 耕地（x,y,z）是否被水潤濕：水平半徑 4 格、垂直 ±1 格內任一格是水。
 *  `getBlock` 由呼叫端注入（純函式、可單元測試；世界越界回空氣）。 */
export function wasFarmlandHydrated(
  getBlock: (x: number, y: number, z: number) => number,
  x: number,
  y: number,
  z: number,
): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -FARMLAND_WATER_RADIUS; dz <= FARMLAND_WATER_RADIUS; dz++) {
      for (let dx = -FARMLAND_WATER_RADIUS; dx <= FARMLAND_WATER_RADIUS; dx++) {
        if (getBlock(x + dx, y + dy, z + dz) === BLOCK.WATER) return true;
      }
    }
  }
  return false;
}

/** 能不能鋤地：手持鋤頭、目標是泥土／草地、上方是空氣。 */
export function canTill(held: ItemId | null, targetId: number, aboveId: number): boolean {
  if (!isHoeItem(held)) return false;
  if (targetId !== BLOCK.DIRT && targetId !== BLOCK.GRASS) return false;
  return aboveId === BLOCK.AIR;
}

/** 能不能播種：手持種子、目標是耕地、上方是空氣。 */
export function canPlantWheat(held: ItemId | null, targetId: number, aboveId: number): boolean {
  return held === 'wheat_seeds' && targetId === BLOCK.FARMLAND && aboveId === BLOCK.AIR;
}

/** 骨粉催熟：手持骨粉且目標是未成熟小麥 → 回傳 +2 階段（上限成熟）的方塊 id；
 *  其他情況（含成熟小麥）→ null（不消耗）。 */
export function boneMealWheat(held: ItemId | null, targetId: number): BlockId | null {
  if (held !== 'bone_meal') return null;
  const stage = wheatStageOf(targetId);
  if (stage === null || stage >= WHEAT_STAGES - 1) return null;
  return wheatBlockForStage(stage + 2);
}

/** 一批成長要套用的單格更新。 */
export interface WheatGrowthUpdate {
  x: number;
  y: number;
  z: number;
  from: BlockId;
  to: BlockId;
}

export interface WheatGrowthResult {
  updates: WheatGrowthUpdate[];
  /** 下一批的起始游標（讓超過 maxGrow 的株數輪替，不會永遠只長前幾株）。 */
  nextCursor: number;
}

export interface WheatGrowthOptions {
  /** `world.modified` 的快照（`"x,y,z"` → blockId）。 */
  entries: ReadonlyArray<readonly [string, number]>;
  getBlock: (x: number, y: number, z: number) => number;
  /** 該格光照（內部天空光或方塊光的大者）；< WHEAT_MIN_LIGHT 或 -1 不成長。 */
  lightAt: (x: number, y: number, z: number) => number;
  /** 可注入的隨機源（測試用）；預設 Math.random。 */
  rng?: () => number;
  /** 起始游標（上一次的 `nextCursor`）。 */
  cursor?: number;
  /** 本批最多推進幾株；預設 WHEAT_MAX_GROWTH_PER_TICK。 */
  maxGrow?: number;
}

const clampCursor = (cursor: number | undefined, len: number): number => {
  if (len <= 0) return 0;
  const n = Number.isFinite(cursor) ? Math.floor(cursor as number) : 0;
  return ((n % len) + len) % len;
};

/** 掃一批 `modified` 內的小麥，回傳要套用的階段更新。
 *
 *  每個候選格的條件（依序）：合法整數座標 → 是小麥且未成熟 → 下方是耕地 →
 *  光照 ≥ WHEAT_MIN_LIGHT → 擲一次 rng 通過濕潤（25%）／乾燥（10%）門檻。
 *  `maxGrow` 到達即停；`nextCursor` 指向下一個未掃到的項目。 */
export function growWheatBatch(opts: WheatGrowthOptions): WheatGrowthResult {
  const { entries, getBlock, lightAt } = opts;
  const rng = opts.rng ?? Math.random;
  const rawMax = opts.maxGrow ?? WHEAT_MAX_GROWTH_PER_TICK;
  const maxGrow = Number.isFinite(rawMax) && rawMax >= 0 ? Math.floor(rawMax) : WHEAT_MAX_GROWTH_PER_TICK;
  const len = entries.length;
  const start = clampCursor(opts.cursor, len);
  const updates: WheatGrowthUpdate[] = [];
  let scanned = 0;

  for (let n = 0; n < len && updates.length < maxGrow; n++) {
    const entry = entries[(start + n) % len];
    scanned = n + 1;
    if (!entry) continue;
    const parts = entry[0].split(',');
    if (parts.length !== 3) continue;
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const z = Number(parts[2]);
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) continue;
    const stage = wheatStageOf(entry[1]);
    if (stage === null || stage >= WHEAT_STAGES - 1) continue;
    if (getBlock(x, y - 1, z) !== BLOCK.FARMLAND) continue;
    const light = lightAt(x, y, z);
    if (!(light >= WHEAT_MIN_LIGHT)) continue;
    const wet = wasFarmlandHydrated(getBlock, x, y - 1, z);
    const r = rng();
    const roll = Number.isFinite(r) ? r : 1;
    if (roll >= (wet ? WHEAT_WET_GROWTH_CHANCE : WHEAT_DRY_GROWTH_CHANCE)) continue;
    updates.push({
      x,
      y,
      z,
      from: entry[1] as BlockId,
      to: wheatBlockForStage(stage + 1),
    });
  }

  return { updates, nextCursor: len > 0 ? (start + scanned) % len : 0 };
}

/** 小麥的收成內容（手動破壞用；爆炸只走 `dropItemFor` 的單一物品）。 */
export interface WheatHarvest {
  wheat: number;
  seeds: number;
}

/** 收成：成熟（stage ≥ 3）→ 1 wheat + 0..3 seeds；未成熟 → 0 wheat + 1 seed。
 *  非有限 stage 視為未成熟；非有限 rng 當 0（不誇大掉落）。 */
export function wheatHarvestFor(stage: number, rng: () => number = Math.random): WheatHarvest {
  const mature = Number.isFinite(stage) && Math.floor(stage) >= WHEAT_STAGES - 1;
  if (!mature) return { wheat: 0, seeds: 1 };
  const r = rng();
  const roll = Number.isFinite(r) ? Math.min(0.999999999, Math.max(0, r)) : 0;
  return { wheat: 1, seeds: Math.floor(roll * (WHEAT_SEED_MAX + 1)) };
}

/** 短草掉種子：12.5% 回 1，否則 0；非有限 rng → 0。 */
export function seedsFromShortGrass(rng: () => number = Math.random): number {
  const r = rng();
  return Number.isFinite(r) && r < SHORT_GRASS_SEED_CHANCE ? 1 : 0;
}
