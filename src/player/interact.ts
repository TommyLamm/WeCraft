import { getBlockDef, BLOCK, isCross, type ToolKind } from '../world/blocks';
import type { World } from '../world/world';
// B4 Task 6：射線／AABB 的幾何運算搬到 `world/raycast.ts`（`rayAabbEntry`），
// 讓敵對生物與被動生物的命中盒判定共用同一份實作（這裡是**搬移不是改寫**）。
import { rayAabbEntry, type RayHit } from '../world/raycast';
import { CHUNK_HEIGHT } from '../world/chunk';
import { PLAYER_HALF_WIDTH, PLAYER_HEIGHT } from './physics';
import type { ItemId, ItemStack } from '../core/items';
import type { GameMode } from '../core/inventory';
import { spawnDrop, dropItemFor, chanceDropFor, type DropEntity } from '../world/drops';
import { damageMob, type Mob } from '../world/mobs';

/** Block broken (Task 7) → spawn a world drop at `pos` (block centre) instead
 *  of adding straight to the inventory: survival only — creative spawns nothing
 *  (infinite supply). Task 6 harvest gate: blocks that require a tool (stone
 *  family, iron ore) drop NOTHING — same-ref — unless the `held` stack (null =
 *  bare hand) is a tool of the required kind at or above the required level
 *  (vanilla: no drop when not harvestable). Air/water have no item form and
 *  spawn nothing too. Drop mapping via `dropItemFor` (coal_ore → coal;
 *  iron_ore → raw_iron; grass → dirt; leaves/glass/snow → nothing). Pickup is
 *  proximity-based (main loop + `pickable`/`pickup`).
 *
 *  **機率掉落（B4 Task 4）**：橡木葉與白樺葉有 0.5% 機率掉 1 顆蘋果（`chanceDropFor`）；
 *  它**不受 `dropItemFor` 回 null 的影響**（樹葉本體不掉，但機率掉落照算），
 *  但**仍受創造模式與收穫門檻約束**（創造模式不產生任何掉落；收穫門檻管的是
 *  「這一次破壞有沒有收穫」）。`rng` 可注入 → 測試能釘住 0.5% 這個門檻。
 *  Returns the new drops array — unchanged (same ref) when nothing spawns. */
export function spawnBlockDrop(
  drops: DropEntity[],
  mode: GameMode,
  blockId: number,
  pos: { x: number; y: number; z: number },
  held: ItemStack | null,
  rng: () => number = Math.random,
): DropEntity[] {
  if (mode === 'creative') return drops; // 創造模式不產生任何掉落（含機率掉落）
  if (!canHarvest(blockId, held)) return drops; // 收穫門檻同樣管住機率掉落
  // **機率掉落先算**：樹葉的 `dropItemFor` 回 null，若把這段排在下面的
  // `if (!item) return …` 之後，樹葉的 0.5% 蘋果**永遠不會發生**（那一格
  // 永遠先被 return 截走）→ 順序是這裡最容易做錯的地方。
  const chance = chanceDropFor(blockId, rng);
  const withChance = chance ? spawnDrop(drops, chance, 1, pos) : drops;
  const item = dropItemFor(blockId);
  if (!item) return withChance; // 樹葉：只有 0.5% 蘋果，沒有本體
  // 一般掉落最後 append → 掉落陣列的順序是「機率掉落先、本體後」。
  return spawnDrop(withChance, item, 1, pos);
}

// ---- Survival mining (Task 5): vanilla break-time formula + harvest gates ----

/** Every tool that exists as an item, by family (pickaxe/axe/shovel ×
 *  wood/stone/iron/gold/diamond). `level` is the harvest tier (0/1/2/3),
 *  `speed` the vanilla mining multiplier (2/4/6 for the metal tiers plus
 *  gold 12 and diamond 8).
 *  Swords are deliberately absent — a sword is not a tool: it never speeds
 *  mining up and never satisfies a `requiredTool`. Shovels are present since
 *  B5 (wood/stone/iron/gold/diamond), so shovel-fast blocks finally mine fast.
 *  Gold is harvest tier 0 despite its speed 12: a golden pickaxe cannot
 *  harvest gold or diamond ore (vanilla). */
const TOOL_INFO: Readonly<
  Partial<Record<ItemId, { kind: ToolKind; level: number; speed: number }>>
> = {
  wooden_pickaxe: { kind: 'pickaxe', level: 0, speed: 2 },
  stone_pickaxe: { kind: 'pickaxe', level: 1, speed: 4 },
  iron_pickaxe: { kind: 'pickaxe', level: 2, speed: 6 },
  golden_pickaxe: { kind: 'pickaxe', level: 0, speed: 12 },
  diamond_pickaxe: { kind: 'pickaxe', level: 3, speed: 8 },
  wooden_axe: { kind: 'axe', level: 0, speed: 2 },
  stone_axe: { kind: 'axe', level: 1, speed: 4 },
  iron_axe: { kind: 'axe', level: 2, speed: 6 },
  golden_axe: { kind: 'axe', level: 0, speed: 12 },
  diamond_axe: { kind: 'axe', level: 3, speed: 8 },
  wooden_shovel: { kind: 'shovel', level: 0, speed: 2 },
  stone_shovel: { kind: 'shovel', level: 1, speed: 4 },
  iron_shovel: { kind: 'shovel', level: 2, speed: 6 },
  golden_shovel: { kind: 'shovel', level: 0, speed: 12 },
  diamond_shovel: { kind: 'shovel', level: 3, speed: 8 },
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
 *  (shovel on dirt/grass/sand/snow, axe on log/planks/crafting table; furnace
 *  is pickaxe-fast like the stone family),
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
 *  unbreakable blocks (bedrock/water).
 *
 *  **硬度 0 → 回傳 0（瞬破）**：cross 植被（原版花／草的硬度就是 0）一按即消失。
 *  這與「Infinity（永遠打不破）」是兩件不同的事 → 明確分開處理，不讓 0 掉進
 *  Infinity 的分支。 */
export function getBreakTime(blockId: number, held: ItemStack | null): number {
  const h = getBlockDef(blockId).hardness;
  if (!Number.isFinite(h)) return Infinity;
  if (h === 0) return 0; // 植被：瞬破（不是 Infinity）
  return (h * (canHarvest(blockId, held) ? 1.5 : 5)) / toolSpeed(blockId, held);
}

// ---- Melee combat (Task 9) ----

/** Vanilla Java 1.20+ attack damage by item (wood/stone/iron/gold/diamond):
 *  pickaxes 2/3/4/2/5, axes 7/9/9/7/9, shovels 2.5/3.5/4.5/2.5/5.5,
 *  swords 4/5/6/4/7. Anything not listed is not a weapon (1). */
const DAMAGE_TABLE: Readonly<Partial<Record<ItemId, number>>> = {
  wooden_pickaxe: 2, stone_pickaxe: 3, iron_pickaxe: 4, golden_pickaxe: 2, diamond_pickaxe: 5,
  wooden_axe: 7, stone_axe: 9, iron_axe: 9, golden_axe: 7, diamond_axe: 9,
  wooden_shovel: 2.5, stone_shovel: 3.5, iron_shovel: 4.5, golden_shovel: 2.5, diamond_shovel: 5.5,
  wooden_sword: 4, stone_sword: 5, iron_sword: 6, golden_sword: 4, diamond_sword: 7,
};

/** Melee damage dealt per hit with `heldItem` (a hotbar item id; null = bare
 *  hand), from `DAMAGE_TABLE` (B5 aligned it with vanilla; the old table's
 *  "all pickaxes 2, all axes 3" was non-vanilla). Bare hand (and
 *  apple/stick/blocks): Minecraft parity, fist = 1. Pure and item-only like
 *  `toolSpeed`; combat applies in both game modes (mobs exist regardless). */
export function toolDamage(heldItem: ItemId | null): number {
  if (!heldItem) return 1; // 徒手 1（原版）
  const d = DAMAGE_TABLE[heldItem];
  return d === undefined ? 1 : d;
}

/** Settled mob hitbox for the ray test: centred on `pos` in X/Z (±0.35),
 *  y from the feet up 1.8 blocks. */
const MOB_HALF_WIDTH = 0.35;
const MOB_HITBOX_HEIGHT = 1.8;

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
    const t = rayAabbEntry(
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
 *  water) never accumulates.
 *
 *  **瞬破（`breakTimeSec <= 0`，B3 Task 5）**：直接返回、**不做 `dt / 0`**——
 *  植被的破壞時間是 0 秒（不是 Infinity），進度條對它沒有意義。 */
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
    if (breakTimeSec <= 0) return; // 瞬破（植被）：不做 dt / 0
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
 *  `isDone`.
 *
 *  **瞬破（B3 Task 5）**：破壞時間為 0 秒的方塊（cross 植被：花／草）→
 *  生存與創造都**一按即破**（`dig.reset()` → 不留進度條）。這個分支放在
 *  Infinity 判斷**之後**（不可破壞的方塊仍然永不破壞）、creative 分支**之前**
 *  （兩種模式都瞬破），而且**不進入** `dig.update`（不做 `dt / 0` 的除法）。 */
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
  if (time === 0) {
    dig.reset(); // 瞬破：清掉任何殘留進度（不進度條、不做除法）
    return true;
  }
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

/**
 * 「可被放置取代」的方塊（**與 `canPlaceAt` 的放行條件是同一份規則**）。
 *
 * 空氣／水／cross 植被（花／草）都可被取代 → 放置時直接蓋掉那一格。這是原版
 * `Block#canBeReplaced` 的對應物（minecraft.wiki/Block#canBeReplaced，2026-10-21）：
 * 「點到的方塊若可被取代，新方塊就**取代同一格**」→ 瞄準花右鍵放方塊＝**花被
 * 方塊取代、位置不變**（不是「花旁邊多一塊」）。
 *
 * **為什麼抽成共用函式**：放置**目標**的計算（`resolvePlacementTarget`）與放置
 * **放行**的判定（`canPlaceAt`）必須是同一套規則；兩處各寫一份的話，改了一邊
 * 就會打架（目標算到某格、放行卻不認那格 → 放不下；更糟的是放進實心方塊裡）。
 */
export function isReplaceableForPlacement(blockId: number): boolean {
  return blockId === BLOCK.AIR || blockId === BLOCK.WATER || isCross(blockId);
}

/**
 * 放置**目標**的規則（B3 Task 9 Step 4；承接 Task 5 審查 Important I-1 的
 * **接線層** —— Task 5 只做了語意層的 `canPlaceAt` 放行，目標格一直停在
 * 「命中格 ＋ 法線」，導致 cross 的放行實際不可達）。
 *
 * `hitBlockId` ＝**被點擊那一格**的方塊 id。這個 id 要從世界讀 → 由組裝根
 * `main.ts` 用 `world.getBlock()` 取得再餵進來（本函式保持純函式、可單元測試）。
 *
 * - 被點擊的格**可被取代**（空氣／水／cross 植被）→ 放進**同一格**（原版語意：
 *   可被取代 → 取代同一格）。
 * - 否則（實心方塊）→ 維持既有的「命中格 ＋ 命中面法線」（面鄰格）。
 *
 * **AABB 規則不放寬**：回傳的目標格照樣要過 `canPlaceAt` 的玩家重疊檢查 → 站在
 * 花格裡放方塊仍然被擋下（與原版一致：原版也拒絕把方塊放進與玩家 AABB 相交的
 * 格子；原版是「點到哪棵草就蓋掉哪棵草」，不是「站在草上蓋草」）。
 */
export function resolvePlacementTarget(
  hit: RayHit,
  hitBlockId: number,
): { x: number; y: number; z: number } {
  if (isReplaceableForPlacement(hitBlockId)) return { x: hit.x, y: hit.y, z: hit.z };
  return placeTarget(hit);
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
  // 只能放進空氣／水／cross 植被（B3 Task 5）。
  // **植被是被「覆蓋」而不是卡住**：花／草不碰撞，本來就長在方塊上，
  // **語意層**已經放行 cross（像原版蓋掉雜草）——不放寬玩家 AABB 的規則。
  // 判斷式是**共用**的 `isReplaceableForPlacement` → 與放置目標的計算
  // （`resolvePlacementTarget`）永遠是同一套規則。
  //
  // **兩層要分清楚**（B3 Task 9）：
  // - 語意層（**本函式**）：「目標格**可不可以**放」——cross 植被一律放行。
  // - 接線層（`main.ts` 的 `tryPlaceBlock`）：「目標格**指向哪裡**」——要先從
  //   世界讀出被點擊格的方塊 id，餵給 `resolvePlacementTarget`，才會得到「放進
  //   被點擊格本身」而不是「放進面鄰格」。
  // 兩層必須一致：語意層放行、接線層卻指向別的格 → 放行規則形同虛設（cross 的
  // 放行不可達）。本函式只管語意層；接線層的接法由 `src/main.wiring.test.ts`
  // 的釘子把關。
  if (!isReplaceableForPlacement(id)) return false;

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
