# WeCraft B6 光照與火把（0.9.0）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 給 WeCraft 裝上一套真的 per-block 光照——方塊光（火把）＋天空光（隨日夜衰減），跨區塊傳播、生成與載入時計算、以頂點亮度渲染並做角落平均（平滑）；順手把火把做成完整玩法（煤＋木棍配方、光照 14、只能放在完整方塊的頂／側、小型無碰撞模型、掉落與支撐檢查），並把 B4 的生怪規則從「日光下」近似升級成 per-block 光照判準（天空光＋方塊光），最後發布 0.9.0。

**Architecture:** 光照引擎是純邏輯模組 `src/world/lighting.ts`（不碰 Three／DOM），資料存在 `Chunk` 上（每格 1 byte：天空光高 4 位＋方塊光低 4 位，延遲配置、隨區塊卸載釋放）。演算法＝經典 flood-fill BFS：方塊光每格 −1、天空光垂直下傳保持 15、水平 −1；跨區塊以「世界座標讀寫鄰塊」＋「重算時掃 3×3 群組的來源」維持一致（**2026-10-20 稽核修正**：原設計的「生成後回拉鄰塊邊界光」函式讀寫同一格、實際是無效的 no-op，已改為群組播種）。改變方塊時**以區塊為粒度**重算（受影響區塊＋**八鄰**標記 `lightDirty` → 下一幀重算並重網格化），不做逐格增量 BFS。渲染端把天空光與方塊光當成**兩條頂點屬性**烘進 mesh（貪心合併簽章加 8 位光照鍵 → 光照邊界自然切開 quad），fragment 著色器用 `max(block/15, sky/15 × 天空比例)` 乘到 `diffuseColor`，**日夜變化只改一個 uniform → 不重算、不重網格**。火把是 `BLOCK.TORCH = 32` 的非實心小方塊模型（自成一條 mesher pass），貼在完整方塊的頂或側（方向由世界推導、不存狀態）。

**Tech Stack:** TypeScript strict、Three.js（`MeshLambertMaterial` + `onBeforeCompile` patch；**新增** `patchTerrainLightShader`，既有的 `patchTextureArrayShader` 維持原樣給粒子／手持物用）、Vite、Vitest（jsdom／fake-indexeddb）、IndexedDB、GitHub Actions release workflow。

**Spec:** `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`（§B6 = 本批範圍：§B6.1 光照系統、§B6.2 生怪整合、§B6.3 風險與拆分）

**上游相依（本批必須在其後實作）**：B3 的 `BlockDef.shape`（`'cube' | 'cross'`，本批加第三種 `'torch'`）與 `ChunkMesh.foliage` pass、B4 的 `src/world/spawn-rules.ts`（`SpawnLight`／`canSpawnPassive`／`canSpawnHostile`）與 `src/world/passive-mobs.ts`（`PassiveSpawnCtx`）、B5 的方塊／物品 id 表與貼圖索引。**若合併後的現況與本計畫引用的 id／簽名不同，以合併後的現況為準，並在該任務的 commit 訊息說明調整**（公約 §9-3）。

## Global Constraints

（出自 spec §1／§4、公約 §3／§5、AGENTS.md；每個任務的需求都隱含本節。）

- **本批要改寫的既有測試（集中清單，2026-10-20 終審修正）**（**基數一律讀現況**：「基數」欄＝實作者在對應 Task 的 Step 1 讀到的當前值，並在該 Task 的 commit 訊息註明實際值；**不得照抄本表裡的括號數字當成要寫死的值**）：
  | 檔案 | 既有測試 | 改法 | 理由 |
  |---|---|---|---|
  | `src/world/blocks.test.ts` | `'requiredTool／fastTool data matches vanilla'` 窮舉表 | 補 `[BLOCK.TORCH, null, null]` | 該表有窮舉守門斷言，新 id 必須在表內 |
  | `src/world/blocks.test.ts` | `'hardness table matches vanilla 1.20+ (Task 5)'` | 補 `[BLOCK.TORCH, 0]` | 資料表同步 |
  | `src/core/items.test.ts` | `'ALL_ITEM_IDS is the canonical list: <N> entries…'` 的計數＋測試標題數字 | 改成 `<基數 + 1>`（基數＝現況 `ALL_ITEM_IDS.length`；上游 B5 落地後 72 → 73） | 物品表成長，非弱化 |
  | `src/core/items.test.ts` | `'ItemId union covers every obtainable block item'` 的 `ALL_ITEMS.length` ＋ 鏡像清單 | 計數改成 `<基數 + 1>`；鏡像補 `'torch'` | union 鏡像必須等於 `ALL_ITEM_IDS` |
  | `src/core/recipes.test.ts` | `'holds exactly the <M> settled recipes, no extras'` 的計數 | 改成 `<M + 1>`（M＝現況 `RECIPES.length`；上游 B5 落地後 31 → 32） | 配方表成長，非弱化 |
  | `src/core/recipes.test.ts` | 同一條測試裡的窮舉 `RECIPES.map((r) => r.id)` 清單 | 補 `'torch'` | 漏了就紅 |
  | `src/render/textures.test.ts` | `'drawn tiles keep their content; empty layers are opaque magenta #ff00ff'` 的洋紅層清單 | **只驗證、不改寫**（修復點在 B3；本批 `TILE_COUNT` → 40 後清單自動變 `[40, 41, 47, 63]`）。備援：上游仍是寫死值時由本批補改成與 B3 相同的 `[TILE_COUNT, TILE_COUNT + 1, 47, 63]` | 三批各寫各的會衝突 |
  | `src/audio/sounds.test.ts` | `'maps every BLOCK id to its material group (table-driven)'` | 補 `[BLOCK.TORCH]: 'wood'` | 材質表是窮舉 `Object.keys(BLOCK).length` |
  | `src/world/spawn-rules.test.ts` | B4 的 `'daylight is bright enough for passive mobs…'`／`'nightlight is the opposite'` | 改成明確的 `SpawnLight` 值矩陣（`clockLight` 被 `spawnLightAt` 取代） | 判準不變，餵入的真實光照改由世界提供 |
  | `src/world/mobs.test.ts` | `ctxOf` fixture 的 `isNight: true`／`'never spawns in day'` | 改成 `lightAt: () => ({ sky, internalSky, block })` | 生怪判準改用 per-block 光照 |
  | `src/world/passive-mobs.test.ts` | `'passive mobs spawn on grass in daylight'`／`'no passive mob spawns at night'` | 前者改用 `lightAt`；後者改名 `'no passive mob spawns in the dark'` | 原測試的「時鐘」前提已不存在 |
- **gates**：每個任務結束 `npm run typecheck`、`npm test`、`npm run build`、`npm run lint` 全綠；既有測試一個不多、一個不少（本批改動到舊測試時，必須在 commit 訊息說明「改得有理」的理由）。
- **版本**：本批發布 `0.9.0`；`package.json` 與 `game.json` 同步（`id` 固定 `wecraft`）；tag 為 `v0.9.0` 且指向含 bump 的 commit；不覆寫已發布版本。
- **存檔格式不動**（公約 §3）：本機 payload 維持 **v4**（B5 的 36 格語義），雲端維持 **format 2**（`readableFormats:[1,2], writeFormat:2`）→ `game.json` 的 `cloudSave` **不動**。光照是導出資料、**不入存檔**；火把方塊本身走既有的 `modified` overlay（數字 block id 32）→ 這是「同一格式內的新 block id」，不是格式升版。
- **方塊 id 只能往後追加**（B3 的硬約束）：既有 `BLOCK.*` 的數值不得重編號；`BLOCK.TORCH = 32`（controller 裁決的數字表：**B3 17–25、B4 wool = 26、B5 27–31** → 火把接 32）。貼圖索引依**公約 §3.5 的跨批編號表**：`T.TORCH = 39`、`TILE_COUNT = 40`（B3 tiles 21–32、B4 `T.WOOL` = 33、B5 34–38 → 火把接 39；B8 的 `T.CHEST` = 40）。測試斷言 `T.TORCH === TILE_COUNT - 1` 且 `TILE_COUNT <= 64`（紋理陣列 64 層）。**（2026-10-20 稽核修正：原計畫寫 `T.TORCH = 40`，會與 B8 的 `T.CHEST = 40` 撞號 → 改為 39／`TILE_COUNT` 40。）**
- **原版基準**：Minecraft Java Edition 1.20+；數值以本計畫〈已查證與設計決策〉節為準（每條附 wiki 原文出處）。凡與原版不同處（簡化）必須寫進 README〈與原版的差異〉與發布說明〈已知問題〉。
- **平台紀律**：本批**不碰** `Esc`／iframe／pointer lock／全螢幕／保留鍵 → 不需要為輸入路由補 Playwright（若實作者順手改了，必須補並把保留鍵情境列為未驗證）。
- **發布候選跑固定工具**：`.playroom/tools/playroom-game-tools-1.1.0.zip`（先驗 `sha256` 與 `.playroom/game-tools.lock.json` 一致）＋ `pack-game.mjs` ＋ `validate-game.mjs`（Task 9）。本機無 `unzip`，用 `python3 -m zipfile`。
- **註解誠實化**：本批碰到的「Minecraft parity」宣稱要同步校正（例如 `src/world/mobs.ts` 檔頭寫著「no per-block light engine this phase, plan 8.5」——本批之後必須改寫）；README 的 parity 宣稱逐條複核。
- **執行方式**：SDD（superpowers:subagent-driven-development）＋隔離 worktree，分支名 **`b6-lighting`**（本計畫只標註分支名，不建立分支；tag／push 由 controller 依 finishing-a-development-branch 流程執行）。

## Review Focus

（spec 沒明說、但最可能咬人的輸入類別或失敗模式；每一條都已在對應任務放測試。）

1. **光不能穿牆、也不能「穿過天空」**：火把光不得穿透不透明方塊；屋簷下的天空光要**比戶外暗一階（14）**，而且**離開洞口每往內走一格再暗一階**（14 → 13 → 12 → …，橫向每格 −1）→ Task 1（`a torch lights its neighbours with the vanilla decay`）、Task 2（`a roof shades the ground one level at a time`、`a walled pocket loses one level per step from the opening`）。
   **（2026-10-20 稽核修正：原措辭「屋簷下的天空光必須逐格 −1 遞減」是錯的語意 —— 單格厚的屋簷下，整列都是 14（旁邊的開闊柱在每個高度水平餵 14 過來），不會「每往下一格 −1」；真正的逐格 −1 是**離洞口每往內一格**。已依重算結果改寫，見 Task 2 的兩條測試。）**
2. **跨區塊的光要雙向一致**：火把放在 x = 15（區塊邊界）時鄰塊 x = 16 要拿到 13；鄰塊後生成時，光要能「回拉」進先生成的區塊 → Task 1（`light crosses the chunk border`）、Task 2（`sky light crosses the chunk border`）、Task 3（`a late neighbour pulls light back across the border`）。
   **（2026-10-20 稽核修正：跨區塊的測試必須先讓鄰塊存在（`world.addChunk(new Chunk(1,0))` 或在鄰塊裡 `setBlock`），否則光「寫不進不存在的區塊」→ 讀回 0，測試與設計互相矛盾。）**
3. **放置／破壞後不能留下 stale light，也不能觸發無限重算迴圈**：挖掉火把 → 周圍變暗；放火把 → 周圍變亮；重算 A 塊不得把 B 塊標成 dirty 再標回 A；**挖掉角落火把後，對角鄰塊的光也必須歸 0（不能留下永久「幽靈光」）** → Task 1（`breaking a torch removes its light`）、Task 3（`a recompute does not re-dirty its neighbours`、`a corner torch leaves no ghost light in the diagonal neighbour`）。
4. **日夜切換不得引發重網格風暴**：太陽落下時天空只改一個 uniform，網格不重建、幀時間不跳；**而且四個 pass（地形／水／植被／火把）要一起變暗**（不能只有最後編譯的那個材質吃到 uniform）→ Task 4（`setSkyScale updates every material of the renderer`）、Task 8（`the light queue never exceeds two chunks per frame`）。
5. **火把的放置規則要擋掉浮空與卡住玩家**：沒有完整方塊支撐 → 不可放；火把無碰撞 → 不可因為玩家站在格內就拒絕；支撐方塊被挖 → 火把掉落（不留在半空）→ Task 6（`a torch needs a full block below or beside it`、`a torch does not collide with the player`、`a torch pops off when its support is removed`）。
6. **存檔往返與舊版相容**：火把要跟著 `modified` overlay 存／讀；光照本身不入存檔；舊版（未知 block id 32）不得崩 → Task 8（`a torch survives a save and load round trip`、`the light is never written to the save payload`）＋Task 9 Step 3 的相容性提示。

---

## 拆分決策：單批 0.9.0（不拆 B6a／B6b）

**決定：本批不拆，一次發布 0.9.0。** spec §B6.3 允許拆 B6a（火把＋方塊光）／B6b（天空光＋生怪整合），但本計畫不採用，理由如下：

1. **版本表被公約 §3 固定**：公約 §3 已把 0.10.0／0.11.0／0.12.0 給 B7（耐久）／B8（容器）／B9（苦力怕蜘蛛），B7 計畫也已寫死 0.10.0。拆兩版＝B6a 0.9.0＋B6b 0.10.0，B7–B9 順延成 0.11.0／0.12.0／0.13.0 → 要改公約 §3、改 B7 計畫的版本、且已上架的版本序號會被稀釋（0.9.0 之後跳 0.11.0）。**代價大於收益。**
2. **兩半共用同一份資料結構與同一支 BFS**：天空光與方塊光住在同一格 byte 的兩個 nibble，傳播是同一套 flood-fill（只有衰減規則不同）。拆批＝同一支 BFS 寫兩次，或先寫一套「只有方塊光」的版本再改寫成雙通道——後者正是本批最貴的重寫。
3. **B6b 依賴 B6a 的引擎，拆開會產生「半個光照」的中間版本**：生怪判準要同時吃天空光與方塊光；只發 B6a 會得到「火把會亮，但夜晚跟洞穴還是一樣亮、敵對生物還是看時鐘」的版本，比不拆更難解釋。
4. **工程量可控**：拆批的理由通常是「單批塞不下」。本批把複雜度集中在**演算法本體**（BFS）與**渲染接線**（頂點屬性＋著色器）兩處；其餘（資料結構、放置規則、生怪介面、存檔）都是薄接線。改成「以區塊為粒度重算」之後，不需要複雜的逐格 remove-BFS，任務數 9 個、每個可獨立審查（見下）。

**若 controller 仍要拆（備案，本計畫不採用）**：B6a = 0.9.0（火把＋方塊光＋渲染接線）、B6b = 0.10.0（天空光＋生怪），B7–B9 順延為 0.11.0／0.12.0／0.13.0，並在兩份發布說明寫明版本順延。拆分點落在 Task 2 與 Task 4 之間。

---

## 已查證與設計決策

（每條附 wiki 出處與原文摘錄；引用格式：`已查證（minecraft.wiki/<Page>，2026-10-20）`。）

### 1. 光照等級與衰減規則

- **等級範圍**：「There are 16 light levels, specified by an integer from 0 (the minimum) through 15 (the maximum).」已查證（minecraft.wiki/Light，2026-10-20）→ `MAX_LIGHT = 15`。
- **方塊光的衰減是 taxi-cab 距離**：「The block light level decreases by one for each meter (block) of taxicab distance from the light source. This applies to each of the 3 coordinate axes.」同頁原文的例子：「If a torch with light level 14 is placed on the floor, the light level of the adjacent floor blocks in all four directions is 13, while the diagonal blocks in all four directions have a light level of 12 (14 minus 1 south, minus 1 east).」→ 本作實作：**6 方向每格 −1**（水平 4 向 −1、垂直 2 向 −1），因此斜對角 = −2 ✓，與原文的 taxi-cab 定義一致。
- **火的等級**：「Torches give off a light level of 14.」已查證（minecraft.wiki/Torch，2026-10-20；infobox `Luminous: Yes (14)`）→ `TORCH_LIGHT = 14`。
- **方塊光「實際上從 14 起算」**：「lighting due to blocks results in a higher brightness, which is balanced by the fact that light due to blocks effectively starts at 14 (solid light source blocks emit a level of 15, but that applies to the light source block itself) while sky light brightness is 15 outdoors.」已查證（minecraft.wiki/Light，2026-10-20）→ 渲染公式裡方塊光用 `block/15`（14/15 = 0.93）、天空光用 `sky/15`（15/15 = 1.0），比例與原文一致。

### 2. 天空光

- **直曝天空 = 15**：「The sky light level for blocks vertically exposed to the sky is 15.」已查證（minecraft.wiki/Light，2026-10-20）。
- **垂直下傳不衰減、水平／向上 −1**：「When sky light of a level of 15 spreads down through a transparent block, the level remains unchanged. When it spreads horizontally or upwards, it reduces its level by 1.」同頁 → 本作 BFS 的衰減規則：`next = (往下 && level === 15) ? 15 : level - 1`。
- **低於 15 的天空光像方塊光一樣衰減**：「Sky light with a level less than 15 spreads in a similar way as block light does: when it propagates to adjacent (including top and bottom, six blocks in total) blocks, it is attenuated until it is 0.」同頁 → **每走一格衰減 1**（含往下與往上）→ 也就是「離開洞口每往內一格暗一階」（15 → 14 → 13 → 12）。
  **（2026-10-20 稽核修正：原文這裡寫的是「屋簷下的 14 → 13 → 12 逐格遞減」，容易被讀成「單格厚屋簷下每往下一格 −1」——錯的語意。單格厚屋簷下的整列都是 14（旁邊的開闊柱在每個高度水平餵 14），逐格 −1 發生在「離開洞口每往內一格」。已改寫，並在 Task 2 用兩條測試分別釘住這兩件事。）**
- **不透明方塊擋住天空光**：「Opaque blocks can prevent the spread of sky light.」同頁。
- **（簡化，明示）** 原版有「過濾方塊」（水、葉、冰…）讓天空光每格 −1（Light 頁 Light-filtering blocks 段）。本作**所有透明方塊一律不過濾**（水／玻璃／葉／植被皆同）→ 寫進 README〈與原版的差異〉。

### 3. 日夜衰減：兩層，分工不同

- **天空光的「等級」不隨時間變**：「Sky light is not reduced at night; rather, the spawning of mobs is determined by internal light values.」已查證（minecraft.wiki/Light，2026-10-20）→ **天空光等級是時間無關的**；畫面亮度由「亮度曲線」隨時間變。
- **內部天空光（生怪用）**：正午 15、午夜 4（晴天）；「To obtain an internal level for a sky light level s less than 15, take the internal level L at 15 and subtract from it the difference between 15 and s: L−(15−s).」同頁 → `internalSkyLight(level, t) = max(0, base(t) - (15 - level))`，`base(t)` 由 15（正午）降到 4（午夜）。
- **渲染亮度的日夜比**：「at night brightness is reduced to about 17% and is shaded blue. Full darkness is about 5% brightness.」同頁 → 本作的下限 `MIN_LIGHT_FACTOR = 0.05`；天空比例 `SKY_SCALE_NIGHT = 0.85`（見 §5 的推導）。
- **（簡化，明示）** 原版的天空比例是查表（每 8 tick 一階梯的內部天空光表）。本作用 `dayFactor(t)`（與 `daynight.ts` 現有的 `dayF` 同一條曲線）做**連續插值** → 寫進 README。

### 4. 生怪判準（1.18+）

- **敵對**：「In the Overworld, if the internal sky light level is 7 or less (which always occurs inside a cave) and the block level is 0, all Overworld monsters can spawn.」已查證（minecraft.wiki/Mob_spawning，2026-10-20）→ `canSpawnHostile = internalSky <= 7 && block === 0`。
- **被動**：「The spawning block must have a light level of 9 or greater.」（Passive mobs 段）同頁；Light 頁補充：「Passive mobs … require a block light level of 9 or higher when the block is not exposed to the sky.」→ `canSpawnPassive = max(clientSky, block) >= 9`（**用客戶端天空光**，時間無關 → 夜間地表仍可生成被動生物，與原版一致）。
- **（簡化，明示）** 原版敵對生成還有「≤ 隨機 0..7 的機率」與生成點半徑 24–128（沿用 B4 的 24–128 與上限 12）；本批只換**光照判準**，其餘生成排程不動。

### 5. 渲染模型（頂點亮度 + 角落平均 + 著色器 uniform）

- **本批的最終亮度公式**（每個頂點）：

  ```
  lightFactor = max( MIN_LIGHT_FACTOR,
                     max( blockLevel / 15,
                          (skyLevel / 15) * skyScale(t) ) )
  ```

  - `MIN_LIGHT_FACTOR = 0.05`（原版「Full darkness is about 5% brightness」）。
  - `skyScale(t) = SKY_SCALE_NIGHT + (1 - SKY_SCALE_NIGHT) * dayFactor(t)`，`SKY_SCALE_NIGHT = 0.85`。
  - **推導（為什麼不是 0.17 也不是 1.0）**：本作場景端已有自己的日夜（`daynight.ts`：`DAY_AMBIENT 0.75 → NIGHT_AMBIENT 0.25`、`DAY_SUN 0.9 → NIGHT_SUN 0.12`）。以頂面計，日間總亮度 = 1.0 × (0.75 + 0.9) = 1.65、夜間（無天空比例時）= 1.0 × 0.25 = 0.25 → 已經是原版的 0.15（≈17%）。若再疊一層 0.17 的天空比例，夜晚會變成原版的 1/5（幾乎全黑）。因此本批只疊一層**輕微**的天空比例 0.85（夜間總量 ≈ 0.21 ≈ 日間的 13%，比原版暗一點但仍可辨識），並在 README 記為簡化。
  - **白天不變**：正午地表天空光 15 → 比例 = 1.0 → 與 B6 之前的外觀**完全一致**（這是「不造成視覺回歸」的驗收點）。
- **角落平均（平滑）**：每個頂點的光照 = 該角點周圍（面向前面一側）最多 4 個方塊的光照平均，**不透明方塊不列入平均**（對應原版的 Smooth lighting／Ambient occlusion 段：「For each corner of a side, the game checks diagonally for full blocks and determines the corner's brightness based on the found full blocks」）。天空光與方塊光**分別平均**（避免日夜比例被平均掉）。
- **合併後的 quad 角落取樣規則（2026-10-20 稽核修正）**：貪心合併後一個 quad 可能覆蓋多格（最大 16×16），**每個角要用「該角所在格」的角落平均**，不是 anchor 格的平均值。理由：用 anchor 格會讓 16 格大的地板只帶 anchor 的 4 個角值 → 整片地面出現一道線性漸層（光被抹開），且 quad 的遠端兩角拿到錯格的取樣 → 光邊界錯位。實作上 `greedySweep` 的 emit 回呼已經拿到 `(au, av, w, h)` → 4 個角分別對應格 `(au,av)`、`(au+w−1,av)`、`(au,av+h−1)`、`(au+w−1,av+h−1)`（對應 `emitQuad` 的角序 u0v0／u1v0／u0v1／u1v1）→ 每個角各算一次角落平均。**（2026-10-20 稽核修正：原計畫只寫「`emitQuad` 多收一組 `cornerLight[4]`」，沒有說明合併 quad 的 4 個角各用哪一格的取樣 → 會被實作者自然地寫成 anchor 取樣。）**
- **貪心合併的切分**：合併簽章加入 8 位「光照鍵」（天空 4 位＋方塊 4 位）→ 光照不同的相鄰面**不合併**（與 AO 的處理一致），因此光照邊界是乾淨的階梯；每個 quad 內的頂點光由角落平均提供 → 邊界處有柔和過渡。
- **日夜不重網格**：天空比例是著色器 uniform（`uSkyScale`），每幀從 `skyLightScale(clock.t)` 更新 → 太陽落下時地形**即時**變暗，**零重算、零重網格**（這就是 spec §B6.1 的「白天光變化的局部更新」的實作）。

### 6. 資料結構與記憶體（算式寫給讀者看）

```
每格 1 byte：bit 7..4 = 天空光（0..15）、bit 3..0 = 方塊光（0..15）
每區塊格數 = 16（X） × 256（Y） × 16（Z） = 65,536 格
每區塊光照 = 65,536 格 × 1 byte = 65,536 B = 64 KiB

預設 renderDistance = 10（settings.ts DEFAULT_SETTINGS）：
  需要光照的區塊 = mesh 半徑 10 + 生成環 1  →  (2×11+1)² = 529 塊
  光照記憶體 = 529 × 64 KiB ≈ 33.9 MB（32.3 MiB）
  對照組：方塊資料 529 × 64 KiB ≈ 33.9 MB（既有成本）
  world.chunks 最多保留 (2×12+1)² = 625 塊（r+2 卸載半徑），其餘不放光照陣列

緩解措施（本批即做）：
  - 延遲配置：只有「被點過光」的區塊才有光照陣列（`chunk.light === null` 表示未算）
  - 隨區塊生命週期釋放：區塊被卸載（world.removeChunk）時陣列一起被 GC
  - 天空光柱的掃描上界＝`chunk.topY`（只增不減的上界）→ 掃描只覆蓋可能有幾何的
    高度範圍（已用腳本驗證：與「掃到頂端」在取樣範圍內 0 格差異）
未採用的方案（記錄理由）：
  - 垂直範圍砍到 192：省 25%，但玩家蓋到 192 以上的火把不會發光（不划算）
  - 4 bits/通道 × 2 通道已是 1 byte/格的下限（原版 Java 也是 64 KiB/區塊）
```

### 7. 重算成本與效能預算

**（2026-10-20 稽核修正：原 §7 寫「≤ 3 ms／區塊」、Task 8 的守門測試卻寫「< 8 ms」，兩處不一致。本節、Task 3、Task 8、〈批末驗收〉現在一律用同一個門檻 **8 ms／區塊**，並寫明量測口徑。）**

```
單區塊重算（computeChunkLight(world, cx, cz)）：
  1. 清 0：65,536 byte memset                                          ≈ 0.05 ms
  2. 播種掃描：3×3 群組（最多 9 塊）× 65,536 格找 emission > 0 的來源 ≈ 0.6 ms
  3. 天空光柱掃描：3×3 群組 × 16×16 柱 × 「從 `chunk.topY` 往下掃到第一個
     不透明塊」（地表 ≈ 70 高 → 每柱約 8 格）                              ≈ 0.2 ms
     ★ 掃描上界不是 CHUNK_HEIGHT-1：最高方塊之上的開闊天空永遠不會被取樣
       （mesher 只取「面向前面那一格」的光照，最高只到最高方塊 + 1），
       掃到頂端會多花 15 倍且不影響任何取樣結果（已用腳本比對：0 格差異）。
  4. BFS：起始格 ≈ 群組內所有天空 15 的柱 + 所有發光來源 × 6 鄰居       ≈ 1–3 ms
     ★ 天空光用「整區塊一次多來源 BFS」（不是每個種子格各跑一次）：兩者結果
       完全相同（腳本逐格比對：0 格差異），但快約 15 倍（未最佳化腳本
       560 ms → 35 ms／區塊）。
  → 門檻 ≤ 8 ms／區塊（含清 0、播種、BFS、跨區塊寫入；不含網格重建）
  → 主執行緒預算：每幀最多 2 個區塊（與既有 mesh 預算相同）→ 最壞 +16 ms／幀

回歸門檻（測試）：
  - 單區塊重算 < 8 ms（Task 8 的守門測試，量測口徑見上）
  - 連續「生成＋點光」16 個區塊 < 1500 ms（B3 的既有門檻沿用）
  - 初始載入：renderDistance 10 → 529 塊待點光；每幀 2 塊 → 約 265 幀（60 fps ≈ 4.4 s）
    → 因此「出生區（半徑 2 的 5×5 = 25 塊）」在開局**同步**點亮（Task 3 Step 5），
      玩家眼前第一幀就是正確的光；遠處的 504 塊在接下來約 4 秒內補齊。
```

### 8. 存檔政策

- 光照是**導出資料**：不入本機 payload、不入雲端 payload（公約 §3 的 B6 條）。
- 火把方塊本身走既有 `modified` overlay（`world.setBlock` 會記錄）→ 存檔往返後火把還在、光照在載入時重算。
- **舊版風險（spec §B6.1 明列）**：0.8.0 讀到 block id 32（未知）時 `getBlockDef(32)` 落到 `DEFS[0]`（空氣）→ 舊版會把火把顯示成空氣（**不會崩**，因為 `DEFS[id] ?? DEFS[0]` 有 fallback）。此點寫進發布說明〈存檔格式與相容性提示〉與 README。
- 存檔 payload 版本維持 v4、雲端維持 format 2 → `game.json` 不動。

---

## 檔案結構

| 檔案 | 動作 | 職責 |
|---|---|---|
| `src/world/lighting.ts` | 新增 | 光照引擎：儲存讀寫、方塊光 BFS、天空光柱掃描＋BFS、**3×3 群組播種**（跨區塊一致性）、`internalSkyLight`／`skyLightScale`／`spawnLightAt`／`groupChunks`／`takeLightBudget`／`sortLightQueueByDistance` |
| `src/world/lighting.test.ts` | 新增 | 傳播／衰減／遮蔽／跨邊界／破壞後更新／日夜函式的單元測試 |
| `src/world/chunk.ts` | 修改 | `light: Uint8Array \| null`（延遲配置、每格 1 byte）＋ `lightDirty` 旗標 ＋ `topY`（天空光柱掃描上界，只增不減） |
| `src/world/chunk.test.ts` | 修改 | 光照陣列的配置／索引測試（若既有檔案存在；否則併入 `lighting.test.ts`） |
| `src/world/world.ts` | 修改 | `setBlock` 標記受影響區塊的 `lightDirty`（含**八鄰**）；`removeChunk` 自然釋放光照陣列 |
| `src/world/mesher.ts` | 修改 | 合併簽章加入光照鍵；`MeshData` 加 `lightSky`／`lightBlock` 頂點屬性；角落平均；新增 `torches` pass（小模型） |
| `src/world/mesher.test.ts` | 修改 | 光照鍵切分、頂點光屬性、火把模型幾何的測試 |
| `src/render/chunk-renderer.ts` | 修改 | 幾何加掛兩個光屬性；**新增** `patchTerrainLightShader`（`patchTextureArrayShader` 維持原樣）；`ChunkRenderer.setSkyScale` ＋ 共用 `LightUniforms` |
| `src/render/chunk-renderer.test.ts` | 修改 | 著色器 patch 與 uniform 的測試 |
| `src/render/particles.ts`、`src/render/viewmodel.ts` | **不動** | 繼續用 `patchTextureArrayShader`（不掛光照）→ 粒子與手持物亮度不變（2026-10-20 稽核修正） |
| `src/render/particles.test.ts`、`src/render/viewmodel.test.ts` | 修改 | 守門測試：這兩個材質**不含** `uSkyScale`（不含 lightSky 屬性） |
| `src/render/textures.ts` | 修改 | `T.TORCH` 的圖樣（細木棒＋火苗） |
| `src/render/textures.test.ts` | 修改 | 新 tile 已畫（不得是洋紅除錯色）的測試 |
| `src/world/blocks.ts` | 修改 | `BLOCK.TORCH = 32`、`T.TORCH`、`DEFS[32]`（`emission: 14`、`shape: 'torch'`、`solid: false`、`hardness: 0`）、`PLACEABLE` |
| `src/world/blocks.test.ts` | 修改 | 新方塊資料與 id 不變式（既有測試有「窮舉所有 block id」的斷言，必須補火把那一列） |
| `src/core/items.ts` | 修改 | `ItemId` 加 `torch`、`ITEM_IDS` 加一筆、`BLOCK_PAIRS` 加 `['torch', BLOCK.TORCH]` |
| `src/core/recipes.ts` | 修改 | 新配方 `torch`（煤上木棍下 → 4 個） |
| `src/core/recipes.test.ts` | 修改 | 新配方測試（既有「配方數量」斷言要更新） |
| `src/world/drops.ts` | 修改 | 火把掉落自身（走既有 `itemFromBlock`，可能只需補測試） |
| `src/player/interact.ts` | 修改 | `canPlaceTorch`；`canPlaceAt` 對非實心方塊略過玩家 AABB 檢查 |
| `src/player/interact.test.ts` | 修改 | 火把放置規則的測試 |
| `src/world/spawn-rules.ts` | 修改 | `SpawnLight` 加 `internalSky`；`canSpawnHostile` 改用 `internalSky`；刪 `clockLight` |
| `src/world/spawn-rules.test.ts` | 修改 | 新判準的測試（B4 的 `clockLight` 斷言改寫） |
| `src/world/mobs.ts` | 修改 | `SpawnCtx.isNight` → `lightAt`；`trySpawnMob` 依生成點的光照判準；檔頭註解改寫 |
| `src/world/mobs.test.ts` | 修改 | 生成判準的 fixture 更新 |
| `src/world/passive-mobs.ts` | 修改 | `PassiveSpawnCtx.light` → `lightAt`；改成**逐隻**檢查生成點的光照 |
| `src/world/passive-mobs.test.ts` | 修改 | 「夜間不生成」改寫成「暗處不生成」（見 Task 7） |
| `src/core/daynight.ts` | 修改 | 匯出 `dayFactor(t)`（把 `skyColors` 內同一條曲線抽成共用函式，行為不變） |
| `src/core/daynight.test.ts` | 修改 | `dayFactor` 的釘值測試 |
| `src/main.ts` | 修改 | 光照佇列（生成／改方塊後重算）、每幀更新天空比例、生成／放置／破壞的接線、生怪判準接線 |
| `src/world/lighting-perf.test.ts` | 新增 | 重算耗時、記憶體、幀預算的回歸門檻 |
| `README.md`、`docs/releases/v0.9.0.md`、`package.json`、`game.json` | 修改／新增 | Task 9 發布 |

---

### Task 1: 光照儲存層與方塊光引擎（傳播／衰減／遮蔽／跨區塊／破壞後更新）

**Files:**
- Create: `src/world/lighting.ts`、`src/world/lighting.test.ts`
- Modify: `src/world/chunk.ts`（`light` 陣列＋`lightDirty`）、`src/world/world.ts`（`setBlock` 標記 dirty）、`src/world/blocks.ts`（`BlockDef.emission?` 選用欄位）
- Test: `src/world/lighting.test.ts`

**Interfaces:**
- Consumes: `World`／`Chunk`（`src/world/world.ts`、`src/world/chunk.ts`）、`BLOCK`／`getBlockDef`／`isTransparent`／`isSolid`（`src/world/blocks.ts`）。
- Produces（後續任務依賴）：
  - `src/world/blocks.ts`：`BlockDef` 新增**選用**欄位 `emission?: number`（0..15，未列＝0；既有 17 筆 `DEFS` 一行都不用改）→ 這是本批第一個用到「發光方塊」的接縫，Task 5 只負責把火把的 `emission` 設成 14。
  - `src/world/chunk.ts`：
    ```ts
    /** 每格 1 byte：bit 7..4 = 天空光、bit 3..0 = 方塊光；null = 尚未點光。 */
    light: Uint8Array | null = null;
    /** 光照需要重算（改方塊或剛生成時由 lighting.ts 設定）。 */
    lightDirty = false;
    /** 天空光柱掃描的上界（= 曾經有過方塊的最高 y + 1）。只增不減。 */
    topY = 0;
    /** 取得（必要時配置）本區塊的光照陣列。 */
    ensureLight(): Uint8Array;
    ```
  - `src/world/lighting.ts`：
    ```ts
    /** 掃一次區塊資料 → 最高的非空氣格 y + 1（生成完成時呼叫，設定 `chunk.topY`）。 */
    export function computeChunkTopY(chunk: Chunk): number;
    ```
  - `src/world/lighting.ts`：
    ```ts
    export const MAX_LIGHT = 15;
    export const TORCH_LIGHT = 14;
    export interface LightLevels { sky: number; block: number }
    export function lightAt(world: World, x: number, y: number, z: number): LightLevels;
    export function blockLightAt(world: World, x: number, y: number, z: number): number;
    export function skyLightAt(world: World, x: number, y: number, z: number): number;
    /** 設定某格的光照；目標區塊不存在時**不寫入也不回報**（回傳 false）。 */
    export function setLight(world: World, x: number, y: number, z: number, levels: LightLevels): boolean;
    /** 某格是否為不透明（擋光）方塊。 */
    export function isOpaqueAt(world: World, x: number, y: number, z: number): boolean;
    /** 由光源做 flood-fill 傳播（方塊光通道）。 */
    export function propagateBlockLight(world: World, sx: number, sy: number, sz: number, level: number): void;
    /** 重算整個區塊的光照（清 0 → 播種 → BFS）。 */
    export function computeChunkLight(world: World, cx: number, cz: number): void;
    /** 把區塊與其**八個**鄰塊（含對角）標成需要重算光照。 */
    export function markLightDirty(world: World, cx: number, cz: number): void;
    ```

**已查證數值**：見〈已查證與設計決策〉§1（等級 0–15、火把 14、每格 −1 的 taxi-cab 衰減）。

**設計決策（要寫進註解）**：
- **不透明方塊不持有光**（值恆 0）→ 與原版「opaque blocks can prevent the spread of sky light」一致，也讓角落平均可以自然排除它們。
- **跨區塊讀寫**：所有取光／設光都走**世界座標**（`world.getChunk(cx,cz)` → 該區塊的 `light` 陣列；區塊不存在 → 讀 0、**寫不進去、也不建立區塊**）。鄰塊不存在時光「寫不進去」→ 由 Task 3 的跨區塊機制補回（後生成的鄰塊會把光帶回來）。
- **BFS 的終止條件（2026-10-20 稽核修正，必讀）**：`setLight` 對不存在的區塊**寫不進去**，此時**絕對不可把該格 push 進佇列**。天空光的衰減規則是「從 15 往下傳不衰減」→ 該格每被 pop 一次就會以 level 15 重新 push，而「只寫入比現值高的格」永遠成立（寫不進去 → 讀回 0）→ **佇列無限膨脹、每 pop 一次再生 6 個新項 → RangeError／OOM**。天空光的水平傳播必須先被某個格「照亮」才會發生 → 從未被水平照到的開闊天空柱永遠是 0（這是本引擎的已知簡化，寫進註解與 README）。
- **重算的粒度＝一個區塊，但播種範圍＝3×3 群組（2026-10-20 稽核修正）**：`computeChunkLight(world, cx, cz)` **只清空並重算區塊 (cx,cz) 自己**，但**播種時掃描 (cx,cz) 周圍 3×3 群組（含對角）內所有已存在區塊的發光來源**。理由：(a) 半徑 15 的光只可能從 3×3 群組內的來源到達本區塊 → 群組就是完整的來源集合；(b) 光會跨邊界寫進鄰塊 → 鄰塊必須一起被標記重算（否則挖掉火把會在**對角鄰塊**留下永久幽靈光，因為 BFS 走 6 鄰居時會經過正交鄰塊寫進對角區塊）。原計畫的 `syncChunkLightWithNeighbors`（事後把鄰塊的光「拉」回來）**刪除**：該版本讀寫的是同一格（讀鄰塊的 (wx,wy,wz)、又寫回同一個世界座標 → 永遠是同一格 → `sky > skyLightAt(...)` 恆為 false → 整個函式是無效的 no-op）。
- **本任務只做方塊光通道**；天空光在 Task 2 接上（`computeChunkLight` 的骨架在此建立）。

- [ ] **Step 1: 寫測試（失敗）** — `src/world/lighting.test.ts`

  測試輔助（測試檔內自帶，不依賴 main）：
  ```ts
  const world = new World();
  const fill = (w: World, id: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) w.setBlock(x, y, z, id as BlockId);
  };
  ```
  測試名與斷言：
  - `'a torch lights its neighbours with the vanilla decay'`：造 `STONE` 於 (0,64,0)、`TORCH` 於 (0,65,0) → `computeChunkLight(world, 0, 0)` → 斷言 `blockLightAt(world,0,65,0) === 14`（光源格）、`blockLightAt(world,1,65,0) === 13`、`blockLightAt(world,0,66,0) === 13`、`blockLightAt(world,1,66,0) === 12`（斜對角 = 14−2）、`blockLightAt(world,0,64,0) === 0`（不透明支撐不持有光）。
  - `'opaque blocks stop the light'`：造一排 `STONE` 隔開光源與目標 → 目標格 `blockLightAt(...) === 0`。
  - `'light crosses the chunk border'`：**先讓鄰塊存在**（`world.addChunk(new Chunk(1, 0))`），再 `setBlock(15,64,0, TORCH)` → `computeChunkLight(world,0,0)` → `blockLightAt(world,16,64,0) === 13`（x=16 屬區塊 (1,0)）。
    **（2026-10-20 稽核修正：原註解寫「`setBlock` 會自動建立該區塊」是錯的 —— `setBlock(15,…)` 建的是區塊 (0,0)，(1,0) 從未被建立；依「區塊不存在 → 讀 0、寫入不建立區塊」的規則，光寫不進 (1,0) → 實測為 0。測試必須先建立鄰塊。）**
  - `'light spreads back into a late neighbour'`：只有區塊 (0,0)（`setBlock(15,64,0, TORCH)`）→ `computeChunkLight(world,0,0)` → 斷言 `blockLightAt(world,16,64,0) === 0`（鄰塊不存在 → 光寫不進去）；**之後** `world.addChunk(new Chunk(1, 0))`（鄰塊較晚生成）→ `computeChunkLight(world,1,0)` → 斷言 `blockLightAt(world,16,64,0) === 13`（光被「拉」回新鄰塊）。
  - `'breaking a torch removes its light'`：算完後 `setBlock(0,65,0, BLOCK.AIR)` → `computeChunkLight(world,0,0)` → `blockLightAt(world,0,65,0) === 0` 且 `blockLightAt(world,1,65,0) === 0`。
  - `'the light array is allocated lazily and holds one byte per cell'`：新建區塊 → `chunk.light === null`；`computeChunkLight` 後 → `chunk.light!.length === 65536`；且 `chunk.light![chunkIndex(0,65,0)] & 0x0f === 14`（方塊光在低 4 位）。
  - `'setting a block marks the chunk and its eight neighbours for relighting'`：**先把 3×3 的九個區塊都建好**（`for (dx of [-1,0,1]) for (dz of [-1,0,1]) world.addChunk(new Chunk(dx, dz));`）→ `world.setBlock(0,65,0, TORCH)` → 斷言 `world.getChunk(0,0)!.lightDirty === true`、`world.getChunk(1,0)!.lightDirty === true`（正交鄰塊）、`world.getChunk(-1,-1)!.lightDirty === true`（**對角鄰塊也要標**——BFS 走 6 鄰居時會經過正交鄰塊寫進對角區塊）。
    **（2026-10-20 稽核修正：原測試名寫「four neighbours」，實作也只標 4 個 → 對角鄰塊永遠留著幽靈光。另外九個區塊必須先 `addChunk` 建好，否則 `getChunk(-1,-1)` 是 undefined → 測試會拋錯而不是斷言。）**
  - `'the light engine terminates when the neighbour chunks are missing'`：世界裡**只有**區塊 (0,0)（`world.addChunk(new Chunk(0,0))`）→ `computeChunkLight(world,0,0)` 必須**在合理時間內結束**（用 `performance.now()` 量測 < 2000 ms 作為「沒有無限膨脹」的保險；不是效能門檻）→ 且 `blockLightAt(world,0,65,0) === 0`。
    **（2026-10-20 稽核修正：這是稽核報告的 Critical —— 原計畫的 BFS 會對不存在的區塊不斷 push → 佇列長到 2³² → `RangeError: Invalid array length`，Task 2 的每個天空光測試都會掛住 runner。必須有守門測試。）**

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/world/lighting.test.ts`
  Expected: FAIL（`src/world/lighting.ts` 不存在）。

- [ ] **Step 3: 實作 `src/world/chunk.ts` 的儲存層**

  - `Chunk` 加 `light: Uint8Array | null = null;`、`lightDirty = false;` 與 **`topY = 0;`**（天空光柱掃描的上界；只增不減 → 挖掉最高方塊後掃描帶仍涵蓋曾經受光的高度）。
  - `ensureLight(): Uint8Array`：`if (!this.light) this.light = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT); return this.light;`（索引與方塊資料同 layout：`chunkIndex(lx, ly, lz)` ✓）。
  - `Chunk.set()` 不動（方塊改動由 `World.setBlock` 標記 `lightDirty`）。
  - **`World.setBlock` 更新 `topY`**：`chunk.topY = Math.max(chunk.topY, y + 1);`（只增不減）。
  - **地形生成完成後設定 `topY`**：terrain 的資料是整塊寫入（`chunk.data.set(terrain)`，不經 `setBlock`）→ 生成完成時呼叫 `computeChunkTopY(chunk)`（掃一次區塊資料找最高的非空氣格 → `y + 1`）並寫回 `chunk.topY`（Task 3 Step 5 的接線）。**（2026-10-20 稽核修正：這是「天空光柱掃描上界＝`chunk.topY`」的必要配套 —— 沒有它，生成出來的區塊 `topY` 會是 0 → 天空光柱不會往下掃 → 地表一片黑。）**

- [ ] **Step 4: 實作 `src/world/lighting.ts`（方塊光通道）**

  - 常數：`MAX_LIGHT = 15`、`TORCH_LIGHT = 14`。
  - 讀寫（世界座標）：
    ```ts
    const cellIndex = (cx: number, cz: number, lx: number, ly: number, lz: number) => chunkIndex(lx, ly, lz);
    export function blockLightAt(world: World, x: number, y: number, z: number): number {
      if (y < 0 || y >= CHUNK_HEIGHT) return 0;
      const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
      const chunk = world.getChunk(cx, cz);
      if (!chunk || !chunk.light) return 0;
      return chunk.light[chunkIndex(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE)] & 0x0f;
    }
    ```
    `skyLightAt` 同理取 `>> 4`；`setLight` **先確認目標區塊存在**（不存在 → 直接回傳 false，**不寫、不建立區塊**），存在才 `ensureLight()` 寫入 `sky << 4 | block` 並 `world.markDirty(cx, cz)`（要重網格）。
  - `isOpaqueAt(world,x,y,z)` = `!isTransparent(world.getBlock(x,y,z))`（`isTransparent` 來自 `src/world/blocks.ts`）。
  - **BFS 佇列**（共用一個模組層級的可成長 `Int32Array`，每格 4 個 int：x、y、z、level；避免每格配置物件）：
    ```ts
    // 佇列以 Int32Array 儲存（每格 4 ints：x,y,z,level），head 索引前進、push 時容量不足就翻倍
    function propagateBlockLight(world: World, sx: number, sy: number, sz: number, level: number): void {
      pushQueue(sx, sy, sz, level);
      while (queueHead < queueLength) {
        const cx = queue[queueHead++], cy = queue[queueHead++], cz = queue[queueHead++], lv = queue[queueHead++];
        if (lv <= 1) continue;
        for (const [dx, dy, dz] of NEIGHBORS6) {          // 6 方向：±x ±y ±z
          const nx = cx + dx, ny = cy + dy, nz = cz + dz;
          if (ny < 0 || ny >= CHUNK_HEIGHT) continue;
          if (isOpaqueAt(world, nx, ny, nz)) continue;     // 不透明方塊擋光
          const next = lv - 1;                            // 每格 −1（taxi-cab）
          if (blockLightAt(world, nx, ny, nz) >= next) continue;
          // ★ 目標格所在區塊不存在 → 不寫、**也不 push**（否則佇列無限膨脹 → RangeError）
          if (!setLight(world, nx, ny, nz, { sky: skyLightAt(world, nx, ny, nz), block: next })) continue;
          pushQueue(nx, ny, nz, next);
        }
      }
      resetQueue();
    }
    ```
  - `computeChunkLight(world, cx, cz)`（本任務只做方塊光；天空光在 Task 2 補上）：
    ```ts
    const chunk = world.getChunk(cx, cz);
    if (!chunk) return;
    chunk.ensureLight().fill(0);          // ★ 只清本區塊；鄰塊由它們自己的重算負責
    // 播種：掃描 3×3 群組（(cx±1, cz±1)，含對角）內所有已存在區塊的發光來源
    // （半徑 15 的光只可能來自 3×3 群組 → 群組就是完整的來源集合；
    //   鄰塊不存在就跳過 → 光寫不進不存在的區塊）
    for (const src of groupChunks(world, cx, cz)) {
      for (let ly = 0; ly < CHUNK_HEIGHT; ly++)
        for (let lz = 0; lz < CHUNK_SIZE; lz++)
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const id = src.data[chunkIndex(lx, ly, lz)];
            const emission = getBlockDef(id).emission ?? 0;
            if (emission <= 0) continue;
            const wx = src.cx * CHUNK_SIZE + lx, wz = src.cz * CHUNK_SIZE + lz;
            if (!setLight(world, wx, ly, wz, { sky: skyLightAt(world, wx, ly, wz), block: emission })) continue;
            propagateBlockLight(world, wx, ly, wz, emission);
          }
    }
    chunk.lightDirty = false;
    ```
    （`emission` 欄位在 `BlockDef` 為**選用**（`emission?: number`），既有 17 筆 `DEFS` 不必改；`getBlockDef(id).emission ?? 0` 取值。）
    `groupChunks(world, cx, cz)`：回傳 `(cx+dx, cz+dz)`（dx、dz ∈ {−1,0,1}）中**已存在**的區塊陣列（沒有就回空陣列）。
  - `src/world/blocks.ts`（**本任務就要加**）：`BlockDef` 介面加選用欄位 `emission?: number`（0..15；未列＝0）→ 既有 `DEFS` 的 17 筆**一行都不用改**（選用欄位不影響 `toEqual` 的既有斷言）。
  - `markLightDirty(world, cx, cz)`：把 `(cx,cz)` 與存在的**八個**鄰塊（`(cx±1,cz)`、`(cx,cz±1)`、**`(cx±1,cz±1)` 對角**）的 `lightDirty = true`。
    **（2026-10-20 稽核修正：原設計只標 4 個正交鄰塊 → 挖掉區塊角落的火把時，BFS 經正交鄰塊寫進對角區塊的光永遠留在那裡（永久幽靈光，且已被標成需重網格 → 會被畫出來）。實測：火把在 (0,65,0) → 對角格 (−1,65,−1) = 12；挖掉火把只重算 chunk(0,0) → 仍是 12（期望 0）。）**
  - `src/world/world.ts`：`setBlock` 末尾（既有 `this.modified.set(...)` 之後）呼叫 `markLightDirty(this, cx, cz)`（八鄰由 `markLightDirty` 內處理）並更新 `chunk.topY = Math.max(chunk.topY, y + 1)`。注意 `setBlock` 目前會 `markDirty` 鄰塊（網格），光照標記是另一套旗標 ✓ 兩者不混用。

- [ ] **Step 5: 跑測試轉綠**

  Run: `npx vitest run src/world/lighting.test.ts`
  Expected: PASS。

- [ ] **Step 6: 全量 gates**

  Run: `npm run typecheck && npm test && npm run build && npm run lint`
  Expected: 全綠（既有 806 tests 一個不多、一個不少）。

- [ ] **Step 7: Commit**

  ```bash
  git add src/world/lighting.ts src/world/lighting.test.ts src/world/chunk.ts src/world/world.ts src/world/blocks.ts
  git commit -m "feat(light): B6.1 光照儲存層與方塊光引擎（BFS 傳播、每格 −1、跨區塊；目標區塊不存在時不寫不 push 以保證佇列終止；播種掃描 3×3 群組；改方塊標記八個鄰塊）"
  ```

---

### Task 2: 天空光引擎（垂直下傳、水平衰減、跨區塊、日夜／內部天空光函式）

**Files:**
- Modify: `src/world/lighting.ts`、`src/world/lighting.test.ts`
- Modify: `src/core/daynight.ts`（匯出 `dayFactor`）、`src/core/daynight.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `lightAt`／`setLight`／`propagateBlockLight`；`src/core/daynight.ts` 的 `Phase`。
- Produces:
  - `src/core/daynight.ts`：`export function dayFactor(t: number): number`（＝`skyColors` 內部的 `dayF`：正午 1、夜間 0；`skyColors` 改呼叫它，**數值不變**）。
  - `src/world/lighting.ts`：
    ```ts
    /** 內部天空光（生怪判準用）：正午 15、午夜 4；level < 15 時再減 (15 - level)。 */
    export function internalSkyLight(skyLevel: number, t: number): number;
    /** 渲染用天空比例：正午 1.0、夜間 SKY_SCALE_NIGHT。 */
    export function skyLightScale(t: number): number;
    export const SKY_SCALE_NIGHT = 0.85;
    export const MIN_LIGHT_FACTOR = 0.05;
    /** 天空光的 flood-fill（垂直下傳保持 15、其餘 −1）。目標區塊不存在 → 不寫不 push。 */
    export function propagateSkyLight(world: World, sx: number, sy: number, sz: number, level: number): void;
    /** 逐柱播種天空光 15（遇到第一個不透明方塊即停）；整區塊一次多來源 BFS。 */
    export function seedSkyColumns(world: World, cx: number, cz: number): void;
    ```

**已查證數值**：見〈已查證與設計決策〉§2／§3（天空光 15、垂直下傳不變、水平 −1、低於 15 像方塊光衰減、內部天空光 L−(15−s)）。

**設計決策**：
- **柱掃描**：每條柱從**本區塊的掃描上界 `chunk.topY`**（= 曾經有過方塊的最高 y + 1）往下掃，遇到第一個不透明方塊就停；其上所有透明格的天空光 = 15。**透明格包含水、玻璃、葉、植被**（簡化：不做過濾衰減）。
  **（2026-10-20 稽核修正：掃描上界由 `CHUNK_HEIGHT - 1` 改為 `chunk.topY` —— 最高方塊之上的開闊天空永遠不會被取樣（mesher 只取「面向前面那一格」，最高只到最高方塊 + 1）；掃到頂端會多花約 15 倍時間且不影響任何取樣結果（已用腳本比對：0 格差異）。`topY` **只增不減**（`setBlock` 時 `Math.max(topY, y + 1)`）→ 挖掉最高的方塊後掃描帶仍涵蓋曾經受光的高度 → 「挖掉屋簷 → 天空光回到 15」這條行為不受影響。）**
- **天空光 BFS**：衰減 `next = (dy === -1 && lv === 15) ? 15 : lv - 1`；不透明鄰居跳過；只往上寫（不降級既有值）；**目標區塊不存在 → 不寫、也不 push**（與方塊光同一條終止規則，否則垂直不衰減會讓佇列無限膨脹）。
- **天空光播種用「整區塊一次多來源 BFS」**：不要每個種子格各跑一次 BFS。兩種寫法的**結果完全相同**（已用腳本逐格比對：0 格差異），但多來源版快約 15 倍（未最佳化的腳本：560 ms → 35 ms／區塊；再配合上面的有界掃描 → 8 ms）。
- **跨區塊**：與方塊光同一套世界座標讀寫；差在「鄰塊尚未生成」→ Task 3 的跨區塊機制補回（後生成的鄰塊重算時會把光帶回來）。

- [ ] **Step 1: 寫測試（失敗）** — 追加到 `src/world/lighting.test.ts`

  - `'open sky is 15 and a roof shades the ground one level at a time'`：造 `STONE` 地板 (0..15, 63, 0..15)、屋簷 `STONE` 於 (5,70,5) → `computeChunkLight(world,0,0)` → 斷言 `skyLightAt(world,5,71,5) === 15`（屋簷上方）、`skyLightAt(world,4,69,5) === 15`（旁邊的開闊柱）、`skyLightAt(world,5,69,5) === 14`（屋簷下：水平 −1）、**`skyLightAt(world,5,68,5) === 14`**（不是 13！見下）。
    **（2026-10-20 稽核修正：原斷言是 `=== 13`，是錯的。(4,\*,5) 是開闊柱（天空光 15），它會在**每一個高度**水平餵 14 給 (5,\*,5) 這一列 → 整列都是 14，不會「每往下一格 −1」。已用腳本重算：(5,71,5)=15、(4,69,5)=15、(5,69,5)=14、**(5,68,5)=14**。原版行為也支持 14（單格厚屋簷下整列只暗一階）。）**
  - `'a walled pocket loses one level per step from the opening'`（**這才是「逐格 −1」的正確語意**）：造一個有牆、有地板、屋頂只開一個洞的密閉口袋 → 洞口的柱是 15，往洞內每走一格暗一階。
    具體造法（座標寫死、測試自足）：
    - 地板：`STONE` 於 (0..15, 63, 0..15)；
    - 屋頂：`STONE` 於 (0..15, 70, 0..15)，**但 (0,70,5) 留空**（唯一的洞口）；
    - 側牆 z = 0 與 z = 15、後牆 x = 15：`STONE` 於 (0..15, 64..69, 0)／(0..15, 64..69, 15)／(15, 64..69, 5)。
    → `computeChunkLight(world,0,0)` → 斷言 `skyLightAt(world,0,69,5) === 15`（洞口正下方）、`skyLightAt(world,1,69,5) === 14`、`skyLightAt(world,2,69,5) === 13`、`skyLightAt(world,3,69,5) === 12`（每往內一格 −1），以及 `skyLightAt(world,2,68,5) === 13`（同一水平深度往下也是 13 → 深度由「離洞口的水平距離」決定）。
    **（2026-10-20 稽核修正：這條是原計畫缺少的測試 —— 原本沒有任何一條測試真正驗證「逐格 −1」。）**
  - `'a sealed cave has no sky light'`：造一個 3×3×3 的石頭空腔（挖掉中心）→ 斷言腔內 `skyLightAt(...) === 0`。
  - `'sky light crosses the chunk border'`：**先讓鄰塊存在**（`world.addChunk(new Chunk(1, 0))`），屋頂 `STONE` 放在**鄰塊**裡的 (16,70,5)（這樣 (16,69,5) 被遮蔽，它的光只能從區塊 (0,0) 的開闊柱水平過來）→ `computeChunkLight(world,0,0)` → 斷言 `skyLightAt(world,15,69,5) === 15`（開闊柱）、`skyLightAt(world,16,69,5) === 14`（跨邊界水平 −1）→ 再 `computeChunkLight(world,1,0)` 後仍為 14（不被清 0）。
    **（2026-10-20 稽核修正：原測試把屋頂放在 x = 15 卻斷言鄰塊的 (16,69,15) === 14 —— 但 (16,·,15) 那根柱本身是開闊的（沒有屋頂）→ 天空光 15，不是 14。屋頂必須放在鄰塊那一側才會得到 14。另外「鄰塊必須先存在」。）**
  - `'removing a roof restores the sky light'`：屋簷存在時 `skyLightAt(world,5,69,5) === 14`；`setBlock(5,70,5, AIR)` → `computeChunkLight(world,0,0)` → 斷言 `skyLightAt(world,5,69,5) === 15` 且 `skyLightAt(world,5,68,5) === 15`（垂直下傳不衰減）。
  - `'internal sky light follows the vanilla day curve'`：`internalSkyLight(15, 0.25) === 15`（正午）、`internalSkyLight(15, 0.75) === 4`（午夜）、`internalSkyLight(14, 0.25) === 14`、`internalSkyLight(0, 0.25) === 0`（洞穴：15 − 15 → 0）、`internalSkyLight(0, 0.75) === 0`（不得為負）。
  - `'the rendered sky scale is 1 at noon and dimmer at night'`：`skyLightScale(0.25) === 1`、`skyLightScale(0.75) === SKY_SCALE_NIGHT`、`skyLightScale(0.25) > skyLightScale(0.75)`。
  - `src/core/daynight.test.ts` 新增 `'dayFactor is 1 at noon and 0 deep at night'`：`dayFactor(0.25) === 1`、`dayFactor(0.75) === 0`、`dayFactor(0) >= 0 && dayFactor(1) >= 0`。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/world/lighting.test.ts src/core/daynight.test.ts`
  Expected: FAIL（`internalSkyLight`／`skyLightScale`／`dayFactor` 不存在；天空光仍是 0）。

- [ ] **Step 3: 實作 `dayFactor`（`src/core/daynight.ts`）**

  ```ts
  /** 白天權重：太陽仰角 → 0..1（正午 1、夜間 0）。skyColors 與 lighting 共用。 */
  export function dayFactor(t: number): number {
    const elev = Math.cos((t - 0.25) * Math.PI * 2);
    return clamp01((elev + 0.2) / 0.4);
  }
  ```
  `skyColors` 內的 `dayF` 改為呼叫 `dayFactor(t)`（**數值完全相同** → 既有 daynight 測試不動）。

- [ ] **Step 4: 實作天空光（`src/world/lighting.ts`）**

  - `propagateSkyLight(world, sx, sy, sz, level)`：與方塊光同構，衰減改為 `const next = (dy === -1 && lv === 15) ? 15 : lv - 1;`；只寫入比現值高的格；**`setLight` 回傳 false（區塊不存在）時 `continue`，不可 push**。
  - `seedSkyColumns(world, cx, cz)`：對每條柱（16×16）從**該區塊的 `chunk.topY`** 往下掃，把 15 寫進每一格並把種子收進一個佇列，**整區塊跑一次多來源 BFS**：
    ```ts
    export function seedSkyColumns(world: World, cx: number, cz: number): void {
      const chunk = world.getChunk(cx, cz);
      if (!chunk) return;
      const top = chunk.topY;                           // 掃描上界（只增不減）
      queueLength = 0; queueHead = 0;
      for (let lx = 0; lx < CHUNK_SIZE; lx++)
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
          const wx = cx * CHUNK_SIZE + lx, wz = cz * CHUNK_SIZE + lz;
          for (let ly = top; ly >= 0; ly--) {
            if (isOpaqueAt(world, wx, ly, wz)) break;     // 第一個不透明方塊 → 柱結束
            if (!setLight(world, wx, ly, wz, { sky: 15, block: blockLightAt(world, wx, ly, wz) })) break;
            pushQueue(wx, ly, wz, 15);                    // 種子進同一個佇列
          }
        }
      // 一次多來源 BFS（結果與「每個種子各跑一次 BFS」完全相同，但快約 15 倍）
      while (queueHead < queueLength) { /* 與 propagateSkyLight 相同的 6 鄰居擴張 */ }
    }
    ```
    `chunk.topY` 的維護（**見 Task 1 Step 3 的儲存層**）：`Chunk.topY` = 曾經有過方塊的最高 y + 1（`setBlock` 時只增不減；地形生成後由 `computeChunkTopY(chunk)` 掃一次設定）。
  - `computeChunkLight` 改為：`chunk.ensureLight().fill(0)` → **3×3 群組的方塊光源播種** → **3×3 群組的天空柱播種** → `chunk.lightDirty = false`。
    **（2026-10-20 稽核修正：天空柱也要掃 3×3 群組 —— 鄰塊的開闊柱會水平餵光進本區塊；只掃本區塊會讓邊界少一階。 group's 天空播種結果與「只掃本區塊」在鄰塊也有開闊柱時不同 → 已納入測試 `'sky light crosses the chunk border'`。）**
  - `internalSkyLight(skyLevel, t)`：
    ```ts
    const base = 4 + (15 - 4) * dayFactor(t);          // 正午 15、午夜 4
    return Math.max(0, Math.round(base - (15 - skyLevel)));
    ```
  - `skyLightScale(t)`：`return SKY_SCALE_NIGHT + (1 - SKY_SCALE_NIGHT) * dayFactor(t);`

- [ ] **Step 5: 跑測試轉綠**

  Run: `npx vitest run src/world/lighting.test.ts src/core/daynight.test.ts`
  Expected: PASS。

- [ ] **Step 6: 全量 gates** — `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 7: Commit**

  ```bash
  git add src/world/lighting.ts src/world/lighting.test.ts src/core/daynight.ts src/core/daynight.test.ts
  git commit -m "feat(light): B6.2 天空光引擎（柱掃描、垂直下傳不衰減、跨區塊、內部天空光）"
  ```

---

### Task 3: 光照生命週期整合（生成時計算、放置／破壞後重算、3×3 群組跨區塊一致性、佇列排序、效能門檻）

**Files:**
- Modify: `src/world/lighting.ts`、`src/world/lighting.test.ts`
- Modify: `src/main.ts`（光照佇列）

**Interfaces:**
- Consumes: Task 1／2 的 `computeChunkLight`／`markLightDirty`。
- Produces:
  - `src/world/lighting.ts`：
    ```ts
    /** 某區塊周圍 3×3 群組中「已存在」的區塊（播種的來源範圍）。 */
    export function groupChunks(world: World, cx: number, cz: number): Chunk[];
    ```
  - `src/main.ts`：`pendingLight` 佇列（近→遠排序）＋每幀 2 區塊的預算（見步驟）。

**設計決策（要寫進註解）**：
- **增量更新的粒度＝區塊**：放置／破壞方塊 → `World.setBlock` 標 `lightDirty`（本區塊＋**八個**鄰塊）→ 下一幀由光照佇列重算該區塊（`computeChunkLight`）並重網格化。**不做逐格 remove-BFS**：逐格版本要處理「光要往回吸」的邊界條件，錯誤率高、難測；單區塊重算 ≤ 8 ms、且玩家每次互動都在數秒級的挖掘節奏裡，2 區塊／幀的預算足夠。
- **跨區塊一致性靠「播種範圍」而不是「事後同步」（2026-10-20 稽核修正）**：`computeChunkLight(world, cx, cz)` 掃 3×3 群組的來源 → 光自然寫進鄰塊；鄰塊之後自己重算時，它的 3×3 群組又包含本區塊 → **後生成的鄰塊也能把光帶回先生成的區塊**。
  **原計畫的 `syncChunkLightWithNeighbors` 刪除**：該版本讀鄰塊的 (wx,wy,wz)、又寫回同一個世界座標（同一格）→ `sky > skyLightAt(...)` 恆為 false → 整個函式是無效的 no-op；而且 `sharedEdgeCells` 對**對角**鄰塊回傳的是鄰塊的兩條「邊線」（共 8192 格），但對角區塊與本區塊只共用一根角柱（256 格）→ 多數回傳格並非邊界格。**（2026-10-20 稽核修正：稽核報告的 Critical #2 指出這條路徑與「光不寫入不存在的區塊」的規則互斥；本計畫改成「播種掃 3×3 群組」，兩條規則同時成立。）**
- **網格前必須先有光**：`processQueues` 先跑光照預算，再跑網格預算；`lightDirty` 尚未清除的區塊**不進網格佇列**（避免用 0 光建 mesh）。
- **光照佇列要近→遠排序（2026-10-20 稽核修正）**：原設計每幀用 ring 掃描重建佇列 → 順序是掃描順序（遠處角落優先），玩家附近反而最後點亮。改為：收集後**依「到玩家的距離」排序**（`refreshQueues` 內計算 chunk 中心與玩家位置的距离平方），再逐幀取前 N 個。

- [ ] **Step 1: 寫測試（失敗）** — 追加到 `src/world/lighting.test.ts`

  - `'a late neighbour pulls light back across the border'`：先 `setBlock(15,64,0, TORCH)`、`computeChunkLight(world,0,0)`（此時鄰塊 (1,0) 不存在）→ 之後 `world.addChunk(new Chunk(1,0))` 建立鄰塊、`computeChunkLight(world,1,0)` → 斷言 `blockLightAt(world,16,64,0) === 13`（新鄰塊被先生成的區塊的火把照到）。
    **（2026-10-20 稽核修正：原測試斷言 `blockLightAt(world,15,64,0) === 13`，但 (15,64,0) 本身就是火把 → 值是 14；被照到的是鄰塊那一格 (16,64,0) = 13。）**
  - `'a recompute does not re-dirty its neighbours'`：`computeChunkLight(world,0,0)` 後 → 斷言 `world.getChunk(1,0)!.lightDirty === false`（重算本身不得把鄰塊排進光照佇列 → 避免無限迴圈）。
  - `'a chunk is fully relit after a block change'`：算完後 `setBlock(0,65,0, AIR)` → `computeChunkLight(world,0,0)` → 斷言 `blockLightAt(world,1,65,0) === 0`。
  - `'a corner torch leaves no ghost light in the diagonal neighbour'`：建立 3×3 的九個區塊（`world.addChunk(new Chunk(cx,cz))` for cx,cz ∈ {−1,0,1}）→ `setBlock(0,64,0, STONE)`、`setBlock(0,65,0, TORCH)` → `computeChunkLight(world,0,0)` → 斷言 `blockLightAt(world,-1,65,-1) === 12`（對角格被照到）→ `setBlock(0,65,0, BLOCK.AIR)` → **把九個區塊依序重算完**（模擬光照佇列：對每個 `lightDirty === true` 的區塊呼叫 `computeChunkLight`）→ 斷言 `blockLightAt(world,-1,65,-1) === 0`、`blockLightAt(world,-1,65,0) === 0`、`blockLightAt(world,0,65,0) === 0`。
    **（2026-10-20 稽核修正：這是稽核報告的 Critical #3 —— 只標 4 個正交鄰塊時，對角鄰塊的光永遠留著（實測：挖掉火把只重算 chunk(0,0) 後仍是 12，期望 0）。本測試同時釘住「八鄰都要標」與「對角光會歸 0」。）**
  - `'relighting 16 chunks stays inside the generation budget'`：連續生成＋點光 16 個區塊（用 `generateChunk(cx, cz, 1337)` 之類的固定種子地形 → **（2026-10-20 稽核修正：原計畫只寫「16 個區塊」但沒說怎麼取；明確取法：以 (0,0) 為中心、x/z 各 ±2 的 5×5 網格中的前 16 塊（cx,cz = 0..3 × 0..3），種子固定 1337）**）→ 斷言總時間 < 1500 ms（門檻沿用 B3；此測試在 CI 慢機上仍應綠）。

- [ ] **Step 2: 跑測試確認失敗** — `npx vitest run src/world/lighting.test.ts` → FAIL（`groupChunks` 不存在、對角幽靈光未清）。

- [ ] **Step 3: 實作「3×3 群組播種」（`src/world/lighting.ts`）**

  ```ts
  /** (cx,cz) 周圍 3×3 群組中「已存在」的區塊（含對角）。播種的來源範圍。 */
  export function groupChunks(world: World, cx: number, cz: number): Chunk[] {
    const out: Chunk[] = [];
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const c = world.getChunk(cx + dx, cz + dz);
        if (c) out.push(c);
      }
    return out;
  }
  ```
  `computeChunkLight` 的播種兩段（方塊光源／天空柱）都改掃 `groupChunks(world, cx, cz)`（Task 1／2 已寫好）。
  **不要**實作原計畫的 `syncChunkLightWithNeighbors`（無效的 no-op，見上方設計決策）。

- [ ] **Step 4: `computeChunkLight` 收尾**

  在既有流程（清 0 → 播種 → BFS）之後 `chunk.lightDirty = false`（本區塊；鄰塊由它們自己的重算負責）。

- [ ] **Step 5: 接線 `src/main.ts`（光照佇列）**

  - `refreshQueues()` 內（既有 `pendingMesh` 的收集處，約 L754–794）：新增 `pendingLight.length = 0;` 並在既有 ring 掃描中，若 `c?.lightDirty === true` 則 `pendingLight.push([cx, cz, distSq])`（**與 mesh 同一個 ring**，避免掃描全地圖）。
  - **排序**：收集完後 `pendingLight.sort((a, b) => a[2] - b[2])`（由近到遠；`distSq` = chunk 中心與玩家位置的距离平方）。
    **（2026-10-20 稽核修正：原設計是掃描順序（遠處角落優先）→ 玩家周圍最後才亮，且初始 529 塊要 265 幀才點完、期間地形是 0 光（5% 亮度、近乎全黑）。）**
  - `processQueues()` 內（既有 `budgetMesh = 2` 的迴圈之前，約 L809）：新增
    ```ts
    let budgetLight = 2;
    while (budgetLight > 0 && pendingLight.length > 0) {
      const [cx, cz] = pendingLight.shift()!;
      computeChunkLight(world, cx, cz);
      budgetLight--;
    }
    ```
  - **開局同步點亮出生區**：`spawnPoint()` 的同步生成（≈L683）之後，除了 `markLightDirty` 進佇列，另外**立即**對玩家所在區塊半徑 2 的 5×5 = 25 塊各呼叫一次 `computeChunkLight` → 玩家眼前第一幀就是正確的光（其餘 504 塊在接下來約 4 秒內補齊，見〈已查證與設計決策〉§7）。
  - 網格迴圈加守門：`if (c?.dirty && !c.lightDirty && neighborsReady(cx, cz))` → 才 `chunkRenderer.rebuild(...)`（**先有光再網格**）。
  - 區塊生成完成後（`terrain.request` 的回應 handler，約 L822–847）與 `spawnPoint()` 的同步生成（≈L683）之後：`markLightDirty(world, cx, cz)` → 該區塊進入光照佇列；**同時設定 `chunk.topY = computeChunkTopY(chunk)`**（地形是整塊寫入、不經 `setBlock` → 不設定的話天空光柱不會往下掃 → 地表全黑）。
  - `world.reapplyModifiedInChunk(...)` 會走 `setBlock` → 自動標記 `lightDirty` ✓（載入既有存檔時火把的光因此會被算出來）。

- [ ] **Step 6: 跑測試轉綠** — `npx vitest run src/world/lighting.test.ts` → PASS。

- [ ] **Step 7: 全量 gates** — `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 8: Commit**

  ```bash
  git add src/world/lighting.ts src/world/lighting.test.ts src/main.ts
  git commit -m "feat(light): B6.3 光照生命週期整合（生成／改方塊後重算、3×3 群組播種、對角鄰塊不留幽靈光、光照佇列近→遠排序、出生區同步點亮、每幀 2 區塊預算）"
  ```

---

### Task 4: 網格光照（頂點光屬性、合併簽章切分、著色器 uniform、平滑）

**Files:**
- Modify: `src/world/mesher.ts`、`src/world/mesher.test.ts`
- Modify: `src/render/chunk-renderer.ts`、`src/render/chunk-renderer.test.ts`
- Modify: `src/main.ts`（每幀更新天空比例）

**Interfaces:**
- Consumes: Task 1／2 的 `lightAt`／`skyLightAt`／`blockLightAt`／`skyLightScale`／`MIN_LIGHT_FACTOR`。
- Produces:
  - `src/world/mesher.ts`：
    ```ts
    export interface MeshData {
      positions: Float32Array; normals: Float32Array; uvs: Float32Array; texIndex: Float32Array;
      shades: Float32Array;      // 既有：面亮度 × AO
      lightSky: Float32Array;    // 新增：每頂點的天空光（0..15，角落平均）
      lightBlock: Float32Array;  // 新增：每頂點的方塊光（0..15，角落平均）
      indices: Uint32Array; quadCount: number;
    }
    export function cornerLight(
      world: World, cx: number, cz: number,
      cell: readonly [number, number, number],
      samples: readonly CornerSamples[],
      neighbors: NeighborChunks,
    ): { sky: number; block: number };
    ```
  - `src/render/chunk-renderer.ts`：
    ```ts
    /** 貼圖陣列取樣 patch（**維持現狀**）：粒子與手持物模型也用它 → 不可加上光照。 */
    export function patchTextureArrayShader(shader: TextureArrayShader, mapArray: THREE.DataArrayTexture): void;
    /** 地形專用：取樣 patch ＋ 頂點光屬性 ＋ 光照 uniform（2026-10-20 稽核修正：拆成兩個 patch）。 */
    export function patchTerrainLightShader(
      shader: TextureArrayShader, mapArray: THREE.DataArrayTexture, light: LightUniforms,
    ): void;
    /** 所有地形材質共用的 uniform 物件（同一個參考 → setSkyScale 一次全部生效）。 */
    export interface LightUniforms { uSkyScale: { value: number }; uMinLight: { value: number } }
    export class ChunkRenderer {
      /** 每幀更新天空比例（0..1）：只改 uniform → 不重網格。 */
      setSkyScale(value: number): void;
    }
    ```
    **（2026-10-20 稽核修正：原計畫是「擴充 `patchTextureArrayShader`」並在 `onBeforeCompile` 內保存一份 `shader.uniforms` 參考 —— 前者會把粒子／手持物打成 5% 亮度，後者只會指到最後編譯的那個材質（其餘 pass 夜間不變暗）。）**

**設計決策（要寫進註解）**：
- **合併簽章重排**（32 bits 剛好塞滿，必須重排才塞得下 8 位光照鍵）：
  ```
  bits 0..7   id（8）
  bits 8..13  tile（6，貼圖層 0..63）
  bits 14..21 lightKey（8）：sky << 4 | block（面向前面那一格的光照）
  bits 22..29 aoKey（8，4 角 × 2 bits）
  bit  30     water flag
  bit  31     保留 0
  ```
  為何能省出位元：原本的 `shadeKey`（7 bits）是**每個面方向固定**的（`FACES` 表的 `shade`），而 `mask` 是每方向重建的 → `shadeKey` 不需要進簽章，7 bits 直接讓給光照；`tile` 改用 6 bits（`ARRAY_LAYERS = 64` → tile ≤ 63 ✓）多出 2 bits。
- **光照鍵取「面向前面那一格」的光照**（不是方塊自身）：牆面顯示的是它前面那格空氣的光 ✓（與原版一致）。
- **角落平均**：每個頂點的光照 = 該角點周圍最多 4 格（面向前面一側：該格本身＋u 鄰＋v 鄰＋對角）的平均，**不透明方塊不列入**（沒有不透明格時視為 0）；天空光與方塊光分別平均。
- **合併 quad 的 4 個角各用「該角所在格」的取樣**（見〈已查證與設計決策〉§5 的說明）：不能用 anchor 格的平均值，否則 16 格大的地板會出現一道線性漸層、光邊界錯位。
- **著色器**：`uSkyScale`（天空比例）與 `uMinLight`（0.05）兩個 uniform；fragment 端
  ```
  float lf = max(vLightSky * (1.0/15.0) * uSkyScale, vLightBlock * (1.0/15.0));
  lf = max(lf, uMinLight);
  diffuseColor.rgb *= lf;
  ```
  乘在 `#include <map_fragment>` 的替換處（`diffuseColor` 已含貼圖與頂點色；乘算可交換 → 結果一致）。
- **日夜不重網格**：`uSkyScale` 每幀更新 → 太陽落下時地形即時變暗，**不觸發任何重算或重網格**。

- [ ] **Step 1: 寫測試（失敗）**

  `src/world/mesher.test.ts` 新增：
  - `'faces with different light do not merge'`：造一條 4 格長的牆，左半在火把旁（亮）、右半在暗處 → 斷言該方向的 quad 數 ≥ 2（光照鍵把簽章切開）。
  - `'vertex light is the corner average of the non opaque neighbours'`：造一個火把旁的地板 → 斷言靠近火把的頂點 `lightBlock` 較大、背對的一端較小，且 `lightBlock` 的值介於 0 與 15 之間（浮點，用 `toBeGreaterThan`／`toBeLessThan`）。
  - `'a merged quad uses each corner cell light, not the anchor cell'`（**2026-10-20 稽核修正：這是原計畫缺少的守門測試**）：造一塊 2×2 的地板，靠近火把的那一格亮（14）、對角那格暗（0）→ 合併成一個 2×2 的 quad 後，斷言 4 個頂點的 `lightBlock` **不是全部相等**（若實作誤用 anchor 取樣，四個角會是同一組值）→ 具體斷言：兩個「靠火把的角」明顯大於兩個「背對的角」。
  - `'the mesh carries one light attribute per vertex'`：`mesh.opaque.lightSky.length === mesh.opaque.positions.length / 3`（每頂點 1 個）且 `lightBlock.length` 同長。

  `src/render/chunk-renderer.test.ts` 新增：
  - `'the terrain light patch declares the light attributes and uniforms'`：用既有的 fake shader 物件跑**新的** `patchTerrainLightShader(shader, mapArray, lightUniforms)` → 斷言 `shader.vertexShader` 含 `attribute float lightSky`／`attribute float lightBlock`，`shader.fragmentShader` 含 `uSkyScale` 與 `uMinLight`，且 `shader.uniforms.uSkyScale`／`shader.uniforms.uMinLight` 存在。
  - `'the fragment multiplies the diffuse colour by the light factor'`：`shader.fragmentShader` 含 `diffuseColor.rgb *= lf`（或等價片段）。
  - `'the plain texture patch does not touch the light attributes'`（**2026-10-20 稽核修正：粒子與手持物用的就是這個 patch**）：跑既有的 `patchTextureArrayShader(shader, mapArray)` → 斷言 `shader.vertexShader` **不含** `lightSky`／`lightBlock`，`shader.fragmentShader` **不含** `uSkyScale`／`uMinLight`。
  - `'the particle and viewmodel materials keep the plain patch'`（守門）：`src/render/particles.test.ts`／`src/render/viewmodel.test.ts` 各補一條 → 對其材質的 `onBeforeCompile(fakeShader)` 後，斷言 fake shader 的 fragment **不含** `uSkyScale`（粒子與手持物沒有 lightSky 屬性 → 若掛上光照 patch，缺省屬性值 0 → `lf = max(0.05, 0) = 0.05` → **只剩 5% 亮度、幾乎全黑**）。
  - `'setSkyScale updates every material of the renderer'`（**2026-10-20 稽核修正：原測試照寫法驗不到東西**）：jsdom 沒有 WebGL → 材質從不 render → `onBeforeCompile` 永不執行 → `shaderUniforms` 是 undefined → `setSkyScale` 是 no-op，斷言不到任何東西。**正確寫法**：像既有 `chunk-renderer.test.ts:201-202` 那樣**手動呼叫** `material.onBeforeCompile(fakeShader())`（opaque 與 water 兩個材質各一次）→ 斷言兩個 fake shader 的 `uniforms.uSkyScale` **是同一個物件**（`expect(s2.uniforms.uSkyScale).toBe(s1.uniforms.uSkyScale)`）→ 呼叫 `renderer.setSkyScale(0.5)` → 斷言兩者的 `.value` 都是 `0.5`（單一欄位只指到最後編譯的材質會讓另一個 pass 停在 100% 亮度）。

- [ ] **Step 2: 跑測試確認失敗** — `npx vitest run src/world/mesher.test.ts src/render/chunk-renderer.test.ts` → FAIL。

- [ ] **Step 3: 實作 `src/world/mesher.ts`**

  - `MeshData` 加 `lightSky`／`lightBlock`（`Float32Array`，每頂點 1 個）；`MeshBuilder` 同步加兩個 `number[]`；`finish()` 轉 `Float32Array`。
  - `faceSignature` 重排為：
    ```ts
    const LIGHT_SHIFT = 14, AO_SHIFT = 22;
    function faceSignature(id: number, tile: number, lightKey: number, aoKey: number, isWater: boolean): number {
      return id | (tile << 8) | (lightKey << LIGHT_SHIFT) | (aoKey << AO_SHIFT) | (isWater ? WATER_BIT : 0);
    }
    ```
    （`WATER_BIT = 1 << 30`；移除 `shadeKey` 參數與 `AO_SHIFT = 23` 的舊常數。）
  - `greedySweep` 的 emit 回呼從簽章取出 `tile = (sig >> 8) & 0x3f`、`aoKey = (sig >> AO_SHIFT) & 0xff`、`lightKey = (sig >> LIGHT_SHIFT) & 0xff`。
  - 每個可見面：算 `lightKey`（面向前面那一格的 `sky<<4|block`）與 4 個角落光；`emitQuad` 多收一組 `cornerLight[4]`（每角一組 sky/block），在 builder 內 `b.lightSky.push(corner.sky)`／`b.lightBlock.push(corner.block)`（每頂點各 1 個，順序與 `positions` 一致 ✓）。
  - **合併 quad 的角取樣（2026-10-20 稽核修正）**：`greedySweep` 的 emit 回呼拿到 `(au, av, w, h)` → 4 個角分別對應格 `(au,av)`、`(au+w−1,av)`、`(au,av+h−1)`、`(au+w−1,av+h−1)`（對應 `emitQuad` 的角序 u0v0／u1v0／u0v1／u1v1）→ **每個角各算一次角落平均**，不得共用 anchor 格的取樣。
  - `cornerLight(world, cx, cz, cell, samples, neighbors)`：對每個角，取 {cell 前面那一格, samples[0], samples[1], samples[2]} 四格的 sky/block，**排除不透明格**（`isTransparent` 為 false 者不列入），求平均（無可平均者 → 0）。
  - B3 的 `foliage` pass 與水 pass 同樣填 `lightSky`／`lightBlock`（植被用自己那一格的光照，不做角落平均 → 簡化，寫進註解）。
  - 既有 `shades` 的語意**不變**（面亮度 × AO）；光亮度另外走新屬性 → 不影響既有 mesher 測試的 `shades` 斷言 ✓。

- [ ] **Step 4: 實作 `src/render/chunk-renderer.ts`**

  **（2026-10-20 稽核修正：本步驟原本要「擴充共用的 `patchTextureArrayShader`」——但那個 patch 也被 `src/render/particles.ts:69`（粒子）與 `src/render/viewmodel.ts:82`（手持方塊）使用，而它們的幾何沒有 `lightSky`／`lightBlock` 屬性（WebGL 缺省值 0）→ `lf = max(0.05, 0) = 0.05` → **粒子與手持物只剩 5% 亮度（近乎全黑）**，也會推翻 README「生物與掉落物不使用逐格光照」的說法。因此拆成兩個 patch。）**

  - **`patchTextureArrayShader(shader, mapArray)`：維持現狀不變**（只做貼圖陣列取樣）→ 粒子（`particles.ts`）與手持物（`viewmodel.ts`）**繼續用這個 patch**，行為完全不變。
  - **新增 `patchTerrainLightShader(shader, mapArray, light)`**（地形用）：先呼叫 `patchTextureArrayShader(shader, mapArray)`，再
    - vertex 端加
      ```
      attribute float lightSky;
      attribute float lightBlock;
      varying float vLightSky;
      varying float vLightBlock;
      ```
      並在 `#include <begin_vertex>` 後賦值（`vLightSky = lightSky; vLightBlock = lightBlock;`）；
    - fragment 端加 `uniform float uSkyScale; uniform float uMinLight; varying float vLightSky; varying float vLightBlock;`，並在 `#include <map_fragment>` 的替換字串尾端追加亮度乘算；
    - `shader.uniforms.uSkyScale = light.uSkyScale; shader.uniforms.uMinLight = light.uMinLight;`（**傳入外部的 uniform 物件**，不是新建 → 所有材質共用同一個物件）。
  - **uniform 的共享（2026-10-20 稽核修正）**：`ChunkRenderer` 持有**一個** uniform 物件，所有材質（opaque／water／foliage／torch）都把它交給 `patchTerrainLightShader` → `setSkyScale` 只改這一個物件 → **四個 pass 全部同步變暗**。型別：
    ```ts
    export interface LightUniforms { uSkyScale: { value: number }; uMinLight: { value: number } }
    ```
    `ChunkRenderer` 建構時：`this.lightUniforms = { uSkyScale: { value: 1 }, uMinLight: { value: 0.05 } };`，每個材質的 `onBeforeCompile` 都傳同一個 `this.lightUniforms`。
  - `setSkyScale(value: number)`：`this.lightUniforms.uSkyScale.value = value;`（**不需要等第一次 render** → 首次呼叫也有效；初始值 1 頂著 ✓）。
  - `buildMeshGeometry`：把 `data.lightSky`／`data.lightBlock` 各以 `new THREE.BufferAttribute(arr, 1)` 掛到幾何（**opaque／water／foliage／torch 四個 pass 都必須掛**，缺一個 → 該 pass 的屬性缺省 0 → 整片變黑）。
  - 水／植被／火把的材質都掛 `patchTerrainLightShader`（既有 `onBeforeCompile` 模式）✓；粒子與手持物維持 `patchTextureArrayShader` ✓。

- [ ] **Step 5: 接線 `src/main.ts`（每幀更新天空比例）**

  在 frame loop 的晝夜區塊（既有 `const c = skyColors(clock.t);` ≈L1832 附近）之後加一行：
  ```ts
  chunkRenderer.setSkyScale(skyLightScale(clock.t));
  ```
  （import `skyLightScale` from `./world/lighting` ✓。）

- [ ] **Step 6: 跑測試轉綠** — `npx vitest run src/world/mesher.test.ts src/render/chunk-renderer.test.ts` → PASS。

- [ ] **Step 7: 全量 gates** — `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 8: Commit**

  ```bash
  git add src/world/mesher.ts src/world/mesher.test.ts src/render/chunk-renderer.ts src/render/chunk-renderer.test.ts src/main.ts
  git commit -m "feat(render): B6.4 網格光照（頂點光屬性、合併簽章切分、天空比例 uniform）"
  ```

---

### Task 5: 火把的方塊／物品／配方／貼圖／掉落

**Files:**
- Modify: `src/world/blocks.ts`、`src/world/blocks.test.ts`
- Modify: `src/core/items.ts`、`src/core/items.test.ts`
- Modify: `src/core/recipes.ts`、`src/core/recipes.test.ts`
- Modify: `src/render/textures.ts`、`src/render/textures.test.ts`
- Modify: `src/audio/sounds.ts`、`src/audio/sounds.test.ts`（火把的材質音效 → wood）
- Modify: `src/world/drops.ts`／`src/world/drops.test.ts`
- Test: 上述各檔的既有測試

**Interfaces:**
- Consumes: B3 的 `BlockDef.shape`（`'cube' | 'cross'`）、`PLACEABLE`、`T`／`TILE_COUNT`；`src/core/items.ts` 的 `ItemId`／`ITEM_IDS`／`BLOCK_PAIRS`；`src/core/recipes.ts` 的 `RECIPES`。
- Produces:
  - `src/world/blocks.ts`：
    ```ts
    export const BLOCK = { ..., TORCH: 32 } as const;          // 追加，既有值不動
    export const T = { ..., TORCH: 39 } as const;              // 追加（公約 §3.5：B3 21–32、B4 33、B5 34–38 → 火把接 39）
    export const TILE_COUNT = T.TORCH + 1;                     // 規則不變（由最後一個 tile 推導）→ 40
    // BlockDef 的 emission?: number 欄位已由 Task 1 加入（選用，0..15；未列＝0）
    // DEFS[32] = { id: 32, name: 'torch', hardness: 0, solid: false, transparent: true,
    //               top: T.TORCH, side: T.TORCH, bottom: T.TORCH,
    //               requiredTool: null, fastTool: null, emission: 14, shape: 'torch' }
    ```
    **（2026-10-20 稽核修正：原計畫寫 `T.TORCH = 40` → `TILE_COUNT = 41`，會與 B8 的 `T.CHEST = 40` 撞號（箱子渲染成火把）。依公約 §3.5 改為 `T.TORCH = 39`／`TILE_COUNT = 40`。）**
  - `src/core/items.ts`：`ItemId` 加 `'torch'`；`ITEM_IDS` 加 `torch: true`；`BLOCK_PAIRS` 加 `['torch', BLOCK.TORCH]`。
  - `src/core/recipes.ts`：新配方
    ```ts
    const COAL: PatternCell = 'coal';                          // ★ 既有 `C` 已被 'cobblestone' 占用，不可重用
    { id: 'torch', kind: 'shaped', pattern: [[COAL], [S]], result: { item: 'torch', count: 4 } }
    ```
    （`S = 'stick'` 沿用既有常數；原版是「Coal or Charcoal + Stick → 4」✓。若 B5 之後的物品表已有 `charcoal`，再加一條 `charcoal` 的配方。）
    **（2026-10-20 稽核修正：`src/core/recipes.ts:39` 已有 `const C: PatternCell = 'cobblestone'`（`S` 才是 stick）。照原計畫寫 `pattern: [[C], [S]]` 並註解「C = 'coal'」會是 TS 重複宣告錯誤；實作者若沿用既有的 `C` 就會做出「圓石上放木棍」的錯誤配方 → 新增 `COAL` 常數。）**

**已查證數值**：「Torches give off a light level of 14.」「Torches are non-solid blocks that emit light.」「Torches can be broken instantly using anything, and drop themselves as an item.」已查證（minecraft.wiki/Torch，2026-10-20；infobox `Hardness: 0`、`Luminous: Yes (14)`、`Transparent: Yes`）；配方「Coal or Charcoal + Stick → 4」同頁。

**設計決策（要寫進註解）**：
- **火把 id = 32**（controller 裁決的數字表）；既有 id 一律不動 → 舊存檔的 `modified` 記錄仍可解讀。
- **貼圖索引取決規則**：`T.TORCH = 39`（公約 §3.5 的跨批編號表；合併後若最高 tile 不是 38 → 取「最高 + 1」並在 commit 訊息說明實際值）。測試斷言 `T.TORCH === TILE_COUNT - 1` 且 `TILE_COUNT <= 64` → 不綁死數字，上游 tile 表變動不會誤報。
- **火把本體是物品**（`BLOCK_PAIRS`）→ 熱鍵欄、創造調色盤、圖示（`icons.ts` 的 `drawBlockIcon` 會自動裁 `def.side` 的 tile → **不需要在 `icons.ts` 加 case** ✓）。
- **掉落自身**：`dropItemFor(BLOCK.TORCH)` 走既有 `itemFromBlock` → `'torch'` ✓（`drops.ts` 可能只需補測試）。

- [ ] **Step 1: 寫測試（失敗）**

  `src/world/blocks.test.ts`：
  - `'the torch is id 32, non solid, transparent and emits 14'`：`expect(BLOCK.TORCH).toBe(32)`；`getBlockDef(BLOCK.TORCH).solid === false`、`.transparent === true`、`.hardness === 0`、`.emission === 14`、`.shape === 'torch'`；`PLACEABLE` 包含 `BLOCK.TORCH`。
  - **既有測試要補（紅燈清單）**：
    - `'requiredTool／fastTool data matches vanilla (Task 5)'` 的表格是**窮舉所有 block id**（`expect(expected.map(([id]) => id).sort(byId)).toEqual([...Object.values(BLOCK)].sort(byId))`）→ **必須補上 `BLOCK.TORCH` 一列**（`[BLOCK.TORCH, null, null]`），否則這條測試必紅。
    - `'hardness table matches vanilla 1.20+ (Task 5)'` 不是窮舉（只迭代期望表）→ **補** `[BLOCK.TORCH, 0]` 當覆蓋（不改也不會紅）。
  - `'existing block ids are unchanged'`（若合併後已有此測試）：追加 `expect(BLOCK.TORCH).toBe(32)` 之外的既有值不動。
  - `'the torch tile is the last declared tile'`：`expect(T.TORCH).toBe(TILE_COUNT - 1)`；`expect(TILE_COUNT).toBeLessThanOrEqual(64)`。
    **（2026-10-20 稽核修正：這條守門測試抓不到跨批撞號 → 另外補一條 `'the torch tile does not collide with the chest tile'`：`expect(T.TORCH).not.toBe(40)`（B8 的 `T.CHEST` ＝ 40）。）**

  `src/core/items.test.ts`：
  - `'torch is the item form of the torch block'`：`expect(blockFromItem('torch')).toBe(BLOCK.TORCH)`；`expect(itemFromBlock(BLOCK.TORCH)).toBe('torch')`。
  - **既有測試要更新（紅燈清單，原計畫只列了一半）**（2026-10-20 終審修正：**基數一律讀現況**，本批只加 1 個 id → 目標 ＝ 現況 ＋ 1）：
    - `'ALL_ITEM_IDS is the canonical list: <N> entries…'`：`expect(ALL_ITEM_IDS.length).toBe(<N>)` → 改成 `toBe(<N + 1>)`（N ＝ 實作者讀 `src/core/items.ts` 現況得到的數字；**上游 B5 落地後是 72 → 73**）。測試名裡的「N entries」文字也要改成實際數字。**不得寫死計畫預設的 33**——那是「B5 未落地」時的數字，照抄必紅。
    - **（2026-10-20 稽核修正：原計畫漏了 `items.test.ts:37` 的 `expect(ALL_ITEMS.length).toBe(32)`** —— `ALL_ITEMS`（items.test.ts:28–33）是**手工維護的 union 鏡像**（`BLOCK_ITEMS`／`TOOL_ITEMS`／`DROP_ITEMS` 拼出來的陣列）→ 必須在該鏡像裡加 `'torch'`（`ALL_ITEMS` 的組成要加進 `BLOCK_ITEMS` 或 `DROP_ITEMS` 哪一組由實作者自訂，但**集合必須等於 `ALL_ITEM_IDS`**），否則 `expect(new Set(ALL_ITEM_IDS)).toEqual(new Set(ALL_ITEMS))`（items.test.ts:51）會紅。**同一處的 `expect(ALL_ITEMS.length)` 也要改成 `<N + 1>`**。

  `src/core/recipes.test.ts`：
  - `'a torch is crafted from coal over a stick'`：`emptyGrid(2)` → `grid[0] = { item: 'coal', count: 1 }`、`grid[2] = { item: 'stick', count: 1 }` → `expect(matchRecipe(grid, 2)).toEqual({ item: 'torch', count: 4 })`。
  - `'the torch recipe needs the coal above the stick'`：位置顛倒（stick 在上、coal 在下）→ `matchRecipe(grid, 2)` 為 `null`。
  - **既有測試要更新（紅燈清單）**（2026-10-20 終審修正：**基數讀現況**，本批只加 1 筆配方 → 目標 ＝ 現況 ＋ 1）：
    - 配方總數的斷言（`'holds exactly the <M> settled recipes, no extras'` 的 `expect(RECIPES.length).toBe(<M>)`）→ 改成 `toBe(<M + 1>)`（M ＝ 實作者讀 `src/core/recipes.ts` 現況得到的數字；**上游 B5 落地後是 31 → 32**）。**不得寫死計畫預設的 14**——上游 B5 已把配方數推到 31，照抄 14 必紅；而且測試名 `'holds exactly the 13 settled recipes…'` 在 B5 之後已不存在（名稱被改過），實作者要**以現況檔案裡的實際測試名為準**。
    - **（2026-10-20 稽核修正：原計畫漏了同一條測試裡的「窮舉 recipe id 清單」** —— `recipes.test.ts:18–34` 還有一份 `expect(RECIPES.map((r) => r.id).sort()).toEqual([...].sort())` → **必須補 `'torch'`**，否則該測試紅。）

  `src/render/textures.test.ts`：
  - `'the torch tile is drawn'`：沿用既有 helper（讀 `drawAtlas().data` 判斷該 tile 不是洋紅除錯色）→ 斷言 `T.TORCH` 的 tile 有非洋紅像素。
  - **既有測試：洋紅層清單——本批只驗證、不改寫**（2026-10-20 終審修正：唯一的修復點在 **B3（0.6.0）**——B3 的 Task 3 Step 1 已把寫死的 `for (const layer of [TILE_COUNT, 32, 47, 63])` 改成 runtime 相對的 `for (const layer of [TILE_COUNT, TILE_COUNT + 1, 47, 63])`；本批 `TILE_COUNT` 從 39 升到 40 → 清單自動變成 `[40, 41, 47, 63]`，四個層都仍是未畫層 ✓ → **本批不得再改這條**）。
    - **備援（若讀到的現況顯示上游仍是寫死的 `[TILE_COUNT, 32, 47, 63]`，例如 B3 尚未合併）**：由**本批**補改成與 B3 **完全相同**的相對寫法 `[TILE_COUNT, TILE_COUNT + 1, 47, 63]`（並確保每個 layer < 64；`TILE_COUNT + 1` 若 ≥ 64 或與 47／63 重複就省略該項），並在 Task 5 的 commit 訊息註明「上游 B3 未改寫，本批代為補上」。**不得另創寫法**（原計畫的 `TILE_COUNT + 8` 與 B3 的 `TILE_COUNT + 1` 不一致，會讓兩批各改各的）。

  `src/audio/sounds.test.ts`（**2026-10-20 稽核修正：原計畫完全沒提這條，但它會紅**）：
  - `'maps every BLOCK id to its material group (table-driven)'` 的 `table` 是**窮舉所有 block id**（`expect(Object.keys(table)).toHaveLength(Object.keys(BLOCK).length)`）→ **必須補 `[BLOCK.TORCH]: 'wood'`**（火把是木頭 → 挖掘／腳步／放置音效走 wood 材質），否則這條測試紅。
  - 對應的**實作**也要補：`src/audio/sounds.ts` 的 `GROUP_BY_BLOCK`（`sounds.ts:27-44`）加一筆 `[BLOCK.TORCH]: 'wood';`（沒有它 → `materialGroup` 落到預設的 'dirt' → 火把的音效是泥土聲）。

  `src/world/drops.test.ts`：
  - `'a broken torch drops itself'`：`expect(dropItemFor(BLOCK.TORCH)).toBe('torch')`。

- [ ] **Step 2: 跑測試確認失敗** — `npx vitest run src/world/blocks.test.ts src/core/items.test.ts src/core/recipes.test.ts src/render/textures.test.ts src/audio/sounds.test.ts src/world/drops.test.ts` → FAIL。

- [ ] **Step 3: 實作方塊資料（`src/world/blocks.ts`）**

  - `BLOCK` 追加 `TORCH: 32`（既有值不動）。
  - `T` 追加 `TORCH: 39`（公約 §3.5；若合併後的最高 tile 不是 38 → 取「最高 + 1」，並在 commit 訊息說明實際值）。
    **（2026-10-20 稽核修正：`T` 在 `blocks.ts:44` 目前是**未 export 的模組私有常數** → 要在 `textures.ts` 裡寫 `put(T.TORCH, …)` 就得先把它改成 `export const T` 並在 `textures.ts` import；否則貼圖只能寫死數字 39 → 與「最高 + 1」的規則脫鉤。步驟：把 `const T = {…}` 改成 `export const T = {…}`，並在 `src/render/textures.ts` 的 import 加上 `T`（既有 `import { TILE_COUNT } from '../world/blocks';` → `import { T, TILE_COUNT } from '../world/blocks';`）。）**
  - `BlockDef` 的 `emission` 欄位已由 Task 1 加入（選用，既有 DEFS 不改）→ **本任務只把 `DEFS[32].emission` 設成 14**；`shape` 沿用 B3 的 union 並加 `'torch'`。
  - `DEFS[32]` 如上（`hardness: 0`、`solid: false`、`transparent: true`、`emission: 14`、`shape: 'torch'`、三面皆 `T.TORCH`）。
  - `PLACEABLE` 加 `BLOCK.TORCH`（`HOTBAR_DEFAULT` **不加**——火要是做出來的，不是初始物品 ✓）。

- [ ] **Step 4: 實作物品與配方**

  - `src/core/items.ts`：`ItemId` union 加 `'torch'`；`ITEM_IDS` 加 `torch: true`；`BLOCK_PAIRS` 加 `['torch', BLOCK.TORCH]`（`maxStack` 預設 64 ✓，不進 `STACK_ONE`）。
  - `src/core/recipes.ts`：加 `torch` 配方（見上；**新增 `COAL` 常數，不重用既有的 `C`**）。

- [ ] **Step 5: 畫貼圖（`src/render/textures.ts`）**

  在 `drawAtlas()` 的 `put(...)` 序列末端加 `put(T.TORCH, ...)`：中間 4 欄畫深棕色木棒（從底部到 3/4 高），頂端畫亮黃／橘色火苗（其餘透明 `alpha = 0`；`alphaTest 0.1` 會裁掉透明像素 ✓）。**注意**：火把模型是一根 2/16 寬、10/16 高的細柱，整張 tile 會被壓縮 → 圖樣要畫成「中央細棒 + 頂端火苗」，壓縮後仍看得出是火把。

- [ ] **Step 6: 跑測試轉綠 + 全量 gates**

  Run: `npx vitest run src/world/blocks.test.ts src/core/items.test.ts src/core/recipes.test.ts src/render/textures.test.ts src/audio/sounds.test.ts src/world/drops.test.ts && npm run typecheck && npm test && npm run build && npm run lint`
  Expected: 全綠。

- [ ] **Step 7: Commit**

  ```bash
  git add src/world/blocks.ts src/world/blocks.test.ts src/core/items.ts src/core/items.test.ts src/core/recipes.ts src/core/recipes.test.ts src/render/textures.ts src/render/textures.test.ts src/audio/sounds.ts src/audio/sounds.test.ts src/world/drops.ts src/world/drops.test.ts
  git commit -m "feat(torch): B6.5 火把方塊／物品／配方／貼圖（id 32、tile 39、光照 14、煤＋木棍 → 4）；既有測試改寫理由：blocks 窮舉表補火把列、items union 鏡像補 torch（計數＝現況＋1）、recipes 補 1 筆與 id 清單（計數＝現況＋1）、sounds 材質表補火把；textures 的洋紅層清單由上游 B3 改為 TILE_COUNT 起算，本批只驗證"
  ```
  （commit 訊息裡的「計數＝現況＋1」處，實作者要寫出**實際數字**（例：`ALL_ITEM_IDS 72 → 73`、`RECIPES 31 → 32`）——2026-10-20 終審修正：原訊息寫死「第 14 筆」，那是 B5 未落地時的數字，照抄會誤導後續批次。）

---

### Task 6: 火把的放置規則與小模型渲染（頂／側、無碰撞、支撐掉落）

**Files:**
- Modify: `src/world/mesher.ts`、`src/world/mesher.test.ts`（`torches` pass）
- Modify: `src/render/chunk-renderer.ts`（第四條 mesh 與材質）
- Modify: `src/player/interact.ts`、`src/player/interact.test.ts`（`canPlaceTorch`／`canPlaceAt`）
- Modify: `src/main.ts`（放置／破壞分支接線＋火把掉落）

**Interfaces:**
- Consumes: Task 5 的 `BLOCK.TORCH`／`T.TORCH`；Task 4 的 `MeshData`（含光屬性）與 `patchTerrainLightShader`。
- Produces:
  - `src/world/mesher.ts`：
    ```ts
    export interface ChunkMesh { opaque: MeshData; water: MeshData; foliage: MeshData; torches: MeshData }
    /** 火把的依附方向（由世界推導，不存狀態）。 */
    export type TorchAttach = 'floor' | 'wall+x' | 'wall-x' | 'wall+z' | 'wall-z' | 'free';
    export function torchAttachAt(world: World, x: number, y: number, z: number): TorchAttach;
    ```
  - `src/player/interact.ts`：
    ```ts
    /** 火把只能放在完整方塊的頂或側；目標格必須是空氣。 */
    export function canPlaceTorch(world: World, x: number, y: number, z: number): boolean;
    ```
  - `src/world/world.ts`（或 `lighting.ts`）：
    ```ts
    /** 某格是否可作為火把的支撐（實心方塊：玻璃算、cross 植被與水不算）。 */
    export function isFullSupport(world: World, x: number, y: number, z: number): boolean;
    /** 支撐被挖掉後，把依附其上的火把收回（回傳被收回的位置清單）。 */
    export function popUnsupportedTorches(world: World, x: number, y: number, z: number): Array<{ x: number; y: number; z: number }>;
    ```

**已查證數值**：「Torches can be placed on the top or the sides of most solid blocks」「Torches are non-solid blocks」「Being non-solid, torches have no collision box.」「Torches can be placed on top of glass blocks.」「A torch is removed and drops itself as an item if: Its attachment block is moved, removed, or destroyed」已查證（minecraft.wiki/Torch，2026-10-20）→ 本作實作：頂／側兩種依附、**方向由世界推導**（下方是實心 → 立在地上；否則找水平鄰居 → 貼牆）、無碰撞、支撐消失 → 火把掉落。

**設計決策（要寫進註解）**：
- **不存依附方向**（本批最重要的簡化）：區塊資料是「1 格 1 byte 的 block id」，沒有 block state 的空間；改成**由世界推導**（下方實心 → `floor`；否則依 +x、−x、+z、−z 的固定優先序找第一個實心水平鄰居 → 對應牆面；都沒有 → `free`）。好處：**存檔往返不會掉方向**（火把在 `modified` overlay 裡只有 id 32），且規則可測。代價：玩家不能指定牆面（四面都靠著時取固定優先序）→ 寫進 README〈與原版的差異〉。
- **支撐判定用 `isSolid`**（玻璃算支撐、cross 植被與水不算）✓ 對齊原版「可放在玻璃上」。
- **小模型**：2/16 × 10/16 × 2/16 的方盒（寬 2 像素、高 10 像素），立在格子底部；貼牆時沿該軸貼到牆面（偏移 1 − 2/16）。
- **不碰撞**：`solid: false` → 玩家可以走進火把格子 → 放置分支對火把**略過玩家 AABB 檢查**（否則火把永遠放不進玩家腳下）。

- [ ] **Step 1: 寫測試（失敗）**

  `src/world/mesher.test.ts`：
  - `'a torch renders as a small box, not a full cube'`：造一個立在石頭上的火把 → `meshChunk(world,0,0).torches.quadCount === 6`（一個盒子 6 面）；`opaque.quadCount` 不因火把增加（**火把不進 cube pass**）。
  - `'the torch box is two pixels wide and ten tall'`：讀 `mesh.torches.positions` → 斷言 x 方向的最大最小差 = 2/16、z 同、y 方向差 = 10/16（用 `toBeCloseTo(..., 5)`）。
  - `'a wall torch hugs the wall it is attached to'`：造 `(0,64,0) = STONE`、`(1,64,0) = TORCH`（下方是空氣）→ 斷言 `torchAttachAt(world,1,64,0) === 'wall-x'`（支撐在 x = 0 → 貼在 −x 那一面），且模型的 **x 範圍 = [1, 1 + 2/16] = [1, 1.125]**（`wall-x` → x = `[x, x + w]`；用 `toBeCloseTo(..., 5)` 斷言最大 x = 1.125、最小 x = 1）。
    **（2026-10-20 稽核修正：原斷言「最大 x = 2（偏移 1 − 2/16）」是 `'wall+x'`（支撐在 x = 2）的值，與本測試的造法（支撐在 x = 0）矛盾 → 依 `torchAttachAt` 的優先序（先 +x、再 −x…）本例應為 `'wall-x'`、模型貼在 x = 1 那一側。）**
  - `'a torch on the floor stands centred'`：下方有石頭 → `torchAttachAt(...) === 'floor'`，模型的 x 範圍 = [0.5 − 1/16, 0.5 + 1/16]。

  `src/player/interact.test.ts`：
  - `'a torch needs a full block below or beside it'`：空中無支撐 → `canPlaceTorch(world, 5, 64, 5) === false`；下方有石頭 → `true`；側邊有石頭 → `true`；側邊只有 cross 植被 → `false`。
  - `'a torch can be placed on glass'`：玻璃（solid: true、transparent: true）→ `true`。
  - `'a torch needs an empty target cell'`：目標格已是石頭 → `false`。
  - `'a torch does not collide with the player'`：放置分支放 `BLOCK.TORCH` 時**不檢查玩家 AABB** → 可放（以 main.ts 的接線為準 → 測試放在 `interact.test.ts` 針對新抽出的純函式 `canPlaceBlockAt(world, x, y, z, playerPos, blockId)`）。

  `src/world/lighting.test.ts`（或 `world.test.ts`）：
  - `'a torch pops off when its support is removed'`：`setBlock(0,63,0, STONE)`、`setBlock(0,64,0, TORCH)` → 挖掉 (0,63,0) → 呼叫 `popUnsupportedTorches(world,0,63,0)` → 斷言回傳 1 個位置且 `world.getBlock(0,64,0) === BLOCK.AIR`（火把被收回）。
  - `'a torch with another support stays'`：下方與側邊都有石頭 → 挖掉下方 → `popUnsupportedTorches` 回傳 **0** 個位置、火把還在。

- [ ] **Step 2: 跑測試確認失敗** — `npx vitest run src/world/mesher.test.ts src/player/interact.test.ts src/world/lighting.test.ts` → FAIL。

- [ ] **Step 3: 實作 `torchAttachAt` 與 `isFullSupport`（`src/world/lighting.ts` 或 `src/world/world.ts`）**

  ```ts
  export function isFullSupport(world: World, x: number, y: number, z: number): boolean {
    return isSolid(world.getBlock(x, y, z));   // 玻璃算、cross 植被與水不算
  }
  export function torchAttachAt(world: World, x: number, y: number, z: number): TorchAttach {
    if (isFullSupport(world, x, y - 1, z)) return 'floor';
    if (isFullSupport(world, x + 1, y, z)) return 'wall+x';
    if (isFullSupport(world, x - 1, y, z)) return 'wall-x';
    if (isFullSupport(world, x, y, z + 1)) return 'wall+z';
    if (isFullSupport(world, x, y, z - 1)) return 'wall-z';
    return 'free';
  }
  ```

- [ ] **Step 4: 實作 mesher 的 `torches` pass（`src/world/mesher.ts`）**

  - `ChunkMesh` 加 `torches: MeshData`（B3 的 `foliage` 保持不變）。
  - cube pass 排除火把（`if (getBlockDef(id).shape === 'torch') continue;`——與 cross 同一個跳過條件）。
  - 新 pass 逐格處理火把（**不貪心合併**：每個火把最多 6 個 quad，數量極少）：
    - 盒子尺寸：`w = 2/16`、`h = 10/16`；`floor` → x/z 置中（`x + 0.5 ± w/2`）、y = `[cellY, cellY + h]`；`wall+x` → x = `[x + 1 - w, x + 1]`、z 置中；`wall-x` → x = `[x, x + w]`；`wall+z`／`wall-z` 類推；`free` → 置中。
    - 6 個面的法線照一般盒子的方向；每面 UV 為整張 tile（`[0,0]–[1,1]`）與 `texIndex = T.TORCH`。
    - `shades`：面亮度用 `FACES` 對應方向的 `shade`（top 1.0／bottom 0.5／side 0.72 或 0.86），**不做 AO**（小盒子做 AO 會出現黑邊）。
    - `lightSky`／`lightBlock`：用**火把自己那一格**的光照（不做角落平均 → 簡化，寫進註解）。
  - `src/render/chunk-renderer.ts`：新增第四條 mesh 與材質
    `new THREE.MeshLambertMaterial({ alphaTest: 0.1, vertexColors: true, side: THREE.FrontSide, fog: true })`（掛 **`patchTerrainLightShader`**（Task 4 的地形版 patch）→ 光屬性與 uniform 自動生效）；`castShadow = false`（小盒子不投影）、`receiveShadow = true`、`matrixAutoUpdate = false`；`remove()`／`dispose()` 一併釋放。**（2026-10-20 稽核修正：原本寫「掛同一個 `patchTextureArrayShader` patch」——地形必須掛帶光照的 `patchTerrainLightShader`，否則火把不會隨天空比例變暗。）**

- [ ] **Step 5: 實作放置規則（`src/player/interact.ts`）**

  ```ts
  export function canPlaceTorch(world: World, x: number, y: number, z: number): boolean {
    if (y < 0 || y >= CHUNK_HEIGHT) return false;
    if (world.getBlock(x, y, z) !== BLOCK.AIR) return false;          // 只能放進空氣
    if (isFullSupport(world, x, y - 1, z)) return true;               // 頂
    return isFullSupport(world, x + 1, y, z) || isFullSupport(world, x - 1, y, z)
        || isFullSupport(world, x, y, z + 1) || isFullSupport(world, x, y, z - 1); // 側
  }
  ```
  另抽出純函式（避免改動既有 `canPlaceAt` 的簽名與測試）：
  ```ts
  /** 放置方塊的統一閘門：火把走 canPlaceTorch（無碰撞 → 不檢查玩家 AABB），其餘沿用 canPlaceAt。 */
  export function canPlaceBlockAt(
    world: World, x: number, y: number, z: number,
    playerPos: { x: number; y: number; z: number }, blockId: BlockId,
  ): boolean;
  ```
  （`blockId === BLOCK.TORCH` → `canPlaceTorch`；其餘 → 既有 `canPlaceAt` ✓。）

- [ ] **Step 6: 接線 `src/main.ts`（放置／破壞）**

  - 放置分支（現有 ≈L2270–2289）：改呼叫 `canPlaceBlockAt(world, t.x, t.y, t.z, player.position, placeId)`。
    **（2026-10-20 稽核修正：刪掉原計畫的「放置前若目標格是火把 → 先 `spawnDrop` 一個 `torch` 再覆蓋」——不可達：既有的放置路徑只放進空氣／水（`canPlaceAt`），火把格不可能是放置目標；火把只能被挖掉（該路徑下面已處理）。）**
  - 破壞分支（現有 ≈L2135–2146）：`world.setBlock(hit.x, hit.y, hit.z, BLOCK.AIR)` 之後呼叫 `popUnsupportedTorches(world, hit.x, hit.y, hit.z)` → 對回傳的每個位置 `spawnDrop`（生存模式）並 `world.setBlock(..., BLOCK.AIR)`。
  - `popUnsupportedTorches` 的實作（`src/world/lighting.ts` 或 `world.ts`）：檢查被改動格的 **上方 1 格＋四側 4 格**共 5 個候選格，若該格是火把且 `torchAttachAt(...) === 'free'`（已無任何支撐）→ 收回該火把並回傳位置。

- [ ] **Step 7: 跑測試轉綠** — `npx vitest run src/world/mesher.test.ts src/player/interact.test.ts src/world/lighting.test.ts src/render/chunk-renderer.test.ts` → PASS。

- [ ] **Step 8: 全量 gates** — `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 9: Commit**

  ```bash
  git add src/world/mesher.ts src/world/mesher.test.ts src/render/chunk-renderer.ts src/player/interact.ts src/player/interact.test.ts src/world/lighting.ts src/world/lighting.test.ts src/main.ts
  git commit -m "feat(torch): B6.6 火把小模型與放置規則（頂／側依附、無碰撞、支撐消失即掉落）"
  ```

---

### Task 7: 生怪判準升級為 per-block 光照（取代 B4 的「日光下」近似）

**Files:**
- Modify: `src/world/spawn-rules.ts`、`src/world/spawn-rules.test.ts`（B4 的檔案）
- Modify: `src/world/mobs.ts`、`src/world/mobs.test.ts`
- Modify: `src/world/passive-mobs.ts`、`src/world/passive-mobs.test.ts`（B4 的檔案）
- Modify: `src/world/lighting.ts`、`src/world/lighting.test.ts`（`spawnLightAt`）
- Modify: `src/main.ts`（生怪接線）

**Interfaces:**
- Consumes: Task 2 的 `internalSkyLight`；Task 1／2 的 `skyLightAt`／`blockLightAt`；B4 的 `SpawnLight`／`canSpawnPassive`／`canSpawnHostile`／`PASSIVE_MIN_LIGHT`／`HOSTILE_MAX_SKY_LIGHT`。
- Produces:
  - `src/world/spawn-rules.ts`（**改寫**）：
    ```ts
    export interface SpawnLight {
      /** 客戶端天空光（0..15，時間無關；MC: sky light is not reduced at night） */
      sky: number;
      /** 內部天空光（0..15，隨日夜衰減；MC: internal sky light） */
      internalSky: number;
      /** 方塊光（0..15） */
      block: number;
    }
    export function maxLight(light: SpawnLight): number;              // max(sky, block)（不變）
    export function canSpawnPassive(light: SpawnLight): boolean;      // max(sky, block) >= 9
    export function canSpawnHostile(light: SpawnLight): boolean;      // internalSky <= 7 && block === 0
    // 刪除 clockLight(t)（B4 的近似；B6 用 spawnLightAt 取代）
    ```
  - `src/world/lighting.ts`：
    ```ts
    /** 某格的生怪光照（把區塊光照換算成生怪判準用的三個值）。 */
    export function spawnLightAt(world: World, x: number, y: number, z: number, t: number): SpawnLight;
    ```
  - `src/world/mobs.ts`：`SpawnCtx.isNight: boolean` → `lightAt: (x: number, y: number, z: number) => SpawnLight`。
  - `src/world/passive-mobs.ts`：`PassiveSpawnCtx.light: SpawnLight` → `lightAt: (x: number, y: number, z: number) => SpawnLight`。

**已查證數值**：見〈已查證與設計決策〉§4（敵對：內部天空光 ≤ 7 且方塊光 = 0；被動：亮度 ≥ 9）。

**設計決策（要寫進註解）**：
- **判準本身不變（B4 的常數保留）**，只是把「餵進去的 light 從時鐘近似換成真的 per-block 值」→ B4 計畫已預留這個接縫（`SpawnLight` 是 B6 的替換接縫）。
- **敵對用內部天空光、被動用客戶端天空光**：這是原版的兩套判準（wiki：被動生物在「未被天空遮蔽」時需要方塊光 9+；敵對生物需要**內部**天空光 ≤ 7）。用同一個 `sky` 值會讓「夜間地表」同時滿足兩邊 → 因此 `SpawnLight` 分成 `sky`（客戶端）與 `internalSky`（內部）兩個欄位。
- **被動生物改成「逐隻」檢查**：B4 是在群組前用單一 light 值做粗判；B6 改成每隻候選生物在自己的位置檢查（MC 的規則是逐隻）→ 位置在暗處的成員被略過。
- **刪除 `clockLight`**：B4 的近似函式被 `spawnLightAt` 取代；B4 的測試要改寫（不是弱化：改成明確的 light 值矩陣）。
- **被動生物判準比原版寬（必須寫進 README〈與原版的差異〉）**：`max(sky, block) >= 9` 允許「天空光 9–14（半遮蔽）且方塊光 0」的位置生成；原版是「**未被天空遮蔽**（天空光 15）→ 可生成；否則只看方塊光 ≥ 9」→ 依原版，sky = 10／block = 0 **不會**生成被動生物，本作會。**（2026-10-20 稽核修正：原計畫的 README 差異清單沒有列這一條。）**
- **「檔頭註解」的實際位置**：`src/world/mobs.ts` 那句「no per-block light engine this phase, plan 8.5」在 `mobs.ts:536`（`SpawnCtx` 上方的 doc 註解），**不是檔頭**；改寫時以該處為準（且該註解會先被 B4 改寫一次 → 以合併後的現況文字為準）。

- [ ] **Step 1: 寫測試（失敗）**

  `src/world/spawn-rules.test.ts`（改寫既有測試）：
  - `'hostile mobs need a dark internal sky and no block light'`：`canSpawnHostile({ sky: 15, internalSky: 4, block: 0 })` → true（午夜地表）；`canSpawnHostile({ sky: 15, internalSky: 15, block: 0 })` → false（正午地表）；`canSpawnHostile({ sky: 0, internalSky: 0, block: 1 })` → false（火把旁）。
  - `'passive mobs need light 9 or more'`：`canSpawnPassive({ sky: 15, internalSky: 15, block: 0 })` → true；`canSpawnPassive({ sky: 0, internalSky: 0, block: 9 })` → true；`canSpawnPassive({ sky: 8, internalSky: 8, block: 0 })` → false；`canSpawnPassive({ sky: 0, internalSky: 0, block: 8 })` → false。
  - **既有測試要改寫**：B4 的 `'daylight is bright enough for passive mobs…'` 與 `'nightlight is the opposite'` 依賴 `clockLight` → 改成明確的 `SpawnLight` 值（理由：**判準不變，餵入的真實光照改由世界提供**）。
  - `'the thresholds are the vanilla ones'`：`PASSIVE_MIN_LIGHT === 9`、`HOSTILE_MAX_SKY_LIGHT === 7`（不動）。

  `src/world/lighting.test.ts`：
  - `'spawn light reports the real per block values'`：造一個有屋簷的地形 + 一支火把 → `spawnLightAt(world, 4, 69, 4, 0.25)` → 斷言 `sky === 15`、`internalSky === 15`（正午、開闊處）、`block === 0`；火把旁 → `block === 13`。
  - `'internal sky light drops at night but the client sky light does not'`：`spawnLightAt(world, 開闊處, ..., 0.75)` → `sky === 15`（客戶端光不變）、`internalSky === 4`（午夜）。

  `src/world/mobs.test.ts`（既有 fixture 更新）：
  - `ctxOf` 的 `isNight: true` → `lightAt: () => ({ sky: 15, internalSky: 4, block: 0 })`；`'never spawns in day'` → `lightAt: () => ({ sky: 15, internalSky: 15, block: 0 })` → null。
  - 新增 `'a torch beside the spawn point blocks hostile spawns'`：同一位置但 `lightAt` 回 `{ sky: 15, internalSky: 4, block: 1 }` → 回 null。

  `src/world/passive-mobs.test.ts`（既有測試改寫）：
  - `'passive mobs spawn on grass in daylight'`：`lightAt: () => ({ sky: 15, internalSky: 15, block: 0 })` → 群組 2–4 隻。
  - **既有 `'no passive mob spawns at night'` 要改寫**為 `'no passive mob spawns in the dark'`：`lightAt: () => ({ sky: 0, internalSky: 0, block: 0 })` → 回傳同一參考（**理由**：判準從「時鐘」換成「光照」，夜間**地表**（客戶端天空光 15）仍然可以生成，與原版一致；原測試的前提已不存在）。
  - 新增 `'a torch makes a dark spot spawnable'`：`lightAt` 回 `{ sky: 0, internalSky: 0, block: 9 }` → 會生成。

- [ ] **Step 2: 跑測試確認失敗** — `npx vitest run src/world/spawn-rules.test.ts src/world/mobs.test.ts src/world/passive-mobs.test.ts src/world/lighting.test.ts` → FAIL。

- [ ] **Step 3: 實作 `spawnLightAt`（`src/world/lighting.ts`）**

  ```ts
  export function spawnLightAt(world: World, x: number, y: number, z: number, t: number): SpawnLight {
    const sky = skyLightAt(world, x, y, z);
    const block = blockLightAt(world, x, y, z);
    return { sky, internalSky: internalSkyLight(sky, t), block };
  }
  ```
  （`SpawnLight` 以 `import type` 從 `./spawn-rules` 引入 → 無循環依賴 ✓。）

- [ ] **Step 4: 改寫 `src/world/spawn-rules.ts`**

  - `SpawnLight` 加 `internalSky`；`canSpawnHostile` 改用 `light.internalSky <= HOSTILE_MAX_SKY_LIGHT && light.block === 0`；`canSpawnPassive` 維持 `maxLight(light) >= PASSIVE_MIN_LIGHT`。
  - **刪除 `clockLight`**（檔頭註解同步改寫：不再是「B4 近似」，改為「由 `src/world/lighting.ts` 的 `spawnLightAt` 提供真實光照」）。

- [ ] **Step 5: 改寫 `src/world/mobs.ts` 與 `src/world/passive-mobs.ts`**

  - `SpawnCtx`：`isNight: boolean` → `lightAt: (x: number, y: number, z: number) => SpawnLight`；`trySpawnMob` 在算出 `surfaceYAt` 之後檢查 `canSpawnHostile(ctx.lightAt(Math.floor(spot.x), y, Math.floor(spot.z)))`，不通過 → 回 null。
  - `PassiveSpawnCtx`：`light` → `lightAt`；`trySpawnPassiveGroup` 移除「群組前粗判」，改為**每隻成員**在取位後檢查 `canSpawnPassive(ctx.lightAt(floor(x), y, floor(z)))` → 不通過就跳過該隻（群可以少於 2 隻，維持 B4 既有語意）。
  - `src/world/mobs.ts` 檔頭註解改寫（既有註解寫著「no per-block light engine this phase, plan 8.5」→ 改為「光照判準已升級為 per-block（B6）」）。

- [ ] **Step 6: 接線 `src/main.ts`**

  - `spawnTick()`（≈L710）：
    ```ts
    const mob = trySpawnMob(mobs, player.position, {
      lightAt: (x, y, z) => spawnLightAt(world, x, y, z, clock.t),
      isSolidAt: (x, y, z) => world.isSolid(x, y, z),
      blockIdAt: (x, y, z) => world.getBlock(x, y, z),
    });
    ```
  - 被動生成排程（B4 的 `trySpawnPassiveGroup` 呼叫處）：同樣改成 `lightAt: (x, y, z) => spawnLightAt(world, x, y, z, clock.t)`。

- [ ] **Step 7: 跑測試轉綠** — `npx vitest run src/world/spawn-rules.test.ts src/world/mobs.test.ts src/world/passive-mobs.test.ts src/world/lighting.test.ts` → PASS。

- [ ] **Step 8: 全量 gates** — `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 9: Commit**

  ```bash
  git add src/world/spawn-rules.ts src/world/spawn-rules.test.ts src/world/mobs.ts src/world/mobs.test.ts src/world/passive-mobs.ts src/world/passive-mobs.test.ts src/world/lighting.ts src/world/lighting.test.ts src/main.ts
  git commit -m "feat(spawn): B6.7 生怪判準升級為 per-block 光照（內部天空光 ≤ 7 且方塊光 0／亮度 9+）"
  ```

---

### Task 8: 效能、存檔相容性與視覺驗收

**Files:**
- Create: `src/world/lighting-perf.test.ts`
- Modify: `src/world/save.test.ts`（火把往返）
- Modify: `README.md`（〈與原版的差異〉段落）

**Interfaces:**
- Consumes: 全部前序任務。
- Produces:
  - `src/world/lighting.ts`：
    ```ts
    /** 取出本幀要點光的區塊，數量 ≤ budget（讓「每幀 2 區塊」的預算可被單元測試釘死）。 */
    export function takeLightBudget(queue: Array<[number, number]>, budget: number): Array<[number, number]>;
    /** 依「到玩家的距離平方」遞增排序（近→遠）；回傳新陣列，不改動原陣列。 */
    export function sortLightQueueByDistance(
      queue: ReadonlyArray<[number, number]>, playerX: number, playerZ: number,
    ): Array<[number, number]>;
    ```
  - 效能回歸門檻（測試）＋文件更新。

**設計決策**：
- **效能門檻（2026-10-20 稽核修正：與〈已查證與設計決策〉§7 統一為 8 ms／區塊）**：單區塊重算 < 8 ms（**量測口徑**：清 0 ＋ 3×3 群組播種 ＋ BFS ＋ 跨區塊寫入，**不含**網格重建；用 `performance.now()`、先暖身一次再量）；16 個區塊「生成＋點光」< 1500 ms（沿用 B3 的門檻）；光照陣列大小 = 65536 byte/區塊（記憶體守門）。
- **存檔**：光照**不入存檔**（`collectSavePayload` 的輸出不該出現任何光照欄位 → 用「payload 的 JSON 快照不包含 light 相關鍵」釘死）；火把走 `modified` overlay → 往返後還在。

- [ ] **Step 1: 寫測試（失敗）**

  `src/world/lighting-perf.test.ts`（新建）：
  - `'relighting one chunk stays under the frame budget'`：`computeChunkLight` 單區塊 < **8 ms**（量測口徑見上方設計決策；用 `performance.now()` 量測，先暖身一次再量，避免首次 JIT 偏差）。
  - `'generating and lighting 16 chunks stays inside the worldgen budget'`：16 塊 < 1500 ms。
  - `'the light data costs exactly 64 KiB per chunk'`：`chunk.ensureLight().length === 65536`；且 `chunk.light` 在未被點光前是 `null`（延遲配置）。
  - `'the light queue never exceeds two chunks per frame'`：以 fake 的佇列跑 3 個待處理區塊 → 斷言單幀最多處理 2 個（若此判斷放在 main.ts 難測，則以「`pendingLight` 每幀 shift 上限 2」的純函式測試釘死 → 把「取光佇列前 N 個」的邏輯抽成 `src/world/lighting.ts` 的 `takeLightBudget(queue, budget)`）。
  - `'the light queue is sorted nearest first'`（**2026-10-20 稽核修正：新增**）：`takeLightBudget` 之外的排序邏輯 → 抽出純函式 `sortLightQueueByDistance(queue, playerX, playerZ)`（回傳依「到玩家的距離平方」遞增的新佇列）→ 斷言「離玩家近的區塊排在前面」。

  `src/world/save.test.ts`：
  - `'a torch survives a save and load round trip'`：世界中放一支火把 → `collectSavePayload` → `applyModified` 還原 → 斷言 `world.getBlock(x,y,z) === BLOCK.TORCH`。
  - `'the light is never written to the save payload'`：`JSON.stringify(collectSavePayload(...))` **不包含** `light`／`skyLight`／`blockLight` 任何子字串（大小寫不拘）。

- [ ] **Step 2: 跑測試確認失敗** — `npx vitest run src/world/lighting-perf.test.ts src/world/save.test.ts` → FAIL（perf 檔不存在；火把往返未涵蓋）。

- [ ] **Step 3: 補齊實作直到轉綠（逐項處理，不留模糊步驟）**
  **（2026-10-20 稽核修正：原步驟是「補齊實作直到轉綠（若前序任務已滿足則只需調整測試的量測方式）」——空步驟、不決定任何事。改成三條可檢查的子步驟。）**
  1. 若 `takeLightBudget`／`sortLightQueueByDistance` 尚未存在 → 在 `src/world/lighting.ts` 實作（純函式、可單元測試）：`takeLightBudget(queue, budget)` 取前 `budget` 個；`sortLightQueueByDistance(queue, px, pz)` 依距離平方遞增排序（**不得改動原陣列**，回傳新陣列）。
  2. 若效能測試轉紅 → **先量測再優化**，優化順序：天空柱掃描上界（最高方塊 + 1）→ 天空播種改單次多來源 BFS → 播種只掃 3×3 群組內確實存在的區塊。**不得**為了過門檻而把門檻調高（門檻是 8 ms，與 §7 一致）。
  3. 若存檔測試轉紅 → 檢查 `collectSavePayload` 是否誤把光照欄位寫進 payload（光照明明不入存檔 → 必須移除）。

- [ ] **Step 4: 視覺驗收（人工，記錄結果）**

  `npm run dev` 後逐項確認（結果寫進回報）：
  1. **正午地表**：亮度與 B6 之前一致（天空光 15 → 比例 1.0）→ **不得變亮或變暗**。
  2. **洞穴**：走進地下的洞穴 → 明顯變暗（無火把時接近全黑）。
  3. **放一支火把**：周圍 3–4 格內明顯變亮，亮度隨距離逐格減弱（−1/格）。
  4. **屋簷下**：站在屋簷下 vs 戶外 → 屋簷下較暗**一階**（14）；**走進有牆、有屋頂、只有一個洞口的口袋 → 離洞口每往內一格再暗一階**（14 → 13 → 12）。
     **（2026-10-20 稽核修正：原條目寫「往下每格再暗一階（14 → 13 → 12）」是錯的語意 —— 單格厚屋簷下整列都是 14。已改成「暗一階」＋「口袋內離洞口每格 −1」。）**
  5. **日落**：太陽落下時地表**平滑變暗**（不得出現區塊閃爍或重新載入）；**四個 pass（地形／水／植被／火把）都要一起變暗**（不得只有地形變暗）。
  6. **火把模型**：火把是一根細柱、不是整格方塊；可從側面貼牆。
  7. **挖掉火把的支撐**：火把消失並掉落一根。
  8. **載入後的點亮**：開局**第一幀**玩家周圍（半徑 2 的 5×5）就是正確的光；**5 秒內（60 fps 基準）**畫面中所有可見區塊都完成點亮（不得出現「整片地形近乎全黑」持續數秒）。
     **（2026-10-20 稽核修正：新增。原設計的佇列每幀重建且是掃描順序（遠處優先）→ 529 塊要 265 幀（≈4.4 秒）才點完，且期間地形是 0 光（5% 亮度、近乎全黑）→ Task 8 的驗收「正午地表亮度與 B6 之前一致」在那段期間不成立。Task 3 已改為近→遠排序 ＋ 出生區同步點亮。）**

- [ ] **Step 5: Playwright 夜景目視（可選）**

  若環境允許：靜態伺服 `dist/` ＋ `xvfb-run` 有頭 Chromium（平台 checkout 自帶 `playwright-core`）→ 載入頁面、等世界生成、截圖兩張（正午／把時鐘設成夜間）。**probe 腳本放 repo 外（`/tmp/opencode/`），不得污染工作區**。斷言只做「頁面載入無 console error、canvas 有非零像素」→ **亮度曲線本身以人工目視為準**（CDP 合成鍵無法複刻時間流逝與保留鍵路由，無法複刻的條件列為未驗證）。

- [ ] **Step 6: README〈與原版的差異〉更新**

  補下列條目（繁中、與 spec §6 的清單一致）：
  - 「**天空光的等級不隨時間變**（與原版一致），夜晚的暗來自既有的日照／環境光；本作另疊一層輕微的天空比例（夜間 0.85），因此夜晚比原版略暗。」
  - 「**洞穴沒有火把時幾乎全黑**（原版約 5% 亮度）；本作沒有火把時會很暗，屬刻意對齊。」
  - 「**火把的依附方向由世界推導**（下方是實心方塊就立在地上，否則依固定優先序貼到某一面牆）；原版可以自由指定牆面方向，且火把有獨立的 block state。」
  - 「**過濾方塊（水、葉、冰）不會衰減天空光**（原版每格 −1）。」
  - 「**生物與掉落物不使用逐格光照**（仍由場景燈光照亮）→ 黑暗的洞穴裡敵對生物仍看得到。」
  - 「**生怪判準已升級為光照判準**：敵對生物需要內部天空光 ≤ 7 且方塊光 = 0；被動生物需要亮度 ≥ 9（地表夜間也算）。」
  - 「**被動生物的光照判準比原版寬**：本作只要 `max(天空光, 方塊光) ≥ 9` 就能生成；原版在「天空光未滿 15（半遮蔽）」的位置還要求方塊光 ≥ 9 → 本作會在原版不會生成的位置生成被動生物。」
    **（2026-10-20 稽核修正：新增這條 —— 原清單漏了被動判準與原版的差異。）**

- [ ] **Step 7: 全量 gates** — `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 8: Commit**

  ```bash
  git add src/world/lighting-perf.test.ts src/world/save.test.ts README.md
  git commit -m "test(light): B6.8 光照效能門檻、存檔相容性與差異說明"
  ```

---

### Task 9: 發布 0.9.0

**Files:**
- Modify: `package.json`、`game.json`、`README.md`、`.github/workflows/release.yml`（**若**上游模板有變動才動）
- Create: `docs/releases/v0.9.0.md`

**Interfaces:**
- Consumes: Task 1–8 全部。
- Produces: tag `v0.9.0` 與 GitHub Release（CI 產生）。

- [ ] **Step 1: 版本 bump**

  `package.json` `"version": "0.9.0"`；`game.json` `"version": "0.9.0"`（`id` 不動；`cloudSave` **不動**（維持 `{readableFormats:[1,2], writeFormat:2}`，B6 無存檔格式變更））。

- [ ] **Step 2: README 更新（照 spec §跨批次與 §6）**

  - `## 遊戲特色`：
    - **世界**段補：「**逐格光照**：方塊光（火把）＋天空光會跨區塊傳播；屋簷下與洞穴會變暗、火把會照亮周圍。」
    - **生存模式**段補：「火把：煤＋木棍 → 4 根；只能放在完整方塊的頂或側；挖掉支撐會掉落。」
    - **進度段**：不新增進度（若上游已有 `coal` 相關進度，檢查火把是否需要接線 → 不需要則不動）。
  - `## 與原版的差異`：Task 8 Step 6 的七條。
  - `# Test` 段的測試數字更新為實測值。
  - `# 專案狀態` 補一行 B6 摘要（0.9.0：逐格光照／火把／生怪光照判準）。

- [ ] **Step 3: 發布說明 `docs/releases/v0.9.0.md`**

  固定四段（中文）：`## 新增`／`## 修正`／`## 存檔格式與相容性提示`／`## 已知問題`。
  - **新增**：逐格光照引擎（方塊光＋天空光、跨區塊、生成與載入時計算、頂點亮度與角落平均的平滑渲染）；火把（煤＋木棍 → 4、id 32、光照 14、頂／側放置、小型無碰撞模型、掉落自身、支撐消失即掉落）；生怪判準升級為 per-block 光照（敵對：內部天空光 ≤ 7 且方塊光 0；被動：亮度 ≥ 9）。
  - **修正**：白天與夜晚的地表亮度改由逐格光照決定（正午外觀不變；洞穴與屋簷下變暗）；`src/world/mobs.ts` 與 `src/world/spawn-rules.ts` 的「日光下」近似註解。
  - **存檔格式與相容性提示**：
    1. **存檔格式不變**：本機 payload 維持 **v4**、雲端維持 **format 2**（`readableFormats:[1,2]`、`writeFormat:2`）→ `game.json` 的 `cloudSave` 未變更。
    2. **光照不入存檔**：光照是導出資料，載入時重新計算 → 舊存檔載入後的外觀會立刻套用新的光照（洞穴變暗是預期行為，不是資料損毀）。
    3. **火把隨 modified overlay 保存**：0.9.0 存的火把（block id 32）在 0.9.0 讀回時完好。
    4. **回退限制（必須寫在最前面）**：**0.8.0 不認識 block id 32** → 用 0.8.0 讀 0.9.0 的存檔時，火把會被顯示成空氣（`getBlockDef` 對未知 id 落到空氣，**不會崩**）；回到 0.9.0 時火把會重新出現。雲端格式未升版 → 雲端槽可雙向讀寫。
  - **已知問題**：火把的牆面方向由世界推導（原版可自由指定）；生物與掉落物不使用逐格光照；過濾方塊不衰減天空光；夜晚比原版略暗（額外 0.85 天空比例）；洞內無火把時接近全黑。

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
  Expected: 全綠（既有測試一個不多、一個不少；本批新增的測試全數通過）。

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
  git commit -m "chore(release): 0.9.0"
  ```
  本計畫在 `b6-lighting` 分支執行：tag 與 push 屬整支完成後的整合步驟——merge 回 master 後才 `git tag -a v0.9.0 -m "0.9.0: B6 逐格光照與火把"`＋`git push origin master`＋`git push origin v0.9.0`，由 controller 依 finishing-a-development-branch 流程執行。

- [ ] **Step 8: 驗證 CI Release**

  以 `webfetch https://github.com/TommyLamm/WeCraft/releases/tag/v0.9.0` 確認 release 存在、asset 已附、說明為 `docs/releases/v0.9.0.md` 內容。回報照 AGENTS.md 四段式：程式完成／ZIP 驗證／Release（CI 結果）／平台上架（若屬平台操作，向使用者確認後再按）。**並在回報中明寫「0.8.0 讀不到 block id 32 的相容性提示」**。

- [ ] **Step 9: Commit（收尾）**

  若 Step 8 有任何補正（文件錯字、notes 檔更新），再一顆 commit；無則略過。

---

## 批末驗收

（spec §B6 批末驗收＋公約 §5。）

1. **gates**：`npm run typecheck`、`npm test`、`npm run build`、`npm run lint` 全綠；既有 806 tests／51 files 一個不多、一個不少（本批新增的測試全數通過）。
2. **光照單元測試**（`src/world/lighting.test.ts` 全綠即為證據）：
   - 傳播與衰減：火把 14 → 鄰格 13 → 斜對角 12（taxi-cab，每格 −1）。
   - 遮蔽：不透明方塊擋光（牆後 0）、不透明格本身不持有光。
   - 跨邊界：火把在 x=15 → x=16 拿到 13（**鄰塊必須存在**）；屋簷跨邊界的天空光一致；後生成的鄰塊能把光帶回來。
   - 天空光：開闊柱 15、單格厚屋簷下 **14（整列都是 14）**、有牆的口袋裡離洞口每格 −1（15 → 14 → 13 → 12）、密閉洞穴 0、垂直下傳不衰減。
   - 破壞後更新：挖掉火把 → 周圍歸 0；**挖掉角落火把 → 對角鄰塊也歸 0（無幽靈光）**；挖掉屋簷 → 天空光回到 15。
   - 終止性：鄰塊不存在時重算必須結束（不得無限膨脹）。
   - 日夜：內部天空光正午 15／午夜 4、客戶端天空光不變、天空比例正午 1／夜間 0.85。
3. **生怪判準測試**：敵對（內部天空光 ≤ 7 且方塊光 0）、被動（亮度 ≥ 9）、火把旁不生成敵對、黑暗處不生成被動。
4. **火把全流程**（人工走查，逐項記錄）：
   1. 挖煤礦 → 掉 `coal` → 木棍 → 合成 **4 根火把** ✓
   2. 放在石頭上 → 立著的細柱模型、周圍變亮 ✓
   3. 放在牆側 → 貼牆 ✓
   4. 空中放置 → **被拒絕** ✓
   5. 站在格內放置 → **不被玩家 AABB 阻擋** ✓
   6. 挖掉火把 → 掉落一根 ✓
   7. 挖掉火把的支撐 → 火把掉落 ✓
   8. 存檔 → 重開 → 火把還在、光照正確 ✓
5. **目視**（Task 8 Step 4 的八項）：正午外觀不變、洞穴變暗、火把照明、屋簷暗一階／口袋內逐格 −1、日落平滑（四個 pass 一起變暗）、火把模型、支撐掉落、**載入後 5 秒內點亮完成且出生區第一幀正確**。
6. **效能**（`src/world/lighting-perf.test.ts`）：單區塊重算 < **8 ms**（量測口徑見〈已查證與設計決策〉§7）；16 區塊「生成＋點光」< 1500 ms；每幀光照預算 2 區塊；每區塊光照 64 KiB（記錄於 README／發布說明）。
7. **Playwright**：可選（Task 8 Step 5）；本批不動輸入路由 → **不需要**為輸入／保留鍵補 Playwright；若順手改了 `Esc`／pointer lock／全螢幕 → 必須補且把保留鍵情境列為未驗證。
8. **`pack-game` ＋ `validate-game`**：固定工具（SHA-256 與 lock 一致）兩個都過。
9. **README 與發布說明**：〈與原版的差異〉涵蓋本批的所有刻意簡化（**七條**，含被動生怪判準比原版寬）；發布說明四段齊全、**相容性提示（0.8.0 讀不到 block id 32）寫在最前面**。
10. **存檔格式不動**：本機 v4、雲端 format 2、`game.json` 的 `cloudSave` 未變更（測試守住）。

---

## 與公約／spec 的差異（逐條）

1. **不拆 B6a／B6b（單批 0.9.0）**：spec §B6.3 允許拆分；本計畫依〈拆分決策〉節的理由不拆（版本表被公約 §3 固定、兩半共用同一資料結構與 BFS、B6b 依賴 B6a）。若 controller 改判要拆，備案版本表已寫在該節。
2. **光照的增量更新以「區塊」為粒度，不做逐格 remove-BFS**：spec §B6.1 只要求「生成與載入時計算」，未指定增量粒度。本批改方塊 → 標記受影響區塊（本區塊＋八鄰）→ 下一幀整區塊重算（≤ 8 ms）。理由與代價寫在 Task 3 的設計決策；**這是刻意的簡化，不是遺漏**。
3. **天空光的「隨日夜衰減」分成兩層**：天空光的**等級**時間無關（wiki 原文：「Sky light is not reduced at night」），衰減表現在 (a) 內部天空光（生怪判準，15→4）與 (b) 渲染用的天空比例（正午 1.0、夜間 0.85）。spec §B6.1 的字面描述若被解讀為「天空光等級隨時間下降」，本批**不採**該解讀（與原版相反）→ 記為與 spec 的差異。
4. **火把的依附方向由世界推導、不存 block state**：spec §B6.1 寫「附件方向精簡」→ 本批的簡化方式就是「不存、由世界推」；代價（四面都靠著時取固定優先序）寫進 README。
5. **火把方塊 id = 32、貼圖索引 = 39（`TILE_COUNT` 40）**：依**公約 §3.5 的跨批編號表**（B3 tiles 21–32、B4 `T.WOOL` 33、B5 34–38 → B6 `T.TORCH` 39；B8 的 `T.CHEST` = 40）。仍以規則斷言（`T.TORCH === TILE_COUNT - 1`）守住上游 tile 表變動。**（2026-10-20 稽核修正：原計畫寫 40，會與 B8 的 `T.CHEST = 40` 撞號。）**
6. **存檔格式不動（本機 v4／雲端 format 2）**：與公約 §3 的 B6 列一致；spec §B6.1 的「舊版本讀到未知 block id 的風險」改以**發布說明的相容性提示**處理（0.8.0 不會崩，火把會被顯示成空氣）。
7. **生物與掉落物不使用逐格光照**：spec §B6.1 只提到「渲染以頂點亮度或 lightmap 呈現」，本批的渲染範圍限於地形／水／植被／火把 → 記為已知簡化（README 差異清單第 5 條）。**（2026-10-20 稽核修正：為了不讓粒子／手持物被 5% 亮度打成全黑，`patchTextureArrayShader` 維持原樣、另開 `patchTerrainLightShader` 給地形用 → 粒子與手持物的亮度與 B6 之前一致。）**
8. **過濾方塊不衰減天空光**：原版水／葉／冰讓天空光每格 −1（wiki Light 頁 Light-filtering blocks 段），本批一律不過濾 → 簡化，記於 README。
9. **被動生怪判準比原版寬**：`max(sky, block) >= 9` 允許「半遮蔽（天空光 9–14）且方塊光 0」的位置生成被動生物；原版要求「天空光 15 或方塊光 ≥ 9」→ 簡化，記於 README（差異清單第 7 條）。**（2026-10-20 稽核修正：原計畫的差異清單漏列。）**
10. **跨區塊一致性靠「3×3 群組播種」而非事後同步**：原計畫的 `syncChunkLightWithNeighbors` 讀寫同一格（無效的 no-op）且對角鄰塊的邊界格取錯 → 刪除，改為重算時掃 3×3 群組的來源。**（2026-10-20 稽核修正：演算法缺陷，重算後才正確。）**

---

## Self-Review 記錄

- **Spec coverage**：spec §B6.1（per-block 光照＝方塊光＋天空光、跨區塊傳播、生成與載入時計算、頂點亮度與平滑）→ Task 1（方塊光）＋Task 2（天空光）＋Task 3（生成／載入時計算、跨區塊同步）＋Task 4（頂點亮度、角落平均、著色器）；spec §B6.1（火把：煤＋木棍、光照 14、頂／側、小型無碰撞模型）→ Task 5（配方／資料／貼圖）＋Task 6（放置規則與模型）；spec §B6.1（夜晚與洞穴變暗、日夜與霧色沿用）→ Task 2（比例函式）＋Task 4（uniform）＋Task 8（目視驗收）；spec §B6.1（光照不入存檔、火把隨 overlay 保存、舊版風險入發布說明）→ Task 8（往返與「不入 payload」測試）＋Task 9 Step 3（第 4 點）；spec §B6.2（生怪升級為光照判準）→ Task 7；spec §B6.3（拆分）→ 〈拆分決策〉節；spec §批末驗收（傳播／衰減／邊界測試、目視、效能、Playwright 可選）→ 〈批末驗收〉1–7；spec §跨批次（版本 0.9.0、README、發布說明）→ Task 9。
- **步驟掃描**：每個 Task 都是「寫失敗測試 → 跑（紅）→ 實作 → 跑（綠）→ gates → commit」的 TDD 循環；測試步驟給測試名＋斷言程式碼，實作步驟給簽名＋值（`BLOCK.TORCH = 32`、`T.TORCH = 39`、`TORCH_LIGHT = 14`、`MIN_LIGHT_FACTOR = 0.05`、`SKY_SCALE_NIGHT = 0.85`、`PASSIVE_MIN_LIGHT = 9`、`HOSTILE_MAX_SKY_LIGHT = 7`、合併簽章位元配置、盒子尺寸 2/16 × 10/16）；無 TBD、無「處理邊界情況」這類空話（Task 8 Step 3 已改成三條可檢查的子步驟）。
- **型別一致**：`LightLevels{sky,block}`（Task 1 產生 → Task 2／4 消費）；`Chunk.light`／`Chunk.lightDirty`／`Chunk.topY`／`ensureLight()`（Task 1 產生 → Task 2／3 消費）；`computeChunkTopY`（Task 1 產生 → Task 3 接線消費）；`SpawnLight{sky,internalSky,block}`（Task 7 定義 → `spawnLightAt` 消費）；`internalSkyLight`／`skyLightScale`／`spawnLightAt`（Task 2／7 產生 → Task 4／7 消費）；`groupChunks`／`takeLightBudget`／`sortLightQueueByDistance`（Task 3／8 產生 → main.ts 消費）；`ChunkMesh.torches`（Task 6 產生 → `chunk-renderer` 消費）；`MeshData.lightSky/lightBlock`（Task 4 產生 → Task 6 的火把 pass 消費）；`patchTextureArrayShader`（不變）＋`patchTerrainLightShader`／`LightUniforms`（Task 4 產生 → Task 6 的火把材質消費）；`canPlaceTorch`／`canPlaceBlockAt`／`torchAttachAt`／`isFullSupport`／`popUnsupportedTorches`（Task 6 定義並自用）；存檔：本地 v4 ＋ 雲端 format 2（與公約 §3 一致，**無升版**）。
- **Review Focus→測試**：光不透牆／不穿天 → Task 1 `opaque blocks stop the light`＋Task 2 `a roof shades the ground one level at a time`／`a walled pocket loses one level per step from the opening`；跨區塊雙向一致 → Task 1 `light crosses the chunk border`／`light spreads back into a late neighbour`＋Task 2 `sky light crosses the chunk border`＋Task 3 `a late neighbour pulls light back across the border`；破壞後不留 stale 光／不迴圈 → Task 1 `breaking a torch removes its light`＋Task 3 `a recompute does not re-dirty its neighbours`／`a corner torch leaves no ghost light in the diagonal neighbour`＋Task 1 `the light engine terminates when the neighbour chunks are missing`；日夜不重網格 → Task 4 `setSkyScale updates every material of the renderer`＋Task 8 的預算測試；火把放置與支撐 → Task 6 `a torch needs a full block below or beside it`／`a torch does not collide with the player`／`a torch pops off when its support is removed`／`a torch with another support stays`；存檔往返與舊版相容 → Task 8 `a torch survives a save and load round trip`／`the light is never written to the save payload`＋Task 9 Step 3 的相容性提示。
- **比例**：計畫以決策、數值、簽名與測試斷言為主；只在本質上無法由簽名與測試決定的地方給出具體 body（BFS 的衰減與佇列、柱掃描、合併簽章的位元配置、著色器乘算、火把盒子的幾何、角落平均的取樣集合、內部天空光的公式）→ 未逐字抄整支程式。
- **已知未測面**：`src/main.ts` 無測試（組裝根）→ Task 3／6／7 的接線以人工步驟佐證並在回報中列「未自動化」；渲染的實際亮度與夜景曲線未經 Playwright 自動化斷言（只能截圖與人工目視）→ 列為未驗證；生物／掉落物不參與逐格光照（刻意簡化）。
- **（2026-10-20 稽核修正）**：本計畫依 `/tmp/opencode/wecraft-planning/reviews/b6.md` 的 Critical／Important 逐條修正；演算法部分另用 `/tmp/opencode/wecraft-planning/reviews/b6-fix-sim.mjs` 逐字實作計畫描述的演算法並實測（天空光 BFS 終止、屋簷與口袋的期望值、跨區塊傳遞、對角幽靈光、多來源 BFS 等價性、有界柱掃描等價性），再把演算法與期望值一起改成正確版本。
- **2026-10-20 終審修正摘要**（本計畫依最終跨計畫複核報告修正；修正點在正文以「（2026-10-20 終審修正：…）」標出）：
  1. **必須修正 #3（既有測試基數全是 B5 合併前的舊值）**：Task 5 Step 1 原本寫 `ALL_ITEM_IDS.length` `toBe(32)` → 33、`RECIPES.length` `toBe(13)` → 14——但上游 B5（0.8.0）已把物品表推到 **72**、配方推到 **31** → 照抄必紅，且引用的測試名稱在 B5 之後已不存在。**改法**：一律寫成「**讀現況 → 現況 + 1**」，並要求實作者以合併後 repo 裡的**實際測試名**為準（例：B5 已把 `'ALL_ITEM_IDS is the canonical list: 32 entries…'` 改名）。
  2. **建議修正 #6（洋紅層斷言三批各宣稱要修）**：**唯一的修復點在 B3（0.6.0）**；本批改為「**只驗證、不改寫**」，並附「上游 B3 尚未合併時才由本批補改成**與 B3 完全相同**的 `[TILE_COUNT, TILE_COUNT + 1, 47, 63]`」的備援（不得另創寫法——原計畫的 `TILE_COUNT + 8` 與 B3 的寫法不一致）。
  3. **建議修正 #10（集中清單）**：新增〈本批要改寫的既有測試（集中清單）〉——逐條列出「檔案＋既有測試＋改法＋理由」。
  4. **commit 訊息**：Task 5 的 commit 訊息原本寫死「recipes 補第 14 筆」→ 改為要求寫出**實際數字**（例：`ALL_ITEM_IDS 72 → 73`、`RECIPES 31 → 32`）。
