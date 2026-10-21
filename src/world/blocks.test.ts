import { describe, it, expect } from 'vitest';
import {
  BLOCK,
  getBlockDef,
  isSolid,
  isTransparent,
  isCross,
  isTargetable,
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
      // B3 Task 3 新增的三樹種（雲杉／白樺）：數值與既有橡木一致
      [BLOCK.SPRUCE_LOG, 2.0],
      [BLOCK.SPRUCE_LEAVES, 0.2],
      [BLOCK.BIRCH_LOG, 2.0],
      [BLOCK.BIRCH_LEAVES, 0.2],
      // B3 Task 4 新增：花／草硬度 0（原版可徒手瞬間挖掉）、仙人掌 0.4、冰 0.5
      [BLOCK.DANDELION, 0],
      [BLOCK.POPPY, 0],
      [BLOCK.SHORT_GRASS, 0],
      [BLOCK.CACTUS, 0.4],
      [BLOCK.ICE, 0.5],
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
      // B3 Task 3 新增的三樹種：原木用斧頭、葉子不用工具
      [BLOCK.SPRUCE_LOG, null, 'axe'],
      [BLOCK.SPRUCE_LEAVES, null, null],
      [BLOCK.BIRCH_LOG, null, 'axe'],
      [BLOCK.BIRCH_LEAVES, null, null],
      // B3 Task 4 新增：花／草不用工具、仙人掌不用工具（徒手可挖）、冰要鎬但沒有門檻
      [BLOCK.DANDELION, null, null],
      [BLOCK.POPPY, null, null],
      [BLOCK.SHORT_GRASS, null, null],
      [BLOCK.CACTUS, null, null],
      [BLOCK.ICE, null, 'pickaxe'],
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

  // B3 Task 3：新增雲杉／白樺方塊。id 只能往後追加——舊存檔的 `modified`
  // 記的是數字 id，重編號會讓舊存檔的方塊全部變形。
  it('the new wood blocks keep their ids and vanilla hardness', () => {
    expect(BLOCK.SPRUCE_LOG).toBe(17);
    expect(BLOCK.SPRUCE_LEAVES).toBe(18);
    expect(BLOCK.BIRCH_LOG).toBe(19);
    expect(BLOCK.BIRCH_LEAVES).toBe(20);

    expect(getBlockDef(BLOCK.SPRUCE_LOG).hardness).toBe(2.0);
    expect(getBlockDef(BLOCK.SPRUCE_LEAVES).hardness).toBe(0.2);
    expect(getBlockDef(BLOCK.BIRCH_LOG).hardness).toBe(2.0);
    expect(getBlockDef(BLOCK.BIRCH_LEAVES).hardness).toBe(0.2);

    // 原木不透明、葉子半透明（與既有橡木一致）
    expect(isTransparent(BLOCK.SPRUCE_LEAVES)).toBe(true);
    expect(isTransparent(BLOCK.BIRCH_LEAVES)).toBe(true);
    expect(isTransparent(BLOCK.SPRUCE_LOG)).toBe(false);
    expect(isTransparent(BLOCK.BIRCH_LOG)).toBe(false);
    expect(isSolid(BLOCK.SPRUCE_LOG)).toBe(true);
    expect(isSolid(BLOCK.BIRCH_LEAVES)).toBe(true);

    // 物品形式在本批補上 → 四個新方塊都可放（創造清單以 PLACEABLE 為 Palette）
    for (const id of [BLOCK.SPRUCE_LOG, BLOCK.SPRUCE_LEAVES, BLOCK.BIRCH_LOG, BLOCK.BIRCH_LEAVES]) {
      expect(PLACEABLE, `block ${id} is not placeable`).toContain(id);
    }
    // 各自的正面／側面／頂面 tile 不可共用（否則三種木頭看起來一樣）
    expect(getBlockDef(BLOCK.SPRUCE_LOG).side).not.toBe(getBlockDef(BLOCK.BIRCH_LOG).side);
    expect(getBlockDef(BLOCK.SPRUCE_LEAVES).side).not.toBe(getBlockDef(BLOCK.BIRCH_LEAVES).side);
  });

  it('existing block ids are unchanged', () => {
    // 既有 0–16 的 id 不得重編（舊存檔靠數字 id 認方塊）
    expect(BLOCK.AIR).toBe(0);
    expect(BLOCK.STONE).toBe(1);
    expect(BLOCK.DIRT).toBe(2);
    expect(BLOCK.GRASS).toBe(3);
    expect(BLOCK.SAND).toBe(4);
    expect(BLOCK.LOG).toBe(5);
    expect(BLOCK.LEAVES).toBe(6);
    expect(BLOCK.PLANKS).toBe(7);
    expect(BLOCK.COBBLE).toBe(8);
    expect(BLOCK.WATER).toBe(9);
    expect(BLOCK.BEDROCK).toBe(10);
    expect(BLOCK.SNOW).toBe(11);
    expect(BLOCK.GLASS).toBe(12);
    expect(BLOCK.COAL_ORE).toBe(13);
    expect(BLOCK.IRON_ORE).toBe(14);
    expect(BLOCK.CRAFTING_TABLE).toBe(15);
    expect(BLOCK.FURNACE).toBe(16);
  });

  // ---- B3 Task 4：cross 型方塊（花／草）＋仙人掌／冰 ----

  it('the new blocks have the pinned ids and vanilla hardness', () => {
    // id 只能往後追加（舊存檔的 `modified` 記的是數字 id）
    expect(BLOCK.DANDELION).toBe(21);
    expect(BLOCK.POPPY).toBe(22);
    expect(BLOCK.SHORT_GRASS).toBe(23);
    expect(BLOCK.CACTUS).toBe(24);
    expect(BLOCK.ICE).toBe(25);

    // 硬度 0 = 瞬破（原版花／草可以徒手瞬間挖掉）；仙人掌 0.4、冰 0.5 為原版數值
    expect(getBlockDef(BLOCK.DANDELION).hardness).toBe(0);
    expect(getBlockDef(BLOCK.POPPY).hardness).toBe(0);
    expect(getBlockDef(BLOCK.SHORT_GRASS).hardness).toBe(0);
    expect(getBlockDef(BLOCK.CACTUS).hardness).toBe(0.4);
    expect(getBlockDef(BLOCK.ICE).hardness).toBe(0.5);

    // 物品形式在本批補上 → 五個新方塊都可放（創造清單以 PLACEABLE 為 Palette）
    for (const id of [BLOCK.DANDELION, BLOCK.POPPY, BLOCK.SHORT_GRASS, BLOCK.CACTUS, BLOCK.ICE]) {
      expect(PLACEABLE, `block ${id} is not placeable`).toContain(id);
    }
  });

  it('plants are cross shaped and non solid', () => {
    expect(getBlockDef(BLOCK.DANDELION).shape).toBe('cross');
    expect(getBlockDef(BLOCK.DANDELION).solid).toBe(false);
    expect(getBlockDef(BLOCK.DANDELION).transparent).toBe(true);
    expect(getBlockDef(BLOCK.POPPY).shape).toBe('cross');
    expect(getBlockDef(BLOCK.SHORT_GRASS).shape).toBe('cross');
    expect(getBlockDef(BLOCK.CACTUS).shape).toBe('cube');
    expect(getBlockDef(BLOCK.CACTUS).solid).toBe(true);
    expect(getBlockDef(BLOCK.ICE).shape).toBe('cube');
    expect(getBlockDef(BLOCK.ICE).solid).toBe(true);

    expect(isCross(BLOCK.DANDELION)).toBe(true);
    expect(isCross(BLOCK.POPPY)).toBe(true);
    expect(isCross(BLOCK.SHORT_GRASS)).toBe(true);
    expect(isCross(BLOCK.CACTUS)).toBe(false);
    expect(isCross(BLOCK.ICE)).toBe(false);
  });

  it('every block before the cross ones keeps the cube shape', () => {
    // 既有 0–20 全部是立方體（cross 是 B3 Task 4 新增的形狀）
    for (let id = 0; id <= 20; id++) {
      expect(getBlockDef(id).shape, `block ${id} shape`).toBe('cube');
    }
  });

  it('targetable covers solids and cross plants', () => {
    expect(isTargetable(BLOCK.STONE)).toBe(true);
    expect(isTargetable(BLOCK.DANDELION)).toBe(true);
    expect(isTargetable(BLOCK.WATER)).toBe(false);
    expect(isTargetable(BLOCK.AIR)).toBe(false);
  });
});
