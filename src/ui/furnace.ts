import './ui.css';
import { FUEL_VALUES, SMELT_TIME_SEC, type FurnaceState } from '../world/furnace';
import { stackName, type ItemStack } from '../core/items';
import { ICON_PX, getContext2d, itemIcon } from './icons';

// ---- Furnace UI (Task 6) ----
//
// Display-only panel over one placed furnace's live state (main.ts owns the
// Map<key, FurnaceState> and every item move — this module imports no bus,
// everything happens through the callbacks below, mirroring ui/crafting.ts):
//   - input / fuel slots show their stack; a click notifies `onSlotClick` and
//     the owner moves items with crafting-cell semantics (empty + selected
//     hotbar item → 1 moves in; filled → 1 returns to the inventory);
//   - the output slot shows the smelted stack; a click fires `onTakeOutput`
//     (the owner takes it into the inventory, blocked when full);
//   - the progress bar width is progressSec / SMELT_TIME_SEC; the fire icon is
//     lit while the furnace is burning (fuelUnits > 0 or burnable fuel).
// `open` re-renders in place: slot DOM is replaced only when a stack actually
// changed, so re-opening every interaction never drops a mid-click; the bar +
// burn icon refresh on every call. Backdrop click / Esc / E close via onClose.

export interface FurnaceUI {
  open(state: FurnaceState): void;
  close(): void;
  dispose(): void;
}

export interface FurnaceCallbacks {
  onTakeOutput: () => void;
  onClose: () => void;
  /** Input/fuel slot clicked — the owner moves the items. */
  onSlotClick?: (slot: 'input' | 'fuel') => void;
}

const validStack = (s: ItemStack | null | undefined): s is ItemStack =>
  !!s && Number.isFinite(s.count) && s.count >= 1;

/** Copy a stack into a slot element (own canvas — `itemIcon` caches ONE canvas
 *  per item, which cannot sit in several cells at once; mirrors hud's draw). */
function fillSlot(slot: HTMLElement, stack: ItemStack | null): void {
  const canvas = document.createElement('canvas');
  canvas.width = ICON_PX;
  canvas.height = ICON_PX;
  const ctx = getContext2d(canvas);
  if (ctx && validStack(stack)) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(itemIcon(stack.item), 0, 0);
  } // jsdom has no 2d context: empty canvas, badge/title still assertable
  const count = document.createElement('span');
  count.className = 'count';
  count.textContent = validStack(stack) && stack.count > 1 ? String(stack.count) : '';
  slot.append(canvas, count);
}

const stackSig = (s: ItemStack | null): string =>
  validStack(s) ? `${s.item}×${s.count}` : '';

export function createFurnace(root: HTMLElement, opts: FurnaceCallbacks): FurnaceUI {
  let el: HTMLElement | null = null;
  let escHandler: ((e: KeyboardEvent) => void) | null = null;
  let inputSlot: HTMLElement | null = null;
  let fuelSlot: HTMLElement | null = null;
  let outputSlot: HTMLElement | null = null;
  let progressFill: HTMLElement | null = null;
  let burnIcon: HTMLElement | null = null;
  let sig = '';

  const detach = (): void => {
    if (escHandler) {
      document.removeEventListener('keydown', escHandler);
      escHandler = null;
    }
    el?.remove();
    el = null;
    inputSlot = fuelSlot = outputSlot = progressFill = burnIcon = null;
    sig = '';
  };

  const paintSlot = (slot: HTMLElement, stack: ItemStack | null): void => {
    slot.replaceChildren();
    const s = validStack(stack) ? stack : null;
    slot.title = s ? stackName(s.item) : '';
    fillSlot(slot, s);
  };

  const render = (state: FurnaceState): void => {
    if (!inputSlot || !fuelSlot || !outputSlot || !progressFill || !burnIcon) return;
    const nextSig = [stackSig(state.input), stackSig(state.fuel), stackSig(state.output)].join('|');
    if (nextSig !== sig) {
      sig = nextSig;
      paintSlot(inputSlot, state.input);
      paintSlot(fuelSlot, state.fuel);
      paintSlot(outputSlot, state.output);
    }
    const ratio = Number.isFinite(state.progressSec)
      ? Math.max(0, Math.min(1, state.progressSec / SMELT_TIME_SEC))
      : 0;
    progressFill.style.width = `${ratio * 100}%`;
    const burning = state.fuelUnits > 0 || (!!state.fuel && state.fuel.item in FUEL_VALUES);
    burnIcon.classList.toggle('lit', burning);
  };

  return {
    open(state) {
      if (!el) {
        el = document.createElement('div');
        el.className = 'ui-overlay ui-furnace-backdrop interactive';
        el.addEventListener('click', (e) => {
          if (e.target !== el) return; // clicks inside the panel only smelt
          this.close();
          opts.onClose();
        });
        // Esc closes like the crafting overlay; E closes too — keydown here is
        // NOT pointer-lock gated (the game input is), so both work while open.
        escHandler = (e: KeyboardEvent) => {
          if (e.key !== 'Escape' && e.code !== 'KeyE') return;
          this.close();
          opts.onClose();
        };
        document.addEventListener('keydown', escHandler);

        const panel = document.createElement('div');
        panel.className = 'furnace-panel interactive';
        const h = document.createElement('h3');
        h.textContent = '熔爐';
        panel.appendChild(h);

        const row = document.createElement('div');
        row.className = 'furnace-row';

        inputSlot = document.createElement('div');
        inputSlot.className = 'ui-slot furnace-input';
        inputSlot.dataset.fslot = 'input';
        inputSlot.addEventListener('click', () => opts.onSlotClick?.('input'));

        fuelSlot = document.createElement('div');
        fuelSlot.className = 'ui-slot furnace-fuel';
        fuelSlot.dataset.fslot = 'fuel';
        fuelSlot.addEventListener('click', () => opts.onSlotClick?.('fuel'));

        const progress = document.createElement('div');
        progress.className = 'furnace-progress';
        progressFill = document.createElement('div');
        progressFill.className = 'furnace-progress-fill';
        progress.appendChild(progressFill);

        burnIcon = document.createElement('div');
        burnIcon.className = 'furnace-burn';
        burnIcon.textContent = '🔥';

        outputSlot = document.createElement('div');
        outputSlot.className = 'ui-slot furnace-output';
        outputSlot.dataset.fslot = 'output';
        outputSlot.addEventListener('click', () => opts.onTakeOutput());

        row.append(inputSlot, fuelSlot, progress, burnIcon, outputSlot);
        panel.appendChild(row);
        el.appendChild(panel);
        root.appendChild(el);
      }
      render(state);
    },
    close() {
      detach();
    },
    dispose() {
      detach();
    },
  };
}
