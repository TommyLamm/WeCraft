import { describe, it, expect } from 'vitest';
import { HURT_INVULN_SEC, createInvuln, canBeHurt, markHurt } from './invuln';

describe('invuln — hurt window', () => {
  it('new invuln allows the first hit', () => {
    expect(canBeHurt(createInvuln(), 0)).toBe(true);
    expect(canBeHurt(createInvuln(), 123.45)).toBe(true);
  });

  it('blocks hits inside the 0.5 s window and allows again at exactly 0.5 s', () => {
    expect(HURT_INVULN_SEC).toBe(0.5);
    const inv = markHurt(createInvuln(), 10);
    expect(inv.untilSec).toBe(10.5);
    expect(canBeHurt(inv, 10)).toBe(false); // the marking hit itself
    expect(canBeHurt(inv, 10.499)).toBe(false);
    expect(canBeHurt(inv, 10.5)).toBe(true); // boundary is inclusive
    expect(canBeHurt(inv, 10.6)).toBe(true);
  });

  it('markHurt restarts the window', () => {
    const first = markHurt(createInvuln(), 3); // window 3 .. 3.5
    const again = markHurt(first, 5); // hurt again mid-window → 5 .. 5.5
    expect(again).not.toBe(first);
    expect(first.untilSec).toBe(3.5); // input untouched (pure: NEW object)
    expect(again.untilSec).toBe(5.5);
    expect(canBeHurt(again, 5.25)).toBe(false);
    expect(canBeHurt(again, 5.5)).toBe(true);
  });

  it('non-finite now never throws and compares as blocked/allowed sensibly', () => {
    const inv = markHurt(createInvuln(), 1); // window 1 .. 1.5
    expect(canBeHurt(inv, Number.NaN)).toBe(false); // blocked: a broken clock never lands a hit
    expect(canBeHurt(inv, Number.POSITIVE_INFINITY)).toBe(true); // allowed: past any finite window
    expect(canBeHurt(inv, Number.NEGATIVE_INFINITY)).toBe(false); // blocked: before it
    // A non-finite markHurt must never poison the window: NaN would block every
    // later hit, +Infinity would block the rest of the session. Both are no-ops
    // that still return a NEW object (repo NaN-guard norm).
    const nan = markHurt(inv, Number.NaN);
    expect(nan).not.toBe(inv);
    expect(nan.untilSec).toBe(1.5);
    expect(canBeHurt(nan, 2)).toBe(true);
    const inf = markHurt(inv, Number.POSITIVE_INFINITY);
    expect(inf).not.toBe(inv);
    expect(inf.untilSec).toBe(1.5);
    expect(canBeHurt(inf, 2)).toBe(true);
  });
});
