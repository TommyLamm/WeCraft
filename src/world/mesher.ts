import type { World } from './world';
import { getBlockDef, isTransparent, isCross, isSolid, BLOCK, type BlockDef } from './blocks';
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
  lightSky: Float32Array; // 1 per vert (角落平均的天空光 0..15，B6 Task 4)
  lightBlock: Float32Array; // 1 per vert (角落平均的方塊光 0..15，B6 Task 4)
  indices: Uint32Array;
  quadCount: number;
}

/** `meshChunk` output: opaque terrain, water, cross-shaped foliage and torches
 *  are meshed separately — Task 16 renders `water` in its own translucent pass,
 *  B3 Task 4 renders `foliage` (flower/grass cross models) in its own
 *  DoubleSide, shadow-free pass, B6 Task 6 renders `torches` (small
 *  collision-free boxes) in its own FrontSide, shadow-free pass. */
export interface ChunkMesh {
  opaque: MeshData;
  water: MeshData;
  foliage: MeshData;
  torches: MeshData;
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

/**
 * 合併簽章的位元配置（B6 Task 4 重排——32 bits 剛好塞滿，必須重排才塞得下
 * 8 位光照鍵）：
 * ```
 * bits 0..7   id（8）
 * bits 8..13  tile（6，貼圖層 0..63；ARRAY_LAYERS = 64）
 * bits 14..21 lightKey（8）：面向**前面那一格**的光照 byte（sky<<4 | block）
 * bits 22..29 aoKey（8，4 角 × 2 bits）
 * bit  30     water flag
 * bit  31     保留 0（簽章維持正 int32）
 * ```
 * 為什麼塞得下：原本的 `shadeKey`（7 bits）是**每個面方向固定**的（FACES 表的
 * `shade`），而 mask 本來就每方向重建 → `shade` 不需要進簽章，7 bits 直接讓給
 * 光照；`tile` 再從 8 bits 縮成 6 bits（tile ≤ 63 ✓）多出 2 bits。
 * 光照鍵進簽章 → 光照邊界自然切開貪心合併的 quad（明暗交界不焊接）。
 */
const LIGHT_SHIFT = 14;
const AO_SHIFT = 22;

/** Signature flag: this face belongs to the water mesh (Task 16 pass).
 *  Bit 30 (bit 31 stays 0 → the packed signature is a positive int32). */
const WATER_BIT = 1 << 30;

/** Merge signature of one visible face: id | tile<<8 | lightKey<<14 |
 *  aoKey<<22 | water-bit<<30. Faces merge only on an exact match — different
 *  block ids never merge even when they share a texture, a per-corner AO
 *  difference keeps differently shadowed faces from welding across the seam,
 *  and a light-level difference splits the merge along the light boundary. */
function faceSignature(
  id: number,
  tile: number,
  lightKey: number,
  aoKey: number,
  isWater: boolean,
): number {
  return (
    id | (tile << 8) | (lightKey << LIGHT_SHIFT) | (aoKey << AO_SHIFT) | (isWater ? WATER_BIT : 0)
  );
}

/**
 * 這一面的鄰居要不要畫。
 *
 * **注意（B3 Task 6 的已知現象）**：兩個「透明」方塊相鄰時，兩邊的接觸面都會
 * 被畫出來 → 冰（transparent）取代水面頂端那一格時，**冰的底面與水的頂面在
 * 同一個平面上各一片**（水材質 depthWrite: false → 可能是「水色疊加」而非
 * 閃爍；水下視角尚未驗收，列入批次末瀏覽器驗收待驗項）。根治需要獨立的
 * 透明 pass（渲染層改動，不在本批範圍）。
 */
function faceVisible(id: number, neighbor: number): boolean {
  if (neighbor === BLOCK.AIR) return true;
  if (id === neighbor) return false; // 同種相鄰（含玻璃/水內部）不畫
  if (!isTransparent(neighbor)) return false; // 鄰居不透明 → 被擋
  return true; // 鄰居透明 → 畫（含固體貼玻璃）
}

/** The eight neighbouring chunks' data (undefined = not loaded → acts as
 *  AIR). Diagonals exist for the per-vertex AO samples that reach a corner
 *  across both chunk axes at once. */
export interface NeighborChunks {
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
export type CornerSamples = [
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

// ── 頂點光照取樣（B6 Task 4）────────────────────────────────────────────────
//
// 資料來源是 `Chunk.light`（每格 1 byte：sky<<4 | block，lighting.ts 維護）。
// 取樣會越出本區塊 ±1 格（角落取樣踩到對角鄰塊）→ meshChunk 開頭一次把
// 3×3 群組的光照陣列解析進 lightGrid（索引 (dx+1)*3 + (dz+1)），之後每個
// 取樣都是 O(1) 陣列讀取——每個可見面要讀 17 次（面前格 1 次＋四角各 4 格），
// 逐次走 `world.getChunk` 的字串鍵 Map 會吃掉每幀 2 塊的網格預算（Task 3
// 在 lighting.ts 熱路徑做過同一筆帳）。取樣位移固定為 ±1 → 只會落在 3×3
// 群組內。缺席／未點光的區塊讀 0（與 lighting.ts 公開讀取的「缺席 = 暗」
// 規則一致；視距外緣 ring r+1 未點亮造成最外緣暗縫是預期行為，走近即亮）。

/** 3×3 群組的 `Chunk.light` 陣列（null／缺席 → undefined → 讀 0）。 */
type LightGrid = readonly (Uint8Array | undefined)[];

function resolveLightGrid(world: World, cx: number, cz: number): LightGrid {
  const grid: (Uint8Array | undefined)[] = new Array(9).fill(undefined);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      grid[(dx + 1) * 3 + (dz + 1)] = world.getChunk(cx + dx, cz + dz)?.light ?? undefined;
    }
  }
  return grid;
}

/** Light byte (sky<<4 | block) at chunk-local `cell + d`; the offset may step
 *  one chunk over (±1 only — the corner samples' reach). Out of world height /
 *  unlit / missing chunk → 0. */
function lightByteAt(
  grid: LightGrid,
  cell: readonly [number, number, number],
  d: readonly [number, number, number],
): number {
  const nx = cell[0] + d[0];
  const ny = cell[1] + d[1];
  const nz = cell[2] + d[2];
  if (ny < 0 || ny >= CHUNK_HEIGHT) return 0;
  const sx = nx < 0 ? -1 : nx >= CHUNK_SIZE ? 1 : 0;
  const sz = nz < 0 ? -1 : nz >= CHUNK_SIZE ? 1 : 0;
  const light = grid[(sx + 1) * 3 + (sz + 1)];
  if (!light) return 0;
  return light[chunkIndex(nx - sx * CHUNK_SIZE, ny, nz - sz * CHUNK_SIZE)];
}

/** 一個角落的平滑光照：取該角在**面向前面一側**周圍最多 4 格——面前那一格
 *  本身＋這個角的三個 AO 取樣格——的 sky/block 平均；**不透明格不列入**
 *  （不透明方塊不持有光，連分母都不佔）；沒有格可平均 → 0。
 *
 *  `samples` 是**單一角**的三個取樣位移（faceCornerSamples 的 emit 序），
 *  每個位移都已內含「向前面一步」的分量 → 面前那格可由三者推出：
 *  `front = s0 + s1 − s2`（逐分量；faceCornerSamples 的構造保證
 *  s0 = front + u、s1 = front + v、s2 = front + u + v）。
 *
 *  （brief 的 Produces 型別寫 `samples: readonly CornerSamples[]`，但「單格
 *  參數＋單一回傳」下沒有「第幾角」的選擇子，陣列版只能退成 brief 明文禁止
 *  的 anchor 平均 → 依 brief 自己的 Step 3 散文與設計決策〈角落平均〉收斂成
 *  單一 CornerSamples；偏離記錄在 task-4-report.md。） */
function cornerLightInGrid(
  grid: LightGrid,
  data: Uint8Array,
  cell: readonly [number, number, number],
  samples: CornerSamples,
  neighbors: NeighborChunks,
): { sky: number; block: number } {
  const front: [number, number, number] = [
    samples[0][0] + samples[1][0] - samples[2][0],
    samples[0][1] + samples[1][1] - samples[2][1],
    samples[0][2] + samples[1][2] - samples[2][2],
  ];
  let sky = 0;
  let block = 0;
  let n = 0;
  for (let i = 0; i < 4; i++) {
    const d = i === 0 ? front : samples[i - 1];
    if (!isTransparent(sampleAt(data, cell, d, neighbors))) continue; // 不透明格不持有光
    const b = lightByteAt(grid, cell, d);
    sky += b >> 4;
    block += b & 0x0f;
    n++;
  }
  return n === 0 ? { sky: 0, block: 0 } : { sky: sky / n, block: block / n };
}

/** {@link cornerLightInGrid} 的公開版（測試／跨模組取用）：現場解析 3×3 群組
 *  的光照陣列再做角落平均。熱路徑（meshChunk）請走內部版＋既有的 lightGrid。 */
export function cornerLight(
  world: World,
  cx: number,
  cz: number,
  cell: readonly [number, number, number],
  samples: CornerSamples,
  neighbors: NeighborChunks,
): { sky: number; block: number } {
  const home = world.getChunk(cx, cz);
  if (!home) return { sky: 0, block: 0 };
  return cornerLightInGrid(resolveLightGrid(world, cx, cz), home.data, cell, samples, neighbors);
}

interface MeshBuilder {
  positions: number[];
  normals: number[];
  uvs: number[];
  texIndex: number[];
  shades: number[];
  lightSky: number[];
  lightBlock: number[];
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
    lightSky: [],
    lightBlock: [],
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
    lightSky: new Float32Array(b.lightSky),
    lightBlock: new Float32Array(b.lightBlock),
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
 *  those corner levels are exact for all of them, not an approximation.
 *
 *  `cornerSky`／`cornerBlock` 則**不同於 AO**：它們是 caller 已經對「每個角
 *  所在格」各算一次角落平均的結果（emit 序、每頂點各 1 值，與 positions 同
 *  步推入）——合併 quad 不能共用 anchor 格的光照取樣（見 greedySweep emit）。 */
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
  cornerSky: readonly number[],
  cornerBlock: readonly number[],
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
    b.lightSky.push(cornerSky[i]);
    b.lightBlock.push(cornerBlock[i]);
  }
  b.indices.push(vertBase, vertBase + 1, vertBase + 2, vertBase + 2, vertBase + 1, vertBase + 3);
  b.quadCount++;
}

/** 1/√2 — the diagonal planes' normal components (the planes stand at 45°). */
const CROSS_NORMAL = Math.SQRT1_2;

/** Emit the two diagonal planes of one cross-shaped plant cell (B3 Task 4).
 *
 *  原版的十字模型：每格不是立方體，而是兩片互相垂直的對角平面（像一個 X），
 *  從任何角度看都像一株植物。平面 A 從格子角 (x,z) 連到 (x+1,z+1)，平面 B
 *  從 (x,z+1) 連到 (x+1,z)；兩片都是 y → y+1 的整格高。
 *
 *  **與原版的差異（計畫層級的取捨，不是疏漏）**：原版的十字模型是**內縮**的
 *  ——對角線不貫通整格、模型高度約 0.9 格（短草更矮，約 0.8）；本作依計畫 §7
 *  與 Task 4 的規格**逐字**採用「貫通整格、整格高」的簡化模型，好處是幾何規則
 *  單純、貼圖直接對到整格（不用再做 UV 內縮），代價是視覺上比原版略「滿」，
 *  且貼在牆角時會插進鄰格一點點。若之後要貼原版，需要同時調整本函式的角落
 *  座標與 `mesher.test.ts` 的幾何斷言（另開任務）。
 *
 *  - 法線是各自的平面法向量：(−1,0,1)/√2 與 (1,0,1)/√2 → 兩面都受光，
 *    材質是 DoubleSide 所以背面也看得見。
 *  - UV 是 0..1 的**單一** tile（不同於 cube pass 的「以格為單位」的 uv）。
 *  - **不做 AO**：cross 方塊是透明的 → 不是遮蔽者 → 也不會讓鄰邊變暗；
 *    所以每個頂點的 shade 直接填 1.0。
 *  - **光照（B6 Task 4，brief 指定的簡化）**：植被用**自己那一格**的光照
 *    （不透明與否同規則；不做角落平均——十字模型四個角都在同一格內，角落
 *    平均的收益趨近 0，且植被的 smooth lighting 原版也是逐格近似）。
 *  - 索引寫法比照 `emitQuad`（兩片平面各自 4 頂點 2 三角形）。 */
function emitCrossQuads(
  b: MeshBuilder,
  baseX: number,
  baseZ: number,
  lx: number,
  ly: number,
  lz: number,
  tile: number,
  lightSky: number,
  lightBlock: number,
): void {
  const x = baseX + lx;
  const y = ly;
  const z = baseZ + lz;
  const planes: ReadonlyArray<{
    corners: ReadonlyArray<readonly [number, number, number]>;
    normal: readonly [number, number, number];
  }> = [
    {
      // 平面 A：(x,y,z) → (x+1,y,z+1) 對角
      corners: [
        [x, y, z],
        [x + 1, y, z + 1],
        [x, y + 1, z],
        [x + 1, y + 1, z + 1],
      ],
      normal: [-CROSS_NORMAL, 0, CROSS_NORMAL],
    },
    {
      // 平面 B：(x,y,z+1) → (x+1,y,z) 對角
      corners: [
        [x, y, z + 1],
        [x + 1, y, z],
        [x, y + 1, z + 1],
        [x + 1, y + 1, z],
      ],
      normal: [CROSS_NORMAL, 0, CROSS_NORMAL],
    },
  ];
  const uvs: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ];
  for (const plane of planes) {
    const vertBase = b.positions.length / 3;
    for (let i = 0; i < 4; i++) {
      const c = plane.corners[i];
      b.positions.push(c[0], c[1], c[2]);
      b.normals.push(plane.normal[0], plane.normal[1], plane.normal[2]);
      b.uvs.push(uvs[i][0], uvs[i][1]);
      b.texIndex.push(tile);
      b.shades.push(1.0); // cross 不做 AO
      b.lightSky.push(lightSky);
      b.lightBlock.push(lightBlock);
    }
    b.indices.push(vertBase, vertBase + 1, vertBase + 2, vertBase + 2, vertBase + 1, vertBase + 3);
    b.quadCount++;
  }
}

// ── 火把的小模型（B6 Task 6）────────────────────────────────────────────────

/** 火把的依附方向（由世界推導，**不存狀態**）。區塊資料是「1 格 1 byte 的
 *  block id」，沒有 block state 的空間 → 依附方向改成查表推導：存檔往返只會
 *  帶 block id 32、不會掉方向，且規則可測。代價：玩家不能指定牆面（四面都
 *  靠著時取固定優先序）——寫進 README〈與原版的差異〉。 */
export type TorchAttach = 'floor' | 'wall+x' | 'wall-x' | 'wall+z' | 'wall-z' | 'free';

/** 由世界推導火把的依附方向：下方實心 → 立在地上（floor）；否則依 +x、−x、
 *  +z、−z 的固定優先序找第一個實心水平鄰居 → 貼對應牆面；都沒有 → free
 *  （懸空——`popUnsupportedTorches` 據此把失去支撐的火把收回）。
 *
 *  支撐判定與 lighting.ts 的 `isFullSupport` 是**同一條 isSolid 規則**（玻璃
 *  算、cross 植被與水不算）。這裡內聯 `isSolid` 而不 import isFullSupport：
 *  lighting.ts 的 popUnsupportedTorches 會 import 本函式，反向再 import 會
 *  形成 lighting → mesher → lighting 的循環依賴；一行謂詞的語意由兩側測試
 *  各自釘住（canPlaceTorch／torchAttachAt 的行為測試即等價性守門）。 */
export function torchAttachAt(world: World, x: number, y: number, z: number): TorchAttach {
  if (isSolid(world.getBlock(x, y - 1, z))) return 'floor';
  if (isSolid(world.getBlock(x + 1, y, z))) return 'wall+x';
  if (isSolid(world.getBlock(x - 1, y, z))) return 'wall-x';
  if (isSolid(world.getBlock(x, y, z + 1))) return 'wall+z';
  if (isSolid(world.getBlock(x, y, z - 1))) return 'wall-z';
  return 'free';
}

/** 火把小模型的尺寸（原版模型：寬 2 像素、高 10 像素；1 像素 = 1/16 格）。 */
const TORCH_BOX_W = 2 / 16;
const TORCH_BOX_H = 10 / 16;

/** Emit the six faces of one torch's small box (B6 Task 6).
 *
 *  盒子立在格子底部（y = [cellY, cellY + 10/16]）；`floor`／`free` 時 x/z 置中
 *  （x + 0.5 ± w/2），貼牆時沿該軸貼到支撐面（wall+x → x = [x+1−w, x+1]、
 *  wall-x → x = [x, x+w]，z 同理）。**不貪心合併**——每個火把固定 6 個 quad、
 *  數量極少。六個面直接重用 cube pass 的 FACES 表（同一套 uFlip/vFlip 角序 →
 *  纏繞方向與 cube pass 逐面一致，FrontSide 材質下六面都朝外）；UV 每面整張
 *  tile（[0,0]–[1,1]，同 cross pass 的單 tile 慣例，火把盒面把整張圖壓進
 *  2×10 像素）；**不做 AO**（小盒子做 AO 會出現黑邊，shade 直接用面亮度）；
 *  **光照用火把自己那一格**（不做角落平均——火把格本身持有 emission 14，
 *  等價於「自身亮」，與植被 pass 的逐格簡化同一筆帳）。 */
function emitTorchBox(
  b: MeshBuilder,
  baseX: number,
  baseZ: number,
  lx: number,
  ly: number,
  lz: number,
  def: BlockDef,
  attach: TorchAttach,
  lightSky: number,
  lightBlock: number,
): void {
  const x = baseX + lx;
  const y = ly;
  const z = baseZ + lz;
  // x/z 盒範圍：預設置中（floor／free），貼牆時貼到支撐那一側
  let x0 = x + 0.5 - TORCH_BOX_W / 2;
  let x1 = x + 0.5 + TORCH_BOX_W / 2;
  let z0 = z + 0.5 - TORCH_BOX_W / 2;
  let z1 = z + 0.5 + TORCH_BOX_W / 2;
  if (attach === 'wall+x') {
    x0 = x + 1 - TORCH_BOX_W;
    x1 = x + 1;
  } else if (attach === 'wall-x') {
    x0 = x;
    x1 = x + TORCH_BOX_W;
  } else if (attach === 'wall+z') {
    z0 = z + 1 - TORCH_BOX_W;
    z1 = z + 1;
  } else if (attach === 'wall-z') {
    z0 = z;
    z1 = z + TORCH_BOX_W;
  }
  const ext: ReadonlyArray<readonly [number, number]> = [
    [x0, x1], // axis 0（x）
    [y, y + TORCH_BOX_H], // axis 1（y）
    [z0, z1], // axis 2（z）
  ];
  const uvs: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ];
  for (const face of FACES) {
    const plane = face.dir[face.nAxis] > 0 ? ext[face.nAxis][1] : ext[face.nAxis][0];
    const u0 = face.uFlip ? ext[face.uAxis][1] : ext[face.uAxis][0];
    const u1 = face.uFlip ? ext[face.uAxis][0] : ext[face.uAxis][1];
    const v0 = face.vFlip ? ext[face.vAxis][1] : ext[face.vAxis][0];
    const v1 = face.vFlip ? ext[face.vAxis][0] : ext[face.vAxis][1];
    const corners: ReadonlyArray<readonly [number, number]> = [
      [u0, v0],
      [u1, v0],
      [u0, v1],
      [u1, v1],
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
      b.texIndex.push(def[face.tileKey]);
      b.shades.push(face.shade); // 面亮度照 FACES 表；不做 AO
      b.lightSky.push(lightSky);
      b.lightBlock.push(lightBlock);
    }
    b.indices.push(vertBase, vertBase + 1, vertBase + 2, vertBase + 2, vertBase + 1, vertBase + 3);
    b.quadCount++;
  }
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
 *  (block, tile, front-cell light, packed per-corner AO); rectangles of
 *  identical signature collapse into one quad — a light-level difference
 *  splits the merge along the light boundary (B6 Task 4). Water cells are
 *  split into their own mesh (Task 16 renders them translucently). */
export function meshChunk(world: World, cx: number, cz: number): ChunkMesh {
  const chunk = world.getChunk(cx, cz);
  if (!chunk) {
    return {
      opaque: finish(createBuilder()),
      water: finish(createBuilder()),
      foliage: finish(createBuilder()),
      torches: finish(createBuilder()),
    };
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
  const lightGrid = resolveLightGrid(world, cx, cz); // B6 Task 4：3×3 光照陣列一次解析
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;
  const opaqueB = createBuilder();
  const waterB = createBuilder();
  const foliageB = createBuilder();
  const torchesB = createBuilder();

  for (const face of FACES) {
    const nDim = AXIS_SIZE[face.nAxis];
    const uDim = AXIS_SIZE[face.uAxis];
    const vDim = AXIS_SIZE[face.vAxis];
    // Face brightness (constant per direction) 不再進簽章（B6 Task 4 重排）：
    // mask 本來就每方向重建 → shade 在 emitQuad 時由 face.shade 套上即可。
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
          // cross 植被與火把不進 cube pass（各走專屬 pass，B3 Task 4／B6 Task 6）
          if (isCross(id) || getBlockDef(id).shape === 'torch') continue;
          if (!faceVisible(id, sampleAt(data, cell, face.dir, neighbors))) continue;
          const tile = getBlockDef(id)[face.tileKey];
          const aoKey = faceAoKey(data, cell, samples, neighbors);
          // 光照鍵 = 面向**前面那一格**的光（牆面顯示的是它前面那格空氣的光，
          // 與原版一致——不是方塊自身的光）。byte 本身就是 sky<<4 | block。
          const lightKey = lightByteAt(lightGrid, cell, face.dir);
          mask[au + av * uDim] = faceSignature(id, tile, lightKey, aoKey, id === BLOCK.WATER);
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
            const tile = (sig >> 8) & 0x3f;
            const aoKey = (sig >> AO_SHIFT) & 0xff;
            const u0 = face.uFlip ? au + w : au;
            const u1 = face.uFlip ? au : au + w;
            const v0 = face.vFlip ? av + h : av;
            const v1 = face.vFlip ? av : av + h;
            // 合併 quad 的四個角各用「該角所在格」的取樣：emit 角 u0v0／u1v0／
            // u0v1／u1v1 分別貼著 (uLo,vLo)／(uHi,vLo)／(uLo,vHi)／(uHi,vHi)
            // 格（uFlip／vFlip 時 uLo/uHi、vLo/vHi 對調）——每個角各算一次
            // 角落平均，**不得共用 anchor 格的取樣**，否則 16 格大的地板會出
            // 現一道線性漸層、光邊界錯位。
            const uLo = face.uFlip ? au + w - 1 : au;
            const uHi = face.uFlip ? au : au + w - 1;
            const vLo = face.vFlip ? av + h - 1 : av;
            const vHi = face.vFlip ? av : av + h - 1;
            const cu = [uLo, uHi, uLo, uHi];
            const cv = [vLo, vLo, vHi, vHi];
            const cornerSky: number[] = [];
            const cornerBlock: number[] = [];
            for (let k = 0; k < 4; k++) {
              const cc: [number, number, number] = [0, 0, 0];
              cc[face.nAxis] = s;
              cc[face.uAxis] = cu[k];
              cc[face.vAxis] = cv[k];
              const cl = cornerLightInGrid(lightGrid, data, cc, samples[k], neighbors);
              cornerSky.push(cl.sky);
              cornerBlock.push(cl.block);
            }
            emitQuad(b, face, slicePlane, u0, u1, v0, v1, tile, aoKey, cornerSky, cornerBlock, baseX, baseZ);
          },
        );
      };
      sweep(opaqueB, false); // clears every opaque cell…
      sweep(waterB, true); // …so leftovers are exactly the water cells
    }
  }

  // ---- cross ＋ torch pass（B3 Task 4／B6 Task 6）----
  // 整個 chunk 掃一遍（65,536 格）找 cross 植被與火把；相對既有 6 個面方向的
  // 掃描可忽略（兩者共用同一趟掃描）。兩者都不與相鄰方塊合併（每株植物／每個
  // 火把都是獨立的小模型，數量極少）。
  for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const id = data[chunkIndex(lx, ly, lz)];
        if (id === BLOCK.AIR) continue;
        const def = getBlockDef(id);
        // 植被與火把都用**自己那一格**的光照（不做角落平均 → 見各自 emitter 的註解）
        if (def.shape === 'cross') {
          const l = chunk.light ? chunk.light[chunkIndex(lx, ly, lz)] : 0;
          emitCrossQuads(foliageB, baseX, baseZ, lx, ly, lz, def.top, l >> 4, l & 0x0f);
        } else if (def.shape === 'torch') {
          const l = chunk.light ? chunk.light[chunkIndex(lx, ly, lz)] : 0;
          // 依附方向由世界推導（世界座標＝本區塊基底＋本地座標）→ 貼牆／立地
          // 不需要任何方塊狀態；支撐跨區塊時 world.getBlock 也讀得到。
          emitTorchBox(
            torchesB,
            baseX,
            baseZ,
            lx,
            ly,
            lz,
            def,
            torchAttachAt(world, baseX + lx, ly, baseZ + lz),
            l >> 4,
            l & 0x0f,
          );
        }
      }
    }
  }

  return {
    opaque: finish(opaqueB),
    water: finish(waterB),
    foliage: finish(foliageB),
    torches: finish(torchesB),
  };
}
