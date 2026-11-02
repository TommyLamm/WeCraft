# WeCraft B10 弓與箭、床與重生點（0.13.0）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓玩家能用弓箭遠程作戰，並用床跳過夜晚、設定重生點——把既有骷髏箭實體擴充成玩家可發射的投射物，補上燧石／弓／床三個物品與四個配方，把重生點做成不升存檔格式的附加欄位，發布 0.13.0。

**Architecture:** 純邏輯照既有分工放 `src/core`（`bow.ts` 蓄力與傷害、`spawn-point.ts` 重生點清洗）與 `src/world`（`bed.ts` 睡眠條件、`mobs.ts` 的箭實體與命中）；`src/main.ts` 仍是未測的組裝根，只做接線。**玩家箭沿用 B4 的 `Arrow` 實體與 `stepArrows` 掃掠移動**（不另寫一套投射物物理）：在 `Arrow` 上加三個 optional 欄位（`fromPlayer`／`damage`／`fromPos`）、在 `stepArrows` 加一個 optional 目標清單，既有骷髏箭呼叫端完全不變。床是**單一方塊**（比照 B8 箱子的單方塊簡化），睡眠流程是新的 `'sleeping'` 狀態＋純黑覆蓋層；時間跳到 `t = 0`。重生點以 `spawnPoint` 附加欄位進本機 payload v6 與雲端 format 4，**兩個格式號都不升**（舊版會忽略不認識的鍵，與 B3／B4 的附加欄位同一條規則）。

**Tech Stack:** TypeScript strict、Three.js、Vite、Vitest（jsdom 用於 UI／renderer）、IndexedDB、WebAudio 程序合成（音效為加分項）。

**Spec:** `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`（§B10 為本批範圍；§6 已知簡化、§7 決策記錄一併適用）

**上游相依（本批必須在其後實作）**：B4 的 `src/world/mobs.ts`（`Arrow`／`spawnArrow`／`stepArrows`／`MOB_*`）、`mob-drops.ts`（`rollMobDrops`）；B5 的礫石方塊與 `BLOCK.GRAVEL`；B6 的 `internalSkyLight`（`world/lighting.ts`）；B7 的 `ItemStack.dur`／`damageStack`；B8 的存檔 v6／雲端 format 4；B9 的 `spawnB9DeathDrops` 與 `damageSpider` 的 `{ angry?: boolean }`。**若合併後的現況與本計畫引用的 id／簽名／數量不同，以合併後的現況為準**，並在該任務的 commit 訊息說明調整（公約 §9-3）。

---

## Global Constraints

（出自 spec §1／§2／§4、公約 §3／§5／§6 與 AGENTS.md；每個任務的需求都隱含本節。）

- 每個任務結束：`npm run typecheck`、`npm test`、`npm run build`、`npm run lint` 全綠；測試要「改得有理」，禁止為綠燈弱化。既有測試一個不多、一個不少；本批改動舊測試時，必須在 commit 訊息說明「改得有理」的理由。
- **本批要改寫的既有測試（集中清單；「基數」一律在對應 Task 的 Step 1 讀現況）**：

  | 檔案 | 既有測試 | 改法 | 理由 |
  |---|---|---|---|
  | `src/core/items.test.ts` | `TOTAL_ITEM_COUNT`（現況 76）＋測試標題數字＋ union 鏡像 | Task 1 改成 77（＋`bed`）；Task 2 改成 79（＋`flint`／`bow`） | 物品表成長；union 鏡像必須等於 `ALL_ITEM_IDS`（**新增 id**，不是只改數字） |
  | `src/core/recipes.test.ts` | `RECIPES.length`（現況 33）＋ id 清單 | 改成 37，補 `arrow`／`bed`／`bow`／`wool` | 四個新配方；既有案例不動 |
  | `src/core/recipes.test.ts` | `the B9 materials have no recipe yet`（`['gunpowder','string','spider_eye']` 皆不得是配方**產物**） | **名單不動**（線是羊毛配方的**材料**、仍不是任何配方的產物 → 這條守門照樣綠）；只把測試標題／註解改成「線現在有用途了、但仍不是產物」＋另補一則「4 條線 → 1 羊毛」的正向斷言 | 守門**不弱化**；B10 只是讓線成為材料 |
  | `src/world/blocks.test.ts` | `TILE_COUNT === getBlockDef(BLOCK.CHEST).top + 1` | 改成 `=== getBlockDef(BLOCK.BED).side + 1`（床的兩張 tile 是最高的） | 新方塊 tile 追加；不變式本身不變 |
  | `src/world/blocks.test.ts` | `the chest tile is the last declared tile`（`T.CHEST === TILE_COUNT - 1`） | 改成 `the bed side tile is the last declared tile`：`T.BED_SIDE === TILE_COUNT - 1`、`T.CHEST === T.BED_TOP - 1` | 追加之類測試會隨「最後一個 tile」改變，不是放寬 |
  | `src/world/blocks.test.ts` | `PLACEABLE` 的既有斷言 | **只新增** `expect(PLACEABLE).toContain(BLOCK.BED)` | 床可放置 |
  | `src/world/blocks.test.ts` | `requiredTool／fastTool data matches vanilla` 的**窮舉表**（每個 `Object.values(BLOCK)` 都必須列到） | 在表尾補 `[BLOCK.BED, null, null]` | 新方塊 id 進 registry → 窮舉守門會紅（漏列＝靜默缺口） |
  | `src/world/mob-drops.test.ts` | `fixed(0)` 的骷髏掉落期望（現況 `[]`） | 改成 `[{ item: 'bow', count: 1 }]`；`fixed(0.999)` 不變；**加一則** `killedByPlayer: false` → 無弓 | 骷髏 8.5% 掉弓（原版：限玩家／馴狼擊殺）；抽樣順序：骨頭→箭→弓 |
  | `src/ui/icons.test.ts` | 「所有非方塊物品都有專屬圖示」的動態守門 | **不改測試**；在 `icons.ts` 補 `bow`／`flint` 的 `case` | 守門自動涵蓋新 id |
  | `src/world/save.test.ts`／`src/ui/session-boundary.test.ts` | `collectSavePayload` 的 fixture | 每個 fixture 補 `spawnPoint: null`（或測試用的座標） | `SaveSources.spawnPoint` 是**必填**欄位（「沒有也要明寫」的既有慣例） |
  | `src/core/cloud-save.test.ts`／`src/core/cloud-merge.test.ts` | `buildCloudData`／`acceptCloudData`／`mergeCloudData` fixture | 補 `spawnPoint`（多數 `null`，合併測試用不同值驗「本機為基底」） | 新附加欄位 |
  | `src/main.wiring.test.ts` | `damageHeldTool(1)` 呼叫點＝5（測試標題寫「all five」） | 改成 6（弓每射一次扣 1），標題改成「all six」 | 新增合法呼叫點，不是放寬 |

- 版本：本批發布 **0.13.0**；`package.json` 與 `game.json` 同步（`id` 固定 `wecraft`）；tag 為 `v0.13.0` 且指向含 bump 的 commit；不覆寫已發布版本。
- **存檔格式不升版**：本機 payload **v6 不變**、雲端 **format 4 不變**、`game.json` 的 `cloudSave` **一字不動**。`spawnPoint` 是**附加 optional 欄位**：舊版讀到新存檔會忽略它（B3 的 `worldgenVersion`、B4 的 `passiveMobs` 同一條規則）；新版讀到舊存檔 → `spawnPoint: null`（回世界出生點）。發布說明要明說「回退到 0.12.0 只會失去床的重生點，不會讀不到存檔」。
- 原版基準：Minecraft Java Edition 1.20+；數值以本計畫〈已查證與設計決策〉節為準（每條附 wiki 出處）。凡與原版不同處（簡化）必須寫進 README〈與原版的差異〉與發布說明〈已知問題〉。
- 平台紀律：本批**不碰** `Esc`／iframe／pointer lock／全螢幕／瀏覽器保留鍵（睡眠**不解除** pointer lock）→ 不需要為保留鍵補 Playwright；若實作者順手改了，必須補並把保留鍵情境列為未驗證。
- 發布候選跑固定工具：**讀 `.playroom/game-tools.lock.json` 決定版本**（B9 時是 1.2.0；不要假設），先驗 `.playroom/tools/` 內 ZIP 的 `sha256` 與 lock 一致，再跑 `pack-game.mjs` ＋ `validate-game.mjs`。本機無 `unzip`，用 `python3 -m zipfile`。
- 註解誠實化：本批新增的模組檔頭要寫清哪些是原版、哪些是簡化；README 的「無弓」「無床與重生點」兩行**必須刪掉**，改成 B10 的真實描述。
- 分支：本計畫在 `b10-bow-bed` 分支執行（SDD＋隔離 worktree；本計畫只標註分支名，不建立分支）；tag 與 push 由 controller 在 merge 回 master 後依 finishing-a-development-branch 流程執行（Task 10 Step 7）。

## Review Focus

（spec 沒明說、但最可能咬人的輸入類別或失敗模式；每一條都已在對應任務放測試。）

1. **沒有箭、創造模式、最後一發**：生存沒箭時不能發射；創造模式不耗箭、不扣耐久；弓在最後一發壞掉時**箭仍要射出去**（先生成箭、再扣耐久）→ Task 5（`releaseBow` 的順序）＋ Task 3（`bowShotFor` 的邊界）。
2. **箭不能穿牆、也不能打到自己**：40 格/秒的快箭在 0.1 秒 dt 下移動 4 格，必須沿用既有的 ≤0.25 格子步進（否則穿過 1 格牆）；玩家箭不能命中發射者 → Task 4（沿用 `stepArrows` 的 substep ＋ `fromPlayer` 跳過玩家判定）。
3. **睡眠條件與醒來**：白天／天空光太亮不能睡；8 格水平／5 格垂直內有怪不能睡；睡滿 5.05 秒必須回到 `t = 0` 且**不能卡在 `'sleeping'` 狀態**（狀態機要有出口）→ Task 6（`bedUse` 邊界）＋ Task 8（醒來路徑與 wiring 釘子）。
4. **重生點往返**：床的重生點要跨本機存檔／雲端／Continue；床被拆或被炸 → 回世界出生點，**不能重生在石頭裡**；標題畫面仍用世界出生點（避免環繞相機跑到未生成區）→ Task 7（附加欄位）＋ Task 8（`respawnPoint` 驗證／`resetPlayerToSpawn` 與 `respawnPlayer` 分工）。
5. **擊殺只結算一次**：箭打死生物要掉掉落表、要觸發 `mob-killed` 進度，且不能和每幀的死亡清除重複掉；蜘蛛眼仍只認玩家擊殺（箭＝玩家擊殺，爆炸＝不是）→ Task 4（事件）＋ Task 5（`applyPlayerArrowHit` 與四類死亡路徑）。

---

## 檔案結構

| 檔案 | 動作 | 職責 |
|---|---|---|
| `src/world/blocks.ts` | 修改 | `BLOCK.BED = 34`、`T.BED_TOP`／`T.BED_SIDE`、`DEFS[34]`、`PLACEABLE` |
| `src/render/textures.ts` | 修改 | 床的兩張 16×16 tile（top／side） |
| `src/core/items.ts` | 修改 | `bed`／`flint`／`bow` 三個 id、`STACK_ONE` 加**床與弓**（原版床不可堆疊、弓堆疊 1）、`BLOCK_PAIRS` 加床 |
| `src/core/durability.ts` | 修改 | 弓的最大耐久 384 |
| `src/core/recipes.ts` | 修改 | 弓／箭／羊毛／床四個配方 |
| `src/world/drops.ts` | 修改 | `GRAVEL_FLINT_CHANCE` 與 `gravelDropFor` |
| `src/player/interact.ts` | 修改 | `spawnBlockDrop` 走礫石的特殊掉落；`MOB_*` 常數改從 `mobs.ts` 匯入 |
| `src/world/mob-drops.ts` | 修改 | 骷髏 8.5% 掉弓（限玩家／馴狼擊殺） |
| `src/ui/icons.ts` | 修改 | 弓／燧石的像素圖 |
| `src/core/bow.ts` | 新增 | 蓄力步進、放開時的傷害／速度／暴擊（純函式） |
| `src/core/viewmodel.ts` | 修改 | `bowDrawPose(charge)` 的第一人稱拉弓姿態 |
| `src/render/viewmodel.ts` | 修改 | `Viewmodel.setDraw(charge \| null)` |
| `src/world/mobs.ts` | 修改 | `Arrow.fromPlayer`／`damage`／`fromPos`、`spawnPlayerArrow`、`stepArrows` 的目標清單與 `arrow-hit`／`arrow-landed` 事件、`MOB_HALF_WIDTH`／`MOB_HITBOX_HEIGHT` 匯出 |
| `src/core/spawn-point.ts` | 新增 | `SpawnPoint` 型別與 `normalizeSpawnPoint` |
| `src/world/bed.ts` | 新增 | 睡眠條件（距離／怪物／內部天空光）、睡眠時長、床頂重生座標 |
| `src/world/save.ts` | 修改 | `spawnPoint` 附加欄位（寫出＋讀取正規化） |
| `src/core/cloud-save.ts` | 修改 | 雲端 `spawnPoint`（build／validate／accept／merge） |
| `src/ui/sleep.ts` | 新增 | 睡眠黑幕覆蓋層 |
| `src/ui/ui.css` | 修改 | `.sleep-screen` 樣式 |
| `src/main.ts` | 修改 | 弓的輸入／發射／命中／掉落、床的使用／睡眠狀態／重生、存檔與雲端接線、唯讀 debug hooks |
| `src/main.wiring.test.ts` | 修改 | 新增接線釘子（弓、床、重生點） |

## 已查證與設計決策

### 1. 弓（wiki `Bow`，2026-11-01 讀 raw 全文）

- 耐久 **384**；傷害 **1**（< 0.1–0.2 秒）／**5**（0.2–0.8 秒）／**6**（0.9 秒）／**6–11**（1 秒暴擊）。
- 合成：**3 線＋3 木棍**，圖形：
  ```
  [ ][線][棍]
  [線][ ][棍]
  [ ][線][棍]
  ```
- 拉滿 **1 秒**；本作一次射擊扣 **1** 耐久。
- **設計決策**：傷害用上表的**蓄力分桶**（不從速度反推）。速度 = `ARROW_SPEED(40) × charge`（原版滿蓄是 3 格/tick＝60 格/秒；本作沿用既有骷髏箭的 40 格/秒 → **已揭露的簡化**）。暴擊只在 `charge >= 1`，傷害 `6 + floor(rng()*6)`＝6–11。
- 誤差：原版 inaccuracy 1 ＝ 每軸 ±0.0172275 格/tick → 本作 **±0.3446 格/秒**（×20），在 `spawnPlayerArrow` 內加隨機向量。
- 創造模式：不耗箭、不扣耐久（與既有 `damageHeldTool`／`inventory` 的創造守門一致）。

### 2. 箭（wiki `Arrow`，2026-11-01）

- 合成：**燧石＋木棍＋羽毛 → 4 支**（直排三格）。
- 骷髏 0–2 支（**B4 已實作**）；骷髏 8.5% 掉弓（本批補；**只在玩家／馴狼擊殺時**，與既有 `killedByPlayer` 閘門同一套語意）。
- 原版箭實體：重力 0.05 格/tick²（＝20 格/秒²）、阻力 0.99、命中生物後消耗；**本作沿用 B4 的箭實體**（重力 **9.8 格/秒²**、阻力無、30 秒消失）→ 已揭露的簡化。
- **設計決策（可撿性）**：玩家箭命中**方塊** → 在最後一個非實心位置生成 1 支箭的掉落物（可撿，生存模式）；命中**生物** → 消耗、不掉（原版箭會插在生物身上，通常也拿不回來）。骷髏箭（`fromPlayer !== true`）永遠不掉、也不可撿。創造模式不生成掉落物（與方塊掉落同一條規則）。
- 礫石 10% 掉燧石：**只手動挖掘**走這條；爆炸的方塊掉落仍走 `dropItemFor`（掉礫石），列為簡化。

### 3. 床（wiki `Bed`，2026-11-01）

- 合成：**3 羊毛（同色）＋3 木板（任一板材）→ 1 床**；本作只有白色羊毛。
- 硬度 0.2、爆炸抗性 0.2、任何工具都能挖、掉自身。
- 使用距離 **3 格**（Java）；睡眠條件：**內部天空光（天空光 15、依時間）≤ 11**（本作無雷雨）。原版晴朗窗口是 12523–23477 ticks（≈ t 0.522–0.978）；**本作沿用既有的 `internalSkyLight(15, t)` 曲線，實際窗口約 t 0.488–1.0（跨午夜）**——比原版略寬，列為已揭露的近似。**床所在位置的屋頂不影響判定**——原版白天在暗處也不能睡，時間窗口才是主判準（已揭露）。
- 怪物：**床頭**水平 8 格、垂直 5 格內有敵對生物 → 不可睡。
- 睡 **101 tick＝5.05 秒** → 畫面淡黑 → 時間跳到**日出 t = 0**。
- 重生點：使用床（含白天）設定重生點；床被拆／被炸 → 重生點失效。
- **設計決策（簡化）**：床是**單一實心方塊**（無方向、無兩格床頭／床尾、無佔用狀態）；沒有躺床動畫、沒有醒來位置搜尋／「床被阻擋」判定（重生固定在床頂 `y+1`，若該格不是空氣仍會生成——由上方的碰撞把玩家推開，已揭露）；**白天（含暗處）不能睡**（以時間的內部天空光判定，與原版一致 → 已揭露）。睡眠黑幕是簡單的 CSS 覆蓋層（淡入、醒來直接切回）。

### 4. 數值與格式

- `BLOCK.BED = 34`（接在 `CHEST = 33` 後，**只能往後追加**）；tile 41／42，`TILE_COUNT = T.BED_SIDE + 1`。
- `ArrowTargetKind = 'zombie'|'skeleton'|'creeper'|'spider'|'chicken'|'pig'|'sheep'|'cow'`。
- 殭屍／骷髏命中盒沿用 `MOB_HALF_WIDTH = 0.35`、`MOB_HITBOX_HEIGHT = 1.8`（從 `interact.ts` 搬到 `mobs.ts` 匯出，單一真值）；苦力怕 `CREEPER_WIDTH 0.6`／`CREEPER_HEIGHT 1.7`；蜘蛛 `SPIDER_WIDTH 1.4`／`SPIDER_HEIGHT 0.9`；被動生物用 `width`／`height` 欄位。
- 本機 payload 仍 v6；雲端仍 format 4；`readableFormats` 仍 `[1,2,3,4]`。

---

### Task 1: 床方塊（BLOCK.BED = 34、貼圖、掉落、可放置）

**Files:**
- Modify: `src/world/blocks.ts`
- Modify: `src/render/textures.ts`
- Modify: `src/core/items.ts`
- Test: `src/world/blocks.test.ts`, `src/core/items.test.ts`, `src/render/textures.test.ts`

**Interfaces:**
- Consumes: 既有 `T`／`TILE_COUNT`／`DEFS`／`PLACEABLE`／`BLOCK_PAIRS`。
- Produces: `BLOCK.BED: 34`、`T.BED_TOP: 41`、`T.BED_SIDE: 42`、`TILE_COUNT === 43`、ItemId `'bed'`。

- [ ] **Step 1: Write failing tests**

在 `src/world/blocks.test.ts` 新增：
```ts
it('B10: the bed is a single full block with vanilla hardness and blast resistance', () => {
  const def = getBlockDef(BLOCK.BED);
  expect(def.name).toBe('bed');
  expect(def.solid).toBe(true);
  expect(def.shape).toBe('cube');
  expect(def.hardness).toBe(0.2);
  expect(def.blastResistance).toBe(0.2);
  expect(def.requiredTool).toBeNull();
  expect(def.top).toBe(T.BED_TOP);
  expect(def.side).toBe(T.BED_SIDE);
  expect(PLACEABLE).toContain(BLOCK.BED);
});
```
把既有的 `TILE_COUNT === getBlockDef(BLOCK.CHEST).top + 1` 改成 `getBlockDef(BLOCK.BED).side + 1`；同一檔案把 `the chest tile is the last declared tile` 改成 `the bed side tile is the last declared tile`，斷言改為 `expect(T.BED_SIDE).toBe(TILE_COUNT - 1)` 與 `expect(T.CHEST).toBe(T.BED_TOP - 1)`（兩張床 tile 是最後兩個；其餘撞號與 64 層上限斷言不動）。
在 `src/core/items.test.ts` 把 `TOTAL_ITEM_COUNT` 從 76 改成 77，並在 union 鏡像補 `'bed'`；另補一則 `expect(maxStack('bed')).toBe(1)`（wiki `Bed` 條目 infobox：`stackable = No` → 原版床**不可堆疊**）。
在 `src/world/blocks.test.ts` 的 `requiredTool／fastTool` 窮舉表補 `[BLOCK.BED, null, null]`（床徒手可挖、沒有加速工具）。
在 `src/render/textures.test.ts` 新增：`T.BED_TOP`／`T.BED_SIDE` 都在 `TILE_COUNT` 內、且 tile 不是洋紅 placeholder（至少一個像素 alpha 255）。

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/world/blocks.test.ts src/core/items.test.ts src/render/textures.test.ts`
Expected: FAIL（`BLOCK.BED` undefined／tile 不存在／item 計數不符）。

- [ ] **Step 3: Implement**

`src/world/blocks.ts`：
```ts
// B10 Task 1：床（單一方塊；原版是兩格有方向的床，這裡是已揭露的簡化）。
// id 只能往後追加——舊存檔的 modified 記的是數字 id。
BED: 34,
```
```ts
// B10：床的兩張 tile（top／side）接在箱子之後（跨批編號：本批 = 41、42）。
BED_TOP: 41, BED_SIDE: 42,
export const TILE_COUNT = T.BED_SIDE + 1;
```
（同一處的舊註解要一起更新：`T` 表頭寫著「`TORCH` is the highest tile」、`TILE_COUNT` 的說明寫著「currently `T.CHEST`」→ 改成「`BED_SIDE`」／「currently `T.BED_SIDE`」；`BLOCK` 表的跨批編號註解補一行 B10 = 34。）
```ts
34: { id: 34, name: 'bed', hardness: 0.2, blastResistance: 0.2, solid: true, transparent: false, shape: 'cube', top: T.BED_TOP, side: T.BED_SIDE, bottom: T.BED_SIDE, requiredTool: null, fastTool: null },
```
`PLACEABLE` 加 `BLOCK.BED`。
`src/render/textures.ts`：`put(T.BED_TOP, …)` 畫白床墊＋枕頭＋毯子接縫；`put(T.BED_SIDE, …)` 畫下半木框＋上半白床墊＋毯子邊。**所有像素 alpha 255**（全實心方塊）。
`src/core/items.ts`：`ItemId` 加 `'bed'`、`ITEM_IDS` 加 `bed: true`、`BLOCK_PAIRS` 加 `['bed', BLOCK.BED]`、**`STACK_ONE` 加 `'bed'`**（原版床不可堆疊 → `maxStack('bed') === 1`）。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/world/blocks.test.ts src/core/items.test.ts src/render/textures.test.ts`
Expected: PASS。

- [ ] **Step 5: Gates + commit**

```bash
npm run typecheck && npm test && npm run build && npm run lint
git add src/world/blocks.ts src/render/textures.ts src/core/items.ts src/world/blocks.test.ts src/core/items.test.ts src/render/textures.test.ts
git commit -m "feat(blocks): B10 床方塊（id 34、貼圖、掉落與放置）"
```

---

### Task 2: 燧石、弓、四個配方與礫石掉燧石

**Files:**
- Modify: `src/core/items.ts`, `src/core/durability.ts`, `src/core/recipes.ts`, `src/world/drops.ts`, `src/player/interact.ts`, `src/world/mob-drops.ts`, `src/ui/icons.ts`
- Test: `src/core/items.test.ts`, `src/core/durability.test.ts`, `src/core/recipes.test.ts`, `src/world/drops.test.ts`, `src/player/interact.test.ts`, `src/world/mob-drops.test.ts`, `src/ui/icons.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `'bed'`／`BLOCK.BED`；既有 `PatternCell`／`SameItemCell`／`matchShapeless`／`spawnBlockDrop`／`rollMobDrops`。
- Produces: ItemId `'flint'`／`'bow'`；`maxDurability('bow') === 384`；`gravelDropFor(blockId, rng)`；骷髏掉落含弓。

- [ ] **Step 1: Write failing tests**

- `items.test.ts`：`TOTAL_ITEM_COUNT` 79；鏡像補 `flint`／`bow`。
- `durability.test.ts`：`maxDurability('bow') === 384`、`isDurableItem('bow')`。
- `recipes.test.ts`：`RECIPES.length === 37`；把測試標題的「33 settled recipes」改成 37；在既有的 `toEqual([...])` id 清單（**現在是 exact list**）補 `'arrow'`、`'bed'`、`'bow'`、`'wool'`；逐一驗 `findRecipe`（回傳 `Recipe | null` → **用 `?.id`／`?.result`，不是 `?.recipe.id`**）：

```ts
it('B10: bow = 3 string + 3 sticks', () => {
  const g = emptyGrid(3);
  // 右排三根木棍、左中與中上／中下三條線
  g[2] = { item: 'stick', count: 1 }; g[5] = { item: 'stick', count: 1 }; g[8] = { item: 'stick', count: 1 };
  g[1] = { item: 'string', count: 1 }; g[3] = { item: 'string', count: 1 }; g[7] = { item: 'string', count: 1 };
  expect(findRecipe(g, 3)?.id).toBe('bow');
  expect(findRecipe(g, 3)?.result).toEqual({ item: 'bow', count: 1 });
});

it('B10: arrows = flint + stick + feather -> 4', () => {
  const g = emptyGrid(3);
  g[1] = { item: 'flint', count: 1 }; g[4] = { item: 'stick', count: 1 }; g[7] = { item: 'feather', count: 1 };
  expect(findRecipe(g, 3)?.result).toEqual({ item: 'arrow', count: 4 });
});

it('B10: 4 string (shapeless) -> 1 wool', () => {
  const g = emptyGrid(2);
  for (let i = 0; i < 4; i++) g[i] = { item: 'string', count: 1 };
  expect(findRecipe(g, 2)?.result).toEqual({ item: 'wool', count: 1 });
});

it('B10: bed = 3 wool + 3 planks (any plank type)', () => {
  const g = emptyGrid(3);
  for (let c = 0; c < 3; c++) g[c] = { item: 'wool', count: 1 };
  g[3] = { item: 'oak_planks', count: 1 };
  g[4] = { item: 'spruce_planks', count: 1 };
  g[5] = { item: 'birch_planks', count: 1 };
  expect(findRecipe(g, 3)?.id).toBe('bed');
});
```
- `drops.test.ts`：`gravelDropFor(BLOCK.GRAVEL, () => 0.099) === 'flint'`、`0.1 → 'gravel'`、非礫石 → `null`；`interact.test.ts`：`spawnBlockDrop` 對礫石只生成 1 個（不是礫石＋燧石）。
- `mob-drops.test.ts`：把 `rollMobDrops('skeleton', fixed(0))` 的期望改成 `[{ item: 'bow', count: 1 }]`；`fixed(0.999)` 維持骨頭 2／箭 2／無弓；**再加一則** `rollMobDrops('skeleton', fixed(0), { killedByPlayer: false })` → `[]`（弓只在玩家／馴狼擊殺時掉）。
- `icons.test.ts`：動態守門會自動要求 `bow`／`flint` 的 case（**不要**改測試）。

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/items.test.ts src/core/durability.test.ts src/core/recipes.test.ts src/world/drops.test.ts src/player/interact.test.ts src/world/mob-drops.test.ts src/ui/icons.test.ts`
Expected: FAIL（未知 id／配方數／掉落）。

- [ ] **Step 3: Implement**

`src/core/items.ts`：union 加 `'flint' | 'bow'`；`ITEM_IDS` 補；`STACK_ONE` 加 `'bow'`。
`src/core/durability.ts`：`bow: 384`。
`src/core/recipes.ts`（放在 `chest` 之後）：
```ts
// B10：四個新配方的格常量——`S`（stick）與 `P`（任一板材）是檔案既有常量，
// 不要重複宣告；只補這四個。
const STR: PatternCell = 'string';
const FLI: PatternCell = 'flint';
const FEA: PatternCell = 'feather';
const WO: PatternCell = 'wool';
// ...（放在既有常量區，`RECIPES` 之前）

// B10：弓（3 線＋3 木棍；原版圖形）。方向固定（鏡像不匹配，與既有 shaped 慣例一致）。
{
  id: 'bow', kind: 'shaped',
  pattern: [
    [null, STR, S],
    [STR, null, S],
    [null, STR, S],
  ],
  result: { item: 'bow', count: 1 },
},
// B10：箭（燧石／木棍／羽毛直排）→ 4 支
{
  id: 'arrow', kind: 'shaped',
  pattern: [[FLI], [S], [FEA]],
  result: { item: 'arrow', count: 4 },
},
// B10：4 條線 → 1 羊毛（shapeless；把 B9 的線接進羊毛→床）
{
  id: 'wool', kind: 'shapeless',
  inputs: ['string', 'string', 'string', 'string'],
  result: { item: 'wool', count: 1 },
},
// B10：床（上排 3 羊毛、下排 3 木板；板材可混用——`P` 已是「任一板材」）
{
  id: 'bed', kind: 'shaped',
  pattern: [
    [WO, WO, WO],
    [P, P, P],
  ],
  result: { item: 'bed', count: 1 },
},
```
`src/world/drops.ts`：
```ts
export const GRAVEL_FLINT_CHANCE = 0.1;
export function gravelDropFor(blockId: number, rng: () => number = Math.random): 'flint' | 'gravel' | null {
  if (blockId !== BLOCK.GRAVEL) return null;
  return rng() < GRAVEL_FLINT_CHANCE ? 'flint' : 'gravel';
}
```
`src/player/interact.ts` 的 `spawnBlockDrop`：在創造／收穫門檻之後、`chanceDropFor` 之前：
```ts
const gravel = gravelDropFor(blockId, rng);
if (gravel !== null) return spawnDrop(drops, gravel, 1, pos);
```
`src/world/mob-drops.ts` 的 `skeleton` 分支（wiki `Skeleton`「On death」，2026-11-01 讀 raw 全文：「a random chance to drop each piece of naturally spawned equipment, including its bow, **if it is killed by a player or tamed wolf**. The chance … is **8.5%** without Looting」→ 沿用既有 `opts.killedByPlayer` 閘門，與蜘蛛眼同一套語意）：
```ts
case 'skeleton':
  push('bone', range(0, 2));
  push('arrow', range(0, 2));
  if (byPlayer && rng() < 0.085) push('bow', 1);
  break;
```
`src/ui/icons.ts` 的 `drawItemArt` 加 `case 'bow'`（木弓弧＋線）與 `case 'flint'`（深灰銳角石片）。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/items.test.ts src/core/durability.test.ts src/core/recipes.test.ts src/world/drops.test.ts src/player/interact.test.ts src/world/mob-drops.test.ts src/ui/icons.test.ts`
Expected: PASS。

- [ ] **Step 5: Gates + commit**

```bash
npm run typecheck && npm test && npm run build && npm run lint
git add src/core/items.ts src/core/durability.ts src/core/recipes.ts src/world/drops.ts src/player/interact.ts src/world/mob-drops.ts src/ui/icons.ts src/core/items.test.ts src/core/durability.test.ts src/core/recipes.test.ts src/world/drops.test.ts src/player/interact.test.ts src/world/mob-drops.test.ts
git commit -m "feat(items): B10 燧石與弓、弓箭合成與礫石掉燧石"
```

---

### Task 3: 弓的蓄力與傷害（`src/core/bow.ts`）

**Files:**
- Create: `src/core/bow.ts`
- Test: `src/core/bow.test.ts`

**Interfaces:**
- Produces:
```ts
export const BOW_FULL_CHARGE_SEC = 1;
export const BOW_ARROW_SPEED = 40;
export interface BowShot { damage: number; speed: number; critical: boolean }
export function stepBowCharge(charge: number, dtSec: number): number;
export function bowShotFor(charge: number, rng?: () => number): BowShot;
```
- `stepBowCharge`：非有限／≤0 的 dt → 原值（clamp 0..1）；`charge + dt` clamp 到 1。
- `bowShotFor`：NaN／負數 → 當 0；`< 0.2` → 1；`0.2–0.899…` → 5；`0.9–0.999…` → 6；`>= 1` → `6 + floor(rng()*6)`（6–11），`critical: true`。`speed = 40 × clamp01(charge)`。

- [ ] **Step 1: Write failing test**

```ts
it('B10: the charge buckets match the vanilla bow table', () => {
  expect(bowShotFor(0).damage).toBe(1);
  expect(bowShotFor(0.199).damage).toBe(1);
  expect(bowShotFor(0.2).damage).toBe(5);
  expect(bowShotFor(0.899).damage).toBe(5);
  expect(bowShotFor(0.9).damage).toBe(6);
  expect(bowShotFor(0.999).damage).toBe(6);
  expect(bowShotFor(1, () => 0)).toEqual({ damage: 6, speed: 40, critical: true });
  expect(bowShotFor(1, () => 0.999999).damage).toBe(11);
  expect(bowShotFor(NaN).damage).toBe(1);
  expect(bowShotFor(-1).speed).toBe(0);
});
it('B10: stepBowCharge clamps and ignores bad dt', () => {
  expect(stepBowCharge(0, 0.25)).toBe(0.25);
  expect(stepBowCharge(0.9, 0.5)).toBe(1);
  expect(stepBowCharge(0.5, 0)).toBe(0.5);
  expect(stepBowCharge(0.5, NaN)).toBe(0.5);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run src/core/bow.test.ts` → FAIL（找不到模組）。

- [ ] **Step 3: Implement `src/core/bow.ts`**

檔頭註明：蓄力分桶與暴擊區間出自 wiki `Bow`（2026-11-01）；速度沿用本作箭的 40 格/秒（原版滿蓄 60，已揭露）。`clamp01` 用本地小函式（與 `viewmodel.ts` 同風格）。

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run src/core/bow.test.ts` → PASS。

- [ ] **Step 5: Gates + commit**
```bash
npm run typecheck && npm test && npm run build && npm run lint
git add src/core/bow.ts src/core/bow.test.ts
git commit -m "feat(bow): B10 蓄力與傷害純邏輯"
```

---

### Task 4: 玩家箭實體與生物命中（`src/world/mobs.ts`）

**Files:**
- Modify: `src/world/mobs.ts`, `src/player/interact.ts`
- Test: `src/world/mobs.test.ts`

**Interfaces:**
- Consumes: `rayAabbEntry`（`src/world/raycast.ts`）、既有 `Arrow`／`stepArrows`／`spawnArrow`。
- Produces:
```ts
export const MOB_HALF_WIDTH = 0.35;
export const MOB_HITBOX_HEIGHT = 1.8;
export type ArrowTargetKind = 'zombie' | 'skeleton' | 'creeper' | 'spider'
  | 'chicken' | 'pig' | 'sheep' | 'cow';
export interface ArrowTarget {
  id: number;
  kind: ArrowTargetKind;
  pos: { x: number; y: number; z: number }; // 腳底
  halfWidth: number;
  height: number;
}
export interface Arrow {
  /* 既有欄位不變 */
  fromPlayer?: boolean; // B10：玩家箭 → 打生物、不打玩家
  damage?: number;       // B10：命中生物時套用的傷害
  fromPos?: { x: number; y: number; z: number }; // B10：射擊者的眼睛位置（被動生物的 panic 方向要用「攻擊者位置」，不是速度向量）
}
export function spawnPlayerArrow(
  arrows: readonly Arrow[],
  from: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  shot: { speed: number; damage: number },
  rng?: () => number,
): Arrow[];
export function stepArrows(
  arrows: readonly Arrow[],
  dt: number,
  isSolidAt: (x: number, y: number, z: number) => boolean,
  playerPos: { x: number; y: number; z: number },
  targets?: readonly ArrowTarget[],
): { arrows: Arrow[]; events: MobEvent[] };
```
- `MobEvent` 新增：
```ts
| { type: 'arrow-hit'; targetKind: ArrowTargetKind; targetId: number; amount: number;
    pos: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number };
    from: { x: number; y: number; z: number } }  // from ＝射擊者的眼睛位置（spawnPlayerArrow 的 from）
| { type: 'arrow-landed'; pos: { x: number; y: number; z: number } }
```
- 既有 `stepArrows` 4 參數呼叫端（main 與既有測試）行為完全不變：`targets` 預設 `[]`；沒有 `fromPlayer` 的箭仍只檢查玩家、不發新事件。

- [ ] **Step 1: Write failing tests**

在 `mobs.test.ts` 新增（**向量已用 node 重放 `rayAabbEntry`＋`stepArrows` 的子步進語意驗過**，照抄就會命中）：
```ts
it('B10: a player arrow hits a zombie AABB and is consumed', () => {
  // 箭從 y=1.5 起、殭屍腳底 y=1 → 箭在子步進裡一直落在 AABB 的 y 區間 [1, 2.8] 內。
  // （若箭也從 y=1.0 起：第一個子步進重力就把 vel.y 壓到 −0.98，箭立刻掉出
  //   AABB 的 y 區間 → **永遠打不到**；這是照抄就紅的坑。）
  const arrow = spawnPlayerArrow([], { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, { speed: 40, damage: 6 }, () => 0.5);
  const target: ArrowTarget = { id: 7, kind: 'zombie', pos: { x: 2, y: 1, z: 0 }, halfWidth: 0.35, height: 1.8 };
  const out = stepArrows(arrow, 0.1, () => false, { x: 0, y: 1, z: 0 }, [target]);
  expect(out.arrows).toHaveLength(0);
  expect(out.events).toContainEqual(expect.objectContaining({
    type: 'arrow-hit', targetKind: 'zombie', targetId: 7, amount: 6,
  }));
});

it('B10: a player arrow that hits a wall becomes a recoverable landing event', () => {
  const arrow = spawnPlayerArrow([], { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, { speed: 40, damage: 1 }, () => 0.5);
  const out = stepArrows(arrow, 0.1, (x) => x >= 1, { x: 0, y: 1, z: 0 }, []);
  expect(out.arrows).toHaveLength(0);
  expect(out.events).toContainEqual(expect.objectContaining({ type: 'arrow-landed' }));
});

it('B10: a player arrow never hits the shooter; skeleton arrows still hit the player and ignore targets', () => {
  const playerArrow = spawnPlayerArrow([], { x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: -1 }, { speed: 40, damage: 1 }, () => 0.5);
  expect(stepArrows(playerArrow, 0.1, () => false, { x: 0, y: 1, z: 0 }, []).events).toHaveLength(0);

  // 玩家受擊判定用的是**眼睛點**（`playerPos.y + EYE_OFFSET`，EYE_OFFSET = 1.4）
  // 與箭的 0.6 格半徑 → 玩家的腳底必須放 y=0、箭也要從眼睛高度 y=1.4 發射。
  const skeletonArrow = spawnArrow([], { x: 0, y: 1.4, z: 2 }, { x: 0, y: 0, z: -1 }, 1);
  const out = stepArrows(skeletonArrow, 0.1, () => false, { x: 0, y: 0, z: 0 }, [
    { id: 7, kind: 'zombie', pos: { x: 0, y: 1, z: -1 }, halfWidth: 0.35, height: 1.8 },
  ]);
  expect(out.events).toContainEqual(expect.objectContaining({ type: 'damage', target: 'player' }));
  expect(out.events.some((e) => e.type === 'arrow-hit')).toBe(false);
});
```
再加一則：箭從殭屍頭上飛過（y 差 2 格）不命中；苦力怕／被動目標各一則（用 `kind` 與命中盒尺寸）。

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run src/world/mobs.test.ts` → FAIL（`spawnPlayerArrow` 未定義／事件型別不存在）。

- [ ] **Step 3: Implement**

- 把 `interact.ts` 的 `MOB_HALF_WIDTH = 0.35`／`MOB_HITBOX_HEIGHT = 1.8` 搬到 `mobs.ts` 並 `export`；`interact.ts` 改成 `import { MOB_HALF_WIDTH, MOB_HITBOX_HEIGHT, damageMob, type Mob } from '../world/mobs';`，刪掉本地常數（**行為不變**，由既有 `hitMobId` 測試守門）。
- `Arrow` 加三個 optional 欄位；`spawnArrow` 不動（回傳物件不帶新欄位）。
- `spawnPlayerArrow`：與 `spawnArrow` 相同的 max+1 id、age 0、`ownerId = -1`；方向先 normalize 再乘 `shot.speed`；每軸加 `(rng()*2 - 1) * 0.3446` 的誤差；`fromPlayer: true`、`damage: shot.damage`、**`fromPos: { ...from }`**（射擊者的眼睛位置 → 事件裡帶出去，被動生物的 panic 方向要用它）。
- `stepArrows`：在每個 substep 的固體判定**之後**：
  - 若 `a.fromPlayer === true`：對 `targets` 逐一做 `rayAabbEntry(prev, unitDir, {x: pos.x-halfWidth, y: pos.y, z: pos.z-halfWidth}, {x: pos.x+halfWidth, y: pos.y+height, z: pos.z+halfWidth})`；`t !== null && t <= sub` 的**最小 t** 勝出 → 推 `arrow-hit`（`amount: a.damage ?? ARROW_DAMAGE`、`dir: vel`、`pos: pos`、`from: a.fromPos ?? a.pos`）、`consumed = true`。
  - 若 `a.fromPlayer !== true`：維持既有的玩家 eye 點到 segment 的距離判定（`EYE_OFFSET = 1.4` ＋ 半徑 0.6）。
  - 固體命中：若 `fromPlayer`，推 `arrow-landed`（`pos: prev`），否則靜默消耗（與現在一樣）。
- **箭的 y 高度要對得起目標的 AABB**：`rayAabbEntry` 是**射線對盒子**，箭往下掉時會離開盒子的 y 區間 → 測試向量裡箭必須從目標身高**內**出發（見 Step 1 的註解）。
- 既有 `segmentDistance` 保留給玩家判定。

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run src/world/mobs.test.ts src/player/interact.test.ts` → PASS（既有箭測試也要綠）。

- [ ] **Step 5: Gates + commit**
```bash
npm run typecheck && npm test && npm run build && npm run lint
git add src/world/mobs.ts src/player/interact.ts src/world/mobs.test.ts
git commit -m "feat(arrows): B10 玩家箭實體與生物命中"
```

---

### Task 5: 弓的接線與視角蓄力動畫

**Files:**
- Modify: `src/main.ts`, `src/core/viewmodel.ts`, `src/render/viewmodel.ts`
- Test: `src/core/viewmodel.test.ts`, `src/main.wiring.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `bowShotFor`／`stepBowCharge`；Task 4 的 `spawnPlayerArrow`／`ArrowTarget`／新事件；`inventory.countItem`／`removeItem`；`rayOrigin`／`dir`（main 的 playing 分支既有變數）。
- Produces: 可玩的弓；`Viewmodel.setDraw(charge: number | null): void`；`bowDrawPose(charge)`。

- [ ] **Step 1: Write failing tests**

`src/core/viewmodel.test.ts`：
```ts
it('B10: bowDrawPose pulls the bow back and up as charge grows', () => {
  const p0 = bowDrawPose(0);
  const p1 = bowDrawPose(1);
  expect(p1.posZ).toBeLessThan(p0.posZ);
  expect(p1.rotX).toBeGreaterThan(p0.rotX);
  expect(bowDrawPose(NaN)).toEqual(bowDrawPose(0));
  expect(bowDrawPose(2)).toEqual(bowDrawPose(1));
});
```
`src/main.wiring.test.ts`：
```ts
it('B10: the bow is wired through charge -> spawnPlayerArrow -> durability', () => {
  expect(countOf('spawnPlayerArrow(')).toBe(1);
  expect(countOf('bowShotFor(')).toBe(1);
  expect(countOf('damageHeldTool(1)')).toBe(6); // B7 的 5 處 ＋ 弓
  expect(playingBranchBody()).toContain('heldIsBow()');
  expect(playingBranchBody()).toContain('viewmodel.setDraw(');
});
it('B10: player arrow hits are applied to all four mob families', () => {
  const body = functionBody('applyPlayerArrowHit');
  expect(body).toContain("case 'zombie'");
  expect(body).toContain("case 'creeper'");
  expect(body).toContain("case 'spider'");
  expect(body).toContain('damagePassiveMob(');
});
```

- [ ] **Step 2: Run tests to verify they fail**
Run: `npx vitest run src/core/viewmodel.test.ts src/main.wiring.test.ts` → FAIL。

- [ ] **Step 3: Implement**

`src/core/viewmodel.ts`：
```ts
/** B10：拉弓姿態（charge 0..1）。往後（posZ 負）、往上一點、往左一點、上仰。 */
export function bowDrawPose(charge: number): { rotX: number; posX: number; posY: number; posZ: number } {
  const k = Math.sin(Math.PI * 0.5 * clamp01(Number.isFinite(charge) ? charge : 0));
  return { rotX: 0.18 * k, posX: -0.10 * k, posY: -0.06 * k, posZ: -0.16 * k };
}
```
`src/render/viewmodel.ts`：介面加 `setDraw(charge: number | null): void`；`let draw: number | null = null;`；`setDraw` 存值（`null` 或 clamp 0..1）；在 `update()` 的 swing/bob 之後，把 `bowDrawPose(draw ?? 0)` 的偏移套到 `iconMesh`（`position`／`rotation.x`），`draw === null` 時歸零。

`src/main.ts`：
1. 匯入 `bowShotFor`、`stepBowCharge`、`spawnPlayerArrow`、`CREEPER_WIDTH`／`CREEPER_HEIGHT`、`SPIDER_WIDTH`／`SPIDER_HEIGHT`、`MOB_HALF_WIDTH`／`MOB_HITBOX_HEIGHT`。
2. 狀態：`let bowDraw: { charge: number; slot: number } | null = null;`
3. `heldIsBow()`：`slots[selected]?.item === 'bow'`。
4. `releaseBow()`（在 playing 分支內、`rayOrigin`／`dir` 可見的位置）：
```ts
const shot = bowShotFor(bowDraw.charge);
const hasArrow = currentMode === 'creative' || inventory.countItem('arrow') > 0;
const from = { x: rayOrigin.x, y: rayOrigin.y, z: rayOrigin.z };
if (!hasArrow) {
  hudHint.show('沒有箭了');
} else {
  if (currentMode === 'survival') inventory.removeItem('arrow', 1);
  arrows = spawnPlayerArrow(arrows, from, dir, { speed: shot.speed, damage: shot.damage });
  damageHeldTool(1); // 先射箭、再扣耐久 → 最後一發壞掉時箭仍射出
  hud.setHotbar(slots, selected);
}
viewmodel.setDraw(null);
bowDraw = null;
```
5. `wantPlace` 鏈：在 `hitBlock === BLOCK.CHEST` 之後、`heldIsFood()` 之前加：
```ts
} else if (heldIsBow()) {
  bowDraw = { charge: 0, slot: selected };
  viewmodel.setDraw(0);
}
```
6. 在 `wantPlace` 區塊之後（連放／進食之前）加每幀推進：
```ts
if (bowDraw) {
  if (selected !== bowDraw.slot || slots[selected]?.item !== 'bow') {
    bowDraw = null; viewmodel.setDraw(null); // 換格／弓沒了 → 取消，不發射
  } else if (!input.state.placeHeld) {
    releaseBow();
  } else {
    bowDraw = { ...bowDraw, charge: stepBowCharge(bowDraw.charge, dt) };
    viewmodel.setDraw(bowDraw.charge);
  }
}
```
7. `setState` 的「離開 playing」區塊加 `bowDraw = null; viewmodel.setDraw(null);`。
8. 命中套用：在 `stepArrows` 前建目標清單並傳入：
```ts
const arrowTargets: ArrowTarget[] = [
  ...mobs.map((m) => ({ id: m.id, kind: m.kind, pos: m.pos, halfWidth: MOB_HALF_WIDTH, height: MOB_HITBOX_HEIGHT })),
  ...creepers.map((c) => ({ id: c.id, kind: 'creeper' as const, pos: c.pos, halfWidth: CREEPER_WIDTH / 2, height: CREEPER_HEIGHT })),
  ...spiders.map((s) => ({ id: s.id, kind: 'spider' as const, pos: s.pos, halfWidth: SPIDER_WIDTH / 2, height: SPIDER_HEIGHT })),
  ...passiveMobs.map((m) => ({ id: m.id, kind: m.kind, pos: m.pos, halfWidth: m.width / 2, height: m.height })),
];
const arrStep = stepArrows(arrows, dt, isSolidAt, player.position, arrowTargets);
arrows = arrStep.arrows;
for (const ev of arrStep.events) {
  if (ev.type === 'damage') applyMobEvent(ev, true);
  else if (ev.type === 'arrow-landed') {
    if (currentMode === 'survival') {
      drops = spawnDrop(drops, 'arrow', 1, ev.pos);
      bus.emit('drops-changed', {});
    }
  } else if (ev.type === 'arrow-hit') applyPlayerArrowHit(ev);
}
```
**`applyMobEvent` 必須加型別窄化**：`MobEvent` 多了兩個 variants 後，既有的 `if (ev.type === 'shoot') { … }` 之後不再是 `damage`；在 `if (!vitals) return;` 之前補 `if (ev.type !== 'damage') return;`（否則 `ev.amount`／`ev.mobId` 讀不到，typecheck 直接紅）。
9. `applyPlayerArrowHit(ev)`：**單一目標、早退**——`switch (ev.targetKind)` 分派；每個分支先找到那一隻，**找不到或已死 → 直接 return**（同一幀的第二支箭不得重複結算／重複觸發進度）；命中時對應 `mobRenderer.flashMob(id)`／`b9Renderer.flashCreeper(id)`／`b9Renderer.flashSpider(id)`／`passiveRenderer.flashPassiveMob(id)`；套傷害用**現有簽名**（注意三個 `from` 參數的語意不同：`damageMob`／`damageCreeper`／`damageSpider` 的第 3 參數是**擊退方向**向量；只有 `damagePassiveMob` 的第 3 參數是**攻擊者位置**）：
```ts
function applyPlayerArrowHit(ev: Extract<MobEvent, { type: 'arrow-hit' }>): void {
  let killed = false;
  switch (ev.targetKind) {
    case 'zombie':
    case 'skeleton': {
      const target = mobs.find((m) => m.id === ev.targetId);
      if (!target || isDead(target)) return;         // 找不到／已死 → 不重複結算
      const next = damageMob(target, ev.amount, ev.dir); // 第 3 參數＝擊退方向
      mobs = mobs.map((m) => (m.id === ev.targetId ? next : m));
      mobRenderer.flashMob(ev.targetId);
      killed = isDead(next);
      break;
    }
    case 'creeper': {
      const target = creepers.find((c) => c.id === ev.targetId);
      if (!target || isCreeperDead(target)) return;
      const next = damageCreeper(target, ev.amount, ev.dir); // 第 3 參數＝擊退方向
      creepers = creepers.map((c) => (c.id === ev.targetId ? next : c));
      b9Renderer.flashCreeper(ev.targetId);
      killed = isCreeperDead(next);
      break;
    }
    case 'spider': {
      const target = spiders.find((s) => s.id === ev.targetId);
      if (!target || isSpiderDead(target)) return;
      // 第 3 參數＝擊退方向；第 4 參數才是 angry，**預設是 true**
      // （`opts.angry ?? true`，spider.ts；B9 的爆炸才顯式傳 false）→ 箭＝玩家攻擊 → 顯式 true
      const next = damageSpider(target, ev.amount, ev.dir, { angry: true });
      spiders = spiders.map((s) => (s.id === ev.targetId ? next : s));
      b9Renderer.flashSpider(ev.targetId);
      killed = isSpiderDead(next);
      break;
    }
    case 'chicken':
    case 'pig':
    case 'sheep':
    case 'cow': {
      const target = passiveMobs.find((m) => m.id === ev.targetId);
      if (!target || isPassiveDead(target)) return;
      // 第 3 參數＝**攻擊者位置**（panic 方向＝背離攻擊者）→ 用事件帶的 `ev.from`
      // （射擊者的眼睛位置，來自 `spawnPlayerArrow` 的 `fromPos`）；第 4 參數＝擊退方向
      const next = damagePassiveMob(target, ev.amount, { x: ev.from.x, z: ev.from.z }, ev.dir);
      passiveMobs = passiveMobs.map((m) => (m.id === ev.targetId ? next : m));
      passiveRenderer.flashPassiveMob(ev.targetId);
      killed = isPassiveDead(next);
      break;
    }
  }
  if (killed) applyAdvancement({ type: 'mob-killed', mode: currentMode });
  // **掉落不要在這裡生成**：殭屍／骷髏走既有死亡清除，苦力怕／蜘蛛在下一步的死亡過濾補掉落，被動生物既有過濾已掉
}
```
10. 苦力怕／蜘蛛的死亡過濾改成「先收集死者 → 再過濾（死或超距）」：
```ts
const deadCreepers = creepers.filter((c) => isCreeperDead(c));
creepers = creepers.filter((c) => !isCreeperDead(c) && xzDistance(c.pos, player.position) <= DESPAWN_DISTANCE);
if (deadCreepers.length > 0) {
  bus.emit('mobs-changed', { count: mobs.length });
  const table = deadCreepers.map((c) => ({ kind: 'creeper' as const, pos: c.pos }));
  if (spawnB9DeathDrops(table, true)) bus.emit('drops-changed', {});
}
```
蜘蛛同型（`isSpiderDead`／`spawnB9DeathDrops(table, true)`）。註解要說明「近戰／爆炸的死者已由各自路徑移除，這裡只會看到箭矢等新死因」。

- [ ] **Step 4: Run tests to verify they pass**
Run: `npx vitest run src/core/viewmodel.test.ts src/main.wiring.test.ts` → PASS；再跑 `npx vitest run src/world/mobs.test.ts src/core/bow.test.ts`。

- [ ] **Step 5: Gates + commit**
```bash
npm run typecheck && npm test && npm run build && npm run lint
git add src/main.ts src/core/viewmodel.ts src/render/viewmodel.ts src/core/viewmodel.test.ts src/main.wiring.test.ts
git commit -m "feat(bow): B10 弓的接線與視角蓄力動畫"
```

---

### Task 6: 睡眠條件與重生點（`src/core/spawn-point.ts`、`src/world/bed.ts`）

**Files:**
- Create: `src/core/spawn-point.ts`, `src/core/spawn-point.test.ts`, `src/world/bed.ts`, `src/world/bed.test.ts`

**Interfaces:**
- Consumes: `internalSkyLight`（`world/lighting`）。
- Produces:
```ts
export interface SpawnPoint { x: number; y: number; z: number }
export function normalizeSpawnPoint(x: unknown): SpawnPoint | null;
```
```ts
export const BED_USE_DISTANCE = 3;
export const SLEEP_MAX_INTERNAL_SKY_LIGHT = 11;
export const SLEEP_MONSTER_HORIZONTAL = 8;
export const SLEEP_MONSTER_VERTICAL = 5;
export const SLEEP_DURATION_SEC = 5.05;
export type BedUse = 'too-far' | 'monsters' | 'set-spawn-only' | 'sleep';
export function bedUse(ctx: {
  eye: { x: number; y: number; z: number };
  bed: SpawnPoint;             // 方塊座標
  clockT: number;
  monsters: ReadonlyArray<{ pos: { x: number; y: number; z: number } }>;
}): BedUse;
export function bedSpawnPosition(bed: SpawnPoint): { x: number; y: number; z: number };
```

- `bedUse` 順序：距離（eye → 床方塊中心，**≤ 3** 才算近）→ 睡眠條件（`internalSkyLight(15, clockT) <= 11`；時間的內部天空光，本作曲線的實際窗口約 t 0.488–1.0、跨午夜）→ 不能睡 → `'set-spawn-only'`；能睡 → 怪物（水平 `<= 8`、垂直 `<= 5`，以床中心 vs 怪物腳底）→ `'monsters'` 或 `'sleep'`。**重生點在 `too-far` 之後一律設定**（原版：右鍵床就設定重生點，白天或有怪物時只是不能睡）——`main` 在 `too-far` 檢查後、處理其他回傳值前就寫 `bedSpawn`。**不讀床所在格的光**（屋頂不影響；白天在暗處也不能睡，與原版一致）。
- `bedSpawnPosition`：`{ x: bed.x + 0.5, y: bed.y + 1, z: bed.z + 0.5 }`。
- `normalizeSpawnPoint`：物件、`x/y/z` 都是**有限整數**、`y ∈ [0, 255]`、`|x|, |z| <= 30_000_000` → 回新物件；否則 `null`（`null`／`undefined` → `null`）。

- [ ] **Step 1: Write failing tests**

`spawn-point.test.ts`：合法值回新物件（不是同一參考）、缺欄位／小數／NaN／y 超界／`null` → `null`。
`bed.test.ts`：
```ts
const bed = { x: 10, y: 64, z: 10 };
const ctx = (over: Partial<Parameters<typeof bedUse>[0]> = {}) => ({
  eye: { x: 10.5, y: 66, z: 12.5 }, // 3 格內
  bed,
  clockT: 0.75, // 午夜
  monsters: [],
  ...over,
});
it('B10: night = sleep; noon / morning = set spawn only', () => {
  expect(bedUse(ctx())).toBe('sleep');
  expect(bedUse(ctx({ clockT: 0.25 }))).toBe('set-spawn-only'); // 正午 → 內部天空光 15
  expect(bedUse(ctx({ clockT: 0.05 }))).toBe('set-spawn-only'); // 日出後 → 15
  expect(bedUse(ctx({ clockT: 0.48 }))).toBe('set-spawn-only'); // 內部天空光 13 > 11
  expect(bedUse(ctx({ clockT: 0.49 }))).toBe('sleep'); // 內部天空光 11（門檻邊界）
  expect(bedUse(ctx({ clockT: 0.5 }))).toBe('sleep'); // 黃昏 → 10
});
it('B10: monsters block sleep at 8 blocks horizontal / 5 vertical (inclusive)', () => {
  expect(bedUse(ctx({ monsters: [{ pos: { x: 18.5, y: 64.5, z: 10.5 } }] }))).toBe('monsters');
  expect(bedUse(ctx({ monsters: [{ pos: { x: 18.51, y: 64.5, z: 10.5 } }] }))).toBe('sleep');
  expect(bedUse(ctx({ monsters: [{ pos: { x: 10.5, y: 69.49, z: 10.5 } }] }))).toBe('monsters');
  expect(bedUse(ctx({ monsters: [{ pos: { x: 10.5, y: 69.51, z: 10.5 } }] }))).toBe('sleep');
});
it('B10: using a bed farther than 3 blocks is too far', () => {
  expect(bedUse(ctx({ eye: { x: 10.5, y: 66, z: 13.51 } }))).toBe('too-far');
});
it('B10: the sleep duration is 101 ticks and the spawn point is the bed top', () => {
  expect(SLEEP_DURATION_SEC).toBe(5.05);
  expect(bedSpawnPosition(bed)).toEqual({ x: 10.5, y: 65, z: 10.5 });
});
```

- [ ] **Step 2: Run tests to verify they fail**
Run: `npx vitest run src/core/spawn-point.test.ts src/world/bed.test.ts` → FAIL（模組不存在）。

- [ ] **Step 3: Implement**（如上簽名；`bed.ts` 檔頭引用 wiki `Bed` 2026-11-01、本作曲線的實際窗口約 0.488–1.0（跨午夜）、以及「屋頂不影響判定」的說明）

- [ ] **Step 4: Run tests to verify they pass**
Run: `npx vitest run src/core/spawn-point.test.ts src/world/bed.test.ts` → PASS。

- [ ] **Step 5: Gates + commit**
```bash
npm run typecheck && npm test && npm run build && npm run lint
git add src/core/spawn-point.ts src/core/spawn-point.test.ts src/world/bed.ts src/world/bed.test.ts
git commit -m "feat(bed): B10 睡眠條件與重生點純邏輯"
```

---

### Task 7: 重生點存檔與雲端（附加欄位、不升版）

**Files:**
- Modify: `src/world/save.ts`, `src/core/cloud-save.ts`, `src/main.ts`
- Test: `src/world/save.test.ts`, `src/ui/session-boundary.test.ts`, `src/core/cloud-save.test.ts`, `src/core/cloud-merge.test.ts`

**Interfaces:**
- Consumes: Task 6 的 `SpawnPoint`／`normalizeSpawnPoint`。
- Produces:
  - `SavePayloadV6.spawnPoint?: SpawnPoint | null`；`SavePayloadWithPassiveMobs.spawnPoint: SpawnPoint | null`；`SaveSources.spawnPoint: SpawnPoint | null`（子介面的必填欄位必須能覆寫父介面的 optional 欄位 → 父層一定要含 `null`）。
  - `CloudData.spawnPoint?: SpawnPoint | null`；`CloudBuildSource.spawnPoint: SpawnPoint | null`；`acceptCloudData` 一律回傳 `SpawnPoint | null`。
  - main 的 `let bedSpawn: SpawnPoint | null = null;`（Task 8 才會設定；本任務先把寫出／套用接好）。

- [ ] **Step 1: Write failing tests**

- `save.test.ts`（**放進已有 `describe` 裡**，那裡已經有本檔自己的 helper `sourcesOf(world)`；不要新造 `baseSources()`——save.test.ts 沒有那個函式）：
```ts
it('B10: collectSavePayload writes the bed spawn point (deep-copied) and loadGame normalizes it', async () => {
  const world = new World();
  const src = { ...sourcesOf(world), spawnPoint: { x: 4, y: 65, z: -7 } };
  const payload = collectSavePayload(src);
  expect(payload.spawnPoint).toEqual({ x: 4, y: 65, z: -7 });
  expect(payload.spawnPoint).not.toBe(src.spawnPoint); // 新物件
  // loadGame：寫入後讀回仍是同座標；缺失 → null；髒值 → null（沿用既有 fake IDB 測試慣例）
});
```
- `session-boundary.test.ts`：既有 fixture 補 `spawnPoint: null`（或一個座標），斷言不變。
- `cloud-save.test.ts`：`buildCloudData({ ..., spawnPoint: {x:1,y:65,z:2} })` → `data.spawnPoint` 深拷貝；`acceptCloudData` 對 `spawnPoint: null`／**欄位缺失** → **回傳 payload 且 `spawnPoint === null`**；對合法值 → 新物件；**對髒值（小數／缺欄位／非物件）→ `validateCloudData` 整包拒收 → `acceptCloudData(...)` 回 `null`（不是「回 payload 但 spawnPoint 為 null」）**；`validateCloudData` 對 `spawnPoint: 'x'` → false。
- `cloud-merge.test.ts`：`local.spawnPoint = {x:1,y:65,z:2}`、`remote.spawnPoint = {x:9,y:70,z:9}` → merged 用**本機**；`local.spawnPoint` 為 `undefined` → merged **不帶**這個鍵；`local.spawnPoint === null` → merged 的 `spawnPoint === null`（依 `mergeCloudData` 既有的 optional-spread 風格）。
- 格式釘子：`CLOUD_FORMAT_VERSION === 4`、`CLOUD_READABLE_FORMATS` 仍 `[1,2,3,4]`（既有測試應已釘；若沒有，補一則）。

- [ ] **Step 2: Run tests to verify they fail**
Run: `npx vitest run src/world/save.test.ts src/ui/session-boundary.test.ts src/core/cloud-save.test.ts src/core/cloud-merge.test.ts` → FAIL（缺 `spawnPoint` 欄位／必填 `SaveSources`）。

- [ ] **Step 3: Implement**

`src/world/save.ts`：
```ts
import { normalizeSpawnPoint, type SpawnPoint } from '../core/spawn-point';
// SavePayloadV6 加 optional：spawnPoint?: SpawnPoint | null;
// SavePayloadWithPassiveMobs 加 required：spawnPoint: SpawnPoint | null;
// SaveSources 加 required：spawnPoint: SpawnPoint | null;
// collectSavePayload：spawnPoint: args.spawnPoint ? { ...args.spawnPoint } : null,
// loadGame：在既有那條解構上多拆一個鍵（不是另開一條鏈）——
//   const { worldgenVersion: rawVersion, passiveMobs: rawPassiveMobs,
//           spawnPoint: rawSpawnPoint, ...migratedClean } = migrated;
//   回傳 { ...migratedClean, spawnPoint: normalizeSpawnPoint(rawSpawnPoint), … }
//   （一定是 null 或新物件）
```
`src/core/cloud-save.ts`：
```ts
import { normalizeSpawnPoint, type SpawnPoint } from './spawn-point';
// CloudData 加 optional：spawnPoint?: SpawnPoint | null;
// CloudBuildSource 加 required：spawnPoint: SpawnPoint | null;
// buildCloudData：spawnPoint: src.spawnPoint ? { ...src.spawnPoint } : null,
// validateCloudData：if (r.spawnPoint !== undefined && r.spawnPoint !== null &&
//   normalizeSpawnPoint(r.spawnPoint) === null) return false;
// acceptCloudData：spawnPoint: normalizeSpawnPoint(x.spawnPoint),
// mergeCloudData：local 基底（與 blockEntities 同一個 optional-spread 風格）
//   ...(local.spawnPoint === undefined
//     ? {}
//     : { spawnPoint: local.spawnPoint ? { ...local.spawnPoint } : null }),
```
`src/main.ts`：`let bedSpawn: SpawnPoint | null = null;`；`sessionSavePayload` 傳 `spawnPoint: bedSpawn`；`saveCloudNow` 的 `buildCloudData` 傳 `spawnPoint: bedSpawn`；`startGame` 設 `bedSpawn = null`；`continueGame` 設 `bedSpawn = payload.spawnPoint ? { ...payload.spawnPoint } : null`；`applyCloudData` 設 `bedSpawn = data.spawnPoint ? { ...data.spawnPoint } : null`。

- [ ] **Step 4: Run tests to verify they pass**
Run: `npx vitest run src/world/save.test.ts src/ui/session-boundary.test.ts src/core/cloud-save.test.ts src/core/cloud-merge.test.ts` → PASS。

- [ ] **Step 5: Gates + commit**
```bash
npm run typecheck && npm test && npm run build && npm run lint
git add src/world/save.ts src/core/cloud-save.ts src/main.ts src/world/save.test.ts src/ui/session-boundary.test.ts src/core/cloud-save.test.ts src/core/cloud-merge.test.ts
git commit -m "feat(save): B10 重生點附加欄位（本機與雲端，不升版）"
```

---

### Task 8: 床的接線、睡眠流程與重生

**Files:**
- Create: `src/ui/sleep.ts`, `src/ui/sleep.test.ts`
- Modify: `src/ui/ui.css`, `src/main.ts`, `src/main.wiring.test.ts`

**Interfaces:**
- Consumes: Task 6 的 `bedUse`／`bedSpawnPosition`／`SLEEP_DURATION_SEC`；Task 7 的 `bedSpawn`／存檔欄位；既有 `spawnB9DeathDrops`、`world.getBlock`。
- Produces: `createSleepScreen(uiRoot)`（`show()`／`hide()`／`isVisible()`）；`GameState` 加 `'sleeping'`；唯讀 debug hooks `bedSpawn()`／`sleeping()`／`arrowStates()`。

- [ ] **Step 1: Write failing tests**

`src/ui/sleep.test.ts`：
```ts
it('B10: the sleep screen mounts once, shows text, and hides idempotently', () => {
  const root = document.createElement('div');
  const screen = createSleepScreen(root);
  expect(screen.isVisible()).toBe(false);
  screen.show(); screen.show();
  expect(root.querySelectorAll('.sleep-screen')).toHaveLength(1);
  expect(root.querySelector('.sleep-screen')?.textContent).toContain('睡覺中');
  expect(screen.isVisible()).toBe(true);
  screen.hide(); screen.hide();
  expect(root.querySelector('.sleep-screen')).toBeNull();
});
```
`src/main.wiring.test.ts`：
```ts
it('B10: right-click on a bed uses it before food/placement', () => {
  const playing = playingBranchBody();
  const bed = playing.indexOf('hitBlock === BLOCK.BED');
  const food = playing.indexOf('heldIsFood()');
  expect(bed).toBeGreaterThan(-1);
  expect(food).toBeGreaterThan(bed); // 床先於進食
});
it('B10: sleeping has an exit: sleepT >= SLEEP_DURATION_SEC -> clock t=0 -> playing', () => {
  // 釘「sleeping 分支在**外層**迴圈」（tick clock 的那一個 if），不是內層的遊戲尾段：
  expect(mainSource).toContain("if (state === 'sleeping') {");
  expect(mainSource).toContain('sleepT += dt');
  expect(mainSource).toContain('sleepT >= SLEEP_DURATION_SEC');
  expect(mainSource).toContain('setState(\'sleeping\')');
  expect(mainSource).toContain('clock = { ...clock, t: 0 }');
  expect(mainSource).toContain('setState(\'playing\')');
});
it('B10: respawn uses the bed only while the bed still exists; title/new game keep world spawn', () => {
  expect(functionBody('respawnPoint')).toContain('BLOCK.BED');
  expect(functionBody('respawnPlayer')).toContain('respawnPoint()');
  expect(functionBody('handleRespawn')).toContain('respawnPlayer()');
  expect(functionBody('resetPlayerToSpawn')).not.toContain('bedSpawn');
});
it('B10: breaking or exploding a bed clears the spawn point', () => {
  expect(mainSource).toContain('clearBedSpawnAt(');
  expect(functionBody('runExplosion')).toContain('clearBedSpawnAt(');
});
```

- [ ] **Step 2: Run tests to verify they fail**
Run: `npx vitest run src/ui/sleep.test.ts src/main.wiring.test.ts` → FAIL。

- [ ] **Step 3: Implement**

`src/ui/sleep.ts`：`div.sleep-screen` ＋ `p` 文字「睡覺中…」；`show()` 冪等（已有就 return）、`hide()` 冪等；`dispose` 不需要。`ui.css`：fixed inset 0、黑底、**`z-index: 25`**（現況層級：menu 9／death 10／toast 20／cursor 30 → 25 蓋過 toast、又壓在游標之下；睡眠中不會死亡，所以不必低於死亡畫面）、`pointer-events: none`、`opacity` 過渡 0.8 s；`.sleep-text` 白字。

`src/main.ts`：
1. `GameState` 加 `'sleeping'`；`setState` 對所有轉移呼叫 `sleepScreen.hide()`（冪等）。
2. `let sleepT = 0;`
3. `tryUseBed(x, y, z)`：
```ts
const bed = { x, y, z };
const eye = { x: player.position.x, y: player.position.y + EYE_HEIGHT, z: player.position.z };
const monsters = [
  ...mobs.map((m) => ({ pos: m.pos })),
  ...creepers.map((c) => ({ pos: c.pos })),
  ...spiders.map((s) => ({ pos: s.pos })),
];
const use = bedUse({ eye, bed, clockT: clock.t, monsters });
if (use === 'too-far') { hudHint.show('床太遠了'); return; }
bedSpawn = { ...bed }; // 原版：右鍵床就設定重生點（白天／有怪物只是不能睡）
if (use === 'monsters') { hudHint.show('附近有怪物，無法入睡（重生點已設定）'); return; }
if (use === 'set-spawn-only') { hudHint.show('你只能在夜晚睡覺（重生點已設定）'); return; }
sleepT = 0;
setState('sleeping');
sleepScreen.show();
```
4. `wantPlace` 鏈：在箱子之後、食物之前加 `else if (hit && hitBlock === BLOCK.BED) { tryUseBed(hit.x, hit.y, hit.z); }`。
5. 動畫迴圈：**動畫迴圈裡有兩個 `if (state === 'playing') {`**——外層（`gs.renderer.setAnimationLoop` 裡、tick clock 的那一個，現況約 main.ts:3324）與內層（遊戲尾段，約 main.ts:3679）。要改的是**外層、tick clock 的那一個**（內層是「遊戲尾段」，它巢在 playing 分支裡，本來就只在 playing 跑）：
```ts
if (state === 'sleeping') {
  sleepT += dt;
  if (sleepT >= SLEEP_DURATION_SEC) wakeFromBed();
} else if (state === 'playing') {
  // …原本的外層 playing 分支（tick clock → …）
}
```
（改錯成內層 → `'sleeping'` 時外層不成立 → `sleepT` 永遠不推進 → **卡死在睡眠**；wiring 釘子抓不到這個錯，所以下面那則子串釘子要照寫。）
6. `wakeFromBed()`：
```ts
clock = { ...clock, t: 0 };
bus.emit('time-changed', { phase: 'day', t: 0 });
applyAdvancement({ type: 'phase', phase: 'day' });
audio.setPhase('day');
sleepScreen.hide();
setState('playing');
```
7. 重生拆分：
```ts
function resetPlayerAt(x: number, y: number, z: number): void { player = createPlayer(x, y, z); deathCause = null; fallState = resetFall(); attackCd = 0; }
function resetPlayerToSpawn(): void { const sp = spawnPoint(); resetPlayerAt(sp.x, sp.y, sp.z); } // 新局／回標題：世界出生點（不變）
function respawnPoint(): { x: number; y: number; z: number } {
  if (bedSpawn && world.getBlock(bedSpawn.x, bedSpawn.y, bedSpawn.z) === BLOCK.BED) return bedSpawnPosition(bedSpawn);
  return spawnPoint();
}
function respawnPlayer(): void { const sp = respawnPoint(); resetPlayerAt(sp.x, sp.y, sp.z); }
```
`handleRespawn` 改呼叫 `respawnPlayer()`；`quitToTitle`／`startGame` 維持 `resetPlayerToSpawn()`。
8. `clearBedSpawnAt(x, y, z)`：若 `bedSpawn` 座標相符 → `bedSpawn = null`；在手動破壞方塊（`world.setBlock(AIR)` 之後）與 `runExplosion` 的 `result.destroyed` 迴圈呼叫。
9. debug hooks（唯讀）：`bedSpawn: () => (bedSpawn ? { ...bedSpawn } : null)`、`sleeping: () => state === 'sleeping'`、`arrowStates: () => arrows.map((a) => ({ id: a.id, x: a.pos.x, y: a.pos.y, z: a.pos.z, fromPlayer: a.fromPlayer === true }))`。

- [ ] **Step 4: Run tests to verify they pass**
Run: `npx vitest run src/ui/sleep.test.ts src/main.wiring.test.ts src/world/bed.test.ts` → PASS。

- [ ] **Step 5: Gates + commit**
```bash
npm run typecheck && npm test && npm run build && npm run lint
git add src/ui/sleep.ts src/ui/sleep.test.ts src/ui/ui.css src/main.ts src/main.wiring.test.ts
git commit -m "feat(bed): B10 床的接線、睡眠流程與重生"
```

---

### Task 9: 弓與箭的音效（加分項，可延後）

**Files:**
- Modify: `src/audio/voices.ts`, `src/audio/index.ts`, `src/main.ts`
- Test: `src/audio/index.test.ts`（或既有音訊測試檔）

**Interfaces:**
- Produces: `AudioFacade.playBowShoot(opts?)`／`playArrowHit(opts?)`；程序合成（短促的木頭「咚」＋噪音尾）。

- [ ] **Step 1: Write failing test**：以 `createAudioFacade` 的 fake context 驗「引擎未啟動時是 no-op」「啟動後呼叫不拋錯」；若既有 facade 測試用 spy，照同一套。
- [ ] **Step 2: Run → FAIL。**
- [ ] **Step 3: Implement `voices.ts` 的 `bowShoot`／`arrowHit`（濾波噪音＋短振盪），`index.ts` 的 facade 方法（`playCreeperHiss` 同款距離衰減），main 在發射／命中時呼叫。**
- [ ] **Step 4: Run → PASS。**
- [ ] **Step 5: Gates + commit**：`git commit -m "feat(audio): B10 弓箭音效（加分項）"`。

> 若時間不足可延後：把本任務標成未做，並在 Task 10 的發布說明「未做／延後」列出；**不得**留下半接線的呼叫。

---

### Task 10: 0.13.0 發布（README／spec／release notes／bump／pack）

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`（若 Task 0 尚未寫入 §B10）、`game.json`, `package.json`
- Create: `docs/releases/v0.13.0.md`

**Interfaces:**
- Consumes: 全部 Tasks 的成果。

- [ ] **Step 1: README**

刪掉這兩行（現況 L182–L183）：
```
- 無弓（**仍沒有弓**；但箭矢已有取得途徑——骷髏會掉 0–2 支箭，只能當彈藥，無法射出）
- 無床與重生點設定
```
改成 B10 的真實段落（放在 B9 段落後）：

- **弓與箭（0.13.0）**：弓（3 線＋3 木棍、耐久 384、按住右鍵蓄力 1 秒、傷害 1／5／6／6–11、每次射擊扣 1 耐久、創造模式不耗箭）；箭（燧石＋木棍＋羽毛 → 4 支、礫石 10% 掉燧石、骷髏 0–2 支與玩家擊殺時 8.5% 掉弓）；玩家箭命中生物（殭屍／骷髏／苦力怕／蜘蛛／被動）套用蓄力傷害，命中方塊落地成可撿的箭；骷髏箭仍只傷玩家且不可撿。
- **床與重生點（0.13.0）**：床（3 羊毛＋3 木板、硬度／爆炸抗性 0.2、單一方塊、掉自身）；右鍵 3 格內使用；可睡＝**時間的內部天空光 ≤ 11**（本作約 t 0.488–1.0，跨午夜；原版窗口 ≈ 0.522–0.978），8 格水平／5 格垂直內無敵對生物；睡 5.05 秒跳過夜晚；右鍵床一律設定重生點（白天或有怪物時只提示、不睡）；死亡後床還在就重生在床頂，床被拆／炸就回世界出生點；重生點跨本機與雲端（**存檔格式不升版**）。
- 在「與原版的差異」補 B10 簡化清單（單方塊床、無方向／兩格、無躺床動畫、無雷雨、白天暗處不能睡、無醒來位置搜尋／床阻擋判定、箭命中生物即消耗、箭速度 40 格/秒、無暴擊粒子、無附魔、骷髏掉弓滿耐久、礫石只在手動挖掘時掉燧石）。
- 更新「操作」段落（如果 README 有右鍵說明）：按住右鍵拉弓、放開發射；右鍵床睡覺／設重生點。

- [ ] **Step 2: Spec**

確認 §B10 已存在；把 §6 的「無弓」「無床與重生點」移除（若 Task 0 已做則略過），並補 §7 的 B10 決策記錄。

- [ ] **Step 3: Release notes**

`docs/releases/v0.13.0.md` 照 `docs/releases/v0.12.0.md` 的格式：
- 開頭引言（弓與箭＋床與重生點）。
- 新增：弓／箭／燧石／床、四個配方、骷髏掉弓、蓄力射擊、睡眠、重生點、音效（若有）。
- 變更：README 的簡化清單、存檔格式（**本機 v6／雲端 format 4 不變，`spawnPoint` 是附加欄位**）。
- 已知問題／簡化：上面的 B10 清單。
- 驗證：**實測**的 tests/files 數、typecheck／build／lint、pinned 工具 pack＋validate、瀏覽器探針（引用 Task 11 的結果）、未驗證清單。
- 不要先寫未測到的數字：Step 4 跑完 gates 後再填。

- [ ] **Step 4: Bump + gates**

```bash
# game.json：version 0.13.0；instructions 補「按住右鍵拉弓、放開發射；右鍵床睡覺並設定重生點」
# package.json：version 0.13.0
npm run typecheck && npm test && npm run build && npm run lint
```
把實際 `Test Files`／`Tests` 數字寫進 release notes。

- [ ] **Step 5: Pack + validate（repo 內 pinned 工具）**

```bash
# 先讀 .playroom/game-tools.lock.json 的版本與 sha256；用同版本的 zip
node <tools>/pack-game.mjs dist <out>/game.zip
node <tools>/validate-game.mjs <out>/game.zip
```
Expected: `Packed wecraft v0.13.0`、`Valid: wecraft v0.13.0 (tools <lock 版本>)`。

- [ ] **Step 6: Commit**

```bash
git add README.md docs/releases/v0.13.0.md game.json package.json docs/superpowers/specs/2026-10-18-wecraft-parity-design.md
git commit -m "chore(release): 0.13.0（B10 弓與床）"
```

- [ ] **Step 7: Merge / tag / push（controller，依 finishing-a-development-branch）**

- merge 回 master（FF）→ 在 master 重跑 `typecheck`／`test` → `git tag -a v0.13.0 -m "0.13.0: B10 弓與床"` → push master＋tag → 等 CI Release → 下載 asset → 用 pinned `validate-game.mjs` 重驗 → 比對 `docs/releases/v0.13.0.md` 與 Release body 逐字相同。**平台上架仍是手動**。

---

### Task 11: 批末驗收（真實瀏覽器探針、效能、回歸）

**Files:** 無 repo 內檔案（探針放 repo 外 `/tmp/opencode/wecraft-b10-probe/`；證據寫進 gitignored 的 SDD ledger）。

- [ ] **Step 1: 全量 gates**

```bash
npm run typecheck && npm test && npm run build && npm run lint
npm run test:perf   # 既有 lighting-perf（npm test 排除）
```
Expected: 全綠；perf < 33 ms 門檻（讀目前的門檻值）。

- [ ] **Step 2: 弓的瀏覽器探針（headful＋xvfb＋靜態伺服 `dist/`）**

- 開新局（creative 或 survival；creative 用 `ui-inv-list` 的 `[title="Bow"]`／`[title="Arrow"]` 取得物品）。
- 對牆按住右鍵 1 秒 → 放開：`__wecraft.arrowStates()` 出現 `fromPlayer: true` 的箭；`dropItems()` 之後出現 `{ item: 'arrow' }`（落地可撿）。
- 對骷髏／殭屍滿蓄射擊（用 `mobStates()` 導航＋CDP 滑鼠瞄準）：hp 下降 6–11；擊殺後掉落表正常；**被箭射中的生物不生成可撿的箭**。
- 生存模式：箭數 −1、弓 `dur` −1；沒有箭時放開 → 不生成箭、提示「沒有箭了」。
- Expected: 以上全過；把實際輸出記進 ledger。

- [ ] **Step 3: 床與重生點的瀏覽器探針**

- 用 `localStorage` 把日長設成 60 秒（讀 `src/core/settings.ts` 的鍵）→ 開局等待 `clock()` ≥ 0.52。
- Creative 取得 `[title="Bed"]` → 放在平地 → 右鍵：`sleeping()` true → 等 5.2 秒 → `clock()` ≈ 0、`sleeping()` false、`bedSpawn()` 等於床座標。
- 白天右鍵床：不睡、`bedSpawn()` 仍設定（提示）。
- 有怪物在 8 格內：不睡（若自然生成難控制，直接把怪引到床邊；或列為部分未驗證）。
- Save & quit → Continue：`bedSpawn()` 保留；拆床 → `bedSpawn()` null。
- **實際死亡→床重生**：若能用自然怪／摔落完成就驗；否則列為「未在瀏覽器驗證（由 `bed.test.ts`＋wiring 釘子覆蓋）」。

- [ ] **Step 4: 效能**

用 repo 外的小腳本量 `stepArrows`：20 支玩家箭 × 28 個目標 × 1000 tick，記 avg／p95／max；寫進 release notes（若有明顯超標就回報，不硬塞）。Expected: avg 遠低於 1 ms。

- [ ] **Step 5: 回歸與清理**

- 重跑一次完整 gates（release 後 master）。
- 確認 `v0.12.0` 以前的 tag／Release 未被移動。
- 刪除本批 worktree／分支（確認已合併）與 repo 外暫存；保留 SDD ledger。
- 回報四段：程式完成／ZIP 驗證／Release／平台上架（最後一段永遠是手動、未做就明說）。

---

## 批末驗收（Definition of Done）

- [ ] 弓可蓄力、可放開射擊；傷害分桶 1／5／6／6–11；耐久 384、每射 −1；創造不耗箭、不扣耐久；沒有箭時不發射。
- [ ] 玩家箭可命中四類敵對＋被動生物；命中生物消耗、命中方塊掉可撿的箭；骷髏箭行為不變。
- [ ] 箭擊殺會掉掉落表、會觸發 `mob-killed`；蜘蛛眼仍只認玩家擊殺；沒有重複掉落。
- [ ] 床可合成／放置／挖回；右鍵 3 格內使用；內部天空光（時間）≤ 11 才能睡；怪物 8／5 格阻擋；白天只設重生點。
- [ ] 睡眠 5.05 秒→ `t=0`；`'sleeping'` 有出口、不會卡住；黑幕 UI 正常。
- [ ] `spawnPoint` 跨本機／雲端／Continue；床被拆／炸 → 回世界出生點；標題／新局仍用世界出生點。
- [ ] 本機 payload v6、雲端 format 4、`cloudSave` 皆未升版；舊存檔可載、新存檔舊版可忽略 `spawnPoint`。
- [ ] `npm run typecheck`／`npm test`／`npm run build`／`npm run lint` 全綠；`npm run test:perf` 過。
- [ ] pinned 工具 `pack-game.mjs`＋`validate-game.mjs` 過；ZIP 重新下載驗證。
- [ ] README／spec §B10／`docs/releases/v0.13.0.md` 與實作一致；未驗證清單誠實列出。

## 與公約／spec 的差異（要寫進 README 與發布說明）

1. 弓的滿蓄箭速 **40 格/秒**（原版 60）；重力沿用 B4 的 9.8（原版 20）。
2. 箭命中生物**立即消耗**、不插在生物身上；只有命中方塊才掉可撿的箭。
3. 骷髏掉弓是**滿耐久**（不模擬裝備耐久）；骷髏不顯示弓的模型、也不會射「有弓的骷髏」以外的變化。
4. 床是**單一方塊**：無方向、無床頭／床尾、無佔用狀態、無睡覺動畫／躺床；醒來固定在床頂。
5. 睡眠條件用**時間的內部天空光**（`internalSkyLight(15, t) <= 11`），不讀床格自身的天空光；本作曲線的窗口約 t 0.488–1.0，比原版 12523–23477 ticks（≈ 0.522–0.978）**略寬**（已揭露）；無雷雨、無 phantom／失眠。
6. 無「床被阻擋」判定與醒來位置搜尋；重生點可能被方塊佔住（由碰撞推開）。
7. 白天使用床只設重生點、不睡覺；有怪物時**仍設定重生點**、只是不能睡（與原版一致）。
8. 礫石掉燧石只在**手動挖掘**；爆炸掉礫石。
9. 無弓的附魔（Power／Infinity／Flame）、無暴擊粒子、無箭的火焰／藥水效果。
10. 拉弓不減慢移動速度（原版會）。

## 未解／實作時複核

- 實作時先讀現況的 `TOTAL_ITEM_COUNT`／`RECIPES.length`／`TILE_COUNT`／測試檔數，不要假設本計畫的數字。
- `internalSkyLight(15, clockT)` 的實際可睡窗口是否與合併後的 B6 生怪判準一致（本作約 t 0.488–1.0）；若不一致，以 `src/world/bed.ts` 的註解與測試為準並記 Ruling。
- `MOB_HALF_WIDTH`／`MOB_HITBOX_HEIGHT` 搬移後，`interact.test.ts` 的既有命中盒測試是否仍綠（應不變）。
- `render/viewmodel.ts` 的 icon plane 原點與 draw pose 的疊加順序（`iconMesh` 目前是 0 位移）。
- `sleepScreen` 的 z-index 固定 **25**（toast 20 之上、cursor 30 之下；死亡畫面 10 在它下面——睡眠中不會死，不必讓路）。
- 白天＋附近有怪時，`bedUse` 先判時間 → 回 `'set-spawn-only'` → 提示「只能在夜晚睡覺」，**不會**出現「附近有怪物」訊息（原版也是先判時間）；要看到怪物訊息必須在可睡的時間窗內。
- `bedSpawn()` debug hook 回的是**方塊座標**（`{x,y,z}` 整數），`respawnPoint()` 才會轉成床頂（`y+1`、中心 +0.5）→ 探針要對齊「方塊座標」這個 frame。
- 瀏覽器探針的瞄準：B9 的 CDP 相對滑鼠移動＋`mobStates()` 座標；若太不穩，把「箭命中生物」降為單元＋wiring 證據，瀏覽器只驗發射／落地／睡眠。

## Self-Review 記錄

- **Spec coverage**：§B10 的每一項（弓、箭、燧石、骷髏掉弓、耐久、床、睡眠、重生點、存檔、重生、渲染、音效、文件）都對應到 Task 1–10；Task 11 覆蓋驗收與未驗證。
- **Step scan**：每個 Task 都有「紅測試→跑紅→實作→跑綠→gates→commit」；沒有 TBD／「自行處理」的步驟；main 的接線以 exact 函式名與順序釘死。
- **Type consistency**：`SpawnPoint` 只在 `core/spawn-point.ts` 定義，save／cloud／main／bed 都匯入同一型別；`ArrowTargetKind` 只在 `mobs.ts` 定義；`spawnPlayerArrow` 的 `shot` 參數與 `bowShotFor` 的回傳欄位同名（`speed`／`damage`）；箭的 `fromPos`（射擊者眼睛）→ `arrow-hit` 事件的 `from` → `damagePassiveMob` 的第 3 參數是同一條資料流。
- **External review pass（2026-11-01）**：fresh reviewer 對照現況 repo 逐項核對 API／簽名／計數／測試基數／數值（含用 node 重放箭的子步進）。3 條阻斷性錯誤已折回：① `blocks.test.ts` 的 `requiredTool／fastTool` 窮舉表要補 `[BLOCK.BED, null, null]`；② Task 4 的箭測試向量原本永遠打不中（箭會掉出 AABB 的 y 區間）→ 改成 y=1.5／眼睛高度 1.4，並加了註解；③ Task 8 的 `state === 'playing'` 有**外層與內層兩個**，已指名外層並加子串釘子。另有 8 條風險已釘死：床堆疊 1（原版）、骷髏掉弓的 `killedByPlayer` 閘門、`damagePassiveMob` 要傳攻擊者位置、`show` 的 z-index 25、`acceptCloudData` 對髒值是**整包拒收**、`save.test.ts` 用實際 helper `sourcesOf(world)`、`applyPlayerArrowHit` 的 switch／早退形狀、`the B9 materials have no recipe yet` **不弱化**（只改標題＋補正向斷言）。
- **Review Focus**：五條都在對應 Task 有測試（Task 5 的無箭／創造／最後一發；Task 4 的穿牆／自傷；Task 6＋8 的睡眠出口；Task 7＋8 的重生點；Task 4＋5 的單次擊殺結算）。
- **Proportion**：本計畫以簽名、數值、測試名與接線順序為主，沒有把 `main.ts` 的完整程式碼抄進來；預期實作者在每個 Task 讀現況後補齊區域程式碼。
