import type { World } from './world';
import type { GameMode } from '../core/inventory';

export interface RayHit {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  t: number;
}

/** Interaction reach in world blocks (Task 5): creative sees one block farther
 *  than survival. Callers pass the result straight to `raycast` as `maxDist`
 *  (third-person view adds the camera back-offset on top). */
export function reachFor(mode: GameMode): number {
  return mode === 'creative' ? 5 : 4.5;
}

/** DDA raycast. dir is normalized internally; maxDistance is euclidean world units. */
export function raycast(
  world: World,
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  maxDist: number,
): RayHit | null {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (len === 0) return null;
  const dx = dir.x / len;
  const dy = dir.y / len;
  const dz = dir.z / len;

  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;

  const frac = (o: number) => o - Math.floor(o);
  let tMaxX = stepX === 0 ? Infinity : stepX > 0 ? (1 - frac(origin.x)) * tDeltaX : frac(origin.x) * tDeltaX;
  let tMaxY = stepY === 0 ? Infinity : stepY > 0 ? (1 - frac(origin.y)) * tDeltaY : frac(origin.y) * tDeltaY;
  let tMaxZ = stepZ === 0 ? Infinity : stepZ > 0 ? (1 - frac(origin.z)) * tDeltaZ : frac(origin.z) * tDeltaZ;

  let nx = 0;
  let ny = 0;
  let nz = 0;
  let t = 0;

  // Start-inside has no true entry face: emit the dominant-axis back-face
  // (ties resolved x, then y, then z) so the normal is always a single-axis
  // unit vector — keeps placeTarget = hit + normal face-adjacent (Task 15).
  if (world.isSolid(x, y, z)) {
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const az = Math.abs(dz);
    if (ax >= ay && ax >= az) return { x, y, z, nx: -stepX, ny: 0, nz: 0, t };
    if (ay >= az) return { x, y, z, nx: 0, ny: -stepY, nz: 0, t };
    return { x, y, z, nx: 0, ny: 0, nz: -stepZ, t };
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
    if (world.isSolid(x, y, z)) {
      return { x, y, z, nx, ny, nz, t };
    }
  }
  return null;
}
