import { describe, it, expect } from 'vitest';
import {
  getBreakTime,
  canHarvest,
  DigProgress,
  canPlaceAt,
  placeTarget,
  isReplaceableForPlacement,
  resolvePlacementTarget,
  spawnBlockDrop,
  toolSpeed,
  digStep,
  toolDamage,
  hitMobId,
  attackMob,
} from './interact';
import { BLOCK } from '../world/blocks';
import type { ItemId } from '../core/items';
import { createMob, isDead, KNOCKBACK_SPEED, type Mob } from '../world/mobs';
import { World } from '../world/world';
import { Chunk } from '../world/chunk';
import type { RayHit } from '../world/raycast';
import { PLAYER_HEIGHT } from './physics';
import type { DropEntity } from '../world/drops';

describe('getBreakTime (Task 5: hardness × (harvestable ? 1.5 : 5) ÷ tool speed)', () => {
  const woodenPick = { item: 'wooden_pickaxe', count: 1 } as const;
  const stonePick = { item: 'stone_pickaxe', count: 1 } as const;
  const ironPick = { item: 'iron_pickaxe', count: 1 } as const;

  it('stone: bare hand 7.5s, wooden pickaxe 1.125s, iron pickaxe 0.375s', () => {
    expect(getBreakTime(BLOCK.STONE, null)).toBe(7.5);
    expect(getBreakTime(BLOCK.STONE, woodenPick)).toBe(1.125);
    expect(getBreakTime(BLOCK.STONE, ironPick)).toBe(0.375);
  });

  it('iron_ore: wooden pickaxe 7.5s (kind matches, tier gate fails → ×5, 2× speed), stone pickaxe 1.125s', () => {
    expect(getBreakTime(BLOCK.IRON_ORE, woodenPick)).toBe(7.5);
    expect(getBreakTime(BLOCK.IRON_ORE, stonePick)).toBe(1.125);
  });

  it('no tool required → ×1.5 harvest rate: dirt 0.75s, oak_log 3.0s bare-handed', () => {
    expect(getBreakTime(BLOCK.DIRT, null)).toBe(0.75);
    expect(getBreakTime(BLOCK.LOG, null)).toBe(3.0);
  });

  it('oak_log with a wooden axe: 1.5s', () => {
    expect(getBreakTime(BLOCK.LOG, { item: 'wooden_axe', count: 1 })).toBe(1.5);
  });

  it('glass bare-handed: 0.45s (no fast tool entry → speed 1)', () => {
    // 0.3 is not exactly representable, so the formula lands one ulp below 0.45
    expect(getBreakTime(BLOCK.GLASS, null)).toBeCloseTo(0.45, 10);
  });

  it('a wrong-tier tool pays the x5 penalty and drops nothing', () => {
    // 金礦硬度 3.0：鐵鎬（6×）可收穫 → 3.0 × 1.5 / 6 = 0.75s
    expect(getBreakTime(BLOCK.GOLD_ORE, { item: 'iron_pickaxe', count: 1 })).toBeCloseTo(0.75, 6);
    // 石鎬不可收穫 → 3.0 × 5 / 4 = 3.75s
    expect(getBreakTime(BLOCK.GOLD_ORE, { item: 'stone_pickaxe', count: 1 })).toBeCloseTo(3.75, 6);
    // 鑽鎬 8× → 3.0 × 1.5 / 8 = 0.5625s；金鎬（12×，但等級 0 不可收穫）→ 3.0 × 5 / 12 = 1.25s
    expect(getBreakTime(BLOCK.DIAMOND_ORE, { item: 'diamond_pickaxe', count: 1 })).toBeCloseTo(0.5625, 6);
    expect(getBreakTime(BLOCK.DIAMOND_ORE, { item: 'golden_pickaxe', count: 1 })).toBeCloseTo(1.25, 6);
  });

  it('bedrock and water are unbreakable with and without tools', () => {
    expect(getBreakTime(BLOCK.BEDROCK, null)).toBe(Infinity);
    expect(getBreakTime(BLOCK.BEDROCK, ironPick)).toBe(Infinity);
    expect(getBreakTime(BLOCK.WATER, null)).toBe(Infinity);
    expect(getBreakTime(BLOCK.WATER, woodenPick)).toBe(Infinity);
  });
});

describe('canHarvest (Task 5 pickaxe tier gate — Task 6 drop gate)', () => {
  const woodenPick = { item: 'wooden_pickaxe', count: 1 } as const;
  const stonePick = { item: 'stone_pickaxe', count: 1 } as const;
  const ironPick = { item: 'iron_pickaxe', count: 1 } as const;

  it('stone family needs a pickaxe of level ≥ 0: bare hand/dirt/sword/axe are all false', () => {
    expect(canHarvest(BLOCK.STONE, null)).toBe(false);
    expect(canHarvest(BLOCK.STONE, { item: 'dirt', count: 1 })).toBe(false);
    expect(canHarvest(BLOCK.STONE, { item: 'wooden_sword', count: 1 })).toBe(false);
    expect(canHarvest(BLOCK.STONE, { item: 'iron_axe', count: 1 })).toBe(false); // wrong kind
    expect(canHarvest(BLOCK.STONE, woodenPick)).toBe(true);
  });

  it('iron_ore needs level ≥ 1: wooden pickaxe false, stone/iron pickaxe true', () => {
    expect(canHarvest(BLOCK.IRON_ORE, woodenPick)).toBe(false);
    expect(canHarvest(BLOCK.IRON_ORE, stonePick)).toBe(true);
    expect(canHarvest(BLOCK.IRON_ORE, ironPick)).toBe(true);
  });

  it('blocks without a tool requirement are always harvestable (dirt, oak_log — bare-handed too)', () => {
    expect(canHarvest(BLOCK.DIRT, null)).toBe(true);
    expect(canHarvest(BLOCK.LOG, null)).toBe(true);
    expect(canHarvest(BLOCK.LEAVES, null)).toBe(true);
    expect(canHarvest(BLOCK.GLASS, null)).toBe(true);
  });

  it('the harvest tiers follow the vanilla table', () => {
    expect(canHarvest(BLOCK.GOLD_ORE, { item: 'iron_pickaxe', count: 1 })).toBe(true);
    expect(canHarvest(BLOCK.GOLD_ORE, { item: 'diamond_pickaxe', count: 1 })).toBe(true);
    expect(canHarvest(BLOCK.GOLD_ORE, { item: 'stone_pickaxe', count: 1 })).toBe(false);
    expect(canHarvest(BLOCK.GOLD_ORE, { item: 'golden_pickaxe', count: 1 })).toBe(false);
    expect(canHarvest(BLOCK.DIAMOND_ORE, { item: 'iron_pickaxe', count: 1 })).toBe(true);
    expect(canHarvest(BLOCK.DIAMOND_ORE, { item: 'stone_pickaxe', count: 1 })).toBe(false);
    // 既有門檻不得被破壞
    expect(canHarvest(BLOCK.IRON_ORE, { item: 'stone_pickaxe', count: 1 })).toBe(true);
    expect(canHarvest(BLOCK.IRON_ORE, { item: 'wooden_pickaxe', count: 1 })).toBe(false);
    expect(canHarvest(BLOCK.STONE, { item: 'wooden_pickaxe', count: 1 })).toBe(true);
  });
});

describe('DigProgress (per-frame: dt ÷ breakTimeSec — real seconds into a 0..1 bar)', () => {
  const hit: RayHit = { x: 0, y: 64, z: 0, nx: 0, ny: 1, nz: 0, t: 0 };
  // stone + wooden pickaxe: getBreakTime === 1.125s REAL seconds (speed 2 already
  // applied inside it). Every 0.28125s update is therefore 0.28125 / 1.125 = 25%.

  it('progress accumulates while target unchanged, then completes exactly on the break time', () => {
    const d = new DigProgress();
    d.update(BLOCK.STONE, hit, 0.28125, 1.125); // 0.28125 / 1.125 = 25%
    expect(d.progress).toBeCloseTo(0.25, 5);
    d.update(BLOCK.STONE, hit, 0.28125, 1.125);
    d.update(BLOCK.STONE, hit, 0.28125, 1.125);
    expect(d.progress).toBeCloseTo(0.75, 5);
    expect(d.isDone(BLOCK.STONE, 1.125)).toBe(false); // not before the full break time
    d.update(BLOCK.STONE, hit, 0.28125, 1.125);
    expect(d.progress).toBe(1); // exact boundary: 4 × 0.28125 = 1.125s of dt
    expect(d.isDone(BLOCK.STONE, 1.125)).toBe(true);
  });

  it('fills from the break time alone: the same dt is far slower bare-handed (7.5s) than with the tool (1.125s)', () => {
    const bare = new DigProgress();
    bare.update(BLOCK.STONE, hit, 0.28125, 7.5); // 0.28125 / 7.5 = 3.75%
    expect(bare.progress).toBeCloseTo(0.0375, 5);
    const tool = new DigProgress();
    tool.update(BLOCK.STONE, hit, 0.28125, 1.125); // 0.28125 / 1.125 = 25%
    expect(tool.progress).toBeCloseTo(0.25, 5);
  });

  it('resets when target changes', () => {
    const d = new DigProgress();
    d.update(BLOCK.STONE, hit, 0.28125, 1.125);
    d.update(BLOCK.STONE, hit, 0.28125, 1.125); // 50% on the original target
    d.update(BLOCK.STONE, { ...hit, x: 1 }, 0.28125, 1.125);
    expect(d.progress).toBeCloseTo(0.25, 5); // 重新起算，不是 0.75
  });

  it('reset clears progress', () => {
    const d = new DigProgress();
    d.update(BLOCK.DIRT, hit, 0.5, 0.75); // dirt bare-handed: 0.75s
    d.reset();
    expect(d.progress).toBe(0);
  });

  it('resets when target moves from negative coordinates', () => {
    const d = new DigProgress();
    d.update(BLOCK.STONE, { ...hit, x: -1 }, 1, 7.5);
    expect(d.progress).toBeCloseTo(1 / 7.5, 5);
    d.update(BLOCK.STONE, hit, 0.075, 7.5);
    expect(d.progress).toBeCloseTo(0.01, 5); // 重新起算，不是 0.13+
  });

  it('a NaN break time never accumulates (the finiteness guard covers NaN, not just Infinity)', () => {
    const d = new DigProgress();
    d.update(BLOCK.STONE, hit, 1, Number.NaN);
    expect(d.progress).toBe(0); // no NaN poisons the bar
    expect(d.isDone(BLOCK.STONE, Number.NaN)).toBe(false);
  });

  it('non-finite break time never accumulates (bedrock/water)', () => {
    const d = new DigProgress();
    expect(d.isDone(BLOCK.STONE, 1.125)).toBe(false); // no update yet
    d.update(BLOCK.BEDROCK, hit, 100, Infinity);
    expect(d.progress).toBe(0);
    expect(d.isDone(BLOCK.BEDROCK, Infinity)).toBe(false);
  });

  it('isDone is false for a different block than the one being dug', () => {
    const d = new DigProgress();
    d.update(BLOCK.STONE, hit, 1.125, 1.125); // exactly the 1.125s break time
    expect(d.progress).toBe(1);
    expect(d.isDone(BLOCK.STONE, 1.125)).toBe(true);
    expect(d.isDone(BLOCK.COBBLE, 1.125)).toBe(false); // the key belongs to stone
  });
});

describe('toolSpeed (Task 5 vanilla tool tiers: wood 2 / stone 4 / iron 6)', () => {
  const held = (item: ItemId) => ({ item, count: 1 }) as const;

  it('pickaxe on the stone family: 2/4/6 (iron_ore included — speed is independent of the tier gate)', () => {
    const tiers = [
      ['wooden_pickaxe', 2],
      ['stone_pickaxe', 4],
      ['iron_pickaxe', 6],
    ] as const;
    for (const [item, speed] of tiers) {
      for (const id of [BLOCK.STONE, BLOCK.COBBLE, BLOCK.COAL_ORE, BLOCK.IRON_ORE]) {
        expect(toolSpeed(id, held(item))).toBe(speed);
      }
    }
  });

  it('axe on oak_log: 2/4/6', () => {
    expect(toolSpeed(BLOCK.LOG, held('wooden_axe'))).toBe(2);
    expect(toolSpeed(BLOCK.LOG, held('stone_axe'))).toBe(4);
    expect(toolSpeed(BLOCK.LOG, held('iron_axe'))).toBe(6);
  });

  it('the crafting table is axe-fast; the furnace is pickaxe-fast (vanilla 1.20)', () => {
    expect(toolSpeed(BLOCK.PLANKS, held('stone_axe'))).toBe(4);
    expect(toolSpeed(BLOCK.CRAFTING_TABLE, held('wooden_axe'))).toBe(2);
    expect(toolSpeed(BLOCK.FURNACE, held('iron_pickaxe'))).toBe(6);
    expect(toolSpeed(BLOCK.FURNACE, held('iron_axe'))).toBe(1); // wrong kind
  });

  it('wrong kind is 1× (pickaxe on a log, axe on stone)', () => {
    expect(toolSpeed(BLOCK.LOG, held('iron_pickaxe'))).toBe(1);
    expect(toolSpeed(BLOCK.STONE, held('iron_axe'))).toBe(1);
    expect(toolSpeed(BLOCK.IRON_ORE, held('stone_axe'))).toBe(1);
  });

  it('bare hand, non-tools and swords: 1× (a sword is not a tool)', () => {
    expect(toolSpeed(BLOCK.STONE, null)).toBe(1);
    expect(toolSpeed(BLOCK.LOG, null)).toBe(1);
    expect(toolSpeed(BLOCK.STONE, held('wooden_sword'))).toBe(1);
    expect(toolSpeed(BLOCK.LOG, held('iron_sword'))).toBe(1);
    expect(toolSpeed(BLOCK.STONE, held('dirt'))).toBe(1);
  });

  it('tool speed covers every tier including gold and diamond', () => {
    // 鎬 × 石頭（石頭的 requiredTool.kind = 'pickaxe'）
    const picks: Array<[ItemId, number]> = [
      ['wooden_pickaxe', 2], ['stone_pickaxe', 4], ['iron_pickaxe', 6], ['golden_pickaxe', 12], ['diamond_pickaxe', 8],
    ];
    for (const [item, speed] of picks) {
      expect(toolSpeed(BLOCK.STONE, { item, count: 1 })).toBe(speed);
    }
    // 斧 × 原木（原木的 fastTool = 'axe'）
    const axes: Array<[ItemId, number]> = [
      ['wooden_axe', 2], ['stone_axe', 4], ['iron_axe', 6], ['golden_axe', 12], ['diamond_axe', 8],
    ];
    for (const [item, speed] of axes) {
      expect(toolSpeed(BLOCK.LOG, { item, count: 1 })).toBe(speed);
    }
    // 鏟 × 泥土（泥土的 fastTool = 'shovel'）
    const shovels: Array<[ItemId, number]> = [
      ['wooden_shovel', 2], ['stone_shovel', 4], ['iron_shovel', 6], ['golden_shovel', 12], ['diamond_shovel', 8],
    ];
    for (const [item, speed] of shovels) {
      expect(toolSpeed(BLOCK.DIRT, { item, count: 1 })).toBe(speed);
    }
  });

  it('shovels finally mine the soil blocks fast', () => {
    expect(toolSpeed(BLOCK.DIRT, { item: 'wooden_shovel', count: 1 })).toBe(2);
    expect(toolSpeed(BLOCK.SAND, { item: 'iron_shovel', count: 1 })).toBe(6);
    expect(getBreakTime(BLOCK.DIRT, { item: 'iron_shovel', count: 1 })).toBeCloseTo(0.5 * 1.5 / 6, 6);
  });

  it('unbreakable blocks report 1× (the gating lives in the break time, not here)', () => {
    expect(toolSpeed(BLOCK.BEDROCK, null)).toBe(1);
    expect(toolSpeed(BLOCK.BEDROCK, held('iron_pickaxe'))).toBe(1);
    expect(toolSpeed(BLOCK.WATER, held('wooden_axe'))).toBe(1);
  });
});

describe('digStep (Task 5: creative instant, survival from the held stack)', () => {
  const hit: RayHit = { x: 0, y: 64, z: 0, nx: 0, ny: 1, nz: 0, t: 0 };
  const woodenPick = { item: 'wooden_pickaxe', count: 1 } as const;

  it('creative breaks in one step with no progress accumulation', () => {
    const d = new DigProgress();
    expect(digStep('creative', d, BLOCK.STONE, hit, 1 / 60, null)).toBe(true);
    expect(d.progress).toBe(0); // the timer never runs in creative
  });

  it('creative resets any leftover survival progress', () => {
    const d = new DigProgress();
    d.update(BLOCK.STONE, hit, 1, 7.5); // bare-handed survival dig, 1 / 7.5 ≈ 13%
    expect(d.progress).toBeCloseTo(1 / 7.5, 5);
    expect(digStep('creative', d, BLOCK.STONE, hit, 1 / 60, woodenPick)).toBe(true);
    expect(d.progress).toBe(0);
  });

  it('creative still respects the unbreakable list (bedrock, water)', () => {
    const d = new DigProgress();
    expect(digStep('creative', d, BLOCK.BEDROCK, hit, 1, null)).toBe(false);
    expect(digStep('creative', d, BLOCK.WATER, hit, 1, null)).toBe(false);
  });

  it('survival is false until the held stack\'s break time elapses (dirt bare-handed: 0.75s)', () => {
    const d = new DigProgress();
    expect(digStep('survival', d, BLOCK.DIRT, hit, 0.1, null)).toBe(false);
    expect(d.progress).toBeCloseTo(0.1 / 0.75, 5);
    expect(digStep('survival', d, BLOCK.DIRT, hit, 0.7, null)).toBe(true); // 0.1 + 0.7 > 0.75
  });

  it('survival takes the full 1.125s of accumulated dt for stone + wooden pickaxe (real seconds, no extra speed factor)', () => {
    const d = new DigProgress();
    expect(digStep('survival', d, BLOCK.STONE, hit, 0.28125, woodenPick)).toBe(false); // 25%
    expect(d.progress).toBeCloseTo(0.25, 5);
    // 0.5625s in: a second ×2 speed application would have finished here
    expect(digStep('survival', d, BLOCK.STONE, hit, 0.28125, woodenPick)).toBe(false);
    expect(d.progress).toBeCloseTo(0.5, 5);
    expect(digStep('survival', d, BLOCK.STONE, hit, 0.28125, woodenPick)).toBe(false); // 75%
    expect(digStep('survival', d, BLOCK.STONE, hit, 0.28125, woodenPick)).toBe(true); // 1.125s total
  });

  it('survival honours the tier gate through the same held stack (iron_ore + wooden pickaxe = the full 7.5s)', () => {
    const d = new DigProgress();
    // real seconds: 3.75s of digging is half of the 7.5s ×5-gate break time
    // (the old double-speed bug would have broken the block right here)
    expect(digStep('survival', d, BLOCK.IRON_ORE, hit, 3.75, woodenPick)).toBe(false);
    expect(d.progress).toBeCloseTo(0.5, 5);
    expect(digStep('survival', d, BLOCK.IRON_ORE, hit, 3.75, woodenPick)).toBe(true); // 7.5s total
    const withStonePick = new DigProgress();
    expect(digStep('survival', withStonePick, BLOCK.IRON_ORE, hit, 1.125, { item: 'stone_pickaxe', count: 1 })).toBe(true);
  });

  it('survival bedrock/water never break and never accumulate', () => {
    const d = new DigProgress();
    expect(digStep('survival', d, BLOCK.BEDROCK, hit, 100, { item: 'iron_pickaxe', count: 1 })).toBe(false);
    expect(digStep('survival', d, BLOCK.WATER, hit, 100, null)).toBe(false);
    expect(d.progress).toBe(0);
  });
});

describe('placeTarget', () => {
  it('returns neighbor cell on hit face', () => {
    const hit: RayHit = { x: 5, y: 64, z: 5, nx: 0, ny: 1, nz: 0, t: 0 };
    expect(placeTarget(hit)).toEqual({ x: 5, y: 65, z: 5 });
    const hit2: RayHit = { x: 5, y: 64, z: 5, nx: -1, ny: 0, nz: 0, t: 0 };
    expect(placeTarget(hit2)).toEqual({ x: 4, y: 64, z: 5 });
  });
});

/**
 * B3 Task 9（承接 Task 5 審查 Important I-1 的**接線層**）：放置目標的新語意。
 *
 * 原版（minecraft.wiki/Block#canBeReplaced）：「點到的方塊若可被取代，新方塊就
 * **取代同一格**；不可取代才放在命中面外側」→ 植被（花／草）可被取代 → 瞄準花
 * 右鍵放方塊＝**花被方塊取代、位置不變**（不是「花旁邊多一塊」）。
 *
 * 這裡的兩支新匯出把**規則**（純函式）與**世界讀取**（組裝根 `main.ts`）分開：
 * 規則住在 `interact.ts`（可單元測試），`main.ts` 只負責把 `world.getBlock()`
 * 的結果餵進來。
 */
describe('isReplaceableForPlacement（可被取代的方塊：與 canPlaceAt 共用同一份規則）', () => {
  it('air, water and cross vegetation are replaceable', () => {
    expect(isReplaceableForPlacement(BLOCK.AIR)).toBe(true);
    expect(isReplaceableForPlacement(BLOCK.WATER)).toBe(true);
    expect(isReplaceableForPlacement(BLOCK.DANDELION)).toBe(true);
    expect(isReplaceableForPlacement(BLOCK.POPPY)).toBe(true);
    expect(isReplaceableForPlacement(BLOCK.SHORT_GRASS)).toBe(true);
  });

  it('every solid block is NOT replaceable (including cactus and ice)', () => {
    for (const id of [
      BLOCK.STONE,
      BLOCK.DIRT,
      BLOCK.GRASS,
      BLOCK.SAND,
      BLOCK.LOG,
      BLOCK.LEAVES,
      BLOCK.PLANKS,
      BLOCK.COBBLE,
      BLOCK.BEDROCK,
      BLOCK.SNOW,
      BLOCK.GLASS,
      BLOCK.COAL_ORE,
      BLOCK.IRON_ORE,
      BLOCK.CRAFTING_TABLE,
      BLOCK.FURNACE,
      BLOCK.SPRUCE_LOG,
      BLOCK.SPRUCE_LEAVES,
      BLOCK.BIRCH_LOG,
      BLOCK.BIRCH_LEAVES,
      BLOCK.CACTUS,
      BLOCK.ICE,
    ]) {
      expect(isReplaceableForPlacement(id), `block ${id}`).toBe(false);
    }
  });

  it('the predicate is exactly what canPlaceAt allows (one rule, two call sites)', () => {
    // **逐格比對**：把每一種方塊放進目標格，再問 canPlaceAt 放不放手。
    // 玩家站得遠遠的 → 只剩「那一格可不可被取代」這條規則在作用。
    // 這條斷言就是「目標格的判定與 canPlaceAt 的放行條件必須一致」的守門員。
    const world = new World();
    world.addChunk(new Chunk(0, 0));
    const far = { x: 100.5, y: 100, z: 100.5 };
    for (const id of Object.values(BLOCK)) {
      world.setBlock(5, 70, 5, id);
      expect(canPlaceAt(world, 5, 70, 5, far), `block ${id}`).toBe(
        isReplaceableForPlacement(id),
      );
    }
  });
});

describe('resolvePlacementTarget（B3 Task 9：可被取代的目標格 → 放進同一格）', () => {
  const hit: RayHit = { x: 5, y: 64, z: 5, nx: 0, ny: 1, nz: 0, t: 0 };

  it('a cross plant takes the new block into that very cell (the plant is replaced)', () => {
    expect(resolvePlacementTarget(hit, BLOCK.DANDELION)).toEqual({ x: 5, y: 64, z: 5 });
    expect(resolvePlacementTarget(hit, BLOCK.POPPY)).toEqual({ x: 5, y: 64, z: 5 });
    expect(resolvePlacementTarget(hit, BLOCK.SHORT_GRASS)).toEqual({ x: 5, y: 64, z: 5 });
  });

  it('air and water hit cells also take the new block into that very cell', () => {
    expect(resolvePlacementTarget(hit, BLOCK.AIR)).toEqual({ x: 5, y: 64, z: 5 });
    expect(resolvePlacementTarget(hit, BLOCK.WATER)).toEqual({ x: 5, y: 64, z: 5 });
  });

  it('a solid hit cell keeps the face-adjacent neighbour (existing behaviour unchanged)', () => {
    expect(resolvePlacementTarget(hit, BLOCK.STONE)).toEqual({ x: 5, y: 65, z: 5 });
    const side: RayHit = { x: 5, y: 64, z: 5, nx: -1, ny: 0, nz: 0, t: 0 };
    expect(resolvePlacementTarget(side, BLOCK.STONE)).toEqual({ x: 4, y: 64, z: 5 });
  });

  it('the replaced cell still goes through the player AABB rule (standing in a flower blocks it)', () => {
    // 站在花格裡放方塊 → 目標格就是腳下那一格 → 玩家 AABB 與它重疊 → 放不下。
    // **AABB 規則不放寬**（與原版一致：原版也拒絕把方塊放進與玩家 AABB 相交的格子）。
    const world = new World();
    world.addChunk(new Chunk(0, 0));
    world.setBlock(5, 64, 5, BLOCK.DANDELION);
    const flowerHit: RayHit = { x: 5, y: 64, z: 5, nx: 0, ny: -1, nz: 0, t: 0 };
    const target = resolvePlacementTarget(flowerHit, world.getBlock(flowerHit.x, flowerHit.y, flowerHit.z));
    expect(target).toEqual({ x: 5, y: 64, z: 5 });
    expect(canPlaceAt(world, target.x, target.y, target.z, { x: 5.5, y: 64, z: 5.5 })).toBe(false);
    // 站遠一點就放得下（目標格本身沒有別的阻擋）
    expect(canPlaceAt(world, target.x, target.y, target.z, { x: 9.5, y: 64, z: 9.5 })).toBe(true);
  });
});

describe('canPlaceAt', () => {
  function w(): World {
    const world = new World();
    world.addChunk(new Chunk(0, 0));
    return world;
  }

  it('true for empty cell', () => {
    expect(canPlaceAt(w(), 5, 70, 5, { x: 5.5, y: 65, z: 5.5 })).toBe(true);
  });

  it('false when cell occupied by solid', () => {
    const world = w();
    world.setBlock(5, 70, 5, BLOCK.STONE);
    expect(canPlaceAt(world, 5, 70, 5, { x: 5.5, y: 65, z: 5.5 })).toBe(false);
  });

  it('false when overlapping player box', () => {
    // 玩家站在 (5.5, 65, 5.5) → 身體佔 5,65,5 與 5,66,5
    expect(canPlaceAt(w(), 5, 65, 5, { x: 5.5, y: 65, z: 5.5 })).toBe(false);
    expect(canPlaceAt(w(), 5, 66, 5, { x: 5.5, y: 65, z: 5.5 })).toBe(false);
  });

  it('true for water cell (replaceable)', () => {
    const world = w();
    world.setBlock(5, 70, 5, BLOCK.WATER);
    expect(canPlaceAt(world, 5, 70, 5, { x: 5.5, y: 65, z: 5.5 })).toBe(true);
  });

  it('touch-only: top exactly on cell floor allowed, one-px overlap denied', () => {
    const targetY = 65;
    const feet = targetY - PLAYER_HEIGHT; // pMaxY === targetY，僅貼齊
    expect(canPlaceAt(w(), 5, targetY, 5, { x: 5.5, y: feet, z: 5.5 })).toBe(true);
    // 1/16 block（一 px）侵入 → 重疊
    expect(canPlaceAt(w(), 5, targetY, 5, { x: 5.5, y: feet + 1 / 16, z: 5.5 })).toBe(false);
  });
});

describe('spawnBlockDrop (Task 7 + Task 6 harvest gate)', () => {
  const at = { x: 5.5, y: 70.5, z: 5.5 }; // block centre = break pos + 0.5
  const woodenPick = { item: 'wooden_pickaxe', count: 1 } as const;
  const stonePick = { item: 'stone_pickaxe', count: 1 } as const;

  it('survival spawns 1× the block item at the given position', () => {
    const drops = spawnBlockDrop([], 'survival', BLOCK.DIRT, at, null);
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({
      item: 'dirt',
      count: 1,
      pos: at,
      pickupDelay: 0.5,
      age: 0,
    });
  });

  it('bare hands cannot harvest stone (no drop, same ref); wooden pickaxe drops cobblestone', () => {
    const base = spawnBlockDrop([], 'survival', BLOCK.DIRT, at, null); // non-empty base
    const bare = spawnBlockDrop(base, 'survival', BLOCK.STONE, at, null);
    expect(bare).toBe(base); // same ref — not merely an empty result
    const picked = spawnBlockDrop([], 'survival', BLOCK.STONE, at, woodenPick);
    expect(picked).toHaveLength(1);
    expect(picked[0]).toMatchObject({ item: 'cobblestone', count: 1 });
  });

  it('iron_ore needs stone tier: wooden pick same ref (no drop), stone pick drops raw_iron', () => {
    const existing = spawnBlockDrop([], 'survival', BLOCK.STONE, at, woodenPick); // non-empty base
    expect(spawnBlockDrop(existing, 'survival', BLOCK.IRON_ORE, at, woodenPick)).toBe(existing);
    const got = spawnBlockDrop([], 'survival', BLOCK.IRON_ORE, at, stonePick);
    expect(got).toHaveLength(1);
    expect(got[0].item).toBe('raw_iron');
  });

  it('spawns nothing in creative (infinite supply, no world drops)', () => {
    // Assert against a NON-empty array: a `return []` bug here would wipe every
    // live drop on each creative break — same-ref is the real contract.
    const existing = spawnBlockDrop([], 'survival', BLOCK.STONE, at, woodenPick);
    expect(spawnBlockDrop(existing, 'creative', BLOCK.STONE, at, null)).toBe(existing);
    expect(spawnBlockDrop(existing, 'creative', BLOCK.DIRT, at, null)).toBe(existing);
    expect(existing).toHaveLength(1); // input left intact
  });

  it('adds nothing for blocks without an item form (air, water)', () => {
    const existing = spawnBlockDrop([], 'survival', BLOCK.DIRT, at, null);
    expect(spawnBlockDrop(existing, 'survival', BLOCK.AIR, at, null)).toBe(existing);
    expect(spawnBlockDrop(existing, 'survival', BLOCK.WATER, at, null)).toBe(existing);
    expect(existing).toHaveLength(1);
  });

  it('coal_ore drops coal with the wooden pickaxe (tier 0 gate)', () => {
    expect(spawnBlockDrop([], 'survival', BLOCK.COAL_ORE, at, woodenPick)[0].item).toBe('coal');
  });

  it('appends to existing drops without mutating the input array', () => {
    const first = spawnBlockDrop([], 'survival', BLOCK.DIRT, at, null);
    const second = spawnBlockDrop(first, 'survival', BLOCK.STONE, at, woodenPick);
    expect(first).toHaveLength(1); // input untouched
    expect(second).toHaveLength(2);
    expect(second[0]).toBe(first[0]); // existing entities kept as-is
    expect(second[1].id).not.toBe(second[0].id);
  });
});

// ---- B4 Task 4：機率掉落（樹葉 0.5% 蘋果） ------------------------------
describe('spawnBlockDrop 的機率掉落（B4 Task 4）', () => {
  const at = { x: 1, y: 2, z: 3 };
  const woodenPick = { item: 'wooden_pickaxe', count: 1 } as const;

  it('breaking leaves can drop an apple', () => {
    // 樹葉本體不掉（B1.6 起 `dropItemFor` 回 null）→ 這 1 筆只能是機率掉的蘋果。
    // 機率掉落**不受** `dropItemFor` 回 null 影響，但仍受創造模式與收穫門檻約束
    // （樹葉的 `requiredTool` 是 null → 徒手也能收穫）。
    const drops = spawnBlockDrop([], 'survival', BLOCK.LEAVES, at, null, () => 0.001);
    expect(drops).toHaveLength(1);
    expect(drops[0].item).toBe('apple');
    expect(drops[0].count).toBe(1);
  });

  it('breaking leaves usually drops nothing', () => {
    const input: DropEntity[] = [];
    const drops = spawnBlockDrop(input, 'survival', BLOCK.LEAVES, at, null, () => 0.5);
    expect(drops).toHaveLength(0);
    expect(drops).toBe(input); // 沒有東西掉落 → 回傳同一參考（既有契約）
  });

  it('creative mode never drops the lucky apple', () => {
    // 機率掉落也受創造模式門檻約束（創造模式無限供應 → 不產生任何掉落）
    const drops = spawnBlockDrop([], 'creative', BLOCK.LEAVES, at, null, () => 0);
    expect(drops).toHaveLength(0);
  });

  it('the lucky apple does not replace the normal drop', () => {
    // 石頭沒有機率掉落 → 照舊只掉 1 顆圓石。
    // **持有工具**：石頭要木鎬才收得到（既有收穫門檻案例不動）→ 這裡帶木鎬，
    // 否則「正常的圓石掉落」這件事根本不會發生（徒手挖石頭＝不掉）。
    const drops = spawnBlockDrop([], 'survival', BLOCK.STONE, at, woodenPick, () => 0);
    expect(drops).toHaveLength(1);
    expect(drops[0].item).toBe('cobblestone');
  });
});

describe('toolDamage (Task 9 melee damage table)', () => {
  it('bare hand deals 1', () => {
    expect(toolDamage(null)).toBe(1);
  });

  it('sword damage matches vanilla', () => {
    expect(toolDamage('wooden_sword')).toBe(4);
    expect(toolDamage('stone_sword')).toBe(5);
    expect(toolDamage('iron_sword')).toBe(6);
    expect(toolDamage('golden_sword')).toBe(4);
    expect(toolDamage('diamond_sword')).toBe(7);
  });

  it('pickaxe damage matches vanilla', () => {
    expect(toolDamage('wooden_pickaxe')).toBe(2);
    expect(toolDamage('stone_pickaxe')).toBe(3);
    expect(toolDamage('iron_pickaxe')).toBe(4);
    expect(toolDamage('golden_pickaxe')).toBe(2);
    expect(toolDamage('diamond_pickaxe')).toBe(5);
  });

  it('axe damage matches vanilla', () => {
    expect(toolDamage('wooden_axe')).toBe(7);
    expect(toolDamage('stone_axe')).toBe(9);
    expect(toolDamage('iron_axe')).toBe(9);
    expect(toolDamage('golden_axe')).toBe(7);
    expect(toolDamage('diamond_axe')).toBe(9);
  });

  it('shovel damage matches vanilla', () => {
    expect(toolDamage('wooden_shovel')).toBe(2.5);
    expect(toolDamage('stone_shovel')).toBe(3.5);
    expect(toolDamage('iron_shovel')).toBe(4.5);
    expect(toolDamage('golden_shovel')).toBe(2.5);
    expect(toolDamage('diamond_shovel')).toBe(5.5);
  });

  it('non-weapons (apple, stick, blocks) fall back to 1', () => {
    expect(toolDamage('apple')).toBe(1);
    expect(toolDamage('stick')).toBe(1);
    expect(toolDamage('dirt')).toBe(1);
  });
});

describe('hitMobId / attackMob (Task 9 ray → mob hitbox)', () => {
  // Ray marches -z at eye height; mob boxes are ±0.35 in X/Z, y..y+1.8.
  const eye = { x: 0, y: 1, z: 0 };
  const FWD = { x: 0, y: 0, z: -1 };
  const REACH = 4.5;

  it('hits a mob directly ahead within reach', () => {
    const m = createMob('zombie', { x: 0, y: 0, z: -3 });
    expect(hitMobId([m], eye, FWD, REACH)).toBe(m.id);
  });

  it('hits from the side and from behind (box entry along +x / +z)', () => {
    const side = createMob('zombie', { x: 3, y: 0, z: 0 });
    expect(hitMobId([side], eye, { x: 1, y: 0, z: 0 }, REACH)).toBe(side.id);
    const back = createMob('skeleton', { x: 0, y: 0, z: 3 });
    expect(hitMobId([back], eye, { x: 0, y: 0, z: 1 }, REACH)).toBe(back.id);
  });

  it('hits when the eye starts inside the hitbox (entry clamped to t=0)', () => {
    const m = createMob('zombie', { x: 0, y: 0, z: -3 });
    expect(hitMobId([m], { x: 0, y: 1, z: -3 }, FWD, REACH)).toBe(m.id);
  });

  it('misses when the ray passes beside the box', () => {
    const m = createMob('zombie', { x: 0, y: 0, z: -3 });
    expect(hitMobId([m], { x: 0, y: 3, z: 0 }, FWD, REACH)).toBeNull(); // above the 1.8-tall box
    expect(hitMobId([m], { x: 2, y: 1, z: 0 }, FWD, REACH)).toBeNull(); // 1.65 blocks to the side
  });

  it('misses when the mob is behind the ray origin', () => {
    const m = createMob('zombie', { x: 0, y: 0, z: 3 });
    expect(hitMobId([m], eye, FWD, REACH)).toBeNull();
  });

  it('misses beyond reach, hits within reach', () => {
    const far = createMob('zombie', { x: 0, y: 0, z: -10 }); // entry t ≈ 9.65
    expect(hitMobId([far], eye, FWD, REACH)).toBeNull();
    const near = createMob('zombie', { x: 0, y: 0, z: -4 }); // entry t ≈ 3.65
    expect(hitMobId([near], eye, FWD, REACH)).toBe(near.id);
  });

  it('picks the closest mob when two line up', () => {
    const near = createMob('zombie', { x: 0, y: 0, z: -3 });
    const far = createMob('zombie', { x: 0, y: 0, z: -4.5 });
    expect(hitMobId([far, near], eye, FWD, REACH)).toBe(near.id);
  });

  it('guards: empty list, zero/NaN direction, non-finite reach', () => {
    expect(hitMobId([], eye, FWD, REACH)).toBeNull();
    const m = createMob('zombie', { x: 0, y: 0, z: -3 });
    expect(hitMobId([m], eye, { x: 0, y: 0, z: 0 }, REACH)).toBeNull();
    expect(hitMobId([m], eye, { x: Number.NaN, y: 0, z: -1 }, REACH)).toBeNull();
    expect(hitMobId([m], eye, FWD, Number.NaN)).toBeNull();
    expect(hitMobId([m], eye, FWD, -1)).toBeNull();
  });

  it('attackMob applies toolDamage to the hit mob and returns a new array', () => {
    const m = createMob('zombie', { x: 0, y: 0, z: -3 });
    const input: Mob[] = [m];
    const res = attackMob(input, eye, FWD, REACH, 4, FWD);
    expect(res.hitId).toBe(m.id);
    expect(res.mobs).not.toBe(input);
    expect(res.mobs[0].hp).toBe(16);
    expect(input[0].hp).toBe(20); // input never mutated
  });

  it('attackMob on a miss returns the SAME array ref with hitId null', () => {
    const input: Mob[] = [createMob('zombie', { x: 0, y: 0, z: -3 })];
    const res = attackMob(input, { x: 0, y: 3, z: 0 }, FWD, REACH, 4, FWD);
    expect(res.hitId).toBeNull();
    expect(res.mobs).toBe(input);
    expect(input[0].hp).toBe(20);
  });

  it('the closest of two mobs takes the damage; the farther keeps its hp and ref', () => {
    const near = createMob('zombie', { x: 0, y: 0, z: -3 });
    const far = createMob('zombie', { x: 0, y: 0, z: -4.5 });
    const res = attackMob([far, near], eye, FWD, REACH, 5, FWD);
    expect(res.hitId).toBe(near.id);
    expect(res.mobs[0]).toBe(far); // untouched → same ref
    expect(res.mobs[0].hp).toBe(20);
    expect(res.mobs[1].hp).toBe(15);
  });

  it('leaves a killed mob in the array (caller filters via isDead)', () => {
    const m = createMob('zombie', { x: 0, y: 0, z: -3 });
    const res = attackMob([m], eye, FWD, REACH, 25, FWD);
    expect(res.mobs[0].hp).toBe(0);
    expect(isDead(res.mobs[0])).toBe(true);
    expect(res.mobs).toHaveLength(1); // removal is the caller's job (main.ts)
    expect(res.mobs.filter((x) => !isDead(x))).toHaveLength(0);
  });

  it('knockback pushes along the look direction (XZ normalized)', () => {
    const m = createMob('zombie', { x: 3, y: 0, z: 0 });
    const dir = { x: 1, y: 0, z: 0 };
    const res = attackMob([m], eye, dir, REACH, 1, dir);
    expect(res.mobs[0].kbVel.x).toBeCloseTo(KNOCKBACK_SPEED, 5);
    expect(res.mobs[0].kbVel.z).toBeCloseTo(0, 5);
    // diagonal aim: the ray is normalized per-axis for the hit, while
    // damageMob normalizes the knockback over XZ and ignores the y component
    const m2 = createMob('zombie', { x: 1.5, y: 0, z: -1.5 });
    const diag = { x: 1, y: 0.5, z: -1 };
    const res2 = attackMob([m2], eye, diag, REACH, 1, diag);
    expect(res2.hitId).toBe(m2.id);
    expect(res2.mobs[0].kbVel.x).toBeCloseTo(KNOCKBACK_SPEED / Math.SQRT2, 5);
    expect(res2.mobs[0].kbVel.z).toBeCloseTo(-KNOCKBACK_SPEED / Math.SQRT2, 5);
  });

  it('non-finite damage is a no-op (hp preserved, still a hit)', () => {
    const m = createMob('zombie', { x: 0, y: 0, z: -3 });
    const res = attackMob([m], eye, FWD, REACH, Number.NaN, FWD);
    expect(res.hitId).toBe(m.id);
    expect(res.mobs[0].hp).toBe(20);
  });
});

/** B3 Task 5：cross 植被（花／草）的互動語意——
 *  ① 硬度 0 → **瞬破**（生存與創造都是一按即消失，不是「永遠打不破」）；
 *  ② 放置方塊到植被格 → **覆蓋植被**（像原版），不是卡住不放。 */
describe('cross 植被的互動（B3 Task 5：瞬破／覆蓋放置）', () => {
  const hit: RayHit = { x: 5, y: 64, z: 5, nx: 0, ny: 1, nz: 0, t: 0 };

  function w(): World {
    const world = new World();
    world.addChunk(new Chunk(0, 0));
    return world;
  }

  it('a hardness zero plant breaks instantly', () => {
    expect(getBreakTime(BLOCK.DANDELION, null)).toBe(0);
    expect(getBreakTime(BLOCK.SHORT_GRASS, null)).toBe(0);
    const d = new DigProgress();
    expect(digStep('survival', d, BLOCK.DANDELION, hit, 1 / 60, null)).toBe(true);
  });

  it('a plant breaks instantly in creative too', () => {
    const d = new DigProgress();
    expect(digStep('creative', d, BLOCK.DANDELION, hit, 1 / 60, null)).toBe(true);
    expect(d.progress).toBe(0);
  });

  it('digStep never divides by zero for instant-break blocks', () => {
    const d = new DigProgress();
    d.update(BLOCK.STONE, hit, 1, 7.5); // 先累積一點進度
    expect(digStep('survival', d, BLOCK.DANDELION, hit, 1 / 60, null)).toBe(true);
    expect(d.progress).toBe(0); // 瞬破 → dig.reset()（不留下進度條）
    expect(Number.isNaN(d.progress)).toBe(false);
  });

  it('DigProgress never divides by zero for an instant-break target', () => {
    const d = new DigProgress();
    d.update(BLOCK.DANDELION, hit, 1, 0); // breakTimeSec === 0 → 直接返回
    expect(d.progress).toBe(0); // 不是 dt / 0 = Infinity
    expect(Number.isNaN(d.progress)).toBe(false);
    expect(d.isDone(BLOCK.DANDELION, 0)).toBe(false);
  });

  it('a block can be placed onto a plant cell (the vegetation is covered, not stuck)', () => {
    const world = w();
    world.setBlock(5, 64, 5, BLOCK.DANDELION);
    // 玩家位置必須在別處，否則 AABB 重疊檢查會擋下
    expect(canPlaceAt(world, 5, 64, 5, { x: 9.5, y: 64, z: 9.5 })).toBe(true);
  });

  it('the plant-cell allowance does not bypass the player-overlap rule', () => {
    const world = w();
    world.setBlock(5, 64, 5, BLOCK.DANDELION);
    // 玩家站在同一格 → 身體 AABB 與目標格重疊 → 仍然不能放
    expect(canPlaceAt(world, 5, 64, 5, { x: 5.5, y: 64, z: 5.5 })).toBe(false);
  });
});
