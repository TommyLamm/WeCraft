import { describe, it, expect } from 'vitest';
import {
  spawnDrop,
  stepDrops,
  pickable,
  pickup,
  dropItemFor,
  chanceDropFor,
  LEAF_APPLE_CHANCE,
  GRAVITY,
  SPAWN_PICKUP_DELAY,
  PLAYER_DROP_PICKUP_DELAY,
  PLAYER_DROP_THROW_SPEED,
  PLAYER_DROP_LIFT_SPEED,
  PLAYER_DROP_FORWARD_OFFSET,
  PLAYER_DROP_HEIGHT_OFFSET,
  DESPAWN_AGE,
  SETTLE_OFFSET,
  type DropEntity,
  type SpawnDropOptions,
} from './drops';
import { createInventoryModel } from '../core/inventory';
import { BLOCK } from './blocks';

// ---- helpers -------------------------------------------------------------
/** No ground anywhere: drops free-fall forever. */
const noGround = (): boolean => false;
/** Flat world: everything below y = 0 is solid (ground top face at y = 0). */
const ground = (_x: number, y: number, _z: number): boolean => y < 0;

function falling(over: Partial<DropEntity> = {}): DropEntity {
  return {
    id: 1,
    item: 'dirt',
    count: 1,
    pos: { x: 0.5, y: 5, z: 0.5 },
    vel: { x: 0, y: 0, z: 0 },
    age: 0,
    pickupDelay: 0,
    bounced: false,
    ...over,
  };
}

describe('spawnDrop', () => {
  it('appends a new entity without mutating the input array', () => {
    const input: DropEntity[] = [];
    const out = spawnDrop(input, 'stone', 3, { x: 1, y: 2, z: 3 });
    expect(out).not.toBe(input);
    expect(input).toHaveLength(0); // pure: input untouched
    expect(out).toHaveLength(1);
    expect(out[0].item).toBe('stone');
    expect(out[0].count).toBe(3);
    expect(out[0].pos).toEqual({ x: 1, y: 2, z: 3 });
    expect(out[0].age).toBe(0);
    expect(out[0].bounced).toBe(false);
  });

  it('copies pos (mutating the caller does not touch the entity)', () => {
    const pos = { x: 1, y: 2, z: 3 };
    const [d] = spawnDrop([], 'dirt', 1, pos);
    pos.x = 99;
    expect(d.pos.x).toBe(1);
  });

  it('gives each spawn a unique, increasing id', () => {
    const two = spawnDrop(spawnDrop([], 'dirt', 1, { x: 0, y: 0, z: 0 }), 'dirt', 1, { x: 0, y: 0, z: 0 });
    const three = spawnDrop(two, 'stone', 1, { x: 0, y: 0, z: 0 });
    const ids = three.map((d) => d.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[1]).toBeGreaterThan(ids[0]);
    expect(ids[2]).toBeGreaterThan(ids[1]);
  });

  it('starts with the 0.5 s pickup delay', () => {
    const [d] = spawnDrop([], 'dirt', 1, { x: 0, y: 0, z: 0 });
    expect(d.pickupDelay).toBe(SPAWN_PICKUP_DELAY);
    expect(d.pickupDelay).toBe(0.5);
  });

  it('pops upward with a small random horizontal velocity', () => {
    let sawSpread = false; // teeth: P(all 25 draws within ±0.5) = (1/3)^25 ≈ 1e-12
    for (let i = 0; i < 25; i++) {
      const [d] = spawnDrop([], 'dirt', 1, { x: 0, y: 0, z: 0 });
      expect(d.vel.y).toBe(3); // pop up
      expect(Math.abs(d.vel.x)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(d.vel.z)).toBeLessThanOrEqual(1.5);
      if (Math.abs(d.vel.x) > 0.5) sawSpread = true;
    }
    expect(sawSpread).toBe(true); // the range is actually used, not stuck near 0
  });
});

// B2.5（Task 10）：玩家丟出的物品 2 秒（40 tick）內不可拾；方塊破壞掉落維持 0.5 秒。
describe('spawnDrop options (B2.5)', () => {
  it('spawnDrop accepts a custom pickup delay', () => {
    const [d] = spawnDrop([], 'dirt', 1, { x: 0, y: 0, z: 0 }, { pickupDelay: 2 });
    expect(d.pickupDelay).toBe(2);
  });

  it('spawnDrop accepts a custom velocity', () => {
    const [d] = spawnDrop([], 'dirt', 1, { x: 0, y: 0, z: 0 }, { vel: { x: 1, y: 2, z: 3 } });
    expect(d.vel).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('spawnDrop keeps its default delay and pop when no options are given', () => {
    const [d] = spawnDrop([], 'dirt', 1, { x: 0, y: 0, z: 0 });
    expect(d.pickupDelay).toBe(SPAWN_PICKUP_DELAY);
    expect(d.vel.y).toBe(3); // the default pop (upward) — the name promises it
  });

  it('copies the custom velocity (the caller can mutate its own object afterwards)', () => {
    const vel = { x: 1, y: 2, z: 3 };
    const [d] = spawnDrop([], 'dirt', 1, { x: 0, y: 0, z: 0 }, { vel });
    vel.x = 99;
    expect(d.vel).toEqual({ x: 1, y: 2, z: 3 }); // the entity never aliases the caller's vector
  });

  it('pins the player-drop pickup delay at 2 s (40 tick)', () => {
    expect(PLAYER_DROP_PICKUP_DELAY).toBe(2);
  });
});

// M-4：Q 拋出幾何的四個常數（`src/world/drops.ts`）原本**沒有任何測試覆蓋**，
// 卻有「落在腳前約 1.5 格內」的量化宣稱（README〈與原版的差異〉／
// `docs/releases/v0.5.0.md`〈已知問題〉）→ 這裡把「初始速度」與「位置偏移」
// 釘死，常數一改測試就會報警。

/** 玩家丟出的掉落物幾何（鏡射 `dropSelected` in `src/main.ts`）：出生點在玩家
 *  **前方** `PLAYER_DROP_FORWARD_OFFSET` 格、**腳高 +** `PLAYER_DROP_HEIGHT_OFFSET`
 *  格；初速度＝沿視線水平分量的 `PLAYER_DROP_THROW_SPEED` ＋ 上拋
 *  `PLAYER_DROP_LIFT_SPEED`；拾取延遲 `PLAYER_DROP_PICKUP_DELAY`。 */
function playerDropSpawn(
  yaw: number,
  playerPos: { x: number; y: number; z: number },
): { pos: { x: number; y: number; z: number }; opts: SpawnDropOptions } {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  return {
    pos: {
      x: playerPos.x + fx * PLAYER_DROP_FORWARD_OFFSET,
      y: playerPos.y + PLAYER_DROP_HEIGHT_OFFSET,
      z: playerPos.z + fz * PLAYER_DROP_FORWARD_OFFSET,
    },
    opts: {
      pickupDelay: PLAYER_DROP_PICKUP_DELAY,
      vel: {
        x: fx * PLAYER_DROP_THROW_SPEED,
        y: PLAYER_DROP_LIFT_SPEED,
        z: fz * PLAYER_DROP_THROW_SPEED,
      },
    },
  };
}

describe('玩家丟出的拋出幾何（M-4）', () => {
  it('pins the four tuning constants themselves', () => {
    expect(PLAYER_DROP_THROW_SPEED).toBe(2.5); // 水平初速（格/秒）
    expect(PLAYER_DROP_LIFT_SPEED).toBe(1.5); // 上拋初速（格/秒）
    expect(PLAYER_DROP_FORWARD_OFFSET).toBe(0.5); // 出生點在玩家前方多遠（格）
    expect(PLAYER_DROP_HEIGHT_OFFSET).toBe(1); // 出生點比腳高多少（格）
  });

  it('spawns the drop 0.5 blocks in front of the player, 1.0 above the feet', () => {
    const playerPos = { x: 10, y: 64, z: 20 };
    const yaw = 0; // yaw = 0 面向 -z（本作的 yaw 慣例）
    const { pos, opts } = playerDropSpawn(yaw, playerPos);
    const [d] = spawnDrop([], 'dirt', 1, pos, opts);
    // 位置偏移＝常數值（正對前方 → x 不動、z 往前）
    expect(d.pos.x - playerPos.x).toBeCloseTo(0, 10);
    expect(d.pos.y - playerPos.y).toBeCloseTo(PLAYER_DROP_HEIGHT_OFFSET, 10);
    expect(playerPos.z - d.pos.z).toBeCloseTo(PLAYER_DROP_FORWARD_OFFSET, 10);
    expect(d.pos.y).toBe(65);
    expect(d.pos.z).toBe(19.5);
  });

  it('gives the drop the throw velocity (2.5 forward, 1.5 up) and the 2 s pickup delay', () => {
    const playerPos = { x: 10, y: 64, z: 20 };
    const { pos, opts } = playerDropSpawn(0, playerPos);
    const [d] = spawnDrop([], 'dirt', 1, pos, opts);
    expect(d.vel.x).toBeCloseTo(0, 10); // 正對前方 → 沒有側向初速
    expect(d.vel.y).toBeCloseTo(PLAYER_DROP_LIFT_SPEED, 10);
    expect(d.vel.z).toBeCloseTo(-PLAYER_DROP_THROW_SPEED, 10);
    expect(d.vel.y).toBe(1.5);
    expect(d.vel.z).toBe(-2.5);
    expect(d.pickupDelay).toBe(PLAYER_DROP_PICKUP_DELAY);
  });

  it('offsets along the facing direction (not the world axes)', () => {
    const playerPos = { x: 0, y: 64, z: 0 };
    const { pos, opts } = playerDropSpawn(Math.PI / 2, playerPos); // 面向 -x
    const [d] = spawnDrop([], 'dirt', 1, pos, opts);
    expect(playerPos.x - d.pos.x).toBeCloseTo(PLAYER_DROP_FORWARD_OFFSET, 10);
    expect(d.pos.z - playerPos.z).toBeCloseTo(0, 10);
    expect(d.vel.x).toBeCloseTo(-PLAYER_DROP_THROW_SPEED, 10);
    expect(d.vel.z).toBeCloseTo(0, 10);
  });

  it('lands about 1.5 blocks in front of the feet (the published claim)', () => {
    // 文件宣稱：「落在腳前約 1.5 格內」（原版約 2–3 格）。解析式：
    //   水平總位移 = 初速 / ln(1/阻力) = PLAYER_DROP_THROW_SPEED / ln(10) ≈ 1.086
    //   落點距腳   = 前方偏移 + 水平總位移 ≈ 1.586
    // 離散步進（阻力在位移**之後**才套用）會略微高估 → 用區間釘住，不寫死單一數字。
    const playerPos = { x: 0, y: 64, z: 0 };
    const { pos, opts } = playerDropSpawn(0, playerPos);
    let drops = spawnDrop([], 'dirt', 1, pos, opts);
    const groundTop = playerPos.y; // 腳下的地面頂面
    const isSolid = (_x: number, y: number, _z: number): boolean => y < groundTop;
    for (let i = 0; i < 600; i++) drops = stepDrops(drops, 0.02, isSolid); // 12 秒
    const d = drops[0];
    expect(d.pos.y).toBeCloseTo(groundTop + SETTLE_OFFSET, 2); // 落在腳下的地面上
    const dist = Math.hypot(d.pos.x - playerPos.x, d.pos.z - playerPos.z);
    const analytic = PLAYER_DROP_FORWARD_OFFSET + PLAYER_DROP_THROW_SPEED / Math.log(10);
    expect(dist).toBeGreaterThan(1.4);
    expect(dist).toBeLessThan(1.8);
    expect(Math.abs(dist - analytic)).toBeLessThan(0.1); // ≈1.586（實測 ≈1.61）
  });
});

describe('stepDrops', () => {
  it('applies gravity 20 blocks/s² (semi-implicit Euler)', () => {
    const out = stepDrops([falling()], 0.1, noGround);
    expect(out[0].vel.y).toBeCloseTo(-GRAVITY * 0.1, 10); // -2
    expect(out[0].vel.y).toBeCloseTo(-2, 10); // pins gravity = 20
    expect(out[0].pos.y).toBeCloseTo(5 - 2 * 0.1, 10); // integrated with new vel
  });

  it('increments age and decrements pickupDelay (floored at 0)', () => {
    const d = falling({ age: 1, pickupDelay: 0.2 });
    const [out] = stepDrops([d], 0.1, noGround);
    expect(out.age).toBeCloseTo(1.1, 10);
    expect(out.pickupDelay).toBeCloseTo(0.1, 10);
    const [out2] = stepDrops([falling({ pickupDelay: 0.05 })], 0.1, noGround);
    expect(out2.pickupDelay).toBe(0); // floored, never negative
  });

  it('returns new entities — the input array and entities are untouched', () => {
    const input = [falling()];
    const out = stepDrops(input, 0.1, noGround);
    expect(out).not.toBe(input);
    expect(out[0]).not.toBe(input[0]);
    expect(input[0].age).toBe(0);
    expect(input[0].vel.y).toBe(0);
    expect(input[0].pos.y).toBe(5);
  });

  it('decays horizontal velocity multiplicatively (0.1^dt per step)', () => {
    // documented: integrate first (moves 1 block in that second), then decay
    const d = falling({ pos: { x: 0, y: 5, z: 0 }, vel: { x: 1, y: 0, z: 0 } });
    const [out] = stepDrops([d], 1, noGround);
    expect(out.pos.x).toBeCloseTo(1, 10);
    expect(out.vel.x).toBeCloseTo(0.1, 10);
    expect(out.vel.z).toBeCloseTo(0, 10);
  });

  it('lands on the ground: stops at the solid cell top and never sinks through', () => {
    let drops = [falling({ pos: { x: 0.5, y: 0.6, z: 0.5 } })];
    for (let i = 0; i < 200; i++) {
      drops = stepDrops(drops, 0.02, ground);
      expect(drops[0].pos.y).toBeGreaterThanOrEqual(0); // never ends a frame below ground
    }
    expect(drops[0].pos.y).toBeCloseTo(SETTLE_OFFSET, 1); // resting on y=0 top face
    expect(drops[0].vel.y).toBeGreaterThan(-1); // essentially at rest (frame-granular)
  });

  it('bounces once with restitution 0.3, then settles', () => {
    const hard = falling({ pos: { x: 0.5, y: 0.1, z: 0.5 }, vel: { x: 0, y: -10, z: 0 } });
    const [bounced] = stepDrops([hard], 0.05, ground);
    // impact −10 − 20·0.05 = −11 → rebound +3.3 (restitution 0.3)
    expect(bounced.vel.y).toBeCloseTo(11 * 0.3, 10);
    expect(bounced.bounced).toBe(true);
    expect(bounced.pos.y).toBeCloseTo(SETTLE_OFFSET, 10); // snapped out of the solid cell

    // second impact: no second bounce — velocity is zeroed instead
    const again = {
      ...bounced,
      pos: { x: 0.5, y: 0.1, z: 0.5 },
      vel: { x: 0, y: -10, z: 0 },
    };
    const [rested] = stepDrops([again], 0.05, ground);
    expect(rested.vel.y).toBe(0);
    expect(rested.bounced).toBe(true);
    expect(rested.pos.y).toBeCloseTo(SETTLE_OFFSET, 10);
  });

  it('does not bounce on gentle impacts (threshold: impact faster than -3)', () => {
    const gentle = falling({ pos: { x: 0.5, y: 0.1, z: 0.5 }, vel: { x: 0, y: -2, z: 0 } });
    const [out] = stepDrops([gentle], 0.05, ground); // -2 - gravity·dt = -3 → not < -3
    expect(out.vel.y).toBe(0);
    expect(out.bounced).toBe(false);
  });

  it('tunnels no further than the first solid cell on fast falls', () => {
    // 3 blocks/frame would overshoot a 1-cell floor without a cell sweep
    const fast = falling({ pos: { x: 0.5, y: 3.5, z: 0.5 }, vel: { x: 0, y: -60, z: 0 } });
    const [out] = stepDrops([fast], 0.1, ground);
    expect(out.pos.y).toBeCloseTo(SETTLE_OFFSET, 10); // stopped at ground top
    expect(out.bounced).toBe(true); // -60 fast enough to bounce
  });

  it('treats non-finite dt as 0 (no NaN poisoning)', () => {
    const [out] = stepDrops([falling()], Number.NaN, noGround);
    expect(out.age).toBe(0);
    expect(out.pos.y).toBe(5);
    expect(out.vel.y).toBe(0);
    expect(Number.isFinite(out.pos.x)).toBe(true);
    const [out2] = stepDrops([falling()], -1, noGround);
    expect(out2.age).toBe(0);
    expect(out2.pos.y).toBe(5);
  });

  it('water-like cells (non-solid callback) never stop a drop', () => {
    const [out] = stepDrops([falling({ pos: { x: 0.5, y: 0.5, z: 0.5 }, vel: { x: 0, y: -10, z: 0 } })], 0.1, noGround);
    expect(out.pos.y).toBeLessThan(0.5); // kept falling through
    expect(out.vel.y).toBeLessThan(-10);
  });
});

describe('stepDrops despawn', () => {
  it('removes drops at age ≥ 300 s', () => {
    const young = stepDrops([falling({ age: DESPAWN_AGE - 1 })], 0.5, noGround);
    expect(young).toHaveLength(1); // 299.5 < 300

    const old = stepDrops([falling({ age: DESPAWN_AGE - 0.1 })], 0.5, noGround);
    expect(old).toHaveLength(0); // 300.4 ≥ 300

    const exact = stepDrops([falling({ age: DESPAWN_AGE - 1 })], 1, noGround);
    expect(exact).toHaveLength(0); // exactly 300 counts as expired
  });

  it('keeps younger drops when others despawn', () => {
    const out = stepDrops(
      [falling({ id: 1, age: DESPAWN_AGE }), falling({ id: 2, age: 10 })],
      1,
      noGround,
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(2);
  });
});

describe('pickable', () => {
  it('returns indices of drops within the radius once the delay has elapsed', () => {
    const drops = [
      { ...falling({ id: 1 }), pos: { x: 1, y: 1, z: 1 }, pickupDelay: 0 },
      { ...falling({ id: 2 }), pos: { x: 10, y: 1, z: 10 }, pickupDelay: 0 },
    ];
    expect(pickable(drops, { x: 1, y: 1, z: 1 })).toEqual([0]); // 2 is far away
    expect(pickable(drops, { x: 10, y: 1, z: 10 })).toEqual([1]);
  });

  it('defaults to a 1.5 block radius (3D)', () => {
    const near = [{ ...falling({ id: 1 }), pos: { x: 1.4, y: 1, z: 1 }, pickupDelay: 0 }];
    const far = [{ ...falling({ id: 1 }), pos: { x: 1.6, y: 1, z: 1 }, pickupDelay: 0 }];
    expect(pickable(near, { x: 0, y: 1, z: 1 })).toEqual([0]);
    expect(pickable(far, { x: 0, y: 1, z: 1 })).toEqual([]);
    // vertical counts: 1.4 above the player is still in range
    const above = [{ ...falling({ id: 1 }), pos: { x: 0, y: 2.4, z: 0 }, pickupDelay: 0 }];
    expect(pickable(above, { x: 0, y: 1, z: 0 })).toEqual([0]);
  });

  it('honours an explicit radius', () => {
    const drops = [{ ...falling({ id: 1 }), pos: { x: 3, y: 1, z: 1 }, pickupDelay: 0 }];
    expect(pickable(drops, { x: 0, y: 1, z: 1 })).toEqual([]);
    expect(pickable(drops, { x: 0, y: 1, z: 1 }, 3)).toEqual([0]);
  });

  it('ignores drops still inside their pickup delay', () => {
    const fresh = spawnDrop([], 'dirt', 1, { x: 0, y: 1, z: 0 }); // delay 0.5
    expect(pickable(fresh, { x: 0, y: 1, z: 0 })).toEqual([]);
    const ready = stepDrops(fresh, 0.6, noGround); // delay elapsed
    expect(pickable(ready, ready[0].pos)).toEqual([0]); // measure from where it landed
  });

  it('returns [] for no drops', () => {
    expect(pickable([], { x: 0, y: 0, z: 0 })).toEqual([]);
  });
});

describe('pickup', () => {
  it('adds the full stack to the inventory and removes the entity', () => {
    const drops = [falling({ item: 'dirt', count: 3 })];
    const inv = createInventoryModel([null, null], 'survival');
    const res = pickup(drops, 0, inv);
    expect(res.overflow).toBe(0);
    expect(res.drops).toHaveLength(0);
    expect(inv.countItem('dirt')).toBe(3);
  });

  it('leaves the entity untouched when the inventory is full (all overflow)', () => {
    const drops = [falling({ item: 'dirt', count: 3 })];
    const inv = createInventoryModel(
      [{ item: 'stone', count: 64 }, { item: 'sand', count: 64 }],
      'survival',
    );
    const res = pickup(drops, 0, inv);
    expect(res.overflow).toBe(3); // nothing was taken
    expect(res.drops).toHaveLength(1);
    expect(res.drops[0].count).toBe(3);
    expect(inv.countItem('dirt')).toBe(0);
  });

  it('keeps the entity with the overflow when only part fits (max-stack aware)', () => {
    // one free slot: 63 dirt already stacked → only 1 more fits
    const drops = [falling({ item: 'dirt', count: 3 })];
    const inv = createInventoryModel([{ item: 'dirt', count: 63 }], 'survival');
    const res = pickup(drops, 0, inv);
    expect(res.overflow).toBe(2);
    expect(res.drops).toHaveLength(1);
    expect(res.drops[0].count).toBe(2); // remainder stays in the world
    expect(inv.slots[0]).toEqual({ item: 'dirt', count: 64 }); // maxStack respected
  });

  it('splits oversized pickups across empty slots', () => {
    const drops = [falling({ item: 'dirt', count: 100 })];
    const inv = createInventoryModel([null], 'survival'); // single empty slot
    const res = pickup(drops, 0, inv);
    expect(inv.slots[0]).toEqual({ item: 'dirt', count: 64 });
    expect(res.overflow).toBe(36);
    expect(res.drops[0].count).toBe(36);
  });

  it('preserves the other drops and their order', () => {
    const drops = [falling({ id: 1 }), falling({ id: 2, item: 'stone' }), falling({ id: 3 })];
    const inv = createInventoryModel([null], 'survival');
    const res = pickup(drops, 1, inv);
    expect(res.drops.map((d) => d.id)).toEqual([1, 3]);
    expect(drops).toHaveLength(3); // input untouched
  });

  it('an out-of-range index is a no-op', () => {
    const drops = [falling({ id: 1 })];
    const inv = createInventoryModel([null], 'survival');
    const res = pickup(drops, 5, inv);
    expect(res.drops).toHaveLength(1);
    expect(res.overflow).toBe(0);
    expect(inv.countItem('dirt')).toBe(0);
  });
});

describe('dropItemFor (block → drop mapping, vanilla parity)', () => {
  it('coal_ore drops coal (the raw ore item, never the block item)', () => {
    expect(dropItemFor(BLOCK.COAL_ORE)).toBe('coal');
  });

  it('iron_ore drops raw_iron (the smelt input — see furnace recipes)', () => {
    expect(dropItemFor(BLOCK.IRON_ORE)).toBe('raw_iron');
  });

  // B5 Task 5：原版金礦掉生金、鑽石礦掉 1 顆鑽石（都不是礦石方塊本體）
  it('gold ore drops raw gold and diamond ore drops a diamond', () => {
    expect(dropItemFor(BLOCK.GOLD_ORE)).toBe('raw_gold');
    expect(dropItemFor(BLOCK.DIAMOND_ORE)).toBe('diamond');
  });

  it('gravel drops gravel; ice drops nothing (silk touch only)', () => {
    expect(dropItemFor(BLOCK.GRAVEL)).toBe('gravel');
    // 冰需要絲綢觸碰才掉（本作沒有絲綢觸碰）→ 掉自身以外的規則已在下方 B3 測試釘死
    expect(dropItemFor(BLOCK.ICE)).toBeNull();
  });

  it('stone drops cobblestone (Minecraft parity — the only cobble source)', () => {
    expect(dropItemFor(BLOCK.STONE)).toBe('cobblestone');
  });

  it('grass drops dirt (vanilla: the grass block itself needs silk touch)', () => {
    expect(dropItemFor(BLOCK.GRASS)).toBe('dirt');
  });

  it('leaves/glass/snow drop nothing (silk-touch-only drops)', () => {
    expect(dropItemFor(BLOCK.LEAVES)).toBeNull();
    expect(dropItemFor(BLOCK.GLASS)).toBeNull();
    expect(dropItemFor(BLOCK.SNOW)).toBeNull();
  });

  it('regular blocks map through itemFromBlock', () => {
    expect(dropItemFor(BLOCK.LOG)).toBe('oak_log');
    expect(dropItemFor(BLOCK.COBBLE)).toBe('cobblestone');
    expect(dropItemFor(BLOCK.DIRT)).toBe('dirt');
  });

  it('blocks without an item form drop nothing (air, water)', () => {
    expect(dropItemFor(BLOCK.AIR)).toBeNull();
    expect(dropItemFor(BLOCK.WATER)).toBeNull();
  });

  // B3 Task 3／B5 Task 5：雲杉／白樺的掉落規則（原木與板材掉自身、葉子不掉）
  it('the new wood blocks drop themselves; their leaves drop nothing', () => {
    expect(dropItemFor(BLOCK.SPRUCE_LOG)).toBe('spruce_log');
    expect(dropItemFor(BLOCK.BIRCH_LOG)).toBe('birch_log');
    expect(dropItemFor(BLOCK.SPRUCE_PLANKS)).toBe('spruce_planks');
    expect(dropItemFor(BLOCK.BIRCH_PLANKS)).toBe('birch_planks');
    expect(dropItemFor(BLOCK.SPRUCE_LEAVES)).toBeNull();
    expect(dropItemFor(BLOCK.BIRCH_LEAVES)).toBeNull();
  });

  // B3 Task 4：本批釘死花／草／仙人掌／冰的掉落規則
  it('flowers, grass and cactus drop themselves; ice drops nothing', () => {
    expect(dropItemFor(BLOCK.DANDELION)).toBe('dandelion');
    expect(dropItemFor(BLOCK.POPPY)).toBe('poppy');
    expect(dropItemFor(BLOCK.SHORT_GRASS)).toBe('short_grass');
    expect(dropItemFor(BLOCK.CACTUS)).toBe('cactus');
    // 冰原版要絲絨觸碰才掉；本作沒有絲絨 → 不掉
    expect(dropItemFor(BLOCK.ICE)).toBeNull();
  });

  // B6 Task 5：火把走既有的 itemFromBlock fallback → 掉自身
  // （原版：「Torches can be broken instantly using anything, and drop themselves as an item.」）
  it('a broken torch drops itself', () => {
    expect(dropItemFor(BLOCK.TORCH)).toBe('torch');
  });
});

// ---- B4 Task 4：機率掉落（樹葉 0.5% 蘋果） ------------------------------
describe('chanceDropFor (機率掉落：樹葉 0.5% 蘋果)', () => {
  it('leaves have a 0.5% apple chance', () => {
    // 剛好落在門檻內 → 掉蘋果
    expect(chanceDropFor(BLOCK.LEAVES, () => 0.004)).toBe('apple');
    // 剛好落在門檻外 → 什麼都沒有
    expect(chanceDropFor(BLOCK.LEAVES, () => 0.006)).toBeNull();
    // 其他方塊沒有機率掉落（rng 就算回 0 也不掉）
    expect(chanceDropFor(BLOCK.STONE, () => 0)).toBeNull();
  });

  it('the apple chance is 0.5%', () => {
    expect(LEAF_APPLE_CHANCE).toBe(0.005);
  });

  // B4 Task 4 審查 I-1：spec §B4.3 寫的是「橡木／白樺樹葉 0.5% 掉蘋果」→
  // 白樺葉（B3 已有的 `BLOCK.BIRCH_LEAVES`）**也要**有同一個機率。
  it('birch leaves have the same 0.5% apple chance', () => {
    expect(chanceDropFor(BLOCK.BIRCH_LEAVES, () => 0.004)).toBe('apple');
    expect(chanceDropFor(BLOCK.BIRCH_LEAVES, () => 0.006)).toBeNull();
    // 白樺葉**本體**仍然不掉（B3 的規則不動；這裡只是「機率掉落」）
    expect(dropItemFor(BLOCK.BIRCH_LEAVES)).toBeNull();
  });

  it('spruce leaves have no apple chance (the spec lists oak and birch only)', () => {
    // 雲杉葉刻意未納入 spec §B4.3 的「橡木／白樺」名單 → 沒有機率掉落，
    // 本體也不掉（B3 的規則不動）。
    expect(chanceDropFor(BLOCK.SPRUCE_LEAVES, () => 0)).toBeNull();
    expect(dropItemFor(BLOCK.SPRUCE_LEAVES)).toBeNull();
  });
});
