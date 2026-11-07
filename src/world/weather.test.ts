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
  isSkyExposed,
  type WeatherState,
} from './weather';
import type { DayNightColors } from '../core/daynight';
import { BLOCK, type BlockId } from './blocks';
import { World } from './world';
import { computeChunkLight, spawnLightAt } from './lighting';

/** 把 [x0..x1]×[y0..y1]×[z0..z1] 填滿同一種方塊（含端點）；與 lighting.test.ts 同款。 */
const fill = (
  w: World,
  id: number,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
) => {
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) w.setBlock(x, y, z, id as BlockId);
};

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

// ── B15（Task 8 修正）：雨絲的曝露判準 ──────────────────────────────────────
// 門檻必須是「天空光 15（頭頂整柱無不透明方塊）」而不是「≥ 8」：本引擎的單格厚
// 屋簷下天空光是 14（水平 −1；B6 Task 2 的光照測試釘死）——用 ≥8 會讓屋內照常
// 下雨，違反「室內／洞穴／水下整片隱藏」的承諾（README／spec／release notes）。
// 15 恰好等於原版的 canSeeSky：只有完全開闊的直柱會淋到雨（1×1 直井也會，與原版
// 一致）；樹葉／玻璃是透明方塊 → 光穿過 → 下方仍看得到雨絲（本作既有的光照簡化）。

describe('isSkyExposed（B15：雨絲曝露判準）', () => {
  it('open sky (15) is exposed; anything under a roof (14) is not', () => {
    expect(isSkyExposed({ lit: true, sky: 15 }, false)).toBe(true);
    // 屋簷下（14）＝室內 → 整片隱藏（這是 ≥8 舊門檻的回歸鎖）。
    expect(isSkyExposed({ lit: true, sky: 14 }, false)).toBe(false);
    expect(isSkyExposed({ lit: true, sky: 8 }, false)).toBe(false);
  });

  it('caves, unlit chunks and underwater are never exposed', () => {
    expect(isSkyExposed({ lit: true, sky: 0 }, false)).toBe(false); // 洞穴
    expect(isSkyExposed({ lit: false, sky: 0 }, false)).toBe(false); // 未點光 = 未知
    expect(isSkyExposed({ lit: true, sky: 15 }, true)).toBe(false); // 水下
  });

  it('the rule reads the real lighting engine (roof → hidden, open column → visible)', () => {
    const w = new World();
    fill(w, BLOCK.STONE, 0, 63, 0, 15, 63, 15); // 地表
    w.setBlock(5, 70, 5, BLOCK.STONE); // 單格厚屋簷
    computeChunkLight(w, 0, 0);
    // 開闊柱（4,69,5）→ 天空光 15 → 淋得到雨。
    expect(spawnLightAt(w, 4, 69, 5, 0.25).sky).toBe(15);
    expect(isSkyExposed(spawnLightAt(w, 4, 69, 5, 0.25), false)).toBe(true);
    // 屋簷正下方（5,69,5）→ 天空光 14 → 整片隱藏。
    expect(spawnLightAt(w, 5, 69, 5, 0.25).sky).toBe(14);
    expect(isSkyExposed(spawnLightAt(w, 5, 69, 5, 0.25), false)).toBe(false);
  });
});
