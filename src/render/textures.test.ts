import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  ATLAS_SIZE,
  TILE_PX,
  TILES_PER_ROW,
  buildTextureArray,
  drawAtlas,
  drawCrackStage,
  getTextureArray,
  tileIndexAt,
  type AtlasImage,
} from './textures';
import { TILE_COUNT } from '../world/blocks';

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

  it('furnace (Task 6): top + side tiles are painted, never full magenta', () => {
    const FURNACE_TOP = 19;
    const FURNACE_SIDE = 20;
    const atlas = drawAtlas();
    for (const tile of [FURNACE_TOP, FURNACE_SIDE]) {
      let magenta = 0;
      let opaque = 0;
      for (let y = 0; y < TILE_PX; y++) {
        for (let x = 0; x < TILE_PX; x++) {
          const [r, g, b, a] = tilePixel(atlas, tile, x, y);
          if (a === 255) opaque++;
          if (r === 255 && g === 0 && b === 255) magenta++;
        }
      }
      // undrawn layers stay opaque magenta (buildTextureArray debug fill) —
      // a painted tile must never be all magenta or it glitches in-game
      expect(opaque, `tile ${tile} opaque`).toBe(TILE_PX * TILE_PX);
      expect(magenta, `tile ${tile} magenta`).toBeLessThan(TILE_PX * TILE_PX);
    }
    // top: the black furnace mouth in the middle is darker than the stone rim
    let mouth = 0;
    let rim = 0;
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const r = tilePixel(atlas, FURNACE_TOP, x, y)[0];
        if (x >= 4 && x <= 11 && y >= 4 && y <= 11) mouth += r;
        else rim += r;
      }
    }
    expect(mouth / 64).toBeLessThan(rim / 192 - 15);
    // side: the orange fire core reads warm (r clearly above b)
    let warm = 0;
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const [r, , b] = tilePixel(atlas, FURNACE_SIDE, x, y);
        if (r - b > 60) warm++;
      }
    }
    expect(warm).toBeGreaterThan(0);
  });

  // ---- B3 Task 4：花／草／仙人掌／冰的圖樣 ----
  it('the plant tiles are cut-outs on a transparent background (alphaTest 0.1 可裁切)', () => {
    const DANDELION = 27;
    const POPPY = 28;
    const SHORT_GRASS = 29;
    const atlas = drawAtlas();
    for (const tile of [DANDELION, POPPY, SHORT_GRASS]) {
      let transparent = 0;
      let painted = 0;
      for (let y = 0; y < TILE_PX; y++)
        for (let x = 0; x < TILE_PX; x++) {
          const a = tilePixel(atlas, tile, x, y)[3];
          if (a === 0) transparent++;
          if (a === 255) painted++;
        }
      expect(transparent, `tile ${tile} transparent`).toBeGreaterThan(0);
      expect(painted, `tile ${tile} painted`).toBeGreaterThan(0);
    }
    // 蒲公英是黃花、罌粟是紅花：不可畫成同一種顏色
    const dandelion = tilePixel(atlas, DANDELION, 7, 5);
    expect(dandelion[0]).toBeGreaterThan(dandelion[2]); // r > b → 暖黃
    const poppy = tilePixel(atlas, POPPY, 7, 5);
    expect(poppy[0]).toBeGreaterThan(poppy[2]); // r > b → 紅
    expect(poppy[0]).not.toBe(dandelion[0]); // 兩種花不可同色
    // 草叢是綠色
    const grass = tilePixel(atlas, SHORT_GRASS, 7, 5);
    expect(grass[1]).toBeGreaterThan(grass[0]);
    expect(grass[1]).toBeGreaterThan(grass[2]);
  });

  it('cactus tiles are opaque green with light spines; ice is translucent with white cracks', () => {
    const CACTUS_SIDE = 30;
    const CACTUS_TOP = 31;
    const ICE = 32;
    const atlas = drawAtlas();
    for (const tile of [CACTUS_SIDE, CACTUS_TOP]) {
      for (let y = 0; y < TILE_PX; y++)
        for (let x = 0; x < TILE_PX; x++) {
          expect(tilePixel(atlas, tile, x, y)[3], `tile ${tile} px ${x},${y}`).toBe(255);
        }
    }
    // 仙人掌是綠色
    const [r, g, b] = tilePixel(atlas, CACTUS_SIDE, 8, 8);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    // 冰：半透明底（alpha 190）＋ 白色裂紋線（alpha 220 且更亮）
    let base = 0;
    let cracks = 0;
    for (let y = 0; y < TILE_PX; y++)
      for (let x = 0; x < TILE_PX; x++) {
        const [ir, , , a] = tilePixel(atlas, ICE, x, y);
        if (a === 190) base++;
        if (a === 220 && ir > 200) cracks++;
      }
    expect(base).toBeGreaterThan(0);
    expect(cracks).toBeGreaterThan(0);
  });

  // ---- B5 Task 1：礫石／金礦／鑽石礦／雲杉板材／白樺板材的圖樣（tile 34–38）----
  /** 整塊 tile 的平均色與平均亮度（B5 用；不寫死單一像素）。 */
  function tileStats(atlas: AtlasImage, tile: number) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let y = 0; y < TILE_PX; y++)
      for (let x = 0; x < TILE_PX; x++) {
        const p = tilePixel(atlas, tile, x, y);
        r += p[0];
        g += p[1];
        b += p[2];
      }
    const n = TILE_PX * TILE_PX;
    return { r: r / n, g: g / n, b: b / n, luma: (r + g + b) / (3 * n) };
  }

  it('gravel tile 34: opaque warm grey with scattered darker/lighter pebbles', () => {
    const GRAVEL = 34;
    const atlas = drawAtlas();
    const { r, g, b, luma } = tileStats(atlas, GRAVEL);
    // 暖灰褐（brief 的底色 [136,130,122]）不是中性灰：r > g > b
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(r - b).toBeGreaterThan(6);
    expect(r).toBeGreaterThan(120);
    expect(r).toBeLessThan(155);
    // 碎石點：偏離整塊平均亮度 > 22 的像素（底色的 vary ±8 達不到 22）
    let pebbles = 0;
    for (let y = 0; y < TILE_PX; y++)
      for (let x = 0; x < TILE_PX; x++) {
        const [pr, pg, pb, pa] = tilePixel(atlas, GRAVEL, x, y);
        expect(pa, `gravel x=${x} y=${y}`).toBe(255); // 礫石不透明
        if (Math.abs((pr + pg + pb) / 3 - luma) > 22) pebbles++;
      }
    expect(pebbles).toBeGreaterThanOrEqual(20); // 20 顆深淺不一的碎石點
    expect(pebbles).toBeLessThan(64); // 但底色仍要是主體（不是整片雜訊）
  });

  it('gold/diamond ore tiles 35/36: stone base with golden / cyan-white blobs', () => {
    const GOLD_ORE = 35;
    const DIAMOND_ORE = 36;
    const atlas = drawAtlas();
    let gold = 0;
    let cyan = 0;
    let stoneBase = 0;
    for (let y = 0; y < TILE_PX; y++)
      for (let x = 0; x < TILE_PX; x++) {
        const [gr, gg, gb, ga] = tilePixel(atlas, GOLD_ORE, x, y);
        const [dr, dg, db, da] = tilePixel(atlas, DIAMOND_ORE, x, y);
        expect(ga, `gold x=${x} y=${y}`).toBe(255);
        expect(da, `diamond x=${x} y=${y}`).toBe(255);
        if (gr > 190 && gg > 150 && gb < 130) gold++; // 金黃斑塊 [240,200,60]
        if (dr < 170 && dg > 190 && db > 190) cyan++; // 青白斑塊 [120,220,225]
        if (gr === gg && gg === gb) stoneBase++; // 石頭底（r=g=b）
      }
    // 5–7 個斑塊（每個至少 4 px）→ 20–128 之間
    expect(gold).toBeGreaterThanOrEqual(20);
    expect(gold).toBeLessThan(128);
    expect(cyan).toBeGreaterThanOrEqual(20);
    expect(cyan).toBeLessThan(128);
    // 石頭底仍是主體（斑塊是少數）
    expect(stoneBase).toBeGreaterThan(150);
    // 兩種礦不可畫成同一種顏色：金礦的斑塊偏紅、鑽石礦偏青，且互不出現在對方身上
    let goldCool = 0;
    let diamondWarm = 0;
    for (let y = 0; y < TILE_PX; y++)
      for (let x = 0; x < TILE_PX; x++) {
        const [gr, , gb] = tilePixel(atlas, GOLD_ORE, x, y);
        if (gb - gr > 60) goldCool++;
        const [dr, , db] = tilePixel(atlas, DIAMOND_ORE, x, y);
        if (dr - db > 80) diamondWarm++;
      }
    expect(goldCool).toBe(0);
    expect(diamondWarm).toBe(0);
  });

  it('spruce/birch planks tiles 37/38: opaque wood tones with vertical seams', () => {
    const OAK_PLANKS = 8;
    const SPRUCE_PLANKS = 37;
    const BIRCH_PLANKS = 38;
    const atlas = drawAtlas();
    const oak = tileStats(atlas, OAK_PLANKS);
    const spruce = tileStats(atlas, SPRUCE_PLANKS);
    const birch = tileStats(atlas, BIRCH_PLANKS);
    for (const tile of [SPRUCE_PLANKS, BIRCH_PLANKS]) {
      for (let y = 0; y < TILE_PX; y++)
        for (let x = 0; x < TILE_PX; x++) {
          expect(tilePixel(atlas, tile, x, y)[3], `tile ${tile} px ${x},${y}`).toBe(255);
        }
    }
    // 深棕雲杉材 vs 淺木白樺材：平均亮度分別落在橡木板材的兩側
    expect(spruce.luma).toBeLessThan(oak.luma - 20);
    expect(birch.luma).toBeGreaterThan(oak.luma + 10);
    // brief 指定的底色量級：雲杉 [92,64,38]、白樺 [196,180,140]
    expect(spruce.r).toBeGreaterThan(70);
    expect(spruce.r).toBeLessThan(105);
    expect(spruce.b).toBeLessThan(60);
    expect(birch.r).toBeGreaterThan(180);
    expect(birch.r).toBeLessThan(220);
    expect(birch.b).toBeGreaterThan(125);
    // 垂直板縫：每 4 欄一道（與橡木的橫向板縫同一節奏）——雲杉偏暗、白樺偏亮
    const colLuma = (tile: number): number[] =>
      Array.from({ length: TILE_PX }, (_, x) => {
        let s = 0;
        for (let y = 0; y < TILE_PX; y++) {
          const p = tilePixel(atlas, tile, x, y);
          s += (p[0] + p[1] + p[2]) / 3;
        }
        return s / TILE_PX;
      });
    const spruceCols = colLuma(SPRUCE_PLANKS);
    const birchCols = colLuma(BIRCH_PLANKS);
    const darkest = spruceCols.indexOf(Math.min(...spruceCols));
    expect(darkest % 4).toBe(3);
    expect(spruceCols[darkest]).toBeLessThan(spruce.luma - 8);
    const brightest = birchCols.indexOf(Math.max(...birchCols));
    expect(brightest % 4).toBe(3);
    expect(birchCols[brightest]).toBeGreaterThan(birch.luma + 8);
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
    for (let tile = 0; tile < TILE_COUNT; tile++) {
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
    // tiles 0..TILE_COUNT-1 are drawn in drawAtlas → content (glass tile 14 included)
    const glass = layerPixel(tex, 14, 0, 0); // border pixel, a=220
    expect(glass).not.toEqual(MAGENTA);
    // the first empty layer (TILE_COUNT) + deeper ones never drawn → magenta debug fill
    // (alphaTest-proof)
    // 洋紅除錯色只存在於「未畫」的層；用 TILE_COUNT 起算，不要寫死層號
    // （B3 Task 3 的唯一修復點：之後 TILE_COUNT 變化都自動適應）
    for (const layer of [TILE_COUNT, TILE_COUNT + 1, 47, 63]) {
      for (const [x, y] of [[0, 0], [8, 8], [15, 15]] as const) {
        expect(layerPixel(tex, layer, x, y), `layer ${layer} px ${x},${y}`).toEqual(MAGENTA);
      }
    }
  });

  it('every declared tile is painted (never the magenta debug layer)', () => {
    // 斷言寫在「紋理陣列層」而不是 atlas：洋紅除錯色在 buildTextureArray()
    // 沒被畫到的層；atlas 裡沒畫的區域是全 0 的透明像素 → 用 atlas 判斷會
    // 「任何 tile 都通過」，等於沒有測試。
    const data = buildTextureArray().image.data as Uint8Array;
    for (let t = 0; t < TILE_COUNT; t++) {
      let magenta = 0;
      let painted = 0;
      for (let p = 0; p < TILE_PX * TILE_PX; p++) {
        const i = (t * TILE_PX * TILE_PX + p) * 4;
        if (data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 255) magenta++;
        if (data[i + 3] > 0) painted++;
      }
      expect(magenta, `tile ${t} magenta`).toBeLessThan(TILE_PX * TILE_PX);
      expect(painted, `tile ${t} painted`).toBeGreaterThan(0);
    }
  });
});

// ---- Task 3: mining crack overlay stage textures ----

describe('drawCrackStage', () => {
  /** Non-transparent pixel count of a stage texture ("ink"). */
  function ink(stage: number): number {
    const data = drawCrackStage(stage);
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  }

  it('is a 16×16 RGBA buffer: transparent background, black lines alpha=120', () => {
    for (let stage = 0; stage <= 9; stage++) {
      const data = drawCrackStage(stage);
      expect(data.length, `stage ${stage}`).toBe(TILE_PX * TILE_PX * 4); // 1024
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue; // transparent background pixel
        expect(data[i + 3], `stage ${stage} alpha @${i}`).toBe(120);
        expect([data[i], data[i + 1], data[i + 2]], `stage ${stage} rgb @${i}`).toEqual([0, 0, 0]);
      }
    }
  });

  it('higher stages are strictly denser: ink(9) > ink(4) > ink(0) > 0', () => {
    const counts = Array.from({ length: 10 }, (_, s) => ink(s));
    expect(counts[9]).toBeGreaterThan(counts[4]);
    expect(counts[4]).toBeGreaterThan(counts[0]);
    expect(counts[0]).toBeGreaterThan(0);
    // the full stage ladder: every step grows
    for (let s = 1; s < counts.length; s++) {
      expect(counts[s], `stage ${s} vs ${s - 1}`).toBeGreaterThan(counts[s - 1]);
    }
  });

  it('is deterministic — the same stage twice yields identical buffers', () => {
    for (const stage of [0, 4, 9]) {
      expect(Array.from(drawCrackStage(stage)), `stage ${stage}`).toEqual(
        Array.from(drawCrackStage(stage)),
      );
    }
  });

  it('clamps the stage: NaN and -1 paint stage 0', () => {
    expect(Array.from(drawCrackStage(NaN))).toEqual(Array.from(drawCrackStage(0)));
    expect(Array.from(drawCrackStage(-1))).toEqual(Array.from(drawCrackStage(0)));
  });
});

// ---- Task 4: shared memoized texture array (chunks + particles) ----

describe('getTextureArray', () => {
  it('memoizes ONE shared instance; buildTextureArray keeps returning fresh objects', () => {
    const first = getTextureArray();
    expect(first).toBeInstanceOf(THREE.DataArrayTexture);
    expect(getTextureArray()).toBe(first); // same ref every call
    expect(buildTextureArray()).not.toBe(buildTextureArray()); // build stays fresh
    expect(getTextureArray()).toBe(first); // fresh builds never replace the memo
  });
});
