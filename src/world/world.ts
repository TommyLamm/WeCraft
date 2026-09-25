import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT } from './chunk';
import { BLOCK, type BlockId, isSolid as blockIsSolid } from './blocks';

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export class World {
  readonly chunks = new Map<string, Chunk>();
  /** Block edits vs. generated terrain, keyed `"x,y,z"` → blockId (AIR kept). */
  readonly modified = new Map<string, number>();

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
    this.modified.set(`${x},${y},${z}`, id);
    return true;
  }

  markDirty(cx: number, cz: number): void {
    const c = this.getChunk(cx, cz);
    if (c) c.dirty = true;
  }

  /** All block edits as `"x,y,z"` → blockId pairs (for the save payload). */
  serializeModified(): Array<[string, number]> {
    return [...this.modified.entries()];
  }

  /** Restore block edits from a save. Malformed / out-of-range entries are
   *  skipped; valid ones route through setBlock (auto chunk + dirty flag). */
  applyModified(pairs: Array<[string, number]>): void {
    for (const entry of pairs) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [key, id] = entry as [unknown, unknown];
      if (typeof key !== 'string' || !Number.isInteger(id)) continue;
      if (!/^-?\d+,-?\d+,-?\d+$/.test(key)) continue;
      const [x, y, z] = key.split(',').map(Number);
      if (y < 0 || y >= CHUNK_HEIGHT) continue;
      this.setBlock(x, y, z, id as BlockId);
    }
  }

  /** Re-apply every recorded edit inside chunk (cx, cz) — the Task 14
   *  load-order fix. Terrain generation fills chunks wholesale
   *  (`chunk.data.set(terrain)`) and that fill can run AFTER `applyModified`
   *  (or a session edit) auto-created the chunk with `generated === false`,
   *  wiping the edits; this call re-wins them over regenerated terrain.
   *  main.ts invokes it from the gen response handler (both branches) and
   *  from spawnPoint's synchronous generation. Routes through setBlock, so
   *  the chunk is marked dirty for re-mesh and edge edits dirty neighbors.
   *  Keys in `modified` are always setBlock-written (well-formed) — no
   *  untrusted-parse guards needed here, unlike applyModified (save data). */
  reapplyModifiedInChunk(cx: number, cz: number): void {
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    // snapshot: setBlock writes back into `modified` while we iterate
    for (const [key, id] of [...this.modified]) {
      const parts = key.split(',');
      if (parts.length !== 3) continue; // defensive: never setBlock-written
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      const z = Number(parts[2]);
      if (y < 0 || y >= CHUNK_HEIGHT) continue;
      if (x < x0 || x >= x0 + CHUNK_SIZE || z < z0 || z >= z0 + CHUNK_SIZE) continue;
      this.setBlock(x, y, z, id as BlockId);
    }
  }

  /** Drop EVERYTHING — chunks and recorded edits (Task 14 review #4: New Game
   *  must be a fresh world; sessions share one boot World in main.ts). Mesh
   *  removal is the composition root's job (chunkRenderer), this only owns
   *  world data. The world stays reusable — setBlock auto-creates chunks again. */
  clear(): void {
    this.chunks.clear();
    this.modified.clear();
  }

  isSolid(x: number, y: number, z: number): boolean {
    return blockIsSolid(this.getBlock(x, y, z));
  }
}
