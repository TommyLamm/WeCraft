import { describe, it, expect } from 'vitest';
import {
  spawnDrop,
  stepDrops,
  pickable,
  pickup,
  dropItemFor,
  GRAVITY,
  SPAWN_PICKUP_DELAY,
  DESPAWN_AGE,
  SETTLE_OFFSET,
  type DropEntity,
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

describe('dropItemFor (block → drop mapping)', () => {
  it('coal_ore drops coal (no smelting in this phase)', () => {
    expect(dropItemFor(BLOCK.COAL_ORE)).toBe('coal');
  });

  it('iron_ore stays iron_ore (smelting-free design)', () => {
    expect(dropItemFor(BLOCK.IRON_ORE)).toBe('iron_ore');
  });

  it('regular blocks map through itemFromBlock', () => {
    expect(dropItemFor(BLOCK.STONE)).toBe('stone');
    expect(dropItemFor(BLOCK.GRASS)).toBe('grass');
    expect(dropItemFor(BLOCK.LOG)).toBe('oak_log');
    expect(dropItemFor(BLOCK.COBBLE)).toBe('cobblestone');
  });

  it('blocks without an item form drop nothing (air, water)', () => {
    expect(dropItemFor(BLOCK.AIR)).toBeNull();
    expect(dropItemFor(BLOCK.WATER)).toBeNull();
  });
});
