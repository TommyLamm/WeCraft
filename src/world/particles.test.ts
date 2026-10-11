import { describe, it, expect } from 'vitest';
import {
  MAX_PARTICLES,
  spawnBreakBurst,
  spawnDigChip,
  stepParticles,
  type Particle,
} from './particles';
import { BLOCK } from './blocks';

/** Deterministic rng cycling a fixed value sequence — lets the tests pin the
 *  draw order and the inclusive bounds (a 1 hits every max, a 0 every min). */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

const CENTRE = { x: 3.5, y: 4.5, z: 5.5 };

function particle(over: Partial<Particle> = {}): Particle {
  return {
    id: 1,
    tile: 3,
    pos: { x: 0, y: 10, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    life: 1,
    maxLife: 1,
    size: 0.1,
    ...over,
  };
}

const noSolid = () => false;

describe('spawnBreakBurst', () => {
  it('spawns 12 distinct particles with size/life/horizontal speed/vy inside the pinned ranges', () => {
    const list = spawnBreakBurst([], BLOCK.STONE, CENTRE, seqRng([0, 0.5, 1]));
    expect(list).toHaveLength(12);
    expect(new Set(list.map((p) => p.id)).size).toBe(12); // unique ids
    for (const p of list) {
      const hSpeed = Math.hypot(p.vel.x, p.vel.z); // horizontal speed 1.5–3.5
      expect(hSpeed).toBeGreaterThanOrEqual(1.5);
      expect(hSpeed).toBeLessThanOrEqual(3.5);
      expect(p.vel.y).toBeGreaterThanOrEqual(2);
      expect(p.vel.y).toBeLessThanOrEqual(5);
      expect(p.life).toBeGreaterThanOrEqual(0.6);
      expect(p.life).toBeLessThanOrEqual(1.2);
      expect(p.maxLife).toBe(p.life);
      expect(p.size).toBeGreaterThanOrEqual(0.08);
      expect(p.size).toBeLessThanOrEqual(0.16);
      expect(p.pos).toEqual(CENTRE); // spawns at the passed block centre
    }
  });

  it("appends to the input (never mutating it), tagged with the block's side tile", () => {
    const base = [particle({ id: 7 })];
    const grass = spawnBreakBurst(base, BLOCK.GRASS, CENTRE, seqRng([0.5]));
    expect(base).toHaveLength(1); // input list untouched — a new array is returned
    expect(grass).toHaveLength(13); // 1 existing + 12 new
    expect(grass[1].id).toBe(8); // ids continue max+1 — no collision with the input
    expect(grass.slice(1).every((p) => p.tile === 1)).toBe(true); // grass side tile
    const log = spawnBreakBurst([], BLOCK.LOG, CENTRE, seqRng([0.5]));
    expect(log.every((p) => p.tile === 5)).toBe(true); // log side tile
  });
});

describe('spawnDigChip', () => {
  it('spawns 2 chips: life 0.3–0.5, 3D speed 1–2, block side tile, sizes positive', () => {
    const list = spawnDigChip([], BLOCK.STONE, CENTRE, seqRng([0.25, 0.75, 0.5]));
    expect(list).toHaveLength(2);
    for (const p of list) {
      const speed = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
      expect(speed).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(speed).toBeLessThanOrEqual(2 + 1e-9);
      expect(p.life).toBeGreaterThanOrEqual(0.3);
      expect(p.life).toBeLessThanOrEqual(0.5);
      expect(p.maxLife).toBe(p.life);
      expect(p.tile).toBe(3); // stone side
      expect(p.size).toBeGreaterThan(0);
      expect(p.pos).toEqual(CENTRE);
    }
  });
});

describe('stepParticles', () => {
  it('gravity v.y -= 20·dt, then pos += vel·dt (semi-implicit Euler)', () => {
    const p = particle({ pos: { x: 0.5, y: 10, z: 0.5 }, vel: { x: 1, y: 0, z: 0 } });
    const [out] = stepParticles([p], 0.25, noSolid);
    expect(out.vel.y).toBeCloseTo(-5); // 0 - 20 · 0.25
    expect(out.pos.x).toBeCloseTo(0.75); // 0.5 + 1 · 0.25
    expect(out.pos.y).toBeCloseTo(8.75); // 10 + (-5) · 0.25
    expect(out.pos.z).toBeCloseTo(0.5);
  });

  it('decrements life and removes particles at life <= 0', () => {
    const [kept] = stepParticles([particle({ life: 0.5 })], 0.2, noSolid);
    expect(kept.life).toBeCloseTo(0.3);
    expect(kept.maxLife).toBe(1); // maxLife is never decremented
    expect(stepParticles([particle({ life: 0.5 })], 0.5, noSolid)).toHaveLength(0);
  });

  it('falling onto a solid cell rests at floor(y)+1 with v.y = 0, probed at floored coords', () => {
    const cells: Array<[number, number, number]> = [];
    const isSolidAt = (x: number, y: number, z: number): boolean => {
      cells.push([x, y, z]);
      return y === 4; // floor block at cell y=4
    };
    const p = particle({
      pos: { x: 0.5, y: 4.5, z: 0.5 },
      vel: { x: 0.1, y: -2, z: 0 },
    });
    const [out] = stepParticles([p], 0.1, isSolidAt);
    // vel.y after gravity = -4 → y = 4.5 - 0.4 = 4.1 → cell y=4 is solid
    expect(out.pos.y).toBe(5); // floor(4.1) + 1
    expect(out.vel.y).toBe(0);
    expect(out.pos.x).toBeCloseTo(0.51); // horizontal motion continues
    expect(cells).toContainEqual([0, 4, 0]); // isSolidAt got the floored cell
  });

  it('caps at MAX_PARTICLES by dropping the OLDEST', () => {
    const list = Array.from({ length: MAX_PARTICLES + 5 }, (_, i) =>
      particle({ id: i, life: 5 }),
    );
    const out = stepParticles(list, 0.01, noSolid);
    expect(out).toHaveLength(MAX_PARTICLES);
    expect(out[0].id).toBe(5); // ids 0..4 (the oldest) are gone
    expect(out[MAX_PARTICLES - 1].id).toBe(MAX_PARTICLES + 4);
  });

  it('invalid dt (NaN/0/negative) is a no-op on fresh, never-aliased copies', () => {
    const p = particle({});
    for (const dt of [NaN, 0, -1]) {
      const out = stepParticles([p], dt, noSolid);
      expect(out).toHaveLength(1);
      expect(out[0]).not.toBe(p); // returns a new object
      expect(out[0].pos).toEqual(p.pos); // untouched values
      expect(out[0].vel).toEqual(p.vel);
      expect(out[0].life).toBe(p.life);
    }
    expect(p.life).toBe(1); // the input particle was never mutated
  });
});
