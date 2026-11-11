/** 附魔純邏輯（B17 spec §7／§8）：相容表、選項擲骰、效果查詢、顯示名。
 *
 *  本模組不碰 DOM／Three／存檔 IO，也不 **runtime import** `items.ts`／`armor.ts`：
 *  `items.ts`（Task 9）會為了 `sanitizeEnchantFor` runtime import 本模組，回頭 import
 *  會形成模組循環。因此 `ItemId`／`ItemStack`／`ArmorSet` 一律 **type-only** 匯入，
 *  物品 id 清單由本模組自行持有（下方 TOOL／WEAPON／PICKAXE／ARMOR 表）。
 *  `stackDisplayName` 也自帶一份與 `items.stackName` 相同的名稱推導（同樣是為了避開
 *  循環；`enchantments.test.ts` 會釘住盔甲 id 集合與 `armor.ARMOR_ITEM_IDS` 一致）。
 *
 *  **明示簡化**（與 spec §2 一致）：每件物品最多一個附魔；同一個附魔可升級到上限；
 *  沒有附魔書／鐵砧／修補／青金石／書架加成。 */

import type { ItemId, ItemStack } from './items';
import type { ArmorSet } from './armor';

export type EnchantmentId = 'efficiency' | 'sharpness' | 'protection' | 'unbreaking' | 'fortune';

export interface Enchantment {
  id: EnchantmentId;
  level: number;
}

export const ENCHANTMENT_MAX_LEVELS: Readonly<Record<EnchantmentId, number>> = {
  efficiency: 5,
  sharpness: 5,
  protection: 4,
  unbreaking: 3,
  fortune: 3,
};

export const ENCHANTMENT_NAMES: Readonly<Record<EnchantmentId, string>> = {
  efficiency: 'Efficiency',
  sharpness: 'Sharpness',
  protection: 'Protection',
  unbreaking: 'Unbreaking',
  fortune: 'Fortune',
};

/** id 白名單用 Set 而非 `id in ENCHANTMENT_MAX_LEVELS`：原型鍵（`toString`、
 *  `__proto__`、`constructor`…）不得通過。 */
const ENCHANTMENT_ID_SET: ReadonlySet<string> = new Set(Object.keys(ENCHANTMENT_MAX_LEVELS));

const isEnchantmentId = (x: unknown): x is EnchantmentId =>
  typeof x === 'string' && ENCHANTMENT_ID_SET.has(x);

// ---- 物品 id 清單（自行持有，見檔頭的循環說明） ----

const MATERIALS = ['wooden', 'stone', 'iron', 'golden', 'diamond'] as const;

const madeOf = (suffix: string): ItemId[] =>
  MATERIALS.map((material) => `${material}_${suffix}` as ItemId);

const PICKAXE_IDS: ReadonlySet<ItemId> = new Set(madeOf('pickaxe'));
const AXE_IDS: ReadonlySet<ItemId> = new Set(madeOf('axe'));
const SHOVEL_IDS: ReadonlySet<ItemId> = new Set(madeOf('shovel'));
const HOE_IDS: ReadonlySet<ItemId> = new Set(madeOf('hoe'));
const SWORD_IDS: ReadonlySet<ItemId> = new Set(madeOf('sword'));

const ARMOR_SLOT_SUFFIXES = [
  ['helmet', '_helmet'],
  ['chestplate', '_chestplate'],
  ['leggings', '_leggings'],
  ['boots', '_boots'],
] as const satisfies ReadonlyArray<readonly [keyof ArmorSet, string]>;

/** 盔甲材質與工具材質不同（皮革取代木／石）。 */
const ARMOR_MATERIALS = ['leather', 'iron', 'golden', 'diamond'] as const;

const ARMOR_IDS: ReadonlySet<ItemId> = new Set(
  ARMOR_MATERIALS.flatMap((material) =>
    ARMOR_SLOT_SUFFIXES.map(([, suffix]) => `${material}${suffix}` as ItemId),
  ),
);

/** 只有耐久且「原版可附魔 unbreaking」的其餘物品（工具／武器／盔甲另列）。 */
const UNBREAKING_ONLY_IDS: ReadonlySet<ItemId> = new Set<ItemId>([
  'bow',
  'fishing_rod',
  'flint_and_steel',
]);

const PICKAXE_ENCHANTS: readonly EnchantmentId[] = ['efficiency', 'fortune', 'unbreaking'];
const AXE_ENCHANTS: readonly EnchantmentId[] = ['efficiency', 'sharpness', 'unbreaking'];
const TOOL_ENCHANTS: readonly EnchantmentId[] = ['efficiency', 'unbreaking'];
const SWORD_ENCHANTS: readonly EnchantmentId[] = ['sharpness', 'unbreaking'];
const ARMOR_ENCHANTS: readonly EnchantmentId[] = ['protection', 'unbreaking'];
const UNBREAKING_ENCHANTS: readonly EnchantmentId[] = ['unbreaking'];

/** 該物品可接受的附魔 id（固定順序；見 spec §7 相容表）。回傳**新陣列**，
 *  呼叫端改動不會污染內部常數。 */
export function compatibleEnchantments(item: ItemId): EnchantmentId[] {
  if (PICKAXE_IDS.has(item)) return [...PICKAXE_ENCHANTS];
  if (AXE_IDS.has(item)) return [...AXE_ENCHANTS];
  if (SHOVEL_IDS.has(item) || HOE_IDS.has(item)) return [...TOOL_ENCHANTS];
  if (SWORD_IDS.has(item)) return [...SWORD_ENCHANTS];
  if (ARMOR_IDS.has(item)) return [...ARMOR_ENCHANTS];
  if (UNBREAKING_ONLY_IDS.has(item)) return [...UNBREAKING_ENCHANTS];
  return [];
}

/** 讀取（可能尚未在型別上宣告的）`ItemStack.ench`。Task 9 會把 `ench?: Enchantment`
 *  加進 `ItemStack`；在那之前這裡用結構化 cast，避免為了型別而 runtime import。 */
function enchantOf(stack: ItemStack | null | undefined): unknown {
  if (!stack) return undefined;
  return (stack as ItemStack & { ench?: unknown }).ench;
}

/** **嚴格**驗證不可信附魔：合法 id 且整數 level 在 1..上限 → 新物件；其餘
 *  （含超上限、非整數、非有限、未知 id、原型鍵）→ `undefined`。升級路徑由
 *  `rollEnchantOffers` 控制，不靠這裡寬鬆修復。 */
export function normalizeEnchantment(raw: unknown): Enchantment | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { id, level } = raw as { id?: unknown; level?: unknown };
  if (!isEnchantmentId(id)) return undefined;
  if (typeof level !== 'number' || !Number.isInteger(level)) return undefined;
  if (level < 1 || level > ENCHANTMENT_MAX_LEVELS[id]) return undefined;
  return { id, level };
}

/** **修復性**清洗既有資料：驗證 id＋相容性；level 只要是有限數就取整並夾到
 *  `1..上限`（形狀對但超範圍 → 修好，不是丟棄）；其餘 → `undefined`。
 *  與嚴格版 `normalizeEnchantment` 的差別是刻意的（spec §10 的存檔清洗需求）。 */
export function sanitizeEnchantFor(item: ItemId, raw: unknown): Enchantment | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { id, level } = raw as { id?: unknown; level?: unknown };
  if (!isEnchantmentId(id)) return undefined;
  if (!compatibleEnchantments(item).includes(id)) return undefined;
  if (typeof level !== 'number' || !Number.isFinite(level)) return undefined;
  const clamped = Math.min(ENCHANTMENT_MAX_LEVELS[id], Math.max(1, Math.floor(level)));
  return { id, level: clamped };
}

export interface EnchantOffer {
  enchant: Enchantment;
  cost: number;
}

/** 把 `rng()`（預期 0..1）映射到清單索引；非有限或 ≤0 → 0，≥1 → 末項，
 *  因此 1.0 這種上界值不會越界。 */
function pickIndex(rng: () => number, length: number): number {
  const roll = rng();
  if (!Number.isFinite(roll) || roll <= 0) return 0;
  if (roll >= 1) return length - 1;
  return Math.floor(roll * length);
}

/** 附魔台選項（spec §7）：
 *  - 已有合法且相容的附魔、未達上限 → 單一升級選項 `{level+1, cost: level+1}`；
 *  - 已達上限，或物品不相容 → `[]`；
 *  - 無（有效）附魔 → 三個選項：tier 1..3，`level = cost = tier`，id 由注入的
 *    `rng` 從相容清單擲出（每 tier 擲一次）。 */
export function rollEnchantOffers(stack: ItemStack, rng: () => number = Math.random): EnchantOffer[] {
  const list = compatibleEnchantments(stack.item);
  if (list.length === 0) return [];

  const current = normalizeEnchantment(enchantOf(stack));
  if (current && list.includes(current.id)) {
    if (current.level >= ENCHANTMENT_MAX_LEVELS[current.id]) return [];
    return [{ enchant: { id: current.id, level: current.level + 1 }, cost: current.level + 1 }];
  }

  const offers: EnchantOffer[] = [];
  for (let tier = 1; tier <= 3; tier++) {
    const id = list[pickIndex(rng, list.length)];
    offers.push({ enchant: { id, level: tier }, cost: tier });
  }
  return offers;
}

/** 回傳帶 `ench` 的新堆疊（覆寫舊附魔）；不 `ench` 輸入。 */
export function applyEnchant(stack: ItemStack, enchant: Enchantment): ItemStack {
  const next = { ...stack, ench: { id: enchant.id, level: enchant.level } };
  return next;
}

/** 堆疊上某附魔的有效等級（0 ＝ 沒有／這個物品不能帶）。 */
function levelOf(stack: ItemStack | null, id: EnchantmentId): number {
  if (!stack) return 0;
  if (!compatibleEnchantments(stack.item).includes(id)) return 0;
  const enchant = normalizeEnchantment(enchantOf(stack));
  return enchant && enchant.id === id ? enchant.level : 0;
}

/** 挖掘速度加成 `L²+1`（spec §7；只在工具種類正確時，由 `interact.toolSpeed` 把關）。 */
export function efficiencyBonus(stack: ItemStack | null): number {
  const level = levelOf(stack, 'efficiency');
  return level === 0 ? 0 : level * level + 1;
}

/** 近戰傷害加成 `1 + 0.5×(L−1)`。 */
export function sharpnessBonus(stack: ItemStack | null): number {
  const level = levelOf(stack, 'sharpness');
  return level === 0 ? 0 : 1 + 0.5 * (level - 1);
}

/** 每次扣耐久的免除機率 `L/(L+1)`（L1 50%／L2 66.7%／L3 75%）。 */
export function unbreakingAvoidChance(stack: ItemStack | null): number {
  const level = levelOf(stack, 'unbreaking');
  return level === 0 ? 0 : level / (level + 1);
}

/** 所有已裝備且合法的盔甲部位其 protection 等級總和（裝錯部位／非盔甲不計）。
 *  spec §8：`absorbArmorDamage` 以 `min(20, points + protectionLevels(set))` 減傷。 */
export function protectionLevels(set: ArmorSet): number {
  if (!set) return 0;
  let total = 0;
  for (const [slot, suffix] of ARMOR_SLOT_SUFFIXES) {
    const stack = set[slot];
    if (!stack || !ARMOR_IDS.has(stack.item) || !stack.item.endsWith(suffix)) continue;
    const enchant = normalizeEnchantment(enchantOf(stack));
    if (enchant && enchant.id === 'protection') total += enchant.level;
  }
  return total;
}

/** 幸運額外件數：`floor(L/2)` 保證 ＋（奇數級 50% 再 +1）。非有限／無效等級 → 0，
 *  等級夾到 `0..fortune 上限`（效果查詢對不可信輸入也安全）。 */
export function fortuneBonus(level: number, rng: () => number = Math.random): number {
  if (!Number.isFinite(level) || level < 1) return 0;
  const clamped = Math.min(ENCHANTMENT_MAX_LEVELS.fortune, Math.floor(level));
  if (clamped < 1) return 0;
  const guaranteed = Math.floor(clamped / 2);
  const extra = clamped % 2 === 1 && rng() < 0.5 ? 1 : 0;
  return guaranteed + extra;
}

const ROMAN_NUMERALS: ReadonlyArray<readonly [number, string]> = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
  [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

function toRoman(level: number): string {
  if (!Number.isInteger(level) || level < 1 || level > 3999) return String(level);
  let rest = level;
  let out = '';
  for (const [value, symbol] of ROMAN_NUMERALS) {
    while (rest >= value) {
      out += symbol;
      rest -= value;
    }
  }
  return out;
}

/** 英文名 ＋ 羅馬數字，如 `Efficiency III`。未知 id 回退成 id 字串（防禦性）。 */
export function enchantmentName(e: Enchantment): string {
  const base = isEnchantmentId(e.id) ? ENCHANTMENT_NAMES[e.id] : String(e.id);
  return `${base} ${toRoman(e.level)}`;
}

/** 與 `items.stackName` 相同的顯示名推導（同樣是為了避開 runtime 循環，見檔頭）。
 *  只影響 UI 文字，不影響存檔。 */
const DISPLAY_NAME_OVERRIDES: Readonly<Partial<Record<ItemId, string>>> = {
  tnt: 'TNT',
  flint_and_steel: 'Flint and Steel',
};

function baseDisplayName(item: ItemId): string {
  if (Object.hasOwn(DISPLAY_NAME_OVERRIDES, item)) {
    const override = DISPLAY_NAME_OVERRIDES[item];
    if (override) return override;
  }
  return item.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/** `stackName` ＋ 合法附魔時的 ` ✦ Efficiency III`。 */
export function stackDisplayName(stack: ItemStack): string {
  const base = baseDisplayName(stack.item);
  const enchant = normalizeEnchantment(enchantOf(stack));
  return enchant ? `${base} ✦ ${enchantmentName(enchant)}` : base;
}
