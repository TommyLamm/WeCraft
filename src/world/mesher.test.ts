import { describe, it, expect } from 'vitest';
import { meshChunk } from './mesher';
import { World } from './world';
import { Chunk } from './chunk';
import { BLOCK, type BlockId } from './blocks';

function worldWithBlock(x: number, y: number, z: number, id: BlockId): World {
  const w = new World();
  w.addChunk(new Chunk(Math.floor(x / 16), Math.floor(z / 16)));
  w.setBlock(x, y, z, id);
  return w;
}

describe('meshChunk', () => {
  it('isolated block produces 6 quads (24 verts, 36 indices)', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    const m = meshChunk(w, 0, 0);
    expect(m.quadCount).toBe(6);
    expect(m.positions.length).toBe(6 * 4 * 3);
    expect(m.indices.length).toBe(6 * 6);
  });

  it('two adjacent blocks produce 10 quads (shared face culled)', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    w.setBlock(6, 64, 5, BLOCK.STONE);
    expect(meshChunk(w, 0, 0).quadCount).toBe(10);
  });

  it('hidden faces of 3x3x3 cube are culled (54 outer quads)', () => {
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    for (let x = 4; x <= 6; x++)
      for (let y = 63; y <= 65; y++)
        for (let z = 4; z <= 6; z++)
          w.setBlock(x, y, z, BLOCK.STONE);
    expect(meshChunk(w, 0, 0).quadCount).toBe(54);
  });

  it('glass next to glass: only outer faces', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.GLASS);
    w.setBlock(6, 64, 5, BLOCK.GLASS);
    expect(meshChunk(w, 0, 0).quadCount).toBe(10);
  });

  it('stone|glass: solid face draws toward glass, glass face hides against stone', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    w.setBlock(6, 64, 5, BLOCK.GLASS);
    // stone: all 6 faces (neighbor glass is transparent → draw); glass: 5 (face against opaque stone culled)
    expect(meshChunk(w, 0, 0).quadCount).toBe(11);
  });

  it('water against air is drawn', () => {
    const w = worldWithBlock(5, 60, 5, BLOCK.WATER);
    expect(meshChunk(w, 0, 0).quadCount).toBe(6);
  });

  it('uv layers are valid tile indices and include grass top tile 0', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.GRASS);
    const m = meshChunk(w, 0, 0);
    for (const layer of m.layers) {
      expect(layer).toBeGreaterThanOrEqual(0);
      expect(layer).toBeLessThan(64);
    }
    expect(m.layers).toContain(0);
  });

  it('empty chunk produces zero geometry', () => {
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    const m = meshChunk(w, 0, 0);
    expect(m.quadCount).toBe(0);
    expect(m.positions.length).toBe(0);
    expect(m.indices.length).toBe(0);
  });

  it('culls faces against solid neighbors across chunk boundaries', () => {
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    w.addChunk(new Chunk(-1, 0));
    w.setBlock(0, 64, 0, BLOCK.STONE);
    w.setBlock(-1, 64, 0, BLOCK.STONE);
    expect(meshChunk(w, 0, 0).quadCount).toBe(5);
  });

  it('grass uses top 0, side 1, bottom 2 tiles', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.GRASS);
    const m = meshChunk(w, 0, 0);
    const used = new Set(Array.from(m.layers));
    expect(used).toEqual(new Set([0, 1, 2]));
    expect(m.layers[8]).toBe(0);
    expect(m.layers[12]).toBe(2);
  });

  it('uvs stay within 0..1 tile space', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    const m = meshChunk(w, 0, 0);
    for (const uv of m.uvs) {
      expect(uv === 0 || uv === 1).toBe(true);
    }
  });

  it('shades vary per face orientation', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    const m = meshChunk(w, 0, 0);
    expect(m.shades[8]).toBe(1.0);
    expect(m.shades[12]).toBe(0.5);
    expect(m.shades[0]).toBeCloseTo(0.72);
  });

  it('indices reference valid vertices', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    const m = meshChunk(w, 0, 0);
    const vertCount = m.positions.length / 3;
    for (const idx of m.indices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(vertCount);
    }
  });

  it('quad winding yields outward normals for all 6 faces', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    const m = meshChunk(w, 0, 0);
    const center = [5.5, 64.5, 5.5];
    const seen = new Set<string>();
    for (let q = 0; q < m.quadCount; q++) {
      const v: number[][] = [];
      for (let i = 0; i < 4; i++) {
        const b = (q * 4 + i) * 3;
        v.push([m.positions[b], m.positions[b + 1], m.positions[b + 2]]);
      }
      const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
      const e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
      const n = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const d = [
        (v[0][0] + v[1][0] + v[2][0] + v[3][0]) / 4 - center[0],
        (v[0][1] + v[1][1] + v[2][1] + v[3][1]) / 4 - center[1],
        (v[0][2] + v[1][2] + v[2][2] + v[3][2]) / 4 - center[2],
      ];
      const axis = d[0] !== 0 ? 0 : d[1] !== 0 ? 1 : 2;
      const expected = [0, 0, 0];
      expected[axis] = Math.sign(d[axis]);
      const dot = n[0] * expected[0] + n[1] * expected[1] + n[2] * expected[2];
      expect(dot).toBeGreaterThan(0);
      seen.add(expected.join(','));
    }
    expect(seen).toEqual(
      new Set(['1,0,0', '-1,0,0', '0,1,0', '0,-1,0', '0,0,1', '0,0,-1']),
    );
  });

  it('side faces pin vv=0 at block bottom and vv=1 at block top', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    const m = meshChunk(w, 0, 0);
    let sideFaces = 0;
    for (let q = 0; q < m.quadCount; q++) {
      const y0 = m.positions[(q * 4) * 3 + 1];
      const y1 = m.positions[(q * 4 + 1) * 3 + 1];
      const y2 = m.positions[(q * 4 + 2) * 3 + 1];
      if (y0 === y1 && y1 === y2) continue; // top/bottom face: constant y
      sideFaces++;
      for (let i = 0; i < 4; i++) {
        const y = m.positions[(q * 4 + i) * 3 + 1];
        expect(m.uvs[(q * 4 + i) * 2 + 1]).toBe(y === 64 ? 0 : 1);
      }
    }
    expect(sideFaces).toBe(4);
  });
});
