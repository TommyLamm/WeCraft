import { describe, it, expect } from 'vitest';
import {
  WEATHER_CLEAR_MIN_SEC,
  WEATHER_CLEAR_MAX_SEC,
  WEATHER_RAIN_MIN_SEC,
  WEATHER_RAIN_MAX_SEC,
  WEATHER_THUNDER_MIN_SEC,
  WEATHER_THUNDER_MAX_SEC,
  WEATHER_THUNDER_CHANCE,
  WEATHER_THUNDER_FIRST_FLASH_MIN_SEC,
  WEATHER_THUNDER_FIRST_FLASH_MAX_SEC,
  WEATHER_FLASH_MIN_SEC,
  WEATHER_FLASH_MAX_SEC,
  WEATHER_FLASH_SEC,
  createWeather,
  stepWeather,
  weatherLabel,
  weatherChangeText,
  weatherLightScale,
  applyWeatherTint,
  parseWeatherOverride,
  type WeatherState,
} from './weather';
import type { DayNightColors } from '../core/daynight';

/** Deterministic rng from a sequence; falls back to 0 after the sequence ends. */
const seq = (...values: number[]): (() => number) => {
  let i = 0;
  return () => values[i++] ?? 0;
};

const clearState = (over: Partial<WeatherState> = {}): WeatherState => ({
  mode: 'clear',
  remaining: 90,
  nextFlash: 0,
  flashRemaining: 0,
  locked: false,
  ...over,
});

const DAY: DayNightColors = {
  sky: 0x87ceeb,
  zenith: 0x3d6fc9,
  fog: 0x87ceeb,
  ambient: 0.75,
  sunIntensity: 0.9,
};

describe('weather tuning constants (B15)', () => {
  it('pins the schedule, thunder chance and flash timing', () => {
    expect(WEATHER_CLEAR_MIN_SEC).toBe(90);
    expect(WEATHER_CLEAR_MAX_SEC).toBe(210);
    expect(WEATHER_RAIN_MIN_SEC).toBe(45);
    expect(WEATHER_RAIN_MAX_SEC).toBe(120);
    expect(WEATHER_THUNDER_MIN_SEC).toBe(20);
    expect(WEATHER_THUNDER_MAX_SEC).toBe(60);
    expect(WEATHER_THUNDER_CHANCE).toBe(0.35);
    expect(WEATHER_THUNDER_FIRST_FLASH_MIN_SEC).toBe(1);
    expect(WEATHER_THUNDER_FIRST_FLASH_MAX_SEC).toBe(4);
    expect(WEATHER_FLASH_MIN_SEC).toBe(4);
    expect(WEATHER_FLASH_MAX_SEC).toBe(12);
    expect(WEATHER_FLASH_SEC).toBe(0.18);
  });
});

describe('createWeather', () => {
  it('starts clear with a rolled duration and no pending flash', () => {
    expect(createWeather(() => 0)).toEqual({
      mode: 'clear',
      remaining: WEATHER_CLEAR_MIN_SEC,
      nextFlash: 0,
      flashRemaining: 0,
      locked: false,
    });
    expect(createWeather(() => 1).remaining).toBe(WEATHER_CLEAR_MAX_SEC);
    expect(createWeather(() => Number.NaN).remaining).toBe(WEATHER_CLEAR_MIN_SEC);
    expect(createWeather(() => -1).remaining).toBe(WEATHER_CLEAR_MIN_SEC);
    expect(createWeather(() => 2).remaining).toBe(WEATHER_CLEAR_MAX_SEC);
  });

  it('can be created in a locked thunder mode with the first flash scheduled', () => {
    const thunder = createWeather(() => 0, 'thunder', true);
    expect(thunder.mode).toBe('thunder');
    expect(thunder.remaining).toBe(WEATHER_THUNDER_MIN_SEC);
    expect(thunder.nextFlash).toBe(WEATHER_THUNDER_FIRST_FLASH_MIN_SEC);
    expect(thunder.flashRemaining).toBe(0);
    expect(thunder.locked).toBe(true);
  });
});

describe('stepWeather transitions', () => {
  it('clear → rain after the clear duration', () => {
    const tick = stepWeather(clearState(), WEATHER_CLEAR_MIN_SEC, () => 0);
    expect(tick.changed).toBe(true);
    expect(tick.lightning).toBe(false);
    expect(tick.state.mode).toBe('rain');
    expect(tick.state.remaining).toBe(WEATHER_RAIN_MIN_SEC);
    expect(tick.state.nextFlash).toBe(0);
  });

  it('rain → thunder with rng below the thunder chance (and schedules first flash)', () => {
    const rain = clearState({ mode: 'rain', remaining: WEATHER_RAIN_MIN_SEC });
    const tick = stepWeather(rain, WEATHER_RAIN_MIN_SEC, seq(0.1, 0, 0));
    expect(tick.changed).toBe(true);
    expect(tick.state.mode).toBe('thunder');
    expect(tick.state.remaining).toBe(WEATHER_THUNDER_MIN_SEC);
    expect(tick.state.nextFlash).toBe(WEATHER_THUNDER_FIRST_FLASH_MIN_SEC);
  });

  it('rain → clear with rng at/above the thunder chance', () => {
    const rain = clearState({ mode: 'rain', remaining: WEATHER_RAIN_MIN_SEC });
    const tick = stepWeather(rain, WEATHER_RAIN_MIN_SEC, seq(0.9, 0.5));
    expect(tick.changed).toBe(true);
    expect(tick.state.mode).toBe('clear');
    expect(tick.state.remaining).toBe(150); // 90 + 0.5 × 120
  });

  it('thunder → rain, clearing the flash schedule', () => {
    const thunder = clearState({ mode: 'thunder', remaining: 20, nextFlash: 3 });
    const tick = stepWeather(thunder, 20, () => 0);
    expect(tick.changed).toBe(true);
    expect(tick.state.mode).toBe('rain');
    expect(tick.state.remaining).toBe(WEATHER_RAIN_MIN_SEC);
    expect(tick.state.nextFlash).toBe(0);
    expect(tick.state.flashRemaining).toBe(0);
  });

  it('a huge dt still transitions once and never leaves a negative remaining', () => {
    const tick = stepWeather(clearState(), 10_000, () => 0);
    expect(tick.changed).toBe(true);
    expect(tick.state.mode).toBe('rain');
    expect(tick.state.remaining).toBe(WEATHER_RAIN_MIN_SEC);
    expect(tick.state.remaining).toBeGreaterThan(0);
  });

  it('a locked state never transitions but still flashes', () => {
    const thunder = createWeather(() => 0, 'thunder', true);
    const tick = stepWeather(thunder, 10_000, () => 0);
    expect(tick.changed).toBe(false);
    expect(tick.state.mode).toBe('thunder');
    expect(tick.state.remaining).toBe(WEATHER_THUNDER_MIN_SEC); // unchanged
    expect(tick.lightning).toBe(true);
    expect(tick.flash).toBe(1);
  });

  it('non-finite or non-positive dt is a pure no-op', () => {
    const state = clearState({ remaining: 12.5 });
    for (const dt of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
      const tick = stepWeather(state, dt, () => 0);
      expect(tick.changed).toBe(false);
      expect(tick.lightning).toBe(false);
      expect(tick.state).toEqual(state);
      expect(tick.state).not.toBe(state);
    }
  });
});

describe('stepWeather lightning', () => {
  it('flashes at the scheduled time, then decays over WEATHER_FLASH_SEC', () => {
    const thunder = createWeather(() => 0, 'thunder', true); // first flash at 1 s
    const first = stepWeather(thunder, WEATHER_THUNDER_FIRST_FLASH_MIN_SEC, () => 0);
    expect(first.lightning).toBe(true);
    expect(first.flash).toBe(1);
    expect(first.state.flashRemaining).toBe(WEATHER_FLASH_SEC);
    expect(first.state.nextFlash).toBe(WEATHER_FLASH_MIN_SEC);

    const decay = stepWeather(first.state, 0.1, () => 0);
    expect(decay.lightning).toBe(false);
    expect(decay.flash).toBeCloseTo(0.08 / WEATHER_FLASH_SEC, 10);

    const dark = stepWeather(decay.state, 0.18, () => 0);
    expect(dark.flash).toBe(0);
  });

  it('reschedules the next flash within [4, 12] seconds', () => {
    const thunder = createWeather(() => 0, 'thunder', true);
    const first = stepWeather(thunder, 1, () => 1);
    expect(first.state.nextFlash).toBe(WEATHER_FLASH_MAX_SEC);
  });
});

describe('weather labels', () => {
  it('uses the player-facing Chinese labels and transition copy', () => {
    expect(weatherLabel('clear')).toBe('晴朗');
    expect(weatherLabel('rain')).toBe('下雨');
    expect(weatherLabel('thunder')).toBe('雷雨');
    expect(weatherChangeText('clear')).toBe('放晴了');
    expect(weatherChangeText('rain')).toBe('開始下雨了');
    expect(weatherChangeText('thunder')).toBe('雷雨來了');
  });
});

describe('weather visual math', () => {
  it('weatherLightScale darkens rain and thunder, and a flash brightens the world', () => {
    expect(weatherLightScale('clear')).toBe(1);
    expect(weatherLightScale('rain')).toBeCloseTo(0.82, 10);
    expect(weatherLightScale('thunder')).toBeCloseTo(0.68, 10);
    expect(weatherLightScale('clear', 1)).toBeGreaterThan(1);
    expect(weatherLightScale('thunder', 1)).toBeGreaterThan(weatherLightScale('thunder'));
    expect(weatherLightScale('thunder', 1)).toBeLessThanOrEqual(1.2);
  });

  it('clear weather leaves every day/night colour untouched', () => {
    expect(applyWeatherTint(DAY, 'clear')).toEqual(DAY);
  });

  it('rain and thunder darken the sky and reduce ambient/sun light', () => {
    const rain = applyWeatherTint(DAY, 'rain');
    const thunder = applyWeatherTint(DAY, 'thunder');
    expect(rain.sky).not.toBe(DAY.sky);
    expect(rain.zenith).not.toBe(DAY.zenith);
    expect(rain.ambient).toBeCloseTo(0.75 * 0.85, 10);
    expect(rain.sunIntensity).toBeCloseTo(0.9 * 0.55, 10);
    expect(thunder.ambient).toBeCloseTo(0.75 * 0.72, 10);
    expect(thunder.sunIntensity).toBeCloseTo(0.9 * 0.35, 10);
    expect(thunder.ambient).toBeLessThan(rain.ambient);
  });

  it('a lightning flash brightens the ambient and sky but never mutates the input', () => {
    const before = { ...DAY };
    const flash = applyWeatherTint(DAY, 'thunder', 1);
    expect(flash.ambient).toBeGreaterThan(applyWeatherTint(DAY, 'thunder').ambient);
    expect(flash.sky).not.toBe(applyWeatherTint(DAY, 'thunder').sky);
    expect(DAY).toEqual(before);
  });
});

describe('parseWeatherOverride', () => {
  it('accepts only the three lowercase weather values', () => {
    expect(parseWeatherOverride('?weather=rain')).toBe('rain');
    expect(parseWeatherOverride('?x=1&weather=thunder')).toBe('thunder');
    expect(parseWeatherOverride('?weather=clear')).toBe('clear');
    expect(parseWeatherOverride('?weather=snow')).toBeNull();
    expect(parseWeatherOverride('?weather=RAIN')).toBeNull();
    expect(parseWeatherOverride('')).toBeNull();
    expect(parseWeatherOverride('?weather=')).toBeNull();
  });
});
