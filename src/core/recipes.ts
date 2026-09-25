import type { ItemId, ItemStack } from './items';

// ---- Recipe table (Task 11, settled: exactly these 9 recipes) ----
//
// Patterns are arrays of rows (top → bottom), each row an array of cells
// (left → right): an ItemId marks a required item, `null` marks a cell that
// must be EMPTY inside the pattern's bounding box (Minecraft's `.`).
// Typed item-id rows were chosen over packed pattern strings because item ids
// are multi-char (`oak_planks`) — a string encoding would need a legend and a
// parser for no benefit.
//
// Shapeless recipes list their inputs as a multiset; cell position and cell
// stack grouping are ignored, but the totals must be EXACT (settled: no extra
// items anywhere in the grid).

export type PatternCell = ItemId | null;

export interface ShapedRecipe {
  id: string;
  kind: 'shaped';
  /** Rows top→bottom, cells left→right; `null` = must-be-empty cell. */
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

const P: PatternCell = 'oak_planks';
const S: PatternCell = 'stick';
const C: PatternCell = 'cobblestone';

/** The settled recipe table — exactly 9 entries, checked by tests. */
export const RECIPES: ReadonlyArray<Recipe> = [
  // 1 log anywhere → 4 planks (the only shapeless recipe)
  { id: 'log_to_planks', kind: 'shapeless', inputs: ['oak_log'], result: { item: 'oak_planks', count: 4 } },
  // two planks stacked vertically → 4 sticks
  { id: 'planks_to_stick', kind: 'shaped', pattern: [[P], [P]], result: { item: 'stick', count: 4 } },
  // 2×2 square of planks → crafting table
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
    id: 'wooden_sword',
    kind: 'shaped',
    pattern: [[P], [P], [S]],
    result: { item: 'wooden_sword', count: 1 },
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
    id: 'stone_sword',
    kind: 'shaped',
    pattern: [[C], [C], [S]],
    result: { item: 'stone_sword', count: 1 },
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
      if (want !== have) return false;
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
 *    bounding box onto it and compare every cell exactly — the pattern may
 *    sit anywhere in the grid (2×2 recipes match inside 3×3 via offset),
 *    pattern `null` cells must be grid-empty, and any stray item outside the
 *    pattern bbox grows the grid bbox → no match;
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
