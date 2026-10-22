/** 生怪光照判準（純邏輯 — no Three/DOM; `world/` 只依賴 `core/` 的時鐘）。
 *
 *  **這個模組是 B6（真的光照系統）的替換接縫**：B4 只知道「此刻是白天還是夜晚」，
 *  所以用 `clockLight(t)` 近似；B6 只要把 `clockLight(t)` 換成「真的去世界查天空光／
 *  方塊光」，`canSpawnPassive`／`canSpawnHostile` 與整條生怪排程都不用動。
 *
 *  **規則本身是原版值（wiki，2026-10-20 查證），不會因 B6 改變**：
 *  - 被動生物需要亮度 **9** 以上（原版 PassiveMob 的生成亮度門檻）；
 *  - 敵對生物需要天空光 **≤ 7** 且所在位置沒有方塊光。
 *
 *  B4 的近似（`clockLight`）：白天 `{ sky: 15, block: 0 }`、夜晚 `{ sky: 0, block: 0 }`
 *  → 被動生物只在白天生成、敵對只在夜晚生成（spec §B4.2 的簡化）。
 */

import { phaseOf } from '../core/daynight';

/** 生成點的光照（0..15）：`sky` 是天空光、`block` 是方塊光。 */
export interface SpawnLight {
  sky: number;
  block: number;
}

/** 原版：被動生物需要亮度 9 以上才能生成（wiki，2026-10-20 查證）。 */
export const PASSIVE_MIN_LIGHT = 9;
/** 原版：敵對生物需要天空光 ≤ 7（wiki，2026-10-20 查證）。 */
export const HOSTILE_MAX_SKY_LIGHT = 7;

/** 由時鐘推出的生成點光照（**B4 的近似**；B6 換成真的光照查詢）。
 *  白天給滿天空光、夜晚給 0 —— 兩種生物因此分別只在白天／夜晚生成。 */
export function clockLight(t: number): SpawnLight {
  const day = phaseOf(t) === 'day';
  return { sky: day ? 15 : 0, block: 0 };
}

/** 此刻是白天嗎（`phaseOf(t) === 'day'`）—— 白天燃燒的開關。 */
export function isDaylight(t: number): boolean {
  return phaseOf(t) === 'day';
}

/** 兩種光取較亮者（被動生物的亮度門檻看的是「實際亮度」）。 */
export function maxLight(light: SpawnLight): number {
  return Math.max(light.sky, light.block);
}

/** 被動生物能否在此生成：亮度 ≥ {@link PASSIVE_MIN_LIGHT}。 */
export function canSpawnPassive(light: SpawnLight): boolean {
  return maxLight(light) >= PASSIVE_MIN_LIGHT;
}

/** 敵對生物能否在此生成：天空光 ≤ {@link HOSTILE_MAX_SKY_LIGHT} 且沒有方塊光。 */
export function canSpawnHostile(light: SpawnLight): boolean {
  return light.sky <= HOSTILE_MAX_SKY_LIGHT && light.block === 0;
}
