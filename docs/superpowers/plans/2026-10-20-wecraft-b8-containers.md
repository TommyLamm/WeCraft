# WeCraft B8 箱子與容器持久化（0.11.0）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 補上原版的箱子與容器——箱子方塊（8 塊同種板材 3×3 環形合成、放置／開啟／破壞）、27 格單箱容器 UI（沿用 B5 的「點擊選取→點擊放置」游標模型）、**塊實體持久化**（箱子內容＋熔爐的內容／燃料／進度進本機 payload v6 與雲端 format 4，附載入驗證與數量上限）、破壞時內容物溢出掉落——並**附帶修掉「熔爐內容重開遊戲就消失」的稽核項**，最後發布 0.11.0。

**Architecture:** 純邏輯（塊實體資料模型／驗證／序列化／溢出、熔爐狀態正規化、游標堆疊規則）放 `src/world/block-entities.ts`（新）、`src/world/furnace.ts`、`src/core/items.ts`、`src/ui/cursor.ts`（新），以單元測試釘死；`src/ui/container.ts`（新）只做 DOM（27 格箱子 ＋ 玩家 36 格背包，共用一支游標堆疊）；存檔遷移放 `src/world/save.ts`（本機 v6）與 `src/core/cloud-save.ts`（雲端 format 4）；`src/main.ts` 是未測的組裝根，只做接線（塊實體 map、開啟容器、破壞溢出、存檔／雲端往來）。**批次關鍵風險＝壞資料的處置粒度**：塊實體必須「逐筆丟棄、絕不整包拒絕」（比照 B1 的 `sanitizeStack`／`normalizeModeStash` 風格），否則一筆壞箱子就會讓整份存檔讀不進來。

**Tech Stack:** TypeScript strict、Three.js、Vite、Vitest（jsdom 用於 UI、fake-indexeddb 用於存檔）、IndexedDB（本機）、Playroom SDK（雲端）、GitHub Actions release workflow。

**Spec:** `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`（§B8＝本批範圍，L266–272；§5.11 雲端格式政策、§6 已知簡化清單亦涵蓋本批）。跨批契約見 `/tmp/opencode/wecraft-planning/planning-conventions.md` §3–§7。

**執行方式:** SDD＋隔離 worktree，分支名 `b8-containers`（在計畫標注即可，不用建 branch）。每個 Task 是最小可獨立審查單元（TDD 循環、可獨立 commit）；批次最後由 controller merge、打 tag、push。

**疊在 B5＋B7 之上:** 本計畫假設 **B5（0.8.0）與 B7（0.10.0）已合併**——背包為 36 格（`HOTBAR_SLOTS = 9`／`MAIN_SLOTS = 27`／`INVENTORY_SLOTS = 36`）、`ItemStack` 可帶 `dur?`（耐久物品缺 `dur` → 滿耐久）、本機 payload 已是 v5、雲端已是 format 3（`CLOUD_READABLE_FORMATS = [1,2,3]`）、配方表的 `PatternCell` 已是 `ItemId | ReadonlyArray<ItemId> | null`（any-planks）、`main.ts` 的熱鍵欄變數已由 `hotbar` 改名 `slots`。**若 B5／B7 尚未落地**：Task 1／2／3／4／5 的 Step 1 必須先讀 `src/core/items.ts`／`src/core/recipes.ts`／`src/world/save.ts`／`src/core/cloud-save.ts`／`src/main.ts` 的現況，把本計畫中的寬度常數、payload 版本、配方格形狀、變數名換成實際值，並在對應 commit 訊息註明實際值（**不得默默套用 B5／B7 的假設撞號**）。

---

## Global Constraints

（出自 spec §B8、§1、§2、公約 §3–§7 與 `AGENTS.md`；每個任務都隱含本節。）

- 每個任務結束：`npm run typecheck`、`npm test`、`npm run build`、`npm run lint` 全綠；**既有測試一個不多、一個不少、不得弱化**（要改測試必須在 commit 訊息說明理由）。**本批有 3 個任務要改寫既有測試（Task 2／4／5）＋ 1 個任務只在既有測試檔新增案例（Task 1）**（2026-10-20 稽核修正：原清單列 5 個並把 Task 3／Task 6 算成「改寫既有測試」，但 Task 3 明講「本任務不改 `src/ui/inventory.ts`」、Task 6 只改 `src/main.ts`（`furnace.test.ts` 的改寫其實在 Task 1）→ 帳目改正）：
- **本批要改寫的既有測試（集中清單，2026-10-20 終審修正）**（**基數一律讀現況**：「基數」欄＝實作者在對應 Task 的 Step 1 讀到的當前值，並在該 Task 的 commit 訊息註明實際值）：
  | 檔案 | 既有測試 | 改法 | 理由 |
  |---|---|---|---|
  | `src/core/items.test.ts` | — | **只新增**案例（既有案例一字不改） | 新增 `sanitizeStackClamped`／`sanitizeSlotsClamped` 的行為 |
  | `src/world/furnace.test.ts` | — | **只新增**案例（既有案例一字不改） | 新增 `normalizeFurnaceState`／`MAX_FUEL_UNITS` 的行為 |
  | `src/world/blocks.test.ts` | `'hardness table matches vanilla 1.20+'` | 加 `[BLOCK.CHEST, 2.5]` | 資料表同步 |
  | `src/world/blocks.test.ts` | `'requiredTool／fastTool data matches vanilla'` | 加 `[BLOCK.CHEST, null, 'axe']` | 該表**含窮舉守門斷言** `expect(expected.map(([id]) => id).sort(byId)).toEqual([...Object.values(BLOCK)].sort(byId))`，加 `BLOCK.CHEST` 後必紅 → **只能補一列，不得刪或弱化那條守門斷言** |
  | `src/core/recipes.test.ts` | 配方筆數斷言 | 改成 `<基數 + 1>`（基數＝現況 `RECIPES.length`；**本批的上游是 B5 與 B6 兩批都落地後的現況 → 32 → 33**；B5 加 18 筆、B6 加 1 筆火把配方；**一律以 Task 2 Step 1 讀到的當前值為準**，並在 commit 訊息註明實際值） | 新增箱子配方 |
  | `src/render/textures.test.ts` | `'drawn tiles keep their content; empty layers are opaque magenta #ff00ff'` 的洋紅層清單 | **只驗證、不改寫**（修復點在 B3；本批 `TILE_COUNT` → 41 後清單自動變 `[41, 42, 47, 63]`）。備援：上游仍是寫死值時由本批補改成與 B3 相同的 `[TILE_COUNT, TILE_COUNT + 1, 47, 63]` | 三批各寫各的會衝突；且本批 `TILE_COUNT` 40 → 41 會讓寫死的 layer 40 變成內容層而紅 |
  | `src/world/save.test.ts` | `makePayload()` fixture、`'migrates a raw v1…v5 record…'` 系列、`'derives the stash when a v5 record carries a corrupt or missing one'`、`'rejects a record with an unsupported version'`、`'accepts a fully valid payload…'`、`'round-trips a full SavePayload through IndexedDB (deep equal)'`、所有 `collectSavePayload({...})` 呼叫點 | 版本 5 → 6；補 `blockEntities: []`；v1／v2／**v3**／**v4**／v5 五支遷移案例都要改名並補 `blockEntities` 斷言 | payload v5 → v6（形狀升版） |
  | `src/core/cloud-save.test.ts` | format 常數案例 | 3 → 4；`readableFormats` → `[1, 2, 3, 4]` | 雲端格式升版 |
  | `src/ui/ui.test.ts` | — | **只新增**案例（既有 B5 案例一個不多、一個不少） | 本批不改 `src/ui/inventory.ts` |
  - Task 3／6／7／8 **不動既有測試**（只新增案例或只改非測試檔）。
- 版本：本批發布 `0.11.0`；`package.json` 與 `game.json` 同步；tag 為 `v0.11.0` 且指向含 bump 的 commit；不覆寫已發布版本；`id` 固定 `wecraft`。
- 存檔：**本機 payload 升 v6**（新增 `blockEntities` 欄位＝塊實體清單）；**v1／v2／v3／v4／v5 必須照讀遷移**（舊記錄沒有塊實體 → 空的清單；箱子與熔爐在那之前根本不存在）。**雲端 format 升 4**：`game.json` 的 `cloudSave` 改為 `{ "readableFormats": [1, 2, 3, 4], "writeFormat": 4 }`；`readableFormats` 只累積、不縮。
- **回退限制（升版後的既定後果）**：0.11.0 寫出的雲端資料是 format 4；0.10.0（B7）只宣告 `readableFormats:[1,2,3]`，**讀不到 format 4** → 平台會以 `SAVE_FORMAT_INCOMPATIBLE` 擋下不相容回退。本機存檔同理：0.11.0 寫出的是 payload v6，0.10.0 的 `isValidSavePayload` 只接受 v1–v5 → **v6 記錄在 0.10.0 會被視為「沒有存檔」**（該舊版再度儲存時會以舊格式覆寫）。此點必須寫進 `docs/releases/v0.11.0.md` 與 README。
- 原版基準：Minecraft Java Edition 1.20+；數值以本計畫〈已查證與設計決策〉為準（逐條引 wiki，見該節）。
- **方塊 id 固定為 33**（公約 §3.5 的跨批編號表＝唯一真值：B3 17–25（`SPRUCE_LOG` 17…`ICE` 25）、B4 `WOOL`=26、B5 27–31（`GRAVEL` 27／`GOLD_ORE` 28／`DIAMOND_ORE` 29／`SPRUCE_PLANKS` 30／`BIRCH_PLANKS` 31）、B6 火把=32、**B8 箱子=33**；貼圖索引 `T.CHEST`=**40**、`TILE_COUNT`=41，上限 64 層）。Task 2 Step 1 必須先讀 `src/world/blocks.ts` 的現況確認 33 仍空閒；若已被占用，取「當時最大值 + 1」並在 commit 訊息註明（**不得默默改號**）。
  （2026-10-20 稽核修正：本條原文抄的是 B6 計畫的舊表「B3 17–27／B4 `WOOL`=28／B5 `GRAVEL`=29／`GOLD_ORE`=30／`DIAMOND_ORE`=31」——與公約 §3.5 不符 → 改用公約原文數字；**B8 的結論（箱子 33／tile 40）不變**，只是推導表的數字要對齊。）
- **游標堆疊規則只有一份實作（2026-10-20 終審修正）**：B5（0.8.0）的 `src/ui/inventory.ts` 內嵌了一份游標規則，**本批不得再改那個檔案**（動它會弱化 B5 的既有測試，且等於兩批各自改同一套規則）。本批新增的 `src/ui/cursor.ts` 是**本批唯一的游標規則實作**——容器面板（`src/ui/container.ts`）必須呼叫它。**若實作者要順手把 B5 的 `src/ui/inventory.ts` 改成呼叫 `cursor.ts`**：必須讓 `src/ui/ui.test.ts` 的既有游標案例**原樣通過（不得改斷言）**，並在 commit 訊息說明；否則**維持 B5 的版本不動**（兩份實作並存是可接受的，只要 B5 那份不被本批破壞）。
- **本批不做（明示範圍外）**：54 格連體大箱子（spec §B8 明列為延伸）、桶／潛影盒／漏斗／命名／鎖定、shift 快速搬運、原版箱子的正面貼圖細節、箱子裡的合成台、熔爐的燃料表擴充。單箱 27 格是本批的必達項。
- **不動 `Esc`／iframe／保留鍵的既有路由**；本批新增的是一個疊層（container）狀態，會沿用既有 overlay 的 `exitPointerLock` → `relockCanvas` 循環 → **批末必須補 Playwright 真實瀏覽器驗收**（見〈批末驗收〉）。
- 本批改動到的「Minecraft parity」宣稱（存檔格式、背包結構、熔爐、方塊掉落）要同步校正（各任務自己處理碰到的段落，Task 8 收斂 README）。
- 註解與文件用繁體中文（台灣用語）；識別字與程式碼英文。
- **行號基準**：`master @ b11273f`（0.4.0）。本計畫的行號以該基準為準；B2–B7 落地後 `src/main.ts`、`src/core/items.ts`、`src/world/save.ts` 的行號會位移，後續任務以「當時檔案內容」為準（用錨點／程式碼片段定位，不要照抄行號）。
- 發布候選跑固定工具：`.playroom/tools/playroom-game-tools-1.1.0.zip`（先驗 `sha256` 與 `.playroom/game-tools.lock.json` 一致）＋ `pack-game.mjs`＋`validate-game.mjs`；本機無 `unzip`，用 `python3 -m zipfile`。

---

## Review Focus

（spec 沒明說、但最可能咬人的失敗模式；每一條都已在對應任務放測試。）

1. **壞資料是丟棄「那一筆塊實體」還是「整包存檔」**：一筆手改過的箱子（座標是浮點、item id 不存在、slots 長度不對）若讓 `loadGame` 整包回 null，玩家的整個世界就沒了 → Task 1（`normalizeBlockEntity` 逐筆回 null、`normalizeBlockEntities` 只丟壞筆）、Task 4（「壞記錄只丟該筆，其餘照讀」＋「v6 的壞塊實體不影響玩家進度」）、Task 5（雲端 `acceptCloudData` 同一套規則）。
2. **「防爆量」的上限必須同時管住「筆數」與「每筆的數量」**：只限制筆數不夠——一筆箱子塞 27 格 × 9999 個物品就能把雲端 payload 灌爆 → Task 1（每格數量夾到 `maxStack`、熔爐進度夾到 `SMELT_TIME_SEC`、燃料單位夾到 `MAX_FUEL_UNITS`、筆數上限 `MAX_BLOCK_ENTITIES`）、Task 5（雲端 64 KiB 預算仍是最後一道閘）。
3. **熔爐內容重開就消失（現況的病灶）**：`src/main.ts` 的 `furnaces` 是 session-only 的 Map，`clearFurnaces()` 在開新局／繼續遊戲／重生時都會清空它，而且**從來沒有被存進 payload** → Task 6（熔爐狀態搬進塊實體 map、只在開新局時清空、continueGame 從 payload 還原）＋ Task 4（v6 往返測試：熔爐的 input/fuel/output/progressSec/fuelUnits 全部回來）。
4. **容器 UI 的游標堆疊會不會吞物或複製物**（B1 的 stash 外洩同型 bug）：面板關閉時游標上的東西必須回到背包，放不下也得留著下次開面板看得到 → Task 3（「關閉面板時總物品數不變」＋「歸還回呼」＋「放不下就保留」＋「**歸還成功後游標必須清空**」四個案例）＋ Task 7（main.ts 的 `onReturnCursor` 接 `giveItem`）。
   （2026-10-20 稽核修正：原計畫的 `close()` 寫 `opts?.onReturnCursor?.(cursor) ?? cursor` —— `??` 只在 null/undefined 時取右邊，而契約是「回傳 `null` ＝ 已全數放回」→ 回 `null` 時游標仍留著同一疊、而物品同時已在背包裡 → **每開關一次面板就複製一份**。**禁用 `??`**；語意改用 `undefined`／`null` 明確區分，見 Task 3。）
5. **箱子破壞時內容物會不會漏掉**：原版是「箱子裡的東西也一起掉落」→ Task 1／Task 7（`spillBlockEntity`：27 格全滿 → 27 個掉落物、總數守恆、熔爐的 input/fuel/output 各一個；創造模式不灑）。
6. **回退限制沒公告**：0.11.0 的雲端是 format 4、本機是 v6，舊版讀不到 → Task 5（`game.json` 與程式常數一致的測試）、Task 8（發布說明四段＋README 兩處都要寫）。

---

## 已查證與設計決策

（公約 §7 B8 查證清單的結果；引註格式：`已查證（minecraft.wiki/<Page>，2026-10-20）`。抓不到原文者寫「實作時複核」。）

### 1. 箱子：格數、配方、硬度、破壞掉落

- 已查證（minecraft.wiki/Chest，2026-10-20，Container 段）：「A small chest has 27 slots of inventory space, and a large chest has twice that amount, at 54 slots.」→ **單箱 27 格**（本批必達）；54 格連體大箱子是 spec 明列的延伸項，本批不做。
- 同頁（Crafting 段）：配方是 **Any Planks → 1 Chest**（8 塊板材排成 3×3 環、中間空一格）→ 本批照做，且**8 塊必須是同一種板材**（原版的 "Any Planks" 是「任一種木板」，不是「任意混合」）。
- 同頁（Infobox＋Breaking 段）：**Hardness 2.5**、「Tool: Axe Required（但任何工具都能挖，斧頭最快）」；「Chests always drop themselves when mined. If the chest contains items, the items are also dropped when the chest is broken.」→ 本作：**`requiredTool = null`（徒手也能掉落箱子本體）**、`fastTool = 'axe'`、破壞時箱子本體與內容物都掉落。
- **破壞秒數的刻意簡化**：原版 Java 的箱子徒手 13.75 秒（wiki 的 Breaking time 表），本作沿用 B1 的通用公式 `硬度 × 1.5 ÷ 工具速度` → 徒手 3.75 秒、木斧 1.875 秒、石斧 0.9375 秒、鐵斧 0.625 秒。**比原版快得多，但與本作其他方塊的公式一致** → 寫進 README〈與原版的差異〉，不為箱子開特例。
- 掉落物形態：一箱最多 27 格 × 64 個 = 1,728 個物品（原版小箱子最大 1,728 個，wiki 的容量表）→ 本作照樣**每格散落成一個掉落物實體**（不做「整箱合成一個掉落物」的簡化，因為掉落物沒有堆疊上限，1,728 個也散得完）。

### 2. 容器 GUI 的操作模型

- 已查證（minecraft.wiki/Inventory，2026-10-20，Managing inventory 段）：「Stacks can be grabbed as a whole by pressing left-click on the stack and can be split in two by pressing right-click. If the stack is an odd quantity, then it leaves the smaller half behind (for example, a stack of 7 grabs 4 items and leaves 3 in the slot).」→ **左鍵整疊拿起／放下；右鍵取一半（7 → 拿 4 留 3）**。本批的容器面板沿用 **B5 背包完全相同的游標堆疊模型**（規格要求「沿用 B5 的操作模型」），因此規則不變。
- 同頁：「Holding ⇧ Shift and clicking on a stack sends the stack from the player's hotbar to the player's 27 inventory slots or vice versa…」→ 原版有 shift 快速搬運，**本批不做**（B5 的背包也沒有）→ 寫進 README〈與原版的差異〉。
- 同頁：「Pressing use on a block with an inventory, such as a chest… opens its GUI」→ 右鍵箱子＝開啟容器（即使手上拿著方塊也先開容器，這是原版的行為；本作的熔爐／工作台已是同一條路徑）。

### 3. 熔爐的塊實體欄位

- 已查證（minecraft.wiki/Furnace，2026-10-20，Block data 段）：熔爐的塊實體有 `Items`（Slot 0＝待熔煉物、Slot 1＝燃料、Slot 2＝產物）、`lit_time_remaining`（燃料剩餘）、`cooking_time_spent`（已熔煉的 tick）、`cooking_total_time`、`lit_total_time` → 本作的熔爐狀態 `FurnaceState { input, fuel, output, progressSec, fuelUnits }` **一一對應**（`progressSec` ↔ `cooking_time_spent`、`fuelUnits` ↔ `lit_time_remaining` 的「剩餘可熔煉次數」版本）。既有 `src/world/furnace.ts` 的 `stepFurnace` 邏輯不動，只把這 5 個欄位搬進塊實體持久化。
- 同頁（Breaking 段）：「Furnaces drop their contents when broken」→ 熔爐破壞時灑出內容（**現況 `src/main.ts` 已經這樣做**，本批把它併進共用的溢出函式）。

### 4. 壞資料的處置粒度（釘死）

- **逐筆丟棄、絕不整包拒絕**：比照 B1 的 `sanitizeStack`（壞 item id → 該格變空）與 `normalizeModeStash`（壞 stash → 正規化，不影響整份存檔）。塊實體的規則：
  | 壞在哪裡 | 處置 |
  |---|---|
  | `kind` 不是 `'chest'`／`'furnace'` | **丟棄這一筆** |
  | `x`／`y`／`z` 不是整數，或 `y` 超出 `0..255`（世界高度 256） | **丟棄這一筆** |
  | 同一座標出現兩筆 | **保留第一筆**（後者丟棄），deterministic |
  | 箱子 `slots` 長度不是 27 | **補 null 到 27／截斷到 27**（`sanitizeSlots` 的既有語意） |
  | 某格 item id 不存在 | **該格變空**（其他格不受影響） |
  | 某格數量不是有限正數 | **該格變空** |
  | 某格數量超過該物品的堆疊上限 | **夾到 `maxStack`**（64／工具 1）——`sanitizeStack` 刻意不夾（那是 `InventoryModel` 的工作），塊實體沒有模型，所以另立 `sanitizeStackClamped`（**保留 B7 的 `dur`**，見 Task 1 Step 3） |
  | 熔爐 `progressSec` 非法 | **夾到 `0..SMELT_TIME_SEC`** |
  | 熔爐 `fuelUnits` 非法 | **夾到 `0..MAX_FUEL_UNITS`**（512 ＝ 64 個煤 × 8） |
  | 整筆不是物件／不是陣列 | **丟棄** |
  | 筆數超過 `MAX_BLOCK_ENTITIES`（512） | **保留前 512 筆**，其餘丟棄 |
- **唯一的整包拒絕條件**維持不變：`isValidSavePayload` 的基礎檢查（version／player／modified／clock）——塊實體**不列入基礎檢查**（比照 `stash`／`advancements` 的既有做法：在 `loadGame` 裡正規化）。

### 5. 數量上限（防爆量）的四道閘

1. **筆數**：`MAX_BLOCK_ENTITIES = 512`（載入與寫出都套用；超出者從尾端丟棄，deterministic）。
2. **每筆的格數**：箱子固定 27 格；熔爐固定 3 格。
3. **每格的數量**：夾到 `maxStack`（64／工具 1）→ 一箱最多 27 × 64 = 1,728 個物品；512 箱最多 884,736 個物品（本機存檔吃得下；雲端另有第 4 道閘）。
4. **雲端位元組預算**：`CLOUD_MAX_BYTES = 65536` 的既有閘門不變（`byteSizeOf(data) > CLOUD_MAX_BYTES` → toast「雲端空間不足，僅本機存檔」）。**塊實體塞滿時雲端檢查點會被拒絕上傳，本機存檔不受影響** → 寫進 README 與發布說明（已知問題）。

### 6. 容器面板的資料流（避免 B1 的 stash 外洩）

- 容器面板的 27 格是**箱子塊實體的活陣列**（`entity.slots`），玩家的 36 格是**背包模型的活陣列**；面板的每一次變動都透過 `onContainerChange(index, stack)`／`onInventoryChange(index, stack)` 由擁有者（`main.ts`）寫回 —— **面板不持有任何副本**，關閉面板不會遺失任何東西。
- 游標堆疊是面板自己的狀態；`close()` 時交給 `onReturnCursor(stack)`（`main.ts` 接 `giveItem`），放不下就留在面板上（下次 `open()` 還看得到），與 B5 背包的語意一致。**回呼的契約寫死三態**（2026-10-20 稽核修正；`undefined`＝沒有回呼／無法判定、`null`＝已全數放回、堆疊＝放不下的餘量）：
  | 回呼回傳 | 面板該怎麼做 | 為什麼 |
  |---|---|---|
  | `undefined`（或根本沒給回呼） | **游標原樣保留** | 沒有任何人接手這疊東西 → 留著下次 `open()` 還看得到（不得吞物） |
  | `null` | **游標清空** | 擁有者已把整疊收下（`giveItem` 全部放回背包）→ 面板手上必須是空的，否則同一疊會同時存在於背包與面板 → **製造一份** |
  | `ItemStack` | **游標保留這一份** | 擁有者只收下了部分（背包滿）→ 餘量留著 |
  **禁用 `?? cursor` 這類寫法**：`??` 會把「回傳 `null`（成功歸還）」誤判成「沒回傳」→ 物品被複製。
- **存檔寫出的是當下的 map 快照**（`serializeBlockEntities` 深拷貝），不是面板開啟時的快照 → 不會出現「面板開著時存的內容少一格」。

---

## 檔案結構

| 檔案 | 動作 | 職責 |
|---|---|---|
| `src/core/items.ts` | 修改 | 新增 `sanitizeStackClamped`（清洗 ＋ 夾到 `maxStack`；**保留 B7 的 `dur`**）與 `sanitizeSlotsClamped`（槽位陣列版，夾到 `maxStack`）；`sanitizeStack`／`sanitizeSlots` 刻意不夾 |
| `src/world/furnace.ts` | 修改 | 新增 `MAX_FUEL_UNITS`、`normalizeFurnaceState`（純函式，熔爐狀態的載入端正規化） |
| `src/world/block-entities.ts` | **新增** | 塊實體資料模型、`CHEST_SLOTS`／`MAX_BLOCK_ENTITIES`、正規化／序列化／溢出 |
| `src/world/block-entities.test.ts` | **新增** | 純邏輯測試（模型、逐筆丟棄、上限、溢出） |
| `src/world/blocks.ts` | 修改 | `BLOCK.CHEST = 33`、`T.CHEST` 貼圖、`TILE_COUNT`、DEFS 第 33 筆、`PLACEABLE` |
| `src/render/textures.ts` | 修改 | 畫出箱子貼圖 tile |
| `src/render/textures.test.ts` | 修改 | 新增 `'the chest tile is painted (not the magenta debug fill)'`（既有洋紅層清單**只驗證、不改寫**——唯一的修復點在 B3，見 Task 2 Step 1） |
| `src/core/recipes.ts` | 修改 | `SameItemCell` 配方格 ＋ 箱子配方（8 塊同種板材） |
| `src/core/items.ts` | 修改 | `BLOCK_PAIRS` 加 `['chest', BLOCK.CHEST]` |
| `src/audio/sounds.ts` | 修改 | `GROUP_BY_BLOCK[BLOCK.CHEST] = 'wood'` |
| `src/ui/icons.ts` | 修改 | 箱子有方塊形式後，圖示改由圖集貼圖提供；移除 `drawItemArt` 內已無路徑的 `case 'chest'` |
| `src/ui/cursor.ts` | **新增** | 游標堆疊的純規則（左鍵整疊／右鍵一半）——容器面板與背包面板共用 |
| `src/ui/cursor.test.ts` | **新增** | 游標規則單元測試 |
| `src/ui/container.ts` | **新增** | 容器面板 DOM（27 格箱子 ＋ 36 格玩家背包 ＋ 游標堆疊） |
| `src/ui/container.test.ts` | **新增** | jsdom 測試（格數、搬運、歸還、總數守恆） |
| `src/ui/ui.css` | 修改 | `.ui-container` 樣式（沿用 `.ui-slot`／`.ui-inv-main`／`.ui-inv-bar`） |
| `src/world/save.ts` | 修改 | payload v6 ＋ `blockEntities` 欄位 ＋ v1–v6 遷移鏈 |
| `src/world/save.test.ts` | 修改 | v6 fixture、v1–v5 → v6 遷移測試、塊實體往返測試 |
| `src/core/cloud-save.ts` | 修改 | `CLOUD_FORMAT_VERSION = 4`、`CLOUD_READABLE_FORMATS = [1,2,3,4]`、`blockEntities` 欄位與正規化 |
| `src/core/cloud-save.test.ts` | 修改 | format 4 的建置／驗收／遷移測試、`game.json` 一致性測試 |
| `src/main.ts` | 修改 | 塊實體 map、容器開啟、破壞溢出、存檔／雲端往來、熔爐狀態搬遷 |
| `package.json`、`game.json` | 修改 | 版本 0.11.0；`cloudSave` 升 format 4 |
| `README.md`、`docs/releases/v0.11.0.md` | 修改／新增 | Task 8 發布 |

---

### Task 1: 塊實體資料模型、驗證與溢出（純邏輯）

**Files:**
- Create: `src/world/block-entities.ts`、`src/world/block-entities.test.ts`
- Modify: `src/core/items.ts`（`sanitizeStackClamped`／`sanitizeSlotsClamped`）、`src/core/items.test.ts`
- Modify: `src/world/furnace.ts`（`MAX_FUEL_UNITS`、`normalizeFurnaceState`）、`src/world/furnace.test.ts`

**Interfaces:**
- Consumes: `src/core/items.ts` 的 `ItemStack`／`sanitizeStack`／`maxStack`；`src/world/furnace.ts` 的 `FurnaceState`／`SMELT_TIME_SEC`；`src/world/chunk.ts` 的 `CHUNK_HEIGHT`（256）；`src/world/drops.ts` 的 `spawnDrop`／`DropEntity`；`src/core/inventory.ts` 的 `GameMode`。
- Produces:
  - `src/core/items.ts`：
    ```ts
    /** Sanitize an untrusted stack AND bound its count to `maxStack`.
     *  `sanitizeStack` deliberately passes the count through (the
     *  `InventoryModel` does the clamping); this one is for call sites with
     *  no model — B8's block-entity container slots. Null for junk.
     *
     *  KEEPS `dur` (B7's invariant): `sanitizeStack` already materializes a
     *  legal `dur` for durable items, so rebuilding `{ item, count }` here
     *  would silently repair every damaged tool inside a chest. */
    export function sanitizeStackClamped(x: unknown): ItemStack | null;

    /** Sanitize a slot array to EXACTLY `count` slots AND bound every kept
     *  stack's count to `maxStack` — the model-less counterpart of
     *  `sanitizeSlots` (which passes counts through). */
    export function sanitizeSlotsClamped(x: unknown, count: number): Array<ItemStack | null>;
    ```
    規則：先 `sanitizeStack`（未知 id／非有限 count／count ≤ 0 → null）；再 `count = Math.min(Math.floor(count), maxStack(item))`；結果 < 1 → null；**回傳 `{ ...s, count }`（保留 B7 的 `dur` 欄位）**。
  - `src/world/furnace.ts`：
    ```ts
    /** 熔爐燃料剩餘「可熔煉次數」的上限：64 個煤 × 8 = 512。 */
    export const MAX_FUEL_UNITS = 512;
    /** 把不可信的熔爐狀態正規化（載入端）：三個堆疊過
     *  `sanitizeStackClamped`，`progressSec` 夾到 `0..SMELT_TIME_SEC`，
     *  `fuelUnits` 夾到 `0..MAX_FUEL_UNITS`（整數）。非物件 → `emptyFurnace()`。 */
    export function normalizeFurnaceState(raw: unknown): FurnaceState;
    ```
  - `src/world/block-entities.ts`（新模組）：
    ```ts
    /** 單一箱子的格數（原版小箱子 27 格）。 */
    export const CHEST_SLOTS = 27;
    /** 一個世界最多保留的塊實體數（載入與寫出都套用；防爆量）。 */
    export const MAX_BLOCK_ENTITIES = 512;

    export type BlockEntityKind = 'chest' | 'furnace';

    export interface BlockEntity {
      kind: BlockEntityKind;
      x: number;
      y: number;
      z: number;
      /** 箱子：27 格（`kind === 'chest'`）；熔爐：null。 */
      slots: Array<ItemStack | null> | null;
      /** 熔爐：輸入／燃料／產物（`kind === 'furnace'`）；箱子：null。 */
      input: ItemStack | null;
      fuel: ItemStack | null;
      output: ItemStack | null;
      /** 熔爐：已累積的熔煉秒數（0..SMELT_TIME_SEC）；箱子：0。 */
      progressSec: number;
      /** 熔爐：燃料剩餘可熔煉次數（整數 0..MAX_FUEL_UNITS）；箱子：0。 */
      fuelUnits: number;
    }

    export function blockEntityKey(x: number, y: number, z: number): string;
    export function emptyChestEntity(x: number, y: number, z: number): BlockEntity;
    export function emptyFurnaceEntity(x: number, y: number, z: number): BlockEntity;
    export function furnaceStateToEntity(state: FurnaceState, x: number, y: number, z: number): BlockEntity;
    export function entityToFurnaceState(entity: BlockEntity): FurnaceState;
    /** 兩個熔爐狀態是否「實質相同」（progressSec／fuelUnits／三個堆疊的
     *  item・count・dur）—— 給每幀推進用來避免無謂的 map 寫回。 */
    export function sameFurnaceState(a: FurnaceState, b: FurnaceState): boolean;
    export function normalizeBlockEntity(raw: unknown): BlockEntity | null;
    export function normalizeBlockEntities(raw: unknown): BlockEntity[];
    export function serializeBlockEntities(list: ReadonlyArray<BlockEntity>): BlockEntity[];
    export function spillBlockEntity(
      drops: DropEntity[],
      entity: BlockEntity | null,
      pos: { x: number; y: number; z: number },
      mode: GameMode,
    ): DropEntity[];
    ```
    - `blockEntityKey` 回傳 `` `${x},${y},${z}` ``（**與 `world.modified` 的鍵格式一致**）。
    - `spillBlockEntity`：箱子 → 每個非空槽各一個掉落物（數量＝槽內數量）；熔爐 → `input`／`fuel`／`output` 各一個；**`mode === 'creative'` → 一律不灑**（回傳同一個陣列參考）；回傳**新的** drops 陣列（不就地改動）；**每一個掉落物都要帶著 `dur`**（見 Task 1 Step 5）。

- [ ] **Step 1: 寫測試（失敗）**

  `src/core/items.test.ts` 新增：
  - `'sanitizeStackClamped bounds the count to the max stack size'`
    ```ts
    expect(sanitizeStackClamped({ item: 'stone', count: 9999 })).toEqual({ item: 'stone', count: 64 });
    expect(sanitizeStackClamped({ item: 'iron_pickaxe', count: 4 })!.count).toBe(1);
    expect(sanitizeStackClamped({ item: 'stone', count: 0 })).toBeNull();
    expect(sanitizeStackClamped({ item: 'mystery', count: 1 })).toBeNull();
    expect(sanitizeStackClamped({ item: 'stone', count: 64.9 })!.count).toBe(64);
    ```
    （`iron_pickaxe` 的 `dur` 由 B7 的 `sanitizeStack` materialize → 只斷言 `count`，不斷言整個物件。）
  - `'sanitizeStackClamped keeps the durability of a damaged tool'`（2026-10-20 稽核修正）
    ```ts
    expect(sanitizeStackClamped({ item: 'wooden_pickaxe', count: 1, dur: 30 })).toEqual({ item: 'wooden_pickaxe', count: 1, dur: 30 });
    ```
    （**端到端的 `dur` 不變量**：B7 的 `sanitizeStack` 會把合法 `dur` 保留；本函式若重建 `{ item, count }` 就會把箱子裡的受損工具洗成滿耐久 → 讀檔往返後變成新的工具。若 B7 的 `dur` 欄位名不同，實作者先讀 `src/core/items.ts` 的 `ItemStack` 定義再對齊。）
  - `'sanitizeSlotsClamped bounds every slot count to the max stack size'`：
    ```ts
    expect(sanitizeSlotsClamped([{ item: 'stone', count: 9999 }, { item: 'iron_pickaxe', count: 3 }], 3))
      .toEqual([{ item: 'stone', count: 64 }, { item: 'iron_pickaxe', count: 1 }, null]);
    ```

  `src/world/furnace.test.ts` 新增：
  - `'normalizeFurnaceState sanitizes the stacks and clamps the progress'`
    ```ts
    expect(normalizeFurnaceState({ input: { item: 'raw_iron', count: 2 }, fuel: null, output: null, progressSec: 999, fuelUnits: -1 }))
      .toEqual({ input: { item: 'raw_iron', count: 2 }, fuel: null, output: null, progressSec: SMELT_TIME_SEC, fuelUnits: 0 });
    ```
  - `'normalizeFurnaceState turns junk into an empty furnace'` → `expect(normalizeFurnaceState('garbage')).toEqual(emptyFurnace());`
  - `'normalizeFurnaceState drops an unknown item id and bounds the count'`
    ```ts
    const st = normalizeFurnaceState({ input: { item: 'mystery', count: 1 }, fuel: { item: 'coal', count: 999 } });
    expect(st.input).toBeNull();
    expect(st.fuel!.count).toBe(64);
    ```
  - `'normalizeFurnaceState keeps the durability of a damaged tool'`（2026-10-20 稽核修正：熔爐裡的受損工具同樣不能被洗白）
    ```ts
    expect(normalizeFurnaceState({ input: { item: 'iron_pickaxe', count: 1, dur: 100 } }).input)
      .toEqual({ item: 'iron_pickaxe', count: 1, dur: 100 });
    ```

  `src/world/block-entities.test.ts`（新檔）：
  - `'emptyChestEntity has 27 empty slots at the given coordinates'`
    ```ts
    const e = emptyChestEntity(1, 2, 3);
    expect(e.kind).toBe('chest');
    expect(e.slots).toHaveLength(27);
    expect(e.slots!.every((s) => s === null)).toBe(true);
    expect(e.input).toBeNull();
    expect(e.fuel).toBeNull();
    expect(e.output).toBeNull();
    expect(e.progressSec).toBe(0);
    expect(e.fuelUnits).toBe(0);
    ```
  - `'blockEntityKey matches the world modified-key format'` → `expect(blockEntityKey(5, 70, -3)).toBe('5,70,-3');`
  - `'normalizeBlockEntity drops an entry with an unknown kind'` → `expect(normalizeBlockEntity({ kind: 'barrel', x: 1, y: 2, z: 3 })).toBeNull();`
  - `'normalizeBlockEntity drops an entry with non-integer or out-of-range coordinates'`
    ```ts
    expect(normalizeBlockEntity({ kind: 'chest', x: 1.5, y: 2, z: 3 })).toBeNull();
    expect(normalizeBlockEntity({ kind: 'chest', x: 1, y: 256, z: 3 })).toBeNull();
    expect(normalizeBlockEntity({ kind: 'chest', x: 1, y: -1, z: 3 })).toBeNull();
    ```
  - `'normalizeBlockEntity pads and truncates a chest to exactly 27 slots'`
    ```ts
    const short = normalizeBlockEntity({ kind: 'chest', x: 0, y: 1, z: 0, slots: [{ item: 'stone', count: 1 }] })!;
    expect(short.slots).toHaveLength(27);
    expect(short.slots![0]).toEqual({ item: 'stone', count: 1 });
    const long = normalizeBlockEntity({ kind: 'chest', x: 0, y: 1, z: 0, slots: new Array(40).fill({ item: 'stone', count: 1 }) })!;
    expect(long.slots).toHaveLength(27);
    ```
  - `'normalizeBlockEntity drops an unknown item id but keeps the other slots'`
    ```ts
    const e = normalizeBlockEntity({ kind: 'chest', x: 0, y: 1, z: 0, slots: [{ item: 'mystery', count: 3 }, { item: 'stone', count: 2 }] })!;
    expect(e.slots![0]).toBeNull();
    expect(e.slots![1]).toEqual({ item: 'stone', count: 2 });
    ```
  - `'normalizeBlockEntity clamps a stack count to the max stack size'`
    ```ts
    const e = normalizeBlockEntity({ kind: 'chest', x: 0, y: 1, z: 0, slots: [{ item: 'stone', count: 9999 }] })!;
    expect(e.slots![0]).toEqual({ item: 'stone', count: 64 });
    ```
  - `'normalizeBlockEntity clamps the furnace progress and fuel units'`
    ```ts
    const e = normalizeBlockEntity({ kind: 'furnace', x: 0, y: 1, z: 0, progressSec: 999, fuelUnits: -5 })!;
    expect(e.progressSec).toBe(SMELT_TIME_SEC);
    expect(e.fuelUnits).toBe(0);
    ```
  - `'normalizeBlockEntities drops only the bad entries and never the whole package'`
    ```ts
    const list = normalizeBlockEntities([
      { kind: 'chest', x: 1, y: 2, z: 3, slots: [] },
      { kind: 'nope', x: 0, y: 0, z: 0 },
      'garbage',
      { kind: 'furnace', x: 4, y: 5, z: 6, input: { item: 'raw_iron', count: 2 } },
    ]);
    expect(list).toHaveLength(2);
    expect(list[0].kind).toBe('chest');
    expect(list[1].input).toEqual({ item: 'raw_iron', count: 2 });
    expect(normalizeBlockEntities('not an array')).toEqual([]);
    ```
  - `'normalizeBlockEntities keeps the first record of a duplicated coordinate'`
    ```ts
    const list = normalizeBlockEntities([
      { kind: 'chest', x: 1, y: 2, z: 3, slots: [{ item: 'stone', count: 1 }] },
      { kind: 'chest', x: 1, y: 2, z: 3, slots: [{ item: 'dirt', count: 1 }] },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].slots![0]).toEqual({ item: 'stone', count: 1 });
    ```
  - `'normalizeBlockEntities caps the number of block entities'`
    ```ts
    const many = Array.from({ length: MAX_BLOCK_ENTITIES + 10 }, (_, i) => ({ kind: 'chest', x: i, y: 1, z: 0, slots: [] }));
    expect(normalizeBlockEntities(many)).toHaveLength(MAX_BLOCK_ENTITIES);
    ```
  - `'serializeBlockEntities deep-copies and caps'`
    ```ts
    const src = [emptyChestEntity(1, 1, 1)];
    src[0].slots![0] = { item: 'stone', count: 1 };
    const out = serializeBlockEntities(src);
    src[0].slots![0]!.count = 99;
    expect(out[0].slots![0]).toEqual({ item: 'stone', count: 1 });
    ```
  - `'furnaceStateToEntity and entityToFurnaceState round-trip the furnace fields'`
    ```ts
    const st: FurnaceState = { input: { item: 'raw_iron', count: 3 }, fuel: { item: 'coal', count: 2 }, output: { item: 'iron_ingot', count: 1 }, progressSec: 4, fuelUnits: 5 };
    expect(entityToFurnaceState(furnaceStateToEntity(st, 1, 2, 3))).toEqual(st);
    ```
  - `'sameFurnaceState compares the progress, the fuel units and the three stacks'`（2026-10-20 稽核修正：每幀推進需要它來避免無謂寫回）
    ```ts
    const a: FurnaceState = { input: { item: 'raw_iron', count: 3 }, fuel: null, output: null, progressSec: 4, fuelUnits: 5 };
    expect(sameFurnaceState(a, { ...a })).toBe(true);
    expect(sameFurnaceState(a, { ...a, progressSec: 4.5 })).toBe(false);
    expect(sameFurnaceState(a, { ...a, fuelUnits: 6 })).toBe(false);
    expect(sameFurnaceState(a, { ...a, input: { item: 'raw_iron', count: 2 } })).toBe(false);
    expect(sameFurnaceState(a, { ...a, input: null })).toBe(false);
    ```
  - `'spillBlockEntity drops one item entity per non-empty chest slot'`
    ```ts
    const chest = emptyChestEntity(1, 2, 3);
    chest.slots![0] = { item: 'stone', count: 5 };
    chest.slots![1] = { item: 'dirt', count: 2 };
    const out = spillBlockEntity([], chest, { x: 1.5, y: 2.5, z: 3.5 }, 'survival');
    expect(out).toHaveLength(2);
    expect(out.map((d) => [d.item, d.count])).toEqual([['stone', 5], ['dirt', 2]]);
    ```
  - `'spillBlockEntity drops the furnace contents and nothing in creative'`
    ```ts
    const furnace = furnaceStateToEntity({ input: { item: 'raw_iron', count: 1 }, fuel: { item: 'coal', count: 1 }, output: null, progressSec: 0, fuelUnits: 0 }, 0, 0, 0);
    expect(spillBlockEntity([], furnace, { x: 0, y: 0, z: 0 }, 'survival')).toHaveLength(2);
    expect(spillBlockEntity([], furnace, { x: 0, y: 0, z: 0 }, 'creative')).toHaveLength(0);
    ```
  - `'spillBlockEntity keeps the durability of a damaged tool'`（2026-10-20 稽核修正：端到端 `dur` 不變量）
    ```ts
    const chest = emptyChestEntity(1, 2, 3);
    chest.slots![0] = { item: 'iron_pickaxe', count: 1, dur: 77 };
    const out = spillBlockEntity([], chest, { x: 1.5, y: 2.5, z: 3.5 }, 'survival');
    expect(out[0].dur).toBe(77);
    ```
    （`dur` 為 `undefined` 的堆疊 → 掉落物**不帶** `dur` 欄位 → 既有的 deep-equal 斷言不受影響。）
  - `'spillBlockEntity drops one stack per slot from a full chest'`（2026-10-20 稽核修正：把〈批末驗收〉的「27 格全滿 → 27 個掉落物、總數守恆」變成可自動執行的斷言，不只靠人工）
    ```ts
    const chest = emptyChestEntity(0, 0, 0);
    for (let i = 0; i < 27; i++) chest.slots![i] = { item: 'stone', count: 64 };
    const out = spillBlockEntity([], chest, { x: 0.5, y: 0.5, z: 0.5 }, 'survival');
    expect(out).toHaveLength(27);
    expect(out.reduce((n, d) => n + d.count, 0)).toBe(27 * 64);
    ```

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/core/items.test.ts src/world/furnace.test.ts src/world/block-entities.test.ts`
  Expected: FAIL（`sanitizeStackClamped`／`normalizeFurnaceState`／`block-entities` 模組不存在）。

- [ ] **Step 3: 實作 `src/core/items.ts` 的 `sanitizeStackClamped`**

  ```ts
  export function sanitizeStackClamped(x: unknown): ItemStack | null {
    const s = sanitizeStack(x);
    if (!s) return null;
    const count = Math.min(Math.floor(s.count), maxStack(s.item));
    if (count < 1) return null;
    // 2026-10-20 稽核修正：原計畫寫 `return { item: s.item, count }` → 把 B7 的
    // `dur` 洗掉（箱子裡的受損工具讀檔後變成滿耐久）。改用 spread 保留 dur。
    return { ...s, count };
  }

  export function sanitizeSlotsClamped(x: unknown, count: number): Array<ItemStack | null> {
    const size = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    const source: ReadonlyArray<unknown> = Array.isArray(x) ? x : [];
    const slots: Array<ItemStack | null> = [];
    for (let i = 0; i < size; i++) slots.push(sanitizeStackClamped(source[i]));
    return slots;
  }
  ```
  （`sanitizeStack` 保留原樣不動 —— B1 的既有測試釘死「count 原樣通過」。`sanitizeSlots` 也不動 → 新函式是它的「模型-less 且夾數量」對應版本，兩者用途不同、不得合併。）
  （2026-10-20 稽核修正：原計畫把這個槽位 helper 寫成 `block-entities.ts` 的私有函式 `slotsToWidth(raw, 27)` —— 命名與既有的 `sanitizeSlots(x, count)`（不夾）近義易 drift → 改名 `sanitizeSlotsClamped` 並移到 `src/core/items.ts`，與 `sanitizeStackClamped` 放一起。）

- [ ] **Step 4: 實作 `src/world/furnace.ts` 的 `normalizeFurnaceState`**

  - 新增 `export const MAX_FUEL_UNITS = 512;`（註解寫出推導：64 個煤 × `FUEL_VALUES.coal` 8 ＝ 512）。**若 B4 已把燃料值改成別的數字**（現況 `FUEL_VALUES` 是 coal 8／oak_log 2／oak_planks 2／stick 1），上限要跟著改成「`max(FUEL_VALUES)` × 64」並在 commit 訊息註明實際值。
  - 新增 `normalizeFurnaceState(raw: unknown): FurnaceState`：
    - `raw` 不是物件或為 null → 回 `emptyFurnace()`。
    - `input`／`fuel`／`output` → `sanitizeStackClamped`（null 表示空槽）。
    - `progressSec` → 有限數才取 `Math.min(Math.max(0, v), SMELT_TIME_SEC)`，否則 0。
    - `fuelUnits` → 有限數才取 `Math.min(Math.max(0, Math.floor(v)), MAX_FUEL_UNITS)`，否則 0。
  - `import { sanitizeStackClamped } from '../core/items';`（`ItemId`／`ItemStack` 的既有 type import 不動）。

- [ ] **Step 5: 實作 `src/world/block-entities.ts`**

  - `CHEST_SLOTS = 27`、`MAX_BLOCK_ENTITIES = 512`（皆 `export const`）。
  - `BlockEntity` 介面如上（`kind`／`x`／`y`／`z`／`slots`／`input`／`fuel`／`output`／`progressSec`／`fuelUnits`）。
  - `blockEntityKey(x, y, z)` → `` `${x},${y},${z}` ``。
  - `emptyChestEntity(x, y, z)` → `kind:'chest'`、`slots: new Array(27).fill(null)`、其餘欄位 `null`／`0`。
  - `emptyFurnaceEntity(x, y, z)` → `kind:'furnace'`、`slots: null`、三個堆疊 `null`、`progressSec: 0`、`fuelUnits: 0`。
  - `furnaceStateToEntity(state, x, y, z)` → 逐欄複製（`input`／`fuel`／`output` 用 `{ ...s }` 深拷貝一層）。
  - `entityToFurnaceState(entity)` → 回 `{ input, fuel, output, progressSec, fuelUnits }`（`kind !== 'furnace'` 時回 `emptyFurnace()`）。
  - `sameFurnaceState(a, b)` → 比 `progressSec`、`fuelUnits` 與三個堆疊的 `item`／`count`／`dur`（`null` 與 `null` 相等、其一為 `null` 不相等）。**熔爐每幀推進用它決定要不要寫回 map**（見 Task 6 Step 2）。
  - `normalizeBlockEntity(raw)`：照〈已查證與設計決策 §4〉的表逐條實作（`kind` 白名單 → 座標整數與 `0 ≤ y < CHUNK_HEIGHT` → 依 kind 分派欄位 → `progressSec`／`fuelUnits` 夾值）。**回傳新物件，絕不回傳輸入的參考**。
    - **kind 一致性（2026-10-20 稽核修正：原計畫沒釘死交叉欄位）**：`kind === 'chest'` → `slots` 走 `sanitizeSlotsClamped(raw.slots, CHEST_SLOTS)`（補 null 到 27／截斷到 27、每格夾到 `maxStack`），`input`／`fuel`／`output` **一律清成 `null`**、`progressSec`／`fuelUnits` 一律 0；`kind === 'furnace'` → `slots` **一律清成 `null`**，`input`／`fuel`／`output` 各走 `sanitizeStackClamped`，`progressSec` 夾 `0..SMELT_TIME_SEC`、`fuelUnits` 夾 `0..MAX_FUEL_UNITS`（整數）。→ **同一座標不可能同時是箱子又是熔爐**，開啟路徑也不會撞到另一 kind（見 Task 6 Step 2）。
  - `normalizeBlockEntities(raw)`：非陣列 → `[]`；逐筆 `normalizeBlockEntity` → 丟掉 null；用 `blockEntityKey` 去重（**先到先得**）；最後截到 `MAX_BLOCK_ENTITIES`。
  - `serializeBlockEntities(list)`：逐筆深拷貝（`slots` 逐格 `{ ...s }`、堆疊 `{ ...s }`，**`dur` 一起帶走**）；截到 `MAX_BLOCK_ENTITIES`；回傳新陣列。
  - `spillBlockEntity(drops, entity, pos, mode)`：`mode === 'creative'` → 回傳 `drops`（同一參考）；`entity === null` → 回傳 `drops`；箱子 → 逐個非空槽、熔爐 → `input`／`fuel`／`output` 依序，每一個都走
    ```ts
    drops = spawnDrop(drops, stack.item, stack.count, pos, stack.dur !== undefined ? { dur: stack.dur } : {});
    ```
    （2026-10-20 稽核修正：**必須帶 `dur`** —— B7 的 `spawnDrop(drops, item, count, pos, opts?)` 有 `opts.dur`；原計畫寫 `spawnDrop(drops, stack.item, stack.count, pos)` → 箱子／熔爐裡的受損工具溢出後變成滿耐久，直接打掉 B7 Task 4 的修正。`dur` 為 `undefined` 時**不可**把 `dur: undefined` 放進 opts（否則會破壞既有 deep-equal 斷言）。每個 `spawnDrop` 回傳新陣列（`drops.ts` 的既有契約）。）

- [ ] **Step 6: 跑測試轉綠**

  Run: `npx vitest run src/core/items.test.ts src/world/furnace.test.ts src/world/block-entities.test.ts`
  Expected: PASS。

- [ ] **Step 7: 全量驗證**

  Run: `npm run typecheck && npm test && npm run build && npm run lint`
  Expected: 全綠（既有測試一個不多、一個不少）。

- [ ] **Step 8: Commit**

  ```bash
  git add src/core/items.ts src/core/items.test.ts src/world/furnace.ts src/world/furnace.test.ts src/world/block-entities.ts src/world/block-entities.test.ts
  git commit -m "feat(block-entity): B8 塊實體資料模型（箱子 27 格／熔爐欄位）＋逐筆驗證與數量上限"
  ```

---

### Task 2: 箱子方塊本體（方塊 id 33、貼圖、物品配對、配方、掉落、音效）

**Files:**
- Modify: `src/world/blocks.ts`（`BLOCK.CHEST`、`T.CHEST`、`TILE_COUNT`、`DEFS`、`PLACEABLE`）
- Modify: `src/render/textures.ts`（畫出箱子 tile）
- Modify: `src/core/items.ts`（`BLOCK_PAIRS` 加 `['chest', BLOCK.CHEST]`）
- Modify: `src/core/recipes.ts`（`SameItemCell` 配方格 ＋ 箱子配方）
- Modify: `src/audio/sounds.ts`（`GROUP_BY_BLOCK`）
- Modify: `src/ui/icons.ts`（移除已無路徑的 `case 'chest'`）
- Test: `src/world/blocks.test.ts`、`src/core/items.test.ts`、`src/core/recipes.test.ts`、`src/world/drops.test.ts`、`src/player/interact.test.ts`、`src/render/textures.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `sanitizeStackClamped`（本任務不直接用，只用 `BLOCK_PAIRS` 的既有形狀）；B5 的 `PatternCell`（`ItemId | ReadonlyArray<ItemId> | null`）與 any-planks 機制；B7 的 `maxStack`。
- Produces:
  - `src/world/blocks.ts`：`BLOCK.CHEST = 33`；`T.CHEST = 40`（**公約 §3.5 已固定 40**；`T` 改成 `export const T` 讓 `textures.ts` 與測試能引用）；`TILE_COUNT = T.CHEST + 1`（＝ 41，上限 64 層）；`DEFS[33]` ＝ `{ id: 33, name: 'chest', hardness: 2.5, solid: true, transparent: false, top: T.CHEST, side: T.CHEST, bottom: T.CHEST, requiredTool: null, fastTool: 'axe' }`；`PLACEABLE` 加 `BLOCK.CHEST`。
  - `src/core/recipes.ts`：
    ```ts
    /** B8：一組「必須同種」的配方格（箱子的 8 塊板材：任一種板材皆可，
     *  但 8 格必須是同一種）。 */
    export interface SameItemCell { same: ReadonlyArray<ItemId> }
    export type PatternCell = ItemId | ReadonlyArray<ItemId> | SameItemCell | null;
    ```
    ＋ `RECIPES` 新增一筆 `id: 'chest'`（3×3 環、8 格同種板材、中間 `null`、結果 `{ item: 'chest', count: 1 }`）。
  - `src/core/items.ts`：`BLOCK_PAIRS` 加 `['chest', BLOCK.CHEST]` → `itemFromBlock(33) === 'chest'`、`blockFromItem('chest') === 33`。

- [ ] **Step 1: 讀現況並寫測試（失敗）**

  先讀 `src/world/blocks.ts`（`BLOCK`／`T`／`TILE_COUNT`／`DEFS`／`PLACEABLE`）、`src/core/recipes.ts`（`PatternCell`／`matchShaped`／`cellMatches`）、`src/core/items.ts`（`BLOCK_PAIRS`）、`src/render/textures.ts`（`drawAtlas` 的 `put(...)` 畫法）、`src/audio/sounds.ts`（`GROUP_BY_BLOCK`）、`src/ui/icons.ts`（`drawItemArt` 的 `case 'chest'`）。

  **先確認方塊 id 33 仍空閒**（公約 §3.5 的跨批編號表＝唯一真值：B3 17–25、B4 `WOOL`=26、B5 27–31、B6 火把=32 → **箱子 33**；貼圖 `T.CHEST`=40）。若 `BLOCK` 已有 33 或更大的值，取「當時最大值 + 1」並在 commit 訊息註明。
  （2026-10-20 稽核修正：本段原文抄的是 B6 計畫的舊表「B3 17–27／B4 28／B5 29–31」→ 改用公約 §3.5 的原文數字；**箱子＝33 的結論不變**。）

  `src/world/blocks.test.ts` 新增：
  - `'the chest block matches the vanilla hardness and tool rules'`
    ```ts
    const def = getBlockDef(BLOCK.CHEST);
    expect(def.hardness).toBe(2.5);
    expect(def.requiredTool).toBeNull();   // 徒手也能挖掉並掉落
    expect(def.fastTool).toBe('axe');
    expect(def.solid).toBe(true);
    expect(def.transparent).toBe(false);
    expect(def.top).toBe(def.side);
    expect(def.bottom).toBe(def.top);
    expect(PLACEABLE).toContain(BLOCK.CHEST);
    ```
  `src/core/items.test.ts` 新增：
  - `'the chest has a block form and stacks to 64'`
    ```ts
    expect(blockFromItem('chest')).toBe(BLOCK.CHEST);
    expect(itemFromBlock(BLOCK.CHEST)).toBe('chest');
    expect(maxStack('chest')).toBe(64);
    ```
  `src/world/drops.test.ts` 新增：
  - `'a broken chest drops itself'` → `expect(dropItemFor(BLOCK.CHEST)).toBe('chest');`
  `src/player/interact.test.ts` 新增：
  - `'the chest is harvestable bare-handed and the axe speeds it up'`
    ```ts
    expect(canHarvest(BLOCK.CHEST, null)).toBe(true);
    expect(getBreakTime(BLOCK.CHEST, null)).toBeCloseTo(3.75, 5);
    expect(getBreakTime(BLOCK.CHEST, { item: 'wooden_axe', count: 1 })).toBeCloseTo(1.875, 5);
    ```
  `src/render/textures.test.ts` 新增：
  - `'the chest tile is painted (not the magenta debug fill)'`
    ```ts
    const MAGENTA = [255, 0, 255, 255];   // 2026-10-20 稽核修正：textures.test.ts 的 MAGENTA 是
                                          // describe('buildTextureArray') 區塊內的 const，檔案層級引用會 ReferenceError
    const atlas = drawAtlas();
    const chestTile = getBlockDef(BLOCK.CHEST).side;
    expect(tilePixel(atlas, chestTile, 8, 8)).not.toEqual(MAGENTA);
    ```
    （`tilePixel` 是 `textures.test.ts` 的**檔案層級** helper，可直接用；`MAGENTA` 必須自帶一份或改用既有的 `layerPixel`／`tilePixel` 比較。）
  - **既有 `'drawn tiles keep their content; empty layers are opaque magenta #ff00ff'` 的洋紅層清單——本批只驗證、不改寫**（2026-10-20 終審修正：唯一的修復點在 **B3（0.6.0）**——B3 的 Task 3 Step 1 已把寫死的 `for (const layer of [TILE_COUNT, 32, 47, 63])` 改成 runtime 相對的 `for (const layer of [TILE_COUNT, TILE_COUNT + 1, 47, 63])`；本批 `TILE_COUNT` 從 40 升到 41 → 清單自動變成 `[41, 42, 47, 63]`，四個層都仍是未畫層 ✓）。
    - **防呆提醒**：本批把 `TILE_COUNT` 從 40 推到 41、箱子貼圖畫在 tile 40 ——**若上游仍是寫死的 `[TILE_COUNT, 32, 47, 63]`，layer 40（＝箱子貼圖）會變成「內容層」而讓該斷言變紅**。
    - **備援（若讀到的現況顯示上游仍是寫死的 `[TILE_COUNT, 32, 47, 63]`）**：由**本批**補改成與 B3 **完全相同**的相對寫法 `[TILE_COUNT, TILE_COUNT + 1, 47, 63]`（`TILE_COUNT + 1` 若 ≥ 64 或與 47／63 重複就省略該項），並在 Task 2 的 commit 訊息註明「上游 B3 未改寫，本批代為補上」。**不得另創寫法。**
  `src/core/recipes.test.ts` 新增：
  - `'a chest is crafted from eight planks of one kind'`
    ```ts
    const grid = emptyGrid(3);
    for (const i of [0, 1, 2, 3, 5, 6, 7, 8]) grid[i] = { item: 'oak_planks', count: 1 };
    expect(matchRecipe(grid, 3)).toEqual({ item: 'chest', count: 1 });
    ```
  - `'eight planks of mixed kinds do not craft a chest'`
    ```ts
    const grid = emptyGrid(3);
    grid[0] = { item: 'oak_planks', count: 1 };
    grid[1] = { item: 'spruce_planks', count: 1 };
    grid[2] = { item: 'birch_planks', count: 1 };
    grid[3] = { item: 'oak_planks', count: 1 };
    grid[5] = { item: 'oak_planks', count: 1 };
    grid[6] = { item: 'oak_planks', count: 1 };
    grid[7] = { item: 'oak_planks', count: 1 };
    grid[8] = { item: 'oak_planks', count: 1 };
    expect(matchRecipe(grid, 3)).toBeNull();
    ```
  - `'seven planks do not craft a chest'` → 少放一格 → `expect(matchRecipe(grid, 3)).toBeNull();`
  - `'the chest recipe cannot be made in a 2x2 grid'` → `expect(matchRecipe(emptyGrid(2), 2)).toBeNull();`（2×2 放不出 8 格）

  **改寫既有測試（理由寫進 commit 訊息：新增 1 個方塊 ＋ 1 筆配方 → 方塊表與配方表各補一列，**不是弱化**）**：
  - `src/world/blocks.test.ts` 的 `'hardness table matches vanilla 1.20+'` → 在 `expected` **加一列** `[BLOCK.CHEST, 2.5]`（其餘不動）。
  - `src/world/blocks.test.ts` 的 `'requiredTool／fastTool data matches vanilla'` → 在 `expected` **加一列** `[BLOCK.CHEST, null, 'axe']`。
    （**2026-10-20 稽核修正：這張表有窮舉守門斷言** `expect(expected.map(([id]) => id).sort(byId)).toEqual([...Object.values(BLOCK)].sort(byId));`（「every registered block id appears above — no silent gaps」）→ `BLOCK` 一旦加 `CHEST: 33` 這條**必紅**。解法是**補一列**，**不得**刪掉或放寬那條守門斷言。）
  - `src/core/recipes.test.ts` 既有的「配方表有 N 筆」斷言 → **讀現況**（N ＝ 實作者在 Step 1 從 `src/core/recipes.ts` 讀到的 `RECIPES.length`；上游 B5＋B6 都落地時是 32）→ 改成 `N + 1`，並註明新增的是 `chest`，且**在 commit 訊息寫出實際數字**（例：`RECIPES 32 → 33`）。（2026-10-20 終審修正：原計畫只寫「改成 N+1」但沒說明 N 要讀現況，也沒有把上游 B6 的火把配方算進基數——照抄計畫預設值會紅。）
  - `src/core/items.test.ts` 的 `'every placeable and default hotbar block maps to an item'` → **不需要改寫**（`PLACEABLE` 加了 `BLOCK.CHEST` 之後，`BLOCK_PAIRS` 已有 `['chest', BLOCK.CHEST]`（Task 2 Step 5）→ `itemFromBlock(33)` 非 null → 既有斷言照樣通過）。**只新增** `'the chest has a block form and stacks to 64'`。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/world/blocks.test.ts src/core/items.test.ts src/core/recipes.test.ts src/world/drops.test.ts src/player/interact.test.ts src/render/textures.test.ts`
  Expected: FAIL（`BLOCK.CHEST` 不存在、配方不存在、貼圖未畫）。

- [ ] **Step 3: 實作 `src/world/blocks.ts`**

  - `BLOCK` 加 `CHEST: 33`。
  - `T` 加 `CHEST: 40`（**公約 §3.5 的固定值**，不是「讀當下的 T 表取最大值 + 1」——2026-10-20 稽核修正：原計畫寫「下一個空的貼圖索引」會讓實作者自選而與其他批撞號。若合併後的現況 40 已被占用 → **停下來回報 controller**，不要默默改號；`TILE_COUNT` 改成 `T.CHEST + 1`（＝ 41））。
  - `DEFS[33]` 如上（`top`／`side`／`bottom` 全部指向 `T.CHEST` —— **六面共用同一張貼圖**，原版正面有蓋子鎖扣的細節，本批簡化）。
  - `PLACEABLE` 加 `BLOCK.CHEST`。

- [ ] **Step 4: 畫出箱子貼圖（`src/render/textures.ts`）**

  在 `drawAtlas()` 的 `put(...)` 序列尾端加一筆 `put(T.CHEST, ...)`（`textures.ts` 已經從 `../world/blocks` import `TILE_COUNT`，**把 `T` 也一併 export 並 import 進來即可，不會成迴圈** —— `blocks.ts` 不 import `textures.ts`）：
  ```ts
  // 箱子：木箱底色 ＋ 蓋子接縫（y === 5 的深色橫線）＋ 中央鎖扣 ＋ 外框暗邊
  const seam = y === 5 ? -38 : 0;
  const latch = x >= 6 && x <= 9 && y >= 6 && y <= 9 ? 26 : 0;
  const edge = x === 0 || y === 0 || x === 15 || y === 15 ? -22 : 0;
  const c = vary([162, 122, 66, 255], r, 14);
  const d = seam + latch + edge;
  return [clamp255(c[0] + d), clamp255(c[1] + d), clamp255(c[2] + d), 255];
  ```
  （`vary`／`clamp255` 是 `textures.ts` 既有的 helper。）

- [ ] **Step 5: 實作物品配對與音效**

  - `src/core/items.ts`：`BLOCK_PAIRS` 加 `['chest', BLOCK.CHEST]`（放在 `['furnace', BLOCK.FURNACE]` 之後）。**`ITEM_IDS` 不動** —— `'chest'` 早已在 union 與 `ITEM_IDS` 裡（`ALL_ITEM_IDS` 不變）。
  - `src/audio/sounds.ts`：`GROUP_BY_BLOCK` 加 `[BLOCK.CHEST]: 'wood'`。
  - `src/ui/icons.ts`：`drawItemArt` 的 `case 'chest'` **刪除**（箱子有了方塊形式 → `blockFromItem('chest')` 回 33 → 圖示改由圖集側貼圖提供，`drawItemArt` 不再會被箱子走到；留著會變成死碼）。

- [ ] **Step 6: 實作箱子配方（`src/core/recipes.ts`）**

  - 新增 `SameItemCell` 介面，`PatternCell` 擴成 `ItemId | ReadonlyArray<ItemId> | SameItemCell | null`。
  - 新增 `isSameItemCell(x: unknown): x is SameItemCell`（`typeof x === 'object' && x !== null && !Array.isArray(x) && 'same' in x`）。
  - `cellMatches(want, have)`（B5 若已存在則擴充它；否則新建）：`want === null` → `have === null`；陣列 → `want.includes(have)`；`SameItemCell` → `want.same.includes(have)`；單一 id → `have === want`。
    （2026-10-20 稽核修正：**保留 B5 既有函式的 `if (have === null) return false;` 早退** —— 沒有這個早退，`want.same.includes(have)` 在 `have: ItemId | null` 下是 TS strict 錯誤（`includes` 不接受 `null`）；而且語意上「空格永遠不匹配任何配方格」。擴充時**只加分支、不得刪早退**。）
  - `matchShaped`：既有的 bbox 與逐格比對流程不動，**只多兩件事**：(a) 逐格比對改走 `cellMatches`；(b) 掃到 `SameItemCell` 的格時把該格實際的 item id 收進 `sameIds`，迴圈結束後 `new Set(sameIds).size <= 1` 才算匹配（8 格必須同一種板材）。
  - `RECIPES` 新增：
    ```ts
    const PL: SameItemCell = { same: ['oak_planks', 'spruce_planks', 'birch_planks'] };
    {
      id: 'chest',
      kind: 'shaped',
      pattern: [
        [PL, PL, PL],
        [PL, null, PL],
        [PL, PL, PL],
      ],
      result: { item: 'chest', count: 1 },
    },
    ```
    （`PL` 的標註讓字串自動收斂成 `ItemId`；若 B5 尚未落地、板材只有 `oak_planks`，`same` 改成 `['oak_planks']` 並在 commit 訊息註明。）

- [ ] **Step 7: 跑測試轉綠**

  Run: `npx vitest run src/world/blocks.test.ts src/core/items.test.ts src/core/recipes.test.ts src/world/drops.test.ts src/player/interact.test.ts src/render/textures.test.ts`
  Expected: PASS。

- [ ] **Step 8: 全量驗證**

  Run: `npm run typecheck && npm test && npm run build && npm run lint`
  Expected: 全綠。
  人工（記錄結果）：創造模式 E 面板可捲動清單裡選「Chest」→ 熱鍵欄出現箱子圖示 → 放置後世界裡出現木箱 → 生存模式用斧頭挖 → 箱子掉落、破壞音效是木頭聲。

- [ ] **Step 9: Commit**

  ```bash
  git add src/world/blocks.ts src/world/blocks.test.ts src/render/textures.ts src/render/textures.test.ts src/core/items.ts src/core/items.test.ts src/core/recipes.ts src/core/recipes.test.ts src/world/drops.test.ts src/player/interact.test.ts src/audio/sounds.ts src/ui/icons.ts
  git commit -m "feat(block): B8 箱子方塊（id 33、8 塊同種板材合成、徒手可掉落、斧頭最快）"
  ```

---

### Task 3: 容器面板（27 格 ＋ B5 游標模型 ＋ 共用游標規則）

**Files:**
- Create: `src/ui/cursor.ts`、`src/ui/cursor.test.ts`
- Create: `src/ui/container.ts`、`src/ui/container.test.ts`
- Modify: `src/ui/ui.css`（`.ui-container` 樣式）

**Interfaces:**
- Consumes: B5 的背包面板語意（左鍵整疊、右鍵取一半、游標堆疊 `.ui-cursor-stack`、`.ui-slot`／`.ui-inv-main`／`.ui-inv-bar` class）；`src/core/items.ts` 的 `ItemStack`／`stackName`／`maxStack`；`src/ui/icons.ts` 的 `itemIcon`／`ICON_PX`／`getContext2d`。
- Produces:
  - `src/ui/cursor.ts`（新，纯規則模組）：
    ```ts
    /** 左鍵：游標空 → 拿起整疊（目標格清空）；游標有東西 → 放下整疊
     *  （目標格有東西則兩者交換）。 */
    export function cursorLeftClick(
      cursor: ItemStack | null,
      target: ItemStack | null,
    ): { cursor: ItemStack | null; target: ItemStack | null };

    /** 右鍵：游標空 → 取一半（`ceil(count/2)`，7 → 拿 4 留 3）；
     *  游標有東西 → 放 1 個（目標格必須空、或同物品且未滿）。
     *  **保留 `dur`**（B7）：回傳的堆疊一律用 spread 重建，否則右鍵一下就把
     *  受損工具洗成滿耐久。 */
    export function cursorRightClick(
      cursor: ItemStack | null,
      target: ItemStack | null,
    ): { cursor: ItemStack | null; target: ItemStack | null };
    ```
  - `src/ui/container.ts`（新）：
    ```ts
    export interface ContainerParams {
      /** 面板標題（'箱子'）。 */
      title: string;
      /** 容器的 27 格（唯讀給 UI；變動一律走 `onContainerChange`）。 */
      container: ReadonlyArray<ItemStack | null>;
      /** 玩家的 36 格背包（唯讀給 UI；變動一律走 `onInventoryChange`）。 */
      inventory: ReadonlyArray<ItemStack | null>;
      /** 容器格被改動（index 0..26）。 */
      onContainerChange(index: number, stack: ItemStack | null): void;
      /** 玩家背包格被改動（index 0..35；前 9 格是熱鍵列）。 */
      onInventoryChange(index: number, stack: ItemStack | null): void;
      /** 關閉面板時歸還游標堆疊。**回傳值語意（禁用 `??` 展開，2026-10-20 稽核修正）**：
       *  - `undefined`＝沒有回呼／無法判定 → **游標原樣保留**（下次 `open()` 還看得到）；
       *  - `null`＝已全數放回（擁有者已收下）→ **游標清空**；
       *  - `ItemStack`＝放不下的餘量 → **游標保留這一份**。
       *  （原計畫寫 `onReturnCursor?: (stack) => ItemStack | null` 卻用 `?? cursor` 取值 → 回 `null` 被當成「沒回傳」→ 同一疊同時存在於背包與面板 → 每開關一次面板就複製一份。） */
      onReturnCursor?(stack: ItemStack): ItemStack | null | undefined;
      /** 面板被關閉（背景點擊／Esc／E）。 */
      onClose?(): void;
    }

    export interface ContainerUi {
      open(params: ContainerParams): void;
      close(): void;
      isOpen(): boolean;
    }

    export function createContainer(uiRoot: HTMLElement): ContainerUi;
    ```
    DOM 結構（class 名固定，供測試選取器使用）：
    ```html
    <div class="ui-overlay ui-container-backdrop interactive">
      <div class="ui-container interactive">
        <h3>箱子</h3>
        <div class="ui-container-grid">…27 格…</div>
        <div class="ui-inv-main">…27 格…</div>
        <div class="ui-inv-bar">…9 格…</div>
        <div class="ui-cursor-stack">…游標堆疊（游標非空才存在）…</div>
      </div>
    </div>
    ```
    - 容器格 `.ui-slot` 帶 `data-cslot="0..26"`；玩家格帶 `data-slot="0..35"`（**全域索引**：主背包第 i 格 → `9 + i`；熱鍵列第 i 格 → `i`，與 B5 背包面板的版面一致）。
    - 每格用自己的 canvas 複製圖示（`itemIcon` 只快取**一張** canvas，不能直接掛到多格 —— 沿用 `ui/crafting.ts` 的 `fillSlot` 寫法）。
    - 關閉（背景點擊／`Escape`／`KeyE`）→ 先 `onReturnCursor`（游標非空時），再 `onClose`。

- [ ] **Step 1: 寫測試（失敗）**

  `src/ui/cursor.test.ts`（新）：
  - `'left click picks the whole stack up'`
    ```ts
    expect(cursorLeftClick(null, { item: 'stone', count: 5 })).toEqual({ cursor: { item: 'stone', count: 5 }, target: null });
    ```
  - `'left click places the whole cursor stack'` → `expect(cursorLeftClick({ item: 'stone', count: 5 }, null)).toEqual({ cursor: null, target: { item: 'stone', count: 5 } });`
  - `'left click swaps two occupied slots'` → `expect(cursorLeftClick({ item: 'stone', count: 5 }, { item: 'dirt', count: 2 })).toEqual({ cursor: { item: 'dirt', count: 2 }, target: { item: 'stone', count: 5 } });`
  - `'left click with an empty cursor and an empty slot changes nothing'` → `expect(cursorLeftClick(null, null)).toEqual({ cursor: null, target: null });`
  - `'right click takes half and leaves the smaller half behind'`
    ```ts
    expect(cursorRightClick(null, { item: 'stone', count: 5 })).toEqual({ cursor: { item: 'stone', count: 3 }, target: { item: 'stone', count: 2 } });
    ```
  - `'right click on a single stack takes the whole stack'` → `expect(cursorRightClick(null, { item: 'stone', count: 1 })).toEqual({ cursor: { item: 'stone', count: 1 }, target: null });`
  - `'right click places one item'` → `expect(cursorRightClick({ item: 'stone', count: 3 }, null)).toEqual({ cursor: { item: 'stone', count: 2 }, target: { item: 'stone', count: 1 } });`
  - `'right click merges one item into a matching slot'` → `expect(cursorRightClick({ item: 'stone', count: 3 }, { item: 'stone', count: 10 })).toEqual({ cursor: { item: 'stone', count: 2 }, target: { item: 'stone', count: 11 } });`
  - `'right click refuses to merge into a different item or a full slot'`
    ```ts
    expect(cursorRightClick({ item: 'stone', count: 3 }, { item: 'dirt', count: 1 })).toEqual({ cursor: { item: 'stone', count: 3 }, target: { item: 'dirt', count: 1 } });
    expect(cursorRightClick({ item: 'stone', count: 3 }, { item: 'stone', count: 64 })).toEqual({ cursor: { item: 'stone', count: 3 }, target: { item: 'stone', count: 64 } });
    ```
  - `'the cursor rules keep the durability of a damaged tool'`（2026-10-20 稽核修正：右鍵分支原本用 `{ item, count }` 重建堆疊 → 洗掉 `dur`；左鍵用 `{ ...target }` 反而有保留 → 兩條路徑不一致）
    ```ts
    const taken = cursorRightClick(null, { item: 'wooden_pickaxe', count: 1, dur: 12 });
    expect(taken.cursor).toEqual({ item: 'wooden_pickaxe', count: 1, dur: 12 });
    const placed = cursorRightClick({ item: 'wooden_pickaxe', count: 1, dur: 12 }, null);
    expect(placed.target).toEqual({ item: 'wooden_pickaxe', count: 1, dur: 12 });
    expect(placed.cursor).toBeNull();   // 放 1 個 → 游標清空
    ```
    （工具堆疊上限 1 → 右鍵一次就是整把拿走 → 若不保留 `dur`，箱子裡的受損工具右鍵一下就滿耐久。）

  `src/ui/container.test.ts`（新，jsdom）：
  - 輔助：`const chestSlots = (n = 27) => new Array(n).fill(null);`、`const playerSlots = () => new Array(36).fill(null);`、`const total = (arr) => arr.reduce((n, s) => n + (s ? s.count : 0), 0);`
  - `'the container panel shows 27 chest slots and the 36 player slots'`
    ```ts
    container.open({ title: '箱子', container: chestSlots(), inventory: playerSlots(), onContainerChange, onInventoryChange });
    expect(root.querySelectorAll('.ui-container-grid .ui-slot')).toHaveLength(27);
    expect(root.querySelectorAll('.ui-inv-main .ui-slot')).toHaveLength(27);
    expect(root.querySelectorAll('.ui-inv-bar .ui-slot')).toHaveLength(9);
    expect(root.querySelector('.ui-container')?.textContent).toContain('箱子');
    ```
  - `'left click moves a stack from the chest onto the cursor and the next click puts it in the player inventory'`
    ```ts
    const chest = chestSlots(); chest[0] = { item: 'stone', count: 5 };
    container.open({ title: '箱子', container: chest, inventory: player, onContainerChange, onInventoryChange });
    root.querySelectorAll('.ui-container-grid .ui-slot')[0].click();
    expect(onContainerChange).toHaveBeenCalledWith(0, null);
    expect(root.querySelectorAll('.ui-cursor-stack')).toHaveLength(1);
    root.querySelectorAll('.ui-inv-main .ui-slot')[0].click();
    // 主背包第 0 格 ＝ 36 格背包的**全域索引 9**（前 9 格是熱鍵列）
    expect(onInventoryChange).toHaveBeenCalledWith(9, { item: 'stone', count: 5 });
    expect(root.querySelectorAll('.ui-cursor-stack')).toHaveLength(0);
    ```
  - `'right click takes half of a stack'`
    ```ts
    root.querySelectorAll('.ui-container-grid .ui-slot')[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(onContainerChange).toHaveBeenCalledWith(0, { item: 'stone', count: 2 });
    expect(root.querySelector('.ui-cursor-stack')?.textContent).toContain('3');
    ```
  - `'closing the panel hands the cursor stack back to the owner'`
    ```ts
    const returned: ItemStack[] = [];
    container.open({ ..., onReturnCursor: (st) => { returned.push(st); return null; } });
    root.querySelectorAll('.ui-container-grid .ui-slot')[0].click();
    container.close();
    expect(returned).toEqual([{ item: 'stone', count: 5 }]);
    ```
  - `'a fully returned cursor stack is cleared instead of being duplicated'`（2026-10-20 稽核修正：**本批最重要的一條**。原計畫的 `close()` 寫 `opts?.onReturnCursor?.(cursor) ?? cursor` → 回 `null`（已全數放回）時 `??` 取右邊 → 游標仍留著同一疊、而物品同時已在背包裡 → **製造一份**，而且**每次開／關面板都會再複製一次**（`open()` 開頭先 `this.close()`）。）
    ```ts
    const returned: ItemStack[] = [];
    container.open({ ..., onReturnCursor: (st) => { returned.push(st); return null; } });
    root.querySelectorAll('.ui-container-grid .ui-slot')[0].click();
    expect(root.querySelectorAll('.ui-cursor-stack')).toHaveLength(1);
    container.close();
    expect(returned).toEqual([{ item: 'stone', count: 5 }]);
    expect(root.querySelectorAll('.ui-cursor-stack')).toHaveLength(0);   // 游標清空（不得還留著）
    container.open({ ... });                                              // 再開一次：不得又歸還一次
    expect(root.querySelectorAll('.ui-cursor-stack')).toHaveLength(0);
    expect(returned).toHaveLength(1);                                   // 總共只歸還過一次
    ```
  - `'a cursor stack that cannot be placed is kept for the next open'`
    ```ts
    container.open({ ..., onReturnCursor: (st) => st });   // 放不下 → 原樣退回
    root.querySelectorAll('.ui-container-grid .ui-slot')[0].click();
    container.close();
    container.open({ ... });
    expect(root.querySelectorAll('.ui-cursor-stack')).toHaveLength(1);
    ```
  - `'a missing return callback keeps the cursor stack for the next open'`（`undefined`＝無回呼 → 保留）
    ```ts
    container.open({ ... });                                  // 不給 onReturnCursor
    root.querySelectorAll('.ui-container-grid .ui-slot')[0].click();
    container.close();
    container.open({ ... });
    expect(root.querySelectorAll('.ui-cursor-stack')).toHaveLength(1);
    ```
  - `'the panel never changes the total item count'`（開面板 → 拿起 → 關閉 → 總數守恆）
    ```ts
    const chest = chestSlots(); chest[0] = { item: 'stone', count: 5 };
    const player = playerSlots();
    const returned: ItemStack[] = [];
    const before = total(chest) + total(player);
    container.open({
      title: '箱子',
      container: chest,
      inventory: player,
      onContainerChange: (i, s) => { chest[i] = s; },        // 模擬擁有者寫回
      onInventoryChange: (i, s) => { player[i] = s; },
      onReturnCursor: (st) => { returned.push(st); return null; },
    });
    root.querySelectorAll('.ui-container-grid .ui-slot')[0].click();
    expect(total(chest) + total(player)).toBe(before - 5);   // 物品離開格子、在游標上（還沒回來）
    container.close();
    // 歸還後總數回到原值：沒有消失、沒有複製
    expect(total(chest) + total(player) + total(returned)).toBe(before);
    ```
    （面板**不直接改** `container`／`inventory` 陣列 —— 它只發回呼，由擁有者寫回；所以這個案例用回呼模擬擁有者，再把游標上歸還的那份算進總數。）
  - `'Escape closes the panel and fires onClose once'`
    ```ts
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(root.querySelectorAll('.ui-container').length).toBe(0);
    ```
  - **jsdom 可行性說明（寫進本任務的實作註解）**：jsdom 沒有 2d context → `getContext2d` 回 null → 格子裡的 canvas 是空的（既有 `ui/crafting.ts`／`ui/furnace.ts` 已是這個模式）。因此本檔的斷言只打在 **格數、`title`、`.count` 文字、`.ui-cursor-stack` 的存在與數量、回呼的引數** 上，**不打像素**。右鍵用 `new MouseEvent('contextmenu', { bubbles: true, cancelable: true })` 觸發（面板必須 `preventDefault()`）。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/ui/cursor.test.ts src/ui/container.test.ts`
  Expected: FAIL（模組不存在）。

- [ ] **Step 3: 實作 `src/ui/cursor.ts`**

  - `cursorLeftClick(cursor, target)`：
    - `cursor === null` → `target === null` 時原樣回傳；否則回 `{ cursor: { ...target }, target: null }`。
    - `cursor !== null` → `target === null` 時回 `{ cursor: null, target: { ...cursor } }`；否則回 `{ cursor: { ...target }, target: { ...cursor } }`（交換）。
  - `cursorRightClick(cursor, target)`：
    - `cursor === null` → `target === null` 時原樣回傳；否則 `take = Math.ceil(target.count / 2)`、`rest = target.count - take` → 回 `{ cursor: { ...target, count: take }, target: rest > 0 ? { ...target, count: rest } : null }`。
    - `cursor !== null` → 目標格必須是「空」或「同物品且 `target.count < maxStack(target.item)`」；否則原樣回傳。成立時回 `{ cursor: cursor.count > 1 ? { ...cursor, count: cursor.count - 1 } : null, target: { ...cursor, count: (target?.count ?? 0) + 1 } }`。
      （2026-10-20 稽核修正：原本寫 `{ item: cursor.item, count: ... }` 與 `{ item: target.item, count: ... }` → **洗掉 `dur`**；兩條分支都改成 spread，與左鍵分支一致。）
  - **兩個函式都不改動輸入物件**（回傳新物件）。

- [ ] **Step 4: 實作 `src/ui/container.ts`**

  - `createContainer(uiRoot)`：閉包持有 `el`、`escHandler`、`cursor: ItemStack | null`、`params`（最新一次 `open` 的參數）、`opts`（上一次 `open` 的參數，用於 `close()` 時歸還游標）。
  - `open(params)`：**先 `this.close()`**（沿用 B5 背包的順序：上一次沒放回來的游標會在關閉時交給**上一次的** `onReturnCursor`；回 `null`＝已全數放回→**游標清空**、回堆疊＝放不下→**原樣留在游標上**、沒有回呼／回 `undefined`＝**留在游標上**）→ 再存 `opts = params` → 建立 DOM、掛事件、呼叫 `render()`。**注意：`open()` 不可把 `cursor` 清成 null** —— `close()` 已經處理過（清掉就會丟掉放不下的那一份，這正是 B5 語意要避免的坑）。
  - `render()`：重畫 27 格容器 ＋ 27 格主背包 ＋ 9 格熱鍵列 ＋（游標非空時）`.ui-cursor-stack`；每格用**自己的** canvas 複製 `itemIcon`；數字用 `.count` 文字；`title` 用 `stackName`。
  - 點擊處理（左鍵 `click`／右鍵 `contextmenu`）：
    - 目標格是容器格 → 呼叫 `cursorLeftClick`／`cursorRightClick`，再把結果回寫 `params.onContainerChange(cIndex, target)`（`cIndex` 0..26）。
    - 目標格是玩家格 → 回寫 `params.onInventoryChange(pIndex, target)`，**`pIndex` 是全域索引 0..35**（主背包第 i 格 → `9 + i`、熱鍵列第 i 格 → `i`）。
    - 游標 → 更新 `cursor` 並重畫。
    - 右鍵事件必須 `preventDefault()`。
  - `close()`：**游標歸還的三態語意（2026-10-20 稽核修正：原計畫寫 `const remainder = opts?.onReturnCursor?.(cursor) ?? cursor;` —— `??` 只在 null/undefined 時取右邊，而契約是「回傳 `null` ＝ 已全數放回」→ 回 `null` 時游標仍留著同一疊、而物品同時已在背包裡 → 製造一份，且 `open()` 開頭會再 `close()` 一次 → 每次開關都複製。**禁用 `??`**）**
    ```ts
    // 沒有回呼 → 留在游標上；回傳 undefined → 同樣留在游標上；
    // 回傳 null → 已全數放回 → 游標清空；回傳堆疊 → 只放不下這麼多 → 保留它。
    let remainder: ItemStack | null = cursor;
    const cb = opts?.onReturnCursor;
    if (cb) {
      const r = cb(cursor);              // ItemStack | null | undefined
      remainder = r === undefined ? cursor : r;
    }
    cursor = remainder;
    ```
    - 接著移除 backdrop、移除 keydown listener；**`cursor` 保留**（下次 `open()` 會顯示；`open()` 開頭的 `this.close()` 已把上一次沒放回來的交給**上一次的** `opts.onReturnCursor`）。
  - `Escape` 與 `KeyE` 都關閉（沿用 `ui/furnace.ts` 的行為：面板開著時按 E 也關）。
  - 背景點擊（`e.target === el`）→ 關閉 ＋ `onClose`。
  - 游標堆疊跟隨滑鼠：面板上綁 `mousemove` 更新 `.ui-cursor-stack` 的 `left/top`；`mouseleave` 移除格子的 `.ui-cursor-target` class（沿用 B5 的 class 名）。

- [ ] **Step 5: `src/ui/ui.css` 的樣式**

  ```css
  .ui-container { display: flex; flex-direction: column; gap: 8px; padding: 12px; }
  .ui-container-grid { display: grid; grid-template-columns: repeat(9, 44px); gap: 4px; }
  .ui-overlay.ui-container-backdrop { /* 與 ui-inv-backdrop 相同的置中＋半透明底 */ }
  ```
  （`.ui-slot`／`.ui-inv-main`／`.ui-inv-bar`／`.ui-cursor-stack` 的既有規則沿用；若 B5 已把 `.ui-inv-main`／`.ui-inv-bar` 定成 9 欄網格，直接重用，不另立同名規則。）

- [ ] **Step 6: 跑測試轉綠**

  Run: `npx vitest run src/ui/cursor.test.ts src/ui/container.test.ts src/ui/ui.test.ts`
  Expected: PASS（`src/ui/ui.test.ts` 的既有 B5 案例一個不多、一個不少 —— **本任務不改 `src/ui/inventory.ts`**）。

- [ ] **Step 7: 全量驗證**

  Run: `npm run typecheck && npm test && npm run build && npm run lint`
  Expected: 全綠。

- [ ] **Step 8: Commit**

  ```bash
  git add src/ui/cursor.ts src/ui/cursor.test.ts src/ui/container.ts src/ui/container.test.ts src/ui/ui.css
  git commit -m "feat(ui): B8 容器面板（27 格箱子 ＋ 玩家 36 格，共用 B5 的游標堆疊模型）"
  ```

  註：游標規則在 `src/ui/cursor.ts` 只有一份，但 B5 的 `src/ui/inventory.ts` 仍留著自己的內嵌版本 —— **本批不改它**（避免弱化 B5 的既有測試）。若實作者要一併改用 `cursor.ts`，必須讓 `src/ui/ui.test.ts` 的既有游標案例**原樣通過**（不得改斷言），並在 commit 訊息說明。
  （2026-10-20 稽核修正：B5 計畫的 `src/ui/inventory.ts` **同一個 `close()` 缺陷已被修掉**（B5 計畫 Step 3 改成 `let remainder = cursor; if (opts?.onReturnCursor) remainder = opts.onReturnCursor(cursor);`，並在該計畫的 Self-Review 列為 Critical 修正）。**B8 的容器面板必須用同一套語意**（`null`＝已歸還→清空／堆疊＝餘量→保留／無回呼→保留），**不得**寫 `?? cursor`；若合併後的 B5 實作仍是 `?? cursor`，**那是 B5 的 bug，不是 B8 要沿用的寫法**——本批至少要在本註記與回報中標明（背包與容器兩邊都會複製物品）。）

---

### Task 4: 本機存檔 v6（塊實體欄位 ＋ v1–v6 遷移鏈）

**Files:**
- Modify: `src/world/save.ts`（型別、`isValidSavePayload`、`collectSavePayload`、`loadGame`）
- Modify: `src/world/save.test.ts`（fixture 升 v6、遷移測試、往返測試）
- Modify: `src/main.ts`（建立 `blockEntities` map、存檔寫出、繼續遊戲還原）

**Interfaces:**
- Consumes: Task 1 的 `BlockEntity`／`normalizeBlockEntities`／`serializeBlockEntities`／`blockEntityKey`；B5 的 `INVENTORY_SLOTS`；B7 的 v5 payload 形狀。
- Produces:
  - `src/world/save.ts`：
    ```ts
    /** Current payload (B8): v5 plus the block entities — the chest contents
     *  and the furnace states. `loadGame` ALWAYS returns this shape: v1–v5
     *  records migrate with an EMPTY list (chests and furnaces did not exist
     *  before B8), and a v6 record's list is sanitized entry by entry. */
    export interface SavePayloadV6 extends Omit<SavePayloadV5, 'version'> {
      version: 6;
      blockEntities: BlockEntity[];
    }
    export type SavePayload = SavePayloadV6;
    ```
    - `isValidSavePayload` 接受 `version ∈ {1, 2, 3, 4, 5, 6}`；**`blockEntities` 不列入基礎檢查**（比照 `stash`／`advancements` 的既有做法 —— 在 `loadGame` 裡正規化）。
    - `SaveSources` 新增 `blockEntities: ReadonlyArray<BlockEntity>`（`collectSavePayload` 用 `serializeBlockEntities` 深拷貝）。
    - `loadGame()` 一律回傳 v6，`blockEntities: normalizeBlockEntities(raw.blockEntities)`。

- [ ] **Step 1: 讀現況並寫測試（失敗）**

  先讀 `src/world/save.ts`（型別區、`isValidSavePayload` 的版本檢查、`collectSavePayload`、`loadGame` 的遷移鏈）與 `src/world/save.test.ts` 的 fixture（`makePayload`／`makeV1Payload`／`makeV2Payload`／`slots` helper／`putRawRecord`）。

  **新增 fixture helper**：仿照 `makeV1Payload`／`makeV2Payload` 加 `makeV5Payload(): SavePayloadV5`（v5 ＝ v4 ＋ `dur` 形狀，形狀照 B7 落地後的 `SavePayloadV5`；**不含** `blockEntities`）；另加 `makeV3Payload()`／`makeV4Payload()`（**2026-10-20 稽核修正：原計畫只加 v5 的 fixture，v3／v4 兩支遷移案例沒有對應的現況讀取斷言**；v3 ＝ 雙模式狀態、v4 ＝ 36 格背包 ＋ B7 的 `dur` materialize，兩者都要在 v6 的形狀裡成立 → 直接沿用 `makeV2Payload` 的形狀往上推）。

  **改寫既有測試（理由寫進 commit 訊息：payload 版本 v5→v6，屬形狀升版，不是弱化）**：
  - `makePayload()` 的 `version: 5` → `version: 6`，並加 `blockEntities: []`。
  - 既有 `'migrates a raw v1 record to v5 …'` → 改名 `'migrates a raw v1 record to v6 …'`，斷言 `expect(loaded!.version).toBe(6);` 並補 `expect(loaded!.blockEntities).toEqual([]);`。
  - 既有 `'migrates a raw v2 record to v5 …'` → 改名 v6，同樣補 `blockEntities` 為空陣列的斷言。
  - **既有 `'migrates a raw v3 record to v4 …'`（B5 留下）→ 改名 `'migrates a raw v3 record to v6 …'`**，斷言 `expect(loaded!.version).toBe(6);`、`expect(loaded!.blockEntities).toEqual([]);`，**並保留 v3 該有的語意**（雙模式狀態的欄位仍讀得到、36 格背包形狀正確）—— **不得刪掉 v3 專屬的那些斷言**。
  - **既有 `'migrates a raw v4 record to v5 and gives an old tool full durability'`（B7 留下）→ 改名 `'migrates a raw v4 record to v6 and gives an old tool full durability'`**，斷言 `expect(loaded!.version).toBe(6);`、`expect(loaded!.blockEntities).toEqual([]);`，**並保留「舊工具滿耐久」的那條斷言**（B7 的不變量）。
  - 既有 `'derives the stash when a v5 record carries a corrupt or missing one'` → fixture 改 v6。
  - 既有 `'rejects a record with an unsupported version'`：`{ version: 6 }` → 改成 `{ version: 7 }`。
  - 既有 `'accepts a fully valid payload (v1, v2 and v3 all pass base validation)'` → 改成 v1／v2／v3／v4／v5／v6 都通過。
  - 既有 `'round-trips a full SavePayload through IndexedDB (deep equal)'`：fixture 加 `blockEntities: []`（deep-equal 需要欄位齊全）。
  - **既有 `collectSavePayload({...})` 的呼叫點全部要補 `blockEntities: []`**（新的必填欄位；TypeScript 會擋下漏掉的呼叫點 —— 這正是要的效果）。
  - （2026-10-20 稽核修正：公約 §3 的「v1–v5 全部照讀遷移」是硬需求 —— v3／v4 兩支漏列會讓實作者以為只要處理 v1／v2／v5。）

  **新增測試**：
  - `'a v5 record migrates to v6 with an empty block entity list'`
    ```ts
    await putRawRecord(makeV5Payload());
    const loaded = await loadGame();
    expect(loaded!.version).toBe(6);
    expect(loaded!.blockEntities).toEqual([]);
    ```
  - `'a v6 record round-trips the chest contents through IndexedDB'`
    ```ts
    const p = makePayload({
      blockEntities: [
        { kind: 'chest', x: 5, y: 70, z: 5, slots: new Array(27).fill(null), input: null, fuel: null, output: null, progressSec: 0, fuelUnits: 0 },
      ],
    });
    p.blockEntities[0].slots![0] = { item: 'stone', count: 12 };
    await saveGame(p);
    const loaded = await loadGame();
    expect(loaded!.blockEntities).toHaveLength(1);
    expect(loaded!.blockEntities[0].slots![0]).toEqual({ item: 'stone', count: 12 });
    expect(loaded!.blockEntities[0].slots).toHaveLength(27);
    ```
  - `'a v6 record round-trips the furnace state through IndexedDB'`
    ```ts
    const p = makePayload({
      blockEntities: [
        { kind: 'furnace', x: 1, y: 2, z: 3, slots: null, input: { item: 'raw_iron', count: 3 }, fuel: { item: 'coal', count: 1 }, output: { item: 'iron_ingot', count: 2 }, progressSec: 4.5, fuelUnits: 7 },
      ],
    });
    await saveGame(p);
    const loaded = await loadGame();
    expect(loaded!.blockEntities[0].input).toEqual({ item: 'raw_iron', count: 3 });
    expect(loaded!.blockEntities[0].fuel).toEqual({ item: 'coal', count: 1 });
    expect(loaded!.blockEntities[0].output).toEqual({ item: 'iron_ingot', count: 2 });
    expect(loaded!.blockEntities[0].progressSec).toBe(4.5);
    expect(loaded!.blockEntities[0].fuelUnits).toBe(7);
    ```
  - `'a v6 record round-trips the durability of a tool inside a chest'`（2026-10-20 稽核修正：**端到端 `dur` 不變量** —— 序列化端用 `{...s}` 有保留，但載入端若走會洗掉 `dur` 的清洗路徑，讀檔後受損工具就變成滿耐久）
    ```ts
    const p = makePayload({
      blockEntities: [
        { kind: 'chest', x: 5, y: 70, z: 5, slots: new Array(27).fill(null), input: null, fuel: null, output: null, progressSec: 0, fuelUnits: 0 },
      ],
    });
    p.blockEntities[0].slots![0] = { item: 'iron_pickaxe', count: 1, dur: 77 };
    await saveGame(p);
    const loaded = await loadGame();
    expect(loaded!.blockEntities[0].slots![0]).toEqual({ item: 'iron_pickaxe', count: 1, dur: 77 });
    ```
  - `'a corrupt block entity is dropped but the rest of the record survives'`（**本批最重要的壞資料斷言**）
    ```ts
    const p = makePayload({
      blockEntities: [
        { kind: 'chest', x: 1.5, y: 2, z: 3, slots: [] },                                  // 座標不是整數 → 丟棄
        { kind: 'nope', x: 0, y: 0, z: 0 },                                                 // 未知種類 → 丟棄
        { kind: 'chest', x: 5, y: 6, z: 7, slots: [{ item: 'mystery', count: 1 }] },        // 壞格 → 該格變空
      ],
    });
    await saveGame(p);
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.player.inventory[0]).toEqual({ item: 'stone', count: 32 });   // 玩家進度沒被連坐
    expect(loaded!.blockEntities).toHaveLength(1);
    expect(loaded!.blockEntities[0].x).toBe(5);
    expect(loaded!.blockEntities[0].slots![0]).toBeNull();
    ```
  - `'collectSavePayload carries the block entities deep-copied'`
    ```ts
    const src = [{ kind: 'chest' as const, x: 1, y: 2, z: 3, slots: [{ item: 'stone', count: 1 }] as Array<ItemStack | null>, input: null, fuel: null, output: null, progressSec: 0, fuelUnits: 0 }];
    const payload = collectSavePayload({ /* …既有來源… */ blockEntities: src });
    src[0].slots![0]!.count = 99;
    expect(payload.blockEntities[0].slots![0]).toEqual({ item: 'stone', count: 1 });
    ```

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/world/save.test.ts`
  Expected: FAIL（版本常數仍是 v5、payload 沒有 `blockEntities`）。

- [ ] **Step 3: 實作 `src/world/save.ts` 的 v6**

  - 新增 `SavePayloadV6`；`export type SavePayload = SavePayloadV6;`（保留 V1–V5 供遷移）。
  - 檔頭 doc 註解補一段：v1→v2（進度）→v3（雙模式）→v4（36 格）→v5（`dur`）→v6（塊實體）；說明「舊記錄沒有塊實體 → 空清單」。
  - `isValidSavePayload`：`r.version !== 1 && … && r.version !== 6 → false`。
  - `SaveSources` 加 `blockEntities: ReadonlyArray<BlockEntity>`；`collectSavePayload` 加 `blockEntities: serializeBlockEntities(args.blockEntities)`。
  - `loadGame`：遷移鏈維持 v1 → v2 → … → v6 的順序（`version` 一律改成 6），回傳前加 `blockEntities: normalizeBlockEntities((value as Partial<SavePayloadV6>).blockEntities)`。**舊記錄沒有這個欄位 → `normalizeBlockEntities(undefined)` → `[]`**。
    （2026-10-20 稽核修正：**載入端只能走 `normalizeBlockEntities` → `sanitizeStackClamped` 這條會保留 `dur` 的清洗路徑**；不得另外寫一條會重建 `{ item, count }` 的路徑，否則讀檔就把箱子裡受損工具洗成滿耐久 → 與序列化端不一致。）

- [ ] **Step 4: `main.ts` 接線（建立 map ＋ 存檔寫出 ＋ 還原）**

  - 模組層級新增（與 `furnaces` map 並列）：
    ```ts
    // ---- 塊實體（B8）—— 箱子內容與熔爐狀態，隨存檔走 ----
    const blockEntities = new Map<string, BlockEntity>();
    ```
  - `sessionSavePayload()`：傳 `blockEntities: [...blockEntities.values()]`。
  - `resetWorld()`（開新局 ＋ 雲端套用都會走）：加 `blockEntities.clear();`（新世界的塊實體歸零）。
  - `continueGame(payload)`：**在 `world.applyModified(...)` 之後**加：
    ```ts
    // 塊實體：清掉本頁先前的 session，再從存檔還原（箱子內容與熔爐狀態）。
    blockEntities.clear();
    for (const e of payload.blockEntities) {
      blockEntities.set(blockEntityKey(e.x, e.y, e.z), e);
    }
    ```
    （`payload.blockEntities` 已被 `loadGame` 正規化過 —— 27 格、合法 item id、座標合法。）

- [ ] **Step 5: 跑測試轉綠**

  Run: `npx vitest run src/world/save.test.ts src/world/block-entities.test.ts`
  Expected: PASS。

- [ ] **Step 6: 全量驗證**

  Run: `npm run typecheck && npm test && npm run build && npm run lint`
  Expected: 全綠。
  人工（記錄結果）：本批尚未接上箱子（Task 7 才接），因此此時存檔往返**看不到任何塊實體變化** —— 只確認存檔／繼續遊戲仍正常、沒有因為多了一個欄位而讀不到舊檔。

- [ ] **Step 7: Commit**

  ```bash
  git add src/world/save.ts src/world/save.test.ts src/main.ts
  git commit -m "feat(save): B8 本機 payload 升 v6（塊實體欄位；v1-v5 舊檔照讀、塊實體為空）"
  ```

---

### Task 5: 雲端 format 4（`readableFormats:[1,2,3,4]` ＋ `game.json` 同步 ＋ 舊格式遷移）

**Files:**
- Modify: `src/core/cloud-save.ts`
- Modify: `src/core/cloud-save.test.ts`
- Modify: `game.json`（`cloudSave`）
- Modify: `src/main.ts`（建置／套用兩處）

**Interfaces:**
- Consumes: Task 1 的 `BlockEntity`／`normalizeBlockEntities`／`serializeBlockEntities`；B5 的 `CLOUD_READABLE_FORMATS`／`isReadableCloudFormat`／`migrateInventorySlots`；B7 的 format 3 常數。
- Produces:
  - `src/core/cloud-save.ts`：
    ```ts
    /** 寫入格式（必須與 game.json 的 cloudSave.writeFormat 一致）。 */
    export const CLOUD_FORMAT_VERSION = 4 as const;
    /** 本版本能讀的格式（只累積、不縮）。format 1 = 9 格背包；
     *  format 2 = 36 格背包；format 3 = 堆疊帶 dur；format 4 = 塊實體。 */
    export const CLOUD_READABLE_FORMATS: ReadonlyArray<number> = [1, 2, 3, 4];
    export function isReadableCloudFormat(v: number): boolean;   // B5 產出，本批只改常數
    ```
    - `CloudData.blockEntities?: BlockEntity[]`（**optional** → 舊的 format 1–3 payload 沒有這個欄位，仍然合法）。
    - `CloudBuildSource.blockEntities: ReadonlyArray<BlockEntity>`（寫出時深拷貝）。
    - `acceptCloudData` 回傳的 `blockEntities` **永遠存在**且已正規化（舊 payload → `[]`）。
  - `game.json`：`"cloudSave": { "readableFormats": [1, 2, 3, 4], "writeFormat": 4 }`。

- [ ] **Step 1: 寫測試（失敗）**

  `src/core/cloud-save.test.ts`：
  - 既有 `'exposes format version 3, reads formats 1, 2 and 3, and a 64 KiB cap'` → **改寫**為 `'exposes format version 4, reads formats 1 to 4, and a 64 KiB cap'`（**改動理由**：本批把雲端格式升到 4，`readableFormats` 累積）：
    ```ts
    expect(CLOUD_FORMAT_VERSION).toBe(4);
    expect(CLOUD_READABLE_FORMATS).toEqual([1, 2, 3, 4]);
    expect(isReadableCloudFormat(1)).toBe(true);
    expect(isReadableCloudFormat(4)).toBe(true);
    expect(isReadableCloudFormat(5)).toBe(false);
    expect(isReadableCloudFormat(0)).toBe(false);
    ```
  - 既有 `'the manifest declares the same cloud format as the code'`（B5 建立）→ **保留**，斷言自動跟著新常數走（`writeFormat` 4、`readableFormats` `[1,2,3,4]`）。
  - 新 `'a format 1-3 payload without block entities loads with an empty list'`：
    ```ts
    const accepted = acceptCloudData(rawValid())!;   // rawValid() 沒有 blockEntities
    expect(accepted.blockEntities!).toEqual([]);
    ```
  - 新 `'acceptCloudData normalizes the block entities and drops the bad ones'`：
    ```ts
    const accepted = acceptCloudData({
      ...rawValid(),
      blockEntities: [
        { kind: 'chest', x: 1, y: 2, z: 3, slots: [{ item: 'stone', count: 9999 }] },
        { kind: 'bogus', x: 0, y: 0, z: 0 },
      ],
    })!;
    expect(accepted.blockEntities!).toHaveLength(1);
    expect(accepted.blockEntities![0].slots![0]).toEqual({ item: 'stone', count: 64 });
    expect(accepted.blockEntities![0].slots).toHaveLength(27);
    ```
    （`CloudData.blockEntities` 是 **optional**（舊 payload 沒有它），所以斷言要寫 `!` —— 與既有的 `stash!` 寫法一致；`acceptCloudData` 回傳時該欄位永遠存在。）
  - 新 `'validateCloudData rejects a non-array blockEntities'`：
    ```ts
    expect(validateCloudData({ ...rawValid(), blockEntities: 'nope' })).toBe(false);
    expect(validateCloudData({ ...rawValid(), blockEntities: [] })).toBe(true);
    ```
  - 新 `'buildCloudData writes the block entities deep-copied'`：
    ```ts
    const entities = [{ kind: 'chest' as const, x: 1, y: 2, z: 3, slots: [{ item: 'stone', count: 1 }] as Array<ItemStack | null>, input: null, fuel: null, output: null, progressSec: 0, fuelUnits: 0 }];
    const built = buildCloudData({ /* …既有來源… */ blockEntities: entities });
    entities[0].slots![0]!.count = 99;
    expect(built.blockEntities![0].slots![0]).toEqual({ item: 'stone', count: 1 });
    ```
  - 新 `'the cloud payload of a full chest stays inside the 64 KiB budget'`（**預算現實性檢查**）：
    ```ts
    const chest = { kind: 'chest' as const, x: 1, y: 2, z: 3, slots: new Array(27).fill({ item: 'wooden_pickaxe', count: 1 }) as Array<ItemStack | null>, input: null, fuel: null, output: null, progressSec: 0, fuelUnits: 0 };
    const built = buildCloudData({ /* …既有來源… */ blockEntities: [chest] });
    expect(byteSizeOf(built)).toBeLessThan(CLOUD_MAX_BYTES);
    ```
  - **既有 `buildCloudData({...})` 的呼叫點全部要補 `blockEntities: []`**（新的必填欄位；TypeScript 會擋下漏掉的呼叫點）。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/core/cloud-save.test.ts`
  Expected: FAIL（常數仍是 3；`blockEntities` 不在 payload 上）。

- [ ] **Step 3: 實作 `src/core/cloud-save.ts`**

  - `CLOUD_FORMAT_VERSION = 4`；`CLOUD_READABLE_FORMATS = [1, 2, 3, 4]`。
  - `CloudData` 加 `blockEntities?: BlockEntity[]`（註解寫明「format 1–3 的 payload 沒有這個欄位 → 舊資料讀進來是空清單」）。
  - `CloudBuildSource` 加 `blockEntities: ReadonlyArray<BlockEntity>`。
  - `buildCloudData` 加 `blockEntities: serializeBlockEntities(src.blockEntities)`。
  - `validateCloudData` 加一行：`if (r.blockEntities !== undefined && !Array.isArray(r.blockEntities)) return false;`（條目本身在 accept 端逐筆正規化，不在這裡深驗）。
  - `acceptCloudData` 加 `blockEntities: normalizeBlockEntities(x.blockEntities)`。
  - 檔頭 doc 註解改寫：「B8 起 format 4：payload 帶塊實體（箱子內容＋熔爐狀態）；`readableFormats` 累積 [1,2,3,4]；**回退限制：0.11.0 寫出的 format 4 資料，0.10.0（只宣告 [1,2,3]）讀不到 → 平台會擋不相容回退**」。

- [ ] **Step 4: `game.json` 同步**

  `"cloudSave": { "readableFormats": [1, 2, 3, 4], "writeFormat": 4 }`（`id`／`name`／`entry`／`version` 這一步不動；版本在 Task 8 才 bump）。

- [ ] **Step 5: `main.ts` 的建置／套用兩處**

  - `saveCloudNow()` 的 `buildCloudData({...})` 加 `blockEntities: [...blockEntities.values()]`。
  - `applyCloudData(data)`：**在 `resetWorld()` 之後**（`resetWorld` 會 `blockEntities.clear()`）加：
    ```ts
    // 塊實體：從雲端 payload 還原（resetWorld 剛清空過）。
    blockEntities.clear();
    for (const e of data.blockEntities ?? []) {
      blockEntities.set(blockEntityKey(e.x, e.y, e.z), e);
    }
    ```
    **已知限制（必須寫進 Task 8 的發布說明〈已知問題〉）**：雲端 payload **只帶塊實體、不帶 voxel 編輯**（`src/core/cloud-save.ts` 檔頭註解明載）→ 從雲端還原後，塊實體的座標可能對應不到世界裡的箱子／熔爐 → **箱子內容會變成不可達的孤兒**（要玩家自己在同座標放一個箱子才看得到；內容**不會**消失，只是暫時拿不到）。本批**不解決**（解法要改雲端格式 → 那是 B8 之外的升版工作），但必須誠實揭露。
  - 三處雲端格式檢查（開機讀取、`retryCloudRead()`、`resolveCloudConflict()`）若 B5 已改成 `isReadableCloudFormat(res.formatVersion)` → **本任務只需確認常數是 `[1,2,3,4]`**；若仍是 `res.formatVersion !== CLOUD_FORMAT_VERSION` → 必須改成 `isReadableCloudFormat(...)`，否則舊雲端進度讀不進來。

- [ ] **Step 6: 跑測試轉綠**

  Run: `npx vitest run src/core/cloud-save.test.ts src/world/save.test.ts`
  Expected: PASS。

- [ ] **Step 7: 全量驗證**

  Run: `npm run typecheck && npm test && npm run build && npm run lint`
  Expected: 全綠。
  人工（記錄結果）：登入帳號 → 開機讀雲端 → 進遊戲 → Save & Quit → 再進 → 位置與物品都在；暫停選單的雲端列顯示「就緒」而不是「格式不相容」。

- [ ] **Step 8: Commit**

  ```bash
  git add src/core/cloud-save.ts src/core/cloud-save.test.ts game.json src/main.ts
  git commit -m "feat(cloud): B8 雲端升 format 4（payload 帶塊實體；readableFormats [1,2,3,4]、writeFormat 4）"
  ```

---

### Task 6: 熔爐內容持久化修復（稽核項：重開遊戲不再消失）

**Files:**
- Modify: `src/main.ts`（熔爐狀態從 session-only 的 `furnaces` Map 搬進塊實體 map；`clearFurnaces` 改為只在開新局清空；破壞溢出改走共用函式）

**Interfaces:**
- Consumes: Task 1 的 `BlockEntity`／`emptyFurnaceEntity`／`furnaceStateToEntity`／`entityToFurnaceState`／`spillBlockEntity`／`blockEntityKey`；Task 4 的 `blockEntities` map 與 payload 欄位。
- Produces: `src/main.ts` 的行為改變（無新匯出）：
  - 熔爐的 live 狀態住在 `blockEntities` map（key ＝ `blockEntityKey(x,y,z)`），**不再**住 session-only 的 `furnaces` Map。
  - `clearFurnaces()` 移除；改由 `resetWorld()` 的 `blockEntities.clear()` 負責（**只在開新局／雲端套用時清空**）。
  - 重生（`handleRespawn`）**不清空**熔爐 → 死亡不會讓熔爐的內容消失（原版行為）。

- [ ] **Step 1: 定位現況的病灶（讀碼 → 把四處現況抄成 commit 訊息裡的定位註記）**（無單元測試——`main.ts` 是組裝根；**紅燈由 Task 4 的 v6 payload 往返測試提供**：「熔爐的 input/fuel/output/progressSec/fuelUnits 全部回來」那條在熔爐狀態仍只活在 session-only 的 `furnaces` Map 時必紅；本任務以人工步驟（Step 3 的五條）佐證）

  在 `src/main.ts` 讀出並記錄這四處（行號以當下檔案為準），**並把四條現況逐條寫進 Step 5 的 commit 訊息**（2026-10-20 稽核修正：原 Step 1 是純讀碼、不改碼也不產出可檢查的結果 → 公約 §5 的「步驟可執行、可檢查」不成立；現在它的產物是 commit 訊息裡的四條定位註記）：
  1. `const furnaces = new Map<string, FurnaceState>();`（session-only 的 Map）。
  2. `clearFurnaces()` 的三個呼叫點：`resetWorld()`、**`continueGame()`**、**重生流程**；函式本體還會 toast「熔爐進度已重置」。
  3. `sessionSavePayload()` 沒有任何熔爐欄位 → 熔爐從來沒被寫進 payload。
  4. 破壞熔爐時的灑落程式碼（`if (id === BLOCK.FURNACE) { … spawnDrop(…) … }`）—— **它不判斷模式**，創造模式也會灑。

  **病灶一句話**：熔爐狀態只活在記憶體、從不進存檔，且 `continueGame` 與重生流程會主動清空它 → 重開遊戲熔爐一定是空的。

  **另外抄下 B7 的既有修正（Step 2 不得覆蓋它）**：B7 Task 4 把熔爐溢出的 `spawnDrop(drops, held.item, held.count, pos)` 改成 `spawnDrop(drops, held.item, held.count, pos, { dur: held.dur })` → **受損工具溢出後仍是受損的**。本批改走共用的 `spillBlockEntity`，**那條 `dur` 修正必須被保留下來**（見 Step 2）。

- [ ] **Step 2: 改寫熔爐的狀態存取（`src/main.ts`）**

  - 刪除 `const furnaces = new Map<string, FurnaceState>();` 與 `furnaceKey`（改用 `blockEntityKey`，格式相同）。
  - `openFurnaceAt(x, y, z)`：
    ```ts
    const key = blockEntityKey(x, y, z);
    const existing = blockEntities.get(key);
    // kind 一致性（2026-10-20 稽核修正）：同座標若是另一 kind 的實體（雲端還原造成），
    // 直接覆蓋成空熔爐 —— 否則「內容物卡住」，玩家打開看到的是別 kind 的欄位。
    if (!existing || existing.kind !== 'furnace') blockEntities.set(key, emptyFurnaceEntity(x, y, z));
    openFurnaceKey = key;
    ```
  - `takeFurnaceOutput()`：從 `blockEntities.get(openFurnaceKey)` 取出 → `entityToFurnaceState(entity)` → 取走 output → 寫回 `blockEntities.set(key, furnaceStateToEntity(next, x, y, z))`。
  - `clickFurnaceSlot(which)`：同上（讀 → 改 input/fuel → 寫回）。
  - 熔爐的每幀推進迴圈（`for (const [key, fst] of furnaces)`）：改成走 `blockEntities`，**只處理 `kind === 'furnace'` 的項**，**並且只在真的變化時寫回**：
    ```ts
    for (const [key, e] of blockEntities) {
      if (e.kind !== 'furnace') continue;
      const before = entityToFurnaceState(e);
      const stepped = stepFurnace(before, dt);
      const after = stepped.state;
      // 簽名比較（2026-10-20 稽核修正）：`entityToFurnaceState` 每次回傳新物件 →
      // 直接比 `!==` 恆真 → 每幀為最多 512 個塊實體配置並寫回 map。
      if (!sameFurnaceState(before, after)) {
        blockEntities.set(key, furnaceStateToEntity(after, e.x, e.y, e.z));
      }
    }
    ```
    （`sameFurnaceState(a, b)`：比 `progressSec`、`fuelUnits` 與三個堆疊的 `item`／`count`／`dur`；**放在 `src/world/block-entities.ts` 並有單元測試**。**兩種做法都要保持「進度會被存進存檔」的語意** —— 只要真的變了就必須寫回。）
  - `setState('furnace')` 分支：改成從 `blockEntities` 讀該座標的熔爐（沒有就建立空的），再 `furnaceUi.open(entityToFurnaceState(entity))`。
  - 破壞熔爐的分支：改成
    ```ts
    if (id === BLOCK.FURNACE) {
      const key = blockEntityKey(hit.x, hit.y, hit.z);
      const entity = blockEntities.get(key) ?? null;
      drops = spillBlockEntity(drops, entity, { x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5 }, currentMode);
      blockEntities.delete(key);
    }
    ```
    → **行為變更（要在 commit 訊息說明）**：創造模式不再灑出熔爐內容（原本會灑，且創造模式不會撿拾 → 地上會留一堆撿不起來的掉落物）。本批把「內容物只在生存模式掉落」統一成箱子與熔爐共用同一條規則。
    （2026-10-20 稽核修正：**不得覆蓋 B7 的熔爐溢出修正** —— B7 Task 4 已把這段改成 `spawnDrop(drops, held.item, held.count, pos, { dur: held.dur })`（受損工具溢出後仍是受損的）。改走 `spillBlockEntity` 時，**`dur` 由 `spillBlockEntity` 內部帶上**（見 Task 1 Step 5）→ B7 的修正被**保留下來**而不是刪掉。commit 訊息要寫明「熔爐溢出改走共用的 `spillBlockEntity`，B7 的 `dur` 傳遞由該函式統一處理，行為不變」。）
  - 刪除 `clearFurnaces()` 與它的三個呼叫點；`resetWorld()` 已有 `blockEntities.clear()`（Task 4 加的）→ 開新局時熔爐歸零。**`continueGame()` 與重生流程不再清空**（`continueGame` 由 Task 4 的還原邏輯填回；重生不清空 → 死亡不影響熔爐）。

- [ ] **Step 3: 人工驗證（記錄結果）**

  1. 生存 → 放一個熔爐 → 右鍵開啟 → 放 5 個生鐵 ＋ 1 個煤 → 關閉 → **Save & Quit** → 繼續遊戲 → 右鍵同一個熔爐 → **生鐵與煤都在、進度條也在**（修好了）。
  2. 熔爐燒到一半（進度約 5 秒）→ Save & Quit → 繼續遊戲 → 進度條**從原本的進度繼續**（不是從 0）。
  3. 死亡 → 重生 → 熔爐內容仍在（重生不清空）。
  4. 開新遊戲 → 舊世界的熔爐內容清零（`resetWorld` → `blockEntities.clear()`），且**不再出現「熔爐進度已重置」的 toast**（該 toast 已刪除）。
  5. （2026-10-20 稽核修正）熔爐裡放一把**受損**工具（例如挖到 `dur` 只剩 12 的木鎬）→ 破壞熔爐 → **掉在地上的鎬仍然是受損的**（撿起來 `dur` 沒變）→ 證明 B7 的溢出修正沒被本批蓋掉。

- [ ] **Step 4: 全量驗證**

  Run: `npm run typecheck && npm test && npm run build && npm run lint`
  Expected: 全綠（`src/world/furnace.test.ts` 的既有案例一個不多、一個不少 —— 本任務只改 `main.ts` 的接線，不動 `furnace.ts` 的實作）。

- [ ] **Step 5: Commit**

  ```bash
  git add src/main.ts
  git commit -m "fix(furnace): B8 熔爐狀態搬進塊實體並隨存檔保存（重開遊戲不再消失；死亡不清空；創造模式不再灑出內容）

  現況定位（Step 1）：
  - furnaces 是 session-only 的 Map（src/main.ts 的模組層級 const）。
  - clearFurnaces() 的三個呼叫點：resetWorld()／continueGame()／重生流程（函式本體還會 toast「熔爐進度已重置」）。
  - sessionSavePayload() 沒有任何熔爐欄位 → 熔爐從來沒被寫進 payload。
  - 破壞熔爐的灑落不判斷模式 → 創造模式也會灑。

  行為變更：創造模式破壞熔爐不再灑出內容物。
  保留 B7：熔爐溢出改走共用的 spillBlockEntity，dur 的傳遞由該函式統一處理（B7 的 opts.dur 修正未被覆蓋）。"
  ```

---

### Task 7: 箱子開啟、放置與破壞溢出（`main.ts` 接線）

**Files:**
- Modify: `src/main.ts`（新狀態 `'container'`、`openChestAt`、右鍵分支、破壞溢出）

**Interfaces:**
- Consumes: Task 2 的 `BLOCK.CHEST`；Task 3 的 `createContainer`／`ContainerParams`；Task 1 的 `emptyChestEntity`／`spillBlockEntity`／`blockEntityKey`；Task 4 的 `blockEntities` map。
- Produces: `src/main.ts` 的行為改變（無新匯出）：
  - `GameState` union 加 `'container'`。
  - `openChestAt(x, y, z)`：確保該座標有箱子塊實體（沒有就 `emptyChestEntity`）→ `setState('container')` → `document.exitPointerLock?.()`。
  - 右鍵箱子 → **開啟容器**（即使手上拿著方塊也先開容器 —— 與熔爐／工作台同一條路徑，也是原版行為）。
  - 破壞箱子 → 箱子本體照既有 `spawnBlockDrop` 掉落（生存）＋ **內容物逐格灑出**（生存）。

- [ ] **Step 1: 寫測試（失敗）**

  **本任務的邏輯都已在 Task 1／Task 3 用純函式釘死**（`spillBlockEntity`、容器面板的搬運規則）；`src/main.ts` 是未測的組裝根，因此這裡**不新增測試檔**，只做接線與人工驗收（與 B1–B7 的既有做法一致）。若實作者想把「開箱子的流程」抽成純函式，必須另外補測試並在 commit 訊息說明 —— **不得只靠人工**。

- [ ] **Step 2: 接線（`src/main.ts`）**

  - `GameState` union 加 `'container'`。
  - `import { createContainer } from './ui/container';` ＋ 建立實例：
    ```ts
    const containerUi = createContainer(uiRoot);
    ```
  - `setState(next)`：在「每次轉移都關閉所有疊層」的前言區加 `containerUi.close();`（冪等），並新增分支：
    ```ts
    } else if (next === 'container') {
      // B8: 右鍵箱子 → 容器面板（27 格箱子 ＋ 玩家 36 格背包）。
      if (openChestKey) {
        const entity = blockEntities.get(openChestKey);
        if (entity && entity.kind === 'chest' && entity.slots) {
          containerUi.open({
            title: '箱子',
            container: entity.slots,
            inventory: slots,
            onContainerChange: (index, stack) => {
              const e = blockEntities.get(openChestKey!);
              if (!e || e.kind !== 'chest' || !e.slots) return;
              e.slots[index] = stack;
            },
            onInventoryChange: (index, stack) => {
              inventory.setSlot(index, stack);
              hud.setHotbar(slots, selected);
            },
            onReturnCursor: (stack) => {
              // 回 `null` ＝ 已全數放回（游標清空）；回堆疊 ＝ 只放不下這麼多（游標保留）。
              // 2026-10-20 稽核修正：**必須帶 `dur`** —— `giveItem` 擴成三參數版，
              // 否則箱子裡拿出的受損工具一歸還背包就變成滿耐久。
              const overflow = giveItem(stack.item, stack.count, stack.dur);
              hud.setHotbar(slots, selected);
              return overflow > 0 ? { ...stack, count: overflow } : null;
            },
            onClose: () => {
              openChestKey = null;
              setState('playing');
              relockCanvas();
            },
          });
        }
      }
    }
    ```
    （`openChestKey` 是模組層級的 `let openChestKey: string | null = null;`，與既有的 `openFurnaceKey` 同一種寫法。）
  - `openChestAt(x, y, z)`：
    ```ts
    function openChestAt(x: number, y: number, z: number): void {
      const key = blockEntityKey(x, y, z);
      if (!blockEntities.has(key)) blockEntities.set(key, emptyChestEntity(x, y, z));
      openChestKey = key;
      setState('container');
      document.exitPointerLock?.();
    }
    ```
  - 右鍵分支（放置路徑）：在既有的 `else if (hit && hitBlock === BLOCK.FURNACE) { openFurnaceAt(...) }` **之後**、進入通用放置路徑**之前**加：
    ```ts
    } else if (hit && hitBlock === BLOCK.CHEST) {
      // B8: 右鍵箱子 → 開啟容器（手上拿著方塊也先開容器，與熔爐／工作台一致）。
      openChestAt(hit.x, hit.y, hit.z);
    }
    ```
  - 破壞分支：在既有的 `if (id === BLOCK.FURNACE) { … }` **之後**加：
    ```ts
    if (id === BLOCK.CHEST) {
      const key = blockEntityKey(hit.x, hit.y, hit.z);
      const entity = blockEntities.get(key) ?? null;
      drops = spillBlockEntity(drops, entity, { x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5 }, currentMode);
      blockEntities.delete(key);
      if (entity) bus.emit('drops-changed', {});
    }
    ```
  - **箱子本體的掉落**不需要新程式碼：`dropItemFor(BLOCK.CHEST)` → `'chest'`（Task 2 已接好），既有的 `spawnBlockDrop` 會在生存模式掉一個箱子。
  - **放置箱子不需要新程式碼**：`blockFromItem('chest')` → `BLOCK.CHEST`（Task 2），既有的放置路徑會放下方塊。
  - **`giveItem` 擴成三參數（2026-10-20 稽核修正）**：`src/main.ts` 現況是 `function giveItem(item: ItemId, count: number): number` → 內部 `inventory.addItem(item, count)`。B7 已把 `InventoryModel.addItem` 改成 `addItem(item, count, dur?)`，但**沒有**同步改這個包裝 → 本批要改成：
    ```ts
    function giveItem(item: ItemId, count: number, dur?: number): number {
      if (inventory.mode !== 'creative') return inventory.addItem(item, count, dur);
      // 創造模式：無限供應 → 直接寫槽（沿用現況的兩段寫法）。
      // dur 一併交給 inventory.setSlot（它會 materialize durable 物品的 dur、
      // 丟掉非耐久物品的 dur）→ 形狀與生存模式一致。
      const cap = maxStack(item);
      let rest = count;
      for (let i = 0; i < hotbar.length && rest > 0; i++) {
        const s = hotbar[i];
        if (!s || s.item !== item || s.count >= cap) continue;
        const put = Math.min(cap - s.count, rest);
        inventory.setSlot(i, { ...s, count: s.count + put });
        rest -= put;
      }
      for (let i = 0; i < hotbar.length && rest > 0; i++) {
        if (hotbar[i]) continue;
        const put = Math.min(cap, rest);
        inventory.setSlot(i, { item, count: put, dur });
        rest -= put;
      }
      return rest;
    }
    ```
    **既有呼叫端（`giveItem(item, count)`）全部照原樣呼叫即可**（第三參數可選 → 既有行為不變）；只有 `onReturnCursor` 這一個新呼叫端傳 `stack.dur`。
    （替代方案：改用 `inventory.setSlot(index, stack)` 直接寫回 —— 但那要自己找空槽並處理合併，比擴參數麻煩；**選擴參數**。）
    **B7 的 `dur` 不變量因此端到端成立**：箱子裡的受損工具 → 游標 → 背包，全程帶著 `dur`。

- [ ] **Step 3: 人工驗收（記錄結果）**

  1. 生存 → 做一個箱子（8 塊橡木板材）→ 放在地上 → 右鍵 → **容器面板開啟**，顯示 27 格箱子 ＋ 36 格背包。
  2. 從背包左鍵拿一疊石頭 → 點箱子第 1 格 → 石頭進箱子；關閉面板 → 背包裡的石頭**不見了**（它在箱子裡）→ 再開箱子 → **石頭還在**（寫回正確，沒有重現 B1 的 stash 外洩）。
  3. 箱子裡放 27 格滿的石頭（用創造模式塞滿）→ 生存破壞箱子 → **地上散出 27 個掉落物**（總數守恆），箱子本體也掉一個。
  4. 破壞箱子 → **打開新箱子（同一位置）→ 是空的**（塊實體已刪除，不會殘留舊內容）。
  5. 箱子裡放東西 → Save & Quit → 繼續遊戲 → 右鍵箱子 → **東西還在**（往返測試）。
  6. 創造模式破壞箱子 → **地上不掉任何東西**（箱子本體與內容都不掉，與熔爐一致）。
  7. （2026-10-20 稽核修正）箱子裡放一把**受損**工具 → 左鍵拿出來 → 熱鍵欄的**耐久條仍是受損的**（沒被洗成滿耐久）→ 關閉面板（游標歸還）→ 背包裡的它**仍然是受損的**（`giveItem` 有傳 `dur`）。

- [ ] **Step 4: 全量驗證**

  Run: `npm run typecheck && npm test && npm run build && npm run lint`
  Expected: 全綠。

- [ ] **Step 5: Commit**

  ```bash
  git add src/main.ts
  git commit -m "feat(container): B8 箱子可開啟（27 格容器面板）＋破壞時內容物逐格溢出掉落"
  ```

---

### Task 8: 0.11.0 發布

**Files:**
- Modify: `package.json`、`game.json`、`README.md`、`.github/workflows/release.yml`（若上游模板有變動才動）
- Create: `docs/releases/v0.11.0.md`

**Interfaces:**
- Consumes: Task 1–7 全部。
- Produces: tag `v0.11.0` 與 GitHub Release（CI 產生）。

- [ ] **Step 1: 版本 bump**

  `package.json` `"version": "0.11.0"`；`game.json` `"version": "0.11.0"`（`cloudSave` 維持 Task 5 的 `{ "readableFormats": [1,2,3,4], "writeFormat": 4 }`；`id` 不動）。

- [ ] **Step 2: README 更新（照 spec §跨批次與 §6）**

  - `## 遊戲特色`：
    - **生存模式**段補容器說明：「**箱子**：8 塊同種板材 3×3 合成；放下去右鍵開啟 **27 格**容器面板（與背包同一套左鍵整疊／右鍵取一半的操作）；**箱子裡的東西會跟著存檔**，破壞箱子時內容物會全部掉出來」。
    - **熔爐**段補一句：「熔爐的**內容物與燃燒進度會存檔**（以前重開遊戲就沒了）」。
    - **存檔**段改寫：「本機 payload 升 **v6**（塊實體：箱子內容＋熔爐狀態；v1／v2／v3／v4／v5 照讀並遷移，舊檔沒有塊實體 → 空的）」。
    - **雲端進度**段改寫：「雲端格式版本 **4**（可讀 1、2、3、4）；塊實體進了 payload，因此格式升版 —— **舊版（0.10.0）讀不到 format 4，平台會擋下不相容的回退**」。
  - `## 與原版的差異` 新增／修正：
    - 「**容器只有單箱 27 格**：沒有 54 格的連體大箱子（兩個箱子不會自動合併）、沒有桶／潛影盒／漏斗、不能改名也不能上鎖。」
    - 「**容器沒有 shift 快速搬運**：只能左鍵整疊拿起再點另一格放下、右鍵取一半／放 1 個。」
    - 「**箱子的破壞秒數沿用本作的通用公式**（硬度 × 1.5 ÷ 工具速度 → 徒手 3.75 秒），比原版（徒手 13.75 秒）快得多；斧頭最快、徒手也能挖掉並掉落。」
    - 「箱子六面共用同一張貼圖（原版正面有蓋子與鎖扣的細節）。」
    - 「**熔爐的燃料值是簡化表**（煤 8 個、原木／板材、木棍），與原版的秒數制不同。」（若 B4 已改過數值，照實際值寫。）
    - 「**雲端同步受 64 KiB 限制**：箱子放太多時雲端檢查點會跳過上傳（toast「雲端空間不足，僅本機存檔」），**本機存檔不受影響**。」
  - `## 操作` 表格：右鍵的說明補「**箱子 → 開啟容器面板**」。
  - `# Test` 段的測試數字更新為實測值（本批新增測試後的總數／檔案數）。
  - `# 專案狀態` 補一行 B8 的摘要（0.11.0：箱子／27 格容器／塊實體持久化／熔爐內容存檔／雲端 format 4）。

- [ ] **Step 3: 發布說明 `docs/releases/v0.11.0.md`**

  固定四段（中文）：`## 新增`／`## 修正`／`## 存檔格式與相容性提示`／`## 已知問題`。
  - **新增**：箱子方塊（8 塊同種板材合成、徒手可掉落、斧頭最快）；27 格單箱容器面板（沿用背包的左鍵／右鍵操作模型）；塊實體持久化（箱子內容 ＋ 熔爐的內容／燃料／進度）；箱子與熔爐的內容物在箱子被破壞時全部掉出來。
  - **修正**：**熔爐內容重開遊戲不再消失**（以前熔爐只存在於記憶體，存檔／重開／死亡都會清空）；創造模式破壞熔爐不再把內容物灑在地上。
  - **存檔格式與相容性提示**（**本批最重要的一段，寫在最前面**）：
    1. 本機 payload 升 **v6**（塊實體欄位）；**v1／v2／v3／v4／v5 舊存檔照讀**，舊檔沒有塊實體（那時還沒有箱子與可存檔的熔爐）→ 箱子與熔爐的內容是空的。
    2. 雲端格式升 **4**（`readableFormats:[1,2,3,4]`、`writeFormat:4`）；舊的 format 1／2／3 雲端進度會在讀入時自動遷移（塊實體為空），下一次檢查點即以 format 4 寫回。
    3. **回退限制（雲端）**：0.11.0 寫出的雲端資料是 format 4，**0.10.0（只宣告可讀 format 1–3）讀不到** → 平台會以 `SAVE_FORMAT_INCOMPATIBLE` 擋下不相容的回退。要回到 0.10.0 必須先在 0.11.0 重新開局（雲端槽會被改寫）。
    4. **回退限制（本機）**：0.11.0 寫出的本機存檔是 payload v6，**0.10.0 只接受 v1–v5 → 會把這份存檔視為「沒有存檔」**；在 0.10.0 再度儲存會以舊格式覆寫。
    5. **容量上限**：一個世界最多保留 **512 個塊實體**（箱子 ＋ 熔爐）；單箱 27 格、每格最多 64 個（工具 1 個）；超出上限的塊實體不會被存進去。
  - **已知問題**：只有單箱 27 格，沒有 54 格連體大箱子；容器沒有 shift 快速搬運、不能改名／上鎖；箱子的破壞秒數沿用本作公式（比原版快）；箱子六面共用一張貼圖；熔爐燃料值是簡化表；雲端同步仍受 64 KiB 上限限制（箱子太多時雲端會跳過上傳，本機存檔正常）；**雲端 payload 不帶方塊編輯 → 從雲端還原後，箱子／熔爐的內容可能在世界裡沒有對應的方塊（暫時取不到，但不會遺失；在同一座標放一個箱子／熔爐即可看到）**；雲端與本機的回退限制（見上）。

- [ ] **Step 4: release workflow 支援 notes 檔（先讀現況，多半不必改）**

  **先讀 repo 現況**：`.github/workflows/release.yml` **現況已經是** `NOTES_ARGS`／`--notes-file` 的寫法（`NOTES_ARGS=(--generate-notes)` → 有 `docs/releases/$RELEASE_TAG.md` 就換成 `NOTES_ARGS=(--notes-file "docs/releases/$RELEASE_TAG.md")` → `gh release create … "${NOTES_ARGS[@]}"`）→ **本批不需要改 workflow**（照寫會產生無謂的 diff）。
  **只有在上游模板（AGENTS.md §1 清單的 `game-release.yml`）的寫法不同時**才改成：
  ```yaml
        NOTES_ARGS=(--generate-notes)
        if [ -f "docs/releases/$RELEASE_TAG.md" ]; then
          NOTES_ARGS=(--notes-file "docs/releases/$RELEASE_TAG.md")
        fi
        gh release create "$RELEASE_TAG" "$GAME_ZIP" --repo "$RELEASE_REPO" --verify-tag "${NOTES_ARGS[@]}" --prerelease="$GAME_PRERELEASE"
  ```
  （workflow 的其餘檢查——tag 對版本、工具 sha256、pack＋validate——全部保留；**不得出現 job 層 `runner`**。）

- [ ] **Step 5: 全量 gates**

  Run: `npm run typecheck && npm test && npm run build && npm run lint`
  Expected: 全綠（既有測試一個不多、一個不少；本批新增的測試全數通過）。

- [ ] **Step 6: 固定工具 pack＋validate（ZIP 驗證）**

  ```bash
  sha256sum .playroom/tools/playroom-game-tools-1.1.0.zip   # 必須等於 game-tools.lock.json 的 sha256
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
  git commit -m "chore(release): 0.11.0"
  ```
  本計畫在 `b8-containers` 分支執行：tag 與 push 屬整支完成後的整合步驟——merge 回 master 後才 `git tag -a v0.11.0 -m "0.11.0: B8 箱子、容器與塊實體持久化"`＋`git push origin master`＋`git push origin v0.11.0`，由 controller 依 finishing-a-development-branch 流程執行。

- [ ] **Step 8: 驗證 CI Release**

  以 `webfetch https://github.com/TommyLamm/WeCraft/releases/tag/v0.11.0` 確認 release 存在、asset 已附、說明為 `docs/releases/v0.11.0.md` 內容。回報照 AGENTS.md 四段式：程式完成／ZIP 驗證／Release（CI 結果）／平台上架（若屬平台操作，向使用者確認後再按）。**並在回報中明寫「雲端 format 4 與本機 payload v6 的回退限制」**。

- [ ] **Step 9: Commit（收尾）**

  若 Step 8 有任何補正（文件錯字、notes 檔更新），再一顆 commit；無則略過。

---

## 批末驗收

（spec §B8「批末驗收」＋本批專屬項目。）

- **gates**：`npm run typecheck` ／ `npm test` ／ `npm run build` ／ `npm run lint` 全綠；既有測試一個不多、一個不少（以實作當下的基線為準）。
- **往返測試（放置→存物→重開→還在）**：
  - 本機：箱子放 3 種物品 → Save & Quit → 繼續遊戲 → 物品與位置原樣（Task 4 的 `'a v6 record round-trips the chest contents through IndexedDB'` ＋ Task 7 的人工第 5 點）。
  - 熔爐：input／fuel／output／progressSec／fuelUnits 全部回來（Task 4 的往返測試 ＋ Task 6 的人工第 1、2 點）。
- **雲端遷移**：format 1／2／3 的舊 payload 讀進來 → `blockEntities` 為空、其餘欄位照舊（Task 5 的遷移測試）；`game.json` 的 `writeFormat` 與 `CLOUD_FORMAT_VERSION` 一致（既有測試守住）。
- **破壞溢出**：27 格全滿的箱子 → 破壞 → 27 個掉落物、總數守恆（Task 1 的 `'spillBlockEntity drops one stack per slot from a full chest'` ＋ Task 7 的人工第 3 點）；熔爐的 input／fuel／output 各掉一個；創造模式不掉任何東西。
- **耐久端到端**（2026-10-20 稽核修正）：箱子裡的受損工具**全程帶著 `dur`** → ① 存檔往返後仍是受損的（Task 4 的 `'a v6 record round-trips the durability of a tool inside a chest'`）② 破壞溢出後仍是受損的（Task 1 的 `'spillBlockEntity keeps the durability of a damaged tool'`）③ 拿回背包後仍是受損的（Task 7 的人工第 7 點）。**任何一環洗掉 `dur` 都算本批未通過**。
- **游標歸還不複製**（2026-10-20 稽核修正）：箱子拿 5 個石頭 → 關閉面板 → **游標清空**（`.ui-cursor-stack`  長度 0）→ 再開面板 → **不會又歸還一次**（Task 3 的 `'a fully returned cursor stack is cleared instead of being duplicated'`）。
- **壞資料的處置**：一份手改過的存檔（壞座標、壞 item id、9999 的數量、300 筆塊實體）→ **整份存檔照讀**，只丟掉壞的那幾筆（Task 1／Task 4 的測試）。
- **效能**：
  - 512 個塊實體（每個 27 格滿）的 `normalizeBlockEntities` ＋ `serializeBlockEntities` 單次 < 200 ms（用 `console.time` 量一次即可；本批不設自動化的時間門檻測試，避免 flaky）。
  - 容器面板的開關與每次點擊只重畫受影響的面板（63 格），不重建整個 DOM。
  - 生成 16 個區塊 < 1500 ms（B3 的既有門檻，本批沒動生成）。
- **Playwright（新增疊層 → pointer lock 往返必須實測）**：靜態伺服 `dist/` ＋ `xvfb-run` 有頭 Chromium（平台 checkout 自帶 `playwright-core`）→ 進遊戲 → 右鍵箱子 → **容器面板出現、pointer lock 釋放** → 點一格把物品放進箱子 → 按 `Esc` 關閉 → **pointer lock 重新取得**（回到遊戲可移動）。斷言只做可觀察的行為（面板元素存在／消失、物品計數變化、pointer lock 狀態）；**CDP 合成鍵不走瀏覽器保留鍵路由 → `Ctrl+W` 等保留鍵情境列為未驗證**；probe 腳本放 repo 外（`/tmp/opencode/`），不得污染工作區。
- **`pack-game` ＋ `validate-game`**：固定工具（SHA-256 與 lock 一致）兩個都過。
- **README 與發布說明**：〈與原版的差異〉涵蓋本批的所有刻意簡化（單箱 27 格、無 shift 搬運、破壞秒數、貼圖、燃料表、雲端 64 KiB）；發布說明四段齊全、**雲端格式升版與本機 payload 升版的回退限制寫在最前面**。
- **不動輸入路由的既有部分**：`Esc`／iframe／全螢幕／保留鍵沒有被改動（只新增一個疊層狀態，沿用既有 overlay 的 `exitPointerLock` → `relockCanvas` 循環）→ 以 Playwright 驗收該循環；無法複刻的保留鍵情境列為未驗證。

---

## 與公約／spec 的差異

1. **箱子方塊 id ＝ 33、貼圖索引 `T.CHEST` ＝ 40**：**公約 §3.5 的跨批編號表已明文指定**（既有 0–16 不動；B3 17–25、B4 `WOOL`=26、B5 27–31、B6 火把=32、**B8 箱子=33**；tile：B3 21–32、B4 33、B5 34–38、B6 `T.TORCH`=39、**B8 `T.CHEST`=40**、`TILE_COUNT`=41，上限 64 層）→ 本批**直接沿用公約的數字**，並在 Task 2 Step 1 要求實作者先讀 `src/world/blocks.ts` 的現況確認 33／40 仍空閒；被占用則取「當時最大值 + 1」並在 commit 訊息註明、**回報 controller**（**不得默默改號**）。
   （2026-10-20 稽核修正：本條原文寫「公約 §4 只寫『B8 產出箱子方塊』，沒有指定數字」，並抄了一份 B6 計畫的舊數字表（B3 17–27／B4 28／B5 29–31）—— 兩處都不符：**公約 §3.5 有指定數字**（33／40），舊表也要一併改正。**結論（箱子 33、tile 40）不變**。）
2. **配方需要新的 `PatternCell` 形狀（`SameItemCell`）**：原版的箱子配方是「8 塊**同一種**板材」，而 B5 的 `PatternCell`（`ItemId | ReadonlyArray<ItemId> | null`）只能表達「任一種」或「這些之一」，無法表達「必須同種」→ 本批把 `PatternCell` 擴成多一種形狀並在 `matchShaped` 加「同組必須同種」的規則。這是對 B5 已定型型別的**擴充**（不是破壞性變更；B5 的既有案例原樣通過）。已在本計畫〈已查證與設計決策 §1〉寫明理由。
3. **容器 UI 與 B5 的背包 UI 共用規則但不合併程式碼**：游標規則抽到 `src/ui/cursor.ts`（純函式 ＋ 自己的測試），但 `src/ui/inventory.ts`（B5）**不動** —— 改它有弱化 B5 既有測試的風險，而 B5 的案例正是本批要保護的東西。代價是同一套規則有兩份實作（背包內嵌版 ＋ `cursor.ts` 版）。已在 Task 3 Step 8 的註解寫明：若實作者要合併，既有 `src/ui/ui.test.ts` 的游標案例必須**原樣通過**。
4. **箱子的破壞秒數沿用本作公式（比原版快很多）**：原版 Java 徒手 13.75 秒；本作的通用公式給 3.75 秒。為了不為箱子開特例（會讓 `getBreakTime` 多一條分支、也要動 B1 釘死的公式測試），本批選擇沿用公式並在 README〈與原版的差異〉明寫。
5. **內容物的掉落統一為「生存模式才掉」**：現況的熔爐破壞**不判斷模式**，創造模式也會把內容灑在地上（而創造模式不會撿拾 → 地上留一堆撿不起來的掉落物）。本批把箱子與熔爐統一成生存模式才掉（Task 6 註明這是**行為變更**，寫進 commit 訊息與發布說明〈修正〉）。原版在創造模式破壞箱子同樣不會掉落內容物，方向一致。
6. **塊實體的容量上限是「寫出時也截斷」**：`MAX_BLOCK_ENTITIES = 512` 在**載入與寫出**都套用，超過的塊實體從尾端被丟棄（deterministic）。因此「世界裡有 513 個箱子」時，第 513 個箱子的內容不會被存進去。這是防爆量的必要代價，已寫進發布說明〈存檔格式與相容性提示〉第 5 點。
7. **雲端的 64 KiB 預算仍是最後一道閘**：塊實體進了雲端 payload，箱子很多時 payload 會超過 64 KiB → 既有的「雲端空間不足，僅本機存檔」toast 會出現、該次雲端檢查點被跳過（**本機存檔不受影響**）。本批沒有為了塞更多箱子去改預算（改預算是平台層的決定），已寫進 README 與發布說明〈已知問題〉。
8. **本批不做 54 格連體大箱子**：spec §B8 明列為延伸項，本批只做單箱 27 格（已查證 wiki 的 27／54 格）。
9. **不新增成就**：原版沒有「取得箱子」的成就（只有「熱 topic」是熔爐），本批不為箱子加進度。
10. **`main.ts` 的接線沒有自動化測試**：`openChestAt`／`setState('container')`／破壞溢出都在組裝根，與 B1–B7 的既有做法一致 → 以人工步驟 ＋ Playwright 驗收佐證，並在回報中列「未自動化」。
11. **與 B9 的相容性（2026-10-20 稽核修正：原文完全沒提 B9）**：B9 計畫明寫「本機 payload v6 不變、雲端 format 4 不變、`game.json` 的 `cloudSave` 不動」→ **本批的 v6／format 4 正是 B9 的前提**；兩批沒有存檔形狀衝突。B9 唯一的存檔相關假設是「敵對生物不跨存檔」→ 本批的塊實體欄位不影響它。**合併順序要求：B8 必須先於 B9 合併**（B9 讀的是 v6／format 4）。

---

## Self-Review 記錄

- **Spec coverage**：spec §B8 第 1 條（箱子方塊：8 板材合成、放置／開啟／破壞）→ Task 2（方塊 id／貼圖／物品配對／配方／掉落／音效）＋ Task 7（放置／開啟／破壞）；「容器 UI 27 格（單箱），沿用 B5 的操作模型」→ Task 3（`cursor.ts` ＋ `container.ts` ＋ jsdom 測試）；「破壞時內容物掉落」→ Task 1（`spillBlockEntity`）＋ Task 7（接線）＋ Task 6（熔爐共用同一規則）。spec 第 2 條（塊實體持久化：箱子內容＋熔爐的內容與燃料／進度，進本機 payload 與雲端，附加欄位、格式升版）→ Task 1（資料模型）＋ Task 4（本機 v6 ＋ v1–v6 遷移鏈）＋ Task 5（雲端 format 4 ＋ `game.json`）；「載入驗證＋數量上限（防爆量）」→ Task 1（逐筆丟棄 ＋ 四道上限：筆數 512／每筆格數／每格數量夾 `maxStack`／雲端 64 KiB ＋ 測試）＋ Task 4／Task 5（壞記錄不連坐的斷言）。spec 第 3 條（54 格連體列為延伸，本批必達單箱）→ 本批只做單箱 27 格（〈與公約／spec 的差異〉第 8 條）。spec 第 4 條（附帶修復：熔爐內容重開不再消失）→ Task 6（熔爐狀態搬進塊實體 ＋ 人工四點）＋ Task 4（熔爐欄位的往返測試）。spec 第 5 條（驗收：往返測試、雲端遷移、破壞溢出、效能）→ 〈批末驗收〉逐項對應。spec §5.11（雲端格式政策 ＋ 回退限制寫進發布說明）→ Task 5 ＋ Task 8 Step 3。§跨批次（版本 0.11.0、README、發布說明四段、pack＋validate）→ Task 8。
- **步驟掃描**：每個 Task 都是「寫失敗測試 → 跑（紅）→ 實作 → 跑（綠）→ 全量 gates → commit」；沒有 TBD 與未定義型別；唯一的演算法段落（游標規則、塊實體正規化、溢出）都已給出逐條規則與期望值。
- **型別一致**：`BlockEntity`／`CHEST_SLOTS`／`MAX_BLOCK_ENTITIES`／`normalizeBlockEntity`／`normalizeBlockEntities`／`serializeBlockEntities`／`spillBlockEntity`／`blockEntityKey`／`emptyChestEntity`／`emptyFurnaceEntity`／`furnaceStateToEntity`／`entityToFurnaceState`／`sameFurnaceState`（Task 1 產出，Task 4／5／6／7 消費）；`sanitizeStackClamped`／`sanitizeSlotsClamped`（Task 1 產出，Task 1／`furnace.ts`／`block-entities.ts` 消費）；`normalizeFurnaceState`／`MAX_FUEL_UNITS`（Task 1 產出，Task 1 內部消費）；`cursorLeftClick`／`cursorRightClick`／`ContainerParams`（`onReturnCursor` 的回傳型別是 `ItemStack | null | undefined`）／`ContainerUi`／`createContainer`（Task 3 產出，Task 7 消費）；`SavePayloadV6`／`SaveSources.blockEntities`（Task 4 產出，Task 4／5 消費）；`CLOUD_FORMAT_VERSION = 4`／`CLOUD_READABLE_FORMATS = [1,2,3,4]`／`CloudData.blockEntities`／`CloudBuildSource.blockEntities`（Task 5 產出，與 `game.json` 對齊）；`BLOCK.CHEST = 33`／`T.CHEST = 40`／`SameItemCell`（Task 2 產出，Task 2／7 消費）；`giveItem(item, count, dur?)`（`src/main.ts`，第三參數可選 → 既有呼叫端不變）。
- **Review Focus→測試**：逐條已掛在 Task 1（逐筆丟棄、上限）、Task 4（壞記錄不連坐）、Task 6（熔爐往返）、Task 3（游標總數守恆）、Task 1／7（溢出）、Task 5（`game.json` 一致性 ＋ 64 KiB 預算）。
- **比例**：計畫以決策（檔案、簽名、值、測試名與斷言）為主體，沒有逐字抄整支程式；短片段集中在**介面契約**（`sanitizeStackClamped`／`sanitizeSlotsClamped`、`close()` 的游標歸還分支、`open` 參數、箱子貼圖的畫法）與**測試斷言範例**（各 Task 的 Step 1），不是整支實作程式碼。
- **已知未測面**：`src/main.ts` 無測試（組裝根）→ Task 6／7 的接線以人工步驟＋Playwright 佐證，並在回報中列「未自動化」；`src/ui/container.ts` 的圖示像素在 jsdom 不可測（無 2d context）→ 只斷言格數／標題／數字／游標／回呼；原版的箱子正面貼圖細節與連體大箱子不做（明示簡化）；雲端 64 KiB 的實際觸發門檻以人工量測為準（不設 flaky 的時間門檻測試）。
- **2026-10-20 終審修正摘要**（本計畫依最終跨計畫複核報告修正；修正點在正文以「（2026-10-20 終審修正：…）」標出）：
  1. **建議修正 #7（檔案結構表漏列 `src/render/textures.test.ts`）**：Task 2 實際會改這個測試檔（新增 `'the chest tile is painted'`），原本檔案結構表只有 `src/render/textures.ts` 一列 → 已補列，並在 Task 2 Step 1 明列該測試檔的動作。
  2. **建議修正 #6（洋紅層斷言三批各宣稱要修）**：**唯一的修復點在 B3（0.6.0）**；本批改為「**只驗證、不改寫**」，並附「上游 B3 尚未合併時才由本批補改成**與 B3 完全相同**的 `[TILE_COUNT, TILE_COUNT + 1, 47, 63]`」的備援。**防呆提醒已寫進 Task 2**：本批把 `TILE_COUNT` 從 40 推到 41、箱子貼圖畫在 tile 40 → 若上游仍是寫死的 `[TILE_COUNT, 32, 47, 63]`，layer 40 會變成內容層而紅。
  3. **建議修正 #8（游標規則兩份實作）**：Global Constraints 新增「**游標堆疊規則只有一份實作**」條——B5 的 `src/ui/inventory.ts` 本批不得再改；`src/ui/cursor.ts` 是本批唯一的游標規則實作（容器面板必須呼叫它）。若實作者要順手讓 B5 的背包面板改呼叫 `cursor.ts`，必須讓 `src/ui/ui.test.ts` 的既有游標案例原樣通過（不得改斷言）並在 commit 訊息說明。
  4. **建議修正 #10（集中清單）**：Global Constraints 的既有測試帳目改成〈本批要改寫的既有測試（集中清單）〉表格——逐條列出「檔案＋既有測試＋改法＋理由」，含 `src/render/textures.test.ts` 與配方筆數（寫成「讀現況 → 現況 + 1」）。
