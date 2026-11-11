// B17 Task 5：經驗 HUD（`.xp-bar`／`.xp-bar-fill`／`.xp-level`）。
//
// 形狀沿用其他 ui 模組的慣例（eat-progress／toast／hurt）：`main` 持有實例、
// 本模組只管 DOM。`set(null)`（創造模式、或還沒有資料）→ 兩個節點隱藏；
// **同值不重寫**（每幀都會呼叫 set → 快取等級與整數百分比，變了才動 DOM）。
import { beforeEach, describe, it, expect } from 'vitest';
import { createXpHud } from './xp-hud';

beforeEach(() => {
  document.getElementById('ui-root')?.remove();
  const root = document.createElement('div');
  root.id = 'ui-root';
  document.body.appendChild(root);
});

const root = (): HTMLElement => document.getElementById('ui-root')!;

const bar = (): HTMLElement | null => root().querySelector<HTMLElement>('.xp-bar');
const fill = (): HTMLElement | null => root().querySelector<HTMLElement>('.xp-bar-fill');
const level = (): HTMLElement | null => root().querySelector<HTMLElement>('.xp-level');

describe('createXpHud', () => {
  it('renders the level and fill percentage', () => {
    const hud = createXpHud(root());
    // xpToNext(3) = 13 → 3/13 ≈ 23%
    hud.set({ level: 3, xp: 3 });
    expect(level()!.textContent).toBe('3');
    expect(fill()!.style.width).toBe('23%');
    // 有資料 → 兩個節點都顯示。
    expect(bar()!.style.display).not.toBe('none');
    expect(level()!.style.display).not.toBe('none');
    hud.dispose();
  });

  it('hides both nodes for null and shows them again', () => {
    const hud = createXpHud(root());
    // 還沒 set 過 → 初始就是隱藏（不閃出「等級 0」的空條）。
    expect(bar()!.style.display).toBe('none');
    expect(level()!.style.display).toBe('none');

    hud.set({ level: 2, xp: 1 });
    expect(bar()!.style.display).not.toBe('none');
    expect(level()!.style.display).not.toBe('none');

    // 創造模式：兩個節點一起隱藏。
    hud.set(null);
    expect(bar()!.style.display).toBe('none');
    expect(level()!.style.display).toBe('none');

    // 切回生存 → 重新顯示，並以新值重寫。
    hud.set({ level: 5, xp: 2 });
    expect(bar()!.style.display).not.toBe('none');
    expect(level()!.style.display).not.toBe('none');
    expect(level()!.textContent).toBe('5');
    hud.dispose();
  });

  it('does not rewrite the DOM when nothing changed', () => {
    const hud = createXpHud(root());
    hud.set({ level: 3, xp: 3 });
    // 手動把 DOM 改成快取以外的值：同值 set **不得把它改回去**
    // （＝這次 set 完全沒有寫樣式／文字）。
    fill()!.style.width = '99%';
    level()!.textContent = '9';
    hud.set({ level: 3, xp: 3 });
    expect(fill()!.style.width).toBe('99%');
    expect(level()!.textContent).toBe('9');

    // 值真的變了才會重寫：xpToNext(4) = 15 → 5/15 ≈ 33%。
    hud.set({ level: 4, xp: 5 });
    expect(fill()!.style.width).toBe('33%');
    expect(level()!.textContent).toBe('4');
    hud.dispose();
  });

  it('removes both nodes on dispose', () => {
    const hud = createXpHud(root());
    hud.set({ level: 1, xp: 0 });
    expect(bar()).not.toBeNull();
    expect(level()).not.toBeNull();
    hud.dispose();
    expect(root().querySelector('.xp-bar')).toBeNull();
    expect(root().querySelector('.xp-level')).toBeNull();
  });
});
