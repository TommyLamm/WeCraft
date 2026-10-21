import { BLOCK, HOTBAR_DEFAULT, type BlockId } from '../world/blocks';

export type ItemId =
  | 'grass' | 'dirt' | 'stone' | 'cobblestone' | 'oak_log' | 'oak_planks'
  | 'sand' | 'gravel' | 'glass' | 'coal_ore' | 'iron_ore'
  | 'crafting_table' | 'furnace' | 'chest'
  | 'stick' | 'coal' | 'iron_ingot' | 'raw_iron'
  | 'wooden_pickaxe' | 'stone_pickaxe' | 'iron_pickaxe'
  | 'wooden_axe' | 'stone_axe' | 'iron_axe'
  | 'wooden_sword' | 'stone_sword' | 'iron_sword'
  | 'arrow' | 'apple'
  // Blocks that exist in world/blocks.ts today but were missing from the plan's
  // union — without them the creative hotbar/palette can't represent them
  // (plan requirement: "union covers blocks" + keep existing behavior working).
  | 'oak_leaves' | 'snow_block' | 'bedrock'
  // B3 Task 3: spruce/birch blocks (the three-tree-species batch). They land
  // WITH their item forms — the "every block maps to an item" invariant below
  // is the guard that forced it.
  | 'spruce_log' | 'spruce_leaves' | 'birch_log' | 'birch_leaves';

/** Exhaustive canonical id list (Minor 5): the `Record<ItemId, true>` is
 *  total, so adding a union member without listing it here is a TYPE ERROR —
 *  the runtime allow-list derived from it (`ITEM_ID_SET`, used by
 *  `sanitizeStack`/`sanitizeSlots`) can never silently drift behind the
 *  union again. */
const ITEM_IDS: Record<ItemId, true> = {
  grass: true, dirt: true, stone: true, cobblestone: true, oak_log: true, oak_planks: true,
  sand: true, gravel: true, glass: true, coal_ore: true, iron_ore: true,
  crafting_table: true, furnace: true, chest: true,
  stick: true, coal: true, iron_ingot: true, raw_iron: true,
  wooden_pickaxe: true, stone_pickaxe: true, iron_pickaxe: true,
  wooden_axe: true, stone_axe: true, iron_axe: true,
  wooden_sword: true, stone_sword: true, iron_sword: true,
  arrow: true, apple: true,
  oak_leaves: true, snow_block: true, bedrock: true,
  spruce_log: true, spruce_leaves: true, birch_log: true, birch_leaves: true,
};

/** Every ItemId, canonically (36 today). */
export const ALL_ITEM_IDS = Object.keys(ITEM_IDS) as ItemId[];

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
  ['furnace', BLOCK.FURNACE],
  ['spruce_log', BLOCK.SPRUCE_LOG],
  ['spruce_leaves', BLOCK.SPRUCE_LEAVES],
  ['birch_log', BLOCK.BIRCH_LOG],
  ['birch_leaves', BLOCK.BIRCH_LEAVES],
];

const BLOCK_ID = new Map<ItemId, BlockId>(BLOCK_PAIRS);
const ITEM_OF_BLOCK = new Map<number, ItemId>(BLOCK_PAIRS.map(([item, block]) => [block, item]));

const STACK_ONE: ReadonlySet<ItemId> = new Set([
  'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe',
  'wooden_axe', 'stone_axe', 'iron_axe',
  'wooden_sword', 'stone_sword', 'iron_sword',
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

/** Starting hotbar contents per mode. Survival begins EMPTY (vanilla parity —
 *  and a full hotbar leaves fits() zero slack, blocking every pickup and craft
 *  take); creative begins with the standard block kit at full stacks.
 *  A fresh array (and fresh stacks) per call — callers write it straight into
 *  live slot arrays, so results must never alias each other. */
export function starterSlots(mode: 'survival' | 'creative'): Array<ItemStack | null> {
  // Local union, not `import type { GameMode } from './inventory'`: GameMode is
  // declared in inventory.ts, which imports THIS module — importing it back
  // would close a module cycle for zero benefit (structurally identical union).
  if (mode === 'survival') return HOTBAR_DEFAULT.map(() => null);
  return HOTBAR_DEFAULT.map((b) => stackFromBlock(b));
}

/** Runtime id gate for UNTRUSTED input (save/cloud records). Built from the
 *  exhaustive ITEM_IDS record, and a Set on purpose: an `item in ITEM_IDS`
 *  check would let prototype keys (`toString`, `__proto__`, …) through. */
const ITEM_ID_SET: ReadonlySet<string> = new Set(ALL_ITEM_IDS);

const isItemId = (x: unknown): x is ItemId => typeof x === 'string' && ITEM_ID_SET.has(x);

/** Sanitize one untrusted stack: a known `ItemId` with a finite count > 0,
 *  otherwise null (the caller's "empty slot"). The count passes through
 *  unchanged — flooring to a whole number and clamping to `maxStack` is the
 *  writing model's job (`InventoryModel.setSlot`). Never throws; the result is
 *  a fresh object, never the input. */
export function sanitizeStack(x: unknown): ItemStack | null {
  if (typeof x !== 'object' || x === null) return null;
  const s = x as Partial<ItemStack>;
  if (!isItemId(s.item)) return null;
  if (typeof s.count !== 'number' || !Number.isFinite(s.count) || s.count <= 0) return null;
  return { item: s.item, count: s.count };
}

/** Sanitize an untrusted slot array to EXACTLY `count` slots: a non-array (or
 *  short) source is null-padded, surplus entries are dropped, and every kept
 *  entry runs through `sanitizeStack`. Never throws — the result is always a
 *  fresh array of `count` entries. */
export function sanitizeSlots(x: unknown, count: number): Array<ItemStack | null> {
  // Non-finite counts read as 0 rather than looping forever (Infinity / NaN).
  const size = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const source: ReadonlyArray<unknown> = Array.isArray(x) ? x : [];
  const slots: Array<ItemStack | null> = [];
  for (let i = 0; i < size; i++) slots.push(sanitizeStack(source[i]));
  return slots;
}
