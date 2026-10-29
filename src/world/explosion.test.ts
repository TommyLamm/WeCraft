import { describe, it, expect } from 'vitest';
import { BLOCK } from './blocks';
import {
  CREEPER_EXPLOSION_POWER,
  explodeAt,
  explosionDamage,
  explosionExposure,
  explosionKnockback,
  type ExplosionCtx,
} from './explosion';

// ---- helpers -------------------------------------------------------------
/** 假世界：每一格都回同一個 block id，且（可選）全部視為實心。
 *  `isSolidAt` 刻意可以與 `blockIdAt` 脫鉤（水／火把非實心，但測試要證明
 *  「水是被抗性 100 擋下來的」而不是被非實心過濾掉的）。 */
const world = (
  blockId: number,
  solid = true,
): Pick<ExplosionCtx, 'blockIdAt' | 'isSolidAt'> => ({
  blockIdAt: () => blockId,
  isSolidAt: () => solid,
});

const keys = (res: ReturnType<typeof explodeAt>): string[] =>
  res.destroyed.map((b) => `${b.x},${b.y},${b.z}`);

describe('explosion pure logic (B9 Task 3)', () => {
  it('the damage formula reproduces the vanilla creeper numbers', () => {
    expect(explosionDamage(3, 0, 1)).toBe(43); // 原版 Normal 43HP
    expect(explosionDamage(3, 3, 1)).toBe(16);
    expect(explosionDamage(3, 6, 1)).toBe(1); // 2×power 內最少 1 傷
    expect(explosionDamage(3, 7, 1)).toBe(0); // 超出 2×power → 0
    expect(explosionDamage(3, 0, 0.4)).toBe(12); // 遮蔽時（簡化的 exposure）
  });

  it('the damage falls off with distance', () => {
    expect(explosionDamage(3, 0, 1)).toBeGreaterThan(explosionDamage(3, 2, 1));
    expect(explosionDamage(3, 0, 1)).toBeGreaterThan(explosionDamage(3, 4, 1));
  });

  it('a non-finite distance deals no damage', () => {
    expect(explosionDamage(3, NaN, 1)).toBe(0);
    expect(explosionDamage(3, Infinity, 1)).toBe(0);
  });

  it('the knockback falls off with distance and is zero outside the range', () => {
    expect(explosionKnockback(3, 0, 1)).toBe(20); // 1 block/tick × 20
    expect(explosionKnockback(3, 3, 1)).toBeCloseTo(10, 5);
    expect(explosionKnockback(3, 6, 1)).toBe(0);
    expect(explosionKnockback(3, 7, 1)).toBe(0);
  });

  it('the exposure is binary', () => {
    expect(explosionExposure(true)).toBe(1);
    expect(explosionExposure(false)).toBe(0.4);
  });

  it('an explosion destroys stone only near the centre', () => {
    // 中心 (0.5,0.5,0.5)、power 3 → reach 4；石頭抗性 6 → 只有核心附近會碎。
    const res = explodeAt({
      power: CREEPER_EXPLOSION_POWER,
      center: { x: 0.5, y: 0.5, z: 0.5 },
      ...world(BLOCK.STONE),
    });
    expect(keys(res)).toContain('0,0,0');
    expect(keys(res)).not.toContain('2,0,0');
    expect(keys(res)).not.toContain('0,0,3');
  });

  it('bedrock and water survive the explosion', () => {
    const center = { x: 0.5, y: 0.5, z: 0.5 };
    // isSolidAt 一律 true（刻意把水視為實心）→ 證明是抗性讓它們活下來，
    // 而不是被非實心過濾擋掉。
    const bedrock = explodeAt({
      power: CREEPER_EXPLOSION_POWER,
      center,
      ...world(BLOCK.BEDROCK),
    });
    expect(bedrock.destroyed).toEqual([]);
    const water = explodeAt({
      power: CREEPER_EXPLOSION_POWER,
      center,
      ...world(BLOCK.WATER),
    });
    expect(water.destroyed).toEqual([]);
  });

  it('leaves and glass are destroyed by a creeper explosion', () => {
    const center = { x: 0.5, y: 0.5, z: 0.5 };
    const leaves = explodeAt({
      power: CREEPER_EXPLOSION_POWER,
      center,
      ...world(BLOCK.LEAVES),
    });
    expect(keys(leaves)).toContain('0,0,0');
    const glass = explodeAt({
      power: CREEPER_EXPLOSION_POWER,
      center,
      ...world(BLOCK.GLASS),
    });
    expect(keys(glass)).toContain('0,0,0');
  });

  it('destroyed blocks drop their item with a one-in-power chance', () => {
    const ctx = {
      power: CREEPER_EXPLOSION_POWER,
      center: { x: 0.5, y: 0.5, z: 0.5 },
      ...world(BLOCK.STONE),
    };
    // rng 恆 0 → 每一格都掉（1/3 的門檻必過）；掉落物＝dropItemFor(石頭)＝鵝卵石
    const always = explodeAt({ ...ctx, rng: () => 0 });
    expect(always.destroyed.length).toBeGreaterThan(0);
    expect(always.drops).toHaveLength(always.destroyed.length);
    expect(always.drops.every((d) => d.item === 'cobblestone' && d.count === 1)).toBe(true);
    // rng 恆 0.99 → 0.99 ≥ 1/3 → 一格都不掉
    const never = explodeAt({ ...ctx, rng: () => 0.99 });
    expect(never.destroyed.length).toBeGreaterThan(0);
    expect(never.drops).toEqual([]);
  });

  it('the explosion never removes air', () => {
    const res = explodeAt({
      power: CREEPER_EXPLOSION_POWER,
      center: { x: 0.5, y: 0.5, z: 0.5 },
      ...world(BLOCK.AIR),
    });
    expect(res.destroyed).toEqual([]);
    expect(res.drops).toEqual([]);
  });
});
