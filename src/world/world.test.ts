import { describe, it, expect } from 'vitest';
import { Chunk, chunkIndex } from './chunk';
import { World } from './world';
import { BLOCK } from './blocks';

describe('chunkIndex', () => {
  it('maps coords deterministically', () => {
    expect(chunkIndex(0, 0, 0)).toBe(0);
    expect(chunkIndex(1, 0, 0)).toBe(1);
    expect(chunkIndex(0, 1, 0)).toBe(256);
    expect(chunkIndex(0, 0, 1)).toBe(16);
    expect(chunkIndex(15, 255, 15)).toBe(16 * 16 * 256 - 1);
  });
});

describe('Chunk', () => {
  it('get/set roundtrip', () => {
    const c = new Chunk(0, 0);
    c.set(3, 64, 5, BLOCK.STONE);
    expect(c.get(3, 64, 5)).toBe(BLOCK.STONE);
  });

  it('out of range y returns air', () => {
    const c = new Chunk(0, 0);
    expect(c.get(0, 256, 0)).toBe(BLOCK.AIR);
    expect(c.get(0, -1, 0)).toBe(BLOCK.AIR);
  });
});

describe('World', () => {
  it('setBlock marks chunk dirty', () => {
    const w = new World();
    w.setBlock(5, 70, 5, BLOCK.STONE);
    expect(w.getChunk(0, 0)?.dirty).toBe(true);
    expect(w.getBlock(5, 70, 5)).toBe(BLOCK.STONE);
    w.setBlock(5, 70, 5, BLOCK.DIRT);
    expect(w.getBlock(5, 70, 5)).toBe(BLOCK.DIRT);
  });

  it('getBlock outside loaded chunks is air', () => {
    const w = new World();
    expect(w.getBlock(1000, 64, 1000)).toBe(BLOCK.AIR);
  });

  it('crossing chunk boundary works', () => {
    const w = new World();
    w.setBlock(16, 64, 0, BLOCK.STONE);
    expect(w.getChunk(1, 0)?.get(0, 64, 0)).toBe(BLOCK.STONE);
    expect(w.getBlock(16, 64, 0)).toBe(BLOCK.STONE);
  });

  it('setBlock on y out of range is ignored', () => {
    const w = new World();
    expect(w.setBlock(0, 300, 0, BLOCK.STONE)).toBe(false);
    expect(w.getChunk(0, 0)).toBeUndefined();
  });

  it('edge setBlock dirties neighbor chunk', () => {
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    w.addChunk(new Chunk(1, 0));
    w.getChunk(1, 0)!.dirty = false;
    w.setBlock(15, 64, 0, BLOCK.STONE);
    expect(w.getChunk(1, 0)!.dirty).toBe(true);
  });

  it('negative world coords roundtrip into correct chunk', () => {
    const w = new World();
    expect(w.setBlock(-1, 64, -1, BLOCK.STONE)).toBe(true);
    expect(w.getBlock(-1, 64, -1)).toBe(BLOCK.STONE);
    expect(w.getChunk(-1, -1)).toBeDefined();
    expect(w.setBlock(-17, 64, -1, BLOCK.STONE)).toBe(true);
    expect(w.getChunk(-2, -1)).toBeDefined();
    expect(w.getBlock(-17, 64, -1)).toBe(BLOCK.STONE);
  });

  it('dirties only touched neighbors on edges, none in interior', () => {
    const w = new World();
    const coords = [
      [-1, 0],
      [0, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const;
    for (const [cx, cz] of coords) w.addChunk(new Chunk(cx, cz));
    const reset = () => {
      for (const [cx, cz] of coords) w.getChunk(cx, cz)!.dirty = false;
    };
    const dirtied = () =>
      coords.map(([cx, cz]) => w.getChunk(cx, cz)!.dirty);

    reset();
    w.setBlock(0, 64, 0, BLOCK.STONE);
    expect(dirtied()).toEqual([true, true, false, true, false]);

    reset();
    w.setBlock(15, 64, 0, BLOCK.STONE);
    expect(dirtied()).toEqual([false, true, true, true, false]);

    reset();
    w.setBlock(0, 64, 15, BLOCK.STONE);
    expect(dirtied()).toEqual([true, true, false, false, true]);

    reset();
    w.setBlock(5, 64, 5, BLOCK.STONE);
    expect(dirtied()).toEqual([false, true, false, false, false]);
  });

  it('successful setBlock records block in modified map', () => {
    const w = new World();
    w.setBlock(5, 70, 5, BLOCK.STONE);
    expect(w.modified.get('5,70,5')).toBe(BLOCK.STONE);
  });

  it('setBlock returns true on success', () => {
    const w = new World();
    expect(w.setBlock(5, 70, 5, BLOCK.STONE)).toBe(true);
    expect(w.setBlock(0, 0, 0, BLOCK.DIRT)).toBe(true);
  });
});

/** B6 T1b（B4 分診①收口）：`World.getBlock`／`setBlock` 的座標契約——
 *  x/y/z 一律 `Math.floor` 到整數格，呼叫端可以直接傳玩家／實體的浮點
 *  位置，讀寫落在該點所在的格。這是世界層**唯一的**取整點（`Chunk.get`／
 *  `Chunk.set` 仍假設整數；保證由世界層提供）。負座標必測：floor 向 −∞
 *  取整，與 trunc 在分數負座標上分道（-2.1 → -3，不是 -2）。 */
describe('World 座標契約（B6 T1b：getBlock/setBlock 一律 Math.floor）', () => {
  it('正座標分數：讀寫落在該點所在的格', () => {
    const w = new World();
    expect(w.setBlock(3, 64, 5, BLOCK.STONE)).toBe(true);
    expect(w.getBlock(3.7, 64, 5.9)).toBe(BLOCK.STONE); // floor → (3,64,5)
    // modified 鍵必須是取整後的整數座標（存檔 applyModified 只收整數鍵）
    expect(w.modified.get('3,64,5')).toBe(BLOCK.STONE);
    expect(w.modified.has('3.7,64,5.9')).toBe(false);
  });

  it('負座標分數：floor 向 −∞，落在正確的格（-2.1→-3、-4.2→-5）', () => {
    const w = new World();
    expect(w.setBlock(-3, 64, -5, BLOCK.STONE)).toBe(true);
    expect(w.getBlock(-2.1, 64, -4.2)).toBe(BLOCK.STONE);
    expect(w.getBlock(-3, 64, -5)).toBe(BLOCK.STONE);
    expect(w.modified.get('-3,64,-5')).toBe(BLOCK.STONE);
  });

  it('分數 y：讀寫同樣 floor；topY／modified 以整數記錄', () => {
    const w = new World();
    expect(w.setBlock(3, 64, 5, BLOCK.STONE)).toBe(true);
    expect(w.getBlock(3, 64.9, 5)).toBe(w.getBlock(3, 64, 5)); // 讀：分數 y → 同格
    expect(w.setBlock(3, 64.9, 5, BLOCK.DIRT)).toBe(true); // 寫：floor(64.9)=64
    expect(w.getBlock(3, 64, 5)).toBe(BLOCK.DIRT);
    expect(w.modified.get('3,64,5')).toBe(BLOCK.DIRT);
    // B4 債務收口：topY 的 y+1 以 floor 後的整數 y 計算（65，不是 65.9）
    expect(w.getChunk(0, 0)!.topY).toBe(65);
  });

  it('區塊邊界：15.9 讀本區塊 (15,15)；16.1 落鄰區塊 (0,0)', () => {
    const w = new World();
    w.setBlock(15, 64, 15, BLOCK.STONE);
    w.setBlock(16, 64, 0, BLOCK.STONE);
    expect(w.getBlock(15.9, 64, 15.9)).toBe(BLOCK.STONE);
    expect(w.getBlock(16.1, 64, 0.9)).toBe(BLOCK.STONE); // floor(16.1)=16 → chunk (1,0) local (0,0)
  });

  it('既有行為不變：y 越界（含 floor 後越界的分數）→ AIR/false；未載入區塊 → AIR', () => {
    const w = new World();
    // 整數越界（契約在 floor 之後檢查，行為與既有測試一致）
    expect(w.setBlock(0, 300, 0, BLOCK.STONE)).toBe(false);
    expect(w.getBlock(0, -1, 0)).toBe(BLOCK.AIR);
    // 分數 floor 後越界：floor(-0.5)=-1、floor(256.5)=256
    expect(w.getBlock(3, -0.5, 5)).toBe(BLOCK.AIR);
    expect(w.getBlock(3, 256.5, 5)).toBe(BLOCK.AIR);
    expect(w.setBlock(3, -0.5, 5, BLOCK.STONE)).toBe(false);
    expect(w.setBlock(3, 256.5, 5, BLOCK.STONE)).toBe(false);
    expect(w.getChunk(0, 0)).toBeUndefined(); // 越界寫入不建區塊
    // 未載入區塊 → AIR（分數座標同理）
    expect(w.getBlock(1000.5, 64, 1000.5)).toBe(BLOCK.AIR);
  });
});

/** B3 Task 5：`isTargetable` ＝「可被瞄準／挖掘命中」＝實心方塊 ＋ cross 植被。
 *  水與空氣不可命中；植被不碰撞但必須能被挖掉（見 `blocks.ts` 的 `isTargetable`）。 */
describe('World.isTargetable (B3 Task 5)', () => {
  it('solid blocks and cross plants are targetable; air and water are not', () => {
    const w = new World();
    w.setBlock(5, 64, 5, BLOCK.STONE);
    w.setBlock(6, 64, 5, BLOCK.DANDELION);
    w.setBlock(7, 64, 5, BLOCK.WATER);
    expect(w.isTargetable(5, 64, 5)).toBe(true);
    expect(w.isTargetable(6, 64, 5)).toBe(true); // cross 植被：可命中（不碰撞）
    expect(w.isTargetable(7, 64, 5)).toBe(false); // 水：不可命中
    expect(w.isTargetable(8, 64, 5)).toBe(false); // 空氣：不可命中
  });

  it('out of range cells are not targetable', () => {
    const w = new World();
    expect(w.isTargetable(0, -1, 0)).toBe(false);
    expect(w.isTargetable(0, 256, 0)).toBe(false);
    expect(w.isTargetable(1000, 64, 1000)).toBe(false); // 沒有區塊 → 空氣
  });
});

describe('serializeModified / applyModified', () => {
  it('round-trips placed and mined blocks through a fresh world', () => {
    const w1 = new World();
    w1.setBlock(5, 70, 5, BLOCK.STONE); // placed
    w1.setBlock(6, 70, 6, BLOCK.STONE);
    w1.setBlock(6, 70, 6, BLOCK.AIR); // mined to air — must stay mined
    const pairs = w1.serializeModified();
    expect(pairs).toContainEqual(['5,70,5', BLOCK.STONE]);
    expect(pairs).toContainEqual(['6,70,6', BLOCK.AIR]);

    const w2 = new World();
    w2.applyModified(pairs);
    expect(w2.getBlock(5, 70, 5)).toBe(BLOCK.STONE);
    expect(w2.getBlock(6, 70, 6)).toBe(BLOCK.AIR);
  });

  it('applied pairs re-serialize identically (idempotent round-trip)', () => {
    const w = new World();
    const pairs: Array<[string, number]> = [
      ['1,64,1', BLOCK.GLASS],
      ['-1,64,-1', BLOCK.DIRT],
      ['0,0,0', BLOCK.AIR],
    ];
    w.applyModified(pairs);
    expect(w.serializeModified()).toEqual(pairs);
  });

  it('applyModified marks the chunk dirty for re-mesh', () => {
    const w = new World();
    w.applyModified([['5,70,5', BLOCK.STONE]]);
    expect(w.getChunk(0, 0)?.dirty).toBe(true);
  });

  it('serializeModified is empty on an untouched world', () => {
    expect(new World().serializeModified()).toEqual([]);
  });

  it('applyModified skips malformed and out-of-range entries without throwing', () => {
    const w = new World();
    expect(() =>
      w.applyModified([
        ['not-a-key', 1],
        ['1,2', BLOCK.STONE],
        ['a,b,c', BLOCK.STONE],
        ['1,999,1', BLOCK.STONE], // y out of range
        ['1,64,1.5', BLOCK.STONE], // non-integer coords
        ['2,64,2', BLOCK.GLASS], // valid — must still be applied
      ]),
    ).not.toThrow();
    expect(w.getBlock(2, 64, 2)).toBe(BLOCK.GLASS);
    expect(w.serializeModified()).toEqual([['2,64,2', BLOCK.GLASS]]);
  });
});

/** Task 14 load-order fix: main.ts's terrain-generation response fills chunks
 *  wholesale (`existing.data.set(data)`), which runs AFTER applyModified has
 *  auto-created a not-yet-generated chunk — without a re-apply the saved edits
 *  would be clobbered by regenerated terrain. These tests simulate that exact
 *  fill sequence at the world level (the call ORDER lives in main.ts's gen
 *  response handler; this proves the re-apply makes edits win). */
describe('reapplyModifiedInChunk (Task 14 gen-order fix)', () => {
  it('saved edits win over a wholesale terrain fill of the same chunk', () => {
    const w = new World();
    w.applyModified([
      ['5,70,5', BLOCK.STONE], // chunk (0,0)
      ['-17,80,-16', BLOCK.GLASS], // chunk (-2,-1) — must not be touched here
    ]);
    // simulate the gen response for chunk (0,0): fresh terrain replaces data
    const c = w.getChunk(0, 0)!;
    const terrain = new Uint8Array(c.data.length).fill(BLOCK.DIRT);
    c.data.set(terrain);
    expect(w.getBlock(5, 70, 5)).toBe(BLOCK.DIRT); // demonstrates the clobber hazard
    w.reapplyModifiedInChunk(0, 0);
    expect(w.getBlock(5, 70, 5)).toBe(BLOCK.STONE); // edit wins over terrain
    // another chunk's edit is unaffected by this call
    expect(w.getBlock(-17, 80, -16)).toBe(BLOCK.GLASS);
    expect(w.serializeModified()).toContainEqual(['5,70,5', BLOCK.STONE]);
  });

  it('re-applies edits into a chunk re-created from terrain after an unload', () => {
    const w = new World();
    w.applyModified([['5,70,5', BLOCK.STONE]]);
    w.removeChunk(0, 0); // refreshQueues unload — the edit stays in world.modified
    // gen response else-branch: brand-new chunk built from terrain data
    const fresh = new Chunk(0, 0, new Uint8Array(16 * 16 * 256).fill(BLOCK.DIRT));
    fresh.generated = true;
    w.addChunk(fresh);
    w.reapplyModifiedInChunk(0, 0);
    expect(w.getBlock(5, 70, 5)).toBe(BLOCK.STONE);
  });

  it('marks the chunk dirty for re-mesh (and no-op on an empty world)', () => {
    const w = new World();
    w.applyModified([['5,70,5', BLOCK.STONE]]);
    w.getChunk(0, 0)!.dirty = false;
    w.reapplyModifiedInChunk(0, 0);
    expect(w.getChunk(0, 0)!.dirty).toBe(true);
    const empty = new World();
    expect(() => empty.reapplyModifiedInChunk(3, 3)).not.toThrow();
  });

  it('only re-applies entries inside the requested chunk', () => {
    const w = new World();
    w.applyModified([
      ['0,64,0', BLOCK.STONE],
      ['15,64,15', BLOCK.GLASS],
      ['16,64,0', BLOCK.DIRT], // chunk (1,0)
    ]);
    const c1 = w.getChunk(1, 0)!;
    c1.data.fill(BLOCK.AIR); // simulate fill wiping it
    w.reapplyModifiedInChunk(0, 0);
    expect(w.getBlock(0, 64, 0)).toBe(BLOCK.STONE);
    expect(w.getBlock(15, 64, 15)).toBe(BLOCK.GLASS);
    expect(w.getBlock(16, 64, 0)).toBe(BLOCK.AIR); // (1,0) untouched by this call
    w.reapplyModifiedInChunk(1, 0);
    expect(w.getBlock(16, 64, 0)).toBe(BLOCK.DIRT);
  });
});

/** Task 14 review #4: New Game must be a FRESH world — sessions share one
 *  boot World, so `clear()` is the testable seam behind main's resetWorld. */
describe('clear (fresh-world reset)', () => {
  it('drops every chunk and all recorded edits', () => {
    const w = new World();
    w.applyModified([
      ['5,70,5', BLOCK.STONE],
      ['20,80,20', BLOCK.AIR],
    ]);
    w.addChunk(new Chunk(1, 1));
    w.clear();
    expect(w.chunks.size).toBe(0);
    expect(w.serializeModified()).toEqual([]);
    expect(w.getBlock(5, 70, 5)).toBe(BLOCK.AIR); // edits gone from the world
    expect(w.getChunk(1, 1)).toBeUndefined();
  });

  it('the cleared world is reusable (chunks auto-create again)', () => {
    const w = new World();
    w.applyModified([['5,70,5', BLOCK.STONE]]);
    w.clear();
    expect(w.setBlock(5, 70, 5, BLOCK.GLASS)).toBe(true);
    expect(w.getBlock(5, 70, 5)).toBe(BLOCK.GLASS);
    expect(w.serializeModified()).toEqual([['5,70,5', BLOCK.GLASS]]);
  });
});
