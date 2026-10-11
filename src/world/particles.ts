import { getBlockDef } from './blocks';

/** A short-lived visual particle (pure — no Three/DOM). Rendering is a
 *  billboard quad per particle in render/particles.ts; `tile` is the block
 *  texture-array layer it samples (the block's side tile, so debris reads as
 *  the block that spawned it). */
export interface Particle {
  id: number;
  tile: number;
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  life: number; // seconds left
  maxLife: number; // life at spawn (renderers may fade over life/maxLife later)
  size: number; // world-space quad edge, blocks
}

/** Hard cap on live particles; `stepParticles` drops the OLDEST past this. */
export const MAX_PARTICLES = 200;

// ---- Tuning (Task 4 spec values) ----

/** Particles per block break. */
const BREAK_BURST_COUNT = 12;
const BREAK_SIZE_MIN = 0.08;
const BREAK_SIZE_MAX = 0.16;
const BREAK_LIFE_MIN = 0.6;
const BREAK_LIFE_MAX = 1.2;
/** Horizontal (xz) speed and upward pop of a break burst, blocks/s. */
const BREAK_HSPEED_MIN = 1.5;
const BREAK_HSPEED_MAX = 3.5;
const BREAK_VY_MIN = 2;
const BREAK_VY_MAX = 5;

/** Particles per dig-chip batch (one batch per ~0.1 s of dig progress). */
const DIG_CHIP_COUNT = 2;
const DIG_CHIP_LIFE_MIN = 0.3;
const DIG_CHIP_LIFE_MAX = 0.5;
/** 3D speed of a chip, blocks/s. */
const DIG_CHIP_SPEED_MIN = 1;
const DIG_CHIP_SPEED_MAX = 2;
/** Chips are smaller than break debris (design choice — the brief fixes no
 *  chip size, only that particles exist and read as the dug block). */
const DIG_CHIP_SIZE_MIN = 0.06;
const DIG_CHIP_SIZE_MAX = 0.12;

/** Particle gravity, blocks/s² — same feel as dropped items (drops.ts GRAVITY). */
const PARTICLE_GRAVITY = 20;

const rand = (rng: () => number, min: number, max: number): number =>
  min + rng() * (max - min);

/** Next free id: max+1 over the existing list (same scheme as spawnDrop). */
function nextId(list: readonly Particle[]): number {
  let max = -1;
  for (const p of list) if (p.id > max) max = p.id;
  return max + 1;
}

/** Break a block: append a 12-particle burst that pops radially outward with
 *  a random upward kick, all at `pos` (callers pass the block centre) and all
 *  textured with the block's side tile. Returns a NEW array — the input list
 *  is never mutated; `rng` is injectable so tests pin the ranges. */
export function spawnBreakBurst(
  list: readonly Particle[],
  blockId: number,
  pos: { x: number; y: number; z: number },
  rng: () => number = Math.random,
): Particle[] {
  const tile = getBlockDef(blockId).side;
  const out: Particle[] = [...list];
  let id = nextId(list);
  for (let i = 0; i < BREAK_BURST_COUNT; i++) {
    const angle = rng() * Math.PI * 2;
    const hSpeed = rand(rng, BREAK_HSPEED_MIN, BREAK_HSPEED_MAX);
    const life = rand(rng, BREAK_LIFE_MIN, BREAK_LIFE_MAX);
    out.push({
      id: id++,
      tile,
      pos: { x: pos.x, y: pos.y, z: pos.z }, // copy — never alias the caller's vector
      vel: {
        x: Math.cos(angle) * hSpeed,
        y: rand(rng, BREAK_VY_MIN, BREAK_VY_MAX),
        z: Math.sin(angle) * hSpeed,
      },
      life,
      maxLife: life,
      size: rand(rng, BREAK_SIZE_MIN, BREAK_SIZE_MAX),
    });
  }
  return out;
}

/** While digging: append one 2-particle chip batch. The direction is a random
 *  spray with an upward bias factor `up ∈ [0,1]`, and the horizontal share is
 *  scaled so the 3D speed stays exactly `speed` ∈ [1, 2] blocks/s. Same NEW
 *  array / unique-id / block-side-tile contract as `spawnBreakBurst`. */
export function spawnDigChip(
  list: readonly Particle[],
  blockId: number,
  pos: { x: number; y: number; z: number },
  rng: () => number = Math.random,
): Particle[] {
  const tile = getBlockDef(blockId).side;
  const out: Particle[] = [...list];
  let id = nextId(list);
  for (let i = 0; i < DIG_CHIP_COUNT; i++) {
    const angle = rng() * Math.PI * 2;
    const speed = rand(rng, DIG_CHIP_SPEED_MIN, DIG_CHIP_SPEED_MAX);
    const up = rng(); // vertical share of `speed`
    const hSpeed = Math.sqrt(Math.max(0, 1 - up * up)) * speed;
    const life = rand(rng, DIG_CHIP_LIFE_MIN, DIG_CHIP_LIFE_MAX);
    out.push({
      id: id++,
      tile,
      pos: { x: pos.x, y: pos.y, z: pos.z },
      vel: { x: Math.cos(angle) * hSpeed, y: up * speed, z: Math.sin(angle) * hSpeed },
      life,
      maxLife: life,
      size: rand(rng, DIG_CHIP_SIZE_MIN, DIG_CHIP_SIZE_MAX),
    });
  }
  return out;
}

/** One physics tick: gravity, integration, ground rest, life burn-down, cap.
 *
 *  Per particle: gravity `v.y -= 20·dt`, then `pos += vel·dt` (semi-implicit
 *  Euler, same order as drops.ts); a DOWNWARD-moving particle whose floored
 *  cell is solid snaps to that cell's top (`floor(y)+1`) with `v.y = 0` —
 *  horizontal motion keeps sliding. `life` decreases by `dt` and a particle at
 *  `life <= 0` is removed; over `MAX_PARTICLES` the OLDEST are dropped (the
 *  list order is oldest→newest, so the newest survive). Invalid `dt`
 *  (NaN/≤0) is a no-op (no NaN can ever poison a position). `isSolidAt` is
 *  injected floored cell coords — pass the same notion of solid the player
 *  physics uses (water is NOT solid). Returns a NEW array of NEW objects. */
export function stepParticles(
  list: readonly Particle[],
  dt: number,
  isSolidAt: (x: number, y: number, z: number) => boolean,
): Particle[] {
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const out: Particle[] = [];
  for (const p of list) {
    const life = p.life - step;
    if (life <= 0) continue;
    const pos = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
    const vel = { x: p.vel.x, y: p.vel.y, z: p.vel.z };
    vel.y -= PARTICLE_GRAVITY * step;
    pos.x += vel.x * step;
    pos.y += vel.y * step;
    pos.z += vel.z * step;
    if (vel.y < 0 && isSolidAt(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z))) {
      pos.y = Math.floor(pos.y) + 1; // rest on the solid cell's top face
      vel.y = 0;
    }
    out.push({ ...p, pos, vel, life });
  }
  const overflow = out.length - MAX_PARTICLES;
  return overflow > 0 ? out.slice(overflow) : out; // drop the oldest
}
