import { describe, it, expect } from 'vitest';
import { Chunk, chunkIndex } from './chunk';
import { World } from './world';
import { BLOCK } from './blocks';

describe('chunkIndex', () => {
  it('maps coords deterministically', () => {
    expect(chunkIndex(0, 0, 0)).toBe(0);
    expect(chunkIndex(1, 0, 0)).toBe(1);
    expect(chunkIndex(0, 1, 0)).toBe(256);
    expect(chunkIndex(0, 0, 1)).toBe(16);
    expect(chunkIndex(15, 255, 15)).toBe(16 * 16 * 256 - 1);
  });
});

describe('Chunk', () => {
  it('get/set roundtrip', () => {
    const c = new Chunk(0, 0);
    c.set(3, 64, 5, BLOCK.STONE);
    expect(c.get(3, 64, 5)).toBe(BLOCK.STONE);
  });

  it('out of range y returns air', () => {
    const c = new Chunk(0, 0);
    expect(c.get(0, 256, 0)).toBe(BLOCK.AIR);
    expect(c.get(0, -1, 0)).toBe(BLOCK.AIR);
  });
});

describe('World', () => {
  it('setBlock marks chunk dirty', () => {
    const w = new World();
    w.setBlock(5, 70, 5, BLOCK.STONE);
    expect(w.getChunk(0, 0)?.dirty).toBe(true);
    expect(w.getBlock(5, 70, 5)).toBe(BLOCK.STONE);
    w.setBlock(5, 70, 5, BLOCK.DIRT);
    expect(w.getBlock(5, 70, 5)).toBe(BLOCK.DIRT);
  });

  it('getBlock outside loaded chunks is air', () => {
    const w = new World();
    expect(w.getBlock(1000, 64, 1000)).toBe(BLOCK.AIR);
  });

  it('crossing chunk boundary works', () => {
    const w = new World();
    w.setBlock(16, 64, 0, BLOCK.STONE);
    expect(w.getChunk(1, 0)?.get(0, 64, 0)).toBe(BLOCK.STONE);
    expect(w.getBlock(16, 64, 0)).toBe(BLOCK.STONE);
  });

  it('setBlock on y out of range is ignored', () => {
    const w = new World();
    expect(w.setBlock(0, 300, 0, BLOCK.STONE)).toBe(false);
    expect(w.getChunk(0, 0)).toBeUndefined();
  });

  it('edge setBlock dirties neighbor chunk', () => {
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    w.addChunk(new Chunk(1, 0));
    w.getChunk(1, 0)!.dirty = false;
    w.setBlock(15, 64, 0, BLOCK.STONE);
    expect(w.getChunk(1, 0)!.dirty).toBe(true);
  });

  it('negative world coords roundtrip into correct chunk', () => {
    const w = new World();
    expect(w.setBlock(-1, 64, -1, BLOCK.STONE)).toBe(true);
    expect(w.getBlock(-1, 64, -1)).toBe(BLOCK.STONE);
    expect(w.getChunk(-1, -1)).toBeDefined();
    expect(w.setBlock(-17, 64, -1, BLOCK.STONE)).toBe(true);
    expect(w.getChunk(-2, -1)).toBeDefined();
    expect(w.getBlock(-17, 64, -1)).toBe(BLOCK.STONE);
  });

  it('dirties only touched neighbors on edges, none in interior', () => {
    const w = new World();
    const coords = [
      [-1, 0],
      [0, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const;
    for (const [cx, cz] of coords) w.addChunk(new Chunk(cx, cz));
    const reset = () => {
      for (const [cx, cz] of coords) w.getChunk(cx, cz)!.dirty = false;
    };
    const dirtied = () =>
      coords.map(([cx, cz]) => w.getChunk(cx, cz)!.dirty);

    reset();
    w.setBlock(0, 64, 0, BLOCK.STONE);
    expect(dirtied()).toEqual([true, true, false, true, false]);

    reset();
    w.setBlock(15, 64, 0, BLOCK.STONE);
    expect(dirtied()).toEqual([false, true, true, true, false]);

    reset();
    w.setBlock(0, 64, 15, BLOCK.STONE);
    expect(dirtied()).toEqual([true, true, false, false, true]);

    reset();
    w.setBlock(5, 64, 5, BLOCK.STONE);
    expect(dirtied()).toEqual([false, true, false, false, false]);
  });

  it('successful setBlock records chunk in modified set', () => {
    const w = new World();
    w.setBlock(5, 70, 5, BLOCK.STONE);
    expect(w.modified.has('0,0')).toBe(true);
  });

  it('setBlock returns true on success', () => {
    const w = new World();
    expect(w.setBlock(5, 70, 5, BLOCK.STONE)).toBe(true);
    expect(w.setBlock(0, 0, 0, BLOCK.DIRT)).toBe(true);
  });
});
