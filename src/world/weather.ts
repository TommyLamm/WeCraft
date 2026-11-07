/** 天氣純邏輯（B15）：晴朗／下雨／雷雨三態、轉場與閃電排程、天色與亮度調整、
 *  以及驗收用的 `?weather=` 查詢參數解析。
 *
 *  這個模組不碰 Three／DOM／世界，也不讀寫存檔。天氣在 `main.ts` 是**暫態**：
 *  新局、繼續遊戲或雲端套用後都重新建立（與引信 TNT／敵對生物同級）。
 *
 *  明示簡化（README〈與原版的差異〉）：
 *  - 雨絲只跟相機、不逐格遮蔽；玩家在室內／洞穴／水下時整片隱藏。
 *  - 雷電只有閃光與雷聲，不會打中生物、不會起火、不會破壞方塊。
 *  - 雷聲與閃光同時播放，沒有原版的距離延遲。
 *  - 天氣不跨存檔；重開／繼續／雲端套用後回到晴朗。
 */

import { lerpColor, type DayNightColors } from '../core/daynight';

export type WeatherMode = 'clear' | 'rain' | 'thunder';

/** 天氣狀態：
 *  - `remaining`：距離下一次轉場的秒數（鎖定模式不扣）。
 *  - `nextFlash`：雷雨時距離下一次閃電的秒數（非雷雨為 0）。
 *  - `flashRemaining`：目前閃光剩餘秒數。
 *  - `locked`：由 `?weather=` 鎖定（驗收／展示用），不自動轉場但仍會打雷。 */
export interface WeatherState {
  mode: WeatherMode;
  remaining: number;
  nextFlash: number;
  flashRemaining: number;
  locked: boolean;
}

export interface WeatherTick {
  state: WeatherState;
  changed: boolean;
  lightning: boolean;
  /** 0..1 的閃光強度（0 = 沒有閃光）。 */
  flash: number;
}

/** 晴朗持續時間（秒）。 */
export const WEATHER_CLEAR_MIN_SEC = 90;
export const WEATHER_CLEAR_MAX_SEC = 210;
/** 下雨持續時間（秒）。 */
export const WEATHER_RAIN_MIN_SEC = 45;
export const WEATHER_RAIN_MAX_SEC = 120;
/** 雷雨持續時間（秒）。 */
export const WEATHER_THUNDER_MIN_SEC = 20;
export const WEATHER_THUNDER_MAX_SEC = 60;
/** 下雨轉雷雨的機率（其餘轉晴）。 */
export const WEATHER_THUNDER_CHANCE = 0.35;
/** 進入雷雨後第一次閃電的延遲（秒）——比後續短，讓雷雨一來就有感。 */
export const WEATHER_THUNDER_FIRST_FLASH_MIN_SEC = 1;
export const WEATHER_THUNDER_FIRST_FLASH_MAX_SEC = 4;
/** 雷雨期間兩次閃電的間隔（秒）。 */
export const WEATHER_FLASH_MIN_SEC = 4;
export const WEATHER_FLASH_MAX_SEC = 12;
/** 一次閃光的長度（秒）。 */
export const WEATHER_FLASH_SEC = 0.18;

const CLEAR_STRENGTH = 0;
const RAIN_STRENGTH = 0.55;
const THUNDER_STRENGTH = 0.72;
const RAIN_SKY = 0x5f6b7a;
const RAIN_ZENITH = 0x3c4653;
const RAIN_AMBIENT_SCALE = 0.85;
const THUNDER_AMBIENT_SCALE = 0.72;
const RAIN_SUN_SCALE = 0.55;
const THUNDER_SUN_SCALE = 0.35;
const FLASH_WHITE = 0xffffff;
const FLASH_COLOR_MIX = 0.8;
const FLASH_LIGHT_BOOST = 0.8;
const MAX_LIGHT = 1.2;
const MAX_SCALE = 1.2;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 把 rng 輸出夾到 [0,1]；非有限值視為 0（壞 rng 不會製造 NaN 狀態）。 */
function nextRoll(rng: () => number): number {
  const value = rng();
  if (!Number.isFinite(value)) return 0;
  return clamp01(value);
}

/** 依模式線性擲出持續時間。 */
function rollDuration(mode: WeatherMode, rng: () => number): number {
  const r = nextRoll(rng);
  if (mode === 'clear') {
    return WEATHER_CLEAR_MIN_SEC + r * (WEATHER_CLEAR_MAX_SEC - WEATHER_CLEAR_MIN_SEC);
  }
  if (mode === 'rain') {
    return WEATHER_RAIN_MIN_SEC + r * (WEATHER_RAIN_MAX_SEC - WEATHER_RAIN_MIN_SEC);
  }
  return WEATHER_THUNDER_MIN_SEC + r * (WEATHER_THUNDER_MAX_SEC - WEATHER_THUNDER_MIN_SEC);
}

function rollFirstFlashDelay(rng: () => number): number {
  return (
    WEATHER_THUNDER_FIRST_FLASH_MIN_SEC +
    nextRoll(rng) * (WEATHER_THUNDER_FIRST_FLASH_MAX_SEC - WEATHER_THUNDER_FIRST_FLASH_MIN_SEC)
  );
}

function rollFlashDelay(rng: () => number): number {
  return WEATHER_FLASH_MIN_SEC + nextRoll(rng) * (WEATHER_FLASH_MAX_SEC - WEATHER_FLASH_MIN_SEC);
}

function nextMode(mode: WeatherMode, rng: () => number): WeatherMode {
  if (mode === 'clear') return 'rain';
  if (mode === 'rain') return nextRoll(rng) < WEATHER_THUNDER_CHANCE ? 'thunder' : 'clear';
  return 'rain'; // thunder → rain（雷雨後接一段雨，再轉晴）
}

const MODES: readonly WeatherMode[] = ['clear', 'rain', 'thunder'];

function isWeatherMode(value: unknown): value is WeatherMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}

/** 建立新的天氣狀態（預設晴朗）。`initialMode` 不是合法三態時回晴朗。 */
export function createWeather(
  rng: () => number = Math.random,
  initialMode: WeatherMode = 'clear',
  locked = false,
): WeatherState {
  const mode = isWeatherMode(initialMode) ? initialMode : 'clear';
  return {
    mode,
    remaining: rollDuration(mode, rng),
    nextFlash: mode === 'thunder' ? rollFirstFlashDelay(rng) : 0,
    flashRemaining: 0,
    locked: locked === true,
  };
}

/** 推進一幀。`dt` 非有限或 ≤0 → 回傳複本（不轉場、不閃電）。
 *
 *  一次呼叫最多轉場一次（`main.ts` 的 dt 已夾在 0.1 秒，正常不會累積）。
 *  鎖定模式只更新閃電，不扣 `remaining`、不轉場。 */
export function stepWeather(
  state: WeatherState,
  dtSec: number,
  rng: () => number = Math.random,
): WeatherTick {
  const flashBefore = clamp01(state.flashRemaining / WEATHER_FLASH_SEC);
  if (!Number.isFinite(dtSec) || dtSec <= 0) {
    return { state: { ...state }, changed: false, lightning: false, flash: flashBefore };
  }

  let mode = state.mode;
  let remaining = state.remaining;
  let nextFlash = Number.isFinite(state.nextFlash) ? state.nextFlash : 0;
  let flashRemaining = Math.max(0, state.flashRemaining - dtSec);
  let changed = false;
  let lightning = false;

  if (!state.locked) {
    remaining -= dtSec;
    if (remaining <= 0) {
      mode = nextMode(state.mode, rng);
      remaining = rollDuration(mode, rng);
      changed = true;
      flashRemaining = 0;
      nextFlash = mode === 'thunder' ? rollFirstFlashDelay(rng) : 0;
    }
  }

  // 轉場那一幀不結算新模式的閃電（延遲從下一幀開始跑）；其餘雷雨幀正常倒數。
  if (mode === 'thunder' && !changed) {
    nextFlash -= dtSec;
    if (nextFlash <= 0) {
      lightning = true;
      flashRemaining = WEATHER_FLASH_SEC;
      nextFlash = rollFlashDelay(rng);
    }
  } else if (mode !== 'thunder') {
    nextFlash = 0;
    flashRemaining = 0;
  }

  return {
    state: { mode, remaining, nextFlash, flashRemaining, locked: state.locked },
    changed,
    lightning,
    flash: clamp01(flashRemaining / WEATHER_FLASH_SEC),
  };
}

export function weatherLabel(mode: WeatherMode): string {
  if (mode === 'rain') return '下雨';
  if (mode === 'thunder') return '雷雨';
  return '晴朗';
}

export function weatherChangeText(mode: WeatherMode): string {
  if (mode === 'rain') return '開始下雨了';
  if (mode === 'thunder') return '雷雨來了';
  return '放晴了';
}

/** 地形天空比例的乘數：雨天／雷雨讓地表變暗，閃光時短暫提亮。 */
export function weatherLightScale(mode: WeatherMode, flash = 0): number {
  const f = Number.isFinite(flash) ? clamp01(flash) : 0;
  const base = mode === 'rain' ? 0.82 : mode === 'thunder' ? 0.68 : 1;
  return Math.min(MAX_SCALE, base + f * 0.5);
}

/** 把日夜天色套上天氣陰影；`flash` 0..1 讓雷電閃光提亮。晴天原值不變。 */
export function applyWeatherTint(
  colors: DayNightColors,
  mode: WeatherMode,
  flash = 0,
): DayNightColors {
  const f = Number.isFinite(flash) ? clamp01(flash) : 0;
  const strength =
    mode === 'rain' ? RAIN_STRENGTH : mode === 'thunder' ? THUNDER_STRENGTH : CLEAR_STRENGTH;

  const baseSky = lerpColor(colors.sky, RAIN_SKY, strength);
  const baseZenith = lerpColor(colors.zenith, RAIN_ZENITH, strength);
  const sky = lerpColor(baseSky, FLASH_WHITE, f * FLASH_COLOR_MIX);
  const zenith = lerpColor(baseZenith, FLASH_WHITE, f * FLASH_COLOR_MIX);
  const ambientScale = mode === 'thunder' ? THUNDER_AMBIENT_SCALE : RAIN_AMBIENT_SCALE;
  const sunScale = mode === 'thunder' ? THUNDER_SUN_SCALE : RAIN_SUN_SCALE;
  const ambient =
    mode === 'clear'
      ? colors.ambient + f * FLASH_LIGHT_BOOST
      : colors.ambient * ambientScale + f * FLASH_LIGHT_BOOST;
  const sunIntensity =
    mode === 'clear'
      ? colors.sunIntensity + f * FLASH_LIGHT_BOOST
      : colors.sunIntensity * sunScale + f * FLASH_LIGHT_BOOST;

  return {
    sky,
    zenith,
    fog: sky,
    ambient: Math.min(MAX_LIGHT, ambient),
    sunIntensity: Math.min(MAX_LIGHT, sunIntensity),
  };
}

/** 驗收／展示用的 `?weather=clear|rain|thunder`（只接受小寫三態）。 */
export function parseWeatherOverride(search: string): WeatherMode | null {
  if (!search) return null;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const value = params.get('weather');
  return isWeatherMode(value) ? value : null;
}

// ── 曝露判準（Task 8 修正）──────────────────────────────────────────────────
// 門檻必須是「天空光 15＝頭頂整柱無不透明方塊」，**不是 ≥ 8**：本引擎的單格厚
// 屋簷下天空光是 14（水平 −1，B6 Task 2 的光照測試釘死）——用 ≥8 會讓屋內照常
// 下雨，違反「室內／洞穴／水下整片隱藏」的承諾（README／spec／release notes）。
// 15 恰好等於原版的 canSeeSky 語意：只有完全開闊的直柱會淋到雨（1×1 直井也會，
// 與原版一致）；樹葉／玻璃是透明方塊 → 光穿過 → 下方仍看得到雨絲（本作既有的
// 光照簡化：透明方塊不過濾天空光）。

/** 判定「曝露在天空下」的最低天空光：全亮 15（開闊直柱）。 */
export const SKY_EXPOSED_MIN_LIGHT = 15;

/** 相機是否會淋到雨（雨絲顯示判準）：已點光＋頭頂整柱開闊＋不在水裡。 */
export function isSkyExposed(
  light: { lit: boolean; sky: number },
  inWater: boolean,
): boolean {
  return light.lit && light.sky >= SKY_EXPOSED_MIN_LIGHT && !inWater;
}
