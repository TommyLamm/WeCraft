/** 「地形已改變」提示的**時機決策**（Task 20）：`arm` 與 `flush` 兩顆純函式。
 *
 *  背景：審查 Minor 14——提示時機原本只靠 `main.wiring.test.ts` 的字串掃描
 *  （「哪個函式裡有沒有出現 `pushWorldgenNotice(`」）。掃描搬家、字串換皮都照樣
 *  綠，而真正的規則（開機套用只**排隊**、玩家**進場**才跳、同一個 session 只跳
 *  一次）沒有被行為測試釘住。這裡把規則抽成純函式：main.ts 只留狀態旗標與
 *  呼叫點（接線只剩一行錨點），規則本身在此以行為測試釘死。
 *
 *  規則（與 B3 Task 8 的原始行為逐條等價）：
 *  - **arm**：存檔需要提示（版本缺漏／不等於當前版本）**且**這個 session 還沒
 *    跳過 → 值得排隊。已跳過的 session 不再排隊（同一筆進度被套用多次仍只跳
 *    一次）。
 *  - **flush**：有排隊過 **且** 這個 session 還沒跳過 → 這一刻跳。flush 一律
 *    消費掉排隊旗標（無論跳不跳），與舊碼的清除時機相同。
 *  - 「合法版本值」的正規化（非數值 → 視為缺漏）由 `worldgen.ts` 的
 *    `readWorldgenVersion` 負責（讀取端先過它）——這裡補一條端到端情境。
 */
import { describe, it, expect } from 'vitest';
import { WORLDGEN_VERSION, readWorldgenVersion } from './worldgen';
import { shouldArmNotice, shouldFlushNotice } from './worldgen-notice';

describe('shouldArmNotice', () => {
  it('a save without the version field arms the notice', () => {
    expect(shouldArmNotice(undefined, false)).toBe(true);
    expect(shouldArmNotice(null, false)).toBe(true);
  });

  it('the current version arms nothing', () => {
    expect(shouldArmNotice(WORLDGEN_VERSION, false)).toBe(false);
  });

  it('an older (or newer) version arms the notice', () => {
    // 比現在新也要提示：地形對這個版本來說已經改變過（與 needsWorldgenNotice 一致）。
    expect(shouldArmNotice(WORLDGEN_VERSION - 1, false)).toBe(true);
    expect(shouldArmNotice(WORLDGEN_VERSION + 1, false)).toBe(true);
  });

  it('a non-number version reads as missing and arms the notice', () => {
    // 讀取端共用 `readWorldgenVersion`：字串／NaN／Infinity 一律正規化成
    // undefined（＝舊存檔）→ 提示決策只會看到 number | undefined | null。
    expect(shouldArmNotice(readWorldgenVersion('x'), false)).toBe(true);
    expect(shouldArmNotice(readWorldgenVersion(NaN), false)).toBe(true);
    expect(shouldArmNotice(readWorldgenVersion(Infinity), false)).toBe(true);
  });

  it('a session that already showed the notice never arms again', () => {
    // 「同一個 session 只跳一次」：即使存檔是舊的，已跳過的 session 不再排隊。
    expect(shouldArmNotice(undefined, true)).toBe(false);
    expect(shouldArmNotice(WORLDGEN_VERSION - 1, true)).toBe(false);
  });
});

describe('shouldFlushNotice', () => {
  it('flushes only an armed, not-yet-shown notice', () => {
    expect(shouldFlushNotice(true, false)).toBe(true);
  });

  it('nothing armed → nothing to flush', () => {
    expect(shouldFlushNotice(false, false)).toBe(false);
  });

  it('an already-shown session does not show again', () => {
    expect(shouldFlushNotice(true, true)).toBe(false);
    expect(shouldFlushNotice(false, true)).toBe(false);
  });
});
