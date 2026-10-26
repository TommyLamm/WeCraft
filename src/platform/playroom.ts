// Playroom cloud client adapter (visitor/standalone/jsdom-safe no-ops).
// All SDK access goes through an injectable loader; the default loader
// resolves public/playroom-sdk.js relative to document.baseURI and every
// failure degrades to null so init/load/save never throw for missing SDK.
import { classifyCloudError } from '../core/cloud-save';
import type { PlayroomModule, PlayroomReady } from './playroom-sdk-types';

export type CloudStatus =
  | 'unknown'
  | 'guest'
  | 'unsupported'
  | 'ready'
  /** A save was sent but the platform did not confirm it (`saved !== true`). */
  | 'syncing'
  | 'error'
  | 'conflict'
  | 'format';

export interface PlayroomDeps {
  loadModule?: () => Promise<PlayroomModule | null>;
}

/** The outcome of one save attempt.
 *  - `saved`: the platform confirmed the write (`saved === true`) — the ONLY
 *    outcome that proves persistence and may advance the revision.
 *  - `unconfirmed`: the platform answered without confirming persistence. The
 *    snapshot must be kept and retried with the same requestId; the revision
 *    must NOT advance.
 *  - `unavailable`: nothing was written (preview mode, guest, standalone). */
export type CloudSaveOutcome =
  | { status: 'saved'; revision: number }
  | { status: 'unconfirmed' }
  | { status: 'unavailable' };

export interface CloudClient {
  readonly status: CloudStatus;
  readonly readyInfo: PlayroomReady | null;
  init(): Promise<CloudStatus>;
  load(): Promise<{ data: unknown; revision: number; formatVersion: number } | null>;
  save(
    data: unknown,
    revision: number,
    formatVersion: number,
    requestId: string,
  ): Promise<CloudSaveOutcome>;
}

/** Upper bound around the SDK's internal 8 s readiness timeout. */
const READY_TIMEOUT_MS = 10_000;

function withTimeout<T>(inner: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('playroom ready timeout')), ms);
  });
  const settled = inner.then(
    (v) => {
      clearTimeout(timer);
      return v;
    },
    (e) => {
      clearTimeout(timer);
      throw e;
    },
  );
  return Promise.race([settled, timeout]);
}

async function defaultLoadModule(): Promise<PlayroomModule | null> {
  try {
    // Standalone top-level window: never inside the platform iframe.
    if (typeof window !== 'undefined' && window.parent === window) return null;
    if (typeof document === 'undefined') return null;
    const base = document.baseURI;
    // jsdom defaults to about:blank, which is not a valid import base.
    if (!base || base === 'about:blank') return null;
    const url = new URL('playroom-sdk.js', base).href;
    const mod = (await import(/* @vite-ignore */ url)) as {
      Playroom?: PlayroomModule;
    };
    const pm = mod.Playroom;
    if (
      !pm ||
      typeof pm.ready !== 'function' ||
      typeof pm.loadProgress !== 'function' ||
      typeof pm.saveProgress !== 'function'
    ) {
      return null;
    }
    return pm;
  } catch {
    return null;
  }
}

function statusForError(err: unknown): CloudStatus {
  const kind = classifyCloudError(err);
  // Authoritative behavior line: only CONFLICT -> conflict, FORMAT -> format;
  // everything else (including REQUEST_REUSED) -> error.
  if (kind === 'CONFLICT') return 'conflict';
  if (kind === 'FORMAT') return 'format';
  return 'error';
}

export function createCloudClient(deps: PlayroomDeps = {}): CloudClient {
  const loadModule = deps.loadModule ?? defaultLoadModule;
  let status: CloudStatus = 'unknown';
  let readyInfo: PlayroomReady | null = null;
  let mod: PlayroomModule | null = null;

  return {
    get status() {
      return status;
    },
    get readyInfo() {
      return readyInfo;
    },
    async init(): Promise<CloudStatus> {
      try {
        const loaded = await loadModule();
        if (!loaded) {
          mod = null;
          readyInfo = null;
          status = 'unsupported';
          return status;
        }
        mod = loaded;
        const info = await withTimeout(mod.ready(), READY_TIMEOUT_MS);
        readyInfo = info;
        // Visitors, previews, standalone, and old platforms all land here.
        if (!info || info.progressAvailable === false) {
          status = 'guest';
          return status;
        }
        status = 'ready';
        return status;
      } catch {
        mod = null;
        readyInfo = null;
        status = 'unsupported';
        return status;
      }
    },
    async load(): Promise<{
      data: unknown;
      revision: number;
      formatVersion: number;
    } | null> {
      if (!mod || !readyInfo || readyInfo.progressAvailable === false) return null;
      try {
        const res = await mod.loadProgress();
        if (!res) return null;
        status = 'ready';
        return { data: res.data, revision: res.revision, formatVersion: res.formatVersion };
      } catch (err) {
        status = statusForError(err);
        throw err;
      }
    },
    async save(
      data: unknown,
      revision: number,
      formatVersion: number,
      requestId: string,
    ): Promise<CloudSaveOutcome> {
      if (!mod || !readyInfo || readyInfo.progressAvailable === false) {
        return { status: 'unavailable' };
      }
      try {
        // No preview-mode short-circuit here: the SDK already resolves null
        // for preview saves, and that null passes straight through.
        const res = await mod.saveProgress({ data, revision, formatVersion, requestId });
        if (!res) return { status: 'unavailable' };
        // ONLY `saved === true` proves persistence (platform contract). The
        // SDK type says `saved: true`, but the runtime value is checked — an
        // unconfirmed write must never advance the revision or be reported as
        // synced. The cast keeps the defensive check honest.
        const saved = (res as { saved?: unknown }).saved;
        if (saved !== true) return { status: 'unconfirmed' };
        status = 'ready';
        return { status: 'saved', revision: res.revision };
      } catch (err) {
        status = statusForError(err);
        throw err;
      }
    },
  };
}
