// B4 Task 1：新物品的圖示分支**靜態**檢查（不依賴 canvas —— jsdom 沒有 2d context，
// 真正畫出來的樣子只能靠瀏覽器驗收；這裡守的是「有沒有為每個 id 寫分支」）。
//
// 為什麼用 `?raw` 而不是 `readFileSync`：本專案沒有 @types/node（tsconfig 的
// `types: ["vite/client"]`）→ `import ... from 'node:fs'` 會讓 `tsc --noEmit` 直接紅。
// `?raw` 由 Vite 在轉譯期把原始碼內嵌成字串（與 `src/main.wiring.test.ts` 同一套做法）。

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import rawIconsSource from './icons.ts?raw';
import { ALL_ITEM_IDS, blockFromItem } from '../core/items';
import { BLOCK } from '../world/blocks';

/** `src/ui/icons.ts` 的原始碼（含註解）。 */
const ICONS_SOURCE = rawIconsSource;

/** B4 Task 1 新增的 13 個物品 id。'wool' 是方塊物品 → 圖示走方塊圖集裁切
 *  （`itemIcon` 會先問 `blockFromItem`），所以下面只有 12 個非方塊 id。 */
const B4_ITEM_IDS = [
  'raw_chicken', 'cooked_chicken',
  'raw_porkchop', 'cooked_porkchop',
  'raw_mutton', 'cooked_mutton',
  'raw_beef', 'steak',
  'leather', 'feather', 'rotten_flesh', 'bone',
] as const;

/** 沒有方塊物品形式的物品 id → 它們**必須**在 `drawItemArt` 裡各有自己的分支，
 *  否則會掉進 `default:` 的灰色 placeholder（從 items.ts 的現況算出來，不是手抄）。 */
const NON_BLOCK_ITEM_IDS = ALL_ITEM_IDS.filter((id) => blockFromItem(id) === null);

/** 在原始碼裡找到名為 `name` 的頂層函式宣告（找不到 → undefined）。 */
function findFunction(source: string, name: string): ts.FunctionDeclaration | undefined {
  const file = ts.createSourceFile('icons.ts', source, ts.ScriptTarget.Latest, true);
  const found: ts.FunctionDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found[0];
}

/** `drawItemArt()` 函式本體**內**的 switch `case '…'` 字串標籤。
 *
 *  為什麼要限定在函式範圍：`icons.ts` 日後可能再長出別的 switch（例如顏色對照表），
 *  全檔掃描會讓「別的 switch 裡有同名 case」變成**假通過**。
 *  找不到 `drawItemArt` → 直接丟錯（守門要失效成紅燈，不是靜默放行）。 */
function drawItemArtCaseLabels(source: string): string[] {
  const fn = findFunction(source, 'drawItemArt');
  if (!fn?.body) throw new Error('icons.ts 裡找不到 drawItemArt() 的本體——請更新這支守門');
  const labels: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isSwitchStatement(node)) {
      for (const clause of node.caseBlock.clauses) {
        if (ts.isCaseClause(clause) && ts.isStringLiteral(clause.expression)) {
          labels.push(clause.expression.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return labels;
}

describe('icons', () => {
  it('every B4 item id has its own icon branch', () => {
    // 用 AST 掃 `drawItemArt` 的 switch（不是字串比對）→ 這同時保證
    // 「case 標籤真的在那個 switch 裡」，不會被註解裡的字串欺騙。
    const labels = new Set(drawItemArtCaseLabels(ICONS_SOURCE));
    for (const id of B4_ITEM_IDS) {
      expect(labels.has(id), `icons.ts drawItemArt() has no case for ${id}`).toBe(true);
    }
  });

  it('no item id falls through to the grey placeholder', () => {
    // 比 B4 的 12 個更廣的守門：**所有**沒有方塊物品形式的 id 都必須有專屬分支，
    // 否則 `itemIcon` 會掉進 `default:` 的灰色方塊（批次末驗收要求「每個新 id 都有圖示」）。
    const labels = new Set(drawItemArtCaseLabels(ICONS_SOURCE));
    for (const id of NON_BLOCK_ITEM_IDS) {
      expect(labels.has(id), `icons.ts has no case for ${id}（會掉進灰色 placeholder）`).toBe(true);
    }
  });

  it('the wool item icon comes from the block atlas (a dedicated case is optional)', () => {
    // 自我一致的寫法：走圖集（`blockFromItem` 查得到方塊 → `itemIcon` 走 drawBlockIcon）
    // **或**有專屬 case，兩者皆可 → 未來有人補 wool 專屬圖示時不會無辜變紅。
    const viaAtlas = blockFromItem('wool') === BLOCK.WOOL;
    const hasDedicatedCase = drawItemArtCaseLabels(ICONS_SOURCE).includes('wool');
    expect(viaAtlas || hasDedicatedCase).toBe(true);
  });
});
