import { describe, it, expect } from 'vitest';
import {
  MAX_PRIMED_TNT,
  TNT_BLINK_SEC,
  TNT_CHAIN_FUSE_MAX_SEC,
  TNT_CHAIN_FUSE_MIN_SEC,
  TNT_EXPLOSION_POWER,
  TNT_FUSE_SEC,
  TNT_GRAVITY,
  TNT_HEIGHT,
  TNT_LAUNCH_SIDE,
  TNT_LAUNCH_UP,
  TNT_WIDTH,
  createPrimedTnt,
  primeTntChain,
  stepPrimedTnts,
  tntBlinkBright,
} from './tnt';

// ---- B11 Task 4：引信 TNT 純邏輯 ----
// 原版值（minecraft.wiki/TNT，2026-11-03）：碰撞盒 0.98×0.98、引信 80 tick＝4 秒、
// power 4、初始速度 +0.2 格/tick 上（＝4 格/秒）與 0.02 格/tick 隨機水平（＝0.4 格/秒）、
// 被爆炸波及的 TNT 隨機 10–30 tick（0.5–1.5 秒）引爆、貼圖每 0.5 秒閃一次。

describe('primed tnt (B11 Task 4)', () => {
  it('the tnt constants match vanilla', () => {
    expect(TNT_WIDTH).toBe(0.98);
    expect(TNT_HEIGHT).toBe(0.98);
    expect(TNT_FUSE_SEC).toBe(4);
    expect(TNT_EXPLOSION_POWER).toBe(4);
    expect(TNT_LAUNCH_UP).toBe(4); // 0.2 格/tick × 20
    expect(TNT_LAUNCH_SIDE).toBe(0.4); // 0.02 格/tick × 20
    expect(TNT_GRAVITY).toBe(32); // 本作生物尺度（原版 16；已揭露的簡化）
    expect(TNT_BLINK_SEC).toBe(0.5);
    expect(TNT_CHAIN_FUSE_MIN_SEC).toBe(0.5);
    expect(TNT_CHAIN_FUSE_MAX_SEC).toBe(1.5);
    expect(MAX_PRIMED_TNT).toBe(32);
  });

  it('a fresh tnt gets the launch velocity and a full fuse', () => {
    const t = createPrimedTnt({ x: 1, y: 2, z: 3 }, { rng: () => 0 });
    expect(t.pos).toEqual({ x: 1, y: 2, z: 3 });
    // rng 0 → 角度 0 → 水平速度全在 +z
    expect(t.vel.y).toBe(TNT_LAUNCH_UP);
    expect(t.vel.x).toBeCloseTo(0, 10);
    expect(t.vel.z).toBeCloseTo(TNT_LAUNCH_SIDE, 10);
    expect(t.fuse).toBe(TNT_FUSE_SEC);
    expect(t.fuseTotal).toBe(TNT_FUSE_SEC);
  });

  it('the fuse expires after four seconds and emits exactly one explosion', () => {
    let t = createPrimedTnt({ x: 0, y: 6, z: 0 }, { rng: () => 0 });
    let events = 0;
    for (let i = 0; i < 81; i++) {
      const step = stepPrimedTnts([t], { isSolidAt: (_x, y, _z) => y < 6, dt: 0.05 });
      t = step.tnts[0]!;
      events += step.events.length;
      if (step.tnts.length === 0) break;
    }
    expect(events).toBe(1);
  });

  it('an exploding tnt is removed from the list (no second event)', () => {
    const t = createPrimedTnt({ x: 0, y: 6, z: 0 }, { fuse: 0.05, rng: () => 0 });
    const first = stepPrimedTnts([t], { isSolidAt: () => false, dt: 0.05 });
    expect(first.events).toHaveLength(1);
    expect(first.tnts).toHaveLength(0);
    expect(first.events[0]).toEqual({
      type: 'explode',
      tntId: t.id,
      at: { x: 0, y: 6.06125, z: 0 }, // 原版爆炸中心＝實體位置 +0.06125
    });
    const second = stepPrimedTnts(first.tnts, { isSolidAt: () => false, dt: 0.05 });
    expect(second.events).toHaveLength(0);
  });

  it('a non-finite dt is treated as zero (no fuse progress)', () => {
    const t = createPrimedTnt({ x: 0, y: 6, z: 0 }, { rng: () => 0 });
    const step = stepPrimedTnts([t], { isSolidAt: () => false, dt: Number.NaN });
    expect(step.tnts).toHaveLength(1);
    expect(step.tnts[0]!.fuse).toBe(TNT_FUSE_SEC);
    expect(step.events).toHaveLength(0);
  });

  it('a freshly primed tnt blinks dark and alternates every 0.5 s', () => {
    const t = createPrimedTnt({ x: 0, y: 6, z: 0 }, { fuse: 4, rng: () => 0 });
    expect(tntBlinkBright(t)).toBe(false);
    expect(tntBlinkBright({ ...t, fuse: 3.5 })).toBe(true);
    expect(tntBlinkBright({ ...t, fuse: 3.0 })).toBe(false);
    expect(tntBlinkBright({ ...t, fuse: 2.5 })).toBe(true);
    // fuseTotal 0（未引信）→ 不閃
    expect(tntBlinkBright({ ...t, fuseTotal: 0, fuse: 0 })).toBe(false);
  });

  it('chain priming rolls a 0.5–1.5 s fuse and stops at the cap', () => {
    // 每一個 position 消耗兩個 rng：先抽引信（0 → MIN、1 → MAX），再抽方向。
    const rngValues = [0, 0, 1, 0];
    const { tnts, primedCount } = primeTntChain(
      [],
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      { rng: () => rngValues.shift() ?? 0, cap: 2 },
    );
    expect(primedCount).toBe(2);
    expect(tnts).toHaveLength(2);
    expect(tnts[0]!.fuse).toBe(0.5);
    expect(tnts[1]!.fuse).toBe(1.5);
  });

  it('chain priming counts the already-primed list toward the cap', () => {
    // 批末審查：cap 是「同時存在的引信總數」——1 既存 + 1 新 = 上限 2，
    // 第二個波及格不誘爆（呼叫端讓它照 100% 掉落）。
    const existing = createPrimedTnt({ x: 9, y: 9, z: 9 }, { rng: () => 0 });
    const { tnts, primedCount } = primeTntChain(
      [existing],
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      { rng: () => 0, cap: 2 },
    );
    expect(primedCount).toBe(1);
    expect(tnts).toHaveLength(2);
  });

  it('chain priming keeps existing entities and appends new ones', () => {
    const existing = createPrimedTnt({ x: 9, y: 9, z: 9 }, { rng: () => 0 });
    const { tnts, primedCount } = primeTntChain([existing], [{ x: 0, y: 0, z: 0 }], {
      rng: () => 0,
    });
    expect(primedCount).toBe(1);
    expect(tnts).toHaveLength(2);
    expect(tnts[0]!.id).toBe(existing.id);
  });

  it('primed tnt falls and lands on solid ground', () => {
    let t = createPrimedTnt({ x: 0, y: 8, z: 0 }, { rng: () => 0 });
    for (let i = 0; i < 40; i++) {
      t = stepPrimedTnts([t], { isSolidAt: (_x, y, _z) => y <= 0, dt: 0.05 }).tnts[0]!;
    }
    expect(t.pos.y).toBeGreaterThanOrEqual(1);
    expect(t.pos.y).toBeLessThan(1.2);
    expect(t.vel.y).toBe(0);
    // 落地後水平速度歸零（已揭露的簡化）
    expect(t.vel.x).toBe(0);
    expect(t.vel.z).toBe(0);
  });

  it('a wall stops the horizontal drift without tunnelling', () => {
    // **沒有地板**（空中）＋起點貼牆 0.8 格：水平速度 +z 0.4、20 步（1 秒）
    // 足以撞上 z=1 起的牆面。沒有牆時 z 會走到 ≈ 1.2 → 拿掉逐軸碰撞這條測試
    // 會轉紅（批末審查：舊版有地板 → 落地即歸零水平速度，從未靠近牆面＝恆真）。
    let t = createPrimedTnt({ x: 0, y: 1, z: 0.8 }, { rng: () => 0 });
    for (let i = 0; i < 20; i++) {
      t = stepPrimedTnts([t], {
        isSolidAt: (_x, _y, z) => z >= 1, // 只有牆、沒有地板
        dt: 0.05,
      }).tnts[0]!;
    }
    expect(t.pos.z).toBeGreaterThan(0.9);
    expect(t.pos.z).toBeLessThan(1);
  });
});
