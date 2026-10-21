// B4 Task 1：新物品的圖示分支**靜態**檢查（不依賴 canvas —— jsdom 沒有 2d context，
// 真正畫出來的樣子只能靠瀏覽器驗收；這裡守的是「有沒有為每個新 id 寫分支」）。
//
// 為什麼用 `?raw` 而不是 `readFileSync`：本專案沒有 @types/node（tsconfig 的
// `types: ["vite/client"]`）→ `import ... from 'node:fs'` 會讓 `tsc --noEmit` 直接紅。
// `?raw` 由 Vite 在轉譯期把原始碼內嵌成字串（與 `src/main.wiring.test.ts` 同一套做法）。

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import rawIconsSource from './icons.ts?raw';

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

/** 原始碼裡所有 switch 的 `case '…'` 字串標籤（用 TS 的 parser 掃，不用手寫字串掃描）。 */
function caseLabels(source: string): string[] {
  const file = ts.createSourceFile('icons.ts', source, ts.ScriptTarget.Latest, true);
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
  visit(file);
  return labels;
}

describe('icons', () => {
  it('every B4 item id has its own icon branch', () => {
    for (const id of B4_ITEM_IDS) {
      expect(ICONS_SOURCE, `icons.ts needs a case for ${id}`).toContain(`case '${id}'`);
    }
  });

  it('the B4 ids are real case labels of the icon switch (not only mentioned in comments)', () => {
    const labels = new Set(caseLabels(ICONS_SOURCE));
    for (const id of B4_ITEM_IDS) {
      expect(labels.has(id), `icons.ts switch has no case for ${id}`).toBe(true);
    }
  });

  it('the wool item icon comes from the block atlas (no dedicated case needed)', () => {
    expect(ICONS_SOURCE).not.toContain("case 'wool'");
  });
});
