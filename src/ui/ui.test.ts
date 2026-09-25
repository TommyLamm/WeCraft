import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHud } from './hud';
import { createMenus } from './menus';
import { createInventory } from './inventory';
import { HOTBAR_DEFAULT, PLACEABLE, BLOCK, type BlockId } from '../world/blocks';
import { itemFromBlock, maxStack, stackFromBlock, type ItemStack } from '../core/items';
import { loadSettings, saveSettings } from '../core/settings';

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

  it('setHotbar re-renders when the same stack object mutates in place (model merge)', () => {
    const root = document.getElementById('ui-root')!;
    const hud = createHud(root);
    const list = stacksOf(HOTBAR_DEFAULT);
    const dirt: ItemStack = { item: 'dirt', count: 60 };
    list[0] = dirt;
    hud.setHotbar(list, 0);
    const badges = () => [...root.querySelectorAll('.ui-slot .count')].map((e) => e.textContent);
    expect(badges()[0]).toBe('60');
    dirt.count = 61; // inventory model mutates stacks in place — same array, same object
    hud.setHotbar(list, 0);
    expect(badges()[0]).toBe('61');
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
    menus.showTitle({ hasSave: false, onContinue: () => {}, onNewGame: () => {} });
    expect(menus.isVisible()).toBe(true);
    expect(root.textContent).toContain('單人遊戲');
    menus.hideAll();
    expect(menus.isVisible()).toBe(false);
  });

  it('title screen shows the current mode (Task 5)', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    menus.showTitle({ hasSave: false, onContinue: () => {}, onNewGame: () => {} });
    expect(root.textContent).toContain('Mode: Survival'); // default mode
    menus.hideAll();
    saveSettings({ mode: 'creative' });
    menus.showTitle({ hasSave: false, onContinue: () => {}, onNewGame: () => {} });
    expect(root.textContent).toContain('Mode: Creative');
    menus.hideAll();
  });

  it('title shows 繼續遊戲 only when a save exists (Task 14)', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    // no save → Continue button hidden (settled: hidden, not a fallback)
    menus.showTitle({ hasSave: false, onContinue: () => {}, onNewGame: () => {} });
    expect(root.textContent).toContain('單人遊戲');
    expect(root.textContent).not.toContain('繼續遊戲');
    menus.hideAll();
    // save exists → Continue mounts above new game and is wired
    const onContinue = vi.fn();
    const onNewGame = vi.fn();
    menus.showTitle({ hasSave: true, onContinue, onNewGame });
    const labels = [...root.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('繼續遊戲');
    btnByText(root, '繼續遊戲').click();
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onNewGame).not.toHaveBeenCalled();
    btnByText(root, '單人遊戲').click();
    expect(onNewGame).toHaveBeenCalledTimes(1);
    menus.hideAll();
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
    menus.showPause({ onResume, onQuit: () => {}, onToggleMode: () => {}, onSaveQuit: () => {} });
    expect(root.textContent).toContain('遊戲已暫停');
    btnByText(root, '繼續遊戲').click();
    expect(onResume).toHaveBeenCalled();
    expect(menus.isVisible()).toBe(false);
  });

  it('quit invokes callback', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    const onQuit = vi.fn();
    menus.showPause({ onResume: () => {}, onQuit, onToggleMode: () => {}, onSaveQuit: () => {} });
    btnByText(root, '回到標題').click();
    expect(onQuit).toHaveBeenCalled();
    menus.hideAll();
  });

  it('儲存並離開 invokes onSaveQuit only; 回到標題 stays an unsaved quit (Task 14)', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    const onSaveQuit = vi.fn();
    const onQuit = vi.fn();
    menus.showPause({ onResume: () => {}, onQuit, onToggleMode: () => {}, onSaveQuit });
    expect(root.textContent).toContain('儲存並離開');
    btnByText(root, '儲存並離開').click();
    expect(onSaveQuit).toHaveBeenCalledTimes(1);
    expect(onQuit).not.toHaveBeenCalled(); // save-quit must NOT fire the plain quit
    btnByText(root, '回到標題').click();
    expect(onQuit).toHaveBeenCalledTimes(1);
    expect(onSaveQuit).toHaveBeenCalledTimes(1);
    menus.hideAll();
  });

  it('toggle button shows current mode and calls onToggleMode (Task 5)', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    // realistic wiring: main.ts persists via saveSettings inside the callback
    const onToggleMode = vi.fn(() => {
      saveSettings({
        mode: loadSettings().mode === 'survival' ? 'creative' : 'survival',
      });
    });
    menus.showPause({ onResume: () => {}, onQuit: () => {}, onToggleMode, onSaveQuit: () => {} });
    btnByText(root, 'Mode: Survival').click();
    expect(onToggleMode).toHaveBeenCalledTimes(1);
    // pause re-renders from settings → label flips without reopening the menu
    btnByText(root, 'Mode: Creative').click();
    expect(onToggleMode).toHaveBeenCalledTimes(2);
    expect(root.textContent).toContain('Mode: Survival');
    menus.hideAll();
  });

  it('pause menu shows resume, quit and a wired mode toggle (required params)', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    const onResume = vi.fn();
    const onQuit = vi.fn();
    const onToggleMode = vi.fn();
    menus.showPause({ onResume, onQuit, onToggleMode, onSaveQuit: () => {} });
    btnByText(root, '繼續遊戲').click();
    btnByText(root, '回到標題').click();
    btnByText(root, 'Mode: Survival').click();
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onQuit).toHaveBeenCalledTimes(1);
    expect(onToggleMode).toHaveBeenCalledTimes(1);
    menus.hideAll();
  });

  it('settings sliders persist via saveSettings on change only', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    menus.showPause({
      onResume: () => {},
      onQuit: () => {},
      onToggleMode: () => {},
      onSaveQuit: () => {},
    });
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
