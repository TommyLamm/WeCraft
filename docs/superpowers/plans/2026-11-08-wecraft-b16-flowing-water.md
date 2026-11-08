# B16 流動水與水桶 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「水是靜態方塊」補成會流動、會退去、能用水桶搬運的流體系統：水源往低處與水平方向流動（水平最多 7 格），失去水源後逐格退去，並加入空桶／水桶的裝水與倒水循環。

**Architecture:** 新增純邏輯 `src/world/water.ts`（`WaterSim`：0.25 秒 tick、每批 256 格、`FLOW_1..7` 與 `WATER_FALL` 狀態機、未載入區塊不寫入）。`World` 增加 `setFluid`（只記 `modified`／標記網格，不重算光照）與 block-change listener；`main.ts` 只負責建立 adapter、每幀推進、區塊載入後從 `modified` 重排程，以及水桶右鍵分流。水方塊沿用既有半透明 water pass，**以滿格方塊繪製**（不渲染水位高度）。

**Tech Stack:** TypeScript 5.6、Vite 5、Vitest 2、Three.js 0.170、jsdom；固定 Playroom game tools 1.2.0。

**Spec:** `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`（§B16「流動水與水桶」）

## Global Constraints

- **本批版本 `0.19.0`**；Task 8 才 bump `game.json`／`package.json`；`id` 維持 `wecraft`；tag 只會是 `v0.19.0`，但**本批未獲發布授權，不推 tag、不建 Release、不呼叫平台 API**。
- **存檔格式不升版**：本機 payload 維持 v6、雲端 `formatVersion` 4、`game.json` 的 `cloudSave` **一字不動**（`readableFormats [1,2,3,4]`、`writeFormat 4`）。新方塊 id 只能 append（41–48）；流動水寫入既有 `modified` overlay。
- 水方塊 id：`WATER_FLOW_1=41` … `WATER_FLOW_7=47`、`WATER_FALL=48`。全部 `solid:false`、`transparent:true`、硬度 `Infinity`、爆炸抗性 **100**、使用 `T.WATER` 貼圖、**沒有物品形式**、不進 `PLACEABLE`／`HOTBAR_DEFAULT`。
- 流動常數：`WATER_TICK_SEC = 0.25`、`WATER_MAX_UPDATES_PER_TICK = 256`、水平上限 `WATER_MAX_LEVEL = 7`。
- 流動水只流入**空氣**；不沖走花草／火把／農作物；不建立新水源；不與岩漿互動；不寫入未載入區塊。
- 水桶：`bucket` 與 `water_bucket` 皆堆疊 1；桶子配方＝3 個鐵錠的 V 形（上排左右、中央下方）；水桶不可合成；只能從**水源**（`BLOCK.WATER`）裝水；倒水放置水源。
- 渲染：所有水 id 都進 water pass；同一流體的不同 id 之間**不畫內部面**；不渲染水位高度。
- 不得新增 npm 依賴、不得改 SDK／protocol／Manifest schema、不得改 iframe／全螢幕／pointer lock／瀏覽器保留鍵行為。
- 驗收工具只用 `.playroom/game-tools.lock.json` 固定的 game tools 1.2.0、SHA-256 `24a2fd36b405ae9f1ce1303e53ac6b0a0d0a2798c04e796f5790a2663d46f022`；不得自行指定版本。
- **2026-11-08 已讀** Playroom `main` 模板與 §1 七份文件（game-development／command-contracts／game.schema.json／game-release.yml／SDK 1.1.0／sdk-versioning／save-compatibility）。本次適用重點：版本遞增與 tag 一致、ZIP 根目錄有 `game.json`、相對路徑與 `base:'./'`、跨來源 sandbox iframe 可玩、不跳頂層／不開 popup／不提交表單、不自行鎖定頂層鍵盤、音效由玩家手勢觸發、固定工具 pack＋validate、真實瀏覽器 smoke；本次沒有存取平台 API、沒有改 SDK／協定／Manifest schema／`cloudSave`。
- 回報必須區分：程式完成／ZIP 驗證／GitHub Release／平台上架；未做的列為未驗證。

## Review Focus

1. **流動終止與退去**：水平最多 7 格；失去水源、路徑被擋、或水柱落地後，流動水必須在有限 tick 內退去；不得出現永遠震盪或無限增生的水。測試擁有者：Task 2（`water.test.ts` 的 7 格上限／退去／阻擋／雙水源不生成新水源）。
2. **未載入區塊與跨區塊邊界**：`WaterSim` 不得讀寫未載入區塊；`World.setFluid` 不得自動建立區塊；區塊載入後要從 `modified` 重排程，讓邊界水流恢復。測試擁有者：Task 2（`isLoaded` 邊界）＋ Task 3（`setFluid` 缺區塊回 false）＋ Task 6（`scheduleFromModified` 接線）。
3. **存檔／session 邊界**：流動水狀態要隨 `modified` 保存；載入／繼續／雲端套用／回標題要清掉舊佇列並重排程；失去水源的流動水在載入後退去，不得把上一場的水帶進新場。測試擁有者：Task 2（`scheduleFromModified`／`reset`）＋ Task 6（四個場次入口的接線）。
4. **水桶物品守恆與互動優先序**：空桶只能從最近命中的**水源**裝水（不能穿過較近的實心方塊）；水桶倒水後必須變回空桶；生存／創造都不得複製或消失物品；水桶分支不得搶走工作台／熔爐／箱子／床／TNT 的使用。測試擁有者：Task 7（`player/bucket.test.ts`＋wiring 釘子）。
5. **渲染與效能**：所有水 id 進 water pass、同流體不畫內部面；`setFluid` 不觸發光照重算；每 tick 最多 256 格，`dt` 過大不得一次補償大量 tick。測試擁有者：Task 2（批次／dt）＋ Task 3（`lightDirty` 不變）＋ Task 5（mesher）。

---

### Task 1: 水方塊 id、定義與登錄表

**Files:**
- Modify: `src/world/blocks.ts`
- Modify: `src/world/blocks.test.ts`
- Modify: `src/audio/sounds.ts`
- Modify: `src/audio/sounds.test.ts`
- Modify: `src/core/items.test.ts`

**Interfaces:**
- Consumes: 既有 `BLOCK`、`T.WATER`、`BlockDef`。
- Produces（後續任務只依賴這些）：
  - `BLOCK.WATER_FLOW_1` … `BLOCK.WATER_FLOW_7`（41–47）、`BLOCK.WATER_FALL`（48）。
  - `isWaterBlock(id: number): boolean` — `BLOCK.WATER` 或 41–48 回 true；其他（含 air／stone／999／NaN）回 false。
  - `getBlockDef(id)` 對 41–48 回傳完整 `BlockDef`。

- [ ] **Step 1: 寫失敗測試**

在 `src/world/blocks.test.ts` 新增：
```ts
it('B16: water ids are append-only 41–48 and share the water definition', () => {
  const ids = [
    BLOCK.WATER_FLOW_1, BLOCK.WATER_FLOW_2, BLOCK.WATER_FLOW_3,
    BLOCK.WATER_FLOW_4, BLOCK.WATER_FLOW_5, BLOCK.WATER_FLOW_6,
    BLOCK.WATER_FLOW_7, BLOCK.WATER_FALL,
  ];
  expect(ids).toEqual([41, 42, 43, 44, 45, 46, 47, 48]);
  for (const id of ids) {
    expect(getBlockDef(id)).toMatchObject({
      id, name: 'water', hardness: Infinity, blastResistance: 100,
      solid: false, transparent: true, shape: 'cube',
      top: T.WATER, side: T.WATER, bottom: T.WATER,
      requiredTool: null, fastTool: null,
    });
  }
});

it('B16: isWaterBlock covers source + flow + fall and nothing else', () => {
  expect(isWaterBlock(BLOCK.WATER)).toBe(true);
  for (let id = BLOCK.WATER_FLOW_1; id <= BLOCK.WATER_FALL; id++) {
    expect(isWaterBlock(id)).toBe(true);
  }
  expect(isWaterBlock(BLOCK.AIR)).toBe(false);
  expect(isWaterBlock(BLOCK.STONE)).toBe(false);
  expect(isWaterBlock(999)).toBe(false);
  expect(isWaterBlock(Number.NaN)).toBe(false);
});

it('B16: flowing water is not placeable and not in the default hotbar', () => {
  for (let id = BLOCK.WATER_FLOW_1; id <= BLOCK.WATER_FALL; id++) {
    expect(PLACEABLE).not.toContain(id);
    expect(HOTBAR_DEFAULT).not.toContain(id);
  }
});
```

在 `src/core/items.test.ts` 的 `BLOCK_ONLY_STATES` 加入 41–48；並新增：
```ts
it('B16: flowing water has no item form', () => {
  for (let id = BLOCK.WATER_FLOW_1; id <= BLOCK.WATER_FALL; id++) {
    expect(itemFromBlock(id)).toBeNull();
  }
});
```

在 `src/audio/sounds.test.ts` 的 table 加入 41–48（全部 `'water'`），維持
`Object.keys(table)).toHaveLength(Object.keys(BLOCK).length)` 這條守門。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/world/blocks.test.ts src/core/items.test.ts src/audio/sounds.test.ts`
Expected: FAIL — `BLOCK.WATER_FLOW_1` undefined、`isWaterBlock` 不存在、音效表長度不足。

- [ ] **Step 3: 實作**

`src/world/blocks.ts`：
```ts
// B16：流動水（append-only 41–48）。水源仍是 id 9；41–47 是水平距離
// 1–7，48 是下落中的水柱。全部沒有物品形式，旧版遇到未知 id 會 fallback 空氣。
WATER_FLOW_1: 41,
WATER_FLOW_2: 42,
WATER_FLOW_3: 43,
WATER_FLOW_4: 44,
WATER_FLOW_5: 45,
WATER_FLOW_6: 46,
WATER_FLOW_7: 47,
WATER_FALL: 48,
```
在 `DEFS` 為每個 id 加同一份定義（name `'water'`、hardness `Infinity`、
blastResistance `100`、solid `false`、transparent `true`、shape `'cube'`、
top／side／bottom `T.WATER`、requiredTool／fastTool `null`）。可寫一個
`const FLOWING_WATER_DEF = (id: BlockId): BlockDef => ({ ... })` 後展開 8 次，
但每個 id 仍必須是獨立 key。

在 `blocks.ts` 匯出：
```ts
export function isWaterBlock(id: number): boolean {
  return id === BLOCK.WATER || (id >= BLOCK.WATER_FLOW_1 && id <= BLOCK.WATER_FALL);
}
```
另外把 `isReplaceableForPlacement` 的來源判斷留給 Task 5（此任務不動）。

`src/audio/sounds.ts` 的 `GROUP_BY_BLOCK` 加 8 筆 `'water'`。

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/world/blocks.test.ts src/core/items.test.ts src/audio/sounds.test.ts`
Expected: PASS（含既有 38＋46＋12 條與新測試）。
Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/world/blocks.ts src/world/blocks.test.ts src/audio/sounds.ts src/audio/sounds.test.ts src/core/items.test.ts
git commit -m "feat(b16): 流動水方塊 id 與登錄表"
```

---

### Task 2: 水的純邏輯模擬 `src/world/water.ts`

**Files:**
- Create: `src/world/water.ts`
- Create: `src/world/water.test.ts`

**Interfaces:**
- Consumes: `BLOCK`、`isWaterBlock`、`BlockId`（`./blocks`）、`CHUNK_HEIGHT`（`./chunk`）。
- Produces（Task 6 只依賴這些簽名）：

```ts
export const WATER_TICK_SEC = 0.25;
export const WATER_MAX_UPDATES_PER_TICK = 256;
export const WATER_MAX_LEVEL = 7;

export interface WaterGrid {
  getBlock(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, id: BlockId): void;
  /** 該 x/z 所屬區塊是否已載入；未載入的格子一律不讀寫。 */
  isLoaded(x: number, z: number): boolean;
}

/** 水源 0、FLOW_1..FLOW_7 1..7、WATER_FALL 與非水 null。 */
export function waterFlowLevel(id: number): number | null;
/** 與 waterFlowLevel 相同，但 WATER_FALL 回 null（水柱不向側面供給）。 */
export function waterSpreadLevel(id: number): number | null;
/** 0 → BLOCK.WATER；1..7 → FLOW_n；非有限值／越界 → BLOCK.AIR。 */
export function waterBlockForLevel(level: number): BlockId;

export class WaterSim {
  constructor(grid: WaterGrid);
  /** 外部方塊變更（setBlock）後呼叫：排程該格與 6 鄰居。 */
  notifyBlockChanged(x: number, y: number, z: number): void;
  /** 從 modified overlay 重排程；可只排程某區塊 ±1 範圍。回傳排程數。 */
  scheduleFromModified(
    entries: Iterable<readonly [string, number]>,
    chunk?: { cx: number; cz: number },
  ): number;
  /** 推進 dt；每滿 0.25 秒處理一批（最多 256 格），回傳實際變更格數。 */
  tick(dtSec: number): number;
  reset(): void;
  get pendingCount(): number;
}
```

- [ ] **Step 1: 寫失敗測試**

`src/world/water.test.ts` 用假 grid：

```ts
class FakeGrid implements WaterGrid {
  blocks = new Map<string, number>();
  loaded = true;
  getBlock(x: number, y: number, z: number): number {
    return this.blocks.get(`${x},${y},${z}`) ?? BLOCK.AIR;
  }
  setBlock(x: number, y: number, z: number, id: BlockId): void {
    this.blocks.set(`${x},${y},${z}`, id);
  }
  isLoaded(): boolean { return this.loaded; }
}
const put = (g: FakeGrid, x: number, y: number, z: number, id: BlockId) =>
  g.blocks.set(`${x},${y},${z}`, id);
const at = (g: FakeGrid, x: number, y: number, z: number) => g.getBlock(x, y, z);
const settle = (sim: WaterSim, steps = 40) => {
  for (let i = 0; i < steps; i++) sim.tick(WATER_TICK_SEC);
};
```

至少涵蓋以下測試（名稱與斷言）：
- `pins the B16 constants`：`WATER_TICK_SEC === 0.25`、`WATER_MAX_UPDATES_PER_TICK === 256`、`WATER_MAX_LEVEL === 7`。
- `maps ids to levels and back`：`waterFlowLevel(BLOCK.WATER) === 0`、`FLOW_1..7 → 1..7`、`WATER_FALL → null`、`STONE → null`；`waterBlockForLevel(0) === BLOCK.WATER`、`1..7` 對應、`NaN`／`-1`／`8` → `BLOCK.AIR`。
- `a source block itself is never converted or removed`：source 一格，settle 後 source
  仍是 `BLOCK.WATER`；它周圍可以合理出現流動水（這不是「source 被改掉」）。
- `spreads one level per tick and stops at seven`：source at (0,64,0)，下方 solid；tick 7 次後 (7,64,0) 是 `FLOW_7`；(8,64,0) 仍是 `AIR`；再 settle 也不會出現第 8 格。
- `recedes when the source is removed`：source + 7 格流動水；把 source 設為 AIR、`notifyBlockChanged(0,64,0)`、settle；全部流動水變回 AIR、`pendingCount === 0`。
- `a placed block cuts the flow and the tail recedes`：source 在 (0,64,0)，流動水到 (7,64,0)；把 (3,64,0) 設為 `STONE`、notify；settle 後 (4..7,64,0) 全 AIR，source 與 (1..2) 保留。
- `water falls before it spreads`：source at (0,66,0)、下方 (0,65,0) 與 (0,64,0) 是 AIR、
  (0,63,0) 是 solid；settle 後 (0,65,0) 是 `WATER_FALL`、(0,64,0) 是 `FLOW_1`
  （落地格）；(0,64,1) 會水平擴散成 `FLOW_2`，但 (0,65,1)（水柱旁）保持 AIR
  （`WATER_FALL` 不供給側面）。
- `two sources do not create a new source`：source at (0,64,0) 與 (2,64,0)，中間 (1,64,0) 是 AIR、下方 solid；settle 後 (1,64,0) 只會是 `FLOW_1`，永遠不是 `BLOCK.WATER`。
- `never writes into an unloaded chunk`：source at (15,64,0)，`isLoaded` 對 x≥16 回 false；settle 後 (16,64,0) 仍是 AIR，`sim.pendingCount` 不因未載入格無限增長。
- `dt guards and one batch per call`：`tick(0.24) === 0`；`tick(0.01)` 觸發；`tick(NaN)`／`tick(-1)` 回 0；`tick(10)` 只處理一批（用 300 個待處理格驗證變更數 ≤ 256，且 `pendingCount > 0`）。
- `batch cap is 256`：建立 300 個 source 相鄰的空氣格，tick 一次，`changed <= 256`。
- `scheduleFromModified parses keys and filters chunks`：給 `[['0,64,0', BLOCK.WATER], ['99,64,99', BLOCK.WATER], ['bad', 1]]` 與 `{cx:0,cz:0}`；只排程 (0,64,0) 附近；非法 key 不拋錯。
- `reset clears the queue`：排程後 `reset()`，`pendingCount === 0`，後續 tick 不變更。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/world/water.test.ts`
Expected: FAIL — `Cannot find module './water'`。

- [ ] **Step 3: 實作 `WaterSim`**

實作要點（照此實作，不要另創規則）：
- `queue` 用 `Map<string, readonly [number, number, number]>`，保留插入順序；
  重複排程同一格不改變位置。
- `notifyBlockChanged` 排程「自己 ＋ 6 鄰居」，但只排程 `isLoaded` 且 y 在
  `0..CHUNK_HEIGHT-1` 的格子。
- `tick`：`dt` 非有限或 ≤0 → 0；累加 `acc`，未滿 `WATER_TICK_SEC` → 0；
  滿了就**把 `acc` 歸零**（不補償大量 tick）。取佇列前 256 格，逐格：
  - 未載入 → 跳過。
  - `id === BLOCK.WATER`（水源）→ 跳過（水源永不改寫）。
  - `id` 既不是 `BLOCK.AIR` 也不是流動水（`FLOW_1..7`／`WATER_FALL`）→ 跳過
    （固體／花草／火把都不會被水取代）。
  - **空氣與流動水都參與計算**（空氣是「可能變成水」的目標格；只處理流動水
    會讓水永遠流不進新格子）。
  - `nextFor`：
    - 先找供給：上方是任何水 id → 垂直供給；水平 4 鄰居只取
      `waterSpreadLevel` 的最小值 +1（只接受 `< 7`）；兩者都沒有 → `BLOCK.AIR`。
    - 下方是空氣 → `WATER_FALL`（不管水平距離，先往下）。
    - 上方是水且下方也是水 → `WATER_FALL`（維持下落水柱）。
    - 上方是水且下方不是水（固體／花草／火把）→ `WATER_FLOW_1`（落地）。
    - 否則（只有水平供給）→ `waterBlockForLevel(minLevel)`。
    - 水平鄰居未載入 → 視為**不可流入**（不當空氣、不供水）。
  - 變更才 `grid.setBlock`，並排程 6 鄰居（不排程自己）。
- `scheduleFromModified`：解析 `"x,y,z"`，只接受三個整數；有 `chunk` 時只處理
  `x` 在 `[cx*CHUNK_SIZE-1, (cx+1)*CHUNK_SIZE]`、`z` 同理的條目（用
  `./chunk` 的 `CHUNK_SIZE`，不要寫死 16）；對每條呼叫 `notifyBlockChanged`。
- `reset()` 清空 queue 與 `acc`。
- `pendingCount` 回 queue.size。

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/world/water.test.ts`
Expected: PASS（全部新測試）。
Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/world/water.ts src/world/water.test.ts
git commit -m "feat(b16): 流動水純邏輯與批次 tick"
```

---

### Task 3: `World.setFluid` 與方塊變更監聽

**Files:**
- Modify: `src/world/world.ts`
- Modify: `src/world/world.test.ts`

**Interfaces:**
- Consumes: `isWaterBlock`、`BLOCK`、`BlockId`。
- Produces（Task 6 依賴）：

```ts
export type BlockChangeListener = (x: number, y: number, z: number) => void;

// World 方法
setBlockChangeListener(listener: BlockChangeListener | null): void;
/** 只寫流體／空氣；區塊必須已存在（不自動建立）；不觸發光照重算／listener。 */
setFluid(x: number, y: number, z: number, id: BlockId): boolean;
```

- [ ] **Step 1: 寫失敗測試**

`src/world/world.test.ts` 新增：
- `setBlockChangeListener fires with floored coordinates on a real change`：
  建立 chunk、設 listener、`setBlock(1.9, 64.2, 2.1, STONE)` → 收到 `(1,64,2)`；
  再 `setBlock` 同一格同 id → 不再收到（若實作選擇「同 id 不通知」）。
- `setBlockChangeListener(null) detaches`：清掉後不再收到。
- `setFluid writes only into an existing chunk`：沒有 chunk → 回 false、`world.chunks.size === 0`、`modified.size === 0`。
- `setFluid records modified and dirties the chunk without relighting`：
  建 chunk、`computeChunkLight` 或先設 `lightDirty` 狀態；`setFluid(1,64,1, BLOCK.WATER_FLOW_1)` → true、`getBlock` 正確、`modified` 有 `1,64,1`、`chunk.dirty === true`、`chunk.lightDirty` 不因 setFluid 變成 true（先把它設 false）。
- `setFluid rejects non-water blocks and out-of-range y`：
  `setFluid(..., BLOCK.STONE)` → false、世界不變；`setFluid(..., BLOCK.AIR)` → true；
  `setFluid(..., 256, ...)` → false。
- `setFluid never calls the block-change listener`：設 listener，setFluid 後計數 0。
- `setFluid updates topY and edge dirty flags`：在邊界格寫入會 `markDirty` 鄰塊；
  `topY >= y+1`。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/world/world.test.ts`
Expected: FAIL — `setBlockChangeListener`／`setFluid` 不存在。

- [ ] **Step 3: 實作**

在 `World` 加 `private blockChangeListener: BlockChangeListener | null = null;`。
`setBlock` 在寫入前記 `prev = chunk.get(lx, y, lz)`，在現有
`markLightDirty(this, cx, cz)` 之後，若 `prev !== id` 呼叫
`this.blockChangeListener?.(x, y, z)`。**不要**改動 `modified`／topY／網格 dirty
的既有行為。

`setFluid`：
- 與 `setBlock` 一樣 floor 座標、檢查 y 範圍。
- 只接受 `isWaterBlock(id) || id === BLOCK.AIR`，否則回 false。
- `const chunk = this.getChunk(cx, cz); if (!chunk) return false;`（**不建立**）。
- 寫入、邊界 `markDirty`、`modified.set`、`topY` 推進；**不呼叫**
  `markLightDirty`、**不呼叫** listener。
- 回 true。

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/world/world.test.ts`
Expected: PASS。
Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/world/world.ts src/world/world.test.ts
git commit -m "feat(b16): setFluid 與方塊變更監聽"
```

---

### Task 4: 桶子／水桶物品、配方與圖示

**Files:**
- Modify: `src/core/items.ts`
- Modify: `src/core/items.test.ts`
- Modify: `src/core/recipes.ts`
- Modify: `src/core/recipes.test.ts`
- Modify: `src/ui/icons.ts`
- Modify: `src/ui/icons.test.ts`

**Interfaces:**
- Consumes: 既有 `ItemId`／`ITEM_IDS`／`STACK_ONE`／`RECIPES`／`drawItemArt`。
- Produces（Task 7 依賴）：
  - `ItemId` 新增 `'bucket' | 'water_bucket'`。
  - `maxStack('bucket') === 1`、`maxStack('water_bucket') === 1`。
  - 配方 id `'bucket'`：3 個 `iron_ingot` 的 V 形（`[[I,null,I],[null,I,null]]`）。
  - `itemFromBlock` 對兩個新 id 無關（它們不是方塊）。

- [ ] **Step 1: 寫失敗測試**

`src/core/items.test.ts`：
- `TOTAL_ITEM_COUNT = 115`；新增 `B16_ITEM_IDS = ['bucket', 'water_bucket'] as const`。
- `it('B16: bucket and water bucket are stack-1, sanitizable items')`：
  `ALL_ITEM_IDS` 包含兩者、`sanitizeStack({item:'bucket',count:1})` 原樣、
  `maxStack` 皆 1、`blockFromItem` 皆 null、`stackName('water_bucket') === 'Water Bucket'`。

`src/core/recipes.test.ts`：
- 配方總數 69。
- `it('B16: three iron ingots in a V craft one bucket')`：用 `findRecipe` 或
  `matchRecipe` 在 3×3 的 `(0,0)`、`(2,0)`、`(1,1)` 放 iron ingot，回傳
  `{ item: 'bucket', count: 1 }`。
- 把鐵錠放在上排三格或一直線 → 不回傳 bucket。
- `RECIPES` 沒有任何 `result.item === 'water_bucket'`。

`src/ui/icons.test.ts`：
- 新增 `B16_NEEDS_ART = ['bucket', 'water_bucket'] as const`，逐一點名
  `drawItemArt` 的 case；既有 `NON_BLOCK_ITEM_IDS` 動態守門也會自動涵蓋。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/items.test.ts src/core/recipes.test.ts src/ui/icons.test.ts`
Expected: FAIL — 新 id 不在 union、配方數 68、icons 無 case。

- [ ] **Step 3: 實作**

`items.ts`：
- union 加 `| 'bucket' | 'water_bucket'`（註解寫 B16 與用途）。
- `ITEM_IDS` 加 `bucket: true, water_bucket: true`。
- `STACK_ONE` 加兩者（原版桶子堆疊 1）。
- `TOTAL_ITEM_COUNT` 的來源註解更新為 115（實際常數在測試檔）。
- 不需要 `DISPLAY_NAMES`（自動轉出 Bucket／Water Bucket）。

`recipes.ts`：
```ts
// B16：水桶＝3 個鐵錠的 V 形（原版 Bucket 配方）。
{
  id: 'bucket',
  kind: 'shaped',
  pattern: [
    [I, null, I],
    [null, I, null],
  ],
  result: { item: 'bucket', count: 1 },
},
```
（`I` 已在檔案上方定義為 `'iron_ingot'`。）

`icons.ts` 的 `drawItemArt` 在 `default` 前加：
```ts
case 'bucket':
case 'water_bucket': {
  // 鐵桶：梯形桶身＋上緣＋提把；水桶加藍色水面。
  ctx.fillStyle = '#b9c6d4';
  ctx.beginPath();
  ctx.moveTo(8, 12); ctx.lineTo(24, 12); ctx.lineTo(21, 27); ctx.lineTo(11, 27);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#7f8fa1'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = item === 'water_bucket' ? '#3d7bd1' : '#8a8f96';
  ctx.fillRect(11, 17, 10, item === 'water_bucket' ? 7 : 2);
  ctx.strokeStyle = '#7f8fa1'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(16, 12, 7, Math.PI, 0); ctx.stroke();
  break;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/core/items.test.ts src/core/recipes.test.ts src/ui/icons.test.ts`
Expected: PASS。
Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/core/items.ts src/core/items.test.ts src/core/recipes.ts src/core/recipes.test.ts src/ui/icons.ts src/ui/icons.test.ts
git commit -m "feat(b16): 桶子與水桶物品、配方與圖示"
```

---

### Task 5: 流動水參與射線、物理、農業、放置與網格

**Files:**
- Modify: `src/world/raycast.ts`
- Modify: `src/world/raycast.test.ts`
- Modify: `src/player/physics.ts`
- Modify: `src/player/physics.test.ts`
- Modify: `src/world/farming.ts`
- Modify: `src/world/farming.test.ts`
- Modify: `src/player/interact.ts`
- Modify: `src/player/interact.test.ts`
- Modify: `src/world/mesher.ts`
- Modify: `src/world/mesher.test.ts`
- Modify: `src/main.ts`（只把「水下相機／釣魚水面」的 `=== BLOCK.WATER` 改成 `isWaterBlock`；水桶的 source-only 判斷留 Task 7）

**Interfaces:**
- Consumes: `isWaterBlock`（Task 1）、新方塊 id。
- Produces：所有「玩家在水裡」與「水可命中」的判定接受 source／flow／fall；
  `isReplaceableForPlacement` 接受全部水 id；mesher 把所有水 id 放進 water pass
  並在兩個水 id 相鄰時剔除內部面。

- [ ] **Step 1: 寫失敗測試**

`src/world/raycast.test.ts`：
- `B16: includeWater hits flowing and falling water`：在射線路徑放
  `BLOCK.WATER_FLOW_2` 與 `BLOCK.WATER_FALL`，`{ includeWater: true }` 命中；
  預設（不傳）仍穿過。
- `B16: includeWater still ignores non-water`：`STONE` 命中、`AIR` 不命中。

`src/player/physics.test.ts`：
- `B16: flowing and falling water both count as in-water`：用 World 建一個
  `FLOW_1` 水池，玩家腳／頭在其中 → `stepPlayer` 後 `player.inWater === true`，
  垂直速度受水中 drag 影響（與 source 水的既有測試同一個期望值）。
- 邊界：站在 flow 旁邊的固體上 → `inWater === false`。

`src/world/farming.test.ts`：
- `B16: any water block hydrates farmland`：`wasFarmlandHydrated` 對
  `BLOCK.WATER_FLOW_3`／`BLOCK.WATER_FALL` 回 true；對 `STONE`／`AIR` 回 false。

`src/player/interact.test.ts`：
- `B16: flowing water is replaceable when placing a block`：
  `isReplaceableForPlacement(BLOCK.WATER_FLOW_1)` 與 `WATER_FALL` → true；
  `canPlaceAt` 在目標格是 flow 水且不與玩家重疊時 → true；`STONE` → false。

`src/world/mesher.test.ts`：
- `B16: every water id lands in the water pass`：**每個**水 id（source ＋ 8 個新 id）
  各建一個 fresh world 放一格，`water(w).quadCount === 6`、`opaque(w).quadCount === 0`
  （不要把 9 格放在同一個 world——不同 id 不會合併，會是 54 而不是 6）。
- `B16: different water ids do not draw an internal face`：兩個相鄰的
  `FLOW_1`／`FLOW_2`（x=5 與 x=6）→ `water(w).quadCount === 10`（不是 12）。
- `B16: a flat FLOW layer still greedy-merges`：16×16 的 `FLOW_3` 層
  → `water(w).quadCount === 6`（與既有 source 水層同一期望）。

`src/main.ts` 的改動由 Task 6 的 wiring 釘子驗證，但此任務先改：
- 釣魚 `waterGone`：`isWaterBlock(world.getBlock(...))`
- 水下相機：`isWaterBlock(...)`
- `tryCastFishing` 的 `world.getBlock(...) !== BLOCK.WATER` 改成
  `!isWaterBlock(...)`（允許在流動水釣魚；明示簡化）。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/world/raycast.test.ts src/player/physics.test.ts src/world/farming.test.ts src/player/interact.test.ts src/world/mesher.test.ts`
Expected: FAIL — 流動水未被判定為水／未進 water pass。

- [ ] **Step 3: 實作**

- `raycast.ts` 的 `isHit`：`includeWater && isWaterBlock(world.getBlock(...))`。
- `physics.ts`：`p.inWater = isWaterBlock(feetId) || isWaterBlock(headId)`。
- `farming.ts`：`wasFarmlandHydrated` 的水判斷改 `isWaterBlock(...)`。
- `interact.ts`：`isReplaceableForPlacement` 的水判斷改 `isWaterBlock(blockId)`。
- `mesher.ts`：
  - `id === BLOCK.WATER` 的 water bit 改 `isWaterBlock(id)`。
  - `faceVisible(id, neighbor)` 開頭加：`if (isWaterBlock(id) && isWaterBlock(neighbor)) return false;`
    （同流體不畫內部面；source／flow／fall 都算同一流體）。
  - 其他 pass 不變。
- `main.ts` 的三處水判斷改 `isWaterBlock`；`BLOCK` import 保留（其他地方仍用）。

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/world/raycast.test.ts src/player/physics.test.ts src/world/farming.test.ts src/player/interact.test.ts src/world/mesher.test.ts`
Expected: PASS。
Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/world/raycast.ts src/world/raycast.test.ts src/player/physics.ts src/player/physics.test.ts src/world/farming.ts src/world/farming.test.ts src/player/interact.ts src/player/interact.test.ts src/world/mesher.ts src/world/mesher.test.ts src/main.ts
git commit -m "feat(b16): 流動水參與物理、農業、射線與網格"
```

---

### Task 6: `main.ts` 的水模擬接線

**Files:**
- Modify: `src/main.ts`
- Modify: `src/main.wiring.test.ts`

**Interfaces:**
- Consumes: `WaterSim`（Task 2）、`World.setFluid`／`setBlockChangeListener`（Task 3）、`isWaterBlock`（Task 1）。
- Produces：遊戲進行中每幀推進水；所有場次入口與區塊載入都會重排程；
  離開 playing／回標題不會留下上一場的水佇列。

- [ ] **Step 1: 寫失敗測試**

`src/main.wiring.test.ts` 新增 describe `B16 流動水接線`：
- `the simulation is built on the world with setFluid and chunk loading`：
  main source 含 `new WaterSim({`、`setBlock: (x, y, z, id) => world.setFluid(`、
  `isLoaded: (x, z) => world.hasChunk(`。
- `external block edits feed the simulation`：
  `world.setBlockChangeListener((x, y, z) => water.notifyBlockChanged(x, y, z))`
  （允許換行；用 `toContain` 分段）。
- `the simulation ticks once per playing frame before farming`：
  `playing` 段含 `water.tick(dt)` 恰一次，且位置在 `growWheatBatch` 之前。
- `chunk generation and the spawn chunk schedule from modified`：
  worker gen handler 含 `water.scheduleFromModified(world.modified, { cx, cz })`；
  `spawnPoint` 含 `water.scheduleFromModified(world.modified, { cx: 0, cz: 0 })`。
- `session boundaries reset or reschedule the queue`：
  `functionBody('resetWorld')` 與 `functionBody('quitToTitle')` 含 `water.reset()`；
  `functionBody('continueGame')` 與 `functionBody('continueFromCloud')` 含
  `water.scheduleFromModified(`。
- `paused/dead/sleeping frames do not tick water`：`water.tick(dt)` 只出現在
  `playing` 段（用 `countOf('water.tick(') === 1` 與所在段落檢查）。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/main.wiring.test.ts`
Expected: FAIL — 找不到 `new WaterSim`／`water.tick`。

- [ ] **Step 3: 實作**

`main.ts`：
- import `WaterSim` 與 `isWaterBlock`（若 Task 5 尚未 import）。
- `const world = new World();` 之後：
```ts
// B16：流動水模擬。adapter 只在已載入區塊讀寫；setFluid 不觸發光照重算。
const water = new WaterSim({
  getBlock: (x, y, z) => world.getBlock(x, y, z),
  setBlock: (x, y, z, id) => { world.setFluid(x, y, z, id); },
  isLoaded: (x, z) => world.hasChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)),
});
world.setBlockChangeListener((x, y, z) => water.notifyBlockChanged(x, y, z));
```
- `playing` 分支：在 `farmAcc += dt` 之前加 `water.tick(dt);`（每幀一次；
  `tick` 自己累積 0.25 秒）。
- `resetWorld()`：加 `water.reset();`（與 farmAcc／fishing 同一個 session 邊界）。
- `quitToTitle()`：加 `water.reset();`。
- `continueGame()`：在 `world.applyModified(payload.modified);` 之後加
  `water.reset(); water.scheduleFromModified(world.modified);`。
- `continueFromCloud()`：進場時加 `water.reset(); water.scheduleFromModified(world.modified);`
  （雲端不帶 voxel 編輯，這通常是空集合；保留對稱性）。
- `spawnPoint()`：在 `world.reapplyModifiedInChunk(0, 0);` 之後加
  `water.scheduleFromModified(world.modified, { cx: 0, cz: 0 });`。
- worker gen handler：在 `world.reapplyModifiedInChunk(cx, cz);` 與 `relit` 區塊之後加
  `water.scheduleFromModified(world.modified, { cx, cz });`。
- 不要在 `sleeping`／`paused`／`dead`／`title` 分支呼叫 `water.tick`。

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/main.wiring.test.ts`
Expected: PASS。
Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/main.wiring.test.ts
git commit -m "feat(b16): 流動水模擬接線與區塊載入排程"
```

---

### Task 7: 水桶裝水／倒水互動

**Files:**
- Create: `src/player/bucket.ts`
- Create: `src/player/bucket.test.ts`
- Modify: `src/main.ts`
- Modify: `src/main.wiring.test.ts`
- Modify: `src/ui/menus.ts`
- Modify: `src/ui/ui.test.ts`（若暫停選單文字有既有釘子）

**Interfaces:**
- Consumes: `BLOCK`／`isWaterBlock`、`ItemStack`、`ItemId`、`resolvePlacementTarget`／
  `canPlaceBlockAt`、`raycast`。
- Produces（main 只依賴這些）：
```ts
/** 水源、最近命中：空桶可以裝水。flow/fall 不算水源。 */
export function canFillBucket(
  waterId: number,
  waterT: number,
  blockT: number | null,
): boolean;

/** 裝水後手持的物品（新物件，count 1）。 */
export function bucketAfterFill(): ItemStack; // { item: 'water_bucket', count: 1 }
/** 倒水後手持的物品。 */
export function bucketAfterEmpty(): ItemStack; // { item: 'bucket', count: 1 }
```

- [ ] **Step 1: 寫失敗測試**

`src/player/bucket.test.ts`：
- `canFillBucket accepts only a nearest source`：
  `canFillBucket(BLOCK.WATER, 3, null) === true`；
  `canFillBucket(BLOCK.WATER, 3, 5) === true`（方塊在後面）；
  `canFillBucket(BLOCK.WATER, 5, 3) === false`（方塊更近）；
  `canFillBucket(BLOCK.WATER_FLOW_1, 3, null) === false`；
  `canFillBucket(BLOCK.WATER_FALL, 3, null) === false`；
  `canFillBucket(BLOCK.WATER, Number.NaN, null) === false`；
  `canFillBucket(BLOCK.WATER, -1, null) === false`。
- `bucketAfterFill/Empty return fresh stack-1 items`：值正確、`count === 1`。

`src/main.wiring.test.ts` 新增：
- `bucket helpers exist`：main source 含 `heldIsBucket()`、`heldIsWaterBucket()`、
  `tryFillBucket(`、`tryEmptyBucket(`。
- `bucket branches run after block use and before the rod/bow/food`：
  以 `wantPlace` 段的位置比較——`heldIsBucket()` 與 `heldIsWaterBucket()` 都在
  `heldIsFishingRod()` 之前、在 `BLOCK.TNT` 分支之後。
- `fill uses the water-inclusive ray and a source check`：
  `functionBody('tryFillBucket')` 含 `includeWater: true`、
  `canFillBucket(`、`world.setBlock(` 與 `BLOCK.AIR`。
- `empty places a source and returns the empty bucket`：
  `functionBody('tryEmptyBucket')` 含 `BLOCK.WATER`、`resolvePlacementTarget(`、
  `canPlaceBlockAt(`、`bucketAfterEmpty()`。
- `bucket sounds keep one audio.play call site`：`countOf('audio.play(')` 從 7
  改為 8（新增 `playBucketSound` 一個呼叫點；不新增第二個）。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/player/bucket.test.ts src/main.wiring.test.ts`
Expected: FAIL — bucket 模組不存在、wiring 找不到分支。

- [ ] **Step 3: 實作**

`src/player/bucket.ts` 照上面簽名實作；`canFillBucket` 必須：
- `waterId === BLOCK.WATER`；
- `waterT` 是有限且 ≥ 0；
- `blockT === null` 或 `blockT` 非有限（視為沒有更近的方塊）或 `blockT >= waterT`；
- 否則 false。

`main.ts`：
- `heldIsBucket()` / `heldIsWaterBucket()` 放在既有 `heldIsFishingRod()` 旁。
- `function playBucketSound(x: number, y: number, z: number): void { audio.play('place', 'water', { pos: { x: x + 0.5, y: y + 0.5, z: z + 0.5 } }); }`
  ——**唯一**新增的 `audio.play` 呼叫點。
- `tryFillBucket(hit: RayHit | null, from: Vec3, dir: Vec3, maxDist: number): boolean`：
  - `const held = slots[selected]; if (!held || held.item !== 'bucket') return false;`
  - `const waterHit = raycast(world, from, dir, maxDist, { includeWater: true });`
  - `if (!waterHit) return false;`
  - `const waterId = world.getBlock(waterHit.x, waterHit.y, waterHit.z);`
  - `if (!canFillBucket(waterId, waterHit.t, hit ? hit.t : null)) return false;`
  - `world.setBlock(waterHit.x, waterHit.y, waterHit.z, BLOCK.AIR);`
  - `inventory.setSlot(selected, bucketAfterFill());`
  - `hud.setHotbar(slots, selected);`
  - `playBucketSound(waterHit.x, waterHit.y, waterHit.z);`
  - `return true;`
- `tryEmptyBucket(hit: RayHit | null): boolean`：
  - `const held = slots[selected]; if (!held || held.item !== 'water_bucket') return false;`
  - `if (!hit) return false;`
  - `const t = resolvePlacementTarget(hit, world.getBlock(hit.x, hit.y, hit.z));`
  - `if (!canPlaceBlockAt(world, t.x, t.y, t.z, player.position, BLOCK.WATER)) return false;`
  - `world.setBlock(t.x, t.y, t.z, BLOCK.WATER);`
  - `inventory.setSlot(selected, bucketAfterEmpty());`
  - `hud.setHotbar(slots, selected);`
  - `playBucketSound(t.x, t.y, t.z);`
  - `return true;`
- 右鍵分流：在 `wantPlace` 的 `else if (hit && hitBlock === BLOCK.TNT && heldIsFlintAndSteel())`
  之後、`heldIsFishingRod()` 之前插入：
```ts
} else if (heldIsBucket()) {
  tryFillBucket(hit, rayOrigin, dir, reach);
} else if (heldIsWaterBucket()) {
  tryEmptyBucket(hit);
```
  （`reach` 是同一幀已計算的方塊 reach，含第三身 back-offset；不要再算一次。）
- `ui/menus.ts` 的暫停操作提示字串尾端加：
  `｜空桶右鍵水源裝水、水桶右鍵方塊倒水（水會流向低處，水平最多 7 格）`
- `ui/ui.test.ts` 若有精確文字斷言，更新為包含新字串（或改成 `toContain`）。

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/player/bucket.test.ts src/main.wiring.test.ts src/ui/ui.test.ts`
Expected: PASS。
Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/player/bucket.ts src/player/bucket.test.ts src/main.ts src/main.wiring.test.ts src/ui/menus.ts src/ui/ui.test.ts
git commit -m "feat(b16): 水桶裝水與倒水互動"
```

---

### Task 8: 版本 0.19.0、README／規格／發布說明與完整驗證

**Files:**
- Modify: `package.json`
- Modify: `game.json`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`
- Create: `docs/releases/v0.19.0.md`
- Modify: `docs/superpowers/plans/2026-11-08-wecraft-b16-flowing-water.md`

**Interfaces:**
- Consumes: 前 7 個任務的全部交付。
- Produces: 版本 0.19.0、文件誠實化、完整驗證證據。

- [ ] **Step 1: 版本與 Manifest**

- `package.json` `version` → `0.19.0`。
- `game.json` `version` → `0.19.0`；`id`／`cloudSave`／`devices` 不動。
- `game.json.instructions` 在既有釣魚說明後加：
  `手持空桶右鍵水源裝水（只裝水源）、手持水桶右鍵方塊倒水；水會流向低處，水平最多 7 格。`

- [ ] **Step 2: README 與規格**

README：
- 版本字串 0.18.0 → 0.19.0；Description 的批次列表加「流動水與水桶」。
- 「遊戲特色 → 世界」加 B16 bullet：水會流動／退去、水平 7 格、水桶裝倒水。
- 操作表加「空桶右鍵水源裝水／水桶右鍵方塊倒水」。
- 物品表 **113 → 115**、配方 **68 → 69**、測試數字改成實際值。
- 「與原版的差異」：移除「水是靜態方塊」；新增
  `0.19.0（B16 流動水與水桶）新增的簡化`，至少列出：不渲染水位高度、不建立新水源、
  不沖走植被／火把、不破壞農作物、沒有岩漿／含水方塊、流動與下落同為每 0.25 秒
  一格、只從水源裝水、水桶不可裝其他液體。
- 「專案狀態」加 B16 條目（8 任務、版本、驗證數字、未發布）。
- 計畫連結加 `docs/superpowers/plans/2026-11-08-wecraft-b16-flowing-water.md`。

規格：
- §5.2「B15 後仍缺：經驗、流動水」→「B16 後仍缺：經驗」。
- §6 的「水是靜態方塊」改成 B16 簡化摘要；完成清單加「流動水與水桶已於 B16
  （0.19.0）完成」。
- §7 決策記錄加：`B16 流動水與水桶（0.19.0）——使用者 2026-11-08 指示續作、
  內容由實作者決定；本批未獲發布授權。`

- [ ] **Step 3: 發布說明 `docs/releases/v0.19.0.md`**

照 `docs/releases/v0.18.0.md` 的結構寫：
- 標題與摘要（流動水／水桶）。
- 新增：方塊 id 41–48、流動規則、水桶、渲染、效能。
- 修正：無玩家可見修正（若有實作期間修正列在最後）。
- 存檔格式與相容性：本機 v6／雲端 format 4 不變、`cloudSave` 不動；
  新 block id append-only；回退到 0.18.0 時流動水顯示為空氣（水源不變）；
  新物品 id 會被舊版清洗。
- 已知問題／簡化（照規格 §B16）。
- 驗證：typecheck／test／lint／build／perf／pinned pack＋validate／browser smoke；
  測試檔案數與測試數、ZIP bytes／SHA-256、未驗證清單。
- **發布：未執行**（未獲 tag／Release／平台 API 授權）。

- [ ] **Step 4: 完整驗證**

依序跑（每個都要有輸出證據）：
```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run test:perf
```
Expected：typecheck PASS；`npm test` 全綠（把實際「N files / N tests」寫進文件）；
lint PASS；build PASS（記下 bundle 檔名／大小）；perf PASS（記下兩個門檻的 best 值）。

pinned 工具（不要在 repo 內解壓）：
```bash
mkdir -p /tmp/opencode/b16-tools && unzip -q .playroom/tools/playroom-game-tools-1.2.0.zip -d /tmp/opencode/b16-tools
node /tmp/opencode/b16-tools/pack-game.mjs dist /tmp/opencode/b16-game.zip
node /tmp/opencode/b16-tools/validate-game.mjs /tmp/opencode/b16-game.zip
```
Expected：`Packed wecraft v0.19.0`、`Valid: wecraft v0.19.0 (tools 1.2.0)`；
記下 ZIP bytes 與 SHA-256（`sha256sum`）。

- [ ] **Step 5: 真實瀏覽器 smoke（controller 執行；Implementer 只需留下 dist）**

用靜態伺服 `dist/` ＋ 平台 checkout 的 `playwright-core` ＋ `xvfb-run` 有頭
Chromium；探針腳本放 `/tmp/opencode`，不進 repo。至少驗：
1. 標題 → 單人遊戲 → pointer lock；F3 正常。
2. 在海邊挖一格水池旁的沙／土，觀察水在 2 秒內流入（`__wecraft` 或方塊查詢）；
   再把水源用桶子裝走，觀察流動水退去。
3. 合成／給予空桶（或創造清單）→ 右鍵水源得到水桶 → 右鍵方塊倒水 → 水桶變回空桶。
4. 水桶倒出的水會水平流動最多 7 格；第 8 格保持乾燥。
5. 重新載入頁面（存檔／繼續）後，流動水狀態仍一致；失去水源的流動水會退去。
6. 0 console/page error。
把實際探針輸出與截圖路徑寫進 `docs/releases/v0.19.0.md`；做不到的項目列為
「未驗證」，不要推測通過。

- [ ] **Step 6: 把計畫勾選完成並 Commit**

把本計畫所有 `- [ ]` 改成 `- [x]`，在檔尾加 `## Execution results`（版本、
測試數、bundle、ZIP、browser smoke 結果）。然後：
```bash
git add package.json game.json README.md docs/superpowers/specs/2026-10-18-wecraft-parity-design.md docs/releases/v0.19.0.md docs/superpowers/plans/2026-11-08-wecraft-b16-flowing-water.md
git commit -m "docs(b16): 0.19.0 版本、README、規格與發布說明"
```

---

## Self-Review

**1. Spec coverage:** 規格 §B16 的每一條都有任務：方塊 id／定義（Task 1）、流動
規則與批次（Task 2）、`setFluid`／listener（Task 3）、水桶物品與配方（Task 4）、
水-aware 消費者與渲染（Task 5）、main 接線與場次邊界（Task 6）、裝水／倒水（Task 7）、
版本與文件（Task 8）。沒有缺漏。

**2. Step scan:** 每個 step 都是單一動作（寫測試→跑失敗→實作→跑通過→commit）；
沒有「TBD」或「自行判斷」的空泛步驟。測試值（0.25／256／7／41–48／3 鐵錠／
100 抗性）都來自規格。

**3. Type consistency:** `WaterGrid.setBlock(x,y,z,id: BlockId)`、`World.setFluid(...): boolean`、
`WaterSim.tick(dtSec: number): number`、`canFillBucket(waterId, waterT, blockT)`、
`bucketAfterFill()/bucketAfterEmpty(): ItemStack` 在 Task 2／3／6／7 的 Interfaces
與步驟中名稱一致；`isWaterBlock` 在 Task 1 定義、Task 5／6 使用。

**4. Review Focus:** 五條 Review Focus 都指向具體任務與測試（見上）；Task 2 的
未載入／批次／退去、Task 3 的 lightDirty、Task 5 的 mesher 內部面、Task 7 的
水桶守恆都有對應測試。

**5. Proportion:** 計畫長度與 B15 同級（8 任務），沒有把完整實作貼進來；每個
程式步驟只給簽名、規則與關鍵片段，實作者可自行寫出身體。
