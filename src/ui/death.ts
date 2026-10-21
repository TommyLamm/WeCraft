import './ui.css';

/** Death screen (Task 10): full-viewport red-tinted overlay with Respawn and
 *  quit-to-title buttons. Same factory pattern as menus/hud — and, per
 *  Decision A (Task 5), it never imports the bus: `main.ts` calls `show(opts)`
 *  on the state transition into 'dead' and the button clicks travel back
 *  through the callbacks (callback-opts, mirroring `menus.showPause(opts)`).
 *  Task 13 adds an optional cause-of-death line (`.death-cause`) under the title. */
/** Cause of death (Task 13): tracked in main.ts (`deathCause`) and rendered
 *  as a `.death-cause` line under the title. `unknown` covers a mobId with no
 *  matching live mob; `null` (no cause recorded) renders no line at all.
 *  `cactus` (B3 Task 6): the cactus contact hazard (`world/hazards.ts`) records
 *  it the same way the mob path records its cause. */
export type DamageSource =
  | 'fall'
  | 'zombie'
  | 'skeleton'
  | 'starve'
  | 'cactus'
  | 'unknown';

/** Traditional Chinese death line per source; `null` → `''` (no line). */
export function deathMessageFor(source: DamageSource | null): string {
  switch (source) {
    case 'fall':
      return '你從高處摔落';
    case 'zombie':
      return '你被殭屍殺死了';
    case 'skeleton':
      return '你被骷髏射死了';
    case 'starve':
      return '你餓死了';
    case 'cactus':
      return '你被仙人掌刺死了';
    case 'unknown':
      return '你死了';
    case null:
      return '';
  }
}

export interface DeathScreen {
  /** Mount the overlay wired to `opts`: `onRespawn` fires once per Respawn
   *  click, `onQuit` once per quit click (label `回到標題`, same wording as the
   *  pause menu) — neither fires the other. Re-showing while visible replaces
   *  the overlay — never duplicates it.
   *  `cause` (Task 13): a non-empty death line rendered as `.death-cause`
   *  under the title; empty/missing → no such node. */
  show(opts: { onRespawn: () => void; onQuit: () => void; cause?: string }): void;
  /** Remove the overlay (idempotent — safe to call when already hidden). */
  hide(): void;
  isVisible(): boolean;
}

export function createDeathScreen(uiRoot: HTMLElement): DeathScreen {
  let current: HTMLElement | null = null;

  const clear = () => {
    current?.remove();
    current = null;
  };

  const btn = (label: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.className = 'ui-btn interactive'; // same class pair as menus.ts buttons
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };

  return {
    show({ onRespawn, onQuit, cause }) {
      clear(); // idempotent: a double show swaps the node, never stacks two
      const el = document.createElement('div');
      el.className = 'death-screen interactive';
      const title = document.createElement('h1');
      title.className = 'death-title';
      title.textContent = 'You died!';
      el.appendChild(title);
      if (cause) {
        const line = document.createElement('p');
        line.className = 'death-cause';
        line.textContent = cause;
        el.appendChild(line);
      }
      el.append(btn('Respawn', onRespawn), btn('回到標題', onQuit));
      current = el;
      uiRoot.appendChild(el);
    },
    hide: clear,
    isVisible: () => current !== null,
  };
}
