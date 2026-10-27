import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHud, formatDebugLines } from './hud';
import { createMenus, confirmQuitToTitle } from './menus';
import type { CloudStatus } from '../platform/playroom';
import { createInventory } from './inventory';
import { HOTBAR_DEFAULT, BLOCK, type BlockId } from '../world/blocks';
import {
  ALL_ITEM_IDS,
  INVENTORY_SLOTS,
  itemFromBlock,
  maxStack,
  stackFromBlock,
  stackName,
  type ItemStack,
} from '../core/items';
import { loadSettings, saveSettings } from '../core/settings';

/** Build the stack form of a block list (every placeable block has an item). */
function stacksOf(blocks: BlockId[]): Array<ItemStack | null> {
  return blocks.map((b) => stackFromBlock(b));
}
const DEFAULT_STACKS = stacksOf(HOTBAR_DEFAULT);

/** B5 Task 8 面板的標準輸入形狀：36 格活陣列（前 9 格熱鍵列、其餘主背包）。 */
function slots36(): Array<ItemStack | null> {
  return Array.from({ length: INVENTORY_SLOTS }, () => null);
}

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
    menus.showTitle({ saveState: 'no', onContinue: () => {}, onNewGame: () => {} });
    expect(menus.isVisible()).toBe(true);
    expect(root.textContent).toContain('單人遊戲');
    menus.hideAll();
    expect(menus.isVisible()).toBe(false);
  });

  it('title screen shows the current mode (Task 5)', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    menus.showTitle({ saveState: 'no', onContinue: () => {}, onNewGame: () => {} });
    expect(root.textContent).toContain('Mode: Survival'); // default mode
    menus.hideAll();
    saveSettings({ mode: 'creative' });
    menus.showTitle({ saveState: 'no', onContinue: () => {}, onNewGame: () => {} });
    expect(root.textContent).toContain('Mode: Creative');
    menus.hideAll();
  });

  it('title shows 繼續遊戲 only when a save exists (Task 14)', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    // no save → Continue button hidden (settled: hidden, not a fallback)
    menus.showTitle({ saveState: 'no', onContinue: () => {}, onNewGame: () => {} });
    expect(root.textContent).toContain('單人遊戲');
    expect(root.textContent).not.toContain('繼續遊戲');
    menus.hideAll();
    // save exists → Continue mounts above new game and is wired
    const onContinue = vi.fn();
    const onNewGame = vi.fn();
    menus.showTitle({ saveState: 'yes', onContinue, onNewGame });
    const labels = [...root.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('繼續遊戲');
    btnByText(root, '繼續遊戲').click();
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onNewGame).not.toHaveBeenCalled();
    btnByText(root, '單人遊戲').click();
    expect(onNewGame).toHaveBeenCalledTimes(1);
    menus.hideAll();
  });

  describe('title saveState tri-state (A1：標題先掛、雲端背景載入)', () => {
    it('mounts immediately with a DISABLED Continue while the save check is pending', () => {
      const root = document.getElementById('ui-root')!;
      const menus = createMenus(root);
      const onContinue = vi.fn();
      menus.showTitle({
        saveState: 'pending',
        statusText: '正在檢查雲端進度…',
        onContinue,
        onNewGame: () => {},
      });
      // The title is on screen BEFORE the cloud settles (A1) — but the entry
      // button must not pretend the answer is known.
      const labels = [...root.querySelectorAll('button')].map((b) => b.textContent);
      expect(labels).toContain('繼續遊戲');
      expect(btnByText(root, '繼續遊戲').disabled).toBe(true);
      expect(root.textContent).toContain('正在檢查雲端進度…');
      btnByText(root, '繼續遊戲').click();
      expect(onContinue).not.toHaveBeenCalled();
    });

    it('enables Continue once the save state is yes', () => {
      const root = document.getElementById('ui-root')!;
      const menus = createMenus(root);
      const onContinue = vi.fn();
      menus.showTitle({ saveState: 'yes', onContinue, onNewGame: () => {} });
      const btn = btnByText(root, '繼續遊戲');
      expect(btn.disabled).toBe(false);
      btn.click();
      expect(onContinue).toHaveBeenCalledTimes(1);
    });

    it('hides Continue when the save state is no', () => {
      const root = document.getElementById('ui-root')!;
      const menus = createMenus(root);
      menus.showTitle({ saveState: 'no', onContinue: () => {}, onNewGame: () => {} });
      expect(root.textContent).toContain('單人遊戲');
      expect(root.textContent).not.toContain('繼續遊戲');
    });
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

describe('confirm dialog (B1.4)', () => {
  const MSG = '將覆蓋現有進度。確定要開始新遊戲嗎？';

  it('confirm dialog renders the message and both buttons', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    menus.showConfirm({ message: MSG, onConfirm: () => {}, onCancel: () => {} });
    const overlay = root.querySelector('.ui-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay!.textContent).toContain(MSG);
    const labels = [...overlay!.querySelectorAll('.ui-btn')].map((b) => b.textContent);
    expect(labels.length).toBe(2);
    expect(labels).toContain('確定');
    expect(labels).toContain('取消');
    expect(menus.isVisible()).toBe(true);
    menus.hideAll();
  });

  it('confirm fires onConfirm exactly once and unmounts', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    menus.showConfirm({ message: MSG, onConfirm, onCancel });
    const ok = btnByText(root, '確定');
    ok.click();
    // the first trigger cleared the dialog: this click hits a DETACHED node —
    // the single-fire guard must swallow it (no second world reset / no cancel)
    ok.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(root.querySelector('.ui-overlay')).toBeNull();
    expect(menus.isVisible()).toBe(false);
    // a button trigger must ALSO drop the Esc listener (no stale cancel)
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancel fires onCancel exactly once and unmounts', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    menus.showConfirm({ message: MSG, onConfirm, onCancel });
    const cancel = btnByText(root, '取消');
    cancel.click();
    cancel.click(); // detached second click — guard, not a live listener
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(root.querySelector('.ui-overlay')).toBeNull();
    expect(menus.isVisible()).toBe(false);
  });

  it('Escape cancels exactly once and removes the listener after', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    menus.showConfirm({ message: MSG, onConfirm, onCancel });
    // non-Escape keys reach the listener but must not trigger it
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w' }));
    expect(onCancel).not.toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.ui-overlay')).toBeNull();
    // the unmount removed the keydown listener — the second Esc is a no-op
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('conflict choice dialog (C1)', () => {
  const MSG = '雲端有其他裝置的進度，要如何處理？';

  it('renders the three choices and fires only the chosen one', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    const onKeepLocal = vi.fn();
    const onTakeCloud = vi.fn();
    const onMerge = vi.fn();
    menus.showConflictChoice({ message: MSG, onKeepLocal, onTakeCloud, onMerge });
    const overlay = root.querySelector('.ui-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay!.textContent).toContain(MSG);
    const labels = [...overlay!.querySelectorAll('.ui-btn')].map((b) => b.textContent);
    expect(labels).toContain('保留本機');
    expect(labels).toContain('採用雲端');
    expect(labels).toContain('合併');
    expect(labels.length).toBe(3);

    btnByText(root, '合併').click();
    expect(onMerge).toHaveBeenCalledTimes(1);
    expect(onKeepLocal).not.toHaveBeenCalled();
    expect(onTakeCloud).not.toHaveBeenCalled();
    expect(root.querySelector('.ui-overlay')).toBeNull();
  });

  it('is single-fire: a second click on a detached button never fires', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    const onKeepLocal = vi.fn();
    menus.showConflictChoice({
      message: MSG,
      onKeepLocal,
      onTakeCloud: () => {},
      onMerge: () => {},
    });
    const keep = btnByText(root, '保留本機');
    keep.click();
    keep.click();
    expect(onKeepLocal).toHaveBeenCalledTimes(1);
  });

  it('Escape picks 保留本機 — the choice that overwrites nothing', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    const onKeepLocal = vi.fn();
    const onTakeCloud = vi.fn();
    menus.showConflictChoice({ message: MSG, onKeepLocal, onTakeCloud, onMerge: () => {} });
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
    expect(onKeepLocal).toHaveBeenCalledTimes(1);
    expect(onTakeCloud).not.toHaveBeenCalled();
    expect(root.querySelector('.ui-overlay')).toBeNull();
    // listener removed with the dialog — a second Esc is a no-op
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
    expect(onKeepLocal).toHaveBeenCalledTimes(1);
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

describe('formatDebugLines', () => {
  const base = {
    fps: 60,
    x: 1.5,
    y: 64,
    z: -3.25,
    chunks: 12,
    seed: 1337,
    biome: 'plains' as const,
    mode: 'survival' as const,
    flying: false,
    triangles: 42,
  };

  it('reports the triangle count on its own line (F3 baseline check)', () => {
    const lines = formatDebugLines(base);
    expect(lines.some((l) => /^Triangles: 42$/.test(l))).toBe(true);
  });

  it('renders the Biome line between Seed and Triangles (Phase 3 Task 6)', () => {
    const lines = formatDebugLines(base);
    expect(lines.indexOf('Biome: plains')).toBe(lines.indexOf('Seed: 1337') + 1);
    expect(lines.indexOf('Triangles: 42')).toBe(lines.indexOf('Biome: plains') + 1);
  });

  it('keeps the fps and XYZ line formats byte-for-byte', () => {
    const lines = formatDebugLines(base);
    expect(lines[0]).toBe('WeCraft (dev)  60 fps'); // two spaces after (dev)
    expect(lines[1]).toBe('XYZ: 1.50 / 64.00 / -3.25');
  });

  it('renders Mode with (flying) only when flying is true', () => {
    const lines = formatDebugLines(base);
    expect(lines[lines.length - 1]).toBe('Mode: survival');
    const flying = formatDebugLines({ ...base, flying: true });
    expect(flying[flying.length - 1]).toBe('Mode: survival (flying)');
  });

  it('matches the previous inline output with Triangles between Seed and Mode', () => {
    expect(formatDebugLines(base)).toEqual([
      'WeCraft (dev)  60 fps',
      'XYZ: 1.50 / 64.00 / -3.25',
      'Block: 1 64 -4',
      'Chunks: 12',
      'Seed: 1337',
      'Biome: plains',
      'Triangles: 42',
      'Mode: survival',
    ]);
  });
});

describe('inventory panel (B5 Task 8: 36 slots + cursor stacks)', () => {
  it('the survival panel shows 27 main slots and 9 hotbar slots', () => {
    const root = document.getElementById('ui-root')!;
    const inv = createInventory(root);
    const onPick = vi.fn();
    const s = slots36();
    s[0] = { item: 'stone', count: 3 };
    inv.open(s, 0, onPick, undefined, undefined, 'survival');
    const main = root.querySelectorAll('.ui-inv-main .ui-slot');
    const bar = root.querySelectorAll('.ui-inv-bar .ui-slot');
    expect(main.length).toBe(27);
    expect(bar.length).toBe(9);
    expect(root.querySelectorAll('.ui-inv-list').length).toBe(0); // 生存沒有免費清單
    expect(root.querySelector('.ui-inventory')?.textContent).toContain('背包');
    // 原測試的 mint 保證保留：點擊持有格不得憑空發放整疊（B1.2 契約）
    (bar[0] as HTMLElement).click();
    expect(onPick).not.toHaveBeenCalled();
    inv.close();
  });

  it('the creative panel lists every item in a scrollable list', () => {
    const root = document.getElementById('ui-root')!;
    const inv = createInventory(root);
    const onPick = vi.fn();
    inv.open(slots36(), 0, onPick, undefined, undefined, 'creative');
    const list = root.querySelectorAll<HTMLElement>('.ui-inv-list .ui-slot');
    expect(list.length).toBe(ALL_ITEM_IDS.length);
    list[0].click();
    const first = ALL_ITEM_IDS[0];
    expect(onPick).toHaveBeenCalledWith(0, { item: first, count: maxStack(first) });
    expect(list[0].title).toBe(stackName(first));
    inv.close();
  });

  it('the creative list writes into the held hotbar slot', () => {
    const root = document.getElementById('ui-root')!;
    const inv = createInventory(root);
    const onPick = vi.fn();
    inv.open(slots36(), 3, onPick, undefined, undefined, 'creative');
    const list = root.querySelectorAll<HTMLElement>('.ui-inv-list .ui-slot');
    list[0].click();
    expect(onPick).toHaveBeenCalledWith(3, expect.objectContaining({ item: ALL_ITEM_IDS[0] }));
    inv.close();
  });

  it('left click picks a stack up and the next click places it', () => {
    const root = document.getElementById('ui-root')!;
    const inv = createInventory(root);
    const s = slots36();
    s[0] = { item: 'stone', count: 5 };
    s[10] = { item: 'dirt', count: 3 };
    const changes: Array<[number, ItemStack | null]> = [];
    inv.open(s, 0, () => {}, undefined, undefined, 'survival', {
      onSlotChange: (i, st) => changes.push([i, st]),
    });
    const hot0 = root.querySelectorAll('.ui-inv-bar .ui-slot')[0];
    const main0 = root.querySelectorAll('.ui-inv-main .ui-slot')[0];
    hot0.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(changes).toEqual([[0, null]]); // 拿起來 → 格子清空
    expect(root.querySelectorAll('.ui-cursor-stack').length).toBe(1); // 游標堆疊出現
    main0.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(changes[1][0]).toBe(9); // 放到主背包第 0 格（索引 9）
    expect(changes[1][1]).toEqual({ item: 'stone', count: 5 });
    expect(root.querySelectorAll('.ui-cursor-stack').length).toBe(0); // 游標清空
    inv.close();
  });

  it('left click on an occupied slot swaps the two stacks', () => {
    // 原版語義：空手點 A → 整疊上游標（A 清空）；再點 B（有貨）→ 交換：B 收下
    // A 的物品、B 原本的堆疊上到游標；點回空著的 A 把游標那疊放下之後，兩格
    // 內容互換、總數不變（不得遺失或複製）。
    const root = document.getElementById('ui-root')!;
    const inv = createInventory(root);
    const s = slots36();
    s[0] = { item: 'stone', count: 5 };
    s[9] = { item: 'dirt', count: 3 };
    const before = s.reduce((n, x) => n + (x ? x.count : 0), 0);
    const changes: Array<[number, ItemStack | null]> = [];
    inv.open(s, 0, () => {}, undefined, undefined, 'survival', {
      // 擁有者照 main.ts 的寫法把變動寫回活模型
      onSlotChange: (i, st) => {
        changes.push([i, st]);
        s[i] = st;
      },
    });
    const bar0 = root.querySelectorAll('.ui-inv-bar .ui-slot')[0] as HTMLElement;
    const main0 = root.querySelectorAll('.ui-inv-main .ui-slot')[0] as HTMLElement;
    bar0.dispatchEvent(new MouseEvent('click', { bubbles: true })); // 撿起 stone
    expect(changes).toEqual([[0, null]]);
    main0.dispatchEvent(new MouseEvent('click', { bubbles: true })); // stone ↔ dirt
    expect(changes[1]).toEqual([9, { item: 'stone', count: 5 }]);
    expect(root.querySelectorAll('.ui-cursor-stack').length).toBe(1); // dirt 在游標上
    bar0.dispatchEvent(new MouseEvent('click', { bubbles: true })); // dirt 回 A
    expect(changes[2]).toEqual([0, { item: 'dirt', count: 3 }]);
    expect(root.querySelectorAll('.ui-cursor-stack').length).toBe(0);
    expect(s[0]).toEqual({ item: 'dirt', count: 3 });
    expect(s[9]).toEqual({ item: 'stone', count: 5 });
    expect(s.reduce((n, x) => n + (x ? x.count : 0), 0)).toBe(before);
    inv.close();
  });

  it('right click takes half and right click places one', () => {
    const root = document.getElementById('ui-root')!;
    const inv = createInventory(root);
    const s = slots36();
    s[0] = { item: 'stone', count: 5 };
    const changes: Array<[number, ItemStack | null]> = [];
    inv.open(s, 0, () => {}, undefined, undefined, 'survival', {
      onSlotChange: (i, st) => {
        changes.push([i, st]);
        s[i] = st;
      },
    });
    const hot0 = root.querySelectorAll('.ui-inv-bar .ui-slot')[0] as HTMLElement;
    const main0 = root.querySelectorAll('.ui-inv-main .ui-slot')[0] as HTMLElement;
    hot0.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    // 游標拿到 ceil(5/2)=3 個，格子留 2 個
    expect(changes[0]).toEqual([0, { item: 'stone', count: 2 }]);
    expect(root.querySelectorAll('.ui-cursor-stack').length).toBe(1);
    main0.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    // 游標剩 2 個（放 1 個進去）
    expect(changes[1]).toEqual([9, { item: 'stone', count: 1 }]);
    expect(
      (root.querySelector('.ui-cursor-stack .count') as HTMLElement).textContent,
    ).toBe('2');
    inv.close();
  });

  it('B7: right-click cursor round-trips never wash a damaged tool', () => {
    // 審查追加（與 R6 同類、超出其列舉清單）：右鍵取一半與右鍵放 1 個都用
    // `{ item, count }` 重建堆疊 → `dur` 掉在游標上，放回格子就被
    // `setSlot` materialize 成滿耐久。工具堆疊上限 1 → 兩個動作都是「整把
    // 搬移」，`dur` 必須跟著走。
    const root = document.getElementById('ui-root')!;
    const inv = createInventory(root);
    const s = slots36();
    s[0] = { item: 'iron_pickaxe', count: 1, dur: 77 };
    const changes: Array<[number, ItemStack | null]> = [];
    inv.open(s, 0, () => {}, undefined, undefined, 'survival', {
      onSlotChange: (i, st) => {
        changes.push([i, st]);
        s[i] = st;
      },
    });
    const hot0 = root.querySelectorAll('.ui-inv-bar .ui-slot')[0] as HTMLElement;
    const main0 = root.querySelectorAll('.ui-inv-main .ui-slot')[0] as HTMLElement;
    // 右鍵取一半：1 → 整把上游標（格子清空）
    hot0.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(changes[0]).toEqual([0, null]);
    // 右鍵放 1 個：落格的那把必須仍是 77，不是滿耐久 250
    main0.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(changes[1]).toEqual([9, { item: 'iron_pickaxe', count: 1, dur: 77 }]);
    inv.close();
  });

  it('B7: taking a damaged tool onto the cursor and placing it keeps its dur', () => {
    const root = document.getElementById('ui-root')!;
    const inv = createInventory(root);
    const s = slots36();
    s[0] = { item: 'stone_pickaxe', count: 1, dur: 40 };
    const changes: Array<[number, ItemStack | null]> = [];
    inv.open(s, 0, () => {}, undefined, undefined, 'survival', {
      onSlotChange: (i, st) => {
        changes.push([i, st]);
        s[i] = st;
      },
    });
    const hot0 = root.querySelectorAll('.ui-inv-bar .ui-slot')[0] as HTMLElement;
    const main0 = root.querySelectorAll('.ui-inv-main .ui-slot')[0] as HTMLElement;
    hot0.click(); // 左鍵整疊拿上游標
    expect(changes[0]).toEqual([0, null]);
    main0.click(); // 左鍵放下
    expect(changes[1]).toEqual([9, { item: 'stone_pickaxe', count: 1, dur: 40 }]);
    inv.close();
  });

  it('closing the panel hands the cursor stack back', () => {
    const root = document.getElementById('ui-root')!;
    const inv = createInventory(root);
    const s = slots36();
    s[0] = { item: 'stone', count: 5 };
    const returned: ItemStack[] = [];
    inv.open(s, 0, () => {}, () => {}, undefined, 'survival', {
      onReturnCursor: (st) => {
        returned.push(st);
        return null; // null ＝ 已全數放回
      },
    });
    (root.querySelectorAll('.ui-inv-bar .ui-slot')[0] as HTMLElement).click(); // 拿起來
    expect(root.querySelectorAll('.ui-cursor-stack').length).toBe(1);
    inv.close();
    expect(returned).toEqual([{ item: 'stone', count: 5 }]);
    expect(root.querySelectorAll('.ui-cursor-stack').length).toBe(0);
  });

  it('a cursor stack that cannot be placed is kept for the next open', () => {
    // 背包滿 → onReturnCursor 回同一疊 → UI 保留游標，下次開面板仍看得到
    const root = document.getElementById('ui-root')!;
    const inv = createInventory(root);
    const s = slots36();
    s[0] = { item: 'stone', count: 5 };
    const keep = (st: ItemStack): ItemStack | null => st;
    inv.open(s, 0, () => {}, () => {}, undefined, 'survival', { onReturnCursor: keep });
    (root.querySelectorAll('.ui-inv-bar .ui-slot')[0] as HTMLElement).click();
    inv.close();
    inv.open(s, 0, () => {}, () => {}, undefined, 'survival', { onReturnCursor: keep });
    const cursor = root.querySelector('.ui-cursor-stack') as HTMLElement;
    expect(cursor).not.toBeNull();
    expect(cursor.getAttribute('title')).toBe(stackName('stone'));
    expect(cursor.querySelector('.count')?.textContent).toBe('5');
    inv.close();
  });

  it('closing the panel never changes the total item count', () => {
    // 游標不吞物品：拿起來 → 關閉歸還 → 總數守恆（沒有消失、沒有複製）。
    // UI 只透過 onSlotChange 回報變動；測試的「擁有者」把它寫回 s（照 main.ts）。
    const root = document.getElementById('ui-root')!;
    const inv = createInventory(root);
    const total = (arr: ReadonlyArray<ItemStack | null>) =>
      arr.reduce((n, st) => n + (st ? st.count : 0), 0);
    const s: Array<ItemStack | null> = new Array(INVENTORY_SLOTS).fill(null);
    s[0] = { item: 'stone', count: 5 };
    const before = total(s);
    inv.open(s, 0, () => {}, () => {}, undefined, 'survival', {
      onSlotChange: (i, st) => {
        s[i] = st;
      },
      onReturnCursor: (st) => {
        s[0] = st; // 模擬 main.ts 的 giveItem：真的把它放回去
        return null; // null ＝ 全數放回
      },
    });
    (root.querySelectorAll('.ui-inv-bar .ui-slot')[0] as HTMLElement).click(); // 拿起 5 個
    expect(total(s)).toBe(before - 5); // 物品在游標上，不在格子上
    inv.close();
    expect(total(s)).toBe(before); // 總數回到原值：沒有消失、沒有複製
  });

  it('a fully returned cursor (null) is gone after reopening (??-mutation guard)', () => {
    // **2026-10-23 整合審查 I-1**：把 close 路徑突變回計畫明文禁止的
    // `const remainder = opts?.onReturnCursor?.(cursor) ?? cursor;`（`null`＝「已
    // 全數放回」被誤判成「沒有回傳」→ 同一疊**同時**在背包與游標上＝複製物品）
    // 時，本測試必須轉紅（重開面板後游標仍持有該疊）。
    const root = document.getElementById('ui-root')!;
    const inv = createInventory(root);
    const s: Array<ItemStack | null> = new Array(INVENTORY_SLOTS).fill(null);
    s[0] = { item: 'stone', count: 5 };
    inv.open(s, 0, () => {}, () => {}, undefined, 'survival', {
      onSlotChange: (i, st) => {
        s[i] = st;
      },
      onReturnCursor: (st) => {
        s[0] = st; // 模擬 main.ts 的 giveItem：真的放回背包
        return null; // null ＝ 已全數放回 → UI 的游標必須清空
      },
    });
    (root.querySelectorAll('.ui-inv-bar .ui-slot')[0] as HTMLElement).click(); // 拿起 5 個
    expect(s[0]).toBeNull(); // 格子清空、物品在游標上
    inv.close(); // onReturnCursor 放回 → 游標清空
    expect(s[0]).toEqual({ item: 'stone', count: 5 }); // 背包拿回全部
    // 重開面板：游標必須是空的（突變版會在這裡看到 .ui-cursor-stack → 紅）。
    inv.open(s, 0, () => {}, () => {}, undefined, 'survival', {
      onSlotChange: (i, st) => {
        s[i] = st;
      },
    });
    expect(root.querySelectorAll('.ui-cursor-stack').length).toBe(0);
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

describe('inventory mode split (B1.2)', () => {
  /** 36 格背包、第 0 格一疊 3× stone（其餘空）——B5 Task 8 的面板輸入形狀。 */
  function survivalStacks(): Array<ItemStack | null> {
    const slots: Array<ItemStack | null> = Array.from({ length: INVENTORY_SLOTS }, () => null);
    slots[0] = { item: 'stone', count: 3 };
    return slots;
  }

  it('survival panel closes cleanly with no click handlers left behind', () => {
    const root = document.getElementById('ui-root')!;
    const inv = createInventory(root);
    const onPick = vi.fn();
    inv.open(survivalStacks(), 0, onPick, undefined, undefined, 'survival');
    expect(root.querySelectorAll('.ui-inv-main .ui-slot').length).toBe(27); // panel mounted
    expect(root.querySelectorAll('.ui-inv-bar .ui-slot').length).toBe(9);
    inv.close();
    expect(inv.isOpen()).toBe(false);
    expect(root.querySelector('.ui-inv-backdrop')).toBeNull();
    expect(root.innerHTML).toBe('');
    // re-opening without a mode still yields the scrollable creative list
    // （清單有 ALL_ITEM_IDS.length 項）— no survival leftovers / stale handlers
    inv.open(DEFAULT_STACKS, 0, onPick);
    expect(root.querySelectorAll('.ui-inv-list .ui-slot').length).toBe(ALL_ITEM_IDS.length);
    inv.close();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('gives each duplicate stack its own icon canvas (shared-icon regression)', async () => {
    // jsdom has no 2d context, so `itemIcon` returns an UNCACHED fresh canvas
    // per call and the shared-node bug stays invisible. Install a no-op 2d
    // context FIRST, then load a FRESH inventory+icons module pair — `icons.ts`
    // memoizes `ctx2dAvailable` (`icons.ts:7,14,18`) and earlier tests in this
    // file already probed it to false, so the real caching path only runs in a
    // fresh module graph.
    const noopCtx = new Proxy({} as Record<string | symbol, unknown>, {
      get(_target, prop) {
        if (prop === 'createImageData' || prop === 'getImageData') {
          // createImageData(w,h) / getImageData(x,y,w,h): caller draws into .data
          return (a: number, b: number, c?: number, d?: number) => ({
            data: new Uint8ClampedArray((c ?? a) * (d ?? b) * 4),
            width: c ?? a,
            height: d ?? b,
          });
        }
        return () => undefined; // every draw/stroke/fill call is a no-op
      },
      set: () => true, // property writes (imageSmoothingEnabled, styles, …)
    });
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: (id: string) => unknown };
    const original = proto.getContext;
    proto.getContext = () => noopCtx;
    try {
      vi.resetModules();
      const { createInventory: freshInventory } = await import('./inventory');
      const root = document.getElementById('ui-root')!;
      const stacks: Array<ItemStack | null> = Array.from({ length: INVENTORY_SLOTS }, () => null);
      stacks[0] = { item: 'dirt', count: 3 }; // two ordinary dirt stacks (mining
      stacks[1] = { item: 'dirt', count: 3 }; // 65 blocks spills 64 + 1) — 熱鍵列前兩格
      const inv = freshInventory(root);
      inv.open(stacks, 0, () => {}, undefined, undefined, 'survival');
      const els = [...root.querySelectorAll<HTMLElement>('.ui-inv-bar .ui-slot')]; // 熱鍵列
      const own = els.map((el) => el.querySelector('canvas'));
      expect(own[0]).not.toBeNull(); // both slots must render an icon
      expect(own[1]).not.toBeNull();
      expect(own[0]).not.toBe(own[1]); // cached node shared → second append moves it
      expect(els[0].contains(own[0]!)).toBe(true);
      expect(els[1].contains(own[1]!)).toBe(true);
      expect(root.querySelectorAll('.ui-inv-bar canvas').length).toBe(2);
      inv.close();
    } finally {
      proto.getContext = original;
      vi.resetModules(); // drop the mocked-graph instance
    }
  });
});

describe('pause menu', () => {
  it('resume invokes callback and can hide menu', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    const onResume = vi.fn(() => menus.hideAll());
    menus.showPause({ onResume, onQuit: () => {}, onToggleMode: () => {}, onToggleShadows: () => {}, onToggleClouds: () => {}, onSaveQuit: () => {}, cloudStatus: 'guest', cloudRetryable: false, onRetryCloud: () => {} });
    expect(root.textContent).toContain('遊戲已暫停');
    btnByText(root, '繼續遊戲').click();
    expect(onResume).toHaveBeenCalled();
    expect(menus.isVisible()).toBe(false);
  });

  it('Escape resumes via the same path as 繼續遊戲', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    const onResume = vi.fn(() => menus.hideAll());
    menus.showPause({ onResume, onQuit: () => {}, onToggleMode: () => {}, onToggleShadows: () => {}, onToggleClouds: () => {}, onSaveQuit: () => {}, cloudStatus: 'guest', cloudRetryable: false, onRetryCloud: () => {} });
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(menus.isVisible()).toBe(false);
  });

  it('Escape handler is removed on hide (no stale resume)', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    const onResume = vi.fn(() => menus.hideAll());
    menus.showPause({ onResume, onQuit: () => {}, onToggleMode: () => {}, onToggleShadows: () => {}, onToggleClouds: () => {}, onSaveQuit: () => {}, cloudStatus: 'guest', cloudRetryable: false, onRetryCloud: () => {} });
    menus.hideAll();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
    expect(onResume).not.toHaveBeenCalled();
  });

  it('non-Escape keys do not resume', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    const onResume = vi.fn(() => menus.hideAll());
    menus.showPause({ onResume, onQuit: () => {}, onToggleMode: () => {}, onToggleShadows: () => {}, onToggleClouds: () => {}, onSaveQuit: () => {}, cloudStatus: 'guest', cloudRetryable: false, onRetryCloud: () => {} });
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w' }));
    expect(onResume).not.toHaveBeenCalled();
    menus.hideAll();
  });

  it('quit invokes callback', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    const onQuit = vi.fn();
    menus.showPause({ onResume: () => {}, onQuit, onToggleMode: () => {}, onToggleShadows: () => {}, onToggleClouds: () => {}, onSaveQuit: () => {}, cloudStatus: 'guest', cloudRetryable: false, onRetryCloud: () => {} });
    btnByText(root, '回到標題').click();
    expect(onQuit).toHaveBeenCalled();
    menus.hideAll();
  });

  it('儲存並離開 invokes onSaveQuit only; 回到標題 stays an unsaved quit (Task 14)', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    const onSaveQuit = vi.fn();
    const onQuit = vi.fn();
    menus.showPause({ onResume: () => {}, onQuit, onToggleMode: () => {}, onToggleShadows: () => {}, onToggleClouds: () => {}, onSaveQuit, cloudStatus: 'guest', cloudRetryable: false, onRetryCloud: () => {} });
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
    menus.showPause({ onResume: () => {}, onQuit: () => {}, onToggleMode, onToggleShadows: () => {}, onToggleClouds: () => {}, onSaveQuit: () => {}, cloudStatus: 'guest', cloudRetryable: false, onRetryCloud: () => {} });
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
    menus.showPause({ onResume, onQuit, onToggleMode, onToggleShadows: () => {}, onToggleClouds: () => {}, onSaveQuit: () => {}, cloudStatus: 'guest', cloudRetryable: false, onRetryCloud: () => {} });
    btnByText(root, '繼續遊戲').click();
    btnByText(root, '回到標題').click();
    btnByText(root, 'Mode: Survival').click();
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onQuit).toHaveBeenCalledTimes(1);
    expect(onToggleMode).toHaveBeenCalledTimes(1);
    menus.hideAll();
  });

  it('shadow toggle shows current state and calls onToggleShadows (Phase 3 Task 5)', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    // realistic wiring: main.ts persists via saveSettings inside the callback
    const onToggleShadows = vi.fn(() => {
      saveSettings({ shadows: !loadSettings().shadows });
    });
    menus.showPause({
      onResume: () => {},
      onQuit: () => {},
      onToggleMode: () => {},
      onToggleShadows,
      onToggleClouds: () => {},
      onSaveQuit: () => {},
      cloudStatus: 'guest',
      cloudRetryable: false,
      onRetryCloud: () => {},
    });
    expect(root.textContent).toContain('陰影：開'); // default is on
    btnByText(root, '陰影：開').click();
    expect(onToggleShadows).toHaveBeenCalledTimes(1);
    // pause re-renders from settings → label flips without reopening the menu
    btnByText(root, '陰影：關').click();
    expect(onToggleShadows).toHaveBeenCalledTimes(2);
    expect(root.textContent).toContain('陰影：開');
    menus.hideAll();
  });

  it('cloud toggle shows current state and calls onToggleClouds (Phase 3 Task 7)', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    // realistic wiring: main.ts persists via saveSettings inside the callback
    const onToggleClouds = vi.fn(() => {
      saveSettings({ clouds: !loadSettings().clouds });
    });
    menus.showPause({
      onResume: () => {},
      onQuit: () => {},
      onToggleMode: () => {},
      onToggleShadows: () => {},
      onToggleClouds,
      onSaveQuit: () => {},
      cloudStatus: 'guest',
      cloudRetryable: false,
      onRetryCloud: () => {},
    });
    expect(root.textContent).toContain('雲：開'); // default is on
    btnByText(root, '雲：開').click();
    expect(onToggleClouds).toHaveBeenCalledTimes(1);
    // pause re-renders from settings → label flips without reopening the menu
    btnByText(root, '雲：關').click();
    expect(onToggleClouds).toHaveBeenCalledTimes(2);
    expect(root.textContent).toContain('雲：開');
    menus.hideAll();
  });

  it('settings sliders persist via saveSettings on change only', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    menus.showPause({
      onResume: () => {},
      onQuit: () => {},
      onToggleMode: () => {},
      onToggleShadows: () => {},
      onToggleClouds: () => {},
      onSaveQuit: () => {},
      cloudStatus: 'guest',
      cloudRetryable: false,
      onRetryCloud: () => {},
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

  it('the pause menu lists the new control hints', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    menus.showPause({ onResume: () => {}, onQuit: () => {}, onToggleMode: () => {}, onToggleShadows: () => {}, onToggleClouds: () => {}, onSaveQuit: () => {}, cloudStatus: 'guest', cloudRetryable: false, onRetryCloud: () => {} });
    const hint = root.querySelector('.ui-hint');
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toContain('雙擊 W');
    expect(hint!.textContent).toContain('Ctrl+Q');
    expect(hint!.textContent).toContain('F5');
    expect(hint!.textContent).toContain('右鍵');
    menus.hideAll();
  });

  it('the hint mentions that ctrl may be swallowed by the browser', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    menus.showPause({ onResume: () => {}, onQuit: () => {}, onToggleMode: () => {}, onToggleShadows: () => {}, onToggleClouds: () => {}, onSaveQuit: () => {}, cloudStatus: 'guest', cloudRetryable: false, onRetryCloud: () => {} });
    const hint = root.querySelector('.ui-hint');
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toContain('Ctrl+W');
    expect(hint!.textContent).toContain('瀏覽器保留鍵');
    menus.hideAll();
  });

  it('the hint text is locked to the brief copy, word for word', () => {
    // 整句等於 brief 文案（逐字鎖定；文案本身是玩家會看到的內容，不可更動）
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    menus.showPause({ onResume: () => {}, onQuit: () => {}, onToggleMode: () => {}, onToggleShadows: () => {}, onToggleClouds: () => {}, onSaveQuit: () => {}, cloudStatus: 'guest', cloudRetryable: false, onRetryCloud: () => {} });
    const hint = root.querySelector('.ui-hint');
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toBe(
      '操作：雙擊 W 疾跑（Ctrl 也能疾跑，但 Ctrl+W 是瀏覽器保留鍵，可能被瀏覽器吃掉）｜Q 丟棄 1 個、Ctrl+Q 丟整疊｜右鍵長按連續放置｜F5 切換第一人稱／面後／面前視角',
    );
    menus.hideAll();
  });

  it('the hint sits after the buttons and before the cloud row', () => {
    // DOM 位置契約：操作提示在**按鈕群之後、雲端狀態列之前**
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    menus.showPause({ onResume: () => {}, onQuit: () => {}, onToggleMode: () => {}, onToggleShadows: () => {}, onToggleClouds: () => {}, onSaveQuit: () => {}, cloudStatus: 'ready', cloudRetryable: false, onRetryCloud: () => {} });
    const overlay = root.querySelector('.ui-overlay')!;
    const children = [...overlay.children];
    const hintIndex = children.findIndex((c) => c.classList.contains('ui-hint'));
    const cloudIndex = children.findIndex((c) => c.classList.contains('ui-cloud-row'));
    const lastButtonIndex = children.reduce(
      (acc, child, i) => (child instanceof HTMLButtonElement ? i : acc),
      -1,
    );
    expect(hintIndex).toBeGreaterThan(-1);
    expect(cloudIndex).toBeGreaterThan(-1);
    expect(hintIndex).toBeGreaterThan(lastButtonIndex); // 在按鈕群之後
    expect(hintIndex).toBeLessThan(cloudIndex); // 在雲端列之前
    menus.hideAll();
  });
});

describe('pause cloud row (Phase 4 Task 4)', () => {
  const cloudBase = {
    onResume: () => {},
    onQuit: () => {},
    onToggleMode: () => {},
    onToggleShadows: () => {},
    onToggleClouds: () => {},
    onSaveQuit: () => {},
  };

  function showCloud(status: CloudStatus, retryable: boolean, onRetry: () => void = () => {}): HTMLElement {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    menus.showPause({ ...cloudBase, cloudStatus: status, cloudRetryable: retryable, onRetryCloud: onRetry });
    return root;
  }

  function retryButtons(root: HTMLElement): HTMLButtonElement[] {
    return [...root.querySelectorAll('button')].filter((b) => b.textContent === '重試');
  }

  const rowCases: Array<[CloudStatus, boolean, string]> = [
    ['guest', false, '雲端：訪客本機遊玩'],
    ['unsupported', false, '雲端：不支援'],
    ['ready', false, '雲端：已同步'],
    ['syncing', true, '雲端：尚未同步'],
    ['error', true, '雲端：同步失敗（重試）'],
    ['error', false, '雲端：同步失敗'],
    ['conflict', true, '雲端：有新進度'],
    ['format', false, '雲端：格式不相容'],
  ];
  it.each(rowCases)(
    'renders %s (retryable=%s) as %s',
    (status, retryable, text) => {
      const root = showCloud(status, retryable);
      expect(root.textContent).toContain(text);
      if (status === 'error' && !retryable) {
        expect(root.textContent).not.toContain('（重試）');
      }
    },
  );

  it('guest row is gray and silent (no toast path, no retry button)', () => {
    const root = showCloud('guest', false);
    const line = root.querySelector('.ui-cloud-guest');
    expect(line).not.toBeNull();
    expect(line!.textContent).toBe('雲端：訪客本機遊玩');
    expect(retryButtons(root).length).toBe(0);
  });

  it('重試 button appears only in retryable states, and click fires onRetryCloud', () => {
    // retryable: NETWORK-kind error + applied conflict + an unconfirmed save
    for (const status of ['error', 'conflict', 'syncing'] as CloudStatus[]) {
      document.getElementById('ui-root')!.innerHTML = '';
      const onRetry = vi.fn();
      const root = showCloud(status, true, onRetry);
      const buttons = retryButtons(root);
      expect(buttons.length).toBe(1);
      buttons[0].click();
      expect(onRetry).toHaveBeenCalledTimes(1);
    }
    // locked error, format, guest, unsupported, ready: no button
    for (const [status, retryable] of [
      ['error', false],
      ['format', false],
      ['guest', false],
      ['unsupported', false],
      ['ready', false],
      ['syncing', false],
    ] as Array<[CloudStatus, boolean]>) {
      document.getElementById('ui-root')!.innerHTML = '';
      const root = showCloud(status, retryable);
      expect(retryButtons(root).length).toBe(0);
    }
  });

  it('cloud row is the last line of the pause menu', () => {
    const root = showCloud('ready', false);
    const overlay = root.querySelector('.ui-overlay')!;
    expect(overlay.lastElementChild?.className).toContain('ui-cloud-row');
  });
});

describe('durability bar mounts (B7 Task 6)', () => {
  it('the hotbar shows a durability bar for a damaged tool', () => {
    const root = document.getElementById('ui-root')!;
    const hud = createHud(root);
    hud.setHotbar([{ item: 'iron_pickaxe', count: 1, dur: 125 }], 0);
    const fill = root.querySelector('.ui-dur-fill') as HTMLElement;
    expect(fill.style.width).toBe('50%');
    hud.dispose();
  });

  it('the hotbar re-renders when only the durability changes', () => {
    // `sameStack` 納入 `dur` 的證據：item/count 不變、只有 dur 變 → 必須重繪
    const root = document.getElementById('ui-root')!;
    const hud = createHud(root);
    const list: Array<ItemStack | null> = [{ item: 'iron_pickaxe', count: 1, dur: 200 }];
    hud.setHotbar(list, 0);
    const before = (root.querySelector('.ui-dur-fill') as HTMLElement).style.width;
    list[0] = { item: 'iron_pickaxe', count: 1, dur: 100 }; // 同一個 item/count，dur 不同
    hud.setHotbar(list, 0);
    const after = (root.querySelector('.ui-dur-fill') as HTMLElement).style.width;
    expect(after).not.toBe(before);
    expect(after).toBe('40%');
    hud.dispose();
  });

  it('the inventory panel shows a durability bar for a damaged tool', () => {
    const root = document.getElementById('ui-root')!;
    const inv = createInventory(root);
    const s = slots36();
    s[0] = { item: 'iron_pickaxe', count: 1, dur: 125 }; // 熱鍵列第 0 格：受損鐵鎬
    inv.open(s, 0, () => {}, undefined, undefined, 'survival');
    const fill = root.querySelector('.ui-inv-bar .ui-dur-fill') as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.width).toBe('50%');
    inv.close();
  });
});

// ---- B7 Task 17：下緣 HUD 帶狀的靜態幾何 --------------------------------------
// 審查 B7：hotbar `bottom:8px`（48px 格 ＋ padding 3×2 ＋ border 2×2 → 頂緣
// **66px**），vitals `bottom:52px` → 重疊熱鍵列上緣。jsdom 不算版面，但
// `css: true`（vite.config.ts）會把 `ui.css` 注入成真實的 <style> → 直接讀
// `document.styleSheets` 的規則值，把整條帶狀的**相對順序**釘住（不得互相重疊）。

/** 掃描所有樣式表裡 selectorText 恰好等於 `selector` 的宣告。 */
function ruleStyles(selector: string): CSSStyleDeclaration[] {
  const found: CSSStyleDeclaration[] = [];
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // 防禦：跨源樣式表（本測試不會有）
    }
    for (const rule of [...rules]) {
      if (rule instanceof CSSStyleRule && rule.selectorText === selector) found.push(rule.style);
    }
  }
  return found;
}

/** 取選擇器規則裡的 `bottom`（px）。找不到規則／沒有 bottom → null。 */
function ruleBottom(selector: string): number | null {
  const styles = ruleStyles(selector);
  if (styles.length === 0) return null;
  const v = styles[0].getPropertyValue('bottom');
  return v ? Number.parseFloat(v) : null;
}

describe('bottom HUD band geometry (B7 Task 17)', () => {
  it('the vitals row sits above the hotbar without overlapping', () => {
    // 熱鍵欄頂緣＝8（bottom）＋48（格）＋6（padding 3×2）＋4（border 2×2）＝66px。
    expect(ruleBottom('.ui-hotbar')).toBe(8);
    const vitals = ruleBottom('.vitals');
    expect(vitals).not.toBeNull();
    expect(vitals!).toBeGreaterThanOrEqual(68); // ≥ 66 ＋ 2px 餘裕
  });

  it('the whole bottom band stacks without overlaps (item name, progress, hint)', () => {
    const vitals = ruleBottom('.vitals')!;
    const itemName = ruleBottom('.ui-item-name')!;
    const eat = ruleBottom('.eat-progress')!;
    const hint = ruleBottom('.ui-sprint-hint')!;
    // vitals 的 16px 圖示 → 頂緣 vitals+16；物品名必須整個在上面。
    expect(itemName).toBeGreaterThan(vitals + 16);
    // 物品名 16px 字級的單行高約 19px；進度條（8px ＋ 2px×2 邊框）在上面。
    expect(eat).toBeGreaterThan(itemName + 19);
    // 疾跑提示在最上面（進度條頂緣 ≈ eat+12）。
    expect(hint).toBeGreaterThan(eat + 12);
  });

  it('the sprint overlay CSS never applies to the pause-menu hint class', () => {
    // 這條釘住 B5 遺留的 class 碰撞：疾跑提示原本也叫 `.ui-hint`（＝暫停選單
    // 操作提示行的 class）→ 樣式表後面的 `position: fixed; opacity: 0` cascade
    // 到選單那一行，整行變透明。兩個提示必須是兩個 class。
    const pauseHint = ruleStyles('.ui-hint');
    expect(pauseHint.length).toBeGreaterThan(0); // 暫停選單的規則還在
    for (const s of pauseHint) {
      expect(s.getPropertyValue('position')).not.toBe('fixed');
      expect(s.getPropertyValue('opacity')).not.toBe('0');
    }
    // 疾跑提示自己的規則：固定在畫面下緣的浮層。
    expect(
      ruleStyles('.ui-sprint-hint').some((s) => s.getPropertyValue('position') === 'fixed'),
    ).toBe(true);
  });
});

// ---- B9 Task 18：「回到標題」的二次確認 ----------------------------------------
// 審查 B9：暫停選單的「回到標題」**不存檔**，而且和「儲存並離開」並排 → 誤按
// 就丟掉最多一個 autosave 間隔（30 秒）的進度。修法：離開前跳確認框（沿用
// `menus.showConfirm`）——確定才真的離開；取消（按鈕或 Esc）不離開。
describe('回到標題 asks for confirmation before quitting (B9 Task 18)', () => {
  /** 掛一個暫停選單；「回到標題」走 B9 的確認流程（onQuit 由呼叫端決定）。 */
  const showPauseWithConfirm = (
    root: HTMLElement,
    menus: ReturnType<typeof createMenus>,
    quit: () => void,
    cancel: () => void,
  ): void => {
    menus.showPause({
      onResume: () => {},
      onQuit: () => confirmQuitToTitle(menus, quit, cancel),
      onToggleMode: () => {},
      onToggleShadows: () => {},
      onToggleClouds: () => {},
      onSaveQuit: () => {},
      cloudStatus: 'guest',
      cloudRetryable: false,
      onRetryCloud: () => {},
    });
    void root;
  };

  it('the quit button asks first; only 確定 leaves the session', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    const quit = vi.fn();
    const cancel = vi.fn();
    showPauseWithConfirm(root, menus, quit, cancel);
    btnByText(root, '回到標題').click();
    // 確認框出現了，**還沒**離開。
    const msg = root.querySelector('.ui-confirm-msg');
    expect(msg).not.toBeNull();
    expect(msg!.textContent).toBe('回到標題不會儲存進度。確定要離開嗎？');
    expect(quit).not.toHaveBeenCalled();
    btnByText(root, '確定').click();
    expect(quit).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    menus.hideAll();
  });

  it('取消 keeps the session alive', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    const quit = vi.fn();
    const cancel = vi.fn();
    showPauseWithConfirm(root, menus, quit, cancel);
    btnByText(root, '回到標題').click();
    btnByText(root, '取消').click();
    expect(quit).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    menus.hideAll();
  });

  it('Esc cancels the confirmation (never quits)', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    const quit = vi.fn();
    const cancel = vi.fn();
    showPauseWithConfirm(root, menus, quit, cancel);
    btnByText(root, '回到標題').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
    expect(quit).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    menus.hideAll();
  });
});
