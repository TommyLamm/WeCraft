# WeCraft Phase 2（生存）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 spec「第二期（生存）」：生存/創造切換、血量飢餓、日夜循環、怪物（殭屍+骷髏）、合成（2×2+工作台 3×3）、死亡畫面、生存 HUD、IndexedDB 存檔（改動區塊+玩家狀態），加上第一期擲出的兩項技術債（貪婪網格化+texture array、水半透明）。

**Architecture:** 延續第一期紅線——Three.js 只存在於 `render/`；`core/`、`world/`、`player/` 為純邏輯可單測（不 import Three、不碰 DOM）。怪物/掉落物 AI 以 callback（`isSolidAt`）注入保持純函數；事件經 `core/bus` 單向流動。存檔用原生 IndexedDB（無新 runtime 依賴；`fake-indexeddb` 僅 devDependency）。

**Tech Stack:** TypeScript + Vite + Three.js + Vitest (jsdom) + ESLint；無其他 runtime 依賴。

**Spec:** `docs/superpowers/specs/2026-09-23-wecraft-design.md`

**Approved Scope（使用者已拍板）：**
- 怪物：**殭屍（近戰）+ 骷髏弓箭手（遠程射箭）**。
- 合成：**2×2 隨身 + 工作台 3×3**，配方含木板/木棍/工具/工作台（箱子、熔爐、火把不做——spec 未要求，無光照引擎與冶煉；工具無耐久度）。
- 技術債兩項都做：**貪婪網格化 + texture array**（第一期 Task 18 wontfix）、**水半透明**（`chunk-renderer.ts:48` deferred 註解）。
- 存檔：**改動區塊 + 玩家狀態**（IndexedDB，回到標題再進可續玩）；怪物/掉落物不存檔（載入自然重生）。

**Spec 落差備註：** 怪物數值、配方表、日夜長度、傷害等 spec 未定細節，由本計畫直接拍板（見各 Task；日夜 600 s、殭屍傷 3/血 20、骷髏箭傷 2 等）。

**Self-Review：** 見檔案末尾「Self-Review」章節（寫完計畫後執行）。

---

## File Structure

**Files to Create:**

- `src/player/survival.ts` — PlayerVitals (health/hunger) pure logic + tests
- `src/player/survival.test.ts`
- `src/core/daynight.ts` — day/night clock, light level, sky/fog colors + tests
- `src/core/daynight.test.ts`
- `src/core/items.ts` — ItemId, stacks, non-block items, block↔item mapping + tests
- `src/core/items.test.ts`
- `src/core/recipes.ts` — recipe table, shaped/shapeless 2×2/3×3 matching + tests
- `src/core/recipes.test.ts`
- `src/world/mobs.ts` — Mob type, spawn/step/attack AI, arrow projectiles + tests
- `src/world/mobs.test.ts`
- `src/world/drops.ts` — item drop entities, pickup radius logic + tests
- `src/world/drops.test.ts`
- `src/world/save.ts` — IndexedDB save/load (modified chunks + player state) + tests
- `src/world/save.test.ts`
- `src/ui/survival-hud.ts` — hearts/hunger DOM renderer + tests
- `src/ui/survival-hud.test.ts`
- `src/ui/crafting.ts` — 2×2/3×3 grid UI, recipe drag/click logic + tests
- `src/ui/crafting.test.ts`
- `src/ui/death-screen.ts` — death overlay renderer + tests
- `src/ui/death-screen.test.ts`
(no new files — texture array reuses the existing atlas; no external assets)

**Files to Modify:**

- `src/main.ts` — survival/creative toggle, death state, day/night tick, mob/drop update,
  save on quit, load on continue
- `src/core/bus.ts` — new events: `mode-changed`, `vitals-changed`, `player-died`,
  `mobs-changed`, `drops-changed`, `time-changed`
- `src/core/settings.ts` — `mode: 'survival' | 'creative'`, `dayLengthSec`
- `src/world/blocks.ts` — `isSolid` extended for new blocks; hardness table for survival
  mining; add crafting-table/chest/furnace block ids if missing
- `src/world/world.ts` — `modified` set already exists; add `serializeModified` /
  `applyModified`
- `src/world/mesher.ts` — **greedy meshing + per-vertex texture array** (Task 18 debt)
- `src/world/raycast.ts` — reach limits differ by mode; survival mining hardness gate
- `src/world/worker-client.ts` — no change expected (chunk payload shape unchanged)
- `src/player/physics.ts` — expose damage hooks, fall damage
- `src/player/input.ts` — attack key (left-click) vs dig key separation in survival
- `src/player/interact.ts` — survival mining gated by tool/hardness; attack ray for mobs
- `src/render/chunk-renderer.ts` — texture array material; **two-pass opaque/translucent
  render for water**
- `src/render/textures.ts` — build `THREE.DataArrayTexture` from atlas; keep tile indices
- `src/render/scene.ts` — sun/moon directional light + ambient driven by day/night;
  sky + fog color updates
- `src/ui/hud.ts` — hotbar shows item counts; crosshair unchanged
- `src/ui/inventory.ts` — inventory now holds ItemId stacks (not just blocks)
- `src/ui/menus.ts` — title gets "Continue" when a save exists; pause gets "Save & Quit"
- `src/ui/icons.ts` — item icons for sticks/tools/arrows
- `src/ui/ui.css` — hearts, hunger, crafting grid, death screen styles

**Architecture Red Lines (from spec §2 — non-negotiable):**

- `world/` and `player/` must NOT import Three.js or DOM. Mob/drop/save/mesher logic
  stays pure; rendering of mobs happens in `render/` via a thin adapter.
- All Three.js imports live only in `src/render/**` (and `src/main.ts` for canvas wiring).
- Tests colocated at `src/**/*.test.ts`, run by `npx vitest run`.
- No new runtime dependencies (IndexedDB via native `indexedDB` API).

---

## Task 1: Item system (`core/items.ts`)

**Files:**
- Create: `src/core/items.ts`, `src/core/items.test.ts`
- Modify: `src/core/bus.ts`, `src/ui/inventory.ts`, `src/ui/hud.ts`, `src/ui/icons.ts`

Steps:

- [x] 1.1 Write failing tests: `ItemId` union covers blocks + `stick`, `wooden_pickaxe`,
      `stone_pickaxe`, `wooden_axe`, `stone_axe`, `wooden_sword`, `stone_sword`, `arrow`,
      `crafting_table_item` (from block), `apple` (zombie drop). Test:
      `itemFromBlock(BLOCK.GRASS)` returns `grass` stack id; `stackName('stick')` returns
      `"Stick"`; `maxStack('stick') === 64`; `maxStack('wooden_pickaxe') === 1`.
- [x] 1.2 Run `npx vitest run src/core/items.test.ts` → RED (module missing).
- [x] 1.3 Implement `src/core/items.ts`:

```ts
export type ItemId =
  | 'grass' | 'dirt' | 'stone' | 'cobblestone' | 'oak_log' | 'oak_planks'
  | 'sand' | 'gravel' | 'glass' | 'coal_ore' | 'iron_ore' | 'water'
  | 'crafting_table' | 'chest'
  | 'stick' | 'coal' | 'iron_ingot'
  | 'wooden_pickaxe' | 'stone_pickaxe' | 'wooden_axe' | 'stone_axe'
  | 'wooden_sword' | 'stone_sword'
  | 'arrow' | 'apple';

export interface ItemStack { item: ItemId; count: number }

const BLOCK_ONLY: ReadonlySet<ItemId> = new Set(['water']);
const STACK_ONE: ReadonlySet<ItemId> = new Set([
  'wooden_pickaxe','stone_pickaxe','wooden_axe','stone_axe','wooden_sword','stone_sword',
]);

export function maxStack(item: ItemId): number { return STACK_ONE.has(item) ? 1 : 64 }
export function stackName(item: ItemId): string {
  return item.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
export function isBlockItem(item: ItemId): boolean { return !BLOCK_ONLY.has(item) && BLOCK_ID.has(item) }
export function itemFromBlock(blockId: number): ItemId | null { /* map via BLOCK table */ }
export function blockFromItem(item: ItemId): number | null { /* inverse map */ }
```

(`BLOCK_ID` is a `Map<ItemId, number>` built from the block table in `world/blocks.ts` —
import direction is `core/items.ts` → `world/blocks.ts`, which is allowed: `core` has no
import restrictions in spec §2, and `blocks.ts` has no Three/DOM imports.)

- [x] 1.4 Run `npx vitest run src/core/items.test.ts` → GREEN.
- [x] 1.5 Update `inventory.ts` slot type from `number | null` to `ItemStack | null`,
      keep `addItem/removeItem/countItem` signatures adapted. Update `hud.ts` hotbar to
      render `stack.item` icon + count. Update `icons.ts` `blockIcon()` → `itemIcon()` by
      item id (block ids still render via atlas crop; new items get inline SVG paths).
- [x] 1.6 Run `npx vitest run src/ui/inventory.test.ts src/ui/hud.test.ts` → all GREEN.
- [x] 1.7 Commit: `feat(items): item id system with stacks and block mapping`

**Expected test output:**
```
 ✓ src/core/items.test.ts (8 tests) 0ms
 Test Files  1 passed (1)
```

---

## Task 2: Inventory adopts ItemStack + bus events

**Files:**
- Modify: `src/core/bus.ts`, `src/ui/inventory.ts`, `src/ui/inventory.test.ts`,
  `src/player/interact.ts`

Steps:

- [x] 2.1 Add to `bus.ts`:

```ts
export type GameEvent =
  | { type: 'mode-changed'; mode: 'survival' | 'creative' }
  | { type: 'vitals-changed'; hp: number; maxHp: number; hunger: number; maxHunger: number }
  | { type: 'player-died' }
  | { type: 'time-changed'; phase: 'day' | 'night'; t: number }
  | { type: 'mobs-changed'; count: number }
  | { type: 'drops-changed' };
```

- [x] 2.2 Update `inventory.ts` internals to `ItemStack`; `interact.ts` mined-block
      drops go through `inventory.add(itemFromBlock(id), 1)` in creative → skip adding
      (creative keeps infinite blocks: `addItem` no-ops in creative, full stacks).
- [x] 2.3 Update `inventory.test.ts` for stack semantics (merge counts, split stacks,
      max-stack clamp).
- [x] 2.4 Run `npx vitest run src/ui/inventory.test.ts src/ui/hud.test.ts` → GREEN.
- [x] 2.5 Commit: `feat(inventory): stack-based inventory with bus events`

---

## Task 3: Vitals — health & hunger (`player/survival.ts`)

**Files:**
- Create: `src/player/survival.ts`, `src/player/survival.test.ts`

Steps:

- [x] 3.1 Write failing tests:
      - `createVitals()` → `{ hp: 20, maxHp: 20, hunger: 20, maxHunger: 20, saturation: 5 }`
      - `damage(v, 5)` → hp 15, clamped at 0; `damage(v, 99)` → hp 0.
      - `starve(v, 1)` at hunger 0 → hp decays by 1 (only when saturation 0 and hunger 0).
      - `eat(v, 6)` → hunger +6 clamped, saturation += 2.5 floor'd.
      - `tick(v, dtSec)`: exhaustion from sprint/jump decreases saturation then hunger;
        regen: if hunger ≥ 18, hp regenerates 1 per 4 s.
      - `isDead(v)` → `hp <= 0`.
- [x] 3.2 Run `npx vitest run src/player/survival.test.ts` → RED.
- [x] 3.3 Implement:

```ts
export interface Vitals { hp: number; maxHp: number; hunger: number; maxHunger: number;
  saturation: number; regenAcc: number; starveAcc: number }
export function createVitals(): Vitals { return { hp: 20, maxHp: 20, hunger: 20,
  maxHunger: 20, saturation: 5, regenAcc: 0, starveAcc: 0 } }
export function damage(v: Vitals, amount: number): Vitals { /* clamp ≥0 */ }
export function heal(v: Vitals, amount: number): Vitals { /* clamp ≤maxHp */ }
export function eat(v: Vitals, food: number, sat: number): Vitals { /* hunger += food, sat += sat */ }
export function exhaust(v: Vitals, amount: number): Vitals { /* saturation → hunger */ }
export function tickVitals(v: Vitals, dtSec: number): Vitals { /* regen/starve accumulators */ }
export function isDead(v: Vitals): boolean { return v.hp <= 0 }
```

- [x] 3.4 Run `npx vitest run src/player/survival.test.ts` → GREEN.
- [x] 3.5 Commit: `feat(survival): health and hunger vitals`

---

## Task 4: Survival HUD (hearts + hunger bar)

**Files:**
- Create: `src/ui/survival-hud.ts`, `src/ui/survival-hud.test.ts`
- Modify: `src/ui/ui.css`, `src/main.ts`

Steps:

- [x] 4.1 Write failing tests: `renderVitals(container, vitals)` produces 20 heart
      elements where `hp=15` → 7 full + 1 half + 12 empty (10 hearts = 20 half-units),
      and 10 hunger icons similarly; emits nothing in creative mode
      (`renderVitals(el, null)` clears container).
- [x] 4.2 Run `npx vitest run src/ui/survival-hud.test.ts` → RED.
- [x] 4.3 Implement `renderVitals` with CSS pixel-art hearts (16×16 box, `image-rendering:
      pixelated`, two SVG shapes: full/half/empty heart, full/half/empty drumstick). CSS
      in `ui.css`:

```css
.vitals { position: fixed; bottom: 52px; left: 50%; transform: translateX(-50%);
  width: 364px; display: flex; justify-content: space-between; pointer-events: none; }
.vitals .hearts, .vitals .hunger { display: flex; gap: 1px; }
.heart, .hunger-icon { width: 16px; height: 16px; image-rendering: pixelated; }
```

- [x] 4.4 Wire in `main.ts`: subscribe `vitals-changed`, call `renderVitals`; hide whole
      `.vitals` container when `mode === 'creative'`.
- [x] 4.5 Run `npx vitest run` → all GREEN.
- [x] 4.6 Commit: `feat(ui): survival HUD with hearts and hunger`

---

## Task 5: Survival/creative mode switch + settings

**Files:**
- Modify: `src/core/settings.ts`, `src/ui/menus.ts`, `src/main.ts`, `src/player/interact.ts`,
  `src/world/raycast.ts`

Steps:

- [x] 5.1 Write failing test in `src/core/settings.test.ts` (extend existing):
      `loadSettings()` defaults `mode: 'survival'`; `saveSettings({mode:'creative'})` then
      `loadSettings().mode === 'creative'`.
- [x] 5.2 Run `npx vitest run src/core/settings.test.ts` → RED → implement → GREEN.
- [x] 5.3 `menus.ts`: pause menu gains a "Game Mode: Survival/Creative" toggle button
      (only while playing). Clicking emits `mode-changed` and persists via
      `saveSettings`. Title screen also shows current mode.
- [x] 5.4 `main.ts` keeps `currentMode` in state; F3 overlay line becomes
      `Mode: ${mode}`. On `mode-changed`: creative → full hotbar refill of all block
      items ×64; survival → vitals enabled, inventory untouched.
- [x] 5.5 `raycast.ts`: `REACH = mode === 'creative' ? 5 : 4.5`. `interact.ts`: in
      survival, digging requires `digProgress += dt * toolSpeed(block, heldItem)`; tool
      speed table: hand 1×, matching pickaxe/axe 2×, wrong tool 0.5×, unbreakable list
      (bedrock/water) unchanged. Creative keeps instant dig.
- [x] 5.6 Run `npx vitest run src/world/raycast.test.ts src/player/interact.test.ts
      src/core/settings.test.ts` → GREEN.
- [x] 5.7 Commit: `feat(mode): survival/creative toggle with mining gating`

---

## Task 6: Day/night cycle (`core/daynight.ts`)

**Files:**
- Create: `src/core/daynight.ts`, `src/core/daynight.test.ts`
- Modify: `src/render/scene.ts`, `src/main.ts`, `src/core/settings.ts`

Steps:

- [x] 6.1 Write failing tests:
      - `createClock(dayLengthSec = 600)` → `t = 0.25` (morning start).
      - `tickClock(c, dt)` wraps at 1.0 → 0.
      - `phaseOf(t)`: `t ∈ [0.0,0.5)` = day, `[0.5,1.0)` = night (noon at 0.25, midnight
        at 0.75).
      - `sunDirection(t)` returns normalized vec3 (use plain `{x,y,z}` — no Three in
        `core/`); at `t=0.25` y=1, at `t=0.75` y=−1.
      - `skyColors(t)` returns `{ sky, fog, ambient, sunIntensity }` hex/number tuples:
        day sky `#87ceeb`, night sky `#0a0e1a`, dawn/dusk blend `#ff9a5c` around
        `t≈0.0/0.5` (±0.03), smooth lerp elsewhere; `sunIntensity` 0.9 day → 0.12 night.
- [x] 6.2 Run `npx vitest run src/core/daynight.test.ts` → RED.
- [x] 6.3 Implement `daynight.ts` (pure math, no Three).
- [x] 6.4 Run `npx vitest run src/core/daynight.test.ts` → GREEN.
- [x] 6.5 `scene.ts`: add `setDayNight(sunDir, colors)` updating directional light
      position/intensity, ambient intensity, `scene.background`, `scene.fog.color`.
      `main.ts`: tick clock while `state === 'playing'`, emit `time-changed` on phase
      flip only. `settings.dayLengthSec` default 600.
- [x] 6.6 Manual check (browser): run `npx vite`, enter world, verify sky turns orange
      then dark over ~5 min (temporarily set `dayLengthSec: 60` in localStorage for the
      check, then restore).
- [x] 6.7 Run `npx vitest run` → GREEN.
- [x] 6.8 Commit: `feat(daynight): day/night cycle with sky and light transitions`

---

## Task 7: Item drops & pickup (`world/drops.ts`)

**Files:**
- Create: `src/world/drops.ts`, `src/world/drops.test.ts`
- Modify: `src/player/interact.ts`, `src/main.ts`, `src/render/scene.ts` (drop meshes)

Steps:

- [x] 7.1 Write failing tests:
      - `spawnDrop(drops, item, count, pos)` appends entity with unique id, random
        pickup delay 0.5 s, small random horizontal velocity.
      - `stepDrops(drops, dt, isSolidAt)`: applies gravity 20 blocks/s², lands on ground
        (stop at solid), bounces once with restitution 0.3, age increments.
      - `pickable(drops, playerPos, radius = 1.5)` returns entities within radius after
        pickup delay.
      - `pickup(drops, idx, inventory)` adds stack respecting max-stack, removes entity
        when count consumed, returns remaining overflow.
      - despawn after 300 s.
- [x] 7.2 Run `npx vitest run src/world/drops.test.ts` → RED.
- [x] 7.3 Implement `drops.ts` (pure; `isSolidAt(x,y,z)` passed in as callback → no
      World import needed, keeps tests simple).
- [x] 7.4 Run `npx vitest run src/world/drops.test.ts` → GREEN.
- [x] 7.5 Hook `interact.ts`: on block broken — survival mode spawns `spawnDrop(..., 1)`
      (creative spawns nothing). Smelting-free design: iron ore drops `iron_ore` item;
      coal ore drops `coal`.
- [x] 7.6 `main.ts`: maintain `drops: DropEntity[]`, step each frame while playing,
      attempt pickup toward player, emit `drops-changed`. `scene.ts` gets a
      `DropRenderer` syncing meshes (16×16 flat sprite billboards, reuse block icons via
      atlas UVs).
- [x] 7.7 Run `npx vitest run` → GREEN.
- [x] 7.8 Commit: `feat(drops): item drop entities with gravity and pickup`

---

## Task 8: Mobs — zombie & skeleton (`world/mobs.ts`)

**Files:**
- Create: `src/world/mobs.ts`, `src/world/mobs.test.ts`
- Modify: `src/render/scene.ts` (MobRenderer), `src/main.ts`, `src/core/bus.ts`

Steps:

- [x] 8.1 Write failing tests:
      - `createMob('zombie', pos)` → `{ id, kind, hp: 20, pos, vel, state: 'wander',
        attackCooldown: 0, target: null }`; skeleton hp 20, `ranged: true`.
      - `stepMob(mob, { playerPos, isSolidAt, dt, now })`:
        - zombie within 16 blocks → `state: 'chase'`, moves toward player at 3.2 blocks/s,
          step-up 1 block onto solid obstacles (jump impulse when blocked front + solid
          below), gravity when airborne.
        - zombie within 1.6 blocks → `attackCooldown` 1.0 s gate, deals 3 damage
          (returns `{ damage: 3 }` event, vitals applied by caller).
        - skeleton within 16 blocks → keeps distance 8: retreats if closer, stops if
          farther, every 2.0 s fires arrow event `{ shoot: { from, dir } }` with dir aimed
          at player with slight arc (gravity 9.8 on projectile, computed by caller).
        - out of 24 blocks → `state: 'wander'`, random walk, turns every 2–4 s.
      - `stepMobs(mobs, ctx)` maps over list and returns events array.
      - `damageMob(mob, dmg)` → hp−, `dead` flag at hp ≤ 0, knockback velocity away from
        hit direction.
- [x] 8.2 Run `npx vitest run src/world/mobs.test.ts` → RED.
- [x] 8.3 Implement `mobs.ts` — pure logic, no Three/DOM (callback `isSolidAt` as in
      drops). Arrows as plain entities in same file: `stepArrows(arrows, dt, isSolidAt)`
      → gravity, hit solid → despawn, hit player (radius 0.6) → damage event 2.
- [x] 8.4 Run `npx vitest run src/world/mobs.test.ts` → GREEN.
- [x] 8.5 Spawning: `main.ts` keeps `mobs` list; every 5 s tick — if `mobs.length < 8`
      and night (`phaseOf(t) === 'night'`), spawn zombie/skeleton at random surface
      position 12–24 blocks from player (raycast down for surface Y, must be dark enough:
      use `phaseOf` night check only — no per-block light engine in this phase).
      Despawn beyond 48 blocks. Zombies burn→despawn at daybreak is **out of scope**;
      instead they simply despawn when 40+ blocks away (keeps scope tight).
- [x] 8.6 `scene.ts` `MobRenderer`: blocky humanoid built from `THREE.Group` of
      `BoxGeometry` limbs (zombie: green head/body, blue legs, teal arms; skeleton:
      white/gray), walk animation = limb swing `sin(t * speed)`, simple face texture via
      atlas-free flat colors (per spec §5 pixel look: keep boxes untextured but with
      `NearestFilter` flat materials). Arrow renderer: small rotated box.
- [x] 8.7 Run `npx vitest run` → GREEN; browser check: switch to night, see mobs approach.
- [x] 8.8 Commit: `feat(mobs): zombie and skeleton AI with arrows`

---

## Task 9: Combat — player attack & mob damage

**Files:**
- Modify: `src/player/input.ts`, `src/player/interact.ts`, `src/main.ts`,
  `src/ui/hud.ts`, `src/ui/icons.ts`

Steps:

- [x] 9.1 Write failing tests in `src/player/interact.test.ts` (extend):
      - `attackTarget(raycastMobHit, mobs, heldItem, now)` — if ray hits mob within
        3.5 blocks: sword damage 5 (stone) / 4 (wooden) / 2 (fist), cooldown 0.6 s,
        returns updated mob list with knockback.
      - Fall damage: `fallDamage(distance)` → `max(0, floor(distance − 3))`; landing on
        water/ground callback decides `resetFall`.
- [x] 9.2 Run `npx vitest run src/player/interact.test.ts` → RED → implement → GREEN.
- [x] 9.3 `input.ts`: in survival, left-click = attack (ray test against mob AABBs first,
      falls through to dig if no mob); right-click = place/use. In creative unchanged:
      left-click instant dig. Expose `consumeAttack()` like `consumePlace`.
- [x] 9.4 `main.ts` game loop order per frame (playing state):
      1. input → attack/dig/place
      2. `stepMobs` → apply damage events to vitals → emit `vitals-changed`
      3. `stepArrows` → same
      4. `tickVitals` → check `isDead`
      5. drops, chunks, render.
- [x] 9.5 Hit flash: mob renderer flashes white 0.1 s on `damageMob` (renderer-side
      flag set by main).
- [x] 9.6 Run `npx vitest run` → GREEN.
- [x] 9.7 Commit: `feat(combat): melee/ranged combat with fall damage`

---

## Task 10: Death screen

**Files:**
- Create: `src/ui/death-screen.ts`, `src/ui/death-screen.test.ts`
- Modify: `src/main.ts`, `src/ui/ui.css`, `src/core/bus.ts`, `src/ui/menus.ts`

Steps:

- [x] 10.1 Write failing tests: `renderDeathScreen(container, { onRespawn, onQuit })`
      creates overlay with title "You Died!", two buttons ("Respawn", "Title Screen");
      `clearDeathScreen(container)` removes it. Buttons wired to callbacks (assert via
      stub function calls after `btn.click()` — jsdom/happy-dom available in vitest
      config; if not, test pure `deathScreenModel()` returning button specs and click
      handled in `renderDeathScreen` smoke test with injected fake `document`).
- [x] 10.2 Run `npx vitest run src/ui/death-screen.test.ts` → RED.
- [x] 10.3 Implement with CSS: full-screen `rgba(120,0,0,0.45)` red tint overlay,
      `backdrop-filter: grayscale(0.6)`, centered block-font title (reuse `var(--font-
      pixel)`), Minecraft-style gray stone buttons (reuse `.menu-btn` styles under
      `.death-screen` scope).
- [x] 10.4 `main.ts`: when `isDead(vitals)` → set `state = 'dead'`, emit `player-died`,
      render death screen. Respawn: reset vitals to full, teleport to spawn (keep
      inventory — Minecraft keeps inventory only with rule; we keep inventory for
      friendliness, note in commit), mobs within 8 blocks despawn. Quit: save + return
      to title (save happens in Task 13; here just return to title).
- [x] 10.5 `state` type in `main.ts` gains `'dead'`; input/render loops skip
      world-stepping while `'dead'` (frame still renders frozen scene).
- [x] 10.6 Run `npx vitest run` → GREEN.
- [x] 10.7 Commit: `feat(death): death screen with respawn flow`

---

## Task 11: Recipes + crafting core (`core/recipes.ts`)

**Files:**
- Create: `src/core/recipes.ts`, `src/core/recipes.test.ts`
- Modify: `src/core/items.ts` (recipe helpers only if needed)

Steps:

- [x] 11.1 Write failing tests:

```ts
// Recipe shape
interface Recipe {
  id: string;
  size: 2 | 3;                 // grid side length
  pattern: (ItemId | null)[];  // length size*size; null = empty cell
  result: { item: ItemId; count: number };
  shapeless?: boolean;         // e.g. planks from log: 1 log → 4 planks anywhere
}

matchRecipe(grid: (ItemStack | null)[], size: 2 | 3): Recipe | null
craft(grid, size, recipe, times): { grid: (ItemStack|null)[]; output: ItemStack }
```

- [x] Tests assert these **9 recipes (settled — implement exactly these)**:

| # | id | Kind | Pattern (row-major, `·`=empty) | Result |
|---|----|------|-------------------------------|--------|
| 1 | `log→planks` | shapeless, size 2 | 1× oak_log | oak_planks ×4 |
| 2 | `planks→stick` | shapeless, size 2 | 2× oak_planks | stick ×4 |
| 3 | `table` | shapeless, size 2 | 4× oak_planks | crafting_table ×1 |
| 4 | `wooden_pickaxe` | shaped, size 3 | `PPP/·S·/·S·` | wooden_pickaxe ×1 |
| 5 | `stone_pickaxe` | shaped, size 3 | `CCC/·S·/·S·` | stone_pickaxe ×1 |
| 6 | `wooden_axe` | shaped, size 3 | `PP/PS/·S` | wooden_axe ×1 |
| 7 | `stone_axe` | shaped, size 3 | `CC/CS/·S` | stone_axe ×1 |
| 8 | `wooden_sword` | shaped, size 3 | `·P/·P/·S` | wooden_sword ×1 |
| 9 | `stone_sword` | shaped, size 3 | `·C/·C/·S` | stone_sword ×1 |

Scope notes: chest/furnace/torch omitted (spec doesn't require them; no smelting or
light engine). Tools have no durability — they last forever. `crafting_table` is a
placeable block (new block id + programmatic texture, step 11.5).

- [x] 11.2 Run `npx vitest run src/core/recipes.test.ts` → RED.
- [x] 11.3 Implement matcher: trim empty outer rows/cols of the grid → normalized
      pattern bounding box must equal recipe's trimmed pattern; `shapeless` compares
      multisets instead. Grid cells are `(ItemStack|null)[]` row-major.
- [x] 11.4 Run `npx vitest run src/core/recipes.test.ts` → GREEN.
- [x] 11.5 Extend `world/blocks.ts`: ensure `crafting_table` block exists (block id 14
      slot or next free: verify existing ids, append new id; texture tile: reuse oak
      planks tile with darker top? — use new tile index 16: crafting table front, drawn
      programmatically in `textures.ts` 16×16 pixel pattern, no external asset).
      `items.ts` block map gains `crafting_table ↔ block id`.
- [x] 11.6 Run `npx vitest run` → GREEN.
- [x] 11.7 Commit: `feat(crafting): recipe table with 2x2/3x3 shaped matching`

---

## Task 12: Crafting UI + crafting table block

**Files:**
- Create: `src/ui/crafting.ts`, `src/ui/crafting.test.ts`
- Modify: `src/ui/ui.css`, `src/ui/inventory.ts`, `src/ui/menus.ts`, `src/main.ts`,
  `src/player/interact.ts`

Steps:

- [x] 12.1 Write failing tests:
      - `createCraftingState(size)` → empty grid array of `size*size`.
      - Click inventory item → places one into first compatible grid cell; click grid
        cell → picks stack back. Shift-click not required (keep simple: single click
        moves full stack, ctrl not needed).
      - `resultOf(grid, size)` calls `matchRecipe` → output slot shows result.
      - Crafting `times=1`: decrement each non-null grid cell by 1, add result to cursor
        output; nulls stay null; cells that hit 0 → null.
- [x] 12.2 Run `npx vitest run src/ui/crafting.test.ts` → RED.
- [x] 12.3 Implement `crafting.ts` (pure state logic) + `renderCrafting(container,
      state, callbacks)` DOM renderer. CSS: 3×3 grid of 40px slots, arrow, 40px output
      slot, styled like inventory slots (reuse `.slot` class); container centered
      (`position: fixed; top: 50%; left: 50%; translate`), 2×2 variant drops grid to
      2 columns.
- [x] 12.4 Interaction wiring in `main.ts`/`menus.ts`:
      - Survival: press `E` → inventory (2×2 crafting embedded at top of inventory
        panel, size 2).
      - Right-click on placed `crafting_table` block → open 3×3 crafting panel
        (replaces inventory overlay), size 3. `interact.ts` `useBlock()` hook returns
        `block === crafting_table` → emit event consumed by main to open panel.
      - Creative mode: crafting hidden (infinite blocks already in hotbar).
- [x] 12.5 Run `npx vitest run` → GREEN.
- [x] 12.6 Commit: `feat(crafting): crafting UI with table block and 2x2/3x3 grids`

---

## Task 13: Persistence — IndexedDB save/load (`world/save.ts`)

**Files:**
- Create: `src/world/save.ts`, `src/world/save.test.ts`
- Modify: `src/world/world.ts`, `src/main.ts`, `src/ui/menus.ts`, `src/core/settings.ts`
  (no — save lives in world, not settings)

Steps:

- [x] 13.1 Write failing tests. IndexedDB needs a test double: add **`fake-indexeddb` as
      a devDependency** (spec §2 forbids new *runtime* deps only — devDep is allowed).
      Tests:
      - `saveGame(db, payload)` then `loadGame(db)` deep-equals payload.
      - payload shape:

```ts
interface SavePayload {
  version: 1;
  savedAt: number;
  worldSeed: number;
  modified: Array<[key: string, blockId: number]>;  // world.modified serialized
  player: { pos: [number,number,number]; yaw: number; mode: 'survival'|'creative';
    vitals: Vitals | null; inventory: (ItemStack|null)[] };
  time: { t: number };                                // day/night clock
  // mobs/drops are intentionally not persisted — respawn naturally on load
}
```

      - `world.serializeModified(): Array<[string, number]>` and
        `applyModified(pairs)` round-trip: write block → serialize → new World →
        apply → read same block.
      - corrupt/missing DB → `loadGame` returns `null` (no throw).
- [x] 13.2 Run `npx vitest run src/world/save.test.ts src/world/world.test.ts` → RED.
- [x] 13.3 Implement `save.ts` with native `indexedDB.open('wecraft-save', 1)`, object
      store `games` key `'slot1'`. `saveGame`/`loadGame` promise-based with a tiny
      `idbRequest<T>(req)` helper. World gets `serializeModified`/`applyModified`.
- [x] 13.4 Run `npx vitest run src/world/save.test.ts src/world/world.test.ts` → GREEN.
- [x] 13.5 Install: `npx vitest run` all GREEN → `npm i -D fake-indexeddb` if not yet.
- [x] 13.6 Commit: `feat(save): IndexedDB persistence for chunks and player state`

---

## Task 14: Continue/Save-quit flow

**Files:**
- Modify: `src/main.ts`, `src/ui/menus.ts`, `src/ui/menus.test.ts`

Steps:

- [x] 14.1 Write failing tests (`menus.test.ts` extend):
      - `renderTitle(el, { hasSave, onNew, onContinue })`: when `hasSave` true → title
        shows "Continue" + "New Game" buttons; false → only "New Game".
      - pause menu gains "Save & Quit": persists payload (stub `saveGame` injected) then
        returns to title; "Quit without saving" not offered (single button keeps it
        simple — spec only requires resume works).
- [x] 14.2 Run `npx vitest run src/ui/menus.test.ts` → RED.
- [x] 14.3 Implement:
      - `main.ts` `collectSavePayload()` gathers seed, `world.serializeModified()`,
        player pos/yaw/mode/vitals/inventory, clock `t`.
      - `startGame(mode, { continue: boolean })`: continue → `loadGame` → new World
        with saved seed + `applyModified` + restore player/clock; new → seed =
        `Date.now()`, fresh state.
      - `hasSave()` checks `loadGame(db) !== null` before rendering title (async once
        at boot, cached boolean).
      - Save triggers: (a) "Save & Quit" button, (b) visibilitychange → hidden while
        playing (debounced 2 s), (c) every 30 s autosave while playing. Autosave and
        visibility save call same `persistNow()` guarded by `saving` flag.
- [x] 14.4 Run `npx vitest run` → GREEN.
- [x] 14.5 Browser check: enter world, mine 5 blocks, walk, change vitals via mob hit,
      Save & Quit → Continue → blocks stay mined, position/hunger/inventory/time match.
- [x] 14.6 Commit: `feat(save): continue flow with autosave`

---

## Task 15: Greedy meshing + texture array (Phase 1 debt #1)

**Files:**
- Modify: `src/world/mesher.ts`, `src/world/mesher.test.ts`, `src/render/textures.ts`,
  `src/render/chunk-renderer.ts`

Steps:

- [x] 15.1 First confirm current baseline: `npx vitest run src/world/mesher.test.ts` →
      GREEN (face-culling version). Add NEW failing tests to `mesher.test.ts`:
      - Flat 16×16 top face of identical grass blocks → greedy mesher emits **2 quads**
        (split at atlas-bleed boundary if tiling requires, but ≤ 4) instead of 256;
        assert `positions.length / 4 ≤ 4` for that face region.
      - Two adjacent blocks with different block ids do **not** merge (different texture
        → separate quads).
      - Per-vertex output now includes `texIndex: number[]` (one per vertex) alongside
        `positions/normals/uvs/indices` — test asserts `texIndex.length ===
        positions.length / 3`.
      - Existing face-culling correctness tests still pass (merge must not create
        cross-chunk or hidden-face artifacts: the solid-mask test and AO/skylight tests
        unchanged in behavior for non-mergeable cases).
- [x] 15.2 Run `npx vitest run src/world/mesher.test.ts` → RED (`texIndex` missing,
      quad count assertions fail).
- [x] 15.3 Implement greedy meshing in `mesher.ts`:
      - Per axis (X/Y/Z), per face direction (±): build a 2D mask of visible faces for
        the slice (face visible = neighbor not opaque; water rule unchanged: water face
        visible only against non-water transparent).
      - Greedy rectangle expansion: scan mask, extend width while same
        `(blockId, texIndex-for-this-face-dir, light)` signature, then extend height;
        emit quad, clear consumed cells.
      - Keep `LIGHT_MASK` byte packing per vertex (existing contract) — light is part of
        the merge signature so shaded/sunlit faces don't merge incorrectly.
      - Water cells: excluded from the opaque greedy pass (handled by translucent pass,
        Task 16); mesher returns `{ opaque: MeshData, water: MeshData }` — update both
        test suites and `worker-client` message shape (`ChunkMesh` gains `water`
        field). Water cells are greedily merged too (same algorithm; light is part of
        the merge signature).
- [x] 15.4 Implement texture array in `render/textures.ts`:
      - `buildTextureArray(): THREE.DataArrayTexture` — read the existing 256×256 atlas
        (same `loadAtlas` source pixels), repack into a `64 × 16 × 16` array texture
        (64 layers of 16×16 tiles; only first 17 tiles have content, rest filled with
        magenta `#ff00ff` debug color). `minFilter/magFilter = NearestFilter`,
        `generateMipmaps = false`.
      - Keep `atlasUV(tile)` export for UI icons (icons still sample the 2D atlas — a
        plain 2D canvas copy stays available for `icons.ts`).
- [x] 15.5 **Settled approach:** mesher emits **tile-local UVs** (`[0..1]` within the
      tile) plus a per-vertex `texIndex` (tile number). `chunk-renderer.ts` builds the
      material as `MeshLambertMaterial({ map: textureArray, alphaTest: 0.1 })` and
      patches it via `onBeforeCompile`:
      - vertex: add `attribute float texIndex; varying float vTexIndex;` →
        `vTexIndex = texIndex;`
      - fragment: declare `uniform sampler2DArray mapArray;` (bound to the
        DataArrayTexture), replace the `map_fragment` include body with
        `vec4 sampledDiffuseColor = texture(mapArray, vec3(vUv, vTexIndex));
        diffuseColor *= sampledDiffuseColor;` so `alphaTest: 0.1` still discards
        cutout pixels afterward (glass/leaves contract preserved).
      - WebGL2-only `sampler2DArray` is fine (Vite targets WebGL2 by default; Phase 1
        already renders with WebGL2).
- [x] 15.6 Geometry attributes: `BufferGeometry` gains `texIndex` float attribute
      (from mesher's `texIndex` array); shared across all chunks (rebuilt per chunk).
- [x] 15.7 Remove now-unused `bakeAtlasUvs` from `mesher.ts` (its tile-crop padding
      logic dies with atlas-absolute UVs) — but KEEP the exported `atlasUV(tile)` in
      `textures.ts` for icons. Delete only mesher's internal bake function; update any
      tests that imported it (`mesher.test.ts` UV assertions change to tile-local
      expectations — update in 15.1 already).
- [x] 15.8 Run `npx vitest run` → all GREEN.
- [x] 15.9 Browser verification: `npx vite` — world renders visually identical (tiles
      crisp, no bleeding), grass/leaves/glass alpha correct, F3 chunk stats show fewer
      triangles (log before/after counts for commit message).
      → visual check confirmed via Task 17 browser runs; **deviation:** the
      before/after triangle counts were never logged in the commit message (F3 had no
      triangle line yet) — substitute evidence recorded under 17.4's greedy item.
- [x] 15.10 Commit: `perf(mesher): greedy meshing with texture array sampling`
      (Phase 1 Task 18 debt closed)

---

## Task 16: Translucent water render pass (Phase 1 debt #2)

**Files:**
- Modify: `src/render/chunk-renderer.ts`, `src/render/scene.ts`,
  `src/chunk-renderer` tests if any exist, `src/world/mesher.ts` (water MeshData
  consumed here — overlap with 15.3 water split is intentional; this task owns the
  render side)

Steps:

- [x] 16.1 Write failing tests where possible (renderer params extracted to pure fn):
      - `waterMaterialParams()` returns `{ transparent: true, opacity: 0.62, depthWrite:
        false, side: DoubleSide }` — `DoubleSide` so the surface is visible from
        underwater looking up.
      - `WATER_RENDER_ORDER = 3000` exported and greater than the opaque default (0),
        so water draws after opaque geometry (no sorting artifacts against terrain).
- [x] 16.2 Run `npx vitest run src/render/chunk-renderer.test.ts` (create if absent) →
      RED → implement `waterMaterialParams` + wire → GREEN.
- [x] 16.3 `chunk-renderer.ts`: remove the deferred comment at line ~48. Structure:
      - `ChunkRenderer` keeps `opaqueMesh: THREE.Mesh` (MeshLambertMaterial + texture
        array + alphaTest) and adds `waterMesh: THREE.Mesh` (same texture array, but
        `transparent: true, opacity: 0.62, depthWrite: false, side: DoubleSide`,
        `renderOrder = 3000`).
      - `setChunkMesh` populates both geometries from `ChunkMesh { opaque, water }`
        (Task 15 message shape); empty water geometry → `waterMesh.visible = false`.
- [x] 16.4 Underwater tint: `scene.ts` adds `setUnderwater(inside: boolean)` — when the
      camera is inside a water block, fog switches to `new THREE.FogExp2(0x1c4e8a,
      0.09)` and restores the day/night fog otherwise; main.ts computes
      `isSolidAt(camPos) === WATER` each frame (cheap) and calls it.
- [x] 16.5 Run `npx vitest run` → GREEN. Browser check: stand at water edge → see
      through surface to sand below; submerge → blue tint; jump out → tint clears;
      no z-fighting between opaque sand and water plane.
- [x] 16.6 Commit: `feat(water): translucent water pass with underwater fog`

---

## Task 17: Final verification & polish

**Files:**
- Modify: as needed from checklist findings

Steps:

- [x] 17.1 Full test suite: `npx vitest run` → all GREEN (record count in Self-Review).
      → **529 tests / 28 files green** at final HEAD `e3029af` (513 at Task 16 close;
      +16 added by the two verification fix batches).
- [x] 17.2 Type check & build: `npx tsc --noEmit` (or `npm run build` if that's the
      project script) → zero errors; `npx vite build` → success. → both clean.
- [x] 17.3 Architecture red-line audit (grep):
      - `npx rg "from 'three'" src/world src/player src/core` → zero matches.
      - `npx rg "document\.|window\." src/world src/player src/core` → zero matches
        (except none expected).
      → zero matches on both (run via PowerShell `Select-String`; `npx rg` unavailable
      in this environment). Re-checked after both fix batches: still zero —
      `setFlyEnabled`/fly gate add no new DOM usage to `input.ts`.
- [x] 17.4 Spec §4/§5 walkthrough in browser (`npx vite`):
      - [x] Survival mode: hearts + hunger visible, mining takes time, blocks drop and
            are picked up. → hearts 10/10 + hunger; survival dig needs a sustained
            hold (creative is instant); drops auto-pickup — B3's fist dig in a fresh
            game left slot4=4 / slot5=2, B1 mine→pickup ✓.
      - [x] Creative mode: instant dig, no vitals, infinite blocks (unchanged from P1).
            → B3: instant dig with zero hotbar change, `.vitals` display:none, refill
            9×64 on switch-in, placement never consumes.
      - [x] Toggle mode in pause menu works both directions. → B3: survival→creative
            (vitals hide + refill) and creative→survival (`display:flex`, hearts 10,
            F3 `Mode: survival`); double-Space flight force-lands on the switch
            (yFly 88.09 → yLand 81).
      - [x] Day→dusk→night→dawn cycle visibly changes sky, fog, and light. → B2 luma
            `[34,34,34,34,34,22,17]` day→dusk→night; dawn re-run `[15,15,15,15,25]`
            brightening back (70 s window with re-death handling); sky/fog shift in
            screenshots b2-02/03/07.
      - [x] Night spawns zombies (chase + melee) and skeletons (keep distance + arrows).
            → B2 sweep: 5 s spawn cadence, chase into melee range, skeleton arrows;
            player damaged 10→0 over the night (screenshots b2-04-*).
      - [x] Player can die (fall / mob damage) → death screen → respawn restores vitals.
            → B2 run5: 10→0 via mobs; `.death-screen` with Respawn/回到標題; Respawn →
            first poll **10/10**, position = world spawn (0.5/89/0.5), inventory kept;
            re-death during the dawn wait re-respawned so the clock keeps running.
      - [x] 2×2 crafting (E) makes planks/sticks/table; table placed → right-click →
            3×3 makes tools. → B3: planks 64→60→58, sticks ×4, table placed (slot
            consumed to empty), right-click → 3×3 (9 cells) → Wooden Pickaxe taken.
      - [x] Tools mine stone faster than fist; wrong tool slower. → B3 6 s each:
            pickaxe **7.0 blocks vs fist 1.0** (hand = 0.5× on rock); wrong-tool 0.5×
            pinned by `interact.test.ts` (hand/axe/sword on stone, pickaxe on logs).
      - [x] Save & Quit → Continue: modified blocks, position, vitals, inventory, time
            all restored. → B1: edit + Save&Quit → Continue, F3 position/Block/vitals
            and clock restored (screenshots b1-*).
      - [x] Greedy: F3 triangle counts noticeably lower than pre-Task-15 baseline on a
            flat area. → F3 line added by fix batch 2, reports live count (259,534 on
            spawn plains / 529 chunks). **Environment-limited:** no pre-Task-15
            *browser* baseline was ever logged (15.9 didn't capture it), so the
            before/after A/B rests on `mesher.test.ts`: flat 16×16 top face
            256 → ≤4 quads (plus per-case merge/culling tests).
      - [x] Water translucent + underwater fog. → B1: shoreline transparency +
            submerged fog shift (screenshots b1b-*).
- [x] 17.5 Fix any findings, re-run `npx vitest run` → GREEN. → two fix batches, both
      spec- and quality-reviewed (APPROVED): `f09253c` (batch 1) and `e3029af`
      (batch 2: creative-only flight gate, F3 triangle line, survival place
      consumption + review findings folded in by amend). Final suite 529 green;
      tsc / eslint / vite build all clean.
- [x] 17.6 Commit: `chore: phase 2 verification fixes` (only if fixes were needed).
      → two commits carry this message: batch 1 `f09253c`, batch 2 `e3029af` (the
      second was amended in place so review fixes stayed in one commit).

---

## Self-Review

**Spec coverage (§4 Phase 2 items):**
- Survival/creative switch → Task 5 ✓
- Health/hunger → Tasks 3–4 ✓
- Day/night → Task 6 ✓
- Mobs → Task 8 ✓ (zombie + skeleton per user decision)
- Crafting recipes → Tasks 11–12 ✓ (2×2 + table 3×3 per user decision)
- Death screen → Task 10 ✓
- Survival HUD → Task 4 ✓
- IndexedDB persistence → Tasks 13–14 ✓ (modified chunks + player state per user
  decision)
- Debt #1 greedy+texture array → Task 15 ✓
- Debt #2 water translucency → Task 16 ✓
- Supporting: items/drops/combat (Tasks 1–2, 7, 9) — required plumbing for mining
  drops, tools, and mob interaction.

**Placeholder scan:** no TBD/TODO placeholders; recipe table, mob numbers, day length,
damage values, save schema all specified with concrete values.

**Type consistency:** `Vitals`, `ItemStack`, `ItemId`, `SavePayload`, `ChunkMesh { opaque,
water }` used consistently across tasks; `ChunkMesh` change is flagged in both Task 15
(worker message) and Task 16 (consumer) — worker-client updated once in 15.3.

**Architecture:** no Three/DOM in world/player/core (verified by Task 17.3 grep);
`fake-indexeddb` is devDependency only (spec allows — runtime deps unchanged).

**Ordering:** items → vitals → HUD → mode → daynight → drops → mobs → combat → death →
recipes → crafting UI → save → continue → meshing debt → water debt → verify. Each task
is independently testable and committable.

**Verification (executed through 2026-09-30):** Tasks 1–16 executed one task at a
time via subagent-driven-development (implementer → spec review → code-quality review
→ fix → re-review), each ending APPROVED. Task 17: **529 tests green**, tsc / eslint /
vite build clean, red-line grep zero matches, runtime deps = `three` only, browser
walkthrough **11/11 items** (automated CDP script; evidence: screenshots + JSON
summaries in `D:\dev-temp\temp\opencode\wecraft-shots\`). Accepted standing
deviations kept by decision: spec §151 27-slot storage, New Game seed inheritance,
0.25 s place cooldown (spec line 119, Phase 1 legacy).

**Status:** DONE — executed on branch `phase2-survival` (HEAD `e3029af`).
