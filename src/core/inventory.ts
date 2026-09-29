import { maxStack, type ItemId, type ItemStack } from './items';

export type GameMode = 'survival' | 'creative';

/** Stack-based inventory model wrapping the hotbar slots (pure — no DOM/Three).
 *  Capacity is fixed at creation from `initialSlots`; `slots` is the live array
 *  the HUD/palette render (read-only for consumers — mutate via the methods below,
 *  the model keeps its own mutable view internally). */
export interface InventoryModel {
  readonly slots: ReadonlyArray<ItemStack | null>;
  readonly mode: GameMode;
  setMode(mode: GameMode): void;
  /** Add items respecting maxStack: merges into partial stacks, then splits
   *  across empty slots. Returns the overflow count that did not fit.
   *  No-op returning 0 in creative (infinite supply). */
  addItem(item: ItemId, count: number): number;
  /** Decrement up to `count` across slots, clearing emptied ones. Returns the
   *  number actually removed. No-op returning 0 in creative (never consumes). */
  removeItem(item: ItemId, count: number): number;
  /** Total of `item` summed across slots. */
  countItem(item: ItemId): number;
  /** Pure capacity pre-check: true iff `count` of `item` would fit entirely
   *  (slack in matching partial stacks + empty slots × maxStack ≥ count).
   *  Never mutates — the crafting take path calls this BEFORE `addItem`,
   *  which otherwise commits partial merges before reporting its remainder
   *  (review Critical #1). count ≤ 0 → true (nothing to add); NaN or
   *  +Infinity → false.
   *  No mode branch (documented): creative's take path is unreachable
   *  (crafting is hidden there, plan 12.4). */
  fits(item: ItemId, count: number): boolean;
  /** Direct slot write (palette pick, hotbar swap). Validates + copies on write:
   *  null or count < 1 clears the slot; count is floored and clamped to maxStack;
   *  the stored stack never aliases the caller's object. Out-of-range ignored. */
  setSlot(index: number, stack: ItemStack | null): void;
  /** Spend exactly `count` from `slot` (right-click placement). `count` must be
   *  an integer ≥ 1 — negative/fractional/NaN return false with no mutation
   *  (siblings `addItem`/`removeItem`/`setSlot` harden the same way). Creative
   *  is an infinite no-op returning true (placement never consumes); survival
   *  returns false WITHOUT mutating when the slot is null, out of range or
   *  under-stocked, otherwise decrements that slot alone (cleared at 0) and
   *  returns true. */
  spendFromSlot(slot: number, count: number): boolean;
}

/** `mode` defaults to creative: Phase 1 behavior — infinite blocks, drops never collected. */
export function createInventoryModel(
  initialSlots: ReadonlyArray<ItemStack | null> = [],
  mode: GameMode = 'creative',
): InventoryModel {
  const slots: Array<ItemStack | null> = initialSlots.map((s) => (s ? { ...s } : null));
  let currentMode = mode;

  return {
    slots,
    get mode() {
      return currentMode;
    },
    setMode(next) {
      currentMode = next;
    },
    addItem(item, count) {
      if (currentMode === 'creative' || count <= 0) return 0;
      const cap = maxStack(item);
      let remaining = count;
      // pass 1: top up partial stacks of this item
      for (const s of slots) {
        if (remaining <= 0) break;
        if (!s || s.item !== item || s.count >= cap) continue;
        const put = Math.min(cap - s.count, remaining);
        s.count += put;
        remaining -= put;
      }
      // pass 2: fill empty slots, splitting into new stacks as needed
      for (let i = 0; i < slots.length && remaining > 0; i++) {
        if (slots[i]) continue;
        const put = Math.min(cap, remaining);
        slots[i] = { item, count: put };
        remaining -= put;
      }
      return remaining;
    },
    removeItem(item, count) {
      if (currentMode === 'creative' || count <= 0) return 0;
      let toRemove = count;
      for (let i = 0; i < slots.length && toRemove > 0; i++) {
        const s = slots[i];
        if (!s || s.item !== item) continue;
        const take = Math.min(s.count, toRemove);
        s.count -= take;
        toRemove -= take;
        if (s.count === 0) slots[i] = null; // clear only the slots we touched
      }
      return count - toRemove;
    },
    countItem(item) {
      let total = 0;
      for (const s of slots) if (s && s.item === item) total += s.count;
      return total;
    },
    fits(item, count) {
      if (count <= 0) return true; // nothing to add (covers -Infinity)
      if (!Number.isFinite(count)) return false; // NaN / +Infinity
      const cap = maxStack(item);
      let slack = 0;
      for (const s of slots) {
        if (!s) slack += cap; // empty slot can hold a whole new stack
        else if (s.item === item && s.count < cap) slack += cap - s.count;
      }
      return slack >= count; // mirrors addItem's two passes exactly
    },
    setSlot(index, stack) {
      if (index < 0 || index >= slots.length) return;
      if (!stack || !(stack.count >= 1)) {
        slots[index] = null; // count < 1 (0/negative/NaN) is invalid → clear
        return;
      }
      slots[index] = {
        item: stack.item,
        count: Math.min(Math.floor(stack.count), maxStack(stack.item)),
      };
    },
    spendFromSlot(slot, count) {
      if (!Number.isInteger(count) || count < 1) return false; // no dupes/fractions/NaN
      if (currentMode === 'creative') return true; // infinite supply — never consumes
      const s = slots[slot];
      if (!s || s.count < count) return false; // null / out of range / under-stocked
      s.count -= count;
      if (s.count === 0) slots[slot] = null;
      return true;
    },
  };
}
