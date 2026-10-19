/** Post-hit invulnerability window (Task 9, B1.5): after the player takes mob
 *  damage a short window opens during which further mob hits are ignored —
 *  vanilla's 0.5 s `invulnerableTime`. With a pack of mobs each swiping on its
 *  own cooldown, the window is what caps incoming damage at ONE hit per 0.5 s
 *  (a lone zombie's 1 s attack cooldown is already slower than that) instead of
 *  letting several mobs land hits back-to-back in the same frame.
 *
 *  Pure — no DOM/Three, no clock of its own: the caller passes `nowSec`
 *  (`main.ts` uses `performance.now() / 1000`, computed ONCE per event) so the
 *  window is unit-testable with plain numbers. `markHurt` returns a NEW object;
 *  inputs are never mutated (same purity contract as survival.ts/fallstate.ts).
 *
 *  Only MOB damage is gated by this window. Fall damage and starvation keep
 *  their own cadence — neither reads or writes an `Invuln`. */

/** Seconds of invulnerability granted per landed mob hit. */
export const HURT_INVULN_SEC = 0.5;

export interface Invuln {
  /** Clock time (seconds, caller's origin) at which the window closes; the
   *  window is closed — and the next hit may land — once `nowSec >= untilSec`. */
  untilSec: number;
}

/** Fresh window state: no hit has been recorded yet, so the first hit always
 *  lands. `−Infinity` (rather than 0) keeps that true for any clock origin. */
export function createInvuln(): Invuln {
  return { untilSec: Number.NEGATIVE_INFINITY };
}

/** True when no hurt window is open at `nowSec` — i.e. the hit may land. The
 *  comparison is inclusive, so a hit at exactly `untilSec` lands (0.5 s of
 *  protection ⇒ damage resumes at +0.5 s).
 *
 *  Total for any input, never throws: NaN compares false → blocked, so a broken
 *  clock can never spam damage; ±Infinity follow the same rule (past any finite
 *  window → allowed, before it → blocked). */
export function canBeHurt(inv: Invuln, nowSec: number): boolean {
  return nowSec >= inv.untilSec;
}

/** Record a landed hit at `nowSec`: the window now closes at
 *  `nowSec + HURT_INVULN_SEC`, restarting a running one. Returns a NEW object.
 *
 *  A non-finite `nowSec` is a no-op copy (repo NaN-guard norm): NaN would make
 *  every later `canBeHurt` false — permanently invulnerable — and +Infinity
 *  would block the rest of the session, so neither is ever stored. */
export function markHurt(inv: Invuln, nowSec: number): Invuln {
  if (!Number.isFinite(nowSec)) return { ...inv };
  return { untilSec: nowSec + HURT_INVULN_SEC };
}
