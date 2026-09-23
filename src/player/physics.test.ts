import { describe, it, expect } from 'vitest';
import { stepPlayer, createPlayer, PLAYER_HALF_WIDTH, PLAYER_HEIGHT } from './physics';
import { World } from '../world/world';
import { Chunk } from '../world/chunk';
import { BLOCK } from '../world/blocks';

/** 平台：y<=64 滿鋪石頭的無限世界（用大範圍 fill 模擬） */
function flatWorld(): World {
  const w = new World();
  const add = (cx: number, cz: number) => {
    if (!w.hasChunk(cx, cz)) w.addChunk(new Chunk(cx, cz));
  };
  for (let cx = -2; cx <= 2; cx++)
    for (let cz = -2; cz <= 2; cz++) {
      add(cx, cz);
      for (let x = 0; x < 16; x++)
        for (let z = 0; z < 16; z++)
          for (let y = 0; y <= 64; y++)
            w.setBlock(cx * 16 + x, y, cz * 16 + z, BLOCK.STONE);
    }
  return w;
}

const groundInput = { fwd: 0, strafe: 0, jump: false, sneak: false, sprint: false, fly: false, flyUp: false, flyDown: false };

describe('stepPlayer', () => {
  it('spawns above ground and lands on surface', () => {
    const w = flatWorld();
    const p = createPlayer(0.5, 70, 0.5);
    for (let i = 0; i < 120; i++) stepPlayer(p, groundInput, w, 1 / 60);
    // 腳應落在 y=65（64 方塊頂面）
    expect(p.position.y).toBeCloseTo(65, 1);
    expect(p.onGround).toBe(true);
  });

  it('does not fall through ground', () => {
    const w = flatWorld();
    const p = createPlayer(0.5, 66, 0.5);
    for (let i = 0; i < 300; i++) stepPlayer(p, groundInput, w, 1 / 60);
    expect(p.position.y).toBeGreaterThanOrEqual(64.99);
  });

  it('jump leaves ground and lands again', () => {
    const w = flatWorld();
    const p = createPlayer(0.5, 70, 0.5);
    for (let i = 0; i < 120; i++) stepPlayer(p, groundInput, w, 1 / 60);
    expect(p.onGround).toBe(true);
    stepPlayer(p, { ...groundInput, jump: true }, w, 1 / 60);
    expect(p.velocity.y).toBeGreaterThan(0);
    expect(p.onGround).toBe(false);
    let peak = p.position.y;
    for (let i = 0; i < 180; i++) {
      stepPlayer(p, groundInput, w, 1 / 60);
      peak = Math.max(peak, p.position.y);
    }
    expect(peak).toBeGreaterThan(66); // 跳高 > 1 格
    expect(p.position.y).toBeCloseTo(65, 1);
  });

  it('forward movement changes z position', () => {
    const w = flatWorld();
    const p = createPlayer(0.5, 70, 0.5);
    for (let i = 0; i < 120; i++) stepPlayer(p, groundInput, w, 1 / 60);
    const z0 = p.position.z;
    // yaw=0 → forward = -z（three.js 慣例）
    for (let i = 0; i < 60; i++) stepPlayer(p, { ...groundInput, fwd: 1 }, w, 1 / 60);
    expect(p.position.z).toBeLessThan(z0 - 1);
  });

  it('collides with wall and does not tunnel', () => {
    const w = flatWorld();
    // 在 z=-2 處建牆（高於地面）
    for (let x = -4; x <= 4; x++)
      for (let y = 65; y <= 68; y++) w.setBlock(x, y, -2, BLOCK.STONE);
    const p = createPlayer(0.5, 65, 0.5);
    for (let i = 0; i < 300; i++) stepPlayer(p, { ...groundInput, fwd: 1 }, w, 1 / 60);
    // 玩家不可穿過 z=-2 牆（身體前緣不得超過 -1.x）
    const front = p.position.z - PLAYER_HALF_WIDTH;
    expect(front).toBeGreaterThanOrEqual(-2 - 1e-6);
  });

  it('fly mode ignores gravity', () => {
    const w = flatWorld();
    const p = createPlayer(0.5, 90, 0.5);
    const flyIn = { ...groundInput, fly: true };
    const y0 = p.position.y;
    for (let i = 0; i < 60; i++) stepPlayer(p, flyIn, w, 1 / 60);
    expect(p.position.y).toBeCloseTo(y0, 1);
  });

  it('fly up responds to flyUp', () => {
    const w = flatWorld();
    const p = createPlayer(0.5, 90, 0.5);
    for (let i = 0; i < 30; i++)
      stepPlayer(p, { ...groundInput, fly: true, flyUp: true }, w, 1 / 60);
    expect(p.position.y).toBeGreaterThan(90);
  });

  it('player box constants match spec', () => {
    expect(PLAYER_HALF_WIDTH).toBeCloseTo(0.3, 5);
    expect(PLAYER_HEIGHT).toBeCloseTo(1.8, 5);
  });
});
