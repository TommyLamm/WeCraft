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
} as const;

export type BlockId = (typeof BLOCK)[keyof typeof BLOCK];

export interface BlockDef {
  id: BlockId;
  name: string;
  hardness: number; // 秒；Infinity = 不可破壞
  solid: boolean;
  transparent: boolean;
  top: number; // 圖集 tile 索引 0..63
  side: number;
  bottom: number;
}

const T = {
  GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3,
  SAND: 4, LOG_SIDE: 5, LOG_TOP: 6, LEAVES: 7,
  PLANKS: 8, COBBLE: 9, WATER: 10, BEDROCK: 11,
  SNOW_TOP: 12, SNOW_SIDE: 13, GLASS: 14,
  COAL: 15, IRON: 16,
  CRAFTING_TOP: 17, CRAFTING_SIDE: 18,
} as const;

const DEFS: Record<number, BlockDef> = {
  0: { id: 0, name: 'air', hardness: 0, solid: false, transparent: true, top: 0, side: 0, bottom: 0 },
  1: { id: 1, name: 'stone', hardness: 2.0, solid: true, transparent: false, top: T.STONE, side: T.STONE, bottom: T.STONE },
  2: { id: 2, name: 'dirt', hardness: 0.6, solid: true, transparent: false, top: T.DIRT, side: T.DIRT, bottom: T.DIRT },
  3: { id: 3, name: 'grass_block', hardness: 0.7, solid: true, transparent: false, top: T.GRASS_TOP, side: T.GRASS_SIDE, bottom: T.DIRT },
  4: { id: 4, name: 'sand', hardness: 0.6, solid: true, transparent: false, top: T.SAND, side: T.SAND, bottom: T.SAND },
  5: { id: 5, name: 'oak_log', hardness: 1.5, solid: true, transparent: false, top: T.LOG_TOP, side: T.LOG_SIDE, bottom: T.LOG_TOP },
  6: { id: 6, name: 'oak_leaves', hardness: 0.3, solid: true, transparent: true, top: T.LEAVES, side: T.LEAVES, bottom: T.LEAVES },
  7: { id: 7, name: 'oak_planks', hardness: 1.2, solid: true, transparent: false, top: T.PLANKS, side: T.PLANKS, bottom: T.PLANKS },
  8: { id: 8, name: 'cobblestone', hardness: 2.2, solid: true, transparent: false, top: T.COBBLE, side: T.COBBLE, bottom: T.COBBLE },
  9: { id: 9, name: 'water', hardness: Infinity, solid: false, transparent: true, top: T.WATER, side: T.WATER, bottom: T.WATER },
  10: { id: 10, name: 'bedrock', hardness: Infinity, solid: true, transparent: false, top: T.BEDROCK, side: T.BEDROCK, bottom: T.BEDROCK },
  11: { id: 11, name: 'snow_block', hardness: 0.6, solid: true, transparent: false, top: T.SNOW_TOP, side: T.SNOW_SIDE, bottom: T.DIRT },
  12: { id: 12, name: 'glass', hardness: 0.4, solid: true, transparent: true, top: T.GLASS, side: T.GLASS, bottom: T.GLASS },
  13: { id: 13, name: 'coal_ore', hardness: 2.5, solid: true, transparent: false, top: T.COAL, side: T.COAL, bottom: T.COAL },
  14: { id: 14, name: 'iron_ore', hardness: 3.0, solid: true, transparent: false, top: T.IRON, side: T.IRON, bottom: T.IRON },
  15: { id: 15, name: 'crafting_table', hardness: 2.5, solid: true, transparent: false, top: T.CRAFTING_TOP, side: T.CRAFTING_SIDE, bottom: T.PLANKS },
};

export function getBlockDef(id: number): BlockDef {
  return DEFS[id] ?? DEFS[0];
}

export const isSolid = (id: number): boolean => getBlockDef(id).solid;
export const isTransparent = (id: number): boolean => getBlockDef(id).transparent;

export const PLACEABLE: BlockId[] = [
  BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.COBBLE, BLOCK.PLANKS,
  BLOCK.LOG, BLOCK.LEAVES, BLOCK.SAND, BLOCK.GLASS, BLOCK.SNOW,
  BLOCK.BEDROCK, BLOCK.COAL_ORE, BLOCK.IRON_ORE, BLOCK.CRAFTING_TABLE,
];

export const HOTBAR_DEFAULT: BlockId[] = [
  BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.COBBLE, BLOCK.PLANKS,
  BLOCK.LOG, BLOCK.LEAVES, BLOCK.SAND, BLOCK.GLASS,
];
