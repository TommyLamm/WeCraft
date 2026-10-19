import type { GameMode } from './inventory';
import { sanitizeSlots, starterSlots, type ItemStack } from './items';
import { createVitals, normalizeVitals, type Vitals } from '../player/survival';

/** Per-mode live state that survives mode switches (B1.3). Each mode keeps its
 *  OWN 9-slot hotbar, and vitals exist in survival only — switching modes must
 *  not destroy the other mode's inventory or reset HP/hunger. Pure in-memory
 *  state: main owns the single instance and the save payloads carry a
 *  `StashPayload` copy (Task 3). Every function returns new objects — callers
 *  never alias. */
export interface ModeStash {
  survival: Array<ItemStack | null>;
  creative: Array<ItemStack | null>;
  survivalVitals: Vitals;
}

/** The stash as it is stored in a save payload (B1.3 v3; Task 4 reuses it for
 *  the cloud shape). Structurally the in-memory {@link ModeStash}; separately
 *  named because the payload side is the shipped, permanent format — once a v3
 *  record exists, older builds cannot read it. */
export type StashPayload = {
  survival: Array<ItemStack | null>;
  creative: Array<ItemStack | null>;
  survivalVitals: Vitals;
};

/** Slots per mode: the live hotbar width (`starterSlots` is HOTBAR_DEFAULT-shaped). */
const SLOTS_PER_MODE = starterSlots('survival').length;

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

/** Rebuild a live stash from a save record — works for every payload version:
 *  - v3 carries a stash: both sides are sanitized (unknown ids and junk counts
 *    read as empty slots) and `survivalVitals` is normalized. A side that is
 *    MISSING from the record is filled with that mode's `starterSlots` — also
 *    when the stash records only `survivalVitals` (those vitals are kept); a
 *    side that is present but corrupt sanitizes to nulls.
 *  - v1/v2 carry only the recorded mode's live inventory + vitals, so those
 *    become that mode's side, the other mode starts from its starter kit, and
 *    survival vitals come from the record (creative saves carry none → fresh).
 *  Never throws; the result is a fresh stash — the raw record is only read. */
export function normalizeModeStash(
  raw: unknown,
  legacy: { mode: GameMode; inventory: unknown; vitals: unknown },
): ModeStash {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  // A side-less stash that still records vitals is treated as a stash too:
  // the LEGACY branch would re-derive vitals and drop the recorded values
  // (progress loss). Missing sides below still get their starter kits.
  if ('survival' in r || 'creative' in r || 'survivalVitals' in r) {
    return {
      survival: 'survival' in r ? sanitizeSlots(r.survival, SLOTS_PER_MODE) : starterSlots('survival'),
      creative: 'creative' in r ? sanitizeSlots(r.creative, SLOTS_PER_MODE) : starterSlots('creative'),
      survivalVitals: normalizeVitals(r.survivalVitals),
    };
  }
  const recorded = sanitizeSlots(legacy.inventory, SLOTS_PER_MODE);
  return {
    survival: legacy.mode === 'survival' ? recorded : starterSlots('survival'),
    creative: legacy.mode === 'creative' ? recorded : starterSlots('creative'),
    // `normalizeVitals(undefined)` is fresh vitals — a creative record has none.
    survivalVitals:
      legacy.mode === 'survival' ? normalizeVitals(legacy.vitals) : normalizeVitals(undefined),
  };
}
