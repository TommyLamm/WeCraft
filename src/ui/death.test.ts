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

function respawnBtn(): HTMLButtonElement {
  const b = [...root().querySelectorAll('button')].find((x) => x.textContent === 'Respawn');
  if (!b) throw new Error('Respawn button not found');
  return b;
}

describe('death screen', () => {
  it('show renders the overlay with "You died!" and a Respawn button', () => {
    const death = createDeathScreen(root());
    death.show(() => {});
    const overlay = root().querySelector('.death-screen');
    expect(overlay).not.toBeNull();
    expect(root().textContent).toContain('You died!');
    expect(respawnBtn()).toBeTruthy();
    expect(death.isVisible()).toBe(true);
    death.hide();
  });

  it('clicking Respawn invokes the onRespawn callback exactly once', () => {
    const death = createDeathScreen(root());
    const onRespawn = vi.fn();
    death.show(onRespawn);
    respawnBtn().click();
    expect(onRespawn).toHaveBeenCalledTimes(1);
    respawnBtn().click();
    expect(onRespawn).toHaveBeenCalledTimes(2); // one call per click — no double-fire
    death.hide();
  });

  it('hide removes the overlay', () => {
    const death = createDeathScreen(root());
    death.show(() => {});
    death.hide();
    expect(root().querySelector('.death-screen')).toBeNull();
    expect(death.isVisible()).toBe(false);
  });

  it('show is idempotent — a double show never duplicates the DOM', () => {
    const death = createDeathScreen(root());
    const first = vi.fn();
    death.show(first);
    death.show(first); // e.g. a re-entrant state transition
    expect(root().querySelectorAll('.death-screen').length).toBe(1);
    respawnBtn().click(); // still the single wired button
    expect(first).toHaveBeenCalledTimes(1);
    death.hide();
  });
});
