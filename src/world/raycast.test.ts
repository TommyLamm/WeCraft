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
});
