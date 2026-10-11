import { blockFromItem, type ItemId } from './items';

/** What the first-person viewmodel should show for the selected hotbar slot:
 *  `none` (empty hand), a block CUBE (`blockId`), or a flat ICON for every
 *  non-block item (tools, food, …). Pure mapping — no Three/DOM. */
export type ViewmodelItem =
  | { kind: 'none' }
  | { kind: 'block'; blockId: number }
  | { kind: 'icon'; item: ItemId };

/** Map a selected slot's item (null = empty slot) to its viewmodel form. */
export function viewmodelItem(item: ItemId | null): ViewmodelItem {
  if (item === null) return { kind: 'none' };
  const blockId = blockFromItem(item);
  return blockId !== null ? { kind: 'block', blockId } : { kind: 'icon', item };
}

/** Swing animation state: normalized progress `t ∈ [0, 1]` + whether a swing
 *  is in flight (`active` gates stepping — an idle swing must not drift). */
export interface Swing {
  t: number;
  active: boolean;
}

/** One full swing takes this long (seconds) — the brief pins 0.25, and the
 *  mining re-trigger interval in main matches it so swings chain seamlessly. */
const SWING_DURATION_SEC = 0.25;

/** Begin a swing: progress resets to the start, marked active. */
export function startSwing(_s: Swing): Swing {
  return { t: 0, active: true };
}

/** Advance a swing by `dt` seconds. Non-finite `dt` (NaN/∞) returns the state
 *  untouched; reaching/passing the end finishes the swing at `t = 1`. */
export function stepSwing(s: Swing, dt: number): Swing {
  if (!Number.isFinite(dt)) return s;
  const t = s.t + dt / SWING_DURATION_SEC;
  if (t >= 1) return { t: 1, active: false };
  return { t, active: s.active };
}

/** Clamp to [0, 1] (same helper as core/daynight.ts). */
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Swing pose offsets at progress `t` (clamped): the hand dips forward/down
 *  while the wrist rotates down — a full sine arc that starts and ends at 0. */
export function swingCurve(t: number): { rotX: number; posY: number; posZ: number } {
  const k = Math.sin(Math.PI * clamp01(t));
  return { rotX: -1.4 * k, posY: -0.15 * k, posZ: -0.25 * k };
}

/** Walk-bob offsets at `phase` (radians, accumulated from horizontal speed
 *  by the caller): a small vertical bob at the step rate, a half-rate lateral
 *  sway, and a matching roll. */
export function bobCurve(phase: number): { posY: number; posX: number; rotZ: number } {
  return {
    posY: 0.02 * Math.sin(phase),
    posX: 0.015 * Math.sin(phase / 2),
    rotZ: 0.03 * Math.sin(phase),
  };
}
