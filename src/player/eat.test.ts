import { describe, it, expect } from 'vitest';
import {
  APPLE_FOOD,
  APPLE_SAT,
  EAT_TIME_SEC,
  FOOD_VALUES,
  EatProgress,
  canEat,
  eatFromSlot,
  foodFor,
} from './eat';
import { createVitals, eat } from './survival';
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

  it('any food item can be eaten', () => {
    const slots: Array<ItemStack | null> = [{ item: 'raw_beef', count: 2 }];
    const r = eatFromSlot(slots, 0);
    expect(r.ate).toBe(true);
    expect(r.slots[0]).toEqual({ item: 'raw_beef', count: 1 });
    expect(slots[0]).toEqual({ item: 'raw_beef', count: 2 }); // input untouched
  });

  it('a rotten flesh stack is food', () => {
    const slots: Array<ItemStack | null> = [{ item: 'rotten_flesh', count: 1 }];
    const r = eatFromSlot(slots, 0);
    expect(r.ate).toBe(true);
    expect(r.slots[0]).toBeNull(); // 最後一個 → 格子清空
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

describe('food table', () => {
  it('the food table matches vanilla hunger and saturation', () => {
    expect(FOOD_VALUES).toEqual({
      apple: { food: 4, saturation: 2.4 },
      raw_chicken: { food: 2, saturation: 1.2 },
      cooked_chicken: { food: 6, saturation: 7.2 },
      raw_porkchop: { food: 3, saturation: 1.8 },
      cooked_porkchop: { food: 8, saturation: 12.8 },
      raw_mutton: { food: 2, saturation: 1.2 },
      cooked_mutton: { food: 6, saturation: 9.6 },
      raw_beef: { food: 3, saturation: 1.8 },
      steak: { food: 8, saturation: 12.8 },
      rotten_flesh: { food: 4, saturation: 0.8 },
    });
  });

  it('the apple constants stay in sync with the food table', () => {
    // APPLE_FOOD／APPLE_SAT 是寫死的常數（型別零風險），這條釘死它們與
    // FOOD_VALUES.apple 一致 —— 改一邊就必須改另一邊。
    expect(APPLE_FOOD).toBe(FOOD_VALUES.apple?.food);
    expect(APPLE_SAT).toBe(FOOD_VALUES.apple?.saturation);
  });

  it('the eat time matches vanilla 32 ticks', () => {
    expect(EAT_TIME_SEC).toBe(1.6); // 32 tick ÷ 20 tick/s
  });

  it('foodFor returns null for non-food items', () => {
    expect(foodFor('oak_log')).toBeNull();
    expect(foodFor('stone')).toBeNull();
  });

  it('foodFor returns the table entry for food items', () => {
    expect(foodFor('steak')).toEqual({ food: 8, saturation: 12.8 });
    expect(foodFor('rotten_flesh')).toEqual({ food: 4, saturation: 0.8 });
  });
});

describe('canEat', () => {
  it('canEat refuses a full hunger bar', () => {
    expect(canEat({ ...createVitals(), hunger: 20 }, 'apple')).toBe(false);
    expect(canEat({ ...createVitals(), hunger: 19 }, 'apple')).toBe(true);
  });

  it('canEat refuses a non-food item', () => {
    // 守門必須有效：vitals 要「沒吃飽」，否則會被「滿飢餓不可進食」擋下，
    // 這條案例就算把 canEat 的食物檢查整段刪掉也會通過（空轉）。
    // 同一組 vitals 加上正向對照 → 食物可吃、非食物不可吃（守門有效）。
    const hungry = { ...createVitals(), hunger: 10 };
    expect(canEat(hungry, 'stone')).toBe(false);
    expect(canEat(hungry, 'apple')).toBe(true);
  });
});

describe('EatProgress', () => {
  it('a hold that has not reached 1.6 s never completes', () => {
    const p = new EatProgress();
    expect(p.update(1.59, 'apple', true)).toBe('eating');
    expect(p.elapsed).toBeCloseTo(1.59, 5);
    expect(p.update(0.005, 'apple', true)).toBe('eating'); // 累計 1.595 < 1.6
    // 最後一步用 0.01 而不是 0.005：IEEE-754 下 1.59 + 0.005 + 0.005 =
    // 1.5999999999999998668（浮點誤差，仍 < 1.6）→ 用 0.01 跨過門檻。
    // 「剛好 1.6 就完成」的邊界由下一則案例（update(1.6) → 'eaten'）釘死。
    expect(p.update(0.01, 'apple', true)).toBe('eaten'); // 累計 1.605 ≥ 1.6
  });

  it('a completed hold resets the accumulator', () => {
    const p = new EatProgress();
    expect(p.update(1.6, 'apple', true)).toBe('eaten');
    expect(p.elapsed).toBe(0);
    expect(p.update(0.1, 'apple', true)).toBe('eating');
  });

  it('releasing the button resets the progress', () => {
    const p = new EatProgress();
    expect(p.update(1.0, 'apple', true)).toBe('eating');
    p.reset();
    expect(p.elapsed).toBe(0);
    expect(p.item).toBeNull();
  });

  it('switching the held item restarts the progress', () => {
    const p = new EatProgress();
    expect(p.update(1.0, 'apple', true)).toBe('eating');
    expect(p.update(0.1, 'raw_beef', true)).toBe('eating');
    expect(p.elapsed).toBeCloseTo(0.1, 5);
    expect(p.item).toBe('raw_beef');
  });

  it('a disallowed item cancels the progress', () => {
    const p = new EatProgress();
    expect(p.update(1.0, 'apple', true)).toBe('eating');
    expect(p.update(0.1, 'apple', false)).toBe('idle');
    expect(p.elapsed).toBe(0);
  });

  it('a null item cancels the progress', () => {
    const p = new EatProgress();
    expect(p.update(0.1, null, true)).toBe('idle');
    expect(p.elapsed).toBe(0);
    expect(p.item).toBeNull();
  });

  it('non-finite dt is treated as 0', () => {
    const p = new EatProgress();
    expect(p.update(Number.NaN, 'apple', true)).toBe('eating');
    expect(p.elapsed).toBe(0);
  });
});
