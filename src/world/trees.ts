/**
 * 樹木生成（B3 Task 3）：三樹種（橡木／雲杉／白樺）、樹形與樹密度。
 *
 * 這個模組是**純模組**：不依賴 DOM／Three.js／`main.ts` 的任何狀態，
 * `plantTrees` 只把方塊寫進傳進來的 `Uint8Array`。
 *
 * 樹種由生物群系決定（`terrain.ts` 的 `biomeAt`），樹距用「同生態內的
 * 優先序局部極小值」實作，樹形與密度是計畫 §5 的表。
 */
import { hash2 } from '../core/noise';
import { BLOCK } from './blocks';
import { CHUNK_SIZE, CHUNK_HEIGHT, chunkIndex } from './chunk';
import { biomeAt, surfaceBlockOf, type Biome } from './terrain';
import { SEA_LEVEL, surfaceHeight } from './terrain-noise';

/** 樹種。`oak` 是既有那種（平原／橡木林），另外兩種是 B3 新增的。 */
export type TreeSpecies = 'oak' | 'spruce' | 'birch';

/**
 * 樹距用的鄰域半徑：半徑 2 的 5×5 鄰域內沒有「同生態候選」的優先序比自己小
 * → 同生態的兩棵樹 Chebyshev 距離 ≥ 3（spec 要求 ≥ 2，本作留一格餘裕）。
 */
export const TREE_PRIORITY_RADIUS = 2;

/**
 * 候選機率 `TREE_P`（每柱）。數值是計畫 §5 的表，**不得**為了讓統計測試
 * 變綠而自行放寬。
 *
 * 實測密度（連續 1024×1024 格、種子 1337、樹棵數 ÷ 該生態柱數 × 256）：
 * plains 0.116／forest 6.96／birch_forest 9.02／taiga 6.41／
 * snowy_plains 0.054／mountains 0.365／desert 0／ocean 0。
 */
export const TREE_CANDIDATE_PROBABILITY: Record<Biome, number> = {
  ocean: 0,
  plains: 0.00045,
  forest: 0.044,
  birch_forest: 0.08,
  taiga: 0.04,
  snowy_plains: 0.0002,
  desert: 0,
  mountains: 0.002,
};

/** 生態 → 樹種（`null` = 不長樹）。窮舉型別 → 新增生態時編譯器會強制補列。 */
const SPECIES_BY_BIOME: Record<Biome, TreeSpecies | null> = {
  ocean: null,
  plains: 'oak',
  forest: 'oak',
  birch_forest: 'birch',
  taiga: 'spruce',
  snowy_plains: 'spruce',
  desert: null,
  mountains: 'spruce',
};

/** 樹種 → 原木／葉子的方塊 id。 */
const LOG_BY_SPECIES: Record<TreeSpecies, number> = {
  oak: BLOCK.LOG,
  spruce: BLOCK.SPRUCE_LOG,
  birch: BLOCK.BIRCH_LOG,
};

const LEAVES_BY_SPECIES: Record<TreeSpecies, number> = {
  oak: BLOCK.LEAVES,
  spruce: BLOCK.SPRUCE_LEAVES,
  birch: BLOCK.BIRCH_LEAVES,
};

/** 優先序雜湊的鹽值（與地形／氣候的鹽值分開 → 樹的位置不跟地形相關）。 */
const PRIORITY_SALT = 0x5f3a7c1d;
/** 樹形變體（樹幹高度）的鹽值 —— 與優先序不同來源 → 兩者不相關。 */
const VARIANT_SALT = 0x1b873593;

/**
 * 這個模組掃描的halo半徑。
 *
 * -2 就夠容納「樹冠半徑 2」的跨塊部分；-4 是因為「優先序局部極小值」要比較
 * 半徑 2 的鄰域 → 一棵樹的存在與否會被它外側 2 格的候選影響，掃描範圍留到
 * ±4 才不會漏掉任何會把樹冠伸進本區塊的樹。
 */
const SCAN_MARGIN = 4;

/** 某個生態長什麼樹（`null` = 這個生態不長樹）。 */
export function treeSpeciesFor(biome: Biome): TreeSpecies | null {
  return SPECIES_BY_BIOME[biome];
}

/**
 * 這根柱子的「優先序」（0..1）：同一個世界座標永遠得到同一個值。
 *
 * 樹距規則用它比較「誰比較有資格長樹」——值越小越優先。
 */
export function treePriority(x: number, z: number, seed: number): number {
  return hash2(x, z, seed ^ PRIORITY_SALT) / 4294967296;
}

/**
 * 這根柱子是不是「候選」：
 * 生態允許樹種 ＋ 地面高度高於海平面一格 ＋ 表層是草或雪 ＋
 * 優先序小於該生態的候選機率。
 *
 * 表層只認草與雪 → 沙（海洋／沙漠）、裸岩（高山 104–111）上不會長樹。
 */
export function treeCandidate(x: number, z: number, seed: number): boolean {
  const biome = biomeAt(x, z, seed);
  if (treeSpeciesFor(biome) === null) return false;
  return isCandidateIn(x, z, seed, biome);
}

/** `treeCandidate` 的內部版本：生物群系已知時不必重算。 */
function isCandidateIn(x: number, z: number, seed: number, biome: Biome): boolean {
  const h = surfaceHeight(x, z, seed);
  if (h <= SEA_LEVEL + 1) return false; // 海洋（含沙灘過渡帶）不長樹
  const surface = surfaceBlockOf(biome, h);
  if (surface !== BLOCK.GRASS && surface !== BLOCK.SNOW) return false;
  return treePriority(x, z, seed) < TREE_CANDIDATE_PROBABILITY[biome];
}

/**
 * 這根柱子上真的有樹嗎？
 *
 * 規則：**同生態內**的優先序局部極小值——半徑 2 的 5×5 鄰域內沒有「同生態
 * 候選」的優先序比自己小時，這根柱子才長樹。
 *
 * 為什麼限定「同生態」：跨生態邊界不強制，否則森林邊緣的平原樹會被鄰居的
 * 森林吃掉 → 密度被系統性壓低，而且森林邊界會出現一圈突兀的空白帶。
 * 這與原版「樹是按區塊的生物群系特徵分別生成」一致。
 */
export function treeExists(x: number, z: number, seed: number): boolean {
  const biome = biomeAt(x, z, seed);
  if (treeSpeciesFor(biome) === null) return false;
  if (!isCandidateIn(x, z, seed, biome)) return false;

  const mine = treePriority(x, z, seed);
  for (let dz = -TREE_PRIORITY_RADIUS; dz <= TREE_PRIORITY_RADIUS; dz++) {
    for (let dx = -TREE_PRIORITY_RADIUS; dx <= TREE_PRIORITY_RADIUS; dx++) {
      if (dx === 0 && dz === 0) continue;
      const nx = x + dx;
      const nz = z + dz;
      // 只跟**同生態**的候選比較（見上方說明）
      if (biomeAt(nx, nz, seed) !== biome) continue;
      if (!isCandidateIn(nx, nz, seed, biome)) continue;
      if (treePriority(nx, nz, seed) < mine) return false;
    }
  }
  return true;
}

/** 樹冠的一層：`dy` 是相對「樹幹頂端」的層數（負數在樹幹頂端之上）。 */
export interface TreeLeafLayer {
  dy: number;
  radius: number;
  /** true = 去掉 `|dx| === radius && |dz| === radius` 的四角（十字形）。 */
  skipCorners: boolean;
}

export interface TreeShape {
  trunkHeight: number;
  leaves: TreeLeafLayer[];
}

/** 各樹種的樹幹高度區間（計畫 §5）。 */
const TRUNK_RANGE: Record<TreeSpecies, readonly [number, number]> = {
  oak: [4, 6],
  birch: [5, 7],
  spruce: [6, 9],
};

/**
 * 各樹種的葉形（計畫 §5）。
 *
 * - **橡木**：葉層 d ∈ [−2, +1]；d ≤ −1 半徑 2、d ≥ 0 半徑 1 且去掉四角
 *   （與舊的橡樹形狀完全一致 → 舊存檔裡種下的橡樹不會突然變形）。
 * - **白樺**：d = 0 半徑 1；d = 1, 2 半徑 2 但去掉四角 → 十字形，視覺較窄。
 * - **雲杉**：d = 0 半徑 0（尖端）；d = 1 半徑 1；d ≥ 2 半徑依 d 的奇偶
 *   （偶數 2、奇數 1）→ 層層收斂的錐形。層數（深度）§5 沒寫死，取 5 層
 *   （d = 0..4），寬窄交替是原版雲杉的經典層次感。
 */
const LEAF_LAYERS: Record<TreeSpecies, readonly TreeLeafLayer[]> = {
  oak: [
    { dy: -2, radius: 2, skipCorners: false },
    { dy: -1, radius: 2, skipCorners: false },
    { dy: 0, radius: 1, skipCorners: true },
    { dy: 1, radius: 1, skipCorners: true },
  ],
  birch: [
    { dy: 0, radius: 1, skipCorners: true },
    { dy: 1, radius: 2, skipCorners: true },
    { dy: 2, radius: 2, skipCorners: true },
  ],
  spruce: [
    { dy: 0, radius: 0, skipCorners: false },
    { dy: 1, radius: 1, skipCorners: false },
    { dy: 2, radius: 2, skipCorners: false },
    { dy: 3, radius: 1, skipCorners: false },
    { dy: 4, radius: 2, skipCorners: false },
  ],
};

/**
 * 某個樹種在某個變體下的樹形。
 *
 * `variant` 是 0..2 的整數 → 樹幹高度在區間內變化、**葉形不變**（變的是
 * 多高，不是長什麼樣）。變體由另一個雜湊決定（`plantTrees` 裡）。
 */
export function treeShape(species: TreeSpecies, variant: number): TreeShape {
  const [min, max] = TRUNK_RANGE[species];
  const v = Number.isFinite(variant) ? Math.min(2, Math.max(0, Math.floor(variant))) : 0;
  return {
    trunkHeight: Math.min(max, min + v),
    leaves: LEAF_LAYERS[species].map((l) => ({ ...l })),
  };
}

/**
 * 把這個區塊的樹寫進 `data`。
 *
 * 寫入範圍是 `tx, tz ∈ [−4, CHUNK_SIZE + 3]` 的halo（含樹冠半徑 2 與優先序
 * 鄰域 ±2 的影響範圍），但**只寫本區塊內的格子**：
 * - 樹幹只有一格寬 → 只會被「擁有那一格」的區塊寫入；
 * - 樹冠跨邊界時，**每一塊各寫自己那一側** → 兩邊合計剛好覆蓋整個樹冠，
 *   而且同一格只會被寫一次（各塊的寫入範圍不重疊）。
 *
 * 只寫進空氣格（不覆蓋地形／水面），所以山坡上的樹冠會被地形擋住。
 */
export function plantTrees(data: Uint8Array, cx: number, cz: number, seed: number): void {
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;

  const put = (x: number, y: number, z: number, id: number): void => {
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) return;
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    const i = chunkIndex(x, y, z);
    if (data[i] === BLOCK.AIR) data[i] = id;
  };

  for (let tz = -SCAN_MARGIN; tz < CHUNK_SIZE + SCAN_MARGIN; tz++) {
    for (let tx = -SCAN_MARGIN; tx < CHUNK_SIZE + SCAN_MARGIN; tx++) {
      const wx = baseX + tx;
      const wz = baseZ + tz;
      if (!treeExists(wx, wz, seed)) continue;

      const species = treeSpeciesFor(biomeAt(wx, wz, seed));
      if (species === null) continue; // 理論上不會發生（treeExists 已排除）
      const variant = hash2(wx, wz, seed ^ VARIANT_SALT) % 3;
      const shape = treeShape(species, variant);
      const ground = surfaceHeight(wx, wz, seed);
      const logId = LOG_BY_SPECIES[species];
      const leavesId = LEAVES_BY_SPECIES[species];

      // 樹幹：ground + 1 .. ground + 樹幹高度
      for (let t = 1; t <= shape.trunkHeight; t++) put(tx, ground + t, tz, logId);

      // 樹冠：相對樹幹頂端（ground + 樹幹高度）的每一層
      const top = ground + shape.trunkHeight;
      for (const layer of shape.leaves) {
        const y = top + layer.dy;
        const r = layer.radius;
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            if (layer.skipCorners && Math.abs(dx) === r && Math.abs(dz) === r) continue;
            put(tx + dx, y, tz + dz, leavesId);
          }
        }
      }
    }
  }
}
