import type { GameMode } from './inventory';
import { starterSlots, type ItemStack } from './items';
import { createVitals, type Vitals } from '../player/survival';

/** Per-mode live state that survives mode switches (B1.3). Each mode keeps its
 *  OWN 9-slot hotbar, and vitals exist in survival only — switching modes must
 *  not destroy the other mode's inventory or reset HP/hunger. Pure in-memory
 *  state: main owns the single instance; save payloads carry a stash in a
 *  later task. Every function returns new objects — callers never alias. */
export interface ModeStash {
  survival: Array<ItemStack | null>;
  creative: Array<ItemStack | null>;
  survivalVitals: Vitals;
}

/** Fresh stash for a new session: survival hotbar empty (vanilla parity —
 *  starterSlots('survival') is 9 × null), creative kit full and fresh vitals. */
export function createModeStash(): ModeStash {
  return {
    survival: starterSlots('survival'),
    creative: starterSlots('creative'),
    survivalVitals: createVitals(),
  };
}

/** Record `mode`'s live state into a NEW stash. The saved slots are deep
 *  copies (fresh array + `{ ...stack }` per non-null entry) and survival
 *  vitals are copied too — later gameplay mutates the live objects through
 *  their own references, which must never reach the stash. Saving in creative
 *  leaves `survivalVitals` alone (there are no creative vitals); a survival
 *  save with `vitals === null` keeps the previous snapshot. The untouched
 *  mode's arrays are carried over as-is — reads always go through
 *  `loadModeSlots`, which copies. */
export function saveModeState(
  stash: ModeStash,
  mode: GameMode,
  slots: ReadonlyArray<ItemStack | null>,
  vitals: Vitals | null,
): ModeStash {
  const copy = slots.map((s) => (s ? { ...s } : null));
  if (mode === 'creative') {
    return { survival: stash.survival, creative: copy, survivalVitals: stash.survivalVitals };
  }
  return {
    survival: copy,
    creative: stash.creative,
    survivalVitals: vitals ? { ...vitals } : stash.survivalVitals,
  };
}

/** `mode`'s stashed hotbar as a fresh copy (new array, new stack objects) —
 *  callers write the result into live slot arrays, so repeated calls must
 *  never alias the stash or each other. */
export function loadModeSlots(stash: ModeStash, mode: GameMode): Array<ItemStack | null> {
  const slots = mode === 'creative' ? stash.creative : stash.survival;
  return slots.map((s) => (s ? { ...s } : null));
}
