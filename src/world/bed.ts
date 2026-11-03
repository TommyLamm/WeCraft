/**
 * 床的使用規則（B10 Task 6）：距離、睡眠時間窗、怪物阻擋、床頂重生座標。
 *
 * 數值出處：minecraft.wiki `Bed`（2026-11-01 讀 raw 全文）——
 * 使用距離 3 格；睡 101 tick＝5.05 秒；怪物在**床頭**水平 8 格、垂直 5 格內
 * 不可睡。睡眠時間窗原版是晴朗 12523–23477 ticks（≈ t 0.522–0.978）。
 *
 * **本作判準（已揭露的近似）**：可睡＝**時間的內部天空光**
 * `internalSkyLight(15, clockT) <= 11`——本作 `dayFactor` 曲線下的窗口約
 * t 0.488–1.0（跨午夜），比原版略寬；**不讀床所在格的光**（屋頂不影響判定，
 * 原版白天在暗處也不能睡，時間窗口才是主判準）。
 */

import { internalSkyLight } from './lighting';
import type { SpawnPoint } from '../core/spawn-point';

/** 使用距離（格）：眼睛到**床方塊中心**的 3D 距離 ≤ 3 才算近。 */
export const BED_USE_DISTANCE = 3;

/** 可睡的內部天空光上限（內部天空光 15 時，曲線的實際窗口約 t 0.488–1.0）。 */
export const SLEEP_MAX_INTERNAL_SKY_LIGHT = 11;

/** 怪物阻擋：以**床中心**量測，水平 ≤ 8 格、垂直 ≤ 5 格。 */
export const SLEEP_MONSTER_HORIZONTAL = 8;
export const SLEEP_MONSTER_VERTICAL = 5;

/** 睡眠時長：101 tick（5.05 秒）→ 黑幕 → 時間跳到日出（t = 0）。 */
export const SLEEP_DURATION_SEC = 5.05;

/** `bedUse` 的判定結果。 */
export type BedUse = 'too-far' | 'monsters' | 'set-spawn-only' | 'sleep';

/** 床的方塊座標（整數）— 與 `core/spawn-point.ts` 的 `SpawnPoint` 同形。 */
interface BlockPos {
  x: number;
  y: number;
  z: number;
}

/**
 * 一次右鍵床的判定（純函式，順序即原版語意）：
 * 1. 距離（眼睛 → 床方塊中心）> 3 → `'too-far'`（呼叫端連重生點都不設）；
 * 2. 睡眠時間窗（`internalSkyLight(15, clockT) > 11`）→ `'set-spawn-only'`
 *    （白天或有怪物時**仍設定重生點**，只是不能睡——與原版一致）；
 * 3. 能睡時才掃怪物（水平 ≤ 8、垂直 ≤ 5）→ `'monsters'` 或 `'sleep'`。
 */
export function bedUse(ctx: {
  eye: { x: number; y: number; z: number };
  bed: BlockPos; // 方塊座標
  clockT: number;
  monsters: ReadonlyArray<{ pos: { x: number; y: number; z: number } }>;
}): BedUse {
  const cx = ctx.bed.x + 0.5;
  const cy = ctx.bed.y + 0.5;
  const cz = ctx.bed.z + 0.5;
  const distance = Math.hypot(ctx.eye.x - cx, ctx.eye.y - cy, ctx.eye.z - cz);
  if (!(distance <= BED_USE_DISTANCE)) return 'too-far';
  if (internalSkyLight(15, ctx.clockT) > SLEEP_MAX_INTERNAL_SKY_LIGHT) return 'set-spawn-only';
  for (const m of ctx.monsters) {
    const horizontal = Math.hypot(m.pos.x - cx, m.pos.z - cz);
    const vertical = Math.abs(m.pos.y - cy);
    if (horizontal <= SLEEP_MONSTER_HORIZONTAL && vertical <= SLEEP_MONSTER_VERTICAL) {
      return 'monsters';
    }
  }
  return 'sleep';
}

/** 重生座標＝床的**頂面中心**（床方塊上方一格）。 */
export function bedSpawnPosition(bed: BlockPos): { x: number; y: number; z: number } {
  return { x: bed.x + 0.5, y: bed.y + 1, z: bed.z + 0.5 };
}

/**
 * 「床還在不在？」的查證結果（B10 批末審查 I1）。
 *
 * - `placed`：床所在區塊**已載入**、那一格還是床；
 * - `missing`：區塊已載入、**確定不是床**（被拆／被炸）；
 * - `unloaded`：區塊不在記憶體裡 → **無從查證**（不是「床沒了」的證據！）。
 */
export type BedLookup = 'placed' | 'missing' | 'unloaded';

/**
 * 死亡重生點（B10 批末審查 I1）：**只有確定床沒了才回世界出生點**。
 *
 * 背景：`World.getBlock` 對**未載入**的區塊回 `AIR`——直接拿這個結果當「床沒了」
 * 的證據時，玩家離家超過載入距離（預設載入半徑 ~200 格）死亡就會**失去床的重生**
 * ——正是本批的核心承諾。區塊未載入時**信賴存檔記錄**（床回到視野時
 * `reapplyModifiedInChunk` 會把它放回來，重生點就是床頂）；只有 `missing`
 * （已載入、那一格確定不是床）才退回世界出生點。
 *
 * 純函式（不碰世界、不改輸入）。標題／新局不走這裡（`resetPlayerToSpawn` 永遠
 * 用世界出生點）；呼叫端把查證結果算成 {@link BedLookup} 傳進來。
 */
export function respawnPointFor(
  bed: SpawnPoint | null,
  lookup: BedLookup,
  worldSpawn: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  if (bed && lookup !== 'missing') return bedSpawnPosition(bed);
  return worldSpawn;
}
