# WeCraft B11 TNT 與打火石（0.14.0）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 B9 留下的「火藥暫無用途」接上——新增 TNT 方塊與打火石，讓玩家能放置 TNT、用打火石點燃、4 秒後炸出 power 4 的爆炸（100% 掉落、可連鎖引爆），並順手關掉 B9 唯一沒做的爆炸音效與「爆炸只能來自苦力怕」的單一路徑，發布 0.14.0。

**Architecture:** 純邏輯照既有分工放 `src/core`（`items`／`recipes`／`durability`／名稱表）與 `src/world`（新模組 `tnt.ts`：引信實體、重力落地、連鎖引爆、閃爍相位；`explosion.ts` 加「掉落機率」參數）。`src/main.ts` 仍是未測的組裝根，只做接線：右鍵點燃分支、每幀步進引信實體、`runExplosion` 參數化（威力／死因／掉落機率）與連鎖引爆。渲染另開 `src/render/tnt.ts`（比照 `b9-mobs.ts`：id-keyed 快取、共用幾何、per-entity 材質、`dispose()`），貼圖用 `DataTexture`（jsdom 可測、不碰 canvas 2D）。**存檔格式完全不升版**：TNT 是 block id 35（append-only、`modified` overlay 自然保存）、引信實體與敵對生物同級「不跨存檔」、兩個新物品 id 進既有字串清單。

**Tech Stack:** TypeScript strict、Three.js、Vite、Vitest（jsdom）、IndexedDB、WebAudio 程序合成。

**Spec:** `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`（§B11 為本批範圍；§6 已知簡化同步更新）。本計畫同時把 §5 第 14 點的「火藥用途（TNT）留 B11 評估」結案。

---

## Global Constraints

（出自 spec §1／§2／§4、AGENTS.md 與上游 `main` 規格；每個任務都隱含本節。上游規格已於 2026-11-03 重讀：`game-development.md`、`command-contracts.md`、`game.schema.json`、`game-release.yml`、`playroom-sdk.js`、`sdk-versioning.md`、`save-compatibility.md`。）

- **原版基準**：Minecraft Java Edition 1.20+；本計畫〈已查證與設計決策〉的每個數字都有 minecraft.wiki 出處（2026-11-03 讀）。實作時若發現現況與本計畫的 id／簽名不同，**以現況為準**，並在 commit 訊息說明調整。
- **版本**：本批發布 **0.14.0**；`package.json` 與 `game.json` 同步；`id` 固定 `wecraft`；tag 為 `v0.14.0` 且指向含 bump 的 commit。**未取得當次發布授權前不推 tag、不建 Release、不呼叫發布 API**（AGENTS.md §3）；本計畫只做到「發布候選通過 ZIP 驗證」為止，tag／Release 另列未執行。
- **存檔格式不升版**：本機 payload **v6 不變**、雲端 **format 4 不變**、`game.json` 的 `cloudSave` **一字不動**、`WORLDGEN_VERSION` **維持 2**（TNT 是合成物，不改地形生成）。TNT 方塊靠 append-only 的 block id 35 存進 `modified`；0.13.0 讀到 id 35 時 `getBlockDef(35)` fallback 空氣、不崩（同 id 32 火把的前例）。發布說明要明寫「回退到 0.13.0 時 TNT 顯示為空氣，回到 0.14.0 會回來」。
- **id／tile 只能往後追加**：`BLOCK.TNT = 35`；`T.TNT_TOP = 43`、`T.TNT_SIDE = 44` → `TILE_COUNT = T.TNT_SIDE + 1 = 45`（< `ARRAY_LAYERS = 64`）。既有 id／tile 一個都不准動。
- **每個任務結束**：`npm run typecheck`、`npm test`、`npm run build`、`npm run lint` 全綠；測試要「改得有理」，禁止為綠燈弱化守門。既有測試改動集中在下面清單，其他一律不動：

  | 檔案 | 既有守門 | 改法 | 理由 |
  |---|---|---|---|
  | `src/world/blocks.test.ts` | `requiredTool／fastTool` 窮舉表 | 補 `[BLOCK.TNT, null, null]` | 新 block id 進 registry |
  | `src/world/blocks.test.ts` | 「最後一個 tile 是 `T.BED_SIDE`」＋`TILE_COUNT === getBlockDef(BLOCK.BED).side + 1` | 改成 `T.TNT_SIDE`／`getBlockDef(BLOCK.TNT).side + 1` | 追加 tile 是設計上的成長點 |
  | `src/render/textures.test.ts` | 「每個宣告 tile 都有畫」 | 自動涵蓋；只要 `drawAtlas` 有畫新 tile | — |
  | `src/audio/sounds.test.ts` | 「表長度 == BLOCK 筆數」 | 在測試表與 `GROUP_BY_BLOCK` 補 `[BLOCK.TNT]: 'grass'` | 原版 TNT 的音效材質就是 grass |
  | `src/core/items.test.ts` | `TOTAL_ITEM_COUNT`＝79、`ALL_ITEMS` 鏡像、`BLOCK_ITEMS` | 改成 **81**；鏡像補 `tnt`／`flint_and_steel`；`BLOCK_ITEMS` 補 `tnt` | 物品表成長 |
  | `src/core/recipes.test.ts` | `RECIPES.length`＝37＋id 清單 | 改成 **39**；補 `tnt`／`flint_and_steel` | 兩個新配方 |
  | `src/core/durability.test.ts` | 耐久表 | 新增 `flint_and_steel: 64` 的斷言 | 打火石在 JE 是耐久 64 |
  | `src/ui/icons.test.ts` | 「非方塊物品都有專屬圖示」 | 自動涵蓋；`icons.ts` 補 `case 'flint_and_steel'` | `tnt` 有方塊形式 → 走 atlas crop |
  | `src/ui/death.test.ts` | 各死因文案 | 新增 `tnt` 案例 | 新死因 |
  | `src/main.wiring.test.ts` | `damageHeldTool(1)` 呼叫點＝6 | 改成 **7**（點燃成功扣 1）＋測試標題同步 | 新增合法呼叫點 |
  | `src/main.wiring.test.ts` | 第一個 `runExplosion(` 之前的苦力怕過濾順序 | **不動**：TNT 事件迴圈放在苦力怕事件迴圈**之後** | 守門不弱化，只靠擺放順序 |
  | `src/main.wiring.test.ts` | `audio.play(`＝6、`killedByPlayer: false`＝5 | **不動**：新音效走專屬 facade 方法；連鎖引爆不新增 `killedByPlayer` 字面 | 守門不弱化 |
  | `src/core/cloud-save.test.ts` 等 fixture | 物品清單 | **不動**（新 id 是字串、附加欄位不需改；`spawnPoint` 等 fixture 已有） | — |

- **上游平台紀律**：本批**不碰** Esc／iframe／pointer lock／全螢幕／瀏覽器保留鍵 → 不強制 Playwright；批末仍以真實瀏覽器探針（headful Chromium＋xvfb＋靜態 `dist/`，探針放 `/tmp/opencode/`）驗爆炸與點燃，拿不到瀏覽器就明列未驗證。
- 音效／粒子／閃爍是加分項，但本計畫把它們排進任務；若某項排程不可行，必須在 README 與發布說明**明說未做**，不得靜默跳過。
- 註解誠實化：新模組檔頭寫清「哪些是原版、哪些是簡化」；README〈與原版的差異〉新增 0.14.0 段落並刪掉過時的「火藥暫無用途」。
- 發布候選跑固定工具：**讀 `.playroom/game-tools.lock.json` 決定版本**（不要假設），先驗 `.playroom/tools/` 內 ZIP 的 sha256 與 lock 一致，再跑 `pack-game.mjs` ＋ `validate-game.mjs`（本機無 `unzip`，用 `python3 -m zipfile`）。
- 分支：本計畫在 `b11-tnt` worktree 執行（`.worktrees/b11-tnt`，從 master `cf4d5c6` 起）。

## Review Focus

（spec 沒明說、但最可能咬人的輸入類別或失敗模式；每一條都有對應任務的測試。）

1. **連鎖引爆的終止性與效能**：一片 TNT 互相引爆時，每一顆都會再掃 13³＝2197 格；沒有上限就可能在同一幀堆出幾十次爆炸。→ Task 4（`MAX_PRIMED_TNT` 上限＋超出者走正常掉落）＋ Task 7（事件迴圈先移除再爆、單幀順序）。
2. **「100% 掉落」與「被誘爆的 TNT 不掉落」不能互相汙染**：`explodeAt` 以 `dropChance: 1` 先算出所有掉落（含被誘爆的 TNT 格），main 必須先記下成功誘爆的格位、再把這些格位的掉落濾掉，否則連鎖會憑空生出 TNT 道具。→ Task 3（dropChance 純邏輯）＋ Task 7（primed key 過濾）。
3. **點燃的邊界**：創造模式不扣耐久；手持打火石對著空氣／其他方塊右鍵不能有任何效果；手持弓／食物時的優先序不能被新分支打亂；已點燃的 TNT 方塊已被換成 AIR → 再點同一格必須是 no-op（不能重複扣耐久）。→ Task 7（`tryIgniteTnt` 先驗 `world.getBlock` 再動手）＋ Task 2（durability 的創造守門）。
4. **玩家死因不被互相覆寫**：同一幀先摔死再被 TNT 波及時，不能把死因改寫；反向亦然（既有 `!isPlayerDead(vitals)` 護欄不動，只把 `deathCause` 參數化）。→ Task 7（`source` 參數＋既有護欄）。
5. **渲染與場次邊界**：TNT 爆炸後 mesh 要消失、材質要釋放；回到標題／讀檔要清空 `primedTnts`（否則上一場的引信實體在新世界憑空爆炸）。→ Task 6（renderer 測試「移除後群組消失、dispose 冪等」）＋ Task 7（`resetSessionEntities`）。

---

## 檔案結構

| 檔案 | 動作 | 職責 |
|---|---|---|
| `src/world/blocks.ts` | 修改 | `BLOCK.TNT = 35`、`T.TNT_TOP`／`T.TNT_SIDE`、`TILE_COUNT`、`DEFS[35]`、`PLACEABLE` |
| `src/render/textures.ts` | 修改 | TNT 兩張 16×16 tile；`tilePixels`／`brightenTile` 純像素工具 |
| `src/audio/sounds.ts` | 修改 | `GROUP_BY_BLOCK[BLOCK.TNT] = 'grass'` |
| `src/core/items.ts` | 修改 | `'tnt'`／`'flint_and_steel'` id、`BLOCK_PAIRS`、`STACK_ONE`（打火石）、`stackName` 顯示名覆寫（`TNT`／`Flint and Steel`） |
| `src/core/durability.ts` | 修改 | `flint_and_steel: 64` |
| `src/core/recipes.ts` | 修改 | 打火石（shapeless）＋ TNT（3×3 棋盤） |
| `src/ui/icons.ts` | 修改 | 打火石的像素圖 |
| `src/world/explosion.ts` | 修改 | `ExplosionCtx.dropChance`（TNT 100%、苦力怕不變） |
| `src/world/tnt.ts` | 新增 | 引信實體純邏輯：`createPrimedTnt`／`stepPrimedTnts`／`primeTntChain`／`tntBlinkBright`＋常數 |
| `src/audio/voices.ts` | 修改 | `tntFuse`／`explosionBoom` 兩個程序合成音 |
| `src/audio/index.ts` | 修改 | `playTntFuse`／`playExplosion` facade |
| `src/render/tnt.ts` | 新增 | 引信 TNT 的方塊渲染＋0.5 秒閃爍 |
| `src/ui/death.ts` | 修改 | `DamageSource 'tnt'`＋文案 |
| `src/main.ts` | 修改 | 右鍵點燃、引信步進、`runExplosion` 參數化、連鎖引爆、音效、debug hook、場次清理 |
| `src/main.wiring.test.ts` | 修改 | 接線釘子（點燃分支、事件迴圈順序、參數化） |
| `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md` | 修改 | §B11 段落＋§5-14 結案 |
| `README.md`、`game.json`、`package.json` | 修改 | 0.14.0、操作說明、與原版的差異 |
| `docs/releases/v0.14.0.md` | 新增 | 發布說明（Task 9 以實測數字寫） |

## 已查證與設計決策

### 1. TNT 方塊（minecraft.wiki/TNT，2026-11-03 讀）

- 硬度 **0**、爆炸抗性 **0**、**任何工具**都能瞬間破壞、掉自身、可堆疊 **64**、音效材質 **grass**。
- 合成：**5 火藥 ＋ 4 沙**，3×3 棋盤（火藥在角與中心、沙在邊）：
  ```
  [火藥][ 沙 ][火藥]
  [ 沙 ][火藥][ 沙 ]
  [火藥][ 沙 ][火藥]
  ```
  原版可用紅沙混用；本作只有一般沙。
- **設計決策**：方塊 id **35**（append-only）、`requiredTool: null`、`fastTool: null`、`solid: true`、`transparent: false`、`shape: 'cube'`。硬度 0 → 走既有 `getBreakTime` 的 0 秒即時破壞（同花／草），掉落走 `dropItemFor` fallback = 自身。

### 2. 打火石（minecraft.wiki/Flint_and_Steel，2026-11-03 讀）

- 耐久 **64**（JE）、**不可堆疊**；合成：**鐵錠 ＋ 燧石**（shapeless，2×2 背包也能合）。
- 對 TNT 使用 → 點燃；**原版對任何使用都會扣耐久**、也能放火／點苦力怕／點地獄門——本作**沒有火系統**，只支援 TNT。
- **設計決策**：只對「TNT 方塊」成功時扣 1 耐久（其他情境完全不扣）；創造模式不扣（既有 `damageHeldTool` 守門）。不支援：對生物點火、放火、紅石、發射器、火焰箭、潛行時改成放火。

### 3. 引信 TNT（minecraft.wiki/TNT，2026-11-03 讀）

- 啟動後方塊被換成 **primed TNT 實體**：碰撞盒 **0.98×0.98**、受重力、引信 **80 tick ＝ 4 秒**；給初始速度 **+0.2 格/tick 向上**（＝4 格/秒）與 **0.02 格/tick 隨機水平**（＝0.4 格/秒）。
- 爆炸 **power 4**、中心在實體位置上方 **0.06125 格**；**被 TNT 炸掉的方塊 100% 掉落**（原文：always drop their usual items as if mined by a player）。
- 被其他爆炸波及的 TNT：**隨機 10–30 tick（0.5–1.5 秒）**後引爆。
- 外觀：貼圖每 **0.5 秒**在正常與「亮到接近白」的版本之間切換。
- 音效：點燃 `entity.tnt.primed`（嘶聲，volume 1.0）、爆炸 `entity.generic.explode`（volume 4.0、pitch 0.56–0.84）。
- **設計決策**：
  - 引信實體沿用本作生物物理尺度：重力 **32**（本作 `MOB_GRAVITY`；原版約 16）→ 已揭露的簡化。
  - 水平初速只在起爆瞬間給一次、落地後歸零（不做原版的逐 tick 空氣阻力）。
  - 爆炸中心＝`pos.y + 0.06125`（對齊原版）。
  - 連鎖引爆上限 **32 顆**（本作自訂，防單幀爆炸風暴）；超出上限的 TNT 格**不誘爆**，照 TNT 的 100% 掉落規則掉成道具——已揭露。
  - 爆炸波及「已經在引信中的實體」不加速、不引爆（只影響方塊）；原版會推擠——簡化。
  - 引信實體**不跨存檔**（與敵對生物同級）；「儲存並離開」時未爆的 TNT 消失——已揭露。

### 4. 閃爍與渲染

- 純邏輯提供 `tntBlinkBright(t)`：`floor((fuseTotal − fuse) / 0.5) % 2 === 1`（每 0.5 秒切換、起爆瞬間為暗）。
- 渲染用 `THREE.DataTexture`（16×16 RGBA、`NearestFilter`、`flipY = true`）：正常版＝atlas tile 原像素、亮版＝`v + (255−v) × 0.8`（接近白）。**不用 canvas 2D**（jsdom 沒有實作，測試會拿到 `null` context）。
- 幾何：共用 `BoxGeometry(1,1,1)`，縮放 0.98；六面材質順序 `[側,側,頂,頂,側,側]`（底面沿用頂面貼圖——簡化）。

### 5. 爆炸音效（順手關掉 B9 缺口）

- `runExplosion` 內統一播 `playExplosion`：苦力怕爆炸過去**完全無聲**（B9 已知缺口），本批同時補上（原版兩者都是 `entity.generic.explode`）。
- 點燃時播 `playTntFuse`（對應 `entity.tnt.primed`）。

### 6. 存檔與相容性

- 本機 payload **v6 不變**：TNT 是 `modified` overlay 裡的數字 id 35。
- 雲端 **format 4 不變**：雲端 payload 不含 voxel；新物品是字串 id，未知 id 由 `sanitizeStack` 過濾。
- 死亡不掉落、爆炸不掉落規則沿用：爆炸連鎖誘爆的 TNT **不掉道具**；其餘方塊 100% 掉落（生存）；創造模式仍不掉（既有 `spill` 守門）。

---

## Task 1：TNT 方塊、貼圖與音效材質

**Files:**
- Modify: `src/world/blocks.ts`、`src/render/textures.ts`、`src/audio/sounds.ts`
- Test: `src/world/blocks.test.ts`、`src/audio/sounds.test.ts`

**Interfaces:**
- Produces: `BLOCK.TNT = 35`、`T.TNT_TOP`／`T.TNT_SIDE`、`TILE_COUNT = 45`、`getBlockDef(BLOCK.TNT).side === T.TNT_SIDE`、`materialGroup(BLOCK.TNT) === 'grass'`

- [ ] **Step 1: 先加失敗的守門測試**

在 `src/world/blocks.test.ts` 的 requiredTool/fastTool 窮舉表補列 `[BLOCK.TNT, null, null]`；把「最後一個 tile」測試改指 `T.TNT_SIDE`（並保留 `T.CHEST === T.BED_TOP - 1` 的舊斷言）；把「B5 tiles 追加」測試改指 `getBlockDef(BLOCK.TNT).side + 1`。新增：

```ts
it('the tnt table matches vanilla', () => {
  const def = getBlockDef(BLOCK.TNT);
  expect(def.hardness).toBe(0);
  expect(def.blastResistance).toBe(0);
  expect(def.requiredTool).toBeNull();
  expect(def.fastTool).toBeNull();
  expect(def.solid).toBe(true);
});
```

在 `src/audio/sounds.test.ts` 的表補 `[BLOCK.TNT]: 'grass'`。

- [ ] **Step 2: 跑測試確認紅**

Run: `npx vitest run src/world/blocks.test.ts src/audio/sounds.test.ts`
Expected: FAIL（`BLOCK.TNT` undefined／表長度不符）

- [ ] **Step 3: 實作**

`blocks.ts`：`BLOCK` 尾端加 `TNT: 35`（註解寫「B11：只能往後追加」）；`T` 尾端加 `TNT_TOP: 43, TNT_SIDE: 44`；`TILE_COUNT = T.TNT_SIDE + 1`；`DEFS[35]`：

```ts
35: { id: 35, name: 'tnt', hardness: 0, blastResistance: 0, solid: true, transparent: false, shape: 'cube', top: T.TNT_TOP, side: T.TNT_SIDE, bottom: T.TNT_TOP, requiredTool: null, fastTool: null },
```

`PLACEABLE` 尾端加 `BLOCK.TNT`。

`textures.ts` 的 `drawAtlas()` 尾端（`cachedAtlas = ...` 之前）用 `put` 畫兩張 tile：`T.TNT_SIDE`＝紅底＋中央白色橫帶（y 4..11）＋深紅「TNT」字樣像素；`T.TNT_TOP`＝紅底＋內縮白框＋中心深色引信孔。位置用固定資料、不用亂數；所有像素 alpha 255。

`audio/sounds.ts` 的 `GROUP_BY_BLOCK` 補 `[BLOCK.TNT]: 'grass'`（原版 TNT 的音效材質就是 grass）。

- [ ] **Step 4: 跑測試確認綠**

Run: `npx vitest run src/world/blocks.test.ts src/audio/sounds.test.ts src/render/textures.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/world/blocks.ts src/render/textures.ts src/audio/sounds.ts src/world/blocks.test.ts src/audio/sounds.test.ts
git commit -m "feat(blocks): B11 TNT 方塊（id 35）、貼圖與音效材質"
```

---

## Task 2：TNT／打火石物品、配方、顯示名與耐久

**Files:**
- Modify: `src/core/items.ts`、`src/core/durability.ts`、`src/core/recipes.ts`、`src/ui/icons.ts`
- Test: `src/core/items.test.ts`、`src/core/durability.test.ts`、`src/core/recipes.test.ts`、`src/ui/icons.test.ts`

**Interfaces:**
- Consumes: `BLOCK.TNT`（Task 1）
- Produces: `ItemId` 含 `'tnt'`／`'flint_and_steel'`；`blockFromItem('tnt') === BLOCK.TNT`；`maxDurability('flint_and_steel') === 64`；`maxStack('flint_and_steel') === 1`；`stackName('tnt') === 'TNT'`；配方 id `'flint_and_steel'`／`'tnt'`

- [ ] **Step 1: 先寫失敗測試**

`items.test.ts`：`TOTAL_ITEM_COUNT` 79 → **81**；`ALL_ITEMS` 鏡像補 `'tnt'`／`'flint_and_steel'`；`BLOCK_ITEMS` 補 `'tnt'`。新增：

```ts
it('flint and steel is a stack-one durable item (64 uses)', () => {
  expect(maxDurability('flint_and_steel')).toBe(64);
  expect(maxStack('flint_and_steel')).toBe(1);
});
it('tnt stacks to 64 and keeps the vanilla display name', () => {
  expect(maxStack('tnt')).toBe(64);
  expect(stackName('tnt')).toBe('TNT');
  expect(stackName('flint_and_steel')).toBe('Flint and Steel');
});
```

`durability.test.ts` 補 `flint_and_steel` 的 64 斷言。`recipes.test.ts`：長度 37 → **39**、id 清單補兩個；新增「TNT 棋盤配方」與「打火石 shapeless」的比對斷言（用 `findRecipe` 對 3×3／2×2 grid 各驗一次成功與材料錯誤時失敗）。`icons.test.ts` 不動（動態守門會逼 `icons.ts` 補 case）。

- [ ] **Step 2: 跑測試確認紅**

Run: `npx vitest run src/core/items.test.ts src/core/durability.test.ts src/core/recipes.test.ts src/ui/icons.test.ts`
Expected: FAIL（未知 id／數量不符）

- [ ] **Step 3: 實作**

`items.ts`：union 尾端加 `| 'tnt' | 'flint_and_steel'`；`ITEM_IDS` 補 `tnt: true, flint_and_steel: true`；`BLOCK_PAIRS` 補 `['tnt', BLOCK.TNT]`；`STACK_ONE` 補 `'flint_and_steel'`。顯示名覆寫：

```ts
/** 顯示名覆寫（多數 id 由 title-case 推導；這裡修掉原版不照規則的兩個）。
 *  只影響 UI 文字，不影響存檔（存的是 id）。 */
const DISPLAY_NAMES: Readonly<Partial<Record<ItemId, string>>> = {
  tnt: 'TNT',
  flint_and_steel: 'Flint and Steel',
};
export function stackName(item: ItemId): string {
  const override = DISPLAY_NAMES[item];
  if (override) return override;
  return item.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
```

`durability.ts`：`TOOL_MAX_DURABILITY` 補 `flint_and_steel: 64`。

`recipes.ts` 尾端加兩個配方（`gunpowder` 與 `sand` 直接寫字面值，或沿用檔案既有常數風格）：

```ts
{ id: 'flint_and_steel', kind: 'shapeless', inputs: ['iron_ingot', 'flint'], result: { item: 'flint_and_steel', count: 1 } },
{ id: 'tnt', kind: 'shaped', pattern: [
  [GUN, SAN, GUN],
  [SAN, GUN, SAN],
  [GUN, SAN, GUN],
], result: { item: 'tnt', count: 1 } },
```

`icons.ts` 的 `drawItemArt` 補 `case 'flint_and_steel':`（灰色燧石碎塊＋亮鐵片＋兩點火花；沿用既有像素風格）。

- [ ] **Step 4: 跑測試確認綠**

Run: `npx vitest run src/core/items.test.ts src/core/durability.test.ts src/core/recipes.test.ts src/ui/icons.test.ts src/ui/ui.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/items.ts src/core/durability.ts src/core/recipes.ts src/ui/icons.ts src/core/items.test.ts src/core/durability.test.ts src/core/recipes.test.ts
git commit -m "feat(items): B11 TNT 與打火石（配方、顯示名、耐久 64）"
```

---

## Task 3：爆炸掉落機率參數（TNT 100%）

**Files:**
- Modify: `src/world/explosion.ts`
- Test: `src/world/explosion.test.ts`

**Interfaces:**
- Produces: `ExplosionCtx.dropChance?: number`（省略 → `1/power`；TNT 傳 `1`）

- [ ] **Step 1: 先寫失敗測試**

```ts
it('an explicit drop chance overrides the 1/power default', () => {
  const ctx = {
    power: 4,
    center: { x: 0.5, y: 0.5, z: 0.5 },
    blockIdAt: (x: number, y: number, z: number) => (y === 0 ? BLOCK.COBBLE : BLOCK.AIR),
    isSolidAt: () => true,
    rng: () => 0.999,
    dropChance: 1,
  };
  const result = explodeAt(ctx);
  expect(result.destroyed.length).toBeGreaterThan(0);
  expect(result.drops.length).toBe(result.destroyed.length);
});
it('a non-finite drop chance falls back to 1/power', () => {
  // rng 0.99 對 power 4（預設 1/4）應全部 miss
  const result = explodeAt({ ...baseCtx, dropChance: Number.NaN });
  expect(result.drops).toEqual([]);
});
```

- [ ] **Step 2: 跑測試確認紅**

Run: `npx vitest run src/world/explosion.test.ts`
Expected: FAIL（`dropChance` 未知欄位 → 掉落數不符）

- [ ] **Step 3: 實作**

`ExplosionCtx` 加 `dropChance?: number`；`explodeAt` 掉落圈：

```ts
const chance = Number.isFinite(ctx.dropChance) ? Math.min(1, Math.max(0, ctx.dropChance!)) : 1 / power;
...
if (rng() >= chance) continue;
```

檔頭註解把「原版 TNT 才是 100%，本作沒有 TNT」改成「TNT 傳 1（原版 100%）；苦力怕等生物爆炸維持 1/power」。

- [ ] **Step 4: 跑測試確認綠**

Run: `npx vitest run src/world/explosion.test.ts`
Expected: PASS（既有 11 條不動）

- [ ] **Step 5: Commit**

```bash
git add src/world/explosion.ts src/world/explosion.test.ts
git commit -m "feat(explosion): B11 掉落機率參數（TNT 100%、生物爆炸不變）"
```

---

## Task 4：引信 TNT 純邏輯（`src/world/tnt.ts`）

**Files:**
- Create: `src/world/tnt.ts`
- Test: `src/world/tnt.test.ts`

**Interfaces:**
- Produces:
  - `TNT_WIDTH = 0.98`、`TNT_HEIGHT = 0.98`、`TNT_FUSE_SEC = 4`、`TNT_CHAIN_FUSE_MIN_SEC = 0.5`、`TNT_CHAIN_FUSE_MAX_SEC = 1.5`、`TNT_EXPLOSION_POWER = 4`、`TNT_LAUNCH_UP = 4`、`TNT_LAUNCH_SIDE = 0.4`、`TNT_GRAVITY = 32`、`TNT_BLINK_SEC = 0.5`、`MAX_PRIMED_TNT = 32`
  - `createPrimedTnt(pos, opts?: { fuse?: number; rng?: () => number }): PrimedTnt`
  - `primeTntChain(list, positions, opts?: { rng?: () => number; cap?: number }): { tnts: PrimedTnt[]; primedCount: number }`
  - `stepPrimedTnts(list, ctx: { isSolidAt; dt }): { tnts: PrimedTnt[]; events: TntEvent[] }`（爆炸的實體**直接從回傳清單移除**，事件恰一次）
  - `tntBlinkBright(t: PrimedTnt): boolean`

- [ ] **Step 1: 先寫失敗測試**（`src/world/tnt.test.ts`，比照 `creeper.test.ts` 的風格）

```ts
it('the tnt constants match vanilla', () => {
  expect(TNT_FUSE_SEC).toBe(4);
  expect(TNT_EXPLOSION_POWER).toBe(4);
  expect(TNT_WIDTH).toBe(0.98);
  expect(TNT_HEIGHT).toBe(0.98);
});
it('the fuse expires after four seconds and emits exactly one explosion', () => {
  let t = createPrimedTnt({ x: 0, y: 6, z: 0 }, { rng: () => 0 }); // rng 0 → 水平初速固定、不影響引信
  let events = 0;
  for (let i = 0; i < 81; i++) {
    const step = stepPrimedTnts([t], { isSolidAt: (x, y, z) => y < 6, dt: 0.05 });
    t = step.tnts[0]!;
    events += step.events.length;
    if (step.tnts.length === 0) break;
  }
  expect(events).toBe(1);
});
it('an exploding tnt is removed from the list (no second event)', () => {
  const t = createPrimedTnt({ x: 0, y: 6, z: 0 }, { fuse: 0.05, rng: () => 0 });
  const first = stepPrimedTnts([t], { isSolidAt: () => false, dt: 0.05 });
  expect(first.events).toHaveLength(1);
  expect(first.tnts).toHaveLength(0);
  const second = stepPrimedTnts(first.tnts, { isSolidAt: () => false, dt: 0.05 });
  expect(second.events).toHaveLength(0);
});
it('a freshly primed tnt blinks dark and alternates every 0.5 s', () => {
  const t = createPrimedTnt({ x: 0, y: 6, z: 0 }, { fuse: 4, rng: () => 0 });
  expect(tntBlinkBright(t)).toBe(false);
  expect(tntBlinkBright({ ...t, fuse: 3.5 })).toBe(true);
  expect(tntBlinkBright({ ...t, fuse: 3.0 })).toBe(false);
});
it('chain priming rolls a 0.5–1.5 s fuse and stops at the cap', () => {
  const rngValues = [0, 1];
  const { tnts, primedCount } = primeTntChain([], [
    { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 },
  ], { rng: () => rngValues.shift() ?? 0, cap: 2 });
  expect(primedCount).toBe(2);
  expect(tnts).toHaveLength(2);
  expect(tnts[0]!.fuse).toBe(0.5);
  expect(tnts[1]!.fuse).toBe(1.5);
});
it('primed tnt falls and lands on solid ground', () => {
  let t = createPrimedTnt({ x: 0, y: 8, z: 0 }, { rng: () => 0 });
  for (let i = 0; i < 40; i++) t = stepPrimedTnts([t], { isSolidAt: (x, y, z) => y <= 0, dt: 0.05 }).tnts[0]!;
  expect(t.pos.y).toBeGreaterThanOrEqual(1);
  expect(t.pos.y).toBeLessThan(1.2);
  expect(t.vel.y).toBe(0);
});
```

- [ ] **Step 2: 跑測試確認紅**

Run: `npx vitest run src/world/tnt.test.ts`
Expected: FAIL（模組不存在）

- [ ] **Step 3: 實作**

模組檔頭寫明原版值與簡化（重力 32、水平初速落地歸零、不存檔）。實作要點：
- `createPrimedTnt`：`vel = { x: sin(a)·TNT_LAUNCH_SIDE, y: TNT_LAUNCH_UP, z: cos(a)·TNT_LAUNCH_SIDE }`，`a = rng()·2π`；`fuse` 預設 4、`fuseTotal = fuse`。
- `stepPrimedTnts`：NaN dt → 0；每顆先 `fuse = max(0, fuse − dt)`；`fuse <= 0` → 事件 `{ type: 'explode', tntId, at: { x, y: pos.y + 0.06125, z } }`、**不進回傳清單**；否則重力 `TNT_GRAVITY`、逐軸 `isSolidAt` 碰撞（比照 `creeper.ts` 的落地掃描：不穿地板、撞牆停該軸）；落地（垂直被擋且 `vel.y <= 0`）後水平速度歸零。
- `primeTntChain`：對每個 position 依序建立 chain 引信（`fuse = MIN + rng()·(MAX−MIN)`）；達到 `cap ?? MAX_PRIMED_TNT` 即停，回傳 `primedCount`。
- `tntBlinkBright`：`Math.floor((t.fuseTotal − t.fuse) / TNT_BLINK_SEC) % 2 === 1`（`fuseTotal <= 0` → false）。

- [ ] **Step 4: 跑測試確認綠**

Run: `npx vitest run src/world/tnt.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/world/tnt.ts src/world/tnt.test.ts
git commit -m "feat(tnt): B11 引信實體純邏輯（4 秒、power 4、連鎖引爆）"
```

---

## Task 5：TNT 音效（嘶聲與爆炸）

**Files:**
- Modify: `src/audio/voices.ts`、`src/audio/index.ts`
- Test: `src/audio/index.test.ts`（必要時同步 `src/audio/testing.ts` 的使用方式）

**Interfaces:**
- Produces: `tntFuse(ctx, dest, noise, volume)`、`explosionBoom(ctx, dest, noise, volume)`；facade `playTntFuse(opts?)`、`playExplosion(opts?)`

- [ ] **Step 1: 先寫失敗測試**（比照既有 `playCreeperHiss` 的三條測試風格）

```ts
it('playTntFuse synthesises one band-passed fizz through the master bus', () => { /* 節點數／濾波器型別斷言 */ });
it('playExplosion synthesises a low-passed boom', () => { /* 低通＋低頻正弦節點斷言 */ });
it('before start: playTntFuse and playExplosion stay inert (no nodes)', () => { /* ensureStarted 前零節點 */ });
```

- [ ] **Step 2: 跑測試確認紅**

Run: `npx vitest run src/audio/index.test.ts`
Expected: FAIL（`playTntFuse is not a function`）

- [ ] **Step 3: 實作**

`voices.ts`：`tntFuse`＝0.6 秒帶通噪音（freq ≈ 1100 Hz、Q 1.0、gain 0.9，對應 `entity.tnt.primed` 嘶聲）；`explosionBoom`＝低通噪音 0.6 秒（freq ≈ 220 Hz、gain 1.0）＋ 70→30 Hz 下滑正弦（gain 0.8）。兩者都比照 `creeperHiss` 的包絡慣例。`index.ts`：新增 `playTntFuse`／`playExplosion`，距離衰減走同一條 `gainForDistance`、引擎未啟動 no-op、不加進 `play()` 的紀錄環（與 `playCreeperHiss` 同級）。

- [ ] **Step 4: 跑測試確認綠**

Run: `npx vitest run src/audio/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/audio/voices.ts src/audio/index.ts src/audio/index.test.ts
git commit -m "feat(audio): B11 TNT 嘶聲與爆炸音效（順補苦力怕爆炸聲）"
```

---

## Task 6：引信 TNT 渲染與貼圖亮版工具

**Files:**
- Modify: `src/render/textures.ts`（`tilePixels`／`brightenTile` 純函式）
- Create: `src/render/tnt.ts`
- Test: `src/render/tnt.test.ts`、`src/render/textures.test.ts`（新增純函式斷言）

**Interfaces:**
- Consumes: `PrimedTnt`／`tntBlinkBright`（Task 4）、`drawAtlas()`／`T.*`（Task 1）
- Produces: `tilePixels(atlas, tile): Uint8ClampedArray`、`brightenTile(atlas, tile, mix?): Uint8ClampedArray`、`createTntRenderer(scene, deps?): TntRenderer`（`syncTnts(list, dt)`／`dispose()`）

- [ ] **Step 1: 先寫失敗測試**

`textures.test.ts`：

```ts
it('brightenTile lifts pixels toward white and preserves alpha and size', () => {
  const atlas = drawAtlas();
  const normal = tilePixels(atlas, T.TNT_SIDE);
  const bright = brightenTile(atlas, T.TNT_SIDE);
  expect(bright).toHaveLength(16 * 16 * 4);
  for (let i = 0; i < normal.length; i += 4) {
    expect(bright[i]!).toBeGreaterThanOrEqual(normal[i]!);
    expect(bright[i + 3]).toBe(normal[i + 3]);
  }
  expect(Math.max(...bright)).toBeGreaterThan(200);
});
```

`render/tnt.test.ts`（jsdom；`createTntRenderer` 用注入的假材質，避免真材質在 jsdom 內要 GPU）：

```ts
it('syncs one group per primed tnt and removes it after the explosion', () => {
  const scene = new THREE.Scene();
  const renderer = createTntRenderer(scene, { staticMaterials: fakeMaterials() });
  const t = createPrimedTnt({ x: 0, y: 5, z: 0 }, { rng: () => 0 });
  renderer.syncTnts([t], 0.1);
  expect(scene.children).toHaveLength(1);
  renderer.syncTnts([], 0.1);
  expect(scene.children).toHaveLength(0);
});
it('switches the material set when the blink phase flips', () => {
  // fuse 3.5（亮）→ fuse 3.0（暗）：斷言 mesh.material 參考在兩組假材質間切換
});
it('dispose is idempotent and clears every group', () => { /* 兩次 dispose 不拋錯 */ });
```

- [ ] **Step 2: 跑測試確認紅**

Run: `npx vitest run src/render/textures.test.ts src/render/tnt.test.ts`
Expected: FAIL（函式不存在）

- [ ] **Step 3: 實作**

`textures.ts` 加兩個純函式（只搬像素，不碰 DOM）；`render/tnt.ts` 比照 `b9-mobs.ts` 結構：id-keyed `Map`、共用 `BoxGeometry(1,1,1)`、每顆一個 `Group`、`mesh.scale.set(0.98, 0.98, 0.98)`、位置 `pos + 0.49`；`deps.staticMaterials` 未注入時用 `DataTexture` 建四張材質（正常／亮 × 頂／側），材質順序 `[側,側,頂,頂,側,側]`；每幀依 `tntBlinkBright` 指定 `mesh.material`；`dispose()` 移除全部 group 並釋放自建材質（注入的不釋放）。

- [ ] **Step 4: 跑測試確認綠**

Run: `npx vitest run src/render/tnt.test.ts src/render/textures.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/render/textures.ts src/render/tnt.ts src/render/tnt.test.ts src/render/textures.test.ts
git commit -m "feat(render): B11 引信 TNT 方塊渲染與 0.5 秒閃爍"
```

---

## Task 7：主迴圈接線（點燃、步進、參數化爆炸、死因、清理）

**Files:**
- Modify: `src/main.ts`、`src/ui/death.ts`
- Test: `src/main.wiring.test.ts`、`src/ui/death.test.ts`

**Interfaces:**
- Consumes: Task 1–6 全部
- Produces: `heldIsFlintAndSteel()`、`tryIgniteTnt(x, y, z)`、`runExplosion(at, opts: { source: 'creeper' | 'tnt'; power?: number; dropChance?: number })`、`tntStates()` debug hook

- [ ] **Step 1: 先寫失敗測試**

`death.test.ts` 補：

```ts
it('renders the tnt death line', () => {
  expect(deathMessageFor('tnt')).toBe('你被 TNT 炸死了');
});
```

`main.wiring.test.ts` 補／改：
- `damageHeldTool(1)` 6 → 7，標題改成「all seven …（dig / zombie-skeleton / creeper / spider / passive / bow / flint-and-steel）」。
- 新增：playing 分支裡 `hitBlock === BLOCK.TNT` 出現在 `heldIsBow()` **之前**、且該分支包含 `heldIsFlintAndSteel()`。
- 新增：`tryIgniteTnt` 函式體先驗 `world.getBlock(` 等於 `BLOCK.TNT`、成功路徑含 `world.setBlock(`、`primeTntChain(`、`audio.playTntFuse(`、`damageHeldTool(1)`；順序為「先建立引信實體、後扣耐久」（最後一發釘子）。
- 新增：`runExplosion` 呼叫點有 2 個，苦力怕傳 `source: 'creeper'`、TNT 傳 `source: 'tnt'` 與 `power: TNT_EXPLOSION_POWER`、`dropChance: 1`；**第一個 `runExplosion(` 之前仍有苦力怕過濾字串**（舊守門照綠）。
- 新增：`resetSessionEntities` 函式體含 `primedTnts = [];`。

- [ ] **Step 2: 跑測試確認紅**

Run: `npx vitest run src/main.wiring.test.ts src/ui/death.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作**

`death.ts`：`DamageSource` 加 `'tnt'`、`deathMessageFor` 加 `'你被 TNT 炸死了'`。

`main.ts`：
1. imports：`TNT_EXPLOSION_POWER, MAX_PRIMED_TNT, createPrimedTnt, primeTntChain, stepPrimedTnts, type PrimedTnt`（`world/tnt.ts`）、`createTntRenderer`。
2. 模組狀態：`let primedTnts: PrimedTnt[] = [];`（放在 `creepers` 旁）；`resetSessionEntities()` 清空。
3. 渲染：`const tntRenderer = createTntRenderer(gs.scene);` 與 `tntRenderer.syncTnts(primedTnts, state === 'playing' ? dt : 0)` 放在 `syncCreepers` 旁。
4. `runExplosion` 改成 `options` 參數（見 Interfaces）：`power = opts.power ?? CREEPER_EXPLOSION_POWER`、`dropChance` 直接傳進 `explodeAt`；玩家死因 `opts.source === 'tnt' ? 'tnt' : 'creeper'`；函式開頭 `audio.playExplosion({ pos: at, listener: player.position })`。
5. 連鎖引爆：在破壞方塊迴圈中，`b.blockId === BLOCK.TNT` 時收集 `{ x: b.x + 0.5, y: b.y, z: b.z + 0.5 }` 進 `tntAt` 清單；迴圈結束後 `const prime = primeTntChain(primedTnts, tntAt, { cap: MAX_PRIMED_TNT }); primedTnts = prime.tnts;`；把成功誘爆的前 `prime.primedCount` 格 key 建成 Set，過濾 `result.drops`（避免連鎖憑空掉 TNT 道具）。
6. 右鍵分支：在 `tryUseBed` 之後、`heldIsBow()` 之前插：
   ```ts
   } else if (hit && hitBlock === BLOCK.TNT && heldIsFlintAndSteel()) {
     tryIgniteTnt(hit.x, hit.y, hit.z);
   }
   ```
   `tryIgniteTnt`：`world.getBlock(x, y, z) !== BLOCK.TNT` → return；`world.setBlock(x, y, z, BLOCK.AIR)`＋走破壞路徑同一套的 relight/佇列標記；`primedTnts = [...primedTnts, createPrimedTnt({ x: x + 0.5, y, z: z + 0.5 })]`；`audio.playTntFuse(...)`；**最後**才 `damageHeldTool(1)`。
7. 每幀步進：放在苦力怕事件迴圈**之後**：
   ```ts
   const tntStep = stepPrimedTnts(primedTnts, { isSolidAt, dt });
   primedTnts = tntStep.tnts;
   for (const ev of tntStep.events) {
     runExplosion(ev.at, { source: 'tnt', power: TNT_EXPLOSION_POWER, dropChance: 1 });
   }
   ```
8. Debug hook：`WecraftDebug` 加 `tntStates: () => Array<{ id; x; y; z; fuse }>`，實作映射 `primedTnts`（純唯讀新陣列）；掛在既有 `__wecraft` 物件上。
9. `heldIsBow()`／`heldIsFood()` 不動；點燃成功後 `viewmodel.startSwing()` 可選（不做也行，保持最小）。

- [ ] **Step 4: 跑測試確認綠**

Run: `npx vitest run src/main.wiring.test.ts src/ui/death.test.ts`
Expected: PASS

- [ ] **Step 5: 全綠＋Commit**

Run: `npm run typecheck && npm test && npm run lint`
Expected: 全 PASS

```bash
git add src/main.ts src/ui/death.ts src/main.wiring.test.ts src/ui/death.test.ts
git commit -m "feat(tnt): B11 點燃、引信步進與參數化爆炸接線"
```

---

## Task 8：文件、版本與操作說明（0.14.0）

**Files:**
- Modify: `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`、`README.md`、`game.json`、`package.json`

- [ ] **Step 1: 規格書**

spec §B10 之後新增 **§B11 TNT 與打火石（版本 0.14.0）**：內容＝本計畫〈已查證與設計決策〉的方塊／打火石／引信／連鎖／掉落／音效／存檔段；§5 第 14 點補「已於 B11 結案」；§6 已知簡化把「火藥／線／蜘蛛眼暫無用途」更新（線已於 B10、火藥於 B11 有用途）。

- [ ] **Step 2: README**

- 開頭批次敘述與〈遊戲特色〉加 0.14.0（TNT／打火石／爆炸滿掉落／連鎖引爆／爆炸音效）。
- 嘗試模式全物品數 `76 項` → **81 項**（現況校正）。
- 〈與原版的差異〉新增 **0.14.0（B11 TNT 與打火石）** 段：只支援打火石點燃（無紅石／火／發射器／火焰箭）／重力 32（原版 16）／連鎖上限 32（本作自訂）／爆炸中已引信的實體不受波及／引信實體不存檔／亮版貼圖是本作近似；把 0.12.0 段「火藥暫無用途」改掉（火藥已於 0.14.0 進 TNT 配方）。
- 〈操作〉表加「右鍵（手持打火石）｜點燃 TNT」。

- [ ] **Step 3: 版本**

`package.json` 與 `game.json` 版本改 **0.14.0**（`id`／`cloudSave` 不動）；`game.json` 的 `instructions` 補「手持打火石右鍵 TNT 點燃（4 秒後爆炸）」，總長 < 2000 字元。

- [ ] **Step 4: 驗證文件相關測試＋Commit**

Run: `npm run typecheck && npm test`
Expected: PASS

```bash
git add docs/superpowers/specs/2026-10-18-wecraft-parity-design.md README.md game.json package.json
git commit -m "docs(b11): 0.14.0 規格、README 與操作說明"
```

---

## Task 9：批末驗證（閘門、固定工具、真實瀏覽器）與發布說明

**Files:**
- Create: `docs/releases/v0.14.0.md`
- Test: 全套

- [ ] **Step 1: 全套閘門**

Run: `npm run typecheck && npm test && npm run build && npm run lint`
Expected: 全 PASS（記下測試檔數／條數，供發布說明與 README 使用）

- [ ] **Step 2: pinned 工具 pack ＋ validate**

```sh
node -e "const l=require('./.playroom/game-tools.lock.json');const fs=require('fs');const c=require('crypto');const b=fs.readFileSync('.playroom/tools/playroom-game-tools-'+l.toolsVersion+'.zip');console.log(c.createHash('sha256').update(b).digest('hex')===l.sha256?'lock OK':'LOCK MISMATCH')"
mkdir -p /tmp/opencode/b11-tools && python3 -m zipfile -e .playroom/tools/playroom-game-tools-*.zip /tmp/opencode/b11-tools/
node /tmp/opencode/b11-tools/pack-game.mjs . /tmp/opencode/b11-release/game.zip
node /tmp/opencode/b11-tools/validate-game.mjs /tmp/opencode/b11-release/game.zip
```
Expected: `Packed wecraft v0.14.0` ＋ `Valid: wecraft v0.14.0 (tools <lock 版本>)`

- [ ] **Step 3: 真實瀏覽器驗收（headful Chromium＋xvfb＋靜態 `dist/`；探針放 `/tmp/opencode/wecraft-b11-probe/`）**

存活於平台 checkout 的 `playwright-core`（`xvfb-run`）；探針用 `__wecraft.tntStates()`／`hotbar()`／`modified()`／`vitalsState()` 驗：
1. 創造：從背包拿 TNT 放置 → 手持打火石右鍵 → `tntStates()` 出現、方塊格變 AIR → 4 秒後 `tntStates()` 清空且 `modified()` 明顯增加（爆炸破壞）。
2. 生存（種入存檔或創造切生存）：合成不用驗（單元已釘），驗「點燃扣耐久 64→63」「爆炸 100% 掉落：破壞的石頭變成可撿的鵝卵石」「被炸波及的 TNT 格不掉 TNT 道具」。
3. 自爆自傷：貼近 TNT → hp 下降、死亡畫面顯示「你被 TNT 炸死了」。
4. 效能：單次爆炸的主執行緒耗時（`performance.now()` 前後）< 5 ms（對齊 B9 的驗收尺度）。
無法執行或拿不到瀏覽器時，**明列未驗證**，不推測通過。

- [ ] **Step 4: 發布說明 `docs/releases/v0.14.0.md`**

照 0.13.0 的結構：新增／修正／存檔格式與相容性提示（不升版、回退顯示空氣）／已知問題與簡化／驗證（實測數字與探針結果）；區分「程式完成／ZIP 驗證／Release／平台上架」，Release 與平台上架**明確標示未執行**（未取得當次授權）。

- [ ] **Step 5: Commit＋（授權後才）發布**

```bash
git add docs/releases/v0.14.0.md README.md
git commit -m "docs(release): 0.14.0 驗收證據與發布說明"
```

未經明確授權：**不推 tag、不建 GitHub Release、不呼叫發布 API**。授權後由 controller 依 `finishing-a-development-branch` 流程把 `b11-tnt` 合回 master，再以 `v0.14.0`（指向含 bump 的 commit）發布。

---

## Self-Review（已跑）

1. **Spec coverage**：spec §B11 的所有條目（方塊／打火石／引信／連鎖／100% 掉落／音效／存檔不升版）都有任務；§5-14 的火藥用途在 Task 2；B9 遺留的爆炸音效在 Task 5。無缺口。
2. **Step scan**：每個 step 都是單一可檢查動作（寫測試／跑紅／實作／跑綠／commit）；沒有「TBD」或留白。
3. **Type consistency**：`PrimedTnt`／`primeTntChain`／`stepPrimedTnts`／`tntBlinkBright`／`dropChance`／`runExplosion(at, opts)` 在 Task 3–7 的名稱一致；`T.TNT_TOP`／`T.TNT_SIDE`／`BLOCK.TNT` 在 Task 1、2、6 一致。
4. **Review Focus**：五條風險各自有對應測試（Task 3／4／6／7）。
5. **Proportion**：計畫比 spec 段落長，但主體是決策與介面，不是程式轉錄；實作細節只給簽名、常數與驗收斷言。
