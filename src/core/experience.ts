// 經驗模型（B17）：等級曲線沿用原版 Java 的分段線性公式
// （minecraft.wiki `Experience` § Leveling-up）：
//   level < 16 → 2*level + 7；level < 31 → 5*level - 38；其餘 → 9*level - 158。
// `xp` 指「這一級已累積的點數」（0..xpToNext(level)-1）；滿等（MAX_LEVEL）後
// 不再累積。所有函式都是純資料運算，不吃 DOM／Three。

/** 玩家的等級與當前等級內已累積的經驗點。 */
export interface Experience {
  level: number;
  xp: number;
}

/** 等級上限。 */
export const MAX_LEVEL = 100;

/** 建立全新的空白經驗狀態。 */
export function createExperience(): Experience {
  return { level: 0, xp: 0 };
}

/**
 * 升到 `level + 1` 所需的點數。非有限值或越界輸入先夾進 0..MAX_LEVEL
 * （非有限 → 0），小數無條件捨去——不回傳 NaN、不拋例外。
 */
export function xpToNext(level: number): number {
  const lv = Number.isFinite(level) ? Math.floor(level) : 0;
  const clamped = Math.min(MAX_LEVEL, Math.max(0, lv));
  if (clamped < 16) return 2 * clamped + 7;
  if (clamped < 31) return 5 * clamped - 38;
  return 9 * clamped - 158;
}

/**
 * 加入經驗點，逐級進位（升級後餘點帶入下一級）。`amount` 非有限或 ≤ 0 →
 * 刻意的不動作，回傳**同一參考**；已滿等同樣早退。有任何改變 → 全新物件
 * （呼叫端無法透過結果改到模型內的狀態）。到 MAX_LEVEL 後剩餘點數丟棄。
 */
export function addExperience(exp: Experience, amount: number): Experience {
  if (!Number.isFinite(amount) || amount <= 0) return exp;
  if (exp.level >= MAX_LEVEL) return exp;
  let level = exp.level;
  let xp = exp.xp;
  let rest = amount;
  while (level < MAX_LEVEL && rest > 0) {
    const need = xpToNext(level);
    if (xp + rest >= need) {
      rest -= need - xp;
      level += 1;
      xp = 0;
    } else {
      xp += rest;
      rest = 0;
    }
  }
  return { level, xp };
}

/**
 * 花費 `n` 級（附魔消費）。`n` 不是正整數、或等級不足 → 回傳**同一參考**；
 * 成功 → `{ level: level - n, xp: 0 }`——花費等級會清空當前進度條
 * （明示簡化，原版保留 xp）。
 */
export function spendLevels(exp: Experience, n: number): Experience {
  if (!Number.isInteger(n) || n <= 0 || exp.level < n) return exp;
  return { level: exp.level - n, xp: 0 };
}

/**
 * 當前進度條比例（0..1）。滿等 → 0（滿等沒有下一級）；`xp` 非有限或 ≤ 0 →
 * 0；逾 need 夾到 1——任何垃圾輸入都不會跑出 NaN 或超出 0..1。
 */
export function experienceProgress(exp: Experience): number {
  if (exp.level >= MAX_LEVEL) return 0;
  const need = xpToNext(exp.level);
  const xp = exp.xp;
  if (!Number.isFinite(need) || need <= 0 || !Number.isFinite(xp) || xp <= 0) return 0;
  return Math.min(1, xp / need);
}

/**
 * 清洗不可信輸入（存檔載入）。不是物件、或 `level` 不是有限數 → 整筆視為
 * 壞資料，回傳 `{ level: 0, xp: 0 }`；`level` 無條件捨去後夾 0..MAX_LEVEL；
 * `xp` 不是有限數 → 0，否則捨去後夾到 0..xpToNext(level)-1
 * （MAX_LEVEL 時沒有下一級 → xp 強制 0）。
 */
export function normalizeExperience(raw: unknown): Experience {
  if (typeof raw !== 'object' || raw === null) return { level: 0, xp: 0 };
  const rec = raw as Record<string, unknown>;
  const level = rec.level;
  if (typeof level !== 'number' || !Number.isFinite(level)) return { level: 0, xp: 0 };
  const lv = Math.min(MAX_LEVEL, Math.max(0, Math.floor(level)));
  const rawXp = rec.xp;
  const x = typeof rawXp === 'number' && Number.isFinite(rawXp) ? Math.floor(rawXp) : 0;
  const xp = lv >= MAX_LEVEL ? 0 : Math.min(xpToNext(lv) - 1, Math.max(0, x));
  return { level: lv, xp };
}

/**
 * 解析 `?xp=<非負整數>` 覆寫（除錯／測試用）。`query` 可含或不含開頭 `?`；
 * 值必須完全符合 `/^\d+$/`（≥ 0 的整數）才回傳整數，缺參數或任何其他
 * 寫法（負數、小數、非數字）→ null。
 */
export function parseXpOverride(query: string): number | null {
  const raw = new URLSearchParams(query).get('xp');
  if (raw === null || !/^\d+$/.test(raw)) return null;
  return Number.parseInt(raw, 10);
}
