import { describe, it, expect } from 'vitest';
import { normalizeSpawnPoint } from './spawn-point';

describe('normalizeSpawnPoint', () => {
  it('B10: a legal point returns a fresh object (never the same reference)', () => {
    const input = { x: 4, y: 65, z: -7 };
    const out = normalizeSpawnPoint(input);
    expect(out).toEqual({ x: 4, y: 65, z: -7 });
    expect(out).not.toBe(input);
  });

  it('B10: null / undefined / non-objects are rejected', () => {
    expect(normalizeSpawnPoint(null)).toBeNull();
    expect(normalizeSpawnPoint(undefined)).toBeNull();
    expect(normalizeSpawnPoint(4)).toBeNull();
    expect(normalizeSpawnPoint('4,65,-7')).toBeNull();
    expect(normalizeSpawnPoint([4, 65, -7])).toBeNull();
  });

  it('B10: missing, fractional, non-finite or out-of-range coordinates are rejected', () => {
    expect(normalizeSpawnPoint({ x: 4, y: 65 })).toBeNull();
    expect(normalizeSpawnPoint({ x: 4, y: 65, z: -7, extra: true })).toEqual({ x: 4, y: 65, z: -7 });
    expect(normalizeSpawnPoint({ x: 4.5, y: 65, z: -7 })).toBeNull();
    expect(normalizeSpawnPoint({ x: 4, y: 65.5, z: -7 })).toBeNull();
    expect(normalizeSpawnPoint({ x: 4, y: Number.NaN, z: -7 })).toBeNull();
    expect(normalizeSpawnPoint({ x: 4, y: 65, z: Infinity })).toBeNull();
    expect(normalizeSpawnPoint({ x: 4, y: -1, z: -7 })).toBeNull();
    expect(normalizeSpawnPoint({ x: 4, y: 256, z: -7 })).toBeNull();
    expect(normalizeSpawnPoint({ x: 30_000_001, y: 65, z: 0 })).toBeNull();
    expect(normalizeSpawnPoint({ x: -30_000_001, y: 65, z: 0 })).toBeNull();
    expect(normalizeSpawnPoint({ x: 0, y: 65, z: 30_000_001 })).toBeNull();
  });

  it('B10: the boundaries themselves are legal (y 0 / 255, |x|,|z| = 30_000_000)', () => {
    expect(normalizeSpawnPoint({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
    expect(normalizeSpawnPoint({ x: 30_000_000, y: 255, z: -30_000_000 })).toEqual({
      x: 30_000_000,
      y: 255,
      z: -30_000_000,
    });
  });
});
