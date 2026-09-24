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
  /** Direct slot write (palette pick, hotbar swap). Validates + copies on write:
   *  null or count < 1 clears the slot; count is floored and clamped to maxStack;
   *  the stored stack never aliases the caller's object. Out-of-range ignored. */
  setSlot(index: number, stack: ItemStack | null): void;
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
  };
}
