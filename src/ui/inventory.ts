import './ui.css';
import { PLACEABLE, getBlockDef, type BlockId } from '../world/blocks';
import { ATLAS_SIZE, TILE_PX, TILES_PER_ROW, drawAtlas } from '../render/textures';

export interface InventoryUi {
  open(hotbar: BlockId[], selected: number, onPick: (slot: number, id: BlockId) => void): void;
  close(): void;
  isOpen(): boolean;
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

function icon(blockId: BlockId): HTMLCanvasElement {
  const def = getBlockDef(blockId);
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = getContext2d(canvas);
  if (!ctx) return canvas; // jsdom has no 2d context; browser draws icons
  const tx = def.side % TILES_PER_ROW;
  const ty = Math.floor(def.side / TILES_PER_ROW);
  const img = ctx.createImageData(TILE_PX, TILE_PX);
  for (let y = 0; y < TILE_PX; y++)
    for (let x = 0; x < TILE_PX; x++) {
      const si = ((ty * TILE_PX + y) * ATLAS_SIZE + tx * TILE_PX + x) * 4;
      const di = (y * TILE_PX + x) * 4;
      img.data[di] = atlasData.data[si];
      img.data[di + 1] = atlasData.data[si + 1];
      img.data[di + 2] = atlasData.data[si + 2];
      img.data[di + 3] = atlasData.data[si + 3];
    }
  const tmp = document.createElement('canvas');
  tmp.width = TILE_PX;
  tmp.height = TILE_PX;
  const tmpCtx = getContext2d(tmp);
  if (!tmpCtx) return canvas;
  tmpCtx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, 32, 32);
  return canvas;
}

export function createInventory(uiRoot: HTMLElement): InventoryUi {
  let el: HTMLElement | null = null;

  return {
    open(_hotbar, selected, onPick) {
      this.close();
      el = document.createElement('div');
      el.className = 'ui-inventory interactive';
      const h = document.createElement('h3');
      h.textContent = `方塊（點選放入欄位 ${selected + 1}）`;
      const grid = document.createElement('div');
      grid.className = 'ui-inv-grid';
      for (const id of PLACEABLE) {
        const s = document.createElement('div');
        s.className = 'ui-slot';
        s.title = getBlockDef(id).name;
        s.appendChild(icon(id));
        s.addEventListener('click', () => onPick(selected, id));
        grid.appendChild(s);
      }
      el.append(h, grid);
      uiRoot.appendChild(el);
    },
    close() {
      el?.remove();
      el = null;
    },
    isOpen: () => el !== null,
  };
}
