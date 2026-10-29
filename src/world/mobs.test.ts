import { describe, it, expect } from 'vitest';
import {
  createMob,
  stepMob,
  stepMobs,
  stepSunBurn,
  damageMob,
  isDead,
  spawnArrow,
  stepArrows,
  findSpawnPos,
  xzDistance,
  SPAWN_MIN_DIST,
  SPAWN_MAX_DIST,
  DESPAWN_DISTANCE,
  MAX_MOBS,
  CHASE_RANGE,
  WANDER_RANGE,
  SKELETON_SHOOT_RANGE,
  ZOMBIE_CHASE_SPEED,
  SKELETON_CHASE_SPEED,
  SUN_BURN_SEC,
  SUN_BURN_DPS,
  type Mob,
  type MobEvent,
  type Arrow,
  type SunBurnCtx,
} from './mobs';

// ---- helpers -------------------------------------------------------------
/** Flat world: everything below y = 0 is solid (ground top face at y = 0). */
const flatGround = (_x: number, y: number, _z: number): boolean => y < 0;
/** No geometry at all — free air. */
const noGround = (): boolean => false;

function mob(over: Partial<Mob> = {}): Mob {
  return {
    id: 1,
    kind: 'zombie',
    hp: 20,
    ranged: false,
    pos: { x: 0.5, y: 0, z: 0.5 },
    vel: { x: 0, y: 0, z: 0 },
    state: 'wander',
    attackCooldown: 0,
    wanderDir: 0, // +z (sin 0 / cos 0) — deterministic in wander tests
    wanderTimer: 3,
    target: null,
    kbVel: { x: 0, z: 0 },
    burn: 0, // 白天燃燒的剩餘秒數（旗標）
    burnAcc: 0, // 已累積的燃燒傷害秒數
    ...over,
  };
}

const ctxOf = (
  playerPos: { x: number; y: number; z: number },
  dt: number,
  isSolidAt: (x: number, y: number, z: number) => boolean = flatGround,
) => ({ playerPos, isSolidAt, dt });

/** 白天燃燒的上下文（**獨立於 `MobCtx`**）：預設「露天 + 日光 + dt = 1」。 */
const sunCtxOf = (over: Partial<SunBurnCtx> = {}): SunBurnCtx => ({
  isDaylight: true,
  isSolidAt: () => false, // 頭頂無實心方塊 → 露天
  isWaterAt: () => false, // 腳下不是水
  dt: 1,
  ...over,
});

// ---- createMob -----------------------------------------------------------

describe('createMob', () => {
  it('creates a zombie with the default shape', () => {
    const m = createMob('zombie', { x: 1, y: 2, z: 3 });
    expect(m.kind).toBe('zombie');
    expect(m.hp).toBe(20);
    expect(m.ranged).toBe(false);
    expect(m.pos).toEqual({ x: 1, y: 2, z: 3 });
    expect(m.vel).toEqual({ x: 0, y: 0, z: 0 });
    expect(m.state).toBe('wander');
    expect(m.attackCooldown).toBe(0);
    expect(m.target).toBeNull();
    expect(m.kbVel).toEqual({ x: 0, z: 0 });
    expect(m.burn).toBe(0); // 未著火
    expect(m.burnAcc).toBe(0);
    expect(Number.isFinite(m.id)).toBe(true);
  });

  it('creates a skeleton with hp 20 and ranged: true', () => {
    const m = createMob('skeleton', { x: 0, y: 0, z: 0 });
    expect(m.kind).toBe('skeleton');
    expect(m.hp).toBe(20);
    expect(m.ranged).toBe(true);
  });

  it('gives each mob a unique, increasing id', () => {
    const ids = [
      createMob('zombie', { x: 0, y: 0, z: 0 }).id,
      createMob('zombie', { x: 0, y: 0, z: 0 }).id,
      createMob('skeleton', { x: 0, y: 0, z: 0 }).id,
    ];
    expect(new Set(ids).size).toBe(3);
    expect(ids[1]).toBeGreaterThan(ids[0]);
    expect(ids[2]).toBeGreaterThan(ids[1]);
  });

  it('copies pos (mutating the caller does not touch the mob)', () => {
    const pos = { x: 1, y: 2, z: 3 };
    const m = createMob('zombie', pos);
    pos.x = 99;
    expect(m.pos.x).toBe(1);
  });

  it('starts with a 2–4 s wander turn countdown and a finite heading', () => {
    for (let i = 0; i < 10; i++) {
      const m = createMob('zombie', { x: 0, y: 0, z: 0 });
      expect(m.wanderTimer).toBeGreaterThanOrEqual(2);
      expect(m.wanderTimer).toBeLessThan(4);
      expect(Number.isFinite(m.wanderDir)).toBe(true);
    }
  });
});

// ---- stepMob: zombie -----------------------------------------------------

describe('stepMob — zombie chase', () => {
  it('chases within 35 blocks: state chase, moves toward the player at 3.2 b/s', () => {
    const m = mob({ pos: { x: 0.5, y: 0, z: 0.5 } });
    const player = { x: 10.5, y: 0, z: 0.5 };
    const { mob: out, events } = stepMob(m, ctxOf(player, 0.5));
    expect(out.state).toBe('chase');
    expect(out.target).toEqual(player);
    expect(Math.hypot(out.vel.x, out.vel.z)).toBeCloseTo(3.2, 10);
    expect(out.vel.x).toBeCloseTo(3.2, 10); // straight at the player (+x)
    expect(out.pos.x).toBeCloseTo(0.5 + 3.2 * 0.5, 10); // direct velocity set
    expect(out.pos.y).toBeCloseTo(0, 10); // stays grounded on flat ground
    expect(events).toHaveLength(0); // out of melee range
  });

  it('state decisions are XZ-only: a player straight above still triggers chase', () => {
    const m = mob();
    const { mob: out } = stepMob(m, ctxOf({ x: 0.5, y: 8, z: 0.5 }, 0.1));
    expect(out.state).toBe('chase'); // XZ distance 0 ≤ 35
    expect(Math.hypot(out.vel.x, out.vel.z)).toBeCloseTo(0, 10); // no XZ direction
  });

  it('applies gravity 32 b/s² while airborne (semi-implicit Euler)', () => {
    const m = mob({ pos: { x: 0.5, y: 5, z: 0.5 } });
    const { mob: out } = stepMob(m, ctxOf({ x: 40, y: 5, z: 0.5 }, 0.1)); // far → wander
    expect(out.vel.y).toBeCloseTo(-3.2, 10);
    expect(out.pos.y).toBeCloseTo(5 - 0.32, 10);
    expect(Number.isFinite(out.pos.y)).toBe(true);
  });

  it('steps up a 1-block obstacle: jump impulse when blocked front + grounded', () => {
    // A single block at cell (2, 0, 0) sits in the chase path along z = 0.5.
    const isSolidAt = (x: number, y: number, z: number): boolean =>
      y < 0 || (y === 0 && x === 2 && z === 0);
    let m = mob({ pos: { x: 0.5, y: 0, z: 0.5 } });
    const player = { x: 10.5, y: 0, z: 0.5 };
    let maxY = 0;
    let jumped = false;
    for (let i = 0; i < 400; i++) {
      const res = stepMob(m, ctxOf(player, 0.05, isSolidAt));
      m = res.mob;
      maxY = Math.max(maxY, m.pos.y);
      if (m.vel.y > 1) jumped = true;
      expect(Number.isFinite(m.pos.x)).toBe(true);
    }
    expect(jumped).toBe(true); // the blocked-front + grounded case fired a jump
    expect(maxY).toBeGreaterThanOrEqual(0.9); // actually climbed onto the block
    expect(m.pos.x).toBeGreaterThan(4); // crossed the obstacle (stuck = ~1.7)
  });

  it('does not walk through a 2-block wall (blocked, airborne → falls back)', () => {
    const isSolidAt = (x: number, y: number, z: number): boolean =>
      y < 0 || (y === 0 && x === 2 && z === 0) || (y === 1 && x === 2 && z === 0);
    let m = mob({ pos: { x: 0.5, y: 0, z: 0.5 } });
    for (let i = 0; i < 200; i++) {
      m = stepMob(m, ctxOf({ x: 10.5, y: 0, z: 0.5 }, 0.05, isSolidAt)).mob;
    }
    expect(m.pos.x).toBeLessThan(2); // never got past the wall column
    expect(Number.isFinite(m.pos.y)).toBe(true);
  });

  it('the probe lead covers the body half-width (zombie cannot clip into a wall)', () => {
    // **探測距離要蓋到身體前端**（B4 分診②，與 `passive-mobs.ts` 的
    // `stepPassiveMob` 同款）：牆在 cell (2, *, 0)（牆面 x = 2）、殭屍中心距牆面
    // 0.35。渲染出來的身體寬 0.9（`MOB_WIDTHS`：身體 0.5＋手臂 0.25×2、×0.9 縮放
    // → 半寬 0.45 > 裸 `PROBE_LEAD` 0.3）。dt = 0.01 → 本步只前進 0.032：裸 0.3
    // 的探測點（1.982）仍在牆外格子 → 只有「蓋到半寬」的 lead（0.482）會命中牆。
    // **突變敏感**：把加寬改回 `PROBE_LEAD` → 殭屍前進插牆 → 本測試轉紅。
    const isSolidAt = (x: number, y: number, z: number): boolean =>
      y < 0 || (x === 2 && z === 0 && (y === 0 || y === 1));
    const m = mob({ pos: { x: 1.65, y: 0, z: 0.5 } });
    const player = { x: 20.5, y: 0, z: 0.5 }; // 遠 → chase，正對牆（+x）
    const { mob: out, events } = stepMob(m, ctxOf(player, 0.01, isSolidAt));
    expect(out.vel.x).toBe(0); // desX/desZ 歸零——探測命中
    expect(out.vel.z).toBe(0);
    expect(out.pos.x).toBe(1.65); // 原地擋住，沒有前進插牆
    expect(out.pos.z).toBe(0.5);
    expect(events).toHaveLength(0); // 18.85 格 > 近戰範圍 → 無事件
  });
});

describe('stepMob — zombie attack', () => {
  it('emits damage 3 within 1.6 blocks (3D) and gates it behind a 1.0 s cooldown', () => {
    const m = mob({ pos: { x: 0, y: 0, z: 0 } });
    const player = { x: 1, y: 0, z: 0 }; // 3D distance 1 ≤ 1.6

    const first = stepMob(m, ctxOf(player, 0.1));
    expect(first.events).toEqual([
      { type: 'damage', target: 'player', amount: 3, mobId: m.id },
    ]);
    expect(first.mob.attackCooldown).toBeCloseTo(1.0, 10);

    const second = stepMob(first.mob, ctxOf(player, 0.1));
    expect(second.events).toHaveLength(0); // still cooling down
    expect(second.mob.attackCooldown).toBeCloseTo(0.9, 10);

    // after the 1.0 s gate elapses, the swipe fires again
    let cur = second.mob;
    let shots = 0;
    for (let i = 0; i < 12; i++) {
      const res = stepMob(cur, ctxOf(player, 0.1));
      cur = res.mob;
      shots += res.events.length;
    }
    expect(shots).toBeGreaterThanOrEqual(1);
    expect(cur.attackCooldown).toBeGreaterThan(0); // and re-gated
  });

  it('counts vertical distance for the melee range', () => {
    const onLowGround = mob({ pos: { x: 0, y: 0, z: 0 } });
    const { events } = stepMob(onLowGround, ctxOf({ x: 0, y: 1.5, z: 0 }, 0.1));
    expect(events).toHaveLength(1); // 1.5 ≤ 1.6

    const highAbove = mob({ pos: { x: 0, y: 0, z: 0 } });
    const { events: none } = stepMob(highAbove, ctxOf({ x: 0, y: 5, z: 0 }, 0.1));
    expect(none).toHaveLength(0); // XZ 0 → chases, but 5 > 1.6 → no hit
  });

  it('stays quiet out of range', () => {
    const m = mob({ pos: { x: 0, y: 0, z: 0 } });
    const { events } = stepMob(m, ctxOf({ x: 3, y: 0, z: 0 }, 0.1));
    expect(events).toHaveLength(0);
  });
});

// ---- stepMob: skeleton ---------------------------------------------------

describe('stepMob — skeleton keep-distance', () => {
  it('the skeleton is faster than the zombie', () => {
    // 原版比例：骷髏 0.25 > 殭屍 0.23（約 1.087 倍）→ 本作 3.2 × 1.087 ≈ 3.5。
    expect(SKELETON_CHASE_SPEED).toBeGreaterThan(ZOMBIE_CHASE_SPEED);
    expect(SKELETON_CHASE_SPEED).toBe(3.5);
    expect(ZOMBIE_CHASE_SPEED).toBe(3.2);
  });

  it('retreats when closer than 7 blocks', () => {
    const m = mob({ kind: 'skeleton', ranged: true, pos: { x: 0, y: 0, z: 0 } });
    const { mob: out } = stepMob(m, ctxOf({ x: 5, y: 0, z: 0 }, 0.5));
    expect(out.state).toBe('retreat');
    expect(Math.hypot(out.vel.x, out.vel.z)).toBeCloseTo(3.5, 10);
    expect(out.vel.x).toBeLessThan(0); // away from the player at +x
    expect(out.pos.x).toBeCloseTo(-1.75, 10); // 3.5 b/s × 0.5 s
  });

  it('approaches when farther than 9 blocks (within 35)', () => {
    const m = mob({ kind: 'skeleton', ranged: true, pos: { x: 0, y: 0, z: 0 } });
    const { mob: out } = stepMob(m, ctxOf({ x: 12, y: 0, z: 0 }, 0.5));
    expect(out.state).toBe('chase');
    expect(out.vel.x).toBeCloseTo(3.5, 10); // faster than the zombie's 3.2
    expect(out.pos.x).toBeCloseTo(1.75, 10); // 3.5 b/s × 0.5 s
  });

  it('stops in the 7–9 band (holds distance ≈ 8)', () => {
    const m = mob({ kind: 'skeleton', ranged: true, pos: { x: 0, y: 0, z: 0 } });
    const { mob: out } = stepMob(m, ctxOf({ x: 8, y: 0, z: 0 }, 0.5));
    expect(out.state).toBe('chase');
    expect(out.vel.x).toBe(0);
    expect(out.vel.z).toBe(0);
    expect(out.pos).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('fires an arced shoot event every 2.0 s while within the 15-block shooting range', () => {
    const m = mob({ kind: 'skeleton', ranged: true, pos: { x: 0, y: 0, z: 0 } });
    const player = { x: 8, y: 0, z: 0 };

    const first = stepMob(m, ctxOf(player, 0.1));
    expect(first.events).toHaveLength(1);
    const ev = first.events[0] as Extract<MobEvent, { type: 'shoot' }>;
    expect(ev.type).toBe('shoot');
    expect(ev.mobId).toBe(m.id);
    expect(ev.from).toEqual({ x: 0, y: 1.4, z: 0 }); // eye height = pos + 1.4
    expect(ev.dir.x).toBeGreaterThan(0); // aimed at the player at +x
    expect(ev.dir.y).toBeGreaterThan(0); // slight upward arc bias
    expect(Math.hypot(ev.dir.x, ev.dir.y, ev.dir.z)).toBeCloseTo(1, 10); // normalized
    expect(first.mob.attackCooldown).toBeCloseTo(2.0, 10);

    // gate: nothing on the very next step
    let cur = first.mob;
    expect(stepMob(cur, ctxOf(player, 0.1)).events).toHaveLength(0);

    // 2.0 s later it shoots again (skeleton holds the band → stays in range)
    let total = first.events.length;
    for (let i = 0; i < 25; i++) {
      const res = stepMob(cur, ctxOf(player, 0.1));
      cur = res.mob;
      total += res.events.filter((e) => e.type === 'shoot').length;
    }
    expect(total).toBe(2); // one now + one after the 2.0 s gate, no more
  });

  it('does not shoot out of range', () => {
    const m = mob({ kind: 'skeleton', ranged: true, pos: { x: 0, y: 0, z: 0 } });
    // 超出射箭範圍（SKELETON_SHOOT_RANGE = 15）→ 不射箭
    const { events } = stepMob(m, ctxOf({ x: 40, y: 0, z: 0 }, 0.1));
    expect(events).toHaveLength(0);
  });

  it('shoots within the 15-block shooting range', () => {
    // 射箭範圍 15 格（wiki 查證的原版值）內 → 射箭
    const m = mob({ kind: 'skeleton', ranged: true, pos: { x: 0, y: 0, z: 0 } });
    const { events } = stepMob(m, ctxOf({ x: 10, y: 0, z: 0 }, 0.1));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('shoot');
  });

  it('does not shoot beyond 15 blocks but keeps chasing the player', () => {
    // 20 格：介於射箭範圍（15）與追擊範圍（35）之間 → **不射箭、但仍然追**。
    // （追擊 35 ≠ 射箭 15：原版是兩個獨立的量，見 Skeleton 條目。）
    const m = mob({ kind: 'skeleton', ranged: true, pos: { x: 0, y: 0, z: 0 } });
    const player = { x: 20, y: 0, z: 0 };
    const { mob: out, events } = stepMob(m, ctxOf(player, 0.1));
    expect(events).toHaveLength(0); // 射程外 → 不射
    expect(out.state).toBe('chase'); // 但仍在追（追擊範圍是 35）
    expect(out.target).toEqual(player);
  });

  it('the probe lead covers the body half-width (skeleton, same wall)', () => {
    // 與殭屍同一個牆面幾何（B4 分診②的對照案例）：骷髏同為 0.9 寬（`MOB_WIDTHS`），
    // 中心距牆面 0.35、dt = 0.01 → 追擊速度 3.5 本步前進 0.035：裸 `PROBE_LEAD`
    // 0.3 探測不到牆、蓋到半寬的 lead（0.485）才會 → 擋在原地，不插牆。
    const isSolidAt = (x: number, y: number, z: number): boolean =>
      y < 0 || (x === 2 && z === 0 && (y === 0 || y === 1));
    const m = mob({ kind: 'skeleton', ranged: true, pos: { x: 1.65, y: 0, z: 0.5 } });
    const player = { x: 20.5, y: 0, z: 0.5 }; // distXZ 18.85 > KEEP_MAX 9 → chase
    const { mob: out, events } = stepMob(m, ctxOf(player, 0.01, isSolidAt));
    expect(out.state).toBe('chase');
    expect(out.vel.x).toBe(0); // 探測命中 → 歸零
    expect(out.vel.z).toBe(0);
    expect(out.pos.x).toBe(1.65); // 原地擋住
    expect(events).toHaveLength(0); // 射程（15）外 → 也不射
  });
});

// ---- stepMob: wander & hysteresis ---------------------------------------

describe('stepMob — wander', () => {
  it('drops to wander beyond 40 blocks and clears the target', () => {
    const m = mob({ state: 'chase', target: { x: 1, y: 0, z: 1 } });
    const { mob: out } = stepMob(m, ctxOf({ x: 45, y: 0, z: 0 }, 0.1));
    expect(out.state).toBe('wander');
    expect(out.target).toBeNull();
  });

  it('walks the wander heading at 1.5 b/s', () => {
    const m = mob({ wanderDir: 0, wanderTimer: 3 }); // heading +z
    const { mob: out } = stepMob(m, ctxOf({ x: 40, y: 0, z: 40 }, 0.5));
    expect(out.state).toBe('wander');
    expect(out.pos.x).toBeCloseTo(0.5, 10);
    expect(out.pos.z).toBeCloseTo(0.5 + 1.5 * 0.5, 10);
    expect(out.wanderTimer).toBeCloseTo(2.5, 10);
  });

  it('turns with a fresh 2–4 s countdown when the timer runs out', () => {
    const m = mob({ wanderDir: 0, wanderTimer: 0.01 });
    const { mob: out } = stepMob(m, ctxOf({ x: 40, y: 0, z: 40 }, 0.1));
    expect(out.wanderTimer).toBeGreaterThanOrEqual(2);
    expect(out.wanderTimer).toBeLessThan(4);
    expect(Number.isFinite(out.wanderDir)).toBe(true);
  });

  it('keeps the current state inside the 35–40 hysteresis band', () => {
    const chasing = mob({ state: 'chase' });
    expect(stepMob(chasing, ctxOf({ x: 38, y: 0, z: 0 }, 0.1)).mob.state).toBe('chase');
    const wandering = mob({ state: 'wander' });
    expect(stepMob(wandering, ctxOf({ x: 38, y: 0, z: 0 }, 0.1)).mob.state).toBe('wander');
  });

  it('treats non-finite dt as 0 (no NaN poisoning)', () => {
    const m = mob({ wanderDir: 1, wanderTimer: 3 });
    const { mob: out } = stepMob(m, ctxOf({ x: 40, y: 0, z: 40 }, Number.NaN));
    expect(out.pos).toEqual({ x: 0.5, y: 0, z: 0.5 });
    expect(out.wanderTimer).toBe(3); // untouched
    expect(out.wanderDir).toBe(1);
    expect(Number.isFinite(out.vel.x)).toBe(true);
    const { mob: neg } = stepMob(m, ctxOf({ x: 40, y: 0, z: 40 }, -1));
    expect(neg.pos).toEqual({ x: 0.5, y: 0, z: 0.5 });
  });

  it('returns a copy — the input mob is never mutated', () => {
    const m = mob({ state: 'chase', attackCooldown: 0 });
    const res = stepMob(m, ctxOf({ x: 1, y: 0, z: 0 }, 0.1));
    expect(res.mob).not.toBe(m);
    expect(m.attackCooldown).toBe(0); // the attack on the copy left the input alone
    expect(m.pos).toEqual({ x: 0.5, y: 0, z: 0.5 });
    expect(m.state).toBe('chase');
  });
});

// ---- B4.4 追擊範圍 ↔ 生成距離（回歸釘子）-------------------------------
// 背景：B4 之前生成距離是 12–24、追擊範圍 16 → 生成在 12–16 的生物會直接追人。
// Task 5 把生成距離改成 24–128，**追擊範圍若還停在 16 就會小於最近生成距離** →
// 新生成的生物幾乎永遠走不進攻擊範圍、幾乎不會攻擊玩家（無聲的玩法回歸）。
// 原版的 follow range 是 35 格（wiki 2026-10-22：Zombie「pursue the player on sight
// from 35 blocks away」、`follow_range` base 35；Skeleton 同）→ 35 > 24，原版沒有
// 這個矛盾：生成在 24–35 的生物會直接來找玩家。

describe('B4.4 追擊範圍與生成距離', () => {
  it('the chase range is never smaller than the nearest spawn distance', () => {
    // **不變式釘子**（比逐值斷言更耐未來調整）：追擊範圍必須 ≥ 最近生成距離，
    // 否則生成出來的生物**不可能**走到攻擊範圍 → 永遠不會攻擊玩家。
    expect(CHASE_RANGE).toBeGreaterThanOrEqual(SPAWN_MIN_DIST);
    // 放棄追擊的距離也必須大於追擊範圍，否則 `distXZ > WANDER_RANGE` 會先攔截，
    // 追擊分支永遠走不到（遲滯帶必須存在）。
    expect(WANDER_RANGE).toBeGreaterThan(CHASE_RANGE);
  });

  it('a mob 30 blocks away chases the player (spawn distance band 24–35)', () => {
    const m = mob();
    const player = { x: 30.5, y: 0, z: 0.5 }; // XZ 距離 30（在 24–35 之間）
    const { mob: out } = stepMob(m, ctxOf(player, 0.1));
    expect(out.state).toBe('chase');
    expect(out.target).toEqual(player);
  });

  it('a mob 45 blocks away gives up and wanders', () => {
    const m = mob({ state: 'chase', target: { x: 1, y: 0, z: 1 } });
    const { mob: out } = stepMob(m, ctxOf({ x: 45.5, y: 0, z: 0.5 }, 0.1));
    expect(out.state).toBe('wander');
    expect(out.target).toBeNull();
  });
});

// ---- B4.4 射箭範圍 ↔ 追擊範圍（兩個獨立的量）---------------------------
// 原版 Skeleton 條目（wiki，2026-10-22 查證）：「When within **15 blocks** of a target,
// with a clear line of sight, a skeleton starts shooting arrows…」→ **射箭距離 15 格**；
// 而追擊／偵測是 `follow_range` = **35 格**（Zombie 條目）→ 原版兩者**互相獨立**。
// 本作先前把射箭條件綁在 `CHASE_RANGE` 上（原本 16 剛好接近 15、看不出問題），35 之後
// 就變成「從 35 格外射箭」→ 這是耦合缺陷，拆開。

describe('B4.4 射箭範圍與追擊範圍', () => {
  it('the shooting range is strictly smaller than the chase range', () => {
    // 不變式釘子：射箭 15 < 追擊 35（原版的關係）→ 擋住未來有人把兩者又綁在一起
    expect(SKELETON_SHOOT_RANGE).toBeLessThan(CHASE_RANGE);
    expect(SKELETON_SHOOT_RANGE).toBe(15);
    expect(CHASE_RANGE).toBe(35);
  });

  it('a zombie at 20 blocks still chases the player (the chase range stays 35)', () => {
    // 確認這次修正**沒有**把追擊範圍連帶改小：殭屍在 20 格（射箭範圍之外）仍然追。
    const m = mob();
    const player = { x: 20.5, y: 0, z: 0.5 };
    const { mob: out } = stepMob(m, ctxOf(player, 0.1));
    expect(out.state).toBe('chase');
    expect(out.target).toEqual(player);
  });
});

// ---- line of sight (review Minor #4) ------------------------------------

describe('line of sight', () => {
  const wallAt = (wx: number, yMax: number) => (x: number, y: number, z: number): boolean =>
    y < 0 || (x === wx && y >= 0 && y <= yMax && z === 0);

  it('a zombie behind a 1-block wall swipes nothing (the chase continues)', () => {
    const wall = wallAt(1, 2);
    const m = mob({ pos: { x: 0.9, y: 0, z: 0.5 } });
    const player = { x: 2.1, y: 0, z: 0.5 }; // 3D dist 1.2 ≤ 1.6 → in melee range

    const blocked = stepMob(m, ctxOf(player, 0.1, wall));
    expect(blocked.events).toHaveLength(0); // wall swallows the swipe
    expect(blocked.mob.state).toBe('chase'); // movement/AI untouched — it keeps coming

    // same geometry with open sky: LOS is the only difference → the swipe fires
    const clear = stepMob(m, ctxOf(player, 0.1, flatGround));
    expect(clear.events).toHaveLength(1);
  });

  it('a skeleton with terrain between emits no shoot event', () => {
    const wall = wallAt(4, 3);
    const m = mob({ kind: 'skeleton', ranged: true, pos: { x: 0, y: 0, z: 0 } });
    const player = { x: 8, y: 0, z: 0 }; // inside the 7–9 keep band → stands and (would) shoot

    expect(stepMob(m, ctxOf(player, 0.1, wall)).events).toHaveLength(0);
    // clear LOS unchanged: same setup on open ground fires exactly once
    expect(stepMob(m, ctxOf(player, 0.1, flatGround)).events).toHaveLength(1);
  });

  it('clear line of sight keeps attack behavior identical', () => {
    const swipe = stepMob(mob({ pos: { x: 0, y: 0, z: 0 } }), ctxOf({ x: 1, y: 0, z: 0 }, 0.1));
    expect(swipe.events).toEqual([
      { type: 'damage', target: 'player', amount: 3, mobId: swipe.mob.id },
    ]);
    const shot = stepMob(
      mob({ kind: 'skeleton', ranged: true, pos: { x: 0, y: 0, z: 0 } }),
      ctxOf({ x: 8, y: 0, z: 0 }, 0.1),
    );
    expect(shot.events).toHaveLength(1);
  });
});

// ---- stepMobs ------------------------------------------------------------

describe('stepMobs', () => {
  it('maps over the list and concatenates the events', () => {
    const a = mob({ id: 1, pos: { x: 0, y: 0, z: 0 } });
    const b = mob({ id: 2, pos: { x: 0, y: 0, z: 0.5 } });
    const input = [a, b];
    const { mobs: out, events } = stepMobs(input, ctxOf({ x: 1, y: 0, z: 0 }, 0.1));
    expect(out).toHaveLength(2);
    expect(out.map((m) => m.id)).toEqual([1, 2]);
    expect(events).toHaveLength(2); // both zombies swiped
    expect(events.every((e) => e.type === 'damage')).toBe(true);
    // pure: input array and entities untouched
    expect(input).toHaveLength(2);
    expect(a.attackCooldown).toBe(0);
    expect(b.attackCooldown).toBe(0);
  });

  it('returns an empty result for an empty list', () => {
    const { mobs, events } = stepMobs([], ctxOf({ x: 0, y: 0, z: 0 }, 0.1));
    expect(mobs).toEqual([]);
    expect(events).toEqual([]);
  });
});

// ---- damageMob -----------------------------------------------------------

describe('damageMob', () => {
  it('reduces hp, returns a copy and clamps at 0', () => {
    const m = mob();
    const hurt = damageMob(m, 5);
    expect(hurt.hp).toBe(15);
    expect(hurt).not.toBe(m);
    expect(m.hp).toBe(20); // input untouched
    expect(isDead(hurt)).toBe(false);

    const killed = damageMob(m, 50);
    expect(killed.hp).toBe(0); // clamped, never negative
    expect(isDead(killed)).toBe(true);
    expect(isDead(mob({ hp: 1 }))).toBe(false);
    expect(isDead(mob({ hp: 0 }))).toBe(true);
  });

  it('knocks the mob back along the normalized hit direction', () => {
    const m = mob();
    const knocked = damageMob(m, 5, { x: 0, z: 1 });
    expect(knocked.kbVel.x).toBeCloseTo(0, 10);
    expect(knocked.kbVel.z).toBeCloseTo(6, 10); // impulse 6 b/s
    expect(m.kbVel).toEqual({ x: 0, z: 0 }); // input untouched
  });

  it('applies and decays knockback during the next step, clearing it below 0.1', () => {
    const m = damageMob(mob({ wanderDir: 0 }), 5, { x: 0, z: 1 });
    const player = { x: 40, y: 0, z: 40 };
    const { mob: out } = stepMob(m, ctxOf(player, 0.1));
    expect(out.pos.z).toBeGreaterThan(0.5); // pushed +z by kbVel·dt
    expect(out.kbVel.z).toBeCloseTo(6 * Math.pow(0.1, 0.1), 10); // ×0.1^dt decay
    // tiny residual is cleared outright
    const tiny = stepMob(mob({ kbVel: { x: 0.05, z: 0 } }), ctxOf(player, 0.1));
    expect(tiny.mob.kbVel).toEqual({ x: 0, z: 0 });
  });

  it('never pushes the mob into a solid cell (knockback embed guard)', () => {
    // kb 6 b/s × 0.1 s → 0.5 + 0.6 = 1.1, i.e. destination cell x = 1.
    const wall = (x: number, y: number, _z: number): boolean => y < 0 || (x === 1 && y === 0);
    const embedded = stepMob(mob({ kbVel: { x: 6, z: 0 } }), ctxOf({ x: 40, y: 0, z: 40 }, 0.1, wall));
    expect(embedded.mob.pos.x).toBeCloseTo(0.5, 10); // kb step skipped — outside the wall
    expect(wall(Math.floor(embedded.mob.pos.x), Math.floor(embedded.mob.pos.y), Math.floor(embedded.mob.pos.z))).toBe(false);
    // control: same knockback with open ground does move the mob (the guard is what stopped it)
    const free = stepMob(mob({ kbVel: { x: 6, z: 0 } }), ctxOf({ x: 40, y: 0, z: 40 }, 0.1));
    expect(free.mob.pos.x).toBeCloseTo(1.1, 10);
  });

  it('without a direction there is no knockback; bad damage is a no-op', () => {
    expect(damageMob(mob(), 5).kbVel).toEqual({ x: 0, z: 0 });
    expect(damageMob(mob(), Number.NaN).hp).toBe(20);
    expect(damageMob(mob(), 0).hp).toBe(20);
    expect(damageMob(mob(), -3).hp).toBe(20);
    expect(damageMob(mob(), 5, { x: 0, z: 0 }).kbVel).toEqual({ x: 0, z: 0 });
  });
});

// ---- arrows --------------------------------------------------------------

describe('spawnArrow', () => {
  it('appends an arrow with unique ids, age 0 and the owner attached', () => {
    const two = spawnArrow(spawnArrow([], { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 7), {
      x: 1,
      y: 1,
      z: 1,
    }, { x: 0, y: 0, z: 1 }, 7);
    expect(two).toHaveLength(2);
    expect(two[1].id).toBeGreaterThan(two[0].id);
    expect(two[0].age).toBe(0);
    expect(two[0].ownerId).toBe(7);
    expect(two[0].pos).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('turns the aim direction into an ARROW_SPEED velocity (normalized × speed)', () => {
    const [a] = spawnArrow([], { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 2 }, 1);
    expect(a.vel.z).toBeCloseTo(40, 10); // 40 b/s along the (unnormalized) aim
    expect(Math.hypot(a.vel.x, a.vel.y, a.vel.z)).toBeCloseTo(40, 10);
  });

  it('copies from — mutating the caller does not touch the arrow', () => {
    const from = { x: 1, y: 2, z: 3 };
    const [a] = spawnArrow([], from, { x: 1, y: 0, z: 0 }, 1);
    from.x = 99;
    expect(a.pos.x).toBe(1);
  });
});

describe('stepArrows', () => {
  it('falls with gravity 9.8 b/s² and integrates position', () => {
    const arrow: Arrow = {
      id: 0,
      pos: { x: 0, y: 10, z: 0 },
      vel: { x: 10, y: 0, z: 0 },
      age: 0,
      ownerId: 1,
    };
    const { arrows } = stepArrows([arrow], 0.1, noGround, { x: 100, y: 0, z: 0 });
    expect(arrows[0].vel.y).toBeCloseTo(-0.98, 10); // 9.8 × 0.1
    expect(arrows[0].pos.x).toBeCloseTo(1, 10);
    expect(arrows[0].pos.y).toBeCloseTo(10 - 0.098, 10);
    expect(arrows[0].age).toBeCloseTo(0.1, 10);
  });

  it('despawns on solid impact', () => {
    const falling: Arrow = {
      id: 0,
      pos: { x: 0.5, y: 0.1, z: 0.5 },
      vel: { x: 0, y: -5, z: 0 },
      age: 0,
      ownerId: 1,
    };
    const { arrows, events } = stepArrows([falling], 0.1, flatGround, { x: 50, y: 0, z: 0 });
    expect(arrows).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('hits the player (0.6 around the eye point) → damage 2 event, arrow removed', () => {
    const player = { x: 0, y: 0, z: 0 };
    const near: Arrow = {
      id: 0,
      pos: { x: 0.2, y: 1.5, z: 0.2 },
      vel: { x: 0, y: 0, z: 0 },
      age: 0,
      ownerId: 7,
    };
    const { arrows, events } = stepArrows([near], 0.1, noGround, player);
    expect(arrows).toHaveLength(0);
    expect(events).toEqual([
      { type: 'damage', target: 'player', amount: 2, mobId: 7 },
    ]);

    const far: Arrow = { ...near, pos: { x: 3, y: 1.4, z: 0 } };
    const kept = stepArrows([far], 0.1, noGround, player);
    expect(kept.arrows).toHaveLength(1); // outside the 0.6 radius
    expect(kept.events).toHaveLength(0);
  });

  it('despawns arrows at age ≥ 30 s', () => {
    const mk = (age: number): Arrow => ({
      id: 0,
      pos: { x: 0, y: 30, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      age,
      ownerId: 1,
    });
    expect(stepArrows([mk(29.9)], 0.2, noGround, { x: 99, y: 0, z: 0 }).arrows).toHaveLength(0);
    expect(stepArrows([mk(29)], 0.5, noGround, { x: 99, y: 0, z: 0 }).arrows).toHaveLength(1);
  });

  it('treats non-finite dt as 0 (no NaN poisoning)', () => {
    const a: Arrow = {
      id: 0,
      pos: { x: 1, y: 2, z: 3 },
      vel: { x: 5, y: 5, z: 5 },
      age: 1,
      ownerId: 1,
    };
    const { arrows } = stepArrows([a], Number.NaN, noGround, { x: 99, y: 0, z: 0 });
    expect(arrows[0].pos).toEqual({ x: 1, y: 2, z: 3 });
    expect(arrows[0].vel).toEqual({ x: 5, y: 5, z: 5 });
    expect(arrows[0].age).toBe(1);
    expect(Number.isFinite(arrows[0].pos.x)).toBe(true);
  });

  it('returns new arrays — the input is untouched', () => {
    const input: Arrow[] = [
      { id: 0, pos: { x: 1, y: 5, z: 1 }, vel: { x: 0, y: 0, z: 0 }, age: 0, ownerId: 1 },
    ];
    const { arrows } = stepArrows(input, 0.1, noGround, { x: 99, y: 0, z: 0 });
    expect(arrows).not.toBe(input);
    expect(arrows[0]).not.toBe(input[0]);
    expect(input[0].age).toBe(0);
  });

  it('sweeps a 4-block step: a 1-block wall mid-flight consumes the arrow', () => {
    // speed 40 × dt 0.1 → the arrow advances 4 blocks in ONE tick; the wall at
    // cell x = 2 sits in the middle (an endpoint-only check sees only x ≈ 4.5
    // and would let the arrow tunnel straight through).
    const wall = (x: number, y: number, z: number): boolean =>
      y < 0 || (x === 2 && y === 1 && z === 0);
    const flying: Arrow = {
      id: 0,
      pos: { x: 0.5, y: 1.4, z: 0.5 },
      vel: { x: 40, y: 0, z: 0 },
      age: 0,
      ownerId: 1,
    };
    const { arrows, events } = stepArrows([flying], 0.1, wall, { x: 50, y: 0, z: 0 });
    expect(arrows).toHaveLength(0); // stuck in the wall, not past it
    expect(events).toHaveLength(0); // and nothing beyond the wall was hit
  });

  it('registers a grazing hit at ~0.5 perpendicular distance (segment, not endpoint)', () => {
    // The path skims the eye point (0, 1.4, 0) at ~0.5 in z; BOTH endpoints sit
    // ~2 blocks away, so an endpoint-only check would miss this at dt = 0.1.
    const player = { x: 0, y: 0, z: 0 };
    const grazing: Arrow = {
      id: 0,
      pos: { x: -2, y: 1.4, z: 0.5 },
      vel: { x: 40, y: 0, z: 0 },
      age: 0,
      ownerId: 3,
    };
    const { arrows, events } = stepArrows([grazing], 0.1, noGround, player);
    expect(events).toEqual([
      { type: 'damage', target: 'player', amount: 2, mobId: 3 },
    ]);
    expect(arrows).toHaveLength(0);
  });

  it('checks solid BEFORE the player: a wall cell next to the eye consumes silently', () => {
    // Arrow ends at ≈ (-0.57, 1.33, 0.01) — inside solid cell (-1, 1, 0), which
    // is adjacent to the eye cell (0, 1, 0) and within the 0.6 hit radius.
    // Solid-first (the player AABB never occupies a solid cell) → stuck, no damage.
    const wall = (x: number, y: number, z: number): boolean =>
      x === -1 && y === 1 && z === 0;
    const intoWall: Arrow = {
      id: 0,
      pos: { x: -0.57, y: 1.4, z: -0.42 },
      vel: { x: 0, y: 0, z: 6.5 },
      age: 0,
      ownerId: 5,
    };
    const { arrows, events } = stepArrows([intoWall], 0.1, wall, { x: 0, y: 0, z: 0 });
    expect(arrows).toHaveLength(0);
    expect(events).toHaveLength(0); // wall hit wins over the eye-range hit
  });
});

// ---- spawn helpers -------------------------------------------------------

describe('findSpawnPos', () => {
  it('returns a candidate 24-128 blocks from the player (injected rng)', () => {
    // rng → 0.5: angle π, distance 24 + 0.5·104 = 76
    const spot = findSpawnPos({ x: 10, y: 64, z: -5 }, () => 0.5);
    expect(spot.x).toBeCloseTo(10, 10); // sin π → 0
    expect(spot.z).toBeCloseTo(-81, 10); // cos π → −z（-5 - 76）
    expect(Math.hypot(spot.x - 10, spot.z + 5)).toBeCloseTo(76, 10);
  });

  it('stays inside the 24-128 band for any rng draw', () => {
    for (let i = 0; i < 50; i++) {
      const spot = findSpawnPos({ x: 0, y: 0, z: 0 });
      const d = Math.hypot(spot.x, spot.z);
      expect(d).toBeGreaterThanOrEqual(24);
      expect(d).toBeLessThanOrEqual(128);
      expect(Number.isFinite(spot.x)).toBe(true);
      expect(Number.isFinite(spot.z)).toBe(true);
    }
  });
});

describe('xzDistance', () => {
  it('measures horizontal distance only', () => {
    expect(xzDistance({ x: 0, y: 99, z: 0 }, { x: 3, y: 0, z: 4 })).toBe(5);
  });
});

// ---- B4.4 敵對對齊的常數（生成距離／上限／despawn／燃燒）----------------

describe('B4.4 對齊常數', () => {
  it('spawns 24-128 blocks out, caps at 12 mobs and despawns past 128', () => {
    expect(SPAWN_MIN_DIST).toBe(24);
    expect(SPAWN_MAX_DIST).toBe(128);
    expect(MAX_MOBS).toBe(12);
    expect(DESPAWN_DISTANCE).toBe(128);
  });

  it('the sun-burn constants are the flag value 8 s and 1 hp per second', () => {
    expect(SUN_BURN_SEC).toBe(8); // 旗標值（不是已查證的 wiki 數字）
    expect(SUN_BURN_DPS).toBe(1);
  });
});

// ---- 白天燃燒（stepSunBurn）--------------------------------------------

describe('stepSunBurn — 白天燃燒', () => {
  it('a zombie burns in direct sunlight under an open sky', () => {
    const out = stepSunBurn(mob(), sunCtxOf({ isDaylight: true, dt: 1 }));
    expect(out.burn).toBeGreaterThan(0); // 正在燃燒
    expect(out.burn).toBe(SUN_BURN_SEC);
    expect(out.hp).toBe(19); // 1 秒燃燒 = 1 點血
    expect(out.burnAcc).toBe(0); // 整秒已結算，餘數歸零
  });

  it('a zombie under a solid roof does not burn', () => {
    // 屋簷 = **頭頂正上方那一格**：fixture 的腳底在 y = 0 → 身體占 y=0、y=1（y=1 是
    // 牠自己的頭格），屋簷的方塊放在 y=2（腳底 +2）。2026-10-22 審查：先前只查
    // `head`（y=1，生物自己的頭格、幾乎恆為空氣）→ 屋簷下照樣被燒死。
    const out = stepSunBurn(mob(), sunCtxOf({ isSolidAt: (_x, y) => y === 2, dt: 1 }));
    expect(out.burn).toBe(0);
    expect(out.hp).toBe(20);
  });

  it('a zombie with the roof one block higher still burns', () => {
    // 屋簷在**再高一格**（腳底 +3 = y=3）→ 太陽仍然照得到 → 會燃燒
    // （證明遮蔽不是「上面任一格有方塊就不燃」）。
    const out = stepSunBurn(mob(), sunCtxOf({ isSolidAt: (_x, y) => y === 3, dt: 1 }));
    expect(out.burn).toBeGreaterThan(0);
    expect(out.hp).toBe(19);
  });

  it('a zombie with a solid block in its own head cell does not burn', () => {
    // 頭格（腳底 +1 = y=1）本身就是實心方塊 → 生物卡在方塊裡 → 不點燃。
    const out = stepSunBurn(mob(), sunCtxOf({ isSolidAt: (_x, y) => y === 1, dt: 1 }));
    expect(out.burn).toBe(0);
    expect(out.hp).toBe(20);
  });

  it('the roof cell follows the head cell, not the raw feet height', () => {
    // 腳底 6.9（下落中的非整數腳底）→ 頭格 = floor(6.9 + 1.9) = 8 → 屋簷在 9。
    // 用 `floor(pos.y + 2)` 會算成 8（＝頭格）→ 屋簷判定會錯一格。
    const high = mob({ pos: { x: 0.5, y: 6.9, z: 0.5 } });
    const roofed = stepSunBurn(high, sunCtxOf({ isSolidAt: (_x, y) => y === 9, dt: 1 }));
    expect(roofed.burn).toBe(0);
    expect(roofed.hp).toBe(20);
    // 再高一格（y = 10）→ 照得到 → 燃燒
    const open = stepSunBurn(high, sunCtxOf({ isSolidAt: (_x, y) => y === 10, dt: 1 }));
    expect(open.burn).toBeGreaterThan(0);
    expect(open.hp).toBe(19);
  });

  it('a zombie in water does not burn', () => {
    const out = stepSunBurn(mob(), sunCtxOf({ isWaterAt: () => true, dt: 1 }));
    expect(out.burn).toBe(0);
    expect(out.hp).toBe(20);
  });

  it('a zombie at night does not burn', () => {
    const out = stepSunBurn(mob(), sunCtxOf({ isDaylight: false, dt: 1 }));
    expect(out.burn).toBe(0);
    expect(out.hp).toBe(20);
  });

  it('burning stops when the sun goes down', () => {
    const lit = stepSunBurn(mob(), sunCtxOf({ dt: 1 }));
    expect(lit.burn).toBeGreaterThan(0);
    let cur = lit;
    for (let i = 0; i < 9; i++) {
      cur = stepSunBurn(cur, sunCtxOf({ isDaylight: false, dt: 1 }));
    }
    expect(cur.burn).toBe(0); // 8 秒的燃燒旗標用完 → 熄火
    expect(cur.hp).toBe(19); // 熄火後不再掉血
  });

  it('a skeleton burns in daylight too', () => {
    const out = stepSunBurn(mob({ kind: 'skeleton', ranged: true }), sunCtxOf({ dt: 1 }));
    expect(out.burn).toBeGreaterThan(0);
    expect(out.hp).toBe(19);
  });

  it('the input mob is never mutated (pure function)', () => {
    const m = mob();
    const out = stepSunBurn(m, sunCtxOf({ dt: 1 }));
    expect(out).not.toBe(m);
    expect(m.hp).toBe(20);
    expect(m.burn).toBe(0);
    expect(m.burnAcc).toBe(0);
  });
});
