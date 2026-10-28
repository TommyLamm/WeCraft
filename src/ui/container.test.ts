import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createContainer } from './container';
import type { ItemStack } from '../core/items';

const chestSlots = (n = 27): Array<ItemStack | null> => new Array<ItemStack | null>(n).fill(null);
const playerSlots = (): Array<ItemStack | null> => new Array<ItemStack | null>(36).fill(null);
const total = (arr: ReadonlyArray<ItemStack | null>): number =>
  arr.reduce((n, s) => n + (s ? s.count : 0), 0);

let root: HTMLElement;
let container: ReturnType<typeof createContainer>;

beforeEach(() => {
  document.getElementById('ui-root')?.remove();
  root = document.createElement('div');
  root.id = 'ui-root';
  document.body.appendChild(root);
  container = createContainer(root);
});

afterEach(() => {
  container.close();
  root.remove();
});

describe('container panel', () => {
  it('the container panel shows 27 chest slots and the 36 player slots', () => {
    container.open({
      title: '箱子',
      container: chestSlots(),
      inventory: playerSlots(),
      onContainerChange: vi.fn(),
      onInventoryChange: vi.fn(),
    });
    expect(root.querySelectorAll('.ui-container-grid .ui-slot')).toHaveLength(27);
    expect(root.querySelectorAll('.ui-inv-main .ui-slot')).toHaveLength(27);
    expect(root.querySelectorAll('.ui-inv-bar .ui-slot')).toHaveLength(9);
    expect(root.querySelector('.ui-container')?.textContent).toContain('箱子');
  });

  it('left click moves a stack from the chest onto the cursor and the next click puts it in the player inventory', () => {
    const chest = chestSlots();
    chest[0] = { item: 'stone', count: 5 };
    const player = playerSlots();
    const onContainerChange = vi.fn();
    const onInventoryChange = vi.fn();
    container.open({ title: '箱子', container: chest, inventory: player, onContainerChange, onInventoryChange });
    (root.querySelectorAll('.ui-container-grid .ui-slot')[0] as HTMLElement).click();
    expect(onContainerChange).toHaveBeenCalledWith(0, null);
    expect(root.querySelectorAll('.ui-cursor-stack')).toHaveLength(1);
    (root.querySelectorAll('.ui-inv-main .ui-slot')[0] as HTMLElement).click();
    // 主背包第 0 格 ＝ 36 格背包的全域索引 9（前 9 格是熱鍵列）
    expect(onInventoryChange).toHaveBeenCalledWith(9, { item: 'stone', count: 5 });
    expect(root.querySelectorAll('.ui-cursor-stack')).toHaveLength(0);
  });

  it('right click takes half of a stack', () => {
    const chest = chestSlots();
    chest[0] = { item: 'stone', count: 5 };
    const onContainerChange = vi.fn();
    container.open({
      title: '箱子',
      container: chest,
      inventory: playerSlots(),
      onContainerChange,
      onInventoryChange: vi.fn(),
    });
    (root.querySelectorAll('.ui-container-grid .ui-slot')[0] as HTMLElement).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    expect(onContainerChange).toHaveBeenCalledWith(0, { item: 'stone', count: 2 });
    expect(root.querySelector('.ui-cursor-stack')?.textContent).toContain('3');
  });

  it('closing the panel hands the cursor stack back to the owner', () => {
    const chest = chestSlots();
    chest[0] = { item: 'stone', count: 5 };
    const returned: ItemStack[] = [];
    container.open({
      title: '箱子',
      container: chest,
      inventory: playerSlots(),
      onContainerChange: vi.fn(),
      onInventoryChange: vi.fn(),
      onReturnCursor: (st) => {
        returned.push(st);
        return null;
      },
    });
    (root.querySelectorAll('.ui-container-grid .ui-slot')[0] as HTMLElement).click();
    container.close();
    expect(returned).toEqual([{ item: 'stone', count: 5 }]);
  });

  it('a fully returned cursor stack is cleared instead of being duplicated', () => {
    const chest = chestSlots();
    chest[0] = { item: 'stone', count: 5 };
    const returned: ItemStack[] = [];
    const params = {
      title: '箱子',
      container: chest,
      inventory: playerSlots(),
      onContainerChange: vi.fn(),
      onInventoryChange: vi.fn(),
      onReturnCursor: (st: ItemStack): null => {
        returned.push(st);
        return null;
      },
    };
    container.open(params);
    (root.querySelectorAll('.ui-container-grid .ui-slot')[0] as HTMLElement).click();
    expect(root.querySelectorAll('.ui-cursor-stack')).toHaveLength(1);
    container.close();
    expect(returned).toEqual([{ item: 'stone', count: 5 }]);
    expect(root.querySelectorAll('.ui-cursor-stack')).toHaveLength(0); // 游標清空（不得還留著）
    container.open(params); // 再開一次：不得又歸還一次
    expect(root.querySelectorAll('.ui-cursor-stack')).toHaveLength(0);
    expect(returned).toHaveLength(1); // 總共只歸還過一次
  });

  it('a cursor stack that cannot be placed is kept for the next open', () => {
    const chest = chestSlots();
    chest[0] = { item: 'stone', count: 5 };
    const params = {
      title: '箱子',
      container: chest,
      inventory: playerSlots(),
      onContainerChange: vi.fn(),
      onInventoryChange: vi.fn(),
      onReturnCursor: (st: ItemStack): ItemStack => st, // 放不下 → 原樣退回
    };
    container.open(params);
    (root.querySelectorAll('.ui-container-grid .ui-slot')[0] as HTMLElement).click();
    container.close();
    container.open(params);
    expect(root.querySelectorAll('.ui-cursor-stack')).toHaveLength(1);
  });

  it('a missing return callback keeps the cursor stack for the next open', () => {
    const chest = chestSlots();
    chest[0] = { item: 'stone', count: 5 };
    const params = {
      title: '箱子',
      container: chest,
      inventory: playerSlots(),
      onContainerChange: vi.fn(),
      onInventoryChange: vi.fn(),
    };
    container.open(params); // 不給 onReturnCursor
    (root.querySelectorAll('.ui-container-grid .ui-slot')[0] as HTMLElement).click();
    container.close();
    container.open(params);
    expect(root.querySelectorAll('.ui-cursor-stack')).toHaveLength(1);
  });

  it('the panel never changes the total item count', () => {
    const chest = chestSlots();
    chest[0] = { item: 'stone', count: 5 };
    const player = playerSlots();
    const returned: ItemStack[] = [];
    const before = total(chest) + total(player);
    container.open({
      title: '箱子',
      container: chest,
      inventory: player,
      onContainerChange: (i, s) => {
        chest[i] = s;
      },
      onInventoryChange: (i, s) => {
        player[i] = s;
      },
      onReturnCursor: (st) => {
        returned.push(st);
        return null;
      },
    });
    (root.querySelectorAll('.ui-container-grid .ui-slot')[0] as HTMLElement).click();
    expect(total(chest) + total(player)).toBe(before - 5); // 物品離開格子、在游標上（還沒回來）
    container.close();
    // 歸還後總數回到原值：沒有消失、沒有複製
    expect(total(chest) + total(player) + total(returned)).toBe(before);
  });

  it('Escape closes the panel and fires onClose once', () => {
    const onClose = vi.fn();
    container.open({
      title: '箱子',
      container: chestSlots(),
      inventory: playerSlots(),
      onContainerChange: vi.fn(),
      onInventoryChange: vi.fn(),
      onClose,
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(root.querySelectorAll('.ui-container').length).toBe(0);
  });
});
