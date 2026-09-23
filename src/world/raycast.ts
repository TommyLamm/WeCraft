import type { World } from './world';
import { isSolid } from './blocks';

export interface RayHit {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
}

export function raycast(
  world: World,
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  maxDist: number,
): RayHit | null {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
  const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
  const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

  const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;

  const frac = (o: number) => o - Math.floor(o);
  let tMaxX = stepX === 0 ? Infinity : stepX > 0 ? (1 - frac(origin.x)) * tDeltaX : frac(origin.x) * tDeltaX;
  let tMaxY = stepY === 0 ? Infinity : stepY > 0 ? (1 - frac(origin.y)) * tDeltaY : frac(origin.y) * tDeltaY;
  let tMaxZ = stepZ === 0 ? Infinity : stepZ > 0 ? (1 - frac(origin.z)) * tDeltaZ : frac(origin.z) * tDeltaZ;

  let nx = 0;
  let ny = 0;
  let nz = 0;
  let t = 0;

  // 起點若在 solid 內：法線朝射線來向
  if (isSolid(world.getBlock(x, y, z))) {
    return { x, y, z, nx: -stepX, ny: -stepY, nz: -stepZ };
  }

  while (t <= maxDist) {
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      nx = -stepX;
      ny = 0;
      nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      nx = 0;
      ny = -stepY;
      nz = 0;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      nx = 0;
      ny = 0;
      nz = -stepZ;
    }
    if (t > maxDist) break;
    if (isSolid(world.getBlock(x, y, z))) {
      return { x, y, z, nx, ny, nz };
    }
  }
  return null;
}
