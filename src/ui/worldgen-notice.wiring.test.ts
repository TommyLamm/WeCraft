// B3 Task 8（審查 I-1 修正後）：`main.ts` 裡「地形已改變」提示的**接線**釘死。
//
// 背景：審查抓到「雲端條目的提示時機錯了」——`applyCloudData` 在**開機時**（早於
// 標題畫面 render）就直接 push toast → toast 疊在標題畫面上、4 秒後消失，玩家
// 進遊戲後可能永遠看不到。修正後：**套用**（applyCloudData）只排隊，
// **進場**（continueFromCloud）才跳。
//
// 為什麼用「掃原始碼」而不是單元測試：`main.ts` 是**組裝根**（建立 renderer、
// 綁 DOM 事件、module 層級就跑 boot 流程）→ 在 jsdom 裡 import 會直接炸掉，
// 沒有可測的介面。所以這支測試只做**結構釘子**：確認「push 發生在進場點、
// 沒有發生在套用點」。真正的行為驗證以瀏覽器驗收為證（task-8-report.md）。

import { describe, it, expect } from 'vitest';
// `?raw` 由 Vite 在轉譯期內嵌成字串——不需 node 的檔案系統 API（本專案沒有
// @types/node）。
import mainSource from '../main.ts?raw';

/** 取出 `main.ts` 裡某個頂層函式的**本體**（大括號配對；巢狀函式也正確配對）。 */
function functionBody(name: string): string {
  const start = mainSource.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`main.ts 裡找不到函式 ${name}()——請更新這支釘子`);
  const open = mainSource.indexOf('{', start);
  if (open === -1) throw new Error(`函式 ${name}() 找不到大括號`);
  let depth = 0;
  for (let i = open; i < mainSource.length; i++) {
    const ch = mainSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return mainSource.slice(open + 1, i);
    }
  }
  throw new Error(`函式 ${name}() 的大括號沒有配對`);
}

describe('main.ts 接線（B3 Task 8 的提示時機）', () => {
  it('the cloud apply path does not push the notice (the title screen must stay clean)', () => {
    // applyCloudData 在開機時就跑（早於 setState('title')）→ 這裡 push 的話，
    // toast 會疊在標題畫面上、4 秒後消失，玩家進遊戲後可能永遠看不到。
    const body = functionBody('applyCloudData');
    expect(body).not.toContain('pushWorldgenNotice(');
    // 但它必須「排隊」：舊的雲端進度要記下來，等玩家進場時再說。
    expect(body).toContain('armWorldgenNotice(');
  });

  it('the cloud entry path pushes the notice (the moment the player enters)', () => {
    const body = functionBody('continueFromCloud');
    expect(body).toContain('flushWorldgenNotice(');
  });

  it('the mid-session cloud apply path pushes the notice (the player is in-game)', () => {
    const body = functionBody('resolveCloudConflict');
    expect(body).toContain('flushWorldgenNotice(');
  });

  it('the local continue path still notifies and stamps the save', () => {
    const body = functionBody('continueGame');
    expect(body).toContain('pushWorldgenNotice('); // 舊存檔 → 進場時跳一次
    expect(body).toContain('saveGame('); // 且立刻把新版本寫回（一次性）
    expect(body).toContain('worldgenVersion: WORLDGEN_VERSION');
  });

  it('a new game never notifies (there is no old terrain)', () => {
    const body = functionBody('startGame');
    expect(body).not.toContain('pushWorldgenNotice(');
    expect(body).not.toContain('flushWorldgenNotice(');
  });
});
