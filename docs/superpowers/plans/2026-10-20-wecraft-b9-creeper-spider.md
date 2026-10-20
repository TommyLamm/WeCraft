# WeCraft B9 苦力怕與蜘蛛（0.12.0）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓世界裡有會嘶嘶引信、會炸掉方塊的苦力怕，以及會在暗處撲人、會攀牆的蜘蛛——把生成規則接上 B4 的敵對框架與 B6 的光照判準，補上火藥／線／蜘蛛眼三個物品，並發布 0.12.0。

**Architecture:** 純邏輯放 `src/world`：`creeper.ts`（苦力怕實體＋引信狀態機）、`spider.ts`（蜘蛛實體＋中立判準＋攀牆狀態機）、`explosion.ts`（爆炸的破壞範圍／掉落／傷害／擊退，全部是純函式）、`b9-spawn.ts`（四種敵對的統一生怪分配器）。渲染獨立成 `src/render/b9-mobs.ts`（比照 B4 的 `render/passive-mobs.ts`）。`src/main.ts` 是未測的組裝根，只做接線。爆炸是唯一會改世界的行為，因此它的「算哪些方塊壞掉／掉什麼／傷多少／推多遠」全部寫成純函式並用單元測試釘死；`main.ts` 只負責把結果套到世界、玩家與生物上。爆炸的方塊破壞需要一個「爆炸抗性」資料欄（`blocks.ts` 的 `BlockDef`），這是本批唯一動到 `blocks.ts` 的地方。

**Tech Stack:** TypeScript strict、Three.js、Vite、Vitest（jsdom 用於 UI／renderer）、IndexedDB、WebAudio 程序合成（引信聲為加分項）。

**Spec:** `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`（§B9 為本批範圍，L274–279；§跨批次、§6 簡化清單、§7 決策記錄一併適用）

**上游相依（本批必須在其後實作）**：B4 的 `src/world/spawn-rules.ts`（`SpawnLight`／`canSpawnHostile`）、`src/world/mobs.ts`（`createMob`／`findSpawnPos`／`surfaceYAt`／`MAX_MOBS`／`hasLineOfSight`）、`src/world/mob-drops.ts`（`rollMobDrops`／`MobDropKind`）、`src/world/passive-mobs.ts`（`damagePassiveMob`）；B5 的物品／方塊 id 表；B6 的 `src/world/lighting.ts`（`spawnLightAt`）與 per-block 光照生怪判準；B7 的 `ItemStack.dur`；B8 的容器塊實體。**若合併後的現況與本計畫引用的 id／簽名／數量不同，以合併後的現況為準**，並在該任務的 commit 訊息說明調整（公約 §9-3）。

---

## Global Constraints

（出自 spec §1／§2／§4、公約 §3／§5／§6 與 AGENTS.md；每個任務的需求都隱含本節。）

- 每個任務結束：`npm run typecheck`、`npm test`、`npm run build`、`npm run lint` 全綠；測試要「改得有理」，禁止為綠燈弱化。既有測試一個不多、一個不少（本批改動到舊測試時，必須在 commit 訊息說明「改得有理」的理由）。
- **本批要改寫的既有測試（集中清單，2026-10-20 終審修正）**（**基數一律讀現況**：「基數」欄＝實作者在對應 Task 的 Step 1 讀到的當前值，並在該 Task 的 commit 訊息註明實際值）：
  | 檔案 | 既有測試 | 改法 | 理由 |
  |---|---|---|---|
  | `src/core/items.test.ts` | `'ALL_ITEM_IDS is the canonical list: <N> entries…'` 的計數＋測試標題數字 | 改成 `<基數 + 3>`（基數＝現況 `ALL_ITEM_IDS.length`；上游 B3–B8 都落地時是 73 → 76） | 物品表成長，非弱化 |
  | `src/core/items.test.ts` | `'ItemId union covers every obtainable block item'` 的 `ALL_ITEMS.length` ＋ 鏡像清單 | 計數改成 `<基數 + 3>`；鏡像補 `gunpowder`／`string`／`spider_eye` | union 鏡像必須等於 `ALL_ITEM_IDS`（**鏡像是「新增 id」而不是「改數字」**——只改數字不補鏡像會讓 `new Set(ALL_ITEM_IDS)` 與 `new Set(ALL_ITEMS)` 不相等） |
  | `src/world/mobs.test.ts` | B4 的 `trySpawnMob`／`chooseSpawnKind` 測試案例 | **搬移**到新檔 `src/world/b9-spawn.test.ts`（同一批斷言、同一批意圖），不是刪除 | 函式被統一分配器取代；搬移不是弱化 |
  | `src/world/mob-drops.test.ts` | 既有殭屍／骷髏／雞／豬／羊／牛的掉落列 | **一字不改**（預設 `killedByPlayer = true` 不影響它們） | 既有行為不得回歸 |
  | `src/core/recipes.test.ts` | — | **只新增** `'the B9 materials have no recipe yet'`（既有案例不動） | 三個材料沒有用途 |
  | `src/world/spawn-rules.test.ts`／`src/world/passive-mobs.test.ts`／`src/world/lighting*.test.ts` | — | **不動**（沿用 B4／B6 的既有測試與判準） | 本批只擴充 `MobDropKind` 與分配器 |
- 版本：本批發布 `0.12.0`；`package.json` 與 `game.json` 同步（`id` 固定 `wecraft`）；tag 為 `v0.12.0` 且指向含 bump 的 commit；不覆寫已發布版本。
- **存檔格式不動**（公約 §3 的 B9 列：本機 payload v6 不變、雲端 format 4 不變 → `game.json` 的 `cloudSave` 不動）。本批**不新增任何存檔欄位**：苦力怕／蜘蛛與既有敵對生物一樣「每場重來」（spec §B4.6／§6）。若合併後的現況版本號不同（B6–B8 未併入時本機是 v3／雲端 format 1），本批一律**不動、不升版**。
- 原版基準：Minecraft Java Edition 1.20+；數值以本計畫〈已查證與設計決策〉節為準（每條附 wiki 出處）。凡與原版不同處（簡化）必須寫進 README〈與原版的差異〉與發布說明〈已知問題〉。
- 平台紀律：本批**不碰** `Esc`／iframe／pointer lock／全螢幕／瀏覽器保留鍵 → 不需要為輸入路由補 Playwright（若實作者順手改了，必須補並把保留鍵情境列為未驗證）。
- 發布候選跑固定工具：`.playroom/tools/playroom-game-tools-1.1.0.zip`（先驗 `sha256` 與 `.playroom/game-tools.lock.json` 一致）＋ `pack-game.mjs` ＋ `validate-game.mjs`（Task 12）。本機無 `unzip`，用 `python3 -m zipfile`。
- 註解誠實化：本批碰到的「Minecraft parity」宣稱要同步校正（`src/world/mobs.ts` 檔頭寫著「no dayburn — distance only」已在 B4 改寫；本批新增的模組檔頭要寫清哪些是原版、哪些是簡化）。
- 分支：本計畫在 `b9-creeper-spider` 分支執行（SDD＋隔離 worktree；本計畫只標註分支名，不建立分支）；tag 與 push 由 controller 在 merge 回 master 後依 finishing-a-development-branch 流程執行（Task 12 Step 7）。

## Review Focus

（spec 沒明說、但最可能咬人的輸入類別或失敗模式；每一條都已在對應任務放測試。）

1. **爆炸不該憑空摧毀玩家的建築**：基岩／水／火把不該被炸掉、石頭只該在爆炸核心附近碎、掉落該有 1/3 機率而不是必掉 → Task 2（爆炸抗性表）＋ Task 3（`explodeAt` 的距離與抗性門檻、掉落抽籤）。
2. **爆炸傷害必須隨距離遞減、且有原版上限**：原版 power 3 在核心是 43 傷（Normal），6 格外仍有 1 傷、7 格外 0 傷；擊退也必須跟著衰減 → Task 3（`explosionDamage`／`explosionKnockback` 的原版公式與邊界值）。
3. **苦力怕的引信必須能被打斷，而且不會「自己炸自己家」**：玩家離開或視線被遮住要能取消；苦力怕爆炸後消失且**不掉火藥** → Task 4（引信狀態機）＋ Task 9（爆炸執行時移除苦力怕且不跑掉落）。
4. **蜘蛛不能在大白天扑人、也不能在火把旁扑人，但被打了要還手**：中立判準必須吃 B6 的 per-block 光照（含內部天空光），且「被攻擊後不因亮度改變」 → Task 6（`spiderAggression` 與 `angry` 旗標）。
5. **蜘蛛爬牆不能爬成無底洞**：爬牆必須有高度上限、必須只在追擊時發生、必須卡在牆上時不會掉進方塊裡 → Task 6（`SPIDER_MAX_CLIMB` 與爬牆狀態機的表驅動測試：**2 格牆要爬得上去、3 格牆也要爬得上去、4 格牆不爬**，而且「登上牆頂時腳底要正好落在牆頂面上」——2026-10-20 稽核修正：原計畫的攀牆規則（「3 格內有任一格不實心就可爬」）與「頂端 ≤ 3 格可爬」的決策相反、登頂對齊公式又差 0.9 格，且攀牆時仍套重力與著地 → **爬永遠爬不上去**）。
6. **生怪權重與上限不能被新物種壓垮**：四種敵對各 25%、總上限仍是 12、苦力怕另有子上限；任何一隻都不能在白天地表生成 → Task 7（權重／上限／光照判準的統計測試）。

---

## 檔案結構

| 檔案 | 動作 | 職責 |
|---|---|---|
| `src/world/explosion.ts` | 新增 | 爆炸純邏輯：破壞範圍判定、掉落判定、玩家／生物的傷害與擊退公式（原版公式的精確移植） |
| `src/world/explosion.test.ts` | 新增 | 上述公式的表驅動測試（原版數值邊界） |
| `src/world/creeper.ts` | 新增 | 苦力怕實體：HP 20、引信 1.5 秒、追擊／嘶嘶／取消／爆炸事件 |
| `src/world/creeper.test.ts` | 新增 | 引信狀態機、視線條件、取消距離、命中測試 |
| `src/world/spider.ts` | 新增 | 蜘蛛實體：HP 16、中立判準、追擊、攀牆狀態機、咬擊事件 |
| `src/world/spider.test.ts` | 新增 | 中立判準、攀牆上限、攻擊冷卻、命中測試 |
| `src/world/b9-spawn.ts` | 新增 | 四種敵對（殭屍／骷髏／苦力怕／蜘蛛）的統一生怪分配器：權重、總上限、苦力怕子上限、光照判準、生成距離 |
| `src/world/b9-spawn.test.ts` | 新增 | 權重分佈、上限、距離、光照判準的統計測試 |
| `src/world/mobs.ts` | 修改 | 移除被統一分配器取代的 `trySpawnMob`／`chooseSpawnKind`（其測試搬去 `b9-spawn.test.ts`）；`createMob`／`findSpawnPos`／`surfaceYAt`／`MAX_MOBS`／`hasLineOfSight` 沿用不動 |
| `src/world/mob-drops.ts` | 修改 | `MobDropKind` 加 `'creeper' \| 'spider'`；掉落列：苦力怕火藥 0–2、蜘蛛線 0–2＋蜘蛛眼 0–1（僅玩家擊殺） |
| `src/world/blocks.ts` | 修改 | `BlockDef` 加 `blastResistance: number`（原版值） |
| `src/world/blocks.test.ts` | 修改 | 爆炸抗性資料表測試 |
| `src/core/items.ts` | 修改 | `ItemId` 加 `'gunpowder' \| 'string' \| 'spider_eye'`；`ITEM_IDS` 表同步（型別強制） |
| `src/ui/icons.ts` | 修改 | 三個新物品的像素圖示 |
| `src/player/physics.ts` | 修改 | `PlayerState` 加 `kbVel`（外部擊退通道）＋ `stepOnce` 套用與衰減 |
| `src/player/physics.test.ts` | 修改 | 擊退通道的測試 |
| `src/ui/death.ts` | 修改 | `DamageSource` 加 `'creeper' \| 'spider'` ＋ 對應死亡訊息 |
| `src/render/b9-mobs.ts` | 新增 | 苦力怕與蜘蛛的方塊模型渲染（含引信閃白、蜘蛛 8 條腿） |
| `src/render/b9-mobs.test.ts` | 新增 | 模型建立／同步／閃白／釋放 |
| `src/audio/voices.ts` | 修改（加分項） | `creeperHiss` 程序合成 |
| `src/audio/index.ts` | 修改（加分項） | `GameAudio.playCreeperHiss` |
| `src/main.ts` | 修改 | 全部接線（未測的組裝根） |
| `README.md`、`docs/releases/v0.12.0.md`、`package.json`、`game.json` | 修改／新增 | Task 12 發布 |

---

## 已查證與設計決策

（每條附 wiki 出處與原文摘錄；引用格式：`已查證（minecraft.wiki/<Page>，2026-10-20）`。）

### 1. 苦力怕數值

- **HP 20**：「Health points | 20HP × 10」已查證（minecraft.wiki/Creeper，2026-10-20）→ `CREEPER_HP = 20`。
- **碰撞盒 1.7 高 × 0.6 寬**：「Hitbox size … In Java Edition: Height: 1.7 blocks Width: 0.6 blocks」同頁 → `CREEPER_HEIGHT = 1.7`、`CREEPER_WIDTH = 0.6`。
- **引信 1.5 秒（30 tick）**：「When within 3 blocks of a player, a creeper stops moving, hisses, flashes and expands, and explodes after 1.5 seconds (30 ticks)」同頁；Entity data 段「Fuse: … Default 30.」→ `CREEPER_FUSE_SEC = 1.5`、`CREEPER_TRIGGER_DIST = 3`。
- **爆炸威力 3**：「Normal creeper explosions have a power of 3.」同頁；Explosion 頁 Causes 表「Creeper | Power 3 | Max. blast resistance 12.16 | Max. range Entity: 6, Block: 5.1」已查證（minecraft.wiki/Explosion，2026-10-20）→ `CREEPER_EXPLOSION_POWER = 3`。
- **追擊距離 16 格**：「Creepers chase any player within a 16-block radius.」已查證（minecraft.wiki/Creeper，2026-10-20）→ 沿用 `mobs.ts` 的 `CHASE_RANGE = 16`。
- **需要連續視線才會爆炸**：「A creeper explodes only if it has an uninterrupted line of sight with the player throughout the entire 1.5-second countdown. As a result … a detonation is canceled if it has started.」同頁 → 引信需要 LOS，LOS 中斷即取消。
- **離開可取消（2026-10-20 稽核修正：原計畫推成「取消距離 10 格」，是誤推 → 正確值 7 格）**：「A creeper's detonation can be halted if the player leaves the blast radius … the distance that the player must move in order for a creeper to cancel its explosion is 7 blocks, regardless of difficulty.」已查證（minecraft.wiki/Creeper，2026-10-20）。
  **原版 Java 的精確常數已複核**（vanilla `net/minecraft/world/entity/ai/goal/SwellGoal.java`；2026-10-20 取自 PaperMC/Paper 對 vanilla 原始碼的 patch 引用）：
  ```java
  // canUse()：什麼時候開始膨脹
  return this.creeper.getSwellDir() > 0 || livingEntity != null && this.creeper.distanceToSqr(livingEntity) < 9.0D;   // 3 格內
  // tick()：什麼時候取消（setSwellDir(-1)）
  if (this.target == null) { this.creeper.setSwellDir(-1); }
  else if (this.creeper.distanceToSqr(this.target) > 49.0) { this.creeper.setSwellDir(-1); }                    // 超過 7 格
  else if (!this.creeper.getSensing().hasLineOfSight(this.target)) { this.creeper.setSwellDir(-1); }               // 視線中斷
  ```
  → **觸發距離 3 格**（`distanceToSqr < 9.0`）、**取消距離 7 格**（`distanceToSqr > 49.0`），兩者都是**三維距離**（`distanceToSqr` 含 y）。wiki 那句「玩家必須移動 7 格」說的就是**這個 7 格門檻本身** → 原計畫的「觸發距離 3 ＋ 玩家要移動 7 ＝ **取消距離 10 格**」是**把兩個數字相加的誤推** → 改正為 **`CREEPER_CANCEL_DIST = 7`**（且是**嚴格大於**才取消：剛好 7 格仍會繼續引信，7 格以外才取消）。
- **火藥 0–2**：「Gunpowder | 0–2 | 66.67% | 1.00」已查證（minecraft.wiki/Creeper，2026-10-20）→ 掉落表加一行。
- **引信聲**：「Creeper hisses | … `entity.creeper.primed` | Volume 1.0 | Pitch 0.5」同頁 → 音效為加分項（Task 11）。

### 2. 蜘蛛數值

- **HP 16**：「Health points | 16HP × 8」已查證（minecraft.wiki/Spider，2026-10-20）→ `SPIDER_HP = 16`。
- **碰撞盒 0.9 高 × 1.4 寬**：「Hitbox size | Height: 0.9 blocks Width: 1.4 blocks」同頁。
- **速度屬性 0.3**：「Speed | 0.3」同頁 → 換算見 §5。
- **攻擊 2（Normal）**：「Attack strength | Easy: 2HP Normal: 2HP Hard: 3HP」同頁 → `SPIDER_ATTACK_DAMAGE = 2`。
- **敵對判準是亮度 ≤ 11（≥ 12 就中立）**（2026-10-20 稽核修正：原文的標題寫「中立判準是亮度 ≤ 11」，**方向讀起來相反**）：「A spider stays hostile toward the player or an iron golem as long as the light level immediately around the spider is 11 or less; otherwise, it does not attack unless attacked first. If a spider chases its target into an area where the light level immediately around the spider is above 11, it returns to a neutral state. However, spiders pursue targets regardless of the light level in retaliation to an attack.」同頁 → `SPIDER_HOSTILE_LIGHT_MAX = 11`（**≤ 11 敵對、≥ 12 中立**；2026-10-20 改名：原名 `SPIDER_NEUTRAL_LIGHT` 方向講反了）；被攻擊後 `angry = true` 且不受亮度影響。
- **視距 16 格、可隔牆察覺**：「Hostile spiders see up to 16 blocks, and pounce at close range.」「A spider pursuing a player can detect a player through blocks.」同頁 → `SPIDER_DETECT_RANGE = 16`；察覺**不要求**視線（與其他生物不同）。
- **攀牆**：「Spiders can climb up over solid blocks that are not magma blocks, but do not climb on underside surfaces. If a spider cannot find an ideal path to the player due to a wall barring the way, it approaches as close as possible to the player's position and proceeds to climb the wall vertically until it gets to the top, even if it loses its aggression toward the player.」同頁 → 見 §6 的釘死決策。
- **掉落**：「String | 0–2 | 66.67% | 1.00」「Spider Eye | 0–1 | 33.33% | 0.33」＋註腳「Only when killed by a player or a tamed wolf.」已查證（minecraft.wiki/Spider，2026-10-20）→ 線 0–2、蜘蛛眼 0–1（僅玩家擊殺；本作沒有寵物狼）。

### 3. 爆炸公式（傷害與擊退）

- **傷害公式**：「impact = (1 - distance/(2*power)) * exposure; damage = (float)((impact*impact + impact)/2 * 7*(2*power) + 1)」已查證（minecraft.wiki/Explosion，2026-10-20）→ **直接照抄這個公式**（`EXPLOSION_DAMAGE`）。以 power 3、distance 0、exposure 1 代入得 `((1+1)/2)*42 + 1 = 43`，與 Creeper 頁 infobox「Normal: 43HP」一致 ✓（雙向驗證）。
- **最小 1 傷**：「the main damage value has a +1 at the end, so all entities in range (within 2⋅power) of an explosion receive at least 1 damage even when the explosion is fully blocked.」同頁 → 2×power 內最少 1 傷、範圍外 0。
- **擊退公式**：「magnitude = (1 - distance/(2*power)) * exposure * knockbackMultiplier * (1 - EXPLOSION_KNOCKBACK_RESISTANCE)」「Each affected entity is accelerated by between 0 and 1 blocks per game tick (0 to 20 blocks per second)」同頁 → `magnitude`（blocks/tick）× 20 = blocks/s；苦力怕的 knockbackMultiplier 與爆炸擊退抗性皆為 1（預設值）。
- **距離量測**：「Distance is measured from the explosion center to the entity's feet position.」「the game takes the vector pointing from the explosion center to the entity's eye position」同頁 → **距離量到腳、方向取到眼睛**（本計畫照此區分）。
- **暴露度（exposure）**：「The exposure is a measurement of how much of the explosion is blocked by blocks. It ranges from 0 … to 1 … the game picks a set of sample points in the entity and casts rays from the explosion center to each point.」同頁 → **本作簡化為二值**：從爆炸中心到目標眼睛的線段沒有被實心方塊擋住 → `exposure = 1.0`；被擋住 → `exposure = 0.4`（保守值，避免「躲在牆後仍吃滿傷」）。此簡化寫進 README〈與原版的差異〉。
- **破壞半徑**：「This typically results in the maximum sphere of block damage having a radius of approximately 4/3 times the explosion power.」同頁 → `reach = power * 4/3`（power 3 → 4.0）。
- **逐格消耗強度**：「If the block isn't air, intensity is reduced by (blast resistance+0.3)⋅0.3.」「Position is moved 0.3 blocks along the ray. Intensity is reduced by 0.22500001.」同頁 → 每 0.3 格行進消耗 0.225 ⇒ **每 1 格空氣行進消耗 0.75**。本計畫把這套射線強度模型**改寫成等效的球形逐格判定**（見 Task 3 的演算法 body），保留「抗性越高越靠近核心才會被炸掉」的行為。
- **爆炸掉落**：「Blocks destroyed by explosions have a chance to drop items as if mined with an unenchanted diamond tool. Blocks destroyed by TNT have a 100% chance of dropping. Other explosions have a 1/power chance of dropping items.」同頁 → 苦力怕（power 3）**掉落機率 1/3**、掉落物＝`dropItemFor(blockId)`（無需工具門檻，等同鑽石鎬）。
- **爆炸會炸掉玩家放置的方塊**（查證結論）：Explosion 頁 Causes 表列出苦力怕「Affected by `mobGriefing`: Yes」，整頁沒有任何「玩家放置方塊豁免」的規則；掉落與破壞只受 `blast resistance` 與三個 drop-decay 遊戲規則影響 ⇒ **原版（Java Edition）會炸掉玩家自己放的方塊**。本批照此實作（不追蹤「誰放的」），並在 README 明寫。
- **爆炸不產生火**：「Creeper | … | Fire: No」同頁 → 本批不生成火（本作本來沒有火系統）。
- **爆炸抗性（合併後本作用到的方塊）**：stone 6、cobblestone 6、iron ore 3、coal ore 3、gold ore 3、diamond ore 3、oak planks 3、spruce planks 3、birch planks 3、oak log 2、spruce log 2、birch log 2、crafting table 2.5、chest 2.5、furnace 3.5、gravel 0.6、grass block 0.6、dirt 0.5、sand 0.5、**ice 0.5**、glass 0.3、oak leaves 0.2、spruce leaves 0.2、birch leaves 0.2、snow block 0.2、**wool 0.8**、**cactus 0.4**、dandelion 0、poppy 0、short grass 0、torch 0、**water 100**、**bedrock 3,600,000**。已查證（minecraft.wiki/Explosion「Blast resistance」段 ＋ wiki `Module:Blast resistance values`，2026-10-20）。
  （2026-10-20 稽核修正：原表只覆蓋 17 種方塊 → 合併 B3–B8 後有 17 種方塊沒有值；原計畫的後路是「填 `Infinity`（＝炸不壞）」→ **那會讓羊毛、冰、仙人掌、金／鑽礦永遠炸不壞**。已改成：**每一個方塊都填原版值、不得有 `Infinity`**。另：**ice 是 0.5 不是 0.6**（wiki `['ice'] = '0.5'`）。）
- **水／基岩免疫**：由上表推出（100 與 3.6M ≫ power 3 的強度）→ 水與基岩不會被破壞；本作沒有 TNT，因此「TNT 相關的免疫」不適用（寫進差異清單）。

### 4. 生成規則與權重

- **苦力怕只在亮度 0 生成**：「Creepers naturally spawn in the Overworld on solid blocks with a light level of 0」已查證（minecraft.wiki/Creeper，2026-10-20）→ 沿用 B6 的 `canSpawnHostile`（內部天空光 ≤ 7 且方塊光 = 0），不另立判準。
- **蜘蛛只在亮度 0 生成**：「Spiders can spawn in the Overworld at a light level of 0 within a 3×1×3 space centered on an opaque block.」已查證（minecraft.wiki/Spider，2026-10-20）→ 同樣沿用 `canSpawnHostile`。
- **權重都是 100**：「Spawn weight | 100⁄515 | 19.42% | Group size 4」（Creeper 頁）與（Spider 頁）同值 → 四種敵對等權重 ⇒ **各 25%**。已查證（minecraft.wiki/Creeper、minecraft.wiki/Spider，2026-10-20）。
- **Java 版成群 4 隻**：「They spawn individually in Bedrock Edition and in groups of four in Java edition.」（Creeper 頁）；（Spider 頁的 Group size 同為 4）→ 本作沿用 B4 的「每 5 秒嘗試 1 隻」模型（**簡化，寫進差異清單**）。
- **生成距離 24–128**：「Mobs spawn naturally within chunks that have a player horizontally within 128 blocks of the chunk center, and can only spawn within a 128 block radius sphere centered on the player.」已查證（minecraft.wiki/Mob_spawning，2026-10-20）→ 沿用 B4 的 `SPAWN_MIN_DIST = 24`／`SPAWN_MAX_DIST = 128` 與 `findSpawnPos`。
- **敵對總上限**：原版 Monster cap 70（minecraft.wiki/Mob_spawning「Java Edition mob cap」）→ 本作沿用 B4 的 `MAX_MOBS = 12`（已是明示簡化）。**本批新增「苦力怕子上限 4」**：苦力怕會摧毀建築，若不設子上限，12 隻的額度可能被 12 隻苦力怕佔滿（每次生成 25% 機率）。4 隻的上限讓「會被炸」但不會「家被炸平」；此為本作自訂限制，寫進 README 與發布說明。

### 5. 速度換算（沿用 B4 的尺度）

本作的怪物一律比原版慢（既有殭屍 3.2 格/秒 vs 原版約 4.6），B4 已建立「保留原版比例、套用本作慢速尺度」的慣例。蜘蛛原版速度屬性 0.3（殭屍 0.23）→ 比例 0.3/0.23 ≈ 1.30 → 3.2 × 1.30 ≈ 4.17 → **取 4.0 格/秒**（略保守，寫進註解）。苦力怕原版速度屬性 0.25（與骷髏同）→ 本作取 **3.2 格/秒**（與殭屍同速；原版苦力怕與殭屍同速 0.25）。

### 6. 蜘蛛攀牆——**本批決定：實作（簡化的完整方塊攀爬）**

**做法（釘死；2026-10-20 稽核修正後的版本）**：在 `src/world/spider.ts` 的 AI 步進裡加一個 `climb` 狀態。

1. **什麼時候進入 `climb`**：蜘蛛處於 `chase`（追擊玩家）、**腳下著地**、且**正前方那一格**（它要走進去的那一格）從腳底往上**連續實心**時，計算該柱的**障礙頂面**。判定**有界且精確**（只看 4 格，不掃到天花板）：
   - 從 `y = floor(腳底)` 起**往上 4 格**（`SPIDER_MAX_CLIMB + 1 = 4`）：`y = floor(腳底) … floor(腳底) + 3`。
   - 若這 4 格**全是實心** → 障礙比 3 格還高 → **不可爬**（不必知道確切頂面，也避免長牆的長掃描）。
   - 否則 → **第一個非實心格的 `y` 就是「障礙頂面」**（其下是連續實心的部分）→ 若 **頂面 − 腳底 ≤ `SPIDER_MAX_CLIMB = 3` 格** → 可爬 → 進入 `climb`（記 `climbDir` 為指向牆面的水平法線、清除水平速度、跳過本幀水平位移）。**頂面 − 腳底 > 3 → 不可爬**（照常追擊並在著地時給 `JUMP_IMPULSE`）。
   （2026-10-20 稽核修正：原計畫寫「從腳底往上數最多 3 格，若其中任一格不實心 → 可爬」——**規則相反**：3 格高的牆其上 3 格全是實心 → 會被判成「不可爬」，與 §6「頂端 ≤ 3 格可爬」的決策自相矛盾。統一成「**障礙頂面 − 腳底 ≤ 3 → 可爬**」。）
2. **攀爬中的運動**：以 `SPIDER_CLIMB_SPEED = 2.0` 格/秒**純垂直上升**（`pos.y += SPIDER_CLIMB_SPEED * step`）。
   **攀爬分支必須跳過重力與「著地吸附」**（2026-10-20 稽核修正：原計畫同一段既寫「純垂直上升」又寫「仍套重力與著地」——現況 `mobs.ts` 的落地掃描條件是 `vel.y <= 0`，蜘蛛在牆邊上升時 `vel.y` 為 0 或負 → 掃描會把 `pos.y` 吸附回腳下的地面（`pos.y = cy + 1`）→ **每幀被拉回地面，高度永遠不變**，計畫自己的測試「2 秒後 pos.y 上升 ≥ 1 格」必然失敗）。→ 攀爬分支：**不施加重力、不跑落地掃描**；只有在「登頂」或「放棄攀爬」之後才恢復重力與著地。
3. **登頂對齊（2026-10-20 稽核修正：原公式差 0.9 格，蜘蛛會嵌進牆裡）**：當頭部格（`floor(pos.y + SPIDER_HEIGHT + 0.1)`）在**障礙柱**上不再是實心 → 登頂 → **`pos.y = Math.floor(pos.y + SPIDER_HEIGHT) + 1`**（腳底正好落在障礙的頂面上）、`state = 'chase'`、`climbHeight = 0`。
   （原計畫寫 `Math.floor(pos.y + SPIDER_HEIGHT) + 1 - SPIDER_HEIGHT` → 以 2 格牆（頂面 y=8）為例得 `pos.y = 7.1`，腳底落在**牆頂面下方 0.9 格** → 身體整個嵌在牆內，與同句宣稱的「對齊到障礙頂面」不符，也違反 Review Focus #5「卡在牆上時不會掉進方塊裡」。**去掉 `- SPIDER_HEIGHT`**。）
4. **放棄攀爬**：累積攀爬高度 > `SPIDER_MAX_CLIMB` 仍未登頂 → `state = 'chase'`、`climbHeight = 0`（恢復重力與著地）。**有了第 1 條的規則，這條只是安全網**（可爬的障礙高度 ≤ 3，實際攀爬位移 ≤ 2 格）。

**理由**：
1. 攀牆是蜘蛛的識別性行為；本作只有完整方塊（階梯／半磚屬 B5 的「延伸、本輪不做」），所以「爬完整方塊」已涵蓋**現有幾何 100%** 的牆面。
2. 不做的話，站在 1–3 格高台上的玩家永遠打不到蜘蛛，而「白天／亮處中立」的機制會讓玩家完全無法反制 → 變成設計缺陷而不是簡化。
3. 成本可控：狀態機＋兩個探測，約 25 行，且完全複用 `mobs.ts` 既有的「前方探測＋著地」慣例。
4. 反面成本（爬太高）的控制：3 格上限既是原版常見台階高度，也讓「牆太高就放棄」的行為可預期。

**對體驗的影響（必須寫進 README〈與原版的差異〉）**：蜘蛛能追上 1–3 格高的玩家；面對更高的牆會在牆下徘徊（原版會一路爬到牆頂）；爬牆只在追擊時發生（原版在失去敵意後還會盲爬 2 秒）；不爬方塊的下表面；沒有梯子／藤蔓／蛛網互動（本作無這些方塊）。

### 7. 其他明示簡化

- **苦力怕摔落膨脹**未實作（原版：摔落會額外累積引信）→ 本作引信只有 1.5 秒固定值。
- **爆炸的隨機射線強度**（原版每條射線的 intensity 是 power × 0.7–1.3 的隨機值）未實作 → 本作取確定值 power（不隨機），破壞範圍因此不會每次不同（測試可重現；寫進差異清單）。
- **爆炸的火焰**未實作（原版苦力怕本來也不產生火 ✓）。
- **爆炸對「著火／水／TNT」的免疫**只保留「水與基岩不被破壞」；本作沒有 TNT 與火。
- **苦力怕不因白天燃燒**（非不死系）→ 不進 B4 的 `stepSunBurn`（該函式只對 `kind === 'zombie' | 'skeleton'` 生效），天然滿足 spec §B9 的「白天不燃燒」。
- **爆炸傷害繞過玩家的 0.5 秒受擊無敵幀**（原版沒有無敵幀；爆炸是單次大傷害）。
- **火藥／線／蜘蛛眼沒有任何用途**（不進合成表、不進熔爐、不進進度）→ 依 spec §B9 明示。

---

### Task 1: 新物品（火藥／線／蜘蛛眼）與擊殺掉落表

**Files:**
- Modify: `src/core/items.ts`（`ItemId` union、`ITEM_IDS` 表）
- Modify: `src/ui/icons.ts`（`drawItemArt` 三個新分支）
- Modify: `src/world/mob-drops.ts`（`MobDropKind` 加兩種、`rollMobDrops` 加兩列 + 玩家擊殺旗標）
- Test: `src/core/items.test.ts`、`src/world/mob-drops.test.ts`、`src/core/recipes.test.ts`

**Interfaces:**
- Consumes: B4 的 `ItemId`／`ALL_ITEM_IDS`／`ITEM_IDS`／`sanitizeStack`／`maxStack`／`blockFromItem`；B4 的 `rollMobDrops(kind, rng?)`／`MobDropKind`。
- Produces:
  - `ItemId` 新增 `'gunpowder' | 'string' | 'spider_eye'`（`ALL_ITEM_IDS` 數量 +3）。
  - `MobDropKind` 新增 `'creeper' | 'spider'`（**擴充** B4 的字面聯集，不改既有分支）。
  - `rollMobDrops(kind: MobDropKind, rng?: () => number, opts?: { killedByPlayer?: boolean }): MobDrop[]`——第三個參數為**新增的可選**參數，既有呼叫端（`rollMobDrops(kind)`、`rollMobDrops(kind, rng)`）行為不變；`opts.killedByPlayer` 預設 `true`。
  - 掉落規則：creeper → `gunpowder` 0–2；spider → `string` 0–2 ＋ `spider_eye` 0 或 1（僅 `killedByPlayer === true` 時有 1/3 機率掉 1 顆）。

**已查證數值（wiki，2026-10-20）**：苦力怕掉火藥 0–2；蜘蛛掉線 0–2、蜘蛛眼 0–1（1/3 機率，且「Only when killed by a player or a tamed wolf」）。

**設計決策（要寫進註解）**：
- 三個物品**沒有任何用途**：不進 `RECIPES`、不進熔爐食譜、不進 `OBTAIN_UNLOCKS`（→ 不觸發任何進度）。`stackName` 自動得到「Gunpowder」「String」「Spider Eye」。
- 蜘蛛眼的「僅玩家擊殺」條件用**可選參數**表達，而不是新函式——保持 B4 的 `rollMobDrops` 介面形狀（多一個 optional 參數），既有測試不需要改寫語意。

- [ ] **Step 1: 寫測試（失敗）**

`src/core/items.test.ts`：
- 既有 `'ALL_ITEM_IDS is the canonical list: <N> entries, no dupes, same set as the union'`：把 `<N>` 改成「合併後的實際數量 + 3」——**實作時先讀 `src/core/items.ts` 裡 `ALL_ITEM_IDS` 註解的當前數字 N**（本計畫群的合併順序下是 73；上游若有批次未落地則是別的數字，**一律以讀到的為準**），斷言寫成 `expect(ALL_ITEM_IDS.length).toBe(N + 3)` 的**實際值**，並把測試名裡的數字同步改掉（**改動理由**：本批新增 3 個物品 id，這是數量守門測試，不是行為弱化；要在 commit 訊息說明並註明實際值）。
- **既有 `'ItemId union covers every obtainable block item'`（2026-10-20 稽核修正：原清單只提到改 `:46-47` 的那一處 `toBe(32)`，漏了兩處）**：該測試檔裡**有一份手工維護的 union 鏡像** `ALL_ITEMS`（由 `BLOCK_ITEMS`／`TOOL_ITEMS`／`DROP_ITEMS` 拼出來），而：
  - `:37` 有**第二處** `expect(ALL_ITEMS.length).toBe(<N>)` → 一併改成 N + 3；
  - `:51` 有 `expect(new Set(ALL_ITEM_IDS)).toEqual(new Set(ALL_ITEMS))` → **鏡像沒加新 id 就會紅** → 必須把三個新 id 加進鏡像（**不得**為了讓它綠而刪掉或放寬這條比對 —— 它就是 union 完整性的守門機制）：
    ```ts
    const DROP_ITEMS: ItemId[] = ['stick', 'coal', 'iron_ingot', 'raw_iron', 'arrow', 'apple', 'gunpowder', 'string', 'spider_eye'];
    ```
    （若合併後的 `DROP_ITEMS` 已經含別的材料 → 就把三個新 id 接在後面。）
  - **重點：鏡像是「新增三個 id」而不是「改數字」** —— 只把計數斷言的數字改掉（`toBe(<基數>)` → `toBe(<基數 + 3>)`）而沒把三個新 id 加進鏡像 → `new Set(ALL_ITEM_IDS)` 與 `new Set(ALL_ITEMS)` 不相等 → 既有測試必紅，而實作者很可能會「改弱鏡像」來讓它綠（等於拆掉守門機制，違反公約 §6）。
- 新增 `'every B9 item id is a known, sanitizable, stackable item'`：
  ```ts
  const NEW = ['gunpowder', 'string', 'spider_eye'] as const;
  for (const id of NEW) {
    expect(ALL_ITEM_IDS).toContain(id);
    expect(sanitizeStack({ item: id, count: 2 })).toEqual({ item: id, count: 2 });
    expect(maxStack(id)).toBe(64);
    expect(blockFromItem(id)).toBeNull();
    expect(stackName(id)).toBe(id === 'gunpowder' ? 'Gunpowder' : id === 'string' ? 'String' : 'Spider Eye');
  }
  ```

`src/world/mob-drops.test.ts`：
- `'a creeper drops 0-2 gunpowder'`：`rollMobDrops('creeper', () => 0)` → `[]`；`rollMobDrops('creeper', () => 0.999)` → `[{ item: 'gunpowder', count: 2 }]`。
- `'a spider drops 0-2 string'`：`rollMobDrops('spider', () => 0.999)` → `[{ item: 'string', count: 2 }]`（rng 恆 0.999 → string 抽到上限 2；蜘蛛眼的機率抽樣用**同一個 rng 的下一次呼叫**＝0.999 > 1/3 → 不掉蜘蛛眼）。
- `'a spider drops a spider eye only when killed by the player'`：rng 恆 0.1 → 第一次抽樣給 string（0.1 → 0 顆）、第二次抽樣給蜘蛛眼（0.1 < 1/3 → 掉 1 顆）→ `rollMobDrops('spider', () => 0.1, { killedByPlayer: true })` → `[{ item: 'spider_eye', count: 1 }]`；`rollMobDrops('spider', () => 0.1, { killedByPlayer: false })` → `[]`（**不含** spider_eye）。
- `'the string count and the spider eye are drawn separately'`：注入一個依序回傳 `[0.9, 0.9]` 的 rng（第一次給 string 的數量、第二次給蜘蛛眼的機率）→ string 2、蜘蛛眼不掉（0.9 > 1/3）→ 結果 `[{ item: 'string', count: 2 }]`；注入 `[0.0, 0.0]` → string 0、蜘蛛眼掉 1 → 結果 `[{ item: 'spider_eye', count: 1 }]`。用 `toEqual` 精確比對陣列（順序固定：先 string 後 spider_eye）。
- `'the existing mob drop rows are unchanged'`：既有殭屍／骷髏／雞／豬／羊／牛的斷言**一字不改**（預設 `killedByPlayer = true` 不影響它們）。

`src/core/recipes.test.ts`：
- 新增 `'the B9 materials have no recipe yet'`：`expect(RECIPES.some((r) => ['gunpowder', 'string', 'spider_eye'].includes(r.result.item))).toBe(false);`

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/items.test.ts src/world/mob-drops.test.ts src/core/recipes.test.ts`
Expected: FAIL（型別編譯階段就會報 `ItemId` 缺成員——這是預期的紅燈）。

- [ ] **Step 3: 實作**

`src/core/items.ts`：
- union 新增三個成員（放在材料類那一段附近）；`ITEM_IDS` 表逐項加 `true`（少了任何一項都是型別錯誤——這是刻意的守門機制）。
- `ALL_ITEM_IDS` 註解裡的數字同步更新。

`src/ui/icons.ts`：`drawItemArt` 的 `switch` 新增三個分支（用既有 `line()`／`ctx.arc`／`ctx.fillRect` 畫法，畫在 32×32 的圖示框內）：
- `gunpowder`：灰色火藥堆（三團深淺灰的圓，`#8f8f8f`／`#6b6b6b`／`#a8a8a8`，半徑 4–5，重疊堆在中央）。
- `string`：白色線團（米白圓 `#f2efe2` 半徑 8 ＋ 兩三條交叉的細線 `#d8d3c2`）。
- `spider_eye`：深紅眼球（`#7a1420` 圓半徑 7 ＋ 深色瞳孔 `#1a0a0c` 半徑 3 ＋ 一點高光 `#e08a8a`）。

`src/world/mob-drops.ts`：
- `MobDropKind` union 加 `'creeper' | 'spider'`。
- `rollMobDrops(kind, rng = Math.random, opts: { killedByPlayer?: boolean } = {})`：
  - `const byPlayer = opts.killedByPlayer !== false;`
  - `case 'creeper': push('gunpowder', range(0, 2)); break;`
  - `case 'spider': push('string', range(0, 2)); if (byPlayer && rng() < 1/3) push('spider_eye', 1); break;`
  - 抽樣順序：**先 string 的數量、再蜘蛛眼的機率**（測試依此寫 rng 序列）。
  - 檔頭註解補一句：蜘蛛眼只有玩家（或寵物狼）擊殺才掉；本作沒有寵物狼 → 只有玩家。

- [ ] **Step 4: 跑測試轉綠**

Run: `npx vitest run src/core/items.test.ts src/world/mob-drops.test.ts src/core/recipes.test.ts`
Expected: PASS。

- [ ] **Step 5: 全量 gates**

Run: `npm run typecheck && npm test && npm run build && npm run lint`
Expected: 全綠。

- [ ] **Step 6: Commit**

```bash
git add src/core/items.ts src/core/items.test.ts src/ui/icons.ts src/world/mob-drops.ts src/world/mob-drops.test.ts src/core/recipes.test.ts
git commit -m "feat(items): B9 新增火藥／線／蜘蛛眼三物品與苦力怕／蜘蛛掉落表"
```

---

### Task 2: 方塊爆炸抗性資料表

**Files:**
- Modify: `src/world/blocks.ts`（`BlockDef` 加 `blastResistance`、逐格填值）
- Test: `src/world/blocks.test.ts`

**Interfaces:**
- Consumes: B5／B6 的 `BlockDef`／`DEFS`／`getBlockDef`（**若合併後 `BlockDef` 已有 `shape`／`emission` 等新欄位，只加本欄，不動其他**）。
- Produces:
  - `BlockDef` 新欄位 `blastResistance: number`（0–3,600,000；越大越難被炸掉）。
  - `export function blastResistanceOf(blockId: number): number`（`getBlockDef(id).blastResistance`，未知 id → 0）。

**已查證數值（minecraft.wiki/Explosion「Blast resistance」段＋ wiki 的 `Module:Blast resistance values`，2026-10-20 抓取）**：**合併後 0–33 的每一個方塊都要有值**（下表；**沒有 `Infinity` 佔位**）。模組的關鍵條目：`['planks'] = '3'`、`['log'] = '2'`、`['leaves'] = '0.2'`、`['wool'] = '0.8'`、`['ice'] = '0.5'`、`['cactus'] = '0.4'`、`['chest'] = '2.5'`、`['torch'] = '0'`、`['gravel'] = '0.6'`、`['gold ore'] = '3'`、`['diamond ore'] = '3'`、`['dandelion'] = '0'`、`['poppy'] = '0'`、`['short grass'] = '0'`、`['bedrock'] = '3,600,000'`、`['water'] = '100'`。

> **2026-10-20 稽核修正：原計畫的「未查到的先填 `Infinity`（＝炸不壞）」這條後路必須刪掉。**
> 原因：① 它與同一個 Task 裡「每個 block 的 `blastResistance` 都是 `Number.isFinite`」的測試**直接矛盾**；② 合併 B3–B8 後的方塊集合裡有 **17 種**方塊（spruce/birch log、spruce/birch leaves、spruce/birch planks、dandelion、poppy、short grass、cactus、ice、wool、gold ore、diamond ore、torch、chest…）若全填 `Infinity` → **這些方塊永遠炸不壞**（羊毛、冰、仙人掌、金／鑽礦都不會被苦力怕破壞）→ 明顯不是原版行為。**規則改成：合併後的每一個方塊都必須填原版值；真的查不到就停下來回報 controller，不准用 `Infinity` 佔位。**
> （另註：稽核報告寫的「ice 0.6」與 wiki 不符 —— wiki 的 `['ice'] = '0.5'`；原版 `Blocks.ICE` 是 `strength(0.5F, 0.5F)` → 抗性 0.5。本計畫採用 **0.5**。）

**設計決策（要寫進註解）**：
- 本表是**原版值**，不是本作自訂；唯一的差異是「水／基岩」在原版是因為它們是特殊方塊，本作同樣保留同樣的數值語意。
- 未知 block id → 0（可以被炸掉），與 `getBlockDef` 的 fallback（`DEFS[0]` 空氣）一致。

- [ ] **Step 1: 寫測試（失敗）**

`src/world/blocks.test.ts`：
- 新增 `'the blast resistance table matches the vanilla values'`：
  ```ts
  expect(blastResistanceOf(BLOCK.BEDROCK)).toBe(3600000);
  expect(blastResistanceOf(BLOCK.WATER)).toBe(100);
  expect(blastResistanceOf(BLOCK.STONE)).toBe(6);
  expect(blastResistanceOf(BLOCK.COBBLE)).toBe(6);
  expect(blastResistanceOf(BLOCK.COAL_ORE)).toBe(3);
  expect(blastResistanceOf(BLOCK.IRON_ORE)).toBe(3);
  expect(blastResistanceOf(BLOCK.PLANKS)).toBe(3);
  expect(blastResistanceOf(BLOCK.LOG)).toBe(2);
  expect(blastResistanceOf(BLOCK.CRAFTING_TABLE)).toBe(2.5);
  expect(blastResistanceOf(BLOCK.FURNACE)).toBe(3.5);
  expect(blastResistanceOf(BLOCK.GRASS)).toBe(0.6);
  expect(blastResistanceOf(BLOCK.DIRT)).toBe(0.5);
  expect(blastResistanceOf(BLOCK.SAND)).toBe(0.5);
  expect(blastResistanceOf(BLOCK.GRAVEL)).toBe(0.6);   // B5 的 gravel
  expect(blastResistanceOf(BLOCK.GLASS)).toBe(0.3);
  expect(blastResistanceOf(BLOCK.LEAVES)).toBe(0.2);
  expect(blastResistanceOf(BLOCK.SNOW)).toBe(0.2);     // snow_block
  // B3–B8 新增的方塊（2026-10-20 稽核修正：原本漏了這一段 → 會讓 17 種方塊永遠炸不壞）
  expect(blastResistanceOf(BLOCK.SPRUCE_LOG)).toBe(2);
  expect(blastResistanceOf(BLOCK.BIRCH_LOG)).toBe(2);
  expect(blastResistanceOf(BLOCK.SPRUCE_LEAVES)).toBe(0.2);
  expect(blastResistanceOf(BLOCK.BIRCH_LEAVES)).toBe(0.2);
  expect(blastResistanceOf(BLOCK.SPRUCE_PLANKS)).toBe(3);
  expect(blastResistanceOf(BLOCK.BIRCH_PLANKS)).toBe(3);
  expect(blastResistanceOf(BLOCK.DANDELION)).toBe(0);
  expect(blastResistanceOf(BLOCK.POPPY)).toBe(0);
  expect(blastResistanceOf(BLOCK.SHORT_GRASS)).toBe(0);
  expect(blastResistanceOf(BLOCK.CACTUS)).toBe(0.4);
  expect(blastResistanceOf(BLOCK.ICE)).toBe(0.5);       // wiki：['ice'] = '0.5'
  expect(blastResistanceOf(BLOCK.WOOL)).toBe(0.8);
  expect(blastResistanceOf(BLOCK.GOLD_ORE)).toBe(3);
  expect(blastResistanceOf(BLOCK.DIAMOND_ORE)).toBe(3);
  expect(blastResistanceOf(BLOCK.TORCH)).toBe(0);
  expect(blastResistanceOf(BLOCK.CHEST)).toBe(2.5);
  ```
  （**若合併後的 `BLOCK` 常數名不同**（例：合併後的 `BLOCK` 沒有 `GRAVEL`／`WOOL`／`TORCH`／`CHEST`），先讀 `src/world/blocks.ts` 的實際常數名再對應；**數值一個都不能少**。）
- 新增 `'every block declares a finite blast resistance'`（2026-10-20 稽核修正：**改用 `Object.values(BLOCK)`** —— 現況 `src/world/blocks.ts` 的 `const DEFS` 是**模組私有、沒有 export**，測試檔拿不到，`Object.keys(DEFS)` 會是 TS 錯誤）：
  ```ts
  for (const id of Object.values(BLOCK)) {
    const r = getBlockDef(id).blastResistance;
    expect(Number.isFinite(r), `block ${id} has a non-finite blast resistance`).toBe(true);
    expect(r).toBeGreaterThanOrEqual(0);
  }
  ```
  （**這一條與「不得用 `Infinity` 佔位」是同一個約束的兩面**：有 `Infinity` 就會紅。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/world/blocks.test.ts`
Expected: FAIL（`blastResistanceOf` 不存在、`BlockDef` 缺欄位）。

- [ ] **Step 3: 實作**

`src/world/blocks.ts`：
- `BlockDef` 加 `blastResistance: number`（註解寫「原版爆炸抗性（Explosion 頁 Blast resistance 表）；數值越大越難被爆炸破壞」）。
- `DEFS` 每一筆補上對應值（上表；air = 0）。
- 新增 `export function blastResistanceOf(blockId: number): number { return getBlockDef(blockId).blastResistance; }`。
- 若合併後的 `DEFS` 有新方塊（torch、chest、wool、ice、cactus、金／鑽礦、spruce/birch 系列等），**一律填原版值**（torch 0、chest 2.5、wool 0.8、ice 0.5、cactus 0.4、gold/diamond ore 3、spruce/birch log 2、leaves 0.2、planks 3、花草 0）。
  **不准用 `Infinity` 佔位**（2026-10-20 稽核修正：會讓十幾種方塊永遠炸不壞，且與本 Task 的「有限值」測試衝突）。**真的查不到 → 停下來回報 controller**，不要自己填佔位值。

- [ ] **Step 4: 跑測試轉綠**

Run: `npx vitest run src/world/blocks.test.ts` → PASS。

- [ ] **Step 5: 全量 gates**

Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 6: Commit**

```bash
git add src/world/blocks.ts src/world/blocks.test.ts
git commit -m "feat(blocks): B9 加入原版爆炸抗性資料表"
```

---

### Task 3: 爆炸純邏輯（破壞範圍／掉落／傷害／擊退）

**Files:**
- Create: `src/world/explosion.ts`、`src/world/explosion.test.ts`

**Interfaces:**
- Consumes: `src/world/blocks.ts` 的 `blastResistanceOf`；`src/world/drops.ts` 的 `dropItemFor`；`src/core/items.ts` 的 `ItemId`。
- Produces:
  ```ts
  export const CREEPER_EXPLOSION_POWER = 3;      // 原版苦力怕爆炸威力
  export const EXPLOSION_REACH_FACTOR = 4 / 3;   // 原版：破壞半徑 ≈ 4/3 × power
  export const EXPLOSION_AIR_COST = 0.75;        // 原版：每 0.3 格行進消耗 0.225 ⇒ 每格 0.75
  export const EXPLOSION_RESISTANCE_FACTOR = 0.3;// 原版：(抗性 + 0.3) × 0.3
  export const EXPLOSION_KNOCKBACK_MAX_Y = 8;    // 格/秒；原版垂直分量最高 20，本作壓到 8
  export interface ExplosionCtx {
    power: number;
    center: { x: number; y: number; z: number };
    blockIdAt: (x: number, y: number, z: number) => number;
    isSolidAt: (x: number, y: number, z: number) => boolean;
    rng?: () => number;
  }
  export interface DestroyedBlock { x: number; y: number; z: number; blockId: number }
  export interface ExplosionDrop { item: ItemId; count: number; at: { x: number; y: number; z: number } }
  export interface ExplosionResult { destroyed: DestroyedBlock[]; drops: ExplosionDrop[] }
  export function explodeAt(ctx: ExplosionCtx): ExplosionResult;
  export function explosionDamage(power: number, distance: number, exposure: number): number;
  export function explosionKnockback(power: number, distance: number, exposure: number): number; // blocks/s
  export function explosionExposure(hasLineOfSight: boolean): number; // 1.0 或 0.4
  ```

**已查證數值（minecraft.wiki/Explosion，2026-10-20）**：見〈已查證與設計決策〉§3（傷害公式、+1 最小傷、2×power 範圍、擊退公式、4/3 半徑、每格 0.75 空氣消耗、(抗性+0.3)×0.3 消耗、掉落 1/power）。

**設計決策（要寫進註解）**：
- **爆炸的破壞判定是「原版射線模型的等效球形版本」**：原版是 16×16×16 條隨機方向的射線逐格消耗強度；本作改成「以爆炸中心為心的球形候選 + 逐格強度衰減」，保留原版的兩個性質：① 破壞半徑 ≈ 4/3 × power；② 方塊抗性越高、離中心越遠越不容易被炸掉。差別寫進 README。
- **不隨機**：原版每條射線的強度是 power × 0.7–1.3 的隨機值；本作取確定的 power ⇒ 同一位置的爆炸結果可重現（測試可釘死）。寫進 README。
- **掉落**用 `dropItemFor(blockId)`（無工具門檻，等同原版的「無附魔鑽石鎬」）；機率 1/power（苦力怕 = 1/3）。
- **傷害與擊退照抄原版公式**，唯一簡化是 exposure 二值化（`explosionExposure`）。

- [ ] **Step 1: 寫測試（失敗）**

`src/world/explosion.test.ts`（新檔）：

- `'the damage formula reproduces the vanilla creeper numbers'`：
  ```ts
  expect(explosionDamage(3, 0, 1)).toBe(43);      // 原版 Normal 43HP
  expect(explosionDamage(3, 3, 1)).toBe(16);
  expect(explosionDamage(3, 6, 1)).toBe(1);       // 2×power 內最少 1 傷
  expect(explosionDamage(3, 7, 1)).toBe(0);       // 超出 2×power → 0
  expect(explosionDamage(3, 0, 0.4)).toBe(12);    // 遮蔽時（簡化的 exposure）
  ```
- `'the damage falls off with distance'`：`explosionDamage(3, 0, 1) > explosionDamage(3, 2, 1)` 且 `> explosionDamage(3, 4, 1)`。
- `'a non-finite distance deals no damage'`：`explosionDamage(3, NaN, 1)` → 0；`explosionDamage(3, Infinity, 1)` → 0。
- `'the knockback falls off with distance and is zero outside the range'`：
  ```ts
  expect(explosionKnockback(3, 0, 1)).toBe(20);   // 1 block/tick × 20
  expect(explosionKnockback(3, 3, 1)).toBeCloseTo(10, 5);
  expect(explosionKnockback(3, 6, 1)).toBe(0);
  expect(explosionKnockback(3, 7, 1)).toBe(0);
  ```
- `'the exposure is binary'`：`explosionExposure(true)` → 1；`explosionExposure(false)` → 0.4。
- `'an explosion destroys stone only near the centre'`：造一個假世界（`blockIdAt` 回 `BLOCK.STONE`、`isSolidAt` 恆回 true），`explodeAt({ power: 3, center: { x: 0.5, y: 0.5, z: 0.5 }, ... })` → 斷言**距離中心 0 的那一格**（`(0,0,0)`）在 `destroyed` 裡，而距離 ≥ 2 的格子（例如 `(2,0,0)`、`(0,0,3)`）**不在**。斷言方式：`expect(res.destroyed.map((b) => `${b.x},${b.y},${b.z}`)).toContain('0,0,0')` 與 `expect(...).not.toContain('2,0,0')`。
- `'bedrock and water survive the explosion'`：假世界 `blockIdAt` 分別回 `BLOCK.BEDROCK`／`BLOCK.WATER`，且 **`isSolidAt` 一律回 true**（刻意把水視為實心，好證明「是抗性 100 讓它活下來」，而不是被非實心過濾擋掉）→ `destroyed` 為空陣列（`toEqual([])`）。
- `'leaves and glass are destroyed by a creeper explosion'`：假世界 `blockIdAt` 回 `BLOCK.LEAVES`／`BLOCK.GLASS`、`isSolidAt` 回 true → 中心那一格被破壞（`toContain('0,0,0')`）。
- `'destroyed blocks drop their item with a one-in-power chance'`：rng 恆 0 → 掉落 1 筆；rng 恆 0.99 → 掉落 0 筆（`1/3` 機率 → 0.99 > 1/3）。掉落物＝`dropItemFor(blockId)`。
- `'the explosion never removes air'`：假世界 `blockIdAt` 回 `BLOCK.AIR` → `destroyed` 空、`drops` 空。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/world/explosion.test.ts` → FAIL（模組不存在）。

- [ ] **Step 3: 實作 `src/world/explosion.ts`**

- `explosionDamage(power, distance, exposure)`：
  ```
  const span = 2 * power;
  if (!Number.isFinite(distance) || distance > span) return 0;
  const impact = Math.max(0, 1 - distance / span) * exposure;
  return Math.floor(((impact * impact + impact) / 2) * 7 * span + 1);
  ```
- `explosionKnockback(power, distance, exposure)`：同樣的 span／impact，結果 `impact * 20`（blocks/tick → blocks/s）；超出 span 或非有限 → 0。
- `explosionExposure(hasLineOfSight: boolean)`：`hasLineOfSight ? 1 : 0.4`。
- `explodeAt(ctx)`（演算法 body，測試不足以決定，故在此給具體 body）：
  ```
  const power = ctx.power;
  const reach = power * EXPLOSION_REACH_FACTOR;          // 4.0
  const r = Math.ceil(reach);
  const bx0 = Math.floor(ctx.center.x), by0 = Math.floor(ctx.center.y), bz0 = Math.floor(ctx.center.z);
  const destroyed: DestroyedBlock[] = [];
  for (let dy = -r; dy <= r; dy++)
   for (let dz = -r; dz <= r; dz++)
    for (let dx = -r; dx <= r; dx++) {
      const x = bx0 + dx, y = by0 + dy, z = bz0 + dz;
      const id = ctx.blockIdAt(x, y, z);
      if (id === BLOCK.AIR) continue;                    // 空氣不消耗也不被破壞
      if (!ctx.isSolidAt(x, y, z)) continue;             // 水／火把等非實心方塊
      const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
      const d = Math.hypot(cx - ctx.center.x, cy - ctx.center.y, cz - ctx.center.z);
      if (d > reach) continue;
      const resistance = blastResistanceOf(id);
      const intensity = power - EXPLOSION_AIR_COST * d;   // 走到這裡還剩多少爆力
      const cost = (resistance + 0.3) * EXPLOSION_RESISTANCE_FACTOR; // 破壞這一格要花多少
      if (intensity <= cost) continue;                    // 爆力不夠 → 這一格活下來
      destroyed.push({ x, y, z, blockId: id });
    }
  // 掉落：每格 1/power 機率（power 3 → 1/3），掉落物 = dropItemFor
  const drops: ExplosionDrop[] = [];
  const rng = ctx.rng ?? Math.random;
  for (const b of destroyed) {
    if (rng() >= 1 / power) continue;
    const item = dropItemFor(b.blockId);
    if (!item) continue;
    drops.push({ item, count: 1, at: { x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 } });
  }
  return { destroyed, drops };
  ```
  註解要寫明：① 為什麼用球形候選而不是原版的 256 條射線；② 為什麼強度衰減用 `power - 0.75 × d`（原版每 0.3 格 0.225）；③ 為什麼 `isSolidAt` 過濾掉水／火把。

- [ ] **Step 4: 跑測試轉綠**

Run: `npx vitest run src/world/explosion.test.ts` → PASS。

- [ ] **Step 5: 全量 gates**

Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 6: Commit**

```bash
git add src/world/explosion.ts src/world/explosion.test.ts
git commit -m "feat(explosion): B9 爆炸純邏輯（球形破壞判定／1-3 掉落／原版傷害與擊退公式）"
```

---

### Task 4: 苦力怕實體與引信 AI

**Files:**
- Create: `src/world/creeper.ts`、`src/world/creeper.test.ts`

**Interfaces:**
- Consumes: `src/world/mobs.ts` 的 `hasLineOfSight`（既有函式，直接重用）、`MOB_GRAVITY = 32`／`JUMP_IMULPULSE` 慣例（`mobs.ts` 的 `MOB_GRAVITY`、`JUMP_IMPULSE`、`KNOCKBACK_SPEED`、`KNOCKBACK_DECAY_PER_SEC`、`KNOCKBACK_MIN`、`PROBE_LEAD`）；`src/world/explosion.ts` 的 `CREEPER_EXPLOSION_POWER`。
- Produces:
  ```ts
  export const CREEPER_HP = 20;
  export const CREEPER_WIDTH = 0.6;
  export const CREEPER_HEIGHT = 1.7;
  export const CREEPER_FUSE_SEC = 1.5;
  export const CREEPER_TRIGGER_DIST = 3;   // vanilla SwellGoal#canUse: distanceToSqr < 9.0
  export const CREEPER_CANCEL_DIST = 7;    // vanilla SwellGoal#tick: distanceToSqr > 49.0（嚴格大於才取消）
  export const CREEPER_CHASE_SPEED = 3.2;
  export const CREEPER_WANDER_SPEED = 1.5;
  /** 'exploded' 是**終態**（2026-10-20 稽核修正：原計畫沒有終態 → 引信歸零後每一步都會再發一次 explode 事件）。 */
  export type CreeperState = 'wander' | 'chase' | 'fuse' | 'exploded';
  export interface Creeper {
    id: number; hp: number;
    pos: { x: number; y: number; z: number };
    vel: { x: number; y: number; z: number };
    state: CreeperState;
    fuse: number;            // 引信剩餘秒數；0 = 未引信
    fuseTotal: number;       // 引信總長（渲染閃白用）
    wanderDir: number; wanderTimer: number;
    target: { x: number; y: number; z: number } | null;
    kbVel: { x: number; z: number };
  }
  export interface CreeperCtx {
    playerPos: { x: number; y: number; z: number };
    isSolidAt: (x: number, y: number, z: number) => boolean;
    hasLineOfSight: (from: {x,y,z}, to: {x,y,z}) => boolean;
    dt: number;
    rng?: () => number;
  }
  export type CreeperEvent = { type: 'explode'; creeperId: number; at: { x: number; y: number; z: number } };
  export function createCreeper(pos: { x: number; y: number; z: number }, rng?: () => number): Creeper;
  export function stepCreeper(c: Creeper, ctx: CreeperCtx): { creeper: Creeper; events: CreeperEvent[] };
  export function stepCreepers(list: readonly Creeper[], ctx: CreeperCtx): { creepers: Creeper[]; events: CreeperEvent[] };
  export function damageCreeper(c: Creeper, dmg: number, from?: { x: number; z: number }): Creeper;
  export function isCreeperDead(c: Creeper): boolean;
  export function hitCreeperId(creepers: readonly Creeper[], eye, lookDir, reach): number | null;
  export function attackCreeper(creepers: readonly Creeper[], eye, lookDir, reach, damage, knockDir): { creepers: Creeper[]; hitId: number | null };
  export function creeperFuseProgress(c: Creeper): number; // 0..1，1 = 引信即將爆
  ```

**已查證數值（wiki，2026-10-20）**：HP 20、碰撞盒 1.7×0.6、引信 1.5 秒（30 tick）、觸發距離 3 格（vanilla `distanceToSqr < 9.0`）、追擊距離 16 格、**取消距離 7 格**（vanilla `distanceToSqr > 49.0`；wiki 的「玩家必須移動 7 格」說的就是這個門檻本身 → **2026-10-20 稽核修正：原計畫寫的「取消距離 10 格」是誤推**）、爆炸威力 3。

**設計決策（要寫進註解）**：
- 苦力怕**獨立成自己的實體型別**，不合進 `mobs.ts` 的 `Mob`：引信狀態機與「爆炸後消失且不掉落」是殭屍／骷髏沒有的行為，混進 `Mob` 會把 `ranged`／`attackCooldown` 等欄位塞成多義。
- **引信需要連續視線**：每一步都檢查 LOS，中斷即取消（原版明文）。
- **取消距離 7 格**（2026-10-20 稽核修正：原計畫寫「10 格 ＝ 觸發距離 3 ＋ wiki 的『玩家必須移動 7 格』」——那是**把兩個數字相加的誤推**；vanilla `SwellGoal#tick` 的常數是 `distanceToSqr(target) > 49.0` → **取消門檻就是 7 格本身**，且是**嚴格大於**才取消）。原版原始碼的出處見〈已查證與設計決策〉§1。
- 苦力怕**白天不燃燒**：它不在 B4 的 `stepSunBurn` 管轄範圍（該函式只對 `kind === 'zombie' | 'skeleton'` 生效）→ 天然滿足 spec §B9。
- 引信中**停止移動**（原文明文 "stops moving"）；但仍套重力與著地（不會浮空）。

- [ ] **Step 1: 寫測試（失敗）**

`src/world/creeper.test.ts`（新檔）：

- `'the creeper table matches the vanilla stats'`：
  ```ts
  expect(CREEPER_HP).toBe(20);
  expect(CREEPER_WIDTH).toBe(0.6);
  expect(CREEPER_HEIGHT).toBe(1.7);
  expect(CREEPER_FUSE_SEC).toBe(1.5);
  expect(CREEPER_TRIGGER_DIST).toBe(3);
  expect(CREEPER_CANCEL_DIST).toBe(7);   // vanilla SwellGoal#tick：distanceToSqr > 49.0（7 格）
  ```
- `'a creeper starts its fuse within three blocks of the player'`：`createCreeper({x:0,y:6,z:0})`，玩家在 `(2, 6, 0)`（距離 2 ≤ 3）且 `hasLineOfSight` 回 true → 步進一次（dt 0.1）→ `state === 'fuse'`、`fuse` 接近 1.5（`toBeLessThan(1.5)` 且 `toBeGreaterThan(1.3)`）。
- `'a creeper does not start its fuse beyond three blocks'`：玩家在 `(5, 6, 0)`（距離 5）→ `state !== 'fuse'`、`fuse === 0`。
- `'a creeper does not start its fuse without line of sight'`：玩家在 `(2, 6, 0)` 但 `hasLineOfSight` 回 false → `state !== 'fuse'`。
- `'the fuse expires after one and a half seconds and emits an explosion'`（2026-10-20 稽核修正：原寫「步進總共 1.5 秒（dt 0.05 × 30 次）」——但**開始引信的那一幀不倒數引信**，所以 30 幀只累積 29 次倒數 → 引信還沒歸零 → 不會爆炸。釘死成：**第 1 幀**開始引信（`fuse === 1.5`）、**之後 30 幀**（dt 0.05）才引爆，合計 **31 幀**）：
  ```ts
  const c = createCreeper({ x: 0, y: 6, z: 0 });
  const ctx = { playerPos: { x: 2, y: 6, z: 0 }, isSolidAt: () => false, hasLineOfSight: () => true, dt: 0.05 };
  let s = c; let events: CreeperEvent[] = [];
  for (let i = 0; i < 30; i++) { const r = stepCreeper(s, ctx); s = r.creeper; events = events.concat(r.events); }
  expect(events).toHaveLength(0);          // 29 次倒數 → fuse 還剩 0.05
  const last = stepCreeper(s, ctx);        // 第 30 次倒數 → 引爆
  expect(last.events).toHaveLength(1);
  expect(last.events[0]).toEqual({ type: 'explode', creeperId: c.id, at: { x: 0, y: 6, z: 0 } });
  ```
- `'an exploded creeper does not explode again'`（2026-10-20 稽核修正：**引信狀態機沒有終態的缺陷**。原計畫在 `fuse <= 0` 時只「產生事件並把 fuse 夾在 0」→ 下一幀 `fuse -= step` 仍 ≤ 0 → **再發一次事件**；Task 8 不消費事件、Task 9 才移除實體，中間會一直噴事件）：
  ```ts
  const after = stepCreeper(explodedCreeper, ctx);
  expect(after.events).toHaveLength(0);
  expect(after.creeper.state).toBe('exploded');
  ```
  （`explodedCreeper` ＝ 上一步引爆後的物件。）
- `'the fuse is cancelled when the player walks away'`：引信開始後把玩家移到 **8 格**外（`> CREEPER_CANCEL_DIST = 7`）→ 步進一步 → `state === 'chase'`、`fuse === 0`、**沒有** explosion 事件。
- `'the fuse keeps running at exactly the cancel distance'`（vanilla 是**嚴格大於** 7 格才取消）：玩家在**剛好 7 格**（三維距離 7）→ 步進一步 → 引信**不**被取消（`state === 'fuse'`）。
- `'the fuse is cancelled when the line of sight breaks'`：引信開始後把 `hasLineOfSight` 改成回 false → 步進一步 → `fuse === 0`、沒有 explosion 事件。
- `'a fusing creeper stops moving'`：引信中步進 0.5 秒 → `pos` 的水平位置不變（`toBeCloseTo`）。
- `'a chasing creeper moves toward the player'`：玩家在 10 格外 → 步進 0.5 秒 → 距離縮短（`xzDistance` 減少）。
- `'a creeper wanders when the player is far away'`：玩家在 40 格外 → 步進 1 秒 → 位置有變化且 `state === 'wander'`。
- `'a damaged creeper has less hp'`：`damageCreeper(c, 5)` → `hp === 15`；`damageCreeper(c, -1)` → `hp` 不變（NaN 防護）。
- `'a dead creeper is detected'`：`damageCreeper(c, 999)` → `isCreeperDead(c)` 為 true。
- `'the crosshair hits a creeper'`：`hitCreeperId([creeper], {x:0,y:0.9,z:5}, {x:0,y:0,z:-1}, 10)` → 苦力怕的 id。
- `'attacking reduces hp and reports the hit'`：`attackCreeper([creeper], eye, dir, 10, 3, {x:0,z:-1})` → `hitId` 非 null、`creepers[0].hp` 減少 3。
- `'non-finite dt is treated as zero'`：步進 `dt: NaN` → 位置不變、無 NaN。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/world/creeper.test.ts` → FAIL（模組不存在）。

- [ ] **Step 3: 實作 `src/world/creeper.ts`**

- 常數如上表（每個常數的註解要寫「原版值 + wiki 出處」）。
- `Creeper` 介面如上；`createCreeper(pos, rng = Math.random)`：`id` 用模組層級遞增計數器（比照 `mobs.ts` 的 `nextMobId`）、`hp = CREEPER_HP`、**`wanderDir = rng() * Math.PI * 2`**（2026-10-20 稽核修正：原計畫寫 `wanderDir = rng()` → 0..1 弧度 → 所有漫遊中的苦力怕只往同一個窄扇形飄；現況 `mobs.ts` 的慣例是 `Math.random() * Math.PI * 2`）、`wanderTimer = 2 + rng() × 2`、`kbVel = {x:0,z:0}`。
- `stepCreeper(c, ctx)`（回傳新物件 + 事件）：
  1. `step` = 有限正 dt，否則 0。
  2. 計算到玩家的 3D 距離 `dist3` 與水平距離 `distXZ`。
  3. **狀態機**：
     - `state === 'exploded'`（**終態**）：直接回傳 `{ creeper: c, events: [] }` —— **不再倒數、不再產生事件**（2026-10-20 稽核修正：原計畫沒有終態 → 引信歸零後每一步都會再發一次 explode 事件）。
     - `state === 'fuse'`：先檢查取消條件——`dist3 > CREEPER_CANCEL_DIST`（**嚴格大於 7 格**）或 `!ctx.hasLineOfSight(creeperEye, playerEye)` → 取消（`state = 'chase'`、`fuse = 0`）。否則 `fuse -= step`；`fuse <= 0` → 產生 `{ type: 'explode', creeperId: c.id, at: { ...c.pos } }` 事件、**`state = 'exploded'`、`fuse = 0`**（**事件的處理（移除實體、不掉落）在 main.ts**，見 Task 9）。此分支**不移動**。
       （**開始引信的那一幀不倒數引信**：`fuse` 從 1.5 開始，下一幀才 `fuse -= step` → 引信總長＝1.5 秒 ＝ 30 幀（dt 0.05）。
        **浮點抖動註記**：以 `fuse -= step` 累減時，dt 網格不同會讓引爆落在第 30 或第 31 幀（例：dt 0.05 × 30 → `fuse = -7.6e-16` → 第 30 幀引爆；dt 0.025 × 60 → 累積誤差 `+1.1e-15` → 第 61 幀才引爆）→ 引信長度會有 ±1 幀（±0.05 秒）的抖動。**這是可接受的**（原版是整數 tick），但要在註解寫明，避免日後被當成 bug 追查；測試一律用 dt 0.05 釘死。）
     - 否則（未引信）：`distXZ <= 16`（沿用 `CHASE_RANGE`）→ `state = 'chase'`；否則 `state = 'wander'`。在 `chase` 狀態下，若 `dist3 < CREEPER_TRIGGER_DIST`（vanilla 是**嚴格小於** 3 格）且 `ctx.hasLineOfSight(creeperEye, playerEye)` → 開始引信：`state = 'fuse'`、`fuse = CREEPER_FUSE_SEC`、`fuseTotal = CREEPER_FUSE_SEC`（並停止移動）。
  4. **移動**（只在非 fuse 狀態）：chase → 朝玩家水平方向 `CREEPER_CHASE_SPEED`；wander → `wanderDir` ＋ `CREEPER_WANDER_SPEED`，`wanderTimer <= 0` 時換方向（rng）。前方探測（比照 `mobs.ts` 的 `PROBE_LEAD` 與腳／頭兩點）被擋 → 停下；腳被擋且著地 → 施加 `JUMP_IMPULSE`（跨 1 格台階）。
  5. **重力與著地**：比照 `mobs.ts`（重力 32、落地掃描貼合頂面）。
  6. **擊退**：`kbVel` 與 `mobs.ts` 同規則（衰減 `0.1^dt`、低於 0.1 歸零、撞牆不嵌入）。
  7. 回傳 `{ creeper: { ...c, pos, vel, state, fuse, fuseTotal, wanderDir, wanderTimer, target, kbVel }, events }`。
- `damageCreeper(c, dmg, from?)`：hp 夾在 0；`from` 存在時把 `kbVel` 沿「背離攻擊者」方向加 `KNOCKBACK_SPEED`（沿用 `mobs.ts` 的常數與正規化寫法）。
- `hitCreeperId`／`attackCreeper`：命中盒＝X/Z ± `CREEPER_WIDTH/2`、Y 從腳到 `CREEPER_HEIGHT`；用 `rayAabbEntry`（B4 已把它搬到 `src/world/raycast.ts`）→ **重用，不重新實作**。
- `creeperFuseProgress(c)`：`c.fuseTotal > 0 ? 1 - c.fuse / c.fuseTotal : 0`（夾在 0..1）。

- [ ] **Step 4: 跑測試轉綠**

Run: `npx vitest run src/world/creeper.test.ts` → PASS。

- [ ] **Step 5: 全量 gates**

Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 6: Commit**

```bash
git add src/world/creeper.ts src/world/creeper.test.ts
git commit -m "feat(mobs): B9 苦力怕實體與引信 AI（HP20／1.5 秒引信／視線與距離可取消）"
```

---

### Task 5: 玩家的爆炸擊退通道（`physics.ts` 加 `kbVel`）

**Files:**
- Modify: `src/player/physics.ts`（`PlayerState` 加 `kbVel`；`stepOnce` 套用與衰減；`moveAxis` 碰撞時清零）
- Test: `src/player/physics.test.ts`

**Interfaces:**
- Consumes: 既有 `PlayerState`／`stepPlayer`／`moveAxis`。
- Produces:
  - `PlayerState` 新欄位 `kbVel: { x: number; y: number; z: number }`（外部衝擊通道；`createPlayer` 初始化為 0）。
  - `export function applyKnockback(p: PlayerState, v: { x: number; y: number; z: number }): void`（把外部衝擊**疊加**到 `p.kbVel`；`main.ts` 的爆炸用這個入口）。
  - `export const KNOCKBACK_DECAY_PER_SEC = 0.1;`（與 `mobs.ts` 同值）。

**設計決策（要寫進註解）**：
- 為什麼要動 `physics.ts`：`stepOnce` 每幀都會用輸入覆寫 `p.velocity.x/z`，所以外部擊退若只寫 `velocity` 會在下一幀被抹掉。`mobs.ts` 早就有 `kbVel` 的同一套慣例 → 玩家端沿用同一設計（一致性）。
- 衰減率與怪物一致（`0.1^dt`，即每秒剩下 10%），撞牆時該軸的 `kbVel` 歸零（撞牆即停，不會一直往牆裡頂）。

- [ ] **Step 1: 寫測試（失敗）**

`src/player/physics.test.ts`：
- `'a new player has no knockback velocity'`：`createPlayer(0, 10, 0).kbVel` → `{ x: 0, y: 0, z: 0 }`。
- `'an external impulse moves the player and decays'`：
  ```ts
  const p = createPlayer(0, 10, 0);
  applyKnockback(p, { x: 6, y: 0, z: 0 });
  stepPlayer(p, idleInput(), world, 0.1);
  expect(p.position.x).toBeGreaterThan(0.5);          // 被推開
  const before = p.kbVel.x;
  stepPlayer(p, idleInput(), world, 0.5);
  expect(p.kbVel.x).toBeLessThan(before);               // 會衰減
  ```
- `'the knockback stops at a wall'`：造一面 x = 1 的牆，給玩家 `applyKnockback(p, { x: 20, y: 0, z: 0 })` → 步進後玩家**沒有**穿進牆裡（`p.position.x < 1`），且 `p.kbVel.x` 被清成 0。
- `'the knockback does not NaN the position'`：`applyKnockback(p, { x: NaN, y: 0, z: 0 })` → 步進後 `Number.isFinite(p.position.x)` 為 true。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/player/physics.test.ts` → FAIL（`applyKnockback` 不存在、`kbVel` 缺欄位）。

- [ ] **Step 3: 實作 `src/player/physics.ts`**

- `PlayerState` 加 `kbVel: { x: number; y: number; z: number }`；`createPlayer` 初始化 `{ x: 0, y: 0, z: 0 }`。
- `applyKnockback(p, v)`：非有限的分量忽略；其餘**疊加**到 `p.kbVel`。
- `stepOnce`：
  - 位移改為 `moveAxis(p, world, 'x', (p.velocity.x + p.kbVel.x) * step)`、同理 `z`；垂直用 `(p.velocity.y + p.kbVel.y) * step`。
  - 衰減：`const decay = Math.pow(KNOCKBACK_DECAY_PER_SEC, step); p.kbVel.x *= decay; p.kbVel.y *= decay; p.kbVel.z *= decay;`（`|kbVel| < 0.1` 的分量歸零，照 `mobs.ts` 的 `KNOCKBACK_MIN` 慣例）。
- `moveAxis`：某軸發生碰撞時（既有 `p.velocity[axis] = 0` 的地方）**同時**把 `p.kbVel[axis] = 0`。
- 檔頭註解補一句：為什麼玩家需要一條獨立的擊退通道。

- [ ] **Step 4: 跑測試轉綠**

Run: `npx vitest run src/player/physics.test.ts` → PASS。

- [ ] **Step 5: 全量 gates**

Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 6: Commit**

```bash
git add src/player/physics.ts src/player/physics.test.ts
git commit -m "feat(player): B9 玩家加入外部擊退通道（爆炸擊退用）"
```

---

### Task 6: 蜘蛛實體、中立判準與攀牆 AI

**Files:**
- Create: `src/world/spider.ts`、`src/world/spider.test.ts`

**Interfaces:**
- Consumes: `src/world/spawn-rules.ts` 的 `SpawnLight`（B6：`sky` 客戶端天空光／`internalSky` 內部天空光／`block` 方塊光）；`src/world/mobs.ts` 的 `hasLineOfSight`／`MOB_GRAVITY`／`JUMP_IMPULSE`／`KNOCKBACK_*` 慣例；`src/world/raycast.ts` 的 `rayAabbEntry`（B4 搬出的）。
- Produces:
  ```ts
  export const SPIDER_HP = 16;
  export const SPIDER_WIDTH = 1.4;
  export const SPIDER_HEIGHT = 0.9;
  export const SPIDER_CHASE_SPEED = 4.0;
  export const SPIDER_WANDER_SPEED = 1.5;
  export const SPIDER_ATTACK_DAMAGE = 2;
  export const SPIDER_ATTACK_COOLDOWN = 1.0;
  export const SPIDER_ATTACK_RANGE = 1.6;
  /** 敵對門檻：亮度 **≤ 11 → 敵對**、≥ 12 → 中立（2026-10-20 稽核修正：原名 `SPIDER_NEUTRAL_LIGHT` **方向講反了** —— 這個值是「敵對門檻」不是「中立門檻」；改成 `SPIDER_HOSTILE_LIGHT_MAX`）。 */
  export const SPIDER_HOSTILE_LIGHT_MAX = 11;
  export const SPIDER_DETECT_RANGE = 16;
  export const SPIDER_CLIMB_SPEED = 2.0;
  export const SPIDER_MAX_CLIMB = 3;
  export type SpiderState = 'wander' | 'chase' | 'climb';
  export interface Spider {
    id: number; hp: number;
    pos: { x: number; y: number; z: number };
    vel: { x: number; y: number; z: number };
    state: SpiderState;
    angry: boolean;                 // 被玩家攻擊過 → 不再因亮度中立
    wanderDir: number; wanderTimer: number;
    target: { x: number; y: number; z: number } | null;
    kbVel: { x: number; z: number };
    climbHeight: number;            // 本次攀爬已上升的距離
    /** 攀爬時貼牆的**水平法線（指向牆面）**（2026-10-20 稽核修正：同一欄位在介面與實作裡原本寫了兩種語意 ——「水平法線（朝牆）」vs「水平方向」→ 統一成前者）。 */
    climbDir: { x: number; z: number };
  }
  export interface SpiderCtx {
    playerPos: { x: number; y: number; z: number };
    isSolidAt: (x: number, y: number, z: number) => boolean;
    hasLineOfSight: (from: {x,y,z}, to: {x,y,z}) => boolean;
    lightAt: (x: number, y: number, z: number) => SpawnLight;  // B6 的 spawnLightAt
    dt: number;
    rng?: () => number;
  }
  export type SpiderEvent = { type: 'damage'; target: 'player'; amount: number; spiderId: number };
  export function createSpider(pos: { x: number; y: number; z: number }, rng?: () => number): Spider;
  export function stepSpider(s: Spider, ctx: SpiderCtx): { spider: Spider; events: SpiderEvent[] };
  export function stepSpiders(list: readonly Spider[], ctx: SpiderCtx): { spiders: Spider[]; events: SpiderEvent[] };
  export function damageSpider(s: Spider, dmg: number, from?: { x: number; z: number }): Spider;
  export function isSpiderDead(s: Spider): boolean;
  export function hitSpiderId(spiders: readonly Spider[], eye, lookDir, reach): number | null;
  export function attackSpider(spiders: readonly Spider[], eye, lookDir, reach, damage, knockDir): { spiders: Spider[]; hitId: number | null };
  export function spiderAggression(light: SpawnLight): 'hostile' | 'neutral';
  ```

**已查證數值（wiki，2026-10-20）**：HP 16、碰撞盒 0.9×1.4、速度屬性 0.3、攻擊 2（Normal）、敵對亮度門檻 ≤ 11、察覺距離 16 格、可隔牆察覺玩家、被攻擊後不論亮度都追擊。

**設計決策（要寫進註解）**：
- **中立判準吃的是 B6 的「內部天空光」**：白天地表的客戶端天空光是 15（時間無關），但原版的「亮度」在夜間會下降 → 用 `Math.max(light.internalSky, light.block) <= 11`。這樣：白天開闊地表（internalSky 15）→ 中立；午夜地表（internalSky 4）→ 敵對；火把旁（block 13/14）→ 中立；洞穴（0）→ 敵對。**與 B6 的 `canSpawnPassive` 用客戶端天空光、`canSpawnHostile` 用內部天空光是同一套判準分工**。
- **察覺不要求視線**：原版明文「A spider pursuing a player can detect a player through blocks」→ 蜘蛛在 16 格內就會察覺（其他生物仍需要 LOS）。
- **速度 4.0 格/秒**：原版屬性 0.3 對殭屍 0.23 ≈ 1.30 倍；本作殭屍 3.2 → 3.2 × 1.30 ≈ 4.17，取 4.0。
- **攀牆釘死做法**見〈已查證與設計決策〉§6（2026-10-20 稽核修正後的版本）：只在 `chase` 狀態、正前方是實心柱、且「**障礙頂面 − 腳底 ≤ `SPIDER_MAX_CLIMB`**」時爬；爬到頂就登台（腳底對齊到障礙頂面），超過 3 格就不爬。**攀爬分支跳過重力與著地吸附**（否則每幀被拉回地面、永遠爬不上去）。
- **蜘蛛不白天燃燒**（不是不死系）→ 不進 B4 的 `stepSunBurn`。

- [ ] **Step 1: 寫測試（失敗）**

`src/world/spider.test.ts`（新檔）：

- `'the spider table matches the vanilla stats'`：
  ```ts
  expect(SPIDER_HP).toBe(16);
  expect(SPIDER_WIDTH).toBe(1.4);
  expect(SPIDER_HEIGHT).toBe(0.9);
  expect(SPIDER_CHASE_SPEED).toBe(4.0);
  expect(SPIDER_ATTACK_DAMAGE).toBe(2);
  expect(SPIDER_HOSTILE_LIGHT_MAX).toBe(11);
  expect(SPIDER_DETECT_RANGE).toBe(16);
  ```
- `'the aggression threshold is the vanilla light level 11'`：
  ```ts
  expect(spiderAggression({ sky: 15, internalSky: 4, block: 0 })).toBe('hostile');   // 夜晚地表
  expect(spiderAggression({ sky: 15, internalSky: 15, block: 0 })).toBe('neutral');  // 白天地表
  expect(spiderAggression({ sky: 0, internalSky: 0, block: 13 })).toBe('neutral');  // 火把旁
  expect(spiderAggression({ sky: 0, internalSky: 0, block: 0 })).toBe('hostile');   // 洞穴
  expect(spiderAggression({ sky: 0, internalSky: 11, block: 0 })).toBe('hostile');
  expect(spiderAggression({ sky: 0, internalSky: 12, block: 0 })).toBe('neutral');
  ```
- `'a spider in daylight does not chase the player'`：`lightAt` 回 `{ sky: 15, internalSky: 15, block: 0 }`，玩家在 5 格外 → 步進 1 秒 → `state === 'wander'`，且到玩家的距離沒有縮短。
- `'a spider in the dark chases the player'`：`lightAt` 回 `{ sky: 0, internalSky: 0, block: 0 }`，玩家在 8 格外 → 步進 0.5 秒 → `state === 'chase'` 且距離縮短。
- `'a spider keeps chasing after being hit even in daylight'`：`damageSpider(s, 1)` → `angry === true`；接著用白天光照步進 → `state === 'chase'`。
- `'a spider bites the player in reach'`：黑暗、玩家在 1 格內 → 步進 → 產生一個 `{ type: 'damage', amount: 2 }` 事件；再步進 0.5 秒（冷卻中）→ **不**再產生事件。
- `'a spider does not bite through a wall'`：`hasLineOfSight` 回 false → 無 damage 事件。
- **攀牆三個案例（2026-10-20 稽核修正：共用同一個假世界 fixture —— 地面 y ≤ 5 實心；牆柱在 x = 3、從 y = 6 起往上連續實心；蜘蛛站在 x = 2.5、腳底 y = 6；玩家在牆後 x = 6、`lightAt` 黑暗）**：
  ```ts
  const world = (wallTop: number) => ({
    isSolidAt: (x: number, y: number) => y <= 5 || (x === 3 && y >= 6 && y <= wallTop),
  });
  ```
  - `'a spider climbs a two-block wall while chasing'`（牆頂實心格 y = 7 → 頂面 y = 8）：步進 2 秒 → 蜘蛛**登上牆頂**：`pos.y === 8`（腳底正好在牆頂面）、`state === 'chase'`。
    （**2026-10-20 稽核修正：原斷言只要求「`pos.y` 上升至少 1 格」→ 抓不到「攀爬被重力拉回地面」與「登頂對齊差 0.9 格」兩個缺陷**；改成斷言**確切**的 `pos.y === 8`。）
  - `'a spider climbs a three-block wall while chasing'`（牆頂實心格 y = 8 → 頂面 y = 9）：步進 3 秒 → `pos.y === 9`、`state === 'chase'`。
    （**2026-10-20 稽核修正：§6 的決策是「頂端 ≤ 3 格可爬」→ 3 格牆必須能爬**；原計畫的實作規則「從腳底往上數最多 3 格，若其中任一格不實心 → 可爬」會把 3 格牆判成不可爬，兩處互相矛盾。這一則是釘死統一後的規則。）
  - `'a spider does not climb a wall taller than three blocks'`（牆頂實心格 y = 9 → 頂面 y = 10，障礙高 4 > 3）：步進 3 秒 → **沒有進入 climb**：`pos.y` 仍是 6、`climbHeight === 0`、`state === 'chase'`。
    （**2026-10-20 稽核修正：原斷言只看「`climbHeight` ≤ 3 且 state 回 chase」→ 一個「爬了 3 格才放棄」的實作也會過，測不出「根本不该爬」**；改成斷言 `pos.y` 完全沒變。）
  - `'a wandering spider does not climb'`：玩家在 40 格外（蜘蛛不追）＋前方有牆 → 步進 2 秒 → `pos.y` 不變。
- `'a damaged spider has less hp'`：`damageSpider(s, 4)` → `hp === 12`；`damageSpider(s, -1)` → hp 不變。
- `'the crosshair hits a spider'`：`hitSpiderId([spider], {x:0,y:0.45,z:5}, {x:0,y:0,z:-1}, 10)` → 蜘蛛的 id（蜘蛛只有 0.9 高，射線高度要對）。
- `'non-finite dt is treated as zero'`：位置不變、無 NaN。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/world/spider.test.ts` → FAIL（模組不存在）。

- [ ] **Step 3: 實作 `src/world/spider.ts`**

- 常數如上（每個常數註「原版值 + 出處」或「本作換算 + 理由」）。
- `createSpider(pos, rng = Math.random)`：`id` 模組層級遞增、`hp = SPIDER_HP`、`angry = false`、**`wanderDir = rng() * Math.PI * 2`**（2026-10-20 稽核修正：原計畫寫 `wanderDir = rng()` → 0..1 弧度 → 漫遊中的蜘蛛只往同一個窄扇形飄；現況 `mobs.ts` 的慣例是 `Math.random() * Math.PI * 2`）、`wanderTimer = 2 + rng() × 2`、`kbVel = {x:0,z:0}`、`climbHeight = 0`。
- `spiderAggression(light)`：`Math.max(light.internalSky, light.block) <= SPIDER_HOSTILE_LIGHT_MAX ? 'hostile' : 'neutral'`。
- `stepSpider(s, ctx)`（回傳新物件 + 事件）：
  1. `step` = 有限正 dt，否則 0。
  2. `light = ctx.lightAt(floor(pos.x), floor(pos.y), floor(pos.z))`；`hostile = s.angry || spiderAggression(light) === 'hostile'`。
  3. **狀態機**：
     - `state === 'climb'`：**純垂直上升** `pos.y += SPIDER_CLIMB_SPEED * step`（不水平移動），`climbHeight += SPIDER_CLIMB_SPEED * step`；若頭部格（`floor(pos.y + SPIDER_HEIGHT + 0.1)`）在**障礙柱**上不再實心 → 登頂：**`pos.y = Math.floor(pos.y + SPIDER_HEIGHT) + 1`**（腳底對齊到障礙頂面；**2026-10-20 稽核修正：原公式多了 `- SPIDER_HEIGHT` → 腳底落在牆頂面下方 0.9 格、身體嵌在牆裡**）、`state = 'chase'`、`climbHeight = 0`；若 `climbHeight > SPIDER_MAX_CLIMB` → 放棄：`state = 'chase'`、`climbHeight = 0`。**此分支不做攻擊、不做水平移動**。
       **並且：這個分支「不套重力、也不跑落地掃描」**（2026-10-20 稽核修正：原計畫同一句既寫「純垂直上升」又寫「仍套重力與著地」——現況 `mobs.ts` 的落地掃描條件是 `vel.y <= 0`，蜘蛛在牆邊上升時 `vel.y` 為 0 或負 → 掃描把 `pos.y` 吸附回腳下的地面（`pos.y = cy + 1`）→ **每幀被拉回地面，高度永遠不變**，計畫自己的測試必然失敗）。→ 實作上把重力／著地那段**放在 `state !== 'climb'` 的分支裡**；`climb` 分支結束（登頂／放棄）後的下一幀才恢復重力與著地。
  4. **移動**（`chase`／`wander`）：
     - `chase` → 朝玩家水平方向 `SPIDER_CHASE_SPEED`；`wander` → `wanderDir` ＋ `SPIDER_WANDER_SPEED`（換方向同 `mobs.ts` 的 2–4 秒計時）。
     - 前方探測（比照 `mobs.ts` 的 `PROBE_LEAD`）：若**腳部格**被擋 → 若 `state === 'chase'` 且著地 → 計算**正前方那一格（障礙柱）的障礙頂面**（有界掃描：從 `floor(腳底)` 起往上 4 格；4 格全實心 → 太高不可爬；否則第一個非實心格的 `y` 就是頂面）→ **若 `頂面 − 腳底 ≤ SPIDER_MAX_CLIMB` → 進入 `climb`**（記 `climbDir` 為指向牆面的水平法線、清除水平速度、跳過本幀水平位移）；否則停下並在著地時給 `JUMP_IMPULSE`（跨 1 格台階）。
       （**2026-10-20 稽核修正：規則統一成「障礙頂面 − 腳底 ≤ 3 → 可爬」**；原計畫寫「從腳底往上數最多 3 格，若其中任一格不實心 → 可爬」→ **規則相反**，會把 3 格牆判成不可爬，與 §6 的決策矛盾。）
  5. **攻擊**（僅 `state === 'chase'`）：3D 距離 ≤ `SPIDER_ATTACK_RANGE` 且冷卻 ≤ 0 且 `ctx.hasLineOfSight(spiderEye, playerEye)` → 產生 `{ type: 'damage', target: 'player', amount: SPIDER_ATTACK_DAMAGE, spiderId: s.id }`，冷卻設為 `SPIDER_ATTACK_COOLDOWN`。
  6. **重力與著地**、**擊退**（`kbVel`）：完全比照 `mobs.ts` 的寫法與常數；**但 `state === 'climb'` 時整段跳過**（見第 3 點）。
  7. 回傳新物件（不改輸入）。
- `damageSpider(s, dmg, from?)`：hp 夾在 0、**`angry = true`**、`from` 存在時給 `kbVel` 加上背離方向的 `KNOCKBACK_SPEED`。
- `hitSpiderId`／`attackSpider`：命中盒＝X/Z ± `SPIDER_WIDTH/2`、Y 從腳到 `SPIDER_HEIGHT`；用 `rayAabbEntry`。

- [ ] **Step 4: 跑測試轉綠**

Run: `npx vitest run src/world/spider.test.ts` → PASS。

- [ ] **Step 5: 全量 gates**

Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 6: Commit**

```bash
git add src/world/spider.ts src/world/spider.test.ts
git commit -m "feat(mobs): B9 蜘蛛實體（HP16／亮度 ≤11 敵對／攀牆 3 格上限）"
```

---

### Task 7: 統一生怪分配器（四種敵對、權重、上限、光照判準）

**Files:**
- Create: `src/world/b9-spawn.ts`、`src/world/b9-spawn.test.ts`
- Modify: `src/world/mobs.ts`（移除 `trySpawnMob`／`chooseSpawnKind`，其測試搬去 `b9-spawn.test.ts`）
- Test: `src/world/mobs.test.ts`（既有測試搬移／改寫）、`src/world/b9-spawn.test.ts`

**Interfaces:**
- Consumes: B4 的 `createMob`／`findSpawnPos`／`surfaceYAt`／`MAX_MOBS`／`xzDistance`（**全部沿用，不重新實作**）；B6 的 `canSpawnHostile`／`SpawnLight`；Task 4 的 `createCreeper`；Task 6 的 `createSpider`。
- Produces:
  ```ts
  export type HostileKind = 'zombie' | 'skeleton' | 'creeper' | 'spider';
  export const HOSTILE_SPAWN_WEIGHTS: Readonly<Record<HostileKind, number>> =
    { zombie: 100, skeleton: 100, creeper: 100, spider: 100 };
  export const MAX_CREEPERS = 4;            // 本批自訂的苦力怕子上限
  export interface HostileSpawnCtx {
    lightAt: (x: number, y: number, z: number) => SpawnLight;   // B6 的 spawnLightAt
    isSolidAt: (x: number, y: number, z: number) => boolean;
    blockIdAt: (x: number, y: number, z: number) => number;
    rng?: () => number;
  }
  export interface HostileCounts { mobs: number; creepers: number; spiders: number }
  export interface HostileSpawn {
    kind: HostileKind;
    mob: Mob | null; creeper: Creeper | null; spider: Spider | null;
  }
  export function chooseHostileKind(rng?: () => number): HostileKind;
  export function trySpawnHostile(counts: HostileCounts, playerPos: {x,y,z}, ctx: HostileSpawnCtx): HostileSpawn | null;
  ```

**已查證數值（wiki，2026-10-20）**：四種敵對的生成權重都是 100（⇒ 各 25%）；生成需要亮度 0（沿用 B6 的 `canSpawnHostile`）；生成距離 24–128；Java 版成群 4 隻（本作沿用 B4 的每 5 秒 1 隻 → **簡化**）。

**設計決策（要寫進註解）**：
- **為什麼要一個新的分配器**：B4 的 `trySpawnMob` 內部固定抽「殭屍／骷髏 50/50」，若只在外面加判斷，就會出現兩條生怪路徑各自抽權重（總體機率錯亂）。新的 `trySpawnHostile` 是**唯一**的敵對生怪入口，四種生物一起抽權重。
- **B4 的 `trySpawnMob`／`chooseSpawnKind` 被移除**（不是重定義，是被取代）：其測試案例**搬到** `b9-spawn.test.ts`（同一批斷言、同一批意圖），並在 commit 訊息說明「移動不是弱化」。`createMob`／`findSpawnPos`／`surfaceYAt`／`MAX_MOBS`／`xzDistance` 全部保留不動。
- **子上限 4 隻苦力怕**：理由見〈已查證與設計決策〉§4；上限用「先抽種類、抽到苦力怕但已達上限就重抽（最多重抽 4 次，仍是苦力怕就放棄該次生成）」實作。
- **總上限沿用 `MAX_MOBS = 12`**（B4 已把它從 8 調到 12），計數＝`mobs.length + creepers.length + spiders.length` → 不另立常數。

- [ ] **Step 1: 寫測試（失敗）**

`src/world/b9-spawn.test.ts`（新檔）：

- `'the spawn weights are the vanilla ones'`：`expect(HOSTILE_SPAWN_WEIGHTS).toEqual({ zombie: 100, skeleton: 100, creeper: 100, spider: 100 });`
- `'every hostile kind is equally likely'`：注入 rng 恆 0.1／0.4／0.6／0.9 → 四次呼叫分別得到四種不同的 kind；再跑 400 次（rng 依序回傳 `i / 400`）→ 四種的出現次數各在 80–120 之間（**固定種子的統計測試，明確容差**）。
- `'a hostile mob does not spawn in daylight'`：`lightAt` 回 `{ sky: 15, internalSky: 15, block: 0 }` → `trySpawnHostile` 回 null。
- `'a hostile mob spawns in the dark'`：`lightAt` 回 `{ sky: 0, internalSky: 0, block: 0 }` → 回一個 `HostileSpawn`（非 null）。
- `'a torch beside the spawn point blocks the spawn'`：`lightAt` 回 `{ sky: 0, internalSky: 0, block: 1 }` → null（B6 判準）。
- `'the global hostile cap is twelve'`：`counts = { mobs: 12, creepers: 0, spiders: 0 }` → null；`{ mobs: 11, creepers: 0, spiders: 0 }` → 非 null。
- `'the creeper sub cap is four'`（2026-10-20 稽核修正：**斷言式寫法**。原計畫寫 `expect(result?.creeper).toBeNull()` —— 但 Task 7 Step 3 第 5 點明講「4 次都抽到 creeper → **回 null**」；`result === null` 時 `result?.creeper` 是 `undefined`，而 **`toBeNull()` 不接受 `undefined`** → 該測試必紅。**兩種結果都合法**（抽到其他種類 → 生成那一種；4 次都抽到 creeper → 整次跳過回 null）→ 斷言要涵蓋兩者）：
  ```ts
  const result = trySpawnHostile({ mobs: 0, creepers: 4, spiders: 0 }, playerPos, ctxWithCreepers);
  expect(result === null || result.creeper === null).toBe(true);
  ```
  （`result` 非 null 時，另外斷言 `result.kind !== 'creeper'`。）
- `'a spawned hostile is 24 to 128 blocks from the player'`：跑 30 次生成，逐一斷言 `xzDistance(spawn.pos, player)` ∈ [24, 128]。
- `'the spawned kind matches the returned payload'`（2026-10-20 稽核修正：**rng → 種類的對應被寫錯了**。實作強制走 `HOSTILE_SPAWN_WEIGHTS` 的**累積權重**抽籤，而**權重表的鍵序＝累積順序**（zombie → skeleton → creeper → spider，各 100）→ rng 0.1／0.4／0.6／0.9 依序落在四個等分區間：0.1→zombie、**0.4→skeleton**、**0.6→creeper**、0.9→spider。原計畫寫「0.4 → creeper、0.6 → spider」→ **必紅**，實作者要嘛改權重順序（破壞 `HOSTILE_SPAWN_WEIGHTS` 的語意）、要嘛改測試期望（等於弱化釘死））：
  ```ts
  expect(chooseHostileKind(() => 0.1)).toBe('zombie');
  expect(chooseHostileKind(() => 0.4)).toBe('skeleton');
  expect(chooseHostileKind(() => 0.6)).toBe('creeper');
  expect(chooseHostileKind(() => 0.9)).toBe('spider');
  ```
  （測試旁要寫明「**權重表鍵序＝累積順序**」。）
  **同一則測試也要覆蓋「payload 與 kind 一致」**：用一個依序回傳 `[0.1, 0.5, 0.6]` 的 rng（角度 0.1、距離 0.5、**種類 0.6 → creeper**）→
  ```ts
  const res = trySpawnHostile({ mobs: 0, creepers: 0, spiders: 0 }, playerPos, { ...fixture, rng: seq([0.1, 0.5, 0.6]) })!;
  expect(res.kind).toBe('creeper');
  expect(res.creeper).not.toBeNull();
  expect(res.mob).toBeNull();
  expect(res.spider).toBeNull();
  ```
  （`seq(...)` 是測試端的小helper：依序回傳陣列裡的值，用完後重複最後一個值。）
- `'a hostile spawns on a solid surface'`：假世界地面在 y = 5（`isSolidAt` 在 y ≤ 5 為 true、`blockIdAt` 回 `BLOCK.GRASS`）→ 生成點的 `pos.y === 6`。
- **共用 fixture（2026-10-20 稽核修正：原文沒有寫死 rng 來源與假世界，測試會不穩）**：
  - **rng 來源**：`trySpawnHostile` 內部用 `ctx.rng ?? Math.random`（`HostileSpawnCtx.rng` 是**選填**）→ 測試一律**顯式傳入** `ctx.rng`，不要依賴 `Math.random`。
  - **rng 消耗順序（固定，寫進實作註解與測試）**：① `findSpawnPos(playerPos, rng)` 吃 **2 個** rng（角度、距離）；② `chooseHostileKind(rng)` 吃 **1 個**；③ （只有重抽時）再吃 1 個 ×最多 4 次。→ 一個 `rng` 恆回傳固定值的測試會讓「種類」固定（因為消耗的是同一個值）→ 想控制種類就用**依序回傳不同值**的 rng（例：`[0.1, 0.5, 0.6]` → 角度 0.1、距離 0.5、種類 0.6）。
  - **地面 y ≤ 5 的假世界**：`isSolidAt: (x, y) => y <= 5`、`blockIdAt: () => BLOCK.GRASS`、`lightAt: () => ({ sky: 0, internalSky: 0, block: 0 })` —— **Task 7 的所有測試共用這一個 fixture**（`surfaceYAt` 回 null 時 `trySpawnHostile` 回 null，測試若對 `spawn.pos` 取值會爆 TypeError → 一律先斷言 `result !== null`）。

`src/world/mobs.test.ts`：
- 把原本針對 `trySpawnMob`／`chooseSpawnKind` 的案例**刪除並搬到** `b9-spawn.test.ts`（同一批斷言語意：距離帶 24–128、上限、夜間生成、位置斷言、skeleton 比 zombie 快等）。
- `chooseSpawnKind` 若原本有測試 → 搬到 `b9-spawn.test.ts` 並改測 `chooseHostileKind`（四種等機率）。
- 其餘 `mobs.test.ts`（`stepMob`／箭／傷害／物理）**一字不改**。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/world/b9-spawn.test.ts src/world/mobs.test.ts`
Expected: FAIL（新模組不存在；`mobs.test.ts` 在移除 `trySpawnMob` 後才會綠——**注意實作順序：先寫新測試 → 跑（紅）→ 實作 → 跑（綠）**）。

- [ ] **Step 3: 實作**

`src/world/b9-spawn.ts`：
- `chooseHostileKind(rng = Math.random)`：依 `HOSTILE_SPAWN_WEIGHTS` 的**加權抽籤**（四個都是 100 ⇒ 等機率 1/4）；實作用「累積權重」寫法，不要寫死 `['zombie','skeleton','creeper','spider'][floor(rng()*4)]`（那樣權重表就形同虛設，複核者會問）。
  **累積順序＝`HOSTILE_SPAWN_WEIGHTS` 的鍵序**（zombie → skeleton → creeper → spider）→ rng 0.1／0.4／0.6／0.9 依序對應 zombie／skeleton／creeper／spider（**2026-10-20 稽核修正：原計畫的測試寫 0.4→creeper、0.6→spider，與累積權重相反 → 必紅**）。實作寫成：
  ```ts
  export function chooseHostileKind(rng: () => number = Math.random): HostileKind {
    const total = Object.values(HOSTILE_SPAWN_WEIGHTS).reduce((a, b) => a + b, 0);
    let r = rng() * total;
    for (const k of Object.keys(HOSTILE_SPAWN_WEIGHTS) as HostileKind[]) {
      r -= HOSTILE_SPAWN_WEIGHTS[k];
      if (r < 0) return k;
    }
    return 'spider';   // 浮點誤差的保底（r 剛好 0 時最後一項）
  }
  ```
- `trySpawnHostile(counts, playerPos, ctx)`：
  1. `if (counts.mobs + counts.creepers + counts.spiders >= MAX_MOBS) return null;`
  2. 取候選點：`const rng = ctx.rng ?? Math.random;` → `findSpawnPos(playerPos, rng)`（B4 的既有函式，距離 24–128；**它一次吃 2 個 rng：角度、距離**）。
  3. `y = surfaceYAt(spot.x, spot.z, ctx.isSolidAt, ctx.blockIdAt)`；null → 回 null。
  4. 光照判準：`if (!canSpawnHostile(ctx.lightAt(floor(spot.x), y, floor(spot.z)))) return null;`（B6 的既有判準，**不重定義**）。
  5. 抽種類：**再吃 1 個 rng**（`chooseHostileKind(rng)`）；若抽到 `'creeper'` 且 `counts.creepers >= MAX_CREEPERS` → **重抽（每重抽再吃 1 個 rng）最多 4 次**；4 次都抽到 creeper → 回 null（該次生成跳過）。
  6. 依種類建立：`zombie`／`skeleton` → `createMob(kind, { x: spot.x, y, z: spot.z })`；`creeper` → `createCreeper({ x: spot.x, y, z: spot.z }, rng)`；`spider` → `createSpider({ x: spot.x, y, z: spot.z }, rng)`（**2026-10-20 稽核修正：`createCreeper`／`createSpider` 新增了 rng 參數（`wanderDir`／`wanderTimer` 要用），這裡要把同一個 rng 傳下去 → 漫遊方向才是分佈在整圈而不是同一個窄扇形**）。
  7. 回 `{ kind, mob, creeper, spider }`（只有對應的那一個非 null）。
  **rng 消耗順序（固定，寫進模組檔頭註解）**：① `findSpawnPos` 2 次 → ② `chooseHostileKind` 1 次 → ③ 重抽時每次 1 次（最多 4 次）。

`src/world/mobs.ts`：
- 移除 `trySpawnMob` 與 `chooseSpawnKind`（連同只被它們使用的 `SpawnCtx` 型別）。
- 檔頭註解補一句：敵對生怪已統一到 `src/world/b9-spawn.ts`（四種生物共用一份權重表）。

- [ ] **Step 4: 跑測試轉綠**

Run: `npx vitest run src/world/b9-spawn.test.ts src/world/mobs.test.ts` → PASS。

- [ ] **Step 5: 全量 gates**

Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 6: Commit**

```bash
git add src/world/b9-spawn.ts src/world/b9-spawn.test.ts src/world/mobs.ts src/world/mobs.test.ts
git commit -m "feat(spawn): B9 統一生怪分配器（四種敵對各 25%／總上限 12／苦力怕子上限 4）"
```

---

### Task 8: 苦力怕與蜘蛛的接線（清單／生成排程／步進／玩家攻擊／擊殺掉落／死亡原因）

**Files:**
- Modify: `src/main.ts`（`creepers`／`spiders` 清單、生成排程、生物步進、玩家攻擊可命中、擊殺掉落、死亡原因）
- Modify: `src/ui/death.ts`（`DamageSource` 加 `'creeper' | 'spider'`）
- Test: `src/ui/death.test.ts`（既有測試檔的死亡訊息測試）

**Interfaces:**
- Consumes: Task 4 的 `stepCreepers`／`damageCreeper`／`isCreeperDead`／`hitCreeperId`／`attackCreeper`／`Creeper`；Task 6 的 `stepSpiders`／`damageSpider`／`isSpiderDead`／`hitSpiderId`／`attackSpider`／`Spider`；Task 7 的 `trySpawnHostile`／`HostileSpawn`；B4 的 `rollMobDrops`；B1 的 `damage`／`exhaust`／`EXHAUST_HURT`／`invuln`（`canBeHurt`／`markHurt`）；B6 的 `spawnLightAt`；`mobs.ts` 的 `hasLineOfSight`。
- Produces:
  - `src/ui/death.ts`：`DamageSource` 新增 `'creeper' | 'spider'`；`deathMessageFor` 對應中文（`'你被苦力怕炸死了'`／`'你被蜘蛛殺死了'`）。

**設計決策（要寫進註解）**：
- **苦力怕／蜘蛛不跨存檔**（與既有敵對生物一致）：新遊戲／讀檔時清空這兩個清單，不進任何存檔 payload。
- **蜘蛛咬傷走既有的受傷路徑**（含 0.5 秒受擊無敵幀、`hurtFlash` 紅色回饋、`EXHAUST_HURT` 疲勞）→ 與殭屍／骷髏完全一致；只有**爆炸傷害**才繞過無敵幀（見 Task 9）。
- **HUD 的生物計數維持既有語意**（`mobs-changed` 只算殭屍＋骷髏）→ 不改 HUD，避免擴大本批範圍。

- [ ] **Step 1: 寫測試（失敗）**

`src/ui/death.test.ts`：
- 新增 `'the creeper and spider death lines are localised'`：
  ```ts
  expect(deathMessageFor('creeper')).toBe('你被苦力怕炸死了');
  expect(deathMessageFor('spider')).toBe('你被蜘蛛殺死了');
  ```
  （若既有測試用 `toContain('炸')` 之類的斷言，依實際實作調整字串，但**必須有這兩則測試**。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/ui/death.test.ts` → FAIL（`'creeper'` 不在 `DamageSource` 聯集內 → 型別錯誤）。

- [ ] **Step 3: 實作 `src/ui/death.ts`**

- `DamageSource` 加 `'creeper' | 'spider'`；`deathMessageFor` 加兩個 case（中文如上）。

- [ ] **Step 4: 實作 `src/main.ts` 的接線**

**（a）狀態與清單**
- 新增 `let creepers: Creeper[] = [];` 與 `let spiders: Spider[] = [];`（與既有的 `mobs`／B4 的 `passiveMobs` 並列）。
- `resetWorld()`／新遊戲／讀檔路徑：把這兩個清單清空（敵對生物本來就不跨存檔，與 `mobs` 同步）。

**（b）生成排程**
- `spawnTick()` 改用 `trySpawnHostile`：
  ```ts
  const res = trySpawnHostile(
    { mobs: mobs.length, creepers: creepers.length, spiders: spiders.length },
    player.position,
    {
      lightAt: (x, y, z) => spawnLightAt(world, x, y, z, clock.t),
      isSolidAt: (x, y, z) => world.isSolid(x, y, z),
      blockIdAt: (x, y, z) => world.getBlock(x, y, z),
    },
  );
  if (!res) return;
  if (res.mob) mobs = [...mobs, res.mob];
  if (res.creeper) creepers = [...creepers, res.creeper];
  if (res.spider) spiders = [...spiders, res.spider];
  ```
- 生成後照既有慣例 `bus.emit('mobs-changed', { count: mobs.length })`（數量定義維持「殭屍＋骷髏」的既有語意，不把新生物算進去；HUD 不必改）。

**（c）生物步進**
- 既有 `const stepped = stepMobs(mobs, {...})` 旁邊加上：
  ```ts
  const creeperStep = stepCreepers(creepers, {
    playerPos: player.position, isSolidAt,
    hasLineOfSight: (from, to) => hasLineOfSight(from, to, isSolidAt),
    dt,
  });
  creepers = creeperStep.creepers;
  const spiderStep = stepSpiders(spiders, {
    playerPos: player.position, isSolidAt,
    hasLineOfSight: (from, to) => hasLineOfSight(from, to, isSolidAt),
    lightAt: (x, y, z) => spawnLightAt(world, x, y, z, clock.t),
    dt,
  });
  spiders = spiderStep.spiders;
  for (const ev of spiderStep.events) applySpiderDamage(ev);
  ```
  - `hasLineOfSight` 包一層：`mobs.ts` 的既有簽名是 `(from, to, isSolidAt)`，本批的 ctx 需要 `(from, to)`。
  - 苦力怕的 `explode` 事件在 **Task 9** 才處理（`runExplosion`），本任務先把它收集起來不做事、或直接留到 Task 9 接（**兩個任務都可以獨立 commit**：Task 8 的苦力怕只會嘶嘶不會爆，Task 9 接上爆炸）。**實作時選一個並寫進 commit 訊息**：本計畫採「Task 8 先不處理 explode 事件（苦力怕只會嘶嘶），Task 9 接上」——好讓兩個任務各自可獨立審查。
- 死亡過濾：**每幀移除 `isCreeperDead`／`isSpiderDead` 的實體**（**不**在此路徑灑掉落——掉落只在玩家近戰擊殺時發，避免重複）。
- **despawn（2026-10-20 稽核修正：原文只寫「移除死亡實體」，漏了距離過濾）**：現況 `src/main.ts` 對殭屍／骷髏的過濾是
  ```ts
  mobs = mobs.filter((m) => !isDead(m) && xzDistance(m.pos, player.position) <= DESPAWN_DISTANCE);
  ```
  → **苦力怕／蜘蛛要套同一條規則**（B4 已把 `DESPAWN_DISTANCE` 調到 128）：否則它們在 24–128 格生成後會一路走回玩家（還會在玩家家附近引爆），與原版／B4 的敵對生物不一致。
  ```ts
  creepers = creepers.filter((c) => !isCreeperDead(c) && xzDistance(c.pos, player.position) <= DESPAWN_DISTANCE);
  spiders = spiders.filter((s) => !isSpiderDead(s) && xzDistance(s.pos, player.position) <= DESPAWN_DISTANCE);
  ```
  （`xzDistance`／`DESPAWN_DISTANCE` 沿用 `mobs.ts` 的既有匯出，**不另立常數**。被過濾掉的苦力怕**不會**爆炸也不會掉落——它是「離開範圍」不是「死亡」。）

**（d）玩家攻擊**
- 攻擊分支（LMB）除了既有的 `hitMobId`／`attackMob`（殭屍／骷髏）與 B4 的被動生物命中之外，**依序**再查 `hitCreeperId(creepers, rayOrigin, dir, meleeReach)` 與 `hitSpiderId(spiders, rayOrigin, dir, meleeReach)`；命中 → `attackCreeper`／`attackSpider` → 扣血 → 死亡時（生存模式）`rollMobDrops('creeper', undefined, { killedByPlayer: true })`／`rollMobDrops('spider', undefined, { killedByPlayer: true })` 灑掉落 → `bus.emit('mobs-changed')` 與既有的 `applyAdvancement({ type: 'mob-killed', mode: currentMode })`（**沿用**，新生物擊殺也會觸發 `monster_hunter` 進度）。

**（e）蜘蛛咬傷**
- `applySpiderDamage(ev)`：沿用既有 `applyMobEvent` 的形狀——`if (!vitals) return;` → 檢查 `canBeHurt(invuln, nowSec)`（**要**受 0.5 秒無敵幀限制，與其他生物一致）→ `deathCause = 'spider'` → `setVitals(exhaust(damage(vitals, ev.amount), EXHAUST_HURT))` → `hurtFlash.flash()`。

- [ ] **Step 5: 跑測試轉綠**

Run: `npx vitest run src/ui/death.test.ts src/world/creeper.test.ts src/world/spider.test.ts src/world/b9-spawn.test.ts` → PASS。

- [ ] **Step 6: 全量 gates**

Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 7: 人工步驟（記錄結果）**

`npm run dev` → 生存模式、夜裡觀察：殭屍／骷髏之外會出現苦力怕與蜘蛛；蜘蛛白天不追（除非被攻擊）、夜晚會撲過來；打死苦力怕掉火藥、打死蜘蛛掉線（偶爾一顆蜘蛛眼）。
（2026-10-20 稽核修正補兩點人工驗收）
1. **爆炸殺死的蜘蛛不掉蜘蛛眼**：讓苦力怕在蜘蛛旁邊爆 → 蜘蛛被炸死 → **地上只有線，沒有蜘蛛眼**（只有玩家擊殺的蜘蛛才會掉蜘蛛眼）。
2. **despawn**：離開生成的苦力怕／蜘蛛超出 `DESPAWN_DISTANCE`（128 格）→ **實體消失**（不會一路走回玩家）。

- [ ] **Step 8: Commit**

```bash
git add src/main.ts src/ui/death.ts src/ui/death.test.ts
git commit -m "feat(mobs): B9 苦力怕與蜘蛛接線（生成、步進、玩家攻擊、擊殺掉落、死亡原因）"
```

---

### Task 9: 爆炸執行（破壞方塊、掉落、玩家與生物的傷害與擊退）

**Files:**
- Modify: `src/main.ts`（`runExplosion`：破壞方塊、掉落、玩家傷害與擊退、生物傷害）
- Test: `src/world/explosion.test.ts`（追加一則與玩家傷害互相咬合的測試）

**Interfaces:**
- Consumes: Task 3 的 `explodeAt`／`explosionDamage`／`explosionKnockback`／`explosionExposure`／`CREEPER_EXPLOSION_POWER`／`EXPLOSION_KNOCKBACK_MAX_Y`；Task 5 的 `applyKnockback`；B1 的 `damage`／`exhaust`／`EXHAUST_HURT`；B4 的 `damageMob`／`damagePassiveMob`／`rollMobDrops`；`drops.ts` 的 `spawnDrop`；`particles.ts` 的 `spawnBreakBurst`；`mobs.ts` 的 `hasLineOfSight`。
- Produces: `src/main.ts` 的內部函式 `runExplosion(at: { x: number; y: number; z: number }): void`（**不外匯**；純邏輯全在 `src/world/explosion.ts`）。

**已查證數值（wiki，2026-10-20）**：爆炸中心到目標的距離量到**腳**、擊退方向取到**眼睛**；掉落機率 1/power；原版苦力怕爆炸後是被移除（`discard()`）→ **不掉火藥**。

**設計決策（要寫進註解）**：
- **爆炸中心＝苦力怕的腳底位置**（原版 TNT 的爆炸中心在實體位置上方 0.06125 格；苦力怕在實體位置，本作用腳底位置，差異 < 1 格）。
- **爆炸傷害繞過玩家的 0.5 秒受擊無敵幀**（原版沒有無敵幀；爆炸是單次大傷害，不屬於「一群怪連續打」的情境）；受傷回饋（紅色閃爍）與疲勞（`EXHAUST_HURT`）照舊。
- **爆炸對生物**：對 `mobs`（殭屍／骷髏）、`creepers`、`spiders` 與 B4 的 `passiveMobs` 都套用同一個傷害公式與暴露度判定；死亡走既有的 `rollMobDrops`（生存模式才灑掉落）**且傳 `killedByPlayer: false`**（被爆炸殺死 ≠ 被玩家擊殺 → 蜘蛛眼不該掉；2026-10-20 稽核修正）。
- **爆炸的苦力怕本身不掉火藥**：爆炸事件把苦力怕從清單移除（不是「死亡」），**不**呼叫 `rollMobDrops`。
- **爆炸破壞方塊要走 `world.setBlock`**（會記 `modified` overlay → 存檔往返保留戰痕）＋ 沿用既有的 `spawnBreakBurst` 粒子（`src/world/particles.ts`）。

- [ ] **Step 1: 寫測試（失敗）**

`src/world/explosion.test.ts`（追加，不新檔）：
- `'an explosion in the open deals the vanilla maximum to the player'`：
  ```ts
  expect(explosionDamage(CREEPER_EXPLOSION_POWER, 0, explosionExposure(true))).toBe(43);
  ```
  （與 Task 3 的公式測試互相咬合：確認「玩家在爆炸中心」走的是同一條公式。）
- `'the vertical knockback is capped for the player'`：`expect(EXPLOSION_KNOCKBACK_MAX_Y).toBe(8);`（把「垂直擊退壓到 8 格/秒」這條簡化釘成常數，避免日後被無意改掉）。
- `'the vertical knockback of the player is actually capped'`（2026-10-20 稽核修正：原計畫只有「常數等於 8」的斷言 → **垂直擊退的實際行為完全沒有覆蓋**；改成一則行為斷言，把「實際套用的垂直分量不超過 8 格/秒」釘住）：
  ```ts
  // 玩家在爆炸正上方 → 水平距離 0 → 方向完全朝上 → 垂直分量應該被夾在 8
  const mag = explosionKnockback(CREEPER_EXPLOSION_POWER, 0, 1);   // 20
  const vertical = Math.min(mag, EXPLOSION_KNOCKBACK_MAX_Y);      // 8
  expect(vertical).toBe(8);
  expect(vertical).toBeLessThan(mag);
  ```
  （這是純函式層的行為釘死；`main.ts` 的 `runExplosion` 用同一個 `Math.min(mag, EXPLOSION_KNOCKBACK_MAX_Y)` → 兩邊一致。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/world/explosion.test.ts` → FAIL（`EXPLOSION_KNOCKBACK_MAX_Y` 未匯出）。

- [ ] **Step 3: 實作 `src/main.ts` 的 `runExplosion(at)`**

1. `const power = CREEPER_EXPLOSION_POWER;`
2. `const result = explodeAt({ power, center: at, blockIdAt: (x, y, z) => world.getBlock(x, y, z), isSolidAt: (x, y, z) => world.isSolid(x, y, z) });`
3. **破壞方塊**：對每個 `b` → `world.setBlock(b.x, b.y, b.z, BLOCK.AIR)`；`particles = spawnBreakBurst(particles, b.blockId, { x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 });`
4. **掉落**：對每個 `d` → `drops = spawnDrop(drops, d.item, d.count, d.at)`；有掉落才 `bus.emit('drops-changed', {})`。
5. **玩家傷害與擊退**：
   ```ts
   const playerEye = { x: player.position.x, y: player.position.y + EYE_HEIGHT, z: player.position.z };
   const dist = Math.hypot(player.position.x - at.x, player.position.y - at.y, player.position.z - at.z); // 量到腳
   const exposure = explosionExposure(hasLineOfSight(at, playerEye, isSolidAt));
   const dmg = explosionDamage(power, dist, exposure);
   if (dmg > 0 && vitals) {
     deathCause = 'creeper';
     setVitals(exhaust(damage(vitals, dmg), EXHAUST_HURT));
     hurtFlash.flash();
     const mag = explosionKnockback(power, dist, exposure);
     const len = Math.hypot(playerEye.x - at.x, playerEye.y - at.y, playerEye.z - at.z) || 1; // 方向取到眼睛
     applyKnockback(player, {
       x: ((playerEye.x - at.x) / len) * mag,
       y: Math.max(0, (playerEye.y - at.y) / len) * Math.min(mag, EXPLOSION_KNOCKBACK_MAX_Y),
       z: ((playerEye.z - at.z) / len) * mag,
     });
   }
   ```
   （**不**檢查 `canBeHurt`——爆炸繞過無敵幀，理由見上方設計決策。）
6. **生物傷害**：對 `mobs`／`creepers`／`spiders`／`passiveMobs` 各自算「到腳的距離」與暴露度 → `dmg = explosionDamage(power, dist, exposure)`；> 0 時扣血（`damageMob(m, dmg, knockDir)`／`damageCreeper(c, dmg, from)`／`damageSpider(s, dmg, from)`／`damagePassiveMob(m, dmg, from)`），擊退方向＝從爆炸中心指向該生物的**水平分量**。
   （2026-10-20 稽核修正：**生物只有水平擊退** —— 蜘蛛的 `kbVel` 只有 x/z，沒有 y 分量；原版爆炸對生物也沒有垂直分量（生物有自己的重力）。**不要自己加 y 分量**，否則蜘蛛會被炸飛。）
7. **生物被炸死** → 生存模式才灑掉落，**且必須傳 `killedByPlayer: false`**（2026-10-20 稽核修正：原計畫寫 `rollMobDrops(kind)` → 用到預設值 `killedByPlayer = true` → **被苦力怕炸死的蜘蛛仍然掉蜘蛛眼**，違反「蜘蛛眼只在被玩家（或寵物狼）擊殺時掉落」這條原版規則（計畫自己在 §2 查證並寫成規則））：
   ```ts
   rollMobDrops(kind, undefined, { killedByPlayer: false });
   ```
   （**苦力怕被自己的爆炸炸死不走這條路**（爆炸事件已把它從清單移除）；殭屍／骷髏／被動生物沿用 B4 的既有規則，`killedByPlayer: false` 對它們沒有影響。）
8. **接上 Task 8 的引信事件**：在生物步進處把 `creeperStep.events` 裡的 `{ type: 'explode' }` 轉成 `runExplosion(ev.at)`，並把該苦力怕從 `creepers` 清單移除（**不掉落**）。

- [ ] **Step 4: 跑測試轉綠**

Run: `npx vitest run src/world/explosion.test.ts src/world/creeper.test.ts src/world/spider.test.ts` → PASS。

- [ ] **Step 5: 全量 gates**

Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 6: 人工步驟（記錄結果）**

`npm run dev` → 生存模式、夜裡讓苦力怕靠近：觀察它嘶嘶 → 約 1.5 秒後爆炸 → 方塊被炸掉、地表出現坑、掉落物散在坑邊、玩家扣血並被推開；把苦力怕打死 → 掉火藥（0–2 顆）。

- [ ] **Step 7: Commit**

```bash
git add src/main.ts src/world/explosion.test.ts
git commit -m "feat(explosion): B9 爆炸執行（破壞方塊／1-3 掉落／玩家與生物傷害與擊退）"
```

---

### Task 10: 苦力怕與蜘蛛的渲染

**Files:**
- Create: `src/render/b9-mobs.ts`、`src/render/b9-mobs.test.ts`
- Modify: `src/main.ts`（建立 renderer、每幀同步、命中閃白）

**Interfaces:**
- Consumes: Task 4 的 `Creeper`／`creeperFuseProgress`；Task 6 的 `Spider`。
- Produces:
  ```ts
  export interface B9MobRenderer {
    syncCreepers(list: readonly Creeper[], dt: number): void;
    syncSpiders(list: readonly Spider[], dt: number): void;
    flashCreeper(id: number): void;
    flashSpider(id: number): void;
    dispose(): void;
  }
  export function createB9MobRenderer(scene: THREE.Scene): B9MobRenderer;
  ```

**設計決策（要寫進註解）**：
- **獨立 renderer 模組**（不塞進 `render/scene.ts` 的 `createMobRenderer`）：後者的骨架是「頭＋身＋兩腿＋兩臂」的直立人形，蜘蛛是 1.4 寬 0.9 高的橫向八足體，兩者共用只會互相礙事；這與 B4 另開 `render/passive-mobs.ts` 的理由相同。
- 苦力怕模型：0.6×1.7 的綠色身體（`0x4a7a3a`）＋ 頭部（深色臉部斑塊 `0x2b3a2a`）＋ **四條腿**（2026-10-20 稽核修正：設計決策寫「四條腿」但測試斷言的是 `legL`／`legR`（兩條）→ 兩處不一致。**統一成四條腿，節點名 `legFL`／`legFR`／`legBL`／`legBR`**（前／後 × 左／右），測試與實作都用這四個名稱）。
- 苦力怕的**引信閃白**：引信進行中，身體材質往白色插值（依 `creeperFuseProgress`），到 1.0 時全白 → 玩家看得出「快要爆了」。
- 蜘蛛模型：1.4 寬 × 0.9 高的深色身體（`0x2b1b16`）＋ 頭（帶兩點紅眼 `0xb02020`）＋ **8 條腿**（細長方塊，向外張開，位置依 `SPIDER_WIDTH` 推導）。
- 走路擺動沿用 `createMobRenderer` 的做法（`phase += hSpeed × dt × 4`、`swing = sin(phase) × 0.6`）；蜘蛛爬牆時（`state === 'climb'`）腿部不擺動。

- [ ] **Step 1: 寫測試（失敗）**

`src/render/b9-mobs.test.ts`（新檔，比照 `src/render/scene.test.ts` 的 jsdom + THREE 做法）：
- `'creates a blocky group per creeper'`：`syncCreepers([creeper], 0.016)` → `scene.children` 長度 1、group 名稱 `creeper:<id>`、內含具名節點 `head`／`body`／`legFL`／`legFR`／`legBL`／`legBR`（2026-10-20 稽核修正：四條腿，與設計決策一致）。
- `'the creeper is taller than the spider'`（2026-10-20 稽核修正：**量測方式要寫死**，否則實作者會各自發明）：兩者都在場 → 用 `new THREE.Box3().setFromObject(group)` 取 `max.y - min.y` → **苦力怕 group 的高度 > 蜘蛛 group 的高度**（1.7 > 0.9）。
- `'the spider has eight legs'`：`syncSpiders([spider], 0.016)` → 蜘蛛 group 內有 8 個以 `leg` 開頭的具名節點（`filter((c) => c.name.startsWith('leg')).length === 8`）。
- `'the creeper flashes white as the fuse runs out'`：`creeperFuseProgress` 從 0.5 前進到 1.0 → 身體材質的 `emissive.getHex()` 變亮（`toBeGreaterThan` 前後值）。
- `'moves an existing mob without rebuilding'`：同一 id 換位置 → `scene.children` 仍 1、位置更新。
- `'removes the group when the mob disappears'`：傳空陣列 → `scene.children` 長度 0。
- `'treats non-finite dt as zero'`。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/render/b9-mobs.test.ts` → FAIL（模組不存在）。

- [ ] **Step 3: 實作 `src/render/b9-mobs.ts`**

- 比照 `render/scene.ts` 的 `createMobRenderer` 結構：共用 unit geometry、每隻生物一份材質（為了單獨閃白）、id-keyed 快取、`dispose()` 釋放。
- `buildCreeper()`：依 `CREEPER_WIDTH`／`CREEPER_HEIGHT` 決定 body/head/leg 尺寸與位置；臉部斑塊用幾個深色小方塊疊在頭前面。
- `buildSpider()`：依 `SPIDER_WIDTH`／`SPIDER_HEIGHT` 決定軀幹（略扁）＋頭＋8 條腿（每條腿＝兩段細方塊，向外下斜）。
- `syncCreepers(list, dt)`／`syncSpiders(list, dt)`：建立／更新／移除＋擺動＋引信閃白倒數。
- `flashCreeper(id)`／`flashSpider(id)`：受擊閃白 0.1 秒（與既有生物一致）。

`src/main.ts`：
- `const b9Renderer = createB9MobRenderer(gs.scene);`
- 渲染尾段（既有 `mobRenderer.syncMobs(...)` 旁邊）：`b9Renderer.syncCreepers(creepers, state === 'playing' ? dt : 0); b9Renderer.syncSpiders(spiders, state === 'playing' ? dt : 0);`
- 玩家命中苦力怕／蜘蛛時呼叫對應的 `flashCreeper`／`flashSpider`。

- [ ] **Step 4: 跑測試轉綠**

Run: `npx vitest run src/render/b9-mobs.test.ts` → PASS。

- [ ] **Step 5: 全量 gates**

Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 6: Commit**

```bash
git add src/render/b9-mobs.ts src/render/b9-mobs.test.ts src/main.ts
git commit -m "feat(render): B9 苦力怕與蜘蛛模型渲染（引信閃白／蜘蛛八足）"
```

---

### Task 11: 苦力怕引信聲（加分項，可延後）

**Files:**
- Modify: `src/audio/voices.ts`（`creeperHiss`）
- Modify: `src/audio/index.ts`（`GameAudio.playCreeperHiss`）
- Modify: `src/main.ts`（引信開始時呼叫）
- Test: `src/audio/sounds.test.ts`（或 `src/audio/engine.test.ts` 既有慣例處）

**Interfaces:**
- Consumes: `src/audio/voices.ts` 的 `playOneShot`／`createNoiseBuffer`（既有）；`src/audio/index.ts` 的 `GameAudio`／`PlayOptions`。
- Produces:
  - `voices.ts`：`export function creeperHiss(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer): void`
  - `index.ts`：`GameAudio.playCreeperHiss(opts?: PlayOptions): void`（用既有的 `gainForDistance` 做距離衰減）。

**已查證數值（wiki，2026-10-20）**：「Creeper hisses | … `entity.creeper.primed` | Volume 1.0 | Pitch 0.5」已查證（minecraft.wiki/Creeper，2026-10-20）→ 程序合成：0.5 秒的帶通白噪音（中心頻率約 900 Hz、Q ≈ 1.2）＋ 緩慢上升的音量包絡（模擬「嘶——」）。

**設計決策（要寫進註解）**：
- **這是加分項**：spec §B9 明寫「引信聲列加分項」。若時間不夠，**整個 Task 11 可以跳過**（跳過時必須在發布說明〈已知問題〉與 README 記錄「苦力怕引信聲未實作」）。
- 音效**不影響任何規則**（沒有測試依賴它的規則行為）；只測「會產生一次合成呼叫」與距離衰減。

- [ ] **Step 1: 寫測試（失敗）**

- `'the creeper hiss asks the audio engine for a one-shot'`：用既有 `src/audio/engine.test.ts` 的注入式 fake ctx（讀既有測試的寫法）→ 呼叫 `audio.playCreeperHiss({ pos, listener })` 後，`playOneShot` 的呼叫次數為 1（或 ctx 的 oscillator 節點數 > 0）。
- `'the hiss is silent beyond the audible distance'`：`listener` 距離 40 格 → 增益為 0（斷言呼叫時的 gain 為 0）。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/audio/engine.test.ts` → FAIL（`playCreeperHiss` 不存在）。

- [ ] **Step 3: 實作**

- `voices.ts`：`creeperHiss(ctx, dest, noise)` → 建立 `BiquadFilterNode`（bandpass、900 Hz、Q 1.2）＋ `AudioBufferSourceNode`（用 `noise`）＋ `GainNode`（0 → 0.9 → 0 的包絡，總長 0.5 秒），`source.start()`／`stop(now + 0.5)`。
- `index.ts`：`playCreeperHiss(opts)` → 依 `gainForDistance` 計算增益後呼叫 `creeperHiss(ctx, dest, noiseBuffer(ctx))`。
- `main.ts`：苦力怕**開始引信的那一幀**呼叫一次 `audio.playCreeperHiss({ pos: creeper.pos, listener: player.position })`（不要每幀呼叫——用 `fuse === fuseTotal`（剛開始）或狀態轉換 `wander/chase → fuse` 判定）。

- [ ] **Step 4: 跑測試轉綠**

Run: `npx vitest run src/audio/engine.test.ts` → PASS。

- [ ] **Step 5: 全量 gates**

Run: `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 6: Commit**

```bash
git add src/audio/voices.ts src/audio/index.ts src/audio/engine.test.ts src/main.ts
git commit -m "feat(audio): B9 苦力怕引信聲（程序合成，加分項）"
```

---

### Task 12: 0.12.0 發布

**Files:**
- Modify: `package.json`、`game.json`、`README.md`
- Create: `docs/releases/v0.12.0.md`

**Interfaces:**
- Consumes: Task 1–11 全部。
- Produces: tag `v0.12.0` 與 GitHub Release（CI 產生）。

- [ ] **Step 1: 版本 bump**

`package.json` `"version": "0.12.0"`；`game.json` `"version": "0.12.0"`。
**`game.json` 的 `cloudSave` 不動**（2026-10-20 稽核修正：原括號寫死 `readableFormats: [1,2,3,4], writeFormat: 4` → 若 B6–B8 尚未併入，現況是 `[1]`／`1`，照抄等於**偷偷升版**）。正確做法：**維持合併後的現值不動** —— 合併後已是 `[1,2,3,4]`／4 就原樣保留；還沒合併就是當下的 `[1]`／`1`。**本批一律不動、不升版**（公約 §3 的 B9 列）。`id` 不動。

- [ ] **Step 2: README 更新**

- 「遊戲特色」段補：苦力怕（HP 20、接近 3 格嘶嘶、1.5 秒後爆炸、威力 3 的球形爆破會摧毀方塊並按 1/3 機率掉落）、蜘蛛（HP 16、暗處主動攻擊、亮處／白天中立、會攀牆）、三個新物品（火藥／線／蜘蛛眼，暫無用途）、爆炸對生物與玩家的傷害與擊退。
- **「與原版的差異」段新增以下條目**（逐條，與〈已查證與設計決策〉§7 一致）：
  - 爆炸的破壞判定是**球形近似**（原版是 256 條隨機方向的射線逐格消耗強度）；強度衰減規則照搬（每格空氣 0.75、每格抗性 (r+0.3)×0.3）。
  - 爆炸的**隨機射線強度未實作**（原版每條射線是 power×0.7–1.3）→ 同一位置每次的破壞結果相同。
  - 爆炸的**暴露度簡化為二值**：視線通暢 1.0、被遮蔽 0.4（原版以 27 個取樣點計算 0–1 的連續值）。
  - 爆炸的**掉落機率 1/3**（原版 1/power，與原版一致；TNT 的 100% 不適用，本作沒有 TNT）。
  - 爆炸**會炸掉玩家自己放置的方塊**（與原版一致；原版唯一的例外是 `mobGriefing` 遊戲規則，本作未實作該規則 → 一律會破壞）。
  - 爆炸的**垂直擊退上限 8 格/秒**（原版最高可達 20 格/秒）。
  - 爆炸**不產生火**（與原版一致：苦力怕爆炸本來就不著火）。
  - **苦力怕的取消引信距離是 7 格（與原版一致）**：原版 Java 是 `distanceToSqr > 49.0`（三維距離、嚴格大於才取消）→ 本作照抄；**取消引信需要連續視線**也與原版一致。
  - **苦力怕摔落時的引信膨脹未實作**（原版摔落會額外累積引信）。
  - **蜘蛛攀牆只爬完整方塊、每次最多 3 格（障礙頂面距腳底 ≤ 3 格）、只在追擊時發生**；原版可一路爬到高牆頂、失掉敵意後還會盲爬 2 秒，也不爬方塊下表面。
  - **蜘蛛的察覺不要求視線**（原版如此：可隔牆察覺玩家）；但其他生物仍需要視線。
  - **敵對生物上限仍為 12，其中苦力怕最多 4 隻**（原版 Monster cap 是 70、沒有苦力怕子上限；本作的 12 與 4 都是自訂上限）；**苦力怕／蜘蛛離玩家超過 128 格會消失**（與其他敵對生物一致）。
  - **生怪不成群**：原版 Java 版一次生成 4 隻，本作沿用「每 5 秒嘗試 1 隻」。
  - **苦力怕與蜘蛛不跨存檔**（與其他敵對生物一致，每場重來）。
  - **火藥／線／蜘蛛眼暫無用途**（不進合成表、不進熔爐、不掛進度）。
  - 苦力怕／蜘蛛的移動速度低於原版（苦力怕 3.2 格/秒、蜘蛛 4.0 格/秒；原版約 4.6／5.3），但比例對齊原版。
  - **引信聲若 Task 11 延後**，也要在此列出。
- 「Test」段的測試數字更新為實際數量（實作時以 `npm test` 的輸出為準）。
- 「專案狀態」補一行 B9（0.12.0）的完成摘要。

- [ ] **Step 3: 發布說明 `docs/releases/v0.12.0.md`**

固定四段（中文，段名與 `docs/releases/v0.4.0.md` 一致）：`## 新增`／`## 修正`／`## 存檔格式與相容性提示`／`## 已知問題`。

- 新增：苦力怕（HP 20、接近 3 格嘶嘶、1.5 秒引信、爆炸威力 3、破壞方塊並按 1/3 機率掉落、掉火藥 0–2）；蜘蛛（HP 16、暗處主動攻擊、亮處／白天中立、可攀牆、掉線 0–2 與蜘蛛眼 0–1）；三個新物品（火藥／線／蜘蛛眼）；爆炸對玩家與生物的傷害與擊退；爆炸對玩家放置方塊的破壞。
- 修正：無既有行為修正（列出本批順帶校正的註解誠實化項目）。
- 存檔格式與相容性提示：**本機 payload 版本不變、雲端格式不變**（本批沒有任何存檔欄位變更）→ 舊存檔照常載入；舊版遊戲讀新存檔會忽略新生物（因為敵對生物本來就不跨存檔）→ **沒有回退限制**。雲端 payload 大小不變。
- 已知問題：爆炸的球形近似與二值暴露度（簡化）；**爆炸抗性表只覆蓋本作有的方塊**（未實作的原版方塊沒有值）；蜘蛛攀牆上限 3 格（障礙頂面距腳底 ≤ 3）；敵對上限 12／苦力怕子上限 4；**蜘蛛眼只在玩家擊殺時掉落**（被爆炸炸死不掉）；火藥／線／蜘蛛眼暫無用途；引信聲是否延後（依 Task 11 的實際結果寫）；B2–B8 中尚未完成的功能維持既有說明。

- [ ] **Step 4: 全量 gates**

Run: `npm run typecheck && npm test && npm run build && npm run lint`
Expected: 全綠（測試數量 ≥ 既有基線；既有測試一個不少）。

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
git commit -m "chore(release): 0.12.0"
```

本計畫在 `b9-creeper-spider` 分支執行：tag 與 push 屬整支完成後的整合步驟——merge 回 master 後才 `git tag -a v0.12.0 -m "0.12.0: B9 苦力怕與蜘蛛"`＋`git push origin master`＋`git push origin v0.12.0`，由 controller 依 finishing-a-development-branch 流程執行。

- [ ] **Step 8: 驗證 CI Release**

以 `webfetch https://github.com/TommyLamm/WeCraft/releases/tag/v0.12.0` 確認 release 存在、asset 已附、說明為 `docs/releases/v0.12.0.md` 內容。回報照 AGENTS.md 四段式：程式完成／ZIP 驗證／Release（CI 結果）／平台上架（若屬平台操作，向使用者確認後再按）。

- [ ] **Step 9: Commit（收尾）**

若 Step 8 有任何補正（文件錯字、notes 檔更新），再一顆 commit；無則略過。

---

## 批末驗收

（Task 12 Step 6 執行；每項都要留下可重現的證據。）

1. **型別／測試／建置**：`npm run typecheck && npm test && npm run build && npm run lint` 全綠；測試數量 ≥ 合併後的既有基線（既有測試一個不多、一個不少）。
2. **生成測試**（Task 7）：四種敵對各 25%（統計測試、固定 rng、容差明確）；總上限 12；苦力怕子上限 4；生成距離 24–128；白天地表不生成、火把旁不生成（B6 光照判準）。補一個人工步驟：`npm run dev` → 夜晚在平原走一分鐘，記錄看到的殭屍／骷髏／苦力怕／蜘蛛數量與距離。
3. **傷害測試**（Task 3）：原版數值邊界全部釘死——power 3 在核心 43 傷、3 格 16 傷、6 格 1 傷、7 格 0 傷；遮蔽（exposure 0.4）時核心 12 傷；擊退 20 → 10 → 0 隨距離衰減。
4. **爆炸測試**（Task 2／3／9）：石頭只在核心附近被炸掉（距離 0 破、距離 2 不破）；基岩與水不破；樹葉與玻璃會破；掉落機率 1/3（rng 恆 0 → 掉、恆 0.99 → 不掉）；玩家在爆炸中心扣 43 血並被推開；生物被炸死會走 `rollMobDrops`；**爆炸的苦力怕本身不掉火藥**。
5. **掉落測試**（Task 1）：苦力怕掉火藥 0–2；蜘蛛掉線 0–2、蜘蛛眼 0–1 且只在玩家擊殺時掉；三個物品進得了熱鍵欄、圖示可辨識（`stackName('gunpowder') === 'Gunpowder'` 等）。
6. **中性與攀牆**（Task 6）：白天／火把旁蜘蛛不追（`state` 維持 `wander`）；夜間／洞穴蜘蛛追；被攻擊後白天也追；**2 格牆爬得上去（`pos.y` 正好等於牆頂面）**、**3 格牆也爬得上去**、**4 格牆不爬（`pos.y` 完全不變）**；漫遊時不爬牆。
7. **效能**：一次爆炸的方塊掃描（9³ = 729 格候選）耗時 < 5 ms（用 `performance.now()` 量一次即可，不必做成會 flaky 的斷言）；`npm run dev` → 12 隻敵對（含 4 隻苦力怕）＋ 12 隻被動生物同場時的 FPS，與本批前的基準比較，掉幅 > 20% 才算退步（要寫下數字）。
8. **真實瀏覽器驗收（Playwright，選用但建議）**：本批**沒有**動 iframe／pointer lock／全螢幕／保留鍵，因此不在 AGENTS.md 的強制門檻內；但爆炸會改變玩家位置與世界方塊，值得跑一次真實 Chromium（headful＋`xvfb-run`，靜態伺服 `dist/`，probe 腳本放 repo 外 `/tmp/opencode/wecraft-b9-probe/`）：進入生存 → 夜間等苦力怕靠近 → 確認畫面有閃白（引信）→ 爆炸後地表出現坑、玩家被推開。**保留鍵（Ctrl+W 等）情境一律列「未驗證」**（本批未改保留鍵行為）。
9. **存檔相容**：本批沒有存檔欄位變更 → 開新局 → 存檔 → 重開，生物**不**保留（與既有敵對生物一致），存檔可正常載入；雲端格式不變。
10. **掉落規則的人工確認**（2026-10-20 稽核修正）：**被爆炸炸死的蜘蛛不掉蜘蛛眼**（只有玩家擊殺才掉）；被炸死的苦力怕不掉火藥（爆炸事件直接移除實體）；玩家擊殺的蜘蛛才會掉線／蜘蛛眼（Task 1 的 `rollMobDrops` 測試 ＋ Task 8／9 的人工步驟）。
11. **despawn**：苦力怕／蜘蛛超出 `DESPAWN_DISTANCE`（128 格）後消失、不會走回玩家（Task 8 的接線 ＋ 人工步驟）。

## 與公約／spec 的差異

（逐條說明；公約 §3 的版本表本批完全一致——本機 payload 不升版、雲端 format 不升版、`readableFormats` 不動。）

1. **B4 的 `trySpawnMob`／`chooseSpawnKind` 被移除，改由 B9 的統一分配器取代**：兩個函式在 B4 內部固定抽「殭屍／骷髒 50/50」，若不改，四種敵對的權重會被拆成兩條抽籤路徑。本批把它們的測試案例**搬**到 `b9-spawn.test.ts`（同一批斷言、同一批意圖），`createMob`／`findSpawnPos`／`surfaceYAt`／`MAX_MOBS`／`xzDistance` 全部沿用不動。**不是重定義 B4 的介面，是移除被取代的兩個函式**（在 commit 訊息說明）。
2. **爆炸的方塊破壞是原版射線模型的「等效球形版本」**：原版用 16×16×16 = 256 條隨機方向的射線逐格消耗強度；本批改成「以爆炸中心為心的球形候選 + 逐格強度衰減（每格空氣 0.75、每格抗性 (r+0.3)×0.3）」。保留原版的兩個可觀察性質（半徑 ≈ 4/3 × power、抗性越高越靠近核心才會碎），但**不再隨機**（同一位置每次結果相同）。寫進 README〈與原版的差異〉。
3. **爆炸的暴露度簡化為二值**（通視 1.0／遮蔽 0.4），原版以 27 個取樣點算 0–1 的連續值。寫進 README。
4. **爆炸的垂直擊退壓到 8 格/秒**（原版最高 20 格/秒），避免把玩家直接彈出視野。寫進 README。
5. **`mobGriefing` 遊戲規則未實作**：原版可用該規則關閉生物爆炸破壞方塊；本作一律會破壞（預設行為＝原版預設）。寫進 README。
6. **苦力怕的「取消引信距離 7 格」＝原版值**（2026-10-20 稽核修正：原計畫寫「10 格是近似值」——**那是誤推**。vanilla `SwellGoal#tick` 的常數是 `distanceToSqr(target) > 49.0` → **取消門檻就是 7 格**（三維距離、嚴格大於才取消），wiki 的「玩家必須移動 7 格」說的就是這個門檻本身。→ **本批採用原版值 7 格，README〈與原版的差異〉不需要列這一條**；要列的是「本作用**三維距離**量，與原版的 `distanceToSqr` 一致」這個說明。）
7. **蜘蛛攀牆是「簡化的完整方塊攀爬」**（不是原版的完整行為）：只爬完整方塊、**每次最多 3 格（障礙頂面 − 腳底 ≤ 3）**、只在追擊時發生、不爬下表面。**2026-10-20 稽核修正：規則統一成「障礙頂面 − 腳底 ≤ 3 → 可爬」**（原計畫的「3 格內有任一格不實心就可爬」與之相反，會讓 3 格牆不可爬）。原版可一路爬到高牆頂、失掉敵意後還會盲爬 2 秒。寫進 README。
   7b. **蜘蛛攀牆時不套重力與著地**（2026-10-20 稽核修正）：這是**實作正確性**的問題而不是簡化 —— 若攀牆時仍套著地吸附，蜘蛛每幀會被拉回腳下的地面、**永遠爬不上去**。→ 這條不進 README 的差異清單（它不是與原版的差異，是與原版相同的正確行為），但要在程式註解寫明「攀牆分支跳過重力／著地」。
8. **生怪不成群**：原版 Java 版一次生成 4 隻，本作沿用 B4 的「每 5 秒嘗試 1 隻」。寫進 README。
9. **苦力怕子上限 4 隻是本作自訂**（原版沒有）；總上限沿用 B4 的 12（原版 Monster cap 70）。**spec §6 的「生物上限低於原版（B9 後複評）」在本批已複評**：複評結論＝**維持 12 不調高**，理由是 12 隻敵對＋12 隻被動生物已在批末效能門檻內，而苦力怕會摧毀建築，靠「苦力怕子上限 4」控制風險比調高總上限安全。寫進 README。
10. **苦力怕摔落時的引信膨脹未實作**（原版摔落會額外累積引信）→ 本作引信固定 1.5 秒。寫進 README。
11. **爆炸傷害繞過玩家的 0.5 秒受擊無敵幀**（原版沒有無敵幀）；**蜘蛛咬傷則受無敵幀限制**（與其他生物一致）。這兩條在 Task 8（咬傷）與 Task 9（爆炸）明寫，避免實作者自行發揮。
12. **引信聲（Task 11）是可整個跳過的加分項**：跳過時必須寫進發布說明〈已知問題〉與 README（與 B4 的音效決策同一處理）。
13. **火藥／線／蜘蛛眼不掛任何進度**（spec §B9 只說「暫無用途」）→ `OBTAIN_UNLOCKS` 不動；擊殺苦力怕／蜘蛛仍會觸發既有的 `monster_hunter` 進度（沿用既有的 `mob-killed` 事件）。
14. **爆炸抗性表涵蓋合併後的全部方塊**（2026-10-20 稽核修正：原計畫只覆蓋 17 種方塊、其餘「填 `Infinity`（＝炸不壞）」→ **會讓十幾種方塊永遠炸不壞**，且與自己的「有限值」測試衝突）→ 本批**逐格填原版值、不准有 `Infinity`**（表在 Task 2）。
15. **苦力怕／蜘蛛適用 `DESPAWN_DISTANCE` 的過濾**（2026-10-20 稽核修正：原計畫漏了這條 → 它們會一路走回玩家）→ 與 B4 的殭屍／骷髏同一條規則（128 格）。寫進 README〈與原版的差異〉的「敵對生物上限」那條附近。
16. **被爆炸殺死的生物不觸發「玩家擊殺」的掉落條件**（2026-10-20 稽核修正：蜘蛛眼只在玩家（或寵物狼）擊殺時掉落；爆炸殺死 → 傳 `killedByPlayer: false`）。

## 未解／實作時複核清單

- ~~**苦力怕「離開即取消引信」的精確距離常數**~~ → **已解（2026-10-20 稽核修正）**：vanilla `SwellGoal#tick` 的常數是 `distanceToSqr(target) > 49.0` → **取消距離 7 格**（三維距離、嚴格大於才取消）；`canUse()` 的 `distanceToSqr < 9.0` → **觸發距離 3 格**。本計畫採用這兩個原版值，**不再是近似值**。出處：PaperMC/Paper 對 vanilla `net/minecraft/world/entity/ai/goal/SwellGoal.java` 的 patch 引用（2026-10-20 取得）。
- **`mobGriefing` 的預設值**：本批假設為 true（會破壞方塊）。複核方式：minecraft.wiki/Game_rule 的 `mobGriefing` 條目（預設欄位）。
- **爆炸暴露度的取樣細節**（27 點、方向性偏差 MC-232355）：本批用二值近似。複核方式：minecraft.wiki/Explosion「Exposure / Sample points」段；若之後要提高保真度，照那段的取樣網格實作。
- **爆炸方塊破壞的「射線強度隨機因子」（0.7–1.3）**：本批不實作。複核方式：minecraft.wiki/Explosion「Calculating which blocks to destroy」段；若之後要還原，需同時把球形候選改回 256 條射線（成本高，列為未來升級）。
- **苦力怕摔落膨脹**（`fallDistance × 1.5`，上限為引信 − 5 tick）：本批未實作。複核方式：minecraft.wiki/Creeper「Behavior」段的 fall swell 說明。
- **火藥／線／蜘蛛眼的未來用途**（火藥→火藥／炸藥；線→釣線、羊毛；蜘蛛眼→藥水）：本批無用途。複核方式：minecraft.wiki/Gunpowder、minecraft.wiki/String、minecraft.wiki/Spider_eye；等有合成系統擴充時再接。
- **蜘蛛攀牆的「最高 3 格」與「只在追擊時爬」是自訂值**：原版沒有這個上限。複核方式：minecraft.wiki/Spider「Behavior」段的攀爬描述＋實際遊戲觀察；本作目前沒有階梯／半磚，所以「完整方塊」的覆蓋率是 100%。
- **爆炸音效未實作**：本批只做引信聲（加分項）；原版的爆炸聲（`entity.generic.explode`，音量 4.0）未做。複核方式：minecraft.wiki/Creeper「Sounds」表。
- **被動生物在爆炸中的死亡與掉落**：本批會對 B4 的被動生物套用爆炸傷害並走 `rollMobDrops`（含熟肉規則未變）；原版被動生物同樣會被爆炸殺死。實作後目視確認一次。

## Self-Review 記錄

- **Spec coverage**：spec §B9 的每一條 → 任務對應如下。
  - 「苦力怕：HP 20」→ Task 4（`CREEPER_HP = 20`）＋ Task 4 測試 `'the creeper table matches the vanilla stats'`。
  - 「接近引信約 1.5 秒」→ Task 4（`CREEPER_FUSE_SEC = 1.5`、`CREEPER_TRIGGER_DIST = 3`、LOS 條件）＋ Task 4 的三則引信測試。
  - 「爆炸半徑約 3」→ Task 3（`CREEPER_EXPLOSION_POWER = 3`、`EXPLOSION_REACH_FACTOR = 4/3`）＋ Task 3 測試。
  - 「傷害與擊退隨距離遞減」→ Task 3（`explosionDamage`／`explosionKnockback` 原版公式）＋ Task 3 的距離邊界測試＋ Task 9（實際套用到玩家與生物）。
  - 「破壞方塊（掉落規則查證）」→ Task 2（爆炸抗性表）＋ Task 3（`explodeAt` 的破壞判定與 1/3 掉落）＋ Task 9（`world.setBlock` 與掉落生成）。
  - 「白天不燃燒（非不死系）」→ Task 4／Task 6 的設計決策（不進 B4 的 `stepSunBurn`）＋ README 差異條目。
  - 「掉落火藥（新物品，暫無用途）」→ Task 1（物品 + `MobDropKind` 擴充）＋ Task 8（擊殺掉落接線）。
  - 「引信聲列加分項」→ Task 11（可整個跳過，跳過要在發布說明記錄）。
  - 「蜘蛛：HP 16」→ Task 6（`SPIDER_HP = 16`）＋ Task 6 測試。
  - 「夜間生成」→ Task 7（沿用 B6 的 `canSpawnHostile`）＋ Task 7 測試。
  - 「亮處／白天中立（使用 B6 光照）」→ Task 6（`spiderAggression` 吃 `SpawnLight.internalSky`／`block`）＋ Task 6 的四則中立測試。
  - 「攀牆實作或簡化（釘死做法並記錄理由）」→〈已查證與設計決策〉§6（做法、理由、體驗影響）＋ Task 6 的三則攀牆測試 ＋ README〈與原版的差異〉條目。
  - 「掉落線與蜘蛛眼（新物品，暫無用途）」→ Task 1＋ Task 8。
  - 「生成沿用 B4 調校＋B6 光照規則」→ Task 7（沿用 `MAX_MOBS`／`findSpawnPos`／`surfaceYAt`／`canSpawnHostile`）。
  - 「驗收：生成／傷害／爆炸／掉落測試；效能」→ 〈批末驗收〉2／3／4／5／7。
  - spec §跨批次（版本節奏／README／發布）→ Task 12（0.12.0、README 兩段、`docs/releases/v0.12.0.md` 四段、pack＋validate）。
- **型別一致**：跨任務與公約 §4 的名稱一致——`SpawnLight`／`canSpawnHostile`（B6，沿用不重定義）、`MAX_MOBS`／`findSpawnPos`／`surfaceYAt`／`createMob`／`hasLineOfSight`／`xzDistance`／`DESPAWN_DISTANCE`（B4，沿用不重定義）、`rollMobDrops`／`MobDropKind`（B4，**只擴充**）、`damagePassiveMob`（B4，沿用）、`ItemId`／`ALL_ITEM_IDS`（公約 §4 共同原則）、存檔欄位**不新增**（公約 §3 的 B9 列＝本機 v6 不變、雲端 format 4 不變）。本批自產：`blastResistance`／`blastResistanceOf`（Task 2）、`explosion*`／`explodeAt`（Task 3）、`applyKnockback`／`kbVel`（Task 5）、`CREEPER_*`／`createCreeper`／`stepCreeper`（Task 4）、`SPIDER_*`／`createSpider`／`stepSpider`／`spiderAggression`（Task 6，`SPIDER_HOSTILE_LIGHT_MAX` 是 2026-10-20 改名後的唯一名稱）、`HOSTILE_SPAWN_WEIGHTS`／`chooseHostileKind`／`trySpawnHostile`（Task 7）。
- **Review Focus → 測試**：1→Task 2＋Task 3；2→Task 3；3→Task 4（`'an exploded creeper does not explode again'`）＋Task 9；4→Task 6；5→Task 6（2／3／4 格牆三則）；6→Task 7。逐條都有對應的測試名。
- **步驟掃描**：每個 Task 都是「先寫會失敗的測試 → 跑（紅）→ 實作 → 跑（綠）→ 全量 gates → commit」的固定節奏；實作步驟給的是簽名／常數／表格／判準與必做的接線點；演算法本身無法由簽名或測試決定的兩處（爆炸的逐格破壞判定、蜘蛛的攀牆狀態機）才給具體 body，其餘以表格／常數／介面描述，沒有 TBD、沒有「處理邊界情況」這類空話。
- **比例**：本檔以「決策＋介面＋測試」為主體；程式碼片段集中在**介面契約**（Task 3／4／6／7 的匯出清單）與**各 Task 的測試斷言範例**（Step 1），另有一處演算法 body（`explodeAt` 的球形破壞判定）—— 不逐字貼整支實作程式碼。
- **已知未測面**：`src/main.ts` 無測試（組裝根）——Task 7／8／9／10／11 的接線以人工步驟＋批末 Playwright 佐證，並在回報中列「未自動化」。
- **2026-10-20 終審修正摘要**（本計畫依最終跨計畫複核報告修正；修正點在正文以「（2026-10-20 終審修正：…）」標出）：
  1. **建議修正 #10（集中清單）**：Global Constraints 新增〈本批要改寫的既有測試（集中清單）〉——逐條列出「檔案＋既有測試＋改法＋理由」，含 `items.test.ts` 的兩處計數（寫成「讀現況 → 現況 + 3」）與 `mobs.test.ts` 的案例**搬移**（不是刪除）。
  2. **基數漂移**：Task 1 Step 1 原本舉例「合併後可能是 45/52/…」——那是過時的分支列舉；改成「**以讀到的現況為準**」，並註明本計畫群的合併順序下是 73 → 76。
