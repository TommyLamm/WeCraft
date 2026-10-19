import './ui.css';

/** Red hurt vignette (Task 9, B1.5): a short full-screen red glow flashed on
 *  every landed mob hit. Same factory shape as the other ui modules
 *  (toast/death/hud): main owns the instance and the timing decisions; this
 *  module owns only the DOM + the auto-remove timer.
 *
 *  Runs INSIDE the existing hit-invulnerability window, so a burst of hits
 *  (several mobs, arrows) re-flashes a handful of times at most — one overlay
 *  element, never a stack. */

/** ms the overlay stays mounted after the latest flash. */
export const HURT_FLASH_MS = 300;

export interface HurtFlash {
  /** Show the red vignette for `HURT_FLASH_MS`. If it is already mounted this
   *  EXTENDS the timer (no second node, no DOM churn); after it auto-removes the
   *  next call mounts a fresh one. */
  flash(): void;
}

export function createHurtFlash(uiRoot: HTMLElement): HurtFlash {
  let el: HTMLDivElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    flash(): void {
      if (!el) {
        // No `interactive` class: the overlay is passive (ui.css keeps
        // pointer-events off), so clicks keep reaching the canvas.
        el = document.createElement('div');
        el.className = 'hurt-flash';
        uiRoot.appendChild(el);
      }
      clearTimeout(timer); // already mounted → extend, never duplicate
      timer = setTimeout(() => {
        el?.remove();
        el = null;
      }, HURT_FLASH_MS);
    },
  };
}
