import { describe, it, expect } from 'vitest';
import { APPLE_FOOD, APPLE_SAT, eatFromSlot } from './eat';
import { eat } from './survival';
import type { ItemStack } from '../core/items';

const apple = (count: number): ItemStack => ({ item: 'apple', count });

describe('eatFromSlot', () => {
  it('null slot → ate false, slots untouched', () => {
    const slots: Array<ItemStack | null> = [null, apple(2)];
    const r = eatFromSlot(slots, 0);
    expect(r.ate).toBe(false);
    expect(r.slots).toBe(slots); // miss → same ref (spawnBlockDrop convention)
  });

  it('apple ×3 → ×2 and ate true (input never mutated)', () => {
    const slots: Array<ItemStack | null> = [apple(3)];
    const r = eatFromSlot(slots, 0);
    expect(r.ate).toBe(true);
    expect(r.slots[0]).toEqual({ item: 'apple', count: 2 });
    expect(slots[0]).toEqual({ item: 'apple', count: 3 }); // input untouched
  });

  it('non-food (stone) → ate false', () => {
    const slots: Array<ItemStack | null> = [{ item: 'stone', count: 3 }];
    const r = eatFromSlot(slots, 0);
    expect(r.ate).toBe(false);
    expect(r.slots).toBe(slots);
  });

  it('apple ×1 → slot cleared (null), ate true', () => {
    const slots: Array<ItemStack | null> = [apple(1)];
    const r = eatFromSlot(slots, 0);
    expect(r.ate).toBe(true);
    expect(r.slots[0]).toBeNull();
  });
});

describe('apple eat values', () => {
  it('hunger 16 → 20, saturation +2.4 capped at maxHunger', () => {
    expect(APPLE_FOOD).toBe(4);
    expect(APPLE_SAT).toBe(2.4);
    const fed = eat(
      {
        hp: 20, maxHp: 20, hunger: 16, maxHunger: 20, saturation: 5,
        regenAcc: 0, starveAcc: 0, exhaustion: 0,
      },
      APPLE_FOOD,
      APPLE_SAT,
    );
    expect(fed.hunger).toBe(20); // 16 + 4
    expect(fed.saturation).toBeCloseTo(7.4, 5);
    const full = eat({ ...fed, hunger: 20, saturation: 19 }, APPLE_FOOD, APPLE_SAT);
    expect(full.hunger).toBe(20);
    expect(full.saturation).toBe(20); // 19 + 2.4 capped, not 21.4
  });
});
