import { describe, it, expect } from 'vitest';
import { ATLAS_SIZE, TILE_PX, TILES_PER_ROW, drawAtlas, tileIndexAt } from './textures';

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
    let opaque = 0;
    for (let i = 3; i < data.data.length; i += 4) if (data.data[i] > 0) opaque++;
    expect(opaque).toBeGreaterThan(1000);
  });

  it('tileIndexAt returns row-major index', () => {
    expect(tileIndexAt(0, 0)).toBe(0);
    expect(tileIndexAt(1, 0)).toBe(1);
    expect(tileIndexAt(0, 1)).toBe(32);
  });
});
