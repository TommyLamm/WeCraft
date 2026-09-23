import { Noise, hash2 } from '../core/noise';
import { BLOCK } from './blocks';
import { CHUNK_SIZE, CHUNK_HEIGHT, chunkIndex } from './chunk';

export const SEA_LEVEL = 62;

type Biome = 'plains' | 'desert' | 'forest' | 'snow';

function pickBiome(temp: number, moist: number): Biome {
  if (temp > 0.35 && moist < -0.1) return 'desert';
  if (temp < -0.35) return 'snow';
  if (moist > 0.15) return 'forest';
  return 'plains';
}

const noiseCache = new Map<number, Noise>();

function heightNoise(seed: number): Noise {
  let n = noiseCache.get(seed);
  if (!n) {
    n = new Noise(seed);
    noiseCache.set(seed, n);
  }
  return n;
}

export function surfaceHeight(x: number, z: number, seed: number): number {
  const heightN = heightNoise(seed);
  const cont = heightN.fbm2(x * 0.0035, z * 0.0035, 4);
  const ridgeRaw = heightN.noise2(x * 0.008 + 100, z * 0.008 + 100);
  const ridge = 1 - Math.abs(ridgeRaw);
  const h = 66 + cont * 28 + ridge * ridge * 22;
  return Math.max(4, Math.min(CHUNK_HEIGHT - 10, Math.floor(h)));
}

export function generateChunk(cx: number, cz: number, seed: number): Uint8Array {
  const data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
  const biomeN = new Noise(seed ^ 0x9e3779b9);
  const caveN = new Noise(seed ^ 0x51ed270b);

  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;

  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wx = baseX + lx;
      const wz = baseZ + lz;

      const h = surfaceHeight(wx, wz, seed);

      const temp = biomeN.fbm2(wx * 0.004, wz * 0.004, 2);
      const moist = biomeN.fbm2(wx * 0.004 + 50, wz * 0.004 + 50, 2);
      const biome = pickBiome(temp, moist);

      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        let id: number = BLOCK.AIR;

        if (y === 0) id = BLOCK.BEDROCK;
        else if (y < h - 4) id = BLOCK.STONE;
        else if (y < h) id = biome === 'desert' ? BLOCK.SAND : BLOCK.DIRT;
        else if (y === h) {
          if (biome === 'desert') id = BLOCK.SAND;
          else if (biome === 'snow') id = BLOCK.SNOW;
          else id = BLOCK.GRASS;
        } else if (y <= SEA_LEVEL) {
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

  plantTrees(data, cx, cz, seed, biomeN);
  return data;
}

function plantTrees(
  data: Uint8Array,
  cx: number,
  cz: number,
  seed: number,
  biomeN: Noise,
): void {
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;

  // Halo of 2 covers the radius-2 canopy of bases just outside the chunk,
  // so canopies are written by the chunk that owns each cell (deterministic).
  for (let tz = -2; tz < CHUNK_SIZE + 2; tz++) {
    for (let tx = -2; tx < CHUNK_SIZE + 2; tx++) {
      const wx = baseX + tx;
      const wz = baseZ + tz;
      const h = hash2(wx, wz, seed ^ 0xabc123);
      if (h % 100 >= 6) continue;

      const temp = biomeN.fbm2(wx * 0.004, wz * 0.004, 2);
      const moist = biomeN.fbm2(wx * 0.004 + 50, wz * 0.004 + 50, 2);
      if (pickBiome(temp, moist) === 'desert') continue;

      const ground = surfaceHeight(wx, wz, seed);
      if (ground <= SEA_LEVEL + 1) continue;

      const trunkH = 4 + (h % 3);
      const put = (x: number, y: number, z: number, id: number) => {
        if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) return;
        if (y < 0 || y >= CHUNK_HEIGHT) return;
        const i = chunkIndex(x, y, z);
        if (data[i] === BLOCK.AIR) data[i] = id;
      };

      for (let t = 1; t <= trunkH; t++) put(tx, ground + t, tz, BLOCK.LOG);

      const top = ground + trunkH;
      for (let dy = -2; dy <= 1; dy++) {
        const r = dy <= -1 ? 2 : 1;
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            if (Math.abs(dx) === r && Math.abs(dz) === r && dy >= 0) continue;
            put(tx + dx, top + dy, tz + dz, BLOCK.LEAVES);
          }
        }
      }
    }
  }
}
