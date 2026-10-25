import { describe, it, expect } from 'vitest';
import { durabilityColor, durabilityRatio, mountDurabilityBar } from './durbar';

describe('durability bar (B7 Task 6)', () => {
  it('the ratio is the remaining durability over the maximum', () => {
    expect(durabilityRatio({ item: 'iron_pickaxe', count: 1, dur: 125 })).toBe(0.5);
    expect(durabilityRatio({ item: 'iron_pickaxe', count: 1, dur: 250 })).toBe(1);
    expect(durabilityRatio({ item: 'stone', count: 1 })).toBe(0);
    expect(durabilityRatio(null)).toBe(0);
  });

  it('the color follows the four-step threshold table', () => {
    expect(durabilityColor(1)).toBe('#00ff00');
    expect(durabilityColor(0.51)).toBe('#00ff00');
    expect(durabilityColor(0.5)).toBe('#ffff00');
    expect(durabilityColor(0.26)).toBe('#ffff00');
    expect(durabilityColor(0.25)).toBe('#ff8000');
    expect(durabilityColor(0.11)).toBe('#ff8000');
    expect(durabilityColor(0.1)).toBe('#ff0000');
    expect(durabilityColor(0)).toBe('#ff0000');
    expect(durabilityColor(Number.NaN)).toBe('#ff0000'); // 非有限值 → 紅
  });

  it('an unused tool shows no durability bar', () => {
    const slot = document.createElement('div');
    mountDurabilityBar(slot, { item: 'iron_pickaxe', count: 1, dur: 250 });
    expect(slot.querySelector('.ui-dur')).toBeNull();
  });

  it('a damaged tool shows a bar with the remaining width and color', () => {
    const slot = document.createElement('div');
    mountDurabilityBar(slot, { item: 'iron_pickaxe', count: 1, dur: 125 });
    const fill = slot.querySelector('.ui-dur-fill') as HTMLElement;
    expect(fill.style.width).toBe('50%');
    expect(fill.dataset.durColor).toBe('#ffff00');
  });

  it('a non-durable item shows no bar', () => {
    const slot = document.createElement('div');
    mountDurabilityBar(slot, { item: 'stone', count: 1 });
    expect(slot.querySelector('.ui-dur')).toBeNull();
  });

  it('mounting twice does not stack bars', () => {
    const slot = document.createElement('div');
    const stack = { item: 'iron_pickaxe', count: 1, dur: 125 } as const;
    mountDurabilityBar(slot, stack);
    mountDurabilityBar(slot, stack);
    expect(slot.querySelectorAll('.ui-dur').length).toBe(1);
  });

  it('mounting a fresh stack removes the old bar', () => {
    const slot = document.createElement('div');
    mountDurabilityBar(slot, { item: 'iron_pickaxe', count: 1, dur: 125 });
    expect(slot.querySelector('.ui-dur')).not.toBeNull();
    mountDurabilityBar(slot, { item: 'iron_pickaxe', count: 1, dur: 250 });
    expect(slot.querySelector('.ui-dur')).toBeNull();
  });
});
