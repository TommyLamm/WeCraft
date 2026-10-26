// Cloud checkpoint state machine (pure — no DOM, no SDK import).
//
// Why this module exists: the platform contract says a save whose RESPONSE was
// lost must be retried with the SAME requestId (same payload ⇒ idempotent,
// the server does not bump the revision twice). The previous implementation
// minted a fresh requestId on every checkpoint and replaced the pending
// snapshot, so a response-lost checkpoint could never be retried correctly —
// and the next checkpoint then raced the stale revision into a 409 that was
// resolved by silently overwriting the player's live progress.
//
// This class owns the whole checkpoint lifecycle:
//   - ONE pending snapshot with a FROZEN requestId (never replaced while it
//     is unresolved);
//   - the revision only advances on a confirmed save;
//   - error classification decides whether the snapshot is kept (retryable),
//     locked (format / request-id reuse) or dropped (auth).
import { classifyCloudError, type CloudErrorKind } from '../core/cloud-save';
import type { CloudData } from '../core/cloud-save';
import type { CloudSaveOutcome, CloudStatus } from './playroom';

export type { CloudSaveOutcome };

/** The minimum a transport must provide to drive the checkpoint lifecycle. */
export interface CloudSaveTransport {
  save(
    data: unknown,
    revision: number,
    formatVersion: number,
    requestId: string,
  ): Promise<CloudSaveOutcome>;
}

/** A save that may or may not have reached the server. The requestId is
 *  FROZEN with the payload: the pair is the idempotency key. */
export interface CloudSnapshot {
  data: unknown;
  requestId: string;
}

/** Another device's progress, read back after a 409. The player picks what
 *  to do with it (keep local / take cloud / merge) — see Task 3. */
export interface CloudConflict {
  /** The remote payload, already validated by `acceptCloudData`. */
  data: CloudData;
  /** The revision the remote slot is at. */
  revision: number;
}

export interface CloudSessionOptions {
  transport: CloudSaveTransport;
  formatVersion: number;
  /** Injectable for deterministic tests; defaults to a fresh UUID. */
  newRequestId?: () => string;
}

export class CloudSession {
  private readonly transport: CloudSaveTransport;
  private readonly formatVersion: number;
  private readonly newRequestId: () => string;

  private revisionValue: number | null = null;
  private pendingValue: CloudSnapshot | null = null;
  private busyValue = false;
  private retryableValue = false;
  private failureKindValue: CloudErrorKind | null = null;
  /** FORMAT / REQUEST_REUSED — account writes are stopped for good. */
  private lockedValue = false;
  /** 401 / 403 — the session is gone; the game stays playable, writes stop. */
  private authStoppedValue = false;
  private conflictValue: CloudConflict | null = null;
  /** True when the last attempt was ANSWERED but not confirmed (`saved !== true`).
   *  Distinct from a thrown network failure: the platform replied, it just did
   *  not promise persistence — so the row says 尚未同步, not 同步失敗. */
  private unconfirmedValue = false;

  constructor(opts: CloudSessionOptions) {
    this.transport = opts.transport;
    this.formatVersion = opts.formatVersion;
    this.newRequestId = opts.newRequestId ?? (() => crypto.randomUUID());
  }

  /** The server revision this session writes against. `null` means the slot
   *  was never read — no send may overwrite an unread slot. */
  get revision(): number | null {
    return this.revisionValue;
  }

  /** The frozen snapshot awaiting confirmation, or null when there is none. */
  get pending(): CloudSnapshot | null {
    return this.pendingValue;
  }

  get busy(): boolean {
    return this.busyValue;
  }

  /** True when the player can retry (network failure / unresolved conflict). */
  get retryable(): boolean {
    return this.retryableValue;
  }

  get failureKind(): CloudErrorKind | null {
    return this.failureKindValue;
  }

  /** True when account writes are stopped for good (format / request-id reuse). */
  get locked(): boolean {
    return this.lockedValue;
  }

  /** True after an auth failure (401 / 403) — the game stays playable. */
  get authStopped(): boolean {
    return this.authStoppedValue;
  }

  /** Another device's progress, set after a 409 (filled in by the conflict
   *  resolution flow). */
  get conflict(): CloudConflict | null {
    return this.conflictValue;
  }

  setConflict(conflict: CloudConflict | null): void {
    this.conflictValue = conflict;
  }

  /** True when the platform answered the last save without confirming it. */
  get unconfirmed(): boolean {
    return this.unconfirmedValue;
  }

  setRevision(revision: number | null): void {
    this.revisionValue = revision;
  }

  /** Stop account writes for good: the slot's format cannot be written, or the
   *  request id was reused with different content. The snapshot is dropped —
   *  there is no safe retry. */
  lock(kind: 'FORMAT' | 'REQUEST_REUSED'): void {
    this.lockedValue = true;
    this.failureKindValue = kind;
    this.retryableValue = false;
    this.pendingValue = null;
  }

  /** Stop account writes (401 / 403). The game stays playable. */
  stopAuth(): void {
    this.authStoppedValue = true;
    this.failureKindValue = 'AUTH';
    this.retryableValue = false;
    this.pendingValue = null;
  }

  /** Forget the frozen snapshot without touching the revision or the flags.
   *  The auto-apply conflict path uses this once the remote payload HAS become
   *  the live state (the local snapshot is moot); Task 3 keeps it instead and
   *  asks the player. */
  dropPending(): void {
    this.pendingValue = null;
  }

  /** Record a read-side failure. The slot stays UNREAD, so the revision stays
   *  null and no send may overwrite it. */
  markReadFailure(kind: CloudErrorKind = 'NETWORK'): void {
    this.failureKindValue = kind;
    this.retryableValue = true;
    this.unconfirmedValue = false;
  }

  /** The read succeeded — the slot is readable again. */
  clearReadFailure(): void {
    this.failureKindValue = null;
    this.retryableValue = false;
    this.unconfirmedValue = false;
  }

  /** Queue a checkpoint. If a snapshot is still unresolved it is resent AS IS
   *  (same data, same requestId) — the live state is captured by the next
   *  checkpoint after this one lands. */
  async checkpoint(data: unknown): Promise<void> {
    if (this.lockedValue || this.authStoppedValue) return;
    if (this.revisionValue === null) return;
    if (this.busyValue) return;
    if (this.conflictValue) return;
    if (!this.pendingValue) {
      this.pendingValue = { data, requestId: this.newRequestId() };
    }
    await this.send(this.pendingValue);
  }

  /** Resend the pending snapshot with its frozen requestId. */
  async retry(): Promise<void> {
    if (this.lockedValue || this.authStoppedValue) return;
    if (this.revisionValue === null) return;
    if (this.busyValue) return;
    if (this.conflictValue) return;
    if (!this.pendingValue) return;
    await this.send(this.pendingValue);
  }

  private async send(snapshot: CloudSnapshot): Promise<void> {
    this.busyValue = true;
    try {
      const outcome = await this.transport.save(
        snapshot.data,
        this.revisionValue as number,
        this.formatVersion,
        snapshot.requestId,
      );
      if (outcome.status === 'saved') {
        this.revisionValue = outcome.revision;
        this.pendingValue = null;
        this.retryableValue = false;
        this.failureKindValue = null;
        this.unconfirmedValue = false;
      } else if (outcome.status === 'unconfirmed') {
        // The platform did not confirm the write. Keep the snapshot AND the
        // revision: the next retry must reuse the same requestId, and the
        // revision must not advance on an unconfirmed save.
        this.retryableValue = true;
        this.failureKindValue = 'NETWORK';
        this.unconfirmedValue = true;
      } else {
        // Unavailable (preview / guest): nothing was written, nothing to keep.
        this.pendingValue = null;
        this.retryableValue = false;
        this.failureKindValue = null;
        this.unconfirmedValue = false;
      }
    } catch (err) {
      const kind = classifyCloudError(err);
      this.failureKindValue = kind;
      this.unconfirmedValue = false;
      if (kind === 'FORMAT' || kind === 'REQUEST_REUSED') {
        this.lockedValue = true;
        this.retryableValue = false;
        this.pendingValue = null;
      } else if (kind === 'AUTH') {
        this.authStoppedValue = true;
        this.retryableValue = false;
        this.pendingValue = null;
      } else if (kind === 'CONFLICT') {
        // The slot moved under us. Keep the snapshot and the revision; the
        // conflict resolution decides what happens next (never an automatic
        // overwrite of the live session).
        this.retryableValue = true;
      } else {
        // NETWORK / UNAVAILABLE: the response may have been lost — the server
        // may already hold this exact snapshot. Keep it for a same-id retry.
        this.retryableValue = true;
      }
    } finally {
      this.busyValue = false;
    }
  }
}

/** Map the session state + the client status onto the pause-menu cloud row.
 *
 *  The one rule that matters (A2): a save that was sent but NOT confirmed must
 *  never read as 已同步. It reads 尚未同步 (syncing) and stays retryable, so the
 *  player can push the same snapshot again with the same requestId. */
export function cloudRowState(
  session: CloudSession,
  clientStatus: CloudStatus,
): { status: CloudStatus; retryable: boolean } {
  if (clientStatus === 'guest') return { status: 'guest', retryable: false };
  if (clientStatus === 'unknown' || clientStatus === 'unsupported') {
    return { status: 'unsupported', retryable: false };
  }
  if (session.locked || clientStatus === 'format') {
    return { status: 'format', retryable: false };
  }
  if (session.conflict || clientStatus === 'conflict' || session.failureKind === 'CONFLICT') {
    return { status: 'conflict', retryable: session.retryable };
  }
  if (session.unconfirmed) {
    return { status: 'syncing', retryable: session.retryable };
  }
  if (clientStatus === 'error' || session.failureKind !== null) {
    return { status: 'error', retryable: session.retryable };
  }
  return { status: 'ready', retryable: false };
}
