import { itemFromBlock, type ItemId } from '../core/items';
import type { InventoryModel } from '../core/inventory';
import { BLOCK } from './blocks';

// ---- Tuning constants (Task 7) ----

/** Downward acceleration, blocks/s². */
export const GRAVITY = 20;
/** Seconds a fresh drop ignores pickup — lets the block-break pop land first. */
export const SPAWN_PICKUP_DELAY = 0.5;
/** Default 3D pickup reach, blocks. */
export const PICKUP_RADIUS = 1.5;
/** Seconds before a dropped item despawns. */
export const DESPAWN_AGE = 300;
/** Resting gap above the supporting block's top face — keeps the drop's feet
 *  cell in the air instead of re-colliding with the floor every frame. */
export const SETTLE_OFFSET = 0.01;
/** Impact velocity (blocks/s, downward) below which a drop lands without a
 *  bounce; above it the drop bounces ONCE (restitution 0.3). */
const BOUNCE_THRESHOLD = 3;
/** Horizontal velocity multiplier per second: vel · 0.1^dt — drops pop ~½ block
 *  sideways at spawn, then stop quickly instead of sliding forever. */
const HORIZONTAL_DRAG_PER_SEC = 0.1;

/** A single item lying in the world, awaiting pickup (pure — no Three/DOM).
 *  Physics is stepped by `stepDrops`; rendering lives in render/scene.ts. */
export interface DropEntity {
  id: number;
  item: ItemId;
  count: number;
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  age: number; // seconds since spawn
  pickupDelay: number; // seconds remaining before pickable (spawn = 0.5)
  bounced: boolean; // has it used its single bounce?
}

/** Block → drop item, with per-block overrides for the smelting-free design:
 *  coal_ore drops `coal` directly (its BLOCK_PAIRS item is `coal_ore`);
 *  iron_ore keeps `iron_ore` — no furnace in this phase. Null when the block
 *  has no item form (air, water) → nothing spawns. */
export function dropItemFor(blockId: number): ItemId | null {
  if (blockId === BLOCK.COAL_ORE) return 'coal';
  return itemFromBlock(blockId);
}

/** Append a dropped stack at `pos` — returns a NEW array with one more entity
 *  (unique, max+1 id). Pops upward (vel.y = +3) with a small random horizontal
 *  velocity (x/z ∈ [−1.5, 1.5]) and starts the 0.5 s pickup delay. */
export function spawnDrop(
  drops: readonly DropEntity[],
  item: ItemId,
  count: number,
  pos: { x: number; y: number; z: number },
): DropEntity[] {
  let maxId = -1;
  for (const d of drops) if (d.id > maxId) maxId = d.id;
  return [
    ...drops,
    {
      id: maxId + 1,
      item,
      count,
      pos: { x: pos.x, y: pos.y, z: pos.z }, // copy — never alias the caller's vector
      vel: { x: Math.random() * 3 - 1.5, y: 3, z: Math.random() * 3 - 1.5 },
      age: 0,
      pickupDelay: SPAWN_PICKUP_DELAY,
      bounced: false,
    },
  ];
}

/** One physics tick for every drop — returns a NEW array (entities copied);
 *  drops reaching `age ≥ DESPAWN_AGE` are removed.
 *
 *  Per entity, in order:
 *  1. `dt` must be finite and > 0, else the entity is carried over untouched
 *     (no NaN can ever poison a position);
 *  2. gravity `GRAVITY` on `vel.y`, then `pos += vel·dt` (semi-implicit Euler);
 *  3. horizontal drag `vel.x/z · HORIZONTAL_DRAG_PER_SEC^dt` (applied after the
 *     step, so the frame's displacement uses the pre-drag velocity);
 *  4. ground contact: when moving downward, sweep the cells from the previous
 *     feet cell down to the entered one — the first solid cell wins (a cell
 *     sweep so a fast fall can't tunnel through a 1-block floor). The drop
 *     snaps to that cell's top + `SETTLE_OFFSET`; a first impact faster than
 *     `−BOUNCE_THRESHOLD` bounces once (`·0.3`), everything else stops dead.
 *
 *  `isSolidAt(x, y, z)` is injected (no World import): pass the same notion of
 *  "solid" the player physics uses — water is NOT solid, so drops fall through.
 *  Horizontal block collision is intentionally not modelled: the drag stops a
 *  pop within ~½ block, well short of typical walls. */
export function stepDrops(
  drops: readonly DropEntity[],
  dt: number,
  isSolidAt: (x: number, y: number, z: number) => boolean,
): DropEntity[] {
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const out: DropEntity[] = [];

  for (const d of drops) {
    const age = d.age + step;
    if (age >= DESPAWN_AGE) continue; // despawned

    const pos = { x: d.pos.x, y: d.pos.y, z: d.pos.z };
    const vel = { x: d.vel.x, y: d.vel.y, z: d.vel.z };
    let bounced = d.bounced;

    vel.y -= GRAVITY * step;
    const prevY = pos.y;
    pos.x += vel.x * step;
    pos.y += vel.y * step;
    pos.z += vel.z * step;
    const drag = Math.pow(HORIZONTAL_DRAG_PER_SEC, step);
    vel.x *= drag;
    vel.z *= drag;

    if (vel.y < 0) {
      const fromY = Math.floor(prevY);
      const toY = Math.floor(pos.y);
      const cx = Math.floor(pos.x);
      const cz = Math.floor(pos.z);
      for (let cy = fromY; cy >= toY; cy--) {
        if (!isSolidAt(cx, cy, cz)) continue;
        pos.y = cy + 1 + SETTLE_OFFSET; // snap to the solid cell's top face
        if (!bounced && vel.y < -BOUNCE_THRESHOLD) {
          vel.y = -vel.y * 0.3; // restitution 0.3 — the single allowed bounce
          bounced = true;
        } else {
          vel.y = 0;
        }
        break;
      }
    }

    out.push({
      ...d,
      pos,
      vel,
      age,
      pickupDelay: Math.max(0, d.pickupDelay - step),
      bounced,
    });
  }
  return out;
}

/** Indices of the drops this player could pick up right now: pickup delay
 *  elapsed AND within `radius` (default `PICKUP_RADIUS`) in 3D of `playerPos`.
 *  Indices refer to the array passed in — process them back-to-front if you
 *  remove entities while iterating. */
export function pickable(
  drops: readonly DropEntity[],
  playerPos: { x: number; y: number; z: number },
  radius: number = PICKUP_RADIUS,
): number[] {
  const r2 = radius * radius;
  const out: number[] = [];
  drops.forEach((d, i) => {
    if (d.pickupDelay > 0) return;
    const dx = d.pos.x - playerPos.x;
    const dy = d.pos.y - playerPos.y;
    const dz = d.pos.z - playerPos.z;
    if (dx * dx + dy * dy + dz * dz <= r2) out.push(i);
  });
  return out;
}

/** Try to move drop `idx` into `inventory` — the model applies max-stack
 *  merging/splitting and returns the overflow.
 *
 *  - `overflow === count` → nothing fit: the entity stays untouched;
 *  - `overflow === 0`     → fully taken: the entity is removed;
 *  - otherwise            → partial: the entity stays with `count = overflow`.
 *
 *  Returns `{ drops, overflow }` with a NEW array in every branch (invalid
 *  index → no-op, overflow 0). Creative note: `addItem` no-ops returning 0
 *  there, which reads as "fully taken" — acceptable because creative never
 *  spawns drops (see spawnBlockDrop). */
export function pickup(
  drops: readonly DropEntity[],
  idx: number,
  inventory: InventoryModel,
): { drops: DropEntity[]; overflow: number } {
  const d = idx >= 0 && idx < drops.length ? drops[idx] : undefined;
  if (!d) return { drops: [...drops], overflow: 0 };

  const overflow = inventory.addItem(d.item, d.count);
  if (overflow >= d.count) return { drops: [...drops], overflow: d.count }; // nothing taken
  if (overflow <= 0) return { drops: drops.filter((_, i) => i !== idx), overflow: 0 };
  return {
    drops: drops.map((e, i) => (i === idx ? { ...e, count: overflow } : e)),
    overflow,
  };
}
