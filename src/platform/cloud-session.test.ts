// Cloud checkpoint state machine tests (Task 1).
//
// The whole point of this module: a snapshot that may already have reached the
// server keeps its requestId. The platform contract is explicit — a lost
// response is retried with the SAME requestId; changing the id turns an
// idempotent retry into a second write.
import { describe, expect, it } from 'vitest';
import { CloudSession, cloudRowState, type CloudSaveTransport } from './cloud-session';
import type { CloudSaveOutcome } from './playroom';

interface SaveCall {
  data: unknown;
  revision: number;
  formatVersion: number;
  requestId: string;
}

function transportThat(
  handler: (call: SaveCall) => Promise<CloudSaveOutcome>,
): { transport: CloudSaveTransport; calls: SaveCall[] } {
  const calls: SaveCall[] = [];
  return {
    calls,
    transport: {
      async save(data, revision, formatVersion, requestId) {
        calls.push({ data, revision, formatVersion, requestId });
        return handler({ data, revision, formatVersion, requestId });
      },
    },
  };
}

const NETWORK_ERR = Object.assign(new Error('network down'), { code: 503 });

function session(
  transport: CloudSaveTransport,
  requestIds: string[] = ['R1', 'R2', 'R3'],
): CloudSession {
  let i = 0;
  return new CloudSession({
    transport,
    formatVersion: 3,
    newRequestId: () => requestIds[i++] ?? `R${i}`,
  });
}

describe('CloudSession', () => {
  it('a checkpoint after a lost response resends the SAME snapshot with the SAME requestId', async () => {
    const { transport, calls } = transportThat(async () => {
      if (calls.length === 1) throw NETWORK_ERR;
      return { status: 'saved', revision: 6 };
    });
    const s = session(transport);
    s.setRevision(5);

    await s.checkpoint({ a: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0].requestId).toBe('R1');

    // The next automatic checkpoint must NOT replace the frozen snapshot.
    await s.checkpoint({ b: 2 });

    expect(calls).toHaveLength(2);
    expect(calls[1].requestId).toBe('R1');
    expect(calls[1].data).toEqual({ a: 1 });
    expect(calls[1].revision).toBe(5);
  });

  it('a successful save clears the pending snapshot and advances the revision', async () => {
    const { transport, calls } = transportThat(async () => ({ status: 'saved', revision: 9 }));
    const s = session(transport);
    s.setRevision(8);

    await s.checkpoint({ a: 1 });

    expect(calls).toHaveLength(1);
    expect(s.revision).toBe(9);
    expect(s.pending).toBeNull();
    expect(s.retryable).toBe(false);
    expect(s.failureKind).toBeNull();
  });

  it('an unconfirmed save keeps the snapshot, the revision and stays retryable', async () => {
    const { transport, calls } = transportThat(async () => ({ status: 'unconfirmed' }));
    const s = session(transport);
    s.setRevision(4);

    await s.checkpoint({ a: 1 });

    expect(calls).toHaveLength(1);
    expect(s.revision).toBe(4);
    expect(s.pending).not.toBeNull();
    expect(s.pending?.requestId).toBe('R1');
    expect(s.retryable).toBe(true);
  });

  it('an unavailable save (preview mode) drops the snapshot without touching the revision', async () => {
    const { transport } = transportThat(async () => ({ status: 'unavailable' }));
    const s = session(transport);
    s.setRevision(2);

    await s.checkpoint({ a: 1 });

    expect(s.revision).toBe(2);
    expect(s.pending).toBeNull();
    expect(s.retryable).toBe(false);
  });

  it('a checkpoint while a send is in flight is dropped', async () => {
    const gate: { release?: (o: CloudSaveOutcome) => void } = {};
    const { transport, calls } = transportThat(
      () => new Promise<CloudSaveOutcome>((resolve) => (gate.release = resolve)),
    );
    const s = session(transport);
    s.setRevision(1);

    const first = s.checkpoint({ a: 1 });
    await s.checkpoint({ b: 2 });

    expect(calls).toHaveLength(1);
    expect(calls[0].data).toEqual({ a: 1 });

    gate.release?.({ status: 'saved', revision: 2 });
    await first;
    expect(s.revision).toBe(2);
  });

  it('never sends while the revision is unknown', async () => {
    const { transport, calls } = transportThat(async () => ({ status: 'saved', revision: 1 }));
    const s = session(transport);

    await s.checkpoint({ a: 1 });

    expect(calls).toHaveLength(0);
  });

  it('a format error locks further sends and clears the snapshot', async () => {
    const fmt = Object.assign(new Error('bad format'), {
      machineCode: 'SAVE_FORMAT_INCOMPATIBLE',
    });
    const { transport, calls } = transportThat(async () => {
      throw fmt;
    });
    const s = session(transport);
    s.setRevision(1);

    await s.checkpoint({ a: 1 });
    expect(s.failureKind).toBe('FORMAT');
    expect(s.pending).toBeNull();
    expect(s.retryable).toBe(false);

    await s.checkpoint({ b: 2 });
    expect(calls).toHaveLength(1);
  });

  it('an auth error stops account writes and clears the snapshot', async () => {
    const auth = Object.assign(new Error('unauthorised'), { code: 401 });
    const { transport, calls } = transportThat(async () => {
      throw auth;
    });
    const s = session(transport);
    s.setRevision(1);

    await s.checkpoint({ a: 1 });
    expect(s.failureKind).toBe('AUTH');
    expect(s.pending).toBeNull();
    expect(s.retryable).toBe(false);

    await s.checkpoint({ b: 2 });
    expect(calls).toHaveLength(1);
  });

  it('a conflict error keeps the snapshot and the revision', async () => {
    const conflict = Object.assign(new Error('revision conflict'), {
      machineCode: 'SAVE_REVISION_CONFLICT',
    });
    const { transport } = transportThat(async () => {
      throw conflict;
    });
    const s = session(transport);
    s.setRevision(3);

    await s.checkpoint({ a: 1 });

    expect(s.failureKind).toBe('CONFLICT');
    expect(s.revision).toBe(3);
    expect(s.pending).not.toBeNull();
  });

  it('retry resends the pending snapshot with its frozen requestId', async () => {
    const { transport, calls } = transportThat(async () => {
      throw NETWORK_ERR;
    });
    const s = session(transport);
    s.setRevision(1);

    await s.checkpoint({ a: 1 });
    await s.retry();

    expect(calls).toHaveLength(2);
    expect(calls[0].requestId).toBe('R1');
    expect(calls[1].requestId).toBe('R1');
    expect(calls[1].data).toEqual({ a: 1 });
  });
});

const CONFLICT_ERR = Object.assign(new Error('revision conflict'), {
  machineCode: 'SAVE_REVISION_CONFLICT',
});

/** A minimal VALID CloudData payload (passes validateCloudData). */
function remoteData(slots: Array<{ item: 'stone' | 'dirt'; count: number }> = []) {
  return {
    seed: 7,
    pos: [1, 2, 3] as [number, number, number],
    yaw: 0,
    vitals: null,
    clockT: 0,
    inventory: slots,
    advancements: { done: {}, nightSeen: false },
    settings: {
      renderDistance: 10,
      sensitivity: 1,
      volume: 1,
      mode: 'survival' as const,
      dayLengthSec: 600,
      shadows: true,
      clouds: true,
    },
  };
}

describe('CloudSession — 409 衝突（C1）', () => {
  it('a conflict keeps the pending snapshot, blocks sends, and resolveConflict is the only exit', async () => {
    const { transport, calls } = transportThat(async () => {
      if (calls.length === 1) throw CONFLICT_ERR;
      return { status: 'saved', revision: 99 };
    });
    const s = session(transport);
    s.setRevision(5);

    await s.checkpoint({ a: 1 });
    expect(s.failureKind).toBe('CONFLICT');
    expect(s.pending?.data).toEqual({ a: 1 });
    expect(s.revision).toBe(5);

    // While the conflict is unresolved nothing may be sent — not a checkpoint
    // (a new snapshot) and not a retry (the old one). The player decides.
    await s.checkpoint({ b: 2 });
    await s.retry();
    expect(calls).toHaveLength(1);
    expect(s.pending?.data).toEqual({ a: 1 });
    expect(s.revision).toBe(5);

    s.setConflict({ data: remoteData() as never, revision: 7 });
    await s.resolveConflict('keep-local');

    expect(calls).toHaveLength(2);
    expect(calls[1].data).toEqual({ a: 1 }); // the local snapshot, not b
    expect(calls[1].revision).toBe(7); // on the REMOTE revision
    expect(calls[1].requestId).not.toBe(calls[0].requestId); // new content ⇒ new id
    expect(s.revision).toBe(99);
    expect(s.conflict).toBeNull();
    expect(s.pending).toBeNull();
  });

  it('resolveConflict("take-cloud") adopts the remote revision without sending', async () => {
    const { transport, calls } = transportThat(async () => {
      throw CONFLICT_ERR;
    });
    const s = session(transport);
    s.setRevision(3);
    await s.checkpoint({ a: 1 });

    s.setConflict({ data: remoteData() as never, revision: 11 });
    await s.resolveConflict('take-cloud');

    expect(calls).toHaveLength(1); // nothing was sent
    expect(s.revision).toBe(11); // the remote slot's revision is now the base
    expect(s.pending).toBeNull();
    expect(s.conflict).toBeNull();
    expect(s.retryable).toBe(false);
    expect(s.failureKind).toBeNull();
  });

  it('resolveConflict("merge") sends the merged payload on the remote revision with a NEW requestId', async () => {
    const { transport, calls } = transportThat(async () => {
      if (calls.length === 1) throw CONFLICT_ERR;
      return { status: 'saved', revision: 12 };
    });
    const s = session(transport);
    s.setRevision(3);
    const local = remoteData([{ item: 'dirt', count: 4 }]);
    await s.checkpoint(local);

    s.setConflict({ data: remoteData([{ item: 'stone', count: 9 }]) as never, revision: 4 });
    await s.resolveConflict('merge');

    expect(calls).toHaveLength(2);
    const sent = calls[1].data as { inventory: Array<{ item: string; count: number } | null> };
    const items = sent.inventory.filter((x) => x !== null).map((x) => x!.item).sort();
    expect(items).toEqual(['dirt', 'stone']); // local kept, remote-only added
    expect(calls[1].revision).toBe(4);
    expect(calls[1].requestId).toBe('R2');
    expect(s.revision).toBe(12);
  });

  it('resolveConflict is a no-op when there is no conflict', async () => {
    const { transport, calls } = transportThat(async () => ({ status: 'saved', revision: 1 }));
    const s = session(transport);
    s.setRevision(0);
    await s.resolveConflict('merge');
    expect(calls).toHaveLength(0);
  });
});

describe('cloudRowState (A2)', () => {
  it('an unconfirmed save is reported as 尚未同步 (syncing), not as synced', async () => {
    const { transport } = transportThat(async () => ({ status: 'unconfirmed' }));
    const s = session(transport);
    s.setRevision(1);

    await s.checkpoint({ a: 1 });

    const row = cloudRowState(s, 'ready');
    expect(row.status).toBe('syncing');
    expect(row.retryable).toBe(true);
  });

  it('a confirmed save is reported as ready', async () => {
    const { transport } = transportThat(async () => ({ status: 'saved', revision: 2 }));
    const s = session(transport);
    s.setRevision(1);

    await s.checkpoint({ a: 1 });

    const row = cloudRowState(s, 'ready');
    expect(row.status).toBe('ready');
    expect(row.retryable).toBe(false);
  });

  it('a thrown network failure is reported as an error, not as 尚未同步', async () => {
    const { transport } = transportThat(async () => {
      throw NETWORK_ERR;
    });
    const s = session(transport);
    s.setRevision(1);

    await s.checkpoint({ a: 1 });

    const row = cloudRowState(s, 'error');
    expect(row.status).toBe('error');
    expect(row.retryable).toBe(true);
  });

  it('a classified conflict reads as 有新進度 (conflict), not as a plain error', async () => {
    const conflict = Object.assign(new Error('revision conflict'), {
      machineCode: 'SAVE_REVISION_CONFLICT',
    });
    const { transport } = transportThat(async () => {
      throw conflict;
    });
    const s = session(transport);
    s.setRevision(1);

    await s.checkpoint({ a: 1 });

    // The row must say 雲端：有新進度 (conflict) — a plain 同步失敗 (error)
    // would hide the fact that another device holds a newer progress.
    const row = cloudRowState(s, 'ready');
    expect(row.status).toBe('conflict');
    expect(row.retryable).toBe(true);
  });

  it('guest and unsupported clients keep their own rows', () => {
    const { transport } = transportThat(async () => ({ status: 'unavailable' }));
    const s = session(transport);
    expect(cloudRowState(s, 'guest').status).toBe('guest');
    expect(cloudRowState(s, 'unsupported').status).toBe('unsupported');
  });
});
