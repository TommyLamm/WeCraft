import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFurnace } from './furnace';
import { emptyFurnace } from '../world/furnace';

beforeEach(() => {
  document.getElementById('ui-root')?.remove();
  const root = document.createElement('div');
  root.id = 'ui-root';
  document.body.appendChild(root);
});

const root = (): HTMLElement => document.getElementById('ui-root')!;

function harness() {
  const onTakeOutput = vi.fn();
  const onClose = vi.fn();
  const onSlotClick = vi.fn();
  const ui = createFurnace(root(), { onTakeOutput, onClose, onSlotClick });
  return { ui, onTakeOutput, onClose, onSlotClick };
}

describe('furnace panel', () => {
  it('open renders input/fuel/output slots + progress width = progressSec/10', () => {
    const { ui } = harness();
    ui.open({
      ...emptyFurnace(),
      input: { item: 'iron_ore', count: 3 },
      fuel: { item: 'coal', count: 1 },
      output: { item: 'iron_ingot', count: 2 },
      progressSec: 5,
      fuelUnits: 7,
    });
    expect(root().querySelector('[data-fslot="input"]')).not.toBeNull();
    expect(root().querySelector('[data-fslot="fuel"]')).not.toBeNull();
    expect(root().querySelector('[data-fslot="output"]')).not.toBeNull();
    expect(root().querySelector('[data-fslot="input"]')?.getAttribute('title')).toBe('Iron Ore');
    expect(root().querySelector('[data-fslot="output"]')?.getAttribute('title')).toBe('Iron Ingot');
    expect(root().querySelector('[data-fslot="output"] .count')?.textContent).toBe('2');
    const fill = root().querySelector('.furnace-progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('50%');
    ui.dispose();
  });

  it('clicking output fires onTakeOutput; clicking input/fuel notifies onSlotClick', () => {
    const { ui, onTakeOutput, onSlotClick } = harness();
    ui.open({ ...emptyFurnace(), input: { item: 'iron_ore', count: 1 } });
    (root().querySelector('[data-fslot="output"]') as HTMLElement).click();
    expect(onTakeOutput).toHaveBeenCalledTimes(1);
    (root().querySelector('[data-fslot="input"]') as HTMLElement).click();
    expect(onSlotClick).toHaveBeenCalledWith('input');
    (root().querySelector('[data-fslot="fuel"]') as HTMLElement).click();
    expect(onSlotClick).toHaveBeenCalledWith('fuel');
    expect(onTakeOutput).toHaveBeenCalledTimes(1);
    ui.dispose();
  });

  it('burn icon is lit while fuelUnits > 0 or fuel is burnable, dark otherwise', () => {
    const { ui } = harness();
    ui.open({ ...emptyFurnace(), fuelUnits: 7 });
    expect(root().querySelector('.furnace-burn.lit')).not.toBeNull();
    ui.open({ ...emptyFurnace(), fuel: { item: 'coal', count: 1 } });
    expect(root().querySelector('.furnace-burn.lit')).not.toBeNull();
    ui.open({ ...emptyFurnace(), fuel: { item: 'dirt', count: 1 } });
    expect(root().querySelector('.furnace-burn.lit')).toBeNull();
    ui.open(emptyFurnace());
    expect(root().querySelector('.furnace-burn.lit')).toBeNull();
    ui.dispose();
  });

  it('Esc closes (onClose once) and close()/dispose() remove the overlay', () => {
    const { ui, onClose } = harness();
    ui.open(emptyFurnace());
    expect(root().querySelector('.furnace-panel')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(root().querySelector('.furnace-panel')).toBeNull();
    // reopen → E also closes via the same route; dispose detaches everything
    ui.open(emptyFurnace());
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    ui.open(emptyFurnace());
    ui.dispose();
    expect(root().querySelector('.furnace-panel')).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(2); // handler gone
  });
});
