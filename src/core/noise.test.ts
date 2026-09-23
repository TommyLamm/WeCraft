import { describe, it, expect } from 'vitest';
import { Noise, hash2 } from './noise';

describe('hash2', () => {
  it('is deterministic', () => {
    expect(hash2(3, 7, 42)).toBe(hash2(3, 7, 42));
  });
  it('differs by position and seed', () => {
    expect(hash2(3, 7, 42)).not.toBe(hash2(4, 7, 42));
    expect(hash2(3, 7, 42)).not.toBe(hash2(3, 7, 43));
  });
  it('returns uint32 range', () => {
    const h = hash2(-1000, 1000, 0);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('Noise', () => {
  it('same seed same values', () => {
    const a = new Noise(123);
    const b = new Noise(123);
    for (let i = 0; i < 20; i++) {
      expect(a.noise2(i * 0.37, i * 1.1)).toBe(b.noise2(i * 0.37, i * 1.1));
    }
  });

  it('different seed differs', () => {
    const a = new Noise(1);
    const b = new Noise(2);
    expect(a.noise2(0.5, 0.5)).not.toBe(b.noise2(0.5, 0.5));
  });

  it('noise2 stays in [-1, 1]', () => {
    const n = new Noise(99);
    for (let i = 0; i < 500; i++) {
      const v = n.noise2(i * 0.13 - 30, i * 0.29 - 10);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('noise3 deterministic and bounded', () => {
    const n = new Noise(7);
    const v1 = n.noise3(1.5, 2.5, 3.5);
    expect(v1).toBe(n.noise3(1.5, 2.5, 3.5));
    expect(Math.abs(v1)).toBeLessThanOrEqual(1);
  });

  it('fbm deterministic', () => {
    const n = new Noise(5);
    expect(n.fbm2(10.2, -3.4, 4)).toBe(n.fbm2(10.2, -3.4, 4));
  });
});
