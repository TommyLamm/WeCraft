import { describe, it, expect } from 'vitest';
import { surfaceHeight, SEA_LEVEL, biomeAt, type Biome } from './terrain';

// 取樣設定（之後所有統計測試共用；寫在檔頂端的 helper 區）
const SEED = 1337;
const SAMPLE_N = 256; // 256 × 256 個取樣點
const SAMPLE_STRIDE = 32; // 每點間隔 32 格 → 覆蓋 8192 × 8192 格

/** 跨距取樣點（等距抽樣 → 覆蓋大面積，避免只抽到單一氣候塊） */
function samplePoints(): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let j = 0; j < SAMPLE_N; j++)
    for (let i = 0; i < SAMPLE_N; i++) pts.push([i * SAMPLE_STRIDE, j * SAMPLE_STRIDE]);
  return pts;
}

function quantile(sorted: number[], q: number): number {
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** 取樣點的高度（已排序）與是否在水下的旗標。 */
function sampledHeights(): { sorted: number[]; water: number; total: number } {
  const points = samplePoints();
  const heights: number[] = [];
  let water = 0;
  for (const [x, z] of points) {
    const h = surfaceHeight(x, z, SEED);
    heights.push(h);
    if (h < SEA_LEVEL) water++;
  }
  heights.sort((a, b) => a - b);
  return { sorted: heights, water, total: points.length };
}

/**
 * 取樣點的生態計數（模組層級記憶化 → 8 個案例共用同一份取樣結果）。
 *
 * 判定用 `biomeAt`（＝ 高度 + 氣候場 → `pickBiome`），與 `generateChunk`
 * 用的是同一條路徑 → 統計到的比例就是遊戲裡實際會出現的比例。
 */
let biomeCounts: Map<Biome, number> | null = null;
function sampledBiomeCounts(): Map<Biome, number> {
  if (biomeCounts) return biomeCounts;
  const counts = new Map<Biome, number>();
  for (const [x, z] of samplePoints()) {
    const b = biomeAt(x, z, SEED);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  biomeCounts = counts;
  return counts;
}

/** 某個生態在取樣範圍內的面積比例。 */
function biomeRatio(biome: Biome): number {
  const counts = sampledBiomeCounts();
  return (counts.get(biome) ?? 0) / (SAMPLE_N * SAMPLE_N);
}

/**
 * 八生態的面積容差（計畫〈已查證與設計決策〉§4）。
 *
 * 門檻是「釘死種子 1337 的實測值 ± 容差」，不是「看起來差不多」：
 * 實測值 ocean 33.4%／plains 16.5%／forest 15.1%／birch_forest 7.6%／
 * taiga 8.7%／snowy_plains 7.7%／desert 6.9%／mountains 4.2%。
 */
const BIOME_AREA_TOLERANCE: ReadonlyArray<readonly [Biome, number, number]> = [
  ['ocean', 0.3, 0.37],
  ['plains', 0.13, 0.2],
  ['forest', 0.12, 0.18],
  ['birch_forest', 0.05, 0.11],
  ['taiga', 0.06, 0.12],
  ['snowy_plains', 0.05, 0.11],
  ['desert', 0.04, 0.1],
  ['mountains', 0.02, 0.07],
];

describe('worldgen height statistics', () => {
  it(
    'the ocean covers 26%–32% of the sampled world',
    { timeout: 30000 },
    () => {
      const { water, total } = sampledHeights();
      const ratio = water / total;
      expect(ratio).toBeGreaterThanOrEqual(0.26);
      expect(ratio).toBeLessThanOrEqual(0.32);
    },
  );

  it(
    'the height distribution matches the pinned bands',
    { timeout: 30000 },
    () => {
      const { sorted } = sampledHeights();
      expect(quantile(sorted, 0.05)).toBeGreaterThanOrEqual(41);
      expect(quantile(sorted, 0.05)).toBeLessThanOrEqual(47);
      expect(quantile(sorted, 0.5)).toBeGreaterThanOrEqual(66);
      expect(quantile(sorted, 0.5)).toBeLessThanOrEqual(72);
      expect(quantile(sorted, 0.95)).toBeGreaterThanOrEqual(85);
      expect(quantile(sorted, 0.95)).toBeLessThanOrEqual(93);
      expect(quantile(sorted, 0.99)).toBeGreaterThanOrEqual(100);
      expect(quantile(sorted, 0.99)).toBeLessThanOrEqual(112);
    },
  );

  it(
    'the world height is never expanded beyond 0–255',
    { timeout: 30000 },
    () => {
      const { sorted } = sampledHeights();
      expect(sorted[0]).toBeGreaterThanOrEqual(0);
      expect(sorted[sorted.length - 1]).toBeLessThanOrEqual(255);
    },
  );
});

describe('worldgen biome statistics', () => {
  for (const [biome, min, max] of BIOME_AREA_TOLERANCE) {
    it(
      `the ${biome} area stays inside ${(min * 100).toFixed(0)}%–${(max * 100).toFixed(0)}%`,
      { timeout: 30000 },
      () => {
        const ratio = biomeRatio(biome);
        expect(ratio).toBeGreaterThanOrEqual(min);
        expect(ratio).toBeLessThanOrEqual(max);
      },
    );
  }
});
