/** Biome fog tinting (pure — no Three/DOM).
 *  Phase 3 Task 6: the day/night fog color is nudged toward a per-biome tint
 *  so walking from plains into desert/forest/snowy_plains subtly recolors the
 *  haze and the horizon. `main.ts` samples the biome every 0.5 s and passes
 *  the tinted colors to `scene.setDayNight` (fog + background).
 *  B3 Task 2：霧色表由 4 種擴到 8 種（新增的 id 是 `biomeAt` 會回報的
 *  ocean／birch_forest／taiga／snowy_plains／mountains；舊的 `snow` 改名為
 *  `snowy_plains`，色值沿用 0xe8f4ff）。 */

import { lerpColor } from './daynight';
import type { Biome } from '../world/terrain';

/** Per-biome tint target. plains is WHITE because it is the neutral biome —
 *  see `applyBiomeTint`, which deliberately short-circuits it.
 *  `Record<Biome, number>` is exhaustive: adding a biome without a color
 *  here is a compile error. */
export const BIOME_FOG_TINT: Record<Biome, number> = {
  ocean: 0xa8c8e8,
  plains: 0xffffff,
  forest: 0xc2e0b2,
  birch_forest: 0xd2e8bc,
  taiga: 0xb8d4c8,
  snowy_plains: 0xe8f4ff,
  desert: 0xffd9a0,
  mountains: 0xdce6f2,
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
