import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDeathScreen } from './death';

beforeEach(() => {
  document.getElementById('ui-root')?.remove();
  const root = document.createElement('div');
  root.id = 'ui-root';
  document.body.appendChild(root);
});

function root(): HTMLElement {
  return document.getElementById('ui-root')!;
}

function btnByText(text: string): HTMLButtonElement {
  const b = [...root().querySelectorAll('button')].find((x) => x.textContent === text);
  if (!b) throw new Error(`button not found: ${text}`);
  return b;
}

const respawnBtn = (): HTMLButtonElement => btnByText('Respawn');
// Same label as the pause-menu quit (menus.ts) — one wording everywhere
const quitBtn = (): HTMLButtonElement => btnByText('回到標題');

describe('death screen', () => {
  it('fresh instance is hidden; show renders "You died!" with Respawn + quit buttons', () => {
    const death = createDeathScreen(root());
    expect(death.isVisible()).toBe(false); // fresh instance (review Minor #7)
    death.show({ onRespawn: () => {}, onQuit: () => {} });
    const overlay = root().querySelector('.death-screen');
    expect(overlay).not.toBeNull();
    expect(root().textContent).toContain('You died!');
    expect(respawnBtn()).toBeTruthy();
    expect(quitBtn()).toBeTruthy(); // exit without a page reload (review Important #1)
    expect(death.isVisible()).toBe(true);
    death.hide();
  });

  it('clicking Respawn invokes onRespawn exactly once and never onQuit', () => {
    const death = createDeathScreen(root());
    const onRespawn = vi.fn();
    const onQuit = vi.fn();
    death.show({ onRespawn, onQuit });
    respawnBtn().click();
    expect(onRespawn).toHaveBeenCalledTimes(1);
    expect(onQuit).not.toHaveBeenCalled();
    respawnBtn().click();
    expect(onRespawn).toHaveBeenCalledTimes(2); // one call per click — no double-fire
    death.hide();
  });

  it('clicking 回到標題 invokes onQuit once and never onRespawn', () => {
    const death = createDeathScreen(root());
    const onRespawn = vi.fn();
    const onQuit = vi.fn();
    death.show({ onRespawn, onQuit });
    quitBtn().click();
    expect(onQuit).toHaveBeenCalledTimes(1);
    expect(onRespawn).not.toHaveBeenCalled();
    death.hide();
  });

  it('hide removes the overlay', () => {
    const death = createDeathScreen(root());
    death.show({ onRespawn: () => {}, onQuit: () => {} });
    death.hide();
    expect(root().querySelector('.death-screen')).toBeNull();
    expect(death.isVisible()).toBe(false);
  });

  it('show is idempotent — a double show never duplicates the DOM', () => {
    const death = createDeathScreen(root());
    const first = vi.fn();
    death.show({ onRespawn: first, onQuit: () => {} });
    death.show({ onRespawn: first, onQuit: () => {} }); // e.g. a re-entrant state transition
    expect(root().querySelectorAll('.death-screen').length).toBe(1);
    respawnBtn().click(); // still the single wired button
    expect(first).toHaveBeenCalledTimes(1);
    death.hide();
  });
});
