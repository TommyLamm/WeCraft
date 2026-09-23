export const ATLAS_SIZE = 512;
export const TILE_PX = 16;
export const TILES_PER_ROW = ATLAS_SIZE / TILE_PX; // 32

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

export function drawAtlas(): AtlasImage {
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

  return { width: ATLAS_SIZE, height: ATLAS_SIZE, data };
}
