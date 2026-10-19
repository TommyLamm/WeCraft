import './ui.css';
import { PLACEABLE } from '../world/blocks';
import { stackFromBlock, stackName, type ItemStack } from '../core/items';
import type { GameMode } from '../core/inventory';
import { itemIcon } from './icons';
import { mountCrafting, type CraftingParams } from './crafting';

export interface InventoryUi {
  /** `crafting` (Task 11) mounts a 2×2 crafting section into the panel —
   *  omitted by callers that only want the palette. It is unmounted again in
   *  `close()`, so the caller owns no lifecycle beyond passing params.
   *
   *  `mode` (B1.2) picks what the grid lists: `'survival'` renders the OWNED
   *  hotbar only (no pick handlers — the panel must not hand out free
   *  stacks), anything else keeps the creative `PLACEABLE` palette. The
   *  default keeps every pre-B1.2 caller (and test) on the palette. */
  open(
    hotbar: ReadonlyArray<ItemStack | null>,
    selected: number,
    onPick: (slot: number, stack: ItemStack) => void,
    onClose?: () => void,
    crafting?: CraftingParams,
    mode?: GameMode,
  ): void;
  close(): void;
  isOpen(): boolean;
}

export function createInventory(uiRoot: HTMLElement): InventoryUi {
  let el: HTMLElement | null = null;
  let escHandler: ((e: KeyboardEvent) => void) | null = null;
  let unmountCrafting: (() => void) | null = null;

  return {
    open(hotbar, selected, onPick, onClose, crafting, mode = 'creative') {
      this.close();
      // Full-screen transparent backdrop captures outside clicks so they never
      // reach the canvas (prevents requestPointerLock while inventory is open).
      // Phase 1 close path: E only fires while pointer-locked and opening the
      // inventory unlocks, so a backdrop ("screen") click closes instead.
      el = document.createElement('div');
      el.className = 'ui-overlay ui-inv-backdrop interactive';
      el.addEventListener('click', (e) => {
        if (e.target !== el) return; // clicks on the panel pick a block, never close
        this.close();
        onClose?.();
      });
      // Esc also closes (does not conflict: input E-gating skips keys while unlocked);
      // removed again in close()
      escHandler = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        this.close();
        onClose?.();
      };
      document.addEventListener('keydown', escHandler);
      const panel = document.createElement('div');
      panel.className = 'ui-inventory interactive';
      const survival = mode === 'survival';
      const h = document.createElement('h3');
      // The craft-slot hint only makes sense for the palette; survival lists
      // the hotbar (the whole inventory) as-is.
      h.textContent = survival ? '背包' : `方塊（點選放入欄位 ${selected + 1}）`;
      const grid = document.createElement('div');
      grid.className = 'ui-inv-grid';
      if (survival) {
        // B1.2: owned items only, one slot per hotbar entry. Deliberately NO
        // click handler — picking here would mint a free full stack.
        for (const stack of hotbar) {
          const s = document.createElement('div');
          s.className = 'ui-slot';
          if (stack) {
            s.title = stackName(stack.item);
            s.appendChild(itemIcon(stack.item));
          }
          grid.appendChild(s);
        }
      } else {
        for (const id of PLACEABLE) {
          const stack = stackFromBlock(id);
          if (!stack) continue; // unreachable: every PLACEABLE block has an item
          const s = document.createElement('div');
          s.className = 'ui-slot';
          s.title = stackName(stack.item);
          s.appendChild(itemIcon(stack.item));
          s.addEventListener('click', () => onPick(selected, { ...stack }));
          grid.appendChild(s);
        }
      }
      // Task 11: the 2×2 crafting section sits above the palette (survival
      // crafting); the creative palette below stays untouched.
      panel.append(h);
      if (crafting) unmountCrafting = mountCrafting(panel, crafting);
      panel.append(grid);
      el.appendChild(panel);
      uiRoot.appendChild(el);
    },
    close() {
      if (escHandler) {
        document.removeEventListener('keydown', escHandler);
        escHandler = null;
      }
      unmountCrafting?.();
      unmountCrafting = null;
      el?.remove();
      el = null;
    },
    isOpen: () => el !== null,
  };
}
