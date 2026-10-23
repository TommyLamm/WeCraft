import type { ItemId, ItemStack } from './items';

// ---- Recipe table (13 settled recipes + B5 expansion + B6 torch: exactly 32) ----
//
// Patterns are arrays of rows (top → bottom), each row an array of cells
// (left → right): an ItemId marks a required item, a list of ids accepts any
// one of them ("any of", used for the plank slots), and `null` marks a cell
// that must be EMPTY inside the pattern's bounding box (Minecraft's `.`).
// Typed item-id rows were chosen over packed pattern strings because item ids
// are multi-char (`oak_planks`) — a string encoding would need a legend and a
// parser for no benefit.
//
// Shapeless recipes list their inputs as a multiset; cell position and cell
// stack grouping are ignored, but the totals must be EXACT (settled: no extra
// items anywhere in the grid). Their inputs are exact ids: one spruce log
// makes spruce planks only — wood species never substitute for each other.
// Shaped recipes accept any listed id per cell; today only the plank slots do.

export type PatternCell = ItemId | ReadonlyArray<ItemId> | null;

export interface ShapedRecipe {
  id: string;
  kind: 'shaped';
  /** Rows top→bottom, cells left→right; `null` = must-be-empty cell, an id
   *  list = any one of those ids. */
  pattern: ReadonlyArray<ReadonlyArray<PatternCell>>;
  /** Result stack handed to the player per craft. */
  result: ItemStack;
}

export interface ShapelessRecipe {
  id: string;
  kind: 'shapeless';
  /** Input multiset — order/position independent; counts must match exactly. */
  inputs: ReadonlyArray<ItemId>;
  result: ItemStack;
}

export type Recipe = ShapedRecipe | ShapelessRecipe;

/** Any plank species — Minecraft tool/table recipes accept mixed planks. */
const ANY_PLANKS: PatternCell = ['oak_planks', 'spruce_planks', 'birch_planks'];
const P: PatternCell = ANY_PLANKS;
const S: PatternCell = 'stick';
const C: PatternCell = 'cobblestone';
// B6 Task 5：火把的煤。**不可重用既有的 `C`**——那已經是 'cobblestone'；
// 照原計畫寫 `pattern: [[C], [S]]` 會做出「圓石上放木棍」的錯誤配方。
const COAL: PatternCell = 'coal';
const I: PatternCell = 'iron_ingot';
const G: PatternCell = 'gold_ingot';
const D: PatternCell = 'diamond';

/** The settled recipe table — exactly 32 entries, checked by tests. */
export const RECIPES: ReadonlyArray<Recipe> = [
  // 1 log anywhere → 4 planks (one exact species per recipe — no substitution)
  { id: 'log_to_planks', kind: 'shapeless', inputs: ['oak_log'], result: { item: 'oak_planks', count: 4 } },
  {
    id: 'spruce_log_to_planks',
    kind: 'shapeless',
    inputs: ['spruce_log'],
    result: { item: 'spruce_planks', count: 4 },
  },
  {
    id: 'birch_log_to_planks',
    kind: 'shapeless',
    inputs: ['birch_log'],
    result: { item: 'birch_planks', count: 4 },
  },
  // two planks stacked vertically → 4 sticks
  // Deviation, adjudicated KEEP SHAPED (Minecraft parity): the plan's recipe
  // table lists this as shapeless; shipped shaped so a HORIZONTAL pair does
  // NOT craft sticks, exactly like Minecraft — orchestrator decision.
  { id: 'planks_to_stick', kind: 'shaped', pattern: [[P], [P]], result: { item: 'stick', count: 4 } },
  // 2×2 square of planks → crafting table
  // Same adjudication as planks_to_stick above: plan table says shapeless,
  // shipped SHAPED for Minecraft parity (position matters) — orchestrator decision.
  {
    id: 'planks_to_table',
    kind: 'shaped',
    pattern: [
      [P, P],
      [P, P],
    ],
    result: { item: 'crafting_table', count: 1 },
  },
  // standard Minecraft tool shapes (pickaxe XXX/.S./.S. — axe XX/XS/.S — sword column)
  {
    id: 'wooden_pickaxe',
    kind: 'shaped',
    pattern: [
      [P, P, P],
      [null, S, null],
      [null, S, null],
    ],
    result: { item: 'wooden_pickaxe', count: 1 },
  },
  {
    id: 'wooden_axe',
    kind: 'shaped',
    pattern: [
      [P, P],
      [P, S],
      [null, S],
    ],
    result: { item: 'wooden_axe', count: 1 },
  },
  {
    id: 'wooden_axe_mirrored',
    kind: 'shaped',
    pattern: [
      [P, P],
      [S, P],
      [S, null],
    ],
    result: { item: 'wooden_axe', count: 1 },
  },
  {
    id: 'wooden_sword',
    kind: 'shaped',
    pattern: [[P], [P], [S]],
    result: { item: 'wooden_sword', count: 1 },
  },
  {
    id: 'wooden_shovel',
    kind: 'shaped',
    pattern: [[P], [S], [S]],
    result: { item: 'wooden_shovel', count: 1 },
  },
  {
    id: 'stone_pickaxe',
    kind: 'shaped',
    pattern: [
      [C, C, C],
      [null, S, null],
      [null, S, null],
    ],
    result: { item: 'stone_pickaxe', count: 1 },
  },
  {
    id: 'stone_axe',
    kind: 'shaped',
    pattern: [
      [C, C],
      [C, S],
      [null, S],
    ],
    result: { item: 'stone_axe', count: 1 },
  },
  {
    id: 'stone_axe_mirrored',
    kind: 'shaped',
    pattern: [
      [C, C],
      [S, C],
      [S, null],
    ],
    result: { item: 'stone_axe', count: 1 },
  },
  {
    id: 'stone_sword',
    kind: 'shaped',
    pattern: [[C], [C], [S]],
    result: { item: 'stone_sword', count: 1 },
  },
  {
    id: 'stone_shovel',
    kind: 'shaped',
    pattern: [[C], [S], [S]],
    result: { item: 'stone_shovel', count: 1 },
  },
  {
    id: 'iron_pickaxe',
    kind: 'shaped',
    pattern: [
      [I, I, I],
      [null, S, null],
      [null, S, null],
    ],
    result: { item: 'iron_pickaxe', count: 1 },
  },
  {
    id: 'iron_axe',
    kind: 'shaped',
    pattern: [
      [I, I],
      [I, S],
      [null, S],
    ],
    result: { item: 'iron_axe', count: 1 },
  },
  {
    id: 'iron_axe_mirrored',
    kind: 'shaped',
    pattern: [
      [I, I],
      [S, I],
      [S, null],
    ],
    result: { item: 'iron_axe', count: 1 },
  },
  {
    id: 'iron_sword',
    kind: 'shaped',
    pattern: [[I], [I], [S]],
    result: { item: 'iron_sword', count: 1 },
  },
  {
    id: 'iron_shovel',
    kind: 'shaped',
    pattern: [[I], [S], [S]],
    result: { item: 'iron_shovel', count: 1 },
  },
  {
    id: 'golden_pickaxe',
    kind: 'shaped',
    pattern: [
      [G, G, G],
      [null, S, null],
      [null, S, null],
    ],
    result: { item: 'golden_pickaxe', count: 1 },
  },
  {
    id: 'golden_axe',
    kind: 'shaped',
    pattern: [
      [G, G],
      [G, S],
      [null, S],
    ],
    result: { item: 'golden_axe', count: 1 },
  },
  {
    id: 'golden_axe_mirrored',
    kind: 'shaped',
    pattern: [
      [G, G],
      [S, G],
      [S, null],
    ],
    result: { item: 'golden_axe', count: 1 },
  },
  {
    id: 'golden_sword',
    kind: 'shaped',
    pattern: [[G], [G], [S]],
    result: { item: 'golden_sword', count: 1 },
  },
  {
    id: 'golden_shovel',
    kind: 'shaped',
    pattern: [[G], [S], [S]],
    result: { item: 'golden_shovel', count: 1 },
  },
  {
    id: 'diamond_pickaxe',
    kind: 'shaped',
    pattern: [
      [D, D, D],
      [null, S, null],
      [null, S, null],
    ],
    result: { item: 'diamond_pickaxe', count: 1 },
  },
  {
    id: 'diamond_axe',
    kind: 'shaped',
    pattern: [
      [D, D],
      [D, S],
      [null, S],
    ],
    result: { item: 'diamond_axe', count: 1 },
  },
  {
    id: 'diamond_axe_mirrored',
    kind: 'shaped',
    pattern: [
      [D, D],
      [S, D],
      [S, null],
    ],
    result: { item: 'diamond_axe', count: 1 },
  },
  {
    id: 'diamond_sword',
    kind: 'shaped',
    pattern: [[D], [D], [S]],
    result: { item: 'diamond_sword', count: 1 },
  },
  {
    id: 'diamond_shovel',
    kind: 'shaped',
    pattern: [[D], [S], [S]],
    result: { item: 'diamond_shovel', count: 1 },
  },
  // 8 cobblestone ring (empty centre) → furnace
  {
    id: 'furnace',
    kind: 'shaped',
    pattern: [
      [C, C, C],
      [C, null, C],
      [C, C, C],
    ],
    result: { item: 'furnace', count: 1 },
  },
  // B6 Task 5：coal over stick → 4 torches（原版「Coal or Charcoal + Stick → 4」；
  // 本作物品表沒有 charcoal → 只收煤一條）。2×1 直排（上煤下棍），位置可平移
  // （shaped bbox offset），顛倒（棍上煤下）不匹配。
  {
    id: 'torch',
    kind: 'shaped',
    pattern: [[COAL], [S]],
    result: { item: 'torch', count: 4 },
  },
];

/** Fresh empty crafting grid (length `size²`, row-major like the hotbar slots). */
export function emptyGrid(size: 2 | 3): Array<ItemStack | null> {
  return new Array<ItemStack | null>(size * size).fill(null);
}

/** A cell that can participate in matching: present, count ≥ 1 and finite
 *  (repo NaN-guard norm — spent/garbage stacks read as empty cells). */
function usable(stack: ItemStack | null | undefined): stack is ItemStack {
  return !!stack && Number.isFinite(stack.count) && stack.count >= 1;
}

/** Does a pattern cell accept `have`? `null` wants an empty cell; a list
 *  accepts any listed id (and is never empty-cell). */
function cellMatches(want: PatternCell, have: ItemId | null): boolean {
  if (want === null) return have === null;
  if (have === null) return false;
  if (typeof want === 'string') return want === have;
  return want.includes(have);
}

const idx = (size: number, row: number, col: number): number => row * size + col;

/** Bounding box of the non-null cells: `[minRow, minCol, maxRow, maxCol]`,
 *  or null when there are none. */
function bbox(
  cells: ReadonlyArray<boolean>,
  size: number,
): [number, number, number, number] | null {
  let minR = size;
  let minC = size;
  let maxR = -1;
  let maxC = -1;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!cells[idx(size, r, c)]) continue;
      if (r < minR) minR = r;
      if (c < minC) minC = c;
      if (r > maxR) maxR = r;
      if (c > maxC) maxC = c;
    }
  }
  return maxR < 0 ? null : [minR, minC, maxR, maxC];
}

function matchShapeless(grid: ReadonlyArray<ItemStack | null>, recipe: ShapelessRecipe): boolean {
  const need = new Map<ItemId, number>();
  for (const input of recipe.inputs) need.set(input, (need.get(input) ?? 0) + 1);
  const have = new Map<ItemId, number>();
  for (const cell of grid) {
    if (!usable(cell)) continue;
    have.set(cell.item, (have.get(cell.item) ?? 0) + cell.count);
  }
  if (need.size !== have.size) return false;
  for (const [item, count] of need) if (have.get(item) !== count) return false;
  return true;
}

function matchShaped(
  grid: ReadonlyArray<ItemStack | null>,
  size: number,
  recipe: ShapedRecipe,
): boolean {
  // grid bounding box over usable cells
  const gridCells = grid.map(usable);
  const gb = bbox(gridCells, size);
  if (!gb) return false; // nothing placed → no shaped match

  // pattern bounding box (rows may be ragged; missing cells read as null)
  const rows = recipe.pattern.length;
  let cols = 0;
  for (const row of recipe.pattern) if (row.length > cols) cols = row.length;
  const pat = (r: number, c: number): PatternCell => recipe.pattern[r]?.[c] ?? null;
  const pBox = patternBox(pat, rows, cols);
  if (!pBox) return false;

  const gridH = gb[2] - gb[0] + 1;
  const gridW = gb[3] - gb[1] + 1;
  const patH = pBox[2] - pBox[0] + 1;
  const patW = pBox[3] - pBox[1] + 1;
  if (gridH !== patH || gridW !== patW) return false; // stray items / wrong size

  // Translate the pattern bbox onto the grid bbox and compare cell by cell:
  // pattern items must sit in matching cells, pattern nulls must be grid-empty.
  // Cells outside the (equal-sized) bbox are empty by construction — a stray
  // item would have grown the grid bbox and failed the size check above.
  for (let r = pBox[0]; r <= pBox[2]; r++) {
    for (let c = pBox[1]; c <= pBox[3]; c++) {
      const want = pat(r, c);
      const gr = gb[0] + (r - pBox[0]);
      const gc = gb[1] + (c - pBox[1]);
      const cell = grid[idx(size, gr, gc)];
      const have = usable(cell) ? cell.item : null;
      if (!cellMatches(want, have)) return false;
    }
  }
  return true;
}

/** Bounding box of a pattern's non-null cells over its own (rows × cols) frame. */
function patternBox(
  pat: (r: number, c: number) => PatternCell,
  rows: number,
  cols: number,
): [number, number, number, number] | null {
  let minR = rows;
  let minC = cols;
  let maxR = -1;
  let maxC = -1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (pat(r, c) === null) continue;
      if (r < minR) minR = r;
      if (c < minC) minC = c;
      if (r > maxR) maxR = r;
      if (c > maxC) maxC = c;
    }
  }
  return maxR < 0 ? null : [minR, minC, maxR, maxC];
}

/** Find the first matching recipe for `grid` (row-major, length `size²`,
 *  `size` 2 or 3), or null. Settled rules:
 *  - the grid must be exactly `size²` cells (anything else → null);
 *  - shapeless: exact multiset equality of the usable cells' items+counts;
 *  - shaped: bounding-box the usable grid cells, translate the pattern's
 *    bounding box onto it and compare every cell exactly (an id matches only
 *    itself, a list accepts any listed id) — the pattern may sit anywhere in
 *    the grid (2×2 recipes match inside 3×3 via offset), pattern `null` cells
 *    must be grid-empty, and any stray item outside the pattern bbox grows
 *    the grid bbox → no match;
 *  - usable = non-null with a finite count ≥ 1; other stacks read as empty. */
export function findRecipe(
  grid: ReadonlyArray<ItemStack | null>,
  size: 2 | 3,
): Recipe | null {
  if (size !== 2 && size !== 3) return null;
  if (grid.length !== size * size) return null;
  for (const recipe of RECIPES) {
    const ok =
      recipe.kind === 'shapeless'
        ? matchShapeless(grid, recipe)
        : matchShaped(grid, size, recipe);
    if (ok) return recipe;
  }
  return null;
}

/** The result stack of the first matching recipe (a copy — safe to mutate),
 *  or null when nothing matches. */
export function matchRecipe(
  grid: ReadonlyArray<ItemStack | null>,
  size: 2 | 3,
): ItemStack | null {
  const recipe = findRecipe(grid, size);
  return recipe ? { ...recipe.result } : null;
}

/** Take-the-result semantics: a NEW grid where every usable cell is decremented
 *  by 1 (count 1 → null, invalid counts → null). The input is never mutated;
 *  the returned array is the same length as `grid`. */
export function consumeGrid(grid: ReadonlyArray<ItemStack | null>): Array<ItemStack | null> {
  return grid.map((cell) => {
    if (!usable(cell)) return null;
    return cell.count > 1 ? { item: cell.item, count: cell.count - 1 } : null;
  });
}
