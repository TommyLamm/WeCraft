// B3 Task 9（Step 3／Step 4）：`main.ts` 裡三組接線的**結構釘子**。
//
// 背景：`main.ts` 是**組裝根**（建立 renderer、綁 DOM 事件、module 層級就跑
// boot 流程）→ 在 jsdom 裡 import 會直接炸掉，沒有可測的介面。所以這支測試
// 只做**結構釘子**（沿用 Task 8 的 `worldgen-notice.wiring.test.ts` 慣例）：
// 確認「規則接在哪裡、接線有沒有被漏掉」。
// **真正的行為驗證以瀏覽器驗收為證**（task-9-report.md 的〈人工驗收〉）。
//
// 釘子涵蓋：
// ① 出生點的「不可在水裡」保護（Step 3 第 3 項）：水判斷、區塊內的螺旋搜尋、
//    整塊在水裡時的警告。
// ② 放置目標的 world-aware 計算（Step 4）：目標格從世界讀、放進被點擊格本身、
//    **覆蓋植被時不放任何掉落流程**。
// ③ 危險傷害與生物群系取樣的每幀接線（Step 3 第 2／4 項）。

import { describe, it, expect } from 'vitest';
// `?raw` 由 Vite 在轉譯期內嵌成字串——不需 node 的檔案系統 API（本專案沒有
// @types/node）。
import mainSource from './main.ts?raw';

/** 取出 `main.ts` 裡某個頂層函式的**本體**（大括號配對；巢狀函式也正確配對）。 */
function functionBody(name: string): string {
  // 一般函式是 `function name(`；generator 是 `function* name(` → 兩種都找。
  const start = Math.max(
    ...['function ', 'function* '].map((prefix) => mainSource.indexOf(`${prefix}${name}(`)),
  );
  if (start === -1) throw new Error(`main.ts 裡找不到函式 ${name}()——請更新這支釘子`);
  // 函式本體的開頭大括號＝**後面接著換行**的那一個：回傳型別裡的物件型別
  // （`: { x: number; … }`）後面接的是內容、不是換行 → 不會誤抓。
  const open = mainSource.indexOf('{\n', start);
  if (open === -1) throw new Error(`函式 ${name}() 找不到本體的大括號`);
  return braceMatchedBody(open);
}

/** 從某個大括號開始，取出配對的大括號所包住的**本體**。 */
function braceMatchedBody(open: number): string {
  let depth = 0;
  for (let i = open; i < mainSource.length; i++) {
    const ch = mainSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return mainSource.slice(open + 1, i);
    }
  }
  throw new Error('大括號沒有配對');
}

/** `if (state === 'playing') { … }` 這個分支的**本體**（主迴圈裡的遊戲中分支）。 */
function playingBranchBody(): string {
  // 用**完整**的 `if (state === 'playing') {` 當錨點：檔案裡還有別的
  // `state === 'playing' && …` 形式的判斷（暫停、死亡檢查…），用它們當錨點會
  // 抓錯分支。
  const marker = "if (state === 'playing') {";
  const at = mainSource.indexOf(marker);
  if (at === -1) throw new Error("main.ts 裡找不到 state === 'playing' 分支——請更新這支釘子");
  return braceMatchedBody(at + marker.length - 1);
}

/** 某個字串在整個 main.ts 裡出現的次數。 */
function countOf(needle: string): number {
  let n = 0;
  let at = mainSource.indexOf(needle);
  while (at !== -1) {
    n++;
    at = mainSource.indexOf(needle, at + needle.length);
  }
  return n;
}

describe('main.ts 接線（B3 Task 9 Step 3：出生點不可在水裡）', () => {
  it('the spawn point checks the sea level before accepting the surface height', () => {
    const body = functionBody('spawnPoint');
    // 精確比對那個判斷式：只檢查「有沒有提到 SEA_LEVEL」會被死碼（`if (false)`）
    // 骗過 → 這裡釘的是**比較式本身**。
    expect(body).toContain('h0 <= SEA_LEVEL');
    expect(body).toContain('surfaceHeight(0.5, 0.5, settings.seed)');
  });

  it('the dry-column search stays inside the synchronously generated (0,0) chunk', () => {
    // 搜尋範圍硬性限制在 (0,0) 區塊（0..15）→ 出生點不會被移到「尚未生成」的
    // 區塊（那會讓玩家掉進虛空）。
    const order = functionBody('spawnColumnOrder');
    expect(order).toContain('CHUNK_SIZE - 1');
    const search = functionBody('findDrySpawnColumn');
    expect(search).toContain('SEA_LEVEL');
    expect(search).toContain('spawnColumnOrder');
  });

  it('a fully flooded chunk falls back to the original formula and warns', () => {
    const body = functionBody('spawnPoint');
    expect(body).toContain('findDrySpawnColumn');
    expect(body).toContain('console.warn');
  });
});

describe('main.ts 接線（B3 Task 9 Step 4：放置目標指向被點擊格本身）', () => {
  it('the placement target is world-aware (the hit cell is read from the world)', () => {
    const body = functionBody('tryPlaceBlock');
    expect(body).toContain('world.getBlock(');
    expect(body).toContain('resolvePlacementTarget(');
    // 舊接線是「命中格 ＋ 法線」→ 目標恆為面鄰格，cross 的放行不可達。
    expect(body).not.toMatch(/\bplaceTarget\(/);
  });

  it('overwriting vegetation spawns no drop (the plant is replaced, not harvested)', () => {
    const body = functionBody('tryPlaceBlock');
    expect(body).not.toContain('spawnBlockDrop');
    expect(body).not.toContain('dropItemFor');
  });

  it('the player-overlap rule is still applied to the resolved target', () => {
    const body = functionBody('tryPlaceBlock');
    expect(body).toContain('canPlaceAt(world, t.x, t.y, t.z, player.position)');
  });
});

describe('main.ts 接線（B3 Task 9 Step 3：危險傷害與生物群系取樣）', () => {
  it('the hazard step runs inside the playing branch, exactly once per frame', () => {
    const playing = playingBranchBody();
    expect(playing).toContain('stepHazards(');
    // import 那行是 `stepHazards,`（沒有括號）→ 呼叫點應該只有一個。
    expect(countOf('stepHazards(')).toBe(1);
  });

  it('a world reset and a new game both clear the hazard timers', () => {
    expect(functionBody('resetWorld')).toContain('hazardState = createHazardState()');
    expect(functionBody('startGame')).toContain('hazardState = createHazardState()');
  });

  it('the biome sample and the fog tint live in the playing branch', () => {
    const playing = playingBranchBody();
    expect(playing).toContain('biomeAt(');
    expect(playing).toContain('applyBiomeTint(');
  });
});
