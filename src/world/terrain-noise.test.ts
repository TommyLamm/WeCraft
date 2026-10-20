import { describe, it, expect } from 'vitest';
import {
  terrainNoises,
  continentalness,
  erosion,
  peaksAndValleys,
  surfaceHeight,
  temperature,
  moisture,
  SEA_LEVEL,
} from './terrain-noise';

const SEED = 1337;

/** 釘死的噪音層取樣點：400 點（i, j ∈ [0, 20)）。 */
function noiseSamplePoints(): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++) pts.push([i * 37, j * 53]);
  return pts;
}

describe('terrainNoises', () => {
  it('terrainNoises memoizes one Noise set per seed', () => {
    expect(terrainNoises(1337)).toBe(terrainNoises(1337));
    expect(terrainNoises(1337)).not.toBe(terrainNoises(4242));
  });

  it('the raw noise layers stay inside their expected range', () => {
    for (const [x, z] of noiseSamplePoints()) {
      const cont = continentalness(x, z, SEED);
      const ero = erosion(x, z, SEED);
      const pv = peaksAndValleys(x, z, SEED);
      expect(cont).toBeGreaterThanOrEqual(-0.75);
      expect(cont).toBeLessThanOrEqual(0.75);
      expect(ero).toBeGreaterThanOrEqual(-0.75);
      expect(ero).toBeLessThanOrEqual(0.75);
      // 原版 PV 公式 1 − |3·|w| − 2| 的值域是 [−1, 1]
      expect(pv).toBeGreaterThanOrEqual(-1.2);
      expect(pv).toBeLessThanOrEqual(1);
    }
  });
});

describe('surfaceHeight', () => {
  it('surfaceHeight matches the pinned reference values', () => {
    const cases: Array<[number, number, number]> = [
      [0, 0, 67],
      [8, 8, 67],
      [16, 16, 67],
      [100, 50, 65],
      [-37, 220, 83],
      [512, 512, 75],
      [1024, 1024, 70],
      [-2048, 512, 93],
      [4096, -1024, 67],
      [123, -456, 59],
    ];
    for (const [x, z, h] of cases) expect(surfaceHeight(x, z, 1337)).toBe(h);
  });

  it('surfaceHeight matches the pinned reference values for seed 4242', () => {
    const cases: Array<[number, number, number]> = [
      [0, 0, 71],
      [8, 8, 70],
      [16, 16, 68],
      [100, 50, 68],
      [-37, 220, 94],
    ];
    for (const [x, z, h] of cases) expect(surfaceHeight(x, z, 4242)).toBe(h);
  });

  it('surfaceHeight is deterministic and inside the world bounds', () => {
    for (const [x, z] of noiseSamplePoints()) {
      const h1 = surfaceHeight(x, z, SEED);
      const h2 = surfaceHeight(x, z, SEED);
      expect(h1).toBe(h2);
      // 世界高度維持 0–255（CHUNK_HEIGHT = 256），表面高度夾在 [4, 246]
      expect(h1).toBeGreaterThanOrEqual(4);
      expect(h1).toBeLessThanOrEqual(246);
    }
  });

  it('the height formula keeps the sea level at 62', () => {
    expect(SEA_LEVEL).toBe(62);
  });
});

describe('climate fields', () => {
  it('temperature and moisture are independent fields', () => {
    // 註：grad noise 在「整數格點」上恆為 0（xf = yf = 0 → 梯度項全為 0），
    // 因此 (0,0) 這種格點無法用來比較兩個氣候場（兩者都會是 0）。
    // 獨立性改用非格點取樣驗證。
    const points: Array<[number, number]> = [
      [0.5, 0.5],
      [37, 53.5],
      [123.25, -456.75],
      [-2048.5, 512.25],
    ];
    for (const [x, z] of points) {
      const t = temperature(x, z, 1337);
      const m = moisture(x, z, 1337);
      expect(Number.isFinite(t)).toBe(true);
      expect(Number.isFinite(m)).toBe(true);
      expect(t).not.toBe(m);
    }
    // 格點上的 0 是噪音原语的性質（不是欄位重複），一併釘住
    expect(temperature(0, 0, 1337)).toBe(0);
    expect(moisture(0, 0, 1337)).toBe(0);
  });
});
