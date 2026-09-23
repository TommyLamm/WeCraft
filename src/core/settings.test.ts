import { describe, it, expect, beforeEach } from 'vitest';
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
});
