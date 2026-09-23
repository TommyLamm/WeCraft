import type { MoveInput } from './physics';
import type { Settings } from '../core/settings';

export interface InputState extends MoveInput {
  dig: boolean; // 左鍵按住
  place: boolean; // 右鍵（單擊脈衝，消費後清除）
  slot: number; // 0..8 熱鍵欄（滾輪/數字鍵更新）
  toggleInventory: boolean; // E 脈衝
  toggleDebug: boolean; // F3 脈衝
  toggleView: boolean; // F5 脈衝
  requestPause: boolean; // Esc（pointer lock 釋放時觸發）
}

export interface InputController {
  state: InputState;
  locked: boolean;
  onLockChange: (fn: (locked: boolean) => void) => void;
  setMouseMoveHandler: (fn: (dx: number, dy: number) => void) => void;
  consumePlace(): boolean;
  consumeToggleInventory(): boolean;
  consumeToggleDebug(): boolean;
  consumeToggleView(): boolean;
  consumeRequestPause(): boolean;
  dispose(): void;
}

export function createInput(canvas: HTMLCanvasElement, settings: Settings): InputController {
  const keys = new Set<string>();
  const state: InputState = {
    fwd: 0, strafe: 0, jump: false, sneak: false, sprint: false,
    fly: false, flyUp: false, flyDown: false,
    dig: false, place: false, slot: 0,
    toggleInventory: false, toggleDebug: false, toggleView: false, requestPause: false,
  };

  let locked = false;
  let lastSpaceTime = Number.NEGATIVE_INFINITY;
  let flyToggle = false;
  let mouseMoveHandler: ((dx: number, dy: number) => void) | null = null;
  let lockListeners: Array<(locked: boolean) => void> | null = [];

  const updateMove = () => {
    state.fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    state.strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    state.jump = keys.has('Space');
    state.sneak = keys.has('ShiftLeft') || keys.has('ShiftRight');
    state.sprint = keys.has('ControlLeft') || keys.has('ControlRight');
    state.flyUp = flyToggle && keys.has('Space');
    state.flyDown = flyToggle && state.sneak;
    state.fly = flyToggle;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'F3' || e.code === 'F5') e.preventDefault();
    if (!locked) return;
    if (e.code === 'Space' && !e.repeat) {
      const now = performance.now();
      if (now - lastSpaceTime < 300) flyToggle = !flyToggle;
      lastSpaceTime = now;
    }
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= 9) state.slot = n - 1;
    }
    if (e.code === 'KeyE' && !e.repeat) state.toggleInventory = true;
    if (e.code === 'F3' && !e.repeat) state.toggleDebug = true;
    if (e.code === 'F5' && !e.repeat) state.toggleView = true;
    keys.add(e.code);
    updateMove();
  };

  const onKeyUp = (e: KeyboardEvent) => {
    keys.delete(e.code);
    updateMove();
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!locked) return;
    const sens = 0.0022 * settings.sensitivity;
    // 由外部註冊 handler 轉為 yaw/pitch —— 提供 hook
    mouseMoveHandler?.(e.movementX * sens, e.movementY * sens);
  };

  const onMouseDown = (e: MouseEvent) => {
    if (!locked) return;
    if (e.button === 0) state.dig = true;
    if (e.button === 2) state.place = true;
  };
  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) state.dig = false;
  };
  const onWheel = (e: WheelEvent) => {
    if (!locked) return;
    state.slot = (state.slot + (e.deltaY > 0 ? 1 : -1) + 9) % 9;
  };
  const onContext = (e: Event) => e.preventDefault();

  const clearActive = () => {
    keys.clear();
    state.dig = false;
    state.place = false;
    state.toggleInventory = false;
    state.toggleDebug = false;
    state.toggleView = false;
    state.requestPause = false;
    updateMove();
  };

  const onLockChange = () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) clearActive();
    lockListeners?.forEach((fn) => fn(locked));
  };

  const onWindowBlur = () => clearActive();

  const onClick = () => {
    if (!locked) {
      const p = canvas.requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  };

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('wheel', onWheel);
  canvas.addEventListener('contextmenu', onContext);
  document.addEventListener('pointerlockchange', onLockChange);
  canvas.addEventListener('click', onClick);
  window.addEventListener('blur', onWindowBlur);

  return {
    state,
    get locked() {
      return locked;
    },
    onLockChange(fn) {
      lockListeners?.push(fn);
    },
    setMouseMoveHandler(fn) {
      mouseMoveHandler = fn;
    },
    consumePlace() {
      const v = state.place;
      state.place = false;
      return v;
    },
    consumeToggleInventory() {
      const v = state.toggleInventory;
      state.toggleInventory = false;
      return v;
    },
    consumeToggleDebug() {
      const v = state.toggleDebug;
      state.toggleDebug = false;
      return v;
    },
    consumeToggleView() {
      const v = state.toggleView;
      state.toggleView = false;
      return v;
    },
    consumeRequestPause() {
      // pointer lock 被瀏覽器 Esc 釋放 → lock change 且原本 playing → 暫停
      const v = state.requestPause;
      state.requestPause = false;
      return v;
    },
    dispose() {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContext);
      document.removeEventListener('pointerlockchange', onLockChange);
      canvas.removeEventListener('click', onClick);
      window.removeEventListener('blur', onWindowBlur);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      mouseMoveHandler = null;
      lockListeners = null;
    },
  };
}
