import { BLOCK } from './blocks';

export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 256;

export function chunkIndex(lx: number, ly: number, lz: number): number {
  return lx + lz * CHUNK_SIZE + ly * CHUNK_SIZE * CHUNK_SIZE;
}

export class Chunk {
  readonly cx: number;
  readonly cz: number;
  readonly data: Uint8Array;
  dirty = true;
  generated = false;

  constructor(cx: number, cz: number, data?: Uint8Array) {
    this.cx = cx;
    this.cz = cz;
    this.data = data ?? new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
  }

  get(lx: number, ly: number, lz: number): number {
    if (ly < 0 || ly >= CHUNK_HEIGHT) return BLOCK.AIR;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return BLOCK.AIR;
    return this.data[chunkIndex(lx, ly, lz)];
  }

  set(lx: number, ly: number, lz: number, id: number): void {
    if (ly < 0 || ly >= CHUNK_HEIGHT) return;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
    this.data[chunkIndex(lx, ly, lz)] = id;
    this.dirty = true;
  }
}
