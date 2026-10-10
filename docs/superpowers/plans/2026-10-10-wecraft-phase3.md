# WeCraft Phase 3（視覺精修）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 spec「第三期（視覺）」：陰影、進階光照與 AO、雲、音效精修（從零建置程序音效系統）、粒子、手持模型、死亡/進度提示完善（Minecraft 式「進度」系統），另含 spec §5 標示為第三期重點的天空漸層、太陽/月亮方塊、生物群系霧色。

**Architecture:** 延續紅線——`world/`、`player/`、`core/` 不碰 Three/DOM（`player/input.ts` 既有例外）；Three.js 只存在 `render/` 與 `main.ts`。新增 `audio/` 模組（Web Audio 合成，spec §2 架構內），與 `render/` 同級但獨立：對外用 `play(kind, group, pos?)` + ambience 控制，瀏覽器不可用（jsdom、無 AudioContext）時全部 no-op。AO 進 mesher 的既有 per-vertex `shades` 與 merge signature；粒子/裂紋/手持模型以 `render/` 新模組 + main 薄接線。進度狀態進存檔 v2（v1 舊檔自動遷移）。

**Tech Stack:** TypeScript + Vite + Three.js + Vitest (jsdom) + ESLint；無新 runtime 依賴。

**Spec:** `docs/superpowers/specs/2026-09-23-wecraft-design.md`（§4 第三期清單、§5 視覺還原、§6 音效）。

**平台規格（AGENTS.md v2，repo 根目錄已更新為指向 `templates/game-agent-template.md` 的 stub）：** 執行本計畫前與收尾時，依新版 AGENTS.md §1 以網路工具完整重讀以下 `main` 分支文件，並列出本次適用要求與驗收項目：

- `https://raw.githubusercontent.com/TommyLamm/playroom-platform/main/templates/game-agent-template.md`（指令本體）
- `https://raw.githubusercontent.com/TommyLamm/playroom-platform/main/docs/game-development.md`
- `https://raw.githubusercontent.com/TommyLamm/playroom-platform/main/templates/game.schema.json`
- `https://raw.githubusercontent.com/TommyLamm/playroom-platform/main/templates/game-release.yml`
- `https://raw.githubusercontent.com/TommyLamm/playroom-platform/main/examples/starter/playroom-sdk.js`

**Approved Scope（使用者已拍板 2026-10-10）：**
- 「死亡/進度提示完善」的「進度提示」= **Minecraft 式「進度」系統**（約 9 條、toast 彈出、存檔保存）。
- **Playroom SDK（帳號雲端存檔／排行榜）不納入本期**，另開第四期。完成回報必須把「雲端存檔」列為**未執行**（平台文件視背包/存檔類遊戲建議接入；此為使用者明確決定之延後，見 Final Task）。
- 版本收尾提升至 `0.2.0`（package.json + game.json）；**未獲明確發布要求前不推 tag、不建立 Release**。

**Spec 落差備註：** AO 係數、陰影範圍/貼圖尺寸、雲參數、音效濾波表、進度清單內容、toast 時長、死因文案等 spec 未定細節，由本計畫直接拍板（見各 Task 常數表）。

**Spec 補充（§5「第三期重點，架構先預留」）：** 天空漸層、太陽月亮方塊、霧色隨生物群系/時間變化列入本期（Task 6）；陰影（Task 5）與雲（Task 7）來自 §4 清單；F3 加 `Biome` 行（spec §5 F3 規格含「生物群系」）。

---

## Global Constraints

- **架構紅線**：`core/`、`world/`、`player/` 不得 import Three.js 或新增 DOM 使用（`player/input.ts` 的既有事件監聽是既有例外）；Three.js 只出現在 `render/`、`main.ts`；`ui/` 不 import bus（由 main 以 callback 注入）；新 `audio/` 模組可以碰 DOM/Web Audio，但必須在無 AudioContext 環境（jsdom、拒絕情況）全部 no-op。
- **依賴**：runtime 依賴只有 `three`；不得新增 runtime 依賴（devDependency 允許，本次預期不加任何新依賴）。
- **測試**：與來源同置 `src/**/*.test.ts`，一律 `npx vitest run`；每個 Task 的 Expected 以實際輸出為準，不得以「應該會過」代替。
- **平台行為限制**：音效必須玩家手勢觸發、載入時不得自動播放、頁面切至背景自動靜音；不跳轉頂層、不開 popup、不提交表單、不自行鎖定頂層鍵盤；遊戲內 Esc 行為維持現行 pointer-lock 暫停（不改動、不依賴平台播放器退出機制）。
- **存檔**：localStorage key 維持 `wecraft.settings` 命名空間；IndexedDB 存檔格式由 v1 → v2 遷移必須保持舊檔可讀（Task 11）；儲存不可用時仍可遊玩。
- **成品**：`base: './'` 與相對路徑不變；dist 不含無關檔案；ZIP 限制（≤64 MiB / 解壓 ≤256 MiB / ≤10,000 entries / 封面 ≤5 MiB）由最終驗證確認。
- **效能**：60 FPS @ 視距 10 為目標；陰影與雲提供暫停選單開關（預設開）作為降級手段。
- **語言**：UI 文案沿用現行中英混用慣例（`You died!` 等既有字串不動；新文案以繁體中文為主）。
- **版本/發布**：`game.json` version 不含 `v`；tag 為 `v<version>`；未獲明確要求不推送 tag、不建立 Release、不呼叫平台發布 API。

## Review Focus

（spec 暗示、但各 Task 測試無法完整覆蓋、最可能咬到使用者的輸入類別；每條都已在下述對應 Task 放上釘住它的測試或走查步驟）

1. **音效自動播放政策**：載入頁面即出聲會被瀏覽器擋下或（更糟）照播；使用者期待「第一次點擊後才有聲音」。→ Task 9 探針測試 + Task 10 手勢接線 + Task 14 瀏覽器驗證。
2. **效能懸崖**：陰影 + 雲 + AO 同時開啟 @ 視距 10 可能壓垮 FPS；使用者期待 ≥55~60。→ Task 14 量測 + 開關降級。
3. **舊存檔相容**：0.1.3 的 v1 存檔在 0.2.0 必須能 Continue；使用者期待方塊/背包/血量完整保留。→ Task 11 遷移單測 + Task 14 瀏覽器以 v1 fixture 實測。
4. **着色器patch失效**：sky dome / 粒子 / 手持模型若在無 WebGL 或 three 版本變化時 patch 失效，使用者期待畫面仍能運作（退而求其次）。→ Task 3/4/8 的 jsdom 建構測試 + Task 14 實機截圖。
5. **AO 於區塊邊界**：相鄰區塊（含對角）的 AO 取樣漏接會在區塊縫上出現亮/暗接縫。→ Task 2 跨區塊（含對角）測試 + Task 14 走查截圖。

---

## File Structure

**Files to Create:**

- `src/world/particles.ts` — break/dig particle sim（純邏輯）
- `src/world/particles.test.ts`
- `src/render/crack.ts` — 挖掘裂紋 overlay（10 階段）
- `src/render/crack.test.ts`
- `src/render/particles.ts` — particle renderer（動態 BufferGeometry + texture array）
- `src/render/particles.test.ts`
- `src/render/sky.ts` — 天空穹頂漸層 + 太陽/月亮方塊
- `src/render/sky.test.ts`
- `src/render/clouds.ts` — 方形體積雲層
- `src/render/clouds.test.ts`
- `src/render/viewmodel.ts` — 第一人稱手持模型
- `src/render/viewmodel.test.ts`
- `src/core/viewmodel.ts` — 手持項目映射 + 揮動狀態（純）
- `src/core/viewmodel.test.ts`
- `src/core/biome-fog.ts` — 生物群系霧色（純）
- `src/core/biome-fog.test.ts`
- `src/core/advancements.ts` — 進度規則/狀態（純）
- `src/core/advancements.test.ts`
- `src/ui/toast.ts` — 進度 toast UI
- `src/ui/toast.test.ts`
- `src/audio/engine.ts` — AudioContext 生命週期/主音量/手勢/背景靜音
- `src/audio/engine.test.ts`
- `src/audio/sounds.ts` — 方塊→材質群映射、距離衰減、腳步間隔（純）
- `src/audio/sounds.test.ts`
- `src/audio/voices.ts` — 合成波形（挖/放/步/風/鳥/蟲）
- `src/audio/voices.test.ts`
- `src/audio/index.ts` — `createGameAudio` 對外組裝
- `src/audio/index.test.ts`

**Files to Modify:**

- `src/world/mesher.ts` — per-vertex AO（shade × AO）、merge signature 加 aoKey、對角鄰區塊取樣
- `src/world/mesher.test.ts`
- `src/render/textures.ts` — `getTextureArray()` 共享 memo、`drawCrackStage(stage)`
- `src/render/textures.test.ts`
- `src/render/chunk-renderer.ts` — 共享 texture array、shadow cast/receive flags
- `src/render/chunk-renderer.test.ts`（如既有斷言受影響）
- `src/render/scene.ts` — shadowMap 設定、陰影跟隨、`setShadowsEnabled`
- `src/render/scene.test.ts`
- `src/core/daynight.ts` / `daynight.test.ts` — `skyColors` 加 `zenith`
- `src/core/settings.ts` / `settings.test.ts` — `shadows`、`clouds`
- `src/world/terrain.ts` / `terrain.test.ts` — export `Biome`、`pickBiome`、`biomeAt`
- `src/ui/menus.ts` — 暫停選單：陰影/雲開關
- `src/ui/hud.ts` / `src/ui/ui.test.ts` — F3 加 `Biome` 行
- `src/ui/death.ts` / `src/ui/death.test.ts` — 死因行
- `src/ui/ui.css` — toast、死因樣式
- `src/world/save.ts` / `save.test.ts` — 存檔 v2 + 遷移
- `src/main.ts` — 全部接線（組合根）
- `README.md`、`package.json`、`game.json`、`.github/workflows/release.yml` — 收尾（Final Task）

---

## Task 1: 基準、環境與平台規格

**Files:**
- Modify: `AGENTS.md`（僅 commit 使用者既有更新，不改內容）
- 無程式變更

**Interfaces:**
- Consumes: 無
- Produces: 乾淨的綠燈基準；`node_modules`；本次平台適用要求清單（寫進 `progress.md` ledger）

- [ ] 1.1 依 AGENTS.md §1 以網路工具完整重讀平台上列 5 份 `main` 分支文件（template、game-development.md、schema、release.yml、SDK），並在 ledger 記下本次適用要求與驗收項目（至少涵蓋：音效手勢/背景靜音、iframe sandbox 驗收、存檔相容、ZIP 驗證、版本/tag 規則、未授權不發布、雲端存檔本期不接入）。
- [ ] 1.2 `npm install`（本 workspace 尚無 `node_modules`）。
- [ ] 1.3 `npx vitest run` → 預期 `Test Files 28 passed`、`Tests 529 passed`（與 README 記載一致；如數字不同以實際為準並記錄）。`npx tsc --noEmit` 與 `npx eslint .` → 0 錯誤。
- [ ] 1.4 commit 使用者既有的 AGENTS.md 更新（內容已是平台 stub，原封不動）：
      `git add AGENTS.md && git commit -m "docs: point AGENTS.md to the platform game-agent template"`

**Expected test output:**
```
 Test Files  28 passed (28)
      Tests  529 passed (529)
```

---

## Task 2: Per-vertex AO（mesher）

**Files:**
- Modify: `src/world/mesher.ts`
- Test: `src/world/mesher.test.ts`

**Interfaces:**
- Consumes: 既有 `neighborId`/`NeighborChunks`、`faceSignature`、`emitQuad`、`FACES`
- Produces: 同形狀 `MeshData`（`shades` 由「面亮度」變「面亮度 × AO」）；`faceSignature` 內部簽章改為 `id | tile<<8 | shadeKey<<16 | aoKey<<23 | WATER_BIT(1<<31)`（對外無介面變更）

**設計（拍板數值）：**
- `AO_FACTORS = [0.5, 0.7, 0.85, 1.0]`（level 0..3）。
- 遮蔽判定：`!isTransparent(blockId)`（水/玻璃/樹葉不遮蔽）。
- 對每個可見面 cell：front = cell + dir；每個 emit corner k（0=(u0,v0)、1=(u1,v0)、2=(u0,v1)、3=(u1,v1)）取樣 front + `su[k]·eu`、front + `sv[k]·ev`、front + 兩者：
  - `su = [a,-a,a,-a]`，`a = uFlip ? +1 : -1`；`sv = [b,b,-b,-b]`，`b = vFlip ? +1 : -1`（eu/ev 為 uAxis/vAxis 的單位向量）。
  - `occ1&&occ2 → level 0`；否則 `level = 3 - (occ1+occ2+occ3)`。
- `aoKey = Σ level_k << (2k)`（emit corner 順序）；同一簽章才合併（平坦面 AO 全同 → 合併數不變）。
- 合併矩形的四角用 anchor cell 的 packed aoKey 直接解對應四角（rect 內簽章相等 → 各 cell 同角值必同，數學上等價；對 ±x/±z 翻轉面同樣成立——以測試釘住）。
- 對角取樣可能跨到「對角區塊」：`NeighborChunks` 增 `xpzp/xpzm/xmzp/xmzm`，`sampleAt` 支援 dx、dz 同時 ±1 的位移（y 越界 → AIR）。

- [ ] 2.1 先跑既有 mesher 測試確認基準綠：`npx vitest run src/world/mesher.test.ts`。
- [ ] 2.2 新增失敗測試（檔內新 describe `per-vertex AO`）：
  - `isolated faces keep full shade`：單一草方塊，top 面頂點 shades 全 1.0（既有 `shades[8] === 1.0` 續綠即證明）；
  - `one side occluder darkens the touching corners to 0.85`：地面上 grass top（y=0），(1,1,0) 放 stone；查 (0,1,0) 頂面 → 靠 +x 側兩角 = 0.85、另一側 = 1.0（以頂點座標過濾）；
  - `two adjacent sides darken to 0.5`：+x、+z 各一 stone → 對應角 0.5；
  - `diagonal-only occluder → 0.85`、`side+diagonal → 0.7`；
  - `merge seam splits only where AO differs`：16×16 平坦草地，一端外側放牆 → 該面 quadCount 為 2（其餘 1）；純平坦 16×16 仍 ≤4 quads（既有測試維持）；
  - `samples across chunk borders`：牆放在相鄰 chunk（±x、含對角）→ 邊界草方塊頂角正確變暗；
  - `flipped faces map corners correctly`：+x 面單側遮蔽 → 以頂點座標斷言「正確的那兩角」變暗（釘住 uFlip 映射）。
- [ ] 2.3 跑測試 → RED（aoKey 不存在、遮角未變暗）。
- [ ] 2.4 實作 `mesher.ts`：擴充 `NeighborChunks`/取樣、計算/打包 aoKey、簽章重排（WATER_BIT 移至 bit31，注意 Int32 負值相等比較仍正確）、`emitQuad` 依 aoKey 產生每頂點 shade。若既有測試的 quadCount 因 AO 接縫增多，逐一核對「增量=正確的 AO 分裂」後更新並註記。
- [ ] 2.5 `npx vitest run` → 全綠。
- [ ] 2.6 commit：`feat(mesher): per-vertex ambient occlusion`

**Expected test output:**
```
 ✓ src/world/mesher.test.ts (30+ tests) 0ms
 Test Files  ... passed
```

---

## Task 3: 挖掘裂紋 overlay（10 階段）

**Files:**
- Modify: `src/render/textures.ts`, `src/render/textures.test.ts`
- Create: `src/render/crack.ts`, `src/render/crack.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- `textures.ts`：`export function drawCrackStage(stage: number): Uint8ClampedArray`（16×16 RGBA；透明底、黑色裂線 alpha=120；stage 0..9，越高越密；deterministic）
- `crack.ts`：
  - `export function crackStageFor(progress: number): number`（`min(9, floor(progress*10))`；非有限 → 0）
  - `export function crackQuadEuler(n: {x,y,z}): [number, number, number]`（面法向 → 貼面 Euler：±y 面用 x 旋轉、±x 用 y 旋轉、±z 直放）
  - `export function crackQuadCenter(hit: RayHit, inset = 0.003): {x,y,z}`（block center + normal·(0.5+inset)）
  - `export function createCrackOverlay(scene): { set(hit: RayHit | null, progress: number): void; dispose(): void }`（1 quad、10 材質、`polygonOffset` 防 z-fighting；jsdom 無 2D canvas 時材質 map 為 null 且不拋錯）
- Consumes: `getContext2d` 不可用時改為本地 try/catch（render 不 import ui）
- Produces: `crackOverlay.set(...)` 供 main 每幀呼叫

- [ ] 3.1 寫失敗測試：
  - `drawCrackStage`: 長度 1024；透明度只會是 0 或 120；`ink(9) > ink(4) > ink(0) > 0`（ink=非透明像素數）；同 stage 兩次呼叫相等；`NaN/-1 → stage 0`（內部 clamp）；
  - `crackStageFor`: `0→0、0.45→4、0.99→9、1→9、-1→0、NaN→0`；
  - `crackQuadEuler`: 六法向對映表；
  - `crackQuadCenter`: hit(3,4,5) n=(0,1,0) → {3.5, 5.503, 4.5}；
  - `createCrackOverlay`（jsdom）：`set(null,0)` → mesh.visible false；`set(hit,0.45)` → visible true；再 `set(null,0)` → false；`dispose()` 不拋錯。
- [ ] 3.2 跑 `npx vitest run src/render/crack.test.ts src/render/textures.test.ts` → RED。
- [ ] 3.3 實作三檔。
- [ ] 3.4 `main.ts` 接線：持有 `crackOverlay`；在 playing 的挖掘段記錄本幀 `digTarget`（`hit && input.state.dig && !attacking && 可破壞`），每幀 `crackOverlay.set(digTarget, dig.progress)`；非 playing（渲染尾巴）一律 `set(null, 0)`。
- [ ] 3.5 `npx vitest run` → 全綠。
- [ ] 3.6 commit：`feat(render): dig crack overlay with 10-stage animation`

**Expected test output:**
```
 ✓ src/render/crack.test.ts (6 tests)
 ✓ src/render/textures.test.ts
```

---

## Task 4: 破壞/挖掘粒子

**Files:**
- Create: `src/world/particles.ts`, `src/world/particles.test.ts`
- Modify: `src/render/textures.ts`（`getTextureArray()` memo + 測試）, `src/render/chunk-renderer.ts`（改用共享 array、不 dispose 它）, 必要時 `src/render/chunk-renderer.test.ts`
- Create: `src/render/particles.ts`, `src/render/particles.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- `world/particles.ts`（純）：
  - `export interface Particle { id: number; tile: number; pos: Vec3; vel: Vec3; life: number; maxLife: number; size: number }`
  - `export const MAX_PARTICLES = 200`
  - `export function spawnBreakBurst(list, blockId, pos, rng = Math.random): Particle[]`（12 顆；size 0.08–0.16、life 0.6–1.2、水平速度 1.5–3.5、`vel.y 2–5`；tile=`getBlockDef(blockId).side`）
  - `export function spawnDigChip(list, blockId, pos, rng = Math.random): Particle[]`（2 顆、life 0.3–0.5、速度 1–2）
  - `export function stepParticles(list, dt, isSolidAt): Particle[]`（重力 20；下墜碰實心面 → 停在地表、速度歸零；life 遞減、<=0 移除；總數封頂 MAX，超出丟最舊）
- `textures.ts`：`export function getTextureArray(): THREE.DataArrayTexture`（memo；`buildTextureArray` 保留）
- `render/particles.ts`：`export function createParticleRenderer(scene): { sync(list, camera): void; dispose(): void }`（每個粒子 4 頂點 billboard quad；動態 BufferGeometry 容量 MAX；`uv` tile-local、`texIndex`=tile、`color`=1；`MeshBasicMaterial({vertexColors, alphaTest:0.1, side:DoubleSide})` + `patchTextureArrayShader`）
- Consumes: `patchTextureArrayShader`、`getTextureArray`
- Produces: 供 main 每幀同步；`getTextureArray` 供 Task 8 手持模型共用

- [ ] 4.1 寫失敗測試（sim）：固定假 rng（回傳已知序列）→ burst 12 顆且欄位落在表定範圍；重力 `v.y -= 20*dt` 與位置積分；`life<=0` 移除；`isSolidAt` 命中 → 停在 `floor(y)+1` 且 `v.y=0`；超過 MAX → 長度 ≤ MAX 且最舊被丟。
- [ ] 4.2 跑 `npx vitest run src/world/particles.test.ts` → RED → 實作 → GREEN。
- [ ] 4.3 寫失敗測試（render + shared array）：
  - `getTextureArray()` 兩次呼叫同 ref；`buildTextureArray()` 仍回新物件（既有測試不動）；
  - `createParticleRenderer`（jsdom）：`sync` 2 顆 → `geometry.drawRange.count === 12`、`texIndex` 前四頂點 = 粒子 tile、`position.count === MAX*4`；`sync` 空 → drawRange 0；`dispose` 不拋錯；
  - `chunk-renderer.test.ts`：若有「dispose 會 dispose texture array」斷言 → 更新為共享陣列**不**被區塊卸載破壞（同一 ref 兩次 `new ChunkRenderer` 一致）。
- [ ] 4.4 跑 → RED → 實作 `getTextureArray` + `render/particles.ts` + chunk-renderer 改共享 → GREEN。
- [ ] 4.5 `main.ts` 接線：破壞時 `particles = spawnBreakBurst(...)`（survival/creative 皆噴——creative 也享受破壞爽感，屬視覺效果；拍板：皆噴）；挖掘中每累積 0.1s → `spawnDigChip`（位置=命中面外側半格）；playing 內 `stepParticles`（`isSolidAt` 同玩家）；渲染尾巴 `sync(particles, gs.camera)`。
- [ ] 4.6 `npx vitest run` → 全綠。
- [ ] 4.7 commit：`feat(render): block break and dig particle effects`

**Expected test output:**
```
 ✓ src/world/particles.test.ts (8 tests)
 ✓ src/render/particles.test.ts (4 tests)
```

---

## Task 5: 陰影（sun shadow map + 跟隨 + 開關）

**Files:**
- Modify: `src/core/settings.ts` / `settings.test.ts`
- Modify: `src/render/scene.ts` / `scene.test.ts`
- Modify: `src/render/chunk-renderer.ts`、`src/render/scene.ts`（mob renderer cast）
- Modify: `src/ui/menus.ts`、`src/ui/ui.test.ts`（menus 區塊）
- Modify: `src/main.ts`

**Interfaces:**
- `settings.ts`：`Settings.shadows: boolean`（`DEFAULT_SETTINGS.shadows = true`；非 boolean → 預設）
- `scene.ts`：
  - `export function shadowFollow(focusX: number, focusZ: number, sunDir: Vec3, dist = 100): { light: Vec3; target: Vec3 }`（focus 先 snap 到 2 格網格：`Math.round(v/2)*2`；`light = {x: fx + sunDir.x*dist, y: Math.abs(sunDir.y)*dist, z: fz + sunDir.z*dist}`、`target = {x: fx, y: 0, z: fz}`）
  - `GameScene.setShadowsEnabled(on: boolean): void`（`renderer.shadowMap.enabled`；切換時 traverse 一次 `material.needsUpdate = true`）
  - `GameScene.setSunFocus(x: number, z: number): void`（存 focus；`setDayNight` 用 `shadowFollow` 同步 `sunLight.position` 與 `sunLight.target.position`）
- `menus.ts`：`showPause` opts 增 `onToggleShadows: () => void`；暫停清單加按鈕 `陰影：開/關（讀 settings 顯示 開 / 關）`
- Consumes: 既有 `sunLightPosition`（保留，供 scene 內部）
- Produces: main 於 boot/切換時 `setShadowsEnabled`；每幀渲染尾巴 `setSunFocus(camera.position.x, camera.position.z)`

**設計（拍板）：** `renderer.shadowMap.type = THREE.PCFShadowMap`；`sunLight.castShadow = true`；`shadow.mapSize 2048²`；`shadow.camera` ortho `±56`、near 1、far 300；chunk opaque mesh `castShadow=receiveShadow=true`、water `receiveShadow=true/castShadow=false`；mobs `castShadow=true`（build 時 traverse set）；drops sprites 不投影；手持模型不投影。樹葉等 alphaTest 方塊投影為整格（已知近似，接受）。夜間太陽已鏡射至地平線上（既有），月光陰影保留（可接受）。

- [ ] 5.1 測試：settings（default true、persist、非 boolean fallback）；`shadowFollow`（snap、y=|sunDir.y|*dist、target.x/z=snapped）。
- [ ] 5.2 跑 → RED → 實作 settings + `shadowFollow` → GREEN。
- [ ] 5.3 `scene.ts`：shadowMap 設定、`sunLight.target` 加入 scene、`setSunFocus`/`setShadowsEnabled`、`setDayNight` 改用 `shadowFollow`（保持既有 `sunLightPosition` 測試綠）。
- [ ] 5.4 chunk-renderer / mob renderer shadow flags。
- [ ] 5.5 menus：按鈕 + `ui.test.ts` 更新（按鈕存在、點擊觸發 callback、label 反映 settings）。
- [ ] 5.6 `main.ts`：boot `gs.setShadowsEnabled(settings.shadows)`；pause `onToggleShadows` → `saveSettings({shadows})` + `gs.setShadowsEnabled`；渲染尾巴 `gs.setSunFocus(camera.position.x, camera.position.z)`。
- [ ] 5.7 `npx vitest run` → 全綠。
- [ ] 5.8 commit：`feat(render): dynamic sun shadows with follow focus and toggle`

**Expected test output:**
```
 ✓ src/core/settings.test.ts
 ✓ src/render/scene.test.ts
 ✓ src/ui/ui.test.ts
```

---

## Task 6: 天空漸層、太陽/月亮、生物群系霧、F3 Biome

**Files:**
- Modify: `src/core/daynight.ts` / `daynight.test.ts`
- Modify: `src/world/terrain.ts` / `terrain.test.ts`
- Create: `src/core/biome-fog.ts` / `biome-fog.test.ts`
- Create: `src/render/sky.ts` / `sky.test.ts`
- Modify: `src/ui/hud.ts` / `src/ui/ui.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- `daynight.ts`：`DayNightColors` 增 `zenith: number`（既有 `sky`/`fog`/`ambient`/`sunIntensity` 值都不變）。拍板色：`DAY_ZENITH = 0x3d6fc9`、`NIGHT_ZENITH = 0x05070f`；`zenith = lerpColor(NIGHT_ZENITH, DAY_ZENITH, dayF)`（不做金色窗，落日在 horizon）。
- `terrain.ts`：`export type Biome = 'plains' | 'desert' | 'forest' | 'snow'`；`export function pickBiome(temp, moist): Biome`（現有函式改 export）；`export function biomeAt(x: number, z: number, seed: number): Biome`（與 generateChunk 同式：`Noise(seed ^ 0x9e3779b9).fbm2` 取 temp/moist；Noise 以 seed memo）。
- `biome-fog.ts`：`export const BIOME_FOG_TINT: Record<Biome, number>`（plains `0xffffff`、desert `0xffd9a0`、forest `0xc2e0b2`、snow `0xe8f4ff`）；`export function applyBiomeTint(fogHex: number, biome: Biome, strength = 0.25): number`（逐通道 lerp 至 tint，非有限 strength → 0）。
- `render/sky.ts`：
  - `export function sunMoonPositions(sunDir: Vec3, r = 800): { sun: Vec3; moon: Vec3 }`（moon = −sunDir·r）
  - `export function createSky(scene): { setSky(sunDir: Vec3, colors: { zenith: number; horizon: number }, cameraPos: Vec3): void; dispose(): void }`——SphereGeometry(900) BackSide ShaderMaterial 漸層（`mix(horizon, zenith, clamp(dir.y*1.6+0.15,0,1))`、`fog:false`、`depthWrite:false`、renderOrder −2）；太陽 60² 黃 `0xffec8a`、月亮 40² 灰白 `0xe8edf2`、`fog:false`，位置 = `sunMoonPositions`，每幀 lookAt(cameraPos)。
- `hud.ts`：`DebugLinesParams` 增 `biome: Biome`；`formatDebugLines` 在 `Seed` 之後、`Triangles` 之前加 `Biome: ${p.biome}`。
- Consumes: `lerpColor`、`hash` 無關
- Produces: main 每幀：`biomeNow`（0.5s 節流，`biomeAt(player.x, player.z, settings.seed)`）；`const c = skyColors(clock.t); const tinted = { ...c, fog: applyBiomeTint(c.fog, biomeNow), sky: applyBiomeTint(c.sky, biomeNow) }; gs.setDayNight(sunDirection(clock.t), tinted); sky.setSky(dir, { zenith: c.zenith, horizon: c.sky }, gs.camera.position);`

- [ ] 6.1 測試：daynight 新增 `zenith` 斷言（0.25 → 0x3d6fc9、0.75 → 0x05070f、連續無 NaN；既有 sky/fog 斷言不變）；`pickBiome` 邊界與優先序（0.4,−0.2→desert；−0.4,0→snow；0,0.2→forest；0,0→plains）；`biomeAt` determinism + 抽樣穩定；`applyBiomeTint`（plains 不變、desert 精確期望值、strength=0 不變）。
- [ ] 6.2 跑 → RED → 實作 daynight/terrain/biome-fog → GREEN。
- [ ] 6.3 測試 `sunMoonPositions` + `createSky` 建構（jsdom：mesh 存在、`setSky` 不拋錯、dispose 乾淨）→ RED → 實作 `sky.ts` → GREEN。
- [ ] 6.4 hud `Biome` 行：更新 `ui.test.ts` 的 byte-stable 期望陣列（`Biome: plains` 插在 Seed 後）。
- [ ] 6.5 `main.ts` 接線（如上），F3 `formatDebugLines({... biome: biomeNow})`。
- [ ] 6.6 `npx vitest run` → 全綠。
- [ ] 6.7 commit：`feat(render): sky gradient, sun/moon quads and biome fog`

**Expected test output:**
```
 ✓ src/core/daynight.test.ts
 ✓ src/world/terrain.test.ts
 ✓ src/core/biome-fog.test.ts
 ✓ src/render/sky.test.ts
 ✓ src/ui/ui.test.ts
```

---

## Task 7: 雲（方形體積雲層 + 開關）

**Files:**
- Modify: `src/core/settings.ts` / `settings.test.ts`
- Create: `src/render/clouds.ts` / `clouds.test.ts`
- Modify: `src/ui/menus.ts`、`src/ui/ui.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- `settings.ts`：`Settings.clouds: boolean`（default true；非 boolean → 預設）
- `clouds.ts`：
  - `export interface CloudCell { x: number; z: number; w: number; d: number; h: number }`
  - `export function cloudPattern(seed: number, period = 512, cell = 16, density = 0.3): CloudCell[]`（`hash2(gx, gz, seed ^ 0xc10d)`；`hash % 100 < density*100` → cell `{x: gx*16+2, z: gz*16+2, w: 12, d: 12, h: 3 + (hash >>> 8) % 3}`）
  - `export function cloudFieldOffset(cam: number, drift: number, period = 512): number`（`Math.floor((cam - drift) / period) * period`）
  - `export function createClouds(scene, seed): { update(camX, camZ, timeSec): void; setEnabled(on): void; dispose(): void }`——`InstancedMesh(BoxGeometry(1,1,1), MeshLambertMaterial({color: 0xffffff}))`，instance = pattern cell（scale w×h×d、y 中心 150+h/2、`castShadow=false/receiveShadow=false`）；群組每幀：`pos = cloudFieldOffset(cam, drift)`，`driftX = (t*0.6) % 512`、`driftZ = (t*0.1) % 512`（飄移在世界座標內連續、群組以 period 整數吸附，圖樣週期相同故不可見）。
- `menus.ts`：`showPause` opts 增 `onToggleClouds: () => void`；按鈕 `雲：開/關`。
- Consumes: `hash2`
- Produces: main 渲染尾巴 `clouds.update(cam.x, cam.z, now/1000)`；boot/切換 `clouds.setEnabled(settings.clouds)`

- [ ] 7.1 測試：`cloudPattern`（同 seed 相等、異 seed 不同、cell 數 25–35%、全在 [0,512)²）；`cloudFieldOffset`（cam−drift ∈ [offset, offset+period)）；`createClouds`（jsdom：instance count=pattern 長度；`setEnabled(false)` → group.visible false；`update` 後 group.position 為 512 的整數倍+drift 之組合、連續兩幀 <2 格位移）。
- [ ] 7.2 跑 → RED → 實作 clouds + settings → GREEN。
- [ ] 7.3 menus 按鈕 + `ui.test.ts` 更新（同 Task 5 模式）。
- [ ] 7.4 `main.ts` 接線。
- [ ] 7.5 `npx vitest run` → 全綠。
- [ ] 7.6 commit：`feat(render): blocky volumetric cloud layer with toggle`

**Expected test output:**
```
 ✓ src/render/clouds.test.ts (8 tests)
 ✓ src/core/settings.test.ts
 ✓ src/ui/ui.test.ts
```

---

## Task 8: 第一人稱手持模型

**Files:**
- Create: `src/core/viewmodel.ts` / `viewmodel.test.ts`
- Create: `src/render/viewmodel.ts` / `viewmodel.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- `core/viewmodel.ts`（純）：
  - `export type ViewmodelItem = { kind: 'none' } | { kind: 'block'; blockId: number } | { kind: 'icon'; item: ItemId }`
  - `export function viewmodelItem(item: ItemId | null): ViewmodelItem`（`blockFromItem` 非 null → block；其餘 → icon；null → none）
  - `export interface Swing { t: number; active: boolean }`
  - `export function startSwing(s: Swing): Swing`（active=true、t=0）
  - `export function stepSwing(s: Swing, dt: number): Swing`（t+=dt/0.25；t≥1 → active=false、t=1）
  - `export function swingCurve(t: number): { rotX: number; posY: number; posZ: number }`（`u=clamp01(t)`；rotX=−1.4·sin(πu)、posY=−0.15·sin(πu)、posZ=−0.25·sin(πu)）
  - `export function bobCurve(phase: number): { posY: number; posX: number; rotZ: number }`（0.02·sin、0.015·sin(phase/2)、0.03·sin(phase)）
- `render/viewmodel.ts`：
  - `export function createViewmodel(scene, camera, iconFor: (item: ItemId) => HTMLCanvasElement): { setItem(item: ItemId | null): void; startSwing(): void; update(dt: number, visible: boolean, horSpeed: number): void; dispose(): void }`
  - 實作要點：`scene.add(camera)`（camera 子物件才會被渲染）；group 於 `(0.42, −0.42, −0.75)`、`rotation.y = −0.6`；block = BoxGeometry(0.38)+texIndex per face（[side,side,top,bottom,side,side]×4）+`MeshBasicMaterial`+`patchTextureArrayShader`+`getTextureArray()`；icon = PlaneGeometry(0.45)+CanvasTexture(iconFor)（`transparent, alphaTest 0.1, DoubleSide`）；走路 bob 相位由 `horSpeed` 累加；`visible=false` 或切換 item 時只顯示對應 child。
- Consumes: `getTextureArray`（Task 4）、`itemIcon` 由 main 注入
- Produces: main 每幀：item 變更偵測（`hotbar[selected]?.item ?? null` 快取比對）→ `setItem`；攻擊嘗試/放置嘗試/挖掘中（每 0.25s 重新觸發）/破壞成功 → `startSwing()`；渲染尾巴 `update(state==='playing'?dt:0, state==='playing' && !thirdPerson, hypot(player.velocity.x, player.velocity.z))`。

- [ ] 8.1 測試（core）：映射（grass→block 3、stick→icon、null→none、water→icon）；Swing 生命週期與邊界（dt NaN → 不變）；`swingCurve` 端點 0 與中點 −1.4；`bobCurve` 範圍。
- [ ] 8.2 跑 → RED → 實作 core → GREEN。
- [ ] 8.3 測試（render，jsdom）：`createViewmodel` 建構、`setItem(block)/setItem(icon)/setItem(null)` child 數量切換、`startSwing`+`update` 後 group 有位移跡象（記錄 rotation.x 或 position 差異）、`visible=false` → group.visible false、`dispose` 不拋錯。
- [ ] 8.4 跑 → RED → 實作 render → GREEN。
- [ ] 8.5 `main.ts` 接線（如上）。
- [ ] 8.6 `npx vitest run` → 全綠。
- [ ] 8.7 commit：`feat(render): first-person held item viewmodel`

**Expected test output:**
```
 ✓ src/core/viewmodel.test.ts (8 tests)
 ✓ src/render/viewmodel.test.ts (5 tests)
```

---

## Task 9: 音效引擎、材質映射與合成波形（`audio/`）

**Files:**
- Create: `src/audio/engine.ts` / `engine.test.ts`
- Create: `src/audio/sounds.ts` / `sounds.test.ts`
- Create: `src/audio/voices.ts` / `voices.test.ts`
- Create: `src/audio/testing.ts`（FakeAudioContext 測試替身；不進 bundle，tsc 可通過）
- Create: `src/audio/index.ts` / `index.test.ts`

**Interfaces:**
- `engine.ts`：
  - `export interface AudioEngineDeps { createContext?: () => AudioContext }`
  - `export interface AudioEngine { readonly started: boolean; readonly context: AudioContext | null; ensureStarted(): void; setVolume(v: number): void; suspend(): void; resume(): void; dispose(): void }`
  - `export function createAudioEngine(deps: AudioEngineDeps = {}): AudioEngine`
  - 行為：無 `AudioContext`（含 webkit fallback 都沒有）→ 永久 no-op；`ensureStarted` 冪等、建立 ctx+master gain（值=目前音量）→ destination、`state==='suspended'` 時嘗試 resume；`setVolume` clamp [0,1] 並記住（未啟動也記）；`suspend/resume` 未啟動或失敗皆吞掉。**不在建立時就 new AudioContext（不得自動播放）**。
- `sounds.ts`（純）：
  - `export type MaterialGroup = 'dirt'|'grass'|'sand'|'snow'|'stone'|'wood'|'leaves'|'glass'|'water'`
  - `export function materialGroup(blockId: number): MaterialGroup`（grass→grass、dirt→dirt、sand→sand、snow→snow、stone/cobble/coal_ore/iron_ore/bedrock→stone、log/planks/crafting_table→wood、leaves→leaves、glass→glass、water→water、其餘→dirt）
  - `export function gainForDistance(distance: number): number`（≤3 → 1；≥20 → 0；中間線性；非有限 → 0）
  - `export function footstepInterval(horSpeed: number): number`（≤0.1 → Infinity；否則 `clamp(1.35/speed, 0.3, 0.55)`）
  - `export interface SynthParams { filter: 'lowpass'|'bandpass'|'highpass'; freq: number; q: number; durationSec: number; gain: number }`
  - `export function synthParams(group: MaterialGroup, kind: 'dig'|'break'|'place'|'step'): SynthParams`
  - 表（拍板）：GROUP_BASE — dirt `lowpass 700 0.7`、grass `lowpass 900 0.7`、sand `lowpass 1200 0.7`、snow `lowpass 600 0.7`、stone `bandpass 1100 1.2`、wood `bandpass 800 1.0`、leaves `highpass 1800 0.8`、glass `highpass 3000 1.0`、water `lowpass 500 0.6`；KIND_MOD — dig `{dur .12, gain .5, scale 1}`、break `{dur .18, gain .6, scale .85}`、place `{dur .09, gain .5, scale .7}`、step `{dur .08, gain .25, scale .9}`；`freq = round(base.freq * scale)`。
- `voices.ts`：
  - `export function createNoiseBuffer(ctx: BaseAudioContext): AudioBuffer`（1 秒白噪，memo 由呼叫端持有）
  - `export function playOneShot(ctx: BaseAudioContext, dest: AudioNode, params: SynthParams, volume: number, noise: AudioBuffer): void`（bufferSource → biquad(filter/q/freq) → gain(0.005s 起音、durationSec 後 0.05s release) → dest）
  - `export function startWind(ctx, dest, noise): { stop(): void }`（loop source → lowpass 300 → gain 0.04）
  - `export function chirp(ctx, dest): void`（osc sine 1800→2600Hz 0.15s 掃頻 + gain 信封）
  - `export function cricket(ctx, dest, noise): void`（noise burst → highpass 4000 → 0.08s）
  - `export function phaseCue(ctx, dest, noise): void`（noise → bandpass sweep 200→800Hz 0.8s）
- `index.ts`：
  - `export type SoundKind = 'dig'|'break'|'place'|'step'`
  - `export interface GameAudio { ensureStarted(): void; setVolume(v: number): void; handleVisibility(hidden: boolean): void; play(kind: SoundKind, group: MaterialGroup, opts?: { pos?: {x,y,z}; listener?: {x,y,z}; volume?: number }): void; startAmbience(): void; stopAmbience(): void; setPhase(phase: 'day'|'night'): void; dispose(): void }`
  - `export function createGameAudio(deps: AudioEngineDeps = {}): GameAudio`
  - 行為：`play` 未啟動即 return；`volume = (opts.volume ?? 1) * gainForDistance(dist(listener ?? pos, pos))`（兩者缺省 → 距離 0）；`startAmbience` 未啟動 no-op，啟動後開風聲 + 依 phase 用遞迴 setTimeout（day：4–9s 隨機 chirp；night：3–7s cricket）；`setPhase` 換排程 + 播一次 phaseCue；`stopAmbience` 清 timer + 停風（冪等）。

- [ ] 9.1 建 `src/audio/testing.ts`（FakeAudioContext：state/destination/sampleRate/currentTime、createGain/createBiquadFilter/createBufferSource/createOscillator/createBuffer（getChannelData 回 Float32Array）、resume/suspend/close 回 Promise；記錄呼叫鏈供斷言）。
- [ ] 9.2 寫失敗測試：
  - engine：`ensureStarted` 前 `started=false` 且未呼叫 createContext（**不得自動播放**）；`ensureStarted` 冪等（ctx 只建一次）；`setVolume(2)→1`、`(-1)→0`、未啟動先設、啟動後 master gain = 記住值；無 createContext 且環境無 AudioContext → no-op 不拋；suspend/resume 僅在啟動後呼叫。
  - sounds：全部 BLOCK id 的 group 映射（表驅動）；`gainForDistance`（3→1、20→0、11.5→≈0.5、NaN→0）；`footstepInterval`（0→Infinity、0.05→Infinity、4.3→≈0.314、20→0.3）；`synthParams` 精確列（stone/dig、wood/place、grass/step、glass/break 四列）。
  - voices：`playOneShot` 建 bufferSource+biquad+gain、filter.type/frequency/Q 正確、`start()` 被呼叫、`stop()` 在 duration 附近排程（fake 記錄呼叫）；`startWind` 回傳 stop 且 stop 呼叫 source.stop；`chirp` 建 oscillator 並設 frequency 掃描。
  - index：未啟動 `play` 不建任何節點；啟動後 `play('dig','stone',{pos:{x:20,...},listener:{x:0,...}})` 的 gain ≈ 0（距離 20）；距離 11.5 → gain ≈ 0.5×base；`handleVisibility(true)` → suspend、`(false)` → resume；`stopAmbience` 冪等。
- [ ] 9.3 跑 `npx vitest run src/audio` → RED → 實作四檔 → GREEN。
- [ ] 9.4 `npx vitest run` → 全綠。
- [ ] 9.5 commit：`feat(audio): procedural Web Audio engine and synth voices`

**Expected test output:**
```
 ✓ src/audio/engine.test.ts (6 tests)
 ✓ src/audio/sounds.test.ts (8 tests)
 ✓ src/audio/voices.test.ts (4 tests)
 ✓ src/audio/index.test.ts (5 tests)
```

---

## Task 10: 音效接線（main、手勢、背景分頁、事件）

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: Task 9 `createGameAudio`、`materialGroup`、`footstepInterval`、`phaseOf`
- Produces: 遊戲內音效（挖掘/破壞/放置/腳步）＋環境音（風/鳥/蟲/晝夜轉場）

- [ ] 10.1 `main.ts`：`const audio = createGameAudio();`；boot `audio.setVolume(settings.volume)`。
- [ ] 10.2 手勢：`canvas.addEventListener('pointerdown', () => audio.ensureStarted(), { once: true })`；並在 `startGame()` 與 `continueGame()` 內（按鈕點擊本身是手勢）`audio.ensureStarted(); audio.startAmbience(); audio.setPhase(phaseOf(clock.t));`。`quitToTitle()` 內 `audio.stopAmbience()`。
- [ ] 10.3 背景分頁：既有 `visibilitychange` 監聽器開頭加 `audio.handleVisibility(document.visibilityState === 'hidden')`（存檔邏輯不動）。
- [ ] 10.4 音量：pause 選單 resume 的 `Object.assign(settings, loadSettings())` 之後加 `audio.setVolume(settings.volume)`。
- [ ] 10.5 事件聲：
  - 挖掘：判斷本幀 dig progress 是否前進（記錄 before/after `dig.progress`），前進時 `digSoundAcc += dt`，每 0.25s → `audio.play('dig', materialGroup(id), { pos: 方塊中心, listener: player.position })`；
  - 破壞成功 → `audio.play('break', materialGroup(id), { pos: 方塊中心, listener: player.position })`；
  - 放置成功（`spendFromSlot` 回 true 的分支）→ `audio.play('place', materialGroup(placeId), { pos: 目標中心 })`；
  - 腳步：`onGround && !flying && !inWater && horSpeed > 0.5` 時累積 `stepAcc`，達 `footstepInterval(horSpeed)` → 取腳下 `world.getBlock(floor(x), floor(y - 0.05), floor(z))` → `audio.play('step', materialGroup(groundId), { pos: player.position, listener: player.position })`；
  - 晝夜翻轉（既有 `bus.emit('time-changed')` 旁）→ `audio.setPhase(phase)`。
- [ ] 10.6 `npx vitest run` → 全綠；`npx tsc --noEmit` + `npx eslint .` 乾淨。
- [ ] 10.7（best-effort）瀏覽器快速探針：未點擊前無 AudioContext 建立（init script 包裝 ctor 計數）；點擊後 state=running；挖掘 2 s → bufferSource 建立數增加。環境不可用時如實延後到 Task 14 並註記。
- [ ] 10.8 commit：`feat(audio): wire dig/place/step sounds and ambience`

**Expected test output:**
```
 Test Files  ... passed (0 new failures — composition-root wiring carries no unit tests)
```

---

## Task 11: 進度核心 + 存檔 v2（遷移）

**Files:**
- Create: `src/core/advancements.ts` / `advancements.test.ts`
- Modify: `src/world/save.ts` / `save.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- `core/advancements.ts`（純）：
  - `export type AdvancementId = 'getting_wood'|'crafting_table'|'wooden_tool'|'stone_tool'|'stone_age'|'coal_miner'|'iron_age'|'monster_hunter'|'first_night'`
  - `export interface AdvancementDef { id: AdvancementId; title: string; description: string; icon: ItemId }`
  - `export const ADVANCEMENTS: readonly AdvancementDef[]`（拍板全表）：

    | id | title | description | icon | 觸發 |
    |---|---|---|---|---|
    | getting_wood | 取得原木 | 第一次拾取原木 | oak_log | obtain oak_log |
    | crafting_table | 合成台 | 合成一個工作台 | crafting_table | obtain crafting_table |
    | wooden_tool | 木製工具 | 合成一把木製工具 | wooden_pickaxe | obtain wooden_pickaxe/axe/sword |
    | stone_tool | 石製工具 | 合成一把石製工具 | stone_pickaxe | obtain stone_pickaxe/axe/sword |
    | stone_age | 鵝卵石 | 取得鵝卵石 | cobblestone | obtain cobblestone |
    | coal_miner | 煤炭開採 | 取得煤炭 | coal | obtain coal |
    | iron_age | 鐵礦 | 取得鐵礦 | iron_ore | obtain iron_ore |
    | monster_hunter | 怪物獵人 | 擊殺一隻怪物 | stone_sword | mob-killed |
    | first_night | 度過第一夜 | 活著看見黎明 | grass | nightSeen 後之 day |

  - `export interface AdvancementState { done: Partial<Record<AdvancementId, boolean>>; nightSeen: boolean }`
  - `export function emptyAdvancements(): AdvancementState`
  - `export type AdvancementEvent = { type: 'obtain'; item: ItemId; mode: GameMode } | { type: 'mob-killed'; mode: GameMode } | { type: 'phase'; phase: 'day'|'night' }`
  - `export function checkAdvancements(state, ev): { state: AdvancementState; unlocked: AdvancementId[] }`——obtain/mob-killed 在 creative 一律回原 state；已 done 不重複 unlock；`phase:'night'` 只設 nightSeen；`phase:'day' && nightSeen` → unlock first_night；回傳新物件（不 mutate 輸入）。
  - `export function sanitizeAdvancements(x: unknown): AdvancementState`（未知 id 丟棄、非 boolean 丟棄、非物件 → empty）。
- `save.ts`：
  - `SavePayload` → `version: 2`、`advancements: AdvancementState`；新增 `interface SavePayloadV1`（現行 v1 形狀）供遷移。
  - `collectSavePayload`：`SaveSources` 增 `advancements: AdvancementState`（複製）。
  - `loadGame()`：接受 v1 或 v2 形狀（validate base）→ 一律回傳 **normalized v2**：v1 → `{...v1, version: 2, advancements: emptyAdvancements()}`；v2 → `advancements: sanitizeAdvancements(...)`；其他版本 → null。
- Consumes: `ItemId`、`GameMode`
- Produces: main `let advancements = emptyAdvancements();`；`sessionSavePayload` 傳入；`continueGame` 還原；`startGame` 重置。

- [ ] 11.1 寫失敗測試（advancements）：9 條觸發逐條（表格驅動）；creative 忽略；重複觸發不重複 unlock；first_night 需 nightSeen（未見夜不 unlock）；state 不被 mutate；`sanitizeAdvancements`（垃圾 → empty、混合 id → 僅合法保留、null/字串 → empty）。
- [ ] 11.2 跑 → RED → 實作 → GREEN。
- [ ] 11.3 更新 `save.test.ts`：fixture 改 v2（含 advancements）；「wrong version」改為 `version: 3 → false`（原 `version: 2` 斷言移除）；新增：v1 raw record → `loadGame` 回 normalized v2（`advancements` = empty）；v2 帶垃圾 advancements → 載入且 sanitize；round-trip v2 deep-equal。
- [ ] 11.4 跑 `npx vitest run src/world/save.test.ts src/core/advancements.test.ts` → RED → 改 `save.ts` → GREEN。
- [ ] 11.5 `main.ts` 接線：宣告 + start/continue/存檔三處（unlock 事件接線在 Task 12）。
- [ ] 11.6 `npx vitest run` → 全綠。
- [ ] 11.7 commit：`feat(progress): advancement rules and save v2`

**Expected test output:**
```
 ✓ src/core/advancements.test.ts (14 tests)
 ✓ src/world/save.test.ts
```

---

## Task 12: 進度 toast + 解鎖接線

**Files:**
- Create: `src/ui/toast.ts` / `toast.test.ts`
- Modify: `src/ui/ui.css`
- Modify: `src/main.ts`

**Interfaces:**
- `toast.ts`：`export interface Toasts { push(opts: { title: string; description: string; icon: ItemId }): void; dispose(): void }`；`export function createToasts(uiRoot: HTMLElement, opts?: { durationMs?: number; max?: number }): Toasts`（預設 4000ms / 5 條；容器 `.toasts` 右上角、`.toast` 含 icon canvas（`itemIcon`）+ 標題 + 描述；超量先移除最舊；`dispose` 清 timer 與節點）。
- Consumes: `itemIcon`、`ADVANCEMENTS`、`checkAdvancements`
- Produces: main 中央路徑 `applyAdvancement(ev)`：`const r = checkAdvancements(advancements, ev); advancements = r.state; for (id of r.unlocked) toasts.push(def(id))`

- [ ] 12.1 寫失敗測試（fake timers）：push 產生節點（標題/描述/icon canvas）；duration 後自動移除；滿 5 條再 push → 最舊立即移除、總數 ≤5；dispose 清節點且後續 timer 不再動 DOM。
- [ ] 12.2 跑 → RED → 實作 + `ui.css`（`.toasts` 固定右上、`z-index:20`、`.toast` 進場動畫 0.25s）。
- [ ] 12.3 `main.ts` 事件接線：
  - obtain：pickup 迴圈記 `obtained: ItemId[]`（overflow < countBefore → push `d.item`）→ 迴圈後逐項 `applyAdvancement({type:'obtain', item, mode: currentMode})`；`craftingParams.onTake` 成功 → 同事件。
  - mob-killed：攻擊擊殺的 filter 命中時 → `applyAdvancement({type:'mob-killed', mode: currentMode})`。
  - phase：`bus.emit('time-changed')` 旁 → `applyAdvancement({type:'phase', phase})`。
- [ ] 12.4 `npx vitest run` → 全綠。
- [ ] 12.5（best-effort）瀏覽器：生存新局 → 敲原木 → 拾取 → toast 截圖；Save & Quit → Continue 後已解鎖不重彈。
- [ ] 12.6 commit：`feat(progress): advancement toasts`

**Expected test output:**
```
 ✓ src/ui/toast.test.ts (6 tests)
```

---

## Task 13: 死亡畫面死因

**Files:**
- Modify: `src/ui/death.ts` / `death.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- `death.ts`：
  - `export type DamageSource = 'fall'|'zombie'|'skeleton'|'starve'|'unknown'`
  - `export function deathMessageFor(source: DamageSource | null): string`（fall「你從高處摔落」、zombie「你被殭屍殺死了」、skeleton「你被骷髏射死了」、starve「你餓死了」、unknown「你死了」、null `''`）
  - `show(opts: { onRespawn: () => void; onQuit: () => void; cause?: string })`——`cause` 非空時在標題下渲染 `.death-cause` 行；重複 show 仍不疊層。
- Consumes: 既有 `stepMobs`/`stepArrows` 事件的 `mobId`（找不到 kind → unknown）
- Produces: main `let deathCause: DamageSource | null`；set 於：fall 傷害生效、mob 傷害（stepMobs→依 mobId 查 kind、stepArrows→'skeleton'）、`tickVitals` 後 `hunger<=0 && hp 下降` → 'starve'；`resetPlayerToSpawn`/startGame/continueGame 重置為 null；`setState('dead')` 傳 `cause: deathMessageFor(deathCause)`。

- [ ] 13.1 寫失敗測試：`deathMessageFor` 六例；`show` 帶 cause 渲染 `.death-cause` 文字、不帶則無該節點；hide 清理。
- [ ] 13.2 跑 → RED → 實作 death.ts → GREEN。
- [ ] 13.3 `main.ts` 接線（如上）。
- [ ] 13.4 `npx vitest run` → 全綠。
- [ ] 13.5 commit：`feat(death): cause-of-death line`

**Expected test output:**
```
 ✓ src/ui/death.test.ts (8 tests)
```

---

## Task 14: 最終驗證、文件與發布準備

**Files:**
- Modify: `.github/workflows/release.yml`、`README.md`、`package.json`、`game.json`
- Modify: 依驗證發現所需（fix batch）

**Interfaces:**
- Consumes: 全部前序 Task
- Produces: 可交付 0.2.0 成品；完整驗證證據；完成回報（AGENTS.md §6 格式）

- [ ] 14.1 全套：`npx vitest run`、`npx tsc --noEmit`、`npx eslint .`、`npx vite build` → 全綠；記錄最終測試數。
- [ ] 14.2 架構紅線 grep：`grep -rn "from 'three'" src/core src/world src/player` → 0；`grep -rn "document\.\|window\." src/core src/world` → 0；`src/player` 僅 `input.ts`（既有例外，其餘 0）。
- [ ] 14.3 瀏覽器走查（Playwright headless chromium；證據 `/tmp/opencode/wecraft-p3-shots/`；每個項目：截圖 + 就地探針 JSON）。固定環境：init script 設 `wecraft.settings`（seed 1337、dayLengthSec 60 供夜間項）：
  1. 天空漸層 + 太陽/月亮：白天/黃昏/夜晚三時段截圖（`dayLengthSec=60` 快轉）；
  2. 雲：飄移兩幀截圖差異、暫停選單開/關有效、F3；
  3. 陰影：白天近景（階梯/樹/怪物投影）截圖、開/關切換對照、FPS 記錄；
  4. AO：階梯角落與方塊堆近景截圖（角落變暗）、區塊縫無接縫；
  5. 裂紋：按住挖掘 → stage 0/4/9 截圖＋破壞瞬間粒子截圖；
  6. 手持模型：空手/方塊/工具三態 + 挖掘中揮動兩幀截圖；第三人稱與背包開啟時隱藏；
  7. 音效探針：載入後未點擊 → 無 AudioContext 建立；點擊後 → 1 個、state running；挖掘/放置/腳步各 >0 bufferSource；音量 slider 拖到 0.2 → master gain ≈0.2；背景分頁 suspend：以 CDP `Page.setWebLifecycleState('frozen')` 嘗試，若不可行 → 列「未自動驗證（單測覆蓋 handleVisibility）」；
  8. 進度 toast：新生存局敲木頭 → toast 截圖；Save & Quit → Continue → 不重彈、狀態保留；
  9. 死因：creative 飛到 y≈200 → 暫停切 survival → 落地死亡 → 「你從高處摔落」截圖；夜晚（60 s 日長）等怪致死 → 殭屍/骷髏文案（best-effort，做不到如實列未驗證）；
  10. 生物群系：以 node 腳本用 `biomeAt` 找 seed 1337 最近沙漠座標 → creative 飛行前往 → F3 `Biome:` 變化 + 霧色微變截圖（腳本飛行不可靠時列部分未驗證，單測已覆蓋映射）；
  11. 存檔遷移：init script 以 v1 fixture 寫入 IndexedDB `wecraft-save` → 標題可 Continue、世界/背包正常；
  12. iframe sandbox：`vite build` 後本機兩埠（成品 :4173、harness :8000）交叉來源 iframe（`sandbox="allow-scripts allow-same-origin allow-pointer-lock"`、`allow="fullscreen; autoplay; gamepad"`）→ 載入、canvas 有畫面、指標鎖定與鍵盤可用、進度保留；全程 console 無 error、無缺失資源請求；
  13. 完整流程 smoke：開局→敲→拾取→2×2→工作台→3×3 工具→放置→夜晚→Save & Quit→Continue 全還原。
- [ ] 14.4 效能：F3 @ 視距 10、陰影+雲+AO 全開，出生平原記 FPS/Triangles 截圖；目標平均 ≥55。未達 → fix batch（依序嘗試：shadow map 2048→1024、shadow 半徑 56→40、雲 density 0.30→0.22），每項重測後再定案；全數無效才改預設（記錄為 ruling）。
- [ ] 14.5 `game:pack` / `game:validate`：`/tmp` 隔離 checkout 平台 `main`（`git clone --depth 1 --branch main`、`npm ci`），對 `dist/` 打包並**完整驗證**通過（命令見 AGENTS.md；ZIP 於成品目錄外）。
- [ ] 14.6 更新 `.github/workflows/release.yml` 至最新範本語意：保留遊戲自身 `npm ci`/`npm test`/`typecheck`/`lint`/`build` 於版本檢查前；加 `RELEASE_PRERELEASE`（`m.version.includes('-')`）與 `--prerelease`；`GAME_DIR=dist`；不得 `continue-on-error`/`always()`。
- [ ] 14.7 `README.md` 更新（第三期特色：陰影/AO/雲/天空/音效/粒子/手持/進度/死因；測試數；版本）；`package.json` 與 `game.json` 版本 → `0.2.0`；重跑 build + pack/validate。
- [ ] 14.8 修正批次（如有發現）：每次 RED→GREEN + 全套綠，commit `chore: phase 3 verification fixes`；最後 commit `chore: bump version to 0.2.0 for phase 3`（含 README/workflow）。
- [ ] 14.9 完成回報（AGENTS.md §6）：ID `wecraft`、版本 `0.2.0`、成品 `dist/`（game.zip 驗證通過、**尚未發布**——未推 tag/未建 Release）、讀取規格時間、主要改動、相容性限制（v1→v2 存檔自動遷移、桌面限定）、已驗證/未執行清單——**明列「帳號雲端存檔（SDK）＝未執行（使用者決定移至第四期）」**；不得宣稱已上架。

**Expected test output:**
```
 Test Files  ... passed (all)
 TypeScript: 0 errors | ESLint: 0 problems | vite build: success
 game:validate: PASS
```

---

## Self-Review

**Spec 覆蓋（§4 第三期清單）：**
- 陰影 → Task 5 ✓
- 進階光照與 AO → Task 2（per-vertex AO；面方向亮度既有）✓
- 雲 → Task 7 ✓（§5 方形體積雲層）
- 音效精修 → Tasks 9–10（§6 全套：噪聲+濾波+ADSR、挖土低通/挖石帶通、放置悶音、腳步依地面、風聲/鳥叫/晝夜底噪、距離衰減、音量設定、背景靜音）✓
- 粒子 → Task 4（＋§4 挖掘手感之裂紋疊加層 → Task 3）✓
- 手持模型 → Task 8（§5 第一人稱右下角）✓
- 死亡/進度提示完善 → Tasks 11–13（MC 式進度系統+toast+存檔；死因）✓
- §5 第三期重點：霧色隨生物群系/時間（Task 6，時間既有）、天空漸層、太陽月亮方塊（Task 6）✓

**平台要求覆蓋（AGENTS.md v2）：** §1 規格重讀（T1.1、T14.3 前置）／手勢與背景靜音（T9–10、T14.3.7）／iframe sandbox 驗收（T14.3.12）／存檔相容（T11、T14.3.11）／pack/validate（T14.5）／workflow 最新範本（T14.6）／版本與 tag 規則（T14.7–14.9）／雲端存檔延後之誠實回報（T14.9）／完成回報格式（T14.9）。

**Placeholder 掃描：** 無 TBD/TODO；所有常數（AO 係數、陰影範圍、雲密度、音效表、進度表、toast 時長、死因文案）皆已拍板。

**型別一致性：** `getTextureArray`（T4→T8）、`MaterialGroup`/`SynthParams`（T9 內聚）、`AdvancementState`（T11→T12 與 save）、`DamageSource`（T13）、`Biome`（T6→hud/main）、`shadowFollow`（T5 內聚）名稱與簽章跨 Task 一致。

**Review Focus 對應：** 見文首 Review Focus 清單（音效政策→T9/T10/T14.3.7；效能→T14.4；存檔相容→T11/T14.3.11；shader patch→T3/T4/T8 jsdom 建構測試＋T14 截圖；AO 區塊縫→T2 跨區塊測試＋T14.3.4）。

**比例：** 各 Task 以簽章＋測試斷言＋拍板數值為主，實作主體留給執行者；14 個 Task 對應 7 大項＋平台收尾。

**已知限制：** 本 workspace 為 Linux、無系統 Chrome；瀏覽器驗證以 Playwright headless chromium 進行，音效「聽感」無法自動驗證（以節點/參數探針替代，並誠實標注）；無法完成的項目一律列「未驗證」，不以推測宣告通過。

