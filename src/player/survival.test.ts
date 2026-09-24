import { describe, it, expect } from 'vitest';
import { createVitals, damage, heal, eat, exhaust, starve, tickVitals, isDead } from './survival';
import type { Vitals } from './survival';

/** Convenience: full vitals with tweaks applied via the pure ops themselves. */
const at = (patch: Partial<Vitals>): Vitals => ({ ...createVitals(), ...patch });

describe('createVitals', () => {
  it('starts at full health, full hunger, 5 saturation', () => {
    expect(createVitals()).toEqual({
      hp: 20,
      maxHp: 20,
      hunger: 20,
      maxHunger: 20,
      saturation: 5,
      regenAcc: 0,
      starveAcc: 0,
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
});

describe('exhaust', () => {
  it('drains saturation first when the amount fits', () => {
    const v = exhaust(at({ saturation: 5, hunger: 20 }), 3);
    expect(v.saturation).toBe(2);
    expect(v.hunger).toBe(20); // hunger untouched
  });

  it('overflow past saturation drains hunger (ceiling of the remainder)', () => {
    const v = exhaust(at({ saturation: 5, hunger: 20 }), 6.5);
    expect(v.saturation).toBe(0);
    expect(v.hunger).toBe(18); // ceil(1.5) = 2
  });

  it('hunger from overflow floors at 0', () => {
    const v = exhaust(at({ saturation: 0, hunger: 1 }), 5);
    expect(v.saturation).toBe(0);
    expect(v.hunger).toBe(0);
    expect(v.hp).toBe(20); // exhaust alone never damages hp
  });

  it('zero or negative amount is a no-op', () => {
    const v = exhaust(at({ saturation: 5, hunger: 20 }), 0);
    expect(v.saturation).toBe(5);
    expect(v.hunger).toBe(20);
  });
});

describe('tickVitals — regen', () => {
  it('regenerates 1 hp per 4 s when hunger >= 18', () => {
    let v = at({ hp: 10, hunger: 20 });
    v = tickVitals(v, 4);
    expect(v.hp).toBe(11);
    v = tickVitals(v, 4);
    expect(v.hp).toBe(12);
  });

  it('accumulates regenAcc below the 4 s threshold', () => {
    const v = tickVitals(at({ hp: 10 }), 3.9);
    expect(v.hp).toBe(10);
    expect(v.regenAcc).toBeCloseTo(3.9, 5);
  });

  it('does not regenerate below hunger 18 and resets the accumulator', () => {
    let v = tickVitals(at({ hp: 10 }), 3.9); // 3.9 s banked
    expect(v.regenAcc).toBeCloseTo(3.9, 5);
    v = tickVitals({ ...v, hunger: 17 }, 0.5);
    expect(v.hp).toBe(10);
    expect(v.regenAcc).toBe(0); // condition lost → bank discarded
  });

  it('stops at maxHp and clamps', () => {
    const v = tickVitals(at({ hp: 20 }), 100);
    expect(v.hp).toBe(20);
    expect(v.regenAcc).toBe(0); // hp full → no bank
    expect(tickVitals(at({ hp: 19 }), 8).hp).toBe(20); // clamped, not 21
  });

  it('a huge dt crosses multiple 4 s thresholds in one call', () => {
    const v = tickVitals(at({ hp: 10, hunger: 20 }), 9.5);
    expect(v.hp).toBe(12); // +2
    expect(v.regenAcc).toBeCloseTo(1.5, 5); // remainder carried
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
    const v = tickVitals(at({ hp: 10, hunger: 0, saturation: 1 }), 100);
    expect(v.hp).toBe(10);
    expect(v.starveAcc).toBe(0);
  });

  it('does not decay while hunger remains', () => {
    const v = tickVitals(at({ hp: 10, hunger: 1, saturation: 0 }), 100);
    expect(v.hp).toBe(10);
    expect(v.starveAcc).toBe(0);
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
});

describe('isDead', () => {
  it('is true only at hp <= 0', () => {
    expect(isDead(createVitals())).toBe(false);
    expect(isDead(at({ hp: 1 }))).toBe(false);
    expect(isDead(at({ hp: 0 }))).toBe(true);
  });
});
