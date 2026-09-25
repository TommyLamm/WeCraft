import './ui.css';
import { consumeGrid, matchRecipe } from '../core/recipes';
import type { ItemId, ItemStack } from '../core/items';
import { stackName } from '../core/items';
import { ICON_PX, getContext2d, itemIcon } from './icons';

// ---- Crafting UI (Task 11) ----
//
// Click model (settled — no drag-and-drop, no cursor stack):
//   - click an EMPTY grid cell  → move 1 item from the selected hotbar slot in;
//   - click a FILLED grid cell  → return 1 item to the inventory (stays put
//     when the inventory is full);
//   - click a hotbar slot       → select it as the transfer source;
//   - click the result slot     → take the craft: `onTake` must accept it
//     (overflow → blocked, grid untouched), then each grid cell −1.
// The grid + hotbar arrays are LIVE references owned by the caller — the UI
// mutates the grid in place and re-reads the hotbar on every render, so the
// caller keeps its own view in sync without change events (Decision A: this
// module imports no bus; everything happens through the callbacks below).

export interface CraftingParams {
  /** Grid side length: 2 (inventory screen) or 3 (crafting table). */
  size: 2 | 3;
  /** Live backing grid, length `size²`, row-major like the hotbar slots.
   *  The UI writes into it directly (set by the owner, read back on close). */
  grid: Array<ItemStack | null>;
  /** Live hotbar slots (read-only for the UI — mutations go through callbacks). */
  hotbar: ReadonlyArray<ItemStack | null>;
  /** Hotbar slot the grid draws from; the UI tracks it from here on. */
  selected: number;
  /** Player picked another hotbar slot in the panel — notify-only: the source
   *  selection is LOCAL to the widget (Minecraft-like) and does not move the
   *  game's hotbar selection; owners that don't care simply omit it. */
  onSlotSelect?(slot: number): void;
  /** Remove 1 `item` from hotbar `slot`; false → nothing moved (wrong/empty). */
  onSpend(slot: number, item: ItemId): boolean;
  /** Put 1 `item` back into the inventory; returns overflow (1 = didn't fit). */
  onGiveBack(item: ItemId): number;
  /** Try to take `result`; false blocks the take and leaves the grid intact. */
  onTake(result: ItemStack): boolean;
}

export type CraftingOpenParams = CraftingParams & { onClose?(): void };

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

/** Render the crafting section (grid + arrow + result + hotbar row) into `host`.
 *  Returns an unmount function. The section re-renders itself after every
 *  interaction — all state lives in the params' live arrays + local `selected`. */
export function mountCrafting(host: HTMLElement, params: CraftingParams): () => void {
  let selected =
    Number.isInteger(params.selected) && params.selected >= 0 && params.selected < params.hotbar.length
      ? params.selected
      : 0;

  const section = document.createElement('div');
  section.className = 'ui-craft';

  const render = (): void => {
    const result = matchRecipe(params.grid, params.size);

    const row = document.createElement('div');
    row.className = 'ui-craft-row';

    const gridBox = document.createElement('div');
    gridBox.className = `ui-craft-grid size-${params.size}`;
    for (let i = 0; i < params.size * params.size; i++) {
      const slot = document.createElement('div');
      slot.className = 'ui-slot';
      slot.dataset.cell = String(i);
      const stack = params.grid[i];
      slot.title = validStack(stack) ? stackName(stack.item) : '';
      fillSlot(slot, validStack(stack) ? stack : null);
      slot.addEventListener('click', () => onCellClick(i));
      gridBox.appendChild(slot);
    }

    const arrow = document.createElement('div');
    arrow.className = 'ui-craft-arrow';
    arrow.textContent = '→';

    const out = document.createElement('div');
    out.className = 'ui-slot ui-craft-result';
    out.title = result ? stackName(result.item) : '';
    fillSlot(out, result);
    out.addEventListener('click', onResultClick);

    row.append(gridBox, arrow, out);

    const bar = document.createElement('div');
    bar.className = 'ui-craft-hotbar';
    params.hotbar.forEach((stack, i) => {
      const slot = document.createElement('div');
      slot.className = i === selected ? 'ui-slot selected' : 'ui-slot';
      slot.dataset.slot = String(i);
      slot.title = validStack(stack) ? stackName(stack.item) : '';
      fillSlot(slot, validStack(stack) ? stack : null);
      slot.addEventListener('click', () => {
        selected = i;
        params.onSlotSelect?.(i);
        render();
      });
      bar.appendChild(slot);
    });

    section.replaceChildren(row, bar);
  };

  const onCellClick = (i: number): void => {
    const cellStack = params.grid[i];
    if (validStack(cellStack)) {
      // filled → hand one back; overflow (inventory full) leaves the cell as is
      if (params.onGiveBack(cellStack.item) > 0) {
        render();
        return;
      }
      params.grid[i] = cellStack.count > 1 ? { item: cellStack.item, count: cellStack.count - 1 } : null;
    } else {
      const src = params.hotbar[selected];
      if (!validStack(src)) return; // nothing selected to pull from
      if (!params.onSpend(selected, src.item)) return; // slot changed underneath
      params.grid[i] = { item: src.item, count: 1 };
    }
    render();
  };

  const onResultClick = (): void => {
    const result = matchRecipe(params.grid, params.size);
    if (!result) return;
    if (!params.onTake(result)) return; // overflow blocked → grid untouched (settled)
    // copy the consumed grid back into the caller-owned array (same length)
    const next = consumeGrid(params.grid);
    for (let i = 0; i < params.grid.length; i++) params.grid[i] = next[i];
    render();
  };

  render();
  host.appendChild(section);
  return () => section.remove();
}

export interface CraftingUi {
  /** Full-screen overlay (crafting-table 3×3): backdrop + centered panel.
   *  Backdrop click / Esc closes and invokes `onClose`. */
  open(params: CraftingOpenParams): void;
  close(): void;
  isOpen(): boolean;
}

/** Standalone overlay wrapper around `mountCrafting` (mirrors inventory.ts's
 *  backdrop + Esc lifecycle). The embedded 2×2 path uses `mountCrafting` directly. */
export function createCrafting(uiRoot: HTMLElement): CraftingUi {
  let el: HTMLElement | null = null;
  let unmount: (() => void) | null = null;
  let escHandler: ((e: KeyboardEvent) => void) | null = null;

  const detach = (): void => {
    if (escHandler) {
      document.removeEventListener('keydown', escHandler);
      escHandler = null;
    }
    unmount?.();
    unmount = null;
    el?.remove();
    el = null;
  };

  return {
    open(params) {
      detach();
      // local capture: the handlers run AFTER close(), which tears down state
      const closed = params.onClose;
      // transparent backdrop: outside clicks never reach the canvas (no
      // accidental pointer lock while the table UI is open)
      el = document.createElement('div');
      el.className = 'ui-overlay ui-craft-backdrop interactive';
      el.addEventListener('click', (e) => {
        if (e.target !== el) return; // clicks inside the panel only craft
        this.close();
        closed?.();
      });
      escHandler = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        this.close();
        closed?.();
      };
      document.addEventListener('keydown', escHandler);

      const panel = document.createElement('div');
      panel.className = 'ui-craft-panel interactive';
      const h = document.createElement('h3');
      h.textContent = params.size === 3 ? '工作台（3×3）' : '合成（2×2）';
      panel.appendChild(h);
      el.appendChild(panel);
      uiRoot.appendChild(el);
      unmount = mountCrafting(panel, params);
    },
    close() {
      detach();
    },
    isOpen: () => el !== null,
  };
}
