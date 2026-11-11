import { describe, expect, it } from 'vitest';
import {
  MAX_ORB_VALUE, MAX_XP_ORBS, ORB_DESPAWN_AGE, ORB_MAGNET_DELAY, ORB_MAGNET_RADIUS,
  ORB_PICKUP_RADIUS, spawnXpOrbs, stepXpOrbs,
} from './xp-orbs';

const neverSolid = (): boolean => false;
const floorAt = (level: number) => (_x: number, y: number, _z: number) => y <= level;

describe('spawnXpOrbs', () => {
  it('merges into the nearest orb within range and saturates at MAX_ORB_VALUE', () => {
    const base = spawnXpOrbs([], 3, { x: 0, y: 5, z: 0 });
    const near = [{ ...base[0], pos: { x: 1, y: 5, z: 0 }, value: MAX_ORB_VALUE - 1 }];
    const out = spawnXpOrbs(near, 5, { x: 0, y: 5, z: 0 });
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe(MAX_ORB_VALUE);
  });
  it('ignores non-positive or non-finite values (same reference)', () => {
    const orbs: never[] = [];
    expect(spawnXpOrbs(orbs, 0, { x: 0, y: 0, z: 0 })).toBe(orbs);
    expect(spawnXpOrbs(orbs, -1, { x: 0, y: 0, z: 0 })).toBe(orbs);
    expect(spawnXpOrbs(orbs, NaN, { x: 0, y: 0, z: 0 })).toBe(orbs);
  });
  it('caps the array at MAX_XP_ORBS by merging into the nearest orb', () => {
    let orbs = spawnXpOrbs([], 1, { x: 0, y: 5, z: 0 });
    // 第一次迭代的生成點正好壓在唯一那顆（尚未散開）→ 合併；之後每次散開都
    // 讓下一顆落在 100 格外 → 只能新增。跑滿 MAX_XP_ORBS 次才會堆到上限。
    for (let i = 1; i <= MAX_XP_ORBS; i++) {
      orbs = spawnXpOrbs(orbs, 1, { x: 0, y: 5, z: 0 }); // 全部合併成 1 顆
      // 手動散開，讓下一顆不會自動合併
      orbs = orbs.map((o, idx) => ({ ...o, pos: { x: idx * 100 + 100, y: 5, z: 0 } }));
    }
    expect(orbs).toHaveLength(MAX_XP_ORBS);
    const capped = spawnXpOrbs(orbs, 7, { x: 0, y: 5, z: 0 });
    expect(capped).toHaveLength(MAX_XP_ORBS);
    expect(capped[0].value).toBe(orbs[0].value + 7); // 7 併進最近的球（x=100）——不是被丟棄
  });
});

describe('stepXpOrbs', () => {
  it('falls with gravity and settles on solid ground without tunneling', () => {
    let orbs = spawnXpOrbs([], 1, { x: 0.5, y: 8, z: 0.5 });
    for (let i = 0; i < 50; i++) orbs = stepXpOrbs(orbs, 0.1, { x: 40, y: 4, z: 0 }, floorAt(4)).orbs;
    expect(orbs[0].pos.y).toBeCloseTo(5.01, 2); // 吸附到地面格上緣 + settle
    expect(orbs[0].vel.y).toBe(0);
  });
  it('ignores magnetism until ORB_MAGNET_DELAY, then homes at ORB_MAGNET_SPEED', () => {
    const far = [{ value: 1, id: 0, pos: { x: 0, y: 5, z: 0 }, vel: { x: 0, y: 0, z: 0 }, age: 0, pickupDelay: 0 }];
    const early = stepXpOrbs(far, 0.1, { x: 2, y: 5, z: 0 }, neverSolid);
    expect(early.orbs[0].pos.x).toBeLessThan(0.01);
    const late = [{ ...far[0], age: ORB_MAGNET_DELAY }];
    const moving = stepXpOrbs(late, 0.1, { x: 2, y: 5, z: 0 }, neverSolid);
    expect(moving.orbs[0].pos.x).toBeGreaterThan(0.5);
    // 超出磁吸半徑：就算已過延遲也不會被拉走（磁吸以眼睛高度量距離）
    const outOfRange = [{ ...far[0], age: ORB_MAGNET_DELAY, pos: { x: ORB_MAGNET_RADIUS + 1, y: 5, z: 0 } }];
    const still = stepXpOrbs(outOfRange, 0.1, { x: 0, y: 5, z: 0 }, neverSolid);
    expect(still.orbs[0].pos.x).toBe(ORB_MAGNET_RADIUS + 1);
  });
  it('collects within ORB_PICKUP_RADIUS and sums the collected value', () => {
    const orbs = [
      { value: 3, id: 0, pos: { x: 0, y: 5, z: 0 }, vel: { x: 0, y: 0, z: 0 }, age: 10, pickupDelay: 0 },
      { value: 4, id: 1, pos: { x: ORB_PICKUP_RADIUS + 2, y: 5, z: 0 }, vel: { x: 0, y: 0, z: 0 }, age: 10, pickupDelay: 0 },
    ];
    const out = stepXpOrbs(orbs, 0.1, { x: 0, y: 4, z: 0 }, neverSolid);
    expect(out.collected).toBe(3);
    expect(out.orbs).toHaveLength(1);
  });
  it('despawns at ORB_DESPAWN_AGE and ignores non-finite dt', () => {
    const old = [{ value: 1, id: 0, pos: { x: 0, y: 5, z: 0 }, vel: { x: 0, y: 0, z: 0 }, age: ORB_DESPAWN_AGE, pickupDelay: 0 }];
    expect(stepXpOrbs(old, 0.1, { x: 0, y: 0, z: 0 }, neverSolid).orbs).toHaveLength(0);
    const nano = stepXpOrbs(old, NaN, { x: 0, y: 0, z: 0 }, neverSolid);
    expect(nano.orbs).toHaveLength(1);
    expect(nano.collected).toBe(0);
  });
});
