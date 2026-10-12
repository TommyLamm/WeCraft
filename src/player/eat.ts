import type { ItemStack } from '../core/items';

/** Apple food values (Minecraft parity): 4 hunger points, 2.4 saturation.
 *  Saturation is applied through `survival.eat`, which caps at maxHunger —
 *  eating at full hunger still consumes the apple (overflow waste, Minecraft
 *  parity per the Task 8 brief). */
export const APPLE_FOOD = 4;
export const APPLE_SAT = 2.4;

export interface EatResult {
  readonly slots: ReadonlyArray<ItemStack | null>;
  readonly ate: boolean;
}

/** Consume one apple from `slots[index]` (pure — the input is never mutated).
 *  Only apples are edible: null, out-of-range or non-apple slots return the
 *  SAME array with `ate: false` (miss → same ref, `spawnBlockDrop` convention).
 *  An apple stack of 1 clears the slot, otherwise the count decrements by 1
 *  (fresh array + fresh stack when `ate` is true). Non-positive or non-finite
 *  counts clear the slot rather than poisoning it. */
export function eatFromSlot(
  slots: ReadonlyArray<ItemStack | null>,
  index: number,
): EatResult {
  const s = slots[index];
  if (!s || s.item !== 'apple') return { slots, ate: false };
  const next = slots.slice();
  next[index] = s.count - 1 >= 1 ? { item: 'apple', count: s.count - 1 } : null;
  return { slots: next, ate: true };
}
