# WeCraft B17 經驗與附魔設計（0.20.0）

> 本文件是 B17 批次的設計與需求來源。母規格：`docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`
> （§5 明列「B16 後仍缺：經驗」）。批次範圍由使用者 2026-11-11 指示「開始下一步的改進，
> 不需要問我，按你的想法一直做」→ 內容由實作者決定。

## 1. 動機

經驗（XP）是目前規格清單上唯一明列的長期性缺口；而經驗若沒有用途就只是數字。
因此本批一次做完**經驗循環**與它的用途——**附魔台與五種附魔**：

- 挖礦／擊殺／冶煉／釣魚 → 經驗球 → 等級；
- 等級 → 附魔台 → 工具／武器／盔甲的附魔（效率／鋒利／保護／耐久／幸運）。

## 2. 目標與非目標

**目標**
1. 經驗球實體：從礦物破壞、玩家擊殺、熔爐取物、釣魚上鉤處冒出，磁吸並被玩家吸收。
2. 經驗模型：等級與到下級進度（vanilla 分段曲線），上限等級 100。
3. HUD：熱鍵列上方的綠色經驗條＋中央等級數字（創造模式隱藏，與血條一致）。
4. 附魔台方塊（id 49）＋背包圖示＋配方＋完整面板（滑鼠操作）。
5. 五種附魔（效率／鋒利／保護／耐久／幸運）具備**實際效果**。
6. 附魔存在 `ItemStack.ench`，走完整條存檔鏈（本機＋雲端＋箱子／熔爐／掉落物／游標）。
7. 兩個新進度（附魔師／經驗老到，總數 20 → 22）。
8. 誠實文件：README、發布說明、母規格同步。

**非目標（明示不做，寫進發布說明）**
- 附魔書、鐵砧、修補、附魔台等級隨機重骰、青金石、書架加成。
- 每件物品多個附魔（本作**每件最多一個附魔**；同一個附魔可升級到上限）。
- 附魔光澤（glint）動畫、附魔粒子；以紫色名稱前綴 `✦` 與面板文字代替。
- 生物生怪磚、村莊交易、幸運以外的新附魔。
- 手機裝置（`devices` 維持 `["desktop"]`）。

## 3. 約束（平台與 repo 規範）

- 存檔**附加欄位策略**（沿用 B10/B12 先例）：本機 `SavePayload` 維持 **v6**、雲端維持
  **format 4**、`cloudSave` 一字不動。回退舊版時 `xp`／`ench` 這兩個未知欄位會被舊版
  清洗掉（經驗與附魔消失），**不新增回退阻擋**——與盔甲回退同級，寫進發布說明。
- 方塊 id 與 tile 索引 append-only：方塊 49、tile 50–51（`TILE_COUNT = 52`）。
- 新物品 `enchanting_table`（第 116 個 ItemId）；配方 69 → 70。
- 遊戲仍須在跨來源 sandbox iframe 內可玩；附魔面板沿用既有 pointer-lock 釋放／重鎖流程。
- 不新增執行期依賴；純邏輯模組不得 import Three／DOM。

## 4. 經驗模型（`src/core/experience.ts`）

```ts
interface Experience { level: number; xp: number }  // xp = 這一級已累積的點數
const MAX_LEVEL = 100;
xpToNext(level) = level < 16 ? 2*level + 7
                : level < 31 ? 5*level - 38
                : 9*level - 158          // 原版 Java 曲線；level 夾在 0..MAX_LEVEL
```

- `createExperience()` → `{ level: 0, xp: 0 }`
- `addExperience(exp, amount)`：`amount` 非有限或 ≤ 0 → 回傳**同一參考**；否則逐級進位，
  到 `MAX_LEVEL` 後剩餘點數**丟棄**（不再累積）；有改變 → 全新物件。
- `spendLevels(exp, n)`：`n` 非正整數或 `level < n` → 回傳同一參考；成功 → `{ level: level−n, xp: 0 }`
  （花費等級會清空當前進度條，明示簡化）。
- `experienceProgress(exp)`：`level >= MAX_LEVEL ? 0 : xp / xpToNext(level)`（0..1，NaN 安全）。
- `normalizeExperience(raw)`：不可信輸入 → `{level:0,xp:0}`；level 取整夾 0..MAX_LEVEL；
  `xp` 夾到 `0..xpToNext(level)−1`（MAX_LEVEL 時 xp 強制 0）。

## 5. 經驗球（`src/world/xp-orbs.ts`）

```ts
interface XpOrb { id: number; value: number; pos; vel; age: number; pickupDelay: number }
```

常數：`ORB_GRAVITY = 20`、`ORB_HORIZONTAL_DRAG_PER_SEC = 0.1`、`ORB_SETTLE_OFFSET = 0.01`、
`ORB_BOUNCE_THRESHOLD = 3`（單次反彈 0.3）、`ORB_SPAWN_PICKUP_DELAY = 0.3`、
`ORB_PICKUP_RADIUS = 1.2`、`ORB_MAGNET_RADIUS = 4`、`ORB_MAGNET_DELAY = 0.5`、
`ORB_MAGNET_SPEED = 9`（格/秒）、`ORB_MERGE_RADIUS = 2.5`、`ORB_DESPAWN_AGE = 300`、
`MAX_XP_ORBS = 128`、`MAX_ORB_VALUE = 32767`。

- `spawnXpOrbs(orbs, value, pos, opts?)`：`value` 非正整數 → 同參考。優先與
  `ORB_MERGE_RADIUS` 內**最近**的球合併（value 相加，飽和 32767）；沒有可合併的才
  新增（id = max+1、隨機水平初速 ±1、y +2.5、`pickupDelay = 0.3`）。已達
  `MAX_XP_ORBS` → 改與最近的球合併（永遠不超過上限）。
- `stepXpOrbs(orbs, dt, playerPos, isSolidAt)` → `{ orbs, collected }`（collected = 本幀
  吸收的點數總和；純函式）：
  1. `dt` 非有限或 ≤0 → 原樣、collected 0；
  2. 磁吸：`age >= ORB_MAGNET_DELAY` 且與玩家（眼睛高度 = playerPos + 1.0）距離
     ≤ `ORB_MAGNET_RADIUS` → 以 `ORB_MAGNET_SPEED` 朝玩家等速直線移動（不做重力）；
  3. 未磁吸：重力＋積分＋水平阻力＋地面吸附（與 `drops.ts` 同型的 cell sweep 防穿地，
     單次反彈）；
  4. 吸收：`age >= pickupDelay` 且與玩家距離 ≤ `ORB_PICKUP_RADIUS` → 累加 value 並移除；
  5. `age >= ORB_DESPAWN_AGE` → 移除（未吸收的點數消失）。
- 與掉落物相同：**未載入區塊不建立**、`isSolidAt` 由呼叫端注入（水不算固體）。

## 6. 經驗來源（`src/world/xp-awards.ts`）

| 來源 | 點數 | 觸發點 |
| --- | --- | --- |
| 煤礦 `BLOCK.COAL_ORE` | 1 | 手動挖破且可收穫（生存） |
| 鐵礦 `IRON_ORE` | 1 | 同上 |
| 金礦 `GOLD_ORE` | 2 | 同上 |
| 鑽石礦 `DIAMOND_ORE` | 4 | 同上 |
| 殭屍／骷髏／苦力怕／蜘蛛 | 5 | **玩家造成的擊殺**（近戰、玩家箭；爆炸擊殺不算） |
| 雞／豬／羊／牛 | 1／2／2／3 | 玩家造成的擊殺 |
| 冶煉取物 | 1 × 取出數量 | 熔爐面板點產物（生存） |
| 釣魚 | 魚 2／垃圾 1／寶物 5 | 成功收線 |

- 純函式：`xpForOre(blockId)`、`xpForMob(kind)`、`xpForFishing(category)`、`xpPerSmelt()`。
- 創造模式**不發經驗**（與掉落一致）；經驗球是暫態、不跨存檔。
- 熔爐內容被挖掉噴出、爆炸掉落：**不發**經驗（與原版「取走才發」一致）。
- `?xp=<n>` 查詢參數（驗收專用，與 B15 `?weather=` 同級）：開局把生存經驗直接設為
  `n`（正規化後套用），供瀏覽器 smoke 使用；一般遊玩不帶此參數。

## 7. 附魔（`src/core/enchantments.ts`）

```ts
type EnchantmentId = 'efficiency' | 'sharpness' | 'protection' | 'unbreaking' | 'fortune';
interface Enchantment { id: EnchantmentId; level: number }
```

| id | 名稱 | 上限 | 適用 | 效果（本作簡化） |
| --- | --- | --- | --- | --- |
| efficiency | Efficiency | 5 | 鎬／斧／鏟／鋤 | 挖掘速度 **+（L²+1）**（只在工具種類正確時） |
| sharpness | Sharpness | 5 | 劍／斧 | 近戰傷害 **+（1 + 0.5×(L−1)）** |
| protection | Protection | 4 | 盔甲 | 每級視為 **+1 護甲點**（4%），與盔甲點數合計上限 80% |
| unbreaking | Unbreaking | 3 | 所有耐久物品 | 每次扣耐久有 **L/(L+1)** 機率不扣（L1 50%／L2 66.7%／L3 75%） |
| fortune | Fortune | 3 | 鎬 | 礦物額外掉落：**floor(L/2) 保證 +（奇數級 50%）＋1**（L1 50%／L2 +1／L3 +1 且 50% 再 +1） |

- 相容表（`compatibleEnchantments(item)`）：工具＝ efficiency＋unbreaking（鎬另加 fortune）；
  劍＝ sharpness＋unbreaking；斧＝ efficiency＋sharpness＋unbreaking；盔甲＝ protection＋unbreaking；
  弓／釣魚竿／打火石＝ unbreaking；其餘＝空。
- `normalizeEnchantment(raw)`：合法 id 且整數 level 1..上限 → 新物件；否則 `undefined`。
- `sanitizeEnchantFor(item, raw)`：先 `normalizeEnchantment` 再要求相容，否則 `undefined`。
- `rollEnchantOffers(stack, rng)`：
  - 已有附魔且未達上限 → `[{ enchant: {id, level+1}, cost: level+1 }]`（升級單一選項）；
  - 已達上限／不能附魔 → `[]`；
  - 無附魔 → 三個選項：tier 1..3，每個 tier 從相容清單擲一個 id，`level = tier`、
    `cost = tier`（1／2／3 級）。
- `applyEnchant(stack, enchant)`：回傳帶 `ench` 的新堆疊（覆寫舊附魔）。
- 效果查詢：`efficiencyBonus(stack)`、`sharpnessBonus(stack)`、`protectionLevels(set)`、
  `unbreakingAvoidChance(stack)`、`fortuneBonus(level, rng)`（回傳額外件數）。
- 顯示：`enchantmentName(e)`（英文名＋羅馬數字，如 `Efficiency III`）、
  `stackDisplayName(stack)`（`stackName` ＋ ` ✦ Efficiency III`）。
- **創造模式附魔免費**（cost 視為 0；與創造模式無限供應一致，明示簡化）。

## 8. 效果接線（沿用既有單一真值）

- 挖掘：`interact.ts` 的 `toolSpeed()` 在工具種類正確時 `+ efficiencyBonus(held)`。
- 近戰：新增 `meleeDamageFor(held)` ＝ `toolDamage(held?.item ?? null) + sharpnessBonus(held)`；
  `main.ts` 攻擊改用此函式。
- 減傷：`armor.ts` 的 `absorbArmorDamage()` 以 `min(20, armorPoints + protectionLevels(set))` 計算減傷
  （公式與上限不變）；墜落與飢餓仍不減免。
- 耐久：`damageStack(stack, amount, rng?)` 先擲一次 unbreaking（只在 `amount ≥ 1` 且可損耗時）；
  `rng` 預設 `Math.random`，測試可注入。既有呼叫端不帶 `rng`、無附魔 → 行為不變。
- 幸運：`spawnBlockDrop()` 對四種礦物在基礎掉落之外追加 `fortuneBonus()` 件（同一 rng 流）。

## 9. 附魔台（方塊 49、物品 116、配方 70）

- `BLOCK.ENCHANTING_TABLE = 49`：`hardness 5`、`blastResistance 1200`、`solid`、非透明 cube、
  `requiredTool: {kind:'pickaxe', level:0}`、`fastTool:'pickaxe'`、音效群組 `'stone'`；
  三面 tile：top = `T.ENCHANTING_TOP = 50`、side/bottom = `T.ENCHANTING_SIDE = 51`、
  `TILE_COUNT = 52`；貼圖為暗紫（黑曜石風）＋金色角飾（實際像素由實作者依既有 `put()` 畫法繪製）。
- 物品 `enchanting_table`：`ITEM_IDS`、`BLOCK_PAIRS`、`PLACEABLE`；不進 `HOTBAR_DEFAULT`。
- 配方（3×3，新 id `enchanting_table`）：
  ```
  . 金 .
  鑽 石 鑽
  石 石 石
  ```
  （1 金錠＋2 鑽石＋4 石頭；原版是 4 黑曜石＋2 鑽石＋1 書，本作沒有黑曜石與書——明示偏離。）
- 右鍵面板（`src/ui/enchanting.ts`，仿 furnace 面板）：
  - 標題「附魔台」；顯示手持物品（圖示＋名稱＋現有附魔）、目前等級、三個選項按鈕
    （或升級按鈕）與提示訊息；
  - 選項文字：`Efficiency III — 3 級`；等級不足 → `disabled`；不能附魔 → 顯示原因；
  - 點選項 → 擁有者驗證（等級足夠、選項仍有效）→ 扣等級（創造免費）→ `applyEnchant`
    → 刷新面板＋HUD；套用時發 `enchanted` 進度事件；
  - Esc／點背景關閉 → `setState('playing')`＋`relockCanvas()`（與熔爐同型）。
- `GameState` 新增 `'enchanting'`；`setState` 的無條件關閉清單加入 `enchantUi.close()`；
  右鍵分派鏈在**熔爐／箱子／床之後、手持物品分支之前**加入 `BLOCK.ENCHANTING_TABLE`
  （生存與創造都可開，創造免費）。
- 附魔作用對象＝當下選取熱鍵格；面板開著時選取不會變（按鍵被鎖）。

## 10. 存檔（附加欄位，格式不動）

- `ItemStack.ench?: Enchantment`：`sanitizeStack` 負責驗證／清洗；**所有**堆疊重建點
  必須保留（`InventoryModel` ctor／`addItem`／`setSlot`、背包 UI 右鍵手動重建、
  合成格 staging／歸還、掉落物（`DropEntity`＋`spawnDrop`＋`pickup`）、盔甲
  `normalizeArmorSet`、塊實體 `sameStack`／`spillBlockEntity`、雲端 `normalizeCloudStack`、
  `giveItem`、`dropSelected`、`dropAtPlayer`、熔爐取物／歸還）。
  `addItem` 的合併條件加上「附魔相同」；不同附魔不得合併。
- 玩家經驗：本機 `player.xp`（`SavePayloadV6` 附加欄位、`SaveSources.player.xp` 必填、
  `loadGame` 一律正規化回傳）；雲端 `CloudData.xp`（`buildCloudData` 寫、
  `acceptCloudData` 一律回傳、`mergeCloudData` 用**本機**）。兩邊皆 `normalizeExperience`。
- 回退限制：0.19.0 讀到新資料時 `xp` 被忽略、`ench` 被清洗（附魔與等級消失，存檔本身可讀）；
  回到 0.20.0 不會自動回來——與盔甲／重生點同級的明示限制。

## 11. HUD（`src/ui/xp-hud.ts`＋`ui.css`）

- `.xp-bar`：`position: fixed; bottom: 66px; width: 364px; left: 50%; transform: translateX(-50%);`
  `height: 4px; border: 1px solid #000; background: #1b1b1b;`（佔 66..72，熱鍵列頂緣 66、血條底 72）；
  內層 `.xp-bar-fill`（`background: #7ef23c`）。
- `.xp-level`：置中於 `.xp-bar` 上方（bottom 72 起、~11px 粗體、`#7ef23c`、黑描邊），
  佔血條列中央的空隙（心／雞腿在兩端）。
- `createXpHud(uiRoot)`：`set(exp | null)`；`null`（創造）隱藏兩者；變化才寫 DOM
  （等級或進度百分比；整數百分比 diff 即可）。**單一變更路徑**，不逐幀寫樣式。
- F3 新增一行 `Xp: L<level> <xp>/<need>`（插在 `Weather:` 之後、`Triangles:` 之前）；
  更新 `formatDebugLines` 的參數與既有順序釘子。
- 除錯鉤子：`__wecraft.xpState()`（`{level,xp,need}`）、`orbs()`（球數）、
  `enchants()`（手持格附魔或 null）。

## 12. 驗收

- 純邏輯測試：`core/experience.test.ts`、`world/xp-orbs.test.ts`、`world/xp-awards.test.ts`、
  `core/enchantments.test.ts`（含所有效果函式的邊界：非有限、上限、rng 注入）。
- 接線與整合：`main.wiring.test.ts`（來源呼叫點、面板分派順序、session 邊界）、
  `core/enchant-persistence.test.ts`（附魔走完 sanitize／inventory／cloud／drops／armor／
  block-entities 的 round-trip）、`world/save.test.ts`／`core/cloud-save.test.ts`
  （`xp` 附加欄位的遷移與舊記錄）。
- 渲染：`render/xp-orbs.test.ts`（真實 THREE Scene，無 WebGL）。
- UI：`ui/xp-hud.test.ts`、`ui/enchanting.test.ts`、`ui/ui.test.ts` 幾何與 F3 釘子。
- 全鏈：`npm run typecheck`、`npm test`、`npm run lint`、`npm run build`、`npm run test:perf`、
  pinned 工具 `pack-game.mjs`＋`validate-game.mjs`（ZIP 在產物目錄外）。
- 真瀏覽器 smoke（跨來源 sandbox iframe＋`dist/` 靜態伺服、xvfb-run 有頭 Chromium、
  probe 放 repo 外）：`?xp=` 設定等級 → HUD 條／等級顯示 → 創造取得附魔台與鑽鎬 →
  放置＋右鍵開面板 → 附魔成功（`__wecraft.enchants()` 證據）→ 經驗條隱藏於創造 →
  創造免費附魔；pointer lock 的進入／退出。無法複刻的組合（平台頂層原生全螢幕＋
  Keyboard Lock）列為未驗證。

## 13. 發布

- 版本 **0.20.0**（`game.json`＋`package.json`＋README＋`docs/releases/v0.20.0.md`）。
- **不推 tag、不建 Release、不呼叫平台 API**（未獲授權；與 B14–B16 相同）。
