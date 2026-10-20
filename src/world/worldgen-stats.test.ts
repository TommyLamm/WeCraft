import { describe, it, expect } from 'vitest';
import { surfaceHeight, SEA_LEVEL } from './terrain';

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
