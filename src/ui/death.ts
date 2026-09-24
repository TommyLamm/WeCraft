import './ui.css';

/** Death screen (Task 10): full-viewport red-tinted overlay with Respawn and
 *  quit-to-title buttons. Same factory pattern as menus/hud — and, per
 *  Decision A (Task 5), it never imports the bus: `main.ts` calls `show(opts)`
 *  on the state transition into 'dead' and the button clicks travel back
 *  through the callbacks (callback-opts, mirroring `menus.showPause(opts)`). */
export interface DeathScreen {
  /** Mount the overlay wired to `opts`: `onRespawn` fires once per Respawn
   *  click, `onQuit` once per quit click (label `回到標題`, same wording as the
   *  pause menu) — neither fires the other. Re-showing while visible replaces
   *  the overlay — never duplicates it. */
  show(opts: { onRespawn: () => void; onQuit: () => void }): void;
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
    show({ onRespawn, onQuit }) {
      clear(); // idempotent: a double show swaps the node, never stacks two
      const el = document.createElement('div');
      el.className = 'death-screen interactive';
      const title = document.createElement('h1');
      title.className = 'death-title';
      title.textContent = 'You died!';
      el.append(title, btn('Respawn', onRespawn), btn('回到標題', onQuit));
      current = el;
      uiRoot.appendChild(el);
    },
    hide: clear,
    isVisible: () => current !== null,
  };
}
