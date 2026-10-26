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
import type { CloudSaveOutcome } from './playroom';

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

  setRevision(revision: number | null): void {
    this.revisionValue = revision;
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
      } else if (outcome.status === 'unconfirmed') {
        // The platform did not confirm the write. Keep the snapshot AND the
        // revision: the next retry must reuse the same requestId, and the
        // revision must not advance on an unconfirmed save.
        this.retryableValue = true;
        this.failureKindValue = 'NETWORK';
      } else {
        // Unavailable (preview / guest): nothing was written, nothing to keep.
        this.pendingValue = null;
        this.retryableValue = false;
        this.failureKindValue = null;
      }
    } catch (err) {
      const kind = classifyCloudError(err);
      this.failureKindValue = kind;
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
