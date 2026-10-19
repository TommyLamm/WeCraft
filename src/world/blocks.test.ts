import { describe, it, expect } from 'vitest';
import {
  BLOCK,
  getBlockDef,
  isSolid,
  isTransparent,
  PLACEABLE,
  HOTBAR_DEFAULT,
  type BlockDef,
} from './blocks';

describe('blocks', () => {
  it('air id is 0 and not solid', () => {
    expect(BLOCK.AIR).toBe(0);
    expect(isSolid(BLOCK.AIR)).toBe(false);
  });

  it('stone is solid and opaque', () => {
    expect(isSolid(BLOCK.STONE)).toBe(true);
    expect(isTransparent(BLOCK.STONE)).toBe(false);
  });

  it('bedrock cannot be broken', () => {
    expect(getBlockDef(BLOCK.BEDROCK).hardness).toBe(Infinity);
  });

  it('hardness table matches vanilla 1.20+ (Task 5)', () => {
    // Vanilla hardness, exact. The break time derived from it lives in
    // interact.ts (hardness × 1.5/×5 ÷ tool speed).
    const expected: ReadonlyArray<readonly [number, number]> = [
      [BLOCK.STONE, 1.5],
      [BLOCK.DIRT, 0.5],
      [BLOCK.GRASS, 0.6],
      [BLOCK.SAND, 0.5],
      [BLOCK.LOG, 2.0],
      [BLOCK.LEAVES, 0.2],
      [BLOCK.PLANKS, 2.0],
      [BLOCK.COBBLE, 2.0],
      [BLOCK.SNOW, 0.2],
      [BLOCK.GLASS, 0.3],
      [BLOCK.COAL_ORE, 3.0],
      [BLOCK.IRON_ORE, 3.0],
      [BLOCK.CRAFTING_TABLE, 2.5],
      [BLOCK.FURNACE, 3.5],
      [BLOCK.BEDROCK, Infinity],
      [BLOCK.WATER, Infinity],
    ];
    for (const [id, hardness] of expected) {
      expect(getBlockDef(id).hardness).toBe(hardness);
    }
  });

  it('requiredTool／fastTool data matches vanilla (Task 5)', () => {
    // requiredTool gates harvesting (pickaxe tier: stone family level 0, iron
    // ore level 1); fastTool only speeds mining up. Air is never dug.
    const expected: ReadonlyArray<readonly [number, BlockDef['requiredTool'], BlockDef['fastTool']]> = [
      [BLOCK.AIR, null, null],
      [BLOCK.STONE, { kind: 'pickaxe', level: 0 }, 'pickaxe'],
      [BLOCK.DIRT, null, 'shovel'],
      [BLOCK.GRASS, null, 'shovel'],
      [BLOCK.SAND, null, 'shovel'],
      [BLOCK.LOG, null, 'axe'],
      [BLOCK.LEAVES, null, null],
      [BLOCK.PLANKS, null, 'axe'],
      [BLOCK.COBBLE, { kind: 'pickaxe', level: 0 }, 'pickaxe'],
      [BLOCK.WATER, null, null],
      [BLOCK.BEDROCK, null, null],
      [BLOCK.SNOW, null, 'shovel'],
      [BLOCK.GLASS, null, null],
      [BLOCK.COAL_ORE, { kind: 'pickaxe', level: 0 }, 'pickaxe'],
      [BLOCK.IRON_ORE, { kind: 'pickaxe', level: 1 }, 'pickaxe'],
      [BLOCK.CRAFTING_TABLE, null, 'axe'],
      [BLOCK.FURNACE, { kind: 'pickaxe', level: 0 }, 'pickaxe'],
    ];
    for (const [id, requiredTool, fastTool] of expected) {
      expect(getBlockDef(id).requiredTool).toEqual(requiredTool);
      expect(getBlockDef(id).fastTool).toBe(fastTool);
    }
    // exhaustive: every registered block id appears above (no silent gaps)
    const byId = (a: number, b: number) => a - b;
    expect(expected.map(([id]) => id).sort(byId)).toEqual([...Object.values(BLOCK)].sort(byId));
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

  it('furnace: id 16, solid, opaque, hardness 3.5, placeable, stone-bottom tiles (Task 6)', () => {
    expect(BLOCK.FURNACE).toBe(16);
    const def = getBlockDef(BLOCK.FURNACE);
    expect(def.name).toBe('furnace');
    expect(def.hardness).toBe(3.5); // vanilla furnace hardness (Task 5 table)
    expect(isSolid(BLOCK.FURNACE)).toBe(true);
    expect(isTransparent(BLOCK.FURNACE)).toBe(false);
    expect(PLACEABLE).toContain(BLOCK.FURNACE);
    expect(def.top).toBe(19); // FURNACE_TOP
    expect(def.side).toBe(20); // FURNACE_SIDE
    expect(def.bottom).toBe(getBlockDef(BLOCK.STONE).top); // stone bottom
    expect(def.top).not.toBe(def.side); // mouth top vs door side
    expect(HOTBAR_DEFAULT).not.toContain(BLOCK.FURNACE); // palette/creative only, not starter
  });
});
