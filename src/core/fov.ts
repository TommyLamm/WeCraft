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
 *  **防 NaN 汙染相機**：**輸入**非有限時一律自癒——`current`／`target` 非有限
 *  → 回 `BASE_FOV`（70）；`dt` 非有限或 ≤ 0 → 視為「這一步不動」，回傳
 *  `current`。檢查順序刻意是「先擋 current／target、再擋 dt」：若先擋 dt，
 *  `stepFov(NaN, 77, 0)` 會把 NaN 原樣回傳，等於讓壞值進相機。
 *  **守衛只擋「輸入」，不保證「輸出」有限**：極端有限輸入仍可能溢位成
 *  `Infinity`——例如 `stepFov(-1e308, 1e308, 0.1)`（`target − current` 溢位）
 *  或 `sprintFov(Number.MAX_VALUE)`（`base × 1.1` 溢位）。相機 FOV ≈ 70，
 *  實務上不會發生；Task 9 的相機值皆來自本模組的正常範圍。
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
 *  - 否則：`current + (target − current)·(1 − e^{−dt/τ})`，單調逼近且不超調。
 *
 *  **`dt` 非有限 vs. 極大有限 `dt`（刻意不同，勿誤讀為筆誤）**：
 *  - `dt = Infinity`（或 NaN）屬「非有限」→ 視為**本幀沒有時間流逝**，回傳
 *    `current`（**凍結**在原值，不會跳到目標）。
 *  - 「極大但有限」的 `dt`（如 1e6、1e9）→ 走指數分支：`e^{−dt/τ}` 在數值上
 *    溢位為 0 → 係數 `1 − 0 = 1` → **一步直接收斂到 `target`**。
 *  - 兩者都是「極大 dt」卻走不同分支是刻意的：非有限 dt 視為「時間沒有流逝」
 *    （含 NaN 這個壞值），有限 dt 視為「時間流逝很多」。實務上 dt 來自真時鐘，
 *    不會是 Infinity。 */
export function stepFov(current: number, target: number, dt: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target)) return BASE_FOV;
  if (!Number.isFinite(dt) || dt <= 0) return current;
  return current + (target - current) * (1 - Math.exp(-dt / FOV_SMOOTH_SEC));
}
