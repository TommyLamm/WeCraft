/**
 * 地形噪音（B3 Task 1）：多層噪音 + 新高度公式。
 *
 * 對應原版（minecraft.wiki/World generation#Biomes，2026-10-20）的哪幾個參數：
 * - `continentalness`（原版 continents）→ 決定海陸分布，本模組用 `CONT_FREQ`
 *   的 3 層 fbm 產生，經**分段線性 spline** 映射成「離海平面的高度差」。
 * - `erosion` → 侵蝕程度，數值越高地形越平坦（`relief` 越小）。
 * - `peaksAndValleys`（原版 weirdness / ridges）→ 用原版公式
 *   `1 − |3·|w| − 2|` 把單層 noise2 折成「峰／谷」分佈。
 * - `temperature` / `moisture`（原版 temperature / humidity）→ 氣候場，
 *   鹽值沿用舊的 biome 噪音（`seed ^ 0x9e3779b9`），只有頻率與層數改變。
 *
 * 為什麼用 spline 而不是線性比例：原版的高度曲線是「分級」的——海面附近幾乎
 * 平坦（海岸／近內陸），越往大陸內部才逐級抬升。若直接把 continentalness
 * 線性映射到高度，大陸邊界會變成一堵直上直下的牆。分段線性 spline 用固定
 * 節點把這種「階梯感」寫死，同時保持連續（節點外夾端點值）。
 *
 * 為什麼世界高度維持 0–255（`CHUNK_HEIGHT = 256`）不擴張：本公式的實測最高
 * 點是 126、最低 35（種子 1337，跨距取樣 8192×8192 格），離 0 與 255 都還
 * 很遠 → 沒有擴張高度的理由，擴張只會讓區塊記憶體與網路負載無謂翻倍。
 *
 * 這個模組是純函式模組：不依賴 DOM／Three.js／`main.ts` 的任何狀態，
 * 只吃 `src/core/noise.ts` 的 `Noise`。
 */
import { Noise } from '../core/noise';
import { CHUNK_HEIGHT } from './chunk';

/** 海平面（原版 Y=62：空氣在 Y=62 以下會被水取代）。既有 import 路徑不變。 */
export const SEA_LEVEL = 62;

/** 基準抬升：高度公式的起點是「海平面 + 2 格」——基準面在海平面之上 2 格，
 *  讓近內陸（continentalness ≈ 0）的陸地高出水面幾格、不會整片貼著水線。 */
export const BASE_LIFT = 2;

/** continentalness（大陸度）取樣頻率／層數。 */
export const CONT_FREQ = 0.001;
export const CONT_OCTAVES = 3;
/** erosion（侵蝕）取樣頻率／層數。 */
export const ERO_FREQ = 0.0022;
export const ERO_OCTAVES = 3;
/** ridges（weirdness／PV）取樣頻率（單層 noise2，不做 fbm）。 */
export const RIDGE_FREQ = 0.0045;
/** temperature／humidity（氣候）取樣頻率／層數。 */
export const CLIM_FREQ = 0.002;
export const CLIM_OCTAVES = 3;

/** 岸線的大陸度門檻：低於此值算海。 */
export const CONT_SHORE = -0.107;
/** relief 曲線：`relief = clamp01((ERO_FLAT − ero) / ERO_SPAN)`，侵蝕越高越平。 */
export const ERO_FLAT = 0.15;
export const ERO_SPAN = 0.30;
/** 岸線以上的「陸地」過渡帶寬度（continentalness 單位）。 */
export const LAND_SPAN = 0.10;

/** 起伏的基礎高度與山峰高度（格）。 */
export const RELIEF_BASE = 8;
export const RELIEF_PEAK = 40;

/** 各地形場的鹽值（固定寫死）：氣候沿用舊 biome 噪音的鹽值。 */
const CONT_SALT = 0x2545f491;
const ERO_SALT = 0x7feb352d;
const RIDGE_SALT = 0x846ca68b;
const CLIM_SALT = 0x9e3779b9;

/** 取樣偏移（固定）：避免不同場的特徵互相對齊。 */
const ERO_OFFSET = 37.13;
const RIDGE_OFFSET = 91.31;
/** 濕度場的偏移（沿用舊實作 `x * 0.004 + 50` 的做法）。 */
const MOIST_OFFSET = 50;

/** continentalness → 離海平面的高度差（格）的分段線性 spline 節點。 */
const SPLINE_NODES: ReadonlyArray<readonly [number, number]> = [
  [-0.66, -34],
  [-0.45, -26],
  [-0.28, -17],
  [-0.107, -2],
  [0, 3],
  [0.12, 7],
  [0.28, 11],
  [0.45, 15],
];

/** 一個世界種子對應的四個噪音場。 */
export interface TerrainNoises {
  cont: Noise;
  ero: Noise;
  ridge: Noise;
  clim: Noise;
}

const noiseSets = new Map<number, TerrainNoises>();

/** 依 seed 記憶化的噪音組：同一個 seed 必得同一組 `Noise` 實例
 * （`Noise` 的建構式會洗牌 256 項排列表，之後就不能再重建）。 */
export function terrainNoises(seed: number): TerrainNoises {
  let set = noiseSets.get(seed);
  if (!set) {
    set = {
      cont: new Noise(seed ^ CONT_SALT),
      ero: new Noise(seed ^ ERO_SALT),
      ridge: new Noise(seed ^ RIDGE_SALT),
      clim: new Noise(seed ^ CLIM_SALT),
    };
    noiseSets.set(seed, set);
  }
  return set;
}

/**
 * 逐欄位結果的記憶化：seed → x → z → 結果。
 *
 * 這是效能必做項，不是選配：`generateChunk` 每個區塊要對 16×16 = 256 個柱
 * 各算一次高度與氣候，而樹木 halo、裝飾放置還會對鄰居柱重算 → 沒有這層
 * 快取就是每塊數千次欄位計算，8 ms/區塊的預算會直接爆掉。
 */
class ColumnCache {
  /**
   * 每個「欄位層 × seed」的欄位數上限。
   *
   * 上限與淘汰策略（實測：30 萬個不重複欄位跑完後 heapUsed 成長約 62 MB，
   * 之後維持平不再上升）：
   * - 上限：250,000 欄／層／seed。本模組共 6 層（cont／ero／pv／height／temp／
   *   moist），每個 seed 的合計上限約 150 萬欄（約 60 MB）。
   * - 淘汰：**整層清空**（該 seed 該欄位層的所有欄位一次清掉），不是 LRU。
   *   觸發時機是「寫入第 250,001 欄的那一刻」→ **先前已快取的那些欄位全部被丟棄**
   *   （當次寫入的這個欄位會被保留）；被丟棄的欄位要等之後再次取用時才會重新計算。
   * - 清空只影響效能、不影響結果（同一座標重算的值完全相同，見
   *   `terrain-noise.test.ts` 的確定性斷言）。
   * - 界限只對**單一 seed** 成立：`layers` 的 **seed 條目本身永不淘汰** → 換過的
   *   seed 會各自留下一層空殼（每個 seed 最多 6 層空 Map）。實際使用中一個
   *   session 只用一個 seed，故無實質影響；若要處理多 seed 場景，得另外加 seed
   *   層的淘汰策略（本任務未實作，見報告疑慮）。
   */
  private static readonly CAP = 250_000;

  private readonly layers = new Map<number, { columns: Map<number, Map<number, number>>; count: number }>();

  get(seed: number, x: number, z: number): number | undefined {
    return this.layers.get(seed)?.columns.get(x)?.get(z);
  }

  set(seed: number, x: number, z: number, value: number): void {
    let layer = this.layers.get(seed);
    if (!layer) {
      layer = { columns: new Map(), count: 0 };
      this.layers.set(seed, layer);
    }
    let column = layer.columns.get(x);
    if (!column) {
      column = new Map();
      layer.columns.set(x, column);
    }
    if (!column.has(z)) {
      layer.count++;
      if (layer.count > ColumnCache.CAP) {
        layer.columns.clear();
        layer.count = 0;
        column = new Map();
        layer.columns.set(x, column);
      }
    }
    column.set(z, value);
  }
}

const contCache = new ColumnCache();
const eroCache = new ColumnCache();
const pvCache = new ColumnCache();
const heightCache = new ColumnCache();
const tempCache = new ColumnCache();
const moistCache = new ColumnCache();

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** continentalness → 高度差的分段線性內插（節點外夾端點值）。 */
function splineDelta(cont: number): number {
  const first = SPLINE_NODES[0];
  const last = SPLINE_NODES[SPLINE_NODES.length - 1];
  if (cont <= first[0]) return first[1];
  if (cont >= last[0]) return last[1];
  for (let i = 0; i < SPLINE_NODES.length - 1; i++) {
    const [x0, y0] = SPLINE_NODES[i];
    const [x1, y1] = SPLINE_NODES[i + 1];
    if (cont >= x0 && cont <= x1) return y0 + ((y1 - y0) * (cont - x0)) / (x1 - x0);
  }
  return last[1];
}

/** 大陸度：原版 continents 參數（低 = 海、高 = 大陸內部）。 */
export function continentalness(x: number, z: number, seed: number): number {
  const hit = contCache.get(seed, x, z);
  if (hit !== undefined) return hit;
  const value = terrainNoises(seed).cont.fbm2(x * CONT_FREQ, z * CONT_FREQ, CONT_OCTAVES);
  contCache.set(seed, x, z, value);
  return value;
}

/** 侵蝕：原版 erosion 參數（高 = 地形平坦）。 */
export function erosion(x: number, z: number, seed: number): number {
  const hit = eroCache.get(seed, x, z);
  if (hit !== undefined) return hit;
  const value = terrainNoises(seed).ero.fbm2(
    x * ERO_FREQ + ERO_OFFSET,
    z * ERO_FREQ + ERO_OFFSET,
    ERO_OCTAVES,
  );
  eroCache.set(seed, x, z, value);
  return value;
}

/** 峰谷（PV）：原版 weirdness／ridges 參數，用原版公式 `1 − |3·|w| − 2|`。 */
export function peaksAndValleys(x: number, z: number, seed: number): number {
  const hit = pvCache.get(seed, x, z);
  if (hit !== undefined) return hit;
  const w = terrainNoises(seed).ridge.noise2(
    x * RIDGE_FREQ + RIDGE_OFFSET,
    z * RIDGE_FREQ + RIDGE_OFFSET,
  );
  const value = 1 - Math.abs(3 * Math.abs(w) - 2);
  pvCache.set(seed, x, z, value);
  return value;
}

/**
 * 表面高度（格）。
 *
 * ```
 * cont  = contNoise.fbm2(x * 0.0010, z * 0.0010, 3)
 * ero   = eroNoise.fbm2(x * 0.0022 + 37.13, z * 0.0022 + 37.13, 3)
 * w     = ridgeNoise.noise2(x * 0.0045 + 91.31, z * 0.0045 + 91.31)
 * pv    = 1 − |3·|w| − 2|
 * relief = clamp01((0.15 − ero) / 0.30)      // 0 = 平坦、1 = 崎嶇
 * peak   = clamp01(pv)
 * land   = clamp01((cont − (−0.107)) / 0.10)  // 岸線以上才加起伏
 * h      = 62 + 2 + splineDelta(cont) + land · relief · (8 + 40 · peak)
 * h      = clamp(floor(h), 4, 246)
 * ```
 *
 * （`62 + 2` 的 `2` 是具名的 `BASE_LIFT`＝基準面在海平面之上 2 格。）
 */
export function surfaceHeight(x: number, z: number, seed: number): number {
  const hit = heightCache.get(seed, x, z);
  if (hit !== undefined) return hit;
  const cont = continentalness(x, z, seed);
  const ero = erosion(x, z, seed);
  const pv = peaksAndValleys(x, z, seed);
  const relief = clamp01((ERO_FLAT - ero) / ERO_SPAN);
  const peak = clamp01(pv);
  const land = clamp01((cont - CONT_SHORE) / LAND_SPAN);
  const h = SEA_LEVEL + BASE_LIFT + splineDelta(cont) + land * relief * (RELIEF_BASE + RELIEF_PEAK * peak);
  const value = Math.max(4, Math.min(CHUNK_HEIGHT - 10, Math.floor(h)));
  heightCache.set(seed, x, z, value);
  return value;
}

/** 氣候：溫度（原版 temperature）。 */
export function temperature(x: number, z: number, seed: number): number {
  const hit = tempCache.get(seed, x, z);
  if (hit !== undefined) return hit;
  const value = terrainNoises(seed).clim.fbm2(x * CLIM_FREQ, z * CLIM_FREQ, CLIM_OCTAVES);
  tempCache.set(seed, x, z, value);
  return value;
}

/** 氣候：濕度（原版 humidity／vegetation）。 */
export function moisture(x: number, z: number, seed: number): number {
  const hit = moistCache.get(seed, x, z);
  if (hit !== undefined) return hit;
  const value = terrainNoises(seed).clim.fbm2(
    x * CLIM_FREQ + MOIST_OFFSET,
    z * CLIM_FREQ + MOIST_OFFSET,
    CLIM_OCTAVES,
  );
  moistCache.set(seed, x, z, value);
  return value;
}
