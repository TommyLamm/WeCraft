import '../ui/ui.css';
import type { BlockId } from '../world/blocks';
import { ICON_PX, getContext2d, getBlockIcon } from './icons';

export interface Hud {
  root: HTMLElement;
  setHotbar(slots: BlockId[], selected: number): void;
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
    s.append(num, icon);
    hotbar.appendChild(s);
    slots.push(s);
  }

  const itemName = document.createElement('div');
  itemName.className = 'ui-item-name';

  const debug = document.createElement('div');
  debug.className = 'ui-debug';
  debug.style.display = 'none';

  uiRoot.append(crosshair, hotbar, itemName, debug);

  const slotBlocks: Array<BlockId | undefined> = new Array(9).fill(undefined);
  let lastDebug: string | null = null; // null = hidden

  const drawSlotIcon = (canvas: HTMLCanvasElement, id: BlockId) => {
    const ctx = getContext2d(canvas);
    if (!ctx) return; // jsdom has no 2d context; browser draws icons
    canvas.width = ICON_PX;
    canvas.height = ICON_PX;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(getBlockIcon(id), 0, 0);
  };

  return {
    root: uiRoot,
    setHotbar(list, selected) {
      list.forEach((id, i) => {
        const s = slots[i];
        if (!s) return;
        s.classList.toggle('selected', i === selected);
        if (slotBlocks[i] === id) return;
        slotBlocks[i] = id;
        const canvas = s.querySelector('canvas');
        if (canvas) drawSlotIcon(canvas, id);
      });
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
