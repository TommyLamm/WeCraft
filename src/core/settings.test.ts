import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from './settings';

beforeEach(() => {
  localStorage.clear();
});

describe('settings', () => {
  it('returns defaults when nothing stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('persists and reloads', () => {
    saveSettings({ renderDistance: 8, sensitivity: 0.3 });
    const s = loadSettings();
    expect(s.renderDistance).toBe(8);
    expect(s.sensitivity).toBe(0.3);
    expect(s.volume).toBe(DEFAULT_SETTINGS.volume);
  });

  it('clamps out-of-range renderDistance', () => {
    saveSettings({ renderDistance: 999 });
    expect(loadSettings().renderDistance).toBe(16);
    saveSettings({ renderDistance: 1 });
    expect(loadSettings().renderDistance).toBe(6);
  });

  it('returns defaults when stored JSON is corrupt', () => {
    localStorage.setItem('wecraft.settings', '{oops');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps out-of-range sensitivity and volume on save', () => {
    const next = saveSettings({ sensitivity: 99, volume: -1 });
    expect(next.sensitivity).toBe(3);
    expect(next.volume).toBe(0);
    expect(loadSettings().sensitivity).toBe(3);
    expect(loadSettings().volume).toBe(0);
  });

  it('falls back to defaults for non-finite stored values', () => {
    localStorage.setItem(
      'wecraft.settings',
      JSON.stringify({ sensitivity: 'abc' }),
    );
    const s = loadSettings();
    expect(s.sensitivity).toBe(DEFAULT_SETTINGS.sensitivity);
    expect(Number.isFinite(s.sensitivity)).toBe(true);
  });

  it('defaults mode to survival (Task 5)', () => {
    expect(loadSettings().mode).toBe('survival');
    expect(DEFAULT_SETTINGS.mode).toBe('survival');
  });

  it('persists and reloads mode', () => {
    saveSettings({ mode: 'creative' });
    expect(loadSettings().mode).toBe('creative');
    saveSettings({ mode: 'survival' });
    expect(loadSettings().mode).toBe('survival');
  });

  it('falls back to survival for an invalid stored mode', () => {
    localStorage.setItem(
      'wecraft.settings',
      JSON.stringify({ mode: 'wandering-trader' }),
    );
    expect(loadSettings().mode).toBe('survival');
  });

  it('still returns settings when localStorage.setItem throws', () => {
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota');
      });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const next = saveSettings({ sensitivity: 2 });
      expect(next.sensitivity).toBe(2);
      expect(warn).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      warn.mockRestore();
    }
  });
});
