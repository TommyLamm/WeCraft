import { describe, expect, it, vi } from 'vitest';
import { ALL_ITEM_IDS, type ItemId, type ItemStack } from './items';
import { ARMOR_ITEM_IDS, type ArmorSet } from './armor';
import {
  ENCHANTMENT_MAX_LEVELS,
  ENCHANTMENT_NAMES,
  type EnchantmentId,
  applyEnchant,
  compatibleEnchantments,
  efficiencyBonus,
  enchantmentName,
  fortuneBonus,
  normalizeEnchantment,
  protectionLevels,
  rollEnchantOffers,
  sanitizeEnchantFor,
  sharpnessBonus,
  stackDisplayName,
  unbreakingAvoidChance,
} from './enchantments';

/** B17 Task 9 落地後 `ItemStack` 本身就有 `ench` → 不再需要交集中的
 *  `ench?: unknown` 補欄；但 `ench` 參數仍收**不可信的** `unknown`（這個
 *  測試檔專門測 normalizeEnchantment 對髒值的防禦），所以 `stackOf` 的
 *  ench 欄位用 cast 寫進去，`enchOf` 讀出來仍是 `unknown`。 */
type TestStack = ItemStack;

const stackOf = (item: ItemId, ench?: unknown, dur?: number): TestStack => ({
  item,
  count: 1,
  ...(dur === undefined ? {} : { dur }),
  ...(ench === undefined ? {} : { ench: ench as ItemStack['ench'] }),
});

const enchOf = (stack: ItemStack): unknown => (stack as { ench?: unknown }).ench;

const MATERIALS = ['wooden', 'stone', 'iron', 'golden', 'diamond'] as const;
const ARMOR_MATERIALS = ['leather', 'iron', 'golden', 'diamond'] as const;
const ARMOR_SLOTS = ['helmet', 'chestplate', 'leggings', 'boots'] as const;

/** Tool id suffix group → the exact enchantment list `compatibleEnchantments`
 *  must return for every catalog id carrying one of those suffixes.
 *
 *  `_shovel` and `_hoe` deliberately share one signature (both are
 *  efficiency+unbreaking), so they form a single group here; the other three
 *  signatures are unique to their family. */
const TOOL_FAMILY_GROUPS: ReadonlyArray<{
  suffixes: readonly string[];
  enchants: readonly EnchantmentId[];
}> = [
  { suffixes: ['_pickaxe'], enchants: ['efficiency', 'fortune', 'unbreaking'] },
  { suffixes: ['_axe'], enchants: ['efficiency', 'sharpness', 'unbreaking'] },
  { suffixes: ['_shovel', '_hoe'], enchants: ['efficiency', 'unbreaking'] },
  { suffixes: ['_sword'], enchants: ['sharpness', 'unbreaking'] },
];

const sameEnchants = (a: readonly EnchantmentId[], b: readonly EnchantmentId[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);

describe('compatibleEnchantments', () => {
  it('follows the pinned order for each family', () => {
    expect(compatibleEnchantments('diamond_pickaxe')).toEqual(['efficiency', 'fortune', 'unbreaking']);
    expect(compatibleEnchantments('iron_sword')).toEqual(['sharpness', 'unbreaking']);
    expect(compatibleEnchantments('golden_axe')).toEqual(['efficiency', 'sharpness', 'unbreaking']);
    expect(compatibleEnchantments('diamond_helmet')).toEqual(['protection', 'unbreaking']);
  });

  it('gives unbreaking only to bow / fishing rod / flint and steel', () => {
    expect(compatibleEnchantments('bow')).toEqual(['unbreaking']);
    expect(compatibleEnchantments('fishing_rod')).toEqual(['unbreaking']);
    expect(compatibleEnchantments('flint_and_steel')).toEqual(['unbreaking']);
  });

  it('is empty for non-enchantable items', () => {
    expect(compatibleEnchantments('stick')).toEqual([]);
    expect(compatibleEnchantments('diamond')).toEqual([]);
    expect(compatibleEnchantments('stone')).toEqual([]);
  });

  it('covers every tool and weapon family', () => {
    for (const material of MATERIALS) {
      expect(compatibleEnchantments(`${material}_pickaxe`)).toEqual(['efficiency', 'fortune', 'unbreaking']);
      expect(compatibleEnchantments(`${material}_axe`)).toEqual(['efficiency', 'sharpness', 'unbreaking']);
      expect(compatibleEnchantments(`${material}_shovel`)).toEqual(['efficiency', 'unbreaking']);
      expect(compatibleEnchantments(`${material}_hoe`)).toEqual(['efficiency', 'unbreaking']);
      expect(compatibleEnchantments(`${material}_sword`)).toEqual(['sharpness', 'unbreaking']);
    }
  });

  it('covers every armor family (leather / iron / golden / diamond)', () => {
    for (const material of ARMOR_MATERIALS) {
      for (const slot of ARMOR_SLOTS) {
        expect(compatibleEnchantments(`${material}_${slot}`)).toEqual(['protection', 'unbreaking']);
      }
    }
  });

  it('matches the armor id set exported by armor.ts', () => {
    // Bidirectional pin: "protection + unbreaking" is unique to armor in the
    // whole item catalog, so this both proves the local ARMOR_IDS list equals
    // ARMOR_ITEM_IDS and that nothing extra is treated as armor.
    const armorLike = ALL_ITEM_IDS.filter((id) => {
      const c = compatibleEnchantments(id);
      return c.length === 2 && c[0] === 'protection' && c[1] === 'unbreaking';
    });
    expect(armorLike).toHaveLength(16);
    expect(new Set(armorLike)).toEqual(new Set(ARMOR_ITEM_IDS));
  });

  it('pins every catalog tool id to its family signature', () => {
    // Catalog-level pin (the armor set got the same treatment). The catalog
    // side comes from the REAL `ALL_ITEM_IDS`, never from a hand-copied list,
    // so a tool id added to `items.ts` without the module's local family table
    // knowing about it fails here instead of silently returning `[]`.
    for (const { suffixes, enchants } of TOOL_FAMILY_GROUPS) {
      const catalogFamilyIds = ALL_ITEM_IDS.filter((id) =>
        suffixes.some((suffix) => id.endsWith(suffix)),
      );
      const expectedIds = suffixes.flatMap((suffix) =>
        MATERIALS.map((material) => `${material}${suffix}`),
      );
      expect(new Set(catalogFamilyIds)).toEqual(new Set(expectedIds));
      for (const id of catalogFamilyIds) {
        expect(compatibleEnchantments(id)).toEqual(enchants);
      }
      // Reverse direction: the module must not hand a tool-family signature to
      // any other catalog id (armor, plain blocks, bow, ...).
      const withSignature = ALL_ITEM_IDS.filter((id) =>
        sameEnchants(compatibleEnchantments(id), enchants),
      );
      expect(new Set(withSignature)).toEqual(new Set(catalogFamilyIds));
    }
  });

  it('returns a fresh array each call', () => {
    const first = compatibleEnchantments('diamond_pickaxe');
    first.push('sharpness');
    expect(compatibleEnchantments('diamond_pickaxe')).toEqual(['efficiency', 'fortune', 'unbreaking']);
  });
});

describe('normalizeEnchantment (strict)', () => {
  it('accepts valid ids with integer levels in range', () => {
    expect(normalizeEnchantment({ id: 'efficiency', level: 1 })).toEqual({ id: 'efficiency', level: 1 });
    expect(normalizeEnchantment({ id: 'efficiency', level: 5 })).toEqual({ id: 'efficiency', level: 5 });
    expect(normalizeEnchantment({ id: 'protection', level: 4 })).toEqual({ id: 'protection', level: 4 });
    expect(normalizeEnchantment({ id: 'fortune', level: 3 })).toEqual({ id: 'fortune', level: 3 });
  });

  it('returns a fresh object, never the input reference', () => {
    const raw = { id: 'unbreaking', level: 2 };
    const out = normalizeEnchantment(raw);
    expect(out).toEqual({ id: 'unbreaking', level: 2 });
    expect(out).not.toBe(raw);
  });

  it('rejects out-of-range, non-integer and non-finite levels', () => {
    expect(normalizeEnchantment({ id: 'efficiency', level: 0 })).toBeUndefined();
    expect(normalizeEnchantment({ id: 'efficiency', level: 6 })).toBeUndefined();
    expect(normalizeEnchantment({ id: 'efficiency', level: 99 })).toBeUndefined();
    expect(normalizeEnchantment({ id: 'efficiency', level: 2.5 })).toBeUndefined();
    expect(normalizeEnchantment({ id: 'efficiency', level: NaN })).toBeUndefined();
    expect(normalizeEnchantment({ id: 'efficiency', level: Infinity })).toBeUndefined();
    expect(normalizeEnchantment({ id: 'efficiency', level: '3' })).toBeUndefined();
    expect(normalizeEnchantment({ id: 'efficiency' })).toBeUndefined();
  });

  it('rejects unknown ids and prototype keys', () => {
    expect(normalizeEnchantment({ id: 'looting', level: 1 })).toBeUndefined();
    expect(normalizeEnchantment({ id: '__proto__', level: 1 })).toBeUndefined();
    expect(normalizeEnchantment({ id: 'constructor', level: 1 })).toBeUndefined();
    expect(normalizeEnchantment({ id: 'toString', level: 1 })).toBeUndefined();
    expect(normalizeEnchantment({ id: 'hasOwnProperty', level: 1 })).toBeUndefined();
  });

  it('rejects non-object input', () => {
    expect(normalizeEnchantment(null)).toBeUndefined();
    expect(normalizeEnchantment(undefined)).toBeUndefined();
    expect(normalizeEnchantment('efficiency')).toBeUndefined();
    expect(normalizeEnchantment(3)).toBeUndefined();
    expect(normalizeEnchantment(['efficiency', 3])).toBeUndefined();
  });
});

describe('sanitizeEnchantFor (reparative)', () => {
  it('drops an enchant the item cannot carry', () => {
    expect(sanitizeEnchantFor('diamond_helmet', { id: 'efficiency', level: 1 })).toBeUndefined();
    expect(sanitizeEnchantFor('stick', { id: 'unbreaking', level: 1 })).toBeUndefined();
  });

  it('clamps an in-range-shaped level into 1..max', () => {
    expect(sanitizeEnchantFor('diamond_pickaxe', { id: 'fortune', level: 99 })).toEqual({ id: 'fortune', level: 3 });
    expect(sanitizeEnchantFor('iron_sword', { id: 'sharpness', level: 8 })).toEqual({ id: 'sharpness', level: 5 });
    expect(sanitizeEnchantFor('diamond_helmet', { id: 'protection', level: 0 })).toEqual({ id: 'protection', level: 1 });
    expect(sanitizeEnchantFor('diamond_pickaxe', { id: 'efficiency', level: 2.7 })).toEqual({ id: 'efficiency', level: 2 });
  });

  it('keeps a valid enchant as a fresh object', () => {
    const raw = { id: 'unbreaking', level: 2 };
    const out = sanitizeEnchantFor('diamond_pickaxe', raw);
    expect(out).toEqual({ id: 'unbreaking', level: 2 });
    expect(out).not.toBe(raw);
  });

  it('rejects junk ids and unusable levels', () => {
    expect(sanitizeEnchantFor('diamond_pickaxe', null)).toBeUndefined();
    expect(sanitizeEnchantFor('diamond_pickaxe', { id: 'looting', level: 1 })).toBeUndefined();
    expect(sanitizeEnchantFor('diamond_pickaxe', { id: '__proto__', level: 1 })).toBeUndefined();
    expect(sanitizeEnchantFor('diamond_pickaxe', { id: 'efficiency', level: NaN })).toBeUndefined();
    expect(sanitizeEnchantFor('diamond_pickaxe', { id: 'efficiency', level: Infinity })).toBeUndefined();
    expect(sanitizeEnchantFor('diamond_pickaxe', { id: 'efficiency' })).toBeUndefined();
    expect(sanitizeEnchantFor('diamond_pickaxe', { id: 'efficiency', level: '2' })).toBeUndefined();
  });
});

describe('rollEnchantOffers', () => {
  it('offers three increasing tiers for an unenchanted tool', () => {
    const seq = [0, 0.5, 0.99];
    let i = 0;
    const offers = rollEnchantOffers(stackOf('diamond_pickaxe'), () => seq[i++]);
    expect(offers).toHaveLength(3);
    expect(offers.map((o) => o.cost)).toEqual([1, 2, 3]);
    expect(offers.map((o) => o.enchant.level)).toEqual([1, 2, 3]);
    expect(offers.map((o) => o.enchant.id)).toEqual(['efficiency', 'fortune', 'unbreaking']);
    for (const offer of offers) {
      expect(compatibleEnchantments('diamond_pickaxe')).toContain(offer.enchant.id);
    }
  });

  it('picks the first compatible enchant for every tier at rng 0', () => {
    const offers = rollEnchantOffers(stackOf('diamond_pickaxe'), () => 0);
    expect(offers.map((o) => o.enchant.id)).toEqual(['efficiency', 'efficiency', 'efficiency']);
  });

  it('clamps a 1.0 roll to the last compatible enchant', () => {
    const offers = rollEnchantOffers(stackOf('diamond_pickaxe'), () => 1);
    expect(offers.map((o) => o.enchant.id)).toEqual(['unbreaking', 'unbreaking', 'unbreaking']);
  });

  it('consumes exactly one roll per tier', () => {
    const rng = vi.fn(() => 0);
    rollEnchantOffers(stackOf('diamond_pickaxe'), rng);
    expect(rng).toHaveBeenCalledTimes(3);
  });

  it('offers a single upgrade for an existing enchant below max', () => {
    const offers = rollEnchantOffers(stackOf('diamond_pickaxe', { id: 'efficiency', level: 2 }), () => 0);
    expect(offers).toEqual([{ enchant: { id: 'efficiency', level: 3 }, cost: 3 }]);
  });

  it('has no offer at max level or for a non-enchantable item', () => {
    expect(rollEnchantOffers(stackOf('diamond_pickaxe', { id: 'efficiency', level: 5 }))).toEqual([]);
    expect(rollEnchantOffers(stackOf('diamond_pickaxe', { id: 'fortune', level: 3 }))).toEqual([]);
    expect(rollEnchantOffers(stackOf('stick'), () => 0)).toEqual([]);
  });
});

describe('effect queries', () => {
  it('efficiencyBonus = L^2 + 1, only on tools that can carry it', () => {
    expect(efficiencyBonus(stackOf('diamond_pickaxe', { id: 'efficiency', level: 5 }))).toBe(26);
    expect(efficiencyBonus(stackOf('iron_axe', { id: 'efficiency', level: 3 }))).toBe(10);
    expect(efficiencyBonus(stackOf('diamond_pickaxe', { id: 'fortune', level: 3 }))).toBe(0);
    expect(efficiencyBonus(stackOf('diamond_helmet', { id: 'efficiency', level: 5 }))).toBe(0);
    expect(efficiencyBonus(stackOf('diamond_pickaxe'))).toBe(0);
    expect(efficiencyBonus(null)).toBe(0);
  });

  it('sharpnessBonus = 1 + 0.5*(L-1), only on swords and axes', () => {
    expect(sharpnessBonus(stackOf('iron_sword', { id: 'sharpness', level: 1 }))).toBe(1);
    expect(sharpnessBonus(stackOf('diamond_sword', { id: 'sharpness', level: 5 }))).toBe(3);
    expect(sharpnessBonus(stackOf('golden_axe', { id: 'sharpness', level: 3 }))).toBe(2);
    expect(sharpnessBonus(stackOf('diamond_pickaxe', { id: 'sharpness', level: 5 }))).toBe(0);
    expect(sharpnessBonus(null)).toBe(0);
  });

  it('unbreakingAvoidChance = L/(L+1)', () => {
    expect(unbreakingAvoidChance(stackOf('iron_pickaxe', { id: 'unbreaking', level: 1 }))).toBe(0.5);
    expect(unbreakingAvoidChance(stackOf('iron_pickaxe', { id: 'unbreaking', level: 2 }))).toBeCloseTo(2 / 3);
    expect(unbreakingAvoidChance(stackOf('iron_pickaxe', { id: 'unbreaking', level: 3 }))).toBe(0.75);
    expect(unbreakingAvoidChance(stackOf('iron_pickaxe'))).toBe(0);
    expect(unbreakingAvoidChance(stackOf('stick', { id: 'unbreaking', level: 3 }))).toBe(0);
    expect(unbreakingAvoidChance(null)).toBe(0);
  });

  it('protectionLevels sums protection on well-formed slots only', () => {
    const set: ArmorSet = {
      helmet: stackOf('diamond_helmet', { id: 'protection', level: 2 }),
      chestplate: stackOf('iron_chestplate', { id: 'protection', level: 1 }),
      leggings: stackOf('diamond_leggings', { id: 'unbreaking', level: 3 }),
      boots: null,
    };
    expect(protectionLevels(set)).toBe(3);
    expect(protectionLevels({ helmet: null, chestplate: null, leggings: null, boots: null })).toBe(0);
  });

  it('protectionLevels ignores misplaced or non-armor stacks', () => {
    expect(protectionLevels({
      helmet: stackOf('diamond_boots', { id: 'protection', level: 4 }),
      chestplate: stackOf('stick', { id: 'protection', level: 4 }),
      leggings: null,
      boots: null,
    })).toBe(0);
  });

  it('fortuneBonus = floor(L/2) guaranteed, +1 on a 50% roll when L is odd', () => {
    expect(fortuneBonus(1, () => 0)).toBe(1);
    expect(fortuneBonus(1, () => 0.49)).toBe(1);
    expect(fortuneBonus(1, () => 0.5)).toBe(0);
    expect(fortuneBonus(1, () => 0.99)).toBe(0);
    expect(fortuneBonus(2)).toBe(1);
    expect(fortuneBonus(3, () => 0)).toBe(2);
    expect(fortuneBonus(3, () => 0.99)).toBe(1);
  });

  it('fortuneBonus is 0 for missing or non-finite levels', () => {
    expect(fortuneBonus(0)).toBe(0);
    expect(fortuneBonus(-2, () => 0)).toBe(0);
    expect(fortuneBonus(NaN)).toBe(0);
    expect(fortuneBonus(Infinity)).toBe(0);
  });
});

describe('applyEnchant', () => {
  it('returns a new stack carrying the enchant and leaves the input alone', () => {
    const input = stackOf('diamond_pickaxe', undefined, 1000);
    const out = applyEnchant(input, { id: 'efficiency', level: 3 });
    expect(out).not.toBe(input);
    expect(out).toEqual({ item: 'diamond_pickaxe', count: 1, dur: 1000, ench: { id: 'efficiency', level: 3 } });
    expect(enchOf(input)).toBeUndefined();
    expect(input).toEqual({ item: 'diamond_pickaxe', count: 1, dur: 1000 });
  });

  it('overwrites an existing enchant with a fresh value', () => {
    const out = applyEnchant(stackOf('iron_sword', { id: 'unbreaking', level: 1 }), { id: 'sharpness', level: 2 });
    expect(enchOf(out)).toEqual({ id: 'sharpness', level: 2 });
  });

  it('does not alias the passed enchant object', () => {
    const enchant = { id: 'fortune', level: 2 } as const;
    const out = applyEnchant(stackOf('diamond_pickaxe'), enchant);
    expect(enchOf(out)).not.toBe(enchant);
    expect(enchOf(out)).toEqual({ id: 'fortune', level: 2 });
  });
});

describe('enchantment catalog', () => {
  it('pins the max levels and English names', () => {
    expect(ENCHANTMENT_MAX_LEVELS).toEqual({
      efficiency: 5, sharpness: 5, protection: 4, unbreaking: 3, fortune: 3,
    });
    expect(ENCHANTMENT_NAMES).toEqual({
      efficiency: 'Efficiency', sharpness: 'Sharpness', protection: 'Protection',
      unbreaking: 'Unbreaking', fortune: 'Fortune',
    });
  });
});

describe('display names', () => {
  it('renders roman numerals', () => {
    expect(enchantmentName({ id: 'efficiency', level: 3 })).toBe('Efficiency III');
    expect(enchantmentName({ id: 'protection', level: 4 })).toBe('Protection IV');
    expect(enchantmentName({ id: 'sharpness', level: 1 })).toBe('Sharpness I');
    expect(enchantmentName({ id: 'fortune', level: 5 })).toBe('Fortune V');
  });

  it('appends a ✦ suffix to an enchanted stack name', () => {
    expect(stackDisplayName(stackOf('diamond_pickaxe', { id: 'efficiency', level: 3 })))
      .toBe('Diamond Pickaxe ✦ Efficiency III');
  });

  it('uses the plain base name when there is no enchant', () => {
    expect(stackDisplayName(stackOf('diamond_pickaxe'))).toBe('Diamond Pickaxe');
    expect(stackDisplayName(stackOf('tnt'))).toBe('TNT');
    expect(stackDisplayName(stackOf('flint_and_steel'))).toBe('Flint and Steel');
  });

  it('ignores a malformed enchant object', () => {
    expect(stackDisplayName({ item: 'diamond_pickaxe', count: 1, ench: { id: 'looting', level: 1 } } as unknown as ItemStack))
      .toBe('Diamond Pickaxe');
  });
});
