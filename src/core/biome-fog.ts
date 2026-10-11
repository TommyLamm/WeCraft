/** Biome fog tinting (pure — no Three/DOM).
 *  Phase 3 Task 6: the day/night fog color is nudged toward a per-biome tint
 *  so walking from plains into desert/forest/snow subtly recolors the haze
 *  and the horizon. `main.ts` samples the biome every 0.5 s and passes the
 *  tinted colors to `scene.setDayNight` (fog + background). */

import { lerpColor } from './daynight';
import type { Biome } from '../world/terrain';

/** Per-biome tint target. plains is WHITE because it is the neutral biome —
 *  see `applyBiomeTint`, which deliberately short-circuits it. */
export const BIOME_FOG_TINT: Record<Biome, number> = {
  plains: 0xffffff,
  desert: 0xffd9a0,
  forest: 0xc2e0b2,
  snow: 0xe8f4ff,
};

const NEUTRAL_TINT = 0xffffff;

/** Blend `fogHex` toward its biome tint by `strength` (default 25%): a
 *  per-channel lerp with integer rounding (`lerpColor`), so every channel
 *  moves fractionally toward the tint instead of a hard color swap.
 *
 *  plains is the NEUTRAL biome: lerping toward white would BRIGHTEN an
 *  arbitrary fog color (0x808080 → 0x9f9f9f), so the neutral tint returns
 *  `fogHex` unchanged. A non-finite or ≤ 0 `strength` is likewise a no-op. */
export function applyBiomeTint(fogHex: number, biome: Biome, strength = 0.25): number {
  const tint = BIOME_FOG_TINT[biome];
  if ((tint >>> 0) === NEUTRAL_TINT) return fogHex;
  if (!Number.isFinite(strength) || strength <= 0) return fogHex;
  return lerpColor(fogHex, tint, strength);
}
