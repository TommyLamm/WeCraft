/** Fall-apex lifecycle for player fall damage (plan 9.1) — pure, unit-tested,
 *  no DOM/Three, inputs never mutated (a NEW state is returned each call).
 *
 *  Physics exposes only `onGround` (no built-in fall distance), so the airborne
 *  peak is tracked here: airborne → remember the peak, landing → distance =
 *  peak − landed y. Water contact and flight clear the apex WITHOUT damage
 *  (plan 9.1 "landing on water/ground decides resetFall"); hops under the
 *  3-block exemption are absorbed by `fallDamage` in survival.ts. Death from a
 *  big drop is applied by main.ts (composition-root convention). */

export interface FallState {
  /** Peak y of the current airborne span, or null when no fall is in progress
   *  (grounded with nothing tracked, flying, or in water). */
  apexY: number | null;
}

/** Fresh state with nothing tracked. Main.ts calls this on respawn — a stale
 *  apex carried across sessions would turn the next spawn fall into a one-shot
 *  kill (review Critical #1). */
export function resetFall(): FallState {
  return { apexY: null };
}

/** Advance the fall state by one frame.
 *
 *  Contract (checked in fallstate.test.ts):
 *  - `flying` or `inWater`: apex cleared, distance null — not a fall;
 *  - airborne (post-physics not grounded): apex = max(apex ?? preY, preY),
 *    distance null. `preY` is the PRE-physics y — the apex must keep the exact
 *    pre-fall height: reading y after physics lost g·dt² ≈ 0.009 on the first
 *    airborne frame, which made every integer-height fall deal 1 less
 *    (floor(D−ε−3) = D−4, review Important #2);
 *  - grounded with an apex: distance = apex − postY (post-physics y is the
 *    landed y), apex cleared. This is the landing contract — the other half of
 *    the stale-apex fix (session reset) lives in main's resetPlayerToSpawn;
 *  - grounded with no apex: distance null.
 *
 *  Non-finite pre/post y leaves the state untouched (repo NaN-guard norm). */
export function updateFall(
  state: FallState,
  preY: number,
  postY: number,
  grounded: boolean,
  flying: boolean,
  inWater: boolean,
): { fall: FallState; distance: number | null } {
  if (!Number.isFinite(preY) || !Number.isFinite(postY)) {
    return { fall: state, distance: null };
  }
  if (flying || inWater) return { fall: { apexY: null }, distance: null };
  if (!grounded) {
    const apex = state.apexY;
    return { fall: { apexY: Math.max(apex ?? preY, preY) }, distance: null };
  }
  // grounded landing: report the drop from the apex (null when none tracked), then clear
  const distance = state.apexY !== null ? state.apexY - postY : null;
  return { fall: { apexY: null }, distance };
}
