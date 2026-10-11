import { describe, it, expect } from 'vitest';
import {
  bobCurve,
  startSwing,
  stepSwing,
  swingCurve,
  viewmodelItem,
  type Swing,
} from './viewmodel';
import type { ItemId } from './items';
import { BLOCK } from '../world/blocks';

describe('viewmodelItem', () => {
  it('maps a block item to its block id (grass → block 3)', () => {
    expect(viewmodelItem('grass')).toEqual({ kind: 'block', blockId: BLOCK.GRASS });
    expect(viewmodelItem('grass')).toEqual({ kind: 'block', blockId: 3 });
  });

  it('maps a non-block item to an icon (stick)', () => {
    expect(viewmodelItem('stick')).toEqual({ kind: 'icon', item: 'stick' });
    expect(viewmodelItem('stone_pickaxe')).toEqual({ kind: 'icon', item: 'stone_pickaxe' });
  });

  it('maps an empty slot (null) to none', () => {
    expect(viewmodelItem(null)).toEqual({ kind: 'none' });
  });

  it('an id with no block form falls back to an icon (water is block-only)', () => {
    // 'water' is deliberately absent from ItemId (block-only world block, never
    // held) and the cast pins the defensive fallback: anything blockFromItem
    // misses — non-block items AND unknown ids — gets the icon path, never a
    // bogus block cube.
    expect(viewmodelItem('water' as ItemId)).toEqual({ kind: 'icon', item: 'water' });
  });
});

describe('swing', () => {
  it('startSwing → {t:0, active:true}; stepSwing advances over 0.25 s and stops at t=1', () => {
    let s: Swing = { t: 0.4, active: false };
    s = startSwing(s);
    expect(s).toEqual({ t: 0, active: true });

    s = stepSwing(s, 0.125); // half of one 0.25 s swing
    expect(s.t).toBeCloseTo(0.5);
    expect(s.active).toBe(true);

    s = stepSwing(s, 0.125); // t would reach exactly 1 → finished
    expect(s).toEqual({ t: 1, active: false });

    // overshoot clamps to the finished pose instead of running past it
    s = stepSwing(startSwing(s), 10);
    expect(s).toEqual({ t: 1, active: false });
  });

  it('stepSwing with NaN dt leaves the state unchanged', () => {
    const before: Swing = { t: 0.3, active: true };
    expect(stepSwing(before, NaN)).toBe(before);
  });
});

describe('curves', () => {
  it('swingCurve is 0 at both endpoints and peaks (−1.4 rotX) mid-swing', () => {
    const start = swingCurve(0);
    const end = swingCurve(1);
    for (const v of [start.rotX, start.posY, start.posZ, end.rotX, end.posY, end.posZ]) {
      expect(v).toBeCloseTo(0); // ±0 both read as "no offset"
    }
    const mid = swingCurve(0.5);
    expect(mid.rotX).toBeCloseTo(-1.4);
    expect(mid.posY).toBeCloseTo(-0.15);
    expect(mid.posZ).toBeCloseTo(-0.25);
    // u = clamp01(t): out-of-range t pins the endpoints
    expect(swingCurve(-1)).toEqual(swingCurve(0));
    expect(swingCurve(2)).toEqual(swingCurve(1));
  });

  it('bobCurve stays inside its amplitude envelope and hits the formulas', () => {
    for (let phase = -Math.PI; phase <= Math.PI * 4; phase += 0.13) {
      const b = bobCurve(phase);
      expect(Math.abs(b.posY)).toBeLessThanOrEqual(0.02 + 1e-12);
      expect(Math.abs(b.posX)).toBeLessThanOrEqual(0.015 + 1e-12);
      expect(Math.abs(b.rotZ)).toBeLessThanOrEqual(0.03 + 1e-12);
    }
    // spot check at phase = π: sin(π)=0, sin(π/2)=1, sin(π)=0
    const atPi = bobCurve(Math.PI);
    expect(atPi.posY).toBeCloseTo(0);
    expect(atPi.posX).toBeCloseTo(0.015);
    expect(atPi.rotZ).toBeCloseTo(0);
  });
});
