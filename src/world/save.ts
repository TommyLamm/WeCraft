// Task 13: IndexedDB persistence for world modifications and player state.
// Task 14: `collectSavePayload` — pure payload assembly from live game state.
// Task 11: payload v2 (advancements) + v1→v2 migration in `loadGame`.
// B1.3: payload v3 (dual-mode stash) + v1/v2→v3 migration in `loadGame`.
// B5 Task 7: payload v4 (36-slot inventory: hotbar row 0..8 + 27 main slots)
// + v1/v2/v3→v4 migration. Old 9-slot records keep their entries in the SAME
// positions (the hotbar row); the new main slots load as null.
// B3 Task 7：附加欄位 `worldgenVersion`——payload 版本**維持 3**（舊版程式會直接
// 忽略不認識的欄位），只多蓋一個版本戳記而已。
//
// B7 Task 2: payload v5 — the durability batch. The SHAPE is v4's (36 slots,
// stash, worldgenVersion, passiveMobs); what changed is the MEANING of an
// inventory entry: a durable stack (`ItemStack.dur`) now travels with the save.
// 版本鏈：v1（原始）→ v2（進度 advancements）→ v3（雙模式 stash）→ v4（36 格
// 背包）→ v5（`dur`）。`loadGame` 一律升到 v5；舊記錄的工具**沒有** `dur`
// → 載入時拿到滿耐久（＝上限），不是 0。

import { normalizeVitals, type Vitals } from '../player/survival';
import { INVENTORY_SLOTS, sanitizeSlots, type ItemStack } from '../core/items';
import { normalizeModeStash, type ModeStash, type StashPayload } from '../core/mode-stash';
import {
  emptyAdvancements,
  sanitizeAdvancements,
  type AdvancementState,
} from '../core/advancements';
import { WORLDGEN_VERSION, readWorldgenVersion } from './worldgen';
import {
  normalizePassiveMobs,
  serializePassiveMobs,
  type PassiveMobRecord,
} from './passive-save';
import type { PassiveMob } from './passive-mobs';

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

/** Legacy v3 payload (B1.3): v2 plus the per-mode stash — the 9-slot hotbar of
 *  the mode you are NOT in, and the survival vitals. Kept for the migration
 *  path; `loadGame` upgrades it (via v4) to v5 and pads both inventories to 36
 *  slots. */
export interface SavePayloadV3 extends Omit<SavePayloadV2, 'version'> {
	version: 3;
	stash: StashPayload;
	/** B3 Task 7 附加欄位——payload 版本**維持 3**，這只是多出來的一個鍵，舊版
	 *  程式讀到不認識的欄位會直接忽略。它記錄「這份存檔玩的是哪一版生成器做出來
	 *  的地形」。B3 之前的記錄**沒有**這個鍵 → 那就是「舊存檔」的判準，所以
	 *  `loadGame` **不得**自動補值（補了就看不出是舊存檔、也永遠不會跳「地形已改變」
	 *  提示）。 */
	worldgenVersion?: number;
	/** B4 Task 10 附加欄位——payload 版本**維持 3**，這只是多出來的一個鍵，舊版
	 *  程式讀到不認識的欄位會直接忽略。它記錄「場上有哪些被動生物、在哪、血量
	 *  多少、面朝哪裡」。B4 之前的記錄**沒有**這個鍵 → 那就是「舊存檔」→ 載入
	 *  得到**空陣列**（＝沒有生物），**不是**壞檔。
	 *
	 *  **型別上是選填、執行期上 `loadGame` 一律會給**（正規化後的陣列）→ 呼叫端
	 *  不必寫「有沒有這個鍵」的分支。 */
	passiveMobs?: PassiveMobRecord[];
}

/** Payload v4 (B5 Task 7): v3 plus the 36-slot inventory semantics — the
 *  first 9 slots are the hotbar row (hand-held range 0..8), the remaining 27
 *  are the main inventory. `SavePayloadV4 extends Omit<SavePayloadV3,
 *  'version'>` on purpose: every additive field B3/B4 introduced (notably
 *  `worldgenVersion` and `passiveMobs`) is inherited, so the v3→v4 migration
 *  cannot silently drop them. Kept for the migration path; `loadGame` upgrades
 *  a v4 record to v5 and gives every tool its full durability. */
export interface SavePayloadV4 extends Omit<SavePayloadV3, 'version'> {
	version: 4;
}

/** Current payload (B7 Task 2): v4 plus `ItemStack.dur` — a durable stack now
 *  records how much durability it has LEFT (`dur` = remaining, the max comes
 *  from `core/durability.ts`). `SavePayloadV5 extends Omit<SavePayloadV4,
 *  'version'>` for the same reason as the v3→v4 step: every additive field
 *  (`worldgenVersion`, `passiveMobs`, the stash) is inherited, so the version
 *  bump cannot silently drop one. The shape is unchanged otherwise — only the
 *  MEANING of an inventory entry grew a field. Records written before v5 carry
 *  no `dur` at all → loading them gives every tool FULL durability
 *  (`sanitizeStack` materializes it), never 0. */
export interface SavePayloadV5 extends Omit<SavePayloadV4, 'version'> {
	version: 5;
}

/** The shape written to / read from the single local slot. */
export type SavePayload = SavePayloadV5;

/**
 * v5 payload ＋ **一定有** `passiveMobs`（正規化後的陣列）。
 *
 * B4 Task 10：`loadGame`（讀取端）與 `collectSavePayload`（寫出端）**一律**帶這個
 * 鍵 → 用這個型別把「一定有」表達出來，呼叫端不必寫 `?? []` 或「有沒有這個鍵」
 * 的分支。磁碟上的**舊**記錄仍然可以沒有這個欄位 → 那由 `loadGame` 的正規化補上
 * （空陣列 ＝ 沒有生物，不是壞檔）。
 *
 * 它是 {@link SavePayload}（＝`SavePayloadV5`）的**子型** → 既有呼叫端
 * （`saveGame(payload: SavePayload)` 等）完全不受影響。 */
export interface SavePayloadWithPassiveMobs extends SavePayloadV5 {
	passiveMobs: PassiveMobRecord[];
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
	/** Live advancement state (Task 11) — copied into the payload. */
	advancements: AdvancementState;
	/** Live per-mode stash (B1.3) — copied into the payload: a fresh array per
	 *  side, a fresh object per stack and a fresh vitals object. */
	stash: ModeStash;
	/** Live passive mobs (B4 Task 10) — copied into the payload as
	 *  `{ kind, x, y, z, hp, yaw }` records. **必填**（沒有生物也要明寫空陣列）
	 *  → 少了它 typecheck 直接紅，呼叫端不會漏掉「被動生物要存檔」這件事。 */
	passiveMobs: readonly PassiveMob[];
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
export function collectSavePayload(args: SaveSources): SavePayloadWithPassiveMobs {
	return {
		// B7 Task 2：v5——背包的每一格都經過 `sanitizeStack`（耐久物品必然帶
		// 明確的 `dur`）；`stash` 的複製語意不變（原樣複製傳進來的 stash，見下）。
		version: 5,
		savedAt: args.savedAt ?? Date.now(),
		worldSeed: args.world.seed,
		modified: args.world.serializeModified(),
		player: {
			pos: [args.player.pos[0], args.player.pos[1], args.player.pos[2]],
			yaw: args.player.yaw,
			mode: args.player.mode,
			vitals: args.vitals ? { ...args.vitals } : null,
			// B5 Task 7：一律 36 格（不足補 null、超過截斷）且逐格深拷貝。
			// B7 Task 2：`sanitizeStack` 同時把耐久物品的 `dur` 帶出來（合法值
			// 原樣、缺漏／非法→滿耐久）→ 寫出的記錄「耐久物品必然帶明確 `dur`」。
			inventory: sanitizeSlots(args.player.inventory, INVENTORY_SLOTS),
		},
		time: { t: args.clockT },
		advancements: {
			done: { ...args.advancements.done },
			nightSeen: args.advancements.nightSeen,
		},
		stash: {
			survival: sanitizeSlots(args.stash.survival, INVENTORY_SLOTS),
			creative: sanitizeSlots(args.stash.creative, INVENTORY_SLOTS),
			survivalVitals: { ...args.stash.survivalVitals },
		},
		worldgenVersion: WORLDGEN_VERSION,
		// B4 Task 10：被動生物的持久化記錄（種類／座標／血量／朝向）。
		// `vel`／`kbVel` 是暫態 → 不寫進存檔。
		passiveMobs: serializePassiveMobs(args.passiveMobs),
	};
}

/** Shape-validate an unknown value as a v1…v5 save payload (review
 *  #2; Task 11 widened the accepted versions to v1/v2, B1.3 to v3, B5 Task 7
 *  to v4, B7 Task 2 to v5 — older records migrate in loadGame). IndexedDB
 *  records can be
 *  written by an older or broken build — continueGame trusts this shape
 *  completely (destructuring, setBlock keys, DOM writes), so a record must
 *  prove: object, version ∈ {1, 2, 3, 4, 5}, a
 *  player with a finite pos triple and finite yaw (a NaN yaw would reach camera
 *  render state without ever throwing), mode ∈ {survival, creative}, an
 *  inventory of null | {item: string, count: finite number}, vitals
 *  null | {hp: finite}, modified: array, and a finite clock. Light checks only
 *  — `modified` ENTRIES are additionally defended by applyModified's per-entry
 *  skip, item ids and counts by the inventory model / sanitizeSlots. Neither
 *  v2 `advancements` nor v3 `stash` is part of this base check: `loadGame`
 *  sanitizes both (sanitizeAdvancements / normalizeModeStash) before returning.
 *  B4 Task 10：附加欄位 `passiveMobs` 同樣**不在**這個檢查裡（交給載入路徑的
 *  `normalizePassiveMobs` 逐筆處理）——髒值不會讓整筆記錄被拒收，只是那一筆
 *  生物被丟棄。
 *  B3 Task 7：附加欄位 `worldgenVersion` **不在**這個檢查裡——基本結構檢查完全不動
 *  （既不放寬也不收緊）：沒有這個欄位的舊 v1/v2/v3 記錄照樣通過；帶著髒值（`'x'`）
 *  的記錄也照樣被讀出來（讀取端會把該鍵剝除，而不是整筆拒收）。
 *  Pure: exported for tests, called by loadGame. */
export function isValidSavePayload(
	x: unknown,
): x is SavePayloadV1 | SavePayloadV2 | SavePayloadV3 | SavePayloadV4 | SavePayloadV5 {
	if (typeof x !== 'object' || x === null) return false;
	const r = x as Partial<SavePayloadV1>;
	if (
		r.version !== 1 &&
		r.version !== 2 &&
		r.version !== 3 &&
		r.version !== 4 &&
		r.version !== 5
	) {
		return false;
	}
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
 *  Shape-validated (review #2; v1/v2 Task 11, v3 B1.3, v4 B5 Task 7, v5 B7
 *  Task 2): a
 *  supported-version record with a broken shape (missing player, non-finite
 *  pos, bad mode, NaN clock, …) reads as "no save". ALWAYS returns a
 *  normalized v5 payload (36-slot inventory: hotbar row 0..8 + 27 main slots;
 *  durable stacks carry an explicit `dur`):
 *  - v1 migrates to `{...v1, version: 2, advancements: emptyAdvancements()}`
 *    first (old saves keep loading; progress starts fresh), then the stash is
 *    derived from the recorded mode/inventory/vitals;
 *  - v2's advancements are sanitized against the current table and its stash is
 *    derived the same way (no stash exists in those records);
 *  - v3's stash is sanitized (`normalizeModeStash`), so a short/unknown-item
 *    stash loads as the canonical 36-slot shape;
 *  - every version's `player.inventory` is sanitized with `sanitizeSlots(...,
 *    INVENTORY_SLOTS)`: old 9-slot records keep their entries in the SAME
 *    positions (the hotbar row), the 27 main slots load as null, and a longer
 *    array is truncated;
 *  - v4 records predate durability: `dur` 由 `sanitizeStack` materialize——
 *    舊記錄缺 `dur` → 滿耐久（上限），非法值 → 清除後視為滿耐久。舊存檔因此
 *    **不會**弄壞玩家的工具（絕不落成 0）；stash 走 `normalizeModeStash`
 *    （內部同一支清洗器）→ 兩側的工具同樣拿到滿耐久。
 *  Vitals written before `exhaustion` existed (or otherwise malformed) run
 *  through survival.ts `normalizeVitals` — for the live player AND for the
 *  stash's survival snapshot — so the live model always sees the full shape.
 *  B4 Task 10——附加欄位 `passiveMobs` **一律回傳**（正規化後的陣列；舊記錄缺
 *  欄位 → `[]`＝沒有生物，不報錯；單筆壞掉 → 只丟那一筆，不整包拒絕）。
 *  B3 Task 7——附加欄位 `worldgenVersion` **原樣帶回、絕不在這裡補值**：記錄沒有
 *  這個鍵 → 回傳物件就沒有這個鍵（那正是「舊存檔」的判準）；記錄上是有限數字 →
 *  原樣保留；記錄上是髒值（例如字串 `'x'`——基本結構檢查刻意不看這個附加欄位）
 *  → 把該鍵剝除，不讓髒版本值繼續往外傳。 */
export async function loadGame(): Promise<SavePayloadWithPassiveMobs | null> {
	try {
		const db = await openSaveDb();
		try {
			const tx = db.transaction(STORE, 'readonly');
			const value = await idbRequest<unknown>(tx.objectStore(STORE).get(SLOT_KEY));
			if (value === null || value === undefined || typeof value !== 'object') return null;
			if (!isValidSavePayload(value)) return null;
			// Migration chain: v1 → v2 (advancements) → v3 (stash) → v4 (36 slots)
			// → v5 (durability). The stash is read off the RAW record (only v3+
			// has one) so v1/v2 can derive it from the fields they actually
			// stored. Each spread keeps every additive field (worldgenVersion,
			// passiveMobs, …) intact.
			const v2: SavePayloadV2 =
				value.version === 1
					? { ...value, version: 2, advancements: emptyAdvancements() }
					: { ...value, version: 2, advancements: sanitizeAdvancements(value.advancements) };
			const v3: SavePayloadV3 = {
				...v2,
				version: 3,
				stash: normalizeModeStash((value as Partial<SavePayloadV5>).stash, {
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
			const v4: SavePayloadV4 = {
				...v3,
				version: 4,
				player: {
					...v3.player,
					// 舊 9 格留在前 9 格（熱鍵列）；不足補 null、超過截斷。
					// B7 Task 2：這一步同時把 `dur` materialize 出來——
					// `sanitizeStack` 對耐久物品一律給明確值（合法值原樣、
					// 缺漏或非法值 → 滿耐久）→ v1–v4 的舊工具載入後是滿耐久，
					// 不是「dur 0 ＝ 一用就壞」。
					inventory: sanitizeSlots(v3.player.inventory, INVENTORY_SLOTS),
				},
			};
			// B7 Task 2：v5 ＝ v4 ＋ `ItemStack.dur`（耐久已在上一步 materialize：
			// `sanitizeSlots` 是同一支清洗器，不必重跑）→ 這裡只升版本號。
			const migrated: SavePayloadV5 = {
				...v4,
				version: 5,
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
			const {
				worldgenVersion: rawVersion,
				passiveMobs: rawPassiveMobs,
				...migratedClean
			} = migrated;
			const worldgenVersion = readWorldgenVersion(rawVersion);
			// B4 Task 10：附加欄位 `passiveMobs` —— **一律回傳**（正規化後的陣列）。
			// 1) 舊記錄沒有這個鍵 → 空陣列（＝沒有生物），**不是**壞檔、不報錯。
			// 2) 記錄上有髒值（整包不是陣列／單筆壞掉）→ 逐筆丟棄壞的、留著好的，
			//    **不整包拒絕**（一筆壞紀錄不該讓整份存檔變成「無存檔」）。
			// 3) 上限 12（與生成端同一個常數）→ 超過只保留前 12 筆。
			// 讀取端在這裡**補值**（與 `worldgenVersion` 刻意不補相反）：這個欄位
			// 沒有「是不是舊存檔」的判準用途 → 一律給空陣列最省事，呼叫端也不必
			// 寫「有沒有這個鍵」的分支。
			//
			// 讀的是**遷移後**的 `migrated`（與旁邊 `worldgenVersion` 同一個寫法：
			// 把它從 `migrated` 上解構出來 → 原始的髒值不會跟著被回傳，然後再把
			// 正規化後的值放回去）。
			return {
				...migratedClean,
				...(worldgenVersion === undefined ? {} : { worldgenVersion }),
				passiveMobs: normalizePassiveMobs(rawPassiveMobs),
			};
		} finally {
			db.close();
		}
	} catch {
		return null;
	}
}
