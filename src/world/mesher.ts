import type { World } from './world';
import { getBlockDef, isTransparent, BLOCK } from './blocks';
import { CHUNK_SIZE, CHUNK_HEIGHT, chunkIndex } from './chunk';

/** One greedily-merged mesh: four unshared vertices per quad. `texIndex`,
 *  `normals` and `shades` are plain numbers — world/ stays Three-free. */
export interface MeshData {
  positions: Float32Array; // 3 per vert (world space)
  normals: Float32Array; // 3 per vert (outward face normal, constant per quad)
  uvs: Float32Array; // 2 per vert — TILE UNITS, [0..w]×[0..h] over the merged
  // quad; RepeatWrapping re-samples the tile once per block so merged faces
  // look exactly like the old one-quad-per-block faces
  texIndex: Float32Array; // 1 per vert (texture-array layer = atlas tile)
  shades: Float32Array; // 1 per vert (face brightness × AO, 0..1 → vertex color)
  indices: Uint32Array;
  quadCount: number;
}

/** `meshChunk` output: opaque terrain and water are meshed separately —
 *  Task 16 renders `water` in its own translucent pass. */
export interface ChunkMesh {
  opaque: MeshData;
  water: MeshData;
}

/** One visible face direction, described for greedy meshing: the normal axis
 *  plus the two in-plane axes the texture u/v run along. `uFlip`/`vFlip` mark
 *  axes where the coordinate grows toward the MIN edge — the four corners of
 *  any rectangle on this plane are then (u0/u1 × v0/v1), which reproduces the
 *  exact winding + UV orientation of the old per-block FACES table. */
type GreedyFace = {
  dir: [number, number, number];
  nAxis: 0 | 1 | 2;
  uAxis: 0 | 1 | 2;
  uFlip: boolean;
  vAxis: 0 | 1 | 2;
  vFlip: boolean;
  shade: number;
  tileKey: 'top' | 'side' | 'bottom';
};

// The u/v axis picks below reproduce, for every direction, the vertex order
// and UV orientation of the old per-block FACES table (corners [u0,v0],
// [u1,v0], [u0,v1], [u1,v1] against UVs [0,0], [w,0], [0,h], [w,h]) — so the
// winding tests and the side-face "vv pinned to the tile top" contract hold.
const FACES: GreedyFace[] = [
  { dir: [1, 0, 0], nAxis: 0, uAxis: 2, uFlip: true, vAxis: 1, vFlip: false, shade: 0.72, tileKey: 'side' },
  { dir: [-1, 0, 0], nAxis: 0, uAxis: 2, uFlip: false, vAxis: 1, vFlip: false, shade: 0.72, tileKey: 'side' },
  { dir: [0, 1, 0], nAxis: 1, uAxis: 0, uFlip: false, vAxis: 2, vFlip: true, shade: 1.0, tileKey: 'top' },
  { dir: [0, -1, 0], nAxis: 1, uAxis: 0, uFlip: false, vAxis: 2, vFlip: false, shade: 0.5, tileKey: 'bottom' },
  { dir: [0, 0, 1], nAxis: 2, uAxis: 0, uFlip: false, vAxis: 1, vFlip: false, shade: 0.86, tileKey: 'side' },
  { dir: [0, 0, -1], nAxis: 2, uAxis: 0, uFlip: true, vAxis: 1, vFlip: false, shade: 0.86, tileKey: 'side' },
];

/** Chunk extent per axis: [x, y, z]. */
const AXIS_SIZE: readonly [number, number, number] = [CHUNK_SIZE, CHUNK_HEIGHT, CHUNK_SIZE];

/** Per-vertex occlusion levels 0..3 (unshadowed) → shade multiplier. */
const AO_FACTORS = [0.5, 0.7, 0.85, 1.0];

/** Bit 23 of the signature: start of the packed per-corner AO (2 bits per
 *  corner, emitQuad order). `shadeKey` ≤ 100 occupies 7 bits below it. */
const AO_SHIFT = 23;

/** Signature flag: this face belongs to the water mesh (Task 16 pass).
 *  Bit 31 so the AO bits below it stay intact in the Int32 mask. */
const WATER_BIT = 1 << 31;

/** Merge signature of one visible face: id | tile<<8 | shadeKey<<16 |
 *  aoKey<<23 | water-bit<<31. Faces merge only on an exact match — different
 *  block ids never merge even when they share a texture, and a per-corner AO
 *  difference keeps differently shadowed faces from welding across the seam. */
function faceSignature(
  id: number,
  tile: number,
  shadeKey: number,
  aoKey: number,
  isWater: boolean,
): number {
  return id | (tile << 8) | (shadeKey << 16) | (aoKey << AO_SHIFT) | (isWater ? WATER_BIT : 0);
}

function faceVisible(id: number, neighbor: number): boolean {
  if (neighbor === BLOCK.AIR) return true;
  if (id === neighbor) return false; // 同種相鄰（含玻璃/水內部）不畫
  if (!isTransparent(neighbor)) return false; // 鄰居不透明 → 被擋
  return true; // 鄰居透明 → 畫（含固體貼玻璃）
}

/** The eight neighbouring chunks' data (undefined = not loaded → acts as
 *  AIR). Diagonals exist for the per-vertex AO samples that reach a corner
 *  across both chunk axes at once. */
interface NeighborChunks {
  xp: Uint8Array | undefined;
  xm: Uint8Array | undefined;
  zp: Uint8Array | undefined;
  zm: Uint8Array | undefined;
  xpzp: Uint8Array | undefined;
  xpzm: Uint8Array | undefined;
  xmzp: Uint8Array | undefined;
  xmzm: Uint8Array | undefined;
}

/** Block id at `cell + d`; x/z may spill into a neighbour chunk — a single
 *  axis or a diagonal step; out-of-height is AIR (same rule the old
 *  per-block mesher used). */
function sampleAt(
  data: Uint8Array,
  cell: readonly [number, number, number],
  d: readonly [number, number, number],
  neighbors: NeighborChunks,
): number {
  const nx = cell[0] + d[0];
  const ny = cell[1] + d[1];
  const nz = cell[2] + d[2];
  if (ny < 0 || ny >= CHUNK_HEIGHT) return BLOCK.AIR;
  const sx = nx < 0 ? -1 : nx >= CHUNK_SIZE ? 1 : 0;
  const sz = nz < 0 ? -1 : nz >= CHUNK_SIZE ? 1 : 0;
  if (sx === 0 && sz === 0) return data[chunkIndex(nx, ny, nz)];
  let nd: Uint8Array | undefined;
  if (sx === 0) nd = sz < 0 ? neighbors.zm : neighbors.zp;
  else if (sz === 0) nd = sx < 0 ? neighbors.xm : neighbors.xp;
  else if (sx < 0) nd = sz < 0 ? neighbors.xmzm : neighbors.xmzp;
  else nd = sz < 0 ? neighbors.xpzm : neighbors.xpzp;
  return nd ? nd[chunkIndex(nx - sx * CHUNK_SIZE, ny, nz - sz * CHUNK_SIZE)] : BLOCK.AIR;
}

/** The three occluder samples hugging one emitted corner: the edge step
 *  along u, the edge step along v, and their diagonal — all on the face's
 *  front plane (one block off the face). */
type CornerSamples = [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

/** Sample offsets of `face`'s four corners in emit order (u0v0, u1v0, u0v1,
 *  u1v1). `uFlip`/`vFlip` mirror the in-plane steps so each sample points
 *  inward from the corner actually being emitted. */
function faceCornerSamples(face: GreedyFace): CornerSamples[] {
  const a = face.uFlip ? 1 : -1;
  const b = face.vFlip ? 1 : -1;
  const su = [a, -a, a, -a];
  const sv = [b, b, -b, -b];
  const out: CornerSamples[] = [];
  for (let k = 0; k < 4; k++) {
    // every sample starts one block into the face's front plane
    const u: [number, number, number] = [0, 0, 0];
    u[face.nAxis] = face.dir[face.nAxis];
    u[face.uAxis] = su[k];
    const v: [number, number, number] = [0, 0, 0];
    v[face.nAxis] = face.dir[face.nAxis];
    v[face.vAxis] = sv[k];
    const d: [number, number, number] = [0, 0, 0];
    d[face.nAxis] = face.dir[face.nAxis];
    d[face.uAxis] = su[k];
    d[face.vAxis] = sv[k];
    out.push([u, v, d]);
  }
  return out;
}

/** AO level 0..3 of one corner: both edge neighbours blocked → 0 (a hard
 *  corner), otherwise one step of darkening per blocked sample. Only opaque
 *  blocks occlude — glass/water/leaves are transparent. */
function cornerAo(
  data: Uint8Array,
  cell: readonly [number, number, number],
  samples: CornerSamples,
  neighbors: NeighborChunks,
): number {
  const occU = !isTransparent(sampleAt(data, cell, samples[0], neighbors));
  const occV = !isTransparent(sampleAt(data, cell, samples[1], neighbors));
  const occD = !isTransparent(sampleAt(data, cell, samples[2], neighbors));
  if (occU && occV) return 0;
  return 3 - (occU ? 1 : 0) - (occV ? 1 : 0) - (occD ? 1 : 0);
}

/** Packed AO of one face cell: 2 bits per emitted corner, corner order =
 *  emitQuad. Identical packs merge; a corner-level difference splits the
 *  merge along the shadow seam. */
function faceAoKey(
  data: Uint8Array,
  cell: readonly [number, number, number],
  samples: readonly CornerSamples[],
  neighbors: NeighborChunks,
): number {
  let key = 0;
  for (let k = 0; k < 4; k++) key |= cornerAo(data, cell, samples[k], neighbors) << (2 * k);
  return key;
}

interface MeshBuilder {
  positions: number[];
  normals: number[];
  uvs: number[];
  texIndex: number[];
  shades: number[];
  indices: number[];
  quadCount: number;
}

function createBuilder(): MeshBuilder {
  return {
    positions: [],
    normals: [],
    uvs: [],
    texIndex: [],
    shades: [],
    indices: [],
    quadCount: 0,
  };
}

function finish(b: MeshBuilder): MeshData {
  return {
    positions: new Float32Array(b.positions),
    normals: new Float32Array(b.normals),
    uvs: new Float32Array(b.uvs),
    texIndex: new Float32Array(b.texIndex),
    shades: new Float32Array(b.shades),
    indices: new Uint32Array(b.indices),
    quadCount: b.quadCount,
  };
}

/** Append one merged quad covering cells [u-edge0..u-edge1] × [v-edge0..v-edge1]
 *  on the face plane. UVs are tile units (0/extent), so a 16-wide quad spans
 *  uv 0..16 and RepeatWrapping shows the tile 16 times — every block keeps the
 *  exact texture it had before greedy merging. `aoKey` is the anchor cell's
 *  packed per-corner AO — the levels for the rect's four corners in emit
 *  order. Every cell of the rect carries the same pack (equal signature), so
 *  those corner levels are exact for all of them, not an approximation. */
function emitQuad(
  b: MeshBuilder,
  face: GreedyFace,
  plane: number,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  tile: number,
  aoKey: number,
  baseX: number,
  baseZ: number,
): void {
  const w = Math.abs(u1 - u0);
  const h = Math.abs(v1 - v0);
  const corners: [number, number][] = [
    [u0, v0],
    [u1, v0],
    [u0, v1],
    [u1, v1],
  ];
  const uvs: [number, number][] = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ];
  const vertBase = b.positions.length / 3;
  for (let i = 0; i < 4; i++) {
    const local: [number, number, number] = [0, 0, 0];
    local[face.nAxis] = plane;
    local[face.uAxis] = corners[i][0];
    local[face.vAxis] = corners[i][1];
    b.positions.push(baseX + local[0], local[1], baseZ + local[2]);
    b.normals.push(face.dir[0], face.dir[1], face.dir[2]);
    b.uvs.push(uvs[i][0], uvs[i][1]);
    b.texIndex.push(tile);
    b.shades.push(face.shade * AO_FACTORS[(aoKey >> (2 * i)) & 3]);
  }
  b.indices.push(vertBase, vertBase + 1, vertBase + 2, vertBase + 2, vertBase + 1, vertBase + 3);
  b.quadCount++;
}

/** Greedy rectangle expansion over one slice's mask (0 = not in this sweep):
 *  grow width while the signature matches, then height while every cell of
 *  the candidate rows matches, emit the quad, clear the consumed cells. */
function greedySweep(
  mask: Int32Array,
  uDim: number,
  vDim: number,
  accept: (sig: number) => boolean,
  emit: (au: number, av: number, w: number, h: number, sig: number) => void,
): void {
  for (let av = 0; av < vDim; av++) {
    for (let au = 0; au < uDim; au++) {
      const sig = mask[au + av * uDim];
      if (!accept(sig)) continue;
      let w = 1;
      while (au + w < uDim && mask[au + w + av * uDim] === sig) w++;
      let h = 1;
      let canGrow = true;
      while (canGrow && av + h < vDim) {
        for (let i = 0; i < w; i++) {
          if (mask[au + i + (av + h) * uDim] !== sig) {
            canGrow = false;
            break;
          }
        }
        if (canGrow) h++;
      }
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++) mask[au + i + (av + j) * uDim] = 0;
      emit(au, av, w, h, sig);
    }
  }
}

/** Greedy-mesh one chunk. Per face direction (±x/±y/±z) and per slice along
 *  the normal axis, visible faces form a 2D mask keyed by merge signature
 *  (block, tile, face brightness, packed per-corner AO); rectangles of
 *  identical signature collapse into one quad. Water cells are split into
 *  their own mesh (Task 16 renders them translucently). */
export function meshChunk(world: World, cx: number, cz: number): ChunkMesh {
  const chunk = world.getChunk(cx, cz);
  if (!chunk) {
    return { opaque: finish(createBuilder()), water: finish(createBuilder()) };
  }

  const data = chunk.data;
  const neighbors: NeighborChunks = {
    xp: world.getChunk(cx + 1, cz)?.data,
    xm: world.getChunk(cx - 1, cz)?.data,
    zp: world.getChunk(cx, cz + 1)?.data,
    zm: world.getChunk(cx, cz - 1)?.data,
    xpzp: world.getChunk(cx + 1, cz + 1)?.data,
    xpzm: world.getChunk(cx + 1, cz - 1)?.data,
    xmzp: world.getChunk(cx - 1, cz + 1)?.data,
    xmzm: world.getChunk(cx - 1, cz - 1)?.data,
  };
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;
  const opaqueB = createBuilder();
  const waterB = createBuilder();

  for (const face of FACES) {
    const nDim = AXIS_SIZE[face.nAxis];
    const uDim = AXIS_SIZE[face.uAxis];
    const vDim = AXIS_SIZE[face.vAxis];
    // Face brightness (constant per direction) keeps its signature slots;
    // the per-cell AO pack sits just above it and can split merges.
    const shadeKey = Math.round(face.shade * 100);
    const samples = faceCornerSamples(face);
    const mask = new Int32Array(uDim * vDim);
    const cell: [number, number, number] = [0, 0, 0];

    for (let s = 0; s < nDim; s++) {
      mask.fill(0);
      let any = false;
      for (let av = 0; av < vDim; av++) {
        for (let au = 0; au < uDim; au++) {
          cell[face.nAxis] = s;
          cell[face.uAxis] = au;
          cell[face.vAxis] = av;
          const id = data[chunkIndex(cell[0], cell[1], cell[2])];
          if (id === BLOCK.AIR) continue;
          if (!faceVisible(id, sampleAt(data, cell, face.dir, neighbors))) continue;
          const tile = getBlockDef(id)[face.tileKey];
          const aoKey = faceAoKey(data, cell, samples, neighbors);
          mask[au + av * uDim] = faceSignature(id, tile, shadeKey, aoKey, id === BLOCK.WATER);
          any = true;
        }
      }
      if (!any) continue;

      const slicePlane = s + (face.dir[face.nAxis] > 0 ? 1 : 0);
      const sweep = (b: MeshBuilder, wantWater: boolean): void => {
        greedySweep(
          mask,
          uDim,
          vDim,
          (sig) => sig !== 0 && ((sig & WATER_BIT) !== 0) === wantWater,
          (au, av, w, h, sig) => {
            const tile = (sig >> 8) & 0xff;
            const aoKey = (sig >> AO_SHIFT) & 0xff;
            const u0 = face.uFlip ? au + w : au;
            const u1 = face.uFlip ? au : au + w;
            const v0 = face.vFlip ? av + h : av;
            const v1 = face.vFlip ? av : av + h;
            emitQuad(b, face, slicePlane, u0, u1, v0, v1, tile, aoKey, baseX, baseZ);
          },
        );
      };
      sweep(opaqueB, false); // clears every opaque cell…
      sweep(waterB, true); // …so leftovers are exactly the water cells
    }
  }

  return { opaque: finish(opaqueB), water: finish(waterB) };
}
