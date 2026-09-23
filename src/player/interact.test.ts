import { describe, it, expect } from 'vitest';
import { getBreakTime, DigProgress, canPlaceAt, placeTarget } from './interact';
import { BLOCK, getBlockDef } from '../world/blocks';
import { World } from '../world/world';
import { Chunk } from '../world/chunk';
import type { RayHit } from '../world/raycast';

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
});
