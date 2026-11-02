import { describe, it, expect } from 'vitest';
import { createSleepScreen } from './sleep';

describe('sleep screen', () => {
  it('B10: the sleep screen mounts once, shows text, and hides idempotently', () => {
    const root = document.createElement('div');
    const screen = createSleepScreen(root);
    expect(screen.isVisible()).toBe(false);
    screen.show();
    screen.show();
    expect(root.querySelectorAll('.sleep-screen')).toHaveLength(1);
    expect(root.querySelector('.sleep-screen')?.textContent).toContain('睡覺中');
    expect(screen.isVisible()).toBe(true);
    screen.hide();
    screen.hide();
    expect(root.querySelector('.sleep-screen')).toBeNull();
    expect(screen.isVisible()).toBe(false);
  });

  it('B10: hide on a never-shown screen is a no-op and re-show remounts', () => {
    const root = document.createElement('div');
    const screen = createSleepScreen(root);
    screen.hide();
    expect(root.querySelector('.sleep-screen')).toBeNull();
    screen.show();
    screen.hide();
    screen.show();
    expect(root.querySelectorAll('.sleep-screen')).toHaveLength(1);
  });
});
