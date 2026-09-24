import { describe, it, expect } from 'vitest';
import {
  createMob,
  stepMob,
  stepMobs,
  damageMob,
  isDead,
  spawnArrow,
  stepArrows,
  findSpawnPos,
  chooseSpawnKind,
  trySpawnMob,
  xzDistance,
  SPAWN_MIN_DIST,
  SPAWN_MAX_DIST,
  MAX_MOBS,
  type Mob,
  type MobEvent,
  type Arrow,
} from './mobs';
import { BLOCK } from './blocks';

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
    ...over,
  };
}

const ctxOf = (
  playerPos: { x: number; y: number; z: number },
  dt: number,
  isSolidAt: (x: number, y: number, z: number) => boolean = flatGround,
) => ({ playerPos, isSolidAt, dt });

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
  it('chases within 16 blocks: state chase, moves toward the player at 3.2 b/s', () => {
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
    expect(out.state).toBe('chase'); // XZ distance 0 ≤ 16
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
  it('retreats when closer than 7 blocks', () => {
    const m = mob({ kind: 'skeleton', ranged: true, pos: { x: 0, y: 0, z: 0 } });
    const { mob: out } = stepMob(m, ctxOf({ x: 5, y: 0, z: 0 }, 0.5));
    expect(out.state).toBe('retreat');
    expect(Math.hypot(out.vel.x, out.vel.z)).toBeCloseTo(2.6, 10);
    expect(out.vel.x).toBeLessThan(0); // away from the player at +x
    expect(out.pos.x).toBeCloseTo(-1.3, 10);
  });

  it('approaches when farther than 9 blocks (within 16)', () => {
    const m = mob({ kind: 'skeleton', ranged: true, pos: { x: 0, y: 0, z: 0 } });
    const { mob: out } = stepMob(m, ctxOf({ x: 12, y: 0, z: 0 }, 0.5));
    expect(out.state).toBe('chase');
    expect(out.vel.x).toBeCloseTo(2.6, 10); // slower than the zombie's 3.2
    expect(out.pos.x).toBeCloseTo(1.3, 10);
  });

  it('stops in the 7–9 band (holds distance ≈ 8)', () => {
    const m = mob({ kind: 'skeleton', ranged: true, pos: { x: 0, y: 0, z: 0 } });
    const { mob: out } = stepMob(m, ctxOf({ x: 8, y: 0, z: 0 }, 0.5));
    expect(out.state).toBe('chase');
    expect(out.vel.x).toBe(0);
    expect(out.vel.z).toBe(0);
    expect(out.pos).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('fires an arced shoot event every 2.0 s while within 16 blocks', () => {
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
    const { events } = stepMob(m, ctxOf({ x: 20, y: 0, z: 0 }, 0.1));
    expect(events).toHaveLength(0);
  });
});

// ---- stepMob: wander & hysteresis ---------------------------------------

describe('stepMob — wander', () => {
  it('drops to wander beyond 24 blocks and clears the target', () => {
    const m = mob({ state: 'chase', target: { x: 1, y: 0, z: 1 } });
    const { mob: out } = stepMob(m, ctxOf({ x: 30, y: 0, z: 0 }, 0.1));
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

  it('keeps the current state inside the 16–24 hysteresis band', () => {
    const chasing = mob({ state: 'chase' });
    expect(stepMob(chasing, ctxOf({ x: 20, y: 0, z: 0 }, 0.1)).mob.state).toBe('chase');
    const wandering = mob({ state: 'wander' });
    expect(stepMob(wandering, ctxOf({ x: 20, y: 0, z: 0 }, 0.1)).mob.state).toBe('wander');
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
  it('returns a candidate 12–24 blocks from the player (injected rng)', () => {
    // rng → 0.5: angle π, distance 12 + 0.5·12 = 18
    const spot = findSpawnPos({ x: 10, y: 64, z: -5 }, () => 0.5);
    expect(spot.z).toBeCloseTo(-5 - 18, 10); // cos π → −z
    expect(Math.hypot(spot.x - 10, spot.z + 5)).toBeCloseTo(18, 10);
  });

  it('stays inside the 12–24 band for any rng draw', () => {
    for (let i = 0; i < 50; i++) {
      const spot = findSpawnPos({ x: 0, y: 0, z: 0 });
      const d = Math.hypot(spot.x, spot.z);
      expect(d).toBeGreaterThanOrEqual(12);
      expect(d).toBeLessThanOrEqual(24);
      expect(Number.isFinite(spot.x)).toBe(true);
      expect(Number.isFinite(spot.z)).toBe(true);
    }
  });
});

describe('chooseSpawnKind', () => {
  it('maps the rng onto both kinds (injected rng)', () => {
    expect(chooseSpawnKind(() => 0)).toBe('zombie');
    expect(chooseSpawnKind(() => 0.49)).toBe('zombie');
    expect(chooseSpawnKind(() => 0.5)).toBe('skeleton');
    expect(chooseSpawnKind(() => 0.99)).toBe('skeleton');
  });
});

describe('trySpawnMob', () => {
  /** Flat column: top solid block at y = 5 for every XZ (surface Y → 6). */
  const surface = (_x: number, y: number, _z: number): boolean => y <= 5;
  const ctxOf = (over: Partial<Parameters<typeof trySpawnMob>[2]> = {}) => ({
    isNight: true,
    isSolidAt: surface,
    blockIdAt: () => BLOCK.DIRT, // any non-bedrock id
    rng: () => 0.5, // angle π, distance 18 → spot (≈0, −18); kind → skeleton
    ...over,
  });
  const player = { x: 0, y: 0, z: 0 };

  it('spawns at night under the cap on a valid surface', () => {
    const spawned = trySpawnMob([], player, ctxOf());
    expect(spawned).not.toBeNull();
    expect(spawned!.kind).toBe('skeleton');
    expect(spawned!.pos.y).toBe(6); // top solid (5) + 1
    expect(spawned!.pos.x).toBeCloseTo(0, 5); // rng 0.5 → angle π → −z axis
    expect(spawned!.pos.z).toBeCloseTo(-18, 10);
    const dist = xzDistance(spawned!.pos, player);
    expect(dist).toBeGreaterThanOrEqual(SPAWN_MIN_DIST);
    expect(dist).toBeLessThanOrEqual(SPAWN_MAX_DIST);
  });

  it('never spawns in day', () => {
    expect(trySpawnMob([], player, ctxOf({ isNight: false }))).toBeNull();
  });

  it('never spawns once the cap is reached', () => {
    const atCap = Array.from({ length: MAX_MOBS }, (_, i) =>
      createMob('zombie', { x: i, y: 6, z: 0 }),
    );
    expect(trySpawnMob(atCap, player, ctxOf())).toBeNull();
    // one below the cap spawns again
    expect(trySpawnMob(atCap.slice(0, MAX_MOBS - 1), player, ctxOf())).not.toBeNull();
  });

  it('skips bedrock-only and ungenerated columns (no spawn)', () => {
    const bedrock = trySpawnMob([], player, ctxOf({ blockIdAt: () => BLOCK.BEDROCK }));
    expect(bedrock).toBeNull();
    const ungenerated = trySpawnMob(
      [],
      player,
      ctxOf({ isSolidAt: () => false, blockIdAt: () => BLOCK.AIR }),
    );
    expect(ungenerated).toBeNull();
  });
});

describe('xzDistance', () => {
  it('measures horizontal distance only', () => {
    expect(xzDistance({ x: 0, y: 99, z: 0 }, { x: 3, y: 0, z: 4 })).toBe(5);
  });
});
