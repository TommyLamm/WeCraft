import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCrafting, mountCrafting, type CraftingParams } from './crafting';
import { createInventory } from './inventory';
import type { ItemId, ItemStack } from '../core/items';

beforeEach(() => {
  document.getElementById('ui-root')?.remove();
  const root = document.createElement('div');
  root.id = 'ui-root';
  document.body.appendChild(root);
});

const root = (): HTMLElement => document.getElementById('ui-root')!;

/** Query inside a freshly-mounted section (the UI re-renders and replaces its
 *  elements after every click, so tests must re-query each time). */
const cell = (i: number): HTMLElement => root().querySelector(`[data-cell="${i}"]`) as HTMLElement;
const hotbarSlot = (i: number): HTMLElement =>
  root().querySelector(`[data-slot="${i}"]`) as HTMLElement;
const resultSlot = (): HTMLElement => root().querySelector('.ui-craft-result') as HTMLElement;

interface Harness {
  grid: Array<ItemStack | null>;
  hotbar: Array<ItemStack | null>;
  params: CraftingParams;
}

/** A size-`size` grid + a 9-slot hotbar (planks in 0, sticks in 1) wired to
 *  mutation callbacks that behave like main.ts's inventory wiring. */
function harness(size: 2 | 3, overrides: Partial<CraftingParams> = {}): Harness {
  const grid: Array<ItemStack | null> = new Array(size * size).fill(null);
  const hotbar: Array<ItemStack | null> = [
    { item: 'oak_planks', count: 3 },
    { item: 'stick', count: 2 },
    null, null, null, null, null, null, null,
  ];
  const params: CraftingParams = {
    size,
    grid,
    hotbar,
    selected: 0,
    onSlotSelect: vi.fn(),
    onSpend: vi.fn((slot: number, item: ItemId) => {
      const s = hotbar[slot];
      if (!s || s.item !== item || s.count < 1) return false;
      hotbar[slot] = s.count > 1 ? { item: s.item, count: s.count - 1 } : null;
      return true;
    }),
    onGiveBack: vi.fn((item: ItemId) => {
      const cap = item === 'wooden_pickaxe' ? 1 : 64;
      for (const s of hotbar) {
        if (s && s.item === item && s.count < cap) {
          s.count += 1;
          return 0;
        }
      }
      for (let i = 0; i < hotbar.length; i++) {
        if (!hotbar[i]) {
          hotbar[i] = { item, count: 1 };
          return 0;
        }
      }
      return 1; // inventory full → item stays in the grid
    }),
    onTake: vi.fn(() => true),
    ...overrides,
  };
  return { grid, hotbar, params };
}

/** Click a grid cell `n` times, re-querying each time (elements are replaced). */
function clickCell(i: number, times = 1): void {
  for (let n = 0; n < times; n++) cell(i).click();
}

describe('crafting section (embedded)', () => {
  it('2×2 renders 4 grid slots + result slot + hotbar row', () => {
    const { params } = harness(2);
    const unmount = mountCrafting(root(), params);
    expect(root().querySelectorAll('.ui-craft-grid .ui-slot').length).toBe(4);
    expect(root().querySelectorAll('.ui-craft-result').length).toBe(1);
    expect(root().querySelectorAll('.ui-craft-hotbar .ui-slot').length).toBe(9);
    expect(root().querySelector('.ui-craft-grid.size-2')).not.toBeNull();
    unmount();
    expect(root().querySelector('.ui-craft')).toBeNull();
  });

  it('3×3 renders 9 grid slots', () => {
    const { params } = harness(3);
    mountCrafting(root(), params);
    expect(root().querySelectorAll('.ui-craft-grid .ui-slot').length).toBe(9);
    expect(root().querySelector('.ui-craft-grid.size-3')).not.toBeNull();
  });

  it('inventory screen embeds the 2×2 section and unmounts it on close', () => {
    const inv = createInventory(root());
    const { params } = harness(2);
    inv.open([], 0, () => {}, undefined, params);
    expect(inv.isOpen()).toBe(true);
    expect(root().querySelectorAll('.ui-craft-grid .ui-slot').length).toBe(4);
    expect(root().querySelector('.ui-craft-result')).not.toBeNull();
    expect(root().querySelector('.ui-inv-grid')).not.toBeNull(); // palette still there
    inv.close();
    expect(root().querySelector('.ui-craft')).toBeNull();
    expect(inv.isOpen()).toBe(false);
  });

  it('no crafting params → no 2×2 section, palette intact (creative gate seam)', () => {
    // main.ts passes `undefined` in creative (crafting hidden, plan 12.4)
    const inv = createInventory(root());
    inv.open([], 0, () => {}, undefined, undefined);
    expect(inv.isOpen()).toBe(true);
    expect(root().querySelector('.ui-craft')).toBeNull();
    expect(root().querySelectorAll('.ui-craft-grid .ui-slot').length).toBe(0);
    expect(root().querySelector('.ui-inv-grid')).not.toBeNull(); // palette untouched
    inv.close();
  });

  it('clicking an empty cell moves 1 item from the selected hotbar slot into the grid', () => {
    const { grid, hotbar, params } = harness(2);
    mountCrafting(root(), params);
    clickCell(0);
    expect(params.onSpend).toHaveBeenCalledWith(0, 'oak_planks');
    expect(grid[0]).toEqual({ item: 'oak_planks', count: 1 });
    expect(hotbar[0]).toEqual({ item: 'oak_planks', count: 2 }); // 3 → 2
    // hotbar slot 1 is a different item: switching source selects it first
    hotbarSlot(1).click();
    expect(params.onSlotSelect).toHaveBeenCalledWith(1);
    clickCell(1);
    expect(grid[1]).toEqual({ item: 'stick', count: 1 });
    expect(hotbar[1]).toEqual({ item: 'stick', count: 1 });
  });

  it('clicking a filled cell returns one item to the inventory', () => {
    const { grid, params } = harness(2);
    mountCrafting(root(), params);
    clickCell(0); // place
    expect(grid[0]).not.toBeNull();
    clickCell(0); // take one back
    expect(params.onGiveBack).toHaveBeenCalledWith('oak_planks');
    expect(grid[0]).toBeNull();
  });

  it('placing a matching pattern shows the result live (2 planks vertical → stick ×4)', () => {
    const { params } = harness(2);
    const unmount = mountCrafting(root(), params);
    clickCell(0);
    clickCell(2);
    const result = resultSlot();
    expect(result.getAttribute('title')).toBe('Stick');
    expect(result.querySelector('.count')?.textContent).toBe('4');
    unmount();
    // fresh section with no pattern → empty result
    mountCrafting(root(), harness(2).params);
    expect(resultSlot().getAttribute('title')).toBe('');
  });
});

describe('taking the result', () => {
  it('clicking the result consumes the grid (each cell −1, 1 → null)', () => {
    const { grid, params } = harness(2);
    mountCrafting(root(), params);
    clickCell(0);
    clickCell(2);
    resultSlot().click();
    expect(params.onTake).toHaveBeenCalledWith({ item: 'stick', count: 4 });
    expect(grid[0]).toBeNull();
    expect(grid[2]).toBeNull();
    expect(resultSlot().getAttribute('title')).toBe(''); // recipe gone after consume
  });

  it('overflow blocks the take: onTake → false leaves the grid untouched', () => {
    const { grid, params } = harness(2, { onTake: vi.fn(() => false) });
    mountCrafting(root(), params);
    clickCell(0);
    clickCell(2);
    resultSlot().click();
    expect(params.onTake).toHaveBeenCalledWith({ item: 'stick', count: 4 });
    expect(grid[0]).toEqual({ item: 'oak_planks', count: 1 });
    expect(grid[2]).toEqual({ item: 'oak_planks', count: 1 });
    expect(resultSlot().getAttribute('title')).toBe('Stick'); // still craftable
  });

  it('clicking an empty result slot does nothing', () => {
    const { grid, params } = harness(3);
    mountCrafting(root(), params);
    resultSlot().click();
    expect(params.onTake).not.toHaveBeenCalled();
    expect(grid.every((c) => c === null)).toBe(true);
  });
});

describe('crafting overlay (createCrafting)', () => {
  it('open 3×3 / close / isOpen lifecycle with backdrop + Esc handling', () => {
    const craft = createCrafting(root());
    expect(craft.isOpen()).toBe(false);
    craft.open(harness(3).params);
    expect(craft.isOpen()).toBe(true);
    expect(root().querySelector('.ui-craft-backdrop')).not.toBeNull();
    expect(root().querySelectorAll('.ui-craft-grid .ui-slot').length).toBe(9);
    craft.close();
    expect(craft.isOpen()).toBe(false);
    expect(root().querySelector('.ui-craft')).toBeNull();
  });

  it('backdrop click closes and calls onClose; panel click does not', () => {
    const craft = createCrafting(root());
    const onClose = vi.fn();
    craft.open({ ...harness(2).params, onClose });
    (root().querySelector('.ui-craft-panel') as HTMLElement).click();
    expect(onClose).not.toHaveBeenCalled();
    expect(craft.isOpen()).toBe(true);
    (root().querySelector('.ui-craft-backdrop') as HTMLElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(craft.isOpen()).toBe(false);
  });

  it('Esc closes the overlay and calls onClose', () => {
    const craft = createCrafting(root());
    const onClose = vi.fn();
    craft.open({ ...harness(2).params, onClose });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(craft.isOpen()).toBe(false);
  });

  it('open → close → open → Esc: one onClose, exactly one live handler', () => {
    const craft = createCrafting(root());
    const onClose = vi.fn();
    craft.open({ ...harness(2).params, onClose });
    craft.close();
    expect(onClose).not.toHaveBeenCalled(); // close() alone never notifies
    craft.open({ ...harness(2).params, onClose });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(craft.isOpen()).toBe(false);
    // the previous session's Esc handler must be gone — a stray key is inert
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // reopening attaches exactly one fresh handler and never stacks overlays
    craft.open({ ...harness(2).params, onClose });
    expect(root().querySelectorAll('.ui-craft').length).toBe(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(root().querySelector('.ui-craft')).toBeNull();
  });
});
