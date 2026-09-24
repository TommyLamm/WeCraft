import './ui.css';
import type { Vitals } from '../player/survival';

/** Survival vitals bars (pure DOM — no Three). Each bar shows `ICON_COUNT`
 *  icons; one icon covers 2 points (2 hp / 2 hunger), so a bar holds 20.
 *  A half icon fills the LEFT half of its silhouette (plan's settled rule:
 *  hp=15 → elements 0–6 full, 7 half, 8–9 empty). */

const ICON_COUNT = 10;
/** Pixel-art grid is 8×8, scaled to 16 px by CSS (2 px per block). */
const GRID = 8;
/** Columns left of this boundary are "filled" in a half icon. */
const HALF = GRID / 2;

/** Exported for tests that pin which side of a half icon gets which color. */
export const HEART_FILL = '#e02020';
export const HEART_EMPTY = '#3f3f3f';
const FOOD_FILL = '#c87830';
const FOOD_EMPTY = '#3f3f3f';

type IconState = 'full' | 'half' | 'empty';

interface BarSpec {
  /** Class of the wrapping group div (`hearts` / `hunger`). */
  row: string;
  /** Class of each icon element (`heart` / `hunger-icon`). */
  icon: string;
  /** Silhouette: '#' = pixel on, '.' = transparent. */
  grid: readonly string[];
  fill: string;
  empty: string;
}

const HEARTS: BarSpec = {
  row: 'hearts',
  icon: 'heart',
  fill: HEART_FILL,
  empty: HEART_EMPTY,
  grid: [
    '.##..##.',
    '########',
    '########',
    '########',
    '.######.',
    '..####..',
    '...##...',
    '........',
  ],
};

const FOOD: BarSpec = {
  row: 'hunger',
  icon: 'hunger-icon',
  fill: FOOD_FILL,
  empty: FOOD_EMPTY,
  grid: [
    '..####..',
    '.######.',
    '########',
    '########',
    '#######.',
    '####....',
    '##......',
    '#.......',
  ],
};

/** State of icon `i` (covering half-units [2i, 2i+1]) for `units` total
 *  half-units, clamped to the 0–20 bar range. */
function iconState(units: number, i: number): IconState {
  if (units >= i * 2 + 2) return 'full';
  if (units >= i * 2 + 1) return 'half';
  return 'empty';
}

/** Inline the 8×8 silhouette as one `<svg>` (rect per pixel, crispEdges keeps
 *  the blocks square). `half` fills pixels left of HALF with `fill`, the rest
 *  with `empty`. */
function pixelSvg(spec: BarSpec, state: IconState): string {
  const rects: string[] = [];
  for (let y = 0; y < spec.grid.length; y++) {
    for (let x = 0; x < spec.grid[y].length; x++) {
      if (spec.grid[y][x] !== '#') continue;
      const color = state === 'full' || (state === 'half' && x < HALF) ? spec.fill : spec.empty;
      rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>`);
    }
  }
  return (
    `<svg class="${spec.icon} ${state}" viewBox="0 0 ${GRID} ${GRID}" ` +
    `shape-rendering="crispEdges" aria-hidden="true">${rects.join('')}</svg>`
  );
}

/** Build one group div holding `ICON_COUNT` icons for `units` half-units. */
function renderBar(spec: BarSpec, units: number): HTMLElement {
  // Non-finite input (NaN/±Infinity) is not meaningful — fall back to 0 so the
  // bar renders all-empty instead of relying on NaN comparison chains.
  const clamped = Number.isFinite(units) ? Math.max(0, Math.min(units, ICON_COUNT * 2)) : 0;
  const group = document.createElement('div');
  group.className = spec.row;
  let html = '';
  for (let i = 0; i < ICON_COUNT; i++) html += pixelSvg(spec, iconState(clamped, i));
  group.innerHTML = html;
  return group;
}

/** Draw the survival HUD into `container`: 10 hearts on the left, 10 hunger
 *  icons on the right (`.hearts` + `.hunger` group divs, replaced wholesale).
 *  Pass `null` (creative mode) to clear the container. */
export function renderVitals(container: HTMLElement, vitals: Vitals | null): void {
  if (!vitals) {
    container.replaceChildren();
    return;
  }
  container.replaceChildren(renderBar(HEARTS, vitals.hp), renderBar(FOOD, vitals.hunger));
}
