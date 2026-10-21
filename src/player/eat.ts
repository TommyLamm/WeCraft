import type { ItemId, ItemStack } from '../core/items';
import type { Vitals } from './survival';

/** 食物值表 ＋ 按住進食的狀態機（純邏輯 —— 不依賴 DOM／Three／main.ts 狀態）。
 *
 *  - `FOOD_VALUES`：原版的食物值表（飢餓值 ＋ 飽食度），數值逐字照抄 wiki。
 *  - `canEat`：**滿飢餓不可進食**（`hunger >= maxHunger` → false）。
 *  - `EatProgress`：按住進食的計時（原版 32 tick ＝ 1.6 秒）；放開、換物品
 *    或不允許進食 → 進度歸零。
 *
 *  與原版的差異（Task 12 的 README〈與原版的差異〉要列出，本批不做）：
 *  1. 腐肉 80% 機率給「飢餓」狀態效果 —— 本作沒有狀態效果系統，不實作。
 *  2. 生雞肉 30% 機率給「飢餓」狀態效果 —— 同上，不實作。
 *  3. 飽食度上限＝`maxHunger`(20)；原版是把飽食度夾在「當前 food level
 *     （飢餓值）」，所以原版飢餓 19 時飽食度不會超過 19。本批**不改**
 *     `survival.eat()` 的既有 clamp（那是既有不變量，其測試釘著它）。 */

/** 一筆食物的食物值：吃下去恢復的飢餓值與飽食度。 */
export interface FoodDef {
  /** 恢復的飢餓值（food points）。 */
  food: number;
  /** 恢復的飽食度（saturation）。 */
  saturation: number;
}

/** 原版的食物值表（10 筆；數值逐字照抄 wiki，2026-10-20 查證）。
 *  鍵順序照表；不是食物的物品不在表內。 */
export const FOOD_VALUES: Readonly<Partial<Record<ItemId, FoodDef>>> = {
  apple: { food: 4, saturation: 2.4 },
  raw_chicken: { food: 2, saturation: 1.2 },
  cooked_chicken: { food: 6, saturation: 7.2 },
  raw_porkchop: { food: 3, saturation: 1.8 },
  cooked_porkchop: { food: 8, saturation: 12.8 },
  raw_mutton: { food: 2, saturation: 1.2 },
  cooked_mutton: { food: 6, saturation: 9.6 },
  raw_beef: { food: 3, saturation: 1.8 },
  steak: { food: 8, saturation: 12.8 },
  rotten_flesh: { food: 4, saturation: 0.8 },
};

/** 蘋果的食物值 —— **與 `FOOD_VALUES.apple` 相同**（值 4／2.4）。
 *  寫成常數而不是 `FOOD_VALUES.apple.food`：`FOOD_VALUES` 的型別是
 *  `Partial<Record<ItemId, FoodDef>>`，取值會是 `FoodDef | undefined`
 *  → 嚴格模式下 `tsc` 報可能未定義。兩者的一致性由測試
 *  `expect(APPLE_FOOD).toBe(FOOD_VALUES.apple?.food)` 釘死。 */
export const APPLE_FOOD = 4;
export const APPLE_SAT = 2.4;

/** 按住進食要多久才真的吃下去：原版 32 tick ＝ 1.6 秒。 */
export const EAT_TIME_SEC = 1.6;

/** 查物品的食物值；不是食物（或查不到）回 null。
 *  `hasOwnProperty` 守門：`FOOD_VALUES['toString']` 會命中
 *  `Object.prototype`（repo 的原型鍵守門慣例）。 */
export function foodFor(item: ItemId): FoodDef | null {
  if (!Object.prototype.hasOwnProperty.call(FOOD_VALUES, item)) return null;
  return FOOD_VALUES[item] ?? null;
}

/** 現在能不能吃 `item`：**必須是食物，而且還沒吃飽**。
 *  滿飢餓（`hunger >= maxHunger`）不可進食 —— 舊註解寫的「滿飢餓照吃
 *  （溢出浪費，Minecraft parity）」是錯的，spec §B4.3 明訂滿飢餓不可進食。 */
export function canEat(v: Vitals, item: ItemId): boolean {
  if (!foodFor(item)) return false;
  return v.hunger < v.maxHunger;
}

export interface EatResult {
  readonly slots: ReadonlyArray<ItemStack | null>;
  readonly ate: boolean;
}

/** 從 `slots[index]` 吃掉一份食物（純函式 —— 輸入永遠不被改動）。
 *  **任何有食物值的物品都吃得掉**（蘋果、生／熟肉、腐肉……）；不是食物、
 *  空格子或越界 → 回傳**同一個陣列參考**且 `ate: false`
 *  （miss → same ref，`spawnBlockDrop` 慣例）。
 *  數量 ≥ 2 → 減 1（新的陣列 ＋ 新的 stack）；數量 1 或非正／非有限 → 清空
 *  格子（不留下污染過的 stack）。
 *  註：`src/main.ts` 的右鍵脈衝進食路徑目前仍用 `APPLE_FOOD`／`APPLE_SAT`
 *  套用食物值 —— Task 9 會整段改寫成「按住 1.6 秒」並依 `foodFor()` 取值。 */
export function eatFromSlot(
  slots: ReadonlyArray<ItemStack | null>,
  index: number,
): EatResult {
  const s = slots[index];
  if (!s || !foodFor(s.item)) return { slots, ate: false };
  const next = slots.slice();
  next[index] = s.count - 1 >= 1 ? { item: s.item, count: s.count - 1 } : null;
  return { slots: next, ate: true };
}

/** 按住進食的狀態機（純邏輯；呼叫端每幀呼叫 `update()`）。
 *
 *  `update(dtSec, item, allowed)`：
 *  - `allowed` 為 false 或 `item` 為 null → `reset()` 並回 `'idle'`
 *    （放開右鍵、不是食物、已吃飽……都走這裡）；
 *  - 換手上的物品 → 進度歸零重新累積（不可把上一個食物的按住時間算進去）；
 *  - 累積到 `EAT_TIME_SEC`（1.6 秒）→ 回 `'eaten'` 並歸零累積器，
 *    讓下一次進食從零開始。
 *
 *  回傳 `'idle'`（沒在吃）／`'eating'`（按住中）／`'eaten'`（吃掉了）。
 *  非有限或非正的 `dtSec` 一律當 0（不污染累積器）。 */
export class EatProgress {
  /** 已按住進食的秒數（累積）。 */
  elapsed = 0;
  /** 正在吃的物品；null ＝ 沒在吃。 */
  item: ItemId | null = null;

  /** 進度歸零（放開按鍵、取消進食）。 */
  reset(): void {
    this.elapsed = 0;
    this.item = null;
  }

  /** 推進一幀的進食計時；回傳本幀後的狀態。 */
  update(dtSec: number, item: ItemId | null, allowed: boolean): 'idle' | 'eating' | 'eaten' {
    if (!allowed || item === null) {
      this.reset();
      return 'idle';
    }
    if (this.item !== item) {
      // 換物品 → 重新計時
      this.item = item;
      this.elapsed = 0;
    }
    const dt = Number.isFinite(dtSec) && dtSec > 0 ? dtSec : 0;
    this.elapsed += dt;
    if (this.elapsed >= EAT_TIME_SEC) {
      this.elapsed = 0;
      return 'eaten';
    }
    return 'eating';
  }
}
