import { describe, it, expect } from 'vitest';
import {
  itemFromBlock,
  blockFromItem,
  stackFromBlock,
  stackName,
  maxStack,
  starterSlots,
  sanitizeStack,
  sanitizeSlots,
  ALL_ITEM_IDS,
  HOTBAR_SLOTS,
  MAIN_SLOTS,
  INVENTORY_SLOTS,
  type ItemId,
} from './items';
import { BLOCK, PLACEABLE, HOTBAR_DEFAULT } from '../world/blocks';

// Type-annotated: a missing union member fails `tsc --noEmit`.
const BLOCK_ITEMS: ItemId[] = [
  'grass', 'dirt', 'stone', 'cobblestone', 'oak_log', 'oak_planks',
  'sand', 'gravel', 'glass', 'coal_ore', 'iron_ore',
  'crafting_table', 'furnace', 'chest',
  // B3 Task 3：雲杉／白樺的方塊物品形式（隨三樹種一起補上）
  'spruce_log', 'spruce_leaves', 'birch_log', 'birch_leaves',
  // B3 Task 4：花／草／仙人掌／冰的方塊物品形式（隨 cross 型方塊一起補上）
  'dandelion', 'poppy', 'short_grass', 'cactus', 'ice',
  // B4 Task 1：羊毛的方塊物品形式（隨 BLOCK.WOOL 一起補上 → 羊掉落的羊毛能放回去）
  'wool',
  // B5 Task 1：本批 4 個新方塊物品（礫石 'gravel' 早就在 union 裡（B1 的 dead id）
  // → 本批只是把它接上方塊，不新增 id）
  'gold_ore', 'diamond_ore', 'spruce_planks', 'birch_planks',
  // B6 Task 5：火把的物品形式（隨 BLOCK.TORCH = 32 一起補上 → 挖掉的火把能放回世界）
  'torch',
];
/** B5 Task 2：11 把新工具（木／石／鐵鏟 ＋ 金／鑽的鎬斧劍鏟）。 */
const B5_TOOL_ITEMS: ItemId[] = [
  'wooden_shovel', 'stone_shovel', 'iron_shovel',
  'golden_pickaxe', 'golden_axe', 'golden_sword', 'golden_shovel',
  'diamond_pickaxe', 'diamond_axe', 'diamond_sword', 'diamond_shovel',
];
const TOOL_ITEMS: ItemId[] = [
  'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe',
  'wooden_axe', 'stone_axe', 'iron_axe',
  'wooden_sword', 'stone_sword', 'iron_sword',
  ...B5_TOOL_ITEMS,
];
const DROP_ITEMS: ItemId[] = ['stick', 'coal', 'iron_ingot', 'raw_iron', 'arrow', 'apple'];
/** B4 Task 1：生／熟肉與腐肉（食物值表在 Task 2；熟牛肉的 id 是 'steak'）。 */
const FOOD_ITEMS: ItemId[] = [
  'raw_chicken', 'cooked_chicken',
  'raw_porkchop', 'cooked_porkchop',
  'raw_mutton', 'cooked_mutton',
  'raw_beef', 'steak',
  'rotten_flesh',
];
/** B5 Task 2：3 個新原料（生金／金錠／鑽石）——不是方塊、也不是工具。 */
const B5_MATERIAL_ITEMS: ItemId[] = ['raw_gold', 'gold_ingot', 'diamond'];
/** B4 Task 1：材料（皮革／羽毛／骨頭）＋ B5 Task 2 的 3 個原料——不是食物、也不是工具。 */
const MATERIAL_ITEMS: ItemId[] = ['leather', 'feather', 'bone', ...B5_MATERIAL_ITEMS];
const ALL_ITEMS: ItemId[] = [...new Set<ItemId>([
  ...BLOCK_ITEMS,
  ...TOOL_ITEMS,
  ...DROP_ITEMS,
  ...FOOD_ITEMS,
  ...MATERIAL_ITEMS,
  'oak_leaves', 'snow_block', 'bedrock',
])];

/** 物品總數（**單一真相**）：動工前讀到的現況值 41 ＝ 36 個既有 ＋ B3 Task 4 補的 5 個物品形式，
 *  B4 Task 1 再補 13 個（9 個食物 ＋ 3 個材料 ＋ 1 個羊毛方塊物品）＝ 54。
 *  B5 Task 1 再補 4 個（本批 5 個新方塊的物品形式；礫石 'gravel' 是 B1 留下的 dead id，
 *  **不新增** id，只是接上方塊）→ 58。
 *  B5 Task 2 再補 14 個（3 個原料 ＋ 11 把工具）→ 72。
 *  B6 Task 5 再補 1 個（火把的物品形式，隨 BLOCK.TORCH = 32 一起落地）→ **73**。
 *  下批再加 id → **只改這一個數字**。 */
const TOTAL_ITEM_COUNT = 73;

/** B4 Task 1 的 13 個新 id（照 brief 逐字）。 */
const B4_ITEM_IDS: readonly ItemId[] = [
  'raw_chicken', 'cooked_chicken',
  'raw_porkchop', 'cooked_porkchop',
  'raw_mutton', 'cooked_mutton',
  'raw_beef', 'steak',
  'leather', 'feather', 'wool', 'rotten_flesh', 'bone',
];

/** 本批新增的 id 數（跟 TOTAL_ITEM_COUNT 的 41 + 13 同一組數字）。 */
const B4_ITEM_COUNT = 13;

describe('items', () => {
  it('ItemId union covers every obtainable block item', () => {
    // 總數 54（36 既有 ＋ B3 Task 4 的 5 ＋ B4 Task 1 的 13）—— TOTAL_ITEM_COUNT 是單一真相
    expect(ALL_ITEMS.length).toBe(TOTAL_ITEM_COUNT);
    expect(new Set(ALL_ITEMS).size).toBe(ALL_ITEMS.length);
    // real guard: every block except air and block-only water maps to an item
    for (const id of Object.values(BLOCK)) {
      if (id === BLOCK.AIR || id === BLOCK.WATER) continue;
      expect(itemFromBlock(id), `block ${id} has no item`).not.toBeNull();
    }
  });

  it('ALL_ITEM_IDS is the canonical list: no dupes, same set as the union', () => {
    expect(ALL_ITEM_IDS.length).toBe(TOTAL_ITEM_COUNT);
    expect(new Set(ALL_ITEM_IDS).size).toBe(ALL_ITEM_IDS.length);
    // Same membership as the test's own hand-maintained union mirror — the
    // Record<ItemId, true> source makes drift a tsc error (Minor 5).
    expect(new Set(ALL_ITEM_IDS)).toEqual(new Set(ALL_ITEMS));
  });

  // ---- B4 Task 1：13 個新物品 id（9 個食物 ＋ 3 個材料 ＋ 1 個羊毛方塊物品）----

  it('every B4 item id is a known, sanitizable id', () => {
    for (const id of B4_ITEM_IDS) {
      expect(ALL_ITEM_IDS).toContain(id);
      expect(sanitizeStack({ item: id, count: 2 })).toEqual({ item: id, count: 2 });
      expect(maxStack(id)).toBe(64);
    }
    // 本批新增 13 個 id（清單與計數常數同一組數字）；總數由 TOTAL_ITEM_COUNT 把關
    expect(B4_ITEM_IDS).toHaveLength(B4_ITEM_COUNT);
  });

  it('wool is the item form of the wool block', () => {
    expect(blockFromItem('wool')).toBe(BLOCK.WOOL);
    expect(itemFromBlock(BLOCK.WOOL)).toBe('wool');
    expect(stackFromBlock(BLOCK.WOOL)).toEqual({ item: 'wool', count: 64 });
  });

  // ---- B6 Task 5：火把的物品形式（隨 BLOCK.TORCH = 32 一起落地）----

  it('torch is the item form of the torch block', () => {
    expect(blockFromItem('torch')).toBe(BLOCK.TORCH);
    expect(itemFromBlock(BLOCK.TORCH)).toBe('torch');
    // 火把可堆疊（64）——不進 STACK_ONE
    expect(stackFromBlock(BLOCK.TORCH)).toEqual({ item: 'torch', count: 64 });
    expect(maxStack('torch')).toBe(64);
  });

  // ---- B5 Task 1：本批 5 個新方塊的物品形式（礫石／金礦／鑽石礦／雲杉板材／白樺板材）----
  // 為什麼與方塊同一個 commit：上面兩條守門（`every obtainable block item` 與
  // `every placeable … maps to an item`）會在方塊落地後**立刻**紅 → 方塊與它的
  // 物品形式必須同時落地（B3 Task 3 的註解也是同一條規則）。
  it('the B5 blocks have their item forms in both directions', () => {
    expect(itemFromBlock(BLOCK.GRAVEL)).toBe('gravel');
    expect(itemFromBlock(BLOCK.GOLD_ORE)).toBe('gold_ore');
    expect(itemFromBlock(BLOCK.DIAMOND_ORE)).toBe('diamond_ore');
    expect(itemFromBlock(BLOCK.SPRUCE_PLANKS)).toBe('spruce_planks');
    expect(itemFromBlock(BLOCK.BIRCH_PLANKS)).toBe('birch_planks');
    expect(blockFromItem('gravel')).toBe(BLOCK.GRAVEL); // B1 的 dead id 正式接上方塊
    expect(blockFromItem('gold_ore')).toBe(BLOCK.GOLD_ORE);
    expect(blockFromItem('diamond_ore')).toBe(BLOCK.DIAMOND_ORE);
    expect(blockFromItem('spruce_planks')).toBe(BLOCK.SPRUCE_PLANKS);
    expect(blockFromItem('birch_planks')).toBe(BLOCK.BIRCH_PLANKS);
    // 方塊物品都可堆疊（64）
    expect(stackFromBlock(BLOCK.GRAVEL)).toEqual({ item: 'gravel', count: 64 });
    expect(stackFromBlock(BLOCK.DIAMOND_ORE)).toEqual({ item: 'diamond_ore', count: 64 });
    expect(maxStack('spruce_planks')).toBe(64);
    expect(maxStack('gold_ore')).toBe(64);
  });

  it('the new block items are the item form of their blocks', () => {
    expect(blockFromItem('gravel')).toBe(BLOCK.GRAVEL);
    expect(blockFromItem('gold_ore')).toBe(BLOCK.GOLD_ORE);
    expect(blockFromItem('diamond_ore')).toBe(BLOCK.DIAMOND_ORE);
    expect(blockFromItem('spruce_planks')).toBe(BLOCK.SPRUCE_PLANKS);
    expect(blockFromItem('birch_planks')).toBe(BLOCK.BIRCH_PLANKS);
  });

  // ---- B5 Task 2：3 個原料 ＋ 11 把新工具（物品表 58 → 72）----

  it('the raw materials are not blocks and stack to 64', () => {
    expect(blockFromItem('raw_gold')).toBeNull();
    expect(blockFromItem('gold_ingot')).toBeNull();
    expect(blockFromItem('diamond')).toBeNull();
    expect(maxStack('raw_gold')).toBe(64);
    expect(maxStack('gold_ingot')).toBe(64);
    expect(maxStack('diamond')).toBe(64);
  });

  it('every new tool stacks to 1', () => {
    // 11 個新工具逐一驗證（金／鑽全套 ＋ 木石鐵鏟）
    expect(B5_TOOL_ITEMS).toHaveLength(11);
    for (const tool of B5_TOOL_ITEMS) expect(maxStack(tool)).toBe(1);
  });

  it('the new raw materials and tools are known, sanitizable ids', () => {
    for (const id of B5_MATERIAL_ITEMS) {
      expect(ALL_ITEM_IDS).toContain(id);
      expect(sanitizeStack({ item: id, count: 1 })).toEqual({ item: id, count: 1 });
      expect(blockFromItem(id)).toBeNull();
    }
    const durability: Partial<Record<ItemId, number>> = {
      wooden_shovel: 59,
      stone_shovel: 131,
      iron_shovel: 250,
      golden_pickaxe: 32,
      golden_axe: 32,
      golden_sword: 32,
      golden_shovel: 32,
      diamond_pickaxe: 1561,
      diamond_axe: 1561,
      diamond_sword: 1561,
      diamond_shovel: 1561,
    };
    for (const id of B5_TOOL_ITEMS) {
      expect(ALL_ITEM_IDS).toContain(id);
      expect(sanitizeStack({ item: id, count: 1 })).toEqual({ item: id, count: 1, dur: durability[id] });
      expect(blockFromItem(id)).toBeNull();
    }
  });

  it('the cooked beef item id is steak (原版命名)', () => {
    // 'cooked_beef' 不是物品 id → 熟牛肉的 id 是 'steak'（stackName →「Steak」）
    expect(ALL_ITEM_IDS).toContain('steak');
    expect(ALL_ITEM_IDS as readonly string[]).not.toContain('cooked_beef');
    expect(stackName('steak')).toBe('Steak');
  });

  it('every placeable and default hotbar block maps to an item', () => {
    for (const block of [...PLACEABLE, ...HOTBAR_DEFAULT]) {
      expect(itemFromBlock(block), `block ${block} has no item`).not.toBeNull();
    }
  });

  it('itemFromBlock maps grass to the grass stack id', () => {
    expect(itemFromBlock(BLOCK.GRASS)).toBe('grass');
    expect(itemFromBlock(BLOCK.AIR)).toBeNull();
    expect(itemFromBlock(BLOCK.WATER)).toBeNull(); // water is block-only: never an item
    expect(itemFromBlock(999)).toBeNull();
  });

  it('blockFromItem is the inverse of itemFromBlock', () => {
    for (const block of PLACEABLE) {
      const item = itemFromBlock(block);
      expect(item).not.toBeNull();
      expect(blockFromItem(item!)).toBe(block);
    }
    expect(blockFromItem('stick')).toBeNull();
    expect(blockFromItem('crafting_table')).toBe(BLOCK.CRAFTING_TABLE); // Task 11 block
    expect(blockFromItem('furnace')).toBe(BLOCK.FURNACE); // Task 6 block pair
    expect(blockFromItem('chest')).toBeNull(); // no chest block yet
    expect(blockFromItem('iron_pickaxe')).toBeNull(); // tools are not blocks
  });

  // B3 Task 3：雲杉／白樺方塊的物品形式（隨三樹種一起補上）
  it('the new wood blocks have an item form in both directions', () => {
    expect(itemFromBlock(BLOCK.SPRUCE_LOG)).toBe('spruce_log');
    expect(itemFromBlock(BLOCK.SPRUCE_LEAVES)).toBe('spruce_leaves');
    expect(itemFromBlock(BLOCK.BIRCH_LOG)).toBe('birch_log');
    expect(itemFromBlock(BLOCK.BIRCH_LEAVES)).toBe('birch_leaves');
    expect(blockFromItem('spruce_log')).toBe(BLOCK.SPRUCE_LOG);
    expect(blockFromItem('spruce_leaves')).toBe(BLOCK.SPRUCE_LEAVES);
    expect(blockFromItem('birch_log')).toBe(BLOCK.BIRCH_LOG);
    expect(blockFromItem('birch_leaves')).toBe(BLOCK.BIRCH_LEAVES);
    // 物品可以堆疊（方塊物品都是 64）
    expect(maxStack('spruce_log')).toBe(64);
    expect(maxStack('birch_leaves')).toBe(64);
    expect(stackFromBlock(BLOCK.BIRCH_LOG)).toEqual({ item: 'birch_log', count: 64 });
  });

  // B3 Task 4：花／草／仙人掌／冰的方塊物品形式（隨 cross 型方塊一起補上）
  it('the new plant, cactus and ice blocks have an item form in both directions', () => {
    expect(itemFromBlock(BLOCK.DANDELION)).toBe('dandelion');
    expect(itemFromBlock(BLOCK.POPPY)).toBe('poppy');
    expect(itemFromBlock(BLOCK.SHORT_GRASS)).toBe('short_grass');
    expect(itemFromBlock(BLOCK.CACTUS)).toBe('cactus');
    expect(itemFromBlock(BLOCK.ICE)).toBe('ice');
    expect(blockFromItem('dandelion')).toBe(BLOCK.DANDELION);
    expect(blockFromItem('poppy')).toBe(BLOCK.POPPY);
    expect(blockFromItem('short_grass')).toBe(BLOCK.SHORT_GRASS);
    expect(blockFromItem('cactus')).toBe(BLOCK.CACTUS);
    expect(blockFromItem('ice')).toBe(BLOCK.ICE);
    // 方塊物品都可堆疊（64）
    expect(maxStack('dandelion')).toBe(64);
    expect(maxStack('ice')).toBe(64);
    expect(stackFromBlock(BLOCK.DANDELION)).toEqual({ item: 'dandelion', count: 64 });
  });

  it('stackName title-cases item ids', () => {
    expect(stackName('stick')).toBe('Stick');
    expect(stackName('oak_planks')).toBe('Oak Planks');
  });

  it('maxStack is 64 for stackables like stick', () => {
    expect(maxStack('stick')).toBe(64);
    expect(maxStack('apple')).toBe(64);
    expect(maxStack('furnace')).toBe(64); // block item, stacks like stone
  });

  it('raw_iron is a plain item: not a block, stacks to 64 (Task 6)', () => {
    expect(blockFromItem('raw_iron')).toBeNull();
    expect(maxStack('raw_iron')).toBe(64);
  });

  it('maxStack is 1 for tools and weapons', () => {
    for (const tool of TOOL_ITEMS) expect(maxStack(tool)).toBe(1);
  });

  it('tools still stack to one', () => {
    for (const tool of TOOL_ITEMS) expect(maxStack(tool)).toBe(1);
  });

  it('stackFromBlock builds a full stack by default and honors an explicit count', () => {
    expect(stackFromBlock(BLOCK.GRASS)).toEqual({ item: 'grass', count: 64 });
    expect(stackFromBlock(BLOCK.GRASS, 3)).toEqual({ item: 'grass', count: 3 });
    expect(stackFromBlock(BLOCK.STONE, 1)).toEqual({ item: 'stone', count: 1 });
    expect(stackFromBlock(BLOCK.CRAFTING_TABLE)).toEqual({ item: 'crafting_table', count: 64 });
    expect(stackFromBlock(BLOCK.AIR)).toBeNull();
    expect(stackFromBlock(BLOCK.WATER)).toBeNull(); // no obtainable item form
  });

  // The Critical the live walkthrough found: a survival hotbar starting FULL
  // (64/64 of unrelated blocks) leaves fits() zero slack, so no mined drop can
  // be picked up and no craft result can be taken — the whole loop deadlocks.
  // B5 Task 7：背包是 36 格（前 9 格熱鍵列＋27 格主背包）——生存仍全空，
  // 但留白變多（fits() 的 slack 更大）；形狀變更不是弱化。
  it('starterSlots is a full inventory of nulls in survival (fits() must have slack)', () => {
    const slots = starterSlots('survival');
    expect(slots).toHaveLength(36);
    expect(slots).toHaveLength(INVENTORY_SLOTS);
    expect(slots.every((s) => s === null)).toBe(true);
  });

  it('starterSlots is the default block kit at max stacks in creative', () => {
    const creative = starterSlots('creative');
    expect(creative).toHaveLength(36);
    expect(creative.slice(0, 9)).toEqual(HOTBAR_DEFAULT.map((b) => stackFromBlock(b)));
    expect(creative.slice(9).every((s) => s === null)).toBe(true);
    // 前 9 格（熱鍵列）每一格都是滿堆疊
    for (const s of creative.slice(0, 9)) {
      expect(s).not.toBeNull();
      expect(s!.count).toBe(maxStack(s!.item));
    }
  });

  it('the inventory width constants describe the vanilla layout', () => {
    expect(HOTBAR_SLOTS).toBe(9);
    expect(MAIN_SLOTS).toBe(27);
    expect(INVENTORY_SLOTS).toBe(36);
  });

  it('starterSlots returns a fresh array each call (mutating one cannot alias the next)', () => {
    const a = starterSlots('survival');
    const b = starterSlots('survival');
    expect(a).not.toBe(b);
    a[0] = { item: 'dirt', count: 64 };
    expect(b[0]).toBeNull();

    const c = starterSlots('creative');
    const d = starterSlots('creative');
    expect(c).not.toBe(d);
    expect(c[0]).not.toBe(d[0]);
    c[0]!.count = 1;
    expect(d[0]!.count).toBe(64);
  });

  // ---- Load-path sanitizers (B1.3): save/cloud records are UNTRUSTED input —
  // a removed item id or a junk count must read as "empty slot", never throw.
  it('sanitizeStack accepts real ids with positive finite counts, rejects junk', () => {
    expect(sanitizeStack({ item: 'stone', count: 64 })).toEqual({ item: 'stone', count: 64 });
    // the count passes through unchanged (no rounding) — setSlot floors on write
    expect(sanitizeStack({ item: 'apple', count: 0.5 })).toEqual({ item: 'apple', count: 0.5 });
    expect(sanitizeStack({ item: 'nope', count: 1 })).toBeNull();
    // prototype keys are not item ids (an `in`-style check would let this through)
    expect(sanitizeStack({ item: 'toString', count: 1 })).toBeNull();
    expect(sanitizeStack({ item: 'stone', count: 0 })).toBeNull();
    expect(sanitizeStack({ item: 'stone', count: -1 })).toBeNull();
    expect(sanitizeStack({ item: 'stone', count: Number.NaN })).toBeNull();
    expect(sanitizeStack({ item: 'stone', count: Infinity })).toBeNull();
    expect(sanitizeStack({ item: 'stone' })).toBeNull();
    expect(sanitizeStack(null)).toBeNull();
    expect(sanitizeStack('junk')).toBeNull();
    const source = { item: 'stone' as const, count: 64 };
    expect(sanitizeStack(source)).not.toBe(source); // fresh object, never aliased
  });

  it('sanitizeStack keeps a legal durability and materializes the max when it is missing', () => {
    expect(sanitizeStack({ item: 'wooden_pickaxe', count: 1, dur: 30 })).toEqual({ item: 'wooden_pickaxe', count: 1, dur: 30 });
    expect(sanitizeStack({ item: 'wooden_pickaxe', count: 1 })).toEqual({ item: 'wooden_pickaxe', count: 1, dur: 59 });
    expect(sanitizeStack({ item: 'diamond_sword', count: 1 })).toEqual({ item: 'diamond_sword', count: 1, dur: 1561 });
  });

  it('sanitizeStack clamps an over-max durability and clears a bogus one', () => {
    expect(sanitizeStack({ item: 'wooden_pickaxe', count: 1, dur: 9999 })?.dur).toBe(59);
    expect(sanitizeStack({ item: 'wooden_pickaxe', count: 1, dur: -3 })?.dur).toBe(59);
    expect(sanitizeStack({ item: 'wooden_pickaxe', count: 1, dur: Number.NaN })?.dur).toBe(59);
    expect(sanitizeStack({ item: 'wooden_pickaxe', count: 1, dur: 12.5 })?.dur).toBe(59);
  });

  it('sanitizeStack drops the durability of a non-durable item', () => {
    expect(sanitizeStack({ item: 'stone', count: 1, dur: 5 })).toEqual({ item: 'stone', count: 1 });
    expect(sanitizeStack({ item: 'apple', count: 1, dur: 5 })).toEqual({ item: 'apple', count: 1 });
  });

  it('sanitizeSlots keeps the durability of every slot', () => {
    expect(sanitizeSlots([{ item: 'iron_pickaxe', count: 1, dur: 100 }], 2)).toEqual([
      { item: 'iron_pickaxe', count: 1, dur: 100 },
      null,
    ]);
  });

  it('sanitizeSlots pads and truncates to the requested count', () => {
    // shorter than requested → the tail is null-filled
    expect(sanitizeSlots([{ item: 'stone', count: 3 }], 3)).toEqual([
      { item: 'stone', count: 3 },
      null,
      null,
    ]);
    // longer than requested → the surplus is dropped
    expect(sanitizeSlots([{ item: 'dirt', count: 1 }, { item: 'sand', count: 2 }], 1)).toEqual([
      { item: 'dirt', count: 1 },
    ]);
    // junk is dropped per-slot — the valid neighbours survive
    expect(sanitizeSlots([{ item: 'nope', count: 1 }, { item: 'dirt', count: 4 }], 2)).toEqual([
      null,
      { item: 'dirt', count: 4 },
    ]);
    // a non-array source is all nulls — never a throw
    expect(sanitizeSlots('junk', 2)).toEqual([null, null]);
    expect(sanitizeSlots(undefined, 2)).toEqual([null, null]);
    // the requested count itself is defended: non-finite / negative reads as
    // 0 slots (never an infinite loop), fractional counts floor down
    expect(sanitizeSlots([{ item: 'stone', count: 1 }], Infinity)).toEqual([]);
    expect(sanitizeSlots([{ item: 'stone', count: 1 }], Number.NaN)).toEqual([]);
    expect(sanitizeSlots([{ item: 'stone', count: 1 }], -1)).toEqual([]);
    expect(sanitizeSlots([{ item: 'stone', count: 1 }, { item: 'dirt', count: 2 }], 2.7)).toEqual([
      { item: 'stone', count: 1 },
      { item: 'dirt', count: 2 },
    ]);
  });
});
