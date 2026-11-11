import { BLOCK } from './blocks';
import type { FishingCatch } from './fishing';
import type { MobKind } from './mobs';
import type { PassiveKind } from './passive-mobs';

/**
 * 給經驗的生物種類。
 *
 * - `MobKind`（`zombie`／`skeleton`）與 `PassiveKind`（`chicken`／`pig`／
 *   `sheep`／`cow`）來自既有模組；
 * - 苦力怕與蜘蛛的實體在 `creeper.ts`／`spider.ts`（不是 `mobs.ts` 的 `Mob`）
 *   → 沿用 `mob-drops.ts` 的做法，用字面量擴充，不動既有型別。
 */
export type XpMobKind = MobKind | PassiveKind | 'creeper' | 'spider';

/**
 * 挖礦經驗（原版：煤 1／鐵 1＋冶煉、金 2、鑽 4；其餘方塊不發）。
 * 鍵用 `BLOCK.*` 的 id → 與 `blocks.ts` 的編號單一來源。
 */
const ORE_XP: Partial<Record<number, number>> = {
  [BLOCK.COAL_ORE]: 1,
  [BLOCK.IRON_ORE]: 1,
  [BLOCK.GOLD_ORE]: 2,
  [BLOCK.DIAMOND_ORE]: 4,
};

/**
 * 擊殺經驗（玩家造成的擊殺才發；原版：敵對 5、雞 1／豬 2／羊 2／牛 3）。
 * `Partial` + `?? 0` → 表外的 kind（非信任資料）回 0、不拋錯。
 */
const MOB_XP: Partial<Record<XpMobKind, number>> = {
  zombie: 5,
  skeleton: 5,
  creeper: 5,
  spider: 5,
  chicken: 1,
  pig: 2,
  sheep: 2,
  cow: 3,
};

/**
 * 釣魚經驗（原版：魚 2／垃圾 1／寶物 5）。
 * 型別取 `FishingCatch['category']` → 與 `fishing.ts` 的戰利品分類單一來源。
 */
const FISHING_XP: Partial<Record<FishingCatch['category'], number>> = {
  fish: 2,
  junk: 1,
  treasure: 5,
};

/** 挖破礦物的經驗點數；非礦物（未知 id）→ 0。 */
export function xpForOre(blockId: number): number {
  return ORE_XP[blockId] ?? 0;
}

/** 玩家擊殺生物的經驗點數；表外 kind → 0（不拋錯）。 */
export function xpForMob(kind: XpMobKind): number {
  return MOB_XP[kind] ?? 0;
}

/** 成功收線的釣魚經驗點數；表外 category → 0（不拋錯）。 */
export function xpForFishing(category: FishingCatch['category']): number {
  return FISHING_XP[category] ?? 0;
}

/** 冶煉取物：每取出 1 個產物發 1 點（原版「取走才發」）。 */
export function xpPerSmelt(): number {
  return 1;
}
