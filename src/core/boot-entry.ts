// Boot entry decision (pure — no DOM/Three/storage/network).
// Ruling I/J (final-review Critical fix): the boot sequence may apply a cloud
// payload onto the live state BEFORE the title mounts. Whether the title's
// 繼續遊戲 button appears — and which session it enters — is exactly this
// decision, extracted here so it is unit-pinned instead of living only in
// main.ts's untested composition root.
//
// Ruling J: when BOTH a local save and an applied cloud payload exist, the
// CLOUD state wins the entry (the boot apply is mandated, the conflict policy
// converts to cloud on divergence, and no comparable timestamps exist). The
// local IDB save is superseded at the next local save — no merge, this phase.

export interface TitleEntryInput {
  /** `savedPayload !== null` — a local IDB save existed at boot (or was
   *  cached by an in-session save). */
  hasLocalSave: boolean;
  /** `cloudAppliedAtBoot` — the boot read succeeded AND its payload was
   *  validated and applied to the live state. */
  cloudApplied: boolean;
}

/** Which session 繼續遊戲 enters: the boot-applied cloud progress, the local
 *  save, or no entry at all (button hidden). Cloud wins when both are present. */
export function titleEntry({ hasLocalSave, cloudApplied }: TitleEntryInput): 'cloud' | 'local' | 'none' {
  if (cloudApplied) return 'cloud';
  if (hasLocalSave) return 'local';
  return 'none';
}

/** A1 的標題三態（`'pending'`／`'yes'`／`'no'`），**由輸入推導、不得快取**。
 *
 *  修復波 review CR-1：`hasLocalSave` 會在**場中存檔**之後改變（autosave／
 *  儲存並離開）——把它推導出的三態快取在一個只在開機 settle 時寫入的變數，
 *  會讓回到標題時顯示過期的 `'no'`：「繼續遊戲」消失、新遊戲也不再問 B1.4 的
 *  覆蓋確認（下一次 autosave 直接蓋掉剛存的進度）。呼叫端（main.ts 的標題
 *  render 與 handleNewGame）每次都要重算。
 *
 *  `pending` 只在開機檢查（本機＋雲端）settle 前成立——那時答案還可能被雲端
 *  改寫；settle 後 `'yes'`／`'no'` 永遠可由現況決定。 */
export function titleTriState(
  input: TitleEntryInput & { pending: boolean },
): 'pending' | 'yes' | 'no' {
  if (input.pending) return 'pending';
  return titleEntry(input) === 'none' ? 'no' : 'yes';
}
