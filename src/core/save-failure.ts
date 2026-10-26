// 本機存檔失敗的回應策略（純規則；審查 A3）。
//
// A3 的兩個問題：
// 1. `persistNow` 的 catch 把錯誤**吞掉**——玩家完全不知道存檔失敗了。
// 2. 「儲存並離開」失敗時仍然**直接退出**到標題——玩家以為存好了，其實沒有，
//    進度就此消失。
//
// 這裡只描述「該怎麼回應」，不碰 IO；main.ts（composition root）把它接到
// toast、暫停選單與自動重試上。

/** 存檔失敗的自動重試延遲（10 s）。存檔失敗多半是暫時性的（IndexedDB 被
 *  另一個分頁鎖住、磁碟忙碌），短時間後再試一次通常就成功——但不能立刻重試
 *  （失敗原因多半不會在幾毫秒內消失）。 */
export const SAVE_RETRY_DELAY_MS = 10_000;

/** 失敗發生在哪條路徑上——決定「留在哪裡」與「要不要自動重試」。
 *  - `'autosave'`：自動存檔／切到背景時存檔（玩家正在玩）。
 *  - `'save-quit'`：暫停選單的「儲存並離開」（玩家已經表明要走了）。 */
export type SaveFailureContext = 'autosave' | 'save-quit';

export interface SaveFailurePolicy {
  /** Toast 標題。 */
  title: string;
  /** Toast 說明。 */
  description: string;
  /** 一律 true：存檔失敗**不得**結束 session。玩家要嘛還在玩，要嘛留在暫停
   *  選單裡——「以為存好了其實沒有」正是 A3 指出的傷害。 */
  keepInGame: boolean;
  /** 自動重試的延遲（ms；0 = 不自動重試）。 */
  retryInMs: number;
}

/** 依失敗路徑給出回應策略（單一真值）。 */
export function saveFailurePolicy(context: SaveFailureContext): SaveFailurePolicy {
  if (context === 'save-quit') {
    return {
      title: '儲存失敗',
      description: '已停留在遊戲，請再試一次',
      keepInGame: true,
      // 玩家就在暫停選單裡、可以自己再按一次「儲存並離開」——背景自動重試
      // 反而會和玩家的操作打架。
      retryInMs: 0,
    };
  }
  return {
    title: '本機存檔失敗',
    description: '稍後自動重試',
    keepInGame: true,
    retryInMs: SAVE_RETRY_DELAY_MS,
  };
}
