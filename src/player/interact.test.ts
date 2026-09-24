import { describe, it, expect } from 'vitest';
import {
  getBreakTime,
  DigProgress,
  canPlaceAt,
  placeTarget,
  collectBlockDrop,
  toolSpeed,
  digStep,
} from './interact';
import { BLOCK, getBlockDef } from '../world/blocks';
import { World } from '../world/world';
import { Chunk } from '../world/chunk';
import type { RayHit } from '../world/raycast';
import { PLAYER_HEIGHT } from './physics';
import { createInventoryModel } from '../core/inventory';

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

describe('collectBlockDrop', () => {
  it('adds 1× the block item in survival', () => {
    const inv = createInventoryModel([null, null], 'survival');
    expect(collectBlockDrop(BLOCK.STONE, inv)).toBe(0);
    expect(inv.slots[0]).toEqual({ item: 'stone', count: 1 });
    expect(collectBlockDrop(BLOCK.DIRT, inv)).toBe(0);
    expect(inv.slots[1]).toEqual({ item: 'dirt', count: 1 });
  });

  it('skips adding in creative (infinite supply)', () => {
    const inv = createInventoryModel([null], 'creative');
    expect(collectBlockDrop(BLOCK.STONE, inv)).toBe(0);
    expect(inv.slots[0]).toBeNull();
  });

  it('adds nothing for blocks without an item form (air, water)', () => {
    const inv = createInventoryModel([null], 'survival');
    expect(collectBlockDrop(BLOCK.AIR, inv)).toBe(0);
    expect(collectBlockDrop(BLOCK.WATER, inv)).toBe(0);
    expect(inv.slots[0]).toBeNull();
  });

  it('returns overflow when the inventory is full', () => {
    const inv = createInventoryModel([{ item: 'stone', count: 64 }], 'survival');
    expect(collectBlockDrop(BLOCK.STONE, inv)).toBe(1);
    expect(inv.countItem('stone')).toBe(64);
  });
});
