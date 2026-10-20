import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createInput, type InputController } from './input';
import { loadSettings } from '../core/settings';

// The input handlers early-return unless pointer-locked; fake the lock the way
// the CDP walkthrough does (jsdom implements no pointer-lock API of its own).
let canvas: HTMLCanvasElement;
let ctrl: InputController;

const tap = (code: string) => {
  document.dispatchEvent(new KeyboardEvent('keydown', { code }));
  document.dispatchEvent(new KeyboardEvent('keyup', { code }));
};
const down = (code: string) => document.dispatchEvent(new KeyboardEvent('keydown', { code }));
const up = (code: string) => document.dispatchEvent(new KeyboardEvent('keyup', { code }));

beforeEach(() => {
  localStorage.clear();
  canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  ctrl = createInput(canvas, loadSettings());
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => canvas });
  document.dispatchEvent(new Event('pointerlockchange'));
  // no fly-state reset needed: flyEnabled lives inside each controller's
  // closure, so every fresh controller boots with flight disabled
});

afterEach(() => {
  // unlock BEFORE disposing: dispose calls exitPointerLock only while locked,
  // and jsdom has no exitPointerLock
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => null });
  document.dispatchEvent(new Event('pointerlockchange'));
  ctrl.dispose();
  canvas.remove();
});

describe('Escape requests pause while locked', () => {
  it('locked Escape keydown sets the requestPause pulse (once)', () => {
    down('Escape');
    expect(ctrl.consumeRequestPause()).toBe(true);
    expect(ctrl.consumeRequestPause()).toBe(false); // pulse consumed
    up('Escape');
  });

  it('unlocked Escape never sets requestPause', () => {
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => null });
    document.dispatchEvent(new Event('pointerlockchange'));
    down('Escape');
    expect(ctrl.consumeRequestPause()).toBe(false);
    up('Escape');
  });

  it('held Escape (repeat) does not re-arm the pulse', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', repeat: true }));
    expect(ctrl.consumeRequestPause()).toBe(false);
  });

  it('Escape does not leak into movement keys', () => {
    down('Escape');
    up('Escape');
    expect(ctrl.state.fwd).toBe(0);
    expect(ctrl.state.jump).toBe(false);
  });
});
describe('double-tap Space flight gate', () => {
  it('fresh controller defaults to flight disabled (never calls setFlyEnabled)', () => {
    // the FIRST test of the file: no setFlyEnabled anywhere before the taps —
    // a brand-new controller must boot gated (survival default)
    tap('Space');
    tap('Space'); // second tap lands well within 300 ms
    expect(ctrl.state.fly).toBe(false);
    expect(ctrl.state.flyUp).toBe(false);
  });

  it('setFlyEnabled(true) arms the double-tap: second press starts flying', () => {
    ctrl.setFlyEnabled(true);
    tap('Space');
    down('Space'); // second tap <300 ms after the first, Space stays held
    expect(ctrl.state.fly).toBe(true);
    expect(ctrl.state.flyUp).toBe(true); // held Space while flying → ascend
    up('Space');
  });

  it('setFlyEnabled(false) forces a landing: fly/flyUp/flyDown all clear', () => {
    ctrl.setFlyEnabled(true);
    tap('Space');
    down('Space'); // flying with Space held
    down('ShiftLeft'); // and sneak held → flyDown would otherwise be true
    expect(ctrl.state.fly).toBe(true);
    expect(ctrl.state.flyUp).toBe(true);
    expect(ctrl.state.flyDown).toBe(true);

    ctrl.setFlyEnabled(false); // mode switched to survival mid-flight
    expect(ctrl.state.fly).toBe(false);
    expect(ctrl.state.flyUp).toBe(false);
    expect(ctrl.state.flyDown).toBe(false);

    // still gated afterwards: another double-tap stays grounded
    up('ShiftLeft');
    up('Space');
    tap('Space');
    tap('Space');
    expect(ctrl.state.fly).toBe(false);
  });

  it('a single Space press alone never sets state.fly (only the double-tap does)', () => {
    ctrl.setFlyEnabled(true);
    tap('Space');
    expect(ctrl.state.fly).toBe(false);
    expect(ctrl.state.flyUp).toBe(false);
  });

  it('taps while disarmed never arm a FUTURE creative double-tap', () => {
    tap('Space'); // survival jump <300 ms before a mode switch
    ctrl.setFlyEnabled(true);
    tap('Space'); // the FIRST creative press must not start flight
    expect(ctrl.state.fly).toBe(false);
  });

  it('setFlyEnabled(false) keeps held movement keys (KeyW survives the landing)', () => {
    down('KeyW');
    expect(ctrl.state.fwd).toBe(1);
    ctrl.setFlyEnabled(false);
    expect(ctrl.state.fwd).toBe(1); // held movement re-derived, only flight clears
    expect(ctrl.state.fly).toBe(false);
    up('KeyW');
    expect(ctrl.state.fwd).toBe(0);
  });

  it('setFlyEnabled(true) twice in a row still arms the double-tap (idempotent)', () => {
    ctrl.setFlyEnabled(true);
    ctrl.setFlyEnabled(true);
    tap('Space');
    tap('Space');
    expect(ctrl.state.fly).toBe(true);
  });
});

// B2 輸入層新增的旗標：雙擊 W 疾跑請求／Q 丟棄／右鍵按住。
// 時間窗用 `vi.spyOn(performance, 'now')` 推進（jsdom 有 performance.now），
// 不依賴真實時脈 → 測試不 flaky。
describe('sprint double-tap, drop and right-button hold flags', () => {
  afterEach(() => {
    // 還原被 mock 的 performance.now（即使某個案例中途失敗也不會洩漏到下一案）
    vi.restoreAllMocks();
  });

  it('two W presses within 350 ms request sprinting', () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1000);
    tap('KeyW');
    now.mockReturnValue(1200);
    tap('KeyW');
    expect(ctrl.consumeSprintToggle()).toBe(true);
    expect(ctrl.consumeSprintToggle()).toBe(false); // 脈衝只發一次
  });

  it('two W presses 400 ms apart do not request sprinting', () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1000);
    tap('KeyW');
    now.mockReturnValue(1400);
    tap('KeyW');
    expect(ctrl.consumeSprintToggle()).toBe(false);
  });

  it('holding W with auto-repeat never requests sprinting', () => {
    down('KeyW');
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', repeat: true }));
    expect(ctrl.consumeSprintToggle()).toBe(false);
  });

  it('a held W refreshes the double-tap window without requesting sprinting', () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1000);
    down('KeyW'); // 初次按下（按住不放）
    now.mockReturnValue(1500);
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', repeat: true })); // 自動重複
    expect(ctrl.consumeSprintToggle()).toBe(false); // repeat 不得「觸發」疾跑
    now.mockReturnValue(1600);
    up('KeyW'); // 放開
    now.mockReturnValue(1650);
    down('KeyW'); // 立刻再按一次
    expect(ctrl.consumeSprintToggle()).toBe(true); // 視窗被 refresh → 成立
  });

  it('losing focus clears the double-tap window', () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1000);
    tap('KeyW');
    window.dispatchEvent(new Event('blur'));
    now.mockReturnValue(1100);
    tap('KeyW');
    expect(ctrl.consumeSprintToggle()).toBe(false);
  });

  it('losing pointer lock clears a pending sprint request', () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1000);
    tap('KeyW');
    now.mockReturnValue(1100);
    tap('KeyW');
    expect(ctrl.state.sprintToggle).toBe(true); // 請求已就緒、尚未消費
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => null });
    document.dispatchEvent(new Event('pointerlockchange')); // 解除指標鎖
    expect(ctrl.state.sprintToggle).toBe(false);
    expect(ctrl.consumeSprintToggle()).toBe(false);
  });

  it('Q requests a drop of one item', () => {
    tap('KeyQ');
    expect(ctrl.consumeDrop()).toEqual({ wholeStack: false });
    expect(ctrl.consumeDrop()).toBeNull();
  });

  it('ctrl+Q requests the whole stack', () => {
    down('ControlLeft');
    down('KeyQ');
    expect(ctrl.consumeDrop()).toEqual({ wholeStack: true });
  });

  it('the right mouse button sets placeHeld until released', () => {
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
    expect(ctrl.state.placeHeld).toBe(true);
    document.dispatchEvent(new MouseEvent('mouseup', { button: 2 }));
    expect(ctrl.state.placeHeld).toBe(false);
  });

  it('the right mouse button still fires the one-shot place pulse', () => {
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
    expect(ctrl.consumePlace()).toBe(true);
  });

  it('losing pointer lock clears placeHeld and dropHeld', () => {
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
    down('KeyQ');
    expect(ctrl.state.placeHeld).toBe(true);
    expect(ctrl.state.dropHeld).toBe(true);
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => null });
    document.dispatchEvent(new Event('pointerlockchange')); // 解除指標鎖
    expect(ctrl.state.placeHeld).toBe(false);
    expect(ctrl.state.dropHeld).toBe(false);
  });
});
