import { ATLAS_SIZE, TILE_PX, TILES_PER_ROW, drawAtlas, type AtlasImage } from '../render/textures';
import { getBlockDef, type BlockId } from '../world/blocks';

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

const iconCache = new Map<BlockId, HTMLCanvasElement>();

export function getBlockIcon(blockId: BlockId): HTMLCanvasElement {
  const cached = iconCache.get(blockId);
  if (cached) return cached;
  const def = getBlockDef(blockId);
  const canvas = document.createElement('canvas');
  canvas.width = ICON_PX;
  canvas.height = ICON_PX;
  const ctx = getContext2d(canvas);
  if (!ctx) return canvas; // jsdom has no 2d context; browser draws icons
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
  if (!tmpCtx) return canvas;
  tmpCtx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, ICON_PX, ICON_PX);
  iconCache.set(blockId, canvas);
  return canvas;
}
