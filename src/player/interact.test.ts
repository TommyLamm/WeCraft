import { describe, it, expect } from 'vitest';
import {
  getBreakTime,
  canHarvest,
  DigProgress,
  canPlaceAt,
  placeTarget,
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

  it('the other axe-fast blocks take axe speed too (planks, crafting table, furnace)', () => {
    expect(toolSpeed(BLOCK.PLANKS, held('stone_axe'))).toBe(4);
    expect(toolSpeed(BLOCK.CRAFTING_TABLE, held('wooden_axe'))).toBe(2);
    expect(toolSpeed(BLOCK.FURNACE, held('iron_axe'))).toBe(6);
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

  it('shovel-fast blocks have no shovel item yet → 1× with anything', () => {
    expect(toolSpeed(BLOCK.DIRT, held('iron_pickaxe'))).toBe(1);
    expect(toolSpeed(BLOCK.SAND, held('iron_axe'))).toBe(1);
    expect(toolSpeed(BLOCK.GRASS, null)).toBe(1);
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

describe('spawnBlockDrop (Task 7 — broken blocks drop into the world)', () => {
  const at = { x: 5.5, y: 70.5, z: 5.5 }; // block centre = break pos + 0.5

  it('survival spawns 1× the block item at the given position', () => {
    const drops = spawnBlockDrop([], 'survival', BLOCK.DIRT, at);
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({
      item: 'dirt',
      count: 1,
      pos: at,
      pickupDelay: 0.5,
      age: 0,
    });
  });

  it('mined stone drops cobblestone (Minecraft parity — verification fix)', () => {
    const drops = spawnBlockDrop([], 'survival', BLOCK.STONE, at);
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ item: 'cobblestone', count: 1 });
  });

  it('spawns nothing in creative (infinite supply, no world drops)', () => {
    // Assert against a NON-empty array: a `return []` bug here would wipe every
    // live drop on each creative break — same-ref is the real contract.
    const existing = spawnBlockDrop([], 'survival', BLOCK.STONE, at);
    expect(spawnBlockDrop(existing, 'creative', BLOCK.STONE, at)).toBe(existing);
    expect(spawnBlockDrop(existing, 'creative', BLOCK.DIRT, at)).toBe(existing);
    expect(existing).toHaveLength(1); // input left intact
  });

  it('adds nothing for blocks without an item form (air, water)', () => {
    const existing = spawnBlockDrop([], 'survival', BLOCK.DIRT, at);
    expect(spawnBlockDrop(existing, 'survival', BLOCK.AIR, at)).toBe(existing);
    expect(spawnBlockDrop(existing, 'survival', BLOCK.WATER, at)).toBe(existing);
    expect(existing).toHaveLength(1);
  });

  it('coal_ore drops coal; iron_ore stays iron_ore (smelting-free)', () => {
    expect(spawnBlockDrop([], 'survival', BLOCK.COAL_ORE, at)[0].item).toBe('coal');
    expect(spawnBlockDrop([], 'survival', BLOCK.IRON_ORE, at)[0].item).toBe('iron_ore');
  });

  it('appends to existing drops without mutating the input array', () => {
    const first = spawnBlockDrop([], 'survival', BLOCK.STONE, at);
    const second = spawnBlockDrop(first, 'survival', BLOCK.DIRT, at);
    expect(first).toHaveLength(1); // input untouched
    expect(second).toHaveLength(2);
    expect(second[0]).toBe(first[0]); // existing entities kept as-is
    expect(second[1].id).not.toBe(second[0].id);
  });
});

describe('toolDamage (Task 9 melee damage table)', () => {
  it('bare hand deals 1', () => {
    expect(toolDamage(null)).toBe(1);
  });

  it('swords: wooden 4, stone 5, iron 6 (one tier step each)', () => {
    expect(toolDamage('wooden_sword')).toBe(4);
    expect(toolDamage('stone_sword')).toBe(5);
    expect(toolDamage('iron_sword')).toBe(6);
  });

  it('pickaxes deal 2 (all tiers, iron included)', () => {
    expect(toolDamage('wooden_pickaxe')).toBe(2);
    expect(toolDamage('stone_pickaxe')).toBe(2);
    expect(toolDamage('iron_pickaxe')).toBe(2);
  });

  it('axes deal 3 (all tiers, iron included)', () => {
    expect(toolDamage('wooden_axe')).toBe(3);
    expect(toolDamage('stone_axe')).toBe(3);
    expect(toolDamage('iron_axe')).toBe(3);
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
