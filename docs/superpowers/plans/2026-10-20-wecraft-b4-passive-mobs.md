# WeCraft B4 被動生物與生物對齊（0.7.0）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓世界裡有會走路的雞／豬／羊／牛——生成規則、掉落、食物鏈、熔爐食譜、進食手感一次做齊；同時把敵對側拉齊原版（白天燃燒、生成距離、上限、速度），並讓被動生物跨存檔保留，發布 0.7.0。

**Architecture:** 純邏輯放 `src/world`（被動生物模型／AI／生成、掉落表、光照生怪判準）與 `src/player`（食物表、進食狀態機），以單元測試釘死；`src/render/passive-mobs.ts` 只負責畫出方塊動物；`src/main.ts` 是未測的組裝根，只做接線。生怪判準集中在 `src/world/spawn-rules.ts` 的 `SpawnLight` 介面——B4 用「日光下」近似，B6 只要換掉光照解析器即可改成真光照。存檔採「附加欄位」政策：本機 payload 維持 v3、雲端維持 format 1，兩者都只多一個 `passiveMobs` 欄位，舊存檔缺欄位＝沒有生物。

**Tech Stack:** TypeScript strict、Three.js、Vite、Vitest（jsdom 用於 UI／renderer）、fake-indexeddb（存檔）、IndexedDB、WebAudio 程序合成（音效為加分項）。

**Spec:** `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`（§B4 為本批範圍，L181–217；§6 簡化清單、§7 決策記錄一併適用）

**上游相依（本批必須在其後實作）**（2026-10-20 終審修正：本段是新增的——B4 原本沒有上游相依說明，實作者只拿到 B4 計畫＋公約＋spec 時會缺兩件關鍵資訊：旗標欄位由誰擁有、方塊編號前提）：

| 上游 | 本批用到的東西 | 所有權 |
|---|---|---|
| **B2（0.5.0）** | `src/player/input.ts` 的 `InputState.placeHeld: boolean`（右鍵按住旗標；由 `clearActive()` 清除） | **B2 擁有**。本批**只消費**（`input.state.placeHeld`），**不得重新宣告欄位、不得再寫 `onMouseDown`／`onMouseUp`／`clearActive` 的旗標邏輯**（重複宣告會是 TS duplicate identifier，且等於同一件事做兩次） |
| **B3（0.6.0）** | 9 個新方塊與其**物品形式**（`spruce_log`／`spruce_leaves`／`birch_log`／`birch_leaves`／`dandelion`／`poppy`／`short_grass`／`cactus`／`ice` 的 `ItemId`／`ITEM_IDS`／`BLOCK_PAIRS`）、`TILE_COUNT` 與 tile 索引 | **B3 自己補**（物品形式的所有權在 B3）。本批**只消費**、**不得重做**這 9 個物品形式；本批自己的 13 個 id 與 `BLOCK.WOOL`（26）／`T.WOOL`（33）另行宣告 |
| B1（0.4.0） | `EXHAUST_*` 常數、`Vitals` | 既有 import，不新增常數 |

**若上游尚未合併的備援（不得默默重複宣告）**：
- **B2 未合併** → `InputState.placeHeld` 不存在。本批**不得自行在 `src/player/input.ts` 宣告它**（所有權在 B2；重複宣告＝未來 B2 合併時撞號）。備援：Task 9 的進食按住接線**延後到 B2 合併後**再實作（Task 9 的其餘部分——`src/player/eat.ts` 的 `eatTick` 純邏輯、`src/ui/eat-progress.ts`、測試——**仍可在本批完成**），並在該 Task 的 commit 訊息與回報中明寫「進食接線待 B2 落地」。
- **B3 未合併** → 本批的方塊／tile 編號前提不成立（`BLOCK.WOOL` 必須是 26、`T.WOOL` 必須是 33，見公約 §3.5）。備援：**本批必須在 B3 之後實作**；若實作者被要求先做 B4，須回報 controller 由 controller 裁決編號，**不得自行改用別的 id**（舊存檔的 `modified` 記的是數字 id，改號＝破壞舊存檔）。
- 本批的**物品表基數一律讀現況**（見 Task 1 Step 1）：不要照抄任何上游的固定數字。

---

## Global Constraints

（出自 spec §1、§2、§4、公約 §3／§6 與 AGENTS.md；每個任務的需求都隱含本節。）

- 每個任務結束：`npm run typecheck`、`npm test`、`npm run build`（＋`npm run lint`）全綠；測試要「改得有理」，禁止為綠燈弱化。既有 806 測試不得弱化；因規格改變而調整的既有測試必須在本計畫中列出並在 commit 訊息說明理由。
- **本批要改寫的既有測試（完整清單，2026-10-20 稽核後補齊）**（2026-10-20 終審修正：**基數一律寫成「讀現況 → 現況 + 本批新增 N」，不得寫死會漂移的絕對數字**；下表的「基數」欄位＝實作者在 Task 1 Step 1 讀到的當前值）：
  | 檔案 | 既有測試 | 改法 | 理由 |
  |---|---|---|---|
  | `src/core/items.test.ts` | `ALL_ITEM_IDS.length` 的計數斷言 | 讀現況基數 N → 改成 `expect(ALL_ITEM_IDS.length).toBe(N + 13)`（本批新增 13 個 id）。**N 由實作者實作時讀 `src/core/items.ts` 取得並寫死成實際值**（若 B3 已合併則 N＝41 → 54；若 B3 未合併則 N＝32 → 45）；並在 commit 訊息註明實際值 | 數量守門同步 |
  | `src/core/items.test.ts` | `ALL_ITEMS.length` 的計數斷言（`items.test.ts` 第 37 行） | 同上：改成 `expect(ALL_ITEMS.length).toBe(N + 13)` | 同上（原計畫漏列） |
  | `src/core/items.test.ts` | 鏡像清單 `ALL_ITEMS` 補 13 個 id | union 鏡像同步 | `new Set(ALL_ITEM_IDS)` vs `new Set(ALL_ITEMS)` |
  | `src/world/blocks.test.ts` | `'requiredTool／fastTool data matches vanilla'` 窮舉表 | 補 `[BLOCK.WOOL, null, null]` | 該測試要求每個 block id 都在表內 |
  | `src/world/blocks.test.ts` | `'hardness table matches vanilla 1.20+'` | 補 `[BLOCK.WOOL, 0.8]` | 資料表同步 |
  | `src/audio/sounds.test.ts` | `'maps every BLOCK id to its material group'` | 補 `[BLOCK.WOOL]: 'leaves'` | 材質表同步（**斷言本身是 `expect(Object.keys(table)).toHaveLength(Object.keys(BLOCK).length)` → 會自動跟著 `BLOCK` 筆數變，實作者不需要手改任何長度數字**；B3 合併後 `BLOCK` 26 筆 → 本批後 27 筆） |
  | `src/world/mobs.test.ts` | 骨架 4 處斷言 2.6／±1.3 | 改 3.5／±1.75 | 速度比例對齊 |
  | `src/world/mobs.test.ts` | 生成距離／`MAX_MOBS` 相關斷言 | 12–24 → 24–128、上限 8 → 12 | spec §B4.4 |
  | `src/world/furnace.test.ts` | `SMELT_RECIPES`／`FUEL_VALUES` 的 `toEqual` | 7 筆食譜／小數燃料值 | spec §B4.3 |
  | `src/world/save.test.ts` | `makePayload()` fixture、4 個 `collectSavePayload` 呼叫點 | 補 `passiveMobs: []` | 新增必填來源欄位 |
  | `src/world/save.test.ts` | v1／v2 遷移測試的 `toEqual` 預期物件 | 補 `passiveMobs: []` | `loadGame` 一律回傳該鍵 |
  | `src/core/cloud-save.test.ts` | 7 個 `buildCloudData` 呼叫點、`buildCloudData` 輸出的 `toEqual` | 補 `passiveMobs: []` | 新增必填來源欄位＋payload 形狀 |
- 版本：本批發布 `0.7.0`；`package.json` 與 `game.json` 同步；tag 為 `v0.7.0` 且指向含 bump 的 commit；不覆寫已發布版本（0.4.0 已發布）。
- 存檔格式政策（公約 §3）：**本機 payload 不升版**（維持 v3，只加可選欄位 `passiveMobs`）；**雲端維持 format 1**（只加可選欄位 `passiveMobs`）；`game.json` 的 `cloudSave` 不動（`readableFormats:[1], writeFormat:1`）。舊存檔缺 `passiveMobs` ＝ 沒有生物（載入得到空陣列），不是錯誤。
- B3 的 `worldgenVersion`（附加欄位）與 B4 的 `passiveMobs`（附加欄位）互不干擾：兩者都是 v3／format 1 上的可選欄位，各自獨立正規化；B4 不讀、不寫 `worldgenVersion`，也不依賴 B3 的「地形已改變」提示是否已實作（批次順序若為 B3→B4，B4 的程式碼不得假設該欄位存在）。
- 原版基準：Minecraft Java Edition 1.20+；數值以本計畫各任務的「已查證」段落為準（來源見各任務），未標「已查證」者一律在實作時以 minecraft.wiki 複核。
- 平台紀律：發布（tag＋GitHub Release）已預先授權，但每批必須附明確中文更新內容；`id` 不變；不改 iframe／pointer lock／全螢幕／瀏覽器保留鍵的行為（**本批只「消費」B2 已有的「右鍵按住」旗標，不改輸入層本身**，不改鎖定與 Esc 流程）。
- 發布候選跑固定工具：`.playroom/tools/playroom-game-tools-1.1.0.zip`（先驗 `sha256` 對 `.playroom/game-tools.lock.json`）＋ `pack-game.mjs`＋`validate-game.mjs`（Task 12）。本機沒有 `unzip`，用 `python3 -m zipfile`。
- 註解誠實化：本批碰到的「Minecraft parity」宣稱要同步校正（`src/world/mobs.ts` 的「no dayburn」、`src/player/eat.ts` 的「滿飢餓照吃」、`src/main.ts` 的殭屍必掉蘋果、README 的相關敘述）。
- 分支：本計畫在 `b4-passive-mobs` 分支執行（SDD＋隔離 worktree）；tag 與 push 由 controller 在 merge 回 master 後執行（Task 12 Step 7）。

## Review Focus

（spec 沒明說、但最可能咬人的輸入類別或失敗模式；每一條都已在對應任務放測試。）

1. **舊存檔／舊雲端缺 `passiveMobs`**：不得崩、不得整包拒絕、不得把整包生物清空成「壞檔」→ Task 10（`normalizePassiveMobs` 逐筆丟棄、整包保留；v3 舊檔 → 空陣列）。
2. **被動生物記錄被塞爛**（未知種類、NaN 座標、hp 負數、1000 筆）：一筆壞的不准拖垮整包、不准生出 NaN 位置的幽靈生物 → Task 10（逐筆驗證＋筆數上限 12）。
3. **進食手感**：「滿飢餓不可進食」與「按住不足 1.6 秒不吃東西」是兩個最容易回歸的行為；右鍵脈衝與按住狀態必須分開（點擊放置不能被按住吃東西吃掉） → Task 2（純邏輯）＋Task 9（本批自有的 `eatTick`：把 `held` 與進度綁在一起，旗標欄位由 B2 提供）。
4. **生成規則的可驗證性**：白天才生成、離玩家 ≥24、成群 2–4、全場 ≤12、夜間不生成——四條都要能用固定種子統計測試釘死，而不是靠人工目視 → Task 7（統計測試）。
5. **敵對生成距離放大後的效能與行為**：12–24 改成 24–128 之後，怪可能在視野外生成、也可能走很遠才靠近；despawn 128 與上限 12 必須同時生效 → Task 5（常數與統計測試）＋批末效能實測。
6. **白天燃燒不得誤殺**：**頭頂正上方那一格**（腳底 +2＝屋簷／樹冠葉片的位置）有方塊、或站在水裡，都不能燃燒；且燃燒只在日光直射時發生（夜晚不燃） → Task 5（`stepSunBurn` 表驅動測試）。

---

## 檔案結構

| 檔案 | 動作 | 職責 |
|---|---|---|
| `src/world/spawn-rules.ts` | 新增 | 生怪光照判準（`SpawnLight`／`clockLight`／`canSpawnPassive`／`canSpawnHostile`）——B6 的替換接縫 |
| `src/world/passive-mobs.ts` | 新增 | 被動生物定義表、實體、AI（漫遊／panic／漂浮）、命中測試、生成群 |
| `src/world/passive-save.ts` | 新增 | `PassiveMobRecord` 序列化／正規化／還原（附加欄位用） |
| `src/world/mob-drops.ts` | 新增 | 六種生物的擊殺掉落表（含數量範圍抽籤） |
| `src/world/mobs.ts` | 修改 | 生成距離 24–128、上限 12、despawn 128、速度比例、白天燃燒、光照生怪閘門 |
| `src/world/drops.ts` | 修改 | 樹葉 0.5% 掉蘋果（`LEAF_APPLE_CHANCE`／`chanceDropFor`）——**只放機率表，不放 `spawnBlockDrop`**（2026-10-20 稽核修正：`spawnBlockDrop` 在 `src/player/interact.ts`，不在本檔） |
| `src/world/furnace.ts` | 修改 | 四種生肉→熟肉食譜；燃料值改小數（煤 8／原木板 1.5／木棍 0.5） |
| `src/world/raycast.ts` | 修改 | 新增 `rayAabbEntry`（從 `player/interact.ts` 搬出，供主動／被動共用） |
| `src/world/save.ts` | 修改 | 本機 payload 加可選欄位 `passiveMobs`（維持 v3）＋收集／載入 |
| `src/core/cloud-save.ts` | 修改 | 雲端 payload 加可選欄位 `passiveMobs`（維持 format 1） |
| `src/core/items.ts` | 修改 | 13 個新物品 id ＋`wool`↔方塊配對 |
| `src/core/advancements.ts` | 修改 | 新進度 `pasture`（取得生肉或羊毛） |
| `src/player/eat.ts` | 修改 | `FOOD_VALUES` 食物表、`EAT_TIME_SEC`、`canEat`、`EatProgress`、泛化的 `eatFromSlot`、**Task 9 的 `eatTick`（把「右鍵是否仍按住」與進度綁在一起的純邏輯；`held` 由 `main.ts` 從 B2 的 `input.state.placeHeld` 唯讀帶入）** |
| `src/player/input.ts` | **不動（沿用 B2）** | `state.placeHeld` 的**所有權在 B2（0.5.0）**：欄位宣告與 `clearActive()` 清除行為都已存在。本批**只消費** `input.state.placeHeld`，**不得重新宣告欄位、不得再寫 `onMouseDown`／`onMouseUp`／`clearActive` 的旗標邏輯**（2026-10-20 終審修正：原計畫在此寫「修改 → `state.placeHeld`」，等於把 B2 已擁有的欄位再宣告一次，會是 TS duplicate identifier） |
| `src/player/interact.ts` | 修改 | `spawnBlockDrop` 加 rng 參數＋**在 `dropItemFor` 為 null 的分支之前算機率掉落**（2026-10-20 稽核修正）；`rayBoxEntry` 改用 `raycast.rayAabbEntry` |
| `src/audio/sounds.ts` | 修改 | 羊毛方塊的材質音效（`GROUP_BY_BLOCK[BLOCK.WOOL] = 'leaves'`）（2026-10-20 稽核修正：原缺漏會讓挖羊毛是泥土聲） |
| `src/render/passive-mobs.ts` | 新增 | 四種方塊動物的渲染（體型依定義表、走路擺動、受擊閃白） |
| `src/render/textures.ts` | 修改 | 羊毛方塊的圖集 tile（33） |
| `src/ui/icons.ts` | 修改 | 12 個非方塊新物品的像素圖示（羊毛走圖集） |
| `src/ui/icons.test.ts` | 新增 | 12 個新 id 都有專屬圖示分支的靜態檢查（2026-10-20 稽核修正：原計畫的批末驗收要求圖示測試卻無對應任務） |
| `src/ui/eat-progress.ts` | 新增（可選） | 進食中的進度條 DOM（加分項，不影響規則） |
| `src/audio/voices.ts` | 修改（加分項） | 四種被動生物的程序合成叫聲 |
| `src/main.ts` | 修改 | 全部接線（未測的組裝根） |
| `README.md`、`docs/releases/v0.7.0.md`、`package.json`、`game.json` | 修改／新增 | Task 12 發布 |

---

### Task 1: 新物品／新方塊資料表與圖示

**Files:**
- Modify: `src/core/items.ts`（`ItemId` union、`ITEM_IDS` 表、`BLOCK_PAIRS`）
- Modify: `src/world/blocks.ts`（`BLOCK.WOOL`、`T.WOOL`、`DEFS`、`PLACEABLE`）
- Modify: `src/render/textures.ts`（圖集 tile 33）
- Modify: `src/ui/icons.ts`（`drawItemArt` 新分支）
- Modify: `src/core/advancements.ts`（新進度 `pasture` ＋ `OBTAIN_UNLOCKS`）
- Modify: `src/audio/sounds.ts`（`GROUP_BY_BLOCK[BLOCK.WOOL] = 'leaves'`）
- Create: `src/ui/icons.test.ts`（12 個新 id 的圖示分支靜態檢查）
- Test: `src/core/items.test.ts`、`src/world/blocks.test.ts`、`src/core/advancements.test.ts`、`src/audio/sounds.test.ts`、`src/ui/icons.test.ts`

**Interfaces:**
- Consumes: B3（0.6.0）已合併時帶來的 9 個新方塊與其**物品形式**（`spruce_log`／`spruce_leaves`／`birch_log`／`birch_leaves`／`dandelion`／`poppy`／`short_grass`／`cactus`／`ice` 的 `ItemId`／`ITEM_IDS`／`BLOCK_PAIRS`）與 `TILE_COUNT`（**只消費，不得重做**；見〈上游相依〉段）。
- Produces（後續任務依賴）：
  - `ItemId` 新增 13 個：`'raw_chicken' | 'cooked_chicken' | 'raw_porkchop' | 'cooked_porkchop' | 'raw_mutton' | 'cooked_mutton' | 'raw_beef' | 'steak' | 'leather' | 'feather' | 'wool' | 'rotten_flesh' | 'bone'`（`ALL_ITEM_IDS` **基數 ＋ 13**；基數由實作者讀現況取得並在 commit 訊息註明實際值——見 Task 1 Step 1）。
  - `BLOCK.WOOL = 26`（`BlockDef`：hardness 0.8、solid、opaque、top/side/bottom 皆 `T.WOOL`）。
    - **id 來源＝controller 裁決的跨批編號表（不得自選）**：既有 `BLOCK` 0–16 不動；B3 用 17–25（`SPRUCE_LOG`…`ICE`）；**本批羊毛 = 26**；B5 用 27–31（`GRAVEL`／`GOLD_ORE`／`DIAMOND_ORE`／`SPRUCE_PLANKS`／`BIRCH_PLANKS`）；B6 火把 = 32；B8 箱子 = 33。tile 索引同理：B3 用 21–32（`TILE_COUNT` 33）、**本批 `T.WOOL` = 33（`TILE_COUNT` 34）**、B5 用 34–38、B6 `T.TORCH` = 39、B8 `T.CHEST` = 40。
  - `AdvancementId` 新增 `'pasture'`；`ADVANCEMENTS` 新增一筆 `{ id: 'pasture', title: '牧場', description: '取得生肉或羊毛', icon: 'raw_beef' }`。

**已查證數值（wiki，2026-10-20）**：生雞肉 2 飢餓／1.2 飽食、生豬肉 3／1.8、生羊肉 2／1.2、生牛肉 3／1.8；熟雞肉 6／7.2、熟豬肉 8／12.8、熟羊肉 6／9.6、牛排 8／12.8；腐肉 4／0.8；蘋果 4／2.4。掉落：雞＝生雞肉 1＋羽毛 0–2、豬＝生豬肉 1–3、羊＝生羊肉 1–2＋羊毛 1、牛＝生牛肉 1–3＋皮革 0–2、殭屍＝腐肉 0–2、骷髏＝骨頭 0–2＋箭 0–2。

**設計決策（要寫進註解）**：
- 熟牛肉的物品 id 用 `'steak'`（不是 `'cooked_beef'`）——`stackName` 會把 id 轉成顯示名稱，`'steak'` →「Steak」與原版一致；其餘八個生／熟肉 id 轉出來剛好是原版名稱。
- 羊毛 **本批就交付方塊＋物品**：羊要掉羊毛，物品必須存在；而 `items.ts` 的方塊配對表只允許「有方塊的物品」進熱鍵欄與創造調色盤，所以一併把 `BLOCK.WOOL` 加進 `blocks.ts`（見「與公約／spec 的差異」第 1 條：spec §B4.3 要求「羊毛（方塊＋物品）」，與 §B5.1 的「羊毛方塊」重複，本批先做，B5 只剩世界生成層面）。
- 羊毛方塊 **不進世界生成**（原版羊毛也不自然生成，只來自羊與剪毛）；B5 的「低垂果實」批次若要加礦物群變種再由 B5 補。

- [ ] **Step 1: 寫測試（失敗）**

  **先讀基數（2026-10-20 終審修正：原計畫把 `32 → 45` 寫死，那個 32 是「B3 合併前」的舊值——若 B3 已合併，現況基數是 41（32＋9），本批的 13 個 id 加上去應是 54。實作者必須讀現況）**：
  ```ts
  // 讀 src/core/items.ts 現況（合併後的當前值）
  const base = ALL_ITEM_IDS.length;   // B3 未合併＝32；B3 已合併＝41
  ```
  目標值 ＝ `base + 13`（本批新增 13 個 id）。**測試裡寫死的是實作者讀到的實際值**（例：`expect(ALL_ITEM_IDS.length).toBe(54)`），並在 Task 1 的 commit 訊息裡註明實際值（例：`ALL_ITEM_IDS 41 → 54`）。

`src/core/items.test.ts`：
- 既有 `expect(ALL_ITEM_IDS.length).toBe(<現況基數>)` → 改為 `toBe(<基數 + 13>)`（**改動理由**：本批新增 13 個物品 id；這是數量守門測試，不是行為弱化）。
- **既有 `expect(ALL_ITEMS.length).toBe(<現況基數>)`（鏡像清單的長度斷言，`items.test.ts` 第 37 行）→ 改為 `toBe(<基數 + 13>)`**（2026-10-20 稽核修正：原計畫只列了 `ALL_ITEM_IDS.length`，漏了同一個檔案的第二處長度斷言 → 會紅）。
- **既有鏡像清單 `ALL_ITEMS`（`items.test.ts` 第 17–33 行的 `BLOCK_ITEMS`／`TOOL_ITEMS`／`DROP_ITEMS`）要補進本批的 13 個 id**（2026-10-20 稽核修正）：`raw_chicken`／`cooked_chicken`／`raw_porkchop`／`cooked_porkchop`／`raw_mutton`／`cooked_mutton`／`raw_beef`／`steak`／`leather`／`feather`／`wool`／`rotten_flesh`／`bone`——否則 `expect(new Set(ALL_ITEM_IDS)).toEqual(new Set(ALL_ITEMS))` 會紅。建議另開一段 `FOOD_ITEMS`（或 `MATERIAL_ITEMS`）收納這 13 個，不要硬塞進 `DROP_ITEMS`（`wool` 是方塊物品、`rotten_flesh` 是食物，語意不同）。**改動理由**：測試自己的 union 鏡像必須跟上 union 成長，不是弱化。
- 新增 `'every B4 item id is a known, sanitizable id'`：
  ```ts
  const NEW = ['raw_chicken','cooked_chicken','raw_porkchop','cooked_porkchop','raw_mutton',
    'cooked_mutton','raw_beef','steak','leather','feather','wool','rotten_flesh','bone'] as const;
  for (const id of NEW) {
    expect(ALL_ITEM_IDS).toContain(id);
    expect(sanitizeStack({ item: id, count: 2 })).toEqual({ item: id, count: 2 });
    expect(maxStack(id)).toBe(64);
  }
  ```
- 新增 `'wool is the item form of the wool block'`：`expect(blockFromItem('wool')).toBe(BLOCK.WOOL);`（需 import `BLOCK`）。

`src/world/blocks.test.ts`：
- 新增 `'wool: id 26, solid, opaque, hardness 0.8, placeable'`：
  ```ts
  const def = getBlockDef(BLOCK.WOOL);
  expect(def.id).toBe(26);
  expect(def.hardness).toBe(0.8);
  expect(def.solid).toBe(true);
  expect(def.transparent).toBe(false);
  expect(def.requiredTool).toBeNull();
  expect(PLACEABLE).toContain(BLOCK.WOOL);
  ```
- **既有 `'requiredTool／fastTool data matches vanilla'` 的窮舉表要補一列 `[BLOCK.WOOL, null, null]`**（2026-10-20 稽核修正）：該測試結尾有 `expect(expected.map(([id]) => id).sort(byId)).toEqual([...Object.values(BLOCK)].sort(byId))`——**每個 block id 都必須在表內**，新增 `BLOCK.WOOL`（26）而不補表就紅。**改動理由**：新增方塊 id 的資料表同步，不是弱化。
- **既有 `'hardness table matches vanilla 1.20+'` 的表要補一列 `[BLOCK.WOOL, 0.8]`**（同一次資料表同步；硬度 0.8 ＝原版羊毛硬度）。
- 既有 `'every non-air block has valid tile indices'` **不夠用、要另補一條**（2026-10-20 稽核修正）：該測試只檢查 `0 ≤ t < 64`，**抓不到「宣告了 tile 33 卻沒畫」**（漏畫會得到洋紅除錯色層而沒有任何測試紅）。本批自己補一條守門：
  ```ts
  it('the wool tile 33 is painted (never the magenta debug layer)', () => {
    const data = buildTextureArray().image.data as Uint8Array;   // textures.ts 的圖集
    let magenta = 0;
    for (let p = 0; p < TILE_PX * TILE_PX; p++) {
      const i = (33 * TILE_PX * TILE_PX + p) * 4;
      if (data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 255) magenta++;
    }
    expect(magenta, 'tile 33 magenta').toBeLessThan(TILE_PX * TILE_PX);
  });
  ```
  （若 B3 已加入「每個宣告的 tile 都被畫過」的通則測試，就沿用 B3 的 helper，斷言內容不得放寬；`buildTextureArray`／`TILE_PX` 的 import 來源照 `src/render/textures.test.ts` 的現況。）

`src/audio/sounds.test.ts`：
- **既有 `'maps every BLOCK id to its material group (table-driven)'` 的表要補一列 `[BLOCK.WOOL]: 'leaves'`**（2026-10-20 稽核修正）：該測試有 `expect(Object.keys(table)).toHaveLength(Object.keys(BLOCK).length)`——新增 `BLOCK.WOOL` 後表必須同步，否則紅。（2026-10-20 終審修正：原計畫在這裡寫死「17 → 18」，那是「B3 合併前」的舊筆數；**實作者不需要手改任何長度數字**——這條斷言是相對 `Object.keys(BLOCK).length` 的，會自動跟著 `BLOCK` 變：B3 合併後 `BLOCK` 26 筆 → 本批後 27 筆。**只要補那一列材質即可**。）
- 新增 `'wool sounds like the soft leaves material'`：`expect(materialGroup(BLOCK.WOOL)).toBe('leaves');`

`src/core/advancements.test.ts`：
- 新增 `'obtaining raw meat or wool unlocks pasture'`：
  ```ts
  for (const item of ['raw_chicken','raw_porkchop','raw_mutton','raw_beef','wool'] as const) {
    const r = checkAdvancements(emptyAdvancements(), { type: 'obtain', item, mode: 'survival' });
    expect(r.unlocked).toEqual(['pasture']);
  }
  ```
- 新增 `'creative obtains unlock nothing'`（既有規則的迴歸測試，`pasture` 不得在創造模式觸發）。

`src/ui/icons.test.ts`（新檔，2026-10-20 稽核修正：批末驗收第 7 項要求「每個新 id 都有圖示」，原計畫沒有任何任務產出這個檔案）：
- 新增 `'every B4 item id has its own icon branch'`（靜態檢查，不依賴 canvas）：
  ```ts
  const src = readFileSync(resolve(process.cwd(), 'src/ui/icons.ts'), 'utf8');
  const NEW = ['raw_chicken','cooked_chicken','raw_porkchop','cooked_porkchop','raw_mutton',
    'cooked_mutton','raw_beef','steak','leather','feather','rotten_flesh','bone'];
  for (const id of NEW) {
    expect(src, `icons.ts needs a case for ${id}`).toContain(`case '${id}'`);
  }
  ```
  （12 個非方塊 id；`wool` 走方塊圖集分支，不需要 `case`。）
- 新增 `'the wool item icon comes from the block atlas (no dedicated case needed)'`：`expect(src).not.toContain("case 'wool'")`（若實作者仍加了 `case 'wool'` 也無妨——此斷言可改成「有 `case 'wool'` 或走圖集皆可」，但**不得**讓 12 個新 id 落到 `default:` 的灰色 placeholder）。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/items.test.ts src/world/blocks.test.ts src/core/advancements.test.ts src/audio/sounds.test.ts src/ui/icons.test.ts`
Expected: FAIL（型別編譯階段就會報 `ItemId` 缺成員；`icons.test.ts` 會因 `case` 標籤缺失而紅——這是預期的紅燈）。

- [ ] **Step 3: 實作**

`src/core/items.ts`：
- union 新增 13 個成員（照上面 Produces 的清單，`'wool'` 放在方塊類那一段附近）。
- `ITEM_IDS` 表逐項加 `true`（少了任何一項都是型別錯誤——這是刻意的守門機制）。
- `BLOCK_PAIRS` 加 `['wool', BLOCK.WOOL]`。

`src/world/blocks.ts`：
- `BLOCK.WOOL: 26`；`T.WOOL = 33`；`TILE_COUNT = T.WOOL + 1`（34）。
- `DEFS[26]`：`{ id: 26, name: 'wool', hardness: 0.8, solid: true, transparent: false, top: T.WOOL, side: T.WOOL, bottom: T.WOOL, requiredTool: null, fastTool: null }`。
- `PLACEABLE` 加 `BLOCK.WOOL`。

`src/render/textures.ts`：
- `put(33, (_x, _y, r) => vary([233, 236, 236, 255], r, 18));`（白色羊毛＋輕微雜訊；比照既有 tile 的 `vary` 寫法）。
- **合併順序提醒**（2026-10-20 稽核修正：公約 §3.5 給的是「最終」值）：本批把 `TILE_COUNT` 從現況 21 直接拉到 34。若 **B3 尚未合併**，tile 21–32 會是「未畫的洋紅除錯層」——**沒有任何方塊引用它們**（B3 的 17–25 還不存在），所以不會影響遊戲畫面；B3 合併後會自動補齊那 12 層。實作者**不可**因為怕洋紅而把 `TILE_COUNT` 停在 21 或跳號（跳號會與 B3 撞號）。

`src/ui/icons.ts`：
- `drawItemArt` 的 `switch` 新增 12 個分支（羊毛走方塊圖集，不在這裡畫）。每個分支用既有 `line()`／`ctx.arc`／`ctx.fillRect` 畫出可辨識的輪廓：
  - `raw_chicken`／`cooked_chicken`：粉紅肉塊（`#e8a0a0` 不規則團塊）；熟雞肉偏褐（`#d9a05b`）。
  - `raw_porkchop`／`cooked_porkchop`：豬肉偏粉（`#f0a8b0`）＋一圈白脂；熟豬肉偏褐（`#c98a5c`）。
  - `raw_mutton`／`cooked_mutton`：羊肉偏紅（`#e39a9a`）；熟羊肉偏褐（`#b9793f`）。
  - `raw_beef`／`steak`：牛肉深紅（`#c05a5a`）；牛排深褐（`#8a4a2c`）＋白色油脂條。
  - `leather`：棕色方片（`#9a6b3f`）＋四邊縫線（`#6b4a2f`）。
  - `feather`：白色羽毛（`#f2f2f2`）＋中軸（`#c9c9c9`）。
  - `rotten_flesh`：暗綠褐團塊（`#6f7a4a`）＋幾個斑點（`#4d5a33`）。
  - `bone`：白色骨頭（`#efe9d8`）＝兩端圓頭＋中間細桿。

`src/audio/sounds.ts`（2026-10-20 稽核修正：原計畫漏了這個檔案 → 羊毛方塊會 fallback 成泥土聲）：
- `GROUP_BY_BLOCK` 加一筆 `[BLOCK.WOOL]: 'leaves'`。**不新增 `MaterialGroup` 成員**——`leaves` 已是現有 group（羊毛原版是柔軟質地，用 `leaves` 這個既有的高頻「沙沙」音色最接近，且不動 `GROUP_BASE` 的表）。
- 註解補一句「`GROUP_BY_BLOCK` 未登錄者 fallback `'dirt'`；新增方塊 id 必須同步登錄，否則音效錯」（`sounds.test.ts` 的長度斷言就是這條的守門）。

`src/core/advancements.ts`：
- `AdvancementId` union 加 `'pasture'`；`ADVANCEMENTS` 陣列加一筆（放在 `hot_stuff` 之後、`tasty` 之前，維持顯示順序＝取得順序）。
- `OBTAIN_UNLOCKS` 加：`raw_chicken`／`raw_porkchop`／`raw_mutton`／`raw_beef`／`wool` → `'pasture'`。

- [ ] **Step 4: 跑測試轉綠**

Run: `npx vitest run src/core/items.test.ts src/world/blocks.test.ts src/core/advancements.test.ts src/audio/sounds.test.ts src/ui/icons.test.ts`
Expected: PASS。

- [ ] **Step 5: 全量 gates**

Run: `npm run typecheck && npm test && npm run build && npm run lint`
Expected: 全綠。

- [ ] **Step 6: Commit**

```bash
git add src/core/items.ts src/core/items.test.ts src/world/blocks.ts src/world/blocks.test.ts \
  src/render/textures.ts src/ui/icons.ts src/ui/icons.test.ts src/audio/sounds.ts src/audio/sounds.test.ts \
  src/core/advancements.ts src/core/advancements.test.ts
git commit -m "feat(items): B4.3 新增 13 個食物／材料物品與羊毛方塊（附牧場進度）" \
  -m "新增方塊 id 的資料表同步：blocks.test.ts 的窮舉表／硬度表、items.test.ts 的鏡像清單與兩處長度斷言、sounds.test.ts 的材質表長度，都是隨新 id 一起長大的資料表，不是行為弱化。"
```

---

### Task 2: 食物值表與進食規則（純邏輯）

**Files:**
- Modify: `src/player/eat.ts`（整個重寫）
- Test: `src/player/eat.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `ItemId`；`src/player/survival.ts` 的 `Vitals`、`eat`。
- Produces:
  - `export interface FoodDef { food: number; saturation: number }`
  - `export const FOOD_VALUES: Readonly<Partial<Record<ItemId, FoodDef>>>`（10 筆，見下表）。
  - `export const EAT_TIME_SEC = 1.6`（原版 32 tick）。
  - `export function foodFor(item: ItemId): FoodDef | null`
  - `export function canEat(v: Vitals, item: ItemId): boolean`（食物存在 且 `v.hunger < v.maxHunger`）。
  - `export function eatFromSlot(slots, index): EatResult`（泛化：任何有食物值的物品都吃得掉；非食物回 `ate:false` 且回傳同一個陣列參考）。
  - `export class EatProgress`：`elapsed: number`、`item: ItemId | null`、`reset()`、`update(dtSec, item, allowed): 'idle' | 'eating' | 'eaten'`。
  - **保留** `export const APPLE_FOOD = 4` 與 `export const APPLE_SAT = 2.4`（2026-10-20 稽核修正）：本任務整份重寫 `eat.ts`，但 `src/main.ts` 第 55 行 `import { APPLE_FOOD, APPLE_SAT, eatFromSlot } from './player/eat'` 與既有 `src/player/eat.test.ts` 的「apple eat values」段落都依賴這兩個常數——**刪掉會直接破壞 main.ts 與既有測試**。實作時以 `FOOD_VALUES.apple` 為單一真值：
    ```ts
    export const APPLE_FOOD = FOOD_VALUES.apple.food;   // 4
    export const APPLE_SAT = FOOD_VALUES.apple.saturation; // 2.4
    ```
    （`FOOD_VALUES` 的型別是 `Partial<Record<ItemId, FoodDef>>`，取 `.apple` 會是 `FoodDef | undefined` → `tsc` 會報嚴格模式的可能未定義。**改法**：把 `FOOD_VALUES` 的型別改成 `Readonly<Record<ItemId, FoodDef>>`（全部 32+ 個 id 都要有食物值不現實）**或**直接寫常數值 `export const APPLE_FOOD = 4; export const APPLE_SAT = 2.4;` 並在註解標「與 `FOOD_VALUES.apple` 相同（測試 `expect(APPLE_FOOD).toBe(FOOD_VALUES.apple.food)` 釘死兩者一致）」。推薦後者——零型別風險且測試會守住一致性。）

**已查證數值（wiki，2026-10-20）**：食物表見 Task 1 的段落；進食時間 1.6 秒（32 tick，蘋果頁 `consumptiontime` 欄）。腐肉有 80% 機率給「飢餓」狀態效果——**本作沒有狀態效果系統，本批不做**（記為已知簡化，寫進 README）。**生雞肉另有 30% 機率給「飢餓」狀態效果**（Food 頁 Food effects 表）——同樣不做，**一併列入 README 的簡化清單**（2026-10-20 稽核修正：原計畫只列了腐肉）。

**設計決策**：
- 「滿飢餓不可進食」＝ `hunger >= maxHunger` 時 `canEat` 為 false。`src/player/eat.ts` 舊註解寫著「滿飢餓照吃（溢出浪費，Minecraft parity）」——**那是錯的**，spec §B4.3 明訂「滿飢餓不可進食」，本任務改正該註解（並在 README 的差異清單說明）。
- 飽食度 19（未滿）時可以吃，吃完因 `eat()` 的 clamp 浪費——**注意：這不是原版行為**（2026-10-20 稽核修正：原計畫寫「與原版一致」是錯的 parity 宣稱）。現況 `src/player/survival.ts` 的 `eat()` 把飽食度夾在 `maxHunger`（20）；原版是把飽食度夾在「當前 food level（飢餓值）」→ 飢餓 19 時原版飽食度不會超過 19。**本批不改 `eat()` 的 clamp**（動的是 `src/player/survival.ts` 的既有不變量，`survival.ts` 的測試也釘著它），而是把差異誠實寫進 README 的〈與原版的差異〉：「飽食度上限＝`maxHunger`(20)，非原版的 food level 上限」。
- `EatProgress.update` 的 `allowed` 由呼叫端決定（生存模式、持有食物、還沒吃飽）；`allowed` 為 false 或 `item` 為 null 時一律 `reset()` 並回 `'idle'`。

- [ ] **Step 1: 寫測試（失敗）**

`src/player/eat.test.ts`（整檔重寫，保留既有「進食值」段落的形狀）：

- `'the food table matches vanilla hunger and saturation'`（表驅動）：
  ```ts
  expect(FOOD_VALUES).toEqual({
    apple: { food: 4, saturation: 2.4 },
    raw_chicken: { food: 2, saturation: 1.2 },
    cooked_chicken: { food: 6, saturation: 7.2 },
    raw_porkchop: { food: 3, saturation: 1.8 },
    cooked_porkchop: { food: 8, saturation: 12.8 },
    raw_mutton: { food: 2, saturation: 1.2 },
    cooked_mutton: { food: 6, saturation: 9.6 },
    raw_beef: { food: 3, saturation: 1.8 },
    steak: { food: 8, saturation: 12.8 },
    rotten_flesh: { food: 4, saturation: 0.8 },
  });
  ```
- `'canEat refuses a full hunger bar'`：`canEat({ ...createVitals(), hunger: 20 }, 'apple')` → `false`；`hunger: 19` → `true`。
- `'canEat refuses a non-food item'`：`canEat(createVitals(), 'stone')` → `false`。
- `'foodFor returns null for non-food items'`：`foodFor('oak_log')` → `null`。
- `eatFromSlot` 既有 4 個案例（null slot／apple ×3／非食物／×1 清空）**保留**，並補：
  - `'any food item can be eaten'`：`slots = [{ item: 'raw_beef', count: 2 }]` → `ate: true`、`slots[0]` 為 `{ item: 'raw_beef', count: 1 }`、原陣列未被改動。
  - `'a rotten flesh stack is food'`：`{ item: 'rotten_flesh', count: 1 }` → `ate: true`。
- `EatProgress`：
  - `'a hold shorter than 1.6 s never completes'`：`p.update(1.59, 'apple', true)` → `'eating'`；`p.elapsed` ≈ 1.59；再 `p.update(0.005, 'apple', true)` → **仍為 `'eating'`**（累計 1.595 < 1.6，**實作是 `elapsed >= EAT_TIME_SEC` 才觸發**）；再 `p.update(0.005, 'apple', true)` → `'eaten'`（累計 **1.600 ≥ 1.6**）。（2026-10-20 稽核修正：原計畫寫「1.595 → 'eaten'」，與同計畫的實作 `>= 1.6` 矛盾 → 該斷言必紅，且測試名與斷言自相矛盾。）
  - `'a completed hold resets the accumulator'`：`p.update(1.6, 'apple', true)` → `'eaten'`；`p.elapsed` → 0；再 `p.update(0.1, 'apple', true)` → `'eating'`。
  - `'releasing the button resets the progress'`：`p.update(1.0, 'apple', true)` → `'eating'`；`p.reset()` → `p.elapsed === 0`、`p.item === null`。
  - `'switching the held item restarts the progress'`：`p.update(1.0, 'apple', true)`；`p.update(0.1, 'raw_beef', true)` → `'eating'` 且 `p.elapsed` ≈ 0.1、`p.item === 'raw_beef'`。
  - `'a disallowed item cancels the progress'`：`p.update(1.0, 'apple', true)`；`p.update(0.1, 'apple', false)` → `'idle'`、`p.elapsed === 0`。
  - `'a null item cancels the progress'`：`p.update(0.1, null, true)` → `'idle'`。
  - `'non-finite dt is treated as 0'`：`p.update(Number.NaN, 'apple', true)` → `'eating'`、`p.elapsed === 0`。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/player/eat.test.ts`
Expected: FAIL（`FOOD_VALUES`／`canEat`／`EatProgress` 尚未存在）。

- [ ] **Step 3: 實作 `src/player/eat.ts`**

- 保留檔頭的純邏輯說明，改寫為「食物表 + 進食狀態機」，並刪掉舊的「滿飢餓照吃」段落。
- **保留 `APPLE_FOOD`／`APPLE_SAT` 兩個匯出常數**（值 4／2.4），既有 `src/main.ts` 第 55 行的 import 與既有 `src/player/eat.test.ts` 的 `'apple eat values'` 段落都依賴它們（見 Produces 的說明）。既有測試 `'hunger 16 → 20, saturation +2.4 capped at maxHunger'` **不需改寫、必須照樣綠**。
- `FOOD_VALUES`（照 Step 1 的表，鍵順序照表）。
- `foodFor(item)`：`FOOD_VALUES[item] ?? null`。
- `canEat(v, item)`：`const f = foodFor(item); if (!f) return false; return v.hunger < v.maxHunger;`（`Vitals` 的 `hunger`/`maxHunger` 已是數值，不需 NaN 防護——`normalizeVitals` 負責）。
- `eatFromSlot(slots, index)`：把原本「只認 apple」改成「認任何有食物值的物品」；其餘契約（miss 回同一參考、count 遞減、count ≤ 0 清空）不變。
- `EatProgress`：
  ```ts
  export class EatProgress {
    elapsed = 0;
    item: ItemId | null = null;
    reset(): void { this.elapsed = 0; this.item = null; }
    update(dtSec: number, item: ItemId | null, allowed: boolean): 'idle' | 'eating' | 'eaten' {
      if (!allowed || item === null) { this.reset(); return 'idle'; }
      if (this.item !== item) { this.item = item; this.elapsed = 0; }
      const dt = Number.isFinite(dtSec) && dtSec > 0 ? dtSec : 0;
      this.elapsed += dt;
      if (this.elapsed >= EAT_TIME_SEC) { this.elapsed = 0; return 'eaten'; }
      return 'eating';
    }
  }
  ```

- [ ] **Step 4: 跑測試轉綠**

Run: `npx vitest run src/player/eat.test.ts`
Expected: PASS。

- [ ] **Step 5: 全量 gates**

Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 6: Commit**

```bash
git add src/player/eat.ts src/player/eat.test.ts
git commit -m "feat(food): B4.3 食物值表與按住進食狀態機（滿飢餓不可進食）"
```

---

### Task 3: 熔爐食譜與燃料值（小數燃料）

**Files:**
- Modify: `src/world/furnace.ts`
- Test: `src/world/furnace.test.ts`

**Interfaces:**
- Consumes: Task 1 的新物品 id。
- Produces:
  - `SMELT_RECIPES` 擴充為 7 筆：`iron_ore`/`raw_iron` → `iron_ingot`、`sand` → `glass`、`raw_chicken` → `cooked_chicken`、`raw_porkchop` → `cooked_porkchop`、`raw_mutton` → `cooked_mutton`、`raw_beef` → `steak`。
  - `FUEL_VALUES` 改為小數：`{ coal: 8, oak_log: 1.5, oak_planks: 1.5, stick: 0.5 }`。
  - `FurnaceState.fuelUnits` 語意改為「目前燃料還能覆蓋幾次冶煉（可為小數）」。

**已查證數值（wiki，2026-10-20）**：熔爐每件 10 秒（既有 `SMELT_TIME_SEC = 10` 不變）；燃料燃燒時間：煤 80 秒＝8 次、原木 15 秒＝1.5 次、木板 15 秒＝1.5 次、木棍 5 秒＝0.5 次（wiki「Smelting table」模板）。

**設計決策（要寫進註解）**：
- `fuelUnits` 從「整數次」改為「可為小數」：點燃時 `fuelUnits += FUEL_VALUES[item]`，每完成一次冶煉扣 1 並夾在 ≥ 0。
- 原版是「連續燃燒計時器」（1 根原木燃 15 秒，第二次冶煉只燒得完 5 秒就熄火，冶煉暫停等新燃料）。本作沿用既有的「可覆蓋次數」模型（既有程式就是這個形狀），因此 1.5 會覆蓋 **2 次** 冶煉。這是刻意的簡化，寫進 `furnace.ts` 的檔頭註解與 README 差異清單。
- 現況 `FUEL_VALUES` 是整數（`oak_log: 2`、`stick: 1`）＝比原版多一倍；本任務依 spec §B4.3「燃料值校正」改成原版值。

- [ ] **Step 1: 改測試（失敗）**

`src/world/furnace.test.ts`：
- 既有 `expect(SMELT_RECIPES).toEqual({...})` → 改為 7 筆（新增四種生肉）。**改動理由**：spec §B4.3 要求四種生肉都能熔煉成熟肉。
- 既有 `expect(FUEL_VALUES).toEqual({ coal: 8, oak_log: 2, oak_planks: 2, stick: 1 })` → 改為 `{ coal: 8, oak_log: 1.5, oak_planks: 1.5, stick: 0.5 }`。**改動理由**：spec §B4.3 燃料值校正（wiki 複核值）。
- 新增 `'a log covers one and a half smelts'`：
  ```ts
  let s = emptyFurnace();
  s = { ...s, input: { item: 'raw_beef', count: 3 }, fuel: { item: 'oak_log', count: 1 } };
  const r = stepFurnace(s, 30);
  expect(r.completed).toBe(2);           // 1.5 次的燃料覆蓋 2 次冶煉
  expect(r.state.fuelUnits).toBe(0);     // 用盡
  expect(r.state.input?.count).toBe(1);  // 還剩一塊沒熔
  ```
- 新增 `'a stick covers half a smelt, so the next one waits for fuel'`：同樣的結構但燃料是 `stick`，`stepFurnace(s, 30)` → `completed === 1`、`fuelUnits === 0`、輸入還剩 2。
- 新增 `'a coal covers eight smelts'`：燃料 `coal`、輸入 `raw_beef × 10`、`stepFurnace(s, 80)` → `completed === 8`。
- 新增 `'smelting raw meat yields the cooked item'`：`stepFurnace({ input: {item:'raw_chicken',count:1}, fuel:{item:'coal',count:1}, ... }, 10)` → `state.output` 為 `{ item: 'cooked_chicken', count: 1 }`。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/world/furnace.test.ts`
Expected: FAIL（食譜與燃料值不符）。

- [ ] **Step 3: 實作 `src/world/furnace.ts`**

- `SMELT_RECIPES` 加四筆生肉。
- `FUEL_VALUES` 改成小數值。
- `stepFurnace` 的燃料消耗改為 `fuelUnits = Math.max(0, fuelUnits - 1)`（取代原本的整數 `fuelUnits -= 1`）；其餘流程（點火凍結、輸出滿凍結、每次完成扣 1 次燃料）不動。
- 更新檔頭註解：說明 `fuelUnits` 可為小數、與原版「連續燃燒」的差異。

- [ ] **Step 4: 跑測試轉綠**

Run: `npx vitest run src/world/furnace.test.ts` → PASS。

- [ ] **Step 5: 全量 gates＋人工**

Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。
人工（記錄結果）：放熔爐 → 投入生豬肉 ＋ 木棍 → 10 秒後得到熟豬肉；投入煤炭則可連續熔 8 塊。

- [ ] **Step 6: Commit**

```bash
git add src/world/furnace.ts src/world/furnace.test.ts
git commit -m "feat(furnace): B4.3 四種生肉熔煉與原版燃料值（煤 8／板材 1.5／木棍 0.5）"
```

---

### Task 4: 擊殺掉落表與蘋果來源修正

**Files:**
- Create: `src/world/mob-drops.ts`、`src/world/mob-drops.test.ts`
- Modify: `src/world/drops.ts`（**只**加 `LEAF_APPLE_CHANCE`／`chanceDropFor`；`spawnBlockDrop` 不在這個檔案）
- Modify: `src/player/interact.ts`（`spawnBlockDrop` 加 rng 參數＋機率掉落的計算位置）
- Modify: `src/main.ts`（擊殺掉落改走 `rollMobDrops`；移除「殭屍必掉蘋果」）
- Test: `src/world/mob-drops.test.ts`、`src/world/drops.test.ts`、`src/player/interact.test.ts`

**Interfaces:**
- Consumes: Task 1 的物品 id；`src/world/mobs.ts` 的 `MobKind`。
- Produces:
  - `src/world/mob-drops.ts`：`export interface MobDrop { item: ItemId; count: number }`；`export type MobDropKind = MobKind | 'chicken' | 'pig' | 'sheep' | 'cow';`；`export function rollMobDrops(kind: MobDropKind, rng?: () => number): MobDrop[]`（count 為 0 的項目不輸出）。
  - `src/world/drops.ts`：`export const LEAF_APPLE_CHANCE = 0.005`；`export function chanceDropFor(blockId: number, rng?: () => number): ItemId | null`。
  - `src/player/interact.ts`：`export function spawnBlockDrop(drops, mode, blockId, pos, held, rng?: () => number): DropEntity[]`——**第六個參數是注入的 rng（預設 `Math.random`）**，供測試釘住 0.5% 機率。（2026-10-20 稽核修正：`spawnBlockDrop` 現況在 `src/player/interact.ts` 第 21–33 行，`src/world/drops.ts` 沒有同名函式——原計畫把兩處寫反了。）

**已查證數值（wiki，2026-10-20）**：殭屍掉腐肉 0–2；骷髏掉骨頭 0–2、箭 0–2；雞掉生雞肉 1＋羽毛 0–2；豬掉生豬肉 1–3；羊掉生羊肉 1–2＋羊毛 1；牛掉生牛肉 1–3＋皮革 0–2。橡木樹葉掉蘋果機率 0.5%（1/200）。

**設計決策**：
- 「原版機制」裡雞／豬／羊／牛在**燃燒時**死亡會掉熟肉；本作沒有生物著火系統（白天燃燒只給不死系），故一律掉生肉（寫進 README 差異）。
- 掉落表用 `MobDropKind`（本檔自有的字面聯集）當參數型別；Task 6 的 `PassiveKind`（`'chicken'|'pig'|'sheep'|'cow'`）是它的子聯集，**結構相容**，`rollMobDrops(m.kind)` 直接傳入即可、不需轉型。
- 蘋果 0.5% 掛在**方塊掉落表**（`drops.ts` 的 `chanceDropFor`），不是擊殺掉落——兩條鏈分開，避免 `spawnBlockDrop` 的「持有工具門檻」語意被生物掉落污染（`drops.ts` 的 block→item 表與 `interact.ts` 的 `canHarvest` 門檻互不影響）。
- 樹葉現在仍不掉樹葉本體（B1.6 已改成不掉），只額外有 0.5% 蘋果。
- **機率掉落必須在 `dropItemFor` 為 null 的判斷之前計算**（2026-10-20 稽核修正，這是本任務最容易做錯的地方）：現況 `spawnBlockDrop` 有三個提前 return——`mode === 'creative'`、`!canHarvest(...)`、`!item`（`dropItemFor` 回 null）。而 `drops.ts` 的 `dropItemFor(LEAVES)` **回 null**（B1.6 之後樹葉不掉本體）→ 對樹葉一定會走 `if (!item) return drops;`。**原計畫寫「既有邏輯不動，之後追加一次機率掉落」，那段追加碼對樹葉永遠走不到** → 計畫自己的 `'breaking leaves can drop an apple'` 測試會得到 0 筆而紅，spec §B4.3 的功能則完全沒實作。
  - 規則寫清楚：**葉子的 chance drop 不受 `dropItemFor` 回 null 影響，但仍然受 `creative` 模式與 `canHarvest` 門檻約束**（樹葉的 `requiredTool` 是 `null` → 徒手也能收穫，所以樹葉的 0.5% 蘋果在生存模式徒手破壞時就會生效）。

- [ ] **Step 1: 寫測試（失敗）**

`src/world/mob-drops.test.ts`（新檔，表驅動）：
- `'zombie drops 0-2 rotten flesh'`：`rollMobDrops('zombie', () => 0)` → `[]`；`rollMobDrops('zombie', () => 0.999)` → `[{ item: 'rotten_flesh', count: 2 }]`。
- `'skeleton drops 0-2 bones and 0-2 arrows'`：rng 0.999 → `[{ item: 'bone', count: 2 }, { item: 'arrow', count: 2 }]`；rng 0 → `[]`。
- `'chicken drops one raw chicken and 0-2 feathers'`：rng 0.999 → `[{ item: 'raw_chicken', count: 1 }, { item: 'feather', count: 2 }]`。
- `'pig drops 1-3 raw porkchops'`：rng 0 → `[{ item: 'raw_porkchop', count: 1 }]`；rng 0.999 → count 3。
- `'sheep drops 1-2 raw mutton and one wool'`：rng 0.999 → `[{ item: 'raw_mutton', count: 2 }, { item: 'wool', count: 1 }]`。
- `'cow drops 1-3 raw beef and 0-2 leather'`：rng 0.999 → `[{ item: 'raw_beef', count: 3 }, { item: 'leather', count: 2 }]`。
- `'the rng never produces a fractional or negative count'`：跑 200 次，斷言每個 `count` 都是 ≥ 1 的整數。

`src/world/drops.test.ts`：
- 新增 `'leaves have a 0.5% apple chance'`：`chanceDropFor(BLOCK.LEAVES, () => 0.004)` → `'apple'`；`() => 0.006` → `null`；`chanceDropFor(BLOCK.STONE, () => 0)` → `null`。
- 新增 `'the apple chance is 0.5%'`：`expect(LEAF_APPLE_CHANCE).toBe(0.005)`。

`src/player/interact.test.ts`：
- 新增 `'breaking leaves can drop an apple'`：`spawnBlockDrop([], 'survival', BLOCK.LEAVES, { x: 1, y: 2, z: 3 }, null, () => 0.001)` → **剛好 1 筆** drop，且 `drops[0].item === 'apple'`（樹葉本體不掉，所以這 1 筆只能是蘋果）。
- 新增 `'breaking leaves usually drops nothing'`：同樣但 rng `() => 0.5` → **0 筆** drop（`expect(drops).toHaveLength(0)`）。
- 新增 `'creative mode never drops the lucky apple'`：`spawnBlockDrop([], 'creative', BLOCK.LEAVES, { x: 1, y: 2, z: 3 }, null, () => 0)` → 0 筆（機率掉落也受創造模式門檻約束）。
- 新增 `'the lucky apple does not replace the normal drop'`：`spawnBlockDrop([], 'survival', BLOCK.STONE, { x: 1, y: 2, z: 3 }, null, () => 0)` → 1 筆且 `item === 'cobblestone'`（石頭沒有機率掉落，既有案例不動）。
- 既有案例（石／鐵礦／泥土的掉落與門檻）不動。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/world/mob-drops.test.ts src/world/drops.test.ts src/player/interact.test.ts`
Expected: FAIL（模組與函式不存在）。

- [ ] **Step 3: 實作**

`src/world/mob-drops.ts`：
```ts
export interface MobDrop { item: ItemId; count: number }
/** kind → 掉落表（Java 1.20+）。rng 注入讓測試可重現。 */
export function rollMobDrops(kind, rng: () => number = Math.random): MobDrop[] {
  const range = (min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));
  const out: MobDrop[] = [];
  const push = (item: ItemId, count: number) => { if (count > 0) out.push({ item, count }); };
  switch (kind) {
    case 'zombie':   push('rotten_flesh', range(0, 2)); break;
    case 'skeleton': push('bone', range(0, 2)); push('arrow', range(0, 2)); break;
    case 'chicken':  push('raw_chicken', 1); push('feather', range(0, 2)); break;
    case 'pig':      push('raw_porkchop', range(1, 3)); break;
    case 'sheep':    push('raw_mutton', range(1, 2)); push('wool', 1); break;
    case 'cow':      push('raw_beef', range(1, 3)); push('leather', range(0, 2)); break;
  }
  return out;
}
```
（實作時照上表展開成真正的 `switch`，參數型別用 `MobDropKind`。）

`src/world/drops.ts`（**只放機率表**）：
- `LEAF_APPLE_CHANCE = 0.005`；`chanceDropFor(blockId, rng = Math.random)`：`if (blockId !== BLOCK.LEAVES) return null; return rng() < LEAF_APPLE_CHANCE ? 'apple' : null;`
- **不動 `dropItemFor`**（樹葉仍回 null）。

`src/player/interact.ts`（`spawnBlockDrop` 的現況位置；2026-10-20 稽核修正：機率落點必須排在 `!item` 的提前 return **之前**）：

```ts
export function spawnBlockDrop(
  drops: DropEntity[],
  mode: GameMode,
  blockId: number,
  pos: { x: number; y: number; z: number },
  held: ItemStack | null,
  rng: () => number = Math.random,
): DropEntity[] {
  if (mode === 'creative') return drops;      // 創造模式不產生任何掉落（含機率掉落）
  if (!canHarvest(blockId, held)) return drops; // 收穫門檻同樣管住機率掉落
  // 機率掉落先算：樹葉的 dropItemFor 是 null，若排在下面就永遠走不到
  const chance = chanceDropFor(blockId, rng);
  const withChance = chance ? spawnDrop(drops, chance, 1, pos) : drops;
  const item = dropItemFor(blockId);
  if (!item) return withChance;               // 樹葉：只有 0.5% 蘋果，沒有本體
  return spawnDrop(withChance, item, 1, pos);
}
```
- 順序：**一般掉落最後 append**，所以掉落的陣列順序是「機率掉落先、本體後」；兩者都走 `spawnDrop`（回傳新陣列），既有「沒有東西掉落時回同一參考」的契約不受影響（`chance` 與 `item` 都為 null／無時回傳 `drops` 本身）。
- 檔頭註解補一句：「機率掉落（樹葉 0.5% 蘋果）不受 `dropItemFor` 的 null 影響，但仍受創造模式與收穫門檻約束」。
- `src/main.ts` 的呼叫端（破壞方塊時）**不傳 rng** → 用預設 `Math.random`，行為不變；既有 `src/player/interact.test.ts` 的呼叫（5 個參數）也照樣可用（第六參數有預設值）。

`src/main.ts`（擊殺掉落區塊，現況約 L2099–2116）：
- 刪掉「殭屍必掉 1 顆蘋果」整段（含「guaranteed (not chance)」的註解）。
- 改成：
  ```ts
  if (currentMode === 'survival') {
    let spilled = false;
    for (const d of dead) {
      for (const drop of rollMobDrops(d.kind)) {
        drops = spawnDrop(drops, drop.item, drop.count, { x: d.pos.x, y: d.pos.y + 0.9, z: d.pos.z });
        spilled = true;
      }
    }
    if (spilled) bus.emit('drops-changed', {});
  }
  ```

- [ ] **Step 4: 跑測試轉綠**

Run: `npx vitest run src/world/mob-drops.test.ts src/world/drops.test.ts src/player/interact.test.ts` → PASS。

- [ ] **Step 5: 全量 gates**

Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 6: Commit**

```bash
git add src/world/mob-drops.ts src/world/mob-drops.test.ts src/world/drops.ts src/world/drops.test.ts \
  src/player/interact.ts src/player/interact.test.ts src/main.ts
git commit -m "feat(drops): B4.3 生物掉落表（殭屍腐肉／骷髏骨頭箭）與樹葉 0.5% 蘋果"
```
（commit 訊息補一行：機率掉落排在 `dropItemFor` 的 null 分支之前，`spawnBlockDrop` 留在 `src/player/interact.ts`。）

---

### Task 5: 敵對側對齊（生成距離／上限／despawn／速度／白天燃燒）＋ 生怪光照判準介面

**Files:**
- Create: `src/world/spawn-rules.ts`、`src/world/spawn-rules.test.ts`
- Modify: `src/world/mobs.ts`（常數、`Mob` 新欄位、`stepSunBurn`、`SpawnCtx` 改用光照）
- Modify: `src/world/mobs.test.ts`
- Modify: `src/main.ts`（`spawnTick` 傳光照、despawn 距離、燃燒步驟）

**Interfaces:**
- Consumes: `src/core/daynight.ts` 的 `phaseOf`、`Phase`。
- Produces（後續任務依賴）：
  - `src/world/spawn-rules.ts`：
    ```ts
    export interface SpawnLight { sky: number; block: number }   // 0..15
    export const PASSIVE_MIN_LIGHT = 9;      // 原版：被動生物需亮度 9+
    export const HOSTILE_MAX_SKY_LIGHT = 7;  // 原版：敵對需天空光 ≤ 7
    export function clockLight(t: number): SpawnLight;   // B4 近似（B6 換掉）
    export function isDaylight(t: number): boolean;      // phaseOf(t) === 'day'
    export function maxLight(light: SpawnLight): number;
    export function canSpawnPassive(light: SpawnLight): boolean;
    export function canSpawnHostile(light: SpawnLight): boolean;
    ```
  - `src/world/mobs.ts`：
    - 常數改寫：`SPAWN_MIN_DIST = 24`、`SPAWN_MAX_DIST = 128`、`DESPAWN_DISTANCE = 128`、`MAX_MOBS = 12`；`SKELETON_CHASE_SPEED = 3.5`（殭屍維持 3.2）。
    - `Mob` 新增兩個欄位：`burn: number`（燃燒剩餘秒數）、`burnAcc: number`（累積的燃燒傷害秒數）。
    - `export const SUN_BURN_SEC = 8;`（**旗標常數**：原版 Java 在日光直射時對不死系呼叫 `setSecondsOnFire(8)`——8 秒是「著火持續時間的旗標值」，**wiki 的 Zombie／Mob 頁查不到這個數字**（只寫燃燒的抑制條件與「日光直射下著火」）。2026-10-20 稽核修正：原計畫把它標成「已查證（wiki）」是錯的。實作上每幀只要仍在日光下就會把 `burn` 重設為 8 → 它其實是「正在燃燒」的旗標，**真正的死亡時間由 1 HP/s × 20 HP ≈ 20 秒決定**。）、`export const SUN_BURN_DPS = 1;`（燃燒中每秒 1 點血）。
    - `export interface SunBurnCtx { isDaylight: boolean; isSolidAt: (x, y, z) => boolean; isWaterAt: (x, y, z) => boolean; dt: number }`（**獨立於 `MobCtx`**——`stepMob` 不需要這兩個欄位，不動既有 `MobCtx` 就不會影響 `stepMobs` 的呼叫端）。
    - `export function stepSunBurn(m: Mob, ctx: SunBurnCtx): Mob`（純函式，回傳新 mob）。
    - `SpawnCtx` 的 `isNight: boolean` **改為** `light: SpawnLight`（生怪閘門改用光照判準）。

**已查證數值（wiki，2026-10-20）**：敵對生成距離 24–128 格（球面）、離玩家超過 128 格立即消失；被動生物需方塊亮度 9+（天空遮蔽時）；日光直射下不死系會著火、水中／遮蔽處不著火（**「著火 8 秒」查不到 wiki 出處 → 見 Interfaces 的說明：那是 Java 原始碼的旗標值**）；原版移動速度屬性：殭屍 0.23、骷髏 0.25（殭屍頁 infobox `speed = 0.23`；骷髏頁現行 infobox 已無 speed 欄，0.25 為 Java 基準值，見「實作時複核」）。

**設計決策（要寫進註解）**：
- **生怪判準集中到 `spawn-rules.ts`**：`SpawnLight` 是 B6 的替換接縫——B6 只需把 `clockLight(t)` 換成「真的去世界查天空光／方塊光」，`canSpawnPassive`／`canSpawnHostile` 與整條生怪排程都不用動。`clockLight` 的 B4 近似：白天 `{ sky: 15, block: 0 }`、夜晚 `{ sky: 0, block: 0 }`（因此被動生物只在白天生成、敵對只在夜晚生成，與 spec §B4.2／§B4.4 一致）。
- **速度**：只對齊**比例**——原版 0.25/0.23 ≈ 1.087；本作殭屍維持 3.2 格/秒（既有值），骷髏由 2.6 改為 3.5（3.2 × 1.087 ≈ 3.48）。絕對值低於原版（殭屍 4.6 格/秒）是本作既有的刻意簡化，寫進 README 差異清單。
- **白天燃燒的遮蔽判定**（spec §B4.4 指定的簡化）：**頭頂正上方那一格是實心方塊就不燃**（腳底 +2；含屋簷與樹冠葉片）；腳下格是水就不燃；不判斷天氣、不判斷頭盔。**（2026-10-22 審查修正：原敘述「頭頂格」指的是生物自己的頭格（殭屍腳底 0 時是 y=1、恆為空氣）→ 屋簷下的殭屍照樣被燒死。）**
- `Mob` 的 `burn`／`burnAcc` 只影響不死系（`kind === 'zombie' || kind === 'skeleton'`）；被動生物不會著火。

- [ ] **Step 1: 寫測試（失敗）**

`src/world/spawn-rules.test.ts`（新檔）：
- `'daylight is bright enough for passive mobs and too bright for hostiles'`：
  ```ts
  const day = clockLight(0.25);            // 正午
  expect(canSpawnPassive(day)).toBe(true);
  expect(canSpawnHostile(day)).toBe(false);
  ```
- `'nightlight is the opposite'`：`const night = clockLight(0.75); expect(canSpawnPassive(night)).toBe(false); expect(canSpawnHostile(night)).toBe(true);`
- `'the passive threshold is the vanilla light level 9'`：`expect(PASSIVE_MIN_LIGHT).toBe(9)`；`canSpawnPassive({ sky: 0, block: 9 })` → true；`canSpawnPassive({ sky: 8, block: 0 })` → false。
- `'hostile mobs need a dark sky and no block light'`：`canSpawnHostile({ sky: 7, block: 0 })` → true；`canSpawnHostile({ sky: 8, block: 0 })` → false；`canSpawnHostile({ sky: 0, block: 1 })` → false。
- `'isDaylight follows the day phase'`：`isDaylight(0.25)` → true；`isDaylight(0.75)` → false。

`src/world/mobs.test.ts`（既有測試要更新，理由寫在下面）：
- `'returns a candidate 24-128 blocks from the player (injected rng)'`：rng 恆 0.5 → 角度 π、距離 `24 + 0.5 × 104 = 76`；玩家在 `(10, 64, -5)` → 斷言 `spot.x ≈ 10`、`spot.z ≈ -81`（= -5 - 76），且 `Math.hypot(spot.x - 10, spot.z + 5) ≈ 76`（**改動理由**：spec §B4.4 生成距離改為 24–128）。
- `'stays inside the 24-128 band for any rng draw'`：改上下界。
- `trySpawnMob` 的 fixture：`ctxOf` 的 `isNight: true` 改成 `light: clockLight(0.75)`；`'never spawns in day'` 改成 `light: clockLight(0.25)` → null。
- 既有 `'spawns at night under the cap on a valid surface'` 的位置斷言要跟著改：rng 0.5、玩家在原點 → 生成點 z 由 `-18` 變 `-76`（新距離帶），`pos.y === 6` 不變（**改動理由**：距離常數改動的連帶更新）。
- `'never spawns once the cap is reached'`：`MAX_MOBS` 從 8 變 12（**改動理由**：spec §B4.4 上限 8→12）。
- 新增 `'the skeleton is faster than the zombie'`：`expect(SKELETON_CHASE_SPEED).toBeGreaterThan(ZOMBIE_CHASE_SPEED)`。
- 既有 `'chases within 16 blocks: state chase, moves toward the player at 3.2 b/s'` **不動**（殭屍速度沒變）。
- 既有骨架測試若寫死 2.6 b/s → 改 3.5（**改動理由**：速度比例對齊）。**四個斷言要逐一列出**（2026-10-20 稽核修正：原計畫只寫「若寫死 2.6 → 改 3.5」，漏了位置斷言 → 實作者只改速度就會留下紅燈）：
  | 位置（`src/world/mobs.test.ts`） | 既有斷言 | 改為 |
  |---|---|---|
  | L219 `'retreats when closer than 7 blocks'` | `expect(Math.hypot(out.vel.x, out.vel.z)).toBeCloseTo(2.6, 10)` | `toBeCloseTo(3.5, 10)` |
  | L221 同上 | `expect(out.pos.x).toBeCloseTo(-1.3, 10)` | `toBeCloseTo(-1.75, 10)`（3.5 × 0.5 秒） |
  | L228 `'approaches when farther than 9 blocks (within 16)'` | `expect(out.vel.x).toBeCloseTo(2.6, 10)` | `toBeCloseTo(3.5, 10)`（註解「slower than the zombie's 3.2」也要改掉） |
  | L229 同上 | `expect(out.pos.x).toBeCloseTo(1.3, 10)` | `toBeCloseTo(1.75, 10)` |
- 新增白天燃燒（表驅動，用獨立的 `sunCtxOf` helper：`{ isDaylight, isSolidAt, isWaterAt, dt }`）：
  - `'a zombie burns in direct sunlight under an open sky'`：`stepSunBurn(mob(), sunCtxOf({ isDaylight: true, dt: 1 }))` → `burn > 0`，且 hp 減少 1（1 秒燃燒＝1 點血）。
  - `'a zombie under a solid roof does not burn'`：`isSolidAt` 讓**屋簷格（頭頂正上方、腳底 +2；fixture 的腳底在 y = 0 → 屋簷在 y = 2）**為實心 → `burn === 0`、hp 不變。**（2026-10-22 審查修正：原敘述把屋簷放在 y = 1 ＝ 生物自己的頭格 → 那是不可達的幾何狀態，只證明「頭格有方塊時不燃」，證明不了「屋簷下不燃」。）**
  - （2026-10-22 審查補）`'a zombie with the roof one block higher still burns'`：屋簷在**再高一格**（腳底 +3 → y = 3）→ **會**燃燒（證明不是「上面任一格有方塊就不燃」）。
  - （2026-10-22 審查補）`'a zombie with a solid block in its own head cell does not burn'`：頭格（腳底 +1 → y = 1）本身實心 → 不燃（生物卡在方塊裡）。
  - （2026-10-22 審查補）`'the roof cell follows the head cell, not the raw feet height'`：腳底 6.9 → 頭格 = 8 → 屋簷在 9（這就是用 `head + 1` 而非 `floor(pos.y + 2)` 的理由）。
  - `'a zombie in water does not burn'`：`isWaterAt` 回 true → `burn === 0`。
  - `'a zombie at night does not burn'`：`isDaylight: false` → `burn === 0`。
  - `'burning stops when the sun goes down'`：先在白天燒 1 秒（burn > 0），再 `isDaylight: false` 步進 9 秒 → `burn === 0`。
  - `'a skeleton burns in daylight too'`：同殭屍案例。
  - 既有測試的 `mob()` fixture 要補 `burn: 0, burnAcc: 0` 兩個欄位（`Mob` 介面新增欄位；這是 fixture 補欄位，不是行為弱化）。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/world/spawn-rules.test.ts src/world/mobs.test.ts`
Expected: FAIL（新模組不存在；既有生成測試因常數未改而失敗）。

- [ ] **Step 3: 實作 `src/world/spawn-rules.ts`**

- `SpawnLight`、`PASSIVE_MIN_LIGHT = 9`、`HOSTILE_MAX_SKY_LIGHT = 7`。
- `clockLight(t)`：`const day = phaseOf(t) === 'day'; return { sky: day ? 15 : 0, block: 0 };`（檔頭註解寫明：**B4 的近似，B6 會換成真的光照查詢；規則本身是原版值，不改**）。
- `isDaylight(t)`：`phaseOf(t) === 'day'`。
- `maxLight(light)`：`Math.max(light.sky, light.block)`。
- `canSpawnPassive(light)`：`maxLight(light) >= PASSIVE_MIN_LIGHT`。
- `canSpawnHostile(light)`：`light.sky <= HOSTILE_MAX_SKY_LIGHT && light.block === 0`。

`src/world/mobs.ts`：
- 常數改寫（上表）；`SKELETON_CHASE_SPEED` 由 2.6 → 3.5，並在註解說明比例來源。
- `Mob` 介面加 `burn: number; burnAcc: number;`；`createMob` 初始化為 0。
- **`MobCtx` 不動**（2026-10-20 稽核修正：原計畫在這裡寫「`MobCtx` 加 `isDaylight`／`isWaterAt`」，與 Interfaces 的「`SunBurnCtx` 獨立於 `MobCtx`……不動既有 `MobCtx`」矛盾；照原文字會讓 `stepMobs` 的所有呼叫端（`main.ts`、`mobs.test.ts` 的每一個 `ctxOf`）型別錯誤）。**燃燒資訊只走 `SunBurnCtx`**，`MobCtx` 保持 `{ playerPos, isSolidAt, dt }`。
- `stepSunBurn(m, ctx)`（純函式）：
  ```
  const step = 有限且 > 0 的 dt，否則 0
  const head = Math.floor(m.pos.y + 1.9);           // 身體占到的最高格（殭屍＝頭格）
  const roofed = ctx.isSolidAt(floor(x), head, floor(z))
              || ctx.isSolidAt(floor(x), head + 1, floor(z));   // ← 屋簷在頭格「正上方」
  const inWater = ctx.isWaterAt(floor(x), floor(m.pos.y), floor(z));
  const burning = m.kind === 'zombie' || m.kind === 'skeleton';
  const exposed = ctx.isDaylight && !roofed && !inWater;
  let burn = exposed ? SUN_BURN_SEC : Math.max(0, m.burn - step);
  let hp = m.hp;
  if (burning && exposed) {
    let acc = m.burnAcc + step;
    const dealt = Math.floor(acc);                 // 每整秒 1 點血
    acc -= dealt;
    hp = Math.max(0, hp - dealt * SUN_BURN_DPS);
  } else { acc = 0 }
  return { ...m, burn, burnAcc: acc, hp };
  ```
  （`burnAcc` 只在燃燒中累積；熄火時歸零。）
  **2026-10-22 審查修正（屋簷遮蔽差一格）**：原公式只查 `head`（＝生物自己的頭格，
  殭屍腳底 0 時是 y=1、那一格在遊戲裡是空氣）→ **真正擋太陽的屋簷格（頭頂正上方、
  腳底 +2）從未被檢查** → 屋簷下的殭屍白天照樣被燒死，遮蔽條款形同虛設。改成
  「`head` **或** `head + 1` 是實心方塊就不燃」：保留 `head` 是因為頭格有方塊＝生物
  卡在方塊裡（也不點燃）；屋簷則在 `head + 1`（腳底 0 → 屋簷 y=2；腳底 6 → 屋簷 y=8）。
  用 `head + 1` 而不是 `Math.floor(m.pos.y + 2)`：後者在非整數腳底時會算錯（腳底 6.9
  → floor(8.9) = 8 ＝ 頭格）。
- `trySpawnMob` 的閘門：`if (!canSpawnHostile(ctx.light)) return null;`（取代 `if (!ctx.isNight) return null;`），`SpawnCtx` 改欄位。
- 檔頭註解補上「白天燃燒」與「生成距離 24–128／上限 12／despawn 128」的現況描述（舊註解寫著「no dayburn — distance only」，必須刪掉）。

`src/main.ts`：
- `spawnTick()`：`trySpawnMob(mobs, player.position, { light: clockLight(clock.t), isSolidAt: ..., blockIdAt: ... })`。
- 生物步驟區（現況 `src/main.ts` 第 1956–1958 行是 `const stepped = stepMobs(...); mobs = stepped.mobs; for (const ev of stepped.events) applyMobEvent(ev);`）：**必須保留事件的套用**，再疊上燃燒步驟（2026-10-20 稽核修正：原計畫寫 `mobs = stepMobs(...).mobs.map((m) => stepSunBurn(m, sunCtx))` —— **只取 `.mobs` 等於把 `stepped.events` 整包丟掉，殭屍近戰／骷髏射箭完全失效，怪物不會再攻擊玩家**）：
  ```ts
  const sunCtx = { isDaylight: isDaylight(clock.t), isSolidAt, isWaterAt, dt };
  const stepped = stepMobs(mobs, { playerPos: player.position, isSolidAt, dt });
  for (const ev of stepped.events) applyMobEvent(ev);   // ← 事件先套用（順序與現況相同）
  mobs = stepped.mobs.map((m) => stepSunBurn(m, sunCtx)); // ← 再算白天燃燒
  ```
  （`MobCtx` 不變，所以 `stepMobs` 的呼叫端不必改；事件→燃燒的先後順序與現況的 `stepMobs → applyMobEvent` 等價：先算 AI 與攻擊事件，再套用事件，最後才扣燃燒傷害。）
  **驗收**：批末人工步驟要加一條「白天把殭屍引到玩家身邊 → 殭屍仍會揮手造成傷害（不會因為本批的燃燒接線而停止攻擊）」。
- 死亡過濾（現況 `mobs.filter((m) => !isDead(m) && xzDistance(...) <= DESPAWN_DISTANCE)`）：被燒死的屍體（hp ≤ 0）也要走 `rollMobDrops` 灑掉落（生存模式）——玩家近戰擊殺的死亡在攻擊分支就已被移除，不會重複掉落。實作時把過濾改成先收集 `dead = mobs.filter(isDead)`、灑掉落，再保留其餘。
- `isWaterAt`：`world.getBlock(x, y, z) === BLOCK.WATER`。

- [ ] **Step 4: 跑測試轉綠**

Run: `npx vitest run src/world/spawn-rules.test.ts src/world/mobs.test.ts` → PASS。

- [ ] **Step 5: 全量 gates**

Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 6: Commit**

```bash
git add src/world/spawn-rules.ts src/world/spawn-rules.test.ts src/world/mobs.ts src/world/mobs.test.ts src/main.ts
git commit -m "feat(mobs): B4.4 敵對生成 24-128／上限 12／despawn 128／速度比例／白天燃燒"
```

---

### Task 6: 被動生物模型與 AI

**Files:**
- Create: `src/world/passive-mobs.ts`、`src/world/passive-mobs.test.ts`
- Modify: `src/world/raycast.ts`（新增 `rayAabbEntry`）
- Modify: `src/player/interact.ts`（改用 `rayAabbEntry`，刪掉私有 `rayBoxEntry`）
- Modify: `src/main.ts`（被動生物清單、步進、玩家攻擊可命中、擊殺掉落）

**Interfaces:**
- Consumes: Task 1 的物品 id；Task 4 的 `rollMobDrops`；Task 5 的 `SpawnLight`／`canSpawnPassive`。
- Produces:
  - `src/world/passive-mobs.ts`：
    ```ts
    export type PassiveKind = 'chicken' | 'pig' | 'sheep' | 'cow';
    export interface PassiveMobDef {
      kind: PassiveKind; hp: number; width: number; height: number;
      vanillaSpeed: number; speed: number;   // speed = 本作格/秒
    }
    export const PASSIVE_DEFS: Readonly<Record<PassiveKind, PassiveMobDef>>;
    export const MAX_PASSIVE_MOBS = 12;
    export interface PassiveMob {
      id: number; kind: PassiveKind; hp: number;
      width: number; height: number;
      pos: { x: number; y: number; z: number };
      vel: { x: number; y: number; z: number };
      yaw: number;             // 面向（弧度），停下時保留
      wanderDir: number; wanderTimer: number;
      panicTimer: number; panicDir: number;
    }
    export interface PassiveCtx {
      playerPos: { x: number; y: number; z: number };
      isSolidAt: (x: number, y: number, z: number) => boolean;
      isWaterAt: (x: number, y: number, z: number) => boolean;
      dt: number;
      rng?: () => number;
    }
    export function createPassiveMob(kind: PassiveKind, pos: {x;y;z}): PassiveMob;
    export function stepPassiveMob(m: PassiveMob, ctx: PassiveCtx): PassiveMob;
    export function stepPassiveMobs(mobs: readonly PassiveMob[], ctx: PassiveCtx): PassiveMob[];
    export function damagePassiveMob(m: PassiveMob, dmg: number, from?: {x:number;z:number}): PassiveMob;
    export function isPassiveDead(m: PassiveMob): boolean;
    export function hitPassiveMobId(mobs: readonly PassiveMob[], eye, lookDir, reach): number | null;
    export function attackPassiveMob(mobs: readonly PassiveMob[], eye, lookDir, reach, damage, knockDir): { mobs: PassiveMob[]; hitId: number | null };
    export function choosePassiveKind(rng?: () => number): PassiveKind;
    ```
  - `PassiveKind` 與 Task 4 的 `MobDropKind` 的被動分支是同一組字面量（TypeScript 結構相容）：`rollMobDrops(m.kind)` 不需轉型。若 reviewer 要求單一來源，可把 `PassiveKind` 的定義搬到 `mob-drops.ts` 再 re-export——不是必要變更。
  - `src/world/raycast.ts`：`export function rayAabbEntry(origin, dir, min, max): number | null`（由 `player/interact.ts` 的私有 `rayBoxEntry` 原樣搬出，行為不變）。

**已查證數值（wiki，2026-10-20）**：雞 4 血、0.7 高 × 0.4 寬、速度屬性 0.25；豬 10 血、0.9 × 0.9、0.25；羊 8 血、1.3 × 0.9、0.23；牛 10 血、1.4 × 0.9、0.2。

**設計決策（要寫進註解）**：
- **速度換算**：表內同時存 `vanillaSpeed`（原版屬性值，與 spec 表一致）與 `speed`（本作格/秒）。本作怪物一律比原版慢（既有殭屍 3.2 vs 原版 4.6），所以換算＝「保留原版比例、套用本作的慢速尺度」：牛最慢 1.5、羊 1.7、雞／豬 1.9 格/秒。panic 時乘 `PANIC_SPEED_MULTIPLIER = 1.4`。
- **漫遊**：每 2–4 秒換一個新方向（與既有敵對的 `WANDER_TURN_MIN/MAX` 同形）；被擋住就停下（不穿牆），撞到 1 格高的台階會跳上去（沿用 `MOB_GRAVITY = 32`、`JUMP_IMULSE = 8` 的物理慣例）。
- **panic**：受擊後 `panicTimer = 5` 秒，`panicDir` 為背離攻擊者的方向；panic 期間不重新漫遊、也不靠近玩家。
- **水中漂浮**：腳下格是水 → 不施加重力（`vel.y = 0`）、不下潛（不做落地吸附），水平移動照常。
- **不主動攻擊**：`stepPassiveMob` 不產生任何事件（沒有攻擊欄位）。
- **不摔傷**：本作生物本來就沒有摔傷機制（`fallDamage` 只用於玩家），所以「雞不摔傷」自然成立，不需額外程式碼（寫進註解說明）。

- [ ] **Step 1: 寫測試（失敗）**

`src/world/passive-mobs.test.ts`（新檔）：
- `'the passive table matches the vanilla stats'`（表驅動）：
  ```ts
  expect(PASSIVE_DEFS.chicken).toMatchObject({ hp: 4, width: 0.4, height: 0.7, vanillaSpeed: 0.25 });
  expect(PASSIVE_DEFS.pig).toMatchObject({ hp: 10, width: 0.9, height: 0.9, vanillaSpeed: 0.25 });
  expect(PASSIVE_DEFS.sheep).toMatchObject({ hp: 8, width: 0.9, height: 1.3, vanillaSpeed: 0.23 });
  expect(PASSIVE_DEFS.cow).toMatchObject({ hp: 10, width: 0.9, height: 1.4, vanillaSpeed: 0.2 });
  ```
- `'the speed order matches vanilla'`: `expect(PASSIVE_DEFS.chicken.speed).toBeGreaterThan(PASSIVE_DEFS.sheep.speed); expect(PASSIVE_DEFS.sheep.speed).toBeGreaterThan(PASSIVE_DEFS.cow.speed);`
- `'a wandering passive mob walks at its own speed'`：`createPassiveMob('cow', {x:0,y:0,z:0})`，把 `wanderDir` 固定為 0（＋z）、`wanderTimer` 給 10，`stepPassiveMob(m, ctx)`（dt 0.5、平地）→ `m.pos.z` ≈ `1.5 × 0.5 = 0.75`（`toBeCloseTo(0.75, 5)`）。
- `'a wandering mob turns after the timer expires'`：`wanderTimer = 0` 且注入固定 rng → 方向改變（斷言 `wanderDir` 與注入值一致）。
- `'a panicked mob flees away from the attacker'`：`damagePassiveMob(m, 1, { x: 10, z: 0 })` → `panicTimer === 5`；接著步進 0.5 秒 → `m.pos.x` **減少**（遠離 x=10 的攻擊者）。
- `'a damaged passive mob has less hp'`：`damagePassiveMob(m, 2)` → `hp` 減少 2；`damagePassiveMob(m, -1)` → hp 不變（NaN 防護）。
- `'a passive mob floats in water instead of sinking'`：`isWaterAt` 恆 true，步進 2 秒 → `m.pos.y` 不變、`m.vel.y === 0`。
- `'a passive mob steps up a one-block ledge'`：`isSolidAt` 在 x ≥ 1 的柱子上高 1 格 → 步進後 `pos.y` 上升。
- `'the crosshair hits a passive mob'`：`hitPassiveMobId([chicken], {x:0,y:0.3,z:5}, {x:0,y:0,z:-1}, 10)` → 雞的 id。
- `'the chicken is shorter than the cow'`：同一條射線高度 y=1.2 → 命中牛、未命中雞（`hitPassiveMobId([chicken, cow], ...)` 回傳牛的 id）。
- `'attacking reduces hp and reports the hit'`：`attackPassiveMob([pig], eye, dir, reach, 3, {x:0,z:-1})` → `hitId` 非 null、`mobs[0].hp` 減少 3。
- `'a dead passive mob is detected'`：`damagePassiveMob(m, 999)` → `isPassiveDead(m)` 為 true。
- `'non-finite dt is treated as 0'`：位置不變、無 NaN。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/world/passive-mobs.test.ts` → FAIL（模組不存在）。

- [ ] **Step 3: 實作**

`src/world/raycast.ts`：新增 `rayAabbEntry(origin, dir, min, max)`（把 `interact.ts` 的 `rayBoxEntry` 搬過來，註解一併搬）。
`src/player/interact.ts`：刪掉私有 `rayBoxEntry`，改 `import { rayAabbEntry } from '../world/raycast'` 並呼叫它（**行為不變**——既有 `interact.test.ts` 全部應照樣通過，這是搬移不是改寫）。

`src/world/passive-mobs.ts`：
- `PASSIVE_DEFS`（照 Step 1 的表 ＋ `speed`：chicken 1.9、pig 1.9、sheep 1.7、cow 1.5）。
- `createPassiveMob`：id 用模組層級遞增計數器（比照 `mobs.ts` 的 `nextMobId`）；`hp` 取定義值；`yaw = 0`；`wanderDir = rng()`（無 rng 時 `Math.random`）；`wanderTimer = 2 + rng() × 2`。
- `stepPassiveMob`：
  1. `step` = 有限正 dt，否則 0。
  2. `panicTimer -= step`（< 0 則歸 0）。
  3. 方向與速度：panic 中 → `panicDir` 與 `def.speed × 1.4`；否則 `wanderTimer <= 0` 時換方向（rng）→ `def.speed`。
  4. 前方探測：取 `pos + dir × (speed × step + 0.3)` 的格；腳底格（`pos.y + 0.1`）實心 → 停下並在著地時給 `JUMP_IMULSE`（跨 1 格台階）；頭頂格（`pos.y + def.height + 0.1`）實心 → 停下。
  5. 重力：腳下格是水 → `vel.y = 0`（漂浮）；否則 `vel.y -= 32 × step`，著地（`isSolidAt(x, floor(pos.y - 0.05), z)`）時歸零。
  6. 積分 `pos += vel × step`；落下時做與 `mobs.ts` 相同的「從前一格往下掃」的落地吸附（水中不做）。
  7. `yaw`：水平速度 > 0.01 時 `yaw = atan2(vel.x, vel.z)`。
  8. 回傳新物件（不改輸入）。
- `damagePassiveMob(m, dmg, from?)`：hp 夾在 0；`panicTimer = 5`；`panicDir` = `from` 存在時為 `atan2(m.pos.x - from.x, m.pos.z - from.z)`，否則為 `wanderDir + π`。
- `hitPassiveMobId` / `attackPassiveMob`：用 `rayAabbEntry`，命中盒 = `x ± width/2`、`y .. y + height`；`attackPassiveMob` 命中後呼叫 `damagePassiveMob`（並給一個沿視線方向的擊退：把 `vel` 沿著水平視線方向推 `KNOCKBACK_SPEED` 的 0.6 倍即可，實作時用既有 `mobs.ts` 的 `KNOCKBACK_SPEED = 6` 慣例）。

`src/main.ts`：
- 新增 `let passiveMobs: PassiveMob[] = [];`（與 `mobs` 並列）。
- 玩家攻擊：LMB 命中判斷先查敵對（既有 `hitMobId`），再查被動（`hitPassiveMobId`）；命中被動生物時走 `attackPassiveMob` → 扣血 → 若死亡則移除並（生存模式）`rollMobDrops` 灑掉落。
- 死亡過濾：每幀移除 `isPassiveDead` 的被動生物（被動生物**不 despawn**——不設距離過濾）。
- 被動生物**不進** `bus.emit('mobs-changed')`（那是敵對生物的計數事件；被動生物數量改由本批自己的事件或直接不發）。

- [ ] **Step 4: 跑測試轉綠**

Run: `npx vitest run src/world/passive-mobs.test.ts src/player/interact.test.ts` → PASS（`interact.test.ts` 必須**不需修改**就全綠——那是「搬移不改行為」的證明）。

- [ ] **Step 5: 全量 gates**

Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 6: Commit**

```bash
git add src/world/passive-mobs.ts src/world/passive-mobs.test.ts src/world/raycast.ts \
  src/player/interact.ts src/main.ts
git commit -m "feat(mobs): B4.1 雞豬羊牛模型與 AI（漫遊／panic／水中漂浮）"
```

---

### Task 7: 被動生物生成規則與統計測試

**Files:**
- Modify: `src/world/passive-mobs.ts`（`trySpawnPassiveGroup`、`choosePassiveKind`）
- Modify: `src/world/passive-mobs.test.ts`（統計測試）
- Modify: `src/main.ts`（被動生成排程）

**Interfaces:**
- Consumes: Task 5 的 `SpawnLight`／`canSpawnPassive`；`src/world/mobs.ts` 的 `surfaceYAt`；Task 6 的 `createPassiveMob`。
- Produces:
  - `export const PASSIVE_SPAWN_INTERVAL_SEC = 10;`
  - `export const PASSIVE_SPAWN_MIN_DIST = 24;`（spec §B4.2 的硬下限，測試門檻）
  - `export const PASSIVE_SPAWN_MAX_DIST = 48;`
  - `export const PASSIVE_SPAWN_MOTHER_MIN_DIST = 28;`（**母點**距離下限；2026-10-20 稽核修正：見下方「設計決策」的推導——母點若從 24 起算，成員偏移後會掉到 24 以下 → 與「離玩家 ≥24」的測試互相矛盾、會間歇性紅）
  - `export const PASSIVE_SPAWN_MIN_GROUP = 2;`
  - `export const PASSIVE_SPAWN_MAX_GROUP = 4;`
  - `export interface PassiveSpawnCtx { light: SpawnLight; isSolidAt; blockIdAt; rng?: () => number }`
  - `export function trySpawnPassiveGroup(mobs: readonly PassiveMob[], playerPos, ctx: PassiveSpawnCtx): PassiveMob[]`（成功回傳**新陣列**；未生成回傳**同一參考**）。

**已查證數值（wiki，2026-10-20）**：被動生物需方塊亮度 9+（天空遮蔽時）；生成在草方塊上、需至少 2 格空間；生成群 2–4（Bedrock）／4（Java）；生成點與玩家的距離由模擬距離決定（24–128）；原版被動生物**不會**自然消失（despawn 只針對怪物／環境／水生類）。

**設計決策（要寫進註解）**：
- 「亮度 9+」在 B4 以 `canSpawnPassive(clockLight(t))` 近似＝「日光下」；夜間 `clockLight` 的 sky = 0 → 不生成 ✓（spec §B4.2 明示這是簡化，B6 換成真光照）。
- 生成點距離：spec 只給下限 ≥24；上限取 **48**（世界半徑有限，遠處生成的動物玩家走不到；B6 可調）。
- **母點距離 28–48，成員偏移 ±2 格**（2026-10-20 稽核修正）：原計畫寫「母點 `dist = 24 + rng() × 24`（24–48）、成員偏移 ±2」→ 母點可能落在 24，偏移對角（±2, ±2）的位移是 `√(2²+2²) ≈ 2.83` → 成員實際距離可落到 `24 − 2.83 ≈ 21.2 < 24`，與同計畫的測試 `'every spawned passive mob is at least 24 blocks from the player'`（跑 50 次）**互相矛盾、會間歇性紅**。本批把**母點**距離改成 `28 + rng() × 20`（28–48），最壞情況 `28 − 2.83 ≈ 25.2 ≥ 24` → 測試與實作自洽。兩者的界線要分清楚：
  - `PASSIVE_SPAWN_MIN_DIST = 24`＝**spec 的硬下限**（成員實際距離的下界，測試門檻）。
  - `PASSIVE_SPAWN_MOTHER_MIN_DIST = 28`＝**母點距離的下界**（含 ±2 偏移後仍 ≥ 24 的保證值）。
  - 偏移是「母點附近 ±2 格內隨機取位」→ 用 `rng()` 各抽 x／z 兩個偏移，值域 `[-2, 2]`。
- 地面只接受 `BLOCK.GRASS` 與 `BLOCK.DIRT`（spec §B4.2「草地／泥土」）。
- 上方空間：以 `Math.ceil(def.height)` 格為準（雞／豬 1 格、羊／牛 2 格）——原版是「至少兩格空間」，但雞只有 0.7 高不需要 2 格；用高度推導比較合理，寫進註解。
- 群組成員：一次生成 2–4 隻同一種類；每隻在母點附近 ±2 格內隨機取位，取位失敗（地面不對／空間不足）就跳過該隻（群可以少於 2 隻）。
- 總量上限 `MAX_PASSIVE_MOBS = 12`：達上限時不再生成（spawn 回同一參考）。
- 被動生物**不 despawn**（spec §B4.2；原版被動生物也不會自然消失）。

- [ ] **Step 1: 寫測試（失敗）**

`src/world/passive-mobs.test.ts` 新增段落（統計測試，固定 rng 種子）：
- 測試用假世界：`isSolidAt = (_x, y, _z) => y <= 5`（地表在 y=5，腳底 y=6）、`blockIdAt = () => BLOCK.GRASS`。
- `'passive mobs spawn in daylight on grass'`：
  ```ts
  const out = trySpawnPassiveGroup([], { x: 0, y: 6, z: 0 }, { light: clockLight(0.25), isSolidAt, blockIdAt, rng: seeded(1) });
  expect(out.length).toBeGreaterThanOrEqual(2);
  expect(out.length).toBeLessThanOrEqual(4);
  ```
- `'no passive mob spawns at night'`：`light: clockLight(0.75)` → 回傳**同一參考**（`expect(out).toBe(input)`）。
- `'every spawned passive mob is at least 24 blocks from the player'`：跑 50 次生成，逐一斷言 `xzDistance(m.pos, player) >= 24`（`xzDistance` 用 `src/world/mobs.ts` 的既有函式）。**這個門檻與母點 28–48 的實作是同一組數字**（2026-10-20 稽核修正：見「設計決策」的推導；最壞情況 `28 − √(2²+2²) ≈ 25.2`）。
- 新增 `'the mother point is 28 blocks or more away (so members stay ≥ 24)'`：斷言母點距離本身 `>= PASSIVE_SPAWN_MOTHER_MIN_DIST`（28），把兩條規則釘在一起。
- `'a spawn group holds 2 to 4 mobs'`：跑 100 次，斷言每次新增的數量 ∈ [2, 4]。
- `'the passive cap is 12'`：先塞 12 隻 → `trySpawnPassiveGroup` 回同一參考；塞 11 隻 → 會生成（變 12+）。
- `'no passive mob spawns on sand or stone'`：`blockIdAt` 回 `BLOCK.SAND` → 同一參考。
- `'no passive mob spawns under a low ceiling'`：`isSolidAt` 在地表上方一格也是實心 → 同一參考。
- `'the spawned kinds are all one of the four'`：跑 100 次，斷言每一隻的 `kind` ∈ {chicken, pig, sheep, cow}。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/world/passive-mobs.test.ts` → FAIL（函式不存在）。

- [ ] **Step 3: 實作**

`src/world/passive-mobs.ts`：
- `choosePassiveKind(rng = Math.random)`：四種等機率（`['chicken','pig','sheep','cow'][Math.floor(rng() * 4)]`）——原版依生態加權，本批簡化為等機率（寫進註解，B3 的 8 生態落地後可再調）。
- `trySpawnPassiveGroup(mobs, playerPos, ctx)`：
  1. `if (!canSpawnPassive(ctx.light)) return mobs;`（同一參考）
  2. `if (mobs.length >= MAX_PASSIVE_MOBS) return mobs;`
  3. 取母點：`angle = rng() × 2π`、`dist = PASSIVE_SPAWN_MOTHER_MIN_DIST + rng() × (PASSIVE_SPAWN_MAX_DIST − PASSIVE_SPAWN_MOTHER_MIN_DIST)` → **28–48**（2026-10-20 稽核修正：原為 `24 + rng() × 24`，會讓成員掉到 24 以下）。
  4. `surfaceYAt(x, z, ctx.isSolidAt, ctx.blockIdAt)` → null 就回同一參考。
  5. 地面檢查：`ctx.blockIdAt(floor(x), y - 1, floor(z))` 必須是 `BLOCK.GRASS` 或 `BLOCK.DIRT`。
  6. 群數：`2 + Math.floor(rng() × 3)` → 2..4；種類 `choosePassiveKind(rng)`。
  7. 對每隻成員：在母點附近取位（`dx = rng() × 4 − 2`、`dz = rng() × 4 − 2`，值域 ±2）→ 重做地表／地面／空間檢查 → 通過才 `createPassiveMob`。
  8. 回傳 `[...mobs, ...created]`（有新增才新陣列，否則同一參考）。

`src/main.ts`：
- 新增 `let passiveSpawnAcc = 0;`；每幀（`state === 'playing'` 的尾段，與既有 5 秒的敵對生成排程並列）：
  ```ts
  passiveSpawnAcc += dt;
  if (passiveSpawnAcc >= PASSIVE_SPAWN_INTERVAL_SEC) {
    passiveSpawnAcc = 0;
    passiveMobs = trySpawnPassiveGroup(passiveMobs, player.position, {
      light: clockLight(clock.t),
      isSolidAt: (x, y, z) => world.isSolid(x, y, z),
      blockIdAt: (x, y, z) => world.getBlock(x, y, z),
    });
  }
  ```

- [ ] **Step 4: 跑測試轉綠**

Run: `npx vitest run src/world/passive-mobs.test.ts` → PASS。

- [ ] **Step 5: 全量 gates**

Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 6: Commit**

```bash
git add src/world/passive-mobs.ts src/world/passive-mobs.test.ts src/main.ts
git commit -m "feat(spawn): B4.2 被動生物白天生成規則（離玩家 ≥24／成群 2-4／上限 12／不 despawn）"
```

---

### Task 8: 被動生物渲染

**Files:**
- Create: `src/render/passive-mobs.ts`、`src/render/passive-mobs.test.ts`
- Modify: `src/main.ts`（建立 renderer、每幀同步）

**Interfaces:**
- Consumes: Task 6 的 `PassiveMob`／`PASSIVE_DEFS`。
- Produces:
  ```ts
  export interface PassiveMobRenderer {
    syncPassiveMobs(mobs: readonly PassiveMob[], dt: number): void;
    flashPassiveMob(id: number): void;
    dispose(): void;
  }
  export function createPassiveMobRenderer(scene: THREE.Scene): PassiveMobRenderer;
  ```

**設計決策（要寫進註解）**：
- 每種動物用「方塊身 + 頭 + 兩條腿」的簡化模型（比照 `render/scene.ts` 的 `createMobRenderer` 寫法，但形狀依種類不同）：雞＝小白身＋紅冠＋黃喙；豬＝粉身＋深色豬鼻；羊＝白身（蓬鬆＝身體高一點）＋灰臉；牛＝棕身＋白斑＋深色角。
- 體型直接用 `PASSIVE_DEFS` 的 `width`／`height`（所以牛比雞大、羊比豬高），這同時讓玩家的瞄準判斷與視覺一致。
- 走路擺動沿用 `createMobRenderer` 的做法（`phase += hSpeed × dt × 4`，`swing = sin(phase) × 0.6`），停下時擺動衰減歸零。
- 受擊閃白 0.1 秒（與敵對一致）。

- [ ] **Step 1: 寫測試（失敗）**

`src/render/passive-mobs.test.ts`（新檔，比照 `src/render/scene.test.ts` 的 jsdom + THREE 做法）：
- `'creates a blocky group per passive mob'`：`syncPassiveMobs([chicken], 0.016)` → `scene.children` 長度 1、group 名稱 `passive:chicken`、內含 `head`／`body`／`legL`／`legR` 四個具名節點。
- `'the cow is bigger than the chicken'`：雞的 group 高度（`body` 方塊的 `scale.y` 或 group 的 `position`）小於牛；斷言牛 group 的 `scale.y` > 雞 group 的 `scale.y`。
- `'moves an existing mob without rebuilding'`：同一 id 換位置 → `scene.children` 仍 1、位置更新。
- `'removes the group when the mob disappears'`。
- `'white-flashes a passive mob on hit'`：`flashPassiveMob(id)` → 頭部材質的 `emissive.getHex()` 變 `0xffffff`，0.1 秒後回到 `0x000000`。
- `'treats non-finite dt as 0'`。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/render/passive-mobs.test.ts` → FAIL（模組不存在）。

- [ ] **Step 3: 實作 `src/render/passive-mobs.ts`**

- 比照 `render/scene.ts` 的 `createMobRenderer` 結構：共用 unit geometry、每隻生物一份材質（為了單獨閃白）、id-keyed 快取、`dispose()` 釋放。
- `buildPassiveMob(kind)`：依 `PASSIVE_DEFS` 的 `width`／`height` 決定 body/head/leg 的尺寸與位置。
- `syncPassiveMobs(list, dt)`：建立／更新／移除＋走路擺動＋閃白倒數。
- `flashPassiveMob(id)`。

`src/main.ts`：
- `const passiveRenderer = createPassiveMobRenderer(gs.scene);`
- 渲染尾段（既有 `mobRenderer.syncMobs(...)` 旁邊）：`passiveRenderer.syncPassiveMobs(passiveMobs, state === 'playing' ? dt : 0);`
- 玩家命中被動生物時呼叫 `passiveRenderer.flashPassiveMob(id)`。

- [ ] **Step 4: 跑測試轉綠**

Run: `npx vitest run src/render/passive-mobs.test.ts` → PASS。

- [ ] **Step 5: 全量 gates**

Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 6: Commit**

```bash
git add src/render/passive-mobs.ts src/render/passive-mobs.test.ts src/main.ts
git commit -m "feat(render): B4.1 雞豬羊牛方塊模型渲染"
```

---

### Task 9: 進食互動——按住右鍵 1.6 秒

**Files:**
- **不動 `src/player/input.ts`**（2026-10-20 終審修正：`InputState.placeHeld` 的**所有權在 B2（0.5.0）**——欄位宣告、`onMouseDown`／`onMouseUp` 的設旗標、`clearActive()` 的清除都已由 B2 完成。**本批只消費 `input.state.placeHeld`，不得重新宣告欄位、不得再寫一次設旗標的程式碼**；否則 B2 先合併時本批會撞 TS duplicate identifier、B4 先合併時 B2 會撞號。）
- **不動 `src/player/input.test.ts`**（B2 已有旗標本身的測試：`'the right mouse button sets placeHeld until released'`、`'losing pointer lock clears placeHeld and dropHeld'`——**本批不得重複新增同名測試**；旗標語意的守門歸 B2。）
- Modify: `src/player/eat.ts`（新增 `eatTick` 純邏輯：把「右鍵是否仍按住」與進度綁在一起）
- Modify: `src/player/eat.test.ts`
- Create: `src/ui/eat-progress.ts`、`src/ui/eat-progress.test.ts`（可選的進度條；不影響規則）
- Modify: `src/main.ts`（進食接線；只**讀取** `input.state.placeHeld`）
- Test: `src/player/eat.test.ts`、`src/ui/eat-progress.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `foodFor`／`canEat`／`eatFromSlot`／`EatProgress`／`EAT_TIME_SEC`；`src/player/survival.ts` 的 `eat`；**B2（0.5.0）的 `input.state.placeHeld`（唯讀）**。
- Produces:
  - `src/player/eat.ts`（本任務新增，2026-10-20 終審修正：原本這裡寫的是「`src/player/input.ts`：`InputState` 新增 `placeHeld: boolean`」＝搶 B2 的所有權，已改為本批自有的純邏輯函式）：
    ```ts
    /** 每幀推進進食狀態。`held` ＝ 右鍵目前是否仍按住（由呼叫端從
     *  `input.state.placeHeld` 讀入——旗標欄位由 B2 擁有，本模組不碰輸入層）。
     *  放開右鍵 → 進度歸零（回 'idle'）；按住且 allowed → 累積；
     *  累積滿 EAT_TIME_SEC → 回 'eaten'（呼叫端才扣物品）。 */
    export function eatTick(
      progress: EatProgress,
      opts: { held: boolean; item: ItemId | null; allowed: boolean; dtSec: number },
    ): 'idle' | 'eating' | 'eaten';
    ```
    既有 `state.place`（單擊脈衝）**維持原語意不變**。
  - `src/ui/eat-progress.ts`：`export function createEatProgress(uiRoot: HTMLElement): { show(fraction: number): void; hide(): void }`（0..1 進度；`show` 會建立一個 `.eat-progress` 節點並設定寬度）。

**設計決策（要寫進註解）**：
- **「按住」的語意放在本批自有的純邏輯裡（`eatTick`），旗標欄位留在 B2**（2026-10-20 終審修正）：這樣「按住右鍵才吃東西」這條規則可以被單元測試釘死（`eatTick` 是純函式），而不需要動 B2 擁有的輸入層；`main.ts` 只負責把 `input.state.placeHeld` 讀進來餵給它。
- **脈衝與按住分開**：`state.place` 是「右鍵被按下過一次」的單擊脈衝（放置方塊、開工作台都靠它）；`placeHeld` 是「右鍵目前還按著」。進食用 `placeHeld` 累積時間，放置仍用脈衝——兩者不互相吃掉。
- 按住右鍵期間若玩家切換手上的物品，`EatProgress` 會自動重算（Task 2 已實作：換物品 → 進度歸零）。
- 滿飢餓時 `canEat` 為 false → 不開始進食（也不消耗物品）。
- 進食完成後：扣 1 個食物、`eat(v, food, saturation)` 套用到 vitals、播放音效（沿用 `audio.play('place', 'grass')` 的軟 thud，見註解）、觸發 `applyAdvancement({ type: 'ate', item, mode })`（`tasty` 只在吃蘋果時解鎖——`advancements.ts` 既有邏輯不變）。
- 進度條是加分項：規則測試不依賴它；若時間不夠可整個省略（此時把 `src/ui/eat-progress.ts` 與其測試從本任務移除，並在 Task 12 的發布說明記錄「進食無進度條回饋」）。

- [ ] **Step 1: 寫測試（失敗）**

`src/player/eat.test.ts`（**只新增案例；Task 2 已建立的既有案例不動**）：
- `'holding the right button accumulates the eat progress'`：
  ```ts
  const p = new EatProgress();
  expect(eatTick(p, { held: true, item: 'apple', allowed: true, dtSec: 1.0 })).toBe('eating');
  expect(p.elapsed).toBeCloseTo(1.0, 6);
  ```
- `'releasing the right button resets the progress'`：
  ```ts
  const p = new EatProgress();
  eatTick(p, { held: true, item: 'apple', allowed: true, dtSec: 1.0 });
  expect(eatTick(p, { held: false, item: 'apple', allowed: true, dtSec: 0.016 })).toBe('idle');
  expect(p.elapsed).toBe(0);
  ```
- `'a full hold of 1.6 s completes the eat'`：
  ```ts
  const p = new EatProgress();
  expect(eatTick(p, { held: true, item: 'apple', allowed: true, dtSec: 1.6 })).toBe('eaten');
  ```
- `'a short hold never completes the eat'`：`dtSec: 1.59` → `'eating'`；再 `dtSec: 0.005` → 仍 `'eating'`（累計 1.595 < 1.6）；再 `dtSec: 0.005` → `'eaten'`（累計 1.600 ≥ 1.6）。
- `'not holding never eats even with a valid food'`：`held: false`、`dtSec: 5` → `'idle'`、`p.elapsed === 0`。
- `'a disallowed item never eats even while holding'`：`held: true`、`allowed: false` → `'idle'`、`p.elapsed === 0`。

`src/ui/eat-progress.test.ts`（新檔，jsdom）：
- `'show mounts one progress bar and hide removes it'`：`show(0.5)` → `uiRoot.querySelector('.eat-progress')` 非 null；`hide()` → null。
- `'show updates the width instead of remounting'`：連續兩次 `show` → 仍只有 1 個節點。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/player/eat.test.ts src/ui/eat-progress.test.ts`
Expected: FAIL（`eatTick` 尚不存在／`src/ui/eat-progress.ts` 尚未建立）。

- [ ] **Step 3: 實作**

`src/player/eat.ts`（本批自有的純邏輯；**不動 `src/player/input.ts`**）：
- 新增 `eatTick`（簽名見上）：
  ```ts
  export function eatTick(
    progress: EatProgress,
    opts: { held: boolean; item: ItemId | null; allowed: boolean; dtSec: number },
  ): 'idle' | 'eating' | 'eaten' {
    if (!opts.held) { progress.reset(); return 'idle'; }
    return progress.update(opts.dtSec, opts.item, opts.allowed);
  }
  ```
  （`held` 為 false 時直接 `reset()` 並回 `'idle'`——放開右鍵＝進度歸零；`held` 為 true 時交給 Task 2 已實作的 `EatProgress.update`（它自己處理 `allowed`／換物品／非有限 dt）。）

  **（2026-10-20 終審修正：原計畫在這裡還有一條 `clearActive()`：`state.placeHeld = false;`——那也是 B2 的旗標邏輯，**本批不得改 `src/player/input.ts`**（B2 的 `clearActive()` 已經會清 `placeHeld`）。本批只在 `main.ts` 讀它。）

`src/ui/eat-progress.ts`（可選）：建立 `div.eat-progress`（內含一條 `div.eat-progress-fill`），`show(fraction)` 設定 fill 寬度 `${clamp(fraction,0,1) * 100}%`，`hide()` 移除。

`src/main.ts`：
- 新增 `const eatProgress = new EatProgress();`（與 `dig` 等同層級的模組變數）。
- **刪掉舊的「右鍵脈衝即吃」整段**（2026-10-20 稽核修正：原計畫只在前面插入新分支、沒說舊段要刪 → 「快速右鍵立刻吃掉」會被保留，直接違反 spec §B4.3「進食需按住右鍵約 1.6 秒」與 Review Focus #3）。現況 `src/main.ts` 第 2253–2269 行的 `else` 段同時含「吃蘋果」與「放置方塊」：
  ```ts
  } else {
    // Task 8: eat one apple — raycast miss OR a non-interactive face
    // while holding an apple. …
    const v = currentMode === 'survival' ? vitals : null;
    const eaten = v !== null ? eatFromSlot(hotbar, selected) : null;
    if (v !== null && eaten?.ate) {
      inventory.setSlot(selected, eaten.slots[selected] ?? null);
      setVitals(eat(v, APPLE_FOOD, APPLE_SAT));
      hud.setHotbar(hotbar, selected);
      audio.play('place', 'grass', { pos: player.position });
      applyAdvancement({ type: 'ate', item: 'apple', mode: currentMode });
    } else if (hit) {
      /* 放置邏輯 */
    }
  }
  ```
  **整段刪除**（含「Full hunger still eats（溢出浪費，Minecraft parity）」的註解），改成：
  ```ts
  } else if (currentMode === 'survival' && vitals && heldIsFood()) {
    // 進入進食模式：右鍵按住期間由每幀的 EatProgress 推進（不吃脈衝）
    eatProgress.reset();
  } else if (hit) {
    /* 既有放置邏輯（viewmodel.startSwing → placeTarget → spendFromSlot → setBlock） */
  }
  ```
  （`heldIsFood()` = `foodFor(hotbar[selected]?.item ?? 'stone') !== null`。）
  **刪除舊段後 `src/main.ts` 第 55 行的 `import { APPLE_FOOD, APPLE_SAT, eatFromSlot } from './player/eat'` 要改成只 import 還在用的東西**（`eatFromSlot` 仍用於每幀的進食完成路徑；`APPLE_FOOD`／`APPLE_SAT` 不再被 main.ts 使用 → **必須移除**，否則 `npm run lint` 的未使用 import 會紅）。`src/player/eat.ts` 本身**仍保留** `APPLE_FOOD`／`APPLE_SAT` 兩個匯出（既有 `src/player/eat.test.ts` 依賴它們，見 Task 2）。
- 每幀（`state === 'playing'` 區塊內，放在放置邏輯之後）——**2026-10-20 終審修正：改用 Task 9 自有的 `eatTick`，`placeHeld` 只被「讀取」（B2 的欄位，本批不改它）**：
  ```ts
  const held = hotbar[selected];
  const item = held ? held.item : null;
  const allowed = currentMode === 'survival' && vitals !== null && item !== null &&
    canEat(vitals, item);
  const r = eatTick(eatProgress, {
    held: input.state.placeHeld,   // ← B2（0.5.0）擁有的欄位，本批只讀
    item,
    allowed,
    dtSec: dt,
  });
  if (r === 'eaten' && vitals && item) {
    const f = foodFor(item);
    const eaten = eatFromSlot(hotbar, selected);
    if (eaten.ate && f) {
      inventory.setSlot(selected, eaten.slots[selected] ?? null);
      setVitals(eat(vitals, f.food, f.saturation));
      hud.setHotbar(hotbar, selected);
      audio.play('place', 'grass', { pos: player.position }); // 沿用軟 thud
      applyAdvancement({ type: 'ate', item, mode: currentMode });
    }
  }
  ```
  （`eatTick` 在 `held` 為 false 時會自行 `reset()` 並回 `'idle'` → 放開右鍵＝進度歸零，這條語意由 Task 9 Step 1 的單元測試釘死，不靠 `main.ts` 的分支。）
- 進度條（可選）：`eatProgress.elapsed / EAT_TIME_SEC` 餵給 `eatProgressUi.show(...)`；`reset` 時 `hide()`。

- [ ] **Step 4: 跑測試轉綠**

Run: `npx vitest run src/player/eat.test.ts src/ui/eat-progress.test.ts` → PASS（`src/player/input.test.ts` **不動**——旗標語意的守門在 B2；本批只新增 `eat.test.ts` 的案例）。

- [ ] **Step 5: 全量 gates**

Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 6: 人工驗收（記錄結果）**

`npm run dev` → 生存模式手持生豬肉 → **快速點一下右鍵**（不到 1.6 秒）：物品不應減少、也不應觸發進食；**按住右鍵 1.6 秒以上**：物品 −1、飢餓 +3、飽食 +1.8。滿飢餓（20/20）時按住右鍵：不應消耗物品。

- [ ] **Step 7: Commit**

```bash
git add src/player/eat.ts src/player/eat.test.ts src/ui/eat-progress.ts src/ui/eat-progress.test.ts src/main.ts
git commit -m "feat(eat): B4.3 進食改為按住右鍵 1.6 秒（滿飢餓不可進食；沿用 B2 的 InputState.placeHeld，本批不動 input.ts）"
```
（**2026-10-20 終審修正**：commit 的檔案清單**不含** `src/player/input.ts`／`src/player/input.test.ts`——本批不改它們。）

---

### Task 10: 被動生物跨存檔（附加欄位 `passiveMobs`）

**Files:**
- Create: `src/world/passive-save.ts`、`src/world/passive-save.test.ts`
- Modify: `src/world/save.ts`（本機 payload v3 ＋可選欄位）
- Modify: `src/world/save.test.ts`
- Modify: `src/core/cloud-save.ts`（雲端 format 1 ＋可選欄位）
- Modify: `src/core/cloud-save.test.ts`
- Modify: `src/main.ts`（存／讀接線）

**Interfaces:**
- Consumes: Task 6 的 `PassiveMob`／`PassiveKind`／`PASSIVE_DEFS`／`createPassiveMob`／`MAX_PASSIVE_MOBS`。
- Produces:
  - `src/world/passive-save.ts`：
    ```ts
    export interface PassiveMobRecord { kind: PassiveKind; x: number; y: number; z: number; hp: number; yaw: number }
    export function serializePassiveMobs(mobs: readonly PassiveMob[]): PassiveMobRecord[];
    export function normalizePassiveMobs(raw: unknown): PassiveMobRecord[];   // 逐筆驗證＋上限
    export function restorePassiveMobs(records: readonly PassiveMobRecord[]): PassiveMob[];
    ```
  - `src/world/save.ts`：`SavePayloadV3` 加 `passiveMobs?: PassiveMobRecord[]`；`SaveSources` 加 `passiveMobs: readonly PassiveMob[]`；`collectSavePayload` 寫入 `passiveMobs`；`loadGame` **一律回傳** `passiveMobs`（正規化後的陣列；舊檔缺欄位 → `[]`）。**payload 版本仍是 3**。
  - `src/core/cloud-save.ts`：`CloudData` 加 `passiveMobs?: PassiveMobRecord[]`；`CloudBuildSource` 加 `passiveMobs: readonly PassiveMob[]`；`validateCloudData` 允許缺省或陣列；`acceptCloudData` 正規化後一律回傳陣列。**`CLOUD_FORMAT_VERSION` 仍是 1**，`game.json` 的 `cloudSave` 不動。

**持久化格式決策（本批的設計主軸）**：
- **欄位**：每隻被動生物一筆 `{ kind, x, y, z, hp, yaw }`（種類、座標、血量、朝向——spec §B4.6 的「朝向視需要」採「要」，因為停下時的面向是唯一能還原的姿態資訊）。`width`／`height` **不存**（由 `kind` 推導，避免存檔與定義表不同步）。
- **驗證失敗處理：丟棄該筆，不丟整包**。理由：與 B1 的 `sanitizeStack`／`normalizeModeStash` 同一風格——一筆壞的紀錄不該讓整份存檔變成「無存檔」。因此：
  - 未知 `kind` → 丟棄該筆。
  - 座標非有限數 → 丟棄該筆。
  - `hp` 非有限數或 ≤ 0 → 丟棄該筆（死掉的生物不該被還原）。
  - `hp` 超過該種類的最大血量 → 夾到上限（雞 4／羊 8／豬牛 10）。
  - 整包不是陣列 → 回 `[]`。
- **數量上限**：`MAX_PASSIVE_MOBS = 12`（與生成上限同一個常數）。超過 12 筆時 **只保留前 12 筆**（其餘丟棄），並在載入後不再生成新的（生成器看到 12 隻就不會再生成）。
- **舊存檔**：v3 舊記錄沒有 `passiveMobs` → 載入得 `[]`（＝沒有生物）；雲端 format 1 舊 payload 同理。**不整包拒絕、不報錯**。
- **載入路徑「一鍵回傳 `passiveMobs`」的取捨**（2026-10-20 稽核修正）：`loadGame` 一律回傳 `passiveMobs`（正規化後）→ 呼叫端不需要處理「有沒有這個鍵」。但代價是：**既有 v1／v2 遷移測試的 `toEqual` 會因為多出一個 `passiveMobs: []` 鍵而紅**。本批採「**一律回傳 鍵 ＋ 明列那兩個測試要怎麼改**」的方案（而不是 B3 對 `worldgenVersion` 用的「有才帶鍵」）——理由：`SavePayload` 的回傳型別固定帶這個鍵，`main.ts` 的 `continueGame` 就不必寫 `payload.passiveMobs ? ... : []` 的分支；而且那兩個測試只是**把預期值補上一個鍵**，斷言強度不減反增（多了「新欄位必須是空陣列」這條）。
- **與 B3 的 `worldgenVersion` 互不干擾**：兩個欄位都是 v3／format 1 上的可選附加欄位，各自獨立正規化。B4 不碰 `worldgenVersion`，也不讀「地形已改變」提示的狀態。
- **敵對維持每場重來**：`mobs`（殭屍／骷髏）照舊不存檔。

- [ ] **Step 1: 寫測試（失敗）**

`src/world/passive-save.test.ts`（新檔）：
- `'serialize copies kind, position, hp and yaw'`：`serializePassiveMobs([cow])` → `[{ kind: 'cow', x: .., y: .., z: .., hp: 10, yaw: .. }]`（深拷貝：改回傳物件不影響原 mob）。
- `'a corrupt record is dropped but the rest survive'`：
  ```ts
  const raw = [
    { kind: 'cow', x: 1, y: 2, z: 3, hp: 10, yaw: 0 },
    { kind: 'dragon', x: 1, y: 2, z: 3, hp: 10, yaw: 0 },   // 未知種類
    { kind: 'pig', x: Number.NaN, y: 2, z: 3, hp: 10, yaw: 0 }, // 壞座標
    { kind: 'pig', x: 1, y: 2, z: 3, hp: 0, yaw: 0 },      // 死掉的生物
  ];
  expect(normalizePassiveMobs(raw)).toHaveLength(1);
  ```
- `'a non-array payload yields an empty list'`：`normalizePassiveMobs(undefined)` → `[]`；`normalizePassiveMobs('nope')` → `[]`。
- `'the list is capped at 12'`：塞 20 筆合法紀錄 → 回 12 筆。
- `'hp is clamped to the kind maximum'`：`{ kind: 'chicken', ..., hp: 999 }` → `hp === 4`。
- `'restored mobs keep kind, position, hp and yaw'`：`restorePassiveMobs(normalizePassiveMobs(raw))` → 第一筆 `kind === 'cow'`、`hp === 10`、`pos` 與記錄相同。

`src/world/save.test.ts`：
- 既有 `makePayload()` fixture 加 `passiveMobs: []`（`collectSavePayload` 現在會寫這個欄位，既有 round-trip 的 `toEqual` 才不會紅）。
- **既有 4 個 `collectSavePayload({...})` 呼叫點（L456／L486／L522／L548 附近）要補 `passiveMobs: []`**（2026-10-20 稽核修正）：`SaveSources.passiveMobs` 是**必填**欄位 → 少了它 `npm run typecheck` 直接紅（Task 10 Step 5 的 gate 過不了）。**改動理由**：新增來源欄位的 fixture 補值，不是行為弱化。
- **既有 `'migrates a raw v1 record to v3 with derived stash and empty advancements'` 的預期物件要補 `passiveMobs: []`**（2026-10-20 稽核修正）：該測試用 `expect(loaded).toEqual({ ...v1, version: 3, advancements, stash })` → `loadGame` 一律回傳 `passiveMobs` 後，多出的鍵會讓 `toEqual` 失敗。**改法**：在預期物件加一行 `passiveMobs: []`（舊檔沒有生物 → 空陣列）。
- **既有 `'migrates a raw v2 record to v3, deriving stash from the recorded mode'` 同樣補 `passiveMobs: []`**。
- 新增 `'a v3 record without passiveMobs loads with an empty list'`：手寫一筆沒有 `passiveMobs` 的 v3 記錄 → `loadGame()` 回傳的 `passiveMobs` 為 `[]`。
- 新增 `'passive mobs round-trip through IndexedDB'`：存一筆帶兩隻動物的 payload → `loadGame()` → `passiveMobs` 長度 2 且種類正確。
- 新增 `'a corrupt passive list does not invalidate the whole save'`：把 `passiveMobs` 塞成垃圾 → `loadGame()` 仍回傳有效 payload（玩家位置、背包都在），`passiveMobs` 為 `[]`。

`src/core/cloud-save.test.ts`：
- **既有 7 個 `buildCloudData({...})` 呼叫點（L57／L82／L95／L117／L150／L167／L182 附近）要補 `passiveMobs: []`**（2026-10-20 稽核修正）：`CloudBuildSource.passiveMobs` 是**必填**欄位 → 少了它 `npm run typecheck` 直接紅。**改動理由**：新增來源欄位的 fixture 補值，不是行為弱化。
- 新增 `'an old format-1 payload without passiveMobs still validates'`：`validateCloudData(oldFixture)` → true；`acceptCloudData(oldFixture).passiveMobs` → `[]`。
- 新增 `'buildCloudData copies the passive mobs'`：深拷貝（改回傳陣列不影響來源）。
- 新增 `'acceptCloudData drops corrupt passive records'`。
- 既有 cloud fixture 不需要加欄位（`passiveMobs` 是選填）——但 `buildCloudData` 的輸出現在會多一個欄位，既有 `toEqual` 斷言要補 `passiveMobs: []`（**改動理由**：payload 形狀新增欄位）。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/world/passive-save.test.ts src/world/save.test.ts src/core/cloud-save.test.ts`
Expected: FAIL。

- [ ] **Step 3: 實作**

`src/world/passive-save.ts`（新檔，純邏輯）：
- `serializePassiveMobs`：逐隻取 `kind`／`pos`／`hp`／`yaw`，回傳全新物件陣列。
- `normalizePassiveMobs(raw)`：`Array.isArray(raw)` 否則 `[]`；逐筆檢查（種類在 `PASSIVE_DEFS`、三個座標有限、`hp` 有限且 > 0、`yaw` 有限否則 0）；`hp` 夾到 `PASSIVE_DEFS[kind].hp`；累積到 `MAX_PASSIVE_MOBS` 就停止（後面的丟棄）。
- `restorePassiveMobs(records)`：逐筆 `createPassiveMob(kind, {x, y, z})` 後覆寫 `hp` 與 `yaw`（`createPassiveMob` 給滿血與隨機初始方向）。

`src/world/save.ts`：
- `SavePayloadV3` 加 `passiveMobs?: PassiveMobRecord[];`（**可選**，維持 v3）。
- `SaveSources` 加 `passiveMobs: readonly PassiveMob[];`。
- `collectSavePayload` 加 `passiveMobs: serializePassiveMobs(args.passiveMobs)`。
- `loadGame`：回傳物件加 `passiveMobs: normalizePassiveMobs((value as Partial<SavePayload>).passiveMobs)`（舊檔 → `[]`）。`isValidSavePayload` **不**把 `passiveMobs` 列入基礎檢查（與 `stash`／`advancements` 同款：交由載入路徑正規化）。

`src/core/cloud-save.ts`：
- `CloudData` 加 `passiveMobs?: PassiveMobRecord[];`；`CloudBuildSource` 加 `passiveMobs: readonly PassiveMob[];`。
- `buildCloudData` 加 `passiveMobs: serializePassiveMobs(src.passiveMobs)`。
- `validateCloudData`：`if (r.passiveMobs !== undefined && !Array.isArray(r.passiveMobs)) return false;`
- `acceptCloudData`：`passiveMobs: normalizePassiveMobs(x.passiveMobs)`。

`src/main.ts`：
- `sessionSavePayload()` 的 `collectSavePayload({...})` 加 `passiveMobs: passiveMobs`。
- `buildCloudData({...})` 加 `passiveMobs: passiveMobs`。
- `continueGame(payload)`：`resetSessionEntities()` 之後加 `passiveMobs = restorePassiveMobs(normalizePassiveMobs(payload.passiveMobs));`
- `applyCloudData(data)`：`resetSessionEntities()` 之後加 `passiveMobs = restorePassiveMobs(normalizePassiveMobs(data.passiveMobs));`
- `resetSessionEntities()`：加 `passiveMobs = [];` 並更新註解——**被動生物跨存檔保留**（clear 後由 continueGame／applyCloudData 從存檔還原；新遊戲則真的清空）。
- `startGame()`（新遊戲）→ 被動生物清空（`resetSessionEntities` 已處理）✓。

- [ ] **Step 4: 跑測試轉綠**

Run: `npx vitest run src/world/passive-save.test.ts src/world/save.test.ts src/core/cloud-save.test.ts` → PASS。

- [ ] **Step 5: 全量 gates＋人工**

Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。
人工（記錄結果）：白天等到雞出現 → 打它一下 → Save & Quit → 重新「繼續遊戲」→ 雞還在原地（血量保留受傷後的狀態）；同一個存檔在 0.4.0 的舊版遊戲讀不到生物（舊版忽略未知欄位），在 0.7.0 讀得到。

- [ ] **Step 6: Commit**

```bash
git add src/world/passive-save.ts src/world/passive-save.test.ts src/world/save.ts src/world/save.test.ts \
  src/core/cloud-save.ts src/core/cloud-save.test.ts src/main.ts
git commit -m "feat(save): B4.6 被動生物持久化（附加欄位 passiveMobs，維持 v3／format 1）"
```
（commit 訊息補一行：既有測試的改寫只涉及**新增欄位的 fixture 補值**與**遷移測試的預期物件補上 `passiveMobs: []`**，斷言強度不減。）

---

### Task 11: 被動生物音效（加分項，可延後）

**Files:**
- Modify: `src/audio/voices.ts`、`src/audio/index.ts`（新增被動生物叫聲的入口）
- Modify: `src/main.ts`（路由事件）
- Test: `src/audio/voices.test.ts`（或 `src/audio/index.test.ts`）

**Interfaces:**
- Consumes: Task 6 的 `PassiveKind`。
- Produces:
  ```ts
  // src/audio/voices.ts
  import type { SynthParams } from './sounds';   // ← 型別在 src/audio/sounds.ts（2026-10-20 稽核修正：原計畫沒寫來源，實作者可能自己重定義一個同名型別）
  export type PassiveCall = 'chicken' | 'pig' | 'sheep' | 'cow';
  export function passiveCallParams(kind: PassiveCall): SynthParams;   // 純資料
  ```
  `src/audio/index.ts` 的 `GameAudio` 加 `playPassiveCall(kind: PassiveCall, opts?: PlayOptions): void`。

**設計決策**：
- **這是加分項**：spec §B4.5 明說「排程不允許時可延後，但要明確記錄」。若本批時間不足，**整個 Task 11 可以不做**，但必須在 Task 12 的發布說明「已知問題」段落寫明「被動生物叫聲／受傷／死亡音效未實作（B4.5 加分項，延後）」，並在回報中標為未驗證。
- 程序合成（WebAudio），不引入外部素材：`chicken`＝短促高音（約 900 Hz）、`pig`＝低頻咕嚕（約 250 Hz）、`sheep`＝顫音（約 500 Hz 帶抖動）、`cow`＝低頻長鳴（約 150 Hz）。受傷／死亡沿用同一音色加長度變化（省下額外音色）。
- 觸發時機：受傷時（玩家打到）與死亡時各叫一次；生成時不叫（避免噪音）。

- [ ] **Step 1: 寫測試（失敗）**

- `'each passive kind has a distinct call'`：四個 `passiveCallParams` 的 `freq` 皆不同、`durationSec > 0`、`gain > 0`。
- `'playPassiveCall does not throw without an audio context'`（jsdom 無 WebAudio）→ 不 throw。

- [ ] **Step 2: 跑測試確認失敗** → `npx vitest run src/audio/voices.test.ts` → FAIL。

- [ ] **Step 3: 實作**

- `voices.ts` 加 `passiveCallParams`（純資料表）＋ `playPassiveCall(ctx, dest, params)`（沿用既有 `playOneShot` 的寫法）。
- `index.ts` 的 `GameAudio` 加 `playPassiveCall`（無 context 時 no-op）。
- `main.ts`：被動生物受傷／死亡時呼叫（距離衰減沿用既有 `gainForDistance`）。

- [ ] **Step 4: 跑測試轉綠** → PASS。

- [ ] **Step 5: 全量 gates** → 全綠。

- [ ] **Step 6: Commit**

```bash
git add src/audio/voices.ts src/audio/voices.test.ts src/audio/index.ts src/audio/index.test.ts src/main.ts
git commit -m "feat(audio): B4.5 被動生物叫聲（程序合成，加分項）"
```

**若本批不做此任務**（2026-10-20 稽核修正：原敘述「commit 訊息改為 `docs: B4.5 音效延後記錄`（或直接不 commit）」含糊——「不 commit」的話那筆記錄從何而來？）：**跳過 Step 1–6，把「B4.5 被動生物音效未實作（加分項，延後）」寫進 Task 12 的 `docs/releases/v0.7.0.md`〈已知問題〉與 README 的〈與原版的差異〉**；Task 12 的 `git add -A && git commit -m "chore(release): 0.7.0"` **必須包含這兩處文字**（它們是 Task 12 的一部分，不需要獨立 commit；若要獨立 commit，就用 `docs: B4.5 音效延後記錄`，並在 Task 12 Step 7 前確認該 commit 已在分支上）。

---

### Task 12: 0.7.0 發布

**Files:**
- Modify: `package.json`、`game.json`、`README.md`
- Create: `docs/releases/v0.7.0.md`

**Interfaces:**
- Consumes: Task 1–11 全部。
- Produces: tag `v0.7.0` 與 GitHub Release（CI 產生）。

- [ ] **Step 1: 版本 bump**

`package.json` `"version": "0.7.0"`；`game.json` `"version": "0.7.0"`。
**`game.json` 的 `cloudSave` 不動**（`readableFormats: [1], writeFormat: 1`——本批只是附加欄位，雲端格式沒有升版）；`id` 不動。

- [ ] **Step 2: README 更新**

- 「生存模式」段補：被動生物（雞／豬／羊／牛）、生成規則（白天、草地／泥土、離玩家 24格外、成群 2–4、上限 12）、掉落（生肉／羊毛／皮革／羽毛）、熔爐食譜與燃料值、進食改成按住右鍵 1.6 秒且滿飢餓不可進食、蘋果改由樹葉 0.5% 掉落、殭屍掉腐肉／骷髏掉骨頭與箭、白天生成上限與不消失。
- 「與原版的差異」段更新（逐條）：
  - 生物生成以「白天／夜晚」近似原版的亮度判準（B6 換成真光照）。
  - 怪物移動速度低於原版（本作殭屍 3.2 格/秒，原版約 4.6；骷髏 3.5 vs 約 5.0），但比例對齊原版。
  - 被動生物移動速度同樣低於原版（牛 1.5／羊 1.7／雞豬 1.9 格/秒，原版比例對齊）。
  - 白天燃燒的遮蔽判定簡化：只要**頭頂正上方一格是實心方塊（含樹冠葉片）就不燃**，不判斷天空光強度、不判天氣、不判頭盔。（2026-10-22 審查修正：原句「頭頂無實心方塊」指的是生物自己的頭格 → 屋簷下的殭屍照樣被燒死。）
  - 燃料以「可覆蓋冶煉次數」計（小數），非原版的連續燃燒計時器。
  - 生肉熟食掉落只在生物燃燒死亡時發生——本作沒有生物著火，故一律掉生肉。
  - 腐肉的「飢餓」狀態效果未實作（本作沒有狀態效果系統）；**生雞肉 30% 機率的「飢餓」狀態效果同樣未實作**（2026-10-20 稽核修正：原計畫只列了腐肉）。
  - **飽食度上限＝`maxHunger`(20)**，不是原版的「當前 food level」上限——飢餓 19 時吃東西，飽食度仍會被補到 20（2026-10-20 稽核修正：原計畫誤稱「與原版一致」）。
  - 羊毛方塊不自然生成（與原版一致）；創造模式調色盤仍只列方塊（完整物品清單屬 B5）。
  - 敵對實體不跨存檔；**被動生物自本版起跨存檔保留**（把既有那行「被動生物自 B4 起持久化」改成已完成）。
  - 被動生物音效若 Task 11 延後，也要在此列出。
- 「Test」段的測試數字更新為實際數量（實作時以 `npm test` 的輸出為準，寫「N tests / M files 全綠」）。
- 「專案狀態」補一行 B4（0.7.0）的完成摘要。

- [ ] **Step 3: 發布說明 `docs/releases/v0.7.0.md`**

固定四段（中文）：`## 新增`／`## 修正`／`## 存檔格式與相容性提示`／`## 已知問題`（段名與 B1 的 `docs/releases/v0.4.0.md` 一致）。

- 新增：雞／豬／羊／牛（數值與掉落）；被動生物生成規則；13 個新物品與羊毛方塊；熔爐可熔四種生肉、燃料值改回原版；進食改為按住右鍵 1.6 秒、滿飢餓不可進食；被動生物跨存檔保留；「牧場」進度。
- 修正：蘋果來源改為橡木樹葉 0.5%（不再由殭屍必掉）；殭屍改掉 0–2 腐肉、骷髏改掉 0–2 骨頭與 0–2 箭；白天殭屍／骷髏會燃燒（頭頂無遮蔽且不在水中時）；敵對生成距離改 24–128、上限 8→12、離 128 格消失；**骷髏的移動速度改為略快於殭屍**（2026-10-20 稽核修正：原句是中英夾雜「 skeleton's 速度…」，改成純中文）。
- 存檔格式與相容性提示：**本機 payload 版本不變（仍是 v3）、雲端格式不變（仍是 1）**，只多一個附加欄位 `passiveMobs`；舊存檔（沒有這個欄位）照常載入，結果是「沒有生物」；舊版遊戲讀新存檔會忽略這個欄位（不會報錯，但被動生物不會還原）；雲端上傳量增加約 1 KB 以內，仍在 64 KiB 限制內。**回退限制**：沒有版本升級，所以回退到 0.4.0 不會被讀取限制擋住，但 0.4.0 不會還原被動生物。
- 已知問題：被動生物音效是否延後（依 Task 11 的實際結果寫）；被動生物生成以白天近似亮度（B6）；B2–B3–B5–B9 尚未完成的功能（疾跑雙擊 W、8 生態、36 格背包、光照火把、箱子、耐久、苦力怕蜘蛛）維持既有說明。

- [ ] **Step 4: 全量 gates**

Run: `npm run typecheck && npm test && npm run build && npm run lint`
Expected: 全綠（測試數量 ≥ 既有 806＋本批新增）。

- [ ] **Step 5: 固定工具 pack＋validate（ZIP 驗證）**

```bash
sha256sum .playroom/tools/playroom-game-tools-1.1.0.zip   # 必須等於 .playroom/game-tools.lock.json 的 sha256
mkdir -p /tmp/opencode/playroom-tools /tmp/opencode/playroom-release
python3 -m zipfile -e .playroom/tools/playroom-game-tools-1.1.0.zip /tmp/opencode/playroom-tools
cd /tmp/opencode/playroom-tools
node pack-game.mjs "$OLDPWD/dist" /tmp/opencode/playroom-release/game.zip
node validate-game.mjs /tmp/opencode/playroom-release/game.zip
```
Expected: 兩個工具都成功、validate 全過（本機沒有 `unzip`，用 `python3 -m zipfile`）。

- [ ] **Step 6: 批末驗收（見下方「批末驗收」段）全部跑完並記錄結果**

- [ ] **Step 7: Commit（分支上；不 tag、不 push）**

```bash
git add -A
git commit -m "chore(release): 0.7.0"
```

本計畫在 `b4-passive-mobs` 分支執行：tag 與 push 屬整支完成後的整合步驟——merge 回 master 後才 `git tag -a v0.7.0 -m "0.7.0: B4 被動生物與生物對齊"`＋`git push origin master`＋`git push origin v0.7.0`，由 controller 依 finishing-a-development-branch 流程執行。

- [ ] **Step 8: 驗證 CI Release**

以 `webfetch https://github.com/TommyLamm/WeCraft/releases/tag/v0.7.0` 確認 release 存在、asset 已附、說明為 `docs/releases/v0.7.0.md` 內容。回報照 AGENTS.md 四段式：程式完成／ZIP 驗證／Release（CI 結果）／平台上架（若屬平台操作，向使用者確認後再按）。

- [ ] **Step 9: Commit（收尾）**

若 Step 8 有任何補正（文件錯字、notes 檔更新），再一顆 commit；無則略過。

---

## 批末驗收

（Task 12 Step 6 執行；每項都要留下可重現的證據。）

1. **型別／測試／建置**：`npm run typecheck && npm test && npm run build && npm run lint` 全綠；測試數量 ≥ 既有 806（既有測試不得弱化）。
2. **白天生成與上限統計**（Task 7 的測試即為證據）：白天生成、夜間不生成、離玩家 ≥24、成群 2–4、全場 ≤12、地面只接受草地／泥土、上方空間足夠。補一個人工步驟：`npm run dev` → 正午在平原走一分鐘，記錄看到的雞豬羊牛數量與距離。
3. **掉落分佈**（Task 4 的測試）：六種生物的掉落表與數量範圍；樹葉 0.5% 蘋果。補人工：打一隻羊確認掉生羊肉＋羊毛、打殭屍確認掉腐肉（不是蘋果）。
4. **白天燃燒實測**：單元測試（Task 5）＋人工：`npm run dev` → 白天把殭屍引到陽光下，觀察它在 20 秒內燒死（1 點血/秒）並掉腐肉；站在屋簷下（**頭頂正上方那一格**有方塊）或水裡則不燃。**同時確認殭屍仍會攻擊玩家**（2026-10-20 稽核修正：本批在 `stepMobs` 之後插入了燃燒步驟，若照原計畫只取 `.mobs` 就會把 `stepped.events` 整包丟掉 → 怪物不會攻擊）。
5. **持久化載入測試**（Task 10）：本機 IndexedDB 往返＋雲端 format 1 往返＋舊存檔缺欄位 → 空陣列；人工：放生／離開／重開後生物仍在且可互動（可打、可掉落）。
6. **效能**：`npm run dev` → F3 觀察 12 隻被動生物＋12 隻敵對生物同場時的 FPS；與本批前的基準（記錄 commit `b11273f` 的同場景 FPS）比較，掉幅 > 20% 才算退步（要寫下數字）。純邏輯層的基準測試：連續 1000 次 `stepPassiveMobs(12 隻)` 應 < 100 ms（用 `performance.now()` 量一次即可，不必做成會 flaky 的斷言）。
7. **HUD 圖示與名稱**：熱鍵欄拿到新物品時圖示可辨識——**證據是 Task 1 的 `src/ui/icons.test.ts`**（12 個新 id 都有專屬 `case` 分支的靜態檢查；2026-10-20 稽核修正：原驗收段要求「jsdom 測試確認每個新 id 都有圖示 canvas」，但原計畫沒有任何任務產出該測試 → 現已補上，不再是無來源的驗收項）；切換熱鍵欄時顯示名稱正確（`stackName('steak') === 'Steak'`、`'rotten_flesh' === 'Rotten Flesh'`、`'raw_porkchop' === 'Raw Porkchop'`）。
8. **進食手感的真實瀏覽器驗收（Playwright）**：本批的進食互動**消費**右鍵按住旗標（`placeHeld`，由 B2 提供；本批不改輸入層），但「按住右鍵才吃東西」是新的使用者可見行為 → 依 AGENTS.md §3 仍跑真實 Chromium（headful＋`xvfb-run`，靜態伺服 `dist/`）。probe 腳本放 repo 外（`/tmp/opencode/wecraft-b4-probe/`）：
   - 進入生存 → 給自己生豬肉 → **按住右鍵 1.0 秒放開**：物品不應減少。
   - **按住右鍵 2.5 秒**：物品應 −1、飢餓條上升。
   - 滿飢餓時按住右鍵 2.5 秒：物品不應減少。
   - CDP 合成鍵無法複刻瀏覽器保留鍵（Ctrl+W 等）——本批沒有改保留鍵行為，但與 B2 的同類限制一致，**Ctrl+W 情境列「未驗證」**。
   - 回報寫清楚：哪些是自動化驗證、哪些是人工目視。

## 與公約／spec 的差異

（逐條說明；公約 §3 的版本表本批完全一致——本機 v3 ＋附加欄位、雲端 format 1 ＋附加、`readableFormats:[1]`。）

1. **羊毛方塊提前到 B4**：spec §B4.3 列「羊毛（方塊＋物品）」、§B5.1 又列「羊毛方塊」。本批交付**方塊＋物品**（羊要掉羊毛，而物品必須有方塊形式才能進熱鍵欄與創造調色盤）；B5.1 的羊毛項因此只剩「世界生成層面」的檢查——原版羊毛本來也不自然生成，故 B5 實務上不需重做。**若 B5 的實作者認為應把方塊留在 B5，則 B4 只能交付無方塊的 `wool` 物品（會變成與 `gravel`／`chest` 同類的 dead id），與 spec「方塊＋物品」不符——本計畫採前者。**
2. **被動生物的移動速度是「原版比例＋本作慢速尺度」**：spec 表的 0.25／0.25／0.23／0.2 是原版移動速度屬性值，本計畫原樣保存在 `PASSIVE_DEFS.vanillaSpeed`；實際格/秒另存於 `speed`（牛 1.5／羊 1.7／雞豬 1.9），因為本作既有怪物就比原版慢（殭屍 3.2 vs 原版 4.6）。比例（雞＝豬 > 羊 > 牛）與原版一致，已在 README 明示為簡化。
3. **敵對速度同樣只對齊比例**：spec §B4.4 的「速度對齊：骷髏略快於殭屍」以比例落實（3.5 / 3.2 ≈ 原版 0.25 / 0.23），絕對值維持本作現有的慢速尺度。
4. **被動生物生成距離的下限／上限自訂**：spec 只給下限「離玩家 ≥24」。上限取 48（世界半徑有限，遠處生成的動物玩家走不到）；B6 可調。**母點距離下界取 28**（成員 ±2 偏移後仍 ≥ 24 的保證值，2026-10-20 稽核修正：母點若從 24 起算會讓成員掉到 ≈21.2，與「離玩家 ≥24」的測試互相矛盾）。
5. **白樺樹葉的蘋果 0.5% 延後到白樺方塊存在時**：spec §B4.3 寫「橡木／白樺樹葉 0.5% 掉蘋果」，但本作目前只有橡木樹葉（白樺方塊屬 B3／B5）。本批把機率掛在**方塊 id 表**上（目前只有 `BLOCK.LEAVES`），白樺樹葉方塊落地時把 id 加進同一張表即可，規則不用改。
6. **生物著火死亡掉熟肉未實作**：原版雞／豬／羊／牛在燃燒時死亡會掉熟肉；本作沒有生物著火系統（白天燃燒只給不死系），故一律掉生肉。已列入 README 差異清單。
7. **腐肉與生雞肉的「飢餓」狀態效果未實作**：原版腐肉 80% 機率、生雞肉 30% 機率給 Hunger 效果；本作沒有狀態效果系統，本批只給食物值（腐肉 4／0.8）。
8. **飽食度上限不是原版的 food level 上限**：`survival.ts` 的 `eat()` 把飽食度夾在 `maxHunger`(20)，原版是夾在當前飢餓值 → 飢餓 19 時吃東西，本作飽食度會補到 20。**本批不改 `eat()` 的 clamp**（它是 `survival.ts` 的既有不變量），改以 README 明示差異。
9. **進度條（`ui/eat-progress.ts`）標為可選**：規則與測試不依賴它；若排程吃緊可整個省略，只需在發布說明的已知問題記錄。
10. **音效（Task 11）為可延後的加分項**：spec §B4.5 明允許延後但要記錄；本計畫把它獨立成一個可整個跳過的任務，跳過時必須寫進發布說明與 README。
11. **`SUN_BURN_SEC = 8` 是旗標常數、不是 wiki 查到的數字**（2026-10-20 稽核修正）：原版 Java 在日光直射時對不死系呼叫 `setSecondsOnFire(8)`；wiki 只寫燃燒的抑制條件。實作上它是「正在燃燒」的旗標，實際死亡時間由 1 HP/s 決定。
12. **`InputState.placeHeld` 的所有權在 B2，本批只消費**（2026-10-20 終審修正）：B2（0.5.0）已在 `src/player/input.ts` 宣告 `placeHeld: boolean` 並由 `clearActive()` 清除；**本批不得重新宣告欄位、不得再寫一次設旗標／清旗標的程式碼**（重複宣告會是 TS duplicate identifier）。本批改以自有的純邏輯 `eatTick(progress, { held, item, allowed, dtSec })` 承載「按住才吃」的規則（`held` 由 `main.ts` 從 `input.state.placeHeld` **唯讀**帶入），旗標語意的守門測試留在 B2。

## 未解／實作時複核清單

- **殭屍／骷髏的原版移動速度 0.23／0.25**：殭屍頁 infobox 已查證 `speed = 0.23`；**現行 minecraft.wiki/Skeleton 頁的 infobox 沒有 speed 欄**，0.25 為 Java 基準值。複核方式：查 minecraft.wiki/Skeleton 的歷史版本 infobox 或 Java 原始碼 `EntityType.SKELETON` 的屬性註解。
- **`SUN_BURN_SEC = 8` 的出處**：**wiki 查不到**（Zombie／Mob 頁只有燃燒的抑制條件與「日光直射下著火」）。本批採 Java 原始碼的 `setSecondsOnFire(8)` 值，實作上是旗標。複核方式：查 Java 原始碼 `Zombie#aiStep`／`Entity#setSecondsOnFire`。
- **被動生物的 panic 時長（5 秒）**：原版受傷動物的逃跑時間沒有穩定的公開數值；本批自訂 5 秒並寫進註解。複核方式：minecraft.wiki/Animal 的「Flee」段。
- **水中漂浮的高度與細節**：原版動物浮在水面特定高度；本批只做「不下沉」。複核方式：minecraft.wiki/Water#Entity_floating。
- **被動生物生成種類權重**：原版依生態加權（平原多豬牛、森林多羊等）；本批四種等機率。**B3 的 8 生態落地後應重新調權重**（列入 B3/B6 的交接說明）。
- **原版「日光下」的界線**：本作以 `phaseOf(t) === 'day'`（t ∈ [0, 0.5)）判定白天；原版黎明／黃昏有過渡帶。複核方式：minecraft.wiki/Daylight_cycle 的「Sunlight」段。
- **羊毛方塊的顏色**：本作只有白色羊毛（原版 16 色）；羊的顏色也未做（原版依生態決定）。複核方式：minecraft.wiki/Wool。
- **雲端 payload 容量**：12 隻被動生物的記錄約 0.7–1 KB，遠低於 64 KiB 上限；實作後用 `byteSizeOf` 印一次實際值記錄。

## Self-Review 記錄

- **Spec coverage**：§B4.1（四種被動生物＋行為）→ Task 6（模型／AI）＋Task 8（渲染）；§B4.2（生成規則）→ Task 5（光照判準介面）＋Task 7（生成規則與統計）；§B4.3（物品與食物鏈）→ Task 1（物品／方塊／進度）＋Task 2（食物表／進食規則）＋Task 3（熔爐與燃料）＋Task 4（掉落與蘋果）＋Task 9（按住進食）；§B4.4（敵對對齊）→ Task 5；§B4.5（音效，加分項）→ Task 11；§B4.6（被動生物跨存檔）→ Task 10；§跨批次（版本節奏／README／發布）→ Task 12；批末驗收五項（白天生成與上限統計、掉落分佈、白天燃燒、持久化載入、效能／HUD 圖示）→ 「批末驗收」1–8。
- **Type consistency**：`SpawnLight`／`clockLight`／`canSpawnPassive`／`canSpawnHostile` 由 Task 5 產生、Task 7 消費；`PassiveKind`／`PassiveMob`／`PASSIVE_DEFS`／`MAX_PASSIVE_MOBS` 由 Task 6 產生、Task 7／8／10 消費；`rollMobDrops` 由 Task 4 產生、Task 6／7 消費；`FOOD_VALUES`／`canEat`／`EatProgress` 由 Task 2 產生、Task 9 消費；`PassiveMobRecord`／`normalizePassiveMobs`／`restorePassiveMobs` 由 Task 10 產生、`save.ts`／`cloud-save.ts` 消費；存檔欄位名一律 `passiveMobs`，本機 v3／雲端 format 1 與公約 §3 一致。
- **Review Focus→測試**：1→Task 10；2→Task 10；3→Task 2＋Task 9；4→Task 7；5→Task 5＋批末效能；6→Task 5。
- **步驟掃描**：每個 Task 都是「先寫會失敗的測試 → 跑（紅）→ 實作 → 跑（綠）→ 全量 gates → commit」的固定節奏；實作步驟給的是簽名／常數／表格／判準與必做的接線點，沒有 TBD、沒有「處理邊界情況」這類空話；每個測試步驟都附測試名與斷言程式碼。
- **比例**：本檔以「決策＋介面＋測試」為主體；只有演算法本身無法由簽名或測試決定的地方（燃燒傷害累加、`EatProgress` 狀態機）才給具體算式，其餘一律以表格／常數／介面描述，不逐字貼實作程式碼。
- **已知未測面**：`src/main.ts` 無測試（組裝根）——Task 4／5／6／7／8／9／10 的接線以人工步驟＋批末 Playwright 佐證並在回報中列「未自動化」。
- **2026-10-20 稽核修正摘要**（本計畫已依稽核報告逐條修正，修正點在正文以「（2026-10-20 稽核修正：…）」標出）：
  1. **Critical**：樹葉 0.5% 蘋果的實作步驟不可達 → 機率掉落改排在 `dropItemFor` 的 null 分支**之前**，並補對應測試（`spawnBlockDrop` 留在 `src/player/interact.ts`）。
  2. **Critical**：`BLOCK.WOOL = 26` 會打紅三個既有測試 → Task 1 Step 1 明列 `blocks.test.ts` 窮舉表／硬度表、`items.test.ts` 鏡像清單與**兩處**長度斷言、`sounds.test.ts` 材質表長度的改寫。
  3. **Critical**：檔案結構表補 `src/audio/sounds.ts`（羊毛材質音效 `leaves`）與 `src/ui/icons.test.ts`。
  4. **Critical**：`stepMobs(...).mobs.map(stepSunBurn)` 丟掉 `events` → 改成先 `applyMobEvent(ev)` 再疊燃燒。
  5. **Critical**：`SaveSources`／`CloudBuildSource` 新欄位造成 11 個既有呼叫點 typecheck 紅 → 明列要補 `passiveMobs: []` 的位置；`loadGame` 一律回傳 `passiveMobs` 讓 v1／v2 遷移測試的 `toEqual` 多一個鍵 → 明列那兩個測試的預期物件要補 `passiveMobs: []`。
  6. **Important**：`MobCtx` 不加欄位（燃燒資訊只走 `SunBurnCtx`）；母點距離 28–48 與「成員 ≥24」自洽；`EatProgress` 的 1.595 不觸發 1.6；保留 `APPLE_FOOD`／`APPLE_SAT`；Task 9 明寫刪除舊的「右鍵脈衝即吃」分支；骨架速度的四個既有斷言逐一列出；飽食度上限不是原版 food level 上限；tile 33 的「已畫」守門自己補一條。
  7. **Minor**：`SUN_BURN_SEC = 8` 改標旗標常數；生雞肉 30% 飢餓效果列入簡化清單；`TILE_COUNT` 合併順序說明；中英夾雜句改中文；`SynthParams` 的 import 來源；圖示測試落到 Task 1；Task 11 略過時的記錄歸屬寫清楚。
- **2026-10-20 終審修正摘要**（本計畫依最終跨計畫複核報告修正；修正點在正文以「（2026-10-20 終審修正：…）」標出）：
  1. **必須修正 #1（跨批重複定義）**：`InputState.placeHeld` 的所有權歸 B2 → B4 的 `src/player/input.ts` 從「修改」改為「**不動（沿用 B2）**」；Task 9 不再宣告欄位、不再寫 `onMouseDown`／`onMouseUp`／`clearActive` 的旗標邏輯，改以本批自有的純邏輯 `eatTick`（`held` 由 `main.ts` 唯讀帶入）承載「按住才吃」的規則；Task 9 的測試也從 `input.test.ts`（B2 的守門所在）移到 `eat.test.ts`。
  2. **必須修正 #4（基數漂移）**：物品表計數從寫死的「32 → 45」改為「**讀現況基數 N → N + 13**」（B3 已合併時 N＝41 → 54），並要求在 commit 訊息註明實際值。
  3. **建議修正 #9（過時註解數字）**：材質表長度「17 → 18」改為說明該斷言是相對 `Object.keys(BLOCK).length` 的、實作者不需要手改長度數字，只需補那一列材質。
  4. **建議修正 #11（自足性）**：新增〈上游相依（本批必須在其後實作）〉段——B2 的 `placeHeld` 與 B3 的 9 個方塊／物品形式的所有權，並補「上游未合併」的備援（B2 未合併 → 進食接線延後、不得自行宣告欄位；B3 未合併 → 必須在 B3 之後實作，編號不得自選）。

