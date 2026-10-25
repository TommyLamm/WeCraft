import './ui.css';
import { consumeGrid, matchRecipe } from '../core/recipes';
import type { ItemId, ItemStack } from '../core/items';
import { stackName } from '../core/items';
import { ICON_PX, getContext2d, itemIcon } from './icons';
import { mountDurabilityBar } from './durbar';

// ---- Crafting UI (Task 11) ----
//
// Click model (settled — no drag-and-drop, no cursor stack):
//   - click an EMPTY grid cell  → move 1 item from the selected source slot in;
//   - click a FILLED grid cell  → return 1 item to the inventory (stays put
//     when the inventory is full);
//   - click a source slot       → select it as the transfer source;
//   - click the result slot     → take the craft: `onTake` must accept it
//     (overflow → blocked, grid untouched), then each grid cell −1.
// The grid + slots arrays are LIVE references owned by the caller — the UI
// mutates the grid in place and re-reads `slots` on every render, so the
// caller keeps its own view in sync without change events (Decision A: this
// module imports no bus; everything happens through the callbacks below).

export interface CraftingParams {
  /** Grid side length: 2 (inventory screen) or 3 (crafting table). */
  size: 2 | 3;
  /** Live backing grid, length `size²`, row-major like the inventory slots.
   *  The UI writes into it directly (set by the owner, read back on close). */
  grid: Array<ItemStack | null>;
  /** 背包的活陣列（36 格，唯讀給 UI——變動一律走 callbacks）；
   *  來源列取前 `sourceCount` 格。 */
  slots: ReadonlyArray<ItemStack | null>;
  /** 來源列顯示幾格（預設 9 ＝ 熱鍵列；工作台 3×3 可傳 36 讓主背包也當來源）。 */
  sourceCount?: number;
  /** Source slot the grid draws from; the UI tracks it from here on.
   *  `onSpend` 的 `slot` 以 `slots` 的索引（0..35）傳回 —— 來源列只顯示前
   *  `sourceCount` 格，所以實際傳回的索引也在這範圍內。 */
  selected: number;
  /** Player picked another hotbar slot in the panel — notify-only: the source
   *  selection is LOCAL to the widget (Minecraft-like) and does not move the
   *  game's hotbar selection; owners that don't care simply omit it. */
  onSlotSelect?(slot: number): void;
  /** Remove 1 `item` from `slots[slot]`（slot 是背包活陣列的索引 0..35）;
   *  false → nothing moved (wrong/empty). */
  onSpend(slot: number, item: ItemId): boolean;
  /** Put 1 `item` back into the inventory; returns overflow (1 = didn't fit).
   *  B7 R6：`dur` 是這格堆疊的剩餘耐久（受損工具交還時不得被洗成滿耐久）；
   *  非耐久物品沒有 `dur`（呼叫端照舊只收到一個引數的有意義值）。 */
  onGiveBack(item: ItemId, dur?: number): number;
  /** Try to take `result`; false blocks the take and leaves the grid intact. */
  onTake(result: ItemStack): boolean;
}

export type CraftingOpenParams = CraftingParams & { onClose?(): void };

const validStack = (s: ItemStack | null | undefined): s is ItemStack =>
  !!s && Number.isFinite(s.count) && s.count >= 1;

/** B5 Task 8：來源列寬度來自呼叫端（預設 9 ＝ 熱鍵列；工作台 3×3 傳 36）。
 *  每次 render 都重新 slice —— `params.slots` 是活的 36 格陣列。 */
const DEFAULT_SOURCE_SLOTS = 9;

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
  // B7：受損工具 → 格子底部的耐久條（合成格與來源列都走這裡；非耐久物品
  // 與滿耐久的工具不受影響）。掛載本身冪等，重繪不會疊出多條。
  mountDurabilityBar(slot, stack);
}

/** Render the crafting section (grid + arrow + result + hotbar row) into `host`.
 *  Returns an unmount function. The section re-renders itself after every
 *  interaction — all state lives in the params' live arrays + local `selected`. */
export function mountCrafting(host: HTMLElement, params: CraftingParams): () => void {
  const sourceCount = params.sourceCount ?? DEFAULT_SOURCE_SLOTS;
  let selected =
    Number.isInteger(params.selected) && params.selected >= 0 && params.selected < sourceCount
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
    // 來源列：每次 render 重新 slice —— params.slots 是活的 36 格陣列，
    // 取前 sourceCount 格（預設 9 ＝ 熱鍵列；工作台傳 36）。
    params.slots.slice(0, sourceCount).forEach((stack, i) => {
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
      // B7 R6：耐久跟著堆疊走（受損工具交還不得洗白）
      if (params.onGiveBack(cellStack.item, cellStack.dur) > 0) {
        render();
        return;
      }
      params.grid[i] = cellStack.count > 1 ? { item: cellStack.item, count: cellStack.count - 1 } : null;
    } else {
      const src = params.slots[selected];
      if (!validStack(src)) return; // nothing selected to pull from
      if (!params.onSpend(selected, src.item)) return; // slot changed underneath
      // B7 R6：耐久跟著堆疊進合成格（受損工具拉進來不得洗白）；
      // 非耐久物品沒有 `dur` → 不寫入 `dur: undefined`。
      params.grid[i] = { item: src.item, count: 1, ...(src.dur !== undefined ? { dur: src.dur } : {}) };
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
