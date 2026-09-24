import { BLOCK } from '../world/blocks';

export type ItemId =
  | 'grass' | 'dirt' | 'stone' | 'cobblestone' | 'oak_log' | 'oak_planks'
  | 'sand' | 'gravel' | 'glass' | 'coal_ore' | 'iron_ore' | 'water'
  | 'crafting_table' | 'chest'
  | 'stick' | 'coal' | 'iron_ingot'
  | 'wooden_pickaxe' | 'stone_pickaxe' | 'wooden_axe' | 'stone_axe'
  | 'wooden_sword' | 'stone_sword'
  | 'arrow' | 'apple'
  // Blocks that exist in world/blocks.ts today but were missing from the plan's
  // union — without them the creative hotbar/palette can't represent them
  // (plan requirement: "union covers blocks" + keep existing behavior working).
  | 'oak_leaves' | 'snow_block' | 'bedrock';

export interface ItemStack { item: ItemId; count: number }

// Item ↔ block pairs for blocks that exist RIGHT NOW. crafting_table/chest are in
// the ItemId union but gain entries here when their blocks land (Task 11);
// gravel has no block at all. air is never an item.
const BLOCK_PAIRS: ReadonlyArray<readonly [ItemId, number]> = [
  ['grass', BLOCK.GRASS],
  ['dirt', BLOCK.DIRT],
  ['stone', BLOCK.STONE],
  ['cobblestone', BLOCK.COBBLE],
  ['oak_log', BLOCK.LOG],
  ['oak_planks', BLOCK.PLANKS],
  ['sand', BLOCK.SAND],
  ['water', BLOCK.WATER],
  ['glass', BLOCK.GLASS],
  ['coal_ore', BLOCK.COAL_ORE],
  ['iron_ore', BLOCK.IRON_ORE],
  ['oak_leaves', BLOCK.LEAVES],
  ['snow_block', BLOCK.SNOW],
  ['bedrock', BLOCK.BEDROCK],
];

const BLOCK_ID = new Map<ItemId, number>(BLOCK_PAIRS);
const ITEM_OF_BLOCK = new Map<number, ItemId>(BLOCK_PAIRS.map(([item, block]) => [block, item]));

// water exists as a block id but has no obtainable item form (block-only).
const BLOCK_ONLY: ReadonlySet<ItemId> = new Set(['water']);
const STACK_ONE: ReadonlySet<ItemId> = new Set([
  'wooden_pickaxe', 'stone_pickaxe', 'wooden_axe', 'stone_axe', 'wooden_sword', 'stone_sword',
]);

export function maxStack(item: ItemId): number {
  return STACK_ONE.has(item) ? 1 : 64;
}

export function stackName(item: ItemId): string {
  return item.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** True when the item has a placeable block form (water is block-only, not an item). */
export function isBlockItem(item: ItemId): boolean {
  return !BLOCK_ONLY.has(item) && BLOCK_ID.has(item);
}

/** Map a placed/broken block id to its item id; null when no item form exists (air). */
export function itemFromBlock(blockId: number): ItemId | null {
  return ITEM_OF_BLOCK.get(blockId) ?? null;
}

/** Inverse of itemFromBlock; null for non-block items (stick, tools, …). */
export function blockFromItem(item: ItemId): number | null {
  return BLOCK_ID.get(item) ?? null;
}
