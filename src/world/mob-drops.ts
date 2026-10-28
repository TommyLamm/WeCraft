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
 *
 * B9 Task 1：蜘蛛眼**只有玩家（或原版的寵物狼）擊殺才掉**——本作沒有寵物狼 →
 * 只有玩家擊殺。條件以 `opts.killedByPlayer` 表達（預設 `true` → 既有呼叫端
 * 的行為完全不變）；被爆炸炸死等非玩家死因的呼叫端要顯式傳 `false`。
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
export type MobDropKind = MobKind | 'chicken' | 'pig' | 'sheep' | 'cow'
  // B9 Task 1：苦力怕（火藥）與蜘蛛（線＋蜘蛛眼）。兩者的實體在 creeper.ts／
  // spider.ts（不是 mobs.ts 的 `Mob`）→ 這裡用字面量擴充，不動既有分支。
  | 'creeper' | 'spider';

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
 * - 苦力怕（B9）：火藥 0–2
 * - 蜘蛛（B9）：線 0–2、蜘蛛眼 0–1（**僅玩家擊殺**）
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
  opts: { killedByPlayer?: boolean } = {},
): MobDrop[] {
  // B9 Task 1：預設 `true` → 既有呼叫端（`rollMobDrops(kind)`／`(kind, rng)`）
  // 的行為完全不變；只有「非玩家死因」的呼叫端要顯式傳 `false`（爆炸等）。
  const byPlayer = opts.killedByPlayer !== false;
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
    // B9 Task 1：抽樣順序**固定**——先線的數量、再蜘蛛眼的機率（1/3）。
    case 'creeper':
      push('gunpowder', range(0, 2));
      break;
    case 'spider':
      push('string', range(0, 2));
      if (byPlayer && rng() < 1 / 3) push('spider_eye', 1);
      break;
  }
  return out;
}

/** 一筆「生物死亡 → 掉落」的結果：物品、數量、與掉落物的落點。 */
export interface MobDeathDrop {
  item: ItemId;
  count: number;
  /** 掉落物的位置（生物腳底 ＋ 0.9 格 → 落在身體高度，不卡在地板裡）。 */
  pos: { x: number; y: number; z: number };
}

/** 一隻死掉的生物——`dropsForDeaths` 只需要「種類」與「位置」。 */
export interface DeadMob {
  kind: MobDropKind;
  pos: { x: number; y: number; z: number };
}

/**
 * **生物死亡 → 掉落**（B4 Task 4 審查 I-2）：把死掉的生物換成它們的掉落物清單。
 *
 * **為什麼要抽成一個函式**：掉落是**死因無關**的——近戰、箭、白天燃燒…每一種死因
 * 都該掉同一份掉落表。先前掉落只接在「近戰擊殺」那一支 → 其他死因的生物（例如
 * 被箭打死）會**什麼都不掉**，掉落表裡的項目也就不可達。這個函式**不收死因** →
 * 呼叫端只管「誰死了」，掉落表在哪裡只有一份。
 *
 * 純函式：rng 可注入（測試可重現）；輸入的生物不會被修改。
 */
export function dropsForDeaths(
  dead: readonly DeadMob[],
  rng: () => number = Math.random,
): MobDeathDrop[] {
  const out: MobDeathDrop[] = [];
  for (const m of dead) {
    for (const drop of rollMobDrops(m.kind, rng)) {
      out.push({
        item: drop.item,
        count: drop.count,
        pos: { x: m.pos.x, y: m.pos.y + 0.9, z: m.pos.z },
      });
    }
  }
  return out;
}
