// B3 Task 8：「地形已改變」一次性提示的**純模組**測試。
//
// 這支測試只釘住「提示是什麼」與「提示走哪條路徑」：
// - 文案逐字釘死（使用者要看到的字串）。
// - 路徑釘死：這是 **toast**（非模態、右上角、自動消失），**不是** B1.4 的
//   `menus.showConfirm` 模態確認框——所以本模組不得 import `menus`（用原始碼
//   掃描釘住：只准 import 型別，不准 import 任何 bus／main／menus）。
//
// 「什麼時候提示、提示後寫回存檔」是 `main.ts` 的接線（組裝根未測），
// 那條路徑以人工／瀏覽器驗收為準（見 task-8-report.md）。

import { describe, it, expect } from 'vitest';
import type { ItemId } from '../core/items';
import type { Toasts } from './toast';
import {
  WORLDGEN_NOTICE_ICON,
  WORLDGEN_NOTICE_TEXT,
  WORLDGEN_NOTICE_TITLE,
  pushWorldgenNotice,
} from './worldgen-notice';
// 本模組的原始碼（用於釘住「不得 import menus／bus／main」）。`?raw` 由 Vite
// 在轉譯期內嵌成字串——不需 node 的檔案系統 API（本專案沒有 @types/node）。
import noticeSource from './worldgen-notice.ts?raw';

interface Pushed {
  title: string;
  description: string;
  icon: ItemId;
}

/** 假的 toast 堆：只記錄 `push` 的參數，不碰 DOM、不排任何計時器。 */
function fakeToasts(): { toasts: Toasts; pushed: Pushed[] } {
  const pushed: Pushed[] = [];
  const toasts: Toasts = {
    push(opts) {
      pushed.push({ ...opts });
    },
    dispose() {
      /* 假的堆沒有 DOM 可清 */
    },
  };
  return { toasts, pushed };
}

/** 本模組的原始碼（用於釘住「不得 import menus／bus／main」）。 */
describe('worldgen notice', () => {
  it('the notice carries the terrain-changed title and explanation', () => {
    const { toasts, pushed } = fakeToasts();
    pushWorldgenNotice(toasts);
    expect(pushed).toHaveLength(1); // 一次提示 = 一個 toast
    expect(pushed[0].title).toBe('地形已改變');
    expect(pushed[0].description).toContain('地形');
    expect(pushed[0].icon).toBe('grass');
  });

  it('the notice is a toast, not a modal', () => {
    // (a) 路徑釘死：匯出的就是 toast 用的常數（title／icon），
    //     呼叫端只拿到 `Toasts.push` 的參數——沒有「確定／取消」這種模態按鈕。
    expect(WORLDGEN_NOTICE_TITLE).toBe('地形已改變');
    expect(WORLDGEN_NOTICE_ICON).toBe('grass');
    const { toasts, pushed } = fakeToasts();
    pushWorldgenNotice(toasts);
    expect(pushed[0].icon).toBe('grass');
    expect(pushed[0].title).toBe('地形已改變');

    // (b) 原始碼釘死：**不得** import `menus`（B1.4 的模態確認框走那條路），
    //     也不得 import 任何 bus／main——本模組只准 import 型別。
    // 錨在行首 → 註解裡出現 "import" 字樣不會被誤判成 import 敘述。
    const importStatements = noticeSource.match(/^import\s[^;]*?from\s+'[^']+'/gm) ?? [];
    expect(importStatements.length).toBeGreaterThan(0);
    for (const stmt of importStatements) {
      // 只准 `import type`——本模組是純模組，沒有任何執行期相依。
      expect(stmt).toMatch(/^import\s+type\s/);
      // 不准觸及模態選單／事件匯流排／組裝根。
      expect(stmt).not.toMatch(/menus/);
      expect(stmt).not.toMatch(/bus/);
      expect(stmt).not.toMatch(/main/);
    }
    // 匯出的文案逐字釘死（使用者要看到的字串）。
    expect(WORLDGEN_NOTICE_TEXT).toBe(
      '世界生成器已更新：舊存檔的地形會整片改觀（你的建築可能浮空、埋入或入水）。',
    );
  });
});
