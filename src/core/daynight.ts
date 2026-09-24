/** Day/night cycle math (pure — no Three/DOM).
 *  The clock is a normalized `t ∈ [0, 1)` over one full day:
 *  0.0 = dawn, 0.25 = noon, 0.5 = dusk, 0.75 = midnight.
 *  Sun, phase, sky/fog colors and light intensities are all derived from `t`,
 *  so the renderer just feeds `sunDirection(t)` + `skyColors(t)` each frame. */

/** Normalized day clock: `t` cycles [0, 1), `dayLengthSec` is one full cycle. */
export interface Clock {
  t: number;
  dayLengthSec: number;
}

/** `'day'` for `t ∈ [0, 0.5)`, `'night'` for `t ∈ [0.5, 1)`. */
export type Phase = 'day' | 'night';

/** Plain vec3 — `core/` must not depend on Three. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Per-frame render inputs derived from `t`: colors as 0xRRGGBB hex numbers
 *  (scene.ts converts to `THREE.Color`), light intensities as plain numbers. */
export interface DayNightColors {
  sky: number;
  fog: number;
  ambient: number;
  sunIntensity: number;
}

/** One full day/night cycle length, in seconds (settings clamp: 60–3600). */
export const DEFAULT_DAY_LENGTH_SEC = 600;

const DAY_SKY = 0x87ceeb;
const NIGHT_SKY = 0x0a0e1a;
/** Dawn/dusk horizon glow blended over the base sky. */
const GOLDEN_SKY = 0xff9a5c;
/** Circular window half-width around t=0 (dawn) and t=0.5 (dusk) where the
 *  golden glow blends in (peak weight 1 at the center). */
const ORANGE_HALF_WIDTH = 0.06;
/** Golden glow reaches 85% at the window center — keeps a hint of sky hue. */
const ORANGE_PEAK = 0.85;

const DAY_AMBIENT = 0.75;
const NIGHT_AMBIENT = 0.25;
const DAY_SUN = 0.9;
const NIGHT_SUN = 0.12;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const lerp = (a: number, b: number, f: number): number => a + (b - a) * f;

/** Per-channel (r/g/b of 0xRRGGBB) linear blend `a → b`, rounded to integers.
 *  `f` is clamped to [0, 1]; non-finite `f` behaves as 0 (returns `a`). */
export function lerpColor(a: number, b: number, f: number): number {
  const t = Number.isFinite(f) ? clamp01(f) : 0;
  const r = Math.round(lerp((a >>> 16) & 0xff, (b >>> 16) & 0xff, t));
  const g = Math.round(lerp((a >>> 8) & 0xff, (b >>> 8) & 0xff, t));
  const bl = Math.round(lerp(a & 0xff, b & 0xff, t));
  return (r << 16) | (g << 8) | bl;
}

/** Fresh clock starting mid-morning (`t = 0.25`). Non-positive or non-finite
 *  `dayLengthSec` falls back to {@link DEFAULT_DAY_LENGTH_SEC}. */
export function createClock(dayLengthSec: number = DEFAULT_DAY_LENGTH_SEC): Clock {
  const len =
    Number.isFinite(dayLengthSec) && dayLengthSec > 0
      ? dayLengthSec
      : DEFAULT_DAY_LENGTH_SEC;
  return { t: 0.25, dayLengthSec: len };
}

/** Advance by `dtSec / dayLengthSec`, wrapping at 1.0 → 0 (handles overshoot
 *  past a full day via `t - floor(t)`). Zero, negative or non-finite `dtSec`
 *  is a no-op returning a copy — repo NaN-guard norm (see player/survival.ts).
 *  Pure: the input clock is never mutated. */
export function tickClock(c: Clock, dtSec: number): Clock {
  if (!Number.isFinite(dtSec) || dtSec <= 0) return { ...c };
  const t = c.t + dtSec / c.dayLengthSec;
  return { ...c, t: t - Math.floor(t) };
}

/** Day/night split: `[0, 0.5)` = day (noon 0.25), `[0.5, 1)` = night (midnight 0.75). */
export function phaseOf(t: number): Phase {
  return t < 0.5 ? 'day' : 'night';
}

/** Sun position on a vertical north–south arc: noon (t=0.25) straight up
 *  (y=1), midnight (t=0.75) straight down (y=−1), horizon at t=0/0.5.
 *  Always unit length (x is 0 — an arc in the y/z plane is enough for lighting). */
export function sunDirection(t: number): Vec3 {
  const angle = (t - 0.25) * Math.PI * 2;
  return { x: 0, y: Math.cos(angle), z: Math.sin(angle) };
}

/** Linear weight of a circular window around `center`: 1 at the center,
 *  linearly down to 0 at `ORANGE_HALF_WIDTH` (t wraps, so distance is circular). */
function windowWeight(t: number, center: number): number {
  const d = Math.abs(t - center);
  const dist = Math.min(d, 1 - d);
  return dist >= ORANGE_HALF_WIDTH ? 0 : 1 - dist / ORANGE_HALF_WIDTH;
}

/** Sky/fog/light state for clock position `t`:
 *  - `dayF` — 1 well above the horizon, 0 well below (smoothstep-ish via sun
 *    elevation); drives base sky lerp plus ambient/sun intensities.
 *  - Golden `#ff9a5c` window blends over the base sky around dawn (t≈0) and
 *    dusk (t≈0.5), so the day→night sky fall always reads as a sunset.
 *  `fog` always equals `sky` (Phase 1 scene keeps both in lockstep). */
export function skyColors(t: number): DayNightColors {
  const elev = Math.cos((t - 0.25) * Math.PI * 2); // sun elevation (= sunDirection(t).y)
  const dayF = clamp01((elev + 0.2) / 0.4);
  const base = lerpColor(NIGHT_SKY, DAY_SKY, dayF);
  const orangeW = Math.max(windowWeight(t, 0), windowWeight(t, 0.5));
  const sky = lerpColor(base, GOLDEN_SKY, orangeW * ORANGE_PEAK);
  return {
    sky,
    fog: sky,
    ambient: lerp(NIGHT_AMBIENT, DAY_AMBIENT, dayF),
    sunIntensity: lerp(NIGHT_SUN, DAY_SUN, dayF),
  };
}
