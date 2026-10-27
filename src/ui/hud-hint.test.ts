/** 疾跑取消提示（B5）：`ui/hud-hint.ts` —— 節流提示元件 ＋ 原因文案。
 *
 *  B5 的缺口：`sprintState.lastCancel` 與 `lastWallAngleDeg` 只餵狀態機，全 repo
 *  沒有第二處引用 → 玩家永遠不知道「為什麼疾跑突然停了」（尤其撞牆 8° 門檻）。
 *  這裡釘住提示的三件事：顯示、**同一文案 3 秒內不重複**、不同文案立刻取代、
 *  以及 dispose／hide 的清理。
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  HUD_HINT_DURATION_MS,
  HUD_HINT_THROTTLE_MS,
  createHudHint,
  sprintCancelHint,
} from './hud-hint';

beforeEach(() => {
  vi.useFakeTimers(); // 提示有隱藏計時器 → 一律用假時鐘
  document.getElementById('ui-root')?.remove();
  const root = document.createElement('div');
  root.id = 'ui-root';
  document.body.appendChild(root);
});

afterEach(() => {
  vi.useRealTimers();
});

const root = (): HTMLElement => document.getElementById('ui-root')!;
const hint = (): HTMLElement | null => root().querySelector<HTMLElement>('.ui-hint');

describe('createHudHint', () => {
  it('show renders the hint text', () => {
    const h = createHudHint(root());
    h.show('撞牆，疾跑取消（15°）');
    expect(hint()).not.toBeNull();
    expect(hint()!.textContent).toBe('撞牆，疾跑取消（15°）');
    expect(hint()!.classList.contains('visible')).toBe(true); // 淡入由 CSS 負責
    h.dispose();
  });

  it('the same text is not shown again within the throttle window', () => {
    let now = 0;
    const h = createHudHint(root(), { now: () => now });
    h.show('A');
    now = HUD_HINT_THROTTLE_MS - 1;
    h.show('A'); // 節流：不得重設計時器
    // 若第二呼叫真的重新顯示，隱藏計時器會從 now 重新起算 → 2 秒後仍可見。
    vi.advanceTimersByTime(HUD_HINT_DURATION_MS);
    expect(hint()!.classList.contains('visible')).toBe(false);
    expect(hint()!.textContent).toBe('A'); // 節流不是清空——文字留著（只是不可見）
    h.dispose();
  });

  it('the same text shows again after the throttle window', () => {
    let now = 0;
    const h = createHudHint(root(), { now: () => now });
    h.show('A');
    vi.advanceTimersByTime(HUD_HINT_DURATION_MS); // 已淡出
    now = HUD_HINT_THROTTLE_MS; // 節流窗口已過
    h.show('A');
    expect(hint()!.classList.contains('visible')).toBe(true);
    h.dispose();
  });

  it('a different text replaces the current hint immediately', () => {
    let now = 0;
    const h = createHudHint(root(), { now: () => now });
    h.show('A');
    now = 100; // 還在節流窗口內——但文字不同 → 立刻取代
    h.show('B');
    expect(hint()!.textContent).toBe('B');
    expect(hint()!.classList.contains('visible')).toBe(true);
    // 新文案的隱藏計時器從第二次顯示起算（第一次的 2 秒不得提早收掉 B）。
    vi.advanceTimersByTime(HUD_HINT_DURATION_MS - 1);
    expect(hint()!.classList.contains('visible')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(hint()!.classList.contains('visible')).toBe(false);
    h.dispose();
  });

  it('hide clears the visible hint but keeps the element (session reset)', () => {
    const h = createHudHint(root());
    h.show('A');
    h.hide();
    expect(hint()!.classList.contains('visible')).toBe(false);
    expect(hint()).not.toBeNull(); // 元素還在——下一場次可以再用
    // hide 也重置節流：同一文案在新場次可以立刻再顯示。
    h.show('A');
    expect(hint()!.classList.contains('visible')).toBe(true);
    h.dispose();
  });

  it('dispose removes the element and cancels pending timers', () => {
    const h = createHudHint(root());
    h.show('A');
    h.dispose();
    expect(hint()).toBeNull();
    // 已排程的隱藏計時器不得在 dispose 之後碰 DOM（不炸、不再生）。
    expect(() => vi.advanceTimersByTime(HUD_HINT_DURATION_MS * 2)).not.toThrow();
    // dispose 之後 show 是 no-op（不復活元素）。
    h.show('B');
    expect(hint()).toBeNull();
  });
});

describe('sprintCancelHint（B5 文案）', () => {
  it('the wall hint carries the (rounded) collision angle', () => {
    expect(sprintCancelHint('wall', 8.4)).toBe('撞牆，疾跑取消（8°）');
    expect(sprintCancelHint('wall', 31.6)).toBe('撞牆，疾跑取消（32°）');
    // 防守：沒有角度資料時不得顯示 NaN。
    expect(sprintCancelHint('wall', null)).toBe('撞牆，疾跑取消（0°）');
  });

  it('every other reason maps to its own text', () => {
    expect(sprintCancelHint('hunger', null)).toBe('飢餓過低，疾跑取消');
    expect(sprintCancelHint('attacked', null)).toBe('受擊，疾跑取消');
    expect(sprintCancelHint('sneaking', null)).toBe('潛行，疾跑取消');
    expect(sprintCancelHint('in-water', null)).toBe('水中，疾跑取消');
    expect(sprintCancelHint('flying', null)).toBe('飛行中，疾跑取消');
  });

  it('the throttle and duration are the documented 3 s / 2 s', () => {
    expect(HUD_HINT_THROTTLE_MS).toBe(3000);
    expect(HUD_HINT_DURATION_MS).toBe(2000);
  });
});
