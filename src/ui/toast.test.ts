import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { createToasts, type Toasts } from './toast';

beforeEach(() => {
  vi.useFakeTimers(); // every toast registers a timeout — always fake here
  document.getElementById('ui-root')?.remove();
  const root = document.createElement('div');
  root.id = 'ui-root';
  document.body.appendChild(root);
});

afterEach(() => {
  vi.useRealTimers();
});

const root = (): HTMLElement => document.getElementById('ui-root')!;

/** The container's current toast nodes, oldest first. */
const toasts = (): HTMLElement[] => [...root().querySelectorAll<HTMLElement>('.toast')];

const push = (t: Toasts, title: string): void =>
  t.push({ title, description: `desc ${title}`, icon: 'oak_log' });

const titles = (): Array<string | undefined> =>
  toasts().map((el) => el.querySelector('.toast-title')?.textContent ?? undefined);

describe('createToasts', () => {
  it('push mounts .toasts with a toast carrying title, description and an icon canvas', () => {
    const t = createToasts(root());
    push(t, '取得原木');
    expect(root().querySelector('.toasts')).not.toBeNull();
    expect(toasts()).toHaveLength(1);
    const el = toasts()[0];
    expect(el.querySelector('.toast-title')?.textContent).toBe('取得原木');
    expect(el.querySelector('.toast-desc')?.textContent).toBe('desc 取得原木');
    expect(el.querySelector('canvas')).not.toBeNull();
  });

  it('keeps every pending toast (up to max) in push order, oldest first', () => {
    const t = createToasts(root());
    for (let i = 0; i < 5; i++) push(t, `t${i}`);
    expect(titles()).toEqual(['t0', 't1', 't2', 't3', 't4']);
  });

  it('removes a toast automatically after the default 4000 ms', () => {
    const t = createToasts(root());
    push(t, '取得原木');
    vi.advanceTimersByTime(3999);
    expect(toasts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toasts()).toHaveLength(0);
  });

  it('honours a custom durationMs for auto-removal', () => {
    const t = createToasts(root(), { durationMs: 1000 });
    push(t, '取得原木');
    vi.advanceTimersByTime(999);
    expect(toasts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toasts()).toHaveLength(0);
  });

  it('pushing past max evicts the OLDEST toast immediately and never exceeds max', () => {
    const t = createToasts(root()); // default max = 5
    for (let i = 0; i < 6; i++) push(t, `t${i}`);
    expect(titles()).toEqual(['t1', 't2', 't3', 't4', 't5']); // t0 evicted on the push
    vi.advanceTimersByTime(4000); // the evicted toast's cancelled timer must not linger
    expect(toasts()).toHaveLength(0);
  });

  it('dispose removes the container and toasts and cancels every pending timer', () => {
    const t = createToasts(root());
    push(t, 'a');
    push(t, 'b');
    expect(vi.getTimerCount()).toBe(2);
    t.dispose();
    expect(root().querySelector('.toasts')).toBeNull();
    expect(toasts()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0); // nothing left that could touch the DOM later
    vi.advanceTimersByTime(4000);
    expect(root().querySelector('.toasts')).toBeNull();
    expect(toasts()).toHaveLength(0);
  });
});
