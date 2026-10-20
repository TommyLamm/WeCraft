/** 玩家物理：位置積分、逐軸解碰撞、撞牆夾角回報、潛行防摔邊。
 *
 *  **撞牆夾角語意（B2.1）**：物理層只回報「本次步進撞到方塊的角度」，**不做門檻
 *  判斷**。原版 wiki Sprinting §Usage：「Sprinting ends when the player collides
 *  with a solid block at an angle of greater than 8 degrees」→ 本層回報的角度是
 *  「移動方向與『被擋住那面牆的表面』的夾角」：**正面撞＝90°、沿牆擦過≈0°**
 *  （所以正面撞牆的角度大於沿牆擦過）。8° 門檻由 `src/player/sprint.ts` 判定
 *  （`SPRINT_WALL_ANGLE_DEG`），不在此層。
 *
 *  **潛行防摔邊語意（B2.3）**：潛行**且著地**時，若水平位移會讓腳下失去支撐，就
 *  **取消該軸位移**（x／z 各自獨立判斷）。語意對應 minecraft.wiki/Sneaking
 *  §Effects：「Players are prevented from walking off edges … as long as they are
 *  up to 0.6 blocks above the ground」，以及 spec §B2.3。
 *
 *  本批**兩處刻意簡化**（與原版的差異，勿誤讀為原版行為）：
 *  ① 支撐判定只看「腳下正下方（玩家中心點）一格」（`supportedAt`）；原版以
 *     **整個 hitbox 是否仍被支撐**判定 → 本批中心點不越過方塊邊界，原版可讓身體
 *     探出邊緣約半個身位。
 *  ② **不做** step_height 0.6 的高度差判斷，也**不做**「離地 0.6 格內仍受保護」。
 *  起跳後（離地）保護即解除 → 可跳離邊緣（對應 wiki「can still dismount blocks
 *  while sneaking by jumping over the block's edge」）。 */

import type { World } from '../world/world';
import { BLOCK } from '../world/blocks';

export const PLAYER_HALF_WIDTH = 0.3;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;
const GRAVITY = 32;
const JUMP_SPEED = 9;
const WALK_SPEED = 4.3;
const SPRINT_SPEED = 5.6;
const SNEAK_SPEED = 1.3;
const FLY_SPEED = 10;
const TERMINAL_VELOCITY = 50;
const IN_WATER_DRAG = 0.5;
const MAX_SUBSTEP = 0.05;

export interface PlayerState {
  position: { x: number; y: number; z: number }; // 腳底中心
  velocity: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  onGround: boolean;
  flying: boolean;
  inWater: boolean;
}

export interface MoveInput {
  fwd: number; // -1..1
  strafe: number; // -1..1
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
  fly: boolean;
  flyUp: boolean;
  flyDown: boolean;
}

/** 一次 `stepPlayer` 的結果（回傳全新物件，入參不被修改）。 */
export interface StepResult {
  /** 本次步進的最大撞牆夾角（度）；無撞牆為 null */
  wallAngleDeg: number | null;
}

/** 移動方向與「被擋住那面牆的表面」的夾角（度）。
 *
 *  語意：**正面撞＝90°、沿牆擦過≈0°**（見檔頭註解）。`axis` 是「被擋住的那個
 *  軸」：被擋的是 `z` 軸 → 牆面法線沿 z → 夾角由移動方向的 z 分量決定（z 分量
 *  越大＝越正面撞上 z 方向的牆）；`x` 軸同理。
 *
 *  `dir` 應為**單位長度**的方向向量（`stepOnce` 內的 `dirX/dirZ` 即是）→ 該軸
 *  分量的絕對值就是夾角的正弦值；非有限輸入回 0（不讓 NaN 滲出）、分量上限
 *  截到 1（避免 `asin` 的定義域問題）。 */
export function wallContactAngleDeg(dir: { x: number; z: number }, axis: 'x' | 'z'): number {
  const component = axis === 'x' ? dir.x : dir.z;
  if (!Number.isFinite(component)) return 0;
  const c = Math.min(1, Math.abs(component));
  return (Math.asin(c) * 180) / Math.PI;
}

export function createPlayer(x: number, y: number, z: number): PlayerState {
  return {
    position: { x, y, z },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    onGround: false,
    flying: false,
    inWater: false,
  };
}

/** 「腳下正下方」是否為實心方塊（純查詢，不改任何狀態）。
 *
 *  潛行防摔邊的支撐判定：只看玩家**中心點正下方那一格**——`floor(feetY - 0.05)`
 *  → 腳底所在那一層（站在 y=64 方塊上時 feetY=65 → 查 y=64 那一格）。
 *  非有限座標一律回 false（不讓 NaN 滲出成「有支撐」）。 */
export function supportedAt(world: World, feetX: number, feetY: number, feetZ: number): boolean {
  if (!Number.isFinite(feetX) || !Number.isFinite(feetY) || !Number.isFinite(feetZ)) return false;
  return world.isSolid(Math.floor(feetX), Math.floor(feetY - 0.05), Math.floor(feetZ));
}

/** 玩家 AABB 是否與實心方塊重疊 */
function boxCollides(world: World, px: number, py: number, pz: number): boolean {
  const minX = px - PLAYER_HALF_WIDTH;
  const maxX = px + PLAYER_HALF_WIDTH;
  const minY = py;
  const maxY = py + PLAYER_HEIGHT;
  const minZ = pz - PLAYER_HALF_WIDTH;
  const maxZ = pz + PLAYER_HALF_WIDTH;
  for (let x = Math.floor(minX); x <= Math.floor(maxX - 1e-9); x++) {
    for (let y = Math.floor(minY); y <= Math.floor(maxY - 1e-9); y++) {
      for (let z = Math.floor(minZ); z <= Math.floor(maxZ - 1e-9); z++) {
        if (world.isSolid(x, y, z)) return true;
      }
    }
  }
  return false;
}

/** dt is substepped internally (≤0.05s); safe to pass raw frame dt. */
export function stepPlayer(
  p: PlayerState,
  input: MoveInput,
  world: World,
  dt: number,
): StepResult {
  if (!Number.isFinite(dt)) return { wallAngleDeg: null };
  const steps = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
  const h = dt / steps;
  // 跨子步取最大撞牆夾角（任一子步撞到就回報；沒撞到 → null）
  let wallAngleDeg: number | null = null;
  for (let i = 0; i < steps; i++) {
    const substepAngle = stepOnce(p, input, world, h);
    if (substepAngle !== null && (wallAngleDeg === null || substepAngle > wallAngleDeg)) {
      wallAngleDeg = substepAngle;
    }
  }
  return { wallAngleDeg };
}

function stepOnce(
  p: PlayerState,
  input: MoveInput,
  world: World,
  dt: number,
): number | null {
  // 水檢查（腳或頭）
  const feetId = world.getBlock(Math.floor(p.position.x), Math.floor(p.position.y + 0.1), Math.floor(p.position.z));
  const headId = world.getBlock(Math.floor(p.position.x), Math.floor(p.position.y + 1.6), Math.floor(p.position.z));
  p.inWater = feetId === BLOCK.WATER || headId === BLOCK.WATER;

  // 飛行切換由外部（double-space）處理；這裡只執行
  if (input.fly && !p.flying) {
    p.flying = true;
    p.velocity.y = 0;
  }
  if (!input.fly && p.flying) {
    p.flying = false;
  }

  // 水平移動方向（yaw 慣例：yaw=0 面向 -z）
  const yawOk = Number.isFinite(p.yaw);
  const sin = yawOk ? Math.sin(p.yaw) : 0;
  const cos = yawOk ? Math.cos(p.yaw) : 1;
  let dirX = input.strafe * cos - input.fwd * sin;
  let dirZ = -input.strafe * sin - input.fwd * cos;
  if (!yawOk || !Number.isFinite(dirX)) dirX = 0;
  if (!yawOk || !Number.isFinite(dirZ)) dirZ = 0;
  const len = Math.hypot(dirX, dirZ);
  if (len > 1) {
    dirX /= len;
    dirZ /= len;
  }

  let speed = WALK_SPEED;
  if (p.flying) speed = FLY_SPEED;
  else if (input.sneak) speed = SNEAK_SPEED;
  else if (input.sprint) speed = SPRINT_SPEED;
  if (p.inWater && !p.flying) speed *= 0.5;

  if (p.flying) {
    p.velocity.x = dirX * speed;
    p.velocity.z = dirZ * speed;
    p.velocity.y = (input.flyUp ? 1 : 0) * speed + (input.flyDown ? -1 : 0) * speed;
  } else {
    p.velocity.x = dirX * speed;
    p.velocity.z = dirZ * speed;

    if (p.inWater) {
      p.velocity.y -= GRAVITY * IN_WATER_DRAG * dt;
      p.velocity.y *= 0.9;
      if (input.jump) p.velocity.y = 4;
      p.velocity.y = Math.max(p.velocity.y, -4);
    } else {
      p.velocity.y -= GRAVITY * dt;
      if (input.jump && p.onGround) {
        p.velocity.y = JUMP_SPEED;
        p.onGround = false;
      }
    }
    p.velocity.y = Math.max(p.velocity.y, -TERMINAL_VELOCITY);
  }

  // 逐軸移動 + 解碰撞
  // 潛行防摔邊（B2.3）：只有「潛行 ＋ 著地 ＋ 非飛行 ＋ 非水中」才啟用保護。
  // 起跳時上面的 jump 分支已把 onGround 清成 false → 保護解除 → 可跳離邊緣。
  const guardSneakEdge = input.sneak && p.onGround && !p.flying && !p.inWater;
  const blockedX = moveAxis(p, world, 'x', p.velocity.x * dt, guardSneakEdge);
  const blockedZ = moveAxis(p, world, 'z', p.velocity.z * dt, guardSneakEdge);
  moveAxis(p, world, 'y', p.velocity.y * dt);

  // 撞牆夾角：只算水平兩軸（y 軸被擋＝站在地上／撞到天花板，不是牆）。
  // 兩軸都被擋＝撞到角落 → 取較大的那一個角度。
  // dirX/dirZ 是移動方向（輸入層的 fwd/strafe 只會是 -1/0/1 → 非零方向正規化後
  // 長度為 1）→ 分量的絕對值就是夾角的正弦值；角度與速度無關。
  let wallAngleDeg: number | null = null;
  if (blockedX) wallAngleDeg = wallContactAngleDeg({ x: dirX, z: dirZ }, 'x');
  if (blockedZ) {
    const angle = wallContactAngleDeg({ x: dirX, z: dirZ }, 'z');
    wallAngleDeg = wallAngleDeg === null ? angle : Math.max(wallAngleDeg, angle);
  }
  return wallAngleDeg;
}

/** 沿單軸移動並解碰撞；回傳「是否被方塊擋下」。
 *
 *  `guardSneakEdge`（潛行防摔邊，B2.3）只作用於水平軸：位移前先算候選位置，若
 *  候選位置「腳下正下方」沒有支撐（`supportedAt`）就**取消該軸位移**——位置與
 *  速度都不變（仍可繼續輸入，會反覆被擋）。回傳 false：潛行取消位移**不是**撞牆，
 *  不能走撞牆夾角回報路徑（否則會誤觸疾跑取消）。 */
function moveAxis(
  p: PlayerState,
  world: World,
  axis: 'x' | 'y' | 'z',
  delta: number,
  guardSneakEdge = false,
): boolean {
  if (delta === 0) return false;
  const pos = p.position;
  if (guardSneakEdge && axis !== 'y') {
    const candidateX = axis === 'x' ? pos.x + delta : pos.x;
    const candidateZ = axis === 'z' ? pos.z + delta : pos.z;
    if (!supportedAt(world, candidateX, pos.y, candidateZ)) return false; // 取消該軸位移
  }
  pos[axis] += delta;

  if (!boxCollides(world, pos.x, pos.y, pos.z)) {
    if (axis === 'y') p.onGround = false;
    return false;
  }

  // 推回：沿軸退回直到不重疊（0.01 粒度）
  const step = Math.sign(delta) * 0.01;
  let safety = 0;
  while (boxCollides(world, pos.x, pos.y, pos.z) && safety++ < 500) {
    pos[axis] -= step;
  }
  // 微調回 0.01 內
  if (!boxCollides(world, pos.x, pos.y, pos.z)) {
    pos[axis] += step;
    if (boxCollides(world, pos.x, pos.y, pos.z)) pos[axis] -= step;
  }

  if (axis === 'y') {
    p.velocity.y = 0;
    if (delta < 0) {
      p.onGround = true;
      // 對齊到腳下方塊頂面（退回終點 ∈ [S, S+0.01)，S 為整數面）
      const prev = pos.y;
      pos.y = Math.floor(pos.y + 1e-9);
      if (boxCollides(world, pos.x, pos.y, pos.z)) pos.y = prev;
    } else {
      p.onGround = false;
    }
  } else {
    p.velocity[axis] = 0;
  }
  return true; // 被方塊擋下
}
