// `main.ts` 的**結構性接線釘子**都集中在這一支檔案。
//
// 背景：`main.ts` 是**組裝根**（建立 renderer、綁 DOM 事件、module 層級就跑
// boot 流程）→ 在 jsdom 裡 import 會直接炸掉，沒有可測的介面。所以這支測試
// 只做**結構釘子**（沿用 Task 8 的慣例）：確認「規則接在哪裡、接線有沒有被漏掉」。
// **真正的行為驗證以瀏覽器驗收為證**（task-9-report.md 的〈人工驗收〉）。
//
// 收斂紀錄（B3 hygiene 回合）：
// - B3 Task 8 的 `src/ui/worldgen-notice.wiring.test.ts` **搬進來**：它測的從來
//   都是 `main.ts`（`?raw` 內嵌的是 `../main.ts`），放在 `src/ui/` 底下會誤導
//   讀者 → 「main.ts 的結構釘子集中在同一支檔案」。
// - 釘子比對前**先剔除註解**（`stripComments`）→ 把某個接線**註解掉**不再能
//   矇混過關（詳見 `stripComments` 的說明與同檔的自我檢查案例）。
//
// 釘子涵蓋：
// ① 出生點的「不可在水裡」保護（Task 9 Step 3 第 3 項）：水判斷、區塊內的螺旋搜尋、
//    整塊在水裡時的警告。
// ② 放置目標的 world-aware 計算（Task 9 Step 4）：目標格從世界讀、放進被點擊格本身、
//    **覆蓋植被時不放任何掉落流程**。
// ③ 危險傷害與生物群系取樣的每幀接線（Task 9 Step 3 第 2／4 項）。
// ④ 「地形已改變」提示的時機（Task 8）：套用點不跳、進場點才跳、本機條目回歸。

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
// `?raw` 由 Vite 在轉譯期內嵌成字串——不需 node 的檔案系統 API（本專案沒有
// @types/node）。
import rawMainSource from './main.ts?raw';

/** 一個 token：種類＋在原始碼裡的位置＋文字。 */
interface Token {
  kind: ts.SyntaxKind;
  start: number;
  end: number;
  text: string;
}

/** 這兩種是**註解** token（scanner 的 trivia 之一）。 */
function isComment(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.SingleLineCommentTrivia ||
    kind === ts.SyntaxKind.MultiLineCommentTrivia
  );
}

/** 空白／換行／註解——這些都不影響「程式碼」的意義。 */
function isTrivia(kind: ts.SyntaxKind): boolean {
  return (
    isComment(kind) ||
    kind === ts.SyntaxKind.WhitespaceTrivia ||
    kind === ts.SyntaxKind.NewLineTrivia ||
    kind === ts.SyntaxKind.ShebangTrivia
  );
}

/**
 * 前一個 token 結束了**一個運算式** → 這時的 `/` 是**除法**，不是 regex 的開頭
 * （regex 常值只可能出現在「運算式即將開始」的位置）。
 */
function canStartRegex(prev: ts.SyntaxKind): boolean {
  switch (prev) {
    case ts.SyntaxKind.Identifier:
    case ts.SyntaxKind.PrivateIdentifier:
    case ts.SyntaxKind.NumericLiteral:
    case ts.SyntaxKind.BigIntLiteral:
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
    case ts.SyntaxKind.RegularExpressionLiteral:
    case ts.SyntaxKind.CloseParenToken:
    case ts.SyntaxKind.CloseBracketToken:
    case ts.SyntaxKind.PlusPlusToken:
    case ts.SyntaxKind.MinusMinusToken:
      return false;
    default:
      return true;
  }
}

/**
 * 用 **TypeScript 自己的 scanner** 掃原始碼 → 拿到 token 序列（含註解）。
 *
 * **為什麼不用手寫的字串掃描器**：scanner 認得字串常數（含跳脫字元）、樣板字串
 * 與 regex 常值 → **字串裡的 `//`（例如 URL `https://…`）不會被誤判成註解**。
 * 這正是手寫掃描器最容易出錯的地方（把 URL 的後半段當成註解 → 整個檔案被砍掉）。
 *
 * **樣板字串要自己接**：scanner 只把 `` `${ `` 掃成 TemplateHead，插值結束的 `}`
 * 是**parser** 才會重新掃成 TemplateMiddle／TemplateTail → 這裡若不接，scanner
 * 會把插值後面**整段程式碼**當成樣板字串的內容（於是那段裡的註解全部找不到）。
 */
function scanTokens(source: string): Token[] {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ false,
    ts.LanguageVariant.Standard,
    source,
  );
  const tokens: Token[] = [];
  let prev: ts.SyntaxKind = ts.SyntaxKind.Unknown;
  // 是否正在樣板字串的插值區段（TemplateHead／TemplateMiddle 之後）。
  let inTemplate = false;
  let kind = scanner.scan();
  while (kind !== ts.SyntaxKind.EndOfFileToken) {
    if (kind === ts.SyntaxKind.CloseBraceToken && inTemplate) {
      // 插值結束 → 重新掃成 TemplateMiddle／TemplateTail。
      kind = scanner.reScanTemplateToken(/* isTaggedTemplate */ false);
    }
    if (kind === ts.SyntaxKind.SlashToken && canStartRegex(prev)) {
      // 可能是 regex 常值 → 用 regex 的規則重掃（否則 regex 裡的引號會讓後續
      // 掃描錯位、註解也就找錯了）。
      kind = scanner.reScanSlashToken();
    }
    if (kind === ts.SyntaxKind.TemplateHead || kind === ts.SyntaxKind.TemplateMiddle) inTemplate = true;
    else if (kind === ts.SyntaxKind.TemplateTail) inTemplate = false;
    tokens.push({
      kind,
      start: scanner.getTokenStart(),
      end: scanner.getTextPos(),
      text: scanner.getTokenText(),
    });
    if (!isTrivia(kind)) prev = kind;
    kind = scanner.scan();
  }
  return tokens;
}

/**
 * 用 **TypeScript 的 parser**（context-aware）收集註解的位置 → 當作 scanner 的
 * **交叉檢查**：parser 認得 regex／樣板字串的語境，scanner 則只看字面 → 兩者
 * 應當一致（scanner 多找到的只是 parser 的走訪沒覆蓋到的位置，不影響正確性）。
 */
function parserCommentPositions(source: string): number[] {
  const sf = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const positions = new Set<number>();
  const visit = (node: ts.Node): void => {
    const leading = ts.getLeadingCommentRanges(source, node.getFullStart());
    if (leading) for (const r of leading) positions.add(r.pos);
    const trailing = ts.getTrailingCommentRanges(source, node.getEnd());
    if (trailing) for (const r of trailing) positions.add(r.pos);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...positions].sort((a, b) => a - b);
}

/**
 * 剔除原始碼裡的**註解**（行註解 `//` 與區塊註解），其餘一字不改。
 *
 * **為什麼需要**：接線釘子是用「子串比對」確認接線還在 → 但只要有人把某個接線
 * **註解掉**，子串依然存在 → 釘子還是綠的。剔除註解之後，被註解掉的接線就會讓
 * 釘子轉紅（hygiene 回合補的就是這個洞）。
 *
 * 註解以**空白**取代（不是直接刪除）→ 「刪掉註解就把兩個 token 黏成一個」的情況
 * 不會發生（例：`return` 與 `value` 之間夾著註解，刪掉註解會黏成 `returnvalue`）；
 * 註解裡的換行保留 → 行號不亂。
 */
function stripComments(source: string): string {
  const cuts = scanTokens(source).filter((t) => isComment(t.kind));
  let out = source;
  // 由後往前取代 → 前面的位置不受影響。
  for (let i = cuts.length - 1; i >= 0; i--) {
    const c = cuts[i];
    out = out.slice(0, c.start) + c.text.replace(/[^\n]/g, ' ') + out.slice(c.end);
  }
  return out;
}

/**
 * 自我檢查：剔除註解**前後**，非 trivia 的 token 序列必須一模一樣（種類＋文字）。
 * 不一樣 → 剔除邏輯誤傷了程式碼 → 直接報錯，不讓它安靜地放行。
 */
function assertSameCode(before: string, after: string): void {
  const a = scanTokens(before).filter((t) => !isTrivia(t.kind));
  const b = scanTokens(after).filter((t) => !isTrivia(t.kind));
  const same =
    a.length === b.length && a.every((t, i) => t.kind === b[i].kind && t.text === b[i].text);
  if (!same) {
    throw new Error('剔除註解時動到了程式碼本身——請檢查 stripComments 的實作');
  }
}

/** `main.ts` 的原始碼（**含註解**）。 */
const rawMain = rawMainSource;
/** `main.ts` 的原始碼（**剔除註解**）→ 所有接線釘子都用它做子串比對。 */
const mainSource = stripComments(rawMain);

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

describe('接線釘子的工具（剔除註解）', () => {
  it('the comment stripping keeps the code tokens identical', () => {
    // 保守實作的最後一道保險：剔除註解只該動到註解本身。
    expect(() => assertSameCode(rawMain, mainSource)).not.toThrow();
  });

  it('the scanner finds every comment the TypeScript parser finds', () => {
    // 交叉檢查：parser 是 context-aware 的 → 它認得 regex／樣板字串的語境。
    // scanner 若漏掉任何一個註解（最典型的就是樣板字串插值後面接的那一整段），
    // 這裡就會紅。
    const scannerPositions = new Set(
      scanTokens(rawMain)
        .filter((t) => isComment(t.kind))
        .map((t) => t.start),
    );
    const missing = parserCommentPositions(rawMain).filter((p) => !scannerPositions.has(p));
    expect(missing).toEqual([]);
    expect(scannerPositions.size).toBeGreaterThan(0);
  });

  it('a commented-out wiring no longer satisfies the substring check', () => {
    // 這正是 hygiene 回合要補的洞：接線被「註解掉」時，釘子必須轉紅。
    const sample = [
      'function tryPlaceBlock(target: RayHit): void {',
      '  // world.getBlock(target.x, target.y, target.z)',
      '}',
    ].join('\n');
    const stripped = stripComments(sample);
    expect(stripped).not.toContain('world.getBlock(');
    expect(stripped).toContain('function tryPlaceBlock(');
  });

  it('a URL inside a string literal is not treated as a comment', () => {
    const sample = ["const u = 'https://example.com/a';", '// gone', 'const v = 1;'].join('\n');
    const stripped = stripComments(sample);
    expect(stripped).toContain("'https://example.com/a'");
    expect(stripped).not.toContain('gone');
    expect(stripped).toContain('const v = 1;');
  });

  it('a template literal with a substitution is still scanned correctly', () => {
    // 樣板字串的插值區段是 scanner 與 parser 的分歧點 → 插值後面的註解一樣要
    // 找得到（不然整段程式碼會被當成樣板字串的內容）。
    const sample = [
      'const k = (x: number, y: number, z: number): string => `${x},${y},${z}`;',
      '// gone',
      'const v = 1;',
    ].join('\n');
    const stripped = stripComments(sample);
    expect(stripped).not.toContain('gone');
    expect(stripped).toContain('const v = 1;');
    expect(stripped).toContain('`${x},${y},${z}`');
  });
});

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

// ---- B4 Task 4 審查 I-2：生物死亡 → 掉落（單一路徑，不看死因）-------------
describe('main.ts 接線（B4 Task 4 I-2：任何死因都會掉落）', () => {
  it('the shared death→drop helper is the only place the drop table is used', () => {
    const body = functionBody('spawnMobDeathDrops');
    expect(body).toContain('dropsForDeaths('); // 掉落表在 mob-drops.ts（單一真值）
    expect(body).toContain('spawnDrop('); // 這裡只負責把它變成地上的掉落物
    // 掉落表**不在 main.ts 裡被重複呼叫**（否則兩條死因路徑會各擲一次骰子）
    expect(countOf('rollMobDrops(')).toBe(0);
  });

  it('both the melee kill and the death-removal path use the shared helper', () => {
    // 近戰支（當場擊殺）→ 共用函式
    expect(countOf('spawnMobDeathDrops(dead)')).toBe(1);
    // 死亡移除支（**任何其他死因**：箭、白天燃燒…）→ 同一個共用函式
    expect(countOf('spawnMobDeathDrops(deadNow)')).toBe(1);
    // 定義 + 兩個呼叫端（沒有第三條私藏的掉落路徑）
    expect(countOf('spawnMobDeathDrops(')).toBe(3);
  });

  it('the death-removal path drops the loot before the corpse leaves the world', () => {
    // 死亡移除的那一段（本體：過濾死亡／超距的生物）必須**先**算掉落再移除
    const playing = playingBranchBody();
    const at = playing.indexOf('spawnMobDeathDrops(deadNow)');
    const filterAt = playing.indexOf('!isDead(m)');
    expect(at).toBeGreaterThan(-1);
    expect(filterAt).toBeGreaterThan(-1);
    expect(at).toBeLessThan(filterAt);
  });
});
