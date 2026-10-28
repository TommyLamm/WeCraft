// 塊實體（block entity）：依附在方塊座標上的可持久化狀態。
//
// B8 只有兩種：箱子（27 格）與熔爐（輸入／燃料／產物＋進度）。資料一律以
// 「逐筆丟棄」處理不可信輸入——一筆壞掉的箱子不能讓整份存檔讀不進來
// （比照 B1 的 sanitizeStack／normalizeModeStash）。
import type { ItemStack } from '../core/items';
import { sanitizeSlotsClamped } from '../core/items';
import type { GameMode } from '../core/inventory';
import { CHUNK_HEIGHT } from './chunk';
import { spawnDrop, type DropEntity } from './drops';
import {
  emptyFurnace,
  normalizeFurnaceState,
  type FurnaceState,
} from './furnace';

/** 單一箱子的格數（原版小箱子 27 格）。 */
export const CHEST_SLOTS = 27;

/** 一個世界最多保留的塊實體數（載入與寫出都套用；防爆量）。 */
export const MAX_BLOCK_ENTITIES = 512;

export type BlockEntityKind = 'chest' | 'furnace';

export interface BlockEntity {
  kind: BlockEntityKind;
  x: number;
  y: number;
  z: number;
  /** 箱子：27 格（`kind === 'chest'`）；熔爐：null。 */
  slots: Array<ItemStack | null> | null;
  /** 熔爐：輸入／燃料／產物（`kind === 'furnace'`）；箱子：null。 */
  input: ItemStack | null;
  fuel: ItemStack | null;
  output: ItemStack | null;
  /** 熔爐：已累積的熔煉秒數（0..SMELT_TIME_SEC）；箱子：0。 */
  progressSec: number;
  /** 熔爐：燃料剩餘可熔煉次數（0..MAX_FUEL_UNITS，可為小數）；箱子：0。 */
  fuelUnits: number;
}

/** 與 `world.modified` 相同的座標鍵格式。 */
export function blockEntityKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export function emptyChestEntity(x: number, y: number, z: number): BlockEntity {
  return {
    kind: 'chest',
    x,
    y,
    z,
    slots: new Array<ItemStack | null>(CHEST_SLOTS).fill(null),
    input: null,
    fuel: null,
    output: null,
    progressSec: 0,
    fuelUnits: 0,
  };
}

export function emptyFurnaceEntity(x: number, y: number, z: number): BlockEntity {
  return {
    kind: 'furnace',
    x,
    y,
    z,
    slots: null,
    input: null,
    fuel: null,
    output: null,
    progressSec: 0,
    fuelUnits: 0,
  };
}

const copyStack = (s: ItemStack | null): ItemStack | null => (s ? { ...s } : null);

export function furnaceStateToEntity(
  state: FurnaceState,
  x: number,
  y: number,
  z: number,
): BlockEntity {
  return {
    kind: 'furnace',
    x,
    y,
    z,
    slots: null,
    input: copyStack(state.input),
    fuel: copyStack(state.fuel),
    output: copyStack(state.output),
    progressSec: state.progressSec,
    fuelUnits: state.fuelUnits,
  };
}

export function entityToFurnaceState(entity: BlockEntity): FurnaceState {
  if (entity.kind !== 'furnace') return emptyFurnace();
  return {
    input: copyStack(entity.input),
    fuel: copyStack(entity.fuel),
    output: copyStack(entity.output),
    progressSec: entity.progressSec,
    fuelUnits: entity.fuelUnits,
  };
}

function sameStack(a: ItemStack | null, b: ItemStack | null): boolean {
  if (a === null || b === null) return a === b;
  return a.item === b.item && a.count === b.count && a.dur === b.dur;
}

/** 兩個熔爐狀態是否「實質相同」——每幀推進用來避免無謂的 map 寫回。 */
export function sameFurnaceState(a: FurnaceState, b: FurnaceState): boolean {
  return (
    a.progressSec === b.progressSec &&
    a.fuelUnits === b.fuelUnits &&
    sameStack(a.input, b.input) &&
    sameStack(a.fuel, b.fuel) &&
    sameStack(a.output, b.output)
  );
}

/** 逐筆正規化；壞的那一筆回 null（呼叫端只丟這一筆）。 */
export function normalizeBlockEntity(raw: unknown): BlockEntity | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== 'chest' && r.kind !== 'furnace') return null;
  const { x, y, z } = r;
  if (
    typeof x !== 'number' || !Number.isInteger(x) ||
    typeof y !== 'number' || !Number.isInteger(y) || y < 0 || y >= CHUNK_HEIGHT ||
    typeof z !== 'number' || !Number.isInteger(z)
  ) {
    return null;
  }

  if (r.kind === 'chest') {
    return {
      kind: 'chest',
      x,
      y,
      z,
      slots: sanitizeSlotsClamped(r.slots, CHEST_SLOTS),
      input: null,
      fuel: null,
      output: null,
      progressSec: 0,
      fuelUnits: 0,
    };
  }

  const state = normalizeFurnaceState(r);
  return {
    kind: 'furnace',
    x,
    y,
    z,
    slots: null,
    input: state.input,
    fuel: state.fuel,
    output: state.output,
    progressSec: state.progressSec,
    fuelUnits: state.fuelUnits,
  };
}

/** 非陣列 → 空清單；逐筆丟棄壞資料、同座標先到先得、最後截到上限。 */
export function normalizeBlockEntities(raw: unknown): BlockEntity[] {
  if (!Array.isArray(raw)) return [];
  const out: BlockEntity[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const entity = normalizeBlockEntity(entry);
    if (!entity) continue;
    const key = blockEntityKey(entity.x, entity.y, entity.z);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entity);
    if (out.length >= MAX_BLOCK_ENTITIES) break;
  }
  return out;
}

/** 寫出用的深拷貝（`dur` 一起帶走）；截到上限。 */
export function serializeBlockEntities(list: ReadonlyArray<BlockEntity>): BlockEntity[] {
  return list.slice(0, MAX_BLOCK_ENTITIES).map((entity) => {
    const source = entity.slots;
    const slots = source
      ? Array.from({ length: CHEST_SLOTS }, (_, i) => copyStack(source[i] ?? null))
      : null;
    return {
      kind: entity.kind,
      x: entity.x,
      y: entity.y,
      z: entity.z,
      slots,
      input: copyStack(entity.input),
      fuel: copyStack(entity.fuel),
      output: copyStack(entity.output),
      progressSec: entity.progressSec,
      fuelUnits: entity.fuelUnits,
    };
  });
}

/** 破壞塊實體時把內容物灑成掉落物。創造模式不灑（回傳同一參考）。 */
export function spillBlockEntity(
  drops: DropEntity[],
  entity: BlockEntity | null,
  pos: { x: number; y: number; z: number },
  mode: GameMode,
): DropEntity[] {
  if (mode === 'creative' || entity === null) return drops;
  let out = drops;
  const spill = (stack: ItemStack | null): void => {
    if (!stack) return;
    out = spawnDrop(
      out,
      stack.item,
      stack.count,
      pos,
      stack.dur !== undefined ? { dur: stack.dur } : {},
    );
  };
  if (entity.kind === 'chest') {
    for (const stack of entity.slots ?? []) spill(stack);
  } else {
    spill(entity.input);
    spill(entity.fuel);
    spill(entity.output);
  }
  return out;
}
