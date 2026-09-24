import { getBlockDef, BLOCK } from '../world/blocks';
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

export function getBreakTime(blockId: number): number {
  return getBlockDef(blockId).hardness;
}

// ---- Survival mining table (Task 5) ----

type ToolCategory = 'pickaxe' | 'axe';

/** Blocks mined fastest with a pickaxe (stone family). */
const PICKAXE_BLOCKS: ReadonlySet<number> = new Set([
  BLOCK.STONE, BLOCK.COBBLE, BLOCK.COAL_ORE, BLOCK.IRON_ORE,
]);
/** Blocks mined fastest with an axe. */
const AXE_BLOCKS: ReadonlySet<number> = new Set([BLOCK.LOG]);

const PICKAXES: ReadonlySet<ItemId> = new Set(['wooden_pickaxe', 'stone_pickaxe']);
const AXES: ReadonlySet<ItemId> = new Set(['wooden_axe', 'stone_axe']);
const SWORDS: ReadonlySet<ItemId> = new Set(['wooden_sword', 'stone_sword']);

function requiredTool(blockId: number): ToolCategory | null {
  if (PICKAXE_BLOCKS.has(blockId)) return 'pickaxe';
  if (AXE_BLOCKS.has(blockId)) return 'axe';
  return null;
}

/** Mining-speed multiplier for holding `held` (a hotbar stack; null = bare hand)
 *  while digging `blockId`. Survival mode only — creative dig ignores it.
 *
 *  Table (Task 5), documented choices:
 *  - unbreakable (bedrock/water, hardness Infinity) → 1× — the rate never
 *    accumulates for them anyway (`DigProgress` guards on finite break time);
 *  - no required tool (dirt, grass, sand, leaves, planks, glass, snow, …) → 1×
 *    with anything in hand;
 *  - matching tool (pickaxe on the stone family, axe on logs) → 2×;
 *  - wrong tool (axe on stone, pickaxe on logs, a sword on a required block) → 0.5×;
 *  - bare hand / non-tool item: treated like the wrong tool on pickaxe blocks
 *    (0.5× — hand is the wrong tool for rock, Minecraft-like; our chosen reading,
 *    since the plan text only says "hand 1×" generally and is ambiguous here),
 *    1× on logs (punchable) and on no-tool blocks;
 *  - swords are the documented "wrong tool" case: 0.5× on required blocks,
 *    1× elsewhere. */
export function toolSpeed(blockId: number, held: ItemStack | null): number {
  if (!Number.isFinite(getBlockDef(blockId).hardness)) return 1; // bedrock/water unchanged
  const required = requiredTool(blockId);
  if (!required) return 1;
  const item = held?.item ?? null;
  if (item) {
    const matches = required === 'pickaxe' ? PICKAXES.has(item) : AXES.has(item);
    if (matches) return 2;
    if (PICKAXES.has(item) || AXES.has(item) || SWORDS.has(item)) return 0.5; // wrong tool
  }
  // hand or plain item: rock needs a pickaxe; logs/no-tool blocks take a hand
  return required === 'pickaxe' ? 0.5 : 1;
}

// ---- Melee combat (Task 9) ----

/** Melee damage dealt per hit with `heldItem` (a hotbar item id; null = bare
 *  hand) — the settled Task 9 table: swords 4 (wooden) / 5 (stone), pickaxes 2,
 *  axes 3, everything else (hand, apple, stick, blocks) 1. Pure and item-only
 *  like `toolSpeed`; combat applies in both game modes (mobs exist regardless). */
export function toolDamage(heldItem: ItemId | null): number {
  switch (heldItem) {
    case 'wooden_sword':
      return 4;
    case 'stone_sword':
      return 5;
    case 'wooden_axe':
    case 'stone_axe':
      return 3;
    case 'wooden_pickaxe':
    case 'stone_pickaxe':
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

/** Per-frame contract: call update(blockId, hit, dt, speed?) before isDone(blockId)
 *  each frame with the same target; isDone assumes progress belongs to the current
 *  target key. `speed` multiplies the progress rate (survival passes
 *  `toolSpeed(...)`; default 1 = the base Phase 1 rate). */
export class DigProgress {
  private key = '';
  progress = 0;

  update(blockId: number, hit: RayHit, dt: number, speed = 1): void {
    const k = `${hit.x},${hit.y},${hit.z},${blockId}`;
    if (k !== this.key) {
      this.key = k;
      this.progress = 0;
    }
    const time = getBreakTime(blockId);
    if (!isFinite(time)) return; // bedrock 永不累進
    const rate = Number.isFinite(speed) && speed > 0 ? speed : 1;
    this.progress = Math.min(1, this.progress + (dt * rate) / time);
  }

  isDone(blockId: number): boolean {
    return (
      isFinite(getBreakTime(blockId)) &&
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
 *  breaks, in either mode. Survival: drives the timed `DigProgress` with `speed`
 *  (from `toolSpeed`) and reports `isDone`. */
export function digStep(
  mode: GameMode,
  dig: DigProgress,
  blockId: number,
  hit: RayHit,
  dt: number,
  speed: number,
): boolean {
  if (!Number.isFinite(getBreakTime(blockId))) return false; // unbreakable: never, both modes
  if (mode === 'creative') {
    dig.reset(); // mode-switch hygiene: drop leftover survival progress (creative never accumulates)
    return true;
  }
  dig.update(blockId, hit, dt, speed);
  return dig.isDone(blockId);
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
