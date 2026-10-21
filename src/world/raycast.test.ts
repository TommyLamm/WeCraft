import { describe, it, expect } from 'vitest';
import { raycast, reachFor } from './raycast';
import { World } from './world';
import { Chunk } from './chunk';
import { BLOCK } from './blocks';

function setup(): World {
  const w = new World();
  w.addChunk(new Chunk(0, 0));
  return w;
}

describe('raycast', () => {
  it('hits block straight ahead and reports face normal', () => {
    const w = setup();
    w.setBlock(0, 64, -3, BLOCK.STONE);
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: -1 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBe(0);
    expect(hit!.y).toBe(64);
    expect(hit!.z).toBe(-3);
    expect(hit!.nz).toBe(1);
  });

  it('returns null when no block in range', () => {
    const w = setup();
    const hit = raycast(w, { x: 0.5, y: 80, z: 0.5 }, { x: 0, y: 1, z: 0 }, 5);
    expect(hit).toBeNull();
  });

  it('respects max distance', () => {
    const w = setup();
    w.setBlock(0, 64, -8, BLOCK.STONE);
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: -1 }, 5);
    expect(hit).toBeNull();
  });

  it('does not hit water (non-solid)', () => {
    const w = setup();
    w.setBlock(0, 64, -2, BLOCK.WATER);
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: -1 }, 10);
    expect(hit).toBeNull();
  });

  it('hits glass (solid)', () => {
    const w = setup();
    w.setBlock(0, 64, -2, BLOCK.GLASS);
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: -1 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.z).toBe(-2);
  });

  it('hits correct block along diagonal ray (interleaved tMax path)', () => {
    const w = setup();
    w.setBlock(1, 65, 0, BLOCK.STONE);
    const inv = Math.SQRT1_2;
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: inv, y: inv, z: 0 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBe(1);
    expect(hit!.y).toBe(65);
    expect(hit!.z).toBe(0);
    expect(hit!.nx).toBe(-1);
    expect(hit!.ny).toBe(0);
    expect(hit!.nz).toBe(0);
  });

  it('start-inside-solid returns single-axis normal for diagonal dir', () => {
    const w = setup();
    w.setBlock(0, 64, 0, BLOCK.STONE);
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0.7, y: -0.7, z: 0 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBe(0);
    expect(hit!.y).toBe(64);
    expect(hit!.z).toBe(0);
    const axes = [Math.abs(hit!.nx), Math.abs(hit!.ny), Math.abs(hit!.nz)];
    expect(axes.filter((a) => a === 1)).toHaveLength(1);
    expect(axes.filter((a) => a === 0)).toHaveLength(2);
    expect(axes[0]).toBe(1);
    expect(hit!.nx).toBe(-1);
  });

  it('start-inside-solid returns single-axis normal for axis-aligned dir', () => {
    const w = setup();
    w.setBlock(0, 64, 0, BLOCK.STONE);
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: -1 }, 10);
    expect(hit).not.toBeNull();
    const axes = [Math.abs(hit!.nx), Math.abs(hit!.ny), Math.abs(hit!.nz)];
    expect(axes.filter((a) => a === 1)).toHaveLength(1);
    expect(axes.filter((a) => a === 0)).toHaveLength(2);
    expect(hit!.nz).toBe(1);
    expect(hit!.nx).toBe(0);
    expect(hit!.ny).toBe(0);
  });

  it('hits block with mixed-sign direction (x>0, y<0)', () => {
    const w = setup();
    w.setBlock(1, 63, 0, BLOCK.STONE);
    const inv = Math.SQRT1_2;
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: inv, y: -inv, z: 0 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBe(1);
    expect(hit!.y).toBe(63);
    expect(hit!.z).toBe(0);
    expect(hit!.nx).toBe(-1);
    expect(hit!.ny).toBe(0);
    expect(hit!.nz).toBe(0);
  });

  it('returns hit exactly at maxDistance and null just beyond', () => {
    const w = setup();
    w.setBlock(0, 64, -3, BLOCK.STONE);
    const dir = { x: 0, y: 0, z: -1 };
    const origin = { x: 0.5, y: 64.5, z: 0.5 };
    const hit = raycast(w, origin, dir, 2.5);
    expect(hit).not.toBeNull();
    expect(hit!.z).toBe(-3);
    expect(hit!.t).toBe(2.5);
    const miss = raycast(w, origin, dir, 2.4);
    expect(miss).toBeNull();
  });

  it('returns null for zero-length dir', () => {
    const w = setup();
    w.setBlock(0, 64, 0, BLOCK.STONE);
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: 0 }, 10);
    expect(hit).toBeNull();
  });
});

describe('reachFor (Task 5)', () => {
  it('creative reaches 5 blocks, survival 4.5', () => {
    expect(reachFor('creative')).toBe(5);
    expect(reachFor('survival')).toBe(4.5);
  });

  it('creative reach hits a block at t=5 that survival cannot reach', () => {
    const w = setup();
    // origin z = 0 → cell z = -6 is entered at exactly t = 5
    w.setBlock(0, 64, -6, BLOCK.STONE);
    const origin = { x: 0.5, y: 64.5, z: 0 };
    const dir = { x: 0, y: 0, z: -1 };
    expect(raycast(w, origin, dir, reachFor('survival'))).toBeNull();
    const hit = raycast(w, origin, dir, reachFor('creative'));
    expect(hit).not.toBeNull();
    expect(hit!.z).toBe(-6);
    expect(hit!.t).toBe(5);
  });

  it('survival reach still hits a block at t=4.5 (boundary is inclusive)', () => {
    const w = setup();
    w.setBlock(0, 64, -5, BLOCK.STONE); // from origin z = 0.5, cell z=-5 enters at t = 4.5
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: -1 }, reachFor('survival'));
    expect(hit).not.toBeNull();
    expect(hit!.t).toBe(4.5);
  });
});

/** B2.4 第三身相機護欄：射線原點在實心方塊內時，那一格不得成為互動目標
 *  （相機卡在土坡／牆裡時，不該挖到一個玩家看不見的方塊）。 */
describe('raycast skipOriginBlock (B2.4 第三身相機護欄)', () => {
  it('不傳選項時維持既有行為：原點在實心方塊內 → t=0 命中原點格', () => {
    const w = setup();
    w.setBlock(0, 64, 0, BLOCK.STONE);
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: -1 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBe(0);
    expect(hit!.y).toBe(64);
    expect(hit!.z).toBe(0);
    expect(hit!.t).toBe(0);
  });

  it('skipOriginBlock：原點所在的那一格被跳過，命中下一個實心方塊', () => {
    const w = setup();
    w.setBlock(0, 64, 0, BLOCK.STONE); // 原點所在格（相機卡在這裡）
    w.setBlock(0, 64, -2, BLOCK.STONE); // 走出原點格後的第一個實心方塊
    const hit = raycast(
      w,
      { x: 0.5, y: 64.5, z: 0.5 },
      { x: 0, y: 0, z: -1 },
      10,
      { skipOriginBlock: true },
    );
    expect(hit).not.toBeNull();
    expect(hit!.x).toBe(0);
    expect(hit!.y).toBe(64);
    expect(hit!.z).toBe(-2);
    expect(hit!.t).toBe(1.5);
    // 真正的入射面法線（+z 面朝向射線來向）
    expect(hit!.nz).toBe(1);
    expect(hit!.nx).toBe(0);
    expect(hit!.ny).toBe(0);
  });

  it('skipOriginBlock：原點格之外沒有實心方塊 → null（不會退回去命中原點格）', () => {
    const w = setup();
    w.setBlock(0, 64, 0, BLOCK.STONE);
    const hit = raycast(
      w,
      { x: 0.5, y: 64.5, z: 0.5 },
      { x: 0, y: 0, z: -1 },
      10,
      { skipOriginBlock: true },
    );
    expect(hit).toBeNull();
  });

  it('skipOriginBlock：原點在空氣中時結果與既有行為逐值相同', () => {
    const w = setup();
    w.setBlock(0, 64, -3, BLOCK.STONE);
    const origin = { x: 0.5, y: 64.5, z: 0.5 };
    const dir = { x: 0, y: 0, z: -1 };
    const plain = raycast(w, origin, dir, 10);
    const guarded = raycast(w, origin, dir, 10, { skipOriginBlock: true });
    expect(plain).not.toBeNull();
    expect(guarded).toEqual(plain);
  });

  it('skipOriginBlock：t 仍從原點起算（reach 預算不因跳過而改變）', () => {
    const w = setup();
    w.setBlock(0, 64, 0, BLOCK.STONE); // 原點所在格
    w.setBlock(0, 64, -2, BLOCK.STONE); // t = 1.5 才進得到
    const hit = raycast(
      w,
      { x: 0.5, y: 64.5, z: 0.5 },
      { x: 0, y: 0, z: -1 },
      1.4,
      { skipOriginBlock: true },
    );
    expect(hit).toBeNull(); // 1.4 < 1.5 → 超過 reach
  });
});

/** B3 Task 5：射線的命中判定改用「可命中」（實心 ＋ cross 植被）。
 *  植被不碰撞（走不過去、不擋視線），但**必須能被瞄準、挖掘**（硬度 0 → 瞬破）；
 *  水與空氣仍然不可命中（射線直接穿過水面）。 */
describe('raycast 可命中判定（B3 Task 5：植被可命中、水／空氣不可命中）', () => {
  it('a flower is hit by the ray even though it is not solid', () => {
    const w = setup();
    w.setBlock(5, 64, 4, BLOCK.DANDELION); // cross 植被：solid = false
    // 起點格 (5,64,5) 是空氣 → 不會走「起點在方塊內」分支
    const hit = raycast(w, { x: 5.5, y: 64.5, z: 5.5 }, { x: 0, y: 0, z: -1 }, 4);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBe(5);
    expect(hit!.y).toBe(64);
    expect(hit!.z).toBe(4);
    expect(hit!.t).toBe(0.5);
    expect(hit!.nz).toBe(1); // 從 +z 側進入 → 法線朝射線來向
  });

  it('air and water are still not hittable', () => {
    const w = setup();
    w.setBlock(0, 64, -2, BLOCK.WATER);
    w.setBlock(0, 64, -4, BLOCK.STONE);
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: -1 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.z).toBe(-4); // 射線穿過水格（不可命中）→ 命中水後方的實心方塊
    expect(hit!.t).toBe(3.5); // 原點 z=0.5 → 走 3.5 格進到 cell z=-4
  });

  it('a solid block behind a flower is still hit when the flower is not in the way', () => {
    const w = setup();
    w.setBlock(6, 64, 0, BLOCK.DANDELION); // 花不在射線路徑上
    w.setBlock(0, 64, -4, BLOCK.STONE);
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: -1 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.z).toBe(-4);
  });

  it('a plant in the origin cell is hit at t=0 (first person: the eye cell is a valid target)', () => {
    const w = setup();
    w.setBlock(5, 64, 5, BLOCK.DANDELION); // 原點所在格
    const hit = raycast(w, { x: 5.5, y: 64.5, z: 5.5 }, { x: 0, y: 0, z: -1 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBe(5);
    expect(hit!.y).toBe(64);
    expect(hit!.z).toBe(5);
    expect(hit!.t).toBe(0);
  });

  it('skipOriginBlock：原點格的植被與實心方塊一樣被跳過（第三身相機護欄一致）', () => {
    const w = setup();
    w.setBlock(5, 64, 5, BLOCK.DANDELION); // 原點所在格（相機卡在花裡）
    w.setBlock(5, 64, 3, BLOCK.STONE); // 走出原點格後的第一個實心方塊
    const hit = raycast(
      w,
      { x: 5.5, y: 64.5, z: 5.5 },
      { x: 0, y: 0, z: -1 },
      10,
      { skipOriginBlock: true },
    );
    expect(hit).not.toBeNull();
    expect(hit!.x).toBe(5);
    expect(hit!.y).toBe(64);
    expect(hit!.z).toBe(3);
    expect(hit!.t).toBe(1.5);
    expect(hit!.nz).toBe(1); // 真正的入射面法線
  });
});
