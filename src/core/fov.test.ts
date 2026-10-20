import { describe, it, expect } from 'vitest';
import { BASE_FOV, FOV_SMOOTH_SEC, SPRINT_FOV_RATIO, sprintFov, stepFov } from './fov';

describe('sprintFov', () => {
  it('the sprint FOV is 10 percent above the base', () => {
    expect(sprintFov()).toBeCloseTo(77, 5);
    expect(sprintFov(50)).toBeCloseTo(55, 5);
  });

  it('falls back to the base FOV for a non-finite base', () => {
    expect(sprintFov(NaN)).toBe(BASE_FOV);
    expect(sprintFov(Infinity)).toBe(BASE_FOV);
    expect(sprintFov(-Infinity)).toBe(BASE_FOV);
  });
});

describe('stepFov', () => {
  it('stepFov moves toward the target exponentially', () => {
    // 70 + 7·(1−e^{−1})：時間常數 0.1 s 走 0.1 s → 逼近約 63%
    expect(stepFov(70, 77, 0.1)).toBeCloseTo(74.424, 2);
  });

  it('stepFov ignores a non-finite or non-positive dt', () => {
    expect(stepFov(70, 77, 0)).toBe(70);
    expect(stepFov(70, 77, NaN)).toBe(70);
    expect(stepFov(70, 77, -1)).toBe(70);
    expect(stepFov(70, 77, Infinity)).toBe(70);
  });

  it('stepFov converges to the target without overshooting', () => {
    let v = 70;
    for (let i = 0; i < 60; i++) {
      v = stepFov(v, 77, 1 / 60);
      expect(v).toBeLessThanOrEqual(77);
    }
    expect(v).toBeCloseTo(77, 3);
  });

  it('stepFov returns to the base when the sprint ends', () => {
    let v = 77;
    for (let i = 0; i < 60; i++) {
      const next = stepFov(v, 70, 1 / 60);
      expect(next).toBeLessThanOrEqual(v); // 單調遞減
      v = next;
    }
    expect(v).toBeCloseTo(70, 3);
  });

  it('repairs a non-finite current or target with the base FOV', () => {
    expect(stepFov(NaN, 77, 0.1)).toBe(BASE_FOV);
    expect(stepFov(70, NaN, 0.1)).toBe(BASE_FOV);
    expect(stepFov(Infinity, 77, 0.1)).toBe(BASE_FOV);
    expect(stepFov(70, Infinity, 0.1)).toBe(BASE_FOV);
  });
});

describe('fov constants', () => {
  it('pins the base FOV, the sprint ratio and the smoothing time constant', () => {
    expect(BASE_FOV).toBe(70);
    expect(SPRINT_FOV_RATIO).toBe(0.1);
    expect(FOV_SMOOTH_SEC).toBe(0.1);
  });
});
