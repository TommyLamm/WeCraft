import { getBlockDef, BLOCK } from '../world/blocks';
import type { World } from '../world/world';
import type { RayHit } from '../world/raycast';
import { CHUNK_HEIGHT } from '../world/chunk';
import { PLAYER_HALF_WIDTH, PLAYER_HEIGHT } from './physics';
import { itemFromBlock, type ItemId, type ItemStack } from '../core/items';
import type { InventoryModel } from '../core/inventory';

/** Mined-block drop: adds 1× the block's item via inventory.add — survival only,
 *  creative skips (infinite supply no-ops inside the model). Returns overflow
 *  that did not fit; 0 when nothing was added. */
export function collectBlockDrop(blockId: number, inventory: InventoryModel): number {
  const item = itemFromBlock(blockId);
  if (!item) return 0; // air/water: no item form
  return inventory.addItem(item, 1);
}

export function getBreakTime(blockId: number): number {
  return getBlockDef(blockId).hardness;
}

// ---- Survival mining table (Task 5) ----

type ToolCategory = 'pickaxe' | 'axe';

/** Blocks mined fastest with a pickaxe (stone family). */
const PICKAXE_BLOCKS: ReadonlySet<number> = new Set([
  BLOCK.STONE, BLOCK.COBBLE, BLOCK.COAL_ORE, BLOCK.IRON_ORE,
]);
/** Blocks mined fastest with an axe. */
const AXE_BLOCKS: ReadonlySet<number> = new Set([BLOCK.LOG]);

const PICKAXES: ReadonlySet<ItemId> = new Set(['wooden_pickaxe', 'stone_pickaxe']);
const AXES: ReadonlySet<ItemId> = new Set(['wooden_axe', 'stone_axe']);
const SWORDS: ReadonlySet<ItemId> = new Set(['wooden_sword', 'stone_sword']);

function requiredTool(blockId: number): ToolCategory | null {
  if (PICKAXE_BLOCKS.has(blockId)) return 'pickaxe';
  if (AXE_BLOCKS.has(blockId)) return 'axe';
  return null;
}

/** Mining-speed multiplier for holding `held` (a hotbar stack; null = bare hand)
 *  while digging `blockId`. Survival mode only — creative dig ignores it.
 *
 *  Table (Task 5), documented choices:
 *  - unbreakable (bedrock/water, hardness Infinity) → 1× — the rate never
 *    accumulates for them anyway (`DigProgress` guards on finite break time);
 *  - no required tool (dirt, grass, sand, leaves, planks, glass, snow, …) → 1×
 *    with anything in hand;
 *  - matching tool (pickaxe on the stone family, axe on logs) → 2×;
 *  - wrong tool (axe on stone, pickaxe on logs, a sword on a required block) → 0.5×;
 *  - bare hand / non-tool item: 0.5× on pickaxe blocks (plan: "0.5× other
 *    tools/hand"), 1× on logs (punchable) and on no-tool blocks;
 *  - swords are the documented "wrong tool" case: 0.5× on required blocks,
 *    1× elsewhere. */
export function toolSpeed(blockId: number, held: ItemStack | null): number {
  if (!Number.isFinite(getBlockDef(blockId).hardness)) return 1; // bedrock/water unchanged
  const required = requiredTool(blockId);
  if (!required) return 1;
  const item = held?.item ?? null;
  if (item) {
    const matches = required === 'pickaxe' ? PICKAXES.has(item) : AXES.has(item);
    if (matches) return 2;
    if (PICKAXES.has(item) || AXES.has(item) || SWORDS.has(item)) return 0.5; // wrong tool
  }
  // hand or plain item: rock needs a pickaxe; logs/no-tool blocks take a hand
  return required === 'pickaxe' ? 0.5 : 1;
}

/** Per-frame contract: call update(blockId, hit, dt, speed?) before isDone(blockId)
 *  each frame with the same target; isDone assumes progress belongs to the current
 *  target key. `speed` multiplies the progress rate (survival passes
 *  `toolSpeed(...)`; default 1 = the Phase 1 rate, which is what creative uses). */
export class DigProgress {
  private key = '';
  progress = 0;

  update(blockId: number, hit: RayHit, dt: number, speed = 1): void {
    const k = `${hit.x},${hit.y},${hit.z},${blockId}`;
    if (k !== this.key) {
      this.key = k;
      this.progress = 0;
    }
    const time = getBreakTime(blockId);
    if (!isFinite(time)) return; // bedrock 永不累進
    const rate = Number.isFinite(speed) && speed > 0 ? speed : 1;
    this.progress = Math.min(1, this.progress + (dt * rate) / time);
  }

  isDone(blockId: number): boolean {
    return (
      isFinite(getBreakTime(blockId)) &&
      this.progress >= 1 &&
      this.key.endsWith(`,${blockId}`)
    );
  }

  reset(): void {
    this.key = '';
    this.progress = 0;
  }
}

export function placeTarget(hit: RayHit): { x: number; y: number; z: number } {
  if (Math.abs(hit.nx) + Math.abs(hit.ny) + Math.abs(hit.nz) !== 1) {
    return { x: hit.x, y: hit.y, z: hit.z };
  }
  return { x: hit.x + hit.nx, y: hit.y + hit.ny, z: hit.z + hit.nz };
}

export function canPlaceAt(
  world: World,
  x: number,
  y: number,
  z: number,
  playerPos: { x: number; y: number; z: number },
): boolean {
  if (y < 0 || y >= CHUNK_HEIGHT) return false;
  const id = world.getBlock(x, y, z);
  if (id !== BLOCK.AIR && id !== BLOCK.WATER) return false; // 只能放進空氣/水

  // 方塊 AABB: [x,x+1]³ vs 玩家 AABB
  const pMinX = playerPos.x - PLAYER_HALF_WIDTH;
  const pMaxX = playerPos.x + PLAYER_HALF_WIDTH;
  const pMinY = playerPos.y;
  const pMaxY = playerPos.y + PLAYER_HEIGHT;
  const pMinZ = playerPos.z - PLAYER_HALF_WIDTH;
  const pMaxZ = playerPos.z + PLAYER_HALF_WIDTH;
  const overlap =
    pMaxX > x && pMinX < x + 1 &&
    pMaxY > y && pMinY < y + 1 &&
    pMaxZ > z && pMinZ < z + 1;
  return !overlap;
}
