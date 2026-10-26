import type { ItemId, ItemStack } from '../core/items';
import type { Vitals } from './survival';

/** 食物值表 ＋ 按住進食的狀態機（純邏輯 —— 不依賴 DOM／Three／main.ts 狀態）。
 *
 *  - `FOOD_VALUES`：原版的食物值表（飢餓值 ＋ 飽食度），數值逐字照抄 wiki。
 *  - `canEat`：**滿飢餓不可進食**（`hunger >= maxHunger` → false）。
 *  - `EatProgress`：按住進食的計時（原版 32 tick ＝ 1.6 秒）；放開、換物品
 *    或不允許進食 → 進度歸零。
 *  - `eatTick`：把「右鍵目前是否仍按住」與進度綁在一起的每幀入口（本批自有的
 *    純邏輯；旗標欄位由 B2 擁有 → 本模組只消費 `held` 參數）。
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

/** 蘋果的食物值（**單一真值**）：`FOOD_VALUES.apple` 與 `APPLE_FOOD`／`APPLE_SAT`
 *  共用這一份 → 不會出現「改了表卻忘了改常數」的漂移。
 *  `as const` 讓 `APPLE_FOOD`／`APPLE_SAT` 維持原本的常數型別（`4`／`2.4`）。 */
const APPLE_FOOD_DEF = { food: 4, saturation: 2.4 } as const;

/** 原版的食物值表（10 筆；數值逐字照抄 wiki，2026-10-20 查證）。
 *  鍵順序照表；不是食物的物品不在表內。 */
export const FOOD_VALUES: Readonly<Partial<Record<ItemId, FoodDef>>> = {
  apple: APPLE_FOOD_DEF,
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

/** 蘋果的食物值 —— **與 `FOOD_VALUES.apple` 相同**（值 4／2.4，同一個來源）。
 *  這裡不寫 `FOOD_VALUES.apple.food`：`FOOD_VALUES` 的型別是
 *  `Partial<Record<ItemId, FoodDef>>`，取值會是 `FoodDef | undefined`
 *  → 嚴格模式下 `tsc` 報可能未定義；改從上面的單一真值 `APPLE_FOOD_DEF` 取。
 *  兩者的一致性仍由測試 `expect(APPLE_FOOD).toBe(FOOD_VALUES.apple?.food)` 釘死。 */
export const APPLE_FOOD = APPLE_FOOD_DEF.food;
export const APPLE_SAT = APPLE_FOOD_DEF.saturation;

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
 *  註：`src/main.ts` 的進食路徑在 Task 9 改成「按住右鍵 1.6 秒」並依
 *  `foodFor()` 取食物值（不再寫死蘋果的 4／2.4）。 */
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
 *  - 累積到 `EAT_TIME_SEC`（1.6 秒）→ 回 `'eaten'` 並歸零累積器；
 *  - **A7：一次按壓只吃一份** —— 吃過之後 `completed` 鎖存，**還按著**也不再
 *    回 `'eaten'`（見下）。
 *
 *  回傳 `'idle'`（沒在吃）／`'eating'`（按住中）／`'eaten'`（吃掉了）。
 *  非有限或非正的 `dtSec` 一律當 0（不污染累積器）。 */
export class EatProgress {
  /** 已按住進食的秒數（累積）。 */
  elapsed = 0;
  /** 正在吃的物品；null ＝ 沒在吃。 */
  item: ItemId | null = null;
  /**
   * **A7：這一輪按壓已經吃過一份。**
   *
   *  審查 A7：舊碼在 `'eaten'` 後只歸零 `elapsed` → **還按著**的話，每再滿
   *  1.6 秒又會回 `'eaten'`（探針實測 `eaten eaten`）＝按住右鍵連續吃多份，
   *  可灌飢餓／經驗。規則「按住右鍵 1.6 s 進食」＝**一次按壓吃一份**。
   *  只有**放開**（`reset()`）、**換物品**或**不允許進食**才解除鎖存。
   */
  completed = false;

  /** 進度歸零（放開按鍵、取消進食）。A7：鎖存一併解除——放開＝下一次按壓
   *  可以再吃一份。 */
  reset(): void {
    this.elapsed = 0;
    this.item = null;
    this.completed = false;
  }

  /** 推進一幀的進食計時；回傳本幀後的狀態。 */
  update(dtSec: number, item: ItemId | null, allowed: boolean): 'idle' | 'eating' | 'eaten' {
    if (!allowed || item === null) {
      this.reset();
      return 'idle';
    }
    if (this.item !== item) {
      // 換物品 → 重新計時（A7：也解除「已吃過」的鎖存——「一次按壓一份」
      // 綁的是**按壓**，換了食物再按住可以再吃一份）。
      this.item = item;
      this.elapsed = 0;
      this.completed = false;
    }
    if (this.completed) {
      // A7：還按著，但這一輪已經吃過 → 不再累積、不再回 'eaten'。
      // 回 'eating'（不是 'idle'）——狀態仍是「按住進食中」，只是不再觸發；
      // 呼叫端看到 `elapsed === 0` 就不會顯示進度條。
      return 'eating';
    }
    const dt = Number.isFinite(dtSec) && dtSec > 0 ? dtSec : 0;
    this.elapsed += dt;
    if (this.elapsed >= EAT_TIME_SEC) {
      this.elapsed = 0;
      this.completed = true; // A7：吃過一份 → 鎖存到放開／換物品
      return 'eaten';
    }
    return 'eating';
  }
}

/** 每幀推進進食狀態（純邏輯；本批自有的進食規則入口）。
 *
 *  `held` ＝ 右鍵目前是否仍按住（由呼叫端從 `input.state.placeHeld` 讀入 ——
 *  **那個旗標欄位由 B2（0.5.0）擁有，本模組不碰輸入層**）。
 *  - 放開右鍵 → 進度歸零（回 `'idle'`）；
 *  - 按住且允許進食 → 累積（`'eating'`）；
 *  - 累積滿 `EAT_TIME_SEC`（1.6 秒）→ 回 `'eaten'`（**呼叫端才扣物品**）；
 *  - **A7：吃過之後還按著就不會再回 `'eaten'`** —— 要放開（或換物品）才能
 *    再吃一份（一次按壓＝一份；見 `EatProgress.completed`）。
 *
 *  **為什麼「按住」的語意放在這裡（而不是輸入層）**：這樣「按住右鍵才吃東西」
 *  這條規則可以被單元測試釘死（`eatTick` 是純函式），而 B2 擁有的輸入層一行
 *  都不用改 —— B2 先合併或 B4 先合併都不會撞號。
 *
 *  **脈衝與按住是兩件事**：`input.state.place` 是「右鍵被按下過一次」的單擊脈衝
 *  （放置方塊、開工作台靠它）；`input.state.placeHeld` 是「右鍵目前還按著」。
 *  進食用 `placeHeld` 累積時間，放置仍用脈衝 —— 兩者不互相吃掉。
 *
 *  `allowed` 由呼叫端用 `canEat(vitals, item)` 判定（**滿飢餓不可進食**：
 *  為 false 時 `EatProgress.update()` 會歸零並回 `'idle'` → 不開始進食、
 *  也不消耗物品）。
 *
 *  **IEEE-754 邊界**：`EatProgress.update()` 的比較維持 `elapsed >= EAT_TIME_SEC`
 *  （不變）。`EAT_TIME_SEC` 是最接近 1.6 的那個 double（1.6000000000000000888…）
 *  → 「整整 1.6 秒」累積出來的值恰好就是它，`>=` 成立 → 吃掉；而
 *  「1.59 + 0.005 + 0.005」在浮點下是 1.5999999999999998668（**嚴格小於**那個
 *  門檻）→ 那一刻其實還沒滿 1.6 秒。**這是浮點的偽像、不是規則** → 測試用
 *  0.01 跨過門檻，門檻本身由「整整 1.6 秒」那條案例釘死。 */
export function eatTick(
  progress: EatProgress,
  opts: { held: boolean; item: ItemId | null; allowed: boolean; dtSec: number },
): 'idle' | 'eating' | 'eaten' {
  if (!opts.held) {
    // 放開右鍵 → 進度歸零（重新按住要從零開始累積）。
    progress.reset();
    return 'idle';
  }
  return progress.update(opts.dtSec, opts.item, opts.allowed);
}
