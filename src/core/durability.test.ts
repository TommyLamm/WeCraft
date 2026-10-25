import { describe, it, expect } from 'vitest';
import type { ItemId, ItemStack } from './items';
import {
  maxDurability,
  isDurableItem,
  currentDurability,
  normalizeDurability,
  damageStack,
} from './durability';

describe('durability', () => {
  it('the max durability table matches the vanilla material values', () => {
    expect(maxDurability('wooden_pickaxe')).toBe(59);
    expect(maxDurability('wooden_sword')).toBe(59);
    expect(maxDurability('stone_axe')).toBe(131);
    expect(maxDurability('iron_shovel')).toBe(250);
    expect(maxDurability('golden_pickaxe')).toBe(32);
    expect(maxDurability('diamond_sword')).toBe(1561);
    expect(maxDurability('stone')).toBe(0);
    expect(maxDurability('apple')).toBe(0);
    expect(maxDurability('toString')).toBe(0);
  });

  it('every tool of the same material shares one durability value', () => {
    const cases: Array<[ItemId, number]> = [
      ['wooden_pickaxe', 59], ['wooden_axe', 59], ['wooden_shovel', 59], ['wooden_sword', 59],
      ['stone_pickaxe', 131], ['stone_axe', 131], ['stone_shovel', 131], ['stone_sword', 131],
      ['iron_pickaxe', 250], ['iron_axe', 250], ['iron_shovel', 250], ['iron_sword', 250],
      ['golden_pickaxe', 32], ['golden_axe', 32], ['golden_shovel', 32], ['golden_sword', 32],
      ['diamond_pickaxe', 1561], ['diamond_axe', 1561], ['diamond_shovel', 1561], ['diamond_sword', 1561],
    ];
    for (const [item, max] of cases) expect(maxDurability(item)).toBe(max);
  });

  it('isDurableItem identifies tools and rejects ordinary items', () => {
    expect(isDurableItem('wooden_pickaxe')).toBe(true);
    expect(isDurableItem('diamond_sword')).toBe(true);
    expect(isDurableItem('stone')).toBe(false);
    expect(isDurableItem('apple')).toBe(false);
  });

  it('normalizeDurability keeps a legal value, clamps an over-max value and drops junk', () => {
    expect(normalizeDurability('wooden_pickaxe', 30)).toBe(30);
    expect(normalizeDurability('wooden_pickaxe', 0)).toBe(0);
    expect(normalizeDurability('wooden_pickaxe', 999)).toBe(59);
    expect(normalizeDurability('wooden_pickaxe', -3)).toBeUndefined();
    expect(normalizeDurability('wooden_pickaxe', Number.NaN)).toBeUndefined();
    expect(normalizeDurability('wooden_pickaxe', Infinity)).toBeUndefined();
    expect(normalizeDurability('wooden_pickaxe', 12.5)).toBeUndefined();
    expect(normalizeDurability('wooden_pickaxe', undefined)).toBeUndefined();
    expect(normalizeDurability('stone', 5)).toBeUndefined();
  });

  it('currentDurability treats a missing durability as full durability', () => {
    expect(currentDurability({ item: 'wooden_pickaxe' })).toBe(59);
    expect(currentDurability({ item: 'wooden_pickaxe', dur: 12 })).toBe(12);
    expect(currentDurability({ item: 'stone' })).toBe(0);
  });

  it('damageStack lowers the durability by one', () => {
    const r = damageStack({ item: 'wooden_pickaxe', count: 1, dur: 3 }, 1);
    expect(r.broke).toBe(false);
    expect(r.stack).toEqual({ item: 'wooden_pickaxe', count: 1, dur: 2 });
  });

  it('damageStack reports a break when the durability reaches zero', () => {
    const r = damageStack({ item: 'wooden_pickaxe', count: 1, dur: 1 }, 1);
    expect(r.broke).toBe(true);
    expect(r.stack).toBeNull();
  });

  it('damageStack treats a missing durability as full durability', () => {
    const r = damageStack({ item: 'wooden_pickaxe', count: 1 }, 1);
    expect(r.stack).toEqual({ item: 'wooden_pickaxe', count: 1, dur: 58 });
  });

  it('damageStack leaves non-durable items untouched', () => {
    const r = damageStack({ item: 'stone', count: 5 }, 1);
    expect(r.broke).toBe(false);
    expect(r.stack).toEqual({ item: 'stone', count: 5 });
  });

  it('damageStack ignores a non-positive or non-finite amount', () => {
    const s = { item: 'wooden_pickaxe', count: 1, dur: 10 } as const;
    expect(damageStack(s, 0).stack).toEqual(s);
    expect(damageStack(s, -1).stack).toEqual(s);
    expect(damageStack(s, Number.NaN).stack).toEqual(s);
  });

  // B7 Task 5：批次語意——「挖完一格」與「命中一次」各是**一次 −1**
  // （`damageStack` 每次都吃當下的堆疊），連兩次就是 131 → 130 → 129。
  it('breaking a block costs exactly one durability and an attack costs exactly one', () => {
    let stack: ItemStack = { item: 'stone_axe', count: 1, dur: 131 };
    stack = damageStack(stack, 1).stack!;
    expect(stack.dur).toBe(130);
    stack = damageStack(stack, 1).stack!;
    expect(stack.dur).toBe(129);
  });
});
