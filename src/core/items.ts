import { BLOCK, HOTBAR_DEFAULT, type BlockId } from '../world/blocks';
import { maxDurability, normalizeDurability } from './durability';

export type ItemId =
  | 'grass' | 'dirt' | 'stone' | 'cobblestone' | 'oak_log' | 'oak_planks'
  | 'sand' | 'gravel' | 'glass' | 'coal_ore' | 'iron_ore'
  | 'crafting_table' | 'furnace' | 'chest'
  | 'stick' | 'coal' | 'iron_ingot' | 'raw_iron'
  | 'wooden_pickaxe' | 'stone_pickaxe' | 'iron_pickaxe'
  | 'wooden_axe' | 'stone_axe' | 'iron_axe'
  | 'wooden_sword' | 'stone_sword' | 'iron_sword'
  | 'arrow' | 'apple'
  // Blocks that exist in world/blocks.ts today but were missing from the plan's
  // union — without them the creative hotbar/palette can't represent them
  // (plan requirement: "union covers blocks" + keep existing behavior working).
  | 'oak_leaves' | 'snow_block' | 'bedrock'
  // B3 Task 3: spruce/birch blocks (the three-tree-species batch). They land
  // WITH their item forms — the "every block maps to an item" invariant below
  // is the guard that forced it.
  | 'spruce_log' | 'spruce_leaves' | 'birch_log' | 'birch_leaves'
  // B3 Task 4: dandelion/poppy/short_grass (cross-shaped plants), cactus and
  // ice — same reason: the block↔item invariant below forces the pairing.
  | 'dandelion' | 'poppy' | 'short_grass' | 'cactus' | 'ice'
  // B4 Task 1：羊毛（方塊物品形式，隨 BLOCK.WOOL = 26 一起補上 → 羊掉落的羊毛
  // 能放回世界裡）。羊毛方塊**不進世界生成**（原版羊毛也不自然生成）。
  | 'wool'
  // B4 Task 1：被動生物的食物／材料物品。
  // 熟牛肉的 id 用原版的 'steak'（不是 'cooked_beef'）→ `stackName` 轉出來是
  // 「Steak」，與原版一致；其餘八個生／熟肉 id 轉出來剛好也是原版名稱。
  | 'raw_chicken' | 'cooked_chicken' | 'raw_porkchop' | 'cooked_porkchop'
  | 'raw_mutton' | 'cooked_mutton' | 'raw_beef' | 'steak'
  | 'leather' | 'feather' | 'rotten_flesh' | 'bone'
  // B5 Task 1：本批 5 個新方塊的物品形式（礫石／金礦／鑽石礦／雲杉板材／白樺板材）。
  // 為什麼在方塊落地的那個 commit 就補：`itemFromBlock` 的兩條守門（每個 block 都要有
  // 物品形式、每個 PLACEABLE 都要有物品形式）會在方塊落地後**立刻紅**——方塊與它的
  // 物品形式必須同時落地（B3 Task 3 也是同一條規則）。'gravel' 本來就在 union 裡
  // （B1 留下的 dead id），這批只是把它接上方塊 27，不新增 id。
  | 'gold_ore' | 'diamond_ore' | 'spruce_planks' | 'birch_planks'
  // B5 Task 2：原料（生金／金錠／鑽石）與新工具（金／鑽鎬斧劍鏟 ＋ 木石鐵鏟）。
  // 金／鑽工具是採掘等級表（Task 3）與配方（Task 4）的原料；鏟讓礫石／沙等
  // shovel-fast 方塊終於有對應工具（先前只能空手慢慢挖）。
  | 'raw_gold' | 'gold_ingot' | 'diamond'
  | 'wooden_shovel' | 'stone_shovel' | 'iron_shovel'
  | 'golden_pickaxe' | 'golden_axe' | 'golden_sword' | 'golden_shovel'
  | 'diamond_pickaxe' | 'diamond_axe' | 'diamond_sword' | 'diamond_shovel'
  // B6 Task 5：火把的物品形式（隨 BLOCK.TORCH = 32 一起補上 → 挖掉的火把能
  // 放回世界）。與方塊同一個 commit：`itemFromBlock` 的兩條守門（每個 block 都
  // 要有物品形式、每個 PLACEABLE 都要有物品形式）會在方塊落地後立刻紅。
  | 'torch';

/** Exhaustive canonical id list (Minor 5): the `Record<ItemId, true>` is
 *  total, so adding a union member without listing it here is a TYPE ERROR —
 *  the runtime allow-list derived from it (`ITEM_ID_SET`, used by
 *  `sanitizeStack`/`sanitizeSlots`) can never silently drift behind the
 *  union again. */
const ITEM_IDS: Record<ItemId, true> = {
  grass: true, dirt: true, stone: true, cobblestone: true, oak_log: true, oak_planks: true,
  sand: true, gravel: true, glass: true, coal_ore: true, iron_ore: true,
  crafting_table: true, furnace: true, chest: true,
  stick: true, coal: true, iron_ingot: true, raw_iron: true,
  wooden_pickaxe: true, stone_pickaxe: true, iron_pickaxe: true,
  wooden_axe: true, stone_axe: true, iron_axe: true,
  wooden_sword: true, stone_sword: true, iron_sword: true,
  arrow: true, apple: true,
  oak_leaves: true, snow_block: true, bedrock: true,
  spruce_log: true, spruce_leaves: true, birch_log: true, birch_leaves: true,
  dandelion: true, poppy: true, short_grass: true, cactus: true, ice: true,
  // B4 Task 1：13 個新 id（9 個食物 ＋ 3 個材料 ＋ 羊毛方塊物品）
  wool: true,
  raw_chicken: true, cooked_chicken: true,
  raw_porkchop: true, cooked_porkchop: true,
  raw_mutton: true, cooked_mutton: true,
  raw_beef: true, steak: true,
  leather: true, feather: true, rotten_flesh: true, bone: true,
  // B5 Task 1：本批 5 個新方塊的物品形式（4 個新 id；'gravel' 是既有的 dead id）
  gold_ore: true, diamond_ore: true, spruce_planks: true, birch_planks: true,
  // B5 Task 2：3 個原料 ＋ 11 把新工具
  raw_gold: true, gold_ingot: true, diamond: true,
  wooden_shovel: true, stone_shovel: true, iron_shovel: true,
  golden_pickaxe: true, golden_axe: true, golden_sword: true, golden_shovel: true,
  diamond_pickaxe: true, diamond_axe: true, diamond_sword: true, diamond_shovel: true,
  // B6 Task 5：火把的物品形式（隨 BLOCK.TORCH = 32 一起補上）
  torch: true,
};

/** 全部 ItemId 的正規清單（目前 73 個：36 個既有 ＋ B3 Task 4 補的 5 個物品形式
 *  ＋ B4 Task 1 補的 13 個食物／材料／羊毛 ＋ B5 Task 1 補的 4 個新方塊物品
 *  ＋ B5 Task 2 補的 3 個原料與 11 把工具 ＋ B6 Task 5 補的 1 個火把物品形式）。 */
export const ALL_ITEM_IDS = Object.keys(ITEM_IDS) as ItemId[];

export interface ItemStack {
  item: ItemId;
  count: number;
  /** 剩餘耐久；耐久物品必然帶明確值，非耐久物品必然沒有。 */
  dur?: number;
}

// Item ↔ block pairs for blocks that exist RIGHT NOW. chest is in the ItemId
// union but gains its entry when its block lands. air is never an item; water
// is a world-only block with no obtainable item form (it is never mined or
// placed as an item). `gravel` was a dead id from B1 until its block landed
// (B5 Task 1) — that is why the pair is listed here and not earlier.
const BLOCK_PAIRS: ReadonlyArray<readonly [ItemId, BlockId]> = [
  ['grass', BLOCK.GRASS],
  ['dirt', BLOCK.DIRT],
  ['stone', BLOCK.STONE],
  ['cobblestone', BLOCK.COBBLE],
  ['oak_log', BLOCK.LOG],
  ['oak_planks', BLOCK.PLANKS],
  ['sand', BLOCK.SAND],
  ['glass', BLOCK.GLASS],
  ['coal_ore', BLOCK.COAL_ORE],
  ['iron_ore', BLOCK.IRON_ORE],
  ['oak_leaves', BLOCK.LEAVES],
  ['snow_block', BLOCK.SNOW],
  ['bedrock', BLOCK.BEDROCK],
  ['crafting_table', BLOCK.CRAFTING_TABLE],
  ['furnace', BLOCK.FURNACE],
  // B8 Task 2：箱子的方塊物品形式（方塊 id 33；挖掉掉自身 → 要能放回世界）
  ['chest', BLOCK.CHEST],
  ['spruce_log', BLOCK.SPRUCE_LOG],
  ['spruce_leaves', BLOCK.SPRUCE_LEAVES],
  ['birch_log', BLOCK.BIRCH_LOG],
  ['birch_leaves', BLOCK.BIRCH_LEAVES],
  ['dandelion', BLOCK.DANDELION],
  ['poppy', BLOCK.POPPY],
  ['short_grass', BLOCK.SHORT_GRASS],
  ['cactus', BLOCK.CACTUS],
  ['ice', BLOCK.ICE],
  // B4 Task 1：羊毛的方塊物品形式（羊掉羊毛 → 物品必須存在）
  ['wool', BLOCK.WOOL],
  // B5 Task 1：本批 5 個新方塊的物品形式（與方塊同一個 commit —— 見上方 union 的註解）。
  // B5 起礫石／金鑽礦／雲杉白樺板材有物品形式；雲杉白樺原木、樹葉、花草、冰的
  // 物品形式由 B3 補（已在上方），羊毛由 B4 補（已在上方）。
  ['gravel', BLOCK.GRAVEL],
  ['gold_ore', BLOCK.GOLD_ORE],
  ['diamond_ore', BLOCK.DIAMOND_ORE],
  ['spruce_planks', BLOCK.SPRUCE_PLANKS],
  ['birch_planks', BLOCK.BIRCH_PLANKS],
  // B6 Task 5：火把的方塊物品形式（挖掉的火把掉自身 → 要能放回世界裡）
  ['torch', BLOCK.TORCH],
];

const BLOCK_ID = new Map<ItemId, BlockId>(BLOCK_PAIRS);
const ITEM_OF_BLOCK = new Map<number, ItemId>(BLOCK_PAIRS.map(([item, block]) => [block, item]));

const STACK_ONE: ReadonlySet<ItemId> = new Set([
  'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe',
  'wooden_axe', 'stone_axe', 'iron_axe',
  'wooden_sword', 'stone_sword', 'iron_sword',
  // B5 Task 2：11 把新工具（金／鑽鎬斧劍鏟 ＋ 木石鐵鏟）——工具與武器一律堆疊 1。
  'wooden_shovel', 'stone_shovel', 'iron_shovel',
  'golden_pickaxe', 'golden_axe', 'golden_sword', 'golden_shovel',
  'diamond_pickaxe', 'diamond_axe', 'diamond_sword', 'diamond_shovel',
]);

export function maxStack(item: ItemId): number {
  return STACK_ONE.has(item) ? 1 : 64;
}

export function stackName(item: ItemId): string {
  return item.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Map a placed/broken block id to its item id; null when no item form exists (air, water). */
export function itemFromBlock(blockId: number): ItemId | null {
  return ITEM_OF_BLOCK.get(blockId) ?? null;
}

/** Inverse of itemFromBlock; null for non-block items (stick, tools, …). */
export function blockFromItem(item: ItemId): BlockId | null {
  return BLOCK_ID.get(item) ?? null;
}

/** Block → ItemStack, full stack by default (creative hotbar/palette); pass an
 *  explicit count for drops (e.g. 1). Null when the block has no item form. */
export function stackFromBlock(block: BlockId, count?: number): ItemStack | null {
  const item = itemFromBlock(block);
  if (!item) return null;
  return { item, count: count ?? maxStack(item) };
}

/** 熱鍵列格數（也是遊戲手持列的索引範圍 0..8）。 */
export const HOTBAR_SLOTS = 9;

/** 主背包格數（3 列 × 9）。 */
export const MAIN_SLOTS = 27;

/** 背包總格數：前 9 格是熱鍵列，之後 27 格是主背包。 */
export const INVENTORY_SLOTS = HOTBAR_SLOTS + MAIN_SLOTS; // 36

/** Starting inventory contents per mode (B5 Task 7: 36 slots). Survival
 *  begins EMPTY (vanilla parity — empty slots are also the fits() slack for
 *  pickups and craft takes); creative begins with the standard block kit at
 *  full stacks in the HOTBAR ROW (0..8), and the 27 main slots stay empty —
 *  the full item list lives in the creative palette, not in the starting
 *  inventory. A fresh array (and fresh stacks) per call — callers write it
 *  straight into live slot arrays, so results must never alias each other. */
export function starterSlots(mode: 'survival' | 'creative'): Array<ItemStack | null> {
  // Local union, not `import type { GameMode } from './inventory'`: GameMode is
  // declared in inventory.ts, which imports THIS module — importing it back
  // would close a module cycle for zero benefit (structurally identical union).
  if (mode === 'survival') return new Array<ItemStack | null>(INVENTORY_SLOTS).fill(null);
  const kit = HOTBAR_DEFAULT.map((b) => stackFromBlock(b));
  return [...kit, ...new Array<ItemStack | null>(INVENTORY_SLOTS - kit.length).fill(null)];
}

/** Runtime id gate for UNTRUSTED input (save/cloud records). Built from the
 *  exhaustive ITEM_IDS record, and a Set on purpose: an `item in ITEM_IDS`
 *  check would let prototype keys (`toString`, `__proto__`, …) through. */
const ITEM_ID_SET: ReadonlySet<string> = new Set(ALL_ITEM_IDS);

const isItemId = (x: unknown): x is ItemId => typeof x === 'string' && ITEM_ID_SET.has(x);

/** 清洗一個不可信堆疊：必須是已知的 `ItemId`，且 count 為有限正數；
 *  否則回傳 null（呼叫端視為空格）。count 原樣保留——取整與限制到
 *  `maxStack` 是寫入模型（`InventoryModel.setSlot`）的責任。耐久物品
 *  一律帶明確的剩餘耐久（缺漏或非法值改用上限）；非耐久物品則不帶。
 *  本函式不會拋錯，且結果一定是新物件，不會回傳原輸入。 */
export function sanitizeStack(x: unknown): ItemStack | null {
  if (typeof x !== 'object' || x === null) return null;
  const s = x as Partial<ItemStack>;
  if (!isItemId(s.item)) return null;
  if (typeof s.count !== 'number' || !Number.isFinite(s.count) || s.count <= 0) return null;
  const max = maxDurability(s.item);
  if (max > 0) {
    const dur = normalizeDurability(s.item, s.dur);
    return { item: s.item, count: s.count, dur: dur ?? max };
  }
  return { item: s.item, count: s.count };
}

/** Sanitize an untrusted slot array to EXACTLY `count` slots: a non-array (or
 *  short) source is null-padded, surplus entries are dropped, and every kept
 *  entry runs through `sanitizeStack`. Never throws — the result is always a
 *  fresh array of `count` entries. */
export function sanitizeSlots(x: unknown, count: number): Array<ItemStack | null> {
  // Non-finite counts read as 0 rather than looping forever (Infinity / NaN).
  const size = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const source: ReadonlyArray<unknown> = Array.isArray(x) ? x : [];
  const slots: Array<ItemStack | null> = [];
  for (let i = 0; i < size; i++) slots.push(sanitizeStack(source[i]));
  return slots;
}

/** Sanitize an untrusted stack AND bound its count to `maxStack`.
 *  `sanitizeStack` deliberately passes the count through (the `InventoryModel`
 *  does the clamping); this one is for call sites with no model — B8's
 *  block-entity container slots. Null for junk.
 *
 *  KEEPS `dur` (B7's invariant): `sanitizeStack` already materializes a legal
 *  `dur` for durable items, so rebuilding `{ item, count }` here would
 *  silently repair every damaged tool inside a chest. */
export function sanitizeStackClamped(x: unknown): ItemStack | null {
  const s = sanitizeStack(x);
  if (!s) return null;
  const count = Math.min(Math.floor(s.count), maxStack(s.item));
  if (count < 1) return null;
  return { ...s, count };
}

/** Sanitize a slot array to EXACTLY `count` slots AND bound every kept
 *  stack's count to `maxStack` — the model-less counterpart of `sanitizeSlots`
 *  (which passes counts through). */
export function sanitizeSlotsClamped(x: unknown, count: number): Array<ItemStack | null> {
  const size = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const source: ReadonlyArray<unknown> = Array.isArray(x) ? x : [];
  const slots: Array<ItemStack | null> = [];
  for (let i = 0; i < size; i++) slots.push(sanitizeStackClamped(source[i]));
  return slots;
}
