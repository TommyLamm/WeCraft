import { BLOCK } from '../world/blocks';
import type { ItemStack } from '../core/items';

/** B16 Task 7：水桶裝水／倒水的**決策規則**——純邏輯，不 import DOM／Three、
 *  不讀遊戲狀態（與 `player/drop.ts` 同一套慣例：規則在純模組、可單元測試，
 *  射線／音效／寫世界由組裝根 `src/main.ts` 接線）。
 *
 *  **為什麼抽成純模組**：「空桶能不能裝這格水」是一條**全域約束**（只能從
 *  水源裝水、且前面不能有更近的方塊擋著）——放在組裝根等於沒有任何自動化
 *  防護（回歸時無網可攔）。抽出後由 `src/player/bucket.test.ts` 釘住。 */

/** 水源、最近命中：空桶可以裝水。flow/fall 不算水源。
 *
 *  - `waterId` 必須是**水源**（`BLOCK.WATER`）——流動水（`WATER_FLOW_*`）與
 *    水柱（`WATER_FALL`）只是水源流出去的形狀，裝走它們不會「消耗」水。
 *  - `waterT` 是命中水的距離（射線原點起算）→ 必須有限且 ≥ 0。
 *  - `blockT` 是**一般射線**（不含水）命中的方塊距離；`null` ＝ 沒命中任何
 *    方塊。若方塊比水**更近**（`blockT < waterT`），代表水源被擋在牆後 →
 *    不該穿過去裝水（與原版「對著面前的方塊舀不到後面的水」一致）。
 *    `blockT` 非有限（NaN／±Infinity）視為「沒有更近的方塊」→ 不阻擋。
 *    `blockT === waterT`（同一距離）視為方塊沒有更近 → 放行。 */
export function canFillBucket(
  waterId: number,
  waterT: number,
  blockT: number | null,
): boolean {
  if (waterId !== BLOCK.WATER) return false; // 只有水源能裝（flow/fall 不算）
  if (!Number.isFinite(waterT) || waterT < 0) return false; // 距離不合法 → 不裝
  if (blockT === null) return true; // 一般射線沒命中方塊 → 水源就是最近的
  if (!Number.isFinite(blockT)) return true; // 非有限距離 → 視為沒有更近的方塊
  return blockT >= waterT; // 方塊更近 → 被擋住，不裝
}

/** 裝水後手持的物品（新物件，count 1）——空桶 ↔ 水桶的**一對一互換**，
 *  不複製、不吞物品（創造與生存都走同一條規則：桶不會被消耗、也不會憑空
 *  多出來）。每次呼叫都回傳**新物件**，呼叫端可以安全地把 stack 放進背包。 */
export function bucketAfterFill(): ItemStack {
  return { item: 'water_bucket', count: 1 };
}

/** 倒水後手持的物品。同上：水桶 ↔ 空桶一對一互換、每次回傳新物件。 */
export function bucketAfterEmpty(): ItemStack {
  return { item: 'bucket', count: 1 };
}
