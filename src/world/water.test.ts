import { describe, it, expect } from 'vitest';
import { BLOCK, type BlockId } from './blocks';
import {
  WATER_TICK_SEC,
  WATER_MAX_UPDATES_PER_TICK,
  WATER_MAX_LEVEL,
  waterFlowLevel,
  waterSpreadLevel,
  waterBlockForLevel,
  WaterSim,
  type WaterGrid,
} from './water';

/** 假 grid：方塊放 Map、載入狀態可用 `loadedFor` 逐格控制（預設全載入）。 */
class FakeGrid implements WaterGrid {
  blocks = new Map<string, number>();
  loaded = true;
  /** 有設定時以它決定 isLoaded；模擬「區塊邊界外未載入」。 */
  loadedFor: ((x: number, z: number) => boolean) | null = null;
  /** 每次 setBlock 的紀錄（驗證「從不寫進未載入區塊」）。 */
  writes: Array<{ x: number; y: number; z: number; id: BlockId }> = [];

  getBlock(x: number, y: number, z: number): number {
    return this.blocks.get(`${x},${y},${z}`) ?? BLOCK.AIR;
  }
  setBlock(x: number, y: number, z: number, id: BlockId): void {
    this.writes.push({ x, y, z, id });
    this.blocks.set(`${x},${y},${z}`, id);
  }
  isLoaded(x: number, z: number): boolean {
    if (this.loadedFor) return this.loadedFor(x, z);
    return this.loaded;
  }
}

const put = (g: FakeGrid, x: number, y: number, z: number, id: BlockId) =>
  g.blocks.set(`${x},${y},${z}`, id);
const at = (g: FakeGrid, x: number, y: number, z: number) => g.getBlock(x, y, z);
const settle = (sim: WaterSim, steps = 40) => {
  for (let i = 0; i < steps; i++) sim.tick(WATER_TICK_SEC);
};

/** 在 y=63 鋪一片石板（x..x2、z..z2），讓水平擴散不會往下掉。 */
const solidFloor = (g: FakeGrid, x1: number, x2: number, z1: number, z2: number) => {
  for (let x = x1; x <= x2; x++) {
    for (let z = z1; z <= z2; z++) put(g, x, 63, z, BLOCK.STONE);
  }
};

describe('b16 water constants and id mapping', () => {
  it('pins the B16 constants', () => {
    expect(WATER_TICK_SEC).toBe(0.25);
    expect(WATER_MAX_UPDATES_PER_TICK).toBe(256);
    expect(WATER_MAX_LEVEL).toBe(7);
  });

  it('maps ids to levels and back', () => {
    expect(waterFlowLevel(BLOCK.WATER)).toBe(0);
    expect(waterFlowLevel(BLOCK.WATER_FLOW_1)).toBe(1);
    expect(waterFlowLevel(BLOCK.WATER_FLOW_2)).toBe(2);
    expect(waterFlowLevel(BLOCK.WATER_FLOW_3)).toBe(3);
    expect(waterFlowLevel(BLOCK.WATER_FLOW_4)).toBe(4);
    expect(waterFlowLevel(BLOCK.WATER_FLOW_5)).toBe(5);
    expect(waterFlowLevel(BLOCK.WATER_FLOW_6)).toBe(6);
    expect(waterFlowLevel(BLOCK.WATER_FLOW_7)).toBe(7);
    expect(waterFlowLevel(BLOCK.WATER_FALL)).toBeNull();
    expect(waterFlowLevel(BLOCK.STONE)).toBeNull();
    expect(waterSpreadLevel(BLOCK.WATER)).toBe(0);
    expect(waterSpreadLevel(BLOCK.WATER_FALL)).toBeNull();
    expect(waterSpreadLevel(BLOCK.WATER_FLOW_3)).toBe(3);
    expect(waterSpreadLevel(BLOCK.STONE)).toBeNull();
    expect(waterBlockForLevel(0)).toBe(BLOCK.WATER);
    expect(waterBlockForLevel(1)).toBe(BLOCK.WATER_FLOW_1);
    expect(waterBlockForLevel(7)).toBe(BLOCK.WATER_FLOW_7);
    expect(waterBlockForLevel(NaN)).toBe(BLOCK.AIR);
    expect(waterBlockForLevel(-1)).toBe(BLOCK.AIR);
    expect(waterBlockForLevel(8)).toBe(BLOCK.AIR);
    expect(waterBlockForLevel(Infinity)).toBe(BLOCK.AIR);
  });
});

describe('b16 WaterSim flow rules', () => {
  it('a source block itself is never converted or removed', () => {
    const g = new FakeGrid();
    solidFloor(g, -8, 8, -8, 8);
    put(g, 0, 64, 0, BLOCK.WATER);
    const sim = new WaterSim(g);
    sim.notifyBlockChanged(0, 64, 0);
    settle(sim);
    expect(at(g, 0, 64, 0)).toBe(BLOCK.WATER);
    // 周圍出現流動水是正常的——這不代表 source 被改掉
    expect(at(g, 1, 64, 0)).toBe(BLOCK.WATER_FLOW_1);
  });

  it('spreads one level per tick and stops at seven', () => {
    const g = new FakeGrid();
    solidFloor(g, -8, 8, -8, 8);
    put(g, 0, 64, 0, BLOCK.WATER);
    const sim = new WaterSim(g);
    sim.notifyBlockChanged(0, 64, 0);
    for (let i = 0; i < 7; i++) sim.tick(WATER_TICK_SEC);
    expect(at(g, 7, 64, 0)).toBe(BLOCK.WATER_FLOW_7);
    expect(at(g, 8, 64, 0)).toBe(BLOCK.AIR);
    settle(sim);
    expect(at(g, 8, 64, 0)).toBe(BLOCK.AIR);
    expect(at(g, 9, 64, 0)).toBe(BLOCK.AIR);
  });

  it('recedes when the source is removed', () => {
    const g = new FakeGrid();
    solidFloor(g, -9, 15, -8, 8);
    put(g, 0, 64, 0, BLOCK.WATER);
    for (let x = 1; x <= 7; x++) {
      put(g, x, 64, 0, (BLOCK.WATER_FLOW_1 + x - 1) as BlockId);
    }
    const sim = new WaterSim(g);
    put(g, 0, 64, 0, BLOCK.AIR);
    sim.notifyBlockChanged(0, 64, 0);
    settle(sim);
    for (let x = 0; x <= 7; x++) {
      expect(at(g, x, 64, 0)).toBe(BLOCK.AIR);
    }
    expect(sim.pendingCount).toBe(0);
  });

  it('recede is monotone (no swell wave)', () => {
    const g = new FakeGrid();
    solidFloor(g, -9, 15, -8, 8);
    put(g, 0, 64, 0, BLOCK.WATER);
    for (let x = 1; x <= 7; x++) {
      put(g, x, 64, 0, (BLOCK.WATER_FLOW_1 + x - 1) as BlockId);
    }
    // 移除前的水位快照：(x,64,0) 是 FLOW_x（Ruling T2-1：等級只能不變、變濃或消失）
    const before: Array<number> = [];
    for (let x = 1; x <= 7; x++) before.push(waterFlowLevel(at(g, x, 64, 0)) as number);
    const sim = new WaterSim(g);
    put(g, 0, 64, 0, BLOCK.AIR);
    sim.notifyBlockChanged(0, 64, 0);
    for (let t = 1; t <= 7; t++) {
      sim.tick(WATER_TICK_SEC);
      // 單調性：移除前就是流動水、現在還在的格，水位不得上升（不得出現迴漲波）。
      // （(0,64,0) 原本是水源、不是流動水，不在檢查範圍。）
      for (let x = 1; x <= 7; x++) {
        const lvl = waterFlowLevel(at(g, x, 64, 0));
        if (lvl !== null) expect(lvl).toBeLessThanOrEqual(before[x - 1]);
      }
      // 退去順序：最靠近（前）水源的格子先變空氣——tick t 後 (t,64,0) 已是 AIR
      expect(at(g, t, 64, 0)).toBe(BLOCK.AIR);
    }
    settle(sim);
    for (let x = 0; x <= 7; x++) expect(at(g, x, 64, 0)).toBe(BLOCK.AIR);
    expect(sim.pendingCount).toBe(0);
  });

  it('a placed block cuts the flow and the tail recedes', () => {
    const g = new FakeGrid();
    solidFloor(g, -9, 15, -8, 8);
    put(g, 0, 64, 0, BLOCK.WATER);
    for (let x = 1; x <= 7; x++) {
      put(g, x, 64, 0, (BLOCK.WATER_FLOW_1 + x - 1) as BlockId);
    }
    const sim = new WaterSim(g);
    put(g, 3, 64, 0, BLOCK.STONE);
    sim.notifyBlockChanged(3, 64, 0);
    settle(sim);
    for (let x = 4; x <= 7; x++) {
      expect(at(g, x, 64, 0)).toBe(BLOCK.AIR);
    }
    expect(at(g, 0, 64, 0)).toBe(BLOCK.WATER);
    expect(at(g, 1, 64, 0)).toBe(BLOCK.WATER_FLOW_1);
    expect(at(g, 2, 64, 0)).toBe(BLOCK.WATER_FLOW_2);
    expect(at(g, 3, 64, 0)).toBe(BLOCK.STONE);
  });

  it('water falls before it spreads', () => {
    const g = new FakeGrid();
    // 落地平台：y=63 整片 solid；水源嵌在 y=66 的石壁裡（四面圍住），
    // 讓水**只能往下**—— 否則源頭自己的水平鄰居會先流下來、蓋掉本測試要驗的行為
    solidFloor(g, -8, 8, -8, 8);
    put(g, 1, 66, 0, BLOCK.STONE);
    put(g, -1, 66, 0, BLOCK.STONE);
    put(g, 0, 66, 1, BLOCK.STONE);
    put(g, 0, 66, -1, BLOCK.STONE);
    put(g, 0, 66, 0, BLOCK.WATER);
    const sim = new WaterSim(g);
    sim.notifyBlockChanged(0, 66, 0);
    settle(sim);
    expect(at(g, 0, 65, 0)).toBe(BLOCK.WATER_FALL);
    expect(at(g, 0, 64, 0)).toBe(BLOCK.WATER_FLOW_1);
    expect(at(g, 0, 64, 1)).toBe(BLOCK.WATER_FLOW_2);
    expect(at(g, 0, 65, 1)).toBe(BLOCK.AIR);
  });

  it('two sources do not create a new source', () => {
    const g = new FakeGrid();
    solidFloor(g, -8, 10, -8, 8);
    put(g, 0, 64, 0, BLOCK.WATER);
    put(g, 2, 64, 0, BLOCK.WATER);
    const sim = new WaterSim(g);
    sim.notifyBlockChanged(0, 64, 0);
    sim.notifyBlockChanged(2, 64, 0);
    settle(sim);
    expect(at(g, 1, 64, 0)).toBe(BLOCK.WATER_FLOW_1);
    expect(at(g, 1, 64, 0)).not.toBe(BLOCK.WATER);
  });
});

describe('b16 WaterSim scheduling and batching', () => {
  it('never writes into an unloaded chunk', () => {
    const g = new FakeGrid();
    g.loadedFor = (x) => x < 16; // x≥16 的區塊未載入
    solidFloor(g, 0, 15, -7, 7);
    put(g, 15, 64, 0, BLOCK.WATER);
    const sim = new WaterSim(g);
    sim.notifyBlockChanged(15, 64, 0);
    settle(sim);
    expect(at(g, 16, 64, 0)).toBe(BLOCK.AIR);
    expect(at(g, 15, 64, 0)).toBe(BLOCK.WATER);
    // 從不對未載入座標呼叫 setBlock；載入側照常流動
    for (const w of g.writes) {
      expect(g.isLoaded(w.x, w.z)).toBe(true);
    }
    expect(at(g, 14, 64, 0)).toBe(BLOCK.WATER_FLOW_1);
    expect(sim.pendingCount).toBe(0);
  });

  it('dt guards and one batch per call', () => {
    // 前半：0.24+0.01 才觸發；NaN／負數回 0
    const g = new FakeGrid();
    solidFloor(g, -8, 8, -8, 8);
    put(g, 0, 64, 0, BLOCK.WATER);
    const sim = new WaterSim(g);
    sim.notifyBlockChanged(0, 64, 0);
    expect(sim.tick(0.24)).toBe(0);
    const changed = sim.tick(0.01);
    expect(changed).toBeGreaterThan(0);
    expect(sim.tick(NaN)).toBe(0);
    expect(sim.tick(-1)).toBe(0);
    expect(sim.tick(0)).toBe(0);

    // 後半：300 個待處理格，tick(10) 只處理一批（acc 歸零、不補償）
    const g2 = new FakeGrid();
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 15; j++) put(g2, i, 63, j, BLOCK.STONE);
    }
    const sim2 = new WaterSim(g2);
    for (let i = 0; i < 300; i++) {
      const x = i % 20;
      const z = Math.floor(i / 20);
      put(g2, x, 65, z, BLOCK.WATER); // 每格上方一格是水源
      sim2.notifyBlockChanged(x, 64, z); // 待處理格是水源正下方的空氣
    }
    expect(sim2.pendingCount).toBeGreaterThan(0);
    const changed2 = sim2.tick(10);
    expect(changed2).toBeLessThanOrEqual(WATER_MAX_UPDATES_PER_TICK);
    expect(sim2.pendingCount).toBeGreaterThan(0);
  });

  it('batch cap is 256', () => {
    const g = new FakeGrid();
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 15; j++) put(g, i, 63, j, BLOCK.STONE);
    }
    const sim = new WaterSim(g);
    for (let i = 0; i < 300; i++) {
      const x = i % 20;
      const z = Math.floor(i / 20);
      put(g, x, 65, z, BLOCK.WATER);
      sim.notifyBlockChanged(x, 64, z);
    }
    const changed = sim.tick(WATER_TICK_SEC);
    expect(changed).toBeLessThanOrEqual(256);
    expect(changed).toBeGreaterThan(0);
  });

  it('scheduleFromModified parses keys and filters chunks', () => {
    const g = new FakeGrid();
    const sim = new WaterSim(g);
    const scheduled = sim.scheduleFromModified(
      [
        ['0,64,0', BLOCK.WATER],
        ['99,64,99', BLOCK.WATER],
        ['bad', 1],
      ] as Array<readonly [string, number]>,
      { cx: 0, cz: 0 },
    );
    // 只有 (0,64,0) 通過解析與 chunk 過濾；非法 key 不拋錯
    expect(scheduled).toBe(1);
    expect(sim.pendingCount).toBeGreaterThan(0);
    // 排程的是該格 ±1 範圍（cx=0 → x ∈ [-1,16]），99,64,99 完全不在佇列
    expect(at(g, 0, 64, 0)).toBe(BLOCK.AIR);
    settle(sim);
    expect(sim.pendingCount).toBe(0);
  });

  it('reset clears the queue', () => {
    const g = new FakeGrid();
    solidFloor(g, -1, 1, -1, 1);
    put(g, 0, 64, 0, BLOCK.WATER);
    const sim = new WaterSim(g);
    sim.notifyBlockChanged(0, 64, 0);
    expect(sim.pendingCount).toBeGreaterThan(0);
    sim.reset();
    expect(sim.pendingCount).toBe(0);
    for (let i = 0; i < 5; i++) expect(sim.tick(WATER_TICK_SEC)).toBe(0);
    expect(at(g, 1, 64, 0)).toBe(BLOCK.AIR);
  });
});
