// Task 13: IndexedDB persistence for world modifications and player state.
// Task 14: `collectSavePayload` — pure payload assembly from live game state.

import type { Vitals } from '../player/survival';
import type { ItemStack } from '../core/items';

export interface SavePayload {
	version: 1;
	savedAt: number;
	worldSeed: number;
	modified: Array<[key: string, blockId: number]>;
	player: {
		pos: [number, number, number];
		yaw: number;
		mode: 'survival' | 'creative';
		vitals: Vitals | null;
		inventory: (ItemStack | null)[];
	};
	time: { t: number };
}

/** Live-state sources for {@link collectSavePayload} — structurally typed so
 *  tests pass plain objects while main.ts passes thin adapters. */
export interface SaveSources {
	world: { seed: number; serializeModified(): Array<[string, number]> };
	player: {
		pos: readonly [number, number, number];
		yaw: number;
		mode: 'survival' | 'creative';
		inventory: (ItemStack | null)[];
	};
	vitals: Vitals | null;
	clockT: number;
	/** Defaults to `Date.now()` when omitted. Note: `saveGame` overwrites
	 *  `savedAt` with its own `Date.now()` on the way to IndexedDB, so this
	 *  value only matters for tests / pre-save inspection. */
	savedAt?: number;
}

/** Assemble a {@link SavePayload} from live game state — PURE (no IDB, no DOM):
 *  every player-owned value is copied (fresh pos array, fresh stack/vitals
 *  objects) so later mutations of the live state never alias into an already
 *  captured payload. `modified` comes from `world.serializeModified()`, which
 *  already returns fresh tuples. */
export function collectSavePayload(args: SaveSources): SavePayload {
	return {
		version: 1,
		savedAt: args.savedAt ?? Date.now(),
		worldSeed: args.world.seed,
		modified: args.world.serializeModified(),
		player: {
			pos: [args.player.pos[0], args.player.pos[1], args.player.pos[2]],
			yaw: args.player.yaw,
			mode: args.player.mode,
			vitals: args.vitals ? { ...args.vitals } : null,
			inventory: args.player.inventory.map((s) => (s ? { ...s } : null)),
		},
		time: { t: args.clockT },
	};
}

const DB_NAME = 'wecraft-save';
const DB_VERSION = 1;
const STORE = 'games';
const SLOT_KEY = 'slot1';

/** Wrap an IDBRequest in a promise (resolves with event.target.result). */
function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
	});
}

/** Self-opening handle to the save database (one upgrade only). */
export function openSaveDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE);
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error('Failed to open save database'));
		req.onblocked = () => reject(new Error('Save database open blocked'));
	});
}

/** Persist a save payload under the single slot. Rejects on any failure. */
export async function saveGame(payload: SavePayload): Promise<void> {
	const record: SavePayload = { ...payload, savedAt: Date.now() };
	const db = await openSaveDb();
	try {
		const tx = db.transaction(STORE, 'readwrite');
		await idbRequest(tx.objectStore(STORE).put(record, SLOT_KEY));
		await new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onabort = () => reject(tx.error ?? new Error('Save transaction aborted'));
			tx.onerror = () => reject(tx.error ?? new Error('Save transaction failed'));
		});
	} finally {
		db.close();
	}
}

/** Load the saved payload, or null if missing/corrupt/incompatible. Never rejects. */
export async function loadGame(): Promise<SavePayload | null> {
	try {
		const db = await openSaveDb();
		try {
			const tx = db.transaction(STORE, 'readonly');
			const value = await idbRequest<unknown>(tx.objectStore(STORE).get(SLOT_KEY));
			if (value === null || value === undefined || typeof value !== 'object') return null;
			const rec = value as Partial<SavePayload>;
			if (rec.version !== 1) return null;
			return rec as SavePayload;
		} finally {
			db.close();
		}
	} catch {
		return null;
	}
}
