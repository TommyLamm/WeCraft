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
): void {
  if (!Number.isFinite(dt)) return;
  const steps = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) stepOnce(p, input, world, h);
}

function stepOnce(
  p: PlayerState,
  input: MoveInput,
  world: World,
  dt: number,
): void {
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
  moveAxis(p, world, 'x', p.velocity.x * dt);
  moveAxis(p, world, 'z', p.velocity.z * dt);
  moveAxis(p, world, 'y', p.velocity.y * dt);
}

function moveAxis(
  p: PlayerState,
  world: World,
  axis: 'x' | 'y' | 'z',
  delta: number,
): void {
  if (delta === 0) return;
  const pos = p.position;
  pos[axis] += delta;

  if (!boxCollides(world, pos.x, pos.y, pos.z)) {
    if (axis === 'y') p.onGround = false;
    return;
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
}
