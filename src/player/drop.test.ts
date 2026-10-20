import { describe, it, expect } from 'vitest';
import { dropCount } from './drop';
import type { ItemStack } from '../core/items';

// ---- helpers -------------------------------------------------------------
/** A held stack of `count` dirt. */
const stack = (count: number): ItemStack => ({ item: 'dirt', count });

describe('dropCount (B2.5)', () => {
  it('creative mode drops nothing (no drop, no consumption)', () => {
    expect(dropCount(stack(10), false, 'creative')).toBe(0);
    expect(dropCount(stack(10), true, 'creative')).toBe(0);
    expect(dropCount(stack(1), false, 'creative')).toBe(0);
    expect(dropCount(null, false, 'creative')).toBe(0);
  });

  it('survival + plain Q drops exactly one item, whatever the stack size', () => {
    expect(dropCount(stack(1), false, 'survival')).toBe(1);
    expect(dropCount(stack(2), false, 'survival')).toBe(1);
    expect(dropCount(stack(64), false, 'survival')).toBe(1);
  });

  it('survival + Ctrl+Q drops the whole stack', () => {
    expect(dropCount(stack(64), true, 'survival')).toBe(64);
    expect(dropCount(stack(1), true, 'survival')).toBe(1);
    expect(dropCount(stack(7), true, 'survival')).toBe(7);
  });

  it('an empty slot drops nothing', () => {
    expect(dropCount(null, false, 'survival')).toBe(0);
    expect(dropCount(null, true, 'survival')).toBe(0);
  });

  it('a zero, negative or invalid count drops nothing', () => {
    expect(dropCount(stack(0), false, 'survival')).toBe(0);
    expect(dropCount(stack(-3), false, 'survival')).toBe(0);
    expect(dropCount(stack(0), true, 'survival')).toBe(0);
    expect(dropCount(stack(-3), true, 'survival')).toBe(0);
    expect(dropCount(stack(Number.NaN), false, 'survival')).toBe(0);
    expect(dropCount(stack(Number.NaN), true, 'survival')).toBe(0);
    expect(dropCount(stack(Number.POSITIVE_INFINITY), true, 'survival')).toBe(0);
    expect(dropCount(stack(Number.NEGATIVE_INFINITY), true, 'survival')).toBe(0);
  });

  it('never drops more than the held count (no duplication)', () => {
    for (const count of [1, 2, 7, 64]) {
      expect(dropCount(stack(count), false, 'survival')).toBeLessThanOrEqual(count);
      expect(dropCount(stack(count), true, 'survival')).toBeLessThanOrEqual(count);
    }
    // a fractional count is floored — the drop count must be a whole number
    // (spendFromSlot rejects non-integers), never more than what is held
    expect(dropCount(stack(3.9), true, 'survival')).toBe(3);
    expect(dropCount(stack(3.9), false, 'survival')).toBe(1);
  });
});
