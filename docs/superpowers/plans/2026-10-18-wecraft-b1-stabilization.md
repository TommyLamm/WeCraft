# WeCraft B1 止血修復（0.4.0）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修掉第一批止血 bug——飢餓 exhaustion 模型、生存背包外洩、模式切換破壞狀態、新遊戲覆蓋存檔無警告、受擊無敵幀、挖掘公式／工具等級／掉落表——並發布 0.4.0。

**Architecture:** 純邏輯（survival／blocks／interact／drops／save／cloud-save／mode-stash）放 `src/core`、`src/player`、`src/world`，以單元測試釘死；`src/main.ts` 是未測的組裝根，只做接線。存檔採「本機逐版遷移＋雲端附加欄位」：B1 本機 payload 升 v3（雙模式狀態），雲端維持 format 1 只加 `stash` 欄位。

**Tech Stack:** TypeScript strict、Three.js、Vite、Vitest（jsdom 用於 UI）、IndexedDB（fake-indexeddb 測）、GitHub Actions release workflow。

**Spec:** `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`（§B1 為本批範圍；B2–B9 各自另寫計畫）

## Global Constraints

（出自 spec §1、§2、§4 與 AGENTS.md；每個任務的需求都隱含本節。）

- 每個任務結束：`npm run typecheck`、`npm test`、`npm run build` 全綠；測試要「改得有理」，禁止為綠燈弱化。
- 版本：本批發布 `0.4.0`；`game.json` 與 `package.json` 同步；tag 為 `v0.4.0` 且指向含 bump 的 commit；不覆寫已發布版本。
- 雲端：B1 維持 `formatVersion = 1`、只加附加欄位；`game.json` 的 `cloudSave` 不動（`readableFormats:[1], writeFormat:1`）。
- 本機存檔：payload 升 v3；v1／v2 必可照讀遷移；未知欄位不視為錯誤。
- 原版基準：Minecraft Java Edition 1.20+；數值以本計畫內文為準（已查證 wiki，來源見 spec §2／本計畫各任務）。
- 平台紀律：發布（tag＋GitHub Release）已預先授權，但每批必須附明確中文更新內容；`id` 不變；`Esc`／iframe／pointer lock 行為不得改變（本批不動這些）。
- 發布候選跑固定工具：`.playroom/tools/playroom-game-tools-1.1.0.zip`（先驗 `sha256`）＋ `pack-game.mjs`＋`validate-game.mjs`（Task 10）。
- 註解誠實化：本批改動到的「Minecraft parity」宣稱要同步校正（Task 1、5、6、10 各自處理自己碰到的）。

## Review Focus

（spec 沒明說、但最可能咬人的輸入類別；每一條都已在對應任務放測試。）

1. **舊存檔／舊雲端缺欄位**（缺 `exhaustion`、缺 `stash`）：載入不得崩、不得吞進度 → Task 1（`normalizeVitals`）、Task 3（v1/v2→v3 遷移）、Task 4（無 stash 的舊雲端 payload 走 legacy 推導）。
2. **同一總消耗在不同 fps 下結果一致**：分批套用（60fps）與一次套用（低 fps）最終數值必須相同 → Task 1（chunked vs stepwise 等值測試）。
3. **生存↔創造多次往返**：兩份背包與生存數值互不污染、跨存檔重開仍原樣 → Task 2（純函式 round-trip／no-alias）、Task 3／4（payload 往返）；main 接線以人工步驟確認。
4. **工具邊界**：徒手／錯工具挖石類 → ×5 且不掉落；木鎬挖鐵礦 → ×5 且不掉落；基岩永不可破 → Task 5（表驅動時間＋`canHarvest`）、Task 6（不掉落）。
5. **新遊戲入口**：有存檔（本機或雲端）必須二次確認；無存檔維持一鍵；取消不留痕 → Task 8（confirm 元件測試＋main 接線人工步驟）。

---

## 檔案結構

| 檔案 | 動作 | 職責 |
|---|---|---|
| `src/player/survival.ts` | 修改 | `Vitals.exhaustion`、exhaust 累積模型、回復／星饑、`normalizeVitals`、消耗常數表 |
| `src/core/mode-stash.ts` | 新增 | 兩模式背包＋生存數值的純狀態容器（建立／存入／取出／正規化） |
| `src/core/items.ts` | 修改 | `raw_iron` 物品、`sanitizeStack`／`sanitizeSlots` |
| `src/core/cloud-save.ts` | 修改 | vitals 正規化改用它處、附加 `stash` 欄位 |
| `src/world/save.ts` | 修改 | 本機 payload v3＋v1/v2 遷移 |
| `src/world/blocks.ts` | 修改 | 硬度表對齊＋`requiredTool`／`fastTool` 資料 |
| `src/player/interact.ts` | 修改 | 破壞公式、工具等級、掉落門檻 |
| `src/world/drops.ts` | 修改 | 掉落表修正 |
| `src/world/furnace.ts` | 修改 | `raw_iron → iron_ingot` |
| `src/core/advancements.ts` | 修改 | `raw_iron` 觸發 `iron_age` |
| `src/ui/icons.ts` | 修改 | `raw_iron` 圖示 |
| `src/ui/inventory.ts` | 修改 | E 面板依模式分流 |
| `src/ui/menus.ts` | 修改 | `showConfirm` |
| `src/player/invuln.ts` | 新增 | 受擊無敵幀純邏輯 |
| `src/ui/hurt.ts` | 新增 | 紅色受擊回饋 DOM |
| `src/main.ts` | 修改 | 全部接線（未測的組裝根） |
| `README.md`、`docs/releases/v0.4.0.md`、`.github/workflows/release.yml`、`package.json`、`game.json` | 修改／新增 | Task 10 發布 |

---

### Task 1: 飢餓 exhaustion 模型與自然回復重寫

**Files:**
- Modify: `src/player/survival.ts`
- Modify: `src/core/cloud-save.ts:89-124`（私有 `normalizeVitals` 與 `VITALS_ACC_MAX_SEC` 移到 survival.ts）
- Modify: `src/world/save.ts`（`loadGame` 遷移時正規化 `player.vitals`）
- Modify: `src/main.ts:22-23, 401-404, 1769-1773, 1890-1907`
- Test: `src/player/survival.test.ts`、`src/core/cloud-save.test.ts`、`src/world/save.test.ts`

**Interfaces:**
- Consumes: 無（本批第一個任務）。
- Produces（後續任務依賴）：
  - `Vitals` 新增 `exhaustion: number`（0–40）。
  - `exhaust(v: Vitals, amount: number): Vitals` — 累積到 `> 4` 才扣點（原版）。
  - `tickVitals(v: Vitals, dtSec: number): Vitals` — 新回復模型。
  - `normalizeVitals(raw: unknown): Vitals` — 由 `src/player/survival.ts` 匯出（cloud-save 改 import）。
  - 常數：`EXHAUST_SPRINT_PER_METER = 0.1`、`EXHAUST_JUMP = 0.05`、`EXHAUST_SPRINT_JUMP = 0.2`、`EXHAUST_ATTACK = 0.1`、`EXHAUST_HURT = 0.1`、`EXHAUST_BREAK_BLOCK = 0.005`、`EXHAUST_PER_HP_REGEN = 6`。

**已查證數值（wiki，1.20+）**：疾跑 0.1／m、跳躍 0.05、疾跑跳 0.2、攻擊命中 0.1、受傷（護甲可減免來源）0.1、破壞方塊 0.005、每次回血 6.0；exhaustion 累積 > 4 時扣 1 飽食（sat 0 時扣 1 飢餓），餘額保留；回復：飽食度 > 0 且飢餓滿 20 → 每 0.5 秒回 1 HP（快速）；否則（飢餓 ≥ 18 或飽食度 ≠ 0）→ 每 4 秒回 1 HP（慢速）；血滿或（飢餓 ≤ 17 且 sat 0）停止；星饑：飢餓 = 0 且 sat = 0 → 每 4 秒 −1 HP（維持現行）。

- [ ] **Step 1: 改寫 `survival.ts` 的測試（`src/player/survival.test.ts`）**

改動既有釘死非原版行為的測試並新增（測試名與斷言如下；既有 starvation／dt 防護測試只補 `exhaustion: 0` 欄位）：
- `createVitals` 測試：`toEqual({ hp:20, maxHp:20, hunger:20, maxHunger:20, saturation:5, regenAcc:0, starveAcc:0, exhaustion:0 })`。
- 刪除「overflow past saturation drains hunger (ceiling of the remainder)」；新 `exhaust` 測試：
  - `'accumulates below the 4-point threshold without draining'`：`exhaust(at({exhaustion:0,hunger:20,saturation:5}), 4.0)` → `exhaustion 4.0`、`saturation 5`、`hunger 20`。
  - `'drains one saturation per completed 4 exhaustion, keeping the remainder'`：`exhaust(..., 4.1)` → `exhaustion 0.1`、`saturation 4`。
  - `'falls through to hunger when saturation is empty'`：`at({exhaustion:3,saturation:0,hunger:20})` + 1.5 → `exhaustion 0.5`、`hunger 19`。
  - `'never drains more than one point per 4 exhaustion (no ceil-style overdraw)'`：`at({saturation:0.5,hunger:20})` + 6 → `saturation 0`、`exhaustion 2`、`hunger 20`（舊模型會扣掉 5 點飢餓）。
  - `'chunked and step-wise application of the same total are identical'`：同一總量 10.0 以「一次 10」與「100 × 0.1」套用 → 以 `toBeCloseTo(x, 5)` 逐欄比較（浮點殘差；`toEqual` 會誤報）。
  - `'caps accumulation at 40 before draining'`：`at({exhaustion:39, saturation:0, hunger:20})` + 10 → cap 40 起算、每 4 扣 1（共 9 次）→ `{ exhaustion: 4, saturation: 0, hunger: 11 }`（未 cap 會是 49 → 12 次、hunger 8）。
- `tickVitals` 測試更新：
  - `'does not regenerate below hunger 18 and resets the accumulator'` → 改為 `'saturation alone sustains slow regeneration below hunger 18'`：`{hunger:17, saturation:3}` 每 4 秒回血；`{hunger:17, saturation:0}` 不回血且 `regenAcc 0`。
  - 新 `'fast regeneration at full hunger halves the tick (1 hp per 0.5 s)'`：`{hunger:20, saturation:5, hp:10, exhaustion:0}` 加 1.0 秒 → 恰好 2 次回血：`hp 12`、`saturation 3`、`exhaustion 4`。（每 HP +6 exhaustion 的確定性短期結果；長期平均 1.5 飽食/HP 是漸進行為，不要在此斷言。）
  - 新 `'regeneration stops when hunger drops below 18 with no saturation left'`：從 `{hunger:19, saturation:1}` 長 dt 迴圈 → 停止於 `hunger < 18 且 saturation 0`，hp 不超過上限。
  - 既有「1 hp per 4 s」「huge dt 多輪」「mutually exclusive」「dt 0/負/NaN」測試：僅補 `exhaustion: 0` 與必要欄位，斷言維持（若因新模型位移則按新公式修正並在 commit 訊息說明；注意「`{hunger:17}` → `regenAcc 0`」案例的 fixture 要把 saturation 設為 0，否則新規則「saturation ≠ 0 可慢速回復」會讓它失效）。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/player/survival.test.ts`
Expected: FAIL（`exhaustion` 不存在、新公式未實作）。

- [ ] **Step 3: 實作 `survival.ts`**

- `Vitals` 加 `exhaustion`；`createVitals()` 加 `exhaustion: 0`。
- 常數（匯出）：上列 7 個 `EXHAUST_*`；私有 `const EXHAUSTION_MAX = 40; const EXHAUSTION_DRAIN = 4; const TICK_INTERVAL_SEC = 4; const FAST_TICK_INTERVAL_SEC = 0.5; const VITALS_ACC_MAX_SEC = 4;`
- `exhaust(v, amount)`：
  ```
  if (!finite || amount <= 0) return { ...v };
  let exhaustion = Math.min(EXHAUSTION_MAX, v.exhaustion + amount);
  let saturation = v.saturation; let hunger = v.hunger;
  while (exhaustion > EXHAUSTION_DRAIN) {
    exhaustion -= EXHAUSTION_DRAIN;
    if (saturation > 0) saturation = Math.max(0, saturation - 1);
    else hunger = Math.max(0, hunger - 1);
  }
  return { ...v, exhaustion, saturation, hunger };
  ```
- `tickVitals(v, dtSec)`：保留「dt 非有限／≤0 → 0，仍跑 reset」；回復段改為：可回復 = `hp > 0 && hp < maxHp && (hunger >= 18 || saturation > 0)`；`regenAcc += dtSec` 後迴圈（每次重算間隔）：`interval = (hunger >= v.maxHunger && saturation > 0) ? 0.5 : 4`；`while (regenAcc >= interval && hp < maxHp && (hunger >= 18 || saturation > 0))` 內：`regenAcc -= interval; hp += 1;` 然後 `const after = exhaust({ ...v, hp, exhaustion, saturation, hunger }, EXHAUST_PER_HP_REGEN);` 用 `after` 更新運行變數；血滿 → `regenAcc = 0`。星饑段維持原邏輯但改用更新後的 `hunger`／`saturation` 判斷（回復把 sat 扣到 0 且 hunger 0 時，同幀可無縫接星饑累積）。
- 新增 `export function normalizeVitals(raw: unknown): Vitals`：把 `cloud-save.ts:104-124` 的邏輯原樣搬來（`isFiniteNum` 本地 helper、`maxHp`／`maxHunger` in-range 否則 20、其餘 clamp），再加 `exhaustion: clamp(raw.exhaustion, 0, EXHAUSTION_MAX, 0)`。
- 更新檔案頂端 doc 註解（累積模型、來源表、回復公式）。

- [ ] **Step 4: 跑 survival 測試轉綠**

Run: `npx vitest run src/player/survival.test.ts`
Expected: PASS。

- [ ] **Step 5: cloud-save／save 改用共享 `normalizeVitals`**

- `cloud-save.ts`：刪除私有 `normalizeVitals` 與 `VITALS_ACC_MAX_SEC`，改 `import { normalizeVitals } from '../player/survival';`；`acceptCloudData` 呼叫不變。
- `save.ts` `loadGame`：v1 → v2 組完後，回傳前把 `player.vitals` 過 `normalizeVitals`（null 保持 null）：`player: { ...payload.player, vitals: payload.player.vitals === null ? null : normalizeVitals(payload.player.vitals) }`。
- 測試更新：`cloud-save.test.ts` 兩處 vitals `toEqual` 期望加入 `exhaustion: 0`；`save.test.ts` 的 payload fixture（`toEqual({...payload, savedAt})` 系列）補上 `exhaustion: 0`（fixture 為完整 Vitals 的地方），新增 `'loadGame defaults a v2 vitals record missing exhaustion to 0'`。

- [ ] **Step 6: main.ts 接線**

- 移除 `SPRINT_EXHAUST_PER_SEC`／`JUMP_EXHAUST`（L401-404），改 import 常數。
- L1778 附近加 `const preStepX = player.position.x; const preStepZ = player.position.z;`（與 `preStepY` 同區）。
- 把 L1894-1897 兩段（sprint 消耗、jump 消耗）改為（L1892 `hpBeforeTick`、L1893 `moving` 定義保留不動）：
  ```
  if (input.state.sprint && moving && !player.flying && !player.inWater) {
    const moved = Math.hypot(player.position.x - preStepX, player.position.z - preStepZ);
    v = exhaust(v, moved * EXHAUST_SPRINT_PER_METER);
  }
  if (jumpStarted) v = exhaust(v, input.state.sprint && moving ? EXHAUST_SPRINT_JUMP : EXHAUST_JUMP);
  ```
- 更新 L1769-1771 註解（0.15 → 0.05／疾跑跳 0.2）。

- [ ] **Step 7: 全量驗證＋人工快跑**

Run: `npm run typecheck && npm test && npm run build`
Expected: 全綠。
人工（記錄結果）：`npm run dev` → 生存疾跑 30 秒，飢餓不應秒清空（約每 40 公尺才掉 1 點飽食／飢餓）；跳躍與攻擊命中各觀察一次掉點節奏（標記為人工驗證）。

- [ ] **Step 8: Commit**

```bash
git add src/player/survival.ts src/player/survival.test.ts src/core/cloud-save.ts src/core/cloud-save.test.ts src/world/save.ts src/world/save.test.ts src/main.ts
git commit -m "fix(hunger): B1.1 對齊原版 exhaustion／回復模型，修 ceil 秒清空"
```

---

### Task 2: 模式雙狀態（記憶體）

**Files:**
- Create: `src/core/mode-stash.ts`
- Test: `src/core/mode-stash.test.ts`
- Modify: `src/main.ts:180 附近, 595-619, 1408-1440`

**Interfaces:**
- Consumes: Task 1 的 `Vitals`、`createVitals`；`items.ts` 的 `starterSlots`、`ItemStack`。
- Produces:
  - `interface ModeStash { survival: Array<ItemStack | null>; creative: Array<ItemStack | null>; survivalVitals: Vitals }`
  - `createModeStash(): ModeStash`（生存＝9 空、創造＝9 滿、vitals＝`createVitals()`）
  - `saveModeState(stash, mode: GameMode, slots: ReadonlyArray<ItemStack|null>, vitals: Vitals | null): ModeStash`（新物件；slot 深拷貝；生存且 vitals 非 null 時更新 `survivalVitals`）
  - `loadModeSlots(stash, mode): Array<ItemStack|null>`（每次回傳新拷貝）

- [ ] **Step 1: 寫 `mode-stash.test.ts`（失敗）**

- `'createModeStash starts survival empty, creative full and fresh vitals'`
- `'saveModeState copies slots deep — later live mutations never leak'`（存後改原陣列／stack，stash 不變）
- `'saveModeState stores survival vitals only on survival'`（在創造存時不動 `survivalVitals`）
- `'loadModeSlots returns fresh copies'`（改回傳值不影響 stash）
- `'round-trip: survival A/V → creative B → back yields A and V'`

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/mode-stash.test.ts` → FAIL（模組不存在）。

- [ ] **Step 3: 實作 `src/core/mode-stash.ts`**（介面如上；`GameMode` 型別 import 自 `./inventory`）

- [ ] **Step 4: 測試轉綠** — Run: `npx vitest run src/core/mode-stash.test.ts` → PASS。

- [ ] **Step 5: main.ts 接線**

- L180 後：`let modeStash = createModeStash();`
- 模式切換 handler（L600-619）重寫：開頭 `modeStash = saveModeState(modeStash, currentMode, [...hotbar], vitals);` → 設定 `currentMode`／`settings`／`inventory.setMode`（照舊）→ 兩分支皆改為：`loadModeSlots(modeStash, mode).forEach((s, i) => inventory.setSlot(i, s)); hud.setHotbar(hotbar, selected);` 創造 `setVitals(null)`；生存 `setVitals(modeStash.survivalVitals)`（取代 `createVitals()`）。刪除舊註解中「round-trip resets HP（intentional）」段落，改寫為「兩模式各自保留」。
- `startGame()`（L1408-1440）：`resetWorld()` 後加 `modeStash = createModeStash();`；L1420-1423 的 starter 填槽改為 `loadModeSlots(modeStash, currentMode)`；L1424 改為 `setVitals(currentMode === 'survival' ? modeStash.survivalVitals : null)`。
- `continueGame()` 本任務不動（stash 由 Task 3 的 payload 還原；開機預設 stash 已足夠：任何切換前會先 `saveModeState`）。

- [ ] **Step 6: 全量驗證**

Run: `npm run typecheck && npm test && npm run build` → 全綠。
人工（記錄結果）：生存放幾個物品、切創造（背包應為創造配置）、切回生存（原物品與血量原樣）；重複兩輪。

- [ ] **Step 7: Commit**

```bash
git add src/core/mode-stash.ts src/core/mode-stash.test.ts src/main.ts
git commit -m "feat(mode): B1.3 兩模式各自保留背包與生存數值"
```

---

### Task 3: 本機存檔 v3（雙模式狀態持久化）

**Files:**
- Modify: `src/core/items.ts`（加 `sanitizeStack`／`sanitizeSlots`）
- Modify: `src/core/mode-stash.ts`（加 `normalizeModeStash`）
- Modify: `src/world/save.ts`
- Modify: `src/main.ts:942-958(不動),1013-1038,1466-1522`
- Test: `src/core/items.test.ts`、`src/core/mode-stash.test.ts`、`src/world/save.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `ModeStash`；Task 1 的 `normalizeVitals`。
- Produces:
  - `sanitizeStack(x: unknown): ItemStack | null`、`sanitizeSlots(x: unknown, count: number): Array<ItemStack|null>`（未知 id／非有限 count／≤0 → null；不 throw）
  - `export type StashPayload = { survival: Array<ItemStack|null>; creative: Array<ItemStack|null>; survivalVitals: Vitals }`（`mode-stash.ts` 匯出；vitals 非 null）
  - `normalizeModeStash(raw: unknown, legacy: { mode: GameMode; inventory: unknown; vitals: unknown }): ModeStash`
  - `save.ts`：`SavePayloadV3 = { version: 3; …; stash: StashPayload }`；`collectSavePayload` 的 `SaveSources` 加 `stash: ModeStash`；`loadGame()` 對 v1/v2/v3 都回 v3 形狀。

- [ ] **Step 1: 測試（失敗）**

`items.test.ts`：
- `'sanitizeStack accepts real ids with positive finite counts, rejects junk'`（`{stone,64}` ok；`{nope,1}`、`{stone,0}`、`{stone,NaN}`、`null` → null）
- `'sanitizeSlots pads and truncates to the requested count'`

`mode-stash.test.ts`：
- `'normalizeModeStash derives the legacy side from a v2 record'`（mode survival：survival＝舊 inventory（過 sanitize）、creative＝滿、vitals＝正規化舊值；mode creative 反之，`survivalVitals` 為全滿）
- `'normalizeModeStash sanitizes corrupt slots instead of throwing'`
- `'normalizeModeStash prefers a present stash over legacy fields'`

`save.test.ts`：
- 既有 fixture 全部升 v3（加 `stash`）；`'migrates a raw v1 record to v3 with derived stash and empty advancements'`、`'migrates a raw v2 record to v3, deriving stash from the recorded mode'`
- `'rejects a record with an unsupported version'` 改用 `{version:4}`
- `'collectSavePayload deep-copies the stash (no aliasing)'`
- `'round-trips stash through IndexedDB'`

- [ ] **Step 2: 跑測試確認失敗** — `npx vitest run src/core/items.test.ts src/core/mode-stash.test.ts src/world/save.test.ts` → FAIL。

- [ ] **Step 3: 實作**

- `items.ts`：`sanitizeStack`（`ITEM_IDS` 檢查 id；count 有限且 > 0）；`sanitizeSlots(x, count)`（非陣列 → 全 null；逐格 `sanitizeStack`）。
- `mode-stash.ts`：`StashPayload`；`normalizeModeStash`：
  - `raw` 為物件且有 `survival`／`creative`：兩側 `sanitizeSlots(_, 9)`，缺一側補 `starterSlots(mode)`；`survivalVitals = normalizeVitals(raw.survivalVitals)`。
  - 否則走 legacy：`[legacy.mode]` ← `sanitizeSlots(legacy.inventory, 9)`，另一側給 `starterSlots`；`survivalVitals = legacy.mode === 'survival' ? normalizeVitals(legacy.vitals) : normalizeVitals(undefined)`。
- `save.ts`：型別加 `SavePayloadV3`／`SavePayload = SavePayloadV3`（保留 V1/V2 供遷移）；`isValidSavePayload` 收 `version 1|2|3`（其餘結構檢查照舊，`stash` 交由遷移正規化，比照 `advancements` 的既有模式）；`collectSavePayload` 加 `stash` 參數並深拷貝；`loadGame` 遷移鏈：v1→v2（既有）→ 一律組 `stash: normalizeModeStash((value as 部分).stash, { mode, inventory, vitals })`、`version: 3`。
- `main.ts`：
  - `sessionSavePayload()`（L1026-1037）加 `stash: modeStash`。
  - `continueGame()`：slot 還原（L1488-1491）改用 `sanitizeSlots(payload.player.inventory, hotbar.length)`；L1509 前加 `modeStash = normalizeModeStash(payload.stash, { mode: payload.player.mode, inventory: payload.player.inventory, vitals: payload.player.vitals });`

- [ ] **Step 4: 測試轉綠** — 同 Step 2 指令 → PASS。

- [ ] **Step 5: 全量驗證＋人工**

Run: `npm run typecheck && npm test && npm run build` → 全綠。
人工（記錄結果）：生存放物品＋扣血 → 切創造放別的 → Save & Quit → 重開 Continue → 生存側物品／血量與創造側配置都原樣；再切換一次確認不互相污染。

- [ ] **Step 6: Commit**

```bash
git add src/core/items.ts src/core/items.test.ts src/core/mode-stash.ts src/core/mode-stash.test.ts src/world/save.ts src/world/save.test.ts src/main.ts
git commit -m "feat(save): B1.3 本機 payload v3，持久化兩模式背包與生存數值"
```

---

### Task 4: 雲端附加欄位 `stash`

**Files:**
- Modify: `src/core/cloud-save.ts`
- Modify: `src/main.ts:1063-1124, 1132-1157`
- Test: `src/core/cloud-save.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `StashPayload`／`normalizeModeStash`、Task 2 的 `ModeStash`。
- Produces: `CloudData.stash?: StashPayload`（舊 payload 沒有）；`acceptCloudData` 之後 `stash` 永遠存在且已正規化。

- [ ] **Step 1: 測試（失敗）**

- `'buildCloudData deep-copies the stash'`
- `'validateCloudData accepts payloads without stash (format 1 forwards-compat) and rejects a non-object stash'`
- `'acceptCloudData derives stash from legacy fields when absent'`（settings.mode survival → survival 側＝inventory）
- `'acceptCloudData normalizes a present stash instead of legacy fields'`
- 既有測試不動（`stash?` 為 optional，舊 fixture 仍通過）。

- [ ] **Step 2: 確認失敗** — `npx vitest run src/core/cloud-save.test.ts` → FAIL。

- [ ] **Step 3: 實作**

- `cloud-save.ts`：`CloudData.stash?: StashPayload`；`CloudBuildSource.stash: ModeStash`；`buildCloudData` 逐格拷貝 `stash`（比照 inventory 寫法）；`validateCloudData`：`if (r.stash !== undefined && (typeof r.stash !== 'object' || r.stash === null)) return false;`；`acceptCloudData`：`stash: normalizeModeStash(x.stash, { mode: clamped.mode, inventory: x.inventory, vitals: x.vitals })`。
- `main.ts`：`saveCloudNow` 的 `buildCloudData` 參數（L1137-1146）加 `stash: modeStash`；`applyCloudData`：L1094-1109 的逐格驗證迴圈改用 `sanitizeSlots(data.inventory, hotbar.length)`（行為等價：非法 id 掉成 null、`setSlot` 負責 floor／clamp），並在 `setVitals(...)` 後加 `modeStash = normalizeModeStash(data.stash, { mode: data.settings.mode, inventory: data.inventory, vitals: data.vitals });`。連帶移除只剩該迴圈使用的 `KNOWN_ITEMS` 常數（L532）與其不再需要的 import；`npm run lint` 必須維持乾淨。

- [ ] **Step 4: 測試轉綠** — 同 Step 2 → PASS。

- [ ] **Step 5: 全量驗證** — `npm run typecheck && npm test && npm run build` → 全綠。

- [ ] **Step 6: Commit**

```bash
git add src/core/cloud-save.ts src/core/cloud-save.test.ts src/main.ts
git commit -m "feat(cloud): B1.3 雲端附加 stash 欄位（維持 format 1）"
```

---

### Task 5: 破壞公式與工具等級

**Files:**
- Modify: `src/world/blocks.ts`（硬度表＋`requiredTool`／`fastTool`）
- Modify: `src/player/interact.ts`
- Modify: `src/main.ts:2038-2052`
- Test: `src/world/blocks.test.ts`、`src/player/interact.test.ts`

**Interfaces:**
- Consumes: 無（與 Task 1-4 平行；Task 6 依賴本任務的 `canHarvest`）。
- Produces:
  - `blocks.ts`：`export type ToolKind = 'pickaxe' | 'axe' | 'shovel';`；`BlockDef` 加 `requiredTool: { kind: ToolKind; level: number } | null` 與 `fastTool: ToolKind | null`。
  - `interact.ts`：`getBreakTime(blockId: number, held: ItemStack | null): number`（回傳含速度的真實秒數）、`canHarvest(blockId: number, held: ItemStack | null): boolean`、`toolSpeed(blockId: number, held: ItemStack | null): number`、`DigProgress.update(blockId, hit, dt, breakTimeSec)`（吃真實秒數，不得再乘速度）、`DigProgress.isDone(blockId, breakTimeSec)`、`digStep(mode, dig, blockId, hit, dt, held: ItemStack | null): boolean`。

**已查證數值（wiki，1.20+）**：時間＝`硬度 ×（可收穫 ? 1.5 : 5）÷ 工具速度`；速度：木 2／石 4／鐵 6（金 12／鑽 8 留 B5）；收穫等級：石頭／鵝卵石／煤礦＝木鎬以上（level 0）、鐵礦＝石鎬以上（level 1）。

- [ ] **Step 1: 更新／新增測試（失敗）**

`blocks.test.ts`：硬度逐一改為——stone 1.5、dirt 0.5、grass 0.6、sand 0.5、oak_log 2.0、oak_leaves 0.2、oak_planks 2.0、cobblestone 2.0、snow 0.2、glass 0.3、coal_ore 3.0、iron_ore 3.0、crafting_table 2.5、furnace 3.5、bedrock/water `Infinity`；新 `'requiredTool／fastTool data matches vanilla'`。

`interact.test.ts`（重寫破壞相關段）：
- `getBreakTime` 表驅動（精確秒數）：`stone` 徒手 7.5／木鎬 1.125／鐵鎬 0.375；`iron_ore` 木鎬 7.5（不可收穫）／石鎬 1.125；`dirt` 徒手 0.75；`oak_log` 徒手 3.0／木斧 1.5；`glass` 徒手 0.45；`bedrock`／`water` `Infinity`。
- `canHarvest`：stone 徒手 false／木鎬 true；iron_ore 木鎬 false／石鎬 true；dirt 徒手 true；log 徒手 true。
- `toolSpeed`：鎬對石類＝2/4/6；斧對原木＝2/4/6；鎬對原木＝1；斧對石＝1；徒手＝1。
- `DigProgress`：改傳 `breakTimeSec`（例：stone＋木鎬 time 1.125）；`isDone` 用同 time；既有「bedrock 卡 0」「換目標重置」測試改新簽名保留。
- `digStep`：creative 即破；survival 依真實秒數累積（`dt` 直接對 `breakTimeSec` 累進；速度僅透過 `getBreakTime` 生效一次）；bedrock／water false。

- [ ] **Step 2: 確認失敗** — `npx vitest run src/world/blocks.test.ts src/player/interact.test.ts` → FAIL。

- [ ] **Step 3: 實作**

- `blocks.ts`：`ToolKind`；`BlockDef` 兩欄位；`DEFS` 逐格填硬度＋`requiredTool`（STONE／COBBLE／COAL_ORE／FURNACE `{pickaxe,0}`、IRON_ORE `{pickaxe,1}`、其餘 null）＋`fastTool`（石類與 FURNACE `pickaxe`；DIRT／GRASS／SAND／SNOW `shovel`；LOG／PLANKS／CRAFTING_TABLE `axe`；其餘 null）。
- `interact.ts`：
  - `const TOOL_INFO: Readonly<Record<string, { kind: ToolKind; level: number; speed: number }>>`：`wooden_* {2, 0}`、`stone_* {4, 1}`、`iron_* {6, 2}`（pickaxe／axe 各三階；劍不入表）。
  - `canHarvest`：`requiredTool === null → true`；否則 `TOOL_INFO[held?.item]?.kind === req.kind && info.level >= req.level`。
  - `toolSpeed`：不可破 → 1；`const wanted = def.requiredTool?.kind ?? def.fastTool; const info = held ? TOOL_INFO[held.item] : null; return info && wanted && info.kind === wanted ? info.speed : 1;`
  - `getBreakTime`：`const h = def.hardness; if (!Number.isFinite(h)) return Infinity; return h * (canHarvest(...) ? 1.5 : 5) / toolSpeed(...);`
  - `DigProgress`／`digStep` 依新簽名；`digStep` 內部算 `time`（速度僅透過 `getBreakTime` 生效一次；`if (!Number.isFinite(time)) return false;`）。
  - 刪除舊 `PICKAXES`／`AXES`／`SWORDS`／`IRON_TOOLS`／`requiredTool` 表；更新「Minecraft parity」註解。
- `main.ts`：dig 區塊（L2038-2052）改 `const held = hotbar[selected];`、`digTarget` 判定用 `getBreakTime(id, held)`、移除外部 `toolSpeed` 呼叫、`digStep(currentMode, dig, id, hit, dt, held)`。

- [ ] **Step 4: 測試轉綠** — 同 Step 2 → PASS。

- [ ] **Step 5: 全量驗證** — `npm run typecheck && npm test && npm run build` → 全綠（注意：Task 6 前的 `spawnBlockDrop` 仍是舊簽名，暫時不受影響）。

- [ ] **Step 6: Commit**

```bash
git add src/world/blocks.ts src/world/blocks.test.ts src/player/interact.ts src/player/interact.test.ts src/main.ts
git commit -m "fix(mining): B1.6 破壞公式 ×1.5/×5 與鎬等級門檻"
```

---

### Task 6: 掉落表、`raw_iron`、挖掘消耗

**Files:**
- Modify: `src/world/drops.ts`
- Modify: `src/core/items.ts`、`src/ui/icons.ts`、`src/world/furnace.ts`、`src/core/advancements.ts`
- Modify: `src/player/interact.ts`（`spawnBlockDrop` 加 `held`）
- Modify: `src/main.ts:2048-2052`（挖掘消耗）
- Test: `src/world/drops.test.ts`、`src/core/items.test.ts`、`src/world/furnace.test.ts`、`src/core/advancements.test.ts`、`src/player/interact.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `canHarvest`；Task 1 的 `EXHAUST_BREAK_BLOCK`、`exhaust`。
- Produces: `spawnBlockDrop(drops, mode, blockId, pos, held: ItemStack | null): DropEntity[]`；`ItemId` 增 `'raw_iron'`。

- [ ] **Step 1: 測試（失敗）**

- `drops.test.ts`：`dropItemFor(GRASS) → 'dirt'`、`LEAVES／GLASS／SNOW → null`、`IRON_ORE → 'raw_iron'`、`COAL_ORE → 'coal'`、`STONE → 'cobblestone'` 維持。
- `interact.test.ts` `spawnBlockDrop`：徒手挖石 → 同 ref（不掉）；木鎬挖石 → 追加 `cobblestone`；木鎬挖鐵礦 → 同 ref；石鎬挖鐵礦 → `raw_iron`；創造 → 同 ref；dirt 徒手 → `dirt`（可收穫）。
- `items.test.ts`：`ALL_ITEM_IDS.length === 32`；`blockFromItem('raw_iron') === null`；`maxStack('raw_iron') === 64`。
- `furnace.test.ts`：`SMELT_RECIPES` `toEqual({ iron_ore: 'iron_ingot', raw_iron: 'iron_ingot', sand: 'glass' })`（保留 `iron_ore` 供舊存檔）+ `'smelts raw_iron into an iron ingot'`。
- `advancements.test.ts`：`'obtaining raw_iron unlocks iron_age'`（既有 iron_ore 案例保留）。

- [ ] **Step 2: 確認失敗** — `npx vitest run src/world/drops.test.ts src/player/interact.test.ts src/core/items.test.ts src/world/furnace.test.ts src/core/advancements.test.ts` → FAIL。

- [ ] **Step 3: 實作**

- `items.ts`：union 加 `'raw_iron'`；`ITEM_IDS.raw_iron = true`。
- `icons.ts`：`drawItemArt` switch 在 `default:` 前加 `case 'raw_iron'`：三個不規則金色團塊（例：`#d8b28e` 圓半徑 5／4、`#c4915f` 半徑 4 疊右下），比照既有 `line`／`ctx.arc` 畫法。
- `drops.ts`：`dropItemFor` 依上表；需要時 import `BLOCK`。
- `furnace.ts`：`SMELT_RECIPES` 加 `raw_iron: 'iron_ingot'`。
- `advancements.ts`：`OBTAIN_UNLOCKS` 加 `raw_iron: 'iron_age'`。
- `interact.ts`：`spawnBlockDrop` 加 `held`，`creative` 後、`dropItemFor` 前加 `if (!canHarvest(blockId, held)) return drops;`。
- `main.ts`：挖掘完成分支（L2045-2052）在 `spawnBlockDrop(..., hotbar[selected])` 後加 `if (vitals) setVitals(exhaust(vitals, EXHAUST_BREAK_BLOCK));`。

- [ ] **Step 4: 測試轉綠** — 同 Step 2 → PASS。

- [ ] **Step 5: 全量驗證＋人工** — `npm run typecheck && npm test && npm run build` → 全綠。
人工（記錄結果）：生存徒手挖石頭（慢且無掉落）、做木鎬挖煤（會掉）、挖鐵礦（不掉）→ 石鎬挖鐵礦掉生鐵 → 熔爐燒生鐵；快捷欄圖示可辨識。

- [ ] **Step 6: Commit**

```bash
git add src/world/drops.ts src/world/drops.test.ts src/core/items.ts src/core/items.test.ts src/ui/icons.ts src/world/furnace.ts src/world/furnace.test.ts src/core/advancements.ts src/core/advancements.test.ts src/player/interact.ts src/player/interact.test.ts src/main.ts
git commit -m "fix(drops): B1.6 掉落表對齊與生鐵物品（熔煉／進度／挖掘消耗）"
```

---

### Task 7: E 面板模式分流

**Files:**
- Modify: `src/ui/inventory.ts`
- Modify: `src/main.ts:942-958`
- Test: `src/ui/ui.test.ts`

**Interfaces:**
- Consumes: `GameMode`（`src/core/inventory.ts`）。
- Produces: `InventoryUi.open(hotbar, selected, onPick, onClose?, crafting?, mode: GameMode = 'creative')`。

- [ ] **Step 1: 測試（失敗）**（`ui.test.ts`）

- `'survival panel shows owned slots and cannot pick free blocks'`：以 `hotbar=[{stone,3},null,…8 slots]`、`mode 'survival'` 開啟 → `.ui-inv-grid .ui-slot` 長度 9；第一格含 canvas、空格不含；點第一格 → `onPick` 不被呼叫；標題文字含「背包」。
- `'creative panel keeps the palette and pick behavior (default mode)'`：既有「inventory pick」測試保留（`PLACEABLE.length`、`onPick(selected, full stack)`）。
- `'survival panel closes cleanly with no click handlers left behind'`：close 後 DOM 清空。

- [ ] **Step 2: 確認失敗** — `npx vitest run src/ui/ui.test.ts` → FAIL。

- [ ] **Step 3: 實作**

- `inventory.ts`：`open` 尾端加 `mode`（預設 `'creative'`）；`mode === 'survival'` 時：標題 `背包`、`for (const stack of hotbar)` 逐格渲染 `.ui-slot`（有 stack 時 `title = stackName`、`appendChild(itemIcon)`；不加 click）；非 survival 走現行 `PLACEABLE` 分支。`h3` 文案與 `selected` 捕捉邏輯不變。
- `main.ts`：`inv.open(...)` 呼叫尾端追加 `currentMode`。

- [ ] **Step 4: 測試轉綠** — 同 Step 2 → PASS。

- [ ] **Step 5: 全量驗證＋人工** — `npm run typecheck && npm test && npm run build` → 全綠。
人工（記錄結果）：生存按 E → 只看到自己的物品＋2×2；創造按 E → 完整清單可拿方塊。

- [ ] **Step 6: Commit**

```bash
git add src/ui/inventory.ts src/ui/ui.test.ts src/main.ts
git commit -m "fix(ui): B1.2 生存 E 面板不再外洩免費方塊"
```

---

### Task 8: 新遊戲覆蓋警告

**Files:**
- Modify: `src/ui/menus.ts`
- Modify: `src/main.ts:840-846`
- Test: `src/ui/ui.test.ts`

**Interfaces:**
- Consumes: `titleEntry`（`src/core/boot-entry.ts`，已存在）。
- Produces: `menus.showConfirm({ message: string; onConfirm: () => void; onCancel: () => void }): void`（單次觸發；Esc＝取消；任何觸發後自行卸載）。

- [ ] **Step 1: 測試（失敗）**（`ui.test.ts`）

- `'confirm dialog renders the message and both buttons'`（`div.ui-overlay` 內含文字與「確定」「取消」兩個 `.ui-btn`）
- `'confirm fires onConfirm exactly once and unmounts'`（連點兩次仍 1 次）
- `'cancel fires onCancel exactly once and unmounts'`
- `'Escape cancels exactly once and removes the listener after'`（之後再按 Esc 無作用）

- [ ] **Step 2: 確認失敗** — `npx vitest run src/ui/ui.test.ts` → FAIL。

- [ ] **Step 3: 實作**

- `menus.ts`：新增 `showConfirm`（比照 `settingsPanel` 結構：`div.ui-overlay interactive`＋`div.ui-settings` 面板＋訊息＋兩顆 `ui-btn`）；`clear()` 先跑；Esc 走既有 `escHandler` 機制；以 `let fired = false` 保證單次：觸發時 `fired = true; clear(); cb();`。
- `main.ts` 標題分支（L840-846）：`const hasSaveEntry = titleEntry({ hasLocalSave: savedPayload !== null, cloudApplied: cloudAppliedAtBoot }) !== 'none';`；`hasSave: hasSaveEntry`；`onNewGame: () => { if (hasSaveEntry) menus.showConfirm({ message: '將覆蓋現有進度。確定要開始新遊戲嗎？', onConfirm: startGame, onCancel: () => setState('title') }); else startGame(); }`。

- [ ] **Step 4: 測試轉綠** — 同 Step 2 → PASS。

- [ ] **Step 5: 全量驗證＋人工** — `npm run typecheck && npm test && npm run build` → 全綠。
人工（記錄結果）：無存檔 → 一鍵開始；有本機或雲端存檔 → 跳確認，取消回到標題（存檔仍在），確定才開新局。

- [ ] **Step 6: Commit**

```bash
git add src/ui/menus.ts src/ui/ui.test.ts src/main.ts
git commit -m "feat(ui): B1.4 新遊戲覆蓋存檔二次確認"
```

---

### Task 9: 受擊無敵幀、受擊回饋、戰鬥消耗

**Files:**
- Create: `src/player/invuln.ts`、`src/ui/hurt.ts`
- Modify: `src/ui/ui.css`、`src/main.ts:698-711, 1988-2028, 920-930 附近`
- Test: `src/player/invuln.test.ts`、`src/ui/hurt.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `EXHAUST_ATTACK`／`EXHAUST_HURT`、`exhaust`。
- Produces:
  - `invuln.ts`：`HURT_INVULN_SEC = 0.5`；`interface Invuln { untilSec: number }`；`createInvuln(): Invuln`；`canBeHurt(inv: Invuln, nowSec: number): boolean`；`markHurt(inv: Invuln, nowSec: number): Invuln`。
  - `hurt.ts`：`createHurtFlash(uiRoot: HTMLElement): { flash(): void }`（單一 DOM，300ms 後自動移除）。

- [ ] **Step 1: 測試（失敗）**

`invuln.test.ts`：`'new invuln allows the first hit'`；`'blocks hits inside the 0.5 s window and allows again at exactly 0.5 s'`；`'markHurt restarts the window'`；`'non-finite now never throws and compares as blocked/allowed sensibly'`。
`hurt.test.ts`（jsdom + fake timers）：`'flash mounts exactly one .hurt-flash overlay'`（連閃兩次仍 1 個）；`'overlay auto-removes after 300 ms'`；`'flash after removal re-mounts'`。

- [ ] **Step 2: 確認失敗** — `npx vitest run src/player/invuln.test.ts src/ui/hurt.test.ts` → FAIL。

- [ ] **Step 3: 實作**

- `invuln.ts`：純函式如上（`markHurt` 回 `{ untilSec: nowSec + HURT_INVULN_SEC }`）。
- `hurt.ts`：`let el: HTMLDivElement | null = null; let timer: number | undefined;` `flash()`：無 el 則建 `div.hurt-flash`（**不加** `interactive`，確保不吃點擊）append；`clearTimeout(timer)`；`timer = setTimeout(() => { el?.remove(); el = null; }, 300)`。
- `ui.css`：`.hurt-flash { position: fixed; inset: 0; pointer-events: none; z-index: 8; background: radial-gradient(ellipse at center, rgba(200,0,0,0) 42%, rgba(190,0,0,0.45) 100%); }`
- `main.ts`：
  - 建立 `const hurtFlash = createHurtFlash(uiRoot);`（與其他 UI 一起）。
  - `let invuln = createInvuln();`
  - `applyMobEvent(ev, fromArrow)`：`if (!vitals) return;` 後加 `const nowSec = performance.now() / 1000; if (!canBeHurt(invuln, nowSec)) return; invuln = markHurt(invuln, nowSec);`；L710 改 `setVitals(exhaust(damage(vitals, ev.amount), EXHAUST_HURT));`；其後 `hurtFlash.flash();`。摔落（L1801）與星饑（tickVitals 內）**不動**。
  - 攻擊分支（L1988-2028）：命中時（`atk.hitId !== null` 已有分支）加 `if (vitals) setVitals(exhaust(vitals, EXHAUST_ATTACK));`。

- [ ] **Step 4: 測試轉綠** — 同 Step 2 → PASS。

- [ ] **Step 5: 全量驗證＋人工** — `npm run typecheck && npm test && npm run build` → 全綠。
人工（記錄結果）：兩隻殭屍貼身 → 掉血約每 0.5 秒一次、紅暈閃爍不疊加；摔落與星饑不受無敵幀影響；攻擊命中會增加隱藏消耗（飢餓節奏略快）。

- [ ] **Step 6: Commit**

```bash
git add src/player/invuln.ts src/player/invuln.test.ts src/ui/hurt.ts src/ui/hurt.test.ts src/ui/ui.css src/main.ts
git commit -m "feat(combat): B1.5 玩家受擊無敵幀與紅色回饋（附攻擊／受傷消耗）"
```

---

### Task 10: 0.4.0 發布

**Files:**
- Modify: `package.json`、`game.json`、`README.md`、`.github/workflows/release.yml`
- Create: `docs/releases/v0.4.0.md`

**Interfaces:**
- Consumes: Task 1-9 全部。
- Produces: tag `v0.4.0` 與 GitHub Release（CI 產生）。

- [ ] **Step 1: 版本 bump**

`package.json` `"version": "0.4.0"`；`game.json` `"version": "0.4.0"`（`cloudSave` 不動；`id` 不動）。

- [ ] **Step 2: README 更新（照 spec §跨批次與 §6）**

- 新增 `## 與原版的差異`（插在 `## 遊戲特色` 之後、`## 操作` 之前），內容＝spec §6 清單逐條（世界高度 256／無盔甲／無弓／無床／無天氣／靜態水／無紅石附魔村莊／日長 600 秒／死亡保留物品／敵對實體不跨存檔（被動生物 B4 起持久化）／工具無修補（B7 處理耐久）），加註「光照火把、容器、耐久、苦力怕蜘蛛已排入 B6–B9」與「疾跑目前僅 Ctrl（雙擊 W 與疾跑 FOV 排 B2）」。
- 修正既有宣稱：L37-38 挖掘說明改為「硬度 ×（可收穫 1.5／不可收穫 5）÷ 工具速度；木鎬 2×／石鎬 4×／鐵鎬 6×；石頭與煤礦需木鎬以上、鐵礦需石鎬以上；徒手或錯工具挖石類 ×5 且不掉落」；L43-44 括號改為「（石頭、煤礦需木鎬以上；鐵礦需石鎬以上）」；L52 改為「（兩模式各自保留背包與狀態；創造第一次進入補滿 9×64，之後保留你在創造的配置）」；L53-56 的 payload 說明改為「v1／v2 照讀並升級 v3（v3 起另存兩模式的背包與生存數值）」；L62-63 雲端同步清單加「兩模式的背包（附加欄位，舊版可讀）」；L45 熔爐原料補「生鐵」並註明舊存檔的鐵礦物品仍可熔煉。

- [ ] **Step 3: 發布說明 `docs/releases/v0.4.0.md`**

固定四段（中文）：`## 新增`／`## 修正`／`## 存檔格式與相容性提示`／`## 已知問題`。內容逐條對應本批：新增（生鐵物品與熔煉、受擊無敵幀與紅色回饋、新遊戲二次確認、生存 E 面板分流）；修正（飢餓 exhaustion／回復、破壞公式與鎬等級、掉落表、兩模式狀態保留）；相容性（本機 payload v3：舊版遊戲讀 v3 記錄會視為無存檔（回退限制）；雲端維持 format 1 僅加 `stash` 欄位；v1/v2 舊檔照讀遷移）；已知問題（Ctrl+W 為瀏覽器保留鍵、雙擊 W 疾跑與 FOV 待 B2；敵對生物白天不燃燒待 B4）。

- [ ] **Step 4: release workflow 支援 notes 檔**

**先重讀上游模板**（AGENTS.md §1 清單的 `game-release.yml`；若模板已改動，以模板為準並調整本步驟）。若模板仍為 `gh release create … --generate-notes`，改成優先使用版本 notes 檔：

```yaml
      - name: Publish release asset
        env:
          GH_TOKEN: ${{ github.token }}
          RELEASE_TAG: ${{ github.ref_name }}
          RELEASE_REPO: ${{ github.repository }}
          GAME_ZIP: ${{ runner.temp }}/playroom-release/game.zip
        run: |
          NOTES_ARGS=(--generate-notes)
          if [ -f "docs/releases/$RELEASE_TAG.md" ]; then
            NOTES_ARGS=(--notes-file "docs/releases/$RELEASE_TAG.md")
          fi
          gh release create "$RELEASE_TAG" "$GAME_ZIP" --repo "$RELEASE_REPO" --verify-tag "${NOTES_ARGS[@]}" --prerelease="$RELEASE_PRERELEASE"
```

（workflow 的其餘檢查——tag 對版本、工具 sha256、pack＋validate——全部保留。）

- [ ] **Step 5: 全量 gates**

Run: `npm run typecheck && npm test && npm run build && npm run lint`
Expected: 全綠（lint 現況即乾淨，維持）。

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
git commit -m "chore(release): 0.4.0"
```

本計畫在 `b1-stabilization` 分支執行：tag 與 push 屬整支完成後的整合步驟——merge 回 master 後才 `git tag -a v0.4.0 -m "0.4.0: B1 止血修復"`＋`git push origin master`＋`git push origin v0.4.0`，由 controller 依 finishing-a-development-branch 流程執行（見 ledger 裁決）。

- [ ] **Step 8: 驗證 CI Release**

以 `webfetch https://github.com/TommyLamm/WeCraft/releases/tag/v0.4.0` 確認 release 存在、asset 已附、說明為 `docs/releases/v0.4.0.md` 內容。回報照 AGENTS.md 四段式：程式完成／ZIP 驗證／Release（CI 結果）／平台上架（若屬平台操作，向使用者確認後再按）。

- [ ] **Step 9: Commit（收尾）**

若 Step 8 有任何補正（文件錯字、notes 檔更新），再一顆 commit；無則略過。

---

## Self-Review 記錄

- **Spec coverage**：spec §B1.1→Task 1；B1.2→Task 7；B1.3→Task 2＋3＋4；B1.4→Task 8；B1.5→Task 9；B1.6→Task 5＋6；§跨批次（版本節奏／發布／README 差異段）→Task 10；AC「60fps 與低 fps 一致／不吞點／不秒清空」→Task 1 測試；「模式往返原樣」→Task 2／3 測試＋人工；「表驅動挖掘測試」→Task 5／6；「有存檔必二次確認」→Task 8。
- **Type consistency**：`ModeStash`／`StashPayload` 同形（survivalVitals 非 null）；`canHarvest(blockId, held)` 由 Task 5 產生、Task 6 `spawnBlockDrop` 消費；`EXHAUST_*` 由 Task 1 產生、Task 6／9 消費；`sanitizeSlots` 由 Task 3 產生、Task 3／4 main 接線消費。
- **Review Focus→測試**：逐條已掛在 Task 1／3／4、Task 1、Task 2／3／4、Task 5／6、Task 8。
- **已知未測面**：`src/main.ts` 無測試（組裝根）——Task 2／3／4／8／9 的接線以人工步驟佐證並在回報中列「未自動化」；Playwright 不在 B1 門檻（未動 iframe／pointer lock／全螢幕／保留鍵）。
