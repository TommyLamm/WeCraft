/**
 * 地表裝飾（B3 Task 6）：花／草叢／仙人掌／冰的放置規則。
 *
 * 這個測試檔驗的是**規則**（不是畫面）：每一種裝飾長在哪裡、長多高、
 * 什麼時候不長。統計密度另外在 `worldgen-stats.test.ts`。
 *
 * 取樣區與種子沿用計畫 §6 的實測區（種子 1337），數字都是釘死的：
 * - 128×128 格（世界座標 0–127）有 51 株花、827 丛草叢，且**同時**有沙漠與
 *   雪原的柱（→ 「沙漠與雪原沒有花」不是空斷言）。
 * - chunk `(−14, −10)` 有 92 個 `h ≤ 60` 的水柱，其中 51 個氣溫 < −0.24。
 */
import { describe, it, expect } from 'vitest';
import {
  CACTUS_PROBABILITY,
  FLOWER_PROBABILITY,
  GRASS_PROBABILITY,
  cactusHeight,
  cactusOn,
  flowerRoll,
  flowerKind,
  grassRoll,
  isCold,
  plantDecorations,
} from './decorations';
import { biomeAt, generateChunk, surfaceBlockOf, SEA_LEVEL } from './terrain';
import { surfaceHeight, temperature } from './terrain-noise';
import { BLOCK } from './blocks';
import { CHUNK_SIZE, CHUNK_HEIGHT, chunkIndex } from './chunk';

/** 統計用的固定種子（與計畫 §6 的實測同一區域）。 */
const SEED = 1337;

/** 花／草的掃描範圍（世界座標 0–127）。 */
const SCAN_SIZE = 128;

/** 掃描範圍涵蓋的區塊數（128 格 = 8 個區塊）。 */
const SCAN_CHUNKS = SCAN_SIZE / CHUNK_SIZE;

/** 仙人掌的世界層取樣區（連續 1024×1024 格，與計畫 §6 的實測同區）。 */
const CACTUS_SAMPLE_SIZE = 1024;

/** 冰的測試區塊：種子 1337 該塊有 92 個 `h ≤ 60` 的水柱（其中 51 個夠冷）。 */
const ICE_CHUNK: readonly [number, number] = [-14, -10];

/** 雪原的氣溫門檻（與 `terrain.ts` 的 `SNOW_TEMP` 同值）。 */
const SNOW_TEMP = -0.24;

/** 一株仙人掌（純規則層的判定結果）。 */
interface CactusColumn {
  x: number;
  z: number;
  height: 1 | 2 | 3;
}

/**
 * 取樣區內的仙人掌（模組層級記憶化 → 兩個案例共用同一份結果）。
 *
 * 走的是純規則 `cactusOn`（與 `plantDecorations` 同一組判定），不是掃生成
 * 資料 → 這是「規則層」的統計；生成層的驗證在下面「the generated chunk
 * really contains the cactus on sand」那條。
 */
let cactiCache: CactusColumn[] | null = null;
function cactiInSampleRegion(): CactusColumn[] {
  if (cactiCache) return cactiCache;
  const out: CactusColumn[] = [];
  for (let z = 0; z < CACTUS_SAMPLE_SIZE; z++) {
    for (let x = 0; x < CACTUS_SAMPLE_SIZE; x++) {
      const height = cactusOn(x, z, SEED);
      if (height === 0) continue;
      out.push({ x, z, height });
    }
  }
  cactiCache = out;
  return out;
}

describe('decoration probability tables', () => {
  it('the probability tables cover every biome', () => {
    const biomes = [
      'ocean',
      'plains',
      'forest',
      'birch_forest',
      'taiga',
      'snowy_plains',
      'desert',
      'mountains',
    ] as const;
    for (const biome of biomes) {
      for (const [name, table] of [
        ['flower', FLOWER_PROBABILITY],
        ['grass', GRASS_PROBABILITY],
      ] as const) {
        const p = table[biome];
        expect(Number.isFinite(p), `${name}/${biome}`).toBe(true);
        expect(p, `${name}/${biome}`).toBeGreaterThanOrEqual(0);
        expect(p, `${name}/${biome}`).toBeLessThanOrEqual(1);
      }
    }
    // 雪原不長花、沙漠與海洋沒有地表植被（計畫 §6 的 8 鍵窮舉表）
    expect(FLOWER_PROBABILITY.snowy_plains).toBe(0);
    expect(FLOWER_PROBABILITY.desert).toBe(0);
    expect(FLOWER_PROBABILITY.ocean).toBe(0);
    expect(GRASS_PROBABILITY.snowy_plains).toBe(0);
    expect(GRASS_PROBABILITY.desert).toBe(0);
    expect(GRASS_PROBABILITY.ocean).toBe(0);
    // 仙人掌只長在沙漠（機率是每柱的擲骰值）
    expect(CACTUS_PROBABILITY).toBe(0.0059);
  });

  it('the rolls are stable 0..1 hashes of the column', () => {
    for (const [x, z] of [
      [0, 0],
      [17, -33],
      [400, 5],
    ] as const) {
      for (const roll of [flowerRoll, grassRoll]) {
        const v = roll(x, z, SEED);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
        expect(roll(x, z, SEED)).toBe(v); // 確定性
      }
      expect(['dandelion', 'poppy']).toContain(flowerKind(x, z, SEED));
    }
    // 不同種子 → 不同結果（否則換種子長出同樣的花）
    expect(flowerRoll(10, 10, 1)).not.toBe(flowerRoll(10, 10, 2));
  });
});

describe('surface decorations', () => {
  it(
    'flowers only grow on grass tops',
    { timeout: 120000 },
    () => {
      let flowers = 0;
      for (let cz = 0; cz < SCAN_CHUNKS; cz++) {
        for (let cx = 0; cx < SCAN_CHUNKS; cx++) {
          const data = generateChunk(cx, cz, SEED);
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            for (let lz = 0; lz < CHUNK_SIZE; lz++) {
              for (let y = 1; y < CHUNK_HEIGHT; y++) {
                const id = data[chunkIndex(lx, y, lz)];
                if (id !== BLOCK.DANDELION && id !== BLOCK.POPPY) continue;
                flowers++;
                const below = data[chunkIndex(lx, y - 1, lz)];
                expect(
                  below,
                  `flower at ${cx * CHUNK_SIZE + lx},${y},${cz * CHUNK_SIZE + lz} stands on block ${below}`,
                ).toBe(BLOCK.GRASS);
              }
            }
          }
        }
      }
      // 守衛：這個範圍裡必須真的有花，否則上面的斷言等於沒有驗證到東西
      expect(flowers).toBeGreaterThan(0);
    },
  );

  it(
    'desert and snow have no flowers',
    { timeout: 120000 },
    () => {
      let flowers = 0;
      const biomesSeen = new Set<string>();
      for (let cz = 0; cz < SCAN_CHUNKS; cz++) {
        for (let cx = 0; cx < SCAN_CHUNKS; cx++) {
          const data = generateChunk(cx, cz, SEED);
          const baseX = cx * CHUNK_SIZE;
          const baseZ = cz * CHUNK_SIZE;
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            for (let lz = 0; lz < CHUNK_SIZE; lz++) {
              const wx = baseX + lx;
              const wz = baseZ + lz;
              const biome = biomeAt(wx, wz, SEED);
              biomesSeen.add(biome);
              for (let y = 1; y < CHUNK_HEIGHT; y++) {
                const id = data[chunkIndex(lx, y, lz)];
                if (id !== BLOCK.DANDELION && id !== BLOCK.POPPY) continue;
                flowers++;
                expect(
                  biome,
                  `flower at ${wx},${y},${wz} grows in the ${biome} biome`,
                ).not.toBe('desert');
                expect(
                  biome,
                  `flower at ${wx},${y},${wz} grows in the ${biome} biome`,
                ).not.toBe('snowy_plains');
              }
            }
          }
        }
      }
      // 守衛：範圍內確實有花，而且沙漠與雪原的柱也確實存在（→ 不是空斷言）
      expect(flowers).toBeGreaterThan(0);
      expect(biomesSeen.has('desert')).toBe(true);
      expect(biomesSeen.has('snowy_plains')).toBe(true);
    },
  );

  it(
    'cactus only grows on sand in the desert',
    { timeout: 120000 },
    () => {
      const cacti = cactiInSampleRegion();
      // 守衛：這個區域裡必須真的有仙人掌
      expect(cacti.length).toBeGreaterThan(0);
      for (const c of cacti) {
        expect(biomeAt(c.x, c.z, SEED), `cactus at ${c.x},${c.z}`).toBe('desert');
        // 下面就是沙：沙漠柱的表層方塊是 SAND
        const ground = surfaceHeight(c.x, c.z, SEED);
        expect(
          surfaceBlockOf(biomeAt(c.x, c.z, SEED), ground),
          `cactus at ${c.x},${c.z} grows on block ${surfaceBlockOf(biomeAt(c.x, c.z, SEED), ground)}`,
        ).toBe(BLOCK.SAND);
        expect(ground, `cactus at ${c.x},${c.z} is under water`).toBeGreaterThan(SEA_LEVEL);
      }
    },
  );

  it('the generated chunk really contains the cactus on sand', () => {
    const first = cactiInSampleRegion()[0];
    expect(first).toBeDefined();
    const { x, z, height } = first;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const data = generateChunk(cx, cz, SEED);
    const lx = x - cx * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;
    const ground = surfaceHeight(x, z, SEED);
    // 表層是沙
    expect(data[chunkIndex(lx, ground, lz)]).toBe(BLOCK.SAND);
    expect(surfaceBlockOf(biomeAt(x, z, SEED), ground)).toBe(BLOCK.SAND);
    // 仙人掌從地表 +1 往上連續 height 格
    for (let i = 1; i <= height; i++) {
      expect(data[chunkIndex(lx, ground + i, lz)], `cactus cell ${i} of ${height}`).toBe(
        BLOCK.CACTUS,
      );
    }
    // 高度之上不是仙人掌（長多高就是多高）
    expect(data[chunkIndex(lx, ground + height + 1, lz)]).not.toBe(BLOCK.CACTUS);
  });

  it('cactusHeight maps to 1/2/3 with the vanilla 11:5:2 shares', () => {
    // 映射層：只用雜湊，不做生物群系／高度判斷（262,144 個取樣點，
    // x = i*8、z = j*8、i/j ∈ [0,512) → 覆蓋 4096×4096 格）
    const counts = [0, 0, 0];
    for (let j = 0; j < 512; j++) {
      for (let i = 0; i < 512; i++) {
        counts[cactusHeight(i * 8, j * 8, SEED) - 1]++;
      }
    }
    const total = 512 * 512;
    // 原版 11/18 = 61.1%、5/18 = 27.8%、2/18 = 11.1%（本機實測 61.18/27.78/11.04）
    expect(counts[0] / total).toBeGreaterThanOrEqual(0.58);
    expect(counts[0] / total).toBeLessThanOrEqual(0.64);
    expect(counts[1] / total).toBeGreaterThanOrEqual(0.25);
    expect(counts[1] / total).toBeLessThanOrEqual(0.31);
    expect(counts[2] / total).toBeGreaterThanOrEqual(0.08);
    expect(counts[2] / total).toBeLessThanOrEqual(0.14);
  });

  it(
    'cactus heights in the world are mostly one block tall',
    { timeout: 120000 },
    () => {
      // 世界層：連續 1024×1024 格、種子 1337（該區有 25832 個沙漠柱、136 株仙人掌）
      const heights = cactiInSampleRegion().map((c) => c.height);
      // 守衛：總數不能太少（否則比例是雜訊）
      expect(heights.length).toBeGreaterThanOrEqual(50);
      const count1 = heights.filter((h) => h === 1).length;
      const count2 = heights.filter((h) => h === 2).length;
      const count3 = heights.filter((h) => h === 3).length;
      // 1 格最多
      expect(count1).toBeGreaterThan(count2);
      expect(count1).toBeGreaterThan(count3);
      expect(count1 / heights.length).toBeGreaterThanOrEqual(0.45);
      expect(count1 / heights.length).toBeLessThanOrEqual(0.8);
      expect(count3 / heights.length).toBeLessThanOrEqual(0.35);
    },
  );
});

describe('ice', () => {
  it('ice replaces the top water block only in cold columns', () => {
    const [cx, cz] = ICE_CHUNK;
    const data = generateChunk(cx, cz, SEED);
    const baseX = cx * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;
    let ice = 0;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = baseX + lx;
        const wz = baseZ + lz;
        const h = surfaceHeight(wx, wz, SEED);
        const cold = temperature(wx, wz, SEED) < SNOW_TEMP;
        const deep = h <= SEA_LEVEL - 2; // 水深 ≥ 2 格
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          const id = data[chunkIndex(lx, y, lz)];
          if (id === BLOCK.ICE) {
            ice++;
            // 1. 冰在水面頂端（y = SEA_LEVEL）、柱夠深、氣溫夠低
            expect(y, `ice at ${wx},${y},${wz} is not at the water surface`).toBe(SEA_LEVEL);
            expect(h, `ice at ${wx},${y},${wz} sits on a too-shallow column`).toBeLessThanOrEqual(
              SEA_LEVEL - 2,
            );
            expect(cold, `ice at ${wx},${y},${wz} sits on a warm column`).toBe(true);
          }
        }
        // 2. 每個「夠冷且夠深」的柱，頂端那一格一定是冰
        if (cold && deep) {
          expect(
            data[chunkIndex(lx, SEA_LEVEL, lz)],
            `cold deep column ${wx},${wz} has no ice at the surface`,
          ).toBe(BLOCK.ICE);
        }
      }
    }
    // 3. 守衛：這個區塊必須真的有冰（否則上面的斷言不會執行）
    expect(ice).toBeGreaterThan(0);
  });

  it('isCold follows the snowy-plains temperature threshold', () => {
    for (const [x, z] of [
      [0, 0],
      [17, -33],
      [400, 5],
    ] as const) {
      expect(isCold(x, z, SEED)).toBe(temperature(x, z, SEED) < SNOW_TEMP);
    }
  });
});

describe('decoration generation', () => {
  it('decorations are deterministic', () => {
    const a = generateChunk(ICE_CHUNK[0], ICE_CHUNK[1], SEED);
    const b = generateChunk(ICE_CHUNK[0], ICE_CHUNK[1], SEED);
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) diff++;
    }
    expect(diff).toBe(0);
  });

  it('decorations never overwrite an existing block', () => {
    // 把裝飾再寫一次 → 已經是花／草／仙人掌／冰的格子不得被改動
    // （只寫 AIR 的規則；冰只取代 WATER）
    const data = generateChunk(ICE_CHUNK[0], ICE_CHUNK[1], SEED);
    const before = data.slice();
    plantDecorations(data, ICE_CHUNK[0], ICE_CHUNK[1], SEED);
    let diff = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== before[i]) diff++;
    }
    expect(diff).toBe(0);
  });
});
