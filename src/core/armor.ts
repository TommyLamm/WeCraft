/** 盔甲純邏輯：部位／材質分類、護甲點數、減傷、磨損與不可信資料清洗。
 *
 *  本模組不碰 DOM／Three／存檔 IO；main、UI、存檔層都只透過這裡的函式。
 *
 *  **明示簡化**：減傷公式是 `damage × (1 − min(20, points) / 25)`（每點 4%，
 *  上限 80%，四捨五入、正傷害至少 1）。原版 1.20 的公式另外吃盔甲韌性與傷害值，
 *  本作沒有韌性、也沒有鎖鏈／獄髓；這個差距寫在 README〈與原版的差異〉。
 *
 *  **磨損規則**：每次「盔甲可減免」的傷害事件，每個已裝備部位各扣 1 耐久；
 *  同一次傷害的減傷先算完，才移除壞掉的部位（最後一點耐久的那件仍保護該次）。 */

import type { ItemId, ItemStack } from './items';
import { sanitizeStack } from './items';
import { damageStack } from './durability';

export const ARMOR_SLOTS = ['helmet', 'chestplate', 'leggings', 'boots'] as const;
export type ArmorSlot = (typeof ARMOR_SLOTS)[number];
export type ArmorMaterial = 'leather' | 'iron' | 'golden' | 'diamond';
export type ArmorSet = Record<ArmorSlot, ItemStack | null>;

/** 16 個盔甲物品 id（4 材質 × 4 部位）。 */
export const ARMOR_ITEM_IDS: readonly ItemId[] = [
  'leather_helmet', 'leather_chestplate', 'leather_leggings', 'leather_boots',
  'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots',
  'golden_helmet', 'golden_chestplate', 'golden_leggings', 'golden_boots',
  'diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots',
];

const SLOT_SUFFIX: Record<ArmorSlot, string> = {
  helmet: '_helmet',
  chestplate: '_chestplate',
  leggings: '_leggings',
  boots: '_boots',
};

const MATERIAL_PREFIX: Record<ArmorMaterial, string> = {
  leather: 'leather_',
  iron: 'iron_',
  golden: 'golden_',
  diamond: 'diamond_',
};

/** 原版護甲點數（頭／胸／腿／靴）。 */
const POINTS: Record<ArmorMaterial, Record<ArmorSlot, number>> = {
  leather: { helmet: 1, chestplate: 3, leggings: 2, boots: 1 },
  iron: { helmet: 2, chestplate: 6, leggings: 5, boots: 2 },
  golden: { helmet: 2, chestplate: 5, leggings: 3, boots: 1 },
  diamond: { helmet: 3, chestplate: 8, leggings: 6, boots: 3 },
};

const MATERIAL_BY_ITEM: ReadonlyMap<ItemId, ArmorMaterial> = new Map(
  ARMOR_ITEM_IDS.map((item) => {
    const material = (Object.keys(MATERIAL_PREFIX) as ArmorMaterial[]).find((m) =>
      item.startsWith(MATERIAL_PREFIX[m]),
    );
    if (!material) throw new Error(`armor item without material: ${item}`);
    return [item, material] as const;
  }),
);

const SLOT_BY_ITEM: ReadonlyMap<ItemId, ArmorSlot> = new Map(
  ARMOR_ITEM_IDS.map((item) => {
    const slot = ARMOR_SLOTS.find((s) => item.endsWith(SLOT_SUFFIX[s]));
    if (!slot) throw new Error(`armor item without slot: ${item}`);
    return [item, slot] as const;
  }),
);

export function emptyArmorSet(): ArmorSet {
  return { helmet: null, chestplate: null, leggings: null, boots: null };
}

export function armorMaterialOf(item: ItemId): ArmorMaterial | null {
  return MATERIAL_BY_ITEM.get(item) ?? null;
}

export function armorSlotForItem(item: ItemId): ArmorSlot | null {
  return SLOT_BY_ITEM.get(item) ?? null;
}

export function armorPointsFor(item: ItemId): number {
  const material = armorMaterialOf(item);
  const slot = armorSlotForItem(item);
  if (!material || !slot) return 0;
  return POINTS[material][slot];
}

/** 目前裝備的護甲點數總和，夾在 0–20。灰塵／錯位的堆疊不計分。 */
export function totalArmorPoints(set: ArmorSet): number {
  let points = 0;
  for (const slot of ARMOR_SLOTS) {
    const stack = set[slot];
    if (!stack) continue;
    if (armorSlotForItem(stack.item) !== slot) continue;
    points += armorPointsFor(stack.item);
  }
  return Math.max(0, Math.min(20, points));
}

function reducedDamage(amount: number, points: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return amount;
  if (points <= 0) return amount;
  const multiplier = 1 - Math.min(20, points) / 25;
  return Math.max(1, Math.round(amount * multiplier));
}

export interface ArmorHit {
  damage: number;
  armor: ArmorSet;
  broken: Array<{ slot: ArmorSlot; item: ItemId }>;
}

/** 套用一次盔甲可減免的傷害：先算減傷，再讓每個部位各掉 1 耐久。
 *  沒有護甲（或 amount 非正／非有限）→ 回傳同一個 `armor` 物件，呼叫端可
 *  用 `result.armor === armor` 判斷「不必重繪」。 */
export function absorbArmorDamage(set: ArmorSet, amount: number): ArmorHit {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { damage: amount, armor: set, broken: [] };
  }
  const points = totalArmorPoints(set);
  if (points <= 0) return { damage: amount, armor: set, broken: [] };

  const next: ArmorSet = { ...set };
  const broken: Array<{ slot: ArmorSlot; item: ItemId }> = [];
  for (const slot of ARMOR_SLOTS) {
    const stack = next[slot];
    if (!stack) continue;
    const result = damageStack(stack, 1);
    next[slot] = result.stack;
    if (result.broke) broken.push({ slot, item: stack.item });
  }
  return { damage: reducedDamage(amount, points), armor: next, broken };
}

/** 清洗不可信的盔甲資料：每一格只接受「該部位」的盔甲、數量強制 1、
 *  耐久正規化（缺漏／非法 → 上限）。永不拋錯，結果一定是新的四格物件。 */
export function normalizeArmorSet(raw: unknown): ArmorSet {
  const source =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const out = emptyArmorSet();
  for (const slot of ARMOR_SLOTS) {
    const stack = sanitizeStack(source[slot]);
    if (!stack || armorSlotForItem(stack.item) !== slot) continue;
    out[slot] = {
      item: stack.item,
      count: 1,
      ...(stack.dur !== undefined ? { dur: stack.dur } : {}),
    };
  }
  return out;
}
