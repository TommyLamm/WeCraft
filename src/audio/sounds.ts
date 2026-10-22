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

/** Block id → material group. Everything unmapped (air, modded ids) is dirt.
 *  **未登錄者 fallback `'dirt'`** → 新增方塊 id 必須同步登錄這張表，否則音效錯
 *  （`sounds.test.ts` 的「表長度 == BLOCK 筆數」斷言就是這條的守門）。 */
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
  // B3 Task 3：雲杉／白樺（未登記者會落到預設 'dirt' 音）
  [BLOCK.SPRUCE_LOG]: 'wood',
  [BLOCK.SPRUCE_LEAVES]: 'leaves',
  [BLOCK.BIRCH_LOG]: 'wood',
  [BLOCK.BIRCH_LEAVES]: 'leaves',
  // B3 Task 4：花／草是草的聲音；原版仙人掌也走草的音色；冰是清脆的玻璃聲
  [BLOCK.DANDELION]: 'grass',
  [BLOCK.POPPY]: 'grass',
  [BLOCK.SHORT_GRASS]: 'grass',
  [BLOCK.CACTUS]: 'grass',
  [BLOCK.ICE]: 'glass',
  // B4 Task 1：羊毛是柔軟質地 → 走既有的 'leaves'（高頻沙沙）音色，
  // 不新增 MaterialGroup 成員（羊毛原版也是柔軟的布料聲）。
  [BLOCK.WOOL]: 'leaves',
  // B5 Task 1：礫石是顆粒質地 → 走 'sand' 的沙沙聲（原版礫石也是顆粒音）；
  // 金礦／鑽石礦是石頭底 → 'stone'；雲杉／白樺板材 → 'wood'。
  [BLOCK.GRAVEL]: 'sand',
  [BLOCK.GOLD_ORE]: 'stone',
  [BLOCK.DIAMOND_ORE]: 'stone',
  [BLOCK.SPRUCE_PLANKS]: 'wood',
  [BLOCK.BIRCH_PLANKS]: 'wood',
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
