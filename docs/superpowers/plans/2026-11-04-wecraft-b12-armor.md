# B12 盔甲 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為 WeCraft 加入 4 材質 × 4 部位的盔甲：合成、裝備欄、減傷、耐久、HUD／第三身外觀，以及本機／雲端存檔的附加欄位。

**Architecture:** 純邏輯集中在 `src/core/armor.ts`（部位分類、護甲點數、減傷、磨損、清洗）。UI 在背包面板新增 4 個裝備格，沿用既有游標堆疊模型；HUD 新增護甲條，第三身玩家模型新增 4 片護甲外觀。`main.ts` 只在四條「盔甲可減免」的傷害路徑呼叫同一個 helper；墜落與飢餓刻意繞過。存檔維持本機 payload v6、雲端 format 4（只加附加欄位 `armor`），不動 `game.json` 的 `cloudSave`。

**Tech Stack:** TypeScript strict、Three.js、Vite、Vitest、既有 IndexedDB／Playroom SDK 存檔管線。

**Spec:** `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`（§6「無盔甲」列管項；本計畫把它結案）。上游規格於 2026-11-04 重新讀取：`game-agent-template.md`、`game-development.md`、`command-contracts.md`、`game.schema.json`、`game-release.yml`、`playroom-sdk.js`、`sdk-versioning.md`、`save-compatibility.md`。

## Global Constraints

- 版本：本批發布候選 **0.15.0**；`game.json` 與 `package.json` 同步。`id` 固定 `wecraft`。
- **不推 tag、不建 Release、不呼叫發布 API**：本計畫只做到「發布候選＋固定工具 ZIP 驗證」；未取得當次發布授權。
- 存檔政策：**本機 payload 維持 v6、雲端 format 維持 4、`cloudSave` 一字不動**。`player.armor`（本機）與 `armor`（雲端）都是附加欄位；舊版 0.14.0 讀到會忽略（盔甲物品 id 也會被舊版清洗掉），回退時盔甲會消失——寫進 README 與發布說明。
- 盔甲只在**生存模式**生效；創造模式不顯示裝備格、不顯示護甲條、不受傷。
- 盔甲**不減免墜落與飢餓傷害**；其餘玩家傷害（生物近戰／骷髏箭／蜘蛛／爆炸／仙人掌）都先過盔甲。
- 材質與部位固定 16 件：皮革／鐵／金／鑽石 × 頭盔／胸甲／護腿／靴子。沒有鎖鏈、獄髓、盔甲紋樣、修補、附魔。
- 減傷公式（明示簡化）：`damage × (1 − min(20, 護甲點數) / 25)`，四捨五入，正傷害至少 1；不模擬盔甲韌性。
- 每次「盔甲可減免」的傷害事件，每個已裝備部位各扣 1 耐久；歸零即壞、移除並 toast。
- 動到 UI／玩家狀態但不動 iframe、全螢幕、pointer lock、瀏覽器保留鍵 → 不強制 Playwright；真實瀏覽器的盔甲遊玩列為未驗證，不宣稱通過。
- 完成門檻：`npm run typecheck`、`npm test`、`npm run build`、`npm run lint` 全綠；`.playroom/game-tools.lock.json` 指定的固定工具 `pack-game.mjs`＋`validate-game.mjs` 全過；`npm run test:perf` 照舊跑一次。

## Review Focus

- **該繞過盔甲的傷害**：墜落與飢餓若誤套減傷，玩家會變成半無敵；`fall`／`starve` 路徑必須完全不出現 `applyArmorDamage`。
- **壞掉的盔甲**：最後一點耐久的那一件必須在該次傷害後消失，不能留下 `dur: 0` 的殭屍裝備；同一次傷害仍要算完減傷。
- **錯誤物品進裝備格**：石頭、鎬、或其他部位的盔甲不得放進頭盔格；UI 與清洗器都要拒絕，不能只靠 UI。
- **舊存檔／舊雲端**：沒有 `armor` 欄位的 v6／format 4 payload 必須載入成四格空，不能整包拒收。
- **模式邊界**：創造模式看不到裝備格與護甲條；切回生存時原本穿著的盔甲仍在，且 HUD／第三身外觀同步。

---

### Task 1: 盔甲核心模型、物品與耐久

**Files:**
- Create: `src/core/armor.ts`
- Create: `src/core/armor.test.ts`
- Modify: `src/core/items.ts`（`ItemId`、`ITEM_IDS`、`STACK_ONE`、`ALL_ITEM_IDS` 註解）
- Modify: `src/core/durability.ts`（16 個耐久上限）
- Modify: `src/core/items.test.ts`
- Modify: `src/core/durability.test.ts`（若現有測試以「工具」列舉，改成正向表驅動）

**Interfaces:**
- Produces:
  - `type ArmorSlot = 'helmet' | 'chestplate' | 'leggings' | 'boots'`
  - `type ArmorMaterial = 'leather' | 'iron' | 'golden' | 'diamond'`
  - `type ArmorSet = Record<ArmorSlot, ItemStack | null>`
  - `const ARMOR_SLOTS: readonly ArmorSlot[]`
  - `const ARMOR_ITEM_IDS: readonly ItemId[]`（16 個）
  - `function emptyArmorSet(): ArmorSet`
  - `function armorSlotForItem(item: ItemId): ArmorSlot | null`
  - `function armorMaterialOf(item: ItemId): ArmorMaterial | null`
  - `function armorPointsFor(item: ItemId): number`
  - `function totalArmorPoints(set: ArmorSet): number`（0–20）
  - `function absorbArmorDamage(set: ArmorSet, amount: number): { damage: number; armor: ArmorSet; broken: Array<{ slot: ArmorSlot; item: ItemId }> }`
  - `function normalizeArmorSet(raw: unknown): ArmorSet`
- Consumes: `ItemStack`／`ItemId`、`damageStack`／`maxDurability`。

- [ ] **Step 1: 寫失敗測試（核心盔甲）**

```ts
import {
  ARMOR_ITEM_IDS, ARMOR_SLOTS, emptyArmorSet, armorSlotForItem,
  armorMaterialOf, armorPointsFor, totalArmorPoints, absorbArmorDamage,
  normalizeArmorSet, type ArmorSet,
} from './armor';

const piece = (item: Parameters<typeof armorPointsFor>[0], dur?: number) => ({
  item, count: 1, ...(dur === undefined ? {} : { dur }),
});

it('has exactly 16 armor ids and the four slots', () => {
  expect(ARMOR_ITEM_IDS).toHaveLength(16);
  expect(ARMOR_SLOTS).toEqual(['helmet', 'chestplate', 'leggings', 'boots']);
  expect(armorSlotForItem('diamond_chestplate')).toBe('chestplate');
  expect(armorSlotForItem('stone')).toBeNull();
  expect(armorMaterialOf('golden_boots')).toBe('golden');
});

it('uses the vanilla armor point table', () => {
  const iron: ArmorSet = {
    helmet: piece('iron_helmet'), chestplate: piece('iron_chestplate'),
    leggings: piece('iron_leggings'), boots: piece('iron_boots'),
  };
  expect(totalArmorPoints(iron)).toBe(15);
  expect(totalArmorPoints(emptyArmorSet())).toBe(0);
  expect(armorPointsFor('diamond_chestplate')).toBe(8);
});

it('reduces damage by 4% per point, capped at 80%, minimum 1', () => {
  const diamond: ArmorSet = {
    helmet: piece('diamond_helmet'), chestplate: piece('diamond_chestplate'),
    leggings: piece('diamond_leggings'), boots: piece('diamond_boots'),
  };
  expect(absorbArmorDamage(diamond, 10).damage).toBe(2);
  expect(absorbArmorDamage(diamond, 1).damage).toBe(1);
  const none = emptyArmorSet();
  expect(absorbArmorDamage(none, 10)).toEqual({ damage: 10, armor: none, broken: [] });
  expect(absorbArmorDamage(none, Number.NaN).damage).toBe(Number.NaN); // 原樣回傳，不磨損
});

it('wears every equipped piece by 1 and removes broken pieces', () => {
  const set: ArmorSet = {
    helmet: piece('leather_helmet', 2), chestplate: piece('leather_chestplate', 80),
    leggings: piece('leather_leggings', 75), boots: piece('leather_boots', 1),
  };
  const hit = absorbArmorDamage(set, 10);
  expect(hit.armor.helmet).toEqual({ item: 'leather_helmet', count: 1, dur: 1 });
  expect(hit.armor.chestplate?.dur).toBe(79);
  expect(hit.armor.boots).toBeNull();
  expect(hit.broken).toEqual([{ slot: 'boots', item: 'leather_boots' }]);
  expect(set.boots?.dur).toBe(1); // 輸入不被改動
});
```

```ts
it('normalizes untrusted armor: right slot, count 1, legal durability', () => {
  const raw = {
    helmet: { item: 'stone', count: 64 },
    chestplate: { item: 'iron_chestplate', count: 64, dur: 9999 },
    leggings: { item: 'diamond_leggings', count: 1, dur: -3 },
    boots: 'junk',
  };
  expect(normalizeArmorSet(raw)).toEqual({
    helmet: null,
    chestplate: { item: 'iron_chestplate', count: 1, dur: 240 },
    leggings: { item: 'diamond_leggings', count: 1, dur: 495 },
    boots: null,
  });
  expect(normalizeArmorSet(null)).toEqual(emptyArmorSet());
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/armor.test.ts src/core/items.test.ts`
Expected: FAIL — `Cannot find module './armor'` 或未知 item id。

- [ ] **Step 3: 實作 `src/core/armor.ts`**

用 `sanitizeStack`（`items.ts`）當唯一入口；每一格只接受 `armorSlotForItem(item) === slot` 的堆疊，`count` 強制 1。`absorbArmorDamage` 對 `amount <= 0`／非有限值原樣回傳同一個 `set`；護甲點數 0 也原樣回傳；否則先算 `Math.max(1, Math.round(amount * (1 - points / 25)))`，再對每件 `damageStack(stack, 1)`，壞掉者回傳 `{ slot, item }` 並設 `null`。`totalArmorPoints` 先加總再夾到 20。

- [ ] **Step 4: 把 16 個 id 接進 `items.ts` 與 `durability.ts`**

`ItemId` 追加：

```ts
| 'leather_helmet' | 'leather_chestplate' | 'leather_leggings' | 'leather_boots'
| 'iron_helmet' | 'iron_chestplate' | 'iron_leggings' | 'iron_boots'
| 'golden_helmet' | 'golden_chestplate' | 'golden_leggings' | 'golden_boots'
| 'diamond_helmet' | 'diamond_chestplate' | 'diamond_leggings' | 'diamond_boots'
```

`ITEM_IDS` 同步 16 個 `true`；`STACK_ONE` 加入全部 16 個。`TOOL_MAX_DURABILITY` 加入：

```ts
leather_helmet: 55, leather_chestplate: 80, leather_leggings: 75, leather_boots: 65,
iron_helmet: 165, iron_chestplate: 240, iron_leggings: 225, iron_boots: 195,
golden_helmet: 77, golden_chestplate: 112, golden_leggings: 105, golden_boots: 91,
diamond_helmet: 363, diamond_chestplate: 528, diamond_leggings: 495, diamond_boots: 429,
```

- [ ] **Step 5: 更新 `items.test.ts`**

`TOTAL_ITEM_COUNT` 81 → **97**；新增 `ARMOR_ITEMS` 陣列並併進 `ALL_ITEMS`；新增測試：16 個 id 都在 `ALL_ITEM_IDS`、`maxStack` 全為 1、`maxDurability` 對上表、`blockFromItem` 全為 `null`。

- [ ] **Step 6: 跑測試**

Run: `npx vitest run src/core/armor.test.ts src/core/items.test.ts src/core/durability.test.ts`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/core/armor.ts src/core/armor.test.ts src/core/items.ts src/core/items.test.ts src/core/durability.ts src/core/durability.test.ts
git commit -m "feat(b12): 盔甲核心模型、物品與耐久"
```

---

### Task 2: 16 個合成配方與物品圖示

**Files:**
- Modify: `src/core/recipes.ts`
- Modify: `src/core/recipes.test.ts`
- Modify: `src/ui/icons.ts`
- Modify: `src/ui/icons.test.ts`

**Interfaces:**
- Consumes: Task 1 的 16 個 `ItemId`、`ArmorMaterial`。
- Produces: `RECIPES.length === 55`；`drawItemArt` 對 16 個 id 都有 case label。

- [ ] **Step 1: 寫失敗測試（配方）**

```ts
it('holds exactly the 55 settled recipes, no extras', () => {
  expect(RECIPES.length).toBe(55);
});

it('every armor piece has the vanilla-shaped recipe', () => {
  const cases: Array<[string, ItemId, number]> = [
    ['leather_helmet', 'leather', 5],
    ['iron_chestplate', 'iron_ingot', 8],
    ['golden_leggings', 'gold_ingot', 7],
    ['diamond_boots', 'diamond', 4],
  ];
  for (const [id, material] of cases) {
    const r = recipe(id);
    expect(r.kind).toBe('shaped');
    const cells = r.pattern.flat().filter((c) => c === material);
    expect(cells.length).toBe(id.endsWith('_helmet') ? 5 : id.endsWith('_chestplate') ? 8 : id.endsWith('_leggings') ? 7 : 4);
  }
});
```

（上表 `cases` 的三元組第三欄可省略，直接用 id 後綴算數量；實作時保持一致。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/core/recipes.test.ts`
Expected: FAIL — `RECIPES.length` 仍是 39。

- [ ] **Step 3: 加入 16 個 shaped 配方**

新增格常量：

```ts
const L: PatternCell = 'leather';
const IRON: PatternCell = 'iron_ingot';
const GOLD: PatternCell = 'gold_ingot';
const DIAMOND: PatternCell = 'diamond';
```

四種形狀（`X` 代材質）：

```ts
// helmet
[X, X, X]
[X, null, X]
// chestplate
[X, null, X]
[X, X, X]
[X, X, X]
// leggings
[X, X, X]
[X, null, X]
[X, null, X]
// boots
[X, null, X]
[X, null, X]
```

16 個 recipe id 用 `leather_helmet` … `diamond_boots`；`result: { item: id, count: 1 }`。放在 `tnt` 之後，保持既有順序。更新檔頭「exactly 39」與測試的排序清單。

- [ ] **Step 4: 寫失敗測試（圖示）**

在 `icons.test.ts` 新增：

```ts
it('every B12 armor id has its own icon branch', () => {
  const labels = new Set(drawItemArtCaseLabels(ICONS_SOURCE));
  for (const id of ARMOR_ITEM_IDS) {
    expect(blockFromItem(id), `${id} 不應有方塊物品形式`).toBeNull();
    expect(labels.has(id), `icons.ts drawItemArt() has no case for ${id}`).toBe(true);
  }
});
```

- [ ] **Step 5: 實作盔甲圖示**

在 `icons.ts` 新增：

```ts
const ARMOR_COLORS = {
  leather: { fill: '#8a5a2b', edge: '#b8945f' },
  iron: { fill: '#7f8fa1', edge: '#b9c6d4' },
  golden: { fill: '#f0c83c', edge: '#ffe89a' },
  diamond: { fill: '#78dce8', edge: '#bff2f7' },
} as const;

function drawArmorArt(ctx: CanvasRenderingContext2D, item: ItemId): void;
```

依 `armorMaterialOf(item)` 取色、依 id 後綴畫頭盔（圓頂＋臉洞）、胸甲（肩＋軀幹）、護腿（腰帶＋兩腿）、靴子（兩隻 L 形）。`drawItemArt` 用四個 grouped case（每個 4 個 id）呼叫它。所有 16 個 case label 都要真的出現在 `drawItemArt` 的 switch 裡。

- [ ] **Step 6: 跑測試**

Run: `npx vitest run src/core/recipes.test.ts src/ui/icons.test.ts`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/core/recipes.ts src/core/recipes.test.ts src/ui/icons.ts src/ui/icons.test.ts
git commit -m "feat(b12): 盔甲配方與物品圖示"
```

---

### Task 3: 背包面板的 4 個裝備格

**Files:**
- Modify: `src/ui/inventory.ts`
- Modify: `src/ui/ui.css`
- Modify: `src/ui/ui.test.ts`

**Interfaces:**
- Consumes: `ArmorSet`、`ArmorSlot`、`ARMOR_SLOTS`、`armorSlotForItem`。
- Produces:
  - `InventoryOpenOptions.armor?: ArmorSet`
  - `InventoryOpenOptions.onArmorChange?: (slot: ArmorSlot, stack: ItemStack | null) => void`
  - 生存面板多出 `.ui-inv-armor` 容器與 4 個 `.ui-slot`；索引命名空間仍以 0–35 表示背包，36–39 表示盔甲格（只在 UI 內部使用）。

- [ ] **Step 1: 寫失敗測試（UI）**

```ts
it('survival renders four armor slots and equips through the cursor', () => {
  const root = document.getElementById('ui-root')!;
  const inv = createInventory(root);
  const s = slots36();
  s[10] = { item: 'iron_helmet', count: 1, dur: 165 };
  const armor = emptyArmorSet();
  const changes: Array<[string, ItemStack | null]> = [];
  inv.open(s, 0, () => {}, undefined, undefined, 'survival', {
    armor,
    onSlotChange: (i, st) => { s[i] = st; },
    onArmorChange: (slot, st) => { armor[slot] = st; changes.push([slot, st]); },
  });
  expect(root.querySelectorAll('.ui-inv-armor .ui-slot').length).toBe(4);
  const helmet = root.querySelectorAll<HTMLElement>('.ui-inv-armor .ui-slot')[0];
  const main0 = root.querySelectorAll<HTMLElement>('.ui-inv-main .ui-slot')[1]; // index 10
  main0.click();       // 拿起頭盔
  helmet.click();      // 放進頭盔格
  expect(armor.helmet).toEqual({ item: 'iron_helmet', count: 1, dur: 165 });
  expect(changes.at(-1)?.[0]).toBe('helmet');
  inv.close();
});

it('rejects a wrong item in an armor slot without moving the cursor', () => {
  const root = document.getElementById('ui-root')!;
  const inv = createInventory(root);
  const s = slots36();
  s[10] = { item: 'stone', count: 3 };
  const armor = emptyArmorSet();
  const onArmorChange = vi.fn();
  inv.open(s, 0, () => {}, undefined, undefined, 'survival', {
    armor, onArmorChange, onSlotChange: (i, st) => { s[i] = st; },
  });
  root.querySelectorAll<HTMLElement>('.ui-inv-main .ui-slot')[1].click(); // 拿起石頭
  root.querySelectorAll<HTMLElement>('.ui-inv-armor .ui-slot')[0].click();
  expect(onArmorChange).not.toHaveBeenCalled();
  expect(root.querySelectorAll('.ui-cursor-stack').length).toBe(1); // 石頭仍在游標
  inv.close();
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/ui/ui.test.ts`
Expected: FAIL — 沒有 `.ui-inv-armor`。

- [ ] **Step 3: 實作 UI**

在 `InventoryOpenOptions` 加兩個可選欄位；`open()` 把 `options.armor` 存成 `armorView`，只有 `survival && armor` 才建立 `.ui-inv-armor` 與 4 個格子（`title` 用「頭盔／胸甲／護腿／靴子」）。`slotStack(36..39)` 讀 `armorView`；`emitChange` 依索引分流到 `onArmorChange`／`onSlotChange`。左鍵：空格拿取、目標盔甲格只接受 `armorSlotForItem(cursor.item) === slot` 的堆疊（交換也一樣），否則 no-op；右鍵同理（盔甲格數量必為 1）。`render()` 同步重繪盔甲格。

CSS：`.ui-inv-armor { display:grid; grid-template-columns: repeat(4, 44px); gap:4px; margin-bottom:8px; }`，格子沿用 `.ui-inv-main .ui-slot` 的視覺（把選取器一併加上 `.ui-inv-armor .ui-slot`）。

- [ ] **Step 4: 跑測試**

Run: `npx vitest run src/ui/ui.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/ui/inventory.ts src/ui/ui.css src/ui/ui.test.ts
git commit -m "feat(b12): 背包面板盔甲裝備格"
```

---

### Task 4: 護甲條 HUD 與第三身盔甲外觀

**Files:**
- Modify: `src/ui/survival-hud.ts`
- Modify: `src/ui/survival-hud.test.ts`
- Modify: `src/ui/ui.css`
- Modify: `src/render/player-model.ts`
- Modify: `src/render/player-model.test.ts`

**Interfaces:**
- Consumes: `ArmorSet`、`ArmorMaterial`、`armorMaterialOf`、`totalArmorPoints`。
- Produces:
  - `renderArmorBar(container: HTMLElement, points: number): void`
  - `ARMOR_FILL`、`ARMOR_EMPTY`（測試用）
  - `PlayerModel.setArmor(set: ArmorSet): void`

- [ ] **Step 1: 寫失敗測試（HUD）**

```ts
it('renders 10 shield icons, half-filled for odd points', () => {
  renderArmorBar(container, 15);
  expect(iconStates('.armor-icon', container)).toEqual(FIFTEEN);
});

it('zero armor renders all-empty shields; NaN falls back to empty', () => {
  renderArmorBar(container, 0);
  expect(iconStates('.armor-icon', container)).toEqual(new Array(10).fill('empty'));
  renderArmorBar(container, Number.NaN);
  expect(iconStates('.armor-icon', container)).toEqual(new Array(10).fill('empty'));
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/ui/survival-hud.test.ts`
Expected: FAIL — `renderArmorBar` 不存在。

- [ ] **Step 3: 實作 HUD**

在 `survival-hud.ts` 加 `ARMOR` BarSpec（`.armor-icon`、盾牌 8×8 像素圖）與 `renderArmorBar`；重用既有 `renderBar`／`iconState`。`points` 以 0–20 半單位計，非有限值視為 0。CSS：

```css
.armor {
  position: fixed;
  bottom: 90px;
  left: 50%;
  transform: translateX(-50%);
  width: 364px;
  display: flex;
  justify-content: flex-start;
  pointer-events: none;
}
.armor-icon { width: 16px; height: 16px; image-rendering: pixelated; }
```

同時把 `.ui-item-name` 的 `bottom` 92 → **112**、`.eat-progress` 126 → **146**，避免與護甲條重疊；更新 `ui.css` 的帶狀註解。

- [ ] **Step 4: 寫失敗測試（玩家模型）**

```ts
it('setArmor shows only equipped pieces and tints by material', () => {
  const scene = new THREE.Scene();
  const model = createPlayerModel(scene);
  const g = scene.children[0] as THREE.Group;
  model.setArmor(emptyArmorSet());
  expect((g.getObjectByName('armorHelmet') as THREE.Mesh).visible).toBe(false);
  model.setArmor({ ...emptyArmorSet(), helmet: { item: 'iron_helmet', count: 1, dur: 165 } });
  const helmet = g.getObjectByName('armorHelmet') as THREE.Mesh;
  expect(helmet.visible).toBe(true);
  expect(meshColor(helmet)).toBe(0x9aa7b4);
});
```

並把既有「7 個 Mesh／74 三角形」改成「11 個 Mesh／122 三角形」。

- [ ] **Step 5: 實作玩家模型護甲**

新增 4 個 overlay box（名稱 `armorHelmet`／`armorChestplate`／`armorLeggings`／`armorBoots`），初始 `visible = false`，尺寸略大於對應部位；`setArmor` 依 `armorMaterialOf` 設定顏色與可見性。材質色：皮革 `0x8a5a2b`、鐵 `0x9aa7b4`、金 `0xf0c83c`、鑽石 `0x78dce8`。加入 `geometries`／`materials` 陣列以正確 dispose。

- [ ] **Step 6: 跑測試**

Run: `npx vitest run src/ui/survival-hud.test.ts src/render/player-model.test.ts`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/ui/survival-hud.ts src/ui/survival-hud.test.ts src/ui/ui.css src/render/player-model.ts src/render/player-model.test.ts
git commit -m "feat(b12): 護甲條與第三身盔甲外觀"
```

---

### Task 5: main.ts 傷害接線與裝備狀態

**Files:**
- Modify: `src/main.ts`
- Modify: `src/main.wiring.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `emptyArmorSet`、`normalizeArmorSet`、`absorbArmorDamage`、`totalArmorPoints`；Task 3 的 UI options；Task 4 的 `renderArmorBar`／`PlayerModel.setArmor`。
- Produces:
  - 模組層 `let armor: ArmorSet`
  - `function setArmorPiece(slot: ArmorSlot, stack: ItemStack | null): void`
  - `function applyArmorDamage(amount: number): number`
  - `function refreshArmor(): void`

- [ ] **Step 1: 寫失敗測試（結構釘子）**

在 `main.wiring.test.ts` 新增：

```ts
it('B12: armor is applied to four damage paths but not fall/starve', () => {
  expect(countOf('applyArmorDamage(')).toBe(5); // 1 定義 + 4 呼叫
  expect(functionBody('applyMobEvent')).toContain('applyArmorDamage(ev.amount)');
  expect(functionBody('applySpiderDamage')).toContain('applyArmorDamage(ev.amount)');
  expect(functionBody('runExplosion')).toContain('applyArmorDamage(playerDmg)');
  // 仙人掌在 playing 分支
  expect(playing).toContain('applyArmorDamage(hazard.damage)');
  // 墜落與飢餓不得套盔甲
  expect(functionBody('continueGame')).not.toContain('applyArmorDamage');
  expect(playing).toContain('fallDamage(fall.distance)');
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/main.wiring.test.ts`
Expected: FAIL — `countOf('applyArmorDamage(')` 是 0。

- [ ] **Step 3: 實作狀態與 helper**

在 `inventory` 附近加 `let armor: ArmorSet = emptyArmorSet();`。`setArmorPiece` 用 `normalizeArmorSet({ ...armor, [slot]: stack })`，把結果**原地寫回** `armor[slot]`（UI 持有同一個物件），再 `refreshArmor()`。`refreshArmor()` 做兩件事：`renderArmorBar(armorEl, totalArmorPoints(armor))`＋顯示規則（`vitals && totalArmorPoints > 0`），以及 `playerModel.setArmor(armor)`。

```ts
function applyArmorDamage(amount: number): number {
  if (!vitals || currentMode !== 'survival') return amount;
  const hit = absorbArmorDamage(armor, amount);
  if (hit.armor === armor) return amount; // 沒有護甲 → 不磨損、不重繪
  armor = hit.armor;
  for (const b of hit.broken) {
    toasts.push({ title: '盔甲損壞', description: `${stackName(b.item)} 壞掉了`, icon: b.item });
  }
  refreshArmor();
  return hit.damage;
}
```

`applyMobEvent`、`applySpiderDamage`、`runExplosion` 的玩家傷害、仙人掌傷害區塊都改成 `const dealt = applyArmorDamage(<原值>); setVitals(exhaust(damage(vitals, dealt), EXHAUST_HURT));`。墜落（`fallDamage`）與 `tickVitals` 的飢餓傷害**不改**。

- [ ] **Step 4: 接 UI／HUD／模型**

- 在 `vitalsEl` 旁建立 `armorEl`（`.armor`）並 append 到 `uiRoot`。
- `setVitals` 結尾呼叫 `refreshArmor()`（讓創造模式隱藏、生存模式顯示）。
- `inv.open(...)` 的第 7 個參數（options）在生存模式加 `armor` 與 `onArmorChange: setArmorPiece`。
- 初始化時 `refreshArmor()`；`startGame` 內 `armor = emptyArmorSet(); refreshArmor();`。
- `continueGame`／雲端 `applyCloudData` 用 `armor = normalizeArmorSet(payload.player.armor)`（雲端是 `data.armor`）後 `refreshArmor()`。

- [ ] **Step 5: 跑測試**

Run: `npx vitest run src/main.wiring.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/main.wiring.test.ts
git commit -m "feat(b12): main 盔甲傷害與裝備接線"
```

---

### Task 6: 本機／雲端存檔附加欄位

**Files:**
- Modify: `src/world/save.ts`
- Modify: `src/world/save.test.ts`
- Modify: `src/core/cloud-save.ts`
- Modify: `src/core/cloud-save.test.ts`
- Modify: `src/main.ts`（存檔來源與還原來源）
- Modify: `src/main.wiring.test.ts`（存檔來源釘子）

**Interfaces:**
- Consumes: `ArmorSet`、`emptyArmorSet`、`normalizeArmorSet`。
- Produces:
  - `SavePayloadV6.player.armor?: ArmorSet`（附加欄位，版本仍 6）
  - `SavePayloadWithPassiveMobs.player.armor: ArmorSet`（讀寫路徑一律存在）
  - `SaveSources.player.armor: ArmorSet`
  - `CloudData.armor?: ArmorSet`
  - `CloudBuildSource.armor: ArmorSet`
  - `CLOUD_FORMAT_VERSION` 維持 `4`、`CLOUD_READABLE_FORMATS` 維持 `[1,2,3,4]`。

- [ ] **Step 1: 寫失敗測試（本機存檔）**

```ts
it('a v6 payload round-trips equipped armor through IndexedDB', async () => {
  const p = makePayload({
    player: {
      ...makePayload().player,
      armor: {
        helmet: { item: 'iron_helmet', count: 1, dur: 165 },
        chestplate: null,
        leggings: { item: 'diamond_leggings', count: 1, dur: 400 },
        boots: null,
      },
    },
  });
  await saveGame(p);
  const loaded = await loadGame();
  expect(loaded!.player.armor).toEqual(p.player.armor);
});

it('a v6 record without armor loads four empty slots', async () => {
  const raw = makePayload();
  delete raw.player.armor;
  await putRawRecord(raw);
  expect((await loadGame())!.player.armor).toEqual(emptyArmorSet());
});

it('sanitizes wrong-slot and over-max armor on load', async () => {
  await putRawRecord({
    ...makePayload(),
    player: {
      ...makePayload().player,
      armor: {
        helmet: { item: 'stone', count: 1 },
        chestplate: { item: 'iron_chestplate', count: 64, dur: 9999 },
      },
    },
  });
  const loaded = await loadGame();
  expect(loaded!.player.armor.helmet).toBeNull();
  expect(loaded!.player.armor.chestplate).toEqual({
    item: 'iron_chestplate', count: 1, dur: 240,
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/world/save.test.ts`
Expected: FAIL — `armor` 不在 payload／讀回 undefined。

- [ ] **Step 3: 實作本機存檔**

`SavePayloadV6` 的 `player` 改成 `SavePayloadV5['player'] & { armor?: ArmorSet }`；`SavePayloadWithPassiveMobs` 加成 `player: SavePayloadV6['player'] & { armor: ArmorSet }`。`SaveSources.player` 加必填 `armor: ArmorSet`；`collectSavePayload` 寫 `armor: normalizeArmorSet(args.player.armor)`。`loadGame` 在所有版本遷移後的最終回傳補 `player.armor: normalizeArmorSet((value as Partial<SavePayloadV6>).player?.armor)`；不要改版本號、不要碰 `isValidSavePayload` 的版本集合。

- [ ] **Step 4: 寫失敗測試（雲端）**

```ts
it('format 4 stays and armor is additive', () => {
  expect(CLOUD_FORMAT_VERSION).toBe(4);
  expect(CLOUD_READABLE_FORMATS).toEqual([1, 2, 3, 4]);
  expect(acceptCloudData(rawValid())!.armor).toEqual(emptyArmorSet());
});

it('build/accept round-trip armor and deep-copy it', () => {
  const armor = normalizeArmorSet({
    helmet: { item: 'golden_helmet', count: 1, dur: 70 },
  });
  const built = buildCloudData({ ...baseSrc(), armor });
  expect(built.armor).toEqual(armor);
  expect(built.armor).not.toBe(armor);
  expect(acceptCloudData(built)!.armor).toEqual(armor);
});
```

（`baseSrc()` 是測試檔既有 helper；若沒有，補一個回傳完整 `CloudBuildSource` 的函式。）

- [ ] **Step 5: 實作雲端存檔**

`CloudData` 加 `armor?: ArmorSet`；`CloudBuildSource` 加必填 `armor: ArmorSet`；`buildCloudData` 加 `armor: normalizeArmorSet(src.armor)`；`validateCloudData` 對 `r.armor !== undefined` 只要求是物件（非陣列）；`acceptCloudData` 一律回 `armor: normalizeArmorSet(x.armor)`；`mergeCloudData` 以本機為基底帶 `armor`（與 `spawnPoint` 同款 optional spread）。

- [ ] **Step 6: 更新 main 的存檔來源／還原**

`sessionSavePayload` 的 `player` 加 `armor`；`buildCloudData` 呼叫（搜尋 `passiveMobs,` 附近的雲端快照）加 `armor`；`continueGame` 與 `applyCloudData` 用 `normalizeArmorSet` 還原後 `refreshArmor()`。在 `main.wiring.test.ts` 加 `expect(functionBody('sessionSavePayload')).toContain('armor')` 與 `expect(playing).toContain('normalizeArmorSet(payload.player.armor)')`。

- [ ] **Step 7: 跑測試**

Run: `npx vitest run src/world/save.test.ts src/core/cloud-save.test.ts src/main.wiring.test.ts`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add src/world/save.ts src/world/save.test.ts src/core/cloud-save.ts src/core/cloud-save.test.ts src/main.ts src/main.wiring.test.ts
git commit -m "feat(b12): 盔甲存檔附加欄位（本機 v6／雲端 format 4）"
```

---

### Task 7: 版本、文件與完整驗證

**Files:**
- Modify: `game.json`
- Modify: `package.json`
- Modify: `README.md`
- Create: `docs/releases/v0.15.0.md`
- Modify: `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`（§6 把「無盔甲」移出已知簡化，補 B12 條目）

**Interfaces:**
- Consumes: Tasks 1–6。
- Produces: 0.15.0 發布候選與驗證證據。

- [ ] **Step 1: 版本 bump**

`game.json` 與 `package.json` 的 `version` 改 `0.15.0`；`game.json` 其他欄位不動（`cloudSave` 仍 `[1,2,3,4]`／`4`）。

- [ ] **Step 2: README**

- 〈遊戲特色〉加盔甲段落：4 材質 × 4 部位、合成形狀、裝備格、減傷公式、耐久、護甲條、第三身外觀。
- 〈與原版的差異〉移除「無盔甲」，新增本批簡化：無盔甲韌性、無鎖鏈／獄髓、盔甲不減免墜落與飢餓、創造模式不顯示裝備格、舊版回退時盔甲與盔甲物品會消失。
- 〈專案狀態〉加 B12 條目；測試數字等 Step 5 實跑後填。
- 〈操作〉若需要，補「E 開啟背包 → 點盔甲穿到左上裝備格」。

- [ ] **Step 3: 發布說明 `docs/releases/v0.15.0.md`**

照既有格式寫：新增、修正（若有）、存檔格式與相容性提示（**不升版**；舊版忽略 `armor`、盔甲物品 id 會被舊版清洗掉）、已知簡化、驗證（test/typecheck/build/lint/perf/pack/validate；Playwright 未執行且原因）。

- [ ] **Step 4: 規格同步**

在 parity design §6 把「無盔甲」改成已完成，補 §B12 條目（16 件、點數表、耐久表、公式、附加欄位、簡化）。

- [ ] **Step 5: 完整驗證**

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run test:perf
```

Expected: 全綠。記下實際 test 檔數／測試數，回填 README 與 v0.15.0.md。

固定工具（先讀 lock，不要假設版本）：

```bash
cat .playroom/game-tools.lock.json
# 驗 ZIP sha256 與 lock 一致，解壓到 repo 外的暫存目錄
node pack-game.mjs dist /tmp/opencode/wecraft-0.15.0/game.zip
node validate-game.mjs /tmp/opencode/wecraft-0.15.0/game.zip
```

Expected: `Packed wecraft v0.15.0`、`Valid: wecraft v0.15.0 (tools 1.2.0)`（版本以 lock 為準）。

- [ ] **Step 6: Commit**

```bash
git add game.json package.json README.md docs/releases/v0.15.0.md docs/superpowers/specs/2026-10-18-wecraft-parity-design.md
git commit -m "docs(release): 0.15.0 盔甲驗收與發布說明"
```

- [ ] **Step 7: 最終回報**

區分「程式完成／ZIP 驗證／Release／平台上架」；明確列出未執行：tag、GitHub Release、平台上架、真實瀏覽器盔甲遊玩探針（若未做）。不宣稱未驗證項目通過。
