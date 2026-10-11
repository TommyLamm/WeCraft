import type { GameMode } from './inventory';
import { DEFAULT_DAY_LENGTH_SEC, MIN_DAY_LENGTH_SEC, MAX_DAY_LENGTH_SEC } from './daynight';

export interface Settings {
  seed: number;
  renderDistance: number;
  sensitivity: number;
  volume: number;
  /** Game mode (Task 5). Default survival — flips the Phase 1 creative default. */
  mode: GameMode;
  /** Seconds per full day/night cycle (Task 6). Clamped 60–3600. */
  dayLengthSec: number;
  /** Dynamic sun shadows (Phase 3 Task 5). Default on; non-boolean → default. */
  shadows: boolean;
  /** Blocky cloud layer (Phase 3 Task 7). Default on; non-boolean → default. */
  clouds: boolean;
}

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  seed: 1337,
  renderDistance: 10,
  sensitivity: 1.0,
  volume: 0.8,
  mode: 'survival',
  dayLengthSec: DEFAULT_DAY_LENGTH_SEC,
  shadows: true,
  clouds: true,
});

const KEY = 'wecraft.settings';

const finite = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

export function clampSettings(s: Settings): Settings {
  const seed = finite(s.seed, DEFAULT_SETTINGS.seed);
  return {
    seed: Math.floor(seed) || 0,
    renderDistance: Math.min(16, Math.max(6, Math.round(finite(s.renderDistance, DEFAULT_SETTINGS.renderDistance)))),
    sensitivity: Math.min(3, Math.max(0.1, finite(s.sensitivity, DEFAULT_SETTINGS.sensitivity))),
    volume: Math.min(1, Math.max(0, finite(s.volume, DEFAULT_SETTINGS.volume))),
    // anything that isn't exactly 'creative' falls back to the default mode
    mode: s.mode === 'creative' ? 'creative' : 'survival',
    // 60–3600 s (shared bounds with createClock): fast enough for testing (60),
    // sane floor against degenerate values; non-finite → DEFAULT_DAY_LENGTH_SEC
    dayLengthSec: Math.min(
      MAX_DAY_LENGTH_SEC,
      Math.max(MIN_DAY_LENGTH_SEC, finite(s.dayLengthSec, DEFAULT_DAY_LENGTH_SEC)),
    ),
    // anything that isn't exactly a boolean falls back to the default (on)
    shadows: typeof s.shadows === 'boolean' ? s.shadows : DEFAULT_SETTINGS.shadows,
    // same guard for the cloud toggle (Phase 3 Task 7)
    clouds: typeof s.clouds === 'boolean' ? s.clouds : DEFAULT_SETTINGS.clouds,
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
