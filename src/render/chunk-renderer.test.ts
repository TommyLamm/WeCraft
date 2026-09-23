import { describe, it, expect } from 'vitest';
import { bakeAtlasUvs } from './chunk-renderer';
import { ATLAS_SIZE, TILES_PER_ROW } from './textures';

const tile = 1 / TILES_PER_ROW;
const inset = 0.5 / ATLAS_SIZE;

function bake(uv: readonly [number, number], layer: number): [number, number] {
  const out = bakeAtlasUvs(new Float32Array(uv), new Float32Array([layer]));
  return [out[0], out[1]];
}

describe('bakeAtlasUvs', () => {
  it('v-flips: vv=0 → v at tile bottom in atlas space (layer 0 → tx=0, ty=0)', () => {
    const [u, v] = bake([0, 0], 0);
    // layer 0 → tx=0, ty=0 → v0 = 1-(ty+1)*tile; vv=0 lands at v0+inset (tile bottom edge + inset)
    expect(u).toBe(0 * tile + inset);
    expect(v).toBe(1 - (0 + 1) * tile + inset);
    expect(v).toBe(1 - tile + inset);
    expect(v).toBeGreaterThan(1 - tile);
    expect(v).toBeLessThan(1);
  });

  it('inset magnitude: uv 0 maps to inset (0.5/512), uv 1 to tile-edge minus inset', () => {
    expect(inset).toBe(0.5 / 512);
    const [u0, v0] = bake([0, 0], 0);
    expect(u0).toBe(inset);
    expect(u0).not.toBe(0);
    expect(v0).toBe(1 - tile + inset);
    const [u1, v1] = bake([1, 1], 0);
    expect(u1).toBe(tile - inset);
    expect(u1).toBeLessThan(tile);
    expect(v1).toBe(1 - inset);
    expect(v1).toBeLessThan(1);
  });

  it('layer → (tx, ty) row-major: layer 32 → tx=0, ty=1 (second row)', () => {
    expect(TILES_PER_ROW).toBe(32);
    expect(32 % TILES_PER_ROW).toBe(0);
    expect(Math.floor(32 / TILES_PER_ROW)).toBe(1);
    const [u, v] = bake([0, 0], 32);
    expect(u).toBe((32 % TILES_PER_ROW) * tile + inset); // tx=0
    expect(v).toBe(1 - (Math.floor(32 / TILES_PER_ROW) + 1) * tile + inset); // ty=1
    expect(v).toBe(1 - 2 * tile + inset);
    // next layer on the same row shifts one tile right
    const [u33] = bake([0, 0], 33);
    expect(u33).toBe(1 * tile + inset);
  });

  it('contract uv ∈ {0,1} always lands inside its tile (inset from edges)', () => {
    for (const layer of [0, 5, 31, 32, 63, 100]) {
      const tx = layer % TILES_PER_ROW;
      const ty = Math.floor(layer / TILES_PER_ROW);
      const u0 = tx * tile;
      const v0 = 1 - (ty + 1) * tile;
      for (const uu of [0, 1]) {
        for (const vv of [0, 1]) {
          const [u, v] = bake([uu, vv], layer);
          expect(u).toBeGreaterThanOrEqual(u0 + inset);
          expect(u).toBeLessThanOrEqual(u0 + tile - inset);
          expect(v).toBeGreaterThanOrEqual(v0 + inset);
          expect(v).toBeLessThanOrEqual(v0 + tile - inset);
        }
      }
    }
  });
});
