import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT } from './chunk';
import {
  BLOCK,
  type BlockId,
  isSolid as blockIsSolid,
  isTargetable as blockIsTargetable,
} from './blocks';
import { markLightDirty } from './lighting';

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
    // B6 光照：(a) 天空光柱掃描上界只增不減；(b) 本區塊與八個鄰塊（含對角）
    // 標記需要重算光照——BFS 走 6 鄰居時會經過正交鄰塊寫進對角區塊，只標
    // 4 個正交鄰塊會在對角留下永久幽靈光（由 markLightDirty 內處理八鄰）。
    // 注意這是光照專用的旗標，與上面網格用的 markDirty 是兩套，不混用。
    chunk.topY = Math.max(chunk.topY, y + 1);
    markLightDirty(this, cx, cz);
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

  /** 「可被瞄準／挖掘命中」的方塊（B3 Task 5）＝**實心方塊 ＋ cross 植被**。
   *
   *  - 與 `isSolid` 的差別：cross 植被（花／草）**不碰撞**（走過去不會被擋），
   *    但必須**能被射線命中**——玩家要能瞄準它、把它挖掉（硬度 0 → 瞬破）。
   *  - 水與空氣**不可命中**（射線直接穿過水面）。
   *  - 越界（y 超出世界高度、座標落在未載入的區塊）→ `getBlock` 回空氣 → false。 */
  isTargetable(x: number, y: number, z: number): boolean {
    return blockIsTargetable(this.getBlock(x, y, z));
  }
}
