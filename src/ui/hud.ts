import '../ui/ui.css';
import type { ItemStack } from '../core/items';
import type { GameMode } from '../core/inventory';
import { ICON_PX, getContext2d, itemIcon } from './icons';

/** Frame reads that make up the F3 overlay — pure data, no DOM/Three. */
export interface DebugLinesParams {
  fps: number;
  x: number;
  y: number;
  z: number;
  chunks: number;
  seed: number;
  mode: GameMode;
  flying: boolean;
  triangles: number;
}

/** Build the F3 debug lines (pure — main.ts reads the frame, hud renders it).
 *  Line formats are byte-for-byte stable (the walkthrough diffs them); the
 *  triangle count sits after Seed so the greedy-mesher's per-frame cost can be
 *  read off against the memory baseline in the browser. */
export function formatDebugLines(p: DebugLinesParams): string[] {
  return [
    `WeCraft (dev)  ${p.fps} fps`,
    `XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`,
    `Block: ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}`,
    `Chunks: ${p.chunks}`,
    `Seed: ${p.seed}`,
    `Triangles: ${p.triangles}`,
    `Mode: ${p.mode}${p.flying ? ' (flying)' : ''}`,
  ];
}

export interface Hud {
  root: HTMLElement;
  setHotbar(slots: ReadonlyArray<ItemStack | null>, selected: number): void;
  setSelected(index: number): void;
  setDebug(lines: string[] | null): void;
  showItemName(name: string | null): void;
  dispose(): void;
}

export function createHud(uiRoot: HTMLElement): Hud {
  const crosshair = document.createElement('div');
  crosshair.className = 'ui-crosshair';

  const hotbar = document.createElement('div');
  hotbar.className = 'ui-hotbar';
  const slots: HTMLElement[] = [];
  for (let i = 0; i < 9; i++) {
    const s = document.createElement('div');
    s.className = 'ui-slot';
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = String(i + 1);
    const icon = document.createElement('canvas');
    const count = document.createElement('span');
    count.className = 'count';
    s.append(num, icon, count);
    hotbar.appendChild(s);
    slots.push(s);
  }

  const itemName = document.createElement('div');
  itemName.className = 'ui-item-name';

  const debug = document.createElement('div');
  debug.className = 'ui-debug';
  debug.style.display = 'none';

  uiRoot.append(crosshair, hotbar, itemName, debug);

  const slotStacks: Array<ItemStack | null> = new Array(9).fill(null);
  let lastDebug: string | null = null; // null = hidden

  const sameStack = (
    a: ItemStack | null | undefined,
    b: ItemStack | null | undefined,
  ): boolean => {
    if (!a || !b) return !a && !b;
    return a.item === b.item && a.count === b.count;
  };

  const drawSlotIcon = (canvas: HTMLCanvasElement, stack: ItemStack | null) => {
    const ctx = getContext2d(canvas);
    if (!ctx) return; // jsdom has no 2d context; browser draws icons
    canvas.width = ICON_PX;
    canvas.height = ICON_PX;
    if (!stack) return; // empty slot: resizing above already cleared the canvas
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(itemIcon(stack.item), 0, 0);
  };

  return {
    root: uiRoot,
    setHotbar(list, selected) {
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const stack = list[i] ?? null;
        s.classList.toggle('selected', i === selected);
        if (sameStack(slotStacks[i], stack)) continue;
        // snapshot: the model mutates stacks in place — caching the live object
        // would make the diff compare it to itself and skip the redraw
        slotStacks[i] = stack ? { ...stack } : null;
        const canvas = s.querySelector('canvas');
        if (canvas) drawSlotIcon(canvas, stack);
        const badge = s.querySelector('.count');
        if (badge) badge.textContent = stack && stack.count > 1 ? String(stack.count) : '';
      }
    },
    setSelected(index) {
      slots.forEach((s, i) => s.classList.toggle('selected', i === index));
    },
    setDebug(lines) {
      const next = lines ? lines.join('\n') : null;
      if (next === lastDebug) return;
      lastDebug = next;
      if (next === null) {
        debug.style.display = 'none';
        debug.textContent = '';
        return;
      }
      debug.style.display = 'block';
      debug.textContent = next;
    },
    showItemName(name) {
      itemName.textContent = name ?? '';
    },
    dispose() {
      crosshair.remove();
      hotbar.remove();
      itemName.remove();
      debug.remove();
    },
  };
}
