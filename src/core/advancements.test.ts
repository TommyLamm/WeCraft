import { describe, it, expect } from 'vitest';
import {
  checkAdvancements,
  emptyAdvancements,
  sanitizeAdvancements,
  type AdvancementEvent,
  type AdvancementId,
} from './advancements';

/** Trigger table (Task 11 brief, treated as spec): every advancement id plus
 *  the event sequence(s) that must unlock it. wooden_tool/stone_tool cover all
 *  three item variants; first_night needs a night scene BEFORE its day. */
const TRIGGERS: ReadonlyArray<
  readonly [AdvancementId, ReadonlyArray<ReadonlyArray<AdvancementEvent>>]
> = [
  ['getting_wood', [[{ type: 'obtain', item: 'oak_log', mode: 'survival' }]]],
  ['crafting_table', [[{ type: 'obtain', item: 'crafting_table', mode: 'survival' }]]],
  [
    'wooden_tool',
    [
      [{ type: 'obtain', item: 'wooden_pickaxe', mode: 'survival' }],
      [{ type: 'obtain', item: 'wooden_axe', mode: 'survival' }],
      [{ type: 'obtain', item: 'wooden_sword', mode: 'survival' }],
    ],
  ],
  [
    'stone_tool',
    [
      [{ type: 'obtain', item: 'stone_pickaxe', mode: 'survival' }],
      [{ type: 'obtain', item: 'stone_axe', mode: 'survival' }],
      [{ type: 'obtain', item: 'stone_sword', mode: 'survival' }],
    ],
  ],
  [
    'iron_tool',
    [
      [{ type: 'obtain', item: 'iron_pickaxe', mode: 'survival' }],
      [{ type: 'obtain', item: 'iron_axe', mode: 'survival' }],
      [{ type: 'obtain', item: 'iron_sword', mode: 'survival' }],
    ],
  ],
  ['hot_stuff', [[{ type: 'smelt-take', mode: 'survival' }]]],
  ['tasty', [[{ type: 'ate', item: 'apple', mode: 'survival' }]]],
  ['stone_age', [[{ type: 'obtain', item: 'cobblestone', mode: 'survival' }]]],
  ['coal_miner', [[{ type: 'obtain', item: 'coal', mode: 'survival' }]]],
  [
    'iron_age',
    [
      [{ type: 'obtain', item: 'iron_ore', mode: 'survival' }],
      [{ type: 'obtain', item: 'raw_iron', mode: 'survival' }],
    ],
  ],
  ['monster_hunter', [[{ type: 'mob-killed', mode: 'survival' }]]],
  [
    'pasture',
    [
      [{ type: 'obtain', item: 'raw_chicken', mode: 'survival' }],
      [{ type: 'obtain', item: 'raw_porkchop', mode: 'survival' }],
      [{ type: 'obtain', item: 'raw_mutton', mode: 'survival' }],
      [{ type: 'obtain', item: 'raw_beef', mode: 'survival' }],
      [{ type: 'obtain', item: 'wool', mode: 'survival' }],
    ],
  ],
  [
    'first_night',
    [[{ type: 'phase', phase: 'night' }, { type: 'phase', phase: 'day' }]],
  ],
];

describe('checkAdvancements', () => {
  it.each(TRIGGERS)('unlocks %s from its trigger event(s)', (id, sequences) => {
    for (const events of sequences) {
      let state = emptyAdvancements();
      let unlocked: AdvancementId[] = [];
      for (const ev of events) {
        ({ state, unlocked } = checkAdvancements(state, ev));
      }
      expect(state.done[id]).toBe(true);
      expect(unlocked).toContain(id);
      expect(Object.keys(state.done)).toEqual([id]); // that trigger unlocks nothing else
    }
  });

  it('ignores obtain and mob-killed events in creative mode', () => {
    const state = emptyAdvancements();
    const creativeEvents: AdvancementEvent[] = [
      { type: 'obtain', item: 'oak_log', mode: 'creative' },
      { type: 'obtain', item: 'iron_ore', mode: 'creative' },
      { type: 'obtain', item: 'iron_pickaxe', mode: 'creative' },
      { type: 'mob-killed', mode: 'creative' },
      { type: 'smelt-take', mode: 'creative' },
      { type: 'ate', item: 'apple', mode: 'creative' },
    ];
    for (const ev of creativeEvents) {
      const r = checkAdvancements(state, ev);
      expect(r.unlocked).toEqual([]);
      expect(r.state).toBe(state); // unchanged — literally the same state
    }
    expect(state.done).toEqual({});
  });

  // ---- B4 Task 1：牧場（pasture）進度 ----

  it('obtaining raw meat or wool unlocks pasture', () => {
    for (const item of ['raw_chicken', 'raw_porkchop', 'raw_mutton', 'raw_beef', 'wool'] as const) {
      const r = checkAdvancements(emptyAdvancements(), { type: 'obtain', item, mode: 'survival' });
      expect(r.unlocked).toEqual(['pasture']);
      expect(r.state.done.pasture).toBe(true);
    }
  });

  it('creative obtains unlock nothing (pasture included)', () => {
    const state = emptyAdvancements();
    for (const item of ['raw_chicken', 'raw_porkchop', 'raw_mutton', 'raw_beef', 'wool'] as const) {
      const r = checkAdvancements(state, { type: 'obtain', item, mode: 'creative' });
      expect(r.unlocked).toEqual([]);
      expect(r.state).toBe(state); // unchanged — literally the same state
    }
  });

  // ---- B5 Task 5：金／鑽石進度 ----

  it('obtaining gold or a diamond unlocks the new advancements', () => {
    for (const item of ['raw_gold', 'gold_ingot'] as const) {
      const r = checkAdvancements(emptyAdvancements(), { type: 'obtain', item, mode: 'survival' });
      expect(r.unlocked).toEqual(['gold_age']);
      expect(r.state.done.gold_age).toBe(true);
    }
    const d = checkAdvancements(emptyAdvancements(), {
      type: 'obtain',
      item: 'diamond',
      mode: 'survival',
    });
    expect(d.unlocked).toEqual(['diamond_age']);
    expect(d.state.done.diamond_age).toBe(true);
  });

  it('gold and diamond tools unlock their tool advancements', () => {
    for (const item of ['golden_pickaxe', 'golden_axe', 'golden_sword', 'golden_shovel'] as const) {
      const r = checkAdvancements(emptyAdvancements(), { type: 'obtain', item, mode: 'survival' });
      expect(r.unlocked).toEqual(['golden_tool']);
    }
    for (const item of ['diamond_pickaxe', 'diamond_axe', 'diamond_sword', 'diamond_shovel'] as const) {
      const r = checkAdvancements(emptyAdvancements(), { type: 'obtain', item, mode: 'survival' });
      expect(r.unlocked).toEqual(['diamond_tool']);
    }
  });

  it('spruce and birch logs count as getting wood', () => {
    for (const item of ['spruce_log', 'birch_log'] as const) {
      const r = checkAdvancements(emptyAdvancements(), { type: 'obtain', item, mode: 'survival' });
      expect(r.unlocked).toEqual(['getting_wood']);
    }
  });

  it('does not unlock an already-done advancement again', () => {
    const first = checkAdvancements(emptyAdvancements(), {
      type: 'obtain',
      item: 'oak_log',
      mode: 'survival',
    });
    const second = checkAdvancements(first.state, {
      type: 'obtain',
      item: 'oak_log',
      mode: 'survival',
    });
    expect(first.unlocked).toEqual(['getting_wood']);
    expect(second.unlocked).toEqual([]);
    expect(second.state.done.getting_wood).toBe(true);
    // ate is apple-only: eating a non-apple unlocks nothing (same state back)
    const ateStick = checkAdvancements(second.state, {
      type: 'ate',
      item: 'stick',
      mode: 'survival',
    });
    expect(ateStick.unlocked).toEqual([]);
    expect(ateStick.state).toBe(second.state);
  });

  it('requires a seen night before first_night can unlock at day', () => {
    // day alone (no night seen) → nothing — and day must not set nightSeen either
    const dayOnly = checkAdvancements(emptyAdvancements(), { type: 'phase', phase: 'day' });
    expect(dayOnly.unlocked).toEqual([]);
    expect(dayOnly.state.done.first_night).toBeUndefined();
    expect(dayOnly.state.nightSeen).toBe(false);
    // night marks nightSeen but does NOT unlock first_night by itself
    const night = checkAdvancements(dayOnly.state, { type: 'phase', phase: 'night' });
    expect(night.unlocked).toEqual([]);
    expect(night.state.done.first_night).toBeUndefined();
    expect(night.state.nightSeen).toBe(true);
    // the day after that night unlocks it
    const day = checkAdvancements(night.state, { type: 'phase', phase: 'day' });
    expect(day.unlocked).toEqual(['first_night']);
    expect(day.state.done.first_night).toBe(true);
  });

  it('never mutates the input state (fresh state when something changes)', () => {
    const state = emptyAdvancements();
    const snapshot = structuredClone(state);
    const night = checkAdvancements(state, { type: 'phase', phase: 'night' });
    expect(state).toEqual(snapshot);
    expect(night.state).not.toBe(state);
    expect(night.state.nightSeen).toBe(true);

    const obtain = checkAdvancements(night.state, {
      type: 'obtain',
      item: 'coal',
      mode: 'survival',
    });
    expect(night.state).toEqual({ done: {}, nightSeen: true });
    expect(obtain.state).not.toBe(night.state);
    expect(obtain.state.done).toEqual({ coal_miner: true });
    expect(night.state.done.coal_miner).toBeUndefined();
  });
});

describe('sanitizeAdvancements', () => {
  it('drops unknown ids and non-boolean values; non-objects become empty', () => {
    const empty = { done: {}, nightSeen: false };
    expect(sanitizeAdvancements(null)).toEqual(empty);
    expect(sanitizeAdvancements(undefined)).toEqual(empty);
    expect(sanitizeAdvancements('garbage')).toEqual(empty);
    expect(sanitizeAdvancements(42)).toEqual(empty);
    // mixed keys: known+boolean survive; unknown ids and non-booleans drop
    expect(
      sanitizeAdvancements({
        done: { getting_wood: true, made_up_id: true, coal_miner: 'yes', wooden_tool: false },
        nightSeen: 'yes',
      }),
    ).toEqual({ done: { getting_wood: true, wooden_tool: false }, nightSeen: false });
    // new Task-7 ids are known: retained; unknown ids still drop
    expect(
      sanitizeAdvancements({
        done: { iron_tool: true, hot_stuff: true, tasty: false, bogus_id: true },
        nightSeen: true,
      }),
    ).toEqual({ done: { iron_tool: true, hot_stuff: true, tasty: false }, nightSeen: true });
  });
});
