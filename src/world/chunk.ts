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
  /** 每格 1 byte：bit 7..4 = 天空光、bit 3..0 = 方塊光；null = 尚未點光。
   *  延遲配置（B6）：只有被點過光的區塊才有陣列，隨區塊卸載一起釋放。
   *  光照是導出資料，不入存檔。索引與方塊資料同 layout（`chunkIndex`）。 */
  light: Uint8Array | null = null;
  /** 光照需要重算（改方塊或剛生成時由 lighting.ts 設定；與網格的 `dirty`
   *  是兩套旗標，互不混用）。 */
  lightDirty = false;
  /** 天空光柱掃描的上界（= 曾經有過方塊的最高 y + 1）。只增不減 → 挖掉
   *  最高方塊後掃描帶仍涵蓋曾經受光的高度。 */
  topY = 0;

  constructor(cx: number, cz: number, data?: Uint8Array) {
    this.cx = cx;
    this.cz = cz;
    this.data = data ?? new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
  }

  /** 取得（必要時配置）本區塊的光照陣列。 */
  ensureLight(): Uint8Array {
    if (!this.light) this.light = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
    return this.light;
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
