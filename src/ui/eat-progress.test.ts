// B4 Task 9：進食進度條（可選的 UI 回饋 —— **規則不依賴它**）。
//
// 形狀沿用其他 ui 模組的慣例（toast／hurt／furnace）：`main` 持有實例、
// 本模組只管 DOM。進度條只是「按住右鍵正在吃」的視覺回饋 —— 進食規則本身
// 由 `src/player/eat.ts` 的 `eatTick` 純邏輯把關（不靠這個 DOM）。
import { beforeEach, describe, it, expect } from 'vitest';
import { createEatProgress } from './eat-progress';

beforeEach(() => {
  document.getElementById('ui-root')?.remove();
  const root = document.createElement('div');
  root.id = 'ui-root';
  document.body.appendChild(root);
});

const root = (): HTMLElement => document.getElementById('ui-root')!;

/** 挂在 ui-root 底下的進度條（永遠最多一個）。 */
const bars = (): HTMLElement[] => [...root().querySelectorAll<HTMLElement>('.eat-progress')];

/** 進度條內的填充條（`.eat-progress-fill`）。 */
const fills = (): HTMLElement[] =>
  [...root().querySelectorAll<HTMLElement>('.eat-progress-fill')];

describe('createEatProgress', () => {
  it('show mounts one progress bar and hide removes it', () => {
    const bar = createEatProgress(root());
    bar.show(0.5);
    expect(root().querySelector('.eat-progress')).not.toBeNull();
    expect(bars()).toHaveLength(1);

    bar.hide();
    expect(root().querySelector('.eat-progress')).toBeNull();
    expect(bars()).toHaveLength(0);
  });

  it('show updates the width instead of remounting', () => {
    const bar = createEatProgress(root());
    bar.show(0.25);
    const first = bars()[0];
    expect(first).toBeDefined();
    expect(fills()[0].style.width).toBe('25%');

    bar.show(0.75);
    // 還是同一個節點（不重建、不疊第二條）→ 只更新寬度。
    expect(bars()).toHaveLength(1);
    expect(bars()[0]).toBe(first);
    expect(fills()[0].style.width).toBe('75%');
  });

  it('the fraction is clamped into 0..1', () => {
    const bar = createEatProgress(root());
    bar.show(2);
    expect(fills()[0].style.width).toBe('100%');
    bar.show(-1);
    expect(fills()[0].style.width).toBe('0%');
    // 非有限值（NaN／Infinity）不得寫出 NaN% 這種壞樣式。
    bar.show(Number.NaN);
    expect(fills()[0].style.width).toBe('0%');
    bar.show(Number.POSITIVE_INFINITY);
    expect(fills()[0].style.width).toBe('100%');
  });

  it('hide is safe before the first show and can be repeated', () => {
    const bar = createEatProgress(root());
    expect(() => bar.hide()).not.toThrow();
    bar.show(0.5);
    bar.hide();
    expect(() => bar.hide()).not.toThrow();
    expect(bars()).toHaveLength(0);
  });
});
