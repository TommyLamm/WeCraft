import { describe, it, expect } from 'vitest';
import {
  PASSIVE_MIN_LIGHT,
  HOSTILE_MAX_SKY_LIGHT,
  clockLight,
  isDaylight,
  maxLight,
  canSpawnPassive,
  canSpawnHostile,
} from './spawn-rules';

// ---- 生怪光照判準（B4 Task 5）--------------------------------------------
// 規則本身是原版值（被動生物需亮度 9+、敵對需天空光 ≤ 7 且無方塊光）；
// 只有 `clockLight` 是 B4 的「日光／夜晚」近似（B6 換成真的光照查詢）。

describe('spawn rules — 光照判準', () => {
  it('daylight is bright enough for passive mobs and too bright for hostiles', () => {
    const day = clockLight(0.25); // 正午
    expect(canSpawnPassive(day)).toBe(true);
    expect(canSpawnHostile(day)).toBe(false);
  });

  it('nightlight is the opposite', () => {
    const night = clockLight(0.75); // 午夜
    expect(canSpawnPassive(night)).toBe(false);
    expect(canSpawnHostile(night)).toBe(true);
  });

  it('the passive threshold is the vanilla light level 9', () => {
    expect(PASSIVE_MIN_LIGHT).toBe(9);
    expect(canSpawnPassive({ sky: 0, block: 9 })).toBe(true); // 方塊光夠亮
    expect(canSpawnPassive({ sky: 8, block: 0 })).toBe(false); // 天空光差一格
  });

  it('hostile mobs need a dark sky and no block light', () => {
    expect(HOSTILE_MAX_SKY_LIGHT).toBe(7);
    expect(canSpawnHostile({ sky: 7, block: 0 })).toBe(true);
    expect(canSpawnHostile({ sky: 8, block: 0 })).toBe(false);
    expect(canSpawnHostile({ sky: 0, block: 1 })).toBe(false);
  });

  it('isDaylight follows the day phase', () => {
    expect(isDaylight(0.25)).toBe(true);
    expect(isDaylight(0.75)).toBe(false);
  });

  it('maxLight takes the brighter of the sky and block light', () => {
    expect(maxLight({ sky: 15, block: 0 })).toBe(15);
    expect(maxLight({ sky: 3, block: 11 })).toBe(11);
    expect(maxLight({ sky: 0, block: 0 })).toBe(0);
  });
});
