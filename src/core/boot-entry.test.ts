import { describe, it, expect } from 'vitest';
import { titleEntry } from './boot-entry';

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
