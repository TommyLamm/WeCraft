/** Mob entities & AI: zombie (melee chaser) and skeleton (keep-distance
 *  shooter), plus their arrows (pure — no Three/DOM; the renderer lives in
 *  render/scene.ts). Follows the world/drops.ts pattern: plain entities,
 *  injected `isSolidAt` callback (no World import), NaN guards on every step.
 *
 *  Distances: STATE DECISIONS ARE XZ-ONLY (chase/retreat/wander bands ignore
 *  height), the zombie MELEE RANGE IS 3D (can swipe a player on a ledge).
 *  Physics mirrors player physics: gravity 32, direct velocity set, and an
 *  auto step-up — a jump impulse (8) when the forward probe is solid and the
 *  mob is grounded, which walks it over 1-block obstacles. Arrows are a
 *  separate, lazier projectile: gravity 9.8, 30 s lifetime. */

// ---- Tuning constants (Task 8) ----

/** XZ distance (blocks) at which a mob engages the player → chase/retreat. */
export const CHASE_RANGE = 16;
/** XZ distance beyond which a mob gives up and wanders (target cleared). */
export const WANDER_RANGE = 24;
/** 3D melee reach of the zombie, blocks. */
export const ATTACK_RANGE = 1.6;
/** Zombie swipe: damage and the 1.0 s gate before the next one. */
export const ZOMBIE_ATTACK_DAMAGE = 3;
export const ZOMBIE_ATTACK_COOLDOWN = 1.0;
/** Skeleton volley gate — reuses `attackCooldown` (settled in the plan). */
export const SKELETON_SHOOT_COOLDOWN = 2.0;
/** Skeleton keeps ~8 blocks: retreats below 7, approaches above 9. */
export const KEEP_DISTANCE = 8;
export const KEEP_MIN = 7;
export const KEEP_MAX = 9;
/** Horizontal speeds, blocks/s (settled: skeleton's wander matches the zombie's). */
export const ZOMBIE_CHASE_SPEED = 3.2;
export const SKELETON_CHASE_SPEED = 2.6;
export const WANDER_SPEED = 1.5;
/** Wander turns: fresh random heading with a 2–4 s countdown. */
export const WANDER_TURN_MIN = 2;
export const WANDER_TURN_MAX = 4;
/** Mob gravity — matches player physics (physics.ts GRAVITY 32). */
export const MOB_GRAVITY = 32;
/** Jump impulse when blocked front + grounded → auto step-up over 1 block. */
export const JUMP_IMPULSE = 8;
/** Knockback impulse (blocks/s) applied by `damageMob`; decays ×0.1^dt per
 *  second and clears below 0.1 (settle note: vel is overwritten by AI each
 *  step, so knockback rides its own `kbVel` field). */
export const KNOCKBACK_SPEED = 6;
export const KNOCKBACK_DECAY_PER_SEC = 0.1;
export const KNOCKBACK_MIN = 0.1;
/** Eye height used for arrow aim and the arrow→player hit sphere. */
export const EYE_OFFSET = 1.4;
/** Upward bias added before normalizing the shoot direction ("slight arc" —
 *  the actual drop comes from ARROW_GRAVITY in stepArrows, not from dir). */
export const SHOOT_ARC_BIAS = 0.15;
/** Arrow flight speed (blocks/s) and gravity (blocks/s², plan: 9.8). */
export const ARROW_SPEED = 40;
export const ARROW_GRAVITY = 9.8;
/** Seconds before an arrow despawns (never flies forever). */
export const ARROW_MAX_AGE = 30;
/** 3D radius around the player's eye point that an arrow hit registers in. */
export const ARROW_HIT_RADIUS = 0.6;
export const ARROW_DAMAGE = 2;
/** Night-spawn policy (main.ts uses these): tick every 5 s, cap 8 mobs,
 *  spawn 12–24 blocks out, despawn beyond 48 (no dayburn — distance only). */
export const SPAWN_INTERVAL_SEC = 5;
export const MAX_MOBS = 8;
export const SPAWN_MIN_DIST = 12;
export const SPAWN_MAX_DIST = 24;
export const DESPAWN_DISTANCE = 48;
/** Forward probe lead for the horizontal block test (≈ body half-width): the
 *  destination cell is checked this far ahead so the mob stops before its
 *  box visually clips into the wall. */
const PROBE_LEAD = 0.3;

export type MobKind = 'zombie' | 'skeleton';
export type MobState = 'wander' | 'chase' | 'retreat';

/** A mob standing in the world (feet-centre `pos`). Pure data — stepped by
 *  `stepMob`/`stepMobs`, rendered by render/scene.ts. */
export interface Mob {
  id: number;
  kind: MobKind;
  hp: number;
  /** `kind === 'skeleton'` — kept as a field so stepMob branches on one read. */
  ranged: boolean;
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  state: MobState;
  /** Seconds until the next attack/shoot is allowed (0 = ready); −dt per step. */
  attackCooldown: number;
  /** Wander heading (radians) + seconds until the next random turn. */
  wanderDir: number;
  wanderTimer: number;
  /** Last known player position while engaged; null while wandering. */
  target: { x: number; y: number; z: number } | null;
  /** Knockback impulse (blocks/s, horizontal), decaying ×0.1^dt — separate
   *  from `vel` because AI overwrites `vel` every step. */
  kbVel: { x: number; z: number };
}

/** One arrow in flight (plain entity, same file as its shooter). */
export interface Arrow {
  id: number;
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  age: number; // seconds since spawn
  ownerId: number; // mob id — carries through to the damage event
}

/** Events produced by one step: player damage (zombie swipe / arrow hit) or a
 *  skeleton volley the caller turns into an Arrow. */
export type MobEvent =
  | { type: 'damage'; target: 'player'; amount: number; mobId: number }
  | { type: 'shoot'; from: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number }; mobId: number };

/** `stepMob` context: player feet position, injected solidity (as in drops)
 *  and the frame's dt (cooldowns decrement by dt — no `now`, settle note). */
export interface MobCtx {
  playerPos: { x: number; y: number; z: number };
  isSolidAt: (x: number, y: number, z: number) => boolean;
  dt: number;
}

/** Monotonic id counter for `createMob` (module instance scope — unique
 *  across every spawn within one session, like drops' max+1 pattern). */
let nextMobId = -1;

/** Fresh mob at `pos` (copied): hp 20, wander state, ready to attack, a random
 *  wander heading with a 2–4 s countdown, zero velocity/knockback. Ids are
 *  monotonic per module instance (unique across spawns in one session). */
export function createMob(kind: MobKind, pos: { x: number; y: number; z: number }): Mob {
  nextMobId += 1;
  return {
    id: nextMobId,
    kind,
    hp: 20,
    ranged: kind === 'skeleton',
    pos: { x: pos.x, y: pos.y, z: pos.z }, // copy — never alias the caller's vector
    vel: { x: 0, y: 0, z: 0 },
    state: 'wander',
    attackCooldown: 0,
    wanderDir: Math.random() * Math.PI * 2,
    wanderTimer: WANDER_TURN_MIN + Math.random() * (WANDER_TURN_MAX - WANDER_TURN_MIN),
    target: null,
    kbVel: { x: 0, z: 0 },
  };
}

/** Horizontal (XZ) distance between two points — the metric every state
 *  decision uses (height never engages or disengages a mob). */
export function xzDistance(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** True when the mob has no hp left — callers filter these out of the list
 *  (no mob loot this phase: the body just disappears). */
export function isDead(m: Mob): boolean {
  return m.hp <= 0;
}

/** Apply `dmg` damage: returns a NEW mob with hp clamped ≥ 0. Non-finite or
 *  non-positive damage is a no-op (repo NaN-guard norm). `knockbackDir` (any
 *  horizontal vector — a 3D hit direction also fits, y is ignored — normalized
 *  internally) adds a `KNOCKBACK_SPEED` impulse along it: the direction the
 *  mob should fly AWAY from the hit. */
export function damageMob(
  m: Mob,
  dmg: number,
  knockbackDir?: { x: number; y?: number; z: number },
): Mob {
  const hp = Number.isFinite(dmg) && dmg > 0 ? Math.max(0, m.hp - dmg) : m.hp;
  const kbVel = { x: m.kbVel.x, z: m.kbVel.z };
  if (knockbackDir) {
    const len = Math.hypot(knockbackDir.x, knockbackDir.z);
    if (Number.isFinite(len) && len > 0) {
      kbVel.x += (knockbackDir.x / len) * KNOCKBACK_SPEED;
      kbVel.z += (knockbackDir.z / len) * KNOCKBACK_SPEED;
    }
  }
  return { ...m, hp, kbVel };
}

/** One AI + physics tick for a single mob — returns a NEW mob plus the events
 *  it produced (never mutates the input).
 *
 *  Order: NaN-guard dt → cooldowns tick → XZ-only state machine (with a
 *  16–24 hysteresis band so the chase/wander edge doesn't flicker) → attacks
 *  → desired horizontal velocity → gravity/step-up probe → knockback →
 *  integrate → landing sweep (drops.ts cell-sweep pattern, no tunnelling). */
export function stepMob(m: Mob, ctx: MobCtx): { mob: Mob; events: MobEvent[] } {
  const step = Number.isFinite(ctx.dt) && ctx.dt > 0 ? ctx.dt : 0;
  const events: MobEvent[] = [];

  const pos = { x: m.pos.x, y: m.pos.y, z: m.pos.z };
  const vel = { x: m.vel.x, y: m.vel.y, z: m.vel.z };
  const kbVel = { x: m.kbVel.x, z: m.kbVel.z };
  let state = m.state;
  let attackCooldown = Math.max(0, m.attackCooldown - step);
  let wanderDir = m.wanderDir;
  let wanderTimer = m.wanderTimer - step;

  const p = ctx.playerPos;
  const dx = p.x - pos.x;
  const dz = p.z - pos.z;
  const distXZ = Math.hypot(dx, dz);

  // ---- state (XZ-only) ----
  if (distXZ > WANDER_RANGE) {
    state = 'wander';
  } else if (distXZ <= CHASE_RANGE) {
    if (m.ranged) state = distXZ < KEEP_MIN ? 'retreat' : 'chase';
    else state = 'chase';
  } // else 16 < distXZ ≤ 24: keep the current state (hysteresis)
  const target = state === 'wander' ? null : { x: p.x, y: p.y, z: p.z };

  // ---- desired horizontal velocity ----
  let desX = 0;
  let desZ = 0;
  if (state === 'chase') {
    // skeleton holds its band: approach only beyond KEEP_MAX, stand ground inside it
    const inBand = m.ranged && distXZ <= KEEP_MAX;
    if (!inBand && distXZ > 0) {
      const speed = m.ranged ? SKELETON_CHASE_SPEED : ZOMBIE_CHASE_SPEED;
      desX = (dx / distXZ) * speed;
      desZ = (dz / distXZ) * speed;
    }
  } else if (state === 'retreat' && distXZ > 0) {
    const speed = SKELETON_CHASE_SPEED;
    desX = (-dx / distXZ) * speed;
    desZ = (-dz / distXZ) * speed;
  } else {
    if (wanderTimer <= 0) {
      wanderDir = Math.random() * Math.PI * 2;
      wanderTimer = WANDER_TURN_MIN + Math.random() * (WANDER_TURN_MAX - WANDER_TURN_MIN);
    }
    desX = Math.sin(wanderDir) * WANDER_SPEED;
    desZ = Math.cos(wanderDir) * WANDER_SPEED;
  }

  // ---- attacks ----
  if (!m.ranged) {
    const dist3D = Math.hypot(dx, p.y - pos.y, dz); // melee range counts height
    if (dist3D <= ATTACK_RANGE && attackCooldown <= 0) {
      events.push({ type: 'damage', target: 'player', amount: ZOMBIE_ATTACK_DAMAGE, mobId: m.id });
      attackCooldown = ZOMBIE_ATTACK_COOLDOWN;
    }
  } else if (distXZ <= CHASE_RANGE && attackCooldown <= 0) {
    const from = { x: pos.x, y: pos.y + EYE_OFFSET, z: pos.z };
    const aim = { x: p.x - from.x, y: p.y + EYE_OFFSET - from.y + SHOOT_ARC_BIAS, z: p.z - from.z };
    const len = Math.hypot(aim.x, aim.y, aim.z);
    const k = len > 0 && Number.isFinite(len) ? 1 / len : 0;
    events.push({
      type: 'shoot',
      from,
      dir: { x: aim.x * k, y: aim.y * k, z: aim.z * k },
      mobId: m.id,
    });
    attackCooldown = SKELETON_SHOOT_COOLDOWN;
  }

  // ---- physics: gravity / step-up probe ----
  const cx = Math.floor(pos.x);
  const cz = Math.floor(pos.z);
  const grounded = ctx.isSolidAt(cx, Math.floor(pos.y - 0.05), cz); // solid at feet

  let blocked = false;
  let stepUp = false; // blocked at FOOT level → jumpable (a 1-block step-up)
  const hSpeed = Math.hypot(desX, desZ);
  if (hSpeed > 0) {
    const lead = hSpeed * step + PROBE_LEAD;
    const nx = Math.floor(pos.x + (desX / hSpeed) * lead);
    const nz = Math.floor(pos.z + (desZ / hSpeed) * lead);
    const feetBlocked = ctx.isSolidAt(nx, Math.floor(pos.y + 0.1), nz);
    const headBlocked = ctx.isSolidAt(nx, Math.floor(pos.y + 1.5), nz);
    blocked = feetBlocked || headBlocked;
    stepUp = feetBlocked;
    if (blocked) {
      desX = 0;
      desZ = 0;
    }
  }

  if (grounded && vel.y <= 0) vel.y = 0;
  else vel.y -= MOB_GRAVITY * step;
  // auto step-up: the jump impulse is applied AFTER gravity so it stays exact;
  // a 2-high wall keeps the probe solid through the whole arc → falls back.
  if (stepUp && grounded) vel.y = JUMP_IMPULSE;

  vel.x = desX;
  vel.z = desZ;

  // ---- knockback: nudges the position, decays multiplicatively ----
  if (kbVel.x !== 0 || kbVel.z !== 0) {
    pos.x += kbVel.x * step;
    pos.z += kbVel.z * step;
    const decay = Math.pow(KNOCKBACK_DECAY_PER_SEC, step);
    kbVel.x *= decay;
    kbVel.z *= decay;
    if (Math.hypot(kbVel.x, kbVel.z) < KNOCKBACK_MIN) {
      kbVel.x = 0;
      kbVel.z = 0;
    }
  }

  // ---- integrate ----
  pos.x += vel.x * step;
  pos.z += vel.z * step;
  const prevY = pos.y;
  pos.y += vel.y * step;

  // landing: cell sweep from the previous feet cell down to the entered one —
  // the first solid cell wins, snap to its top face (drops.ts pattern, so a
  // fast fall can't tunnel through a floor).
  if (vel.y <= 0) {
    const toY = Math.floor(pos.y - 0.05);
    for (let cy = Math.floor(prevY - 0.05); cy >= toY; cy--) {
      if (!ctx.isSolidAt(Math.floor(pos.x), cy, Math.floor(pos.z))) continue;
      pos.y = cy + 1;
      vel.y = 0;
      break;
    }
  }

  return {
    mob: { ...m, pos, vel, state, attackCooldown, wanderDir, wanderTimer, target, kbVel },
    events,
  };
}

/** Step every mob with the same context — maps `stepMob` and concatenates the
 *  events (new array; inputs untouched). */
export function stepMobs(
  mobs: readonly Mob[],
  ctx: MobCtx,
): { mobs: Mob[]; events: MobEvent[] } {
  const out: Mob[] = [];
  const events: MobEvent[] = [];
  for (const m of mobs) {
    const res = stepMob(m, ctx);
    out.push(res.mob);
    for (const e of res.events) events.push(e);
  }
  return { mobs: out, events };
}

// ---- arrows ----

/** Append an arrow shot from `from` along `dir` (normalized internally to
 *  `ARROW_SPEED`) — max+1 id like drops, age 0, owner attached. */
export function spawnArrow(
  arrows: readonly Arrow[],
  from: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  ownerId: number,
): Arrow[] {
  let maxId = -1;
  for (const a of arrows) if (a.id > maxId) maxId = a.id;
  const len = Math.hypot(dir.x, dir.y, dir.z);
  const k = len > 0 && Number.isFinite(len) ? ARROW_SPEED / len : 0;
  return [
    ...arrows,
    {
      id: maxId + 1,
      pos: { x: from.x, y: from.y, z: from.z },
      vel: { x: dir.x * k, y: dir.y * k, z: dir.z * k },
      age: 0,
      ownerId,
    },
  ];
}

/** One projectile tick for every arrow → `{ arrows, events }` (new arrays).
 *
 *  Per arrow, in order: `dt` must be finite and > 0 (else step 0 — no NaN can
 *  poison a position); age ≥ 30 s despawns; gravity 9.8 on `vel.y`; then
 *  `pos += vel·dt`; the PLAYER IS CHECKED FIRST — within `ARROW_HIT_RADIUS`
 *  (0.6) of the player's EYE POINT (`playerPos.y + EYE_OFFSET`, the same point
 *  `stepMob` aims at) the arrow is consumed and emits damage 2; a solid cell
 *  at the arrow's position consumes it silently.
 *
 *  `isSolidAt` is injected (no World import) — water is NOT solid. */
export function stepArrows(
  arrows: readonly Arrow[],
  dt: number,
  isSolidAt: (x: number, y: number, z: number) => boolean,
  playerPos: { x: number; y: number; z: number },
): { arrows: Arrow[]; events: MobEvent[] } {
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const out: Arrow[] = [];
  const events: MobEvent[] = [];
  const eye = { x: playerPos.x, y: playerPos.y + EYE_OFFSET, z: playerPos.z };

  for (const a of arrows) {
    const age = a.age + step;
    if (age >= ARROW_MAX_AGE) continue; // despawned

    const pos = { x: a.pos.x, y: a.pos.y, z: a.pos.z };
    const vel = { x: a.vel.x, y: a.vel.y, z: a.vel.z };
    vel.y -= ARROW_GRAVITY * step;
    pos.x += vel.x * step;
    pos.y += vel.y * step;
    pos.z += vel.z * step;

    const d = Math.hypot(pos.x - eye.x, pos.y - eye.y, pos.z - eye.z);
    if (d <= ARROW_HIT_RADIUS) {
      events.push({ type: 'damage', target: 'player', amount: ARROW_DAMAGE, mobId: a.ownerId });
      continue; // consumed
    }
    if (isSolidAt(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z))) continue; // stuck

    out.push({ ...a, pos, vel, age });
  }
  return { arrows: out, events };
}

// ---- spawn selection (pure helpers; main.ts resolves the surface Y) ----

/** Candidate spawn XZ: uniform angle and a distance ∈ [12, 24] blocks from the
 *  player (rng injectable for deterministic tests; defaults to Math.random). */
export function findSpawnPos(
  playerPos: { x: number; y: number; z: number },
  rng: () => number = Math.random,
): { x: number; z: number } {
  const angle = rng() * Math.PI * 2;
  const dist = SPAWN_MIN_DIST + rng() * (SPAWN_MAX_DIST - SPAWN_MIN_DIST);
  return {
    x: playerPos.x + Math.sin(angle) * dist,
    z: playerPos.z + Math.cos(angle) * dist,
  };
}

/** 50/50 zombie or skeleton (rng injectable for deterministic tests). */
export function chooseSpawnKind(rng: () => number = Math.random): MobKind {
  return rng() < 0.5 ? 'zombie' : 'skeleton';
}
