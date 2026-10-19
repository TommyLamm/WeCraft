import { describe, it, expect } from 'vitest';
import {
  emptyFurnace,
  stepFurnace,
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
  it('smelt takes 10 s; raw_iron/iron_ore→iron_ingot and sand→glass; coal_ore excluded', () => {
    expect(SMELT_TIME_SEC).toBe(10);
    expect(SMELT_RECIPES).toEqual({
      iron_ore: 'iron_ingot',
      raw_iron: 'iron_ingot',
      sand: 'glass',
    });
    expect(SMELT_RECIPES['coal_ore' as keyof typeof SMELT_RECIPES]).toBeUndefined();
    expect(FUEL_VALUES).toEqual({ coal: 8, oak_log: 2, oak_planks: 2, stick: 1 });
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
    expect(r.state.fuelUnits).toBe(0); // 1 − 1 completed
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
});
