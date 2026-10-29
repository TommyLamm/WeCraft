import { describe, it, expect } from 'vitest';
import { rollMobDrops, dropsForDeaths, type MobDropKind } from './mob-drops';

// ---- helpers -------------------------------------------------------------
/** 固定的 rng：永遠回同一個值 → 掉落數量可重現。 */
const fixed = (v: number): (() => number) => () => v;

/** 依序回傳陣列值的 rng；用完後重複最後一個值（抽樣順序固定時可精確控制每一抽）。 */
const seq = (values: number[]): (() => number) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};

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

  // ---- B9 Task 1：苦力怕與蜘蛛的掉落（火藥／線／蜘蛛眼）----

  it('a creeper drops 0-2 gunpowder', () => {
    expect(rollMobDrops('creeper', fixed(0))).toEqual([]);
    expect(rollMobDrops('creeper', fixed(0.999))).toEqual([
      { item: 'gunpowder', count: 2 },
    ]);
  });

  it('a spider drops 0-2 string', () => {
    // rng 恆 0.999 → string 抽到上限 2；蜘蛛眼的機率抽樣（**同一個 rng 的下一次
    // 呼叫**）也是 0.999 > 1/3 → 不掉蜘蛛眼。
    expect(rollMobDrops('spider', fixed(0.999))).toEqual([
      { item: 'string', count: 2 },
    ]);
  });

  it('a spider drops a spider eye only when killed by the player', () => {
    // rng 恆 0.1：第一次抽樣給 string 的數量（0.1 → 0 顆）、第二次給蜘蛛眼的
    // 機率（0.1 < 1/3 → 掉 1 顆）。
    expect(rollMobDrops('spider', fixed(0.1), { killedByPlayer: true })).toEqual([
      { item: 'spider_eye', count: 1 },
    ]);
    // 非玩家死因（被爆炸炸死、燒死…）→ 蜘蛛眼不掉（string 剛好也抽到 0）。
    expect(rollMobDrops('spider', fixed(0.1), { killedByPlayer: false })).toEqual([]);
  });

  it('the string count and the spider eye are drawn separately', () => {
    // 抽樣順序固定：先 string 的數量、再蜘蛛眼的機率（1/3）。
    expect(rollMobDrops('spider', seq([0.9, 0.9]))).toEqual([
      { item: 'string', count: 2 },
    ]);
    expect(rollMobDrops('spider', seq([0.0, 0.0]))).toEqual([
      { item: 'spider_eye', count: 1 },
    ]);
  });

  it('the existing mob drop rows are unchanged', () => {
    // 新參數不影響既有生物：即使 killedByPlayer: false，殭屍仍掉同一份表
    //（原本的殭屍／骷髏／雞／豬／羊／牛斷言都留在上面，一字不改）。
    expect(rollMobDrops('zombie', fixed(0.999), { killedByPlayer: false })).toEqual([
      { item: 'rotten_flesh', count: 2 },
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

  // ---- B9 Task 8：死因旗標（蜘蛛眼只在玩家擊殺時掉）----
  it('a spider killed by an explosion drops string but never a spider eye', () => {
    const rng = () => 0.1; // string 0 顆、蜘蛛眼機率抽樣 0.1 < 1/3
    const byPlayer = dropsForDeaths([{ kind: 'spider', pos: { x: 0, y: 6, z: 0 } }], rng, {
      killedByPlayer: true,
    });
    expect(byPlayer.map((d) => d.item)).toEqual(['spider_eye']);
    const byExplosion = dropsForDeaths([{ kind: 'spider', pos: { x: 0, y: 6, z: 0 } }], rng, {
      killedByPlayer: false,
    });
    expect(byExplosion).toEqual([]);
  });

  it('a creeper drops gunpowder whatever the cause', () => {
    expect(
      dropsForDeaths([{ kind: 'creeper', pos: { x: 0, y: 6, z: 0 } }], () => 0.999, {
        killedByPlayer: false,
      }),
    ).toEqual([{ item: 'gunpowder', count: 2, pos: { x: 0, y: 6.9, z: 0 } }]);
  });
});
