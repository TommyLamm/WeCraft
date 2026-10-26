import { describe, it, expect } from 'vitest';
import {
  createVitals,
  damage,
  heal,
  eat,
  exhaust,
  starve,
  tickVitals,
  isDead,
  fallDamage,
  normalizeVitals,
} from './survival';
import type { Vitals } from './survival';

/** Hand-built fixture: full vitals with a patch applied directly — bypasses
 *  the op clamps by design (e.g. can seed a dead or starving state). */
const at = (patch: Partial<Vitals>): Vitals => ({ ...createVitals(), ...patch });

describe('createVitals', () => {
  it('starts at full health, full hunger, 5 saturation and no exhaustion', () => {
    expect(createVitals()).toEqual({
      hp: 20,
      maxHp: 20,
      hunger: 20,
      maxHunger: 20,
      saturation: 5,
      regenAcc: 0,
      starveAcc: 0,
      exhaustion: 0,
    });
  });
});

describe('damage / heal', () => {
  it('damage reduces hp', () => {
    expect(damage(createVitals(), 5).hp).toBe(15);
  });

  it('damage clamps at 0 — never negative', () => {
    expect(damage(createVitals(), 19).hp).toBe(1);
    expect(damage(createVitals(), 99).hp).toBe(0);
    expect(damage(at({ hp: 3 }), 5).hp).toBe(0);
    expect(damage(at({ hp: 0 }), 5).hp).toBe(0); // dead stays dead
  });

  it('damage with zero or negative amount is a no-op', () => {
    expect(damage(createVitals(), 0).hp).toBe(20);
    expect(damage(createVitals(), -5).hp).toBe(20);
    const v = createVitals();
    expect(damage(v, -5)).not.toBe(v); // still a fresh copy, never the input itself
  });

  it('damage with NaN amount is a no-op — hp never becomes NaN', () => {
    const v = damage(createVitals(), NaN);
    expect(v.hp).toBe(20);
    expect(isDead(v)).toBe(false);
  });

  it('damage returns a new object without touching the input', () => {
    const v = createVitals();
    const next = damage(v, 5);
    expect(next).not.toBe(v);
    expect(v.hp).toBe(20);
  });

  it('heal restores hp up to maxHp', () => {
    expect(heal(at({ hp: 10 }), 5).hp).toBe(15);
    expect(heal(at({ hp: 18 }), 5).hp).toBe(20); // clamped, not 23
    expect(heal(at({ hp: 20 }), 5).hp).toBe(20); // heal at full is a no-op
    expect(heal(at({ hp: 10 }), -5).hp).toBe(10); // negative amount no-op
    expect(heal(at({ hp: 10 }), NaN).hp).toBe(10); // NaN amount no-op
  });
});

describe('eat / starve', () => {
  it('eat raises hunger, clamped at maxHunger', () => {
    expect(eat(at({ hunger: 10, saturation: 0 }), 6, 0).hunger).toBe(16);
    expect(eat(at({ hunger: 15, saturation: 0 }), 6, 0).hunger).toBe(20); // 21 clamped
    expect(eat(at({ hunger: 20, saturation: 0 }), 6, 0).hunger).toBe(20); // full no-op
  });

  it('eat adds saturation, capped at maxHunger', () => {
    const v = eat(at({ hunger: 10, saturation: 5 }), 6, 2.5);
    expect(v.saturation).toBe(7.5); // 5 + 2.5
    expect(eat(at({ saturation: 19 }), 0, 5).saturation).toBe(20); // capped, not 24
  });

  it('eat with zero/negative/non-finite food or sat is a no-op for that stat', () => {
    const v = at({ hunger: 10, saturation: 5 });
    expect(eat(v, -30, 0).hunger).toBe(10); // never hunger -10
    expect(eat(v, 0, -10).saturation).toBe(5); // never saturation -5
    expect(eat(v, NaN, 0).hunger).toBe(10);
    expect(eat(v, 0, NaN).saturation).toBe(5);
  });

  it('eat keeps hunger integral (floors the result); saturation stays fractional', () => {
    expect(eat(at({ hunger: 10 }), 1.5, 0).hunger).toBe(11); // floor(11.5)
    expect(eat(at({ hunger: 10, saturation: 5 }), 6, 2.5).saturation).toBe(7.5); // fractional kept
  });

  it('eat returns a new object without touching the input', () => {
    const v = at({ hunger: 10, saturation: 0 });
    const next = eat(v, 6, 2.5);
    expect(next).not.toBe(v);
    expect(v.hunger).toBe(10);
    expect(v.saturation).toBe(0);
  });

  it('starve only drains hunger, floored at 0 — never hp', () => {
    expect(starve(at({ hunger: 5 }), 1).hunger).toBe(4);
    expect(starve(at({ hunger: 1 }), 5).hunger).toBe(0); // clamped at 0
    const dead = starve(at({ hunger: 0 }), 1);
    expect(dead.hunger).toBe(0);
    expect(dead.hp).toBe(20); // hp decay lives in tickVitals, not here
  });

  it('starve with zero/negative/non-finite amount is a no-op', () => {
    const v = at({ hunger: 10 });
    expect(starve(v, 0).hunger).toBe(10);
    expect(starve(v, -5).hunger).toBe(10);
    expect(starve(v, NaN).hunger).toBe(10);
  });

  it('starve keeps hunger integral (floors the result)', () => {
    expect(starve(at({ hunger: 20 }), 0.5).hunger).toBe(19); // floor(19.5), not 19.5
  });
});

describe('exhaust', () => {
  it('accumulates below the 4-point threshold without draining (Minor 9: ≥ 4)', () => {
    const v = exhaust(at({ exhaustion: 0, hunger: 20, saturation: 5 }), 3.9);
    expect(v.exhaustion).toBeCloseTo(3.9, 5); // banked, NOT spent (the threshold is ≥ 4)
    expect(v.saturation).toBe(5);
    expect(v.hunger).toBe(20);
  });

  it('exactly 4 exhaustion drains one saturation (Minor 9: ≥ 4, not > 4)', () => {
    // 審查 Minor 9：上游是「累積 ≥ 4」——4.0 就該消費一點。舊碼 `> 4` 會把
    // 整整 4.0 留在銀行裡（永遠差一點才消費）→ 反向釘死的測試已改寫成這條。
    const v = exhaust(at({ exhaustion: 0, hunger: 20, saturation: 5 }), 4.0);
    expect(v.exhaustion).toBe(0); // 4.0 ≥ 4 → spent
    expect(v.saturation).toBe(4);
    expect(v.hunger).toBe(20);
  });

  it('drains one saturation per completed 4 exhaustion, keeping the remainder', () => {
    const v = exhaust(at({ exhaustion: 0, hunger: 20, saturation: 5 }), 4.1);
    expect(v.exhaustion).toBeCloseTo(0.1, 5); // fp residue of 4.1 − 4
    expect(v.saturation).toBe(4);
    expect(v.hunger).toBe(20);
  });

  it('falls through to hunger when saturation is empty', () => {
    const v = exhaust(at({ exhaustion: 3, saturation: 0, hunger: 20 }), 1.5);
    expect(v.exhaustion).toBeCloseTo(0.5, 5); // one completed 4 of the 4.5 total
    expect(v.saturation).toBe(0);
    expect(v.hunger).toBe(19);
  });

  it('never drains more than one point per 4 exhaustion (no ceil-style overdraw)', () => {
    // The old model spent ceil(6 − 0.5) = 6 hunger for this single spend; the
    // vanilla-style bank spends one point per completed 4 and keeps the rest.
    const v = exhaust(at({ saturation: 0.5, hunger: 20 }), 6);
    expect(v.saturation).toBe(0); // 0.5 − 1 clamps at 0
    expect(v.exhaustion).toBe(2); // 6 − 4
    expect(v.hunger).toBe(20); // the one drain came out of saturation
  });

  it('chunked and step-wise application of the same total are identical', () => {
    const once = exhaust(at({ exhaustion: 0, saturation: 5, hunger: 20 }), 10);
    let steps = at({ exhaustion: 0, saturation: 5, hunger: 20 });
    for (let i = 0; i < 100; i++) steps = exhaust(steps, 0.1);
    expect(once.exhaustion).toBe(2); // 10 → two drains, 2 carried
    expect(once.saturation).toBe(3);
    expect(once.hunger).toBe(20);
    // compare field by field: toEqual would false-fail on the 0.1 accumulation residue
    expect(steps.exhaustion).toBeCloseTo(once.exhaustion, 5);
    expect(steps.saturation).toBeCloseTo(once.saturation, 5);
    expect(steps.hunger).toBeCloseTo(once.hunger, 5);
  });

  it('caps accumulation at 40 before draining (Minor 9: 40 → 10 drains)', () => {
    const v = exhaust(at({ exhaustion: 39, saturation: 0, hunger: 20 }), 10);
    // min(40, 49) → 40 → 10 completed drains under ≥ 4 (an uncapped 49 would
    // drain 12); the old `> 4` stopped at 4 with 9 drains (hunger 11).
    expect(v.exhaustion).toBe(0);
    expect(v.saturation).toBe(0);
    expect(v.hunger).toBe(10);
  });

  it('a drain floors hunger at 0', () => {
    const v = exhaust(at({ saturation: 0, hunger: 1 }), 5);
    expect(v.saturation).toBe(0);
    expect(v.hunger).toBe(0);
    expect(v.hp).toBe(20); // exhaust alone never damages hp
  });

  it('zero, negative or non-finite amount is a no-op', () => {
    for (const amount of [0, -3, NaN]) {
      const v = exhaust(at({ exhaustion: 2, saturation: 5, hunger: 20 }), amount);
      expect(v.exhaustion).toBe(2);
      expect(v.saturation).toBe(5);
      expect(v.hunger).toBe(20);
    }
  });
});

describe('tickVitals — regen', () => {
  it('regenerates 1 hp per 4 s when hunger >= 18', () => {
    // No saturation → the slow 4 s cadence (the 0.5 s fast path needs full
    // hunger AND saturation; see the fast-regeneration test below).
    let v = at({ hp: 10, hunger: 20, saturation: 0 });
    v = tickVitals(v, 4);
    expect(v.hp).toBe(11);
    v = tickVitals(v, 4);
    expect(v.hp).toBe(12);
  });

  it('accumulates regenAcc below the 4 s threshold', () => {
    const v = tickVitals(at({ hp: 10, saturation: 0 }), 3.9);
    expect(v.hp).toBe(10);
    expect(v.regenAcc).toBeCloseTo(3.9, 5);
  });

  it('saturation alone sustains slow regeneration below hunger 18', () => {
    // hunger 17 with saturation left → the slow cadence still heals
    const fed = tickVitals(at({ hp: 10, hunger: 17, saturation: 3, regenAcc: 3.9 }), 0.5);
    expect(fed.hp).toBe(11);
    expect(fed.regenAcc).toBeCloseTo(0.4, 5);
    // hunger 17 with saturation 0 → condition lost → bank discarded, no heal
    const dry = tickVitals(at({ hp: 10, hunger: 17, saturation: 0, regenAcc: 3.9 }), 0.5);
    expect(dry.hp).toBe(10);
    expect(dry.regenAcc).toBe(0);
  });

  it('fast regeneration at full hunger halves the tick (1 hp per 0.5 s)', () => {
    const v = tickVitals(at({ hp: 10, hunger: 20, saturation: 5, exhaustion: 0 }), 1.0);
    expect(v.hp).toBe(12); // exactly two 0.5 s heals fit in 1.0 s
    expect(v.saturation).toBe(2); // 2 × 6 = 12 banked ≥ 4 → 3 drains (Minor 9)
    expect(v.hunger).toBe(20); // saturation absorbed all three drains
    expect(v.exhaustion).toBe(0); // 12 = three full 4s (the old > 4 kept 4 banked)
  });

  it('regeneration stops when hunger drops below 18 with no saturation left', () => {
    // Minor 9（≥ 4）讓每筆 6 點的重生扣款比舊的 `> 4` 早一次消費：19→17 的
    // 飢餓滑落在**2 次**治療後就結束（舊碼是 3 次後）。
    let v = at({ hp: 10, hunger: 19, saturation: 1 });
    for (let i = 0; i < 10; i++) v = tickVitals(v, 4);
    expect(v.hp).toBe(12); // 2 heals, then the condition is lost for good
    expect(v.hp).toBeLessThanOrEqual(v.maxHp);
    expect(v.saturation).toBe(0);
    expect(v.hunger).toBe(17); // < 18 → no more slow regen
  });

  it('stops at maxHp and clamps', () => {
    const v = tickVitals(at({ hp: 20 }), 100);
    expect(v.hp).toBe(20);
    expect(v.regenAcc).toBe(0); // hp full → no bank
    expect(tickVitals(at({ hp: 19 }), 8).hp).toBe(20); // clamped, not 21
  });

  it('a huge dt crosses multiple 4 s thresholds in one call', () => {
    const v = tickVitals(at({ hp: 10, hunger: 20, saturation: 0 }), 9.5);
    expect(v.hp).toBe(12); // +2
    expect(v.regenAcc).toBeCloseTo(1.5, 5); // remainder carried
  });

  it('regen never revives a dead player (hp 0 stays 0)', () => {
    const dead = damage(createVitals(), 99);
    expect(dead.hp).toBe(0);
    const v = tickVitals(dead, 8); // would be +2 hp without the hp > 0 guard
    expect(v.hp).toBe(0);
    expect(v.regenAcc).toBe(0);
  });
});

describe('tickVitals — starve', () => {
  it('decays 1 hp per 4 s only when hunger and saturation are both 0', () => {
    let v = at({ hp: 10, hunger: 0, saturation: 0 });
    v = tickVitals(v, 4);
    expect(v.hp).toBe(9);
    v = tickVitals(v, 4);
    expect(v.hp).toBe(8);
  });

  it('does not decay while saturation remains', () => {
    // Full hp on purpose: with hp below max the new model would spend the
    // saturation on slow regeneration and starvation could start afterwards.
    const v = tickVitals(at({ hp: 20, hunger: 0, saturation: 1 }), 100);
    expect(v.hp).toBe(20);
    expect(v.starveAcc).toBe(0);
    expect(v.saturation).toBe(1); // untouched — no action spent exhaustion
  });

  it('does not decay while hunger remains', () => {
    const v = tickVitals(at({ hp: 10, hunger: 1, saturation: 0 }), 100);
    expect(v.hp).toBe(10);
    expect(v.starveAcc).toBe(0);
  });

  it('banks starvation in the same call when a heal spends the last saturation', () => {
    // hunger 0 + saturation 1 → one slow heal drains it → the starve branch
    // reads the updated values and starts banking without waiting a frame.
    const v = tickVitals(at({ hp: 10, hunger: 0, saturation: 1 }), 4);
    expect(v.hp).toBe(10); // +1 regen and −1 starvation cancel in this call
    expect(v.saturation).toBe(0);
    expect(v.exhaustion).toBe(2); // 6 banked for the heal − one 4-point drain
    expect(v.starveAcc).toBe(0); // its 4 s bank was spent on the decay tick
  });

  it('stops at 0 hp and never goes negative', () => {
    const v = tickVitals(at({ hp: 1, hunger: 0, saturation: 0 }), 100);
    expect(v.hp).toBe(0);
    expect(v.starveAcc).toBe(0); // dead → accumulator cleared
    expect(tickVitals(v, 100).hp).toBe(0);
  });

  it('starve path with a huge dt crosses multiple thresholds in one call', () => {
    const v = tickVitals(at({ hp: 10, hunger: 0, saturation: 0 }), 9.5);
    expect(v.hp).toBe(8);
    expect(v.starveAcc).toBeCloseTo(1.5, 5);
  });
});

describe('tickVitals — general', () => {
  it('regen and starve are mutually exclusive (hunger decides which)', () => {
    // hungry but fed: regen wins, no starve bank
    const fed = tickVitals(at({ hp: 10, hunger: 20, saturation: 0 }), 4);
    expect(fed.hp).toBe(11);
    expect(fed.starveAcc).toBe(0);
    // starving: starve wins, no regen bank
    const starved = tickVitals(at({ hp: 10, hunger: 0, saturation: 0 }), 4);
    expect(starved.hp).toBe(9);
    expect(starved.regenAcc).toBe(0);
  });

  it('returns a new object and leaves the input untouched', () => {
    const v = at({ hp: 10, hunger: 20 });
    const next = tickVitals(v, 4);
    expect(next).not.toBe(v);
    expect(v.hp).toBe(10);
    expect(v.regenAcc).toBe(0);
  });

  it('zero or negative dt moves no accumulator but resets still run', () => {
    const banked = tickVitals(at({ hp: 10, saturation: 0 }), 3.9); // 3.9 s banked (slow path)
    expect(tickVitals(banked, 0).regenAcc).toBeCloseTo(3.9, 5);
    expect(tickVitals(banked, -5).regenAcc).toBeCloseTo(3.9, 5);
    expect(tickVitals(banked, -5).hp).toBe(10);
    // condition lost → the reset branch must still fire on a non-positive dt
    const hungry = { ...banked, hunger: 17 };
    expect(tickVitals(hungry, -1).regenAcc).toBe(0);
  });

  it('NaN dt is treated as 0 — accumulators never become NaN', () => {
    const banked = tickVitals(at({ hp: 10, saturation: 0 }), 3.9);
    const v = tickVitals(banked, NaN);
    expect(v.hp).toBe(10);
    expect(v.regenAcc).toBeCloseTo(3.9, 5); // bank carried, not corrupted
    expect(v.starveAcc).toBe(0);
  });
});

describe('normalizeVitals', () => {
  it('fills a partial record with fresh-vitals defaults (exhaustion 0)', () => {
    expect(normalizeVitals({ hp: 7 })).toEqual({
      hp: 7,
      maxHp: 20,
      hunger: 20,
      maxHunger: 20,
      saturation: 5,
      regenAcc: 0,
      starveAcc: 0,
      exhaustion: 0,
    });
  });

  it('clamps hostile fields and caps exhaustion into [0, 40] — never throws', () => {
    const hostile = normalizeVitals({
      hp: 999,
      maxHp: -3,
      hunger: NaN,
      maxHunger: 'x',
      saturation: 1e9,
      regenAcc: Number.POSITIVE_INFINITY,
      starveAcc: -5,
      exhaustion: 1e9,
    });
    expect(hostile).toEqual({
      hp: 20,
      maxHp: 20,
      hunger: 20,
      maxHunger: 20,
      saturation: 20,
      regenAcc: 0,
      starveAcc: 0,
      exhaustion: 40,
    });
    // a missing / non-finite / negative exhaustion falls back to 0
    expect(normalizeVitals({ hp: 20 }).exhaustion).toBe(0);
    expect(normalizeVitals({ hp: 20, exhaustion: NaN }).exhaustion).toBe(0);
    expect(normalizeVitals({ hp: 20, exhaustion: -3 }).exhaustion).toBe(0);
    expect(normalizeVitals(undefined).exhaustion).toBe(0); // non-object → fresh defaults
  });
});

describe('isDead', () => {
  it('is true only at hp <= 0', () => {
    expect(isDead(createVitals())).toBe(false);
    expect(isDead(at({ hp: 1 }))).toBe(false);
    expect(isDead(at({ hp: 0 }))).toBe(true);
  });
});

describe('fallDamage (plan 9.1: max(0, floor(distance − 3)))', () => {
  it('the 3-block exemption absorbs short hops', () => {
    expect(fallDamage(0)).toBe(0);
    expect(fallDamage(2)).toBe(0);
    expect(fallDamage(3)).toBe(0); // exactly at the threshold → 0
  });

  it('damage is one per block beyond the exemption', () => {
    expect(fallDamage(4)).toBe(1);
    expect(fallDamage(7.9)).toBe(4); // fractional distances floor first
    expect(fallDamage(8)).toBe(5);
    expect(fallDamage(23)).toBe(20); // a 23-block cliff is a one-hit kill
  });

  it('negative and non-finite distances are 0 (guards)', () => {
    expect(fallDamage(-1)).toBe(0);
    expect(fallDamage(-100)).toBe(0);
    expect(fallDamage(Number.NaN)).toBe(0);
    expect(fallDamage(Number.POSITIVE_INFINITY)).toBe(0); // never infinite damage
  });
});
