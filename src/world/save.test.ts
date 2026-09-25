import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveGame,
  loadGame,
  openSaveDb,
  collectSavePayload,
  isValidSavePayload,
  type SavePayload,
} from './save';
import { createVitals } from '../player/survival';
import type { ItemStack } from '../core/items';

/** DB name is part of the on-disk contract (save.ts) — duplicated here so the
 *  test can delete the whole database between cases without exporting it. */
const DB_NAME = 'wecraft-save';

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
    version: 1,
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
    ...patch,
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

  it('overwrites the previous save in the single slot', async () => {
    await saveGame(makePayload({ worldSeed: 1 }));
    await saveGame(makePayload({ worldSeed: 2 }));
    expect((await loadGame())?.worldSeed).toBe(2);
  });

  it('returns null when nothing has been saved (missing DB/record)', async () => {
    expect(await loadGame()).toBeNull();
  });

  it('returns null for a record with the wrong version', async () => {
    await putRawRecord({ version: 99 });
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

  it('loadGame rejects shape-corrupt records with version 1 (review #2)', async () => {
    const base = makePayload();
    // player missing entirely
    await putRawRecord({ version: 1 });
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
  it('accepts a fully valid payload', () => {
    expect(isValidSavePayload(makePayload())).toBe(true);
    expect(
      isValidSavePayload(makePayload({ player: { ...makePayload().player, vitals: null } })),
    ).toBe(true);
  });

  it('rejects non-objects, wrong version and a missing player', () => {
    expect(isValidSavePayload(null)).toBe(false);
    expect(isValidSavePayload('garbage')).toBe(false);
    expect(isValidSavePayload(42)).toBe(false);
    expect(isValidSavePayload({ ...makePayload(), version: 2 })).toBe(false);
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

  it('assembles version, seed, modified and clock from the sources', () => {
    const payload = collectSavePayload({
      world,
      player: { pos: [1.5, 64, -3.25], yaw: 0.75, mode: 'survival', inventory: [] },
      vitals: null,
      clockT: 0.42,
      savedAt: 123,
    });
    expect(payload.version).toBe(1);
    expect(payload.worldSeed).toBe(4242);
    expect(payload.modified).toEqual([
      ['5,70,5', 1],
      ['6,70,6', 0],
    ]);
    expect(payload.time).toEqual({ t: 0.42 });
    expect(payload.savedAt).toBe(123);
  });

  it('copies the player sub-object — no aliasing of pos, stacks or vitals', () => {
    const pos: [number, number, number] = [1, 2, 3];
    const stack: ItemStack = { item: 'stone', count: 32 };
    const inventory: Array<ItemStack | null> = [stack, null];
    const vitals = createVitals();
    const payload = collectSavePayload({
      world,
      player: { pos, yaw: -1.25, mode: 'survival', inventory },
      vitals,
      clockT: 0,
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
  });

  it('carries null vitals (creative) and defaults savedAt to now when omitted', () => {
    const before = Date.now();
    const payload = collectSavePayload({
      world,
      player: { pos: [0, 0, 0], yaw: 0, mode: 'creative', inventory: [] },
      vitals: null,
      clockT: 0.1,
    });
    const after = Date.now();
    expect(payload.player.mode).toBe('creative');
    expect(payload.player.vitals).toBeNull();
    // default savedAt = Date.now() (saveGame overwrites it anyway — documented)
    expect(payload.savedAt).toBeGreaterThanOrEqual(before);
    expect(payload.savedAt).toBeLessThanOrEqual(after);
  });
});
