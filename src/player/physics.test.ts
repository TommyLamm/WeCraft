import { describe, it, expect } from 'vitest';
import { stepPlayer, createPlayer, wallContactAngleDeg, supportedAt, PLAYER_HALF_WIDTH, PLAYER_HEIGHT, EYE_HEIGHT } from './physics';
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
    expect(EYE_HEIGHT).toBeCloseTo(1.62, 5);
  });

  it('fly off midair exits immediately and falls (no hover soft-lock)', () => {
    const w = flatWorld();
    const p = createPlayer(0.5, 90, 0.5);
    stepPlayer(p, { ...groundInput, fly: true }, w, 1 / 60);
    expect(p.flying).toBe(true);
    // 空中放開 fly：不需 onGround，應立刻脫離飛行
    stepPlayer(p, groundInput, w, 1 / 60);
    expect(p.flying).toBe(false);
    const y1 = p.position.y;
    for (let i = 0; i < 30; i++) stepPlayer(p, groundInput, w, 1 / 60);
    expect(p.flying).toBe(false);
    expect(p.position.y).toBeLessThan(y1 - 1); // 持續下落，非懸停
  });

  it('yaw sign pins: yaw=π/2 forward → -x, yaw=π forward → +z', () => {
    const w = flatWorld();
    const p1 = createPlayer(0.5, 65, 0.5);
    p1.yaw = Math.PI / 2;
    const x0 = p1.position.x;
    for (let i = 0; i < 60; i++) stepPlayer(p1, { ...groundInput, fwd: 1 }, w, 1 / 60);
    expect(p1.position.x).toBeLessThan(x0 - 1);

    const p2 = createPlayer(0.5, 65, 0.5);
    p2.yaw = Math.PI;
    const z0 = p2.position.z;
    for (let i = 0; i < 60; i++) stepPlayer(p2, { ...groundInput, fwd: 1 }, w, 1 / 60);
    expect(p2.position.z).toBeGreaterThan(z0 + 1);
  });

  it('wall exact contact: front face rests within 0.01 of wall face (both sides)', () => {
    const w = flatWorld();
    // 牆占 z∈[-2,-1]（方塊 z=-2），玩家由 +z 側逼近 → 前緣 (z-0.3) 應貼齊 -1
    for (let x = -4; x <= 4; x++)
      for (let y = 65; y <= 68; y++) w.setBlock(x, y, -2, BLOCK.STONE);
    const p = createPlayer(0.5, 65, 0.5);
    for (let i = 0; i < 300; i++) stepPlayer(p, { ...groundInput, fwd: 1 }, w, 1 / 60);
    const front = p.position.z - PLAYER_HALF_WIDTH;
    expect(front).toBeGreaterThanOrEqual(-1.01 - 1e-6);
    expect(front).toBeLessThanOrEqual(-1.0 + 1e-6);

    // 由 -z 側逼近（yaw=π → forward=+z），後緣 (z+0.3) 應貼齊 -2
    const p2 = createPlayer(0.5, 65, -4);
    p2.yaw = Math.PI;
    for (let i = 0; i < 300; i++) stepPlayer(p2, { ...groundInput, fwd: 1 }, w, 1 / 60);
    const back = p2.position.z + PLAYER_HALF_WIDTH;
    expect(back).toBeGreaterThanOrEqual(-2.01 - 1e-6);
    expect(back).toBeLessThanOrEqual(-2.0 + 1e-6);
  });

  it('jump under low ceiling stops with head flush and vy=0', () => {
    const w = flatWorld();
    // 天花板：y=67 方塊（佔 [67,68)），地板頂 65 → 跳起 0.2 即撞頭
    for (let x = -1; x <= 1; x++)
      for (let z = -1; z <= 1; z++) w.setBlock(x, 67, z, BLOCK.STONE);
    const p = createPlayer(0.5, 65, 0.5);
    stepPlayer(p, groundInput, w, 1 / 60);
    expect(p.onGround).toBe(true);
    const jumpInput = { ...groundInput, jump: true };
    let guard = 0;
    while (p.position.y + PLAYER_HEIGHT < 66.99 && guard++ < 200) {
      stepPlayer(p, jumpInput, w, 1 / 60);
    }
    expect(guard).toBeLessThan(200);
    const head = p.position.y + PLAYER_HEIGHT;
    expect(p.velocity.y).toBe(0);
    expect(head).toBeGreaterThanOrEqual(66.99 - 1e-6);
    expect(head).toBeLessThanOrEqual(67 + 1e-6);
  });

  it('sprint and sneak speeds are exact', () => {
    const w = flatWorld();
    const p = createPlayer(0.5, 65, 0.5);
    for (let i = 0; i < 60; i++) stepPlayer(p, groundInput, w, 1 / 60);
    let z0 = p.position.z;
    for (let i = 0; i < 60; i++) stepPlayer(p, { ...groundInput, fwd: 1, sprint: true }, w, 1 / 60);
    expect(z0 - p.position.z).toBeCloseTo(5.6, 5);

    const p2 = createPlayer(0.5, 65, 0.5);
    for (let i = 0; i < 60; i++) stepPlayer(p2, groundInput, w, 1 / 60);
    z0 = p2.position.z;
    for (let i = 0; i < 60; i++) stepPlayer(p2, { ...groundInput, fwd: 1, sneak: true }, w, 1 / 60);
    expect(z0 - p2.position.z).toBeCloseTo(1.3, 5);
  });
});

describe('wall contact angle — 撞牆夾角回報 (B2.1)', () => {
  it('wallContactAngleDeg measures the angle between the movement and the wall face', () => {
    // 語意：回傳「移動方向與『被擋住那面牆的表面』的夾角」→ 正面撞 = 90°、沿牆擦過 ≈ 0°
    // （wiki：「Sprinting ends when the player collides with a solid block at an angle of
    //   greater than 8 degrees」→ 正面撞（90°）取消疾跑、擦邊（<8°）不取消）。
    // 被擋的軸是 'z' → 取 |dir.z|：z 分量越大＝越「正面」撞上 z 方向的牆。
    expect(wallContactAngleDeg({ x: 0, z: -1 }, 'z')).toBeCloseTo(90, 5); // 正面撞 → 90°（>8° → 取消疾跑）
    expect(wallContactAngleDeg({ x: 0.9987, z: -0.05 }, 'z')).toBeCloseTo(2.87, 1); // 擦邊（沿牆走）→ 2.87°（<8° → 不取消）
    expect(wallContactAngleDeg({ x: 0.7071, z: -0.7071 }, 'z')).toBeCloseTo(45, 1); // 斜撞 → 45°
  });

  it('wallContactAngleDeg applies the same rule to the x axis', () => {
    // 被擋的是 x 軸 → 取 |dir.x|：x 分量越大＝越「正面」撞上 x 方向的牆
    expect(wallContactAngleDeg({ x: -1, z: 0 }, 'x')).toBeCloseTo(90, 5);
    expect(wallContactAngleDeg({ x: -0.05, z: 0.9987 }, 'x')).toBeCloseTo(2.87, 1);
  });

  it('stepPlayer reports no wall angle on flat ground', () => {
    const w = flatWorld();
    const p = createPlayer(0.5, 70, 0.5);
    for (let i = 0; i < 120; i++) stepPlayer(p, groundInput, w, 1 / 60);
    expect(p.onGround).toBe(true);
    const res = stepPlayer(p, { ...groundInput, fwd: 1 }, w, 1 / 60);
    expect(res.wallAngleDeg).toBeNull();
  });

  it('running head on into a wall reports 90 degrees', () => {
    const w = flatWorld();
    // 在 z=-2 處建牆（高於地面）
    for (let x = -4; x <= 4; x++)
      for (let y = 65; y <= 68; y++) w.setBlock(x, y, -2, BLOCK.STONE);
    const p = createPlayer(0.5, 65, 0.5);
    let res = { wallAngleDeg: null as number | null };
    for (let i = 0; i < 300 && res.wallAngleDeg === null; i++) {
      res = stepPlayer(p, { ...groundInput, fwd: 1 }, w, 1 / 60);
    }
    expect(res.wallAngleDeg).toBeCloseTo(90, 5);
  });

  it('a diagonal wall collision reports about 45 degrees', () => {
    const w = flatWorld();
    // 同一面牆，改用斜向前進（fwd + strafe → 方向正規化為 45°）
    for (let x = -4; x <= 4; x++)
      for (let y = 65; y <= 68; y++) w.setBlock(x, y, -2, BLOCK.STONE);
    const p = createPlayer(0.5, 65, 0.5);
    let res = { wallAngleDeg: null as number | null };
    for (let i = 0; i < 300 && res.wallAngleDeg === null; i++) {
      res = stepPlayer(p, { ...groundInput, fwd: 1, strafe: 1 }, w, 1 / 60);
    }
    expect(res.wallAngleDeg).toBeCloseTo(45, 0);
  });
});

/** 小平台：y=64 上的 3×3 石頭板（方塊 x,z ∈ [0,2] → 邊界在 x=3／z=3） */
function platformWorld(): World {
  const w = new World();
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) w.setBlock(x, 64, z, BLOCK.STONE);
  return w;
}

describe('sneak edge protection — 潛行防摔邊 (B2.3)', () => {
  it('sneaking keeps the player from walking off the edge', () => {
    const w = platformWorld();
    const p = createPlayer(2.5, 65, 1.5); // 站在 x=2 這塊板的右緣（中心點在板上）
    for (let i = 0; i < 60; i++) stepPlayer(p, { ...groundInput, sneak: true, strafe: 1 }, w, 1 / 60);
    expect(p.position.x).toBeLessThan(3.0); // 中心點沒走出這塊板（身體可探出邊緣）
    expect(p.position.x).toBeGreaterThan(2.9);
    expect(p.position.y).toBeCloseTo(65, 5); // 沒有掉下去
    expect(p.onGround).toBe(true);
  });

  it('walking without sneak falls off the edge', () => {
    const w = platformWorld();
    const p = createPlayer(2.5, 65, 1.5);
    for (let i = 0; i < 60; i++) stepPlayer(p, { ...groundInput, strafe: 1 }, w, 1 / 60);
    expect(p.position.y).toBeLessThan(64);
  });

  it('jumping while sneaking still leaves the edge', () => {
    const w = platformWorld();
    const p = createPlayer(2.5, 65, 1.5);
    for (let i = 0; i < 60; i++) stepPlayer(p, { ...groundInput, sneak: true, strafe: 1, jump: true }, w, 1 / 60);
    expect(p.position.x).toBeGreaterThan(3.0);
  });

  it('supportedAt reports the platform and the void', () => {
    const w = platformWorld();
    expect(supportedAt(w, 1.5, 65, 1.5)).toBe(true);
    expect(supportedAt(w, 3.5, 65, 1.5)).toBe(false);
  });

  it('sneaking at the edge does not report a wall angle', () => {
    // 潛行「取消位移」不是撞牆 → 不得走撞牆夾角回報路徑（否則會誤觸疾跑取消）
    const w = platformWorld();
    const p = createPlayer(2.5, 65, 1.5);
    let res = { wallAngleDeg: null as number | null };
    for (let i = 0; i < 60; i++) res = stepPlayer(p, { ...groundInput, sneak: true, strafe: 1 }, w, 1 / 60);
    expect(res.wallAngleDeg).toBeNull();
  });
});
