import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT } from './chunk';
import { BLOCK, type BlockId, isSolid as blockIsSolid } from './blocks';

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export class World {
  readonly chunks = new Map<string, Chunk>();
  readonly modified = new Set<string>();

  hasChunk(cx: number, cz: number): boolean {
    return this.chunks.has(chunkKey(cx, cz));
  }

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  addChunk(chunk: Chunk): void {
    this.chunks.set(chunkKey(chunk.cx, chunk.cz), chunk);
  }

  removeChunk(cx: number, cz: number): void {
    this.chunks.delete(chunkKey(cx, cz));
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0 || y >= CHUNK_HEIGHT) return BLOCK.AIR;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return BLOCK.AIR;
    return chunk.get(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE);
  }

  setBlock(x: number, y: number, z: number, id: BlockId): boolean {
    if (y < 0 || y >= CHUNK_HEIGHT) return false;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    let chunk = this.getChunk(cx, cz);
    if (!chunk) {
      chunk = new Chunk(cx, cz);
      this.addChunk(chunk);
    }
    const lx = x - cx * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;
    chunk.set(lx, y, lz, id);
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
    this.modified.add(chunkKey(cx, cz));
    return true;
  }

  markDirty(cx: number, cz: number): void {
    const c = this.getChunk(cx, cz);
    if (c) c.dirty = true;
  }

  isSolid(x: number, y: number, z: number): boolean {
    return blockIsSolid(this.getBlock(x, y, z));
  }
}
