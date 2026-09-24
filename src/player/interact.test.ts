import { describe, it, expect } from 'vitest';
import {
  getBreakTime,
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
import { BLOCK, getBlockDef } from '../world/blocks';
import { createMob, isDead, KNOCKBACK_SPEED, type Mob } from '../world/mobs';
import { World } from '../world/world';
import { Chunk } from '../world/chunk';
import type { RayHit } from '../world/raycast';
import { PLAYER_HEIGHT } from './physics';

describe('getBreakTime', () => {
  it('dirt faster than stone', () => {
    expect(getBreakTime(BLOCK.DIRT)).toBeLessThan(getBreakTime(BLOCK.STONE));
  });
  it('bedrock unbreakable', () => {
    expect(getBreakTime(BLOCK.BEDROCK)).toBe(Infinity);
  });
  it('matches hardness registry', () => {
    expect(getBreakTime(BLOCK.STONE)).toBe(getBlockDef(BLOCK.STONE).hardness);
  });
});

describe('DigProgress', () => {
  it('progress accumulates while target unchanged', () => {
    const d = new DigProgress();
    const hit: RayHit = { x: 0, y: 64, z: 0, nx: 0, ny: 1, nz: 0, t: 0 };
    d.update(BLOCK.STONE, hit, 1.0); // 挖 1s（stone=2s → 50%）
    expect(d.progress).toBeCloseTo(0.5, 5);
    d.update(BLOCK.STONE, hit, 1.0);
    expect(d.progress).toBeCloseTo(1.0, 5);
    expect(d.isDone(BLOCK.STONE)).toBe(true);
  });

  it('resets when target changes', () => {
    const d = new DigProgress();
    d.update(BLOCK.STONE, { x: 0, y: 64, z: 0, nx: 0, ny: 1, nz: 0, t: 0 }, 1);
    d.update(BLOCK.STONE, { x: 1, y: 64, z: 0, nx: 0, ny: 1, nz: 0, t: 0 }, 1);
    expect(d.progress).toBeCloseTo(0.5, 5);
  });

  it('reset clears progress', () => {
    const d = new DigProgress();
    d.update(BLOCK.DIRT, { x: 0, y: 64, z: 0, nx: 0, ny: 1, nz: 0, t: 0 }, 1);
    d.reset();
    expect(d.progress).toBe(0);
  });

  it('resets when target moves from negative coordinates', () => {
    const d = new DigProgress();
    d.update(BLOCK.STONE, { x: -1, y: 64, z: 0, nx: 0, ny: 1, nz: 0, t: 0 }, 1);
    expect(d.progress).toBeCloseTo(0.5, 5);
    d.update(BLOCK.STONE, { x: 0, y: 64, z: 0, nx: 0, ny: 1, nz: 0, t: 0 }, 0.01);
    expect(d.progress).toBeCloseTo(0.005, 5); // 重新起算，不是 0.5+
  });

  it('speed multiplies the progress rate (survival tool speed)', () => {
    const d = new DigProgress();
    const hit: RayHit = { x: 0, y: 64, z: 0, nx: 0, ny: 1, nz: 0, t: 0 };
    d.update(BLOCK.STONE, hit, 0.5, 2); // 0.5s × 2× / 2s hardness = 50%
    expect(d.progress).toBeCloseTo(0.5, 5);
    d.update(BLOCK.STONE, hit, 0.5, 2); // another 50% → done
    expect(d.progress).toBeCloseTo(1.0, 5);
    expect(d.isDone(BLOCK.STONE)).toBe(true);
  });

  it('speed below 1 slows progress (wrong tool, 0.5×)', () => {
    const d = new DigProgress();
    d.update(BLOCK.STONE, { x: 0, y: 64, z: 0, nx: 0, ny: 1, nz: 0, t: 0 }, 1, 0.5);
    expect(d.progress).toBeCloseTo(0.25, 5); // 1s × 0.5× / 2s hardness
    expect(d.isDone(BLOCK.STONE)).toBe(false);
  });

  it('non-finite speed falls back to 1 (never poisons progress)', () => {
    const d = new DigProgress();
    d.update(BLOCK.STONE, { x: 0, y: 64, z: 0, nx: 0, ny: 1, nz: 0, t: 0 }, 1, Number.NaN);
    expect(d.progress).toBeCloseTo(0.5, 5);
  });

  it('isDone false before any update and for bedrock', () => {
    const d = new DigProgress();
    expect(d.isDone(BLOCK.STONE)).toBe(false);
    d.update(BLOCK.BEDROCK, { x: 0, y: 64, z: 0, nx: 0, ny: 1, nz: 0, t: 0 }, 100);
    expect(d.progress).toBe(0);
    expect(d.isDone(BLOCK.BEDROCK)).toBe(false);
  });
});

describe('toolSpeed (Task 5 survival mining table)', () => {
  const pick = { item: 'stone_pickaxe', count: 1 } as const;
  const axe = { item: 'wooden_axe', count: 1 } as const;
  const sword = { item: 'wooden_sword', count: 1 } as const;

  it('matching pickaxe is 2× on stone-family blocks', () => {
    expect(toolSpeed(BLOCK.STONE, pick)).toBe(2);
    expect(toolSpeed(BLOCK.COBBLE, { item: 'wooden_pickaxe', count: 1 })).toBe(2);
    expect(toolSpeed(BLOCK.COAL_ORE, pick)).toBe(2);
    expect(toolSpeed(BLOCK.IRON_ORE, pick)).toBe(2);
  });

  it('bare hand on pickaxe-blocks is 0.5× (hand = wrong tool for rock)', () => {
    expect(toolSpeed(BLOCK.STONE, null)).toBe(0.5);
    expect(toolSpeed(BLOCK.IRON_ORE, null)).toBe(0.5);
    // a plain block item in hand behaves like a bare hand
    expect(toolSpeed(BLOCK.STONE, { item: 'dirt', count: 1 })).toBe(0.5);
  });

  it('wrong tool on pickaxe-blocks is 0.5× (axe and sword both count)', () => {
    expect(toolSpeed(BLOCK.STONE, axe)).toBe(0.5);
    expect(toolSpeed(BLOCK.COBBLE, sword)).toBe(0.5);
  });

  it('matching axe is 2× on logs; bare hand stays 1× (logs are punchable)', () => {
    expect(toolSpeed(BLOCK.LOG, axe)).toBe(2);
    expect(toolSpeed(BLOCK.LOG, { item: 'stone_axe', count: 1 })).toBe(2);
    expect(toolSpeed(BLOCK.LOG, null)).toBe(1);
  });

  it('wrong tool on logs is 0.5×', () => {
    expect(toolSpeed(BLOCK.LOG, { item: 'stone_pickaxe', count: 1 })).toBe(0.5);
    expect(toolSpeed(BLOCK.LOG, sword)).toBe(0.5);
  });

  it('no-tool blocks dig at 1× with anything (hand, tool, or sword)', () => {
    expect(toolSpeed(BLOCK.DIRT, null)).toBe(1);
    expect(toolSpeed(BLOCK.GRASS, sword)).toBe(1);
    expect(toolSpeed(BLOCK.GLASS, axe)).toBe(1);
    expect(toolSpeed(BLOCK.LEAVES, pick)).toBe(1);
    expect(toolSpeed(BLOCK.PLANKS, null)).toBe(1);
    expect(toolSpeed(BLOCK.SAND, { item: 'stone', count: 1 })).toBe(1);
  });

  it('unbreakable list (bedrock, water) unchanged at 1×', () => {
    expect(toolSpeed(BLOCK.BEDROCK, null)).toBe(1);
    expect(toolSpeed(BLOCK.BEDROCK, pick)).toBe(1);
    expect(toolSpeed(BLOCK.WATER, null)).toBe(1);
    expect(toolSpeed(BLOCK.WATER, axe)).toBe(1);
  });
});

describe('digStep (Task 5 creative instant break)', () => {
  const hit: RayHit = { x: 0, y: 64, z: 0, nx: 0, ny: 1, nz: 0, t: 0 };

  it('creative breaks in one step with no progress accumulation', () => {
    const d = new DigProgress();
    expect(digStep('creative', d, BLOCK.STONE, hit, 1 / 60, 1)).toBe(true);
    expect(d.progress).toBe(0); // the timer never runs in creative
  });

  it('creative resets any leftover survival progress', () => {
    const d = new DigProgress();
    d.update(BLOCK.STONE, hit, 1, 1); // 50% from a survival dig
    expect(digStep('creative', d, BLOCK.STONE, hit, 1 / 60, 1)).toBe(true);
    expect(d.progress).toBe(0);
  });

  it('creative still respects the unbreakable list (bedrock, water)', () => {
    const d = new DigProgress();
    expect(digStep('creative', d, BLOCK.BEDROCK, hit, 1, 1)).toBe(false);
    expect(digStep('creative', d, BLOCK.WATER, hit, 1, 1)).toBe(false);
  });

  it('survival is false until the timed progress completes', () => {
    const d = new DigProgress();
    // dirt = 0.6s: 0.1s gets there nowhere
    expect(digStep('survival', d, BLOCK.DIRT, hit, 0.1, 1)).toBe(false);
    expect(d.progress).toBeGreaterThan(0);
    expect(digStep('survival', d, BLOCK.DIRT, hit, 0.55, 1)).toBe(true); // 0.1 + 0.55 > 0.6
  });

  it('survival applies the tool speed multiplier', () => {
    const d = new DigProgress();
    // stone = 2s: two 0.5s steps at 2× → 50% then done
    expect(digStep('survival', d, BLOCK.STONE, hit, 0.5, 2)).toBe(false);
    expect(digStep('survival', d, BLOCK.STONE, hit, 0.5, 2)).toBe(true);
  });

  it('survival bedrock never breaks (unbreakable list unchanged)', () => {
    const d = new DigProgress();
    expect(digStep('survival', d, BLOCK.BEDROCK, hit, 100, 2)).toBe(false);
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
    const drops = spawnBlockDrop([], 'survival', BLOCK.STONE, at);
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({
      item: 'stone',
      count: 1,
      pos: at,
      pickupDelay: 0.5,
      age: 0,
    });
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

  it('swords: wooden 4, stone 5', () => {
    expect(toolDamage('wooden_sword')).toBe(4);
    expect(toolDamage('stone_sword')).toBe(5);
  });

  it('pickaxes deal 2 (both tiers)', () => {
    expect(toolDamage('wooden_pickaxe')).toBe(2);
    expect(toolDamage('stone_pickaxe')).toBe(2);
  });

  it('axes deal 3 (both tiers)', () => {
    expect(toolDamage('wooden_axe')).toBe(3);
    expect(toolDamage('stone_axe')).toBe(3);
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
