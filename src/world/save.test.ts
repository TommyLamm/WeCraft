import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { saveGame, loadGame, openSaveDb, type SavePayload } from './save';
import { createVitals } from '../player/survival';

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
});
