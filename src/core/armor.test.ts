import { describe, it, expect } from 'vitest';
import type { ItemId, ItemStack } from './items';
import {
  ARMOR_ITEM_IDS,
  ARMOR_SLOTS,
  emptyArmorSet,
  armorSlotForItem,
  armorMaterialOf,
  armorPointsFor,
  totalArmorPoints,
  absorbArmorDamage,
  normalizeArmorSet,
  type ArmorSet,
} from './armor';

const piece = (item: ItemId, dur?: number): ItemStack => ({
  item,
  count: 1,
  ...(dur === undefined ? {} : { dur }),
});

const ironSet = (): ArmorSet => ({
  helmet: piece('iron_helmet', 165),
  chestplate: piece('iron_chestplate', 240),
  leggings: piece('iron_leggings', 225),
  boots: piece('iron_boots', 195),
});

const diamondSet = (): ArmorSet => ({
  helmet: piece('diamond_helmet', 363),
  chestplate: piece('diamond_chestplate', 528),
  leggings: piece('diamond_leggings', 495),
  boots: piece('diamond_boots', 429),
});

describe('armor catalog', () => {
  it('has exactly 16 armor ids and the four slots', () => {
    expect(ARMOR_ITEM_IDS).toHaveLength(16);
    expect(new Set(ARMOR_ITEM_IDS).size).toBe(16);
    expect(ARMOR_SLOTS).toEqual(['helmet', 'chestplate', 'leggings', 'boots']);
    expect(armorSlotForItem('diamond_chestplate')).toBe('chestplate');
    expect(armorSlotForItem('stone')).toBeNull();
    expect(armorMaterialOf('golden_boots')).toBe('golden');
    expect(armorMaterialOf('stone')).toBeNull();
  });

  it('emptyArmorSet returns a fresh four-slot object every call', () => {
    const a = emptyArmorSet();
    const b = emptyArmorSet();
    expect(a).toEqual({ helmet: null, chestplate: null, leggings: null, boots: null });
    expect(a).not.toBe(b);
  });

  it('uses the vanilla armor point table', () => {
    expect(totalArmorPoints(ironSet())).toBe(15);
    expect(totalArmorPoints(diamondSet())).toBe(20);
    expect(totalArmorPoints(emptyArmorSet())).toBe(0);
    expect(armorPointsFor('leather_helmet')).toBe(1);
    expect(armorPointsFor('leather_chestplate')).toBe(3);
    expect(armorPointsFor('golden_leggings')).toBe(3);
    expect(armorPointsFor('diamond_chestplate')).toBe(8);
    expect(armorPointsFor('diamond_boots')).toBe(3);
    expect(armorPointsFor('stone')).toBe(0);
  });
});

describe('absorbArmorDamage', () => {
  it('reduces damage by 4% per point, capped at 80%, minimum 1', () => {
    expect(absorbArmorDamage(diamondSet(), 10).damage).toBe(2); // 20 points → 80%
    expect(absorbArmorDamage(ironSet(), 10).damage).toBe(4); // 15 points → 60%
    expect(absorbArmorDamage(diamondSet(), 1).damage).toBe(1); // never 0
  });

  it('passes damage through unchanged with no armor, and never wears it', () => {
    const none = emptyArmorSet();
    const result = absorbArmorDamage(none, 10);
    expect(result.damage).toBe(10);
    expect(result.armor).toBe(none);
    expect(result.broken).toEqual([]);
  });

  it('passes non-positive and non-finite amounts through without wearing', () => {
    const set = ironSet();
    for (const amount of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = absorbArmorDamage(set, amount);
      expect(result.damage).toBe(amount);
      expect(result.armor).toBe(set);
      expect(result.broken).toEqual([]);
    }
  });

  it('wears every equipped piece by 1 and removes broken pieces', () => {
    const set: ArmorSet = {
      helmet: piece('leather_helmet', 2),
      chestplate: piece('leather_chestplate', 80),
      leggings: piece('leather_leggings', 75),
      boots: piece('leather_boots', 1),
    };
    const hit = absorbArmorDamage(set, 10);
    expect(hit.armor.helmet).toEqual({ item: 'leather_helmet', count: 1, dur: 1 });
    expect(hit.armor.chestplate?.dur).toBe(79);
    expect(hit.armor.leggings?.dur).toBe(74);
    expect(hit.armor.boots).toBeNull();
    expect(hit.broken).toEqual([{ slot: 'boots', item: 'leather_boots' }]);
    // Input is never mutated.
    expect(set.boots?.dur).toBe(1);
    expect(set.chestplate?.dur).toBe(80);
  });

  it('only wears equipped slots', () => {
    const set: ArmorSet = { ...emptyArmorSet(), helmet: piece('iron_helmet', 165) };
    const hit = absorbArmorDamage(set, 13);
    expect(hit.armor.helmet?.dur).toBe(164);
    expect(hit.armor.chestplate).toBeNull();
    expect(hit.damage).toBe(12); // 1 point → 13 * 0.96 = 12.48 → 12
  });

  // ---- B17 Task 10：protection 每級視為 +1 護甲點（合計上限 20） ----
  //
  // 選定行為：**保護只可能存在於已穿著的盔甲上**（`protectionLevels` 只計
  // 合法部位），因此「有 protection 卻沒有護甲點」不可達；既有的
  // `points <= 0` 早退（同參考、不磨損）原樣保留，equipped 但無 protection
  // 的盔甲逐值不變。
  const protectedPiece = (item: ItemId, dur: number, level: number): ItemStack => ({
    ...piece(item, dur),
    ench: { id: 'protection', level },
  });

  it('each protection level adds one armor point (4%)', () => {
    // 鐵頭 2 點 ＋ 鐵胸 6 點 ＝ 8 點，protection 2 級 → 合計 10 點 → 40% 減傷。
    const set: ArmorSet = {
      ...emptyArmorSet(),
      helmet: piece('iron_helmet', 165),
      chestplate: protectedPiece('iron_chestplate', 240, 2),
    };
    expect(totalArmorPoints(set)).toBe(8); // totalArmorPoints 本身不吃附魔
    expect(absorbArmorDamage(set, 10).damage).toBe(6); // 10 × (1 − 10/25)
  });

  it('caps the combined points + protection total at 20 (80%, minimum 1)', () => {
    // 鑽石全套 = 20 點（已夾滿）；protection 4 級讓合計 24 → 仍以 20 計。
    const set: ArmorSet = {
      helmet: protectedPiece('diamond_helmet', 363, 4),
      chestplate: piece('diamond_chestplate', 528),
      leggings: piece('diamond_leggings', 495),
      boots: piece('diamond_boots', 429),
    };
    expect(absorbArmorDamage(set, 10).damage).toBe(2); // 80% 上限
    expect(absorbArmorDamage(set, 1).damage).toBe(1); // 不會減到 0
  });

  it('armor without protection keeps the old numbers (behaviour unchanged)', () => {
    expect(absorbArmorDamage(ironSet(), 10).damage).toBe(4); // 15 點 → 60%
    expect(absorbArmorDamage(diamondSet(), 10).damage).toBe(2);
  });

  it('protection only counts on the matching worn slot (a mismatched stack adds nothing)', () => {
    const set: ArmorSet = {
      ...emptyArmorSet(),
      helmet: piece('iron_helmet', 165),
      chestplate: piece('iron_chestplate', 240),
      // 放錯部位（胸甲擺靴子格）：既不計點數、也不計 protection。
      boots: protectedPiece('iron_chestplate', 240, 4),
    };
    // 2 + 6 = 8 點，protection 0 → 10 × (1 − 8/25) = 6.8 → 7
    const hit = absorbArmorDamage(set, 10);
    expect(hit.damage).toBe(7);
    // 磨損沿用既有規則：每個 non-null 欄位各扣 1（不管那一格合法與否）。
    expect(hit.armor.helmet?.dur).toBe(164);
    expect(hit.armor.chestplate?.dur).toBe(239);
    expect(hit.armor.boots?.dur).toBe(239);
  });

  it('a no-armor hit still returns the same reference (protection cannot exist alone)', () => {
    const none = emptyArmorSet();
    const result = absorbArmorDamage(none, 10);
    expect(result.armor).toBe(none);
    expect(result.damage).toBe(10);
  });
});

describe('normalizeArmorSet', () => {
  it('accepts only the matching slot, forces count 1, and clamps durability', () => {
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
  });

  it('returns four empty slots for junk input', () => {
    expect(normalizeArmorSet(null)).toEqual(emptyArmorSet());
    expect(normalizeArmorSet(42)).toEqual(emptyArmorSet());
    expect(normalizeArmorSet([1, 2, 3])).toEqual(emptyArmorSet());
  });

  it('never aliases the input stack', () => {
    const helmet = { item: 'iron_helmet' as const, count: 1, dur: 100 };
    const normalized = normalizeArmorSet({ helmet });
    expect(normalized.helmet).toEqual({ item: 'iron_helmet', count: 1, dur: 100 });
    expect(normalized.helmet).not.toBe(helmet);
  });

  // ---- B17 Task 9：附魔跟著盔甲走 ----
  it('keeps a legal protection enchant on the matching slot (fresh object)', () => {
    const helmet = {
      item: 'iron_helmet' as const,
      count: 1,
      dur: 100,
      ench: { id: 'protection', level: 2 },
    };
    const normalized = normalizeArmorSet({ helmet });
    expect(normalized.helmet).toEqual({
      item: 'iron_helmet',
      count: 1,
      dur: 100,
      ench: { id: 'protection', level: 2 },
    });
    expect(normalized.helmet).not.toBe(helmet);
  });

  it('drops a junk or incompatible enchant but keeps the piece', () => {
    const raw = {
      // efficiency 對盔甲不合法
      helmet: { item: 'iron_helmet', count: 1, dur: 165, ench: { id: 'efficiency', level: 1 } },
      // 保護合法，但這件擺錯部位 → 整格丟棄
      boots: { item: 'iron_chestplate', count: 1, dur: 240, ench: { id: 'protection', level: 3 } },
    };
    expect(normalizeArmorSet(raw)).toEqual({
      helmet: { item: 'iron_helmet', count: 1, dur: 165 },
      chestplate: null,
      leggings: null,
      boots: null,
    });
  });
});
