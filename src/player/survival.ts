/** Player vitals: health, hunger, saturation and exhaustion (pure — no DOM/Three).
 *  Every operation returns a NEW `Vitals` (spread copy); inputs are never mutated.
 *  Accumulators (`regenAcc`/`starveAcc`) and the exhaustion bank are carried
 *  forward on each call.
 *
 *  Exhaustion (vanilla 1.20 model): every action banks points; once the bank
 *  passes 4, one saturation — or one hunger once saturation is empty — is spent
 *  and the remainder stays banked. Sources, exported as `EXHAUST_*` constants:
 *  sprinting 0.1 per metre, a jump 0.05, a sprint-jump 0.2, a landed attack 0.1,
 *  taking damage 0.1, breaking a block 0.005 and 6.0 per hp regenerated. The
 *  bank is capped at 40. Callers report movement/action costs via `exhaust()`;
 *  regeneration and starvation are stepped by `tickVitals`.
 *
 *  Regeneration: 1 hp per 0.5 s while hunger is full AND saturation remains,
 *  otherwise 1 hp per 4 s while hunger ≥ 18 or saturation is left; it stops at
 *  full hp or when hunger ≤ 17 with saturation 0. Starvation: hunger 0 with
 *  saturation 0 → −1 hp per 4 s. */

export interface Vitals {
  /** Current health in half-hearts (0 = dead), clamped to [0, maxHp]. */
  hp: number;
  maxHp: number;
  /** Food points 0–20; at 0 with no saturation the player starves. */
  hunger: number;
  maxHunger: number;
  /** Hidden food reserve drained by exhaustion before hunger drops. */
  saturation: number;
  /** Seconds banked toward the next regen tick (1 hp per 4 s, 0.5 s when fast). */
  regenAcc: number;
  /** Seconds banked toward the next starvation tick (1 hp per 4 s). */
  starveAcc: number;
  /** Exhaustion bank 0–40; every completed 4 spends 1 saturation (then hunger). */
  exhaustion: number;
}

/** Fresh vitals: full health, full hunger, 5 saturation (Minecraft defaults). */
export function createVitals(): Vitals {
  return {
    hp: 20,
    maxHp: 20,
    hunger: 20,
    maxHunger: 20,
    saturation: 5,
    regenAcc: 0,
    starveAcc: 0,
    exhaustion: 0,
  };
}

/** 1 hp tick interval, in seconds, for slow regen and starvation. */
const TICK_INTERVAL_SEC = 4;

/** 1 hp tick interval, in seconds, for fast regen (full hunger + saturation). */
const FAST_TICK_INTERVAL_SEC = 0.5;

/** Exhaustion bank cap — vanilla stops accumulating past 40. */
const EXHAUSTION_MAX = 40;

/** Banked exhaustion spent per drained saturation/hunger point. */
const EXHAUSTION_DRAIN = 4;

/** Upper clamp for the hidden accumulators: one regen/starve tick interval. A
 *  larger bank would immediately apply extra ticks on the first frame after a
 *  load. */
const VITALS_ACC_MAX_SEC = 4;

/** Apply `amount` damage, clamped at 0. Zero, negative or non-finite
 *  (NaN/Infinity) amounts are a no-op. */
export function damage(v: Vitals, amount: number): Vitals {
  if (!Number.isFinite(amount) || amount <= 0) return { ...v };
  return { ...v, hp: Math.max(0, v.hp - amount) };
}

/** Restore `amount` hp, clamped at maxHp. Zero, negative or non-finite
 *  amounts are a no-op. */
export function heal(v: Vitals, amount: number): Vitals {
  if (!Number.isFinite(amount) || amount <= 0) return { ...v };
  return { ...v, hp: Math.min(v.maxHp, v.hp + amount) };
}

/** Eat `food` points (hunger clamped to [0, maxHunger] and floored — food
 *  points are integral) and gain `sat` saturation (capped at maxHunger,
 *  allowed to stay fractional). Zero, negative or non-finite `food`/`sat`
 *  are treated as a 0 addend for that stat. */
export function eat(v: Vitals, food: number, sat: number): Vitals {
  const addFood = Number.isFinite(food) && food > 0 ? food : 0;
  const addSat = Number.isFinite(sat) && sat > 0 ? sat : 0;
  return {
    ...v,
    hunger: Math.max(0, Math.min(v.maxHunger, Math.floor(v.hunger + addFood))),
    saturation: Math.max(0, Math.min(v.maxHunger, v.saturation + addSat)),
  };
}

// ---- Vanilla exhaustion sources (1.20) ----
/** Exhaustion banked per metre of horizontal sprint movement. */
export const EXHAUST_SPRINT_PER_METER = 0.1;
/** Exhaustion banked by a single jump launch. */
export const EXHAUST_JUMP = 0.05;
/** Exhaustion banked by a jump launched while sprinting (instead of `EXHAUST_JUMP`). */
export const EXHAUST_SPRINT_JUMP = 0.2;
/** Exhaustion banked per landed attack (hit, not swing). */
export const EXHAUST_ATTACK = 0.1;
/** Exhaustion banked when a damage source lands on the player. */
export const EXHAUST_HURT = 0.1;
/** Exhaustion banked per broken block. */
export const EXHAUST_BREAK_BLOCK = 0.005;
/** Exhaustion banked per hp regenerated. */
export const EXHAUST_PER_HP_REGEN = 6;

/** Bank `amount` exhaustion (vanilla accumulation model): the bank is capped at
 *  `EXHAUSTION_MAX` and every completed `EXHAUSTION_DRAIN` points spend one
 *  saturation — or one hunger once saturation is empty — while the remainder
 *  stays banked. Never touches hp — the hp decay rule lives in `tickVitals`.
 *  Zero, negative or non-finite amounts are a no-op. */
export function exhaust(v: Vitals, amount: number): Vitals {
  if (!Number.isFinite(amount) || amount <= 0) return { ...v };
  let exhaustion = Math.min(EXHAUSTION_MAX, v.exhaustion + amount);
  let saturation = v.saturation;
  let hunger = v.hunger;
  while (exhaustion > EXHAUSTION_DRAIN) {
    exhaustion -= EXHAUSTION_DRAIN;
    if (saturation > 0) saturation = Math.max(0, saturation - 1);
    else hunger = Math.max(0, hunger - 1);
  }
  return { ...v, exhaustion, saturation, hunger };
}

/** Drain `amount` hunger, floored at 0 and kept integral. Hunger only — the
 *  1 hp decay when hunger and saturation are both 0 happens in `tickVitals`.
 *  Zero, negative or non-finite amounts are a no-op. */
export function starve(v: Vitals, amount: number): Vitals {
  if (!Number.isFinite(amount) || amount <= 0) return { ...v };
  return { ...v, hunger: Math.max(0, Math.floor(v.hunger - amount)) };
}

/** Advance time by `dtSec` seconds:
 *  - regen: alive (0 < hp < maxHp) and (hunger ≥ 18 or saturation > 0) → +1 hp
 *    per 0.5 s while hunger is full AND saturation remains, else per 4 s; each
 *    hp spends `EXHAUST_PER_HP_REGEN` exhaustion through `exhaust()`;
 *  - starve: hunger 0, saturation 0 and hp > 0 → −1 hp per `TICK_INTERVAL_SEC`
 *    via `starveAcc`.
 *  The inactive accumulator resets to 0 — even when `dtSec` is non-positive
 *  or non-finite (treated as 0, never propagated into the accumulators).
 *  Movement exhaustion is NOT handled here — callers invoke `exhaust()`. */
export function tickVitals(v: Vitals, dtSec: number): Vitals {
  if (!Number.isFinite(dtSec) || dtSec <= 0) dtSec = 0; // clamp, do NOT return: resets below must still run
  let { hp, hunger, saturation, exhaustion, regenAcc, starveAcc } = v;

  if (hp > 0 && hp < v.maxHp && (hunger >= 18 || saturation > 0)) {
    regenAcc += dtSec;
    while (hp < v.maxHp && (hunger >= 18 || saturation > 0)) {
      // Re-derived per heal: a heal spends exhaustion which can empty the
      // saturation mid-call and drop the player from the fast to the slow path.
      const interval =
        hunger >= v.maxHunger && saturation > 0 ? FAST_TICK_INTERVAL_SEC : TICK_INTERVAL_SEC;
      if (regenAcc < interval) break;
      regenAcc -= interval;
      hp += 1;
      const after = exhaust({ ...v, hp, hunger, saturation, exhaustion }, EXHAUST_PER_HP_REGEN);
      hunger = after.hunger;
      saturation = after.saturation;
      exhaustion = after.exhaustion;
    }
    if (hp >= v.maxHp) regenAcc = 0; // full health → nothing banked
  } else {
    regenAcc = 0;
  }

  // Starvation reads the UPDATED hunger/saturation: when a heal's exhaustion
  // spend drains the last saturation point at hunger 0, starving starts banking
  // in the same call instead of waiting a frame.
  if (hunger === 0 && saturation === 0 && hp > 0) {
    starveAcc += dtSec;
    while (starveAcc >= TICK_INTERVAL_SEC && hp > 0) {
      hp -= 1;
      starveAcc -= TICK_INTERVAL_SEC;
    }
    if (hp <= 0) starveAcc = 0; // dead → nothing banked
  } else {
    starveAcc = 0;
  }

  return { ...v, hp, hunger, saturation, exhaustion, regenAcc, starveAcc };
}

/** True when the player has no hp left. */
export function isDead(v: Vitals): boolean {
  return v.hp <= 0;
}

/** Damage taken from a fall of `distance` blocks: `max(0, floor(distance − 3))`
 *  — the first 3 blocks are exempt (plan 9.1), then 1 hp per block. `distance`
 *  is measured from the apex of the airborne span (peak y minus landing y, so
 *  a jump's up-phase nets ~0). Negative, NaN and non-finite distances are 0
 *  (repo NaN-guard norm — never deals infinite damage). */
export function fallDamage(distance: number): number {
  if (!Number.isFinite(distance) || distance <= 0) return 0;
  return Math.max(0, Math.floor(distance - 3));
}

const isFiniteNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Clamp an untrusted-but-validated vitals record into the model's shape and
 *  bounds. Missing/non-finite fields fall back to fresh-vitals defaults;
 *  `maxHp`/`maxHunger` are model constants (callers always write 20/20) — a
 *  finite in-range value passes, anything else takes the default; the rest
 *  clamp into the resulting ranges (`exhaustion` into [0, `EXHAUSTION_MAX`],
 *  the accumulators into [0, `VITALS_ACC_MAX_SEC`]). Takes `unknown` because
 *  both cloud payloads and local save records hand over untyped JSON. Never
 *  throws. */
export function normalizeVitals(raw: unknown): Vitals {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = createVitals();
  const inRange = (x: unknown, min: number, max: number): number | null =>
    isFiniteNum(x) && x >= min && x <= max ? x : null;
  const clamp = (x: unknown, min: number, max: number, fallback: number): number => {
    const value = isFiniteNum(x) ? x : fallback;
    return Math.min(max, Math.max(min, value));
  };
  const maxHp = inRange(r.maxHp, 1, d.maxHp) ?? d.maxHp;
  const maxHunger = inRange(r.maxHunger, 1, d.maxHunger) ?? d.maxHunger;
  return {
    hp: clamp(r.hp, 0, maxHp, d.hp),
    maxHp,
    hunger: clamp(r.hunger, 0, maxHunger, d.hunger),
    maxHunger,
    saturation: clamp(r.saturation, 0, maxHunger, d.saturation),
    regenAcc: clamp(r.regenAcc, 0, VITALS_ACC_MAX_SEC, d.regenAcc),
    starveAcc: clamp(r.starveAcc, 0, VITALS_ACC_MAX_SEC, d.starveAcc),
    exhaustion: clamp(r.exhaustion, 0, EXHAUSTION_MAX, d.exhaustion),
  };
}
