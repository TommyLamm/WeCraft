# B14 釣魚與魚類 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把目前沒有用途的水面與線接成一個和平玩法循環：釣魚竿 → 拋線 → 等待魚訊 → 收線 → 魚／垃圾／寶物 → 熔爐烤魚 → 食物與進度。

**Architecture:** 新增純邏輯模組 `src/world/fishing.ts`（拋線、等待、魚訊窗口、收線、戰利品表）與渲染模組 `src/render/fishing.ts`（釣魚線＋浮標）。物品／配方／圖示／食物／熔爐／進度只做 append-only 擴充；`main.ts` 只負責右鍵分流、每幀狀態推進、發獎與音效。**存檔格式不升版**：釣魚竿沿用既有 `ItemStack.dur`、魚是字串 id、浮標是暫態實體（與敵對生物同級，不跨存檔）。

**Tech Stack:** TypeScript 5.6、Vite 5、Vitest 2、Three.js 0.170、jsdom；固定 Playroom game tools 1.2.0。

**Spec:** `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`（Task 8 會加入 §B14）

## Global Constraints

- **本批版本 `0.17.0`**；`game.json`／`package.json` 一起 bump；`id` 維持 `wecraft`；tag 只會是 `v0.17.0`，但**本批未獲發布授權，不推 tag、不建 Release、不呼叫平台 API**。
- **存檔格式不升版**：本機 payload 維持 v6、雲端 `formatVersion` 4、`game.json` 的 `cloudSave` **一字不動**（`readableFormats [1,2,3,4]`、`writeFormat 4`）。新物品 id 只追加；舊版會清洗掉新 id，回退時釣魚竿與魚會消失（寫進 README 與發布說明）。
- 物品表 **106 → 113**：`fishing_rod`、`raw_cod`、`cooked_cod`、`raw_salmon`、`cooked_salmon`、`pufferfish`、`tropical_fish`。
- 配方表 **67 → 68**：釣魚竿（3 木棍＋2 線，原版 3×3 斜向形狀）。
- 進度表 **19 → 20**：`angler`（釣到第一條生魚）。
- 釣魚竿耐久 **64**、堆疊 1；成功收線扣 **1**（創造模式不扣；最後一次使用仍完成收線）。
- 等待時間 **5–30 秒**；魚訊窗口 **2 秒**；拋線射程 **16 格**；只在**水面方塊**上拋線。
- 戰利品：**魚 85%／垃圾 10%／寶物 5%**；魚的權重 cod 60／salmon 25／pufferfish 13／tropical fish 2；垃圾與寶物使用既有物品（見 Task 1 的表）。
- 不新增方塊、不新增材質、不改 iframe／全螢幕／pointer lock／瀏覽器保留鍵行為。
- 驗收工具只用 `.playroom/game-tools.lock.json` 固定的 game tools 1.2.0、SHA-256 `24a2fd36b405ae9f1ce1303e53ac6b0a0d0a2798c04e796f5790a2663d46f022`；不得自行指定版本。
- **2026-11-06 已讀** Playroom `main` 模板與 §1 七份文件（game-development／command-contracts／game.schema.json／game-release.yml／SDK 1.1.0／sdk-versioning／save-compatibility）。本次適用重點：版本遞增與 tag 一致、ZIP 根目錄有 `game.json`、相對路徑與 `base:'./'`、跨來源 sandbox iframe 可玩、不跳頂層／不開 popup／不提交表單、不自行鎖定頂層鍵盤、音效由玩家手勢觸發、`localStorage` 以遊戲 id 命名、雲端存檔失敗不得當空存檔、只有 `saved:true` 顯示已保存、`SAVE_FORMAT_INCOMPATIBLE` 停止寫入、固定工具 pack＋validate、真實瀏覽器 smoke。本次沒有存取平台 API、沒有改 SDK／協定／Manifest schema／`cloudSave`。
- 回報必須區分：程式完成／ZIP 驗證／GitHub Release／平台上架；未做的列為未驗證。

## Review Focus

1. **右鍵優先序與收線**：線已拋出時，右鍵必須先收線（即使瞄準空氣或方塊），不得重新拋線、開介面或放置方塊；換格／打開面板／死亡／離開 playing 都要取消並隱藏釣魚線。
2. **水面瞄準不污染一般互動**：`raycast` 的 `includeWater` 只能是釣魚專用；一般挖掘／放置仍必須穿過水面，不得開始命中水。
3. **發獎不吞不複製**：背包放得下就進背包；放不下時溢出必須掉在玩家腳邊且可撿回；創造模式不得憑空增加耐久或掉落。
4. **耐久與魚訊**：只有「魚訊窗口內成功收線」扣 1 耐久；空收線、錯過魚訊、換格取消都不扣；最後 1 點耐久仍要拿到魚。
5. **狀態與存檔邊界**：浮標與魚訊不進存檔；重開遊戲不得留下幽靈釣魚線；釣魚竿的 `dur` 必須照既有存檔往返規則保存。

---

### Task 1: 釣魚純邏輯 `src/world/fishing.ts`

**Files:**
- Create: `src/world/fishing.ts`
- Create: `src/world/fishing.test.ts`

**Interfaces:**
- Consumes: `ItemId`（`../core/items`）。
- Produces（後續任務只依賴這些簽名）：

```ts
export const FISHING_WAIT_MIN_SEC = 5;
export const FISHING_WAIT_MAX_SEC = 30;
export const FISHING_BITE_WINDOW_SEC = 2;
export const FISHING_CAST_RANGE = 16;

export type FishingPhase = 'waiting' | 'biting' | 'escaped';
export type FishingLootCategory = 'fish' | 'junk' | 'treasure';

export interface FishingState {
  phase: FishingPhase;
  waitRemaining: number;
  biteRemaining: number;
}

export interface FishingTick {
  state: FishingState;
  /** 這一幀剛好進入魚訊（只會 true 一次）。 */
  bite: boolean;
  /** 這一幀剛好錯過魚訊（只會 true 一次）。 */
  escaped: boolean;
}

export interface FishingCatch {
  item: ItemId;
  count: number;
  category: FishingLootCategory;
}

export function rollFishingWait(rng?: () => number): number;
export function beginFishing(waitSec: number): FishingState;
export function stepFishing(state: FishingState, dtSec: number): FishingTick;
export function reelFishing(state: FishingState, rng?: () => number): FishingCatch | null;
export function rollFishingLoot(rng?: () => number): FishingCatch;
```

- 戰利品表（權重總和皆為 100）：

| 類別 | 權重 | 內容 |
|---|---|---|
| fish | 85 | `raw_cod` 60（1）、`raw_salmon` 25（1）、`pufferfish` 13（1）、`tropical_fish` 2（1） |
| junk | 10 | `stick` 20（2）、`string` 20（1）、`rotten_flesh` 15（1）、`bone` 15（1）、`leather` 15（1）、`oak_planks` 15（4） |
| treasure | 5 | `iron_ingot` 50（1）、`gold_ingot` 25（1）、`diamond` 5（1）、`bow` 10（1）、`leather_boots` 10（1） |

- [x] **Step 1: 寫等待／魚訊狀態機的失敗測試**

`src/world/fishing.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  FISHING_WAIT_MIN_SEC,
  FISHING_WAIT_MAX_SEC,
  FISHING_BITE_WINDOW_SEC,
  FISHING_CAST_RANGE,
  rollFishingWait,
  beginFishing,
  stepFishing,
  reelFishing,
} from './fishing';

const seq = (...values: number[]): (() => number) => {
  let i = 0;
  return () => values[i++] ?? 0;
};

describe('fishing tuning and wait roll', () => {
  it('pins the tuning constants', () => {
    expect(FISHING_WAIT_MIN_SEC).toBe(5);
    expect(FISHING_WAIT_MAX_SEC).toBe(30);
    expect(FISHING_BITE_WINDOW_SEC).toBe(2);
    expect(FISHING_CAST_RANGE).toBe(16);
  });

  it('rolls a wait in [5, 30] and treats a bad rng as the minimum', () => {
    expect(rollFishingWait(() => 0)).toBe(5);
    expect(rollFishingWait(() => 0.5)).toBe(17.5);
    expect(rollFishingWait(() => 1)).toBe(30);
    expect(rollFishingWait(() => Number.NaN)).toBe(5);
    expect(rollFishingWait(() => -1)).toBe(5);
    expect(rollFishingWait(() => 2)).toBe(30);
  });

  it('beginFishing clamps the wait and starts waiting', () => {
    expect(beginFishing(12).phase).toBe('waiting');
    expect(beginFishing(12).waitRemaining).toBe(12);
    expect(beginFishing(-3).waitRemaining).toBe(0);
    expect(beginFishing(99).waitRemaining).toBe(30);
    expect(beginFishing(Number.NaN).waitRemaining).toBe(5);
  });
});

describe('fishing state machine', () => {
  it('counts down, enters biting exactly once, then escapes after the window', () => {
    const wait = beginFishing(1);
    const almost = stepFishing(wait, 0.4);
    expect(almost.state).toEqual({ phase: 'waiting', waitRemaining: 0.6, biteRemaining: 0 });
    expect(almost.bite).toBe(false);

    const bitten = stepFishing(almost.state, 0.7);
    expect(bitten.bite).toBe(true);
    expect(bitten.escaped).toBe(false);
    expect(bitten.state).toEqual({
      phase: 'biting',
      waitRemaining: 0,
      biteRemaining: FISHING_BITE_WINDOW_SEC,
    });

    const stillBiting = stepFishing(bitten.state, 1.9);
    expect(stillBiting.bite).toBe(false);
    expect(stillBiting.escaped).toBe(false);
    expect(stillBiting.state.biteRemaining).toBeCloseTo(0.1, 10);

    const escaped = stepFishing(stillBiting.state, 0.1);
    expect(escaped.escaped).toBe(true);
    expect(escaped.state.phase).toBe('escaped');
    expect(stepFishing(escaped.state, 1).escaped).toBe(false);
  });

  it('does not carry a large dt into the bite window', () => {
    const t = stepFishing(beginFishing(0.5), 10);
    expect(t.bite).toBe(true);
    expect(t.state.biteRemaining).toBe(FISHING_BITE_WINDOW_SEC);
  });

  it('ignores non-finite or non-positive dt', () => {
    const s = beginFishing(3);
    expect(stepFishing(s, 0).state).toEqual(s);
    expect(stepFishing(s, -1).state).toEqual(s);
    expect(stepFishing(s, Number.NaN).state).toEqual(s);
  });

  it('only reels a catch while biting', () => {
    const waiting = beginFishing(1);
    expect(reelFishing(waiting, () => 0)).toBeNull();
    const biting = stepFishing(waiting, 1).state;
    expect(reelFishing(biting, seq(0, 0))).toEqual({
      item: 'raw_cod',
      count: 1,
      category: 'fish',
    });
    expect(reelFishing({ ...biting, phase: 'escaped' }, () => 0)).toBeNull();
  });
});
```

- [x] **Step 2: 寫戰利品表的失敗測試**

```ts
describe('fishing loot table', () => {
  it('uses the 85/10/5 category split', () => {
    expect(rollFishingLoot(seq(0.8499, 0)).category).toBe('fish');
    expect(rollFishingLoot(seq(0.85, 0)).category).toBe('junk');
    expect(rollFishingLoot(seq(0.9499, 0)).category).toBe('junk');
    expect(rollFishingLoot(seq(0.95, 0)).category).toBe('treasure');
  });

  it('rolls the four fish at 60/25/13/2', () => {
    expect(rollFishingLoot(seq(0, 0)).item).toBe('raw_cod');
    expect(rollFishingLoot(seq(0, 0.5999)).item).toBe('raw_cod');
    expect(rollFishingLoot(seq(0, 0.6)).item).toBe('raw_salmon');
    expect(rollFishingLoot(seq(0, 0.8499)).item).toBe('raw_salmon');
    expect(rollFishingLoot(seq(0, 0.85)).item).toBe('pufferfish');
    expect(rollFishingLoot(seq(0, 0.9799)).item).toBe('pufferfish');
    expect(rollFishingLoot(seq(0, 0.98)).item).toBe('tropical_fish');
  });

  it('rolls junk and treasure from the existing item pool', () => {
    expect(rollFishingLoot(seq(0.85, 0))).toEqual({ item: 'stick', count: 2, category: 'junk' });
    expect(rollFishingLoot(seq(0.85, 0.4))).toEqual({ item: 'rotten_flesh', count: 1, category: 'junk' });
    expect(rollFishingLoot(seq(0.85, 0.999))).toEqual({ item: 'oak_planks', count: 4, category: 'junk' });
    expect(rollFishingLoot(seq(0.95, 0))).toEqual({ item: 'iron_ingot', count: 1, category: 'treasure' });
    expect(rollFishingLoot(seq(0.95, 0.75))).toEqual({ item: 'diamond', count: 1, category: 'treasure' });
    expect(rollFishingLoot(seq(0.95, 0.999))).toEqual({ item: 'leather_boots', count: 1, category: 'treasure' });
  });

  it('never returns NaN or an unknown item for a bad rng', () => {
    const bad = rollFishingLoot(seq(Number.NaN, Number.NaN));
    expect(bad.category).toBe('fish');
    expect(bad.item).toBe('raw_cod');
    expect(bad.count).toBe(1);
    expect(rollFishingLoot(() => Number.POSITIVE_INFINITY).item).toBe('raw_cod');
  });
});
```

- [x] **Step 3: 跑測試確認失敗**

Run: `npx vitest run src/world/fishing.test.ts`
Expected: FAIL，`Cannot find module './fishing'`。

- [x] **Step 4: 實作 `src/world/fishing.ts`**

要點：

- `nextRoll(rng)`：`const v = rng();` 非有限 → 0；夾到 `[0, 0.999999]`（`1` 不可讓加權選取溢位）。
- `rollFishingWait`：`MIN + nextRoll(rng) * (MAX - MIN)`。
- `beginFishing`：非有限 → `MIN`；其餘夾到 `[0, MAX]`；回 `{ phase:'waiting', waitRemaining: wait, biteRemaining: 0 }`。
- `stepFishing`：
  - 非有限或 `dt <= 0`，或 `state.phase === 'escaped'` → 回 `{ state: { ...state }, bite:false, escaped:false }`。
  - waiting：`remaining = state.waitRemaining - dt`；`remaining <= 0` → `{ phase:'biting', waitRemaining:0, biteRemaining:FISHING_BITE_WINDOW_SEC }` 且 `bite:true`；否則回 waiting 的新物件。
  - biting：`remaining = state.biteRemaining - dt`；`remaining <= 0` → `{ phase:'escaped', waitRemaining:0, biteRemaining:0 }` 且 `escaped:true`；否則回 biting 的新物件。
- `reelFishing`：`state.phase !== 'biting'` → null；否則 `rollFishingLoot(rng)`。
- `rollFishingLoot`：先一次 `nextRoll` 選類別（`<0.85` fish、`<0.95` junk、其餘 treasure），再一次 `nextRoll` 選該表的加權項目；回 `{ item, count, category }`。
- 加權選取：`target = roll * 100`，累加 weight，`target < cumulative` 即回該項；全部沒中回最後一項。
- 註解要寫明：本作沒有原版「開放水域 5×4×5」判定、沒有天氣／幸運加成、等待與魚訊是自訂簡化值（README 會列）。

- [x] **Step 5: 跑測試確認通過**

Run: `npx vitest run src/world/fishing.test.ts`
Expected: PASS。

- [x] **Step 6: Commit**

```bash
git add src/world/fishing.ts src/world/fishing.test.ts
git commit -m "feat(b14): 釣魚等待、魚訊與戰利品純邏輯"
```

---

### Task 2: 物品、耐久、配方、圖示

**Files:**
- Modify: `src/core/items.ts`
- Modify: `src/core/items.test.ts`
- Modify: `src/core/durability.ts`
- Modify: `src/core/durability.test.ts`
- Modify: `src/core/recipes.ts`
- Modify: `src/core/recipes.test.ts`
- Modify: `src/ui/icons.ts`
- Modify: `src/ui/icons.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `ItemId` 名稱（`raw_cod` 等）；既有 `ItemId`／`ITEM_IDS`／`STACK_ONE`／`TOOL_MAX_DURABILITY`／`RECIPES`／`drawItemArt`。
- Produces:
  - 新 `ItemId`：`'fishing_rod' | 'raw_cod' | 'cooked_cod' | 'raw_salmon' | 'cooked_salmon' | 'pufferfish' | 'tropical_fish'`
  - `ALL_ITEM_IDS` 共 **113** 個；`TOTAL_ITEM_COUNT = 113`
  - `maxDurability('fishing_rod') === 64`；`maxStack('fishing_rod') === 1`
  - 配方 68 筆：`fishing_rod`（3 木棍＋2 線）
  - `drawItemArt` 有 7 個新 case 標籤

- [x] **Step 1: 寫失敗測試**

`src/core/items.test.ts`：

- `TOTAL_ITEM_COUNT` 改成 `113`，註解加「B14 再補 7 個（釣魚竿＋6 種魚）」。
- `ALL_ITEMS` mirror 加：

```ts
const B14_ITEM_IDS: ItemId[] = [
  'fishing_rod', 'raw_cod', 'cooked_cod', 'raw_salmon',
  'cooked_salmon', 'pufferfish', 'tropical_fish',
];
```

- 新增：

```ts
it('B14: fish stack to 64 and the fishing rod is stack-one with 64 durability', () => {
  for (const id of ['raw_cod', 'cooked_cod', 'raw_salmon', 'cooked_salmon', 'pufferfish', 'tropical_fish'] as const) {
    expect(ALL_ITEM_IDS).toContain(id);
    expect(blockFromItem(id)).toBeNull();
    expect(maxStack(id)).toBe(64);
    expect(maxDurability(id)).toBe(0);
  }
  expect(ALL_ITEM_IDS).toContain('fishing_rod');
  expect(blockFromItem('fishing_rod')).toBeNull();
  expect(maxStack('fishing_rod')).toBe(1);
  expect(maxDurability('fishing_rod')).toBe(64);
  expect(sanitizeStack({ item: 'fishing_rod', count: 1 })).toEqual({
    item: 'fishing_rod', count: 1, dur: 64,
  });
  expect(stackName('raw_cod')).toBe('Raw Cod');
  expect(stackName('tropical_fish')).toBe('Tropical Fish');
});
```

`src/core/durability.test.ts` 加：

```ts
it('B14: the fishing rod has 64 uses', () => {
  expect(maxDurability('fishing_rod')).toBe(64);
});
```

`src/core/recipes.test.ts`：

- `RECIPES.length` 由 67 改成 68，id 清單加 `'fishing_rod'`。
- 新增：

```ts
it('B14: the fishing rod is 3 sticks and 2 string in the vanilla diagonal', () => {
  const r = recipe('fishing_rod');
  expect(r.kind).toBe('shaped');
  expect(r.result).toEqual({ item: 'fishing_rod', count: 1 });
  if (r.kind === 'shaped') {
    expect(r.pattern).toEqual([
      [null, null, 'stick'],
      [null, 'stick', 'string'],
      ['stick', null, 'string'],
    ]);
  }
});
```

`src/ui/icons.test.ts` 加：

```ts
it('every B14 non-block item id has its own icon branch', () => {
  const labels = new Set(drawItemArtCaseLabels(ICONS_SOURCE));
  const B14_NEEDS_ART = [
    'fishing_rod', 'raw_cod', 'cooked_cod', 'raw_salmon',
    'cooked_salmon', 'pufferfish', 'tropical_fish',
  ] as const;
  expect(B14_NEEDS_ART).toHaveLength(7);
  for (const id of B14_NEEDS_ART) {
    expect(blockFromItem(id), `${id} 不應有方塊物品形式`).toBeNull();
    expect(labels.has(id), `icons.ts drawItemArt() has no case for ${id}`).toBe(true);
  }
});
```

- [x] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/items.test.ts src/core/durability.test.ts src/core/recipes.test.ts src/ui/icons.test.ts`
Expected: FAIL（新 id 不在 union、`RECIPES.length` 仍是 67、圖示 case 不存在）。

- [x] **Step 3: 實作 `src/core/items.ts`**

- union 加 7 個 id（註解寫 B14 用途）。
- `ITEM_IDS` 加 7 個 `true`。
- `ALL_ITEM_IDS` 註解總數改成 113。
- `STACK_ONE` 加 `fishing_rod`（魚可堆疊 64）。
- 不加 `BLOCK_PAIRS`（七個都不是方塊）。

- [x] **Step 4: 實作 `src/core/durability.ts`**

```ts
fishing_rod: 64,
```

- [x] **Step 5: 實作 `src/core/recipes.ts`**

在格常量附近加：

```ts
// B14：釣魚竿（3 木棍＋2 線，原版斜向形狀）。
const ROD_STICK: PatternCell = 'stick';
const ROD_STRING: PatternCell = 'string';
```

在 `RECIPES` 末端加：

```ts
{
  id: 'fishing_rod',
  kind: 'shaped',
  pattern: [
    [null, null, ROD_STICK],
    [null, ROD_STICK, ROD_STRING],
    [ROD_STICK, null, ROD_STRING],
  ],
  result: { item: 'fishing_rod', count: 1 },
},
```

把檔頭「exactly 67」改成 68。

- [x] **Step 6: 實作 `src/ui/icons.ts`**

在 `drawItemArt` 的 switch 加 7 個 case（每個標籤都要出現）：

- `fishing_rod`：木色斜竿＋一條白色釣線＋小圓捲線器。
- `raw_cod`／`raw_salmon`：魚身輪廓（灰藍／橘紅）＋尾巴＋眼睛；salmon 比 cod 寬一點。
- `cooked_cod`／`cooked_salmon`：同輪廓但棕褐色、加淺色烤痕。
- `pufferfish`：圓形黃綠色身體＋短刺。
- `tropical_fish`：小三角形身體＋黃／藍條紋。

可加一個私有 helper（例如 `drawFishIcon(ctx, body, fin, cooked)`），但四個魚 case 標籤仍要各自出現。不要讓任何新 id 掉進 `default`。

- [x] **Step 7: 跑測試確認通過**

Run: `npx vitest run src/core/items.test.ts src/core/durability.test.ts src/core/recipes.test.ts src/ui/icons.test.ts`
Expected: PASS。

- [x] **Step 8: Commit**

```bash
git add src/core/items.ts src/core/items.test.ts src/core/durability.ts src/core/durability.test.ts src/core/recipes.ts src/core/recipes.test.ts src/ui/icons.ts src/ui/icons.test.ts
git commit -m "feat(b14): 新增釣魚竿與六種魚物品、配方、圖示"
```

---

### Task 3: 食物值、熔爐烤魚、釣魚進度

**Files:**
- Modify: `src/player/eat.ts`
- Modify: `src/player/eat.test.ts`
- Modify: `src/world/furnace.ts`
- Modify: `src/world/furnace.test.ts`
- Modify: `src/core/advancements.ts`
- Modify: `src/core/advancements.test.ts`

**Interfaces:**
- Consumes: Task 2 的 7 個 `ItemId`。
- Produces:
  - `FOOD_VALUES` 新增：`raw_cod {2,0.4}`、`cooked_cod {5,6}`、`raw_salmon {2,0.4}`、`cooked_salmon {6,9.6}`、`pufferfish {1,0.2}`、`tropical_fish {1,0.2}`
  - `SMELT_RECIPES` 新增：`raw_cod → cooked_cod`、`raw_salmon → cooked_salmon`
  - `AdvancementId` 新增 `'angler'`；`ADVANCEMENTS` 19 → **20**；`OBTAIN_UNLOCKS` 四種生魚 → `angler`

- [x] **Step 1: 寫失敗測試**

`src/player/eat.test.ts` 的精確表加六筆：

```ts
raw_cod: { food: 2, saturation: 0.4 },
cooked_cod: { food: 5, saturation: 6 },
raw_salmon: { food: 2, saturation: 0.4 },
cooked_salmon: { food: 6, saturation: 9.6 },
pufferfish: { food: 1, saturation: 0.2 },
tropical_fish: { food: 1, saturation: 0.2 },
```

並加：

```ts
it('B14: all six fish are edible and cooked fish restore more', () => {
  expect(foodFor('cooked_cod')).toEqual({ food: 5, saturation: 6 });
  expect(foodFor('cooked_salmon')).toEqual({ food: 6, saturation: 9.6 });
  expect(canEat({ ...createVitals(), hunger: 10 }, 'cooked_salmon')).toBe(true);
  expect(canEat({ ...createVitals(), hunger: 20 }, 'cooked_salmon')).toBe(false);
});
```

`src/world/furnace.test.ts` 加：

```ts
it('B14: raw cod and salmon smelt into their cooked forms', () => {
  expect(SMELT_RECIPES.raw_cod).toBe('cooked_cod');
  expect(SMELT_RECIPES.raw_salmon).toBe('cooked_salmon');
});
```

`src/core/advancements.test.ts` 的 `TRIGGERS` 加：

```ts
['angler', [
  [{ type: 'obtain', item: 'raw_cod', mode: 'survival' }],
  [{ type: 'obtain', item: 'raw_salmon', mode: 'survival' }],
  [{ type: 'obtain', item: 'pufferfish', mode: 'survival' }],
  [{ type: 'obtain', item: 'tropical_fish', mode: 'survival' }],
]],
```

再加：

```ts
it('B14: the advancement table has 20 entries with angler', () => {
  expect(ADVANCEMENTS).toHaveLength(20);
  const angler = ADVANCEMENTS.find((a) => a.id === 'angler');
  expect(angler?.icon).toBe('raw_cod');
  expect(angler?.title).toBe('釣魚翁');
});
```

- [x] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/player/eat.test.ts src/world/furnace.test.ts src/core/advancements.test.ts`
Expected: FAIL（食物表缺六筆、熔爐缺兩筆、`angler` 不存在）。

- [x] **Step 3: 實作**

`eat.ts` 的 `FOOD_VALUES` 加六筆（數值照上表；註解寫原版 wiki 與「本作沒有狀態效果，pufferfish 只給食物值」）。

`furnace.ts` 的 `SMELT_RECIPES` 加：

```ts
raw_cod: 'cooked_cod',
raw_salmon: 'cooked_salmon',
```

`advancements.ts`：

- `AdvancementId` 加 `'angler'`。
- `ADVANCEMENTS` 在 `baker` 後加：

```ts
{ id: 'angler', title: '釣魚翁', description: '釣到第一條魚', icon: 'raw_cod' },
```

- `OBTAIN_UNLOCKS` 加：

```ts
raw_cod: 'angler',
raw_salmon: 'angler',
pufferfish: 'angler',
tropical_fish: 'angler',
```

- [x] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/player/eat.test.ts src/world/furnace.test.ts src/core/advancements.test.ts`
Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add src/player/eat.ts src/player/eat.test.ts src/world/furnace.ts src/world/furnace.test.ts src/core/advancements.ts src/core/advancements.test.ts
git commit -m "feat(b14): 魚類食物值、烤魚與釣魚進度"
```

---

### Task 4: 射線的水面選項

**Files:**
- Modify: `src/world/raycast.ts`
- Modify: `src/world/raycast.test.ts`

**Interfaces:**
- Consumes: `BLOCK.WATER`、既有 `World.isTargetable`。
- Produces:
  - `RaycastOptions.includeWater?: boolean`
  - 預設 `false` → 既有行為完全不變（水不可命中）
  - `true` → 水也算可命中（釣魚拋線專用）

- [x] **Step 1: 寫失敗測試**

`src/world/raycast.test.ts` 加：

```ts
it('B14: includeWater makes the ray stop at the water surface (default stays null)', () => {
  const w = setup();
  w.setBlock(0, 64, -2, BLOCK.WATER);
  const origin = { x: 0.5, y: 64.5, z: 0.5 };
  const dir = { x: 0, y: 0, z: -1 };
  expect(raycast(w, origin, dir, 10)).toBeNull();
  const hit = raycast(w, origin, dir, 10, { includeWater: true });
  expect(hit).not.toBeNull();
  expect(hit!.z).toBe(-2);
  expect(hit!.nz).toBe(1);
});

it('B14: includeWater still stops at an earlier solid block', () => {
  const w = setup();
  w.setBlock(0, 64, -2, BLOCK.STONE);
  w.setBlock(0, 64, -4, BLOCK.WATER);
  const hit = raycast(
    w, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: -1 }, 10,
    { includeWater: true },
  );
  expect(hit!.z).toBe(-2);
});
```

- [x] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/world/raycast.test.ts`
Expected: FAIL（`includeWater` 不存在／水仍回 null）。

- [x] **Step 3: 實作 `src/world/raycast.ts`**

- import `BLOCK`（`./blocks`）。
- `RaycastOptions` 加：
  ```ts
  /** B14：把水也當可命中（釣魚拋線專用；預設 false＝既有行為）。 */
  includeWater?: boolean;
  ```
- 在 `raycast` 內取 `const includeWater = options?.includeWater === true;`
- 新增局部判定：
  ```ts
  const isHit = (x: number, y: number, z: number): boolean =>
    world.isTargetable(x, y, z) || (includeWater && world.getBlock(x, y, z) === BLOCK.WATER);
  ```
- 把兩處 `world.isTargetable(x, y, z)`（start-inside 與 DDA 迴圈）改成 `isHit(x, y, z)`；註解寫明預設路徑不變。
- 不要改 `World.isTargetable` 本身（其他系統仍必須穿過水）。

- [x] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/world/raycast.test.ts`
Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add src/world/raycast.ts src/world/raycast.test.ts
git commit -m "feat(b14): 射線支援釣魚專用的水面命中"
```

---

### Task 5: 釣魚線與浮標渲染 `src/render/fishing.ts`

**Files:**
- Create: `src/render/fishing.ts`
- Create: `src/render/fishing.test.ts`

**Interfaces:**
- Consumes: `THREE`、`Vec3`（`../core/daynight`）。
- Produces:

```ts
export interface FishingLineView {
  bobber: { x: number; y: number; z: number };
  biting: boolean;
}

export interface FishingRenderer {
  /** null → hide the whole line; otherwise re-anchor to the camera and place the bobber. */
  sync(line: FishingLineView | null, camera: THREE.Camera): void;
  dispose(): void;
}

export function createFishingRenderer(scene: THREE.Scene): FishingRenderer;
```

- [x] **Step 1: 寫失敗測試**

`src/render/fishing.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createFishingRenderer } from './fishing';

function setup() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 10, 0);
  camera.lookAt(0, 10, -1);
  const renderer = createFishingRenderer(scene);
  return { scene, camera, renderer };
}

describe('fishing renderer (B14)', () => {
  it('adds one line + bobber group and hides it when the line is null', () => {
    const { scene, camera, renderer } = setup();
    expect(scene.children).toHaveLength(1);
    renderer.sync(null, camera);
    expect(scene.children[0].visible).toBe(false);

    renderer.sync({ bobber: { x: 2, y: 5, z: -3 }, biting: false }, camera);
    expect(scene.children[0].visible).toBe(true);
    renderer.dispose();
  });

  it('places the bobber at the water point and dips it while biting', () => {
    const { scene, camera, renderer } = setup();
    renderer.sync({ bobber: { x: 2, y: 5, z: -3 }, biting: false }, camera);
    const group = scene.children[0] as THREE.Group;
    const bobber = group.children.find((c) => c.name === 'fishing-bobber') as THREE.Group;
    expect(bobber.position.x).toBeCloseTo(2, 5);
    expect(bobber.position.y).toBeCloseTo(5, 5);
    expect(bobber.position.z).toBeCloseTo(-3, 5);

    renderer.sync({ bobber: { x: 2, y: 5, z: -3 }, biting: true }, camera);
    expect(bobber.position.y).toBeCloseTo(4.95, 5);
    renderer.dispose();
  });

  it('draws a two-point line from the camera-side rod tip to the bobber', () => {
    const { scene, camera, renderer } = setup();
    renderer.sync({ bobber: { x: 2, y: 5, z: -3 }, biting: false }, camera);
    const group = scene.children[0] as THREE.Group;
    const line = group.children.find((c) => c.name === 'fishing-line') as THREE.Line;
    const pos = line.geometry.getAttribute('position');
    expect(pos.count).toBe(2);
    expect(pos.getX(0)).toBeCloseTo(0, 5); // camera at origin, +right offset is 0 for this yaw
    expect(pos.getY(0)).toBeLessThan(10); // below the eye (rod-tip approximation)
    expect(pos.getZ(0)).toBeGreaterThan(-1); // slightly in front of the camera
    expect(pos.getX(1)).toBeCloseTo(2, 5);
    expect(pos.getY(1)).toBeCloseTo(5, 5);
    expect(pos.getZ(1)).toBeCloseTo(-3, 5);
    renderer.dispose();
  });

  it('dispose is idempotent and removes the group', () => {
    const { scene, camera, renderer } = setup();
    renderer.sync({ bobber: { x: 0, y: 5, z: -2 }, biting: false }, camera);
    renderer.dispose();
    expect(scene.children).toHaveLength(0);
    expect(() => renderer.dispose()).not.toThrow();
  });
});
```

- [x] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/render/fishing.test.ts`
Expected: FAIL，`Cannot find module './fishing'`。

- [x] **Step 3: 實作 `src/render/fishing.ts`**

要點：

- 建一個 `THREE.Group`（name `'fishing-rig'`），內含：
  - `THREE.Line`（name `'fishing-line'`，白／淺灰 `LineBasicMaterial`，`fog:false`，`transparent:true`，`opacity:0.75`），幾何兩個點（`BufferGeometry` + `Float32BufferAttribute`）。
  - 浮標 `THREE.Group`（name `'fishing-bobber'`）：紅色 `BoxGeometry(0.12,0.12,0.12)` ＋ 上方白色 `BoxGeometry(0.08,0.06,0.08)`，材質 `MeshBasicMaterial`（不被光照影響，水面上清楚可見）。
- `sync(line, camera)`：
  - `camera.updateMatrixWorld()`。
  - `group.visible = line !== null`；null 直接 return。
  - 從 `camera.matrixWorld.elements` 取 right（0,1,2）、up（4,5,6）、forward = `-column3`（-8,-9,-10）。
  - 線起點＝`camera.position + right*0.35 + up*(-0.22) + forward*0.85`（釣竿尖端的近似；不需要匯入 viewmodel）。
  - 浮標位置＝`bobber`；`biting` 時 `y -= 0.05`。
  - 線終點＝浮標位置 + `y 0.12`（浮標頂）。
  - 更新 position attribute 的兩個點，`needsUpdate = true`。
- `dispose()`：scene.remove(group)、dispose 所有 geometry／material；二次呼叫安全。
- 註解寫明：這是**視覺簡化**，沒有釣魚線物理、沒有浮標在水面漂移、第三人稱時線從相機附近出發。

- [x] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/render/fishing.test.ts`
Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add src/render/fishing.ts src/render/fishing.test.ts
git commit -m "feat(b14): 釣魚線與浮標渲染"
```

---

### Task 6: 釣魚音效

**Files:**
- Modify: `src/audio/voices.ts`
- Modify: `src/audio/voices.test.ts`
- Modify: `src/audio/index.ts`
- Modify: `src/audio/index.test.ts`

**Interfaces:**
- Consumes: 既有 `createNoiseBuffer`／`gainForDistance`／`FakeAudioContext`。
- Produces:
  - `voices.ts`：`fishingSplash(ctx, dest, noise, volume?)`、`fishingBite(ctx, dest, volume?)`
  - `GameAudio`：`playFishingSplash(opts?: PlayOptions)`、`playFishingBite(opts?: PlayOptions)`
  - 兩者都走 `gainForDistance`、引擎未啟動時 no-op（與既有音效一致）

- [x] **Step 1: 寫失敗測試**

`src/audio/voices.test.ts` import 加 `fishingBite, fishingSplash`，並加：

```ts
it('B14: fishing splash is a short low-passed noise burst', () => {
  const fake = new FakeAudioContext();
  const noise = new FakeAudioBuffer(1, fake.sampleRate, fake.sampleRate);
  fishingSplash(asCtx(fake), asNode(fake.destination), asBuffer(noise), 0.5);
  const source = fake.bufferSources[0];
  const filter = fake.biquads[0];
  expect(source.buffer).toBe(noise);
  expect(filter.type).toBe('lowpass');
  expect(source.stopCalls[0].when).toBeCloseTo(0.22, 5);
  const gain = fake.gains[0];
  expect(gain.gain.peak).toBeGreaterThan(0);
});

it('B14: fishing bite is a short two-pip sine', () => {
  const fake = new FakeAudioContext();
  fishingBite(asCtx(fake), asNode(fake.destination), 0.5);
  expect(fake.oscillators).toHaveLength(1);
  const osc = fake.oscillators[0];
  expect(osc.type).toBe('sine');
  expect(osc.frequency.sets.length).toBeGreaterThanOrEqual(2);
  expect(osc.stopCalls[0].when).toBeCloseTo(0.18, 5);
  expect(fake.gains[0].gain.peak).toBeGreaterThan(0);
});
```

`src/audio/index.test.ts` 加：

```ts
// ---- B14：釣魚音效 ----
it('playFishingSplash and playFishingBite route through the master bus', () => {
  const { fake, audio } = setup();
  audio.ensureStarted();
  const master = fake.gains[0];

  audio.playFishingSplash();
  audio.playFishingBite();

  expect(fake.bufferSources).toHaveLength(1);
  expect(fake.oscillators).toHaveLength(1);
  for (const g of fake.gains.slice(1)) expect(g.outputs).toContain(master);
});

it('the fishing sounds are silent beyond the audible distance and inert before start', () => {
  const far = { pos: { x: 40, y: 0, z: 0 }, listener: { x: 0, y: 0, z: 0 } };
  const { fake, audio } = setup();
  audio.ensureStarted();
  audio.playFishingSplash(far);
  audio.playFishingBite(far);
  for (const g of fake.gains.slice(1)) expect(g.gain.peak).toBe(0);

  const fresh = new FakeAudioContext();
  const inert = createGameAudio({ createContext: () => fresh as unknown as AudioContext });
  inert.playFishingSplash();
  inert.playFishingBite();
  expect(fresh.created).toHaveLength(0);
});
```

- [x] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/audio/voices.test.ts src/audio/index.test.ts`
Expected: FAIL（函式不存在）。

- [x] **Step 3: 實作 `src/audio/voices.ts`**

- `fishingSplash`：0.22 秒低通噪音（freq 600、Q 0.7、gain 0.45），attack 0.01、release 到 0.22。
- `fishingBite`：一個 sine oscillator，`frequency.setValueAtTime(700, now)`、`linearRampToValueAtTime(950, now+0.08)`，gain 0→0.25→0，`stop(now+0.18)`。
- 兩者 `volume` 先 `Math.max(0, Number.isFinite(volume) ? volume : 0)`，不讓 NaN 進 gain。
- 註解寫明是程序合成近似（原版 `entity.fishing.bobber` 等取樣）。

- [x] **Step 4: 實作 `src/audio/index.ts`**

- `GameAudio` 介面加兩個方法與註解。
- import `fishingBite, fishingSplash`。
- 各自做一個函式（與 `playBowShoot` 同一個距離衰減模板），呼叫 voice。
- return 物件加兩個方法。

- [x] **Step 5: 跑測試確認通過**

Run: `npx vitest run src/audio/voices.test.ts src/audio/index.test.ts`
Expected: PASS。

- [x] **Step 6: Commit**

```bash
git add src/audio/voices.ts src/audio/voices.test.ts src/audio/index.ts src/audio/index.test.ts
git commit -m "feat(b14): 釣魚潑水與魚訊音效"
```

---

### Task 7: `main.ts` 右鍵分流、每幀推進、發獎與渲染接線

**Files:**
- Modify: `src/main.ts`
- Modify: `src/main.wiring.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `FISHING_CAST_RANGE`／`beginFishing`／`rollFishingWait`／`stepFishing`／`reelFishing`；Task 2 的 `fishing_rod`；Task 4 的 `raycast(..., { includeWater:true })`；Task 5 的 `createFishingRenderer`；Task 6 的 `audio.playFishingSplash`／`playFishingBite`；既有 `giveItem`／`damageHeldTool`／`spawnDrop`／`hudHint`／`bus`。
- Produces（模組層）：
  - `interface ActiveFishing { state: FishingState; bobber: {x,y,z}; slot: number }`
  - `let fishing: ActiveFishing | null = null`
  - `function heldIsFishingRod(): boolean`
  - `function tryCastFishing(from, aim): void`
  - `function tryReelFishing(): void`
  - `const fishingRenderer = createFishingRenderer(gs.scene)`
  - 每幀 `stepFishing` 與 `fishingRenderer.sync(...)` 各一處

- [x] **Step 1: 更新／新增接線釘子**

在 `src/main.wiring.test.ts`：

- 既有 `damageHeldTool(1)` 的精確次數 **8 → 9**，說明加「b14 成功收線」。
- 在 B14 describe 內新增：

```ts
describe('main.ts 接線（B14：釣魚）', () => {
  it('the rod branch is after block use / before bow / food / placement', () => {
    const body = blockAfter('if (wantPlace) {');
    const fishingAt = body.indexOf('heldIsFishingRod()');
    for (const marker of [
      'hitBlock === BLOCK.CRAFTING_TABLE',
      'hitBlock === BLOCK.FURNACE',
      'hitBlock === BLOCK.CHEST',
      'hitBlock === BLOCK.BED',
      'hitBlock === BLOCK.TNT',
    ]) {
      expect(body.indexOf(marker), `${marker} must run before the rod`).toBeLessThan(fishingAt);
    }
    expect(fishingAt).toBeLessThan(body.indexOf('heldIsBow()'));
    expect(fishingAt).toBeLessThan(body.indexOf('heldIsFood()'));
  });

  it('an active line reels before every block interaction, even with no hit', () => {
    const body = blockAfter('if (wantPlace) {');
    const reelAt = body.indexOf('tryReelFishing()');
    expect(reelAt).toBeGreaterThanOrEqual(0);
    expect(reelAt).toBeLessThan(body.indexOf('hitBlock === BLOCK.CRAFTING_TABLE'));
    expect(body).toContain('if (fishing)');
  });

  it('the cast ray is water-only within the fishing range', () => {
    const body = functionBody('tryCastFishing');
    expect(body).toContain('includeWater: true');
    expect(body).toContain('FISHING_CAST_RANGE');
    expect(body).toContain('BLOCK.WATER');
    expect(body).toContain('beginFishing(');
    expect(body).toContain('rollFishingWait(');
  });

  it('the catch path gives the item, spawns overflow, and only then damages the rod', () => {
    const body = functionBody('tryReelFishing');
    const giveAt = body.indexOf('giveItem(');
    const overflowAt = body.indexOf('spawnDrop(');
    const durAt = body.indexOf('damageHeldTool(1)');
    expect(giveAt).toBeGreaterThanOrEqual(0);
    expect(overflowAt).toBeGreaterThan(giveAt);
    expect(durAt).toBeGreaterThan(overflowAt);
    expect(body).toContain('reelFishing(');
  });

  it('the playing loop steps the line once and cancels on slot / distance / water loss', () => {
    const playing = playingBranchBody();
    expect(countOf('stepFishing(')).toBe(1);
    expect(playing).toContain('selected !== fishing.slot');
    expect(playing).toContain('FISHING_CAST_RANGE');
    expect(playing).toContain('BLOCK.WATER');
    expect(playing).toContain('tryReelFishing');
  });

  it('the fishing line is rendered every frame and only while playing', () => {
    expect(countOf('fishingRenderer.sync(')).toBe(1);
    expect(mainSource).toContain("state === 'playing' && fishing");
    expect(mainSource).toContain('fishingRenderer.sync(');
  });

  it('leaving playing and resetting a session both drop the line', () => {
    const setStateBody = functionBody('setState');
    expect(setStateBody).toContain('fishing = null');
    expect(functionBody('resetSessionEntities')).toContain('fishing = null');
  });
});
```

- [x] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/main.wiring.test.ts`
Expected: FAIL（`fishing` 不存在、`damageHeldTool(1)` 仍是 8）。

- [x] **Step 3: 在 `src/main.ts` 加 import、renderer 與模組狀態**

import：

```ts
import {
  FISHING_CAST_RANGE,
  beginFishing,
  reelFishing,
  rollFishingWait,
  stepFishing,
  type FishingState,
} from './world/fishing';
import { createFishingRenderer } from './render/fishing';
```

renderer 宣告放在其他 renderer 附近：

```ts
// B14：釣魚線＋浮標（暫態；不跨存檔）
const fishingRenderer = createFishingRenderer(gs.scene);
```

狀態放在 `bowDraw` 附近：

```ts
/** B14：拋出的釣魚線。`slot` ＝拋線時的選取格；換格即取消。 */
interface ActiveFishing {
  state: FishingState;
  bobber: { x: number; y: number; z: number };
  slot: number;
}
let fishing: ActiveFishing | null = null;
```

- [x] **Step 4: 實作三個 helper**

放在 `heldIsBow`／`tryIgniteTnt` 附近：

```ts
/** B14：手上拿的是釣魚竿。 */
function heldIsFishingRod(): boolean {
  return slots[selected]?.item === 'fishing_rod';
}

/** B14：對水面拋線。水面用 `includeWater` 專用射線；一般互動仍穿過水。 */
function tryCastFishing(from: { x: number; y: number; z: number }, aim: { x: number; y: number; z: number }): void {
  if (fishing) return;
  const waterHit = raycast(world, from, aim, FISHING_CAST_RANGE, { includeWater: true });
  if (!waterHit || world.getBlock(waterHit.x, waterHit.y, waterHit.z) !== BLOCK.WATER) return;
  const bobber = { x: waterHit.x + 0.5, y: waterHit.y + 0.9, z: waterHit.z + 0.5 };
  fishing = {
    state: beginFishing(rollFishingWait()),
    bobber,
    slot: selected,
  };
  viewmodel.startSwing();
  audio.playFishingSplash({ pos: bobber, listener: player.position });
  hudHint.show('魚線已拋出');
}

/** B14：右鍵收線。魚訊窗口內才有漁獲；空收線只是收線。 */
function tryReelFishing(): void {
  if (!fishing) return;
  const caught = reelFishing(fishing.state, Math.random);
  const bobber = fishing.bobber;
  fishing = null;
  viewmodel.startSwing();
  if (!caught) {
    audio.playFishingSplash({ pos: bobber, listener: player.position });
    return;
  }
  const overflow = giveItem(caught.item, caught.count);
  if (overflow > 0) {
    drops = spawnDrop(drops, caught.item, overflow, {
      x: player.position.x, y: player.position.y + 0.5, z: player.position.z,
    });
    bus.emit('drops-changed', {});
    hudHint.show('背包滿了，漁獲掉在腳邊');
  } else {
    hudHint.show(`釣到了 ${stackName(caught.item)} ×${caught.count}`);
  }
  audio.playFishingSplash({ pos: bobber, listener: player.position });
  damageHeldTool(1); // 先發獎、再扣耐久：最後一次使用仍拿到魚
  hud.setHotbar(slots, selected);
}
```

注意：`stackName` 已經 import（main.ts 有用）；若沒有，補 import。

- [x] **Step 5: 接右鍵分流**

把 `if (wantPlace) {` 的第一個分支改成：

```ts
if (fishing) {
  // B14：線已拋出 → 右鍵一律收線（即使沒瞄到方塊）。
  tryReelFishing();
} else if (
  currentMode === 'survival' &&
  hit &&
  hitBlock === BLOCK.CRAFTING_TABLE
) {
  ...
```

在 TNT 分支之後、`heldIsBow()` 之前加：

```ts
} else if (heldIsFishingRod()) {
  // B14：手持釣魚竿右鍵水面 → 拋線（不是放置）。
  tryCastFishing(rayOrigin, dir);
} else if (heldIsBow()) {
```

**不要**把釣魚竿放在工作台／熔爐／箱子／床／TNT 之前——那些方塊使用仍優先。

- [x] **Step 6: 接每幀狀態推進**

在 B10 弓的每幀區塊之後、放置連放之前加：

```ts
// ---- B14 釣魚：等待 → 魚訊 → 錯過；換格／離線／水面消失即取消 ----
if (fishing) {
  if (selected !== fishing.slot || slots[selected]?.item !== 'fishing_rod') {
    fishing = null;
  } else {
    const dx = player.position.x - fishing.bobber.x;
    const dy = player.position.y - fishing.bobber.y;
    const dz = player.position.z - fishing.bobber.z;
    const waterGone = world.getBlock(fishing.bobber.x, fishing.bobber.y - 0.1, fishing.bobber.z) !== BLOCK.WATER;
    if (dx * dx + dy * dy + dz * dz > FISHING_CAST_RANGE * FISHING_CAST_RANGE || waterGone) {
      fishing = null;
    } else {
      const tick = stepFishing(fishing.state, dt);
      fishing = { ...fishing, state: tick.state };
      if (tick.bite) {
        audio.playFishingBite({ pos: fishing.bobber, listener: player.position });
        hudHint.show('有東西上鉤了！右鍵收線');
      }
      if (tick.escaped) {
        hudHint.show('魚跑掉了');
        fishing = null;
      }
    }
  }
}
```

- [x] **Step 7: 接渲染**

在 render tail 的其他 renderer 之後加：

```ts
// B14：釣魚線只在 playing 顯示；暫停／背包／死亡一律隱藏。
fishingRenderer.sync(
  state === 'playing' && fishing
    ? { bobber: fishing.bobber, biting: fishing.state.phase === 'biting' }
    : null,
  gs.camera,
);
```

- [x] **Step 8: 接 session／狀態邊界**

- `resetSessionEntities()` 加 `fishing = null;`。
- `setState(next)` 的 `if (state === 'playing' && next !== 'playing')` 區塊加 `fishing = null;`（與 `bowDraw = null` 同一段）。
- 確認 `fishingRenderer` 不需要 dispose：與其他 renderer 一樣在程式生命週期內存在；若 main 有 dispose 流程，照既有模式補 `fishingRenderer.dispose()`（先 grep `viewmodel.dispose`／`mobRenderer.dispose` 的實際狀況；沒有就維持）。

- [x] **Step 9: 跑接線測試與全套**

Run: `npx vitest run src/main.wiring.test.ts`
Expected: PASS。

Run: `npm test -- --reporter=dot`
Expected: 全部 PASS；若有其他精確次數因新增呼叫點變紅，逐一以「實際呼叫點」更新並在註解寫明原因，不得放寬成模糊比對。

- [x] **Step 10: Commit**

```bash
git add src/main.ts src/main.wiring.test.ts
git commit -m "feat(b14): 釣魚右鍵分流、魚訊推進、發獎與渲染接線"
```

---

### Task 8: 版本、README、規格、發布說明與完整驗證

**Files:**
- Modify: `package.json`
- Modify: `game.json`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`
- Create: `docs/releases/v0.17.0.md`
- Modify: `docs/superpowers/plans/2026-11-06-wecraft-b14-fishing.md`（把本計畫的驗收數字補上，若需要）

**Interfaces:**
- Consumes: Task 1–7 的實作與測試。
- Produces: `version: "0.17.0"`；README／spec 的 B14 條目；`game.json` instructions 加入釣魚操作；`docs/releases/v0.17.0.md`。

- [x] **Step 1: 版本與 manifest**

- `package.json` `"version": "0.17.0"`。
- `game.json` `"version": "0.17.0"`；`cloudSave` 保持 `{ "readableFormats": [1,2,3,4], "writeFormat": 4 }` **不動**。
- `game.json` `instructions` 加入：「手持釣魚竿右鍵水面拋線，魚訊時右鍵收線；魚可用熔爐烤熟。」
- `devices` 維持 `["desktop"]`（沒有觸控釣魚 UI，不宣告 mobile）。

- [x] **Step 2: README 更新**

- 開頭簡介的批次清單加「釣魚與魚類批次」，目前版本改成 `0.17.0`。
- 〈遊戲特色〉生存模式加一段 `<b>釣魚與魚類（0.17.0）</b>`：
  - 釣魚竿 3 木棍＋2 線、耐久 64、堆疊 1；
  - 右鍵水面拋線（16 格內）、等待 5–30 秒、魚訊窗口 2 秒、右鍵收線；
  - 魚 85%／垃圾 10%／寶物 5%；四種魚、垃圾與寶物清單；
  - 成功收線扣 1 耐久（創造不扣）；背包滿時漁獲掉在腳邊；
  - 生魚可烤（cod 5／6、salmon 6／9.6）、六種魚食物值；
  - 「釣魚翁」進度（累計 20 項）。
- 合成配方 `67` 改成 `68`，加「釣魚竿（0.17.0）」。
- 物品表相關數字 106 → **113**（至少開頭 E 清單與 B13 段後面的總數）。
- 〈與原版的差異〉加 B14 簡化：
  - 沒有原版「開放水域 5×4×5」判定、沒有天氣／幸運加成；等待與魚訊是自訂值。
  - 浮標是靜態視覺，沒有原版的水面漂移與魚群實體。
  - 垃圾與寶物是**既有物品池的簡化表**（原版包含碗、皮革靴、命名牌、鸚鵡螺殼、附魔書等）。
  - 釣魚竿沒有附魔（餌釣／海洋祝福）、沒有魚桶、沒有熱帶魚桶。
  - 第三人稱時釣魚線從相機附近出發（不是從手持模型精準長出）。
  - 回退到 0.16.0 時新物品 id 會被清洗（釣魚竿與六種魚消失）。
- 〈操作〉右鍵列加「手持釣魚竿右鍵水面拋線／魚訊時右鍵收線（0.17.0）」。
- 〈專案狀態〉加 B14 條目（功能與簡化；驗證數字與 `docs/releases/v0.17.0.md` 連結在 Task 8 Step 5 補）。
- 需求文件清單加本計畫路徑。
- `npm test` 的測試數字改成實際值（Step 5 跑完後填）。

- [x] **Step 3: 規格書加 §B14 與更新延後清單**

在 `### B13 農業與骨粉（版本 0.16.0）` 後加：

```md
### B14 釣魚與魚類（版本 0.17.0）

- **新物品 7 個**（106 → 113）：`fishing_rod`、`raw_cod`、`cooked_cod`、
  `raw_salmon`、`cooked_salmon`、`pufferfish`、`tropical_fish`。
  釣魚竿耐久 **64**、堆疊 1；魚堆疊 64。
- **新配方 1 個**（67 → 68）：釣魚竿（3 木棍＋2 線，原版 3×3 斜向形狀）。
- **釣魚規則**：手持釣魚竿右鍵**水面**（16 格內）→ 拋線；等待 **5–30 秒** →
  魚訊窗口 **2 秒**；窗口內右鍵 → 漁獲，錯過 → 魚跑掉。成功收線扣 **1 耐久**
  （創造不扣；最後一次使用仍拿到魚）；換格／打開面板／死亡／離水太遠 → 取消。
- **戰利品**：魚 **85%**（cod 60／salmon 25／pufferfish 13／tropical fish 2）、
  垃圾 **10%**、寶物 **5%**；垃圾與寶物使用既有物品（簡化表）。
- **食物與冶煉**：生魚可烤；食物值 cod 2／0.4、cooked cod 5／6、
  salmon 2／0.4、cooked salmon 6／9.6、pufferfish 1／0.2、tropical fish 1／0.2。
- **進度**：`angler`（釣到第一條魚，累計 **20** 項）。
- **存檔不升版**：釣魚竿沿用既有 `dur`；新物品是字串 id；浮標不跨存檔。
  **回退到 0.16.0**：新物品 id 會被舊版清洗（釣魚竿與六種魚消失）。
- 明示簡化：無開放水域判定、無天氣／幸運加成、浮標無物理漂移、垃圾／寶物為
  既有物品池、無釣魚竿附魔／魚桶、第三人稱線從相機附近出發。
```

更新 §5 第 2 點「B13 後仍缺」與 §6 已知簡化清單，加上 B14 完成與其簡化；§7 的「後續加碼」加一條 B14。

- [x] **Step 4: 建立 `docs/releases/v0.17.0.md`**

用既有 release 格式（參考 `docs/releases/v0.16.0.md`），先寫功能、修正、存檔相容性、已知問題／簡化、驗證。驗證數字先留 `TODO`，Step 5 跑完填實際值。

- [x] **Step 5: 完整驗證**

依序跑：

```bash
npm run typecheck
npm test -- --reporter=dot
npm run lint
npm run build
npm run test:perf
```

Expected：全綠；記下 test files／tests 數、build 產物與大小、perf 數字。

固定工具 pack＋validate（在 `.playroom` 工具解壓目錄執行；輸出 ZIP 放 repo 外）：

```bash
rm -rf /tmp/opencode/wecraft-tools && mkdir -p /tmp/opencode/wecraft-tools
unzip -q .playroom/tools/playroom-game-tools-1.2.0.zip -d /tmp/opencode/wecraft-tools
cd /tmp/opencode/wecraft-tools
node pack-game.mjs /home/tommy/WeCraft/dist /tmp/opencode/wecraft-b14-game.zip
node validate-game.mjs /tmp/opencode/wecraft-b14-game.zip
```

Expected：`Packed wecraft v0.17.0`／`Valid: wecraft v0.17.0 (tools 1.2.0)`；記下 ZIP bytes 與 SHA-256。

- [x] **Step 6: 真實瀏覽器 smoke**

用靜態伺服 `dist/`（`npx vite preview --host 127.0.0.1 --port 4173` 或 `python3 -m http.server`）＋ Playwright Chromium headless/headful（`xvfb-run`）。探針腳本放 repo 外（`/tmp/opencode`），至少確認：

- 頁面載入、title `WeCraft`、canvas 存在；
- 點「單人遊戲」進入 playing、熱鍵欄 1–9 出現；
- 載入＋進局全程 **0 console error／0 page error**；
- 若環境允許，進入創造模式確認新物品圖示可被繪製（不強求）。

**不宣稱**已完成「真實水面拋線→等待→收線」的完整遊玩探針；若沒做，列為未驗證。

- [x] **Step 7: 把實際驗證數字填回 README／release notes／本計畫**

- README `npm test` 數字、B14 條目的驗證與 release 連結。
- `docs/releases/v0.17.0.md` 的 tests／build／perf／ZIP 數字與未驗證清單。
- 本計畫若有 TODO，補實際值。

- [x] **Step 8: Commit**

```bash
git add package.json game.json README.md docs/superpowers/specs/2026-10-18-wecraft-parity-design.md docs/releases/v0.17.0.md docs/superpowers/plans/2026-11-06-wecraft-b14-fishing.md
git commit -m "docs(b14): 0.17.0 版本、README、規格與發布說明"
```

**不要**推 tag、不要建 Release、不要呼叫平台 API（本批未獲發布授權）。

#### Task 8 執行結果（2026-11-06）

- **版本／manifest**：`package.json` 與 `game.json` → `0.17.0`；`cloudSave` 維持
  `{ "readableFormats": [1,2,3,4], "writeFormat": 4 }` 不動；`instructions` 加入
  釣魚操作；`devices` 維持 `["desktop"]`。
- **README**：版本、物品表 106 → **113**、配方 67 → **68**、進度 19 → **20**、
  〈遊戲特色〉新增 B14 段、〈與原版的差異〉新增 0.17.0 簡化段、〈操作〉右鍵列、
  〈專案狀態〉B14 條目、計畫文件連結、測試數字。
- **規格書**：新增 `### B14 釣魚與魚類（版本 0.17.0）`；更新 §5 第 2 點、§6 已知簡化
  清單、§7 後續加碼。
- **發布說明**：`docs/releases/v0.17.0.md`（新增／修正／存檔相容性／已知問題／
  驗證）。
- **完整驗證（全綠）**：
  - `npm run typecheck` PASS
  - `npm test` → **101 files / 2001 tests PASS**
  - `npm run lint` PASS
  - `npm run build` PASS → `dist/assets/index-Dd19t9Nb.js` 739.70 kB
    （gzip 206.15 kB；Vite 5.4.21、106 modules）
  - `npm run test:perf` PASS（4 tests）→ edit → relight → mesh 最佳 **31.3 ms**
    （門檻 33 ms）；3×3 群組重算最佳 **48.8 ms → 5.4 ms/chunk**（門檻 8 ms）
    （牆鐘 best-of 量測會小幅浮動：複驗 28.6–31.3 ms／48.8–49.7 ms，皆在門檻內）
  - pinned 工具（`.playroom/game-tools.lock.json` → tools 1.2.0、ZIP SHA-256
    `24a2fd36…` 與 lock 相符）→ `Packed wecraft v0.17.0` /
    `Valid: wecraft v0.17.0 (tools 1.2.0)`；ZIP **367,004 bytes**、SHA-256
    `143268c469acfc596b8332d04a573804950a2239266db4b32af95e6a60ebb2d2`
- **瀏覽器驗收（靜態伺服 `dist/` ＋ playwright-core ＋ Chromium 1248，`xvfb-run`
  有頭模式；探針腳本放 repo 外）**：
  - **smoke：16 PASS / 0 FAIL / 0 console 或 page error**（頁面載入、title
    `WeCraft`、canvas、點「單人遊戲」進局、熱鍵欄 9 格、切到 Creative、
    **創造清單 113 項且含七個新物品**）。
  - **釣魚走查：15 PASS / 0 FAIL / 0 error**（連續兩次一致）：走到海邊沙灘
    (26.5, 64, −25.6) → 右鍵水面 →「魚線已拋出」→ 魚訊「有東西上鉤了！右鍵收線」
    → 右鍵收線 →「釣到了 Raw Cod ×1」→ 36 格背包裡出現漁獲、熱鍵欄仍是釣魚竿。
    - 走查在**創造模式**進行（創造不扣耐久）→ **生存模式的耐久扣損未在瀏覽器
      驗證**（規則由單元測試覆蓋）。
    - 探針備註：合成滑鼠事件在指標鎖定瞬間帶巨大 movement → 探針改用「量測過的
      yaw ＋ 掃描 pitch」找水面（探針側現象，非遊戲行為）。
- **未做（不宣稱通過）**：生存模式耐久扣損與熔爐烤魚的瀏覽器實機走查、浮標貼圖
  的逐像素外觀、跨來源 iframe ＋ 頂層 Keyboard Lock ＋ 原生全螢幕的組合情境。
- **發布**：**未執行**（未獲推 tag／建 Release／呼叫平台 API 的授權）。

---

## Self-Review

**1. Spec coverage:** B14 的新物品、配方、釣魚規則、戰利品、食物、冶煉、進度、存檔政策、簡化都已對到 Task 1–8。沒有遺漏的 spec 條目。

**2. Step scan:** 每個 Task 都有「寫失敗測試 → 跑失敗 → 實作 → 跑通過 → commit」；main 接線另有結構釘子。沒有 TBD／「handle edge cases」類的空話。

**3. Type consistency:** `FishingState`／`FishingCatch`／`FishingRenderer`／`GameAudio` 方法名稱在各 Task 一致；`fishing_rod`、`raw_cod` 等 id 在 Task 1–7 一致；`damageHeldTool(1)` 次數從 8 改 9。

**4. Review Focus:** 五條風險分別由 Task 7（右鍵優先序／收線）、Task 4（水面射線）、Task 7 的發獎測試、Task 1＋Task 7 的耐久測試、Task 7 的 session 邊界測試覆蓋。

**5. Proportion:** 本計畫是決策與介面，不是逐行抄程式；實作細節留给執行者，測試與驗收值已釘死。
