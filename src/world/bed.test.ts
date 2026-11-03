import { describe, it, expect } from 'vitest';
import {
  BED_USE_DISTANCE,
  SLEEP_MAX_INTERNAL_SKY_LIGHT,
  SLEEP_MONSTER_HORIZONTAL,
  SLEEP_MONSTER_VERTICAL,
  SLEEP_DURATION_SEC,
  bedUse,
  bedSpawnPosition,
  respawnPointFor,
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

// B10 批末審查 I1：`World.getBlock` 對**未載入**的區塊回 AIR——如果拿它當「床沒了」
// 的證據，玩家離家超過載入距離死亡就會**失去床的重生**（本批的核心承諾）。
// `respawnPointFor` 把查證結果分成 placed／missing／unloaded 三態：只有 **missing**
// （區塊已載入、確定不是床）才退回世界出生點。
describe('respawnPointFor（死亡重生點的三態決定）', () => {
  const worldSpawn = { x: 0, y: 70, z: 0 };

  it('B10 審查 I1: a loaded, still-placed bed wins — the bed top is the spawn', () => {
    expect(respawnPointFor(bed, 'placed', worldSpawn)).toEqual({ x: 10.5, y: 65, z: 10.5 });
  });

  it('B10 審查 I1: an UNLOADED chunk is not evidence the bed is gone — the record stands', () => {
    // 回歸：修復前這條會拿到世界出生點（玩家離家約 200 格死亡 → 失去床的重生）。
    expect(respawnPointFor(bed, 'unloaded', worldSpawn)).toEqual({ x: 10.5, y: 65, z: 10.5 });
  });

  it('B10 審查 I1: only a confirmed-missing bed (broken / exploded) falls back to world spawn', () => {
    expect(respawnPointFor(bed, 'missing', worldSpawn)).toEqual(worldSpawn);
  });

  it('B10 審查 I1: no bed record → world spawn, whatever the lookup says', () => {
    expect(respawnPointFor(null, 'unloaded', worldSpawn)).toEqual(worldSpawn);
    expect(respawnPointFor(null, 'missing', worldSpawn)).toEqual(worldSpawn);
    expect(respawnPointFor(null, 'placed', worldSpawn)).toEqual(worldSpawn);
  });
});
