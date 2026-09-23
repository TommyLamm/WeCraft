import type { World } from './world';
import { getBlockDef, isTransparent, BLOCK } from './blocks';
import { CHUNK_SIZE, CHUNK_HEIGHT, chunkIndex } from './chunk';

export interface ChunkMeshData {
  positions: Float32Array; // 3 per vert
  uvs: Float32Array; // 2 per vert (0..1 within tile)
  layers: Float32Array; // 1 per vert (tile index)
  shades: Float32Array; // 1 per vert (face brightness 0..1)
  indices: Uint32Array;
  quadCount: number;
}

type Face = {
  dir: [number, number, number];
  corners: [number, number, number][];
  shade: number;
  tileKey: 'top' | 'side' | 'bottom';
};

const FACES: Face[] = [
  { dir: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 1], [1, 1, 0]], shade: 0.72, tileKey: 'side' },
  { dir: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1]], shade: 0.72, tileKey: 'side' },
  { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]], shade: 1.0, tileKey: 'top' },
  { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]], shade: 0.5, tileKey: 'bottom' },
  { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]], shade: 0.86, tileKey: 'side' },
  { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]], shade: 0.86, tileKey: 'side' },
];

// vv=0 at block bottom; pairs with CanvasTexture flipY=true + bakeAtlasUvs — do not flip.
const UV_C = [0, 0, 1, 0, 0, 1, 1, 1];

function faceVisible(id: number, neighbor: number): boolean {
  if (neighbor === BLOCK.AIR) return true;
  if (id === neighbor) return false; // 同種相鄰（含玻璃/水內部）不畫
  if (!isTransparent(neighbor)) return false; // 鄰居不透明 → 被擋
  return true; // 鄰居透明 → 畫（含固體貼玻璃）
}

export function meshChunk(world: World, cx: number, cz: number): ChunkMeshData {
  const positions: number[] = [];
  const uvs: number[] = [];
  const layers: number[] = [];
  const shades: number[] = [];
  const indices: number[] = [];
  let quadCount = 0;

  const chunk = world.getChunk(cx, cz);
  if (!chunk) {
    return {
      positions: new Float32Array(0),
      uvs: new Float32Array(0),
      layers: new Float32Array(0),
      shades: new Float32Array(0),
      indices: new Uint32Array(0),
      quadCount: 0,
    };
  }

  const data = chunk.data;
  const xpData = world.getChunk(cx + 1, cz)?.data;
  const xmData = world.getChunk(cx - 1, cz)?.data;
  const zpData = world.getChunk(cx, cz + 1)?.data;
  const zmData = world.getChunk(cx, cz - 1)?.data;

  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;

  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const id = data[chunkIndex(lx, y, lz)];
        if (id === BLOCK.AIR) continue;
        const def = getBlockDef(id);
        const wx = baseX + lx;
        const wz = baseZ + lz;

        for (const face of FACES) {
          const dir = face.dir;
          const nx = lx + dir[0];
          const ny = y + dir[1];
          const nz = lz + dir[2];
          let neighbor: number;
          if (ny < 0 || ny >= CHUNK_HEIGHT) {
            neighbor = BLOCK.AIR;
          } else if (nx >= 0 && nx < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE) {
            neighbor = data[chunkIndex(nx, ny, nz)];
          } else {
            let nd: Uint8Array | undefined;
            let nlx = nx;
            let nlz = nz;
            if (nx < 0) {
              nd = xmData;
              nlx = nx + CHUNK_SIZE;
            } else if (nx >= CHUNK_SIZE) {
              nd = xpData;
              nlx = nx - CHUNK_SIZE;
            } else if (nz < 0) {
              nd = zmData;
              nlz = nz + CHUNK_SIZE;
            } else {
              nd = zpData;
              nlz = nz - CHUNK_SIZE;
            }
            neighbor = nd ? nd[chunkIndex(nlx, ny, nlz)] : BLOCK.AIR;
          }
          if (!faceVisible(id, neighbor)) continue;

          const tile = def[face.tileKey];
          const vertBase = positions.length / 3;
          for (let i = 0; i < 4; i++) {
            const c = face.corners[i];
            positions.push(wx + c[0], y + c[1], wz + c[2]);
            uvs.push(UV_C[i * 2], UV_C[i * 2 + 1]);
            layers.push(tile);
            shades.push(face.shade);
          }
          indices.push(vertBase, vertBase + 1, vertBase + 2, vertBase + 2, vertBase + 1, vertBase + 3);
          quadCount++;
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    layers: new Float32Array(layers),
    shades: new Float32Array(shades),
    indices: new Uint32Array(indices),
    quadCount,
  };
}
