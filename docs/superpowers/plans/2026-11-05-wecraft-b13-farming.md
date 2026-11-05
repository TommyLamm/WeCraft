# B13 農業與骨粉 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把既有的骨頭、草叢、泥土、木頭接成可再生食物循環：鋤地 → 播種 → 小麥成長 → 收成 → 麵包；骨粉可催熟，草叢可取得種子。

**Architecture:** 新增一個純邏輯模組 `src/world/farming.ts`（階段換算、鋤地／播種／骨粉規則、濕潤判定、批次成長、收成），方塊／貼圖／物品／配方只做 append-only 擴充；`main.ts` 只負責右鍵分流、5 秒成長 tick 與世界寫入，掉落接在既有 `spawnBlockDrop`／`dropItemFor` 鏈上。存檔格式不升版：新方塊 id 只追加，舊版讀到未知 id 仍 fallback 空氣。

**Tech Stack:** TypeScript 5.6、Vite 5、Vitest 2、Three.js 0.170、jsdom；固定 Playroom game tools 1.2.0。

**Spec:** `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`（Task 7 會加入 §B13）

## Global Constraints

- `game.json`／`package.json` 版本一律 `0.16.0`；`id` 維持 `wecraft`；tag 只會是 `v0.16.0`，但**本批未獲發布授權，不推 tag、不建 Release、不呼叫平台 API**。
- 方塊 id **只能往後追加**：`FARMLAND=36`、`WHEAT_0..3=37..40`；既有 0–35 不得重編。
- Tile 只能往後追加：`FARMLAND_TOP=45`、`WHEAT_0..3=46..49`、`TILE_COUNT=50`（< `ARRAY_LAYERS=64`）。
- 新方塊 **沒有物品形式**、不進 `PLACEABLE`；`FARMLAND`／小麥四階段是狀態方塊，只能由鋤地／播種／成長產生。
- 物品表 97 → **106**（`wheat_seeds`、`wheat`、`bread`、`bone_meal`、五種鋤）；配方 55 → **67**（5 鋤＋5 鏡像鋤＋麵包＋骨粉）。
- 小麥 4 階段；每 **5 秒**檢查一次；濕潤 **25%**、乾燥 **10%**；光照 **≥ 9**；水源水平半徑 **4**（垂直 ±1）；每 tick 最多成長 **64** 株並輪替游標。
- 骨粉一次推進 **2 階段**（上限成熟），每次消耗 **1** 個；鋤地每次扣 **1** 耐久（創造模式不扣）。
- 收成：成熟小麥掉 **1 wheat ＋ 0–3 wheat_seeds**；未成熟掉 **1 wheat_seeds**；短草 **12.5%** 掉種子；farmland 挖掉掉 **dirt**。
- 存檔政策不升版：本機 payload 維持 v6、雲端 `formatVersion` 4、`game.json` 的 `cloudSave` **一字不動**（`readableFormats [1,2,3,4]`、`writeFormat 4`）。新 block id 只追加；舊版 fallback 空氣。
- 不動 iframe／全螢幕／pointer lock／瀏覽器保留鍵；若跑瀏覽器探針，只做 smoke。
- 驗收工具只用 `.playroom/game-tools.lock.json` 固定的 game tools 1.2.0、SHA-256 `24a2fd36b405ae9f1ce1303e53ac6b0a0d0a2798c04e796f5790a2663d46f022`；不得自行指定版本。
- 回報必須區分：程式完成／ZIP 驗證／GitHub Release／平台上架；未做的列為未驗證。

## Review Focus

1. **右鍵優先序**：拿鋤頭／種子／骨粉時，農業動作不得搶走工作台、熔爐、箱子、床、TNT 點燃、拉弓與進食；只有在 `hit` 存在且農業規則成立時才消費該次右鍵。
2. **不合法目標要落回一般放置**：鋤頭點石頭、種子點非耕地、骨粉點成熟小麥都必須回 `false`，讓原本的方塊放置流程照常執行（不能吞掉右鍵）。
3. **收成數量與模式**：成熟小麥 1 wheat＋0–3 seeds、未成熟 1 seed、farmland 掉 dirt、短草 12.5% seeds；創造模式不掉任何東西。
4. **成長條件與公平性**：光照 < 9、下方不是 farmland、已成熟都不成長；濕潤／乾燥門檻正確；超過 64 株時游標輪替，不能永遠只長前 64 株。
5. **存檔與舊版相容**：不得新增存檔欄位；farmland／小麥 id 可經 `modified` 往返；舊版讀到 36–40 顯示空氣且不崩；新狀態方塊沒有物品形式也不能讓 `itemFromBlock` 守門誤紅。

---

### Task 1: 方塊、貼圖、音效材質

**Files:**
- Modify: `src/world/blocks.ts`
- Modify: `src/world/blocks.test.ts`
- Modify: `src/render/textures.ts`
- Modify: `src/render/textures.test.ts`
- Modify: `src/audio/sounds.ts`
- Modify: `src/audio/sounds.test.ts`
- Modify: `src/core/items.test.ts`（只改「每個 block 都有 item」守門，讓狀態方塊被明確排除）

**Interfaces:**
- Consumes: 既有 `BLOCK`／`T`／`DEFS`／`TILE_COUNT`、`drawAtlas`、`GROUP_BY_BLOCK`。
- Produces:
  - `BLOCK.FARMLAND = 36`、`BLOCK.WHEAT_0 = 37`、`BLOCK.WHEAT_1 = 38`、`BLOCK.WHEAT_2 = 39`、`BLOCK.WHEAT_3 = 40`
  - `T.FARMLAND_TOP = 45`、`T.WHEAT_0 = 46`、`T.WHEAT_1 = 47`、`T.WHEAT_2 = 48`、`T.WHEAT_3 = 49`、`TILE_COUNT = 50`
  - `getBlockDef(BLOCK.FARMLAND)`：`name:'farmland'`、`hardness:0.6`、`blastResistance:0.6`、`solid:true`、`transparent:false`、`shape:'cube'`、`top:T.FARMLAND_TOP`、`side/bottom:T.DIRT`、`requiredTool:null`、`fastTool:'shovel'`
  - `getBlockDef(BLOCK.WHEAT_0..3)`：`name:'wheat'`、`hardness:0`、`blastResistance:0`、`solid:false`、`transparent:true`、`shape:'cross'`、三個面共用該階段 tile、`requiredTool:null`、`fastTool:null`

- [ ] **Step 1: 在 `src/world/blocks.test.ts` 寫失敗測試**

新增：

```ts
it('B13: farmland and the four wheat stages use appended ids and tiles', () => {
  expect(BLOCK.FARMLAND).toBe(36);
  expect(BLOCK.WHEAT_0).toBe(37);
  expect(BLOCK.WHEAT_1).toBe(38);
  expect(BLOCK.WHEAT_2).toBe(39);
  expect(BLOCK.WHEAT_3).toBe(40);
  expect(T.FARMLAND_TOP).toBe(45);
  expect(T.WHEAT_0).toBe(46);
  expect(T.WHEAT_1).toBe(47);
  expect(T.WHEAT_2).toBe(48);
  expect(T.WHEAT_3).toBe(49);
  expect(TILE_COUNT).toBe(50);
});

it('B13: farmland is a full cube and wheat stages are cross plants', () => {
  const farm = getBlockDef(BLOCK.FARMLAND);
  expect(farm).toMatchObject({
    name: 'farmland',
    hardness: 0.6,
    blastResistance: 0.6,
    solid: true,
    transparent: false,
    shape: 'cube',
    top: T.FARMLAND_TOP,
    side: T.DIRT,
    bottom: T.DIRT,
    requiredTool: null,
    fastTool: 'shovel',
  });
  const stages: ReadonlyArray<readonly [number, number]> = [
    [BLOCK.WHEAT_0, T.WHEAT_0],
    [BLOCK.WHEAT_1, T.WHEAT_1],
    [BLOCK.WHEAT_2, T.WHEAT_2],
    [BLOCK.WHEAT_3, T.WHEAT_3],
  ];
  for (const [id, tile] of stages) {
    const def = getBlockDef(id);
    expect(def).toMatchObject({
      name: 'wheat',
      hardness: 0,
      blastResistance: 0,
      solid: false,
      transparent: true,
      shape: 'cross',
      top: tile,
      side: tile,
      bottom: tile,
      requiredTool: null,
      fastTool: null,
    });
    expect(isCross(id)).toBe(true);
    expect(isTargetable(id)).toBe(true);
  }
});

it('B13: farmland and wheat have no item form and are not placeable', () => {
  for (const id of [BLOCK.FARMLAND, BLOCK.WHEAT_0, BLOCK.WHEAT_1, BLOCK.WHEAT_2, BLOCK.WHEAT_3]) {
    expect(PLACEABLE).not.toContain(id);
  }
});
```

把五個新方塊加進既有的 exhaustive `hardness` 與 `requiredTool／fastTool` 陣列：

```ts
[BLOCK.FARMLAND, 0.6],
[BLOCK.WHEAT_0, 0], [BLOCK.WHEAT_1, 0], [BLOCK.WHEAT_2, 0], [BLOCK.WHEAT_3, 0],
```

```ts
[BLOCK.FARMLAND, null, 'shovel'],
[BLOCK.WHEAT_0, null, null], [BLOCK.WHEAT_1, null, null],
[BLOCK.WHEAT_2, null, null], [BLOCK.WHEAT_3, null, null],
```

把「最後一個 tile」測試改成：

```ts
it('the wheat stage 3 tile is the last declared tile', () => {
  expect(T.WHEAT_3).toBe(TILE_COUNT - 1);
  expect(T.WHEAT_0).toBe(T.WHEAT_3 - 3);
  expect(T.FARMLAND_TOP).toBe(T.WHEAT_0 - 1);
  expect(TILE_COUNT).toBeLessThanOrEqual(64);
});
```

同時把 `the B5 tiles are appended...` 裡的 `expect(TILE_COUNT).toBe(getBlockDef(BLOCK.TNT).side + 1)` 改成 `expect(TILE_COUNT).toBeGreaterThan(getBlockDef(BLOCK.TNT).side)`（精確值由上面的 last-tile 測試釘住）。

- [ ] **Step 2: 在 `src/render/textures.test.ts` 寫失敗測試**

新增：

```ts
it('B13: farmland is opaque and each wheat stage is a distinct transparent tile', () => {
  const atlas = drawAtlas();
  let farmOpaque = 0;
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      if (tilePixel(atlas, T.FARMLAND_TOP, x, y)[3] === 255) farmOpaque++;
    }
  }
  expect(farmOpaque).toBe(TILE_PX * TILE_PX);

  const signatures: string[] = [];
  for (const tile of [T.WHEAT_0, T.WHEAT_1, T.WHEAT_2, T.WHEAT_3]) {
    let transparent = 0;
    let green = 0;
    const pixels: number[] = [];
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const [r, g, b, a] = tilePixel(atlas, tile, x, y);
        if (a === 0) transparent++;
        if (a > 0 && g > r && g > b) green++;
        pixels.push(r, g, b, a);
      }
    }
    expect(transparent).toBeGreaterThan(0);
    expect(green).toBeGreaterThan(0);
    signatures.push(pixels.join(','));
  }
  expect(new Set(signatures).size).toBe(4); // 四階段不是同一張圖
});
```

把「empty layers are opaque magenta」的層號清單由 `[TILE_COUNT, TILE_COUNT + 1, 47, 63]` 改成 `[TILE_COUNT, TILE_COUNT + 1, TILE_COUNT + 2, 63]`（`TILE_COUNT=50` 後 47 已是 `T.WHEAT_1`，不能再當空層）。

- [ ] **Step 3: 在 `src/audio/sounds.test.ts` 的 table 加五筆**

```ts
[BLOCK.FARMLAND]: 'dirt',
[BLOCK.WHEAT_0]: 'grass',
[BLOCK.WHEAT_1]: 'grass',
[BLOCK.WHEAT_2]: 'grass',
[BLOCK.WHEAT_3]: 'grass',
```

- [ ] **Step 4: 在 `src/core/items.test.ts` 明確排除狀態方塊**

在 `BLOCK_ITEMS` 附近加：

```ts
/** B13：耕地與小麥四階段是狀態方塊，刻意沒有物品形式。 */
const BLOCK_ONLY_STATES: ReadonlySet<number> = new Set([
  BLOCK.FARMLAND,
  BLOCK.WHEAT_0,
  BLOCK.WHEAT_1,
  BLOCK.WHEAT_2,
  BLOCK.WHEAT_3,
]);
```

把「ItemId union covers every obtainable block item」的迴圈改成：

```ts
for (const id of Object.values(BLOCK)) {
  if (id === BLOCK.AIR || id === BLOCK.WATER || BLOCK_ONLY_STATES.has(id)) continue;
  expect(itemFromBlock(id), `block ${id} has no item`).not.toBeNull();
}
```

並加一條反向守門：

```ts
it('B13: the farming state blocks deliberately have no item form', () => {
  for (const id of BLOCK_ONLY_STATES) expect(itemFromBlock(id)).toBeNull();
});
```

- [ ] **Step 5: 跑測試確認失敗**

Run: `npx vitest run src/world/blocks.test.ts src/render/textures.test.ts src/audio/sounds.test.ts src/core/items.test.ts`
Expected: FAIL，錯誤包含 `BLOCK.FARMLAND`／`T.WHEAT_3` 不存在或 tile 未宣告。

- [ ] **Step 6: 實作 `src/world/blocks.ts`**

在 `BLOCK` 的 `TNT: 35` 後追加（註解要寫「B13 跨批編號，只能往後追加」）：

```ts
FARMLAND: 36,
WHEAT_0: 37,
WHEAT_1: 38,
WHEAT_2: 39,
WHEAT_3: 40,
```

在 `T` 的 `TNT_SIDE` 後追加：

```ts
FARMLAND_TOP: 45,
WHEAT_0: 46,
WHEAT_1: 47,
WHEAT_2: 48,
WHEAT_3: 49,
```

`TILE_COUNT` 改成 `T.WHEAT_3 + 1`。在 `DEFS` 加五筆：

```ts
36: { id: 36, name: 'farmland', hardness: 0.6, blastResistance: 0.6, solid: true, transparent: false, shape: 'cube', top: T.FARMLAND_TOP, side: T.DIRT, bottom: T.DIRT, requiredTool: null, fastTool: 'shovel' },
37: { id: 37, name: 'wheat', hardness: 0, blastResistance: 0, solid: false, transparent: true, shape: 'cross', top: T.WHEAT_0, side: T.WHEAT_0, bottom: T.WHEAT_0, requiredTool: null, fastTool: null },
38: { id: 38, name: 'wheat', hardness: 0, blastResistance: 0, solid: false, transparent: true, shape: 'cross', top: T.WHEAT_1, side: T.WHEAT_1, bottom: T.WHEAT_1, requiredTool: null, fastTool: null },
39: { id: 39, name: 'wheat', hardness: 0, blastResistance: 0, solid: false, transparent: true, shape: 'cross', top: T.WHEAT_2, side: T.WHEAT_2, bottom: T.WHEAT_2, requiredTool: null, fastTool: null },
40: { id: 40, name: 'wheat', hardness: 0, blastResistance: 0, solid: false, transparent: true, shape: 'cross', top: T.WHEAT_3, side: T.WHEAT_3, bottom: T.WHEAT_3, requiredTool: null, fastTool: null },
```

不要加進 `PLACEABLE` 或 `HOTBAR_DEFAULT`。

- [ ] **Step 7: 實作 `src/render/textures.ts`**

在 TNT 貼圖之後、`return { ... }` 之前，用既有 `put(tile, fn)` 畫五張：

- `T.FARMLAND_TOP`：不透明泥土底（`vary([134,96,67,255], r, 24)`），`y % 4 === 0` 的列加深（例如 −30）當犁溝。
- `T.WHEAT_0`：透明底；三根短芽（例如 x=5／8／11，y 12–15），綠色 `[92,160,62,255]`。
- `T.WHEAT_1`：同樣三根但長到 y 8–15，左下／右下各加一片葉子。
- `T.WHEAT_2`：長到 y 5–15，頂端幾格轉黃綠 `[176,180,70,255]`。
- `T.WHEAT_3`：成熟麥穗，莖從 y 15 到 y 3，頂端 y 1–5 有金黃色麥粒 `[220,190,80,255]`，左右各一根彎穗。
- 四張小麥圖都必須有 alpha 0 的背景像素（cross 的 alphaTest 需要）。

- [ ] **Step 8: 實作 `src/audio/sounds.ts`**

在 `GROUP_BY_BLOCK` 加：

```ts
[BLOCK.FARMLAND]: 'dirt',
[BLOCK.WHEAT_0]: 'grass',
[BLOCK.WHEAT_1]: 'grass',
[BLOCK.WHEAT_2]: 'grass',
[BLOCK.WHEAT_3]: 'grass',
```

- [ ] **Step 9: 跑測試確認通過**

Run: `npx vitest run src/world/blocks.test.ts src/render/textures.test.ts src/audio/sounds.test.ts src/core/items.test.ts`
Expected: PASS。

- [ ] **Step 10: Commit**

```bash
git add src/world/blocks.ts src/world/blocks.test.ts src/render/textures.ts src/render/textures.test.ts src/audio/sounds.ts src/audio/sounds.test.ts src/core/items.test.ts
git commit -m "feat(b13): 新增耕地與小麥四階段方塊"
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
- Consumes: Task 1 的狀態方塊沒有物品形式；既有 `ItemId`／`ITEM_IDS`／`STACK_ONE`／`TOOL_MAX_DURABILITY`／`RECIPES`／`drawItemArt`。
- Produces:
  - 新 `ItemId`：`'wheat_seeds' | 'wheat' | 'bread' | 'bone_meal' | 'wooden_hoe' | 'stone_hoe' | 'iron_hoe' | 'golden_hoe' | 'diamond_hoe'`
  - `TOTAL_ITEM_COUNT = 106`
  - 鋤耐久：木 59／石 131／鐵 250／金 32／鑽 1561
  - 配方 67 筆：`wooden_hoe`、`stone_hoe`、`iron_hoe`、`golden_hoe`、`diamond_hoe` 各一正一鏡像（id 後綴 `_mirrored`），`bread`、`bone_meal`
  - `icons.ts` 的 `drawItemArt` 必須有上述 9 個 case 標籤

- [ ] **Step 1: 寫失敗測試**

`src/core/items.test.ts`：

- `TOTAL_ITEM_COUNT` 改成 `106`，註解加「B13 再補 9 個（4 個農產／材料 ＋ 5 把鋤）」。
- `ALL_ITEMS` mirror 加：

```ts
const B13_ITEM_IDS: ItemId[] = [
  'wheat_seeds', 'wheat', 'bread', 'bone_meal',
  'wooden_hoe', 'stone_hoe', 'iron_hoe', 'golden_hoe', 'diamond_hoe',
];
```

並把 `...B13_ITEM_IDS` 放進 `ALL_ITEMS`。

- 新增：

```ts
it('B13: seeds, wheat, bread and bone meal are stackable non-block items', () => {
  for (const id of ['wheat_seeds', 'wheat', 'bread', 'bone_meal'] as const) {
    expect(ALL_ITEM_IDS).toContain(id);
    expect(blockFromItem(id)).toBeNull();
    expect(maxStack(id)).toBe(64);
    expect(sanitizeStack({ item: id, count: 3 })).toEqual({ item: id, count: 3 });
  }
  expect(stackName('wheat_seeds')).toBe('Wheat Seeds');
  expect(stackName('bone_meal')).toBe('Bone Meal');
});

it('B13: the five hoes are stack-one durable tools', () => {
  const durability: Partial<Record<ItemId, number>> = {
    wooden_hoe: 59, stone_hoe: 131, iron_hoe: 250, golden_hoe: 32, diamond_hoe: 1561,
  };
  for (const [id, max] of Object.entries(durability) as Array<[ItemId, number]>) {
    expect(ALL_ITEM_IDS).toContain(id);
    expect(blockFromItem(id)).toBeNull();
    expect(maxStack(id)).toBe(1);
    expect(maxDurability(id)).toBe(max);
    expect(sanitizeStack({ item: id, count: 1 })).toEqual({ item: id, count: 1, dur: max });
  }
});
```

`src/core/durability.test.ts` 加：

```ts
it('B13: hoes share the vanilla material durability', () => {
  expect(maxDurability('wooden_hoe')).toBe(59);
  expect(maxDurability('stone_hoe')).toBe(131);
  expect(maxDurability('iron_hoe')).toBe(250);
  expect(maxDurability('golden_hoe')).toBe(32);
  expect(maxDurability('diamond_hoe')).toBe(1561);
});
```

`src/core/recipes.test.ts`：

- `RECIPES.length` 由 55 改成 67，id 清單加 12 筆：

```ts
'wooden_hoe', 'wooden_hoe_mirrored',
'stone_hoe', 'stone_hoe_mirrored',
'iron_hoe', 'iron_hoe_mirrored',
'golden_hoe', 'golden_hoe_mirrored',
'diamond_hoe', 'diamond_hoe_mirrored',
'bread', 'bone_meal',
```

- 新增：

```ts
it('B13: hoes use the vanilla 2-material + 2-stick shape in both directions', () => {
  const materials = {
    wooden: 'oak_planks', // wooden 用 ANY_PLANKS，任一板材皆可
    stone: 'cobblestone',
    iron: 'iron_ingot',
    golden: 'gold_ingot',
    diamond: 'diamond',
  } as const;
  for (const [tier, material] of Object.entries(materials)) {
    for (const mirrored of [false, true]) {
      const id = mirrored ? `${tier}_hoe_mirrored` : `${tier}_hoe`;
      const r = recipe(id);
      expect(r.kind).toBe('shaped');
      expect(r.result).toEqual({ item: `${tier}_hoe`, count: 1 });
      if (r.kind !== 'shaped') continue;
      const rows = r.pattern.map((row) => row.map((cell) => cell));
      const expected = mirrored
        ? [[null, material, material], [null, 'stick', null], [null, 'stick', null]]
        : [[material, material, null], [null, 'stick', null], [null, 'stick', null]];
      // wooden 的 material 格是 ANY_PLANKS 陣列，不是字串：逐格檢查可接受集合
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const want = expected[row][col];
          const cell = rows[row][col];
          if (want === null) expect(cell).toBeNull();
          else if (want === material && tier === 'wooden') {
            expect(Array.isArray(cell)).toBe(true);
            expect(cell).toContain('oak_planks');
          } else {
            expect(cell).toBe(want);
          }
        }
      }
    }
  }
});

it('B13: bread is 3 wheat in a row and bone meal is 1 bone → 3', () => {
  const bread = recipe('bread');
  expect(bread.kind).toBe('shaped');
  expect(bread.result).toEqual({ item: 'bread', count: 1 });
  if (bread.kind === 'shaped') expect(bread.pattern).toEqual([['wheat', 'wheat', 'wheat']]);

  const meal = recipe('bone_meal');
  if (meal.kind !== 'shapeless') throw new Error('bone_meal must be shapeless');
  expect(meal.inputs).toEqual(['bone']);
  expect(meal.result).toEqual({ item: 'bone_meal', count: 3 });
});
```

`src/ui/icons.test.ts` 加：

```ts
const B13_NEEDS_ART = [
  'wheat_seeds', 'wheat', 'bread', 'bone_meal',
  'wooden_hoe', 'stone_hoe', 'iron_hoe', 'golden_hoe', 'diamond_hoe',
] as const;

it('every B13 non-block item id has its own icon branch', () => {
  const labels = new Set(drawItemArtCaseLabels(ICONS_SOURCE));
  expect(B13_NEEDS_ART).toHaveLength(9);
  for (const id of B13_NEEDS_ART) {
    expect(blockFromItem(id), `${id} 不應有方塊物品形式`).toBeNull();
    expect(labels.has(id), `icons.ts drawItemArt() has no case for ${id}`).toBe(true);
  }
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/items.test.ts src/core/durability.test.ts src/core/recipes.test.ts src/ui/icons.test.ts`
Expected: FAIL（新 id 不在 union、`RECIPES.length` 仍是 55、圖示 case 不存在）。

- [ ] **Step 3: 實作 `src/core/items.ts`**

- union 加 9 個 id（註解寫 B13 用途）。
- `ITEM_IDS` 加 9 個 `true`。
- `ALL_ITEM_IDS` 註解總數改成 106。
- `STACK_ONE` 加五把鋤。
- 不需加 `BLOCK_PAIRS`（狀態方塊沒有物品形式）。

- [ ] **Step 4: 實作 `src/core/durability.ts`**

```ts
wooden_hoe: 59, stone_hoe: 131, iron_hoe: 250, golden_hoe: 32, diamond_hoe: 1561,
```

- [ ] **Step 5: 實作 `src/core/recipes.ts`**

加常數：

```ts
// B13：鋤頭的材質格（木鋤用 ANY_PLANKS；其餘用既有 I／G／D 與圓石）。
const WHEAT: PatternCell = 'wheat';
const BONE: PatternCell = 'bone';
```

五個材質 × 兩方向（`[M, M, null] / [null, S, null] / [null, S, null]` 與鏡像）；`bread` 用 `[[WHEAT, WHEAT, WHEAT]]`；`bone_meal` 用 `{ kind: 'shapeless', inputs: ['bone'], result: { item: 'bone_meal', count: 3 } }`。把檔頭「exactly 55」改成 67。

- [ ] **Step 6: 實作 `src/ui/icons.ts`**

在 `drawItemArt` 的 switch 加 9 個 case（可合併材質分支，但每個 `case 'id':` 標籤都要出現）：

- 五把鋤：用 `toolColors(item)` 取材質色；木柄 `line`，頭部一條橫線＋一條短豎線（與鏟區隔）。
- `wheat_seeds`：4–5 顆綠色／棕色小橢圓。
- `wheat`：三根金黃麥稈＋麥粒。
- `bread`：棕色橢圓麵包＋淺色劃痕。
- `bone_meal`：白色粉末堆＋幾點顆粒。

- [ ] **Step 7: 跑測試確認通過**

Run: `npx vitest run src/core/items.test.ts src/core/durability.test.ts src/core/recipes.test.ts src/ui/icons.test.ts`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add src/core/items.ts src/core/items.test.ts src/core/durability.ts src/core/durability.test.ts src/core/recipes.ts src/core/recipes.test.ts src/ui/icons.ts src/ui/icons.test.ts
git commit -m "feat(b13): 新增小麥、麵包、骨粉與五種鋤"
```

---

### Task 3: 農業純邏輯 `src/world/farming.ts`

**Files:**
- Create: `src/world/farming.ts`
- Create: `src/world/farming.test.ts`

**Interfaces:**
- Consumes: `BLOCK`／`BlockId`、`ItemId`。
- Produces（後續任務只依賴這些簽名）：

```ts
export const WHEAT_STAGES = 4;
export const WHEAT_GROWTH_INTERVAL_SEC = 5;
export const WHEAT_MAX_GROWTH_PER_TICK = 64;
export const WHEAT_WET_GROWTH_CHANCE = 0.25;
export const WHEAT_DRY_GROWTH_CHANCE = 0.1;
export const WHEAT_MIN_LIGHT = 9;
export const FARMLAND_WATER_RADIUS = 4;
export const WHEAT_SEED_MAX = 3;
export const SHORT_GRASS_SEED_CHANCE = 0.125;
export const HOE_ITEM_IDS: readonly ItemId[];

export function isHoeItem(item: ItemId | null): boolean;
export function wheatStageOf(blockId: number): number | null;
export function wheatBlockForStage(stage: number): BlockId;
export function isWheatBlock(blockId: number): boolean;
export function wasFarmlandHydrated(
  getBlock: (x: number, y: number, z: number) => number,
  x: number, y: number, z: number,
): boolean;
export function canTill(held: ItemId | null, targetId: number, aboveId: number): boolean;
export function canPlantWheat(held: ItemId | null, targetId: number, aboveId: number): boolean;
export function boneMealWheat(held: ItemId | null, targetId: number): BlockId | null;

export interface WheatGrowthUpdate {
  x: number; y: number; z: number;
  from: BlockId; to: BlockId;
}
export interface WheatGrowthResult {
  updates: WheatGrowthUpdate[];
  nextCursor: number;
}
export interface WheatGrowthOptions {
  entries: ReadonlyArray<readonly [string, number]>;
  getBlock: (x: number, y: number, z: number) => number;
  lightAt: (x: number, y: number, z: number) => number;
  rng?: () => number;
  cursor?: number;
  maxGrow?: number;
}
export function growWheatBatch(opts: WheatGrowthOptions): WheatGrowthResult;

export interface WheatHarvest { wheat: number; seeds: number; }
export function wheatHarvestFor(stage: number, rng?: () => number): WheatHarvest;
export function seedsFromShortGrass(rng?: () => number): number;
```

- [ ] **Step 1: 寫階段與右鍵規則的失敗測試**

`src/world/farming.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { BLOCK } from './blocks';
import {
  WHEAT_STAGES,
  WHEAT_MAX_GROWTH_PER_TICK,
  WHEAT_MIN_LIGHT,
  WHEAT_WET_GROWTH_CHANCE,
  WHEAT_DRY_GROWTH_CHANCE,
  HOE_ITEM_IDS,
  isHoeItem,
  wheatStageOf,
  wheatBlockForStage,
  isWheatBlock,
  canTill,
  canPlantWheat,
  boneMealWheat,
} from './farming';

const blockMap = (map: Record<string, number>) =>
  (x: number, y: number, z: number): number => map[`${x},${y},${z}`] ?? BLOCK.AIR;

describe('farming stage helpers', () => {
  it('pins the growth tuning constants', () => {
    expect(WHEAT_MIN_LIGHT).toBe(9);
    expect(WHEAT_WET_GROWTH_CHANCE).toBe(0.25);
    expect(WHEAT_DRY_GROWTH_CHANCE).toBe(0.1);
    expect(WHEAT_MAX_GROWTH_PER_TICK).toBe(64);
  });

  it('maps the four wheat blocks to stages 0..3 and back', () => {
    expect(WHEAT_STAGES).toBe(4);
    expect(wheatStageOf(BLOCK.WHEAT_0)).toBe(0);
    expect(wheatStageOf(BLOCK.WHEAT_1)).toBe(1);
    expect(wheatStageOf(BLOCK.WHEAT_2)).toBe(2);
    expect(wheatStageOf(BLOCK.WHEAT_3)).toBe(3);
    expect(wheatStageOf(BLOCK.FARMLAND)).toBeNull();
    expect(wheatStageOf(BLOCK.AIR)).toBeNull();
    expect(wheatBlockForStage(0)).toBe(BLOCK.WHEAT_0);
    expect(wheatBlockForStage(3)).toBe(BLOCK.WHEAT_3);
    expect(wheatBlockForStage(-1)).toBe(BLOCK.WHEAT_0);
    expect(wheatBlockForStage(99)).toBe(BLOCK.WHEAT_3);
    expect(isWheatBlock(BLOCK.WHEAT_2)).toBe(true);
    expect(isWheatBlock(BLOCK.FARMLAND)).toBe(false);
  });

  it('knows exactly the five hoe ids', () => {
    expect(HOE_ITEM_IDS).toEqual([
      'wooden_hoe', 'stone_hoe', 'iron_hoe', 'golden_hoe', 'diamond_hoe',
    ]);
    for (const id of HOE_ITEM_IDS) expect(isHoeItem(id)).toBe(true);
    expect(isHoeItem('wooden_shovel')).toBe(false);
    expect(isHoeItem(null)).toBe(false);
  });
});

describe('farming right-click rules', () => {
  it('tills only dirt/grass with air above and a hoe in hand', () => {
    expect(canTill('wooden_hoe', BLOCK.DIRT, BLOCK.AIR)).toBe(true);
    expect(canTill('diamond_hoe', BLOCK.GRASS, BLOCK.AIR)).toBe(true);
    expect(canTill('wooden_hoe', BLOCK.DIRT, BLOCK.WHEAT_0)).toBe(false);
    expect(canTill('wooden_hoe', BLOCK.STONE, BLOCK.AIR)).toBe(false);
    expect(canTill('wooden_shovel', BLOCK.DIRT, BLOCK.AIR)).toBe(false);
    expect(canTill('wooden_hoe', BLOCK.FARMLAND, BLOCK.AIR)).toBe(false);
  });

  it('plants seeds only on farmland with air above', () => {
    expect(canPlantWheat('wheat_seeds', BLOCK.FARMLAND, BLOCK.AIR)).toBe(true);
    expect(canPlantWheat('wheat_seeds', BLOCK.DIRT, BLOCK.AIR)).toBe(false);
    expect(canPlantWheat('wheat_seeds', BLOCK.FARMLAND, BLOCK.WHEAT_0)).toBe(false);
    expect(canPlantWheat('bread', BLOCK.FARMLAND, BLOCK.AIR)).toBe(false);
  });

  it('bone meal advances two stages and stops at mature', () => {
    expect(boneMealWheat('bone_meal', BLOCK.WHEAT_0)).toBe(BLOCK.WHEAT_2);
    expect(boneMealWheat('bone_meal', BLOCK.WHEAT_1)).toBe(BLOCK.WHEAT_3);
    expect(boneMealWheat('bone_meal', BLOCK.WHEAT_2)).toBe(BLOCK.WHEAT_3);
    expect(boneMealWheat('bone_meal', BLOCK.WHEAT_3)).toBeNull();
    expect(boneMealWheat('bone_meal', BLOCK.FARMLAND)).toBeNull();
    expect(boneMealWheat('wheat', BLOCK.WHEAT_0)).toBeNull();
  });
});
```

- [ ] **Step 2: 寫濕潤、批次成長、收成的失敗測試**

```ts
describe('farmland hydration', () => {
  it('counts water within 4 blocks horizontally and 1 vertically', () => {
    const at = (wx: number, wy: number, wz: number) =>
      wasFarmlandHydrated(blockMap({ [`${wx},${wy},${wz}`]: BLOCK.WATER }), 0, 64, 0);
    expect(at(4, 64, 0)).toBe(true);
    expect(at(-4, 64, 0)).toBe(true);
    expect(at(0, 64, -4)).toBe(true);
    expect(at(0, 65, 0)).toBe(true);
    expect(at(0, 63, 0)).toBe(true);
    expect(at(5, 64, 0)).toBe(false);
    expect(at(0, 66, 0)).toBe(false);
    expect(at(0, 62, 0)).toBe(false);
  });
});

describe('growWheatBatch', () => {
  const wetWorld = blockMap({ '0,63,0': BLOCK.FARMLAND, '4,63,0': BLOCK.WATER });
  const dryWorld = blockMap({ '0,63,0': BLOCK.FARMLAND });
  /** 任意 x/z、y=63 都是耕地；用來測多株輪替（沒有水 → 乾燥 10%）。 */
  const farmlandEverywhere = (_x: number, y: number, _z: number): number =>
    y === 63 ? BLOCK.FARMLAND : BLOCK.AIR;
  const entries: Array<readonly [string, number]> = [['0,64,0', BLOCK.WHEAT_0]];

  it('grows wet at <25% and dry at <10%', () => {
    expect(growWheatBatch({ entries, getBlock: wetWorld, lightAt: () => 9, rng: () => 0.24 }).updates)
      .toEqual([{ x: 0, y: 64, z: 0, from: BLOCK.WHEAT_0, to: BLOCK.WHEAT_1 }]);
    expect(growWheatBatch({ entries, getBlock: wetWorld, lightAt: () => 9, rng: () => 0.25 }).updates)
      .toEqual([]);
    expect(growWheatBatch({ entries, getBlock: dryWorld, lightAt: () => 9, rng: () => 0.09 }).updates)
      .toHaveLength(1);
    expect(growWheatBatch({ entries, getBlock: dryWorld, lightAt: () => 9, rng: () => 0.1 }).updates)
      .toEqual([]);
  });

  it('requires light 9, farmland below, and a non-mature stage', () => {
    expect(growWheatBatch({ entries, getBlock: wetWorld, lightAt: () => 8, rng: () => 0 }).updates).toEqual([]);
    expect(growWheatBatch({ entries, getBlock: dryWorld, lightAt: () => -1, rng: () => 0 }).updates).toEqual([]);
    const noFarm = blockMap({ '0,63,0': BLOCK.DIRT });
    expect(growWheatBatch({ entries, getBlock: noFarm, lightAt: () => 15, rng: () => 0 }).updates).toEqual([]);
    const mature: Array<readonly [string, number]> = [['0,64,0', BLOCK.WHEAT_3]];
    expect(growWheatBatch({ entries: mature, getBlock: dryWorld, lightAt: () => 15, rng: () => 0 }).updates).toEqual([]);
  });

  it('caps at 64 and rotates the cursor so every crop gets a turn', () => {
    const many: Array<readonly [string, number]> = Array.from({ length: 5 }, (_, i) =>
      [`${i},64,0`, BLOCK.WHEAT_0] as const,
    );
    const first = growWheatBatch({
      entries: many, getBlock: farmlandEverywhere, lightAt: () => 15, rng: () => 0, maxGrow: 2,
    });
    expect(first.updates.map((u) => u.x)).toEqual([0, 1]);
    expect(first.nextCursor).toBe(2);
    const second = growWheatBatch({
      entries: many, getBlock: farmlandEverywhere, lightAt: () => 15, rng: () => 0, maxGrow: 2, cursor: first.nextCursor,
    });
    expect(second.updates.map((u) => u.x)).toEqual([2, 3]);
    expect(second.nextCursor).toBe(4);
    expect(WHEAT_MAX_GROWTH_PER_TICK).toBe(64);
  });

  it('ignores malformed keys and non-wheat blocks', () => {
    const mixed: Array<readonly [string, number]> = [
      ['nope', BLOCK.WHEAT_0],
      ['x,1,2', BLOCK.WHEAT_0],
      ['1,64,1', BLOCK.FARMLAND],
      ['2,64,2', BLOCK.WHEAT_1],
    ];
    const r = growWheatBatch({ entries: mixed, getBlock: farmlandEverywhere, lightAt: () => 15, rng: () => 0 });
    expect(r.updates).toEqual([{ x: 2, y: 64, z: 2, from: BLOCK.WHEAT_1, to: BLOCK.WHEAT_2 }]);
  });
});

describe('wheat harvest', () => {
  it('mature wheat drops 1 wheat and 0..3 seeds', () => {
    expect(wheatHarvestFor(3, () => 0)).toEqual({ wheat: 1, seeds: 0 });
    expect(wheatHarvestFor(3, () => 0.999)).toEqual({ wheat: 1, seeds: 3 });
    expect(wheatHarvestFor(3, () => 0.5)).toEqual({ wheat: 1, seeds: 2 });
  });

  it('immature wheat drops one seed and no wheat', () => {
    for (const stage of [0, 1, 2]) expect(wheatHarvestFor(stage, () => 0.999)).toEqual({ wheat: 0, seeds: 1 });
    expect(wheatHarvestFor(Number.NaN, () => 0.999)).toEqual({ wheat: 0, seeds: 1 });
  });

  it('short grass seeds are a 12.5% roll', () => {
    expect(seedsFromShortGrass(() => 0.124)).toBe(1);
    expect(seedsFromShortGrass(() => 0.125)).toBe(0);
    expect(seedsFromShortGrass(() => Number.NaN)).toBe(0);
  });
});
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `npx vitest run src/world/farming.test.ts`
Expected: FAIL，`Cannot find module './farming'`。

- [ ] **Step 4: 實作 `src/world/farming.ts`**

規則實作要點：

- `HOE_ITEM_IDS` 依序五個；`isHoeItem(null)` 先回 false。
- `wheatStageOf` 只認 `WHEAT_0..WHEAT_3`；`wheatBlockForStage` 先 `Number.isFinite(stage) ? Math.floor(stage) : 0`，再夾 0..3 後 `as BlockId`。
- `wasFarmlandHydrated` 掃 `dx/dz ∈ [-4,4]`、`dy ∈ [-1,1]`，任一格 `=== BLOCK.WATER` 回 true。
- `canTill`／`canPlantWheat` 依上方測試；`aboveId` 必須是 `BLOCK.AIR`。
- `boneMealWheat` 依上方測試，回 `wheatBlockForStage(stage + 2)`。
- `growWheatBatch`：
  - `maxGrow` 非有限／<0 → `WHEAT_MAX_GROWTH_PER_TICK`；`cursor` 非有限 → 0。
  - 從 `start = entries.length ? ((cursor % len) + len) % len : 0` 開始環繞。
  - 每個 entry：key 用 `split(',')` 取三整數（`Number.isInteger` 全過才處理）；`stage = wheatStageOf(id)`，`stage === null || stage >= 3` 跳過。
  - `getBlock(x, y - 1, z) !== BLOCK.FARMLAND` 跳過。
  - `lightAt` 必須 `>= WHEAT_MIN_LIGHT`（NaN 自然不成立）。
  - `wet = wasFarmlandHydrated(getBlock, x, y - 1, z)`；`r = rng()`，非有限當 1；`r < (wet ? 0.25 : 0.1)` 才推進。
  - 推進時 `to = wheatBlockForStage(stage + 1)`，push `{x,y,z,from:id as BlockId,to}`，達到 `maxGrow` 停止。
  - `nextCursor = entries.length ? (start + scanned) % entries.length : 0`；`scanned` 是實際看過的 entry 數。
- `wheatHarvestFor`：`stage >= 3`（先 `Math.floor`）為成熟；成熟 `seeds = floor(clamp01(rng()) * 4)`；其餘 `{wheat:0,seeds:1}`。非有限 rng 當 0。
- `seedsFromShortGrass`：非有限或 `>= 0.125` 回 0。

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run src/world/farming.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/world/farming.ts src/world/farming.test.ts
git commit -m "feat(b13): 農業階段、濕潤、成長與收成純邏輯"
```

---

### Task 4: 掉落與手動收成

**Files:**
- Modify: `src/world/drops.ts`
- Modify: `src/world/drops.test.ts`
- Modify: `src/player/interact.ts`
- Modify: `src/player/interact.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `wheatStageOf`、`wheatHarvestFor`、`seedsFromShortGrass`、`SHORT_GRASS_SEED_CHANCE`。
- Produces:
  - `dropItemFor(BLOCK.FARMLAND) === 'dirt'`
  - `dropItemFor(WHEAT_0..2) === 'wheat_seeds'`、`dropItemFor(WHEAT_3) === 'wheat'`
  - `chanceDropFor(BLOCK.SHORT_GRASS, rng)`：12.5% → `'wheat_seeds'`
  - `spawnBlockDrop` 的手動小麥掉落：成熟 1 wheat＋0–3 seeds、未成熟 1 seed

- [ ] **Step 1: 寫失敗測試**

`src/world/drops.test.ts`：

```ts
it('B13: farmland drops dirt and wheat stages map to their harvest items', () => {
  expect(dropItemFor(BLOCK.FARMLAND)).toBe('dirt');
  expect(dropItemFor(BLOCK.WHEAT_0)).toBe('wheat_seeds');
  expect(dropItemFor(BLOCK.WHEAT_1)).toBe('wheat_seeds');
  expect(dropItemFor(BLOCK.WHEAT_2)).toBe('wheat_seeds');
  expect(dropItemFor(BLOCK.WHEAT_3)).toBe('wheat');
});

it('B13: short grass has a 12.5% seed chance', () => {
  expect(chanceDropFor(BLOCK.SHORT_GRASS, () => 0.124)).toBe('wheat_seeds');
  expect(chanceDropFor(BLOCK.SHORT_GRASS, () => 0.125)).toBeNull();
  expect(chanceDropFor(BLOCK.SHORT_GRASS, () => 0.99)).toBeNull();
});
```

`src/player/interact.test.ts`（沿用檔內既有的 `spawnBlockDrop` 測試風格）：

```ts
it('B13: mature wheat drops wheat plus 0..3 seeds in survival', () => {
  const pos = { x: 1, y: 2, z: 3 };
  const drops = spawnBlockDrop([], 'survival', BLOCK.WHEAT_3, pos, null, () => 0.5);
  expect(drops.map((d) => [d.item, d.count])).toEqual([['wheat', 1], ['wheat_seeds', 2]]);
});

it('B13: immature wheat drops one seed and creative drops nothing', () => {
  const pos = { x: 1, y: 2, z: 3 };
  const immature = spawnBlockDrop([], 'survival', BLOCK.WHEAT_1, pos, null, () => 0.99);
  expect(immature.map((d) => [d.item, d.count])).toEqual([['wheat_seeds', 1]]);
  expect(spawnBlockDrop([], 'creative', BLOCK.WHEAT_3, pos, null, () => 0.5)).toEqual([]);
});

it('B13: farmland drops dirt and short grass keeps itself plus a 12.5% seed', () => {
  const pos = { x: 1, y: 2, z: 3 };
  expect(spawnBlockDrop([], 'survival', BLOCK.FARMLAND, pos, null).map((d) => d.item)).toEqual(['dirt']);
  const lucky = spawnBlockDrop([], 'survival', BLOCK.SHORT_GRASS, pos, null, () => 0.1);
  expect(lucky.map((d) => d.item)).toEqual(['wheat_seeds', 'short_grass']);
  const unlucky = spawnBlockDrop([], 'survival', BLOCK.SHORT_GRASS, pos, null, () => 0.9);
  expect(unlucky.map((d) => d.item)).toEqual(['short_grass']);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/world/drops.test.ts src/player/interact.test.ts`
Expected: FAIL（farmland 回 null、小麥沒有特殊掉落）。

- [ ] **Step 3: 實作 `src/world/drops.ts`**

- import `wheatStageOf`、`seedsFromShortGrass`（或 `SHORT_GRASS_SEED_CHANCE`；若用後者，`chanceDropFor` 直接做 roll）。
- `dropItemFor` 在既有 override 之後加：

```ts
if (blockId === BLOCK.FARMLAND) return 'dirt';
const stage = wheatStageOf(blockId);
if (stage !== null) return stage === 3 ? 'wheat' : 'wheat_seeds';
```

- `chanceDropFor` 最前面加：

```ts
if (blockId === BLOCK.SHORT_GRASS) {
  return seedsFromShortGrass(rng) === 1 ? 'wheat_seeds' : null;
}
```

- 更新註解：小麥成熟手動收成多 0–3 種子（`spawnBlockDrop` 特判），爆炸仍只掉 `dropItemFor` 的單一物品。

- [ ] **Step 4: 實作 `src/player/interact.ts`**

`spawnBlockDrop` 在 `gravelDropFor` 之後、`chanceDropFor` 之前加：

```ts
const wheatStage = wheatStageOf(blockId);
if (wheatStage !== null) {
  const harvest = wheatHarvestFor(wheatStage, rng);
  let out = drops;
  if (harvest.wheat > 0) out = spawnDrop(out, 'wheat', harvest.wheat, pos);
  if (harvest.seeds > 0) out = spawnDrop(out, 'wheat_seeds', harvest.seeds, pos);
  return out;
}
```

import `wheatHarvestFor`、`wheatStageOf`。

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run src/world/drops.test.ts src/player/interact.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/world/drops.ts src/world/drops.test.ts src/player/interact.ts src/player/interact.test.ts
git commit -m "feat(b13): 小麥收成、耕地與短草種子掉落"
```

---

### Task 5: `main.ts` 右鍵農業與 5 秒成長 tick

**Files:**
- Modify: `src/main.ts`
- Modify: `src/main.wiring.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `canTill`／`canPlantWheat`／`boneMealWheat`／`isHoeItem`／`wheatStageOf`／`growWheatBatch`／`WHEAT_GROWTH_INTERVAL_SEC`；Task 1 的 `BLOCK.FARMLAND`／`WHEAT_0`；既有 `spawnLightAt`、`damageHeldTool`、`inventory.spendFromSlot`、`audio.play`、`hud.setHotbar`、`RayHit`。
- Produces:
  - `tryFarmingAction(hit: RayHit): boolean`
  - `playFarmingSound(x: number, y: number, z: number): void`
  - 模組層 `farmAcc`／`farmCursor`
  - 主迴圈每 5 秒呼叫一次 `growWheatBatch`

- [ ] **Step 1: 更新／新增 `src/main.wiring.test.ts` 的釘子**

把既有精確次數改為新值，並改說明：

```ts
it('all eight damageHeldTool(1) call sites stay wired (dig / zombie-skeleton / creeper / spider / passive / bow / flint-and-steel / till)', () => {
  // ... 既有註解補上「B13 新增鋤地 −1」
  expect(countOf('damageHeldTool(1)')).toBe(8);
});

it('all seven play call sites stay wired (place / step / break / dig / eat-thud / tool-break / farming)', () => {
  expect(countOf('audio.play(')).toBe(7);
});
```

新增 describe：

```ts
describe('main.ts 接線（B13：農業）', () => {
  it('the farming action runs before generic placement on a hit', () => {
    const body = blockAfter('if (wantPlace) {');
    expect(body).toContain('tryFarmingAction(hit)');
    expect(body).toContain('if (!tryFarmingAction(hit)) tryPlaceBlock(hit)');
    expect(body.indexOf('tryFarmingAction(hit)')).toBeLessThan(body.indexOf('tryPlaceBlock(hit)'));
  });

  it('farming never preempts block use, bow or eating', () => {
    const body = blockAfter('if (wantPlace) {');
    const farmingAt = body.indexOf('tryFarmingAction(hit)');
    for (const marker of [
      'hitBlock === BLOCK.CRAFTING_TABLE',
      'hitBlock === BLOCK.FURNACE',
      'hitBlock === BLOCK.CHEST',
      'hitBlock === BLOCK.BED',
      'hitBlock === BLOCK.TNT',
      'heldIsBow()',
      'heldIsFood()',
    ]) {
      expect(body.indexOf(marker), `${marker} must run before farming`).toBeLessThan(farmingAt);
    }
  });

  it('the wheat growth tick runs once from the playing loop', () => {
    expect(countOf('growWheatBatch(')).toBe(1);
    const playing = playingBranchBody();
    expect(playing).toContain('WHEAT_GROWTH_INTERVAL_SEC');
    expect(playing).toContain('world.setBlock(u.x, u.y, u.z, u.to)');
  });

  it('the farming action owns one till durability and two one-item spends', () => {
    const body = functionBody('tryFarmingAction');
    expect(body).toContain('canTill(');
    expect(body).toContain('canPlantWheat(');
    expect(body).toContain('boneMealWheat(');
    expect(body.match(/spendFromSlot\(selected, 1\)/g) ?? []).toHaveLength(2);
    expect(body).toContain('damageHeldTool(1)');
    expect(functionBody('playFarmingSound')).toContain("audio.play('dig', 'dirt'");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/main.wiring.test.ts`
Expected: FAIL（damage 仍是 7、audio 仍是 6、`growWheatBatch` 不存在）。

- [ ] **Step 3: 在 `src/main.ts` 加 import 與模組狀態**

import：

```ts
import {
  WHEAT_GROWTH_INTERVAL_SEC,
  boneMealWheat,
  canPlantWheat,
  canTill,
  growWheatBatch,
  isHoeItem,
} from './world/farming';
```

在 `clock` 附近加：

```ts
// ---- B13 農業 ----
let farmAcc = 0;
let farmCursor = 0;
```

並在 `resetSessionEntities()`（主檔既有的 session 邊界清理函式）加：

```ts
farmAcc = 0;
farmCursor = 0;
```

（新局／讀檔不沿用上一場的成長節拍與游標。）

- [ ] **Step 4: 實作 `tryFarmingAction` / `playFarmingSound`**

放在 `tryPlaceBlock` 之後（它們需要 `world`／`slots`／`selected`／`inventory`／`audio`／`hud`）：

```ts
/** B13：鋤地／播種／骨粉的右鍵入口；回傳 true ＝ 這次右鍵已被農業消費。 */
function tryFarmingAction(hit: RayHit): boolean {
  const held = slots[selected];
  if (!held) return false;
  const targetId = world.getBlock(hit.x, hit.y, hit.z);
  const aboveId = world.getBlock(hit.x, hit.y + 1, hit.z);

  if (isHoeItem(held.item)) {
    if (!canTill(held.item, targetId, aboveId)) return false;
    world.setBlock(hit.x, hit.y, hit.z, BLOCK.FARMLAND);
    damageHeldTool(1); // 先落地再扣耐久：最後一次使用仍完成鋤地
    playFarmingSound(hit.x, hit.y, hit.z);
    hud.setHotbar(slots, selected);
    return true;
  }

  if (held.item === 'wheat_seeds') {
    if (!canPlantWheat(held.item, targetId, aboveId)) return false;
    if (!inventory.spendFromSlot(selected, 1)) return false;
    world.setBlock(hit.x, hit.y + 1, hit.z, BLOCK.WHEAT_0);
    playFarmingSound(hit.x, hit.y + 1, hit.z);
    hud.setHotbar(slots, selected);
    return true;
  }

  if (held.item === 'bone_meal') {
    const next = boneMealWheat(held.item, targetId);
    if (next === null) return false;
    if (!inventory.spendFromSlot(selected, 1)) return false;
    world.setBlock(hit.x, hit.y, hit.z, next);
    playFarmingSound(hit.x, hit.y, hit.z);
    hud.setHotbar(slots, selected);
    return true;
  }

  return false;
}

/** B13：三種農業動作共用一個柔和的泥土聲（不新增 MaterialGroup）。 */
function playFarmingSound(x: number, y: number, z: number): void {
  audio.play('dig', 'dirt', { pos: { x: x + 0.5, y: y + 0.5, z: z + 0.5 } });
}
```

注意：`boneMealWheat` 已封裝階段判斷，主檔不需要直接 import `wheatStageOf`。

- [ ] **Step 5: 接右鍵分支**

把 `wantPlace` 最後的 `else if (hit)` 改成：

```ts
} else if (hit) {
  viewmodel.startSwing(); // any right-click use swings
  if (!tryFarmingAction(hit)) tryPlaceBlock(hit);
}
```

工作台／熔爐／箱子／床／TNT／弓／進食的分支保持原順序，農業只放在最後的通用分支內。

- [ ] **Step 6: 接 5 秒成長 tick**

在 playing 分支的 `clock`／phase 更新之後、疾跑狀態機之前加：

```ts
// ---- B13 小麥成長：每 5 秒掃 modified overlay，最多 64 株 ----
farmAcc += dt;
if (farmAcc >= WHEAT_GROWTH_INTERVAL_SEC) {
  farmAcc = 0;
  const grown = growWheatBatch({
    entries: [...world.modified.entries()],
    cursor: farmCursor,
    getBlock: (x, y, z) => world.getBlock(x, y, z),
    lightAt: (x, y, z) => {
      const l = spawnLightAt(world, x, y, z, clock.t);
      return l.lit ? Math.max(l.internalSky, l.block) : -1;
    },
  });
  farmCursor = grown.nextCursor;
  for (const u of grown.updates) world.setBlock(u.x, u.y, u.z, u.to);
}
```

- [ ] **Step 7: 跑接線測試**

Run: `npx vitest run src/main.wiring.test.ts`
Expected: PASS。

- [ ] **Step 8: 跑完整測試**

Run: `npm test -- --reporter=dot`
Expected: 全部 PASS；若有其他精確次數因新增呼叫點變紅，逐一以「實際呼叫點」更新並在註解寫明原因，不得放寬成模糊比對。

- [ ] **Step 9: Commit**

```bash
git add src/main.ts src/main.wiring.test.ts
git commit -m "feat(b13): 右鍵鋤地播種骨粉與小麥成長 tick"
```

---

### Task 6: 進度與麵包食物值

**Files:**
- Modify: `src/core/advancements.ts`
- Modify: `src/core/advancements.test.ts`
- Modify: `src/player/eat.ts`
- Modify: `src/player/eat.test.ts`

**Interfaces:**
- Consumes: `wheat`／`bread` 已在 Task 2 成為 `ItemId`。
- Produces:
  - `AdvancementId` 新增 `'farmer' | 'baker'`
  - `ADVANCEMENTS` 17 → 19：`farmer`（取得小麥）、`baker`（取得麵包）
  - `OBTAIN_UNLOCKS`：`wheat → farmer`、`bread → baker`
  - `FOOD_VALUES.bread = { food: 5, saturation: 6 }`

- [ ] **Step 1: 寫失敗測試**

`src/core/advancements.test.ts` 的 `TRIGGERS` 加：

```ts
['farmer', [[{ type: 'obtain', item: 'wheat', mode: 'survival' }]]],
['baker', [[{ type: 'obtain', item: 'bread', mode: 'survival' }]]],
```

再加：

```ts
it('B13: the advancement table has 19 entries with farmer and baker', () => {
  expect(ADVANCEMENTS).toHaveLength(19);
  expect(ADVANCEMENTS.find((a) => a.id === 'farmer')?.icon).toBe('wheat');
  expect(ADVANCEMENTS.find((a) => a.id === 'baker')?.icon).toBe('bread');
});
```

（記得 import `ADVANCEMENTS`。）

`src/player/eat.test.ts` 的精確表加：

```ts
bread: { food: 5, saturation: 6 },
```

並加：

```ts
it('B13: bread restores 5 hunger and 6 saturation', () => {
  expect(foodFor('bread')).toEqual({ food: 5, saturation: 6 });
  expect(canEat({ ...createVitals(), hunger: 10 }, 'bread')).toBe(true);
  expect(canEat({ ...createVitals(), hunger: 20 }, 'bread')).toBe(false);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/advancements.test.ts src/player/eat.test.ts`
Expected: FAIL（`farmer`／`baker` 不存在、`FOOD_VALUES` 沒有 bread）。

- [ ] **Step 3: 實作**

`advancements.ts`：

- `AdvancementId` 加 `'farmer' | 'baker'`。
- `ADVANCEMENTS` 在 `pasture` 後加：

```ts
{ id: 'farmer', title: '小麥農夫', description: '收成第一株小麥', icon: 'wheat' },
{ id: 'baker', title: '麵包師', description: '取得麵包', icon: 'bread' },
```

- `OBTAIN_UNLOCKS` 加 `wheat: 'farmer'`、`bread: 'baker'`。
- `checkAdvancements` 不需改（`obtain` 已走表）。

`eat.ts`：

```ts
bread: { food: 5, saturation: 6 },
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/core/advancements.test.ts src/player/eat.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/core/advancements.ts src/core/advancements.test.ts src/player/eat.ts src/player/eat.test.ts
git commit -m "feat(b13): 小麥與麵包進度、麵包食物值"
```

---

### Task 7: 版本、README、規格文件

**Files:**
- Modify: `package.json`
- Modify: `game.json`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`

**Interfaces:**
- Consumes: Task 1–6 的實作與測試。
- Produces: `version: "0.16.0"`；README／spec 的 B13 條目；`game.json` instructions 加入農業操作。

- [ ] **Step 1: 版本與 manifest**

- `package.json` `"version": "0.16.0"`。
- `game.json` `"version": "0.16.0"`；`cloudSave` 保持 `{ "readableFormats": [1,2,3,4], "writeFormat": 4 }` **不動**。
- `game.json` `instructions` 在既有句子中加入：「手持鋤頭右鍵泥土／草地墾地、手持小麥種子右鍵耕地播種、手持骨粉右鍵小麥催熟（每 5 秒自然成長，水源 4 格內較快）。」

- [ ] **Step 2: README 更新**

- 開頭簡介的批次清單加「農業與骨粉批次」，目前版本改成 `0.16.0`。
- 〈遊戲特色〉合成配方 `55` 改成 `67`，加「鋤頭 5 種（各正／鏡像）＋麵包＋骨粉（0.16.0）」。
- 新增一段 `<b>農業與骨粉（0.16.0）</b>`：鋤地、播種、4 階段、濕潤 25%／乾燥 10%、光照 ≥9、5 秒 tick、骨粉 +2、收成數量、短草 12.5%、farmland 掉 dirt、物品表 97→106。
- 〈與原版的差異〉加 B13 簡化：
  - farmland 是**滿格方塊**（原版 15/16 高）、無濕潤貼圖變化（濕潤只影響成長率）。
  - 無耕地踩踏退化、無作物踩踏、無村莊／堆肥桶／鋤頭附魔。
  - 小麥與 farmland 是**狀態方塊、沒有物品形式**（創造清單拿不到）；只能鋤地／播種產生。
  - 爆炸對小麥只掉 `dropItemFor` 的單一物品（成熟 1 wheat／未成熟 1 seed），沒有手動收成的 0–3 種子加成。
  - 小麥沿用 cross 植被的「可被放置取代」規則：對著小麥放方塊會直接覆蓋（不掉落）；原版作物不可取代。
  - 骨粉只能催熟小麥，不能催花草／樹。
- 把「地表裝飾只有五種……本批沒有種子、沒有骨粉催熟」改成「五種裝飾仍不自然生成種子；種子改由**短草 12.5%** 取得，骨粉由骨頭合成（0.16.0）」。
- 〈專案狀態〉加 B13 條目（功能與簡化；驗證數字與 `docs/releases/v0.16.0.md` 連結留到 Task 8 補，Task 7 不建立失效連結）。
- 需求文件清單加本計畫路徑。

- [ ] **Step 3: 規格書加 §B13 與更新延後清單**

在 `### B12 盔甲（版本 0.15.0）` 後加：

```md
### B13 農業與骨粉（版本 0.16.0）

- **新方塊**：耕地（`FARMLAND=36`）＋小麥四階段（`WHEAT_0..3=37..40`）；tile 45–49、`TILE_COUNT=50`。
  兩者都是**狀態方塊、沒有物品形式**、不進 `PLACEABLE`。
- **新物品 9 個**（97 → 106）：`wheat_seeds`、`wheat`、`bread`、`bone_meal`、五種鋤
  （木／石／鐵／金／鑽）。鋤耐久同材質工具（59／131／250／32／1561）。
- **新配方 12 個**（55 → 67）：五種鋤各正／鏡像（2 材質＋2 木棍）、麵包（3 小麥橫排）、
  骨粉（1 骨頭 → 3）。
- **農業規則**：鋤頭右鍵泥土／草地（上方空氣）→ 耕地，扣 1 耐久（創造不扣）；
  種子右鍵耕地（上方空氣）→ 小麥階段 0，消耗 1 個；骨粉右鍵小麥 → 推進 2 階段
  （上限成熟），消耗 1 個。小麥每 **5 秒**判定一次：光照 ≥9、下方耕地、水源水平 4 格內
  （垂直 ±1）→ 25%，否則 10%；每次最多 64 株、游標輪替。
- **收成**：成熟 1 wheat＋0–3 seeds、未成熟 1 seed；短草 12.5% seeds；耕地挖掉掉 dirt。
- **存檔不升版**：新 block id 只追加（舊版 fallback 空氣）；本機 v6／雲端 format 4、
  `cloudSave` 一字不動。**回退到 0.15.0**：舊版把 36–40 當空氣，耕地上種的小麥會消失；
  新物品 id 會被舊版清洗（背包裡的種子／小麥／麵包／骨粉／鋤消失）。
- 明示簡化：耕地滿格（原版 15/16 高）、無濕潤貼圖、無踩踏退化、無村莊／堆肥桶、
  骨粉不催花草樹木、爆炸小麥只掉單一物品、小麥沿用 cross 的可取代規則
  （放置方塊會直接覆蓋、不掉落）。
- 驗收：`world/farming.test.ts`（階段／右鍵規則／濕潤／批次成長／收成）、掉落與
  接線測試、配方／圖示／耐久／食物／進度守門；typecheck／test／lint／build／perf／
  pinned pack＋validate。
```

更新：

- 開頭「延後」清單移除農業（改成「天氣、經驗、世界高度擴張、地獄／終界」）。
- §5 第 2 點移除農業，並註明已於 B13 完成。
- §6 簡化清單加 B13 的簡化段落，並在「已於 B6–B13 完成」清單加農業。
- §7 決策記錄可加一條「B13 農業與骨粉（0.16.0）：接續被動生物掉落與木頭／泥土循環」。

- [ ] **Step 4: 檢查文件內容**

Run: `grep -n "0.16.0\|B13\|106\|67" README.md docs/superpowers/specs/2026-10-18-wecraft-parity-design.md game.json package.json | head -60`
Expected: 版本、數量、B13 段落都出現；README 的 B13 專案狀態條目只寫功能與簡化，不寫尚未跑出的驗證數字。

- [ ] **Step 5: Commit**

```bash
git add package.json game.json README.md docs/superpowers/specs/2026-10-18-wecraft-parity-design.md
git commit -m "docs(b13): 0.16.0 版本、README 與規格"
```

---

### Task 8: 完整驗證、pinned ZIP、發布說明

**Files:**
- Create: `docs/releases/v0.16.0.md`
- Modify: `README.md`（只補 B13 的實際驗證數字）
- Modify: `.playroom/` 不動（工具已 pinned；若 lock 不符則停手回報）

**Interfaces:**
- Consumes: Task 1–7 全部。
- Produces: 可重現的驗證證據與 `v0.16.0` 發布說明（**不建立 tag／Release**）。

- [ ] **Step 1: 型別、測試、lint、build**

```bash
npm run typecheck
npm test -- --reporter=dot
npm run lint
npm run build
```

Expected: 全部 exit 0；記下 `npm test` 的 tests／files 數與 build 成功訊息。

- [ ] **Step 2: 效能測試**

```bash
npm run test:perf
```

Expected: PASS；記下實測值（門檻與最佳值）。

- [ ] **Step 3: 用 pinned 工具 pack＋validate**

```bash
rm -rf /tmp/opencode/wecraft-b13-tools /tmp/opencode/wecraft-b13.zip
mkdir -p /tmp/opencode/wecraft-b13-tools
unzip -q .playroom/tools/playroom-game-tools-1.2.0.zip -d /tmp/opencode/wecraft-b13-tools
node /tmp/opencode/wecraft-b13-tools/pack-game.mjs /home/tommy/WeCraft/dist /tmp/opencode/wecraft-b13.zip
node /tmp/opencode/wecraft-b13-tools/validate-game.mjs /tmp/opencode/wecraft-b13.zip
```

Expected：`Packed wecraft v0.16.0`、`Valid: wecraft v0.16.0 (tools 1.2.0)`；記下 ZIP 大小與 SHA-256（`sha256sum`）。

- [ ] **Step 4: 瀏覽器 smoke（best effort，不是強制）**

本批未動 iframe／全螢幕／pointer lock／保留鍵，故不強制 Playwright。若環境可用，做一次靜態 `dist/` 的 smoke：

- 用 `python3 -m http.server 4173 --directory dist` 起靜態伺服器。
- 用 `/tmp/opencode/playroom-platform/node_modules/playwright-core`＋`/home/tommy/.cache/ms-playwright/chromium-1248` 開頁。
- 檢查：頁面載入無 console error、canvas 存在、標題畫面可點「單人遊戲」進入 playing。
- **不要宣稱**已用瀏覽器驗證「實際鋤地／播種／成長／收成」——那需要可重現的遊戲內操作探針；列為未驗證。

- [ ] **Step 5: 寫 `docs/releases/v0.16.0.md`**

照 `v0.15.0.md` 的結構寫：

- 標題與引言（農業循環、存檔不升版）。
- 新增：9 物品、12 配方、耕地／小麥／成長／骨粉／收成／短草種子／進度×2／麵包食物值。
- 修正：無（純新增；若驗證中修了 bug 才列）。
- 存檔格式與相容性：本機 v6／雲端 format 4 不變；新 block id 36–40 append-only；回退 0.15.0 的具體後果；新 item id 被舊版清洗。
- 已知問題／簡化：滿格耕地、無濕潤貼圖、無踩踏、骨粉只催小麥、爆炸小麥掉單一物品、無村莊／堆肥桶。
- 驗證：填入 Step 1–3 的**實際**數字與輸出；Step 4 若未跑就寫「未執行」，不要寫「通過」。
- 發布狀態：**未推 tag、未建 Release、未上架**。

- [ ] **Step 6: 補 README 的 B13 驗證數字**

把 Task 7 的 B13 專案狀態條目補上實際 `N tests / M files`、typecheck／lint／build／perf／pinned pack＋validate 的結果；同時更新 `# Test` 段 `npm test` 註解的 `1926 tests / 98 files` 為本批實際數字。不要複製舊批次的數字。

- [ ] **Step 7: 最終全套回歸**

```bash
npm run typecheck
npm test -- --reporter=dot
npm run lint
npm run build
```

Expected: 全綠（文件修改不應影響程式，但以最終狀態為準）。

- [ ] **Step 8: Commit**

```bash
git add docs/releases/v0.16.0.md README.md
git commit -m "docs(release): 0.16.0 農業驗收與發布說明"
```

- [ ] **Step 9: 最終檢查**

```bash
git status --short
git log --oneline -10
```

Expected: 工作區乾淨；HEAD 是 `docs(release): 0.16.0 農業驗收與發布說明`；沒有 tag／Release 動作。

---

## 完成回報格式（執行者必填）

- **程式完成**：B13 實作與單元／接線測試，列出 `N tests / M files`。
- **ZIP 驗證**：pinned tools 1.2.0、pack／validate 的實際輸出與 ZIP SHA-256。
- **GitHub Release**：未建立（未授權）。
- **平台上架**：未執行（未授權）。
- **未驗證**：真實瀏覽器的農業互動（鋤地→播種→5 秒成長→收成）若未跑，明確列出；不要用 smoke 代替。
