import { describe, it, expect } from 'vitest';
import { WORLDGEN_VERSION, needsWorldgenNotice } from './worldgen';

/**
 * B3 Task 7：世界生成版本戳記。
 *
 * 這是純模組（不依賴 DOM／IndexedDB／Three），所以測試不需要任何環境準備。
 */
describe('worldgen version', () => {
  it('the worldgen version is 1', () => {
    expect(WORLDGEN_VERSION).toBe(1);
  });

  it('a missing version needs the notice', () => {
    // 舊存檔（附加欄位不存在）= 地形是用舊生成器生成的 → 要提示一次
    expect(needsWorldgenNotice(undefined)).toBe(true);
    expect(needsWorldgenNotice(null)).toBe(true);
  });

  it('the current version does not need the notice', () => {
    expect(needsWorldgenNotice(WORLDGEN_VERSION)).toBe(false);
  });

  it('an older version needs the notice', () => {
    expect(needsWorldgenNotice(WORLDGEN_VERSION - 1)).toBe(true);
  });
});
