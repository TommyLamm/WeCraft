import { describe, it, expect } from 'vitest';
import {
  serializePassiveMobs,
  normalizePassiveMobs,
  restorePassiveMobs,
} from './passive-save';
import { createPassiveMob, stepPassiveMob, MAX_PASSIVE_MOBS, PASSIVE_DEFS } from './passive-mobs';

/** 一筆合法的被動生物記錄（持久化格式：`kind`／座標／血量／朝向）。 */
function record(
  kind: 'chicken' | 'pig' | 'sheep' | 'cow',
  patch: Partial<{ x: number; y: number; z: number; hp: number; yaw: number }> = {},
) {
  return { kind, x: 1, y: 2, z: 3, hp: PASSIVE_DEFS[kind].hp, yaw: 0, ...patch };
}

describe('serializePassiveMobs', () => {
  it('serialize copies kind, position, hp and yaw', () => {
    const cow = { ...createPassiveMob('cow', { x: 1, y: 2, z: 3 }), hp: 7, yaw: 1.25 };
    const records = serializePassiveMobs([cow]);
    expect(records).toEqual([{ kind: 'cow', x: 1, y: 2, z: 3, hp: 7, yaw: 1.25 }]);
  });

  it('serialize deep-copies (mutating the result never touches the live mob)', () => {
    const cow = { ...createPassiveMob('cow', { x: 1, y: 2, z: 3 }), hp: 7, yaw: 1.25 };
    const records = serializePassiveMobs([cow]);
    records[0].hp = 1;
    records[0].x = 99;
    records[0].yaw = 3;
    expect(cow.hp).toBe(7);
    expect(cow.pos.x).toBe(1);
    expect(cow.yaw).toBe(1.25);
  });

  it('serialize returns an empty list for an empty roster', () => {
    expect(serializePassiveMobs([])).toEqual([]);
  });

  it('serialize does not write the transient velocity fields', () => {
    // `vel`／`kbVel` 是**暫態**（每幀重算）→ 不進存檔（否則會把一瞬間的
    // 擊退衝量寫成「生物正在被推」）。
    const mob = { ...createPassiveMob('chicken', { x: 0, y: 0, z: 0 }), vel: { x: 1, y: 2, z: 3 } };
    expect(Object.keys(serializePassiveMobs([mob])[0]).sort()).toEqual([
      'hp',
      'kind',
      'x',
      'y',
      'yaw',
      'z',
    ]);
  });
});

describe('normalizePassiveMobs', () => {
  it('a corrupt record is dropped but the rest survive', () => {
    const raw = [
      { kind: 'cow', x: 1, y: 2, z: 3, hp: 10, yaw: 0 },
      { kind: 'dragon', x: 1, y: 2, z: 3, hp: 10, yaw: 0 }, // 未知種類
      { kind: 'pig', x: Number.NaN, y: 2, z: 3, hp: 10, yaw: 0 }, // 壞座標
      { kind: 'pig', x: 1, y: 2, z: 3, hp: 0, yaw: 0 }, // 死掉的生物
    ];
    expect(normalizePassiveMobs(raw)).toHaveLength(1);
    expect(normalizePassiveMobs(raw)[0]).toEqual({
      kind: 'cow',
      x: 1,
      y: 2,
      z: 3,
      hp: 10,
      yaw: 0,
    });
  });

  it('a non-array payload yields an empty list', () => {
    expect(normalizePassiveMobs(undefined)).toEqual([]);
    expect(normalizePassiveMobs('nope')).toEqual([]);
    expect(normalizePassiveMobs(null)).toEqual([]);
    expect(normalizePassiveMobs(42)).toEqual([]);
    expect(normalizePassiveMobs({ kind: 'cow' })).toEqual([]);
  });

  it('a non-object entry is dropped', () => {
    expect(normalizePassiveMobs([null, 7, 'cow', undefined])).toEqual([]);
  });

  it('a prototype key is not a valid kind', () => {
    // 原型鍵守門：`PASSIVE_DEFS['toString']` 會命中 Object.prototype（不是函式
    // 也「看起來」存在）→ 必須用 hasOwnProperty 判定種類。
    expect(normalizePassiveMobs([{ kind: 'toString', x: 1, y: 2, z: 3, hp: 4, yaw: 0 }])).toEqual([]);
    expect(normalizePassiveMobs([{ kind: 'constructor', x: 1, y: 2, z: 3, hp: 4, yaw: 0 }])).toEqual(
      [],
    );
  });

  it('the list is capped at 12', () => {
    const raw = Array.from({ length: 20 }, (_, i) => record('cow', { x: i }));
    const out = normalizePassiveMobs(raw);
    expect(out).toHaveLength(MAX_PASSIVE_MOBS);
    expect(out).toHaveLength(12);
    // 只保留**前** 12 筆（後面的丟棄）
    expect(out[0].x).toBe(0);
    expect(out[11].x).toBe(11);
  });

  it('hp is clamped to the kind maximum', () => {
    const out = normalizePassiveMobs([{ kind: 'chicken', x: 1, y: 2, z: 3, hp: 999, yaw: 0 }]);
    expect(out[0].hp).toBe(4);
    expect(out[0].hp).toBe(PASSIVE_DEFS.chicken.hp);
  });

  it('a non-finite hp drops the record (a dead mob is not restored)', () => {
    expect(normalizePassiveMobs([record('cow', { hp: Number.NaN })])).toEqual([]);
    expect(normalizePassiveMobs([record('cow', { hp: Number.POSITIVE_INFINITY })])).toEqual([]);
    expect(normalizePassiveMobs([record('cow', { hp: -3 })])).toEqual([]);
  });

  it('a non-finite yaw falls back to 0 (the record itself survives)', () => {
    const out = normalizePassiveMobs([record('cow', { yaw: Number.NaN })]);
    expect(out).toHaveLength(1);
    expect(out[0].yaw).toBe(0);
  });

  it('a missing yaw falls back to 0', () => {
    const out = normalizePassiveMobs([{ kind: 'cow', x: 1, y: 2, z: 3, hp: 10 }]);
    expect(out).toHaveLength(1);
    expect(out[0].yaw).toBe(0);
  });
});

describe('restorePassiveMobs', () => {
  it('restored mobs keep kind, position, hp and yaw', () => {
    const raw = [record('cow', { x: 1.5, y: 64, z: -3.25, hp: 6, yaw: 0.5 })];
    const mobs = restorePassiveMobs(normalizePassiveMobs(raw));
    expect(mobs).toHaveLength(1);
    expect(mobs[0].kind).toBe('cow');
    expect(mobs[0].hp).toBe(6);
    expect(mobs[0].pos).toEqual({ x: 1.5, y: 64, z: -3.25 });
    expect(mobs[0].yaw).toBe(0.5);
  });

  it('a legacy record without kbVel or vel restores without a TypeError', () => {
    // **Task 6 的地雷**：`stepPassiveMob` 直接讀 `m.kbVel.x`（沒有守衛）→
    // 載入後的生物若沒有這個欄位 → 下一幀就 TypeError。
    // 舊記錄（持久化格式裡本來就沒有 kbVel／vel）必須被補上合法值。
    const legacy = { kind: 'chicken', x: 1, y: 2, z: 3, hp: 3, yaw: 0 };
    const records = normalizePassiveMobs([legacy]);
    expect(records).toHaveLength(1);
    const mobs = restorePassiveMobs(records);
    expect(mobs).toHaveLength(1);
    expect(mobs[0].kbVel).toEqual({ x: 0, z: 0 });
    expect(mobs[0].vel).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('a restored mob can be stepped (the kbVel landmine stays closed)', () => {
    const mobs = restorePassiveMobs(
      normalizePassiveMobs([{ kind: 'chicken', x: 0.5, y: 64, z: 0.5, hp: 3, yaw: 0 }]),
    );
    expect(() =>
      stepPassiveMob(mobs[0], {
        playerPos: { x: 0, y: 64, z: 0 },
        isSolidAt: () => false,
        isWaterAt: () => false,
        dt: 1 / 60,
      }),
    ).not.toThrow();
  });

  it('restored mobs get their body size from the kind (never from the record)', () => {
    const mobs = restorePassiveMobs(normalizePassiveMobs([record('cow')]));
    expect(mobs[0].width).toBe(PASSIVE_DEFS.cow.width);
    expect(mobs[0].height).toBe(PASSIVE_DEFS.cow.height);
  });

  it('restoring an empty list yields no mobs', () => {
    expect(restorePassiveMobs([])).toEqual([]);
  });
});
