/** 生怪光照判準（純邏輯 — no Three/DOM; `world/` 只依賴 `core/` 的時鐘）。
 *
 *  **B6 起：餵進來的是「真的 per-block 光照」**——由 `src/world/lighting.ts` 的
 *  `spawnLightAt(world, x, y, z, t)` 從區塊光照換算出三個值（客戶端天空光／
 *  內部天空光／方塊光）；B4 的 `clockLight(t)` 時鐘近似已刪除。判準常數本身
 *  不變——這個模組本來就是 B6 的替換接縫（B4 計畫明示）。
 *
 *  **規則是原版值（wiki，2026-10-20 查證），不因 B6 改變**：
 *  - 被動生物需要亮度 **9** 以上（亮度 = max(客戶端天空光, 方塊光)——客戶端
 *    天空光不隨日夜衰減 → 夜間地表仍可生成，與原版一致）；
 *  - 敵對生物需要**內部**天空光 ≤ 7 且所在位置沒有方塊光（wiki：敵對生成看的
 *    是 internal sky light——正午地表 15 → 不生成；午夜地表 4 → 生成；洞穴恆 0
 *    → 任何時刻都可以，這也是火把能守住夜間地表的原因）。
 */

import { phaseOf } from '../core/daynight';

/** 生成點的光照（0..15）：`sky` 是客戶端天空光（時間無關；MC: sky light is not
 *  reduced at night）、`internalSky` 是內部天空光（隨日夜衰減；MC: internal sky
 *  light）、`block` 是方塊光。由 `lighting.spawnLightAt` 提供。
 *
 *  **`lit`（B3）**：這一格的區塊**有沒有光照資料**。未點光／區塊缺席時三個
 *  數值全回 0——但「未知」不等於「暗」：舊碼讓未點光的區塊看起來全黑 →
 *  白天在剛載入的區塊生成敵對生物（審查 B3）。`lit:false` 一律不生成。 */
export interface SpawnLight {
  sky: number;
  internalSky: number;
  block: number;
  /** 區塊有光照資料（`chunk.light !== null`）。false ＝ 未知，不是暗。 */
  lit: boolean;
}

/** 原版：被動生物需要亮度 9 以上才能生成（wiki，2026-10-20 查證）。 */
export const PASSIVE_MIN_LIGHT = 9;
/** 原版：敵對生物需要內部天空光 ≤ 7（wiki，2026-10-20 查證）。 */
export const HOSTILE_MAX_SKY_LIGHT = 7;

/** 此刻是白天嗎（`phaseOf(t) === 'day'`）—— 白天燃燒的開關。 */
export function isDaylight(t: number): boolean {
  return phaseOf(t) === 'day';
}

/** 兩種光取較亮者（被動生物的亮度門檻看的是「實際亮度」＝客戶端天空光與
 *  方塊光；**不含**內部天空光——被動與敵對是原版的兩套判準）。 */
export function maxLight(light: SpawnLight): number {
  return Math.max(light.sky, light.block);
}

/** 被動生物能否在此生成：亮度 ≥ {@link PASSIVE_MIN_LIGHT}。
 *  B3：未點光區塊（`lit:false`）＝未知 → 不生成（不是「夠亮」）。 */
export function canSpawnPassive(light: SpawnLight): boolean {
  if (!light.lit) return false;
  return maxLight(light) >= PASSIVE_MIN_LIGHT;
}

/** 敵對生物能否在此生成：內部天空光 ≤ {@link HOSTILE_MAX_SKY_LIGHT} 且沒有方塊光。
 *  B3：未點光區塊（`lit:false`）＝未知 → 不生成（未知不是「全黑」）。 */
export function canSpawnHostile(light: SpawnLight): boolean {
  if (!light.lit) return false;
  return light.internalSky <= HOSTILE_MAX_SKY_LIGHT && light.block === 0;
}
