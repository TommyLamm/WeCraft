import './ui.css';
import { loadSettings, saveSettings } from '../core/settings';
import type { CloudStatus } from '../platform/playroom';

export type MenuAction = 'play' | 'resume' | 'quit-to-title';

export interface Menus {
  /** Title screen. `hasSave` gates the 繼續遊戲 (Continue) button — rendered
   *  ONLY when a save exists (Task 14 settled: hidden, no fallback); 單人遊戲
   *  always renders and starts a new game. */
  showTitle(opts: { hasSave: boolean; onContinue: () => void; onNewGame: () => void }): void;
  /** B1.4: modal confirmation — used by the title screen when 新遊戲 would
   *  overwrite an existing save. SINGLE-FIRE: the FIRST trigger wins
   *  (確定／取消／Esc), the dialog clears itself BEFORE the callback runs, and
   *  the `fired` guard makes any later trigger (a second click on the now
   *  detached button, a second Esc) a no-op. Esc = cancel. */
  showConfirm(opts: { message: string; onConfirm: () => void; onCancel: () => void }): void;
  /** `onToggleMode` is required — a mode button that can't notify is a dead
   *  control. main.ts wires it to emit `mode-changed` (Decision A: ui modules
   *  never import the bus; the handler persists + applies). The label re-reads
   *  settings on every render, so it stays in sync as long as the callback
   *  persists before returning. */
  showPause(opts: {
    onResume: () => void;
    onQuit: () => void;
    /** 儲存並離開 (Task 14): saves the session, then quits to title. Separate
     *  from `onQuit` (回到標題), which stays an UNSAVED quit. */
    onSaveQuit: () => void;
    onToggleMode: () => void;
    /** Phase 3 Task 5: sun-shadow toggle — same contract as `onToggleMode`:
     *  the callback persists + applies; the re-render re-reads settings so the
     *  label reflects the new state. */
    onToggleShadows: () => void;
    /** Phase 3 Task 7: cloud-layer toggle — same contract as `onToggleShadows`. */
    onToggleClouds: () => void;
    /** Phase 4 Task 4: cloud sync state — drives the bottom status row
     *  (`雲端：已同步／訪客本機遊玩／不支援／同步失敗（重試）／有新進度／
     *  格式不相容`). `unknown` renders as 不支援 (init never leaves it). */
    cloudStatus: CloudStatus;
    /** True only for retryable states (NETWORK failure, applied conflict) —
     *  the 重試 button renders ONLY then; locked FORMAT/REQUEST_REUSED
     *  failures, guest and unsupported hide it (Ruling D). */
    cloudRetryable: boolean;
    /** Retry the kept snapshot (same requestId) or push a fresh checkpoint. */
    onRetryCloud: () => void;
  }): void;
  hideAll(): void;
  isVisible(): boolean;
}

function relockCanvas(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  if (!canvas || typeof canvas.requestPointerLock !== 'function') return;
  try {
    const p = canvas.requestPointerLock();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    /* pointer lock requires user gesture / focus; click provides gesture */
  }
}

interface SliderOpts {
  min: number;
  max: number;
  step: number;
  value: number;
}

function sliderRow(label: string, opts: SliderOpts, onChange: (v: number) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.step = String(opts.step);
  input.value = String(opts.value);
  // persist on release only: 'input' fires every drag pixel (JSON.parse+setItem spam);
  // the thumb already updates visually without a listener
  input.addEventListener('change', () => onChange(Number(input.value)));
  row.append(lab, input);
  return row;
}

export function createMenus(uiRoot: HTMLElement): Menus {
  let current: HTMLElement | null = null;
  let escHandler: ((e: KeyboardEvent) => void) | null = null;

  const clearEsc = () => {
    if (escHandler) {
      document.removeEventListener('keydown', escHandler);
      escHandler = null;
    }
  };

  const clear = () => {
    clearEsc();
    current?.remove();
    current = null;
  };

  const btn = (label: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.className = 'ui-btn interactive';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };

  const mount = (el: HTMLElement) => {
    current = el;
    uiRoot.appendChild(el);
  };

  const settingsPanel = (onBack: () => void): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'ui-overlay interactive';
    const title = document.createElement('div');
    title.className = 'ui-logo';
    title.style.fontSize = '36px';
    title.textContent = '設定';
    const panel = document.createElement('div');
    panel.className = 'ui-settings';
    const s = loadSettings();
    panel.append(
      sliderRow('視距', { min: 6, max: 16, step: 1, value: s.renderDistance }, (v) =>
        saveSettings({ renderDistance: v }),
      ),
      sliderRow('靈敏度', { min: 0.1, max: 3, step: 0.1, value: s.sensitivity }, (v) =>
        saveSettings({ sensitivity: v }),
      ),
      sliderRow('音量', { min: 0, max: 1, step: 0.05, value: s.volume }, (v) =>
        saveSettings({ volume: v }),
      ),
      btn('返回', onBack),
    );
    el.append(title, panel);
    return el;
  };

  /** Current mode as shown in menus (one wording everywhere): `Mode: Survival` / `Mode: Creative`. */
  const modeName = (): string =>
    loadSettings().mode === 'creative' ? 'Creative' : 'Survival';

  /** Phase 3 Task 5: sun-shadow toggle label, re-read from settings each render. */
  const shadowsName = (): string => (loadSettings().shadows ? '開' : '關');

  /** Phase 3 Task 7: cloud toggle label, re-read from settings each render. */
  const cloudsName = (): string => (loadSettings().clouds ? '開' : '關');

  const modeLine = (className: string): HTMLElement => {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = `Mode: ${modeName()}`;
    return el;
  };

  return {
    showTitle({ hasSave, onContinue, onNewGame }) {
      clear();
      const el = document.createElement('div');
      el.className = 'ui-overlay title-screen interactive';
      const logo = document.createElement('div');
      logo.className = 'ui-logo';
      logo.textContent = 'WeCraft';
      el.append(logo);
      // Task 14: Continue mounts only when a save exists (hidden otherwise)
      if (hasSave) el.append(btn('繼續遊戲', onContinue));
      el.append(btn('單人遊戲', onNewGame), modeLine('ui-mode')); // display-only, under the buttons
      mount(el);
    },
    showConfirm({ message, onConfirm, onCancel }) {
      clear(); // replaces whatever menu was mounted (same single `current` slot)
      const el = document.createElement('div');
      el.className = 'ui-overlay interactive';
      const panel = document.createElement('div');
      panel.className = 'ui-settings ui-confirm'; // panel style + dialog text style
      const msg = document.createElement('div');
      msg.className = 'ui-confirm-msg'; // centered dialog copy (ui.css)
      msg.textContent = message;
      // single-fire: the first trigger sets `fired`, unmounts the dialog (which
      // also drops the Esc listener) and only then runs the callback. A second
      // click on the detached button, or a second Esc, finds `fired === true`.
      let fired = false;
      const fire = (cb: () => void) => {
        if (fired) return;
        fired = true;
        clear();
        cb();
      };
      panel.append(msg, btn('確定', () => fire(onConfirm)), btn('取消', () => fire(onCancel)));
      el.append(panel);
      mount(el);
      // Esc = cancel via the shared overlay-Esc slot (removed in clear()).
      // The leading clear() already nulled any previous handler; explicit for
      // the same shape as showPause's registerEsc().
      clearEsc();
      escHandler = (e: KeyboardEvent) => {
        if (e.code !== 'Escape') return;
        fire(onCancel);
      };
      document.addEventListener('keydown', escHandler);
    },
    showPause({ onResume, onQuit, onSaveQuit, onToggleMode, onToggleShadows, onToggleClouds, cloudStatus, cloudRetryable, onRetryCloud }) {
      clear();
      // Esc resumes via the identical path as 繼續遊戲 (incl. relock).
      // Same overlay-Esc lifecycle as inventory/crafting: registered here and
      // after every renderPause re-render (which clears first), removed in
      // clear() so no stale handler survives a transition.
      const registerEsc = () => {
        clearEsc();
        escHandler = (e: KeyboardEvent) => {
          if (e.code !== 'Escape') return;
          onResume();
          relockCanvas();
        };
        document.addEventListener('keydown', escHandler);
      };
      /** Phase 4 Task 4: bottom cloud-sync line. Copy is verbatim per the
       *  brief; the （重試） suffix marks the retryable error text and a real
       *  重試 button mounts beside it ONLY when `cloudRetryable` (NETWORK
       *  failure or applied conflict — never for locked/guest/format). */
      const cloudRow = (): HTMLElement => {
        const wrap = document.createElement('div');
        wrap.className = 'ui-cloud-row';
        const line = document.createElement('div');
        line.className = 'ui-cloud';
        let showRetry = false;
        switch (cloudStatus) {
          case 'guest':
            line.textContent = '雲端：訪客本機遊玩';
            line.classList.add('ui-cloud-guest');
            break;
          case 'unsupported':
          case 'unknown':
            line.textContent = '雲端：不支援';
            break;
          case 'ready':
            line.textContent = '雲端：已同步';
            break;
          case 'conflict':
            line.textContent = '雲端：有新進度';
            showRetry = cloudRetryable;
            break;
          case 'format':
            line.textContent = '雲端：格式不相容';
            break;
          case 'error':
          default:
            line.textContent = cloudRetryable ? '雲端：同步失敗（重試）' : '雲端：同步失敗';
            showRetry = cloudRetryable;
            break;
        }
        wrap.append(line);
        if (showRetry) {
          const retry = document.createElement('button');
          retry.className = 'ui-btn ui-cloud-retry interactive';
          retry.textContent = '重試';
          retry.addEventListener('click', onRetryCloud);
          wrap.append(retry);
        }
        return wrap;
      };
      const renderPause = () => {
        clear();
        const el = document.createElement('div');
        el.className = 'ui-overlay interactive';
        const title = document.createElement('div');
        title.className = 'ui-logo';
        title.style.fontSize = '36px';
        title.textContent = '遊戲已暫停';
        el.append(
          title,
          btn('繼續遊戲', () => {
            onResume();
            relockCanvas();
          }),
          // mode toggle (Task 5): notify only — main.ts's mode-changed handler
          // persists + applies; the re-render re-reads settings for the label
          btn(`Mode: ${modeName()}`, () => {
            onToggleMode();
            renderPause();
          }),
          // sun-shadow toggle (Phase 3 Task 5): same notify + re-render pattern
          // — main.ts persists + applies, the label re-reads settings
          btn(`陰影：${shadowsName()}`, () => {
            onToggleShadows();
            renderPause();
          }),
          // cloud toggle (Phase 3 Task 7): same notify + re-render pattern
          btn(`雲：${cloudsName()}`, () => {
            onToggleClouds();
            renderPause();
          }),
          btn('設定', () => {
            clear();
            mount(settingsPanel(renderPause));
          }),
          // Task 14: both buttons — one saves, one doesn't (settle: split)
          btn('儲存並離開', onSaveQuit),
          btn('回到標題', onQuit),
          // Phase 4 Task 4: cloud sync status row — always the last line; the
          // 重試 button mounts ONLY in retryable states (Ruling D).
          cloudRow(),
        );
        mount(el);
        registerEsc();
      };
      renderPause();
    },
    hideAll: clear,
    isVisible: () => current !== null,
  };
}
