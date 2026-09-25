import { describe, it, expect } from 'vitest';
import { meshChunk, type MeshData } from './mesher';
import { World } from './world';
import { Chunk, CHUNK_SIZE } from './chunk';
import { BLOCK, type BlockId } from './blocks';

function worldWithBlock(x: number, y: number, z: number, id: BlockId): World {
  const w = new World();
  w.addChunk(new Chunk(Math.floor(x / 16), Math.floor(z / 16)));
  w.setBlock(x, y, z, id);
  return w;
}

/** Meshing splits opaque terrain from water (Task 16 renders water separately). */
function opaque(w: World, cx = 0, cz = 0): MeshData {
  return meshChunk(w, cx, cz).opaque;
}

function water(w: World, cx = 0, cz = 0): MeshData {
  return meshChunk(w, cx, cz).water;
}

/** World positions of quad `q`'s four vertices. */
function quadVerts(m: MeshData, q: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const b = (q * 4 + i) * 3;
    out.push([m.positions[b], m.positions[b + 1], m.positions[b + 2]]);
  }
  return out;
}

/** Face normal of quad `q` (mesher emits one normal per vertex). */
function quadNormal(m: MeshData, q: number): number[] {
  const b = q * 4 * 3;
  return [m.normals[b], m.normals[b + 1], m.normals[b + 2]];
}

/** Number of quads facing `dir` — lets tests target ONE face region of a mesh. */
function countQuads(m: MeshData, dir: [number, number, number]): number {
  let n = 0;
  for (let q = 0; q < m.quadCount; q++) {
    const nrm = quadNormal(m, q);
    if (nrm[0] === dir[0] && nrm[1] === dir[1] && nrm[2] === dir[2]) n++;
  }
  return n;
}

/** A flat 16×16 layer of `id` at world height `y` (fills chunk 0,0). */
function layer(id: BlockId, y: number): World {
  const w = new World();
  w.addChunk(new Chunk(0, 0));
  for (let x = 0; x < CHUNK_SIZE; x++)
    for (let z = 0; z < CHUNK_SIZE; z++) w.setBlock(x, y, z, id);
  return w;
}

describe('meshChunk', () => {
  it('isolated block produces 6 quads (24 verts, 36 indices)', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    const m = opaque(w);
    expect(m.quadCount).toBe(6);
    expect(m.positions.length).toBe(6 * 4 * 3);
    expect(m.indices.length).toBe(6 * 6);
  });

  it('two adjacent blocks merge coplanar faces but never the shared interior one', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    w.setBlock(6, 64, 5, BLOCK.STONE);
    const m = opaque(w);
    // 10 visible faces; greedy merges each coplanar same-signature pair
    // (top/bottom/+z/-z) → 6 quads. Unculled interior faces at plane x=6
    // would add 2 more quads, so the count alone pins culling too.
    expect(m.quadCount).toBe(6);
    // Direct culling check: no quad sits entirely on the shared plane x=6.
    const interior = Array.from({ length: m.quadCount }, (_, q) => quadVerts(m, q)).filter(
      (v) => v.every((p) => p[0] === 6),
    );
    expect(interior).toHaveLength(0);
  });

  it('hidden faces of 3x3x3 cube are culled (outer shell greedily → 6 quads)', () => {
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    for (let x = 4; x <= 6; x++)
      for (let y = 63; y <= 65; y++)
        for (let z = 4; z <= 6; z++) w.setBlock(x, y, z, BLOCK.STONE);
    // 54 visible outer faces; each 3×3 side merges into one quad. Interior
    // leaks would raise the count, so 6 = culling intact + merging active.
    expect(opaque(w).quadCount).toBe(6);
  });

  it('glass next to glass: only outer faces (merged → 6 quads)', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.GLASS);
    w.setBlock(6, 64, 5, BLOCK.GLASS);
    expect(opaque(w).quadCount).toBe(6);
  });

  it('stone|glass: solid face draws toward glass, glass face hides against stone', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    w.setBlock(6, 64, 5, BLOCK.GLASS);
    // stone: all 6 faces (neighbor glass is transparent → draw); glass: 5
    // (face against opaque stone culled). Signatures differ per block, so
    // nothing merges → 11 quads, same as the per-block count.
    expect(opaque(w).quadCount).toBe(11);
  });

  it('water against air is drawn (in the water mesh, not the opaque one)', () => {
    const w = worldWithBlock(5, 60, 5, BLOCK.WATER);
    expect(water(w).quadCount).toBe(6);
    expect(opaque(w).quadCount).toBe(0);
  });

  it('splits water from opaque terrain in one chunk', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    w.setBlock(5, 60, 5, BLOCK.WATER);
    expect(opaque(w).quadCount).toBe(6);
    expect(water(w).quadCount).toBe(6);
  });

  it('texIndex: one per vertex, aligned with positions (and normals/shades)', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.GRASS);
    const m = meshChunk(w, 0, 0);
    for (const mesh of [m.opaque, m.water]) {
      expect(mesh.texIndex.length).toBe(mesh.positions.length / 3);
      expect(mesh.normals.length).toBe(mesh.positions.length);
      expect(mesh.shades.length).toBe(mesh.positions.length / 3);
      expect(mesh.uvs.length).toBe((mesh.positions.length / 3) * 2);
    }
  });

  it('uv texIndex are valid texture-array tiles and include grass top tile 0', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.GRASS);
    const m = opaque(w);
    for (const tile of m.texIndex) {
      expect(tile).toBeGreaterThanOrEqual(0);
      expect(tile).toBeLessThan(64);
    }
    expect(Array.from(m.texIndex)).toContain(0);
  });

  it('empty chunk produces zero geometry', () => {
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    const m = meshChunk(w, 0, 0);
    expect(m.opaque.quadCount).toBe(0);
    expect(m.opaque.positions.length).toBe(0);
    expect(m.opaque.indices.length).toBe(0);
    expect(m.water.quadCount).toBe(0);
  });

  it('culls faces against solid neighbors across chunk boundaries', () => {
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    w.addChunk(new Chunk(-1, 0));
    w.setBlock(0, 64, 0, BLOCK.STONE);
    w.setBlock(-1, 64, 0, BLOCK.STONE);
    expect(opaque(w).quadCount).toBe(5);
  });

  it('grass uses top 0, side 1, bottom 2 tiles', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.GRASS);
    const m = opaque(w);
    const used = new Set(Array.from(m.texIndex));
    expect(used).toEqual(new Set([0, 1, 2]));
    expect(m.texIndex[8]).toBe(0); // 3rd quad = top face (FACES order)
    expect(m.texIndex[12]).toBe(2); // 4th quad = bottom face
  });

  it('uvs stay within 0..1 tile space on single-block quads', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    const m = opaque(w);
    for (const uv of m.uvs) {
      expect(uv === 0 || uv === 1).toBe(true);
    }
  });

  it('shades vary per face orientation', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    const m = opaque(w);
    expect(m.shades[8]).toBe(1.0);
    expect(m.shades[12]).toBe(0.5);
    expect(m.shades[0]).toBeCloseTo(0.72);
  });

  it('indices reference valid vertices', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    const m = opaque(w);
    const vertCount = m.positions.length / 3;
    for (const idx of m.indices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(vertCount);
    }
  });

  it('quad winding yields outward normals for all 6 faces', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    const m = opaque(w);
    const center = [5.5, 64.5, 5.5];
    const seen = new Set<string>();
    for (let q = 0; q < m.quadCount; q++) {
      const v = quadVerts(m, q);
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
      // emitted per-vertex normal agrees with the geometric one
      const nrm = quadNormal(m, q);
      expect(Math.sign(nrm[0])).toBe(expected[0]);
      expect(Math.sign(nrm[1])).toBe(expected[1]);
      expect(Math.sign(nrm[2])).toBe(expected[2]);
    }
    expect(seen).toEqual(
      new Set(['1,0,0', '-1,0,0', '0,1,0', '0,-1,0', '0,0,1', '0,0,-1']),
    );
  });

  it('side faces pin vv=0 at block bottom and vv=1 at block top', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    const m = opaque(w);
    let sideFaces = 0;
    for (let q = 0; q < m.quadCount; q++) {
      const v = quadVerts(m, q);
      if (v[0][1] === v[1][1] && v[1][1] === v[2][1]) continue; // top/bottom: constant y
      sideFaces++;
      for (let i = 0; i < 4; i++) {
        const y = v[i][1];
        expect(m.uvs[(q * 4 + i) * 2 + 1]).toBe(y === 64 ? 0 : 1);
      }
    }
    expect(sideFaces).toBe(4);
  });

  // ---- Greedy merging (Task 15) ----

  it('greedy: flat 16×16 top face of identical grass merges to ≤4 quads (was 256)', () => {
    const w = layer(BLOCK.GRASS, 64);
    const m = opaque(w);
    const topQuads = countQuads(m, [0, 1, 0]);
    expect(topQuads).toBeLessThanOrEqual(4); // 1 with a bleed-free texture array
    expect(topQuads).toBeLessThan(256); // the whole point: not one quad per block
    // whole layer: 768 visible faces collapse into a handful of quads
    expect(m.quadCount).toBeLessThanOrEqual(6);
  });

  it('greedy: merged quads repeat the tile once per block (uv in tile units)', () => {
    const w = layer(BLOCK.GRASS, 64);
    const m = opaque(w);
    // the merged top quad spans 16 blocks → uv reaches 16 (RepeatWrapping
    // keeps every block showing the full 16×16 tile, as before greedy)
    expect(Math.max(...m.uvs)).toBe(CHUNK_SIZE);
    expect(Math.min(...m.uvs)).toBe(0);
  });

  it('greedy: adjacent blocks with different ids never merge', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.GRASS);
    w.setBlock(6, 64, 5, BLOCK.DIRT);
    // grass bottom and dirt bottom share tile 2 (both DIRT texture) but are
    // different block ids → their coplanar faces must stay separate quads.
    expect(countQuads(opaque(w), [0, -1, 0])).toBe(2);
    expect(countQuads(opaque(w), [0, 1, 0])).toBe(2);
  });

  it('greedy: a flat 16×16 water layer also merges (light/tile/id in signature)', () => {
    const w = layer(BLOCK.WATER, 60);
    const m = water(w);
    expect(countQuads(m, [0, 1, 0])).toBeLessThanOrEqual(4);
    expect(opaque(w).quadCount).toBe(0); // water never lands in the opaque mesh
  });
});
