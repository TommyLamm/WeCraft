# WeCraft B1→0.10.0 全域審查報告

- **審查日期**：2026-10-26
- **基準**：`master@a79bdba`（tag `v0.10.0`）／工作樹乾淨／**唯讀審查**（未改任何程式檔、未推 tag、未建 Release）
- **對象**：WeCraft 0.10.0（瀏覽器體素沙盒，TypeScript strict + Three.js + Vite + Vitest，Playroom `id` = `wecraft`）
- **範圍**：B1（0.4.0）→ B7（0.10.0）全部交付，程式碼當前狀態（非 diff 審查）
- **上游規格**：2026-10-26 讀取 Playroom `main` 模板全文 + §1 七份文件（game-development／save-compatibility／sdk-versioning／command-contracts／game.schema.json／game-release.yml／starter playroom-sdk.js）。未發現上游與本 repo `AGENTS.md` 衝突。

---

## 0. 驗證閘門（審查者實跑，全綠）

| 閘門 | 指令 | 結果 |
|---|---|---|
| 型別檢查 | `npm run typecheck` | **PASS**（exit 0） |
| 測試 | `npm test` | **PASS — 78 files / 1521 tests**（exit 0） |
| 建置 | `npm run build` | **PASS**（主包 654.92 kB / gzip 181.85 kB） |
| 打包 | pinned `pack-game.mjs`（tools 1.2.0） | **PASS**，`game.zip` = **342,174 B** |
| 成品驗證 | pinned `validate-game.mjs` | **PASS** — `Valid: wecraft v0.10.0 (tools 1.2.0)` |
| 工具鎖 | `.playroom/tools/…1.2.0.zip` SHA-256 | **與 `.playroom/game-tools.lock.json` 相符**（`24a2fd36…f022`） |
| SDK | `public/playroom-sdk.js` vs 上游 `main` | **位元組完全相同**（sha256 `cadcf84c…58b`，SDK 1.1.0） |
| Workflow | YAML 解析 | **合法**、12 steps、無重複鍵、無 job 層 `runner:` |
| 版本對齊 | SDK 1.1.0／protocol 1／schema 2／tools 1.2.0；`game.json` 版本 vs tag | **一致** |

程式規模（實測，與現況敘述吻合）：生產 `.ts` **81 檔 / 20,225 行**、測試 **78 檔 / 22,189 行**、CSS 629 行。

> 閘門全綠**不等於**功能正確：下列 Critical／Important 全部是在 1521 個測試全過的情況下被發現的。

---

## 1. 總評

**程式品質高、測試紀律紮實、發布工程正確，但不建議以現況再發新版。**
有 1 項 Critical 的**靜默資料遺失路徑**（雲端衝突自動覆寫），加 8 項 Important 的驗收缺口（其中 3 項是 B1–B7 交付條目本身未達成）。

`v0.10.0` 已於 2026-10-25 發布，依上游規則「修正已發布成品須增加版本、不覆寫既有 Release」，下一波應為 **0.10.1**。

---

## 2. Critical

### C1｜雲端 revision 衝突靜默覆寫場中進度，且自動 checkpoint 破壞 requestId 冪等性

- **位置**
  - `src/main.ts:2027-2057` — `resolveCloudConflict()`：衝突後重讀雲端，直接 `applyCloudData(fresh.data)` 套用場中狀態，未詢問玩家。
  - `src/main.ts:1946` — `pendingCloud = { data, requestId: crypto.randomUUID() }`（無條件覆寫既有快照）。
  - `src/main.ts:3024` — 60 秒 interval checkpoint 觸發 `saveCloudNow('interval')`。
  - `src/main.ts:1954` — 同檔註解宣稱「retry reuses this SAME object（frozen requestId）」，**與實作矛盾**。
- **可重現機制**
  1. 某次 checkpoint **回應遺失**（伺服器已寫入 rev N+1，客戶端仍持 N）→ 網路錯誤分支保留 `pendingCloud`、`cloudRetryable = true`（`src/main.ts:2011-2016`）。
  2. 60 秒後 interval checkpoint 覆寫 `pendingCloud` → **原 requestId 永久遺失**，無法依平台契約「回應遺失時沿用同一 requestId」重試。
  3. 新快照帶舊 revision 送出 → 必得 409 → `resolveCloudConflict()` 不問玩家就套用「另一裝置的**較舊**資料」，並 toast「雲端有新進度，已同步」（此情境下該 toast 內容不實）。
  4. 玩家近 60 秒的挖掘／背包進度被靜默覆蓋，且無合併選項。
- **違反的上游契約**
  - `docs/save-compatibility.md`：`SAVE_REVISION_CONFLICT` →「須重新讀取後**選擇／合併**」。
  - `docs/game-development.md`：「網路失敗重試同快照沿用 requestId」。
- **修法**
  1. 衝突改為三選一 UI（保留本機／採用雲端／合併）；玩家決定前禁止寫入、禁止清 `pendingCloud`、禁止更新 `cloudRevision`。
  2. `saveCloudNow()` 遇既有可重試快照時，**先以原 requestId 重送**，不得換 ID。
  3. 補負向測試：回應遺失後的下一次自動 checkpoint 必須沿用同一 `requestId`；409 後不得自動套用遠端資料。

---

## 3. Important A 級（建議 0.10.1 必修）

| # | 問題 | 證據 | 影響／修法 |
|---|---|---|---|
| A1 | **標題畫面被雲端初始化阻塞**：`setState('title')` 排在 `await cloud.init()`（SDK 內建 8s 逾時／wrapper 10s）、`await loadGame()`、`await cloud.load()`（SDK 15s）之後；`main.ts:2629` 註解宣稱「cloud init never blocks the title」，**實作相反** | `src/main.ts:2636-2682` | 平台不回應時玩家看到「世界在轉但沒有按鈕」數秒～十數秒，易誤判當機。修法：先立即掛標題（Continue 先 disabled），雲端改背景載入後更新按鈕狀態 |
| A2 | **未驗證 `saved:true` 就記為成功**：`cloud.save()` 只回傳 `{revision}`，丟掉 `saved` 旗標；`main.ts:1984` 直接更新 revision；UI 顯示「雲端：已同步」 | `src/platform/playroom.ts:156-159`、`src/main.ts:1978-1988`、`src/ui/menus.ts:240-241`；型別層已要求 `saved: true`（`src/platform/playroom-sdk-types.ts:28`） | 平台未確認持久化時遊戲宣稱已同步，且 revision baseline 被錯誤更新 → 後續重試帶錯版本。修法：`save()` 檢查 `res.saved === true`，否則視為未存檔（保留快照、可重試）；UI 未確認前顯示「尚未同步」 |
| A3 | **本機存檔失敗被吞**：Save & Quit 的 IDB 拒絕仍直接回標題且無任何提示；autosave / beforeunload 失敗全靜默 | `src/main.ts:1596-1605`、`1815-1825`、`2527-2532` | quota／權限失敗時玩家以為已存 → 進度遺失且無重試入口。修法：失敗要 toast + 提供重試；Save & Quit 失敗不得靜默退出 |
| A4 | **UI 擁有狀態未納入 session 邊界 → 掉料或複製**：`craftGrid`／`craftExcess` 只在**新局**清（`main.ts:2250-2251`），`continueGame` 與 `quitToTitle`（`main.ts:2162-2170`）都不清；面板開啟時存檔刻意跳過沖刷（`main.ts:1789`）；游標餘量只存在於 UI closure（`src/ui/inventory.ts:298-307`） | `src/main.ts:527-546`（`resetCraftGrid` 溢出物停在 `craftGrid`/`craftExcess`，而 payload 只收 `slots`） | ①舞台化材料→關背包→Esc→「回到標題」(不存檔)→繼續遊戲→再開背包 → `main.ts:1659` 的 `resetCraftGrid(2)` 把舊舞台材料灌進已還原背包 = **複製**；②背包滿時游標餘量留 closure → 新局後開背包 = **複製**；③面板開著時 autosave → 舞台材料**遺失**。修法：`quitToTitle`／`continueGame`／`applyCloudData` 一律清空或安全 drain UI 狀態；payload 不再漏掉舞台材料 |
| A5 | **被動生物夜間生成**：`canSpawnPassive` 只看「客戶端天空光（時間無關，地表恆 15）」，被動生成排程無白天閘門；程式碼註解明載「B6 起夜間地表仍可生成」 | `src/world/spawn-rules.ts:39-45`、`src/world/lighting.ts:465-479`、`src/main.ts:2993-3006` | 直接違反 B4 交付「**白天**…生成」與 repo 自己的 `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md:195`（「夜晚不生成」）、`:253`（「被動白天、敵對夜間／暗處」）。**更糟：`spawn-rules.test.ts:32-38`、`passive-mobs.test.ts:465-477` 把錯誤行為釘成測試**。修法：加 `isDaylight(clock.t)` 閘門並改測試 |
| A6 | **被動群組可能只有 1 隻**：只要求 `created.length ≥ 1`；上限夾制還會把 4 隻截成 1 隻 | `src/world/passive-mobs.ts:700-724` | 違反 B4「成群 2–4」。**需裁決**：改 code（少於 2 隻視為本輪失敗）或改 spec（B4 計畫曾刻意允許） |
| A7 | **按住右鍵會連續吃多份**：完成 1.6s 後 `elapsed` 歸零即回 `'eaten'`，無「放開才能再吃」鎖存 | `src/player/eat.ts:123-139`（探針實測 `eaten eaten`） | 違反「按住右鍵 1.6 s 進食」＝一次按壓吃一份；可灌飢餓／經驗。修法：`EatProgress` 加 `completed` 旗標，僅在放開或換物品時清除 |
| A8 | **編輯方塊同步卡頓 ~53 ms**：3×3 群組光照重算在主迴圈**同步**執行（每幀最多 2 次），同幀再同步重建網格 | `src/main.ts:1433-1440`、`1492-1504`；實跑 repo 自己的守門測試：`single-chunk relight (full 3x3 group + torch): best 52.6 ms (rounds: 55.6 / 54.5 / 53.3 / 53.5 / 52.6)` | 每挖／放一格方塊主執行緒停 3 幀以上（60fps 預算 16.7ms 的 3 倍），抵銷 B2「操控手感」批次的核心體感。守門會過是因為門檻設 100ms 且取 5 輪最快。修法：群組重算分幀／縮小粒度；守門改為「編輯→佇列→光照→mesh ≤ 33 ms」真路徑 |

---

## 4. Important B 級

| # | 問題 | 證據 |
|---|---|---|
| B1 | **仙人掌傷害穿透實心方塊**：腳下固定多掃 2 層且中途不檢查 solid → 站在石頭平台上、下方一格仙人掌仍每秒扣血。註解宣稱的「整格判定、身體框重疊才受傷」與實作不符 | `src/world/hazards.ts:68-78` |
| B2 | **cross 植被懸空**：破壞分支只呼叫 `popUnsupportedTorches`，無 cross 清理；mesher 渲染所有 cross → 花／草懸空，自然生成的 cross 在區塊重生後長回來（未記入 `modified`） | `src/main.ts:3213-3234`、`src/world/mesher.ts:774-788` |
| B3 | **未點光區塊被當成黑暗 → 白天生成敵對生物**：`chunk.light === null` 時 sky/internalSky/block 全回 0 → `canSpawnHostile` 為 true；生怪每 5 秒觸發 | `src/world/lighting.ts:101-109` + `src/world/spawn-rules.ts:49-50` + `src/main.ts:1268-1274` |
| B4 | **worker 無 timeout、同步退路可凍結 UI**：`request()` 只有 resolve（無 deadline／`messageerror`）→ worker 靜默掛住時 Promise 永久 pending；`degrade()`/`dispose()` 同步生成整個佇列（探針：一次 `fail()` 耗 285.4 ms） | `src/world/worker-client.ts:27-50,65-93`、`src/world/worker.ts:19-30` |
| B5 | **撞牆夾角／疾跑取消原因完全沒有 UI 消費者**：`lastWallAngleDeg`（`main.ts:418`）與 `lastCancel`（`sprint.ts:75`）只餵狀態機；暫停選單只教操作（`menus.ts:277-280`） | grep 全 repo 無第二處引用 |
| B6 | **3×3 合成來源列 36 格單行不換行** → 窄 iframe 右側來源格不可點（`.ui-craft-hotbar` 為 `display:flex` 無 wrap／overflow，36×48px+gaps ≈ 1664px） | `src/ui/ui.css:355-363` + `src/main.ts:1705-1709`（靜態幾何推得，未做瀏覽器量測） |
| B7 | **生存 HUD 壓到熱鍵欄**：hotbar `bottom:8px`（48px 格＋padding/border → 頂緣 ≈66px），vitals `bottom:52px` → 52–61px 重疊熱鍵列上緣 | `src/ui/ui.css:35-46` vs `:471-480`（靜態幾何確認） |
| B8 | **礦石是逐格灑點而非礦脈**：`placeOres` 對每 voxel 做 `hash2` 擲骰；深度帶／峰值／密度／統計都正確，但 6 鄰接叢集全部 size=1 | `src/world/ores.ts:119-155`；探針（16 chunk：117 gold / 54 diamond 全為孤立單格）。B5 條目寫「礦脈生成」→ **需裁決**（改 code 或改用語） |
| B9 | **「回到標題」不存檔且無二次確認**：與「儲存並離開」並列，誤按即丟最多 30 秒（autosave 間隔）進度 | `src/ui/menus.ts:309-310` + `src/main.ts:1579`、`2162-2170` |

---

## 5. Minor（16 項）

1. `addItem`／`removeItem` 未防小數與 NaN count（`src/core/inventory.ts:70-109`）— 現有呼叫端皆整數，屬防禦性缺口。
2. 本機存檔單槽 `slot1`、無跨分頁單調性保護（`src/world/save.ts:285-300`）。
3. `worldSeed` 被忽略且不驗證（`src/main.ts:2276-2283`；`isValidSavePayload` 放行 NaN／字串）；因無 seed UI，實務影響低。
4. `applyModified` 接受未知 block id（`src/world/world.ts:101-110`；id 999／-7 可寫入）。
5. 光照輸入未 clamp：`setLight({sky:-1})` 存成 15、emission 16 → 光源格比鄰格暗、NaN → 整片 0（`src/world/lighting.ts:119-132,355-368`）。
6. 火把掉落整合（`modified` 記 AIR＋掉落）只測到 `popUnsupportedTorches` 層，main 層無測試（`src/world/lighting.ts:650-671`、`src/main.ts:3224-3234`）。
7. F5 視角切換一幀不同步：相機用舊 `viewMode`（`src/main.ts:3038`）、模型／手持已用新 mode（`:3538`、`:3554`）→ front→first 一幀模型消失。
8. 仙人掌與生物共用同一個 0.5s 無敵窗（`src/main.ts:2824` vs `:1300`）→ 挨仙人掌後可免疫怪物傷害。
9. exhaustion 門檻用 `> 4`（`src/player/survival.ts:124`），上游為「累積 ≥4」；測試反向釘死。
10. `resetWorld()` 未清 particles（`src/main.ts:2206-2221`；`:3557` 每幀 sync）→ 上一局碎塊凍結懸浮於標題／新局。
11. cursor 數量 badge 樣式失效：`.count` 只定位 `.ui-slot .count`，游標堆疊是 `.ui-cursor-stack`（`src/ui/inventory.ts:131-139`、`src/ui/ui.css:71-80,283-295`）。
12. README 測試數字過時：寫 1509，實際 1521（`README.md:455,538`）。
13. README 物品數不一致：`:49` 寫 73（正確，現行 `ITEM_IDS` = 73）、`:520` 寫 72（該處為 B5 歷史敘述，易誤讀）。
14. `src/main.wiring.test.ts` 為字串／AST 掃描（例如要求 `audio.play(` 恰 6 次）→ 雲端流程改錯仍可能全綠。
15. 環境音在暫停／死亡時仍持續（僅 `quitToTitle` 停止）→ `src/main.ts:2163`。
16. **潛在 `dur` 洗白路徑**（現況不可達，因工具皆 stack-1：`src/core/items.ts:155-157`）：`src/player/eat.ts:95`、`src/world/furnace.ts:104,110`、`src/core/recipes.ts:482`、`src/ui/crafting.ts:155`、`src/ui/inventory.ts:177,182` 以 `{item,count}` 重建堆疊會丟 `dur`。

---

## 6. B1–B7 需求覆蓋矩陣

| 批次 | 交付 | 狀態 | 證據 |
|---|---|---|---|
| B1 | 飢餓 exhaustion＋自然回復 | ✅（門檻 `>4` 小爭議） | `src/player/survival.ts` |
| B1 | 雙模式記憶體＋本機 v3／雲端 stash | ✅ | `src/core/mode-stash.ts` |
| B1 | 破壞公式、工具等級、raw_iron、掉落表 | ✅ | `src/core/items.ts`、`src/world/drops.ts` |
| B1 | E 面板模式分流 | ⚠️ **近似**：生存是「可編輯 36 格＋2×2 合成」而非「唯讀背包」；創造有全物品清單 | `src/main.ts:1677-1679`、`src/ui/inventory.ts:274-288` |
| B1 | 新遊戲覆蓋警告 | ✅（single-fire modal，Esc＝取消） | `src/ui/menus.ts:174-205` |
| B1 | 0.5s 無敵＋紅色受擊＋戰鬥消耗 | ⚠️ 部分（與仙人掌共用窗口） | `src/player/invuln.ts` |
| B2 | 疾跑狀態機＋取消條件 | ✅ 邏輯完整／**UI 未回報原因** | `src/player/sprint.ts`、B5 |
| B2 | FOV 平滑 70→77 | ✅ | `src/core/fov.ts` |
| B2 | F5 三態視角＋方塊人模型 | ⚠️ 一幀不同步（Minor 7） | `src/core/view-mode.ts` |
| B2 | 右鍵／Q 連放 0.2s、Q 丟棄、Ctrl+Q、創造不作用 | ✅ | `src/player/hold-repeat.ts`、`src/player/drop.ts` |
| B2 | 潛行防摔邊、撞牆夾角回報、暫停提示 | ⚠️ 夾角**無 UI**（B5）、提示 ✅ | `src/ui/menus.ts:277-280` |
| B3 | 三層噪聲＋氣候、海平面 62 | ✅ | `src/world/terrain-noise.ts` |
| B3 | 8 生物群系 | ⚠️ 乾燥沙灘被標 ocean（B3 計畫刻意） | `src/world/terrain.ts:34-35` |
| B3 | 3 樹種、cross 植被、裝飾、仙人掌 | ⚠️ cross 懸空（B2）、仙人掌穿透實心（B1） | `src/world/trees.ts`、`src/world/decorations.ts` |
| B3 | WORLDGEN_VERSION＋一次性 toast | ⚠️ 雲端路徑可跨 session 重複提示（未複核） | `src/world/worldgen.ts`、`src/ui/worldgen-notice.ts` |
| B3 | worker 相容與效能 | ⚠️ 無 timeout、同步退路可凍結（B4） | `src/world/worker-client.ts` |
| B4 | 4 種被動生物＋AI＋13 新物品＋羊毛 | ✅ | `src/world/passive-mobs.ts`、`src/core/items.ts` |
| B4 | 生成規則（白天／草地泥土／≥24／2–4／上限 12） | ❌ **白天與成群 2–4 未達**（A5、A6） | `src/world/spawn-rules.ts`、`src/world/passive-mobs.ts` |
| B4 | 按住右鍵 1.6s 進食＋進度條 | ❌ **可連吃**（A7）／進度條 ✅ | `src/player/eat.ts`、`src/ui/eat-progress.ts` |
| B4 | 熔爐食譜＋小數燃料、擊殺掉落、葉子 0.5% 蘋果、殭屍不掉蘋果 | ✅ | `src/world/mob-drops.ts:61-84`、`src/world/drops.ts:112-131` |
| B4 | 敵對側對齊＋生怪光照判準 | ⚠️ 未點光誤判（B3） | `src/world/mobs.ts`、`src/world/spawn-rules.ts` |
| B5 | 5 新方塊、物品表（**73**）、工具表對齊、31 配方 | ✅ | `src/core/items.ts`、`src/core/recipes.ts` |
| B5 | **礦脈**生成 | ⚠️ 實作為密度灑點（B8，需裁決） | `src/world/ores.ts` |
| B5 | 36 格背包＋背包 UI＋本機 v4／雲端 f2 | ✅ | `src/core/inventory.ts`、`src/ui/inventory.ts` |
| B6 | 雙通道光照、跨區塊、破壞後更新、3×3 群組、佇列 | ✅ 正確性佳／**成本問題**（A8） | `src/world/lighting.ts` |
| B6 | 網格光照、簽章切分、shader uniform | ✅ | `src/world/mesher.ts`、`src/render/chunk-renderer.ts` |
| B6 | 火把（方塊／物品／配方／貼圖／放置／小模型／支撐掉落） | ✅（整合測試缺 Minor 6） | `src/world/blocks.ts`、`src/core/recipes.ts` |
| B6 | 光照不入存檔 | ✅ | `src/world/save.ts` |
| B7 | 20 把工具耐久＋清洗規則 | ✅（模型層正確） | `src/core/durability.ts` |
| B7 | 本機 v5／雲端 f3（readable 1–3） | ✅ 資料遷移正確／**雲端流程有 C1、A2** | `src/world/save.ts`、`src/core/cloud-save.ts` |
| B7 | 掉落物帶耐久、挖完／命中 −1、歸零消失＋音效＋toast、創造不扣 | ✅ | `src/world/drops.ts`、`src/main.ts:3145/3239/844` |
| B7 | 耐久條四段門檻（熱鍵／背包／合成來源列） | ✅ | `src/ui/durbar.ts` |
| B7 | 六條 UI 往返不洗白 | ✅（模型層）／⚠️ 見 A4 的 session 邊界問題 | `src/ui/inventory.ts`、`src/ui/crafting.ts` |

### 平台契約對照

| 契約項目 | 結果 | 證據 |
|---|---|---|
| 不跳頂層／不開 popup／不用相機麥克風／無表單 | ✅ | grep 全 repo 無違例 |
| 相對路徑、`base:'./'`、即時 iframe resize、0 尺寸守衛 | ✅ | `vite.config.ts`、`src/main.ts:2551-2564` |
| 手勢驅動音訊、不自行全螢幕／不鎖頂層鍵盤 | ✅ | `src/audio/engine.ts:56-93` |
| localStorage 依 game id 命名、儲存失敗仍可玩 | ✅ | `src/core/settings.ts:30,68-75` |
| 雲端 payload ≤ 64 KiB、`formatVersion` 正整數 | ✅ | `src/main.ts:1942`、`src/core/cloud-save.ts:41` |
| 讀取失敗 ≠ 空存檔 | ✅ | `src/main.ts:1925`、`2662-2677` |
| `SAVE_FORMAT_INCOMPATIBLE` 停止寫入並呈現 | ✅ | `src/core/cloud-save.ts:347`、`src/main.ts:1993-1998` |
| `readableFormats` 含 `writeFormat`、manifest 對齊 | ✅ | `game.json:13`、`src/core/cloud-save.ts:41,48` |
| Manifest schema 2／id 穩定／version 無 `v`／devices 誠實 | ✅ | `game.json` |
| **衝突 → 重讀並讓玩家選擇** | ❌ | **C1**（`src/main.ts:2027-2057`） |
| **回應遺失沿用原 requestId** | ❌ | **C1**（`src/main.ts:1946`） |
| **只有 `saved:true` 算已保存** | ❌ | **A2**（`src/platform/playroom.ts:156`） |
| ZIP 根含 `game.json`、大小限制 | ✅ | 實跑 pack ＋ validate（審查者已驗） |
| workflow 依模板、無 bypass、tag/manifest 一致、不覆寫 release | ✅ | `.github/workflows/release.yml` |

---

## 7. 審查者裁決：被降級或推翻的結論

| 代理原始結論 | 裁決 | 理由 |
|---|---|---|
| 無 `dur` 檢查 → Important | **Minor** | SDK 成功路徑必然回 `{saved:true,…}`（平台 `POST /games/:id/save` 契約），實際不可達；但 UI 仍不該宣稱「已同步」，故併入 A2 |
| `addItem` 小數／NaN count → Important | **Minor** | 所有呼叫端傳整數，屬防禦性缺口 |
| 礦脈非 vein → Important | **需裁決（B8）** | 需求同時寫了「密度模型」，實作符合後者、前者不符 → 屬需求文字落差，不是純 bug |
| 存檔 seed 未驗證 → Important | **Minor** | 無 seed UI 入口；雲端路徑有正確重建 seed |
| ocean biome 蓋到乾沙 → Important | **資訊／設計決定** | B3 計畫刻意把 beach 算 ocean，非缺陷 |
| 群組 1 隻 → spec/plan 二選一 | **Important（A6）** | 以 B4 交付「成群 2–4」為準 |
| UI 狀態問題 → Critical | **Important（A4）** | 需特定序列（舞台化／游標未歸還時離開）才觸發，非普遍路徑；但確為掉料／複製，必須修 |
| 3×3 來源列溢出、HUD 重疊 → Important | **保留 Important** | 靜態幾何推得，未做瀏覽器實測（已標註） |
| 標題阻塞 → Important | **保留 Important（A1）** | 最壞約 8s（平台不回應時），已標註觸發前提 |

---

## 8. 待裁決事項（5 項）

1. **礦脈定義**：B5 的「礦脈生成」是否要求真正的 blob／vein 叢集？目前是逐格密度灑點（B8）。
2. **被動群組數**：少於 2 隻時重試，還是接受 1 隻並修改 spec（A6）？目前 spec 與 plan 已漂移。
3. **生存 E 面板**：維持「可編輯 36 格＋2×2 合成」，還是改回字面的「唯讀背包」？
4. **exhaustion 門檻**：`> 4` 維持，還是對齊上游的 `≥ 4`（Minor 9）？
5. **「回到標題」**：加二次確認，或明示為「不存檔離開」（B9）？

---

## 9. 建議修正波（0.10.1）

### 波 1 — 資料與平台契約（Critical + A1–A4）

1. 雲端衝突改「保留本機／採用雲端／合併」三選一；`saveCloudNow` 遇既有快照用原 requestId 重送。
2. `cloud.save()` 檢查 `saved === true`；未確認前 UI 顯示「尚未同步」。
3. 標題先掛、雲端背景載入，Continue 先 disabled。
4. 存檔失敗可見（toast＋重試）；Save & Quit 失敗不得靜默退出。
5. `craftGrid`／`craftExcess`／游標納入 session 邊界：`quitToTitle`／`continueGame`／`applyCloudData` 一律清空或安全 drain；payload 不再漏掉舞台材料。

### 波 2 — 玩法正確性（A5–A7、B1、B2、B3、B5）

6. 被動生物改白天生成 + 群組恆 2–4（並改掉反向釘死的測試）。
7. 進食一次按壓只吃一份（`EatProgress.completed` 旗標）。
8. 仙人掌傷害加 solid 遮擋判定。
9. 破壞支撐方塊時移除 cross，並記入 `modified`（避免重生長回）。
10. 未點光區塊視為「未知」而非「暗」→ 該區塊不生怪。
11. 撞牆夾角／疾跑取消原因進 HUD（被動提示＋防 spam）。

### 波 3 — 效能與版面（A8、B4、B6、B7、B9）

12. 群組光照改分幀／縮小粒度；守門改為「編輯→佇列→光照→mesh ≤ 33 ms」真路徑。
13. worker 加 timeout；同步退路改分幀排空並顯示降級提示。
14. 3×3 來源列改 9 欄 wrap 或可捲動列。
15. 生存 HUD 上移，避開熱鍵欄。
16. 「回到標題」加二次確認或明示不存檔。

### 波 4 — 測試與文件紀律

17. 補負向測試：`saved:false`、preview mode、ready 逾時、response-lost 同 ID 重試、滿背包舞台＋Save&Quit、夜間被動生成 = 0、按住只吃 1 份、群組恆 2–4。
18. 把 `src/main.wiring.test.ts` 的字串掃描換成可注入 fake 的行為測試（雲端流程抽成獨立模組）。
19. 更新文件數字：README 測試數 1521（`:455`、`:538`）、物品數 73（`:49` 已正確，`:520` 為歷史敘述宜加註）。

---

## 10. 未驗證／本次未執行（不可宣稱通過）

- **真實瀏覽器驗收**：跨來源 sandbox iframe、平台原生全螢幕＋頂層 Keyboard Lock、pointer lock 與保留鍵（`Ctrl+W`）、窄 iframe 實測（B6／B7 為靜態幾何推得）、`3×3` 來源列真實溢出量測。
- **雲端 format 3 實機往返**、多裝置 revision 衝突實演。
- **音效聽感**（損壞音為程序合成近似音）、敵對生物命中實測。
- 平台端匯入／上架、GitHub Release 發布（無授權，未執行）。

---

## 11. 審查方法（附錄）

- **7 位審查代理**依職責分片並行審查，全部唯讀（禁止改檔、禁止 `npm run build`、禁止動 HEAD、禁止再派代理）：
  1. 資料模型／本機與雲端存檔（B1／B5／B7 資料面）
  2. 世界生成與地形內容（B3、B5 礦脈）
  3. 逐格光照與火把（B6）
  4. 生物／生成規則／掉落（B4）
  5. 玩家輸入／移動／互動／生存（B1、B2、B5、B7 互動面）
  6. UI 層（B1、B2、B5、B7）
  7. 組合根／渲染／音訊／平台整合／發布工程／測試品質
- **審查者本人**逐條複核（讀碼或實跑），並在第 7 節記錄被降級／推翻的代理結論。
- 審查期間工作樹全程乾淨、HEAD 未移動（`git status` 乾淨、`git rev-parse HEAD` = `a79bdba`）。

## 12. 文件與範本數字需要更新

1. **物品表是 73 不是 72**（B6 加入 `torch`；`src/core/items.ts` 實測 73 個 id）。
2. **測試數 1521 / 78 檔**（README 仍寫 1509）。
3. **B4 的「白天生成／成群 2–4」與現況不符**，且 repo 內 `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md:195` 亦與現況不符 → 修 code 或修 spec，否則測試會持續把偏離釘成「正確」。
