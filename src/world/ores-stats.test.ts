import { describe, it, expect } from 'vitest';
import { generateChunk } from './terrain';
import { BLOCK } from './blocks';
import { CHUNK_SIZE } from './chunk';

/**
 * B5 Task 6：礦脈分佈的統計測試（固定種子 1337，4×4＝16 個區塊）。
 *
 * **這些區間是設計斷言，不是「跑出來剛好長這樣」**：數值出自計畫
 * 〈已查證與設計決策〉§5 的每區塊預期量 × 16 區塊，以及原版深度映射的
 * 帶界／峰值。實作者不得為了讓測試變綠而放寬——若實測落在區間外，先確認
 * 實作真的符合規定的公式（權重、鹽、密度），必要時調整常數並在 commit
 * 訊息說明。
 *
 * 母體＝16 區塊 × 256 柱＝4096 柱；每個區塊都走真正的 `generateChunk`
 * （含洞穴切挖與樹木／裝飾），所以統計到的是玩家實際看到的世界。
 */
const SEED = 1337;
const CHUNKS_PER_AXIS = 4; // (cx, cz) ∈ [0, 4)² → 16 區塊

interface OreSurvey {
  /** 每個金礦格的 y（依掃描順序）。 */
  gold: number[];
  /** 每個鑽石礦格的 y。 */
  diamond: number[];
  /** 每個鐵礦格的 y。 */
  iron: number[];
  /** 礫石總格數（不保留 y）。 */
  gravel: number;
}

/**
 * 掃描一次、所有案例共用（模組層級記憶化）。
 *
 * 16 個區塊重算一次約 100–200 ms；六個統計案例若各自重掃會多花一倍以上。
 */
let survey: OreSurvey | null = null;

function oreSurvey(): OreSurvey {
  if (survey) return survey;
  const gold: number[] = [];
  const diamond: number[] = [];
  const iron: number[] = [];
  let gravel = 0;
  for (let cz = 0; cz < CHUNKS_PER_AXIS; cz++) {
    for (let cx = 0; cx < CHUNKS_PER_AXIS; cx++) {
      const data = generateChunk(cx, cz, SEED);
      for (let i = 0; i < data.length; i++) {
        const id = data[i];
        if (
          id !== BLOCK.GOLD_ORE &&
          id !== BLOCK.DIAMOND_ORE &&
          id !== BLOCK.IRON_ORE &&
          id !== BLOCK.GRAVEL
        ) {
          continue;
        }
        const y = Math.floor(i / (CHUNK_SIZE * CHUNK_SIZE));
        if (id === BLOCK.GOLD_ORE) gold.push(y);
        else if (id === BLOCK.DIAMOND_ORE) diamond.push(y);
        else if (id === BLOCK.IRON_ORE) iron.push(y);
        else gravel++;
      }
    }
  }
  survey = { gold, diamond, iron, gravel };
  return survey;
}

/** 中位數（偶數長度取中間兩者的平均）。呼叫端必須先確保 `values` 非空。 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function countAtOrBelow(values: number[], maxY: number): number {
  let n = 0;
  for (const y of values) if (y <= maxY) n++;
  return n;
}

function countAtOrAbove(values: number[], minY: number): number {
  let n = 0;
  for (const y of values) if (y >= minY) n++;
  return n;
}

describe('ore band statistics', () => {
  it(
    'gold only generates inside its mapped band',
    { timeout: 30000 },
    () => {
      const gold = oreSurvey().gold;
      expect(gold.length).toBeGreaterThan(0); // 空集合會讓下面的迴圈空轉
      for (const y of gold) {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(47);
      }
    },
  );

  it(
    'diamond only generates inside its mapped band',
    { timeout: 30000 },
    () => {
      const diamond = oreSurvey().diamond;
      expect(diamond.length).toBeGreaterThan(0);
      for (const y of diamond) {
        expect(y).toBeGreaterThanOrEqual(1);
        expect(y).toBeLessThanOrEqual(39);
      }
    },
  );

  it(
    'iron only generates inside its mapped band',
    { timeout: 30000 },
    () => {
      const iron = oreSurvey().iron;
      expect(iron.length).toBeGreaterThan(0);
      for (const y of iron) {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(67);
      }
    },
  );
});

describe('ore distribution statistics', () => {
  it(
    'gold peaks around the mapped vanilla peak (y=24)',
    { timeout: 30000 },
    () => {
      const gold = oreSurvey().gold;
      expect(gold.length).toBeGreaterThan(0);
      // 三角權重峰在 24、半寬 24 → 中位數會落在峰附近；區間 [16, 32] 涵蓋
      // 抽樣誤差，也足以抓「峰被搬到別的高度」或「分佈變成均勻」。
      const middle = median(gold);
      expect(middle).toBeGreaterThanOrEqual(16);
      expect(middle).toBeLessThanOrEqual(32);
    },
  );

  it(
    'diamond is more common the deeper it is',
    { timeout: 30000 },
    () => {
      const diamond = oreSurvey().diamond;
      expect(diamond.length).toBeGreaterThan(0);
      // 解析中位數：w(y) = (39−y)/38、y ∈ [1, 39] → 累積過半落在 y ≈ 11.3。
      // 區間 [1, 16] 留給抽樣誤差（n≈54）；淺海柱的石頭只到 y≈h−5，
      // 會少掉帶內高處的格子（不影響「越深越常見」的方向）。
      const middle = median(diamond);
      expect(middle).toBeGreaterThanOrEqual(1);
      expect(middle).toBeLessThanOrEqual(16);
      // 單調遞減的斜率檢查：上段的鑽石必須明顯少於下段。
      expect(countAtOrBelow(diamond, 10)).toBeGreaterThan(countAtOrAbove(diamond, 25));
    },
  );
});

describe('ore volume statistics', () => {
  it(
    'the ore volume per 16 chunks matches the design',
    { timeout: 30000 },
    () => {
      const s = oreSurvey();
      // 設計預期（§5）：金 ≈6.7／區塊、鑽 ≈3.6、鐵 ≈31、礫石 ≈12.8
      // → 16 區塊分別約 107／57／500／205。區間沿用計畫的設計斷言，不放寬。
      expect(s.gold.length).toBeGreaterThanOrEqual(40);
      expect(s.gold.length).toBeLessThanOrEqual(220);
      expect(s.diamond.length).toBeGreaterThanOrEqual(15);
      expect(s.diamond.length).toBeLessThanOrEqual(120);
      expect(s.iron.length).toBeGreaterThanOrEqual(200);
      expect(s.iron.length).toBeLessThanOrEqual(1000);
      expect(s.gravel).toBeGreaterThanOrEqual(60);
      expect(s.gravel).toBeLessThanOrEqual(420);
    },
  );
});
