import { describe, it, expect } from 'vitest';
import {
  PASSIVE_DEFS,
  MAX_PASSIVE_MOBS,
  PANIC_SPEED_MULTIPLIER,
  createPassiveMob,
  stepPassiveMob,
  stepPassiveMobs,
  damagePassiveMob,
  isPassiveDead,
  hitPassiveMobId,
  attackPassiveMob,
  choosePassiveKind,
  type PassiveKind,
  type PassiveMob,
  type PassiveCtx,
} from './passive-mobs';

// ---- helpers -------------------------------------------------------------
/** 平地：y < 0 都是實心（地面頂面在 y = 0）。 */
const flatGround = (_x: number, y: number, _z: number): boolean => y < 0;
/** 什麼都不實心（空氣）。 */
const air = (): boolean => false;

/** 預設上下文：平地、沒有水、dt = 0.5 秒。 */
const ctxOf = (over: Partial<PassiveCtx> = {}): PassiveCtx => ({
  playerPos: { x: 0, y: 0, z: 0 },
  isSolidAt: flatGround,
  isWaterAt: () => false,
  dt: 0.5,
  ...over,
});

/** 一隻被動生物（預設＝站在原點的牛）。 */
function passive(kind: PassiveKind = 'cow', over: Partial<PassiveMob> = {}): PassiveMob {
  const base = createPassiveMob(kind, { x: 0, y: 0, z: 0 });
  return { ...base, ...over };
}

// ---- 定義表 --------------------------------------------------------------

describe('PASSIVE_DEFS (B4 Task 6：被動生物定義表)', () => {
  it('the passive table matches the vanilla stats', () => {
    expect(PASSIVE_DEFS.chicken).toMatchObject({ hp: 4, width: 0.4, height: 0.7, vanillaSpeed: 0.25 });
    expect(PASSIVE_DEFS.pig).toMatchObject({ hp: 10, width: 0.9, height: 0.9, vanillaSpeed: 0.25 });
    expect(PASSIVE_DEFS.sheep).toMatchObject({ hp: 8, width: 0.9, height: 1.3, vanillaSpeed: 0.23 });
    expect(PASSIVE_DEFS.cow).toMatchObject({ hp: 10, width: 0.9, height: 1.4, vanillaSpeed: 0.2 });
  });

  it('the speed order matches vanilla', () => {
    expect(PASSIVE_DEFS.chicken.speed).toBeGreaterThan(PASSIVE_DEFS.sheep.speed);
    expect(PASSIVE_DEFS.sheep.speed).toBeGreaterThan(PASSIVE_DEFS.cow.speed);
    // 本作的速度換算值（格/秒）：保留原版比例、套用本作的慢速尺度。
    expect(PASSIVE_DEFS.chicken.speed).toBe(1.9);
    expect(PASSIVE_DEFS.pig.speed).toBe(1.9);
    expect(PASSIVE_DEFS.sheep.speed).toBe(1.7);
    expect(PASSIVE_DEFS.cow.speed).toBe(1.5);
  });

  it('the passive cap is 12', () => {
    expect(MAX_PASSIVE_MOBS).toBe(12);
  });
});

// ---- 建立 ---------------------------------------------------------------

describe('createPassiveMob', () => {
  it('creates a mob with the definition stats and a zero velocity', () => {
    const m = createPassiveMob('chicken', { x: 1, y: 2, z: 3 });
    expect(m.kind).toBe('chicken');
    expect(m.hp).toBe(4);
    expect(m.width).toBe(0.4);
    expect(m.height).toBe(0.7);
    expect(m.pos).toEqual({ x: 1, y: 2, z: 3 });
    expect(m.vel).toEqual({ x: 0, y: 0, z: 0 });
    expect(m.yaw).toBe(0);
    expect(m.panicTimer).toBe(0);
    expect(Number.isFinite(m.id)).toBe(true);
  });

  it('gives each mob a unique, increasing id', () => {
    const ids = [
      createPassiveMob('cow', { x: 0, y: 0, z: 0 }).id,
      createPassiveMob('pig', { x: 0, y: 0, z: 0 }).id,
      createPassiveMob('cow', { x: 0, y: 0, z: 0 }).id,
    ];
    expect(new Set(ids).size).toBe(3);
    expect(ids[1]).toBeGreaterThan(ids[0]);
    expect(ids[2]).toBeGreaterThan(ids[1]);
  });

  it('starts with a 2-4 s wander countdown and a finite heading', () => {
    for (let i = 0; i < 10; i++) {
      const m = createPassiveMob('sheep', { x: 0, y: 0, z: 0 });
      expect(Number.isFinite(m.wanderDir)).toBe(true);
      expect(m.wanderTimer).toBeGreaterThanOrEqual(2);
      expect(m.wanderTimer).toBeLessThan(4);
    }
  });
});

// ---- AI ------------------------------------------------------------------

describe('stepPassiveMob (漫遊／panic／水中漂浮)', () => {
  it('a wandering passive mob walks at its own speed', () => {
    // wanderDir = 0 → +z；牛的速度 1.5 格/秒 × 0.5 秒 = 0.75 格
    const m = passive('cow', { pos: { x: 0, y: 0, z: 0 }, wanderDir: 0, wanderTimer: 10 });
    const out = stepPassiveMob(m, ctxOf({ dt: 0.5 }));
    expect(out.pos.z).toBeCloseTo(0.75, 5);
    expect(out.pos.x).toBeCloseTo(0, 5);
    expect(out.pos.y).toBeCloseTo(0, 5);
  });

  it('a wandering mob turns after the timer expires', () => {
    const m = passive('cow', { wanderDir: 0, wanderTimer: 0 });
    const out = stepPassiveMob(m, ctxOf({ rng: () => 0.25 }));
    // 注入的 rng 決定新方向：0.25 × 2π = π/2
    expect(out.wanderDir).toBeCloseTo(Math.PI / 2, 10);
    expect(out.wanderTimer).toBeGreaterThanOrEqual(2);
    expect(out.wanderTimer).toBeLessThan(4);
  });

  it('a panicked mob flees away from the attacker', () => {
    const m = passive('cow', { pos: { x: 0, y: 0, z: 0 } });
    const hurt = damagePassiveMob(m, 1, { x: 10, z: 0 });
    expect(hurt.panicTimer).toBe(5);
    const out = stepPassiveMob(hurt, ctxOf({ dt: 0.5, playerPos: { x: 10, y: 0, z: 0 } }));
    expect(out.pos.x).toBeLessThan(hurt.pos.x); // 遠離 x = 10 的攻擊者
  });

  it('a panicking mob runs at the panic speed', () => {
    const m = passive('cow', { pos: { x: 0, y: 0, z: 0 } });
    const hurt = damagePassiveMob(m, 1, { x: 10, z: 0 });
    const out = stepPassiveMob(hurt, ctxOf({ dt: 0.5, playerPos: { x: 10, y: 0, z: 0 } }));
    // 1.5 格/秒 × 1.4（panic 倍率）× 0.5 秒 = 1.05 格
    expect(out.pos.x).toBeCloseTo(-1.05, 5);
    expect(PANIC_SPEED_MULTIPLIER).toBe(1.4);
  });

  it('a damaged passive mob has less hp', () => {
    const m = passive('pig');
    expect(damagePassiveMob(m, 2).hp).toBe(m.hp - 2);
    expect(damagePassiveMob(m, -1).hp).toBe(m.hp); // 負數傷害不生效
    expect(damagePassiveMob(m, Number.NaN).hp).toBe(m.hp); // NaN 防護
  });

  it('a passive mob floats in water instead of sinking', () => {
    let out = passive('cow', { pos: { x: 0, y: 0, z: 0 } });
    for (let i = 0; i < 2; i++) {
      out = stepPassiveMob(out, ctxOf({ dt: 1, isSolidAt: air, isWaterAt: () => true }));
    }
    expect(out.pos.y).toBe(0);
    expect(out.vel.y).toBe(0);
  });

  it('a passive mob steps up a one-block ledge', () => {
    // 台階：x ≥ 1 的地方在 y = 0 多一格（地面在 y < 0）
    const isSolidAt = (x: number, y: number, _z: number): boolean =>
      y < 0 || (x >= 1 && y === 0);
    const m = passive('cow', { pos: { x: 0.6, y: 0, z: 0 }, wanderDir: Math.PI / 2, wanderTimer: 10 });
    const jumped = stepPassiveMob(m, ctxOf({ dt: 0.1, isSolidAt }));
    expect(jumped.pos.y).toBeGreaterThan(0); // 跳上 1 格台階
    // 落下後站在台階上（y = 1）
    let out = jumped;
    for (let i = 0; i < 20; i++) out = stepPassiveMob(out, ctxOf({ dt: 0.1, isSolidAt }));
    expect(out.pos.y).toBeCloseTo(1, 5);
  });

  it('a blocked mob stops instead of walking through the wall', () => {
    // 前方整面牆（x ≥ 1 的所有高度都實心）→ 生物停下來
    const isSolidAt = (x: number, y: number, _z: number): boolean => y < 0 || x >= 1;
    const m = passive('cow', { pos: { x: 0, y: 0, z: 0 }, wanderDir: Math.PI / 2, wanderTimer: 10 });
    const out = stepPassiveMob(m, ctxOf({ dt: 0.5, isSolidAt }));
    expect(out.pos.x).toBe(0);
  });

  it('a falling passive mob does not take fall damage', () => {
    // 本作的生物本來就沒有摔傷機制（fallDamage 只用於玩家）→ 落下來不會扣血
    let out = passive('cow', { pos: { x: 0, y: 20, z: 0 } });
    const hp = out.hp;
    for (let i = 0; i < 120; i++) out = stepPassiveMob(out, ctxOf({ dt: 0.1 }));
    expect(out.pos.y).toBeCloseTo(0, 5); // 已經落地
    expect(out.hp).toBe(hp);
  });

  it('non-finite dt is treated as 0', () => {
    const m = passive('cow', { pos: { x: 1, y: 5, z: 2 } });
    const out = stepPassiveMob(m, ctxOf({ dt: Number.NaN, isSolidAt: air }));
    expect(out.pos).toEqual({ x: 1, y: 5, z: 2 });
    expect(Number.isFinite(out.pos.x)).toBe(true);
    expect(Number.isFinite(out.pos.y)).toBe(true);
    expect(Number.isFinite(out.pos.z)).toBe(true);
    expect(Number.isFinite(out.vel.y)).toBe(true);
  });

  it('never mutates the input mob', () => {
    const m = passive('cow', { pos: { x: 0, y: 0, z: 0 }, wanderDir: 0, wanderTimer: 10 });
    const before = JSON.stringify(m);
    stepPassiveMob(m, ctxOf({ dt: 0.5 }));
    expect(JSON.stringify(m)).toBe(before);
  });

  it('stepPassiveMobs steps every mob and returns a new array', () => {
    const mobs = [passive('cow', { wanderDir: 0, wanderTimer: 10 }), passive('pig', { wanderDir: 0, wanderTimer: 10 })];
    const out = stepPassiveMobs(mobs, ctxOf({ dt: 0.5 }));
    expect(out).not.toBe(mobs);
    expect(out.length).toBe(2);
    expect(out[0].pos.z).toBeCloseTo(0.75, 5); // 牛 1.5 格/秒
    expect(out[1].pos.z).toBeCloseTo(0.95, 5); // 豬 1.9 格/秒
    expect(mobs[0].pos.z).toBe(0); // 輸入沒被改
  });
});

// ---- 命中與傷害 ---------------------------------------------------------

describe('hitPassiveMobId / attackPassiveMob（玩家的瞄準與揮擊）', () => {
  it('the crosshair hits a passive mob', () => {
    const chicken = passive('chicken', { pos: { x: 0, y: 0, z: 0 } });
    const id = hitPassiveMobId([chicken], { x: 0, y: 0.3, z: 5 }, { x: 0, y: 0, z: -1 }, 10);
    expect(id).toBe(chicken.id);
  });

  it('the chicken is shorter than the cow', () => {
    const chicken = passive('chicken', { pos: { x: 0, y: 0, z: 0 } });
    const cow = passive('cow', { pos: { x: 0, y: 0, z: 0 } });
    // 同一條射線、高度 y = 1.2 → 只有牛（1.4 高）被命中
    const id = hitPassiveMobId([chicken, cow], { x: 0, y: 1.2, z: 5 }, { x: 0, y: 0, z: -1 }, 10);
    expect(id).toBe(cow.id);
  });

  it('a mob out of reach is not hit', () => {
    const chicken = passive('chicken', { pos: { x: 0, y: 0, z: 0 } });
    expect(hitPassiveMobId([chicken], { x: 0, y: 0.3, z: 5 }, { x: 0, y: 0, z: -1 }, 2)).toBeNull();
    expect(hitPassiveMobId([], { x: 0, y: 0.3, z: 5 }, { x: 0, y: 0, z: -1 }, 10)).toBeNull();
  });

  it('attacking reduces hp and reports the hit', () => {
    const pig = passive('pig', { pos: { x: 0, y: 0, z: 0 } });
    const res = attackPassiveMob([pig], { x: 0, y: 0.5, z: 2 }, { x: 0, y: 0, z: -1 }, 4, 3, { x: 0, z: -1 });
    expect(res.hitId).toBe(pig.id);
    expect(res.mobs[0].hp).toBe(pig.hp - 3);
    // 擊退：沿著水平視線方向推 KNOCKBACK_SPEED（6）× 0.6 = 3.6 格/秒
    expect(res.mobs[0].vel.z).toBeCloseTo(-3.6, 5);
    expect(res.mobs[0].vel.x).toBeCloseTo(0, 5);
  });

  it('a miss returns the same array ref with hitId null', () => {
    const pig = passive('pig', { pos: { x: 0, y: 0, z: 0 } });
    const res = attackPassiveMob([pig], { x: 0, y: 3, z: 2 }, { x: 0, y: 0, z: -1 }, 4, 3, { x: 0, z: -1 });
    expect(res.hitId).toBeNull();
    expect(res.mobs[0]).toBe(pig);
  });

  it('attacking panics the mob away from the attacker', () => {
    const pig = passive('pig', { pos: { x: 0, y: 0, z: 0 } });
    const res = attackPassiveMob([pig], { x: 0, y: 0.5, z: 2 }, { x: 0, y: 0, z: -1 }, 4, 1, { x: 0, z: -1 });
    expect(res.mobs[0].panicTimer).toBe(5);
    // 背離攻擊者（玩家在 +z）→ panicDir 指向 -z
    expect(res.mobs[0].panicDir).toBeCloseTo(Math.PI, 5);
  });

  it('a dead passive mob is detected', () => {
    const m = passive('pig');
    expect(isPassiveDead(m)).toBe(false);
    expect(isPassiveDead(damagePassiveMob(m, 999))).toBe(true);
  });
});

// ---- 選種 ---------------------------------------------------------------

describe('choosePassiveKind', () => {
  it('picks one of the four kinds', () => {
    for (const v of [0, 0.24, 0.5, 0.75, 0.99]) {
      expect(['chicken', 'pig', 'sheep', 'cow']).toContain(choosePassiveKind(() => v));
    }
  });
});
