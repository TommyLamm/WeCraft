import '../ui/ui.css';
import { getBlockDef } from '../world/blocks';
import type { BlockId } from '../world/blocks';
import { ATLAS_SIZE, TILE_PX, TILES_PER_ROW, drawAtlas } from '../render/textures';

export interface Hud {
  root: HTMLElement;
  setHotbar(slots: BlockId[], selected: number): void;
  setSelected(index: number): void;
  setDebug(lines: string[] | null): void;
  showItemName(name: string | null): void;
  dispose(): void;
}

const atlasData = drawAtlas();

let ctx2dAvailable: boolean | null = null;

function getContext2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  if (ctx2dAvailable === false) return null;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  ctx2dAvailable = !!ctx;
  return ctx;
}

function drawBlockIcon(canvas: HTMLCanvasElement, blockId: BlockId): void {
  canvas.width = 32;
  canvas.height = 32;
  const ctx = getContext2d(canvas);
  if (!ctx) return; // jsdom has no 2d context; browser draws icons
  const def = getBlockDef(blockId);
  const tx = def.side % TILES_PER_ROW;
  const ty = Math.floor(def.side / TILES_PER_ROW);
  const img = ctx.createImageData(TILE_PX, TILE_PX);
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const si = ((ty * TILE_PX + y) * ATLAS_SIZE + tx * TILE_PX + x) * 4;
      const di = (y * TILE_PX + x) * 4;
      img.data[di] = atlasData.data[si];
      img.data[di + 1] = atlasData.data[si + 1];
      img.data[di + 2] = atlasData.data[si + 2];
      img.data[di + 3] = atlasData.data[si + 3];
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = TILE_PX;
  tmp.height = TILE_PX;
  const tmpCtx = getContext2d(tmp);
  if (!tmpCtx) return;
  tmpCtx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, 32, 32);
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

  return {
    root: uiRoot,
    setHotbar(list, selected) {
      list.forEach((id, i) => {
        const s = slots[i];
        if (!s) return;
        s.classList.toggle('selected', i === selected);
        const canvas = s.querySelector('canvas');
        if (canvas) drawBlockIcon(canvas, id);
      });
    },
    setSelected(index) {
      slots.forEach((s, i) => s.classList.toggle('selected', i === index));
    },
    setDebug(lines) {
      if (!lines) {
        debug.style.display = 'none';
        return;
      }
      debug.style.display = 'block';
      debug.textContent = lines.join('\n');
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
