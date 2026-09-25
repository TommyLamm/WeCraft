import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  ATLAS_SIZE,
  TILE_PX,
  TILES_PER_ROW,
  buildTextureArray,
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

  it('crafting table (Task 11): opaque tiles; top grid cross + side apron band are darker', () => {
    const CRAFTING_TOP = 17;
    const CRAFTING_SIDE = 18;
    const atlas = drawAtlas();
    for (const tile of [CRAFTING_TOP, CRAFTING_SIDE]) {
      for (let y = 0; y < TILE_PX; y++)
        for (let x = 0; x < TILE_PX; x++) {
          expect(tilePixel(atlas, tile, x, y)[3], `tile ${tile} px ${x},${y}`).toBe(255);
        }
    }
    // top: the 2×2 workbench grid cross (x or y in {7,8}) vs the planks base
    let cross = 0;
    let base = 0;
    for (let y = 0; y < TILE_PX; y++)
      for (let x = 0; x < TILE_PX; x++) {
        const r = tilePixel(atlas, CRAFTING_TOP, x, y)[0];
        if (x === 7 || x === 8 || y === 7 || y === 8) cross += r;
        else base += r;
      }
    expect(cross / 60).toBeLessThan(base / 196 - 15);
    // side: apron band under the table top (rows 2–5) vs the lower body
    let band = 0;
    let body = 0;
    for (let y = 2; y <= 5; y++)
      for (let x = 0; x < TILE_PX; x++) band += tilePixel(atlas, CRAFTING_SIDE, x, y)[0];
    for (let y = 6; y <= 11; y++)
      for (let x = 0; x < TILE_PX; x++) body += tilePixel(atlas, CRAFTING_SIDE, x, y)[0];
    expect(band / 64).toBeLessThan(body / 96 - 15);
  });
});

// ---- Task 15: texture array for greedy-mesh sampling ----

describe('buildTextureArray', () => {
  const LAYERS = 64;
  const MAGENTA: [number, number, number, number] = [255, 0, 255, 255];

  /** RGBA at (x, y) of `layer` — y is TEXTURE row (v grows with y). */
  function layerPixel(
    tex: THREE.DataArrayTexture,
    layer: number,
    x: number,
    y: number,
  ): [number, number, number, number] {
    const data = tex.image.data as Uint8Array;
    const i = (layer * TILE_PX * TILE_PX + y * TILE_PX + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  }

  it('is a 64 × 16 × 16 array: NearestFilter, no mipmaps, repeat wrap, no flipY', () => {
    const tex = buildTextureArray();
    expect(tex.image.width).toBe(TILE_PX);
    expect(tex.image.height).toBe(TILE_PX);
    expect(tex.image.depth).toBe(LAYERS);
    expect(tex.image.data.length).toBe(LAYERS * TILE_PX * TILE_PX * 4);
    expect(tex.minFilter).toBe(THREE.NearestFilter);
    expect(tex.magFilter).toBe(THREE.NearestFilter);
    expect(tex.generateMipmaps).toBe(false);
    // merged quads tile the same texture N× → wrap must repeat within the layer
    expect(tex.wrapS).toBe(THREE.RepeatWrapping);
    expect(tex.wrapT).toBe(THREE.RepeatWrapping);
    expect(tex.flipY).toBe(false);
  });

  it('copies atlas tiles into layers with rows flipped (v=1 ↔ image top)', () => {
    const tex = buildTextureArray();
    const atlas = drawAtlas();
    // Every content tile: texture row r holds image row (15 − r), so the
    // mesher's v=1 (block top) samples image row 0 — same contract the old
    // CanvasTexture(flipY)+bakeAtlasUvs pair produced.
    for (let tile = 0; tile < 19; tile++) {
      const tx = tile % TILES_PER_ROW;
      const ty = Math.floor(tile / TILES_PER_ROW);
      for (const [x, y] of [[0, 0], [7, 3], [15, 15]] as const) {
        const src =
          ((ty * TILE_PX + (TILE_PX - 1 - y)) * ATLAS_SIZE + tx * TILE_PX + x) * 4;
        expect(layerPixel(tex, tile, x, y), `tile ${tile} px ${x},${y}`).toEqual([
          atlas.data[src],
          atlas.data[src + 1],
          atlas.data[src + 2],
          atlas.data[src + 3],
        ]);
      }
    }
  });

  it('grass_side green strip ends up at the TOP of its layer (block-face top)', () => {
    const tex = buildTextureArray();
    const GRASS_SIDE = 1;
    // image rows 0–2 are the green strip (textures.test v-contract) → texture rows 13–15
    for (let row = TILE_PX - 3; row < TILE_PX; row++) {
      for (let x = 0; x < TILE_PX; x++) {
        const [r, g, b] = layerPixel(tex, GRASS_SIDE, x, row);
        expect(g, `green row=${row} x=${x}`).toBeGreaterThan(r);
        expect(g, `green row=${row} x=${x}`).toBeGreaterThan(b);
      }
    }
    // and the dirt bottom of the image sits at texture row 0 (block bottom)
    const [r, g] = layerPixel(tex, GRASS_SIDE, 0, 0);
    expect(g).toBeLessThan(r);
  });

  it('drawn tiles keep their content; empty layers are opaque magenta #ff00ff', () => {
    const tex = buildTextureArray();
    // tiles 0–18 are drawn in drawAtlas → content (glass tile 14 included)
    const glass = layerPixel(tex, 14, 0, 0); // border pixel, a=220
    expect(glass).not.toEqual(MAGENTA);
    // tile 19+ never drawn → magenta debug fill (alphaTest-proof)
    for (const layer of [19, 32, 47, 63]) {
      for (const [x, y] of [[0, 0], [8, 8], [15, 15]] as const) {
        expect(layerPixel(tex, layer, x, y), `layer ${layer} px ${x},${y}`).toEqual(MAGENTA);
      }
    }
  });
});
