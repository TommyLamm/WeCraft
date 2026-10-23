import { describe, it, expect } from 'vitest';
import {
  serializePassiveMobs,
  normalizePassiveMobs,
  passiveMobsForLoad,
  restorePassiveMobs,
  type PassiveMobRecord,
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

describe('passiveMobsForLoad', () => {
  it('returns no mobs when the worldgen version changed (old coordinates are untrusted)', () => {
    // 跨地形版本：本作不保存區塊、載入時整片地形重新生成 → 舊座標可能埋在方塊裡。
    // 保守策略與敵對生物「每場重來」一致；動物之後白天仍會自然重生。
    expect(passiveMobsForLoad([record('cow'), record('pig')], true)).toEqual([]);
  });

  it('normalizes the records when the worldgen version is unchanged', () => {
    const raw = [
      record('cow', { x: 1.5, y: 64, z: -3.25, hp: 6, yaw: 0.5 }),
      record('pig'),
    ];
    expect(passiveMobsForLoad(raw, false)).toEqual(normalizePassiveMobs(raw));
    // 同版本 → 與既有載入語意完全相同：合法記錄原樣（含座標／血量／朝向）。
    expect(passiveMobsForLoad(raw, false)[0]).toEqual({
      kind: 'cow',
      x: 1.5,
      y: 64,
      z: -3.25,
      hp: 6,
      yaw: 0.5,
    });
  });

  it('matches normalizePassiveMobs on corrupt payloads when the worldgen version is unchanged', () => {
    // 重用既有壞資料：未知種類／NaN 座標／死掉的生物／非物件／超過上限的混合。
    const raw = [
      record('cow', { x: 1 }),
      { kind: 'dragon', x: 1, y: 2, z: 3, hp: 10, yaw: 0 },
      { kind: 'pig', x: Number.NaN, y: 2, z: 3, hp: 10, yaw: 0 },
      { kind: 'pig', x: 1, y: 2, z: 3, hp: 0, yaw: 0 },
      null,
      ...Array.from({ length: 20 }, (_, i) => record('sheep', { x: i })),
    ];
    const out = passiveMobsForLoad(raw, false);
    expect(out).toEqual(normalizePassiveMobs(raw)); // 壞筆逐筆丟棄、好的留著
    expect(out).toHaveLength(MAX_PASSIVE_MOBS); // 上限 12
    expect(out[0]).toEqual(record('cow', { x: 1 }));
    for (const junk of [undefined, null, 42, 'nope', { kind: 'cow' }]) {
      expect(passiveMobsForLoad(junk, false)).toEqual([]);
    }
  });

  it('returns no mobs for corrupt payloads when the worldgen version changed (never throws)', () => {
    for (const raw of [undefined, null, 42, 'nope', { kind: 'cow' }, [null, { kind: 'dragon' }]]) {
      expect(() => passiveMobsForLoad(raw, true)).not.toThrow();
      expect(passiveMobsForLoad(raw, true)).toEqual([]);
    }
  });

  it("never returns the caller's array reference (always a fresh array)", () => {
    const raw = [record('cow')];
    const kept = passiveMobsForLoad(raw, false);
    const dropped = passiveMobsForLoad(raw, true);
    expect(kept).not.toBe(raw);
    expect(dropped).not.toBe(raw);
    // 回傳的是正規化後的新記錄 → 改動結果不會回寫呼叫端的資料。
    kept[0].x = 999;
    expect(raw[0].x).toBe(1);
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

  /**
   * I-1（防禦縱深）：**還原端自己**也必須夾制全場上限。
   *
   * 呼叫端（`main.ts`）照例會先跑 `normalizePassiveMobs`（它也會夾 12）→ 但
   * `restorePassiveMobs` **不得**只靠呼叫端：有人直接呼叫它傳 20 筆進來，就會
   * 還原 20 隻、違反「全場上限 12」的不變量（生成端與存檔端都用同一個常數）。
   */
  it('the restored roster is capped at 12 even without a prior normalization', () => {
    const records = Array.from({ length: 20 }, (_, i) => record('cow', { x: i }));
    const mobs = restorePassiveMobs(records);
    expect(mobs).toHaveLength(MAX_PASSIVE_MOBS);
    expect(mobs).toHaveLength(12);
    // 只保留**前** 12 筆
    expect(mobs[0].pos.x).toBe(0);
    expect(mobs[11].pos.x).toBe(11);
  });

  it('the cap counts only the mobs that were actually restored', () => {
    // 前 20 筆裡混著壞的（未知種類／NaN 座標／死掉的）→ 只有好的才計入上限。
    // 「未知種類」在型別上本來就不合法 → 這裡刻意用轉型塞進去（還原路徑必須
    // 容忍這種髒資料 → 跳過該筆）。
    const badKind = { kind: 'dragon', x: 1, y: 2, z: 3, hp: 10, yaw: 0 } as unknown as PassiveMobRecord;
    const records: PassiveMobRecord[] = [
      record('cow', { x: 0 }),
      badKind,
      record('pig', { x: 1 }),
      ...Array.from({ length: 30 }, (_, i) => record('sheep', { x: i + 10 })),
    ];
    const mobs = restorePassiveMobs(records);
    expect(mobs).toHaveLength(MAX_PASSIVE_MOBS);
    expect(mobs.map((m) => m.kind)).toEqual([
      'cow',
      'pig',
      ...Array.from({ length: 10 }, () => 'sheep'),
    ]);
  });
});
