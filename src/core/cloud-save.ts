// Cloud-save data rules (pure — no window/localStorage/IndexedDB/DOM/Three).
// This module owns the serializable progress payload and the guard/classify
// semantics Task 4 wires to the platform SDK. Modified voxels are NOT part of
// the payload (brief ruling); the cap keeps uploads within the 64 KiB budget.
// B1.3→B4：format 1 時代（0.4.0–0.7.0）一路只用**附加** optional 欄位
// （per-mode stash／`worldgenVersion`／`passiveMobs`）→ 格式號維持 1。
// B5 Task 9：**一次升到 format 2**——36 格背包改變了 `inventory`（與 stash
// 兩側）的語義（舊欄位語義無法保留），所以這次不是附加欄位、是格式升版：
// - `readableFormats` 累積 [1, 2]（只累積、不縮）；format 1 的 9 格 payload
//   讀入時經 {@link migrateInventorySlots} 遷移成 36 格（舊物品留在前 9 格
//   ＝熱鍵列、其餘 27 格補 null），下一次檢查點即以 format 2 覆寫（升級路徑）。
// - **回退限制**：0.8.0 寫出的 format 2 資料，0.7.0（只宣告 [1]）讀不到 →
//   平台會擋不相容回退（`SAVE_FORMAT_INCOMPATIBLE`）。此點寫進發布說明。
// B7 Task 3：**一次升到 format 3**——堆疊多了 `dur`（工具耐久）＝ `inventory`
// （與 stash 兩側）語義再次改變，所以又一次格式升版：
// - `readableFormats` 累積 [1, 2, 3]（只累積、不縮）；讀入（`acceptCloudData`）
//   與寫出前（`buildCloudData`）都是**先** {@link migrateInventorySlots}
//   （補 null／截斷到 36 格）**再**逐格 `dur` 正規化——耐久物品帶明確 `dur`
//   （缺漏／非法 → 上限），非耐久物品不帶 `dur`。
// - **回退限制**：0.10.0 寫出的 format 3 資料，0.9.0（只宣告 [1, 2]）讀不到 →
//   平台會擋不相容回退（`SAVE_FORMAT_INCOMPATIBLE`）。此點寫進發布說明。
// - `game.json` 的 `cloudSave` 同步宣告（測試釘死兩邊一致）。
// B8 Task 5：**一次升到 format 4**——payload 新增附加欄位 `blockEntities`
// （箱子內容＋熔爐狀態）：
// - `readableFormats` 累積 [1, 2, 3, 4]（只累積、不縮）；format 1–3 的舊
//   payload 沒有這個欄位 → 接受路徑給**空清單**（不是壞 payload）。
// - **回退限制**：0.11.0 寫出的 format 4 資料，0.10.0（只宣告 [1, 2, 3]）讀不到
//   → 平台會擋不相容回退（`SAVE_FORMAT_INCOMPATIBLE`）。此點寫進發布說明。
// - **已知限制**：雲端 payload 不帶 voxel 編輯（本檔開頭）→ 從雲端還原後，
//   塊實體的座標可能對應不到世界裡的箱子／熔爐 → 內容暫時不可達（不會消失），
//   要玩家在同座標放一個箱子／熔爐才看得到。本批不解決，但必須誠實揭露。

import { normalizeVitals, type Vitals } from '../player/survival';
import { createInventoryModel } from './inventory';
import { INVENTORY_SLOTS, type ItemId, type ItemStack } from './items';
import { maxDurability, normalizeDurability } from './durability';
import {
  sanitizeAdvancements,
  type AdvancementId,
  type AdvancementState,
} from './advancements';
import { normalizeModeStash, type ModeStash, type StashPayload } from './mode-stash';
import { clampSettings, DEFAULT_SETTINGS, type Settings } from './settings';
import { WORLDGEN_VERSION, readWorldgenVersion } from '../world/worldgen';
import {
  normalizePassiveMobs,
  serializePassiveMobs,
  type PassiveMobRecord,
} from '../world/passive-save';
import type { PassiveMob } from '../world/passive-mobs';
import {
  normalizeBlockEntities,
  serializeBlockEntities,
  type BlockEntity,
} from '../world/block-entities';

/** Payload schema version. Must match game.json `writeFormat` (Task 5).
 *  B5 Task 9：36 格背包改變 `inventory` 語義 → 由 1 升到 **2**。
 *  B7 Task 3：堆疊帶 `dur`（工具耐久）→ 由 2 升到 **3**。
 *  B8 Task 5：payload 帶塊實體（箱子內容＋熔爐狀態）→ 由 3 升到 **4**。 */
export const CLOUD_FORMAT_VERSION = 4 as const;

/** 本版本能讀的格式（**只累積、不縮**）。format 1 = 9 格背包（≤0.7.0）；
 *  format 2 = 36 格背包（B5 起）；format 3 = 堆疊帶 `dur`（B7 起）；
 *  format 4 = 塊實體（B8 起）。main.ts
 *  的三處讀取檢查用 {@link isReadableCloudFormat}（不再與單一版本號比較）→
 *  讀到 format 1／2／3 照常套用（接受路徑完成 9→36 遷移、`dur` materialize
 *  與空塊實體清單），下一次檢查點即以 format 4 覆寫。 */
export const CLOUD_READABLE_FORMATS: ReadonlyArray<number> = [1, 2, 3, 4] as const;

/** 是否為本版可讀的雲端格式（main.ts 三處讀取檢查的單一真值）。 */
export function isReadableCloudFormat(v: number): boolean {
  return CLOUD_READABLE_FORMATS.includes(v);
}

/**
 * 把 inventory 陣列正規化到 36 格（format 1 → format 2 的遷移核心）。
 *
 * 規則：逐格深拷貝 → 不足 36 格補 `null`、超過截斷到 36。**未知 item id 仍
 * 保留為字串**（沿用既有語意，由主線的 inventory model 丟棄）。回傳全新陣列
 * → 改動結果不會回寫呼叫端的資料。format 1 的 9 格舊資料落在**前 9 格**
 * （熱鍵列語義不變），其餘 27 格留空。
 */
export function migrateInventorySlots(
  x: ReadonlyArray<ItemStack | null>,
): Array<ItemStack | null> {
  const out: Array<ItemStack | null> = [];
  for (let i = 0; i < INVENTORY_SLOTS; i++) {
    const s = i < x.length ? x[i] : null;
    out.push(s === null ? null : { ...s });
  }
  return out;
}

/** 雲端堆疊的 `dur` 正規化（format 3 的核心）：耐久物品 → **明確值**（缺漏／
 *  非法 → 上限）；其餘（含未知 item id——沒有上限可算）→ **沒有 `dur` 欄位**。
 *  一律回傳新物件；呼叫端負責先過 {@link migrateInventorySlots}（先遷移槽位數、
 *  再正規化 `dur`——順序不可顛倒）。 */
function normalizeCloudStack(s: ItemStack): ItemStack {
  const max = maxDurability(s.item);
  if (max <= 0) return { item: s.item, count: s.count };
  const dur = normalizeDurability(s.item, s.dur);
  return { item: s.item, count: s.count, dur: dur ?? max };
}

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
  /** 背包槽位（B5 起 format 2：**36 格**——前 9 格熱鍵列＋27 格主背包）。
   *  format 1 的 9 格 payload 讀入時由 `acceptCloudData` 遷移成 36 格。
   *  B7 起 format 3：每格可帶 `dur`，且讀寫兩端都會正規化成明確值（耐久物品）
   *  或不帶（非耐久物品）。 */
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
  /** B4 Task 10 附加欄位（format 1 不變）：場上有哪些被動生物、在哪、血量多少、
   *  面朝哪裡。舊 payload 沒有這個鍵 → 那是「舊存檔」→ 接受路徑給**空陣列**
   * （＝沒有生物），**不是**壞 payload。 */
  passiveMobs?: PassiveMobRecord[];
  /** B8 Task 5 附加欄位（format 4 起）：塊實體（箱子內容＋熔爐狀態）。
   *  format 1–3 的 payload 沒有這個欄位 → 接受路徑給**空清單**（不是壞
   *  payload）；`CloudData` 保持 optional，`acceptCloudData` 回傳時一律存在。 */
  blockEntities?: BlockEntity[];
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
  /** Live passive mobs (B4 Task 10) — copied into the payload as
   *  `{ kind, x, y, z, hp, yaw }` records. **必填**（沒有生物也要明寫空陣列）。 */
  passiveMobs: readonly PassiveMob[];
  /** Live block entities (B8 Task 5) — chest contents + furnace states,
   *  deep-copied into the payload. **必填**（沒有塊實體也要明寫空陣列）。 */
  blockEntities: ReadonlyArray<BlockEntity>;
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
    // B5 Task 9 的寬度保證＋B7 Task 3 的 `dur` 正規化：`migrateInventorySlots`
    // 先逐格深拷貝並補 null／截斷到 36 格，再逐格套 `normalizeCloudStack`
    // （耐久物品帶明確 `dur`、非耐久物品不帶）→ 寫出的 payload 一定是
    // format 3 的形狀。順序不可顛倒。
    inventory: migrateInventorySlots(src.inventory).map((s) =>
      s === null ? null : normalizeCloudStack(s),
    ),
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
    // B7 Task 3：stash 兩側同理——先 `migrateInventorySlots`（寬度保證＋深拷貝）
    // 再逐格 `dur` 正規化；`survivalVitals` 照舊原樣深拷貝。
    stash: {
      survival: migrateInventorySlots(src.stash.survival).map((s) =>
        s === null ? null : normalizeCloudStack(s),
      ),
      creative: migrateInventorySlots(src.stash.creative).map((s) =>
        s === null ? null : normalizeCloudStack(s),
      ),
      survivalVitals: { ...src.stash.survivalVitals },
    },
    worldgenVersion: WORLDGEN_VERSION,
    // B4 Task 10：被動生物的持久化記錄（種類／座標／血量／朝向）。`vel`／
    // `kbVel` 是暫態 → 不寫進 payload。
    passiveMobs: serializePassiveMobs(src.passiveMobs),
    // B8 Task 5：塊實體（箱子內容＋熔爐狀態）——逐筆深拷貝（`dur` 一起帶走）。
    blockEntities: serializeBlockEntities(src.blockEntities),
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
  // B4 Task 10：附加欄位 `passiveMobs` 若存在，必須是陣列（逐筆的內容交給
  // `normalizePassiveMobs` 處理 → 不在這裡收緊）。不存在則仍然合法（舊 payload）。
  if (r.passiveMobs !== undefined && !Array.isArray(r.passiveMobs)) return false;
  // B8 Task 5：附加欄位 `blockEntities` 同理——只驗證「是陣列」，逐筆內容交給
  // `normalizeBlockEntities`（一筆壞箱子不讓整包被拒）。
  if (r.blockEntities !== undefined && !Array.isArray(r.blockEntities)) return false;
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
 *  B7 Task 3：inventory 先 `migrateInventorySlots`（補 null／截斷到 36 格）
 *  再逐格 `dur` 正規化（耐久物品帶明確 `dur`，缺漏／非法 → 上限；非耐久物品
 *  不帶 `dur`）——那就是 format 3 的接受形狀。
 *  B3 Task 7：附加欄位 `worldgenVersion` **原樣帶回、絕不在這裡補值**——payload
 *  沒有這個鍵 → 回傳物件就沒有這個鍵（那正是「舊存檔」的判準）。帶著髒值的情況
 *  `validateCloudData` 已經整筆拒收了。
 *  B4 Task 10：附加欄位 `passiveMobs` **一律回傳**（正規化後的陣列）——payload
 *  沒有這個鍵 → 空陣列（沒有生物）；單筆壞掉 → 只丟那一筆，不整包拒絕。 */
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
    // B5 Task 9：format 1 的 9 格（或更短）payload 在這裡完成 9→36 遷移；
    // format 2 的 36 格原樣通過（仍逐格拷貝）。B7 Task 3：遷移**之後**再逐格
    // `dur` 正規化——舊工具（沒有 `dur`）載入即滿耐久、壞掉的工具保留剩餘
    // 耐久；未知 id 仍保留為字串但 `dur` 一律丟掉。順序不可顛倒。
    inventory: migrateInventorySlots(x.inventory).map((s) =>
      s === null ? null : normalizeCloudStack(s),
    ),
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
    // B4 Task 10：附加欄位 `passiveMobs` **一律回傳**（正規化後的陣列）——舊
    // payload 沒有這個鍵 → 空陣列（沒有生物）；單筆壞掉 → 只丟那一筆。
    passiveMobs: normalizePassiveMobs(x.passiveMobs),
    // B8 Task 5：附加欄位 `blockEntities` **一律回傳**（正規化後的清單）——舊
    // payload 沒有這個鍵 → 空清單；單筆壞掉 → 只丟那一筆（絕不整包拒絕）。
    blockEntities: normalizeBlockEntities(x.blockEntities),
  };
}

/**
 * C1「合併」：把另一台裝置的進度併進本機（**純函式**、回傳全新物件）。
 *
 * 規則（單一真值；`mergeCloudData` 是唯一的合併語意）：
 * 1. **以本機為基底**——`pos`／`yaw`／`clockT`／`vitals`／`settings`／`seed`／
 *    `worldgenVersion`／`stash`／`passiveMobs` **一律用本機**。理由：玩家正站在
 *    本機的世界裡；採用遠端的 seed 或世界生成版本會把腳下的地形換掉，採用遠端
 *    的設定會當場改變遊戲模式與偏好。合併**不是**「採用雲端」——那是另一個選項
 *    （take-cloud）。
 * 2. **只補本機一顆都沒有的 item id**（逐 id 全有全無）：本機總量 > 0 的 id
 *    完全跳過（合併**不得複製**雙方都有的物品，否則玩家只要按一次合併就能刷
 *    物品）；本機總量為 0 的 id 以 `addItem` 語意補進背包——**放不下就整個 id
 *    捨棄**，絕不為了塞雲端物品而動本機任何一格。
 * 3. **advancements 取聯集**（`done` 逐鍵 OR、`nightSeen` OR）：成就只增不減。
 * 4. **64 KiB 上限**（防禦縱深）：`CLOUD_MAX_BYTES` 是上傳預算，合併結果不得
 *    超過；超量時**從最後一個雲端補入的 id 開始回退**，直到放得下為止（本機
 *    基底本身若已超量，就只剩本機基底——本機內容永遠不被合併捨棄）。
 *
 * 耐久物品逐堆疊補入（各自保留 `dur`）——合併既不會修好一把壞掉的鎬，也不會
 * 把它們疊成一堆。輸入必須是正規化過的 `CloudData`（`acceptCloudData`／
 * `buildCloudData` 的產物）；本機背包仍會先過 `migrateInventorySlots` 保證
 * 寬度與深拷貝。
 */
export function mergeCloudData(local: CloudData, remote: CloudData): CloudData {
  // 1. 遠端獨有的 item id（本機總量為 0），順序＝遠端 payload 的出現順序。
  const localTotals = new Set<ItemId>();
  for (const s of local.inventory) if (s) localTotals.add(s.item);
  const candidates: ItemId[] = [];
  for (const s of remote.inventory) {
    if (!s || localTotals.has(s.item) || candidates.includes(s.item)) continue;
    candidates.push(s.item);
  }

  // 2. 逐 id 全有全無地補進本機（放不下 → 整個 id 捨棄）。
  const build = (ids: readonly ItemId[]): CloudData => {
    const inv = createInventoryModel(migrateInventorySlots(local.inventory), 'survival');
    for (const id of ids) {
      let total = 0;
      for (const s of remote.inventory) if (s && s.item === id) total += s.count;
      if (!inv.fits(id, total)) continue; // 放不下 → 整個 id 捨棄
      for (const s of remote.inventory) {
        if (s && s.item === id) inv.addItem(id, s.count, s.dur);
      }
    }
    const localDone = local.advancements?.done ?? {};
    const remoteDone = remote.advancements?.done ?? {};
    const done: Partial<Record<AdvancementId, boolean>> = { ...localDone };
    for (const [k, v] of Object.entries(remoteDone) as Array<
      [AdvancementId, boolean | undefined]
    >) {
      if (v === true) done[k] = true; // union: a true on either side wins
    }
    return {
      seed: local.seed,
      pos: [local.pos[0], local.pos[1], local.pos[2]],
      yaw: local.yaw,
      vitals: local.vitals === null ? null : { ...local.vitals },
      clockT: local.clockT,
      inventory: inv.slots.map((s) => (s ? { ...s } : null)),
      advancements: {
        done,
        nightSeen: local.advancements?.nightSeen === true || remote.advancements?.nightSeen === true,
      },
      settings: { ...local.settings },
      ...(local.stash === undefined
        ? {}
        : {
            stash: {
              survival: local.stash.survival.map((s) => (s ? { ...s } : null)),
              creative: local.stash.creative.map((s) => (s ? { ...s } : null)),
              survivalVitals: { ...local.stash.survivalVitals },
            },
          }),
      ...(local.worldgenVersion === undefined ? {} : { worldgenVersion: local.worldgenVersion }),
      ...(local.passiveMobs === undefined
        ? {}
        : { passiveMobs: local.passiveMobs.map((m) => ({ ...m })) }),
      // B8 Task 5（規則 1 的延伸）：塊實體是本機進度 → 合併時一律用本機，
      // 與 stash／passiveMobs 同款深拷貝（merge 目前未接線，但語意先釘住）。
      ...(local.blockEntities === undefined
        ? {}
        : { blockEntities: serializeBlockEntities(local.blockEntities) }),
    };
  };

  // 3. 超量 → 從最後一個雲端補入的 id 開始回退。
  let ids = candidates;
  let merged = build(ids);
  while (byteSizeOf(merged) > CLOUD_MAX_BYTES && ids.length > 0) {
    ids = ids.slice(0, -1);
    merged = build(ids);
  }
  return merged;
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
