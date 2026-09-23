import { getBlockDef, BLOCK } from '../world/blocks';
import type { World } from '../world/world';
import type { RayHit } from '../world/raycast';
import { PLAYER_HALF_WIDTH, PLAYER_HEIGHT } from './physics';

export function getBreakTime(blockId: number): number {
  return getBlockDef(blockId).hardness;
}

export class DigProgress {
  private key = '';
  progress = 0;

  update(blockId: number, hit: RayHit, dt: number): void {
    const k = `${hit.x},${hit.y},${hit.z},${blockId}`;
    if (k !== this.key) {
      this.key = k;
      this.progress = 0;
    }
    const time = getBreakTime(blockId);
    if (!isFinite(time)) return; // bedrock 永不累進
    this.progress = Math.min(1, this.progress + dt / time);
  }

  isDone(blockId: number): boolean {
    return isFinite(getBreakTime(blockId)) && this.progress >= 1;
  }

  reset(): void {
    this.key = '';
    this.progress = 0;
  }
}

export function placeTarget(hit: RayHit): { x: number; y: number; z: number } {
  return { x: hit.x + hit.nx, y: hit.y + hit.ny, z: hit.z + hit.nz };
}

export function canPlaceAt(
  world: World,
  x: number,
  y: number,
  z: number,
  playerPos: { x: number; y: number; z: number },
): boolean {
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
