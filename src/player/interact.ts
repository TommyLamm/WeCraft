import { getBlockDef, BLOCK, type ToolKind } from '../world/blocks';
import type { World } from '../world/world';
import type { RayHit } from '../world/raycast';
import { CHUNK_HEIGHT } from '../world/chunk';
import { PLAYER_HALF_WIDTH, PLAYER_HEIGHT } from './physics';
import type { ItemId, ItemStack } from '../core/items';
import type { GameMode } from '../core/inventory';
import { spawnDrop, dropItemFor, type DropEntity } from '../world/drops';
import { damageMob, type Mob } from '../world/mobs';

/** Block broken (Task 7) → spawn a world drop at `pos` (block centre) instead
 *  of adding straight to the inventory: survival only — creative spawns nothing
 *  (infinite supply). Air/water have no item form and spawn nothing too.
 *  Drop mapping via `dropItemFor` (coal_ore → coal; iron_ore stays iron_ore —
 *  smelting-free). Pickup is proximity-based (main loop + `pickable`/`pickup`).
 *  Returns the new drops array — unchanged (same ref) when nothing spawns. */
export function spawnBlockDrop(
  drops: DropEntity[],
  mode: GameMode,
  blockId: number,
  pos: { x: number; y: number; z: number },
): DropEntity[] {
  if (mode === 'creative') return drops;
  const item = dropItemFor(blockId);
  if (!item) return drops;
  return spawnDrop(drops, item, 1, pos);
}

// ---- Survival mining (Task 5): vanilla break-time formula + harvest gates ----

/** Tool tiers that exist as items (wooden/stone/iron pickaxe + axe). `level` is
 *  the harvest tier (0/1/2), `speed` the vanilla mining multiplier (2/4/6).
 *  Swords are deliberately absent — a sword is not a tool: it never speeds
 *  mining up and never satisfies a `requiredTool`. Shovels are absent too
 *  (`ItemId` has none yet), so shovel-fast blocks always mine at speed 1. */
const TOOL_INFO: Readonly<
  Partial<Record<ItemId, { kind: ToolKind; level: number; speed: number }>>
> = {
  wooden_pickaxe: { kind: 'pickaxe', level: 0, speed: 2 },
  stone_pickaxe: { kind: 'pickaxe', level: 1, speed: 4 },
  iron_pickaxe: { kind: 'pickaxe', level: 2, speed: 6 },
  wooden_axe: { kind: 'axe', level: 0, speed: 2 },
  stone_axe: { kind: 'axe', level: 1, speed: 4 },
  iron_axe: { kind: 'axe', level: 2, speed: 6 },
};

/** Can `held` (a hotbar stack; null = bare hand) harvest `blockId`?
 *
 *  Vanilla shape: `requiredTool === null` → always harvestable, whatever is in
 *  hand; otherwise the held item must be a tool of the required kind at or
 *  above the required level (stone family: wooden pickaxe, level 0; iron ore:
 *  stone pickaxe, level 1). Task 6 uses this to gate drops. */
export function canHarvest(blockId: number, held: ItemStack | null): boolean {
  const req = getBlockDef(blockId).requiredTool;
  if (req === null) return true;
  const info = held ? TOOL_INFO[held.item] : undefined;
  return info !== undefined && info.kind === req.kind && info.level >= req.level;
}

/** Mining-speed multiplier for `held` while digging `blockId` (survival only —
 *  creative breaks instantly): the matching tool's vanilla speed when the held
 *  tool's kind is the block's required kind (stone family) or its fast kind
 *  (shovel on dirt/grass/sand/snow, axe on log/planks/crafting table/furnace),
 *  else 1 — a wrong kind never speeds a block up. Unbreakable blocks
 *  (hardness Infinity) report 1 too: their break time is Infinity regardless.
 *  Note the tier gate is NOT applied here — a wooden pickaxe still mines iron
 *  ore at 2× (the ×5 penalty comes from `getBreakTime`'s harvest check). */
export function toolSpeed(blockId: number, held: ItemStack | null): number {
  const def = getBlockDef(blockId);
  if (!Number.isFinite(def.hardness)) return 1; // bedrock/water unchanged
  const wanted = def.requiredTool?.kind ?? def.fastTool;
  const info = held ? TOOL_INFO[held.item] : undefined;
  return info && wanted && info.kind === wanted ? info.speed : 1;
}

/** Seconds to break `blockId` with `held` (MC Java 1.20+ formula):
 *  `hardness × (canHarvest ? 1.5 : 5) ÷ toolSpeed`. Harvestable blocks get the
 *  fast ×1.5 rate; a tool that cannot harvest pays the ×5 penalty even when its
 *  kind matches (iron ore + wooden pickaxe: 3.0 × 5 / 2 = 7.5 s). Infinity for
 *  unbreakable blocks (bedrock/water). */
export function getBreakTime(blockId: number, held: ItemStack | null): number {
  const h = getBlockDef(blockId).hardness;
  if (!Number.isFinite(h)) return Infinity;
  return (h * (canHarvest(blockId, held) ? 1.5 : 5)) / toolSpeed(blockId, held);
}

// ---- Melee combat (Task 9) ----

/** Melee damage dealt per hit with `heldItem` (a hotbar item id; null = bare
 *  hand): swords 4 (wooden) / 5 (stone) / 6 (iron), pickaxes 2, axes 3. Bare hand (and
 *  apple/stick/blocks): the plan's damage table says 2, this ships 1 — the
 *  Task 9 call was Minecraft parity (fist = 1), recorded here honestly since
 *  the plan text still reads 2 (the plan doc itself is orchestrator-owned and
 *  was not edited). Pure and item-only like `toolSpeed`; combat applies in
 *  both game modes (mobs exist regardless). */
export function toolDamage(heldItem: ItemId | null): number {
  switch (heldItem) {
    case 'wooden_sword':
      return 4;
    case 'stone_sword':
      return 5;
    case 'iron_sword':
      return 6;
    case 'wooden_axe':
    case 'stone_axe':
    case 'iron_axe':
      return 3;
    case 'wooden_pickaxe':
    case 'stone_pickaxe':
    case 'iron_pickaxe':
      return 2;
    default:
      return 1;
  }
}

/** Settled mob hitbox for the ray test: centred on `pos` in X/Z (±0.35),
 *  y from the feet up 1.8 blocks. */
const MOB_HALF_WIDTH = 0.35;
const MOB_HITBOX_HEIGHT = 1.8;

/** Parametric ray vs AABB (slab method): entry `t` of the first intersection
 *  at or after the origin, or null when the box is missed or lies entirely
 *  behind the origin. A ray starting inside the box returns 0 (point-blank
 *  hits register). `dir` must be normalized by the caller — `t` is then
 *  measured in world blocks. */
function rayBoxEntry(
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  min: { x: number; y: number; z: number },
  max: { x: number; y: number; z: number },
): number | null {
  let tMin = -Infinity; // latest slab entry
  let tMax = Infinity; // earliest slab exit
  for (const axis of ['x', 'y', 'z'] as const) {
    const o = origin[axis];
    const d = dir[axis];
    if (d === 0) {
      if (o < min[axis] || o > max[axis]) return null; // parallel: never crosses this slab
      continue;
    }
    let t1 = (min[axis] - o) / d;
    let t2 = (max[axis] - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1]; // enter/exit order regardless of direction
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null; // slabs don't overlap → no intersection
  }
  if (tMax < 0) return null; // box entirely behind the ray origin
  return Math.max(tMin, 0); // 0 = origin inside the box
}

/** The id of the NEAREST mob whose hitbox the ray crosses within `reach`
 *  (distance along the normalized look direction), or null on a miss.
 *  Pure: the input list is untouched, and NaN/zero directions or
 *  non-finite reach never hit (repo NaN-guard norm). Main.ts also calls
 *  this directly to keep digging suppressed while a mob sits under the
 *  crosshair (attack cooldown running); `attackMob` uses it internally. */
export function hitMobId(
  mobs: readonly Mob[],
  eyePos: { x: number; y: number; z: number },
  lookDir: { x: number; y: number; z: number },
  reach: number,
): number | null {
  if (!Number.isFinite(reach) || reach <= 0) return null;
  if (![eyePos.x, eyePos.y, eyePos.z, lookDir.x, lookDir.y, lookDir.z].every(Number.isFinite)) {
    return null;
  }
  const len = Math.hypot(lookDir.x, lookDir.y, lookDir.z);
  if (len === 0) return null;
  const dir = { x: lookDir.x / len, y: lookDir.y / len, z: lookDir.z / len };

  let bestT = Infinity;
  let bestId: number | null = null;
  for (const m of mobs) {
    if (![m.pos.x, m.pos.y, m.pos.z].every(Number.isFinite)) continue;
    const t = rayBoxEntry(
      eyePos,
      dir,
      { x: m.pos.x - MOB_HALF_WIDTH, y: m.pos.y, z: m.pos.z - MOB_HALF_WIDTH },
      { x: m.pos.x + MOB_HALF_WIDTH, y: m.pos.y + MOB_HITBOX_HEIGHT, z: m.pos.z + MOB_HALF_WIDTH },
    );
    if (t === null || t > reach) continue;
    if (t < bestT) {
      bestT = t;
      bestId = m.id; // strict < → first in list wins an exact tie
    }
  }
  return bestId;
}

/** Result of one swing: the mob list with the hit mob's damage + knockback
 *  applied, and the hit mob's `id` for the renderer's flash (null on a miss).
 *  Miss → the SAME array reference (spawnBlockDrop contract style) with
 *  `hitId: null`. A killed mob (hp ≤ 0) stays in the list — the caller
 *  filters `isDead` and emits `mobs-changed` (settled). */
export interface AttackResult {
  mobs: Mob[];
  hitId: number | null;
}

/** One melee attack: find the nearest mob under `lookDir` within `reach`
 *  (same origin/dir/reach main uses for the block raycast), apply `damage`
 *  plus a knockback impulse along `knockDir` (pass the look direction —
 *  `damageMob` normalizes over XZ and ignores y). Pure: new mob objects,
 *  the input array is never mutated; non-finite damage is a no-op inside
 *  `damageMob`. */
export function attackMob(
  mobs: Mob[],
  eyePos: { x: number; y: number; z: number },
  lookDir: { x: number; y: number; z: number },
  reach: number,
  damage: number,
  knockDir: { x: number; y?: number; z: number },
): AttackResult {
  const hitId = hitMobId(mobs, eyePos, lookDir, reach);
  if (hitId === null) return { mobs, hitId: null }; // miss → same ref
  let applied = false;
  const next = mobs.map((m) => {
    if (applied || m.id !== hitId) return m; // untouched mobs keep their refs
    applied = true;
    return damageMob(m, damage, knockDir);
  });
  return { mobs: next, hitId };
}

/** Per-frame contract: call update(blockId, hit, dt, breakTimeSec) before
 *  isDone(blockId, breakTimeSec) each frame with the same target; isDone
 *  assumes progress belongs to the current target key. `breakTimeSec` is the
 *  held stack's REAL break time for the target — `getBreakTime` already has
 *  the tool-speed factor applied inside it. Progress accumulates
 *  `dt / breakTimeSec` (0..1 bar), so the block breaks after exactly
 *  `breakTimeSec` seconds of real time; a non-finite break time (bedrock/
 *  water) never accumulates. */
export class DigProgress {
  private key = '';
  progress = 0;

  update(blockId: number, hit: RayHit, dt: number, breakTimeSec: number): void {
    const k = `${hit.x},${hit.y},${hit.z},${blockId}`;
    if (k !== this.key) {
      this.key = k;
      this.progress = 0;
    }
    if (!Number.isFinite(breakTimeSec)) return; // bedrock 永不累進
    this.progress = Math.min(1, this.progress + dt / breakTimeSec);
  }

  isDone(blockId: number, breakTimeSec: number): boolean {
    return (
      Number.isFinite(breakTimeSec) &&
      this.progress >= 1 &&
      this.key.endsWith(`,${blockId}`)
    );
  }

  reset(): void {
    this.key = '';
    this.progress = 0;
  }
}

/** One frame of digging → does the target break now?
 *
 *  Creative (plan 5.5 "creative keeps instant dig"): breaks on the first step —
 *  no progress ever accumulates (`dig` is reset so no timer leaks across a mode
 *  switch). The unbreakable list (bedrock/water, hardness Infinity) still never
 *  breaks, in either mode. Survival: resolves the held stack's real break time
 *  (hardness × 1.5/×5 ÷ tool speed, `getBreakTime` — wooden pickaxe on iron
 *  ore = 7.5s) and drives the timed `DigProgress` with it, then reports
 *  `isDone`. */
export function digStep(
  mode: GameMode,
  dig: DigProgress,
  blockId: number,
  hit: RayHit,
  dt: number,
  held: ItemStack | null,
): boolean {
  const time = getBreakTime(blockId, held);
  if (!Number.isFinite(time)) return false; // unbreakable: never, both modes
  if (mode === 'creative') {
    dig.reset(); // mode-switch hygiene: drop leftover survival progress (creative never accumulates)
    return true;
  }
  dig.update(blockId, hit, dt, time);
  return dig.isDone(blockId, time);
}

export function placeTarget(hit: RayHit): { x: number; y: number; z: number } {
  if (Math.abs(hit.nx) + Math.abs(hit.ny) + Math.abs(hit.nz) !== 1) {
    return { x: hit.x, y: hit.y, z: hit.z };
  }
  return { x: hit.x + hit.nx, y: hit.y + hit.ny, z: hit.z + hit.nz };
}

export function canPlaceAt(
  world: World,
  x: number,
  y: number,
  z: number,
  playerPos: { x: number; y: number; z: number },
): boolean {
  if (y < 0 || y >= CHUNK_HEIGHT) return false;
  const id = world.getBlock(x, y, z);
  if (id !== BLOCK.AIR && id !== BLOCK.WATER) return false; // 只能放進空氣/水

  // 方塊 AABB: [x,x+1]³ vs 玩家 AABB
  const pMinX = playerPos.x - PLAYER_HALF_WIDTH;
  const pMaxX = playerPos.x + PLAYER_HALF_WIDTH;
  const pMinY = playerPos.y;
  const pMaxY = playerPos.y + PLAYER_HEIGHT;
  const pMinZ = playerPos.z - PLAYER_HALF_WIDTH;
  const pMaxZ = playerPos.z + PLAYER_HALF_WIDTH;
  const overlap =
    pMaxX > x && pMinX < x + 1 &&
    pMaxY > y && pMinY < y + 1 &&
    pMaxZ > z && pMinZ < z + 1;
  return !overlap;
}
