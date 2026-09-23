import type { World } from './world';
import { getBlockDef, isTransparent, isSolid, BLOCK } from './blocks';
import { CHUNK_SIZE, CHUNK_HEIGHT } from './chunk';

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

const UV_C = [0, 0, 1, 0, 0, 1, 1, 1];

function faceVisible(id: number, neighbor: number): boolean {
  if (neighbor === BLOCK.AIR) return true;
  if (id === neighbor) return false; // 同種相鄰（含玻璃/水內部）不畫
  if (!isTransparent(neighbor)) return false; // 鄰居不透明 → 被擋
  if (neighbor === BLOCK.GLASS && isSolid(id)) return false; // 固體貼玻璃：共用面兩側都不畫
  return true; // 鄰居透明 → 畫
}

export function meshChunk(world: World, cx: number, cz: number): ChunkMeshData {
  const positions: number[] = [];
  const uvs: number[] = [];
  const layers: number[] = [];
  const shades: number[] = [];
  const indices: number[] = [];
  let quadCount = 0;

  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;

  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = baseX + lx;
        const wz = baseZ + lz;
        const id = world.getBlock(wx, y, wz);
        if (id === BLOCK.AIR) continue;
        const def = getBlockDef(id);

        for (const face of FACES) {
          const neighbor = world.getBlock(
            wx + face.dir[0],
            y + face.dir[1],
            wz + face.dir[2],
          );
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
