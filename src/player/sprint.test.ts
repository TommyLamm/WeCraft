import { describe, it, expect } from 'vitest';
import {
  SPRINT_DOUBLE_TAP_WINDOW_SEC,
  SPRINT_MIN_HUNGER,
  SPRINT_WALL_ANGLE_DEG,
  cancelReason,
  createSprintState,
  isWallBlock,
  updateSprint,
  type SprintContext,
} from './sprint';

/** 預設情境：向前走、飽食（hunger 20）、無任何阻擋。 */
const ctx = (over: Partial<SprintContext> = {}): SprintContext => ({
  forward: true, sneak: false, ctrlHeld: false, sprintRequested: false,
  hunger: 20, flying: false, inWater: false, wallAngleDeg: null, attacked: false, ...over,
});

describe('sprint — 疾跑狀態機', () => {
  it('a fresh state is idle and unlatched', () => {
    expect(createSprintState()).toEqual({ active: false, latched: false, ctrlHeld: false, lastCancel: null });
  });

  it('holding ctrl sprints while moving forward', () => {
    const s = updateSprint(createSprintState(), ctx({ ctrlHeld: true }));
    expect(s.active).toBe(true);
    expect(s.latched).toBe(false); // Ctrl 路徑不鎖存
  });

  it('a double tap latches sprinting until a cancel condition fires', () => {
    const first = updateSprint(createSprintState(), ctx({ sprintRequested: true }));
    expect(first.latched).toBe(true);
    expect(first.active).toBe(true);
    // 下一幀不再帶 double-tap 請求，鎖存仍有效
    const second = updateSprint(first, ctx());
    expect(second.active).toBe(true);
    expect(second.latched).toBe(true);
  });

  it('releasing forward stops sprinting and clears the latch', () => {
    const latched = updateSprint(createSprintState(), ctx({ sprintRequested: true }));
    const s = updateSprint(latched, ctx({ forward: false }));
    expect(s.active).toBe(false);
    expect(s.latched).toBe(false);
    expect(s.lastCancel).toBe('no-forward');
  });

  it('sneaking cancels sprinting', () => {
    const latched = updateSprint(createSprintState(), ctx({ sprintRequested: true }));
    const s = updateSprint(latched, ctx({ sneak: true }));
    expect(s.lastCancel).toBe('sneaking');
    expect(s.active).toBe(false);
  });

  it('flying and water cancel sprinting', () => {
    const flying = updateSprint(createSprintState(), ctx({ ctrlHeld: true, flying: true }));
    expect(flying.lastCancel).toBe('flying');
    const water = updateSprint(createSprintState(), ctx({ ctrlHeld: true, inWater: true }));
    expect(water.lastCancel).toBe('in-water');
  });

  it('hunger 6 cancels sprinting and hunger 7 does not', () => {
    const at6 = updateSprint(createSprintState(), ctx({ ctrlHeld: true, hunger: 6 }));
    expect(at6.lastCancel).toBe('hunger');
    const at7 = updateSprint(createSprintState(), ctx({ ctrlHeld: true, hunger: 7 }));
    expect(at7.active).toBe(true);
    expect(at7.lastCancel).toBe(null);
  });

  it('a double tap at hunger 6 never starts sprinting', () => {
    const s = updateSprint(createSprintState(), ctx({ sprintRequested: true, hunger: 6 }));
    expect(s.active).toBe(false);
    expect(s.latched).toBe(false);
    expect(s.lastCancel).toBe('hunger');
  });

  it('creative mode ignores the hunger gate', () => {
    // hunger === null 代表創造模式（無飢餓條）→ 不受 6 點門檻限制
    const s = updateSprint(createSprintState(), ctx({ ctrlHeld: true, hunger: null }));
    expect(s.active).toBe(true);
  });

  it('hunger recovers to 7 with no extra lockout', () => {
    // 飢餓 6 → 取消；回到 7 即可再次開始（不設「>7」的額外鎖定）
    const at6 = updateSprint(createSprintState(), ctx({ ctrlHeld: true, hunger: 6 }));
    expect(at6.active).toBe(false);
    expect(at6.lastCancel).toBe('hunger');
    const at7 = updateSprint(at6, ctx({ ctrlHeld: true, hunger: 7 }));
    expect(at7.active).toBe(true);
    expect(at7.lastCancel).toBe(null);
    // 鎖存路徑一樣：飢餓取消會清掉鎖存，但飢餓回到 7 後雙擊即可重新開始
    const latched = updateSprint(createSprintState(), ctx({ sprintRequested: true }));
    const blocked = updateSprint(latched, ctx({ hunger: 6 }));
    expect(blocked.latched).toBe(false);
    const again = updateSprint(blocked, ctx({ sprintRequested: true, hunger: 7 }));
    expect(again.active).toBe(true);
    expect(again.latched).toBe(true);
  });

  it('a wall hit steeper than 8 degrees cancels sprinting', () => {
    const steep = updateSprint(createSprintState(), ctx({ ctrlHeld: true, wallAngleDeg: 8.1 }));
    expect(steep.lastCancel).toBe('wall');
    const exact = updateSprint(createSprintState(), ctx({ ctrlHeld: true, wallAngleDeg: 8 }));
    expect(exact.active).toBe(true); // 剛好 8° 不取消（門檻是嚴格大於）
  });

  it('ctrl held resumes sprinting after the wall is cleared', () => {
    const blocked = updateSprint(createSprintState(), ctx({ ctrlHeld: true, wallAngleDeg: 45 }));
    expect(blocked.active).toBe(false);
    const cleared = updateSprint(blocked, ctx({ ctrlHeld: true, wallAngleDeg: null }));
    expect(cleared.active).toBe(true);
  });

  it('a latched sprint does not resume after the wall clears', () => {
    const latched = updateSprint(createSprintState(), ctx({ sprintRequested: true }));
    const blocked = updateSprint(latched, ctx({ wallAngleDeg: 45 }));
    expect(blocked.latched).toBe(false); // 鎖存是一次性：被取消即清掉
    const cleared = updateSprint(blocked, ctx({ wallAngleDeg: null }));
    expect(cleared.active).toBe(false);
  });

  it('a landed attack cancels sprinting and clears the latch', () => {
    const latched = updateSprint(createSprintState(), ctx({ sprintRequested: true }));
    const hit = updateSprint(latched, ctx({ attacked: true }));
    expect(hit.lastCancel).toBe('attacked');
    expect(hit.active).toBe(false);
    expect(hit.latched).toBe(false);
    const next = updateSprint(hit, ctx());
    expect(next.active).toBe(false); // 沒有再按 Ctrl → 不恢復
  });

  it('ctrl held sprints again on the frame after an attack', () => {
    const hit = updateSprint(createSprintState(), ctx({ ctrlHeld: true, attacked: true }));
    expect(hit.active).toBe(false);
    const next = updateSprint(hit, ctx({ ctrlHeld: true }));
    expect(next.active).toBe(true);
  });

  it('updateSprint never mutates the previous state', () => {
    const state = createSprintState();
    const result = updateSprint(state, ctx({ ctrlHeld: true }));
    expect(state).toEqual({ active: false, latched: false, ctrlHeld: false, lastCancel: null });
    expect(result).not.toBe(state); // 回傳全新物件
  });

  it('cancelReason reports each cancel reason directly', () => {
    expect(cancelReason(ctx())).toBe(null);
    expect(cancelReason(ctx({ forward: false }))).toBe('no-forward');
    expect(cancelReason(ctx({ sneak: true }))).toBe('sneaking');
    expect(cancelReason(ctx({ flying: true }))).toBe('flying');
    expect(cancelReason(ctx({ inWater: true }))).toBe('in-water');
    expect(cancelReason(ctx({ hunger: 6 }))).toBe('hunger');
    expect(cancelReason(ctx({ wallAngleDeg: 45 }))).toBe('wall');
    expect(cancelReason(ctx({ attacked: true }))).toBe('attacked');
  });

  it('cancel reasons are resolved in a fixed priority order', () => {
    // 同時成立多個條件時，取檔頭註解寫死的順序中最前者：
    // no-forward → sneaking → flying → in-water → hunger → wall → attacked
    expect(cancelReason(ctx({ forward: false, sneak: true }))).toBe('no-forward');
    expect(cancelReason(ctx({ sneak: true, hunger: 6 }))).toBe('sneaking');
    expect(cancelReason(ctx({ flying: true, inWater: true }))).toBe('flying');
    expect(cancelReason(ctx({ inWater: true, hunger: 6 }))).toBe('in-water');
    expect(cancelReason(ctx({ hunger: 6, wallAngleDeg: 45 }))).toBe('hunger');
    expect(cancelReason(ctx({ wallAngleDeg: 45, attacked: true }))).toBe('wall');
    // 同一組條件經由 updateSprint 也必須得到同一個原因
    const s = updateSprint(createSprintState(), ctx({ forward: false, sneak: true }));
    expect(s.lastCancel).toBe('no-forward');
    expect(s.active).toBe(false);
  });

  it('isWallBlock uses a strict 8 degree threshold', () => {
    expect(isWallBlock(8)).toBe(false);
    expect(isWallBlock(8.0001)).toBe(true);
    expect(isWallBlock(null)).toBe(false);
  });

  it('the constants match the vanilla values', () => {
    expect(SPRINT_MIN_HUNGER).toBe(6);
    expect(SPRINT_WALL_ANGLE_DEG).toBe(8);
    expect(SPRINT_DOUBLE_TAP_WINDOW_SEC).toBeCloseTo(0.35, 10);
  });
});
