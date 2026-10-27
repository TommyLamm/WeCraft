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
    const noonSurface = { sky: 15, internalSky: 15, block: 0, lit: true };
    expect(canSpawnPassive(noonSurface)).toBe(true);
    expect(canSpawnHostile(noonSurface)).toBe(false);
  });

  it('the light rules are time-blind; the DAYTIME gate lives in the spawn attempt (A5)', () => {
    // 亮度判準本身**不看時間**：客戶端天空光不隨日夜衰減（地表恆 15）→ 夜間
    // 地表的亮度與正午相同（原版也是兩套判準：亮度一套、時間一套）。
    //
    // **A5 的修正**：這裡從前寫的是「夜間地表被動生物仍可生成（與原版一致）」
    // ——那正是被審查判為錯的行為（B4 交付的是「白天生成」）。時間那一半改由
    // 生成端 `ctx.isDaylight()` 擋下（`passive-mobs.test.ts` 的夜間案例釘住
    // 「同一片亮草地，夜晚不生成」）。這條測試現在只負責把**亮度**判準釘在
    // 「時間無關」上——兩者分離，才不會再有人把「亮」誤讀成「白天」。
    const dark = { sky: 0, internalSky: 0, block: 0, lit: true };
    expect(canSpawnPassive(dark)).toBe(false);
    expect(canSpawnHostile(dark)).toBe(true);
    const nightSurface = { sky: 15, internalSky: 4, block: 0, lit: true };
    expect(canSpawnPassive(nightSurface)).toBe(true); // 亮度夠亮——時間判準不在這裡
    expect(canSpawnHostile(nightSurface)).toBe(true); // 內部天空光衰減 → 敵對可以
  });

  it('passive mobs need light 9 or more', () => {
    expect(PASSIVE_MIN_LIGHT).toBe(9);
    expect(canSpawnPassive({ sky: 15, internalSky: 15, block: 0, lit: true })).toBe(true); // 正午地表
    expect(canSpawnPassive({ sky: 0, internalSky: 0, block: 9, lit: true })).toBe(true); // 方塊光夠亮（火把旁）
    expect(canSpawnPassive({ sky: 8, internalSky: 8, block: 0, lit: true })).toBe(false); // 半遮蔽且無方塊光（差一格）
    expect(canSpawnPassive({ sky: 0, internalSky: 0, block: 8, lit: true })).toBe(false); // 方塊光差一格
  });

  it('hostile mobs need a dark internal sky and no block light', () => {
    expect(HOSTILE_MAX_SKY_LIGHT).toBe(7);
    // 敵對判準看的是**內部**天空光（隨日夜衰減）：午夜地表 4 → 可以；正午地表
    // 15 → 不行；火把旁（方塊光 1）→ 不行。
    expect(canSpawnHostile({ sky: 15, internalSky: 4, block: 0, lit: true })).toBe(true); // 午夜地表
    expect(canSpawnHostile({ sky: 15, internalSky: 15, block: 0, lit: true })).toBe(false); // 正午地表
    expect(canSpawnHostile({ sky: 0, internalSky: 0, block: 1, lit: true })).toBe(false); // 火把旁
    // 邊界（B4 既有斷言，改用內部天空光）
    expect(canSpawnHostile({ sky: 0, internalSky: 7, block: 0, lit: true })).toBe(true);
    expect(canSpawnHostile({ sky: 0, internalSky: 8, block: 0, lit: true })).toBe(false);
  });

  it('an unlit chunk is unknown, not dark (B3)', () => {
    // 審查 B3：未點光區塊（chunk.light === null）的 sky/internalSky/block 全回
    // 0 → 舊判準把「未知」誤讀成「全黑」→ 白天生成敵對生物。`lit:false` 一律
    // 不生成（兩種生物）——未知既不是暗、也不是亮。
    expect(canSpawnHostile({ sky: 0, internalSky: 0, block: 0, lit: false })).toBe(false);
    expect(canSpawnPassive({ sky: 15, internalSky: 15, block: 0, lit: false })).toBe(false);
  });

  it('isDaylight follows the day phase', () => {
    expect(isDaylight(0.25)).toBe(true);
    expect(isDaylight(0.75)).toBe(false);
  });

  it('maxLight takes the brighter of the sky and block light', () => {
    // 被動判準的亮度只看客戶端天空光與方塊光（不含內部天空光——原版的兩套判準）
    expect(maxLight({ sky: 15, internalSky: 15, block: 0, lit: true })).toBe(15);
    expect(maxLight({ sky: 3, internalSky: 3, block: 11, lit: true })).toBe(11);
    expect(maxLight({ sky: 0, internalSky: 0, block: 0, lit: true })).toBe(0);
  });
});
