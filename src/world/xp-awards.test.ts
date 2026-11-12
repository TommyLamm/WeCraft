import { describe, it, expect } from 'vitest';
import { BLOCK } from './blocks';
import type { FishingCatch } from './fishing';
import { xpForOre, xpForMob, xpForFishing, xpPerSmelt, type XpMobKind } from './xp-awards';

describe('xp-awards (B17 Task 4：經驗來源表)', () => {
  it('ore table matches the vanilla mining XP（煤 1／鐵 1／金 2／鑽 4）', () => {
    const cases: ReadonlyArray<[number, number]> = [
      [BLOCK.COAL_ORE, 1],
      [BLOCK.IRON_ORE, 1],
      [BLOCK.GOLD_ORE, 2],
      [BLOCK.DIAMOND_ORE, 4],
    ];
    for (const [blockId, xp] of cases) {
      expect(xpForOre(blockId)).toBe(xp);
    }
  });

  it('unknown block ids award 0 and never throw', () => {
    // 空氣、界外 id、負數 → 一律 0（不拋錯）
    expect(xpForOre(0)).toBe(0);
    expect(xpForOre(9999)).toBe(0);
    expect(xpForOre(-1)).toBe(0);
  });

  it('mob table matches §6（敵對 5；雞 1／豬 2／羊 2／牛 3）', () => {
    const cases: ReadonlyArray<[XpMobKind, number]> = [
      ['zombie', 5],
      ['skeleton', 5],
      ['creeper', 5],
      ['spider', 5],
      ['chicken', 1],
      ['pig', 2],
      ['sheep', 2],
      ['cow', 3],
    ];
    for (const [kind, xp] of cases) {
      expect(xpForMob(kind)).toBe(xp);
    }
  });

  it('unknown mob kinds award 0 and never throw', () => {
    // 表外的 kind（非信任資料轉型進來）→ 0，不拋錯
    expect(xpForMob('enderman' as string as XpMobKind)).toBe(0);
    expect(xpForMob('' as string as XpMobKind)).toBe(0);
    // 原型鏈上的鍵只認自有鍵 → 0（絕不回傳 Object.prototype 的成員）
    expect(xpForMob('constructor' as string as XpMobKind)).toBe(0);
    expect(xpForMob('toString' as string as XpMobKind)).toBe(0);
  });

  it('fishing table matches §6（魚 2／垃圾 1／寶物 5）', () => {
    type Category = FishingCatch['category'];
    const cases: ReadonlyArray<[Category, number]> = [
      ['fish', 2],
      ['junk', 1],
      ['treasure', 5],
    ];
    for (const [category, xp] of cases) {
      expect(xpForFishing(category)).toBe(xp);
    }
  });

  it('unknown fishing categories award 0 and never throw', () => {
    type Category = FishingCatch['category'];
    expect(xpForFishing('artifact' as string as Category)).toBe(0);
    // 原型鏈上的鍵只認自有鍵 → 0（絕不回傳 Object.prototype 的成員）
    expect(xpForFishing('constructor' as string as Category)).toBe(0);
  });

  it('smelting awards 1 XP per item taken out', () => {
    expect(xpPerSmelt()).toBe(1);
  });
});
