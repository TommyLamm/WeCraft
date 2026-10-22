import { describe, it, expect } from 'vitest';
import {
  DEPTH_COMPRESSION,
  ORES,
  VANILLA_FLOOR,
  VANILLA_SEA_LEVEL,
  mapVanillaY,
  oreWeight,
  placeOres,
  unmapVanillaY,
} from './ores';
import { BLOCK } from './blocks';
import { CHUNK_SIZE, CHUNK_HEIGHT, chunkIndex } from './chunk';

/**
 * B5 Task 6：礦脈生成（單元測試）。
 *
 * 統計層面的斷言（帶界、峰值、每 16 區塊數量）在 `ores-stats.test.ts`；
 * 這裡只釘死純函式：深度映射、權重形狀、決定性。
 */

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('vanilla to game depth mapping', () => {
  it('the vanilla to game depth mapping keeps both anchors', () => {
    // 兩個錨點：原版海平面 62 → 本作 62；原版基岩 −64 → 本作 0。
    expect(VANILLA_SEA_LEVEL).toBe(62);
    expect(VANILLA_FLOOR).toBe(-64);
    expect(DEPTH_COMPRESSION).toBeCloseTo(62 / 126, 12);
    expect(mapVanillaY(62)).toBeCloseTo(62, 6);
    expect(mapVanillaY(-64)).toBeCloseTo(0, 6);
    // 原版 Y=0（深板岩帶頂）落在本作的地下中段。
    expect(mapVanillaY(0)).toBeCloseTo(31.492063, 4);
  });

  it('the mapping is a round trip', () => {
    for (const yv of [-64, -58, -16, 0, 16, 32, 62]) {
      expect(unmapVanillaY(mapVanillaY(yv))).toBeCloseTo(yv, 6);
    }
  });
});

describe('ore table', () => {
  it('the mapped ore bands follow the vanilla ranges', () => {
    const gold = ORES.find((o) => o.block === BLOCK.GOLD_ORE)!;
    expect(gold.minY).toBe(0);
    expect(gold.maxY).toBe(47);
    expect(gold.peakY).toBe(24);
    const diamond = ORES.find((o) => o.block === BLOCK.DIAMOND_ORE)!;
    expect(diamond.minY).toBe(1);
    expect(diamond.maxY).toBe(39);
  });

  it('the weight shape is what the design says', () => {
    const gold = ORES.find((o) => o.block === BLOCK.GOLD_ORE)!;
    expect(oreWeight(gold, gold.peakY)).toBeCloseTo(1, 6);
    expect(oreWeight(gold, gold.minY)).toBeCloseTo(0, 6);
    expect(oreWeight(gold, gold.maxY + 1)).toBe(0);

    const diamond = ORES.find((o) => o.block === BLOCK.DIAMOND_ORE)!;
    expect(oreWeight(diamond, diamond.minY)).toBeCloseTo(1, 6);
    expect(oreWeight(diamond, diamond.maxY)).toBeCloseTo(0, 6);
    expect(oreWeight(diamond, 20)).toBeLessThan(oreWeight(diamond, 5)); // 越深越常見
  });
});

describe('placeOres', () => {
  it('ore generation is deterministic', () => {
    const a = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
    const b = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
    // 同一份「只有石頭」的 chunk：y=0 是基岩、1..80 是石頭、其餘空氣。
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const id = y === 0 ? BLOCK.BEDROCK : y <= 80 ? BLOCK.STONE : BLOCK.AIR;
          a[chunkIndex(lx, y, lz)] = id;
          b[chunkIndex(lx, y, lz)] = id;
        }
      }
    }
    placeOres(a, 7, -3, 1337);
    placeOres(b, 7, -3, 1337);
    expect(bytesEqual(a, b)).toBe(true);

    // 不能是空轉：這塊石頭層必須真的被放了礦。
    const ores = new Set(ORES.map((o) => o.block));
    let placed = 0;
    for (let i = 0; i < a.length; i++) if (ores.has(a[i])) placed++;
    expect(placed).toBeGreaterThan(0);
  });
});
