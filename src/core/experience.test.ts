import { describe, expect, it } from 'vitest';
import {
  MAX_LEVEL, addExperience, createExperience, experienceProgress,
  normalizeExperience, parseXpOverride, spendLevels, xpToNext,
} from './experience';

describe('createExperience', () => {
  it('starts at level 0 with an empty bar and returns a fresh object per call', () => {
    expect(createExperience()).toEqual({ level: 0, xp: 0 });
    expect(createExperience()).not.toBe(createExperience());
  });
});

describe('experience curve', () => {
  it('matches the vanilla segments at their boundaries', () => {
    expect(xpToNext(0)).toBe(7);
    expect(xpToNext(15)).toBe(37);   // 2*15+7
    expect(xpToNext(16)).toBe(42);   // 5*16-38
    expect(xpToNext(30)).toBe(112);  // 5*30-38
    expect(xpToNext(31)).toBe(121);  // 9*31-158
    expect(xpToNext(MAX_LEVEL)).toBe(742);
  });
  it('clamps a junk level into 0..MAX_LEVEL', () => {
    expect(xpToNext(-3)).toBe(7);
    expect(xpToNext(2.9)).toBe(11);
    expect(xpToNext(1e9)).toBe(742);
  });
});

describe('addExperience', () => {
  it('carries points across a level-up into a fresh object', () => {
    expect(addExperience({ level: 0, xp: 0 }, 10)).toEqual({ level: 1, xp: 3 });
  });
  it('returns the same reference for non-positive or non-finite amounts', () => {
    const exp = { level: 2, xp: 1 };
    expect(addExperience(exp, 0)).toBe(exp);
    expect(addExperience(exp, -5)).toBe(exp);
    expect(addExperience(exp, NaN)).toBe(exp);
    expect(addExperience(exp, Infinity)).toBe(exp);
  });
  it('stops at MAX_LEVEL and discards the remainder', () => {
    expect(addExperience({ level: MAX_LEVEL - 1, xp: xpToNext(MAX_LEVEL - 1) - 1 }, 1000))
      .toEqual({ level: MAX_LEVEL, xp: 0 });
    const maxed = { level: MAX_LEVEL, xp: 0 };
    expect(addExperience(maxed, 50)).toBe(maxed);
  });
});

describe('spendLevels', () => {
  it('spends whole affordable levels and resets the bar', () => {
    expect(spendLevels({ level: 5, xp: 3 }, 2)).toEqual({ level: 3, xp: 0 });
  });
  it('rejects unaffordable or non-integer amounts with the same reference', () => {
    const exp = { level: 2, xp: 1 };
    expect(spendLevels(exp, 3)).toBe(exp);
    expect(spendLevels(exp, 0)).toBe(exp);
    expect(spendLevels(exp, 1.5)).toBe(exp);
    expect(spendLevels(exp, NaN)).toBe(exp);
  });
});

describe('experienceProgress', () => {
  it('returns a 0..1 fraction and 0 at the cap', () => {
    expect(experienceProgress({ level: 0, xp: 0 })).toBe(0);
    expect(experienceProgress({ level: 0, xp: 3.5 })).toBeCloseTo(0.5);
    expect(experienceProgress({ level: MAX_LEVEL, xp: 0 })).toBe(0);
  });
});

describe('normalizeExperience', () => {
  it('repairs junk into an integer level and in-range xp', () => {
    expect(normalizeExperience(null)).toEqual({ level: 0, xp: 0 });
    expect(normalizeExperience('x')).toEqual({ level: 0, xp: 0 });
    expect(normalizeExperience({ level: '2', xp: 3 })).toEqual({ level: 0, xp: 0 });
    expect(normalizeExperience({ level: 2.7, xp: 3.9 })).toEqual({ level: 2, xp: 3 });
    expect(normalizeExperience({ level: -5, xp: 99 })).toEqual({ level: 0, xp: 6 });
    expect(normalizeExperience({ level: 1, xp: 99 })).toEqual({ level: 1, xp: 8 });
    expect(normalizeExperience({ level: MAX_LEVEL, xp: 5 })).toEqual({ level: MAX_LEVEL, xp: 0 });
  });
});

describe('parseXpOverride', () => {
  it('parses ?xp=<non-negative integer> and rejects junk', () => {
    expect(parseXpOverride('?xp=500')).toBe(500);
    expect(parseXpOverride('?a=1&xp=0')).toBe(0);
    expect(parseXpOverride('?xp=-3')).toBeNull();
    expect(parseXpOverride('?xp=1.5')).toBeNull();
    expect(parseXpOverride('?xp=abc')).toBeNull();
    expect(parseXpOverride('')).toBeNull();
  });
});
