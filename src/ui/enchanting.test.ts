import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEnchanting, type EnchantView } from './enchanting';
import type { EnchantOffer } from '../core/enchantments';

beforeEach(() => {
  document.getElementById('ui-root')?.remove();
  const root = document.createElement('div');
  root.id = 'ui-root';
  document.body.appendChild(root);
});

const root = (): HTMLElement => document.getElementById('ui-root')!;

function harness() {
  const onChoose = vi.fn();
  const onClose = vi.fn();
  const ui = createEnchanting(root(), { onChoose, onClose });
  return { ui, onChoose, onClose };
}

const offers = (): EnchantOffer[] => [
  { enchant: { id: 'efficiency', level: 1 }, cost: 1 },
  { enchant: { id: 'fortune', level: 2 }, cost: 2 },
  { enchant: { id: 'efficiency', level: 3 }, cost: 3 },
];

const view = (over: Partial<EnchantView> = {}): EnchantView => ({
  stack: { item: 'diamond_pickaxe', count: 1 },
  offers: offers(),
  level: 5,
  free: false,
  message: null,
  ...over,
});

describe('enchanting panel', () => {
  it('renders the held item, level and one button per offer', () => {
    const { ui } = harness();
    ui.open(view());
    expect(root().querySelector('.ui-enchant-panel h3')?.textContent).toBe('附魔台');
    expect(root().querySelector('.ui-enchant-name')?.textContent).toContain('Diamond Pickaxe');
    expect(root().querySelector('.ui-enchant-level')?.textContent).toContain('5');
    const buttons = root().querySelectorAll('.ui-enchant-offer');
    expect(buttons).toHaveLength(3);
    expect(buttons[0].textContent).toContain('Efficiency I');
    expect(buttons[0].textContent).toContain('1 級');
    expect(buttons[2].textContent).toContain('Efficiency III');
    expect(buttons[2].textContent).toContain('3 級');
    ui.dispose();
  });

  it('shows the existing enchant in the held item name', () => {
    const { ui } = harness();
    ui.open(
      view({
        stack: { item: 'diamond_pickaxe', count: 1, ench: { id: 'efficiency', level: 2 } },
      }),
    );
    expect(root().querySelector('.ui-enchant-name')?.textContent).toContain('Efficiency II');
    ui.dispose();
  });

  it('disables an offer the player cannot afford', () => {
    const { ui } = harness();
    ui.open(view({ level: 2 }));
    const buttons = root().querySelectorAll<HTMLButtonElement>('.ui-enchant-offer');
    expect(buttons[1].disabled).toBe(false); // cost 2 = level 2
    expect(buttons[2].disabled).toBe(true); // cost 3 > level 2
    ui.dispose();
  });

  it('renders the upgrade offer and the max-level message', () => {
    const { ui } = harness();
    ui.open(
      view({
        stack: {
          item: 'diamond_pickaxe',
          count: 1,
          ench: { id: 'efficiency', level: 2 },
        },
        offers: [{ enchant: { id: 'efficiency', level: 3 }, cost: 3 }],
      }),
    );
    const buttons = root().querySelectorAll('.ui-enchant-offer');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain('Efficiency III');
    expect(buttons[0].textContent).toContain('3 級');

    // at-max: no offers, the reason line explains why
    ui.open(
      view({
        stack: {
          item: 'diamond_pickaxe',
          count: 1,
          ench: { id: 'efficiency', level: 5 },
        },
        offers: [],
        message: '已達附魔上限',
      }),
    );
    expect(root().querySelectorAll('.ui-enchant-offer')).toHaveLength(0);
    expect(root().querySelector('.ui-enchant-message')?.textContent).toBe('已達附魔上限');
    ui.dispose();
  });

  it('renders 免費 in creative and never disables an offer', () => {
    const { ui } = harness();
    ui.open(view({ level: 0, free: true }));
    expect(root().querySelector('.ui-enchant-level')?.textContent).toContain('免費');
    const buttons = root().querySelectorAll<HTMLButtonElement>('.ui-enchant-offer');
    expect(buttons[2].textContent).toContain('免費');
    expect(buttons[2].textContent).not.toContain('3 級');
    expect(buttons[2].disabled).toBe(false);
    ui.dispose();
  });

  it('renders the reason message when there is nothing to enchant', () => {
    const { ui } = harness();
    ui.open(view({ stack: null, offers: [], message: '手持物品才能附魔' }));
    expect(root().querySelector('.ui-enchant-message')?.textContent).toBe('手持物品才能附魔');
    expect(root().querySelectorAll('.ui-enchant-offer')).toHaveLength(0);
    ui.dispose();
  });

  it('fires onChoose with the button index and stays open', () => {
    const { ui, onChoose, onClose } = harness();
    ui.open(view());
    (root().querySelectorAll<HTMLButtonElement>('.ui-enchant-offer')[1] as HTMLElement).click();
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(root().querySelector('.ui-enchant-panel')).not.toBeNull();
    ui.dispose();
  });

  it('backdrop / Esc close exactly once per open and re-open never stacks handlers', () => {
    const { ui, onClose } = harness();
    ui.open(view());
    ui.open(view()); // re-open must not stack Esc handlers
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(root().querySelector('.ui-enchant-panel')).toBeNull();

    ui.open(view());
    (root().querySelector('.ui-enchant-panel') as HTMLElement).click();
    expect(onClose).toHaveBeenCalledTimes(1); // inside clicks do not close
    (root().querySelector('.ui-enchant-backdrop') as HTMLElement).click();
    expect(onClose).toHaveBeenCalledTimes(2);

    ui.open(view());
    ui.dispose();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(2); // handler gone
  });
});
