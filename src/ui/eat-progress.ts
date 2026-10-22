import './ui.css';

/** 進食進度條（B4 Task 9）：按住右鍵吃東西時的視覺回饋。
 *
 *  **進度條是加分項 —— 規則不依賴它**：進食規則本身由 `src/player/eat.ts` 的
 *  `eatTick` 純邏輯把關（「按住右鍵約 1.6 秒才吃」），這裡只負責把
 *  `elapsed / EAT_TIME_SEC` 畫出來。沒有它，遊戲規則完全一樣（只是玩家看不到
 *  進度）。
 *
 *  形狀沿用其他 ui 模組的慣例（toast／hurt／furnace）：`main` 持有實例、
 *  本模組只管 DOM。
 *  - `show(fraction)`：掛上一個 `div.eat-progress`（內含 `div.eat-progress-fill`）
 *    並把填充條的寬度設成 `fraction * 100%`；**連續呼叫只更新寬度、不重建節點**
 *    （每幀呼叫 → 不能每幀動 DOM 結構）。
 *  - `hide()`：移除節點（放開右鍵／吃完／離開遊戲時呼叫）。 */
export interface EatProgressUi {
  /** 顯示進度條並把進度設成 `fraction`（0..1，超出範圍會被夾制）。 */
  show(fraction: number): void;
  /** 移除進度條（沒有掛上時是 no-op）。 */
  hide(): void;
}

/** 把 `fraction` 夾成 0..1；非有限值（NaN／Infinity）也夾掉，不寫出壞樣式。 */
function clampFraction(fraction: number): number {
  if (!Number.isFinite(fraction)) return fraction > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, fraction));
}

export function createEatProgress(uiRoot: HTMLElement): EatProgressUi {
  let el: HTMLDivElement | null = null;
  let fill: HTMLDivElement | null = null;

  return {
    show(fraction: number): void {
      if (!el) {
        // 一個進度條，永遠只有一個（每幀 show 只改寬度）。
        el = document.createElement('div');
        el.className = 'eat-progress';
        fill = document.createElement('div');
        fill.className = 'eat-progress-fill';
        el.appendChild(fill);
        uiRoot.appendChild(el);
      }
      if (fill) fill.style.width = `${clampFraction(fraction) * 100}%`;
    },
    hide(): void {
      el?.remove();
      el = null;
      fill = null;
    },
  };
}
