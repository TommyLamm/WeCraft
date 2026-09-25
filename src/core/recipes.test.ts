import { describe, it, expect } from 'vitest';
import { matchRecipe, consumeGrid, emptyGrid, RECIPES, type Recipe } from './recipes';
import type { ItemId, ItemStack } from './items';

/** A usable stack; `count` defaults to 1 (what the crafting UI places per cell). */
const s = (item: ItemId, count = 1): ItemStack => ({ item, count });

/** Look up a recipe by its settled id (asserts the table holds exactly the 9). */
function recipe(id: string): Recipe {
  const r = RECIPES.find((x) => x.id === id);
  if (!r) throw new Error(`recipe not found: ${id}`);
  return r;
}

describe('recipe table', () => {
  it('holds exactly the 9 settled recipes, no extras', () => {
    expect(RECIPES.length).toBe(9);
    expect(RECIPES.map((r) => r.id).sort()).toEqual(
      [
        'log_to_planks',
        'planks_to_stick',
        'planks_to_table',
        'wooden_pickaxe',
        'wooden_axe',
        'wooden_sword',
        'stone_pickaxe',
        'stone_axe',
        'stone_sword',
      ].sort(),
    );
  });

  it('result counts: planks 4, stick 4, table 1, tools 1', () => {
    expect(recipe('log_to_planks').result).toEqual({ item: 'oak_planks', count: 4 });
    expect(recipe('planks_to_stick').result).toEqual({ item: 'stick', count: 4 });
    expect(recipe('planks_to_table').result).toEqual({ item: 'crafting_table', count: 1 });
    for (const id of ['wooden_pickaxe', 'wooden_axe', 'wooden_sword', 'stone_pickaxe', 'stone_axe', 'stone_sword']) {
      expect(recipe(id).result.count).toBe(1);
    }
  });
});

describe('matchRecipe — shapeless', () => {
  it('1 oak_log → 4 oak_planks, in any cell', () => {
    // position-independent: the log sits in cell 0 …
    expect(matchRecipe([s('oak_log'), null, null, null], 2)).toEqual({ item: 'oak_planks', count: 4 });
    // … then in the last cell ("swapped" with an empty cell): same result
    expect(matchRecipe([null, null, null, s('oak_log')], 2)).toEqual({ item: 'oak_planks', count: 4 });
  });

  it('shapeless ignores order/placement across the whole grid', () => {
    // log alone in cell 2 of a 3×3 grid matches too
    expect(matchRecipe([null, null, null, null, null, s('oak_log'), null, null, null], 3)).toEqual({
      item: 'oak_planks',
      count: 4,
    });
  });

  it('wrong count fails: two logs are not one input', () => {
    expect(matchRecipe([s('oak_log'), s('oak_log'), null, null], 2)).toBeNull();
    // settled rule: counts must be exactly the inputs — a 5-stack is 4 extra items
    expect(matchRecipe([s('oak_log', 5), null, null, null], 2)).toBeNull();
  });

  it('stray item anywhere fails', () => {
    expect(matchRecipe([s('oak_log'), s('oak_planks'), null, null], 2)).toBeNull();
  });
});

describe('matchRecipe — shaped', () => {
  it('2 oak_planks vertical → 4 stick (either column)', () => {
    const col0 = matchRecipe([s('oak_planks'), null, s('oak_planks'), null], 2);
    expect(col0).toEqual({ item: 'stick', count: 4 });
    // "cells swapped" to the other column: identical outcome (offset matching)
    const col1 = matchRecipe([null, s('oak_planks'), null, s('oak_planks')], 2);
    expect(col1).toEqual({ item: 'stick', count: 4 });
  });

  it('horizontal 2 oak_planks do NOT craft sticks (shaped — review #2 pin)', () => {
    // The plan table lists planks_to_stick as shapeless; shipped SHAPED for
    // Minecraft parity, so a side-by-side pair must be rejected.
    expect(matchRecipe([s('oak_planks'), s('oak_planks'), null, null], 2)).toBeNull();
    // …and the vertical pair above keeps crafting 4 sticks.
  });

  it('2×2 oak_planks → 1 crafting_table', () => {
    const g = [s('oak_planks'), s('oak_planks'), s('oak_planks'), s('oak_planks')];
    expect(matchRecipe(g, 2)).toEqual({ item: 'crafting_table', count: 1 });
  });

  it('2×2 recipe matches in a 3×3 grid via bounding-box offset (bottom-right)', () => {
    const g = [
      null, null, null,
      null, null, null,
      null, s('oak_planks'), s('oak_planks'),
    ] as Array<ItemStack | null>;
    // bottom row only — NOT a table (pattern is 2×2)
    expect(matchRecipe(g, 3)).toBeNull();
    // fill the missing 2×2 corner cells → table, even though it sits off-origin
    g[4] = s('oak_planks');
    g[5] = s('oak_planks');
    expect(matchRecipe(g, 3)).toEqual({ item: 'crafting_table', count: 1 });
  });

  it('wooden_pickaxe: planks top row + sticks centre/middle-bottom', () => {
    const g = [
      s('oak_planks'), s('oak_planks'), s('oak_planks'),
      null, s('stick'), null,
      null, s('stick'), null,
    ];
    expect(matchRecipe(g, 3)).toEqual({ item: 'wooden_pickaxe', count: 1 });
  });

  it('wooden_axe matches wherever it sits (left- and right-aligned = offset match)', () => {
    // left-aligned: XX / XS / .S
    const left = [
      s('oak_planks'), s('oak_planks'), null,
      s('oak_planks'), s('stick'), null,
      null, s('stick'), null,
    ];
    expect(matchRecipe(left, 3)).toEqual({ item: 'wooden_axe', count: 1 });
    // right-aligned: the same pattern shifted one column right
    const right = [
      null, s('oak_planks'), s('oak_planks'),
      null, s('oak_planks'), s('stick'),
      null, null, s('stick'),
    ];
    expect(matchRecipe(right, 3)).toEqual({ item: 'wooden_axe', count: 1 });
  });

  it('wooden_sword: one column of plank/plank/stick, any column', () => {
    const col0 = [
      s('oak_planks'), null, null,
      s('oak_planks'), null, null,
      s('stick'), null, null,
    ];
    expect(matchRecipe(col0, 3)).toEqual({ item: 'wooden_sword', count: 1 });
    const col2 = [
      null, null, s('oak_planks'),
      null, null, s('oak_planks'),
      null, null, s('stick'),
    ];
    expect(matchRecipe(col2, 3)).toEqual({ item: 'wooden_sword', count: 1 });
  });

  it('pattern "." cells must be grid-empty (stray stick breaks the axe)', () => {
    const g = [
      s('oak_planks'), s('oak_planks'), null,
      s('oak_planks'), s('stick'), null,
      s('stick'), null, null, // (2,0) is "." in XX/XS/.S — filling it must fail
    ];
    expect(matchRecipe(g, 3)).toBeNull();
  });

  it('stone tools match the wooden shapes with cobblestone', () => {
    const pick = [
      s('cobblestone'), s('cobblestone'), s('cobblestone'),
      null, s('stick'), null,
      null, s('stick'), null,
    ];
    expect(matchRecipe(pick, 3)).toEqual({ item: 'stone_pickaxe', count: 1 });
    const axe = [
      s('cobblestone'), s('cobblestone'), null,
      s('cobblestone'), s('stick'), null,
      null, s('stick'), null,
    ];
    expect(matchRecipe(axe, 3)).toEqual({ item: 'stone_axe', count: 1 });
    const sword = [
      null, null, s('cobblestone'),
      null, null, s('cobblestone'),
      null, null, s('stick'),
    ];
    expect(matchRecipe(sword, 3)).toEqual({ item: 'stone_sword', count: 1 });
  });
});

describe('matchRecipe — matching rules', () => {
  it('empty grid → null (both sizes), undersized grid → null', () => {
    expect(matchRecipe(emptyGrid(2), 2)).toBeNull();
    expect(matchRecipe(emptyGrid(3), 3)).toBeNull();
    expect(matchRecipe([], 2)).toBeNull(); // grid must be exactly size² cells
  });

  it('wrong counts fail (1 plank ≠ stick; 3 planks ≠ table)', () => {
    expect(matchRecipe([s('oak_planks'), null, null, null], 2)).toBeNull();
    expect(matchRecipe([s('oak_planks'), s('oak_planks'), s('oak_planks'), null], 2)).toBeNull();
  });

  it('stray item fails a shaped recipe (planks in a stick-shaped hole)', () => {
    const g = [
      s('oak_planks'), s('oak_planks'), s('oak_planks'),
      s('oak_planks'), s('stick'), null, // (1,0) is "." in XXX/.S./.S.
      null, s('stick'), null,
    ];
    expect(matchRecipe(g, 3)).toBeNull();
  });

  it('a 3×3 recipe cannot match in a 2×2 grid (not enough cells)', () => {
    // pickaxe-shaped fragments inside 2×2 — no recipe can fit
    expect(matchRecipe([s('oak_planks'), s('oak_planks'), s('oak_planks'), null], 2)).toBeNull();
    expect(matchRecipe([s('oak_planks'), s('oak_planks'), s('stick'), null], 2)).toBeNull();
    expect(matchRecipe([s('cobblestone'), s('cobblestone'), s('stick'), s('stick')], 2)).toBeNull();
  });

  it('cells with count < 1 or non-finite counts are treated as empty', () => {
    expect(matchRecipe([s('oak_log', 0), null, null, null], 2)).toBeNull();
    expect(matchRecipe([s('oak_log', Number.NaN), null, null, null], 2)).toBeNull();
    // stick column whose top plank is spent (count 0) reads as a 1-cell column
    expect(
      matchRecipe([s('oak_planks', -1), null, s('oak_planks'), null, s('stick'), null, null, null, null], 3),
    ).toBeNull();
  });

  it('stack sizes do not block shaped recipes (a 16-planks cell still counts as one)', () => {
    const g = [
      s('oak_planks', 16), s('oak_planks'), s('oak_planks'),
      null, s('stick', 5), null,
      null, s('stick'), null,
    ];
    expect(matchRecipe(g, 3)).toEqual({ item: 'wooden_pickaxe', count: 1 });
  });
});

describe('consumeGrid', () => {
  it('decrements every non-null cell by 1; 1 → null', () => {
    const g = [
      s('oak_planks', 3), s('oak_planks', 1), null,
      s('stick', 2), null, null, null, null, null,
    ];
    const next = consumeGrid(g);
    expect(next).toEqual([
      s('oak_planks', 2), null, null,
      s('stick', 1), null, null, null, null, null,
    ]);
    // pure: the input grid is untouched and cells are fresh copies
    expect(g[0]).toEqual(s('oak_planks', 3));
    expect(g[1]).toEqual(s('oak_planks', 1));
    expect(next[0]).not.toBe(g[0]);
  });

  it('treats invalid counts (< 1 / non-finite) as empty cells', () => {
    const g = [s('oak_planks', 0), s('stick', Number.NaN), null, s('oak_log', -2)];
    expect(consumeGrid(g)).toEqual([null, null, null, null]);
  });
});

describe('emptyGrid', () => {
  it('creates a size² grid of nulls', () => {
    expect(emptyGrid(2)).toEqual([null, null, null, null]);
    expect(emptyGrid(3)).toHaveLength(9);
    expect(emptyGrid(3).every((c) => c === null)).toBe(true);
  });
});
