import { describe, it, expect } from 'vitest';
import {
  TREE_CANDIDATE_PROBABILITY,
  TREE_PRIORITY_RADIUS,
  treeCandidate,
  treeExists,
  treePriority,
  treeShape,
  treeSpeciesFor,
  type TreeSpecies,
} from './trees';
import { biomeAt, generateChunk, surfaceBlockOf, SEA_LEVEL, type Biome } from './terrain';
import { surfaceHeight } from './terrain-noise';
import { BLOCK } from './blocks';
import { CHUNK_SIZE, CHUNK_HEIGHT, chunkIndex } from './chunk';

/** 統計用的固定種子（與計畫 §5 的實測值同一區域）。 */
const SEED = 1337;

/** 樹距不變量的掃描範圍（世界座標 64×64）。 */
const SCAN_SIZE = 64;

/**
 * 跨塊樹冠的邊界帶（種子 1337）：
 * 邊界在 world x = 400（chunk 24 ＝ x 384–399、chunk 25 ＝ x 400–415）。
 * 該帶上有 3 棵橡木：(400,5)、(401,8)、(400,12)。
 */
const CANOPY_CHUNKS: readonly [number, number][] = [
  [24, 0],
  [25, 0],
];
const CANOPY_TREES: ReadonlyArray<readonly [number, number]> = [
  [400, 5],
  [401, 8],
  [400, 12],
];

/** 樹幹的原木 id → 該樹種的葉子 id（判斷樹種用，不假設只有橡木）。 */
const LEAVES_BY_LOG: Record<number, number> = {
  [BLOCK.LOG]: BLOCK.LEAVES,
  [BLOCK.SPRUCE_LOG]: BLOCK.SPRUCE_LEAVES,
  [BLOCK.BIRCH_LOG]: BLOCK.BIRCH_LEAVES,
};

const SPECIES_BY_LOG: Record<number, TreeSpecies> = {
  [BLOCK.LOG]: 'oak',
  [BLOCK.SPRUCE_LOG]: 'spruce',
  [BLOCK.BIRCH_LOG]: 'birch',
};

interface TreeColumn {
  x: number;
  z: number;
  biome: Biome;
}

/** 掃描範圍內所有「真的長出樹」的柱子。 */
function treesInRegion(x0: number, z0: number, size: number, seed: number): TreeColumn[] {
  const out: TreeColumn[] = [];
  for (let z = z0; z < z0 + size; z++) {
    for (let x = x0; x < x0 + size; x++) {
      if (treeExists(x, z, seed)) out.push({ x, z, biome: biomeAt(x, z, seed) });
    }
  }
  return out;
}

describe('tree shapes', () => {
  it('every tree species has a distinct shape', () => {
    const oak = treeShape('oak', 0);
    const birch = treeShape('birch', 0);
    const spruce = treeShape('spruce', 0);

    // 樹幹高度區間（計畫 §5）
    expect(oak.trunkHeight).toBeGreaterThanOrEqual(4);
    expect(oak.trunkHeight).toBeLessThanOrEqual(6);
    expect(birch.trunkHeight).toBeGreaterThanOrEqual(5);
    expect(birch.trunkHeight).toBeLessThanOrEqual(7);
    expect(spruce.trunkHeight).toBeGreaterThanOrEqual(6);
    expect(spruce.trunkHeight).toBeLessThanOrEqual(9);

    // 葉子半徑：橡木／白樺／雲杉的最大半徑都是 2
    expect(Math.max(...oak.leaves.map((l) => l.radius))).toBe(2);
    expect(Math.max(...birch.leaves.map((l) => l.radius))).toBe(2);
    expect(Math.max(...spruce.leaves.map((l) => l.radius))).toBe(2);

    // 白樺的寬層去掉四角（十字形）
    expect(birch.leaves.some((l) => l.skipCorners)).toBe(true);
    expect(birch.leaves.filter((l) => l.radius === 2).every((l) => l.skipCorners)).toBe(true);

    // 雲杉頂端半徑 0（錐形的尖端）
    expect(spruce.leaves[0].radius).toBe(0);
    // 雲杉往下是層層收斂的錐形：尖端以下不得再回到半徑 0
    expect(spruce.leaves.slice(1).every((l) => l.radius >= 1)).toBe(true);

    // 三種樹的葉形互不相同
    const shapes = [oak, birch, spruce].map((s) => JSON.stringify(s.leaves));
    expect(new Set(shapes).size).toBe(3);
  });

  it('the trunk height varies with the variant but the leaf shape does not', () => {
    const ranges: ReadonlyArray<readonly [TreeSpecies, number, number]> = [
      ['oak', 4, 6],
      ['birch', 5, 7],
      ['spruce', 6, 9],
    ];
    for (const [species, min, max] of ranges) {
      const heights = new Set<number>();
      for (let variant = 0; variant < 3; variant++) {
        const shape = treeShape(species, variant);
        expect(shape.trunkHeight, `${species} variant ${variant}`).toBeGreaterThanOrEqual(min);
        expect(shape.trunkHeight, `${species} variant ${variant}`).toBeLessThanOrEqual(max);
        heights.add(shape.trunkHeight);
      }
      // 變體真的會改變樹幹高度（否則「隨機變化」是假的）
      expect(heights.size, `${species} variants`).toBeGreaterThan(1);
      // 葉形不隨變體改變
      expect(treeShape(species, 2).leaves).toEqual(treeShape(species, 0).leaves);
    }
  });
});

describe('tree species', () => {
  it('the species matches the biome', () => {
    expect(treeSpeciesFor('forest')).toBe('oak');
    expect(treeSpeciesFor('plains')).toBe('oak');
    expect(treeSpeciesFor('birch_forest')).toBe('birch');
    expect(treeSpeciesFor('taiga')).toBe('spruce');
    expect(treeSpeciesFor('snowy_plains')).toBe('spruce');
    expect(treeSpeciesFor('mountains')).toBe('spruce');
    expect(treeSpeciesFor('desert')).toBeNull();
    expect(treeSpeciesFor('ocean')).toBeNull();
  });

  it('the candidate probability table covers every biome', () => {
    const biomes: Biome[] = [
      'ocean',
      'plains',
      'forest',
      'birch_forest',
      'taiga',
      'snowy_plains',
      'desert',
      'mountains',
    ];
    for (const biome of biomes) {
      const p = TREE_CANDIDATE_PROBABILITY[biome];
      expect(Number.isFinite(p), biome).toBe(true);
      expect(p, biome).toBeGreaterThanOrEqual(0);
      expect(p, biome).toBeLessThanOrEqual(1);
    }
    // 沙漠與海洋不長樹
    expect(TREE_CANDIDATE_PROBABILITY.desert).toBe(0);
    expect(TREE_CANDIDATE_PROBABILITY.ocean).toBe(0);
    // 樹距用的鄰域半徑是 2（5×5 鄰域 → 同生態的兩棵樹 Chebyshev 距離 ≥ 3）
    expect(TREE_PRIORITY_RADIUS).toBe(2);
  });

  it('the priority is a stable 0..1 hash of the column', () => {
    for (const [x, z] of [
      [0, 0],
      [17, -33],
      [400, 5],
    ] as const) {
      const p = treePriority(x, z, SEED);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
      expect(treePriority(x, z, SEED)).toBe(p); // 確定性
    }
    // 不同種子 → 不同優先序（否則換種子長出同樣的森林）
    expect(treePriority(10, 10, 1)).not.toBe(treePriority(10, 10, 2));
  });
});

describe('tree placement invariants', () => {
  it('trees never grow on sand, stone or water', () => {
    const trees = treesInRegion(0, 0, SCAN_SIZE, SEED);
    // 掃描範圍內必須真的有樹，否則這個案例等於沒有驗證到東西
    expect(trees.length).toBeGreaterThan(0);
    for (const t of trees) {
      const h = surfaceHeight(t.x, t.z, SEED);
      const biome = biomeAt(t.x, t.z, SEED);
      expect(
        [BLOCK.GRASS, BLOCK.SNOW],
        `tree at ${t.x},${t.z} grows on ${surfaceBlockOf(biome, h)}`,
      ).toContain(surfaceBlockOf(biome, h));
      expect(h, `tree at ${t.x},${t.z} is at sea level`).toBeGreaterThan(SEA_LEVEL + 1);
    }
  });

  it('a tree only grows where the column is a candidate', () => {
    for (const [x, z] of [
      [0, 0],
      [100, 100],
      [400, 5],
    ] as const) {
      if (treeExists(x, z, SEED)) expect(treeCandidate(x, z, SEED)).toBe(true);
    }
  });

  it('same-biome trees are at least 3 blocks apart', () => {
    const trees = treesInRegion(0, 0, SCAN_SIZE, SEED);
    expect(trees.length).toBeGreaterThan(1);
    let sameBiomePairs = 0;
    for (let i = 0; i < trees.length; i++) {
      for (let j = i + 1; j < trees.length; j++) {
        // 樹距規則只約束「同生態」：跨生態邊界不強制（否則森林邊緣的平原樹
        // 會被鄰居森林吃掉，密度會被系統性壓低）
        if (trees[i].biome !== trees[j].biome) continue;
        sameBiomePairs++;
        const chebyshev = Math.max(
          Math.abs(trees[i].x - trees[j].x),
          Math.abs(trees[i].z - trees[j].z),
        );
        expect(chebyshev, `trees at ${trees[i].x},${trees[i].z} and ${trees[j].x},${trees[j].z}`).toBeGreaterThanOrEqual(3);
      }
    }
    // 守衛：至少要有一對同生態的樹被比較過，否則這個案例是空轉
    expect(sameBiomePairs).toBeGreaterThan(0);
  });

  it('a tree canopy is not clipped at a chunk border', () => {
    const chunks = new Map<number, Uint8Array>();
    for (const [cx, cz] of CANOPY_CHUNKS) chunks.set(cx, generateChunk(cx, cz, SEED));
    const left = chunks.get(24)!;
    const right = chunks.get(25)!;

    for (const [wx, wz] of CANOPY_TREES) {
      // 樹幹：出現在兩塊的其中一側（樹幹只有一格寬 → 只可能在其中一塊）
      let top = -1;
      let logId = -1;
      for (const [data, baseX] of [
        [left, 24 * CHUNK_SIZE],
        [right, 25 * CHUNK_SIZE],
      ] as const) {
        const lx = wx - baseX;
        if (lx < 0 || lx >= CHUNK_SIZE) continue;
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          const id = data[chunkIndex(lx, y, wz)];
          if (LEAVES_BY_LOG[id] === undefined) continue;
          if (y > top) {
            top = y;
            logId = id;
          }
        }
      }
      expect(top, `tree at ${wx},${wz} has a trunk`).toBeGreaterThan(0);
      const leavesId = LEAVES_BY_LOG[logId];
      const shape = treeShape(SPECIES_BY_LOG[logId], 0);
      const dyMin = Math.min(...shape.leaves.map((l) => l.dy));
      const dyMax = Math.max(...shape.leaves.map((l) => l.dy));

      // 樹冠：兩塊都要有葉子（沒有被切斷），且同一格只出現在其中一塊
      const claimed = new Map<string, number>();
      let leftLeaves = 0;
      let rightLeaves = 0;
      for (const [data, baseX] of [
        [left, 24 * CHUNK_SIZE],
        [right, 25 * CHUNK_SIZE],
      ] as const) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const x = baseX + lx;
          if (x < wx - 2 || x > wx + 2) continue;
          for (let lz = 0; lz < CHUNK_SIZE; lz++) {
            const z = lz;
            if (z < wz - 2 || z > wz + 2) continue;
            for (let y = top + dyMin; y <= top + dyMax; y++) {
              if (data[chunkIndex(lx, y, lz)] !== leavesId) continue;
              const key = `${x},${y},${z}`;
              claimed.set(key, (claimed.get(key) ?? 0) + 1);
              if (x < 25 * CHUNK_SIZE) leftLeaves++;
              else rightLeaves++;
            }
          }
        }
      }
      expect(leftLeaves, `tree ${wx},${wz} leaves in chunk 24`).toBeGreaterThan(0);
      expect(rightLeaves, `tree ${wx},${wz} leaves in chunk 25`).toBeGreaterThan(0);
      for (const [key, count] of claimed) {
        expect(count, `leaf ${key} written by more than one chunk`).toBe(1);
      }
      expect(claimed.size, `tree ${wx},${wz} canopy`).toBeGreaterThan(0);
    }
  });
});
