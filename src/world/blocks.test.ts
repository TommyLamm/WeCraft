import { describe, it, expect } from 'vitest';
import { BLOCK, getBlockDef, isSolid, isTransparent, PLACEABLE, HOTBAR_DEFAULT } from './blocks';

describe('blocks', () => {
  it('air id is 0 and not solid', () => {
    expect(BLOCK.AIR).toBe(0);
    expect(isSolid(BLOCK.AIR)).toBe(false);
  });

  it('stone is solid, hardness > 0', () => {
    expect(isSolid(BLOCK.STONE)).toBe(true);
    expect(getBlockDef(BLOCK.STONE).hardness).toBeGreaterThan(0);
  });

  it('bedrock cannot be broken', () => {
    expect(getBlockDef(BLOCK.BEDROCK).hardness).toBe(Infinity);
  });

  it('glass is transparent and solid', () => {
    expect(isTransparent(BLOCK.GLASS)).toBe(true);
    expect(isSolid(BLOCK.GLASS)).toBe(true);
  });

  it('water is not solid but exists', () => {
    expect(isSolid(BLOCK.WATER)).toBe(false);
    expect(getBlockDef(BLOCK.WATER).name).toBe('water');
  });

  it('every non-air block has valid tile indices', () => {
    for (const def of Object.values(BLOCK)) {
      if (def === 0) continue;
      const d = getBlockDef(def);
      for (const t of [d.top, d.side, d.bottom]) {
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThan(64);
      }
    }
  });

  it('placeable list has no air/water and at least 9', () => {
    expect(PLACEABLE).not.toContain(BLOCK.AIR);
    expect(PLACEABLE).not.toContain(BLOCK.WATER);
    expect(PLACEABLE.length).toBeGreaterThanOrEqual(9);
  });

  it('crafting_table: solid, opaque, hardness 2.5, placeable, per-face tiles (Task 11)', () => {
    const def = getBlockDef(BLOCK.CRAFTING_TABLE);
    expect(def.name).toBe('crafting_table');
    expect(def.hardness).toBe(2.5);
    expect(isSolid(BLOCK.CRAFTING_TABLE)).toBe(true);
    expect(isTransparent(BLOCK.CRAFTING_TABLE)).toBe(false);
    expect(PLACEABLE).toContain(BLOCK.CRAFTING_TABLE);
    expect(def.top).not.toBe(def.side); // grid top vs tool-front side
    expect(HOTBAR_DEFAULT).not.toContain(BLOCK.CRAFTING_TABLE); // crafted, not given
  });
});
