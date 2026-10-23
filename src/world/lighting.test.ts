import { describe, it, expect } from 'vitest';
import { CHUNK_HEIGHT, CHUNK_SIZE, Chunk, chunkIndex } from './chunk';
import { World } from './world';
import { BLOCK, getBlockDef, type BlockId } from './blocks';
import {
  MAX_LIGHT,
  TORCH_LIGHT,
  blockLightAt,
  computeChunkLight,
  computeChunkTopY,
  isOpaqueAt,
  lightAt,
  setLight,
  skyLightAt,
} from './lighting';

// ── 測試輔助（測試檔內自帶，不依賴 main）────────────────────────────────────

/** 把 [x0..x1]×[y0..y1]×[z0..z1] 填滿同一種方塊（含端點）。 */
const fill = (
  w: World,
  id: number,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
) => {
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) w.setBlock(x, y, z, id as BlockId);
};

// 真正的火把方塊（BLOCK.TORCH = 32 ＋ DEFS[32].emission = 14）依跨任務釘點在
// Task 5 才落地（id 表／貼圖／物品／配方都屬 T5）；本 task 只交付引擎讀取
// `getBlockDef(id).emission ?? 0` 的接縫。測試需要一個「透明、非實心」、
// emission = 14 的方塊當光源 → 借 POPPY 的 BlockDef 物件暫補 `emission`
// （def 物件可變；Vitest 每個測試檔有獨立的 module registry，不會影響其他
// 檔案；本檔內 POPPY 只以光源身份出現）。Task 5 之後可換成 BLOCK.TORCH，
// 底下所有斷言不變。
const TORCH = BLOCK.POPPY;
getBlockDef(TORCH).emission = TORCH_LIGHT;

describe('block light engine (B6 Task 1)', () => {
  it('a torch lights its neighbours with the vanilla decay', () => {
    const w = new World();
    fill(w, BLOCK.STONE, 0, 64, 0, 0, 64, 0); // 不透明支撐
    w.setBlock(0, 65, 0, TORCH);
    computeChunkLight(w, 0, 0);
    expect(blockLightAt(w, 0, 65, 0)).toBe(14); // 光源格
    expect(blockLightAt(w, 1, 65, 0)).toBe(13);
    expect(blockLightAt(w, 0, 66, 0)).toBe(13);
    expect(blockLightAt(w, 1, 66, 0)).toBe(12); // 斜對角 = 14 − 2（taxi-cab）
    expect(blockLightAt(w, 0, 64, 0)).toBe(0); // 不透明支撐不持有光
  });

  it('opaque blocks stop the light', () => {
    const w = new World();
    w.setBlock(0, 65, 0, TORCH);
    // 全高石牆（x=2，z −6..6，y 0..255）隔開光源與目標：繞過牆的最近路徑長 20
    // > 15 → 光不可能從任何縫隙以正等級到達目標。
    fill(w, BLOCK.STONE, 2, 0, -6, 2, 255, 6);
    computeChunkLight(w, 0, 0);
    expect(blockLightAt(w, 1, 65, 0)).toBe(13); // 牆這側正常受光
    expect(blockLightAt(w, 2, 65, 0)).toBe(0); // 牆本身（不透明）不持有光
    expect(blockLightAt(w, 6, 65, 0)).toBe(0); // 牆另一側全暗
  });

  it('light crosses the chunk border', () => {
    const w = new World();
    w.addChunk(new Chunk(1, 0)); // 鄰塊必須先存在——光「寫不進不存在的區塊」
    w.setBlock(15, 64, 0, TORCH);
    computeChunkLight(w, 0, 0);
    expect(blockLightAt(w, 14, 64, 0)).toBe(13); // 邊界內側
    expect(blockLightAt(w, 16, 64, 0)).toBe(13); // x=16 屬區塊 (1,0)
    expect(skyLightAt(w, 16, 64, 0)).toBe(0); // 本 task 不動天空光通道（Task 2 接上）
  });

  it('light spreads back into a late neighbour', () => {
    const w = new World();
    w.setBlock(15, 64, 0, TORCH); // 只有區塊 (0,0)（setBlock 自動建立）
    computeChunkLight(w, 0, 0);
    expect(blockLightAt(w, 16, 64, 0)).toBe(0); // 鄰塊不存在 → 光寫不進去
    w.addChunk(new Chunk(1, 0)); // 鄰塊較晚生成
    computeChunkLight(w, 1, 0); // 重算新鄰塊：播種掃 3×3 群組 → 把光「拉」回來
    expect(blockLightAt(w, 15, 64, 0)).toBe(14); // 來源重新種下
    expect(blockLightAt(w, 16, 64, 0)).toBe(13); // 邊界格
    expect(blockLightAt(w, 17, 64, 0)).toBe(12); // 光真的傳進了新鄰塊內部
  });

  it('breaking a torch removes its light', () => {
    const w = new World();
    w.setBlock(0, 65, 0, TORCH);
    computeChunkLight(w, 0, 0);
    expect(blockLightAt(w, 1, 65, 0)).toBe(13); // 先確認有光
    w.setBlock(0, 65, 0, BLOCK.AIR);
    computeChunkLight(w, 0, 0);
    expect(blockLightAt(w, 0, 65, 0)).toBe(0); // 光源格歸 0
    expect(blockLightAt(w, 1, 65, 0)).toBe(0); // 鄰格也歸 0
  });

  it('the light array is allocated lazily and holds one byte per cell', () => {
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    const chunk = w.getChunk(0, 0)!;
    expect(chunk.light).toBeNull(); // 未點光 → 不配置
    w.setBlock(0, 65, 0, TORCH);
    expect(chunk.light).toBeNull(); // setBlock 本身不配置光照
    computeChunkLight(w, 0, 0);
    expect(chunk.light).not.toBeNull();
    expect(chunk.light!.length).toBe(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT); // 65536
    const idx = chunkIndex(0, 65, 0);
    expect(chunk.light![idx] & 0x0f).toBe(14); // 方塊光在低 4 位
    expect(chunk.light![idx] >> 4).toBe(0); // 天空光在高 4 位（本 task 恆 0）
    expect(blockLightAt(w, 0, 65, 0)).toBe(14);
    expect(skyLightAt(w, 0, 65, 0)).toBe(0);
  });

  it('setting a block marks the chunk and its eight neighbours for relighting', () => {
    const w = new World();
    for (const dx of [-1, 0, 1])
      for (const dz of [-1, 0, 1]) {
        w.addChunk(new Chunk(dx, dz));
        w.getChunk(dx, dz)!.dirty = false; // 先清掉網格旗標，只看光照旗標
      }
    w.setBlock(0, 65, 0, TORCH);
    // 九個區塊（含對角）全部標記：BFS 走 6 鄰居時會經過正交鄰塊寫進對角區塊
    // → 只標 4 個正交鄰塊會在對角留下永久幽靈光（2026-10-20 稽核修正）。
    for (const dx of [-1, 0, 1])
      for (const dz of [-1, 0, 1]) {
        expect(w.getChunk(dx, dz)!.lightDirty, `chunk (${dx},${dz}) lightDirty`).toBe(true);
      }
    // 光照旗標與網格旗標是兩套：對角鄰塊不需重網格，但需要重算光照。
    expect(w.getChunk(-1, -1)!.dirty).toBe(false);
  });

  it('the light engine terminates when the neighbour chunks are missing', () => {
    const w = new World();
    w.addChunk(new Chunk(0, 0)); // 世界裡只有區塊 (0,0)

    // 階段一（brief 字面情境）：無光源 → compute 必須正常結束且全暗。
    computeChunkLight(w, 0, 0);
    expect(blockLightAt(w, 0, 65, 0)).toBe(0);

    // 階段二（稽核 Critical 的實際觸發路徑）：光源放在區塊「邊緣」格 →
    // BFS 的 6 鄰居會踩進不存在的 (−1,0)/(0,−1) 區塊。若實作把「寫不進去」的格
    // push 進佇列（讀回恆 0 → 永遠比 next 小 → 每次 pop 再生 6 個新項），佇列會
    // 無限膨脹 → RangeError／OOM。用 < 2000 ms 做保險閘（不是效能門檻）。
    // （不放光源的話 BFS 根本不執行，守不住這條——所以這裡必須放。）
    w.setBlock(0, 65, 0, TORCH);
    const t0 = performance.now();
    computeChunkLight(w, 0, 0);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(blockLightAt(w, 0, 65, 0)).toBe(TORCH_LIGHT); // 光源在自己的區塊內正常點亮
    expect(blockLightAt(w, 0, 66, 0)).toBe(13); // 區塊內傳播正常
    expect(blockLightAt(w, -1, 65, 0)).toBe(0); // 缺席的鄰塊 → 讀 0（寫不進去）
  });

  it('light constants match vanilla (minecraft.wiki/Light, 2026-10-20)', () => {
    expect(MAX_LIGHT).toBe(15); // 16 個等級 0..15
    expect(TORCH_LIGHT).toBe(14); // 「Torches give off a light level of 14.」
    expect(getBlockDef(TORCH).emission).toBe(TORCH_LIGHT); // 測試光源已接上 emission 接縫
  });

  it('setLight writes nothing and reports false when the chunk is missing', () => {
    const w = new World();
    expect(setLight(w, 5, 65, 5, { sky: 9, block: 7 })).toBe(false);
    expect(w.getChunk(0, 0)).toBeUndefined(); // 不建立區塊
    expect(lightAt(w, 5, 65, 5)).toEqual({ sky: 0, block: 0 }); // 缺席 → 讀 0
    w.addChunk(new Chunk(0, 0));
    expect(setLight(w, 5, 65, 5, { sky: 9, block: 7 })).toBe(true);
    expect(lightAt(w, 5, 65, 5)).toEqual({ sky: 9, block: 7 });
    expect(w.getChunk(0, 0)!.dirty).toBe(true); // setLight 後該區塊要重網格
  });

  it('isOpaqueAt follows the block transparency table', () => {
    const w = new World();
    w.setBlock(0, 65, 0, BLOCK.STONE);
    w.setBlock(1, 65, 0, BLOCK.GLASS);
    expect(isOpaqueAt(w, 0, 65, 0)).toBe(true); // 石頭擋光
    expect(isOpaqueAt(w, 1, 65, 0)).toBe(false); // 玻璃透明 → 不擋
    expect(isOpaqueAt(w, 2, 65, 0)).toBe(false); // 空氣
    expect(isOpaqueAt(w, 0, 999, 0)).toBe(false); // 越界 → 空氣 → 不擋
    expect(isOpaqueAt(w, 1000, 65, 0)).toBe(false); // 缺席區塊 → 空氣 → 不擋
  });

  it('setBlock raises chunk.topY and it never shrinks', () => {
    const w = new World();
    w.setBlock(5, 70, 5, BLOCK.STONE);
    expect(w.getChunk(0, 0)!.topY).toBe(71); // 最高方塊 y + 1
    w.setBlock(6, 64, 5, BLOCK.STONE);
    expect(w.getChunk(0, 0)!.topY).toBe(71); // 較低的方塊不影響
    w.setBlock(5, 70, 5, BLOCK.AIR); // 挖掉最高方塊——上界只增不減
    expect(w.getChunk(0, 0)!.topY).toBe(71);
  });

  it('computeChunkTopY scans the highest non-air cell', () => {
    const chunk = new Chunk(0, 0);
    expect(computeChunkTopY(chunk)).toBe(0); // 空區塊
    // 直接寫 data（模擬地形整塊寫入、不經 setBlock 的路徑）
    chunk.data[chunkIndex(5, 70, 5)] = BLOCK.STONE;
    chunk.data[chunkIndex(3, 63, 2)] = BLOCK.SAND;
    expect(computeChunkTopY(chunk)).toBe(71); // 最高非空氣格 70 → +1
  });

  it('computeChunkLight is a no-op on a missing chunk and clears the relight flag', () => {
    const w = new World();
    expect(() => computeChunkLight(w, 3, 7)).not.toThrow(); // 區塊不存在 → no-op
    w.addChunk(new Chunk(3, 7));
    const chunk = w.getChunk(3, 7)!;
    chunk.lightDirty = true;
    computeChunkLight(w, 3, 7);
    expect(chunk.lightDirty).toBe(false); // 重算完成 → 旗標清掉
  });
});
