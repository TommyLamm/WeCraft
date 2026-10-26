/**
 * 仙人掌接觸傷害（B3 Task 6）：純邏輯層。
 *
 * 規則本體在 `src/world/hazards.ts`（不依賴 DOM／Three／`main.ts` 狀態），
 * 這裡只驗兩件事：
 * 1. **傷害節奏**：接觸期間每秒 1 點傷害（累積器式，不是每幀一次）。
 * 2. **接觸判定**：玩家的身體框碰到仙人掌格就算接觸。
 *
 * 與原版的差異（原版是「身體擦到仙人掌就受傷」，仙人掌的碰撞形狀內縮 1/16）：
 * 本作是**整格判定** → 只有身體框與仙人掌格重疊（或踩在仙人掌上）才受傷。
 */
import { describe, it, expect } from 'vitest';
import {
  CACTUS_DAMAGE_PER_SEC,
  createHazardState,
  stepHazards,
  touchesCactus,
} from './hazards';
import { World } from './world';
import { Chunk } from './chunk';
import { BLOCK } from './blocks';

/** 玩家的身體框（與 `src/player/physics.ts` 的常數一致）。 */
const HALF_WIDTH = 0.3;
const HEIGHT = 1.8;

/** 一個有仙人掌的世界（仙人掌在 (0, 64, 0)）。 */
function worldWithCactus(): World {
  const w = new World();
  w.addChunk(new Chunk(0, 0));
  w.setBlock(0, 64, 0, BLOCK.CACTUS);
  return w;
}

describe('cactus contact damage', () => {
  it('touching a cactus deals one damage per second', () => {
    expect(CACTUS_DAMAGE_PER_SEC).toBe(1);
    const first = stepHazards(createHazardState(), true, 0.5);
    expect(first.damage).toBe(0); // 還沒滿 1 秒
    const second = stepHazards(first.state, true, 0.5);
    expect(second.damage).toBe(1); // 滿 1 秒 → 1 點傷害
    // 累積器保留未滿 1 秒的餘數 → 下一幀不會重複扣血
    expect(second.state.cactusAcc).toBeCloseTo(0, 10);
  });

  it('not touching a cactus deals no damage and resets the accumulator', () => {
    const touched = stepHazards(createHazardState(), true, 0.75);
    expect(touched.damage).toBe(0);
    expect(touched.state.cactusAcc).toBeCloseTo(0.75, 10);
    // 離開 → 不扣血，累積器歸零
    const away = stepHazards(touched.state, false, 0.1);
    expect(away.damage).toBe(0);
    expect(away.state.cactusAcc).toBe(0);
    // 重新接觸 → 累積器從 0 重新算（不會立刻補扣那 0.75 秒）
    const again = stepHazards(away.state, true, 0.5);
    expect(again.damage).toBe(0);
    expect(again.state.cactusAcc).toBeCloseTo(0.5, 10);
  });

  it('a non-finite dt never damages', () => {
    for (const dt of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const fresh = stepHazards(createHazardState(), true, dt);
      expect(fresh.damage).toBe(0);
      expect(fresh.state.cactusAcc).toBe(0);
      // 已經累積了一段時間的非有限 dt 也不會補扣
      const banked = stepHazards({ cactusAcc: 0.5 }, true, dt);
      expect(banked.damage).toBe(0);
      expect(banked.state.cactusAcc).toBeCloseTo(0.5, 10);
    }
  });

  it('touchesCactus detects an overlapping cactus cell', () => {
    const w = worldWithCactus();
    // 身體框與仙人掌格重疊（仙人掌在 (0,64,0)，玩家站在同一格裡）
    expect(touchesCactus(w, { x: 0.5, y: 64, z: 0.5 }, HALF_WIDTH, HEIGHT)).toBe(true);
    // 離開 → 不再接觸
    expect(touchesCactus(w, { x: 5.5, y: 64, z: 0.5 }, HALF_WIDTH, HEIGHT)).toBe(false);
  });

  it('standing on top of a cactus counts as touching it', () => {
    const w = worldWithCactus();
    // 腳底在仙人掌頂端（y = 65）→ 腳下 2 層的掃描會看到仙人掌那一格
    expect(touchesCactus(w, { x: 0.5, y: 65, z: 0.5 }, HALF_WIDTH, HEIGHT)).toBe(true);
    // 再高兩格就掃不到（腳下只有 2 層）
    expect(touchesCactus(w, { x: 0.5, y: 67, z: 0.5 }, HALF_WIDTH, HEIGHT)).toBe(false);
  });

  it('a cactus behind a solid block does not damage the player (B1)', () => {
    // 審查 B1：腳下固定多掃 2 層、中途不檢查 solid → 站在石頭平台上、
    // **下方隔著平台**的仙人掌仍每秒扣血（穿透實心方塊）。修法：仙人掌格
    // 與身體框之間（同一柱）必須沒有實心方塊才算接觸。
    const w = worldWithCactus(); // 仙人掌在 (0,64,0)
    w.setBlock(0, 65, 0, BLOCK.STONE); // 平台：實心石頭夾在仙人掌與玩家之間
    // 玩家站在平台頂端（腳底 y = 66）：掃描會看到 y=64 的仙人掌，
    // 但中間的 y=65 是實心石頭 → 不得受傷。
    expect(touchesCactus(w, { x: 0.5, y: 66, z: 0.5 }, HALF_WIDTH, HEIGHT)).toBe(false);
  });

  it('an overlapping cactus cell still damages even with a solid block above it (B1)', () => {
    // 遮擋只適用**腳下**的候選格；與身體框**直接重疊**的仙人掌格一律算接觸
    // （規則的「或直接重疊」那一半——不然把仙人掌塞在牆邊就會免疫）。
    const w = worldWithCactus();
    w.setBlock(0, 65, 0, BLOCK.STONE); // 仙人掌上方有石頭
    // 身體框 y ∈ [64.5, 66.3] 與仙人掌格 y=64 重疊 → 直接接觸。
    expect(touchesCactus(w, { x: 0.5, y: 64.5, z: 0.5 }, HALF_WIDTH, HEIGHT)).toBe(true);
  });

  it('a non-finite position never touches a cactus', () => {
    const w = worldWithCactus();
    expect(touchesCactus(w, { x: Number.NaN, y: 64, z: 0.5 }, HALF_WIDTH, HEIGHT)).toBe(false);
    expect(touchesCactus(w, { x: 0.5, y: Number.NaN, z: 0.5 }, HALF_WIDTH, HEIGHT)).toBe(false);
    expect(touchesCactus(w, { x: 0.5, y: 64, z: Number.NaN }, HALF_WIDTH, HEIGHT)).toBe(false);
  });
});
