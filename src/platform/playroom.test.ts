// Task 3: Playroom cloud client adapter tests.
// All SDK access is injected via loaders — no network, jsdom-safe.
import { describe, expect, it, vi } from 'vitest';
import { createCloudClient } from './playroom';
import type { PlayroomModule, PlayroomReady } from './playroom-sdk-types';

const AUTH_READY: PlayroomReady = {
  available: true,
  progressAvailable: true,
  mode: 'authenticated',
  sdkVersion: '1.1.0',
  protocolVersion: 1,
  capabilities: ['scoring', 'progress'],
};

const GUEST_READY: PlayroomReady = {
  available: false,
  progressAvailable: false,
  mode: 'guest',
  sdkVersion: '1.1.0',
  protocolVersion: 1,
  capabilities: [],
};

function modWith(ready: PlayroomReady, impl: Partial<PlayroomModule>): PlayroomModule {
  return {
    ready: async () => ready,
    loadProgress: async () => null,
    saveProgress: async () => null,
    ...impl,
  };
}

describe('createCloudClient', () => {
  it('default loader never throws in jsdom and inits to guest/unsupported', async () => {
    const c = createCloudClient();
    const s = await c.init();
    expect(['guest', 'unsupported']).toContain(s);
    expect(['guest', 'unsupported']).toContain(c.status);
  });

  it('null loader inits to guest/unsupported with null load/save', async () => {
    const c = createCloudClient({ loadModule: async () => null });
    const s = await c.init();
    expect(['guest', 'unsupported']).toContain(s);
    await expect(c.load()).resolves.toBeNull();
    await expect(c.save({}, 0, 1, 'req-1')).resolves.toEqual({ status: 'unavailable' });
  });

  it('guest (progressAvailable false) inits to guest and never calls saveProgress', async () => {
    const saveProgress = vi.fn(async (_input: { data: unknown; revision: number; formatVersion: number; requestId?: string }) => null);
    const loadProgress = vi.fn(async () => null);
    const m = modWith(GUEST_READY, { saveProgress, loadProgress });
    const c = createCloudClient({ loadModule: async () => m });
    await expect(c.init()).resolves.toBe('guest');
    expect(c.status).toBe('guest');
    await expect(c.save({ a: 1 }, 1, 1, 'r-1')).resolves.toEqual({ status: 'unavailable' });
    expect(saveProgress).not.toHaveBeenCalled();
    await expect(c.load()).resolves.toBeNull();
    expect(loadProgress).not.toHaveBeenCalled();
  });

  it('authenticated load passes through data/revision/formatVersion', async () => {
    const fixture = {
      data: { pos: [1, 2, 3] },
      revision: 7,
      formatVersion: 1,
      gameVersion: '0.3.0',
      updatedAt: '2026-10-11T00:00:00.000Z',
    };
    const m = modWith(AUTH_READY, { loadProgress: async () => fixture });
    const c = createCloudClient({ loadModule: async () => m });
    await expect(c.init()).resolves.toBe('ready');
    await expect(c.load()).resolves.toEqual({
      data: fixture.data,
      revision: 7,
      formatVersion: 1,
    });
  });

  it('authenticated save resolves the new revision and forwards requestId', async () => {
    let seen: { data: unknown; revision: number; formatVersion: number; requestId?: string } | undefined;
    const m = modWith(AUTH_READY, {
      saveProgress: async (input) => {
        seen = input;
        return {
          data: input.data,
          revision: 8,
          formatVersion: input.formatVersion,
          gameVersion: '0.3.0',
          updatedAt: '2026-10-11T00:00:01.000Z',
          saved: true as const,
        };
      },
    });
    const c = createCloudClient({ loadModule: async () => m });
    await expect(c.init()).resolves.toBe('ready');
    await expect(c.save({ k: 1 }, 7, 1, 'req-123')).resolves.toEqual({
      status: 'saved',
      revision: 8,
    });
    expect(seen).toMatchObject({ revision: 7, formatVersion: 1, requestId: 'req-123' });
  });

  it('saveProgress without saved:true is unconfirmed and never advances the revision', async () => {
    // A2 / the platform contract: only `saved: true` proves persistence. The
    // SDK type promises `saved: true`, so the runtime value is what counts —
    // an unconfirmed write must not be reported as synced.
    const m = modWith(AUTH_READY, {
      saveProgress: async (input) =>
        ({
          data: input.data,
          revision: 99,
          formatVersion: input.formatVersion,
          gameVersion: '0.10.0',
          updatedAt: '2026-10-26T00:00:00.000Z',
          saved: false,
        }) as unknown as Awaited<ReturnType<PlayroomModule['saveProgress']>>,
    });
    const c = createCloudClient({ loadModule: async () => m });
    await c.init();
    await expect(c.save({ k: 1 }, 7, 1, 'req-1')).resolves.toEqual({ status: 'unconfirmed' });
  });

  it('saveProgress with a missing saved flag is unconfirmed', async () => {
    const m = modWith(AUTH_READY, {
      saveProgress: async (input) =>
        ({
          data: input.data,
          revision: 99,
          formatVersion: input.formatVersion,
          gameVersion: '0.10.0',
          updatedAt: '2026-10-26T00:00:00.000Z',
        }) as unknown as Awaited<ReturnType<PlayroomModule['saveProgress']>>,
    });
    const c = createCloudClient({ loadModule: async () => m });
    await c.init();
    await expect(c.save({ k: 1 }, 7, 1, 'req-1')).resolves.toEqual({ status: 'unconfirmed' });
  });

  it('SAVE_REVISION_CONFLICT rethrows the original error and sets conflict', async () => {
    const err = Object.assign(new Error('revision conflict'), {
      machineCode: 'SAVE_REVISION_CONFLICT',
    });
    const m = modWith(AUTH_READY, {
      saveProgress: async () => {
        throw err;
      },
    });
    const c = createCloudClient({ loadModule: async () => m });
    await c.init();
    await expect(c.save({}, 7, 1, 'r-1')).rejects.toBe(err);
    expect(c.status).toBe('conflict');
  });

  it('REQUEST_ID_REUSED maps to error and bare 409 maps to conflict', async () => {
    const reused = Object.assign(new Error('request id reused'), {
      machineCode: 'REQUEST_ID_REUSED',
    });
    const m1 = modWith(AUTH_READY, {
      saveProgress: async () => {
        throw reused;
      },
    });
    const c1 = createCloudClient({ loadModule: async () => m1 });
    await c1.init();
    await expect(c1.save({}, 1, 1, 'dup')).rejects.toBe(reused);
    expect(c1.status).toBe('error');

    const m2 = modWith(AUTH_READY, {
      saveProgress: async () => {
        throw 409;
      },
    });
    const c2 = createCloudClient({ loadModule: async () => m2 });
    await c2.init();
    await expect(c2.save({}, 1, 1, 'x')).rejects.toBe(409);
    expect(c2.status).toBe('conflict');
  });

  it('SAVE_FORMAT_INCOMPATIBLE sets format and rethrows', async () => {
    const err = Object.assign(new Error('bad format'), {
      machineCode: 'SAVE_FORMAT_INCOMPATIBLE',
    });
    const m = modWith(AUTH_READY, {
      saveProgress: async () => {
        throw err;
      },
    });
    const c = createCloudClient({ loadModule: async () => m });
    await c.init();
    await expect(c.save({}, 1, 1, 'r-1')).rejects.toBe(err);
    expect(c.status).toBe('format');
  });

  it('load() rejection rethrows the original error and maps the status', async () => {
    // Review Minor 1: the load()-error path was untested — a boot read that
    // throws must surface as a rejection (main.ts's catch) with the mapped
    // client status, never a silent null.
    const netErr = new Error('network down');
    const m1 = modWith(AUTH_READY, {
      loadProgress: async () => {
        throw netErr;
      },
    });
    const c1 = createCloudClient({ loadModule: async () => m1 });
    await expect(c1.init()).resolves.toBe('ready');
    await expect(c1.load()).rejects.toBe(netErr);
    expect(c1.status).toBe('error');

    const conflict = Object.assign(new Error('conflict'), {
      machineCode: 'SAVE_REVISION_CONFLICT',
    });
    const m2 = modWith(AUTH_READY, {
      loadProgress: async () => {
        throw conflict;
      },
    });
    const c2 = createCloudClient({ loadModule: async () => m2 });
    await expect(c2.init()).resolves.toBe('ready');
    await expect(c2.load()).rejects.toBe(conflict);
    expect(c2.status).toBe('conflict');
  });

  it('null saveProgress result is unavailable and leaves the status alone', async () => {
    const m = modWith(AUTH_READY, { saveProgress: async () => null });
    const c = createCloudClient({ loadModule: async () => m });
    await expect(c.init()).resolves.toBe('ready');
    await expect(c.save({}, 1, 1, 'r-1')).resolves.toEqual({ status: 'unavailable' });
    expect(c.status).toBe('ready');
  });
});
