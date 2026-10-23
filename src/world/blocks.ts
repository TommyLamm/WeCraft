/** Block ids. **The ids may only be appended, never renumbered** — an existing
 *  world's save stores raw numeric ids in `modified`, so moving an id morphs
 *  every already-placed block of that type. (Batches claim their ids up front:
 *  B3 = 17–25, B4 = 26, B5 = 27–31, B6 火把 = 32, B8 箱子 = 33.) */
export const BLOCK = {
  AIR: 0,
  STONE: 1,
  DIRT: 2,
  GRASS: 3,
  SAND: 4,
  LOG: 5,
  LEAVES: 6,
  PLANKS: 7,
  COBBLE: 8,
  WATER: 9,
  BEDROCK: 10,
  SNOW: 11,
  GLASS: 12,
  COAL_ORE: 13,
  IRON_ORE: 14,
  CRAFTING_TABLE: 15,
  FURNACE: 16,
  // B3 Task 3：三樹種（橡木／雲杉／白樺）。id 只能往後追加——舊存檔的
  // `modified` 記的是數字 id，重編號會讓舊存檔的方塊全部變形。
  SPRUCE_LOG: 17,
  SPRUCE_LEAVES: 18,
  BIRCH_LOG: 19,
  BIRCH_LEAVES: 20,
  // B3 Task 4：cross 型植被（花／草）＋仙人掌／冰。同樣只能往後追加。
  DANDELION: 21,
  POPPY: 22,
  SHORT_GRASS: 23,
  CACTUS: 24,
  ICE: 25,
  // B4 Task 1：羊毛（跨批編號表：本批 = 26；B5 用 27–31、B6 火把 = 32、B8 箱子 = 33）。
  // 同樣只能往後追加——舊存檔的 `modified` 記的是數字 id，重編號會讓舊存檔變形。
  WOOL: 26,
  // B5 Task 1：礫石／金礦／鑽石礦／雲杉板材／白樺板材（跨批編號表：本批 = 27–31）。
  // 同樣只能往後追加——舊存檔的 `modified` 記的是數字 id，重編號會讓舊存檔變形。
  GRAVEL: 27,
  GOLD_ORE: 28,
  DIAMOND_ORE: 29,
  SPRUCE_PLANKS: 30,
  BIRCH_PLANKS: 31,
} as const;

export type BlockId = (typeof BLOCK)[keyof typeof BLOCK];

/** 方塊的幾何形狀：`cube` 是滿格的立方體；`cross` 是原版花／草那種
 *  「兩片對角平面」的十字模型（不碰撞、不遮擋、單獨一條 foliage pass 渲染）。
 *  幾何細節與「與原版內縮模型的差異」見 `mesher.ts` 的 `emitCrossQuads`。 */
export type BlockShape = 'cube' | 'cross';

/** Tool families. Only pickaxe/axe exist as items today (`ItemId` has no
 *  shovel), so shovel-fast blocks currently mine at bare-hand speed. */
export type ToolKind = 'pickaxe' | 'axe' | 'shovel';

export interface BlockDef {
  id: BlockId;
  name: string;
  hardness: number; // 原版硬度；破壞秒數＝硬度 ×1.5/×5 ÷ 工具速度（interact.ts）。Infinity = 不可破壞
  solid: boolean;
  transparent: boolean;
  /** 幾何形狀（B3 Task 4）：`cube` 滿格立方體；`cross` 是花／草的十字模型。 */
  shape: BlockShape;
  top: number; // 圖集 tile 索引 0..63
  side: number;
  bottom: number;
  /** Harvest gate (Task 5): the tool kind + minimum tier needed to harvest
   *  this block. `null` = no requirement (harvestable bare-handed). */
  requiredTool: { kind: ToolKind; level: number } | null;
  /** Kind that mines this block faster (`interact.ts` `toolSpeed`); `null` =
   *  no fast tool. Never a gate — the block breaks either way. */
  fastTool: ToolKind | null;
  /** 光照發射等級（B6 光照引擎）：0..15，未列＝0。引擎一律經
   *  `getBlockDef(id).emission ?? 0` 讀取（原版火把 = 14，Task 5 落地）。 */
  emission?: number;
}

const T = {
  GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3,
  SAND: 4, LOG_SIDE: 5, LOG_TOP: 6, LEAVES: 7,
  PLANKS: 8, COBBLE: 9, WATER: 10, BEDROCK: 11,
  SNOW_TOP: 12, SNOW_SIDE: 13, GLASS: 14,
  COAL: 15, IRON: 16,
  CRAFTING_TOP: 17, CRAFTING_SIDE: 18,
  FURNACE_TOP: 19, FURNACE_SIDE: 20,
  // B3 Task 3：雲杉／白樺的六個 tile（跨批編號：B3 用 21–26）
  SPRUCE_LOG_SIDE: 21, SPRUCE_LOG_TOP: 22, SPRUCE_LEAVES: 23,
  BIRCH_LOG_SIDE: 24, BIRCH_LOG_TOP: 25, BIRCH_LEAVES: 26,
  // B3 Task 4：花／草／仙人掌／冰的六個 tile（跨批編號：B3 用 21–32）
  DANDELION: 27, POPPY: 28, SHORT_GRASS: 29,
  CACTUS_SIDE: 30, CACTUS_TOP: 31, ICE: 32,
  // B4 Task 1：羊毛（跨批編號：本批 = 33 → TILE_COUNT = 34；B5 用 34–38）
  WOOL: 33,
  // B5 Task 1：礫石／金礦／鑽石礦／雲杉板材／白樺板材（跨批編號：本批 = 34–38 → TILE_COUNT = 39；
  // 下一批從 39 起）。同樣只能往後追加——tile 索引是「哪一格貼圖」的唯一鑰匙。
  GRAVEL: 34, GOLD_ORE: 35, DIAMOND_ORE: 36, SPRUCE_PLANKS: 37, BIRCH_PLANKS: 38,
} as const;

/** Tiles `T` defines (0..TILE_COUNT-1) — `BIRCH_PLANKS` is the highest tile.
 *  drawAtlas paints exactly these; the texture array fills every layer past
 *  them with the magenta debug color, so adding a tile to T without drawing it
 *  fails loudly instead of silently sampling magenta in-game. */
export const TILE_COUNT = T.BIRCH_PLANKS + 1;

/** Block registry (Task 5): vanilla hardness (MC Java 1.20+) plus, per block,
 *  the harvest gate (`requiredTool`) and the fast kind (`fastTool`) that feeds
 *  `interact.ts`'s break-time formula. The derived seconds live only in
 *  `interact.ts` — hardness here is the raw vanilla number, not a duration. */
const DEFS: Record<number, BlockDef> = {
  0: { id: 0, name: 'air', hardness: 0, solid: false, transparent: true, shape: 'cube', top: 0, side: 0, bottom: 0, requiredTool: null, fastTool: null },
  1: { id: 1, name: 'stone', hardness: 1.5, solid: true, transparent: false, shape: 'cube', top: T.STONE, side: T.STONE, bottom: T.STONE, requiredTool: { kind: 'pickaxe', level: 0 }, fastTool: 'pickaxe' },
  2: { id: 2, name: 'dirt', hardness: 0.5, solid: true, transparent: false, shape: 'cube', top: T.DIRT, side: T.DIRT, bottom: T.DIRT, requiredTool: null, fastTool: 'shovel' },
  3: { id: 3, name: 'grass_block', hardness: 0.6, solid: true, transparent: false, shape: 'cube', top: T.GRASS_TOP, side: T.GRASS_SIDE, bottom: T.DIRT, requiredTool: null, fastTool: 'shovel' },
  4: { id: 4, name: 'sand', hardness: 0.5, solid: true, transparent: false, shape: 'cube', top: T.SAND, side: T.SAND, bottom: T.SAND, requiredTool: null, fastTool: 'shovel' },
  5: { id: 5, name: 'oak_log', hardness: 2.0, solid: true, transparent: false, shape: 'cube', top: T.LOG_TOP, side: T.LOG_SIDE, bottom: T.LOG_TOP, requiredTool: null, fastTool: 'axe' },
  6: { id: 6, name: 'oak_leaves', hardness: 0.2, solid: true, transparent: true, shape: 'cube', top: T.LEAVES, side: T.LEAVES, bottom: T.LEAVES, requiredTool: null, fastTool: null },
  7: { id: 7, name: 'oak_planks', hardness: 2.0, solid: true, transparent: false, shape: 'cube', top: T.PLANKS, side: T.PLANKS, bottom: T.PLANKS, requiredTool: null, fastTool: 'axe' },
  8: { id: 8, name: 'cobblestone', hardness: 2.0, solid: true, transparent: false, shape: 'cube', top: T.COBBLE, side: T.COBBLE, bottom: T.COBBLE, requiredTool: { kind: 'pickaxe', level: 0 }, fastTool: 'pickaxe' },
  9: { id: 9, name: 'water', hardness: Infinity, solid: false, transparent: true, shape: 'cube', top: T.WATER, side: T.WATER, bottom: T.WATER, requiredTool: null, fastTool: null },
  10: { id: 10, name: 'bedrock', hardness: Infinity, solid: true, transparent: false, shape: 'cube', top: T.BEDROCK, side: T.BEDROCK, bottom: T.BEDROCK, requiredTool: null, fastTool: null },
  11: { id: 11, name: 'snow_block', hardness: 0.2, solid: true, transparent: false, shape: 'cube', top: T.SNOW_TOP, side: T.SNOW_SIDE, bottom: T.DIRT, requiredTool: null, fastTool: 'shovel' },
  12: { id: 12, name: 'glass', hardness: 0.3, solid: true, transparent: true, shape: 'cube', top: T.GLASS, side: T.GLASS, bottom: T.GLASS, requiredTool: null, fastTool: null },
  13: { id: 13, name: 'coal_ore', hardness: 3.0, solid: true, transparent: false, shape: 'cube', top: T.COAL, side: T.COAL, bottom: T.COAL, requiredTool: { kind: 'pickaxe', level: 0 }, fastTool: 'pickaxe' },
  14: { id: 14, name: 'iron_ore', hardness: 3.0, solid: true, transparent: false, shape: 'cube', top: T.IRON, side: T.IRON, bottom: T.IRON, requiredTool: { kind: 'pickaxe', level: 1 }, fastTool: 'pickaxe' },
  15: { id: 15, name: 'crafting_table', hardness: 2.5, solid: true, transparent: false, shape: 'cube', top: T.CRAFTING_TOP, side: T.CRAFTING_SIDE, bottom: T.PLANKS, requiredTool: null, fastTool: 'axe' },
  16: { id: 16, name: 'furnace', hardness: 3.5, solid: true, transparent: false, shape: 'cube', top: T.FURNACE_TOP, side: T.FURNACE_SIDE, bottom: T.STONE, requiredTool: { kind: 'pickaxe', level: 0 }, fastTool: 'pickaxe' },
  // B3 Task 3：雲杉／白樺。硬度沿用原版數值（與既有橡木一致）。
  17: { id: 17, name: 'spruce_log', hardness: 2.0, solid: true, transparent: false, shape: 'cube', top: T.SPRUCE_LOG_TOP, side: T.SPRUCE_LOG_SIDE, bottom: T.SPRUCE_LOG_TOP, requiredTool: null, fastTool: 'axe' },
  18: { id: 18, name: 'spruce_leaves', hardness: 0.2, solid: true, transparent: true, shape: 'cube', top: T.SPRUCE_LEAVES, side: T.SPRUCE_LEAVES, bottom: T.SPRUCE_LEAVES, requiredTool: null, fastTool: null },
  19: { id: 19, name: 'birch_log', hardness: 2.0, solid: true, transparent: false, shape: 'cube', top: T.BIRCH_LOG_TOP, side: T.BIRCH_LOG_SIDE, bottom: T.BIRCH_LOG_TOP, requiredTool: null, fastTool: 'axe' },
  20: { id: 20, name: 'birch_leaves', hardness: 0.2, solid: true, transparent: true, shape: 'cube', top: T.BIRCH_LEAVES, side: T.BIRCH_LEAVES, bottom: T.BIRCH_LEAVES, requiredTool: null, fastTool: null },
  // B3 Task 4：花／草是 cross 型（不碰撞、不遮擋、硬度 0 → 徒手瞬破）；
  // 仙人掌與冰是滿格立方體（硬度 0.4／0.5 為原版數值）。
  // 冰的 `transparent: true` 副作用（與玻璃同一級）寫在下方 **ICE 條目**旁邊。
  21: { id: 21, name: 'dandelion', hardness: 0, solid: false, transparent: true, shape: 'cross', top: T.DANDELION, side: T.DANDELION, bottom: T.DANDELION, requiredTool: null, fastTool: null },
  22: { id: 22, name: 'poppy', hardness: 0, solid: false, transparent: true, shape: 'cross', top: T.POPPY, side: T.POPPY, bottom: T.POPPY, requiredTool: null, fastTool: null },
  23: { id: 23, name: 'short_grass', hardness: 0, solid: false, transparent: true, shape: 'cross', top: T.SHORT_GRASS, side: T.SHORT_GRASS, bottom: T.SHORT_GRASS, requiredTool: null, fastTool: null },
  24: { id: 24, name: 'cactus', hardness: 0.4, solid: true, transparent: false, shape: 'cube', top: T.CACTUS_TOP, side: T.CACTUS_SIDE, bottom: T.CACTUS_TOP, requiredTool: null, fastTool: null },
  // 冰（B3 Task 4）的 `transparent: true` 副作用（與玻璃同一級）：冰走**不透明
  // pass**，材質沒有 `transparent`／`opacity` → **看不穿冰面**（冰面是不透明的淡藍
  // 白），而且冰**不遮擋 AO**（鄰面不會因冰而變暗）。冰面**會**被相鄰的**不透明**
  // 方塊遮掉：`faceVisible(id, neighbor)` 在鄰居不透明時回 false → 該面被剔除
  // （冰貼著石頭時，冰朝石頭的那一面不畫；與玻璃同一級）。
  // 若之後要做「半透明、可看穿」的冰，需要獨立的透明 pass 或 `opacity` 材質
  // → 不在本批。
  //
  // **已知現象（B3 Task 6 記錄，待批次末驗收）**：冰會**取代水面頂端那一格**
  // （`decorations.ts` 的結冰規則）→ 冰塊（transparent）緊貼著下方的水
  // （transparent）→ `mesher.ts` 的 `faceVisible` 兩邊都判定「鄰居透明 → 畫」，
  // 於是**冰的底面與水的頂面在同一個平面上各發出一片**。水材質 `depthWrite: false`
  // → 比較可能呈現「水色疊加」而不是閃爍，但**水下視角的外觀尚未驗收**
  // → 列入批次末瀏覽器驗收的待驗項；要根治需要獨立的透明 pass（渲染層改動，
  // 不在本批範圍）。
  25: { id: 25, name: 'ice', hardness: 0.5, solid: true, transparent: true, shape: 'cube', top: T.ICE, side: T.ICE, bottom: T.ICE, requiredTool: null, fastTool: 'pickaxe' },
  // B4 Task 1：羊毛（硬度 0.8 = 原版羊毛硬度；徒手可挖 → 不需要工具）。
  // 羊毛**不進世界生成**（原版羊毛也不自然生成，只來自羊與剪毛）。
  26: { id: 26, name: 'wool', hardness: 0.8, solid: true, transparent: false, shape: 'cube', top: T.WOOL, side: T.WOOL, bottom: T.WOOL, requiredTool: null, fastTool: null },
  // B5 Task 1：礫石／金礦／鑽石礦／雲杉板材／白樺板材。
  // 硬度與工具的採掘門檻／加速都用原版數值（Java 1.20+）：
  //  - 礫石 0.6、徒手可挖，鏟加速；
  //  - 金礦／鑽石礦 3.0，**鐵鎬以上（level 2）才收穫**（石鎬挖得到但不會掉東西），鎬加速；
  //  - 兩種板材 2.0、徒手可挖，斧加速（與橡木板材同一級）。
  27: { id: 27, name: 'gravel', hardness: 0.6, solid: true, transparent: false, shape: 'cube', top: T.GRAVEL, side: T.GRAVEL, bottom: T.GRAVEL, requiredTool: null, fastTool: 'shovel' },
  28: { id: 28, name: 'gold_ore', hardness: 3.0, solid: true, transparent: false, shape: 'cube', top: T.GOLD_ORE, side: T.GOLD_ORE, bottom: T.GOLD_ORE, requiredTool: { kind: 'pickaxe', level: 2 }, fastTool: 'pickaxe' },
  29: { id: 29, name: 'diamond_ore', hardness: 3.0, solid: true, transparent: false, shape: 'cube', top: T.DIAMOND_ORE, side: T.DIAMOND_ORE, bottom: T.DIAMOND_ORE, requiredTool: { kind: 'pickaxe', level: 2 }, fastTool: 'pickaxe' },
  30: { id: 30, name: 'spruce_planks', hardness: 2.0, solid: true, transparent: false, shape: 'cube', top: T.SPRUCE_PLANKS, side: T.SPRUCE_PLANKS, bottom: T.SPRUCE_PLANKS, requiredTool: null, fastTool: 'axe' },
  31: { id: 31, name: 'birch_planks', hardness: 2.0, solid: true, transparent: false, shape: 'cube', top: T.BIRCH_PLANKS, side: T.BIRCH_PLANKS, bottom: T.BIRCH_PLANKS, requiredTool: null, fastTool: 'axe' },
};

export function getBlockDef(id: number): BlockDef {
  return DEFS[id] ?? DEFS[0];
}

export const isSolid = (id: number): boolean => getBlockDef(id).solid;
export const isTransparent = (id: number): boolean => getBlockDef(id).transparent;
/** cross 型方塊（花／草）：渲染成兩片對角平面，不佔滿格。 */
export const isCross = (id: number): boolean => getBlockDef(id).shape === 'cross';
/** 可被「瞄準／挖掘」命中的方塊：實心方塊 ＋ cross 植被。
 *  植被不碰撞（`solid` 為 false），但玩家要能挖掉它 → 命中判定看 shape。 */
export const isTargetable = (id: number): boolean => {
  const def = getBlockDef(id);
  return def.solid || def.shape === 'cross';
};

export const PLACEABLE: BlockId[] = [
  BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.COBBLE, BLOCK.PLANKS,
  BLOCK.LOG, BLOCK.LEAVES, BLOCK.SAND, BLOCK.GLASS, BLOCK.SNOW,
  BLOCK.BEDROCK, BLOCK.COAL_ORE, BLOCK.IRON_ORE, BLOCK.CRAFTING_TABLE, BLOCK.FURNACE,
  // B3 Task 3：雲杉／白樺的方塊物品形式在本批補上 → 創造清單自動出現
  BLOCK.SPRUCE_LOG, BLOCK.SPRUCE_LEAVES, BLOCK.BIRCH_LOG, BLOCK.BIRCH_LEAVES,
  // B3 Task 4：花／草／仙人掌／冰的方塊物品形式在本批補上 → 創造清單自動出現
  BLOCK.DANDELION, BLOCK.POPPY, BLOCK.SHORT_GRASS, BLOCK.CACTUS, BLOCK.ICE,
  // B4 Task 1：羊毛（方塊物品形式在本批補上 → 創造清單自動出現）
  BLOCK.WOOL,
  // B5 Task 1：礫石／金礦／鑽石礦／雲杉板材／白樺板材（物品形式隨方塊一起補上 → 創造清單自動出現）
  BLOCK.GRAVEL, BLOCK.GOLD_ORE, BLOCK.DIAMOND_ORE, BLOCK.SPRUCE_PLANKS, BLOCK.BIRCH_PLANKS,
];

export const HOTBAR_DEFAULT: BlockId[] = [
  BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.COBBLE, BLOCK.PLANKS,
  BLOCK.LOG, BLOCK.LEAVES, BLOCK.SAND, BLOCK.GLASS,
];
