import { BLOCK, type BlockId } from '../world/blocks';

export type ItemId =
  | 'grass' | 'dirt' | 'stone' | 'cobblestone' | 'oak_log' | 'oak_planks'
  | 'sand' | 'gravel' | 'glass' | 'coal_ore' | 'iron_ore'
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

// Item ↔ block pairs for blocks that exist RIGHT NOW. chest is in the ItemId
// union but gains its entry when its block lands; gravel has no block at all.
// air is never an item; water is a world-only block with no obtainable item
// form (it is never mined or placed as an item).
const BLOCK_PAIRS: ReadonlyArray<readonly [ItemId, BlockId]> = [
  ['grass', BLOCK.GRASS],
  ['dirt', BLOCK.DIRT],
  ['stone', BLOCK.STONE],
  ['cobblestone', BLOCK.COBBLE],
  ['oak_log', BLOCK.LOG],
  ['oak_planks', BLOCK.PLANKS],
  ['sand', BLOCK.SAND],
  ['glass', BLOCK.GLASS],
  ['coal_ore', BLOCK.COAL_ORE],
  ['iron_ore', BLOCK.IRON_ORE],
  ['oak_leaves', BLOCK.LEAVES],
  ['snow_block', BLOCK.SNOW],
  ['bedrock', BLOCK.BEDROCK],
  ['crafting_table', BLOCK.CRAFTING_TABLE],
];

const BLOCK_ID = new Map<ItemId, BlockId>(BLOCK_PAIRS);
const ITEM_OF_BLOCK = new Map<number, ItemId>(BLOCK_PAIRS.map(([item, block]) => [block, item]));

const STACK_ONE: ReadonlySet<ItemId> = new Set([
  'wooden_pickaxe', 'stone_pickaxe', 'wooden_axe', 'stone_axe', 'wooden_sword', 'stone_sword',
]);

export function maxStack(item: ItemId): number {
  return STACK_ONE.has(item) ? 1 : 64;
}

export function stackName(item: ItemId): string {
  return item.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Map a placed/broken block id to its item id; null when no item form exists (air, water). */
export function itemFromBlock(blockId: number): ItemId | null {
  return ITEM_OF_BLOCK.get(blockId) ?? null;
}

/** Inverse of itemFromBlock; null for non-block items (stick, tools, …). */
export function blockFromItem(item: ItemId): BlockId | null {
  return BLOCK_ID.get(item) ?? null;
}

/** Block → ItemStack, full stack by default (creative hotbar/palette); pass an
 *  explicit count for drops (e.g. 1). Null when the block has no item form. */
export function stackFromBlock(block: BlockId, count?: number): ItemStack | null {
  const item = itemFromBlock(block);
  if (!item) return null;
  return { item, count: count ?? maxStack(item) };
}
