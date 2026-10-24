import { describe, it, expect } from 'vitest';
import {
  PASSIVE_MIN_LIGHT,
  HOSTILE_MAX_SKY_LIGHT,
  isDaylight,
  maxLight,
  canSpawnPassive,
  canSpawnHostile,
} from './spawn-rules';

// ---- 生怪光照判準（B4 Task 5 → B6 Task 7）----------------------------------
// 判準常數是原版值、**不變**（被動 9+、敵對內部天空光 ≤ 7 且無方塊光）；
// B4 的 `clockLight` 時鐘近似已被刪除 → 真實光照由 `src/world/lighting.ts` 的
// `spawnLightAt` 提供（`SpawnLight` 多了 `internalSky` 欄位）。這裡用**明確的
// SpawnLight 值矩陣**釘住判準本身（B4 的 clockLight 測試改寫——判準不變，
// 餵入的光照改由世界提供）。

describe('spawn rules — 光照判準', () => {
  it('daylight is bright enough for passive mobs and too bright for hostiles', () => {
    // 正午地表：客戶端天空光 15（內部天空光同為 15）、無方塊光
    const noonSurface = { sky: 15, internalSky: 15, block: 0 };
    expect(canSpawnPassive(noonSurface)).toBe(true);
    expect(canSpawnHostile(noonSurface)).toBe(false);
  });

  it('nightlight is the opposite', () => {
    // B4 的 clockLight(0.75)（{ sky: 0, block: 0 }）在 B6 對應「光照不足的位置」
    // （天空被遮蔽：洞穴／屋簷深處）→ 被動不行、敵對可以。
    const dark = { sky: 0, internalSky: 0, block: 0 };
    expect(canSpawnPassive(dark)).toBe(false);
    expect(canSpawnHostile(dark)).toBe(true);
    // 夜間地表**不是** nightlight：客戶端天空光不隨時間衰減（15）→ 被動生物仍可
    // 生成（與原版一致）；內部天空光衰減到 4 → 敵對生物也生成
    // （正午地表 internalSky 15 → 敵對不生成——這就是 internalSkyLight 的
    // 日光曲線要壓的「夜間地表 vs 正午地表」差異）。
    const nightSurface = { sky: 15, internalSky: 4, block: 0 };
    expect(canSpawnPassive(nightSurface)).toBe(true);
    expect(canSpawnHostile(nightSurface)).toBe(true);
  });

  it('passive mobs need light 9 or more', () => {
    expect(PASSIVE_MIN_LIGHT).toBe(9);
    expect(canSpawnPassive({ sky: 15, internalSky: 15, block: 0 })).toBe(true); // 正午地表
    expect(canSpawnPassive({ sky: 0, internalSky: 0, block: 9 })).toBe(true); // 方塊光夠亮（火把旁）
    expect(canSpawnPassive({ sky: 8, internalSky: 8, block: 0 })).toBe(false); // 半遮蔽且無方塊光（差一格）
    expect(canSpawnPassive({ sky: 0, internalSky: 0, block: 8 })).toBe(false); // 方塊光差一格
  });

  it('hostile mobs need a dark internal sky and no block light', () => {
    expect(HOSTILE_MAX_SKY_LIGHT).toBe(7);
    // 敵對判準看的是**內部**天空光（隨日夜衰減）：午夜地表 4 → 可以；正午地表
    // 15 → 不行；火把旁（方塊光 1）→ 不行。
    expect(canSpawnHostile({ sky: 15, internalSky: 4, block: 0 })).toBe(true); // 午夜地表
    expect(canSpawnHostile({ sky: 15, internalSky: 15, block: 0 })).toBe(false); // 正午地表
    expect(canSpawnHostile({ sky: 0, internalSky: 0, block: 1 })).toBe(false); // 火把旁
    // 邊界（B4 既有斷言，改用內部天空光）
    expect(canSpawnHostile({ sky: 0, internalSky: 7, block: 0 })).toBe(true);
    expect(canSpawnHostile({ sky: 0, internalSky: 8, block: 0 })).toBe(false);
  });

  it('isDaylight follows the day phase', () => {
    expect(isDaylight(0.25)).toBe(true);
    expect(isDaylight(0.75)).toBe(false);
  });

  it('maxLight takes the brighter of the sky and block light', () => {
    // 被動判準的亮度只看客戶端天空光與方塊光（不含內部天空光——原版的兩套判準）
    expect(maxLight({ sky: 15, internalSky: 15, block: 0 })).toBe(15);
    expect(maxLight({ sky: 3, internalSky: 3, block: 11 })).toBe(11);
    expect(maxLight({ sky: 0, internalSky: 0, block: 0 })).toBe(0);
  });
});
