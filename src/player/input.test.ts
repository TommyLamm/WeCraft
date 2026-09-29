import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
