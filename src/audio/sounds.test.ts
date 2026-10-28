import { describe, it, expect } from 'vitest';
import { BLOCK } from '../world/blocks';
import {
  footstepInterval,
  gainForDistance,
  materialGroup,
  synthParams,
  TOOL_BREAK_PARAMS,
  type MaterialGroup,
} from './sounds';

describe('materialGroup', () => {
  it('maps every BLOCK id to its material group (table-driven)', () => {
    const table: Record<number, MaterialGroup> = {
      [BLOCK.AIR]: 'dirt',
      [BLOCK.STONE]: 'stone',
      [BLOCK.DIRT]: 'dirt',
      [BLOCK.GRASS]: 'grass',
      [BLOCK.SAND]: 'sand',
      [BLOCK.LOG]: 'wood',
      [BLOCK.LEAVES]: 'leaves',
      [BLOCK.PLANKS]: 'wood',
      [BLOCK.COBBLE]: 'stone',
      [BLOCK.WATER]: 'water',
      [BLOCK.BEDROCK]: 'stone',
      [BLOCK.SNOW]: 'snow',
      [BLOCK.GLASS]: 'glass',
      [BLOCK.COAL_ORE]: 'stone',
      [BLOCK.IRON_ORE]: 'stone',
      [BLOCK.CRAFTING_TABLE]: 'wood',
      [BLOCK.FURNACE]: 'stone',
      // B3 Task 3：雲杉／白樺（未登記者會落到預設 'dirt' 音）
      [BLOCK.SPRUCE_LOG]: 'wood',
      [BLOCK.SPRUCE_LEAVES]: 'leaves',
      [BLOCK.BIRCH_LOG]: 'wood',
      [BLOCK.BIRCH_LEAVES]: 'leaves',
      // B3 Task 4：花／草／仙人掌是草的聲音、冰是清脆的玻璃聲
      [BLOCK.DANDELION]: 'grass',
      [BLOCK.POPPY]: 'grass',
      [BLOCK.SHORT_GRASS]: 'grass',
      [BLOCK.CACTUS]: 'grass',
      [BLOCK.ICE]: 'glass',
      // B4 Task 1：羊毛是柔軟質地 → 走既有的 'leaves'（沙沙）音色
      [BLOCK.WOOL]: 'leaves',
      // B5 Task 1：礫石（顆粒質地 → 沙聲）、金／鑽石礦（石頭聲）、雲杉／白樺板材（木聲）
      [BLOCK.GRAVEL]: 'sand',
      [BLOCK.GOLD_ORE]: 'stone',
      [BLOCK.DIAMOND_ORE]: 'stone',
      [BLOCK.SPRUCE_PLANKS]: 'wood',
      [BLOCK.BIRCH_PLANKS]: 'wood',
      // B6 Task 5：火把是木頭 → 挖掘／腳步／放置音效走 wood 材質
      [BLOCK.TORCH]: 'wood',
      // B8 Task 2：箱子是木頭
      [BLOCK.CHEST]: 'wood',
    };
    expect(Object.keys(table)).toHaveLength(Object.keys(BLOCK).length); // every id covered
    for (const [id, group] of Object.entries(table)) {
      expect(materialGroup(Number(id))).toBe(group);
    }
  });

  it('falls back to dirt for unknown ids', () => {
    expect(materialGroup(99)).toBe('dirt');
    expect(materialGroup(-1)).toBe('dirt');
    expect(materialGroup(NaN)).toBe('dirt');
  });

  it('wool sounds like the soft leaves material', () => {
    // B4 Task 1：BLOCK.WOOL 沒登錄在 GROUP_BY_BLOCK 就會 fallback 成泥土聲
    expect(materialGroup(BLOCK.WOOL)).toBe('leaves');
  });
});

describe('gainForDistance', () => {
  it('is 1 within 3, 0 at 20+, linear between, 0 for non-finite', () => {
    expect(gainForDistance(0)).toBe(1);
    expect(gainForDistance(3)).toBe(1);
    expect(gainForDistance(11.5)).toBeCloseTo(0.5);
    expect(gainForDistance(20)).toBe(0);
    expect(gainForDistance(42)).toBe(0);
    expect(gainForDistance(NaN)).toBe(0);
    expect(gainForDistance(Infinity)).toBe(0);
    expect(gainForDistance(-Infinity)).toBe(0);
  });
});

describe('footstepInterval', () => {
  it('is Infinity at or below 0.1 speed (and for non-finite), else clamp(1.35/speed, 0.3, 0.55)', () => {
    expect(footstepInterval(0)).toBe(Infinity);
    expect(footstepInterval(0.05)).toBe(Infinity);
    expect(footstepInterval(0.1)).toBe(Infinity);
    expect(footstepInterval(4.3)).toBeCloseTo(0.314);
    expect(footstepInterval(20)).toBe(0.3);
    expect(footstepInterval(1)).toBeCloseTo(0.55); // 1.35 clamped down
    expect(footstepInterval(NaN)).toBe(Infinity);
  });
});

describe('synthParams', () => {
  it('stone/dig: bandpass 1100 Q1.2, 0.12 s, gain 0.5', () => {
    expect(synthParams('stone', 'dig')).toEqual({
      filter: 'bandpass',
      freq: 1100,
      q: 1.2,
      durationSec: 0.12,
      gain: 0.5,
    });
  });

  it('wood/place: bandpass 800 × 0.7 = 560, 0.09 s, gain 0.5', () => {
    expect(synthParams('wood', 'place')).toEqual({
      filter: 'bandpass',
      freq: 560,
      q: 1.0,
      durationSec: 0.09,
      gain: 0.5,
    });
  });

  it('grass/step: lowpass 900 × 0.9 = 810, 0.08 s, gain 0.25', () => {
    expect(synthParams('grass', 'step')).toEqual({
      filter: 'lowpass',
      freq: 810,
      q: 0.7,
      durationSec: 0.08,
      gain: 0.25,
    });
  });

  it('glass/break: highpass 3000 × 0.85 = 2550, 0.18 s, gain 0.6', () => {
    expect(synthParams('glass', 'break')).toEqual({
      filter: 'highpass',
      freq: 2550,
      q: 1.0,
      durationSec: 0.18,
      gain: 0.6,
    });
  });

  // B7 Task 5：工具損壞音是**固定參數**（不隨方塊材質變化）——`synthParams`
  // 對 `tool_break` 直接回傳 `TOOL_BREAK_PARAMS`（`group` 被忽略）。
  it('the tool break sound uses a fixed profile', () => {
    expect(synthParams('stone', 'tool_break')).toEqual(TOOL_BREAK_PARAMS);
    expect(synthParams('wood', 'tool_break')).toEqual(TOOL_BREAK_PARAMS);
    expect(TOOL_BREAK_PARAMS.durationSec).toBeGreaterThan(0.2);
  });

  // 最終修正波：固定音色的**字面值**釘死——常數改值時這裡必須轉紅，
  // 屆時同步更新（不經 `synthParams` 間接比對）。
  it('TOOL_BREAK_PARAMS pins the literal profile (lowpass 500, q 0.7, 0.25 s, gain 0.8)', () => {
    expect(TOOL_BREAK_PARAMS).toEqual({
      filter: 'lowpass',
      freq: 500,
      q: 0.7,
      durationSec: 0.25,
      gain: 0.8,
    });
  });

  it('synthParams returns TOOL_BREAK_PARAMS for every material group (group is ignored)', () => {
    // group 獨立性：窮舉整個 MaterialGroup（與上面的 stone／wood 案例互補）。
    const groups: readonly MaterialGroup[] = [
      'dirt', 'grass', 'sand', 'snow', 'stone', 'wood', 'leaves', 'glass', 'water',
    ];
    for (const group of groups) {
      expect(synthParams(group, 'tool_break')).toEqual(TOOL_BREAK_PARAMS);
    }
    // 回傳的是拷貝（`{ ...TOOL_BREAK_PARAMS }`）→ 呼叫端不會誤改模組常數。
    expect(synthParams('stone', 'tool_break')).not.toBe(TOOL_BREAK_PARAMS);
  });
});
