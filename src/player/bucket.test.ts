import { describe, it, expect } from 'vitest';
import { canFillBucket, bucketAfterFill, bucketAfterEmpty } from './bucket';
import { BLOCK } from '../world/blocks';

// ---- B16 Task 7：水桶的純邏輯 ----------------------------------------------
// 這裡只測**規則**（能不能裝水、換成什麼物品）；射線、音效、寫世界都在組裝根
// （`src/main.ts`），由 `src/main.wiring.test.ts` 的接線釘子把關。

describe('canFillBucket（B16 Task 7）', () => {
  it('canFillBucket accepts only a nearest source', () => {
    // 瞄到水源、前面沒有更近的方塊 → 可以裝水。
    expect(canFillBucket(BLOCK.WATER, 3, null)).toBe(true);
    // 方塊在**後面**（t 更大）→ 水源仍是最近的可裝目標。
    expect(canFillBucket(BLOCK.WATER, 3, 5)).toBe(true);
    // 方塊**更近**（t 更小）→ 前面有東西擋著，不該穿過去裝水。
    expect(canFillBucket(BLOCK.WATER, 5, 3)).toBe(false);
    // flow／fall 不是水源（只能從水源裝水）。
    expect(canFillBucket(BLOCK.WATER_FLOW_1, 3, null)).toBe(false);
    expect(canFillBucket(BLOCK.WATER_FALL, 3, null)).toBe(false);
    // 距離不合法（NaN／負數）→ 不裝。
    expect(canFillBucket(BLOCK.WATER, Number.NaN, null)).toBe(false);
    expect(canFillBucket(BLOCK.WATER, -1, null)).toBe(false);
  });

  it('the source check is the only water id that counts', () => {
    // 空氣／石頭等都不是水。
    expect(canFillBucket(BLOCK.AIR, 3, null)).toBe(false);
    expect(canFillBucket(BLOCK.STONE, 3, null)).toBe(false);
  });

  it('a non-finite nearer-block distance counts as "no nearer block"', () => {
    // blockT 非有限 → 視為「沒有更近的方塊」（NaN／Infinity 都不阻擋裝水）。
    expect(canFillBucket(BLOCK.WATER, 3, Number.NaN)).toBe(true);
    expect(canFillBucket(BLOCK.WATER, 3, Number.POSITIVE_INFINITY)).toBe(true);
    // 但水源自己的距離不合法 → 一律不裝。
    expect(canFillBucket(BLOCK.WATER, Number.POSITIVE_INFINITY, null)).toBe(false);
  });

  it('a tie (same distance) still counts as the source being in front', () => {
    // blockT >= waterT 才放行 → 同一距離視為沒有更近的方塊。
    expect(canFillBucket(BLOCK.WATER, 3, 3)).toBe(true);
  });
});

describe('bucketAfterFill／bucketAfterEmpty（B16 Task 7）', () => {
  it('bucketAfterFill/Empty return fresh stack-1 items', () => {
    const filled = bucketAfterFill();
    expect(filled.item).toBe('water_bucket');
    expect(filled.count).toBe(1);

    const emptied = bucketAfterEmpty();
    expect(emptied.item).toBe('bucket');
    expect(emptied.count).toBe(1);
  });

  it('every call returns a NEW object (callers may keep their own copy)', () => {
    // 每次呼叫都要是新物件 → 呼叫端可以安全地把 stack 放進背包（不共享引用）。
    const a = bucketAfterFill();
    const b = bucketAfterFill();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);

    const c = bucketAfterEmpty();
    const d = bucketAfterEmpty();
    expect(c).not.toBe(d);
    expect(c).toEqual(d);
  });
});
