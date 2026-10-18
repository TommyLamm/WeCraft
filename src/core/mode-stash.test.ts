import { describe, it, expect } from 'vitest';
import { createModeStash, saveModeState, loadModeSlots } from './mode-stash';
import { maxStack, starterSlots, type ItemStack } from './items';
import { createVitals } from '../player/survival';

/** The live hotbar is 9 slots (shared HOTBAR_DEFAULT length). */
const HOTBAR_LENGTH = 9;

describe('mode stash — per-mode state survives switches', () => {
  it('createModeStash starts survival empty, creative full and fresh vitals', () => {
    const stash = createModeStash();
    expect(stash.survival).toEqual(new Array(HOTBAR_LENGTH).fill(null));
    expect(stash.creative).toEqual(starterSlots('creative'));
    // "full": every creative slot holds a whole stack of its item
    expect(stash.creative.every((s) => s !== null && s.count === maxStack(s.item))).toBe(true);
    expect(stash.survivalVitals).toEqual(createVitals());
    // fresh per call — two stashes never share arrays or the vitals object
    const other = createModeStash();
    expect(stash.survival).not.toBe(other.survival);
    expect(stash.creative).not.toBe(other.creative);
    expect(stash.survivalVitals).not.toBe(other.survivalVitals);
  });

  it('saveModeState copies slots deep — later live mutations never leak', () => {
    const stash = createModeStash();
    const liveDirt: ItemStack = { item: 'dirt', count: 3 };
    const liveSlots: Array<ItemStack | null> = [liveDirt, null, { item: 'stone', count: 64 }];
    const next = saveModeState(stash, 'survival', liveSlots, createVitals());

    // mutate the caller's live array/stack AFTER saving
    liveDirt.count = 99;
    liveSlots[1] = { item: 'sand', count: 1 };
    liveSlots[2] = null;

    expect(next).not.toBe(stash); // new stash object, never a mutation
    expect(next.survival[0]).toEqual({ item: 'dirt', count: 3 }); // snapshot, not the live stack
    expect(next.survival[1]).toBeNull();
    expect(next.survival[2]).toEqual({ item: 'stone', count: 64 });
    expect(stash.survival).toEqual(new Array(HOTBAR_LENGTH).fill(null)); // input stash untouched
  });

  it('saveModeState stores survival vitals only on survival', () => {
    const stash = createModeStash();
    const bootVitals = stash.survivalVitals;
    const hurt = { ...createVitals(), hp: 6, hunger: 11 };

    // saving in creative never touches survivalVitals — even with vitals in hand
    const afterCreative = saveModeState(stash, 'creative', [], hurt);
    expect(afterCreative.survivalVitals).toEqual(createVitals());

    // saving in survival stores a COPY of the live vitals
    const afterSurvival = saveModeState(afterCreative, 'survival', [], hurt);
    expect(afterSurvival.survivalVitals).toEqual(hurt);
    expect(afterSurvival.survivalVitals).not.toBe(hurt); // snapshot, not a live alias
    expect(bootVitals).toEqual(createVitals()); // the boot stash's object never mutated
    // a survival save without vitals keeps the previous snapshot instead of wiping it
    expect(saveModeState(afterSurvival, 'survival', [], null).survivalVitals).toEqual(hurt);
  });

  it('loadModeSlots returns fresh copies', () => {
    const stash = createModeStash();
    const creativeBefore = stash.creative.map((s) => (s ? { ...s } : null));

    const loaded = loadModeSlots(stash, 'creative');
    expect(loaded).toEqual(creativeBefore);
    expect(loaded).not.toBe(stash.creative);

    // mutating the returned array / stacks never reaches the stash
    loaded[0]!.count = 1;
    loaded[1] = null;
    expect(stash.creative[0]).toEqual(creativeBefore[0]);
    expect(stash.creative[1]).toEqual(creativeBefore[1]);

    expect(loadModeSlots(stash, 'survival')).toEqual(new Array(HOTBAR_LENGTH).fill(null));
    expect(loadModeSlots(stash, 'creative')).not.toBe(loaded); // a new array every call
  });

  it('round-trip: survival A/V → creative B → back yields A and V', () => {
    const A: Array<ItemStack | null> = [
      { item: 'dirt', count: 12 },
      null,
      { item: 'apple', count: 2 },
    ];
    const V = { ...createVitals(), hp: 13, hunger: 9, saturation: 3 };
    let stash = createModeStash();

    // survival → creative: A/V are stashed, the creative kit loads instead
    stash = saveModeState(stash, 'survival', A, V);
    expect(loadModeSlots(stash, 'creative')).toEqual(starterSlots('creative'));

    // creative → survival: B is stashed, A and V come back exactly
    const B: Array<ItemStack | null> = [{ item: 'stone', count: 7 }];
    stash = saveModeState(stash, 'creative', B, null);
    expect(loadModeSlots(stash, 'survival')).toEqual(A);
    expect(stash.survivalVitals).toEqual(V);
    expect(stash.survivalVitals).not.toBe(V); // copied on save, not aliased
    expect(loadModeSlots(stash, 'creative')).toEqual(B); // B also survived
  });
});
