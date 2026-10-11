import './ui.css';
import type { ItemId } from '../core/items';
import { ICON_PX, getContext2d, itemIcon } from './icons';

/** Advancement toasts (Task 12): the top-right notification stack for unfolds
 *  handed in by `main.ts`'s central `applyAdvancement` path. Same factory shape
 *  as the other ui modules (hud/menus/death): main owns the instance and the
 *  data; this module owns only the DOM + auto-remove timers. */
export interface Toasts {
  /** Append one toast; beyond `max` the OLDEST is removed immediately (the
   *  live count never exceeds `max`). No-op after `dispose()`. */
  push(opts: { title: string; description: string; icon: ItemId }): void;
  /** Remove every toast + pending timer and unmount the container. Idempotent;
   *  timer callbacks can never touch the DOM afterwards. */
  dispose(): void;
}

/** Auto-remove delay per toast (ms) — Task 12 brief default. */
export const TOAST_DURATION_MS = 4000;
/** Live toast cap — Task 12 brief default. */
export const TOAST_MAX = 5;

export function createToasts(
  uiRoot: HTMLElement,
  opts?: { durationMs?: number; max?: number },
): Toasts {
  const durationMs = opts?.durationMs ?? TOAST_DURATION_MS;
  const max = Math.max(1, opts?.max ?? TOAST_MAX); // clamp: max 0 must not loop forever

  const container = document.createElement('div');
  container.className = 'toasts';
  uiRoot.appendChild(container);

  /** Live toasts in push order (oldest first) + their pending auto-remove
   *  timers. Kept apart from the DOM so removal bookkeeping never queries it. */
  const entries: HTMLElement[] = [];
  const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

  /** THE single removal path — auto-remove and overflow eviction both go
   *  through here, so a toast always leaves WITH its timer cancelled and its
   *  entry dropped (a stale timer can never fire against the DOM again). */
  const remove = (el: HTMLElement): void => {
    const timer = timers.get(el);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(el);
    const i = entries.indexOf(el);
    if (i !== -1) entries.splice(i, 1);
    el.remove();
  };

  let disposed = false;

  return {
    push({ title, description, icon }) {
      if (disposed) return; // disposed stack stays dead — no orphan nodes/timers
      while (entries.length >= max) remove(entries[0]); // overflow → oldest first

      const el = document.createElement('div');
      el.className = 'toast';

      // Own canvas copying the cached icon: `itemIcon` returns ONE canvas per
      // item, which cannot live in several toasts/cells at once (hud/crafting
      // pattern). jsdom has no 2d context → the (empty) canvas still mounts.
      const canvas = document.createElement('canvas');
      canvas.className = 'toast-icon';
      canvas.width = ICON_PX;
      canvas.height = ICON_PX;
      const ctx = getContext2d(canvas);
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(itemIcon(icon), 0, 0);
      }

      const text = document.createElement('div');
      text.className = 'toast-text';
      const titleEl = document.createElement('div');
      titleEl.className = 'toast-title';
      titleEl.textContent = title;
      const descEl = document.createElement('div');
      descEl.className = 'toast-desc';
      descEl.textContent = description;
      text.append(titleEl, descEl);

      el.append(canvas, text);
      container.appendChild(el);
      entries.push(el);
      timers.set(
        el,
        setTimeout(() => remove(el), durationMs),
      );
    },
    dispose() {
      disposed = true;
      for (const el of [...entries]) remove(el); // clears every pending timer too
      container.remove();
    },
  };
}
