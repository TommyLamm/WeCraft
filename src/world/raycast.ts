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

/** 射線查詢選項（`raycast` 的第 5 參數；省略＝既有行為）。 */
export interface RaycastOptions {
  /** **跳過「原點所在的那一格」**：當射線原點位於**可命中**方塊內時（實心方塊
   *  或 cross 植被），該格**不會**成為命中目標——射線照原路走出那一格，再找下一個
   *  可命中的方塊。
   *
   *  **為什麼需要**：第三身（面後／面前）時射線原點是**相機**，而相機可能被
   *  地形夾住（玩家背靠土坡／面前有牆）→ 原點落在實心方塊內時，一般的 DDA
   *  會在 `t = 0` 命中「相機所在的那一格」：那是一格玩家**看不到**的方塊，
   *  挖它／在它上面放方塊都等於操作一個看不見的目標。
   *
   *  **行為定義（可預期）**：
   *  - 原點在空氣中 → 與既有行為完全相同（此選項無作用）。
   *  - 原點在實心方塊內 → 該格被跳過；命中的是「走出那一格之後的第一個可命中
   *    方塊」，且法線是**真正的入射面**（不是原點格的近似背面法線）。
   *  - 原點在 cross 植被內 → **一樣被跳過**（植被不碰撞，相機卡在花叢裡時不該
   *    去挖「看不見的那一朵」）；與實心格的處理一致。
   *  - `t` 仍從**原點**起算 → reach 預算不因跳過而改變。
   *  - 原點格之外沒有任何可命中方塊 → 回傳 `null`（不會退回去命中原點格）。 */
  skipOriginBlock?: boolean;
}

/** DDA raycast. dir is normalized internally; maxDistance is euclidean world units.
 *
 *  **命中判定（B3 Task 5）**：命中的是**可命中**方塊（`world.isTargetable`）
 *  ＝實心方塊 **＋ cross 植被**（花／草）。植被不碰撞（走過去不會被擋），但
 *  必須能被瞄準、挖掘（硬度 0 → 瞬破，見 `interact.ts`）。水與空氣**不可命中**
 *  ——射線直接穿過水面。
 *
 *  `options.skipOriginBlock`：跳過原點所在的那一格（見 `RaycastOptions`）。 */
export function raycast(
  world: World,
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  maxDist: number,
  options?: RaycastOptions,
): RayHit | null {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (len === 0) return null;
  const dx = dir.x / len;
  const dy = dir.y / len;
  const dz = dir.z / len;
  const skipOriginBlock = options?.skipOriginBlock === true;

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
  // **例外（`skipOriginBlock`）**：原點所在的那一格不算目標 → 不early return，
  // 直接往下走 DDA：射線先走出那一格，再找下一個可命中方塊（`t` 仍從原點起算）。
  // **B3 Task 5**：判定是「可命中」（實心 ＋ cross 植被）→ 原點格是花／草時，
  // 第一人稱一樣在 `t = 0` 命中原點格（可以挖掉眼前那一朵）；第三身
  // （`skipOriginBlock`）則與實心格一致地被跳過。
  if (world.isTargetable(x, y, z) && !skipOriginBlock) {
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
    if (world.isTargetable(x, y, z)) {
      // 可命中 ＝ 實心方塊 ＋ cross 植被；水／空氣不可命中（射線穿過水面）
      return { x, y, z, nx, ny, nz, t };
    }
  }
  return null;
}
