import { describe, it, expect } from 'vitest';
import {
  itemFromBlock,
  blockFromItem,
  stackFromBlock,
  stackName,
  maxStack,
  starterSlots,
  type ItemId,
} from './items';
import { BLOCK, PLACEABLE, HOTBAR_DEFAULT } from '../world/blocks';

// Type-annotated: a missing union member fails `tsc --noEmit`.
const BLOCK_ITEMS: ItemId[] = [
  'grass', 'dirt', 'stone', 'cobblestone', 'oak_log', 'oak_planks',
  'sand', 'gravel', 'glass', 'coal_ore', 'iron_ore',
  'crafting_table', 'chest',
];
const TOOL_ITEMS: ItemId[] = [
  'wooden_pickaxe', 'stone_pickaxe', 'wooden_axe', 'stone_axe',
  'wooden_sword', 'stone_sword',
];
const DROP_ITEMS: ItemId[] = ['stick', 'coal', 'iron_ingot', 'arrow', 'apple'];
const ALL_ITEMS: ItemId[] = [...new Set<ItemId>([
  ...BLOCK_ITEMS,
  ...TOOL_ITEMS,
  ...DROP_ITEMS,
  'oak_leaves', 'snow_block', 'bedrock',
])];

describe('items', () => {
  it('ItemId union covers every obtainable block item', () => {
    expect(ALL_ITEMS.length).toBe(27);
    expect(new Set(ALL_ITEMS).size).toBe(ALL_ITEMS.length);
    // real guard: every block except air and block-only water maps to an item
    for (const id of Object.values(BLOCK)) {
      if (id === BLOCK.AIR || id === BLOCK.WATER) continue;
      expect(itemFromBlock(id), `block ${id} has no item`).not.toBeNull();
    }
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
    expect(blockFromItem('chest')).toBeNull(); // no chest block yet
  });

  it('stackName title-cases item ids', () => {
    expect(stackName('stick')).toBe('Stick');
    expect(stackName('oak_planks')).toBe('Oak Planks');
  });

  it('maxStack is 64 for stackables like stick', () => {
    expect(maxStack('stick')).toBe(64);
    expect(maxStack('apple')).toBe(64);
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
});
