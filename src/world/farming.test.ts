import { describe, it, expect } from 'vitest';
import { BLOCK } from './blocks';
import {
  WHEAT_STAGES,
  WHEAT_MAX_GROWTH_PER_TICK,
  WHEAT_MIN_LIGHT,
  WHEAT_WET_GROWTH_CHANCE,
  WHEAT_DRY_GROWTH_CHANCE,
  HOE_ITEM_IDS,
  isHoeItem,
  wheatStageOf,
  wheatBlockForStage,
  isWheatBlock,
  canTill,
  canPlantWheat,
  boneMealWheat,
  wasFarmlandHydrated,
  growWheatBatch,
  wheatHarvestFor,
  seedsFromShortGrass,
} from './farming';

const blockMap = (map: Record<string, number>) =>
  (x: number, y: number, z: number): number => map[`${x},${y},${z}`] ?? BLOCK.AIR;

describe('farming stage helpers', () => {
  it('pins the growth tuning constants', () => {
    expect(WHEAT_STAGES).toBe(4);
    expect(WHEAT_MIN_LIGHT).toBe(9);
    expect(WHEAT_WET_GROWTH_CHANCE).toBe(0.25);
    expect(WHEAT_DRY_GROWTH_CHANCE).toBe(0.1);
    expect(WHEAT_MAX_GROWTH_PER_TICK).toBe(64);
  });

  it('maps the four wheat blocks to stages 0..3 and back', () => {
    expect(wheatStageOf(BLOCK.WHEAT_0)).toBe(0);
    expect(wheatStageOf(BLOCK.WHEAT_1)).toBe(1);
    expect(wheatStageOf(BLOCK.WHEAT_2)).toBe(2);
    expect(wheatStageOf(BLOCK.WHEAT_3)).toBe(3);
    expect(wheatStageOf(BLOCK.FARMLAND)).toBeNull();
    expect(wheatStageOf(BLOCK.AIR)).toBeNull();
    expect(wheatBlockForStage(0)).toBe(BLOCK.WHEAT_0);
    expect(wheatBlockForStage(3)).toBe(BLOCK.WHEAT_3);
    expect(wheatBlockForStage(-1)).toBe(BLOCK.WHEAT_0);
    expect(wheatBlockForStage(99)).toBe(BLOCK.WHEAT_3);
    expect(isWheatBlock(BLOCK.WHEAT_2)).toBe(true);
    expect(isWheatBlock(BLOCK.FARMLAND)).toBe(false);
  });

  it('knows exactly the five hoe ids', () => {
    expect(HOE_ITEM_IDS).toEqual([
      'wooden_hoe', 'stone_hoe', 'iron_hoe', 'golden_hoe', 'diamond_hoe',
    ]);
    for (const id of HOE_ITEM_IDS) expect(isHoeItem(id)).toBe(true);
    expect(isHoeItem('wooden_shovel')).toBe(false);
    expect(isHoeItem(null)).toBe(false);
  });
});

describe('farming right-click rules', () => {
  it('tills only dirt/grass with air above and a hoe in hand', () => {
    expect(canTill('wooden_hoe', BLOCK.DIRT, BLOCK.AIR)).toBe(true);
    expect(canTill('diamond_hoe', BLOCK.GRASS, BLOCK.AIR)).toBe(true);
    expect(canTill('wooden_hoe', BLOCK.DIRT, BLOCK.WHEAT_0)).toBe(false);
    expect(canTill('wooden_hoe', BLOCK.STONE, BLOCK.AIR)).toBe(false);
    expect(canTill('wooden_shovel', BLOCK.DIRT, BLOCK.AIR)).toBe(false);
    expect(canTill('wooden_hoe', BLOCK.FARMLAND, BLOCK.AIR)).toBe(false);
  });

  it('plants seeds only on farmland with air above', () => {
    expect(canPlantWheat('wheat_seeds', BLOCK.FARMLAND, BLOCK.AIR)).toBe(true);
    expect(canPlantWheat('wheat_seeds', BLOCK.DIRT, BLOCK.AIR)).toBe(false);
    expect(canPlantWheat('wheat_seeds', BLOCK.FARMLAND, BLOCK.WHEAT_0)).toBe(false);
    expect(canPlantWheat('bread', BLOCK.FARMLAND, BLOCK.AIR)).toBe(false);
  });

  it('bone meal advances two stages and stops at mature', () => {
    expect(boneMealWheat('bone_meal', BLOCK.WHEAT_0)).toBe(BLOCK.WHEAT_2);
    expect(boneMealWheat('bone_meal', BLOCK.WHEAT_1)).toBe(BLOCK.WHEAT_3);
    expect(boneMealWheat('bone_meal', BLOCK.WHEAT_2)).toBe(BLOCK.WHEAT_3);
    expect(boneMealWheat('bone_meal', BLOCK.WHEAT_3)).toBeNull();
    expect(boneMealWheat('bone_meal', BLOCK.FARMLAND)).toBeNull();
    expect(boneMealWheat('wheat', BLOCK.WHEAT_0)).toBeNull();
  });
});

describe('farmland hydration', () => {
  it('counts water within 4 blocks horizontally and 1 vertically', () => {
    const at = (wx: number, wy: number, wz: number) =>
      wasFarmlandHydrated(blockMap({ [`${wx},${wy},${wz}`]: BLOCK.WATER }), 0, 64, 0);
    expect(at(4, 64, 0)).toBe(true);
    expect(at(-4, 64, 0)).toBe(true);
    expect(at(0, 64, -4)).toBe(true);
    expect(at(0, 65, 0)).toBe(true);
    expect(at(0, 63, 0)).toBe(true);
    expect(at(5, 64, 0)).toBe(false);
    expect(at(0, 66, 0)).toBe(false);
    expect(at(0, 62, 0)).toBe(false);
  });
});

describe('growWheatBatch', () => {
  const wetWorld = blockMap({ '0,63,0': BLOCK.FARMLAND, '4,63,0': BLOCK.WATER });
  const dryWorld = blockMap({ '0,63,0': BLOCK.FARMLAND });
  /** 任意 x/z、y=63 都是耕地；用來測多株輪替（沒有水 → 乾燥 10%）。 */
  const farmlandEverywhere = (_x: number, y: number, _z: number): number =>
    y === 63 ? BLOCK.FARMLAND : BLOCK.AIR;
  const entries: Array<readonly [string, number]> = [['0,64,0', BLOCK.WHEAT_0]];

  it('grows wet at <25% and dry at <10%', () => {
    expect(growWheatBatch({ entries, getBlock: wetWorld, lightAt: () => 9, rng: () => 0.24 }).updates)
      .toEqual([{ x: 0, y: 64, z: 0, from: BLOCK.WHEAT_0, to: BLOCK.WHEAT_1 }]);
    expect(growWheatBatch({ entries, getBlock: wetWorld, lightAt: () => 9, rng: () => 0.25 }).updates)
      .toEqual([]);
    expect(growWheatBatch({ entries, getBlock: dryWorld, lightAt: () => 9, rng: () => 0.09 }).updates)
      .toHaveLength(1);
    expect(growWheatBatch({ entries, getBlock: dryWorld, lightAt: () => 9, rng: () => 0.1 }).updates)
      .toEqual([]);
  });

  it('requires light 9, farmland below, and a non-mature stage', () => {
    expect(growWheatBatch({ entries, getBlock: wetWorld, lightAt: () => 8, rng: () => 0 }).updates).toEqual([]);
    expect(growWheatBatch({ entries, getBlock: dryWorld, lightAt: () => -1, rng: () => 0 }).updates).toEqual([]);
    const noFarm = blockMap({ '0,63,0': BLOCK.DIRT });
    expect(growWheatBatch({ entries, getBlock: noFarm, lightAt: () => 15, rng: () => 0 }).updates).toEqual([]);
    const mature: Array<readonly [string, number]> = [['0,64,0', BLOCK.WHEAT_3]];
    expect(growWheatBatch({ entries: mature, getBlock: dryWorld, lightAt: () => 15, rng: () => 0 }).updates).toEqual([]);
  });

  it('caps at 64 and rotates the cursor so every crop gets a turn', () => {
    const many: Array<readonly [string, number]> = Array.from({ length: 5 }, (_, i) =>
      [`${i},64,0`, BLOCK.WHEAT_0] as const,
    );
    const first = growWheatBatch({
      entries: many, getBlock: farmlandEverywhere, lightAt: () => 15, rng: () => 0, maxGrow: 2,
    });
    expect(first.updates.map((u) => u.x)).toEqual([0, 1]);
    expect(first.nextCursor).toBe(2);
    const second = growWheatBatch({
      entries: many, getBlock: farmlandEverywhere, lightAt: () => 15, rng: () => 0, maxGrow: 2, cursor: first.nextCursor,
    });
    expect(second.updates.map((u) => u.x)).toEqual([2, 3]);
    expect(second.nextCursor).toBe(4);
  });

  it('ignores malformed keys and non-wheat blocks', () => {
    const mixed: Array<readonly [string, number]> = [
      ['nope', BLOCK.WHEAT_0],
      ['x,1,2', BLOCK.WHEAT_0],
      ['1,64,1', BLOCK.FARMLAND],
      ['2,64,2', BLOCK.WHEAT_1],
    ];
    const r = growWheatBatch({ entries: mixed, getBlock: farmlandEverywhere, lightAt: () => 15, rng: () => 0 });
    expect(r.updates).toEqual([{ x: 2, y: 64, z: 2, from: BLOCK.WHEAT_1, to: BLOCK.WHEAT_2 }]);
  });
});

describe('wheat harvest', () => {
  it('mature wheat drops 1 wheat and 0..3 seeds', () => {
    expect(wheatHarvestFor(3, () => 0)).toEqual({ wheat: 1, seeds: 0 });
    expect(wheatHarvestFor(3, () => 0.999)).toEqual({ wheat: 1, seeds: 3 });
    expect(wheatHarvestFor(3, () => 0.5)).toEqual({ wheat: 1, seeds: 2 });
  });

  it('immature wheat drops one seed and no wheat', () => {
    for (const stage of [0, 1, 2]) expect(wheatHarvestFor(stage, () => 0.999)).toEqual({ wheat: 0, seeds: 1 });
    expect(wheatHarvestFor(Number.NaN, () => 0.999)).toEqual({ wheat: 0, seeds: 1 });
  });

  it('short grass seeds are a 12.5% roll', () => {
    expect(seedsFromShortGrass(() => 0.124)).toBe(1);
    expect(seedsFromShortGrass(() => 0.125)).toBe(0);
    expect(seedsFromShortGrass(() => Number.NaN)).toBe(0);
  });
});
