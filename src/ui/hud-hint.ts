import './ui.css';
import type { SprintCancelReason } from '../player/sprint';

/** 疾跑取消／撞牆提示（B5）：畫面下緣的一行短暫文字。
 *
 *  背景（審查 B5）：`sprintState.lastCancel` 與 `lastWallAngleDeg` 只餵給狀態機，
 *  全 repo 沒有第二個消費者 → 疾跑「突然停了」時玩家無從得知原因（尤其是撞牆的
 *  8° 門檻，畫面上完全看不出來）。這個模組只負責**顯示**；「何時值得提示」由
 *  `main.ts` 決定（只提示**真的取消了一次疾跑**，見該處註解）。
 *
 *  - 同一段文案在 {@link HUD_HINT_THROTTLE_MS}（3 秒）內**不重複顯示**
 *    （撞牆是每幀都可能成立的事件 → 不節流會變成永遠在閃的訊息）。
 *  - **不同的**文案立刻取代目前的提示（新的原因比舊的重要，且重新起算隱藏計時）。
 *  - 顯示 {@link HUD_HINT_DURATION_MS}（2 秒）後由 `.visible` class 移除 → CSS
 *    淡出；呼叫端不必排程清除。
 *  - `hide()` 只收起（保留元素、重置節流）——session 邊界用；`dispose()` 才是
 *    真的卸載元素（頁面結束）。
 *  - `pointer-events: none`（CSS）：不擋滑鼠。
 */
export const HUD_HINT_THROTTLE_MS = 3000;
export const HUD_HINT_DURATION_MS = 2000;

/** 疾跑取消原因的提示文案（B5）。
 *
 *  `no-forward`（玩家自己放開 W）**刻意不在型別裡**——那不是值得提示的「取消」，
 *  每次停步都跳一行字只是噪音；`main.ts` 在呼叫前就把它濾掉（型別強迫處理）。
 *  `wall` 帶撞牆夾角（整數度；`null` 防守成 0°，不顯示 NaN）。
 */
export function sprintCancelHint(
  reason: Exclude<SprintCancelReason, 'no-forward'>,
  wallAngleDeg: number | null,
): string {
  switch (reason) {
    case 'wall':
      return `撞牆，疾跑取消（${Math.round(Math.abs(wallAngleDeg ?? 0))}°）`;
    case 'hunger':
      return '飢餓過低，疾跑取消';
    case 'attacked':
      return '受擊，疾跑取消';
    case 'sneaking':
      return '潛行，疾跑取消';
    case 'in-water':
      return '水中，疾跑取消';
    case 'flying':
      return '飛行中，疾跑取消';
  }
}

export interface HudHint {
  /** 顯示一段提示（節流見檔頭）。 */
  show(text: string): void;
  /** 立刻收起目前的提示（session 邊界），並重置節流；元素保留。冪等。 */
  hide(): void;
  /** 收起並卸載元素、取消所有計時器。冪等；之後 `show()` 是 no-op。 */
  dispose(): void;
}

export function createHudHint(
  uiRoot: HTMLElement,
  opts?: { throttleMs?: number; durationMs?: number; now?: () => number },
): HudHint {
  const throttleMs = opts?.throttleMs ?? HUD_HINT_THROTTLE_MS;
  const durationMs = opts?.durationMs ?? HUD_HINT_DURATION_MS;
  const now = opts?.now ?? (() => Date.now());

  const el = document.createElement('div');
  el.className = 'ui-hint';
  uiRoot.appendChild(el);

  let lastText: string | null = null;
  let lastShownAt = -Infinity;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const clearHideTimer = (): void => {
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  const hide = (): void => {
    clearHideTimer();
    el.classList.remove('visible');
    // 重置節流：換場次後同一個原因可以立刻再提示（不必等 3 秒）。
    lastText = null;
    lastShownAt = -Infinity;
  };

  return {
    show(text) {
      if (disposed) return;
      const t = now();
      if (text === lastText && t - lastShownAt < throttleMs) return; // 節流：不重設計時器
      lastText = text;
      lastShownAt = t;
      el.textContent = text;
      el.classList.add('visible');
      clearHideTimer();
      hideTimer = setTimeout(() => {
        hideTimer = null;
        el.classList.remove('visible'); // 只有淡出，元素留著等下一則提示
      }, durationMs);
    },
    hide() {
      if (disposed) return;
      hide();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearHideTimer();
      el.remove();
    },
  };
}
