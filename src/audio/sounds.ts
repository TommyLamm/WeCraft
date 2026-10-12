import { BLOCK } from '../world/blocks';

/** What a block sounds like (see `materialGroup`). */
export type MaterialGroup =
  | 'dirt'
  | 'grass'
  | 'sand'
  | 'snow'
  | 'stone'
  | 'wood'
  | 'leaves'
  | 'glass'
  | 'water';

/** What the player did to the block. */
export type SoundKind = 'dig' | 'break' | 'place' | 'step';

export interface SynthParams {
  filter: 'lowpass' | 'bandpass' | 'highpass';
  freq: number;
  q: number;
  durationSec: number;
  gain: number;
}

/** Block id → material group. Everything unmapped (air, modded ids) is dirt. */
const GROUP_BY_BLOCK: Record<number, MaterialGroup> = {
  [BLOCK.GRASS]: 'grass',
  [BLOCK.DIRT]: 'dirt',
  [BLOCK.SAND]: 'sand',
  [BLOCK.SNOW]: 'snow',
  [BLOCK.STONE]: 'stone',
  [BLOCK.COBBLE]: 'stone',
  [BLOCK.COAL_ORE]: 'stone',
  [BLOCK.IRON_ORE]: 'stone',
  [BLOCK.BEDROCK]: 'stone',
  [BLOCK.LOG]: 'wood',
  [BLOCK.PLANKS]: 'wood',
  [BLOCK.CRAFTING_TABLE]: 'wood',
  [BLOCK.FURNACE]: 'stone',
  [BLOCK.LEAVES]: 'leaves',
  [BLOCK.GLASS]: 'glass',
  [BLOCK.WATER]: 'water',
};

export function materialGroup(blockId: number): MaterialGroup {
  return GROUP_BY_BLOCK[blockId] ?? 'dirt';
}

/** Distance (blocks) at which a sound is still at full volume. */
const NEAR_DIST = 3;
/** Distance (blocks) past which a sound is inaudible. */
const FAR_DIST = 20;

/** Volume by listener distance: 1 within 3 blocks, 0 at 20+, linear between.
 *  Non-finite distance (NaN/±Infinity) → 0 — never a NaN gain. */
export function gainForDistance(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  if (distance <= NEAR_DIST) return 1;
  if (distance >= FAR_DIST) return 0;
  return (FAR_DIST - distance) / (FAR_DIST - NEAR_DIST);
}

/** Step cadence (seconds between footstep sounds) for a horizontal speed in
 *  blocks/s: one step per 1.35 blocks travelled, clamped to [0.3, 0.55].
 *  Standing still (≤0.1) or a non-finite speed → Infinity (never step). */
export function footstepInterval(horSpeed: number): number {
  if (!Number.isFinite(horSpeed) || horSpeed <= 0.1) return Infinity;
  return Math.min(0.55, Math.max(0.3, 1.35 / horSpeed));
}

interface GroupBase {
  filter: SynthParams['filter'];
  freq: number;
  q: number;
}

/** Per-material filter bed the kind modulation scales (Task 9 table). */
const GROUP_BASE: Record<MaterialGroup, GroupBase> = {
  dirt: { filter: 'lowpass', freq: 700, q: 0.7 },
  grass: { filter: 'lowpass', freq: 900, q: 0.7 },
  sand: { filter: 'lowpass', freq: 1200, q: 0.7 },
  snow: { filter: 'lowpass', freq: 600, q: 0.7 },
  stone: { filter: 'bandpass', freq: 1100, q: 1.2 },
  wood: { filter: 'bandpass', freq: 800, q: 1.0 },
  leaves: { filter: 'highpass', freq: 1800, q: 0.8 },
  glass: { filter: 'highpass', freq: 3000, q: 1.0 },
  water: { filter: 'lowpass', freq: 500, q: 0.6 },
};

interface KindMod {
  durationSec: number;
  gain: number;
  /** Frequency scale applied to the material base frequency. */
  scale: number;
}

/** Per-action envelope/loudness/pitch modulation (Task 9 table). */
const KIND_MOD: Record<SoundKind, KindMod> = {
  dig: { durationSec: 0.12, gain: 0.5, scale: 1 },
  break: { durationSec: 0.18, gain: 0.6, scale: 0.85 },
  place: { durationSec: 0.09, gain: 0.5, scale: 0.7 },
  step: { durationSec: 0.08, gain: 0.25, scale: 0.9 },
};

/** Material × action → synthesis parameters for `playOneShot`. */
export function synthParams(group: MaterialGroup, kind: SoundKind): SynthParams {
  const base = GROUP_BASE[group];
  const mod = KIND_MOD[kind];
  return {
    filter: base.filter,
    freq: Math.round(base.freq * mod.scale),
    q: base.q,
    durationSec: mod.durationSec,
    gain: mod.gain,
  };
}
