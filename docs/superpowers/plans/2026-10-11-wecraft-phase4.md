# WeCraft Phase 4（雲端存檔 + 生存深度）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 0.3.0：Playroom 帳號雲端進度（loadProgress/saveProgress，schemaVersion 2 + cloudSave 宣告）與生存循環補完（熔爐冶煉、鐵工具、蘋果進食、3 條新進度），另含平台執行限制稽核（resize/Esc/iframe）與完整發布驗證。

**Architecture:** 延續紅線——`world/`、`player/`、`core/` 不碰 Three/DOM（`player/input.ts` 既有例外）；Three.js 只在 `render/` 與 `main.ts`；`ui/` 不 import bus（main 以 callback 注入）。新增 `platform/` 模組（Playroom SDK 轉接，與 `audio/` 同級：瀏覽器不可用／訪客／standalone／jsdom 時全部 no-op，絕不阻擋遊玩）。雲端存檔只存輕量進度（64 KiB 上限），體素改動仍只存 IndexedDB；熔爐模擬為純函數，進行中冶煉不跨存檔（讀檔重置，方塊本身以改動形式保留）。

**Tech Stack:** TypeScript + Vite + Three.js + Vitest (jsdom) + ESLint；無新增 npm runtime 依賴（SDK 為 vendored 的 `public/playroom-sdk.js`，非 npm 套件）。

**Spec:** `docs/superpowers/specs/2026-09-23-wecraft-design.md`（§1 非目標：多人／手機觸控／紅石／附魔藥水／村莊 NPC 不變；§2 架構；§7 純前端無伺服器）＋ 平台 `main` 文件（Task 1 執行時重讀；計畫撰寫時已讀 2026-10-11：game-agent-template、game-development、command-contracts、game.schema.json、game-release.yml、playroom-sdk.js 1.1.0、sdk-versioning、save-compatibility）。

**Approved Scope（執行者=本人拍板，用戶已授權不再提問）：**
- **排行榜不接入**：沙盒無逐局分數，平台列為選填；`game.json` 不宣告 `leaderboard`，`startRun/finishRun` 不呼叫。
- **雲端格式 v1 只存輕量進度**：seed、mode、玩家 pos/yaw、vitals、clock t、inventory、advancements、settings 子集；**改動體素不進雲端**（64 KiB 上限＋每分鐘 60 寫限制，體素表可輕易超限；改動仍只走 IndexedDB 本機）。
- **熔爐最小閉環**：1 方塊（FURNACE）＋ 2 冶煉式（iron_ore→iron_ingot、sand→glass）＋ 4 燃料（coal/log/planks/stick）＋ 10 s/件；3 鐵工具（鎬／斧／劍，同石器形狀）；蘋果進食（+4 飢餓）；火把／光照引擎／熔爐連鎖本次不做（spec 未要求光照引擎，效能風險）。
- **版本 0.3.0**（package.json + game.json 同步，schemaVersion 1→2）；**未獲明確發布要求不推 tag、不建 Release**。
- `devices` 維持 `["desktop"]`（觸控未做，不宣告 mobile）。

**Spec 落差備註：** 雲端 data 欄位、熔爐數值、鐵工具數值、食物數值、新進度文案、檢查點時機、衝突 UI 文案等 spec 未定細節，由本計畫直接拍板（見各 Task 常數表）。

---

## Global Constraints

- **架構紅線**：`core/`、`world/`、`player/` 不得 import Three.js 或新增 DOM 使用（`player/input.ts` 既有事件監聽是既有例外）；Three.js 只出現在 `render/`、`main.ts`；`ui/` 不 import bus（由 main 以 callback 注入）；新 `platform/` 模組可在瀏覽器碰 `window/document`，但在無 SDK／jsdom／載入失敗時全部 no-op 且不拋錯。
- **依賴**：runtime 依賴只有 `three`；不得新增 npm runtime 依賴（`playroom-sdk.js` 為 vendored 靜態檔，非依賴；devDependency 預期不加）。
- **測試**：與來源同置 `src/**/*.test.ts`，一律 `npx vitest run`；每個 Task 的 Expected 以實際輸出為準，不得以「應該會過」代替。
- **平台行為限制**：不跳轉頂層、不開 popup、不提交表單、不自行鎖定頂層鍵盤、不依賴短按 Esc 退出平台播放器；音效維持玩家手勢觸發、載入不自動播放、背景分頁靜音；遊戲適應 iframe 即時尺寸變化（模式切換不重載）；`localStorage` key 維持 `wecraft.settings` 命名空間；儲存不可用仍可遊玩。
- **存檔**：IndexedDB 維持 v2（本期不改 schema、不遷移）；雲端 formatVersion=1（Task 2 常數表），data 為 JSON 物件、UTF-8 ≤ 64 KiB、≤32 層；revision 讀取失敗（null）絕不視為空存檔、絕不覆寫雲端；同一快照重試沿用 requestId；SAVE_FORMAT_INCOMPATIBLE / REQUEST_ID_REUSED / 401-403 一律停止帳號寫入並提示，仍可遊玩。
- **成品**：`base: './'` 與相對路徑不變；SDK 以 `document.baseURI` 相對載入（子目錄／預覽子目錄皆可）；dist 不含無關檔案；ZIP 限制（≤64 MiB／解壓 ≤256 MiB／≤10,000 entries／封面 ≤5 MiB）由最終驗證確認。
- **效能**：60 FPS @ 視距 10 為目標；熔爐 UI 每幀開銷限於 progress 條更新；雲端檢查點節流（autosave 60 s），不逐幀上傳。
- **語言**：UI 文案沿用現行中英混用慣例（既有字串不動；新文案繁體中文為主）。
- **版本/發布**：`game.json` version 不含 `v`；tag 為 `v<version>`；版本只升不覆寫；未獲明確要求不推送 tag、不建立 Release、不呼叫平台發布 API。

## Review Focus

（spec＋平台規格暗示、但各 Task 測試無法完整覆蓋、最可能咬到使用者的輸入類別；每條都已在對應 Task 放上釘住它的測試或走查步驟）

1. **雲端讀取失敗被當空存檔覆蓋**：載入 reject 時若把 revision 歸 0 並保存初始進度，會洗掉玩家正式存檔；使用者期待「失敗只玩本機，絕不覆寫」。→ Task 2 `shouldAllowSave` 純函數測試 + Task 4 接線 + Task 10 雙瀏覽器／失敗注入驗證。
2. **64 KiB 超限**：長生存檔背包＋進度膨脹（理論上遠小於上限，但改動體素若被誤塞即爆）；使用者期待「超限只停雲端同步，本機照玩」。→ Task 2 `byteSizeOf`＋超限拒絕測試 + Task 4 toast。
3. **Revision 衝突覆蓋另一設備**：兩設備同時玩，後保存者若自動提高 revision 會丟失另一台進度。→ Task 2 衝突分類測試 + Task 4「停止→重讀→提示選擇」接線（本期選擇＝採用雲端／保留本機繼續玩不覆寫，合併不做）。
4. **熔爐吞／複製物品**：存檔讀取重置進行中冶煉時，若 input/fuel/output 回填錯誤會複製或吞沒；使用者期待「讀檔後爐內物最多回到放置前」。→ Task 6 快照 round-trip（重置語義）測試 + Task 10 瀏覽器 Save/Continue 對照。
5. **預覽寫入正式帳號／訪客被擋遊玩**：管理預覽 `saveProgress` 必須回 null 且不碰正式存檔；訪客／standalone 回 null 且遊戲全功能可玩。→ Task 3 loader 缺席測試 + Task 4 全路徑守衛 + Task 10 預覽診斷核對。

---

## File Structure

**Files to Create:**

- `src/platform/playroom.ts` — SDK 轉接（lazy load、ready 快取、load/save 包裝、錯誤分類）
- `src/platform/playroom.test.ts`
- `src/platform/playroom-sdk-types.ts` — 手寫 SDK 1.1.0 型別（不複製 .d.ts，避免 tsc allowJs 問題）
- `src/core/cloud-save.ts` — 雲端 data 組裝／驗證／遷移／守衛（純）
- `src/core/cloud-save.test.ts`
- `src/world/furnace.ts` — 冶煉模擬（純）
- `src/world/furnace.test.ts`
- `src/ui/furnace.ts` — 熔爐面板 DOM
- `src/ui/furnace.test.ts`
- `public/playroom-sdk.js` — vendored SDK 1.1.0（執行時自平台 examples/starter 抓取，內容與 Task 1 讀到的 1.1.0 一致）

**Files to Modify:**

- `src/world/blocks.ts` — `BLOCK.FURNACE = 16`＋ tiles `FURNACE_TOP=19`、`FURNACE_SIDE=20`、`TILE_COUNT=21`＋ def（hardness 3.0）＋ PLACEABLE
- `src/world/blocks.test.ts`（若有 tile/可放置斷言）
- `src/render/textures.ts` — 繪製熔爐頂／側 tile（程序 16×16）
- `src/render/textures.test.ts`
- `src/core/items.ts` — union 加 `iron_pickaxe`／`iron_axe`／`iron_sword`（STACK_ONE 同步）
- `src/core/items.test.ts`
- `src/core/recipes.ts` — 3 鐵工具配方（同石器形狀，`I=iron_ingot`；RECIPES 9→12）
- `src/core/recipes.test.ts`
- `src/core/advancements.ts` — 新 id `iron_tool`／`hot_stuff`／`tasty`＋事件 `smelt-take`／`ate`
- `src/core/advancements.test.ts`
- `src/player/interact.ts` — 工具速度／傷害表加鐵（相對現表：鐵匹配 3×、鐵劍傷害＝石劍＋1）＋右鍵工作台分支旁加熔爐 `useBlock`
- `src/player/interact.test.ts`
- `src/ui/menus.ts` — 暫停選單雲端狀態行＋重試按鈕（opts 加 `cloudStatus`／`onRetryCloud`）
- `src/ui/ui.test.ts`（menus 區塊）
- `src/ui/ui.css` — 熔爐面板＋雲端狀態行樣式
- `src/ui/crafting.ts` — 右鍵熔爐開爐面板（與工作台並列；不改匹配器）
- `src/main.ts` — 全部接線（組合根）
- `src/render/scene.ts` 或主迴圈 resize（Task 9 發現為準）
- `game.json` — version 0.3.0、schemaVersion 2、cloudSave `{readableFormats:[1],writeFormat:1}`
- `package.json` — version 0.3.0
- `README.md` — Phase 4 章節＋雲端／熔爐說明

---

## Task 1: 基準、環境與平台規格

**Files:**
- Modify: 無程式變更（ledger 寫進 plan 執行紀錄，不進 repo；若有 AGENTS.md 上游異動另起 commit，原封不動只 commit 使用者既有更新）

**Interfaces:**
- Consumes: 無
- Produces: 乾淨的綠燈基準；本次平台適用要求清單；SDK 1.1.0 內容快照（供 Task 3 vendor 比對）

- [ ] 1.1 依 AGENTS.md §1 以網路工具完整重讀 7 份 `main` 分支文件（game-agent-template、game-development.md、command-contracts.md、game.schema.json、game-release.yml、playroom-sdk.js、sdk-versioning.md、save-compatibility.md），記下本次適用要求與驗收項目（至少涵蓋：雲端 readableFormats/writeFormat、revision/requestId 語義、machineCode 分類、預覽 null 語義、iframe sandbox 驗收、ZIP 驗證、版本/tag 規則、未授權不發布、排行榜不做）。
- [ ] 1.2 若平台 `shared/versions.ts`（經 sdk-versioning 揭露）顯示 SDK／tools 有新版而 repo `.playroom` 仍為 1.1.0，記為 ruling（本期不升級，沿用已 pinning 工具；ZIP+lock 不動），不自行指定版本。
- [ ] 1.3 `npm install`（若缺 `node_modules`）；`npx vitest run` → 預期 `Test Files 42 passed`、`Tests 679 passed`（數字不同以實際為準並記錄）；`npx tsc --noEmit` 與 `npx eslint .` → 0 錯誤；`npx vite build` → 成功。
- [ ] 1.4 下載平台 `examples/starter/playroom-sdk.js` 全文存檔於 workspace 外（`/tmp/opencode/wecraft-p4-sdk/`），記錄首行版本註記 `Playroom SDK 1.1.0; protocol v1` 與 SHA-256，供 Task 3 vendor 一字不差比對。

**Expected test output:**
```
 Test Files  42 passed (42)
      Tests  679 passed (679)
```

---

## Task 2: 雲端存檔純邏輯（`core/cloud-save.ts`）

**Files:**
- Create: `src/core/cloud-save.ts`, `src/core/cloud-save.test.ts`

**Interfaces:**
- `cloud-save.ts`（純，不碰 window/localStorage/IndexedDB）：
  - `export const CLOUD_FORMAT_VERSION = 1 as const`
  - `export const CLOUD_MAX_BYTES = 65536 as const`（64 KiB UTF-8）
  - `export interface CloudSettings { renderDistance: number; sensitivity: number; volume: number; mode: 'survival'|'creative'; dayLengthSec: number; shadows: boolean; clouds: boolean }`
  - `export interface CloudData { seed: number; pos: [number,number,number]; yaw: number; vitals: Vitals | null; clockT: number; inventory: (ItemStack|null)[]; advancements: AdvancementState; settings: CloudSettings }`（Vitals／ItemStack／AdvancementState 沿用既有型別；不含 modified 體素——拍板）
  - `export function buildCloudData(src: { seed: number; pos: readonly [number,number,number]; yaw: number; vitals: Vitals|null; clockT: number; inventory: (ItemStack|null)[]; advancements: AdvancementState; settings: Settings }): CloudData`（深拷貝，fresh 陣列／物件；非有限 pos/yaw → 歸零／0，不拋錯）
  - `export function byteSizeOf(data: CloudData): number`（`new TextEncoder().encode(JSON.stringify(data)).length`）
  - `export function validateCloudData(x: unknown): x is CloudData`（object；seed 有限數；pos 三元有限；yaw 有限；clockT 有限；inventory 陣列（元素 null 或 {item:string,count:有限數}）；vitals null 或 {hp:有限數}；advancements 交給既有 `sanitizeAdvancements` 在 accept 側處理，此處只要求 object；settings object 且各欄型別正確——任一失敗 → false）
  - `export function acceptCloudData(x: unknown): CloudData | null`（validate 失敗 → null；成功 → 正規化拷貝：advancements 過 `sanitizeAdvancements`，settings 過既有 clamp（取 settings.ts 的 clamp 邏輯——若未 export 則在 Task 2 將 `clampSettings` 改為 export，不改語義），inventory 非法 item id 交給 main 側 inventory 模型丟棄，此處保留原字串）
  - `export type CloudSaveGuard = { revision: number | null }`；`export function shouldAllowSave(g: CloudSaveGuard): boolean`（`revision === null` → false；否則 true——讀取失敗／未讀取絕不覆寫）
  - `export type CloudErrorKind = 'CONFLICT'|'FORMAT'|'REQUEST_REUSED'|'AUTH'|'NETWORK'|'UNAVAILABLE'`；`export function classifyCloudError(err: unknown): CloudErrorKind`（`err.machineCode==='SAVE_REVISION_CONFLICT'` → CONFLICT；`'SAVE_FORMAT_INCOMPATIBLE'` → FORMAT；`'REQUEST_ID_REUSED'` → REQUEST_REUSED；`code===401||403` 或 machineCode 含 AUTH/PERMISSION → AUTH；`null/undefined`（SDK 不可用回傳）→ UNAVAILABLE；其餘 → NETWORK）
- Consumes: `Vitals`（player/survival）、`ItemStack`（core/items）、`AdvancementState/sanitizeAdvancements`（core/advancements）、`Settings`（core/settings）
- Produces: Task 4 接線用的全部純語義；`CLOUD_FORMAT_VERSION` 供 Task 5 game.json `writeFormat` 對照（必須同為 1）

- [ ] 2.1 寫失敗測試：`buildCloudData` 深拷貝（改 live 不影響已建 data）；`byteSizeOf` 小檔 <1 KiB、組裝 2000 格背包（以迴圈塞滿）仍 <64 KiB、人為塞 70 KiB 字串欄（掛在未知欄？——validate 應允許未知欄但 byteSize 照算，斷言 `> CLOUD_MAX_BYTES`）；`validateCloudData`（NaN pos → false、缺 settings → false、inventory 含 `{item:'x'}` 非法 count → false）；`acceptCloudData`（v1 fixtures 通過＋advancements 垃圾被 sanitize、settings 越界被 clamp）；`shouldAllowSave({revision:null})` → false、`({revision:0})` → true（首次讀到 null 即 revision 0 可存——拍板）；`classifyCloudError` 六例（含 machineCode 缺席只剩數字 409 → CONFLICT？——拍板：純數字 409 無 machineCode 時歸 CONFLICT（舊平台保守處理），FORMAT 必須有 machineCode 才判）。
- [ ] 2.2 跑 `npx vitest run src/core/cloud-save.test.ts` → RED（模組缺失）。
- [ ] 2.3 實作 `cloud-save.ts`（`clampSettings` 若未 export 則改 export，不改語義；settings.test 續綠）。
- [ ] 2.4 `npx vitest run` → 全綠。
- [ ] 2.5 commit：`feat(cloud): lightweight progress data rules with save guards`

**Expected test output:**
```
 ✓ src/core/cloud-save.test.ts (12 tests)
```

---

## Task 3: Playroom SDK 轉接（`platform/`＋ vendor）

**Files:**
- Create: `public/playroom-sdk.js`, `src/platform/playroom-sdk-types.ts`, `src/platform/playroom.ts`, `src/platform/playroom.test.ts`

**Interfaces:**
- `playroom-sdk-types.ts`（手寫，只描述本期用的子集，欄位名與 SDK 1.1.0 一字不差）：
  - `export interface PlayroomReady { available: boolean; progressAvailable: boolean; mode: 'authenticated'|'guest'|'preview'|'standalone'; sdkVersion: string; protocolVersion: number; capabilities: string[] }`
  - `export interface PlayroomProgress { data: unknown; revision: number; formatVersion: number; gameVersion: string; updatedAt: string }`
  - `export interface PlayroomModule { ready(): Promise<PlayroomReady>; loadProgress(): Promise<PlayroomProgress | null>; saveProgress(input: { data: unknown; revision: number; formatVersion: number; requestId?: string }): Promise<(PlayroomProgress & { saved: true }) | null> }`
- `playroom.ts`：
  - `export type CloudStatus = 'unknown'|'guest'|'unsupported'|'ready'|'error'|'conflict'|'format'`
  - `export interface PlayroomDeps { loadModule?: () => Promise<PlayroomModule | null> }`（預設 loader：`new URL('playroom-sdk.js', document.baseURI).href` 經 `import(/* @vite-ignore */ url)` 取 `Playroom`；任何失敗——含 jsdom `document.baseURI==='about:blank'`——→ null；`window.parent===window`（獨立開啟頂層）→ 直接 null，不 import）
  - `export interface CloudClient { readonly status: CloudStatus; readonly readyInfo: PlayroomReady | null; init(): Promise<CloudStatus>; load(): Promise<{ data: unknown; revision: number; formatVersion: number } | null>; save(data: unknown, revision: number, formatVersion: number, requestId: string): Promise<{ revision: number } | null>; }`
  - `export function createCloudClient(deps?: PlayroomDeps): CloudClient`
  - 行為：`init` 呼叫 loader→`ready()`（8 s timeout 由 SDK 內部處理；此處再包 10 s 上限，超時 → `unsupported`）；`progressAvailable===false` → status `guest`（訪客／預覽／standalone／舊平台皆此）且 `load/save` 直接回 null；`save` 只在 `mode==='authenticated'` 真送（SDK 預覽本就回 null，此處仍透傳 SDK 回傳，不二次判 preview）；錯誤經 Task 2 `classifyCloudError` 轉狀態（CONFLICT→`conflict`、FORMAT→`format`，其餘→`error`），呼叫端（main）讀狀態 toast／重試。
- Consumes: Task 2 `classifyCloudError`、`CLOUD_FORMAT_VERSION`（僅文件對照，不 import 也可；import亦可）
- Produces: Task 4 接線用的 `createCloudClient`；`public/playroom-sdk.js` 進 dist 根（Vite 自動複製 public/）

- [ ] 3.1 vendor：將 Task 1 存檔的 SDK 全文寫入 `public/playroom-sdk.js`，`diff` 與存檔零差異；首行含 `Playroom SDK 1.1.0; protocol v1`。
- [ ] 3.2 寫失敗測試（loader 全注入，不碰網路）：無 loader（預設）於 jsdom → `init()` 回 `guest`/`unsupported`（不斷言死值，斷言 ∈ {guest,unsupported} 且不拋錯）；loader 回 null → 同上且 `load/save` 回 null；fake module（`progressAvailable:false`）→ status `guest`，`save` 不呼叫 fake.saveProgress（計數斷言）；fake authenticated：`load` 回傳 fixture（含 revision 7）→ 原樣透出；`save` 成功回 `{revision:8}`；fake save 丟 `machineCode=SAVE_REVISION_CONFLICT` → `save` 丟出原錯且 status 變 `conflict`；`REQUEST_ID_REUSED`／無 machineCode 數字 409（→conflict，沿 Task 2 拍板）；`saveProgress` 回 null（預覽）→ `save` 回 null 且 status 不變。
- [ ] 3.3 跑 `npx vitest run src/platform/playroom.test.ts` → RED → 實作三檔 → GREEN。
- [ ] 3.4 `npx vitest run` → 全綠；`npx vite build` 後斷言 `dist/playroom-sdk.js` 存在且與 `public/playroom-sdk.js` 同 SHA。
- [ ] 3.5 commit：`feat(platform): Playroom cloud client with visitor-safe no-ops`

**Expected test output:**
```
 ✓ src/platform/playroom.test.ts (9 tests)
```

---

## Task 4: 雲端接線（main：讀取→套用→檢查點→衝突 UI）

**Files:**
- Modify: `src/main.ts`, `src/ui/menus.ts`, `src/ui/ui.test.ts`, `src/ui/ui.css`（雲端狀態行樣式）

**Interfaces:**
- Consumes: Task 2（`buildCloudData/acceptCloudData/byteSizeOf/shouldAllowSave/CLOUD_FORMAT_VERSION/CLOUD_MAX_BYTES`）、Task 3（`createCloudClient/CloudStatus`）
- Produces: 登入者跨設備進度；訪客零感知（無多餘 UI 噪音——拍板：訪客只在暫停選單見一行灰字「雲端：訪客本機遊玩」，不 toast）
- `menus.ts`：`showPause` opts 增 `cloudStatus: CloudStatus`、`onRetryCloud: () => void`；暫停清單底部加一行 `雲端：已同步／訪客本機遊玩／不支援／同步失敗（重試）／有新進度／格式不相容`（文案拍板如左；conflict 顯示「有新進度」＋重試按鈕，format 顯示「格式不相容」無重試按鈕）

- [ ] 4.1 `main.ts`：boot 建 `cloud = createCloudClient()`；`await cloud.init()`（失敗不阻擋開機，status 留 `unknown`→`error`照常進標題）。
- [ ] 4.2 讀取：`hasSave` 判定後、渲染標題前，若 status 非 `guest/unsupported` 則 `cloud.load()`；成功非 null → `acceptCloudData` → 通過則套用（seed→world 重建用該 seed、pos/yaw、vitals、clockT、inventory（非法 item 丟棄、その他保留）、advancements、settings 子集→`saveSettings`＋`applySettings` 現路徑）並記 `cloudRevision = revision`；`load` 丟錯 → toast「雲端讀取失敗，本機繼續」＋`cloudRevision = null`（守衛：後續一律不存）；成功 null（無存檔）→ `cloudRevision = 0`。
- [ ] 4.3 檢查點 `saveCloudNow(reason)`：`shouldAllowSave({revision: cloudRevision})` 為 false 即 return；`data = buildCloudData(live)`；`byteSizeOf(data) > CLOUD_MAX_BYTES` → toast「雲端空間不足，僅本機存檔」＋ return（IDB 照存）；`requestId = crypto.randomUUID()`（同快照重試沿用——實作：`pendingCloud = {data, requestId}`，失敗重試同一物件）；`cloud.save(...)` 成功 → `cloudRevision = 回傳 revision`、pause 行「已同步」；CONFLICT → 重讀 `load()` → 成功則套用＋toast「雲端有新進度，已同步」、`cloudRevision` 更新，pause 行「有新進度」；FORMAT／REQUEST_REUSED → 停止（`cloudRevision` 保持但標 `format` 鎖定旗，後續不再送）＋對應 toast；AUTH → 停止＋toast「請重新登入」；NETWORK → 保留 revision，pause 行「同步失敗（重試）」，重試按鈕調同一 `pendingCloud`。
- [ ] 4.4 觸發（與既有 IDB 儲存並列，互不阻塞，皆 try/catch）：進度解鎖時（Task 7/8 的 `applyAdvancement` 有 unlock）、Save & Quit 成功後、playing 中每 60 s（`cloudAcc += dt`，切換頁／dead 不累積）。**不依賴關頁保存**（拍板）。
- [ ] 4.5 `menus.ts`＋`ui.css`＋`ui.test.ts`：狀態行渲染六態、重試按鈕只在可重試態出現、點擊觸發 `onRetryCloud`。
- [ ] 4.6 `npx vitest run` → 全綠；`npx tsc --noEmit`＋`npx eslint .` 乾淨。
- [ ] 4.7 commit：`feat(cloud): load/apply/checkpoint wiring with conflict UI`

**Expected test output:**
```
 Test Files  ... passed (0 new failures — composition-root wiring carries no unit tests)
```

---

## Task 5: Manifest schema 2＋0.3.0＋工具驗證

**Files:**
- Modify: `game.json`, `package.json`

**Interfaces:**
- `game.json`：`version: "0.3.0"`、`schemaVersion: 2`，增 `"cloudSave": { "readableFormats": [1], "writeFormat": 1 }`（writeFormat 必須 ＝ Task 2 `CLOUD_FORMAT_VERSION`；其餘欄位一字不動，`id` 固定 `wecraft`，不加 `$schema`／未知欄位）
- Consumes: Task 2 常數、Task 3 `public/playroom-sdk.js`（验证 dist 含 SDK）
- Produces: 可發布候選 0.3.0（不推 tag）

- [ ] 5.1 改兩檔版本＋Manifest 宣告。
- [ ] 5.2 `npx vite build`；斷言 `dist/game.json`、`dist/index.html`、`dist/cover.png`、`dist/playroom-sdk.js` 四者存在。
- [ ] 5.3 pinned 工具驗證（repo 內固定工具，不自行指定版本）：解壓 `.playroom/tools/playroom-game-tools-1.1.0.zip` 至 workspace 外（`/tmp/opencode/wecraft-p4-tools/`），`node pack-game.mjs dist /tmp/opencode/wecraft-p4-tools/game.zip`＋`node validate-game.mjs .../game.zip` 全過；若 schema 2 被舊工具拒絕 → 停手回報（ruling：工具須升級，另開變更，不猜測）。
- [ ] 5.4 commit：`chore(release): 0.3.0 with cloudSave declaration`

**Expected test output:**
```
 pack-game: OK / validate-game: OK (0 errors)
```

---

## Task 6: 熔爐（方塊＋冶煉模擬＋面板）

**Files:**
- Modify: `src/world/blocks.ts`, `src/world/blocks.test.ts`（若有）, `src/render/textures.ts`, `src/render/textures.test.ts`, `src/ui/crafting.ts`, `src/main.ts`
- Create: `src/world/furnace.ts`, `src/world/furnace.test.ts`, `src/ui/furnace.ts`, `src/ui/furnace.test.ts`
- Modify: `src/ui/ui.css`

**Interfaces:**
- `blocks.ts`：`BLOCK.FURNACE = 16`；tiles 增 `FURNACE_TOP = 19`、`FURNACE_SIDE = 20`，`TILE_COUNT = 21`；def `{name:'furnace', hardness: 3.0, solid: true, transparent: false, top: FURNACE_TOP, side: FURNACE_SIDE, bottom: STONE}`（底沿用石紋——拍板）；`PLACEABLE` 尾加 `BLOCK.FURNACE`。
- `textures.ts`：程序繪製兩 tile（頂：石底＋爐口黑方；側：石底＋爐門黑框＋橙芯——拍板，16×16 pixel 風）；未繪而 `TILE_COUNT` 先加會在遊戲內露 magenta，測試須斷言兩 tile 非全 magenta。
- `world/furnace.ts`（純）：
  - `export const SMELT_TIME_SEC = 10 as const`
  - `export const SMELT_RECIPES: Readonly<Record<string, ItemId>> = { iron_ore: 'iron_ingot', sand: 'glass' }`（key 為 ItemId 字串；coal_ore 不可冶煉——拍板，直接掉 coal 走 Task 2 既有掉落）
  - `export const FUEL_VALUES: Readonly<Record<string, number>> = { coal: 8, oak_log: 2, oak_planks: 2, stick: 1 }`（每單位＝可完成的件數）
  - `export interface FurnaceState { input: ItemStack | null; fuel: ItemStack | null; output: ItemStack | null; progressSec: number; fuelUnits: number }`
  - `export function emptyFurnace(): FurnaceState`
  - `export function stepFurnace(s: FurnaceState, dtSec: number): { state: FurnaceState; completed: number }`（不 mutate；dt 非正／非有限 → 原樣回傳 completed 0；僅當 input 可冶煉＋output 可收（空或同 item 且 count<64）＋（fuelUnits>0 或 fuel 可點燃）才累積；fuelUnits 為 0 且 fuel 可燃 → 先扣 1 fuel 換 `FUEL_VALUES` 單位再累積；progressSec ≥10 → 件數結算（input−1、output＋1（空則 `{item, count:1}`）、fuelUnits−1、progressSec 歸 0，completed+1，剩餘 dt 續跑）；output 滿／input 不可冶煉 → progressSec 凍結（不清零——拍板，重配料後續燒））
- `ui/furnace.ts`：`export interface FurnaceUI { open(state: FurnaceState): void; close(): void; dispose(): void }`；`export function createFurnace(root: HTMLElement, opts: { onTakeOutput: () => void; onClose: () => void }): FurnaceUI`（input／fuel 兩格只顯示＋點擊回倉（經 crafting 既有槽語義由 main 搬），output 格點擊 → `onTakeOutput`；progress 條寬度＝`progressSec/10`；燃燒圖示亮滅＝`fuelUnits>0||fuel 可燃`（main 傳 state 即知）；Esc／E 關閉經 main 既有 overlay 路由）。
- `crafting.ts`：`useBlock` 旁加 `block === furnace` → main 開爐面板（不進匹配器）。
- Consumes: `ItemId/ItemStack/maxStack`、`itemFromBlock/blockFromItem`（熔爐方塊↔`furnace` item？——拍板：熔爐物品 id 沿用 `'crafting_table'` 模式，**新增 ItemId `'furnace'`**，BLOCK_PAIRS 加 `['furnace', BLOCK.FURNACE]`；Task 7 的 items 改動含此——兩 Task 同檔案，先合併後分 commit，Task 6 commit 含 block+pair，Task 7 含工具 union）
- Produces: main 每幀 playing 內 `stepFurnace`（單爐？——拍板：**每個放置的熔爐各跑一個 state**，`Map<key, FurnaceState>` key＝`x,y,z` 字串；方塊被挖掉 → 噴出爐內物（input/fuel/output 全 `spawnDrop`）並刪 state；讀檔／重生 → Map 清空（進行中重置，文件＋toast「熔爐進度已重置」只在爐內有物時 toast——拍板））

- [ ] 6.1 寫失敗測試（furnace sim）：空爐不動；`iron_ore+coal` 10 s → output 1 iron_ingot、input 扣 1、fuelUnits 7；fuel 耗盡停滯（progress 凍結）；output 滿格凍結；`sand→glass`；`coal_ore` 不冶煉；大 dt 連燒 2 件；非有限 dt 不動；不 mutate 輸入。
- [ ] 6.2 跑 → RED → 實作 `furnace.ts` → GREEN。
- [ ] 6.3 測試（blocks/textures/ui）：`FURNACE` id 16、PLACEABLE 含、tile 非 magenta；furnace UI（jsdom＋fake timers）：open 渲染三格＋progress、`onTakeOutput` 點擊觸發、close 清理。
- [ ] 6.4 跑 → RED → 實作 blocks＋textures＋ui/furnace.ts＋`ui.css`（`.furnace` 沿用 `.slot` 樣式，progress 條 `.furnace-progress`）→ GREEN。
- [ ] 6.5 `main.ts` 接線：Furnace Map、右鍵開面板、output 取走 → `applyAdvancement({type:'smelt-take'})`（Task 7 定義事件；此處先接 `any` 事件，Task 7 收斂型別——拍板，註記）、挖爐噴物、讀檔清空。
- [ ] 6.6 `npx vitest run` → 全綠。
- [ ] 6.7 commit：`feat(furnace): smelt iron and glass with per-block progress`

**Expected test output:**
```
 ✓ src/world/furnace.test.ts (10 tests)
 ✓ src/ui/furnace.test.ts (4 tests)
```

---

## Task 7: 鐵工具＋配方＋進度擴充

**Files:**
- Modify: `src/core/items.ts`, `src/core/items.test.ts`, `src/core/recipes.ts`, `src/core/recipes.test.ts`, `src/player/interact.ts`, `src/player/interact.test.ts`, `src/core/advancements.ts`, `src/core/advancements.test.ts`, `src/world/save.test.ts`（僅當 payload 形狀改變——本期不改，不動）, `src/main.ts`

**Interfaces:**
- `items.ts`：union 加 `'iron_pickaxe' | 'iron_axe' | 'iron_sword' | 'furnace'`（furnace pair 見 Task 6）；四者 `maxStack`：工具 1、furnace 64（STACK_ONE 加三鐵工具）。
- `recipes.ts`：`I = 'iron_ingot'`，加 `iron_pickaxe`（`III/·S·/·S·`）、`iron_axe`（`II/IS/·S`）、`iron_sword`（`·I/·I/·S`），RECIPES 9→12；另加 `furnace` 配方 `CCC/C·C/CCC`（8 cobblestone 圍一圈——拍板，3×3 shaped，result furnace ×1）。
- `interact.ts`：工具表相對現表只加兩條——鐵匹配挖掘 3×（木／石維持 2×，錯工具 0.5× 不變）；傷害：鐵劍＝石劍＋1（木 4／石 5／鐵 6，拳 2 不變；斧鎬傷害沿現表，Executor 先讀現表再加鐵對應＋1 檔）。
- `advancements.ts`：
  - `AdvancementId` 加 `'iron_tool' | 'hot_stuff' | 'tasty'`
  - `ADVANCEMENTS` 加：`iron_tool`「鐵製工具／合成一把鐵製工具」icon `iron_pickaxe`（obtain 任一鐵工具）；`hot_stuff`「燃燒吧／從熔爐取出冶煉成品」icon `furnace`（smelt-take）；`tasty`「吃個蘋果／吃掉一個蘋果」icon `apple`（ate）
  - `AdvancementEvent` 加 `{ type: 'smelt-take'; mode: GameMode } | { type: 'ate'; item: ItemId; mode: GameMode }`（creative 一律忽略，沿既有用例）
  - 存檔相容：`done` 為開放 Partial map，新 id 在舊檔缺席＝未解鎖（正確）；`sanitizeAdvancements` 未知 id 照丟（新 id 在新碼為已知，保留）——**IDB 不升版**。
- Consumes: Task 6（furnace pair、`smelt-take` 接線收斂）
- Produces: main `applyAdvancement` 新增：craft/拾取 iron_* → obtain（沿既有 obtain 路徑自動覆蓋）；`onTakeOutput` → smelt-take；吃蘋果 → ate（Task 8）

- [ ] 7.1 測試（items/recipes）：union 新四 id、`maxStack`、BLOCK_PAIRS 含 furnace、13 配方全表（含新 4）逐條觸發、舊 9 條續綠。
- [ ] 7.2 跑 → RED → 實作 items＋recipes → GREEN。
- [ ] 7.3 測試（interact）：讀現表後加鐵例（鐵鎬挖 stone 3×、鐵斧砍 log 3×、鐵劍傷＝石劍＋1、錯工具 0.5× 不變）。
- [ ] 7.4 跑 → RED → 實作 interact → GREEN。
- [ ] 7.5 測試（advancements）：三新 id 觸發（survival 解、creative 忽略、重複不重解、state 不 mutate、sanitize 保留新 id 丟垃圾）；舊 9 條續綠；save.test 不動（payload 形狀不變——斷言仍綠）。
- [ ] 7.6 跑 → RED → 實作 advancements → GREEN；`main.ts` 收斂三事件接線。
- [ ] 7.7 `npx vitest run` → 全綠。
- [ ] 7.8 commit：`feat(progress): iron tools, furnace recipe and new advancements`

**Expected test output:**
```
 ✓ src/core/recipes.test.ts
 ✓ src/core/advancements.test.ts (17 tests)
```

---

## Task 8: 蘋果進食

**Files:**
- Modify: `src/main.ts`, `src/player/interact.test.ts`（若消費語義放 interact；否則只 main＋survival 既有 `eat`）
- Create: 無新檔（沿用 `survival.eat`＋inventory 既有消費；若 Executor 發現需純 helper，檔名 `src/player/eat.ts`＋test，接口 `eatFromSlot(slots, index): { slots, ate: boolean }`，apple `{food:4, sat:2.4}`——拍板）

**Interfaces:**
- 觸發：survival 下、選中格為 apple、右鍵且**無方塊被指向**（raycast miss）或指向不可互動面 → 吃 1 個（`eat(v, 4, 2.4)`＋`vitals-changed`＋`place` 音（沿用 place 音——拍板，不新增音色）＋`applyAdvancement({type:'ate', item:'apple', mode})`）；創造不吃（無限方塊路徑不變）；飢餓已滿仍可吃（Minecraft 允許溢出浪費——拍板）。
- Consumes: Task 7（`ate` 事件）
- Produces: 生存飢餓循環閉環（殭屍蘋果掉落→進食→回血鏈）

- [ ] 8.1 寫失敗測試：helper（null 格 → ate false；apple count 3 → 2 且 ate true；非食物（stone）→ false；count 1 → null 格）；`eat` 數值（hunger 16→20、sat 補 2.4 上限 20）。
- [ ] 8.2 跑 → RED → 實作 → GREEN。
- [ ] 8.3 `main.ts` 接線（右鍵分支：先判熔爐／工作台互動 → 再判進食 → 再判放置；順序拍板如左）。
- [ ] 8.4 `npx vitest run` → 全綠。
- [ ] 8.5 commit：`feat(survival): eat apples to restore hunger`

**Expected test output:**
```
 ✓ src/player/eat.test.ts (5 tests)（或合入 interact.test.ts，同等覆蓋）
```

---

## Task 9: 平台執行限制稽核＋修正（iframe／尺寸／Esc）

**Files:**
- Modify: 依發現（預期 `src/main.ts`、`src/render/scene.ts`，以及 `index.html`／`src/style.css` 的尺寸語義）

**Interfaces:**
- Consumes: 全部前序 Task
- Produces: 模板 §3 可玩保證（不跳轉／無 popup／無表單提交／不鎖頂層鍵盤／尺寸自適應／Esc 留遊戲／儲存不可用可玩）

- [ ] 9.1 靜態稽核（grep 證據留檔）：`grep -rn "window.top\|window.open\|alert(\|confirm(\|prompt(\|requestFullscreen\|KeyboardLock\|keyboard.lock" src/` → 預期 0 命中（input pointer lock 除外——`requestPointerLock` 允許，列出命中逐條 adjudicate）；`grep -rn "<form" index.html src/` → 0；`grep -rn "localStorage\|indexedDB" src/` → 列出並確認每處 try/catch（儲存不可用可玩）。
- [ ] 9.2 尺寸：確認 `resize` 監聽存在（renderer.setSize＋camera.aspect）；若缺 → 補（render/scene 內 `setSize(w,h)` 純尺寸函數＋main 監聽，jsdom 測 setSize 不拋錯）。
- [ ] 9.3 Esc：確認遊戲內 Esc＝暫停選單（既有 v0.2.1/v0.2.2 修正），且無任何 `keydown Escape → exitFullscreen／postMessage top` 路徑；瀏覽器驗證（Task 10 矩陣含一般／沉浸兩態）。
- [ ] 9.4 `npx vitest run` → 全綠。
- [ ] 9.5 commit：`fix(platform): resize and execution-limit audit findings`（無發現則 `chore(platform): execution-limit audit clean` 空 commit——不硬湊改動）

**Expected test output:**
```
 grep audits: 0 unexpected hits
 Test Files  ... passed
```

---

## Task 10: 最終驗證、文件與發布準備

**Files:**
- Modify: `README.md`, `package.json`（已在 Task 5）、`game.json`（已在 Task 5）、依驗證發現所需（fix batch）
- Modify: `.github/workflows/release.yml`——僅當驗證發現 job 層問題；現檔 step-level env 修復保留（與上游 job-level env 的差異記為 ruling，不「改回上游」）

**Interfaces:**
- Consumes: 全部前序 Task
- Produces: 可交付 0.3.0 成品；完整驗證證據；完成回報（模板 §6 格式：ID／版本／成品位置／規格讀取時間／主要改動／相容性限制／已通過－未執行）

- [ ] 10.1 全套：`npx vitest run`、`npx tsc --noEmit`、`npx eslint .`、`npx vite build` → 全綠；記錄最終測試數。
- [ ] 10.2 架構紅線 grep：`grep -rn "from 'three'" src/core src/world src/player src/platform` → 0；`grep -rn "document\.|window\." src/core src/world` → 0；`src/player` 僅 `input.ts`＋Task 8 helper（若有 DOM 則列為違規修掉）；`src/ui` 無 `bus` import。
- [ ] 10.3 `game:pack`／`game:validate`：pinned 工具（1.1.0＋lock）對 `dist/` 打包並完整驗證通過（ZIP 於成品目錄外）；schema 2＋cloudSave 宣告被驗證器接受。
- [ ] 10.4 瀏覽器走查（Playwright chromium；證據 `/tmp/opencode/wecraft-p4-shots/`；每項截圖＋探針 JSON；固定 seed 1337）：
  1. 完整生存煙霧：開局→敲→拾取→2×2→工作台→3×3 石鎬→挖鐵礦→熔爐（coal 燃料）→10 s 冶煉→鐵錠→鐵鎬→toast 三新進度；
  2. 蘋果：刷怪夜（dayLengthSec=60）→蘋果掉落→右鍵進食→飢餓回升截圖；
  3. 雲端預覽診斷：管理預覽展開→診斷面板連線／版本／事件→進度 saveProgress 回 null、重開清除（不碰正式帳號）；
  4. 雲端衝突副本：以 node 腳本寫兩份 revision 分叉（r5 vs r5 同基改兩版）→第二份 save 報 CONFLICT→遊戲重讀套用＋「有新進度」行截圖；超限副本（70 KiB data 直送 `saveProgress`？——SDK 層會拒，改測 `buildCloudData`＋`byteSizeOf` 守衛 toast：「空間不足僅本機」）；
  5. 存檔相容：IDB v1 fixture → Continue 正常（advancements 全鎖）；雲端 format-1 fixture round-trip；
  6. iframe sandbox：兩埠交叉來源（`sandbox="allow-scripts allow-same-origin allow-pointer-lock"`、`allow="fullscreen; autoplay; gamepad"`）→載入、鎖定、鍵盤、進度保留、console 零 error；
  7. 尺寸／Esc 兩態：一般＋沉浸（devtools 尺寸模擬＋`?immersive` 若平台無則記未驗證）→操作區無裁切、Esc 暫停、退出按鈕在右上（平台側，遊戲不擋）；
  8. 效能：F3 @ 視距 10、陰影＋雲＋AO 全開→FPS／Triangles 截圖（目標 ≥55；未達 → 依 Phase 3 手段降級並記 ruling）。
- [ ] 10.5 `README.md`：Phase 狀態（0.3.0）、雲端說明（輕量進度／體素仍本機／訪客行為／衝突處理）、熔爐／鐵器／進食說明、測試數更新。
- [ ] 10.6 完成回報（模板 §6）：ID wecraft、版本 0.3.0、成品 `dist/`、規格讀取時間（Task 1 日期）、改動、相容性（IDB v1→v2 照讀；雲端 format 1；舊版遊戲讀新雲端 data→validate 失敗視為無存檔，不覆寫——走 accept null 路徑）、已通過／未執行（未授權：tag／Release／平台上架列未執行；沉浸真機／iOS 列未驗證）。
- [ ] 10.7 commit：`chore: phase 4 verification fixes`（有 fix 才有；文件更新另 `docs: phase 4 readme and report`）

**Expected test output:**
```
 Test Files  4X passed (4X)
      Tests  7XX passed (7XX)
 pack-game: OK / validate-game: OK (0 errors)
```

---

## Self-Review

**Spec coverage（設計 spec §4 分期＋平台規格）：**
- 雲端進度（平台 §4 後半：loadProgress/saveProgress、revision/requestId、machineCode、預覽 null、訪客可玩）→ Tasks 2–4 ✓；排行榜→ 明確不做（選填，ruling 已記）✓
- 熔爐冶煉／鐵工具／進食（設計 spec 未要求但同為「生存循環」缺口；spec §1 非目標未踩：無多人／觸控／紅石／附魔／NPC）→ Tasks 6–8 ✓
- 執行限制（平台 §3：iframe／尺寸／Esc／儲存）→ Task 9 ✓
- 發布驗證（平台 §5：build／typecheck／test／pack／validate／真機走查／版本規則）→ Tasks 5, 10 ✓

**Placeholder scan：** 無 TBD／TODO；熔爐數值、燃料表、配方形狀、食物數值、進度表、檢查點時機、衝突文案皆已拍板為具體值。

**Type consistency：** `CloudData/CloudSettings/CloudStatus/CLOUD_FORMAT_VERSION=1` 跨 Task 2–5 一致（game.json writeFormat=1 對照）；`FurnaceState/stepFurnace/SMELT_TIME_SEC=10` Task 6 內一致；新 `ItemId` 四件＋`AdvancementId` 三件＋`AdvancementEvent` 兩型 Task 6–8 一致；`furnace` item pair 歸屬 Task 6 已註記，Task 7 不重複定義。

**Ordering：** 規格重讀 → 純邏輯（cloud/furnace 可並行，但 executor 依序跑以保 furnace pair 先合併）→ adapter → 接線 → manifest → 玩法 → 稽核 → 驗證。每 Task 獨立可測、可 commit。

**Proportion：** 本計畫約 400 行，spec（設計 200 行＋平台 8 份）遠長於此；code block 僅簽名與斷言，無函數體轉錄。

**Status:** PLAN — 待用戶過目；執行方法已授權（全程用本人建議、不提問），下一步由用戶一句「執行」開始（未授權前不動程式、不推 tag）。
