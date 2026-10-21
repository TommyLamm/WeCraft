/**
 * 地表裝飾生成（B3 Task 6）：花／草叢／仙人掌／冰。
 *
 * 這個模組是**純模組**：不依賴 DOM／Three.js／`main.ts` 的任何狀態，
 * `plantDecorations` 只把方塊寫進傳進來的 `Uint8Array`（風格與 `trees.ts` 相同）。
 *
 * 規則的來源是計畫 §6（地表裝飾密度），數值都是釘死的：
 * - **花**（蒲公英／罌粟二選一）與**草叢**只長在草頂（陸地、表層是草）。
 * - **仙人掌**只長在沙漠的沙面上，高度 1／2／3 格的比例是原版的 11/18、5/18、2/18。
 * - **冰**取代「水面頂端那一格」，條件是水深 ≥ 2 格且氣溫 < −0.24（雪原門檻）。
 *
 * 與原版的差異：
 * 1. **密度是「每柱一次擲骰」**，不是原版的「每個區塊依雜湊分佈多個位置」→
 *    本作沒有「一片花田」的機率，花是稀疏的點狀分佈（計畫 §6 的數值）。
 * 2. **草叢與花互斥**：同一柱先判花，沒中花才判草叢（原版是兩套獨立的擲骰，
 *    可以同柱並存）。
 * 3. **冰的判定是簡化**：原版用「snowfall height」（生物群系的降雪高度）決定
 *    凍結溫度，且只在凍河／凍洋等**雪原水體**形成；本作以「氣溫 < −0.24」
 *    取代 snowfall height，**不**判斷水體的種類（海、湖、河一視同仁）。
 * 4. **仙人掌只長在沙上**（原版是沙與紅沙；本作沒有紅沙）。
 */
import { hash2 } from '../core/noise';
import { BLOCK } from './blocks';
import { CHUNK_SIZE, CHUNK_HEIGHT, chunkIndex } from './chunk';
import { biomeAt, surfaceBlockOf, type Biome } from './terrain';
import { SEA_LEVEL, surfaceHeight, temperature } from './terrain-noise';

/**
 * 花的機率（每柱）。
 *
 * 8 鍵窮舉（`Record<Biome, number>` 少一個就編譯不過 → 新增生態時編譯器會
 * 強制補列）。**雪原不長花、沙漠與海洋沒有地表植被** → 那三個生態是 0。
 */
export const FLOWER_PROBABILITY: Record<Biome, number> = {
  ocean: 0,
  plains: 0.0078,
  forest: 0.0078,
  birch_forest: 0.0117,
  taiga: 0.0039,
  snowy_plains: 0,
  desert: 0,
  mountains: 0.0039,
};

/** 草叢的機率（每柱）。8 鍵窮舉，理由同上（雪原是雪面、沙漠與海洋沒有植被）。 */
export const GRASS_PROBABILITY: Record<Biome, number> = {
  ocean: 0,
  plains: 0.1,
  forest: 0.12,
  birch_forest: 0.12,
  taiga: 0.08,
  snowy_plains: 0,
  desert: 0,
  mountains: 0.05,
};

/** 仙人掌的機率（每柱，沙漠沙面）。計畫 §6 的表。 */
export const CACTUS_PROBABILITY = 0.0059;

/**
 * 各擲骰的鹽值（固定寫死）。
 *
 * 每種擲骰用**不同的鹽** → 同一柱的「有沒有花」「是哪一種花」「有沒有草叢」
 * 「有沒有仙人掌」「仙人掌多高」彼此獨立（否則一顆雜湊要同時決定五件事，
 * 會互相相關）。
 */
const FLOWER_SALT = 0x2f1c7a3d;
const FLOWER_KIND_SALT = 0x77aa33cc;
const GRASS_SALT = 0x1b3d5e7f;
const CACTUS_SALT = 0x6c8e12f4;
const CACTUS_HEIGHT_SALT = 0x51d3c7a9;

/** `hash2` 的最大值（32 位無號整數）→ 擲骰值域是 [0, 1)。 */
const HASH_RANGE = 4294967296;

/** 雪原的氣溫門檻（與 `terrain.ts` 的 `SNOW_TEMP` 同值）→ 冰的凍結溫度。 */
const SNOW_TEMP = -0.24;

/** 原版的仙人掌高度比例：1 格 11/18、2 格 5/18、3 格 2/18（minecraft.wiki/Cactus）。 */
const CACTUS_HEIGHT_1_SHARE = 11 / 18;
const CACTUS_HEIGHT_2_SHARE = 5 / 18;

/** 一顆雜湊擲骰（0..1）。 */
function roll(x: number, z: number, seed: number, salt: number): number {
  return hash2(x, z, seed ^ salt) / HASH_RANGE;
}

/** 花的機率擲骰（0..1；小於該生態的機率就有花）。 */
export function flowerRoll(x: number, z: number, seed: number): number {
  return roll(x, z, seed, FLOWER_SALT);
}

/** 花的種類（蒲公英／罌粟，各半）。 */
export function flowerKind(x: number, z: number, seed: number): 'dandelion' | 'poppy' {
  return roll(x, z, seed, FLOWER_KIND_SALT) < 0.5 ? 'dandelion' : 'poppy';
}

/** 草叢的機率擲骰（0..1）。 */
export function grassRoll(x: number, z: number, seed: number): number {
  return roll(x, z, seed, GRASS_SALT);
}

/** 仙人掌的機率擲骰（0..1）。 */
export function cactusRoll(x: number, z: number, seed: number): number {
  return roll(x, z, seed, CACTUS_SALT);
}

/**
 * 仙人掌的高度（1／2／3 格）。
 *
 * 原版的比例（minecraft.wiki/Cactus#Natural generation，2026-10-20）：
 * 「They generate as one (11/18 chance), two (5/18 chance), or three (2/18
 * chance) blocks tall.」→ 這裡用同一組比例切分擲骰值。
 */
export function cactusHeight(x: number, z: number, seed: number): 1 | 2 | 3 {
  const r = roll(x, z, seed, CACTUS_HEIGHT_SALT);
  if (r < CACTUS_HEIGHT_1_SHARE) return 1;
  if (r < CACTUS_HEIGHT_1_SHARE + CACTUS_HEIGHT_2_SHARE) return 2;
  return 3;
}

/** 這根柱子夠不夠冷（氣溫 < −0.24 → 會結冰）。 */
export function isCold(x: number, z: number, seed: number): boolean {
  return temperature(x, z, seed) < SNOW_TEMP;
}

/** 這根柱子的表層是不是草（可放置地表植被的柱：陸地 ＋ 草面）。 */
function isGrassTop(biome: Biome, height: number): boolean {
  if (height <= SEA_LEVEL) return false; // 水裡與岸邊不長植被
  return surfaceBlockOf(biome, height) === BLOCK.GRASS;
}

/** 這根柱子上有花嗎？（回傳花的種類；沒有則 null）。 */
function flowerOnColumn(
  x: number,
  z: number,
  seed: number,
  biome: Biome,
  height: number,
): 'dandelion' | 'poppy' | null {
  if (!isGrassTop(biome, height)) return null;
  if (flowerRoll(x, z, seed) >= FLOWER_PROBABILITY[biome]) return null;
  return flowerKind(x, z, seed);
}

/** 這根柱子上有草叢嗎？（花優先：同一柱不會同時有花與草叢） */
function grassOnColumn(
  x: number,
  z: number,
  seed: number,
  biome: Biome,
  height: number,
): boolean {
  if (!isGrassTop(biome, height)) return false;
  if (flowerRoll(x, z, seed) < FLOWER_PROBABILITY[biome]) return false; // 已有花
  return grassRoll(x, z, seed) < GRASS_PROBABILITY[biome];
}

/** 這根柱子上有仙人掌嗎？（回傳高度；沒有則 0） */
function cactusOnColumn(
  x: number,
  z: number,
  seed: number,
  biome: Biome,
  height: number,
): 0 | 1 | 2 | 3 {
  if (biome !== 'desert') return 0;
  if (height <= SEA_LEVEL) return 0; // 沙漠不會長在水裡
  if (surfaceBlockOf(biome, height) !== BLOCK.SAND) return 0;
  if (cactusRoll(x, z, seed) >= CACTUS_PROBABILITY) return 0;
  return cactusHeight(x, z, seed);
}

/**
 * 這根柱子上有花嗎？（純規則層；給統計測試與規則測試用）
 *
 * 與 `plantDecorations` 走同一組判定 → 統計到的密度就是遊戲裡會長出來的密度。
 */
export function flowerOn(x: number, z: number, seed: number): 'dandelion' | 'poppy' | null {
  return flowerOnColumn(x, z, seed, biomeAt(x, z, seed), surfaceHeight(x, z, seed));
}

/** 這根柱子上有草叢嗎？（純規則層；花優先） */
export function grassOn(x: number, z: number, seed: number): boolean {
  return grassOnColumn(x, z, seed, biomeAt(x, z, seed), surfaceHeight(x, z, seed));
}

/** 這根柱子上有仙人掌嗎？（純規則層；回傳高度，0 = 沒有） */
export function cactusOn(x: number, z: number, seed: number): 0 | 1 | 2 | 3 {
  return cactusOnColumn(x, z, seed, biomeAt(x, z, seed), surfaceHeight(x, z, seed));
}

/**
 * 把這個區塊的地表裝飾寫進 `data`。
 *
 * 寫入範圍是這個區塊自己的 16×16 個柱子（裝飾只跟自己的柱子有關 → 沒有跨塊
 * 的 halo，也就不會有「同一格被兩塊寫入」的問題）。
 *
 * **只寫進空氣格**（風格與 `trees.ts` 的 `put` 相同）→ 樹木先占掉的格子不會
 * 被裝飾蓋掉（`generateChunk` 的順序是 地形 → 樹木 → 裝飾）。
 *
 * 冰是唯一的例外：它**取代**水面頂端那一格的水（而且只在該格確實是水時才取代）。
 */
export function plantDecorations(data: Uint8Array, cx: number, cz: number, seed: number): void {
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;

  const put = (lx: number, y: number, lz: number, id: number): void => {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    const i = chunkIndex(lx, y, lz);
    if (data[i] === BLOCK.AIR) data[i] = id;
  };

  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wx = baseX + lx;
      const wz = baseZ + lz;
      const h = surfaceHeight(wx, wz, seed);
      const biome = biomeAt(wx, wz, seed);

      // 1) 花／草叢（草頂；花優先，同柱不會兩者並存）
      const flower = flowerOnColumn(wx, wz, seed, biome, h);
      if (flower !== null) {
        put(lx, h + 1, lz, flower === 'dandelion' ? BLOCK.DANDELION : BLOCK.POPPY);
      } else if (grassOnColumn(wx, wz, seed, biome, h)) {
        put(lx, h + 1, lz, BLOCK.SHORT_GRASS);
      }

      // 2) 仙人掌（沙漠沙面；1–3 格）
      const cactus = cactusOnColumn(wx, wz, seed, biome, h);
      if (cactus > 0) {
        for (let i = 1; i <= cactus; i++) put(lx, h + i, lz, BLOCK.CACTUS);
      }

      // 3) 冰：水深 ≥ 2 格（h < SEA_LEVEL − 1）且氣溫 < −0.24 → 取代水面頂端
      if (h < SEA_LEVEL - 1 && isCold(wx, wz, seed)) {
        const i = chunkIndex(lx, SEA_LEVEL, lz);
        if (data[i] === BLOCK.WATER) data[i] = BLOCK.ICE;
      }
    }
  }
}
