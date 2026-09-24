import { describe, it, expect } from 'vitest';
import {
  itemFromBlock,
  blockFromItem,
  stackName,
  maxStack,
  isBlockItem,
  type ItemId,
  type ItemStack,
} from './items';
import { BLOCK, PLACEABLE, HOTBAR_DEFAULT } from '../world/blocks';

// Type-annotated: a missing union member fails `tsc --noEmit`.
const BLOCK_ITEMS: ItemId[] = [
  'grass', 'dirt', 'stone', 'cobblestone', 'oak_log', 'oak_planks',
  'sand', 'gravel', 'glass', 'coal_ore', 'iron_ore', 'water',
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
  it('ItemId union covers blocks and new item ids', () => {
    expect(ALL_ITEMS.length).toBe(28);
    expect(new Set(ALL_ITEMS).size).toBe(ALL_ITEMS.length);
    for (const id of [...BLOCK_ITEMS, ...TOOL_ITEMS, ...DROP_ITEMS]) {
      expect(ALL_ITEMS).toContain(id);
    }
    const named: ItemId[] = [
      'stick', 'wooden_pickaxe', 'stone_pickaxe', 'wooden_axe', 'stone_axe',
      'wooden_sword', 'stone_sword', 'arrow', 'crafting_table', 'apple',
    ];
    for (const id of named) expect(ALL_ITEMS).toContain(id);
  });

  it('every placeable and default hotbar block maps to an item', () => {
    for (const block of [...PLACEABLE, ...HOTBAR_DEFAULT]) {
      expect(itemFromBlock(block), `block ${block} has no item`).not.toBeNull();
    }
  });

  it('itemFromBlock maps grass to the grass stack id', () => {
    expect(itemFromBlock(BLOCK.GRASS)).toBe('grass');
    expect(itemFromBlock(BLOCK.AIR)).toBeNull();
    expect(itemFromBlock(999)).toBeNull();
  });

  it('blockFromItem is the inverse of itemFromBlock', () => {
    for (const block of PLACEABLE) {
      const item = itemFromBlock(block);
      expect(item).not.toBeNull();
      expect(blockFromItem(item!)).toBe(block);
    }
    expect(blockFromItem('stick')).toBeNull();
    expect(blockFromItem('crafting_table')).toBeNull(); // block arrives in Task 11
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

  it('isBlockItem is true only for items with a placeable block form', () => {
    expect(isBlockItem('grass')).toBe(true);
    expect(isBlockItem('oak_log')).toBe(true);
    expect(isBlockItem('water')).toBe(false); // block-only: no item form
    expect(isBlockItem('stick')).toBe(false);
    expect(isBlockItem('crafting_table')).toBe(false); // no block yet (Task 11)
    const stack: ItemStack = { item: 'stick', count: 64 };
    expect(isBlockItem(stack.item)).toBe(false);
  });
});
