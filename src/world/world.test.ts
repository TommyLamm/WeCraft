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

  it('successful setBlock records block in modified map', () => {
    const w = new World();
    w.setBlock(5, 70, 5, BLOCK.STONE);
    expect(w.modified.get('5,70,5')).toBe(BLOCK.STONE);
  });

  it('setBlock returns true on success', () => {
    const w = new World();
    expect(w.setBlock(5, 70, 5, BLOCK.STONE)).toBe(true);
    expect(w.setBlock(0, 0, 0, BLOCK.DIRT)).toBe(true);
  });
});

describe('serializeModified / applyModified', () => {
  it('round-trips placed and mined blocks through a fresh world', () => {
    const w1 = new World();
    w1.setBlock(5, 70, 5, BLOCK.STONE); // placed
    w1.setBlock(6, 70, 6, BLOCK.STONE);
    w1.setBlock(6, 70, 6, BLOCK.AIR); // mined to air — must stay mined
    const pairs = w1.serializeModified();
    expect(pairs).toContainEqual(['5,70,5', BLOCK.STONE]);
    expect(pairs).toContainEqual(['6,70,6', BLOCK.AIR]);

    const w2 = new World();
    w2.applyModified(pairs);
    expect(w2.getBlock(5, 70, 5)).toBe(BLOCK.STONE);
    expect(w2.getBlock(6, 70, 6)).toBe(BLOCK.AIR);
  });

  it('applied pairs re-serialize identically (idempotent round-trip)', () => {
    const w = new World();
    const pairs: Array<[string, number]> = [
      ['1,64,1', BLOCK.GLASS],
      ['-1,64,-1', BLOCK.DIRT],
      ['0,0,0', BLOCK.AIR],
    ];
    w.applyModified(pairs);
    expect(w.serializeModified()).toEqual(pairs);
  });

  it('applyModified marks the chunk dirty for re-mesh', () => {
    const w = new World();
    w.applyModified([['5,70,5', BLOCK.STONE]]);
    expect(w.getChunk(0, 0)?.dirty).toBe(true);
  });

  it('serializeModified is empty on an untouched world', () => {
    expect(new World().serializeModified()).toEqual([]);
  });

  it('applyModified skips malformed and out-of-range entries without throwing', () => {
    const w = new World();
    expect(() =>
      w.applyModified([
        ['not-a-key', 1],
        ['1,2', BLOCK.STONE],
        ['a,b,c', BLOCK.STONE],
        ['1,999,1', BLOCK.STONE], // y out of range
        ['1,64,1.5', BLOCK.STONE], // non-integer coords
        ['2,64,2', BLOCK.GLASS], // valid — must still be applied
      ]),
    ).not.toThrow();
    expect(w.getBlock(2, 64, 2)).toBe(BLOCK.GLASS);
    expect(w.serializeModified()).toEqual([['2,64,2', BLOCK.GLASS]]);
  });
});

/** Task 14 load-order fix: main.ts's terrain-generation response fills chunks
 *  wholesale (`existing.data.set(data)`), which runs AFTER applyModified has
 *  auto-created a not-yet-generated chunk — without a re-apply the saved edits
 *  would be clobbered by regenerated terrain. These tests simulate that exact
 *  fill sequence at the world level (the call ORDER lives in main.ts's gen
 *  response handler; this proves the re-apply makes edits win). */
describe('reapplyModifiedInChunk (Task 14 gen-order fix)', () => {
  it('saved edits win over a wholesale terrain fill of the same chunk', () => {
    const w = new World();
    w.applyModified([
      ['5,70,5', BLOCK.STONE], // chunk (0,0)
      ['-17,80,-16', BLOCK.GLASS], // chunk (-2,-1) — must not be touched here
    ]);
    // simulate the gen response for chunk (0,0): fresh terrain replaces data
    const c = w.getChunk(0, 0)!;
    const terrain = new Uint8Array(c.data.length).fill(BLOCK.DIRT);
    c.data.set(terrain);
    expect(w.getBlock(5, 70, 5)).toBe(BLOCK.DIRT); // demonstrates the clobber hazard
    w.reapplyModifiedInChunk(0, 0);
    expect(w.getBlock(5, 70, 5)).toBe(BLOCK.STONE); // edit wins over terrain
    // another chunk's edit is unaffected by this call
    expect(w.getBlock(-17, 80, -16)).toBe(BLOCK.GLASS);
    expect(w.serializeModified()).toContainEqual(['5,70,5', BLOCK.STONE]);
  });

  it('re-applies edits into a chunk re-created from terrain after an unload', () => {
    const w = new World();
    w.applyModified([['5,70,5', BLOCK.STONE]]);
    w.removeChunk(0, 0); // refreshQueues unload — the edit stays in world.modified
    // gen response else-branch: brand-new chunk built from terrain data
    const fresh = new Chunk(0, 0, new Uint8Array(16 * 16 * 256).fill(BLOCK.DIRT));
    fresh.generated = true;
    w.addChunk(fresh);
    w.reapplyModifiedInChunk(0, 0);
    expect(w.getBlock(5, 70, 5)).toBe(BLOCK.STONE);
  });

  it('marks the chunk dirty for re-mesh (and no-op on an empty world)', () => {
    const w = new World();
    w.applyModified([['5,70,5', BLOCK.STONE]]);
    w.getChunk(0, 0)!.dirty = false;
    w.reapplyModifiedInChunk(0, 0);
    expect(w.getChunk(0, 0)!.dirty).toBe(true);
    const empty = new World();
    expect(() => empty.reapplyModifiedInChunk(3, 3)).not.toThrow();
  });

  it('only re-applies entries inside the requested chunk', () => {
    const w = new World();
    w.applyModified([
      ['0,64,0', BLOCK.STONE],
      ['15,64,15', BLOCK.GLASS],
      ['16,64,0', BLOCK.DIRT], // chunk (1,0)
    ]);
    const c1 = w.getChunk(1, 0)!;
    c1.data.fill(BLOCK.AIR); // simulate fill wiping it
    w.reapplyModifiedInChunk(0, 0);
    expect(w.getBlock(0, 64, 0)).toBe(BLOCK.STONE);
    expect(w.getBlock(15, 64, 15)).toBe(BLOCK.GLASS);
    expect(w.getBlock(16, 64, 0)).toBe(BLOCK.AIR); // (1,0) untouched by this call
    w.reapplyModifiedInChunk(1, 0);
    expect(w.getBlock(16, 64, 0)).toBe(BLOCK.DIRT);
  });
});

/** Task 14 review #4: New Game must be a FRESH world — sessions share one
 *  boot World, so `clear()` is the testable seam behind main's resetWorld. */
describe('clear (fresh-world reset)', () => {
  it('drops every chunk and all recorded edits', () => {
    const w = new World();
    w.applyModified([
      ['5,70,5', BLOCK.STONE],
      ['20,80,20', BLOCK.AIR],
    ]);
    w.addChunk(new Chunk(1, 1));
    w.clear();
    expect(w.chunks.size).toBe(0);
    expect(w.serializeModified()).toEqual([]);
    expect(w.getBlock(5, 70, 5)).toBe(BLOCK.AIR); // edits gone from the world
    expect(w.getChunk(1, 1)).toBeUndefined();
  });

  it('the cleared world is reusable (chunks auto-create again)', () => {
    const w = new World();
    w.applyModified([['5,70,5', BLOCK.STONE]]);
    w.clear();
    expect(w.setBlock(5, 70, 5, BLOCK.GLASS)).toBe(true);
    expect(w.getBlock(5, 70, 5)).toBe(BLOCK.GLASS);
    expect(w.serializeModified()).toEqual([['5,70,5', BLOCK.GLASS]]);
  });
});
