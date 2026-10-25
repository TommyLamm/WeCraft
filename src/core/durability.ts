// 最大耐久依「材質」（Java Edition 1.20+）：金 32／木 59／石 131／
// 鐵 250／鑽 1561；同一材質的鎬／斧／鏟／劍同值。dur 是「剩餘耐久」。
import type { ItemId, ItemStack } from './items';

/** 最大耐久（依材質；同一材質的鎬／斧／鏟／劍同值）。 */
export const TOOL_MAX_DURABILITY: Readonly<Partial<Record<ItemId, number>>> = {
  wooden_pickaxe: 59, wooden_axe: 59, wooden_shovel: 59, wooden_sword: 59,
  stone_pickaxe: 131, stone_axe: 131, stone_shovel: 131, stone_sword: 131,
  iron_pickaxe: 250, iron_axe: 250, iron_shovel: 250, iron_sword: 250,
  golden_pickaxe: 32, golden_axe: 32, golden_shovel: 32, golden_sword: 32,
  diamond_pickaxe: 1561, diamond_axe: 1561, diamond_shovel: 1561, diamond_sword: 1561,
};

export function maxDurability(item: string): number {
  return Object.hasOwn(TOOL_MAX_DURABILITY, item) ? TOOL_MAX_DURABILITY[item as ItemId]! : 0;
}

export function isDurableItem(item: string): boolean {
  return maxDurability(item) > 0;
}

export function currentDurability(stack: { item: string; dur?: number }): number {
  const max = maxDurability(stack.item);
  if (max === 0) return 0;
  const dur = stack.dur;
  return typeof dur === 'number' && Number.isInteger(dur) && dur >= 0 && dur <= max ? dur : max;
}

export function normalizeDurability(item: string, dur: unknown): number | undefined {
  const max = maxDurability(item);
  if (max === 0) return undefined;
  if (typeof dur !== 'number' || !Number.isFinite(dur)) return undefined;
  if (!Number.isInteger(dur)) return undefined;
  if (dur < 0) return undefined;
  if (dur > max) return max;
  return dur;
}

export interface DurabilityResult {
  stack: ItemStack | null;
  broke: boolean;
}

export function damageStack(stack: ItemStack, amount: number): DurabilityResult {
  if (!Number.isFinite(amount) || amount <= 0) return { stack, broke: false };
  const max = maxDurability(stack.item);
  if (max === 0) return { stack, broke: false };
  const next = currentDurability(stack) - Math.floor(amount);
  if (next <= 0) return { stack: null, broke: true };
  return { stack: { ...stack, dur: next }, broke: false };
}
