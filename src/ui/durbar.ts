// 耐久條（B7 Task 6）：熱鍵欄、背包面板與合成的來源列共用同一支 helper。
//
// 依據（Minecraft Wiki：Durability → "Durability bar"）：
//   - 受損的工具／武器在格子裡顯示一條細橫條，寬度＝剩餘占比；
//   - 滿耐久（未使用過）的物品不顯示（"Unused items do not display a
//     durability bar"）→ `ratio >= 1` 不掛條；
//   - 非耐久物品沒有這一條。
// 原版的顏色是連續的 HSV 漸層（綠→黃→紅）；本作簡化成四段門檻
// （見 `durabilityColor`）——與 B7 其他規則一樣，以「可測、可預期」優先。
import type { ItemStack } from '../core/items';
import { currentDurability, isDurableItem, maxDurability } from '../core/durability';

/** 四段門檻的色碼（邊界值屬於較低的一階，見 `durabilityColor`）。 */
export const DURABILITY_COLORS = {
  green: '#00ff00',
  yellow: '#ffff00',
  orange: '#ff8000',
  red: '#ff0000',
} as const;

/** 耐久條的比例（剩餘／上限）；非耐久物品 → 0。
 *  `currentDurability` 已把缺漏／越界的 `dur` 正規化進 0..max，所以這裡
 *  不必再夾一次。 */
export function durabilityRatio(stack: ItemStack | null): number {
  if (!stack || !isDurableItem(stack.item)) return 0;
  return currentDurability(stack) / maxDurability(stack.item);
}

/** 顏色門檻（見〈已查證與設計決策〉§5）：>0.5 綠／>0.25 黃／>0.1 橘／其餘紅。
 *  邊界值屬於較低的一階（0.5 → 黃、0.25 → 橘、0.1 → 紅）。 */
export function durabilityColor(ratio: number): string {
  if (!Number.isFinite(ratio)) return DURABILITY_COLORS.red;
  if (ratio > 0.5) return DURABILITY_COLORS.green;
  if (ratio > 0.25) return DURABILITY_COLORS.yellow;
  if (ratio > 0.1) return DURABILITY_COLORS.orange;
  return DURABILITY_COLORS.red;
}

/** 在格子裡掛／卸載耐久條（滿耐久的工具不顯示 —— 原版「Unused items do not
 *  display a durability bar」）。
 *
 *  DOM 合約：
 *  `<div class="ui-dur"><span class="ui-dur-fill" style="width: N%;
 *  background-color: <色碼>" data-dur-color="<色碼>"></span></div>`
 *  （`N = Math.round(ratio * 100)`；顏色另存一份在 `data-dur-color` 供測試讀取
 *  ——jsdom 的 CSSOM 會把 `style.background` 正規化成 `rgb(...)`，值不穩定）。
 *
 *  冪等：每次都先移除既有的 `.ui-dur`，所以重複掛載不會疊出多條，重掛
 *  滿耐久／空格／非耐久物品時也會把舊條卸掉。 */
export function mountDurabilityBar(slot: HTMLElement, stack: ItemStack | null): void {
  slot.querySelector('.ui-dur')?.remove(); // 先清掉舊的（冪等）
  if (!stack || !isDurableItem(stack.item)) return; // 非耐久物品 → 沒有條
  const ratio = durabilityRatio(stack);
  if (ratio >= 1) return; // 滿耐久＝未使用過 → 不顯示（原版行為）
  const track = document.createElement('div');
  track.className = 'ui-dur';
  const fill = document.createElement('span');
  fill.className = 'ui-dur-fill';
  fill.style.width = `${Math.round(ratio * 100)}%`;
  const color = durabilityColor(ratio);
  fill.style.backgroundColor = color;
  fill.dataset.durColor = color; // 測試與除錯用（不依賴 CSSOM 的顏色正規化）
  track.appendChild(fill);
  slot.appendChild(track);
}
