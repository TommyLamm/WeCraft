import { describe, it, expect } from 'vitest';
import {
  generateChunk,
  surfaceHeight,
  pickBiome,
  biomeAt,
  surfaceBlockOf,
  subsurfaceBlockOf,
  SEA_LEVEL,
  type Biome,
} from './terrain';
import { BLOCK } from './blocks';
import { CHUNK_SIZE, CHUNK_HEIGHT, chunkIndex } from './chunk';
import { temperature, moisture } from './terrain-noise';

// 生成器無關的掃描範圍：種子 1337 底下，世界座標 (0,0)–(63,63) 共 4×4 個區塊。
// 舊測試把「哪一塊是沙地／哪一塊是水」寫死成座標，新生成器的地形本來就不同
// → 這些斷言會釘死在舊生成器上。改以「掃描範圍內所有符合條件的柱」來驗證，
// 斷言的實質（沙地不長樹／海面以下填滿水）不變。
const SCAN_SEED = 1337;
const SCAN_CHUNKS = 4; // 每軸 4 個區塊 = 64×64 格

// 種子 1337 底下仍有水柱的區塊（陸海交界，掃描後選定）。
const WATER_SEED = 1337;
const WATER_CX = 2;
const WATER_CZ = -2;

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Topmost terrain block, ignoring water and tree blocks (logs/leaves).
function topTerrainY(c: Uint8Array, lx: number, lz: number): number {
  for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
    const id = c[chunkIndex(lx, y, lz)];
    if (id !== BLOCK.AIR && id !== BLOCK.WATER && id !== BLOCK.LOG && id !== BLOCK.LEAVES)
      return y;
  }
  return -1;
}

describe('generateChunk', () => {
  it('same seed same data', () => {
    const a = generateChunk(3, -2, 1337);
    const b = generateChunk(3, -2, 1337);
    expect(bytesEqual(a, b)).toBe(true);
  });

  it('different seed differs', () => {
    const a = generateChunk(0, 0, 1);
    const b = generateChunk(0, 0, 2);
    expect(bytesEqual(a, b)).toBe(false);
  });

  it('y=0 is bedrock', () => {
    const c = generateChunk(0, 0, 1337);
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let x = 0; x < CHUNK_SIZE; x++)
        expect(c[chunkIndex(x, 0, z)]).toBe(BLOCK.BEDROCK);
  });

  it('column has solid surface and air above', () => {
    const c = generateChunk(0, 0, 1337);
    let topY = -1;
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      const id = c[chunkIndex(8, y, 8)];
      if (id !== BLOCK.AIR && id !== BLOCK.WATER) {
        topY = y;
        break;
      }
    }
    expect(topY).toBeGreaterThan(0);
    expect(topY).toBeLessThan(CHUNK_HEIGHT - 1);
    expect(c[chunkIndex(8, topY + 1, 8)]).toBe(BLOCK.AIR);
  });

  it('has stone below surface', () => {
    expect(generateChunk(0, 0, 1337).includes(BLOCK.STONE)).toBe(true);
  });

  it('sea level constant exported', () => {
    expect(SEA_LEVEL).toBeGreaterThan(0);
    expect(SEA_LEVEL).toBeLessThan(CHUNK_HEIGHT);
  });

  it('surfaceHeight is deterministic and in bounds', () => {
    const h1 = surfaceHeight(8, 8, 1337);
    const h2 = surfaceHeight(8, 8, 1337);
    expect(h1).toBe(h2);
    expect(h1).toBeGreaterThan(0);
    expect(h1).toBeLessThan(CHUNK_HEIGHT);
  });

  it('no tree grows on a sand column', () => {
    let sandColumns = 0;
    let logsAboveSand = 0;
    for (let cz = 0; cz < SCAN_CHUNKS; cz++) {
      for (let cx = 0; cx < SCAN_CHUNKS; cx++) {
        const c = generateChunk(cx, cz, SCAN_SEED);
        for (let z = 0; z < CHUNK_SIZE; z++) {
          for (let x = 0; x < CHUNK_SIZE; x++) {
            const groundY = topTerrainY(c, x, z);
            if (groundY < 0) continue;
            if (c[chunkIndex(x, groundY, z)] !== BLOCK.SAND) continue;
            sandColumns++;
            for (let y = groundY + 1; y < CHUNK_HEIGHT; y++) {
              if (c[chunkIndex(x, y, z)] === BLOCK.LOG) logsAboveSand++;
            }
          }
        }
      }
    }
    // 掃描範圍內必須真的有沙柱，否則這個案例等於沒有驗證到東西
    expect(sandColumns).toBeGreaterThan(0);
    if (sandColumns === 0) return;
    expect(logsAboveSand).toBe(0);
  });

  it('border heights match surfaceHeight on both chunks', () => {
    const seed = 1337;
    const left = generateChunk(0, 0, seed);
    const right = generateChunk(1, 0, seed);
    for (let z = 0; z < CHUNK_SIZE; z++) {
      expect(topTerrainY(left, CHUNK_SIZE - 1, z)).toBe(surfaceHeight(CHUNK_SIZE - 1, z, seed));
      expect(topTerrainY(right, 0, z)).toBe(surfaceHeight(CHUNK_SIZE, z, seed));
    }
  });

  it('tree canopies are not clipped at chunk borders', () => {
    const seed = 1337;
    const left = generateChunk(0, 0, seed);
    const right = generateChunk(1, 0, seed);

    // Trunk columns whose radius-2 canopy crosses the x=16 chunk border.
    const trunks: { wx: number; wz: number; top: number }[] = [];
    for (let wx = CHUNK_SIZE - 2; wx <= CHUNK_SIZE + 1; wx++) {
      const c = wx < CHUNK_SIZE ? left : right;
      const lx = wx % CHUNK_SIZE;
      for (let wz = 0; wz < CHUNK_SIZE; wz++) {
        let topLog = -1;
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          if (c[chunkIndex(lx, y, wz)] === BLOCK.LOG && y > topLog) topLog = y;
        }
        if (topLog >= 0) trunks.push({ wx, wz, top: topLog });
      }
    }
    expect(trunks.length).toBeGreaterThan(0);

    for (const t of trunks) {
      let ownSideLeaves = 0;
      let otherSideLeaves = 0;
      const trunkOnLeft = t.wx < CHUNK_SIZE;
      for (let x = t.wx - 2; x <= t.wx + 2; x++) {
        if (x < 0 || x >= CHUNK_SIZE * 2) continue;
        const c = x < CHUNK_SIZE ? left : right;
        const lx = x % CHUNK_SIZE;
        for (let y = t.top - 2; y <= t.top + 1; y++) {
          if (y < 0 || y >= CHUNK_HEIGHT) continue;
          for (let z = t.wz - 2; z <= t.wz + 2; z++) {
            if (z < 0 || z >= CHUNK_SIZE) continue;
            if (c[chunkIndex(lx, y, z)] !== BLOCK.LEAVES) continue;
            if (x < CHUNK_SIZE === trunkOnLeft) ownSideLeaves++;
            else otherSideLeaves++;
          }
        }
      }
      expect(ownSideLeaves).toBeGreaterThan(0);
      expect(otherSideLeaves).toBeGreaterThan(0);
    }
  });

  it('every column below sea level is filled with water up to sea level', () => {
    const c = generateChunk(WATER_CX, WATER_CZ, WATER_SEED);
    const baseX = WATER_CX * CHUNK_SIZE;
    const baseZ = WATER_CZ * CHUNK_SIZE;
    let waterColumns = 0;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const h = surfaceHeight(baseX + x, baseZ + z, WATER_SEED);
        if (h >= SEA_LEVEL) continue;
        waterColumns++;
        for (let y = h + 1; y <= SEA_LEVEL; y++) {
          expect(c[chunkIndex(x, y, z)]).toBe(BLOCK.WATER);
        }
      }
    }
    // 這個區塊必須真的有水柱，否則上面那圈斷言永遠不會執行（＝弱化）
    expect(waterColumns).toBeGreaterThan(0);
  });

  it('has caves below the surface', () => {
    const c = generateChunk(0, 0, 1337);
    let caveCells = 0;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const h = surfaceHeight(x, z, 1337);
        for (let y = 1; y < h; y++) {
          if (c[chunkIndex(x, y, z)] === BLOCK.AIR) caveCells++;
        }
      }
    }
    expect(caveCells).toBeGreaterThan(0);
  });

  it('contains coal and iron ore', () => {
    let coalLow = 0;
    let iron = 0;
    for (let cx = 0; cx < 4; cx++) {
      for (let cz = 0; cz < 4; cz++) {
        const c = generateChunk(cx, cz, 1337);
        for (let i = 0; i < c.length; i++) {
          const id = c[i];
          if (id === BLOCK.COAL_ORE) {
            const y = Math.floor(i / (CHUNK_SIZE * CHUNK_SIZE));
            if (y < 64) coalLow++;
          } else if (id === BLOCK.IRON_ORE) {
            const y = Math.floor(i / (CHUNK_SIZE * CHUNK_SIZE));
            expect(y).toBeLessThan(16);
            iron++;
          }
        }
      }
    }
    expect(coalLow).toBeGreaterThan(0);
    expect(iron).toBeGreaterThan(0);
  });
});

describe('pickBiome', () => {
  // 判定順序（順序即優先級）：海洋 → 高山 → 雪原 → 針葉林 → 沙漠 → 白樺林 → 森林 → 平原。
  // 舊的 `pickBiome(temp, moist)` 舊簽名／舊門檻（4 種生態）在 B3.2 改成
  // `pickBiome({ height, temp, moist })`（8 種生態），門檻等號落點的覆蓋在
  // 下一個案例（the biome thresholds are strict at the boundary）補齊。
  it('classifies the eight biomes', () => {
    expect(pickBiome({ height: 50, temp: 0, moist: 0 })).toBe('ocean');
    expect(pickBiome({ height: 100, temp: 0, moist: 0 })).toBe('mountains');
    expect(pickBiome({ height: 70, temp: -0.30, moist: 0.2 })).toBe('snowy_plains');
    expect(pickBiome({ height: 70, temp: -0.16, moist: -0.10 })).toBe('taiga');
    expect(pickBiome({ height: 70, temp: 0.20, moist: -0.20 })).toBe('desert');
    expect(pickBiome({ height: 70, temp: 0, moist: 0.26 })).toBe('birch_forest');
    expect(pickBiome({ height: 70, temp: 0, moist: 0.09 })).toBe('forest');
    expect(pickBiome({ height: 70, temp: 0, moist: -0.12 })).toBe('plains');
  });

  it('the biome thresholds are strict at the boundary', () => {
    // 高度門檻（規則 1／2）
    expect(pickBiome({ height: 63, temp: 0, moist: 0 })).toBe('ocean'); // h ≤ 63 → ocean
    expect(pickBiome({ height: 64, temp: 0, moist: 0 })).not.toBe('ocean'); // h = 64 不再是 ocean
    expect(pickBiome({ height: 92, temp: 0, moist: 0 })).toBe('mountains'); // h ≥ 92 → mountains
    expect(pickBiome({ height: 91, temp: 0, moist: 0 })).not.toBe('mountains');
    // 氣溫門檻（規則 3／4）
    expect(pickBiome({ height: 70, temp: -0.24, moist: 0.2 })).toBe('taiga'); // temp = −0.24 不再是 snowy_plains
    expect(pickBiome({ height: 70, temp: -0.25, moist: 0.2 })).toBe('snowy_plains');
    expect(pickBiome({ height: 70, temp: -0.12, moist: -0.10 })).toBe('plains'); // temp = −0.12 不再是 taiga
    // 濕度門檻（規則 6／7）
    expect(pickBiome({ height: 70, temp: 0, moist: 0.20 })).toBe('forest'); // moist = 0.20 不是 birch_forest
    expect(pickBiome({ height: 70, temp: 0, moist: 0.21 })).toBe('birch_forest');
    expect(pickBiome({ height: 70, temp: 0, moist: 0.00 })).toBe('plains'); // moist = 0.00 不是 forest
    // 沙漠門檻（規則 5）
    expect(pickBiome({ height: 70, temp: 0.08, moist: -0.08 })).not.toBe('desert'); // 兩個門檻都是嚴格不等於
    expect(pickBiome({ height: 70, temp: 0.09, moist: -0.09 })).toBe('desert');
  });

  it('the biome order gives the earlier rule priority', () => {
    // 高度優先於氣候：山頂就算很冷也是高山
    expect(pickBiome({ height: 100, temp: -0.30, moist: 0 })).toBe('mountains');
    // 海洋優先於沙漠：海裡就算又熱又乾也是海洋
    expect(pickBiome({ height: 50, temp: 0.3, moist: -0.3 })).toBe('ocean');
  });
});

describe('biomeAt', () => {
  it('matches the climate field sampling exactly (deterministic)', () => {
    const seed = 1337;
    const points: Array<[number, number]> = [
      [0, 0],
      [8, 8],
      [123, -45],
      [-17.5, 3.25],
      [1e4, -1e4],
    ];
    for (const [x, z] of points) {
      // 氣候場改由 terrain-noise 提供（CLIM_FREQ = 0.002／3 層 fbm），
      // 這裡用同一組欄位重算 → `biomeAt` 與 `generateChunk` 必須一致。
      const expected = pickBiome({
        height: surfaceHeight(x, z, seed),
        temp: temperature(x, z, seed),
        moist: moisture(x, z, seed),
      });
      expect(biomeAt(x, z, seed)).toBe(expected);
      expect(biomeAt(x, z, seed)).toBe(expected); // memoized fields stay stable
    }
  });

  it('biomeAt matches the pinned reference columns', () => {
    // 種子 1337 的釘死參考點（每種生態各一個）：改判定門檻或氣候取樣形式都會紅。
    const cases: Array<[number, number, Biome]> = [
      [90, 30, 'desert'],
      [597, -393, 'snowy_plains'],
      [-492, -600, 'forest'],
      [576, -600, 'birch_forest'],
      [-192, -501, 'taiga'],
      [3, -468, 'mountains'],
      [183, -600, 'ocean'],
      [-159, -564, 'plains'],
    ];
    for (const [x, z, b] of cases) expect(biomeAt(x, z, 1337)).toBe(b);
  });

  it('the surface material matches the biome table', () => {
    const seed = 1337;
    const c = generateChunk(0, 0, seed);
    let checked = 0;
    for (let lz = 0; lz < CHUNK_SIZE; lz += 5) {
      for (let lx = 0; lx < CHUNK_SIZE; lx += 5) {
        const y = topTerrainY(c, lx, lz);
        const id = c[chunkIndex(lx, y, lz)];
        const h = surfaceHeight(lx, lz, seed);
        expect(id).toBe(surfaceBlockOf(biomeAt(lx, lz, seed), h));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('surface blocks', () => {
  it('the surface table follows the biome rules', () => {
    expect(surfaceBlockOf('ocean', 60)).toBe(BLOCK.SAND);
    expect(surfaceBlockOf('desert', 70)).toBe(BLOCK.SAND);
    expect(surfaceBlockOf('snowy_plains', 70)).toBe(BLOCK.SNOW);
    expect(surfaceBlockOf('mountains', 120)).toBe(BLOCK.SNOW);
    expect(surfaceBlockOf('mountains', 106)).toBe(BLOCK.STONE);
    expect(surfaceBlockOf('mountains', 95)).toBe(BLOCK.GRASS);
    expect(surfaceBlockOf('plains', 70)).toBe(BLOCK.GRASS);
    expect(subsurfaceBlockOf('desert')).toBe(BLOCK.SAND);
    expect(subsurfaceBlockOf('plains')).toBe(BLOCK.DIRT);
  });

  it('the mountain surface switches at the pinned heights', () => {
    // 高山：92 ≤ h < 104 草、104 ≤ h < 112 裸岩、h ≥ 112 雪頂（等號落點）
    expect(surfaceBlockOf('mountains', 92)).toBe(BLOCK.GRASS);
    expect(surfaceBlockOf('mountains', 103)).toBe(BLOCK.GRASS);
    expect(surfaceBlockOf('mountains', 104)).toBe(BLOCK.STONE);
    expect(surfaceBlockOf('mountains', 111)).toBe(BLOCK.STONE);
    expect(surfaceBlockOf('mountains', 112)).toBe(BLOCK.SNOW);
  });

  it('the subsurface is sand under ocean and desert, dirt elsewhere', () => {
    expect(subsurfaceBlockOf('ocean')).toBe(BLOCK.SAND);
    expect(subsurfaceBlockOf('forest')).toBe(BLOCK.DIRT);
    expect(subsurfaceBlockOf('birch_forest')).toBe(BLOCK.DIRT);
    expect(subsurfaceBlockOf('taiga')).toBe(BLOCK.DIRT);
    expect(subsurfaceBlockOf('snowy_plains')).toBe(BLOCK.DIRT);
    expect(subsurfaceBlockOf('mountains')).toBe(BLOCK.DIRT);
  });
});
