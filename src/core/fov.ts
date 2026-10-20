/** 疾跑 FOV 加成與指數平滑（B2.1）——純邏輯，不 import Three、不碰 DOM。
 *
 *  **本模組只算數值**：相機 FOV 的套用與 `updateProjectionMatrix()` 由
 *  `src/main.ts`（Task 9）負責；這裡只提供「目標值」與「下一幀的 FOV」。
 *
 *  **+10% 是簡化值，不是原版數值**（計畫〈已查證與簡化決策〉§3）：
 *  - 已查證（minecraft.wiki/Sprinting，2026-10-20）：「While sprinting, the
 *    player's field of view **expands slightly**.」——只說「稍微擴大」，未給數值。
 *  - 已查證（minecraft.wiki/Options，2026-10-20）：「the FOV value represents
 *    how many degrees of vertical vision the player gets **without modifying
 *    effects such as sprinting**, flying or status effects.」——證實存在
 *    「疾跑 FOV 效果」，但 wiki 未列數值；`minecraft.wiki/FOV_Effects` 頁 404
 *    （不存在，2026-10-20）。
 *  - → 本批採**固定 +10%**（基準 70 → 疾跑 77）：原版為動態計算，本作是簡化，
 *    README 的〈與原版的差異〉需一併記錄。**勿把 0.10 當成原版常數引用。**
 *
 *  **平滑**：以時間常數 `FOV_SMOOTH_SEC`（0.1 s）的指數逼近
 *  `current + (target − current)·(1 − e^{−dt/τ})`，避免疾跑啟停瞬間的視野跳動。
 *  該式恆等於「以 τ 為時間常數的一階低通」，與幀率無關（dt 越大一步跨得越多，
 *  但收斂路徑不變），且**永不超過目標值**（不回彈、不超調）。
 *
 *  **防 NaN 汙染相機**：所有函式都保證回傳**有限數**。`current`／`target` 非有限
 *  → 回 `BASE_FOV`（70）自癒；`dt` 非有限或 ≤ 0 → 視為「這一步不動」，回傳
 *  `current`。檢查順序刻意是「先擋 current／target、再擋 dt」：若先擋 dt，
 *  `stepFov(NaN, 77, 0)` 會把 NaN 原樣回傳，等於讓壞值進相機。
 *
 *  純度：本模組回傳數字，不修改任何入參，也不持有狀態。 */

/** 基準 FOV（度）。對應 `src/render/scene.ts` 的 `new THREE.PerspectiveCamera(70, ...)`。 */
export const BASE_FOV = 70;

/** 疾跑時的 FOV 加成比例（+10%）。**簡化值**，非原版數值——見檔頭註解。 */
export const SPRINT_FOV_RATIO = 0.10;

/** 指數平滑的時間常數 τ（秒）。τ 越小越快貼近目標值。 */
export const FOV_SMOOTH_SEC = 0.1;

/** 疾跑時的目標 FOV：基準值乘上 `1 + SPRINT_FOV_RATIO`（70 → 77）。
 *
 *  `base` 非有限（NaN／±∞）→ 回 `BASE_FOV`（70），避免把壞值帶進相機。
 *  （基準 FOV 來自相機，正常情況必為正數；本函式**不額外擋負值**。） */
export function sprintFov(base: number = BASE_FOV): number {
  if (!Number.isFinite(base)) return BASE_FOV;
  return base * (1 + SPRINT_FOV_RATIO);
}

/** 下一幀的 FOV：以時間常數 `FOV_SMOOTH_SEC` 的指數逼近 `target`。
 *
 *  - `current`／`target` 非有限 → 回 `BASE_FOV`（防 NaN 汙染相機）。
 *  - `dt` 非有限或 ≤ 0 → 回 `current`（這一步不動； dt 為 0 時不該跳動）。
 *  - 否則：`current + (target − current)·(1 − e^{−dt/τ})`，單調逼近且不超調。 */
export function stepFov(current: number, target: number, dt: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target)) return BASE_FOV;
  if (!Number.isFinite(dt) || dt <= 0) return current;
  return current + (target - current) * (1 - Math.exp(-dt / FOV_SMOOTH_SEC));
}
