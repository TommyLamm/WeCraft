import { describe, it, expect } from 'vitest';
import { CHUNK_HEIGHT, CHUNK_SIZE, Chunk, chunkIndex } from './chunk';
import { World } from './world';
import { BLOCK, getBlockDef, type BlockId } from './blocks';
import { generateChunk } from './terrain';
import {
  MAX_LIGHT,
  MIN_LIGHT_FACTOR,
  SKY_SCALE_NIGHT,
  TORCH_LIGHT,
  internalSkyLight,
  blockLightAt,
  computeChunkLight,
  computeChunkTopY,
  isOpaqueAt,
  lightAt,
  popUnsupportedCrosses,
  popUnsupportedTorches,
  setLight,
  skyLightAt,
  skyLightScale,
  spawnLightAt,
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

// 真正的火把方塊（BLOCK.TORCH = 32 ＋ DEFS[32].emission = 14）已由 Task 5 落地
// → 測試光源直接用真方塊（task-1-report 偏離 1 的「借 POPPY 暫補 emission」
// workaround 在此收口）。刻意**不**在此手動補 emission——否則會掩蓋 DEFS[32]
// 的回歸；emission = 14 由 blocks.ts 的真實資料與 blocks.test.ts 釘住。
// 底下的斷言與引擎路徑不變。
const TORCH = BLOCK.TORCH;

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
    // B6 Task 2 接上天空光：(16,64,0) 是開闊天空柱 → 全高柱掃描種下 15
    // （空鄰塊 topY=0 也不影響——掃描上界是世界高，不是 topY）
    expect(skyLightAt(w, 16, 64, 0)).toBe(15);
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
    // B6 Task 2 接上天空光：(0,65,0) 是開闊天空柱（POPPY 透明）→ 高 4 位 = 15
    expect(chunk.light![idx] >> 4).toBe(15);
    expect(blockLightAt(w, 0, 65, 0)).toBe(14);
    expect(skyLightAt(w, 0, 65, 0)).toBe(15);
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
    expect(getBlockDef(TORCH).emission).toBe(TORCH_LIGHT); // 真火把的 DEFS[32].emission（Task 5 落地）
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

// ══ 天空光引擎（B6 Task 2）══════════════════════════════════════════════════

describe('sky light engine (B6 Task 2)', () => {
  it('open sky is 15 and a roof shades the ground one level at a time', () => {
    const w = new World();
    fill(w, BLOCK.STONE, 0, 63, 0, 15, 63, 15); // 地板
    w.setBlock(5, 70, 5, BLOCK.STONE); // 單格厚屋簷
    computeChunkLight(w, 0, 0);
    // 稽核修正後的期望值（已用腳本重算）：單格厚屋簷下，整列只暗一階——
    // 旁邊的開闊柱 (4,·,5) 在每個高度水平餵 14 過來，不會「每往下一格 −1」。
    expect(skyLightAt(w, 5, 71, 5)).toBe(15); // 屋簷上方（開闊天空）
    expect(skyLightAt(w, 4, 69, 5)).toBe(15); // 旁邊的開闊柱
    expect(skyLightAt(w, 5, 69, 5)).toBe(14); // 屋簷下：水平 −1
    expect(skyLightAt(w, 5, 68, 5)).toBe(14); // 不是 13！（開闊柱每個高度都餵 14）
  });

  it('a walled pocket loses one level per step from the opening', () => {
    const w = new World();
    fill(w, BLOCK.STONE, 0, 63, 0, 15, 63, 15); // 地板
    fill(w, BLOCK.STONE, 0, 70, 0, 15, 70, 15); // 屋頂
    w.setBlock(0, 70, 5, BLOCK.AIR); // 唯一的洞口
    fill(w, BLOCK.STONE, 0, 64, 0, 15, 69, 0); // 側牆 z=0
    fill(w, BLOCK.STONE, 0, 64, 15, 15, 69, 15); // 側牆 z=15
    fill(w, BLOCK.STONE, 15, 64, 5, 15, 69, 5); // 後牆 x=15（z=5）
    computeChunkLight(w, 0, 0);
    expect(skyLightAt(w, 0, 69, 5)).toBe(15); // 洞口正下方（垂直下傳不衰減）
    expect(skyLightAt(w, 1, 69, 5)).toBe(14); // 離洞口每往內一格 −1
    expect(skyLightAt(w, 2, 69, 5)).toBe(13);
    expect(skyLightAt(w, 3, 69, 5)).toBe(12);
    expect(skyLightAt(w, 2, 68, 5)).toBe(13); // 同一水平深度往下也是 13
  });

  it('a sealed cave has no sky light', () => {
    const w = new World();
    fill(w, BLOCK.STONE, 2, 65, 2, 4, 67, 4); // 3×3×3 石殼
    w.setBlock(3, 66, 3, BLOCK.AIR); // 挖掉中心 → 密閉空腔
    computeChunkLight(w, 0, 0);
    expect(skyLightAt(w, 3, 66, 3)).toBe(0); // 腔內全暗
  });

  it('sky light crosses the chunk border', () => {
    const w = new World();
    fill(w, BLOCK.STONE, 0, 63, 0, 15, 63, 15);
    w.addChunk(new Chunk(1, 0)); // ★ 鄰塊必須先存在（稽核修正）
    w.setBlock(16, 70, 5, BLOCK.STONE); // 屋頂在「鄰塊」裡 → (16,69,5) 被遮蔽
    computeChunkLight(w, 0, 0);
    expect(skyLightAt(w, 15, 69, 5)).toBe(15); // 開闊柱
    expect(skyLightAt(w, 16, 69, 5)).toBe(14); // 跨邊界水平 −1
    computeChunkLight(w, 1, 0); // 重算鄰塊 → 不被清 0
    expect(skyLightAt(w, 16, 69, 5)).toBe(14);
  });

  it('removing a roof restores the sky light', () => {
    const w = new World();
    fill(w, BLOCK.STONE, 0, 63, 0, 15, 63, 15);
    w.setBlock(5, 70, 5, BLOCK.STONE);
    computeChunkLight(w, 0, 0);
    expect(skyLightAt(w, 5, 69, 5)).toBe(14);
    w.setBlock(5, 70, 5, BLOCK.AIR); // 挖掉屋簷
    computeChunkLight(w, 0, 0);
    expect(skyLightAt(w, 5, 69, 5)).toBe(15);
    expect(skyLightAt(w, 5, 68, 5)).toBe(15); // 垂直下傳不衰減
  });

  it('internal sky light follows the vanilla day curve', () => {
    expect(internalSkyLight(15, 0.25)).toBe(15); // 正午
    expect(internalSkyLight(15, 0.75)).toBe(4); // 午夜
    expect(internalSkyLight(14, 0.25)).toBe(14);
    expect(internalSkyLight(0, 0.25)).toBe(0); // 洞穴：15 − 15 → 0
    expect(internalSkyLight(0, 0.75)).toBe(0); // 不得為負
  });

  it('spawn light reports the real per block values', () => {
    const w = new World();
    fill(w, BLOCK.STONE, 0, 63, 0, 15, 63, 15); // 地板
    w.setBlock(5, 70, 5, BLOCK.STONE); // 屋簷
    w.setBlock(10, 64, 10, TORCH); // 地板上的火把（支撐＝y 63 的石頭）
    computeChunkLight(w, 0, 0);
    // 開闊處＋正午：生怪判準拿到的是「真的 per-block 光照」三件組
    const noon = spawnLightAt(w, 4, 69, 4, 0.25);
    expect(noon.sky).toBe(15);
    expect(noon.internalSky).toBe(15);
    expect(noon.block).toBe(0); // 離火把遠 → 無方塊光
    // 火把旁：taxi-cab −1 → 方塊光 13（敵對判準的 block !== 0 就靠這個擋）
    expect(spawnLightAt(w, 9, 64, 10, 0.25).block).toBe(13);
    // 屋簷下：半遮蔽（客戶端天空光 14）→ 正午內部天空光 14
    const eave = spawnLightAt(w, 5, 69, 5, 0.25);
    expect(eave.sky).toBe(14);
    expect(eave.internalSky).toBe(14);
  });

  it('internal sky light drops at night but the client sky light does not', () => {
    const w = new World();
    fill(w, BLOCK.STONE, 0, 63, 0, 15, 63, 15);
    computeChunkLight(w, 0, 0);
    const night = spawnLightAt(w, 4, 69, 4, 0.75); // 午夜、開闊處
    expect(night.sky).toBe(15); // 客戶端天空光時間無關（MC: sky light is not reduced at night）
    expect(night.internalSky).toBe(4); // 內部天空光衰減（原版午夜 4）→ 敵對判準吃這個值
    expect(night.block).toBe(0);
  });

  it('an unlit chunk is reported as unknown, not dark (B3)', () => {
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    fill(w, BLOCK.STONE, 0, 63, 0, 15, 63, 15); // 地板
    // 還沒點光（chunk.light === null）→ 三值全 0，但 `lit:false`（未知）
    expect(spawnLightAt(w, 4, 62, 4, 0.75)).toEqual({ sky: 0, internalSky: 0, block: 0, lit: false });
    // 缺席的區塊也是未知（不是「暗」）
    expect(spawnLightAt(w, 100, 62, 100, 0.75)).toEqual({ sky: 0, internalSky: 0, block: 0, lit: false });
    // 點光之後：地下（真的暗）→ 數值一樣是 0，但 `lit:true`（「已知的暗」）
    computeChunkLight(w, 0, 0);
    expect(spawnLightAt(w, 4, 62, 4, 0.75)).toEqual({ sky: 0, internalSky: 0, block: 0, lit: true });
  });

  it('the rendered sky scale is 1 at noon and dimmer at night', () => {
    expect(skyLightScale(0.25)).toBe(1);
    expect(skyLightScale(0.75)).toBe(SKY_SCALE_NIGHT);
    expect(skyLightScale(0.25)).toBeGreaterThan(skyLightScale(0.75));
  });

  it('the documented night scale and minimum light factor are pinned numbers', () => {
    // 不只「比正午暗」：0.85／0.05 是計畫與發布說明寫給玩家的數值，改動就是
    // 視覺契約變更（夜晚亮度、洞穴 5% 下限）→ 用字面值釘住，不能只跟常數自己比。
    expect(SKY_SCALE_NIGHT).toBe(0.85);
    expect(MIN_LIGHT_FACTOR).toBe(0.05);
  });
});

// ══ 光照生命週期（B6 Task 3）════════════════════════════════════════════════

// brief Step 1 列的五條裡，兩條已由 Task 1 以**更強**的斷言落地、不重複新增：
// - 'a late neighbour pulls light back across the border' ≡ 上方
//   'light spreads back into a late neighbour'（同一情境，且多釘中間態 0、
//   來源重種 14、新鄰塊內部 12）；
// - 'a chunk is fully relit after a block change' ≡ 上方
//   'breaking a torch removes its light'（同一情境，且多釘光源格歸 0）。
describe('light lifecycle (B6 Task 3)', () => {
  it('a recompute does not re-dirty its neighbours', () => {
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    w.addChunk(new Chunk(1, 0));
    w.setBlock(15, 64, 0, TORCH); // 邊界火把：setBlock 已把兩塊標 lightDirty＋(1,0) 網格髒
    // 隔離「重算本身」的副作用：旗標手動收斂成乾淨狀態，只看 compute 的行為。
    for (const [cx, cz] of [
      [0, 0],
      [1, 0],
    ] as const) {
      w.getChunk(cx, cz)!.lightDirty = false;
      w.getChunk(cx, cz)!.dirty = false;
    }
    computeChunkLight(w, 0, 0);
    // 先證明觸發路徑是真的：BFS 越過 x=15→16 的區塊邊界把光寫進了鄰塊
    expect(blockLightAt(w, 16, 64, 0)).toBe(13);
    // ★ brief 斷言：寫光 ≠ 標髒——重算不得把鄰塊排進光照佇列（避免無限迴圈）；
    //   但網格旗標要標（光變了 → 鄰塊的 mesh 要跟上）——兩套旗標各司其職。
    expect(w.getChunk(1, 0)!.lightDirty).toBe(false);
    expect(w.getChunk(1, 0)!.dirty).toBe(true);
    // 鄰塊自己重算時（它的 3×3 群組含 (0,0)），也不得把已算完的 (0,0) 標回髒
    // → 否則兩塊互相標記 → 光照佇列永不耗盡。
    computeChunkLight(w, 1, 0);
    expect(w.getChunk(0, 0)!.lightDirty).toBe(false);
    expect(blockLightAt(w, 16, 64, 0)).toBe(13); // 重算後光不變（冪等）
  });

  it('a diagonal neighbour re-seeds a corner torch when it alone recomputes', () => {
    // 對角塊重新載入／重算時，光源（火把）在群組的對角塊裡——3×3 群組必須含
    // 對角，否則只清本塊就再也收不到火把的光（角落永久變暗）。
    // 這也是「群組整體重算」的迴歸釘：舊版只清本塊時，來源區塊先算、對角塊
    // 後算（主迴圈的近→遠順序）會讓對角格整片歸 0。
    const w = new World();
    for (let cx = -1; cx <= 1; cx++)
      for (let cz = -1; cz <= 1; cz++) w.addChunk(new Chunk(cx, cz));
    w.setBlock(0, 64, 0, BLOCK.STONE); // 不透明支撐
    w.setBlock(0, 65, 0, TORCH); // 區塊角落（世界原點）
    computeChunkLight(w, 0, 0);
    expect(blockLightAt(w, -1, 65, -1)).toBe(12);
    // 只重算對角塊（模擬它重新載入）：光要由 (0,0) 的火把重新餵回。
    computeChunkLight(w, -1, -1);
    expect(blockLightAt(w, -1, 65, -1)).toBe(12);
    expect(blockLightAt(w, -1, 65, 0)).toBe(13);
  });

  it('a clean outside torch still feeds the group edge after a group relight', () => {
    // 群組重算會清掉九塊；群組邊界的光若來自**群組外**的乾淨鄰塊，
    // 必須從外圈邊界補回（否則每次重算都會把外圈光源的光切掉一圈）。
    const w = new World();
    for (let cx = -2; cx <= 1; cx++)
      for (let cz = -1; cz <= 1; cz++) w.addChunk(new Chunk(cx, cz));
    w.setBlock(-20, 64, 8, BLOCK.STONE);
    w.setBlock(-20, 65, 8, TORCH); // 群組外（chunk −2,0）
    computeChunkLight(w, -2, 0); // 先讓外圈的光成為「乾淨且正確」
    expect(blockLightAt(w, -16, 65, 8)).toBe(10); // 距離 4 → 14 − 4
    computeChunkLight(w, 0, 0); // 重算中央群組：邊界要從外圈補回
    expect(blockLightAt(w, -16, 65, 8)).toBe(10);
    expect(blockLightAt(w, -15, 65, 8)).toBe(9);
  });

  it('an open outside column feeds sky light under a roofed group edge', () => {
    // 同上，天空光通道：3×3 群組全部加 1 格厚屋頂，唯一開闊天空在外圈
    // chunk (−2,0) → 群組邊界 (−16,65,0) 必須是 15 − 1 = 14。
    const w = new World();
    for (let cx = -2; cx <= 1; cx++)
      for (let cz = -1; cz <= 1; cz++) w.addChunk(new Chunk(cx, cz));
    fill(w, BLOCK.STONE, -16, 93, -16, 15, 93, 15);
    computeChunkLight(w, -2, 0); // 外圈先算（開闊天空 15）
    computeChunkLight(w, 0, 0); // 群組重算：屋頂下靠外圈邊界補光
    expect(skyLightAt(w, -17, 65, 0)).toBe(15); // 屋頂外
    expect(skyLightAt(w, -16, 65, 0)).toBe(14); // 邊界：外圈 15 − 1
    expect(skyLightAt(w, -15, 65, 0)).toBe(13); // 往內每格 −1
  });

  it('a corner torch leaves no ghost light in the diagonal neighbour', () => {
    const w = new World();
    // 3×3 的九個區塊全部先存在——火把在 (0,0) 的角落，光會寫進全部八鄰
    for (let cx = -1; cx <= 1; cx++)
      for (let cz = -1; cz <= 1; cz++) w.addChunk(new Chunk(cx, cz));
    w.setBlock(0, 64, 0, BLOCK.STONE); // 不透明支撐
    w.setBlock(0, 65, 0, TORCH); // 區塊角落（世界原點）
    computeChunkLight(w, 0, 0);
    expect(blockLightAt(w, -1, 65, -1)).toBe(12); // 對角格被照到（14 − 1 − 1）
    w.setBlock(0, 65, 0, BLOCK.AIR); // 挖掉火把 → markLightDirty 把九塊全部標髒（含對角）
    // 模擬光照佇列：對每個 lightDirty === true 的區塊重算
    for (let cx = -1; cx <= 1; cx++)
      for (let cz = -1; cz <= 1; cz++)
        if (w.getChunk(cx, cz)!.lightDirty) computeChunkLight(w, cx, cz);
    // 對角不留幽靈光（稽核 Critical #3：只標 4 個正交鄰塊時這裡會殘留 12）
    expect(blockLightAt(w, -1, 65, -1)).toBe(0);
    expect(blockLightAt(w, -1, 65, 0)).toBe(0);
    expect(blockLightAt(w, 0, 65, 0)).toBe(0);
  });

  it('relighting 16 chunks stays inside the generation budget', { timeout: 30000 }, () => {
    // Task 5 之後測試光源是真火把（BLOCK.TORCH），真實地形不會長火把 →
    // 先前「把暫補 emission 的 POPPY 歸零、finally 還原」的 workaround 不再需要
    // （POPPY 從未帶 emission，花不會變火把）。
    // 明確取法（2026-10-20 稽核修正）：cx,cz = 0..3 × 0..3 共 16 塊、種子 1337。
    // 量三次取最快（B3 Task 9 的同款紀律）：vitest 平行跑檔時牆鐘會被同 CPU
    // 上十幾個檔案的數值迴圈抖高 → 單次量測會假紅；取最快量到的是管線本身，
    // 真退化時三次都超標 → 守護力不變、門檻一毫秒都沒放寬。
    const w = new World();
    let best = Number.POSITIVE_INFINITY;
    const rounds: string[] = [];
    for (let round = 0; round < 3; round++) {
      const t0 = performance.now();
      for (let cx = 0; cx <= 3; cx++) {
        for (let cz = 0; cz <= 3; cz++) {
          const chunk = new Chunk(cx, cz, generateChunk(cx, cz, 1337));
          w.addChunk(chunk);
          chunk.topY = computeChunkTopY(chunk); // 生成接線：地形整塊寫入、不經 setBlock
          computeChunkLight(w, cx, cz); // 生成後立即點光（等價於光照佇列跑完該塊）
        }
      }
      const ms = performance.now() - t0;
      best = Math.min(best, ms);
      rounds.push(`${ms.toFixed(0)} ms`);
    }
    // 先印後斷言（B3 同款）：門檻被觸發時也要留下實測數字才知道是退化還是機器忙
    console.log(`gen+light 16 chunks: best ${best.toFixed(0)} ms (rounds: ${rounds.join(' | ')})`);
    expect(best).toBeLessThan(1500); // 門檻沿用 B3 的 16 區塊預算（1500 ms）
    // 正確性抽檢（量測不得靠 no-op 變綠）：16 塊的天空柱全高種滿、旗標清乾淨
    for (let cx = 0; cx <= 3; cx++) {
      for (let cz = 0; cz <= 3; cz++) {
        expect(skyLightAt(w, cx * CHUNK_SIZE + 8, 200, cz * CHUNK_SIZE + 8)).toBe(15);
        expect(w.getChunk(cx, cz)!.lightDirty).toBe(false);
      }
    }
  });
});

describe('torch support (B6 Task 6: 支撐消失 → 火把收回)', () => {
  it('a torch pops off when its support is removed', () => {
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    w.setBlock(0, 63, 0, BLOCK.STONE);
    w.setBlock(0, 64, 0, TORCH);
    w.setBlock(0, 63, 0, BLOCK.AIR); // 挖掉支撐
    const popped = popUnsupportedTorches(w, 0, 63, 0);
    expect(popped).toEqual([{ x: 0, y: 64, z: 0 }]);
    expect(w.getBlock(0, 64, 0)).toBe(BLOCK.AIR); // 火把被收回
  });

  it('a wall torch pops off when only its wall support is removed', () => {
    // 牆面依附：下方是空氣、唯一支撐在 +x。挖掉那面牆 → 火把收回並回報位置。
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    w.setBlock(1, 64, 0, BLOCK.STONE);
    w.setBlock(0, 64, 0, TORCH);
    w.setBlock(1, 64, 0, BLOCK.AIR);
    expect(popUnsupportedTorches(w, 1, 64, 0)).toEqual([{ x: 0, y: 64, z: 0 }]);
    expect(w.getBlock(0, 64, 0)).toBe(BLOCK.AIR);
  });

  it('a torch with another support stays', () => {
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    w.setBlock(0, 63, 0, BLOCK.STONE); // 下方支撐
    w.setBlock(1, 64, 0, BLOCK.STONE); // 側邊支撐
    w.setBlock(0, 64, 0, TORCH);
    w.setBlock(0, 63, 0, BLOCK.AIR); // 挖掉下方 → 還有側邊支撐
    expect(popUnsupportedTorches(w, 0, 63, 0)).toEqual([]);
    expect(w.getBlock(0, 64, 0)).toBe(BLOCK.TORCH); // 火把還在
  });

  it('only torch cells pop (stone and air neighbours are left alone)', () => {
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    w.setBlock(0, 63, 0, BLOCK.STONE);
    w.setBlock(1, 63, 0, BLOCK.STONE); // 側鄰是石頭、上方是空氣
    expect(popUnsupportedTorches(w, 0, 63, 0)).toEqual([]);
    expect(w.getBlock(1, 63, 0)).toBe(BLOCK.STONE);
  });
});

describe('cross support (B2 Task 11: 支撐消失 → cross 植被收回)', () => {
  it('a cross plant pops when its support block is removed', () => {
    // 審查 B2：破壞分支只呼叫 `popUnsupportedTorches`，cross 不被清理 →
    // 花／草懸空，而且自然生成的 cross 沒被記入 `modified`（區塊重載又長回來）。
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    w.setBlock(0, 63, 0, BLOCK.GRASS);
    w.setBlock(0, 64, 0, BLOCK.DANDELION); // 長在草上
    w.setBlock(0, 63, 0, BLOCK.AIR); // 挖掉支撐
    const popped = popUnsupportedCrosses(w, 0, 63, 0);
    expect(popped).toEqual([{ x: 0, y: 64, z: 0 }]);
    expect(w.getBlock(0, 64, 0)).toBe(BLOCK.AIR); // 植被被收回
  });

  it('a cross plant with support stays', () => {
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    w.setBlock(0, 63, 0, BLOCK.GRASS); // 支撐還在
    w.setBlock(0, 64, 0, BLOCK.POPPY);
    expect(popUnsupportedCrosses(w, 0, 63, 0)).toEqual([]);
    expect(w.getBlock(0, 64, 0)).toBe(BLOCK.POPPY); // 植被還在
  });

  it('only cross cells pop (torch and solid neighbours are left alone)', () => {
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    w.setBlock(0, 64, 0, BLOCK.STONE); // 上方是石頭（不是 cross）→ 不動
    w.setBlock(1, 64, 0, BLOCK.TORCH); // 側鄰是火把 → 不動（那是火把收回的事）
    expect(popUnsupportedCrosses(w, 0, 63, 0)).toEqual([]);
    expect(w.getBlock(0, 64, 0)).toBe(BLOCK.STONE);
    expect(w.getBlock(1, 64, 0)).toBe(BLOCK.TORCH);
  });

  it('a popped cross is recorded as AIR in the modified map', () => {
    // 收走要走 `setBlock(..., AIR)` → `modified` overlay 記 AIR。少了這一筆，
    // 自然生成的 cross 在區塊重新載入／重生成時會**長回來**（審查 B2 的後半）。
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    w.setBlock(0, 63, 0, BLOCK.GRASS);
    w.setBlock(0, 64, 0, BLOCK.SHORT_GRASS);
    w.setBlock(0, 63, 0, BLOCK.AIR); // 挖掉支撐
    popUnsupportedCrosses(w, 0, 63, 0);
    expect(w.modified.get('0,64,0')).toBe(BLOCK.AIR);
  });

  it('a cross pops ONLY when the broken cell was its own support (one layer above)', () => {
    // 收回只針對「長在被改動格上」的那一格（y+1）。側邊與上方更高處的 cross
    // 不受影響（它們的支撐不是這一格）。
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    w.setBlock(1, 64, 0, BLOCK.DANDELION); // 側鄰的 cross（支撐在 (1,63,0)）
    w.setBlock(1, 63, 0, BLOCK.GRASS);
    w.setBlock(0, 65, 0, BLOCK.POPPY); // 更高兩層的 cross
    w.setBlock(0, 64, 0, BLOCK.GRASS);
    expect(popUnsupportedCrosses(w, 0, 63, 0)).toEqual([]);
    expect(w.getBlock(1, 64, 0)).toBe(BLOCK.DANDELION);
    expect(w.getBlock(0, 65, 0)).toBe(BLOCK.POPPY);
  });
});
