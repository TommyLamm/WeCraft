import { describe, it, expect } from 'vitest';
import { createInventoryModel } from './inventory';
import type { ItemStack } from './items';

const empty = (n: number): Array<ItemStack | null> => new Array(n).fill(null);

describe('inventory model — add', () => {
  it('addItem merges into an existing partial stack', () => {
    const inv = createInventoryModel(empty(3), 'survival');
    expect(inv.addItem('dirt', 10)).toBe(0);
    expect(inv.addItem('dirt', 5)).toBe(0);
    expect(inv.slots[0]).toEqual({ item: 'dirt', count: 15 });
    expect(inv.slots[1]).toBeNull(); // merged, no new slot opened
    expect(inv.countItem('dirt')).toBe(15);
  });

  it('addItem tops up partial stacks before opening a new slot', () => {
    const inv = createInventoryModel([{ item: 'dirt', count: 60 }, null, null], 'survival');
    expect(inv.addItem('dirt', 10)).toBe(0);
    expect(inv.slots[0]).toEqual({ item: 'dirt', count: 64 });
    expect(inv.slots[1]).toEqual({ item: 'dirt', count: 6 });
    expect(inv.slots[2]).toBeNull();
  });

  it('addItem splits stacks exceeding maxStack into a new slot', () => {
    const inv = createInventoryModel(empty(3), 'survival');
    expect(inv.addItem('grass', 70)).toBe(0);
    expect(inv.slots[0]).toEqual({ item: 'grass', count: 64 });
    expect(inv.slots[1]).toEqual({ item: 'grass', count: 6 });
    expect(inv.slots[2]).toBeNull();
  });

  it('addItem clamps every stack to maxStack', () => {
    const inv = createInventoryModel(empty(3), 'survival');
    inv.addItem('grass', 200); // 64+64+64 fits, 8 overflow
    expect(inv.slots.map((s) => s?.count)).toEqual([64, 64, 64]);
    expect(inv.addItem('grass', 8)).toBe(8);
  });

  it('addItem never merges tools (maxStack 1): one slot each', () => {
    const inv = createInventoryModel(empty(3), 'survival');
    expect(inv.addItem('wooden_pickaxe', 3)).toBe(0);
    expect(inv.slots).toEqual([
      { item: 'wooden_pickaxe', count: 1 },
      { item: 'wooden_pickaxe', count: 1 },
      { item: 'wooden_pickaxe', count: 1 },
    ]);
    expect(inv.addItem('wooden_pickaxe', 1)).toBe(1); // no room left
  });

  it('addItem returns overflow when the inventory is full', () => {
    const inv = createInventoryModel(
      [{ item: 'dirt', count: 64 }, { item: 'stone', count: 10 }],
      'survival',
    );
    expect(inv.addItem('dirt', 5)).toBe(5); // dirt stack full, stone slot not reusable
    expect(inv.countItem('dirt')).toBe(64);
    expect(inv.slots[1]).toEqual({ item: 'stone', count: 10 });
  });

  it('addItem with zero or negative count is a no-op returning 0', () => {
    const inv = createInventoryModel(empty(2), 'survival');
    expect(inv.addItem('dirt', 0)).toBe(0);
    expect(inv.addItem('dirt', -3)).toBe(0);
    expect(inv.slots).toEqual([null, null]);
  });
});

describe('inventory model — remove / count', () => {
  it('removeItem decrements across slots and returns the removed count', () => {
    const inv = createInventoryModel(
      [{ item: 'dirt', count: 64 }, { item: 'dirt', count: 5 }],
      'survival',
    );
    expect(inv.removeItem('dirt', 7)).toBe(7);
    expect(inv.slots[0]).toEqual({ item: 'dirt', count: 57 }); // slot-first order
    expect(inv.slots[1]).toEqual({ item: 'dirt', count: 5 });
    // spans both slots: the first is emptied (cleared), the rest comes from the next
    expect(inv.removeItem('dirt', 60)).toBe(60);
    expect(inv.slots[0]).toBeNull();
    expect(inv.slots[1]).toEqual({ item: 'dirt', count: 2 });
  });

  it('removeItem clears emptied slots and leaves other slots untouched', () => {
    const inv = createInventoryModel(
      [{ item: 'dirt', count: 2 }, { item: 'stone', count: 10 }],
      'survival',
    );
    expect(inv.removeItem('dirt', 5)).toBe(2); // only 2 existed
    expect(inv.slots[0]).toBeNull();
    expect(inv.slots[1]).toEqual({ item: 'stone', count: 10 });
  });

  it('removeItem returns 0 for a missing item or non-positive counts', () => {
    const inv = createInventoryModel([{ item: 'dirt', count: 2 }], 'survival');
    expect(inv.removeItem('stone', 1)).toBe(0);
    expect(inv.removeItem('dirt', 0)).toBe(0);
    expect(inv.removeItem('dirt', -1)).toBe(0);
    expect(inv.countItem('dirt')).toBe(2);
  });

  it('countItem sums across slots', () => {
    const inv = createInventoryModel(
      [{ item: 'dirt', count: 64 }, null, { item: 'dirt', count: 7 }],
      'survival',
    );
    expect(inv.countItem('dirt')).toBe(71);
    expect(inv.countItem('stone')).toBe(0);
  });
});

describe('inventory model — creative semantics', () => {
  it('defaults to creative: addItem is a no-op returning 0 (infinite supply)', () => {
    const inv = createInventoryModel(empty(2));
    expect(inv.mode).toBe('creative');
    expect(inv.addItem('dirt', 64)).toBe(0);
    expect(inv.slots).toEqual([null, null]);
  });

  it('creative: removeItem is a no-op — placement never consumes', () => {
    const inv = createInventoryModel([{ item: 'grass', count: 64 }]);
    expect(inv.removeItem('grass', 1)).toBe(0);
    expect(inv.slots[0]).toEqual({ item: 'grass', count: 64 });
    expect(inv.countItem('grass')).toBe(64);
  });

  it('setMode flips the semantics', () => {
    const inv = createInventoryModel(empty(2), 'creative');
    inv.setMode('survival');
    expect(inv.mode).toBe('survival');
    expect(inv.addItem('dirt', 3)).toBe(0);
    expect(inv.countItem('dirt')).toBe(3);
    expect(inv.removeItem('dirt', 1)).toBe(1);
    expect(inv.countItem('dirt')).toBe(2);
  });
});

describe('inventory model — slots', () => {
  it('setSlot writes a stack, accepts null to clear, ignores out-of-range indexes', () => {
    const inv = createInventoryModel(empty(2), 'survival');
    inv.setSlot(1, { item: 'stick', count: 5 });
    expect(inv.slots[1]).toEqual({ item: 'stick', count: 5 });
    inv.setSlot(1, null);
    expect(inv.slots[1]).toBeNull();
    inv.setSlot(9, { item: 'stick', count: 1 });
    inv.setSlot(-1, { item: 'stick', count: 1 });
    expect(inv.slots.length).toBe(2);
  });

  it('copies initial slots instead of aliasing the caller array', () => {
    const initial: Array<ItemStack | null> = [{ item: 'dirt', count: 1 }];
    const inv = createInventoryModel(initial, 'survival');
    inv.slots[0]!.count = 99;
    expect(initial[0]!.count).toBe(1);
  });
});
