import type { ItemId, ItemStack } from '../core/items';

/** Seconds to smelt one item. */
export const SMELT_TIME_SEC = 10 as const;

/** Smeltable input item → output item. coal_ore is deliberately absent: it
 *  drops coal directly (see dropItemFor) instead of smelting. */
export const SMELT_RECIPES: Readonly<Record<string, ItemId>> = {
  iron_ore: 'iron_ingot',
  sand: 'glass',
};

/** Burnable fuel item → smelts completable per 1 item ignited. */
export const FUEL_VALUES: Readonly<Record<string, number>> = {
  coal: 8,
  oak_log: 2,
  oak_planks: 2,
  stick: 1,
};

export interface FurnaceState {
  input: ItemStack | null;
  fuel: ItemStack | null;
  output: ItemStack | null;
  progressSec: number;
  /** Whole smelts the lit fuel still covers; −1 per completed item. */
  fuelUnits: number;
}

export function emptyFurnace(): FurnaceState {
  return { input: null, fuel: null, output: null, progressSec: 0, fuelUnits: 0 };
}

const validStack = (s: ItemStack | null): s is ItemStack =>
  !!s && Number.isFinite(s.count) && s.count >= 1;

/** Advance one furnace by `dtSec`. PURE — the input is never mutated; every
 *  taken branch returns a fresh state (untouched calls return it by reference).
 *  Rules:
 *  - non-finite / non-positive dt → unchanged, 0 completed;
 *  - progress accumulates only while the input is smeltable, the output can
 *    take the product (empty, or the same item below a full stack) and fuel
 *    covers the burn (fuelUnits > 0, or a burnable fuel stack to ignite);
 *  - igniting consumes 1 fuel item for FUEL_VALUES smelts before accumulating;
 *  - each finished smelt consumes 1 input, grows the output by 1, spends 1
 *    fuelUnit and restarts progress; leftover dt keeps burning (multi-smelt);
 *  - a blocked furnace (bad input, full/mismatched output, no fuel) FREEZES
 *    progressSec instead of clearing it, so re-fuelling resumes the burn. */
export function stepFurnace(
  s: FurnaceState,
  dtSec: number,
): { state: FurnaceState; completed: number } {
  if (!Number.isFinite(dtSec) || dtSec <= 0) return { state: s, completed: 0 };

  let input = validStack(s.input) ? { ...s.input } : null;
  let fuel = validStack(s.fuel) ? { ...s.fuel } : null;
  let output = s.output ? { ...s.output } : null;
  let progressSec = Number.isFinite(s.progressSec) ? Math.max(0, s.progressSec) : 0;
  let fuelUnits = Number.isFinite(s.fuelUnits) ? s.fuelUnits : 0;
  let completed = 0;
  let remaining = dtSec;

  while (remaining > 0) {
    const product = input ? SMELT_RECIPES[input.item] : undefined;
    if (!input || product === undefined) break; // not smeltable → freeze
    if (output && (output.item !== product || output.count >= 64)) break; // full/mismatch → freeze
    if (fuelUnits <= 0) {
      if (!fuel || FUEL_VALUES[fuel.item] === undefined) break; // nothing to burn → freeze
      const units = FUEL_VALUES[fuel.item] as number;
      fuel = fuel.count > 1 ? { item: fuel.item, count: fuel.count - 1 } : null;
      fuelUnits += units;
    }
    const need = SMELT_TIME_SEC - progressSec;
    if (need <= 0) {
      // carried a finished bar (e.g. output was full at 10 s) → settle now
      input = input.count > 1 ? { item: input.item, count: input.count - 1 } : null;
      output = output ? { item: output.item, count: output.count + 1 } : { item: product, count: 1 };
      fuelUnits -= 1;
      progressSec = 0;
      completed += 1;
      continue;
    }
    const burn = Math.min(remaining, need);
    progressSec += burn;
    remaining -= burn;
    if (progressSec >= SMELT_TIME_SEC) {
      input = input.count > 1 ? { item: input.item, count: input.count - 1 } : null;
      output = output ? { item: output.item, count: output.count + 1 } : { item: product, count: 1 };
      fuelUnits -= 1;
      progressSec = 0;
      completed += 1;
    }
  }

  return { state: { input, fuel, output, progressSec, fuelUnits }, completed };
}
