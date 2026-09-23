import { describe, it, expect } from 'vitest';
import { generateChunk, surfaceHeight, SEA_LEVEL } from './terrain';
import { BLOCK } from './blocks';
import { CHUNK_SIZE, CHUNK_HEIGHT, chunkIndex } from './chunk';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
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
    const c = generateChunk(0, 0, 1337);
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        let topY = -1;
        for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
          const id = c[chunkIndex(x, y, z)];
          if (id !== BLOCK.AIR && id !== BLOCK.WATER) {
            topY = y;
            break;
          }
        }
        if (c[chunkIndex(x, topY, z)] === BLOCK.SAND) {
          for (let y = topY + 1; y < CHUNK_HEIGHT; y++) {
            expect(c[chunkIndex(x, y, z)]).not.toBe(BLOCK.LOG);
          }
        }
      }
    }
  });
});
