import { describe, it, expect, vi } from 'vitest';
import { createBus } from './bus';

describe('createBus', () => {
  it('subscribers receive emitted events', () => {
    const bus = createBus<{ 'block:change': { x: number } }>();
    const fn = vi.fn();
    bus.on('block:change', fn);
    bus.emit('block:change', { x: 3 });
    expect(fn).toHaveBeenCalledWith({ x: 3 });
  });

  it('unsubscribe stops delivery', () => {
    const bus = createBus<{ 'block:change': { x: number } }>();
    const fn = vi.fn();
    const off = bus.on('block:change', fn);
    off();
    bus.emit('block:change', { x: 1 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('one failing listener does not break others', () => {
    const bus = createBus<{ e: number }>();
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    bus.on('e', bad);
    bus.on('e', good);
    bus.emit('e', 1);
    expect(good).toHaveBeenCalled();
  });
});
