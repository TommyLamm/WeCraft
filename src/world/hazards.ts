/**
 * 危險傷害（B3 Task 6）：仙人掌接觸傷害。
 *
 * 這個模組是**純邏輯層**：不依賴 DOM／Three.js／`main.ts` 的任何狀態，
 * `touchesCactus` 只吃 `World`（查方塊），`stepHazards` 只做時間累積。
 * 接線（扣血、無敵幀）由 `src/main.ts` 負責。
 *
 * 規則：站著不動不扣血；**持續**接觸仙人掌時每秒扣 1 點血（不是每幀一次）。
 * 累積器（`cactusAcc`）保留未滿 1 秒的餘數 → 幀率不同也不會改變傷害節奏。
 *
 * 與原版的差異（minecraft.wiki/Cactus#Natural generation，2026-10-20）：
 * 原版是「身體擦到仙人掌就受傷」（仙人掌的碰撞形狀內縮 1/16，所以擦邊也會
 * 挨刺）；本作是**整格判定** → 只有身體框與仙人掌格重疊（踩在仙人掌上、
 * 或跳過仙人掌時）才會受傷，站在仙人掌旁邊不會扣血。
 */
import { BLOCK } from './blocks';
import type { World } from './world';

/** 仙人掌的傷害速率（每秒的傷害點數）。 */
export const CACTUS_DAMAGE_PER_SEC = 1;

/**
 * 腳下要往下掃幾層。
 *
 * 玩家踩在仙人掌上時，腳底**高於**仙人掌那一格（仙人掌是實心方塊）→ 只掃
 * 「腳底到頭頂」會漏掉「站在仙人掌上」這個最常見的受傷情境。往下多掃 2 層
 * 就把它涵蓋進來。
 */
const CACTUS_FOOT_SCAN_LAYERS = 2;

/** 危險狀態（純資料；每幀由 `stepHazards` 產生新的物件）。 */
export interface HazardState {
  /** 已累積的接觸秒數（滿 1 秒 → 1 點傷害；餘數留在這裡）。 */
  cactusAcc: number;
}

/** 新的危險狀態（沒有累積的接觸時間）。 */
export function createHazardState(): HazardState {
  return { cactusAcc: 0 };
}

/**
 * 玩家的身體框有沒有碰到仙人掌。
 *
 * 掃描範圍＝身體框（寬 `2 × halfWidth`、高 `height`）**加上腳下 2 層**，
 * 任何一格是 `BLOCK.CACTUS` 就算接觸。
 *
 * **本作採「整格判定」**：原版是「貼框擦邊判定」（仙人掌的碰撞形狀內縮 1/16，
 * 身體擦過就算受傷）→ **站在仙人掌旁邊的格不會受傷**，只有踩在仙人掌上、
 * 或跳過仙人掌時身體框與仙人掌格重疊才會受傷。這個差異要寫進 Task 10 的
 * README／發布說明〈與原版的差異〉。
 *
 * 非有限值（壞掉的座標／尺寸）一律回 false → NaN 不會變成「一直受傷」。
 */
export function touchesCactus(
  world: World,
  pos: { x: number; y: number; z: number },
  halfWidth: number,
  height: number,
): boolean {
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return false;
  if (!Number.isFinite(halfWidth) || !Number.isFinite(height)) return false;

  const minX = Math.floor(pos.x - halfWidth);
  const maxX = Math.floor(pos.x + halfWidth - 1e-9);
  const minZ = Math.floor(pos.z - halfWidth);
  const maxZ = Math.floor(pos.z + halfWidth - 1e-9);
  const minY = Math.floor(pos.y - CACTUS_FOOT_SCAN_LAYERS);
  const maxY = Math.floor(pos.y + height - 1e-9);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        if (world.getBlock(x, y, z) === BLOCK.CACTUS) return true;
      }
    }
  }
  return false;
}

/**
 * 前進一幀的危險傷害。
 *
 * - **沒有接觸** → 不扣血，累積器歸零（離開後重新接觸要重新累積）。
 * - **有接觸** → 累積 `dt` 秒；每滿 1 秒造成 `CACTUS_DAMAGE_PER_SEC` 點傷害，
 *   餘數留在新的狀態裡。
 * - **非有限的 dt**（NaN／±Infinity）視為 0 → 不會憑空扣血。
 *
 * 回傳新的狀態物件（輸入不被修改），與 repo 其他純模組的契約一致。
 */
export function stepHazards(
  state: HazardState,
  touching: boolean,
  dt: number,
): { state: HazardState; damage: number } {
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  if (!touching) return { state: createHazardState(), damage: 0 };
  const banked = Number.isFinite(state.cactusAcc) ? state.cactusAcc : 0;
  const acc = banked + step;
  const whole = Math.floor(acc);
  return {
    state: { cactusAcc: acc - whole },
    damage: whole * CACTUS_DAMAGE_PER_SEC,
  };
}
