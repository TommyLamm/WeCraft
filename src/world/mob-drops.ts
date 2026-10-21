import type { ItemId } from '../core/items';
import type { MobKind } from './mobs';

/**
 * 擊殺掉落表（B4 Task 4）。
 *
 * **為什麼獨立成一個檔案**：方塊掉落（`drops.ts` 的 `dropItemFor`／`chanceDropFor`）
 * 與生物掉落是**兩條鏈**——方塊掉落受「持有工具的收穫門檻」管（`interact.ts` 的
 * `canHarvest`），生物掉落不該被那套語意污染 → 分開放，各自的規則各自純函式化。
 *
 * 數值出處：Java 版 1.20+ 的原版掉落表（2026-10-20 查證）。
 */

/** 一筆掉落：物品 id ＋ 數量。 */
export interface MobDrop {
  item: ItemId;
  count: number;
}

/**
 * 掉落表的生物種類。
 *
 * - `MobKind`（`zombie`／`skeleton`）是**敵對**生物（`mobs.ts`）；
 * - 四個被動生物的字面量（`chicken`／`pig`／`sheep`／`cow`）是**本檔自有的
 *   字面聯集**——被動生物的模型／AI 在後續任務才落地（Task 6 的 `PassiveKind`），
 *   兩者**結構相容**（後者是前者的子聯集）→ `rollMobDrops(m.kind)` 可直接傳入，
 *   不需要轉型。
 */
export type MobDropKind = MobKind | 'chicken' | 'pig' | 'sheep' | 'cow';

/**
 * 依生物種類擲出它的掉落清單（純函式，rng 可注入 → 測試可重現）。
 *
 * 原版掉落表（Java 1.20+）：
 * - 殭屍：腐肉 0–2
 * - 骷髏：骨頭 0–2、箭 0–2
 * - 雞：生雞肉 1、羽毛 0–2
 * - 豬：生豬肉 1–3
 * - 羊：生羊肉 1–2、羊毛 1
 * - 牛：生牛肉 1–3、皮革 0–2
 *
 * **數量為 0 的項目不輸出**（原版「可能掉 0 顆」＝ 那一格是空的，不是掉 0 顆的
 *  物品堆）。
 *
 * **刻意簡化（要寫進 README 的差異清單）**：原版雞／豬／羊／牛**燃燒死亡**時會掉
 * **熟**肉（`cooked_chicken`／`cooked_porkchop`／`cooked_mutton`／`steak`），本
 * 作**沒有生物著火系統**（白天燃燒只給不死系）→ 一律掉**生**肉。
 */
export function rollMobDrops(
  kind: MobDropKind,
  rng: () => number = Math.random,
): MobDrop[] {
  /** 閉區間 [min, max] 的整數擲骰（rng 注入 → 測試可重現）。 */
  const range = (min: number, max: number): number =>
    min + Math.floor(rng() * (max - min + 1));
  const out: MobDrop[] = [];
  const push = (item: ItemId, count: number): void => {
    if (count > 0) out.push({ item, count });
  };

  switch (kind) {
    case 'zombie':
      push('rotten_flesh', range(0, 2));
      break;
    case 'skeleton':
      push('bone', range(0, 2));
      push('arrow', range(0, 2));
      break;
    case 'chicken':
      push('raw_chicken', 1);
      push('feather', range(0, 2));
      break;
    case 'pig':
      push('raw_porkchop', range(1, 3));
      break;
    case 'sheep':
      push('raw_mutton', range(1, 2));
      push('wool', 1);
      break;
    case 'cow':
      push('raw_beef', range(1, 3));
      push('leather', range(0, 2));
      break;
  }
  return out;
}
