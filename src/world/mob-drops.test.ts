import { describe, it, expect } from 'vitest';
import { rollMobDrops, dropsForDeaths, type MobDropKind } from './mob-drops';

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

// ---- B4 Task 4 審查 I-2：生物死亡 → 掉落（單一路徑，不看死因）-------------
describe('dropsForDeaths (生物死亡 → 掉落：死因無關)', () => {
  it('a death drops the same loot whatever the cause (melee / arrow / burn)', () => {
    // 這個函式**不收死因** → 近戰、箭、白天燃燒…走同一條路徑、同一份掉落表。
    // 骷髏 → 骨頭 0–2 ＋ 箭 0–2（'arrow' 是既有 ItemId → 掉落確實會發生）。
    expect(
      dropsForDeaths([{ kind: 'skeleton', pos: { x: 1, y: 2, z: 3 } }], () => 0.999),
    ).toEqual([
      { item: 'bone', count: 2, pos: { x: 1, y: 2.9, z: 3 } },
      { item: 'arrow', count: 2, pos: { x: 1, y: 2.9, z: 3 } },
    ]);
  });

  it('the loot lands at the body height of the dead mob (+0.9)', () => {
    const [drop] = dropsForDeaths([{ kind: 'zombie', pos: { x: -4, y: 64, z: 8 } }], () => 0.999);
    expect(drop.pos).toEqual({ x: -4, y: 64.9, z: 8 });
  });

  it('several deaths merge their loot (one entry per item and mob)', () => {
    const out = dropsForDeaths(
      [
        { kind: 'zombie', pos: { x: 0, y: 0, z: 0 } },
        { kind: 'skeleton', pos: { x: 5, y: 0, z: 0 } },
      ],
      () => 0.999,
    );
    expect(out.map((d) => d.item)).toEqual([
      'rotten_flesh',
      'bone',
      'arrow',
    ]);
    expect(out.map((d) => d.pos.x)).toEqual([0, 5, 5]);
  });

  it('no dead mobs means no drops', () => {
    expect(dropsForDeaths([], () => 0.999)).toEqual([]);
  });
});
