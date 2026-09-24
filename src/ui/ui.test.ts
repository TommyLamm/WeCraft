import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHud } from './hud';
import { createMenus } from './menus';
import { createInventory } from './inventory';
import { HOTBAR_DEFAULT, PLACEABLE, BLOCK, type BlockId } from '../world/blocks';
import { itemFromBlock, maxStack, stackFromBlock, type ItemStack } from '../core/items';
import { loadSettings } from '../core/settings';

/** Build the stack form of a block list (every placeable block has an item). */
function stacksOf(blocks: BlockId[]): Array<ItemStack | null> {
  return blocks.map((b) => stackFromBlock(b));
}
const DEFAULT_STACKS = stacksOf(HOTBAR_DEFAULT);

beforeEach(() => {
  localStorage.clear();
  document.getElementById('ui-root')?.remove();
  const root = document.createElement('div');
  root.id = 'ui-root';
  document.body.appendChild(root);
});

function btnByText(root: HTMLElement, text: string): HTMLButtonElement {
  const b = [...root.querySelectorAll('button')].find((x) => x.textContent === text);
  if (!b) throw new Error(`button not found: ${text}`);
  return b;
}

describe('ui smoke', () => {
  it('createHud builds hotbar with 9 slots', () => {
    const root = document.getElementById('ui-root')!;
    const hud = createHud(root);
    hud.setHotbar(DEFAULT_STACKS, 0);
    expect(root.querySelectorAll('.ui-slot').length).toBe(9);
    expect(root.querySelectorAll('.ui-slot.selected').length).toBe(1);
    hud.dispose();
  });

  it('setHotbar re-renders when a slot block changes', () => {
    const root = document.getElementById('ui-root')!;
    const hud = createHud(root);
    hud.setHotbar(DEFAULT_STACKS, 0);
    expect(root.querySelectorAll('.ui-slot').length).toBe(9);
    const next = stacksOf(HOTBAR_DEFAULT);
    next[0] = { item: itemFromBlock(BLOCK.BEDROCK)!, count: 64 };
    hud.setHotbar(next, 0);
    expect(root.querySelectorAll('.ui-slot').length).toBe(9);
    expect(root.querySelectorAll('.ui-slot.selected').length).toBe(1);
    hud.setHotbar(next, 0);
    expect(root.querySelectorAll('.ui-slot').length).toBe(9);
    hud.dispose();
  });

  it('setHotbar renders stack counts (only when > 1)', () => {
    const root = document.getElementById('ui-root')!;
    const hud = createHud(root);
    const next = stacksOf(HOTBAR_DEFAULT);
    next[0] = { item: 'grass', count: 64 };
    next[1] = { item: 'dirt', count: 1 };
    hud.setHotbar(next, 0);
    const badges = [...root.querySelectorAll('.ui-slot .count')].map((e) => e.textContent);
    expect(badges[0]).toBe('64');
    expect(badges[1]).toBe('');
    hud.dispose();
  });

  it('dispose clears hud DOM', () => {
    const root = document.getElementById('ui-root')!;
    const hud = createHud(root);
    hud.setHotbar(DEFAULT_STACKS, 0);
    expect(root.querySelectorAll('*').length).toBeGreaterThan(0);
    hud.dispose();
    expect(root.querySelectorAll('*').length).toBe(0);
  });

  it('menus show and hide title', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    menus.showTitle(() => {});
    expect(menus.isVisible()).toBe(true);
    expect(root.textContent).toContain('單人遊戲');
    menus.hideAll();
    expect(menus.isVisible()).toBe(false);
  });

  it('inventory open/close', () => {
    const root = document.getElementById('ui-root')!;
    const inv = createInventory(root);
    inv.open(DEFAULT_STACKS, 0, () => {});
    expect(inv.isOpen()).toBe(true);
    expect(root.querySelector('.ui-inv-backdrop')).not.toBeNull();
    inv.close();
    expect(inv.isOpen()).toBe(false);
    expect(root.querySelector('.ui-inv-backdrop')).toBeNull();
  });
});

describe('hud debug overlay', () => {
  it('setDebug shows lines then hides with null', () => {
    const root = document.getElementById('ui-root')!;
    const hud = createHud(root);
    const debug = root.querySelector('.ui-debug') as HTMLElement;
    expect(debug.style.display).toBe('none');
    hud.setDebug(['fps: 60', 'XYZ: 1 / 2 / 3']);
    expect(debug.style.display).toBe('block');
    expect(debug.textContent).toContain('fps: 60');
    hud.setDebug(null);
    expect(debug.style.display).toBe('none');
    hud.dispose();
  });
});

describe('inventory pick', () => {
  it('clicking a placeable calls onPick with a full stack for the selected slot', () => {
    const root = document.getElementById('ui-root')!;
    const inv = createInventory(root);
    const onPick = vi.fn();
    inv.open(DEFAULT_STACKS, 2, onPick);
    const slot = root.querySelector('.ui-inv-grid .ui-slot') as HTMLElement;
    expect(slot).not.toBeNull();
    expect(root.querySelectorAll('.ui-inv-grid .ui-slot').length).toBe(PLACEABLE.length);
    slot.click();
    const picked = itemFromBlock(PLACEABLE[0])!;
    expect(onPick).toHaveBeenCalledWith(2, { item: picked, count: maxStack(picked) });
    inv.close();
  });
});

describe('inventory backdrop close', () => {
  it('backdrop click closes and calls onClose; panel click does not', () => {
    const root = document.getElementById('ui-root')!;
    const inv = createInventory(root);
    const onClose = vi.fn();
    inv.open(DEFAULT_STACKS, 0, () => {}, onClose);
    const panel = root.querySelector('.ui-inventory') as HTMLElement;
    panel.click();
    expect(onClose).not.toHaveBeenCalled();
    expect(inv.isOpen()).toBe(true);
    const backdrop = root.querySelector('.ui-inv-backdrop') as HTMLElement;
    backdrop.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(inv.isOpen()).toBe(false);
  });
});

describe('pause menu', () => {
  it('resume invokes callback and can hide menu', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    const onResume = vi.fn(() => menus.hideAll());
    menus.showPause({ onResume, onQuit: () => {} });
    expect(root.textContent).toContain('遊戲已暫停');
    btnByText(root, '繼續遊戲').click();
    expect(onResume).toHaveBeenCalled();
    expect(menus.isVisible()).toBe(false);
  });

  it('quit invokes callback', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    const onQuit = vi.fn();
    menus.showPause({ onResume: () => {}, onQuit });
    btnByText(root, '回到標題').click();
    expect(onQuit).toHaveBeenCalled();
    menus.hideAll();
  });

  it('settings sliders persist via saveSettings on change only', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    menus.showPause({ onResume: () => {}, onQuit: () => {} });
    btnByText(root, '設定').click();
    const ranges = [...root.querySelectorAll('input[type="range"]')] as HTMLInputElement[];
    expect(ranges.length).toBe(3);
    ranges[0].value = '12';
    ranges[0].dispatchEvent(new Event('input', { bubbles: true }));
    expect(loadSettings().renderDistance).toBe(10); // input alone must not persist
    ranges[0].dispatchEvent(new Event('change', { bubbles: true }));
    expect(loadSettings().renderDistance).toBe(12);
    btnByText(root, '返回').click();
    expect(root.textContent).toContain('遊戲已暫停');
    menus.hideAll();
  });
});
