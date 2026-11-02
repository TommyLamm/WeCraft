/**
 * 睡眠黑幕（B10 Task 8）：全螢幕純黑覆蓋層 ＋ 一行文字。
 *
 * 規則在 `world/bed.ts`／`main.ts`——這裡只管 DOM：`show()`／`hide()` 都冪等
 * （重複呼叫不堆節點、也不報錯）；`pointer-events: none`（黑幕不攔輸入，
 * 睡眠中也不需要任何點擊）；淡入走 CSS 過渡（醒來直接切回，不做淡出）。
 */

export interface SleepScreen {
  /** 顯示黑幕（冪等：已在畫面上就 no-op）。 */
  show(): void;
  /** 收掉黑幕（冪等：不在畫面上就 no-op）。 */
  hide(): void;
  /** 目前是否顯示中。 */
  isVisible(): boolean;
}

export function createSleepScreen(uiRoot: HTMLElement): SleepScreen {
  let current: HTMLElement | null = null;

  return {
    show() {
      if (current) return; // idempotent: a double show never stacks two
      const el = document.createElement('div');
      el.className = 'sleep-screen';
      const text = document.createElement('p');
      text.className = 'sleep-text';
      text.textContent = '睡覺中…';
      el.appendChild(text);
      uiRoot.appendChild(el);
      current = el;
    },
    hide() {
      current?.remove(); // idempotent: removing an absent node is a no-op
      current = null;
    },
    isVisible() {
      return current !== null;
    },
  };
}
