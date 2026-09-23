import { describe, it, expect } from 'vitest';
import { generateChunk, surfaceHeight, SEA_LEVEL } from './terrain';
import { BLOCK } from './blocks';
import { CHUNK_SIZE, CHUNK_HEIGHT, chunkIndex } from './chunk';

// Known desert chunk for seed 1337 (scanned cx,cz in [-8,8): (3,-2) has 256 sand columns).
const SAND_SEED = 1337;
const SAND_CX = 3;
const SAND_CZ = -2;

// Known chunk with columns below sea level for seed 1337 (scan found water at (-7,3)).
const WATER_SEED = 1337;
const WATER_CX = -7;
const WATER_CZ = 3;

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

  it('no trees on sand columns', () => {
    const c = generateChunk(SAND_CX, SAND_CZ, SAND_SEED);
    let sandCount = 0;
    let logsAboveSand = 0;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const groundY = topTerrainY(c, x, z);
        if (groundY < 0) continue;
        if (c[chunkIndex(x, groundY, z)] === BLOCK.SAND) {
          sandCount++;
          for (let y = groundY + 1; y < CHUNK_HEIGHT; y++) {
            if (c[chunkIndex(x, y, z)] === BLOCK.LOG) logsAboveSand++;
          }
        }
      }
    }
    expect(sandCount).toBeGreaterThan(0);
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

  it('columns below sea level are filled with water', () => {
    const c = generateChunk(WATER_CX, WATER_CZ, WATER_SEED);
    const baseX = WATER_CX * CHUNK_SIZE;
    const baseZ = WATER_CZ * CHUNK_SIZE;
    let submerged = 0;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const h = surfaceHeight(baseX + x, baseZ + z, WATER_SEED);
        if (h < SEA_LEVEL) {
          expect(c[chunkIndex(x, h + 1, z)]).toBe(BLOCK.WATER);
          submerged++;
        }
      }
    }
    expect(submerged).toBeGreaterThan(0);
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
