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

  it('holding the button fires about once every interval', () => {
    // 持續按住 60 幀、每幀 dt = 1/60 秒（＝ 1 秒）→ 節拍是每 0.2 秒一次。
    // 期望值（依本實作語意）：1/60 累積 12 次 = 0.19999999999999998 < 0.2，
    // 所以第一次發火落在第 13 幀（累計 13/60 = 0.2166… ≥ 0.2），之後固定每
    // 12 幀一次（第 25／37／49 幀）→ 60 幀共 4 次。
    // （純理想算術會是 5 次——第 12／24／36／48／60 幀；差在浮點累積的
    // 0.19999999999999998 < 0.2，第一次發火因此晚一幀。）
    const dt = 1 / 60;
    let state = createRepeatState();
    const fireFrames: number[] = [];
    for (let frame = 1; frame <= 60; frame++) {
      const step = stepRepeat(state, true, dt, PLACE_REPEAT_SEC);
      state = step.state;
      if (step.fired) fireFrames.push(frame);
    }
    expect(fireFrames).toEqual([13, 25, 37, 49]);
    expect(fireFrames.length).toBe(4);
    // 節奏本身：相鄰兩次發火固定隔 12 幀 ＝ 12/60 秒 ＝ 0.2 秒（＝一個間隔）
    for (let i = 1; i < fireFrames.length; i++) {
      expect(fireFrames[i] - fireFrames[i - 1]).toBe(12);
    }
    // 第一次發火發生在「累積時間首次 ≥ 0.2 秒」的那一幀
    let sum = 0;
    let firstFrameAtInterval = 0;
    for (let frame = 1; frame <= 60; frame++) {
      sum += dt;
      if (sum >= PLACE_REPEAT_SEC) {
        firstFrameAtInterval = frame;
        break;
      }
    }
    expect(fireFrames[0]).toBe(firstFrameAtInterval);
  });

  it('releasing and holding again restarts the accumulation', () => {
    // 按住 0.1 秒 → 尚未滿 0.2 秒，不發火
    const first = stepRepeat(createRepeatState(), true, 0.1, 0.2);
    expect(first.fired).toBe(false);
    expect(first.state.acc).toBeCloseTo(0.1, 10);
    // 放開 → 累積器歸零、不發火
    const released = stepRepeat(first.state, false, 0.1, 0.2);
    expect(released.fired).toBe(false);
    expect(released.state.acc).toBe(0);
    // 重新按住 → 從 0 重新累積，這一幀仍然不發火（不是沿用放開前的 0.1 秒）
    const reHeld = stepRepeat(released.state, true, 0.1, 0.2);
    expect(reHeld.fired).toBe(false);
    expect(reHeld.state.acc).toBeCloseTo(0.1, 10);
    // 再累積 0.1 秒才剛好滿 0.2 秒 → 此時才發火
    const again = stepRepeat(reHeld.state, true, 0.1, 0.2);
    expect(again.fired).toBe(true);
  });
});
