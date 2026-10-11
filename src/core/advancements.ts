// Task 11: Minecraft-style advancement rules and state (pure — no Three/DOM).
// The composition root (main.ts) feeds events in and shows toasts for the
// ids returned in `unlocked`; everything here is table-driven data + a pure
// transition function so the rules are testable without a browser.

import type { GameMode } from './inventory';
import type { ItemId } from './items';

export type AdvancementId =
  | 'getting_wood'
  | 'crafting_table'
  | 'wooden_tool'
  | 'stone_tool'
  | 'stone_age'
  | 'coal_miner'
  | 'iron_age'
  | 'monster_hunter'
  | 'first_night';

export interface AdvancementDef {
  id: AdvancementId;
  title: string;
  description: string;
  icon: ItemId;
}

/** The full progression table (Task 11 brief, treated as the spec). Order is
 *  the intended display order for the toast/progress UI. */
export const ADVANCEMENTS: readonly AdvancementDef[] = [
  { id: 'getting_wood', title: '取得原木', description: '第一次拾取原木', icon: 'oak_log' },
  { id: 'crafting_table', title: '合成台', description: '合成一個工作台', icon: 'crafting_table' },
  { id: 'wooden_tool', title: '木製工具', description: '合成一把木製工具', icon: 'wooden_pickaxe' },
  { id: 'stone_tool', title: '石製工具', description: '合成一把石製工具', icon: 'stone_pickaxe' },
  { id: 'stone_age', title: '鵝卵石', description: '取得鵝卵石', icon: 'cobblestone' },
  { id: 'coal_miner', title: '煤炭開採', description: '取得煤炭', icon: 'coal' },
  { id: 'iron_age', title: '鐵礦', description: '取得鐵礦', icon: 'iron_ore' },
  { id: 'monster_hunter', title: '怪物獵人', description: '擊殺一隻怪物', icon: 'stone_sword' },
  { id: 'first_night', title: '度過第一夜', description: '活著看見黎明', icon: 'grass' },
];

/** Unlock progress: `done` marks unlocked ids (absent = locked); `nightSeen`
 *  records that a night phase was witnessed — the first_night prerequisite. */
export interface AdvancementState {
  done: Partial<Record<AdvancementId, boolean>>;
  nightSeen: boolean;
}

export function emptyAdvancements(): AdvancementState {
  return { done: {}, nightSeen: false };
}

export type AdvancementEvent =
  | { type: 'obtain'; item: ItemId; mode: GameMode }
  | { type: 'mob-killed'; mode: GameMode }
  | { type: 'phase'; phase: 'day' | 'night' };

/** Obtain → advancement map (Task 11 brief): the 11 item triggers across 7
 *  ids. wood/stone tools share one id per tier; `stone_sword` only triggers
 *  stone_tool here — monster_hunter needs the kill event. */
const OBTAIN_UNLOCKS: Readonly<Partial<Record<ItemId, AdvancementId>>> = {
  oak_log: 'getting_wood',
  crafting_table: 'crafting_table',
  wooden_pickaxe: 'wooden_tool',
  wooden_axe: 'wooden_tool',
  wooden_sword: 'wooden_tool',
  stone_pickaxe: 'stone_tool',
  stone_axe: 'stone_tool',
  stone_sword: 'stone_tool',
  cobblestone: 'stone_age',
  coal: 'coal_miner',
  iron_ore: 'iron_age',
};

/** Apply one game event to the progress state. PURE: the input state is never
 *  mutated — a changed transition returns a FRESH state (unchanged ones return
 *  the original by reference, matching "nothing happened"). Rules:
 *  - obtain/mob-killed in CREATIVE unlock nothing (infinite blocks are not
 *    progression);
 *  - already-done ids never unlock twice (no toast spam);
 *  - `phase:'night'` only marks `nightSeen`; `phase:'day'` unlocks first_night
 *    once a night has been seen (surviving to dawn). */
export function checkAdvancements(
  state: AdvancementState,
  ev: AdvancementEvent,
): { state: AdvancementState; unlocked: AdvancementId[] } {
  if (ev.type === 'phase') {
    if (ev.phase === 'night') {
      if (state.nightSeen) return { state, unlocked: [] };
      return { state: { done: { ...state.done }, nightSeen: true }, unlocked: [] };
    }
    if (!state.nightSeen || state.done.first_night) return { state, unlocked: [] };
    return {
      state: { done: { ...state.done, first_night: true }, nightSeen: true },
      unlocked: ['first_night'],
    };
  }
  if (ev.mode === 'creative') return { state, unlocked: [] };
  const id = ev.type === 'obtain' ? OBTAIN_UNLOCKS[ev.item] : 'monster_hunter';
  if (!id || state.done[id]) return { state, unlocked: [] };
  return { state: { done: { ...state.done, [id]: true }, nightSeen: state.nightSeen }, unlocked: [id] };
}

const ADVANCEMENT_IDS: ReadonlySet<string> = new Set(ADVANCEMENTS.map((a) => a.id));

/** Coerce an untrusted value (IndexedDB record) into a valid state: non-objects
 *  → empty; unknown ids, non-boolean `done` values and a non-boolean
 *  `nightSeen` are dropped. Always returns a fresh object. */
export function sanitizeAdvancements(x: unknown): AdvancementState {
  if (typeof x !== 'object' || x === null) return emptyAdvancements();
  const r = x as { done?: unknown; nightSeen?: unknown };
  const done: Partial<Record<AdvancementId, boolean>> = {};
  if (typeof r.done === 'object' && r.done !== null) {
    for (const [id, value] of Object.entries(r.done)) {
      if (ADVANCEMENT_IDS.has(id) && typeof value === 'boolean') {
        done[id as AdvancementId] = value;
      }
    }
  }
  return { done, nightSeen: r.nightSeen === true };
}
