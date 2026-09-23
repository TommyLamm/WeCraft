export interface Settings {
  seed: number;
  renderDistance: number;
  sensitivity: number;
  volume: number;
}

export const DEFAULT_SETTINGS: Settings = {
  seed: 1337,
  renderDistance: 10,
  sensitivity: 1.0,
  volume: 0.8,
};

const KEY = 'wecraft.settings';

function clampSettings(s: Settings): Settings {
  return {
    ...s,
    renderDistance: Math.min(16, Math.max(6, Math.round(s.renderDistance))),
    sensitivity: Math.min(3, Math.max(0.1, s.sensitivity)),
    volume: Math.min(1, Math.max(0, s.volume)),
    seed: Math.floor(s.seed) || 0,
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
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
