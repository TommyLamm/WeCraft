// 「地形已改變」提示的**時機決策**（Task 20／審查 Minor 14）。
//
// 原本這兩條規則只存在 `main.ts` 的 `armWorldgenNotice`／`flushWorldgenNotice`
// 裡，靠 `main.wiring.test.ts` 的字串掃描守住（「哪個函式出現 `pushWorldgenNotice(`」）
// ——掃描對「搬家、改名、換皮的迴歸」無感。規則本身與 DOM／toast 無關 → 抽成
// 純函式（呼叫端的行為測試在 `worldgen-notice.test.ts`）。
//
// 規則（與 B3 Task 8 的原始行為逐條等價）：
//  - arm：存檔需要提示**且**這個 session 還沒跳過 → 值得排隊（開機套用雲端進度
//    時只排隊不跳——那時的 toast 疊在標題畫面上，玩家進遊戲後就看不到了）。
//  - flush：有排隊過**且**還沒跳過 → 這一刻跳（玩家進場／場中套用時才呼叫）。
import { needsWorldgenNotice } from './worldgen';

/** 這份載入的存檔值不值得**排隊**等玩家進場再提示？
 *
 *  `worldgenVersion` 由讀取端正規化過（`loadGame` 會剝除該鍵、
 *  `acceptCloudData` 會拒收非法值；`readWorldgenVersion` 是唯一判準）→ 這裡只會
 *  看到 `number | undefined | null`。`shown` ＝「這個 play session 已經跳過提示」
 *  的記號——已跳過的 session 不再排隊（同一筆進度被套用多次仍只跳一次）。 */
export function shouldArmNotice(
  worldgenVersion: number | undefined | null,
  shown: boolean,
): boolean {
  return needsWorldgenNotice(worldgenVersion) && !shown;
}

/** 這一刻值不值得**跳**提示？（呼叫端必須是「玩家看得到 toast 的那一刻」）
 *
 *  `armed` ＝ 之前排過隊；`shown` ＝ 這個 session 已經跳過。flush 的呼叫端一律
 *  **先消費掉排隊旗標**再問這顆函式——與舊碼相同：flush 過一次之後，即使當下
 *  因為已跳過而沒顯示，也不會留著旗標等下次。 */
export function shouldFlushNotice(armed: boolean, shown: boolean): boolean {
  return armed && !shown;
}
