// B16 最終審查修正（建議 2）：**World × WaterSim 的跨元件整合測試**（不經 main.ts）。
//
// **為什麼需要**：`main.ts` 是組裝根（import 進 jsdom 會炸）→ 單元測試只能各自
// 測 `World`（`world.test.ts`）與 `WaterSim`（`water.test.ts`），**兩者的接線**
// （模擬的寫入走 `World.setFluid`、存檔的 `modified` overlay 能讓水流在重載後
// 繼續／退去）沒有任何自動化防護。這支檔案在**純邏輯層**補上那一段：
// 用與 `src/main.ts` **完全相同形狀**的 adapter 跑一遍真實的
// `World` ＋ `WaterSim`，走真實的存檔序列化（`serializeModified` →
// `applyModified`）→ 驗證「重載後水流繼續、拿走水源後退去」。
//
// **與 main.ts 的對應**：
// - adapter：`src/main.ts` 的 `new WaterSim({…})`（同樣的 `getBlock`／
//   `setBlock`→`setFluid`／`isLoaded` 三個形狀）。
// - 變更通知：`world.setBlockChangeListener((x, y, z) => water.notifyBlockChanged(x, y, z))`。
// - 載入路徑：`water.reset()` ＋ `water.scheduleFromModified(world.modified)`。
//
// **刻意保持確定性且快**：只有一個 16×16 的區塊、一片石板地板、幾格水 →
// 數十個 tick 內收斂，沒有亂數、沒有時間相依。

import { describe, it, expect } from 'vitest';
import { Chunk, CHUNK_SIZE } from './chunk';
import { World } from './world';
import { BLOCK, type BlockId } from './blocks';
import { WATER_TICK_SEC, WaterSim } from './water';

/** 與 `src/main.ts` 裡 `new WaterSim({…})` **同一個形狀**的 adapter。 */
function waterAdapter(world: World) {
  return {
    getBlock: (x: number, y: number, z: number) => world.getBlock(x, y, z),
    setBlock: (x: number, y: number, z: number, id: BlockId) => {
      world.setFluid(x, y, z, id);
    },
    isLoaded: (x: number, z: number) =>
      world.hasChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)),
  };
}

/** 只有 (0,0) 一個區塊、y=64 鋪滿石板地板的世界（地板是**地形**、不進
 *  `modified` → 重載時由新世界的同一份地形重建，與真實流程一致）。 */
function makeWorld(): World {
  const world = new World();
  const chunk = new Chunk(0, 0);
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) chunk.set(x, 64, z, BLOCK.STONE);
  }
  world.addChunk(chunk);
  return world;
}

describe('B16 流動水 × World 整合（存檔重載）', () => {
  it('a saved flow continues after a reload and recedes when the source is removed', () => {
    const world = makeWorld();
    const sim = new WaterSim(waterAdapter(world));

    // 放水源（地板 y=64 → 水源在 y=65）→ main.ts 的變更監聽器會通知模擬。
    world.setBlock(3, 65, 5, BLOCK.WATER);
    sim.notifyBlockChanged(3, 65, 5);
    sim.tick(WATER_TICK_SEC);
    // 第一格流動水出來了（來源永遠是 WATER，不會被改寫）。
    expect(world.getBlock(3, 65, 5)).toBe(BLOCK.WATER);
    expect(world.getBlock(4, 65, 5)).toBe(BLOCK.WATER_FLOW_1);

    // 序列化 → 存檔 payload 的形狀（`Array<[string, number]>`）。
    const payload = world.serializeModified();
    expect(payload.length).toBeGreaterThan(0);
    expect(payload.every((e) => typeof e[0] === 'string' && Number.isInteger(e[1]))).toBe(true);

    // 載入到**全新**的 World（`applyModified` → 經 `setBlock` 重放編輯）。
    const fresh = makeWorld();
    fresh.applyModified(payload);
    expect(fresh.getBlock(3, 65, 5)).toBe(BLOCK.WATER);
    expect(fresh.getBlock(4, 65, 5)).toBe(BLOCK.WATER_FLOW_1);
    expect(fresh.getBlock(5, 65, 5)).toBe(BLOCK.AIR); // 還沒流到這裡

    // 載入路徑（與 main.ts 的 `continueGame` 同一套）：reset ＋ 依 modified 重排程。
    const freshSim = new WaterSim(waterAdapter(fresh));
    freshSim.reset();
    freshSim.scheduleFromModified(fresh.modified);

    // 重載後水流**繼續**往前流（(5,65,5) 由 FLOW_1 的鄰居供給 → FLOW_2）。
    freshSim.tick(WATER_TICK_SEC);
    expect(fresh.getBlock(5, 65, 5)).toBe(BLOCK.WATER_FLOW_2);

    // 拿走水源（玩家編輯 → 監聽器通知模擬）→ 失去供給的流動水退去成空氣。
    fresh.setBlock(3, 65, 5, BLOCK.AIR);
    freshSim.notifyBlockChanged(3, 65, 5);
    for (let i = 0; i < 40; i++) freshSim.tick(WATER_TICK_SEC);
    expect(fresh.getBlock(3, 65, 5)).toBe(BLOCK.AIR);
    expect(fresh.getBlock(4, 65, 5)).toBe(BLOCK.AIR);
    expect(fresh.getBlock(5, 65, 5)).toBe(BLOCK.AIR);
    // 地板不動、也沒有寫到未載入的區塊。
    expect(fresh.getBlock(3, 64, 5)).toBe(BLOCK.STONE);
    expect(fresh.hasChunk(1, 0)).toBe(false);
  });
});
