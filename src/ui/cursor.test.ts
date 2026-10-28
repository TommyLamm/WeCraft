import { describe, it, expect } from 'vitest';
import { cursorLeftClick, cursorRightClick } from './cursor';

describe('cursor stacking rules', () => {
  it('left click picks the whole stack up', () => {
    expect(cursorLeftClick(null, { item: 'stone', count: 5 })).toEqual({ cursor: { item: 'stone', count: 5 }, target: null });
  });

  it('left click places the whole cursor stack', () => {
    expect(cursorLeftClick({ item: 'stone', count: 5 }, null)).toEqual({ cursor: null, target: { item: 'stone', count: 5 } });
  });

  it('left click swaps two occupied slots', () => {
    expect(cursorLeftClick({ item: 'stone', count: 5 }, { item: 'dirt', count: 2 })).toEqual({ cursor: { item: 'dirt', count: 2 }, target: { item: 'stone', count: 5 } });
  });

  it('left click with an empty cursor and an empty slot changes nothing', () => {
    expect(cursorLeftClick(null, null)).toEqual({ cursor: null, target: null });
  });

  it('right click takes half and leaves the smaller half behind', () => {
    expect(cursorRightClick(null, { item: 'stone', count: 5 })).toEqual({ cursor: { item: 'stone', count: 3 }, target: { item: 'stone', count: 2 } });
  });

  it('right click on a single stack takes the whole stack', () => {
    expect(cursorRightClick(null, { item: 'stone', count: 1 })).toEqual({ cursor: { item: 'stone', count: 1 }, target: null });
  });

  it('right click places one item', () => {
    expect(cursorRightClick({ item: 'stone', count: 3 }, null)).toEqual({ cursor: { item: 'stone', count: 2 }, target: { item: 'stone', count: 1 } });
  });

  it('right click merges one item into a matching slot', () => {
    expect(cursorRightClick({ item: 'stone', count: 3 }, { item: 'stone', count: 10 })).toEqual({ cursor: { item: 'stone', count: 2 }, target: { item: 'stone', count: 11 } });
  });

  it('right click refuses to merge into a different item or a full slot', () => {
    expect(cursorRightClick({ item: 'stone', count: 3 }, { item: 'dirt', count: 1 })).toEqual({ cursor: { item: 'stone', count: 3 }, target: { item: 'dirt', count: 1 } });
    expect(cursorRightClick({ item: 'stone', count: 3 }, { item: 'stone', count: 64 })).toEqual({ cursor: { item: 'stone', count: 3 }, target: { item: 'stone', count: 64 } });
  });

  it('the cursor rules keep the durability of a damaged tool', () => {
    const taken = cursorRightClick(null, { item: 'wooden_pickaxe', count: 1, dur: 12 });
    expect(taken.cursor).toEqual({ item: 'wooden_pickaxe', count: 1, dur: 12 });
    const placed = cursorRightClick({ item: 'wooden_pickaxe', count: 1, dur: 12 }, null);
    expect(placed.target).toEqual({ item: 'wooden_pickaxe', count: 1, dur: 12 });
    expect(placed.cursor).toBeNull(); // 放 1 個 → 游標清空
  });
});
