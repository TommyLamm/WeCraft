import * as THREE from 'three';
import { TILE_COUNT } from '../world/blocks';

export const ATLAS_SIZE = 512;
export const TILE_PX = 16;
export const TILES_PER_ROW = ATLAS_SIZE / TILE_PX; // 32

/** Layers in the block texture array (one 16×16 slice per atlas tile). */
export const ARRAY_LAYERS = 64;

export function tileIndexAt(tx: number, ty: number): number {
  return ty * TILES_PER_ROW + tx;
}

export interface AtlasImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

type RGBA = [number, number, number, number];

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

const vary = (base: RGBA, rnd: () => number, amount: number): RGBA => {
  const d = (rnd() - 0.5) * amount;
  return [clamp255(base[0] + d), clamp255(base[1] + d), clamp255(base[2] + d), base[3]];
};

function fillTile(
  px: Uint8ClampedArray,
  tile: number,
  fn: (x: number, y: number, rnd: () => number) => RGBA,
): void {
  const tx = tile % TILES_PER_ROW;
  const ty = Math.floor(tile / TILES_PER_ROW);
  const rnd = mulberry(tile * 7919 + 17);
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const [r, g, b, a] = fn(x, y, rnd);
      const i = ((ty * TILE_PX + y) * ATLAS_SIZE + tx * TILE_PX + x) * 4;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = a;
    }
  }
}

let cachedAtlas: AtlasImage | null = null;

// ---- B5 Task 1：礫石／金礦／鑽石礦的圖樣輔助 ----
// 位置與深淺都用固定資料（不是逐像素亂數）→ 貼圖決定性，且「20 顆碎石點」
// 與「5–7 個礦斑」是**數得出來**的，測試能直接釘住。

/** 礫石的 20 顆碎石點（位置用固定亂數種子產生，深淺交替）。 */
const GRAVEL_SPECKS: ReadonlyArray<{ x: number; y: number; d: number }> = (() => {
  const rnd = mulberry(34 * 7919 + 17); // 與 fillTile 同一套 PRNG，種子固定
  const specks: Array<{ x: number; y: number; d: number }> = [];
  while (specks.length < 20) {
    const x = Math.floor(rnd() * TILE_PX);
    const y = Math.floor(rnd() * TILE_PX);
    if (specks.some((s) => s.x === x && s.y === y)) continue; // 不重疊
    specks.push({ x, y, d: specks.length % 2 === 0 ? -36 : 34 });
  }
  return specks;
})();

/** 金／鑽石礦的 6 個斑塊中心（原版的 5–7 個；每個斑塊畫成 5 px 的十字）。 */
const ORE_BLOB_CENTERS: ReadonlyArray<readonly [number, number]> = [
  [3, 2], [9, 3], [13, 6], [4, 10], [8, 12], [12, 13],
];

const inOreBlob = (x: number, y: number): boolean =>
  ORE_BLOB_CENTERS.some(([cx, cy]) => {
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= 2;
  });

export function drawAtlas(): AtlasImage {
  if (cachedAtlas) return cachedAtlas;
  const data = new Uint8ClampedArray(ATLAS_SIZE * ATLAS_SIZE * 4);
  const put = (tile: number, fn: (x: number, y: number, rnd: () => number) => RGBA) =>
    fillTile(data, tile, fn);

  put(0, (_x, _y, r) => vary([106, 170, 64, 255], r, 26)); // grass_top
  // green strip at image-top; with CanvasTexture flipY + bakeAtlasUvs this is block-face TOP — do not move
  put(1, (x, y, r) =>
    y < 3 + (x % 3 === 0 ? 1 : 0)
      ? vary([106, 170, 64, 255], r, 26)
      : vary([134, 96, 67, 255], r, 24),
  ); // grass_side
  put(2, (_x, _y, r) => vary([134, 96, 67, 255], r, 28)); // dirt
  put(3, (x, y, r) => {
    const v = (x * 3 + y * 7) % 5 === 0 ? -22 : 0;
    const c = vary([125, 125, 125, 255], r, 20);
    return [clamp255(c[0] + v), clamp255(c[1] + v), clamp255(c[2] + v), 255];
  }); // stone
  put(4, (_x, _y, r) => vary([219, 207, 163, 255], r, 20)); // sand
  put(5, (x, _y, r) => {
    const stripe = x % 4 === 0 ? -30 : 0;
    const c = vary([102, 81, 50, 255], r, 16);
    return [clamp255(c[0] + stripe), clamp255(c[1] + stripe), clamp255(c[2] + stripe), 255];
  }); // log_side
  put(6, (x, y, r) => {
    const dx = x - 7.5;
    const dy = y - 7.5;
    const ring = Math.floor(Math.sqrt(dx * dx + dy * dy)) % 2 === 0 ? 18 : -10;
    const c = vary([154, 126, 78, 255], r, 14);
    return [clamp255(c[0] + ring), clamp255(c[1] + ring), clamp255(c[2] + ring), 255];
  }); // log_top
  put(7, (_x, _y, r) => {
    if (r() < 0.18) return [0, 0, 0, 0];
    return vary([60, 140, 46, 255], r, 40);
  }); // leaves (alpha holes)
  put(8, (x, y, r) => {
    const line = y % 4 === 3 || (x + (Math.floor(y / 4) % 2) * 8) % 16 === 0 ? -28 : 0;
    const c = vary([168, 136, 84, 255], r, 14);
    return [clamp255(c[0] + line), clamp255(c[1] + line), clamp255(c[2] + line), 255];
  }); // planks
  put(9, (_x, _y, r) => vary([110, 110, 110, 255], r, 45)); // cobble
  put(10, (x, y, r) => {
    const wave = Math.sin(x * 0.8 + y * 0.5) * 14;
    const c = vary([52, 96, 200, 200], r, 10);
    return [clamp255(c[0] + wave), clamp255(c[1] + wave), clamp255(c[2] + wave), 200];
  }); // water
  put(11, (_x, _y, r) => vary([70, 70, 70, 255], r, 55)); // bedrock
  put(12, (_x, _y, r) => vary([242, 246, 248, 255], r, 12)); // snow_top
  put(13, (_x, y, r) =>
    y < 4 ? vary([242, 246, 248, 255], r, 12) : vary([134, 96, 67, 255], r, 24),
  ); // snow_side
  put(14, (x, y) => {
    const border = x === 0 || y === 0 || x === 15 || y === 15;
    if (border) return [220, 240, 250, 220];
    if (x === y || x + y === 15) return [230, 245, 255, 60];
    // interior a=0 must stay < alphaTest 0.1 in Task 11 material
    return [200, 230, 245, 0];
  }); // glass
  put(15, (x, y, r) => {
    const stone = vary([125, 125, 125, 255], r, 20);
    const blob = (x % 8 < 3 && y % 8 < 3) || (x % 8 > 5 && y % 8 > 5);
    if (blob && r() > 0.3) return vary([30, 30, 30, 255], r, 18);
    return stone;
  }); // coal_ore
  put(16, (x, y, r) => {
    const stone = vary([125, 125, 125, 255], r, 20);
    const blob = (x % 8 < 3 && y % 8 < 3) || (x % 8 > 5 && y % 8 > 5);
    if (blob && r() > 0.3) return vary([216, 175, 147, 255], r, 20);
    return stone;
  }); // iron_ore
  put(17, (x, y, r) => {
    // crafting_table top: planks base + dark 2×2 workbench grid cross
    const cross = x === 7 || x === 8 || y === 7 || y === 8 ? -40 : 0;
    const line = y % 4 === 3 ? -14 : 0;
    const c = vary([168, 136, 84, 255], r, 14);
    return [clamp255(c[0] + line + cross), clamp255(c[1] + line + cross), clamp255(c[2] + line + cross), 255];
  }); // crafting_top
  put(18, (x, y, r) => {
    // crafting_table side: dark apron band under the top + tool marks
    const band = y >= 2 && y <= 5 ? -30 : 0;
    const tool =
      (x >= 3 && x <= 5 && y >= 9 && y <= 11) || (x === 11 && y >= 8 && y <= 12) ? -45 : 0;
    const line = y % 4 === 3 ? -14 : 0;
    const c = vary([168, 136, 84, 255], r, 14);
    const d = band + tool + line;
    return [clamp255(c[0] + d), clamp255(c[1] + d), clamp255(c[2] + d), 255];
  }); // crafting_side
  put(19, (x, y, r) => {
    // furnace top: stone base + black furnace mouth (8×8) in the middle
    const mouth = x >= 4 && x <= 11 && y >= 4 && y <= 11;
    if (mouth) return vary([22, 22, 22, 255], r, 12);
    const v = (x * 3 + y * 7) % 5 === 0 ? -22 : 0;
    const c = vary([125, 125, 125, 255], r, 20);
    return [clamp255(c[0] + v), clamp255(c[1] + v), clamp255(c[2] + v), 255];
  }); // furnace_top
  put(20, (x, y, r) => {
    // furnace side: stone base + black door frame with an orange fire core
    const door = x >= 5 && x <= 10 && y >= 6 && y <= 13;
    const core = x >= 6 && x <= 9 && y >= 8 && y <= 12;
    if (core) return vary([235, 120, 25, 255], r, 30);
    if (door) return vary([25, 25, 25, 255], r, 12);
    const v = (x * 3 + y * 7) % 5 === 0 ? -22 : 0;
    const c = vary([125, 125, 125, 255], r, 20);
    return [clamp255(c[0] + v), clamp255(c[1] + v), clamp255(c[2] + v), 255];
  }); // furnace_side
  // ---- B3 Task 3: spruce / birch ----
  put(21, (x, _y, r) => {
    // spruce_log_side: dark brown with vertical dark stripes
    const stripe = x % 4 === 0 ? -26 : 0;
    const c = vary([64, 48, 32, 255], r, 14);
    return [clamp255(c[0] + stripe), clamp255(c[1] + stripe), clamp255(c[2] + stripe), 255];
  }); // spruce_log_side
  put(22, (x, y, r) => {
    // spruce_log_top: concentric growth rings (dark brown)
    const dx = x - 7.5;
    const dy = y - 7.5;
    const ring = Math.floor(Math.sqrt(dx * dx + dy * dy)) % 2 === 0 ? 16 : -12;
    const c = vary([78, 58, 38, 255], r, 12);
    return [clamp255(c[0] + ring), clamp255(c[1] + ring), clamp255(c[2] + ring), 255];
  }); // spruce_log_top
  put(23, (_x, _y, r) => {
    // spruce_leaves: dark green with 18% transparent holes (like oak leaves)
    if (r() < 0.18) return [0, 0, 0, 0];
    return vary([46, 96, 40, 255], r, 34);
  }); // spruce_leaves
  put(24, (x, y, r) => {
    // birch_log_side: pale bark + horizontal black dashes (one every ~5 rows)
    const band = y % 5;
    const dash = (band === 2 || band === 3) && (x + (y % 3) * 5) % 7 < 4 ? -150 : 0;
    const c = vary([216, 214, 206, 255], r, 10);
    return [clamp255(c[0] + dash), clamp255(c[1] + dash), clamp255(c[2] + dash), 255];
  }); // birch_log_side
  put(25, (x, y, r) => {
    // birch_log_top: pale growth rings
    const dx = x - 7.5;
    const dy = y - 7.5;
    const ring = Math.floor(Math.sqrt(dx * dx + dy * dy)) % 2 === 0 ? 14 : -10;
    const c = vary([214, 206, 182, 255], r, 10);
    return [clamp255(c[0] + ring), clamp255(c[1] + ring), clamp255(c[2] + ring), 255];
  }); // birch_log_top
  put(26, (_x, _y, r) => {
    // birch_leaves: light green with 18% transparent holes (like oak leaves)
    if (r() < 0.18) return [0, 0, 0, 0];
    return vary([126, 168, 84, 255], r, 34);
  }); // birch_leaves
  // ---- B3 Task 4: dandelion / poppy / short grass / cactus / ice ----
  // 植被的底是**透明**的（alpha 0）→ 材質的 alphaTest 0.1 會把背景裁掉，
  // 只留下花莖與草葉；這是原版花／草「貼圖帶 alpha」的做法。
  put(27, (x, y) => {
    // dandelion: transparent base + green stem (2 px wide) + yellow flower
    const stem = x >= 7 && x <= 8 && y >= 8;
    if (stem) return [86, 140, 60, 255];
    const petal = (x >= 6 && x <= 9 && y >= 4 && y <= 6) || (x >= 7 && x <= 8 && y >= 2 && y <= 7);
    if (petal) return [230, 200, 60, 255];
    return [0, 0, 0, 0];
  }); // dandelion
  put(28, (x, y) => {
    // poppy: same layout as the dandelion, red flower
    const stem = x >= 7 && x <= 8 && y >= 8;
    if (stem) return [86, 140, 60, 255];
    const petal = (x >= 6 && x <= 9 && y >= 4 && y <= 6) || (x >= 7 && x <= 8 && y >= 2 && y <= 7);
    if (petal) return [200, 60, 50, 255];
    return [0, 0, 0, 0];
  }); // poppy
  put(29, (x, y) => {
    // short_grass: a few irregular upright blades on a transparent base
    const blade =
      (x === 3 && y >= 7) ||
      (x === 6 && y >= 11) ||
      (x === 7 && y >= 4 && y <= 10) ||
      (x === 10 && y >= 9);
    if (!blade) return [0, 0, 0, 0];
    return [92, 150, 62, 255];
  }); // short_grass
  put(30, (x, y, r) => {
    // cactus_side: green body + darker rib edges + light spine dots
    if ((x === 3 || x === 7 || x === 11) && y % 5 === 2) return [198, 216, 158, 255];
    const edge = x === 0 || x === 15 ? -28 : 0;
    const c = vary([74, 130, 66, 255], r, 18);
    return [clamp255(c[0] + edge), clamp255(c[1] + edge), clamp255(c[2] + edge), 255];
  }); // cactus_side
  put(31, (x, y, r) => {
    // cactus_top: green with a lighter core and a darker rim
    const dx = x - 7.5;
    const dy = y - 7.5;
    const d = Math.sqrt(dx * dx + dy * dy);
    const core = d < 3 ? 26 : d < 6 ? 8 : -20;
    const c = vary([74, 130, 66, 255], r, 16);
    return [clamp255(c[0] + core), clamp255(c[1] + core), clamp255(c[2] + core), 255];
  }); // cactus_top
  put(32, (x, y) => {
    // ice: pale blue-white半透明底 + white crack lines
    const crack = x === (y * 7) % 13 || (x + y) % 11 === 0;
    if (crack) return [240, 248, 255, 220];
    return [168, 205, 235, 190];
  }); // ice
  // ---- B4 Task 1：羊毛（tile 33）----
  put(33, (_x, _y, r) => vary([233, 236, 236, 255], r, 18)); // wool
  // ---- B5 Task 1：礫石／金礦／鑽石礦／雲杉板材／白樺板材（tile 34–38）----
  put(34, (x, y, r) => {
    // gravel: 灰褐底 ＋ 20 顆深淺不一的碎石點
    const c = vary([136, 130, 122, 255], r, 16);
    const speck = GRAVEL_SPECKS.find((s) => s.x === x && s.y === y);
    if (!speck) return c;
    return [clamp255(c[0] + speck.d), clamp255(c[1] + speck.d), clamp255(c[2] + speck.d), 255];
  }); // gravel
  put(35, (x, y, r) => {
    // gold_ore: 石頭底 ＋ 6 個金黃色斑塊
    if (inOreBlob(x, y)) return vary([240, 200, 60, 255], r, 20);
    const v = (x * 3 + y * 7) % 5 === 0 ? -22 : 0;
    const c = vary([125, 125, 125, 255], r, 20);
    return [clamp255(c[0] + v), clamp255(c[1] + v), clamp255(c[2] + v), 255];
  }); // gold_ore
  put(36, (x, y, r) => {
    // diamond_ore: 石頭底 ＋ 6 個青白色斑塊（與金礦同一組斑塊位置、不同顏色）
    if (inOreBlob(x, y)) return vary([120, 220, 225, 255], r, 20);
    const v = (x * 3 + y * 7) % 5 === 0 ? -22 : 0;
    const c = vary([125, 125, 125, 255], r, 20);
    return [clamp255(c[0] + v), clamp255(c[1] + v), clamp255(c[2] + v), 255];
  }); // diamond_ore
  put(37, (x, y, r) => {
    // spruce_planks: 深棕底 ＋ 垂直深色板縫（每 4 欄一道，交錯的短縫比照橡木）
    const seam = x % 4 === 3 ? -26 : 0;
    const cross = (y + (Math.floor(x / 4) % 2) * 4) % 8 === 0 ? -12 : 0;
    const c = vary([92, 64, 38, 255], r, 14);
    const d = seam + cross;
    return [clamp255(c[0] + d), clamp255(c[1] + d), clamp255(c[2] + d), 255];
  }); // spruce_planks
  put(38, (x, y, r) => {
    // birch_planks: 淺木底 ＋ 垂直淺色板縫（同上節奏，方向相反）
    const seam = x % 4 === 3 ? 26 : 0;
    const cross = (y + (Math.floor(x / 4) % 2) * 4) % 8 === 0 ? 12 : 0;
    const c = vary([196, 180, 140, 255], r, 14);
    const d = seam + cross;
    return [clamp255(c[0] + d), clamp255(c[1] + d), clamp255(c[2] + d), 255];
  }); // birch_planks

  cachedAtlas = { width: ATLAS_SIZE, height: ATLAS_SIZE, data };
  return cachedAtlas;
}

/** GPU texture array for the greedy mesher: 64 layers of 16×16, layer = atlas
 *  tile id, so each merged quad samples one layer via a per-vertex `texIndex`
 *  (no UV atlas math at sample time). Rows are copied flipped — texture row r
 *  holds atlas image row (15 − r) — so the mesher's v=1 (block top) samples
 *  image row 0, matching the old CanvasTexture(flipY)+bakeAtlasUvs contract.
 *  RepeatWrapping repeats WITHIN the layer, so merged quads show the tile once
 *  per block and never bleed into a neighbour layer. Undrawn layers are opaque
 *  magenta #ff00ff (survives alphaTest → an obvious glitch, not invisibility).
 *  NearestFilter + no mipmaps keeps the pixel-art crispness of the atlas. */
export function buildTextureArray(atlas: AtlasImage = drawAtlas()): THREE.DataArrayTexture {
  const layerBytes = TILE_PX * TILE_PX * 4;
  const data = new Uint8Array(ARRAY_LAYERS * layerBytes);
  // Empty layers first: opaque magenta debug fill.
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 1] = 0;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  for (let tile = 0; tile < TILE_COUNT; tile++) { // past TILE_COUNT the magenta fill stays
    const tx = tile % TILES_PER_ROW;
    const ty = Math.floor(tile / TILES_PER_ROW);
    const base = tile * layerBytes;
    for (let y = 0; y < TILE_PX; y++) {
      const srcRow = ty * TILE_PX + (TILE_PX - 1 - y); // flipped: row 0 ← image bottom
      for (let x = 0; x < TILE_PX; x++) {
        const src = (srcRow * ATLAS_SIZE + tx * TILE_PX + x) * 4;
        const dst = base + (y * TILE_PX + x) * 4;
        data[dst] = atlas.data[src];
        data[dst + 1] = atlas.data[src + 1];
        data[dst + 2] = atlas.data[src + 2];
        data[dst + 3] = atlas.data[src + 3];
      }
    }
  }
  const tex = new THREE.DataArrayTexture(data, TILE_PX, TILE_PX, ARRAY_LAYERS);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.flipY = false; // rows already flipped during the copy
  // Same decode the old CanvasTexture had — sRGB → linear before lighting.
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Task 4: the ONE shared GPU texture array (chunk terrain, particle
 *  billboards — later the held-item viewmodel). Memoized: the first caller
 *  builds it from `drawAtlas()` and every later caller gets the same
 *  instance, so the atlas bytes are uploaded once. Owners must NOT dispose
 *  it (chunk unload/teardown would break every other consumer).
 *  `buildTextureArray` is deliberately left untouched — it still returns a
 *  fresh object per call for tests and one-off callers. */
let cachedTextureArray: THREE.DataArrayTexture | null = null;

export function getTextureArray(): THREE.DataArrayTexture {
  if (!cachedTextureArray) cachedTextureArray = buildTextureArray(drawAtlas());
  return cachedTextureArray;
}

// ---- Task 3: mining crack overlay stage textures ----

/** Crack-line alpha (both brief and test pin it): semi-transparent black so
 *  the block texture stays readable under the crack. */
const CRACK_LINE_ALPHA = 120;
/** Pixel budget the walk may visit — the stage-9 ink count. */
const CRACK_PIXEL_BUDGET = 96;
/** Ink floor for stage 0: a single pixel would read as a texture glitch, not
 *  "dig started"; also keeps the prefix strictly growing. */
const CRACK_MIN_INK = 8;
/** Chance to turn instead of going straight — mostly-straight runs is what
 *  makes the walk read as a crack rather than noise. */
const CRACK_TURN_CHANCE = 0.2;
/** Chance per step to sprout a side strand. */
const CRACK_BRANCH_CHANCE = 0.4;
/** Main strand length in steps (branches add the rest of the budget). */
const CRACK_TRUNK_STEPS = 60;

/** Ordered crack-pixel list (memoized): a seeded random walk from the tile
 *  centre with momentum + two levels of branches. Every listed pixel is
 *  unique and index k is the k-th pixel the walk discovered, so painting a
 *  growing PREFIX of this list makes later stages strictly denser
 *  (test-pinned ink(0) < … < ink(9)). */
let crackOrder: number[] | null = null;

function crackPixelOrder(): number[] {
  if (crackOrder) return crackOrder;
  const rnd = mulberry(0x1a2b3c);
  const seen = new Set<number>();
  const order: number[] = [];
  const key = (x: number, y: number) => y * TILE_PX + x;
  const open = (x: number, y: number) =>
    x >= 0 && x < TILE_PX && y >= 0 && y < TILE_PX && !seen.has(key(x, y));
  const add = (x: number, y: number) => {
    seen.add(key(x, y));
    order.push(key(x, y));
  };

  /** One crack strand: step pixel by pixel, turning when blocked or at
   *  random; sprout shorter side strands on the way (depth-capped recursion). */
  function walk(x: number, y: number, dx: number, dy: number, steps: number, depth: number): void {
    for (let i = 0; i < steps && order.length < CRACK_PIXEL_BUDGET; i++) {
      if (rnd() < CRACK_TURN_CHANCE || !open(x + dx, y + dy)) {
        // Prefer a perpendicular heading; reverse is the last resort so a
        // strand doubles back instead of dying in a one-way dead end.
        const perpA: [number, number] = [dy, -dx];
        const perpB: [number, number] = [-dy, dx];
        const back: [number, number] = [-dx, -dy];
        const choices = rnd() < 0.5 ? [perpA, perpB, back] : [perpB, perpA, back];
        const pick = choices.find(([cx, cy]) => open(x + cx, y + cy));
        if (!pick) return; // fully boxed in
        dx = pick[0];
        dy = pick[1];
      }
      add(x + dx, y + dy);
      x += dx;
      y += dy;
      if (depth > 0 && rnd() < CRACK_BRANCH_CHANCE) {
        const b: [number, number] = rnd() < 0.5 ? [dy, -dx] : [-dy, dx];
        if (open(x + b[0], y + b[1])) {
          add(x + b[0], y + b[1]);
          walk(x + b[0], y + b[1], b[0], b[1], 3 + Math.floor(rnd() * 4), depth - 1);
        }
      }
    }
  }

  const cx = TILE_PX / 2; // 8 — centre seed, cracks radiate from the impact
  const cy = TILE_PX / 2;
  add(cx, cy);
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const [dx, dy] = dirs[Math.floor(rnd() * dirs.length)];
  add(cx + dx, cy + dy);
  walk(cx + dx, cy + dy, dx, dy, CRACK_TRUNK_STEPS, 2);
  crackOrder = order;
  return order;
}

/** Task 3: one 16×16 RGBA crack texture for dig stage `stage` (0..9; clamped,
 *  non-finite → 0). Transparent background, black crack lines at
 *  `CRACK_LINE_ALPHA`; higher stages strictly denser (prefix of
 *  `crackPixelOrder`). Canvas-free and deterministic like `drawAtlas` —
 *  `createCrackOverlay` uploads the bytes. */
export function drawCrackStage(stage: number): Uint8ClampedArray {
  const s = Number.isFinite(stage) ? Math.max(0, Math.min(9, Math.floor(stage))) : 0;
  const order = crackPixelOrder();
  const minInk = Math.min(CRACK_MIN_INK, order.length);
  const ink = minInk + Math.round(((order.length - minInk) * s) / 9);
  const data = new Uint8ClampedArray(TILE_PX * TILE_PX * 4);
  for (let i = 0; i < ink; i++) {
    const p = order[i] * 4;
    data[p] = 0; // black line
    data[p + 1] = 0;
    data[p + 2] = 0;
    data[p + 3] = CRACK_LINE_ALPHA;
  }
  return data;
}
