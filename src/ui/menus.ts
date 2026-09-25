import './ui.css';
import { loadSettings, saveSettings } from '../core/settings';

export type MenuAction = 'play' | 'resume' | 'quit-to-title';

export interface Menus {
  /** Title screen. `hasSave` gates the 繼續遊戲 (Continue) button — rendered
   *  ONLY when a save exists (Task 14 settled: hidden, no fallback); 單人遊戲
   *  always renders and starts a new game. */
  showTitle(opts: { hasSave: boolean; onContinue: () => void; onNewGame: () => void }): void;
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

  const clear = () => {
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
    showPause({ onResume, onQuit, onSaveQuit, onToggleMode }) {
      clear();
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
          btn('設定', () => {
            clear();
            mount(settingsPanel(renderPause));
          }),
          // Task 14: both buttons — one saves, one doesn't (settle: split)
          btn('儲存並離開', onSaveQuit),
          btn('回到標題', onQuit),
        );
        mount(el);
      };
      renderPause();
    },
    hideAll: clear,
    isVisible: () => current !== null,
  };
}
