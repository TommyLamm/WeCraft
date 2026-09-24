import './ui.css';

/** Death screen (Task 10): full-viewport red-tinted overlay with a Respawn
 *  button. Same factory pattern as menus/hud — and, per Decision A (Task 5),
 *  it never imports the bus: `main.ts` calls `show(onRespawn)` on the state
 *  transition into 'dead' and the Respawn click travels back through the
 *  callback. */
export interface DeathScreen {
  /** Mount the overlay wired to `onRespawn` (called once per Respawn click).
   *  Re-showing while visible replaces the overlay — never duplicates it. */
  show(onRespawn: () => void): void;
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

  return {
    show(onRespawn) {
      clear(); // idempotent: a double show swaps the node, never stacks two
      const el = document.createElement('div');
      el.className = 'death-screen interactive';
      const title = document.createElement('h1');
      title.className = 'death-title';
      title.textContent = 'You died!';
      const btn = document.createElement('button');
      btn.className = 'ui-btn'; // reuse the menu button style (ui.css)
      btn.textContent = 'Respawn';
      btn.addEventListener('click', onRespawn);
      el.append(title, btn);
      current = el;
      uiRoot.appendChild(el);
    },
    hide: clear,
    isVisible: () => current !== null,
  };
}
