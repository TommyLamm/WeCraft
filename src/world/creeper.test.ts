import { describe, it, expect } from 'vitest';
import {
  CREEPER_CANCEL_DIST,
  CREEPER_FUSE_SEC,
  CREEPER_HEIGHT,
  CREEPER_HP,
  CREEPER_TRIGGER_DIST,
  CREEPER_WIDTH,
  attackCreeper,
  createCreeper,
  damageCreeper,
  hitCreeperId,
  isCreeperDead,
  stepCreeper,
  type Creeper,
  type CreeperCtx,
  type CreeperEvent,
} from './creeper';

// ---- helpers -------------------------------------------------------------
/** 測試用 ctx：玩家位置 ＋（預設）無實心方塊、全程有視線。 */
const ctxFor = (
  playerPos: { x: number; y: number; z: number },
  opts: { dt?: number; los?: boolean; solid?: (x: number, y: number, z: number) => boolean } = {},
): CreeperCtx => ({
  playerPos,
  isSolidAt: opts.solid ?? (() => false),
  hasLineOfSight: () => opts.los ?? true,
  dt: opts.dt ?? 0.1,
});

/** 一直步進直到引信開始（或超過 max 步），回傳最後狀態與所有事件。 */
const stepUntil = (
  c: Creeper,
  ctx: CreeperCtx,
  max = 200,
): { creeper: Creeper; events: CreeperEvent[] } => {
  let s = c;
  const events: CreeperEvent[] = [];
  for (let i = 0; i < max && s.state !== 'fuse' && s.state !== 'exploded'; i++) {
    const r = stepCreeper(s, ctx);
    s = r.creeper;
    events.push(...r.events);
  }
  return { creeper: s, events };
};

describe('creeper (B9 Task 4)', () => {
  it('the creeper table matches the vanilla stats', () => {
    expect(CREEPER_HP).toBe(20);
    expect(CREEPER_WIDTH).toBe(0.6);
    expect(CREEPER_HEIGHT).toBe(1.7);
    expect(CREEPER_FUSE_SEC).toBe(1.5);
    expect(CREEPER_TRIGGER_DIST).toBe(3);
    expect(CREEPER_CANCEL_DIST).toBe(7); // vanilla SwellGoal#tick：distanceToSqr > 49.0
  });

  it('a creeper starts its fuse within three blocks of the player', () => {
    const c = createCreeper({ x: 0, y: 6, z: 0 });
    const r = stepCreeper(c, ctxFor({ x: 2, y: 6, z: 0 }));
    expect(r.creeper.state).toBe('fuse');
    // 開始引信的那一幀**不倒數**（引信總長 1.5 秒 ＝ 之後 30 幀 × dt 0.05）
    expect(r.creeper.fuse).toBe(CREEPER_FUSE_SEC);
    expect(r.creeper.fuse).toBeGreaterThan(1.3);
    expect(r.events).toHaveLength(0);
  });

  it('a creeper does not start its fuse beyond three blocks', () => {
    const c = createCreeper({ x: 0, y: 6, z: 0 });
    const r = stepCreeper(c, ctxFor({ x: 5, y: 6, z: 0 }));
    expect(r.creeper.state).not.toBe('fuse');
    expect(r.creeper.fuse).toBe(0);
  });

  it('a creeper does not start its fuse without line of sight', () => {
    const c = createCreeper({ x: 0, y: 6, z: 0 });
    const r = stepCreeper(c, ctxFor({ x: 2, y: 6, z: 0 }, { los: false }));
    expect(r.creeper.state).not.toBe('fuse');
    expect(r.creeper.fuse).toBe(0);
  });

  it('the fuse expires after one and a half seconds and emits an explosion', () => {
    const c = createCreeper({ x: 0, y: 6, z: 0 });
    const ctx = ctxFor({ x: 2, y: 6, z: 0 }, { dt: 0.05 });
    let s = c;
    let events: CreeperEvent[] = [];
    // 30 幀：第 1 幀開始引信（不倒數）＋ 29 次倒數 → fuse 還剩 0.05
    for (let i = 0; i < 30; i++) {
      const r = stepCreeper(s, ctx);
      s = r.creeper;
      events = events.concat(r.events);
    }
    expect(events).toHaveLength(0);
    expect(s.state).toBe('fuse');
    // 第 31 幀（第 30 次倒數）→ 引爆
    const last = stepCreeper(s, ctx);
    expect(last.events).toHaveLength(1);
    expect(last.events[0]).toEqual({
      type: 'explode',
      creeperId: c.id,
      at: { x: 0, y: 6, z: 0 },
    });
    expect(last.creeper.state).toBe('exploded');
  });

  it('an exploded creeper does not explode again', () => {
    const c = createCreeper({ x: 0, y: 6, z: 0 });
    const ctx = ctxFor({ x: 2, y: 6, z: 0 }, { dt: 0.05 });
    const exploded = stepUntil(c, ctx).creeper;
    // 走到真的引爆（stepUntil 只停在 fuse；再補到 exploded）
    let s = exploded;
    for (let i = 0; i < 60 && s.state !== 'exploded'; i++) s = stepCreeper(s, ctx).creeper;
    expect(s.state).toBe('exploded');
    const after = stepCreeper(s, ctx);
    expect(after.events).toHaveLength(0);
    expect(after.creeper.state).toBe('exploded');
  });

  it('the fuse is cancelled when the player walks away', () => {
    const c = createCreeper({ x: 0, y: 6, z: 0 });
    const started = stepCreeper(c, ctxFor({ x: 2, y: 6, z: 0 })).creeper;
    expect(started.state).toBe('fuse');
    // 8 格 > CREEPER_CANCEL_DIST (7) → 取消（嚴格大於才取消）
    const away = stepCreeper(started, ctxFor({ x: 8, y: 6, z: 0 }));
    expect(away.creeper.state).toBe('chase');
    expect(away.creeper.fuse).toBe(0);
    expect(away.events).toHaveLength(0);
  });

  it('the fuse keeps running at exactly the cancel distance', () => {
    const c = createCreeper({ x: 0, y: 6, z: 0 });
    const started = stepCreeper(c, ctxFor({ x: 2, y: 6, z: 0 })).creeper;
    // 三維距離剛好 7 ＝ 門檻本身（vanilla 是 > 7 才取消）→ 引信照常倒數
    const atEdge = stepCreeper(started, ctxFor({ x: 7, y: 6, z: 0 }));
    expect(atEdge.creeper.state).toBe('fuse');
    expect(atEdge.creeper.fuse).toBeLessThan(CREEPER_FUSE_SEC);
    expect(atEdge.events).toHaveLength(0);
  });

  it('the fuse is cancelled when the line of sight breaks', () => {
    const c = createCreeper({ x: 0, y: 6, z: 0 });
    const started = stepCreeper(c, ctxFor({ x: 2, y: 6, z: 0 })).creeper;
    const blocked = stepCreeper(started, ctxFor({ x: 2, y: 6, z: 0 }, { los: false }));
    expect(blocked.creeper.fuse).toBe(0);
    expect(blocked.events).toHaveLength(0);
    expect(blocked.creeper.state).toBe('chase');
  });

  it('a fusing creeper stops moving', () => {
    const c = createCreeper({ x: 0, y: 6, z: 0 });
    const started = stepCreeper(c, ctxFor({ x: 2, y: 6, z: 0 })).creeper;
    const later = stepCreeper(started, ctxFor({ x: 2, y: 6, z: 0 }, { dt: 0.5 })).creeper;
    expect(later.pos.x).toBeCloseTo(started.pos.x, 10);
    expect(later.pos.z).toBeCloseTo(started.pos.z, 10);
  });

  it('a chasing creeper moves toward the player', () => {
    const c = createCreeper({ x: 0, y: 6, z: 0 });
    const before = Math.hypot(10 - c.pos.x, 0 - c.pos.z);
    const r = stepCreeper(c, ctxFor({ x: 10, y: 6, z: 0 }, { dt: 0.5 }));
    expect(r.creeper.state).toBe('chase');
    const after = Math.hypot(10 - r.creeper.pos.x, 0 - r.creeper.pos.z);
    expect(after).toBeLessThan(before);
  });

  it('a creeper wanders when the player is far away', () => {
    const c = createCreeper({ x: 0, y: 6, z: 0 }, () => 0.5);
    const r = stepCreeper(c, ctxFor({ x: 40, y: 6, z: 0 }, { dt: 1 }));
    expect(r.creeper.state).toBe('wander');
    expect(r.creeper.pos.x).not.toBe(c.pos.x);
    expect(r.creeper.pos.z).not.toBe(c.pos.z);
  });

  it('a damaged creeper has less hp', () => {
    const c = createCreeper({ x: 0, y: 6, z: 0 });
    expect(damageCreeper(c, 5).hp).toBe(15);
    // 非有限／非正傷害是 no-op（repo 的 NaN 防護慣例）
    expect(damageCreeper(c, -1).hp).toBe(CREEPER_HP);
    expect(damageCreeper(c, NaN).hp).toBe(CREEPER_HP);
  });

  it('a dead creeper is detected', () => {
    const c = createCreeper({ x: 0, y: 6, z: 0 });
    expect(isCreeperDead(damageCreeper(c, 999))).toBe(true);
    expect(isCreeperDead(c)).toBe(false);
  });

  it('the crosshair hits a creeper', () => {
    const c = createCreeper({ x: 0, y: 0, z: 0 });
    expect(hitCreeperId([c], { x: 0, y: 0.9, z: 5 }, { x: 0, y: 0, z: -1 }, 10)).toBe(c.id);
    // 打偏（高度在碰撞盒外）→ 沒中
    expect(hitCreeperId([c], { x: 0, y: 3, z: 5 }, { x: 0, y: 0, z: -1 }, 10)).toBeNull();
    // 超出 reach → 沒中
    expect(hitCreeperId([c], { x: 0, y: 0.9, z: 5 }, { x: 0, y: 0, z: -1 }, 1)).toBeNull();
  });

  it('attacking reduces hp and reports the hit', () => {
    const c = createCreeper({ x: 0, y: 0, z: 0 });
    const r = attackCreeper([c], { x: 0, y: 0.9, z: 5 }, { x: 0, y: 0, z: -1 }, 10, 3, {
      x: 0,
      z: -1,
    });
    expect(r.hitId).toBe(c.id);
    expect(r.creepers[0].hp).toBe(CREEPER_HP - 3);
    // 沒命中 → 原清單不變、hitId null
    const miss = attackCreeper([c], { x: 0, y: 3, z: 5 }, { x: 0, y: 0, z: -1 }, 10, 3, {
      x: 0,
      z: -1,
    });
    expect(miss.hitId).toBeNull();
    expect(miss.creepers[0].hp).toBe(CREEPER_HP);
  });

  it('non-finite dt is treated as zero', () => {
    const c = createCreeper({ x: 0, y: 6, z: 0 });
    const r = stepCreeper(c, ctxFor({ x: 40, y: 6, z: 0 }, { dt: NaN }));
    expect(r.creeper.pos).toEqual(c.pos);
    expect(Number.isFinite(r.creeper.pos.x)).toBe(true);
    expect(Number.isFinite(r.creeper.pos.y)).toBe(true);
    expect(Number.isFinite(r.creeper.pos.z)).toBe(true);
  });
});
