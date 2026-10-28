import { describe, it, expect } from 'vitest';
import {
  emptyFurnace,
  stepFurnace,
  normalizeFurnaceState,
  SMELT_TIME_SEC,
  SMELT_RECIPES,
  FUEL_VALUES,
  type FurnaceState,
} from './furnace';
import type { ItemStack } from '../core/items';

const stack = (item: ItemStack['item'], count: number): ItemStack => ({ item, count });

function burning(overrides: Partial<FurnaceState> = {}): FurnaceState {
  return {
    input: stack('iron_ore', 3),
    fuel: stack('coal', 2),
    output: null,
    progressSec: 0,
    fuelUnits: 0,
    ...overrides,
  };
}

describe('furnace tables', () => {
  it('smelt takes 10 s; iron and gold ores→ingots, sand→glass, four raw meats→cooked; coal_ore excluded', () => {
    expect(SMELT_TIME_SEC).toBe(10);
    expect(SMELT_RECIPES).toEqual({
      iron_ore: 'iron_ingot',
      raw_iron: 'iron_ingot',
      raw_gold: 'gold_ingot',
      gold_ore: 'gold_ingot',
      sand: 'glass',
      raw_chicken: 'cooked_chicken',
      raw_porkchop: 'cooked_porkchop',
      raw_mutton: 'cooked_mutton',
      raw_beef: 'steak',
    });
    expect(SMELT_RECIPES['coal_ore' as keyof typeof SMELT_RECIPES]).toBeUndefined();
    expect(FUEL_VALUES).toEqual({
      coal: 8,
      oak_log: 1.5,
      oak_planks: 1.5,
      stick: 0.5,
      spruce_log: 1.5,
      birch_log: 1.5,
      spruce_planks: 1.5,
      birch_planks: 1.5,
    });
  });

  it('raw gold and gold ore smelt into a gold ingot', () => {
    expect(SMELT_RECIPES.raw_gold).toBe('gold_ingot');
    expect(SMELT_RECIPES.gold_ore).toBe('gold_ingot');
    // 原版鑽石不能熔煉
    expect(SMELT_RECIPES.diamond).toBeUndefined();
  });

  it('the new logs and planks are fuel (same 1.5 as oak)', () => {
    expect(FUEL_VALUES.spruce_log).toBe(1.5);
    expect(FUEL_VALUES.birch_log).toBe(1.5);
    expect(FUEL_VALUES.spruce_planks).toBe(1.5);
    expect(FUEL_VALUES.birch_planks).toBe(1.5);
  });

  it('smelts raw_iron into an iron ingot', () => {
    const r = stepFurnace(burning({ input: stack('raw_iron', 1) }), 10);
    expect(r.completed).toBe(1);
    expect(r.state.output).toEqual(stack('iron_ingot', 1));
    expect(r.state.input).toBeNull(); // the single raw iron was consumed
  });
});

describe('stepFurnace', () => {
  it('empty furnace does not move', () => {
    const s = emptyFurnace();
    const r = stepFurnace(s, 5);
    expect(r.completed).toBe(0);
    expect(r.state).toEqual(emptyFurnace());
  });

  it('iron_ore + coal over 10 s → 1 iron_ingot, input −1, fuelUnits 7', () => {
    const r = stepFurnace(burning(), 10);
    expect(r.completed).toBe(1);
    expect(r.state.output).toEqual(stack('iron_ingot', 1));
    expect(r.state.input).toEqual(stack('iron_ore', 2));
    expect(r.state.fuel).toEqual(stack('coal', 1)); // 1 coal ignited
    expect(r.state.fuelUnits).toBe(7); // 8 − 1 completed
    expect(r.state.progressSec).toBe(0);
  });

  it('fuel exhausted mid-way freezes progress instead of resetting it', () => {
    const s = burning({ input: stack('iron_ore', 1), fuel: null, fuelUnits: 0, progressSec: 4 });
    const r = stepFurnace(s, 5);
    expect(r.completed).toBe(0);
    expect(r.state.progressSec).toBe(4); // frozen, not cleared
    expect(r.state.input).toEqual(stack('iron_ore', 1));
  });

  it('full output freezes progress', () => {
    const s = burning({ output: stack('iron_ingot', 64), progressSec: 6, fuelUnits: 3 });
    const r = stepFurnace(s, 5);
    expect(r.completed).toBe(0);
    expect(r.state.progressSec).toBe(6);
    expect(r.state.input).toEqual(stack('iron_ore', 3));
    expect(r.state.fuelUnits).toBe(3);
  });

  it('sand smelts into glass', () => {
    const s = burning({ input: stack('sand', 1), fuel: stack('stick', 1) });
    const r = stepFurnace(s, 10);
    expect(r.completed).toBe(1);
    expect(r.state.output).toEqual(stack('glass', 1));
    expect(r.state.input).toBeNull();
    expect(r.state.fuel).toBeNull();
    expect(r.state.fuelUnits).toBe(0); // 木棍 0.5 − 1（每完成一次冶煉扣 1）→ 夾在 ≥ 0
  });

  it('coal_ore is not smeltable — progress freezes', () => {
    const s = burning({ input: stack('coal_ore', 2), progressSec: 3 });
    const r = stepFurnace(s, 10);
    expect(r.completed).toBe(0);
    expect(r.state.progressSec).toBe(3);
    expect(r.state.input).toEqual(stack('coal_ore', 2));
    expect(r.state.output).toBeNull();
  });

  it('large dt smelts several items in one call', () => {
    const r = stepFurnace(burning(), 25);
    expect(r.completed).toBe(2);
    expect(r.state.output).toEqual(stack('iron_ingot', 2));
    expect(r.state.input).toEqual(stack('iron_ore', 1));
    expect(r.state.fuelUnits).toBe(6); // 8 − 2 completed
    expect(r.state.progressSec).toBe(5); // leftover dt keeps burning
  });

  it('non-positive or non-finite dt returns the state untouched with 0 completed', () => {
    const s = burning({ progressSec: 4, fuelUnits: 2 });
    for (const dt of [0, -1, NaN, Infinity, -Infinity]) {
      const r = stepFurnace(s, dt);
      expect(r.completed).toBe(0);
      expect(r.state).toBe(s);
    }
  });

  it('never mutates its input', () => {
    const s = burning();
    const before = JSON.parse(JSON.stringify(s)) as FurnaceState;
    stepFurnace(s, 30);
    expect(s).toEqual(before);
  });

  it('output holding a different item blocks progress', () => {
    const s = burning({ output: stack('glass', 5), progressSec: 2, fuelUnits: 4 });
    const r = stepFurnace(s, 10);
    expect(r.completed).toBe(0);
    expect(r.state.progressSec).toBe(2);
    expect(r.state.output).toEqual(stack('glass', 5));
    expect(r.state.fuelUnits).toBe(4);
  });

  it('a log covers one and a half smelts', () => {
    let s = emptyFurnace();
    s = { ...s, input: { item: 'raw_beef', count: 3 }, fuel: { item: 'oak_log', count: 1 } };
    const r = stepFurnace(s, 30);
    expect(r.completed).toBe(2);           // 1.5 次的燃料覆蓋 2 次冶煉
    expect(r.state.fuelUnits).toBe(0);     // 用盡（剩下的 0.5 直接捨去）
    expect(r.state.input?.count).toBe(1);  // 還剩一塊沒熔
    expect(r.state.output).toEqual(stack('steak', 2));
    expect(r.state.fuel).toBeNull();       // 那根原木已經點燃掉了
  });

  it('a stick covers half a smelt, so the next one waits for fuel', () => {
    let s = emptyFurnace();
    s = { ...s, input: { item: 'raw_beef', count: 3 }, fuel: { item: 'stick', count: 1 } };
    const r = stepFurnace(s, 30);
    expect(r.completed).toBe(1);
    expect(r.state.fuelUnits).toBe(0);
    expect(r.state.input?.count).toBe(2);  // 還剩兩塊沒熔
    expect(r.state.output).toEqual(stack('steak', 1));
  });

  it('a coal covers eight smelts', () => {
    let s = emptyFurnace();
    s = { ...s, input: { item: 'raw_beef', count: 10 }, fuel: { item: 'coal', count: 1 } };
    const r = stepFurnace(s, 80);
    expect(r.completed).toBe(8);
    expect(r.state.fuelUnits).toBe(0);
    expect(r.state.input?.count).toBe(2);  // 煤燒完了，剩下兩塊等新燃料
    expect(r.state.output).toEqual(stack('steak', 8));
  });

  it('smelting raw meat yields the cooked item', () => {
    const s = emptyFurnace();
    const r = stepFurnace(
      { ...s, input: { item: 'raw_chicken', count: 1 }, fuel: { item: 'coal', count: 1 } },
      10,
    );
    expect(r.completed).toBe(1);
    expect(r.state.output).toEqual({ item: 'cooked_chicken', count: 1 });
  });
});

describe('normalizeFurnaceState', () => {
  it('normalizeFurnaceState sanitizes the stacks and clamps the progress', () => {
    expect(normalizeFurnaceState({ input: { item: 'raw_iron', count: 2 }, fuel: null, output: null, progressSec: 999, fuelUnits: -1 }))
      .toEqual({ input: { item: 'raw_iron', count: 2 }, fuel: null, output: null, progressSec: SMELT_TIME_SEC, fuelUnits: 0 });
  });

  it('normalizeFurnaceState turns junk into an empty furnace', () => {
    expect(normalizeFurnaceState('garbage')).toEqual(emptyFurnace());
  });

  it('normalizeFurnaceState drops an unknown item id and bounds the count', () => {
    const st = normalizeFurnaceState({ input: { item: 'mystery', count: 1 }, fuel: { item: 'coal', count: 999 } });
    expect(st.input).toBeNull();
    expect(st.fuel!.count).toBe(64);
  });

  it('normalizeFurnaceState keeps the durability of a damaged tool', () => {
    expect(normalizeFurnaceState({ input: { item: 'iron_pickaxe', count: 1, dur: 100 } }).input)
      .toEqual({ item: 'iron_pickaxe', count: 1, dur: 100 });
  });
});
