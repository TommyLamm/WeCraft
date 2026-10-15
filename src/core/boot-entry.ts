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
