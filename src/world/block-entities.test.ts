import { describe, it, expect } from 'vitest';
import {
  MAX_BLOCK_ENTITIES,
  blockEntityKey,
  emptyChestEntity,
  normalizeBlockEntity,
  normalizeBlockEntities,
  serializeBlockEntities,
  furnaceStateToEntity,
  entityToFurnaceState,
  sameFurnaceState,
  spillBlockEntity,
} from './block-entities';
import { SMELT_TIME_SEC, type FurnaceState } from './furnace';

describe('block entities', () => {
  it('emptyChestEntity has 27 empty slots at the given coordinates', () => {
    const e = emptyChestEntity(1, 2, 3);
    expect(e.kind).toBe('chest');
    expect(e.slots).toHaveLength(27);
    expect(e.slots!.every((s) => s === null)).toBe(true);
    expect(e.input).toBeNull();
    expect(e.fuel).toBeNull();
    expect(e.output).toBeNull();
    expect(e.progressSec).toBe(0);
    expect(e.fuelUnits).toBe(0);
  });

  it('blockEntityKey matches the world modified-key format', () => {
    expect(blockEntityKey(5, 70, -3)).toBe('5,70,-3');
  });

  it('normalizeBlockEntity drops an entry with an unknown kind', () => {
    expect(normalizeBlockEntity({ kind: 'barrel', x: 1, y: 2, z: 3 })).toBeNull();
  });

  it('normalizeBlockEntity drops an entry with non-integer or out-of-range coordinates', () => {
    expect(normalizeBlockEntity({ kind: 'chest', x: 1.5, y: 2, z: 3 })).toBeNull();
    expect(normalizeBlockEntity({ kind: 'chest', x: 1, y: 256, z: 3 })).toBeNull();
    expect(normalizeBlockEntity({ kind: 'chest', x: 1, y: -1, z: 3 })).toBeNull();
  });

  it('normalizeBlockEntity pads and truncates a chest to exactly 27 slots', () => {
    const short = normalizeBlockEntity({ kind: 'chest', x: 0, y: 1, z: 0, slots: [{ item: 'stone', count: 1 }] })!;
    expect(short.slots).toHaveLength(27);
    expect(short.slots![0]).toEqual({ item: 'stone', count: 1 });
    const long = normalizeBlockEntity({ kind: 'chest', x: 0, y: 1, z: 0, slots: new Array(40).fill({ item: 'stone', count: 1 }) })!;
    expect(long.slots).toHaveLength(27);
  });

  it('normalizeBlockEntity drops an unknown item id but keeps the other slots', () => {
    const e = normalizeBlockEntity({ kind: 'chest', x: 0, y: 1, z: 0, slots: [{ item: 'mystery', count: 3 }, { item: 'stone', count: 2 }] })!;
    expect(e.slots![0]).toBeNull();
    expect(e.slots![1]).toEqual({ item: 'stone', count: 2 });
  });

  it('normalizeBlockEntity clamps a stack count to the max stack size', () => {
    const e = normalizeBlockEntity({ kind: 'chest', x: 0, y: 1, z: 0, slots: [{ item: 'stone', count: 9999 }] })!;
    expect(e.slots![0]).toEqual({ item: 'stone', count: 64 });
  });

  it('normalizeBlockEntity clamps the furnace progress and fuel units', () => {
    const e = normalizeBlockEntity({ kind: 'furnace', x: 0, y: 1, z: 0, progressSec: 999, fuelUnits: -5 })!;
    expect(e.progressSec).toBe(SMELT_TIME_SEC);
    expect(e.fuelUnits).toBe(0);
  });

  it('normalizeBlockEntities drops only the bad entries and never the whole package', () => {
    const list = normalizeBlockEntities([
      { kind: 'chest', x: 1, y: 2, z: 3, slots: [] },
      { kind: 'nope', x: 0, y: 0, z: 0 },
      'garbage',
      { kind: 'furnace', x: 4, y: 5, z: 6, input: { item: 'raw_iron', count: 2 } },
    ]);
    expect(list).toHaveLength(2);
    expect(list[0].kind).toBe('chest');
    expect(list[1].input).toEqual({ item: 'raw_iron', count: 2 });
    expect(normalizeBlockEntities('not an array')).toEqual([]);
  });

  it('normalizeBlockEntities keeps the first record of a duplicated coordinate', () => {
    const list = normalizeBlockEntities([
      { kind: 'chest', x: 1, y: 2, z: 3, slots: [{ item: 'stone', count: 1 }] },
      { kind: 'chest', x: 1, y: 2, z: 3, slots: [{ item: 'dirt', count: 1 }] },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].slots![0]).toEqual({ item: 'stone', count: 1 });
  });

  it('normalizeBlockEntities caps the number of block entities', () => {
    const many = Array.from({ length: MAX_BLOCK_ENTITIES + 10 }, (_, i) => ({ kind: 'chest', x: i, y: 1, z: 0, slots: [] }));
    expect(normalizeBlockEntities(many)).toHaveLength(MAX_BLOCK_ENTITIES);
  });

  it('serializeBlockEntities deep-copies and caps', () => {
    const src = [emptyChestEntity(1, 1, 1)];
    src[0].slots![0] = { item: 'stone', count: 1 };
    const out = serializeBlockEntities(src);
    src[0].slots![0]!.count = 99;
    expect(out[0].slots![0]).toEqual({ item: 'stone', count: 1 });
  });

  it('furnaceStateToEntity and entityToFurnaceState round-trip the furnace fields', () => {
    const st: FurnaceState = { input: { item: 'raw_iron', count: 3 }, fuel: { item: 'coal', count: 2 }, output: { item: 'iron_ingot', count: 1 }, progressSec: 4, fuelUnits: 5 };
    expect(entityToFurnaceState(furnaceStateToEntity(st, 1, 2, 3))).toEqual(st);
  });

  it('sameFurnaceState compares the progress, the fuel units and the three stacks', () => {
    const a: FurnaceState = { input: { item: 'raw_iron', count: 3 }, fuel: null, output: null, progressSec: 4, fuelUnits: 5 };
    expect(sameFurnaceState(a, { ...a })).toBe(true);
    expect(sameFurnaceState(a, { ...a, progressSec: 4.5 })).toBe(false);
    expect(sameFurnaceState(a, { ...a, fuelUnits: 6 })).toBe(false);
    expect(sameFurnaceState(a, { ...a, input: { item: 'raw_iron', count: 2 } })).toBe(false);
    expect(sameFurnaceState(a, { ...a, input: null })).toBe(false);
  });

  it('spillBlockEntity drops one item entity per non-empty chest slot', () => {
    const chest = emptyChestEntity(1, 2, 3);
    chest.slots![0] = { item: 'stone', count: 5 };
    chest.slots![1] = { item: 'dirt', count: 2 };
    const out = spillBlockEntity([], chest, { x: 1.5, y: 2.5, z: 3.5 }, 'survival');
    expect(out).toHaveLength(2);
    expect(out.map((d) => [d.item, d.count])).toEqual([['stone', 5], ['dirt', 2]]);
  });

  it('spillBlockEntity drops the furnace contents and nothing in creative', () => {
    const furnace = furnaceStateToEntity({ input: { item: 'raw_iron', count: 1 }, fuel: { item: 'coal', count: 1 }, output: null, progressSec: 0, fuelUnits: 0 }, 0, 0, 0);
    expect(spillBlockEntity([], furnace, { x: 0, y: 0, z: 0 }, 'survival')).toHaveLength(2);
    expect(spillBlockEntity([], furnace, { x: 0, y: 0, z: 0 }, 'creative')).toHaveLength(0);
  });

  it('spillBlockEntity keeps the durability of a damaged tool', () => {
    const chest = emptyChestEntity(1, 2, 3);
    chest.slots![0] = { item: 'iron_pickaxe', count: 1, dur: 77 };
    const out = spillBlockEntity([], chest, { x: 1.5, y: 2.5, z: 3.5 }, 'survival');
    expect(out[0].dur).toBe(77);
  });

  it('spillBlockEntity drops one stack per slot from a full chest', () => {
    const chest = emptyChestEntity(0, 0, 0);
    for (let i = 0; i < 27; i++) chest.slots![i] = { item: 'stone', count: 64 };
    const out = spillBlockEntity([], chest, { x: 0.5, y: 0.5, z: 0.5 }, 'survival');
    expect(out).toHaveLength(27);
    expect(out.reduce((n, d) => n + d.count, 0)).toBe(27 * 64);
  });
});
