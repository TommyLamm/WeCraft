/** 釣魚純邏輯（B14）：拋線後的等待、魚訊窗口、錯過逃脫、收線與戰利品表。
 *  不碰 DOM／Three／計時器——`main.ts` 只負責每幀餵 `dt`、把 `bite`／`escaped`
 *  轉成音效與提示，並在成功收線時發獎、扣耐久。
 *
 *  規則出處與明示簡化（README〈與原版的差異〉）：本作沒有原版「開放水域
 *  5×4×5」判定、沒有幸運加成、沒有餌釣與海洋祝福附魔；等待 5–30 秒與
 *  魚訊窗口 2 秒是自訂簡化值（原版等待時間與戰利品表由遊戲難度／附魔調整）。
 *  **B15 起**雨天等待縮到 80%（`[4, 24]` 秒）——本作自訂的天氣效果，不是原版
 *  的雨天魚種機率（那一項仍然沒有實作）。
 *  垃圾與寶物也只使用本作既有物品池的簡化表。 */

import type { ItemId } from '../core/items';

/** 拋線後的最短等待秒數。 */
export const FISHING_WAIT_MIN_SEC = 5;
/** 拋線後的最長等待秒數。 */
export const FISHING_WAIT_MAX_SEC = 30;
/** 魚訊窗口秒數：這段時間內右鍵才能收線成功。 */
export const FISHING_BITE_WINDOW_SEC = 2;
/** 拋線射程（格）。 */
export const FISHING_CAST_RANGE = 16;
/** B15 雨天等待倍率：雨天的魚訊來得快 20%（等待 × 0.8）。 */
export const FISHING_RAIN_WAIT_MULTIPLIER = 0.8;
/** B15 雨天等待下限（秒）：晴天最短 5 秒 × 0.8 = 4 秒。 */
export const FISHING_RAIN_WAIT_MIN_SEC = 4;
/** B15 雨天等待上限（秒）：晴天最長 30 秒 × 0.8 = 24 秒。
 *  端點寫死（而不是執行期才乘 0.8）→ 5×0.8=4、30×0.8=24 在 IEEE-754 下**剛好**
 *  可表示，中點 14 秒也不會出現 14.000000000000002 這種雜訊。 */
export const FISHING_RAIN_WAIT_MAX_SEC = 24;

export type FishingPhase = 'waiting' | 'biting' | 'escaped';
export type FishingLootCategory = 'fish' | 'junk' | 'treasure';

export interface FishingState {
  phase: FishingPhase;
  waitRemaining: number;
  biteRemaining: number;
}

export interface FishingTick {
  state: FishingState;
  /** 這一幀剛好進入魚訊（只會 true 一次）。 */
  bite: boolean;
  /** 這一幀剛好錯過魚訊（只會 true 一次）。 */
  escaped: boolean;
}

export interface FishingCatch {
  item: ItemId;
  count: number;
  category: FishingLootCategory;
}

interface LootEntry {
  item: ItemId;
  count: number;
  weight: number;
}

/** 魚 85%：四種魚的權重總和 100（cod 60／salmon 25／pufferfish 13／熱帶魚 2）。 */
const FISH_LOOT: readonly LootEntry[] = [
  { item: 'raw_cod', count: 1, weight: 60 },
  { item: 'raw_salmon', count: 1, weight: 25 },
  { item: 'pufferfish', count: 1, weight: 13 },
  { item: 'tropical_fish', count: 1, weight: 2 },
];

/** 垃圾 10%：使用既有物品池（原版包含碗、命名牌等，本作從簡）。 */
const JUNK_LOOT: readonly LootEntry[] = [
  { item: 'stick', count: 2, weight: 20 },
  { item: 'string', count: 1, weight: 20 },
  { item: 'rotten_flesh', count: 1, weight: 15 },
  { item: 'bone', count: 1, weight: 15 },
  { item: 'leather', count: 1, weight: 15 },
  { item: 'oak_planks', count: 4, weight: 15 },
];

/** 寶物 5%：同樣只從既有物品池挑（原版有鸚鵡螺殼、附魔書等）。 */
const TREASURE_LOOT: readonly LootEntry[] = [
  { item: 'iron_ingot', count: 1, weight: 50 },
  { item: 'gold_ingot', count: 1, weight: 25 },
  { item: 'diamond', count: 1, weight: 5 },
  { item: 'bow', count: 1, weight: 10 },
  { item: 'leather_boots', count: 1, weight: 10 },
];

/** 倒數的浮點容差：2.0 - 1.9 - 0.1 會留下 8e-17，若不吸收，魚訊窗口
 *  最後一幀永遠差一點點才逃脫。 */
const REMAINING_EPSILON = 1e-9;

/** 把 rng 的輸出夾到 [0, 1]；非有限值視為 0（壞 rng 不會做出 NaN 狀態）。
 *  `1` 保留給加權選取的最後一項 fallback，不會讓 `target < cumulative` 溢位。 */
function nextRoll(rng: () => number): number {
  const value = rng();
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 依權重挑一項；`roll` 已夾在 [0, 1]。全部沒中（roll = 1）回最後一項。 */
function pickWeighted(table: readonly LootEntry[], roll: number): LootEntry {
  const target = roll * 100;
  let cumulative = 0;
  for (const entry of table) {
    cumulative += entry.weight;
    if (target < cumulative) return entry;
  }
  return table[table.length - 1];
}

/** 拋線等待秒數：晴天 `[5, 30]`，壞 rng 當最小值。
 *
 *  B15 天氣效果：`raining` 為真時把等待整體縮到 80%（`[4, 24]`）——雨天魚訊來得
 *  比較快。呼叫端（`main.ts`）在拋線當下把當前天氣傳進來；省略＝晴天，行為與
 *  0.17.0 完全相同。 */
export function rollFishingWait(rng: () => number = Math.random, raining = false): number {
  const roll = nextRoll(rng);
  if (!raining) {
    return FISHING_WAIT_MIN_SEC + roll * (FISHING_WAIT_MAX_SEC - FISHING_WAIT_MIN_SEC);
  }
  return FISHING_RAIN_WAIT_MIN_SEC + roll * (FISHING_RAIN_WAIT_MAX_SEC - FISHING_RAIN_WAIT_MIN_SEC);
}

/** 開始等待。非有限值當最小值，其餘夾到 `[0, 30]`（0 代表下一次 step 立刻魚訊）。 */
export function beginFishing(waitSec: number): FishingState {
  const wait = Number.isFinite(waitSec)
    ? Math.min(FISHING_WAIT_MAX_SEC, Math.max(0, waitSec))
    : FISHING_WAIT_MIN_SEC;
  return { phase: 'waiting', waitRemaining: wait, biteRemaining: 0 };
}

/** 推進一幀。進入魚訊的那一幀不會把多餘的 `dt` 帶進 2 秒窗口；錯過窗口後
 *  狀態停在 `escaped`（不會重複回報），由呼叫端清除釣魚線。 */
export function stepFishing(state: FishingState, dtSec: number): FishingTick {
  if (!Number.isFinite(dtSec) || dtSec <= 0 || state.phase === 'escaped') {
    return { state: { ...state }, bite: false, escaped: false };
  }

  if (state.phase === 'waiting') {
    const remaining = state.waitRemaining - dtSec;
    if (remaining <= REMAINING_EPSILON) {
      return {
        state: {
          phase: 'biting',
          waitRemaining: 0,
          biteRemaining: FISHING_BITE_WINDOW_SEC,
        },
        bite: true,
        escaped: false,
      };
    }
    return {
      state: { phase: 'waiting', waitRemaining: remaining, biteRemaining: 0 },
      bite: false,
      escaped: false,
    };
  }

  const remaining = state.biteRemaining - dtSec;
  if (remaining <= REMAINING_EPSILON) {
    return {
      state: { phase: 'escaped', waitRemaining: 0, biteRemaining: 0 },
      bite: false,
      escaped: true,
    };
  }
  return {
    state: { phase: 'biting', waitRemaining: 0, biteRemaining: remaining },
    bite: false,
    escaped: false,
  };
}

/** 收線：只有魚訊窗口內才有漁獲；其他階段（等待／已逃脫）回 null。 */
export function reelFishing(state: FishingState, rng: () => number = Math.random): FishingCatch | null {
  if (state.phase !== 'biting') return null;
  return rollFishingLoot(rng);
}

/** 戰利品：先擲類別（魚 85%／垃圾 10%／寶物 5%），再擲該表的加權項目。 */
export function rollFishingLoot(rng: () => number = Math.random): FishingCatch {
  const categoryRoll = nextRoll(rng);
  if (categoryRoll < 0.85) {
    const entry = pickWeighted(FISH_LOOT, nextRoll(rng));
    return { item: entry.item, count: entry.count, category: 'fish' };
  }
  if (categoryRoll < 0.95) {
    const entry = pickWeighted(JUNK_LOOT, nextRoll(rng));
    return { item: entry.item, count: entry.count, category: 'junk' };
  }
  const entry = pickWeighted(TREASURE_LOOT, nextRoll(rng));
  return { item: entry.item, count: entry.count, category: 'treasure' };
}
