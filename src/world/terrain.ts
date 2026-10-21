import { Noise, hash2 } from '../core/noise';
import { BLOCK } from './blocks';
import { CHUNK_SIZE, CHUNK_HEIGHT, chunkIndex } from './chunk';
import { SEA_LEVEL, surfaceHeight, temperature, moisture } from './terrain-noise';
import { plantTrees } from './trees';
import { plantDecorations } from './decorations';

// 高度與海平面改由 terrain-noise 提供（多層噪音：海陸／侵蝕／山脊），
// 這裡只做轉出，既有 import 路徑（`./world/terrain`）不變。
export { SEA_LEVEL, surfaceHeight };

/**
 * 八種生物群系（B3 Task 2）。
 *
 * id 直接用英文原始字串，不另建中文對照表：F3 的 `Biome:` 顯示的就是這個 id
 * （`src/ui/hud.ts` 只印 `Biome: ${biome}`，因此不需要動它，既有 UI 測試也不受影響），
 * README 的〈與原版的差異〉再列出 id 對照。
 */
export type Biome =
  | 'ocean'
  | 'plains'
  | 'forest'
  | 'birch_forest'
  | 'taiga'
  | 'snowy_plains'
  | 'desert'
  | 'mountains';

// 判定門檻（計畫〈已查證與設計決策〉§4）：
// 高度門檻**含等號**（h ≤ 63 → 海洋、h ≥ 92 → 高山），氣溫／濕度門檻**嚴格不等於**
// （temp < −0.24 → 雪原、moist > 0.20 → 白樺林……）→ 氣候門檻的等號落點一律往
// 下一級掉（邊界案例見 `terrain.test.ts`）。
const OCEAN_MAX_HEIGHT = SEA_LEVEL + 1; // 63：海平面 62 加一格（沙灘過渡帶）
const MOUNTAIN_MIN_HEIGHT = 92;
const SNOW_TEMP = -0.24;
const TAIGA_TEMP = -0.12;
const TAIGA_MOIST = -0.26;
const DESERT_TEMP = 0.08;
const DESERT_MOIST = -0.08;
const BIRCH_MOIST = 0.2;
const FOREST_MOIST = 0;
/** 高山表層：h ≥ 112 是雪頂、104 ≤ h < 112 是裸岩、92 ≤ h < 104 是草坡。 */
const MOUNTAIN_SNOW_HEIGHT = 112;
const MOUNTAIN_STONE_HEIGHT = 104;

/**
 * 生物群系判定（純函式，順序即優先級）。
 *
 * 為什麼是這個順序：
 * - **高度優先（規則 1／2）**：水裡就是海洋、山頂就是高山。原版用
 *   continentalness／weirdness 等「地形參數」決定水與山，本作把那些參數吃進
 *   高度公式（`terrain-noise.ts`），剩下能拿來分類的只有高度與氣候 → 先用高度
 *   把「水／山」切掉，剩下的同高度帶陸地才交給氣候分級。
 * - **氣候優先於濕度（規則 3／4／5 在 6／7 之前）**：原版是「先看溫度帶、再看
 *   濕度帶」的兩段式（溫度決定寒冷／溫帶／炎熱，濕度再決定森林／平原）。
 *   本作把「寒冷」與「炎熱乾燥」各自變成一個生態（雪原／沙漠），濕度只剩下
 *   白樺林與橡木林兩級。
 *
 * 與原版的差異：原版是 6 參數的參數表分級、同一個溫度帶可以同時存在森林與沙漠
 * （由 continentalness／erosion 再細分）；本作只有 2 個氣候參數 ＋ 高度，所以
 * 判定是「一串門檻」而不是分級表 → 分界線會比原版硬，過渡帶比原版少。
 *
 * 門檻：高度含等號（h ≤ 63 → 海洋、h ≥ 92 → 高山），氣溫／濕度嚴格不等於
 * （temp = −0.24 不算雪原、moist = 0.20 不算白樺林）→ 等號落點往下一級掉
 * （邊界案例見 `terrain.test.ts`）。
 */
export function pickBiome(params: { height: number; temp: number; moist: number }): Biome {
  const { height, temp, moist } = params;
  // 1) 海洋（含 h 62–63 的沙灘過渡帶）
  if (height <= OCEAN_MAX_HEIGHT) return 'ocean';
  // 2) 高山（雪頂／裸岩／草坡由地表高度決定）
  if (height >= MOUNTAIN_MIN_HEIGHT) return 'mountains';
  // 3) 雪原：最冷的一檔（比針葉林更冷）
  if (temp < SNOW_TEMP) return 'snowy_plains';
  // 4) 針葉林：冷，但不是最冷，而且不乾燥到極點（−0.26 是「還是算濕」的下限）
  if (temp < TAIGA_TEMP && moist > TAIGA_MOIST) return 'taiga';
  // 5) 沙漠：要同時又熱又乾
  if (temp > DESERT_TEMP && moist < DESERT_MOIST) return 'desert';
  // 6) 白樺林：最濕的一檔
  if (moist > BIRCH_MOIST) return 'birch_forest';
  // 7) 橡木林：濕潤
  if (moist > FOREST_MOIST) return 'forest';
  // 8) 其餘：平原
  return 'plains';
}

/**
 * 表層方塊表（`Record<Biome, number>` 窮舉 → 新增生態時編譯器會強制補列）。
 *
 * 對應原版的「地表覆蓋層」：海洋與沙漠是沙、雪原是雪、其餘陸地是草。
 *
 * `mountains` 這一列是**山體最低段**（92 ≤ h < 104 的草坡）；高山的另外兩段
 * （104 ≤ h < 112 裸岩、h ≥ 112 雪頂）由 `surfaceBlockOf` 依地表高度覆寫 →
 * 這一列的值不會直接被回傳（見該函式的分層邏輯與 §4 的表）。
 */
const SURFACE_BLOCK: Record<Biome, number> = {
  ocean: BLOCK.SAND,
  plains: BLOCK.GRASS,
  forest: BLOCK.GRASS,
  birch_forest: BLOCK.GRASS,
  taiga: BLOCK.GRASS,
  snowy_plains: BLOCK.SNOW,
  desert: BLOCK.SAND,
  mountains: BLOCK.GRASS, // 山體最低段（草坡）；裸岩與雪頂見 `surfaceBlockOf`
};

/**
 * 表層方塊：回傳 `y === 地表高度` 那一格該放的方塊 id。
 *
 * 高山是唯一依高度分層的生態（§4）：92 ≤ h < 104 草坡、104 ≤ h < 112 裸岩、
 * h ≥ 112 雪頂 → 高山在這裡單獨處理，其餘生態查 `SURFACE_BLOCK`。
 */
export function surfaceBlockOf(biome: Biome, height: number): number {
  if (biome === 'mountains') {
    if (height >= MOUNTAIN_SNOW_HEIGHT) return BLOCK.SNOW;
    if (height >= MOUNTAIN_STONE_HEIGHT) return BLOCK.STONE;
    return BLOCK.GRASS; // 92 ≤ h < 104：草坡
  }
  return SURFACE_BLOCK[biome];
}

/** 表層以下的方塊（`y < 地表高度`）：海洋與沙漠是沙，其餘是土。 */
const SUBSURFACE_BLOCK: Record<Biome, number> = {
  ocean: BLOCK.SAND,
  plains: BLOCK.DIRT,
  forest: BLOCK.DIRT,
  birch_forest: BLOCK.DIRT,
  taiga: BLOCK.DIRT,
  snowy_plains: BLOCK.DIRT,
  desert: BLOCK.SAND,
  mountains: BLOCK.DIRT,
};

/** 表層以下的方塊：回傳 `y < 地表高度` 那些格子的方塊 id。 */
export function subsurfaceBlockOf(biome: Biome): number {
  return SUBSURFACE_BLOCK[biome];
}

/**
 * 一個世界柱的生物群系：地表高度 ＋ 氣候場 → `pickBiome`。
 *
 * 三個取樣點（`biomeAt`／`generateChunk`／`plantTrees`）都走這裡 → 同一個座標
 * 在任何地方都得到同一個生態（地表材質、F3 的 `Biome:` 與霧色才會一致）。
 *
 * `height` 由呼叫端帶入（`surfaceHeight` 有逐欄位快取，重算也不會變慢，但帶入
 * 可讓呼叫端少算一次、也讓「判定用的高度就是生成用的高度」這件事更明顯）。
 */
function biomeOfColumn(x: number, z: number, seed: number, height: number): Biome {
  return pickBiome({
    height,
    temp: temperature(x, z, seed),
    moist: moisture(x, z, seed),
  });
}

/**
 * 某個世界座標的生物群系。
 *
 * 氣候場（`temperature`／`moisture`）與高度一律取自 `terrain-noise.ts`
 * （`CLIM_FREQ = 0.002`／`CLIM_OCTAVES = 3`）→ 與 `generateChunk` 用的是同一組
 * 欄位，地表材質、F3 的 `Biome:` 與霧色才會互相對得上。
 *
 * 記憶化在 `terrain-noise.ts` 裡做（逐欄位快取）→ 這裡可以放心地被主迴圈每
 * 0.5 秒呼叫一次。
 */
export function biomeAt(x: number, z: number, seed: number): Biome {
  return biomeOfColumn(x, z, seed, surfaceHeight(x, z, seed));
}

export function generateChunk(cx: number, cz: number, seed: number): Uint8Array {
  const data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
  const caveN = new Noise(seed ^ 0x51ed270b);

  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;

  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wx = baseX + lx;
      const wz = baseZ + lz;

      const h = surfaceHeight(wx, wz, seed);

      // 生物群系取樣：與 `biomeAt` 同一條路徑（terrain-noise 的氣候場）
      const biome = biomeOfColumn(wx, wz, seed, h);

      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        let id: number = BLOCK.AIR;

        if (y === 0) id = BLOCK.BEDROCK;
        else if (y < h - 4) id = BLOCK.STONE;
        else if (y < h) id = subsurfaceBlockOf(biome);
        else if (y === h) id = surfaceBlockOf(biome, h);
        else if (y <= SEA_LEVEL) {
          id = BLOCK.WATER;
        }

        if (id === BLOCK.STONE && y < h - 6) {
          const ore = hash2(wx * 31 + y, wz * 17 - y, seed);
          if (y < 16 && ore % 400 === 0) id = BLOCK.IRON_ORE;
          else if (ore % 120 === 0) id = BLOCK.COAL_ORE;
        }

        if (y > 3 && y < h - 2 && id !== BLOCK.BEDROCK && id !== BLOCK.WATER) {
          const cave = caveN.noise3(wx * 0.05, y * 0.07, wz * 0.05);
          if (cave > 0.62) id = BLOCK.AIR;
        }

        data[chunkIndex(lx, y, lz)] = id;
      }
    }
  }

  plantTrees(data, cx, cz, seed);
  // B3 Task 6：地表裝飾（花／草叢／仙人掌／冰）。
  // **順序有意義**：樹木先寫（樹幹會占掉地表格），裝飾只寫進空氣格 →
  // 樹下的草不會長在樹幹裡。冰是唯一的例外（它取代水面頂端的水）。
  plantDecorations(data, cx, cz, seed);
  return data;
}

