import { describe, it, expect } from 'vitest';
import { BOW_FULL_CHARGE_SEC, BOW_ARROW_SPEED, bowShotFor, stepBowCharge } from './bow';

describe('bow', () => {
  it('B10: the constants match the design values', () => {
    expect(BOW_FULL_CHARGE_SEC).toBe(1);
    expect(BOW_ARROW_SPEED).toBe(40);
  });

  it('B10: the charge buckets match the vanilla bow table', () => {
    expect(bowShotFor(0).damage).toBe(1);
    expect(bowShotFor(0.199).damage).toBe(1);
    expect(bowShotFor(0.2).damage).toBe(5);
    expect(bowShotFor(0.899).damage).toBe(5);
    expect(bowShotFor(0.9).damage).toBe(6);
    expect(bowShotFor(0.999).damage).toBe(6);
    expect(bowShotFor(1, () => 0)).toEqual({ damage: 6, speed: 40, critical: true });
    expect(bowShotFor(1, () => 0.999999).damage).toBe(11);
    expect(bowShotFor(NaN).damage).toBe(1);
    expect(bowShotFor(-1).speed).toBe(0);
  });

  it('B10: speed scales with charge and a non-critical shot is never critical', () => {
    expect(bowShotFor(0.5).speed).toBe(20);
    expect(bowShotFor(0.5).critical).toBe(false);
    expect(bowShotFor(1.5).speed).toBe(40); // clamp01
    expect(bowShotFor(Infinity).speed).toBe(40);
    expect(bowShotFor(Infinity, () => 0).critical).toBe(true);
  });

  it('B10: stepBowCharge clamps and ignores bad dt', () => {
    expect(stepBowCharge(0, 0.25)).toBe(0.25);
    expect(stepBowCharge(0.9, 0.5)).toBe(1);
    expect(stepBowCharge(0.5, 0)).toBe(0.5);
    expect(stepBowCharge(0.5, NaN)).toBe(0.5);
    expect(stepBowCharge(0.5, Infinity)).toBe(0.5);
    expect(stepBowCharge(0.5, -0.2)).toBe(0.5);
    expect(stepBowCharge(-1, 0.25)).toBe(0.25);
    expect(stepBowCharge(2, 0.25)).toBe(1);
  });
});
