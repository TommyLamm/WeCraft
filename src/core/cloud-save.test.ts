import { describe, it, expect } from 'vitest';
import {
  CLOUD_FORMAT_VERSION,
  CLOUD_MAX_BYTES,
  buildCloudData,
  byteSizeOf,
  validateCloudData,
  acceptCloudData,
  shouldAllowSave,
  classifyCloudError,
  type CloudData,
} from './cloud-save';
import { createVitals } from '../player/survival';
import type { Settings } from './settings';

function validSettings(): Settings {
  return {
    seed: 1337,
    renderDistance: 10,
    sensitivity: 1,
    volume: 0.8,
    mode: 'survival',
    dayLengthSec: 600,
    shadows: true,
    clouds: true,
  };
}

function rawValid(): Record<string, unknown> {
  return {
    seed: 1337,
    pos: [1.5, 64, -3.25],
    yaw: 1.2,
    vitals: { ...createVitals() },
    clockT: 123.4,
    inventory: [{ item: 'stone', count: 64 }, null],
    advancements: { done: { getting_wood: true }, nightSeen: false },
    settings: { ...validSettings() },
  };
}

describe('cloud-save', () => {
  it('buildCloudData deep-copies live state', () => {
    const pos: [number, number, number] = [10, 65, -7];
    const vitals = createVitals();
    const inventory = [{ item: 'stone' as const, count: 64 }, null] as CloudData['inventory'];
    const advancements = { done: { getting_wood: true as boolean }, nightSeen: false };
    const settings = validSettings();
    const built = buildCloudData({
      seed: 42,
      pos,
      yaw: 0.5,
      vitals,
      clockT: 99,
      inventory,
      advancements,
      settings,
    });
    // Mutate every live input after the build.
    pos[0] = 999;
    vitals.hp = 1;
    inventory[0] = { item: 'dirt', count: 1 };
    advancements.done.getting_wood = false;
    settings.volume = 0;
    expect(built.pos).toEqual([10, 65, -7]);
    expect(built.vitals?.hp).toBe(20);
    expect(built.inventory[0]).toEqual({ item: 'stone', count: 64 });
    expect(built.advancements.done.getting_wood).toBe(true);
    expect(built.settings.volume).toBe(0.8);
  });

  it('buildCloudData zeroes non-finite pos/yaw without throwing', () => {
    const built = buildCloudData({
      seed: 1,
      pos: [Number.NaN, 64, 0],
      yaw: Number.NaN,
      vitals: null,
      clockT: 0,
      inventory: [],
      advancements: { done: {}, nightSeen: false },
      settings: validSettings(),
    });
    expect(built.pos).toEqual([0, 0, 0]);
    expect(built.yaw).toBe(0);
    const inf = buildCloudData({
      seed: 1,
      pos: [1, 2, 3],
      yaw: Number.POSITIVE_INFINITY,
      vitals: null,
      clockT: 0,
      inventory: [],
      advancements: { done: {}, nightSeen: false },
      settings: validSettings(),
    });
    expect(inf.pos).toEqual([1, 2, 3]);
    expect(inf.yaw).toBe(0);
  });

  it('exposes format version 1 and a 64 KiB cap', () => {
    expect(CLOUD_FORMAT_VERSION).toBe(1);
    expect(CLOUD_MAX_BYTES).toBe(65536);
  });

  it('byteSizeOf: small payload is under 1 KiB', () => {
    const data = buildCloudData({
      seed: 1337,
      pos: [0, 64, 0],
      yaw: 0,
      vitals: null,
      clockT: 0,
      inventory: [],
      advancements: { done: {}, nightSeen: false },
      settings: validSettings(),
    });
    expect(byteSizeOf(data)).toBeLessThan(1024);
  });

  it('byteSizeOf: a packed 2000-slot inventory stays under the cap', () => {
    const inventory: CloudData['inventory'] = [];
    for (let i = 0; i < 2000; i++) inventory.push({ item: 'stone', count: 64 });
    const data = buildCloudData({
      seed: 7,
      pos: [0, 64, 0],
      yaw: 0,
      vitals: { ...createVitals() },
      clockT: 5,
      inventory,
      advancements: { done: {}, nightSeen: false },
      settings: validSettings(),
    });
    expect(byteSizeOf(data)).toBeLessThan(CLOUD_MAX_BYTES);
  });

  it('byteSizeOf counts unknown fields: a 70 KiB extra exceeds the cap but still validates', () => {
    const base = buildCloudData({
      seed: 7,
      pos: [0, 64, 0],
      yaw: 0,
      vitals: null,
      clockT: 0,
      inventory: [],
      advancements: { done: {}, nightSeen: false },
      settings: validSettings(),
    });
    const withExtra = { ...base, extraPayload: 'x'.repeat(70 * 1024) } as CloudData;
    expect(byteSizeOf(withExtra)).toBeGreaterThan(CLOUD_MAX_BYTES);
    expect(validateCloudData(withExtra)).toBe(true);
  });

  it('validateCloudData accepts a complete v1 payload', () => {
    expect(validateCloudData(rawValid())).toBe(true);
  });

  it('validateCloudData rejects malformed payloads', () => {
    const nanPos = rawValid();
    nanPos.pos = [Number.NaN, 0, 0];
    expect(validateCloudData(nanPos)).toBe(false);

    const noSettings = rawValid();
    delete noSettings.settings;
    expect(validateCloudData(noSettings)).toBe(false);

    const badCount = rawValid();
    badCount.inventory = [{ item: 'x' }];
    expect(validateCloudData(badCount)).toBe(false);
  });

  it('acceptCloudData normalizes v1 data: sanitizes advancements, clamps settings, keeps unknown item ids', () => {
    const raw = rawValid();
    raw.advancements = {
      done: { getting_wood: true, bogus_id: true, stone_age: 'yes' },
      nightSeen: 1,
    };
    raw.settings = {
      renderDistance: 999,
      sensitivity: 99,
      volume: -5,
      mode: 'creative',
      dayLengthSec: 1,
      shadows: true,
      clouds: false,
    };
    raw.inventory = [{ item: 'not_a_real_item', count: 3 }];
    const accepted = acceptCloudData(raw);
    expect(accepted).not.toBeNull();
    expect(accepted?.advancements).toEqual({ done: { getting_wood: true }, nightSeen: false });
    expect(accepted?.settings).toEqual({
      renderDistance: 16,
      sensitivity: 3,
      volume: 0,
      mode: 'creative',
      dayLengthSec: 60,
      shadows: true,
      clouds: false,
    });
    // Illegal item ids are kept here; the main-side inventory model drops them.
    expect(accepted?.inventory).toEqual([{ item: 'not_a_real_item', count: 3 }]);
    // Fresh copy, not a reference into the input.
    expect(accepted).not.toBe(raw);
    expect(validateCloudData(raw)).toBe(true);
  });

  it('acceptCloudData normalizes partial/illegal vitals to finite clamped values', () => {
    // validateCloudData only requires a finite hp — a partial payload must
    // still come out with finite hunger/maxHunger (Minor 6).
    const partial = rawValid();
    partial.vitals = { hp: 20 };
    const accepted = acceptCloudData(partial);
    expect(accepted).not.toBeNull();
    expect(accepted?.vitals).toEqual({
      hp: 20, maxHp: 20, hunger: 20, maxHunger: 20, saturation: 5, regenAcc: 0, starveAcc: 0,
      exhaustion: 0,
    });

    // Hostile values clamp / fall back instead of leaking NaN or absurd banks.
    const hostile = rawValid();
    hostile.vitals = {
      hp: 999,
      maxHp: -3, // out of range → model default
      hunger: Number.NaN,
      maxHunger: 'x',
      saturation: 1e9,
      regenAcc: Number.POSITIVE_INFINITY,
      starveAcc: -5,
    };
    const a2 = acceptCloudData(hostile);
    expect(a2?.vitals).toEqual({
      hp: 20, maxHp: 20, hunger: 20, maxHunger: 20, saturation: 20, regenAcc: 0, starveAcc: 0,
      exhaustion: 0,
    });
  });

  it('shouldAllowSave blocks null revisions and allows any read revision', () => {
    expect(shouldAllowSave({ revision: null })).toBe(false);
    expect(shouldAllowSave({ revision: 0 })).toBe(true);
    expect(shouldAllowSave({ revision: 41 })).toBe(true);
  });

  it('classifyCloudError maps platform machine codes', () => {
    expect(classifyCloudError({ machineCode: 'SAVE_REVISION_CONFLICT' })).toBe('CONFLICT');
    expect(classifyCloudError({ machineCode: 'SAVE_FORMAT_INCOMPATIBLE' })).toBe('FORMAT');
    expect(classifyCloudError({ machineCode: 'REQUEST_ID_REUSED' })).toBe('REQUEST_REUSED');
  });

  it('classifyCloudError maps auth, bare 409, unavailable and network', () => {
    expect(classifyCloudError({ code: 401 })).toBe('AUTH');
    expect(classifyCloudError({ code: 403 })).toBe('AUTH');
    expect(classifyCloudError({ machineCode: 'AUTH_EXPIRED' })).toBe('AUTH');
    expect(classifyCloudError({ machineCode: 'PERMISSION_DENIED' })).toBe('AUTH');
    // Bare numeric 409 with no machineCode is treated conservatively as CONFLICT.
    expect(classifyCloudError(409)).toBe('CONFLICT');
    expect(classifyCloudError({ code: 409 })).toBe('CONFLICT');
    expect(classifyCloudError(null)).toBe('UNAVAILABLE');
    expect(classifyCloudError(undefined)).toBe('UNAVAILABLE');
    expect(classifyCloudError({})).toBe('NETWORK');
    expect(classifyCloudError(new Error('boom'))).toBe('NETWORK');
  });
});
