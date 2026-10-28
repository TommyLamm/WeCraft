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
  T,
  TILE_COUNT,
  type BlockDef,
} from './blocks';
import { buildTextureArray, TILE_PX } from '../render/textures';

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
      // B4 Task 1 新增：羊毛 0.8（原版羊毛硬度）
      [BLOCK.WOOL, 0.8],
      // B5 Task 1 新增：礫石 0.6、金礦／鑽石礦 3.0、雲杉／白樺板材 2.0（皆為原版硬度）
      [BLOCK.GRAVEL, 0.6],
      [BLOCK.GOLD_ORE, 3.0],
      [BLOCK.DIAMOND_ORE, 3.0],
      [BLOCK.SPRUCE_PLANKS, 2.0],
      [BLOCK.BIRCH_PLANKS, 2.0],
      // B6 Task 5 新增：火把硬度 0（原版「Torches can be broken instantly using anything」）
      [BLOCK.TORCH, 0],
      // B8 Task 2 新增：箱子硬度 2.5（原版）
      [BLOCK.CHEST, 2.5],
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
      // B4 Task 1 新增：羊毛徒手可挖（不要工具）
      [BLOCK.WOOL, null, null],
      // B5 Task 1 新增：礫石徒手可挖（鏟加速）、金礦／鑽石礦要鐵鎬以上（level 2）、板材用斧
      [BLOCK.GRAVEL, null, 'shovel'],
      [BLOCK.GOLD_ORE, { kind: 'pickaxe', level: 2 }, 'pickaxe'],
      [BLOCK.DIAMOND_ORE, { kind: 'pickaxe', level: 2 }, 'pickaxe'],
      [BLOCK.SPRUCE_PLANKS, null, 'axe'],
      [BLOCK.BIRCH_PLANKS, null, 'axe'],
      // B6 Task 5 新增：火把徒手瞬破（不用工具、無加速工具）
      [BLOCK.TORCH, null, null],
      // B8 Task 2 新增：箱子徒手可挖、斧頭加速
      [BLOCK.CHEST, null, 'axe'],
    ];
    for (const [id, requiredTool, fastTool] of expected) {
      expect(getBlockDef(id).requiredTool).toEqual(requiredTool);
      expect(getBlockDef(id).fastTool).toBe(fastTool);
    }
    // exhaustive: every registered block id appears above (no silent gaps)
    const byId = (a: number, b: number) => a - b;
    expect(expected.map(([id]) => id).sort(byId)).toEqual([...Object.values(BLOCK)].sort(byId));
  });

  it('the chest block matches the vanilla hardness and tool rules', () => {
    const def = getBlockDef(BLOCK.CHEST);
    expect(def.hardness).toBe(2.5);
    expect(def.requiredTool).toBeNull();   // 徒手也能挖掉並掉落
    expect(def.fastTool).toBe('axe');
    expect(def.solid).toBe(true);
    expect(def.transparent).toBe(false);
    expect(def.top).toBe(def.side);
    expect(def.bottom).toBe(def.top);
    expect(PLACEABLE).toContain(BLOCK.CHEST);
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

  it('the torch is targetable so it can be aimed at and mined (B6 Task 6)', () => {
    // T5 中間態收口：isTargetable(TORCH) 原為 false（!solid && shape !== 'cross'）
    // → 射線穿過火把、挖不掉。火把跟植被一樣「不碰撞但要能被挖掉」。
    expect(isTargetable(BLOCK.TORCH)).toBe(true);
  });

  // ---- B4 Task 1：羊毛方塊（跨批編號：BLOCK.WOOL = 26 / T.WOOL = 33）----

  it('wool: id 26, solid, opaque, hardness 0.8, placeable', () => {
    expect(BLOCK.WOOL).toBe(26);
    const def = getBlockDef(BLOCK.WOOL);
    expect(def.id).toBe(26);
    expect(def.name).toBe('wool');
    expect(def.hardness).toBe(0.8); // 原版羊毛硬度
    expect(def.solid).toBe(true);
    expect(def.transparent).toBe(false);
    expect(def.requiredTool).toBeNull();
    expect(def.fastTool).toBeNull();
    expect(PLACEABLE).toContain(BLOCK.WOOL);
    // 三個面共用同一個羊毛 tile（跨批編號：T.WOOL = 33 → TILE_COUNT = 34）
    expect(def.top).toBe(33);
    expect(def.side).toBe(33);
    expect(def.bottom).toBe(33);
    // `TILE_COUNT` 是「最高 tile ＋ 1」→ 會隨新批次成長（B5 之後 = 39），
    // 所以這裡只用相對斷言（B3 Task 3 在 textures.test.ts 的同一套寫法）：
    // 羊毛的 tile 33 **本身不變**，且仍在已宣告的 tile 範圍內。
    // B5 的絕對值（39）由本批自己的測試把關。
    expect(TILE_COUNT).toBeGreaterThan(def.top);
  });

  it('the wool tile 33 is painted (never the magenta debug layer)', () => {
    // 既有 'every non-air block has valid tile indices' 只檢查 0 ≤ t < 64 → 抓不到
    // 「宣告了 tile 33 卻沒畫」（漏畫會得到洋紅除錯色層，卻沒有任何測試紅）。
    // B3 的通則測試（textures.test.ts 的 'every declared tile is painted'）也涵蓋
    // 這一層；本批自己再釘一次 → 失敗時能直接看出是羊毛的圖樣沒畫。
    const data = buildTextureArray().image.data as Uint8Array;
    let magenta = 0;
    let painted = 0;
    for (let p = 0; p < TILE_PX * TILE_PX; p++) {
      const i = (33 * TILE_PX * TILE_PX + p) * 4;
      if (data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 255) magenta++;
      if (data[i + 3] > 0) painted++;
    }
    expect(magenta, 'tile 33 magenta').toBeLessThan(TILE_PX * TILE_PX);
    expect(painted, 'tile 33 painted').toBeGreaterThan(0);
  });

  // ---- B5 Task 1：礫石／金礦／鑽石礦／雲杉板材／白樺板材 ----
  // 跨批編號：本批 = 27–31（tile 34–38）。同樣只能往後追加——舊存檔的
  // `modified` 記的是數字 id，重編號會讓舊存檔的方塊全部變形。

  it('the B5 blocks keep their ids and vanilla hardness', () => {
    expect(BLOCK.GRAVEL).toBe(27);
    expect(BLOCK.GOLD_ORE).toBe(28);
    expect(BLOCK.DIAMOND_ORE).toBe(29);
    expect(BLOCK.SPRUCE_PLANKS).toBe(30);
    expect(BLOCK.BIRCH_PLANKS).toBe(31);

    expect(getBlockDef(BLOCK.GRAVEL).hardness).toBe(0.6);
    expect(getBlockDef(BLOCK.GOLD_ORE).hardness).toBe(3.0);
    expect(getBlockDef(BLOCK.DIAMOND_ORE).hardness).toBe(3.0);
    expect(getBlockDef(BLOCK.SPRUCE_PLANKS).hardness).toBe(2.0);
    expect(getBlockDef(BLOCK.BIRCH_PLANKS).hardness).toBe(2.0);

    // BlockDef 的三個必填欄位（`name` 與三面 tile）：值即跨任務交接的介面
    const names: ReadonlyArray<readonly [number, string]> = [
      [BLOCK.GRAVEL, 'gravel'],
      [BLOCK.GOLD_ORE, 'gold_ore'],
      [BLOCK.DIAMOND_ORE, 'diamond_ore'],
      [BLOCK.SPRUCE_PLANKS, 'spruce_planks'],
      [BLOCK.BIRCH_PLANKS, 'birch_planks'],
    ];
    for (const [id, name] of names) {
      const def = getBlockDef(id);
      expect(def.id).toBe(id);
      expect(def.name).toBe(name);
      expect(def.solid).toBe(true);
      expect(def.transparent).toBe(false);
      expect(def.shape).toBe('cube');
      expect(def.top).toBe(def.side); // 三個面共用同一個 tile
      expect(def.side).toBe(def.bottom);
    }
  });

  it('the new blocks carry the vanilla harvest gates', () => {
    expect(getBlockDef(BLOCK.GOLD_ORE).requiredTool).toEqual({ kind: 'pickaxe', level: 2 });
    expect(getBlockDef(BLOCK.DIAMOND_ORE).requiredTool).toEqual({ kind: 'pickaxe', level: 2 });
    expect(getBlockDef(BLOCK.GRAVEL).requiredTool).toBeNull();
    expect(getBlockDef(BLOCK.GRAVEL).fastTool).toBe('shovel');
    expect(getBlockDef(BLOCK.SPRUCE_PLANKS).fastTool).toBe('axe');
    expect(getBlockDef(BLOCK.BIRCH_PLANKS).fastTool).toBe('axe');
    expect(getBlockDef(BLOCK.GOLD_ORE).fastTool).toBe('pickaxe');
    expect(getBlockDef(BLOCK.DIAMOND_ORE).fastTool).toBe('pickaxe');
    // 板材沒有採掘門檻（原版徒手可挖，只是慢）
    expect(getBlockDef(BLOCK.SPRUCE_PLANKS).requiredTool).toBeNull();
    expect(getBlockDef(BLOCK.BIRCH_PLANKS).requiredTool).toBeNull();
  });

  it('the B5 tiles are appended after the wool tile and grow TILE_COUNT', () => {
    // tile 索引只能往後追加（與 block id 同一條規則）
    expect(getBlockDef(BLOCK.GRAVEL).top).toBe(34);
    expect(getBlockDef(BLOCK.GOLD_ORE).top).toBe(35);
    expect(getBlockDef(BLOCK.DIAMOND_ORE).top).toBe(36);
    expect(getBlockDef(BLOCK.SPRUCE_PLANKS).top).toBe(37);
    expect(getBlockDef(BLOCK.BIRCH_PLANKS).top).toBe(38);
    // TILE_COUNT ＝ 最高 tile ＋ 1（不變式）。B8 的箱子 tile 接在火把後面成為
    // 新的最高 → 絕對值 41；由「the chest tile is the last declared tile」把關。
    expect(TILE_COUNT).toBe(getBlockDef(BLOCK.CHEST).top + 1);
    expect(TILE_COUNT).toBeGreaterThan(getBlockDef(BLOCK.BIRCH_PLANKS).top);
  });

  it('no two blocks share an id', () => {
    const ids = Object.values(BLOCK);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the pre-B3 block ids are unchanged', () => {
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

  it('the B5 block ids are appended, never renumbered', () => {
    expect(BLOCK.GRAVEL).toBeGreaterThan(16);
    expect(BLOCK.GOLD_ORE).toBeGreaterThan(BLOCK.GRAVEL);
    expect(BLOCK.DIAMOND_ORE).toBeGreaterThan(BLOCK.GOLD_ORE);
    expect(BLOCK.SPRUCE_PLANKS).toBeGreaterThan(BLOCK.DIAMOND_ORE);
    expect(BLOCK.BIRCH_PLANKS).toBeGreaterThan(BLOCK.SPRUCE_PLANKS);
    // B1–B4 已用過的 id 不得被本批挪動
    expect(BLOCK.WOOL).toBe(26);
  });

  it('the new blocks are placeable', () => {
    expect(PLACEABLE).toContain(BLOCK.GOLD_ORE);
    expect(PLACEABLE).toContain(BLOCK.DIAMOND_ORE);
    expect(PLACEABLE).toContain(BLOCK.GRAVEL);
    expect(PLACEABLE).toContain(BLOCK.SPRUCE_PLANKS);
    expect(PLACEABLE).toContain(BLOCK.BIRCH_PLANKS);
  });

  // ---- B6 Task 5：火把（跨批編號：BLOCK.TORCH = 32 / T.TORCH = 39）----
  // id 與 tile 都只能往後追加——舊存檔的 `modified` 記的是數字 id，重編號會讓
  // 舊存檔的方塊全部變形。原版數值（minecraft.wiki/Torch，2026-10-20）：硬度 0、
  // 非實心、透明、光照 14。

  it('the torch is id 32, non solid, transparent and emits 14', () => {
    expect(BLOCK.TORCH).toBe(32);
    const def = getBlockDef(BLOCK.TORCH);
    expect(def.id).toBe(32);
    expect(def.name).toBe('torch');
    expect(def.hardness).toBe(0); // 瞬破（任何工具／徒手）
    expect(def.solid).toBe(false); // 非實心（不碰撞）
    expect(def.transparent).toBe(true); // 透明（不遮光、不擋鄰面）
    expect(def.requiredTool).toBeNull();
    expect(def.fastTool).toBeNull();
    expect(def.emission).toBe(14); // 「Torches give off a light level of 14.」
    expect(def.shape).toBe('torch'); // 小型無碰撞模型（mesher pass 屬 Task 6）
    // 三個面共用火把 tile
    expect(def.top).toBe(T.TORCH);
    expect(def.side).toBe(T.TORCH);
    expect(def.bottom).toBe(T.TORCH);
    // 可放置（創造清單以 PLACEABLE 為 Palette）；不進 HOTBAR_DEFAULT——火把是
    // 做出來的（煤＋木棍），不是初始物品
    expect(PLACEABLE).toContain(BLOCK.TORCH);
    expect(HOTBAR_DEFAULT).not.toContain(BLOCK.TORCH);
  });

  it('the chest tile is the last declared tile', () => {
    // 不綁死數字：上游 tile 表變動不會誤報；T.CHEST 的絕對值（40）由跨批編號表
    // 與下面的撞號檢查一起把關。
    expect(T.CHEST).toBe(TILE_COUNT - 1);
    expect(TILE_COUNT).toBeLessThanOrEqual(64); // 紋理陣列 64 層
  });

  it('the torch tile does not collide with the chest tile', () => {
    // B8 的 T.CHEST = 40（跨批編號表）→ 火把接 39，不得撞號
    // （撞號 = 箱子被渲染成火把，且「the torch tile is the last declared tile」
    // 這條相對斷言抓不到跨批撞號，所以要另外釘）。
    expect(T.TORCH).not.toBe(40);
  });
});
