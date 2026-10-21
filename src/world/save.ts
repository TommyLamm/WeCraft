// Task 13: IndexedDB persistence for world modifications and player state.
// Task 14: `collectSavePayload` — pure payload assembly from live game state.
// Task 11: payload v2 (advancements) + v1→v2 migration in `loadGame`.
// B1.3: payload v3 (dual-mode stash) + v1/v2→v3 migration in `loadGame`.
// B3 Task 7：附加欄位 `worldgenVersion`——payload 版本**維持 3**（舊版程式會直接
// 忽略不認識的欄位），只多蓋一個版本戳記而已。

import { normalizeVitals, type Vitals } from '../player/survival';
import type { ItemStack } from '../core/items';
import { normalizeModeStash, type ModeStash, type StashPayload } from '../core/mode-stash';
import {
  emptyAdvancements,
  sanitizeAdvancements,
  type AdvancementState,
} from '../core/advancements';
import { WORLDGEN_VERSION, readWorldgenVersion } from './worldgen';

/** Pre-v2 payload shape (Task 11): kept for the migration path so records
 *  written by earlier builds still validate and load. */
export interface SavePayloadV1 {
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

/** v2 payload (Task 11): v1 plus the advancement state. Kept for the migration
 *  path — `loadGame` upgrades a v2 record to v3. */
export interface SavePayloadV2 extends Omit<SavePayloadV1, 'version'> {
	version: 2;
	advancements: AdvancementState;
}

/** Current payload (B1.3): v2 plus the per-mode stash — the hotbar of the mode
 *  you are NOT in, and the survival vitals. `loadGame` ALWAYS returns this
 *  shape: v1 records migrate with empty advancements, v1/v2 records get a stash
 *  derived from the mode/inventory/vitals they recorded, and a v3 record's
 *  stash is sanitized against the current item table. */
export interface SavePayloadV3 extends Omit<SavePayloadV2, 'version'> {
	version: 3;
	stash: StashPayload;
	/** B3 Task 7 附加欄位——payload 版本**維持 3**，這只是多出來的一個鍵，舊版
	 *  程式讀到不認識的欄位會直接忽略。它記錄「這份存檔玩的是哪一版生成器做出來
	 *  的地形」。B3 之前的記錄**沒有**這個鍵 → 那就是「舊存檔」的判準，所以
	 *  `loadGame` **不得**自動補值（補了就看不出是舊存檔、也永遠不會跳「地形已改變」
	 *  提示）。 */
	worldgenVersion?: number;
}

/** The shape written to / read from the single local slot. */
export type SavePayload = SavePayloadV3;

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
	/** Live advancement state (Task 11) — copied into the payload. */
	advancements: AdvancementState;
	/** Live per-mode stash (B1.3) — copied into the payload: a fresh array per
	 *  side, a fresh object per stack and a fresh vitals object. */
	stash: ModeStash;
	/** Defaults to `Date.now()` when omitted. Note: `saveGame` overwrites
	 *  `savedAt` with its own `Date.now()` on the way to IndexedDB, so this
	 *  value only matters for tests / pre-save inspection. */
	savedAt?: number;
}

/** Assemble a {@link SavePayload} from live game state — PURE (no IDB, no DOM):
 *  every player-owned value is copied (fresh pos array, fresh stack/vitals
 *  objects, fresh advancements, fresh stash) so later mutations of the live
 *  state never alias into an already captured payload. `modified` comes from
 *  `world.serializeModified()`, which already returns fresh tuples.
 *  B3 Task 7：每一份新寫出的 payload 都帶「當前」的 `WORLDGEN_VERSION`——寫入端
 *  是唯一會蓋值的地方（讀取端從不補值，所以舊存檔仍然看得出是舊存檔）。 */
export function collectSavePayload(args: SaveSources): SavePayload {
	return {
		version: 3,
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
		advancements: {
			done: { ...args.advancements.done },
			nightSeen: args.advancements.nightSeen,
		},
		stash: {
			survival: args.stash.survival.map((s) => (s ? { ...s } : null)),
			creative: args.stash.creative.map((s) => (s ? { ...s } : null)),
			survivalVitals: { ...args.stash.survivalVitals },
		},
		worldgenVersion: WORLDGEN_VERSION,
	};
}

/** Shape-validate an unknown value as a v1, v2 or v3 save payload (review #2;
 *  Task 11 widened the accepted versions to v1/v2, B1.3 to v3 — older records
 *  migrate in loadGame). IndexedDB records can be written by an older or broken
 *  build — continueGame trusts this shape completely (destructuring, setBlock
 *  keys, DOM writes), so a record must prove: object, version ∈ {1, 2, 3}, a
 *  player with a finite pos triple and finite yaw (a NaN yaw would reach camera
 *  render state without ever throwing), mode ∈ {survival, creative}, an
 *  inventory of null | {item: string, count: finite number}, vitals
 *  null | {hp: finite}, modified: array, and a finite clock. Light checks only
 *  — `modified` ENTRIES are additionally defended by applyModified's per-entry
 *  skip, item ids and counts by the inventory model / sanitizeSlots. Neither
 *  v2 `advancements` nor v3 `stash` is part of this base check: `loadGame`
 *  sanitizes both (sanitizeAdvancements / normalizeModeStash) before returning.
 *  B3 Task 7：附加欄位 `worldgenVersion` **不在**這個檢查裡——基本結構檢查完全不動
 *  （既不放寬也不收緊）：沒有這個欄位的舊 v1/v2/v3 記錄照樣通過；帶著髒值（`'x'`）
 *  的記錄也照樣被讀出來（讀取端會把該鍵剝除，而不是整筆拒收）。
 *  Pure: exported for tests, called by loadGame. */
export function isValidSavePayload(x: unknown): x is SavePayloadV1 | SavePayloadV2 | SavePayload {
	if (typeof x !== 'object' || x === null) return false;
	const r = x as Partial<SavePayloadV1>;
	if (r.version !== 1 && r.version !== 2 && r.version !== 3) return false;
	// player: pos triple + yaw + mode + inventory + vitals
	const p = r.player as SavePayloadV1['player'] | undefined;
	if (typeof p !== 'object' || p === null) return false;
	if (!Array.isArray(p.pos) || p.pos.length !== 3) return false;
	if (!p.pos.every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
	if (typeof p.yaw !== 'number' || !Number.isFinite(p.yaw)) return false;
	if (p.mode !== 'survival' && p.mode !== 'creative') return false;
	if (!Array.isArray(p.inventory)) return false;
	for (const s of p.inventory) {
		if (s === null) continue;
		if (typeof s !== 'object' || s === null) return false;
		const st = s as Partial<ItemStack>;
		if (typeof st.item !== 'string') return false;
		if (typeof st.count !== 'number' || !Number.isFinite(st.count)) return false;
	}
	const v = p.vitals;
	if (v !== null) {
		if (typeof v !== 'object' || v === null) return false;
		if (typeof v.hp !== 'number' || !Number.isFinite(v.hp)) return false;
	}
	// block edits + clock
	if (!Array.isArray(r.modified)) return false;
	const t = r.time as SavePayloadV1['time'] | undefined;
	if (typeof t !== 'object' || t === null) return false;
	if (typeof t.t !== 'number' || !Number.isFinite(t.t)) return false;
	return true;
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

/** Load the saved payload, or null if missing/corrupt/incompatible. Never rejects.
 *  Shape-validated (review #2; v1/v2 Task 11, v3 B1.3): a supported-version
 *  record with a broken shape (missing player, non-finite pos, bad mode, NaN
 *  clock, …) reads as "no save". ALWAYS returns a normalized v3 payload:
 *  - v1 migrates to `{...v1, version: 2, advancements: emptyAdvancements()}`
 *    first (old saves keep loading; progress starts fresh), then the stash is
 *    derived from the recorded mode/inventory/vitals;
 *  - v2's advancements are sanitized against the current table and its stash is
 *    derived the same way (no stash exists in those records);
 *  - v3's stash is sanitized (`normalizeModeStash`), so a short/unknown-item
 *    stash loads as the canonical 9-slot shape.
 *  Vitals written before `exhaustion` existed (or otherwise malformed) run
 *  through survival.ts `normalizeVitals` — for the live player AND for the
 *  stash's survival snapshot — so the live model always sees the full shape.
 *  B3 Task 7——附加欄位 `worldgenVersion` **原樣帶回、絕不在這裡補值**：記錄沒有
 *  這個鍵 → 回傳物件就沒有這個鍵（那正是「舊存檔」的判準）；記錄上是有限數字 →
 *  原樣保留；記錄上是髒值（例如字串 `'x'`——基本結構檢查刻意不看這個附加欄位）
 *  → 把該鍵剝除，不讓髒版本值繼續往外傳。 */
export async function loadGame(): Promise<SavePayload | null> {
	try {
		const db = await openSaveDb();
		try {
			const tx = db.transaction(STORE, 'readonly');
			const value = await idbRequest<unknown>(tx.objectStore(STORE).get(SLOT_KEY));
			if (value === null || value === undefined || typeof value !== 'object') return null;
			if (!isValidSavePayload(value)) return null;
			// Migration chain: v1 → v2 (advancements) → v3 (stash). The stash is
			// read off the RAW record (only v3 has one) so v1/v2 can derive it from
			// the fields they actually stored.
			const v2: SavePayloadV2 =
				value.version === 1
					? { ...value, version: 2, advancements: emptyAdvancements() }
					: { ...value, version: 2, advancements: sanitizeAdvancements(value.advancements) };
			const migrated: SavePayloadV3 = {
				...v2,
				version: 3,
				stash: normalizeModeStash((value as Partial<SavePayload>).stash, {
					mode: value.player.mode,
					inventory: value.player.inventory,
					vitals: value.player.vitals,
				}),
				player: {
					...v2.player,
					vitals:
						v2.player.vitals === null ? null : normalizeVitals(v2.player.vitals),
				},
			};
			// B3 Task 7：附加欄位 `worldgenVersion` 的三條規則——
			// 1) 絕不自動補值：舊記錄沒有這個鍵 → 回傳物件就**沒有**這個鍵
			//    （補了就看不出是舊存檔、也永遠不會跳「地形已改變」提示）。
			// 2) 原樣保留：記錄上有合法數字 → 原樣帶回。
			// 3) 非法值剝除：`isValidSavePayload` 不看這個附加欄位（不放寬也不
			//    收緊結構檢查），所以 'x' 這種值會通過驗證 → 在這裡明確剝除，
			//    不讓髒值繼續往外傳。
			// 「什麼算合法版本值」由 worldgen.ts 的 `readWorldgenVersion` 單一定義
			// （雲端存檔的驗證端也用同一支）→ 兩邊的規則不會漂移。
			//
			// 明確丟棄這個鍵（不靠副作用式 `delete`）：回傳物件組出來就不帶它。
			// 取出的值型別是 `number | undefined`，但記錄裡實際可能是字串等髒值
			// → 再交給 `readWorldgenVersion` 於執行期擋一次。
			const { worldgenVersion: rawVersion, ...migratedClean } = migrated;
			const worldgenVersion = readWorldgenVersion(rawVersion);
			return {
				...migratedClean,
				...(worldgenVersion === undefined ? {} : { worldgenVersion }),
			};
		} finally {
			db.close();
		}
	} catch {
		return null;
	}
}
