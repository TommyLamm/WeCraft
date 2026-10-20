/** 輸入層：把鍵盤／滑鼠事件翻譯成旗標與一次性脈衝（不決定遊戲規則）。
 *
 *  雙擊 W 的時間窗取自**輸入事件當下的時間戳**（keydown 裡呼叫
 *  `performance.now()`），不是幀累加 → 不受影格率影響；視窗失焦／指標解鎖
 *  即失效（`clearActive()` 清掉「上次按鍵時間」）。
 *
 *  疾跑本身能不能成立（飢餓門檻、撞牆、潛行……）由 `src/player/sprint.ts` 的
 *  狀態機決定；本層只負責送出「請求疾跑」的脈衝。 */

import type { MoveInput } from './physics';
import type { Settings } from '../core/settings';
import { SPRINT_DOUBLE_TAP_WINDOW_SEC } from './sprint';

export interface InputState extends MoveInput {
  dig: boolean; // 左鍵按住
  place: boolean; // 右鍵（單擊脈衝，消費後清除）
  placeHeld: boolean; // 右鍵按住（連放放置用；B2 擁有此欄位）
  slot: number; // 0..8 熱鍵欄（滾輪/數字鍵更新）
  toggleInventory: boolean; // E 脈衝
  toggleDebug: boolean; // F3 脈衝
  toggleView: boolean; // F5 脈衝
  requestPause: boolean; // Esc（pointer lock 釋放時觸發）
  dropRequest: boolean; // Q 脈衝（丟棄請求）
  dropWholeStack: boolean; // 該次 Q 是否為 Ctrl+Q（整疊丟棄）
  dropHeld: boolean; // Q 按住（長按連丟用）
  sprintToggle: boolean; // 雙擊 W 脈衝（疾跑請求）
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
  /** 雙擊 W 的疾跑請求脈衝（一次性：讀取後即清掉）。 */
  consumeSprintToggle(): boolean;
  /** Q 的丟棄請求；沒有請求時回 `null`，`wholeStack` 表示是否為 Ctrl+Q。 */
  consumeDrop(): { wholeStack: boolean } | null;
  /** Gate double-tap Space flight (creative-only). Disabling forces an
   *  immediate landing: fly/flyUp/flyDown clear, held keys re-derived. */
  setFlyEnabled(enabled: boolean): void;
  dispose(): void;
}

export function createInput(canvas: HTMLCanvasElement, settings: Settings): InputController {
  const keys = new Set<string>();
  const state: InputState = {
    fwd: 0, strafe: 0, jump: false, sneak: false, sprint: false,
    fly: false, flyUp: false, flyDown: false,
    dig: false, place: false, placeHeld: false, slot: 0,
    toggleInventory: false, toggleDebug: false, toggleView: false, requestPause: false,
    dropRequest: false, dropWholeStack: false, dropHeld: false, sprintToggle: false,
  };

  // Double-tap Space flight is CREATIVE-ONLY (spec §95) — main.ts syncs this
  // at every `currentMode` assignment via setFlyEnabled. Per-controller state,
  // like flyToggle/lastSpaceTime/keys/locked above/below: a second controller
  // never inherits another session's flag.
  let flyEnabled = false;
  let locked = false;
  let lastSpaceTime = Number.NEGATIVE_INFINITY;
  // 雙擊 W 的「上次按下時間」（毫秒）；null 代表尚無紀錄（視窗剛清空過）。
  let lastForwardDownMs: number | null = null;
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
    if (e.code === 'Escape') {
      // 全螢幕下平台以 Keyboard Lock 接管 Esc：短按變成 keydown 送達遊戲、
      // pointer lock 不解除（短按留給遊戲）。非全螢幕則由瀏覽器解除
      // pointer lock，經 pointerlockchange 暫停——兩路徑互斥，不會重複暫停。
      if (!e.repeat) state.requestPause = true;
      return; // 不進入移動鍵集合
    }
    if (e.code === 'Space' && !e.repeat && flyEnabled) {
      // Armed only: taps while flight is disarmed (survival jumps) must NOT
      // record a last-tap time — otherwise one survival jump <300 ms before a
      // mode switch would start flight on the first creative press.
      const now = performance.now();
      if (now - lastSpaceTime < 300) flyToggle = !flyToggle;
      lastSpaceTime = now;
    }
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= 9) state.slot = n - 1;
    }
    if (e.code === 'KeyW') {
      // 雙擊 W → 疾跑請求（時間窗取自 keydown 當下的時間戳，非幀累加）。
      // 時間窗「每次 keydown 都刷新」（含 e.repeat 的自動重複）：否則「按住 W
      // 一秒 → 放開 → 立刻再按一次」會以「最初那一次按」計時（>350 ms）→
      // 永遠不疾跑。但只有「非重複」的按下才可能觸發疾跑（repeat 不得觸發）——
      // 兩件事分開處理。
      const now = performance.now();
      if (
        !e.repeat &&
        lastForwardDownMs !== null &&
        (now - lastForwardDownMs) / 1000 <= SPRINT_DOUBLE_TAP_WINDOW_SEC
      ) {
        state.sprintToggle = true;
      }
      lastForwardDownMs = now;
    }
    if (e.code === 'KeyQ' && !e.repeat) {
      // Q → 丟棄請求。`state.sprint` 此時即「Ctrl 是否按住」（每次 keydown 都
      // 由 updateMove() 重算）→ Ctrl+Q ＝ 整疊丟棄。
      state.dropRequest = true;
      state.dropWholeStack = state.sprint;
      state.dropHeld = true;
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
    if (e.code === 'KeyQ') state.dropHeld = false; // Q 放開 → 停止連丟
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
    if (e.button === 2) {
      state.place = true; // 單擊脈衝（消費後清除）
      state.placeHeld = true; // 按住旗標（連放放置用）
    }
  };
  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) state.dig = false;
    if (e.button === 2) state.placeHeld = false; // 右鍵放開 → 停止連放
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
    state.placeHeld = false;
    state.toggleInventory = false;
    state.toggleDebug = false;
    state.toggleView = false;
    state.requestPause = false;
    state.dropRequest = false;
    state.dropWholeStack = false;
    state.dropHeld = false;
    state.sprintToggle = false;
    lastForwardDownMs = null; // 失焦／解鎖 → 雙擊 W 的時間窗歸零
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
    consumeSprintToggle() {
      const v = state.sprintToggle;
      state.sprintToggle = false;
      return v;
    },
    consumeDrop() {
      if (!state.dropRequest) return null;
      const v = { wholeStack: state.dropWholeStack };
      state.dropRequest = false;
      state.dropWholeStack = false;
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
    setFlyEnabled(enabled) {
      flyEnabled = enabled;
      if (enabled) return;
      // survival entry: clear the toggle and re-derive state — updateMove()
      // recalculates fly/flyUp/flyDown from flyToggle (held movement keys are
      // re-derived too; the player lands via physics)
      flyToggle = false;
      updateMove();
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
