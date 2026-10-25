import { describe, it, expect } from 'vitest';
import {
  createModeStash,
  normalizeModeStash,
  saveModeState,
  loadModeSlots,
} from './mode-stash';
import { INVENTORY_SLOTS, maxStack, starterSlots, type ItemStack } from './items';
import { createVitals } from '../player/survival';

/** B5 Task 7：每個模式各存一份 36 格背包（熱鍵列 9 ＋ 主背包 27）。 */
const INVENTORY_WIDTH = INVENTORY_SLOTS;

/** Inventory-shaped slots: `items` padded with nulls to the shared width. */
function padded(items: Array<ItemStack | null>): Array<ItemStack | null> {
  return [...items, ...new Array(INVENTORY_WIDTH - items.length).fill(null)];
}

describe('mode stash — per-mode state survives switches', () => {
  it('createModeStash starts survival empty, creative full and fresh vitals', () => {
    const stash = createModeStash();
    expect(stash.survival).toEqual(new Array(INVENTORY_WIDTH).fill(null));
    expect(stash.survival).toHaveLength(36);
    expect(stash.creative).toEqual(starterSlots('creative'));
    expect(stash.creative).toHaveLength(36);
    // "full": the 9-slot HOTBAR ROW holds whole stacks; the 27 main slots are empty
    expect(
      stash.creative.slice(0, 9).every((s) => s !== null && s.count === maxStack(s.item)),
    ).toBe(true);
    expect(stash.creative.slice(9).every((s) => s === null)).toBe(true);
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
    expect(stash.survival).toEqual(new Array(INVENTORY_WIDTH).fill(null)); // input stash untouched
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

  /** B7 Task 2：存檔前用 live 槽位再同步一次 stash 的**語意證明**。
   *
   *  stash 是「切換模式那一刻」的快照 → 之後工具在 live 槽位裡壞掉（整格變
   *  null）時，快照裡還留著那件工具。存檔路徑（`main.ts` 的 `syncModeStash`）
   *  因此會拿 live 槽位**覆寫**記錄模式那一側 —— 這一條釘住「覆寫是整側覆寫」：
   *  壞掉的工具不在 live 槽位裡 → 它不會從舊快照復活。 */
  it('saveModeState overwrites the recorded mode side with the live slots (a broken tool cannot come back)', () => {
    const stash = createModeStash();
    stash.survival[0] = { item: 'wooden_pickaxe', count: 1, dur: 1 };
    const next = saveModeState(stash, 'survival', [{ item: 'stone', count: 1 }], createVitals());
    expect(next.survival[0]).toEqual({ item: 'stone', count: 1 }); // 壞掉的工具不在 live slots → 不會復活
    expect(stash.survival[0]).toEqual({ item: 'wooden_pickaxe', count: 1, dur: 1 }); // 來源 stash 不被就地改寫
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

    expect(loadModeSlots(stash, 'survival')).toEqual(new Array(INVENTORY_WIDTH).fill(null));
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

/** B1.3 (Task 3): the same stash as it arrives from a save payload — v3 carries
 *  one, v1/v2 records carry only the recorded mode's inventory + vitals. */
describe('normalizeModeStash — payload restore', () => {
  /** The legacy half of a v1/v2 record — unknown-typed on purpose (raw JSON). */
  const legacy = (mode: 'survival' | 'creative', inventory: unknown, vitals: unknown) => ({
    mode,
    inventory,
    vitals,
  });

  it('normalizeModeStash derives the legacy side from a v2 record', () => {
    // a record written before exhaustion existed: normalizeVitals fills the bank
    const rawVitals = {
      hp: 7,
      maxHp: 20,
      hunger: 11,
      maxHunger: 20,
      saturation: 2,
      regenAcc: 0,
      starveAcc: 0,
    };

    // survival record → its (sanitized) inventory + vitals become the survival side
    const fromSurvival = normalizeModeStash(
      undefined, // v1/v2 records have no stash at all
      legacy(
        'survival',
        [{ item: 'stone', count: 32 }, null, { item: 'nope', count: 1 }],
        rawVitals,
      ),
    );
    expect(fromSurvival.survival).toEqual(padded([{ item: 'stone', count: 32 }]));
    expect(fromSurvival.creative).toEqual(starterSlots('creative')); // mode never played
    expect(fromSurvival.survivalVitals).toEqual({ ...rawVitals, exhaustion: 0 });

    // creative record → inventory → creative side; survival starts empty + FULL vitals
    const fromCreative = normalizeModeStash(
      null,
      legacy('creative', [{ item: 'dirt', count: 4 }], null),
    );
    expect(fromCreative.creative).toEqual(padded([{ item: 'dirt', count: 4 }]));
    expect(fromCreative.survival).toEqual(new Array(INVENTORY_WIDTH).fill(null));
    expect(fromCreative.survivalVitals).toEqual(createVitals()); // nothing to carry over
  });

  it('normalizeModeStash sanitizes corrupt slots instead of throwing', () => {
    const fromRaw = normalizeModeStash(
      {
        survival: [
          { item: 'stone', count: 64 },
          { item: 'nope', count: 1 },
          { item: 'dirt', count: 0 },
          { item: 'sand', count: Number.NaN },
          'junk',
          null,
        ],
        creative: 'junk', // present but not an array → all nulls, NOT the starter kit
        survivalVitals: { hp: 'junk' },
      },
      legacy('survival', [], null),
    );
    expect(fromRaw.survival).toEqual(padded([{ item: 'stone', count: 64 }]));
    expect(fromRaw.creative).toEqual(new Array(INVENTORY_WIDTH).fill(null));
    expect(fromRaw.survivalVitals).toEqual(createVitals()); // junk vitals → fresh defaults

    // a MISSING side is filled with that mode's starter kit instead
    const partial = normalizeModeStash({ survival: [] }, legacy('creative', [], null));
    expect(partial.survival).toEqual(new Array(INVENTORY_WIDTH).fill(null));
    expect(partial.creative).toEqual(starterSlots('creative'));

    // garbage raws never throw — they fall back to the legacy fields
    const fromJunk = normalizeModeStash('junk', legacy('survival', [], null));
    expect(fromJunk.survival).toEqual(new Array(INVENTORY_WIDTH).fill(null));
    expect(fromJunk.creative).toEqual(starterSlots('creative'));
  });

  it('normalizeModeStash keeps vitals from a stash that carries only survivalVitals', () => {
    // A malformed v3 stash can lack both slot sides but still record vitals —
    // the gate must see it as a stash (vitals preserved), not as "no stash"
    // (which would drop the recorded hp/hunger and re-derive from legacy).
    const recorded = { ...createVitals(), hp: 7, hunger: 12, saturation: 1 };
    const stash = normalizeModeStash(
      { survivalVitals: recorded },
      legacy('survival', [{ item: 'stone', count: 32 }], createVitals()),
    );
    expect(stash.survivalVitals).toEqual(recorded); // recorded vitals kept, hp 7
    expect(stash.survivalVitals).not.toBe(recorded); // fresh object, never aliased
    // the MISSING sides still get their starter kits (survival = empty)
    expect(stash.survival).toEqual(new Array(INVENTORY_WIDTH).fill(null));
    expect(stash.creative).toEqual(starterSlots('creative'));
  });

  it('normalizeModeStash prefers a present stash over legacy fields', () => {
    const raw = {
      survival: [{ item: 'apple', count: 3 }],
      creative: [{ item: 'stone', count: 64 }],
      survivalVitals: { ...createVitals(), hp: 5 },
    };
    const stash = normalizeModeStash(
      raw,
      legacy('creative', [{ item: 'dirt', count: 9 }], { ...createVitals(), hp: 1 }),
    );
    expect(stash.survival).toEqual(padded([{ item: 'apple', count: 3 }]));
    expect(stash.creative).toEqual(padded([{ item: 'stone', count: 64 }]));
    expect(stash.survivalVitals.hp).toBe(5); // the stash's vitals, not the legacy hp 1

    // copied on write: later mutation of the raw payload never reaches the stash
    raw.survival[0].count = 1;
    raw.survivalVitals.hp = 20;
    expect(stash.survival[0]?.count).toBe(3);
    expect(stash.survivalVitals.hp).toBe(5);
  });
});
