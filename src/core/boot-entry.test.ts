import { describe, it, expect } from 'vitest';
import { titleEntry, titleTriState } from './boot-entry';

// Final-review Critical (Rulings I/J): the title entry decision is pure and
// pinned here — all four presence combinations, with cloud winning when both.
describe('titleEntry', () => {
  it.each([
    { hasLocalSave: false, cloudApplied: false, expected: 'none' as const },
    { hasLocalSave: true, cloudApplied: false, expected: 'local' as const },
    { hasLocalSave: false, cloudApplied: true, expected: 'cloud' as const },
    // Ruling J: both present → the boot-applied cloud state wins the entry.
    { hasLocalSave: true, cloudApplied: true, expected: 'cloud' as const },
  ])(
    'hasLocalSave=$hasLocalSave, cloudApplied=$cloudApplied → $expected',
    ({ hasLocalSave, cloudApplied, expected }) => {
      expect(titleEntry({ hasLocalSave, cloudApplied })).toBe(expected);
    },
  );
});

// 修復波 review CR-1：標題三態（Continue 的 disabled/hidden 與 B1.4 的覆蓋
// 確認共用同一個決策）必須**每次 render 由 titleEntry 推導**——`savedPayload`
// 會在場中存檔後改變（autosave／儲存並離開）。之前把它快取在一個模組變數
// （只在開機 settle 時寫一次）→ 第一場存檔後回到標題，「繼續遊戲」消失、
// 單人遊戲也不再問覆蓋（資料會被下一次 autosave 直接蓋掉）。
describe('titleTriState', () => {
  it('is pending while the boot check has not settled', () => {
    expect(titleTriState({ pending: true, hasLocalSave: false, cloudApplied: false })).toBe('pending');
    // 即使已經知道有存檔，settle 前仍是 pending（答案還可能被雲端改寫）。
    expect(titleTriState({ pending: true, hasLocalSave: true, cloudApplied: false })).toBe('pending');
    expect(titleTriState({ pending: true, hasLocalSave: true, cloudApplied: true })).toBe('pending');
  });

  it('is no when no entry exists', () => {
    expect(titleTriState({ pending: false, hasLocalSave: false, cloudApplied: false })).toBe('no');
  });

  it('is yes for a local save and for a boot-applied cloud payload', () => {
    expect(titleTriState({ pending: false, hasLocalSave: true, cloudApplied: false })).toBe('yes');
    expect(titleTriState({ pending: false, hasLocalSave: false, cloudApplied: true })).toBe('yes');
    expect(titleTriState({ pending: false, hasLocalSave: true, cloudApplied: true })).toBe('yes');
  });

  it('an in-session save turns a settled no into yes (no caching across renders)', () => {
    // 同一個 pending=false 的起點：存檔前 no、存檔後（hasLocalSave 變 true）yes
    // ——呼叫端每次 render 重算才會看到這個轉變。
    const before = titleTriState({ pending: false, hasLocalSave: false, cloudApplied: false });
    const after = titleTriState({ pending: false, hasLocalSave: true, cloudApplied: false });
    expect(before).toBe('no');
    expect(after).toBe('yes');
  });
});
