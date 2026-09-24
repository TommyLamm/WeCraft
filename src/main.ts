import './style.css';
import { createGameScene, createDropRenderer } from './render/scene';
import { ChunkRenderer } from './render/chunk-renderer';
import { drawAtlas } from './render/textures';
import { World, chunkKey } from './world/world';
import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT } from './world/chunk';
import { TerrainWorkerClient } from './world/worker-client';
import { raycast, reachFor } from './world/raycast';
import { BLOCK, HOTBAR_DEFAULT } from './world/blocks';
import { blockFromItem, stackFromBlock, stackName } from './core/items';
import { createInventoryModel, type GameMode } from './core/inventory';
import { createBus, type GameEvents } from './core/bus';
import { createPlayer, stepPlayer, EYE_HEIGHT, type PlayerState } from './player/physics';
import { createInput } from './player/input';
import { createVitals, type Vitals } from './player/survival';
import { DigProgress, placeTarget, canPlaceAt, spawnBlockDrop, toolSpeed, digStep } from './player/interact';
import { stepDrops, pickable, pickup, type DropEntity } from './world/drops';
import { createHud } from './ui/hud';
import { itemIcon } from './ui/icons';
import { renderVitals } from './ui/survival-hud';
import { createMenus } from './ui/menus';
import { createInventory } from './ui/inventory';
import { loadSettings, saveSettings } from './core/settings';
import { createClock, tickClock, phaseOf, sunDirection, skyColors, type Clock } from './core/daynight';
import { generateChunk, surfaceHeight } from './world/terrain';

type GameState = 'title' | 'playing' | 'paused' | 'inventory';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;
const gs = createGameScene(canvas);
const settings = loadSettings();
const world = new World();
const chunkRenderer = new ChunkRenderer(gs.scene, drawAtlas());
// Task 7: drop sprites — icon factory injected here (render/ never imports ui/)
const dropRenderer = createDropRenderer(gs.scene, itemIcon);
const terrain = new TerrainWorkerClient(settings.seed);
const input = createInput(canvas, settings);
const hud = createHud(uiRoot);
const menus = createMenus(uiRoot);
const inv = createInventory(uiRoot);

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

// ---- 物品掉落（Task 7）----
// Pure entities stepped each frame while playing; survival breaks spawn them
// (spawnBlockDrop), proximity picks them up (pickable + pickup).
let drops: DropEntity[] = [];

// ---- 晝夜循環（Task 6）----
// Clock only advances while playing; sky/light refresh every frame (cheap math),
// `time-changed` emits ONLY on a day↔night flip (HUD/mobs consume it later).
let clock: Clock = createClock(settings.dayLengthSec);

// ---- 生存 HUD（Task 4）----
// .vitals 容器：same programmatic markup pattern as hud/menus/inventory
const vitalsEl = document.createElement('div');
vitalsEl.className = 'vitals';
uiRoot.appendChild(vitalsEl);

/** Current vitals — null while in creative mode (the whole `.vitals` bar hides).
 *  Boot mode comes from settings; the mode-changed handler (Task 5) and damage
 *  sources (Task 9) update it later through `setVitals`. */
let vitals: Vitals | null = inventory.mode === 'survival' ? createVitals() : null;

/** Single update path: store vitals, repaint the HUD, hide the bar when null. */
function setVitals(next: Vitals | null): void {
  vitals = next;
  renderVitals(vitalsEl, next);
  vitalsEl.style.display = next ? '' : 'none';
}

setVitals(vitals); // initial paint (shown when booting into survival, hidden in creative)

// No producer yet (Task 9) — this is the single vitals-changed → HUD path.
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
  if (next === 'title') {
    menus.showTitle(startGame);
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
      onQuit: () => {
        resetPlayerToSpawn();
        setState('title');
      },
      // mode toggle (Task 5): emit only — the mode-changed handler above owns
      // persistence + application (Decision A — menus stays bus-free); menus
      // re-renders its label from settings after this callback returns
      onToggleMode: () => {
        const next: GameMode = currentMode === 'survival' ? 'creative' : 'survival';
        bus.emit('mode-changed', { mode: next });
      },
    });
  } else if (next === 'inventory') {
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
    );
  }
}

function resetPlayerToSpawn(): void {
  const sp = spawnPoint();
  player = createPlayer(sp.x, sp.y, sp.z);
}

function startGame(): void {
  resetPlayerToSpawn();
  setState('playing');
  relockCanvas();
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
setState('title');

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

    // 移動
    stepPlayer(player, input.state, world, dt);

    // ---- 物品掉落（Task 7）：physics → proximity pickup ----
    const dropsBefore = drops.length;
    drops = stepDrops(drops, dt, (x, y, z) => world.isSolid(x, y, z)); // water ≠ solid → falls through
    if (drops.length !== dropsBefore) bus.emit('drops-changed', {}); // a drop despawned (300 s)
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
    const hit = raycast(world, rayOrigin, dir, reachFor(currentMode) + (thirdPerson ? back : 0));

    if (hit && input.state.dig) {
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
      const t = placeTarget(hit);
      const held = hotbar[selected];
      const placeId = held ? blockFromItem(held.item) : null;
      if (placeId !== null && canPlaceAt(world, t.x, t.y, t.z, player.position)) {
        world.setBlock(t.x, t.y, t.z, placeId); // placeId is BlockId | null, guarded above
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
  } else if (state === 'title') {
    hud.setDebug(null);
    // 標題畫面：慢速環繞出生點（y=96 / lookAt 82 per Task 11 deviation — plan's 75 sits inside terrain）
    const t = now / 1000;
    gs.camera.position.set(0.5 + Math.cos(t * 0.1) * 24, 96, 0.5 + Math.sin(t * 0.1) * 24);
    gs.camera.lookAt(0.5, 82, 0.5);
    refreshQueues();
    processQueues();
  } else {
    // paused | inventory: keep the frozen world view behind the overlay (plan's
    // single else ran the orbit here too — that would yank the camera on pause)
    hud.setDebug(null);
  }

  dropRenderer.syncDrops(drops); // reconcile sprites every frame (cheap <50)
  gs.renderer.render(gs.scene, gs.camera);
});
