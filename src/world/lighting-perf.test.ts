import { describe, it, expect } from 'vitest';
import { CHUNK_HEIGHT, Chunk } from './chunk';
import { World } from './world';
import { BLOCK } from './blocks';
import { generateChunk } from './terrain';
import {
  blockLightAt,
  computeChunkLight,
  computeChunkLightOnly,
  computeChunkTopY,
  skyLightAt,
  sortLightQueueByDistance,
  takeLightBudget,
} from './lighting';
import { meshChunk } from './mesher';

/**
 * B6 Task 8：光照的效能回歸門檻與每幀佇列預算（單元釘子）。
 *
 * 《為什麼不進 `npm test`（A8 的執行方式裁決）》
 * 這裡的門檻是**牆鐘**絕對值；`npm test` 以 vitest 平行跑 80+ 個檔案時，同一份
 * 工作量實測膨脹約 2 倍（本檔單跑 group best 47 ms／真路徑 28 ms；全量平行
 * 97.9 ms／58.0 ms）→ 絕對門檻在平行負載下必然假紅（舊的 100 ms 門檻正是
 * 「設寬到躲過噪音、寬到放過 52.6 ms 的卡頓」）。因此：
 * - `npm test` **排除本檔**（correctness 套件保持決定性）；
 * - `npm run test:perf` 單檔跑（無跨檔競爭）→ 絕對門檻才有意義；
 * - 每波閘門兩者都跑（見計畫 §每波驗證閘門與 task 報告）。
 *
 * 《與既有測試的映射（R-T3-1 先例：同情境不重複）》
 * - brief 的「generating and lighting 16 chunks < 1500 ms」→ 已由
 *   `lighting.test.ts` 的 `'relighting 16 chunks stays inside the generation
 *   budget'`（門檻 1500 ms，三次取最快）落地，此處不重複。
 * - brief 的「the light data costs exactly 64 KiB per chunk」（65536 byte、
 *   未點光前 `chunk.light === null`）→ 已由 `lighting.test.ts` 的
 *   `'the light array is allocated lazily and holds one byte per cell'`
 *   逐項釘住，此處不重複。
 *
 * 《單區塊重算門檻的裁決（R-T3-4 收口；A8 改攤平指標＋真路徑守門）》
 * - 計畫 §7／brief 寫「≤ 8 ms／區塊」，但其量測口徑（清 0 ＋ **3×3 群組播種**
 *   ＋ BFS ＋ 跨區塊寫入）與「8 ms」在滿群組下不相容：群組播種本身要掃
 *   9 × 65,536 格。Task 3 實測滿群組 ~30-40 ms（R-T3-4）；本檔 probe 拆解
 *   （同機、種子 1337、暖身後取最快）：**群組＝1 時 5.0 ms、滿 3×3 群組
 *   46.8 ms（有無火把差 <2 ms）**——成本幾乎完全線性於群組大小，主體是固定
 *   的 9 次全格掃描，不是 BFS。
 * - **A8（0.10.1 審查）**：主執行緒改為**每幀只重算群組中的一塊**
 *   （`computeChunkLightOnly`，見 main.ts 的 processQueues）→ 「每區塊 8 ms」
 *   的正確口徑是**攤平值**：`group best / 9 < 8 ms`（實測 ~5.2 ms）。單次
 *   群組重算只留給開局同步點亮（spawnPoint）。
 * - 舊的「單次群組重算 < 100 ms」門檻**移除**：它允許 52.6 ms 的編輯卡頓
 *   （審查 A8 的問題本身，實測 103-113 ms 的全量平行假紅更是噪音）。真路徑
 *   由下一條「edit → relight → mesh < 33 ms」直接量測。
 */

/** 3×3 群組重算攤平到「每區塊」的門檻：群組總成本 / 9。 */
const PER_CHUNK_BUDGET_MS = 8;

/** A8 真路徑門檻：一次編輯（setBlock 標髒 → 佇列）→ 單塊光照 → 網格，
 *  必須落在 60 fps 的兩帧預算內（33 ms；審查 A8 的修法驗收值）。 */
const EDIT_FRAME_BUDGET_MS = 33;

describe('lighting performance budget (B6 Task 8 / A8)', () => {
  it(
    'a full 3x3 group relight amortizes to under 8 ms per chunk',
    { timeout: 30000 },
    () => {
      // 量測口徑（brief ＋計畫 §7）：`computeChunkLight` 一次呼叫＝清 0 ＋
      // 3×3 群組播種 ＋ BFS ＋ 跨區塊寫入；**不含**網格重建。
      // 情境＝重算的最壞常態：3×3 群組九塊全部存在（真實地形、種子 1337）、
      // 中央塊地表放一支火把（方塊光 BFS 也跑）——對應「玩家放／挖方塊後
      // 九塊標髒、光照佇列重算其中一塊」的實際路徑。
      const w = new World();
      for (let cx = -1; cx <= 1; cx++) {
        for (let cz = -1; cz <= 1; cz++) {
          const chunk = new Chunk(cx, cz, generateChunk(cx, cz, 1337));
          w.addChunk(chunk);
          chunk.topY = computeChunkTopY(chunk); // 生成接線（光照不依賴，照 main.ts 維護）
        }
      }
      // 火把放在中央塊 (8,8) 柱的地表上方一格（有支撐的擺法）
      let surface = CHUNK_HEIGHT - 1;
      while (surface > 0 && w.getBlock(8, surface, 8) === BLOCK.AIR) surface--;
      w.setBlock(8, surface + 1, 8, BLOCK.TORCH);

      // 暖身一次（避免首次 JIT／配置偏差），再量 5 回合取最快——
      // vitest 平行跑檔時牆鐘會被同 CPU 的其他檔案抖高，取最快量到的是
      // 管線本身；真退化時每一回合都超標（與 lighting.test.ts 同款紀律）。
      computeChunkLight(w, 0, 0);
      let best = Number.POSITIVE_INFINITY;
      const rounds: string[] = [];
      for (let round = 0; round < 5; round++) {
        const t0 = performance.now();
        computeChunkLight(w, 0, 0);
        const ms = performance.now() - t0;
        best = Math.min(best, ms);
        rounds.push(`${ms.toFixed(1)} ms`);
      }
      // 先印後斷言：門檻被觸發時也留得出實測數字（退化還是機器忙）
      const perChunk = best / 9;
      console.log(
        `full 3x3 group relight: best ${best.toFixed(1)} ms → ` +
          `${perChunk.toFixed(1)} ms/chunk (rounds: ${rounds.join(' | ')})`,
      );
      expect(perChunk).toBeLessThan(PER_CHUNK_BUDGET_MS);
      // 正確性抽檢（量測不得靠 no-op 變綠）：火把光、天空柱、旗標收尾都在
      expect(blockLightAt(w, 8, surface + 1, 8)).toBe(14);
      expect(skyLightAt(w, 0, 200, 0)).toBe(15); // 開闊天空柱（200 在地形之上）
      expect(w.getChunk(0, 0)!.light).not.toBeNull();
      expect(w.getChunk(0, 0)!.lightDirty).toBe(false);
    },
  );
});

// ---- A8：真路徑守門 --------------------------------------------------------
// 舊守門量的是「一次 3×3 群組重算」且門檻 100 ms（允許 52.6 ms 的卡頓）。
// A8 之後主執行緒每幀只重算一塊 → 量測**一次編輯的實際幀工作**：
// setBlock（標髒＝進佇列）→ computeChunkLightOnly（本幀那一塊）→ meshChunk。
describe('A8: an edit fits the frame budget end to end', () => {
  it(
    'an edit reaches relight and mesh within one frame budget (33 ms)',
    { timeout: 30000 },
    () => {
      // 情境＝真實編輯的常態：3×3 群組九塊全存在（真實地形、種子 1337）、
      // 中央塊地表一支火把（方塊光也要跑）。編輯格在中央塊、火把上方兩格。
      const w = new World();
      for (let cx = -1; cx <= 1; cx++) {
        for (let cz = -1; cz <= 1; cz++) {
          const chunk = new Chunk(cx, cz, generateChunk(cx, cz, 1337));
          w.addChunk(chunk);
          chunk.topY = computeChunkTopY(chunk);
        }
      }
      let surface = CHUNK_HEIGHT - 1;
      while (surface > 0 && w.getBlock(8, surface, 8) === BLOCK.AIR) surface--;
      const torchY = surface + 1;
      w.setBlock(8, torchY, 8, BLOCK.TORCH);
      // 暖身（開局同步點亮整組的狀態）→ 之後每輪都是「一次新的編輯」。
      computeChunkLight(w, 0, 0);
      meshChunk(w, 0, 0);

      let best = Number.POSITIVE_INFINITY;
      const rounds: string[] = [];
      for (let round = 0; round < 5; round++) {
        const t0 = performance.now();
        // 真路徑：編輯 → setBlock 已把 3×3 標成 lightDirty（進佇列）→
        // 本幀只重算編輯所在的那一塊 → 同一幀重建該塊網格。
        w.setBlock(8, torchY + 2, 8, round % 2 === 0 ? BLOCK.STONE : BLOCK.AIR);
        computeChunkLightOnly(w, 0, 0);
        meshChunk(w, 0, 0);
        const ms = performance.now() - t0;
        best = Math.min(best, ms);
        rounds.push(`${ms.toFixed(1)} ms`);
      }
      // 先印後斷言（與既有守門同款）：紅燈時留得出實測數字。
      console.log(
        `edit → relight → mesh: best ${best.toFixed(1)} ms (rounds: ${rounds.join(' | ')})`,
      );
      expect(best).toBeLessThan(EDIT_FRAME_BUDGET_MS);
      // 正確性抽檢（量測不得靠 no-op 變綠）：火把還在、天空柱在、旗標已收。
      expect(blockLightAt(w, 8, torchY, 8)).toBe(14);
      expect(skyLightAt(w, 0, 200, 0)).toBe(15);
      expect(w.getChunk(0, 0)!.light).not.toBeNull();
      expect(w.getChunk(0, 0)!.lightDirty).toBe(false);
    },
  );
});

describe('per-frame light queue budget (B6 Task 8 / A8)', () => {
  it('the light queue takes at most the given per-frame budget', () => {
    // 純函式與實際預算無關：A8 起 main.ts 每幀只取 **1** 塊（單塊重算），
    // 這裡用 2 驗證「取前 N 項」的通用語意與邊界（含 0／負數）。
    // brief 的原始情境：fake 佇列排 3 個待處理區塊 → 單幀最多取 2 個。
    const queue: Array<[number, number]> = [
      [5, 5],
      [6, 5],
      [7, 5],
    ];
    const batch = takeLightBudget(queue, 2);
    expect(batch).toEqual([
      [5, 5],
      [6, 5],
    ]);
    // 純函式：回傳新陣列、不改動原佇列（消費由呼叫端自己 splice）
    expect(batch).not.toBe(queue);
    expect(queue).toHaveLength(3);
    // 邊界：預算 0 → 空；預算 ≥ 佇列長 → 全取；負數 → 空（防禦）
    expect(takeLightBudget(queue, 0)).toEqual([]);
    expect(takeLightBudget(queue, 99)).toEqual(queue);
    expect(takeLightBudget(queue, -1)).toEqual([]);
  });

  it('the light queue is sorted nearest first', () => {
    // brief 稽核修正新增：ring 掃描進來的順序會讓遠處角落先點亮 →
    // 排序必須依「到玩家的距離平方」遞增（近→遠）。
    // 座標單位：佇列與 playerX/playerZ 都是**區塊座標**（main.ts 的
    // pcx/pcz；與既有排序鍵 `(cx - pcx) ** 2 + (cz - pcz) ** 2` 同一個量）。
    const queue: Array<[number, number]> = [
      [3, 3], // 18
      [0, 1], // 1
      [2, 0], // 4
      [1, 0], // 1
      [-1, -1], // 2
    ];
    const sorted = sortLightQueueByDistance(queue, 0, 0);
    expect(sorted).toEqual([
      [0, 1],
      [1, 0], // 同距 1 → 穩定排序保留原相對順序
      [-1, -1],
      [2, 0],
      [3, 3],
    ]);
    // 純函式：回傳新陣列、原佇列原樣（main.ts 依賴「不改動」來重建佇列）
    expect(sorted).not.toBe(queue);
    expect(queue).toEqual([
      [3, 3],
      [0, 1],
      [2, 0],
      [1, 0],
      [-1, -1],
    ]);
    // 玩家不在原點時也成立（釘住座標單位是區塊座標）
    expect(sortLightQueueByDistance(queue, 2, 0)[0]).toEqual([2, 0]);
  });
});
