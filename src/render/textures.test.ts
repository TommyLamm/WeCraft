import { describe, it, expect } from 'vitest';
import {
  ATLAS_SIZE,
  TILE_PX,
  TILES_PER_ROW,
  drawAtlas,
  tileIndexAt,
  type AtlasImage,
} from './textures';

const GRASS_SIDE = 1;
const STONE = 3;
const LEAVES = 7;
const WATER = 10;
const GLASS = 14;
const COAL_ORE = 15;
const IRON_ORE = 16;

function tilePixel(
  atlas: AtlasImage,
  tile: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const tx = tile % TILES_PER_ROW;
  const ty = Math.floor(tile / TILES_PER_ROW);
  const i = ((ty * TILE_PX + y) * ATLAS_SIZE + tx * TILE_PX + x) * 4;
  return [atlas.data[i], atlas.data[i + 1], atlas.data[i + 2], atlas.data[i + 3]];
}

describe('textures', () => {
  it('constants are consistent', () => {
    expect(ATLAS_SIZE).toBe(512);
    expect(TILE_PX).toBe(16);
    expect(TILES_PER_ROW).toBe(32);
    expect(TILES_PER_ROW * TILE_PX).toBe(ATLAS_SIZE);
  });

  it('drawAtlas fills non-empty pixels', () => {
    const data = drawAtlas();
    expect(data.width).toBe(ATLAS_SIZE);
    expect(data.height).toBe(ATLAS_SIZE);
    let nonZeroAlpha = 0;
    for (let i = 3; i < data.data.length; i += 4) if (data.data[i] > 0) nonZeroAlpha++;
    expect(nonZeroAlpha).toBeGreaterThan(1000);
  });

  it('drawAtlas is deterministic across calls', () => {
    const a = drawAtlas();
    const b = drawAtlas();
    expect(b.width).toBe(a.width);
    expect(b.height).toBe(a.height);
    let firstDiff = -1;
    for (let i = 0; i < a.data.length; i++) {
      if (a.data[i] !== b.data[i]) {
        firstDiff = i;
        break;
      }
    }
    expect(firstDiff).toBe(-1);
  });

  it('grass_side: rows 0-2 green dominant, rows 12-15 brown dirt (v-contract)', () => {
    const atlas = drawAtlas();
    for (let y = 0; y <= 2; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const [r, g, b] = tilePixel(atlas, GRASS_SIDE, x, y);
        expect(g, `green strip y=${y} x=${x}`).toBeGreaterThan(r);
        expect(g, `green strip y=${y} x=${x}`).toBeGreaterThan(b);
      }
    }
    for (let y = 12; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const [r, g] = tilePixel(atlas, GRASS_SIDE, x, y);
        expect(g, `dirt y=${y} x=${x}`).toBeLessThan(r);
      }
    }
  });

  it('glass: interior a=0 (< alphaTest 0.1), border a=220, streak a=60', () => {
    const atlas = drawAtlas();
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const isBorder = x === 0 || y === 0 || x === 15 || y === 15;
        const isStreak = !isBorder && (x === y || x + y === 15);
        const expected = isBorder ? 220 : isStreak ? 60 : 0;
        const alpha = tilePixel(atlas, GLASS, x, y)[3];
        expect(alpha, `glass x=${x} y=${y}`).toBe(expected);
      }
    }
    const interior = tilePixel(atlas, GLASS, 2, 1);
    expect(interior[3]).toBeLessThanOrEqual(25);
    expect(interior[3]).toBeLessThan(0.1 * 255);
  });

  it('leaves: contains both fully transparent and fully opaque pixels', () => {
    const atlas = drawAtlas();
    let transparent = 0;
    let opaque = 0;
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const a = tilePixel(atlas, LEAVES, x, y)[3];
        if (a === 0) transparent++;
        if (a === 255) opaque++;
      }
    }
    expect(transparent).toBeGreaterThan(0);
    expect(opaque).toBeGreaterThan(0);
  });

  it('stone: r===g===b on opaque pixels', () => {
    const atlas = drawAtlas();
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const [r, g, b, a] = tilePixel(atlas, STONE, x, y);
        if (a > 0) {
          expect(r, `stone x=${x} y=${y}`).toBe(g);
          expect(g, `stone x=${x} y=${y}`).toBe(b);
        }
      }
    }
  });

  it('water: sampled alpha is exactly 200', () => {
    const atlas = drawAtlas();
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const a = tilePixel(atlas, WATER, x, y)[3];
        expect(a, `water x=${x} y=${y}`).toBe(200);
      }
    }
  });

  it('coal + iron ores contain speck pixels; stone has none of either', () => {
    const atlas = drawAtlas();
    let coalSpecks = 0;
    let ironSpecks = 0;
    let stoneOffBase = 0;
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const [cr, cg] = tilePixel(atlas, COAL_ORE, x, y);
        if (cr === cg && cr < 60) coalSpecks++; // coal speck: dark grayscale (< stone base min)
        const [ir, ig] = tilePixel(atlas, IRON_ORE, x, y);
        if (Math.abs(ir - ig) > 10) ironSpecks++; // iron speck: warm tint, r!==g
        const [sr, sg] = tilePixel(atlas, STONE, x, y);
        if (sr !== sg || sr < 60) stoneOffBase++;
      }
    }
    expect(coalSpecks).toBeGreaterThan(0);
    expect(ironSpecks).toBeGreaterThan(0);
    expect(stoneOffBase).toBe(0);
  });

  it('tileIndexAt returns row-major index', () => {
    expect(tileIndexAt(0, 0)).toBe(0);
    expect(tileIndexAt(1, 0)).toBe(1);
    expect(tileIndexAt(0, 1)).toBe(32);
  });
});
