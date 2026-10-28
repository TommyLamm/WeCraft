// A4 — session 邊界的 UI 擁有狀態（合成格／游標）不得跨場次。
//
// 審查 A4 的三個重現：
//   ① 舞台化材料 → 關背包 → Esc → 回到標題（不存檔）→ 繼續遊戲 → 再開背包
//      → `resetCraftGrid(2)` 把舊舞台材料灌進「已還原的背包」＝ **複製**；
//   ② 背包滿時游標餘量留在 UI closure → 新局後開背包 ＝ **複製**；
//   ③ 面板開著時 autosave → 舞台材料**遺失**（存檔刻意跳過沖刷）。
//
// 修法（不升 payload 版本）：UI 狀態在**每個 session 邊界**清空／安全 drain，
// 而且存檔路徑**無條件**沖刷舞台材料。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInventory } from './inventory';
import { createCrafting, mountCrafting, type CraftingParams } from './crafting';
import { flushCraftGrid, type CraftGridState } from './session-boundary';
import { emptyGrid } from '../core/recipes';
import { INVENTORY_SLOTS, type ItemId, type ItemStack } from '../core/items';
import { createInventoryModel } from '../core/inventory';
import { createModeStash } from '../core/mode-stash';
import { emptyAdvancements } from '../core/advancements';
import { sanitizeSlots } from '../core/items';
import { collectSavePayload } from '../world/save';

beforeEach(() => {
  document.getElementById('ui-root')?.remove();
  const root = document.createElement('div');
  root.id = 'ui-root';
  document.body.appendChild(root);
});

const root = (): HTMLElement => document.getElementById('ui-root')!;

/** 36 格全滿的生存背包（每格 64 個 stone）。 */
function fullInventory(): Array<ItemStack | null> {
  return Array.from({ length: INVENTORY_SLOTS }, () => ({ item: 'stone' as ItemId, count: 64 }));
}

/** 某個物品在這組槽位裡的總數。 */
function countOf(slots: ReadonlyArray<ItemStack | null>, item: ItemId): number {
  return slots.reduce((n, s) => (s && s.item === item ? n + s.count : n), 0);
}

/** 背包模型的 `giveItem`（與 main.ts 的接線同義）。 */
const giveTo = (inv: ReturnType<typeof createInventoryModel>) => (
  item: ItemId,
  count: number,
  dur?: number,
): number => inv.addItem(item, count, dur);

describe('A4：舞台化的材料在存檔／讀檔之間恰好出現一次', () => {
  it('a full inventory with staged materials survives Save&Quit and Continue exactly once', () => {
    // 滿背包 → 舞台化 2 個 stone（背包因此空出 2 格）→ Save&Quit → Continue。
    const inv = createInventoryModel(fullInventory(), 'survival');
    const slots = inv.slots as Array<ItemStack | null>;
    const total = countOf(slots, 'stone');
    expect(total).toBe(INVENTORY_SLOTS * 64);

    // 舞台化：材料離開背包，只活在合成格裡。
    expect(inv.removeItem('stone', 2)).toBe(2);
    const grid = emptyGrid(2);
    grid[0] = { item: 'stone', count: 2 };
    const state: CraftGridState = { grid, excess: [] };

    // Save&Quit：存檔路徑**無條件**先把舞台材料沖刷回背包，再快照。
    flushCraftGrid(state, 2, { giveItem: giveTo(inv) });
    expect(countOf(slots, 'stone')).toBe(total); // 沖刷後物品總量回到原值

    const payload = collectSavePayload({
      world: { seed: 1, serializeModified: () => [] },
      player: { pos: [0, 64, 0], yaw: 0, mode: 'survival', inventory: [...slots] },
      vitals: null,
      clockT: 0,
      advancements: emptyAdvancements(),
      stash: createModeStash(),
      passiveMobs: [],
      blockEntities: [],
    });

    // Continue：還原出來的背包必須有**恰好一份**那些材料（不是兩份）。
    const restored = sanitizeSlots(payload.player.inventory, INVENTORY_SLOTS);
    expect(countOf(restored, 'stone')).toBe(total);
    // 合成格是空的 → 下一次開背包不會再沖刷一次（否則就是複製）。
    expect(grid.every((c) => c === null)).toBe(true);
    expect(state.excess).toHaveLength(0);
  });

  it('a save taken while the panel is open still carries the staged materials', () => {
    // ③ 的回歸：面板開著時的存檔**不得**漏掉舞台材料（舊碼在面板開著時
    // 刻意跳過沖刷 → 材料只活在 UI 裡 → 掉料）。
    const inv = createInventoryModel(fullInventory(), 'survival');
    const slots = inv.slots as Array<ItemStack | null>;
    const total = countOf(slots, 'stone');
    inv.removeItem('stone', 2);
    const grid = emptyGrid(2);
    grid[0] = { item: 'stone', count: 2 };
    flushCraftGrid({ grid, excess: [] }, 2, { giveItem: giveTo(inv) });
    const payload = collectSavePayload({
      world: { seed: 1, serializeModified: () => [] },
      player: { pos: [0, 64, 0], yaw: 0, mode: 'survival', inventory: [...slots] },
      vitals: null,
      clockT: 0,
      advancements: emptyAdvancements(),
      stash: createModeStash(),
      passiveMobs: [],
      blockEntities: [],
    });
    expect(countOf(payload.player.inventory, 'stone')).toBe(total);
  });

  it('the flush hands the overflow to the sink instead of re-staging it', () => {
    // 背包滿到連舞台材料都放不回去時，那些材料**不得**被重新停在合成格裡
    // （重新停放＝下一場次的背包會多出它們＝複製）→ 交給 sink（地面掉落）。
    const inv = createInventoryModel(fullInventory(), 'survival');
    // 舞台化一格 stone（背包空出一格）→ 再把那格填滿 → 沖刷時無處可去。
    inv.removeItem('stone', 64);
    const grid = emptyGrid(2);
    grid[0] = { item: 'stone', count: 64 };
    expect(inv.addItem('dirt', 64)).toBe(0); // 空出來的那格被填滿了
    const dropped: ItemStack[] = [];
    flushCraftGrid({ grid, excess: [] }, 2, {
      giveItem: giveTo(inv),
      dropOverflow: (s) => dropped.push(s),
    });
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ item: 'stone', count: 64 });
    expect(grid.every((c) => c === null)).toBe(true);
  });
});

describe('A4：游標餘量不得跨 session 邊界', () => {
  it('a new game never leaks the previous cursor stack', () => {
    const inv = createInventory(root());
    const slots = fullInventory();
    const returned: ItemStack[] = [];
    const opts = {
      onSlotChange: (index: number, stack: ItemStack | null) => {
        slots[index] = stack;
      },
      // 背包滿 → 放不下 → 餘量留在游標上（main.ts 的行為）。
      onReturnCursor: (stack: ItemStack) => {
        returned.push(stack);
        return stack;
      },
    };
    inv.open(slots, 0, () => {}, () => {}, undefined, 'survival', opts);
    // 玩家把一疊物品拿到游標上。
    const slotEl = root().querySelector('.ui-inv-main .ui-slot') as HTMLElement;
    slotEl.click();
    expect(root().querySelector('.ui-cursor-stack')).not.toBeNull();
    // 關面板 → 交還擁有者 → 背包滿 → 餘量留在游標 closure 裡。
    inv.close();
    expect(returned).toHaveLength(1);
    expect(root().querySelector('.ui-cursor-stack')).toBeNull(); // 面板收掉了

    // session 邊界（new game／continue／applyCloudData／quitToTitle）→ drain。
    const leftover = inv.returnCursor();
    expect(leftover).not.toBeNull();
    expect(leftover?.item).toBe('stone');

    // 新局再開背包 → 游標是空的（舊局的餘量沒有洩漏進來）。
    inv.open(slots, 0, () => {}, () => {}, undefined, 'survival', opts);
    expect(root().querySelector('.ui-cursor-stack')).toBeNull();
    inv.close();
  });

  it('returnCursor is idempotent (a second drain yields nothing)', () => {
    const inv = createInventory(root());
    const slots = fullInventory();
    inv.open(slots, 0, () => {}, () => {}, undefined, 'survival', {
      onSlotChange: (index: number, stack: ItemStack | null) => {
        slots[index] = stack;
      },
      onReturnCursor: (stack: ItemStack) => stack,
    });
    (root().querySelector('.ui-inv-main .ui-slot') as HTMLElement).click();
    inv.close();
    expect(inv.returnCursor()).not.toBeNull();
    expect(inv.returnCursor()).toBeNull();
  });
});

describe('A4：合成格必須原地清空（開著的面板仍持有同一個陣列）', () => {
  const params = (grid: Array<ItemStack | null>): CraftingParams => ({
    size: 2,
    grid,
    slots: Array.from({ length: INVENTORY_SLOTS }, () => null),
    selected: 0,
    onSpend: vi.fn(() => true),
    onGiveBack: vi.fn(() => 0),
    onTake: vi.fn(() => true),
  });

  it('resetCraftGrid while the panel is open empties the SAME array the UI holds', () => {
    const grid = emptyGrid(2);
    const section = mountCrafting(root(), params(grid));
    grid[0] = { item: 'stone', count: 2 };
    section.refresh();
    const cell = (i: number): HTMLElement =>
      root().querySelector(`[data-cell="${i}"]`) as HTMLElement;
    expect(cell(0).title).toBe('Stone');

    const sameArray = grid;
    flushCraftGrid({ grid, excess: [] }, 2, { giveItem: () => 0 });
    // **同一個**陣列（不是換一個新的）→ 面板仍寫得到它。
    expect(grid).toBe(sameArray);
    expect(grid.every((c) => c === null)).toBe(true);

    // 面板重繪後看到的也是空的格子（不是舊的舞台材料）。
    section.refresh();
    expect(cell(0).title).toBe('');
    section.unmount();
  });

  it('the inventory panel re-renders its crafting section after an in-place flush', () => {
    const inv = createInventory(root());
    const grid = emptyGrid(2);
    const slots: Array<ItemStack | null> = Array.from(
      { length: INVENTORY_SLOTS },
      () => null,
    );
    inv.open(slots, 0, () => {}, () => {}, params(grid), 'survival', {
      onSlotChange: (index: number, stack: ItemStack | null) => {
        slots[index] = stack;
      },
    });
    grid[0] = { item: 'stone', count: 2 };
    const cell = (): HTMLElement =>
      root().querySelector('[data-cell="0"]') as HTMLElement;
    inv.refreshCrafting(); // 面板重繪 → 看得到舞台的材料
    expect(cell().title).toBe('Stone');

    flushCraftGrid({ grid, excess: [] }, 2, { giveItem: () => 0 });
    inv.refreshCrafting();
    expect(cell().title).toBe('');
    inv.close();
  });

  it('the standalone 3×3 overlay re-renders after an in-place flush', () => {
    const craftUi = createCrafting(root());
    const grid = emptyGrid(3);
    craftUi.open({ ...params(grid), size: 3 });
    grid[0] = { item: 'stone', count: 2 };
    const cell = (): HTMLElement =>
      root().querySelector('[data-cell="0"]') as HTMLElement;
    craftUi.refresh();
    expect(cell().title).toBe('Stone');

    flushCraftGrid({ grid, excess: [] }, 3, { giveItem: () => 0 });
    craftUi.refresh();
    expect(cell().title).toBe('');
    craftUi.close();
  });
});
