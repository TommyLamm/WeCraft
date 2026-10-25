import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveGame,
  loadGame,
  openSaveDb,
  collectSavePayload,
  isValidSavePayload,
  type SavePayload,
  type SavePayloadV1,
  type SavePayloadV2,
  type SavePayloadV3,
  type SavePayloadV4,
} from './save';
import { createVitals } from '../player/survival';
import { emptyAdvancements } from '../core/advancements';
import { createModeStash, type ModeStash } from '../core/mode-stash';
import { starterSlots, INVENTORY_SLOTS, type ItemStack } from '../core/items';
import { WORLDGEN_VERSION } from './worldgen';
import { createPassiveMob } from './passive-mobs';
// B6 Task 8：光照不入存檔、火把走 modified overlay 的相容性釘子
import { World } from './world';
import { BLOCK, getBlockDef } from './blocks';
import { blockLightAt, computeChunkLight } from './lighting';

/** DB name is part of the on-disk contract (save.ts) — duplicated here so the
 *  test can delete the whole database between cases without exporting it. */
const DB_NAME = 'wecraft-save';

/** Inventory-shaped slots: `items` padded with nulls to the 36-slot width —
 *  the current payloads are stored canonical, so a round-trip can deep-equal. */
function slots(...items: Array<ItemStack | null>): Array<ItemStack | null> {
  return [...items, ...new Array(INVENTORY_SLOTS - items.length).fill(null)];
}

/** The OLD 9-slot shape a pre-B5 record actually wrote (v1/v2/v3 fixtures). */
function legacySlots(...items: Array<ItemStack | null>): Array<ItemStack | null> {
  return [...items, ...new Array(9 - items.length).fill(null)];
}

function deleteSaveDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

function makePayload(patch: Partial<SavePayload> = {}): SavePayload {
  return {
    // B7 Task 2：payload v5（v4 的 36 格語意 ＋ `ItemStack.dur`）。
    version: 5,
    savedAt: 0, // saveGame must stamp its own value
    worldSeed: 1337,
    modified: [
      ['5,70,5', 1], // placed stone
      ['6,70,6', 0], // mined to air — must stay mined
    ],
    player: {
      pos: [1.5, 64, -3.25],
      yaw: 0.75,
      mode: 'survival',
      vitals: createVitals(),
      inventory: slots(
        { item: 'stone', count: 32 },
        null,
        { item: 'wooden_pickaxe', count: 1, dur: 59 },
      ),
    },
    time: { t: 0.42 },
    // non-empty, so the round-trip deep-equal actually exercises progress state
    advancements: {
      done: { getting_wood: true, monster_hunter: true },
      nightSeen: true,
    },
    // the other mode's hotbar + survival vitals travel with the payload (B1.3)
    stash: {
      survival: slots({ item: 'dirt', count: 3 }),
      creative: slots({ item: 'stone', count: 64 }),
      survivalVitals: { ...createVitals(), hp: 12 },
    },
    // B3 Task 7：附加欄位（payload 版本仍是 3）——記錄這份地形是哪一版生成器
    // 生成的。fixture 必須帶著它，否則 round-trip 的 deep-equal 會失敗
    //（讀回來的舊記錄不會被自動補值 → 見下面的舊存檔案例）。
    worldgenVersion: WORLDGEN_VERSION,
    // B4 Task 10：附加欄位（payload 版本仍是 3）——被動生物的持久化記錄。
    // fixture 帶著空陣列 → round-trip 的 deep-equal 才成立。
    passiveMobs: [],
    ...patch,
  };
}

/** A raw v1 record exactly as a pre-Task-11 build wrote it (no advancements). */
function makeV1Payload(): SavePayloadV1 {
  return {
    version: 1,
    savedAt: 0,
    worldSeed: 1337,
    modified: [['5,70,5', 1]],
    player: {
      pos: [1.5, 64, -3.25],
      yaw: 0.75,
      mode: 'survival',
      vitals: null,
      inventory: [{ item: 'stone', count: 32 }],
    },
    time: { t: 0.42 },
  };
}

/** A raw v2 record exactly as a pre-v3 build wrote it (advancements, no stash).
 *  Recorded in creative, so the migration's mode branch is the non-trivial one. */
function makeV2Payload(): SavePayloadV2 {
  return {
    version: 2,
    savedAt: 0,
    worldSeed: 1337,
    modified: [['5,70,5', 1]],
    player: {
      pos: [1.5, 64, -3.25],
      yaw: 0.75,
      mode: 'creative',
      vitals: null,
      inventory: [{ item: 'oak_planks', count: 12 }],
    },
    time: { t: 0.42 },
    advancements: { done: { getting_wood: true }, nightSeen: false },
  };
}

/** A raw v3 record exactly as a pre-B5 build wrote it (9-slot inventory,
 *  dual-mode stash, advancements). */
function makeV3Payload(): SavePayloadV3 {
  return {
    version: 3,
    savedAt: 0,
    worldSeed: 1337,
    modified: [['5,70,5', 1]],
    player: {
      pos: [1.5, 64, -3.25],
      yaw: 0.75,
      mode: 'survival',
      vitals: createVitals(),
      inventory: [{ item: 'stone', count: 32 }, null, { item: 'wooden_pickaxe', count: 1 }],
    },
    time: { t: 0.42 },
    advancements: { done: { getting_wood: true }, nightSeen: false },
    stash: {
      survival: legacySlots({ item: 'dirt', count: 3 }),
      creative: legacySlots({ item: 'stone', count: 64 }),
      survivalVitals: { ...createVitals(), hp: 12 },
    },
  };
}

/** A raw v4 record: v3 + the 36-slot inventory semantics (B5) — i.e. the same
 *  shape as {@link makePayload} minus the `dur` field v5 introduced. */
function makeV4Payload(): SavePayloadV4 {
  const current = makePayload(); // 現況（v5）的 fixture——只差 `dur` 與版本號
  return {
    ...current,
    version: 4,
    player: { ...current.player, inventory: slots({ item: 'stone', count: 32 }) },
  } as SavePayloadV4;
}

/** Create the save DB at a version save.ts cannot open → every save.ts call fails. */
function createIncompatibleDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => req.result.createObjectStore('games');
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

/** Write a raw value straight into the slot, bypassing saveGame's validation. */
function putRawRecord(value: unknown): Promise<void> {
  return openSaveDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction('games', 'readwrite');
        tx.objectStore('games').put(value, 'slot1');
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

describe('saveGame / loadGame', () => {
  beforeEach(deleteSaveDb);

  it('round-trips a full SavePayload through IndexedDB (deep equal)', async () => {
    const payload = makePayload();
    const before = Date.now();
    await saveGame(payload);
    const after = Date.now();
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual({ ...payload, savedAt: expect.any(Number) });
    // savedAt stamped by saveGame itself, not taken from the payload (0)
    expect(loaded!.savedAt).toBeGreaterThanOrEqual(before);
    expect(loaded!.savedAt).toBeLessThanOrEqual(after);
  });

  it('round-trips null vitals and an empty inventory (padded to 36 slots)', async () => {
    const base = makePayload();
    await saveGame({ ...base, player: { ...base.player, vitals: null, inventory: [] } });
    const loaded = await loadGame();
    expect(loaded?.player.vitals).toBeNull();
    // B5 Task 7：本機 payload 一律回傳 36 格（空記錄＝36 個 null）。
    expect(loaded?.player.inventory).toEqual(slots());
    expect(loaded?.player.inventory).toHaveLength(INVENTORY_SLOTS);
  });

  it('round-trips a creative-mode payload', async () => {
    const base = makePayload();
    await saveGame({
      ...base,
      player: { ...base.player, mode: 'creative', vitals: null },
    });
    expect((await loadGame())?.player.mode).toBe('creative');
  });

  it('round-trips stash through IndexedDB', async () => {
    await saveGame(makePayload());
    const loaded = await loadGame();
    expect(loaded?.stash).toEqual(makePayload().stash);
    // a non-canonical stash record (short arrays) is padded back to hotbar width
    const base = makePayload();
    await saveGame({
      ...base,
      stash: {
        survival: [{ item: 'apple', count: 2 }],
        creative: [],
        survivalVitals: createVitals(),
      },
    });
    const reloaded = await loadGame();
    expect(reloaded?.stash.survival).toEqual(slots({ item: 'apple', count: 2 }));
    expect(reloaded?.stash.creative).toEqual(slots());
  });

  it('derives the stash when a v5 record carries a corrupt or missing one', async () => {
    const expected = {
      survival: slots(
        { item: 'stone', count: 32 },
        null,
        { item: 'wooden_pickaxe', count: 1, dur: 59 },
      ),
      creative: starterSlots('creative'),
      survivalVitals: createVitals(), // the recorded vitals, normalized
    };
    // present-but-corrupt stash values fall back to the legacy derivation
    for (const stash of ['junk', 42]) {
      await putRawRecord({ ...makePayload(), stash });
      expect((await loadGame())?.stash).toEqual(expected);
    }
    // a v5 record missing the key entirely falls back the same way
    const noStash = makePayload() as Partial<SavePayload>;
    delete noStash.stash;
    await putRawRecord(noStash);
    expect((await loadGame())?.stash).toEqual(expected);
    // 兩側都是 36 格（不是舊的 9 格）
    expect(expected.survival).toHaveLength(INVENTORY_SLOTS);
    expect(expected.creative).toHaveLength(INVENTORY_SLOTS);
  });

  it('migrates a raw v1 record to v5 with derived stash and empty advancements', async () => {
    const v1 = makeV1Payload();
    await putRawRecord(v1);
    const loaded = await loadGame();
    expect(loaded).toEqual({
      ...v1,
      version: 5,
      player: {
        ...v1.player,
        // 舊的 9 格資料落在前 9 格（熱鍵列），其餘 27 格留空。
        inventory: slots({ item: 'stone', count: 32 }),
      },
      advancements: emptyAdvancements(),
      // no stash on the record → the survival side is derived from what it saved
      stash: {
        survival: slots({ item: 'stone', count: 32 }),
        creative: starterSlots('creative'),
        survivalVitals: createVitals(), // v1 vitals were null → fresh defaults
      },
      // B4 Task 10：loadGame **一律**回傳 `passiveMobs`（正規化後）→ 舊的 v1
      // 記錄沒有這個欄位 → 空陣列（舊存檔＝沒有生物，不是錯誤）。
      passiveMobs: [],
    });
    expect(loaded!.version).toBe(5);
    expect(loaded!.player.inventory).toHaveLength(36);
    expect(loaded!.player.inventory[0]).toEqual({ item: 'stone', count: 32 });
    expect(loaded!.player.inventory.slice(1)).toEqual(new Array(35).fill(null));
    expect(loaded!.stash.survival).toHaveLength(36);
  });

  it('migrates a raw v2 record to v5, deriving stash from the recorded mode', async () => {
    const v2 = makeV2Payload();
    await putRawRecord(v2);
    const loaded = await loadGame();
    expect(loaded).toEqual({
      ...v2,
      version: 5,
      player: {
        ...v2.player,
        // 舊 9 格 → 熱鍵列（前 9 格），其餘留空。
        inventory: slots({ item: 'oak_planks', count: 12 }),
      },
      stash: {
        survival: slots(), // the mode the record was NOT in starts empty
        creative: slots({ item: 'oak_planks', count: 12 }),
        survivalVitals: createVitals(), // creative record → no survival vitals to carry
      },
      // B4 Task 10：同上——舊記錄缺欄位 → 空陣列。
      passiveMobs: [],
    });
    expect(loaded!.version).toBe(5);
    expect(loaded!.player.inventory).toHaveLength(36);
    expect(loaded!.player.inventory[0]).toEqual({ item: 'oak_planks', count: 12 });
    expect(loaded!.player.inventory.slice(1)).toEqual(new Array(35).fill(null));
    expect(loaded!.stash.creative[0]).toEqual({ item: 'oak_planks', count: 12 });
    expect(loaded!.stash.creative).toHaveLength(36);
  });

  it('migrates a raw v3 record to v5 and keeps the nine old slots in the hotbar row', async () => {
    const v3 = {
      ...makeV3Payload(),
      version: 3 as const,
      player: {
        ...makeV3Payload().player,
        inventory: [{ item: 'dirt' as const, count: 5 }, { item: 'stone' as const, count: 1 }],
      },
      stash: {
        ...makeV3Payload().stash,
        survival: legacySlots({ item: 'apple', count: 2 }),
        creative: legacySlots({ item: 'dirt', count: 9 }),
      },
    };
    await putRawRecord(v3);
    const loaded = await loadGame();
    expect(loaded!.version).toBe(5);
    expect(loaded!.player.inventory[0]).toEqual({ item: 'dirt', count: 5 });
    expect(loaded!.player.inventory[1]).toEqual({ item: 'stone', count: 1 });
    expect(loaded!.player.inventory[2]).toBeNull();
    expect(loaded!.player.inventory).toHaveLength(36);
    // v3 的 stash 也只有 9 格 → 兩側都補到 36 格，舊資料留在前 9 格。
    expect(loaded!.stash.survival[0]).toEqual({ item: 'apple', count: 2 });
    expect(loaded!.stash.survival).toHaveLength(36);
    expect(loaded!.stash.creative[0]).toEqual({ item: 'dirt', count: 9 });
    expect(loaded!.stash.creative).toHaveLength(36);
  });

  it('keeps the nine v3 slots out of the main inventory (not shifted)', async () => {
    // 舊 9 格是「熱鍵列」→ 索引 0..8；主背包（9..35）必須是空的。
    const v3 = {
      ...makeV3Payload(),
      player: {
        ...makeV3Payload().player,
        inventory: Array.from({ length: 9 }, (_, i) => ({
          item: 'stone' as const,
          count: i + 1,
        })),
      },
    };
    await putRawRecord(v3);
    const loaded = await loadGame();
    expect(loaded!.player.inventory.slice(0, 9)).toEqual(
      Array.from({ length: 9 }, (_, i) => ({ item: 'stone', count: i + 1 })),
    );
    expect(loaded!.player.inventory.slice(9)).toEqual(new Array(27).fill(null));
  });

  it('keeps B4 passiveMobs through the v3→v5 migration', async () => {
    // 跨批介面：v4 只改背包寬度，不得把 B4 的可選欄位吃掉。
    const v3 = {
      ...makeV3Payload(),
      passiveMobs: [{ kind: 'cow' as const, x: 1, y: 2, z: 3, hp: 10, yaw: 0 }],
    };
    await putRawRecord(v3);
    const loaded = await loadGame();
    expect(loaded!.version).toBe(5);
    expect(loaded!.passiveMobs).toEqual([
      { kind: 'cow', x: 1, y: 2, z: 3, hp: 10, yaw: 0 },
    ]);
  });

  // ── B7 Task 2：payload v5——耐久隨存檔旅行 ─────────────────────────────────
  //
  // `sanitizeStack` 保證「耐久物品必然帶**明確**的 `dur`」→ 這幾條釘住三件事：
  // 1) 新的 v5 記錄把 `dur` 原樣帶回（滿／受損都要）；
  // 2) v1–v4 的舊記錄（那時根本沒有這個欄位）在載入時拿到**滿耐久**，不是
  //    「dur 0 ＝ 一用就壞」——舊存檔不得弄壞玩家的工具；
  // 3) 壞值（負數／超過上限）一律不往下傳（負數→滿耐久、超上限→夾到上限）。
  it('a v5 payload round-trips the durability through IndexedDB', async () => {
    const p = makePayload({
      player: {
        ...makePayload().player,
        inventory: slots({ item: 'iron_pickaxe', count: 1, dur: 137 }),
      },
    });
    await saveGame(p);
    const loaded = await loadGame();
    expect(loaded!.player.inventory[0]).toEqual({ item: 'iron_pickaxe', count: 1, dur: 137 });
  });

  it('migrates a raw v4 record to v5 and gives an old tool full durability', async () => {
    // 本批最重要的遷移斷言：v4 記錄裡沒有 `dur` → 工具必須是**滿耐久**
    //（木鎬上限 59），而不是 0（一用就壞）。
    const v4 = {
      ...makeV4Payload(),
      version: 4,
      player: { ...makeV4Payload().player, inventory: [{ item: 'wooden_pickaxe', count: 1 }] },
    };
    await putRawRecord(v4);
    const loaded = await loadGame();
    expect(loaded!.version).toBe(5);
    expect(loaded!.player.inventory[0]).toEqual({ item: 'wooden_pickaxe', count: 1, dur: 59 });
  });

  it('migrates a raw v1 record to v5 and gives an old tool full durability', async () => {
    const v1 = makeV1Payload();
    await putRawRecord({
      ...v1,
      player: { ...v1.player, inventory: [{ item: 'stone_axe', count: 1 }] },
    });
    const loaded = await loadGame();
    expect(loaded!.version).toBe(5);
    // 石斧上限 131——舊記錄沒有 `dur` → 滿耐久。
    expect(loaded!.player.inventory[0]).toEqual({ item: 'stone_axe', count: 1, dur: 131 });
  });

  it('a v5 record keeps a damaged tool durability', async () => {
    // 受損的工具不得被「修理」成滿耐久（那等於無聲的作弊）。
    await saveGame(
      makePayload({
        player: {
          ...makePayload().player,
          inventory: slots({ item: 'wooden_pickaxe', count: 1, dur: 12 }),
        },
      }),
    );
    const loaded = await loadGame();
    expect(loaded!.player.inventory[0]).toEqual({ item: 'wooden_pickaxe', count: 1, dur: 12 });
  });

  it('a v5 record with a corrupt durability falls back to full durability', async () => {
    await putRawRecord({
      ...makePayload(),
      player: {
        ...makePayload().player,
        inventory: slots({ item: 'wooden_pickaxe', count: 1, dur: -5 }),
      },
    });
    const loaded = await loadGame();
    // **不是** 0（壞掉的存檔不得弄壞玩家的工具）。
    expect(loaded!.player.inventory[0]).toEqual({ item: 'wooden_pickaxe', count: 1, dur: 59 });
  });

  it('a v5 record with an over-max durability is clamped', async () => {
    await putRawRecord({
      ...makePayload(),
      player: {
        ...makePayload().player,
        inventory: slots({ item: 'wooden_pickaxe', count: 1, dur: 9999 }),
      },
    });
    const loaded = await loadGame();
    // 超過上限夾到上限（59），不得讓工具變成無限耐久。
    expect(loaded!.player.inventory[0]).toEqual({ item: 'wooden_pickaxe', count: 1, dur: 59 });
  });

  it('a v5 record with a wrong slot count is padded or truncated', async () => {
    const base = makePayload();
    for (const [width, count] of [[3, 3], [40, 36]] as const) {
      await putRawRecord({
        ...base,
        player: {
          ...base.player,
          inventory: Array.from({ length: width }, (_, i) => ({
            item: 'stone' as const,
            count: i + 1,
          })),
        },
        stash: {
          survival: Array.from({ length: width }, (_, i) => ({
            item: 'dirt' as const,
            count: i + 1,
          })),
          creative: Array.from({ length: width }, (_, i) => ({
            item: 'sand' as const,
            count: i + 1,
          })),
          survivalVitals: createVitals(),
        },
      });
      const loaded = await loadGame();
      expect(loaded!.player.inventory).toHaveLength(INVENTORY_SLOTS);
      expect(loaded!.stash.survival).toHaveLength(INVENTORY_SLOTS);
      expect(loaded!.stash.creative).toHaveLength(INVENTORY_SLOTS);
      // 前 `count` 格保留、其餘補 null；超過 36 的截斷。
      expect(loaded!.player.inventory.slice(0, count)).toHaveLength(count);
      expect(loaded!.player.inventory.slice(count)).toEqual(
        new Array(INVENTORY_SLOTS - count).fill(null),
      );
    }
  });

  /**
   * B3 Task 7：附加欄位 `worldgenVersion` 的語意。
   *
   * 舊存檔（沒有這個鍵）必須照讀、照遷移，且**不得被自動補值**——補了就看不出
   * 是舊存檔、也永遠不會跳「地形已改變」提示。所以判準是「鍵不存在」，不是
   * 「鍵的值是 undefined」。
   */
  it('a record without worldgenVersion keeps the key absent', async () => {
    const noVersion = makePayload() as Partial<SavePayload>;
    delete noVersion.worldgenVersion;
    await putRawRecord(noVersion);
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    // 鍵不存在（不是塞 undefined 鍵）→ 舊存檔的判準
    expect('worldgenVersion' in loaded!).toBe(false);
  });

  it('a record with a non numeric worldgenVersion drops the key', async () => {
    const base = makePayload();
    // 附加欄位不放寬也不收緊 `isValidSavePayload` 的結構檢查 → 這個記錄照樣通過
    // 驗證並被讀出來，但非法值不得原樣帶回。
    expect(isValidSavePayload({ ...base, worldgenVersion: 'x' })).toBe(true);
    await putRawRecord({ ...base, worldgenVersion: 'x' });
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect('worldgenVersion' in loaded!).toBe(false);
  });

  it('a migrated v1 record has no worldgenVersion', async () => {
    const v1 = makeV1Payload();
    await putRawRecord(v1);
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    // v1 → v3 的遷移不得補上版本戳記（否則舊存檔看不出是舊存檔）
    expect('worldgenVersion' in loaded!).toBe(false);
  });

  it('a migrated v2 record has no worldgenVersion', async () => {
    const v2 = makeV2Payload();
    await putRawRecord(v2);
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    // v2 → v3 的遷移同樣不得補上版本戳記
    expect('worldgenVersion' in loaded!).toBe(false);
  });

  it('a record with an older worldgenVersion keeps its value', async () => {
    const base = makePayload();
    await putRawRecord({ ...base, worldgenVersion: 0 });
    const loaded = await loadGame();
    expect(loaded?.worldgenVersion).toBe(0);
    // 原樣保留（不得被改寫成當前版本——改了就看不出是舊生成器的存檔）
  });

  /** Vitals written before Task 1 have no `exhaustion` field — the load path
   *  must hand the live model the full shape instead of an undefined bank. */
  const legacyVitals = {
    hp: 17,
    maxHp: 20,
    hunger: 14,
    maxHunger: 20,
    saturation: 2.5,
    regenAcc: 1,
    starveAcc: 0,
  };

  it('loadGame defaults vitals missing exhaustion to 0 (live and stash)', async () => {
    const base = makePayload();
    await putRawRecord({
      ...base,
      player: { ...base.player, vitals: legacyVitals },
      stash: { ...base.stash, survivalVitals: legacyVitals },
    });
    const loaded = await loadGame();
    // the pre-existing fields survive the normalization untouched
    expect(loaded?.player.vitals).toEqual({ ...legacyVitals, exhaustion: 0 });
    // the stash's vitals get the same treatment (raw-stash path)
    expect(loaded?.stash.survivalVitals).toEqual({ ...legacyVitals, exhaustion: 0 });
  });

  it('migrates a v1 record whose vitals predate exhaustion (loads as 0)', async () => {
    const v1 = makeV1Payload();
    await putRawRecord({ ...v1, player: { ...v1.player, vitals: legacyVitals } });
    const loaded = await loadGame();
    expect(loaded?.version).toBe(5);
    expect(loaded?.player.vitals).toEqual({ ...legacyVitals, exhaustion: 0 });
    // the migrated stash's survival vitals carry the same normalized record
    expect(loaded?.stash.survivalVitals).toEqual({ ...legacyVitals, exhaustion: 0 });
  });

  it('loads a v5 payload with garbage advancements and sanitizes them', async () => {
    await putRawRecord({
      ...makePayload(),
      advancements: {
        done: { getting_wood: true, bogus: true, coal_miner: 'yes' },
        nightSeen: 'yes',
      },
    });
    const loaded = await loadGame();
    // garbage dropped, valid entries kept, base payload intact
    expect(loaded?.advancements).toEqual({ done: { getting_wood: true }, nightSeen: false });
    expect(loaded?.player.pos).toEqual([1.5, 64, -3.25]);
  });

  it('overwrites the previous save in the single slot', async () => {
    await saveGame(makePayload({ worldSeed: 1 }));
    await saveGame(makePayload({ worldSeed: 2 }));
    expect((await loadGame())?.worldSeed).toBe(2);
  });

  it('returns null when nothing has been saved (missing DB/record)', async () => {
    expect(await loadGame()).toBeNull();
  });

  it('returns null for a record with an unsupported version', async () => {
    await putRawRecord({ version: 6 });
    expect(await loadGame()).toBeNull();
  });

  it('returns null for a non-object record (corrupt data)', async () => {
    await putRawRecord('garbage-not-a-save');
    expect(await loadGame()).toBeNull();
  });

  it('returns null when the database version is unreadable', async () => {
    await createIncompatibleDb();
    expect(await loadGame()).toBeNull();
  });

  it('saveGame rejects when the database cannot be written', async () => {
    await createIncompatibleDb();
    await expect(saveGame(makePayload())).rejects.toBeDefined();
  });

  it('loadGame rejects shape-corrupt records (base validation, every version)', async () => {
    const base = makePayload();
    // player missing entirely — every supported version fails the base check
    await putRawRecord({ version: 1 });
    expect(await loadGame()).toBeNull();
    await putRawRecord({ version: 2 });
    expect(await loadGame()).toBeNull();
    await putRawRecord({ version: 3 });
    expect(await loadGame()).toBeNull();
    await putRawRecord({ version: 4 });
    expect(await loadGame()).toBeNull();
    await putRawRecord({ version: 5 });
    expect(await loadGame()).toBeNull();
    // non-finite pos coordinate
    await putRawRecord({ ...base, player: { ...base.player, pos: [1, Number.NaN, 3] } });
    expect(await loadGame()).toBeNull();
    // mode outside the allowed union
    await putRawRecord({ ...base, player: { ...base.player, mode: 'spectator' } });
    expect(await loadGame()).toBeNull();
    // non-finite yaw (would reach camera render state without throwing)
    await putRawRecord({ ...base, player: { ...base.player, yaw: Number.NaN } });
    expect(await loadGame()).toBeNull();
    // non-finite clock
    await putRawRecord({ ...base, time: { t: Number.NaN } });
    expect(await loadGame()).toBeNull();
    // a fully valid payload still passes (round trip)
    await saveGame(base);
    expect(await loadGame()).not.toBeNull();
  });
});

/**
 * B4 Task 10：被動生物的持久化 —— payload 只多一個附加欄位 `passiveMobs`
 *（B4 當時的本機版本號是 v3；B7 Task 2 起是 v5，這個欄位的語意一字不變）。
 *
 * **舊存檔缺欄位 ≠ 壞檔**：舊記錄沒有 `passiveMobs` → 載入得空陣列（＝沒有
 * 生物），不整包拒絕、不報錯。
 */
describe('B4 Task 10：被動生物跨存檔（本機 payload 的附加欄位）', () => {
  beforeEach(deleteSaveDb);

  it('a v5 record without passiveMobs loads with an empty list', async () => {
    const noMobs = makePayload() as Partial<SavePayload>;
    delete noMobs.passiveMobs;
    await putRawRecord(noMobs);
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    // 舊存檔 → 沒有生物（空陣列），**不是**「讀不到存檔」
    expect(loaded!.passiveMobs).toEqual([]);
  });

  it('passive mobs round-trip through IndexedDB', async () => {
    await saveGame(
      makePayload({
        passiveMobs: [
          { kind: 'cow', x: 1.5, y: 64, z: -3.25, hp: 7, yaw: 0.5 },
          { kind: 'chicken', x: 8.25, y: 65, z: 2, hp: 4, yaw: 1.5 },
        ],
      }),
    );
    const loaded = await loadGame();
    expect(loaded?.passiveMobs).toHaveLength(2);
    expect(loaded?.passiveMobs?.[0]).toEqual({
      kind: 'cow',
      x: 1.5,
      y: 64,
      z: -3.25,
      hp: 7,
      yaw: 0.5,
    });
    expect(loaded?.passiveMobs?.[1]?.kind).toBe('chicken');
  });

  it('a corrupt passive list does not invalidate the whole save', async () => {
    for (const junk of ['nope', 42, { kind: 'cow' }, [null, 7]]) {
      await putRawRecord({ ...makePayload(), passiveMobs: junk });
      const loaded = await loadGame();
      expect(loaded).not.toBeNull();
      expect(loaded?.passiveMobs).toEqual([]);
      // 其餘欄位照樣有效（玩家位置、背包都在）
      expect(loaded?.player.pos).toEqual([1.5, 64, -3.25]);
      expect(loaded?.player.inventory).toEqual(
        slots(
          { item: 'stone', count: 32 },
          null,
          { item: 'wooden_pickaxe', count: 1, dur: 59 },
        ),
      );
    }
  });

  it('a record with a corrupt passive entry keeps the valid ones', async () => {
    await putRawRecord({
      ...makePayload(),
      passiveMobs: [
        { kind: 'cow', x: 1, y: 2, z: 3, hp: 10, yaw: 0 },
        { kind: 'dragon', x: 1, y: 2, z: 3, hp: 10, yaw: 0 },
        { kind: 'pig', x: Number.NaN, y: 2, z: 3, hp: 10, yaw: 0 },
      ],
    });
    const loaded = await loadGame();
    expect(loaded?.passiveMobs).toHaveLength(1);
    expect(loaded?.passiveMobs?.[0]?.kind).toBe('cow');
  });

  it('isValidSavePayload does not care about the passive list (normalization owns it)', () => {
    // 基本結構檢查**不**收緊這個附加欄位（與 `stash`／`advancements` 同款）
    const base = makePayload();
    expect(isValidSavePayload({ ...base, passiveMobs: 'nope' })).toBe(true);
    expect(isValidSavePayload({ ...base, passiveMobs: undefined })).toBe(true);
  });
});

/** Task 14 review #2: IndexedDB records can be written by an older/broken
 *  build — loadGame must validate the SHAPE before handing a payload to
 *  continueGame, which trusts it (destructure, setBlock, DOM writes). */
describe('isValidSavePayload', () => {
  it('accepts a fully valid payload (v1–v5 all pass base validation)', () => {
    expect(isValidSavePayload(makePayload())).toBe(true); // v5 — the current shape
    expect(
      isValidSavePayload(makePayload({ player: { ...makePayload().player, vitals: null } })),
    ).toBe(true);
    expect(isValidSavePayload(makeV1Payload())).toBe(true); // migration input
    expect(isValidSavePayload(makeV2Payload())).toBe(true); // migration input
    expect(isValidSavePayload(makeV3Payload())).toBe(true); // migration input
    expect(isValidSavePayload(makeV4Payload())).toBe(true); // migration input
  });

  it('rejects non-objects, wrong version and a missing player', () => {
    expect(isValidSavePayload(null)).toBe(false);
    expect(isValidSavePayload('garbage')).toBe(false);
    expect(isValidSavePayload(42)).toBe(false);
    expect(isValidSavePayload({ ...makePayload(), version: 6 })).toBe(false);
    expect(isValidSavePayload({ version: 1 })).toBe(false); // player missing
  });

  it('rejects malformed player.pos (wrong length or non-finite)', () => {
    const base = makePayload();
    expect(
      isValidSavePayload({ ...base, player: { ...base.player, pos: [1, Number.NaN, 3] } }),
    ).toBe(false);
    expect(
      isValidSavePayload({ ...base, player: { ...base.player, pos: [1, 2] } }),
    ).toBe(false);
    expect(
      isValidSavePayload({ ...base, player: { ...base.player, pos: '1,2,3' as never } }),
    ).toBe(false);
  });

  it('rejects a non-finite yaw (unguarded NaN path into the camera)', () => {
    const base = makePayload();
    expect(
      isValidSavePayload({ ...base, player: { ...base.player, yaw: Number.NaN } }),
    ).toBe(false);
    expect(
      isValidSavePayload({ ...base, player: { ...base.player, yaw: Infinity } }),
    ).toBe(false);
    expect(
      isValidSavePayload({ ...base, player: { ...base.player, yaw: '0.5' as never } }),
    ).toBe(false);
  });

  it('rejects a mode outside {survival, creative} and a malformed inventory', () => {
    const base = makePayload();
    expect(
      isValidSavePayload({ ...base, player: { ...base.player, mode: 'spectator' as never } }),
    ).toBe(false);
    expect(
      isValidSavePayload({ ...base, player: { ...base.player, inventory: 'nope' as never } }),
    ).toBe(false);
    expect(
      isValidSavePayload({
        ...base,
        player: { ...base.player, inventory: [{ item: 7, count: 1 } as never] },
      }),
    ).toBe(false);
    expect(
      isValidSavePayload({
        ...base,
        player: { ...base.player, inventory: [{ item: 'stone', count: Number.NaN }] },
      }),
    ).toBe(false);
    expect(
      isValidSavePayload({ ...base, player: { ...base.player, inventory: ['junk' as never] } }),
    ).toBe(false);
  });

  it('rejects a malformed vitals, modified and clock', () => {
    const base = makePayload();
    expect(
      isValidSavePayload({
        ...base,
        player: { ...base.player, vitals: { ...createVitals(), hp: Number.NaN } },
      }),
    ).toBe(false);
    expect(isValidSavePayload({ ...base, player: { ...base.player, vitals: undefined } })).toBe(
      false,
    );
    expect(isValidSavePayload({ ...base, modified: 'nope' as never })).toBe(false);
    expect(isValidSavePayload({ ...base, time: { t: Number.NaN } })).toBe(false);
    expect(isValidSavePayload({ ...base, time: {} as never })).toBe(false);
  });
});

/** Task 14: payload assembly from live game state — a PURE function so the
 *  composition root (main.ts) stays thin and this logic is testable without
 *  touching IndexedDB or the DOM. */
describe('collectSavePayload', () => {
  const world = {
    seed: 4242,
    serializeModified: (): Array<[string, number]> => [
      ['5,70,5', 1], // placed stone
      ['6,70,6', 0], // mined to air
    ],
  };

  it('assembles version, seed, modified, clock, advancements and stash from the sources', () => {
    const advancements = {
      done: { getting_wood: true },
      nightSeen: true,
    };
    const payload = collectSavePayload({
      world,
      player: { pos: [1.5, 64, -3.25], yaw: 0.75, mode: 'survival', inventory: [] },
      vitals: null,
      clockT: 0.42,
      advancements,
      stash: createModeStash(),
      // B4 Task 10：`SaveSources.passiveMobs` 是**必填**欄位（沒有生物也要
      // 明寫空陣列）→ 少了它 typecheck 直接紅。
      passiveMobs: [],
      savedAt: 123,
    });
    expect(payload.version).toBe(5);
    // 三個槽位陣列一律 36 格（空的來源也會補滿 null）。
    expect(payload.player.inventory).toHaveLength(INVENTORY_SLOTS);
    expect(payload.stash.survival).toHaveLength(INVENTORY_SLOTS);
    expect(payload.stash.creative).toHaveLength(INVENTORY_SLOTS);
    expect(payload.worldSeed).toBe(4242);
    expect(payload.modified).toEqual([
      ['5,70,5', 1],
      ['6,70,6', 0],
    ]);
    expect(payload.time).toEqual({ t: 0.42 });
    expect(payload.advancements).toEqual(advancements);
    expect(payload.stash).toEqual(createModeStash()); // the other mode's state travels too
    expect(payload.savedAt).toBe(123);
  });

  /** B3 Task 7：新存的 payload 一律蓋上「當前」的世界生成版本戳記——只有存檔
   *  寫入端才會補值，讀取端不會（讀取端只原樣保留記錄上的值）。 */
  it('collectSavePayload stamps the current worldgen version', () => {
    const payload = collectSavePayload({
      world,
      player: { pos: [0, 64, 0], yaw: 0, mode: 'survival', inventory: [] },
      vitals: null,
      clockT: 0,
      advancements: emptyAdvancements(),
      stash: createModeStash(),
      // B4 Task 10：`SaveSources.passiveMobs` 是**必填**欄位（沒有生物也要
      // 明寫空陣列）→ 少了它 typecheck 直接紅。
      passiveMobs: [],
      savedAt: 0,
    });
    expect(payload.worldgenVersion).toBe(WORLDGEN_VERSION);
  });

  /** B4 Task 10：被動生物的持久化記錄進 payload（種類／座標／血量／朝向）。 */
  it('collectSavePayload copies the passive mobs', () => {
    const cow = { ...createPassiveMob('cow', { x: 1, y: 2, z: 3 }), hp: 7, yaw: 0.5 };
    const payload = collectSavePayload({
      world,
      player: { pos: [0, 64, 0], yaw: 0, mode: 'survival', inventory: [] },
      vitals: null,
      clockT: 0,
      advancements: emptyAdvancements(),
      stash: createModeStash(),
      passiveMobs: [cow],
      savedAt: 0,
    });
    expect(payload.passiveMobs).toEqual([{ kind: 'cow', x: 1, y: 2, z: 3, hp: 7, yaw: 0.5 }]);
    // 深拷貝 → 改 payload 不得影響場上的生物
    payload.passiveMobs![0].hp = 1;
    expect(cow.hp).toBe(7);
  });

  /** B7 Task 2：耐久（`ItemStack.dur`）是**玩家財產**→ 必須進 payload。
   *  寫出端走 `sanitizeSlots`（清洗器保證耐久物品帶明確 `dur`）→ 這裡釘住
   *  「受損的工具原樣寫出」（不是補成滿耐久）。 */
  it('collectSavePayload carries the durability of every tool', () => {
    const payload = collectSavePayload({
      world,
      player: {
        pos: [0, 0, 0],
        yaw: 0,
        mode: 'survival',
        inventory: [{ item: 'diamond_sword', count: 1, dur: 900 }],
      },
      vitals: null,
      clockT: 0,
      advancements: emptyAdvancements(),
      stash: createModeStash(),
      // B4 Task 10：`SaveSources.passiveMobs` 是**必填**欄位（沒有生物也要
      // 明寫空陣列）→ 少了它 typecheck 直接紅。
      passiveMobs: [],
      savedAt: 0,
    });
    expect(payload.player.inventory[0]).toEqual({ item: 'diamond_sword', count: 1, dur: 900 });
  });

  it('copies the player sub-object and advancements — no aliasing', () => {
    const pos: [number, number, number] = [1, 2, 3];
    const stack: ItemStack = { item: 'stone', count: 32 };
    const inventory: Array<ItemStack | null> = [stack, null];
    const vitals = createVitals();
    const advancements = {
      done: { getting_wood: true },
      nightSeen: false,
    };
    const payload = collectSavePayload({
      world,
      player: { pos, yaw: -1.25, mode: 'survival', inventory },
      vitals,
      clockT: 0,
      advancements,
      stash: createModeStash(),
      // B4 Task 10：`SaveSources.passiveMobs` 是**必填**欄位（沒有生物也要
      // 明寫空陣列）→ 少了它 typecheck 直接紅。
      passiveMobs: [],
      savedAt: 0,
    });
    // fresh pos array — mutating the source must not touch the payload
    expect(payload.player.pos).toEqual([1, 2, 3]);
    expect(payload.player.pos).not.toBe(pos);
    pos[0] = 99;
    expect(payload.player.pos[0]).toBe(1);
    // fresh stack objects — mutating the source stack must not touch the payload
    expect(payload.player.inventory[0]).toEqual({ item: 'stone', count: 32 });
    expect(payload.player.inventory[0]).not.toBe(stack);
    stack.count = 1;
    expect(payload.player.inventory[0]?.count).toBe(32);
    expect(payload.player.inventory[1]).toBeNull(); // null slots stay null
    // fresh vitals copy
    expect(payload.player.vitals).toEqual(vitals);
    expect(payload.player.vitals).not.toBe(vitals);
    expect(payload.player.yaw).toBe(-1.25);
    expect(payload.player.mode).toBe('survival');
    // fresh advancements copy — mutating the source must not touch the payload
    expect(payload.advancements).toEqual({ done: { getting_wood: true }, nightSeen: false });
    expect(payload.advancements.done).not.toBe(advancements.done);
    advancements.done.getting_wood = false;
    advancements.nightSeen = true;
    expect(payload.advancements.done.getting_wood).toBe(true);
    expect(payload.advancements.nightSeen).toBe(false);
  });

  it('carries null vitals (creative) and defaults savedAt to now when omitted', () => {
    const before = Date.now();
    const payload = collectSavePayload({
      world,
      player: { pos: [0, 0, 0], yaw: 0, mode: 'creative', inventory: [] },
      vitals: null,
      clockT: 0.1,
      advancements: emptyAdvancements(),
      stash: createModeStash(),
      // B4 Task 10：`SaveSources.passiveMobs` 是**必填**欄位（沒有生物也要
      // 明寫空陣列）→ 少了它 typecheck 直接紅。
      passiveMobs: [],
    });
    const after = Date.now();
    expect(payload.player.mode).toBe('creative');
    expect(payload.player.vitals).toBeNull();
    // default savedAt = Date.now() (saveGame overwrites it anyway — documented)
    expect(payload.savedAt).toBeGreaterThanOrEqual(before);
    expect(payload.savedAt).toBeLessThanOrEqual(after);
  });

  it('collectSavePayload deep-copies the stash (no aliasing)', () => {
    const survivalStack: ItemStack = { item: 'dirt', count: 3 };
    const creativeStack: ItemStack = { item: 'stone', count: 64 };
    const survivalVitals = { ...createVitals(), hp: 9 };
    const stash: ModeStash = {
      survival: slots(survivalStack),
      creative: slots(creativeStack),
      survivalVitals,
    };
    const payload = collectSavePayload({
      world,
      player: { pos: [0, 0, 0], yaw: 0, mode: 'survival', inventory: [] },
      vitals: null,
      clockT: 0,
      advancements: emptyAdvancements(),
      stash,
      // B4 Task 10：同上——必填的來源欄位。
      passiveMobs: [],
      savedAt: 0,
    });
    // fresh arrays, stacks and vitals — never the live objects
    expect(payload.stash.survival).not.toBe(stash.survival);
    expect(payload.stash.creative).not.toBe(stash.creative);
    expect(payload.stash.survival[0]).toEqual({ item: 'dirt', count: 3 });
    expect(payload.stash.survival[0]).not.toBe(survivalStack);
    expect(payload.stash.creative[0]).not.toBe(creativeStack);
    expect(payload.stash.survivalVitals).not.toBe(survivalVitals);

    // mutating the live stash afterwards must not touch the captured payload
    survivalStack.count = 99;
    creativeStack.count = 1;
    stash.survival[1] = { item: 'sand', count: 1 };
    stash.survivalVitals.hp = 1;
    expect(payload.stash.survival[0]?.count).toBe(3);
    expect(payload.stash.creative[0]?.count).toBe(64);
    expect(payload.stash.survival[1]).toBeNull();
    expect(payload.stash.survivalVitals.hp).toBe(9);
  });
});

// ── B6 Task 8：存檔相容性紅線 ────────────────────────────────────────────────
//
// 公約 §3／計畫 Global Constraints 的紅線（本 describe 逐條釘住）：
// - 本機 payload 的版本由寫出端釘住（B6 時是 v4；B7 Task 2 起是 v5——火把這條
//   紅線本身與版本號無關）。`collectSavePayload` 測試已釘 `version === 5`；
//   下面的往返測試再釘一次，讓「光照不入存檔」與「版本號」在同一處可讀。
// - 光照是**導出資料**：不入本機 payload、不入雲端 payload → 火把只走既有的
//   `modified` overlay（數字 block id 32——「同一格式內的新 block id」，
//   **不是**格式升版；B6 當時雲端維持 format 2、`game.json` 一字不動）。
// - 舊版（0.8.0）讀到 id 32 時走 `getBlockDef` 的 `DEFS[id] ?? DEFS[0]`
//   fallback → 火把顯示成空氣、**不崩**（發布說明〈存檔格式與相容性提示〉
//   的依據，見計畫 §8）。
describe('B6 Task 8: light never enters the save, torch rides the modified overlay', () => {
  /** `SaveSources.world` 是結構型別（seed ＋ serializeModified）→ 真實 World
   *  用薄轉接器接上（與 main.ts 的接法同構）。 */
  const sourcesOf = (world: World) => ({
    world: { seed: 4242, serializeModified: () => world.serializeModified() },
    player: {
      pos: [0.5, 70, 0.5] as [number, number, number],
      yaw: 0,
      mode: 'survival' as const,
      inventory: [] as Array<ItemStack | null>,
    },
    vitals: null,
    clockT: 0,
    advancements: emptyAdvancements(),
    stash: createModeStash(),
    passiveMobs: [],
    savedAt: 0,
  });

  it('a torch survives a save and load round trip', () => {
    const world = new World();
    world.setBlock(3, 70, 4, BLOCK.TORCH); // modified overlay 記 id 32
    const payload = collectSavePayload(sourcesOf(world));
    // 紅線：火把＝「同一格式內的新 block id」——數字 32 原樣進 `modified`，
    // 加的是一個 block id（不是為了火把升版；B7 Task 2 的 v5 是為了 `dur`）。
    expect(BLOCK.TORCH).toBe(32);
    expect(payload.modified).toContainEqual(['3,70,4', BLOCK.TORCH]);
    expect(payload.version).toBe(5);
    // 載入路徑：全新世界 applyModified（內部逐筆走 setBlock）→ 火把還在
    const restored = new World();
    restored.applyModified(payload.modified);
    expect(restored.getBlock(3, 70, 4)).toBe(BLOCK.TORCH);
  });

  it('the light is never written to the save payload', () => {
    const world = new World();
    world.setBlock(3, 70, 4, BLOCK.TORCH);
    // 先真的把光算出來（chunk.light 已配置且含非零值）——釘的是「即使光照
    // 資料存在，payload 也不帶任何光照欄位」，不是「沒有光所以當然沒有鍵」。
    computeChunkLight(world, 0, 0);
    expect(world.getChunk(0, 0)!.light).not.toBeNull();
    expect(blockLightAt(world, 3, 70, 4)).toBe(14);
    const payload = collectSavePayload(sourcesOf(world));
    const json = JSON.stringify(payload).toLowerCase();
    // brief：不包含 light／skyLight／blockLight 任何子字串（大小寫不拘）
    expect(json).not.toContain('light');
    expect(json).not.toContain('skylight');
    expect(json).not.toContain('blocklight');
    // payload 不是空殼：火把確實在 modified overlay 裡（斷言有意義的前提）
    expect(payload.modified).toContainEqual(['3,70,4', BLOCK.TORCH]);
  });

  it('an unknown block id falls back to air (old builds read new saves without crashing)', () => {
    // 紅線的機制面：0.8.0 沒有 id 32 的定義 → `getBlockDef(32)` 落到
    // `DEFS[0]`（空氣）——顯示成空氣但不丟例外。把 fallback 本身釘住：
    // 之後任何人改 `getBlockDef` 都不得弄掉「未知 id 不崩」這條。
    expect(getBlockDef(BLOCK.TORCH).id).toBe(32); // 新版認得火把
    expect(getBlockDef(999).id).toBe(0); // 舊版視角：未知 id → 空氣
    expect(getBlockDef(999).solid).toBe(false);
    expect(getBlockDef(999).transparent).toBe(true);
  });
});
