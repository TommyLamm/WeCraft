/** Player vitals: health, hunger and saturation (pure — no DOM/Three).
 *  Every operation returns a NEW `Vitals` (spread copy); inputs are never mutated.
 *  Accumulators (`regenAcc`/`starveAcc`) are carried forward on each call. */

export interface Vitals {
  /** Current health in half-hearts (0 = dead), clamped to [0, maxHp]. */
  hp: number;
  maxHp: number;
  /** Food points 0–20; at 0 with no saturation the player starves. */
  hunger: number;
  maxHunger: number;
  /** Hidden food reserve drained by exhaustion before hunger drops. */
  saturation: number;
  /** Seconds banked toward the next regen tick (1 hp per 4 s). */
  regenAcc: number;
  /** Seconds banked toward the next starvation tick (1 hp per 4 s). */
  starveAcc: number;
}

/** Fresh vitals: full health, full hunger, 5 saturation (Minecraft defaults). */
export function createVitals(): Vitals {
  return { hp: 20, maxHp: 20, hunger: 20, maxHunger: 20, saturation: 5, regenAcc: 0, starveAcc: 0 };
}

/** 1 hp tick interval, in seconds, for both regen and starvation. */
const TICK_INTERVAL_SEC = 4;

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

/** Spend `amount` of exhaustion: saturation drains first; whatever overflows
 *  (rounded up) comes off hunger, floored at 0. Never touches hp — the hp
 *  decay rule lives in `tickVitals`. Zero, negative or non-finite amounts
 *  are a no-op. */
export function exhaust(v: Vitals, amount: number): Vitals {
  if (!Number.isFinite(amount) || amount <= 0) return { ...v };
  if (amount <= v.saturation) return { ...v, saturation: v.saturation - amount };
  const overflow = amount - v.saturation;
  return { ...v, saturation: 0, hunger: Math.max(0, v.hunger - Math.ceil(overflow)) };
}

/** Drain `amount` hunger, floored at 0 and kept integral. Hunger only — the
 *  1 hp decay when hunger and saturation are both 0 happens in `tickVitals`.
 *  Zero, negative or non-finite amounts are a no-op. */
export function starve(v: Vitals, amount: number): Vitals {
  if (!Number.isFinite(amount) || amount <= 0) return { ...v };
  return { ...v, hunger: Math.max(0, Math.floor(v.hunger - amount)) };
}

/** Advance time by `dtSec` seconds:
 *  - regen: alive (0 < hp < maxHp) and hunger ≥ 18 → +1 hp per `TICK_INTERVAL_SEC`
 *    banked in `regenAcc`;
 *  - starve: hunger 0, saturation 0 and hp > 0 → −1 hp per `TICK_INTERVAL_SEC`
 *    via `starveAcc`.
 *  The inactive accumulator resets to 0 — even when `dtSec` is non-positive
 *  or non-finite (treated as 0, never propagated into the accumulators).
 *  Movement exhaustion is NOT handled here — callers invoke `exhaust()`. */
export function tickVitals(v: Vitals, dtSec: number): Vitals {
  if (!Number.isFinite(dtSec) || dtSec <= 0) dtSec = 0; // clamp, do NOT return: resets below must still run
  let { hp, regenAcc, starveAcc } = v;

  if (hp > 0 && hp < v.maxHp && v.hunger >= 18) {
    regenAcc += dtSec;
    while (regenAcc >= TICK_INTERVAL_SEC && hp < v.maxHp) {
      hp += 1;
      regenAcc -= TICK_INTERVAL_SEC;
    }
    if (hp >= v.maxHp) regenAcc = 0; // full health → nothing banked
  } else {
    regenAcc = 0;
  }

  if (v.hunger === 0 && v.saturation === 0 && hp > 0) {
    starveAcc += dtSec;
    while (starveAcc >= TICK_INTERVAL_SEC && hp > 0) {
      hp -= 1;
      starveAcc -= TICK_INTERVAL_SEC;
    }
    if (hp <= 0) starveAcc = 0; // dead → nothing banked
  } else {
    starveAcc = 0;
  }

  return { ...v, hp, regenAcc, starveAcc };
}

/** True when the player has no hp left. */
export function isDead(v: Vitals): boolean {
  return v.hp <= 0;
}
