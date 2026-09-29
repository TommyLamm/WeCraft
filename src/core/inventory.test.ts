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

describe('inventory model — spendFromSlot (placement cost)', () => {
  it('survival decrements exactly the given slot even when another slot holds the same item', () => {
    const inv = createInventoryModel(
      [{ item: 'dirt', count: 5 }, { item: 'dirt', count: 64 }],
      'survival',
    );
    expect(inv.spendFromSlot(0, 1)).toBe(true);
    expect(inv.slots[0]).toEqual({ item: 'dirt', count: 4 }); // only the placed slot pays
    expect(inv.slots[1]).toEqual({ item: 'dirt', count: 64 });
    expect(inv.countItem('dirt')).toBe(68);
  });

  it('clears the slot when the count reaches 0', () => {
    const inv = createInventoryModel([{ item: 'grass', count: 1 }], 'survival');
    expect(inv.spendFromSlot(0, 1)).toBe(true);
    expect(inv.slots[0]).toBeNull();
    expect(inv.countItem('grass')).toBe(0);
  });

  it('returns false and mutates nothing on a null slot or insufficient count', () => {
    const inv = createInventoryModel([{ item: 'dirt', count: 2 }, null], 'survival');
    expect(inv.spendFromSlot(1, 1)).toBe(false); // null slot
    expect(inv.spendFromSlot(0, 3)).toBe(false); // 2 < 3
    expect(inv.spendFromSlot(9, 1)).toBe(false); // out of range
    expect(inv.slots).toEqual([{ item: 'dirt', count: 2 }, null]); // no partial spend
  });

  it('rejects negative, fractional and NaN counts with zero mutation', () => {
    const inv = createInventoryModel([{ item: 'dirt', count: 5 }], 'survival');
    expect(inv.spendFromSlot(0, -1)).toBe(false); // -1 would ADD an item (duplication)
    expect(inv.slots[0]).toEqual({ item: 'dirt', count: 5 });
    expect(inv.spendFromSlot(0, 0.5)).toBe(false); // fractional counts poison the stack
    expect(inv.slots[0]).toEqual({ item: 'dirt', count: 5 });
    expect(inv.spendFromSlot(0, NaN)).toBe(false); // NaN would poison the slot outright
    expect(inv.slots[0]).toEqual({ item: 'dirt', count: 5 });
    expect(inv.countItem('dirt')).toBe(5);
    // the guard sits ABOVE the mode branch: invalid input is invalid everywhere
    const creative = createInventoryModel([{ item: 'dirt', count: 5 }]);
    expect(creative.spendFromSlot(0, -1)).toBe(false);
    expect(creative.slots[0]).toEqual({ item: 'dirt', count: 5 });
  });

  it('creative: returns true and mutates nothing (placement never consumes)', () => {
    const inv = createInventoryModel([{ item: 'grass', count: 64 }, null]); // creative default
    expect(inv.spendFromSlot(0, 1)).toBe(true);
    expect(inv.spendFromSlot(1, 1)).toBe(true); // even an empty slot "succeeds"
    expect(inv.slots[0]).toEqual({ item: 'grass', count: 64 });
    expect(inv.slots[1]).toBeNull();
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

  it('setSlot clears the slot for counts below 1', () => {
    const inv = createInventoryModel(empty(2), 'survival');
    inv.setSlot(0, { item: 'dirt', count: 0 });
    expect(inv.slots[0]).toBeNull();
    inv.setSlot(0, { item: 'dirt', count: -5 });
    expect(inv.slots[0]).toBeNull();
  });

  it('setSlot clamps the count to maxStack and floors non-integers', () => {
    const inv = createInventoryModel(empty(2), 'survival');
    inv.setSlot(0, { item: 'grass', count: 999 });
    expect(inv.slots[0]).toEqual({ item: 'grass', count: 64 });
    inv.setSlot(1, { item: 'dirt', count: 2.7 });
    expect(inv.slots[1]).toEqual({ item: 'dirt', count: 2 });
  });

  it('setSlot stores a copy — mutating the caller object afterward has no effect', () => {
    const inv = createInventoryModel(empty(1), 'survival');
    const stack: ItemStack = { item: 'dirt', count: 5 };
    inv.setSlot(0, stack);
    stack.count = 99;
    expect(inv.slots[0]).toEqual({ item: 'dirt', count: 5 });
  });

  it('copies initial slots instead of aliasing the caller array', () => {
    const initial: Array<ItemStack | null> = [{ item: 'dirt', count: 1 }];
    const inv = createInventoryModel(initial, 'survival');
    inv.slots[0]!.count = 99;
    expect(initial[0]!.count).toBe(1);
  });
});

// `fits` is the atomic-take pre-check (crafting review Critical #1): addItem
// commits partial merges BEFORE returning its remainder, so "check the
// overflow afterwards" would already have granted a free partial stack.
describe('inventory model — fits (capacity pre-check)', () => {
  it('exact-fit boundary: slack 2 < 4 → false, slack exactly 4 → true', () => {
    const inv = createInventoryModel(
      [
        { item: 'oak_planks', count: 62 }, // only slack in the whole inventory: 64 − 62 = 2
        { item: 'dirt', count: 64 },
        { item: 'dirt', count: 64 },
        { item: 'dirt', count: 64 },
        { item: 'dirt', count: 64 },
        { item: 'dirt', count: 64 },
        { item: 'dirt', count: 64 },
        { item: 'dirt', count: 64 },
        { item: 'oak_log', count: 64 },
      ],
      'survival',
    );
    expect(inv.fits('oak_planks', 4)).toBe(false); // 2 < 4 — the bug this guards
    expect(inv.fits('oak_planks', 2)).toBe(true); // exactly the slack
    inv.setSlot(8, null); // +64 of room (an empty slot, not more planks slack)
    expect(inv.fits('oak_planks', 4)).toBe(true); // 2 + 64 ≥ 4
  });

  it('an empty slot is worth maxStack of room (splitting cost is not hidden)', () => {
    const inv = createInventoryModel(empty(2), 'survival');
    expect(inv.fits('dirt', 128)).toBe(true); // 2 × 64
    expect(inv.fits('dirt', 129)).toBe(false); // 2 × 64 + 1
    expect(inv.fits('wooden_pickaxe', 2)).toBe(true); // tools: cap 1 per slot
    expect(inv.fits('wooden_pickaxe', 3)).toBe(false);
  });

  it('count ≤ 0 fits (nothing to add); NaN / +Infinity never fit', () => {
    const inv = createInventoryModel([{ item: 'dirt', count: 64 }], 'survival');
    expect(inv.fits('dirt', 0)).toBe(true);
    expect(inv.fits('dirt', -3)).toBe(true);
    expect(inv.fits('dirt', NaN)).toBe(false);
    expect(inv.fits('dirt', Infinity)).toBe(false);
  });

  it('is a pure read — slots are untouched by every answer', () => {
    const inv = createInventoryModel(
      [{ item: 'oak_planks', count: 62 }, null, { item: 'stick', count: 5 }],
      'survival',
    );
    const before = inv.slots.map((s) => (s ? { ...s } : null));
    expect(inv.fits('oak_planks', 67)).toBe(false); // slack 2 + one empty slot 64 = 66
    expect(inv.fits('oak_planks', 66)).toBe(true); // exactly that slack
    expect(inv.fits('dirt', 64)).toBe(true); // only the empty slot is reusable
    expect(inv.fits('dirt', 65)).toBe(false);
    expect(inv.slots).toEqual(before);
  });

  it('agrees with addItem: fits(n) ⇔ addItem(n) reports no overflow', () => {
    const inv = createInventoryModel(
      [{ item: 'dirt', count: 60 }, { item: 'stone', count: 64 }, null],
      'survival',
    );
    for (const n of [1, 4, 67, 68, 69]) {
      const probe = createInventoryModel(
        [{ item: 'dirt', count: 60 }, { item: 'stone', count: 64 }, null],
        'survival',
      );
      expect(inv.fits('dirt', n)).toBe(probe.addItem('dirt', n) === 0);
    }
  });

  it('creative: fits stays a structural capacity read (no mode branch)', () => {
    // The crafting take path is unreachable in creative (plan 12.4 — crafting
    // is hidden), so fits reports what the SLOTS can hold either way.
    const inv = createInventoryModel([{ item: 'dirt', count: 64 }]); // creative default
    expect(inv.mode).toBe('creative');
    expect(inv.fits('dirt', 1)).toBe(false);
    expect(inv.fits('dirt', 0)).toBe(true);
  });
});
