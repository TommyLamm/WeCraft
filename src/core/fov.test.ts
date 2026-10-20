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

  it('approaches from above without undershooting when the current value is above the target', () => {
    // 「永不超過目標值」只在 current ≤ target 時成立：current 77 → target 70
    // （疾跑剛結束）時是**從上方**逼近 → 收斂完成前仍大於目標值，但不會低於它。
    const next = stepFov(77, 70, 0.1);
    expect(next).toBeLessThan(77); // 往目標前進
    expect(next).toBeGreaterThan(70); // 尚未收斂 → 仍高於目標值
    let v = 77;
    for (let i = 0; i < 200; i++) {
      const step = stepFov(v, 70, 1 / 60);
      expect(step).toBeLessThanOrEqual(v); // 單調遞減
      expect(step).toBeGreaterThanOrEqual(70); // 不低於目標值（不超調到另一側）
      v = step;
    }
    expect(v).toBeCloseTo(70, 3);
  });

  it('stepFov converges to the target in one step for a huge finite dt', () => {
    // 極大（但**有限**）的 dt 走指數分支：e^{−dt/τ} 在數值上溢位為 0 → 係數 1
    // → 一步直接收斂到目標（不 NaN、不超調）。
    expect(stepFov(70, 77, 1e6)).toBe(77);
    expect(stepFov(70, 77, 1e9)).toBe(77);
    expect(stepFov(70, 77, Number.MAX_VALUE)).toBe(77);
    expect(stepFov(73.5, 77, 1e6)).toBe(77);
    // 反向（77 → 70）同理
    expect(stepFov(77, 70, 1e9)).toBe(70);
    expect(stepFov(70, 77, 1e9)).toBeLessThanOrEqual(77);
    expect(Number.isFinite(stepFov(70, 77, 1e9))).toBe(true);
    // 與「dt = Infinity」**刻意不同**：Infinity 屬非有限 → 視為「本幀沒有時間
    // 流逝」，凍結在 current，不會跳到目標（見 stepFov 的 JSDoc）。
    expect(stepFov(70, 77, Infinity)).toBe(70);
  });

  it('repeated sprint toggling stays finite, stays in range, and converges to the target', () => {
    let v = 70;
    // 30 輪「疾跑開（77）→ 疾跑關（70）」；每段 60 步（1 秒 ≈ 10 個時間常數 τ）
    for (let cycle = 0; cycle < 30; cycle++) {
      for (const target of [77, 70]) {
        for (let i = 0; i < 60; i++) {
          const next = stepFov(v, target, 1 / 60);
          expect(Number.isFinite(next)).toBe(true); // 不得產生 NaN
          expect(next).toBeGreaterThanOrEqual(70); // 不低於基準 FOV
          expect(next).toBeLessThanOrEqual(77); // 不超調
          expect(Math.abs(next - v)).toBeLessThan(2); // 每步不跳變（全量來回 7 度）
          v = next;
        }
      }
    }
    expect(v).toBeCloseTo(70, 3); // 收斂回最後一個目標（70）
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
