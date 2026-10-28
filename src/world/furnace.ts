// 熔爐：食譜、燃料值與「可覆蓋次數」的燃料模型。
//
// `fuelUnits` = 目前已點燃的燃料**還能覆蓋幾次冶煉**，**可為小數**：
//   - 點燃一件燃料時 `fuelUnits += FUEL_VALUES[燃料]`；
//   - 每完成一次冶煉扣 1，並夾在 ≥ 0（`Math.max(0, fuelUnits - 1)`）。
// 燃料值＝原版的「燃燒秒數 ÷ 每件 10 秒」（煤 80 秒＝8、原木 15 秒＝1.5、
// 板材 15 秒＝1.5、木棍 5 秒＝0.5；wiki「Smelting table」模板，2026-10-20 複核）。
//
// **與原版的差異（刻意的簡化，記在 README 差異清單裡）**：原版熔爐是「連續
// 燃燒計時器」——1 根原木燃 15 秒，熔完第一件（10 秒）後只剩 5 秒，第二件
// 只燒得完 5 秒就熄火、冶煉暫停等新燃料。本作沿用既有的「可覆蓋次數」
// 模型，於是 1.5 的燃料會覆蓋 **2 次** 冶煉（多出的 0.5 直接捨去）；
// 同理一根木棍（0.5）在原版不足以熔完任何一件，在本作卻能熔 1 件。
import type { ItemId, ItemStack } from '../core/items';
import { sanitizeStackClamped } from '../core/items';

/** Seconds to smelt one item. */
export const SMELT_TIME_SEC = 10 as const;

/** 熔爐燃料剩餘「可熔煉次數」的上限：64 個煤 × `FUEL_VALUES.coal` 8 ＝ 512。 */
export const MAX_FUEL_UNITS = 512;

/** Smeltable input item → output item. Both iron inputs smelt to iron_ingot:
 *  `raw_iron` is what iron_ore blocks drop now (MC 1.17+ parity); legacy
 *  `iron_ore` items from pre-B1 saves still smelt. coal_ore is deliberately
 *  absent: it drops coal directly (see dropItemFor). 金礦與生金都熔成金錠
 *  （原版）；鑽石不可熔煉。
 *  四種生肉（B4.3）也能熔成熟肉：雞→燒雞、豬→豬排、羊→羊排、牛→牛排
 *  （原版 id 就是 'steak'，不是 'cooked_beef'）。 */
export const SMELT_RECIPES: Readonly<Record<string, ItemId>> = {
  iron_ore: 'iron_ingot',
  raw_iron: 'iron_ingot',
  gold_ore: 'gold_ingot',
  raw_gold: 'gold_ingot',
  sand: 'glass',
  raw_chicken: 'cooked_chicken',
  raw_porkchop: 'cooked_porkchop',
  raw_mutton: 'cooked_mutton',
  raw_beef: 'steak',
};

/** Burnable fuel item → smelts completable per 1 item ignited. **可為小數**：
 *  值＝原版的「燃燒秒數 ÷ SMELT_TIME_SEC(10)」（煤 80 秒＝8、原木 15 秒＝1.5、
 *  板材 15 秒＝1.5、木棍 5 秒＝0.5）。雲杉／白樺與橡木同值（B5）。 */
export const FUEL_VALUES: Readonly<Record<string, number>> = {
  coal: 8,
  oak_log: 1.5,
  oak_planks: 1.5,
  stick: 0.5,
  spruce_log: 1.5,
  birch_log: 1.5,
  spruce_planks: 1.5,
  birch_planks: 1.5,
};

export interface FurnaceState {
  input: ItemStack | null;
  fuel: ItemStack | null;
  output: ItemStack | null;
  progressSec: number;
  /** Smelts the lit fuel still covers — **可為小數**（1.5 = 原木的 15 秒）；
   *  −1 per completed item, clamped at 0. */
  fuelUnits: number;
}

export function emptyFurnace(): FurnaceState {
  return { input: null, fuel: null, output: null, progressSec: 0, fuelUnits: 0 };
}

/** 把不可信的熔爐狀態正規化（載入端）：三個堆疊過 `sanitizeStackClamped`，
 *  `progressSec` 夾到 `0..SMELT_TIME_SEC`，`fuelUnits` 夾到
 *  `0..MAX_FUEL_UNITS`。非物件 → `emptyFurnace()`。
 *
 *  `fuelUnits` 保留小數（本模組的既有契約：原木／板材 1.5、木棍 0.5），
 *  不取整——取整會在每次讀檔時丟掉不足一次的燃料進度。 */
export function normalizeFurnaceState(raw: unknown): FurnaceState {
  if (typeof raw !== 'object' || raw === null) return emptyFurnace();
  const r = raw as Partial<FurnaceState>;
  const progressSec =
    typeof r.progressSec === 'number' && Number.isFinite(r.progressSec)
      ? Math.min(Math.max(0, r.progressSec), SMELT_TIME_SEC)
      : 0;
  const fuelUnits =
    typeof r.fuelUnits === 'number' && Number.isFinite(r.fuelUnits)
      ? Math.min(Math.max(0, r.fuelUnits), MAX_FUEL_UNITS)
      : 0;
  return {
    input: sanitizeStackClamped(r.input),
    fuel: sanitizeStackClamped(r.fuel),
    output: sanitizeStackClamped(r.output),
    progressSec,
    fuelUnits,
  };
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
 *  - igniting consumes 1 fuel item and adds FUEL_VALUES[item] smelts to
 *    fuelUnits (可為小數：煤 8／原木 1.5／板材 1.5／木棍 0.5);
 *  - each finished smelt consumes 1 input, grows the output by 1, spends 1
 *    fuelUnit (fuelUnits = Math.max(0, fuelUnits − 1)) and restarts progress;
 *    leftover dt keeps burning (multi-smelt);
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
      fuelUnits = Math.max(0, fuelUnits - 1); // 扣 1 次，夾在 ≥ 0
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
      fuelUnits = Math.max(0, fuelUnits - 1); // 扣 1 次，夾在 ≥ 0
      progressSec = 0;
      completed += 1;
    }
  }

  return { state: { input, fuel, output, progressSec, fuelUnits }, completed };
}
