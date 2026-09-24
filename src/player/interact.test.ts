import { describe, it, expect } from 'vitest';
import { getBreakTime, DigProgress, canPlaceAt, placeTarget, collectBlockDrop } from './interact';
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

  it('isDone false before any update and for bedrock', () => {
    const d = new DigProgress();
    expect(d.isDone(BLOCK.STONE)).toBe(false);
    d.update(BLOCK.BEDROCK, { x: 0, y: 64, z: 0, nx: 0, ny: 1, nz: 0, t: 0 }, 100);
    expect(d.progress).toBe(0);
    expect(d.isDone(BLOCK.BEDROCK)).toBe(false);
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
