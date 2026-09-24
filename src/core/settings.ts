import type { GameMode } from './inventory';

export interface Settings {
  seed: number;
  renderDistance: number;
  sensitivity: number;
  volume: number;
  /** Game mode (Task 5). Default survival — flips the Phase 1 creative default. */
  mode: GameMode;
}

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  seed: 1337,
  renderDistance: 10,
  sensitivity: 1.0,
  volume: 0.8,
  mode: 'survival',
});

const KEY = 'wecraft.settings';

const finite = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

function clampSettings(s: Settings): Settings {
  const seed = finite(s.seed, DEFAULT_SETTINGS.seed);
  return {
    seed: Math.floor(seed) || 0,
    renderDistance: Math.min(16, Math.max(6, Math.round(finite(s.renderDistance, DEFAULT_SETTINGS.renderDistance)))),
    sensitivity: Math.min(3, Math.max(0.1, finite(s.sensitivity, DEFAULT_SETTINGS.sensitivity))),
    volume: Math.min(1, Math.max(0, finite(s.volume, DEFAULT_SETTINGS.volume))),
    // anything that isn't exactly 'creative' falls back to the default mode
    mode: s.mode === 'creative' ? 'creative' : 'survival',
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return clampSettings({ ...DEFAULT_SETTINGS, ...parsed });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = clampSettings({ ...loadSettings(), ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (err) {
    console.warn('Failed to persist settings', err);
  }
  return next;
}
