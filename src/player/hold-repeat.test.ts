import { describe, it, expect } from 'vitest';
import {
  PLACE_REPEAT_SEC,
  DROP_REPEAT_SEC,
  createRepeatState,
  stepRepeat,
} from './hold-repeat';

describe('hold-repeat — 按住連放／連丟節拍', () => {
  it('the repeat does not fire before the interval elapses', () => {
    // 第一幀只累積 0.1 秒 → 尚未滿 0.2 秒，不觸發
    const first = stepRepeat(createRepeatState(), true, 0.1, 0.2);
    expect(first.fired).toBe(false);
    // 再累積 0.1 秒 → 累計 0.2 秒，觸發一次
    const second = stepRepeat(first.state, true, 0.1, 0.2);
    expect(second.fired).toBe(true);
  });

  it('the repeat fires at most once per call', () => {
    // 單幀塞入 5 秒 → 只觸發一次，累積器只扣掉一個間隔（5 − 0.2 = 4.8），
    // 剩下的留給後續幀，避免單幀爆放。
    const step = stepRepeat(createRepeatState(), true, 5, 0.2);
    expect(step.fired).toBe(true);
    expect(step.state.acc).toBeCloseTo(5 - 0.2, 10);
  });

  it('releasing the button resets the accumulator', () => {
    // 先按住兩次到觸發
    const first = stepRepeat(createRepeatState(), true, 0.1, 0.2);
    const second = stepRepeat(first.state, true, 0.1, 0.2);
    expect(second.fired).toBe(true);
    // 放開 → 累積器歸零且不觸發（下次按下要重新計時）
    const released = stepRepeat(second.state, false, 0.1, 0.2);
    expect(released.fired).toBe(false);
    expect(released.state.acc).toBe(0);
  });

  it('a non-finite dt never fires and never corrupts the accumulator', () => {
    const step = stepRepeat(createRepeatState(), true, NaN, 0.2);
    expect(step.fired).toBe(false);
    expect(step.state.acc).toBe(0);
  });

  it('the constants are 0.2 seconds', () => {
    expect(PLACE_REPEAT_SEC).toBe(0.2);
    expect(DROP_REPEAT_SEC).toBe(0.2);
  });

  it('a zero or negative dt does not advance the accumulator', () => {
    // dt 非有限或 ≤ 0 一律視為 0（時間不倒退）
    const zero = stepRepeat(createRepeatState(), true, 0, 0.2);
    expect(zero.fired).toBe(false);
    expect(zero.state.acc).toBe(0);
    const negative = stepRepeat(createRepeatState(), true, -1, 0.2);
    expect(negative.fired).toBe(false);
    expect(negative.state.acc).toBe(0);
  });

  it('the step never mutates the previous state', () => {
    const state = createRepeatState();
    const step = stepRepeat(state, true, 0.25, 0.2);
    expect(step.fired).toBe(true);
    expect(state.acc).toBe(0); // 入參不被修改
    expect(step.state).not.toBe(state); // 回傳全新物件
  });
});
