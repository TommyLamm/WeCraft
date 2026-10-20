# WeCraft B3 世界生成（0.6.0）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把世界生成從「4 種生態＋每柱 6% 橡樹」升級成原版風貌——多層噪音（海陸／侵蝕／山脊）產生海洋／沙灘／平原／丘陵／山地的明顯對比、8 種生態、3 樹種（橡木／雲杉／白樺）與 spec 表的樹密度、地表裝飾（蒲公英／罌粟／草叢／仙人掌／冰）與 mesher cross 型模型；並以 `worldgenVersion` 附加欄位＋一次性「地形已改變」提示處理舊存檔（決策 B 不保），最後發布 0.6.0。

**Architecture:** 生成邏輯全部抽成純模組放 `src/world`：`terrain-noise.ts`（三層噪音＋高度公式＋氣候）、`terrain.ts`（生物群系判定＋地表材質＋`generateChunk` 組裝）、`trees.ts`（樹種／樹形／密度／樹距）、`decorations.ts`（花／草／仙人掌／冰）、`worldgen.ts`（`WORLDGEN_VERSION` 與「是否要提示」判定）。渲染端在 `mesher.ts` 增一條 `foliage` pass（cross 型植被，DoubleSide、不投影），互動端在 `raycast.ts`／`interact.ts` 開「可被射線命中的非實心方塊」與「硬度 0 瞬破」。`src/main.ts` 仍是未測的組裝根，只做接線與一次性提示。

**Tech Stack:** TypeScript strict、Three.js、Vite、Vitest（jsdom）、IndexedDB（fake-indexeddb）、GitHub Actions release workflow。

**Spec:** `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md` §B3（L155–179）；跨批契約見 `/tmp/opencode/wecraft-planning/planning-conventions.md` §3–§7。

**執行方式:** SDD＋隔離 worktree，分支名 `b3-worldgen`（在計畫標注即可，不用建 branch）。每個 Task 是最小可獨立審查單元（TDD 循環、可獨立 commit）；批次最後由 controller merge、打 tag、push。

---

## Global Constraints

（出自 spec §B3、§1、§2、公約 §3–§7 與 `AGENTS.md`；每個任務都隱含本節。）

- 每個任務結束：`npm run typecheck`、`npm test`、`npm run build` 全綠；`npm run lint` 維持乾淨；**既有 806 個測試全部保留且不得弱化**（新增測試另計；本批會把 3 個 `pickBiome` 舊測試合併成 1 個新的、並改寫幾個硬編碼地形的舊測試——改寫後的斷言覆蓋率不得低於原測試，逐條見〈本批要改寫的既有測試（清單）〉；要改測試必須在 commit 訊息說明理由）。
- 版本：本批發布 `0.6.0`；`package.json` 與 `game.json` 同步；tag 為 `v0.6.0` 且指向含 bump 的 commit；不覆寫已發布版本；`id` 固定 `wecraft`。
- 存檔：**本機 payload 維持 v3、雲端維持 `readableFormats:[1], writeFormat:1`、`game.json` 的 `cloudSave` 不動**；本批只「附加」欄位 `worldgenVersion`（附加欄位政策：舊版讀到新欄位會忽略，舊存檔照讀）。`game.json` 的 `cloudSave` 區塊不得改動。
- **方塊 id 只能往後追加**：既有 `BLOCK.*` 的數值（0–16）不得重編號——舊存檔的 `modified` 記錄的是數字 id。**本批新增的 9 個方塊一律在本批補上物品形式**（`ItemId` union／`ITEM_IDS`／`BLOCK_PAIRS`／圖示路徑／`PLACEABLE`），因為既有 `src/core/items.test.ts` 有「每個 block（air／water 除外）都要有 item form」的不變量——新 id 若沒有物品形式，那條**既有**測試會紅（2026-10-20 稽核修正：原寫「B5 才補新方塊的『物品形式』，本批只把方塊資料表備齊」與既有不變量直接衝突）。**B5（0.8.0）不得重做這 9 個物品形式，只做它自己的 5 個**（`GRAVEL`／`GOLD_ORE`／`DIAMOND_ORE`／`SPRUCE_PLANKS`／`BIRCH_PLANKS`）——對應要求寫在〈與公約／spec 的差異〉第 1 條。**掉落**：本批只釘死三條規則（雲杉／白樺葉不掉、冰不掉、花草仙人掌掉自身，見 Task 3／4）；礦石掉落、物品→熔爐配方、創造清單捲動等仍留給 B5。
- 原版基準：Minecraft Java Edition 1.20+；數值以本計畫〈已查證與設計決策〉一節為準（逐條引 wiki 或標明「自訂值＋理由」）。
- 海平面維持 **62**；世界高度維持 **0–255**（不做 −64..320 擴張）；`CHUNK_HEIGHT` 不動。
- **不動 `Esc`／iframe／pointer lock／全螢幕既有路由**；本批不新增輸入。
- 發布候選跑固定工具：`.playroom/tools/playroom-game-tools-1.1.0.zip`（先驗 `sha256` 與 `.playroom/game-tools.lock.json` 一致）＋ `pack-game.mjs`＋`validate-game.mjs`；本機無 `unzip`，用 `python3 -m zipfile`。
- 本批改動到的「Minecraft parity」宣稱（地形、生物群系、樹、植被）要同步校正（各任務自己處理碰到的段落，Task 10 收斂 README）。
- 註解與文件用繁體中文（台灣用語）；識別字與程式碼英文。
- **行號基準**：`master @ b11273f`。本計畫內的行號以該基準為準；Task 2 之後 `src/main.ts` 行號會位移，後續任務以「當時檔案內容」為準（用錨點／程式碼片段定位，不要照抄行號）。

---

## 本批要改寫的既有測試（清單）

（2026-10-20 稽核修正：原計畫沒有這份清單，實作者會在 Task 3／4 撞到未預期的紅燈而誤刪既有斷言＝弱化不變量。**每一條都要寫進對應 Task 的 Step，並在 commit 訊息說明改寫理由**；不得刪除任何既有斷言，只能換掉「硬編碼舊生成器」的資料來源。）

| 檔案 | 既有測試 | 怎麼改（不得弱化） |
|---|---|---|
| `src/world/terrain.test.ts` | `'no trees on sand columns'` | → `'no tree grows on a sand column'`：種子 1337 的 64×64 範圍內有 **452 個沙柱**（沙漠＋海洋）→ 掃描式斷言不會空轉（Task 1 Step 5） |
| `src/world/terrain.test.ts` | `'columns below sea level are filled with water'` | → `'every column below sea level is filled with water up to sea level'`：**改用 chunk (2,−2)**（種子 1337 該塊有 69 個 `h<62` 的柱、地面高度 60–63）；原用的 chunk (0,0) 全是陸地（0 個水柱）→ 斷言會變成空轉。**必須先斷言 `waterColumns > 0`**（Task 1 Step 5） |
| `src/world/terrain.test.ts` | `'classifies the four biomes'`／`'uses strict thresholds'`／`'checks snow before forest'` | → 合併改寫成新的 `pickBiome({ height, temp, moist })` 判定測試（Task 2 Step 1）。**等號邊界必須補齊**（`temp = −0.24`／`temp = −0.12`／`moist = 0.20`／`moist = 0.00`／`h = 63`／`h = 64`／`h = 92`／`h = 91`），否則舊測試專測的「門檻等號落點」覆蓋會消失＝弱化 |
| `src/world/terrain.test.ts` | `'matches generateChunk's noise construction exactly (deterministic)'` | 氣候場的頻率／層數變了 → 改用 `terrain-noise` 的 `temperature`／`moisture` 重算並比對 `biomeAt`（Task 2 Step 1） |
| `src/world/terrain.test.ts` | `'agrees with the generated surface material at sampled columns'` | → `'the surface material matches the biome table'`：掃描柱，斷言表層方塊 == `surfaceBlockOf(biomeAt(x,z,seed), h)`（Task 2 Step 1） |
| `src/world/terrain.test.ts` | `'tree canopies are not clipped at chunk borders'` | → 樹種無關版：**改用 chunk (24,0)／(25,0)**（種子 1337；邊界帶 world x ∈ [398,401] 有 **3 棵橡木**：(400,5)、(401,8)、(400,12)），樹冠在兩塊各有葉子（22 格／38 格）且無重複寫入（Task 3 Step 1） |
| `src/world/blocks.test.ts` | `'requiredTool／fastTool data matches vanilla'` | 該表有**窮舉斷言**（每個 block id 都必須在表內）→ 補 9 列（id 17–25 的 `requiredTool`／`fastTool`），**不得刪掉窮舉斷言**（Task 3／Task 4） |
| `src/world/blocks.test.ts` | `'hardness table matches vanilla (Task 5)'` | 補 9 列硬度（2.0／0.2／2.0／0.2／0／0／0／0.4／0.5）（Task 3／Task 4） |
| `src/audio/sounds.test.ts` | `'maps every BLOCK id to its material group (table-driven)'` | 有**長度斷言**（`Object.keys(table)).toHaveLength(Object.keys(BLOCK).length)`）→ 補 9 列材質（Task 3 補 4 列、Task 4 補 5 列），**不得刪掉長度斷言** |
| `src/core/items.test.ts` | `BLOCK_ITEMS` 鏡像清單＋`'ItemId union covers every obtainable block item'`／`'ALL_ITEM_IDS is the canonical list'` 的計數 | 鏡像清單補 9 個 id；`ALL_ITEMS.length` 與 `ALL_ITEM_IDS.length` **讀現況基數 N → N + 4（Task 3）→ N + 9（Task 4）**（2026-10-20 終審修正：原計畫寫死「32 → 36 → 41」，那是「上游批次都還沒落地」的分支數字；**一律以 Task Step 1 讀到的當前值為準**，並在 commit 訊息註明實際值。本計畫群的合併順序下才是 32 → 36 → 41）。`'every block except air and block-only water maps to an item'` 這條**不變**——它正是要求本批補物品形式的守衛 |
| `src/render/textures.test.ts` | `'drawn tiles keep their content; empty layers are opaque magenta #ff00ff'` 內的 `for (const layer of [TILE_COUNT, 32, 47, 63])` | **改成 runtime 相對**：`for (const layer of [TILE_COUNT, TILE_COUNT + 1, 47, 63])`（`TILE_COUNT + 1 ≥ 64` 時省略該項；`TILE_COUNT + 1` 不得與 47／63 重複）。**這是全計畫群唯一的修復點**——本批之後 B4（34）／B5（39）／B6（40）／B8（41）的 `TILE_COUNT` 變化都自動適應，**後續批次（B5／B6／B8）不得再重複改寫這條**。改寫落在 **Task 3 Step 1**（本批第一次動這個檔案時；Task 3 實作後 `TILE_COUNT`＝27 → 清單 `[27, 28, 47, 63]` 全是未畫層 ✓；Step 1 當下 `TILE_COUNT` 還是 21 也一樣成立，因為清單是相對的）；**Task 4 Step 1 只驗證**——若 Task 3 漏改（清單仍是寫死的 `32`），Task 4 因 `T.ICE`＝32 已畫而必紅，**必須在 Task 4 補改**（Task 4 Step 1 已寫明此備援） |
| `src/render/chunk-renderer.test.ts` | `expect(scene.children).toHaveLength(2)`（L144／L159／L216）與 `toHaveLength(4)`（L250） | 每個 chunk 的 `scene.children` 由 2 個（opaque＋water）變 **3 個**（＋foliage，索引 2）；`scene.children[1]`（water）索引不變；空 chunk 仍為 0（Task 4 Step 5／6） |

---

## Review Focus

（spec 沒明說、但最可能咬人的失敗模式；每一條都已在對應任務放測試釘住。）

1. **舊存檔載入路徑不能被新欄位打斷**：`worldgenVersion` 缺失的舊 v1／v2／v3 記錄必須照讀、照遷移，且**不得**被自動補值（補了就看不出是舊存檔、也永遠不會提示）；缺欄位才提示、提示後寫入新值就不再提示 → Task 7（遷移與欄位語意）、Task 8（提示流程與持久化）。
2. **區塊邊界的樹不能被切斷、也不能重複寫入**：樹幹在鄰塊、樹冠跨邊界時，兩側都必須有葉子且同一格只能由一個區塊寫入 → Task 3（跨塊樹冠測試）；樹木的「樹距 ≥2」必須是**全域**性質（跨區塊邊界也不得貼在一起）→ Task 3（距離不變量測試）。
3. **統計測試必須是「固定種子＋明確容差」而不是「看起來差不多」**：高度分佈、海洋比例、生態面積、樹密度、裝飾密度全部釘死數字與容差；實作者不得為了讓測試變綠而放寬容差 → Task 1／2／3／6 的 `worldgen-stats.test.ts`。
4. **cross 型方塊不能破壞既有互動語意**：植被不可碰撞、但必須能被射線命中並瞬破；放置方塊到植被上要像原版一樣「覆蓋」而不是卡住 → Task 5（raycast／digStep／canPlaceAt 測試）。
5. **效能不能退化到卡幀**：區塊生成仍在 worker 執行、同步退路（worker 失效）也不能卡住主執行緒 → Task 9（生成時間預算測試＋worker 相容測試）。
6. **新方塊 id／貼圖層不可破壞舊存檔**：既有 0–16 的 block id 不得重編；新增 tile 不得超出紋理陣列 64 層、未畫的 tile 必須落在 `TILE_COUNT` 之內（否則變成洋紅除錯色）→ Task 3／4（blocks 與 textures 測試）。

---

## 已查證與設計決策

（公約 §7 B3 查證清單的結果；引註格式：`已查證（minecraft.wiki/<Page>，2026-10-20）`。抓不到原文者寫「實作時複核」。）

### 1. 海平面與世界高度

- 已查證（minecraft.wiki/Terrain features#Sea level，2026-10-20）：「**Air on altitude Y=62 and lower is replaced by water.**」→ 本作海平面維持 `SEA_LEVEL = 62`（既有常數不動）。
- 已查證（minecraft.wiki/Terrain features#Depth，2026-10-20）：depth 參數約在表面為 0，每下降 1 格增加 1/128 → 本作不實作 depth 參數（洞穴生態本輪不做），但保留「洞穴只有單一噪音門檻」的現況不動。
- **決策**：世界高度維持 0–255（`CHUNK_HEIGHT = 256` 不動）。新高度公式的實測最高點為 **126**、最低 **35**（見 §3），遠離 0 與 255，不需要也不會擴張世界。

### 2. 生物群系的六參數框架（原版對照）

已查證（minecraft.wiki/World generation#Biomes，2026-10-20）：Overworld 的生物群系由 **6 個參數**決定——temperature、humidity（aka vegetation）、continentalness（aka continents）、erosion、weirdness（aka ridges）、depth；其中前 5 個只看水平座標。原版分級：

| 參數 | 原版區間（引自上頁） |
|---|---|
| temperature | −1.0~−0.45／−0.45~−0.15／−0.15~0.2／0.2~0.55／0.55~1.0 |
| humidity | −1.0~−0.35／−0.35~−0.1／−0.1~0.1／0.1~0.3／0.3~1.0 |
| continentalness | −1.2~−1.05 蘑菇／−1.05~−0.455 深洋／−0.455~−0.19 洋／−0.19~−0.11 岸／−0.11~0.03 近內陸／0.03~0.3 中內陸／0.3~1.0 遠內陸 |
| erosion | −1.0~−0.78／−0.78~−0.375／−0.375~−0.2225／−0.2225~0.05／0.05~0.45／0.45~0.55／0.55~1.0 |
| weirdness（PV = 1−\|3·\|w\|−2\|） | −1.0~−0.85 谷／−0.85~−0.2 低／−0.2~0.2 中／0.2~0.7 高／0.7~1.0 峰 |

**本批採用的對應關係（自訂映射，理由寫明）**：

- continentalness → `CONT_FREQ = 0.001`（波長約 1000 格）的 3 層 fbm，經**分段線性 spline** 映射到「離海平面的高度差」；岸線的大陸度門檻取 `SHORE_CONT = -0.107`（實測約 30% 面積落在其下 → 水域 29%）。
- erosion → `ERO_FREQ = 0.0022` 的 3 層 fbm；`relief = clamp01((0.15 − ero) / 0.30)`，侵蝕越高越平坦（與原版「erosion 高 → 地形平」一致）。
- weirdness → `RIDGE_FREQ = 0.0045` 的單層 noise2，套用原版 PV 公式 `1 − |3·|w| − 2|`；`peak = clamp01(PV)` 決定山脊高度。
- temperature／humidity → `CLIM_FREQ = 0.002` 的 3 層 fbm（氣候鹽值沿用舊的 `seed ^ 0x9e3779b9`，但頻率由 0.004 改 0.002、層數由 2 改 3，讓生態塊更大）。**取樣形式已於 Task 1 定案（後續不可再改，見下方子條）**。
- depth → **不實作**（洞穴生態本輪不做，維持單一噪音門檻）。

**氣候場的取樣形式（Task 1 定案，後續任務一律照抄）**：

- `temperature(x, z) = clim.fbm2(x * 0.002, z * 0.002, 3)`
- `moisture(x, z) = clim.fbm2(x * 0.002 + 50, z * 0.002 + 50, 3)` —— **`+50` 是「縮放空間偏移」**：加在**乘過頻率之後**的座標上（沿用舊 `biomeNoise` 的 `x * 0.004 + 50` 寫法）。
- **不可改成世界空間偏移** `fbm2((x + 50) * 0.002, …)`：實測那會讓 §4 的 8 生態面積比例跑掉（forest 19.3%（容差 12%–18%）、desert 0.5%（容差 4%–10%），其餘 6 項也偏移）；**只有縮放空間偏移能逐格重現 §4 的表格**（8 項面積比例全部 0.1% 內吻合）。
- **grad noise 在格點恆為 0**（`src/core/noise.ts` 的 `noise2`：格點上 `xf = yf = 0` → 梯度項全為 0）→ 氣候場在「縮放後座標為整數」的格點上必然是 0（`x`、`z` 皆為 500 的倍數，含 `(0,0)`；實測 27 個格點取樣全部為 0）。**非格點則是正常值**（跨距取樣 65,536 點：temp ∈ [−0.698, 0.648]、moist ∈ [−0.679, 0.671]）。
- **後續計畫／測試不得再把「整數格點上兩場不相等」釘成斷言**（例如 `expect(temperature(0, 0, s)).not.toBe(moisture(0, 0, s))` 必然失敗——那是噪音原語的性質，不是欄位性質）。Task 1 已把該斷言改在非格點取樣（`[0.5,0.5]`、`[37,53.5]`、`[123.25,-456.75]`、`[-2048.5,512.25]`）。

### 3. 本批的高度公式與實測分佈（數字已釘死）

高度公式（`src/world/terrain-noise.ts`，逐字實作）：

```
cont  = contNoise.fbm2(x*0.0010, z*0.0010, 3)              // ≈ ±0.62
ero   = eroNoise.fbm2(x*0.0022+37.13, z*0.0022+37.13, 3)  // ≈ ±0.70
w     = ridgeNoise.noise2(x*0.0045+91.31, z*0.0045+91.31)  // ≈ ±1.0
pv    = 1 - |3*|w| - 2|                                    // 原版 PV 公式
relief = clamp01((0.15 - ero) / 0.30)                      // 0=平坦 1=崎嶇
peak   = clamp01(pv)
land   = clamp01((cont - (-0.107)) / 0.10)                 // 岸線以上才加起伏
h      = 62 + 2 + splineDelta(cont) + land*relief*(8 + 40*peak)
h      = clamp(floor(h), 4, 246)
```

（2026-10-20 稽核修正：三個噪音層的實測幅度是 ±0.62／±0.70／±1.0，**原註解寫的 ±0.42／±0.42／±0.7 偏低**——會誤導實作者以為門檻過寬而往下調。對應的測試門檻見 Task 1 Step 1 的 `'the raw noise layers stay inside their expected range'`（±0.75）。）

spline 節點（`cont → 高度差`）：`[-0.66,-34] [-0.45,-26] [-0.28,-17] [-0.107,-2] [0,3] [0.12,7] [0.28,11] [0.45,15]`（節點外夾取端點值）。

**實測分佈（種子 1337，跨距取樣：256×256 個取樣點、每點間隔 32 格 → 覆蓋 8192×8192 格）**：

| 指標 | 實測值 | 測試容差 |
|---|---|---|
| 最低高度 | 35 | 33–37 |
| p01 | 39 | 37–41 |
| p05 | 44 | 41–47 |
| p25 | 59 | 56–62 |
| p50（中位） | 69 | 66–72 |
| p75 | 76 | 73–79 |
| p90 | 82 | 79–85 |
| p95 | 89 | 85–93 |
| p99 | 106 | 100–112 |
| 最高高度 | 126 | 118–134 |
| **水域比例（h < 62）** | **29.0%** | 26%–32% |

**理由（為什麼這樣選）**：水域 29% 接近原版「陸地為主、海岸線清楚」的手感；中位高度 69 表示多數陸地是低海拔平原（符合現有 spawn 與移動手感）；p99 106 / 最高 126 表示有明確的高山帶（山地生態），但離 255 還很遠 → 世界高度不需要擴張。

### 4. 八生態的判定門檻與面積比例

判定順序（**順序即優先級**，前一項命中即定案；`terrain.ts` 逐條實作）：

| # | 條件 | 生態 |
|---|---|---|
| 1 | `h ≤ 63`（SEA_LEVEL+1） | `ocean`（含沙灘過渡帶：h 62–63 的岸邊） |
| 2 | `h ≥ 92` | `mountains` |
| 3 | `temp < -0.24` | `snowy_plains` |
| 4 | `temp < -0.12 且 moist > -0.26` | `taiga` |
| 5 | `temp > 0.08 且 moist < -0.08` | `desert` |
| 6 | `moist > 0.20` | `birch_forest` |
| 7 | `moist > 0.00` | `forest` |
| 8 | 其餘 | `plains` |

**實測面積比例（同一跨距取樣）與容差**：

| 生態 | 實測 | 容差 | 設計目標 | 選這個目標的理由 |
|---|---|---|---|---|
| ocean | 33.4% | 30%–37% | ~30% | 水域 29%＋岸邊過渡帶 4%；spec 說沙灘算進海洋生態 |
| plains | 16.5% | 13%–20% | ~17% | 平原是預設落腳點，要夠大又不該到處都是 |
| forest | 15.1% | 12%–18% | ~15% | 橡木林是玩家第一個「有樹可砍」的目標 |
| birch_forest | 7.6% | 5%–11% | ~8% | 白樺林是第二種樹的來源，稀有但找得到 |
| taiga | 8.7% | 6%–12% | ~9% | 針葉林（雲杉）在雪原與高山之間過渡 |
| snowy_plains | 7.7% | 5%–11% | ~8% | 雪原幾乎不長樹（0.05 棵/區塊），是「寒冷空地」 |
| desert | 6.9% | 4%–10% | ~7% | 沙漠是仙人掌與沙的專屬區 |
| mountains | 4.2% | 2%–7% | ~4% | 山地高而稀少，帶雪頂與裸岩 |

**地表材質對應（`terrain.ts` 的 `surfaceBlockOf(biome, h)`）**：

| 生態 | h 條件 | 表層 | 表層以下（y < h） |
|---|---|---|---|
| ocean | 全部 | SAND（海底與沙灘都是沙） | SAND |
| desert | 全部 | SAND | SAND |
| snowy_plains | 全部 | SNOW | DIRT |
| mountains | h ≥ 112 | SNOW | DIRT |
| mountains | 104 ≤ h < 112 | STONE | DIRT |
| mountains | 92 ≤ h < 104 | GRASS | DIRT |
| plains／forest／birch_forest／taiga | 全部 | GRASS | DIRT |

**霧色（`src/core/biome-fog.ts` 的 `BIOME_FOG_TINT` 擴充到 8 種）**：既有 4 色沿用（plains `0xffffff` 中性、desert `0xffd9a0`、forest `0xc2e0b2`、snow `0xe8f4ff`）；新增 `birch_forest 0xd2e8bc`（比 forest 稍亮）、`taiga 0xb8d4c8`（偏冷偏暗）、`mountains 0xdce6f2`（高山冷白）、`ocean 0xa8c8e8`（海藍）。`Record<Biome, number>` 是窮舉型別 → 新增生態時編譯器會強制補色（不會靜默漏掉）。

### 5. 樹種、樹形與樹密度

**樹種與樹形（`src/world/trees.ts`，`treeSpecies(biome)` 決定樹種）**：

| 生態 | 樹種 | 樹幹高度 | 樹冠規則（`d` = 距樹冠頂端的層數） |
|---|---|---|---|
| plains | oak | 4–6 | 既有形狀：葉層 `d ∈ [−2, +1]`，`d ≤ −1` 半徑 2、`d ≥ 0` 半徑 1 且去掉四角 |
| forest | oak | 4–6 | 同上 |
| birch_forest | birch | 5–7 | `d = 0` 半徑 1；`d = 1, 2` 半徑 2 但**去掉四角**（十字形，視覺較窄） |
| taiga | spruce | 6–9 | `d = 0` 半徑 0；`d = 1` 半徑 1；`d ≥ 2` 半徑 `d` 為偶數 → 2、奇數 → 1（層層收斂的錐形） |
| snowy_plains | spruce | 6–9 | 同上（雪原上只有稀疏的雲杉） |
| mountains | spruce | 6–9 | 同上（高山帶稀疏雲杉） |
| desert／ocean | — | — | 無樹 |

**樹距規則（spec：「樹間距至少 2 格」）**：以「**同生態內**的優先序局部極小值」實作——候選柱（生物群系允許樹種 ＋ 地面高度 > 63 ＋ 表面為草或雪 ＋ 雜湊優先序 < 該生態的候選機率 `TREE_P`）只有在「半徑 2 的 5×5 鄰域內沒有**同生態**候選的優先序比自己小」時才長樹。
- 結果：同生態的兩棵樹 **Chebyshev 距離 ≥ 3**（實測最小距離 = 3，spec 要求 ≥ 2 ✓）。
- 「同生態」限定：跨生態邊界不強制（否則森林邊緣的平原樹會被鄰居森林吃掉，密度會被系統性壓低）；這與原版「樹是按區塊的生物群系特徵分別生成」一致。

**候選機率與實測密度（`TREE_P`，每 256 柱 = 一個 16×16 區塊的面積）**：

| 生態 | `TREE_P` | 實測棵數／256 柱 | spec 目標 | 測試容差 |
|---|---|---|---|---|
| plains | 0.00045 | 0.116 | 0.05–0.2 | 0.05–0.25 |
| forest | 0.044 | 6.96 | 6–8 | 5.5–8.5 |
| birch_forest | 0.08 | 9.02 | 8–10 | 7.5–10.5 |
| taiga | 0.04 | 6.41 | 5–7 | 5.0–7.5 |
| snowy_plains | 0.0002 | 0.054 | 0–0.1 | 0–0.15 |
| mountains | 0.002 | 0.365 | 0–1 | 0.2–1.2 |
| desert | 0 | 0 | 0 | 0 |
| ocean | 0 | 0 | 0 | 0 |

（實測區域：連續 1024×1024 格、種子 1337；統計方式＝「該生態的樹棵數 ÷ 該生態的柱數 × 256」。）

（2026-10-20 稽核修正：`mountains` 的實測值由 0.454 改為 **0.365**——以本表自己的規則（TREE_P ＋ 5×5 同生態局部極小值）在 1024×1024 區域重算得 0.365（其餘 5 個生態的實測值與表一致：plains 0.116、forest 6.96、birch_forest 9.02、taiga 6.41、snowy_plains 0.055）。測試容差 0.2–1.2 同時涵蓋兩者，本批取 0.365 為準。）

### 6. 地表裝飾密度

**機率（每柱）與實測（每 256 個「草頂」可放置柱」）**：

| 裝飾 | 條件 | 機率 | 實測／256 可放置柱 | 測試容差 |
|---|---|---|---|---|
| 蒲公英 dandelion | 草頂、隨機選一種花 | plains/forest 0.0078、birch 0.0117、taiga 0.0039、mountains 0.0039 | plains 1.09／forest 1.06／birch 1.54／taiga 0.50／mountains 0.49 | ±0.6（依生態） |
| 罌粟 poppy | 同上（與蒲公英二選一） | 同上 | plains 0.96／forest 0.99／birch 1.55／taiga 0.49／mountains 0.41 | ±0.6 |
| 草叢 short grass | 草頂 | plains 0.10、forest 0.12、birch 0.12、taiga 0.08、mountains 0.05 | 覆蓋率 plains 10.2%／forest 11.9%／birch 12.0%／taiga 8.1%／mountains 5.0% | ±3 個百分點 |
| 仙人掌 cactus | 沙漠沙面 | 0.0059 | 1.36 棵／256 沙漠柱 | 0.6–2.4 |
| 冰 ice | 水柱且 `temp < -0.24`（雪原氣溫），且水深 ≥ 2 格 | 確定性（非機率） | 佔全部水柱 2.4% | 1.5%–4% |

**機率表補齊（`Record<Biome, number>` 是 8 鍵窮舉，缺一個就編譯不過）**：`FLOWER_PROBABILITY` 與 `GRASS_PROBABILITY` 在 `snowy_plains`／`desert`／`ocean` 三個生態的值都是 **0**（雪原不長花、沙漠只有仙人掌、海洋沒有地表植被）——表上只列了 5 個有值的生態，這裡補上（2026-10-20 稽核修正：原表只給 5 個值，實作者只能自行猜測另外 3 個）。

**仙人掌高度（wiki 已查證）**：已查證（minecraft.wiki/Cactus#Natural generation，2026-10-20）：「They generate as one (11/18 chance), two (5/18 chance), or three (2/18 chance) blocks tall.」「Cacti can generate only on sand and Red Sand.」→ 本作依此比例（1/2/3 格），只長在沙上。

**冰（wiki 已查證）**：已查證（minecraft.wiki/Ice#Natural generation，2026-10-20）：「Ice is generated by the Freeze Top Layer in blocks with a temperature below 0.15 – the biome's snowfall height. Here, it replaces the top water block if exposed to the surface. This is most common in Frozen Oceans, Frozen Rivers, Snowy Beaches…」→ 本作簡化：以「氣溫 < −0.24（雪原生態門檻）」取代原版的 snowfall height，取代水面頂端的水方塊；只在**雪原水體**形成（不對應原版的凍河／凍洋，README 記為簡化）。

### 7. cross 型模型規格

- `BlockDef` 新增 `shape: 'cube' | 'cross'`（預設 `'cube'`）。`cross` 的方塊：`solid = false`（無碰撞）、`transparent = true`（不遮擋 AO、不被視為不透明鄰居）。
- 渲染：`meshChunk` 新增第三條 pass **`foliage`**（`ChunkMesh = { opaque, water, foliage }`）。每個 cross 格子發出 **2 個 quad**：兩片對角平面（A：角點 `(x,y,z)`→`(x+1,y+1,z+1)`；B：角點 `(x,y,z+1)`→`(x+1,y,z)`），每片 UV 為 1 個 tile（`[0,0]–[1,1]`），法線為該平面的法向量（`(−1,0,1)/√2` 與 `(1,0,1)/√2`）。
- 材質：`MeshLambertMaterial({ alphaTest: 0.1, vertexColors: true, side: THREE.DoubleSide, fog: true })`（與不透明 pass 共用同一張 `DataArrayTexture` 與同一個 `onBeforeCompile` patch）。`castShadow = false`（cross 植被不投影整格方塊陰影）、`receiveShadow = true`。
- 互動：`raycast` 改用「可命中」判定（實心 **或** cross）→ 植被可以被挖掘；`hardness = 0` → 破壞時間 0 → **瞬破**；放置方塊到植被上時覆蓋植被（像原版），不是卡住。

### 8. 存檔版本與「地形已改變」提示

- `WORLDGEN_VERSION = 1`（`src/world/worldgen.ts`）——這是**第一版有編號的生成器**；未來任何改變地形外觀的批次（例如 B5 加入礫石／礦脈生成）都要把這個常數往上加。
- 本機 payload v3 **附加**欄位 `worldgenVersion?: number`；雲端 format 1 **附加**欄位 `worldgenVersion?: number`。兩者都「有則讀、無則視為舊存檔」。
- 載入舊存檔（欄位缺失或 ≠ 當前 `WORLDGEN_VERSION`）時：進遊戲的同時跳一次 **toast**（右上角通知）說明「地形已改變」，然後**立刻把新值寫回存檔**，之後不再提示。
- **與 B1.4 的新遊戲確認框區隔**（兩者互不干擾）：
  | | B1.4 新遊戲覆蓋警告 | B3 地形已改變提示 |
  |---|---|---|
  | 觸發 | 標題畫面按「單人遊戲」且**有**既有進度 | **載入既有存檔進遊戲**（Continue 或開機套用雲端進度） |
  | UI | `menus.showConfirm` 模態對話框（確定／取消，Esc＝取消） | `toasts.push` 右上角通知（非模態、自動消失） |
  | 目的 | 防止誤覆蓋進度 | 告知地形外觀已整片改觀 |
- **決策 B（不保）**（spec §B3.5、§5.12）：本作從不保存區塊，任何載入都是「從 seed 重新生成整個世界」再套用玩家改動 overlay → 換生成器＝**整片地形改觀**（建築可能浮空、埋入或入水）。本批不做 legacy 生成器分支，舊存檔一律套用新生成器。

### 9. 效能預算

- 實測（Node，本機）：單一 `generateChunk`（16×16×256，含高度／生物群系／樹木 halo／裝飾／洞穴噪音）約 **2–3 ms**（欄位掃描 ≈0.13 ms＋樹木 halo（森林區塊、逐鄰居重算）≈0.9 ms＋既有 y 迴圈／洞穴噪音 ≈1.5–2 ms）。（2026-10-20 稽核修正：原寫 1.7–2.0 ms 略為樂觀；**逐欄位的 height／biome 結果必須記憶化**，否則每區塊要重算 576×25 次欄位，預算會爆。）
- **預算**：單區塊 ≤ **8 ms**（目標 ≤ 3 ms）；主執行緒同步退路（worker 失效時 `worker-client.ts` 的 `drainPendingSync`）每幀最多處理佇列中的區塊，不得造成可感知的掉幀（≤ 16 ms／區塊仍可接受）。
- **回歸門檻（測試）**：連續生成 16 個區塊的總時間 < **500 ms**（≈31 ms/區塊；比 8 ms 預算寬約 4 倍，CI 慢也不會誤報，但足以抓到「單塊退化到 30 ms 以上」）；另斷言**任一單區塊 ≤ 50 ms**（抓單块病態）。
  - **8 ms/區塊的預算以「觀察值」回報，不作為 CI 硬門檻**：測試會印出實測的每塊毫秒數寫進回報；若 CI 機器的浮動造成假紅，硬門檻只會逼實作者去放寬它。（2026-10-20 稽核修正：原門檻 16 區塊 < 1500 ms ≈ 94 ms/區塊＝預算的 11.7 倍，退化成 40 ms/區塊仍然綠 → 「效能不能退化到卡幀」這條 Review Focus 沒有測試支撐。）
- worker 相容：`src/world/worker.ts` 的 `generateChunk(cx, cz, seed)` 簽名不變 → worker 端零改動；`TerrainWorkerClient` 的降級路徑不變。

---

## 檔案結構

| 檔案 | 動作 | 職責 |
|---|---|---|
| `src/world/terrain-noise.ts` | 新增 | 三層噪音（continentalness／erosion／PV ridges）＋氣候（temp／moist）＋spline＋`surfaceHeight`；依 seed 記憶化 Noise、逐欄位記憶化 height／temp／moist |
| `src/world/terrain-noise.test.ts` | 新增 | 高度公式與參考值測試 |
| `src/world/terrain.ts` | 修改 | `Biome` 擴到 8 種、`biomeAt` 新判定、`surfaceBlockOf`、`generateChunk` 改組成（地形→樹木→裝飾）、`SEA_LEVEL` 改由 terrain-noise 轉出 |
| `src/world/terrain.test.ts` | 修改 | 舊的硬編碼沙地／水地形測試改寫為「生成器無關」的掃描式測試 |
| `src/world/trees.ts` | 新增 | 樹種／樹形／候選優先序／樹距規則／樹木寫入（含跨區塊 halo） |
| `src/world/trees.test.ts` | 新增 | 樹形、樹距、跨塊樹冠測試 |
| `src/world/decorations.ts` | 新增 | 花／草叢／仙人掌／冰的確定性放置規則 |
| `src/world/decorations.test.ts` | 新增 | 裝飾規則測試（沙灘不長花、雪原不長花、仙人掌只長沙上…） |
| `src/world/worldgen.ts` | 新增 | `WORLDGEN_VERSION`、`needsWorldgenNotice(saved)` |
| `src/world/worldgen.test.ts` | 新增 | 版本常數與提示判定測試 |
| `src/world/worldgen-stats.test.ts` | 新增 | 統計驗收測試（高度分佈／水域比例／生態面積／樹密度／裝飾密度） |
| `src/world/blocks.ts` | 修改 | 新方塊 id（17–25）、`shape` 欄位、`isTargetable`、硬度／工具類資料、`PLACEABLE` 補 9 個新方塊 |
| `src/world/blocks.test.ts` | 修改 | 新欄位與資料表測試（既有窮舉表補 9 列） |
| `src/core/items.ts` | 修改 | 新方塊的**物品形式**：`ItemId` union／`ITEM_IDS`／`BLOCK_PAIRS`（Task 3 補 4 個、Task 4 補 5 個） |
| `src/core/items.test.ts` | 修改 | 既有鏡像清單與計數（讀現況基數 N → N + 4 → N + 9）隨新物品同步更新 |
| `src/audio/sounds.ts` | 修改 | 新方塊的材質群（sound material group）對照表 |
| `src/audio/sounds.test.ts` | 修改 | 既有材質表補 9 列（長度斷言不動） |
| `src/world/drops.ts` | 修改 | `dropItemFor`：雲杉／白樺葉不掉落、冰不掉落（花／草／仙人掌掉自身） |
| `src/world/drops.test.ts` | 修改 | 新掉落規則的斷言（既有斷言不動） |
| `src/ui/icons.ts` | 確認（多半不需改） | 方塊物品的圖示走既有「裁切 atlas 側面 tile」路徑（`drawBlockIcon`）→ 新物品**不需要**新畫圖，只需 `blockFromItem` 能查到 |
| `src/world/mesher.ts` | 修改 | `ChunkMesh` 加 `foliage` pass；cross 格子不進 cube pass；新增 cross quad 發射 |
| `src/world/mesher.test.ts` | 修改 | cross pass 測試（既有測試不動） |
| `src/render/chunk-renderer.ts` | 修改 | 第三條 mesh（foliage 材質 DoubleSide、不投影） |
| `src/render/chunk-renderer.test.ts` | 修改 | 既有 `scene.children` 數量斷言（2 → 3／4 → 6）隨第三條 mesh 更新 |
| `src/render/textures.ts` | 修改 | 新 tile 的圖樣（雲杉／白樺木與葉、花、草、仙人掌、冰） |
| `src/render/textures.test.ts` | 修改 | tile 數量與「未畫 tile 不得超出 TILE_COUNT」測試 |
| `src/world/raycast.ts` | 修改 | 改用 `world.isTargetable`（植被可被命中） |
| `src/world/world.ts` | 修改 | 新增 `isTargetable(x,y,z)` |
| `src/world/raycast.test.ts` | 修改 | cross 方塊可被命中的測試 |
| `src/player/interact.ts` | 修改 | `getBreakTime` 硬度 0 → 0；`digStep` 瞬破；`canPlaceAt` 允許覆蓋 cross |
| `src/player/interact.test.ts` | 修改 | 瞬破與覆蓋測試 |
| `src/world/hazards.ts` | 新增 | 仙人掌接觸傷害（純邏輯） |
| `src/world/hazards.test.ts` | 新增 | 仙人掌傷害測試 |
| `src/core/biome-fog.ts` | 修改 | 8 生態的霧色 |
| `src/core/biome-fog.test.ts` | 修改 | 新色釘值 |
| `src/world/save.ts` | 修改 | payload v3 附加 `worldgenVersion`（不覆蓋舊值） |
| `src/world/save.test.ts` | 修改 | fixture 補欄位＋舊記錄缺欄位的遷移測試 |
| `src/core/cloud-save.ts` | 修改 | `CloudData` 附加 `worldgenVersion`（format 維持 1） |
| `src/core/cloud-save.test.ts` | 修改 | 附加欄位的驗證／接受測試 |
| `src/ui/worldgen-notice.ts` | 新增 | 「地形已改變」toast 的文案與發送函式 |
| `src/ui/worldgen-notice.test.ts` | 新增 | 提示文案與「只發一次」的單元測試 |
| `src/main.ts` | 修改 | 接線（提示、存檔欄位、仙人掌傷害、生物群系取樣） |
| `README.md`、`docs/releases/v0.6.0.md`、`package.json`、`game.json` | 修改／新增 | Task 10 發布 |

---

### Task 1: 多層地形噪音（海陸／侵蝕／山脊）

**Files:**
- Create: `src/world/terrain-noise.ts`、`src/world/terrain-noise.test.ts`
- Modify: `src/world/terrain.ts`（`surfaceHeight` 改為委派；`SEA_LEVEL` 改由 terrain-noise 轉出）
- Test: `src/world/terrain-noise.test.ts`、`src/world/terrain.test.ts`、`src/world/worldgen-stats.test.ts`（新增）

**Interfaces:**
- Consumes: `Noise`、`hash2`（`src/core/noise.ts`）。
- Produces（後續任務依賴，名稱與簽名不得再改）：
  - `export const SEA_LEVEL = 62;`（terrain-noise 定義；`terrain.ts` 以 `export { SEA_LEVEL }` 轉出，既有 import 路徑不變）
  - `export const CONT_FREQ = 0.001; export const CONT_OCTAVES = 3;`
  - `export const ERO_FREQ = 0.0022; export const ERO_OCTAVES = 3;`
  - `export const RIDGE_FREQ = 0.0045;`
  - `export const CLIM_FREQ = 0.002; export const CLIM_OCTAVES = 3;`
  - `export const CONT_SHORE = -0.107; export const ERO_FLAT = 0.15; export const ERO_SPAN = 0.30; export const LAND_SPAN = 0.10;`
  - `export const RELIEF_BASE = 8; export const RELIEF_PEAK = 40;`
  - `export interface TerrainNoises { cont: Noise; ero: Noise; ridge: Noise; clim: Noise }`
  - `export function terrainNoises(seed: number): TerrainNoises`（依 seed 記憶化；同一 seed 必得同一組 Noise 實例）
  - `export function continentalness(x: number, z: number, seed: number): number`
  - `export function erosion(x: number, z: number, seed: number): number`
  - `export function peaksAndValleys(x: number, z: number, seed: number): number`（原版 PV 公式）
  - `export function surfaceHeight(x: number, z: number, seed: number): number`
  - `export function temperature(x: number, z: number, seed: number): number`
  - `export function moisture(x: number, z: number, seed: number): number`

- [ ] **Step 1: 寫 `src/world/terrain-noise.test.ts`（失敗）**

  測試名＋斷言（數字取自本計畫〈已查證與設計決策〉§3 的實測值）：

  - `'terrainNoises memoizes one Noise set per seed'`：`expect(terrainNoises(1337)).toBe(terrainNoises(1337))`；`expect(terrainNoises(1337)).not.toBe(terrainNoises(4242))`。
  - `'the raw noise layers stay inside their expected range'`：對 **釘死的 400 個取樣點**（`(i*37, j*53)`，i、j ∈ [0, 20) → 400 點；種子 1337），`continentalness` 全部 ∈ [−0.75, 0.75]、`erosion` ∈ [−0.75, 0.75]、`peaksAndValleys` ∈ [−1.2, 1]。
    （2026-10-20 稽核修正：原本是「400 個取樣點」但沒指定座標、且門檻是硬上限 ±0.7——實測 4,096 個取樣點中有 1 點 |ero| = 0.704（≈0.02%）→ 偶發紅。改成「釘死取樣點 ＋ ±0.75」，測試才可重現：該組取樣點的實測範圍是 cont [−0.281, 0.337]、ero [−0.404, 0.536]、pv [−1.000, 0.983]。）
  - `'surfaceHeight matches the pinned reference values'`（種子 1337）：
    ```ts
    const cases: Array<[number, number, number]> = [
      [0, 0, 67], [8, 8, 67], [16, 16, 67], [100, 50, 65], [-37, 220, 83],
      [512, 512, 75], [1024, 1024, 70], [-2048, 512, 93], [4096, -1024, 67], [123, -456, 59],
    ];
    for (const [x, z, h] of cases) expect(surfaceHeight(x, z, 1337)).toBe(h);
    ```
    （2026-10-20 稽核修正：`(100, 50)` 的釘死值由 **64 改為 65**——以本計畫 §3 的公式逐字重算得 65（原值 64 與公式不符，第一次跑就紅）。其餘 9 個點與種子 4242 的 5 個點皆與公式相符。）
    種子 4242：`(0,0) → 71`、`(8,8) → 70`、`(16,16) → 68`、`(100,50) → 68`、`(-37,220) → 94`。
  - `'surfaceHeight is deterministic and inside the world bounds'`：同一點兩次呼叫相等；所有取樣點的高度 ∈ [4, 246]（不得超出 0–255 的現行世界）。
  - `'the height formula keeps the sea level at 62'`：`expect(SEA_LEVEL).toBe(62)`；`'a column below sea level is water'` 由 Task 2 的 terrain 測試負責，這裡只釘 `SEA_LEVEL`。
  - `'temperature and moisture are independent fields'`：**（2026-10-20 Task 1 審查修正）原寫的 `expect(temperature(0, 0, 1337)).not.toBe(moisture(0, 0, 1337))` 不可實作**——grad noise 在格點恆為 0，而氣候場在 `(0,0)` 正好落在格點上 → 兩者必然都是 0（理由見 §2〈氣候場的取樣形式〉）。改為**非格點取樣**（`[0.5,0.5]`、`[37,53.5]`、`[123.25,-456.75]`、`[-2048.5,512.25]`）逐一斷言 `t !== m` 且兩者皆為有限數；另外把「格點上兩者皆為 0」這個原語性質一併釘住（`expect(temperature(0, 0, 1337)).toBe(0)`、`expect(moisture(0, 0, 1337)).toBe(0)`）。**後續計畫不得再把整數格點的不等式釘成測試。**

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/world/terrain-noise.test.ts` → Expected: FAIL（模組不存在）。

- [ ] **Step 3: 實作 `src/world/terrain-noise.ts`**

  - 鹽值（固定，寫死在模組內）：continentalness `seed ^ 0x2545f491`、erosion `seed ^ 0x7feb352d`、ridges `seed ^ 0x846ca68b`、氣候 `seed ^ 0x9e3779b9`（**氣候沿用舊 biome 噪音的鹽值**，只是頻率／層數改變）。
  - 取樣偏移（固定）：erosion `+37.13`、ridges `+91.31`；氣候的濕度場用 `+50` 偏移（沿用舊實作）——**是「縮放空間偏移」**（`fbm2(x * 0.002 + 50, …)`，加在乘過頻率之後的座標上），**不是**世界空間偏移 `fbm2((x + 50) * 0.002, …)`；兩者只差在格點上，而格點上 grad noise 恆為 0（細節與實測見 §2〈氣候場的取樣形式〉）。**取樣形式已於 Task 1 定案，後續不可再改。**
  - `peaksAndValleys`：`const w = ridge.noise2(x*RIDGE_FREQ + 91.31, z*RIDGE_FREQ + 91.31); return 1 - Math.abs(3 * Math.abs(w) - 2);`
  - `surfaceHeight`（逐字實作 §3 的公式）：
    ```ts
    const cont = continentalness(x, z, seed);
    const ero = erosion(x, z, seed);
    const pv = peaksAndValleys(x, z, seed);
    const relief = clamp01((ERO_FLAT - ero) / ERO_SPAN);
    const peak = clamp01(pv);
    const land = clamp01((cont - CONT_SHORE) / LAND_SPAN);
    const h = SEA_LEVEL + 2 + splineDelta(cont) + land * relief * (RELIEF_BASE + RELIEF_PEAK * peak);
    return Math.max(4, Math.min(CHUNK_HEIGHT - 10, Math.floor(h)));
    ```
  - `splineDelta`：節點 `[-0.66,-34] [-0.45,-26] [-0.28,-17] [-0.107,-2] [0,3] [0.12,7] [0.28,11] [0.45,15]`，節點外夾端點；線性內插。
  - `clamp01` 為模組內私有 helper。
  - **記憶化（效能，必做）**：`surfaceHeight(x, z, seed)`／`temperature`／`moisture` 的結果**必須按座標記憶化**（例如以 `seed`＋`x`＋`z` 為 key 的 `Map` 快取）。理由：`generateChunk` 每塊要對 16×16 個柱各算一次高度／氣候，而樹木 halo 與裝飾放置又會對鄰居柱重算 → 沒有快取就是每塊 576×25 次欄位計算，8 ms/區塊的預算會直接爆掉（2026-10-20 稽核修正：原計畫只寫「依 seed 記憶化」四個 `Noise` 實例，沒要求**逐欄位**結果的快取）。
  - 檔頭 doc 註解寫明：對應原版的哪個參數、為什麼用 spline、為什麼高度 0–255 沒被擴張。

- [ ] **Step 4: `terrain.ts` 改接新高度（不動生物群系邏輯）**

  - `terrain.ts`：刪掉舊的 `surfaceHeight` 實作與其 `heightNoise`／`noiseCache`，改 `export { surfaceHeight } from './terrain-noise';`（既有呼叫端 `src/main.ts:694`、`terrain.test.ts` 的 import 路徑不變）。
  - `terrain.ts` 的 `SEA_LEVEL`：`import { SEA_LEVEL } from './terrain-noise'; export { SEA_LEVEL };`（既有 `import { SEA_LEVEL } from './world/terrain'` 仍可用）。
  - **生物群系邏輯本任務完全不動**：`pickBiome(temp, moist)` 的舊簽名、舊門檻、`biomeNoise`（舊的 `seed ^ 0x9e3779b9` @ 0.004／2 層）全部保留 → 既有 `terrain.test.ts` 的生物群系測試不受影響。8 種判定與新的氣候場是 **Task 2** 的工作（避免同一個任務同時改「高度」與「分類」兩個變數）。
  - `generateChunk` 的地形材質分支（desert→sand、snow→snow、其餘→grass）暫時不變（此時生物群系仍只有 4 種）。

- [ ] **Step 5: 改寫兩個「硬編碼地形」的既有測試（生成器無關化）**

  舊測試把「哪一塊是沙地／哪一塊是水」寫死成座標，新生成器的地形本來就不同 → 這些測試會釘死在舊生成器上。改寫理由要寫進 commit 訊息。

  `src/world/terrain.test.ts`：
  - 舊 `'no trees on sand columns'`（硬編碼 chunk `(3,−2)`）→ 改寫為 `'no tree grows on a sand column'`：在種子 1337 的 64×64 格範圍內掃描所有「表層是 SAND」的柱，斷言其上方沒有任何原木（`BLOCK.LOG`）；若範圍內沒有沙柱則直接結束該案例（守衛 `if (sandColumns === 0) return;`）。
    - **（2026-10-20 Task 1 審查修正）**掃描範圍定為**世界座標 `(0,0)–(63,63)`（chunk `(0,0)`–`(3,3)`，玩家出生區）**，實測 **29 個沙柱**。原寫的「452 個沙柱」不成立：種子 1337 在 ±2048 範圍內的 **4,225 個對齊 64×64 視窗**中，沙柱數最小 0、最大 4,071，**沒有任何一個視窗是 452**（舊沙漠區 chunk `(3,-2)` 起的視窗是 2,769）。**以 29 為準**（並保留「範圍內確有沙柱」的額外斷言，避免案例變成空斷言）。
  - 舊 `'columns below sea level are filled with water'`（硬編碼 chunk `(−7,3)`）→ 改寫為 `'every column below sea level is filled with water up to sea level'`：**改取 chunk `(2,−2)`**（種子 1337 該塊有 **69 個 `h < SEA_LEVEL` 的柱**，地面高度 60–63 → 陸海交界），對每個 `h < SEA_LEVEL` 的柱，斷言 `y ∈ [h+1, SEA_LEVEL]` 全是 `BLOCK.WATER`。
    - **必須先斷言 `waterColumns > 0`**（守衛：種子 1337 的 chunk (0,0) 全是陸地、0 個水柱 → 用舊的 (0,0) 會讓整條斷言永遠不執行＝弱化；2026-10-20 稽核修正）。
  - 其餘既有測試（bedrock、洞穴、礦石、確定性、邊界高度）**不動**。

- [ ] **Step 6: 跑測試轉綠**

  Run: `npx vitest run src/world/terrain-noise.test.ts src/world/terrain.test.ts` → Expected: PASS。

- [ ] **Step 7: 新增統計測試 `src/world/worldgen-stats.test.ts` 的高度段**

  取樣方式（**固定，之後所有統計測試共用**；寫在測試檔頂端的 helper 區）：

  ```ts
  const SEED = 1337;
  const SAMPLE_N = 256;   // 256 × 256 個取樣點
  const SAMPLE_STRIDE = 32; // 每點間隔 32 格 → 覆蓋 8192 × 8192 格
  /** 跨距取樣點（等距抽樣 → 覆蓋大面積，避免只抽到單一氣候塊） */
  function samplePoints(): Array<[number, number]> {
    const pts: Array<[number, number]> = [];
    for (let j = 0; j < SAMPLE_N; j++)
      for (let i = 0; i < SAMPLE_N; i++) pts.push([i * SAMPLE_STRIDE, j * SAMPLE_STRIDE]);
    return pts;
  }
  function quantile(sorted: number[], q: number): number {
    const idx = (sorted.length - 1) * q;
    const lo = Math.floor(idx); const hi = Math.ceil(idx);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }
  ```

  測試名＋斷言（容差取自 §3 的表格）：
  - `'the ocean covers 26%–32% of the sampled world'`：`const water = points.filter(([x, z]) => surfaceHeight(x, z, SEED) < SEA_LEVEL).length / points.length;` → `expect(water).toBeGreaterThanOrEqual(0.26); expect(water).toBeLessThanOrEqual(0.32);`
  - `'the height distribution matches the pinned bands'`：p05 ∈ [41, 47]、p50 ∈ [66, 72]、p95 ∈ [85, 93]、p99 ∈ [100, 112]。
  - `'the world height is never expanded beyond 0–255'`：`expect(Math.min(...heights)).toBeGreaterThanOrEqual(0); expect(Math.max(...heights)).toBeLessThanOrEqual(255);`（實測 35 / 126）。
  - 這些測試用 `it('...', { timeout: 30000 }, ...)`（取樣約 0.1 s，留足 CI 餘裕）。

- [ ] **Step 8: 全量驗證**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → Expected: 全綠（既有 806 個測試**全部保留且不得弱化**；新增測試另計）。
  人工（記錄結果）：`npm run dev` → 新遊戲，站在出生點觀察遠景：**可分辨大片水面與岸線、平原的連續起伏（不再是「整片同一高度」）**。
  - **（2026-10-20 Task 1 審查修正）本條驗收條件原本要求在出生點看到「遠山帶」，但那在結構上不可達**：種子 1337 最近的 `h ≥ 92` 在 **≈230 格外**（Task 1 實測，取樣間隔 4 格；審查者獨立實測 ≈233），而 `renderDistance = 10` ＝ **160 格**、`FOG_FAR` ＝ **140**（`src/render/scene.ts`）→ 山帶落在可視範圍之外，屬**預期**而非缺陷。要看到山帶必須另外走到高地處或放大 render distance（見〈批末驗收〉第 3 點的記錄要求）。

- [ ] **Step 9: Commit**

  ```bash
  git add src/world/terrain-noise.ts src/world/terrain-noise.test.ts src/world/terrain.ts src/world/terrain.test.ts src/world/worldgen-stats.test.ts
  git commit -m "feat(worldgen): B3.1 海陸／侵蝕／山脊三層噪音與新高度公式（海平面 62 不變；舊的硬編碼地形測試改為生成器無關的掃描式）"
  ```

---

### Task 2: 八種生物群系與地表材質

**Files:**
- Modify: `src/world/terrain.ts`（`Biome` 型別、`biomeAt`、`surfaceBlockOf`、地表材質分支）
- Modify: `src/core/biome-fog.ts`、`src/core/biome-fog.test.ts`
- Modify: `src/world/terrain.test.ts`、`src/world/worldgen-stats.test.ts`
- 確認（不改檔）：`src/ui/hud.ts` 只印 `Biome: ${biome}` 原始 id → 新的 `Biome` union 不需改這支檔，現有 `ui.test.ts` 的 `'Biome: plains'` 斷言也不受影響。
- Test: 同上

**Interfaces:**
- Consumes: Task 1 的 `temperature`、`moisture`、`surfaceHeight`、`SEA_LEVEL`（全部來自 `src/world/terrain-noise.ts`）。
- **交接（Task 1 → Task 2，必做）**：Task 1 依「不動生物群系邏輯」的要求**刻意不碰** `terrain.ts` 的生態取樣 → `terrain.ts` 裡仍留著**舊的** `biomeNoise`（`new Noise(seed ^ 0x9e3779b9)` @ `0.004`／2 層）與 `biomeNoiseCache`，而 Task 1 新增的 `temperature`／`moisture`（`CLIM_FREQ = 0.002`／`CLIM_OCTAVES = 3`）**在本任務之前沒有任何呼叫端（是刻意留下的過渡狀態）**。
  - **Task 2 必須把 `biomeAt` 與 `generateChunk` 的生物群系取樣改接 `terrain-noise.ts` 的 `temperature`／`moisture`，不可沿用舊 `biomeNoise`。** 否則地形（Task 1 的新高度）與生態判定／霧色會用**兩套不同的氣候場**，互相矛盾（同一個座標的地表材質與 F3 的 `Biome:`／霧色可能對不上）。
  - 改接後**刪除** `terrain.ts` 的 `biomeNoise` 與 `biomeNoiseCache`（避免留下沒有呼叫端的死碼；`hash2` 仍被礦石判定使用，不可一併刪）。
  - 氣候場的取樣形式（縮放空間偏移 `+50`、格點恆為 0 的性質）已於 Task 1 定案 → 見 §2〈氣候場的取樣形式〉，**不得自行改寫**。
- Produces:
  - `export type Biome = 'ocean' | 'plains' | 'forest' | 'birch_forest' | 'taiga' | 'snowy_plains' | 'desert' | 'mountains';`（**取代**舊的 4 種 union）
  - `export function pickBiome(params: { height: number; temp: number; moist: number }): Biome`（純判定；順序即優先級，見 §4 表）
  - `export function biomeAt(x: number, z: number, seed: number): Biome`
  - `export function surfaceBlockOf(biome: Biome, height: number): number`（回傳 `BLOCK.*`；表層與表層以下分開給 `surfaceBlockOf`／`subsurfaceBlockOf`）
  - `export function subsurfaceBlockOf(biome: Biome): number`（ocean/desert → SAND，其餘 → DIRT）
  - `src/core/biome-fog.ts`：`BIOME_FOG_TINT` 擴到 8 個鍵（`Record<Biome, number>` 窮舉 → 少一個就編譯失敗）

- [ ] **Step 1: 改寫／新增測試（失敗）**

  `src/world/terrain.test.ts`（**Task 1 已把兩個硬編碼地形測試改寫為掃描式，本任務不再重寫它們**；既有 `surfaceHeight`／確定性／礦石／洞穴測試全部保留）：
  - 舊 `'classifies the four biomes'`／`'uses strict thresholds'`／`'checks snow before forest'`（`pickBiome` 舊簽名 `(temp, moist)`）→ 改寫為 8 種判定測試（**新簽名** `pickBiome({ height, temp, moist })`）：
    ```ts
    expect(pickBiome({ height: 50, temp: 0, moist: 0 })).toBe('ocean');
    expect(pickBiome({ height: 100, temp: 0, moist: 0 })).toBe('mountains');
    expect(pickBiome({ height: 70, temp: -0.30, moist: 0.2 })).toBe('snowy_plains');
    expect(pickBiome({ height: 70, temp: -0.16, moist: -0.10 })).toBe('taiga');
    expect(pickBiome({ height: 70, temp: 0.20, moist: -0.20 })).toBe('desert');
    expect(pickBiome({ height: 70, temp: 0, moist: 0.26 })).toBe('birch_forest');
    expect(pickBiome({ height: 70, temp: 0, moist: 0.09 })).toBe('forest');
    expect(pickBiome({ height: 70, temp: 0, moist: -0.12 })).toBe('plains');
    ```
  - 新 `'the biome thresholds are strict at the boundary'`（2026-10-20 稽核修正：舊測試 `'uses strict thresholds — boundary values fall through'` 專測「門檻等號落點」，合併改寫後**必須**把等號案例補回來，否則等於弱化既有測試）：
    ```ts
    // 高度門檻（規則 1／2）
    expect(pickBiome({ height: 63, temp: 0, moist: 0 })).toBe('ocean');    // h ≤ 63 → ocean
    expect(pickBiome({ height: 64, temp: 0, moist: 0 })).not.toBe('ocean'); // h = 64 不再是 ocean
    expect(pickBiome({ height: 92, temp: 0, moist: 0 })).toBe('mountains'); // h ≥ 92 → mountains
    expect(pickBiome({ height: 91, temp: 0, moist: 0 })).not.toBe('mountains');
    // 氣溫門檻（規則 3／4）
    expect(pickBiome({ height: 70, temp: -0.24, moist: 0.2 })).toBe('taiga');   // temp = −0.24 不再是 snowy_plains
    expect(pickBiome({ height: 70, temp: -0.25, moist: 0.2 })).toBe('snowy_plains');
    expect(pickBiome({ height: 70, temp: -0.12, moist: -0.10 })).toBe('plains'); // temp = −0.12 不再是 taiga
    // 濕度門檻（規則 6／7）
    expect(pickBiome({ height: 70, temp: 0, moist: 0.20 })).toBe('forest');     // moist = 0.20 不是 birch_forest
    expect(pickBiome({ height: 70, temp: 0, moist: 0.21 })).toBe('birch_forest');
    expect(pickBiome({ height: 70, temp: 0, moist: 0.00 })).toBe('plains');     // moist = 0.00 不是 forest
    // 沙漠門檻（規則 5）
    expect(pickBiome({ height: 70, temp: 0.08, moist: -0.08 })).not.toBe('desert'); // 兩個門檻都是嚴格不等於
    expect(pickBiome({ height: 70, temp: 0.09, moist: -0.09 })).toBe('desert');
    ```
  - 新 `'the biome order gives the earlier rule priority'`：`pickBiome({ height: 100, temp: -0.30, moist: 0 })` → `'mountains'`（高度優先於氣候）；`pickBiome({ height: 50, temp: 0.3, moist: -0.3 })` → `'ocean'`（海洋優先於沙漠）。
  - 新 `'biomeAt matches the pinned reference columns'`（種子 1337，見 §4 的參考點）：
    ```ts
    const cases: Array<[number, number, Biome]> = [
      [90, 30, 'desert'], [597, -393, 'snowy_plains'], [-492, -600, 'forest'],
      [576, -600, 'birch_forest'], [-192, -501, 'taiga'], [3, -468, 'mountains'],
      [183, -600, 'ocean'], [-159, -564, 'plains'],
    ];
    for (const [x, z, b] of cases) expect(biomeAt(x, z, 1337)).toBe(b);
    ```
  - 既有 `'matches generateChunk's noise construction exactly (deterministic)'`（用 `new Noise(seed ^ 0x9e3779b9)` 重算）→ **必須改寫**：氣候場的頻率／層數變了，該測試要改成用 `terrainNoise` 模組的 `temperature`／`moisture` 重算並比對 `biomeAt`。
  - 既有 `'agrees with the generated surface material at sampled columns'` → 改寫為 `'the surface material matches the biome table'`：掃描 16×16 區塊的取樣柱，斷言表層方塊等於 `surfaceBlockOf(biomeAt(x,z,seed), h)`。
  - 新 `'the surface table follows the biome rules'`：`surfaceBlockOf('ocean', 60) === BLOCK.SAND`、`surfaceBlockOf('desert', 70) === BLOCK.SAND`、`surfaceBlockOf('snowy_plains', 70) === BLOCK.SNOW`、`surfaceBlockOf('mountains', 120) === BLOCK.SNOW`、`surfaceBlockOf('mountains', 106) === BLOCK.STONE`、`surfaceBlockOf('mountains', 95) === BLOCK.GRASS`、`surfaceBlockOf('plains', 70) === BLOCK.GRASS`、`subsurfaceBlockOf('desert') === BLOCK.SAND`、`subsurfaceBlockOf('plains') === BLOCK.DIRT`。

  `src/core/biome-fog.test.ts`：既有 4 個顏色斷言保留，新增 4 個：`expect(BIOME_FOG_TINT.birch_forest).toBe(0xd2e8bc); expect(BIOME_FOG_TINT.taiga).toBe(0xb8d4c8); expect(BIOME_FOG_TINT.mountains).toBe(0xdce6f2); expect(BIOME_FOG_TINT.ocean).toBe(0xa8c8e8);`

  `src/world/worldgen-stats.test.ts` 新增生態面積段（容差見 §4 表）。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/world/terrain.test.ts src/core/biome-fog.test.ts src/world/worldgen-stats.test.ts` → Expected: FAIL（`pickBiome` 新簽名不存在、`BIOME_FOG_TINT` 少鍵）。

- [ ] **Step 3: 實作**

  - `terrain.ts`：
    - `Biome` union 換成 8 種（**不加中文名對照表**：F3 顯示原始 id，避免為了中文名去改 `ui.test.ts` 的既有斷言；README 的〈與原版的差異〉列出 id 對照）。
    - `pickBiome({ height, temp, moist })`：逐條實作 §4 的判定順序。
    - `biomeAt`：`const h = surfaceHeight(x, z, seed); return pickBiome({ height: h, temp: temperature(x, z, seed), moist: moisture(x, z, seed) });` —— **`temperature`／`moisture` 一律取自 `src/world/terrain-noise.ts`（`CLIM_FREQ = 0.002`／`CLIM_OCTAVES = 3`），不可沿用 Task 1 留下的舊 `biomeNoise`（0.004／2 層）**（見〈Interfaces〉的交接條）。
    - `generateChunk` 的材質分支改用 `surfaceBlockOf`／`subsurfaceBlockOf`（含「水下 ≤ SEA_LEVEL 是水」規則不變）；**生物群系取樣同樣改用新的 `temperature`／`moisture`**（不可保留 `biomeN` 的舊取樣）。
    - **刪除** `biomeNoise` 與 `biomeNoiseCache`（改接後已無呼叫端；`hash2` 仍被礦石判定使用，不可一併刪）。
  - `biome-fog.ts`：`BIOME_FOG_TINT` 補 4 個新鍵（值見上）。`applyBiomeTint` 的中性判斷不變（`plains` 仍是 `0xffffff`）。
  - `hud.ts`：**不改**（仍印 `Biome: ${biome}` 原始 id；`ui.test.ts` 的 `'Biome: plains'` 斷言因此不動）。

- [ ] **Step 4: 跑測試轉綠**

  Run: `npx vitest run src/world/terrain.test.ts src/core/biome-fog.test.ts src/world/worldgen-stats.test.ts src/ui/ui.test.ts` → Expected: PASS。

- [ ] **Step 5: 全量驗證＋人工**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → Expected: 全綠。
  人工（記錄結果）：開新世界走一段路：應依序看到平原、森林、白樺林、針葉林、雪原、沙漠、高山與海岸線；F3 的 `Biome:` 會顯示新 id；走到水邊確認岸邊是沙。

- [ ] **Step 6: Commit**

  ```bash
  git add src/world/terrain.ts src/world/terrain.test.ts src/world/worldgen-stats.test.ts src/core/biome-fog.ts src/core/biome-fog.test.ts
  git commit -m "feat(worldgen): B3.2 八種生物群系判定與地表材質（氣候場改為大尺度 fbm）"
  ```

---

### Task 3: 三樹種、樹形與樹密度

**Files:**
- Create: `src/world/trees.ts`、`src/world/trees.test.ts`
- Modify: `src/world/blocks.ts`（新增 SPRUCE_LOG／SPRUCE_LEAVES／BIRCH_LOG／BIRCH_LEAVES 的資料與 tile、`PLACEABLE` 補 4 個新方塊）、`src/world/blocks.test.ts`
- Modify: `src/core/items.ts`（4 個新方塊的**物品形式**）、`src/core/items.test.ts`
- Modify: `src/audio/sounds.ts`（4 個新方塊的材質群）、`src/audio/sounds.test.ts`
- Modify: `src/render/textures.ts`（新 tile 圖樣）、`src/render/textures.test.ts`
- Modify: `src/world/terrain.ts`（`generateChunk` 呼叫新的樹木模組；移除舊的 `plantTrees`）
- Modify: `src/world/terrain.test.ts`（樹冠跨塊測試改寫為樹種無關）、`src/world/worldgen-stats.test.ts`（樹密度段）
- 確認（多半不需改）：`src/ui/icons.ts`——方塊物品的圖示走既有「裁切 atlas 側面 tile」路徑（`drawBlockIcon`），只要 `blockFromItem` 查得到就會自動有圖示。

**Interfaces:**
- Consumes: Task 1 的 `surfaceHeight`、`SEA_LEVEL`；Task 2 的 `biomeAt`、`surfaceBlockOf`；`hash2`。
- Produces:
  - `src/world/blocks.ts` 新增 block id（**附加，既有 0–16 不動**）：
    ```ts
    SPRUCE_LOG: 17, SPRUCE_LEAVES: 18, BIRCH_LOG: 19, BIRCH_LEAVES: 20,
    ```
    硬度：spruce_log 2.0、birch_log 2.0、spruce_leaves 0.2、birch_leaves 0.2（原版數值，與既有 oak_log 2.0／oak_leaves 0.2 一致）；`requiredTool: null`、`fastTool: 'axe'`（原木）／`null`（葉）。
    - **跨批編號表（controller 裁決，全批共用，不得自選）**：既有 `BLOCK` 0–16 不動；**B3 用 17–25**（`SPRUCE_LOG` 17、`SPRUCE_LEAVES` 18、`BIRCH_LOG` 19、`BIRCH_LEAVES` 20、`DANDELION` 21、`POPPY` 22、`SHORT_GRASS` 23、`CACTUS` 24、`ICE` 25）；B4 羊毛 = 26；B5 用 27–31；B6 火把 = 32；B8 箱子 = 33。tile 索引同理：B3 用 21–32（`TILE_COUNT` = 33）、B4 `T.WOOL` = 33（34）、B5 用 34–38（39）、B6 `T.TORCH` = 39（40）、B8 `T.CHEST` = 40（41）。若實作時現況與本表不符，**以現況為準並在 commit 訊息註明實際值**，不得默默套用撞號。
  - `src/world/blocks.ts` 新 tile：`SPRUCE_LOG_SIDE 21`、`SPRUCE_LOG_TOP 22`、`SPRUCE_LEAVES 23`、`BIRCH_LOG_SIDE 24`、`BIRCH_LOG_TOP 25`、`BIRCH_LEAVES 26`；`TILE_COUNT` 變成 **27**（≤ 紋理陣列 64 層 ✓）。
  - **新方塊的物品形式（本批補，2026-10-20 稽核修正）**：
    - `src/core/items.ts`：`ItemId` union 加 `'spruce_log' | 'spruce_leaves' | 'birch_log' | 'birch_leaves'`；`ITEM_IDS`（`Record<ItemId, true>` 窮舉）加 4 筆；`BLOCK_PAIRS` 加 4 筆：`['spruce_log', BLOCK.SPRUCE_LOG]`、`['spruce_leaves', BLOCK.SPRUCE_LEAVES]`、`['birch_log', BLOCK.BIRCH_LOG]`、`['birch_leaves', BLOCK.BIRCH_LEAVES]`。
    - `src/world/blocks.ts` 的 `PLACEABLE` 加 4 筆（`SPRUCE_LOG`／`SPRUCE_LEAVES`／`BIRCH_LOG`／`BIRCH_LEAVES`）→ 物品可放、創造清單（`src/ui/inventory.ts` 以 `PLACEABLE` 為Palette）自動出現。
    - `src/audio/sounds.ts` 的 `GROUP_BY_BLOCK` 加 4 筆：`SPRUCE_LOG → 'wood'`、`SPRUCE_LEAVES → 'leaves'`、`BIRCH_LOG → 'wood'`、`BIRCH_LEAVES → 'leaves'`（未登記者會落到預設 'dirt' 音 → 既有 `sounds.test.ts` 的長度斷言會紅）。
    - **掉落**（挖掉掉什麼）本批**明確釘死**（避免跨批漂移；`src/world/drops.ts` 的 `dropItemFor` 加 2 行，既有 `drops.test.ts` 的既有斷言不動，另加新斷言）：
      | 新方塊 | 掉落 | 理由 |
      |---|---|---|
      | `SPRUCE_LOG`／`BIRCH_LOG` | 掉自身（`'spruce_log'`／`'birch_log'`） | 原版樹木掉落自身 |
      | `SPRUCE_LEAVES`／`BIRCH_LEAVES` | **不掉**（`null`） | 與既有 `BLOCK.LEAVES`（橡樹葉）一致：本作無剪刀／絲絨觸碰 |
  - `src/world/trees.ts`：
    ```ts
    export type TreeSpecies = 'oak' | 'spruce' | 'birch';
    export const TREE_PRIORITY_RADIUS = 2;             // 同生態的樹距 ≥ 3
    export const TREE_CANDIDATE_PROBABILITY: Record<Biome, number>;  // §5 的 TREE_P
    export function treeSpeciesFor(biome: Biome): TreeSpecies | null;
    export function treePriority(x: number, z: number, seed: number): number;   // 0..1
    export function treeCandidate(x: number, z: number, seed: number): boolean; // 候選（含生物群系／地面／機率）
    export function treeExists(x: number, z: number, seed: number): boolean;     // 局部極小值判定
    export function treeShape(species: TreeSpecies, variant: number): { trunkHeight: number; leaves: Array<{ dy: number; radius: number; skipCorners: boolean }> };
    export function plantTrees(data: Uint8Array, cx: number, cz: number, seed: number): void;
    ```
  - `plantTrees` 的寫入範圍：`tx, tz ∈ [-4, CHUNK_SIZE + 3]`（樹冠半徑 2 需要 ±2；優先序鄰域 ±2 需要 ±4），只寫入**本區塊內**的格子（跨塊樹冠由「樹幹所在的那一塊」寫入，兩邊合計剛好覆蓋）。

- [ ] **Step 1: 寫測試（失敗）**

  `src/world/trees.test.ts`（**只放不變量；密度統計放 `worldgen-stats.test.ts`**）：
  - `'every tree species has a distinct shape'`：`treeShape('oak', 0).trunkHeight ∈ [4, 6]`、`treeShape('birch', 0).trunkHeight ∈ [5, 7]`、`treeShape('spruce', 0).trunkHeight ∈ [6, 9]`；`treeShape` 的 `leaves` 陣列長度與半徑符合 §5 的表（oak 最大半徑 2、birch 的 `skipCorners` 為 true、spruce 頂端半徑 0）。
  - `'trees never grow on sand, stone or water'`：在種子 1337 的 64×64 範圍內，對每個 `treeExists` 為 true 的柱，斷言 `surfaceBlockOf(biomeAt(x,z,seed), h)` 為 GRASS 或 SNOW，且 `h > SEA_LEVEL + 1`。
  - `'same-biome trees are at least 3 blocks apart'`：在 64×64 範圍內取出所有樹柱，任取兩棵同生態的樹，斷言 `Math.max(Math.abs(dx), Math.abs(dz)) >= 3`（用雜湊集合做 O(n²) 比對，64×64 範圍足夠快）。
  - `'the species matches the biome'`：`treeSpeciesFor('forest') === 'oak'`、`treeSpeciesFor('birch_forest') === 'birch'`、`treeSpeciesFor('taiga') === 'spruce'`、`treeSpeciesFor('snowy_plains') === 'spruce'`、`treeSpeciesFor('mountains') === 'spruce'`、`treeSpeciesFor('desert') === null`、`treeSpeciesFor('ocean') === null`。
  - `'a tree canopy is not clipped at a chunk border'`：**用種子 1337 的 chunk (24,0) 與 (25,0)**（2026-10-20 稽核修正：原寫法用 chunk (0,0)/(1,0)，但那兩塊在種子 1337 **完全沒有樹**（100% plains，`TREE_P = 0.00045`）→ `expect(trunks.length).toBeGreaterThan(0)` 會永遠失敗、測試變成空轉）：
    - 邊界帶＝world `x ∈ [398, 401]`（chunk 24 的 local x ∈ [14,17]），種子 1337 下該帶有 **3 棵橡木**：**(400,5)、(401,8)、(400,12)**（皆在 forest 生態、地面高度 66–67）。
    - 斷言：這 3 棵的**樹幹**都出現在兩塊的其中一側；**逐棵**檢查其**樹冠葉子**在 chunk (24,0) 與 chunk (25,0) **兩邊都 > 0 格**（樹冠沒有被切斷）；且**任何葉子格只出現在其中一塊**（不重複寫入）。
    - 參考數字（sanity check，非硬性斷言）：以 (400,5) 這棵橡木計，葉子在 chunk (24,0) 有 **22 格**、在 chunk (25,0) 有 **38 格**，重複格 **0**。
    - 斷言必須寫成「找出這 3 個座標中的樹 → 逐棵檢查兩側的葉子格數 > 0」，不是「隨便找一個邊界帶的樹」（實作者若換了別的 chunk 會拿到 0 棵）。

  `src/world/terrain.test.ts`：既有 `'tree canopies are not clipped at chunk borders'`（假設只有橡木、葉 id 固定）→ **改寫為樹種無關的版本**：**改用 chunk (24,0) 與 (25,0)**（種子 1337；邊界帶 world x ∈ [398,401] 有 3 棵橡木：(400,5)、(401,8)、(400,12)），用「樹幹的原木 id」判斷樹種（`BLOCK.LOG`→`BLOCK.LEAVES`、`BLOCK.SPRUCE_LOG`→`BLOCK.SPRUCE_LEAVES`、`BLOCK.BIRCH_LOG`→`BLOCK.BIRCH_LEAVES`），斷言該樹種的葉子在**兩塊**都存在（> 0 格），且同一葉子格只出現在其中一塊（不重複寫）。
    （2026-10-20 稽核修正：原寫法用 chunk (0,0)/(1,0)，但既有測試內含 `expect(trunks.length).toBeGreaterThan(0)`（terrain.test.ts:133），而種子 1337 的那兩塊**沒有任何樹** → 改寫後仍會紅。改用 (24,0)/(25,0) 後：該邊界帶 3 棵樹、樹冠 22／38 格、0 個重複格。）

  `src/world/blocks.test.ts`（既有測試要改寫，見〈本批要改寫的既有測試〉）：
  - `'the new wood blocks keep their ids and vanilla hardness'`：`expect(BLOCK.SPRUCE_LOG).toBe(17)`、`expect(BLOCK.SPRUCE_LEAVES).toBe(18)`、`expect(BLOCK.BIRCH_LOG).toBe(19)`、`expect(BLOCK.BIRCH_LEAVES).toBe(20)`；`getBlockDef(BLOCK.SPRUCE_LOG).hardness === 2.0`、`getBlockDef(BLOCK.BIRCH_LEAVES).hardness === 0.2`。
  - `'existing block ids are unchanged'`：`expect(BLOCK.AIR).toBe(0)` … `expect(BLOCK.FURNACE).toBe(16)`（防止重編號打斷舊存檔）。
  - **既有 `'requiredTool／fastTool data matches vanilla'` 的窮舉表補 4 列**（否則該表末的 `expect(expected.map(([id]) => id).sort(byId)).toEqual([...Object.values(BLOCK)].sort(byId))` 必紅）：
    `[BLOCK.SPRUCE_LOG, null, 'axe']`、`[BLOCK.SPRUCE_LEAVES, null, null]`、`[BLOCK.BIRCH_LOG, null, 'axe']`、`[BLOCK.BIRCH_LEAVES, null, null]`。
  - **既有 `'hardness table matches vanilla (Task 5)'` 補 4 列**：`[BLOCK.SPRUCE_LOG, 2.0]`、`[BLOCK.SPRUCE_LEAVES, 0.2]`、`[BLOCK.BIRCH_LOG, 2.0]`、`[BLOCK.BIRCH_LEAVES, 0.2]`。

  `src/core/items.test.ts`（既有測試要改寫，見〈本批要改寫的既有測試〉）：
  - `BLOCK_ITEMS` 鏡像清單補 `'spruce_log'`、`'spruce_leaves'`、`'birch_log'`、`'birch_leaves'`。
  - `expect(ALL_ITEMS.length).toBe(N + 4)`、`expect(ALL_ITEM_IDS.length).toBe(N + 4)`（**N ＝ Task 3 Step 1 從 `src/core/items.ts` 讀到的當前 `ALL_ITEM_IDS.length`**，本批 Task 3 新增 4 個物品 id；Task 4 會**另外讀一次當下的基數**再補 5 個 → 合計比 Task 3 前的基數多 9。2026-10-20 終審修正：原計畫寫死 `toBe(36)`／`toBe(41)`，上游批次若已落地就會紅；**測試裡寫的是讀到的實際值，並在 commit 訊息註明**（例：`ALL_ITEM_IDS 32 → 36`））。
  - 既有 `'every block except air and block-only water maps to an item'` **不動**——它正是要求本批補物品形式的守衛（沒有物品形式就會紅）。

  `src/audio/sounds.test.ts`（既有測試要改寫）：
  - 既有材質表補 4 列：`[BLOCK.SPRUCE_LOG]: 'wood'`、`[BLOCK.SPRUCE_LEAVES]: 'leaves'`、`[BLOCK.BIRCH_LOG]: 'wood'`、`[BLOCK.BIRCH_LEAVES]: 'leaves'`；長度斷言 `Object.keys(table)).toHaveLength(Object.keys(BLOCK).length)` **不動**。

  `src/render/textures.test.ts`：新增 `'every declared tile is painted'`（2026-10-20 稽核修正：**斷言要寫在「紋理陣列層」，不是 atlas**——洋紅除錯色在 `buildTextureArray()` 沒被畫到的**層**，atlas 裡沒畫的區域是全 0 的透明像素 → 用 atlas 判斷會「任何 tile 都通過」，等於沒有測試）：
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
    （`buildTextureArray`／`TILE_PX`／`TILE_COUNT` 從 `../render/textures` import；此寫法與 B5 計畫的同名測試一致——B5 若已加了同名測試就沿用這個 helper，斷言內容不得放寬。）
  - **既有 `'drawn tiles keep their content; empty layers are opaque magenta #ff00ff'` 的洋紅層清單要改寫（2026-10-20 終審修正 —— 這是全計畫群唯一的修復點）**：現況寫死 `for (const layer of [TILE_COUNT, 32, 47, 63])`——`32` 這個硬編號是「`TILE_COUNT` 還沒超過 32」的時代的假設。本批 Task 4 會把 `TILE_COUNT` 拉到 33 並把 `T.ICE` 畫在 tile 32 → **layer 32 變成「內容層」→ 該斷言必紅**（`expect(layerPixel(tex, 32, …)).toEqual(MAGENTA)`）。改成 **runtime 相對**：
    ```ts
    // 洋紅除錯色只存在於「未畫」的層；用 TILE_COUNT 起算，不要寫死層號
    for (const layer of [TILE_COUNT, TILE_COUNT + 1, 47, 63]) {
      for (const [x, y] of [[0, 0], [8, 8], [15, 15]] as const) {
        expect(layerPixel(tex, layer, x, y), `layer ${layer} px ${x},${y}`).toEqual(MAGENTA);
      }
    }
    ```
    （`TILE_COUNT + 1` 若 ≥ 64 或與 47／63 重複就省略該項——本計畫群最大 `TILE_COUNT` 是 B8 的 41，所以 `[41, 42, 47, 63]` 全部是未畫層 ✓。**改成相對之後，B4／B5／B6／B8 的 `TILE_COUNT` 變化都自動適應，後續批次不得再重複改寫這條**（見〈本批要改寫的既有測試（清單）〉）。）

  `src/world/worldgen-stats.test.ts`：樹密度統計段（容差見 §5 表；取樣區＝**連續 1024×1024 格、種子 1337**，與 §5 的實測值同一區域；統計方式＝「該生態的樹棵數 ÷ 該生態的柱數 × 256」）。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/world/trees.test.ts src/world/blocks.test.ts src/render/textures.test.ts src/core/items.test.ts src/audio/sounds.test.ts src/world/drops.test.ts` → Expected: FAIL。

- [ ] **Step 3: 實作 `src/world/blocks.ts` 的新方塊與 tile**

  - `BLOCK` 物件**在尾端追加** 4 個 id（不動既有數值）。
  - `T` 常數追加 6 個 tile；`TILE_COUNT = T.BIRCH_LEAVES + 1`（27）。
  - `DEFS` 追加 4 筆（`shape` 欄位在 Task 4 才加，Task 3 先不加）。
  - `PLACEABLE` **追加 4 筆**（`SPRUCE_LOG`／`SPRUCE_LEAVES`／`BIRCH_LOG`／`BIRCH_LEAVES`）——本批已補物品形式（2026-10-20 稽核修正：原寫「PLACEABLE 不動（新方塊在 B3 沒有物品形式 → 不能放）」，該前提已被本批補物品形式改變）。
  - **新方塊的物品形式（本批）**：
    1. `src/core/items.ts`：`ItemId` union 加 `'spruce_log' | 'spruce_leaves' | 'birch_log' | 'birch_leaves'`；`ITEM_IDS` 加 4 筆；`BLOCK_PAIRS` 加 4 筆（`['spruce_log', BLOCK.SPRUCE_LOG]`、`['spruce_leaves', BLOCK.SPRUCE_LEAVES]`、`['birch_log', BLOCK.BIRCH_LOG]`、`['birch_leaves', BLOCK.BIRCH_LEAVES]`）。
    2. `src/audio/sounds.ts`：`GROUP_BY_BLOCK` 加 4 筆（`wood`／`leaves`／`wood`／`leaves`）。
    3. `src/world/drops.ts`：`dropItemFor` 的「不掉」清單加 `SPRUCE_LEAVES`／`BIRCH_LEAVES`（原木走既有的 `itemFromBlock` fallback＝掉自身）。
    4. `src/ui/icons.ts`：**不用改**（方塊物品的圖示走既有 `drawBlockIcon` 裁切 atlas 側面 tile 的路徑；`blockFromItem` 查得到就會自動有圖示）。
  - **新測試**（`src/core/items.test.ts`／`src/audio/sounds.test.ts`／`src/world/drops.test.ts`）：`itemFromBlock(BLOCK.SPRUCE_LOG) === 'spruce_log'`、`blockFromItem('birch_leaves') === BLOCK.BIRCH_LEAVES`、`materialGroup(BLOCK.BIRCH_LOG) === 'wood'`、`dropItemFor(BLOCK.SPRUCE_LEAVES) === null`、`dropItemFor(BLOCK.SPRUCE_LOG) === 'spruce_log'`。既有斷言全部保留（只把鏡像清單與計數改成「讀現況基數 N → N + 4」）。

- [ ] **Step 4: 實作 `src/render/textures.ts` 的新圖樣**

  - `SPRUCE_LOG_SIDE`：深棕（`[64, 48, 32, 255]`）＋垂直深色條紋；`SPRUCE_LOG_TOP`：同心年輪（深棕）；`SPRUCE_LEAVES`：深綠（`[46, 96, 40, 255]`）＋ 18% 透明破洞。
  - `BIRCH_LOG_SIDE`：淺灰白（`[216, 214, 206, 255]`）＋ 水平黑色橫紋（每 4–6 行一條）；`BIRCH_LOG_TOP`：淺色年輪；`BIRCH_LEAVES`：淺綠（`[126, 168, 84, 255]`）＋ 18% 透明破洞。
  - 寫法比照既有 `put(index, fn)`（`fillTile` 逐像素回傳 RGBA；破洞回傳 `[0,0,0,0]`）。

- [ ] **Step 5: 實作 `src/world/trees.ts`**

  - `treePriority(x, z, seed)`：`hash2(x, z, seed ^ 0x5f3a7c1d) / 4294967296`（0..1）。
  - `treeCandidate(x, z, seed)`：`treeSpeciesFor(biomeAt(x, z, seed)) !== null` ＋ `surfaceHeight > SEA_LEVEL + 1` ＋ 表層是 GRASS 或 SNOW ＋ `treePriority < TREE_CANDIDATE_PROBABILITY[biome]`。
  - `treeExists(x, z, seed)`：`treeCandidate` 為真 ＋ 「半徑 2 的 5×5 鄰域內**同生態**的候選，沒有優先序比自己小的」。
  - `treeShape(species, variant)`：§5 的表；`variant` 是 0..2 的整數（由另一個雜湊決定）→ 樹幹高度在區間內變化、葉形不變。
  - `plantTrees(data, cx, cz, seed)`：
    1. 對 `tx, tz ∈ [-4, CHUNK_SIZE + 3]` 的每個柱：若 `treeExists(worldX, worldZ, seed)` 為真 → 取得樹種與樹形。
    2. 地面高度 `ground = surfaceHeight(worldX, worldZ, seed)`；樹幹寫入 `y ∈ [ground+1, ground+trunkHeight]`。
    3. 樹冠：依 `treeShape().leaves` 的 `dy`（相對樹冠頂端）與 `radius`、`skipCorners` 逐格寫入葉子；`skipCorners` 時跳過 `|dx| === radius && |dz| === radius` 的四角。
    4. 寫入邊界：`put(x, y, z, id)` 只在 `0 ≤ x < CHUNK_SIZE`、`0 ≤ z < CHUNK_SIZE`、`0 ≤ y < CHUNK_HEIGHT` 時寫入（跨塊的樹冠由樹幹所在塊寫入自己那一側）。
    5. 只在目標格是 AIR 時寫入（不覆蓋地形／水面）。

- [ ] **Step 6: `terrain.ts` 接上新的樹木模組**

  - 刪除舊的 `plantTrees` 函式與其 `hash2`／`biomeN` 相關程式碼；`generateChunk` 改 `import { plantTrees } from './trees';` 並在填完方塊後呼叫 `plantTrees(data, cx, cz, seed)`。
  - `terrain.ts` 頂端的 `hash2` import 若仍被礦石生成使用則保留。

- [ ] **Step 7: 跑測試轉綠**

  Run: `npx vitest run src/world/trees.test.ts src/world/blocks.test.ts src/render/textures.test.ts src/world/terrain.test.ts src/world/worldgen-stats.test.ts src/core/items.test.ts src/audio/sounds.test.ts src/world/drops.test.ts` → Expected: PASS。

- [ ] **Step 8: 全量驗證＋人工**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → Expected: 全綠。
  人工（記錄結果）：開新世界 → 平原上只有零星橡樹、森林帶有連續的橡木林、白樺林是細白幹、針葉林是瘦高錐形；確認不再出現「整片樹海」；創造模式的方塊清單看得到雲杉／白樺原木與葉子（物品形式已在本批補上）。

- [ ] **Step 9: Commit**

  ```bash
  git add src/world/trees.ts src/world/trees.test.ts src/world/blocks.ts src/world/blocks.test.ts src/core/items.ts src/core/items.test.ts src/audio/sounds.ts src/audio/sounds.test.ts src/world/drops.ts src/world/drops.test.ts src/render/textures.ts src/render/textures.test.ts src/world/terrain.ts src/world/terrain.test.ts src/world/worldgen-stats.test.ts
  git commit -m "feat(worldgen): B3.3 橡木／雲杉／白樺三樹種、樹形與樹密度（含樹距 ≥2；一併補 4 個新方塊的物品形式與材質音）"
  ```

---

### Task 4: cross 型方塊資料與 mesher 的 foliage pass

**Files:**
- Modify: `src/world/blocks.ts`（`shape` 欄位、新方塊 DANDELION／POPPY／SHORT_GRASS／CACTUS／ICE、新 tile、`PLACEABLE` 補 5 個新方塊）、`src/world/blocks.test.ts`
- Modify: `src/core/items.ts`（5 個新方塊的**物品形式**）、`src/core/items.test.ts`
- Modify: `src/audio/sounds.ts`（5 個新方塊的材質群）、`src/audio/sounds.test.ts`
- Modify: `src/world/drops.ts`（冰不掉落）
- Modify: `src/render/textures.ts`（花／草／仙人掌／冰的圖樣）、`src/render/textures.test.ts`
- Modify: `src/world/mesher.ts`（`ChunkMesh` 加 `foliage`、cube pass 排除 cross、cross quad 發射）、`src/world/mesher.test.ts`
- Modify: `src/render/chunk-renderer.ts`（第三條 mesh 與材質）
- Modify: `src/render/chunk-renderer.test.ts`（既有 `scene.children` 數量斷言隨第三條 mesh 更新）

**Interfaces:**
- Consumes: Task 3 的 blocks/tile 結構。
- Produces:
  - `src/world/blocks.ts`：
    ```ts
    export type BlockShape = 'cube' | 'cross';
    // BlockDef 新增 shape: BlockShape;
    export const BLOCK = { ..., DANDELION: 21, POPPY: 22, SHORT_GRASS: 23, CACTUS: 24, ICE: 25, ... };
    export function isCross(id: number): boolean;
    export function isTargetable(id: number): boolean;   // solid || shape === 'cross'
    ```
    新方塊資料：
    | 方塊 | id | 硬度 | solid | transparent | shape | requiredTool | fastTool |
    |---|---|---|---|---|---|---|---|
    | dandelion | 21 | 0 | false | true | cross | null | null |
    | poppy | 22 | 0 | false | true | cross | null | null |
    | short_grass | 23 | 0 | false | true | cross | null | null |
    | cactus | 24 | 0.4 | true | false | cube | null | null |
    | ice | 25 | 0.5 | true | true | cube | null | 'pickaxe' |
    （硬度 0 = 瞬破、對應原版花／草「可以用手瞬間挖掉」；仙人掌 0.4、冰 0.5 為原版數值。）
  - **這 5 個新方塊的物品形式（本批補，2026-10-20 稽核修正：原寫「冰沒有物品形式 → B5 補」，但既有 `items.test.ts` 的「每個 block 都要有 item form」不變量不容許）**：
    - `src/core/items.ts`：`ItemId` union 加 `'dandelion' | 'poppy' | 'short_grass' | 'cactus' | 'ice'`；`ITEM_IDS` 加 5 筆；`BLOCK_PAIRS` 加 5 筆（`['dandelion', BLOCK.DANDELION]`、`['poppy', BLOCK.POPPY]`、`['short_grass', BLOCK.SHORT_GRASS]`、`['cactus', BLOCK.CACTUS]`、`['ice', BLOCK.ICE]`）。
    - `src/world/blocks.ts` 的 `PLACEABLE` 加 5 筆（花／草／仙人掌／冰都可放；放置花／草的目標格若是 cross 植被，Task 5 的 `canPlaceAt` 允許覆蓋）。
    - `src/audio/sounds.ts` 的 `GROUP_BY_BLOCK` 加 5 筆：`DANDELION → 'grass'`、`POPPY → 'grass'`、`SHORT_GRASS → 'grass'`、`CACTUS → 'grass'`（原版仙人掌是草的聲音）、`ICE → 'glass'`（冰是清脆的玻璃聲）。
    - **掉落**（`src/world/drops.ts` 的 `dropItemFor`）：花／草／仙人掌**掉自身**（花與草掉自身是 B5 已定的刻意偏離，見 B5〈與公約／spec 的差異〉第 4 條）；**冰不掉**（`null`，原版需絲絨觸碰；本作無絲絨 → 與 B5 的決策一致）。
    - `src/ui/icons.ts`：**不用改**（方塊物品的圖示走既有 `drawBlockIcon` 裁切 atlas 側面 tile 的路徑；`blockFromItem` 查得到就會自動有圖示——cross 方塊的 `side` tile 就是它的正面圖樣）。
  - 新 tile：`DANDELION 27`、`POPPY 28`、`SHORT_GRASS 29`、`CACTUS_SIDE 30`、`CACTUS_TOP 31`、`ICE 32` → `TILE_COUNT = 33`。
  - `src/world/mesher.ts`：`export interface ChunkMesh { opaque: MeshData; water: MeshData; foliage: MeshData }`（**既有 `opaque`／`water` 欄位不變**，既有測試不必改）。

- [ ] **Step 1: 寫測試（失敗）**

  `src/world/blocks.test.ts`：
  - `'the new blocks have the pinned ids and vanilla hardness'`：`DANDELION 21 / POPPY 22 / SHORT_GRASS 23 / CACTUS 24 / ICE 25`；硬度 0 / 0 / 0 / 0.4 / 0.5。
  - `'plants are cross shaped and non solid'`：`expect(getBlockDef(BLOCK.DANDELION).shape).toBe('cross')`、`expect(getBlockDef(BLOCK.DANDELION).solid).toBe(false)`、`expect(getBlockDef(BLOCK.CACTUS).shape).toBe('cube')`、`expect(getBlockDef(BLOCK.CACTUS).solid).toBe(true)`。
  - `'targetable covers solids and cross plants'`：`expect(isTargetable(BLOCK.STONE)).toBe(true)`、`expect(isTargetable(BLOCK.DANDELION)).toBe(true)`、`expect(isTargetable(BLOCK.WATER)).toBe(false)`、`expect(isTargetable(BLOCK.AIR)).toBe(false)`。
  - **既有 `'requiredTool／fastTool data matches vanilla'` 的窮舉表補 5 列**（否則末行 `expect(expected.map(([id]) => id).sort(byId)).toEqual([...Object.values(BLOCK)].sort(byId))` 必紅）：`[BLOCK.DANDELION, null, null]`、`[BLOCK.POPPY, null, null]`、`[BLOCK.SHORT_GRASS, null, null]`、`[BLOCK.CACTUS, null, null]`、`[BLOCK.ICE, null, 'pickaxe']`。
  - **既有 `'hardness table matches vanilla (Task 5)'` 補 5 列**：`[BLOCK.DANDELION, 0]`、`[BLOCK.POPPY, 0]`、`[BLOCK.SHORT_GRASS, 0]`、`[BLOCK.CACTUS, 0.4]`、`[BLOCK.ICE, 0.5]`。

  `src/core/items.test.ts`（既有測試要改寫）：`BLOCK_ITEMS` 鏡像清單補 `'dandelion'`、`'poppy'`、`'short_grass'`、`'cactus'`、`'ice'`；`expect(ALL_ITEMS.length).toBe(N + 5)`、`expect(ALL_ITEM_IDS.length).toBe(N + 5)`（**N ＝ Task 4 Step 1 讀到的當前 `ALL_ITEM_IDS.length`**（含 Task 3 已補的 4 個）；本任務新增 5 個物品 id → 合計比 Task 3 前的基數多 9；2026-10-20 終審修正：原計畫寫死 `toBe(41)`，上游批次若已落地就會紅 → 一律寫成讀到的實際值並在 commit 訊息註明）。既有 `'every block except air and block-only water maps to an item'` **不動**。

  `src/render/textures.test.ts`（既有測試要改寫 —— **2026-10-20 終審修正：這一條在 Task 3 就已改寫，本任務不得再改，只驗證**）：
  - 既有 `'drawn tiles keep their content; empty layers are opaque magenta #ff00ff'` 的洋紅層清單**在 Task 3 Step 1 已改成 runtime 相對**：`for (const layer of [TILE_COUNT, TILE_COUNT + 1, 47, 63])`。**本任務（`TILE_COUNT` 拉到 33、`T.ICE`＝32 已畫）只驗證它仍綠**（清單變成 `[33, 34, 47, 63]`，四個層都還是未畫層 → 仍是洋紅 ✓）——**不得再改一次**（B5／B6／B8 也不得改；這一條是全計畫群唯一的修復點，見〈本批要改寫的既有測試（清單）〉）。
  - **若實作者在 Task 3 漏改**（清單仍是寫死的 `[TILE_COUNT, 32, 47, 63]`）：本任務必須補改為 `[TILE_COUNT, TILE_COUNT + 1, 47, 63]`——否則 layer 32（＝`T.ICE`，本任務已畫）會讓 `expect(layerPixel(tex, 32, …)).toEqual(MAGENTA)` **必紅**，本批的 `npm test` gate 無法轉綠。
  - Task 3 新增的 `'every declared tile is painted'` 守門測試**沿用**（本任務把 `TILE_COUNT` 推到 33 → 該測試會多檢查 tile 27–32；這 6 個 tile 由本任務的 Step 3 畫出 → 綠）。

  `src/audio/sounds.test.ts`（既有測試要改寫）：材質表補 5 列（`DANDELION`／`POPPY`／`SHORT_GRASS`／`CACTUS` → `'grass'`，`ICE` → `'glass'`）；長度斷言不動。

  `src/world/drops.test.ts`（既有斷言不動，新增）：`dropItemFor(BLOCK.ICE)` → `null`；`dropItemFor(BLOCK.DANDELION)` → `'dandelion'`；`dropItemFor(BLOCK.CACTUS)` → `'cactus'`。

  `src/world/mesher.test.ts`（**既有測試不動**，只新增 describe）：
  - `'a cross block produces two diagonal quads in the foliage mesh'`：造一個 `DANDELION` 方塊 → `meshChunk(w,0,0).foliage.quadCount === 2`；`opaque.quadCount === 0`（cross 不進 cube pass）。
  - `'the foliage quads span the full cell diagonally'`：兩個 quad 的頂點分別落在 `x/z` 對角線上：`expect(verts.every((v) => v[0] === 5 || v[0] === 6)).toBe(true)` 且每個 quad 的 4 個頂點跨越 x 或 z 的 1 格。
  - `'the foliage quads use one tile of UV'`：`uvs` 每個 quad 的最大值為 1、最小值為 0。
  - `'cross blocks do not occlude AO'`：在 cross 方塊旁邊放一個石頭方塊 → 石頭面的陰影階數與沒有 cross 時相同。
  - `'a chunk without plants has an empty foliage mesh'`：`meshChunk(w,0,0).foliage.quadCount === 0`。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/world/blocks.test.ts src/world/mesher.test.ts src/core/items.test.ts src/audio/sounds.test.ts src/world/drops.test.ts` → Expected: FAIL（`shape`／`isTargetable` 不存在、`ChunkMesh.foliage` 不存在、5 個新方塊沒有物品形式）。

- [ ] **Step 3: 實作 blocks 與 tile**

  - `BLOCK` 追加 5 個 id；`T` 追加 6 個 tile；`TILE_COUNT = T.ICE + 1`（33）。
  - `BlockDef` 加 `shape: BlockShape`（既有 17 筆全部補 `'cube'`）。
  - `isCross(id)`／`isTargetable(id)` 兩個匯出 helper。
  - `PLACEABLE` 追加 5 筆（`DANDELION`／`POPPY`／`SHORT_GRASS`／`CACTUS`／`ICE`）——本批已補物品形式（2026-10-20 稽核修正：原寫「PLACEABLE 不動」的前提已改變）。
  - **新方塊的物品形式（本批）**：
    1. `src/core/items.ts`：`ItemId` union 加 `'dandelion' | 'poppy' | 'short_grass' | 'cactus' | 'ice'`；`ITEM_IDS` 加 5 筆；`BLOCK_PAIRS` 加 5 筆。
    2. `src/audio/sounds.ts`：`GROUP_BY_BLOCK` 加 5 筆（花／草／仙人掌 → `'grass'`，冰 → `'glass'`）。
    3. `src/world/drops.ts`：`dropItemFor` 加 `if (blockId === BLOCK.ICE) return null;`（冰需絲絨觸碰才掉；本作無絲絨 → 不掉）。花／草／仙人掌走既有的 `itemFromBlock` fallback＝掉自身（B5 已定的刻意偏離）。
    4. `src/ui/icons.ts`：**不用改**（方塊物品圖示走既有 atlas 裁切路徑）。
  - `textures.ts` 畫新 tile：
    - `DANDELION`：透明底＋綠色莖（中間 2 像素寬）+ 頂部黃色花（`[230, 200, 60, 255]` 的十字形，約 5×5）。
    - `POPPY`：同構但花是紅色（`[200, 60, 50, 255]`）。
    - `SHORT_GRASS`：透明底＋數簇綠色草葉（`[92, 150, 62, 255]` 的 3–4 條不規則直線）。
    - `CACTUS_SIDE`／`CACTUS_TOP`：綠色（`[74, 130, 66, 255]`）＋ 淺色棘刺點。
    - `ICE`：淡藍白（`[168, 205, 235, 190]`，半透明）＋ 白色裂紋線。

- [ ] **Step 4: 實作 mesher 的 foliage pass**

  - `ChunkMesh` 加 `foliage: MeshData`；`meshChunk` 開頭回傳空 builder 的 foliage。
  - cube pass：在既有 `if (id === BLOCK.AIR) continue;` 之後加 `if (isCross(id)) continue;`（cross 不進 cube pass）。
  - 新增 `emitCrossQuads(b: MeshBuilder, baseX, baseZ, lx, ly, lz, tile)`：
    - 平面 A 的四角（世界座標）：`(x, y, z)`、`(x+1, y, z+1)`、`(x, y+1, z)`、`(x+1, y+1, z+1)`；法線 `(-1/√2, 0, 1/√2)`。
    - 平面 B 的四角：`(x, y, z+1)`、`(x+1, y, z)`、`(x, y+1, z+1)`、`(x+1, y+1, z)`；法線 `(1/√2, 0, 1/√2)`。
    - 每片 4 個頂點、2 個三角形；UV 為 `[0,0] [1,0] [0,1] [1,1]`；`shades` 填 1.0（cross 不做 AO）。
    - 索引寫法比照既有 `emitQuad`（`vertBase, vertBase+1, vertBase+2, vertBase+2, vertBase+1, vertBase+3`）。
  - 遍歷：對 chunk 內每個非 AIR 的格子掃一次（每格一次陣列讀取；65,536 格的迴圈相對既有 6 個面方向的掃描可忽略），若 `isCross(id)` → `emitCrossQuads(...)`（tile 取 `getBlockDef(id).top`）。

- [ ] **Step 5: 實作 `chunk-renderer.ts` 的第三條 mesh**

  - `ChunkMeshes` 加 `foliage: THREE.Mesh`。
  - 新材質 `foliageMaterial = new THREE.MeshLambertMaterial({ alphaTest: 0.1, vertexColors: true, side: THREE.DoubleSide, fog: true })`，同樣掛 `onBeforeCompile` 的 `patchTextureArrayShader`。
  - `rebuild()`：把 `mesh.foliage` 的幾何也建好並套用；`foliage.castShadow = false`、`foliage.receiveShadow = true`、`matrixAutoUpdate = false`。
  - **`rebuild()` 的早退條件必須一併納入 foliage**（既有 `if (!opaqueGeometry && !waterGeometry) { this.remove(...); return; }` → 改成 `if (!opaqueGeometry && !waterGeometry && !foliageGeometry)`）——否則「只有植被、沒有方塊」的 chunk 會被整塊移除，植被看不見（2026-10-20 稽核修正）。
  - `this.scene.add(pair.opaque, pair.water, pair.foliage)` → **每個 chunk 在場景裡是 3 個 child，順序為 opaque(0)／water(1)／foliage(2)**（既有 water 的索引 1 不變）。
  - `remove()`／`dispose()`：一併釋放 foliage 幾何與材質。
  - `waterMaterialParams()` 等既有匯出不動。

- [ ] **Step 6: 改寫 `src/render/chunk-renderer.test.ts` 的既有數量斷言**（2026-10-20 稽核修正：加第三條 mesh 會讓既有斷言全紅，必須明寫怎麼改，**不得弱化**）

  - `expect(scene.children).toHaveLength(2)` → **`3`**（單一 chunk：opaque＋water＋foliage）；出現於既有測試 L144（water-only chunk）、L159（mixed chunk）、L216（chunk that loses its water）。
  - `expect(scene.children).toHaveLength(4)`（L250，2 個 chunk）→ **`6`**。
  - `expect(scene.children).toHaveLength(0)`（L242，空 chunk）→ **不變**（opaque／water／foliage 都空 → 整塊移除）。
  - `scene.children[0]`（opaque）、`scene.children[1]`（water）**索引不變**；新增 `scene.children[2]` 是 foliage 的斷言（`visible === false` 當沒有植被時）。
  - 新測試：只有 cross 植被的 chunk → `scene.children` 仍是 3 個且 `scene.children[2].visible === true`（早退條件含 foliage 的回歸保護）。

- [ ] **Step 7: 跑測試轉綠**

  Run: `npx vitest run src/world/blocks.test.ts src/world/mesher.test.ts src/render/chunk-renderer.test.ts src/render/textures.test.ts src/core/items.test.ts src/audio/sounds.test.ts src/world/drops.test.ts` → Expected: PASS。

- [ ] **Step 8: 全量驗證**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → Expected: 全綠。

- [ ] **Step 9: Commit**

  ```bash
  git add src/world/blocks.ts src/world/blocks.test.ts src/core/items.ts src/core/items.test.ts src/audio/sounds.ts src/audio/sounds.test.ts src/world/drops.ts src/world/drops.test.ts src/render/textures.ts src/render/textures.test.ts src/world/mesher.ts src/world/mesher.test.ts src/render/chunk-renderer.ts src/render/chunk-renderer.test.ts
  git commit -m "feat(worldgen): B3.4 cross 型方塊資料與 mesher foliage pass（植被渲染、不投影；一併補 5 個新方塊的物品形式）"
  ```

---

### Task 5: cross 方塊的互動（可命中／瞬破／覆蓋）

**Files:**
- Modify: `src/world/world.ts`（新增 `isTargetable`）
- Modify: `src/world/raycast.ts`（改用可命中判定）
- Modify: `src/player/interact.ts`（瞬破、覆蓋放置）
- Modify: `src/world/raycast.test.ts`、`src/player/interact.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `isTargetable`、`isCross`。
- Produces:
  - `src/world/world.ts`：`isTargetable(x: number, y: number, z: number): boolean`（`blockIsTargetable(getBlock(x,y,z))`；越界回 false）。
  - `src/world/raycast.ts`：**行為變更**——原本只命中 `world.isSolid` 的格子，改為命中 `world.isTargetable` 的格子（水與空氣仍不可命中）。
  - `src/player/interact.ts`：
    - `getBreakTime(blockId, held)`：硬度 0 → 回傳 **0**（原本的公式自然得到 0，但要明確處理：`if (h === 0) return 0;`，避免與 Infinity 混淆）。
    - `digStep(mode, dig, blockId, hit, dt, held)`：`breakTimeSec === 0` → **立即回 true**（並 `dig.reset()`），不得進入 `dig.update` 的除法。
    - `DigProgress.update(blockId, hit, dt, breakTimeSec)`：`breakTimeSec <= 0` → 直接返回（不得做 `dt / 0`）。
    - `canPlaceAt(world, x, y, z, playerPos)`：目標格是 AIR／WATER **或 cross 方塊**時才允許（植被被覆蓋，而不是卡住）。

- [ ] **Step 1: 寫測試（失敗）**

  `src/world/raycast.test.ts`：
  - `'a flower is hit by the ray even though it is not solid'`：在 `(5, 64, 4)` 放一個 `DANDELION`（非 solid），起點 `(5.5, 64.5, 5.5)`、方向 `(0, 0, -1)`、距離 4 → `expect(raycast(world, {x:5.5,y:64.5,z:5.5}, {x:0,y:0,z:-1}, 4)?.z).toBe(4)`（起點格 `(5,64,5)` 必須是空氣，否則會走「起點在方塊內」分支）。
  - `'air and water are still not hittable'`：水面之上的射線不命中水格（`raycast` 回 null 或命中水後方的方塊）。
  - `'a solid block behind a flower is still hit when the flower is not in the way'`（迴歸保護）。

  `src/player/interact.test.ts`：
  - `'a hardness zero plant breaks instantly'`：`getBreakTime(BLOCK.DANDELION, null) === 0`；`digStep('survival', dig, BLOCK.DANDELION, hit, 1/60, null) === true`。
  - `'digStep never divides by zero for instant-break blocks'`：`dig.progress` 在瞬破後為 0（`dig.reset()`）。
  - `'unbreakable blocks still never break'`（既有測試保留：bedrock／water 回 false）。
  - `'a block can be placed onto a plant cell'`：`canPlaceAt(world, 5, 64, 5, {x: 9.5, y: 64, z: 9.5})` 在該格是 DANDELION 時回 true（**玩家位置必須在別處**，否則 AABB 重疊檢查會擋下）。
  - `'a block cannot be placed into a solid cell'`（既有語意保留）。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/world/raycast.test.ts src/player/interact.test.ts` → Expected: FAIL。

- [ ] **Step 3: 實作**

  - `world.ts`：新增 `isTargetable`（import `isTargetable as blockIsTargetable` from `./blocks`）。
  - `raycast.ts`：兩處 `world.isSolid(...)` 改為 `world.isTargetable(...)`（註解說明：水／空氣仍不可命中，植被可命中）。
  - `interact.ts`：
    ```ts
    export function getBreakTime(blockId: number, held: ItemStack | null): number {
      const h = getBlockDef(blockId).hardness;
      if (!Number.isFinite(h)) return Infinity;
      if (h === 0) return 0;              // 植被：瞬破（原版花／草硬度 0）
      return (h * (canHarvest(blockId, held) ? 1.5 : 5)) / toolSpeed(blockId, held);
    }
    ```
    `digStep`：`const time = getBreakTime(...); if (!Number.isFinite(time)) return false; if (time === 0) { dig.reset(); return true; }`（放在 Infinity 判斷之後、creative 分支之前 → 創造與生存都瞬破）。
    `DigProgress.update`：`if (!Number.isFinite(breakTimeSec) || breakTimeSec <= 0) return;`
    `canPlaceAt`：`const id = world.getBlock(x, y, z); if (id !== BLOCK.AIR && id !== BLOCK.WATER && !isCross(id)) return false;`

- [ ] **Step 4: 跑測試轉綠**

  Run: `npx vitest run src/world/raycast.test.ts src/player/interact.test.ts` → Expected: PASS（既有互動測試全部保留）。

- [ ] **Step 5: 全量驗證＋人工**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → Expected: 全綠。
  人工（記錄結果）：用方塊瞄準地面上的花 → 一按左鍵即消失（瞬破）；站在花上放置方塊 → 植被被方塊取代（不被卡住）；花不阻擋行走。

- [ ] **Step 6: Commit**

  ```bash
  git add src/world/world.ts src/world/raycast.ts src/world/raycast.test.ts src/player/interact.ts src/player/interact.test.ts
  git commit -m "feat(interact): B3.4 植被可被射線命中、硬度 0 瞬破、放置可覆蓋植被"
  ```

---

### Task 6: 地表裝飾生成（花／草叢／仙人掌／冰）＋仙人掌接觸傷害

**Files:**
- Create: `src/world/decorations.ts`、`src/world/decorations.test.ts`、`src/world/hazards.ts`、`src/world/hazards.test.ts`
- Modify: `src/world/terrain.ts`（`generateChunk` 呼叫裝飾模組）
- Modify: `src/world/worldgen-stats.test.ts`（裝飾密度段）
- Modify: `src/main.ts`（仙人掌傷害接線）

**Interfaces:**
- Consumes: Task 1–5 的 `surfaceHeight`、`biomeAt`、`surfaceBlockOf`、`BLOCK`。
- Produces（`src/world/decorations.ts`）：
  ```ts
  export const FLOWER_PROBABILITY: Record<Biome, number>;   // §6（8 鍵窮舉）
  export const GRASS_PROBABILITY: Record<Biome, number>;     // §6（8 鍵窮舉）
  export const CACTUS_PROBABILITY = 0.0059;
  export function flowerRoll(x: number, z: number, seed: number): number;   // 0..1
  export function flowerKind(x: number, z: number, seed: number): 'dandelion' | 'poppy';
  export function grassRoll(x: number, z: number, seed: number): number;
  export function cactusRoll(x: number, z: number, seed: number): number;
  export function cactusHeight(x: number, z: number, seed: number): 1 | 2 | 3;  // 11/18、5/18、2/18
  export function isCold(x: number, z: number, seed: number): boolean;          // temp < -0.24
  export function plantDecorations(data: Uint8Array, cx: number, cz: number, seed: number): void;
  ```
  （`src/world/hazards.ts`）
  ```ts
  export const CACTUS_DAMAGE_PER_SEC = 1;
  export interface HazardState { cactusAcc: number }
  export function createHazardState(): HazardState;
  export function touchesCactus(world: World, pos: {x:number;y:number;z:number}, halfWidth: number, height: number): boolean;
  export function stepHazards(state: HazardState, touching: boolean, dt: number): { state: HazardState; damage: number };
  ```
- [ ] **Step 1: 寫測試（失敗）**

  `src/world/decorations.test.ts`：
  - `'flowers only grow on grass tops'：在種子 1337 的 128×128 範圍內，掃描所有 DANDELION／POPPY 方塊，斷言其下方是 GRASS。
  - `'desert and snow have no flowers'`：斷言沒有任何 DANDELION／POPPY 落在 DESERT 或 SNOWY_PLAINS 柱上（用 `biomeAt` 判定）。
  - `'cactus only grows on sand in the desert'`：所有 CACTUS 柱的 `biomeAt` 為 desert 且下方是 SAND。
  - `'cactus heights follow the vanilla 1/2/3 distribution'`（2026-10-20 稽核修正：原本在 128×128 範圍內統計比例，但種子 1337 的該範圍只有 **11 株**仙人掌 → ±30% 的比例容差必然失敗（3 格佔 18% vs 期望 11%，相對偏差 64%）。改成**兩條**測試）：
    - `'cactusHeight maps to 1/2/3 with the vanilla 11:5:2 shares'`（**映射層**，不經世界過濾）：對 262,144 個取樣點（`x = i*8`、`z = j*8`，i、j ∈ [0, 512) → 覆蓋 4096×4096；只用雜湊、不做生物群系／高度判斷）呼叫 `cactusHeight(x, z, SEED)` → 斷言 1 格的比例 ∈ [0.58, 0.64]、2 格 ∈ [0.25, 0.31]、3 格 ∈ [0.08, 0.14]（原版 11/18 = 61.1%、5/18 = 27.8%、2/18 = 11.1%；本機實測 61.18%／27.78%／11.04%）。
    - `'cactus heights in the world are mostly one block tall'`（**世界層**，取樣區＝**連續 1024×1024 格、種子 1337**，與 §6 的實測同區；該區有 25832 個沙漠柱、**136 株**仙人掌）：斷言總數 ≥ 50（不是空轉）、**1 格最多**（`count1 > count2` 且 `count1 > count3`）、且 1 格佔比 ∈ [0.45, 0.80]、3 格佔比 ≤ 0.35。
      （不斷言「2 格 > 3 格」：n = 136 時取樣雜訊足以翻轉 2／3 的次序（實測 24 vs 28）；精確比例由上面的映射層測試釘住。）
  - `'ice replaces the top water block only in cold columns'`：**改用 chunk `(−14, −10)`**（種子 1337 該塊有 92 個 `h ≤ 60` 的水柱，其中 **51 個**氣溫 < −0.24 → 會結冰；2026-10-20 稽核修正：原寫的 128×128 範圍 `h<62` 的水柱數為 **0** → 斷言永遠不執行）。斷言三件事：
    1. 每個 ICE 格都在 `y = SEA_LEVEL`（水面頂端）、其柱的 `surfaceHeight ≤ SEA_LEVEL − 2`（**水深 ≥ 2 格**，規則本身的要求，原敘述漏了這個條件）、且該柱氣溫 < −0.24；
    2. 每個「氣溫 < −0.24 且 `h ≤ SEA_LEVEL − 2`」的柱，其頂端水格（`y = SEA_LEVEL`）**一定是 ICE**；
    3. 守衛：該 chunk 的 ICE 格數 > 0（避免規則改壞後測試變空轉）。
  - `'decorations are deterministic'`：同一 chunk 生成兩次 → 位元組完全相同。

  `src/world/hazards.test.ts`：
  - `'touching a cactus deals one damage per second'`：`stepHazards(createHazardState(), true, 0.5)` → damage 0；再 0.5 秒 → damage 1。
  - `'not touching a cactus deals no damage and resets the accumulator'`。
  - `'a non-finite dt never damages'`。
  - `'touchesCactus detects an overlapping cactus cell'`：玩家 AABB 與 CACTUS 格重疊 → true；離開 → false。

  `src/world/worldgen-stats.test.ts`：裝飾密度段（容差見 §6 表；取樣區＝**連續 1024×1024 格、種子 1337**，與 §6 的實測值同一區域；統計方式＝「裝飾棵數 ÷ 可放置柱數 × 256」，仙人掌與冰另用各自的母體）。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/world/decorations.test.ts src/world/hazards.test.ts` → Expected: FAIL（模組不存在）。

- [ ] **Step 3: 實作 `src/world/decorations.ts`**

  - **機率表（8 鍵窮舉，`Record<Biome, number>` 少一個就編譯不過）**：
    | 生態 | `FLOWER_PROBABILITY` | `GRASS_PROBABILITY` |
    |---|---|---|
    | plains | 0.0078 | 0.10 |
    | forest | 0.0078 | 0.12 |
    | birch_forest | 0.0117 | 0.12 |
    | taiga | 0.0039 | 0.08 |
    | mountains | 0.0039 | 0.05 |
    | **snowy_plains** | **0** | **0** |
    | **desert** | **0** | **0** |
    | **ocean** | **0** | **0** |
    （2026-10-20 稽核修正：§6 的表只列了 5 個有值的生態 → 實作者只能猜另外 3 個；這裡補齊，雪原不長花、沙漠與海洋沒有地表植被。）

  - 擲骰全部用 `hash2(x, z, seed ^ salt)`：花的機率鹽 `0x2f1c7a3d`、花的種類鹽 `0x77aa33cc`、草叢鹽 `0x1b3d5e7f`、仙人掌鹽 `0x6c8e12f4`、仙人掌高度鹽 `0x51d3c7a9`。
  - `plantDecorations(data, cx, cz, seed)`：對 chunk 內每個柱 `(lx, lz)`：
    1. `h = surfaceHeight(wx, wz, seed)`；`biome = biomeAt(wx, wz, seed)`。
    2. 若 `h > SEA_LEVEL`（陸地）且表層是 GRASS：
       - 先判斷花：`flowerRoll < FLOWER_PROBABILITY[biome]` → 在 `(wx, h+1, wz)` 放 `DANDELION` 或 `POPPY`（依 `flowerKind`），且該格必須是 AIR。
       - 否則判斷草叢：`grassRoll < GRASS_PROBABILITY[biome]` → 在 `(wx, h+1, wz)` 放 `SHORT_GRASS`（該格必須是 AIR）。
    3. 若 `biome === 'desert'` 且表層是 SAND 且 `cactusRoll < CACTUS_PROBABILITY` → 在 `(wx, h+1 .. h+height, wz)` 放 CACTUS（高度依 `cactusHeight`；每格必須是 AIR）。
    4. 冰：若 `h < SEA_LEVEL - 1`（水深 ≥ 2）且 `isCold(wx, wz, seed)` → 把 `(wx, SEA_LEVEL, wz)` 的 WATER 換成 ICE。
  - 寫入邊界：`y < CHUNK_HEIGHT` 且 `0 ≤ lx,lz < CHUNK_SIZE`。

- [ ] **Step 4: 實作 `src/world/hazards.ts` 與 `main.ts` 接線**

  - `hazards.ts`：
    ```ts
    export function touchesCactus(world, pos, halfWidth, height): boolean {
      // 掃描玩家 AABB 覆蓋的格子（腳下 2 層 + 身高），任一格是 BLOCK.CACTUS → true
    }
    export function stepHazards(state, touching, dt) {
      const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
      if (!touching) return { state: { cactusAcc: 0 }, damage: 0 };
      const acc = state.cactusAcc + step;
      const whole = Math.floor(acc);
      return { state: { cactusAcc: acc - whole }, damage: whole };
    }
    ```
  - `main.ts`（`state === 'playing'` 分支內，靠近既有的傷害處理）：
    ```ts
    const hazard = stepHazards(hazardState, touchesCactus(world, player.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT), dt);
    hazardState = hazard.state;
    if (hazard.damage > 0 && vitals && canBeHurt(invuln, nowSec)) {
      invuln = markHurt(invuln, nowSec);
      setVitals(damage(vitals, hazard.damage));
    }
    ```
    （`PLAYER_HALF_WIDTH`／`PLAYER_HEIGHT` 從 `src/player/physics.ts` import；`invuln`／`canBeHurt`／`markHurt` 沿用 B1.5 的既有實例。）
  - `main.ts` 頂端：`let hazardState = createHazardState();`（`resetWorld()` 與 `startGame()` 時重置為 `createHazardState()`）。

- [ ] **Step 5: `terrain.ts` 接上裝飾**

  - `generateChunk`：填完方塊 → `plantTrees(...)` → `plantDecorations(...)`。
  - 順序理由：樹木先寫（樹幹會占掉地表格），裝飾只放在 AIR 格 → 樹下的草不會長在樹幹裡。

- [ ] **Step 6: 跑測試轉綠**

  Run: `npx vitest run src/world/decorations.test.ts src/world/hazards.test.ts src/world/worldgen-stats.test.ts` → Expected: PASS。

- [ ] **Step 7: 全量驗證＋人工**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → Expected: 全綠。
  人工（記錄結果）：平原上有零星蒲公英／罌粟與草叢；沙漠裡有仙人掌（1–3 格高）；雪原的水面結冰；踩到仙人掌會持續扣血。

- [ ] **Step 8: Commit**

  ```bash
  git add src/world/decorations.ts src/world/decorations.test.ts src/world/hazards.ts src/world/hazards.test.ts src/world/terrain.ts src/world/worldgen-stats.test.ts src/main.ts
  git commit -m "feat(worldgen): B3.4 地表裝飾（花／草叢／仙人掌／冰）與仙人掌接觸傷害"
  ```

---

### Task 7: `WORLDGEN_VERSION` 與存檔附加欄位（本機＋雲端）

**Files:**
- Create: `src/world/worldgen.ts`、`src/world/worldgen.test.ts`
- Modify: `src/world/save.ts`、`src/world/save.test.ts`
- Modify: `src/core/cloud-save.ts`、`src/core/cloud-save.test.ts`

**Interfaces:**
- Consumes: 無（純版本／欄位政策）。
- Produces:
  - `src/world/worldgen.ts`：
    ```ts
    export const WORLDGEN_VERSION = 1;
    export function needsWorldgenNotice(saved: number | undefined | null): boolean;
    //   → saved !== WORLDGEN_VERSION（缺欄位 = 舊存檔 = 要提示）
    ```
  - `src/world/save.ts`：
    - `SavePayloadV3` 新增 `worldgenVersion?: number`（**附加欄位，版本仍是 3**）。
    - `collectSavePayload` 一律寫入 `worldgenVersion: WORLDGEN_VERSION`。
    - `loadGame` **保留原值**：讀到的記錄有合法數字就原樣帶回（舊記錄沒有這個鍵 → 回傳物件**不含**該鍵，而不是塞 `undefined`）；絕不自動補上當前版本（補了就看不出舊存檔、也永遠不會提示）。
  - `src/core/cloud-save.ts`：
    - `CloudData` 新增 `worldgenVersion?: number`（format 仍是 1）。
    - `buildCloudData` 一律寫入 `worldgenVersion: WORLDGEN_VERSION`。
    - `validateCloudData`：`worldgenVersion` 若存在必須是有限數字（否則整筆拒收）。
    - `acceptCloudData`：有合法數字就原樣帶回，沒有就不加這個鍵。
  - `game.json` 的 `cloudSave` **不動**（`readableFormats:[1], writeFormat:1`）。

- [ ] **Step 1: 寫測試（失敗）**

  `src/world/worldgen.test.ts`：
  - `'the worldgen version is 1'`：`expect(WORLDGEN_VERSION).toBe(1)`。
  - `'a missing version needs the notice'`：`expect(needsWorldgenNotice(undefined)).toBe(true)`、`expect(needsWorldgenNotice(null)).toBe(true)`。
  - `'the current version does not need the notice'`：`expect(needsWorldgenNotice(WORLDGEN_VERSION)).toBe(false)`。
  - `'an older version needs the notice'`：`expect(needsWorldgenNotice(WORLDGEN_VERSION - 1)).toBe(true)`。

  `src/world/save.test.ts`：
  - 既有 `makePayload()` fixture **補上** `worldgenVersion: WORLDGEN_VERSION`（否則 round-trip 的 deep-equal 會失敗）。
  - 新 `'a record without worldgenVersion keeps the key absent'`：寫入一個 `delete` 掉 `worldgenVersion` 的 v3 記錄 → `loadGame()` 回傳的物件**沒有** `worldgenVersion` 鍵（`expect('worldgenVersion' in loaded!).toBe(false)`）→ 這是「舊存檔」的判準。
  - 新 `'a record with a non numeric worldgenVersion drops the key'`（2026-10-20 稽核修正）：寫入 `worldgenVersion: 'x'`（型別不符、`isValidSavePayload` 不收緊所以通過驗證）→ `loadGame()` 回傳的物件**沒有** `worldgenVersion` 鍵（`expect('worldgenVersion' in loaded!).toBe(false)`）→ 不得把非法值原樣帶回。
  - 新 `'collectSavePayload stamps the current worldgen version'`：`expect(payload.worldgenVersion).toBe(WORLDGEN_VERSION)`。
  - 新 `'a migrated v1 record has no worldgenVersion'`（既有 v1→v3 遷移測試的 `toEqual` 仍成立，因為缺鍵不等於 `undefined` 鍵——若實作者選擇保留 `undefined` 鍵，`toEqual` 也會忽略；兩種做法都可接受，但**必須**讓 `'worldgenVersion' in payload` 為 false）。

  `src/core/cloud-save.test.ts`：
  - 新 `'buildCloudData stamps the worldgen version'`：`expect(built.worldgenVersion).toBe(WORLDGEN_VERSION)`。
  - 新 `'a cloud payload without worldgenVersion stays valid (format 1 forwards-compat)'`：`validateCloudData(rawValid())` → true；`acceptCloudData(rawValid())` → 回傳物件**不含** `worldgenVersion` 鍵。
  - 新 `'a cloud payload with a non numeric worldgenVersion is rejected'`：`validateCloudData({ ...rawValid(), worldgenVersion: 'x' })` → false。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/world/worldgen.test.ts src/world/save.test.ts src/core/cloud-save.test.ts` → Expected: FAIL。

- [ ] **Step 3: 實作**

  - `worldgen.ts`：兩個匯出（`WORLDGEN_VERSION = 1`、`needsWorldgenNotice`）。
  - `save.ts`：`SavePayloadV3` 加 `worldgenVersion?: number`；`collectSavePayload` 加 `worldgenVersion: WORLDGEN_VERSION`；`loadGame` 的回傳物件用「有合法數字才帶鍵」的方式處理：
    ```ts
    // 2026-10-20 稽核修正：原本只做「有合法數字才帶鍵」的**展開**，但 `{...v2}`
    // 已經把原記錄的 worldgenVersion（可能是字串 'x'）帶進來 → 回傳物件仍留著
    // 非法值，違反「其餘不帶鍵」的自述語意。這裡明確把該鍵**剝除**再決定要不要加回。
    const { worldgenVersion: _drop, ...v2Clean } = v2 as Partial<SavePayloadV3>;
    const rawVersion = (value as Partial<SavePayload>).worldgenVersion;
    const worldgenVersion = typeof rawVersion === 'number' && Number.isFinite(rawVersion) ? rawVersion : undefined;
    return { ...v2Clean, version: 3, ...(worldgenVersion === undefined ? {} : { worldgenVersion }), stash: ..., player: ... };
    ```
    （`v2` 是從 `value` 遷移來的 v3 物件；`isValidSavePayload` **不放寬也不收緊**，所以 `worldgenVersion: 'x'` 這種記錄會通過驗證 → 必須靠這裡剝除。）
  - `cloud-save.ts`：同上（`CloudData.worldgenVersion?: number`；`buildCloudData` 寫入；`validateCloudData` 檢查型別；`acceptCloudData` 有才帶）。
  - **注意**：`isValidSavePayload` 的結構檢查**不放寬也不收緊**（`worldgenVersion` 是附加欄位，舊的 v1/v2/v3 記錄照樣通過）。

- [ ] **Step 4: 跑測試轉綠**

  Run: `npx vitest run src/world/worldgen.test.ts src/world/save.test.ts src/core/cloud-save.test.ts` → Expected: PASS。

- [ ] **Step 5: 全量驗證**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → Expected: 全綠。

- [ ] **Step 6: Commit**

  ```bash
  git add src/world/worldgen.ts src/world/worldgen.test.ts src/world/save.ts src/world/save.test.ts src/core/cloud-save.ts src/core/cloud-save.test.ts
  git commit -m "feat(save): B3.5 WORLDGEN_VERSION 與存檔附加欄位（本機 v3／雲端 format 1 皆維持版本）"
  ```

---

### Task 8: 「地形已改變」一次性提示

**Files:**
- Create: `src/ui/worldgen-notice.ts`、`src/ui/worldgen-notice.test.ts`
- Modify: `src/main.ts`（`continueGame`、`applyCloudData` 的接線）
- Test: `src/ui/worldgen-notice.test.ts`

**Interfaces:**
- Consumes: Task 7 的 `WORLDGEN_VERSION`、`needsWorldgenNotice`；`Toasts`（`src/ui/toast.ts`）。
- Produces:
  - `src/ui/worldgen-notice.ts`：
    ```ts
    export const WORLDGEN_NOTICE_TITLE = '地形已改變';
    export const WORLDGEN_NOTICE_TEXT = '世界生成器已更新：舊存檔的地形會整片改觀（你的建築可能浮空、埋入或入水）。';
    export const WORLDGEN_NOTICE_ICON: ItemId = 'grass';
    export function pushWorldgenNotice(toasts: Toasts): void;   // toasts.push({title, description, icon})
    ```
  - `main.ts`：
    - `continueGame(payload)` 結尾：若 `needsWorldgenNotice(payload.worldgenVersion)` → `pushWorldgenNotice(toasts)` ＋ **立刻**把當前 session 的 payload 加上 `worldgenVersion: WORLDGEN_VERSION` 寫回本機存檔（`saveGame`），成功後更新 `savedPayload`（讓標題畫面的「繼續遊戲」用新存檔）。
    - `applyCloudData(data)`（開機套用雲端進度）：若 `needsWorldgenNotice(data.worldgenVersion)` → `pushWorldgenNotice(toasts)`（雲端資料會在下一次 checkpoint 帶上新版本）。
    - `startGame()` **不**提示（新遊戲沒有舊地形）。

- [ ] **Step 1: 寫測試（失敗）**

  `src/ui/worldgen-notice.test.ts`（jsdom）：
  - `'the notice carries the terrain-changed title and explanation'`：用一個假的 `Toasts`（`push` 記錄參數）→ `expect(pushed.title).toBe('地形已改變')`；`expect(pushed.description).toContain('地形')`；`expect(pushed.icon).toBe('grass')`。
  - `'the notice is a toast, not a modal'`：模組**不得** import `menus`（用 `expect(icon).toBe('grass')` 與匯出的常數釘住「toast 路徑」；並在檔頭註解寫明與 B1.4 的 `showConfirm` 不同）。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/ui/worldgen-notice.test.ts` → Expected: FAIL（模組不存在）。

- [ ] **Step 3: 實作 `src/ui/worldgen-notice.ts`**

  - 只匯出三個常數與 `pushWorldgenNotice(toasts)`；`import type { Toasts } from './toast';`（**只 import 型別**，不 import 任何 `bus`／`main`）。
  - 檔頭註解寫明：與 B1.4 的 `menus.showConfirm`（模態、標題畫面、防止覆蓋進度）是**不同**的路徑；本提示是進遊戲後的非模態 toast。

- [ ] **Step 4: `main.ts` 接線**

  - import：`import { WORLDGEN_VERSION, needsWorldgenNotice } from './world/worldgen';`、`import { pushWorldgenNotice } from './ui/worldgen-notice';`
  - `continueGame(payload)` 結尾（`setState('playing'); relockCanvas();` 之前）：
    ```ts
    if (needsWorldgenNotice(payload.worldgenVersion)) {
      pushWorldgenNotice(toasts);
      const current = sessionSavePayload();
      if (current) {
        const stamped = { ...current, worldgenVersion: WORLDGEN_VERSION };
        void saveGame(stamped).then(() => { savedPayload = stamped; }, () => { /* 寫入失敗不阻擋進遊戲 */ });
      }
    }
    ```
    （`sessionSavePayload()` 會回傳 `SavePayload | null`；`stamped` 的型別是 `SavePayload` ＋ 附加欄位 → 直接符合 `SavePayload` 的型別。）
  - `applyCloudData(data)`：`if (needsWorldgenNotice(data.worldgenVersion)) pushWorldgenNotice(toasts);`（放在套用完成後）。
  - `startGame()`：不動（新遊戲無提示）。

- [ ] **Step 5: 跑測試轉綠**

  Run: `npx vitest run src/ui/worldgen-notice.test.ts src/world/save.test.ts src/core/cloud-save.test.ts` → Expected: PASS。

- [ ] **Step 6: 全量驗證＋人工**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → Expected: 全綠。
  人工（記錄結果）：
  1. 先用 0.4.0 的存檔（或手動把 `worldgenVersion` 從 IndexedDB 記錄刪掉）→ 進遊戲 → 右上角出現一次「地形已改變」toast。
  2. 存檔並離開 → 再進 → **不再**出現（存檔已帶 `worldgenVersion`）。
  3. 標題畫面按「單人遊戲」→ 仍是 B1.4 的**模態確認框**（「將覆蓋現有進度…」），與 toast 不同。

- [ ] **Step 7: Commit**

  ```bash
  git add src/ui/worldgen-notice.ts src/ui/worldgen-notice.test.ts src/main.ts
  git commit -m "feat(ui): B3.5 舊存檔一次性「地形已改變」提示（toast 路徑，與 B1.4 確認框分離）"
  ```

---

### Task 9: 接線、效能與 worker 相容

**Files:**
- Modify: `src/main.ts`（生物群系取樣與霧色、危險傷害、生成器接線確認）
- Modify: `src/world/worldgen-stats.test.ts`（效能預算測試）
- Modify: `src/world/worker-client.test.ts`（worker 相容測試）

**Interfaces:**
- Consumes: Task 1–8 全部。
- Produces:
  - `src/main.ts`：`biomeNow` 的型別自動跟著新的 `Biome` union（`biomeAt` 回傳新 union）；`applyBiomeTint` 自動支援 8 生態。**不新增任何組裝根邏輯**，只確認接線正確。
  - `src/world/worldgen-stats.test.ts`：效能預算測試。
  - `src/world/worker-client.test.ts`：worker 相容測試。

- [ ] **Step 1: 新增效能預算測試（`src/world/worldgen-stats.test.ts`）**

  - `'generating 16 chunks stays inside the performance budget'`：
    ```ts
    const times: number[] = [];
    for (let i = 0; i < 16; i++) {
      const t0 = performance.now();
      generateChunk(i % 4, Math.floor(i / 4), 1337);
      times.push(performance.now() - t0);
    }
    const total = times.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(500);      // ≈31 ms/區塊：比 8 ms 預算寬約 4 倍，CI 慢也不誤報
    expect(Math.max(...times)).toBeLessThan(50);  // 抓單一區塊的病態退化
    console.log(`chunk gen: total ${total.toFixed(1)} ms, per chunk ${(total / 16).toFixed(2)} ms`);
    ```
    （用 `it('...', { timeout: 30000 }, ...)`。）
    （2026-10-20 稽核修正：原門檻是「16 區塊 < 1500 ms」≈ 94 ms/區塊＝預算的 11.7 倍 → 生成從 2 ms 退化成 40 ms/區塊仍然綠，Review Focus #5「效能不能退化到卡幀」沒有測試支撐。**8 ms/區塊的預算以「觀察值」回報**（上面的 `console.log` 印出實測毫秒數、寫進回報），不作為 CI 硬門檻——CI 機器的浮動會造成假紅，硬門檻只會逼實作者去放寬它。）

- [ ] **Step 2: 新增 worker 相容測試（`src/world/worker-client.test.ts`）**

  既有測試全部用 `MockWorker`（回傳 16 bytes 的假 buffer），**沒有**比較真實地形 → 新增一個驗「**同步退路**與主執行緒的 `generateChunk` 位元組相同」的案例（走既有測試已經覆蓋的 `degrade → 同步退路` 路徑）：

  ```ts
  it('the sync fallback returns exactly the terrain generateChunk produces', async () => {
    const client = new TerrainWorkerClient(1337, 1);
    const w = lastWorker();
    const pending = client.request(2, -3);
    w.fail();                       // 模擬 worker 失效 → 走同步退路
    const resp = await pending;
    expect(new Uint8Array(resp.buffer)).toEqual(generateChunk(2, -3, 1337));
  });
  ```
  （`generateChunk` 從 `./terrain` import；`new Uint8Array(buffer)` 與 `generateChunk` 回傳的 `Uint8Array` 逐格相等 → 兩條路徑的生成結果完全相同。）
  （2026-10-20 稽核修正：**標題與說明只宣稱「同步退路 vs 主執行緒」**——`MockWorker` 只回 16 bytes 的假 buffer，無法驗「worker 路徑 vs 主執行緒」；原標題／說明寫得太寬，與〈批末驗收〉第 5 點不一致，現已統一。）

- [ ] **Step 3: `main.ts` 接線檢查（人工為主，不新增邏輯）**

  確認以下幾點（逐條核對，若發現缺口才補程式碼）：
  1. `import { generateChunk, surfaceHeight, biomeAt } from './world/terrain';` 仍可用（`terrain.ts` 的匯出沒有消失）。
  2. `biomeNow`（`main.ts` 約 L491）型別是新的 `Biome`；`applyBiomeTint(c.fog, biomeNow)` 對 8 生態都有色（`Record<Biome, number>` 窮舉 → 編譯期就會擋掉漏色）。
  3. `spawnPoint()`（約 L680）用 `surfaceHeight(0.5, 0.5, settings.seed) + 1` → 新的高度公式會讓出生點落在新地表上。**必須實作「出生點不可在水裡」的保護**：若 `surfaceHeight(0.5, 0.5, seed) <= SEA_LEVEL`，就在**已同步生成的 (0,0) 區塊內**（`spawnPoint()` 會先生成 chunk (0,0)）以 `(0,0)` 為中心螺旋搜尋第一個 `h > SEA_LEVEL` 的柱，並把出生點放在該柱的 `h + 1`；若整塊都在水裡，退回原公式（`surfaceHeight + 1`）並記錄警告。**不可**把出生點移到未生成的區塊（否則玩家會掉進虛空）。
  4. 危險傷害（Task 6 寫入的 `stepHazards`）在 `state === 'playing'` 分支每幀呼叫一次，且 `resetWorld()`／`startGame()` 會重置 `hazardState`。

- [ ] **Step 4: 跑測試轉綠**

  Run: `npx vitest run src/world/worldgen-stats.test.ts src/world/worker-client.test.ts` → Expected: PASS。

- [ ] **Step 5: 全量驗證＋人工**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → Expected: 全綠。
  人工（記錄結果）：
  - 開新遊戲 → 記錄「生成一個可見範圍（視距 6 → 13×13 = 169 塊）所花的時間」與「是否出現明顯掉幀」。
  - 單塊生成時間：以 Step 1 的效能測試輸出為準（實測約 2–3 ms／塊，預算 8 ms／塊）→ 把實測值寫進回報；同步退路（worker 失效）走的是同一支 `generateChunk`，因此同樣的單塊時間就是退路的上界。
  - 走路穿越生態邊界 → 霧色在 0.5 秒內改變、F3 的 Biome 行同步更新。

- [ ] **Step 6: Commit**

  ```bash
  git add src/main.ts src/world/worldgen-stats.test.ts src/world/worker-client.test.ts
  git commit -m "perf(worldgen): B3 效能預算與 worker 相容驗收（生成不卡幀）"
  ```

---

### Task 10: 0.6.0 發布

**Files:**
- Modify: `package.json`、`game.json`、`README.md`、`.github/workflows/release.yml`（若上游模板有變動才動）
- Create: `docs/releases/v0.6.0.md`

**Interfaces:**
- Consumes: Task 1–9 全部。
- Produces: tag `v0.6.0` 與 GitHub Release（CI 產生）。

- [ ] **Step 1: 版本 bump**

  `package.json` `"version": "0.6.0"`；`game.json` `"version": "0.6.0"`（`cloudSave` **不動**、`id` 不動）。

- [ ] **Step 2: README 更新（照 spec §跨批次與 §6）**

  - `## 遊戲特色` 的「**世界**」段落補三條：多層噪音地形（海陸／侵蝕／山脊，海平面 62）、8 種生物群系（平原／森林／白樺林／針葉林／雪原／沙漠／山地／海洋含沙灘）、3 種樹木與地表裝飾（蒲公英／罌粟／草叢／仙人掌／冰）；並補一句「新木種與植被都有物品形式（可放進熱鍵欄、創造清單可取）」。
  - `## 與原版的差異` 補世界生成相關項：
    - 生物群系只有 8 種（原版 Overworld 有 60+ 種）；只做地表生態，沒有河流、沒有洞穴生態、沒有水下地形細節。
    - 地表裝飾只有蒲公英／罌粟／草叢／仙人掌／冰五種（原版的花與植被種類更多；本批沒有種子、沒有骨粉催熟）。
    - **花與草掉落自身**（原版需剪刀／骨粉）——刻意偏離，讓裝飾可再生；雲杉／白樺**葉不掉落**、**冰不掉落**（原版需絲絨觸碰，本作無絲絨）。
    - 冰只結在「雪原氣溫」的水面（沒有原版的凍河／凍洋與 snowfall height 機制）。
    - 樹木只有橡木／雲杉／白樺三種，且同生態內強制樹距 ≥ 3 格（原版沒有樹距限制）。
    - **舊存檔不保地形一致**：本作從不保存區塊，載入時會從種子重新生成整個世界 → 換生成器等於整片地形改觀（建築可能浮空、埋入或入水）。首次載入舊存檔會跳一次「地形已改變」提示。
    - 世界高度 256（既有條目保留）。
  - 存檔說明段落補：「payload v3 另存 `worldgenVersion`（附加欄位，舊版忽略）；舊存檔第一次載入會提示一次地形已改變」。
  - 雲端同步清單補：「世界生成版本（附加欄位，舊版可讀）」。

- [ ] **Step 3: 發布說明 `docs/releases/v0.6.0.md`**

  固定四段（中文）：`## 新增`／`## 修正`／`## 存檔格式與相容性提示`／`## 已知問題`。
  - 新增：8 種生物群系、3 種樹木（雲杉／白樺）、地表裝飾（蒲公英／罌粟／草叢／仙人掌／冰）、cross 型植被渲染、地形已改變提示。
  - 修正：樹數暴增（「樹海」）已修正為按生態的稀疏密度；地形對比度不足已改為三層噪音；`worldgenVersion` 欄位。
  - 存檔格式與相容性提示：本機 payload **仍是 v3**（只加附加欄位 `worldgenVersion`，舊版讀到會忽略）；雲端 **仍是 format 1**（同樣只加附加欄位）；0.6.0 寫出的存檔可被 0.4.0／0.5.0 讀取（附加欄位被忽略）；**但舊存檔在新版載入時地形會整片改觀**（決策 B 不保）——這是本批最需要告知使用者的一點，寫在最前面。
  - 已知問題：新方塊（雲杉／白樺／花／草／仙人掌／冰）**在本批已補上物品形式**（可放進熱鍵欄、出現在創造清單）；但**掉落規則仍是簡化版**——雲杉／白樺葉不掉落（與橡樹葉一致）、冰不掉落（原版需絲絨觸碰）、花與草**掉自身**（原版需剪刀／骨粉，這是刻意偏離，README〈與原版的差異〉明列）。

- [ ] **Step 4: release workflow 的 notes 檔支援（**本批不需修改 workflow**）**

  **先讀 repo 現況**：`.github/workflows/release.yml`（不是上游模板的 `game-release.yml`）**已經**有 `NOTES_ARGS=(--generate-notes)` ＋ `if [ -f "docs/releases/$RELEASE_TAG.md" ]; then NOTES_ARGS=(--notes-file ...)` 的邏輯（與 B1 Task 10 相同）。
  → **本步驟是 no-op**：不得為了「看起來有做事」而改 workflow（改了反而多一份無謂差異）。實作時只要確認 `docs/releases/v0.6.0.md` 存在，CI 就會用它當 release notes。
  （若實作時上游模板已改動而 repo 尚未同步，才照模板調整，並在回報中說明差異；workflow 的其餘檢查——tag 對版本、工具 sha256、pack＋validate——全部保留；不得出現 job 層 `runner`。）

- [ ] **Step 5: 全量 gates**

  Run: `npm run typecheck && npm test && npm run build && npm run lint`
  Expected: 全綠（既有 806 個測試**全部保留且不得弱化**（新增測試另計）；本批新增的統計與單元測試全數通過）。

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
  git commit -m "chore(release): 0.6.0"
  ```
  本計畫在 `b3-worldgen` 分支執行：tag 與 push 屬整支完成後的整合步驟——merge 回 master 後才 `git tag -a v0.6.0 -m "0.6.0: B3 世界生成"`＋`git push origin master`＋`git push origin v0.6.0`，由 controller 依 finishing-a-development-branch 流程執行。

- [ ] **Step 8: 驗證 CI Release**

  以 `webfetch https://github.com/TommyLamm/WeCraft/releases/tag/v0.6.0` 確認 release 存在、asset 已附、說明為 `docs/releases/v0.6.0.md` 內容。回報照 AGENTS.md 四段式：程式完成／ZIP 驗證／Release（CI 結果）／平台上架（若屬平台操作，向使用者確認後再按）。

- [ ] **Step 9: Commit（收尾）**

  若 Step 8 有任何補正（文件錯字、notes 檔更新），再一顆 commit；無則略過。

---

## 批末驗收

（spec §B3 批末驗收＋公約 §5。）

1. **gates**：`npm run typecheck`、`npm test`、`npm run build`、`npm run lint` 全綠；`.playroom/` 固定工具的 `pack-game.mjs`＋`validate-game.mjs` 全過。
2. **生成統計測試**（`src/world/worldgen-stats.test.ts` 全綠即為證據）：
   - 高度分佈：p05 44／p50 69／p95 89／p99 106，最高 126、最低 35（容差見 §3）。
   - 水域比例 29%（26%–32%）。
   - 8 生態面積比例（容差見 §4 表）。
   - 樹密度（容差見 §5 表）：平原 0.12、森林 6.96、白樺林 9.02、針葉林 6.41、雪原 0.05、**山地 0.37**（2026-10-20 稽核修正：原寫 0.45，與 §5 表的實測 0.365 不符）、沙漠／海洋 0。
   - 裝飾密度（容差見 §6 表）：花 0.5–1.6 朵／256 可放置柱、草叢 5%–12% 覆蓋、仙人掌 1.36 棵／256 沙漠柱、冰佔水柱 2.4%。
   - 樹距不變量：同生態兩棵樹 Chebyshev 距離 ≥ 3。
3. **目視**：新開一局，沿四個方向各走 200 格，確認能看到海洋＋沙灘、平原、橡木林、白樺林、針葉林、雪原、沙漠與帶雪頂的高山；F3 的 Biome 行與霧色同步。
   - **（2026-10-20 Task 1 審查修正）**「帶雪頂的高山」在**出生點**看不到屬**預期**：種子 1337 最近的 `h ≥ 92` 在 ≈230 格外（審查者獨立實測 ≈233），超過 `renderDistance = 10`（160 格）與 `FOG_FAR`（140 格，`src/render/scene.ts`）→ 山帶要走到高地處或放大 render distance 後才看得到。目視驗收時**記錄實際視距與看到的地帶**（出生點可見：水面、岸線、平原／森林的連續起伏；山帶另記錄觀察位置與視距），不要把「出生點看不到山帶」當成缺陷。
4. **效能**：單區塊生成 ≤ 8 ms（實測約 2–3 ms；**此預算以觀察值回報**——測試會印出實測毫秒數）；回歸門檻＝16 區塊總時間 < 500 ms（≈31 ms/區塊）且任一單區塊 ≤ 50 ms；worker 降級（同步生成）時主執行緒不卡幀。
5. **worker 相容**：`worker-client.test.ts` 驗「worker 失效後的**同步退路**回傳的位元組與主執行緒 `generateChunk` 完全相同」（worker 失效是唯一會走主執行緒生成的路徑，兩者必須位元組相同）。
6. **Playwright**：**本批不需要**——生成結果是「世界資料」，無法用 CDP 合成鍵在真實瀏覽器裡可靠地驗證視覺資產（地形、生物群系、植被貼圖需要人工目視或截圖比對，而 CDP 只能操作輸入，無法斷言生成內容）。可選的替代驗收：若環境允許，用 `npm run dev` 起本地伺服器 + Playwright 只做「**頁面載入無 console error、canvas 有非零像素**」的煙霧測試（不對生成內容做任何斷言），並把「地形視覺未經自動化驗證」明列於回報。

---

## 與公約／spec 的差異（逐條）

1. **新方塊的物品形式在本批補齊（2026-10-20 稽核修正：原寫「本批只新增方塊、不新增 `ItemId`」）**：既有 `src/core/items.test.ts` 有「每個 block（air／water 除外）都要有 item form」的不變量——本批新增 9 個 block id 若沒有物品形式，那條**既有**測試會直接紅。因此本批在 Task 3（4 個木／葉）＋ Task 4（5 個花／草／仙人掌／冰）把 `ItemId`／`ITEM_IDS`／`BLOCK_PAIRS`／`PLACEABLE`／材質音／圖示路徑一併補齊（圖示走既有「裁切 atlas 側面 tile」路徑，不需新畫圖）。**對 B5 計畫的對應要求（2026-10-20 controller 裁決）**：B5（0.8.0）**不得重做這 9 個物品形式**，只做自己的 5 個（`GRAVEL`／`GOLD_ORE`／`DIAMOND_ORE`／`SPRUCE_PLANKS`／`BIRCH_PLANKS`）＋ B4 的 `WOOL`；B5 的 Task 2 若仍列「補 B3 的 9 個物品形式」必須刪掉，否則兩批會重複宣告同一組 `ItemId`（`ITEM_IDS` 是窮舉 `Record`，重複會是編譯錯誤或重複 key）。
   - **（2026-10-20 終審修正：兩邊的所有權現已一致並互相寫明）**——B5 計畫已按此要求改寫：其 Global Constraints 的「每個新方塊的『物品形式』由新增它的批次自己補」表、B5〈沿用其他批次的介面〉§9、Task 2 的 `ItemId`／`BLOCK_PAIRS` 兩處都明寫「B3 自己補這 9 個的物品形式，**本批不得重做**」；B5 自己的新 `ItemId` 是 **18 個**。**本批（唯一擁有者）**：9 個物品形式在此補齊；B5 只做掉落／合成接線。
2. **掉落規則**：本批只釘死「葉子不掉、冰不掉、花草掉自身」三條（見 Task 3／4 的 `dropItemFor` 說明）；礦石掉落、物品→熔爐配方、創造清單捲動等仍是 B5 的工作。
3. **生物群系名稱沿用英文 id 顯示於 F3**：`ui.test.ts` 既有斷言 `'Biome: plains'` 不動 → F3 仍顯示原始 id（`birch_forest`、`snowy_plains`…），本批不加中文名對照表（避免為了純顯示去改既有 UI 測試）；README 的〈與原版的差異〉列出 id 對照。
4. **不做「深度（depth）」參數**：原版 6 參數中的 depth 決定洞穴生態，本批洞穴維持單一噪音門檻（spec 未要求洞穴生態），故只實作 5 個參數。
5. **樹距只在同生態內強制**（跨生態邊界不強制）：理由見 §5；spec 只寫「樹間距至少 2 格，避免樹冠互相糊住」，本批的實作為「同生態 ≥3、跨生態不保」——已在計畫與 README 記錄。
6. **`worldgenVersion` 的初值定為 1**：公約只給欄位名與政策，沒給初值；本批定 1（第一版有編號的生成器），未來改地形外觀的批次（B5 等）必須往上加。

---

## Self-Review 記錄

- **Spec coverage**：spec §B3.1（多層噪音／海平面 62／高度 0–255）→ Task 1＋§3；§B3.2（8 生態／表層方塊／植被／霧色／面積比例統計）→ Task 2＋Task 6＋§4；§B3.3（樹密度表／三樹種／方塊物品貼圖樹冠／樹距 ≥2）→ Task 3＋§5；§B3.4（花／草叢／仙人掌／冰／cross 模型）→ Task 4＋5＋6＋§6＋§7；§B3.5（決策 B 不保／`worldgenVersion`／一次性提示）→ Task 7＋8＋§8；§批末驗收（生成統計／目視／效能／worker 相容）→ 〈批末驗收〉；§跨批次（版本 0.6.0／README／發布說明）→ Task 10。
- **型別一致**：`WORLDGEN_VERSION`／`worldgenVersion`（Task 7 產生、Task 8 消費）；`Biome` 8 種 union（Task 2 產生、Task 3／6／`biome-fog` 消費）；`BlockDef.shape`／`isCross`／`isTargetable`（Task 4 產生、Task 5 消費）；`ChunkMesh.foliage`（Task 4 產生、Task 4 的 renderer 消費）；`TREE_CANDIDATE_PROBABILITY`（Task 3 產生、Task 3 的 `worldgen-stats.test.ts` 消費）；**新物品 id（9 個）與 `BLOCK_PAIRS`（Task 3 補 4 個、Task 4 補 5 個；`ITEM_IDS` 計數＝讀現況基數 N → N + 4 → N + 9）**（Task 3／4 產生、Task 3／4 的 `items.test.ts` 消費；`PLACEABLE` 同步補 9 筆）；`needsWorldgenNotice`（Task 7 產生、Task 8 消費）；存檔欄位名與公約 §3 一致（本機 v3 ＋ 附加、雲端 format 1 ＋ 附加）。
- **既有測試守衛**：本批要改寫的既有測試逐條列在〈本批要改寫的既有測試（清單）〉；**沒有任何一條既有斷言被刪除**（`items.test.ts` 的「每個 block 都要有 item form」守衛、`blocks.test.ts` 的窮舉表、`sounds.test.ts` 的長度斷言、`chunk-renderer.test.ts` 的子節點數斷言都只是「補資料／改數字」，覆蓋範圍不減）。
- **Review Focus→測試**：舊存檔欄位語意 → Task 7／8；跨塊樹冠與樹距 → Task 3；統計容差 → Task 1／2／3／6；cross 互動 → Task 5；效能與 worker → Task 9；block id 與 tile → Task 3／4。
- **比例**：計畫以決策、數值、簽名與測試斷言為主；演算法只在本質上無法由簽名與測試決定的地方（高度公式、樹冠形狀、cross quad 幾何）給出逐字公式／座標表，未抄整支程式。
- **已知未測面**：`src/main.ts` 無測試（組裝根）——Task 6／8／9 的接線以人工步驟佐證並在回報中列「未自動化」；地形視覺未經 Playwright 自動化驗證（見〈批末驗收〉第 6 點）。
- **2026-10-20 終審修正摘要**（本計畫依最終跨計畫複核報告修正；修正點在正文以「（2026-10-20 終審修正：…）」標出）：
  1. **必須修正 #2（漏改既有 `textures.test.ts` 洋紅層斷言 → 本批自己的 gates 必紅）**：既有 `'drawn tiles keep their content; empty layers are opaque magenta #ff00ff'` 寫死 `for (const layer of [TILE_COUNT, 32, 47, 63])`——本批 Task 4 把 `TILE_COUNT` 拉到 33、`T.ICE` 畫在 tile 32 → layer 32 變成內容層 → 該斷言必紅。**改寫落在 Task 3 Step 1**（改成 runtime 相對的 `[TILE_COUNT, TILE_COUNT + 1, 47, 63]`），並在 Task 4 Step 1 加上「只驗證、漏改則補改」的備援說明。**這是全計畫群唯一的修復點**——B5／B6／B8 都只驗證、不再重複改寫（各自的計畫已同步寫明）。
  2. **建議修正 #10 的延伸**：〈本批要改寫的既有測試（清單）〉新增 `src/render/textures.test.ts` 一列（原本清單裡沒有這個檔案 → 漏列＝沒修）。
  3. **所有權**：B3 是這 9 個方塊物品形式的**唯一擁有者**；B5 計畫已同步寫明「不得重做」，兩邊一致。
  4. **基數漂移（2026-10-20 終審修正，延伸自其他批次的同一規則）**：本批的物品計數斷言原寫死 `toBe(36)`（Task 3）／`toBe(41)`（Task 4）與「32 → 36 → 41」的敘述——那只有在上游批次都還沒落地時才對。**已改為「讀現況基數 N → N + 4（Task 3）／N + 9（Task 4）」**，並要求在 commit 訊息註明實際值；守衛強度不變（仍是精確計數斷言）。
