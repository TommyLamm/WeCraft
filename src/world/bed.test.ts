import { describe, it, expect } from 'vitest';
import {
  BED_USE_DISTANCE,
  SLEEP_MAX_INTERNAL_SKY_LIGHT,
  SLEEP_MONSTER_HORIZONTAL,
  SLEEP_MONSTER_VERTICAL,
  SLEEP_DURATION_SEC,
  bedUse,
  bedSpawnPosition,
} from './bed';

const bed = { x: 10, y: 64, z: 10 };
const ctx = (over: Partial<Parameters<typeof bedUse>[0]> = {}): Parameters<typeof bedUse>[0] => ({
  eye: { x: 10.5, y: 66, z: 12.5 }, // 3 格內
  bed,
  clockT: 0.75, // 午夜
  monsters: [],
  ...over,
});

describe('bedUse', () => {
  it('B10: the constants match the design values', () => {
    expect(BED_USE_DISTANCE).toBe(3);
    expect(SLEEP_MAX_INTERNAL_SKY_LIGHT).toBe(11);
    expect(SLEEP_MONSTER_HORIZONTAL).toBe(8);
    expect(SLEEP_MONSTER_VERTICAL).toBe(5);
  });

  it('B10: night = sleep; noon / morning = set spawn only', () => {
    expect(bedUse(ctx())).toBe('sleep');
    expect(bedUse(ctx({ clockT: 0.25 }))).toBe('set-spawn-only'); // 正午 → 內部天空光 15
    expect(bedUse(ctx({ clockT: 0.05 }))).toBe('set-spawn-only'); // 日出後 → 15
    expect(bedUse(ctx({ clockT: 0.48 }))).toBe('set-spawn-only'); // 內部天空光 13 > 11
    expect(bedUse(ctx({ clockT: 0.49 }))).toBe('sleep'); // 內部天空光 11（門檻邊界）
    expect(bedUse(ctx({ clockT: 0.5 }))).toBe('sleep'); // 黃昏 → 10
  });

  it('B10: monsters block sleep at 8 blocks horizontal / 5 vertical (inclusive)', () => {
    expect(bedUse(ctx({ monsters: [{ pos: { x: 18.5, y: 64.5, z: 10.5 } }] }))).toBe('monsters');
    expect(bedUse(ctx({ monsters: [{ pos: { x: 18.51, y: 64.5, z: 10.5 } }] }))).toBe('sleep');
    expect(bedUse(ctx({ monsters: [{ pos: { x: 10.5, y: 69.49, z: 10.5 } }] }))).toBe('monsters');
    expect(bedUse(ctx({ monsters: [{ pos: { x: 10.5, y: 69.51, z: 10.5 } }] }))).toBe('sleep');
  });

  it('B10: daytime wins over monsters (time is checked before the monster sweep)', () => {
    const monsters = [{ pos: { x: 10.5, y: 64.5, z: 10.5 } }];
    expect(bedUse(ctx({ clockT: 0.25, monsters }))).toBe('set-spawn-only');
  });

  it('B10: using a bed farther than 3 blocks is too far', () => {
    expect(bedUse(ctx({ eye: { x: 10.5, y: 66, z: 13.51 } }))).toBe('too-far');
    // 3.0 恰好在門檻上（≤ 3 才算近）
    expect(bedUse(ctx({ eye: { x: 10.5, y: 64.5, z: 13.5 } }))).toBe('sleep');
  });

  it('B10: a monster exactly at the bed centre still blocks sleep', () => {
    expect(bedUse(ctx({ monsters: [{ pos: { x: 10.5, y: 64.5, z: 10.5 } }] }))).toBe('monsters');
  });

  it('B10: the sleep duration is 101 ticks and the spawn point is the bed top', () => {
    expect(SLEEP_DURATION_SEC).toBe(5.05);
    expect(bedSpawnPosition(bed)).toEqual({ x: 10.5, y: 65, z: 10.5 });
    expect(bedSpawnPosition({ x: -3, y: 0, z: 8 })).toEqual({ x: -2.5, y: 1, z: 8.5 });
  });
});
