# B15 天氣與雷雨 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在既有的日夜、釣魚、農業、床與生物系統上加入「晴朗／下雨／雷雨」三態天氣：雨滴、雷電閃光、雨聲與雷聲，並讓天氣影響釣魚等待、耕地濕潤、不死系日照燃燒與雷雨睡眠。

**Architecture:** 新增純邏輯 `src/world/weather.ts`（三態狀態機、雷電排程、天色／霧色／亮度調整、查詢參數解析）與渲染 `src/render/weather.ts`（相機周圍的雨絲 `LineSegments`）。音訊在既有 `audio/voices.ts` 增加雨聲迴圈與雷聲，由 `audio/index.ts` 的 `setWeather`／`playThunder` 管理生命週期。`main.ts` 只做組裝：每幀推進天氣、套用天色與雨絲、切換音訊、把天氣餵給釣魚／農業／床／燃燒規則。**存檔格式不升版**；天氣是暫態（與引信 TNT／敵對生物同級），重開、繼續遊戲或雲端套用後回到晴朗。

**Tech Stack:** TypeScript 5.6、Vite 5、Vitest 2、Three.js 0.170、jsdom；固定 Playroom game tools 1.2.0。

**Spec:** `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`（Task 7 會加入 §B15）

## Global Constraints

- **本批版本 `0.18.0`**；`game.json`／`package.json` 一起 bump；`id` 維持 `wecraft`；tag 只會是 `v0.18.0`，但**本批未獲發布授權，不推 tag、不建 Release、不呼叫平台 API**。
- **存檔格式不升版**：本機 payload 維持 v6、雲端 `formatVersion` 4、`game.json` 的 `cloudSave` **一字不動**（`readableFormats [1,2,3,4]`、`writeFormat 4`）。天氣不進任何存檔欄位。
- 天氣三態：`clear`（晴朗）／`rain`（下雨）／`thunder`（雷雨）。晴天→下雨→（35% 雷雨／45% 放晴）→…；雷雨結束後回到下雨，再依規則轉晴。
- 時間常數：晴朗 **90–210 秒**、下雨 **45–120 秒**、雷雨 **20–60 秒**；雷雨首次閃電 **1–4 秒**、之後 **4–12 秒**；閃光 **0.18 秒**。
- 雨絲 **600 條**、相機半徑 **14 格**、局部高度 **−6..12 格**、下落速度 **18–26 格/秒**；只在玩家曝光於天空且不在水中時顯示（室內／洞穴／水下隱藏——明示簡化）。
- 釣魚：下雨或雷雨時等待時間 **×0.8**，最短 **4 秒**；晴天維持 5–30 秒。
- 農業：下雨或雷雨時，耕地視為**濕潤**（25% 成長率），不必有水源。
- 床：**雷雨時白天也能睡**；一般下雨的白天仍只能設定重生點。
- 不死系：**下雨或雷雨時不會被日光燒傷**（已在燃燒的會依既有 `burn` 倒數熄滅）。
- 不新增方塊、物品、配方、進度、材質表；不改 iframe／全螢幕／pointer lock／瀏覽器保留鍵行為；不改 SDK／protocol／Manifest schema。
- 驗收工具只用 `.playroom/game-tools.lock.json` 固定的 game tools 1.2.0、SHA-256 `24a2fd36b405ae9f1ce1303e53ac6b0a0d0a2798c04e796f5790a2663d46f022`；不得自行指定版本。
- **2026-11-07 已讀** Playroom `main` 模板與 §1 七份文件（game-development／command-contracts／game.schema.json／game-release.yml／SDK 1.1.0／sdk-versioning／save-compatibility）。本次適用重點：版本遞增與 tag 一致、ZIP 根目錄有 `game.json`、相對路徑與 `base:'./'`、跨來源 sandbox iframe 可玩、不跳頂層／不開 popup／不提交表單、不自行鎖定頂層鍵盤、音效由玩家手勢觸發、音訊不可用仍可玩、固定工具 pack＋validate、真實瀏覽器 smoke；本次沒有存取平台 API、沒有改 SDK／協定／Manifest schema／`cloudSave`。
- 回報必須區分：程式完成／ZIP 驗證／GitHub Release／平台上架；未做的列為未驗證。

## Review Focus

1. **天氣狀態機邊界**：`dt` 非有限／負值不得推進或產生 NaN；一次 `stepWeather` 最多轉換一次；鎖定模式（查詢參數）不得自行轉場；暫停／睡眠時天氣凍結。
2. **雨絲視覺的生命週期與曝光**：晴朗、暫停、背包、死亡、標題不得留下雨絲；室內／水下必須隱藏；`dispose()` 冪等且不洩漏 GPU 資源。
3. **音訊生命週期**：玩家手勢前 `setWeather` 不得建立 AudioContext；重複 `setWeather` 不得疊出第二層雨聲；離開遊戲／標題必須停止雨聲；靜音與分頁隱藏沿用既有 engine。
4. **天氣只影響約定規則**：晴天行為必須與 0.17.0 完全一致；雨天只改釣魚等待、耕地濕潤、日照燃燒；雷雨只再加「白天可睡」；不得誤傷放置、釣魚收線、農業右鍵或怪物 AI。
5. **存檔與 session 邊界**：天氣不進存檔／雲端；新局、繼續遊戲、雲端套用、回標題都要重設為晴朗（或查詢參數鎖定值），不得把上一局的天氣、雨聲或計時器帶進下一局。

---

### Task 1: 天氣純邏輯 `src/world/weather.ts`

**Files:**
- Create: `src/world/weather.ts`
- Create: `src/world/weather.test.ts`

**Interfaces:**
- Consumes: `DayNightColors`、`lerpColor`（`../core/daynight`）。
- Produces（後續任務只依賴這些簽名）：

```ts
export type WeatherMode = 'clear' | 'rain' | 'thunder';

export interface WeatherState {
  mode: WeatherMode;
  remaining: number;
  nextFlash: number;
  flashRemaining: number;
  locked: boolean;
}

export interface WeatherTick {
  state: WeatherState;
  changed: boolean;
  lightning: boolean;
  /** 0..1 的閃光強度（0 = 沒有閃光）。 */
  flash: number;
}

export const WEATHER_CLEAR_MIN_SEC = 90;
export const WEATHER_CLEAR_MAX_SEC = 210;
export const WEATHER_RAIN_MIN_SEC = 45;
export const WEATHER_RAIN_MAX_SEC = 120;
export const WEATHER_THUNDER_MIN_SEC = 20;
export const WEATHER_THUNDER_MAX_SEC = 60;
export const WEATHER_THUNDER_CHANCE = 0.35;
export const WEATHER_THUNDER_FIRST_FLASH_MIN_SEC = 1;
export const WEATHER_THUNDER_FIRST_FLASH_MAX_SEC = 4;
export const WEATHER_FLASH_MIN_SEC = 4;
export const WEATHER_FLASH_MAX_SEC = 12;
export const WEATHER_FLASH_SEC = 0.18;

export function createWeather(
  rng?: () => number,
  initialMode?: WeatherMode,
  locked?: boolean,
): WeatherState;
export function stepWeather(
  state: WeatherState,
  dtSec: number,
  rng?: () => number,
): WeatherTick;
export function weatherLabel(mode: WeatherMode): string;
export function weatherChangeText(mode: WeatherMode): string;
export function weatherLightScale(mode: WeatherMode, flash?: number): number;
export function applyWeatherTint(
  colors: DayNightColors,
  mode: WeatherMode,
  flash?: number,
): DayNightColors;
export function parseWeatherOverride(search: string): WeatherMode | null;
```

- 轉場規則：`clear → rain`；`rain → thunder`（rng < 0.35）或 `clear`；`thunder → rain`。
- 每個模式的 `remaining` 用 `[MIN, MAX]` 線性擲出；`rng` 非有限或超出範圍要夾到 `[0,1]`。
- `createWeather()` 預設 `clear`、`locked=false`、`nextFlash=0`、`flashRemaining=0`；`initialMode='thunder'` 時 `nextFlash` 擲 `[1,4]`。
- `stepWeather()`：`dt` 非有限或 ≤0 → 回傳複本、`changed=false`、`lightning=false`、`flash` 為目前 `flashRemaining/WEATHER_FLASH_SEC`。鎖定狀態只更新閃電，不扣 `remaining`、不轉場。未鎖定時 `remaining` 扣完轉場一次；進入雷雨時擲首次閃電延遲；雷雨期間 `nextFlash` 歸零的那一幀回報 `lightning=true`、`flash=1`，並重擲下一次閃電；離開雷雨清除 `nextFlash`／`flashRemaining`。
- `weatherLabel`：`晴朗`／`下雨`／`雷雨`；`weatherChangeText`：`放晴了`／`開始下雨了`／`雷雨來了`。
- 天色：雨天往 `0x5f6b7a`（天空）／`0x3c4653`（天頂）混合 55%，雷雨 72%；`fog` 跟天空同色；`ambient` 乘 0.85／0.72，`sunIntensity` 乘 0.55／0.35；`flash` 再往白色混合並提高亮度（上限 1.2）。晴天原值不變。
- `weatherLightScale`：`clear 1`／`rain 0.82`／`thunder 0.68`，`flash` 最多加到 1.2。
- `parseWeatherOverride('?weather=rain')` 回 `'rain'`；接受 `?x=1&weather=thunder`；其他值／空字串回 `null`；只接受小寫三態。

- [x] **Step 1: 寫失敗測試**

`src/world/weather.test.ts` 至少涵蓋：
- 所有常數值（90/210、45/120、20/60、0.35、1/4、4/12、0.18）。
- `createWeather` 預設值、rng 邊界與 NaN、鎖定狀態。
- 晴朗倒數 → 下雨（`changed=true`）、下雨 rng 0.1 → 雷雨、下雨 rng 0.9 → 晴朗、雷雨 → 下雨。
- 雷雨鎖定狀態：首次閃電在 1 秒後觸發、`flash=1`、後續 0.1 秒後 `flash≈0.444`、再過 0.18 秒歸零。
- `dt=NaN`／`-1` 不推進；`remaining` 不會變負。
- `weatherLabel`／`weatherChangeText` 文案。
- `weatherLightScale` 與 `applyWeatherTint`：晴天不變、雨天變暗、雷雨更暗、閃光變亮、輸入不被修改。
- `parseWeatherOverride` 的四種情況。

- [x] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/world/weather.test.ts`
Expected: FAIL（找不到 `./weather`）。

- [x] **Step 3: 實作 `src/world/weather.ts`**

只做純資料與純函式；不 import Three／DOM／世界。註解明示：天氣是暫態、不進存檔；雨絲遮蔽與雷聲延遲是簡化。

- [x] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/world/weather.test.ts`
Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add src/world/weather.ts src/world/weather.test.ts
git commit -m "feat(b15): weather state machine and overcast tint"
```

---

### Task 2: 雨絲渲染 `src/render/weather.ts`

**Files:**
- Create: `src/render/weather.ts`
- Create: `src/render/weather.test.ts`

**Interfaces:**
- Consumes: `WeatherMode`（`../world/weather`）。
- Produces：

```ts
export interface WeatherView {
  mode: WeatherMode;
  /** 玩家有没有曝光在天空下（室内／水下由 main 算好）。 */
  visible: boolean;
}

export interface WeatherRenderer {
  sync(view: WeatherView, camera: THREE.Camera, dtSec: number): void;
  dispose(): void;
}

export const RAIN_DROP_COUNT = 600;
export const RAIN_RADIUS = 14;
export const RAIN_TOP = 12;
export const RAIN_BOTTOM = -6;
export const RAIN_MIN_SPEED = 18;
export const RAIN_MAX_SPEED = 26;
export const RAIN_LENGTH = 0.7;

export function createWeatherRenderer(scene: THREE.Scene): WeatherRenderer;
```

- 建立一個 `THREE.LineSegments`（名稱 `weather-rain`），頂點數 `RAIN_DROP_COUNT × 2`，材質 `LineBasicMaterial`（顏色 `0xaecbe8`、透明、`fog:false`、`depthWrite:false`），`frustumCulled=false`。
- 每個雨滴有區域座標 `x/z ∈ [−14,14]`、`y ∈ [−6,12]`、速度 18–26、長度 0.7；每幀 `y -= speed*dt`，低於 `RAIN_BOTTOM` 時加 `RAIN_TOP − RAIN_BOTTOM` 回到上方（可重新擲 x/z）。
- 群組位置每幀設為相機 `x/y/z`（雨絲跟著玩家，不累積世界座標）。
- `visible === false || mode === 'clear'` → 群組隱藏；下雨不透明度 0.5、雷雨 0.65。`dt` 非有限或負值視為 0。
- `dispose()` 移除群組、釋放 geometry 與 material，可重複呼叫。

- [x] **Step 1: 寫失敗測試**

`src/render/weather.test.ts`（jsdom，Three 純物件）：
- 建立後場景有 `weather-rain`，頂點數 1200。
- `clear` → 隱藏；`rain`＋visible → 顯示、opacity 0.5；`thunder` → 0.65；`visible=false` → 隱藏。
- `sync` 後群組位置等於相機位置；`dt=1` 後第一條雨絲的 y 減少（且 x/z 不變）。
- 把雨滴推到 `RAIN_BOTTOM` 以下會回到上方（y 增加）。
- `dt=NaN` 不變；`dispose()` 移除且冪等。

- [x] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/render/weather.test.ts`
Expected: FAIL（找不到 `./weather`）。

- [x] **Step 3: 實作 `src/render/weather.ts`**

用一個 `Float32Array`／`Float32BufferAttribute`，每幀只更新 y 與 position buffer；不要每幀重建 geometry。

- [x] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/render/weather.test.ts`
Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add src/render/weather.ts src/render/weather.test.ts
git commit -m "feat(b15): camera-following rain renderer"
```

---

### Task 3: 雨聲與雷聲

**Files:**
- Modify: `src/audio/voices.ts`
- Modify: `src/audio/index.ts`
- Modify: `src/audio/voices.test.ts`
- Modify: `src/audio/index.test.ts`

**Interfaces:**
- `voices.ts` 新增：

```ts
export function startRain(
  ctx: BaseAudioContext,
  dest: AudioNode,
  noise: AudioBuffer,
): { stop(): void };
export function thunderBoom(
  ctx: BaseAudioContext,
  dest: AudioNode,
  noise: AudioBuffer,
  volume?: number,
): void;
```

- 雨聲：白噪音 → 低通 3000 Hz → gain 0.055，`source.loop = true`；`stop()` 停 source、斷開節點、可重複呼叫。
- 雷聲：白噪音 → 低通 180 Hz → gain 包絡（0 → 0.7 → 0，約 1.2 秒），加一個 60→30 Hz 正弦（gain 0.35，約 1.2 秒）；`volume` 已含距離衰減，預設 1。
- `audio/index.ts` 的 `GameAudio` 新增：

```ts
setWeather(weather: 'clear' | 'rain' | 'thunder'): void;
playThunder(opts?: PlayOptions): void;
```

- `setWeather` 冪等：晴天停雨聲、雨／雷雨啟動雨聲；**engine 尚未 started 時只記住目標、不建 context**；`ensureStarted()` 之後補啟動；`startAmbience()` 也同步一次；`stopAmbience()` 一併停雨聲；`dispose()` 全部停止。
- `playThunder` 走既有 `gainForDistance`，距離 40 時 gain 0，engine 未啟動時 inert。

- [x] **Step 1: 寫失敗測試**

`voices.test.ts`：
- `startRain` 建立 1 個 loop buffer source、低通 3000、gain 0.055，連到 dest；`stop()` 只停一次。
- `thunderBoom` 建立低通 180、gain 包絡與 60→30 Hz oscillator，source 約 1.2 秒停止。

`index.test.ts`：
- 還沒 `ensureStarted` 時 `setWeather('rain')` 不建立任何節點；之後 `ensureStarted` 自動啟動雨聲。
- 重複 `setWeather('rain')` 不疊第二層；`setWeather('clear')` 停掉；`stopAmbience` 也會停。
- `playThunder` 接 master、遠距離 gain 0、未啟動時 inert。
- 既有的「before start: play and startAmbience are no-ops」不得被破壞。

- [x] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/audio/voices.test.ts src/audio/index.test.ts`
Expected: FAIL（找不到新匯出／方法）。

- [x] **Step 3: 實作 voices + facade**

沿用 `startWind` 的節點接法與 `playExplosion` 的距離衰減慣例；不要在 facade 內直接 new AudioContext。

- [x] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/audio/voices.test.ts src/audio/index.test.ts`
Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add src/audio/voices.ts src/audio/index.ts src/audio/voices.test.ts src/audio/index.test.ts
git commit -m "feat(b15): rain loop and thunder audio"
```

---

### Task 4: 天氣玩法鉤子（釣魚／農業／床／燃燒）

**Files:**
- Modify: `src/world/fishing.ts` / `src/world/fishing.test.ts`
- Modify: `src/world/farming.ts` / `src/world/farming.test.ts`
- Modify: `src/world/bed.ts` / `src/world/bed.test.ts`
- Modify: `src/world/mobs.ts` / `src/world/mobs.test.ts`

**Interfaces:**
- `fishing.ts`：

```ts
export const FISHING_RAIN_WAIT_MULTIPLIER = 0.8;
export const FISHING_RAIN_WAIT_MIN_SEC = 4;
export function rollFishingWait(rng?: () => number, raining?: boolean): number;
```

- `farming.ts` 的 `WheatGrowthOptions` 新增 `raining?: boolean`；`growWheatBatch` 的 `wet = opts.raining === true || wasFarmlandHydrated(...)`。
- `bed.ts` 的 `bedUse` context 新增 `thunder?: boolean`；`internalSkyLight > 11 && thunder !== true` 才回 `set-spawn-only`。
- `mobs.ts` 的 `SunBurnCtx` 新增 `isRaining: boolean`；`exposed = isDaylight && !isRaining && !roofed && !inWater`。
- 既有呼叫端不用的參數維持 optional 或由測試 helper 補預設；晴天行為必須與 0.17.0 相同。

- [x] **Step 1: 寫失敗測試**
- `fishing.test.ts`：晴天的 5／17.5／30 不變；雨天 rng 0 → 4、0.5 → 14、1 → 24；NaN rng 雨天 → 4。
- `farming.test.ts`：乾燥且 `raining:true`、rng 0.2 → 成長（濕潤 25%）；`raining:false` 同條件 → 不成長；水源濕潤仍照舊。
- `bed.test.ts`：白天 `thunder:true` → `'sleep'`（無怪物）；白天 `thunder:false` → `'set-spawn-only'`；雷雨有怪物 → `'monsters'`；距離規則不變。
- `mobs.test.ts`：白天 `isRaining:true` → `burn=0`、hp 不減；晴天照燒；已在燃燒的 mob 進雨天後 `burn` 遞減、不再扣血。

- [x] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/world/fishing.test.ts src/world/farming.test.ts src/world/bed.test.ts src/world/mobs.test.ts`
Expected: FAIL（新參數尚未生效）。

- [x] **Step 3: 實作四個純邏輯鉤子**

不改任何既有預設路徑；雨天／雷雨都由呼叫端明確傳入。註解與 JSDoc 更新，說明這是 B15 的天氣效果。

- [x] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/world/fishing.test.ts src/world/farming.test.ts src/world/bed.test.ts src/world/mobs.test.ts`
Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add src/world/fishing.ts src/world/fishing.test.ts src/world/farming.ts src/world/farming.test.ts src/world/bed.ts src/world/bed.test.ts src/world/mobs.ts src/world/mobs.test.ts
git commit -m "feat(b15): weather effects on fishing, farming, beds and sun burn"
```

---

### Task 5: F3 天氣列

**Files:**
- Modify: `src/ui/hud.ts`
- Modify: `src/ui/ui.test.ts`

**Interfaces:**
- `DebugLinesParams` 新增 `weather: string`；`formatDebugLines` 在 `Biome` 之後、`Triangles` 之前插入 `Weather: <weather>`。
- 既有行的字串內容不變（只多一列）；測試更新 `base` 與完整陣列斷言。

- [x] **Step 1: 寫失敗測試**

在 `src/ui/ui.test.ts` 的 `formatDebugLines` 測試補：`Weather: rain` 位於 `Biome: plains` 之後、`Triangles: 42` 之前；完整陣列包含新列。

- [x] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/ui/ui.test.ts`
Expected: FAIL（`weather` 缺欄位／少一列）。

- [x] **Step 3: 實作 HUD 新列**

`formatDebugLines` 的 JSDoc 更新；不要改既有列的格式。

- [x] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/ui/ui.test.ts`
Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add src/ui/hud.ts src/ui/ui.test.ts
git commit -m "feat(b15): show weather in the F3 overlay"
```

---

### Task 6: `main.ts` 天氣接線

**Files:**
- Modify: `src/main.ts`
- Modify: `src/main.wiring.test.ts`

**Interfaces:**
- 模組層級：

```ts
const weatherOverride = parseWeatherOverride(window.location.search);
const weatherRenderer = createWeatherRenderer(gs.scene);
let weather: WeatherState = createWeather(Math.random, weatherOverride ?? 'clear', weatherOverride !== null);
let weatherMode: WeatherMode = weather.mode;
let weatherFlash = 0;
```

- `resetWeather()`：以 `weatherOverride` 重建 `weather`、更新 `weatherMode`／`weatherFlash`，呼叫 `audio.setWeather(weatherMode)`；由 `startGame`、`continueGame`、`applyCloudData` 呼叫。
- 每幀（playing 分支、時鐘 tick 之後、天色之前）：

```ts
const weatherTick = stepWeather(weather, dt);
weather = weatherTick.state;
weatherMode = weather.mode;
weatherFlash = weatherTick.flash;
if (weatherTick.changed) {
  audio.setWeather(weatherMode);
  hudHint.show(weatherChangeText(weatherMode));
}
if (weatherTick.lightning) audio.playThunder({ volume: 0.9 });
```

- 天色：先 `skyColors(clock.t)`，再做既有 `applyBiomeTint`，最後 `applyWeatherTint(..., weatherMode, weatherFlash)`；`sunDir` 不變。
- 地形天空比例：`chunkRenderer.setSkyScale(skyLightScale(clock.t) * weatherLightScale(weatherMode, weatherFlash))`（全檔唯一呼叫點）。
- 農業：`growWheatBatch({ ..., raining: weatherMode !== 'clear' })`。
- 燃燒：`sunCtx` 加 `isRaining: weatherMode !== 'clear'`。
- 床：`bedUse({ ..., thunder: weatherMode === 'thunder' })`；`set-spawn-only` 提示改成「你只能在夜晚或雷雨時睡覺（重生點已設定）」。
- 釣魚：`beginFishing(rollFishingWait(Math.random, weatherMode !== 'clear'))`。
- 渲染尾段：

```ts
const camLight = spawnLightAt(world, Math.floor(cam.x), Math.floor(cam.y), Math.floor(cam.z), clock.t);
const camInWater = world.getBlock(Math.floor(cam.x), Math.floor(cam.y), Math.floor(cam.z)) === BLOCK.WATER;
const exposed = camLight.lit && camLight.sky >= 8 && !camInWater;
weatherRenderer.sync(
  { mode: weatherMode, visible: state === 'playing' && exposed },
  gs.camera,
  state === 'playing' ? dt : 0,
);
```

- `formatDebugLines` 傳 `weather: weatherMode`。
- `window.__wecraft` 新增唯讀 getter：`weather: () => weatherMode`、`weatherRemaining: () => weather.remaining`、`weatherFlash: () => weatherFlash`。
- `quitToTitle` 停止雨聲（`audio.stopAmbience()` 已含）；`startGame`／`continueGame`／`applyCloudData` 在音訊啟動後呼叫 `resetWeather()`。
- 查詢參數 `?weather=clear|rain|thunder` 只用於驗收／展示；正常遊玩不帶參數。鎖定模式不自動轉場，但仍會打雷閃電。
- 不新增 `audio.play(` 呼叫點（雷聲走 `playThunder`）；不新增第二個 `setSkyScale(` 呼叫點。

- [x] **Step 1: 寫失敗的接線測試**

在 `src/main.wiring.test.ts` 補：
- `countOf('stepWeather(') === 1`，且位於 playing 分支。
- `weatherRenderer.sync(` 全檔 1 次；`weatherRenderer` 建立 1 次。
- `sunCtx` 含 `isRaining: weatherMode !== 'clear'`。
- `growWheatBatch` 的呼叫含 `raining: weatherMode !== 'clear'`。
- `bedUse` 的呼叫含 `thunder: weatherMode === 'thunder'`。
- `rollFishingWait(Math.random, weatherMode !== 'clear')`。
- `chunkRenderer.setSkyScale(skyLightScale(clock.t) * weatherLightScale(` 仍是唯一 `setSkyScale(`。
- `applyWeatherTint(` 在 playing 分支、且 `weatherMode` 是來源。
- `resetWeather()` 在 `startGame`／`continueGame`／`applyCloudData` 各被呼叫一次。
- `__wecraft` 的 `weather`／`weatherRemaining`／`weatherFlash` getter。
- `audio.setWeather(` 與 `audio.playThunder(` 有接線。

- [x] **Step 2: 跑接線測試確認失敗**

Run: `npx vitest run src/main.wiring.test.ts`
Expected: FAIL（新符號不存在）。

- [x] **Step 3: 實作 main 接線**

保持既有註解風格；所有規則本體留在純模組，main 只做狀態與呼叫。

- [x] **Step 4: 跑接線測試與全套**

Run: `npx vitest run src/main.wiring.test.ts`
Expected: PASS。

Run: `npm run typecheck`
Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add src/main.ts src/main.wiring.test.ts
git commit -m "feat(b15): weather wiring for sky, rain, audio and gameplay"
```

---

### Task 7: 版本、README、規格與發布說明

**Files:**
- Modify: `package.json`
- Modify: `game.json`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`
- Create: `docs/releases/v0.18.0.md`
- Modify: this plan（勾選與執行結果）

**Interfaces:**
- Produces: `version: "0.18.0"`；`game.json.instructions` 補一句天氣提示；`cloudSave` **不動**；`devices` 仍 `["desktop"]`。
- README：版本 0.17.0 → 0.18.0；簡介加天氣；〈遊戲特色〉新增天氣段；〈與原版的差異〉新增 0.18.0 簡化段；〈操作〉不新增按鍵（天氣自動）；〈專案狀態〉新增 B15；計畫連結。
- 規格：新增 `### B15 天氣與雷雨（版本 0.18.0）`，列規則、簡化與存檔政策；更新 §5／§6／§7。
- 發布說明：新增／修正／存檔相容性／已知問題／驗證，驗證數字先 `TODO`，Task 8 填實際值。

- [x] **Step 1: 改版本與 manifest**

`package.json`、`game.json` → `0.18.0`；`game.json.instructions` 末尾加「天氣會在晴朗／下雨／雷雨之間變化，雷雨時白天也能睡覺；下雨會讓釣魚等待變短、耕地保持濕潤。」（確保 ≤2,000 字元）。

- [x] **Step 2: 寫 README／spec／release notes**

明示簡化：
- 雨絲只跟相機、不逐格遮蔽；玩家在室內／洞穴／水下時整片隱藏（不會從窗戶看到外面的雨）。
- 雷電只有閃光與雷聲，**不會打中生物、不會起火、不會破壞方塊**；沒有降雨粒子濺射、沒有積水、沒有雪。
- 雷聲與閃光同時播放（沒有原版的距離延遲）。
- 天氣是暫態、不跨存檔；重開／繼續／雲端套用後回到晴朗。
- 雨聲是程序合成的近似音；沒有天氣預報 UI。
- 下雨／雷雨對釣魚、農業、燃燒、床的效果是明示的簡化規則。

- [x] **Step 3: 更新計畫文件**

把所有 Task 的 `[ ]` 改成 `[x]`，並在 Task 8 後補執行結果。

- [x] **Step 4: Commit**

```bash
git add package.json game.json README.md docs/superpowers/specs/2026-10-18-wecraft-parity-design.md docs/releases/v0.18.0.md docs/superpowers/plans/2026-11-07-wecraft-b15-weather.md
git commit -m "docs(b15): 0.18.0 version, README, spec and release notes"
```

---

### Task 8: 完整驗證與真實瀏覽器 smoke

**Files:**
- Modify: `README.md`、`docs/releases/v0.18.0.md`、this plan（填入實際數字）
- No production code changes unless a gate fails.

- [ ] **Step 1: 全套門檻**

```bash
npm run typecheck
npm test -- --reporter=dot
npm run lint
npm run build
npm run test:perf
```

Expected：全綠；記下 test files／tests 數、build 產物與大小、perf 數字。

- [ ] **Step 2: 固定工具 pack＋validate**

```bash
rm -rf /tmp/opencode/wecraft-b15-tools && mkdir -p /tmp/opencode/wecraft-b15-tools
python3 -m zipfile -e .playroom/tools/playroom-game-tools-1.2.0.zip /tmp/opencode/wecraft-b15-tools
cd /tmp/opencode/wecraft-b15-tools
node pack-game.mjs /home/tommy/WeCraft/dist /tmp/opencode/wecraft-b15-game.zip
node validate-game.mjs /tmp/opencode/wecraft-b15-game.zip
```

Expected：`Packed wecraft v0.18.0`／`Valid: wecraft v0.18.0 (tools 1.2.0)`；記下 ZIP bytes 與 SHA-256，並確認 lock 的 SHA-256 與 ZIP 檔相符。

- [ ] **Step 3: 真實瀏覽器 smoke（靜態伺服 `dist/`、playwright-core、`xvfb-run` 有頭 Chromium）**

探針腳本放 `/tmp/opencode`，不進 repo。至少：
- 一般載入：title、canvas、單人遊戲、熱鍵欄、0 console/page error。
- `?weather=rain`：`__wecraft.weather() === 'rain'`、canvas 有雨絲（截圖或像素差異）、F3 顯示 `Weather: rain`。
- `?weather=thunder`：`weather==='thunder'`；等待至少一次 `weatherFlash()>0` 或截圖差異；F3 顯示 `Weather: thunder`。
- `?weather=clear`：`weather==='clear'`、無雨絲。
- 暫停／回標題後雨絲隱藏、雨聲停止（聽覺不可自動驗證時列為未驗證；以音訊節點／狀態測試為證據）。
- 室內隱藏雨絲：若導航成本過高，列為未驗證，不宣稱通過。

- [ ] **Step 4: 把實際數字填回 README／release notes／本計畫**

- README 的 tests/files、build 產物、perf、ZIP 數字。
- `docs/releases/v0.18.0.md` 的驗證段與未驗證清單。
- 本計畫的 Task 8 執行結果。

- [ ] **Step 5: Commit**

```bash
git add README.md docs/releases/v0.18.0.md docs/superpowers/plans/2026-11-07-wecraft-b15-weather.md
git commit -m "docs(b15): record weather verification evidence"
```

**不要**推 tag、不要建 Release、不要呼叫平台 API（本批未獲發布授權）。

---

## Self-Review

**1. Spec coverage:** 天氣三態、雨絲、雷電、音效、釣魚、農業、床、燃燒、F3、session 邊界都有對應 Task。天氣不進存檔符合 Global Constraints。

**2. Step scan:** 每個 Task 都有「寫失敗測試 → 跑失敗 → 實作 → 跑通過 → commit」；Task 6 的 main 接線另有結構釘子；Task 8 有完整 gate 與瀏覽器 smoke。

**3. Type consistency:** `WeatherMode`／`WeatherState`／`WeatherTick`／`WeatherRenderer`／`WeatherView` 在 Task 1–6 一致；`setWeather` 使用 audio 層自己的三態字面量（結構上與 `WeatherMode` 相容）；`isRaining`、`thunder`、`raining` 參數名稱在純模組與 main 接線一致。

**4. Review Focus:** 五條風險分別由 Task 1（狀態機邊界）、Task 2（雨絲生命週期）、Task 3（音訊生命週期）、Task 4（規則只影響約定路徑）、Task 6（session 重設與接線）覆蓋；Task 8 另有真實瀏覽器 smoke。

**5. Proportion:** 本計畫是決策與介面，不是逐行抄程式；常數、測試斷言與呼叫點已釘死，實作細節留給執行者。

## 執行結果（Task 1–7）

- **Task 1** `47f9ef4`：`src/world/weather.ts` ＋ 18 個測試（狀態機／轉場／閃光／天色／
  查詢參數）。
- **Task 2** `ff30b6d`：`src/render/weather.ts` ＋ 7 個測試（雨絲幾何與生命週期）。
- **Task 3** `f44ddee`：`src/audio/voices.ts` ＋ `src/audio/index.ts`（`setWeather`／
  `playThunder`）＋ 測試。
- **Task 4** `e45c423`：四個玩法鉤子（釣魚等待／耕地濕潤／雷雨睡覺／雨天不曬傷）
  ＋ 測試；**`SunBurnCtx.isRaining` 為必填欄位** → main.ts 先補佔位
  `isRaining: false`（Task 6 換成真實天氣）。
- **Task 5** `958269b`：F3 多一行 `Weather:`（`Biome:` 與 `Triangles:` 之間）。
- **Task 6** `333a47e`：main 接線（狀態機每幀一次、天色與地形亮度、音效、遊戲鉤子、
  session 重設、`__wecraft` 的三個 getter）；**天色套用兩次** `applyWeatherTint`
  （天穹吃原始天色、霧／背景吃群系色）→ 晴天與 0.17.0 一致。
- **Task 7**：版本 0.18.0（`package.json`／`game.json`，`cloudSave` 一字未動）、
  README／規格／`docs/releases/v0.18.0.md`（驗證數字待 Task 8 填）。
- **Task 8**：完整門檻、pinned pack＋validate、批末瀏覽器 smoke → 見下方 Task 8
  的執行結果（由 Task 8 補入）。
