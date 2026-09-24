import { describe, it, expect } from 'vitest';
import {
  createClock,
  tickClock,
  phaseOf,
  sunDirection,
  skyColors,
  lerpColor,
  DEFAULT_DAY_LENGTH_SEC,
} from './daynight';

/** Per-channel extraction for hex assertions. */
const red = (hex: number) => (hex >>> 16) & 0xff;

describe('clock (createClock/tickClock)', () => {
  it('starts at t = 0.25 (morning) with the default day length', () => {
    const c = createClock();
    expect(c.t).toBe(0.25);
    expect(c.dayLengthSec).toBe(DEFAULT_DAY_LENGTH_SEC);
    expect(DEFAULT_DAY_LENGTH_SEC).toBe(600);
  });

  it('accepts a custom day length', () => {
    expect(createClock(120).dayLengthSec).toBe(120);
  });

  it('falls back to the default for non-positive or non-finite day lengths', () => {
    expect(createClock(0).dayLengthSec).toBe(DEFAULT_DAY_LENGTH_SEC);
    expect(createClock(-5).dayLengthSec).toBe(DEFAULT_DAY_LENGTH_SEC);
    expect(createClock(NaN).dayLengthSec).toBe(DEFAULT_DAY_LENGTH_SEC);
    expect(createClock(Infinity).dayLengthSec).toBe(DEFAULT_DAY_LENGTH_SEC);
  });

  it('clamps out-of-range day lengths to [60, 3600]', () => {
    expect(createClock(0.001).dayLengthSec).toBe(60);
    expect(createClock(60).dayLengthSec).toBe(60);
    expect(createClock(100000).dayLengthSec).toBe(3600);
    expect(createClock(3600).dayLengthSec).toBe(3600);
  });

  it('advances t by dt / dayLengthSec (pure — returns a new clock)', () => {
    const c = createClock(DEFAULT_DAY_LENGTH_SEC);
    const next = tickClock(c, 30); // 30 / 600 = 0.05
    expect(next.t).toBeCloseTo(0.3, 10);
    expect(next).not.toBe(c);
    expect(c.t).toBe(0.25); // input never mutated
  });

  it('wraps at 1.0 back to 0', () => {
    const c = { t: 0.75, dayLengthSec: DEFAULT_DAY_LENGTH_SEC };
    expect(tickClock(c, 150).t).toBe(0); // 0.75 + 0.25 = 1 → 0
  });

  it('handles overshoot beyond one full day', () => {
    const c = { t: 0.9, dayLengthSec: DEFAULT_DAY_LENGTH_SEC };
    expect(tickClock(c, 600).t).toBeCloseTo(0.9, 10); // +1 full day → back to 0.9
    expect(tickClock(c, 1500).t).toBeCloseTo(0.4, 10); // +2.5 days → 0.9 + 0.5
  });

  it('non-finite or negative dt is a no-op copy', () => {
    const c = createClock(DEFAULT_DAY_LENGTH_SEC);
    for (const dt of [NaN, Infinity, -5, -0.0001]) {
      const next = tickClock(c, dt);
      expect(next.t).toBe(0.25);
      expect(next).toEqual(c);
      expect(next).not.toBe(c);
    }
  });
});

describe('phaseOf', () => {
  it('t ∈ [0, 0.5) is day, [0.5, 1) is night', () => {
    expect(phaseOf(0)).toBe('day');
    expect(phaseOf(0.25)).toBe('day'); // noon
    expect(phaseOf(0.4999)).toBe('day');
    expect(phaseOf(0.5)).toBe('night'); // dusk boundary
    expect(phaseOf(0.75)).toBe('night'); // midnight
    expect(phaseOf(0.9999)).toBe('night');
  });
});

describe('sunDirection', () => {
  it('points straight up at noon (t=0.25)', () => {
    const d = sunDirection(0.25);
    expect(d.x).toBe(0);
    expect(d.y).toBeCloseTo(1, 10);
  });

  it('points straight down at midnight (t=0.75)', () => {
    const d = sunDirection(0.75);
    expect(d.x).toBe(0);
    expect(d.y).toBeCloseTo(-1, 10);
  });

  it('is at the horizon at dawn and dusk (t=0 / t=0.5)', () => {
    expect(sunDirection(0).y).toBeCloseTo(0, 10);
    expect(sunDirection(0.5).y).toBeCloseTo(0, 10);
  });

  it('returns a normalized vector across the whole cycle', () => {
    for (let i = 0; i < 20; i++) {
      const t = i / 20;
      const d = sunDirection(t);
      const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
      expect(len).toBeCloseTo(1, 10);
    }
  });
});

describe('skyColors', () => {
  it('noon (t=0.25): full day sky, bright sun, no orange', () => {
    const c = skyColors(0.25);
    expect(c.sky).toBe(0x87ceeb);
    expect(c.fog).toBe(c.sky);
    expect(c.ambient).toBeCloseTo(0.75, 5);
    expect(c.sunIntensity).toBeCloseTo(0.9, 5);
  });

  it('midnight (t=0.75): full night sky, dim sun, low ambient', () => {
    const c = skyColors(0.75);
    expect(c.sky).toBe(0x0a0e1a);
    expect(c.fog).toBe(c.sky);
    expect(c.ambient).toBeCloseTo(0.25, 5);
    expect(c.sunIntensity).toBeCloseTo(0.12, 5);
  });

  it('stays plain day across the daylight band, plain night across midnight', () => {
    for (const t of [0.1, 0.25, 0.4]) expect(skyColors(t).sky).toBe(0x87ceeb);
    for (const t of [0.6, 0.75, 0.9]) expect(skyColors(t).sky).toBe(0x0a0e1a);
  });

  it('dawn (t=0) and dusk (t=0.5) blend through golden #ff9a5c', () => {
    // dayF ≈ 0.5 base (0x496e83) blended 85% toward 0xff9a5c → exact pin
    expect(skyColors(0).sky).toBe(0xe49362);
    expect(skyColors(0.5).sky).toBe(0xe49362);
  });

  it('golden window still tints the sky at ±0.03', () => {
    // pre-dawn/twilight tint beats the untinted baseline either side of it
    expect(red(skyColors(0.03).sky)).toBeGreaterThan(red(0x87ceeb)); // warmer than plain day
    expect(red(skyColors(0.97).sky)).toBeGreaterThan(red(0x0a0e1a)); // warmer than plain night
  });

  it('intensities lerp smoothly through the horizon (t=0.5)', () => {
    const noon = skyColors(0.25);
    const midnight = skyColors(0.75);
    const horizon = skyColors(0.5);
    expect(horizon.ambient).toBeCloseTo((0.25 + 0.75) / 2, 5); // 0.5
    expect(horizon.sunIntensity).toBeCloseTo((0.12 + 0.9) / 2, 5); // 0.51
    expect(horizon.ambient).toBeGreaterThan(midnight.ambient);
    expect(horizon.ambient).toBeLessThan(noon.ambient);
    // horizon sky differs from both endpoints (transition exists)
    expect(horizon.sky).not.toBe(noon.sky);
    expect(horizon.sky).not.toBe(midnight.sky);
  });

  it('fog always tracks sky and every value is finite across the cycle', () => {
    for (let i = 0; i < 10; i++) {
      const c = skyColors(i / 10);
      expect(c.fog).toBe(c.sky);
      expect(Number.isFinite(c.sky)).toBe(true);
      expect(Number.isFinite(c.ambient)).toBe(true);
      expect(Number.isFinite(c.sunIntensity)).toBe(true);
    }
  });
});

describe('lerpColor', () => {
  it('interpolates per channel with rounding', () => {
    expect(lerpColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(lerpColor(0xff0000, 0x0000ff, 0.5)).toBe(0x800080);
    expect(lerpColor(0x87ceeb, 0x0a0e1a, 0.5)).toBe(0x496e83);
  });

  it('endpoints are exact; f is clamped; NaN f falls back to a', () => {
    expect(lerpColor(0x87ceeb, 0x0a0e1a, 0)).toBe(0x87ceeb);
    expect(lerpColor(0x87ceeb, 0x0a0e1a, 1)).toBe(0x0a0e1a);
    expect(lerpColor(0x87ceeb, 0x0a0e1a, -1)).toBe(0x87ceeb);
    expect(lerpColor(0x87ceeb, 0x0a0e1a, 4)).toBe(0x0a0e1a);
    expect(lerpColor(0x87ceeb, 0x0a0e1a, NaN)).toBe(0x87ceeb);
  });
});
