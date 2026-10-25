import { itemFromBlock, type ItemId } from '../core/items';
import type { InventoryModel } from '../core/inventory';
import { BLOCK } from './blocks';

// ---- Tuning constants (Task 7) ----

/** Downward acceleration, blocks/s² — Minecraft-like: dropped items fall
 *  slower than players do (player physics uses 32). */
export const GRAVITY = 20;
/** Seconds a fresh drop ignores pickup — lets the block-break pop land first. */
export const SPAWN_PICKUP_DELAY = 0.5;
/** Seconds a **player-thrown** drop ignores pickup — 40 ticks (2 s).
 *  出處：minecraft.wiki/Item (entity)（2026-10-20 抓 raw 全文）：「Dropped items
 *  have a delay of 10 ticks (half a second) between appearing and being able to
 *  be picked up, or **40 ticks (2 seconds) if thrown by a player**, dolphin, or
 *  fox.」→ 方塊破壞掉落維持 `SPAWN_PICKUP_DELAY`（10 tick），玩家丟出的用本常數
 *  （40 tick）。 */
export const PLAYER_DROP_PICKUP_DELAY = 2;
/** 玩家丟出（Q）的拋出幾何 —— 全部是**簡化值**。
 *
 *  原版（minecraft.wiki/Controls，2026-10-20 抓 raw 全文）：「There is no actual
 *  "throw" command; "drop" (default `Q`) tosses an object approximately **2 to 3
 *  blocks** from the player.」→ 本作沒有「投擲」命令，用「出生點在玩家前方
 *  0.5 格、腳高 +1.0 格（視線高度附近）＋ 水平初速 2.5 格/秒 ＋ 上拋初速
 *  1.5 格/秒」近似；掉落物的水平阻力（`HORIZONTAL_DRAG_PER_SEC`）會讓它很快
 *  停住，實際落點約 1 格多。 */
export const PLAYER_DROP_THROW_SPEED = 2.5; // 水平初速（格/秒）
export const PLAYER_DROP_LIFT_SPEED = 1.5; // 上拋初速（格/秒）
export const PLAYER_DROP_FORWARD_OFFSET = 0.5; // 出生點在玩家前方多遠（格）
export const PLAYER_DROP_HEIGHT_OFFSET = 1.0; // 出生點比腳高多少（格）
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
  /** 掉落物的剩餘耐久（B7）；沒有 `dur` 的工具撿起來是滿耐久。
   *  **地面不是洗衣機**：受損工具丟出去／從熔爐噴出來時帶著 `dur`，
   *  撿回來仍是受損的。 */
  dur?: number;
}

/** Block → drop item, with vanilla-parity overrides:
 *  - coal_ore → `coal` (its BLOCK_PAIRS item is the ore block itself);
 *  - iron_ore → `raw_iron` (the raw ore item, MC 1.17+ style — it smelts to
 *    iron_ingot; the block never drops itself);
 *  - gold_ore → `raw_gold` (原版金礦掉生金；生金與金礦都能熔成金錠)
 *  - diamond_ore → `diamond` (原版鑽石礦掉 1 顆鑽石)
 *  - stone → `cobblestone` (without this override no cobblestone is
 *    obtainable: terrain generates no COBBLE blocks, so stone tools, the
 *    furnace recipe and the stone_age advancement were unreachable);
 *  - grass → `dirt` (vanilla: the grass block itself needs silk touch);
 *  - leaves/glass/snow/ice → null (silk-touch-only drops; no shears/silk touch
 *    in this game); the B3 spruce/birch leaves behave exactly like oak leaves.
 *  - 花／草／仙人掌走既有的 itemFromBlock fallback → 掉自身（B5 已定的刻意
 *    偏離：原版花與草掉的是種子／麥粒，不是花本身；本作要讓 B3 的裝飾
 *    可再生、可重新種回）。
 *  - 礫石與雲杉／白樺板材同樣走 fallback → 掉自身。
 *  Null also when the block has no item form at all (air, water) → nothing
 *  spawns. */
export function dropItemFor(blockId: number): ItemId | null {
  if (blockId === BLOCK.COAL_ORE) return 'coal';
  if (blockId === BLOCK.IRON_ORE) return 'raw_iron';
  if (blockId === BLOCK.GOLD_ORE) return 'raw_gold';
  if (blockId === BLOCK.DIAMOND_ORE) return 'diamond';
  if (blockId === BLOCK.STONE) return 'cobblestone';
  if (blockId === BLOCK.GRASS) return 'dirt';
  if (
    blockId === BLOCK.LEAVES ||
    blockId === BLOCK.GLASS ||
    blockId === BLOCK.SNOW ||
    blockId === BLOCK.SPRUCE_LEAVES ||
    blockId === BLOCK.BIRCH_LEAVES ||
    blockId === BLOCK.ICE
  ) {
    return null;
  }
  // 原木走既有的 itemFromBlock fallback → 掉自身（'spruce_log'／'birch_log'）
  return itemFromBlock(blockId);
}

/**
 * 機率掉落：**橡木葉與白樺葉**有 0.5%（1/200）機率掉 1 顆蘋果。
 *
 * 出處：spec §B4.3「蘋果來源修正：移除『殭屍必掉蘋果』；改為橡木／白樺樹葉 0.5%
 * 掉蘋果（原版機制）」；原版 Java 1.20+ 各種葉子都是 0.5%（minecraft.wiki/Block，
 * 2026-10-20 查證）。**白樺葉自 B3（0.6.0）起就有**（`BLOCK.BIRCH_LEAVES`）→ 與橡木
 * 葉同一個機率。
 *
 * 本作**沒有**剪刀／絲絨觸碰 → 樹葉本體仍然不掉（B1.6 起 `dropItemFor` 回 null），
 * 只有這個 0.5% 的額外獎勵。
 */
export const LEAF_APPLE_CHANCE = 0.005;

/**
 * 方塊的**機率掉落**：擲一次 rng，落在門檻內就回該物品，否則回 null。
 *
 * 目前**橡木葉與白樺葉**有機率掉落（0.5% 蘋果；spec §B4.3 的名單）。
 * **雲杉葉刻意未納入**——spec §B4.3 只列橡木／白樺；要加的話把
 * `BLOCK.SPRUCE_LEAVES` 加進下面這個條件即可，規則不用改（雲杉葉本體同樣不掉）。
 *
 * 這是「方塊掉落」這條鏈，與「生物掉落」（`mob-drops.ts` 的 `rollMobDrops`）分開
 * ——生物掉落不該被 `spawnBlockDrop` 的「持有工具門檻」語意污染。
 *
 * rng 可注入（測試可重現）；不給時用 `Math.random`。
 */
export function chanceDropFor(
  blockId: number,
  rng: () => number = Math.random,
): ItemId | null {
  if (blockId !== BLOCK.LEAVES && blockId !== BLOCK.BIRCH_LEAVES) return null;
  return rng() < LEAF_APPLE_CHANCE ? 'apple' : null;
}

/** `spawnDrop` 的可選覆寫項——不給時**預設行為與既有呼叫端完全相同**
 *  （既有呼叫端：`spawnBlockDrop`（src/player/interact.ts）與 main.ts 的掉落呼叫）。 */
export interface SpawnDropOptions {
  /** 拾取延遲秒數；預設 `SPAWN_PICKUP_DELAY`（0.5 秒／10 tick）。
   *  玩家丟出的物品用 `PLAYER_DROP_PICKUP_DELAY`（2 秒／40 tick）。 */
  pickupDelay?: number;
  /** 初速度；預設 `{ 隨機 ±1.5 的水平速度, y = +3 }`（原地跳一下）。 */
  vel?: { x: number; y: number; z: number };
  /** 掉落物要帶的剩餘耐久（B7：Q 丟棄的受損工具、挖掉熔爐時噴出的受損工具）。
   *  **不給時實體完全沒有 `dur` 欄位** → 撿起來由模型 materialize 成滿耐久。 */
  dur?: number;
}

/** Append a dropped stack at `pos` — returns a NEW array with one more entity
 *  (unique, max+1 id). Pops upward (vel.y = +3) with a small random horizontal
 *  velocity (x/z ∈ [−1.5, 1.5]) and starts the 0.5 s pickup delay.
 *
 *  `opts` 可覆寫拾取延遲、初速度與耐久（玩家丟出的物品要 2 秒不可拾 → 傳
 *  `pickupDelay: PLAYER_DROP_PICKUP_DELAY`）；**不傳時預設行為完全不變**。
 *  傳入的 `pos`／`vel` 一律被**複製**——實體不引用呼叫端的物件。
 *  `opts.dur` 有值時掉落物帶著剩餘耐久 → 撿回來不會洗成滿耐久；沒有值時
 *  實體不含 `dur` 欄位（不是 `dur: undefined`）。 */
export function spawnDrop(
  drops: readonly DropEntity[],
  item: ItemId,
  count: number,
  pos: { x: number; y: number; z: number },
  opts: SpawnDropOptions = {},
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
      vel: opts.vel
        ? { x: opts.vel.x, y: opts.vel.y, z: opts.vel.z } // copy — never alias the caller's vector
        : { x: Math.random() * 3 - 1.5, y: 3, z: Math.random() * 3 - 1.5 },
      age: 0,
      pickupDelay: opts.pickupDelay ?? SPAWN_PICKUP_DELAY,
      bounced: false,
      // 只在有值時寫入：`dur: undefined` 會讓既有的 deep-equal 斷言多出一個鍵
      ...(opts.dur !== undefined ? { dur: opts.dur } : {}),
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
 *  Horizontal block collision is intentionally not modelled: drag caps a pop's
 *  total travel at ≈0.65 blocks, so drops usually settle right near the break
 *  face — an occasional partial clip into a wall is cosmetic. */
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
 *  B7：`d.dur` 原樣交給 `addItem`——受損工具撿回來仍是受損的（地面不是
 *  洗衣機）；沒有 `dur` 的掉落物由模型 materialize 成滿耐久。
 *
 *  Returns `{ drops, overflow }` with a NEW array in every branch (invalid
 *  index → no-op, overflow 0). Creative caveat: `addItem` no-ops returning 0
 *  there, which reads as "fully taken" and WOULD delete ground drops — so
 *  main.ts never attempts pickup while creative (guard at the call site),
 *  keeping drops intact across a mid-game survival→creative switch. */
export function pickup(
  drops: readonly DropEntity[],
  idx: number,
  inventory: InventoryModel,
): { drops: DropEntity[]; overflow: number } {
  const d = idx >= 0 && idx < drops.length ? drops[idx] : undefined;
  if (!d) return { drops: [...drops], overflow: 0 };

  const overflow = inventory.addItem(d.item, d.count, d.dur); // B7: dur 一起進背包
  if (overflow >= d.count) return { drops: [...drops], overflow: d.count }; // nothing taken
  if (overflow <= 0) return { drops: drops.filter((_, i) => i !== idx), overflow: 0 };
  return {
    drops: drops.map((e, i) => (i === idx ? { ...e, count: overflow } : e)),
    overflow,
  };
}
