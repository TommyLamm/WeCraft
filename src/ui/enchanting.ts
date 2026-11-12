import './ui.css';
import {
  enchantmentName,
  stackDisplayName,
  type EnchantOffer,
} from '../core/enchantments';
import type { ItemStack } from '../core/items';
import { ICON_PX, getContext2d, itemIcon } from './icons';

// ---- Enchanting table UI (B17 Task 12) ----
//
// Display + choose panel over ONE held hotbar stack. The owner (main.ts) owns
// every rule — the panel only renders a view and reports clicks:
//   - `open` re-renders from the supplied view (the owner recomputes offers
//     after each choice, so upgrade/at-max states appear immediately);
//   - one button per offer; unaffordable offers are disabled (creative shows
//     免費 and never disables anything);
//   - backdrop click / Esc close via `onClose` exactly once per open — the
//     handler is attached on open and detached on close (re-open can never
//     stack it); a choice never closes the panel.
// Mirrors ui/furnace.ts's callback-only convention (Decision A: ui never
// imports the bus).

export interface EnchantView {
  stack: ItemStack | null;
  offers: EnchantOffer[];
  level: number;
  free: boolean;
  message: string | null;
}

export interface EnchantingUI {
  open(view: EnchantView): void;
  close(): void;
  dispose(): void;
}

export interface EnchantingCallbacks {
  onChoose(index: number): void;
  onClose(): void;
}

const validStack = (s: ItemStack | null | undefined): s is ItemStack =>
  !!s && Number.isFinite(s.count) && s.count >= 1;

/** Copy the held item icon onto its own canvas (`itemIcon` caches ONE canvas
 *  per item, which cannot be moved around — mirrors furnace/hud). */
function fillIcon(slot: HTMLElement, stack: ItemStack | null): void {
  const canvas = document.createElement('canvas');
  canvas.width = ICON_PX;
  canvas.height = ICON_PX;
  const ctx = getContext2d(canvas);
  if (ctx && validStack(stack)) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(itemIcon(stack.item), 0, 0);
  } // jsdom has no 2d context: empty canvas, title/name still assertable
  slot.appendChild(canvas);
}

export function createEnchanting(root: HTMLElement, opts: EnchantingCallbacks): EnchantingUI {
  let el: HTMLElement | null = null;
  let escHandler: ((e: KeyboardEvent) => void) | null = null;

  const detach = (): void => {
    if (escHandler) {
      document.removeEventListener('keydown', escHandler);
      escHandler = null;
    }
    el?.remove();
    el = null;
  };

  const close = (): void => {
    detach();
  };

  return {
    open(view) {
      // Fresh DOM per open: the owner re-opens with a recomputed view after a
      // choice; rebuilding also guarantees exactly one Esc handler exists.
      detach();

      const backdrop = document.createElement('div');
      backdrop.className = 'ui-overlay ui-enchant-backdrop interactive';
      backdrop.addEventListener('click', (e) => {
        if (e.target !== backdrop) return; // clicks inside the panel only choose
        close();
        opts.onClose();
      });
      escHandler = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        close();
        opts.onClose();
      };
      document.addEventListener('keydown', escHandler);

      const panel = document.createElement('div');
      panel.className = 'ui-enchant-panel interactive';

      const h = document.createElement('h3');
      h.textContent = '附魔台';

      const itemRow = document.createElement('div');
      itemRow.className = 'ui-enchant-item';
      const icon = document.createElement('div');
      icon.className = 'ui-slot ui-enchant-icon';
      const stack = validStack(view.stack) ? view.stack : null;
      icon.title = stack ? stackDisplayName(stack) : '';
      fillIcon(icon, stack);
      const name = document.createElement('div');
      name.className = 'ui-enchant-name';
      name.textContent = stack ? stackDisplayName(stack) : '未持有物品';
      itemRow.append(icon, name);

      const level = document.createElement('div');
      level.className = 'ui-enchant-level';
      level.textContent = `目前等級：${view.free ? '免費' : view.level}`;

      const offers = document.createElement('div');
      offers.className = 'ui-enchant-offers';
      view.offers.forEach((offer, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ui-enchant-offer';
        button.textContent = view.free
          ? `${enchantmentName(offer.enchant)} — 免費`
          : `${enchantmentName(offer.enchant)} — ${offer.cost} 級`;
        button.disabled = !view.free && view.level < offer.cost;
        button.addEventListener('click', () => opts.onChoose(index));
        offers.appendChild(button);
      });

      const message = document.createElement('div');
      message.className = 'ui-enchant-message';
      message.textContent = view.message ?? '';

      panel.append(h, itemRow, level, offers, message);
      backdrop.appendChild(panel);
      root.appendChild(backdrop);
      el = backdrop;
    },
    close() {
      close();
    },
    dispose() {
      close();
    },
  };
}
