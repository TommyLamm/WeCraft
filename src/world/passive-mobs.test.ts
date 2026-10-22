import { describe, it, expect } from 'vitest';
import { BLOCK } from './blocks';
import { clockLight } from './spawn-rules';
import { xzDistance } from './mobs';
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
  trySpawnPassiveGroup,
  passiveMotherPoint,
  PASSIVE_SPAWN_INTERVAL_SEC,
  PASSIVE_SPAWN_MIN_DIST,
  PASSIVE_SPAWN_MAX_DIST,
  PASSIVE_SPAWN_MOTHER_MIN_DIST,
  PASSIVE_SPAWN_MIN_GROUP,
  PASSIVE_SPAWN_MAX_GROUP,
  type PassiveKind,
  type PassiveMob,
  type PassiveCtx,
  type PassiveSpawnCtx,
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
    // 第三個參數是**攻擊者的位置**（brief 釘死）→ 攻擊者在 x = 10 → 生物往 -x 逃
    const hurt = damagePassiveMob(m, 1, { x: 10, z: 0 });
    expect(hurt.panicTimer).toBe(5);
    const out = stepPassiveMob(hurt, ctxOf({ dt: 0.5, playerPos: { x: 10, y: 0, z: 0 } }));
    expect(out.pos.x).toBeLessThan(hurt.pos.x); // 遠離 x = 10 的攻擊者
  });

  it('a panicking mob runs at the panic speed', () => {
    // wanderDir = 0 → 沒有給擊退方向時 panicDir = 0 + π = π → 往 -z 逃（方向確定）
    const m = passive('cow', { pos: { x: 0, y: 0, z: 0 }, wanderDir: 0, wanderTimer: 10 });
    // 沒有給擊退方向 → panicDir = 漫遊方向 + π = π → 往 -z 逃（也沒有擊退衝量）
    const hurt = damagePassiveMob(m, 1);
    const out = stepPassiveMob(hurt, ctxOf({ dt: 0.5, playerPos: { x: 0, y: 0, z: 20 } }));
    // 1.5 格/秒 × 1.4（panic 倍率）× 0.5 秒 = 1.05 格
    expect(out.pos.z).toBeCloseTo(-1.05, 5);
    expect(PANIC_SPEED_MULTIPLIER).toBe(1.4);
  });

  it('a panicking mob does not re-wander', () => {
    // panic 期間**不重新漫遊**：方向不變、計時器也不會被漫遊邏輯重設成新的 2–4 秒。
    const m = passive('cow', {
      pos: { x: 0, y: 0, z: 0 },
      wanderDir: 0.5,
      wanderTimer: 10,
      panicTimer: 5,
      panicDir: Math.PI,
    });
    let out = m;
    for (let i = 0; i < 4; i++) out = stepPassiveMob(out, ctxOf({ dt: 0.5, rng: () => 0.9 }));
    expect(out.wanderDir).toBe(0.5); // 方向沒被換掉
    expect(out.wanderTimer).toBeLessThan(10); // 沒有被重設（只是繼續倒數 → 8）
    expect(out.wanderTimer).toBeCloseTo(8, 5);
    expect(out.panicTimer).toBe(3); // 5 秒的 panic 過了 2 秒
  });

  it('a damaged passive mob has less hp', () => {
    const m = passive('pig');
    expect(damagePassiveMob(m, 2).hp).toBe(m.hp - 2);
    expect(damagePassiveMob(m, -1).hp).toBe(m.hp); // 負數傷害不生效
    expect(damagePassiveMob(m, Number.NaN).hp).toBe(m.hp); // NaN 防護
  });

  it('damagePassiveMob always returns a new object', () => {
    // 與 `mobs.ts` 的 `damageMob` 一致：任何分支都回傳新物件（不回同一個參考）。
    const m = passive('pig');
    expect(damagePassiveMob(m, 1)).not.toBe(m);
    expect(damagePassiveMob(m, -1)).not.toBe(m);
    expect(damagePassiveMob(m, Number.NaN)).not.toBe(m);
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

  it('a mob does not walk its body into a wall', () => {
    // **探測距離要蓋到身體前端**：牛的半寬 0.45，若只探 0.3 → 身體會插進牆裡
    // 最多 0.15 格（審查 M-4）。停下來時身體前端最多碰到牆面（x = 1）。
    // 起點掃描：插進去的深度跟「起點落在格子的哪裡」有關 → 多掃幾個起點。
    const isSolidAt = (x: number, y: number, _z: number): boolean => y < 0 || x >= 1;
    for (let start = 0; start <= 0.5; start += 0.05) {
      const m = passive('cow', {
        pos: { x: start, y: 0, z: 0 },
        wanderDir: Math.PI / 2,
        wanderTimer: 10,
      });
      let out = m;
      for (let i = 0; i < 30; i++) out = stepPassiveMob(out, ctxOf({ dt: 0.1, isSolidAt }));
      expect(out.pos.x + out.width / 2).toBeLessThanOrEqual(1 + 1e-9);
    }
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

  it('the nearest passive mob along the ray wins', () => {
    const near = passive('cow', { pos: { x: 0, y: 0, z: -2 } });
    const far = passive('cow', { pos: { x: 0, y: 0, z: -5 } });
    const eye = { x: 0, y: 0.5, z: 0 };
    const dir = { x: 0, y: 0, z: -1 };
    // 名單順序不影響結果 → 一定是「沿著射線最近的那隻」贏
    expect(hitPassiveMobId([near, far], eye, dir, 10)).toBe(near.id);
    expect(hitPassiveMobId([far, near], eye, dir, 10)).toBe(near.id);
  });

  it('attacking reduces hp and reports the hit', () => {
    const pig = passive('pig', { pos: { x: 0, y: 0, z: 0 } });
    const res = attackPassiveMob([pig], { x: 0, y: 0.5, z: 2 }, { x: 0, y: 0, z: -1 }, 4, 3, { x: 0, z: -1 });
    expect(res.hitId).toBe(pig.id);
    expect(res.mobs[0].hp).toBe(pig.hp - 3);
    // 擊退：沿著水平視線方向推 `KNOCKBACK_SPEED`（6，`mobs.ts` 的既有常數）
    expect(res.mobs[0].kbVel.z).toBeCloseTo(-6, 5);
    expect(res.mobs[0].kbVel.x).toBeCloseTo(0, 5);
  });

  it('the knockback pushes the mob further than an identical mob without it', () => {
    // **對照組**：兩隻牛起始位置／方向／受傷完全相同，只有「有沒有擊退衝量」不同。
    //   A：第 4 個參數給了擊退方向 {0, -1} → kbVel = (0, -6)
    //   B：沒有給擊退方向                          → kbVel = (0, 0)
    // 兩隻都沒有給 `from` → panicDir 都是「漫遊方向 + π = π」（往 -z 逃）→ AI 的
    // 行為完全一致，位移差**只可能**來自擊退（審查 I-1 的回歸釘子）。
    const start = passive('cow', { pos: { x: 0, y: 0, z: 0 }, wanderDir: 0, wanderTimer: 10 });
    const knocked = damagePassiveMob(start, 1, undefined, { x: 0, z: -1 });
    const plain = damagePassiveMob(start, 1);
    expect(knocked.kbVel.z).toBeCloseTo(-6, 5);
    expect(plain.kbVel.z).toBe(0);
    expect(knocked.panicDir).toBeCloseTo(plain.panicDir, 10); // 逃跑方向相同
    let a = knocked;
    let b = plain;
    for (let i = 0; i < 10; i++) {
      a = stepPassiveMob(a, ctxOf({ dt: 0.1, playerPos: { x: 0, y: 0, z: 20 } }));
      b = stepPassiveMob(b, ctxOf({ dt: 0.1, playerPos: { x: 0, y: 0, z: 20 } }));
    }
    // 被擊退的那隻被推得更遠（實測約 2.6 格）→ 門檻 0.5 格：抓得到「擊退被覆寫」
    // 的回歸（那個回歸會讓差值變成 0），又不會因為一點點數值誤差就紅。
    expect(a.pos.z).toBeLessThan(b.pos.z);
    expect(Math.abs(a.pos.z - b.pos.z)).toBeGreaterThan(0.5);
  });

  it('the attacker position and the knockback direction are independent', () => {
    const m = passive('cow', { pos: { x: 0, y: 0, z: 0 }, wanderDir: 0, wanderTimer: 10 });
    // 只給 `from`（攻擊者在 x = 10）→ panic 背離它（-x），但**沒有**擊退衝量
    const onlyFrom = damagePassiveMob(m, 1, { x: 10, z: 0 });
    expect(onlyFrom.panicDir).toBeCloseTo(Math.atan2(0 - 10, 0 - 0), 10);
    expect(onlyFrom.kbVel.x).toBe(0);
    expect(onlyFrom.kbVel.z).toBe(0);
    // 只給 `knockbackDir`（往 +z 推）→ 有衝量，panic 方向用「漫遊方向 + π」
    const onlyKnock = damagePassiveMob(m, 1, undefined, { x: 0, z: 1 });
    expect(onlyKnock.kbVel.z).toBeCloseTo(6, 5);
    expect(onlyKnock.kbVel.x).toBeCloseTo(0, 5);
    expect(onlyKnock.panicDir).toBeCloseTo(Math.PI, 10);
    // 兩個都給、而且**方向不同** → 各自只影響自己的部分
    const both = damagePassiveMob(m, 1, { x: 10, z: 0 }, { x: 0, z: 1 });
    expect(both.panicDir).toBeCloseTo(Math.atan2(-10, 0), 10); // 背離攻擊者（-x）
    expect(both.kbVel.z).toBeCloseTo(6, 5); // 擊退往 +z
    expect(both.kbVel.x).toBeCloseTo(0, 5);
  });

  it('the knockback impulse decays and clears', () => {
    const m = passive('cow', { pos: { x: 0, y: 0, z: 0 } });
    // 第 4 個參數＝擊退方向（往 -z 推）
    const hurt = damagePassiveMob(m, 1, undefined, { x: 0, z: -1 });
    expect(hurt.kbVel.z).toBeCloseTo(-6, 5);
    // `mobs.ts` 的衰減：0.1^dt（dt = 1 → ×0.1）
    const one = stepPassiveMob(hurt, ctxOf({ dt: 1 }));
    expect(one.kbVel.z).toBeCloseTo(-0.6, 5);
    // 再一步 → 0.06 < KNOCKBACK_MIN（0.1）→ 歸零
    const two = stepPassiveMob(one, ctxOf({ dt: 1 }));
    expect(two.kbVel.z).toBe(0);
    expect(two.kbVel.x).toBe(0);
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

// ---- B4 Task 7：生成規則（統計測試）--------------------------------------

/** 固定種子的 rng（mulberry32）→ 生成統計可重現（同一個種子 → 同一串抽樣）。 */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 假世界：每一柱的地面頂面都在 y = 5（腳底 y = 6）、上方是空的。 */
const groundAt5 = (_x: number, y: number, _z: number): boolean => y <= 5;
/** 整數格座標？（真實的 `world.getBlock` **不會**自己 floor 格子內的座標 →
 *  實作必須自己 floor → 這個假世界把「沒 floor」變成「地面不對」→ 測試會紅）。 */
const isInt = (v: number): boolean => Number.isInteger(v);
/** 假世界：到處都是草地（**只有整數格座標**才回草 → 不整數 → 空氣）。 */
const grassEverywhere = (x: number, y: number, z: number): number =>
  isInt(x) && isInt(y) && isInt(z) ? BLOCK.GRASS : BLOCK.AIR;
/** 玩家站在地面上（腳底 y = 6）。 */
const player = { x: 0, y: 6, z: 0 };

/** 白天（0.25）＋ 平地草地的生成上下文。 */
function spawnCtxOf(over: Partial<PassiveSpawnCtx> = {}): PassiveSpawnCtx {
  return {
    light: clockLight(0.25), // 白天 → 亮度 15 ≥ 9 → 可以生成
    isSolidAt: groundAt5,
    blockIdAt: grassEverywhere,
    ...over,
  };
}

describe('trySpawnPassiveGroup（B4 Task 7：被動生物生成規則）', () => {
  it('passive mobs spawn in daylight on grass', () => {
    const out = trySpawnPassiveGroup([], player, spawnCtxOf({ rng: seeded(1) }));
    expect(out.length).toBeGreaterThanOrEqual(PASSIVE_SPAWN_MIN_GROUP);
    expect(out.length).toBeLessThanOrEqual(PASSIVE_SPAWN_MAX_GROUP);
    // 每隻都站在草地上（地表頂面 y = 5 → 腳底 y = 6）
    for (const m of out) expect(m.pos.y).toBe(6);
  });

  it('no passive mob spawns at night', () => {
    // 夜晚 → `clockLight` 的天空光 = 0 → 亮度不足 → 不生成（回**同一個參考**）
    const input: PassiveMob[] = [];
    const out = trySpawnPassiveGroup(input, player, spawnCtxOf({ light: clockLight(0.75), rng: seeded(1) }));
    expect(out).toBe(input);
    expect(out.length).toBe(0);
  });

  it('every spawned passive mob is at least 24 blocks from the player', () => {
    // **門檻與實作是同一組數字**：母點 28–48、成員偏移 ±2 → 最壞情況
    // 28 − √(2²+2²) ≈ 25.2 ≥ 24。
    for (let i = 0; i < 50; i++) {
      const out = trySpawnPassiveGroup([], player, spawnCtxOf({ rng: seeded(i + 1) }));
      expect(out.length).toBeGreaterThanOrEqual(PASSIVE_SPAWN_MIN_GROUP);
      for (const m of out) {
        expect(xzDistance(m.pos, player)).toBeGreaterThanOrEqual(PASSIVE_SPAWN_MIN_DIST);
      }
    }
  });

  it('the mother point is 28 blocks or more away (so members stay ≥ 24)', () => {
    // **母點距離的下界（28）與成員實際距離的下界（24）是兩條不同的規則**：
    // 這裡把母點那條釘住，上面那條釘住成員那條。
    for (let i = 0; i < 50; i++) {
      const mother = passiveMotherPoint(player, seeded(i + 1));
      expect(mother.dist).toBeGreaterThanOrEqual(PASSIVE_SPAWN_MOTHER_MIN_DIST);
      expect(mother.dist).toBeLessThanOrEqual(PASSIVE_SPAWN_MAX_DIST);
    }
  });

  it('the members stay within 2 blocks of the mother point', () => {
    // 同一個種子重播 → 母點是同一個（rng 的前兩抽）→ 逐一比對成員的偏移。
    for (let i = 0; i < 50; i++) {
      const seed = i + 1;
      const mother = passiveMotherPoint(player, seeded(seed));
      const out = trySpawnPassiveGroup([], player, spawnCtxOf({ rng: seeded(seed) }));
      expect(out.length).toBeGreaterThanOrEqual(PASSIVE_SPAWN_MIN_GROUP);
      for (const m of out) {
        expect(Math.abs(m.pos.x - mother.x)).toBeLessThanOrEqual(2);
        expect(Math.abs(m.pos.z - mother.z)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('a spawn group holds 2 to 4 mobs', () => {
    for (let i = 0; i < 100; i++) {
      const out = trySpawnPassiveGroup([], player, spawnCtxOf({ rng: seeded(i + 1) }));
      expect(out.length).toBeGreaterThanOrEqual(PASSIVE_SPAWN_MIN_GROUP);
      expect(out.length).toBeLessThanOrEqual(PASSIVE_SPAWN_MAX_GROUP);
    }
  });

  it('a group is all one kind', () => {
    // 一次生成的是**同一種類**的 2–4 隻
    for (let i = 0; i < 20; i++) {
      const out = trySpawnPassiveGroup([], player, spawnCtxOf({ rng: seeded(i + 1) }));
      expect(new Set(out.map((m) => m.kind)).size).toBe(1);
    }
  });

  it('the passive cap is 12', () => {
    const atCap = Array.from({ length: MAX_PASSIVE_MOBS }, (_, i) =>
      passive('cow', { pos: { x: i, y: 6, z: 0 } }),
    );
    const out = trySpawnPassiveGroup(atCap, player, spawnCtxOf({ rng: seeded(1) }));
    expect(out).toBe(atCap); // 達上限 → 不生成（同一個參考）
    // 差一隻 → 生成後**恰好 12**（整群被夾制：只補到上限，不會是 13–15）
    // → 2026-10-22 審查 I-1／controller 裁決：spec 的用語是「**全場**上限 12」
    //   ＝ 場上的總數永不超過 12；brief 原本的「變 12+」是措辭鬆散，不是設計意圖
    //   （12+ 會與存檔上限「只保留前 12 筆」衝突 → 最多 3 隻生物在存／讀之間消失）。
    const oneBelow = atCap.slice(0, MAX_PASSIVE_MOBS - 1);
    const more = trySpawnPassiveGroup(oneBelow, player, spawnCtxOf({ rng: seeded(1) }));
    expect(more).not.toBe(oneBelow);
    expect(more.length).toBe(MAX_PASSIVE_MOBS); // **恰好 12**（不是 12+）
  });

  it('the group is clamped so the total never passes 12', () => {
    // 從 10 隻開始 → 群最多 4 隻 → **只補到 12**（不會變成 14）
    const ten = Array.from({ length: 10 }, (_, i) =>
      passive('cow', { pos: { x: i, y: 6, z: 0 } }),
    );
    const out = trySpawnPassiveGroup(ten, player, spawnCtxOf({ rng: seeded(1) }));
    expect(out).not.toBe(ten);
    expect(out.length).toBe(MAX_PASSIVE_MOBS); // 恰好 12
    expect(ten.length).toBe(10); // 輸入沒有被改
    // 從 12 隻開始 → 達上限 → **回同一個參考**（不發起這一次嘗試）
    const twelve = ten.concat(
      Array.from({ length: MAX_PASSIVE_MOBS - ten.length }, (_, i) =>
        passive('pig', { pos: { x: i, y: 6, z: 0 } }),
      ),
    );
    expect(twelve.length).toBe(MAX_PASSIVE_MOBS);
    const blocked = trySpawnPassiveGroup(twelve, player, spawnCtxOf({ rng: seeded(1) }));
    expect(blocked).toBe(twelve);
  });

  it('the total never exceeds the cap (any input size, any group size)', () => {
    // **不變式釘子**：無論輸入幾隻、抽到多大的群，輸出的總數都 ≤ 上限
    // → 擋住未來任何路徑再把「全場上限」弄破。
    for (let n = 0; n <= MAX_PASSIVE_MOBS; n++) {
      const input = Array.from({ length: n }, (_, i) =>
        passive('cow', { pos: { x: i, y: 6, z: 0 } }),
      );
      for (let seed = 1; seed <= 20; seed++) {
        const out = trySpawnPassiveGroup(input, player, spawnCtxOf({ rng: seeded(seed) }));
        expect(out.length).toBeLessThanOrEqual(MAX_PASSIVE_MOBS);
        expect(out.length).toBeGreaterThanOrEqual(n); // 不會變少（也不會吃掉既有的）
      }
    }
  });

  it('no passive mob spawns on sand or stone', () => {
    const sandInput: PassiveMob[] = [];
    const sand = trySpawnPassiveGroup(sandInput, player, spawnCtxOf({ blockIdAt: () => BLOCK.SAND, rng: seeded(1) }));
    expect(sand).toBe(sandInput);
    const stoneInput: PassiveMob[] = [];
    const stone = trySpawnPassiveGroup(stoneInput, player, spawnCtxOf({ blockIdAt: () => BLOCK.STONE, rng: seeded(1) }));
    expect(stone).toBe(stoneInput);
  });

  it('no passive mob spawns under a low ceiling', () => {
    // 地表頂面 y = 5、其上 y = 6 有一塊石頭（天花板）→ 地面之上的空間是 0 格
    // → 連 1 格高的雞都塞不進去 → 不生成（同一個參考）。
    const isSolidAt = (_x: number, y: number, _z: number): boolean => y <= 6;
    const blockIdAt = (x: number, y: number, z: number): number => {
      if (!isInt(x) || !isInt(y) || !isInt(z)) return BLOCK.AIR;
      return y === 6 ? BLOCK.STONE : BLOCK.GRASS;
    };
    const input: PassiveMob[] = [];
    const out = trySpawnPassiveGroup(input, player, spawnCtxOf({ isSolidAt, blockIdAt, rng: seeded(1) }));
    expect(out).toBe(input);
    expect(out.length).toBe(0);
  });

  it('the spawned kinds are all one of the four', () => {
    for (let i = 0; i < 100; i++) {
      const out = trySpawnPassiveGroup([], player, spawnCtxOf({ rng: seeded(i + 1) }));
      for (const m of out) {
        expect(['chicken', 'pig', 'sheep', 'cow']).toContain(m.kind);
      }
    }
  });

  it('the spawn attempt never mutates the input list', () => {
    const input: PassiveMob[] = [passive('cow', { pos: { x: 3, y: 6, z: 3 } })];
    const before = JSON.stringify(input);
    const out = trySpawnPassiveGroup(input, player, spawnCtxOf({ rng: seeded(3) }));
    expect(JSON.stringify(input)).toBe(before);
    expect(out.length).toBeGreaterThanOrEqual(input.length + PASSIVE_SPAWN_MIN_GROUP);
    expect(out.length).toBeLessThanOrEqual(input.length + PASSIVE_SPAWN_MAX_GROUP);
  });
});

describe('B4 Task 7：被動生物生成的常數', () => {
  it('pins the spawn interval, the distance band and the group size', () => {
    expect(PASSIVE_SPAWN_INTERVAL_SEC).toBe(10);
    expect(PASSIVE_SPAWN_MIN_DIST).toBe(24); // spec 的硬下限（成員實際距離）
    expect(PASSIVE_SPAWN_MAX_DIST).toBe(48);
    expect(PASSIVE_SPAWN_MOTHER_MIN_DIST).toBe(28); // 母點距離的下界
    expect(PASSIVE_SPAWN_MIN_GROUP).toBe(2);
    expect(PASSIVE_SPAWN_MAX_GROUP).toBe(4);
  });
});
