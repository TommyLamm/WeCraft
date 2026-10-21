/**
 * 「地形已改變」一次性提示（B3 Task 8）——**純模組**。
 *
 * 為什麼需要這個提示：本作**從不保存區塊**，任何載入都是「從 seed 重新生成整個
 * 世界」再套用玩家改動的 overlay → 換一版生成器等於整片地形改觀（建築可能浮空、
 * 埋入或入水）。所以載入**舊存檔**（`worldgenVersion` 缺漏或 ≠ 當前版本）時要
 * 告知玩家一次。
 *
 * **與 B1.4 的新遊戲覆蓋確認框是兩條不同的路徑**（計畫 §8 的對照表）：
 *
 * | | B1.4 新遊戲覆蓋警告 | B3 地形已改變提示（本模組） |
 * |---|---|---|
 * | 觸發 | 標題畫面按「單人遊戲」且**有**既有進度 | **載入既有存檔進遊戲**（Continue／開機套用雲端進度） |
 * | UI | `menus.showConfirm` **模態**對話框（確定／取消，Esc＝取消） | `toasts.push` **右上角非模態通知**（自動消失） |
 * | 目的 | 防止誤覆蓋進度 | 告知地形外觀已整片改觀 |
 *
 * 所以本模組**不得**匯入 `menus`（那會把兩條路徑混在一起）、也不得匯入 bus 或
 * `main.ts`——它只認得 `Toasts` 這個**型別**，`push` 的實際對象由組裝根（`main.ts`）
 * 傳進來。
 *
 * 「一次性」語意由接線端（`main.ts`）負責，不在這裡：缺欄位（或欄位 ≠ 當前版本）
 * 才提示；提示後**立刻**把當前 session 的 payload 加上 `worldgenVersion` 寫回存檔
 * → 下次載入就不再提示。這裡只負責「提示長什麼樣、推到哪裡」。
 */

import type { ItemId } from '../core/items';
import type { Toasts } from './toast';

/** 提示標題（使用者要看到的字串）。 */
export const WORLDGEN_NOTICE_TITLE = '地形已改變';

/** 提示內文（使用者要看到的字串）。 */
export const WORLDGEN_NOTICE_TEXT =
  '世界生成器已更新：舊存檔的地形會整片改觀（你的建築可能浮空、埋入或入水）。';

/** 提示圖示（`Toasts.push` 只接受 `ItemId`）——草地＝地形。 */
export const WORLDGEN_NOTICE_ICON: ItemId = 'grass';

/**
 * 推一次「地形已改變」通知到右上角的 toast 堆（非模態、自動消失）。
 *
 * 只推**一個** toast；不碰 DOM、不排計時器（時機與自動消失都由 `Toasts`  owns），
 * 所以本函式是純粹的「把常數交給 toast 堆」。
 */
export function pushWorldgenNotice(toasts: Toasts): void {
  toasts.push({
    title: WORLDGEN_NOTICE_TITLE,
    description: WORLDGEN_NOTICE_TEXT,
    icon: WORLDGEN_NOTICE_ICON,
  });
}
