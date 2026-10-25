/**
 * 世界生成版本戳記（B3 Task 7）。
 *
 * 為什麼需要這個常數：本作**從不保存區塊**，任何載入都是「從 seed 重新生成整個
 * 世界」再套用玩家改動的 overlay → 換一版生成器等於整片地形改觀（建築可能浮空、
 * 埋入或入水）。`WORLDGEN_VERSION` 就是「這份地形是哪一版生成器生成的」識別碼。
 *
 * 規則：
 * - 未來任何會改變地形外觀的批次都要把這個常數往上加。
 * - **第 2 版（B5 Task 6）**：新增礫石與礦脈深度帶（金／鑽石帶、鐵礦帶對齊
 *   原版映射）→ 地形外觀改變 → 舊存檔載入時會跳一次「地形已改變」提示。
 * - 存檔以**附加欄位** `worldgenVersion` 記錄它：有則讀、無則視為舊存檔。
 *   附加欄位對舊版程式是安全的（舊版讀到不認識的欄位會直接忽略），所以 B3
 *   當時存檔的格式版本號不必升版（當時本機 payload v3、雲端 format 1；版本
 *   號後來才由 B5／B7 各自升版）。
 * - 舊存檔**不得被自動補值**：補了就看不出是舊存檔，也永遠不會跳「地形已改變」提示。
 *
 * 這個模組是純模組：不依賴 DOM／IndexedDB／Three.js／`main.ts` 的任何狀態。
 */

/** 目前的世界生成器版本（第 2 版：B5 的礫石＋礦脈深度帶）。 */
export const WORLDGEN_VERSION = 2;

/**
 * 判斷一份存檔是否需要跳一次「地形已改變」提示。
 *
 * 語意：只有「存檔上的版本 == 目前的版本」才不需要提示；其餘全部需要——
 * - `undefined`／`null`：舊存檔（附加欄位不存在）→ 要提示。
 * - 較舊的數字：地形是用舊生成器生成的 → 要提示。
 * - 較新的數字（例如玩家用了未來的版本存檔）：保守起見也要提示。
 *
 * 參數刻意只收 `number | undefined | null`：讀取端（`loadGame`／
 * `acceptCloudData`）只會交出「合法數字」或「沒有這個鍵」兩種結果，非法型別在
 * 那兩處就被擋掉了。
 */
export function needsWorldgenNotice(saved: number | undefined | null): boolean {
  return saved !== WORLDGEN_VERSION;
}

/**
 * 讀出存檔上的 `worldgenVersion` 欄位值並正規化：**合法（有限數字）就原樣回傳**；
 * 不存在或型別不符（字串 `'x'`、`NaN`、`Infinity`、`null`…）→ 回傳 `undefined`
 *（＝「沒有這個欄位」＝舊存檔的判準）。
 *
 * 為什麼要有這個共用 helper：「什麼算合法的版本值」只有這裡定義一次，本機存檔讀取端
 * （`src/world/save.ts`）與雲端存檔驗證端（`src/core/cloud-save.ts`）共用同一支 →
 * 兩邊的規則不會各自漂移。**策略**仍然兩邊不同（那是 brief 指定的）：
 * 本機讀取端剝除該鍵後照常載入、雲端驗證端整筆拒收。
 */
export function readWorldgenVersion(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}
