import { describe, it, expect } from 'vitest';
import { meshChunk, cornerLight, type MeshData, type CornerSamples } from './mesher';
import { World } from './world';
import { Chunk, CHUNK_SIZE } from './chunk';
import { BLOCK, type BlockId } from './blocks';
import { setLight } from './lighting';

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

/** Every quad facing `dir`, as its four vertex positions and per-vertex shades. */
function dirQuads(
  m: MeshData,
  dir: [number, number, number],
): Array<{ verts: number[][]; shades: number[] }> {
  const out: Array<{ verts: number[][]; shades: number[] }> = [];
  for (let q = 0; q < m.quadCount; q++) {
    const nrm = quadNormal(m, q);
    if (nrm[0] !== dir[0] || nrm[1] !== dir[1] || nrm[2] !== dir[2]) continue;
    const verts = quadVerts(m, q);
    out.push({ verts, shades: verts.map((_, i) => m.shades[q * 4 + i]) });
  }
  return out;
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

// ---- B3 Task 4: cross 型植被的 foliage pass ----

describe('cross foliage pass', () => {
  /** The foliage mesh of chunk (cx, cz). */
  function foliage(w: World, cx = 0, cz = 0): MeshData {
    return meshChunk(w, cx, cz).foliage;
  }

  /** The (x,z) corner pairs of quad `q`, sorted and joined — a cross plane has
   *  exactly two distinct (x,z) pairs (它的兩個底部角點)。同一條對角線的兩片
   *  會得到**同一個**字串 → 這就是「A／B 是不是同一條對角線」的判別依據。 */
  function quadDiagonal(m: MeshData, q: number): string {
    const pairs = new Set(quadVerts(m, q).map((v) => `${v[0]},${v[2]}`));
    return [...pairs].sort().join(' | ');
  }

  it('a cross block produces two diagonal quads in the foliage mesh', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.DANDELION);
    const m = meshChunk(w, 0, 0);
    expect(m.foliage.quadCount).toBe(2);
    expect(m.opaque.quadCount).toBe(0); // cross 不進 cube pass
    expect(m.water.quadCount).toBe(0);
  });

  it('the foliage quads span the full cell diagonally', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.DANDELION);
    const m = foliage(w);
    expect(m.quadCount).toBe(2);
    for (let q = 0; q < m.quadCount; q++) {
      const verts = quadVerts(m, q);
      // 每個頂點都落在方塊格 (5,5) 的對角線上：x、z 各 ∈ {5, 6}
      expect(verts.every((v) => v[0] === 5 || v[0] === 6)).toBe(true);
      expect(verts.every((v) => v[2] === 5 || v[2] === 6)).toBe(true);
      // 每片平面在 x 與 z 各跨越 1 格（不是整格牆面）
      const xs = verts.map((v) => v[0]);
      const zs = verts.map((v) => v[2]);
      expect(Math.max(...xs) - Math.min(...xs)).toBe(1);
      expect(Math.max(...zs) - Math.min(...zs)).toBe(1);
      // 高度是整格（y → y+1），不是貼地的一片
      const ys = verts.map((v) => v[1]);
      expect(Math.min(...ys)).toBe(64);
      expect(Math.max(...ys)).toBe(65);
    }
  });

  // ---- B3 Task 4 審查 I-1：兩片必須是**不同的**對角線，且各有自己的法線 ----
  // 前一版斷言只檢查「x、z 各跨 1 格」，兩片畫在同一條對角線上也會綠 → 補釘。
  it('the two foliage planes lie on DIFFERENT diagonals', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.DANDELION);
    const m = foliage(w);
    expect(m.quadCount).toBe(2);
    const diagonals = [quadDiagonal(m, 0), quadDiagonal(m, 1)];
    // A 片走 (5,5)→(6,6)、B 片走 (5,6)→(6,5)：兩條對角線不可相同
    expect(new Set(diagonals).size).toBe(2);
    expect([...diagonals].sort()).toEqual(['5,5 | 6,6', '5,6 | 6,5']);
  });

  it('each foliage plane carries its own 45° normal, and the winding agrees', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.DANDELION);
    const m = foliage(w);
    const S = Math.SQRT1_2;
    // A 片（對角 (5,5)→(6,6)）法線 (−1/√2, 0, 1/√2)；B 片（(5,6)→(6,5)）法線 (1/√2, 0, 1/√2)
    const expected: Record<string, [number, number, number]> = {
      '5,5 | 6,6': [-S, 0, S],
      '5,6 | 6,5': [S, 0, S],
    };
    // 兩片的法線必須一負一正（各自面向不同方向）——兩片同對角線時會變成同號而紅
    const nx = [0, 1].map((q) => quadNormal(m, q)[0]);
    expect(nx[0] * nx[1]).toBeLessThan(0);
    for (let q = 0; q < m.quadCount; q++) {
      const key = quadDiagonal(m, q);
      const want = expected[key];
      expect(want, `unknown diagonal ${key}`).toBeDefined();
      // 頂點法線欄位（法線存在 Float32Array 裡 → 1/√2 只有約 1.2e-8 的誤差，
      // 精度 6 位（±5e-7）足夠嚴格又不會被 float32 誤差咬到）
      const nrm = quadNormal(m, q);
      expect(nrm[0]).toBeCloseTo(want[0], 6);
      expect(nrm[1]).toBeCloseTo(want[1], 6);
      expect(nrm[2]).toBeCloseTo(want[2], 6);
      // winding：幾何法線（由頂點順序算出，長度 √2）正規化後必須與法線欄位同向
      const v = quadVerts(m, q);
      const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
      const e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
      const geo = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const len = Math.hypot(geo[0], geo[1], geo[2]);
      expect(geo[0] / len).toBeCloseTo(want[0], 6);
      expect(geo[1] / len).toBeCloseTo(want[1], 6);
      expect(geo[2] / len).toBeCloseTo(want[2], 6);
    }
  });

  it('the foliage quads use one tile of UV', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.DANDELION);
    const m = foliage(w);
    for (let q = 0; q < m.quadCount; q++) {
      const uvs = Array.from(m.uvs.slice(q * 8, q * 8 + 8));
      expect(Math.max(...uvs)).toBe(1);
      expect(Math.min(...uvs)).toBe(0);
    }
  });

  it('foliage quads are fully lit (no AO) and use exactly one whole tile of UV', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.DANDELION);
    const m = foliage(w);
    for (let q = 0; q < m.quadCount; q++) {
      // cross 不做 AO：每個頂點都是滿亮度 1.0（cross 透明 → 不是遮蔽者）
      for (let i = 0; i < 4; i++) {
        expect(m.shades[q * 4 + i]).toBe(1.0);
      }
      // UV 剛好是一整個 tile：[0,0] [1,0] [0,1] [1,1]
      const uvs = Array.from(m.uvs.slice(q * 8, q * 8 + 8));
      expect(uvs).toEqual([0, 0, 1, 0, 0, 1, 1, 1]);
    }
  });

  it('cross blocks do not occlude AO', () => {
    // 石頭頂面的 AO 取樣會踩到旁邊的 cross 植被格 → 植被若不透明就會變暗
    const bare = worldWithBlock(0, 0, 0, BLOCK.STONE);
    const withPlant = worldWithBlock(0, 0, 0, BLOCK.STONE);
    withPlant.setBlock(1, 1, 0, BLOCK.DANDELION);
    const a = dirQuads(opaque(bare), [0, 1, 0]);
    const b = dirQuads(opaque(withPlant), [0, 1, 0]);
    expect(a.length).toBeGreaterThan(0);
    expect(b).toHaveLength(a.length);
    for (let q = 0; q < a.length; q++) {
      expect(b[q].verts).toEqual(a[q].verts);
      expect(b[q].shades).toEqual(a[q].shades);
    }
  });

  it('a chunk without plants has an empty foliage mesh', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    const m = meshChunk(w, 0, 0);
    expect(m.foliage.quadCount).toBe(0);
    expect(m.foliage.positions.length).toBe(0);
    expect(m.foliage.indices.length).toBe(0);
  });

  it('every cross plant emits its own two quads (multiple plants in one chunk)', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.DANDELION);
    w.setBlock(7, 64, 5, BLOCK.POPPY);
    w.setBlock(9, 64, 5, BLOCK.SHORT_GRASS);
    const m = foliage(w);
    expect(m.quadCount).toBe(6); // 三株 × 兩片對角平面
    expect(m.indices.length).toBe(6 * 6);
    // 每個 cross 方塊用自己的 tile（花／草各不相同）
    const tiles = new Set(Array.from(m.texIndex));
    expect(tiles.size).toBe(3);
  });
});

// ---- Per-vertex ambient occlusion (Task 2) ----

describe('per-vertex AO', () => {
  /** The single-cell grass top quad at plane `y` (its occluders' own top
   *  faces sit one plane higher, so the y filter picks the grass one). */
  function topQuadAt(m: MeshData, y: number): { verts: number[][]; shades: number[] } {
    const quads = dirQuads(m, [0, 1, 0]).filter((q) => q.verts.every((p) => p[1] === y));
    expect(quads).toHaveLength(1);
    return quads[0];
  }

  it('isolated faces keep full shade', () => {
    const m = opaque(worldWithBlock(5, 64, 5, BLOCK.GRASS));
    const top = dirQuads(m, [0, 1, 0]);
    expect(top).toHaveLength(1);
    for (const shade of top[0].shades) expect(shade).toBe(1.0);
  });

  it('one side occluder darkens the touching corners to 0.85', () => {
    const w = worldWithBlock(0, 0, 0, BLOCK.GRASS);
    w.setBlock(1, 1, 0, BLOCK.STONE); // beside the top face's +x edge
    const { verts, shades } = topQuadAt(opaque(w), 1);
    for (let i = 0; i < 4; i++) expect(shades[i]).toBeCloseTo(verts[i][0] === 1 ? 0.85 : 1.0, 5);
  });

  it('two adjacent sides darken the meeting corner to 0.5', () => {
    const w = worldWithBlock(0, 0, 0, BLOCK.GRASS);
    w.setBlock(1, 1, 0, BLOCK.STONE); // +x side
    w.setBlock(0, 1, 1, BLOCK.STONE); // +z side
    const { verts, shades } = topQuadAt(opaque(w), 1);
    for (let i = 0; i < 4; i++) {
      const [x, , z] = verts[i];
      expect(shades[i]).toBeCloseTo(x === 1 && z === 1 ? 0.5 : x === 1 || z === 1 ? 0.85 : 1.0, 5);
    }
  });

  it('a diagonal-only occluder darkens the corner to 0.85', () => {
    const w = worldWithBlock(0, 0, 0, BLOCK.GRASS);
    w.setBlock(1, 1, 1, BLOCK.STONE); // touches only the (1,1) corner of the top face
    const { verts, shades } = topQuadAt(opaque(w), 1);
    for (let i = 0; i < 4; i++) {
      const [x, , z] = verts[i];
      expect(shades[i]).toBeCloseTo(x === 1 && z === 1 ? 0.85 : 1.0, 5);
    }
  });

  it('a side plus a diagonal occluder darken the corner to 0.7', () => {
    const w = worldWithBlock(0, 0, 0, BLOCK.GRASS);
    w.setBlock(1, 1, 0, BLOCK.STONE); // +x side
    w.setBlock(1, 1, 1, BLOCK.STONE); // diagonal of the (1,1) corner
    const { verts, shades } = topQuadAt(opaque(w), 1);
    for (let i = 0; i < 4; i++) {
      const [x, , z] = verts[i];
      expect(shades[i]).toBeCloseTo(x === 1 && z === 1 ? 0.7 : x === 1 ? 0.85 : 1.0, 5);
    }
  });

  it('transparent blocks never occlude (glass, water, leaves)', () => {
    const w = worldWithBlock(0, 0, 0, BLOCK.GRASS);
    w.setBlock(1, 1, 0, BLOCK.GLASS);
    w.setBlock(0, 1, 1, BLOCK.WATER);
    w.setBlock(1, 1, 1, BLOCK.LEAVES);
    const { shades } = topQuadAt(opaque(w), 1);
    for (const shade of shades) expect(shade).toBe(1.0);
  });

  it('merge seam splits only where AO differs', () => {
    const w = layer(BLOCK.GRASS, 64);
    for (let z = 0; z < CHUNK_SIZE; z++) w.setBlock(16, 65, z, BLOCK.STONE); // wall beside the +x edge
    const m = opaque(w);
    // Verified seams: the wall row's contact makes the x=15 column's +x
    // corners 0.7 along the interior (side + diagonal occluder), but only
    // 0.85 at the two end cells (their outward diagonal sample is AIR), so
    // the lit 15×16 region is one quad and the border column becomes three.
    expect(countQuads(m, [0, 1, 0])).toBe(4);
    // The +x faces see the same wall through their top corners (0.7 interior,
    // 0.85 at the two z-ends) → three quads instead of one.
    expect(countQuads(m, [1, 0, 0])).toBe(3);
    // Faces whose AO samples never reach the wall stay fully merged.
    expect(countQuads(m, [0, -1, 0])).toBe(1);
    expect(countQuads(m, [-1, 0, 0])).toBe(1);
    expect(countQuads(m, [0, 0, 1])).toBe(1);
    expect(countQuads(m, [0, 0, -1])).toBe(1);
    // control: identical AO everywhere keeps an unwalled face a single quad
    expect(countQuads(opaque(layer(BLOCK.GRASS, 64)), [0, 1, 0])).toBe(1);
  });

  it('samples across chunk borders: walls in the ±x and diagonal neighbours', () => {
    const w = layer(BLOCK.GRASS, 64);
    // one block past each z edge (−1 and 16) so every border cell's diagonal
    // sample is wall too: each border column then has identical corner AO
    for (let z = -1; z <= CHUNK_SIZE; z++) {
      w.setBlock(16, 65, z, BLOCK.STONE); // +x neighbour chunk + its z diagonals
      w.setBlock(-1, 65, z, BLOCK.STONE); // -x neighbour chunk + its z diagonals
    }
    const m = opaque(w);
    expect(countQuads(m, [0, 1, 0])).toBe(3); // two darkened columns + lit middle
    for (const q of dirQuads(m, [0, 1, 0]))
      for (let i = 0; i < 4; i++) {
        const x = q.verts[i][0];
        expect(q.shades[i]).toBeCloseTo(x === 0 || x === 16 ? 0.7 : 1.0, 5);
      }
  });

  it('samples across chunk borders: diagonal neighbour chunk', () => {
    const w = layer(BLOCK.GRASS, 64);
    w.setBlock(16, 65, 16, BLOCK.STONE); // diagonal chunk (1,1), touching only the (16,16) corner
    const m = opaque(w);
    for (const q of dirQuads(m, [0, 1, 0]))
      for (let i = 0; i < 4; i++) {
        const [x, , z] = q.verts[i];
        expect(q.shades[i]).toBeCloseTo(x === 16 && z === 16 ? 0.85 : 1.0, 5);
      }
  });

  it('flipped faces map corners correctly', () => {
    // +x face (uFlip on z): occluder beside the +z edge of the front cell
    const w = worldWithBlock(0, 64, 0, BLOCK.STONE);
    w.setBlock(1, 64, 1, BLOCK.STONE);
    const px = dirQuads(opaque(w), [1, 0, 0]).filter((q) => q.verts.every((p) => p[0] === 1));
    expect(px).toHaveLength(1);
    for (let i = 0; i < 4; i++)
      expect(px[0].shades[i]).toBeCloseTo(px[0].verts[i][2] === 1 ? 0.72 * 0.85 : 0.72);

    // -z face (uFlip on x): occluder beside the +x edge of the front cell
    const w2 = worldWithBlock(0, 64, 0, BLOCK.STONE);
    w2.setBlock(1, 64, -1, BLOCK.STONE);
    const nz = dirQuads(opaque(w2), [0, 0, -1]).filter((q) => q.verts.every((p) => p[2] === 0));
    expect(nz).toHaveLength(1);
    for (let i = 0; i < 4; i++)
      expect(nz[0].shades[i]).toBeCloseTo(nz[0].verts[i][0] === 1 ? 0.86 * 0.85 : 0.86);
  });
});

// ---- B6 Task 4: 頂點光照（lightSky／lightBlock 屬性、光照鍵切分合併、角落平均）----

describe('mesh lighting (B6 Task 4)', () => {
  /** meshChunk 同款的鄰塊取樣窗（供 cornerLight 直測用）。 */
  function neighborsOf(w: World, cx: number, cz: number) {
    return {
      xp: w.getChunk(cx + 1, cz)?.data,
      xm: w.getChunk(cx - 1, cz)?.data,
      zp: w.getChunk(cx, cz + 1)?.data,
      zm: w.getChunk(cx, cz - 1)?.data,
      xpzp: w.getChunk(cx + 1, cz + 1)?.data,
      xpzm: w.getChunk(cx + 1, cz - 1)?.data,
      xmzp: w.getChunk(cx - 1, cz + 1)?.data,
      xmzm: w.getChunk(cx - 1, cz - 1)?.data,
    };
  }

  /** y=65 面上唯一一個朝上的 quad：四個頂點座標＋每頂點的兩條光照。 */
  function topQuadAt65(m: MeshData): {
    verts: number[][];
    sky: number[];
    block: number[];
  } {
    for (let q = 0; q < m.quadCount; q++) {
      const verts = quadVerts(m, q);
      if (quadNormal(m, q)[1] === 1 && verts.every((p) => p[1] === 65)) {
        return {
          verts,
          sky: [0, 1, 2, 3].map((i) => m.lightSky[q * 4 + i]),
          block: [0, 1, 2, 3].map((i) => m.lightBlock[q * 4 + i]),
        };
      }
    }
    throw new Error('no up-facing quad at y=65');
  }

  it('faces with different light do not merge', () => {
    // 地板左半（x=0..1）上方的空氣格亮 14（火把旁）、右半全暗 → 光照鍵取
    // 「面向前面那一格」的光 → 兩半的合併簽章不同 → 朝上的面切成兩個 quad。
    const w = layer(BLOCK.GRASS, 64);
    for (let z = 0; z < CHUNK_SIZE; z++) {
      setLight(w, 0, 65, z, { sky: 0, block: 14 });
      setLight(w, 1, 65, z, { sky: 0, block: 14 });
    }
    expect(countQuads(opaque(w), [0, 1, 0])).toBe(2);
    // control：沒有光照差異的同一層仍是一整片 → 切分只來自光照鍵
    expect(countQuads(opaque(layer(BLOCK.GRASS, 64)), [0, 1, 0])).toBe(1);
  });

  it('vertex light is the corner average of the non opaque neighbours', () => {
    // 單一地板方塊，對角上方的空氣格亮 14（模擬火把光）→ 頂面唯一一個 quad，
    // 靠近亮格的頂點拿到角落平均 (0+0+0+14)/4 = 3.5，對角的頂點為 0。
    const w = worldWithBlock(0, 64, 0, BLOCK.GRASS);
    setLight(w, 1, 65, 1, { sky: 0, block: 14 });
    const { verts, sky, block } = topQuadAt65(opaque(w));
    for (const v of [...sky, ...block]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(15);
    }
    const nearAt = verts.findIndex((p) => p[0] === 1 && p[2] === 1);
    const farAt = verts.findIndex((p) => p[0] === 0 && p[2] === 0);
    expect(nearAt).toBeGreaterThanOrEqual(0);
    expect(farAt).toBeGreaterThanOrEqual(0);
    expect(block[nearAt]).toBeGreaterThan(0);
    expect(block[nearAt]).toBeLessThan(15);
    expect(block[nearAt]).toBeCloseTo(3.5, 5); // (front 0 + u 0 + v 0 + diag 14) / 4
    expect(block[farAt]).toBeLessThan(block[nearAt]); // 背對光源的一端較暗
    expect(sky[nearAt]).toBe(0); // 只設了方塊光 → 天空光通道不受影響
  });

  it('a merged quad uses each corner cell light, not the anchor cell', () => {
    // 2×2 地板、火把在西側（鄰塊的空氣格亮 14）：四格的「面前格光」都是 0 →
    // 頂面仍合併成**一個** quad；但每個頂點要取「該角所在格」的角落平均 ——
    // 若實作誤用 anchor 格的取樣，四個角會是同一組值。
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    w.addChunk(new Chunk(-1, 0)); // 火把亮格住在西側鄰塊（必須先存在）
    for (let x = 0; x <= 1; x++)
      for (let z = 0; z <= 1; z++) w.setBlock(x, 64, z, BLOCK.GRASS);
    setLight(w, -1, 65, 0, { sky: 0, block: 14 });
    setLight(w, -1, 65, 1, { sky: 0, block: 14 });
    const { verts, sky, block } = topQuadAt65(opaque(w));
    // 前置：真的合併成一個 quad（否則這條測試什麼都沒釘到）
    expect(verts).toHaveLength(4);
    expect(new Set(block).size).toBeGreaterThan(1); // 四個角不是同一組值
    for (let i = 0; i < 4; i++) {
      if (verts[i][0] === 0) {
        // 兩個靠火把的角（西緣）：(front 0 + 西側 14 + 其餘 0) / 4
        expect(block[i]).toBeCloseTo(3.5, 5);
      } else {
        // 兩個背對的角：全 0
        expect(block[i]).toBe(0);
      }
      expect(sky[i]).toBe(0);
    }
  });

  it('the mesh carries one light attribute per vertex', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.GRASS);
    w.setBlock(7, 65, 5, BLOCK.DANDELION);
    const m = meshChunk(w, 0, 0);
    for (const mesh of [m.opaque, m.water, m.foliage]) {
      expect(mesh.lightSky.length).toBe(mesh.positions.length / 3);
      expect(mesh.lightBlock.length).toBe(mesh.positions.length / 3);
    }
    // 植被 pass 同樣帶光照（用自己那一格的光、不做角落平均 → 8 頂點各一值）
    expect(m.foliage.quadCount).toBe(2);
    expect(m.foliage.lightBlock.length).toBe(8);
  });

  it('cornerLight averages the corner cells and skips opaque ones', () => {
    // 地板 (0,64,0) 頂面的 (x=0,z=0) 角：取樣 = 前方 (0,65,0) ＋ u 鄰 (−1,65,0)
    // ＋ v 鄰 (0,65,−1) ＋ 對角 (−1,65,−1)。西側鄰塊的空氣格亮 14 → 平均 3.5。
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    w.addChunk(new Chunk(-1, 0));
    w.setBlock(0, 64, 0, BLOCK.GRASS);
    setLight(w, -1, 65, 0, { sky: 0, block: 14 });
    // 頂面 corner 2 的三個取樣（su=−1、sv=−1；已內含 +y 的面前位移）
    const samples: CornerSamples = [
      [-1, 1, 0],
      [0, 1, -1],
      [-1, 1, -1],
    ];
    const lit = cornerLight(w, 0, 0, [0, 64, 0], samples, neighborsOf(w, 0, 0));
    expect(lit.sky).toBe(0);
    expect(lit.block).toBeCloseTo(3.5, 5);
    // 不透明格**不列入**平均（連分母都不佔）：把亮格換成石頭（光值仍在——
    // setBlock 不清 light）→ 若實作把不透明格算進分母，這裡會是 14/4 而非 0
    w.setBlock(-1, 65, 0, BLOCK.STONE);
    const dark = cornerLight(w, 0, 0, [0, 64, 0], samples, neighborsOf(w, 0, 0));
    expect(dark.block).toBe(0);
  });
});
