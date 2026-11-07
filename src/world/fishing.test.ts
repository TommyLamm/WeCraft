import { describe, it, expect } from 'vitest';
import {
  FISHING_WAIT_MIN_SEC,
  FISHING_WAIT_MAX_SEC,
  FISHING_BITE_WINDOW_SEC,
  FISHING_CAST_RANGE,
  FISHING_RAIN_WAIT_MULTIPLIER,
  FISHING_RAIN_WAIT_MIN_SEC,
  FISHING_RAIN_WAIT_MAX_SEC,
  rollFishingWait,
  beginFishing,
  stepFishing,
  reelFishing,
  rollFishingLoot,
} from './fishing';

const seq = (...values: number[]): (() => number) => {
  let i = 0;
  return () => values[i++] ?? 0;
};

describe('fishing tuning and wait roll', () => {
  it('pins the tuning constants', () => {
    expect(FISHING_WAIT_MIN_SEC).toBe(5);
    expect(FISHING_WAIT_MAX_SEC).toBe(30);
    expect(FISHING_BITE_WINDOW_SEC).toBe(2);
    expect(FISHING_CAST_RANGE).toBe(16);
  });

  it('rolls a wait in [5, 30] and treats a bad rng as the minimum', () => {
    expect(rollFishingWait(() => 0)).toBe(5);
    expect(rollFishingWait(() => 0.5)).toBe(17.5);
    expect(rollFishingWait(() => 1)).toBe(30);
    expect(rollFishingWait(() => Number.NaN)).toBe(5);
    expect(rollFishingWait(() => -1)).toBe(5);
    expect(rollFishingWait(() => 2)).toBe(30);
  });

  it('B15: rain shortens the wait (×0.8) but never below 4 seconds', () => {
    // 端點必須正好是晴天等待 × 0.8（5 → 4、30 → 24），中間值等比例（17.5 → 14）。
    expect(FISHING_RAIN_WAIT_MULTIPLIER).toBe(0.8);
    expect(FISHING_RAIN_WAIT_MIN_SEC).toBe(4);
    expect(FISHING_RAIN_WAIT_MAX_SEC).toBe(24);
    expect(FISHING_RAIN_WAIT_MIN_SEC).toBe(FISHING_WAIT_MIN_SEC * FISHING_RAIN_WAIT_MULTIPLIER);
    expect(FISHING_RAIN_WAIT_MAX_SEC).toBe(FISHING_WAIT_MAX_SEC * FISHING_RAIN_WAIT_MULTIPLIER);

    expect(rollFishingWait(() => 0, true)).toBe(4);
    expect(rollFishingWait(() => 0.5, true)).toBe(14);
    expect(rollFishingWait(() => 1, true)).toBe(24);
    expect(rollFishingWait(() => Number.NaN, true)).toBe(4); // 壞 rng 當最小值
  });

  it('B15: clear weather keeps the 5–30 second wait unchanged', () => {
    expect(rollFishingWait(() => 0, false)).toBe(5);
    expect(rollFishingWait(() => 0.5, false)).toBe(17.5);
    expect(rollFishingWait(() => 1, false)).toBe(30);
    // 省略 raining（既有呼叫端）＝ 晴天，行為不變。
    expect(rollFishingWait(() => 0.5)).toBe(17.5);
  });

  it('beginFishing clamps the wait and starts waiting', () => {
    expect(beginFishing(12).phase).toBe('waiting');
    expect(beginFishing(12).waitRemaining).toBe(12);
    expect(beginFishing(-3).waitRemaining).toBe(0);
    expect(beginFishing(99).waitRemaining).toBe(30);
    expect(beginFishing(Number.NaN).waitRemaining).toBe(5);
  });
});

describe('fishing state machine', () => {
  it('counts down, enters biting exactly once, then escapes after the window', () => {
    const wait = beginFishing(1);
    const almost = stepFishing(wait, 0.4);
    expect(almost.state.phase).toBe('waiting');
    expect(almost.state.waitRemaining).toBeCloseTo(0.6, 10);
    expect(almost.state.biteRemaining).toBe(0);
    expect(almost.bite).toBe(false);

    const bitten = stepFishing(almost.state, 0.7);
    expect(bitten.bite).toBe(true);
    expect(bitten.escaped).toBe(false);
    expect(bitten.state).toEqual({
      phase: 'biting',
      waitRemaining: 0,
      biteRemaining: FISHING_BITE_WINDOW_SEC,
    });

    const stillBiting = stepFishing(bitten.state, 1.9);
    expect(stillBiting.bite).toBe(false);
    expect(stillBiting.escaped).toBe(false);
    expect(stillBiting.state.biteRemaining).toBeCloseTo(0.1, 10);

    const escaped = stepFishing(stillBiting.state, 0.1);
    expect(escaped.escaped).toBe(true);
    expect(escaped.state.phase).toBe('escaped');
    expect(stepFishing(escaped.state, 1).escaped).toBe(false);
  });

  it('does not carry a large dt into the bite window', () => {
    const t = stepFishing(beginFishing(0.5), 10);
    expect(t.bite).toBe(true);
    expect(t.state.biteRemaining).toBe(FISHING_BITE_WINDOW_SEC);
  });

  it('ignores non-finite or non-positive dt', () => {
    const s = beginFishing(3);
    expect(stepFishing(s, 0).state).toEqual(s);
    expect(stepFishing(s, -1).state).toEqual(s);
    expect(stepFishing(s, Number.NaN).state).toEqual(s);
  });

  it('only reels a catch while biting', () => {
    const waiting = beginFishing(1);
    expect(reelFishing(waiting, () => 0)).toBeNull();
    const biting = stepFishing(waiting, 1).state;
    expect(reelFishing(biting, seq(0, 0))).toEqual({
      item: 'raw_cod',
      count: 1,
      category: 'fish',
    });
    expect(reelFishing({ ...biting, phase: 'escaped' }, () => 0)).toBeNull();
  });
});

describe('fishing loot table', () => {
  it('uses the 85/10/5 category split', () => {
    expect(rollFishingLoot(seq(0.8499, 0)).category).toBe('fish');
    expect(rollFishingLoot(seq(0.85, 0)).category).toBe('junk');
    expect(rollFishingLoot(seq(0.9499, 0)).category).toBe('junk');
    expect(rollFishingLoot(seq(0.95, 0)).category).toBe('treasure');
  });

  it('rolls the four fish at 60/25/13/2', () => {
    expect(rollFishingLoot(seq(0, 0)).item).toBe('raw_cod');
    expect(rollFishingLoot(seq(0, 0.5999)).item).toBe('raw_cod');
    expect(rollFishingLoot(seq(0, 0.6)).item).toBe('raw_salmon');
    expect(rollFishingLoot(seq(0, 0.8499)).item).toBe('raw_salmon');
    expect(rollFishingLoot(seq(0, 0.85)).item).toBe('pufferfish');
    expect(rollFishingLoot(seq(0, 0.9799)).item).toBe('pufferfish');
    expect(rollFishingLoot(seq(0, 0.98)).item).toBe('tropical_fish');
  });

  it('rolls junk and treasure from the existing item pool', () => {
    expect(rollFishingLoot(seq(0.85, 0))).toEqual({ item: 'stick', count: 2, category: 'junk' });
    expect(rollFishingLoot(seq(0.85, 0.4))).toEqual({ item: 'rotten_flesh', count: 1, category: 'junk' });
    expect(rollFishingLoot(seq(0.85, 0.999))).toEqual({ item: 'oak_planks', count: 4, category: 'junk' });
    expect(rollFishingLoot(seq(0.95, 0))).toEqual({ item: 'iron_ingot', count: 1, category: 'treasure' });
    expect(rollFishingLoot(seq(0.95, 0.75))).toEqual({ item: 'diamond', count: 1, category: 'treasure' });
    expect(rollFishingLoot(seq(0.95, 0.999))).toEqual({ item: 'leather_boots', count: 1, category: 'treasure' });
  });

  it('never returns NaN or an unknown item for a bad rng', () => {
    const bad = rollFishingLoot(seq(Number.NaN, Number.NaN));
    expect(bad.category).toBe('fish');
    expect(bad.item).toBe('raw_cod');
    expect(bad.count).toBe(1);
    expect(rollFishingLoot(() => Number.POSITIVE_INFINITY).item).toBe('raw_cod');
  });
});
