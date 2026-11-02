/**
 * 床的重生點（B10 Task 6）：型別與不可信資料的清洗。
 *
 * 存檔／雲端都是不可信輸入 → `normalizeSpawnPoint` 是唯一的清洗入口：
 * 只收「有限整數座標」的物件（`y` 在世界高度內、`x`／`z` 在合理範圍內），
 * 其餘（缺欄位、小數、NaN／Infinity、`null`…）一律回 `null`。
 */

/** 床的重生點：**方塊座標**（整數；床頂由 `bedSpawnPosition` 轉換）。 */
export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
}

/** 世界高度（y ∈ [0, 255]）與水平座標的合理上限。 */
const MAX_Y = 255;
const MAX_HORIZONTAL = 30_000_000;

/**
 * 清洗一個不可信的重生點：合法 → **新物件**（絕不 alias 輸入）；其餘 → `null`。
 * 「沒有重生點」在存檔裡就是 `null`（與 B3／B4 的附加欄位同一套慣例）。
 */
export function normalizeSpawnPoint(x: unknown): SpawnPoint | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return null;
  const p = x as { x?: unknown; y?: unknown; z?: unknown };
  if (!Number.isInteger(p.x) || !Number.isInteger(p.y) || !Number.isInteger(p.z)) return null;
  const px = p.x as number;
  const py = p.y as number;
  const pz = p.z as number;
  if (py < 0 || py > MAX_Y) return null;
  if (Math.abs(px) > MAX_HORIZONTAL || Math.abs(pz) > MAX_HORIZONTAL) return null;
  return { x: px, y: py, z: pz };
}
