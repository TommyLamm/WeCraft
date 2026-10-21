export const BLOCK = {
  AIR: 0,
  STONE: 1,
  DIRT: 2,
  GRASS: 3,
  SAND: 4,
  LOG: 5,
  LEAVES: 6,
  PLANKS: 7,
  COBBLE: 8,
  WATER: 9,
  BEDROCK: 10,
  SNOW: 11,
  GLASS: 12,
  COAL_ORE: 13,
  IRON_ORE: 14,
  CRAFTING_TABLE: 15,
  FURNACE: 16,
  // B3 Task 3：三樹種（橡木／雲杉／白樺）。id 只能往後追加——舊存檔的
  // `modified` 記的是數字 id，重編號會讓舊存檔的方塊全部變形。
  SPRUCE_LOG: 17,
  SPRUCE_LEAVES: 18,
  BIRCH_LOG: 19,
  BIRCH_LEAVES: 20,
} as const;

export type BlockId = (typeof BLOCK)[keyof typeof BLOCK];

/** Tool families. Only pickaxe/axe exist as items today (`ItemId` has no
 *  shovel), so shovel-fast blocks currently mine at bare-hand speed. */
export type ToolKind = 'pickaxe' | 'axe' | 'shovel';

export interface BlockDef {
  id: BlockId;
  name: string;
  hardness: number; // 原版硬度；破壞秒數＝硬度 ×1.5/×5 ÷ 工具速度（interact.ts）。Infinity = 不可破壞
  solid: boolean;
  transparent: boolean;
  top: number; // 圖集 tile 索引 0..63
  side: number;
  bottom: number;
  /** Harvest gate (Task 5): the tool kind + minimum tier needed to harvest
   *  this block. `null` = no requirement (harvestable bare-handed). */
  requiredTool: { kind: ToolKind; level: number } | null;
  /** Kind that mines this block faster (`interact.ts` `toolSpeed`); `null` =
   *  no fast tool. Never a gate — the block breaks either way. */
  fastTool: ToolKind | null;
}

const T = {
  GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3,
  SAND: 4, LOG_SIDE: 5, LOG_TOP: 6, LEAVES: 7,
  PLANKS: 8, COBBLE: 9, WATER: 10, BEDROCK: 11,
  SNOW_TOP: 12, SNOW_SIDE: 13, GLASS: 14,
  COAL: 15, IRON: 16,
  CRAFTING_TOP: 17, CRAFTING_SIDE: 18,
  FURNACE_TOP: 19, FURNACE_SIDE: 20,
  // B3 Task 3：雲杉／白樺的六個 tile（跨批編號：B3 用 21–26）
  SPRUCE_LOG_SIDE: 21, SPRUCE_LOG_TOP: 22, SPRUCE_LEAVES: 23,
  BIRCH_LOG_SIDE: 24, BIRCH_LOG_TOP: 25, BIRCH_LEAVES: 26,
} as const;

/** Tiles `T` defines (0..TILE_COUNT-1) — `BIRCH_LEAVES` is the highest tile.
 *  drawAtlas paints exactly these; the texture array fills every layer past
 *  them with the magenta debug color, so adding a tile to T without drawing it
 *  fails loudly instead of silently sampling magenta in-game. */
export const TILE_COUNT = T.BIRCH_LEAVES + 1;

/** Block registry (Task 5): vanilla hardness (MC Java 1.20+) plus, per block,
 *  the harvest gate (`requiredTool`) and the fast kind (`fastTool`) that feeds
 *  `interact.ts`'s break-time formula. The derived seconds live only in
 *  `interact.ts` — hardness here is the raw vanilla number, not a duration. */
const DEFS: Record<number, BlockDef> = {
  0: { id: 0, name: 'air', hardness: 0, solid: false, transparent: true, top: 0, side: 0, bottom: 0, requiredTool: null, fastTool: null },
  1: { id: 1, name: 'stone', hardness: 1.5, solid: true, transparent: false, top: T.STONE, side: T.STONE, bottom: T.STONE, requiredTool: { kind: 'pickaxe', level: 0 }, fastTool: 'pickaxe' },
  2: { id: 2, name: 'dirt', hardness: 0.5, solid: true, transparent: false, top: T.DIRT, side: T.DIRT, bottom: T.DIRT, requiredTool: null, fastTool: 'shovel' },
  3: { id: 3, name: 'grass_block', hardness: 0.6, solid: true, transparent: false, top: T.GRASS_TOP, side: T.GRASS_SIDE, bottom: T.DIRT, requiredTool: null, fastTool: 'shovel' },
  4: { id: 4, name: 'sand', hardness: 0.5, solid: true, transparent: false, top: T.SAND, side: T.SAND, bottom: T.SAND, requiredTool: null, fastTool: 'shovel' },
  5: { id: 5, name: 'oak_log', hardness: 2.0, solid: true, transparent: false, top: T.LOG_TOP, side: T.LOG_SIDE, bottom: T.LOG_TOP, requiredTool: null, fastTool: 'axe' },
  6: { id: 6, name: 'oak_leaves', hardness: 0.2, solid: true, transparent: true, top: T.LEAVES, side: T.LEAVES, bottom: T.LEAVES, requiredTool: null, fastTool: null },
  7: { id: 7, name: 'oak_planks', hardness: 2.0, solid: true, transparent: false, top: T.PLANKS, side: T.PLANKS, bottom: T.PLANKS, requiredTool: null, fastTool: 'axe' },
  8: { id: 8, name: 'cobblestone', hardness: 2.0, solid: true, transparent: false, top: T.COBBLE, side: T.COBBLE, bottom: T.COBBLE, requiredTool: { kind: 'pickaxe', level: 0 }, fastTool: 'pickaxe' },
  9: { id: 9, name: 'water', hardness: Infinity, solid: false, transparent: true, top: T.WATER, side: T.WATER, bottom: T.WATER, requiredTool: null, fastTool: null },
  10: { id: 10, name: 'bedrock', hardness: Infinity, solid: true, transparent: false, top: T.BEDROCK, side: T.BEDROCK, bottom: T.BEDROCK, requiredTool: null, fastTool: null },
  11: { id: 11, name: 'snow_block', hardness: 0.2, solid: true, transparent: false, top: T.SNOW_TOP, side: T.SNOW_SIDE, bottom: T.DIRT, requiredTool: null, fastTool: 'shovel' },
  12: { id: 12, name: 'glass', hardness: 0.3, solid: true, transparent: true, top: T.GLASS, side: T.GLASS, bottom: T.GLASS, requiredTool: null, fastTool: null },
  13: { id: 13, name: 'coal_ore', hardness: 3.0, solid: true, transparent: false, top: T.COAL, side: T.COAL, bottom: T.COAL, requiredTool: { kind: 'pickaxe', level: 0 }, fastTool: 'pickaxe' },
  14: { id: 14, name: 'iron_ore', hardness: 3.0, solid: true, transparent: false, top: T.IRON, side: T.IRON, bottom: T.IRON, requiredTool: { kind: 'pickaxe', level: 1 }, fastTool: 'pickaxe' },
  15: { id: 15, name: 'crafting_table', hardness: 2.5, solid: true, transparent: false, top: T.CRAFTING_TOP, side: T.CRAFTING_SIDE, bottom: T.PLANKS, requiredTool: null, fastTool: 'axe' },
  16: { id: 16, name: 'furnace', hardness: 3.5, solid: true, transparent: false, top: T.FURNACE_TOP, side: T.FURNACE_SIDE, bottom: T.STONE, requiredTool: { kind: 'pickaxe', level: 0 }, fastTool: 'pickaxe' },
  // B3 Task 3：雲杉／白樺。硬度沿用原版數值（與既有橡木一致）。
  17: { id: 17, name: 'spruce_log', hardness: 2.0, solid: true, transparent: false, top: T.SPRUCE_LOG_TOP, side: T.SPRUCE_LOG_SIDE, bottom: T.SPRUCE_LOG_TOP, requiredTool: null, fastTool: 'axe' },
  18: { id: 18, name: 'spruce_leaves', hardness: 0.2, solid: true, transparent: true, top: T.SPRUCE_LEAVES, side: T.SPRUCE_LEAVES, bottom: T.SPRUCE_LEAVES, requiredTool: null, fastTool: null },
  19: { id: 19, name: 'birch_log', hardness: 2.0, solid: true, transparent: false, top: T.BIRCH_LOG_TOP, side: T.BIRCH_LOG_SIDE, bottom: T.BIRCH_LOG_TOP, requiredTool: null, fastTool: 'axe' },
  20: { id: 20, name: 'birch_leaves', hardness: 0.2, solid: true, transparent: true, top: T.BIRCH_LEAVES, side: T.BIRCH_LEAVES, bottom: T.BIRCH_LEAVES, requiredTool: null, fastTool: null },
};

export function getBlockDef(id: number): BlockDef {
  return DEFS[id] ?? DEFS[0];
}

export const isSolid = (id: number): boolean => getBlockDef(id).solid;
export const isTransparent = (id: number): boolean => getBlockDef(id).transparent;

export const PLACEABLE: BlockId[] = [
  BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.COBBLE, BLOCK.PLANKS,
  BLOCK.LOG, BLOCK.LEAVES, BLOCK.SAND, BLOCK.GLASS, BLOCK.SNOW,
  BLOCK.BEDROCK, BLOCK.COAL_ORE, BLOCK.IRON_ORE, BLOCK.CRAFTING_TABLE, BLOCK.FURNACE,
  // B3 Task 3：雲杉／白樺的方塊物品形式在本批補上 → 創造清單自動出現
  BLOCK.SPRUCE_LOG, BLOCK.SPRUCE_LEAVES, BLOCK.BIRCH_LOG, BLOCK.BIRCH_LEAVES,
];

export const HOTBAR_DEFAULT: BlockId[] = [
  BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.COBBLE, BLOCK.PLANKS,
  BLOCK.LOG, BLOCK.LEAVES, BLOCK.SAND, BLOCK.GLASS,
];
