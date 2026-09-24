import { describe, it, expect } from 'vitest';
import { updateFall, resetFall, type FallState } from './fallstate';
import { fallDamage } from './survival';

/** Simulate a walk-off from `ledgeY` onto ground at `groundY` (physics lands on
 *  the integer block top): the first airborne frame's PRE-physics y is the
 *  exact ledge height (it loses g·dt² during that frame), later frames free-fall
 *  at ~1.1 blocks/frame until physics snaps the feet to `groundY`. */
function simulateWalkOff(ledgeY: number, groundY: number): { distance: number | null } {
  let s = resetFall();
  // frame 1: on the ledge at start, physics moves off + applies gravity
  let r = updateFall(s, ledgeY, ledgeY - 0.009, false, false, false);
  s = r.fall;
  let y = ledgeY - 0.009;
  while (y > groundY + 0.5) {
    const post = y - 1.1;
    r = updateFall(s, y, post, false, false, false);
    s = r.fall;
    y = post;
  }
  // landing frame: physics collides and snaps the feet to the integer top
  return updateFall(s, y, groundY, true, false, false);
}

describe('updateFall — airborne apex tracking', () => {
  it('airborne: apex is the PRE-physics y, distance is null, state is new', () => {
    const s0 = resetFall();
    const r = updateFall(s0, 10, 9.991, false, false, false);
    expect(r.distance).toBeNull();
    expect(r.fall.apexY).toBe(10); // never the post-gravity ε-below value
    expect(r.fall).not.toBe(s0);
    expect(s0.apexY).toBeNull(); // input untouched (pure)
  });

  it('apex = max(existing, preY): rises track up, falls never erode the peak', () => {
    const s0: FallState = { apexY: 7 };
    const r1 = updateFall(s0, 20, 20.5, false, false, false);
    expect(r1.fall.apexY).toBe(20); // max(7, 20)
    expect(s0.apexY).toBe(7); // input never mutated
    const r2 = updateFall(r1.fall, 21, 21.2, false, false, false);
    expect(r2.fall.apexY).toBe(21); // still rising → peak follows
    const r3 = updateFall(r2.fall, 21.1, 20.6, false, false, false);
    expect(r3.fall.apexY).toBe(21.1); // falling (pre < apex but pre still max)
    const r4 = updateFall(r3.fall, 20.6, 20.1, false, false, false);
    expect(r4.fall.apexY).toBe(21.1); // falling never erodes the peak
    expect(r4.distance).toBeNull(); // airborne never reports a distance
  });

  it('non-finite pre/post y leaves the state untouched (NaN guard)', () => {
    const s0: FallState = { apexY: 10 };
    const r = updateFall(s0, Number.NaN, 5, false, false, false);
    expect(r.fall).toBe(s0);
    expect(r.distance).toBeNull();
    const r2 = updateFall(s0, 10, Number.POSITIVE_INFINITY, false, false, false);
    expect(r2.fall).toBe(s0);
    expect(r2.distance).toBeNull();
  });
});

describe('updateFall — landing contract', () => {
  it('grounded with an apex reports distance = apex − landed y, then clears', () => {
    const r = updateFall({ apexY: 10 }, 0.4, 0, true, false, false);
    expect(r.distance).toBe(10);
    expect(r.fall.apexY).toBeNull();
  });

  it('grounded with no apex (standing) reports nothing', () => {
    const r = updateFall(resetFall(), 0, 0, true, false, false);
    expect(r.distance).toBeNull();
    expect(r.fall.apexY).toBeNull();
  });
});

describe('updateFall — water and flight reset the apex (plan 9.1 resetFall)', () => {
  it('touching water mid-fall clears the apex without a distance', () => {
    const stale: FallState = { apexY: 39.99 };
    const w = updateFall(stale, 38, 30, false, false, true);
    expect(w.fall.apexY).toBeNull();
    expect(w.distance).toBeNull();
    expect(stale.apexY).toBe(39.99); // input untouched
    // landing on the lake bottom afterwards stays damage-free
    const land = updateFall(w.fall, 30, 20, true, false, true);
    expect(land.distance).toBeNull();
    expect(land.fall.apexY).toBeNull();
  });

  it('flying clears the apex — a flight is not a fall', () => {
    const f = updateFall({ apexY: 100 }, 80, 70, false, true, false);
    expect(f.fall.apexY).toBeNull();
    expect(f.distance).toBeNull();
    // landing while (still) flying also reports nothing
    const land = updateFall(f.fall, 70, 64, true, true, false);
    expect(land.distance).toBeNull();
  });
});

describe('updateFall — reset / stale-apex regression (review Critical #1)', () => {
  it('resetFall returns a fresh null-apex state', () => {
    expect(resetFall()).toEqual({ apexY: null });
  });

  it('after a session reset a grounded spawn reports no distance', () => {
    // the measured bug: a stale apex from quitting mid-fall (39.99) survived
    // into a new session and turned the spawn fall into a one-shot kill
    const r = updateFall(resetFall(), 10, 10, true, false, false);
    expect(r.distance).toBeNull();
    expect(r.fall.apexY).toBeNull();
  });
});

describe('updateFall × fallDamage — exact spec distances (review Important #2)', () => {
  it('exact 10-block walk-off → distance exactly 10 → 7 damage', () => {
    const land = simulateWalkOff(10, 0);
    expect(land.distance).toBe(10); // pre-physics capture keeps the exact ledge y
    expect(fallDamage(land.distance as number)).toBe(7); // floor(10 − 3)
  });

  it('exact 23-block walk-off → distance exactly 23 → 20 damage (a kill)', () => {
    const land = simulateWalkOff(23, 0);
    expect(land.distance).toBe(23);
    expect(fallDamage(land.distance as number)).toBe(20); // floor(23 − 3) = maxHp → dies
  });

  it('a jump up and back down nets only the jump height (< 3 → 0 damage)', () => {
    let s = resetFall();
    // leave the ground rising, peak at 65.27 (JUMP_SPEED 9, g 32 ≈ 1.27 blocks)
    let r = updateFall(s, 64, 64.13, false, false, false);
    s = r.fall;
    const frames: Array<[number, number]> = [
      [64.13, 64.5],
      [64.5, 65.1],
      [65.1, 65.27], // peak is this frame's postY → next frame's preY
      [65.27, 64.9],
      [64.9, 64.4],
    ];
    for (const [pre, post] of frames) {
      r = updateFall(s, pre, post, false, false, false);
      s = r.fall;
    }
    const land = updateFall(s, 64.4, 64, true, false, false);
    expect(land.distance).not.toBeNull();
    expect(land.distance as number).toBeLessThanOrEqual(1.3); // jump height only
    expect(fallDamage(land.distance as number)).toBe(0); // under the 3-block exemption
  });
});
