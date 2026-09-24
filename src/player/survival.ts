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

/** Apply `amount` damage, clamped at 0. Zero/negative amounts are a no-op. */
export function damage(v: Vitals, amount: number): Vitals {
  if (amount <= 0) return { ...v };
  return { ...v, hp: Math.max(0, v.hp - amount) };
}

/** Restore `amount` hp, clamped at maxHp. Zero/negative amounts are a no-op. */
export function heal(v: Vitals, amount: number): Vitals {
  if (amount <= 0) return { ...v };
  return { ...v, hp: Math.min(v.maxHp, v.hp + amount) };
}

/** Eat `food` points (hunger clamped at maxHunger) and gain `sat` saturation
 *  (capped at maxHunger). */
export function eat(v: Vitals, food: number, sat: number): Vitals {
  return {
    ...v,
    hunger: Math.min(v.maxHunger, v.hunger + food),
    saturation: Math.min(v.maxHunger, v.saturation + sat),
  };
}

/** Spend `amount` of exhaustion: saturation drains first; whatever overflows
 *  (rounded up) comes off hunger, floored at 0. Never touches hp — the hp
 *  decay rule lives in `tickVitals`. */
export function exhaust(v: Vitals, amount: number): Vitals {
  if (amount <= 0) return { ...v };
  if (amount <= v.saturation) return { ...v, saturation: v.saturation - amount };
  const overflow = amount - v.saturation;
  return { ...v, saturation: 0, hunger: Math.max(0, v.hunger - Math.ceil(overflow)) };
}

/** Drain `amount` hunger, floored at 0. Hunger only — the 1 hp / 4 s decay
 *  when hunger and saturation are both 0 happens in `tickVitals`. */
export function starve(v: Vitals, amount: number): Vitals {
  if (amount <= 0) return { ...v };
  return { ...v, hunger: Math.max(0, v.hunger - amount) };
}

/** Advance time by `dtSec` seconds:
 *  - regen: hunger ≥ 18 and hp < maxHp → +1 hp per 4 s banked in `regenAcc`;
 *  - starve: hunger 0, saturation 0 and hp > 0 → −1 hp per 4 s via `starveAcc`.
 *  The inactive accumulator resets to 0. Movement exhaustion is NOT handled
 *  here — callers invoke `exhaust()` explicitly. */
export function tickVitals(v: Vitals, dtSec: number): Vitals {
  let { hp, regenAcc, starveAcc } = v;

  if (v.hunger >= 18 && hp < v.maxHp) {
    regenAcc += dtSec;
    while (regenAcc >= 4 && hp < v.maxHp) {
      hp += 1;
      regenAcc -= 4;
    }
    if (hp >= v.maxHp) regenAcc = 0; // full health → nothing banked
  } else {
    regenAcc = 0;
  }

  if (v.hunger === 0 && v.saturation === 0 && hp > 0) {
    starveAcc += dtSec;
    while (starveAcc >= 4 && hp > 0) {
      hp -= 1;
      starveAcc -= 4;
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
