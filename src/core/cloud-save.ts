// Cloud-save data rules (pure — no window/localStorage/IndexedDB/DOM/Three).
// This module owns the serializable progress payload and the guard/classify
// semantics Task 4 wires to the platform SDK. Modified voxels are NOT part of
// the payload (brief ruling); the cap keeps uploads within the 64 KiB budget.
// B1.3: format 1 stays — per-mode stash support is a purely ADDITIVE optional
// field (old payloads without one are still valid and derive it on accept).
// B3 Task 7：同一套路再來一次——`worldgenVersion` 是 format 1 之下的**附加**
// optional 欄位（格式號本身**不變**）。

import { normalizeVitals, type Vitals } from '../player/survival';
import type { ItemStack } from './items';
import { sanitizeAdvancements, type AdvancementState } from './advancements';
import { normalizeModeStash, type ModeStash, type StashPayload } from './mode-stash';
import { clampSettings, DEFAULT_SETTINGS, type Settings } from './settings';
import { WORLDGEN_VERSION, readWorldgenVersion } from '../world/worldgen';

/** Payload schema version. Must match game.json `writeFormat` (Task 5). */
export const CLOUD_FORMAT_VERSION = 1 as const;

/** Upload budget: 64 KiB of UTF-8 JSON. */
export const CLOUD_MAX_BYTES = 65536 as const;

/** Settings subset that travels in the cloud payload (seed lives top-level). */
export interface CloudSettings {
  renderDistance: number;
  sensitivity: number;
  volume: number;
  mode: 'survival' | 'creative';
  dayLengthSec: number;
  shadows: boolean;
  clouds: boolean;
}

export interface CloudData {
  seed: number;
  pos: [number, number, number];
  yaw: number;
  vitals: Vitals | null;
  clockT: number;
  inventory: (ItemStack | null)[];
  advancements: AdvancementState;
  settings: CloudSettings;
  /** B1.3 additive field (format 1 unchanged): the per-mode stash — each
   *  mode's hotbar plus the survival vitals. The live mode's own hotbar and
   *  vitals travel in the fields above, so the stash carries the OTHER mode's
   *  hotbar and the survival snapshot. Old payloads carry none — they stay
   *  valid and `acceptCloudData` derives the stash from the legacy
   *  mode/inventory/vitals instead. */
  stash?: StashPayload;
  /** B3 Task 7 附加欄位（format 1 不變）：記錄「這份雲端存檔玩的是哪一版生成器
   *  做出來的地形」。B3 之前寫出的 payload **沒有**這個鍵 → 那就是「舊存檔」的
   *  判準，所以接受路徑**不得**自動補值（補了就看不出是舊存檔、也永遠不會跳
   *  「地形已改變」提示）。 */
  worldgenVersion?: number;
}

export interface CloudBuildSource {
  seed: number;
  pos: readonly [number, number, number];
  yaw: number;
  vitals: Vitals | null;
  clockT: number;
  inventory: (ItemStack | null)[];
  advancements: AdvancementState;
  settings: Settings;
  /** Live per-mode stash — copied into the payload (fresh arrays/objects). */
  stash: ModeStash;
}

/** Snapshot live state into a fresh payload. Deep-copies every nested value
 *  (fresh arrays/objects) so later live mutations never leak into the data —
 *  including the per-mode stash, copied slot by slot like the inventory.
 *  Never throws on pos/yaw: however malformed, a non-finite component (or a
 *  non-triple at runtime) becomes [0,0,0] and a non-finite yaw becomes 0. The
 *  nested copies dereference their inputs directly (inventory/stash arrays,
 *  advancements/settings objects) — callers pass live, type-guaranteed state,
 *  and the game-side caller wraps the call in try/catch. seed/clockT pass
 *  through untouched — malformed values are rejected downstream by
 *  `validateCloudData`。B3 Task 7：每一份新組出的 payload 都帶「當前」的
 *  `WORLDGEN_VERSION`——寫入端是唯一會蓋值的地方（接受路徑從不補值，所以舊
 *  payload 仍然看得出是舊存檔）。 */
export function buildCloudData(src: CloudBuildSource): CloudData {
  const pos: [number, number, number] =
    Array.isArray(src.pos) &&
    src.pos.length === 3 &&
    src.pos.every((n) => typeof n === 'number' && Number.isFinite(n))
      ? [src.pos[0], src.pos[1], src.pos[2]]
      : [0, 0, 0];
  const yaw = typeof src.yaw === 'number' && Number.isFinite(src.yaw) ? src.yaw : 0;
  return {
    seed: src.seed,
    pos,
    yaw,
    vitals: src.vitals === null ? null : { ...src.vitals },
    clockT: src.clockT,
    inventory: src.inventory.map((s) => (s === null ? null : { ...s })),
    advancements: { done: { ...src.advancements.done }, nightSeen: src.advancements.nightSeen },
    settings: {
      renderDistance: src.settings.renderDistance,
      sensitivity: src.settings.sensitivity,
      volume: src.settings.volume,
      mode: src.settings.mode,
      dayLengthSec: src.settings.dayLengthSec,
      shadows: src.settings.shadows,
      clouds: src.settings.clouds,
    },
    stash: {
      survival: src.stash.survival.map((s) => (s === null ? null : { ...s })),
      creative: src.stash.creative.map((s) => (s === null ? null : { ...s })),
      survivalVitals: { ...src.stash.survivalVitals },
    },
    worldgenVersion: WORLDGEN_VERSION,
  };
}

/** UTF-8 byte length of the JSON payload. Unknown/extra fields count — the
 *  budget applies to what is actually uploaded, not the known schema. */
export function byteSizeOf(data: CloudData): number {
  return new TextEncoder().encode(JSON.stringify(data)).length;
}

const isFiniteNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** Structural check for an untrusted payload. Unknown extra fields are
 *  allowed (forwards-compatible); advancements only needs to be an object
 *  because `sanitizeAdvancements` normalizes it on the accept path, and the
 *  B1.3 stash only needs to be an object-or-absent for the same reason
 *  (`normalizeModeStash`)。B3 Task 7：附加欄位 `worldgenVersion` 若存在，必須是
 *  有限數字，否則整筆拒收（髒值若流入「是不是舊存檔」的比較就難以察覺）；不存在
 *  則仍然合法（舊 payload）。「什麼算合法版本值」由 worldgen.ts 的
 *  `readWorldgenVersion` 單一定義（本機存檔讀取端也用同一支）→ 兩邊不會漂移。 */
export function validateCloudData(x: unknown): x is CloudData {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  if (!isFiniteNum(r.seed)) return false;
  if (!Array.isArray(r.pos) || r.pos.length !== 3 || !r.pos.every(isFiniteNum)) return false;
  if (!isFiniteNum(r.yaw)) return false;
  if (!isFiniteNum(r.clockT)) return false;
  if (!Array.isArray(r.inventory)) return false;
  for (const slot of r.inventory) {
    if (slot === null) continue;
    if (typeof slot !== 'object' || slot === null) return false;
    const s = slot as Record<string, unknown>;
    if (typeof s.item !== 'string' || !isFiniteNum(s.count)) return false;
  }
  if (r.vitals !== null) {
    if (typeof r.vitals !== 'object' || r.vitals === null) return false;
    if (!isFiniteNum((r.vitals as Record<string, unknown>).hp)) return false;
  }
  if (typeof r.advancements !== 'object' || r.advancements === null) return false;
  if (r.stash !== undefined && (typeof r.stash !== 'object' || r.stash === null)) return false;
  if (typeof r.settings !== 'object' || r.settings === null) return false;
  const s = r.settings as Record<string, unknown>;
  if (!isFiniteNum(s.renderDistance)) return false;
  if (!isFiniteNum(s.sensitivity)) return false;
  if (!isFiniteNum(s.volume)) return false;
  if (s.mode !== 'survival' && s.mode !== 'creative') return false;
  if (!isFiniteNum(s.dayLengthSec)) return false;
  if (typeof s.shadows !== 'boolean') return false;
  if (typeof s.clouds !== 'boolean') return false;
  if (r.worldgenVersion !== undefined && readWorldgenVersion(r.worldgenVersion) === undefined) {
    return false;
  }
  return true;
}

/** Validate then return a normalized fresh copy, or null when invalid.
 *  Normalization: advancements via `sanitizeAdvancements` (unknown ids and
 *  non-boolean values dropped), settings via the settings.ts clamp logic
 *  (seeded with defaults, seed stripped back off), vitals via survival.ts
 *  `normalizeVitals` (finite + clamped — a partial payload can't inject NaN),
 *  stash via `normalizeModeStash` (slots sanitized to the hotbar width, vitals
 *  normalized; absent in old format-1 payloads — then derived from the mode,
 *  inventory and vitals they DID record). Illegal inventory item ids are KEPT
 *  as strings — the main-side inventory model discards them.
 *  B3 Task 7：附加欄位 `worldgenVersion` **原樣帶回、絕不在這裡補值**——payload
 *  沒有這個鍵 → 回傳物件就沒有這個鍵（那正是「舊存檔」的判準）。帶著髒值的情況
 *  `validateCloudData` 已經整筆拒收了。 */
export function acceptCloudData(x: unknown): CloudData | null {
  if (!validateCloudData(x)) return null;
  const clamped = clampSettings({ ...DEFAULT_SETTINGS, ...x.settings });
  const worldgenVersion = x.worldgenVersion;
  return {
    seed: x.seed,
    pos: [x.pos[0], x.pos[1], x.pos[2]],
    yaw: x.yaw,
    vitals: x.vitals === null ? null : normalizeVitals(x.vitals),
    clockT: x.clockT,
    inventory: x.inventory.map((s) => (s === null ? null : { ...s })),
    advancements: sanitizeAdvancements(x.advancements),
    stash: normalizeModeStash(x.stash, {
      mode: clamped.mode, // the clamped mode decides which side the legacy fields feed
      inventory: x.inventory,
      vitals: x.vitals,
    }),
    settings: {
      renderDistance: clamped.renderDistance,
      sensitivity: clamped.sensitivity,
      volume: clamped.volume,
      mode: clamped.mode,
      dayLengthSec: clamped.dayLengthSec,
      shadows: clamped.shadows,
      clouds: clamped.clouds,
    },
    ...(worldgenVersion === undefined ? {} : { worldgenVersion }),
  };
}

/** Revision observed by the last successful cloud read (null = never read). */
export type CloudSaveGuard = { revision: number | null };

/** A failed/unread revision must never overwrite the cloud slot — even the
 *  first read of an empty slot (revision 0) is an explicit allow. */
export function shouldAllowSave(g: CloudSaveGuard): boolean {
  return g.revision !== null;
}

export type CloudErrorKind =
  | 'CONFLICT'
  | 'FORMAT'
  | 'REQUEST_REUSED'
  | 'AUTH'
  | 'NETWORK'
  | 'UNAVAILABLE';

/** Classify a platform SDK failure. Precedence: known machineCodes first,
 *  then auth signals, then the conservative bare-409 rule (a bare 409 with
 *  no machineCode is treated as CONFLICT; FORMAT is ONLY ever assigned from
 *  its machineCode), then unavailable, else network. */
export function classifyCloudError(err: unknown): CloudErrorKind {
  if (err === null || err === undefined) return 'UNAVAILABLE';
  const rec =
    typeof err === 'object' || typeof err === 'function'
      ? (err as Record<string, unknown>)
      : {};
  const machineCode = typeof rec.machineCode === 'string' ? rec.machineCode : null;
  if (machineCode === 'SAVE_REVISION_CONFLICT') return 'CONFLICT';
  if (machineCode === 'SAVE_FORMAT_INCOMPATIBLE') return 'FORMAT';
  if (machineCode === 'REQUEST_ID_REUSED') return 'REQUEST_REUSED';
  if (rec.code === 401 || rec.code === 403 || rec.status === 401 || rec.status === 403) {
    return 'AUTH';
  }
  if (
    machineCode !== null &&
    (machineCode.includes('AUTH') || machineCode.includes('PERMISSION'))
  ) {
    return 'AUTH';
  }
  const code = typeof err === 'number' ? err : rec.code;
  if (code === 409 || rec.status === 409) return 'CONFLICT';
  return 'NETWORK';
}
