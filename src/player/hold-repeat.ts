/** 按住連放／連丟節拍（B2.2／B2.5）——純邏輯，不 import Three、不碰 DOM、
 *  不自己持有時鐘（時間由呼叫端以 `dt`（秒）喂進來）。
 *
 *  **節拍數值（本批定案，勿自行更動）**：
 *  - 放置連放：`PLACE_REPEAT_SEC` ＝ 0.2 秒（4 tick）。出處為 spec §B2.2
 *    已定案值（「首次照現行，之後每約 0.2 秒重複一次」）；原版 wiki
 *    （minecraft.wiki/Block，2026-10-20 抓 raw 全文）查 `4 tick`／`cooldown`／
 *    `repeat` 皆無記載，故本批以 0.2 秒落實，README 記為「4 tick 原版節奏」
 *    的**簡化值**，不是查證到的原版數字。
 *  - Q 長按連丟：`DROP_REPEAT_SEC` ＝ 0.2 秒／次。wiki（minecraft.wiki/Controls）
 *    只寫「holding the key causes single items to be dropped quickly」沒有數值
 *    → 採與放置連放同節奏的**簡化值**。
 *
 *  **本模組只負責「按住之後的重複」**：第一次觸發（第一次右鍵／第一次按 Q）
 *  由輸入層與 `src/main.ts` 負責，本模組不重複觸發第一次動作。
 *
 *  **一次最多扣一個間隔**：累積時間超過間隔時只觸發一次、只扣掉一個間隔，
 *  餘數留給下一幀繼續累積（避免單幀 dt 很大時一次爆放一堆方塊）。
 *
 *  **放開即歸零**：`held` 為 false 時累積器清零（下次按下要重新計時），
 *  且**不觸發**。
 *
 *  **防壞值**：`dt` 非有限（NaN／±∞）或 ≤ 0 時視為 0（時間不倒退、也不污染
 *  累積器）；累積器只在 `held` 為 true 時前進。
 *
 *  純度：本模組每個函式都回傳**全新物件**，入參一律不被修改（與
 *  `sprint.ts`／`view-mode.ts` 同一慣例）。 */

/** 放置連放的節拍間隔（秒）＝ 4 tick。 */
export const PLACE_REPEAT_SEC = 0.2;

/** Q 長按連丟的節拍間隔（秒）／次。 */
export const DROP_REPEAT_SEC = 0.2;

/** 按住連放的計時狀態。 */
export interface RepeatState {
  /** 已累積、尚未用掉的按住時間（秒）。 */
  acc: number;
}

/** 一幀的連放判定結果。 */
export interface RepeatStep {
  /** 本幀之後的狀態（全新物件）。 */
  state: RepeatState;
  /** 本幀是否觸發一次重複動作。 */
  fired: boolean;
}

/** 初始狀態：沒有累積時間。 */
export function createRepeatState(): RepeatState {
  return { acc: 0 };
}

/** 前進一幀的連放節拍。**回傳全新物件，入參 `state` 不被修改。**
 *
 *  - `held` 為 false（放開）→ 累積器歸零、不觸發。
 *  - `held` 為 true → 累積 `dt`（非有限或 ≤ 0 視為 0）；累積時間
 *    `>= intervalSec` → 觸發一次，且**只扣掉一個間隔**（餘數留給下一幀）。
 *
 *  前提：`intervalSec` 應為正有限秒數（呼叫端傳 `PLACE_REPEAT_SEC` 或
 *  `DROP_REPEAT_SEC`）；本模組不另為不合法間隔定義策略。 */
export function stepRepeat(
  state: RepeatState,
  held: boolean,
  dt: number,
  intervalSec: number,
): RepeatStep {
  if (!held) {
    return { state: { acc: 0 }, fired: false };
  }
  const delta = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const acc = state.acc + delta;
  if (acc >= intervalSec) {
    // 一次只扣一個間隔：剩下的時間留給下一幀，避免單幀爆放。
    return { state: { acc: acc - intervalSec }, fired: true };
  }
  return { state: { acc }, fired: false };
}
