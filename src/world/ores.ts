import { hash2 } from '../core/noise';
import { BLOCK } from './blocks';
import { CHUNK_HEIGHT, CHUNK_SIZE, chunkIndex } from './chunk';

/**
 * B5 Task 6：礦脈生成（原版 Y → 本作 Y 的深度映射 ＋ 逐格密度模型）。
 *
 * ## 為什麼要映射
 *
 * 本作的地下只有原版的一半深：兩作都以海平面（水的最高一格）為深度 0，
 * 原版從 Y=62 到基岩 Y=−64 有 126 格，本作從 Y=62 到 Y=0 只有 62 格。
 * 若直接照抄原版的礦石 Y 值，金／鑽石會全部擠在「地表下 1 格」附近。
 * 因此用**兩錨點的線性壓縮**：
 *
 * ```
 * Y_g = 62 − (62 − Y_v) × k       k = 62 / 126
 *     = 31.49206349 + 0.49206349 × Y_v
 * ```
 *
 * 錨點：`Y_v = 62 → Y_g = 62`（海平面對齊）、`Y_v = −64 → Y_g = 0`（基岩對齊）。
 * 反向映射 `unmapVanillaY` 供權重查表／除錯使用。
 *
 * ## 為什麼煤炭不重排
 *
 * 原版煤炭的三角帶下緣在 Y=0（映射後本作 y=31）；若照映射重排，低窪地形
 * （海底 h≈35，石頭只有 1..30）會完全沒有燃料。煤炭維持既有的均勻密度
 * （1/120、覆蓋全部石頭深度），其餘礦石照原版深度帶重排（它們不是燃料，
 * 不影響可玩性）。
 *
 * ## 為什麼是「逐格密度」而不是 blob 礦脈
 *
 * 本作沿用既有的逐格雜湊模型（`hash2` 逐格擲骰），不是原版的 blob 礦脈。
 * 形狀（三角／單調遞減）對齊原版、粒度不對齊——這是 README 明列的簡化。
 * 每個礦種有獨立的鹽值，且鹽值混進**座標**（不是 seed），避免不同礦的
 * 雜湊互相相關。XOR 混合（而不是 `wx * A + y * B` 這種線性組合）是為了
 * 避免 `(wx+7, y−131)` 與 `(wx, y)` 撞同一個輸入、產生斜向條紋。
 *
 * ## 與地形的接線
 *
 * `placeOres` 在 `generateChunk` 的「填地形＋切洞穴」之後呼叫：
 * 只取代 `BLOCK.STONE`，所以洞穴（空氣）與水／土／地表都不會被換掉。
 * 順序上等價於舊版「先放礦、再切洞穴」（洞穴裡的礦最後同樣不存在），
 * 但放寬了舊版 `y < h − 6` 的限制——整個石頭層都能長礦（純外觀差異）。
 * 一個格子只放一種礦（`break`，先到先得）；y=0 是基岩層，永不替換。
 */

/** 原版海平面（水的最高一格）＝本作海平面 62 —— 映射的共同錨點。 */
export const VANILLA_SEA_LEVEL = 62;
/** 原版基岩層 Y = −64 —— 映射的另一個錨點。 */
export const VANILLA_FLOOR = -64;
/** 深度壓縮係數：本作地下 62 格 ÷ 原版地下 126 格。 */
export const DEPTH_COMPRESSION = 62 / 126;

/** 兩錨點線性映射的截距：`Y_g = OFFSET + k × Y_v`。 */
const OFFSET = VANILLA_SEA_LEVEL * (1 - DEPTH_COMPRESSION);

/** 原版 Y → 本作 Y。 */
export function mapVanillaY(yVanilla: number): number {
  return OFFSET + DEPTH_COMPRESSION * yVanilla;
}

/** 本作 Y → 原版 Y（反向，供權重查表用）。 */
export function unmapVanillaY(yGame: number): number {
  return (yGame - OFFSET) / DEPTH_COMPRESSION;
}

/** 權重形狀：均勻、三角（峰在 `peakY`、半寬 `halfWidth`）、線性遞減。 */
export type OreShape = 'uniform' | 'triangle' | 'ramp';

export interface OreSpec {
  block: number; // BLOCK.*
  minY: number; // 本作 Y 的帶下緣（含）
  maxY: number; // 本作 Y 的帶上緣（含）
  shape: OreShape;
  peakY: number; // triangle 的峰；ramp 的帶下緣
  halfWidth: number; // triangle 的半寬
  baseChance: number; // 每格在 weight=1 時的機率
  salt: number; // 雜湊鹽值（每種礦不同）
}

/**
 * 礦石表（〈已查證與設計決策〉§3–§5）。
 *
 * 深度帶由原版範圍經 `mapVanillaY` 取整：
 * - 金：原版 −64..32、峰 −16 → 本作 0..47、峰 24（三角，半寬 24）。
 * - 鐵：原版 −64..72、峰 16 → 本作 0..67、峰 39（三角，半寬 39）。
 * - 鑽石：原版 −63..16、最深處最常見 → 本作 1..39（y=0 是基岩，從 1 起）。
 * - 煤：**刻意不重排**（見檔頭），維持 0..126 均勻。
 * - 礫石：原版礫石是地表／水下團塊；本作放在 0..60 的均勻帶（B5 的外觀簡化）。
 */
export const ORES: ReadonlyArray<OreSpec> = [
  { block: BLOCK.COAL_ORE, minY: 0, maxY: 126, shape: 'uniform', peakY: 0, halfWidth: 0, baseChance: 1 / 120, salt: 0x51a3c7e1 },
  { block: BLOCK.IRON_ORE, minY: 0, maxY: 67, shape: 'triangle', peakY: 39, halfWidth: 39, baseChance: 1 / 260, salt: 0x2f8b1d55 },
  { block: BLOCK.GOLD_ORE, minY: 0, maxY: 47, shape: 'triangle', peakY: 24, halfWidth: 24, baseChance: 1 / 900, salt: 0x7c1d9a03 },
  { block: BLOCK.DIAMOND_ORE, minY: 1, maxY: 39, shape: 'ramp', peakY: 1, halfWidth: 0, baseChance: 1 / 1400, salt: 0x3b5e2f77 },
  { block: BLOCK.GRAVEL, minY: 0, maxY: 60, shape: 'uniform', peakY: 0, halfWidth: 0, baseChance: 1 / 1200, salt: 0x6c9a41bb },
];

/** `oreWeight` 的回傳值域是 0..1；帶外一律 0（呼叫端靠這個短路省下擲骰）。 */
export function oreWeight(spec: OreSpec, y: number): number {
  if (y < spec.minY || y > spec.maxY) return 0;
  if (spec.shape === 'uniform') return 1;
  if (spec.shape === 'ramp') return (spec.maxY - y) / (spec.maxY - spec.minY);
  return Math.max(0, 1 - Math.abs(y - spec.peakY) / spec.halfWidth);
}

/** `hash2` 的值域大小（32 位無號整數）→ 擲骰值域 [0, 1)。 */
const HASH_RANGE = 4294967296;

/**
 * 把礦石放進一個已生成好的 chunk（就地修改 `data`）。
 *
 * 前提：`data` 已完成地形填寫與洞穴切挖（`generateChunk` 的主迴圈），
 * 因此「不是石頭」的格子（空氣／水／土／沙／基岩）一律跳過——這同時保證
 * 洞穴裡不會長礦，且 y=0 的基岩不會被換掉。
 *
 * 決定性：同一組 `(data, cx, cz, seed)` 永遠得到同一份結果（純雜湊，無隨機狀態）。
 */
export function placeOres(data: Uint8Array, cx: number, cz: number, seed: number): void {
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;
  // 每個 y 的權重對整層共用 → 先算一次，內層只做查表。
  const weights = new Array<number>(ORES.length);

  for (let y = 1; y < CHUNK_HEIGHT; y++) {
    let anyInBand = false;
    for (let o = 0; o < ORES.length; o++) {
      const w = oreWeight(ORES[o], y);
      weights[o] = w;
      if (w > 0) anyInBand = true;
    }
    // 所有礦種都不在這個高度 → 整層跳過（煤炭帶以上只剩空氣，省下掃描）。
    if (!anyInBand) continue;

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wz = baseZ + lz;
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const i = chunkIndex(lx, y, lz);
        // 礦只取代石頭：泥土／沙／水／空氣／基岩都不換。
        if (data[i] !== BLOCK.STONE) continue;
        const wx = baseX + lx;

        for (let o = 0; o < ORES.length; o++) {
          const w = weights[o];
          if (w === 0) continue; // 帶外不擲骰（效能關鍵）
          const spec = ORES[o];
          const h = hash2(
            (wx * 73856093) ^ (y * 19349663) ^ spec.salt,
            (wz * 83492791) ^ ((y + 1) * 2654435761),
            seed,
          );
          if (h / HASH_RANGE < spec.baseChance * w) {
            data[i] = spec.block;
            break; // 先到先得：一格只放一種礦
          }
        }
      }
    }
  }
}
