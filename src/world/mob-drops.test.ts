import { describe, it, expect } from 'vitest';
import { rollMobDrops, type MobDropKind } from './mob-drops';

// ---- helpers -------------------------------------------------------------
/** 固定的 rng：永遠回同一個值 → 掉落數量可重現。 */
const fixed = (v: number): (() => number) => () => v;

describe('rollMobDrops (B4 Task 4：擊殺掉落表)', () => {
  it('zombie drops 0-2 rotten flesh', () => {
    // 0 → 掉 0 顆 → 整張表是空的（count 0 的項目不輸出）
    expect(rollMobDrops('zombie', fixed(0))).toEqual([]);
    // 0.999 → 掉滿 2 顆
    expect(rollMobDrops('zombie', fixed(0.999))).toEqual([
      { item: 'rotten_flesh', count: 2 },
    ]);
  });

  it('skeleton drops 0-2 bones and 0-2 arrows', () => {
    expect(rollMobDrops('skeleton', fixed(0.999))).toEqual([
      { item: 'bone', count: 2 },
      { item: 'arrow', count: 2 },
    ]);
    expect(rollMobDrops('skeleton', fixed(0))).toEqual([]);
  });

  it('chicken drops one raw chicken and 0-2 feathers', () => {
    expect(rollMobDrops('chicken', fixed(0.999))).toEqual([
      { item: 'raw_chicken', count: 1 },
      { item: 'feather', count: 2 },
    ]);
    // 生雞肉是固定 1 顆 → 即使 rng 最小也一定有
    expect(rollMobDrops('chicken', fixed(0))).toEqual([
      { item: 'raw_chicken', count: 1 },
    ]);
  });

  it('pig drops 1-3 raw porkchops', () => {
    expect(rollMobDrops('pig', fixed(0))).toEqual([
      { item: 'raw_porkchop', count: 1 },
    ]);
    expect(rollMobDrops('pig', fixed(0.999))).toEqual([
      { item: 'raw_porkchop', count: 3 },
    ]);
  });

  it('sheep drops 1-2 raw mutton and one wool', () => {
    expect(rollMobDrops('sheep', fixed(0.999))).toEqual([
      { item: 'raw_mutton', count: 2 },
      { item: 'wool', count: 1 },
    ]);
    // 羊毛固定 1 顆
    expect(rollMobDrops('sheep', fixed(0))).toEqual([
      { item: 'raw_mutton', count: 1 },
      { item: 'wool', count: 1 },
    ]);
  });

  it('cow drops 1-3 raw beef and 0-2 leather', () => {
    expect(rollMobDrops('cow', fixed(0.999))).toEqual([
      { item: 'raw_beef', count: 3 },
      { item: 'leather', count: 2 },
    ]);
    expect(rollMobDrops('cow', fixed(0))).toEqual([
      { item: 'raw_beef', count: 1 },
    ]);
  });

  it('the rng never produces a fractional or negative count', () => {
    const kinds: MobDropKind[] = [
      'zombie',
      'skeleton',
      'chicken',
      'pig',
      'sheep',
      'cow',
    ];
    for (const kind of kinds) {
      for (let i = 0; i < 200; i++) {
        for (const drop of rollMobDrops(kind)) {
          expect(Number.isInteger(drop.count)).toBe(true);
          expect(drop.count).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });
});
