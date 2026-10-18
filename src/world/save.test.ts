import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveGame,
  loadGame,
  openSaveDb,
  collectSavePayload,
  isValidSavePayload,
  type SavePayload,
  type SavePayloadV1,
  type SavePayloadV2,
} from './save';
import { createVitals } from '../player/survival';
import { emptyAdvancements } from '../core/advancements';
import { createModeStash, type ModeStash } from '../core/mode-stash';
import { starterSlots, type ItemStack } from '../core/items';

/** DB name is part of the on-disk contract (save.ts) — duplicated here so the
 *  test can delete the whole database between cases without exporting it. */
const DB_NAME = 'wecraft-save';

/** Hotbar-shaped slots: `items` padded with nulls to the 9-slot width — payloads
 *  are stored canonical, so a v3 round-trip can deep-equal. */
function slots(...items: Array<ItemStack | null>): Array<ItemStack | null> {
  return [...items, ...new Array(9 - items.length).fill(null)];
}

function deleteSaveDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

function makePayload(patch: Partial<SavePayload> = {}): SavePayload {
  return {
    version: 3,
    savedAt: 0, // saveGame must stamp its own value
    worldSeed: 1337,
    modified: [
      ['5,70,5', 1], // placed stone
      ['6,70,6', 0], // mined to air — must stay mined
    ],
    player: {
      pos: [1.5, 64, -3.25],
      yaw: 0.75,
      mode: 'survival',
      vitals: createVitals(),
      inventory: [{ item: 'stone', count: 32 }, null, { item: 'wooden_pickaxe', count: 1 }],
    },
    time: { t: 0.42 },
    // non-empty, so the round-trip deep-equal actually exercises progress state
    advancements: {
      done: { getting_wood: true, monster_hunter: true },
      nightSeen: true,
    },
    // the other mode's hotbar + survival vitals travel with the payload (B1.3)
    stash: {
      survival: slots({ item: 'dirt', count: 3 }),
      creative: slots({ item: 'stone', count: 64 }),
      survivalVitals: { ...createVitals(), hp: 12 },
    },
    ...patch,
  };
}

/** A raw v1 record exactly as a pre-Task-11 build wrote it (no advancements). */
function makeV1Payload(): SavePayloadV1 {
  return {
    version: 1,
    savedAt: 0,
    worldSeed: 1337,
    modified: [['5,70,5', 1]],
    player: {
      pos: [1.5, 64, -3.25],
      yaw: 0.75,
      mode: 'survival',
      vitals: null,
      inventory: [{ item: 'stone', count: 32 }],
    },
    time: { t: 0.42 },
  };
}

/** A raw v2 record exactly as a pre-v3 build wrote it (advancements, no stash).
 *  Recorded in creative, so the migration's mode branch is the non-trivial one. */
function makeV2Payload(): SavePayloadV2 {
  return {
    version: 2,
    savedAt: 0,
    worldSeed: 1337,
    modified: [['5,70,5', 1]],
    player: {
      pos: [1.5, 64, -3.25],
      yaw: 0.75,
      mode: 'creative',
      vitals: null,
      inventory: [{ item: 'oak_planks', count: 12 }],
    },
    time: { t: 0.42 },
    advancements: { done: { getting_wood: true }, nightSeen: false },
  };
}

/** Create the save DB at a version save.ts cannot open → every save.ts call fails. */
function createIncompatibleDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => req.result.createObjectStore('games');
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

/** Write a raw value straight into the slot, bypassing saveGame's validation. */
function putRawRecord(value: unknown): Promise<void> {
  return openSaveDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction('games', 'readwrite');
        tx.objectStore('games').put(value, 'slot1');
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

describe('saveGame / loadGame', () => {
  beforeEach(deleteSaveDb);

  it('round-trips a full SavePayload through IndexedDB (deep equal)', async () => {
    const payload = makePayload();
    const before = Date.now();
    await saveGame(payload);
    const after = Date.now();
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual({ ...payload, savedAt: expect.any(Number) });
    // savedAt stamped by saveGame itself, not taken from the payload (0)
    expect(loaded!.savedAt).toBeGreaterThanOrEqual(before);
    expect(loaded!.savedAt).toBeLessThanOrEqual(after);
  });

  it('round-trips null vitals and an empty inventory', async () => {
    const base = makePayload();
    await saveGame({ ...base, player: { ...base.player, vitals: null, inventory: [] } });
    const loaded = await loadGame();
    expect(loaded?.player.vitals).toBeNull();
    expect(loaded?.player.inventory).toEqual([]);
  });

  it('round-trips a creative-mode payload', async () => {
    const base = makePayload();
    await saveGame({
      ...base,
      player: { ...base.player, mode: 'creative', vitals: null },
    });
    expect((await loadGame())?.player.mode).toBe('creative');
  });

  it('round-trips stash through IndexedDB', async () => {
    await saveGame(makePayload());
    const loaded = await loadGame();
    expect(loaded?.stash).toEqual(makePayload().stash);
    // a non-canonical stash record (short arrays) is padded back to hotbar width
    const base = makePayload();
    await saveGame({
      ...base,
      stash: {
        survival: [{ item: 'apple', count: 2 }],
        creative: [],
        survivalVitals: createVitals(),
      },
    });
    const reloaded = await loadGame();
    expect(reloaded?.stash.survival).toEqual(slots({ item: 'apple', count: 2 }));
    expect(reloaded?.stash.creative).toEqual(slots());
  });

  it('migrates a raw v1 record to v3 with derived stash and empty advancements', async () => {
    const v1 = makeV1Payload();
    await putRawRecord(v1);
    const loaded = await loadGame();
    expect(loaded).toEqual({
      ...v1,
      version: 3,
      advancements: emptyAdvancements(),
      // no stash on the record → the survival side is derived from what it saved
      stash: {
        survival: slots({ item: 'stone', count: 32 }),
        creative: starterSlots('creative'),
        survivalVitals: createVitals(), // v1 vitals were null → fresh defaults
      },
    });
    expect(loaded!.version).toBe(3);
  });

  it('migrates a raw v2 record to v3, deriving stash from the recorded mode', async () => {
    const v2 = makeV2Payload();
    await putRawRecord(v2);
    const loaded = await loadGame();
    expect(loaded).toEqual({
      ...v2,
      version: 3,
      stash: {
        survival: slots(), // the mode the record was NOT in starts empty
        creative: slots({ item: 'oak_planks', count: 12 }),
        survivalVitals: createVitals(), // creative record → no survival vitals to carry
      },
    });
    expect(loaded!.version).toBe(3);
  });

  /** Vitals written before Task 1 have no `exhaustion` field — the load path
   *  must hand the live model the full shape instead of an undefined bank. */
  const legacyVitals = {
    hp: 17,
    maxHp: 20,
    hunger: 14,
    maxHunger: 20,
    saturation: 2.5,
    regenAcc: 1,
    starveAcc: 0,
  };

  it('loadGame defaults vitals missing exhaustion to 0 (live and stash)', async () => {
    const base = makePayload();
    await putRawRecord({
      ...base,
      player: { ...base.player, vitals: legacyVitals },
      stash: { ...base.stash, survivalVitals: legacyVitals },
    });
    const loaded = await loadGame();
    // the pre-existing fields survive the normalization untouched
    expect(loaded?.player.vitals).toEqual({ ...legacyVitals, exhaustion: 0 });
    // the stash's vitals get the same treatment (raw-stash path)
    expect(loaded?.stash.survivalVitals).toEqual({ ...legacyVitals, exhaustion: 0 });
  });

  it('migrates a v1 record whose vitals predate exhaustion (loads as 0)', async () => {
    const v1 = makeV1Payload();
    await putRawRecord({ ...v1, player: { ...v1.player, vitals: legacyVitals } });
    const loaded = await loadGame();
    expect(loaded?.version).toBe(3);
    expect(loaded?.player.vitals).toEqual({ ...legacyVitals, exhaustion: 0 });
    // the migrated stash's survival vitals carry the same normalized record
    expect(loaded?.stash.survivalVitals).toEqual({ ...legacyVitals, exhaustion: 0 });
  });

  it('loads a v3 payload with garbage advancements and sanitizes them', async () => {
    await putRawRecord({
      ...makePayload(),
      advancements: {
        done: { getting_wood: true, bogus: true, coal_miner: 'yes' },
        nightSeen: 'yes',
      },
    });
    const loaded = await loadGame();
    // garbage dropped, valid entries kept, base payload intact
    expect(loaded?.advancements).toEqual({ done: { getting_wood: true }, nightSeen: false });
    expect(loaded?.player.pos).toEqual([1.5, 64, -3.25]);
  });

  it('overwrites the previous save in the single slot', async () => {
    await saveGame(makePayload({ worldSeed: 1 }));
    await saveGame(makePayload({ worldSeed: 2 }));
    expect((await loadGame())?.worldSeed).toBe(2);
  });

  it('returns null when nothing has been saved (missing DB/record)', async () => {
    expect(await loadGame()).toBeNull();
  });

  it('returns null for a record with an unsupported version', async () => {
    await putRawRecord({ version: 4 });
    expect(await loadGame()).toBeNull();
  });

  it('returns null for a non-object record (corrupt data)', async () => {
    await putRawRecord('garbage-not-a-save');
    expect(await loadGame()).toBeNull();
  });

  it('returns null when the database version is unreadable', async () => {
    await createIncompatibleDb();
    expect(await loadGame()).toBeNull();
  });

  it('saveGame rejects when the database cannot be written', async () => {
    await createIncompatibleDb();
    await expect(saveGame(makePayload())).rejects.toBeDefined();
  });

  it('loadGame rejects shape-corrupt records (base validation, every version)', async () => {
    const base = makePayload();
    // player missing entirely — every supported version fails the base check
    await putRawRecord({ version: 1 });
    expect(await loadGame()).toBeNull();
    await putRawRecord({ version: 2 });
    expect(await loadGame()).toBeNull();
    await putRawRecord({ version: 3 });
    expect(await loadGame()).toBeNull();
    // non-finite pos coordinate
    await putRawRecord({ ...base, player: { ...base.player, pos: [1, Number.NaN, 3] } });
    expect(await loadGame()).toBeNull();
    // mode outside the allowed union
    await putRawRecord({ ...base, player: { ...base.player, mode: 'spectator' } });
    expect(await loadGame()).toBeNull();
    // non-finite yaw (would reach camera render state without throwing)
    await putRawRecord({ ...base, player: { ...base.player, yaw: Number.NaN } });
    expect(await loadGame()).toBeNull();
    // non-finite clock
    await putRawRecord({ ...base, time: { t: Number.NaN } });
    expect(await loadGame()).toBeNull();
    // a fully valid payload still passes (round trip)
    await saveGame(base);
    expect(await loadGame()).not.toBeNull();
  });
});

/** Task 14 review #2: IndexedDB records can be written by an older/broken
 *  build — loadGame must validate the SHAPE before handing a payload to
 *  continueGame, which trusts it (destructure, setBlock, DOM writes). */
describe('isValidSavePayload', () => {
  it('accepts a fully valid payload (v1, v2 and v3 all pass base validation)', () => {
    expect(isValidSavePayload(makePayload())).toBe(true);
    expect(
      isValidSavePayload(makePayload({ player: { ...makePayload().player, vitals: null } })),
    ).toBe(true);
    expect(isValidSavePayload(makeV1Payload())).toBe(true); // migration input
    expect(isValidSavePayload(makeV2Payload())).toBe(true); // migration input
  });

  it('rejects non-objects, wrong version and a missing player', () => {
    expect(isValidSavePayload(null)).toBe(false);
    expect(isValidSavePayload('garbage')).toBe(false);
    expect(isValidSavePayload(42)).toBe(false);
    expect(isValidSavePayload({ ...makePayload(), version: 4 })).toBe(false);
    expect(isValidSavePayload({ version: 1 })).toBe(false); // player missing
  });

  it('rejects malformed player.pos (wrong length or non-finite)', () => {
    const base = makePayload();
    expect(
      isValidSavePayload({ ...base, player: { ...base.player, pos: [1, Number.NaN, 3] } }),
    ).toBe(false);
    expect(
      isValidSavePayload({ ...base, player: { ...base.player, pos: [1, 2] } }),
    ).toBe(false);
    expect(
      isValidSavePayload({ ...base, player: { ...base.player, pos: '1,2,3' as never } }),
    ).toBe(false);
  });

  it('rejects a non-finite yaw (unguarded NaN path into the camera)', () => {
    const base = makePayload();
    expect(
      isValidSavePayload({ ...base, player: { ...base.player, yaw: Number.NaN } }),
    ).toBe(false);
    expect(
      isValidSavePayload({ ...base, player: { ...base.player, yaw: Infinity } }),
    ).toBe(false);
    expect(
      isValidSavePayload({ ...base, player: { ...base.player, yaw: '0.5' as never } }),
    ).toBe(false);
  });

  it('rejects a mode outside {survival, creative} and a malformed inventory', () => {
    const base = makePayload();
    expect(
      isValidSavePayload({ ...base, player: { ...base.player, mode: 'spectator' as never } }),
    ).toBe(false);
    expect(
      isValidSavePayload({ ...base, player: { ...base.player, inventory: 'nope' as never } }),
    ).toBe(false);
    expect(
      isValidSavePayload({
        ...base,
        player: { ...base.player, inventory: [{ item: 7, count: 1 } as never] },
      }),
    ).toBe(false);
    expect(
      isValidSavePayload({
        ...base,
        player: { ...base.player, inventory: [{ item: 'stone', count: Number.NaN }] },
      }),
    ).toBe(false);
    expect(
      isValidSavePayload({ ...base, player: { ...base.player, inventory: ['junk' as never] } }),
    ).toBe(false);
  });

  it('rejects a malformed vitals, modified and clock', () => {
    const base = makePayload();
    expect(
      isValidSavePayload({
        ...base,
        player: { ...base.player, vitals: { ...createVitals(), hp: Number.NaN } },
      }),
    ).toBe(false);
    expect(isValidSavePayload({ ...base, player: { ...base.player, vitals: undefined } })).toBe(
      false,
    );
    expect(isValidSavePayload({ ...base, modified: 'nope' as never })).toBe(false);
    expect(isValidSavePayload({ ...base, time: { t: Number.NaN } })).toBe(false);
    expect(isValidSavePayload({ ...base, time: {} as never })).toBe(false);
  });
});

/** Task 14: payload assembly from live game state — a PURE function so the
 *  composition root (main.ts) stays thin and this logic is testable without
 *  touching IndexedDB or the DOM. */
describe('collectSavePayload', () => {
  const world = {
    seed: 4242,
    serializeModified: (): Array<[string, number]> => [
      ['5,70,5', 1], // placed stone
      ['6,70,6', 0], // mined to air
    ],
  };

  it('assembles version, seed, modified, clock, advancements and stash from the sources', () => {
    const advancements = {
      done: { getting_wood: true },
      nightSeen: true,
    };
    const payload = collectSavePayload({
      world,
      player: { pos: [1.5, 64, -3.25], yaw: 0.75, mode: 'survival', inventory: [] },
      vitals: null,
      clockT: 0.42,
      advancements,
      stash: createModeStash(),
      savedAt: 123,
    });
    expect(payload.version).toBe(3);
    expect(payload.worldSeed).toBe(4242);
    expect(payload.modified).toEqual([
      ['5,70,5', 1],
      ['6,70,6', 0],
    ]);
    expect(payload.time).toEqual({ t: 0.42 });
    expect(payload.advancements).toEqual(advancements);
    expect(payload.stash).toEqual(createModeStash()); // the other mode's state travels too
    expect(payload.savedAt).toBe(123);
  });

  it('copies the player sub-object and advancements — no aliasing', () => {
    const pos: [number, number, number] = [1, 2, 3];
    const stack: ItemStack = { item: 'stone', count: 32 };
    const inventory: Array<ItemStack | null> = [stack, null];
    const vitals = createVitals();
    const advancements = {
      done: { getting_wood: true },
      nightSeen: false,
    };
    const payload = collectSavePayload({
      world,
      player: { pos, yaw: -1.25, mode: 'survival', inventory },
      vitals,
      clockT: 0,
      advancements,
      stash: createModeStash(),
      savedAt: 0,
    });
    // fresh pos array — mutating the source must not touch the payload
    expect(payload.player.pos).toEqual([1, 2, 3]);
    expect(payload.player.pos).not.toBe(pos);
    pos[0] = 99;
    expect(payload.player.pos[0]).toBe(1);
    // fresh stack objects — mutating the source stack must not touch the payload
    expect(payload.player.inventory[0]).toEqual({ item: 'stone', count: 32 });
    expect(payload.player.inventory[0]).not.toBe(stack);
    stack.count = 1;
    expect(payload.player.inventory[0]?.count).toBe(32);
    expect(payload.player.inventory[1]).toBeNull(); // null slots stay null
    // fresh vitals copy
    expect(payload.player.vitals).toEqual(vitals);
    expect(payload.player.vitals).not.toBe(vitals);
    expect(payload.player.yaw).toBe(-1.25);
    expect(payload.player.mode).toBe('survival');
    // fresh advancements copy — mutating the source must not touch the payload
    expect(payload.advancements).toEqual({ done: { getting_wood: true }, nightSeen: false });
    expect(payload.advancements.done).not.toBe(advancements.done);
    advancements.done.getting_wood = false;
    advancements.nightSeen = true;
    expect(payload.advancements.done.getting_wood).toBe(true);
    expect(payload.advancements.nightSeen).toBe(false);
  });

  it('carries null vitals (creative) and defaults savedAt to now when omitted', () => {
    const before = Date.now();
    const payload = collectSavePayload({
      world,
      player: { pos: [0, 0, 0], yaw: 0, mode: 'creative', inventory: [] },
      vitals: null,
      clockT: 0.1,
      advancements: emptyAdvancements(),
      stash: createModeStash(),
    });
    const after = Date.now();
    expect(payload.player.mode).toBe('creative');
    expect(payload.player.vitals).toBeNull();
    // default savedAt = Date.now() (saveGame overwrites it anyway — documented)
    expect(payload.savedAt).toBeGreaterThanOrEqual(before);
    expect(payload.savedAt).toBeLessThanOrEqual(after);
  });

  it('collectSavePayload deep-copies the stash (no aliasing)', () => {
    const survivalStack: ItemStack = { item: 'dirt', count: 3 };
    const creativeStack: ItemStack = { item: 'stone', count: 64 };
    const survivalVitals = { ...createVitals(), hp: 9 };
    // a non-canonical stash on purpose: the payload copies what it is given
    const stash: ModeStash = {
      survival: [survivalStack, null],
      creative: [creativeStack],
      survivalVitals,
    };
    const payload = collectSavePayload({
      world,
      player: { pos: [0, 0, 0], yaw: 0, mode: 'survival', inventory: [] },
      vitals: null,
      clockT: 0,
      advancements: emptyAdvancements(),
      stash,
      savedAt: 0,
    });
    // fresh arrays, stacks and vitals — never the live objects
    expect(payload.stash.survival).not.toBe(stash.survival);
    expect(payload.stash.creative).not.toBe(stash.creative);
    expect(payload.stash.survival[0]).toEqual({ item: 'dirt', count: 3 });
    expect(payload.stash.survival[0]).not.toBe(survivalStack);
    expect(payload.stash.creative[0]).not.toBe(creativeStack);
    expect(payload.stash.survivalVitals).not.toBe(survivalVitals);

    // mutating the live stash afterwards must not touch the captured payload
    survivalStack.count = 99;
    creativeStack.count = 1;
    stash.survival[1] = { item: 'sand', count: 1 };
    stash.survivalVitals.hp = 1;
    expect(payload.stash.survival[0]?.count).toBe(3);
    expect(payload.stash.creative[0]?.count).toBe(64);
    expect(payload.stash.survival[1]).toBeNull();
    expect(payload.stash.survivalVitals.hp).toBe(9);
  });
});
