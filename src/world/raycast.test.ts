import { describe, it, expect } from 'vitest';
import { raycast } from './raycast';
import { World } from './world';
import { Chunk } from './chunk';
import { BLOCK } from './blocks';

function setup(): World {
  const w = new World();
  w.addChunk(new Chunk(0, 0));
  return w;
}

describe('raycast', () => {
  it('hits block straight ahead and reports face normal', () => {
    const w = setup();
    w.setBlock(0, 64, -3, BLOCK.STONE);
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: -1 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBe(0);
    expect(hit!.y).toBe(64);
    expect(hit!.z).toBe(-3);
    expect(hit!.nz).toBe(1);
  });

  it('returns null when no block in range', () => {
    const w = setup();
    const hit = raycast(w, { x: 0.5, y: 80, z: 0.5 }, { x: 0, y: 1, z: 0 }, 5);
    expect(hit).toBeNull();
  });

  it('respects max distance', () => {
    const w = setup();
    w.setBlock(0, 64, -8, BLOCK.STONE);
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: -1 }, 5);
    expect(hit).toBeNull();
  });

  it('does not hit water (non-solid)', () => {
    const w = setup();
    w.setBlock(0, 64, -2, BLOCK.WATER);
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: -1 }, 10);
    expect(hit).toBeNull();
  });

  it('hits glass (solid)', () => {
    const w = setup();
    w.setBlock(0, 64, -2, BLOCK.GLASS);
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: -1 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.z).toBe(-2);
  });

  it('hits correct block along diagonal ray (interleaved tMax path)', () => {
    const w = setup();
    w.setBlock(1, 65, 0, BLOCK.STONE);
    const inv = Math.SQRT1_2;
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: inv, y: inv, z: 0 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBe(1);
    expect(hit!.y).toBe(65);
    expect(hit!.z).toBe(0);
    expect(hit!.nx).toBe(-1);
    expect(hit!.ny).toBe(0);
    expect(hit!.nz).toBe(0);
  });

  it('start-inside-solid returns single-axis normal for diagonal dir', () => {
    const w = setup();
    w.setBlock(0, 64, 0, BLOCK.STONE);
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0.7, y: -0.7, z: 0 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBe(0);
    expect(hit!.y).toBe(64);
    expect(hit!.z).toBe(0);
    const axes = [Math.abs(hit!.nx), Math.abs(hit!.ny), Math.abs(hit!.nz)];
    expect(axes.filter((a) => a === 1)).toHaveLength(1);
    expect(axes.filter((a) => a === 0)).toHaveLength(2);
    expect(axes[0]).toBe(1);
    expect(hit!.nx).toBe(-1);
  });

  it('start-inside-solid returns single-axis normal for axis-aligned dir', () => {
    const w = setup();
    w.setBlock(0, 64, 0, BLOCK.STONE);
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: -1 }, 10);
    expect(hit).not.toBeNull();
    const axes = [Math.abs(hit!.nx), Math.abs(hit!.ny), Math.abs(hit!.nz)];
    expect(axes.filter((a) => a === 1)).toHaveLength(1);
    expect(axes.filter((a) => a === 0)).toHaveLength(2);
    expect(hit!.nz).toBe(1);
    expect(hit!.nx).toBe(0);
    expect(hit!.ny).toBe(0);
  });

  it('hits block with mixed-sign direction (x>0, y<0)', () => {
    const w = setup();
    w.setBlock(1, 63, 0, BLOCK.STONE);
    const inv = Math.SQRT1_2;
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: inv, y: -inv, z: 0 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBe(1);
    expect(hit!.y).toBe(63);
    expect(hit!.z).toBe(0);
    expect(hit!.nx).toBe(-1);
    expect(hit!.ny).toBe(0);
    expect(hit!.nz).toBe(0);
  });

  it('returns hit exactly at maxDistance and null just beyond', () => {
    const w = setup();
    w.setBlock(0, 64, -3, BLOCK.STONE);
    const dir = { x: 0, y: 0, z: -1 };
    const origin = { x: 0.5, y: 64.5, z: 0.5 };
    const hit = raycast(w, origin, dir, 2.5);
    expect(hit).not.toBeNull();
    expect(hit!.z).toBe(-3);
    expect(hit!.t).toBe(2.5);
    const miss = raycast(w, origin, dir, 2.4);
    expect(miss).toBeNull();
  });

  it('returns null for zero-length dir', () => {
    const w = setup();
    w.setBlock(0, 64, 0, BLOCK.STONE);
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: 0 }, 10);
    expect(hit).toBeNull();
  });
});
