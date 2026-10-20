import type { ItemStack } from '../core/items';
import type { GameMode } from '../core/inventory';

/** B2.5（Task 10）：Q 丟棄的**決策規則**——純邏輯，不 import DOM／Three、
 *  不讀遊戲狀態（純函式慣例：回傳值、不改入參）。
 *
 *  **為什麼把決策從組裝根抽出來（對計畫的刻意偏離）**：計畫原本把 Q 的規則放在
 *  組裝根 `src/main.ts` 的 `dropSelected()` 裡，但下列三條是**全域約束**，放在
 *  組裝根等於沒有任何自動化防護（回歸時無網可攔）：
 *   ① 創造模式不丟、不消耗；
 *   ② 單次丟 1 個、Ctrl+Q 丟整疊；
 *   ③ 任何分支都不複製、不吞物品（丟出數量不得超過持有數量、不得憑空增加）。
 *  抽出成純函式後，三條都能用單元測試釘住（`src/player/drop.test.ts`）。
 *
 *  語意依據（minecraft.wiki/Controls，2026-10-20 抓 raw 全文）：「If items are
 *  stacked, **only one** gets thrown/tossed/dropped.」「**Control+Q drops the
 *  whole stack of items.**」
 *
 *  **本模組只決定「丟幾個」**；扣物品與生成掉落物由組裝根（`src/main.ts` 的
 *  `dropSelected()`）負責——那邊的順序是「先算出數量 → 先扣後生成」，保證熱鍵欄
 *  減少的數量與地上出現的數量必然相等（不複製、不吞物品）。
 *
 *  **與 `src/world/drops.ts` 的分工（兩檔名相近，勿看錯）**：本檔
 *  （`player/drop.ts`）只決定「**丟幾個**」（玩家操作層的決策、純函式、不碰
 *  世界）；`world/drops.ts` 才是「**地上的掉落物實體**」（世界層：生成、移動、
 *  拾取）。兩者層級不同，勿互相引用。 */

/** 這一次「丟棄」要丟幾個（`0` ＝ 不丟）。
 *
 *  - **創造模式 → 0**：不丟、不消耗（本批的簡化；Task 14 收斂 README 時要寫的
 *    內容之一）。
 *  - **手上沒有東西／數量 ≤ 0／數量不合法（NaN、±Infinity）→ 0**。
 *  - **生存模式 + 普通 Q → 1**：不論堆疊有幾個（wiki「only one gets thrown」）。
 *  - **生存模式 + Ctrl+Q → 整疊**：持有數量全丟。
 *
 *  **回傳值永遠 ≤ 持有數量**（整疊時恰等於持有數量；單個時為 1，而該分支只在
 *  持有數量 ≥ 1 時才會走到）→ 這是「不複製、不吞物品」的第一道防線：丟出數量
 *  永遠不可能超過玩家手上有的數量。 */
export function dropCount(
  stack: ItemStack | null,
  wholeStack: boolean,
  mode: GameMode,
): number {
  if (mode === 'creative') return 0; // 創造模式不丟、不消耗
  if (!stack) return 0; // 空格
  // 整數化：`spendFromSlot` 只接受整數（Number.isInteger）→ 回傳值必須是整數。
  // **非整數持有數的取捨（實務不可達）**：這裡用 `Math.floor` **向下取整**
  // （3.9 → 3），**不是**「視為沒有可丟的東西」（→ 0）。這與**舊行為不同**：
  // 舊的 `dropSelected` 直接把 `stack.count`（3.9）交給 `spendFromSlot` → 因為
  // 不是整數而被拒 → **整個不丟**；現在則丟 3 個。**實務不可達**：背包的數量
  // 本來就是整數（`setSlot` 取 `Math.floor`；`addItem` 的呼叫端——挖方塊、拾取
  // 掉落物——也只餵整數）→ 這個分支只是把邊界行為釘死，不改變任何可達行為。
  const held = Math.floor(stack.count);
  if (!Number.isFinite(held) || held < 1) return 0;
  if (wholeStack) return held; // Ctrl+Q → 整疊（不超過持有數量）
  return 1; // Q → 1 個
}
