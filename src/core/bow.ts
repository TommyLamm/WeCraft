/**
 * 弓的蓄力與傷害（B10 Task 3）。
 *
 * 數值出處：minecraft.wiki `Bow`（2026-11-01 讀 raw 全文）——
 * 拉滿 1 秒；傷害表依蓄力分桶：< 0.2 秒 → 1、0.2–0.9 秒 → 5、
 * 0.9–1 秒 → 6、滿蓄（1 秒）→ 6–11（暴擊）。原版滿蓄箭速是
 * 3 格/tick＝60 格/秒；本作沿用既有骷髏箭的 **40 格/秒**（已揭露的簡化），
 * 速度隨蓄力線性縮放。
 *
 * 純函式（無 Three／DOM）：`main.ts` 只負責把每幀 dt 餵進 `stepBowCharge`，
 * 放開時把 charge 交給 `bowShotFor`。
 */

/** 拉滿弓所需秒數（原版 20 tick）。 */
export const BOW_FULL_CHARGE_SEC = 1;

/** 滿蓄箭速（格/秒）。原版 60；本作沿用 B4 的 40（已揭露的簡化）。 */
export const BOW_ARROW_SPEED = 40;

/** 一次射擊的結果：傷害、初速、是否暴擊。 */
export interface BowShot {
  damage: number;
  speed: number;
  critical: boolean;
}

/** 把值夾到 0..1；NaN／-Infinity → 0、Infinity → 1（不讓非有限值污染速度）。 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return value === Infinity ? 1 : 0;
  return Math.min(1, Math.max(0, value));
}

/** 蓄力步進：只接受有限且 > 0 的 dt；其餘視為「這一幀沒有前進」。 */
export function stepBowCharge(charge: number, dtSec: number): number {
  const current = clamp01(charge);
  if (!Number.isFinite(dtSec) || dtSec <= 0) return current;
  return clamp01(current + dtSec);
}

/**
 * 依蓄力回傳這一次射擊的傷害／速度／暴擊。
 *
 * 分桶邊界照原版：`charge < 0.2` → 1；`< 0.9` → 5；`< 1` → 6；
 * `>= 1` → 6 + floor(rng()*6)（6–11）且 `critical: true`。
 * `rng` 可注入 → 測試可重現；省略＝`Math.random`。
 */
export function bowShotFor(charge: number, rng: () => number = Math.random): BowShot {
  const c = clamp01(charge);
  const speed = BOW_ARROW_SPEED * c;
  if (c < 0.2) return { damage: 1, speed, critical: false };
  if (c < 0.9) return { damage: 5, speed, critical: false };
  if (c < 1) return { damage: 6, speed, critical: false };
  const roll = rng();
  // rng 契約是 [0,1)；夾住是為了不讓壞 rng（1／NaN）產生 12 或 NaN 傷害。
  const bonus = Number.isFinite(roll) ? Math.min(5, Math.max(0, Math.floor(roll * 6))) : 0;
  return { damage: 6 + bonus, speed, critical: true };
}
