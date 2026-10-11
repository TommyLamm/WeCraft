import { describe, it, expect } from 'vitest';
import { BLOCK } from '../world/blocks';
import {
  footstepInterval,
  gainForDistance,
  materialGroup,
  synthParams,
  type MaterialGroup,
} from './sounds';

describe('materialGroup', () => {
  it('maps every BLOCK id to its material group (table-driven)', () => {
    const table: Record<number, MaterialGroup> = {
      [BLOCK.AIR]: 'dirt',
      [BLOCK.STONE]: 'stone',
      [BLOCK.DIRT]: 'dirt',
      [BLOCK.GRASS]: 'grass',
      [BLOCK.SAND]: 'sand',
      [BLOCK.LOG]: 'wood',
      [BLOCK.LEAVES]: 'leaves',
      [BLOCK.PLANKS]: 'wood',
      [BLOCK.COBBLE]: 'stone',
      [BLOCK.WATER]: 'water',
      [BLOCK.BEDROCK]: 'stone',
      [BLOCK.SNOW]: 'snow',
      [BLOCK.GLASS]: 'glass',
      [BLOCK.COAL_ORE]: 'stone',
      [BLOCK.IRON_ORE]: 'stone',
      [BLOCK.CRAFTING_TABLE]: 'wood',
    };
    expect(Object.keys(table)).toHaveLength(Object.keys(BLOCK).length); // every id covered
    for (const [id, group] of Object.entries(table)) {
      expect(materialGroup(Number(id))).toBe(group);
    }
  });

  it('falls back to dirt for unknown ids', () => {
    expect(materialGroup(99)).toBe('dirt');
    expect(materialGroup(-1)).toBe('dirt');
    expect(materialGroup(NaN)).toBe('dirt');
  });
});

describe('gainForDistance', () => {
  it('is 1 within 3, 0 at 20+, linear between, 0 for non-finite', () => {
    expect(gainForDistance(0)).toBe(1);
    expect(gainForDistance(3)).toBe(1);
    expect(gainForDistance(11.5)).toBeCloseTo(0.5);
    expect(gainForDistance(20)).toBe(0);
    expect(gainForDistance(42)).toBe(0);
    expect(gainForDistance(NaN)).toBe(0);
    expect(gainForDistance(Infinity)).toBe(0);
    expect(gainForDistance(-Infinity)).toBe(0);
  });
});

describe('footstepInterval', () => {
  it('is Infinity at or below 0.1 speed (and for non-finite), else clamp(1.35/speed, 0.3, 0.55)', () => {
    expect(footstepInterval(0)).toBe(Infinity);
    expect(footstepInterval(0.05)).toBe(Infinity);
    expect(footstepInterval(0.1)).toBe(Infinity);
    expect(footstepInterval(4.3)).toBeCloseTo(0.314);
    expect(footstepInterval(20)).toBe(0.3);
    expect(footstepInterval(1)).toBeCloseTo(0.55); // 1.35 clamped down
    expect(footstepInterval(NaN)).toBe(Infinity);
  });
});

describe('synthParams', () => {
  it('stone/dig: bandpass 1100 Q1.2, 0.12 s, gain 0.5', () => {
    expect(synthParams('stone', 'dig')).toEqual({
      filter: 'bandpass',
      freq: 1100,
      q: 1.2,
      durationSec: 0.12,
      gain: 0.5,
    });
  });

  it('wood/place: bandpass 800 × 0.7 = 560, 0.09 s, gain 0.5', () => {
    expect(synthParams('wood', 'place')).toEqual({
      filter: 'bandpass',
      freq: 560,
      q: 1.0,
      durationSec: 0.09,
      gain: 0.5,
    });
  });

  it('grass/step: lowpass 900 × 0.9 = 810, 0.08 s, gain 0.25', () => {
    expect(synthParams('grass', 'step')).toEqual({
      filter: 'lowpass',
      freq: 810,
      q: 0.7,
      durationSec: 0.08,
      gain: 0.25,
    });
  });

  it('glass/break: highpass 3000 × 0.85 = 2550, 0.18 s, gain 0.6', () => {
    expect(synthParams('glass', 'break')).toEqual({
      filter: 'highpass',
      freq: 2550,
      q: 1.0,
      durationSec: 0.18,
      gain: 0.6,
    });
  });
});
