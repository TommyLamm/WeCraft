# WeCraft B2 操控手感（0.5.0）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 補齊 B2 操控手感——疾跑狀態機（雙擊 W 主入口／Ctrl 輔、撞牆／潛行／停止／飢餓門檻取消）、平滑疾跑 FOV、右鍵放置連放、潛行防摔邊、F5 三態視角＋無動畫方塊人玩家模型、Q 丟棄（1 個／長按連丟／Ctrl+Q 整疊），並發布 0.5.0。

**Architecture:** 可測規則一律抽成純模組放 `src/player`／`src/core`：`sprint.ts`（疾跑狀態機）、`hold-repeat.ts`（0.2 秒連放／連丟節拍）、`core/fov.ts`（FOV 平滑）、`core/view-mode.ts`（三態視角姿態）；物理層 `physics.ts` 只加兩件事——撞牆夾角回報與潛行防摔邊；渲染層新增 `src/render/player-model.ts`（方塊人，無動畫）。`src/main.ts` 仍是未測的組裝根，只做接線與節拍套用。**本批不動存檔形狀**（本機 payload 維持 v3、雲端 format 維持 1）。

**Tech Stack:** TypeScript strict、Three.js、Vite、Vitest（jsdom）、Playwright（批末真實 Chromium，probe 放 repo 外）、GitHub Actions release workflow。

**Spec:** `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md` §B2（L132–153）；跨批契約見 `/tmp/opencode/wecraft-planning/planning-conventions.md` §3–§7。

**執行方式:** SDD＋隔離 worktree，分支名 `b2-controls`（在計畫標注即可，不用建 branch）。每個 Task 是最小可獨立審查單元（TDD 循環、可獨立 commit）；批次最後由 controller merge、打 tag、push。

---

## Global Constraints

（出自 spec §B2、§1、§2、公約 §3–§7 與 `AGENTS.md`；每個任務都隱含本節。）

- 每個任務結束：`npm run typecheck`、`npm test`、`npm run build` 全綠；`npm run lint` 維持乾淨；**既有 806 tests／51 files 不得刪除或弱化**（要改測試必須在 commit 訊息說明理由）。
- **本批要改寫的既有測試（集中清單，2026-10-20 終審修正）**：**本批不改寫任何既有測試**——只新增案例。逐條如下（每一條都要寫進對應 Task 的 Step，並在 commit 訊息說明「只增不改」）：
  | 檔案 | 既有測試 | 本批動作 | 說明 |
  |---|---|---|---|
  | `src/player/input.test.ts` | 既有 2 個 `describe`（`Escape requests pause while locked`／`double-tap Space flight gate`） | **不動**；Task 2 只新增第三個 `describe`（疾跑／丟棄／右鍵按住旗標） | 既有斷言一字不改 |
  | `src/player/physics.test.ts` | 既有案例 | **不動**；Task 3／4 只新增案例（撞牆夾角、潛行防摔邊） | `stepPlayer` 回傳值新增但既有呼叫端忽略回傳值 → 既有斷言不需改（Task 3／4 的 Interfaces 已註明） |
  | 其餘 49 個測試檔 | 全部 | **不動** | 本批不碰物品表／方塊表／存檔／渲染的既有斷言 |
  → **本批是 `InputState.placeHeld` 的擁有者**（宣告、`onMouseDown`／`onMouseUp` 的設旗標、`clearActive()` 的清除全在本批）；**B4（0.7.0）只消費、不得重新宣告**（見〈與公約／spec 的差異〉第 10 條與 B4 計畫的〈上游相依〉段）。
- 版本：本批發布 `0.5.0`；`package.json` 與 `game.json` 同步；tag 為 `v0.5.0` 且指向含 bump 的 commit；不覆寫已發布版本；`id` 固定 `wecraft`。
- 存檔：**本機 payload 維持 v3、雲端 `cloudSave` 維持 `readableFormats:[1], writeFormat:1`、`game.json` 的 `cloudSave` 不動**。本批沒有存檔形狀變更，0.5.0 與 0.4.0 的存檔互相可讀。
- 原版基準：Minecraft Java Edition 1.20+；數值以本計畫〈已查證與簡化決策〉一節為準（該節逐條引 wiki 原文並解掉矛盾）。
- **不動 `Esc`／iframe／pointer lock／全螢幕既有路由**；新增輸入只掛在既有 locked 分支（`input.ts` 的 `if (!locked) return;`）。`Ctrl+W` 是瀏覽器保留鍵，本批不嘗試攔截，一律列「未驗證」。
- 發布候選跑固定工具：`.playroom/tools/playroom-game-tools-1.1.0.zip`（先驗 `sha256` 與 `.playroom/game-tools.lock.json` 一致）＋ `pack-game.mjs`＋`validate-game.mjs`；本機無 `unzip`，用 `python3 -m zipfile`。
- 本批改動到的「Minecraft parity」宣稱（疾跑、FOV、視角、丟棄、連放、潛行）要同步校正（各任務自己處理碰到的段落，Task 14 收斂 README）。
- 註解與文件用繁體中文（台灣用語）；識別字與程式碼英文。
- **行號基準**：`master @ b11273f`。本計畫內的行號以該基準為準；Task 9 之後 `src/main.ts` 行號會位移，後續任務以「當時檔案內容」為準（用錨點／程式碼片段定位，不要照抄行號）。

---

## Review Focus

（spec 沒明說、但最可能咬人的失敗模式；每一條都已在對應任務放測試釘住。）

1. **雙擊 W 的時間窗與殘留**：`≤350ms`（7 tick）內兩次按下才成立；按住 W 的 key repeat（`e.repeat === true`）**不得觸發**疾跑、但**必須刷新**時間窗（否則「按住 W 一秒 → 放開 → 再點一次」會以最初那一次按計時 → 永遠不疾跑）；視窗失焦／指標解鎖必須清掉「上次按鍵時間」，否則切回遊戲會莫名疾跑；雙擊與 Ctrl 並存時放開 Ctrl 不得讓疾跑憑空消失或殘留。→ Task 1（狀態機 latch 語意）、Task 2（input 事件層）。
2. **疾跑取消條件是否完備且不會卡住**：停止前進、潛行、飛行、水中、飢餓 ≤6、撞牆 >8°、攻擊命中；其中「鎖存（雙擊 W）」一旦被取消就必須清掉（一次性），而「按住 Ctrl」路徑在暫時性阻擋解除後要能恢復。→ Task 1（表驅動測試）、Task 3（8° 邊界）、Task 9（接線與消耗）。
3. **疾跑飢餓門檻的兩個門檻不可混為一談**：開始疾跑需要 `hunger > 6`；疾跑中掉到 `≤ 6` 立即取消；回到 `≥ 7` 即可再次開始（不設「>7」的額外鎖定）。→ Task 1（`hunger 6`／`hunger 7` 兩條測試）。
4. **連放不得重複「使用」而非「放置」**：第一次右鍵照完整流程（開工作台／開熔爐／吃蘋果／放方塊），之後每 0.2 秒只能重複「放方塊」；滑鼠解鎖／失焦必須停。→ Task 7（節拍模組）、Task 10（接線與 Playwright 計數）。
5. **Q 丟棄的數量與拾取延遲**：單個、整疊、長按節奏、創造模式不消耗、玩家丟出的物品 2 秒（40 tick）內不可拾；任何分支都不能複製或吞物品。→ Task 10（`spawnDrop` 選項與熱鍵欄計數）、Task 13（Playwright）。
6. **三態相機與互動射線方向一致**：面後相機必須真的在玩家**後方**（現況是放在前方，屬既有 bug）、面前視角相機 yaw 為玩家 yaw + π、互動射線一律以**相機姿態**為準（位置＋yaw／pitch）、reach 依視角補回 4 格。→ Task 6（`viewPose` 純函式測試）、Task 11（接線與截圖）。
7. **FOV 平滑不炸相機**：dt 非有限／≤0、極大 dt、反覆切換都不得產生 NaN 或跳變；回到第一人稱／新局必須回到 70。→ Task 5（`stepFov` 測試）、Task 9（接線）。

---

## 已查證與簡化決策

（公約 §7 B2 查證清單的結果；引註格式：`已查證（minecraft.wiki/<Page>，2026-10-20）`。抓不到原文者寫「實作時複核」。）

### 1. 疾跑飢餓門檻——**矛盾已解，只留一個說法**

兩頁原文（已查證，minecraft.wiki/Sprinting、minecraft.wiki/Food，2026-10-20）：

- Sprinting §Activating：「To sprint, the player can press sprint while moving, or double tap forward. **The player cannot sprint if their hunger bar is at 6 (🍗) or below**, or when they are under the Blindness effect.」
- Sprinting §Usage：「Sprinting ends when the player collides with a solid block at an angle of greater than 8 degrees, or attacks a mob. **Sprinting also ends if the hunger bar reduces to 6 (🍗) or less.**」
- Sprinting §History（Java Edition Combat Tests）：「**Reintroduced the rule that sprinting requires more than 6 points of food.**」
- Food §Sprinting：「If the hunger value is at 6 (🍗) or below, the player loses the ability to sprint **until the hunger value exceeds 7** (🍗).」

**裁決（不兩說並存，兩個門檻各自釘死）**：

| 項目 | 本批規則 | 依據 |
|---|---|---|
| 開始疾跑的門檻 | 生存模式 `hunger > 6`（即 ≥ 7）才允許開始；創造模式（無飢餓）不受限 | Sprinting §Activating「at 6 or below」＋ 歷史條目「requires **more than 6** points of food」 |
| 疾跑中的取消門檻 | 疾跑中 `hunger ≤ 6` → **立即**取消疾跑 | Sprinting §Usage「ends if the hunger bar reduces to 6 or less」 |
| 恢復 | 回到 `hunger ≥ 7` 即可再次開始疾跑，**不設額外鎖定** | 同上（見下方說明） |

Food 頁「until the hunger value exceeds 7」被解讀為「失去能力後要恢復」的敘述用詞，**不採用其字面的 ≥8 解讀**：Sprinting 頁兩處都寫 6，原版歷史條目明說「more than 6 points of food」，兩頁的樞紐數值是同一個 6。本批只認「6」這一個門檻值，程式裡只有 `SPRINT_MIN_HUNGER = 6` 這一個常數，開始與取消都用它（`>6` 可開始／`≤6` 取消）。

其他已查證的疾跑行為（minecraft.wiki/Sprinting，2026-10-20）：

- 「Sprinting allows the player to move at around **5.612 meters/second**」→ 本作沿用既有 `SPRINT_SPEED = 5.6`（`src/player/physics.ts:10`），不動。
- 「Sprinting ends when the player collides with a solid block at an angle of **greater than 8 degrees**」；§History 1.21.4 (24w44a)：「Increased the angle at which colliding with blocks does not prevent sprinting from 5.5 to 8 degrees.」→ 本批門檻 **> 8°**（剛好 8° 不取消）。
- 「Players who attack while sprinting deal a sprint-knockback attack, inflicting additional knockback and **canceling the sprint**.」→ 攻擊命中取消疾跑（清鎖存）。
- 「Sprinting **pauses** when the player eats food or drinks potions, but pressing sprint while eating food or potions does not start sprinting.」→ 本批沒有「進食持續」機制（進食是一按即吃，見 `src/player/eat.ts`），此條**不適用**，列入實作時複核清單。
- Sprinting §Activating：「To sprint, the player can press sprint while moving, or **double tap forward**.」

### 2. 雙擊 W 的判定視窗

- 已查證（minecraft.wiki/Options，2026-10-20）：Controls 區段有「Sprint Window — **Represents the time window in ticks where double-tapping the forward key activates sprint.**」，預設 **7**（tick）。
- 已查證（minecraft.wiki/Controls，2026-10-20）§Semi-configurable controls：「`W` — Sprint (secondary) … When pressed twice in quick succession, causes the player to sprint (unless the character is too hungry).」

**決策：視窗 = 7 tick = 0.35 秒**（`SPRINT_DOUBLE_TAP_WINDOW_SEC = 0.35`）。原版可在選項調整，本批固定 0.35 s（README 記為簡化）。計時來源**釘死為輸入事件的時間戳**（`performance.now()` 於 keydown 當下取樣），不是幀累加——雙擊判定不應受影格率影響（60fps 與 144fps 行為一致），且失焦時可直接清零。

### 3. 疾跑 FOV 加成

- 已查證（minecraft.wiki/Sprinting，2026-10-20）：「While sprinting, the player's field of view **expands slightly**.」——只寫「稍微擴大」，未給數值。
- 已查證（minecraft.wiki/Options，2026-10-20）：「the FOV value represents how many degrees of vertical vision the player gets **without modifying effects such as sprinting**, flying or status effects.」——確認存在「疾跑 FOV 效果」，但 wiki 未列數值；`minecraft.wiki/FOV_Effects` 頁 404（不存在，2026-10-20）。

**決策（簡化值＋理由）**：固定加成 **+10%**（基準 70 → 疾跑 77），`SPRINT_FOV_RATIO = 0.10`。理由：+10% 與原版實測／常見實作一致，且 70→77 的視野擴張量明顯但不暈；本批以指數平滑（時間常數 0.1 s）逼近目標值，避免瞬間跳動。README 的〈與原版的差異〉要記「原版為動態計算，本作固定 +10%」。

### 4. 放置連放節奏

- 4 tick（0.2 秒）為 **spec §B2.2 已定案**值（「首次照現行，之後每約 0.2 秒重複一次（原版 4 tick，查證後定案）」）。
- **實作時複核**：minecraft.wiki/Block（2026-10-20 抓 raw 全文，`4 tick`／`cooldown`／`repeat` 皆無記載）——原版放置重複間隔未見於 wiki；實作時可用「連放 0.2 s 放 5 塊」與原版影片對照複核。本批以 0.2 s 落實並在 README 記為「4 tick 原版節奏」。

### 5. Q 丟棄

- 已查證（minecraft.wiki/Controls，2026-10-20）「Drop Selected Item」：「Drop/toss an item. If items are stacked, **only one** gets thrown/tossed/dropped. In recent versions of Java Edition, **holding the key causes single items to be dropped quickly** from a stack. There is no actual "throw" command; "drop" (default `Q`) tosses an object approximately **2 to 3 blocks** from the player. **`Control+Q` drops the whole stack of items.**」
- 已查證（minecraft.wiki/Item (entity)，2026-10-20）：「Dropped items have a delay of **10 ticks (half a second)** between appearing and being able to be picked up, or **40 ticks (2 seconds) if thrown by a player**, dolphin, or fox.」

**決策**：

| 項目 | 值 | 依據 |
|---|---|---|
| Q 單次 | 丟 1 個 | Controls「only one」 |
| Ctrl+Q | 丟整疊 | Controls「Control+Q drops the whole stack」 |
| 長按連丟節奏 | **0.2 秒／次**（`DROP_REPEAT_SEC`），每次 1 個（按住 Ctrl 時為整疊） | wiki 只說「quickly」無數值 → 與放置連放同節奏的**簡化值** |
| 玩家丟出的拾取延遲 | **2.0 秒（40 tick）** | Item (entity)「40 ticks (2 seconds) if thrown by a player」 |
| 方塊破壞掉落的拾取延遲 | 維持 0.5 秒（10 tick，既有 `SPAWN_PICKUP_DELAY`） | Item (entity)「10 ticks (half a second)」＋ repo 現況已相符 |
| 拋出距離 | 目標點＝玩家腳位 + 前方 0.5 格，初速＝前方 2.5 格/秒、向上 1.5 格/秒 | Controls「2 to 3 blocks」；**簡化**：本作掉落物有水平阻力（`HORIZONTAL_DRAG_PER_SEC = 0.1`），水平總位移上限 ≈ `2.5 / (−ln 0.1)` ≈ **1.1 格** → 落點約在腳前 1.5 格內，比原版近（README 記錄） |
| 創造模式 | **Q 不作用**（不丟、不消耗） | 簡化：與 repo 既有「創造不產生掉落物」一致，避免無限複製與地上垃圾（README 記錄） |

### 6. 潛行防摔邊語義

- 已查證（minecraft.wiki/Sneaking，2026-10-20）§Effects：「**Players are prevented from walking off edges** if the difference in height between the two surfaces is higher than the step_height attribute (defaults to 0.6 blocks) **as long as they are up to 0.6 blocks above the ground**」；「The player can still dismount blocks while sneaking by **jumping** over the block's edge.」；「A sneaking player still falls if the **block beneath the player's feet is destroyed**.」；§History 1.16.2 (20w27a)：「Sneaking now also prevents falling from heights when being up to 0.6 blocks above the ground; previously the player had to be on the ground.」

**決策（簡化＋對應 spec §B2.3）**：**潛行且著地時，水平位移若會讓腳下失去支撐，取消該軸位移**。具體：候選位置若「玩家中心點正下方一格不是實心方塊」則取消該軸（逐軸判斷，x 與 z 各自獨立）——效果是身體可以探出邊緣，但中心點走不出腳下的方塊。未實作的部分（明示簡化）：① 不做 step_height 0.6 的高度差判斷；② 不做「離地 0.6 格內仍受保護」；③ 支撐判定只看「腳下正下方（中心點）一格」，原版以 hitbox 是否仍被支撐判定（兩者都會在玩家整個離開方塊前擋住，但允許探出邊界的距離不同：本批中心點不越界，原版可探出約半個身位）。

### 7. F5 三態與第三身相機

- 已查證（minecraft.wiki/Controls，2026-10-20）「Toggle Perspective」：「Toggles between **first person, third person from the back and third person from the front**.」
- 已查證（minecraft.wiki/Third-person view，2026-10-20）：「The third-person camera is positioned **4 blocks** from the player's front/back by default」。

**決策**：視角循環 `first → back → front → first`；相機距離 4 格（沿用 repo 既有 `back = 4`）、高度 +0.5；面後視角相機 yaw＝玩家 yaw；**面前視角相機 yaw＝玩家 yaw + π**（面向玩家，與原版同），互動射線一律以**相機姿態**為準。玩家模型只在 back／front 顯示，第一人稱隱藏。

### 8. 計數基準

- 既有測試基準：`master @ b11273f` 為 **806 tests／51 files**（README「Test」段亦如此記載）。本批只增不改既有測試語意（唯一例外見 Task 3／Task 4 對 `stepPlayer` 回傳值的調整——既有呼叫端忽略回傳值，既有斷言不需修改）。

---

## 檔案結構

| 檔案 | 動作 | 職責 |
|---|---|---|
| `src/player/sprint.ts` | 新增 | 疾跑狀態機（鎖存／取消原因／飢餓與撞牆門檻）純邏輯 |
| `src/player/sprint.test.ts` | 新增 | 疾跑狀態機測試 |
| `src/player/input.ts` | 修改 | 雙擊 W 偵測、Q 脈衝／整疊旗標、右鍵與 Q 的按住旗標、失焦清除（**`placeHeld` 由本批擁有**，B4 只消費） |
| `src/player/input.test.ts` | 修改 | 輸入層測試（新增 describe 區塊，既有測試不動） |
| `src/player/physics.ts` | 修改 | 撞牆夾角回報（`StepResult`）、潛行防摔邊（支撐檢查） |
| `src/player/physics.test.ts` | 修改 | 物理測試（新增案例，既有案例不動） |
| `src/player/hold-repeat.ts` | 新增 | 0.2 秒按住連放／連丟節拍純邏輯 |
| `src/player/hold-repeat.test.ts` | 新增 | 節拍測試 |
| `src/core/fov.ts` | 新增 | 基準 FOV、疾跑加成、指數平滑 |
| `src/core/fov.test.ts` | 新增 | FOV 測試 |
| `src/core/view-mode.ts` | 新增 | 三態視角與相機姿態純函式 |
| `src/core/view-mode.test.ts` | 新增 | 視角姿態測試 |
| `src/render/player-model.ts` | 新增 | 無動畫方塊人玩家模型（頭／身／手腳＋臉部貼片） |
| `src/render/player-model.test.ts` | 新增 | 玩家模型測試 |
| `src/world/drops.ts` | 修改 | `spawnDrop` 支援自訂 `pickupDelay`／`vel`；新增玩家丟出延遲常數 |
| `src/world/drops.test.ts` | 修改 | `spawnDrop` 選項測試 |
| `src/ui/menus.ts` | 修改 | 暫停選單加「操作提示」行（雙擊 W／Q／F5／連放） |
| `src/ui/ui.test.ts` | 修改 | 暫停選單提示測試 |
| `src/main.ts` | 修改 | 全部接線（疾跑、FOV、連放、Q、三態視角、玩家模型、probe 用唯讀 debug hook） |
| `README.md`、`docs/releases/v0.5.0.md`、`package.json`、`game.json` | 修改／新增 | Task 14 發布 |

---

### Task 1: 疾跑狀態機（純邏輯）

**Files:**
- Create: `src/player/sprint.ts`、`src/player/sprint.test.ts`

**Interfaces:**
- Consumes: 無（本批第一個任務）。
- Produces（後續任務依賴，名稱與簽名不得再改）：
  - `export const SPRINT_DOUBLE_TAP_WINDOW_SEC = 0.35;`（7 tick）
  - `export const SPRINT_MIN_HUNGER = 6;`（飢餓 ≤6 不可疾跑／疾跑中取消）
  - `export const SPRINT_WALL_ANGLE_DEG = 8;`（撞牆 >8° 取消）
  - `export type SprintCancelReason = 'no-forward' | 'sneaking' | 'flying' | 'in-water' | 'hunger' | 'wall' | 'attacked';`
  - `export interface SprintState { active: boolean; latched: boolean; ctrlHeld: boolean; lastCancel: SprintCancelReason | null }`（`ctrlHeld` 只記錄「上一幀 Ctrl 是否按住」供除錯／後續擴充用；**所有判定一律以 `ctx.ctrlHeld` 為準**，本批不依賴此欄位——2026-10-20 稽核修正：原設計讓 `state.ctrlHeld` 與 `ctx.ctrlHeld` 語意重複且前者無作用）
  - `export interface SprintContext { forward: boolean; sneak: boolean; ctrlHeld: boolean; sprintRequested: boolean; hunger: number | null; flying: boolean; inWater: boolean; wallAngleDeg: number | null; attacked: boolean }`
  - `export function createSprintState(): SprintState`
  - `export function cancelReason(ctx: SprintContext): SprintCancelReason | null`
  - `export function isWallBlock(angleDeg: number | null): boolean`（`angleDeg !== null && angleDeg > SPRINT_WALL_ANGLE_DEG`）
  - `export function updateSprint(state: SprintState, ctx: SprintContext): SprintState`

- [ ] **Step 1: 寫 `src/player/sprint.test.ts`（失敗）**

  測試骨架（先建立 `ctx()` 輔助，預設 forward=true、hunger=20、無阻擋）：

  ```ts
  const ctx = (over: Partial<SprintContext> = {}): SprintContext => ({
    forward: true, sneak: false, ctrlHeld: false, sprintRequested: false,
    hunger: 20, flying: false, inWater: false, wallAngleDeg: null, attacked: false, ...over,
  });
  ```

  測試名＋斷言：

  - `'a fresh state is idle and unlatched'`：`expect(createSprintState()).toEqual({ active: false, latched: false, ctrlHeld: false, lastCancel: null });`
  - `'holding ctrl sprints while moving forward'`：`updateSprint(createSprintState(), ctx({ ctrlHeld: true }))` → `active === true`、`latched === false`。
  - `'a double tap latches sprinting until a cancel condition fires'`：第一次 `ctx({ sprintRequested: true })` → `latched === true`、`active === true`；第二次（不再帶 `sprintRequested`）→ `active === true`、`latched === true`。
  - `'releasing forward stops sprinting and clears the latch'`：鎖存後 `ctx({ forward: false })` → `active === false`、`latched === false`、`lastCancel === 'no-forward'`。
  - `'sneaking cancels sprinting'`：→ `lastCancel === 'sneaking'`、`active === false`。
  - `'flying and water cancel sprinting'`：`ctx({ flying: true })` → `'flying'`；`ctx({ inWater: true })` → `'in-water'`。
  - `'hunger 6 cancels sprinting and hunger 7 does not'`：`ctx({ ctrlHeld: true, hunger: 6 })` → `lastCancel === 'hunger'`；`ctx({ ctrlHeld: true, hunger: 7 })` → `active === true`、`lastCancel === null`。
  - `'a double tap at hunger 6 never starts sprinting'`：`ctx({ sprintRequested: true, hunger: 6 })` → `active === false`、`latched === false`、`lastCancel === 'hunger'`。
  - `'creative mode ignores the hunger gate'`：`ctx({ ctrlHeld: true, hunger: null })` → `active === true`。
  - `'a wall hit steeper than 8 degrees cancels sprinting'`：`ctx({ ctrlHeld: true, wallAngleDeg: 8.1 })` → `lastCancel === 'wall'`；`ctx({ ctrlHeld: true, wallAngleDeg: 8 })` → `active === true`（剛好 8° 不取消）。
  - `'ctrl held resumes sprinting after the wall is cleared'`：先 `wallAngleDeg: 45` → `active === false`；再 `wallAngleDeg: null` → `active === true`。
  - `'a latched sprint does not resume after the wall clears'`：鎖存後撞牆 → `latched === false`；牆消失後 → `active === false`。
  - `'a landed attack cancels sprinting and clears the latch'`：鎖存後 `ctx({ attacked: true })` → `lastCancel === 'attacked'`、`active === false`、`latched === false`；下一幀（`attacked: false`、無 Ctrl）→ `active === false`。
  - `'ctrl held sprints again on the frame after an attack'`：攻擊那一幀 `active === false`；下一幀（`attacked: false`、`ctrlHeld: true`）→ `active === true`。
  - `'updateSprint never mutates the previous state'`：呼叫前後 `expect(before).toEqual({ active: false, latched: false, ctrlHeld: false, lastCancel: null })`；且回傳值是**新物件**：`expect(result).not.toBe(state)`。（2026-10-20 稽核修正：原斷言只比對「呼叫前後相等」，沒斷言「回傳新物件」。）
  - `'isWallBlock uses a strict 8 degree threshold'`：`isWallBlock(8) === false`、`isWallBlock(8.0001) === true`、`isWallBlock(null) === false`。
  - `'the constants match the vanilla values'`：`SPRINT_MIN_HUNGER === 6`、`SPRINT_WALL_ANGLE_DEG === 8`、`SPRINT_DOUBLE_TAP_WINDOW_SEC` `toBeCloseTo(0.35, 10)`。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/player/sprint.test.ts` → Expected: FAIL（模組不存在）。

- [ ] **Step 3: 實作 `src/player/sprint.ts`**

  - 檔頭 doc 註解寫清楚：門檻來源（wiki 引文要點）、鎖存 vs Ctrl 兩種來源、取消原因清單、飢餓規則（>6 可開始／≤6 取消／無額外鎖定）。
  - `cancelReason(ctx)` 的判定順序固定為：`!forward → 'no-forward'`；`sneak → 'sneaking'`；`flying → 'flying'`；`inWater → 'in-water'`；`hunger !== null && hunger <= SPRINT_MIN_HUNGER → 'hunger'`；`isWallBlock(ctx.wallAngleDeg) → 'wall'`；`ctx.attacked → 'attacked'`；否則 `null`。
  - `updateSprint(state, ctx)`：先 `const latched = state.latched || ctx.sprintRequested;`；再 `const reason = cancelReason(ctx);`；有 reason → 回傳 `{ active: false, latched: false, ctrlHeld: ctx.ctrlHeld, lastCancel: reason }`（鎖存被清掉＝一次性）；無 reason → 回傳 `{ active: latched || ctx.ctrlHeld, latched, ctrlHeld: ctx.ctrlHeld, lastCancel: null }`。**回傳全新物件，不修改入參。**

- [ ] **Step 4: 跑測試轉綠**

  Run: `npx vitest run src/player/sprint.test.ts` → Expected: PASS。

- [ ] **Step 5: 全量驗證**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → Expected: 全綠（既有 806 tests 一個不多、一個不少）。

- [ ] **Step 6: Commit**

  ```bash
  git add src/player/sprint.ts src/player/sprint.test.ts
  git commit -m "feat(sprint): B2.1 疾跑狀態機（雙擊 W 鎖存／Ctrl 輔／飢餓與撞牆門檻）"
  ```

---

### Task 2: 輸入層——雙擊 W、Q 丟棄、右鍵按住

**Files:**
- Modify: `src/player/input.ts`（`InputState` 約 L4-12、`createInput` 約 L30-59、`onKeyDown` 約 L61-88、`onKeyUp` 約 L90-93、`onMouseDown` 約 L102-106、`onMouseUp` 約 L108-109、`clearActive` 約 L116-125）
- Modify: `src/player/input.test.ts`（**只新增** `describe` 區塊，既有測試不動）

**Interfaces:**
- Consumes: Task 1 的 `SPRINT_DOUBLE_TAP_WINDOW_SEC`（由 `src/player/input.ts` import；單一真實來源）。
- Produces:
  - `InputState` 新增欄位：`placeHeld: boolean`（右鍵按住）、`dropRequest: boolean`（Q 脈衝）、`dropWholeStack: boolean`（該次 Q 是否為 Ctrl+Q）、`dropHeld: boolean`（Q 按住）、`sprintToggle: boolean`（雙擊 W 脈衝）。
    - **所有權（2026-10-20 稽核修正）**：`placeHeld` **由 B2（0.5.0）擁有**（宣告在 `InputState`、由 `clearActive()` 清除）。**B4（0.7.0）只消費、不得重新宣告**（B4 若再加一次 `placeHeld: boolean` 會是 TS duplicate identifier，且語意相同＝同一件事做兩次）。詳見〈與公約／spec 的差異〉第 10 條。
  - `InputController.consumeSprintToggle(): boolean`（一次性脈衝）。
  - `InputController.consumeDrop(): { wholeStack: boolean } | null`（無請求時回 `null`）。
  - 行為：`clearActive()`（失焦／指標解鎖）必須清掉 `sprintToggle`、`dropRequest`、`dropWholeStack`、`placeHeld`、`dropHeld`，以及「上次 W 按鍵時間」。

- [ ] **Step 1: 寫測試（失敗）**（`src/player/input.test.ts` 追加）

  時間控制用 `vi.spyOn(performance, 'now')`（jsdom 有 `performance.now`；用 mock 回傳值推進時間，避免依賴真時脈）。既有檔案的 `tap`／`down`／`up` 輔助沿用。

  - `'two W presses within 350 ms request sprinting'`：
    ```ts
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1000); tap('KeyW');
    now.mockReturnValue(1200); tap('KeyW');
    expect(ctrl.consumeSprintToggle()).toBe(true);
    expect(ctrl.consumeSprintToggle()).toBe(false); // 脈衝只發一次
    now.mockRestore();
    ```
  - `'two W presses 400 ms apart do not request sprinting'`：1000 → 1400 → `expect(ctrl.consumeSprintToggle()).toBe(false)`。
  - `'holding W with auto-repeat never requests sprinting'`：`down('KeyW')` 後 `document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', repeat: true }))` → `expect(ctrl.consumeSprintToggle()).toBe(false)`。
  - `'a held W refreshes the double-tap window without requesting sprinting'`（2026-10-20 稽核修正）：
    ```ts
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1000); down('KeyW');                                  // 初次按下（按住不放）
    now.mockReturnValue(1500);
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', repeat: true })); // 自動重複
    expect(ctrl.consumeSprintToggle()).toBe(false);                            // repeat 不得「觸發」疾跑
    now.mockReturnValue(1600); up('KeyW');                                     // 放開
    now.mockReturnValue(1650); down('KeyW');                                   // 立刻再按一次
    expect(ctrl.consumeSprintToggle()).toBe(true);                             // 視窗被 refresh → 成立
    now.mockRestore();
    ```
    （守衛的是「repeat 不得**觸發**疾跑」與「repeat 仍要**刷新視窗**」兩件不同的事：若時間戳只在非 repeat 的 keydown 更新，按住 W 一秒後放開再點一次會以「最初那一次按」計時（>350 ms）→ 永遠不疾跑。）
  - `'losing focus clears the double-tap window'`：`tap('KeyW')`（t=1000）→ `window.dispatchEvent(new Event('blur'))` → t=1100 再 `tap('KeyW')` → `expect(ctrl.consumeSprintToggle()).toBe(false)`。
  - `'losing pointer lock clears a pending sprint request'`：雙擊後尚未 consume 就解除指標鎖 → `expect(ctrl.consumeSprintToggle()).toBe(false)`。
  - `'Q requests a drop of one item'`：`expect(ctrl.consumeDrop()).toEqual({ wholeStack: false })`；再 `expect(ctrl.consumeDrop()).toBeNull()`。
  - `'ctrl+Q requests the whole stack'`：`down('ControlLeft'); down('KeyQ');` → `expect(ctrl.consumeDrop()).toEqual({ wholeStack: true })`。
  - `'the right mouse button sets placeHeld until released'`：`canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2 }))` → `expect(ctrl.state.placeHeld).toBe(true)`；`document.dispatchEvent(new MouseEvent('mouseup', { button: 2 }))` → `expect(ctrl.state.placeHeld).toBe(false)`。
  - `'the right mouse button still fires the one-shot place pulse'`：mousedown 後 `expect(ctrl.consumePlace()).toBe(true)`。
  - `'losing pointer lock clears placeHeld and dropHeld'`：先按右鍵與 Q，再解除指標鎖 → 兩旗標皆 `false`。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/player/input.test.ts` → Expected: FAIL（`consumeSprintToggle`／`consumeDrop`／新欄位不存在）。

- [ ] **Step 3: 實作 `src/player/input.ts`**

  - `InputState` 補 5 個欄位並在 `createInput` 的初始物件補上初始值（`placeHeld: false, dropRequest: false, dropWholeStack: false, dropHeld: false, sprintToggle: false`）。
  - 雙擊 W 偵測（放進 `onKeyDown`，在 `if (!locked) return;` 之後）：
    ```ts
    if (e.code === 'KeyW') {
      // 時間窗「每次 keydown 都刷新」（含 e.repeat 的自動重複）：否則「按住 W 一秒
      // → 放開 → 立刻再按一次」會以「最初那一次按」計時（>350 ms）→ 永遠不疾跑。
      // 但只有「非重複」的按下才可能觸發疾跑（repeat 不得觸發）。
      const now = performance.now();
      if (!e.repeat && lastForwardDownMs !== null && (now - lastForwardDownMs) / 1000 <= SPRINT_DOUBLE_TAP_WINDOW_SEC) {
        state.sprintToggle = true;
      }
      lastForwardDownMs = now;
    }
    ```
    （`lastForwardDownMs` 是 `createInput` 閉包變數；`e.repeat` 的重複事件**不會觸發**疾跑，但**會刷新**時間戳——兩件事分開處理。2026-10-20 稽核修正：原片段把 `lastForwardDownMs = now` 放在 `if (!e.repeat)` 區塊內 → 自動重複完全不更新時間戳。）
  - Q：`onKeyDown` 內 `if (e.code === 'KeyQ' && !e.repeat) { state.dropRequest = true; state.dropWholeStack = state.sprint; state.dropHeld = true; }`（`state.sprint` 此時即「Ctrl 是否按住」，因為 `updateMove()` 每個 keydown 都重算；`state.sprint` 仍維持原語意＝Ctrl 按住）。`onKeyUp` 內 `if (e.code === 'KeyQ') state.dropHeld = false;`。
  - 右鍵：`onMouseDown` 內 `if (e.button === 2) { state.place = true; state.placeHeld = true; }`；`onMouseUp` 內補 `if (e.button === 2) state.placeHeld = false;`（既有 `onMouseUp` 只處理 button 0）。
  - `clearActive()`：補 `state.placeHeld = false; state.dropRequest = false; state.dropWholeStack = false; state.dropHeld = false; state.sprintToggle = false; lastForwardDownMs = null;`。
  - `consumeSprintToggle()`／`consumeDrop()`：讀取後清 flag（`consumeDrop` 回 `{ wholeStack: state.dropWholeStack }` 並同時清 `dropRequest` 與 `dropWholeStack`）。
  - 檔頭註解補一句：雙擊 W 的時間窗取自輸入事件的時間戳（非幀累加），失焦即失效。

- [ ] **Step 4: 跑測試轉綠**

  Run: `npx vitest run src/player/input.test.ts` → Expected: PASS（既有 **2** 個 describe 區塊——`Escape requests pause while locked`／`double-tap Space flight gate`——不動；本批只新增第三個 describe 區塊）。

- [ ] **Step 5: 全量驗證**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → Expected: 全綠。

- [ ] **Step 6: Commit**

  ```bash
  git add src/player/input.ts src/player/input.test.ts
  git commit -m "feat(input): B2 雙擊 W 疾跑請求、Q 丟棄脈衝與按住旗標"
  ```

---

### Task 3: 物理——撞牆夾角回報

**Files:**
- Modify: `src/player/physics.ts`（`stepPlayer` 約 L69-79、`stepOnce` 約 L81-148、`moveAxis` 約 L150-191）
- Modify: `src/player/physics.test.ts`（**只新增**案例，既有案例不動）

**Interfaces:**
- Consumes: Task 1 的 `SPRINT_WALL_ANGLE_DEG`（判定在 sprint.ts，物理只回報角度）。
- Produces:
  - `export interface StepResult { /** 本次步進的最大撞牆夾角（度）；無撞牆為 null */ wallAngleDeg: number | null }`
  - `export function stepPlayer(p: PlayerState, input: MoveInput, world: World, dt: number): StepResult`（**回傳值新增，既有呼叫端忽略回傳值即可，既有測試不必改**）。
  - `export function wallContactAngleDeg(dir: { x: number; z: number }, axis: 'x' | 'z'): number`（見下）。

- [ ] **Step 1: 寫測試（失敗）**

  - `'wallContactAngleDeg measures the angle between the movement and the wall face'`：
    ```ts
    // 語意：回傳「移動方向與『被擋住那面牆的表面』的夾角」→ 正面撞 = 90°、沿牆擦過 ≈ 0°
    // （wiki：「Sprinting ends when the player collides with a solid block at an angle of
    //   greater than 8 degrees」→ 正面撞（90°）取消疾跑、擦邊（<8°）不取消）。
    // 被擋的軸是 'z' → 取 |dir.z|：z 分量越大＝越「正面」撞上 z 方向的牆。
    expect(wallContactAngleDeg({ x: 0, z: -1 }, 'z')).toBeCloseTo(90, 5);           // 正面撞 → 90°（>8° → 取消疾跑）
    expect(wallContactAngleDeg({ x: 0.9987, z: -0.05 }, 'z')).toBeCloseTo(2.87, 1); // 擦邊（沿牆走）→ 2.87°（<8° → 不取消）
    expect(wallContactAngleDeg({ x: 0.7071, z: -0.7071 }, 'z')).toBeCloseTo(45, 1); // 斜撞 → 45°
    ```
    （2026-10-20 稽核修正：原向量寫成 `{ x: 0.05, z: -0.9987 }`，x／z 兩個分量被寫反了——它其實是「正面撞 z 牆」，按本 Task 的公式得 87.1°，與註解「擦邊 → <8°」相反。若實作者照著把它「修成 87°」就會把疾跑取消語意整個反轉（正面撞牆＝0°→不取消、擦邊反而取消）。公式不動、只把測試向量改成與公式一致的 `{ x: 0.9987, z: -0.05 }`。）
  - `'stepPlayer reports no wall angle on flat ground'`：用既有 `flatWorld()`，落地後 `stepPlayer(p, { ...groundInput, fwd: 1 }, w, 1/60)` → `expect(res.wallAngleDeg).toBeNull()`。
  - `'running head on into a wall reports 90 degrees'`：在 z=-2 造一面牆（既有測試有同款造牆程式碼），玩家前進直到撞牆：
    ```ts
    let res = { wallAngleDeg: null as number | null };
    for (let i = 0; i < 300 && res.wallAngleDeg === null; i++) {
      res = stepPlayer(p, { ...groundInput, fwd: 1 }, w, 1/60);
    }
    expect(res.wallAngleDeg).toBeCloseTo(90, 5);
    ```
  - `'a diagonal wall collision reports about 45 degrees'`：同一面牆，改用 `{ ...groundInput, fwd: 1, strafe: 1 }` → `expect(res.wallAngleDeg).toBeCloseTo(45, 0)`（容差 0.5 度）。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/player/physics.test.ts` → Expected: FAIL（`StepResult`／`wallContactAngleDeg` 不存在）。

- [ ] **Step 3: 實作 `src/player/physics.ts`**

  - `wallContactAngleDeg(dir, axis)`：`const c = Math.min(1, Math.abs(axis === 'x' ? dir.x : dir.z)); return (Math.asin(c) * 180) / Math.PI;`（非有限輸入回 0）。語意：**移動方向與「被擋住那面牆的表面」的夾角**——正面撞＝90°、沿牆擦過≈0°。（2026-10-20 稽核修正：本公式與 wiki 的 8° 語意一致，**不得**改寫成 `acos`——那會讓「正面撞牆＝0°（<8° → 不取消疾跑）、擦邊反而取消」，把疾跑取消語意整個反轉。測試向量已於 Step 1 修正為與公式一致。）
  - `moveAxis` 改為回傳 `boolean`（是否被碰撞擋下）；`stepOnce` 在 x／z 兩軸都走完後，收集「被擋住的軸」→ 對每個被擋軸算 `wallContactAngleDeg({ x: dirX, z: dirZ }, axis)` → 取**最大值**為該子步的撞牆夾角（兩軸都被擋＝撞到角落 → 角度大 → 疾跑取消）。
  - `stepPlayer` 跨子步取**最大**角度，沒有任何一軸被擋時回 `null`；回傳 `{ wallAngleDeg }`。
  - 注意：`dirX/dirZ` 是「正規化後的方向」（長度 ≤1），角度計算與速度無關；`dt` 非有限時維持既有 early-return（此時回 `{ wallAngleDeg: null }`）。
  - 檔頭註解補：夾角語意與 wiki「angle of greater than 8 degrees」的對應（8° 門檻在 sprint.ts 判定）。

- [ ] **Step 4: 跑測試轉綠**

  Run: `npx vitest run src/player/physics.test.ts` → Expected: PASS。

- [ ] **Step 5: 全量驗證**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → Expected: 全綠。

- [ ] **Step 6: Commit**

  ```bash
  git add src/player/physics.ts src/player/physics.test.ts
  git commit -m "feat(physics): B2.1 撞牆夾角回報（>8° 取消疾跑）"
  ```

---

### Task 4: 物理——潛行防摔邊

**Files:**
- Modify: `src/player/physics.ts`（`stepOnce` 約 L81-148、`moveAxis` 約 L150-191）
- Modify: `src/player/physics.test.ts`（**只新增**案例）

**Interfaces:**
- Consumes: `World.isSolid`（既有）。**不消費** `PLAYER_HALF_WIDTH`：本批的支撐判定只看「玩家中心點正下方一格」（見 Step 3 的簡化說明），半寬只有在原版那種「整個 hitbox 是否仍被支撐」的判定才會用到。（2026-10-20 稽核修正：原 Consumes 列了 `PLAYER_HALF_WIDTH`，但本 Task 的 `supportedAt` 與 `moveAxis` 都用不到它。）
- Produces:
  - `export function supportedAt(world: World, feetX: number, feetY: number, feetZ: number): boolean`（「腳下正下方」——玩家中心點往下 0.05 格那一格——是否為實心方塊；純查詢）。

- [ ] **Step 1: 寫測試（失敗）**

  測試世界（`World.setBlock` 會自動建 chunk）：

  ```ts
  function platformWorld(): World {
    const w = new World();
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) w.setBlock(x, 64, z, BLOCK.STONE);
    return w;
  }
  ```

  - `'sneaking keeps the player from walking off the edge'`：
    ```ts
    const w = platformWorld();
    const p = createPlayer(2.5, 65, 1.5);          // 站在 x=2 這塊板的右緣（中心點在板上）
    for (let i = 0; i < 60; i++) stepPlayer(p, { ...groundInput, sneak: true, strafe: 1 }, w, 1/60);
    expect(p.position.x).toBeLessThan(3.0);          // 中心點沒走出這塊板（身體可探出邊緣）
    expect(p.position.x).toBeGreaterThan(2.9);
    expect(p.position.y).toBeCloseTo(65, 5);        // 沒有掉下去
    expect(p.onGround).toBe(true);
    ```
  - `'walking without sneak falls off the edge'`：同 setup 去掉 `sneak` → 跑 60 幀後 `expect(p.position.y).toBeLessThan(64)`。
  - `'jumping while sneaking still leaves the edge'`：`sneak: true, strafe: 1, jump: true` → 起跳後保護解除，`expect(p.position.x).toBeGreaterThan(3.0)`（與上一條形成對照）。
  - `'supportedAt reports the platform and the void'`：`supportedAt(w, 1.5, 65, 1.5) === true`；`supportedAt(w, 3.5, 65, 1.5) === false`。

- [ ] **Step 2: 跑測試確認失敗**

  Run: `npx vitest run src/player/physics.test.ts` → Expected: FAIL（`supportedAt` 不存在、玩家會掉出平台）。

- [ ] **Step 3: 實作 `src/player/physics.ts`**

  - `supportedAt(world, feetX, feetY, feetZ)`：**只查「腳下正下方」一格**——`world.isSolid(floor(feetX), floor(feetY - 0.05), floor(feetZ))`（玩家中心點正下方）。非有限座標回 false。
  - `moveAxis` 對 x／z 軸：位移前先算候選位置；若「潛行保護開啟」且候選位置 `supportedAt === false` → **取消該軸位移**（直接 return，不改位置、不改速度）。
  - 潛行保護開啟條件：`input.sneak && p.onGround && !p.flying && !p.inWater`（著地才保護；起跳後可離開邊緣；水中不適用）。條件在 `stepOnce` 內計算後傳給 `moveAxis`（新增參數或以區域變數帶入）。
  - 檔頭註解補：語意對應 wiki「Players are prevented from walking off edges … as long as they are up to 0.6 blocks above the ground」與 spec §B2.3；標明本批的兩處簡化——① 只用「腳下正下方（中心點）」判定支撐（原版以 hitbox 支撐判定）；② 不做 step_height 0.6 的高度差判斷。

- [ ] **Step 4: 跑測試轉綠**

  Run: `npx vitest run src/player/physics.test.ts` → Expected: PASS。

- [ ] **Step 5: 全量驗證**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → Expected: 全綠。

- [ ] **Step 6: Commit**

  ```bash
  git add src/player/physics.ts src/player/physics.test.ts
  git commit -m "feat(physics): B2.3 潛行且著地時擋住走出邊緣的位移"
  ```

---

### Task 5: FOV 平滑模組

**Files:**
- Create: `src/core/fov.ts`、`src/core/fov.test.ts`

**Interfaces:**
- Consumes: 無。
- Produces:
  - `export const BASE_FOV = 70;`（對應 `src/render/scene.ts` 的 `new THREE.PerspectiveCamera(70, ...)`）
  - `export const SPRINT_FOV_RATIO = 0.10;`（疾跑 +10%）
  - `export const FOV_SMOOTH_SEC = 0.1;`（指數平滑時間常數）
  - `export function sprintFov(base: number = BASE_FOV): number`
  - `export function stepFov(current: number, target: number, dt: number): number`

- [ ] **Step 1: 寫測試（失敗）**

  - `'the sprint FOV is 10 percent above the base'`：`expect(sprintFov()).toBeCloseTo(77, 5)`；`expect(sprintFov(50)).toBeCloseTo(55, 5)`。
  - `'stepFov moves toward the target exponentially'`：`expect(stepFov(70, 77, 0.1)).toBeCloseTo(74.424, 2)`（`70 + 7·(1−e^{−1})`）。
  - `'stepFov ignores a non-finite or non-positive dt'`：`expect(stepFov(70, 77, 0)).toBe(70)`；`expect(stepFov(70, 77, NaN)).toBe(70)`；`expect(stepFov(70, 77, -1)).toBe(70)`。
  - `'stepFov converges to the target without overshooting'`：連續 60 次 `stepFov(v, 77, 1/60)` → `expect(v).toBeCloseTo(77, 3)`，且每一步 `v <= 77`。
  - `'stepFov returns to the base when the sprint ends'`：從 77 回到 70 → 單調遞減且 `toBeCloseTo(70, 3)`（同樣 60 步）。

- [ ] **Step 2: 跑測試確認失敗** — `npx vitest run src/core/fov.test.ts` → FAIL（模組不存在）。

- [ ] **Step 3: 實作 `src/core/fov.ts`**

  - `sprintFov(base)`：base 非有限 → 回 `BASE_FOV`；否則 `base * (1 + SPRINT_FOV_RATIO)`。
  - `stepFov(current, target, dt)`：dt 非有限或 ≤0 → 回 `current`；current／target 非有限 → 回 `BASE_FOV`（防 NaN 汙染相機）；否則 `current + (target - current) * (1 - Math.exp(-dt / FOV_SMOOTH_SEC))`。
  - 檔頭註解寫明 +10% 是**簡化值**（wiki 只說「expands slightly」，見計畫〈已查證與簡化決策〉§3）。

- [ ] **Step 4: 跑測試轉綠** — `npx vitest run src/core/fov.test.ts` → PASS。

- [ ] **Step 5: 全量驗證** — `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 6: Commit**

  ```bash
  git add src/core/fov.ts src/core/fov.test.ts
  git commit -m "feat(camera): B2.1 疾跑 FOV 加成與指數平滑（+10%）"
  ```

---

### Task 6: 三態視角姿態模組

**Files:**
- Create: `src/core/view-mode.ts`、`src/core/view-mode.test.ts`

**Interfaces:**
- Consumes: 無。
- Produces:
  - `export type ViewMode = 'first' | 'back' | 'front';`
  - `export const VIEW_MODE_ORDER: readonly ViewMode[] = ['first', 'back', 'front'];`
  - `export const THIRD_PERSON_DISTANCE = 4;`
  - `export const THIRD_PERSON_HEIGHT_OFFSET = 0.5;`
  - `export function nextViewMode(mode: ViewMode): ViewMode`
  - `export interface ViewPose { pos: { x: number; y: number; z: number }; yaw: number; pitch: number }`
  - `export function viewPose(mode: ViewMode, eye: { x: number; y: number; z: number }, yaw: number, pitch: number): ViewPose`

- [ ] **Step 1: 寫測試（失敗）**

  - `'the view mode cycles first to back to front to first'`：`nextViewMode('first') === 'back'`、`nextViewMode('back') === 'front'`、`nextViewMode('front') === 'first'`。
  - `'the first person pose is the eye with the player angles'`：`viewPose('first', { x: 1, y: 2, z: 3 }, 0.5, -0.2)` → `pos` 等於 eye、`yaw === 0.5`、`pitch === -0.2`。
  - `'the back view places the camera behind the player'`：yaw=0（前方＝−z）→ `expect(pose.pos.z).toBeCloseTo(eye.z + 4)`、`expect(pose.pos.x).toBeCloseTo(eye.x)`、`expect(pose.pos.y).toBeCloseTo(eye.y + 0.5)`、`expect(pose.yaw).toBe(0)`。
  - `'the front view places the camera in front and turns it around'`：yaw=0 → `expect(pose.pos.z).toBeCloseTo(eye.z - 4)`、`expect(pose.yaw).toBeCloseTo(Math.PI, 10)`。
  - `'the camera distance is 4 blocks in both third person modes'`：`expect(Math.hypot(poseBack.pos.x - eye.x, poseBack.pos.z - eye.z)).toBeCloseTo(4, 6)`（front 同）。

- [ ] **Step 2: 跑測試確認失敗** — `npx vitest run src/core/view-mode.test.ts` → FAIL。

- [ ] **Step 3: 實作 `src/core/view-mode.ts`**

  - 前方水平方向 `fx = -sin(yaw)`、`fz = -cos(yaw)`（沿用 `src/player/physics.ts` 的 yaw 慣例：yaw=0 面向 −z）。
  - `back`：`pos = eye + (-fx, 0, -fz) * 4 + (0, 0.5, 0)`、`yaw` 保持、`pitch` 保持。
  - `front`：`pos = eye + (fx, 0, fz) * 4 + (0, 0.5, 0)`、`yaw = yaw + π`、`pitch` 保持。
  - `first`：`pos = eye`、`yaw`、`pitch` 原值。
  - 非有限輸入（eye／yaw／pitch）→ 視為 0（防 NaN）。
  - 檔頭註解寫明：面後相機在**後方**（+z 方向），面前視角相機 yaw 反轉 180°，與 wiki「third person from the front」一致；互動射線一律以本模組回傳的姿態為準。

- [ ] **Step 4: 跑測試轉綠** — `npx vitest run src/core/view-mode.test.ts` → PASS。

- [ ] **Step 5: 全量驗證** — `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 6: Commit**

  ```bash
  git add src/core/view-mode.ts src/core/view-mode.test.ts
  git commit -m "feat(camera): B2.4 F5 三態視角與相機姿態（面前視角 yaw 反轉）"
  ```

---

### Task 7: 按住連放／連丟節拍模組

**Files:**
- Create: `src/player/hold-repeat.ts`、`src/player/hold-repeat.test.ts`

**Interfaces:**
- Consumes: 無。
- Produces:
  - `export const PLACE_REPEAT_SEC = 0.2;`（4 tick）
  - `export const DROP_REPEAT_SEC = 0.2;`
  - `export interface RepeatState { acc: number }`
  - `export function createRepeatState(): RepeatState`
  - `export interface RepeatStep { state: RepeatState; fired: boolean }`
  - `export function stepRepeat(state: RepeatState, held: boolean, dt: number, intervalSec: number): RepeatStep`

- [ ] **Step 1: 寫測試（失敗）**

  - `'the repeat does not fire before the interval elapses'`：`stepRepeat(createRepeatState(), true, 0.1, 0.2).fired === false`；再 `stepRepeat(prev.state, true, 0.1, 0.2).fired === true`。
  - `'the repeat fires at most once per call'`：`stepRepeat(createRepeatState(), true, 5, 0.2).fired === true`（且 `state.acc` 為 `5 - 0.2` 的餘數，不是 0）。
  - `'releasing the button resets the accumulator'`：連按兩次到 fired 之後 `stepRepeat(state, false, 0.1, 0.2)` → `state.acc === 0`、`fired === false`。
  - `'a non-finite dt never fires and never corrupts the accumulator'`：`stepRepeat(createRepeatState(), true, NaN, 0.2)` → `fired === false`、`acc === 0`。
  - `'the constants are 0.2 seconds'`：`expect(PLACE_REPEAT_SEC).toBe(0.2)`、`expect(DROP_REPEAT_SEC).toBe(0.2)`。

- [ ] **Step 2: 跑測試確認失敗** — `npx vitest run src/player/hold-repeat.test.ts` → FAIL。

- [ ] **Step 3: 實作 `src/player/hold-repeat.ts`**

  - `stepRepeat(state, held, dt, intervalSec)`：`held === false` → 回 `{ state: { acc: 0 }, fired: false }`；否則 `acc = state.acc + (dt 有限且 > 0 ? dt : 0)`；`acc >= intervalSec` → `fired = true`、`acc -= intervalSec`（**一次只扣一個間隔**，剩餘留給下一幀，避免單幀爆放）；否則 `fired = false`。回傳全新 `RepeatState`（不修改入參）。

- [ ] **Step 4: 跑測試轉綠** — `npx vitest run src/player/hold-repeat.test.ts` → PASS。

- [ ] **Step 5: 全量驗證** — `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 6: Commit**

  ```bash
  git add src/player/hold-repeat.ts src/player/hold-repeat.test.ts
  git commit -m "feat(input): B2.2/B2.5 按住連放／連丟節拍（0.2 秒）"
  ```

---

### Task 8: 無動畫方塊人玩家模型

**Files:**
- Create: `src/render/player-model.ts`、`src/render/player-model.test.ts`

**Interfaces:**
- Consumes: 無（不 import `ui/`；材質為純色，不需紋理陣列）。
- Produces:
  - `export interface PlayerModel { group: THREE.Group; setPose(feet: { x: number; y: number; z: number }, yaw: number): void; setVisible(visible: boolean): void; dispose(): void }`
  - `export function createPlayerModel(scene: THREE.Scene): PlayerModel`

- [ ] **Step 1: 寫測試（失敗）**（jsdom 建真 Three 物件，比照 `src/render/scene.test.ts` 的做法）

  - `'the model is added to the scene with a head, a body, arms and legs'`：
    ```ts
    const scene = new THREE.Scene();
    const model = createPlayerModel(scene);
    expect(scene.children).toHaveLength(1);
    const g = scene.children[0] as THREE.Group;
    expect(g.getObjectByName('head')).toBeInstanceOf(THREE.Mesh);
    expect(g.getObjectByName('body')).toBeInstanceOf(THREE.Mesh);
    expect(g.getObjectByName('armL')).toBeInstanceOf(THREE.Mesh);
    expect(g.getObjectByName('armR')).toBeInstanceOf(THREE.Mesh);
    expect(g.getObjectByName('legL')).toBeInstanceOf(THREE.Mesh);
    expect(g.getObjectByName('legR')).toBeInstanceOf(THREE.Mesh);
    ```
  - `'the model is 1.8 blocks tall like the player hitbox'`：`expect(g.scale.y).toBeCloseTo(0.9, 6)`（模型原高 2.0 block × 0.9）。
  - `'the model has no animated parts'`：走訪 `g`，斷言**沒有**任何 `name` 為 `legL`／`legR` 的物件是 `THREE.Group`（肢體是靜態 Mesh，不是可旋轉的樞紐 group），且模型沒有 `skeleton`／`animation` 屬性（`expect((g as any).animations).toBeUndefined()`）。
  - `'setPose moves the model to the feet and turns it to the player yaw'`：`model.setPose({ x: 1, y: 65, z: 2 }, Math.PI / 2)` → `expect(g.position.y).toBe(65)`、`expect(g.rotation.y).toBeCloseTo(Math.PI / 2, 10)`。
  - `'setVisible toggles the whole group'`：`model.setVisible(false)` → `expect(g.visible).toBe(false)`；`setVisible(true)` → `true`。
  - `'dispose removes the model from the scene'`：`model.dispose()` → `expect(scene.children).toHaveLength(0)`。

- [ ] **Step 2: 跑測試確認失敗** — `npx vitest run src/render/player-model.test.ts` → FAIL。

- [ ] **Step 3: 實作 `src/render/player-model.ts`**

  - 幾何與比例（比照 `src/render/scene.ts` 的生物模型，讓玩家模型與 1.8 格高的 hitbox 對齊）：
    | 部位 | 尺寸 | 位置（模型本地座標，未縮放） | 顏色 |
    |---|---|---|---|
    | head | 0.5×0.5×0.5 | y 1.5–2.0 | 0xc9915f（膚色） |
    | face（貼片） | 0.4×0.25×0.02 | 頭的 −z 面：**z = −(0.25 + 0.01) = −0.26**、y = 1.75 | 0x2b1d12 |
    | body | 0.5×0.75×0.25 | y 0.75–1.5 | 0x3f6fb5 |
    | armL／armR | 0.25×0.75×0.25 | x = ±0.375、y 0.75–1.5 | 0xc9915f |
    | legL／legR | 0.25×0.75×0.25 | x = ±0.125、y 0–0.75 | 0x35415c |
    （2026-10-20 稽核修正：臉部貼片原本只寫「頭的 −z 面、y ≈ 1.7」——沒給 z 座標，實作者可能把貼片放進頭裡造成 z-fighting；此處釘死 z = −0.26（頭的半深 0.25 ＋ 0.01 的浮出量）、y = 1.75。）
  - `group.scale.setScalar(0.9)`（總高 1.8）；`group.name = 'player'`；材質用 `THREE.MeshLambertMaterial` 純色（沿用 `MOB_PALETTE` 的扁平調色盤風格；**不**貼圖、不進紋理陣列）；`castShadow = true`（與生物一致）。
  - 臉部貼片朝 **−z**（yaw=0 時的前方）——與 `src/player/physics.ts` 的 yaw 慣例一致，讓「面前視角」看得到正面。
  - `setPose(feet, yaw)`：`group.position.set(feet.x, feet.y, feet.z)`；`group.rotation.y = yaw`。
  - `setVisible(v)`：`group.visible = v`。
  - `dispose()`：移除 group、dispose 幾何與材質。
  - 檔頭註解寫明：**無動畫**（無行走循環）、只在面後／面前視角顯示、第一人稱隱藏、純渲染不影響碰撞與效能（**6 個盒子 × 12 三角形 = 72 三角形，加 1 個臉部貼片（PlaneGeometry）= 2 三角形，合計 74 三角形**）。（2026-10-20 稽核修正：原寫「6 個盒子、36 三角形」，與同表的部位表（頭／貼片／身／2 手臂／2 腿＝7 個部位）與 BoxGeometry 每盒 12 三角形都不符。）

- [ ] **Step 4: 跑測試轉綠** — `npx vitest run src/render/player-model.test.ts` → PASS。

- [ ] **Step 5: 全量驗證** — `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 6: Commit**

  ```bash
  git add src/render/player-model.ts src/render/player-model.test.ts
  git commit -m "feat(render): B2.4 無動畫方塊人玩家模型（面後／面前視角）"
  ```

---

### Task 9: main.ts 接線——疾跑狀態機、FOV、消耗

**Files:**
- Modify: `src/main.ts`（import 區約 L24-39；玩家狀態約 L187-210；主迴圈 `state === 'playing'` 區約 L1818-1993；相機區約 L2028-2058）

**Interfaces:**
- Consumes: Task 1 的 `createSprintState`／`updateSprint`；Task 2 的 `input.consumeSprintToggle()`／`input.state.sprint`；Task 3 的 `stepPlayer` 回傳值；Task 5 的 `BASE_FOV`／`sprintFov`／`stepFov`；B1 的 `EXHAUST_SPRINT_PER_METER`／`EXHAUST_SPRINT_JUMP`（既有 import，不新增常數）。
- Produces:
  - `src/main.ts` 內 `let sprintState = createSprintState();`、`let fovCurrent = BASE_FOV;`、`let lastWallAngleDeg: number | null = null;`、`let attackedThisFrame = false;`
  - **probe 用唯讀 debug hook**（Task 13 的 Playwright 驗收需要讀取狀態；唯讀、不改變任何行為）：
    ```ts
    window.__wecraft = {
      sprint: () => sprintState.active,
      fov: () => gs.camera.fov,
      hunger: () => (vitals ? vitals.hunger : null),   // 創造模式為 null
      pos: () => ({ x: player.position.x, y: player.position.y, z: player.position.z }),
      hotbar: () => hotbar.map((s) => (s ? { item: s.item, count: s.count } : null)),
      drops: () => drops.length,
      modified: () => world.modified.size,
    };
    ```
    （`window.__wecraft` 的型別宣告放在 `src/main.ts` 頂部 `declare global` 區；若專案 lint 不允許 `any`，用 `interface WecraftDebug { … }` 明確列出欄位。Task 11 會再補 `viewMode: () => viewMode` 欄位。）

- [ ] **Step 1: 接線（無單元測試——`main.ts` 是組裝根；本任務以人工步驟佐證）**

  1. import：`createSprintState`、`updateSprint`（`./player/sprint`）；`BASE_FOV`、`sprintFov`、`stepFov`（`./core/fov`）。
     **注意語意**：`input.state.sprint` 的語意**不變**（仍＝「Ctrl 是否按住」，Task 2 未改它）；**有效疾跑**一律看 `sprintState.active`。
  2. 狀態：`let sprintState = createSprintState();`、`let fovCurrent = BASE_FOV;`、`let lastWallAngleDeg: number | null = null;`、`let attackedThisFrame = false;`
  3. **每幀順序（`state === 'playing'` 區塊內，必須在 `stepPlayer` 與 `jumpStarted` 計算之前）**：
     ```ts
     // 疾跑狀態機：吃本幀的雙擊 W 請求 + 上一幀的撞牆夾角 + 上一幀的攻擊結果
     sprintState = updateSprint(sprintState, {
       forward: input.state.fwd > 0,
       sneak: input.state.sneak,
       ctrlHeld: input.state.sprint,
       sprintRequested: input.consumeSprintToggle(),
       hunger: vitals ? vitals.hunger : null,   // 創造模式 vitals 為 null → 無飢餓門檻
       flying: player.flying,
       inWater: player.inWater,
       wallAngleDeg: lastWallAngleDeg,
       attacked: attackedThisFrame,
     });
     attackedThisFrame = false;   // 一次性：下一幀才會用到
     ```
  4. 物理呼叫改為帶回傳值（**有效疾跑旗標走這裡**，不再是 `input.state.sprint`）：
     ```ts
     const moveInput: MoveInput = {
       fwd: input.state.fwd, strafe: input.state.strafe, jump: input.state.jump,
       sneak: input.state.sneak, sprint: sprintState.active,
       fly: input.state.fly, flyUp: input.state.flyUp, flyDown: input.state.flyDown,
     };
     const step = stepPlayer(player, moveInput, world, dt);
     lastWallAngleDeg = step.wallAngleDeg;
     ```
     （`MoveInput` 型別自 `./player/physics` import。）
  5. 消耗（既有兩段，約 L1977-1983）：`input.state.sprint` → `sprintState.active`（疾跑消耗與疾跑跳消耗兩處都要換）。
  6. 攻擊（既有攻擊分支，命中時 `atk.hitId !== null`）：在同一處設 `attackedThisFrame = true;`（攻擊命中取消疾跑；下一幀的狀態機讀到它）。
  7. FOV（在相機區之後）：`const fovTarget = sprintState.active ? sprintFov() : BASE_FOV;` → `fovCurrent = stepFov(fovCurrent, fovTarget, dt);` → `if (Math.abs(gs.camera.fov - fovCurrent) > 0.01) { gs.camera.fov = fovCurrent; gs.camera.updateProjectionMatrix(); }`
  8. 新局／讀檔進入（`startGame()`／`continueGame()`／`continueFromCloud()`）時：`sprintState = createSprintState(); fovCurrent = BASE_FOV; gs.camera.fov = BASE_FOV; gs.camera.updateProjectionMatrix();`
  9. 模式切換（`mode-changed` handler）：`sprintState = createSprintState();`（避免跨模式殘留鎖存）。
  10. 視窗失焦／指標解鎖：`input.clearActive()`（input.ts 既有）已清掉輸入層的 `sprintToggle`；此處不需額外處理（`updateSprint` 每幀重算）。
  11. `window.__wecraft` hook：放在 `hud.setHotbar(hotbar, selected);`（約 L1745）之後，註解說明「僅供 Playwright 驗收讀取，唯讀」。

- [ ] **Step 2: 人工驗證（記錄結果）**

  `npm run dev` → 生存模式：
  - 雙擊 W → 速度變快、FOV 由 70 變 77（`window.__wecraft.fov()` 觀察），放開 W → 速度與 FOV 回復。
  - 按住 Ctrl → 疾跑（瀏覽器若攔截 Ctrl+W 屬預期，見 Task 13 的未驗證清單）。
  - 單擊 W（不雙擊）→ 不疾跑。
  - 疾跑中撞牆 → 停止疾跑（`window.__wecraft.sprint() === false`）。
  - 疾跑中潛行（Shift）→ 停止疾跑。
  - 疾跑中放開 W → 停止疾跑。
  - 飢餓門檻（≤6 取消）：**人工無法可靠觸發**（repo 沒有指令系統、沒有 `/eat`；飢餓自然下降要數分鐘）→ **以 Task 1 的單元測試為唯一依據**（`hunger 6` 取消、`hunger 7` 可開始）。人工只確認「沒有把飢餓門檻接錯到 Ctrl 上」：飢餓充足時按住 Ctrl → `window.__wecraft.sprint() === true` 且 `window.__wecraft.hunger()` 明顯 > 6；本項在回報中標為「人工未驗證（飢餓門檻）」。（2026-10-20 稽核修正：原步驟寫「可用 `/eat`？本批無指令；改用觀察」——自問自答且沒有可執行動作，已刪除該寫法。）

- [ ] **Step 3: 全量驗證** — `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 4: Commit**

  ```bash
  git add src/main.ts
  git commit -m "feat(sprint): B2.1 接上疾跑狀態機、FOV 加成與疾跑消耗"
  ```

---

### Task 10: main.ts 接線——放置連放、Q 丟棄

**Files:**
- Modify: `src/main.ts`（放置區約 L2233-2291；掉落相關 import 約 L56；玩家狀態區約 L206-210）
- Modify: `src/world/drops.ts`（`spawnDrop` 約 L63-84；常數區約 L9-18）
- Modify: `src/world/drops.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `input.state.placeHeld`／`input.state.dropHeld`／`input.consumeDrop()`；Task 7 的 `stepRepeat`／`PLACE_REPEAT_SEC`／`DROP_REPEAT_SEC`；既有 `spawnDrop`／`spendFromSlot`／`hud.setHotbar`。
- Produces:
  - `src/world/drops.ts`：`export const PLAYER_DROP_PICKUP_DELAY = 2;`（40 tick）
  - `src/world/drops.ts`：`spawnDrop(drops, item, count, pos, opts?)` 新增可選第 5 參數：
    ```ts
    export interface SpawnDropOptions {
      /** 拾取延遲秒數；預設 SPAWN_PICKUP_DELAY（0.5） */
      pickupDelay?: number;
      /** 初速度；預設 { 隨機 ±1.5 的水平速度, y = +3 } */
      vel?: { x: number; y: number; z: number };
    }
    ```
    （既有呼叫端 `spawnBlockDrop`（`src/player/interact.ts`）與 main.ts 的掉落呼叫**不必改**——預設行為完全不變。）
  - `src/main.ts`：`let placeRepeat = createRepeatState();`、`let dropRepeat = createRepeatState();` 與一個 `dropSelected(wholeStack: boolean): boolean` 內部函式。

- [ ] **Step 1: `drops.ts` 的測試（失敗）**（`src/world/drops.test.ts` 追加）

  - `'spawnDrop accepts a custom pickup delay'`：`spawnDrop([], 'dirt', 1, { x: 0, y: 0, z: 0 }, { pickupDelay: 2 })[0].pickupDelay === 2`。
  - `'spawnDrop accepts a custom velocity'`：`spawnDrop([], 'dirt', 1, { x: 0, y: 0, z: 0 }, { vel: { x: 1, y: 2, z: 3 } })[0].vel` → `toEqual({ x: 1, y: 2, z: 3 })`。
  - `'spawnDrop keeps its default delay and pop when no options are given'`：`spawnDrop([], 'dirt', 1, pos)[0].pickupDelay === SPAWN_PICKUP_DELAY`（既有常數 0.5）。

- [ ] **Step 2: 跑測試確認失敗** — `npx vitest run src/world/drops.test.ts` → FAIL（第 5 參數尚未支援）。

- [ ] **Step 3: 實作 `drops.ts`**

  - `spawnDrop` 改簽名為 `(drops, item, count, pos, opts: SpawnDropOptions = {})`；`pickupDelay: opts.pickupDelay ?? SPAWN_PICKUP_DELAY`；`vel: opts.vel ? { ...opts.vel } : { x: Math.random() * 3 - 1.5, y: 3, z: Math.random() * 3 - 1.5 }`（**複製**，不引用呼叫端物件）。
  - 新增 `export const PLAYER_DROP_PICKUP_DELAY = 2;`（40 tick）並註明出處（wiki Item (entity)：玩家丟出的物品 40 tick 不可拾取）。

- [ ] **Step 4: 跑測試轉綠** — `npx vitest run src/world/drops.test.ts` → PASS。

- [ ] **Step 5: main.ts 接線**

  1. import：`stepRepeat`、`createRepeatState`、`PLACE_REPEAT_SEC`、`DROP_REPEAT_SEC`（`./player/hold-repeat`）；`PLAYER_DROP_PICKUP_DELAY`（`./world/drops`）。
  2. 狀態：`let placeRepeat = createRepeatState(); let dropRepeat = createRepeatState();`
  3. **放置流程拆成兩段**（既有約 L2233-2291）：
     - 既有 `const wantPlace = input.consumePlace();` 的完整「使用」流程**維持不變**（開工作台／開熔爐／吃蘋果／放方塊），但把「放方塊」那一段抽成可重複呼叫的本地函式：
       ```ts
       function tryPlaceBlock(target: RayHit): boolean {
         const t = placeTarget(target);
         const held = hotbar[selected];
         const placeId = held ? blockFromItem(held.item) : null;
         if (placeId === null || !canPlaceAt(world, t.x, t.y, t.z, player.position)) return false;
         if (!inventory.spendFromSlot(selected, 1)) return false;
         world.setBlock(t.x, t.y, t.z, placeId);
         hud.setHotbar(hotbar, selected);
         audio.play('place', materialGroup(placeId), { pos: { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 } });
         return true;
       }
       ```
       （音效語意與既有放置一致；`viewmodel.startSwing()` 留在「首次使用」路徑，連放**不**再揮手，避免每 0.2 秒揮一次。）
     - 連放路徑（緊接既有流程之後）：
       ```ts
       const placeStep = stepRepeat(placeRepeat, input.state.placeHeld, dt, PLACE_REPEAT_SEC);
       placeRepeat = placeStep.state;
       if (placeStep.fired && hit) tryPlaceBlock(hit);
       ```
       （`hit` 為本幀的方塊射線結果；沒有命中就不放。）
  4. **Q 丟棄**（放在 `state === 'playing'` 分支內，緊接放置流程之後）：
     ```ts
     function dropSelected(wholeStack: boolean): boolean {
       if (currentMode === 'creative') return false;      // 創造模式不丟棄（簡化，README 記錄）
       const stack = hotbar[selected];
       if (!stack || stack.count < 1) return false;
       const count = wholeStack ? stack.count : 1;
       if (!inventory.spendFromSlot(selected, count)) return false;
       const fx = -Math.sin(player.yaw);
       const fz = -Math.cos(player.yaw);
       drops = spawnDrop(drops, stack.item, count, {
         x: player.position.x + fx * 0.5,
         y: player.position.y + 1.0,
         z: player.position.z + fz * 0.5,
       }, {
         pickupDelay: PLAYER_DROP_PICKUP_DELAY,
         vel: { x: fx * 2.5, y: 1.5, z: fz * 2.5 },
       });
       hud.setHotbar(hotbar, selected);
       return true;
     }
     ```
     接線：
     ```ts
     const dropReq = input.consumeDrop();
     if (dropReq) dropSelected(dropReq.wholeStack);
     const dropStep = stepRepeat(dropRepeat, input.state.dropHeld, dt, DROP_REPEAT_SEC);
     dropRepeat = dropStep.state;
     if (dropStep.fired) dropSelected(input.state.sprint);   // 按住 Ctrl 時連丟整疊
     ```
     （`input.state.sprint` ＝Ctrl 是否按住。）
  5. 註解補上 wiki 依據（Q 單個／Ctrl+Q 整疊／長按連丟節奏 0.2 s／玩家丟出 2 秒不可拾）。

- [ ] **Step 6: 人工驗證（記錄結果）**

  - 生存模式：右鍵長按 1 秒 → 連續放置多個方塊（`window.__wecraft.hotbar()` 的數量減少多格），放開即停；滑鼠解鎖（Esc）後不再放置。
  - 右鍵點工作台 → 開啟 3×3 介面（**不會**因長按而反覆開啟）。
  - 手持蘋果右鍵 → 只吃一次（長按不連續吃）。
  - Q → 熱鍵欄數量 −1，地上出現掉落物；2 秒內走過去撿不起（`pickupDelay`），超過 2 秒可撿回。
  - Ctrl+Q → 整疊一次丟完。
  - 按住 Q 約 1 秒 → 連續丟多個。

- [ ] **Step 7: 全量驗證** — `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 8: Commit**

  ```bash
  git add src/main.ts src/world/drops.ts src/world/drops.test.ts
  git commit -m "feat(interaction): B2.2/B2.5 放置連放與 Q 丟棄（單個／整疊／連丟）"
  ```

---

### Task 11: main.ts 接線——三態視角與玩家模型

**Files:**
- Modify: `src/main.ts`（相機區約 L2028-2058；F5 切換約 L2295；viewmodel 可見性約 L2386-2390）

**Interfaces:**
- Consumes: Task 6 的 `nextViewMode`／`viewPose`／`THIRD_PERSON_DISTANCE`；Task 8 的 `createPlayerModel`。
- Produces: `src/main.ts` 內 `let viewMode: ViewMode = 'first';` 與 `const playerModel = createPlayerModel(gs.scene);`

- [ ] **Step 1: 接線**（無單元測試——`main.ts` 是組裝根；本任務以人工步驟佐證，與 Task 9／Task 10 同理。**規則本身由 Task 6／Task 8 的單元測試守住**，這裡只做接線）

  1. import：`nextViewMode`、`viewPose`、`THIRD_PERSON_DISTANCE`（`./core/view-mode`）；`createPlayerModel`（`./render/player-model`）。
  2. 狀態：`let viewMode: ViewMode = 'first';`（取代既有的 `let thirdPerson = false;`——**移除**該變數與所有引用）。
  3. 建立模型：`const playerModel = createPlayerModel(gs.scene);`（與 `viewmodel`／`mobRenderer` 同區）。
  4. 相機（既有約 L2028-2040）改為：
     ```ts
     const eye = { x: player.position.x, y: player.position.y + EYE_HEIGHT, z: player.position.z };
     const pose = viewPose(viewMode, eye, player.yaw, player.pitch);
     gs.camera.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
     gs.camera.rotation.order = 'YXZ';
     gs.camera.rotation.y = pose.yaw;
     gs.camera.rotation.x = pose.pitch;
     gs.camera.rotation.z = 0;
     ```
   5. **互動射線一律用相機姿態**（既有約 L2042-2058）：
     ```ts
     const dir = {
       x: -Math.sin(pose.yaw) * Math.cos(pose.pitch),
       y: Math.sin(pose.pitch),
       z: -Math.cos(pose.yaw) * Math.cos(pose.pitch),
     };
     const rayOrigin = { x: gs.camera.position.x, y: gs.camera.position.y, z: gs.camera.position.z };
     const back = viewMode === 'first' ? 0 : THIRD_PERSON_DISTANCE;
     const reach = reachFor(currentMode) + back;
     const hit = raycast(world, rayOrigin, dir, reach);
     const meleeReach = MELEE_REACH + back;
     ```
     （第一人稱時 `rayOrigin` 就是眼睛位置，與既有行為等價；面前視角時 `pose.yaw = player.yaw + π`，射線因而朝玩家背後方向——與相機實際視線一致。）
  6. F5（既有約 L2295）：`if (input.consumeToggleView()) viewMode = nextViewMode(viewMode);`
  7. 玩家模型（渲染尾段，與 viewmodel 更新同一區）：`playerModel.setPose(player.position, player.yaw); playerModel.setVisible(state === 'playing' && viewMode !== 'first');`
  8. 第一人稱手持模型（既有約 L2386-2390）的可見條件改為 `state === 'playing' && viewMode === 'first'`。
  9. 非 playing 狀態（暫停／背包／死亡／標題）一律 `playerModel.setVisible(false)`。
  10. `window.__wecraft` 補上 `viewMode: () => viewMode,`（Task 9 已建立該物件）。
  11. 註解補：面前視角 yaw 反轉、面後相機在後方（修正既有「相機放在前方」的 bug）。

- [ ] **Step 2: 人工驗證（記錄結果）**

  - F5 依序：第一人稱 → 面後（相機在玩家**後方**）→ 面前（看得到玩家正面與臉部貼片）→ 第一人稱。
  - 三態下挖掘／放置都對準準心指向的方塊（面前視角的射線方向與畫面一致）。
  - 第一人稱看不到自己的模型；面後／面前看得到；暫停時看不見。
  - 面後視角挖方塊的掉落物仍落在被挖的方塊位置。

- [ ] **Step 3: 全量驗證** — `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 4: Commit**

  ```bash
  git add src/main.ts
  git commit -m "feat(camera): B2.4 三態視角接線與方塊人玩家模型"
  ```

---

### Task 12: 暫停選單操作提示

**Files:**
- Modify: `src/ui/menus.ts`（`showPause` 的 `renderPause`，約 L266-310）
- Modify: `src/ui/ui.css`（新增 `.ui-hint` 樣式）
- Modify: `src/ui/ui.test.ts`（**只新增**案例）

**Interfaces:**
- Consumes: 無。
- Produces: `showPause` 的面板多一行 `.ui-hint` 說明文字（純 DOM，無回呼）。

- [ ] **Step 1: 寫測試（失敗）**（`src/ui/ui.test.ts` 追加）

  - 寫法比照既有暫停選單測試（`src/ui/ui.test.ts` 的 `describe('pause menu')`）：`const root = document.getElementById('ui-root')!; const menus = createMenus(root); menus.showPause({ onResume, onQuit: () => {}, onToggleMode: () => {}, onToggleShadows: () => {}, onToggleClouds: () => {}, onSaveQuit: () => {}, cloudStatus: 'guest', cloudRetryable: false, onRetryCloud: () => {} });`——**用 `root` 讀內容，不要引用不存在的 `overlay` 變數**。
  - `'the pause menu lists the new control hints'`：`const hint = root.querySelector('.ui-hint')!; expect(hint).not.toBeNull(); expect(hint.textContent).toContain('雙擊 W'); expect(hint.textContent).toContain('Ctrl+Q'); expect(hint.textContent).toContain('F5'); expect(hint.textContent).toContain('右鍵');`
  - `'the hint mentions that ctrl may be swallowed by the browser'`：`expect(hint.textContent).toContain('Ctrl+W'); expect(hint.textContent).toContain('瀏覽器保留鍵');`
    （2026-10-20 稽核修正：原寫法引用了**未定義的 `overlay` 變數**（既有暫停選單測試讀的是 `root.textContent`），且 `toContain('Q')`／`toContain('F5')` 屬過弱子字串斷言（任何含 Q 的字串都會命中）→ 改成對 `.ui-hint` 元素斷言完整關鍵片語。）

- [ ] **Step 2: 跑測試確認失敗** — `npx vitest run src/ui/ui.test.ts` → FAIL。

- [ ] **Step 3: 實作**

  - `renderPause()` 的按鈕群之後、`cloudRow()` 之前插入一行：
    ```ts
    const hint = document.createElement('div');
    hint.className = 'ui-hint';
    hint.textContent =
      '操作：雙擊 W 疾跑（Ctrl 也能疾跑，但 Ctrl+W 是瀏覽器保留鍵，可能被瀏覽器吃掉）｜Q 丟棄 1 個、Ctrl+Q 丟整疊｜右鍵長按連續放置｜F5 切換第一人稱／面後／面前視角';
    ```
    （文案須含「雙擊 W」「Ctrl」「瀏覽器」「Q」「F5」五個關鍵字，以符合 Step 1 的斷言。）
  - `src/ui/ui.css` 加 `.ui-hint { ... }`（置中、小字、透明度 0.75、最大寬度 34rem、margin 6px auto 0；`pointer-events: none`）。

- [ ] **Step 4: 跑測試轉綠** — `npx vitest run src/ui/ui.test.ts` → PASS。

- [ ] **Step 5: 全量驗證** — `npm run typecheck && npm test && npm run build && npm run lint` → 全綠。

- [ ] **Step 6: Commit**

  ```bash
  git add src/ui/menus.ts src/ui/ui.css src/ui/ui.test.ts
  git commit -m "feat(ui): B2 暫停選單加上操作提示（雙擊 W／Q／連放／三態視角）"
  ```

---

### Task 13: 批末 Playwright 真實瀏覽器驗收

**Files:**
- 不寫入 repo（probe 放 repo 外：`/tmp/opencode/wecraft-b2-probe/`）。本任務**不 commit 任何檔案**，只把驗收結果寫進 Task 14 的發布說明與 commit 訊息。

**Interfaces:**
- Consumes: Task 9 的 `window.__wecraft` 唯讀 hook；`dist/`（`npm run build` 產物）。
- Produces: 驗收紀錄（貼進 `docs/releases/v0.5.0.md` 的〈已知問題〉與本任務的回報）。

- [ ] **Step 1: 準備環境（全部在 repo 外）**

  ```bash
  mkdir -p /tmp/opencode/wecraft-b2-probe
  cd /tmp/opencode/wecraft-b2-probe
  npm init -y && npm i playwright-core     # 不動 repo 的 node_modules
  # Chromium（已在本機快取）：/home/tommy/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome
  ```
  靜態伺服（在 repo 外啟動，只服務 dist/）：
  ```bash
  python3 -m http.server 8123 --directory /home/tommy/WeCraft/dist
  ```

- [ ] **Step 2: 寫 probe 腳本 `/tmp/opencode/wecraft-b2-probe/probe.mjs`**

  以 `playwright-core` 的 `chromium.launch({ executablePath: <上面的 chrome 路徑>, headless: false, args: ['--no-sandbox'] })` 啟動；逐項斷言（**每項都要印出 PASS／FAIL 與實際值**）：

  1. **載入與指標鎖**：開 `http://127.0.0.1:8123/index.html` → 點標題畫面的「單人遊戲」→ 點畫布 → `await page.evaluate(() => document.pointerLockElement?.id === 'game-canvas')` 為 true。
  2. **Esc**：按 `Escape` → 指標鎖釋放（`document.pointerLockElement === null`）且畫面出現暫停選單（`.ui-overlay` 存在、含「遊戲已暫停」）。再點「繼續遊戲」恢復鎖定。
  3. **雙擊 W 疾跑**：`page.keyboard.press('KeyW')` → 等 100 ms → 再 `press('KeyW')` → `window.__wecraft.sprint()` 為 true；`window.__wecraft.fov()` 應由 70 趨近 77（等 400 ms 後 > 73）。放開 W（`keyboard.up('KeyW')`）→ `sprint()` 為 false。
  4. **F5 三態**：連按三次 `F5`，每次讀 `window.__wecraft.viewMode()` → 依序 `back`、`front`、`first`；在 `back`／`front` 各截一張圖存到 `/tmp/opencode/wecraft-b2-probe/`（repo 外）。
  5. **取得方塊**：滑鼠往下移（`page.mouse.move` 產生 movementY）對準地面 → 按住左鍵約 5 秒（dirt 每格 0.75 秒）→ 等掉落物自動拾取 → `window.__wecraft.hotbar()` 的 dirt 數量應 ≥ 4（`modified()` 同步增加）。
  6. **放置連放**：手上仍有 dirt 時按住右鍵 0.5 秒 → dirt 數量至少減少 2（0.2 秒一個）、`modified()` 同步增加；放開後數量不再變化。
  7. **Q 丟棄**：按 `Q` → dirt 數量 −1 且 `window.__wecraft.drops() >= 1`（丟出的物品 2 秒內不可拾：可選驗證——丟出後立刻走過去，2 秒內 `hotbar()` 不變）；`Ctrl+Q` → 剩餘整疊一次丟完（dirt 數量歸零）。
  8. **Ctrl+W**：**不執行、列為未驗證**（瀏覽器保留鍵，CDP 合成鍵無法複刻瀏覽器的保留鍵路由；AGENTS.md 明列此類條件不得宣稱通過）。

- [ ] **Step 3: 執行（有頭模式）**

  ```bash
  cd /tmp/opencode/wecraft-b2-probe
  xvfb-run -a node probe.mjs
  ```
  Expected: 每項印出 PASS；若有任何 FAIL，先回頭修（不得以「大概可以」帶過）。

- [ ] **Step 4: 紀錄與回報**

  把 1–7 的逐項結果與截圖路徑貼進 Task 14 的 `docs/releases/v0.5.0.md`〈已知問題〉段（Ctrl+W 明列為未驗證），並在回報中區分「程式完成／ZIP 驗證／Release／平台上架」（AGENTS.md §3）。

- [ ] **Step 5: 全量驗證** — `npm run typecheck && npm test && npm run build` → 全綠（本任務不改程式，僅確認）。

---

### Task 14: 0.5.0 發布

**Files:**
- Modify: `package.json`（`version`）、`game.json`（`version`；**`cloudSave` 不動**）、`README.md`
- Create: `docs/releases/v0.5.0.md`
- `.github/workflows/release.yml`：**本批不需修改**（B1 已加入 `docs/releases/<tag>.md` 的 notes 檔優先邏輯，實作時先讀檔確認）。

**Interfaces:**
- Consumes: Task 1-13 全部。
- Produces: version `0.5.0`（`package.json`／`game.json` 同步）；tag `v0.5.0` 與 GitHub Release（tag／push 屬 controller）。

- [ ] **Step 1: 版本 bump**

  `package.json` `"version": "0.5.0"`；`game.json` `"version": "0.5.0"`（`id` 不動、`cloudSave` 不動）。

- [ ] **Step 2: README 更新**

  - 〈操作〉表補／改：
    | 操作 | 功能 |
    |---|---|
    | 雙擊 W | 疾跑（主入口；Ctrl 也可疾跑，但 Ctrl+W 是瀏覽器保留鍵可能被吃掉） |
    | Ctrl | 疾跑（輔助入口） |
    | Shift | 潛行（移速變慢、著地時不會走出邊緣）/ 飛行下降 |
    | 右鍵 | 放置方塊（**按住可連續放置**，每 0.2 秒一個）/ 右鍵工作台開 3×3 |
    | Q | 丟棄選取格 1 個（長按連丟） |
    | Ctrl+Q | 丟棄選取格整疊 |
    | F5 | 切換視角（第一人稱／面後／面前） |
  - 〈遊戲特色〉→〈生存模式〉補一行：「疾跑：雙擊 W 開始，停止前進／潛行／撞牆／飢餓 ≤6 會取消；疾跑時視野 +10%」。
  - 〈與原版的差異〉：把「疾跑目前僅 Ctrl（雙擊 W 與疾跑 FOV 排入 B2）」**改掉**，並新增本批的簡化條目：
    - 疾跑 FOV 固定 +10%（原版為動態計算）
    - 雙擊 W 視窗固定 0.35 秒（原版可在選項調整）
    - 疾跑速度 5.6 格/秒（原版 5.612）
    - 玩家模型無動畫（無行走循環；面後／面前視角才有）
    - Q 丟棄在創造模式不作用
    - 丟出的物品受本作水平阻力影響，落地點比原版近（原版約 2–3 格）
    - 潛行防摔邊未實作 step_height 0.6 的高度差判斷
  - 〈專案狀態〉補一行 B2（0.5.0）的完成摘要與測試數（以實際 `npm test` 輸出為準）。

- [ ] **Step 3: 發布說明 `docs/releases/v0.5.0.md`（固定四段）**

  - `## 新增`：雙擊 W 疾跑狀態機（鎖存／取消條件／飢餓門檻）、疾跑 FOV +10%、右鍵放置連放（0.2 秒）、Q 丟棄（單個／長按連丟／Ctrl+Q 整疊，玩家丟出 2 秒不可拾）、F5 三態視角＋方塊人玩家模型、暫停選單操作提示。
  - `## 修正`：面後視角相機原本放在玩家**前方**（射線與畫面不一致）已修正為後方；面前視角相機 yaw 反轉 180°，互動射線改以相機姿態為準。
  - `## 存檔格式與相容性提示`：**本批沒有存檔形狀變更**——本機 payload 維持 v3、雲端維持 format 1（`readableFormats:[1], writeFormat:1`），0.4.0 與 0.5.0 的存檔互相可讀，不會因降版而看不到進度。
  - `## 已知問題`：`Ctrl+W` 為瀏覽器保留鍵，**未驗證**（CDP 合成鍵無法複刻瀏覽器保留鍵路由）；疾跑 FOV 為固定 +10% 的簡化值；創造模式 Q 不作用；玩家模型無動畫；被動生物／光照等 B3–B9 項目照舊。

- [ ] **Step 4: 全量 gates**

  Run: `npm run typecheck && npm test && npm run build && npm run lint` → Expected: 全綠（測試數 ≥ 806 + 本批新增）。

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

- [ ] **Step 6: Commit（分支上；不 tag、不 push）**

  ```bash
  git add -A
  git commit -m "chore(release): 0.5.0"
  ```
  tag 與 push 屬整支完成後的整合步驟——merge 回 master 後才 `git tag -a v0.5.0 -m "0.5.0: B2 操控手感"`＋`git push origin master`＋`git push origin v0.5.0`，由 controller 依 finishing-a-development-branch 流程執行。

- [ ] **Step 7: 驗證 CI Release（controller 執行時）**

  以 `webfetch https://github.com/TommyLamm/WeCraft/releases/tag/v0.5.0` 確認 release 存在、asset 已附、說明為 `docs/releases/v0.5.0.md` 內容。回報照 AGENTS.md 四段式：程式完成／ZIP 驗證／Release（CI 結果）／平台上架（若屬平台操作，向使用者確認後再按）。

---

## 批末驗收

- **gates**：`npm run typecheck`、`npm test`、`npm run build`、`npm run lint` 全綠；既有 806 tests／51 files 一個不少（新增測試只增不減）。
- **統計**：最終測試數與檔案數（寫進發布說明）。
- **Playwright（Task 13，真實 Chromium headful）**：pointer lock 鎖定、Esc 釋放指標鎖並開暫停選單、雙擊 W 疾跑（含 FOV 由 70 趨近 77）、放開 W 停止疾跑、F5 三態循環（附截圖）、取得方塊（挖掘→拾取）、放置連放（0.5 秒內至少放 2 個）、Q 丟棄（數量 −1 且產生掉落物、2 秒內不可拾）、Ctrl+Q 整疊。**Ctrl+W 情境列「未驗證」**（瀏覽器保留鍵，CDP 合成鍵無法複刻；不得宣稱通過）。
- **效能**：玩家模型為 6 個盒子（72 三角形）＋1 個臉部貼片（2 三角形）＝74 三角形，且只在第三身顯示；疾跑狀態機每幀一次純函式呼叫；FOV 每幀一次平滑計算——F3 三角形數與 FPS 不應比 0.4.0 明顯劣化（同一場景比較，記錄數值）。
- **未自動化的部分**：`src/main.ts` 無單元測試（組裝根）——Task 9／10／11 的接線以人工步驟＋Playwright 佐證，並在回報中列「未自動化」。
- **存檔**：本批無存檔形狀變更；`loadGame`／雲端流程未動，既有存檔往返測試維持綠燈。

---

## 與公約／spec 的差異（逐條）

1. **雙擊 W 視窗採 0.35 秒而非派發訊息建議的 300 ms**：實查 minecraft.wiki/Options 有「Sprint Window … 預設 7（tick）」，故依 wiki 採 7 tick = 0.35 s（`SPRINT_DOUBLE_TAP_WINDOW_SEC = 0.35`），並在 README 記「原版可調、本作固定」。
2. **疾跑 FOV 採固定 +10%（70 → 77）**：minecraft.wiki 沒有 `FOV Effects` 頁（2026-10-20 抓取 404），Sprinting 頁只寫「expands slightly」、Options 頁只說 FOV 設定值「不含 sprinting 等效果」→ 屬無原文可引的簡化值，已在計畫與 README 明示理由。
3. **放置連放 4 tick（0.2 秒）**：spec §B2.2 已定案；minecraft.wiki/Block 未記載此間隔（raw 全文查 `4 tick`／`cooldown`／`repeat` 皆無）→ 保留 spec 值並列入「實作時複核」。
4. **Q 長按連丟節奏採 0.2 秒**：wiki 只說「holding the key causes single items to be dropped quickly」，無數值 → 與放置連放同節奏的簡化值，已標明。
5. **玩家丟出的物品 2 秒不可拾取**（wiki Item (entity)：玩家丟出 40 tick；方塊掉落 10 tick）：repo 既有 `SPAWN_PICKUP_DELAY = 0.5` 對應方塊掉落不變，本批為玩家丟出新增 `PLAYER_DROP_PICKUP_DELAY = 2`。
6. **創造模式 Q 不作用**：公約未指定；本批採「不丟不消耗」以避免無限複製與地上垃圾，README〈與原版的差異〉記錄。
7. **新增 `window.__wecraft` 唯讀 debug hook**（`src/main.ts`）：公約未提；為滿足 AGENTS.md 的真實瀏覽器驗收（需要讀取疾跑／視角／FOV／熱鍵欄狀態），刻意限縮為唯讀且無敏感資訊。
8. **本批不動存檔形狀**（本機 v3、雲端 format 1）——與公約 §3 的版本表一致，無差異。
9. **疾跑飢餓門檻矛盾已解**：spec §B2.1 寫「飢餓 ≤6 不可疾跑」，與 Food 頁「until the hunger value exceeds 7」的字面解讀衝突；本批依 Sprinting 頁與其歷史條目「requires **more than 6** points of food」統一為「>6 可開始／≤6 取消／無額外鎖定」，詳見〈已查證與簡化決策〉§1。
10. **`InputState.placeHeld` 的所有權歸 B2**（2026-10-20 稽核修正）：`placeHeld`（右鍵按住旗標）由 **B2（0.5.0）** 在 `src/player/input.ts` 宣告，並由 `clearActive()` 清除；**B4（0.7.0）只消費、不得重新宣告**——B4 計畫若在 `src/player/input.ts` 再加一次 `placeHeld: boolean`（或再加一次 `onMouseDown` 的 `state.placeHeld = true`），會撞 TS duplicate identifier 或把同一件事做兩次。**對 B4 計畫的對應要求**：`src/player/input.ts` 那一列改寫成「沿用 B2 已存在的欄位，本批只消費」，不得再加欄位。（本計畫不修改 B4 計畫檔，該修正由 B4 的修正者處理。）
    - **（2026-10-20 終審修正：B4 計畫已按此要求改寫完成）**——B4 的 `src/player/input.ts` 已改為「**不動（沿用 B2）**」，Task 9 不再宣告欄位、不再寫旗標邏輯，改以 B4 自有的純邏輯 `eatTick(progress, { held, item, allowed, dtSec })` 承載「按住才吃」的規則（`held` 由 `main.ts` 從 `input.state.placeHeld` **唯讀**帶入）。**兩邊的所有權現已一致：B2 宣告，B4 只消費。**

---

## Self-Review 記錄

- **Spec 覆蓋**：spec §B2.1（疾跑狀態機：雙擊 W／Ctrl、撞牆／潛行／停止／飢餓門檻、FOV 加成）→ Task 1＋2＋3＋5＋9；§B2.2（放置連放 4 tick、滑鼠解鎖／失焦停止）→ Task 7＋10；§B2.3（潛行防摔邊）→ Task 4；§B2.4（F5 三態＋無動畫方塊人）→ Task 6＋8＋11；§B2.5（Q 丟棄：1 個／長按／Ctrl+Q 整疊、落地可撿回、數量正確）→ Task 10；§批末驗收（gates＋Playwright＋Ctrl+W 未驗證）→ Task 13＋14；§跨批次（版本 0.5.0、README 差異段、發布說明四段）→ Task 14。
- **型別一致**：`SprintState`／`SprintContext`／`updateSprint`／`SPRINT_*` 由 Task 1 產生，Task 2（`SPRINT_DOUBLE_TAP_WINDOW_SEC`）、Task 3（`SPRINT_WALL_ANGLE_DEG` 的 8° 判定在 sprint.ts）、Task 9 消費；`StepResult.wallAngleDeg` 由 Task 3 產生、Task 9 消費；`RepeatState`／`stepRepeat` 由 Task 7 產生、Task 10 消費；`ViewMode`／`viewPose`／`nextViewMode` 由 Task 6 產生、Task 11 消費；`PlayerModel` 由 Task 8 產生、Task 11 消費；`PLAYER_DROP_PICKUP_DELAY`／`SpawnDropOptions` 由 Task 10 產生並在同任務消費。存檔欄位與版本：本批不動（v3／format 1），與公約 §3 一致。
- **步驟掃描**：每個 Task 皆有「寫測試（失敗）→ 跑測試（紅）→ 實作 → 跑測試（綠）→ 全量 gates → commit」；Task 9／10／11（main.ts 組裝根）改以「接線 → 人工驗證 → gates → commit」，並在該處標明「`main.ts` 無單元測試」。
- **Review Focus 對應**：RF1→Task 1＋2；RF2→Task 1＋3＋9；RF3→Task 1；RF4→Task 7＋10＋13；RF5→Task 10＋13；RF6→Task 6＋11；RF7→Task 5＋9。
- **比例**：計畫以決策（簽名、數值、測試名與斷言、接線位置）為主；僅在「算法無法由簽名與測試決定」處（撞牆夾角公式、支撐取樣）給出具體算式，未抄整支程式。
- **已知未測面**：`src/main.ts` 無測試（Task 9／10／11 以人工＋Playwright 佐證）；放置連放與 Q 連丟在 60 fps 下的實際節拍由 Playwright 以「數量減少 ≥2」鬆散驗證，精确節拍靠 Task 7 的單元測試釘死；`Ctrl+W` 明列未驗證。
- **2026-10-20 終審修正摘要**（本計畫依最終跨計畫複核報告修正；修正點在正文以「（2026-10-20 終審修正：…）」標出）：
  1. **建議修正 #10（集中清單）**：Global Constraints 新增〈本批要改寫的既有測試（集中清單）〉——本批**不改寫任何既有測試**（只新增案例），逐條列出「檔案＋既有測試＋本批動作＋說明」，並在同一處再次寫明「本批是 `InputState.placeHeld` 的擁有者；B4 只消費」。
  2. **跨批所有權（必須修正 #1 的另一側）**：〈與公約／spec 的差異〉第 10 條補上「**B4 計畫已按此要求改寫完成**」——B4 的 `src/player/input.ts` 已改為「不動（沿用 B2）」，改以 `eatTick` 承載按住進食的規則。**兩邊的所有權現已一致。**
