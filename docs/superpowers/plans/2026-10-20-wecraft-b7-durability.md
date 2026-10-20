# WeCraft B7 工具耐久（0.10.0）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 補上原版的工具耐久——`ItemStack` 增加可選 `dur`、五種材質的耐久表（木 59／石 131／鐵 250／金 32／鑽 1561）、挖完方塊與攻擊命中各扣 1、歸零即壞（工具從背包消失＋損壞音效）、HUD 熱鍵欄與背包面板顯示耐久條——並把本機存檔升 v5、雲端升 format 3，最後發布 0.10.0。

**Architecture:** 純邏輯（耐久表／清洗規則／扣損計算）放 `src/core/durability.ts`（新模組）＋ `src/core/items.ts`（`ItemStack.dur` 與 `sanitizeStack`）＋ `src/core/inventory.ts`（模型保留 `dur`）；存檔遷移放 `src/world/save.ts`（本機 v5）與 `src/core/cloud-save.ts`（雲端 format 3）；UI 只做 DOM（一個共用的 `src/ui/durbar.ts` helper，熱鍵欄／背包／合成來源列共用）；`src/main.ts` 是未測的組裝根，只做接線（挖掘／攻擊扣耐久、損壞消失＋音效＋toast、Q 丟棄帶 `dur`）。**批次關鍵風險＝清洗規則**：`sanitizeStack`／`sanitizeSlots`（B1 加的過濾）與 `InventoryModel.setSlot`／`addItem` 現況都會把 `dur` 洗掉，必須逐條釘死。

**Tech Stack:** TypeScript strict、Three.js、Vite、Vitest（jsdom 用於 UI）、fake-indexeddb（存檔）、IndexedDB（本機）、Playroom SDK（雲端）、GitHub Actions release workflow。

**Spec:** `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`（§B7＝本批範圍，L259–264；§5.11 雲端格式政策、§6 已知簡化清單亦涵蓋本批）。跨批契約見 `/tmp/opencode/wecraft-planning/planning-conventions.md` §3–§7。

**執行方式:** SDD＋隔離 worktree，分支名 `b7-durability`（在計畫標注即可，不用建 branch）。每個 Task 是最小可獨立審查單元（TDD 循環、可獨立 commit）；批次最後由 controller merge、打 tag、push。

**疊在 B5 之上:** 本計畫假設 **B5（0.8.0）已合併**——工具 id 已含木／石／鐵／金／鑽五材質 × 鎬／斧／鏟／劍共 20 把；背包為 36 格（`HOTBAR_SLOTS = 9`／`MAIN_SLOTS = 27`／`INVENTORY_SLOTS = 36`）；本機 payload 已是 v4（型別 `SavePayloadV4`）；雲端已是 format 2（`CLOUD_FORMAT_VERSION = 2`／`CLOUD_READABLE_FORMATS = [1, 2]`／`isReadableCloudFormat`／**`migrateInventorySlots`（補 null 到 36 格、超過 36 截斷）**）；`main.ts` 的熱鍵欄變數已由 `hotbar` 改名 `slots`。**若 B5 尚未落地**：Task 1 Step 1 必須先讀 `src/core/items.ts`／`src/world/save.ts`／`src/core/cloud-save.ts`／`src/main.ts` 的現況，把本計畫中的工具 id 清單、槽位寬度、payload 版本、變數名換成實際值，並在對應 commit 訊息註明實際值（**不得默默套用 B5 的假設撞號**）。
**（2026-10-20 稽核修正：B5 的 fallback 必須涵蓋兩個**型別／函式**依賴，否則 typecheck 直接失敗：**
- **`SavePayloadV4`**（Task 2 的 `SavePayloadV5 extends Omit<SavePayloadV4, 'version'>` 的基底）→ B5 未落地時**本任務要自己新增** `export interface SavePayloadV4 extends Omit<SavePayloadV3, 'version'> { version: 4 }`（v3 ＋ 36 格背包語義）並自行建立 v3→v4 的遷移（見 Task 2 Step 1）。
- **`migrateInventorySlots`**（Task 3 的雲端槽位遷移）→ B5 未落地時**本任務要自己新增**（`src/core/cloud-save.ts`：`export function migrateInventorySlots(x: ReadonlyArray<ItemStack | null>): Array<ItemStack | null>`，複製每一格、補 null 到 36、截斷到 36；`INVENTORY_SLOTS` 當時是 9 → 補 null 到 **9**、截斷到 9）→ commit 訊息註明實際的槽位寬度與版本鏈。）

**疊在 B2 之上（本批的 Q 丟棄與 debug hook 來自 B2）:** Task 4 的「Q 丟棄帶 `dur`」與 Task 5 的「debug hook 讀 `dur`」都引用 B2 的產物 —— `src/main.ts` 的 `dropSelected()` 與 `window.__wecraft`。**master @ b11273f 兩者都不存在**（全 repo grep 無 `__wecraft`；`dropSelected()` 是 B2 計畫才新增的）。**若 B2 尚未落地**（**2026-10-20 稽核修正：原計畫只寫了 B5 的 fallback，沒寫 B2 的 → 實作者會照著計畫引用不存在的函式／hook，或宣稱「已用 hook 驗證」而其實沒做**）：
- **Task 4 Step 4（Q 丟棄接線）**：改成「**若 B2 尚未落地**：本任務只完成 `spawnDrop(drops, item, count, pos, { dur })` 的 API 與掉落物往返（純邏輯，可測）；`main.ts` 的 Q 丟棄接線**標記為待 B2 落地後補**（在 Task 7 前必須補齊，否則回報要明寫「Q 丟棄尚未接線」）」。
- **Task 5 Step 4 的 debug hook**：**若 `window.__wecraft` 不存在** → 人工驗收步驟 1 改成「用 F3 面板（或 `hud` 的 DOM 讀取熱鍵欄的耐久條寬度／`data-dur-color`）讀 `dur`」，**不得宣稱已用 hook 驗證**；Task 5 Step 6 的人工步驟也同步改寫。
- 兩處都要在對應 commit 訊息寫明「B2 未落地，該接線延後」。

---

## Global Constraints

（出自 spec §B7、§1、§2、公約 §3–§7 與 `AGENTS.md`；每個任務都隱含本節。）

- **本批要改寫的既有測試（集中清單，2026-10-20 終審修正）**：
  | 檔案 | 既有測試 | 改法 | 理由 |
  |---|---|---|---|
  | `src/core/inventory.test.ts` | `'addItem never merges tools (maxStack 1): one slot each'` 的 `toEqual` | 期望值補 `dur: 59`（或改成逐欄斷言 `expect(inv.slots.map((s) => s?.dur)).toEqual([59, 59, 59])`） | `addItem` 現在會 materialize 耐久；`item`／`count` 的斷言不得刪 |
  | `src/world/save.test.ts` | `makePayload()` fixture 的 `version` | v3（若 B5 已落地則已是 v4）→ v5 | payload 形狀升版 |
  | `src/world/save.test.ts` | `'migrates a raw v1 record to v3…'`／`'migrates a raw v2 record to v3…'`／`'derives the stash when a v3 record carries a corrupt or missing one'` | 改名 v5；斷言 `version` 改成 5；stash 期望值補 `dur` | 版本升版＋清洗器 materialize `dur` |
  | `src/world/save.test.ts` | `'rejects a record with an unsupported version'` | `{ version: 4 }`（或 5）→ `{ version: 6 }` | 版本鏈前進 |
  | `src/world/save.test.ts` | `'accepts a fully valid payload (v1, v2 and v3 all pass base validation)'` | 改成 v1～v5 都通過 | 版本鏈前進 |
  | `src/world/save.test.ts` | `'round-trips a full SavePayload through IndexedDB (deep equal)'` | fixture 的工具堆疊補 `dur` | deep-equal 需要欄位齊全 |
  | `src/core/cloud-save.test.ts` | 格式常數案例（`CLOUD_FORMAT_VERSION`／`CLOUD_READABLE_FORMATS`） | 1／2 → 3；`readableFormats` → `[1, 2, 3]` | 雲端格式升版 |
  | `src/core/cloud-save.test.ts` | `'acceptCloudData derives stash from legacy fields when absent'` | 保留並補 `expect(accepted.stash!.survival).toHaveLength(36)` | B5 的 36 格寬度 |
  | `src/ui/ui.test.ts` | 熱鍵欄／背包面板的 stack 比較（`sameStack`） | 納入 `dur` 比較 | 否則耐久變了不會重繪（新增案例，非改寫既有斷言） |
- 每個任務結束：`npm run typecheck`、`npm test`、`npm run build`、`npm run lint` 全綠；**既有 806 tests／51 files 不得刪除或弱化**（要改測試必須在 commit 訊息說明理由——本批有 4 個任務要改寫既有測試：Task 1（`inventory.test.ts` 的工具堆疊斷言要補 `dur` 欄位）、Task 2（`save.test.ts` 的 payload 版本 v3→v5、舊存檔工具的期望值補 `dur`）、Task 3（`cloud-save.test.ts` 的格式常數與 stash 寬度斷言）、Task 6（HUD 的 stack 比較納入 `dur`），每一處都在該任務的 commit 訊息寫明理由；Task 4／5 只新增測試）。**（2026-10-20 稽核修正：原句寫「Task 1（物品清洗／模型寫入的 stack 形狀）」，但沒有點名 `inventory.test.ts` 那條會紅的斷言 → 實作者會在 Task 1 的全量 gates 撞紅燈；現在明確寫出檔案與斷言。）**
- 版本：本批發布 `0.10.0`；`package.json` 與 `game.json` 同步；tag 為 `v0.10.0` 且指向含 bump 的 commit；不覆寫已發布版本；`id` 固定 `wecraft`。
- 存檔：**本機 payload 升 v5**（`ItemStack` 帶 `dur`）；v1／v2／v3／v4 必須照讀遷移（舊資料的工具 `dur` 一律視為滿耐久）。**雲端 format 升 3**：`game.json` 的 `cloudSave` 改為 `{ "readableFormats": [1, 2, 3], "writeFormat": 3 }`；`readableFormats` 只累積、不縮。
- **回退限制（升版後的既定後果）**：0.10.0 寫出的雲端資料是 format 3；0.9.0（B6）只宣告 `readableFormats:[1,2]`，**讀不到 format 3** → 平台會以 `SAVE_FORMAT_INCOMPATIBLE` 擋下不相容回退。此點必須寫進 `docs/releases/v0.10.0.md` 與 README（spec §B7／§5.11 明定）。
- 原版基準：Minecraft Java Edition 1.20+；數值以本計畫〈已查證與設計決策〉為準（逐條引 wiki，見該節）。
- **本批不做（明示範圍外）**：修補／鐵砧／熔修／附魔（Mending）／耐久附魔／打火石／釣竿（spec §B7「無修補／鐵砧／附魔」；wiki「Item repair」頁列的合成修補、 grindstone、anvil、Mending 全部不實作）。**工具堆疊仍為 1**（`STACK_ONE` 不變）。
- **不動 `Esc`／iframe／pointer lock／全螢幕既有路由**；本批不新增輸入鍵。
- 本批改動到的「Minecraft parity」宣稱（挖掘、掉落、音效、存檔格式、背包結構）要同步校正（各任務自己處理碰到的段落，Task 7 收斂 README）。
- 註解與文件用繁體中文（台灣用語）；識別字與程式碼英文。
- **行號基準**：`master @ b11273f`（0.4.0）。本計畫的行號以該基準為準；B2–B6 落地後 `src/main.ts`、`src/core/items.ts`、`src/world/save.ts` 的行號會位移，後續任務以「當時檔案內容」為準（用錨點／程式碼片段定位，不要照抄行號）。
- 發布候選跑固定工具：`.playroom/tools/playroom-game-tools-1.1.0.zip`（先驗 `sha256` 與 `.playroom/game-tools.lock.json` 一致）＋ `pack-game.mjs`＋`validate-game.mjs`；本機無 `unzip`，用 `python3 -m zipfile`。

---

## Review Focus

（spec 沒明說、但最可能咬人的失敗模式；每一條都已在對應任務放測試。）

1. **舊存檔／舊雲端缺 `dur` 會不會讓工具「一拿出來就壞」**：B1 的 `sanitizeStack` 現況只認 `{ item, count }`，任何額外欄位都被丟掉；一旦 `dur` 被洗掉又當成「0 → 已壞」，玩家的工具會集體蒸發 → Task 1（清洗規則測試：缺 `dur` → 滿耐久、NaN／負數 → 清除後視為滿耐久、超界 → 夾到上限）、Task 2（v1–v4 舊檔載入後工具 `dur` ＝ 上限）、Task 3（雲端 format 1／2 讀入後工具 `dur` ＝ 上限）。
2. **清洗器與模型寫入路徑都會洗掉 `dur`**：`sanitizeStack`／`sanitizeSlots` 之外，`InventoryModel.setSlot` 也只保留 `{ item, count }`（`src/core/inventory.ts:111-121`），`addItem` 新建的堆疊也沒有 `dur` → Task 1（`setSlot`／`addItem` 保留並 materialize `dur` 的測試）。
3. **HUD 的變更偵測只比 `item`／`count`**（`src/ui/hud.ts:81-87` 的 `sameStack`）→ 耐久扣了但畫面不重繪，耐久條會停在舊值 → Task 6（`sameStack` 納入 `dur` 的測試）。
4. **壞掉的工具會在「生存 → 創造 → 生存」往返後復活**：B1 的 `stash` 只在切模式時快照一次，存檔寫的是快照；壞掉的工具仍留在快照裡 → Task 2（`saveModeState` 覆寫語意的單元測試 ＋ `main.ts` 存檔前用 live 槽位同步 stash 的接線 ＋ 人工步驟）。
   **（2026-10-20 稽核修正：同步步驟必須接在**兩條**存檔路徑上 —— 本機 `sessionSavePayload()`（→`persistNow`／autosave／Save & Quit）**與雲端 `saveCloudNow()`**（雲端不經 `collectSavePayload`，直接吃 `modeStash`）→ 只接本機路徑的話，壞掉的工具會從雲端復活，而平台使用者以雲端為主要進度。）**
5. **掉在地上的工具撿起來會「洗白」成滿耐久**：`DropEntity` 現況沒有 `dur`（`src/world/drops.ts:28-37`），B2 的 Q 丟棄也只傳 `item`／`count` → Task 4（`spawnDrop`／`pickup` 帶著 `dur` 往返的測試）。
6. **歸零時必須同時清掉熱鍵列與主背包裡的那一件**（B5 後是 36 格模型、槽位索引 0..35）→ Task 5（`damageStack` 純邏輯測試 ＋ main.ts 接線的人工步驟；`inventory.setSlot(selected, null)` 的清格語意由 Task 1 的模型測試釘住）。
7. **回退限制必須誠實公告**：0.10.0 寫出的雲端是 format 3，0.9.0 讀不到；README 與發布說明若沒寫，玩家回退時會被平台的 `SAVE_FORMAT_INCOMPATIBLE` 擋住卻不知原因 → Task 3（`game.json` 與程式常數一致的測試）、Task 7（發布說明四段＋README）。

---

## 已查證與設計決策

（公約 §7 B7 查證清單的結果；引註格式：`已查證（minecraft.wiki/<Page>，2026-10-20）`。抓不到原文者寫「實作時複核」。）

### 1. 耐久值：依**材質**，不是依工具種類

- 已查證（minecraft.wiki/Durability，2026-10-20）：「Using a tool properly maximizes its durability. Assuming a player uses a tool appropriately, the following list shows the maximum durability for tools of each material type.」→ 材質表：**金 32／木 59／石 131／銅 191／鐵 250／鑽 1561／下界合金 2031**。
- **同一材質的所有工具同值**：木鎬 59 ＝ 木斧 59 ＝ 木鏟 59 ＝ 木劍 59（wiki 的表是「per material type」；同頁「Specific tools and weapons」列的是**沒有材質分級**的物品：打火石 64、釣竿 64、剪刀 238、盾 336、弓 384、三叉戟 250、elytra 432、弩 465、棒 500 —— 本作都沒有，因此不列入）。
- **本作只做五種材質**（銅／下界合金在本作的物品表裡不存在，B5 沒有、也沒有計畫要做）：金 32／木 59／石 131／鐵 250／鑽 1561 → 共 20 把工具（5 材質 × 鎬／斧／鏟／劍）。
- 已查證（minecraft.wiki/Tool，2026-10-20，History／Java Edition 1.3.1 `12w17a`）：「Tools now have infinite durability in Creative mode」→ **創造模式不扣耐久**。

### 2. 扣耐久的時機與數量（引原文並釘死）

- 已查證（minecraft.wiki/Durability，2026-10-20）：「For block-breaking tools, a use is counted if a player completely breaks apart one block or hits a mob. **If a block is partially broken, this is not counted as a full use.**」→ **挖到一半不扣；挖完才扣**（本批的第一條硬規則）。
- 同頁（Tools 分項）原文：
  - 「**Axes, pickaxes, and shovels:** Breaking a block that naturally breaks instantly counts as **0** uses. Breaking other blocks counts as **1** use. … **Hitting a mob (hostile, neutral or passive) counts as 2 uses.**」
  - 「**Swords:** Breaking a block that naturally breaks instantly counts as **0** uses. **Hitting a mob counts as 1 use.** Breaking other blocks counts as **2 uses.**」
- **本作採 spec §B7 的「破壞方塊與攻擊各 −1」**（鎬／斧／鏟／劍一律：挖完 −1、命中 −1）。與原版有**兩處刻意差異**：(a) 鎬／斧／鏟**打生物**原版 −2；(b) **劍挖方塊**原版 −2。兩處都寫進 README〈與原版的差異〉與發布說明〈已知問題〉（spec §1 原則 1「對不齊的地方用明示的簡化近似」）。
- 徒手（沒有工具）不扣；**創造模式不扣**（見上）。
- 原版「瞬破方塊 0 uses」的例外：現況 17 種方塊的硬度皆 > 0（`src/world/blocks.ts:65-81`，air 的 0 不可破），**本作沒有瞬破方塊** → 例外不適用。若 B3 的植物是瞬破（硬度 0），本批仍扣 1（明示簡化，記在 README）。

### 3. 歸零行為：工具消失，沒有掉落物

- 已查證（minecraft.wiki/Durability，2026-10-20，Interface 段）：「When the durability is empty, the item is about to be destroyed, apart from the elytra, which changes to a broken state in which it is unusable until repaired.」→ **工具直接消失**（不是變成「不可用的壞狀態」；本作沒有 elytra）。
- **沒有「0.5% 掉落」機制**：原版工具損壞時不產生任何掉落物（同頁只有音效條目，見 §4）。spec 裡出現的「0.5%」是 **B4 的「樹葉 0.5% 掉蘋果」**，與本批無關 —— 本批明確定案：**損壞的工具不產生掉落物**。

### 4. 損壞音效

- 已查證（minecraft.wiki/Durability，2026-10-20，Sounds 段）：「Item breaks | Players | **When an item's durability is exhausted** | `entity.item.break` | Volume 0.8 | Pitch 0.8–1.2 | Attenuation distance 16」。
- 本作的音訊是 WebAudio 程序合成（`src/audio/sounds.ts`＋`src/audio/voices.ts`），沒有原版取樣 → 本批新增**一個固定參數的合成音色** `tool_break`（低通 500 Hz、0.25 s、gain 0.8，音色不隨工具材質變化）→ **明示簡化**，寫進 README。

### 5. 耐久條（顏色與顯示時機）

- 已查證（minecraft.wiki/Durability，2026-10-20，Interface 段）：「The remaining durability of any item can be seen by looking at the item's durability bar on the bottom of the item icon in the inventory and action bar. **Unused items do not display a durability bar.**」→ **滿耐久的工具不顯示耐久條**（未使用過＝沒有條）。
- 同頁：「The durability bar starts at green, but as the durability decreases, the color gradually turns to yellow, then orange, and finally red.」→ 原版是**連續 HSV 漸層**；本作改用**四段門檻**（明示簡化）：

  | 剩餘比例 `dur / max` | 顏色 | 色碼 |
  |---|---|---|
  | `> 0.5` | 綠 | `#00ff00` |
  | `> 0.25` 且 `≤ 0.5` | 黃 | `#ffff00` |
  | `> 0.1` 且 `≤ 0.25` | 橘 | `#ff8000` |
  | `≤ 0.1` | 紅 | `#ff0000` |

- 樣式本身是**簡化樣式**（原版是貼在物品圖示下緣的 3D 疊圖）：本作是一條 3 px 的黑底細條＋彩色填充（`.ui-dur` / `.ui-dur-fill`），放在格子下緣。
- 顯示位置：**HUD 熱鍵欄（9 格）**、**背包面板（36 格）**、**合成面板的來源列**（同一個 helper，三處一致）。

### 6. 資料模型與清洗規則（本批最大風險，規則一次釘死）

- **`ItemStack` 增加可選 `dur?: number`**（`src/core/items.ts:37`）。語意：**`dur` 是「剩餘耐久」**（不是「已消耗量」）。
- **不變式：「耐久物品的堆疊永遠帶著一個明確的整數 `dur`，落在 `[0, max]`；非耐久物品永遠不帶 `dur` 欄位。」** 缺 `dur` 的耐久物品 → 視為**滿耐久**（`dur = max`）。這條不變式讓三條路徑（清洗器、存檔、模型）對「缺欄位」的解讀一致，也是「舊存檔的工具不會一拿出來就壞」的保證。
- **清洗規則（`sanitizeStack`／`normalizeDurability`）**：

  | 輸入的 `dur` | 結果 | 理由 |
  |---|---|---|
  | 缺漏／`undefined` | `max`（滿耐久） | 舊存檔／舊雲端沒有這個欄位 |
  | 整數且 `0 ≤ dur ≤ max` | 原值保留 | 合法值 |
  | 整數但 `dur > max` | **夾到 `max`** | 超界（例如被手改過的存檔） |
  | 負數 | **清除 → 視為滿耐久** | 壞掉的存檔不得弄壞玩家的工具 |
  | `NaN`／`Infinity`／非數字 | **清除 → 視為滿耐久** | 同上 |
  | 小數（非整數） | **清除 → 視為滿耐久** | 耐久是整數 |
  | 物品不是耐久物品 | **丟掉 `dur` 欄位** | 方塊／食物不該有耐久 |

- **`dur = 0` 是合法值**（工具「即將壞掉」，耐久條為空）；實際上工具在扣到 0 的當下就被移除，所以持久化的資料裡不會有 `dur = 0`。
- **`InventoryModel` 也遵守同一條不變式**：`setSlot` 與 `addItem` 寫入的耐久物品堆疊一律帶明確 `dur`（缺漏 → `max`）。→ 存檔快照（`{...stack}`）自然帶著 `dur`，**B8 的容器內容（序列化 `ItemStack`）自動涵蓋 `dur`**，B8 不需要額外改動（只要沿用 `sanitizeSlots`）。

### 7. 存檔升版與相容性

- 本機 payload **v4 → v5**：v5 與 v4 的欄位形狀相同，差別在**堆疊可能帶 `dur`**。`loadGame` 一律回傳 v5；v1／v2／v3／v4 記錄照讀，舊的工具 `dur` 由清洗器 materialize 成滿耐久。
- 雲端 **format 2 → 3**：`readableFormats: [1, 2, 3]`、`writeFormat: 3`；`game.json` 同步。format 1（9 格背包）／format 2（36 格背包）讀入時照既有的槽位遷移路徑處理，`dur` 由清洗器 materialize。
- **回退限制**：0.10.0 寫出的雲端資料是 format 3，0.9.0（`readableFormats:[1,2]`）讀不到 → 平台會以 `SAVE_FORMAT_INCOMPATIBLE` 擋下不相容回退。寫進 `docs/releases/v0.10.0.md` 與 README。

---

## 檔案結構

| 檔案 | 動作 | 職責 |
|---|---|---|
| `src/core/durability.ts` | **新增** | 耐久表（依材質）、`maxDurability`／`isDurableItem`／`currentDurability`／`normalizeDurability`／`damageStack` |
| `src/core/durability.test.ts` | **新增** | 純邏輯測試（表、清洗、扣損、歸零） |
| `src/core/items.ts` | 修改 | `ItemStack.dur?: number`；`sanitizeStack` 保留／materialize `dur`；非耐久物品丟掉 `dur` |
| `src/core/items.test.ts` | 修改 | 清洗規則測試（合法值保留／超界夾住／NaN·負數清除／非工具無 `dur`） |
| `src/core/inventory.ts` | 修改 | `setSlot`／`addItem` 保留並 materialize `dur`（`addItem` 新增可選第三參數） |
| `src/core/inventory.test.ts` | 修改 | 模型層的 `dur` 往返測試 |
| `src/world/drops.ts` | 修改 | `DropEntity.dur?`；`spawnDrop` 的 `opts.dur`；`pickup` 把 `dur` 帶回背包 |
| `src/world/drops.test.ts` | 修改 | 掉落物耐久往返測試 |
| `src/world/save.ts` | 修改 | payload v5、`isValidSavePayload` 收 v5、`loadGame` 一律回 v5 並用 `sanitizeSlots` 正規化 |
| `src/world/save.test.ts` | 修改 | v5 fixture、v1–v4 → v5 遷移測試、舊工具滿耐久測試 |
| `src/core/mode-stash.test.ts` | 修改 | `saveModeState` 覆寫語意的新案例（壞掉的工具不會復活） |
| `src/core/cloud-save.ts` | 修改 | `CLOUD_FORMAT_VERSION = 3`、`CLOUD_READABLE_FORMATS = [1,2,3]`、`isReadableCloudFormat`、接受路徑正規化 `dur` |
| `src/core/cloud-save.test.ts` | 修改 | format 3 的建置／驗收／遷移測試、`game.json` 一致性測試 |
| `src/audio/sounds.ts` | 修改 | 新增 `tool_break` 音色（固定參數）與 `TOOL_BREAK_PARAMS` |
| `src/audio/sounds.test.ts` | 修改 | 音色參數測試 |
| `src/ui/durbar.ts` | **新增** | 耐久條 DOM helper：`durabilityRatio`／`durabilityColor`／`mountDurabilityBar` |
| `src/ui/durbar.test.ts` | **新增** | 比例、顏色門檻、掛載／卸載測試 |
| `src/ui/hud.ts` | 修改 | 熱鍵欄耐久條；`sameStack` 納入 `dur`（否則耐久變了不重繪） |
| `src/ui/inventory.ts` | 修改 | 背包面板格子掛耐久條 |
| `src/ui/crafting.ts` | 修改 | 合成來源列／格子的耐久條（共用 `fillSlot`） |
| `src/ui/ui.css` | 修改 | `.ui-dur` / `.ui-dur-fill` 樣式 |
| `src/ui/ui.test.ts` | 修改 | HUD／背包面板的耐久條測試 |
| `src/main.ts` | 修改 | 挖掘／攻擊扣耐久、損壞消失＋音效＋toast、Q 丟棄帶 `dur`、debug hook 帶 `dur`、**存檔前同步 stash（本機 `sessionSavePayload()` 與雲端 `saveCloudNow()` 兩處）** |
| `package.json`、`game.json` | 修改 | 版本 0.10.0；`cloudSave` 升 format 3 |
| `README.md`、`docs/releases/v0.10.0.md` | 修改／新增 | Task 7 發布 |

---

### Task 1: 耐久資料模型與清洗規則（`ItemStack.dur` ＋ `durability.ts` ＋ 清洗器／模型）

**Files:**
- Create: `src/core/durability.ts`、`src/core/durability.test.ts`
- Modify: `src/core/items.ts`（`ItemStack` ＋ `sanitizeStack`）、`src/core/items.test.ts`
- Modify: `src/core/inventory.ts`（`setSlot`／`addItem`）、`src/core/inventory.test.ts`

**Interfaces:**
- Consumes: B5 的 `ItemId`（20 把工具）、現況 `ItemStack { item, count }`。
- Produces（後續任務依賴，名稱不得再改）：
  - `src/core/durability.ts`：
    ```ts
    import type { ItemId, ItemStack } from './items';   // type-only → 編譯期擦除，無執行期循環

    /** 最大耐久（依材質；同一材質的鎬／斧／鏟／劍同值）。 */
    export const TOOL_MAX_DURABILITY: Readonly<Partial<Record<ItemId, number>>>;
    export function maxDurability(item: string): number;            // 非耐久物品 → 0
    export function isDurableItem(item: string): boolean;
    export function currentDurability(stack: { item: string; dur?: number }): number;  // dur ?? max；非耐久 → 0
    export function normalizeDurability(item: string, dur: unknown): number | undefined;  // 清洗規則（見〈已查證與設計決策〉§6）
    export interface DurabilityResult { stack: ItemStack | null; broke: boolean }
    export function damageStack(stack: ItemStack, amount: number): DurabilityResult;
    ```
  - `src/core/items.ts`：
    ```ts
    export interface ItemStack { item: ItemId; count: number; dur?: number }
    ```
    `sanitizeStack(x: unknown): ItemStack | null` 的**新語意**：耐久物品回傳**必然帶 `dur`**（缺漏／非法 → `max`）；非耐久物品回傳**不含 `dur` 欄位**的 `{ item, count }`。`sanitizeSlots` 沿用（逐格呼叫 `sanitizeStack`）。
  - `src/core/inventory.ts`：
    - `setSlot(index, stack)`：寫入的堆疊對耐久物品**必然帶明確 `dur`**（缺漏／非法 → `max`）；非耐久物品不帶 `dur`。
    - `addItem(item: ItemId, count: number, dur?: number): number`：**新增可選第三參數**（地上撿回來的受損工具用它帶回耐久）；未給時耐久物品以 `max` 寫入。
    - `InventoryModel` 介面宣告（`src/core/inventory.ts:9-43`）的 `addItem` 簽名**同步改寫**成三參數版（介面與實作不一致＝`tsc` 錯誤）。

- [ ] **Step 1: 核對現況（B5 若未落地先做這一步）**

  讀 `src/core/items.ts` 與 `src/core/inventory.ts`，確認：
  1. 工具 id 清單（`ItemId` union 裡的 `*_pickaxe`／`*_axe`／`*_shovel`／`*_sword`）——預期 20 把（木／石／鐵／金／鑽 × 鎬／斧／鏟／劍）。**若清單與預期不同**（B5 未落地），以現況為準：只把**實際存在**的工具放進 `TOOL_MAX_DURABILITY`，並在 commit 訊息寫出實際筆數。
  2. `sanitizeStack` 現況只回 `{ item, count }`（`src/core/items.ts:121-127`）——確認沒有其他欄位需要保留。
  3. `InventoryModel.setSlot`（`src/core/inventory.ts:111-121`）與 `addItem`（`:61-81`）的寫入點。

  同時讀 `src/core/items.test.ts:146-192` 與 `src/core/inventory.test.ts`，記下要改寫的既有測試斷言（下一節逐條列出）。

- [ ] **Step 2: 寫測試（失敗）**

  **新建 `src/core/durability.test.ts`：**
  - `'the max durability table matches the vanilla material values'`：
    ```ts
    expect(maxDurability('wooden_pickaxe')).toBe(59);
    expect(maxDurability('wooden_sword')).toBe(59);
    expect(maxDurability('stone_axe')).toBe(131);
    expect(maxDurability('iron_shovel')).toBe(250);
    expect(maxDurability('golden_pickaxe')).toBe(32);
    expect(maxDurability('diamond_sword')).toBe(1561);
    expect(maxDurability('stone')).toBe(0);
    expect(maxDurability('apple')).toBe(0);
    ```
  - `'every tool of the same material shares one durability value'`（表驅動，20 把逐一）：
    ```ts
    const cases: Array<[ItemId, number]> = [
      ['wooden_pickaxe', 59], ['wooden_axe', 59], ['wooden_shovel', 59], ['wooden_sword', 59],
      ['stone_pickaxe', 131], ['stone_axe', 131], ['stone_shovel', 131], ['stone_sword', 131],
      ['iron_pickaxe', 250], ['iron_axe', 250], ['iron_shovel', 250], ['iron_sword', 250],
      ['golden_pickaxe', 32], ['golden_axe', 32], ['golden_shovel', 32], ['golden_sword', 32],
      ['diamond_pickaxe', 1561], ['diamond_axe', 1561], ['diamond_shovel', 1561], ['diamond_sword', 1561],
    ];
    for (const [item, max] of cases) expect(maxDurability(item)).toBe(max);
    ```
  - `'normalizeDurability keeps a legal value, clamps an over-max value and drops junk'`：
    ```ts
    expect(normalizeDurability('wooden_pickaxe', 30)).toBe(30);
    expect(normalizeDurability('wooden_pickaxe', 0)).toBe(0);
    expect(normalizeDurability('wooden_pickaxe', 999)).toBe(59);      // 夾到上限
    expect(normalizeDurability('wooden_pickaxe', -3)).toBeUndefined(); // 清除
    expect(normalizeDurability('wooden_pickaxe', Number.NaN)).toBeUndefined();
    expect(normalizeDurability('wooden_pickaxe', Infinity)).toBeUndefined();
    expect(normalizeDurability('wooden_pickaxe', 12.5)).toBeUndefined();
    expect(normalizeDurability('wooden_pickaxe', undefined)).toBeUndefined();
    expect(normalizeDurability('stone', 5)).toBeUndefined();          // 非耐久物品沒有 dur
    ```
  - `'currentDurability treats a missing durability as full durability'`：
    ```ts
    expect(currentDurability({ item: 'wooden_pickaxe' })).toBe(59);
    expect(currentDurability({ item: 'wooden_pickaxe', dur: 12 })).toBe(12);
    expect(currentDurability({ item: 'stone' })).toBe(0);
    ```
  - `'damageStack lowers the durability by one'`：
    ```ts
    const r = damageStack({ item: 'wooden_pickaxe', count: 1, dur: 3 }, 1);
    expect(r.broke).toBe(false);
    expect(r.stack).toEqual({ item: 'wooden_pickaxe', count: 1, dur: 2 });
    ```
  - `'damageStack reports a break when the durability reaches zero'`：
    ```ts
    const r = damageStack({ item: 'wooden_pickaxe', count: 1, dur: 1 }, 1);
    expect(r.broke).toBe(true);
    expect(r.stack).toBeNull();
    ```
  - `'damageStack treats a missing durability as full durability'`：
    ```ts
    const r = damageStack({ item: 'wooden_pickaxe', count: 1 }, 1);
    expect(r.stack).toEqual({ item: 'wooden_pickaxe', count: 1, dur: 58 });
    ```
  - `'damageStack leaves non-durable items untouched'`：
    ```ts
    const r = damageStack({ item: 'stone', count: 5 }, 1);
    expect(r.broke).toBe(false);
    expect(r.stack).toEqual({ item: 'stone', count: 5 });
    ```
  - `'damageStack ignores a non-positive or non-finite amount'`：
    ```ts
    const s = { item: 'wooden_pickaxe', count: 1, dur: 10 };
    expect(damageStack(s, 0).stack).toEqual(s);
    expect(damageStack(s, -1).stack).toEqual(s);
    expect(damageStack(s, Number.NaN).stack).toEqual(s);
    ```

  **`src/core/items.test.ts` 追加：**
  - `'tools still stack to one'`（**2026-10-20 稽核修正：新增 —— spec §B7 第 3 條「工具堆疊仍為 1」原本沒有任何測試釘住；既有證據是 `items.test.ts:96` 的 `'maxStack is 1 for tools and weapons'`，本條把它延伸到 20 把全表**）：
    ```ts
    for (const tool of TOOL_ITEMS) expect(maxStack(tool)).toBe(1);
    ```
    （`TOOL_ITEMS` 是既有測試檔裡的 20 把工具清單；若 B5 落地後清單更長，以現況為準。）
  - `'sanitizeStack keeps a legal durability and materializes the max when it is missing'`：
    ```ts
    expect(sanitizeStack({ item: 'wooden_pickaxe', count: 1, dur: 30 })).toEqual({ item: 'wooden_pickaxe', count: 1, dur: 30 });
    expect(sanitizeStack({ item: 'wooden_pickaxe', count: 1 })).toEqual({ item: 'wooden_pickaxe', count: 1, dur: 59 });
    expect(sanitizeStack({ item: 'diamond_sword', count: 1 })).toEqual({ item: 'diamond_sword', count: 1, dur: 1561 });
    ```
  - `'sanitizeStack clamps an over-max durability and clears a bogus one'`：
    ```ts
    expect(sanitizeStack({ item: 'wooden_pickaxe', count: 1, dur: 9999 })?.dur).toBe(59);
    expect(sanitizeStack({ item: 'wooden_pickaxe', count: 1, dur: -3 })?.dur).toBe(59);
    expect(sanitizeStack({ item: 'wooden_pickaxe', count: 1, dur: Number.NaN })?.dur).toBe(59);
    expect(sanitizeStack({ item: 'wooden_pickaxe', count: 1, dur: 12.5 })?.dur).toBe(59);
    ```
  - `'sanitizeStack drops the durability of a non-durable item'`：
    ```ts
    expect(sanitizeStack({ item: 'stone', count: 1, dur: 5 })).toEqual({ item: 'stone', count: 1 });
    expect(sanitizeStack({ item: 'apple', count: 1, dur: 5 })).toEqual({ item: 'apple', count: 1 });
    ```
  - `'sanitizeSlots keeps the durability of every slot'`：
    ```ts
    expect(sanitizeSlots([{ item: 'iron_pickaxe', count: 1, dur: 100 }], 2)).toEqual([
      { item: 'iron_pickaxe', count: 1, dur: 100 },
      null,
    ]);
    ```
  - 既有 `'sanitizeStack accepts real ids with positive finite counts, rejects junk'`（`items.test.ts:146-162`）**維持不動**（非耐久物品沒有 `dur` 欄位，`toEqual` 仍相等）。

  **`src/core/inventory.test.ts` 追加：**
  - `'setSlot keeps the durability of a tool and materializes a missing one'`：
    ```ts
    const inv = createInventoryModel([null, null], 'survival');
    inv.setSlot(0, { item: 'stone_pickaxe', count: 1, dur: 77 });
    expect(inv.slots[0]).toEqual({ item: 'stone_pickaxe', count: 1, dur: 77 });
    inv.setSlot(0, { item: 'stone_pickaxe', count: 1 });
    expect(inv.slots[0]).toEqual({ item: 'stone_pickaxe', count: 1, dur: 131 });
    ```
  - `'addItem stores a tool with the given durability'`（地上撿回來的受損工具）：
    ```ts
    const inv = createInventoryModel([null, null], 'survival');
    expect(inv.addItem('iron_axe', 1, 40)).toBe(0);
    expect(inv.slots[0]).toEqual({ item: 'iron_axe', count: 1, dur: 40 });
    ```
  - `'addItem gives a fresh tool full durability'`：
    ```ts
    const inv = createInventoryModel([null, null], 'survival');
    inv.addItem('iron_axe', 1);
    expect(inv.slots[0]?.dur).toBe(250);
    ```
  - `'a non-durable item never carries a durability'`：
    ```ts
    const inv = createInventoryModel([null, null], 'survival');
    inv.addItem('stone', 5);
    expect(inv.slots[0]).toEqual({ item: 'stone', count: 5 });
    ```
  - **既有測試要改寫（紅燈清單；2026-10-20 稽核修正：原計畫的改寫清單完全沒有 `inventory.test.ts` → 實作者會在 Task 1 Step 6 的全量 gates 撞紅燈）**：
    - `src/core/inventory.test.ts:40-49` `'addItem never merges tools (maxStack 1): one slot each'`：
      ```ts
      expect(inv.slots).toEqual([
        { item: 'wooden_pickaxe', count: 1, dur: 59 },
        { item: 'wooden_pickaxe', count: 1, dur: 59 },
        { item: 'wooden_pickaxe', count: 1, dur: 59 },
      ]);
      ```
      **改的理由**：`addItem` 現在會把耐久物品 materialize 成帶明確 `dur` 的堆疊 → 既有斷言少了 `dur` 欄位 → `toEqual` 判定不相等。**不是弱化**：斷言的內容（工具不合併、各佔一格）完全保留，只補上模型現在保證存在的欄位。
      （若實作者不想寫死 59，可改成逐欄斷言 `expect(inv.slots.map((s) => s?.dur)).toEqual([59, 59, 59]);` —— 但 `item`／`count` 的斷言不得刪。）
    - 其餘 `inventory.test.ts` 的 `toEqual` 斷言都用非工具物品（dirt／grass／stick）→ **不受影響**（非耐久物品沒有 `dur` 欄位）。

- [ ] **Step 3: 跑測試確認失敗**

  Run: `npx vitest run src/core/durability.test.ts src/core/items.test.ts src/core/inventory.test.ts`
  Expected: FAIL（`src/core/durability.ts` 不存在、`ItemStack` 沒有 `dur` 欄位）。

- [ ] **Step 4: 實作 `src/core/durability.ts`**

  **（2026-10-20 稽核修正：這段 body 保留 —— 依公約 §5「唯獨演算法不由簽名／測試決定時才給 body」，清洗／扣損規則正是本批的演算法核心；〈已查證與設計決策〉§6 的表格是它的權威表述，兩者必須一致。）**

  ```ts
  // 檔頭 doc 註解：最大耐久依「材質」（Java Edition 1.20+）：金 32／木 59／石 131／
  // 鐵 250／鑽 1561；同一材質的鎬／斧／鏟／劍同值。dur 是「剩餘耐久」。
  import type { ItemId, ItemStack } from './items';

  export const TOOL_MAX_DURABILITY: Readonly<Partial<Record<ItemId, number>>> = {
    wooden_pickaxe: 59, wooden_axe: 59, wooden_shovel: 59, wooden_sword: 59,
    stone_pickaxe: 131, stone_axe: 131, stone_shovel: 131, stone_sword: 131,
    iron_pickaxe: 250, iron_axe: 250, iron_shovel: 250, iron_sword: 250,
    golden_pickaxe: 32, golden_axe: 32, golden_shovel: 32, golden_sword: 32,
    diamond_pickaxe: 1561, diamond_axe: 1561, diamond_shovel: 1561, diamond_sword: 1561,
  };

  export function maxDurability(item: string): number {
    return TOOL_MAX_DURABILITY[item as ItemId] ?? 0;
  }
  export function isDurableItem(item: string): boolean {
    return maxDurability(item) > 0;
  }
  export function currentDurability(stack: { item: string; dur?: number }): number {
    const max = maxDurability(stack.item);
    if (max === 0) return 0;
    const d = stack.dur;
    return typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= max ? d : max;
  }
  export function normalizeDurability(item: string, dur: unknown): number | undefined {
    const max = maxDurability(item);
    if (max === 0) return undefined;          // 非耐久物品：不保留 dur
    if (typeof dur !== 'number' || !Number.isFinite(dur)) return undefined; // NaN/∞/非數字 → 清除
    if (!Number.isInteger(dur)) return undefined;  // 小數 → 清除
    if (dur < 0) return undefined;                 // 負數 → 清除
    if (dur > max) return max;                     // 超界 → 夾住
    return dur;
  }
  export function damageStack(stack: ItemStack, amount: number): DurabilityResult {
    if (!Number.isFinite(amount) || amount <= 0) return { stack, broke: false };
    const max = maxDurability(stack.item);
    if (max === 0) return { stack, broke: false };  // 非耐久物品不受影響
    const next = currentDurability(stack) - Math.floor(amount);
    if (next <= 0) return { stack: null, broke: true };
    return { stack: { ...stack, dur: next }, broke: false };
  }
  ```
  （`currentDurability` 對「非法 `dur`」回 `max`，與清洗規則一致 —— 清洗器已經把非法值清掉了，這裡是第二道保險。）

- [ ] **Step 5: 實作 `src/core/items.ts` 與 `src/core/inventory.ts`**

  - `items.ts`：
    - `export interface ItemStack { item: ItemId; count: number; dur?: number }`（加一行註解：`dur`＝剩餘耐久；耐久物品必然帶明確值，非耐久物品必然沒有）。
    - `sanitizeStack` 改成：
      ```ts
      const max = maxDurability(s.item);
      if (max > 0) {
        const dur = normalizeDurability(s.item, s.dur);
        return { item: s.item, count: s.count, dur: dur ?? max };
      }
      return { item: s.item, count: s.count };
      ```
      （檔頭加 `import { maxDurability, normalizeDurability } from './durability';`——**值匯入**；`durability.ts` 只 `import type` 本模組，無執行期循環。）
  - `inventory.ts`：
    - 檔頭加 `import { maxDurability, normalizeDurability } from './durability';`。
    - `setSlot` 的寫入改成：
      ```ts
      const max = maxDurability(stack.item);
      const dur = max > 0 ? (normalizeDurability(stack.item, stack.dur) ?? max) : undefined;
      slots[index] = { item: stack.item, count: Math.min(Math.floor(stack.count), maxStack(stack.item)), ...(dur !== undefined ? { dur } : {}) };
      ```
    - `addItem(item, count, dur?)`：兩處新建堆疊的地方（pass 2 的 `slots[i] = { item, count: put }`）改成同樣 materialize；`dur` 有給時以它為準（仍要過 `normalizeDurability`）。
    - `removeItem`／`spendFromSlot` 只動 `count`，`dur` 自動保留（迴圈內 `s.count -= …` 不重建物件）——確認這點，不需改。
    - 介面註解補一句：`addItem` 的第三參數是「撿回來的耐久」。

- [ ] **Step 6: 跑測試轉綠**

  Run: `npx vitest run src/core/durability.test.ts src/core/items.test.ts src/core/inventory.test.ts`
  Expected: PASS。

- [ ] **Step 7: 全量驗證**

  Run: `npm run typecheck && npm test && npm run build && npm run lint`
  Expected: 全綠（既有 806 tests 一個不多、一個不少）。

- [ ] **Step 8: Commit**

  ```bash
  git add src/core/durability.ts src/core/durability.test.ts src/core/items.ts src/core/items.test.ts src/core/inventory.ts src/core/inventory.test.ts
  git commit -m "feat(durability): B7 ItemStack 增加 dur 欄位與耐久表（木59／石131／鐵250／金32／鑽1561），清洗器與存檔模型保留並 materialize 合法 dur"
  ```
  （commit 訊息註明：清洗規則＝缺漏→滿耐久、超界→夾到上限、負數／NaN／小數→清除視為滿耐久、非耐久物品丟掉 `dur`；**既有測試的改寫只有一處**：`inventory.test.ts` 的 `'addItem never merges tools (maxStack 1): one slot each'` 補上模型現在保證存在的 `dur: 59` 欄位（斷言的語意「工具不合併、各佔一格」不變 → 不是弱化）。**2026-10-20 稽核修正：原 commit 訊息寫「既有測試未弱化，只新增案例」不實 —— 該測試必須改寫。）**

---

### Task 2: 本機存檔 payload v5（v1–v5 皆可讀 ＋ 舊存檔工具滿耐久）

**Files:**
- Modify: `src/world/save.ts`（型別、`isValidSavePayload`、`collectSavePayload`、`loadGame`）
- Modify: `src/world/save.test.ts`（fixture 升 v5、遷移測試）
- Modify: `src/core/mode-stash.test.ts`（`saveModeState` 覆寫語意的新案例）
- Modify: `src/main.ts`（存檔前用 live slots 更新 stash —— 只有一行接線）

**Interfaces:**
- Consumes: Task 1 的 `ItemStack.dur` 與 `sanitizeStack` 的 materialize 規則；B5 的 v4 payload 形狀與 `INVENTORY_SLOTS`；既有的 `saveModeState(stash, mode, slots, vitals)`（`src/core/mode-stash.ts:48-63`）。
- Produces:
  - `src/world/save.ts`：
    ```ts
    export interface SavePayloadV5 extends Omit<SavePayloadV4, 'version'> { version: 5 }
    export type SavePayload = SavePayloadV5;
    ```
    - `isValidSavePayload` 接受 `version ∈ {1, 2, 3, 4, 5}`。
    - `loadGame()` **一律回傳 v5**：`player.inventory` 與 `stash.survival`／`stash.creative` 的每一格都經過 `sanitizeSlots`（→ 耐久物品必然帶明確 `dur`）。
    - **`collectSavePayload` 的契約不變**（它照樣原樣複製傳進來的 `stash`）—— 見下方「stash 同步」說明。

- [ ] **Step 1: 讀現況並寫測試（失敗）**

  先讀 `src/world/save.ts`（型別區、`isValidSavePayload` 的版本檢查、`collectSavePayload`、`loadGame` 的遷移鏈）與 `src/world/save.test.ts` 的 fixture（`makePayload`／`makeV1Payload`／`makeV2Payload`／`slots` helper）。

  **（2026-10-20 稽核修正：先確認 `SavePayloadV4` 是否存在 —— 它只存在於 B5 的計畫裡，master @ b11273f 的 `save.ts` 只有 `SavePayloadV1`／`V2`／`V3`。若 B5 尚未落地，本任務要**同時**新增 `export interface SavePayloadV4 extends Omit<SavePayloadV3, 'version'> { version: 4 }`（v3 ＋ 36 格背包語義）並自行建立 v3→v4 的遷移（背包寬度由 `HOTBAR_SLOTS` 9 格 → `INVENTORY_SLOTS` 36 格），否則 `SavePayloadV5 extends Omit<SavePayloadV4, 'version'>` 直接是 TS 錯誤（找不到名稱）→ Step 7 的 typecheck gate 立刻失敗。commit 訊息要註明實際的版本鏈。）**

  **新增 fixture helper**：仿照既有的 `makeV1Payload`／`makeV2Payload` 加一個 `makeV4Payload(): SavePayloadV4`（v4 ＝ v3 ＋ 36 格背包語義，形狀照 B5 落地後的 `SavePayloadV4`；`inventory` 放 9 格以內的舊資料）——遷移測試需要它。
  **（2026-10-20 稽核修正：原計畫只說「仿照既有的 `makeV1Payload`／`makeV2Payload` 加一個 `makeV4Payload(): SavePayloadV4`」→ 半 TBD（公約 §5 禁止）。具體 body：**）
  ```ts
  /** A raw v4 record: v3 + the 36-slot inventory semantics (B5). */
  function makeV4Payload(): SavePayloadV4 {
    const v3 = makePayload();                       // 現況的 v3 fixture
    return {
      ...v3,
      version: 4,
      player: { ...v3.player, inventory: slots({ item: 'stone', count: 32 }) },
    } as SavePayloadV4;
  }
  ```
  （`slots(...)` 是既有 helper → 補 null 到 9 格；若 B5 已落地，`SavePayloadV4` 的 `inventory` 寬度是 36 格 → 這個 fixture 仍可用（`slots()` 產 9 格、v4 讀取時補齊）。）

  **改寫既有測試（理由要寫進 commit 訊息：payload 版本 v3/v4 → v5，屬形狀升版，不是弱化）：**
  - `makePayload()` 的 `version: 3` → `version: 5`（B5 落地後已是 4 → 改成 5）。
  - 既有 `'migrates a raw v1 record to v3 with derived stash and empty advancements'` → 改名 `'migrates a raw v1 record to v5 with derived stash and empty advancements'`，斷言 `expect(loaded!.version).toBe(5)`。
  - 既有 `'migrates a raw v2 record to v3, deriving stash from the recorded mode'` → 改名 v5。
  - 既有 `'derives the stash when a v3 record carries a corrupt or missing one'` → fixture 改 v5。
  - 既有 `'rejects a record with an unsupported version'`：`{ version: 4 }`（或 5）→ 改成 `{ version: 6 }`。
  - 既有 `'accepts a fully valid payload (v1, v2 and v3 all pass base validation)'` → 改成 v1／v2／v3／v4／v5 都通過。
  - 既有 `'round-trips a full SavePayload through IndexedDB (deep equal)'`：fixture 的 `inventory` 內含 `{ item: 'wooden_pickaxe', count: 1 }` → 改成 `{ item: 'wooden_pickaxe', count: 1, dur: 41 }`（**有 `dur` 才能 deep-equal**，因為清洗器會 materialize）。
  - **（2026-10-20 稽核修正：紅燈清單漏了一處 —— `save.test.ts:191-207` 的 `'derives the stash when a v3 record carries a corrupt or missing one'` 的 `expected` 內含 `{ item: 'wooden_pickaxe', count: 1 }` → stash 經 `normalizeModeStash` → `sanitizeSlots` 後會變成 `{ item: 'wooden_pickaxe', count: 1, dur: 59 }` → `toEqual` 紅。必須把 `expected` 改成：**）
    ```ts
    const expected = {
      survival: slots({ item: 'stone', count: 32 }, null, { item: 'wooden_pickaxe', count: 1, dur: 59 }),
      creative: starterSlots('creative'),
      survivalVitals: createVitals(), // the recorded vitals, normalized
    };
    ```
    （改的理由：清洗器現在保證耐久物品帶明確 `dur` → 期望值要補上這個欄位；斷言的語意（壞掉／缺漏的 stash 一律從 legacy 欄位推導）不變 → 不是弱化。）

  **新增測試：**
  - `'a v5 payload round-trips the durability through IndexedDB'`：
    ```ts
    const p = makePayload({ player: { ...makePayload().player, inventory: slots({ item: 'iron_pickaxe', count: 1, dur: 137 }) } });
    await saveGame(p);
    const loaded = await loadGame();
    expect(loaded!.player.inventory[0]).toEqual({ item: 'iron_pickaxe', count: 1, dur: 137 });
    ```
  - `'migrates a raw v4 record to v5 and gives an old tool full durability'`（**本批最重要的遷移斷言**）：
    ```ts
    const v4 = { ...makeV4Payload(), version: 4, player: { ...makeV4Payload().player, inventory: [{ item: 'wooden_pickaxe', count: 1 }] } };
    await putRawRecord(v4);
    const loaded = await loadGame();
    expect(loaded!.version).toBe(5);
    expect(loaded!.player.inventory[0]).toEqual({ item: 'wooden_pickaxe', count: 1, dur: 59 });
    ```
  - `'migrates a raw v1 record to v5 and gives an old tool full durability'`（v1 fixture 的 `inventory` 放一把 `stone_axe` → 讀回 `dur: 131`）。
  - `'a v5 record keeps a damaged tool durability'`：`dur: 12` → 讀回 `dur: 12`。
  - `'a v5 record with a corrupt durability falls back to full durability'`：`dur: -5` → 讀回 `dur: 59`（**不是 0**：壞掉的存檔不得弄壞玩家的工具）。
  - `'a v5 record with an over-max durability is clamped'`：`dur: 9999` → 讀回 `dur: 59`。
  - `'collectSavePayload carries the durability of every tool'`：
    ```ts
    const payload = collectSavePayload({
      world,
      player: { pos: [0, 0, 0], yaw: 0, mode: 'survival', inventory: [{ item: 'diamond_sword', count: 1, dur: 900 }] },
      vitals: null,
      clockT: 0,
      advancements: emptyAdvancements(),
      stash: createModeStash(),
      savedAt: 0,
    });
    expect(payload.player.inventory[0]).toEqual({ item: 'diamond_sword', count: 1, dur: 900 });
    ```
  - **`src/core/mode-stash.test.ts` 追加**（stash 同步的語意證明；`saveModeState` 本身不變，只是新增一個案例釘死「記錄模式那一側被 live slots 覆寫」）：
    ```ts
    it('saveModeState overwrites the recorded mode side with the live slots (a broken tool cannot come back)', () => {
      const stash = createModeStash();
      stash.survival[0] = { item: 'wooden_pickaxe', count: 1, dur: 1 };
      const next = saveModeState(stash, 'survival', [{ item: 'stone', count: 1 }], createVitals());
      expect(next.survival[0]).toEqual({ item: 'stone', count: 1 });   // 壞掉的工具不在 live slots → 不會復活
      expect(stash.survival[0]).toEqual({ item: 'wooden_pickaxe', count: 1, dur: 1 }); // 來源 stash 不被就地改寫
    });
    ```

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/world/save.test.ts`
  Expected: FAIL（版本常數仍是 3／4、舊檔的工具沒有 `dur`）。

- [ ] **Step 3: 實作 `src/world/save.ts` 的 v5**

  - 新增 `SavePayloadV5`；`export type SavePayload = SavePayloadV5;`（保留 V1／V2／V3／V4 供遷移）。
  - 檔頭 doc 註解補一段：v1→v2（進度）→v3（雙模式）→v4（36 格）→v5（`dur`）；說明「舊記錄的工具在載入時 `dur` ＝ 上限」。
  - `isValidSavePayload`：`r.version !== 1 && … && r.version !== 5 → false`。
  - `collectSavePayload`：**只把 `version` 改成 5**，其餘契約不動（它照樣原樣複製傳進來的 `stash` —— 既有測試 `'collectSavePayload deep-copies the stash (no aliasing)'` 刻意傳入非標準 stash 並斷言「payload 照抄」；**不得改這個語意**，否則會弱化既有測試）。`dur` 由淺拷貝 `{ ...s }` 自動帶著。
  - `loadGame`：
    - 遷移鏈維持 v1 → v2 → v3 → v4 → v5 的順序（`stash` 仍從原始記錄讀，`version` 一律改成 5）。
    - 回傳的 `player.inventory` 必須過 `sanitizeSlots(v2.player.inventory, INVENTORY_SLOTS)`（**若 B5 已落地本來就有；若尚未落地，本任務一併加上** —— 沒有這一步，`dur` 永遠不會被正規化）。`stash` 由 `normalizeModeStash` 處理（內部已用 `sanitizeSlots` → 自動 materialize `dur`）。
    - 註解補一句：「`dur` 由 `sanitizeStack` materialize：舊記錄缺 `dur` → 滿耐久；非法值 → 清除後視為滿耐久」。

- [ ] **Step 4: `main.ts` 的存檔路徑同步 stash（避免壞掉的工具復活）—— **兩條路徑都要**

  B1 的 `modeStash` 只在**切換模式**時快照一次 → 存檔寫出去的是快照，而 live 槽位可能已經變了（工具壞掉、被消耗）。因此在組 payload 之前，用既有的 `saveModeState` 更新一次。

  **（2026-10-20 稽核修正：原計畫只寫「放在 `main.ts` 組 `sessionSavePayload()`／`persistNow()` 的入口」→ **漏掉雲端路徑**。現況 `saveCloudNow()`（`main.ts:1192`）**不經過 `sessionSavePayload()`**：它直接 `buildCloudData({ …, inventory: [...hotbar], stash: modeStash })`（`main.ts:1197-1207`）→ 雲端檢查點寫出的 stash 仍是模式切換時的舊快照（含已損壞的工具）→ 下次讀雲端時 `normalizeModeStash` 會把它撿回來 → **壞掉的工具在雲端復活**，直接推翻 Review Focus #4 與批末驗收的宣稱（平台使用者以雲端為主要進度）。）**

  **改成一個共用的同步步驟，兩條路徑都呼叫：**
  ```ts
  /** 把「目前模式」的 live 槽位寫回 stash（與切模式時同一個動作）——
   *  否則壞掉的工具會留在舊快照裡，切模式往返後復活。
   *  ★ 兩條存檔路徑（本機 IDB 與雲端檢查點）都要呼叫它。 */
  function syncModeStash(): void {
    modeStash = saveModeState(modeStash, currentMode, slots, vitals);
  }
  ```
  - 呼叫點 1：`sessionSavePayload()`（`main.ts:1071`）**開頭**（`collectSavePayload` 之前）→ `syncModeStash();`（`persistNow()` 透過 `sessionSavePayload()` 自動涵蓋 ✓）。
  - 呼叫點 2：`saveCloudNow()`（`main.ts:1192`）**在 `buildCloudData(...)` 之前** → `syncModeStash();`（**這是原計畫漏掉的那條**）。
  - 檢查全 repo：**還有沒有第三條會寫出 `modeStash` 的路徑**（例如 `saveModeState` 的切模式分支本來就有 → 不用動）→ 逐條確認後在 commit 訊息寫明「已同步的路徑：sessionSavePayload（→persistNow／autosave／Save&Quit）、saveCloudNow」。
  - `saveModeState` 已在 `src/core/mode-stash.ts` 存在且有測試（`mode-stash.test.ts`）→ **不需要改 `mode-stash.ts` 的實作**。
  - 註解說明為什麼在這裡補（stash 的快照語意 vs live 槽位）**以及**為什麼雲端路徑也要（雲端不經 `collectSavePayload`）。
  - **人工驗收補一條**：生存 → 把工具用到壞 → **只做雲端檢查點**（不關本機存檔）→ 重新登入讀雲端 → 壞掉的工具**沒有復活**（原本只驗本機存檔 → 抓不到這個洞）。

- [ ] **Step 5: 跑測試轉綠**

  Run: `npx vitest run src/world/save.test.ts src/core/items.test.ts src/core/mode-stash.test.ts`
  Expected: PASS。

- [ ] **Step 6: 全量驗證＋人工**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。
  人工（記錄結果）：開新局 → 做一把木鎬 → Save & Quit → 繼續遊戲 → 木鎬仍在、耐久條未顯示（滿耐久）；用木鎬挖石頭數次 → 熱鍵欄出現綠色耐久條；把工具用到壞 → 存檔 → 重開 → **工具沒有復活**（stash 同步生效）；**再只做雲端檢查點 → 重登讀雲端 → 工具也沒有復活**（雲端路徑同樣有同步 ✓）。

- [ ] **Step 7: Commit**

  ```bash
  git add src/world/save.ts src/world/save.test.ts src/core/mode-stash.test.ts src/main.ts
  git commit -m "feat(save): B7 本機 payload 升 v5（ItemStack 帶 dur；v1-v4 舊檔照讀，舊工具載入後 dur＝滿耐久；存檔前用 live 槽位同步 stash —— 本機 sessionSavePayload 與雲端 saveCloudNow 兩條路徑都呼叫，壞掉的工具不會在模式往返或雲端讀取後復活）"
  ```
  （commit 訊息另註明：既有測試的改寫＝`save.test.ts` 的 payload 版本 v3→v5、舊存檔的工具期望值補 `dur: 59`（清洗器保證耐久物品帶明確 `dur`；斷言語意不變 → 不是弱化）。**2026-10-20 稽核修正：原 commit 訊息沒有寫既有測試的改寫理由，等於宣稱「未弱化」但實際改寫了。）**

---

### Task 3: 雲端 format 3（`readableFormats:[1,2,3]` ＋ `game.json` 同步 ＋ `dur` 正規化）

**Files:**
- Modify: `src/core/cloud-save.ts`、`src/core/cloud-save.test.ts`
- Modify: `game.json`（`cloudSave`）
- Modify: `src/main.ts`（三處格式檢查；**若 B5 已改成 `isReadableCloudFormat` 則本任務只需確認常數**）

**Interfaces:**
- Consumes: Task 1 的清洗規則；B5 的 `CLOUD_FORMAT_VERSION = 2`／`CLOUD_READABLE_FORMATS = [1,2]`／`isReadableCloudFormat`／`migrateInventorySlots`。
- Produces:
  - `src/core/cloud-save.ts`：
    ```ts
    export const CLOUD_FORMAT_VERSION = 3 as const;
    export const CLOUD_READABLE_FORMATS: ReadonlyArray<number> = [1, 2, 3];
    export function isReadableCloudFormat(v: number): boolean;
    ```
    - `acceptCloudData` 回傳的 `inventory`／`stash` 每一格：**耐久物品帶明確 `dur`**（缺漏／非法 → 上限）、非耐久物品不帶 `dur`；**未知 item id 仍保留為字串**（沿用現有語意，由主線的 inventory model 丟棄），但其 `dur` 欄位一律丟掉（沒有上限可算）。
    - **`acceptCloudData` 的 inventory 必須先過 B5 的 `migrateInventorySlots`**（補 null 到 36 格、超過 36 截斷）**再套 `dur` 正規化**；`buildCloudData` 同樣。**（2026-10-20 稽核修正：見下方 Step 3 —— 原計畫用純 `.map()` 取代了 `migrateInventorySlots` → B5 的 format 1→2 遷移（9 格 → 36 格、截斷）被本批破壞，而本計畫同時宣稱「v1／v2 雲端照讀」。）**

- [ ] **Step 1: 寫測試（失敗）**

  **`src/core/cloud-save.test.ts`：**
  - 既有 `'exposes format version 1 and a 64 KiB cap'` → **改寫**為 `'exposes format version 3, reads formats 1, 2 and 3, and a 64 KiB cap'`（**改動理由**：本批把雲端格式升到 3，`readableFormats` 累積）：
    ```ts
    expect(CLOUD_FORMAT_VERSION).toBe(3);
    expect(CLOUD_READABLE_FORMATS).toEqual([1, 2, 3]);
    expect(isReadableCloudFormat(1)).toBe(true);
    expect(isReadableCloudFormat(2)).toBe(true);
    expect(isReadableCloudFormat(3)).toBe(true);
    expect(isReadableCloudFormat(4)).toBe(false);
    expect(isReadableCloudFormat(0)).toBe(false);
    ```
  - 新 `'the manifest declares the same cloud format as the code'`（讀 `game.json`，照 B5 Task 9 的寫法）：
    ```ts
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'game.json'), 'utf8'));
    expect(manifest.cloudSave.writeFormat).toBe(CLOUD_FORMAT_VERSION);
    expect(manifest.cloudSave.readableFormats).toEqual([...CLOUD_READABLE_FORMATS]);
    ```
  - 新 `'acceptCloudData materializes the max durability for an old tool without one'`：
    ```ts
    const legacy = { ...rawValid(), inventory: [{ item: 'wooden_pickaxe', count: 1 }] };
    const accepted = acceptCloudData(legacy)!;
    expect(accepted.inventory[0]).toEqual({ item: 'wooden_pickaxe', count: 1, dur: 59 });
    ```
  - 新 `'acceptCloudData keeps a damaged tool durability'`：`dur: 20` → `dur: 20`。
  - 新 `'acceptCloudData drops the durability of a non-tool item'`：`{ item: 'stone', count: 1, dur: 5 }` → `{ item: 'stone', count: 1 }`。
  - 新 `'acceptCloudData drops the durability of an unknown item id'`（未知 id 仍保留字串，但 `dur` 欄位被丟掉）：`{ item: 'mystery_tool', count: 1, dur: 5 }` → `{ item: 'mystery_tool', count: 1 }`。
  - 新 `'buildCloudData carries the durability of the inventory stacks'`：
    ```ts
    const built = buildCloudData({
      seed: 42,
      pos: [0, 0, 0],
      yaw: 0,
      vitals: null,
      clockT: 0,
      inventory: [{ item: 'iron_axe', count: 1, dur: 88 }],
      advancements: emptyAdvancements(),
      settings: validSettings(),
      stash: createModeStash(),
    });
    expect(built.inventory[0]).toEqual({ item: 'iron_axe', count: 1, dur: 88 });
    ```
  - 既有 `'acceptCloudData derives stash from legacy fields when absent'`（`:291`）**保留並補一條** `expect(accepted.stash!.survival).toHaveLength(36)`（B5 的 36 格寬度）。
  - **（2026-10-20 稽核修正：新增 —— B5 的雲端遷移不可被本批破壞）**：
    - `'acceptCloudData still migrates a format 1 inventory into the 36-slot layout'`（B5 的行為，本批必須保留）：
      ```ts
      const legacy = { ...rawValid(), inventory: [{ item: 'stone', count: 32 }, { item: 'dirt', count: 2 }] };
      const accepted = acceptCloudData(legacy)!;
      expect(accepted.inventory).toHaveLength(36);       // 補 null 到 36 格
      expect(accepted.inventory[0]).toEqual({ item: 'stone', count: 32 });
      expect(accepted.inventory[2]).toBeNull();
      ```
    - `'acceptCloudData truncates an over-long inventory to 36 slots'`：`inventory: new Array(40).fill({ item: 'stone', count: 1 })` → `accepted.inventory` 長度 36。
    - `'buildCloudData writes 36 slots'`：`buildCloudData({ ...src, inventory: new Array(36).fill(null) }).inventory` 長度 36（B5 的既有測試，本批保留）。
  - **匯入指示（2026-10-20 稽核修正：原計畫的片段直接用了 `emptyAdvancements()`，但 `src/core/cloud-save.test.ts` 目前只 import 了 `createVitals`／`starterSlots`／`createModeStash` → 片段貼上跑不起來）**：測試檔頂部補
    ```ts
    import { emptyAdvancements } from './advancements';
    ```
    （若已有該 import 就不要重複加。）

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/core/cloud-save.test.ts`
  Expected: FAIL（常數仍是 1／2；`acceptCloudData` 不會 materialize `dur`）。

- [ ] **Step 3: 實作 `src/core/cloud-save.ts`**

  - `CLOUD_FORMAT_VERSION = 3`；`CLOUD_READABLE_FORMATS = [1, 2, 3]`；`isReadableCloudFormat(v)` 檢查是否在集合內。
  - 新增私有 helper（放在 `cloud-save.ts`，不外洩）：
    ```ts
    /** 雲端堆疊的 dur 正規化：耐久物品 → 明確值（缺漏／非法 → 上限）；其餘 → 沒有 dur 欄位。 */
    function normalizeCloudStack(s: ItemStack): ItemStack {
      const max = maxDurability(s.item);
      if (max <= 0) return { item: s.item, count: s.count };
      const dur = normalizeDurability(s.item, s.dur);
      return { item: s.item, count: s.count, dur: dur ?? max };
    }
    ```
    （`maxDurability`／`normalizeDurability` 來自 `src/core/durability.ts`。）
  - **`acceptCloudData`（2026-10-20 稽核修正：必須保留 B5 的槽位遷移）**：
    ```ts
    inventory: migrateInventorySlots(x.inventory).map((s) => (s === null ? null : normalizeCloudStack(s))),
    ```
    **（原計畫寫的是 `x.inventory.map(...)` → **把 B5 的 `migrateInventorySlots` 整個取代掉了**：B5 計畫明訂 `acceptCloudData` 用 `migrateInventorySlots(x.inventory)`（補 null 到 36、超過 36 截斷），本批的 Interfaces 也把 `migrateInventorySlots` 列為 Consumes，卻在 Step 3 用純 `.map()` 取代它。照字面實作後：format 1（9 格）的舊雲端進度不再補齊成 36 格、`>36` 格的資料也不截斷 → **B5 的 format 1→2 遷移被 B7 破壞**，本批宣稱的「v1／v2 雲端照讀」同時失效。→ 順序：**先遷移槽位數（補 null／截斷）→ 再正規化每一格的 `dur`**。）**
    `stash` 由 `normalizeModeStash` 處理（內部 `sanitizeSlots` → 已 materialize `dur`；槽位寬度由 B5 的 36 格語意決定）。
  - **`buildCloudData`（2026-10-20 稽核修正：統一成一句）**：
    ```ts
    inventory: migrateInventorySlots(src.inventory).map((s) => (s === null ? null : normalizeCloudStack(s))),
    ```
    **（原計畫在 Interfaces 寫「堆疊拷貝（`{ ...s }`）自然帶著 `dur` → **不需改**」、在 Step 3 又寫「**加保險**用 `normalizeCloudStack` 走一次」——同一函式兩種互斥指示，實作者只能二選一。統一成上面這一句：**寫出前一律走 `migrateInventorySlots` ＋ `normalizeCloudStack`** → 槽位數恆為 36、每一格的 `dur` 一定是明確值、非耐久物品一定沒有 `dur` 欄位。`stash` 的兩側同理（`migrateInventorySlots` ＋ `normalizeCloudStack`；`stash.survivalVitals` 不變）。）**
  - 檔頭 doc 註解改寫：「B7 起 format 3：堆疊可帶 `dur`；`readableFormats` 累積 [1,2,3]；**回退限制：0.10.0 寫出的 format 3 資料，0.9.0（只宣告 [1,2]）讀不到 → 平台會擋不相容回退**」。

- [ ] **Step 4: `game.json` 同步**

  `"cloudSave": { "readableFormats": [1, 2, 3], "writeFormat": 3 }`（`id`／`name`／`entry`／`version` 這一步不動；版本在 Task 7 才 bump）。
  **注意**：Task 3 提交時 `game.json` 的 `version` 仍是 0.4.0（或 B6 的版本）——`cloudSave` 與 `version` 是不同欄位，不衝突。

- [ ] **Step 5: `main.ts` 的格式檢查**

  - 讀 `src/main.ts` 內三處雲端格式檢查（開機讀取、`retryCloudRead()`、`resolveCloudConflict()`）。
  - 若 B5 已改成 `isReadableCloudFormat(res.formatVersion)` → **本任務只需確認常數是 `[1,2,3]`**（不改呼叫端）。
  - **若仍是 `res.formatVersion !== CLOUD_FORMAT_VERSION` → 必須改成 `isReadableCloudFormat(res.formatVersion)`**（2026-10-20 稽核修正：原計畫把「保持原樣即可」與「必須改成」並列在同一句 → 照前半句做會讓 0.9.0 之前（format 1）與 0.8.0（format 2）的雲端進度被判成不相容（`SAVE_FORMAT_INCOMPATIBLE`）＝進度遺失，正是該句後半段自己警告的結果）。改完後註解補一句：「讀到 format 1／2 時照常套用（`acceptCloudData` 已完成 9→36 的槽位遷移與 `dur` materialize），下一次檢查點就會以 format 3 覆寫」。

- [ ] **Step 6: 跑測試轉綠**

  Run: `npx vitest run src/core/cloud-save.test.ts src/world/save.test.ts`
  Expected: PASS。

- [ ] **Step 7: 全量驗證＋人工**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。
  人工（記錄結果）：登入帳號 → 開機讀雲端 → 進遊戲 → Save & Quit → 再進 → 位置與物品都在；暫停選單的雲端列顯示「就緒」而不是「格式不相容」。

- [ ] **Step 8: Commit**

  ```bash
  git add src/core/cloud-save.ts src/core/cloud-save.test.ts game.json src/main.ts
  git commit -m "feat(cloud): B7 雲端升 format 3（堆疊帶 dur；readableFormats [1,2,3]、writeFormat 3；舊雲端讀入時 materialize 滿耐久；保留 B5 的 migrateInventorySlots 槽位遷移——讀寫兩端都先補 null／截斷到 36 格再正規化 dur）"
  ```
  （commit 訊息另註明：既有測試的改寫＝`'exposes format version 1 and a 64 KiB cap'` → 改成 format 3 版（格式升版，不是弱化）；`'acceptCloudData derives stash from legacy fields when absent'` 補一條 36 格寬度的斷言。**2026-10-20 稽核修正：原 commit 訊息沒有寫改寫理由。）**）

---

### Task 4: 掉落物攜帶耐久（地上撿回來的工具不得洗白）

**Files:**
- Modify: `src/world/drops.ts`（`DropEntity`／`spawnDrop`／`pickup`）
- Modify: `src/world/drops.test.ts`
- Modify: `src/main.ts`（Q 丟棄帶 `dur`；熔爐溢出帶 `dur`）

**Interfaces:**
- Consumes: Task 1 的 `ItemStack.dur` 與 `InventoryModel.addItem(item, count, dur?)`；B2 的 `spawnDrop(drops, item, count, pos, opts?)`（`opts` 含 `pickupDelay`／`vel`）。
- Produces:
  - `src/world/drops.ts`：
    ```ts
    export interface DropEntity { …; dur?: number }   // 既有欄位不動，新增可選 dur
    export interface SpawnDropOptions { pickupDelay?: number; vel?: { x: number; y: number; z: number }; dur?: number }
    export function spawnDrop(drops, item, count, pos, opts: SpawnDropOptions = {}): DropEntity[];
    export function pickup(drops, idx, inventory): { drops: DropEntity[]; overflow: number };
    ```
    - `pickup` 把 `d.dur` 交給 `inventory.addItem(d.item, d.count, d.dur)`（受損工具撿回來仍是受損的）。

- [ ] **Step 1: 寫測試（失敗）**

  **`src/world/drops.test.ts` 追加：**
  - `'spawnDrop carries a durability'`：
    ```ts
    const [d] = spawnDrop([], 'iron_pickaxe', 1, { x: 0, y: 0, z: 0 }, { dur: 77 });
    expect(d.dur).toBe(77);
    ```
  - `'spawnDrop without a durability option has none'`：
    ```ts
    expect(spawnDrop([], 'dirt', 1, { x: 0, y: 0, z: 0 })[0].dur).toBeUndefined();
    ```
  - `'pickup puts the durability back into the inventory'`：
    ```ts
    const inv = createInventoryModel([null, null], 'survival');
    const drops = spawnDrop([], 'iron_pickaxe', 1, { x: 0, y: 0, z: 0 }, { dur: 77 });
    const res = pickup(drops, 0, inv);
    expect(res.overflow).toBe(0);
    expect(inv.slots[0]).toEqual({ item: 'iron_pickaxe', count: 1, dur: 77 });
    ```
  - `'a drop without a durability is picked up as a full-durability tool'`：
    ```ts
    const inv = createInventoryModel([null, null], 'survival');
    const drops = spawnDrop([], 'iron_pickaxe', 1, { x: 0, y: 0, z: 0 });
    pickup(drops, 0, inv);
    expect(inv.slots[0]).toEqual({ item: 'iron_pickaxe', count: 1, dur: 250 });
    ```
    （工具堆疊上限是 1 → `addItem` 不會「部分取用」，所以工具沒有部分拾取路徑；既有 `pickup` 的部分路徑對非耐久物品維持原樣。）
  - 既有 `spawnDrop`／`pickup` 的測試**維持不動**（新增欄位是 optional，既有斷言不受影響）。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/world/drops.test.ts`
  Expected: FAIL（`opts.dur` 不被接受、`DropEntity` 沒有 `dur`）。

- [ ] **Step 3: 實作 `src/world/drops.ts`**

  - `DropEntity` 加 `dur?: number`（註解：「掉落物的剩餘耐久；沒有 `dur` 的工具撿起來是滿耐久」）。
  - `SpawnDropOptions` 加 `dur?: number`。
  - `spawnDrop`：新建 entity 時 `dur: opts.dur`（`undefined` 時不要放進物件 → 用 `...(opts.dur !== undefined ? { dur: opts.dur } : {})`，避免 `dur: undefined` 破壞 deep-equal 的既有測試）。
  - `pickup`：`const overflow = inventory.addItem(d.item, d.count, d.dur);`（`d.dur` 為 undefined 時 → 模型 materialize 成上限 ✓）。

- [ ] **Step 4: `main.ts` 接線（Q 丟棄與熔爐溢出）**

  - B2 的 `dropSelected()`：`spawnDrop(drops, stack.item, count, pos, { pickupDelay, vel })` → **加 `dur: stack.dur`**（沒有 `dur` 的非工具不受影響）。
    **（2026-10-20 稽核修正：**若 B2 尚未落地**，`dropSelected()` 不存在 → 本步驟只做「熔爐溢出」那一條接線，Q 丟棄的接線**標記為待 B2 落地後補**（Task 7 前必須補齊，否則回報要明寫「Q 丟棄尚未帶 `dur`」）；commit 訊息註明「B2 未落地，Q 丟棄接線延後」。）**
  - 熔爐溢出（`main.ts` 挖掉熔爐時把 input／fuel／output 丟到地上那段）：`spawnDrop(drops, held.item, held.count, pos)` → 加 `dur: held.dur`。
  - 註解補一句：「掉落物帶著 `dur`，撿回來不會洗成滿耐久」。

- [ ] **Step 5: 跑測試轉綠**

  Run: `npx vitest run src/world/drops.test.ts`
  Expected: PASS。

- [ ] **Step 6: 全量驗證**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 7: Commit**

  ```bash
  git add src/world/drops.ts src/world/drops.test.ts src/main.ts
  git commit -m "feat(drops): B7 掉落物攜帶 dur（Q 丟棄與熔爐溢出的受損工具撿回來仍是受損的）"
  ```

---

### Task 5: 破壞方塊／攻擊命中各扣 1 ＋ 歸零即壞（消失＋音效＋toast）

**Files:**
- Modify: `src/audio/sounds.ts`（`tool_break` 音色）、`src/audio/sounds.test.ts`
- Modify: `src/main.ts`（扣耐久的接線：挖掘完成分支、攻擊命中分支）

**Interfaces:**
- Consumes: Task 1 的 `damageStack`；B1 的 `audio` facade（`src/audio/index.ts` 的 `play(kind, group, opts)`）、`toasts`（`src/ui/toast.ts`）、`stackName`。
- Produces:
  - `src/audio/sounds.ts`：
    ```ts
    export type SoundKind = 'dig' | 'break' | 'place' | 'step' | 'tool_break';
    export const TOOL_BREAK_PARAMS: SynthParams;   // 固定參數，不隨方塊材質變化
    ```
    `synthParams(group, kind)`：當 `kind === 'tool_break'` 時**直接回傳 `TOOL_BREAK_PARAMS`**（`group` 被忽略 —— 工具壞掉的音色不屬於任何方塊材質）。
  - `src/main.ts`（未測的組裝根）：
    ```ts
    /** 對手持堆疊施加耐久傷害；工具壞掉時清空該格並回報是否損壞。 */
    function damageHeldTool(amount: number): boolean;
    ```

- [ ] **Step 1: 寫測試（失敗）**

  **`src/audio/sounds.test.ts` 追加：**
  - `'the tool break sound uses a fixed profile'`：
    ```ts
    expect(synthParams('stone', 'tool_break')).toEqual(TOOL_BREAK_PARAMS);
    expect(synthParams('wood', 'tool_break')).toEqual(TOOL_BREAK_PARAMS);
    expect(TOOL_BREAK_PARAMS.durationSec).toBeGreaterThan(0.2);
    ```
  - 既有 `synthParams` 的三個案例（`'stone/dig: …'` 等）**維持不動**。

  **`src/core/durability.test.ts` 追加（本任務的扣損邏輯已在 Task 1 寫好，這裡補「一次 −1」的批次語意）：**
  - `'breaking a block costs exactly one durability and an attack costs exactly one'`：
    ```ts
    let stack: ItemStack = { item: 'stone_axe', count: 1, dur: 131 };
    stack = damageStack(stack, 1).stack!;
    expect(stack.dur).toBe(130);
    stack = damageStack(stack, 1).stack!;
    expect(stack.dur).toBe(129);
    ```

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/audio/sounds.test.ts src/core/durability.test.ts`
  Expected: FAIL（`tool_break` 不在 `SoundKind` 裡）。

- [ ] **Step 3: 實作 `src/audio/sounds.ts`**

  - `SoundKind` 加 `'tool_break'`。
  - **`KIND_MOD` 的條目（2026-10-20 稽核修正：原計畫要加 `tool_break: { durationSec: 0.25, gain: 0.8, scale: 1 }`，但 `synthParams` 在讀 `KIND_MOD` **之前**就 early-return `TOOL_BREAK_PARAMS` → 這筆條目是死碼，兩處參數可能發散）**：加它**只是為了滿足 `Record<SoundKind, KindMod>` 的型別**（不填 → TS 報錯）→ **加，並在旁邊加一行註解**：「`tool_break` 的實際參數來源是 `TOOL_BREAK_PARAMS`（`synthParams` 先 early-return）；這裡只為了滿足型別，**改動時兩邊要同步**」。
  - 新增並匯出：
    ```ts
    /** 工具損壞音（近似原版 entity.item.break：音量 0.8、pitch 0.8–1.2）。固定參數。 */
    export const TOOL_BREAK_PARAMS: SynthParams = {
      filter: 'lowpass', freq: 500, q: 0.7, durationSec: 0.25, gain: 0.8,
    };
    ```
  - `synthParams(group, kind)` 的第一行加：`if (kind === 'tool_break') return { ...TOOL_BREAK_PARAMS };`（在讀 `GROUP_BASE[group]` 之前，避免 group 查表）。
  - 檔頭註解補一句：「`tool_break` 是 B7 新增的固定音色（group 被忽略）」。

- [ ] **Step 4: `main.ts` 接線（扣耐久 ＋ 損壞消失 ＋ 音效 ＋ toast）**

  - 新增 helper（放在 `main.ts` 的互動區，靠近 `giveItem`／`dropSelected`）：
    ```ts
    /** 對手持堆疊施加耐久傷害（生存模式才消耗；創造模式的工具耐無限）。
     *  工具歸零 → 清空該格、播損壞音效、跳 toast。回傳是否損壞。 */
    function damageHeldTool(amount: number): boolean {
      if (currentMode === 'creative') return false;
      const stack = slots[selected];           // B5 後是 slots（36 格）；未落地則為 hotbar
      if (!stack) return false;
      const res = damageStack(stack, amount);
      if (res.broke) {
        inventory.setSlot(selected, null);     // 熱鍵列與主背包是同一個模型 → 一起清掉
        audio.play('tool_break', 'wood', { listener: player.position });
        toasts.push({ title: '工具損壞', description: `${stackName(stack.item)} 壞掉了`, icon: stack.item });
        return true;
      }
      if (res.stack && res.stack.dur !== stack.dur) {
        inventory.setSlot(selected, res.stack);
      }
      return false;
    }
    ```
    （`audio.play` 的第二個參數在此 kind 下被忽略；用 `'wood'` 只是為了滿足簽名。）
  - **挖掘完成分支**（`digStep` 回 true 的那一段，現況 `main.ts:2135-2178`）：在 `spawnBlockDrop(...)` 與 `setVitals(exhaust(...))` **之後**加：
    ```ts
    damageHeldTool(1);
    hud.setHotbar(slots, selected);
    ```
    （順序理由：**先掉方塊、再扣工具** —— 原版工具在挖完時壞掉，方塊的掉落物照樣出現。）
  - **攻擊命中分支**（`atk.hitId !== null` 那一段，現況 `main.ts:2083-2118`）：在傷害套用之後加：
    ```ts
    damageHeldTool(1);
    hud.setHotbar(slots, selected);
    ```
    （順序理由：**先造成傷害、再扣工具** —— 這一擊確實打中了。）
  - **不在這些地方扣**：挖到一半（`digStep` 回 false）、攻擊落空（`atk.hitId === null`）、`attackCd` 冷卻中的查詢帧、放置方塊、吃東西、徒手。
  - **debug hook（B2 的 `window.__wecraft`）補上 `dur`**：`hotbar: () => hotbar.map((s) => (s ? { item: s.item, count: s.count, ...(s.dur !== undefined ? { dur: s.dur } : {}) } : null))`（唯讀 hook，加一個欄位不影響既有探針；人工驗收要靠它讀出剩餘耐久）。
    **（2026-10-20 稽核修正：**若 B2 尚未落地**（master @ b11273f 沒有 `window.__wecraft`）→ 這一段整條略過，**人工驗收不得宣稱已用 hook 驗證** → 改用 F3 面板或熱鍵欄耐久條的 DOM（`.ui-dur-fill` 的 `style.width`／`data-dur-color`）讀出剩餘耐久。commit 訊息註明「B2 未落地 → debug hook 未接線」。）**
  - 註解補上 wiki 依據（挖完才扣、命中才扣、創造模式耐無限、鎬打生物原版 −2 本作 −1 的簡化）。

- [ ] **Step 5: 跑測試轉綠**

  Run: `npx vitest run src/audio/sounds.test.ts src/core/durability.test.ts`
  Expected: PASS。

- [ ] **Step 6: 全量驗證＋人工（記錄結果）**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。
  人工：
  1. 生存做一把木鎬（59 耐久）→ 挖石頭 → 每挖完一格，熱鍵欄的鎬耐久 −1（**讀法：若 `window.__wecraft` 存在就用它的 `hotbar()` 讀 `dur`；否則用 F3 面板或熱鍵欄耐久條的 DOM（`.ui-dur-fill` 的寬度）判讀 —— 不得宣稱已用 hook 驗證**）。
  2. 用石鎬打殭屍 → 每命中一次 −1；打空（落空）不扣。
  3. 讓工具扣到 0 → **工具從熱鍵欄消失**、播出一聲損壞音效、右上角出現「工具損壞」toast。
  4. 創造模式拿一把鑽鎬挖礦 → 耐久**不變**（創造模式耐無限）。
  5. 把一把受損的木鎬用 Q 丟到地上 → 撿回來仍是受損的（耐久條不回滿）。
     **（若 B2 尚未落地 → Q 丟棄不存在 → 這一步改用「把受損工具放進熔爐再取出」或「在創造模式用物品欄拖出同 id 的工具」驗證撿回路徑，並在回報寫明 Q 丟棄尚未驗證。）**

- [ ] **Step 7: Commit**

  ```bash
  git add src/audio/sounds.ts src/audio/sounds.test.ts src/main.ts
  git commit -m "feat(durability): B7 破壞方塊與攻擊命中各扣 1 耐久，歸零即壞（消失＋損壞音效＋toast；創造模式耐無限）"
  ```

---

### Task 6: 耐久條 UI（熱鍵欄 ＋ 背包面板 ＋ 合成來源列）

**Files:**
- Create: `src/ui/durbar.ts`、`src/ui/durbar.test.ts`
- Modify: `src/ui/hud.ts`、`src/ui/inventory.ts`、`src/ui/crafting.ts`、`src/ui/ui.css`、`src/ui/ui.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `currentDurability`／`maxDurability`。
- Produces:
  - `src/ui/durbar.ts`：
    ```ts
    import type { ItemStack } from '../core/items';

    /** 耐久條的比例（剩餘／上限）；非耐久物品 → 0。 */
    export function durabilityRatio(stack: ItemStack | null): number;
    /** 顏色門檻（見〈已查證與設計決策〉§5）：>0.5 綠／>0.25 黃／>0.1 橘／其餘紅。 */
    export function durabilityColor(ratio: number): string;
    /** 在格子裡掛／卸載耐久條（滿耐久的工具不顯示 —— 原版「Unused items do not display a durability bar」）。 */
    export function mountDurabilityBar(slot: HTMLElement, stack: ItemStack | null): void;
    ```
    DOM 形狀：`<div class="ui-dur"><span class="ui-dur-fill" style="width: 50%; background-color: #ffff00" data-dur-color="#ffff00"></span></div>`
    （`width` 為 `Math.round(ratio * 100)` 百分比；顏色另存一份在 `data-dur-color` 供測試讀取，不依賴 CSSOM 的顏色正規化。**2026-10-20 稽核修正：原範例寫 `background-color: rgb(255,255,0)` —— 那正是 jsdom 正規化後的樣子（同一份計畫的下一段又說「不要依賴它」）→ 易誤導實作者去斷言 `style.background`。範例改成實作真正寫入的值（`#ffff00`），並在旁註明「讀回時 jsdom 會正規化成 `rgb(...)`，所以測試一律讀 `dataset.durColor`」。）**
  - `src/ui/hud.ts`：`setHotbar` 每次重繪時呼叫 `mountDurabilityBar(s, stack)`；**`sameStack` 必須納入 `dur`**（否則耐久變了不會重繪）。
  - `src/ui/inventory.ts` / `src/ui/crafting.ts`：格子渲染時呼叫同一個 `mountDurabilityBar`。

- [ ] **Step 1: 寫測試（失敗）**

  **新建 `src/ui/durbar.test.ts`（jsdom）：**
  - `'the ratio is the remaining durability over the maximum'`：
    ```ts
    expect(durabilityRatio({ item: 'iron_pickaxe', count: 1, dur: 125 })).toBe(0.5);
    expect(durabilityRatio({ item: 'iron_pickaxe', count: 1, dur: 250 })).toBe(1);
    expect(durabilityRatio({ item: 'stone', count: 1 })).toBe(0);
    expect(durabilityRatio(null)).toBe(0);
    ```
  - `'the color follows the four-step threshold table'`：
    ```ts
    expect(durabilityColor(1)).toBe('#00ff00');
    expect(durabilityColor(0.51)).toBe('#00ff00');
    expect(durabilityColor(0.5)).toBe('#ffff00');
    expect(durabilityColor(0.26)).toBe('#ffff00');
    expect(durabilityColor(0.25)).toBe('#ff8000');
    expect(durabilityColor(0.11)).toBe('#ff8000');
    expect(durabilityColor(0.1)).toBe('#ff0000');
    expect(durabilityColor(0)).toBe('#ff0000');
    ```
  - `'an unused tool shows no durability bar'`（滿耐久＝未使用過）：
    ```ts
    const slot = document.createElement('div');
    mountDurabilityBar(slot, { item: 'iron_pickaxe', count: 1, dur: 250 });
    expect(slot.querySelector('.ui-dur')).toBeNull();
    ```
  - `'a damaged tool shows a bar with the remaining width and color'`：
    ```ts
    const slot = document.createElement('div');
    mountDurabilityBar(slot, { item: 'iron_pickaxe', count: 1, dur: 125 });
    const fill = slot.querySelector('.ui-dur-fill') as HTMLElement;
    expect(fill.style.width).toBe('50%');
    expect(fill.dataset.durColor).toBe('#ffff00');
    ```
  - `'a non-durable item shows no bar'`：`mountDurabilityBar(slot, { item: 'stone', count: 1 })` → `.ui-dur` 為 null。
  - `'mounting twice does not stack bars'`：連呼叫兩次 → `slot.querySelectorAll('.ui-dur').length === 1`。
  - `'mounting a fresh stack removes the old bar'`：先掛受損的、再掛滿耐久的 → `.ui-dur` 為 null。

  **`src/ui/ui.test.ts` 追加：**
  - `'the hotbar shows a durability bar for a damaged tool'`：
    ```ts
    hud.setHotbar([{ item: 'iron_pickaxe', count: 1, dur: 125 }], 0);
    const fill = root.querySelector('.ui-dur-fill') as HTMLElement;
    expect(fill.style.width).toBe('50%');
    ```
  - `'the hotbar re-renders when only the durability changes'`（**`sameStack` 納入 `dur` 的證據**）：
    ```ts
    const list: Array<ItemStack | null> = [{ item: 'iron_pickaxe', count: 1, dur: 200 }];
    hud.setHotbar(list, 0);
    const before = (root.querySelector('.ui-dur-fill') as HTMLElement).style.width;
    list[0] = { item: 'iron_pickaxe', count: 1, dur: 100 };   // 同一個 item/count，dur 不同
    hud.setHotbar(list, 0);
    const after = (root.querySelector('.ui-dur-fill') as HTMLElement).style.width;
    expect(after).not.toBe(before);
    expect(after).toBe('40%');
    ```
  - `'the inventory panel shows a durability bar for a damaged tool'`（用 B5 的 36 格 `slots` 開生存面板 → 查 `.ui-dur-fill`）。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/ui/durbar.test.ts src/ui/ui.test.ts`
  Expected: FAIL（`src/ui/durbar.ts` 不存在；HUD 不畫耐久條）。

- [ ] **Step 3: 實作 `src/ui/durbar.ts`**

  **（2026-10-20 稽核修正：原計畫把整支 `durbar.ts` 的原始碼貼進計畫 → 違反公約 §5「計畫以決策為主體」。改成「決策表 ＋ DOM 合約 ＋ 關鍵片段」；實作者的程式碼長相由下表決定。）**

  | 匯出 | 決策 |
  |---|---|
  | `DURABILITY_COLORS` | `{ green: '#00ff00', yellow: '#ffff00', orange: '#ff8000', red: '#ff0000' }`（四段門檻，見〈已查證與設計決策〉§5） |
  | `durabilityRatio(stack)` | `stack` 為 null／非耐久物品 → `0`；否則 `currentDurability(stack) / maxDurability(stack.item)`（0..1） |
  | `durabilityColor(ratio)` | 非有限值 → 紅；`> 0.5` → 綠；`> 0.25` → 黃；`> 0.1` → 橘；其餘 → 紅（**邊界值屬於較低的一階**：`0.5` → 黃） |
  | `mountDurabilityBar(slot, stack)` | ① 先移除既有的 `.ui-dur`（冪等、可重複掛載）；② `stack` 為 null 或非耐久物品 → 不掛；③ `ratio >= 1`（滿耐久＝未使用過）→ **不掛**（原版「Unused items do not display a durability bar」）；④ 否則建立 `<div class="ui-dur"><span class="ui-dur-fill" style="width: N%; background-color: <色碼>" data-dur-color="<色碼>"></span></div>` 掛到 `slot` 上（`N = Math.round(ratio * 100)`） |

  關鍵片段（決定行為的部分）：
  ```ts
  export function mountDurabilityBar(slot: HTMLElement, stack: ItemStack | null): void {
    slot.querySelector('.ui-dur')?.remove();           // 先清掉舊的（冪等）
    if (!stack || !isDurableItem(stack.item)) return;    // 非耐久物品 → 沒有條
    const ratio = durabilityRatio(stack);
    if (ratio >= 1) return;                             // 滿耐久＝未使用過 → 不顯示（原版行為）
    const track = document.createElement('div');
    track.className = 'ui-dur';
    const fill = document.createElement('span');
    fill.className = 'ui-dur-fill';
    fill.style.width = `${Math.round(ratio * 100)}%`;
    fill.style.backgroundColor = durabilityColor(ratio);
    fill.dataset.durColor = durabilityColor(ratio);      // 測試與除錯用（不依賴 CSSOM 的顏色正規化）
    track.appendChild(fill);
    slot.appendChild(track);
  }
  ```
  註解寫明 wiki 依據與「原版是連續 HSV 漸層，本作是四段門檻」的簡化說明。
  **顏色斷言不要讀 `style.background`**（jsdom 的 CSSOM 會把色碼正規化成 `rgb(...)`，值不穩定）→ 一律讀 `fill.dataset.durColor`。

- [ ] **Step 4: 接上三個 UI 面板**

  - `src/ui/hud.ts`：
    - `sameStack` 改為同時比較 `dur`：
      ```ts
      return a.item === b.item && a.count === b.count && (a.dur ?? null) === (b.dur ?? null);
      ```
    - `setHotbar` 的重繪迴圈裡，在 `drawSlotIcon` 之後呼叫 `mountDurabilityBar(s, stack)`。
      **注意**：現況是「變化才重繪」（`if (sameStack(...)) continue;`）→ 因為 `sameStack` 已納入 `dur`，耐久變化會觸發重繪 ✓。
  - `src/ui/inventory.ts`：`fillIcon(slot, item)` 改成能拿到整個 stack 的版本（`fillIcon(slot, stack)`），渲染圖示後呼叫 `mountDurabilityBar(slot, stack)`；生存面板的每格與創造清單的每格都走它（非工具不受影響）。
  - `src/ui/crafting.ts`：`fillSlot(slot, stack)` 在 append canvas/count 之後呼叫 `mountDurabilityBar(slot, stack)`（合成格與來源列都會有條）。
  - `src/ui/ui.css` 新增：
    ```css
    .ui-dur {
      position: absolute;
      left: 3px;
      right: 3px;
      bottom: 3px;
      height: 3px;
      background: #000;
      pointer-events: none;
    }
    .ui-dur-fill { display: block; height: 100%; }
    ```

- [ ] **Step 5: 跑測試轉綠**

  Run: `npx vitest run src/ui/durbar.test.ts src/ui/ui.test.ts src/ui/crafting.test.ts`
  Expected: PASS（既有 UI 測試一個不少——`crafting.test.ts` 的 `.ui-slot` 計數斷言不受影響，`.ui-dur` 是格子的子節點）。

- [ ] **Step 6: 全量驗證＋人工**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。
  人工（記錄結果）：用受損的木鎬 → 熱鍵欄該格下方出現細條（綠→黃→橘→紅隨損耗變化）；按 E → 背包面板對應格也有條；用新工具（滿耐久）→ 沒有條。

- [ ] **Step 7: Commit**

  ```bash
  git add src/ui/durbar.ts src/ui/durbar.test.ts src/ui/hud.ts src/ui/inventory.ts src/ui/crafting.ts src/ui/ui.css src/ui/ui.test.ts
  git commit -m "feat(ui): B7 耐久條（熱鍵欄／背包／合成來源列共用 helper；滿耐久不顯示；顏色四段門檻）"
  ```

---

### Task 7: 0.10.0 發布

**Files:**
- Modify: `package.json`、`game.json`、`README.md`、`.github/workflows/release.yml`（若上游模板有變動才動）
- Create: `docs/releases/v0.10.0.md`

**Interfaces:**
- Consumes: Task 1–6 全部。
- Produces: tag `v0.10.0` 與 GitHub Release（CI 產生）。

- [ ] **Step 1: 版本 bump**

  `package.json` `"version": "0.10.0"`；`game.json` `"version": "0.10.0"`（`id` 不動；`cloudSave` 維持 Task 3 的 `{ "readableFormats": [1, 2, 3], "writeFormat": 3 }`）。

- [ ] **Step 2: README 更新（照 spec §跨批次與 §6）**

  - `## 遊戲特色`：
    - **生存模式**段補一條「**工具耐久**：木／石／鐵／金／鑽工具各有耐久（木 59／石 131／鐵 250／金 32／鑽 1561）；**挖完一格方塊或命中一次攻擊各扣 1**；歸零即壞（工具消失＋損壞音效）；熱鍵欄與背包面板顯示耐久條（綠→黃→橘→紅）。創造模式的工具耐無限。」
    - **存檔**段：「本機 payload 升 **v5**（堆疊帶 `dur`；v1／v2／v3／v4 照讀並遷移，舊存檔裡的工具載入後是滿耐久）」。
    - **雲端進度**段：「雲端格式版本 **3**（可讀 1、2、3）；**舊版（0.9.0）讀不到 format 3，平台會擋下不相容的回退**」。
  - `## 與原版的差異`（**新增／修正本批的每一項**）：
    - 「**工具耐久**：有耐久值與耐久條，但**沒有修補／鐵砧／熔修／Mending 附魔**（工具用完就沒了）。」
    - 「**攻擊消耗簡化**：原版鎬／斧／鏟打生物扣 2 耐久、劍挖方塊扣 2 耐久；本作一律 −1（挖完 −1、命中 −1）。」
    - 「**耐久條是簡化樣式**：原版是貼在物品圖示下緣的漸層 3D 疊圖，本作是一條黑底細條＋四段顏色門檻（綠／黃／橘／紅）。」
    - 「**工具損壞音效是程序合成**的近似音（原版 `entity.item.break` 取樣）。」
    - 既有「工具無修補（無鐵砧，B7 明示）」**改寫**為上面的「工具無修補」條目（耐久已實作，只剩修補沒有）。
    - 末段「光照／火把、容器、耐久、苦力怕蜘蛛已排入 B6–B9…」→ 改為把「耐久」從待辦名單移除（其餘 B6／B8／B9 項目照留）。
  - `## 操作` 表格：左鍵說明補「（挖完／命中會消耗工具耐久）」。
  - `# Test` 段的測試數字更新為實測值（本批新增測試後的總數／檔案數）。
  - `# 專案狀態` 補一行 B7 的摘要（0.10.0：工具耐久 ＋ 耐久條 ＋ payload v5 ＋ 雲端 format 3）。

- [ ] **Step 3: 發布說明 `docs/releases/v0.10.0.md`**

  固定四段（中文）：`## 新增`／`## 修正`／`## 存檔格式與相容性提示`／`## 已知問題`。
  - **新增**：工具耐久（木 59／石 131／鐵 250／金 32／鑽 1561，20 把工具）；熱鍵欄與背包面板的耐久條；工具損壞音效與「工具損壞」toast。
  - **修正**：本批沒有改既有的非原版行為（耐久是純新增）→ 這段寫「（本批無既有行為修正）」並說明「攻擊消耗簡化為 −1（見已知問題）」。
  - **存檔格式與相容性提示**（**本批最重要的一段，寫在最前面**）：
    1. 本機 payload 升 **v5**（堆疊可帶 `dur`）；v1／v2／v3／v4 舊存檔照讀並遷移，**舊存檔裡的工具載入後是滿耐久**（不會一拿出來就壞）。
    2. 雲端格式升 **3**（`readableFormats:[1,2,3]`、`writeFormat:3`）；舊的 format 1／2 雲端進度會在讀入時自動遷移（工具補上滿耐久），下一次檢查點即以 format 3 寫回。
    3. **回退限制**：0.10.0 寫出的雲端資料是 format 3，**0.9.0（只宣告可讀 format 1、2）讀不到** → 平台會以 `SAVE_FORMAT_INCOMPATIBLE` 擋下不相容的回退。要回到 0.9.0 必須先在 0.10.0 重新開局（雲端槽會被改寫）。
  - **已知問題**：攻擊消耗簡化（鎬／斧／鏟打生物原版 −2、劍挖方塊原版 −2，本作一律 −1）；無修補／鐵砧／熔修／Mending；耐久條是簡化樣式（四段門檻而非漸層）；損壞音效是程序合成的近似音；雲端回退限制（見上）。

- [ ] **Step 4: release workflow 的 notes 檔支援（**核對**）**

  **先重讀上游模板**（AGENTS.md §1 清單的 `game-release.yml`；若模板已改動，以模板為準並調整本步驟）。
  **（2026-10-20 稽核修正：原步驟的前提是「若模板仍為 `gh release create … --generate-notes` 就改成 notes 檔版」——但 repo 的 `.github/workflows/release.yml:102-106` **已經是** `--notes-file` 版 → 該步驟沒有待辦。現在改成「核對（已是 notes-file 版則不動）」：**）**
  - 核對 `.github/workflows/release.yml` 的 `gh release create` 呼叫：**若已使用 `--notes-file "docs/releases/$RELEASE_TAG.md"` → 本步驟不動**（只在下述檢查有落差時才改）。
  - 若仍是 `--generate-notes`（上游模板被改回去）→ 改成 B1 Task 10 的寫法：
    ```yaml
          NOTES_ARGS=(--generate-notes)
          if [ -f "docs/releases/$RELEASE_TAG.md" ]; then
            NOTES_ARGS=(--notes-file "docs/releases/$RELEASE_TAG.md")
          fi
          gh release create "$RELEASE_TAG" "$GAME_ZIP" --repo "$RELEASE_REPO" --verify-tag "${NOTES_ARGS[@]}" --prerelease="$RELEASE_PRERELEASE"
    ```
  - （workflow 的其餘檢查——tag 對版本、工具 sha256、pack＋validate——全部保留；**不得出現 job 層 `runner`**。）

- [ ] **Step 5: 全量 gates**

  Run: `npm run typecheck && npm test && npm run build && npm run lint`
  Expected: 全綠（既有 806 tests 一個不多、一個不少；本批新增的測試全數通過）。

- [ ] **Step 6: 固定工具 pack＋validate（ZIP 驗證）**

  ```bash
  sha256sum .playroom/tools/playroom-game-tools-1.1.0.zip   # 必須等於 .playroom/game-tools.lock.json 的 sha256
  mkdir -p /tmp/opencode/playroom-tools /tmp/opencode/playroom-release
  python3 -m zipfile -e .playroom/tools/playroom-game-tools-1.1.0.zip /tmp/opencode/playroom-tools
  cd /tmp/opencode/playroom-tools
  node pack-game.mjs "$OLDPWD/dist" /tmp/opencode/playroom-release/game.zip
  node validate-game.mjs /tmp/opencode/playroom-release/game.zip
  ```
  Expected: 兩個工具都成功、validate 全過（本機沒有 `unzip`，用 `python3 -m zipfile`）。

- [ ] **Step 7: Commit（分支上；不 tag、不 push）**

  ```bash
  git add -A
  git commit -m "chore(release): 0.10.0"
  ```
  本計畫在 `b7-durability` 分支執行：tag 與 push 屬整支完成後的整合步驟——merge 回 master 後才 `git tag -a v0.10.0 -m "0.10.0: B7 工具耐久"`＋`git push origin master`＋`git push origin v0.10.0`，由 controller 依 finishing-a-development-branch 流程執行。

- [ ] **Step 8: 驗證 CI Release**

  以 `webfetch https://github.com/TommyLamm/WeCraft/releases/tag/v0.10.0` 確認 release 存在、asset 已附、說明為 `docs/releases/v0.10.0.md` 內容。回報照 AGENTS.md 四段式：程式完成／ZIP 驗證／Release（CI 結果）／平台上架（若屬平台操作，向使用者確認後再按）。**並在回報中明寫「雲端 format 3 的回退限制」**（平台端上架後，0.9.0 的雲端槽會變成 format 3）。

- [ ] **Step 9: Commit（收尾）**

  若 Step 8 有任何補正（文件錯字、notes 檔更新），再一顆 commit；無則略過。

---

## 批末驗收

（spec §B7「驗收：耐久遞減與歸零測試；存檔與雲端往返；UI 顯示」＋公約 §6。）

- **gates**：`npm run typecheck` ／ `npm test` ／ `npm run build` ／ `npm run lint` 全綠；既有 806 tests／51 files 一個不多、一個不少。
- **耐久遞減與歸零（Task 1／5 的單元測試）**：
  - 耐久表 20 把工具逐一對到 wiki 數值（木 59／石 131／鐵 250／金 32／鑽 1561）。
  - `damageStack` 的 −1、歸零回報 `broke`、非耐久物品不動、金額 ≤ 0／非有限不改。
  - 清洗規則：合法值保留／超界夾到上限／負數·NaN·小數清除後視為滿耐久／非耐久物品無 `dur`。
- **存檔往返（Task 2）**：本機 v1／v2／v3／v4 → v5 全部可讀；舊記錄的工具載入後 `dur` ＝ 上限；`dur` 為 59／137 的工具往返後數值不變；**存檔前用 live 槽位同步 stash —— 本機 `sessionSavePayload()` 與雲端 `saveCloudNow()` 兩條路徑都同步**（壞掉的工具不會在模式往返**或雲端讀取**後復活；`saveModeState` 的語意有單元測試 ＋ 人工步驟佐證）。
- **雲端往返（Task 3）**：format 1／2 讀入自動遷移（**槽位補 null／截斷到 36 格** ＋ 工具補上滿耐久）→ 本批**不得**取代 B5 的 `migrateInventorySlots`；`buildCloudData` 帶著 `dur`；`game.json` 的 `writeFormat`／`readableFormats` 與程式常數一致（測試守住）。
- **UI 顯示（Task 6）**：熱鍵欄、背包面板、合成來源列的耐久條；滿耐久的工具沒有條；顏色四段門檻；**耐久只變時 HUD 會重繪**（`sameStack` 納入 `dur`）。
- **人工走查（Task 5／6，記錄結果）**：木鎬挖石頭 → 每挖完一格 −1；打殭屍命中 −1、落空不扣；扣到 0 → 工具消失＋音效＋toast；創造模式不扣；Q 丟出受損工具再撿回仍是受損的。
- **`pack-game` ＋ `validate-game`**：固定工具（SHA-256 與 lock 一致）兩個都過。
- **README 與發布說明**：〈與原版的差異〉涵蓋本批的所有刻意簡化（攻擊 −1、耐久條樣式、合成音效）；發布說明四段齊全、**雲端格式升版與回退限制寫在最前面**。
- **不動輸入路由**：本批不碰 `Esc`／pointer lock／全螢幕 → **不需 Playwright**；若實作者順手改了這些，必須補 Playwright 驗收（`xvfb-run` headful，probe 腳本放 repo 外）並把 Ctrl+W 等瀏覽器保留鍵情境列為未驗證。

---

## 與公約／spec 的差異

1. **攻擊消耗一律 −1（spec §B7 的「破壞方塊與攻擊各 −1」優先於原版的分工具規則）**：已查證（minecraft.wiki/Durability，2026-10-20）原版是「鎬／斧／鏟打生物 = 2 uses、劍打生物 = 1 use、劍挖方塊 = 2 uses、鎬／斧／鏟挖方塊 = 1 use」。本批依 spec 統一為 −1／−1，兩處差異寫進 README〈與原版的差異〉與發布說明〈已知問題〉。**未採用「照原版分工具」的理由**：spec §B7 明文寫「各 −1」，spec 優先；且分工具規則需要另一張表與更多測試，收益不抵偏離 spec 的風險。
2. **耐久條是簡化樣式（四段門檻）**：原版是連續 HSV 漸層（wiki 只描述「綠→黃→橘→紅」的質性行為，沒有給門檻數值）。本批自訂四段門檻（>0.5 綠／>0.25 黃／>0.1 橘／其餘紅）並在 README 明示為簡化。**滿耐久的工具不顯示條**（wiki: "Unused items do not display a durability bar"）——這是照原版，不是簡化。
3. **損壞音效是程序合成的近似音**：原版是 `entity.item.break` 取樣（wiki: 音量 0.8、pitch 0.8–1.2、衰減距離 16）；本作音訊全為 WebAudio 合成 → 新增一個固定參數音色 `tool_break`（低通 500 Hz／0.25 s／gain 0.8）。README 明示。
4. **沒有「0.5% 掉落」機制**：原版工具損壞時直接消失、不掉任何東西（wiki: "When the durability is empty, the item is about to be destroyed"）。spec 裡的 0.5% 屬 B4 的「樹葉 0.5% 掉蘋果」，與本批無關 —— 本批明確定案：**損壞的工具不產生掉落物**。
5. **額外修正 B1 的 stash 與 live inventory 不同步**：B1 的 `stash` 只在切模式時快照，存檔寫的是快照 → 壞掉的工具會在「生存→創造→生存」往返後復活。本批在 **`main.ts` 的存檔路徑**補一個共用步驟 `syncModeStash()`（`modeStash = saveModeState(modeStash, currentMode, slots, vitals)`，與切模式時同一個動作），並在**本機 `sessionSavePayload()` 與雲端 `saveCloudNow()` 兩處都呼叫**（**2026-10-20 稽核修正：原設計只接本機路徑 → 雲端檢查點寫出的 stash 仍是舊快照 → 壞掉的工具從雲端復活**）；`saveModeState` 本身不變（既有語意與測試不動），另在 `mode-stash.test.ts` 加一個案例釘死「記錄模式那一側被 live slots 覆寫」。**刻意不動 `collectSavePayload` 的契約**（既有測試刻意傳入非標準 stash 並斷言「payload 照抄」，改了就是弱化）。
6. **本批不動 `ItemStack` 以外的形狀**：`ItemStack` 只多一個可選欄位 `dur?: number`；`STACK_ONE`（工具堆疊 1）不變；`INVENTORY_SLOTS`（36 格）不變。
7. **B8 相容性（主動註記）**：B8 的容器內容會序列化 `ItemStack`。本批的不變式「耐久物品的堆疊必然帶明確 `dur`、非耐久物品必然沒有」讓 B8 **不需要額外改動**即可正確序列化／遷移容器內容的工具耐久（`sanitizeSlots` 已在清洗路徑上）。B8 若要另加欄位，須沿用同一條不變式。
8. **本批不做修補／鐵砧／熔修／Mending**：spec §B7 明示「無修補／鐵砧／附魔」；wiki「Item repair」頁列的合成修補、grindstone、anvil、Mending 全部不實作（README〈與原版的差異〉既有「工具無修補」條目保留並改寫）。
9. **`dur` 的語意是「剩餘耐久」**（不是「已消耗量」）：wiki 的介面段是「The remaining durability …」，耐久條由綠漸變到紅也是以剩餘比例為準。本計畫據此命名欄位為 `dur`（剩餘）並讓 `dur = max` 表示全新。

---

## Self-Review 記錄

- **Spec coverage**：spec §B7 第 1 條（耐久值依 wiki、破壞與攻擊各 −1、歸零即壞消失＋音效）→ Task 1（耐久表 ＋ `damageStack`）＋ Task 5（接線 ＋ 損壞音效 ＋ toast）＋〈已查證與設計決策〉§1–§4；第 2 條（`ItemStack` 增加可選 `dur`；本機與雲端 payload 升版、readable 累積；HUD 與背包顯示耐久條）→ Task 1（`ItemStack.dur` ＋ 清洗規則）＋ Task 2（本機 v5 ＋ 遷移）＋ Task 3（雲端 format 3 ＋ `game.json`）＋ Task 6（耐久條）；第 3 條（無修補／鐵砧／附魔、工具堆疊仍為 1）→〈Global Constraints〉＋ **Task 1 Step 2 新增的測試 `'tools still stack to one'`**（`expect(maxStack('wooden_pickaxe')).toBe(1)` 等 20 把逐一；既有證據：`items.test.ts:96` `'maxStack is 1 for tools and weapons'` ＋ B5 的 `STACK_ONE` 擴充到 20 把）；第 4 條（驗收：耐久遞減與歸零測試、存檔與雲端往返、UI 顯示）→〈批末驗收〉＋ Task 1／2／3／5／6 的測試。發布（版本 0.10.0、README、四段說明、pack＋validate、commit）→ Task 7。與 B8 的相容 →〈差異〉第 7 條 ＋ Task 1 的不變式。
**（2026-10-20 稽核修正：原 Self-Review 宣稱第 3 條（工具堆疊仍 1）由「Task 1 Step 1（`STACK_ONE` 不動）」覆蓋，但 Task 1 Step 1 只查工具 id 清單、**沒有 `STACK_ONE` 項** → 改成上面那條明確的測試，並在 Task 1 Step 2 補上它的寫法。）**
- **型別一致**：`ItemStack.dur?: number`（Task 1 產出，Task 2／3／4／5／6 消費）；`TOOL_MAX_DURABILITY`／`maxDurability`／`isDurableItem`／`currentDurability`／`normalizeDurability`／`damageStack`／`DurabilityResult`（Task 1 產出，Task 2／3／5／6 消費）；`SavePayloadV5`／`version: 5`（Task 2 產出，Task 7 消費）；`CLOUD_FORMAT_VERSION = 3`／`CLOUD_READABLE_FORMATS = [1,2,3]`／`isReadableCloudFormat`（Task 3 產出，與 `game.json` 對齊）；`DropEntity.dur?`／`SpawnDropOptions.dur?`（Task 4 產出，Task 5 消費）；`SoundKind` 的 `'tool_break'`／`TOOL_BREAK_PARAMS`（Task 5 產出，main.ts 消費）；`durabilityRatio`／`durabilityColor`／`mountDurabilityBar`（Task 6 產出，hud／inventory／crafting 消費）。名稱與公約 §3 的版本表一致（本機 v5、雲端 format 3、readable [1,2,3]）。
- **Review Focus→測試**：逐條已掛在 Task 1／2／3（舊資料不壞掉）、Task 1（清洗器與模型都會洗掉 `dur`）、Task 6（`sameStack` 只比 item/count）、Task 2（壞掉的工具在模式往返後復活）、Task 4（地上的工具撿回來洗白）、Task 5＋Task 1（歸零時熱鍵列與主背包都要清）、Task 3＋Task 7（回退限制公告）。
- **步驟掃描**：每個 Task 都是「讀現況／寫失敗測試 → 跑（紅）→ 實作 → 跑（綠）→ 全量 gates → commit」；沒有 TBD 與未定義型別；唯一的演算法段落（清洗規則與顏色門檻）已給出完整表格與期望值。
- **逐碼複核（寫完後讀現況再校對）**：`src/core/items.ts:121-140`（`sanitizeStack` 只回 `{item,count}`；`sanitizeSlots` 逐格委派）、`src/core/inventory.ts:61-81`（`addItem` 兩處新建堆疊）與 `:111-121`（`setSlot` 只留 item/count）、`src/core/inventory.ts:122-130`（`spendFromSlot` 只動 count → `dur` 自動保留）、`src/ui/hud.ts:81-87`（`sameStack` 只比 item/count）與 `:101-115`（變化才重繪）、`src/ui/inventory.ts:13-23`（`fillIcon` 只有 item）與 `src/ui/crafting.ts:50-63`（`fillSlot` 有整個 stack）、`src/world/drops.ts:28-37`（`DropEntity` 無 `dur`）與 `:194-209`（`pickup` 呼叫 `addItem(d.item, d.count)`）、`src/world/save.ts:44-50`（`SavePayloadV3` 為現行型別）與 `:120-150`（`isValidSavePayload` 收 v1–v3）、`:212-247`（`loadGame` 的遷移鏈 v1→v2→v3）、`src/core/cloud-save.ts:15`（`CLOUD_FORMAT_VERSION = 1`）與 `:160-186`（`acceptCloudData` 保留未知 id 字串）、`src/audio/sounds.ts:16`（`SoundKind` 四個成員）與 `:106-117`（`synthParams`）、`src/main.ts:204-205`（`hotbar` 活陣列）與 `:2083-2118`（攻擊命中分支）、`:2135-2178`（挖掘完成分支）、`src/core/mode-stash.ts:48-63`（`saveModeState` 的淺拷貝帶 `dur`）與 `:83-106`（`normalizeModeStash` 用 `sanitizeSlots`）。依此修正了：`setSlot`／`addItem` 的 materialize、`sameStack` 的 `dur`、掉落物與 Q 丟棄的 `dur`、存檔前的 stash 同步（main.ts 接線）。另在寫計畫時實讀 `src/world/save.test.ts:442-475` 與 `:538-563`，發現既有測試刻意傳入「非標準 stash」並斷言「payload 照抄」→ 因此**刻意不動 `collectSavePayload` 的契約**，把 stash 同步改放在 `main.ts` 的存檔路徑（見〈差異〉第 5 條）。
- **已知未測面**：`src/main.ts` 無測試（組裝根）——Task 4／5／6 的接線以人工步驟佐證並在回報中列「未自動化」；本批不動 iframe／pointer lock／全螢幕 → 不需 Playwright；音效只驗證**參數**（`synthParams`），實際聽感由人工步驟確認。
- **2026-10-20 終審修正摘要**（本計畫依最終跨計畫複核報告修正；修正點在正文以「（2026-10-20 終審修正：…）」標出）：
  1. **建議修正 #10（集中清單）**：Global Constraints 新增〈本批要改寫的既有測試（集中清單）〉——逐條列出「檔案＋既有測試＋改法＋理由」，讓 Task 1／2／3／6 的改寫指示可逐條複核（原來只散在各 Task 的 Step 1）。
