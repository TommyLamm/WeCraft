// Task 13: IndexedDB persistence for world modifications and player state.
// Payload assembly from live objects happens in Task 14 (menus wiring).

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
