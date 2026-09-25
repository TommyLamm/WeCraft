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
  shades: Float32Array; // 1 per vert (face brightness 0..1 → vertex color)
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

/** Signature flag: this face belongs to the water mesh (Task 16 pass). */
const WATER_BIT = 1 << 24;

/** Merge signature of one visible face: block id | tile<<8 | shade<<16 |
 *  water-bit. Faces merge only on an exact match — different block ids never
 *  merge even when they share a texture. The shade bits are RESERVED for
 *  per-cell light (AO/skylight): today the shade is constant per face
 *  direction (it comes from the FACES table), so it can never split a merge —
 *  but a future per-cell light term entering this key will keep differently
 *  lit faces from welding across a light seam. */
function faceSignature(id: number, tile: number, shadeKey: number, isWater: boolean): number {
  return id | (tile << 8) | (shadeKey << 16) | (isWater ? WATER_BIT : 0);
}

function faceVisible(id: number, neighbor: number): boolean {
  if (neighbor === BLOCK.AIR) return true;
  if (id === neighbor) return false; // 同種相鄰（含玻璃/水內部）不畫
  if (!isTransparent(neighbor)) return false; // 鄰居不透明 → 被擋
  return true; // 鄰居透明 → 畫（含固體貼玻璃）
}

/** The four neighbouring chunks' data (undefined = not loaded → acts as AIR). */
interface NeighborChunks {
  xp: Uint8Array | undefined;
  xm: Uint8Array | undefined;
  zp: Uint8Array | undefined;
  zm: Uint8Array | undefined;
}

/** Block id at `cell + dir`; x/z may spill into the four neighbour chunks,
 *  out-of-height is AIR (same rule the old per-block mesher used). */
function neighborId(
  data: Uint8Array,
  cell: readonly [number, number, number],
  dir: readonly [number, number, number],
  neighbors: NeighborChunks,
): number {
  const nx = cell[0] + dir[0];
  const ny = cell[1] + dir[1];
  const nz = cell[2] + dir[2];
  if (ny < 0 || ny >= CHUNK_HEIGHT) return BLOCK.AIR;
  if (nx >= 0 && nx < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE) {
    return data[chunkIndex(nx, ny, nz)];
  }
  let nd: Uint8Array | undefined;
  let nlx = nx;
  let nlz = nz;
  if (nx < 0) {
    nd = neighbors.xm;
    nlx = nx + CHUNK_SIZE;
  } else if (nx >= CHUNK_SIZE) {
    nd = neighbors.xp;
    nlx = nx - CHUNK_SIZE;
  } else if (nz < 0) {
    nd = neighbors.zm;
    nlz = nz + CHUNK_SIZE;
  } else {
    nd = neighbors.zp;
    nlz = nz - CHUNK_SIZE;
  }
  return nd ? nd[chunkIndex(nlx, ny, nlz)] : BLOCK.AIR;
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
 *  exact texture it had before greedy merging. */
function emitQuad(
  b: MeshBuilder,
  face: GreedyFace,
  plane: number,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  tile: number,
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
    b.shades.push(face.shade);
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
 *  the normal axis, visible faces form a 2D mask keyed by merge signature;
 *  rectangles of identical signature collapse into one quad. Water cells are
 *  split into their own mesh (Task 16 renders them translucently). */
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
  };
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;
  const opaqueB = createBuilder();
  const waterB = createBuilder();

  for (const face of FACES) {
    const nDim = AXIS_SIZE[face.nAxis];
    const uDim = AXIS_SIZE[face.uAxis];
    const vDim = AXIS_SIZE[face.vAxis];
    // Reserved per-cell light slot in the signature — constant per direction
    // today (FACES.shade; no AO/skylight exists yet), so it never splits merges
    const shadeKey = Math.round(face.shade * 100);
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
          if (!faceVisible(id, neighborId(data, cell, face.dir, neighbors))) continue;
          const tile = getBlockDef(id)[face.tileKey];
          mask[au + av * uDim] = faceSignature(id, tile, shadeKey, id === BLOCK.WATER);
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
            const u0 = face.uFlip ? au + w : au;
            const u1 = face.uFlip ? au : au + w;
            const v0 = face.vFlip ? av + h : av;
            const v1 = face.vFlip ? av : av + h;
            emitQuad(b, face, slicePlane, u0, u1, v0, v1, tile, baseX, baseZ);
          },
        );
      };
      sweep(opaqueB, false); // clears every opaque cell…
      sweep(waterB, true); // …so leftovers are exactly the water cells
    }
  }

  return { opaque: finish(opaqueB), water: finish(waterB) };
}
