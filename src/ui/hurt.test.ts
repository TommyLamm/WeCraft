import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { createHurtFlash } from './hurt';

beforeEach(() => {
  vi.useFakeTimers(); // every flash registers a 300 ms timeout — always fake here
  document.getElementById('ui-root')?.remove();
  const root = document.createElement('div');
  root.id = 'ui-root';
  document.body.appendChild(root);
});

afterEach(() => {
  vi.useRealTimers();
});

const root = (): HTMLElement => document.getElementById('ui-root')!;

/** The live .hurt-flash nodes under ui-root (there must never be more than one). */
const overlays = (): HTMLElement[] =>
  [...root().querySelectorAll<HTMLElement>('.hurt-flash')];

describe('createHurtFlash', () => {
  it('flash mounts exactly one .hurt-flash overlay', () => {
    const hurt = createHurtFlash(root());
    hurt.flash();
    expect(overlays()).toHaveLength(1);
    expect(overlays()[0].parentElement).toBe(root());
    // never `interactive`: the red vignette must not eat clicks (ui.css
    // `#ui-root .interactive` is the pointer-events switch)
    expect(overlays()[0].classList.contains('interactive')).toBe(false);

    hurt.flash(); // a second hit while the overlay is up must not stack a node
    expect(overlays()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1); // …and must not stack a timer either
  });

  it('overlay auto-removes after 300 ms', () => {
    const hurt = createHurtFlash(root());
    hurt.flash();
    vi.advanceTimersByTime(299);
    expect(overlays()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(overlays()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('re-flash extends the window instead of restarting the DOM node', () => {
    const hurt = createHurtFlash(root());
    hurt.flash();
    vi.advanceTimersByTime(200); // 200 ms in — still mounted
    hurt.flash(); // extends: clearTimeout + new 300 ms window
    vi.advanceTimersByTime(299); // 499 ms after the first flash
    expect(overlays()).toHaveLength(1);
    vi.advanceTimersByTime(1); // 500 ms = 300 ms after the re-flash
    expect(overlays()).toHaveLength(0);
  });

  it('flash after removal re-mounts', () => {
    const hurt = createHurtFlash(root());
    hurt.flash();
    vi.advanceTimersByTime(300);
    expect(overlays()).toHaveLength(0);

    hurt.flash();
    expect(overlays()).toHaveLength(1);
    vi.advanceTimersByTime(300);
    expect(overlays()).toHaveLength(0);
  });
});
