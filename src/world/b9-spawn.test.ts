import { describe, it, expect } from 'vitest';
import { BLOCK } from './blocks';
import { MAX_MOBS, SPAWN_MAX_DIST, SPAWN_MIN_DIST, xzDistance } from './mobs';
import {
  HOSTILE_SPAWN_WEIGHTS,
  MAX_CREEPERS,
  chooseHostileKind,
  trySpawnHostile,
  type HostileSpawn,
  type HostileSpawnCtx,
} from './b9-spawn';
import type { SpawnLight } from './spawn-rules';

// ---- helpers -------------------------------------------------------------
/** 依序回傳陣列值的 rng；用完後重複最後一個值。
 *  `trySpawnHostile` 的 rng 消耗順序（固定）：① findSpawnPos 2 次（角度、距離）
 *  ② chooseHostileKind 1 次 ③ 重抽時每次 1 次（最多 4 次）→ 想控制種類就用
 *  `seq([角度, 距離, 種類])`。 */
const seq = (values: number[]): (() => number) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};

/** 午夜地表＋平坦草地（y ≤ 5 實心，地表 y = 6）——Task 7 全部測試共用。 */
const surface = (_x: number, y: number, _z: number): boolean => y <= 5;
const midnight = (): SpawnLight => ({ sky: 15, internalSky: 4, block: 0, lit: true });

const ctxOf = (over: Partial<HostileSpawnCtx> = {}): HostileSpawnCtx => ({
  lightAt: midnight,
  isSolidAt: surface,
  blockIdAt: () => BLOCK.GRASS,
  rng: () => 0.5, // 角度 π、距離 76 → spot ≈ (0, -76)
  ...over,
});

const player = { x: 0, y: 64, z: 0 };

/** 取得生成的實體座標（三種 payload 只有一個非 null）。 */
const posOf = (s: HostileSpawn): { x: number; y: number; z: number } =>
  s.creeper?.pos ?? s.spider?.pos ?? s.mob!.pos;

describe('b9 hostile spawner (B9 Task 7)', () => {
  it('the spawn weights are the vanilla ones', () => {
    // 原版：四種敵對的生成權重都是 100（⇒ 各 25%）。
    expect(HOSTILE_SPAWN_WEIGHTS).toEqual({
      zombie: 100,
      skeleton: 100,
      creeper: 100,
      spider: 100,
    });
    expect(MAX_CREEPERS).toBe(4); // 本作自訂的苦力怕子上限
  });

  it('every hostile kind is equally likely', () => {
    // 累積權重的鍵序＝權重表的鍵序：zombie → skeleton → creeper → spider。
    expect(chooseHostileKind(() => 0.1)).toBe('zombie');
    expect(chooseHostileKind(() => 0.4)).toBe('skeleton');
    expect(chooseHostileKind(() => 0.6)).toBe('creeper');
    expect(chooseHostileKind(() => 0.9)).toBe('spider');
    // 統計：400 次等距抽樣 → 四種各 100（明確容差 80–120）
    const counts: Record<string, number> = { zombie: 0, skeleton: 0, creeper: 0, spider: 0 };
    let i = 0;
    const rng = (): number => i++ / 400;
    for (let n = 0; n < 400; n++) counts[chooseHostileKind(rng)]++;
    for (const kind of ['zombie', 'skeleton', 'creeper', 'spider']) {
      expect(counts[kind]).toBeGreaterThanOrEqual(80);
      expect(counts[kind]).toBeLessThanOrEqual(120);
    }
  });

  it('a hostile mob does not spawn in daylight', () => {
    const ctx = ctxOf({
      lightAt: () => ({ sky: 15, internalSky: 15, block: 0, lit: true }),
    });
    expect(trySpawnHostile({ mobs: 0, creepers: 0, spiders: 0 }, player, ctx)).toBeNull();
  });

  it('a hostile mob spawns in the dark', () => {
    const res = trySpawnHostile({ mobs: 0, creepers: 0, spiders: 0 }, player, ctxOf());
    expect(res).not.toBeNull();
  });

  it('a torch beside the spawn point blocks the spawn', () => {
    const ctx = ctxOf({
      lightAt: () => ({ sky: 15, internalSky: 4, block: 1, lit: true }),
    });
    expect(trySpawnHostile({ mobs: 0, creepers: 0, spiders: 0 }, player, ctx)).toBeNull();
  });

  it('the global hostile cap is twelve', () => {
    expect(trySpawnHostile({ mobs: MAX_MOBS, creepers: 0, spiders: 0 }, player, ctxOf())).toBeNull();
    expect(
      trySpawnHostile({ mobs: MAX_MOBS - 1, creepers: 0, spiders: 0 }, player, ctxOf()),
    ).not.toBeNull();
    // 計數是「三條清單的總和」：苦力怕／蜘蛛也佔名額
    expect(trySpawnHostile({ mobs: 0, creepers: MAX_MOBS, spiders: 0 }, player, ctxOf())).toBeNull();
    expect(
      trySpawnHostile({ mobs: 0, creepers: 0, spiders: MAX_MOBS }, player, ctxOf()),
    ).toBeNull();
  });

  it('the creeper sub cap is four', () => {
    // rng 恆 0.6 → 種類每次都抽到 creeper → 重抽 4 次後放棄（回 null）。
    const ctx = ctxOf({ rng: () => 0.6 });
    const result = trySpawnHostile({ mobs: 0, creepers: MAX_CREEPERS, spiders: 0 }, player, ctx);
    // 兩種合法結果：整次跳過（null），或抽到別種（非 creeper）→ 絕不再生成苦力怕
    expect(result === null || result.creeper === null).toBe(true);
    if (result !== null) expect(result.kind).not.toBe('creeper');
  });

  it('a spawned hostile is 24 to 128 blocks from the player', () => {
    for (let i = 0; i < 30; i++) {
      const ctx = ctxOf({ rng: () => (i + 0.5) / 30 });
      const res = trySpawnHostile({ mobs: 0, creepers: 0, spiders: 0 }, player, ctx);
      expect(res).not.toBeNull();
      const dist = xzDistance(posOf(res!), player);
      expect(dist).toBeGreaterThanOrEqual(SPAWN_MIN_DIST);
      expect(dist).toBeLessThanOrEqual(SPAWN_MAX_DIST);
    }
  });

  it('the spawned kind matches the returned payload', () => {
    // 角度 0.1、距離 0.5、種類 0.6 → creeper
    const res = trySpawnHostile(
      { mobs: 0, creepers: 0, spiders: 0 },
      player,
      ctxOf({ rng: seq([0.1, 0.5, 0.6]) }),
    );
    expect(res).not.toBeNull();
    expect(res!.kind).toBe('creeper');
    expect(res!.creeper).not.toBeNull();
    expect(res!.mob).toBeNull();
    expect(res!.spider).toBeNull();
    // 另外三種的 payload 也要對得上（種類 0.1／0.4／0.9）
    const kindAt = (kindRng: number): HostileSpawn =>
      trySpawnHostile(
        { mobs: 0, creepers: 0, spiders: 0 },
        player,
        ctxOf({ rng: seq([0.1, 0.5, kindRng]) }),
      )!;
    const z = kindAt(0.1);
    expect([z.kind, z.mob?.kind, z.creeper, z.spider]).toEqual(['zombie', 'zombie', null, null]);
    const sk = kindAt(0.4);
    expect([sk.kind, sk.mob?.kind, sk.creeper, sk.spider]).toEqual([
      'skeleton',
      'skeleton',
      null,
      null,
    ]);
    const sp = kindAt(0.9);
    expect([sp.kind, sp.mob, sp.creeper, sp.spider !== null]).toEqual([
      'spider',
      null,
      null,
      true,
    ]);
  });

  it('a hostile spawns on a solid surface', () => {
    const res = trySpawnHostile({ mobs: 0, creepers: 0, spiders: 0 }, player, ctxOf());
    expect(res).not.toBeNull();
    expect(posOf(res!).y).toBe(6); // 地表 y = 5 → 站在 6
  });

  it('bedrock-only and ungenerated columns are skipped', () => {
    expect(
      trySpawnHostile(
        { mobs: 0, creepers: 0, spiders: 0 },
        player,
        ctxOf({ blockIdAt: () => BLOCK.BEDROCK }),
      ),
    ).toBeNull();
    expect(
      trySpawnHostile(
        { mobs: 0, creepers: 0, spiders: 0 },
        player,
        ctxOf({ isSolidAt: () => false, blockIdAt: () => BLOCK.AIR }),
      ),
    ).toBeNull();
  });
});
