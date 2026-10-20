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
    // 規則 1（海洋）優先於氣候規則：海裡就算很冷或又熱又乾也是海洋
    expect(pickBiome({ height: 50, temp: -0.30, moist: 0.2 })).toBe('ocean');
    expect(pickBiome({ height: 50, temp: 0.3, moist: -0.3 })).toBe('ocean');
    // 規則 2（高山）優先於氣候規則：山頂就算很冷或又熱又乾也是高山
    expect(pickBiome({ height: 100, temp: -0.30, moist: 0 })).toBe('mountains');
    expect(pickBiome({ height: 100, temp: 0.3, moist: -0.3 })).toBe('mountains');
    // 規則 3（雪原）優先於規則 4（針葉林）：同樣「冷」，雪原的門檻更嚴
    expect(pickBiome({ height: 70, temp: -0.30, moist: 0.3 })).toBe('snowy_plains');
    // 規則 4（針葉林）優先於規則 6／7（白樺林／森林）：又冷又濕時是針葉林，
    // 不是白樺林（moist 0.30 > 0.20）也不是森林（moist 0.09 > 0）
    expect(pickBiome({ height: 70, temp: -0.16, moist: 0.30 })).toBe('taiga');
    expect(pickBiome({ height: 70, temp: -0.16, moist: 0.09 })).toBe('taiga');
    // 規則 6（白樺林）優先於規則 7（森林）：同一條濕度門檻，更濕的是白樺林
    expect(pickBiome({ height: 70, temp: 0, moist: 0.21 })).toBe('birch_forest');
    // 其餘的規則對互斥、不可能同時成立 → 沒有「誰優先」的組合可測：
    //   規則 1 vs 2（h ≤ 63 與 h ≥ 92）、規則 4 vs 5（temp < −0.12 與 temp > 0.08）、
    //   規則 5 vs 6／7（moist < −0.08 與 moist > 0.20／> 0）。
    //   這三對的「其中一條會命中」已由上面的案例與門檻案例覆蓋。
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
    // 取樣必須涵蓋多種生態與多種材質，否則這條案例抓不到回歸：
    // 舊的硬編碼分支（desert → SAND、snow → SNOW、其餘 → GRASS）會把 ocean
    // 的沙灘判成草地，而只要取樣全是 plains，那個錯誤就不會被看見。
    //
    // 取樣區塊（種子 1337，審查者實測的生態分佈）：
    //   (0,0) plains｜(3,1) plains＋desert｜(4,1) desert＋ocean（沙灘）｜
    //   (0,4) snowy_plains＋taiga（雪與草）
    const seed = 1337;
    const chunks: Array<[number, number]> = [
      [0, 0],
      [3, 1],
      [4, 1],
      [0, 4],
    ];
    const biomes = new Set<Biome>();
    const surfaces = new Set<number>();
    let checked = 0;
    for (const [cx, cz] of chunks) {
      const c = generateChunk(cx, cz, seed);
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const y = topTerrainY(c, lx, lz);
          const id = c[chunkIndex(lx, y, lz)];
          const wx = cx * CHUNK_SIZE + lx;
          const wz = cz * CHUNK_SIZE + lz;
          const h = surfaceHeight(wx, wz, seed);
          const biome = biomeAt(wx, wz, seed);
          // 表層（y === h）與表層以下（y === h − 1）都要符合 §4 的材質表
          expect(id).toBe(surfaceBlockOf(biome, h));
          expect(c[chunkIndex(lx, h - 1, lz)]).toBe(subsurfaceBlockOf(biome));
          biomes.add(biome);
          surfaces.add(id);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    // 守衛：取樣必須真的涵蓋多種生態與多種材質，否則這個案例會變成空轉
    // （例如日後地形的氣候塊換位置 → 只剩一種生態 → 回歸抓不到）。
    expect(biomes.size).toBeGreaterThanOrEqual(3);
    expect([...biomes].some((b) => b !== 'plains')).toBe(true);
    expect(surfaces.has(BLOCK.SAND)).toBe(true); // ocean／desert
    expect(surfaces.has(BLOCK.SNOW)).toBe(true); // snowy_plains
    expect(surfaces.has(BLOCK.GRASS)).toBe(true); // plains／forest／taiga
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
