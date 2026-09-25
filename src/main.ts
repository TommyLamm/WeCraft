import './style.css';
import { createGameScene, createDropRenderer, createMobRenderer } from './render/scene';
import { ChunkRenderer } from './render/chunk-renderer';
import { drawAtlas } from './render/textures';
import { World, chunkKey } from './world/world';
import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT } from './world/chunk';
import { TerrainWorkerClient } from './world/worker-client';
import { raycast, reachFor } from './world/raycast';
import { BLOCK, HOTBAR_DEFAULT } from './world/blocks';
import { blockFromItem, stackFromBlock, stackName, maxStack, type ItemId, type ItemStack } from './core/items';
import { emptyGrid } from './core/recipes';
import { createInventoryModel, type GameMode } from './core/inventory';
import { createBus, type GameEvents } from './core/bus';
import { createPlayer, stepPlayer, EYE_HEIGHT, type PlayerState } from './player/physics';
import { createInput } from './player/input';
import { createVitals, damage, exhaust, tickVitals, isDead as isPlayerDead, fallDamage, type Vitals } from './player/survival';
import { updateFall, resetFall, type FallState } from './player/fallstate';
import {
  DigProgress,
  placeTarget,
  canPlaceAt,
  spawnBlockDrop,
  toolSpeed,
  digStep,
  toolDamage,
  hitMobId,
  attackMob,
} from './player/interact';
import { stepDrops, pickable, pickup, type DropEntity } from './world/drops';
import {
  stepMobs,
  stepArrows,
  spawnArrow,
  trySpawnMob,
  isDead,
  xzDistance,
  SPAWN_INTERVAL_SEC,
  DESPAWN_DISTANCE,
  type Mob,
  type Arrow,
  type MobEvent,
} from './world/mobs';
import { createHud } from './ui/hud';
import { itemIcon } from './ui/icons';
import { renderVitals } from './ui/survival-hud';
import { createMenus } from './ui/menus';
import { createDeathScreen } from './ui/death';
import { createInventory } from './ui/inventory';
import { createCrafting, type CraftingParams } from './ui/crafting';
import { loadSettings, saveSettings } from './core/settings';
import { createClock, tickClock, phaseOf, sunDirection, skyColors, type Clock } from './core/daynight';
import { generateChunk, surfaceHeight } from './world/terrain';
// Task 14: save/continue — payload assembly is pure (save.ts), all call sites
// here are thin (composition-root convention).
import { collectSavePayload, loadGame, saveGame, type SavePayload } from './world/save';

// 'dead' (Task 9): frozen world; Task 10 mounts the death screen + respawn flow
// 'crafting' (Task 11): the 3×3 crafting-table overlay (same frozen-world
// handling as 'inventory' — the frame loop's final else keeps it static)
type GameState = 'title' | 'playing' | 'paused' | 'inventory' | 'crafting' | 'dead';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;
const gs = createGameScene(canvas);
const settings = loadSettings();
const world = new World();
const chunkRenderer = new ChunkRenderer(gs.scene, drawAtlas());
// Task 7: drop sprites — icon factory injected here (render/ never imports ui/)
const dropRenderer = createDropRenderer(gs.scene, itemIcon);
// Task 8: mobs + arrows — blocky humanoids and oriented boxes
const mobRenderer = createMobRenderer(gs.scene);
const terrain = new TerrainWorkerClient(settings.seed);
const input = createInput(canvas, settings);
const hud = createHud(uiRoot);
const menus = createMenus(uiRoot);
const inv = createInventory(uiRoot);
// Task 11: standalone 3×3 crafting overlay (right-click on a crafting table)
const craftUi = createCrafting(uiRoot);
// Task 10: death overlay — callbacks only (Decision A: ui never imports the bus)
const deathScreen = createDeathScreen(uiRoot);

// ---- 遊戲事件匯流排 ----
// `GameEvents` payload-map type lives in core/bus.ts next to the GameEvent union
// (Task 5 decision A: pure type, no DOM/Three). The INSTANCE stays here at the
// composition root — ui modules never import the bus; they take callbacks instead.
const bus = createBus<GameEvents>();

let state: GameState = 'title';
let player: PlayerState = createPlayer(0.5, 90, 0.5);
// Current game mode (Task 5): mirrors settings.mode at boot and follows the
// pause-menu toggle via the mode-changed event below.
let currentMode: GameMode = settings.mode;
// Stack-based model owns the hotbar slots; `hotbar` is the live reference the
// HUD/palette render. Mode comes from settings (default survival since Task 5);
// creative add/remove no-op inside the model.
const inventory = createInventoryModel(
  HOTBAR_DEFAULT.map((b) => stackFromBlock(b)),
  settings.mode,
);
const hotbar = inventory.slots;
let selected = 0;
let showDebug = false;
let thirdPerson = false;
let itemNameTimer: ReturnType<typeof setTimeout> | undefined;
const dig = new DigProgress();

// ---- Crafting state (Task 11) ----
// The grid is owned here (not by the UI) so items staged in it survive between
// opens of the same size. `craftExcess` parks leftovers that didn't fit a full
// inventory — retried on the next reset, so items are never destroyed.
let craftGrid: Array<ItemStack | null> = [];
let craftExcess: ItemStack[] = [];

/** Give `count` of `item` back to the inventory → the overflow that didn't fit.
 *  Creative's `addItem` is a no-op (infinite supply), so creative writes the
 *  stacks directly (merge partials, then empty slots). That branch is NOT dead
 *  (review #3): the crafting take/give-back paths are survival-only now, but
 *  `resetCraftGrid`'s flush below runs on every inventory open in ANY mode —
 *  a grid staged in survival and then mode-toggled must still hand its items
 *  back instead of losing them to the creative no-op. */
function giveItem(item: ItemId, count: number): number {
  if (inventory.mode !== 'creative') return inventory.addItem(item, count);
  const cap = maxStack(item);
  let rest = count;
  for (let i = 0; i < hotbar.length && rest > 0; i++) {
    const s = hotbar[i];
    if (!s || s.item !== item || s.count >= cap) continue;
    const put = Math.min(cap - s.count, rest);
    inventory.setSlot(i, { item, count: s.count + put });
    rest -= put;
  }
  for (let i = 0; i < hotbar.length && rest > 0; i++) {
    if (hotbar[i]) continue;
    const put = Math.min(cap, rest);
    inventory.setSlot(i, { item, count: put });
    rest -= put;
  }
  return rest;
}

/** Rebuild `craftGrid` for `size`, handing every leftover (plus anything
 *  parked in `craftExcess`) back to the inventory first; items that still
 *  don't fit land in the FRONT cells of the new grid — visible and craftable,
 *  never lost. Called on every crafting open (the grid starts empty) and on
 *  every inventory open (see the call site — it must flush in creative too).
 *  Task 13: flush craftGrid before save (staged items live only in this array). */
function resetCraftGrid(size: 2 | 3): void {
  const pending: ItemStack[] = [...craftExcess];
  craftExcess = [];
  for (const cell of craftGrid) {
    if (cell && Number.isFinite(cell.count) && cell.count >= 1) pending.push({ ...cell });
  }
  craftGrid = emptyGrid(size);
  let front = 0;
  for (const p of pending) {
    const overflow = giveItem(p.item, p.count);
    if (overflow > 0 && front < craftGrid.length) {
      craftGrid[front++] = { item: p.item, count: overflow };
    } else if (overflow > 0) {
      craftExcess.push({ item: p.item, count: overflow });
    }
  }
}

/** Callback bundle for ui/crafting (Decision A: plain callbacks, no bus).
 *  Mutations go through the inventory model (`setSlot`/`giveItem`); the HUD is
 *  refreshed after each so the hotbar below stays in sync live. */
function craftingParams(size: 2 | 3): CraftingParams {
  return {
    size,
    grid: craftGrid, // live array — the UI writes cells in place
    hotbar, // live slots — re-read on every UI render
    selected, // source slot for the first transfer (UI-local afterwards)
    // no onSlotSelect: the craft row's source selection is local to the widget.
    // Syncing it into `selected` would desync the inventory palette, whose
    // heading + onPick snapshot `selected` at open time (keys are gated while
    // unlocked, so nothing else can move it mid-open).
    onSpend: (slot, item) => {
      const s = hotbar[slot];
      if (!s || s.item !== item || !Number.isFinite(s.count) || s.count < 1) return false;
      inventory.setSlot(slot, s.count > 1 ? { item: s.item, count: s.count - 1 } : null);
      hud.setHotbar(hotbar, selected);
      return true;
    },
    onGiveBack: (item) => {
      const overflow = giveItem(item, 1);
      hud.setHotbar(hotbar, selected);
      return overflow;
    },
    onTake: (result) => {
      // Atomic take (review Critical #1): pre-check capacity BEFORE any write.
      // `addItem` commits its partial merges before returning the remainder, so
      // testing that remainder afterwards would still have granted a free
      // partial stack (and skipped this HUD refresh). `fits` matches addItem's
      // capacity exactly, so the give below never overflows here.
      if (!inventory.fits(result.item, result.count)) return false; // full → blocked, grid untouched
      giveItem(result.item, result.count);
      hud.setHotbar(hotbar, selected);
      return true;
    },
  };
}

// ---- Combat / vitals tuning (Task 9) ----
// Repeat hits on a held LMB are gated by a 0.6 s cooldown — without it the
// per-frame attack dispatch would deal ~60 hits/s; while the cooldown runs a
// mob under the crosshair also blocks digging (attack takes precedence).
const ATTACK_COOLDOWN_SEC = 0.6;
/** Melee reach in blocks (plan: "ray hits mob within 3.5 blocks") — separate
 *  from the block reach (`reachFor`, 4.5/5) which still governs dig/place. */
const MELEE_REACH = 3.5;
/** Exhaustion rates (settled 9.5): sprint drains 0.05/s, one jump costs 0.15
 *  at its ground-launch edge; plain walking costs nothing. */
const SPRINT_EXHAUST_PER_SEC = 0.05;
const JUMP_EXHAUST = 0.15;
/** Per-frame melee cooldown timer toward ATTACK_COOLDOWN_SEC. */
let attackCd = 0;
/** Apex (peak y) of the current airborne span for fall damage (plan 9.1) —
 *  pure lifecycle in player/fallstate.ts: advanced every frame by `updateFall`
 *  from a PRE-physics y capture, and reset via `resetFall()` on respawn (a
 *  stale apex surviving into a new session would one-shot kill the spawn fall
 *  — review Critical #1). */
let fallState: FallState = resetFall();

// ---- 物品掉落（Task 7）----
// Pure entities stepped each frame while playing; survival breaks spawn them
// (spawnBlockDrop), proximity picks them up (pickable + pickup).
let drops: DropEntity[] = [];

// ---- 生物与箭矢（Task 8）----
// Pure mob AI (world/mobs.ts) stepped each frame while playing; night spawns
// them on the surface, distance despawns them, death removes them (no loot).
let mobs: Mob[] = [];
let arrows: Arrow[] = [];
let spawnAcc = 0; // seconds toward the next 5 s spawn tick

// ---- 晝夜循環（Task 6）----
// Clock only advances while playing; sky/light refresh every frame (cheap math),
// `time-changed` emits ONLY on a day↔night flip (HUD/mobs consume it later).
let clock: Clock = createClock(settings.dayLengthSec);

// ---- 存檔 / 繼續（Task 14）----
/** Last known save: loaded ONCE at boot (gates the title's Continue button —
 *  settled: hidden when no save) and refreshed by every SUCCESSFUL save in
 *  this page life, so a click always applies the freshest known payload
 *  without a second IDB read (and inside the click's pointer-lock gesture).
 *  The save itself only changes through this page's saveGame calls, so the
 *  cache matches what loadGame() would return (single-player, single tab). */
let savedPayload: SavePayload | null = null;
/** True from game entry (new game OR continue) until a quit-to-title — the
 *  honest guard for the beforeunload save: on the title with no session
 *  there is nothing worth saving (settled). */
let sessionStarted = false;
/** Seconds accumulator toward the 30 s autosave while playing. */
let saveAcc = 0;
const AUTOSAVE_INTERVAL_SEC = 30;

// ---- 生存 HUD（Task 4）----
// .vitals 容器：same programmatic markup pattern as hud/menus/inventory
const vitalsEl = document.createElement('div');
vitalsEl.className = 'vitals';
uiRoot.appendChild(vitalsEl);

/** Current vitals — null while in creative mode (the whole `.vitals` bar hides).
 *  Boot mode comes from settings; the mode-changed handler (Task 5) and damage
 *  sources (Task 9) update it through `setVitals` (starts null so the first
 *  setVitals call below is a visible transition that repaints + emits). */
let vitals: Vitals | null = null;

/** Single vitals mutation path: store `next`, repaint the HUD, hide the bar
 *  when null — and (Task 9) emit `vitals-changed` whenever a HUD-visible value
 *  changed, i.e. an integer hp or hunger value moved. Saturation-first
 *  exhaustion and the regen/starve accumulators are invisible in the HUD, so
 *  those are carried silently — this is what keeps the per-frame tick from
 *  spamming the bus (~4×/s worst case, damage/regen/starve emit immediately
 *  because their hp integers move). Creative never reaches the emit (next is
 *  null). The emit re-enters the consumer below with identical integers → its
 *  visible gate stops the recursion after one hop. */
function setVitals(next: Vitals | null): void {
  const prev = vitals;
  vitals = next;
  if (!next) {
    renderVitals(vitalsEl, null);
    vitalsEl.style.display = 'none';
    return;
  }
  const visible =
    !prev ||
    Math.floor(prev.hp) !== Math.floor(next.hp) ||
    Math.floor(prev.hunger) !== Math.floor(next.hunger);
  if (!visible) return; // nothing HUD-visible changed → no repaint, no emit
  renderVitals(vitalsEl, next);
  vitalsEl.style.display = '';
  bus.emit('vitals-changed', {
    hp: next.hp,
    maxHp: next.maxHp,
    hunger: next.hunger,
    maxHunger: next.maxHunger,
  });
}

setVitals(inventory.mode === 'survival' ? createVitals() : null); // initial paint (hidden in creative)

// Single vitals-changed → HUD path (producer: setVitals above, Task 9).
bus.on('vitals-changed', ({ hp, maxHp, hunger, maxHunger }) => {
  if (!vitals) return; // creative: nothing to update
  setVitals({ ...vitals, hp, maxHp, hunger, maxHunger });
});

// ---- Mode switch (Task 5): THE single place mode state is persisted + applied
// (consolidated per review Important #1 — a future emitter just emits and gets
// saveSettings + in-memory settings.mode + inventory/refill/vitals for free).
// The emit is synchronous, so menus' post-callback re-read of loadSettings
// still sees the new value for its label.
bus.on('mode-changed', ({ mode }) => {
  currentMode = mode;
  settings.mode = mode; // keep in-memory settings fresh (title/new-game read it)
  saveSettings({ mode }); // single persist point
  inventory.setMode(mode);
  if (mode === 'creative') {
    // full hotbar refill: every block slot back to a full ×64 stack (matches hotbar init)
    HOTBAR_DEFAULT.forEach((b, i) => inventory.setSlot(i, stackFromBlock(b)));
    hud.setHotbar(hotbar, selected);
    setVitals(null); // hide the bar; Task 9 owns the vitals lifecycle
  } else {
    // survival: vitals enabled — always fresh here: creative entry set vitals to
    // null and vitals-changed guards null, so there is nothing to preserve.
    // A survival↔creative round-trip therefore resets HP/hunger to full
    // (intentional for now; Task 9 may stash vitals on creative entry).
    setVitals(createVitals());
  }
});

function applyRenderDistanceFog(): void {
  const fog = gs.scene.fog;
  if (fog && 'far' in fog) fog.far = settings.renderDistance * CHUNK_SIZE;
}
applyRenderDistanceFog();

// ---- 區塊佇列（preserves shipped Task 11/12 fixes: generated-keyed, gen r+1,
//      mesh ≤ r, unload r+2, drop-not-ready with NO re-push) ----
const pendingGen: Array<[number, number]> = [];
const pendingMesh: Array<[number, number]> = [];
const generated = new Set<string>();
const genInFlight = new Set<string>();

// ---- 出生點：同步生成 (0,0)，spawn on surfaceHeight(0.5,0.5)+1 ----
function spawnPoint(): { x: number; y: number; z: number } {
  // key off generated (not hasChunk): setBlock auto-creates empty chunks (Task 6 deviation)
  if (world.getChunk(0, 0)?.generated !== true) {
    const chunk = new Chunk(0, 0, generateChunk(0, 0, settings.seed));
    chunk.generated = true;
    chunk.dirty = true;
    world.addChunk(chunk);
    // Task 14: this synchronous fill wholesale-replaces chunk data — same
    // clobber hazard as the async gen response handler, so re-apply edits
    // recorded before the chunk existed as generated (e.g. Continue's
    // applyModified auto-creating (0,0) ahead of this line).
    world.reapplyModifiedInChunk(0, 0);
  }
  generated.add(chunkKey(0, 0));
  let y = surfaceHeight(0.5, 0.5, settings.seed) + 1;
  // walk up out of trees/leaves so the player AABB never starts inside solid blocks
  const blocked = (yy: number): boolean =>
    world.isSolid(0, Math.floor(yy), 0) ||
    world.isSolid(0, Math.floor(yy + 0.9), 0) ||
    world.isSolid(0, Math.floor(yy + 1.7), 0);
  while (y < CHUNK_HEIGHT - 3 && blocked(y)) y++;
  return { x: 0.5, y, z: 0.5 };
}

// ---- Task 8: mob spawning + event application ----

/** Every 5 s while playing: delegate to the pure `trySpawnMob` (world/mobs.ts)
 *  — night gate, cap, candidate XZ 12–24 out, surface Y and kind all live
 *  there; this composition-root wrapper only supplies the world callbacks and
 *  pushes the result. Count changes are announced by the caller. */
function spawnTick(): void {
  const mob = trySpawnMob(mobs, player.position, {
    isNight: phaseOf(clock.t) === 'night',
    isSolidAt: (x, y, z) => world.isSolid(x, y, z),
    blockIdAt: (x, y, z) => world.getBlock(x, y, z),
  });
  if (mob) mobs = [...mobs, mob];
}

/** Apply one mob event at the vitals/arrow layer: damage goes through the
 *  `setVitals` path (creative → vitals null → no-op), which emits
 *  `vitals-changed` when an integer hp/hunger value moves (Task 9 producer);
 *  shoot spawns an Arrow entity. */
function applyMobEvent(ev: MobEvent): void {
  if (ev.type === 'shoot') {
    arrows = spawnArrow(arrows, ev.from, ev.dir, ev.mobId);
    return;
  }
  if (!vitals) return; // creative (or dead) — nothing to hurt
  setVitals(damage(vitals, ev.amount));
}

function refreshQueues(): void {
  const pcx = Math.floor(player.position.x / CHUNK_SIZE);
  const pcz = Math.floor(player.position.z / CHUNK_SIZE);
  const r = settings.renderDistance;
  const rg = r + 1; // gen one ring past mesh radius so edge chunks have all 4 neighbors
  pendingGen.length = 0;
  pendingMesh.length = 0;

  for (let dz = -rg; dz <= rg; dz++) {
    for (let dx = -rg; dx <= rg; dx++) {
      const cx = pcx + dx;
      const cz = pcz + dz;
      const key = chunkKey(cx, cz);
      const c = world.getChunk(cx, cz);
      // generated-keyed, not hasChunk (Task 6 deviation)
      if ((c?.generated !== true) && !generated.has(key)) {
        pendingGen.push([cx, cz]);
      } else if (
        Math.abs(dx) <= r &&
        Math.abs(dz) <= r &&
        c?.dirty
      ) {
        pendingMesh.push([cx, cz]);
      }
    }
  }

  // 近→遠排序，優先載入腳下
  pendingGen.sort((a, b) => dist2(a, pcx, pcz) - dist2(b, pcx, pcz));
  pendingMesh.sort((a, b) => dist2(a, pcx, pcz) - dist2(b, pcx, pcz));

  for (const key of [...world.chunks.keys()]) {
    const [cx, cz] = key.split(',').map(Number);
    if (Math.abs(cx - pcx) > r + 2 || Math.abs(cz - pcz) > r + 2) {
      if (cx === 0 && cz === 0) continue; // 保留出生區塊
      chunkRenderer.remove(cx, cz);
      world.removeChunk(cx, cz);
      generated.delete(key);
    }
  }
}

function dist2([cx, cz]: [number, number], pcx: number, pcz: number): number {
  return (cx - pcx) ** 2 + (cz - pcz) ** 2;
}

function neighborsReady(cx: number, cz: number): boolean {
  return (
    world.getChunk(cx + 1, cz)?.generated === true &&
    world.getChunk(cx - 1, cz)?.generated === true &&
    world.getChunk(cx, cz + 1)?.generated === true &&
    world.getChunk(cx, cz - 1)?.generated === true
  );
}

function processQueues(): void {
  let budgetGen = 2;
  let budgetMesh = 2;
  while (budgetGen > 0 && pendingGen.length > 0) {
    const [cx, cz] = pendingGen[0];
    const key = chunkKey(cx, cz);
    if (genInFlight.has(key)) {
      pendingGen.shift();
      continue;
    }
    pendingGen.shift();
    genInFlight.add(key);
    void terrain.request(cx, cz).then((resp) => {
      genInFlight.delete(key);
      // fill-if-not-generated response handler (shipped main.ts pattern wins over plan's `if (hasChunk) return`)
      const data = new Uint8Array(resp.buffer);
      const existing = world.getChunk(cx, cz);
      if (existing) {
        if (existing.generated) return;
        existing.data.set(data);
        existing.generated = true;
        existing.dirty = true;
      } else {
        const chunk = new Chunk(cx, cz, data);
        chunk.generated = true;
        chunk.dirty = true;
        world.addChunk(chunk);
      }
      generated.add(key);
      // Task 14 load-order fix: the fill above may have wiped edits recorded
      // while the chunk was NOT yet generated (Continue's applyModified
      // auto-creates generated=false chunks; unloaded chunks re-fill on
      // return) — saved/player edits must always win over regenerated terrain.
      world.reapplyModifiedInChunk(cx, cz);
    }).catch(() => genInFlight.delete(key));
    budgetGen--;
  }
  while (budgetMesh > 0 && pendingMesh.length > 0) {
    const [cx, cz] = pendingMesh.shift()!;
    const c = world.getChunk(cx, cz);
    // drop-not-ready entries (NO re-push): readiness cannot change mid-pass,
    // and refreshQueues re-queues dirty chunks next frame — re-pushing would spin forever.
    if (c?.dirty && neighborsReady(cx, cz)) {
      chunkRenderer.rebuild(world, cx, cz);
      c.dirty = false;
      budgetMesh--;
    }
  }
}

// ---- 狀態切換 ----
function relockCanvas(): void {
  const p = canvas.requestPointerLock?.();
  if (p && typeof p.catch === 'function') p.catch(() => {});
}

function setState(next: GameState): void {
  state = next;
  menus.hideAll();
  inv.close();
  craftUi.close(); // every transition clears the crafting overlay too (idempotent)
  deathScreen.hide(); // every transition clears the overlay; the 'dead' branch re-mounts it
  if (next === 'title') {
    // Task 14: Continue renders iff a save exists (savedPayload — boot load
    // or a successful in-session save); no save → hidden (settled).
    menus.showTitle({
      hasSave: savedPayload !== null,
      onContinue: handleContinue,
      onNewGame: startGame,
    });
    document.exitPointerLock?.();
  } else if (next === 'paused') {
    menus.showPause({
      onResume: () => {
        // settings edited in the pause menu persist to localStorage — live-apply on resume
        const prevRd = settings.renderDistance;
        Object.assign(settings, loadSettings());
        if (settings.renderDistance !== prevRd) applyRenderDistanceFog();
        // menus relocks the canvas after onResume returns (click gesture)
        setState('playing');
      },
      // reset to spawn before title: title orbit queues key off player.position —
      // leaving it far away would orbit a one-chunk island (Task 17 CR fix)
      onQuit: quitToTitle, // plain 回到標題 — UNSAVED quit (Task 14 settled split)
      // Task 14: 儲存並離開 — snapshot the live session FIRST, save, then quit
      // (both callbacks are separate buttons; the death screen's quit below
      // deliberately has neither — see handleQuitToTitle).
      onSaveQuit: () => {
        const payload = sessionSavePayload();
        void saveGame(payload).then(
          () => {
            savedPayload = payload; // boot check may predate this save
            quitToTitle();
          },
          () => quitToTitle(), // best-effort: still quit; savedPayload stays honest
        );
      },
      // mode toggle (Task 5): emit only — the mode-changed handler above owns
      // persistence + application (Decision A — menus stays bus-free); menus
      // re-renders its label from settings after this callback returns
      onToggleMode: () => {
        const next: GameMode = currentMode === 'survival' ? 'creative' : 'survival';
        bus.emit('mode-changed', { mode: next });
      },
    });
  } else if (next === 'dead') {
    // Death screen + respawn (Task 10). Callback-opts like menus.showPause —
    // death.ts stays bus-free (Decision A). Mount FIRST so a future
    // synchronous `player-died` listener that changes state can't leave this
    // overlay mounting on top of the next screen (review Minor #3): the emit
    // is deliberately the LAST statement in this branch.
    deathScreen.show({
      onRespawn: handleRespawn,
      onQuit: handleQuitToTitle,
    });
    // Freeze behavior (Task 9) unchanged: the pointer unlocks (the lock-change
    // handler pauses only from 'playing', so this can't bounce into the pause
    // menu), and every later frame skips the `playing` block → movement,
    // physics and mob AI freeze. The current frame finishes its tail
    // (harmless: a survival dig needs many frames and further damage is
    // blocked by the vitals guard).
    document.exitPointerLock?.();
    // `player-died` fires ONCE per death: this transition is guarded at the
    // call site by `state === 'playing'` (plus the vitals guard), and nothing
    // else calls setState('dead').
    bus.emit('player-died', {});
  } else if (next === 'inventory') {
    // Flush leftovers from a previous session (items never lost) — this runs in
    // creative too, where the 2×2 section below does NOT mount (plan 12.4).
    resetCraftGrid(2);
    inv.open(
      hotbar,
      selected,
      (slot, stack) => {
        inventory.setSlot(slot, stack);
        hud.setHotbar(hotbar, selected);
      },
      // backdrop click closes: E can only fire while pointer-locked, and opening
      // the inventory unlocks — so "press E again to close" is impossible (Task 17 deviation)
      () => {
        setState('playing');
        relockCanvas();
      },
      // Task 11: 2×2 crafting section embedded at the top of the panel.
      // creative: crafting hidden (plan 12.4) → no params, no section mounted.
      currentMode === 'survival' ? craftingParams(2) : undefined,
    );
  } else if (next === 'crafting') {
    // Task 11: right-click on a placed crafting table → standalone 3×3 overlay.
    // Reachable in survival only: the sole entry point is the gated place-path
    // above (creative: crafting hidden, plan 12.4).
    resetCraftGrid(3);
    craftUi.open({
      ...craftingParams(3),
      onClose: () => {
        setState('playing');
        relockCanvas();
      },
    });
  }
}

function resetPlayerToSpawn(): void {
  const sp = spawnPoint();
  player = createPlayer(sp.x, sp.y, sp.z);
  // Session-scoped state (review Critical #1 + Minor #5): a stale apex from
  // quitting mid-fall would turn the fresh spawn's drop into a one-shot kill
  // (max(staleApex, y)), and a carried attackCd would swallow the next
  // session's first swing.
  fallState = resetFall();
  attackCd = 0;
}

/** Snapshot the live session as a SavePayload (Task 14) — thin composition-root
 *  adapter feeding the PURE `collectSavePayload`. The World has no seed of its
 *  own (terrain generation is keyed off `settings.seed` in the worker client),
 *  so the seed is supplied from settings here: the payload therefore records
 *  the seed the world was actually generated with at save time. */
function sessionSavePayload(): SavePayload {
  return collectSavePayload({
    world: { seed: settings.seed, serializeModified: () => world.serializeModified() },
    player: {
      pos: [player.position.x, player.position.y, player.position.z],
      yaw: player.yaw,
      mode: currentMode,
      inventory: [...hotbar],
    },
    vitals,
    clockT: clock.t,
  });
}

/** Fire-and-forget save of the current session (Task 14): the payload is
 *  snapshotted synchronously (state can't drift mid-save); a success caches
 *  it for the title's Continue button, a rejection is swallowed — saving is
 *  best-effort everywhere (autosave, beforeunload — nothing can await). */
function persistNow(): void {
  const payload = sessionSavePayload(); // snapshot once — save + cache are identical
  void saveGame(payload)
    .then(() => {
      savedPayload = payload;
    })
    .catch(() => {
      /* best-effort: on failure the previous savedPayload stays honest */
    });
}

/** Shared quit-to-title tail (pause 回到標題 / 儲存並離開 / death quit): ends
 *  the session (beforeunload stops saving) and resets the player — the title
 *  orbit queues key off player.position, so leaving it far away would orbit a
 *  one-chunk island (Task 17 CR fix). No save happens here — saving is the
 *  explicit job of 儲存並離開 / autosave / beforeunload (Task 14 settled). */
function quitToTitle(): void {
  sessionStarted = false;
  resetPlayerToSpawn();
  setState('title');
}

function startGame(): void {
  sessionStarted = true;
  resetPlayerToSpawn();
  setState('playing');
  relockCanvas();
}

/** Continue flow (Task 14): apply the payload, THEN enter the game exactly
 *  like startGame. Order matters:
 *  1. World — `applyModified` first so raycast/physics see the edits at once.
 *     Chunks auto-created here are `generated === false`, so the async
 *     terrain-gen pass fills them LATER and wholesale-replaces data; main's
 *     gen response handler re-applies edits per chunk afterwards
 *     (`world.reapplyModifiedInChunk`) — saved edits always win over terrain
 *     gen (the subtle 14.4 hazard, tested at world level).
 *     SEED: the payload records `settings.seed` at save time while terrain
 *     generation uses the CURRENT `settings.seed` (there is no seed UI — a
 *     mismatch requires hand-editing localStorage between sessions). World +
 *     TerrainWorkerClient are built once at boot; rebuilding them for a
 *     foreign seed would mean wiping every loaded chunk + mesh, so instead
 *     edits apply onto whatever terrain generates (absolute block coords —
 *     they still win over gen, just possibly against different terrain), and
 *     the next save records the current seed, re-syncing the pair.
 *  2. Player — pos + yaw restored (payload has no pitch; velocity/flying/
 *     onGround are session-only and start fresh via createPlayer).
 *  3. Mode/inventory/vitals — applied DIRECTLY, not through the mode-changed
 *     event: that handler's creative refill / fresh-vitals side effects would
 *     clobber the restored slots and vitals. Settings are synced so menu
 *     labels (menus re-reads loadSettings) match the session mode.
 *  4. Clock — time-of-day restored (dayLengthSec stays settings-driven).
 */
function continueGame(payload: SavePayload): void {
  world.applyModified(payload.modified); // 1. world edits (see doc above)

  const [px, py, pz] = payload.player.pos;
  player = createPlayer(px, py, pz);
  player.yaw = payload.player.yaw;
  // Session-scoped resets, mirroring resetPlayerToSpawn (a stale fall apex or
  // carried attack cooldown must not leak into the restored session).
  fallState = resetFall();
  attackCd = 0;

  currentMode = payload.player.mode; // 3. mode
  settings.mode = currentMode;
  saveSettings({ mode: currentMode }); // keep menu labels in sync
  inventory.setMode(currentMode);
  for (let i = 0; i < hotbar.length; i++) {
    const s = payload.player.inventory[i];
    inventory.setSlot(i, s ? { ...s } : null); // setSlot copies + validates; clears the tail
  }
  hud.setHotbar(hotbar, selected);
  // vitals: survival restores saved values (payload vitals is null only when
  // it was saved in creative; a corrupt survival payload falls back to a full
  // reset); creative keeps the hidden bar hidden.
  setVitals(currentMode === 'survival' ? (payload.player.vitals ?? createVitals()) : null);

  clock.t = payload.time.t; // 4. time-of-day

  sessionStarted = true;
  setState('playing'); // same entry tail as startGame
  relockCanvas(); // the click is a user gesture → controls live
}

/** Title 繼續遊戲 (Task 14): apply the cached payload synchronously — inside
 *  the click gesture, so the pointer-lock relock in continueGame works. The
 *  cache is refreshed by every successful save (see savedPayload), i.e. it IS
 *  the latest save this page knows about; applying it is what "continue from
 *  save" means (state newer than the last save was never saved). */
function handleContinue(): void {
  if (savedPayload) {
    continueGame(savedPayload);
    return;
  }
  startGame(); // defensive: button rendered without a save (unreachable — hasSave gates it)
}

/** Respawn flow (Task 10): full vitals → world spawn → back to 'playing'.
 *  Inventory is intentionally untouched (settled: death does NOT drop items),
 *  and mobs frozen at death stay put (out of scope, settled). The overlay goes
 *  with the transition — setState clears it. */
function handleRespawn(): void {
  setVitals(createVitals()); // hp 0 → 20 / hunger refilled — emits vitals-changed via the integer gate
  resetPlayerToSpawn(); // pos/vel/fallState/attackCd → spawn; inventory untouched
  setState('playing'); // resumes the world (playing block + render tail) + clears the overlay
  relockCanvas(); // Respawn click is a user gesture → controls live (mirrors startGame)
}

/** Death-screen quit (review Important #1): mirror the pause-menu quit — full
 *  vitals first (leaving at hp 0 would carry the corpse into 單人遊戲 and
 *  re-kill the fresh spawn on its first frame) plus the shared quitToTitle
 *  tail (spawn reset for the title orbit, session end).
 *  NO SAVE — Task 14 settled: death-quit deliberately does not save (you're
 *  dead; vitals reset anyway), unlike the pause menu's 儲存並離開. */
function handleQuitToTitle(): void {
  if (vitals) setVitals(createVitals());
  quitToTitle();
}

// pointer lock 釋放 → 暫停；inventory 開啟時主動解鎖，保持背包開著
input.onLockChange((locked) => {
  if (locked) return;
  if (state === 'playing') setState('paused');
});

// relock can reject after backdrop/Esc inventory close (no transient activation):
// without this we'd sit in 'playing' with dead controls and no pause menu.
// Page-lifetime listener — attach once (Task 17 deviation: pointerlockerror → pause).
document.addEventListener('pointerlockerror', () => {
  if (state === 'playing' && !input.locked) setState('paused');
});

// Task 14 save point (b): best-effort save on tab close/refresh. Fire-and-forget
// (the page is tearing down — nothing can await it; rejection swallowed) and
// guarded by the session flag so the title screen with no session never writes
// a save. Page-lifetime listener — attach once, never removed.
window.addEventListener('beforeunload', () => {
  if (!sessionStarted) return;
  const payload = sessionSavePayload();
  void saveGame(payload).catch(() => {});
});

input.setMouseMoveHandler((dx, dy) => {
  player.yaw -= dx;
  player.pitch -= dy;
  const limit = Math.PI / 2 - 0.01;
  player.pitch = Math.max(-limit, Math.min(limit, player.pitch));
});

// ---- 主循環 ----
let last = performance.now();
let fps = 60;
let fpsAcc = 0;
let fpsCount = 0;

window.addEventListener('resize', () =>
  gs.setSize(window.innerWidth, window.innerHeight),
);

hud.setHotbar(hotbar, selected);
// Task 14: resolve save existence ONCE before the title mounts — Continue
// renders iff loadGame() found a payload (settled: hidden when there is none,
// async → title with the conditional button). loadGame never rejects (null on
// any failure); state already IS 'title', this only (re)renders the menu.
void loadGame().then((payload) => {
  savedPayload = payload;
  setState('title');
});

gs.renderer.setAnimationLoop(() => {
  const now = performance.now();
  let dt = (now - last) / 1000;
  dt = Math.min(0.1, Math.max(0, dt)); // clamp huge/negative dt (Task 13 deviation; physics substeps internally)
  last = now;
  fpsAcc += dt;
  fpsCount++;
  if (fpsAcc >= 0.5) {
    fps = Math.round(fpsCount / fpsAcc);
    fpsAcc = 0;
    fpsCount = 0;
  }

  if (state === 'playing') {
    // 晝夜：tick clock → 每幀刷新 sun/sky/fog（cheap），僅在 day↔night 翻轉時 emit
    const prevPhase = phaseOf(clock.t);
    clock = tickClock(clock, dt);
    const phase = phaseOf(clock.t);
    gs.setDayNight(sunDirection(clock.t), skyColors(clock.t));
    if (phase !== prevPhase) bus.emit('time-changed', { phase, t: clock.t });

    // 移動 — jump start edge (Task 9.5): captured BEFORE physics clears
    // onGround; water swim-strikes and active flight aren't discrete jumps,
    // so neither launches the 0.15-exhaust jump charge.
    const jumpStarted =
      input.state.jump && player.onGround && !player.flying && !player.inWater;
    // Pre-physics capture (review Important #2): the fall apex must keep the
    // EXACT pre-fall y — reading it after stepPlayer had already lost g·dt² ≈
    // 0.009 on the first airborne frame, which made every integer-height fall
    // deal 1 less than spec (floor(D−ε−3) = D−4).
    const preStepY = player.position.y;
    stepPlayer(player, input.state, world, dt);

    // ---- Fall damage (plan 9.1) — apex lifecycle in player/fallstate.ts ----
    // Contract: airborne → track the peak; grounded landing → distance = peak −
    // landed y; water/flight clear the apex WITHOUT damage (plan 9.1
    // "landing on water/ground decides resetFall"); hops under 3 blocks are
    // absorbed by fallDamage itself. Charged in survival only (creative is
    // exempt; vitals is null there too — the mode guard keeps the intent
    // explicit). A kill is picked up by the death check in the vitals block.
    const fall = updateFall(
      fallState,
      preStepY,
      player.position.y,
      player.onGround,
      player.flying,
      player.inWater,
    );
    fallState = fall.fall;
    if (fall.distance !== null && currentMode === 'survival' && vitals) {
      const amount = fallDamage(fall.distance);
      if (amount > 0) setVitals(damage(vitals, amount)); // emits vitals-changed via setVitals
    }

    // ---- 物品掉落（Task 7）：physics → proximity pickup ----
    const dropsBefore = drops.length;
    drops = stepDrops(drops, dt, (x, y, z) => world.isSolid(x, y, z)); // water ≠ solid → falls through
    if (drops.length !== dropsBefore) bus.emit('drops-changed', {}); // a drop despawned (300 s)
    // Creative guard (review Minor #6): creative never SPAWNS drops, but after a
    // mid-game survival→creative switch ground drops exist — and addItem's
    // creative no-op (0) would read as "fully taken", silently deleting them.
    // Skipping the attempt keeps them lying around for a switch back.
    if (currentMode !== 'creative') {
      const near = pickable(drops, player.position);
      let pickedUp = false;
      // back-to-front: removing index i must not shift the ones still to process
      for (let i = near.length - 1; i >= 0; i--) {
        const idx = near[i];
        const countBefore = drops[idx]?.count ?? 0;
        const res = pickup(drops, idx, inventory);
        drops = res.drops;
        if (res.overflow < countBefore) pickedUp = true; // at least 1 item entered the inventory
      }
      if (pickedUp) {
        hud.setHotbar(hotbar, selected); // inventory changed → refresh counts
        bus.emit('drops-changed', {});
      }
    }

    // ---- 生物（Task 8）：AI → events → vitals/arrows；死亡/超距移除 ----
    const mobsBefore = mobs.length;
    const isSolidAt = (x: number, y: number, z: number): boolean => world.isSolid(x, y, z);
    const stepped = stepMobs(mobs, { playerPos: player.position, isSolidAt, dt });
    mobs = stepped.mobs;
    for (const ev of stepped.events) applyMobEvent(ev);
    const shot = stepArrows(arrows, dt, isSolidAt, player.position);
    arrows = shot.arrows;
    for (const ev of shot.events) applyMobEvent(ev);
    // dead mobs vanish (no loot this phase); distance despawn past 48 blocks
    mobs = mobs.filter((m) => !isDead(m) && xzDistance(m.pos, player.position) <= DESPAWN_DISTANCE);
    if (mobs.length !== mobsBefore) bus.emit('mobs-changed', { count: mobs.length });

    // ---- 生存值（Task 9）：sprint/jump exhaustion + regen/starve tick ----
    // Mob/arrow damage already went through setVitals above (each emits
    // `vitals-changed` on an integer hp move); here one commit per frame
    // carries sprint/jump exhaustion and the tickVitals accumulators — again
    // emitting only when an integer hp/hunger value actually changed. The
    // death transition is checked right after (Task 10 owns the screen).
    if (vitals) {
      let v = vitals;
      const moving = input.state.fwd !== 0 || input.state.strafe !== 0;
      if (input.state.sprint && moving && !player.flying && !player.inWater) {
        v = exhaust(v, dt * SPRINT_EXHAUST_PER_SEC); // 0.05 exhaustion/s while sprinting
      }
      if (jumpStarted) v = exhaust(v, JUMP_EXHAUST); // 0.15 once per ground launch
      v = tickVitals(v, dt); // regen (hunger ≥ 18) / starve: 1 hp per 4 s
      setVitals(v); // repaint + emit only on an integer change (see setVitals)
      if (isPlayerDead(v) && state === 'playing') {
        setState('dead'); // death screen + player-died emit + freeze (Task 10)
      }
    }

    // Review Minor #6: a death this frame must skip the rest of the playing
    // tail (spawn tick / attack / dig / place) — the shared render tail below
    // the state chain still runs, so the world freezes behind the (Task 10)
    // death screen instead of processing one more gameplay frame.
    if (state === 'playing') {
      // spawn tick: every 5 s → night + cap + surface (8.5)
      spawnAcc += dt;
      if (spawnAcc >= SPAWN_INTERVAL_SEC) {
        spawnAcc = 0;
        const before = mobs.length;
        spawnTick();
        if (mobs.length !== before) bus.emit('mobs-changed', { count: mobs.length });
      }

      // Task 14 save point (c): autosave every 30 s while playing — BOTH modes
      // (mode is part of the payload; creative worlds save too — plan §7).
      saveAcc += dt;
      if (saveAcc >= AUTOSAVE_INTERVAL_SEC) {
        saveAcc = 0;
        persistNow();
      }

      // 相機（first-person eye；F5 加 third-person offset）
      const eye = { x: player.position.x, y: player.position.y + EYE_HEIGHT, z: player.position.z };
      gs.camera.position.set(eye.x, eye.y, eye.z);
      gs.camera.rotation.order = 'YXZ';
      gs.camera.rotation.y = player.yaw;
      gs.camera.rotation.x = player.pitch;
      gs.camera.rotation.z = 0; // defensive: never let residue become roll
      const back = 4;
      if (thirdPerson) {
        gs.camera.position.x -= Math.sin(player.yaw) * back;
        gs.camera.position.z -= Math.cos(player.yaw) * back;
        gs.camera.position.y += 0.5;
      }

      // 挖掘/放置：crosshair tracks the camera ray — in third person origin must be
      // camera.position (not the eye) with reach extended by the back-offset
      const dir = { x: 0, y: 0, z: 0 };
      dir.x = -Math.sin(player.yaw) * Math.cos(player.pitch);
      dir.y = Math.sin(player.pitch);
      dir.z = -Math.cos(player.yaw) * Math.cos(player.pitch);
      const rayOrigin = thirdPerson
        ? { x: gs.camera.position.x, y: gs.camera.position.y, z: gs.camera.position.z }
        : eye;
      // reach depends on mode (Task 5): creative 5, survival 4.5 (+ camera back-offset)
      const reach = reachFor(currentMode) + (thirdPerson ? back : 0);
      const hit = raycast(world, rayOrigin, dir, reach);
      // Melee reach (plan: "ray hits mob within 3.5 blocks") is its own constant —
      // the block reach above still governs dig/place. The third-person camera
      // back-offset is added with the same offset logic as block reach, so the
      // effective reach from the eye stays 3.5 in both views.
      const meleeReach = MELEE_REACH + (thirdPerson ? back : 0);

      // ---- 攻擊優先於挖掘（Task 9）：LMB 按住先測 mob，命中則本幀不挖 ----
      // Same origin/dir as the block raycast above, but the 3.5-block melee
      // reach; works in BOTH modes (mobs exist regardless of mode once spawned).
      // The 0.6 s cooldown paces repeat hits and — while it runs — keeps a mob
      // under the crosshair from being dug through to the block behind it
      // (attackMob/hitMobId are pure; kill removal + mobs-changed follow the
      // Task 8 filter pattern).
      attackCd = Math.max(0, attackCd - dt);
      let attacking = false;
      if (input.state.dig) {
        if (attackCd > 0) {
          attacking = hitMobId(mobs, rayOrigin, dir, meleeReach) !== null; // query only, no damage
        } else {
          const heldStack = hotbar[selected];
          const atk = attackMob(
            mobs,
            rayOrigin,
            dir,
            meleeReach,
            toolDamage(heldStack?.item ?? null),
            dir, // knockback along the look direction (damageMob normalizes XZ)
          );
          if (atk.hitId !== null) {
            attacking = true;
            mobs = atk.mobs;
            attackCd = ATTACK_COOLDOWN_SEC;
            mobRenderer.flashMob(atk.hitId); // 0.1 s white hit flash
            const beforeKill = mobs.length;
            mobs = mobs.filter((m) => !isDead(m)); // killed mob vanishes at once (no loot)
            if (mobs.length !== beforeKill) bus.emit('mobs-changed', { count: mobs.length });
          }
        }
      }

      if (hit && input.state.dig && !attacking) {
        const id = world.getBlock(hit.x, hit.y, hit.z);
        // digStep owns the mode branch (creative ignores `speed` → instant break;
        // survival is timed × toolSpeed) — no mode check needed here (review #4)
        const speed = toolSpeed(id, hotbar[selected]);
        if (digStep(currentMode, dig, id, hit, dt, speed)) {
          world.setBlock(hit.x, hit.y, hit.z, BLOCK.AIR);
          // Task 7: the broken block becomes a world drop (survival only; creative
          // spawns nothing). Inventory no longer changes here — pickups do that.
          const spawned = spawnBlockDrop(drops, currentMode, id, {
            x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5, // block centre
          });
          if (spawned.length !== drops.length) bus.emit('drops-changed', {});
          drops = spawned;
          dig.reset(); // post-break bookkeeping — clears survival progress after isDone
        }
      } else {
        dig.reset();
      }

      // consume even on miss so a right-click into air can't fire later (aim-then-place bug)
      const wantPlace = input.consumePlace();
      if (hit && wantPlace) {
        // Task 11: interacting with a crafting table ALWAYS opens the 3×3 UI
        // (settled — never place a block onto the table itself, even while
        // holding one). creative: crafting hidden (plan 12.4) → the gate fails
        // and the click falls through to the normal place path (place AGAINST
        // the table when holding a block, otherwise nothing).
        if (
          currentMode === 'survival' &&
          world.getBlock(hit.x, hit.y, hit.z) === BLOCK.CRAFTING_TABLE
        ) {
          setState('crafting');
          document.exitPointerLock?.(); // same order as the inventory open below
        } else {
          const t = placeTarget(hit);
          const held = hotbar[selected];
          const placeId = held ? blockFromItem(held.item) : null;
          if (placeId !== null && canPlaceAt(world, t.x, t.y, t.z, player.position)) {
            world.setBlock(t.x, t.y, t.z, placeId); // placeId is BlockId | null, guarded above
          }
        }
      }

      // UI 脈衝
      if (input.consumeToggleDebug()) showDebug = !showDebug;
      if (input.consumeToggleView()) thirdPerson = !thirdPerson;
      if (input.consumeToggleInventory()) {
        setState('inventory');
        document.exitPointerLock?.();
      }

      const inSlot = input.state.slot;
      if (inSlot !== selected) {
        selected = inSlot;
        hud.setSelected(selected);
        const held = hotbar[selected];
        hud.showItemName(held ? stackName(held.item) : null);
        clearTimeout(itemNameTimer);
        itemNameTimer = setTimeout(() => hud.showItemName(null), 1200);
      }

      if (showDebug) {
        const p = player.position;
        hud.setDebug([
          `WeCraft (dev)  ${fps} fps`,
          `XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`,
          `Block: ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}`,
          `Chunks: ${world.chunks.size}`,
          `Seed: ${settings.seed}`,
          `Mode: ${currentMode}${player.flying ? ' (flying)' : ''}`,
        ]);
      } else {
        hud.setDebug(null);
      }

      refreshQueues();
      processQueues();
    }
  } else if (state === 'title') {
    hud.setDebug(null);
    // 標題畫面：慢速環繞出生點（y=96 / lookAt 82 per Task 11 deviation — plan's 75 sits inside terrain）
    const t = now / 1000;
    gs.camera.position.set(0.5 + Math.cos(t * 0.1) * 24, 96, 0.5 + Math.sin(t * 0.1) * 24);
    gs.camera.lookAt(0.5, 82, 0.5);
    refreshQueues();
    processQueues();
  } else {
    // paused | inventory | crafting | dead: keep the frozen world view (plan's single
    // else ran the orbit here too — that would yank the camera on pause).
    // 'dead' renders the world behind the death-screen overlay (Task 10).
    hud.setDebug(null);
  }

  dropRenderer.syncDrops(drops); // reconcile sprites every frame (cheap <50)
  mobRenderer.syncMobs(mobs, state === 'playing' ? dt : 0); // frozen off-play (no walk cycle)
  mobRenderer.syncArrows(arrows);
  gs.renderer.render(gs.scene, gs.camera);
});
