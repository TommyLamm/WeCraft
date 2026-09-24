import './ui.css';
import { loadSettings, saveSettings } from '../core/settings';

export type MenuAction = 'play' | 'resume' | 'quit-to-title';

export interface Menus {
  showTitle(onPlay: () => void): void;
  /** `onToggleMode` is the mode toggle's callback — main.ts wires it to persist
   *  settings + emit `mode-changed` (Decision A: ui modules never import the
   *  bus). The label re-reads settings on every render, so it stays in sync
   *  as long as the callback persists before returning. */
  showPause(opts: {
    onResume: () => void;
    onQuit: () => void;
    onToggleMode?: () => void;
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

  /** Current mode as shown in menus: `Mode: Survival` / `Game Mode: Creative`. */
  const modeName = (): string =>
    loadSettings().mode === 'creative' ? 'Creative' : 'Survival';

  const modeLine = (className: string): HTMLElement => {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = `Mode: ${modeName()}`;
    return el;
  };

  return {
    showTitle(onPlay) {
      clear();
      const el = document.createElement('div');
      el.className = 'ui-overlay title-screen interactive';
      const logo = document.createElement('div');
      logo.className = 'ui-logo';
      logo.textContent = 'WeCraft';
      el.append(logo, btn('單人遊戲', onPlay), modeLine('ui-mode')); // display-only, under the buttons
      mount(el);
    },
    showPause({ onResume, onQuit, onToggleMode }) {
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
          // mode toggle (Task 5): notify only — main.ts persists + emits; the
          // re-render re-reads settings so the label flips in place
          btn(`Game Mode: ${modeName()}`, () => {
            onToggleMode?.();
            renderPause();
          }),
          btn('設定', () => {
            clear();
            mount(settingsPanel(renderPause));
          }),
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
