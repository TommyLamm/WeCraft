// Session 邊界的 UI 擁有狀態（審查 A4）——純規則（無 DOM／Three／IO）。
//
// 合成格（`craftGrid`／`craftExcess`）與背包游標是 **UI 擁有狀態**：它們活在
// 存檔 payload **之外**，所以絕對不能跨過 session 邊界（新局／繼續遊戲／
// 套用雲端／回到標題）。否則：
//   ① 舞台化的材料在「繼續遊戲」後被沖刷進**已還原的背包** → 複製；
//   ② 面板開著時的存檔沒有那些材料（舊碼刻意跳過沖刷）→ 掉料。
//
// 沖刷是**原地**做的：開著的面板在開啟時就抓住了 grid **陣列**（UI 直接寫
// cell）。若換一個新陣列，面板就抱著孤兒陣列——點它的格子會把同一件物品
// **再交一次**（複製），而之後舞台的材料只活在孤兒裡（掉料）。
import { emptyGrid } from '../core/recipes';
import type { ItemId, ItemStack } from '../core/items';

/** UI 擁有的合成狀態（兩個陣列都**原地**被清空／改寫）。 */
export interface CraftGridState {
  /** 活的合成格（長度 `size²`）；UI 持有的是**同一個**陣列。 */
  grid: Array<ItemStack | null>;
  /** 停在「哪裡都放不下」的物品（長度會變）。 */
  excess: ItemStack[];
}

export interface CraftGridFlushDeps {
  /** 把一疊物品交還背包；回傳放不下的數量（0 ＝ 全部放得下）。 */
  giveItem(item: ItemId, count: number, dur?: number): number;
  /** 「哪裡都放不下」的東西要去哪。**不傳** → 重新停在合成格的前幾格（場內
   *  的既有行為：玩家還看得到、還拿得到）。session 邊界會傳 sink（地面掉落）
   *  → 重新停放會讓那些東西**洩漏進下一場次**的背包（複製）。 */
  dropOverflow?(stack: ItemStack): void;
}

/** 清空合成格（原地），並把每一疊舞台材料交還背包。
 *
 *  - `state.grid` **原地**清空後鋪上 `size²` 個空格 → 開著的面板仍寫得到它；
 *  - `state.excess` 原地清空（停在「哪裡都放不下」的東西一起被沖刷）；
 *  - 放不下的部分：沒有 sink → 重新停在合成格前面幾格（場內行為）；有 sink
 *    → 交給 sink（session 邊界：丟到地上，不留在 UI 狀態裡）。
 *
 *  B7 R6：耐久跟著堆疊走——沖刷與重新停放都帶著 `dur`（受損工具不會被洗白）。 */
export function flushCraftGrid(
  state: CraftGridState,
  size: 2 | 3,
  deps: CraftGridFlushDeps,
): void {
  const pending: ItemStack[] = [...state.excess];
  state.excess.length = 0;
  for (const cell of state.grid) {
    if (cell && Number.isFinite(cell.count) && cell.count >= 1) pending.push({ ...cell });
  }
  // **原地**清空——UI 持有的是這個陣列本身。
  state.grid.length = 0;
  state.grid.push(...emptyGrid(size));
  let front = 0;
  for (const p of pending) {
    const overflow = deps.giveItem(p.item, p.count, p.dur);
    if (overflow <= 0) continue;
    const stack: ItemStack = {
      item: p.item,
      count: overflow,
      ...(p.dur !== undefined ? { dur: p.dur } : {}),
    };
    if (deps.dropOverflow) {
      deps.dropOverflow(stack);
    } else if (front < state.grid.length) {
      // 工具堆疊上限 1 → 溢出的工具是整把停在前面幾格，`dur` 原樣保留
      state.grid[front++] = stack;
    } else {
      state.excess.push(stack);
    }
  }
}
