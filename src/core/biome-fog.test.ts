import { describe, it, expect } from 'vitest';
import { applyBiomeTint, BIOME_FOG_TINT } from './biome-fog';

describe('BIOME_FOG_TINT', () => {
  it('pins the per-biome tint colors', () => {
    expect(BIOME_FOG_TINT.plains).toBe(0xffffff);
    expect(BIOME_FOG_TINT.desert).toBe(0xffd9a0);
    expect(BIOME_FOG_TINT.forest).toBe(0xc2e0b2);
    expect(BIOME_FOG_TINT.snow).toBe(0xe8f4ff);
  });
});

describe('applyBiomeTint', () => {
  it('leaves plains fog untouched (white is the neutral tint)', () => {
    // Controller ruling: per-channel lerp toward 0xffffff would brighten an
    // arbitrary fog color, so the neutral (plains) tint short-circuits.
    expect(applyBiomeTint(0x808080, 'plains')).toBe(0x808080);
    expect(applyBiomeTint(0x0a0e1a, 'plains')).toBe(0x0a0e1a);
  });

  it('lerps each channel toward the biome tint — desert exact value', () => {
    // r: 128 + (255−128)·0.25 = 159.75 → 160; g: 128 + (217−128)·0.25 = 150.25
    // → 150; b: 128 + (160−128)·0.25 = 136
    expect(applyBiomeTint(0x808080, 'desert')).toBe(0xa09688);
  });

  it('strength = 0 leaves the fog untouched', () => {
    expect(applyBiomeTint(0x808080, 'desert', 0)).toBe(0x808080);
  });

  it('non-finite or negative strength leaves the fog untouched', () => {
    for (const s of [-1, NaN, Infinity]) {
      expect(applyBiomeTint(0x808080, 'desert', s)).toBe(0x808080);
    }
  });

  it('strength = 1 reaches the tint exactly', () => {
    expect(applyBiomeTint(0x000000, 'forest', 1)).toBe(0xc2e0b2);
    expect(applyBiomeTint(0x000000, 'snow', 1)).toBe(0xe8f4ff);
  });

  it('every tinted biome moves the color toward its tint', () => {
    for (const biome of ['desert', 'forest', 'snow'] as const) {
      expect(applyBiomeTint(0x808080, biome)).not.toBe(0x808080);
    }
  });
});
