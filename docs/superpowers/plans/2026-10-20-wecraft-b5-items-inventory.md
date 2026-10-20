# WeCraft B5 方塊、物品與背包（0.8.0）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「物品欄只有寥寥幾種方塊」補成原版級的方塊／物品庫——**本批自己新增的 5 個方塊**（礫石／金礦／鑽石礦／雲杉板材／白樺板材）的物品形式、`raw_gold`／`gold_ingot`／`diamond`、金鑽鎬斧鏟劍與全套鏟、採掘等級表、31 份合成配方（含原版左右鏡像斧）、36 格背包（27 主＋9 熱鍵列＋2×2 合成，點擊選取→點擊放置）、創造模式可捲動全物品清單——並把本機存檔升 v4、雲端升 format 2，最後發布 0.8.0。（2026-10-20 稽核修正：B3 的 9 個方塊與 B4 的羊毛方塊**各自已由自己的批次補齊物品形式**，本批不重做；B5 對它們只做掉落／合成接線。）

**Architecture:** 純邏輯（物品表／配方／工具表／礦脈分佈／存檔遷移）放 `src/core`、`src/world`、`src/player`，以單元測試釘死；`src/ui` 只做 DOM（36 格面板、游標堆疊、創造可捲動清單）；`src/main.ts` 是未測的組裝根，只做接線。存檔採「本機逐版遷移（v1/v2/v3 → v4）＋雲端格式升版（1 → 2，readableFormats 累積 [1,2]）」：36 格語義改變了 `inventory` 的意義，所以雲端必須一次升版；`game.json` 的 `cloudSave` 同步更新，回退限制寫進發布說明與 README。

**Tech Stack:** TypeScript strict、Three.js、Vite、Vitest（jsdom 用於 UI）、IndexedDB（fake-indexeddb 測）、GitHub Actions release workflow。

**Spec:** `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`（§B5＝本批範圍，L219–241；跨批契約見 `/tmp/opencode/wecraft-planning/planning-conventions.md` §3–§7）

**執行方式:** SDD＋隔離 worktree，分支名 `b5-items-inventory`（在計畫標注即可，不用建 branch）。每個 Task 是最小可獨立審查單元（TDD 循環、可獨立 commit）；批次最後由 controller merge、打 tag、push。

---

## Global Constraints

（出自 spec §B5、§1、§2、公約 §3–§7 與 `AGENTS.md`；每個任務都隱含本節。）

- 每個任務結束：`npm run typecheck`、`npm test`、`npm run build` 全綠；`npm run lint` 維持乾淨；**既有 806 tests／51 files 不得刪除或弱化**（要改測試必須在 commit 訊息說明理由——**逐條清單見下方〈本批要改寫的既有測試（集中清單）〉**，本批有 **9** 個任務要改寫既有測試：Task 1（方塊資料表＋紋理層假設）、Task 2（物品表成長）、Task 3（攻擊傷害與鏟的非原版行為）、Task 4（配方表成長）、Task 5（熔爐食譜／燃料表的期望值）、Task 6（鐵礦深度帶 ＋ `WORLDGEN_VERSION`）、Task 7（背包形狀 9→36）、Task 8（背包面板結構與合成來源列）、Task 9（雲端格式 1→2），每一處都在該任務的 commit 訊息寫明理由）。
- **每個新方塊的「物品形式」由新增它的批次自己補**（2026-10-20 稽核修正：既有 `src/core/items.test.ts` 的「每個 block 都要有 item form」是不變量——`for (const id of Object.values(BLOCK)) { if (id === AIR || id === WATER) continue; expect(itemFromBlock(id)).not.toBeNull(); }`）：
  | 批次 | 新方塊 | 物品形式由誰補 |
  |---|---|---|
  | B3 | `SPRUCE_LOG` 17／`SPRUCE_LEAVES` 18／`BIRCH_LOG` 19／`BIRCH_LEAVES` 20／`DANDELION` 21／`POPPY` 22／`SHORT_GRASS` 23／`CACTUS` 24／`ICE` 25（9 個） | **B3 自己補**（9 個 `ItemId` ＋ `BLOCK_PAIRS` ＋ 圖示） |
  | B4 | `WOOL` 26（1 個） | B4 已補（`wool`） |
  | B5（本批） | `GRAVEL` 27／`GOLD_ORE` 28／`DIAMOND_ORE` 29／`SPRUCE_PLANKS` 30／`BIRCH_PLANKS` 31（5 個） | **本批補** |
  → **本批不得重做 B3 的 9 個方塊的物品形式**（那是 B3 的工作）；本批只補**自己新增的 5 個方塊**的物品形式（`gravel`／`gold_ore`／`diamond_ore`／`spruce_planks`／`birch_planks`）＋ 3 個原料（`raw_gold`／`gold_ingot`／`diamond`）＋ 11 把新工具 = **18 個新 `ItemId`**。B3 的方塊在本批只做**掉落／合成接線**（B3 的計畫把「草叢可拾取」明文交給 B5），不重做它們的 `ItemId`／`BLOCK_PAIRS`／圖示。
- **本批要改寫的既有測試（集中清單，2026-10-20 終審修正）**（**基數一律讀現況**：「基數」欄＝實作者在對應 Task 的 Step 1 讀到的當前值，並在該 Task 的 commit 訊息註明實際值；**不得照抄本表裡的括號數字當成要寫死的值**）：
  | 檔案 | 既有測試 | 改法 | 理由 |
  |---|---|---|---|
  | `src/world/blocks.test.ts` | `'requiredTool／fastTool data matches vanilla'` 窮舉表 | 補 5 列（本批 5 個新方塊） | 新 id 必須在表內（該表有窮舉守門斷言） |
  | `src/world/blocks.test.ts` | `'hardness table matches vanilla 1.20+ (Task 5)'` | 補 5 列硬度 | 資料表同步 |
  | `src/render/textures.test.ts` | `'drawn tiles keep their content; empty layers are opaque magenta #ff00ff'` 的洋紅層清單 | **只驗證、不改寫**（修復點在 B3；本批 `TILE_COUNT` → 39 後清單自動變 `[39, 40, 47, 63]`）。備援：上游仍是寫死值時由本批補改成與 B3 相同的 `[TILE_COUNT, TILE_COUNT + 1, 47, 63]` | 三批各寫各的會衝突 |
  | `src/core/items.test.ts` | `'ALL_ITEM_IDS is the canonical list: <N> entries…'` 的計數 | 改成 `<基數 + 18>`（基數＝現況 `ALL_ITEM_IDS.length`；上游 B3／B4 都落地時 54 → 72），測試標題的數字同步改 | 物品表成長，非弱化 |
  | `src/core/items.test.ts` | `'ItemId union covers every obtainable block item'` 的 `ALL_ITEMS.length` | 改成 `<基數 + 18>` | 同上 |
  | `src/core/items.test.ts` | 鏡像清單 `ALL_ITEMS` | 補本批缺的 id（本批 18 個；B3／B4 已補的不重複） | union 鏡像必須等於 `ALL_ITEM_IDS` |
  | `src/core/items.test.ts` | `'starterSlots is a full hotbar of nulls in survival…'`／`'…default block kit at max stacks in creative'` | 斷言改成 36 格 | 背包 9 → 36（形狀變更） |
  | `src/player/interact.test.ts` | `'pickaxes deal 2 (all tiers, iron included)'`／`'axes deal 3…'`／`'swords: wooden 4, stone 5, iron 6 (one tier step each)'` | 改寫成對齊原版的表驅動斷言 | 原表非原版行為 |
  | `src/player/interact.test.ts` | `'shovel-fast blocks have no shovel item yet → 1× with anything'` | 改寫成鏟有物品後的斷言 | 前提消失 |
  | `src/core/recipes.test.ts` | `'holds exactly the <M> settled recipes, no extras'` 的計數 | 改成 `<M + 18>`（M＝現況 `RECIPES.length`；**B2–B4 都沒有改過 `src/core/recipes.ts`**，所以若 B5 尚未落地時 M 是 13 → 31） | 配方表成長，非弱化 |
  | `src/core/recipes.test.ts` | `'result counts: planks 4, stick 4, table 1, tools 1, furnace 1'` | 補 `spruce_planks`／`birch_planks` 產出 4 個 | 新配方 |
  | `src/world/furnace.test.ts` | `'smelt takes 10 s; raw_iron/iron_ore→iron_ingot and sand→glass; coal_ore excluded'` 的 `toEqual` | 以 **B4 落地後**的實際食譜／燃料表為基準更新 | B4 已加 4 條生肉食譜並把燃料值改小數 |
  | `src/world/terrain.test.ts` | `'contains coal and iron ore'` | 改寫為 `'contains coal, iron, gold, diamond and gravel'` | 新礦石 |
  | `src/world/worldgen.test.ts` | `'the worldgen version is 1'` | 改成 2 | B5 改了地形外觀（`WORLDGEN_VERSION` 1 → 2） |
  | `src/world/save.test.ts` | v1／v2／v3 遷移案例、`makePayload()` fixture、`'rejects a record with an unsupported version'`、`'accepts a fully valid payload…'` | 版本 3 → 4、斷言補 36 格 | payload v3 → v4（形狀升版） |
  | `src/core/cloud-save.test.ts` | `'exposes format version 1 and a 64 KiB cap'`、`'acceptCloudData derives stash from legacy fields when absent'` | 改成 format 2、`readableFormats [1,2]`、stash 36 格 | 雲端 format 1 → 2 |
  | `src/ui/ui.test.ts` | `'gives each duplicate stack its own icon canvas (shared-icon regression)'` | 改寫選擇器為 `.ui-inv-bar .ui-slot`（新面板的 class） | 面板 DOM 換 class |
  | `src/ui/crafting.test.ts` | 既有案例的 `hotbar:` 參數名 | 改成 `slots:` | 介面改名 |
- 版本：本批發布 `0.8.0`；`package.json` 與 `game.json` 同步；tag 為 `v0.8.0` 且指向含 bump 的 commit；不覆寫已發布版本；`id` 固定 `wecraft`。
- 存檔：**本機 payload 升 v4**（36 格背包語義：熱鍵列＝前 9 格，其餘 27 格為主背包）；v1／v2／v3 必須照讀遷移（舊 9 格 → 熱鍵列，其餘留空）。**雲端 format 升 2**：`game.json` 的 `cloudSave` 改為 `{ "readableFormats": [1, 2], "writeFormat": 2 }`；`readableFormats` 只累積、不縮。
- **回退限制（升版後的既定後果）**：0.8.0 寫出的雲端資料是 format 2；0.7.0 只宣告 `readableFormats:[1]`，**讀不到 format 2** → 平台會擋不相容回退。此點必須寫進 `docs/releases/v0.8.0.md` 與 README（spec §B5.4／§5.11 明定）。
- **方塊 id 只能往後追加**：既有 id（0–16）不得重編號——舊存檔的 `modified` 記錄的是數字 id。B5 的新 id 必須接在 B1–B4 已用過的最大值之後（見〈已查證與設計決策〉§8 的配置規則與跨批衝突處理）。
- 原版基準：Minecraft Java Edition 1.20+；數值以本計畫〈已查證與設計決策〉為準（逐條引 wiki，見該節）。
- **不動 `Esc`／iframe／pointer lock／全螢幕既有路由**；本批不新增輸入鍵（背包面板用滑鼠左／右鍵，不碰鍵盤）。
- 工具**耐久不在本批**（B7 才加 `dur`）；本批所有工具堆疊仍為 1（沿用現況 `STACK_ONE`）。
- **批次順序前提（2026-10-20 稽核修正：原計畫只寫在 Task 5 的敘述裡，沒升級成全域約束）**：本批**必須在 B4 之後實作**（燃料值 1.5／0.5 是 B4 校正後的原版值，`FUEL_VALUES` 現況仍是整數 2）。若 B4 尚未落地 → **Task 5 的燃料斷言不得先寫成 1.5**（那會在 B4 落地後變成紅燈），實作者必須**先等 B4**（或把 Task 5 的燃料部分排在 B4 之後），**不得自行定一個中間值**（否則同一批內兩個批次的燃料值不一致）。同理，本批的物品表基數假設 B3／B4 已落地（見 Task 2 Step 1 的核對步驟）。
- 發布候選跑固定工具：`.playroom/tools/playroom-game-tools-1.1.0.zip`（先驗 `sha256` 與 `.playroom/game-tools.lock.json` 一致）＋ `pack-game.mjs`＋`validate-game.mjs`；本機無 `unzip`，用 `python3 -m zipfile`。
- 本批改動到的「Minecraft parity」宣稱（挖掘、掉落、存檔格式、背包結構）要同步校正（各任務自己處理碰到的段落，Task 10 收斂 README）。
- 註解與文件用繁體中文（台灣用語）；識別字與程式碼英文。
- **行號基準**：`master @ b11273f`（0.4.0）。本計畫的行號以該基準為準；B3／B4 落地後 `src/main.ts`、`src/world/blocks.ts`、`src/core/items.ts` 的行號會位移，後續任務以「當時檔案內容」為準（用錨點／程式碼片段定位，不要照抄行號）。

---

## Review Focus

（spec 沒明說、但最可能咬人的失敗模式；每一條都已在對應任務放測試。）

1. **36 格遷移不能吃掉舊資料**：舊 9 格資料必須落在**熱鍵列（前 9 格）**、其餘 27 格留空——不是被截斷、也不是被搬到主背包。存檔 v4、雲端 format 1→2、模式 stash（每模式 36 格）三條路徑都要一致 → Task 7（v4 遷移測試 ＋ stash 寬度）、Task 9（雲端 format 1 讀入測試）。
2. **游標堆疊絕不能吞物品**：面板關閉時游標上的堆疊必須回到背包；背包滿時餘量要留著（下次開面板還在），不能消失、不能複製 → Task 8（`onReturnCursor` 測試＋「關閉面板後物品總數不變」測試）。
3. **新工具的等級門檻不能放水**：金礦／鑽石礦必須鐵鎬以上（level 2）才收穫；石鎬挖金礦＝×5 且不掉落。既有 B1.6 的「木鎬挖鐵礦」行為不能被新表破壞 → Task 3（表驅動的 `canHarvest`／`getBreakTime`／掉落測試）。
4. **斧頭鏡像配方要真的成立**：左右兩種排法都要能做出同一把斧；且「鏡像排法」不能被現有的 bbox 位移匹配誤判成同一份（否則測試會假綠） → Task 4（左／右排法各自的正例＋交叉反例）。
5. **礦脈深度分佈必須是統計性質、不是抽樣運氣**：金礦的峰值高度、鑽石「越深越常見」的單調性、帶外零生成，都要由固定種子的統計測試釘死；實作者不得為了讓測試變綠而放寬容差 → Task 6（`ores-stats.test.ts`）。
6. **回退限制必須誠實公告**：0.8.0 寫出的雲端是 format 2，0.7.0 讀不到；README 與發布說明若沒寫，玩家會在回退時被平台的 `SAVE_FORMAT_INCOMPATIBLE` 擋住卻不知原因 → Task 9（`game.json` 與程式常數一致）、Task 10（發布說明四段＋README）。

---

## 已查證與設計決策

（公約 §7 B5 查證清單的結果；引註格式：`已查證（minecraft.wiki/<Page>，2026-10-20）`。抓不到原文者寫「實作時複核」。）

### 1. 工具速度、採掘等級與攻擊傷害（Java 1.20+）

- 已查證（minecraft.wiki/Pickaxe，2026-10-20）：mining efficiency ＝ 木 2／石 4／銅 5／鐵 6／鑽 8／下界合金 9／**金 12**；mining level ＝ 木與金 0／石 1／鐵 2／鑽 3／下界合金 4。
- 已查證（minecraft.wiki/Axe，2026-10-20）：mining efficiency ＝ 木 2／石 4／鐵 6／鑽 8／**金 12**；攻擊傷害 Java ＝ 木 7／金 7／石 9／鐵 9／鑽 9。
- 已查證（minecraft.wiki/Shovel，2026-10-20）：mining efficiency ＝ 木 2／石 4／鐵 6／鑽 8／**金 12**；攻擊傷害 Java ＝ 木 2.5／金 2.5／石 3.5／鐵 4.5／鑽 5.5。
- 已查證（minecraft.wiki/Sword，2026-10-20）：攻擊傷害 Java ＝ 木 4／金 4／石 5／鐵 6／鑽 7。

**本作採用的完整表（`interact.ts` 的 `TOOL_INFO` 與 `toolDamage`）**：

| 材質 | 採掘等級 level | 速度 speed | 鎬傷害 | 斧傷害 | 鏟傷害 | 劍傷害 |
|---|---|---|---|---|---|---|
| 木 | 0 | 2 | 2 | 7 | 2.5 | 4 |
| 石 | 1 | 4 | 3 | 9 | 3.5 | 5 |
| 鐵 | 2 | 6 | 4 | 9 | 4.5 | 6 |
| 金 | 0 | 12 | 2 | 7 | 2.5 | 4 |
| 鑽 | 3 | 8 | 5 | 9 | 5.5 | 7 |
| 徒手 | — | 1 | 1 | 1 | 1 | 1 |

- **採掘等級表（`BlockDef.requiredTool`）**：煤／石／鵝卵石／熔爐＝`{pickaxe, 0}`（木鎬以上）；鐵礦＝`{pickaxe, 1}`（石鎬以上）；**金礦／鑽石礦＝`{pickaxe, 2}`（鐵鎬以上）**。
  已查證（minecraft.wiki/Gold_Ore，2026-10-20）：「Gold ore drops one raw gold if mined by an iron pickaxe or higher.」／已查證（minecraft.wiki/Diamond_Ore，2026-10-20）：infobox Tool 欄為「An iron pickaxe or better is required to mine this block」→ 與 spec §B5.1 的「金／鑽：鐵鎬以上」**完全一致**（鑽石礦在原版也只要鐵鎬，不是鑽鎬）。
- 不可收穫時 ×5 且無掉落：沿用 B1.6 的公式（`hardness × (canHarvest ? 1.5 : 5) ÷ toolSpeed`），本批不動公式，只擴充工具表。

### 2. 斧頭的左右鏡像配方

- 已查證（minecraft.wiki/Axe，2026-10-20）：「Wooden, golden, stone, copper, iron, and diamond axes are crafted using 2 sticks and 3 identical units of tool material. **This recipe can be flipped horizontally.**」
- **兩種排法（`PatternCell` 陣列，`X`＝材質、`S`＝木棍、`null`＝必須是空格）**：
  - 左斧：`[[X,X],[X,S],[null,S]]`（現行實作的排法，保留）
  - 右斧：`[[X,X],[S,X],[S,null]]`（鏡像，**新增**）
- 每一把斧都要有兩份配方 → 五把斧（木／石／鐵／金／鑽）共 10 條斧配方。

### 3. 原版金／鑽／鐵／煤的生成深度（1.20）

- 已查證（minecraft.wiki/Gold_Ore，2026-10-20）：「Gold ore attempts to generate in two batches. The first batch generates 4 times per chunk in blobs of 0—13 blocks, **from levels −64 to 32. It is most likely to be found around layer −16**, becoming less common toward either end of the range. The second batch has a probability of 1/2 per chunks to generate in blobs of 0—13 blocks that generate uniformly between −64 and −48.」→ 金礦＝**三角分佈，峰在 Y=−16**，範圍 −64..32。
- 已查證（minecraft.wiki/Diamond_Ore，2026-10-20）：四個批次全部落在 **Y=16..−63**（7 blobs 1–5/chunk；每 1/9 chunk 一次 1–23；4 blobs 1–10；2 blobs 1–10 於 Y=−4..−63）；「**Deepslate diamond ore is most commonly found at Y=−58 and Y=−59.**」且「more common as the altitude decreases」→ 鑽石＝**越深越常見，峰在 Y≈−58**。
- 已查證（minecraft.wiki/Iron_Ore，2026-10-20）：三個批次；地下兩批的範圍是 **Y=−64..72**，第二批「most common around level 16」→ 鐵礦＝三角，峰 Y=16。
- 已查證（minecraft.wiki/Coal_Ore，2026-10-20）：兩批；第二批「from levels 0 to 192, being most common at Y=96」。
- 已查證（minecraft.wiki/Terrain features#Sea level，2026-10-20）：「Air on altitude Y=62 and lower is replaced by water.」→ **原版與本作的海平面基準一致（水的最高一格＝62）**，這是下面映射的錨點。

### 4. 映射方法：原版 Y → 本作 0–255（**本批最關鍵的設計**）

本作的地下只有原版的一半深，若直接照抄原版 Y 值，寶物會全部擠在「地表下 1 格」附近。因此本批用**兩錨點的線性壓縮**：

1. **深度基準**：兩作都以海平面（水的最高一格）為 0 深度 → 原版深度 `d_v = 62 − Y_v`（Y_v=−64 → 126 格），本作深度 `d_g = 62 − Y_g`（Y_g=0 → 62 格）。
2. **壓縮係數**：`k = 62 / 126 = 0.492063492063492`（本作的地下深度是原版的 49.2%）。
3. **正向映射**：`Y_g = 62 − (62 − Y_v) × k = 31.49206349 + 0.49206349 × Y_v`。
4. **反向映射**（實作時用得到）：`Y_v = (Y_g − 31.49206349) / 0.49206349`。
5. **錨點檢查**：`Y_v = 62 → Y_g = 62`（海平面對齊）；`Y_v = −64 → Y_g = 0`（基岩對齊）。兩端皆為整數映射，無浮點誤差。
6. **沒有深板岩層的後果**：原版的「深板岩帶 Y=−64..0」整體壓縮到本作的 **Y_g = 0..31**；原版的「Y=0..62」帶壓縮到本作的 **Y_g = 31..62**。本作沒有深板岩（只有石頭），所以這個壓縮帶就是「最深層」。

**映射後的分佈（本作 Y 空間）**：

| 礦 | 原版範圍 | 原版峰 | **本作範圍** | **本作峰** | 權重形狀 |
|---|---|---|---|---|---|
| 鑽石礦 | −63..16 | −58 | **1..39** | 1（最深） | 單調遞減（y=1 → 1.0，y=39 → 0） |
| 金礦 | −64..32 | −16 | **0..47** | 24 | 三角（半寬 24） |
| 鐵礦 | −64..72 | 16 | **0..67** | 39 | 三角（半寬 39） |
| 煤礦 | 0..192 | 96 | 31..126（映射值） | 79 | **本批不重排**，實際帶沿用 0..126 的均勻模型（見下） |

- **煤炭刻意不重排**：原版煤炭的三角帶下緣在 Y=0（本作 y=31），重排後低窪地形（海底 h≈35，石頭只有 1..30）會**完全沒有燃料**。為避免這種回退，**煤炭維持現有的均勻密度模型**（1/120，覆蓋全部石頭深度），並在 README 的〈與原版的差異〉明列。鐵／金／鑽則照上表重排（它們不是燃料，不影響可玩性）。
- **分佈「形狀」而非「礦脈」**：原版用 blob（礦脈）生成，本作沿用既有的**逐格雜湊密度模型**（`hash2` 逐格擲骰）——這是既有實作的模型，本批不改成 blob 礦脈（README 明列為簡化）。形狀（三角／單調）對齊原版。
- **帶界的取整**：鐵／金／鑽的帶界由映射值取整（`mapVanillaY(−63) = 0.492…` → 鑽石帶下緣取 **1**，因為 y=0 是基岩層、本來就不長礦；`mapVanillaY(72) = 66.92…` → 鐵礦帶上緣取 **67**）。

### 5. 礦脈密度模型與數值（`src/world/ores.ts`）

逐格機率 `P = base × weight(y)`，`base` 見下表；`weight(y)` 在帶外為 0。

| 礦 | 帶（本作 y） | weight(y) | base | 預期每 16×16 區塊（石頭深度 ≈64） |
|---|---|---|---|---|
| 煤 COAL_ORE | 0..126 | 1.0（均勻） | 1/120 | ≈136 |
| 鐵 IRON_ORE | 0..67 | 三角，峰 39，半寬 39 | 1/260 | ≈31 |
| 金 GOLD_ORE | 0..47 | 三角，峰 24，半寬 24 | 1/900 | ≈6.7 |
| 鑽 DIAMOND_ORE | 1..39 | (39−y)/38（線性遞減） | 1/1400 | ≈3.6 |
| 礫 GRAVEL | 0..60 | 1.0（均勻） | 1/1200 | ≈12.8 |

- 三角權重：`w(y) = max(0, 1 − |y − peak| / halfWidth)`；線性權重：`w(y) = (yMax − y) / (yMax − yMin)`。
- **每種礦一個獨立鹽值**（`hash2` 的第三參數 XOR 進去的常數），避免不同礦的雜湊互相相關。
- 礦只取代**石頭**（`BLOCK.STONE`）：地形填的石頭層是 `y < 地面高 −4`（`generateChunk` 的填法），本批讓**整個石頭層**都能長礦（現況另外卡 `y < 地面高 −6`，即地表下兩層是無礦石頭——本批放寬那兩層，純外觀差異）。洞穴是空氣不是石頭 → 洞穴裡不會長礦（與現況等價）。

### 6. 36 格背包語義（本批的資料形狀改變）

- **槽位編號**：`0..8`＝**熱鍵列**（同時是遊戲手裡那一列，遊戲的 `selected` 指向 0..8）；`9..35`＝**主背包**（3 列 × 9）。
- **本機 payload v4**：`player.inventory` 與 `stash.survival`／`stash.creative` 全部是 **36 格**。
- **舊資料遷移**：v1／v2／v3 的 9 格陣列 → **前 9 格＝熱鍵列，其餘 27 格留空**（`sanitizeSlots(x, 36)` 天然達成：不足 36 的來源補 null、超過 36 的截斷）。
- **雲端 format 2**：format 1 的 payload（9 格 inventory）讀入時同樣補成 36 格 → 熱鍵列保留、其餘留空；`readableFormats:[1,2]`，`writeFormat:2`。
- **`ItemStack` 形狀不變**（仍是 `{ item, count }`）——`dur` 是 B7 的事。

### 7. 背包 UI 操作模型（B5.3 的「點擊選取→點擊放置」簡化版）

- **面板結構**：
  - 生存：標題「背包」→ 2×2 合成（沿用現行點擊模型，含 9 格來源列）→ 27 格主背包（3×9）→ 9 格熱鍵列（1×9）。
  - 創造：標題「方塊」→ 36 格網格（27＋9）→ **可捲動全物品清單**（`ALL_ITEM_IDS`）。
- **游標堆疊（cursor stack）＝「選取」狀態**：
  - 左鍵空格 → 取走整疊（游標持有該疊，格子變空）。
  - 左鍵有疊的格子 → **交換**（游標拿到該格的疊，該格拿到游標的疊）；左鍵空格 → 游標的疊放進去，游標清空。
  - 右鍵空格（游標空）→ **取一半**（`ceil(count/2)`，游標持有，格子留另一半）。
  - 右鍵有疊的格子（游標非空）→ **放 1 個**（目標格必須是空的或同物品且未滿）。
  - 游標堆疊以浮動元素 `.ui-cursor-stack` 跟隨滑鼠渲染；滑鼠下的格子加 `.ui-cursor-target` 外框。
- **關閉面板時歸還游標**：`onReturnCursor(stack)` → 回傳 `null` 表示全數放回；回傳堆疊表示放不下的餘量，UI **保留它**並在下一次開面板時顯示（不消失、不複製）。新遊戲／讀檔時清掉（該局物品本來就會被清空，與原版「離開遊戲時游標物品不保存」一致）。
- **創造清單點擊** → 寫入**目前手持的熱鍵欄格**（`selected`，0..8），與現行行為一致（現行 `onPick(selected, stack)`）。
- **生存面板不顯示任何免費物品清單**（延續 B1.2）。
- **合成區維持現行點擊模型**（點空格從來源列搬 1 個進來、點實格退回 1 個、點結果取出）；只把「來源列的資料來源」從 9 格熱鍵欄改成 **36 格陣列的前 9 格**。
- **右鍵分堆是選配項，本批實作**（取一半／放 1 個）——已寫進測試。

### 8. 方塊 id 與 tile 配置（**跨批衝突，見〈與公約／spec 的差異〉第 1 條**）

- （2026-10-20 稽核修正：原本節寫著「B4 計畫把 **17 給了 `WOOL`**（`T.WOOL = 21`）」——那是過時的說法，B4 已依公約 §3.5 改成 **26／33**；本節以公約的跨批編號表為唯一真值。）
- **controller 已裁決（2026-10-20，跨批編號表）：既有 `BLOCK` 0–16 不動；B3 用 17–25（`SPRUCE_LOG`…`ICE`）；B4 羊毛 = 26；**本批用 27–31**；B6 火把 = 32；B8 箱子 = 33。tile 索引：B3 用 21–32（`TILE_COUNT` 33）、B4 `T.WOOL` = 33（34）、**本批用 34–38**（39）、B6 `T.TORCH` = 39（40）、B8 `T.CHEST` = 40（41）。**下列數字即為正式值**（＝公約 §3.5 的跨批編號表，非暫定、非估計）：
  - `BLOCK.GRAVEL = 27`、`BLOCK.GOLD_ORE = 28`、`BLOCK.DIAMOND_ORE = 29`、`BLOCK.SPRUCE_PLANKS = 30`、`BLOCK.BIRCH_PLANKS = 31`
  - `T.GRAVEL = 34`、`T.GOLD_ORE = 35`、`T.DIAMOND_ORE = 36`、`T.SPRUCE_PLANKS = 37`、`T.BIRCH_PLANKS = 38` → `TILE_COUNT = 39`（≤ 紋理陣列 64 層 ✓）
- **Task 1 的第一個步驟就是核對**：讀 `src/world/blocks.ts` 的**現況**，確認 27–31／34–38 仍空閒；若上游合併後的現況與正式值不同（例：某上游批次用了別的 id），**以現況為準**、把本計畫與測試中的數字一併改成實際值，並在 Task 1 的 commit 訊息裡寫出實際值（例：`B5 新 block id 27–31、tile 34–38`）。**絕對不可沿用已被占用的 id。**（2026-10-20 終審修正：原計畫在同一節裡同時寫「下列數字即為正式值，非暫定」與「若與暫定值不同」——前後矛盾；現已統一為單一說法：**正式值＝公約 §3.5**，落地時以讀到的現況為準並在 commit 訊息註明。）

### 9. 沿用其他批次的介面（不重複定義）

- **B3（世界生成 0.6.0）**：`BLOCK.SPRUCE_LOG / SPRUCE_LEAVES / BIRCH_LOG / BIRCH_LEAVES / DANDELION / POPPY / SHORT_GRASS / CACTUS / ICE` 方塊與 tile、**這 9 個方塊的物品形式（`ItemId` ＋ `BLOCK_PAIRS` ＋ 圖示）由 B3 自己補**、`WORLDGEN_VERSION`（**B5 因新增礦脈／礫石而必須升為 2**）、`terrain.ts` 的 `generateChunk(cx, cz, seed)`。B5 只做**掉落規則與取得路徑**（草叢可拾取是 B3 明文交給 B5 的部分）。
- **B4（被動生物 0.7.0）**：`BLOCK.WOOL` 與 `wool` 物品（羊掉羊毛）、`ItemId` 的 13 個食物／材料 id（`raw_chicken`…`bone`）、`AdvancementId` 的 `pasture`、`FUEL_VALUES` 校正後的小數燃料值（煤 8／原木 1.5／板材 1.5／木棍 0.5）。
- 本批**不重做** B3／B4 的方塊資料與物品形式，只補**本批自己新增的 5 個方塊**的物品形式（`items.ts` 的 `BLOCK_PAIRS`）＋掉落／合成接線。

---

## 檔案結構

| 檔案 | 動作 | 職責 |
|---|---|---|
| `src/world/blocks.ts` | 修改 | 新方塊（礫石／金礦／鑽石礦／雲杉板材／白樺板材）的 id、硬度、工具類、tile |
| `src/world/blocks.test.ts` | 修改 | 新欄位與資料表測試（id 不撞號、硬度對齊原版） |
| `src/render/textures.ts` | 修改 | 新 tile 的圖樣（礫石／金礦／鑽石礦／雲杉板材／白樺板材） |
| `src/render/textures.test.ts` | 修改 | 「每個宣告的 tile 都被畫過」測試 |
| `src/core/items.ts` | 修改 | 18 個新 `ItemId`（本批自己的 5 個方塊 ＋ 3 個原料 ＋ 11 把工具）、`BLOCK_PAIRS`（5 筆）、`STACK_ONE`、`INVENTORY_SLOTS` 等常數、`starterSlots` 改 36 格 |
| `src/core/items.test.ts` | 修改 | 物品表完整性、方塊配對、堆疊上限、36 格起始槽 |
| `src/ui/icons.ts` | 修改 | 新物品的像素圖示（生金／金錠／鑽石／11 把新工具） |
| `src/ui/icons.test.ts` | 新增 | 14 個需要像素圖的新 id 都有專屬 `case` 分支的靜態檢查 |
| `src/player/interact.ts` | 修改 | `TOOL_INFO` 擴充（金／鑽／鏟）、`toolDamage` 對齊原版 |
| `src/player/interact.test.ts` | 修改 | 表驅動的速度／等級／傷害／掉落測試 |
| `src/core/recipes.ts` | 修改 | 31 份配方、`PatternCell` 多格（any planks）、斧鏡像 |
| `src/core/recipes.test.ts` | 修改 | 配方表、鏡像斧、any-planks 測試 |
| `src/world/drops.ts` | 修改 | 掉落表補新方塊（金礦→生金、鑽石礦→鑽石、礫石→礫石、花草→自身、冰→無） |
| `src/world/furnace.ts` | 修改 | `raw_gold`／`gold_ore` → `gold_ingot`；`spruce_log`／`birch_log` 當燃料 |
| `src/core/advancements.ts` | 修改 | `gold_age`／`diamond_age`／`golden_tool`／`diamond_tool` 與取得觸發 |
| `src/world/ores.ts` | **新增** | 原版 Y→本作 Y 的映射、礦帶／權重／密度表、`placeOres` |
| `src/world/ores.test.ts` | **新增** | 映射函式與權重函式的單元測試 |
| `src/world/ores-stats.test.ts` | **新增** | 固定種子的統計測試（帶界、峰值、每區塊數量） |
| `src/world/terrain.ts` | 修改 | `generateChunk` 改呼叫 `placeOres`（取代內嵌的礦石程式碼） |
| `src/world/worldgen.ts` | 修改 | `WORLDGEN_VERSION` 1 → 2（地形改變） |
| `src/core/mode-stash.ts` | 修改 | 每模式槽位數 9 → 36（由 `starterSlots` 自動帶入，註解同步） |
| `src/world/save.ts` | 修改 | payload v4（36 格）＋ v1/v2/v3 → v4 遷移 |
| `src/world/save.test.ts` | 修改 | v4 fixture 與三條遷移測試 |
| `src/core/cloud-save.ts` | 修改 | `CLOUD_FORMAT_VERSION = 2`、`CLOUD_READABLE_FORMATS`、36 格正規化 |
| `src/core/cloud-save.test.ts` | 修改 | format 2 的建置／驗收／遷移測試 |
| `src/ui/inventory.ts` | 修改 | 36 格面板、游標堆疊、創造可捲動清單 |
| `src/ui/crafting.ts` | 修改 | 來源改 36 格陣列的前 N 格（`slots` ＋ `sourceCount`） |
| `src/ui/ui.css` | 修改 | 主背包格／熱鍵列格／可捲動清單／游標堆疊樣式 |
| `src/ui/ui.test.ts` | 修改 | 面板結構、游標模型、創造清單測試 |
| `src/ui/crafting.test.ts` | 修改 | 來源列改 `slots` 的測試 |
| `src/main.ts` | 修改 | 36 格接線（變數改名、面板參數、游標回填、雲端格式檢查） |
| `README.md`、`docs/releases/v0.8.0.md`、`package.json`、`game.json` | 修改／新增 | Task 10 發布 |

---

### Task 1: 新方塊資料表與貼圖（礫石／金礦／鑽石礦／雲杉板材／白樺板材）

**Files:**
- Modify: `src/world/blocks.ts`（`BLOCK`、`T`、`TILE_COUNT`、`DEFS`、`PLACEABLE`）
- Modify: `src/world/blocks.test.ts`
- Modify: `src/render/textures.ts`（新 tile 圖樣）
- Modify: `src/render/textures.test.ts`
- Modify: `src/ui/icons.ts`（**不動**——方塊物品的圖示由 `itemIcon` 從圖集裁切，Task 2 才需要物品表有對應 id）

**Interfaces:**
- Consumes: B3 的 `SPRUCE_LOG / SPRUCE_LEAVES / BIRCH_LOG / BIRCH_LEAVES / DANDELION / POPPY / SHORT_GRASS / CACTUS / ICE`；B4 的 `WOOL`。
- Produces（後續任務依賴，名稱不得再改）：
  - `src/world/blocks.ts`：
    ```ts
    export const BLOCK = {
      ...既有 0–16 與 B3／B4 的 id...,
      GRAVEL: 27,        // 實際值以 Task 1 Step 1 核對後為準
      GOLD_ORE: 28,
      DIAMOND_ORE: 29,
      SPRUCE_PLANKS: 30,
      BIRCH_PLANKS: 31,
    } as const;
    ```
    - `T` 追加：`GRAVEL 34`、`GOLD_ORE 35`、`DIAMOND_ORE 36`、`SPRUCE_PLANKS 37`、`BIRCH_PLANKS 38`；`TILE_COUNT = T.BIRCH_PLANKS + 1`（39）。
    - `DEFS` 追加 5 筆（**完整欄位**：硬度／工具類照下表；`name` 與 `top/side/bottom` 三個必填欄位見下）：

      | 方塊 | id | `name` | 硬度 | solid | transparent | shape | requiredTool | fastTool | top／side／bottom |
      |---|---|---|---|---|---|---|---|---|---|
      | gravel | 27 | `'gravel'` | 0.6 | true | false | 'cube' | `null` | `'shovel'` | `T.GRAVEL`（三面皆同） |
      | gold_ore | 28 | `'gold_ore'` | 3.0 | true | false | 'cube' | `{ kind: 'pickaxe', level: 2 }` | `'pickaxe'` | `T.GOLD_ORE`（三面皆同） |
      | diamond_ore | 29 | `'diamond_ore'` | 3.0 | true | false | 'cube' | `{ kind: 'pickaxe', level: 2 }` | `'pickaxe'` | `T.DIAMOND_ORE`（三面皆同） |
      | spruce_planks | 30 | `'spruce_planks'` | 2.0 | true | false | 'cube' | `null` | `'axe'` | `T.SPRUCE_PLANKS`（三面皆同） |
      | birch_planks | 31 | `'birch_planks'` | 2.0 | true | false | 'cube' | `null` | `'axe'` | `T.BIRCH_PLANKS`（三面皆同） |

      （2026-10-20 稽核修正：原表只有 id／硬度／solid／transparent／shape／requiredTool／fastTool，**漏了 `BlockDef` 的三個必填欄位**——`name`（小寫英文 id 字串）與 `top`／`side`／`bottom`（圖集 tile 索引）；照原表寫會編譯不過。硬度皆為原版值：礫石 0.6、金礦 3、鑽石礦 3、木板 2.0。`shape` 欄位由 **B3** 引入（`BlockShape = 'cube' | 'cross'`，既有方塊一律 `'cube'`）——B5 的 5 個新方塊全是 `'cube'`；**若 B3 尚未落地**，本任務一併把 `shape: 'cube'` 補到 `DEFS` 的每一筆（不補就無法給新方塊寫 `shape`）。）
    - `PLACEABLE` 追加這 5 個方塊（它們在 Task 2 之後有物品形式，可以放置）。
  - `src/render/textures.ts`：新 tile 圖樣（寫法比照既有 `put(tile, fn)`）——
    - `GRAVEL`：灰褐色 `[136,130,122,255]` 底＋ 20 顆深淺不一的碎石點。
    - `GOLD_ORE`：石頭底 `[125,125,125,255]` ＋ 5–7 個金黃色斑塊 `[240,200,60,255]`。
    - `DIAMOND_ORE`：石頭底 ＋ 5–7 個青白色斑塊 `[120,220,225,255]`。
    - `SPRUCE_PLANKS`：深棕 `[92,64,38,255]` ＋ 垂直深色板縫。
    - `BIRCH_PLANKS`：淺木 `[196,180,140,255]` ＋ 淺色板縫。

- [ ] **Step 1: 核對並寫死 block id／tile id（跨批協調點）**

  讀 `src/world/blocks.ts` 現況，把 `BLOCK` 的最大 id 與 `TILE_COUNT` 記下來（`const maxBlockId = Math.max(...Object.values(BLOCK));`）：
  - B5 的 5 個新 block id ＝ `maxBlockId + 1` 起算依序遞增（**正式值 27/28/29/30/31**，依公約 §3.5）。
  - B5 的 5 個新 tile id ＝ 現況 `TILE_COUNT` 起算依後遞增（**正式值 34/35/36/37/38**），`TILE_COUNT` ＝ 最後一個 + 1（**正式值 39**）。
  - **若與正式值不同**（例：上游某批次用了別的 id、`WOOL` 不在 26、或 B3 的 `SPRUCE_LOG` 不在 17）：**以現況為準**，把本計畫與測試中的數字一併改成實際值，並在 Task 1 的 commit 訊息裡寫出實際值（例：`B5 新 block id 27–31、tile 34–38（WOOL 為 26）`）。**絕對不可沿用已被占用的 id。**（2026-10-20 終審修正：原計畫把這些寫成「暫定 27/28/29/30/31」並舉例「controller 把 B4 的 `WOOL` 改編為 26」——但 26 就是公約 §3.5 的正式值，措辭自相矛盾；現已統一為「正式值＝公約 §3.5，落地時以讀到的現況為準並在 commit 訊息註明實際值」。）

- [ ] **Step 2: 寫測試（失敗）**

  `src/world/blocks.test.ts` 追加：
  - **既有 `'requiredTool／fastTool data matches vanilla'` 的窮舉表要補 5 列**（2026-10-20 稽核修正：原計畫完全沒提這張表 → **新增 5 個 block id 必紅**）。該測試結尾有 `expect(expected.map(([id]) => id).sort(byId)).toEqual([...Object.values(BLOCK)].sort(byId))`——**每個 block id 都必須在表內**。要補的 5 列：
    ```ts
    [BLOCK.GRAVEL, null, 'shovel'],
    [BLOCK.GOLD_ORE, { kind: 'pickaxe', level: 2 }, 'pickaxe'],
    [BLOCK.DIAMOND_ORE, { kind: 'pickaxe', level: 2 }, 'pickaxe'],
    [BLOCK.SPRUCE_PLANKS, null, 'axe'],
    [BLOCK.BIRCH_PLANKS, null, 'axe'],
    ```
    （**改動理由**：新增方塊 id 的資料表同步，不是弱化。）
  - **既有 `'hardness table matches vanilla 1.20+ (Task 5)'` 的表要補 5 列**：`[BLOCK.GRAVEL, 0.6]`、`[BLOCK.GOLD_ORE, 3.0]`、`[BLOCK.DIAMOND_ORE, 3.0]`、`[BLOCK.SPRUCE_PLANKS, 2.0]`、`[BLOCK.BIRCH_PLANKS, 2.0]`。
  - `'the B5 blocks keep their ids and vanilla hardness'`：
    ```ts
    expect(getBlockDef(BLOCK.GRAVEL).hardness).toBe(0.6);
    expect(getBlockDef(BLOCK.GOLD_ORE).hardness).toBe(3.0);
    expect(getBlockDef(BLOCK.DIAMOND_ORE).hardness).toBe(3.0);
    expect(getBlockDef(BLOCK.SPRUCE_PLANKS).hardness).toBe(2.0);
    expect(getBlockDef(BLOCK.BIRCH_PLANKS).hardness).toBe(2.0);
    ```
  - `'the new blocks carry the vanilla harvest gates'`：
    ```ts
    expect(getBlockDef(BLOCK.GOLD_ORE).requiredTool).toEqual({ kind: 'pickaxe', level: 2 });
    expect(getBlockDef(BLOCK.DIAMOND_ORE).requiredTool).toEqual({ kind: 'pickaxe', level: 2 });
    expect(getBlockDef(BLOCK.GRAVEL).requiredTool).toBeNull();
    expect(getBlockDef(BLOCK.GRAVEL).fastTool).toBe('shovel');
    expect(getBlockDef(BLOCK.SPRUCE_PLANKS).fastTool).toBe('axe');
    ```
  - `'no two blocks share an id'`：`const ids = Object.values(BLOCK); expect(new Set(ids).size).toBe(ids.length);`
  - `'the pre-B3 block ids are unchanged'`：`expect(BLOCK.AIR).toBe(0); … expect(BLOCK.FURNACE).toBe(16);`（逐項列出 0–16 的既有值）。
  - `'the B5 block ids are appended, never renumbered'`：`expect(BLOCK.GRAVEL).toBeGreaterThan(16);`（其餘四個依序大於前一項）。
  - `'the new blocks are placeable'`：`expect(PLACEABLE).toContain(BLOCK.GOLD_ORE); expect(PLACEABLE).toContain(BLOCK.DIAMOND_ORE); expect(PLACEABLE).toContain(BLOCK.GRAVEL);`

  `src/render/textures.test.ts` 追加（新增 helper，斷言寫在**紋理陣列層**上——洋紅除錯色在 `buildTextureArray` 沒被畫到的層，不在 atlas）：
  ```ts
  it('every declared tile is painted (never the magenta debug layer)', () => {
    const data = buildTextureArray().image.data as Uint8Array;
    for (let t = 0; t < TILE_COUNT; t++) {
      let magenta = 0;
      let painted = 0;
      for (let p = 0; p < TILE_PX * TILE_PX; p++) {
        const i = (t * TILE_PX * TILE_PX + p) * 4;
        if (data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 255) magenta++;
        if (data[i + 3] > 0) painted++;
      }
      expect(magenta, `tile ${t} magenta`).toBeLessThan(TILE_PX * TILE_PX);
      expect(painted, `tile ${t} painted`).toBeGreaterThan(0);
    }
  });
  ```
  （`buildTextureArray`／`TILE_PX`／`TILE_COUNT` 已在該檔的 import 清單裡；若 B3 已加了同名測試，沿用 B3 的 helper 即可，斷言內容不得放寬。）

  **既有 `'drawn tiles keep their content; empty layers are opaque magenta #ff00ff'` 的洋紅層清單——**本批**只驗證、不改寫**（2026-10-20 終審修正）**：
  - **唯一的修復點在 B3（0.6.0）**：B3 的 Task 3 Step 1 已把寫死的 `for (const layer of [TILE_COUNT, 32, 47, 63])` 改成 runtime 相對的 `for (const layer of [TILE_COUNT, TILE_COUNT + 1, 47, 63])`（見 B3 計畫〈本批要改寫的既有測試（清單）〉）。本批 `TILE_COUNT` 會從 34 升到 39 → 清單自動變成 `[39, 40, 47, 63]`，四個層都仍是未畫層 ✓。
  - **因此本批不得再改這條**（重複改寫會與 B3 衝突，且三批各寫各的寫法正是複核報告點名的問題）。
  - **備援（若讀到的現況顯示上游仍是寫死的 `[TILE_COUNT, 32, 47, 63]`——例如 B3 尚未合併）**：由**本批**補改成與 B3 完全相同的相對寫法 `[TILE_COUNT, TILE_COUNT + 1, 47, 63]`，並在 Task 1 的 commit 訊息註明「上游 B3 未改寫，本批代為補上」。**改法與 B3 一字不差**——不得另創寫法。

- [ ] **Step 3: 跑測試確認失敗**

  Run: `npx vitest run src/world/blocks.test.ts src/render/textures.test.ts` → Expected: FAIL（`BLOCK.GRAVEL` 等不存在）。

- [ ] **Step 4: 實作 `blocks.ts`**

  - `BLOCK` 追加 5 個 id（值照 Step 1 的核對結果）。
  - `T` 追加 5 個 tile；`TILE_COUNT` 更新。
  - `DEFS` 追加 5 筆（上表，**含 `name` 與 `top`／`side`／`bottom`**）。既有每一筆若尚無 `shape` 欄位，補 `'cube'`。
  - `PLACEABLE` 追加 5 個方塊。
  - 檔頭註解補一句：block id 只能往後追加（舊存檔的 `modified` 記的是數字 id）。

- [ ] **Step 5: 實作 `textures.ts` 的新圖樣**

  照〈Interfaces〉的 5 條圖樣描述寫 `put(...)`；每個 tile 都要用 `vary(base, r, amount)` 做出顆粒感。

- [ ] **Step 6: 跑測試轉綠**

  Run: `npx vitest run src/world/blocks.test.ts src/render/textures.test.ts` → Expected: PASS。

- [ ] **Step 7: 全量驗證**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → Expected: 全綠（既有 806 tests 一個不多、一個不少）。

- [ ] **Step 8: Commit**

  ```bash
  git add src/world/blocks.ts src/world/blocks.test.ts src/render/textures.ts src/render/textures.test.ts
  git commit -m "feat(blocks): B5.1 新增礫石／金礦／鑽石礦／雲杉板材／白樺板材方塊與貼圖（B5 新 block id 27–31、tile 34–38）"
  ```
  （commit 訊息中的 id 區間照 Step 1 的實際值填；**並註明**既有測試的改寫是「新增方塊 id 的資料表同步」：`blocks.test.ts` 的窮舉表／硬度表補 5 列、`textures.test.ts` 的洋紅層清單改成不隨 `TILE_COUNT` 漂移的寫法。）

---

### Task 2: 物品表擴充（18 個新 id ＋ 本批 5 個方塊的配對 ＋ 圖示）

**Files:**
- Modify: `src/core/items.ts`（`ItemId` union、`ITEM_IDS`、`BLOCK_PAIRS`、`STACK_ONE`、`starterSlots` 暫不動——36 格在 Task 7）
- Modify: `src/core/items.test.ts`
- Modify: `src/ui/icons.ts`（`drawItemArt` 新增案例）
- Create: `src/ui/icons.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `BLOCK.GRAVEL / GOLD_ORE / DIAMOND_ORE / SPRUCE_PLANKS / BIRCH_PLANKS`；B3 已提供的 `spruce_log`／`spruce_leaves`／`birch_log`／`birch_leaves`／`dandelion`／`poppy`／`short_grass`／`cactus`／`ice` 物品 id；B4 的 `BLOCK.WOOL` 與 `wool` 物品。
- Produces:
  - `ItemId` union 新增 **18 個**成員（2026-10-20 稽核修正：原計畫是 26 個，其中 8 個（`ice`／`spruce_log`／`spruce_leaves`／`birch_log`／`birch_leaves`／`dandelion`／`poppy`／`short_grass`）是 **B3 的方塊**——B3 自己補物品形式，本批不得重做）：
    ```ts
    | 'spruce_planks' | 'birch_planks'          // 本批自己的 5 個方塊中的 2 個板材
    | 'gold_ore' | 'diamond_ore'             // 本批自己的 5 個方塊中的 2 個礦
    | 'raw_gold' | 'gold_ingot' | 'diamond'   // 原料（3 個）
    | 'wooden_shovel' | 'stone_shovel' | 'iron_shovel'
    | 'golden_pickaxe' | 'golden_axe' | 'golden_sword' | 'golden_shovel'
    | 'diamond_pickaxe' | 'diamond_axe' | 'diamond_sword' | 'diamond_shovel'
    ```
    （`gravel` 與 `wool` **已在 union 內**（`gravel` 是 B1 留下的 dead id，`wool` 是 B4 加的），本任務只是把 `gravel` 接到方塊、`wool` 確認已有配對。）
  - `ITEM_IDS` 表同步新增 18 筆（`Record<ItemId, true>` 窮舉 → 少一個就是 `tsc` 錯誤）。
  - `BLOCK_PAIRS` 新增 **5 筆**（只配本批自己的 5 個方塊；B3／B4 的 10 個方塊配對由 B3／B4 自己補，**本批不得重做**）：
    ```ts
    ['gravel', BLOCK.GRAVEL],
    ['gold_ore', BLOCK.GOLD_ORE],
    ['diamond_ore', BLOCK.DIAMOND_ORE],
    ['spruce_planks', BLOCK.SPRUCE_PLANKS],
    ['birch_planks', BLOCK.BIRCH_PLANKS],
    ```
    （`wool` 若 B4 已加則不重複；若 B4 尚未落地，B5 補 `['wool', BLOCK.WOOL]`——**羊毛是 B4 的方塊，但 B4 的物品形式是 B4 的責任**；此處只是避免 B4 未落地時本批的 `every placeable ... maps to an item` 測試紅，不是重做 B4 的工作。）
  - `STACK_ONE` 新增 11 筆（所有工具與武器堆疊仍為 1）：`wooden_shovel / stone_shovel / iron_shovel / golden_pickaxe / golden_axe / golden_sword / golden_shovel / diamond_pickaxe / diamond_axe / diamond_sword / diamond_shovel`。
  - `src/ui/icons.ts` 的 `drawItemArt` 新增案例（**非方塊物品**才需要畫）：`raw_gold`、`gold_ingot`、`diamond`、`wooden_shovel`、`stone_shovel`、`iron_shovel`、`golden_pickaxe`、`golden_axe`、`golden_sword`、`golden_shovel`、`diamond_pickaxe`、`diamond_axe`、`diamond_sword`、`diamond_shovel`（**14 個不變**——B3 的方塊圖示是 B3 的工作）。

- [ ] **Step 1: 核對物品表的基數並寫測試（失敗）**

  **先核對基數**（2026-10-20 稽核修正：原計畫直接寫死「32 → 71」，但 B3／B4 會各自加 id → 實際基數要看落地現況）：
  ```ts
  // 讀 src/core/items.ts 現況
  const base = ALL_ITEM_IDS.length;   // 現況 32；若 B4 已落地是 45；若 B3 也已落地是 54
  ```
  - 目標值 ＝ **`base + 18`**（本批新增 18 個 `ItemId`）。**這是唯一的寫法**——測試裡的數字必須是實作者**讀到的實際值**（＝`base + 18`），不是計畫預先寫死的某個絕對數字（2026-10-20 終審修正：原計畫在下文直接寫 `toBe(72)`，但 72 只有在「B3 與 B4 都已落地」時才對；B3 或 B4 未落地時必然紅。**改法：斷言寫成 `toBe(base + 18)` 的實際值，並在 commit 訊息寫出實際值**（例：`ALL_ITEM_IDS 54 → 72`）。）
  - 對照（僅供 sanity check，不是要寫死的值）：B3 與 B4 都已落地 → `32 + 9 + 13 + 18 = 72`；只有 B4 落地 → `63`；只有原狀 → `50`。

  `src/core/items.test.ts`：
  - 既有 `'ItemId union covers every obtainable block item'` 的 `expect(ALL_ITEMS.length).toBe(<現況基數>)` → 改為 `toBe(<base + 18 的實際值>)`（**改動理由**：物品表成長，不是弱化；數字照 Step 1 核對到的實際值寫死）。
  - 既有 `'ALL_ITEM_IDS is the canonical list: <N> entries…'` 的 `expect(ALL_ITEM_IDS.length).toBe(<現況基數>)` → 改為 `toBe(<base + 18 的實際值>)`，並把測試標題裡的數字一併改成實際值。
  - **既有鏡像清單 `ALL_ITEMS`（`items.test.ts` 第 17–33 行的 `BLOCK_ITEMS`／`TOOL_ITEMS`／`DROP_ITEMS` ＋ 尾端三個）要補上本批新增的全部 id**（2026-10-20 稽核修正：原計畫只寫「補上 26 個新 id」——**但鏡像清單必須等於 `ALL_ITEM_IDS` 的完整集合**）：
    | 來源 | 要補的 id | 數量 |
    |---|---|---|
    | B4（若尚未補） | `raw_chicken`／`cooked_chicken`／`raw_porkchop`／`cooked_porkchop`／`raw_mutton`／`cooked_mutton`／`raw_beef`／`steak`／`leather`／`feather`／`wool`／`rotten_flesh`／`bone` | 13 |
    | B3（若尚未補） | `spruce_log`／`spruce_leaves`／`birch_log`／`birch_leaves`／`dandelion`／`poppy`／`short_grass`／`cactus`／`ice` | 9 |
    | B5（本批） | `spruce_planks`／`birch_planks`／`gold_ore`／`diamond_ore`／`raw_gold`／`gold_ingot`／`diamond` ＋ 11 把工具 | 18 |
    → **最多 40 個**（B3／B4 都已補過的就只補本批的 18 個）。**實作者必須先讀 `items.test.ts` 現況**，看鏡像清單已含哪些 id，再補缺的那些——**不得重複新增**（`new Set(ALL_ITEMS).size` 與 `ALL_ITEMS.length` 的相等斷言會紅）。建議把新增的 id 分成 `FOOD_ITEMS`／`MATERIAL_ITEMS`／`TOOL_ITEMS` 三段收納，語意清楚。
  - 新 `'the new block items are the item form of their blocks'`（**只驗本批的 5 個方塊**；2026-10-20 稽核修正：原計畫把 B3 的 8 個也列進來 → 那是 B3 的物品形式，不該由 B5 驗收）：
    ```ts
    expect(blockFromItem('gravel')).toBe(BLOCK.GRAVEL);
    expect(blockFromItem('gold_ore')).toBe(BLOCK.GOLD_ORE);
    expect(blockFromItem('diamond_ore')).toBe(BLOCK.DIAMOND_ORE);
    expect(blockFromItem('spruce_planks')).toBe(BLOCK.SPRUCE_PLANKS);
    expect(blockFromItem('birch_planks')).toBe(BLOCK.BIRCH_PLANKS);
    ```
  - 新 `'the raw materials are not blocks and stack to 64'`：
    ```ts
    expect(blockFromItem('raw_gold')).toBeNull();
    expect(blockFromItem('gold_ingot')).toBeNull();
    expect(blockFromItem('diamond')).toBeNull();
    expect(maxStack('raw_gold')).toBe(64);
    expect(maxStack('gold_ingot')).toBe(64);
    expect(maxStack('diamond')).toBe(64);
    ```
  - 新 `'every new tool stacks to 1'`：11 個新工具逐一 `expect(maxStack(t)).toBe(1)`。
  - 既有 `'every placeable and default hotbar block maps to an item'` 會自動覆蓋新方塊（`PLACEABLE` 已含新方塊）。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/core/items.test.ts` → Expected: FAIL（型別編譯階段就會報 `ItemId` 缺成員——這是預期的紅燈）。

- [ ] **Step 3: 實作 `items.ts`**

  - union 新增 18 個成員（照上列順序：方塊類放方塊區塊、原料類放掉落物區塊、工具類放工具區塊）。
  - `ITEM_IDS` 新增 18 筆 `true`。
  - `BLOCK_PAIRS` 新增上列 5 筆（`wool` 若 B4 已加則跳過；**B3 的 9 個配對由 B3 補，本批不碰**）。
  - `STACK_ONE` 新增 11 筆。
  - 註解更新：`BLOCK_PAIRS` 的說明補一句「B5 起礫石／金鑽礦／雲杉白樺板材有物品形式（雲杉白樺原木、樹葉、花草、冰的物品形式由 B3 補）」。

- [ ] **Step 4: 實作 `icons.ts` 的像素圖示**

  - `raw_gold`：不規則金黃色團塊（`#f0c83c` 為主、`#c99a1e` 陰影），比照既有 `raw_iron` 的寫法。
  - `gold_ingot`：梯形金條（`#f7d774` 底＋ `#c99a1e` 下緣），比照 `iron_ingot`。
  - `diamond`：菱形（`#78dce8` 填色＋ `#3f9aa6` 邊），用 `ctx.moveTo/lineTo` 畫四邊形。
  - 鏟（5 把）：`line(ctx, 10, 26, 16, 10, WOOD, 3)` 當柄＋ 頭部一個小梯形（`WOOD_LIGHT` / `STONE_GRAY` / `IRON_GRAY` / `#f0c83c` / `#78dce8`）。
  - 金鎬／金斧／金劍（＋鑽鎬／鑽斧／鑽劍）：把既有三個工具 case 改成**依材質分色**——**但 `case 'xxx':` 標籤必須保留**（同一 case 群組可以 fallthrough），case body 內用「材質 → 色票」查表決定頭／刃的顏色：
    ```ts
    const TOOL_COLORS: Record<string, { head: string; edge: string }> = {
      wooden:  { head: WOOD_LIGHT, edge: '#d8d8d8' },
      stone:   { head: STONE_GRAY, edge: '#c6c6c6' },
      iron:    { head: IRON_GRAY,  edge: '#b9c6d4' },
      golden:  { head: '#f0c83c',   edge: '#ffe89a' },
      diamond: { head: '#78dce8',   edge: '#bff2f7' },
    };
    ```
    鎬／斧／劍各一個 case 群組（5 個 `case` 標籤 fallthrough 進同一段），鏟再一個 case 群組（5 個標籤）。
  - **硬性要求**：14 個需要像素圖的新 id（`raw_gold`／`gold_ingot`／`diamond` ＋ 11 把工具）**每個都要有專屬的 `case 'xxx':` 標籤**——Step 5 的靜態檢查就是靠這些標籤；不得改成「先查表再 switch 材質」而讓標籤消失（否則圖示會落到 `default:` 的灰色 placeholder）。
  - 圖示 case 的組織方式由實作者自訂，但**每個新物品都必須有專屬外觀**（不得落到 `default:` 的灰色placeholder）——測試會用 `itemIcon()` 的 canvas 像素檢查（見 Step 1 追加的測試）。

- [ ] **Step 5: 追加「圖示不是 placeholder」的測試**

  `src/ui/` 沒有專門的 icons 測試檔 → **新建 `src/ui/icons.test.ts`**（2026-10-20 稽核修正：原計畫的片段只有註解、沒有可執行的斷言 → 整段等於沒有測試）。**可執行、不依賴 canvas** 的靜態檢查：
  ```ts
  import { describe, it, expect } from 'vitest';
  import { readFileSync } from 'node:fs';
  import { resolve } from 'node:path';

  const ICONS_SRC = readFileSync(resolve(process.cwd(), 'src/ui/icons.ts'), 'utf8');
  /** 需要專屬像素圖（非方塊）的 14 個新 id。 */
  const NEEDS_ART = [
    'raw_gold', 'gold_ingot', 'diamond',
    'wooden_shovel', 'stone_shovel', 'iron_shovel',
    'golden_pickaxe', 'golden_axe', 'golden_sword', 'golden_shovel',
    'diamond_pickaxe', 'diamond_axe', 'diamond_sword', 'diamond_shovel',
  ];

  describe('icons: new items have their own art branch', () => {
    it('every new item that needs pixel art has its own case label', () => {
      for (const id of NEEDS_ART) {
        expect(ICONS_SRC, `icons.ts needs a "case '${id}':" label`).toContain(`case '${id}'`);
      }
    });

    it('no new item falls through to the grey placeholder default', () => {
      // `default:` 只能給未知 id 用；本批的新 id 必須有專屬分支（上面已逐一檢查）
      const defaults = ICONS_SRC.match(/default:/g) ?? [];
      expect(defaults.length).toBeLessThanOrEqual(1);
    });
  });
  ```
  （若實作者的 `icons.ts` 用了多個 `default:`（例如不同 switch 各一個），把第二條斷言改成「**逐一列出允許的 `default:` 數量**」或直接刪掉第二條——**第一條（14 個 id 都有 `case` 標籤）才是重點**，不可放寬。）

- [ ] **Step 6: 跑測試轉綠**

  Run: `npx vitest run src/core/items.test.ts src/ui/icons.test.ts` → Expected: PASS。

- [ ] **Step 7: 全量驗證**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → Expected: 全綠。

- [ ] **Step 8: Commit**

  ```bash
  git add src/core/items.ts src/core/items.test.ts src/ui/icons.ts src/ui/icons.test.ts
  git commit -m "feat(items): B5.1 18 個新物品 id（礫石／金鑽礦／雲杉白樺板材／生金金錠鑽石／金鑽工具／鏟）與像素圖示"
  ```
  （commit 訊息要註明：**本批只補自己新增的 5 個方塊的物品形式**（B3 的 9 個方塊由 B3 補）、**物品表基數的實際數字**（例：`ALL_ITEM_IDS 54 → 72`）、以及鏡像清單實際補了幾個 id。）

---

### Task 3: 工具表擴充（採掘等級、金／鑽工具、鏟）＋攻擊傷害對齊原版

**Files:**
- Modify: `src/player/interact.ts`（`TOOL_INFO`、`toolDamage`）
- Modify: `src/player/interact.test.ts`

**Interfaces:**
- Consumes: Task 2 的 11 個新工具 id；Task 1 的 `requiredTool`（金／鑽礦＝level 2）。
- Produces（後續任務依賴）：
  - `src/player/interact.ts`：
    ```ts
    const TOOL_INFO: Readonly<Partial<Record<ItemId, { kind: ToolKind; level: number; speed: number }>>> = {
      wooden_pickaxe: { kind: 'pickaxe', level: 0, speed: 2 },
      stone_pickaxe:  { kind: 'pickaxe', level: 1, speed: 4 },
      iron_pickaxe:   { kind: 'pickaxe', level: 2, speed: 6 },
      golden_pickaxe: { kind: 'pickaxe', level: 0, speed: 12 },
      diamond_pickaxe:{ kind: 'pickaxe', level: 3, speed: 8 },
      wooden_axe: { kind: 'axe', level: 0, speed: 2 },
      stone_axe:  { kind: 'axe', level: 1, speed: 4 },
      iron_axe:   { kind: 'axe', level: 2, speed: 6 },
      golden_axe: { kind: 'axe', level: 0, speed: 12 },
      diamond_axe:{ kind: 'axe', level: 3, speed: 8 },
      wooden_shovel: { kind: 'shovel', level: 0, speed: 2 },
      stone_shovel:  { kind: 'shovel', level: 1, speed: 4 },
      iron_shovel:   { kind: 'shovel', level: 2, speed: 6 },
      golden_shovel: { kind: 'shovel', level: 0, speed: 12 },
      diamond_shovel:{ kind: 'shovel', level: 3, speed: 8 },
    };
    ```
    （**劍不入表**（劍不是工具：不加速挖掘、不滿足 `requiredTool`）——沿用現況註解。）
  - `toolDamage(heldItem: ItemId | null): number` 改為查表（見 Step 1 的完整期望值）。

- [ ] **Step 1: 寫／改測試（失敗）**

  `src/player/interact.test.ts`：
  - 既有 `'pickaxes deal 2 (all tiers, iron included)'` → **改寫**為 `'pickaxe damage matches vanilla'`：
    ```ts
    expect(toolDamage('wooden_pickaxe')).toBe(2);
    expect(toolDamage('stone_pickaxe')).toBe(3);
    expect(toolDamage('iron_pickaxe')).toBe(4);
    expect(toolDamage('golden_pickaxe')).toBe(2);
    expect(toolDamage('diamond_pickaxe')).toBe(5);
    ```
    （**改動理由（要寫進 commit 訊息）**：原表的鎬一律 2 是非原版行為；原版 木2／石3／鐵4／金2／鑽5。）
  - 既有 `'axes deal 3 (all tiers, iron included)'` → **改寫**為 `'axe damage matches vanilla'`：
    ```ts
    expect(toolDamage('wooden_axe')).toBe(7);
    expect(toolDamage('stone_axe')).toBe(9);
    expect(toolDamage('iron_axe')).toBe(9);
    expect(toolDamage('golden_axe')).toBe(7);
    expect(toolDamage('diamond_axe')).toBe(9);
    ```
    （**改動理由**：原表的斧一律 3 是非原版行為；原版 木7／金7／石鐵鑽9。）
  - 既有 `'swords: wooden 4, stone 5, iron 6 (one tier step each)'` → **改寫**為 `'sword damage matches vanilla'`（2026-10-20 稽核修正：加了金劍（4）與鑽劍（7）之後，「one tier step each」不再成立——金劍是 4、鑽劍是 7）：
    ```ts
    expect(toolDamage('wooden_sword')).toBe(4);
    expect(toolDamage('stone_sword')).toBe(5);
    expect(toolDamage('iron_sword')).toBe(6);
    expect(toolDamage('golden_sword')).toBe(4);
    expect(toolDamage('diamond_sword')).toBe(7);
    ```
  - 既有 `'non-weapons (apple, stick, blocks) fall back to 1'` → **拆成兩段**（2026-10-20 稽核修正：原計畫把鏟的傷害塞進「非武器 fallback 1」這個測試 → 測試名與內容矛盾）：
    - 既有測試**保留原名與原斷言**（apple／stick／方塊 → 1）。
    - 新增 `'shovel damage matches vanilla'`：`expect(toolDamage('wooden_shovel')).toBe(2.5); expect(toolDamage('stone_shovel')).toBe(3.5); expect(toolDamage('iron_shovel')).toBe(4.5); expect(toolDamage('golden_shovel')).toBe(2.5); expect(toolDamage('diamond_shovel')).toBe(5.5);`
  - 新 `'tool speed covers every tier including gold and diamond'`（表驅動，**必須按工具種類分三段**，2026-10-20 稽核修正：原計畫把 15 個案例（含 5 把斧、5 把鏟）**一律對 `BLOCK.STONE` 斷言** → 石頭的 `requiredTool.kind` 是 `'pickaxe'`，拿斧／鏟挖石頭回 **1**（不是 2/4/6/12/8）→ 該斷言必紅，且會逼實作者去改 `toolSpeed` 的種類比對語意、摧毀 B1.6 的「錯工具不加速」規則）：
    ```ts
    // 鎬 × 石頭（石頭的 requiredTool.kind = 'pickaxe'）
    const picks: Array<[ItemId, number]> = [
      ['wooden_pickaxe', 2], ['stone_pickaxe', 4], ['iron_pickaxe', 6], ['golden_pickaxe', 12], ['diamond_pickaxe', 8],
    ];
    for (const [item, speed] of picks) {
      expect(toolSpeed(BLOCK.STONE, { item, count: 1 })).toBe(speed);
    }
    // 斧 × 原木（原木的 fastTool = 'axe'）
    const axes: Array<[ItemId, number]> = [
      ['wooden_axe', 2], ['stone_axe', 4], ['iron_axe', 6], ['golden_axe', 12], ['diamond_axe', 8],
    ];
    for (const [item, speed] of axes) {
      expect(toolSpeed(BLOCK.OAK_LOG, { item, count: 1 })).toBe(speed);
    }
    // 鏟 × 泥土（泥土的 fastTool = 'shovel'）
    const shovels: Array<[ItemId, number]> = [
      ['wooden_shovel', 2], ['stone_shovel', 4], ['iron_shovel', 6], ['golden_shovel', 12], ['diamond_shovel', 8],
    ];
    for (const [item, speed] of shovels) {
      expect(toolSpeed(BLOCK.DIRT, { item, count: 1 })).toBe(speed);
    }
    ```
  - **既有 `'wrong kind is 1× (pickaxe on a log, axe on stone)'` 必須保留且照樣綠**（2026-10-20 稽核修正：它是「錯工具不加速」的守門，本批的 `toolSpeed` 邏輯**不動**）：
    ```ts
    expect(toolSpeed(BLOCK.STONE, { item: 'iron_axe', count: 1 })).toBe(1);  // 斧挖石頭 → 1×
    expect(toolSpeed(BLOCK.OAK_LOG, { item: 'iron_pickaxe', count: 1 })).toBe(1); // 鎬挖原木 → 1×
    ```
  - 新 `'the harvest tiers follow the vanilla table'`：
    ```ts
    expect(canHarvest(BLOCK.GOLD_ORE, { item: 'iron_pickaxe', count: 1 })).toBe(true);
    expect(canHarvest(BLOCK.GOLD_ORE, { item: 'diamond_pickaxe', count: 1 })).toBe(true);
    expect(canHarvest(BLOCK.GOLD_ORE, { item: 'stone_pickaxe', count: 1 })).toBe(false);
    expect(canHarvest(BLOCK.GOLD_ORE, { item: 'golden_pickaxe', count: 1 })).toBe(false);
    expect(canHarvest(BLOCK.DIAMOND_ORE, { item: 'iron_pickaxe', count: 1 })).toBe(true);
    expect(canHarvest(BLOCK.DIAMOND_ORE, { item: 'stone_pickaxe', count: 1 })).toBe(false);
    // 既有門檻不得被破壞
    expect(canHarvest(BLOCK.IRON_ORE, { item: 'stone_pickaxe', count: 1 })).toBe(true);
    expect(canHarvest(BLOCK.IRON_ORE, { item: 'wooden_pickaxe', count: 1 })).toBe(false);
    expect(canHarvest(BLOCK.STONE, { item: 'wooden_pickaxe', count: 1 })).toBe(true);
    ```
  - 新 `'a wrong-tier tool pays the x5 penalty and drops nothing'`（`getBreakTime` 精確秒數）：
    ```ts
    // 金礦硬度 3.0：鐵鎬（6×）可收穫 → 3.0 × 1.5 / 6 = 0.75s
    expect(getBreakTime(BLOCK.GOLD_ORE, { item: 'iron_pickaxe', count: 1 })).toBeCloseTo(0.75, 6);
    // 石鎬不可收穫 → 3.0 × 5 / 4 = 3.75s
    expect(getBreakTime(BLOCK.GOLD_ORE, { item: 'stone_pickaxe', count: 1 })).toBeCloseTo(3.75, 6);
    // 鑽鎬 8× → 3.0 × 1.5 / 8 = 0.5625s；金鎬（12×，但等級 0 不可收穫）→ 3.0 × 5 / 12 = 1.25s
    expect(getBreakTime(BLOCK.DIAMOND_ORE, { item: 'diamond_pickaxe', count: 1 })).toBeCloseTo(0.5625, 6);
    expect(getBreakTime(BLOCK.DIAMOND_ORE, { item: 'golden_pickaxe', count: 1 })).toBeCloseTo(1.25, 6);
    ```
  - 新 `'shovels finally mine the soil blocks fast'`：既有 `'shovel-fast blocks have no shovel item yet → 1× with anything'` → **改寫**為：
    ```ts
    expect(toolSpeed(BLOCK.DIRT, { item: 'wooden_shovel', count: 1 })).toBe(2);
    expect(toolSpeed(BLOCK.SAND, { item: 'iron_shovel', count: 1 })).toBe(6);
    expect(getBreakTime(BLOCK.DIRT, { item: 'iron_shovel', count: 1 })).toBeCloseTo(0.5 * 1.5 / 6, 6);
    ```
    （**改動理由**：`ItemId` 從來沒有鏟，所以鏟類方塊一直以 1× 挖；本批補上鏟後該測試的前提消失。）
  - 既有 `'bare hand, non-tools and swords: 1× (a sword is not a tool)'` 保留（劍仍不加速）。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/player/interact.test.ts` → Expected: FAIL。

- [ ] **Step 3: 實作 `interact.ts`**

  - `TOOL_INFO` 換成上表的 15 筆（鎬 5、斧 5、鏟 5；劍不入表）。
  - `toolDamage` 改為表驅動：
    ```ts
    const DAMAGE_TABLE: Readonly<Partial<Record<ItemId, number>>> = {
      wooden_pickaxe: 2, stone_pickaxe: 3, iron_pickaxe: 4, golden_pickaxe: 2, diamond_pickaxe: 5,
      wooden_axe: 7, stone_axe: 9, iron_axe: 9, golden_axe: 7, diamond_axe: 9,
      wooden_shovel: 2.5, stone_shovel: 3.5, iron_shovel: 4.5, golden_shovel: 2.5, diamond_shovel: 5.5,
      wooden_sword: 4, stone_sword: 5, iron_sword: 6, golden_sword: 4, diamond_sword: 7,
    };
    export function toolDamage(heldItem: ItemId | null): number {
      if (!heldItem) return 1;                       // 徒手 1（原版）
      const d = DAMAGE_TABLE[heldItem];
      return d === undefined ? 1 : d;
    }
    ```
  - `canHarvest`／`toolSpeed`／`getBreakTime` **不需改邏輯**（`requiredTool` 已由 Task 1 給好等級）——只需確認 `TOOL_INFO` 涵蓋新工具。**特別是 `toolSpeed` 的種類比對語意（`requiredTool?.kind ?? fastTool`）不得動**：既有測試 `'wrong kind is 1× (pickaxe on a log, axe on stone)'` 釘的就是它。
  - 註解更新：`TOOL_INFO` 的 doc 補「劍不在表內」「金鎬等級 0（不能收穫金礦）但速度 12」；`TOOL_INFO` 上方的現況註解寫著「Shovels are absent too（`ItemId` has none yet）」——**本批補了鏟，那句註解要刪掉並改成「shovels are present since B5」**。

- [ ] **Step 4: 跑測試轉綠**

  Run: `npx vitest run src/player/interact.test.ts` → Expected: PASS。

- [ ] **Step 5: 全量驗證**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → Expected: 全綠。

- [ ] **Step 6: Commit**

  ```bash
  git add src/player/interact.ts src/player/interact.test.ts
  git commit -m "feat(tools): B5.2 金鑽工具與鏟（速度 2/4/6/8/12、採掘等級 0-3）＋攻擊傷害對齊原版（原表鎬一律 2、斧一律 3 為非原版行為，本批修正）"
  ```

---

### Task 4: 合成配方擴充（31 份、any-planks、斧鏡像）

**Files:**
- Modify: `src/core/recipes.ts`（`PatternCell`、`RECIPES`、`matchShaped`）
- Modify: `src/core/recipes.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `spruce_planks / birch_planks / gold_ingot / diamond` 與 11 把新工具；**B3 提供的 `spruce_log`／`birch_log` 物品 id**（原木→板材配方要用；2026-10-20 稽核修正：B3 的物品形式由 B3 補，本批只引用）。
- Produces:
  - `src/core/recipes.ts`：
    ```ts
    /** A cell: one item id, a list of accepted ids ("any of"), or null (must be empty). */
    export type PatternCell = ItemId | ReadonlyArray<ItemId> | null;
    ```
  - `RECIPES` 共 **31 筆**（清單見〈Interfaces〉下方的表），含 5 把斧各 2 種鏡像排法。（31 ＝ 現況 13 ＋ 本批新增 18。**B2–B4 都沒有動過 `src/core/recipes.ts`**（B4 改的是 `src/world/furnace.ts` 的 `SMELT_RECIPES`），所以這裡的 13 是穩定的；但**測試斷言仍按 Step 1 的「讀現況 → 現況 + 18」寫法**，不寫死 31。）
  - `matchShaped` 的格比對改為 `cellMatches(want, have)`：
    ```ts
    function cellMatches(want: PatternCell, have: ItemId | null): boolean {
      if (want === null) return have === null;
      if (have === null) return false;
      if (typeof want === 'string') return want === have;
      return want.includes(have);
    }
    ```
    （**`patternBox`／`bbox` 的「非 null 即算有東西」判斷完全不用改**（2026-10-20 稽核修正：原計畫寫「只需把『非 null 即算有東西』的判斷改成 `!Array.isArray(...)` 也能過」——**那是錯的**：`patternBox` 用 `pat(r, c) === null` 判空格，若改成 `!Array.isArray(...)`，`ANY_PLANKS` 格會被當成空格 → 樣式 bbox 塌縮（例如 `wooden_pickaxe` 的 `PPP/.S./.S.` 變成 3×1）→ **任何木板配方都配不出來**。正確規則是：**陣列格不是 `null` → 算有東西 ✓**（`patternBox` 與 `bbox` 兩個函式都不動）。唯一要改的是 `matchShaped` 裡逐格比較的 `want !== have` → `cellMatches(want, have)`。）

- [ ] **Step 1: 寫／改測試（失敗）**

  `src/core/recipes.test.ts`：
  - 既有 `'holds exactly the <N> settled recipes, no extras'` → **改寫**為 `'holds exactly the <N + 18> settled recipes, no extras'`：`expect(RECIPES.length).toBe(<N + 18 的實際值>);`，並保留「id 唯一」的斷言。（**N ＝ 實作者讀到的現況配方數**；現況 13 → 本批 31。**測試裡寫死的是讀到的實際值**，不是計畫預先假設的絕對數字——上游若已加過配方（例：B6 的火把配方），N 就是別的數字，寫死 31 必紅。2026-10-20 終審修正。）
  - 既有 `'result counts: planks 4, stick 4, table 1, tools 1, furnace 1'` → 補 `spruce_planks`／`birch_planks` 產出 4 個。
  - 新 `'each wood type has its own planks recipe'`：
    ```ts
    expect(matchRecipe([{ item: 'spruce_log', count: 1 }], 2)).toEqual({ item: 'spruce_planks', count: 4 });
    expect(matchRecipe([{ item: 'birch_log', count: 1 }], 2)).toEqual({ item: 'birch_planks', count: 4 });
    expect(matchRecipe([{ item: 'oak_log', count: 1 }], 2)).toEqual({ item: 'oak_planks', count: 4 });
    // 1 根雲杉原木不可做出橡木板
    expect(matchRecipe([{ item: 'spruce_log', count: 1 }], 2)).not.toEqual({ item: 'oak_planks', count: 4 });
    ```
  - 新 `'wooden tools accept any planks'`：
    ```ts
    for (const plank of ['oak_planks', 'spruce_planks', 'birch_planks'] as const) {
      const grid: Array<ItemStack | null> = [
        { item: plank, count: 1 }, { item: plank, count: 1 }, { item: plank, count: 1 },
        null, { item: 'stick', count: 1 }, null,
        null, { item: 'stick', count: 1 }, null,
      ];
      expect(matchRecipe(grid, 3)).toEqual({ item: 'wooden_pickaxe', count: 1 });
    }
    ```
  - 新 `'an axe can be crafted in either mirrored orientation'`（**兩個網格都必須是 9 格**＝3×3 row-major，2026-10-20 稽核修正：原計畫給的是 6 格，而 `findRecipe` 有硬約束 `if (grid.length !== size * size) return null;`（`src/core/recipes.ts:281`）→ 6 格網格必然回 null，`toEqual({ item: 'stone_axe', count: 1 })` 無論實作多正確都不可能成立。**不得放寬那個長度檢查**（＝弱化既有不變量），網格要按原版形狀補成 9 格）：
    ```ts
    // 左斧：CC / CS / .S  → 佔 (0,0)(0,1)(1,0)(1,1)(2,1)
    const left: Array<ItemStack | null> = [
      { item: 'cobblestone', count: 1 }, { item: 'cobblestone', count: 1 }, null,
      { item: 'cobblestone', count: 1 }, { item: 'stick', count: 1 }, null,
      null, { item: 'stick', count: 1 }, null,
    ];
    // 右斧：CC / SC / S.  → 佔 (0,0)(0,1)(1,0)(1,1)(2,0)
    const right: Array<ItemStack | null> = [
      { item: 'cobblestone', count: 1 }, { item: 'cobblestone', count: 1 }, null,
      { item: 'stick', count: 1 }, { item: 'cobblestone', count: 1 }, null,
      { item: 'stick', count: 1 }, null, null,
    ];
    expect(left).toHaveLength(9);
    expect(right).toHaveLength(9);
    expect(matchRecipe(left, 3)).toEqual({ item: 'stone_axe', count: 1 });
    expect(matchRecipe(right, 3)).toEqual({ item: 'stone_axe', count: 1 });
    ```
  - 新 `'the mirrored axe layout is NOT matched by the original recipe id'`（防止 bbox 位移讓兩份配方其實同形；**給出具體網格與斷言**，2026-10-20 稽核修正：原計畫寫的是字面上的 `findRecipe([...], 3)` 空展開 → 沒有可執行的斷言）：
    ```ts
    const leftGrid: Array<ItemStack | null> = [
      { item: 'cobblestone', count: 1 }, { item: 'cobblestone', count: 1 }, null,
      { item: 'cobblestone', count: 1 }, { item: 'stick', count: 1 }, null,
      null, { item: 'stick', count: 1 }, null,
    ];
    const rightGrid: Array<ItemStack | null> = [
      { item: 'cobblestone', count: 1 }, { item: 'cobblestone', count: 1 }, null,
      { item: 'stick', count: 1 }, { item: 'cobblestone', count: 1 }, null,
      { item: 'stick', count: 1 }, null, null,
    ];
    expect(findRecipe(leftGrid, 3)?.id).toBe('stone_axe');
    expect(findRecipe(rightGrid, 3)?.id).toBe('stone_axe_mirrored');
    ```
    （兩份斧配方必須有**不同的 id**：`stone_axe` 與 `stone_axe_mirrored`；兩條都要斷言——先命中的順序會影響誰先回傳。）
  - 新 `'shovels craft from one material and two sticks'`（**9 格網格**，2026-10-20 稽核修正：原計畫給的是 3 格，同樣會被 `grid.length !== size*size` 擋掉。鏟的原版形狀是「素材在上、木棒豎排在下方兩格」＝`X` / `S` / `S` 佔 (0,0)(1,0)(2,0)）：
    ```ts
    const shovelGrid = (m: ItemId): Array<ItemStack | null> => [
      { item: m, count: 1 }, null, null,
      { item: 'stick', count: 1 }, null, null,
      { item: 'stick', count: 1 }, null, null,
    ];
    expect(matchRecipe(shovelGrid('cobblestone'), 3)).toEqual({ item: 'stone_shovel', count: 1 });
    expect(matchRecipe(shovelGrid('gold_ingot'), 3)).toEqual({ item: 'golden_shovel', count: 1 });
    expect(matchRecipe(shovelGrid('diamond'), 3)).toEqual({ item: 'diamond_shovel', count: 1 });
    ```
  - 新 `'gold and diamond tools craft from their ingot and the diamond'`（**9 格網格**，2026-10-20 稽核修正：原計畫的鑽石劍網格只有 3 格 → 同樣被長度檢查擋掉）：
    ```ts
    const goldenPickaxe: Array<ItemStack | null> = [
      { item: 'gold_ingot', count: 1 }, { item: 'gold_ingot', count: 1 }, { item: 'gold_ingot', count: 1 },
      null, { item: 'stick', count: 1 }, null,
      null, { item: 'stick', count: 1 }, null,
    ];
    expect(matchRecipe(goldenPickaxe, 3)).toEqual({ item: 'golden_pickaxe', count: 1 });
    // 劍：D / D / S 佔 (0,0)(1,0)(2,0)
    const diamondSword: Array<ItemStack | null> = [
      { item: 'diamond', count: 1 }, null, null,
      { item: 'diamond', count: 1 }, null, null,
      { item: 'stick', count: 1 }, null, null,
    ];
    expect(matchRecipe(diamondSword, 3)).toEqual({ item: 'diamond_sword', count: 1 });
    ```
  - **每個新網格都要 `expect(grid).toHaveLength(9)`**（或至少加一條 `for (const g of grids) expect(g.length).toBe(9)`）——把「網格長度必須是 `size²`」這個既有約束顯式釘在測試裡，實作者就不會再寫 3 格／6 格。
  - 既有 `'2×2 recipe matches in a 3×3 grid via bounding-box offset (bottom-right)'` 等既有案例全部保留（改動的是比對邏輯，不得回歸）。**既有案例的網格長度本來就是 4 或 9**，不要動。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/core/recipes.test.ts` → Expected: FAIL。

- [ ] **Step 3: 實作 `recipes.ts`**

  - `PatternCell` 改為 `ItemId | ReadonlyArray<ItemId> | null`；新增 `cellMatches`；`matchShaped` 改用它比對。
  - `RECIPES` 換成 31 筆（既有 13 筆保留 id 與排法；新增 18 筆）——（**基數說明**：B2–B4 都沒有改過 `src/core/recipes.ts`，所以落地時的現況就是 13 筆 → 13 + 18 = 31 筆。**若現況與 13 不符，以現況為準並在 commit 訊息註明實際值**；測試斷言一律按「讀現況 → 現況 + 18」寫，不寫死 31）：

    | # | id | kind | 形狀（`X`＝材質、`P`＝任意木板、`S`＝木棍、`.`＝空格） | 產出 |
    |---|---|---|---|---|
    | 1 | `log_to_planks` | shapeless | 1 橡木原木 | 4 `oak_planks` |
    | 2 | `spruce_log_to_planks` | shapeless | 1 雲杉原木 | 4 `spruce_planks` |
    | 3 | `birch_log_to_planks` | shapeless | 1 白樺原木 | 4 `birch_planks` |
    | 4 | `planks_to_stick` | shaped | `P` / `P`（直排） | 4 `stick` |
    | 5 | `planks_to_table` | shaped | 2×2 `P` | 1 `crafting_table` |
    | 6 | `wooden_pickaxe` | shaped | `PPP` / `.S.` / `.S.` | 1 `wooden_pickaxe` |
    | 7 | `wooden_axe` | shaped | `PP` / `PS` / `.S` | 1 `wooden_axe` |
    | 8 | `wooden_axe_mirrored` | shaped | `PP` / `SP` / `S.` | 1 `wooden_axe` |
    | 9 | `wooden_sword` | shaped | `P` / `P` / `S` | 1 `wooden_sword` |
    | 10 | `wooden_shovel` | shaped | `P` / `S` / `S` | 1 `wooden_shovel` |
    | 11 | `stone_pickaxe` | shaped | `CCC` / `.S.` / `.S.` | 1 `stone_pickaxe` |
    | 12 | `stone_axe` | shaped | `CC` / `CS` / `.S` | 1 `stone_axe` |
    | 13 | `stone_axe_mirrored` | shaped | `CC` / `SC` / `S.` | 1 `stone_axe` |
    | 14 | `stone_sword` | shaped | `C` / `C` / `S` | 1 `stone_sword` |
    | 15 | `stone_shovel` | shaped | `C` / `S` / `S` | 1 `stone_shovel` |
    | 16 | `iron_pickaxe` | shaped | `III` / `.S.` / `.S.` | 1 `iron_pickaxe` |
    | 17 | `iron_axe` | shaped | `II` / `IS` / `.S` | 1 `iron_axe` |
    | 18 | `iron_axe_mirrored` | shaped | `II` / `SI` / `S.` | 1 `iron_axe` |
    | 19 | `iron_sword` | shaped | `I` / `I` / `S` | 1 `iron_sword` |
    | 20 | `iron_shovel` | shaped | `I` / `S` / `S` | 1 `iron_shovel` |
    | 21 | `golden_pickaxe` | shaped | `GGG` / `.S.` / `.S.` | 1 `golden_pickaxe` |
    | 22 | `golden_axe` | shaped | `GG` / `GS` / `.S` | 1 `golden_axe` |
    | 23 | `golden_axe_mirrored` | shaped | `GG` / `SG` / `S.` | 1 `golden_axe` |
    | 24 | `golden_sword` | shaped | `G` / `G` / `S` | 1 `golden_sword` |
    | 25 | `golden_shovel` | shaped | `G` / `S` / `S` | 1 `golden_shovel` |
    | 26 | `diamond_pickaxe` | shaped | `DDD` / `.S.` / `.S.` | 1 `diamond_pickaxe` |
    | 27 | `diamond_axe` | shaped | `DD` / `DS` / `.S` | 1 `diamond_axe` |
    | 28 | `diamond_axe_mirrored` | shaped | `DD` / `SD` / `S.` | 1 `diamond_axe` |
    | 29 | `diamond_sword` | shaped | `D` / `D` / `S` | 1 `diamond_sword` |
    | 30 | `diamond_shovel` | shaped | `D` / `S` / `S` | 1 `diamond_shovel` |
    | 31 | `furnace` | shaped | 8 鵝卵石環（中間空） | 1 `furnace` |

    - **「任意木板」的格**：`const ANY_PLANKS: PatternCell = ['oak_planks', 'spruce_planks', 'birch_planks'];`（只用在 `P` 的位置；原木→板材的 shapeless 配方**必須**是精確 id，1 根雲杉原木只做雲杉木板）。
    - 斧的兩種排法（左／右）**必須是兩筆獨立配方**（id 帶 `_mirrored`），不能只靠 bbox 位移。
  - 註解更新：檔頭說明「shapeless 配方的輸入是精確 id（1 根雲杉原木只做雲杉木板）；shaped 配方支援多格（任意木板）」。

- [ ] **Step 4: 跑測試轉綠**

  Run: `npx vitest run src/core/recipes.test.ts` → Expected: PASS。

- [ ] **Step 5: 全量驗證**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → Expected: 全綠。

- [ ] **Step 6: Commit**

  ```bash
  git add src/core/recipes.ts src/core/recipes.test.ts
  git commit -m "feat(craft): B5.2 合成表擴充到 31 份（雲杉白樺板材、鏟、金鑽工具、斧左右鏡像、任意木板）"
  ```

---

### Task 5: 掉落表、熔爐與進度（新物品的取得路徑）

**Files:**
- Modify: `src/world/drops.ts`（`dropItemFor`）
- Modify: `src/world/drops.test.ts`
- Modify: `src/world/furnace.ts`（`SMELT_RECIPES`、`FUEL_VALUES`）
- Modify: `src/world/furnace.test.ts`
- Modify: `src/core/advancements.ts`（`AdvancementId`、`ADVANCEMENTS`、`OBTAIN_UNLOCKS`）
- Modify: `src/core/advancements.test.ts`

**Interfaces:**
- Consumes: Task 1／2 的新方塊與物品 id。
- Produces:
  - `dropItemFor(blockId: number): ItemId | null` 新增規則：
    | 方塊 | 掉落 | 理由 |
    |---|---|---|
    | `GOLD_ORE` | `raw_gold` | 原版：金礦掉生金（非礦石本體） |
    | `DIAMOND_ORE` | `diamond` | 原版：鑽石礦掉 1 顆鑽石 |
    | `GRAVEL` | `gravel` | 原版：礫石掉礫石 |
    | `ICE` | `null` | 原版：冰需要絲綢觸碰才掉（本作無絲綢觸碰） |
    | `DANDELION` / `POPPY` / `SHORT_GRASS` | 自身 | **刻意偏離原版**（原版花與草不掉）——為了讓 B3 的裝飾可再生、可重新種回；README〈與原版的差異〉明列 |
    | `SPRUCE_LOG` / `BIRCH_LOG` / `SPRUCE_PLANKS` / `BIRCH_PLANKS` | 自身 | 與既有原木／板材一致 |
    | `SPRUCE_LEAVES` / `BIRCH_LEAVES` | `null` | 與既有橡樹葉一致（絲綢觸碰限定；B4 的「葉子掉蘋果 0.5%」規則不動，B5 不碰） |
  - `SMELT_RECIPES` 新增：`raw_gold: 'gold_ingot'`、`gold_ore: 'gold_ingot'`（原版：金礦／生金都熔成金錠）。`diamond` **不可熔煉**（原版也不能）。
  - `FUEL_VALUES` 新增：`spruce_log: 1.5`、`birch_log: 1.5`、`spruce_planks: 1.5`、`birch_planks: 1.5`——**與 B4 落地後的 `oak_log: 1.5`／`oak_planks: 1.5` 對齊**（B4 已把燃料值校正成原版值：煤 8／原木 1.5／板材 1.5／木棍 0.5）。**批次順序前提（2026-10-20 稽核修正：已升級成 Global Constraints 的硬前提）**：若 B4 尚未落地、現況仍是整數 2，則**本任務的燃料部分必須排在 B4 之後**、**不得自行定 2**（否則同一批內兩個批次的燃料值不一致），**也不得先把斷言寫成 1.5**（那會在 B4 落地後變成紅燈）。
  - **B3 的方塊的掉落規則由本批接線**（2026-10-20 稽核修正：這是 B3 計畫明文交給 B5 的部分——B3 計畫說「本批只新增方塊，不新增 `ItemId`…花／草本批挖掉後不掉落」並把「可拾取」延後到 B5）：**物品形式（`ItemId`／`BLOCK_PAIRS`／圖示）仍由 B3 補，本批只寫 `dropItemFor` 的規則**——兩者分工不同，不算重做。
  - `src/core/advancements.ts`：
    ```ts
    export type AdvancementId = ...既有... | 'gold_age' | 'diamond_age' | 'golden_tool' | 'diamond_tool';
    ```
    `ADVANCEMENTS` 追加 4 筆：
    | id | title | description | icon |
    |---|---|---|---|
    | `gold_age` | 黃金時代 | 取得金錠 | `gold_ingot` |
    | `diamond_age` | 鑽石時代 | 取得鑽石 | `diamond` |
    | `golden_tool` | 金製工具 | 合成一把金製工具 | `golden_pickaxe` |
    | `diamond_tool` | 鑽製工具 | 合成一把鑽製工具 | `diamond_pickaxe` |
    `OBTAIN_UNLOCKS` 追加：`raw_gold`／`gold_ingot` → `gold_age`；`diamond` → `diamond_age`；`golden_pickaxe`／`golden_axe`／`golden_sword`／`golden_shovel` → `golden_tool`；`diamond_pickaxe`／`diamond_axe`／`diamond_sword`／`diamond_shovel` → `diamond_tool`；`spruce_log`／`birch_log` → `getting_wood`（既有 id 不新增，只擴充觸發來源）。

- [ ] **Step 1: 寫／改測試（失敗）**

  `src/world/drops.test.ts` 追加：
  - `'gold ore drops raw gold and diamond ore drops a diamond'`：
    ```ts
    expect(dropItemFor(BLOCK.GOLD_ORE)).toBe('raw_gold');
    expect(dropItemFor(BLOCK.DIAMOND_ORE)).toBe('diamond');
    ```
  - `'gravel drops gravel; ice drops nothing (silk touch only)'`：
    ```ts
    expect(dropItemFor(BLOCK.GRAVEL)).toBe('gravel');
    expect(dropItemFor(BLOCK.ICE)).toBeNull();
    ```
  - `'flowers and grass drop themselves so they can be replanted'`：
    ```ts
    expect(dropItemFor(BLOCK.DANDELION)).toBe('dandelion');
    expect(dropItemFor(BLOCK.POPPY)).toBe('poppy');
    expect(dropItemFor(BLOCK.SHORT_GRASS)).toBe('short_grass');
    ```
  - `'the new wood blocks map to their own items'`：
    ```ts
    expect(dropItemFor(BLOCK.SPRUCE_LOG)).toBe('spruce_log');
    expect(dropItemFor(BLOCK.BIRCH_LOG)).toBe('birch_log');
    expect(dropItemFor(BLOCK.SPRUCE_PLANKS)).toBe('spruce_planks');
    expect(dropItemFor(BLOCK.BIRCH_PLANKS)).toBe('birch_planks');
    // 樹葉與既有橡樹葉一致：絲綢觸碰限定 → 不掉落
    expect(dropItemFor(BLOCK.SPRUCE_LEAVES)).toBeNull();
    expect(dropItemFor(BLOCK.BIRCH_LEAVES)).toBeNull();
    ```
  - 既有 `'leaves/glass/snow drop nothing (silk-touch-only drops)'` 保留（**不得**順手改成掉自身）。

  `src/world/furnace.test.ts` 追加／修改：
  - 既有 `'smelt takes 10 s; raw_iron/iron_ore→iron_ingot and sand→glass; coal_ore excluded'` 的 `toEqual` 期望值要更新（`SMELT_RECIPES` 多 `raw_gold`／`gold_ore` 兩筆、`FUEL_VALUES` 多 4 筆新木材）——**以 B4 落地後的實際表為基準**（B4 已加 4 條生肉食譜並把燃料值改成小數），不是以現況的 3 筆食譜為基準。
  - 新 `'raw gold and gold ore smelt into a gold ingot'`：
    ```ts
    expect(SMELT_RECIPES.raw_gold).toBe('gold_ingot');
    expect(SMELT_RECIPES.gold_ore).toBe('gold_ingot');
    expect(SMELT_RECIPES.diamond).toBeUndefined();
    ```
  - 新 `'the new logs and planks are fuel'`：`expect(FUEL_VALUES.spruce_log).toBe(1.5); expect(FUEL_VALUES.birch_planks).toBe(1.5);`（值＝B4 校正後的原木／板材燃料值；**B4 未落地時這條斷言不得先寫——先等 B4**，見 Global Constraints 的批次順序前提）。

  `src/core/advancements.test.ts` 追加：
  - `'obtaining gold or a diamond unlocks the new advancements'`：
    ```ts
    for (const item of ['raw_gold', 'gold_ingot'] as const) {
      const r = checkAdvancements(emptyAdvancements(), { type: 'obtain', item, mode: 'survival' });
      expect(r.unlocked).toEqual(['gold_age']);
    }
    const d = checkAdvancements(emptyAdvancements(), { type: 'obtain', item: 'diamond', mode: 'survival' });
    expect(d.unlocked).toEqual(['diamond_age']);
    ```
  - `'gold and diamond tools unlock their tool advancements'`：`golden_pickaxe` → `golden_tool`；`diamond_sword` → `diamond_tool`。
  - `'spruce and birch logs count as getting wood'`：`spruce_log` → `getting_wood`。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/world/drops.test.ts src/world/furnace.test.ts src/core/advancements.test.ts` → Expected: FAIL。

- [ ] **Step 3: 實作**

  - `drops.ts` 的 `dropItemFor` 加上表中的規則（`ICE` 要加進「不掉落」那一列；`SPRUCE_LEAVES`／`BIRCH_LEAVES` 同樣加進去；`BLOCK.LEAVES` 維持 null——**白樺／雲杉樹葉不落蘋果**是 B4 的既有規則，B5 不動）。
  - `furnace.ts`：`SMELT_RECIPES` 加 `raw_gold`／`gold_ore`；`FUEL_VALUES` 加 4 筆新木材（1.5）。
  - `advancements.ts`：加 4 個 id、4 筆 `ADVANCEMENTS`、`OBTAIN_UNLOCKS` 的觸發。

- [ ] **Step 4: 跑測試轉綠**

  Run: `npx vitest run src/world/drops.test.ts src/world/furnace.test.ts src/core/advancements.test.ts` → Expected: PASS。

- [ ] **Step 5: 全量驗證**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → Expected: 全綠。

- [ ] **Step 6: Commit**

  ```bash
  git add src/world/drops.ts src/world/drops.test.ts src/world/furnace.ts src/world/furnace.test.ts src/core/advancements.ts src/core/advancements.test.ts
  git commit -m "feat(drops): B5.1/5.2 金鑽礦掉落、生金熔金錠、花草可再生、新木材可當燃料與四個新進度"
  ```

---

### Task 6: 礦脈生成（深度映射 ＋ 密度模型 ＋ 統計測試）

**Files:**
- Create: `src/world/ores.ts`、`src/world/ores.test.ts`、`src/world/ores-stats.test.ts`
- Modify: `src/world/terrain.ts`（`generateChunk` 改呼叫 `placeOres`）
- Modify: `src/world/terrain.test.ts`（既有「contains coal and iron ore」測試改寫）
- Modify（**B3 建立；若尚未存在則本任務一併建立**）：`src/world/worldgen.ts`（`WORLDGEN_VERSION` 1 → 2）、`src/world/worldgen.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `BLOCK.GOLD_ORE / DIAMOND_ORE / GRAVEL`；B3 的 `terrain.ts` 結構（`generateChunk(cx, cz, seed)`、`CHUNK_HEIGHT`、`chunkIndex`）。
- Produces（`src/world/ores.ts`）：
  ```ts
  /** 原版海平面（水的最高一格）＝本作海平面 62 —— 映射的共同錨點。 */
  export const VANILLA_SEA_LEVEL = 62;
  /** 原版基岩層 Y = −64 —— 映射的另一個錨點。 */
  export const VANILLA_FLOOR = -64;
  /** 深度壓縮係數：本作地下 62 格 ÷ 原版地下 126 格。 */
  export const DEPTH_COMPRESSION = 62 / 126;
  /** 原版 Y → 本作 Y。 */
  export function mapVanillaY(yVanilla: number): number;
  /** 本作 Y → 原版 Y（反向，供權重查表用）。 */
  export function unmapVanillaY(yGame: number): number;

  export type OreShape = 'uniform' | 'triangle' | 'ramp';
  export interface OreSpec {
    block: number;          // BLOCK.*
    minY: number;           // 本作 Y 的帶下緣（含）
    maxY: number;           // 本作 Y 的帶上緣（含）
    shape: OreShape;
    peakY: number;          // triangle 的峰；ramp 的帶下緣
    halfWidth: number;      // triangle 的半寬
    baseChance: number;     // 每格在 weight=1 時的機率
    salt: number;           // 雜湊鹽值（每種礦不同）
  }
  export const ORES: ReadonlyArray<OreSpec>;
  export function oreWeight(spec: OreSpec, y: number): number;   // 0..1
  export function placeOres(data: Uint8Array, cx: number, cz: number, seed: number): void;
  ```
  - `WORLDGEN_VERSION` 由 1 改為 **2**（本批改變地形外觀：新增礫石與礦脈帶）——既有存檔載入時會跳一次「地形已改變」提示（B3 的既有機制）。

- [ ] **Step 1: 寫測試（失敗）**

  `src/world/ores.test.ts`（單元）：
  - `'the vanilla to game depth mapping keeps both anchors'`：
    ```ts
    expect(mapVanillaY(62)).toBeCloseTo(62, 6);     // 海平面對齊
    expect(mapVanillaY(-64)).toBeCloseTo(0, 6);      // 基岩對齊
    expect(mapVanillaY(0)).toBeCloseTo(31.492063, 4);
    ```
  - `'the mapping is a round trip'`：`for (const yv of [-64, -58, -16, 0, 16, 32, 62]) expect(unmapVanillaY(mapVanillaY(yv))).toBeCloseTo(yv, 6);`
  - `'the mapped ore bands follow the vanilla ranges'`：
    ```ts
    const gold = ORES.find((o) => o.block === BLOCK.GOLD_ORE)!;
    expect(gold.minY).toBe(0);
    expect(gold.maxY).toBe(47);
    expect(gold.peakY).toBe(24);
    const diamond = ORES.find((o) => o.block === BLOCK.DIAMOND_ORE)!;
    expect(diamond.minY).toBe(1);
    expect(diamond.maxY).toBe(39);
    ```
  - `'the weight shape is what the design says'`：
    ```ts
    const gold = ORES.find((o) => o.block === BLOCK.GOLD_ORE)!;
    expect(oreWeight(gold, gold.peakY)).toBeCloseTo(1, 6);
    expect(oreWeight(gold, gold.minY)).toBeCloseTo(0, 6);
    expect(oreWeight(gold, gold.maxY + 1)).toBe(0);
    const diamond = ORES.find((o) => o.block === BLOCK.DIAMOND_ORE)!;
    expect(oreWeight(diamond, diamond.minY)).toBeCloseTo(1, 6);
    expect(oreWeight(diamond, diamond.maxY)).toBeCloseTo(0, 6);
    expect(oreWeight(diamond, 20)).toBeLessThan(oreWeight(diamond, 5)); // 越深越常見
    ```
  - `'ore generation is deterministic'`：同一 chunk 兩次生成 → 位元組完全相同（沿用 `terrain.test.ts` 的 `bytesEqual` 寫法）。

  `src/world/ores-stats.test.ts`（統計；固定種子 1337，取 4×4＝16 個區塊 `(cx,cz) ∈ [0,4)²`）：
  - `'gold only generates inside its mapped band'`：掃描所有 GOLD_ORE 格 → `y` 必 ∈ [0, 47]。
  - `'diamond only generates inside its mapped band'`：所有 DIAMOND_ORE 格 → `y` 必 ∈ [1, 39]。
  - `'iron only generates inside its mapped band'`：所有 IRON_ORE 格 → `y` 必 ∈ [0, 67]。
  - `'gold peaks around the mapped vanilla peak (y=24)'`：金礦的 y 直方圖中位數 ∈ [16, 32]。
  - `'diamond is more common the deeper it is'`：鑽石 y 的中位數 ∈ [1, 16]（權重是 (39−y)/38 的線性遞減，解析中位數 ≈ **11.3**（2026-10-20 稽核修正：原計畫寫 ≈ 12.1，是用錯公式算出來的；`w(y)=(39−y)/38`、y∈[1,39] 的累積過半落在 y≈11.3）；容差要涵蓋抽樣誤差，且**不得為了變綠而收窄**）；且「y ≤ 10 的鑽石數」>「y ≥ 25 的鑽石數」。
  - `'the ore volume per 16 chunks matches the design'`（16 個區塊 = 4096 柱）：
    ```ts
    expect(gold).toBeGreaterThanOrEqual(40);
    expect(gold).toBeLessThanOrEqual(220);
    expect(diamond).toBeGreaterThanOrEqual(15);
    expect(diamond).toBeLessThanOrEqual(120);
    expect(iron).toBeGreaterThanOrEqual(200);
    expect(iron).toBeLessThanOrEqual(1000);
    expect(gravel).toBeGreaterThanOrEqual(60);
    expect(gravel).toBeLessThanOrEqual(420);
    ```
    （這些區間來自〈已查證與設計決策〉§5 的預期值 × 16 區塊；**若實測落在區間外，先確認實作符合規格，再調整常數或容差，並在 commit 訊息說明**——不得為了變綠而任意放寬。）
  - 用 `it('...', { timeout: 30000 }, ...)`。

  `src/world/terrain.test.ts`：既有 `'contains coal and iron ore'` → **改寫**為 `'contains coal, iron, gold, diamond and gravel'`：
  ```ts
  // 鐵礦不再限制在 y<16（原版鐵礦帶是 Y=−64..72 → 本作 0..67），其餘斷言保留
  expect(iron).toBeGreaterThan(0);
  expect(gold).toBeGreaterThan(0);
  expect(diamond).toBeGreaterThan(0);
  expect(gravel).toBeGreaterThan(0);
  ```
  （**改動理由**：本批把鐵礦的深度帶對齊原版映射，`expect(y).toBeLessThan(16)` 的前提消失。）

  `src/world/worldgen.test.ts`：既有 `'the worldgen version is 1'` → 改為 `'the worldgen version is 2'`（`expect(WORLDGEN_VERSION).toBe(2)`；B5 改了地形外觀，版本必須往上加——B3 計畫明文要求）。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/world/ores.test.ts src/world/ores-stats.test.ts src/world/terrain.test.ts src/world/worldgen.test.ts` → Expected: FAIL（模組不存在）。

- [ ] **Step 3: 實作 `src/world/ores.ts`**

  - 映射：
    ```ts
    export const VANILLA_SEA_LEVEL = 62;
    export const VANILLA_FLOOR = -64;
    export const DEPTH_COMPRESSION = 62 / 126;                 // 0.492063492…
    const OFFSET = VANILLA_SEA_LEVEL * (1 - DEPTH_COMPRESSION); // 31.49206349…
    export function mapVanillaY(yVanilla: number): number {
      return OFFSET + DEPTH_COMPRESSION * yVanilla;
    }
    export function unmapVanillaY(yGame: number): number {
      return (yGame - OFFSET) / DEPTH_COMPRESSION;
    }
    ```
  - `ORES` 表（band／shape／peak／halfWidth／baseChance／salt）：
    ```ts
    export const ORES: ReadonlyArray<OreSpec> = [
      { block: BLOCK.COAL_ORE,     minY: 0, maxY: 126, shape: 'uniform',  peakY: 0,  halfWidth: 0,  baseChance: 1 / 120,  salt: 0x51a3c7e1 },
      { block: BLOCK.IRON_ORE,     minY: 0, maxY: 67,  shape: 'triangle', peakY: 39, halfWidth: 39, baseChance: 1 / 260,  salt: 0x2f8b1d55 },
      { block: BLOCK.GOLD_ORE,     minY: 0, maxY: 47,  shape: 'triangle', peakY: 24, halfWidth: 24, baseChance: 1 / 900,  salt: 0x7c1d9a03 },
      { block: BLOCK.DIAMOND_ORE, minY: 1, maxY: 39,  shape: 'ramp',     peakY: 1,  halfWidth: 0,  baseChance: 1 / 1400, salt: 0x3b5e2f77 },
      { block: BLOCK.GRAVEL,       minY: 0, maxY: 60,  shape: 'uniform',  peakY: 0,  halfWidth: 0,  baseChance: 1 / 1200, salt: 0x6c9a41bb },
    ];
    ```
  - `oreWeight(spec, y)`：
    ```ts
    if (y < spec.minY || y > spec.maxY) return 0;
    if (spec.shape === 'uniform') return 1;
    if (spec.shape === 'ramp') return (spec.maxY - y) / (spec.maxY - spec.minY);
    return Math.max(0, 1 - Math.abs(y - spec.peakY) / spec.halfWidth);
    ```
  - `placeOres(data, cx, cz, seed)`：對 chunk 內每個柱 `(lx, lz)`、每個 `y`：
    1. 讀 `data[chunkIndex(lx, y, lz)]`；**不是 `BLOCK.STONE` 就跳過**（礦只取代石頭；泥土／水／空氣不換——洞穴是空氣，所以洞穴裡不會長礦）。
    2. 對 `ORES` 每一筆：`w = oreWeight(spec, y)`；`w === 0` 跳過（帶外不擲骰，效能關鍵）。
    3. 擲骰（`wx`／`wz` 為世界座標、`seed` 為世界種子）：
       ```ts
       const h = hash2(
         (wx * 73856093) ^ (y * 19349663) ^ spec.salt,
         (wz * 83492791) ^ ((y + 1) * 2654435761),
         seed,
       );
       const r = h / 4294967296;
       if (r < spec.baseChance * w) { data[i] = spec.block; break; }
       ```
       （用 XOR 混合而不是 `wx * 131 + y * 7`——後者會讓 `(wx+7, y−131)` 與 `(wx, y)` 撞同一個輸入，產生斜向條紋；`hash2` 的第三參數是 seed，**鹽值要混進座標**（`spec.salt`），不是混進 seed。）
    4. **先到先得**：一個格子只放一種礦（`break`）。
    5. 只在 `y >= 1 && y < CHUNK_HEIGHT` 內寫入（y=0 是基岩層，不換）。
  - 檔頭 doc 註解寫明：映射方法（兩錨點、壓縮係數）、為什麼煤炭不重排、為什麼用逐格密度而不是 blob 礦脈。

- [ ] **Step 4: `terrain.ts` 接上 `placeOres`**

  - 刪掉 `generateChunk` 內嵌的礦石程式碼（`if (id === BLOCK.STONE && y < h - 6) { … }`）。
  - 在 `generateChunk` 的**填地形＋切洞穴迴圈結束之後、`plantTrees(...)` 之前**呼叫 `placeOres(data, cx, cz, seed)`。
    - **順序為什麼這樣等價**：現況是「先放礦、再切洞穴」→ 洞穴裡的礦被挖掉；改成「先切洞穴、再放礦」→ 洞穴格是空氣不是石頭，`placeOres` 只取代石頭 → 洞穴裡同樣沒有礦。兩種順序的最終地圖相同，但**不用重寫 `generateChunk` 的單一迴圈**（不重寫＝不打亂 B3 對 `generateChunk` 的改動）。
    - **唯一差異**：現況的礦石還卡 `y < h − 6`（地表下兩層是無礦石頭），`placeOres` 放寬成「整個石頭層」——純外觀差異，兩層。
    - **效能**：`placeOres` 逐格掃 16×16×256 = 65,536 格，但只有石頭格會擲骰（每格最多 5 次，且帶外 `w === 0` 直接跳過）→ 實測約 4–6 ms／區塊（B3 的預算是 ≤ 8 ms）。若實測超過 8 ms，先檢查有沒有漏掉「帶外跳過」與「非石頭跳過」兩個短路。
  - 洞穴切挖之後不要再放礦（保持現況的「洞穴裡的礦被挖掉」）。

- [ ] **Step 5: `worldgen.ts` 升版**

  - `WORLDGEN_VERSION = 1` → `2`；檔頭註解說明「B5 新增礫石與礦脈深度帶 → 地形外觀改變 → 舊存檔會跳一次『地形已改變』提示」。

- [ ] **Step 6: 跑測試轉綠**

  Run: `npx vitest run src/world/ores.test.ts src/world/ores-stats.test.ts src/world/terrain.test.ts src/world/worldgen.test.ts` → Expected: PASS。

- [ ] **Step 7: 全量驗證＋人工**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → Expected: 全綠。
  人工（記錄結果）：`npm run dev` → 開新世界，往下挖：應在 **y≈24** 附近遇到金礦、**y≈1–10** 遇到鑽石礦、**y≈39** 附近鐵礦較多、**y≈5–40** 有礫石；用 F3 看 Y 座標確認。

- [ ] **Step 8: Commit**

  ```bash
  git add src/world/ores.ts src/world/ores.test.ts src/world/ores-stats.test.ts src/world/terrain.ts src/world/terrain.test.ts src/world/worldgen.ts src/world/worldgen.test.ts
  git commit -m "feat(worldgen): B5.1 金礦／鑽石礦／礫石的深度分佈（原版 Y→本作 0–255 映射）＋WORLDGEN_VERSION 升 2"
  ```

---

### Task 7: 36 格背包核心模型 ＋ 本機 payload v4（遷移）

**Files:**
- Modify: `src/core/items.ts`（新增寬度常數、`starterSlots` 改 36 格）
- Modify: `src/core/items.test.ts`
- Modify: `src/core/mode-stash.ts`（槽位數 9 → 36 ＋ 註解）
- Modify: `src/world/save.ts`（payload v4 ＋ v1/v2/v3 → v4 遷移）
- Modify: `src/world/save.test.ts`
- Modify: `src/ui/crafting.ts`（來源列維持前 9 格，Task 8 再加 `sourceCount`）
- Modify: `src/main.ts`（變數改名 `hotbar` → `slots`；其餘接線）

**Interfaces:**
- Consumes: Task 2 的物品表。
- Produces:
  - `src/core/items.ts`：
    ```ts
    /** 熱鍵列格數（也是遊戲手持列的索引範圍 0..8）。 */
    export const HOTBAR_SLOTS = 9;
    /** 主背包格數（3 列 × 9）。 */
    export const MAIN_SLOTS = 27;
    /** 背包總格數：前 9 格是熱鍵列，之後 27 格是主背包。 */
    export const INVENTORY_SLOTS = HOTBAR_SLOTS + MAIN_SLOTS; // 36
    ```
    - `starterSlots(mode)` **回傳 36 格**：生存＝36 個 `null`；創造＝前 9 格是 `HOTBAR_DEFAULT` 的滿堆疊、其餘 27 格 `null`。
  - `src/core/mode-stash.ts`：`SLOTS_PER_MODE` 由 `starterSlots('survival').length` 取得 → **自動變成 36**（不需改常數，但註解要改）。
  - `src/world/save.ts`：
    ```ts
    export interface SavePayloadV4 extends Omit<SavePayloadV3, 'version'> {
      version: 4;
    }
    export type SavePayload = SavePayloadV4;
    ```
    - `isValidSavePayload` 接受 `version ∈ {1, 2, 3, 4}`。
    - `loadGame()` **一律回傳 v4**：`player.inventory` 與 `stash.survival`／`stash.creative` 都是 36 格（`sanitizeSlots(x, INVENTORY_SLOTS)`：不足補 null、超過截斷）。
    - `collectSavePayload` 的三個槽位陣列一律 36 格。
    - **B4 的 `passiveMobs` 附加欄位原樣保留**（2026-10-20 稽核修正／跨批介面）：`SavePayloadV4 extends Omit<SavePayloadV3, 'version'>` 會繼承 B4 加的可選欄位 `passiveMobs?: PassiveMobRecord[]`；**本批只改背包寬度，不動生物欄位** → `loadGame` 的 v3→v4 遷移不得丟掉 `passiveMobs`，`collectSavePayload` 也要照原樣帶上它（B4 已加的 `SaveSources.passiveMobs` 欄位沿用）。

- [ ] **Step 1: 寫／改測試（失敗）**

  `src/core/items.test.ts`：
  - 既有 `'starterSlots is a full hotbar of nulls in survival (fits() must have slack)'` → 改為：
    ```ts
    const slots = starterSlots('survival');
    expect(slots).toHaveLength(36);
    expect(slots).toHaveLength(INVENTORY_SLOTS);
    expect(slots.every((s) => s === null)).toBe(true);
    ```
    （**改動理由**：B5 把背包從 9 格擴成 36 格；這是形狀變更，不是弱化。）
  - 既有 `'starterSlots is the default block kit at max stacks in creative'` → 改為：
    ```ts
    const creative = starterSlots('creative');
    expect(creative).toHaveLength(36);
    expect(creative.slice(0, 9)).toEqual(HOTBAR_DEFAULT.map((b) => stackFromBlock(b)));
    expect(creative.slice(9).every((s) => s === null)).toBe(true);
    ```
  - 新 `'the inventory width constants describe the vanilla layout'`：
    ```ts
    expect(HOTBAR_SLOTS).toBe(9);
    expect(MAIN_SLOTS).toBe(27);
    expect(INVENTORY_SLOTS).toBe(36);
    ```

  `src/world/save.test.ts`：
  - **新增 `makeV3Payload()` fixture**（2026-10-20 稽核修正：計畫引用了這個 fixture，但現況 `save.test.ts` 只有 `makePayload`／`makeV1Payload`／`makeV2Payload`——**必須在這個任務新增**，否則下面的 v3→v4 遷移測試編譯不過）：
    ```ts
    /** A raw v3 record exactly as a pre-B5 build wrote it (9-slot inventory,
     *  dual-mode stash, advancements). */
    function makeV3Payload(): SavePayloadV3 {
      return {
        version: 3,
        savedAt: 0,
        worldSeed: 1337,
        modified: [['5,70,5', 1]],
        player: {
          pos: [1.5, 64, -3.25],
          yaw: 0.75,
          mode: 'survival',
          vitals: createVitals(),
          inventory: [{ item: 'stone', count: 32 }, null, { item: 'wooden_pickaxe', count: 1 }],
        },
        time: { t: 0.42 },
        advancements: { done: { getting_wood: true }, nightSeen: false },
        stash: {
          survival: slots({ item: 'dirt', count: 3 }),
          creative: slots({ item: 'stone', count: 64 }),
          survivalVitals: { ...createVitals(), hp: 12 },
        },
      };
    }
    ```
    （需要 `import { type SavePayloadV3 } from './save';`；`slots()` helper 仍是 9 格寬——v3 記錄本來就是 9 格。）
  - `makePayload()` fixture：`version: 4`；`player.inventory` 與 `stash.survival`／`stash.creative` 改成 **36 格**（`slots()` helper 改成 `width = INVENTORY_SLOTS`：`function slots(...items) { return [...items, ...new Array(INVENTORY_SLOTS - items.length).fill(null)]; }`）。
  - 既有 `'migrates a raw v1 record to v3 with derived stash and empty advancements'` → 改名為 `'migrates a raw v1 record to v4 …'`，斷言：
    ```ts
    expect(loaded!.version).toBe(4);
    expect(loaded!.player.inventory).toHaveLength(36);
    expect(loaded!.player.inventory[0]).toEqual({ item: 'stone', count: 32 });
    expect(loaded!.player.inventory.slice(1)).toEqual(new Array(35).fill(null));
    expect(loaded!.stash.survival).toHaveLength(36);
    ```
    （**關鍵斷言**：舊的 9 格必須落在**前 9 格（熱鍵列）**，其餘留空。）
  - 既有 `'migrates a raw v2 record to v3, deriving stash from the recorded mode'` → 改名為 v4，並加同樣的 36 格斷言（該 fixture 的 mode 是 creative → `stash.creative` 前 9 格＝`oak_planks` 12 個）。
  - 既有 `'derives the stash when a v3 record carries a corrupt or missing one'` → 改為 v4 fixture，且斷言 stash 兩側都是 36 格。
  - 新 `'migrates a raw v3 record to v4 and keeps the nine old slots in the hotbar row'`：
    ```ts
    const v3 = { ...makeV3Payload(), version: 3, player: { ...makeV3Payload().player, inventory: [{ item: 'dirt', count: 5 }, { item: 'stone', count: 1 }] } };
    await putRawRecord(v3);
    const loaded = await loadGame();
    expect(loaded!.version).toBe(4);
    expect(loaded!.player.inventory[0]).toEqual({ item: 'dirt', count: 5 });
    expect(loaded!.player.inventory[1]).toEqual({ item: 'stone', count: 1 });
    expect(loaded!.player.inventory[2]).toBeNull();
    expect(loaded!.player.inventory).toHaveLength(36);
    ```
  - **跨批介面：B4 的 `passiveMobs` 附加欄位必須在 v3→v4 遷移中保留下來**（2026-10-20 稽核修正：B4 的 `SavePayloadV3` 已有可選欄位 `passiveMobs?: PassiveMobRecord[]`，`SavePayloadV4 extends Omit<SavePayloadV3, 'version'>` 會自動繼承它 → **遷移不得丟掉**）：
    ```ts
    const v3 = { ...makeV3Payload(), version: 3, passiveMobs: [{ kind: 'cow', x: 1, y: 2, z: 3, hp: 10, yaw: 0 }] };
    await putRawRecord(v3);
    const loaded = await loadGame();
    expect(loaded!.passiveMobs).toEqual([{ kind: 'cow', x: 1, y: 2, z: 3, hp: 10, yaw: 0 }]);
    ```
    （**若 B4 尚未落地**，v3 記錄沒有這個欄位 → 這條斷言要等 B4 落地後才寫；本批的 v4 只改背包寬度，不動生物欄位。）
  - 新 `'a v4 record with a wrong slot count is padded or truncated'`：寫入 3 格與 40 格的 v4 記錄 → 讀回一律 36 格（多餘的截斷）。
  - 既有 `'rejects a record with an unsupported version'`：`{version: 4}` → 改成 `{version: 5}`。
  - 既有 `'accepts a fully valid payload (v1, v2 and v3 all pass base validation)'` → 改成 v1／v2／v3／v4 都通過。
  - 既有 `'collectSavePayload deep-copies the stash (no aliasing)'` 與 `'assembles version, seed, modified, clock, advancements and stash from the sources'`：fixture 的槽位改成 36 格（`expect(payload.version).toBe(4)`）。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/core/items.test.ts src/world/save.test.ts` → Expected: FAIL。

- [ ] **Step 3: 實作 `items.ts` 的寬度常數與 `starterSlots`**

  ```ts
  export const HOTBAR_SLOTS = 9;
  export const MAIN_SLOTS = 27;
  export const INVENTORY_SLOTS = HOTBAR_SLOTS + MAIN_SLOTS;

  export function starterSlots(mode: 'survival' | 'creative'): Array<ItemStack | null> {
    if (mode === 'survival') return new Array<ItemStack | null>(INVENTORY_SLOTS).fill(null);
    const kit = HOTBAR_DEFAULT.map((b) => stackFromBlock(b));
    return [...kit, ...new Array<ItemStack | null>(INVENTORY_SLOTS - kit.length).fill(null)];
  }
  ```
  （註解同步：「生存 36 格全空（留白給 `fits()` 的空間）」「創造＝前 9 格預設方塊組，其餘 27 格空——完整物品由創造面板的清單提供」。）

- [ ] **Step 4: 實作 `save.ts` 的 v4**

  - 新增 `SavePayloadV4`；`export type SavePayload = SavePayloadV4;`（保留 V1／V2／V3 供遷移）。
  - `isValidSavePayload`：`r.version !== 1 && … && r.version !== 4 → false`。
  - `collectSavePayload`：`version: 4`；三個槽位陣列用 `sanitizeSlots(x, INVENTORY_SLOTS)`（保證 36 格且不 alias）。
  - `loadGame`：回傳物件改 `version: 4`；`player.inventory: sanitizeSlots(v2.player.inventory, INVENTORY_SLOTS)`；`stash: normalizeModeStash(...)`（其內部 `SLOTS_PER_MODE` 已是 36 → 自動補齊）。
  - 檔頭 doc 註解改寫：v1→v2（進度）→v3（雙模式）→v4（36 格）；說明「舊 9 格 → 熱鍵列、其餘留空」。

- [ ] **Step 5: `main.ts` 的變數改名與接線**

  - 把 `const hotbar = inventory.slots;` 改名為 `const slots = inventory.slots;`，全檔把 `hotbar` 的引用一併改名（`hotbar[` → `slots[`、`hotbar.length` → `slots.length`、傳給 `hud.setHotbar(...)` 的引數改名）。**注意**：`hud.setHotbar` 只迭代 **HUD 自己的 9 個 slot 元素**（`src/ui/hud.ts` 第 55 行的建立迴圈與第 102 行的更新迴圈都是 `i < 9`），它讀 `list[i]`、`i < 9` → **不需要改 `hud.ts`**（2026-10-20 稽核修正：原敘述「`for (let i = 0; i < slots.length; i++)` 迴圈是 HUD 自己的 9 格陣列」語意繞，容易讓實作者誤以為要改 hud.ts）。
  - `continueGame()` 的還原迴圈：`sanitizeSlots(payload.player.inventory, slots.length)`（=36）→ 前 9 格是舊資料、其餘留空 ✓。
  - `applyCloudData()` 的還原迴圈同樣改成 `slots.length`。
  - `startGame()` 的清空迴圈：`for (let i = 0; i < slots.length; i++) inventory.setSlot(i, fresh[i] ?? null);`（36 格）✓。
  - `craftingParams(size)`：`hotbar: hotbar` → `hotbar: slots`（傳**同一個活的 36 格陣列**，不要 `slice`——`crafting.ts` 每次 render 都重讀 `params.hotbar`，切片會變成過期快照）。**Task 7 的合成來源列維持 9 格**（2026-10-20 稽核修正：原計畫寫「Task 7 單獨跑時合成區的來源列會暫時是 36 格」——現行 `mountCrafting` 是 `params.hotbar.forEach` 渲染全部，改名 `hotbar` → `slots` 的**同時**就要把渲染上限設成前 9 格，否則中間狀態會讓 2×2 面板多出 27 格來源列）：**在這個任務就先把 `crafting.ts` 的來源列改成 `params.hotbar.slice(0, 9)`**（Task 8 再把它升級成 `params.slots.slice(0, params.sourceCount ?? 9)`）。
  - 註解更新：把「熱鍵欄即全部背包」改成「**前 9 格是熱鍵列（= 手持列），其餘 27 格是主背包**」。

- [ ] **Step 6: 跑測試轉綠**

  Run: `npx vitest run src/core/items.test.ts src/world/save.test.ts src/core/mode-stash.test.ts` → Expected: PASS。

- [ ] **Step 7: 全量驗證＋人工**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → Expected: 全綠。
  人工（記錄結果）：開新遊戲 → 挖到石頭後掉落物**能被拾取**（36 格有空間，`fits()` 不再是 0）；Save & Quit → 繼續遊戲 → 物品仍在**熱鍵列**（前 9 格）。

- [ ] **Step 8: Commit**

  ```bash
  git add src/core/items.ts src/core/items.test.ts src/core/mode-stash.ts src/world/save.ts src/world/save.test.ts src/main.ts
  git commit -m "feat(save): B5.4 背包擴為 36 格（熱鍵列＝前 9 格）＋本機 payload 升 v4（v1/v2/v3 舊 9 格遷移到熱鍵列、其餘留空）"
  ```

---

### Task 8: 背包 UI 重構（36 格面板、游標堆疊、創造可捲動清單）

**Files:**
- Modify: `src/ui/inventory.ts`（面板重寫）
- Modify: `src/ui/crafting.ts`（`CraftingParams.hotbar` → `slots` ＋ `sourceCount`）
- Modify: `src/ui/crafting.test.ts`
- Modify: `src/ui/ui.css`（新樣式）
- Modify: `src/ui/ui.test.ts`（面板結構、游標模型、創造清單）
- Modify: `src/main.ts`（面板參數接線、游標回填）

**Interfaces:**
- Consumes: Task 7 的 `INVENTORY_SLOTS`、`slots`（36 格活陣列）。
- Produces:
  - `src/ui/inventory.ts`：
    ```ts
    export interface InventoryOpenOptions {
      /** 槽位內容改變 → 擁有者寫回 inventory model 並刷新 HUD。 */
      onSlotChange?(index: number, stack: ItemStack | null): void;
      /** 關閉面板時歸還游標堆疊。
       *  **回傳 `null` ＝ 已全數放回背包**（游標清空）；
       *  **回傳堆疊 ＝ 放不下的餘量**（UI 保留它，下次開面板時顯示）；
       *  **沒有這個 callback（`undefined`）＝ 沒有擁有者，游標原樣留在 UI 手上**。
       *  **不可用 `??` 判斷**：`??` 只在 null/undefined 時取右側，會把「回傳 null＝已放回」誤判成「沒有回傳」→ 游標與背包同時持有同一疊 → 複製物品。 */
      onReturnCursor?(stack: ItemStack): ItemStack | null;
    }
    export interface InventoryUi {
      open(
        slots: ReadonlyArray<ItemStack | null>,   // 36 格活陣列（唯讀給 UI）
        selected: number,                        // 遊戲手持的熱鍵欄格 0..8
        onPick: (slot: number, stack: ItemStack) => void,
        onClose?: () => void,
        crafting?: CraftingParams,
        mode?: GameMode,
        options?: InventoryOpenOptions,
      ): void;
      close(): void;
      isOpen(): boolean;
    }
    ```
  - `src/ui/crafting.ts`：
    ```ts
    export interface CraftingParams {
      size: 2 | 3;
      grid: Array<ItemStack | null>;
      /** 背包的活陣列（36 格）；來源列取前 `sourceCount` 格。 */
      slots: ReadonlyArray<ItemStack | null>;
      /** 來源列顯示幾格（預設 9 ＝ 熱鍵列；工作台 3×3 可傳 36）。 */
      sourceCount?: number;
      selected: number;
      onSlotSelect?(slot: number): void;
      /** 從 `slots[slot]` 拿掉 1 個 `item`；slot 是 `slots` 的索引（0..35）。 */
      onSpend(slot: number, item: ItemId): boolean;
      /** 把 1 個 `item` 放回背包（不限格）；回傳 overflow（1 = 沒放進去）。 */
      onGiveBack(item: ItemId): number;
      onTake(result: ItemStack): boolean;
    }
    ```

- [ ] **Step 1: 寫測試（失敗）**

  `src/ui/ui.test.ts`（jsdom）：
  - 既有 `'survival panel shows owned slots and cannot pick free blocks'` → **改寫**為 `'the survival panel shows 27 main slots and 9 hotbar slots'`：
    ```ts
    inv.open(slots36, 0, () => {}, undefined, undefined, 'survival');
    const main = root.querySelectorAll('.ui-inv-main .ui-slot');
    const bar = root.querySelectorAll('.ui-inv-bar .ui-slot');
    expect(main.length).toBe(27);
    expect(bar.length).toBe(9);
    expect(root.querySelectorAll('.ui-inv-list').length).toBe(0);   // 生存沒有免費清單
    expect(root.querySelector('.ui-inventory')?.textContent).toContain('背包');
    ```
  - 既有 `'clicking a placeable calls onPick with a full stack for the selected slot'`（創造調色盤）→ **改寫**為 `'the creative panel lists every item in a scrollable list'`：
    ```ts
    inv.open(slots36, 0, onPick, undefined, undefined, 'creative');
    const list = root.querySelectorAll('.ui-inv-list .ui-slot');
    expect(list.length).toBe(ALL_ITEM_IDS.length);
    list[0].click();
    const first = ALL_ITEM_IDS[0];
    expect(onPick).toHaveBeenCalledWith(0, { item: first, count: maxStack(first) });
    ```
  - 既有 `'survival panel closes cleanly with no click handlers left behind'` → 保留並更新斷言（`.ui-inv-grid .ui-slot` 的選擇器改為 `.ui-inv-main .ui-slot` ＋ `.ui-inv-bar .ui-slot`；重開時的創造斷言改成「清單有 `ALL_ITEM_IDS.length` 項」）。
  - 新 `'the creative list writes into the held hotbar slot'`：`inv.open(slots36, 3, onPick, …, 'creative')` → 點清單第一項 → `expect(onPick).toHaveBeenCalledWith(3, expect.objectContaining({ item: ALL_ITEM_IDS[0] }))`。
  - 新 `'left click picks a stack up and the next click places it'`（游標模型）：
    ```ts
    const s = slots36.slice(); s[0] = { item: 'stone', count: 5 }; s[10] = { item: 'dirt', count: 3 };
    const changes: Array<[number, ItemStack | null]> = [];
    inv.open(s, 0, () => {}, undefined, undefined, 'survival', { onSlotChange: (i, st) => changes.push([i, st]) });
    const hot0 = root.querySelectorAll('.ui-inv-bar .ui-slot')[0];
    const main0 = root.querySelectorAll('.ui-inv-main .ui-slot')[0];
    hot0.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(changes).toEqual([[0, null]]);            // 拿起來 → 格子清空
    expect(root.querySelectorAll('.ui-cursor-stack').length).toBe(1);   // 游標堆疊出現
    main0.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(changes[1][0]).toBe(9);                   // 放到主背包第 0 格（索引 9）
    expect(changes[1][1]).toEqual({ item: 'stone', count: 5 });
    expect(root.querySelectorAll('.ui-cursor-stack').length).toBe(0);   // 游標清空
    ```
  - 新 `'left click on an occupied slot swaps the two stacks'`：兩格各有物品 → 點 A 再點 B → 兩格的 `onSlotChange` 互換內容（不得遺失或複製）。
  - 新 `'right click takes half and right click places one'`：
    ```ts
    hot0.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    // 游標拿到 ceil(5/2)=3 個，格子留 2 個
    main0.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    // 游標剩 2 個（放 1 個進去）
    ```
  - 新 `'closing the panel hands the cursor stack back'`：
    ```ts
    const returned: ItemStack[] = [];
    inv.open(s, 0, () => {}, () => {}, undefined, 'survival', { onReturnCursor: (st) => { returned.push(st); return null; } });
    hot0.click();                       // 拿起來
    inv.close();
    expect(returned).toEqual([{ item: 'stone', count: 5 }]);
    ```
  - 新 `'a cursor stack that cannot be placed is kept for the next open'`：`onReturnCursor` 回傳同一個堆疊 → `inv.close()` 後再 `inv.open(...)` → 面板上仍有 `.ui-cursor-stack`（且內容相同）。
  - 新 `'closing the panel never changes the total item count'`（游標不吞物品；**2026-10-20 稽核修正：原測試沒有傳 `onSlotChange`，卻斷言 `hot0.click()` 後 `s` 的總數變少——但介面明寫 `slots: ReadonlyArray<ItemStack | null>`（唯讀給 UI）、變動一律走 `onSlotChange`；沒有 callback 時 `s` 不會被改 → 第一個斷言 `toBe(before - 5)` 必紅。**測試要自己帶上 callback 來驅動變動**，不得要求實作者改成「UI 直接改寫活陣列」——那會違反 B8 已寫死的「面板不持有任何副本、變動走 callback」契約）：
    ```ts
    const total = (arr: ReadonlyArray<ItemStack | null>) =>
      arr.reduce((n, s) => n + (s ? s.count : 0), 0);
    const s: Array<ItemStack | null> = new Array(36).fill(null);
    s[0] = { item: 'stone', count: 5 };
    const before = total(s);
    // UI 只透過 onSlotChange 回報變動；測試的「擁有者」把它寫回 s（照 main.ts 的寫法）
    inv.open(s, 0, () => {}, () => {}, undefined, 'survival', {
      onSlotChange: (i, st) => { s[i] = st; },
      onReturnCursor: () => null,          // null ＝ 全數放回
    });
    hot0.click();                          // 拿起 5 個 → 格子清空（走 onSlotChange）
    expect(total(s)).toBe(before - 5);     // 物品在游標上，不在格子上
    inv.close();                           // 歸還游標（回傳 null＝全數放回 → 背包拿回全部）
    expect(total(s)).toBe(before);         // 總數回到原值：沒有消失、沒有複製
    ```
    （`onReturnCursor` 回傳 `null` 表示「已全數放回背包」→ 擁有者（測試）必須**真的把它放回去**才對得上總數；因此這個 callback 寫成 `(st) => { s[0] = st; return null; }` 會更精確地模擬 `main.ts` 的 `giveItem`。**兩種寫法都可**，但斷言 `total(s)` 的變化必須與 callback 的行為一致——**UI 不得自己改 `s` 來讓測試變綠**。）
  - 既有 `'gives each duplicate stack its own icon canvas (shared-icon regression)'` **要改寫選擇器**（2026-10-20 稽核修正：原計畫寫「保留」，但該測試用 `.ui-inv-grid .ui-slot` 取元素並斷言 `.ui-inv-grid canvas` 數量為 2；新面板的 class 是 `.ui-inv-main`／`.ui-inv-bar`，**沒有 `.ui-inv-grid`** → `own[0]` 為 null、`expect(own[0]).not.toBeNull()` 必紅）：
    ```ts
    const els = [...root.querySelectorAll<HTMLElement>('.ui-inv-bar .ui-slot')];  // 熱鍵列
    const own = els.map((el) => el.querySelector('canvas'));
    expect(own[0]).not.toBeNull();
    expect(own[1]).not.toBeNull();
    expect(own[0]).not.toBe(own[1]);        // cached node shared → second append moves it
    expect(els[0].contains(own[0]!)).toBe(true);
    expect(els[1].contains(own[1]!)).toBe(true);
    expect(root.querySelectorAll('.ui-inv-bar canvas').length).toBe(2);
    ```
    （該測試的「兩個 dirt 堆疊」要放在**前 9 格（熱鍵列）**才會被 `.ui-inv-bar .ui-slot` 選到；`stacks` 陣列改成 36 格、或用 `.ui-inv-main` 選主背包的兩格皆可——但**選擇器必須與新面板的 class 一致**。）

  `src/ui/crafting.test.ts`：
  - 既有測試的 `hotbar:` 參數名改成 `slots:`；`mountCrafting` 的來源列只渲染前 `sourceCount`（預設 9）格 → 既有「來源列有 9 格」的斷言保留。
  - 新 `'the source row shows only the first sourceCount slots'`：傳 36 格 `slots` ＋ `sourceCount: 36` → 來源列 36 格；不傳 → 9 格。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/ui/ui.test.ts src/ui/crafting.test.ts` → Expected: FAIL。

- [ ] **Step 3: 實作 `src/ui/inventory.ts`（面板重寫）**

  - `open()` 的簽名改成上列（`slots` 取代 `hotbar`，新增 `options`）。
  - 面板 DOM（**新的 class 名刻意不叫 `ui-inv-grid`**，避免與舊的 7 欄調色盤選擇器混淆）：
    ```html
    <div class="ui-inventory interactive">
      <h3>背包</h3>            <!-- 生存 -->
      <div class="ui-craft">…</div>     <!-- 生存才有（mountCrafting） -->
      <div class="ui-inv-main">…27 格…</div>
      <div class="ui-inv-bar">…9 格…</div>
      <div class="ui-inv-list">…可捲動清單（創造才有）…</div>
    </div>
    ```
    - 生存：`h3.textContent = '背包'`；不渲染 `.ui-inv-list`。
    - 創造：`h3.textContent = `方塊（點選放入欄位 ${selected + 1}）``（沿用現況的提示文字，只是面板多了 36 格網格）；渲染 `.ui-inv-list`，內容為 `ALL_ITEM_IDS` 每一項一個 `.ui-slot`（`title = stackName(item)`、圖示用 `itemIcon`；點擊 → `onPick(selected, { item, count: maxStack(item) })`）。
    - 27 格主背包對應 `slots[9..35]`；9 格熱鍵列對應 `slots[0..8]`。
  - **游標堆疊**（模組層級的 `let cursor: ItemStack | null = null`，存在 `createInventory` 的閉包裡）：
    - `click`（左鍵）在格子上：
      - 游標空 → `cursor = slots[i]`（整疊）；`onSlotChange(i, null)`。
      - 游標非空 → 目標格有東西 → **交換**：`onSlotChange(i, cursor)`；`cursor = 原目標格的堆疊`；目標格空 → `onSlotChange(i, cursor)`；`cursor = null`。
    - `contextmenu`（右鍵）：
      - 游標空且目標格有東西 → 取一半：`cursor = { item, count: Math.ceil(count / 2) }`；`onSlotChange(i, { item, count: count - cursor.count })`（剩 0 → `null`）。
      - 游標非空 → 放 1 個到目標格（目標格必須空或是同物品且未滿）：`onSlotChange(i, { item, count: targetCount + 1 })`；`cursor.count -= 1`（變 0 → `cursor = null`）。
      - 事件必須 `preventDefault()`（避免瀏覽器的右鍵選單）。
    - 游標堆疊的視覺：`.ui-cursor-stack`（絕對定位、`pointer-events: none`），內容是該物品的圖示 canvas ＋ 數量；跟隨 `mousemove`（綁在面板上）更新 `left/top`。
    - 游標在格子上方時，該格加 `.ui-cursor-target` class（`mousemove` 時更新，`mouseleave` 移除）。
  - `close()`：若 `cursor` 非 null → **先問擁有者要不要留著**（2026-10-20 稽核修正：原計畫寫 `const remainder = opts?.onReturnCursor?.(cursor) ?? cursor;` —— **`??` 只在 null/undefined 時取右側，而契約是「回傳 `null` ＝ 已全數放回」** → 回傳 `null` 時 `remainder` 變成 `cursor`，游標仍留著同一疊、而物品同時已在背包裡 → **製造一份**，直接打中 Review Focus #2。**正確寫法**：
    ```ts
    let remainder: ItemStack | null = cursor;          // 沒有 callback → 留在游標上
    if (opts?.onReturnCursor) remainder = opts.onReturnCursor(cursor);  // 回傳 null＝已全數放回
    cursor = remainder;
    ```
    （`onReturnCursor` 回傳 `null` → 游標清空（東西已由擁有者放回）；回傳堆疊 → UI 留著，下次 `open()` 顯示。**不可用 `??`**。）**`opts` 必須存進 `createInventory` 的閉包**（`let opts: InventoryOpenOptions | undefined`）——`close()` 是被 `open()` 開頭呼叫的，那時手上沒有參數。
  - `open()` 開頭先 `this.close()`（沿用現況）→ 上次沒放回來的游標會在關閉時再次交給 `onReturnCursor`（用**上一次**的 `opts`；所以新 `opts` 要在 `this.close()` 之後才賦值）。
  - 每次槽位變更後 `render()` 重繪面板（36 格 + 清單）。

- [ ] **Step 4: 實作 `src/ui/crafting.ts` 的介面變更**

  - `CraftingParams.hotbar` → `slots`；新增 `sourceCount?: number`（預設 9）。
  - `mountCrafting` 的來源列：`params.slots.slice(0, params.sourceCount ?? 9)`（**每次 render 都重新 slice**，因為 `params.slots` 是活的 36 格陣列）。
  - `onSpend(slot, item)` 的 `slot` 是 **`slots` 的索引（0..35）**：預設來源列只顯示前 9 格 → 實際只會用到 0..8；工作台 3×3 面板傳 `sourceCount: 36` → 索引會到 35。main.ts 的 `onSpend` 讀 `slots[slot]` ✓（索引空間相同，熱鍵列 0..8 與主背包 9..35 共用一個索引空間）。

- [ ] **Step 5: `src/ui/ui.css` 的新樣式**

  ```css
  .ui-inv-main { display: grid; grid-template-columns: repeat(9, 44px); gap: 4px; }
  .ui-inv-bar  { display: grid; grid-template-columns: repeat(9, 44px); gap: 4px; margin-top: 6px; }
  .ui-inv-list {
    display: grid; grid-template-columns: repeat(9, 44px); gap: 4px;
    max-height: 220px; overflow-y: auto; margin-top: 8px; padding-right: 4px;
  }
  .ui-cursor-stack {
    position: fixed; z-index: 30; pointer-events: none;
    width: 44px; height: 44px; transform: translate(-22px, -22px);
  }
  .ui-slot.ui-cursor-target { outline: 2px solid #fff; }
  ```
  （既有的 `.ui-inv-grid`（7 欄調色盤）與 `.ui-inv-grid-hotbar`（9 欄）規則**整段移除**（B1.2 的 9 格唯讀面板已不存在）——不要留下兩套互相覆蓋的同名規則。）

- [ ] **Step 6: `main.ts` 接線**

  - `inv.open(...)` 的呼叫改成：
    ```ts
    inv.open(
      slots,
      selected,
      (slot, stack) => { inventory.setSlot(slot, stack); hud.setHotbar(slots, selected); },
      () => { setState('playing'); relockCanvas(); },
      currentMode === 'survival' ? craftingParams(2) : undefined,
      currentMode,
      {
        onSlotChange: (index, stack) => { inventory.setSlot(index, stack); hud.setHotbar(slots, selected); },
        onReturnCursor: (stack) => {
          const overflow = giveItem(stack.item, stack.count);
          hud.setHotbar(slots, selected);
          return overflow > 0 ? { item: stack.item, count: overflow } : null;
        },
      },
    );
    ```
  - `craftingParams(size)`：`slots`（36 格的活陣列）＋ `onSpend(slot, item)` 讀 `slots[slot]`（slot 是 `slots` 的索引 0..35；`onGiveBack(item)` 走 `giveItem`，不受索引限制）。
  - `craftingParams(3)`（工作台 3×3 覆蓋層）**額外傳 `sourceCount: 36`** → 來源列顯示全部 36 格（工作台面板裡沒有背包網格，若只看 9 格就取不到主背包的物品）；`craftingParams(2)`（內嵌在生存背包面板）維持預設 9 格。
  - `startGame()`／`continueGame()`：把 UI 裡可能留著的游標清掉（呼叫 `inv.close()` 會把游標交回背包——**在新遊戲清空背包之前呼叫**，順序：`inv.close()` → 再 `inventory.setSlot(...)` 清空 → 才不會把舊游標灌進新局）。

- [ ] **Step 7: 跑測試轉綠**

  Run: `npx vitest run src/ui/ui.test.ts src/ui/crafting.test.ts` → Expected: PASS。

- [ ] **Step 8: 全量驗證＋人工**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → Expected: 全綠。
  人工（記錄結果）：
  1. 生存按 E → 看到 27 格主背包 ＋ 9 格熱鍵列 ＋ 2×2 合成；**沒有**任何免費方塊。
  2. 撿起一疊石頭 → 點主背包某格 → 石頭移過去；右鍵取一半、右鍵放 1 個都正常。
  3. 按 Esc／點背景關閉 → 游標上的東西回到背包（背包滿時東西還在游標上，下次開面板還看得到）。
  4. 創造按 E → 看到可捲動的全物品清單（`ALL_ITEM_IDS.length` 項，B3／B4／B5 都落地時 72 項）；點一項 → 進到目前手持的熱鍵欄格。

- [ ] **Step 9: Commit**

  ```bash
  git add src/ui/inventory.ts src/ui/crafting.ts src/ui/crafting.test.ts src/ui/ui.css src/ui/ui.test.ts src/main.ts
  git commit -m "feat(ui): B5.3 36 格背包（27 主＋9 熱鍵列）＋點擊選取→點擊放置的游標堆疊＋創造可捲動全物品清單"
  ```

---

### Task 9: 雲端 format 2（36 格語義 ＋ 舊格式遷移 ＋ `game.json` 同步）

**Files:**
- Modify: `src/core/cloud-save.ts`
- Modify: `src/core/cloud-save.test.ts`
- Modify: `src/main.ts`（三處格式檢查改成「可讀格式集合」）
- Modify: `game.json`（`cloudSave`）

**Interfaces:**
- Consumes: Task 7 的 `INVENTORY_SLOTS`；平台規則（`readableFormats` 必含 `writeFormat`；格式變更時平台保存遷移快照；回退到讀不了新格式的舊版會被平台拒絕）。
- Produces:
  - `src/core/cloud-save.ts`：
    ```ts
    /** 寫入格式（必須與 game.json 的 cloudSave.writeFormat 一致）。 */
    export const CLOUD_FORMAT_VERSION = 2 as const;
    /** 本版本能讀的格式（只累積、不縮）。format 1 = 9 格背包；format 2 = 36 格背包。 */
    export const CLOUD_READABLE_FORMATS: ReadonlyArray<number> = [1, 2];
    export function isReadableCloudFormat(v: number): boolean;
    /** 把 inventory 陣列正規化到 36 格（format 1 → format 2 的遷移核心）。 */
    export function migrateInventorySlots(x: ReadonlyArray<ItemStack | null>): Array<ItemStack | null>;
    ```
    - `CloudData.inventory` 語意改為 36 格；`stash.survival`／`stash.creative` 同樣 36 格。
    - `acceptCloudData` 回傳的 `inventory` 一律 36 格（不足補 null、超過截斷；**未知 item id 仍保留為字串**，沿用現有語意，由主線的 inventory model 丟棄）。
  - `game.json`：`"cloudSave": { "readableFormats": [1, 2], "writeFormat": 2 }`。

- [ ] **Step 1: 寫測試（失敗）**

  `src/core/cloud-save.test.ts`：
  - 既有 `'exposes format version 1 and a 64 KiB cap'` → **改寫**為 `'exposes format version 2, reads formats 1 and 2, and a 64 KiB cap'`：
    ```ts
    expect(CLOUD_FORMAT_VERSION).toBe(2);
    expect(CLOUD_READABLE_FORMATS).toEqual([1, 2]);
    expect(isReadableCloudFormat(1)).toBe(true);
    expect(isReadableCloudFormat(2)).toBe(true);
    expect(isReadableCloudFormat(3)).toBe(false);
    expect(isReadableCloudFormat(0)).toBe(false);
    ```
  - 新 `'a format 1 payload migrates into the 36-slot layout'`：
    ```ts
    const legacy = { ...rawValid(), inventory: [{ item: 'stone', count: 32 }, { item: 'dirt', count: 2 }] };
    const accepted = acceptCloudData(legacy)!;
    expect(accepted.inventory).toHaveLength(36);
    expect(accepted.inventory[0]).toEqual({ item: 'stone', count: 32 });
    expect(accepted.inventory[1]).toEqual({ item: 'dirt', count: 2 });
    expect(accepted.inventory[2]).toBeNull();
    ```
  - 新 `'migrateInventorySlots pads and trims to 36'`：
    ```ts
    expect(migrateInventorySlots([])).toHaveLength(36);
    expect(migrateInventorySlots(new Array(40).fill({ item: 'stone', count: 1 }))).toHaveLength(36);
    ```
  - 新 `'buildCloudData writes 36 slots'`：`buildCloudData({ ...src, inventory: new Array(36).fill(null) }).inventory` 長度 36。
  - 新 `'the manifest declares the same cloud format as the code'`（讀 `game.json`）：
    ```ts
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'game.json'), 'utf8'));
    expect(manifest.cloudSave.writeFormat).toBe(CLOUD_FORMAT_VERSION);
    expect(manifest.cloudSave.readableFormats).toEqual([...CLOUD_READABLE_FORMATS]);
    ```
  - 既有 `'acceptCloudData derives stash from legacy fields when absent'` 保留（stash 兩側現在是 36 格 → 補一條 `expect(accepted.stash!.survival).toHaveLength(36)`）。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/core/cloud-save.test.ts` → Expected: FAIL。

- [ ] **Step 3: 實作 `cloud-save.ts`**

  - `CLOUD_FORMAT_VERSION = 2`；新增 `CLOUD_READABLE_FORMATS` 與 `isReadableCloudFormat`。
  - 新增 `migrateInventorySlots`（複製每一格、補 null 到 36、截斷到 36）。
  - `acceptCloudData`：`inventory: migrateInventorySlots(x.inventory)`。
  - `buildCloudData`：`inventory: src.inventory.map(...)`（活陣列已是 36 格）；**加上保險**：`migrateInventorySlots(src.inventory)`。
  - 檔頭 doc 註解改寫：「B5 起 format 2：36 格背包語義（format 1 的 9 格讀入時遷移到熱鍵列、其餘留空）；`readableFormats` 累積 [1,2]；**回退限制：0.8.0 寫出的 format 2 資料，0.7.0（只宣告 [1]）讀不到 → 平台會擋不相容回退**」。

- [ ] **Step 4: `game.json` 同步**

  `"cloudSave": { "readableFormats": [1, 2], "writeFormat": 2 }`（`id`／`name`／`entry`／其他欄位不動）。

- [ ] **Step 5: `main.ts` 的三處格式檢查**

  - import 改成 `import { CLOUD_FORMAT_VERSION, isReadableCloudFormat, ... } from './core/cloud-save';`。
  - 開機讀取（`res.formatVersion !== CLOUD_FORMAT_VERSION`）、`retryCloudRead()`、`resolveCloudConflict()` 三處一律改成：
    ```ts
    if (!isReadableCloudFormat(res.formatVersion)) { /* 鎖定雲端寫入：FORMAT */ }
    ```
    - 讀到 format 1 時**照常套用**（`acceptCloudData` 已完成 9→36 的遷移），下一次檢查點就會以 format 2 覆寫（格式 1→2 的升級路徑）。
  - 註解補一句：format 1 的舊資料讀進來後，熱鍵列保留舊物品、其餘 27 格留空。

- [ ] **Step 6: 跑測試轉綠**

  Run: `npx vitest run src/core/cloud-save.test.ts src/world/save.test.ts` → Expected: PASS。

- [ ] **Step 7: 全量驗證＋人工**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → Expected: 全綠。
  人工（記錄結果）：登入帳號 → 開機讀雲端 → 進遊戲 → Save & Quit → 再進 → 位置與物品都在；暫停選單的雲端列顯示「就緒」而不是「格式不相容」。

- [ ] **Step 8: Commit**

  ```bash
  git add src/core/cloud-save.ts src/core/cloud-save.test.ts src/main.ts game.json
  git commit -m "feat(cloud): B5.4 雲端升 format 2（36 格語義；readableFormats [1,2]、writeFormat 2；format 1 讀入自動遷移）"
  ```

---

### Task 10: 0.8.0 發布

**Files:**
- Modify: `package.json`、`game.json`、`README.md`、`.github/workflows/release.yml`（若上游模板有變動才動）
- Create: `docs/releases/v0.8.0.md`

**Interfaces:**
- Consumes: Task 1–9 全部。
- Produces: tag `v0.8.0` 與 GitHub Release（CI 產生）。

- [ ] **Step 1: 版本 bump**

  `package.json` `"version": "0.8.0"`；`game.json` `"version": "0.8.0"`（`id` 不動；`cloudSave` 維持 Task 9 的 `{readableFormats:[1,2], writeFormat:2}`）。

- [ ] **Step 2: README 更新（照 spec §跨批次與 §6）**

  - `## 遊戲特色`：
    - **世界**段補：礦脈深度分佈（金礦在 Y≈24、鑽石礦在 Y≈1–10、鐵礦在 Y≈39、礫石帶）；「**地形已改變**」提示因 `WORLDGEN_VERSION` 升 2 而對舊存檔觸發。
    - **生存模式**段改寫挖掘說明：「木鎬 2×／石鎬 4×／鐵鎬 6×／**鑽鎬 8×／金鎬 12×**；鏟 木2／石4／鐵6／鑽8／金12；石頭與煤礦需木鎬以上、鐵礦需石鎬以上、**金礦與鑽石礦需鐵鎬以上**；徒手或錯工具挖石類 ×5 且不掉落」。
    - 補「背包」說明：**27 格主背包 ＋ 9 格熱鍵列 ＋ 2×2 合成**；左鍵拿起／放下、右鍵取一半／放 1 個；創造模式 E 是可捲動的全物品清單（**項數＝`ALL_ITEM_IDS.length`**；B3／B4／B5 都落地時是 72，實作者以實測值填）。
    - 補合成說明：「全套共 **31 份**配方（板材／木棍／工作台＋木石鐵金鑽五階的鎬斧劍鏟＋熔爐）」。
    - 補進度說明：新增 4 項進度（黃金時代／鑽石時代／金製工具／鑽製工具）；**總數以實測為準**（2026-10-20 稽核修正：原計畫寫「累計 16 項」是錯的——現況 12 項、B4 加 `pasture` → 13 項、B5 再加 4 項 → **17 項**。為避免跨批數字漂移，README 寫「本批新增 4 項」＋「累計 N 項（N 以實測為準）」）。
    - **存檔**段改寫：「本機 payload 升 **v4**（36 格背包；v1／v2／v3 照讀並遷移，舊的 9 格會落在熱鍵列、其餘留空）」。
    - **雲端進度**段改寫：「雲端格式版本 **2**（可讀 1 與 2）；36 格背包語義改變了 `inventory` 的意義，因此 B5 一次升版——**舊版（0.7.0）讀不到 format 2，平台會擋下不相容的回退**」。
  - `## 與原版的差異` 新增／修正：
    - 「背包是 27＋9 的簡化版：**沒有滑鼠拖曳的多格搬運**（以點擊選取→點擊放置代替）；工作台 3×3 的來源列預設只顯示熱鍵列 9 格（可切到全部 36 格）；創造模式的物品清單是全物品的平鋪清單（沒有分類頁籤與搜尋）。」
    - 「礦脈是**逐格密度模型**（原版是成團的礦脈 blob）；煤炭沿用均勻密度（原版是近地表的三角帶，且 Y=0 以下無煤）。」
    - 「**花與草在原版不掉落**（需要剪刀／絲綢觸碰）；本作讓它們掉落自身以便重新種回。」
    - 「冰需要絲綢觸碰才掉落（本作沒有絲綢觸碰）→ 冰只有創造模式拿得到。」
    - 「金／鑽石**沒有方塊形式**（9 個金錠合成金塊、9 顆鑽石合成鑽石塊尚未實作）。」
    - 「工具無耐久與修補（B7 處理耐久）。」
    - 「世界高度 256」等既有條目保留。
  - `## 操作` 表格：E 的說明改為「背包（生存：27＋9 格 ＋ 2×2 合成；創造：可捲動全物品清單）」。
  - `# Test` 段的測試數字更新為實測值（本批新增測試後的總數／檔案數）。
  - `# 專案狀態` 補一行 B5 的摘要（0.8.0：方塊／物品／金鑽礦／工具／36 格背包／雲端 format 2）。

- [ ] **Step 3: 發布說明 `docs/releases/v0.8.0.md`**

  固定四段（中文）：`## 新增`／`## 修正`／`## 存檔格式與相容性提示`／`## 已知問題`。
  - **新增**：礫石／冰／羊毛／雲杉白樺木組／花草的物品形式；金礦與鑽石礦（含深度分佈與原版 Y 映射）；生金／金錠／鑽石；金與鑽的鎬斧鏟劍 ＋ 木石鐵鏟；36 格背包（27 主＋9 熱鍵列）與游標式操作；創造模式可捲動全物品清單；31 份合成配方（含斧的左右鏡像）；4 個新進度。
  - **修正**：工具速度表補金／鑽；攻擊傷害對齊原版（原表鎬一律 2、斧一律 3）；鐵礦的深度帶對齊原版映射；煤炭仍為均勻密度（明列）。
  - **存檔格式與相容性提示**（**本批最重要的一段，寫在最前面**）：
    1. 本機 payload 升 **v4**（36 格背包語義）；v1／v2／v3 舊存檔照讀，舊的 9 格會落在**熱鍵列**、其餘 27 格留空。
    2. 雲端格式升 **2**（`readableFormats:[1,2]`、`writeFormat:2`）；舊的 format 1 雲端進度會在讀入時自動遷移成 36 格，下一次檢查點即以 format 2 寫回。
    3. **回退限制**：0.8.0 寫出的雲端資料是 format 2，**0.7.0（只宣告可讀 format 1）讀不到** → 平台會以 `SAVE_FORMAT_INCOMPATIBLE` 擋下不相容的回退。要回到 0.7.0 必須先在 0.8.0 重新開局（雲端槽會被改寫）。
    4. 舊存檔載入時會跳一次「**地形已改變**」提示（本批新增礫石與礦脈深度帶，`WORLDGEN_VERSION` 升 2）。
  - **已知問題**：礦脈是逐格密度而非礦脈 blob；煤炭分佈未對齊原版；花與草會掉落自身（原版不會）；冰無掉落絲綢觸碰的取得途徑；金／鑽石無方塊形式；背包無拖曳搬運、工作台來源列預設只看熱鍵列；創造清單無分類與搜尋；工具無耐久（B7）；雲端回退限制（見上）。

- [ ] **Step 4: release workflow 支援 notes 檔**

  **先重讀上游模板**（AGENTS.md §1 清單的 `game-release.yml`；若模板已改動，以模板為準並調整本步驟）。若模板仍為 `gh release create … --generate-notes`，改成優先使用版本 notes 檔（照 B1 Task 10 的做法）：
  ```yaml
        NOTES_ARGS=(--generate-notes)
        if [ -f "docs/releases/$RELEASE_TAG.md" ]; then
          NOTES_ARGS=(--notes-file "docs/releases/$RELEASE_TAG.md")
        fi
        gh release create "$RELEASE_TAG" "$GAME_ZIP" --repo "$RELEASE_REPO" --verify-tag "${NOTES_ARGS[@]}" --prerelease="$RELEASE_PRERELEASE"
  ```
  （workflow 的其餘檢查——tag 對版本、工具 sha256、pack＋validate——全部保留；**不得出現 job 層 `runner`**。）

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
  git commit -m "chore(release): 0.8.0"
  ```
  本計畫在 `b5-items-inventory` 分支執行：tag 與 push 屬整支完成後的整合步驟——merge 回 master 後才 `git tag -a v0.8.0 -m "0.8.0: B5 方塊、物品與背包"`＋`git push origin master`＋`git push origin v0.8.0`，由 controller 依 finishing-a-development-branch 流程執行。

- [ ] **Step 8: 驗證 CI Release**

  以 `webfetch https://github.com/TommyLamm/WeCraft/releases/tag/v0.8.0` 確認 release 存在、asset 已附、說明為 `docs/releases/v0.8.0.md` 內容。回報照 AGENTS.md 四段式：程式完成／ZIP 驗證／Release（CI 結果）／平台上架（若屬平台操作，向使用者確認後再按）。**並在回報中明寫「雲端 format 2 的回退限制」**（平台端上架後，0.7.0 的雲端槽會變成 format 2）。

- [ ] **Step 9: Commit（收尾）**

  若 Step 8 有任何補正（文件錯字、notes 檔更新），再一顆 commit；無則略過。

---

## 批末驗收

（spec §B5「批末驗收」＋本批專屬項目。）

- **gates**：`npm run typecheck` ／ `npm test` ／ `npm run build` ／ `npm run lint` 全綠；既有 806 tests／51 files 一個不多、一個不少。
- **遷移測試**（Task 7／9）：
  - 本機 v1／v2／v3 → v4：舊的 9 格落在熱鍵列、其餘 27 格留空。
  - 雲端 format 1 → format 2：舊的 9 格落在熱鍵列、其餘留空；`game.json` 的 `writeFormat` 與程式常數一致（測試守住）。
  - 模式 stash（每模式 36 格）往返不丟物品。
- **36 格 UI 操作**（Task 8，人工＋jsdom 測試）：左鍵拿起／放下／交換；右鍵取一半／放 1 個；關閉面板時游標歸還（放不下則保留）；創造清單 `ALL_ITEM_IDS.length` 項可捲動、點擊進手持格；**生存面板沒有免費方塊**。
- **新物品全流程**（人工走查，逐項記錄結果）：
  1. 挖到礫石 → 拾取 `gravel` → 放下 → 挖掉再拾 ✓
  2. 挖到金礦（Y≈24）→ **石鎬挖不到（×5 且不掉落）** → 換鐵鎬 → 掉 `raw_gold` → 熔爐 → `gold_ingot` → 3×3 做金鎬 ✓（**掉落判定靠 `canHarvest`（工具等級），不是靠挖的時間**——石鎬挖 3.75 秒也不會掉東西）
  3. 挖到鑽石礦（Y≈1–10）→ 鐵鎬 → 掉 `diamond` → 3×3 做鑽鎬／鑽斧／鑽劍／鏟 ✓
  4. 砍雲杉／白樺 → 製 `spruce_planks`／`birch_planks` → 做木製工具（任意木板）✓
  5. 羊掉 `wool` → 放置 ✓
  6. 摘花／草 → 掉落自身 → 再種回 ✓
  7. 挖冰（雪原水面）→ 不掉落（絲綢觸碰限定）→ 創造模式取得 ✓
- **統計驗收**（Task 6）：金／鑽／鐵的帶界、峰值、單調性與每 16 區塊的數量都在釘死的區間內。
- **效能**：生成 16 個區塊 < 1500 ms（B3 的既有門檻，本批多了礦脈放置）。
- **`pack-game` ＋ `validate-game`**：固定工具（SHA-256 與 lock 一致）兩個都過。
- **README 與發布說明**：〈與原版的差異〉涵蓋本批的所有刻意簡化；發布說明四段齊全、**雲端格式升版與回退限制寫在最前面**。
- **不動輸入路由**：本批不碰 `Esc`／pointer lock／全螢幕 → **不需 Playwright**；若實作者順手改了這些，必須補 Playwright 驗收（`xvfb-run` headful，probe 腳本放 repo 外）並把 Ctrl+W 等瀏覽器保留鍵情境列為未驗證。

---

## 與公約／spec 的差異

1. **B3 與 B4 的 block id 原本互相衝突（已由 controller 裁決解決）**：既有 0–16 不動；B3 用 17–25（`SPRUCE_LOG`…`ICE`）、B4 羊毛 = 26、**本批 27–31**（`GRAVEL` 27／`GOLD_ORE` 28／`DIAMOND_ORE` 29／`SPRUCE_PLANKS` 30／`BIRCH_PLANKS` 31）；tile：B3 21–32、B4 `T.WOOL` 33、本批 34–38（`TILE_COUNT` 39）。本計畫**不重定義**既有 id；Task 1 Step 1 仍要讀 `src/world/blocks.ts` 現況核對（若上游批次實際值不同，以現況為準並在 commit 訊息註明，**不得默默撞號**）。
2. **煤炭分佈不對齊原版（刻意）**：原版煤炭的三角帶下緣在 Y=0（映射後本作 y=31），重排會讓低窪地形（海底石頭只有 1..30）完全沒有燃料。本批讓**煤炭維持既有的均勻密度模型**（1/120），鐵／金／鑽則照原版映射重排。已列入 README〈與原版的差異〉與發布說明。spec §B5.1 只要求金／鑽的深度分佈，故不視為違規。
3. **礦脈是逐格密度模型而非礦脈 blob（沿用現況）**：本作從來沒做過 blob 礦脈；本批只對齊**深度分佈的形狀與帶界**，不重寫生成模型。已在 README 明列。
4. **花與草掉落自身（刻意偏離原版）**：spec §B3.4 寫「草叢…可拾取」，而 B3 因物品形式未到而延後；本批把花與草的**掉落規則**接上（讓它們掉落自身，原版需剪刀／絲綢觸碰）。已在 README 明列。
5. **冰只有創造模式拿得到**：原版冰需絲綢觸碰才掉落；本作無絲綢觸碰 → `dropItemFor(ICE)` 回 `null`（沿用既有「leaves／glass／snow 不掉落」的規則）。冰的**物品形式由 B3 補**（可放置、進創造清單），本批只接掉落規則（不掉落）。
6. **合成只支援 2×2／3×3 兩種尺寸、沒有原版的工作台以外的合成台**：沿用現況，非本批議題。
7. **「any planks」是本批自行加的擴充**：spec §B5.2 只要求「各木種板材配方」。本批額外讓木製工具／木棍／工作台接受三種木板（`PatternCell` 多格），否則雲杉／白樺木做出來只能當燃料。若實作者要縮小範圍，可把 `ANY_PLANKS` 縮回 `['oak_planks']`（但要在 README 記錄）。
8. **雲端 format 2 與「寫入結果必須能被目前上架版本讀取」的張力**：平台標準要求寫入結果能被**目前上架版本**讀取；0.8.0 上架前，上架中的是 0.7.0（`readableFormats:[1]`）。但 spec §B5.4／§5.11／§8 已明確裁決「B5 一次升到 format 2、回退限制寫進發布說明」，且平台規格本身寫明「一旦升到新格式，回退到讀不了新格式的舊版會被平台拒絕」。本批依 spec 執行，並把回退限制寫進發布說明與 README（Task 10 Step 3 第 3 點）。**若平台的發布檢查實際擋下 format 2 的上架，實作者不得自行降回 format 1，必須停手回報由 controller 裁決。**
9. **本批不做工具耐久**：spec §B5.2 只要求速度／等級／配方；`dur` 欄位與耐久條是 B7（`ItemStack` 形狀不在本批變動）。新工具堆疊仍為 1。
10. **`ItemStack` 形狀不變**（仍是 `{ item, count }`）——與公約 §4 一致。
11. **延伸項本批不做（spec §B5.1 已列管）**：門／柵欄／梯子／半磚／階梯／告示牌需要非整格模型，本批不碰；背包的分類頁籤與搜尋列（spec §B5.3 列為延伸）也不做——創造清單是全物品平鋪。
12. **「每個新方塊的物品形式由新增它的批次自己補」（2026-10-20 稽核修正）**：B3 新增 9 個方塊 → **B3 自己補**那 9 個的 `ItemId`／`BLOCK_PAIRS`／圖示；B4 新增羊毛方塊 → B4 已補 `wool`；**本批只補自己新增的 5 個方塊**（`gravel`／`gold_ore`／`diamond_ore`／`spruce_planks`／`birch_planks`）的物品形式 → 本批的新 `ItemId` 是 **18 個**（原本列 26 個，含 8 個屬於 B3 的方塊）。**本批對 B3 的方塊只做掉落／合成接線**（B3 的計畫把「草叢可拾取」明文交給 B5）。這是為了守住既有 `src/core/items.test.ts` 的不變量「**每個 block 都要有 item form**」——它由**每個批次自己**補，而不是由某一批集中補。

---

## Self-Review 記錄

- **Spec coverage**：spec §B5.1 方塊／物品擴充 → Task 1（方塊資料 ＋ 貼圖）＋ Task 2（18 個新 id ＋ 圖示）＋ Task 5（掉落取得路徑）＋ Task 6（世界生成）；「B3 裝飾物的物品形式」→ **由 B3 自己補**（本批只做 Task 5 的掉落接線，補上 B3 延後的「草叢可拾取」）；「羊毛方塊」→ 沿用 B4（本批只驗證接線，見差異第 1 條）；「雲杉與白樺木組（原木／板材／樹葉的物品形式）」→ **原木／樹葉的物品形式由 B3 補**，板材的由本批 Task 1／2 補 ＋ Task 4 板材配方 ＋ Task 5 燃料；「金礦／鑽石礦（深度分佈查證）＋`raw_gold`／`gold_ingot`／`diamond`」→ Task 6（映射 ＋ 統計）＋ Task 1／2（方塊與物品）＋ Task 5（掉落 ＋ 熔煉）；「金與鑽石的鎬／斧／鏟／劍、鏟（木石鐵金鑽）」→ Task 2（11 把新工具）＋ Task 3（等級／速度）＋ Task 4（配方）；「採掘等級表」→ Task 1（`requiredTool`）＋ Task 3（`canHarvest`）。spec §B5.2 工具與合成 → Task 3（速度／等級／×5 無掉落）＋ Task 4（31 份配方、斧鏡像、各木種板材、攻擊傷害表補新材質）。spec §B5.3 背包 UI → Task 7（核心模型 ＋ 36 格語義）＋ Task 8（27＋9＋2×2、點擊選取→點擊放置、創造可捲動全物品清單、生存不顯示免費方塊）。spec §B5.4 存檔與雲端 → Task 7（本機 v4 ＋ 舊 9 格遷移）＋ Task 9（雲端 format 2 ＋ `game.json` ＋ 回退限制）。「所有新物品 id 進 `ITEM_IDS`（型別強制）」→ Task 2。批末驗收 →〈批末驗收〉段。發布 → Task 10。
- **型別一致**：`INVENTORY_SLOTS`／`HOTBAR_SLOTS`／`MAIN_SLOTS`（Task 7 產出，Task 8／9 消費）；`mapVanillaY`／`unmapVanillaY`／`ORES`／`oreWeight`／`placeOres`（Task 6）；`CLOUD_FORMAT_VERSION = 2`／`CLOUD_READABLE_FORMATS = [1,2]`／`isReadableCloudFormat`／`migrateInventorySlots`（Task 9，與 `game.json` 的 `cloudSave` 對齊）；`PatternCell` 的多格形狀（Task 4）；`InventoryOpenOptions`（Task 8）；`SavePayloadV4`（Task 7）。
- **Review Focus→測試**：舊資料遷移 → Task 7（v1/v2/v3→v4 的 36 格斷言）＋ Task 9（format 1→2 的遷移斷言）；游標不吞物品 → Task 8（`onReturnCursor`、「保留餘量」、「關閉面板後物品總數不變」三個案例）；採掘等級不放水 → Task 3（`canHarvest`／`getBreakTime` 的表驅動）；斧鏡像真的成立 → Task 4（左／右正例 ＋ 「右排法的 id 必須是 `_mirrored`」的反例）；礦脈分佈是統計性質 → Task 6（`ores-stats.test.ts`）；回退限制公告 → Task 9（`game.json` 與常數一致的測試）＋ Task 10（發布說明四段）。
- **步驟掃描**：每個 Task 都是「寫失敗測試 → 跑（紅）→ 實作 → 跑（綠）→ 全量 gates → commit」；沒有 TBD 與未定義型別；唯二的演算法段落（金鑽映射、游標模型）已給出完整公式與期望值。
- **逐碼複核（寫完後讀現況再校對，已修正）**：`src/core/items.ts`（`ITEM_IDS` 32 筆、`BLOCK_PAIRS` 無 `gravel`、`STACK_ONE` 9 筆、`starterSlots` 回 9 格）、`src/core/recipes.ts`（`PatternCell = ItemId | null`、`findRecipe` 已匯出、13 筆配方 id）、`src/world/blocks.ts`（`DEFS` **沒有** `shape` 欄位 → 由 B3 加；`TILE_COUNT` 現況 21）、`src/player/interact.ts`（`toolDamage` 現況鎬一律 2／斧一律 3；`getBreakTime` 公式）、`src/world/drops.ts`（`LEAVES/GLASS/SNOW → null`）、`src/world/furnace.ts`（`FUEL_VALUES` 現況整數 2）、`src/core/advancements.ts`（12 筆進度、`OBTAIN_UNLOCKS` 是 item→單一 id）、`src/ui/inventory.ts`／`crafting.ts`（現況簽名與 7 欄調色盤）、`src/ui/hud.ts`（`setHotbar` 只渲染自己的 9 格）、`src/ui/icons.ts`（`switch` 內 14 個新 id 必須各留 `case` 標籤，靜態檢查才成立）、`src/world/terrain.ts`（現況礦石碼在迴圈內、卡 `y < h − 6`）、`src/world/save.ts`／`src/core/cloud-save.ts`（版本常數與 `game.json` 的 `cloudSave`）、`src/core/mode-stash.ts`（`SLOTS_PER_MODE` 由 `starterSlots` 推導 → 自動變 36）。依此修正了：燃料值對齊 B4 的 1.5、雲杉／白樺**樹葉不掉落**（與橡樹葉一致）、`placeOres` 的呼叫順序（填地形＋切洞之後、種樹之前，與現況等價）、雜湊鹽值改 XOR 混進座標、`BLOCK_PAIRS` 筆數、洋紅檢查應落在紋理陣列層、合成 `onSpend` 的索引空間。
- **已知未測面**：`src/main.ts` 無測試（組裝根）——Task 7／8／9 的接線以人工步驟佐證並在回報中列「未自動化」；本批不動 iframe／pointer lock／全螢幕 → 不需 Playwright；`WORLDGEN_VERSION` 升 2 的「地形已改變」提示沿用 B3 的既有實作與測試。
- **2026-10-20 稽核修正摘要**（本計畫已依稽核報告逐條修正，修正點在正文以「（2026-10-20 稽核修正：…）」標出）：
  1. **Critical**：`close()` 的 `?? cursor` 語意與契約相反（回傳 `null` ＝ 已放回卻被當成「沒回傳」→ 複製物品）→ 改成明確的 `let remainder` 分支，並在介面註解寫死 `undefined`／`null` 的語意。
  2. **Critical**：「關閉面板後物品總數不變」的測試與 `slots` 唯讀契約矛盾 → 測試自帶 `onSlotChange` 驅動變動（不要求實作者改壞擁有權模型）。
  3. **Critical**：Task 4 的三組配方網格長度不是 `size²`（6／3 格）→ 全部改成 9 格並加 `toHaveLength(9)`；**不放寬 `findRecipe` 的長度檢查**。
  4. **Critical**：`toolSpeed` 的斧／鏟斷言對 `BLOCK.STONE` → 拆成鎬×石頭／斧×原木／鏟×泥土三段，並保留既有的「錯工具 1×」守門。
  5. **Important**：`blocks.test.ts` 的窮舉表／硬度表補 5 列；`textures.test.ts` 的洋紅層清單改成不隨 `TILE_COUNT` 漂移；`icons.test.ts` 的重複圖示測試改用新 class 選擇器；`patternBox` 的指示刪掉錯的那半句；新增 `makeV3Payload()` fixture；鏡像清單要補 40 個（最多）；README 進度總數改「以實測為準」；`DEFS` 表補 `name` 與 `top/side/bottom`；燃料值 1.5 的 B4 前提升級成 Global Constraints。
  6. **controller 裁決**：**每個新方塊的物品形式由新增它的批次自己補** → B5 只補自己的 5 個方塊，新 `ItemId` 由 26 個改為 **18 個**、物品表基數改為「現況基數 + 18」（三批皆落地時 72）。
  7. **Minor**：鑽石解析中位數 ≈ 12.1 → ≈ 11.3；`'swords: … one tier step each'` 改名；`'non-weapons … fall back to 1'` 拆出鏟傷害段；`icons.test.ts` 補上可執行的程式碼；`hud.setHotbar` 的說法改寫；人工驗收補「掉落靠 `canHarvest`」；Task 7 的合成來源列維持 9 格。
- **2026-10-20 終審修正摘要**（本計畫依最終跨計畫複核報告修正；修正點在正文以「（2026-10-20 終審修正：…）」標出）：
  1. **建議修正 #5（正式值 vs 暫定值互相打臉）**：〈已查證與設計決策〉§8 與 Task 1 Step 1 原本同時寫「下列數字即為正式值，非暫定」與「（暫定 27/28/29/30/31）」／「若與暫定值不同」——現已統一為單一說法：**正式值＝公約 §3.5 的跨批編號表**，落地時以讀到的現況為準並在 commit 訊息註明實際值。
  2. **建議修正 #6（洋紅層斷言三批各宣稱要修）**：**唯一的修復點在 B3（0.6.0）**；本批的洋紅層清單改為「**只驗證、不改寫**」，並附「上游 B3 尚未合併時才由本批補改成**與 B3 完全相同**的 `[TILE_COUNT, TILE_COUNT + 1, 47, 63]`」的備援（不得另創寫法）。
  3. **基數漂移**：物品表計數改為「**讀現況基數 → 現況 + 18**」（原計畫寫死 `toBe(72)`，只有 B3／B4 都落地時才對）；配方計數改為「**讀現況 → 現況 + 18**」（原計畫寫死 `toBe(31)`）。
  4. **建議修正 #10（集中清單）**：新增〈本批要改寫的既有測試（集中清單）〉——逐條列出「檔案＋既有測試＋改法＋理由」，原本散在各 Task Step 1 的指示都對應到表裡的一列。


