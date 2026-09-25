import { ATLAS_SIZE, TILE_PX, TILES_PER_ROW, drawAtlas, type AtlasImage } from '../render/textures';
import { getBlockDef } from '../world/blocks';
import { blockFromItem, type ItemId } from '../core/items';

export const ICON_PX = 32;

let ctx2dAvailable: boolean | null = null;

export function getContext2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
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

let atlas: AtlasImage | null = null;

export function getAtlas(): AtlasImage {
  if (!atlas) atlas = drawAtlas(); // drawAtlas is memoized; single call site for UI
  return atlas;
}

const iconCache = new Map<ItemId, HTMLCanvasElement>();

/** Icon for any item: block items crop the atlas side texture; non-block items are drawn inline. */
export function itemIcon(item: ItemId): HTMLCanvasElement {
  const cached = iconCache.get(item);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = ICON_PX;
  canvas.height = ICON_PX;
  const ctx = getContext2d(canvas);
  if (!ctx) return canvas; // jsdom has no 2d context; browser draws icons
  const blockId = blockFromItem(item);
  if (blockId !== null) drawBlockIcon(ctx, blockId);
  else drawItemArt(ctx, item);
  iconCache.set(item, canvas);
  return canvas;
}

/** Crop the atlas side tile of a block into the icon canvas (pixel-perfect upscale). */
function drawBlockIcon(
  ctx: CanvasRenderingContext2D,
  blockId: number,
): void {
  const def = getBlockDef(blockId);
  const atlasData = getAtlas();
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
  if (!tmpCtx) return;
  tmpCtx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, ICON_PX, ICON_PX);
}

// ---- Inline pixel-art icons for non-block items (vector paths on the icon canvas) ----

const WOOD = '#8a5a2b';
const WOOD_LIGHT = '#b8945f';
const STONE_GRAY = '#9a9a9a';

function line(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  color: string, width: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawItemArt(ctx: CanvasRenderingContext2D, item: ItemId): void {
  switch (item) {
    case 'stick': {
      line(ctx, 9, 23, 23, 9, WOOD, 4);
      break;
    }
    case 'coal': {
      ctx.fillStyle = '#333333';
      ctx.beginPath();
      ctx.arc(16, 17, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5f5f5f';
      ctx.beginPath();
      ctx.arc(12, 13, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'iron_ingot': {
      ctx.fillStyle = '#d8d8d8';
      ctx.beginPath();
      ctx.moveTo(10, 12);
      ctx.lineTo(22, 12);
      ctx.lineTo(27, 22);
      ctx.lineTo(5, 22);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(10, 12, 12, 3);
      break;
    }
    case 'gravel': {
      ctx.fillStyle = '#9a968e';
      ctx.fillRect(4, 10, 24, 16);
      ctx.fillStyle = '#6f6b64';
      ctx.fillRect(7, 13, 4, 4);
      ctx.fillRect(16, 11, 3, 3);
      ctx.fillRect(21, 19, 4, 4);
      ctx.fillRect(11, 20, 3, 3);
      break;
    }
    case 'apple': {
      ctx.fillStyle = '#d43b3b';
      ctx.beginPath();
      ctx.arc(16, 18, 9, 0, Math.PI * 2);
      ctx.fill();
      line(ctx, 16, 10, 18, 6, '#6b4a1f', 2);
      ctx.fillStyle = '#3f9b4f';
      ctx.fillRect(19, 5, 5, 3);
      break;
    }
    case 'arrow': {
      line(ctx, 8, 24, 22, 10, WOOD, 3);
      ctx.fillStyle = '#c9c9c9';
      ctx.beginPath();
      ctx.moveTo(27, 5);
      ctx.lineTo(19, 11);
      ctx.lineTo(23, 15);
      ctx.closePath();
      ctx.fill();
      line(ctx, 5, 21, 11, 27, '#e8e8e8', 2);
      break;
    }
    case 'chest': {
      ctx.fillStyle = '#a5713d';
      ctx.fillRect(4, 8, 24, 18);
      ctx.strokeStyle = '#6b4a1f';
      ctx.lineWidth = 2;
      ctx.strokeRect(5, 9, 22, 16);
      line(ctx, 5, 15, 27, 15, '#6b4a1f', 2);
      ctx.fillStyle = '#d8d8d8';
      ctx.fillRect(14, 13, 4, 6);
      break;
    }
    case 'wooden_pickaxe':
    case 'stone_pickaxe': {
      const head = item === 'stone_pickaxe' ? STONE_GRAY : WOOD_LIGHT;
      line(ctx, 10, 26, 20, 10, WOOD, 3);
      ctx.strokeStyle = head;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(6, 12);
      ctx.quadraticCurveTo(16, 3, 26, 12);
      ctx.stroke();
      break;
    }
    case 'wooden_axe':
    case 'stone_axe': {
      const head = item === 'stone_axe' ? STONE_GRAY : WOOD_LIGHT;
      line(ctx, 10, 26, 19, 11, WOOD, 3);
      ctx.fillStyle = head;
      ctx.beginPath();
      ctx.moveTo(17, 5);
      ctx.lineTo(27, 9);
      ctx.lineTo(23, 18);
      ctx.lineTo(16, 13);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'wooden_sword':
    case 'stone_sword': {
      const blade = item === 'stone_sword' ? STONE_GRAY : '#d8d8d8';
      line(ctx, 22, 8, 12, 18, blade, 4);
      line(ctx, 9, 15, 15, 21, WOOD, 3); // guard, perpendicular to blade
      line(ctx, 12, 18, 8, 22, WOOD, 3); // handle
      break;
    }
    default: {
      // unknown/future item — neutral placeholder until it gets real art
      ctx.fillStyle = '#7a7a7a';
      ctx.fillRect(8, 8, 16, 16);
      break;
    }
  }
}
