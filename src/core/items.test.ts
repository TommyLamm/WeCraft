import { describe, it, expect } from 'vitest';
import {
  itemFromBlock,
  blockFromItem,
  stackFromBlock,
  stackName,
  maxStack,
  starterSlots,
  sanitizeStack,
  sanitizeSlots,
  ALL_ITEM_IDS,
  type ItemId,
} from './items';
import { BLOCK, PLACEABLE, HOTBAR_DEFAULT } from '../world/blocks';

// Type-annotated: a missing union member fails `tsc --noEmit`.
const BLOCK_ITEMS: ItemId[] = [
  'grass', 'dirt', 'stone', 'cobblestone', 'oak_log', 'oak_planks',
  'sand', 'gravel', 'glass', 'coal_ore', 'iron_ore',
  'crafting_table', 'furnace', 'chest',
  // B3 Task 3：雲杉／白樺的方塊物品形式（隨三樹種一起補上）
  'spruce_log', 'spruce_leaves', 'birch_log', 'birch_leaves',
];
const TOOL_ITEMS: ItemId[] = [
  'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe',
  'wooden_axe', 'stone_axe', 'iron_axe',
  'wooden_sword', 'stone_sword', 'iron_sword',
];
const DROP_ITEMS: ItemId[] = ['stick', 'coal', 'iron_ingot', 'raw_iron', 'arrow', 'apple'];
const ALL_ITEMS: ItemId[] = [...new Set<ItemId>([
  ...BLOCK_ITEMS,
  ...TOOL_ITEMS,
  ...DROP_ITEMS,
  'oak_leaves', 'snow_block', 'bedrock',
])];

describe('items', () => {
  it('ItemId union covers every obtainable block item', () => {
    // B3 Task 3：基數 32 → 36（新增 4 個雲杉／白樺方塊的物品形式）
    expect(ALL_ITEMS.length).toBe(36);
    expect(new Set(ALL_ITEMS).size).toBe(ALL_ITEMS.length);
    // real guard: every block except air and block-only water maps to an item
    for (const id of Object.values(BLOCK)) {
      if (id === BLOCK.AIR || id === BLOCK.WATER) continue;
      expect(itemFromBlock(id), `block ${id} has no item`).not.toBeNull();
    }
  });

  it('ALL_ITEM_IDS is the canonical list: 36 entries, no dupes, same set as the union', () => {
    expect(ALL_ITEM_IDS.length).toBe(36);
    expect(new Set(ALL_ITEM_IDS).size).toBe(ALL_ITEM_IDS.length);
    // Same membership as the test's own hand-maintained union mirror — the
    // Record<ItemId, true> source makes drift a tsc error (Minor 5).
    expect(new Set(ALL_ITEM_IDS)).toEqual(new Set(ALL_ITEMS));
  });

  it('every placeable and default hotbar block maps to an item', () => {
    for (const block of [...PLACEABLE, ...HOTBAR_DEFAULT]) {
      expect(itemFromBlock(block), `block ${block} has no item`).not.toBeNull();
    }
  });

  it('itemFromBlock maps grass to the grass stack id', () => {
    expect(itemFromBlock(BLOCK.GRASS)).toBe('grass');
    expect(itemFromBlock(BLOCK.AIR)).toBeNull();
    expect(itemFromBlock(BLOCK.WATER)).toBeNull(); // water is block-only: never an item
    expect(itemFromBlock(999)).toBeNull();
  });

  it('blockFromItem is the inverse of itemFromBlock', () => {
    for (const block of PLACEABLE) {
      const item = itemFromBlock(block);
      expect(item).not.toBeNull();
      expect(blockFromItem(item!)).toBe(block);
    }
    expect(blockFromItem('stick')).toBeNull();
    expect(blockFromItem('crafting_table')).toBe(BLOCK.CRAFTING_TABLE); // Task 11 block
    expect(blockFromItem('furnace')).toBe(BLOCK.FURNACE); // Task 6 block pair
    expect(blockFromItem('chest')).toBeNull(); // no chest block yet
    expect(blockFromItem('iron_pickaxe')).toBeNull(); // tools are not blocks
  });

  // B3 Task 3：雲杉／白樺方塊的物品形式（隨三樹種一起補上）
  it('the new wood blocks have an item form in both directions', () => {
    expect(itemFromBlock(BLOCK.SPRUCE_LOG)).toBe('spruce_log');
    expect(itemFromBlock(BLOCK.SPRUCE_LEAVES)).toBe('spruce_leaves');
    expect(itemFromBlock(BLOCK.BIRCH_LOG)).toBe('birch_log');
    expect(itemFromBlock(BLOCK.BIRCH_LEAVES)).toBe('birch_leaves');
    expect(blockFromItem('spruce_log')).toBe(BLOCK.SPRUCE_LOG);
    expect(blockFromItem('spruce_leaves')).toBe(BLOCK.SPRUCE_LEAVES);
    expect(blockFromItem('birch_log')).toBe(BLOCK.BIRCH_LOG);
    expect(blockFromItem('birch_leaves')).toBe(BLOCK.BIRCH_LEAVES);
    // 物品可以堆疊（方塊物品都是 64）
    expect(maxStack('spruce_log')).toBe(64);
    expect(maxStack('birch_leaves')).toBe(64);
    expect(stackFromBlock(BLOCK.BIRCH_LOG)).toEqual({ item: 'birch_log', count: 64 });
  });

  it('stackName title-cases item ids', () => {
    expect(stackName('stick')).toBe('Stick');
    expect(stackName('oak_planks')).toBe('Oak Planks');
  });

  it('maxStack is 64 for stackables like stick', () => {
    expect(maxStack('stick')).toBe(64);
    expect(maxStack('apple')).toBe(64);
    expect(maxStack('furnace')).toBe(64); // block item, stacks like stone
  });

  it('raw_iron is a plain item: not a block, stacks to 64 (Task 6)', () => {
    expect(blockFromItem('raw_iron')).toBeNull();
    expect(maxStack('raw_iron')).toBe(64);
  });

  it('maxStack is 1 for tools and weapons', () => {
    for (const tool of TOOL_ITEMS) expect(maxStack(tool)).toBe(1);
  });

  it('stackFromBlock builds a full stack by default and honors an explicit count', () => {
    expect(stackFromBlock(BLOCK.GRASS)).toEqual({ item: 'grass', count: 64 });
    expect(stackFromBlock(BLOCK.GRASS, 3)).toEqual({ item: 'grass', count: 3 });
    expect(stackFromBlock(BLOCK.STONE, 1)).toEqual({ item: 'stone', count: 1 });
    expect(stackFromBlock(BLOCK.CRAFTING_TABLE)).toEqual({ item: 'crafting_table', count: 64 });
    expect(stackFromBlock(BLOCK.AIR)).toBeNull();
    expect(stackFromBlock(BLOCK.WATER)).toBeNull(); // no obtainable item form
  });

  // The Critical the live walkthrough found: a survival hotbar starting FULL
  // (64/64 of unrelated blocks) leaves fits() zero slack, so no mined drop can
  // be picked up and no craft result can be taken — the whole loop deadlocks.
  it('starterSlots is a full hotbar of nulls in survival (fits() must have slack)', () => {
    const slots = starterSlots('survival');
    expect(slots).toHaveLength(9);
    expect(slots).toHaveLength(HOTBAR_DEFAULT.length);
    expect(slots.every((s) => s === null)).toBe(true);
  });

  it('starterSlots is the default block kit at max stacks in creative', () => {
    const expected = HOTBAR_DEFAULT.map((b) => stackFromBlock(b));
    expect(starterSlots('creative')).toEqual(expected);
    expect(starterSlots('creative')).toHaveLength(HOTBAR_DEFAULT.length);
    for (const s of starterSlots('creative')) {
      expect(s).not.toBeNull();
      expect(s!.count).toBe(maxStack(s!.item));
    }
  });

  it('starterSlots returns a fresh array each call (mutating one cannot alias the next)', () => {
    const a = starterSlots('survival');
    const b = starterSlots('survival');
    expect(a).not.toBe(b);
    a[0] = { item: 'dirt', count: 64 };
    expect(b[0]).toBeNull();

    const c = starterSlots('creative');
    const d = starterSlots('creative');
    expect(c).not.toBe(d);
    expect(c[0]).not.toBe(d[0]);
    c[0]!.count = 1;
    expect(d[0]!.count).toBe(64);
  });

  // ---- Load-path sanitizers (B1.3): save/cloud records are UNTRUSTED input —
  // a removed item id or a junk count must read as "empty slot", never throw.
  it('sanitizeStack accepts real ids with positive finite counts, rejects junk', () => {
    expect(sanitizeStack({ item: 'stone', count: 64 })).toEqual({ item: 'stone', count: 64 });
    // the count passes through unchanged (no rounding) — setSlot floors on write
    expect(sanitizeStack({ item: 'apple', count: 0.5 })).toEqual({ item: 'apple', count: 0.5 });
    expect(sanitizeStack({ item: 'nope', count: 1 })).toBeNull();
    // prototype keys are not item ids (an `in`-style check would let this through)
    expect(sanitizeStack({ item: 'toString', count: 1 })).toBeNull();
    expect(sanitizeStack({ item: 'stone', count: 0 })).toBeNull();
    expect(sanitizeStack({ item: 'stone', count: -1 })).toBeNull();
    expect(sanitizeStack({ item: 'stone', count: Number.NaN })).toBeNull();
    expect(sanitizeStack({ item: 'stone', count: Infinity })).toBeNull();
    expect(sanitizeStack({ item: 'stone' })).toBeNull();
    expect(sanitizeStack(null)).toBeNull();
    expect(sanitizeStack('junk')).toBeNull();
    const source = { item: 'stone' as const, count: 64 };
    expect(sanitizeStack(source)).not.toBe(source); // fresh object, never aliased
  });

  it('sanitizeSlots pads and truncates to the requested count', () => {
    // shorter than requested → the tail is null-filled
    expect(sanitizeSlots([{ item: 'stone', count: 3 }], 3)).toEqual([
      { item: 'stone', count: 3 },
      null,
      null,
    ]);
    // longer than requested → the surplus is dropped
    expect(sanitizeSlots([{ item: 'dirt', count: 1 }, { item: 'sand', count: 2 }], 1)).toEqual([
      { item: 'dirt', count: 1 },
    ]);
    // junk is dropped per-slot — the valid neighbours survive
    expect(sanitizeSlots([{ item: 'nope', count: 1 }, { item: 'dirt', count: 4 }], 2)).toEqual([
      null,
      { item: 'dirt', count: 4 },
    ]);
    // a non-array source is all nulls — never a throw
    expect(sanitizeSlots('junk', 2)).toEqual([null, null]);
    expect(sanitizeSlots(undefined, 2)).toEqual([null, null]);
    // the requested count itself is defended: non-finite / negative reads as
    // 0 slots (never an infinite loop), fractional counts floor down
    expect(sanitizeSlots([{ item: 'stone', count: 1 }], Infinity)).toEqual([]);
    expect(sanitizeSlots([{ item: 'stone', count: 1 }], Number.NaN)).toEqual([]);
    expect(sanitizeSlots([{ item: 'stone', count: 1 }], -1)).toEqual([]);
    expect(sanitizeSlots([{ item: 'stone', count: 1 }, { item: 'dirt', count: 2 }], 2.7)).toEqual([
      { item: 'stone', count: 1 },
      { item: 'dirt', count: 2 },
    ]);
  });
});
