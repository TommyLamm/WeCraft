// 本機存檔失敗的回應策略（純規則；審查 A3）。
//
// A3 的兩個問題：
// 1. `persistNow` 的 catch 把錯誤**吞掉**——玩家完全不知道存檔失敗了（下一次
//    自動存檔又失敗時還是不知道）。
// 2. 「儲存並離開」失敗時**仍然直接退出**到標題——玩家以為存好了，其實沒有，
//    進度就此消失。
//
// 這裡只描述「該怎麼回應」，不碰 IO；main.ts（composition root）把它接到
// toast、暫停選單與自動重試上。
import { describe, it, expect } from 'vitest';
import { SAVE_RETRY_DELAY_MS, saveFailurePolicy } from './save-failure';

describe('saveFailurePolicy (A3)', () => {
  it('an autosave failure tells the player and schedules a retry', () => {
    const p = saveFailurePolicy('autosave');
    expect(p.title).toContain('本機存檔失敗');
    expect(p.description).toContain('自動重試');
    expect(p.keepInGame).toBe(true);
    expect(p.retryInMs).toBe(SAVE_RETRY_DELAY_MS);
    expect(p.retryInMs).toBeGreaterThan(0);
  });

  it('a Save & Quit failure keeps the player in the game (never a silent quit)', () => {
    const p = saveFailurePolicy('save-quit');
    expect(p.title).toContain('儲存失敗');
    expect(p.description).toContain('停留在遊戲');
    expect(p.keepInGame).toBe(true);
    // No automatic retry here: the player is right there in the pause menu and
    // can press 儲存並離開 again (a background retry would fight them).
    expect(p.retryInMs).toBe(0);
  });

  it('every failure context keeps the session alive', () => {
    for (const context of ['autosave', 'save-quit'] as const) {
      expect(saveFailurePolicy(context).keepInGame).toBe(true);
    }
  });
});
