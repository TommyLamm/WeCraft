import { describe, it, expect } from 'vitest';
import { WORLDGEN_VERSION, needsWorldgenNotice, readWorldgenVersion } from './worldgen';

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

  it('a newer version needs the notice', () => {
    // 存檔的版本比現在還新（例如玩家用未來的版本玩過）→ 不能因為「比現在新」
    // 就不提示：地形對這個版本來說已經改變過了。
    expect(needsWorldgenNotice(WORLDGEN_VERSION + 1)).toBe(true);
  });
});

/**
 * `readWorldgenVersion` 是「什麼算合法版本值」的**唯一**定義處（本機存檔讀取端與
 * 雲端存檔驗證端共用）→ 這裡釘死它的行為，兩邊就不會漂移。
 */
describe('readWorldgenVersion', () => {
  it('keeps a finite number as it is', () => {
    expect(readWorldgenVersion(WORLDGEN_VERSION)).toBe(WORLDGEN_VERSION);
    expect(readWorldgenVersion(0)).toBe(0); // 舊版本的數字照樣保留
    expect(readWorldgenVersion(-1)).toBe(-1);
  });

  it('turns a missing or bogus value into undefined', () => {
    expect(readWorldgenVersion(undefined)).toBeUndefined();
    expect(readWorldgenVersion(null)).toBeUndefined();
    expect(readWorldgenVersion('x')).toBeUndefined();
    expect(readWorldgenVersion(Number.NaN)).toBeUndefined();
    expect(readWorldgenVersion(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(readWorldgenVersion({})).toBeUndefined();
  });
});
