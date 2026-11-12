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
    expect(maxDurability('bow')).toBe(384);
    // B11 Task 2：打火石（JE 耐久 64；minecraft.wiki/Flint_and_Steel）
    expect(maxDurability('flint_and_steel')).toBe(64);
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

  it('B14: the fishing rod has 64 uses', () => {
    expect(maxDurability('fishing_rod')).toBe(64);
  });

  it('B13: hoes share the vanilla material durability', () => {
    expect(maxDurability('wooden_hoe')).toBe(59);
    expect(maxDurability('stone_hoe')).toBe(131);
    expect(maxDurability('iron_hoe')).toBe(250);
    expect(maxDurability('golden_hoe')).toBe(32);
    expect(maxDurability('diamond_hoe')).toBe(1561);
  });

  it('isDurableItem identifies tools and rejects ordinary items', () => {
    expect(isDurableItem('wooden_pickaxe')).toBe(true);
    expect(isDurableItem('diamond_sword')).toBe(true);
    expect(isDurableItem('bow')).toBe(true);
    expect(isDurableItem('flint_and_steel')).toBe(true); // B11
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

  // 最終修正波：小於 1 的 amount（含 0.5 這類小數）是**刻意的不動作**——
  // 耐久原樣保留，不是 `Math.floor(0.5) === 0`「扣了 0 點」的隱式巧合。
  it('damageStack treats an amount below one (including fractional) as a deliberate no-op', () => {
    const s = { item: 'wooden_pickaxe', count: 1, dur: 10 } as const;
    expect(damageStack(s, 0.5)).toEqual({ stack: s, broke: false });
    expect(damageStack(s, 0.9).broke).toBe(false);
  });

  it('damageStack no-op branches return a copy, never the input reference', () => {
    const s: ItemStack = { item: 'wooden_pickaxe', count: 1, dur: 10 };
    const noop = damageStack(s, 0.5).stack!;
    expect(noop).not.toBe(s); // 拷貝 → 呼叫端改結果不會寫回模型內的堆疊
    noop.dur = 1;
    expect(s.dur).toBe(10);
    // 非耐久物品的 no-op 分支同樣回傳拷貝。
    const nonDurable: ItemStack = { item: 'stone', count: 5 };
    expect(damageStack(nonDurable, 1).stack).not.toBe(nonDurable);
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

// ---- B17 Task 10：unbreaking（每次扣耐久擲一次，L/(L+1) 機率免除） ----------
describe('damageStack 的 unbreaking（B17 Task 10）', () => {
  const pick = (level: number, dur = 10): ItemStack => ({
    item: 'iron_pickaxe',
    count: 1,
    dur,
    ench: { id: 'unbreaking', level },
  });

  it('an avoided roll keeps the whole stack intact (a fresh copy, no break)', () => {
    const s = pick(1);
    const r = damageStack(s, 1, () => 0.4); // 0.4 < 1/2 → 免除
    expect(r.broke).toBe(false);
    expect(r.stack).toEqual(s);
    expect(r.stack).not.toBe(s);
  });

  it('a failed avoid roll still consumes durability', () => {
    const r = damageStack(pick(1), 1, () => 0.5); // 0.5 !< 0.5 → 照扣
    expect(r.broke).toBe(false);
    expect(r.stack?.dur).toBe(9);
  });

  it('follows the L/(L+1) thresholds (L2 2/3, L3 3/4)', () => {
    expect(damageStack(pick(2), 1, () => 0.66).stack?.dur).toBe(10); // 0.66 < 2/3 → 免除
    expect(damageStack(pick(2), 1, () => 0.67).stack?.dur).toBe(9);
    expect(damageStack(pick(3), 1, () => 0.74).stack?.dur).toBe(10); // 0.74 < 3/4 → 免除
    expect(damageStack(pick(3), 1, () => 0.75).stack?.dur).toBe(9);
  });

  it('can save the item on its last point of durability (broke stays false)', () => {
    const r = damageStack(pick(3, 1), 1, () => 0);
    expect(r.broke).toBe(false);
    expect(r.stack).toEqual(pick(3, 1));
  });

  it('rolls exactly ONCE per damaging call, whatever the amount', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.99;
    };
    const r = damageStack(pick(1), 3, rng);
    expect(calls).toBe(1);
    expect(r.stack?.dur).toBe(7);
  });

  it('never rolls on the deliberate no-op branches (amount < 1, non-durable)', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0;
    };
    damageStack(pick(3), 0.5, rng);
    damageStack(pick(3), 0, rng);
    damageStack(pick(3), Number.NaN, rng);
    damageStack(pick(3), Number.POSITIVE_INFINITY, rng);
    damageStack({ item: 'stone', count: 5 }, 1, rng);
    expect(calls).toBe(0);
  });

  it('unenchanted stacks never roll and behave exactly as before', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0;
    };
    const r = damageStack({ item: 'iron_pickaxe', count: 1, dur: 10 }, 1, rng);
    expect(calls).toBe(0);
    expect(r.stack?.dur).toBe(9);
    // 沒有附魔但「有 rng」也不會被免除（chance 0 → 不擲骰）。
    expect(damageStack({ item: 'iron_pickaxe', count: 1, dur: 1 }, 1, () => 0).broke).toBe(true);
  });
});
