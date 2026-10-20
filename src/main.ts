import './style.css';
import { createGameScene, createDropRenderer, createMobRenderer } from './render/scene';
import { ChunkRenderer } from './render/chunk-renderer';
import { createCrackOverlay } from './render/crack';
import { createParticleRenderer } from './render/particles';
import { createSky } from './render/sky';
import { createClouds } from './render/clouds';
import { createViewmodel } from './render/viewmodel';
import { World, chunkKey } from './world/world';
import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT } from './world/chunk';
import { TerrainWorkerClient } from './world/worker-client';
import { raycast, reachFor, type RayHit } from './world/raycast';
import { BLOCK } from './world/blocks';
import { emptyFurnace, stepFurnace, SMELT_RECIPES, FUEL_VALUES, type FurnaceState } from './world/furnace';
import { blockFromItem, stackName, maxStack, sanitizeSlots, starterSlots, type ItemId, type ItemStack } from './core/items';
// Ruling I/J: the pure boot entry decision (which session 繼續遊戲 enters).
import { titleEntry } from './core/boot-entry';
import { emptyGrid } from './core/recipes';
import { createInventoryModel, type GameMode } from './core/inventory';
import { createModeStash, normalizeModeStash, saveModeState, loadModeSlots } from './core/mode-stash';
import { createBus, type GameEvents } from './core/bus';
import { createPlayer, stepPlayer, EYE_HEIGHT, type MoveInput, type PlayerState } from './player/physics';
import { createInput } from './player/input';
// B2.1 疾跑狀態機：規則本體（取消條件／飢餓門檻／鎖存）在 player/sprint.ts，
// main 只餵每幀上下文並取用 `sprintState.active`。
import { createSprintState, updateSprint, type SprintState } from './player/sprint';
// B2.1 疾跑 FOV：core/fov.ts 只算數值（目標值＋指數平滑），相機的套用與
// `updateProjectionMatrix()` 由 main 負責（見主迴圈相機區）。
import { BASE_FOV, sprintFov, stepFov } from './core/fov';
import {
  createVitals,
  damage,
  eat,
  exhaust,
  tickVitals,
  isDead as isPlayerDead,
  fallDamage,
  EXHAUST_SPRINT_PER_METER,
  EXHAUST_JUMP,
  EXHAUST_SPRINT_JUMP,
  EXHAUST_BREAK_BLOCK,
  EXHAUST_ATTACK,
  EXHAUST_HURT,
  type Vitals,
} from './player/survival';
// Task 9: 0.5 s post-hit invulnerability for MOB damage (pure window state)
import { createInvuln, canBeHurt, markHurt } from './player/invuln';
import { updateFall, resetFall, type FallState } from './player/fallstate';
import {
  DigProgress,
  placeTarget,
  canPlaceAt,
  spawnBlockDrop,
  digStep,
  getBreakTime,
  toolDamage,
  hitMobId,
  attackMob,
} from './player/interact';
// Task 8: apple eating — pure slot consumption; vitals/sound/toast stay in main
import { APPLE_FOOD, APPLE_SAT, eatFromSlot } from './player/eat';
// B2.2／B2.5：按住連放／連丟的節拍（純邏輯，不碰 DOM／Three、不自持時鐘）。
// **本模組只負責「按住之後的重複」**：第一次觸發（第一次右鍵／第一次按 Q）由
// main 的完整使用流程與 Q 脈衝負責 —— 節拍層自己不會觸發第一次動作。
import {
  createRepeatState,
  stepRepeat,
  PLACE_REPEAT_SEC,
  DROP_REPEAT_SEC,
  type RepeatState,
} from './player/hold-repeat';
import { stepDrops, pickable, pickup, spawnDrop, PLAYER_DROP_PICKUP_DELAY, type DropEntity } from './world/drops';
import { spawnBreakBurst, spawnDigChip, stepParticles, type Particle } from './world/particles';
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
import { createHud, formatDebugLines } from './ui/hud';
import { itemIcon } from './ui/icons';
import { renderVitals } from './ui/survival-hud';
import { createMenus } from './ui/menus';
import { createDeathScreen, deathMessageFor, type DamageSource } from './ui/death';
import { createInventory } from './ui/inventory';
import { createCrafting, type CraftingParams } from './ui/crafting';
import { createFurnace } from './ui/furnace';
import { createToasts } from './ui/toast';
import { createHurtFlash } from './ui/hurt';
import { loadSettings, saveSettings } from './core/settings';
import { createClock, tickClock, phaseOf, sunDirection, skyColors, type Clock } from './core/daynight';
import { applyBiomeTint } from './core/biome-fog';
import { generateChunk, surfaceHeight, biomeAt } from './world/terrain';
// Phase 3 Task 10: audio facade + pure helpers — all wiring lives here in main
// (composition root); the engine is gesture-gated and inert until ensureStarted.
import { createGameAudio, footstepInterval, materialGroup } from './audio';
// Task 14: save/continue — payload assembly is pure (save.ts), all call sites
// here are thin (composition-root convention).
import { collectSavePayload, loadGame, saveGame, type SavePayload } from './world/save';
// Phase 4 Task 4: cloud save — pure data rules (cloud-save.ts) + the visitor-safe
// platform client (platform/playroom.ts); all state/load/checkpoint wiring below
// lives here at the composition root.
import { createCloudClient, type CloudStatus } from './platform/playroom';
import {
  acceptCloudData,
  buildCloudData,
  byteSizeOf,
  shouldAllowSave,
  classifyCloudError,
  CLOUD_FORMAT_VERSION,
  CLOUD_MAX_BYTES,
  type CloudData,
  type CloudErrorKind,
} from './core/cloud-save';
// Task 11–12: progress core (pure rules/state) + the unlock-event/toast wiring
// below — `applyAdvancement` is the single feed point for every unlock event.
import {
  emptyAdvancements,
  checkAdvancements,
  ADVANCEMENTS,
  type AdvancementEvent,
} from './core/advancements';

// ---- B2.1 唯讀 debug hook（Task 9 接線）----
// 用途：Task 13 的 Playwright 驗收需要在真實瀏覽器裡讀取「即時狀態」
// （疾跑／FOV／飢餓／座標／熱鍵欄／掉落物／已改動方塊數）。
// **唯讀**：每個欄位都是 getter，只回傳快照，不改變任何遊戲行為；內容全部是
// 本機遊戲資料，沒有敏感資訊。Task 11 會再補 `viewMode` 欄位。
interface WecraftDebug {
  /** 本幀是否處於疾跑（= `sprintState.active`，也就是真正餵給物理層的旗標）。 */
  sprint: () => boolean;
  /** 相機目前的垂直 FOV（度）。 */
  fov: () => number;
  /** 當前飢餓值；創造模式為 `null`（沒有飢餓條）。 */
  hunger: () => number | null;
  /** 玩家腳底中心的座標。 */
  pos: () => { x: number; y: number; z: number };
  /** 熱鍵欄九格的（物品、數量）快照；空格為 `null`。 */
  hotbar: () => Array<{ item: ItemId; count: number } | null>;
  /** 地面上尚未被拾取的掉落物數量。 */
  drops: () => number;
  /** 世界中被玩家改動過的方塊數。 */
  modified: () => number;
}

declare global {
  interface Window {
    /** B2.1 驗收用唯讀 hook（見上方 `WecraftDebug`）；尚未掛載時為 undefined。 */
    __wecraft?: WecraftDebug;
  }
}

// 'dead' (Task 9): frozen world; Task 10 mounts the death screen + respawn flow
// 'crafting' (Task 11): the 3×3 crafting-table overlay (same frozen-world
// handling as 'inventory' — the frame loop's final else keeps it static)
// 'furnace' (Task 6): the furnace panel overlay (same frozen-world handling)
type GameState = 'title' | 'playing' | 'paused' | 'inventory' | 'crafting' | 'furnace' | 'dead';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;
const gs = createGameScene(canvas);
const settings = loadSettings();
const world = new World();
const chunkRenderer = new ChunkRenderer(gs.scene); // Task 4: shared texture array
// Task 7: drop sprites — icon factory injected here (render/ never imports ui/)
const dropRenderer = createDropRenderer(gs.scene, itemIcon);
// Task 8: mobs + arrows — blocky humanoids and oriented boxes
const mobRenderer = createMobRenderer(gs.scene);
// Task 4: break/dig debris — billboard quads over the shared block texture array
const particleRenderer = createParticleRenderer(gs.scene);
// Task 3: mining crack overlay — one quad + 10 stage textures, driven per
// frame from the dig loop (hidden while not playing)
const crackOverlay = createCrackOverlay(gs.scene);
// Phase 3 Task 6: sky dome gradient + sun/moon quads; main feeds it the raw
// skyColors (zenith + horizon) and the sun direction every playing frame
const sky = createSky(gs.scene);
// Phase 3 Task 7: blocky volumetric cloud layer — one instanced 512×512 tile,
// re-anchored to the camera in whole periods every frame (render/clouds.ts)
const clouds = createClouds(gs.scene, settings.seed);
// Phase 3 Task 8: first-person held item — camera-attached block cube / icon
// plane; the icon factory is injected (render/ never imports ui/)
const viewmodel = createViewmodel(gs.scene, gs.camera, itemIcon);
let terrain = new TerrainWorkerClient(settings.seed);
/** Generation epoch for the async chunk fill (Phase 4 Task 4): a cloud-seed
 *  switch rebuilds `terrain` + the world while fills from the old client may
 *  still be in flight — the response handler drops fills from a past epoch so
 *  stale-seed chunks can never stick (generated-keyed, never regenerated). */
let terrainEpoch = 0;
const input = createInput(canvas, settings);
const hud = createHud(uiRoot);
const menus = createMenus(uiRoot);
const inv = createInventory(uiRoot);
// Task 11: standalone 3×3 crafting overlay (right-click on a crafting table)
const craftUi = createCrafting(uiRoot);
// Task 6: furnace overlay (right-click on a placed furnace) — callbacks only
// (Decision A: ui never imports the bus).
const furnaceUi = createFurnace(uiRoot, {
  onTakeOutput: takeFurnaceOutput,
  onSlotClick: clickFurnaceSlot,
  onClose: () => {
    setState('playing');
    relockCanvas();
  },
});
// Task 10: death overlay — callbacks only (Decision A: ui never imports the bus)
const deathScreen = createDeathScreen(uiRoot);
// Task 12: advancement toasts — top-right stack; main pushes via applyAdvancement
const toasts = createToasts(uiRoot);
// Task 9: red hurt vignette — flashed by applyMobEvent on every landed hit
const hurtFlash = createHurtFlash(uiRoot);
// Phase 3 Task 10: audio facade — constructing it is inert (the AudioContext is
// built lazily on the first gesture); every game sound below routes through it.
const audio = createGameAudio();
// Phase 3 Task 10: first canvas press arms the engine (autoplay policy). The
// title/pause buttons live in ui-root — startGame/continueGame arm the engine
// from their own click gestures instead (see the session entry/exit below).
canvas.addEventListener('pointerdown', () => audio.ensureStarted(), { once: true });

// ---- 遊戲事件匯流排 ----
// `GameEvents` payload-map type lives in core/bus.ts next to the GameEvent union
// (Task 5 decision A: pure type, no DOM/Three). The INSTANCE stays here at the
// composition root — ui modules never import the bus; they take callbacks instead.
const bus = createBus<GameEvents>();

let state: GameState = 'title';
let player: PlayerState = createPlayer(0.5, 90, 0.5);
// B1.3: per-mode hotbar + survival vitals, carried across mode switches — the
// mode-changed handler below saves the OUTGOING mode's live state here, then
// loads the INCOMING mode's. Re-created on every New Game (startGame).
let modeStash = createModeStash();
// Current game mode (Task 5): mirrors settings.mode at boot and follows the
// pause-menu toggle via the mode-changed event below.
let currentMode: GameMode = settings.mode;
// Flight is creative-only (spec §95): gate the double-tap Space toggle at the
// input layer — synced at every `currentMode` assignment below.
input.setFlyEnabled(currentMode === 'creative');
// Stack-based model owns the hotbar slots; `hotbar` is the live reference the
// HUD/palette render. Mode comes from settings (default survival since Task 5);
// creative add/remove no-op inside the model. starterSlots: survival starts
// EMPTY — a full hotbar leaves fits() zero slack, so no drop could be picked
// up and no craft result taken (Task 17.5 Critical).
const inventory = createInventoryModel(starterSlots(settings.mode), settings.mode);
const hotbar = inventory.slots;
let selected = 0;
let showDebug = false;
let thirdPerson = false;
let itemNameTimer: ReturnType<typeof setTimeout> | undefined;
const dig = new DigProgress();

// ---- B2.1 疾跑狀態（Task 9 接線）----
// 規則本體在 player/sprint.ts（純邏輯，不碰 DOM／Three）；這裡只持有「本幀的
// 狀態」並在每幀餵上下文。
// **有效疾跑一律看 `sprintState.active`**：`input.state.sprint` 的語意是
// 「Ctrl 是否按住」（Task 2 未改它，Q keydown 的整疊丟棄也取樣自它）——兩者
// 不可混用，**絕不**把 `state.sprint` 改寫成疾跑結果（否則普通 Q 會變成
// 整疊丟棄）。
let sprintState: SprintState = createSprintState();
// 上一幀 `stepPlayer` 回報的撞牆夾角（度）→ 下一幀餵給狀態機（8° 門檻）。
let lastWallAngleDeg: number | null = null;
// 「上一幀攻擊命中」的一次性旗標：攻擊分支設 true，狀態機讀取後立即清掉
// （攻擊命中取消疾跑，且取消後不會自己恢復）。
let attackedThisFrame = false;
// 相機 FOV 的平滑值（core/fov.ts 的 `stepFov` 產出）→ 相機實際套用的值。
let fovCurrent = BASE_FOV;

// ---- B2.2／B2.5 按住節拍狀態（Task 10 接線）----
// `placeRepeat`／`dropRepeat` 是「按住旗標 × 時間」的累積器（player/hold-repeat.ts，
// 純邏輯）：**只負責按住之後的重複**——第一次觸發分別由既有的完整使用流程
// （第一次右鍵）與 Q 脈衝（input.consumeDrop()）負責，節拍層自己不會觸發第一次
// 動作。放開旗標 → 累積器歸零（下次要重新計時）。
let placeRepeat: RepeatState = createRepeatState();
let dropRepeat: RepeatState = createRepeatState();

/** B2.1：把相機 FOV 拉回基準值（70）——平滑值與相機值一起歸零。
 *
 *  為什麼需要「硬重置」而不是靠下一幀的平滑：FOV 只在 `state === 'playing'`
 *  的分支裡套用（主迴圈相機區），離開 playing（暫停選單／背包等覆蓋層／
 *  死亡／標題）時那個分支根本不跑 → 平滑值不會收斂，凍結的世界會停在
 *  ≈77° 的疾跑視野。凡是「離開 playing」或「切換模式」的路徑都要呼叫它。 */
function resetCameraFov(): void {
  fovCurrent = BASE_FOV;
  gs.camera.fov = BASE_FOV;
  gs.camera.updateProjectionMatrix();
}

/** B2.1：疾跑狀態與 FOV 一起歸零（新局／讀檔／模式切換／死亡／回到標題）。
 *
 *  - 疾跑狀態歸零 → 不會有跨局／跨模式的「雙擊 W 鎖存」殘留。
 *  - FOV 硬回到 `BASE_FOV`（70）→ 不帶著上一個情境的疾跑視野進新局／讀檔，
 *    也不讓模式切換（只能從暫停選單觸發）時的凍結世界停在 ≈77°。 */
function resetSprintAndFov(): void {
  sprintState = createSprintState();
  resetCameraFov();
}

// ---- Crafting state (Task 11) ----
// The grid is owned here (not by the UI) so items staged in it survive between
// opens of the same size. `craftExcess` parks leftovers that didn't fit a full
// inventory — retried on the next reset, so items are never destroyed.
let craftGrid: Array<ItemStack | null> = [];
let craftExcess: ItemStack[] = [];

// ---- Progress state (Task 11–12) ----
// Advancement progress: fresh on New Game, restored on Continue, snapshotted
// into every save. The unlock events (obtain/mob-killed/phase) all route
// through `applyAdvancement` below; this section owns the state lifecycle.
let advancements = emptyAdvancements();

/** THE single feed point for unlock events (Task 12 brief 12.3): the rules stay
 *  pure in core/advancements — this wrapper owns the state swap and the
 *  ADVANCEMENTS → toast lookup. Creative suppression lives inside
 *  checkAdvancements, so callers just pass the current mode. */
function applyAdvancement(ev: AdvancementEvent): void {
  const r = checkAdvancements(advancements, ev);
  advancements = r.state;
  for (const id of r.unlocked) {
    const def = ADVANCEMENTS.find((a) => a.id === id);
    if (def) toasts.push({ title: def.title, description: def.description, icon: def.icon });
  }
  // Phase 4 Task 4 checkpoint (a): an unlock snapshots live progress to the
  // cloud slot — fire-and-forget alongside (never blocking); saveCloudNow is
  // total, so this cannot throw into the gameplay paths above.
  if (r.unlocked.length > 0) void saveCloudNow('advancement');
}

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
      // Task 12: a successful craft take is an obtain event (creative never
      // reaches this path, and checkAdvancements would suppress it anyway).
      applyAdvancement({ type: 'obtain', item: result.item, mode: currentMode });
      return true;
    },
  };
}

// ---- Furnace state (Task 6) ----
// Every placed furnace smelts on its own state, keyed by block coords
// (`x,y,z`). Entries are created lazily on first open — a furnace is only
// loadable through its panel, so an unopened furnace is always empty.
const furnaces = new Map<string, FurnaceState>();
let openFurnaceKey: string | null = null;

const furnaceKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** Take the whole output stack into the inventory (blocked when full). */
function takeFurnaceOutput(): void {
  if (!openFurnaceKey) return;
  const st = furnaces.get(openFurnaceKey);
  const out = st?.output;
  if (!st || !out || !Number.isFinite(out.count) || out.count < 1) return;
  if (!inventory.fits(out.item, out.count)) return; // full → blocked
  giveItem(out.item, out.count);
  const next: FurnaceState = { ...st, output: null };
  furnaces.set(openFurnaceKey, next);
  hud.setHotbar(hotbar, selected);
  applyAdvancement({ type: 'smelt-take', mode: currentMode });
  furnaceUi.open(next);
}

/** Input/fuel slot click — crafting-cell semantics, moved by main (the UI only
 *  notifies): filled → 1 returns to the inventory; empty → 1 moves in from the
 *  selected hotbar slot when it holds an accepted item (smeltable/burnable). */
function clickFurnaceSlot(which: 'input' | 'fuel'): void {
  if (!openFurnaceKey) return;
  const st = furnaces.get(openFurnaceKey);
  if (!st) return;
  const stack = which === 'input' ? st.input : st.fuel;
  let next: FurnaceState | null = null;
  if (stack && Number.isFinite(stack.count) && stack.count >= 1) {
    if (giveItem(stack.item, 1) > 0) return; // inventory full → stays put
    const rest = stack.count > 1 ? { item: stack.item, count: stack.count - 1 } : null;
    next = which === 'input' ? { ...st, input: rest } : { ...st, fuel: rest };
  } else {
    const src = hotbar[selected];
    if (!src || !Number.isFinite(src.count) || src.count < 1) return;
    const accepted = which === 'input'
      ? src.item in SMELT_RECIPES
      : src.item in FUEL_VALUES;
    if (!accepted) return;
    if (!inventory.spendFromSlot(selected, 1)) return;
    const moved = { item: src.item, count: 1 };
    next = which === 'input' ? { ...st, input: moved } : { ...st, fuel: moved };
  }
  furnaces.set(openFurnaceKey, next);
  hud.setHotbar(hotbar, selected);
  furnaceUi.open(next);
}

/** Right-click on a placed furnace → standalone panel (both modes). */
function openFurnaceAt(x: number, y: number, z: number): void {
  openFurnaceKey = furnaceKey(x, y, z);
  if (!furnaces.has(openFurnaceKey)) furnaces.set(openFurnaceKey, emptyFurnace());
  setState('furnace');
  document.exitPointerLock?.();
}

/** Wipe in-progress smelting on load/continue/respawn/new-game (Task 6):
 *  furnace states are session-only and never persisted. Toasts 熔爐進度已重置
 *  only when a cleared furnace actually held items. */
function clearFurnaces(): void {
  let held = false;
  for (const st of furnaces.values()) {
    if (st.input || st.fuel || st.output) {
      held = true;
      break;
    }
  }
  furnaces.clear();
  if (held) {
    try {
      toasts.push({ title: '熔爐進度已重置', description: '', icon: 'furnace' });
    } catch {
      /* passive UI only */
    }
  }
}

// ---- Combat / vitals tuning (Task 9) ----
// Repeat hits on a held LMB are gated by a 0.6 s cooldown — without it the
// per-frame attack dispatch would deal ~60 hits/s; while the cooldown runs a
// mob under the crosshair also blocks digging (attack takes precedence).
const ATTACK_COOLDOWN_SEC = 0.6;
/** Melee reach in blocks (plan: "ray hits mob within 3.5 blocks") — separate
 *  from the block reach (`reachFor`, 4.5/5) which still governs dig/place. */
const MELEE_REACH = 3.5;
// Exhaustion costs live in survival.ts (vanilla 1.20 `EXHAUST_*` table):
// sprint 0.1 per metre moved, jump 0.05 (0.2 when launched sprinting);
// plain walking costs nothing.
/** Per-frame melee cooldown timer toward ATTACK_COOLDOWN_SEC. */
let attackCd = 0;
/** Cause of the current life's death (Task 13): set whenever survival damage
 *  lands (fall → 'fall', melee → the live mob's kind by mobId / 'unknown',
 *  arrows → 'skeleton', starvation ticks → 'starve' — last write wins) and
 *  read once at the `setState('dead')` transition via
 *  `deathMessageFor(deathCause)`. Reset to null on every fresh spawn
 *  (`resetPlayerToSpawn`, which startGame/respawn/quit flow through) and on
 *  Continue (which builds its own player without that helper). */
let deathCause: DamageSource | null = null;
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

// ---- B2.2／B2.5 放置與丟棄（Task 10 接線）----
// 兩個 helper 放在模組層（不是迴圈內）：每幀重建函式物件沒有好處，而且它們
// 需要讀 `drops`／`hotbar`／`selected` 等模組層狀態。
/** 在 `target` 命中的那一面放一個方塊 —— 「放置」這一件事的完整實作。
 *
 *  **為什麼要抽出來**：B2.2 的連放要求「第一次右鍵照完整流程（開工作台／開熔爐／
 *  吃東西／放方塊），之後每 0.2 秒**只重複放方塊**」。把放置抽成獨立函式，
 *  首次使用路徑與連放路徑共用同一份實作 → 不會兩邊走樣（音效語意、扣物品的
 *  順序、與玩家重疊的判定都只有一份）。
 *
 *  回傳是否真的放下去（false ＝ 手上沒有方塊／位置不能放／扣不到物品）。 */
function tryPlaceBlock(target: RayHit): boolean {
  const t = placeTarget(target);
  const held = hotbar[selected];
  const placeId = held ? blockFromItem(held.item) : null;
  if (placeId === null || !canPlaceAt(world, t.x, t.y, t.z, player.position)) return false;
  // no pay, no place: the stack is spent FIRST (creative's spendFromSlot is a
  // free `true`), so a rejected spend never writes the world — unreachable in
  // practice, structural defense
  if (!inventory.spendFromSlot(selected, 1)) return false;
  world.setBlock(t.x, t.y, t.z, placeId); // placeId is BlockId | null, guarded above
  hud.setHotbar(hotbar, selected);
  // Phase 3 Task 10: material-accurate place thud at the target centre
  // (listener defaults to pos → full volume).
  audio.play('place', materialGroup(placeId), {
    pos: { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 },
  });
  return true;
}

/** B2.5：丟棄選取格（Q）。`wholeStack` ＝整疊丟棄（Ctrl+Q），否則只丟 1 個。
 *
 *  語意（minecraft.wiki/Controls，2026-10-20）：「If items are stacked, only one
 *  gets thrown/tossed/dropped.」「**Control+Q drops the whole stack of items.**」
 *  → 普通 Q 丟 1 個、Ctrl+Q 丟整疊。
 *
 *  - **創造模式不作用**（不丟、不消耗）：本批的簡化，README 記錄。
 *  - **不複製也不吞物品**：`count` 先算出來、`spendFromSlot` 先扣掉，再以同一個
 *    `count` 生成掉落物 → 熱鍵欄減掉的數量與地上出現的數量必然相等。
 *  - **玩家丟出的物品 2 秒（40 tick）內不可拾**：minecraft.wiki/Item (entity)
 *    「or 40 ticks (2 seconds) if thrown by a player」→ 傳
 *    `pickupDelay: PLAYER_DROP_PICKUP_DELAY`（方塊破壞掉落仍是 0.5 秒）。
 *  - 拋出方向＝玩家視線的水平分量（`yaw`）；距離是簡化值（原版約 2～3 格）。 */
function dropSelected(wholeStack: boolean): boolean {
  if (currentMode === 'creative') return false; // 創造模式不丟棄（簡化，README 記錄）
  const stack = hotbar[selected];
  if (!stack || stack.count < 1) return false;
  const count = wholeStack ? stack.count : 1;
  if (!inventory.spendFromSlot(selected, count)) return false;
  const fx = -Math.sin(player.yaw);
  const fz = -Math.cos(player.yaw);
  drops = spawnDrop(
    drops,
    stack.item,
    count,
    {
      x: player.position.x + fx * 0.5,
      y: player.position.y + 1.0,
      z: player.position.z + fz * 0.5,
    },
    {
      pickupDelay: PLAYER_DROP_PICKUP_DELAY,
      vel: { x: fx * 2.5, y: 1.5, z: fz * 2.5 },
    },
  );
  hud.setHotbar(hotbar, selected); // 熱鍵欄計數變了 → 刷新
  bus.emit('drops-changed', {}); // 掉落物清單變了（與其它生成路徑一致）
  return true;
}

// ---- 生物与箭矢（Task 8）----
// Pure mob AI (world/mobs.ts) stepped each frame while playing; night spawns
// them on the surface, distance despawns them, death removes them (no loot).
let mobs: Mob[] = [];
let arrows: Arrow[] = [];
let spawnAcc = 0; // seconds toward the next 5 s spawn tick

// ---- 破壞/挖掘粒子（Task 4）----
// Pure particle sim (world/particles.ts) stepped each playing frame; the
// billboard renderer (render/particles.ts) syncs every frame. digChipAcc
// paces the dig spray to one 2-particle batch per 0.1 s of dig progress.
let particles: Particle[] = [];
let digChipAcc = 0;
const DIG_CHIP_INTERVAL_SEC = 0.1;

// ---- 手持模型（Phase 3 Task 8）----
// The viewmodel follows the selected slot (cached compare) and swings on
// attack/place/break; while mining it re-triggers once per swing, so waves
// chain. `digSwingAcc` rests "due" (one full interval) so the first mining
// frame swings at once; one swing length is 0.25 s (core/viewmodel).
const MINE_SWING_INTERVAL_SEC = 0.25;
let heldViewmodelItem: ItemId | null = null;
let digSwingAcc = MINE_SWING_INTERVAL_SEC;

// ---- 音效（Phase 3 Task 10）----
// main only ROUTES events to the Task 9 facade; all voicing lives in audio/.
// `digSoundAcc` paces the dig scrape to one sound per DIG_SOUND_INTERVAL_SEC of
// real dig progress; `stepAcc` counts grounded seconds toward the next step.
let digSoundAcc = 0;
const DIG_SOUND_INTERVAL_SEC = 0.25;
let stepAcc = 0;

// ---- 晝夜循環（Task 6）----
// Clock only advances while playing; sky/light refresh every frame (cheap math),
// `time-changed` emits ONLY on a day↔night flip (HUD/mobs consume it later).
let clock: Clock = createClock(settings.dayLengthSec);

// ---- 生物群系（Phase 3 Task 6）----
// Biome under the player — drives the fog/background tint and the F3 Biome
// line. Re-sampled at most every 0.5 s (two fbm2 lookups each, memoized
// Noise): a step across a biome border recolors within half a second.
let biomeNow = biomeAt(player.position.x, player.position.z, settings.seed);
let biomeAcc = 0;
const BIOME_SAMPLE_INTERVAL_SEC = 0.5;

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
/** Last backgrounding-save timestamp (ms) + debounce — review #1: rapid
 *  hidden/visible flips must not spam IDB. */
let lastBgSave = 0;
const BG_SAVE_DEBOUNCE_MS = 2000;

// ---- 雲端進度（Phase 4 Task 4）----
// The platform client is visitor/standalone-safe (Task 3): every SDK failure
// degrades to a status, init/load/save never throw for a missing SDK —
// save() rethrows only genuine platform errors for classification below.
// `cloudRevision` is the guard from Task 2: null (never read / unreadable)
// means NO send may ever overwrite the slot; 0 is an explicitly-read empty
// slot that the first save may claim.
const cloud = createCloudClient();
let cloudRevision: number | null = null;
/** Ruling I/J: true iff the boot read succeeded AND its payload was validated
 *  and applied to the live state (set in the boot IIFE's apply branch, cleared
 *  at session start). Drives the title entry — with BOTH a local save and this
 *  flag, the cloud state wins the entry (Ruling J) via the pure titleEntry(). */
let cloudAppliedAtBoot = false;
/** FORMAT / REQUEST_REUSED lock (Ruling D: `error` covers both) — no sends. */
let cloudLocked = false;
/** AUTH stop — no sends (re-login has no path this phase; play continues). */
let cloudAuthStopped = false;
/** A conflict was reloaded-and-applied — the pause row shows 有新進度＋重試. */
let cloudConflict = false;
/** NETWORK-kind failure (or applied conflict) — the pause row offers 重試. */
let cloudRetryable = false;
/** Last save-side failure kind (null = none yet); drives the pause row. */
let cloudFailureKind: CloudErrorKind | 'CONFLICT' | null = null;
/** Frozen snapshot for sends — a retry reuses this SAME {data, requestId}. */
let pendingCloud: { data: CloudData; requestId: string } | null = null;
/** In-flight guard (Ruling: boolean/string guard, no queue) — a second
 *  trigger while one send is in flight is dropped, not queued. */
let cloudInFlight = false;
/** Seconds accumulator toward the 60 s cloud checkpoint while playing. */
let cloudAcc = 0;
const CLOUD_INTERVAL_SEC = 60;
/** Toast icon for cloud notices (toasts require an ItemId — the chest is the
 *  neutral storage metaphor; copy itself carries the meaning). */
const CLOUD_TOAST_ICON: ItemId = 'chest';

/** Best-effort cloud notice — toasts never break gameplay when they fail. */
function pushCloudToast(title: string): void {
  try {
    toasts.push({ title, description: '', icon: CLOUD_TOAST_ICON });
  } catch {
    /* passive UI only */
  }
}

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

/** Mob-hit invulnerability window (Task 9): while it is open, mob/arrow damage
 *  events are ignored entirely (no damage, no exhaustion, no flash) — with
 *  several mobs each swiping on their own cooldown that caps incoming damage at
 *  one hit per 0.5 s (a lone zombie's 1 s cooldown is already slower). Only mob
 *  damage is gated by it: fall damage and starvation keep their own cadence. */
let invuln = createInvuln();

/** Single vitals mutation path: store `next`, repaint the HUD, hide the bar
 *  when null — and (Task 9) emit `vitals-changed` whenever a HUD-visible value
 *  changed, i.e. an integer hp or hunger value moved. The exhaustion bank and
 *  the saturation it drains first (one point per completed 4 — and saturation
 *  has no HUD bar) are invisible in the HUD, and so are the regen/starve
 *  accumulators; those changes are carried silently — this is what keeps the
 *  per-frame tick from spamming the bus (~4×/s worst case, damage/regen/starve
 *  emit immediately because their hp integers move). Creative never reaches
 *  the emit (next is null). The emit re-enters the consumer below with
 *  identical integers → its visible gate stops the recursion after one hop. */
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
  // B1.3: stash the OUTGOING mode first — its hotbar and (in survival) vitals
  // survive the switch instead of being destroyed. saveModeState snapshots
  // deep copies, so later gameplay can never leak into the stash; saving runs
  // before loading, so the default stash never clobbers live state.
  modeStash = saveModeState(modeStash, currentMode, [...hotbar], vitals);
  currentMode = mode;
  input.setFlyEnabled(currentMode === 'creative'); // survival: force a landing
  // B2.1：疾跑狀態與 FOV 一起歸零 → 跨模式不殘留「雙擊 W 鎖存」（創造模式
  // 切回生存時不會莫名其妙地處於疾跑），且 FOV 立刻回到 70。**必須硬重置**：
  // 模式切換只能從暫停選單觸發（此時 state !== 'playing' → 主迴圈的 FOV
  // 平滑分支不跑），不重置的話暫停選單背後的凍結世界會停在 ≈77°。
  resetSprintAndFov();
  settings.mode = mode; // keep in-memory settings fresh (title/new-game read it)
  saveSettings({ mode }); // single persist point
  inventory.setMode(mode);
  if (mode === 'creative') {
    // creative: restore its stashed hotbar (the starter kit on first entry)
    loadModeSlots(modeStash, mode).forEach((s, i) => inventory.setSlot(i, s));
    hud.setHotbar(hotbar, selected);
    setVitals(null); // hide the bar; Task 9 owns the vitals lifecycle
  } else {
    // survival: restore its stashed hotbar + vitals — each mode keeps its own
    // inventory and vitals across round-trips (B1.3; no more fresh-vitals reset)
    loadModeSlots(modeStash, mode).forEach((s, i) => inventory.setSlot(i, s));
    hud.setHotbar(hotbar, selected);
    setVitals({ ...modeStash.survivalVitals }); // copy: the stash object must never become live vitals
  }
});

function applyRenderDistanceFog(): void {
  // Routed through the fog controller (Task 16 review fix): while submerged
  // scene.fog is the FogExp2 (no `far`), so mutating scene.fog directly would
  // silently DROP the update until the next render-distance change after
  // surfacing — setDayFogFar stores it on the day fog and applies it there.
  gs.setDayFogFar(settings.renderDistance * CHUNK_SIZE);
}
applyRenderDistanceFog();

// Phase 3 Task 5: sun shadows — boot state from settings; the pause menu's
// 陰影 toggle persists + applies live (setShadowsEnabled in its callback).
gs.setShadowsEnabled(settings.shadows);

// Phase 3 Task 7: cloud layer — boot state from settings; the pause menu's
// 雲 toggle persists + applies live (setEnabled in its callback).
clouds.setEnabled(settings.clouds);

// Phase 3 Task 10: audio boot volume — the engine remembers it pre-start, so
// the first sound after the gesture already uses the saved level (the pause
// menu re-applies it live on resume via loadSettings).
audio.setVolume(settings.volume);

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
 *  shoot spawns an Arrow entity.
 *  Task 9: a landed melee/arrow hit is gated by the 0.5 s `invuln` window — a
 *  blocked hit is a full no-op (no damage, no exhaustion, no red flash) and
 *  returns BEFORE the death cause below, so only damage that really landed can
 *  claim this life. The landed hit banks `EXHAUST_HURT` and flashes the
 *  vignette. This gate covers MOB damage only: fall damage (frame loop) and
 *  starvation (tickVitals) never consult `invuln`.
 *  Task 13: melee/arrow damage also records `deathCause` — arrows always come
 *  from skeletons, while melee looks up the live mob's kind by `mobId`
 *  (despawned/killed since → 'unknown'). Shoot events deal no damage yet, so
 *  they record nothing. */
function applyMobEvent(ev: MobEvent, fromArrow = false): void {
  if (ev.type === 'shoot') {
    arrows = spawnArrow(arrows, ev.from, ev.dir, ev.mobId);
    return;
  }
  if (!vitals) return; // creative (or dead) — nothing to hurt
  // One clock read per event feeds both halves: calling performance.now() twice
  // could straddle the window edge and mark a hit that was just allowed.
  const nowSec = performance.now() / 1000;
  if (!canBeHurt(invuln, nowSec)) return; // inside the 0.5 s window — ignore
  invuln = markHurt(invuln, nowSec);
  if (fromArrow) {
    deathCause = 'skeleton';
  } else {
    const kind = mobs.find((m) => m.id === ev.mobId)?.kind;
    deathCause = kind ?? 'unknown';
  }
  setVitals(exhaust(damage(vitals, ev.amount), EXHAUST_HURT));
  hurtFlash.flash();
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
    const epoch = terrainEpoch;
    void terrain.request(cx, cz).then((resp) => {
      genInFlight.delete(key);
      // Phase 4 Task 4: a cloud-seed switch rebuilds the worker mid-flight —
      // fills generated under a past epoch carry the OLD seed and are dropped.
      if (epoch !== terrainEpoch) return;
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
  // B2.1：離開 playing 的這一刻要把疾跑「本幀/本情境」的暫存狀態收乾淨。
  //  - `attackedThisFrame` 是「上一幀攻擊命中」的一次性旗標，只在 playing
  //    分支被消費（下一幀的狀態機讀它）→ 跨狀態殘留會讓恢復後的第一幀用
  //    一次陳舊的「攻擊」取消疾跑。（實務上 `input.clearActive()` 會清掉按鍵
  //    → `no-forward` 已先取消，但那是副作用不是契約。）
  //  - FOV 只在 playing 分支套用 → 離開時不拉回基準，暫停選單／背包等覆蓋層
  //    背後的凍結世界會停在 ≈77° 的疾跑視野。
  // （疾跑**狀態機**的重置不在這裡：各入口自己呼叫 `resetSprintAndFov()`。）
  if (state === 'playing' && next !== 'playing') {
    attackedThisFrame = false;
    resetCameraFov();
  }
  state = next;
  menus.hideAll();
  inv.close();
  craftUi.close(); // every transition clears the crafting overlay too (idempotent)
  furnaceUi.close(); // same for the furnace overlay (idempotent)
  deathScreen.hide(); // every transition clears the overlay; the 'dead' branch re-mounts it
  if (next === 'title') {
    // Task 14: Continue renders iff a save exists (savedPayload — boot load
    // or a successful in-session save); no save → hidden (settled).
    // Ruling I/J: a boot-applied CLOUD payload is also an entry (cloud wins
    // when both exist) — the decision is the pure, unit-pinned titleEntry().
    // B1.4: computed ONCE per render — `hasSave` and the 新遊戲 overwrite
    // confirm below read the same value, so they can never disagree.
    const hasSaveEntry =
      titleEntry({ hasLocalSave: savedPayload !== null, cloudApplied: cloudAppliedAtBoot }) !== 'none';
    menus.showTitle({
      hasSave: hasSaveEntry,
      onContinue: handleContinue,
      // B1.4: 新遊戲 discards the session that 繼續遊戲 offers — an entry
      // (local or boot-applied cloud) must be confirmed first. 取消 returns to
      // the title (save untouched); with no entry it stays the one-click start.
      onNewGame: () => {
        if (!hasSaveEntry) {
          startGame();
          return;
        }
        menus.showConfirm({
          message: '將覆蓋現有進度。確定要開始新遊戲嗎？',
          onConfirm: startGame,
          onCancel: () => setState('title'),
        });
      },
    });
    document.exitPointerLock?.();
  } else if (next === 'paused') {
    menus.showPause({
      onResume: () => {
        // settings edited in the pause menu persist to localStorage — live-apply on resume
        const prevRd = settings.renderDistance;
        Object.assign(settings, loadSettings());
        audio.setVolume(settings.volume); // Phase 3 Task 10: live-apply the saved volume
        if (settings.renderDistance !== prevRd) applyRenderDistanceFog();
        // menus relocks the canvas after onResume returns (click gesture)
        setState('playing');
      },
      // reset to spawn before title: title orbit queues key off player.position —
      // leaving it far away would orbit a one-chunk island (Task 17 CR fix)
      onQuit: quitToTitle, // plain 回到標題 — UNSAVED quit (Task 14 settled split)
      // Task 14 save point (a): 儲存並離開 — snapshot the live session FIRST,
      // save, then quit (both callbacks are separate buttons; the death
      // screen's quit below deliberately has neither — see handleQuitToTitle).
      onSaveQuit: () => {
        // Review #7: unmount the pause menu FIRST — a detached button cannot
        // receive user clicks, so a double-click can't fire a second save (or
        // save+resume race) while the first one is still awaiting IDB; the
        // frozen world shows until the quit lands.
        menus.hideAll();
        const payload = sessionSavePayload();
        if (!payload) {
          // Unreachable in practice (the pause menu can't open while dead —
          // review #6's guard) — quit without saving rather than strand the click.
          quitToTitle();
          return;
        }
        void saveGame(payload).then(
          () => {
            savedPayload = payload; // boot check may predate this save
            // Phase 4 Task 4 checkpoint (b): cloud snapshot after the IDB
            // success — alongside, never blocking the quit below.
            void saveCloudNow('save-quit');
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
      // sun-shadow toggle (Phase 3 Task 5): persist + apply live; menus
      // re-renders its 陰影 label from settings after this callback returns
      onToggleShadows: () => {
        const next = !loadSettings().shadows;
        settings.shadows = next; // keep in-memory settings fresh (menus re-reads localStorage)
        saveSettings({ shadows: next });
        gs.setShadowsEnabled(next);
      },
      // cloud toggle (Phase 3 Task 7): persist + apply live; menus re-renders
      // its 雲 label from settings after this callback returns
      onToggleClouds: () => {
        const next = !loadSettings().clouds;
        settings.clouds = next; // keep in-memory settings fresh (menus re-reads localStorage)
        saveSettings({ clouds: next });
        clouds.setEnabled(next);
      },
      // Phase 4 Task 4: cloud sync row — snapshot at open (re-rendered on the
      // next pause open, or after a retry completes while still paused).
      ...cloudPauseOpts(),
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
      cause: deathMessageFor(deathCause), // Task 13: null → '' → no .death-cause line
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
      // B1.2: survival lists the OWNED hotbar; creative keeps the palette.
      currentMode,
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
  } else if (next === 'furnace') {
    // Task 6: right-click on a placed furnace → standalone panel over the
    // block's live state (both modes; the entry is created on open).
    if (openFurnaceKey) {
      let st = furnaces.get(openFurnaceKey);
      if (!st) {
        st = emptyFurnace();
        furnaces.set(openFurnaceKey, st);
      }
      furnaceUi.open(st);
    }
  }
}

function resetPlayerToSpawn(): void {
  const sp = spawnPoint();
  player = createPlayer(sp.x, sp.y, sp.z);
  deathCause = null; // fresh life — the next death records its own cause (Task 13)
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
 *  the seed the world was actually generated with at save time.
 *  Returns null when there is nothing HONEST to save:
 *  - review #6: hp ≤ 0 (the death state) must never persist — autosave and
 *    the Save&Quit button can't fire while dead anyway, so this guards
 *    beforeunload/visibilitychange, which would otherwise write an hp=0
 *    record that Continue restores as a corpse; and
 *  - review #3: staged crafting items are flushed FIRST — the grid lives only
 *    in `craftGrid` and would be missing from the save otherwise. All four
 *    save triggers route through here; a repeat call is a harmless no-op
 *    (empty grid → nothing to hand back; a full inventory just re-parks the
 *    overflow, nothing is destroyed). The flush is SKIPPED while the
 *    inventory/crafting overlay is open — see the guard below. */
function sessionSavePayload(): SavePayload | null {
  // Flush staged items into the inventory before snapshotting — BUT never
  // while an overlay is open. resetCraftGrid REASSIGNS the module `craftGrid`,
  // and the open inventory/crafting UI captured the OLD array reference at
  // open time (craftingParams; the UI writes cells in place). A flush now
  // would leave the overlay holding an orphaned grid: clicking its cells would
  // hand the same item to the inventory AGAIN (dupe), and anything staged
  // afterwards would live only in the orphan (lost at the next reset).
  // Reachable because visibilitychange (alt-tab) fires with the overlay open.
  // Skip instead: staged items are simply absent from THIS save (honest) —
  // the next save after the overlay closes flushes them normally.
  if (!inv.isOpen() && !craftUi.isOpen()) resetCraftGrid(2);
  if (vitals && vitals.hp <= 0) return null; // dead — see doc above
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
    advancements,
    stash: modeStash, // B1.3: the other mode's hotbar + survival vitals
  });
}

/** Fire-and-forget save of the current session (Task 14): the payload is
 *  snapshotted synchronously (state can't drift mid-save); a success caches
 *  it for the title's Continue button, a rejection is swallowed — saving is
 *  best-effort everywhere (autosave, beforeunload — nothing can await). */
function persistNow(): void {
  const payload = sessionSavePayload(); // snapshot once — save + cache are identical
  if (!payload) return; // nothing honest to save (review #6: dead session)
  void saveGame(payload)
    .then(() => {
      savedPayload = payload;
    })
    .catch(() => {
      /* best-effort: on failure the previous savedPayload stays honest */
    });
}

/** Apply a validated cloud payload to the live session (Phase 4 Task 4 boot +
 *  conflict paths). Mirrors continueGame's order WITHOUT the world edits
 *  (modified voxels never travel — brief ruling): seed → fresh world on that
 *  seed, then player/mode/inventory/vitals/stash, advancements, settings
 *  subset (persisted + live-applied through the existing resume path) and the
 *  clock. `data` is always fresh from acceptCloudData — handing over its
 *  references is safe (later buildCloudData snapshots deep-copy again). */
function applyCloudData(data: CloudData): void {
  // Settings subset → persist + in-memory + live-apply (the pause-resume path).
  saveSettings({ seed: data.seed, ...data.settings });
  const prevRd = settings.renderDistance;
  Object.assign(settings, loadSettings());
  audio.setVolume(settings.volume);
  if (settings.renderDistance !== prevRd) applyRenderDistanceFog();
  gs.setShadowsEnabled(settings.shadows);
  clouds.setEnabled(settings.clouds);
  // Seed → fresh world generated with the cloud seed: the worker client is
  // seed-pinned at construction, so it is rebuilt — dispose() terminates the
  // old worker first (Minor 2: the rebuild used to leak it) — and the epoch
  // guard drops any fills still in flight from the old client.
  terrainEpoch += 1;
  terrain.dispose();
  terrain = new TerrainWorkerClient(settings.seed);
  resetWorld();
  resetSessionEntities(); // entities are never persisted — drop stale ones
  // Player — pos + yaw restored (no pitch/velocity: session-only, fresh).
  player = createPlayer(data.pos[0], data.pos[1], data.pos[2]);
  player.yaw = data.yaw;
  fallState = resetFall();
  attackCd = 0;
  deathCause = null;
  biomeNow = biomeAt(player.position.x, player.position.z, settings.seed);
  // Mode/inventory/vitals — DIRECT, not through the mode-changed event: that
  // handler's creative refill / fresh-vitals side effects would clobber the
  // restored slots and vitals (same reason as continueGame).
  currentMode = data.settings.mode;
  input.setFlyEnabled(currentMode === 'creative');
  inventory.setMode(currentMode);
  // The payload's inventory is untrusted even after shape validation (unknown
  // ids, junk counts, any length): sanitizeSlots pads/truncates to the live
  // hotbar width and drops junk ENTRY by entry (never the whole inventory) —
  // then setSlot floors + clamps counts to maxStack.
  const restoredSlots = sanitizeSlots(data.inventory, hotbar.length);
  for (let i = 0; i < hotbar.length; i++) inventory.setSlot(i, restoredSlots[i]);
  hud.setHotbar(hotbar, selected);
  setVitals(
    currentMode === 'survival'
      ? data.vitals
        ? { ...data.vitals }
        : createVitals()
      : null,
  );
  // B1.3: restore the per-mode stash that travelled with the payload (the
  // other mode's hotbar + survival vitals). acceptCloudData always hands one
  // over: for an old format-1 payload that carries none it derives the stash
  // UPSTREAM (cloud-save.ts) from the fields the payload did write (the
  // recorded mode's inventory + vitals) — the args below are a defensive
  // fallback only.
  modeStash = normalizeModeStash(data.stash, {
    mode: data.settings.mode,
    inventory: data.inventory,
    vitals: data.vitals,
  });
  advancements = data.advancements;
  // Clock — dayLengthSec stays settings-driven, t restored; setPhase is a
  // pre-start no-op for cues and pins the phase for the next session.
  clock = createClock(settings.dayLengthSec);
  clock.t = data.clockT;
  audio.setPhase(phaseOf(clock.t));
}

/** Checkpoint: snapshot live progress to the cloud slot (Phase 4 Task 4).
 *  Best-effort and TOTAL — every trigger `void`s this; alongside the IDB
 *  saves, never blocking them. Guards in order: unread revision (null) never
 *  uploads (a failed/unread slot must not be overwritten); FORMAT/REUSED
 *  locks and the AUTH stop end sends; a second trigger mid-flight is dropped;
 *  oversize payloads toast and return (IDB still saves via its own path). */
async function saveCloudNow(reason: string): Promise<void> {
  void reason; // checkpoint label for future diagnostics; behavior is identical
  try {
    if (!shouldAllowSave({ revision: cloudRevision })) return;
    if (cloudRevision === null || cloudLocked || cloudAuthStopped || cloudInFlight) return;
    const data = buildCloudData({
      seed: settings.seed,
      pos: [player.position.x, player.position.y, player.position.z],
      yaw: player.yaw,
      vitals: vitals ? { ...vitals } : null,
      clockT: clock.t,
      inventory: [...hotbar],
      advancements,
      settings,
      stash: modeStash,
    });
    if (byteSizeOf(data) > CLOUD_MAX_BYTES) {
      pushCloudToast('雲端空間不足，僅本機存檔');
      return;
    }
    pendingCloud = { data, requestId: crypto.randomUUID() };
    await sendPendingCloud();
  } catch {
    /* best-effort: local snapshot failures must not break gameplay (the
       cloud.save throw is classified inside sendPendingCloud, not here) */
  }
}

/** Send `pendingCloud` with its frozen requestId — a retry reuses this SAME
 *  object (brief). The thrown error is classified HERE (Ruling D): CONFLICT →
 *  reload-and-apply; FORMAT / REQUEST_REUSED → lock further sends (REUSED
 *  reuses the 同步失敗 copy, no retry button); AUTH → stop + 請重新登入;
 *  NETWORK (+ UNAVAILABLE) → keep revision and snapshot for 重試. Total. */
async function sendPendingCloud(): Promise<void> {
  if (
    !pendingCloud ||
    cloudRevision === null ||
    cloudLocked ||
    cloudAuthStopped ||
    cloudInFlight
  ) {
    return;
  }
  cloudInFlight = true;
  const snapshot = pendingCloud;
  try {
    const res = await cloud.save(
      snapshot.data,
      cloudRevision,
      CLOUD_FORMAT_VERSION,
      snapshot.requestId,
    );
    if (!res) {
      // Preview-mode null (Task 3 passthrough): no revision to record — drop
      // the snapshot without touching flags or the row.
      pendingCloud = null;
      return;
    }
    cloudRevision = res.revision;
    pendingCloud = null;
    cloudConflict = false;
    cloudRetryable = false;
    cloudFailureKind = null;
  } catch (err) {
    const kind = classifyCloudError(err);
    if (kind === 'CONFLICT') {
      await resolveCloudConflict();
    } else if (kind === 'FORMAT') {
      cloudLocked = true;
      cloudFailureKind = 'FORMAT';
      cloudRetryable = false;
      pendingCloud = null;
      pushCloudToast('雲端格式不相容，僅本機存檔');
    } else if (kind === 'REQUEST_REUSED') {
      cloudLocked = true;
      cloudFailureKind = 'REQUEST_REUSED';
      cloudRetryable = false;
      pendingCloud = null;
      pushCloudToast('雲端同步失敗，僅本機存檔');
    } else if (kind === 'AUTH') {
      cloudAuthStopped = true;
      cloudFailureKind = 'AUTH';
      cloudRetryable = false;
      pendingCloud = null;
      pushCloudToast('請重新登入');
    } else {
      // NETWORK + UNAVAILABLE: keep the revision AND the snapshot — the pause
      // row offers 重試 with the same {data, requestId}.
      cloudFailureKind = kind;
      cloudRetryable = true;
    }
  } finally {
    cloudInFlight = false;
  }
}

/** CONFLICT tail (brief 4.3): re-read the slot and apply it — the other
 *  device's progress wins; toast 雲端有新進度，已同步 and the pause row shows
 *  有新進度＋重試. An unreadable reload keeps the snapshot for a manual retry
 *  (a resend re-conflicts and reloads again — self-healing on user clicks);
 *  a format mismatch locks instead of retrying forever. Total. */
async function resolveCloudConflict(): Promise<void> {
  try {
    const fresh = await cloud.load();
    if (fresh && fresh.formatVersion !== CLOUD_FORMAT_VERSION) {
      cloudLocked = true;
      cloudFailureKind = 'FORMAT';
      cloudRetryable = false;
      pendingCloud = null;
      pushCloudToast('雲端格式不相容，僅本機存檔');
      return;
    }
    const accepted = fresh ? acceptCloudData(fresh.data) : null;
    if (!fresh || !accepted) {
      cloudFailureKind = 'NETWORK';
      cloudRetryable = true;
      return;
    }
    applyCloudData(accepted);
    cloudRevision = fresh.revision;
    pendingCloud = null;
    cloudConflict = true;
    cloudRetryable = true;
    cloudFailureKind = 'CONFLICT';
    pushCloudToast('雲端有新進度，已同步');
  } catch {
    cloudFailureKind = 'NETWORK';
    cloudRetryable = true;
  }
}

/** Load-only retry of a boot read that never landed (Minor 1; see
 *  retryCloudNow): NO apply — the live session is already in play, so a slot
 *  found now only re-records the revision and re-enables checkpoints from the
 *  next trigger (last-writer-wins from here). Null → revision 0 (an
 *  explicitly-read empty slot the next checkpoint may claim); a format
 *  mismatch locks FORMAT; a payload failing the acceptCloudData validation
 *  gate is NOT a readable slot either (the boot path's never-overwrite-
 *  unreadable-data guard; validation only — never applied mid-session) →
 *  NETWORK + retryable with the revision STILL null, so a corrupt/foreign
 *  payload cannot be claimed just by retrying; any other failure also keeps
 *  NETWORK + retryable with the revision STILL null (no send may overwrite an
 *  unread slot). The pause row re-render (retryCloudNow's finally) is the
 *  feedback — no toast. */
async function retryCloudRead(): Promise<void> {
  if (cloud.status === 'guest' || cloud.status === 'unsupported') return; // nothing to read
  try {
    const res = await cloud.load();
    if (!res) {
      cloudRevision = 0;
      cloudFailureKind = null;
      cloudRetryable = false;
      return;
    }
    if (res.formatVersion !== CLOUD_FORMAT_VERSION) {
      cloudLocked = true;
      cloudFailureKind = 'FORMAT';
      cloudRetryable = false;
      return;
    }
    const accepted = acceptCloudData(res.data);
    if (!accepted) {
      cloudFailureKind = 'NETWORK';
      cloudRetryable = true;
      // revision stays null — unreadable payload = still an unread slot (a
      // later retry may succeed if another device rewrites it validly).
      return;
    }
    cloudRevision = res.revision;
    cloudFailureKind = null;
    cloudRetryable = false;
  } catch {
    cloudFailureKind = 'NETWORK';
    cloudRetryable = true;
  }
}

/** Pause-menu 重試: resend the kept snapshot (same requestId), or a fresh
 *  checkpoint when there is none (post-conflict row). Drops when a send is
 *  already in flight; re-renders the pause row if still paused so the retry
 *  gives immediate feedback. Minor 1: when the boot read never landed
 *  (revision null, not locked/stopped) the retry is a LOAD-ONLY re-read —
 *  never a mid-session apply. */
function retryCloudNow(): void {
  if (cloudInFlight) return;
  if (cloudRevision === null && !cloudLocked && !cloudAuthStopped) {
    void retryCloudRead().finally(() => {
      if (state === 'paused') setState('paused');
    });
    return;
  }
  const done = pendingCloud ? sendPendingCloud() : saveCloudNow('retry');
  void done.finally(() => {
    if (state === 'paused') setState('paused');
  });
}

/** Snapshot the pause menu's cloud opts (Phase 4 Task 4): the row copy comes
 *  from the client status + the save-side flags — `error` alone cannot tell a
 *  retryable NETWORK failure from a locked REQUEST_REUSED one (Ruling D), so
 *  `cloudRetryable` carries that distinction for the button. */
function cloudPauseOpts(): {
  cloudStatus: CloudStatus;
  cloudRetryable: boolean;
  onRetryCloud: () => void;
} {
  const s = cloud.status;
  if (s === 'guest') return { cloudStatus: 'guest', cloudRetryable: false, onRetryCloud: retryCloudNow };
  if (s === 'unknown' || s === 'unsupported') {
    return { cloudStatus: 'unsupported', cloudRetryable: false, onRetryCloud: retryCloudNow };
  }
  if (cloudFailureKind === 'FORMAT' || s === 'format') {
    return { cloudStatus: 'format', cloudRetryable: false, onRetryCloud: retryCloudNow };
  }
  if (cloudConflict || s === 'conflict') {
    return { cloudStatus: 'conflict', cloudRetryable: cloudRetryable, onRetryCloud: retryCloudNow };
  }
  if (s === 'error' || cloudRetryable || cloudFailureKind !== null) {
    return { cloudStatus: 'error', cloudRetryable: cloudRetryable, onRetryCloud: retryCloudNow };
  }
  return { cloudStatus: 'ready', cloudRetryable: false, onRetryCloud: retryCloudNow };
}

/** Shared quit-to-title tail (pause 回到標題 / 儲存並離開 / death quit): ends
 *  the session (beforeunload stops saving) and resets the player — the title
 *  orbit queues key off player.position, so leaving it far away would orbit a
 *  one-chunk island (Task 17 CR fix). No save happens here — saving is the
 *  explicit job of 儲存並離開 / autosave / beforeunload (Task 14 settled). */
function quitToTitle(): void {
  audio.stopAmbience(); // Phase 3 Task 10: kill the wind bed + chirp/cricket timer
  sessionStarted = false;
  resetPlayerToSpawn();
  // B2.1：標題畫面的環繞相機也用同一台相機 → 疾跑 FOV 必須在離開遊戲時
  // 歸零（否則標題畫面會停在 77° 的疾跑視野）。
  resetSprintAndFov();
  setState('title');
}

/** Drop the live entities (review #4): mobs, ground drops and arrows are NOT
 *  persisted (plan: they respawn naturally), so a session restart must never
 *  inherit the previous session's. Called by resetWorld (New Game) and
 *  continueGame (stale in-page predecessors). No mobs-changed/drops-changed
 *  emit — nothing on the bus consumes them yet. */
function resetSessionEntities(): void {
  mobs = [];
  drops = [];
  arrows = [];
}

/** New Game = a FRESH world (plan 14.3 "new → fresh state"): sessions within
 *  one page share the boot World, so starting anew must drop every trace of
 *  the last one. The honest minimal set:
 *  - meshes: ChunkRenderer keys built meshes by chunk (`private meshes` map),
 *    and main only ever pairs mesh add/remove with chunk add/remove
 *    (refreshQueues removes both together, rebuild only runs for chunks in
 *    the world) — so removing per CURRENT chunk key before world.clear()
 *    empties the scene. NOT `chunkRenderer.dispose()`: that also kills the
 *    shared material + atlas texture. Rebuilds are lazy: the queues regenerate
 *    as the player plays.
 *  - world: chunks + block edits via the testable `World.clear()`.
 *  - queues: pendingGen/pendingMesh are rebuilt every frame anyway; clearing
 *    them plus `generated`/`genInFlight` starts the session from zero. A gen
 *    response still in flight lands harmlessly — same seed ⇒ same terrain.
 *  - entities: mobs/drops/arrows (resetSessionEntities).
 *  Same seed on purpose: the TerrainWorkerClient is built once at boot —
 *  seed rebuild is out of scope (see continueGame's SEED note). */
function resetWorld(): void {
  for (const key of [...world.chunks.keys()]) {
    const [cx, cz] = key.split(',').map(Number);
    chunkRenderer.remove(cx, cz);
  }
  world.clear();
  generated.clear();
  genInFlight.clear();
  pendingGen.length = 0;
  pendingMesh.length = 0;
  resetSessionEntities();
  clearFurnaces(); // Task 6: in-progress smelting never survives a world reset
}

function startGame(): void {
  resetWorld(); // review #4: New Game starts from a fresh world, not the boot one
  modeStash = createModeStash(); // B1.3: fresh per-mode state for the fresh session
  // Plan 14.3 "new → fresh state" for everything the world reset can't see.
  // Task 17.5 Critical (verified live): the hotbar is the ENTIRE inventory, so
  // inheriting the previous session's slots deadlocks a fresh survival game —
  // fits() counts slack only from empty slots / partial stacks of the same
  // item, and a hotbar of unrelated 64/64 stacks has ZERO: mined drops can't
  // be picked up (addItem overflows → pickup rejected) and craft results can't
  // be taken (craftingParams.onTake pre-checks fits() → blocked forever).
  // Vitals/clock carried stale values the same way (quit at hp 6/20 → new game
  // at 6/20; quit at night → new game at night), and staged craftGrid/craftExcess
  // items would flush into the NEW session's inventory on its first inventory open.
  const fresh = loadModeSlots(modeStash, currentMode);
  for (let i = 0; i < hotbar.length; i++) inventory.setSlot(i, fresh[i] ?? null);
  selected = 0;
  hud.setHotbar(hotbar, selected);
  setVitals(currentMode === 'survival' ? { ...modeStash.survivalVitals } : null);
  clock = createClock(settings.dayLengthSec);
  // Phase 3 Task 10: arm the engine (this click IS the gesture), start the wind
  // bed and pin the ambience phase to the fresh clock (day).
  audio.ensureStarted();
  audio.startAmbience();
  audio.setPhase(phaseOf(clock.t));
  craftGrid = [];
  craftExcess = [];
  advancements = emptyAdvancements(); // Task 11: New Game → fresh progress
  deathCause = null; // Task 13: explicit (resetPlayerToSpawn below also nulls it)
  resetSprintAndFov(); // B2.1: fresh sprint latch + FOV back to 70
  cloudAppliedAtBoot = false; // Ruling I: a fresh game replaces any boot-applied cloud state
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
  // Review #4: entities are never persisted — drop any stale in-page session's
  // mobs/drops/arrows so Continue doesn't inherit them. Chunks + modified are
  // deliberately NOT cleared here: Continue applies onto the existing world.
  resetSessionEntities();
  clearFurnaces(); // Task 6: furnace states are session-only (conditional toast inside)

  const [px, py, pz] = payload.player.pos;
  player = createPlayer(px, py, pz);
  player.yaw = payload.player.yaw;
  // Session-scoped resets, mirroring resetPlayerToSpawn (a stale fall apex or
  // carried attack cooldown must not leak into the restored session).
  fallState = resetFall();
  attackCd = 0;
  deathCause = null; // Task 13: Continue restores a living player — no death cause

  currentMode = payload.player.mode; // 3. mode
  input.setFlyEnabled(currentMode === 'creative'); // survival save → stay grounded
  settings.mode = currentMode;
  saveSettings({ mode: currentMode }); // keep menu labels in sync
  inventory.setMode(currentMode);
  // B1.3: restore the per-mode stash that travelled with the payload — the
  // OTHER mode's hotbar and the survival vitals survive a quit/reload. The LIVE
  // slots below come from `player.inventory`, never from the stash's side for
  // the mode being entered: that side is only refreshed when the mode is LEFT,
  // so it can legitimately be older than the live slots (the save-first order
  // in the mode-changed handler is what keeps the pair sound). For v1/v2
  // records normalizeModeStash derives both sides.
  modeStash = normalizeModeStash(payload.stash, {
    mode: payload.player.mode,
    inventory: payload.player.inventory,
    vitals: payload.player.vitals,
  });
  // The record's inventory is untrusted even after shape validation (unknown
  // ids, junk counts, any length): sanitizeSlots pads/truncates to the live
  // hotbar width and drops junk rather than writing it into the model.
  const restoredSlots = sanitizeSlots(payload.player.inventory, hotbar.length);
  for (let i = 0; i < hotbar.length; i++) {
    const s = restoredSlots[i];
    inventory.setSlot(i, s ? { ...s } : null); // setSlot copies + validates; clears the tail
  }
  hud.setHotbar(hotbar, selected);
  // vitals: survival restores saved values (payload vitals is null only when
  // it was saved in creative; a corrupt survival payload falls back to a full
  // reset); creative keeps the hidden bar hidden. Review #5: COPY the payload's
  // vitals — live vitals are mutated frame-to-frame and the payload object is
  // the cached `savedPayload`, reused by a later Continue.
  setVitals(
    currentMode === 'survival'
      ? payload.player.vitals
        ? { ...payload.player.vitals }
        : createVitals()
      : null,
  );

  // Progress (Task 11): restore the saved advancement state. The payload is
  // always normalized v2 (loadGame migrates v1 / sanitizes v2), and the state
  // is treated immutably everywhere — handing over the cached reference is safe.
  advancements = payload.advancements;

  clock.t = payload.time.t; // 4. time-of-day
  resetSprintAndFov(); // B2.1: fresh sprint latch + FOV back to 70
  // Phase 3 Task 10: arm + start audio for the restored session (the Continue
  // click IS the gesture); ambience follows the restored time-of-day.
  audio.ensureStarted();
  audio.startAmbience();
  audio.setPhase(phaseOf(clock.t));

  cloudAppliedAtBoot = false; // Ruling I: this local payload is the session now
  sessionStarted = true;
  setState('playing'); // same entry tail as startGame
  relockCanvas(); // the click is a user gesture → controls live
}

/** Title 繼續遊戲 when the boot read already applied cloud progress (Ruling I):
 *  enter the ALREADY-APPLIED live state — world, player, mode/inventory/vitals,
 *  advancements and clock are the boot `applyCloudData`'s, so there is NO
 *  payload application here (re-applying is exactly the bug this fixes, and
 *  cloud never carries voxel edits). Body = continueGame's entry tail only. */
function continueFromCloud(): void {
  cloudAppliedAtBoot = false; // session started — the boot state is now the session
  resetSprintAndFov(); // B2.1: fresh sprint latch + FOV back to 70
  audio.ensureStarted();
  audio.startAmbience();
  audio.setPhase(phaseOf(clock.t));
  sessionStarted = true;
  setState('playing');
  relockCanvas(); // the click is a user gesture → controls live
}

/** Title 繼續遊戲 (Task 14 + Ruling I/J): route by the pure boot-entry decision.
 *  'cloud' → the boot-applied state; 'local' → apply the cached local payload
 *  synchronously (inside the click gesture, so continueGame's relock works);
 *  'none' → defensive new game (the button is hidden without an entry). */
function handleContinue(): void {
  const entry = titleEntry({
    hasLocalSave: savedPayload !== null,
    cloudApplied: cloudAppliedAtBoot,
  });
  if (entry === 'cloud') {
    continueFromCloud();
    return;
  }
  if (entry === 'local' && savedPayload) {
    try {
      continueGame(savedPayload);
    } catch (err) {
      // Review #2: honest recovery — a payload that explodes mid-apply must not
      // strand the title screen. SETTLE: keep the cache (the record itself may
      // be fine, and the next good save overwrites it) but fall back to a new
      // game for THIS click; startGame's resetWorld discards any partial world
      // application. loadGame's shape validation makes a throw near-impossible.
      console.warn('[WeCraft] Continue failed — falling back to a new game', err);
      startGame();
    }
    return;
  }
  startGame(); // defensive: button rendered without an entry (unreachable — hasSave gates it)
}

/** Respawn flow (Task 10): full vitals → world spawn → back to 'playing'.
 *  Inventory is intentionally untouched (settled: death does NOT drop items),
 *  and mobs frozen at death stay put (out of scope, settled). The overlay goes
 *  with the transition — setState clears it. */
function handleRespawn(): void {
  setVitals(createVitals()); // hp 0 → 20 / hunger refilled — emits vitals-changed via the integer gate
  resetPlayerToSpawn(); // pos/vel/fallState/attackCd → spawn; inventory untouched
  clearFurnaces(); // Task 6: in-progress smelting resets on respawn (conditional toast inside)
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

// ---- Task 14 save point (b): backgrounding / closing the tab ----
// Plan 14.3(b) is the visibility change — the tab going hidden (switch away,
// minimize, mobile background) is the crash-prone moment, and it costs at
// most the autosave window (30 s) of progress without this. Fire-and-forget
// through the shared sessionSavePayload/persistNow path (also caches the
// payload for the title's Continue button), debounced ~2 s so rapid
// hidden/visible flips can't spam IDB. `sessionStarted` keeps the title
// screen with no session from ever writing. Page-lifetime listener.
document.addEventListener('visibilitychange', () => {
  // Phase 3 Task 10: auto-mute in background tabs (suspend/resume the audio
  // context on hide/show); the save logic below is deliberately untouched.
  audio.handleVisibility(document.visibilityState === 'hidden');
  if (document.visibilityState !== 'hidden' || !sessionStarted) return;
  const now = Date.now();
  if (now - lastBgSave < BG_SAVE_DEBOUNCE_MS) return;
  lastBgSave = now;
  persistNow();
});

// Save point (b), close/refresh half: best-effort save on tab close. The page
// is tearing down — nothing can await it, so rejection is swallowed (and
// review #6's null payload — the death state — skips the write entirely).
// Session guard as above. Page-lifetime listener — attach once, never removed.
window.addEventListener('beforeunload', () => {
  if (!sessionStarted) return;
  const payload = sessionSavePayload();
  if (!payload) return;
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

// 平台切換一般／原生全螢幕／沉浸模式不重載 iframe —— 尺寸變化只走這裡
// （renderer 尺寸 + 相機 aspect + pixelRatio 一起同步；0 尺寸守衛避免 NaN aspect）。
// window resize 覆蓋 iframe 尺寸變化；ResizeObserver 補容器 CSS 變化；
// visualViewport 補瀏覽器工具列顯隱（desktop-only 下多為 no-op）。
function syncViewportSize(): void {
  const w = document.documentElement.clientWidth || window.innerWidth;
  const h = document.documentElement.clientHeight || window.innerHeight;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
  gs.setSize(w, h);
  gs.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
}

window.addEventListener('resize', syncViewportSize);
if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(() => syncViewportSize());
  ro.observe(document.documentElement);
}
window.visualViewport?.addEventListener('resize', syncViewportSize);

hud.setHotbar(hotbar, selected);
// B2.1 唯讀 debug hook（Task 9）：**僅供 Playwright 驗收讀取**（Task 13）——
// 全部是 getter，唯讀、不改變任何遊戲行為，內容只有本機遊戲資料。
// getter 讀的是模組層級的 live binding（`sprintState`／`vitals`／`player`／
// `hotbar`／`drops`），所以每次取值都是當下的狀態。
window.__wecraft = {
  sprint: () => sprintState.active,
  fov: () => gs.camera.fov,
  hunger: () => (vitals ? vitals.hunger : null), // 創造模式 → null（無飢餓條）
  pos: () => ({ x: player.position.x, y: player.position.y, z: player.position.z }),
  hotbar: () => hotbar.map((s) => (s ? { item: s.item, count: s.count } : null)),
  drops: () => drops.length,
  modified: () => world.modified.size,
};
// Task 14: resolve save existence ONCE before the title mounts — Continue
// renders iff loadGame() found a payload (settled: hidden when there is none,
// async → title with the conditional button). loadGame never rejects (null on
// any failure); state already IS 'title', this only (re)renders the menu.
// Phase 4 Task 4 boot (4.1–4.2): cloud init never blocks the title (Task 3's
// init is total — failure lands on `unsupported`, never `unknown`/`error` in
// practice); then, with hasSave settled and BEFORE the first title render, a
// loadable slot (anything but guest/unsupported) is read — success+valid
// applies onto the live boot state and records the revision, an empty slot
// records revision 0, any failure toasts 雲端讀取失敗，本機繼續 and guards
// (revision null: no send may ever overwrite the unread slot).
void (async () => {
  try {
    await cloud.init();
  } catch {
    /* defensive: createCloudClient.init never rejects — the title mounts anyway */
  }
  savedPayload = await loadGame();
  if (cloud.status !== 'guest' && cloud.status !== 'unsupported') {
    try {
      const res = await cloud.load();
      if (!res) {
        cloudRevision = 0; // empty slot — the first checkpoint may claim it
      } else if (res.formatVersion !== CLOUD_FORMAT_VERSION) {
        cloudLocked = true;
        cloudFailureKind = 'FORMAT';
        cloudRevision = null; // never overwrite an unreadable-format slot
      } else {
        const data = acceptCloudData(res.data);
        if (data) {
          applyCloudData(data);
          cloudRevision = res.revision;
          // Ruling I: the live state now IS this cloud payload — the title
          // enters it via continueFromCloud() (never re-applies). Cleared at
          // session start (startGame/continueGame/continueFromCloud).
          cloudAppliedAtBoot = true;
        } else {
          // Minor 1: honesty + recovery — the read succeeded but the payload
          // could not be accepted; the row must say so and offer a retry
          // (revision stays null: still no send may overwrite the slot).
          cloudRevision = null;
          cloudFailureKind = 'NETWORK';
          cloudRetryable = true;
          pushCloudToast('雲端讀取失敗，本機繼續');
        }
      }
    } catch {
      // Minor 1: same honesty + recovery as the null-payload branch above.
      cloudRevision = null; // guard: no send may overwrite an unread slot
      cloudFailureKind = 'NETWORK';
      cloudRetryable = true;
      pushCloudToast('雲端讀取失敗，本機繼續');
    }
  } else {
    cloudRevision = null; // guest/standalone — local saves only, zero noise
  }
  setState('title');
})();

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
    // Phase 3 Task 6: 0.5 s-throttled biome sample → tint the fog/background;
    // the dome keeps the raw sky (horizon + zenith) so the gradient stays the
    // sunset ramp while the haze picks up the biome hue.
    biomeAcc += dt;
    if (biomeAcc >= BIOME_SAMPLE_INTERVAL_SEC) {
      biomeAcc = 0;
      biomeNow = biomeAt(player.position.x, player.position.z, settings.seed);
    }
    const sunDir = sunDirection(clock.t);
    const c = skyColors(clock.t);
    const tinted = {
      ...c,
      fog: applyBiomeTint(c.fog, biomeNow),
      sky: applyBiomeTint(c.sky, biomeNow),
    };
    gs.setDayNight(sunDir, tinted);
    sky.setSky(sunDir, { zenith: c.zenith, horizon: c.sky }, gs.camera.position);
    if (phase !== prevPhase) {
      bus.emit('time-changed', { phase, t: clock.t });
      // Task 12: phase events feed first_night (day after a seen night).
      applyAdvancement({ type: 'phase', phase });
      audio.setPhase(phase); // Phase 3 Task 10: flip ambience voicing (+ one cue)
    }

    // ---- B2.1 疾跑狀態機（Task 9 接線）----
    // **每幀順序**：狀態機 → 物理 → 消耗 → 攻擊 → FOV。
    // 狀態機吃的是「本幀的輸入 ＋ 上一幀的物理/攻擊結果」：
    //  - `sprintRequested`＝本幀的雙擊 W 脈衝（輸入層已判過時間窗）；
    //  - `wallAngleDeg`＝**上一幀** `stepPlayer` 回報的撞牆夾角（本幀的碰撞
    //    還沒發生，只能用上一幀的結果）；
    //  - `attacked`＝**上一幀**的攻擊命中（攻擊分支在本幀的狀態機之後才跑）。
    // 因此這段必須排在 `stepPlayer` 與 `jumpStarted` 之前——疾跑的結果要餵給
    // 本幀的物理（速度）與消耗（0.1/公尺、0.2 的疾跑跳）。
    sprintState = updateSprint(sprintState, {
      forward: input.state.fwd > 0, // 只往前才算疾跑（倒退＝取消）
      sneak: input.state.sneak, // 潛行與疾跑互斥
      ctrlHeld: input.state.sprint, // Ctrl 是否按住（**語意不變**）
      sprintRequested: input.consumeSprintToggle(), // 雙擊 W 的一次性脈衝
      hunger: vitals ? vitals.hunger : null, // 創造模式 vitals 為 null → 無飢餓門檻
      flying: player.flying,
      inWater: player.inWater,
      wallAngleDeg: lastWallAngleDeg, // 上一幀的撞牆夾角（8° 門檻）
      attacked: attackedThisFrame, // 上一幀的攻擊命中
    });
    attackedThisFrame = false; // 一次性旗標：狀態機讀完即清（下一幀才會再被設）

    // 移動 — jump start edge (Task 9.5): captured BEFORE physics clears
    // onGround; water swim-strikes and active flight aren't discrete jumps,
    // so neither launches the 0.05-exhaust jump charge (0.2 when sprinting).
    const jumpStarted =
      input.state.jump && player.onGround && !player.flying && !player.inWater;
    // Pre-physics capture (review Important #2): the fall apex must keep the
    // EXACT pre-fall y — reading it after stepPlayer had already lost g·dt² ≈
    // 0.009 on the first airborne frame, which made every integer-height fall
    // deal 1 less than spec (floor(D−ε−3) = D−4).
    const preStepY = player.position.y;
    // Horizontal twin of the capture above: sprint exhaustion bills per metre
    // ACTUALLY moved this step (vanilla), so the distance is measured from the
    // pre-physics position too.
    const preStepX = player.position.x;
    const preStepZ = player.position.z;
    // B2.1：物理層拿到的 `sprint` 是「**有效疾跑**」（`sprintState.active`），
    // 不是 `input.state.sprint`（那只是「Ctrl 是否按住」）。`MoveInput` 改為
    // 明確組裝 → 物理層不可能誤拿到別的語意。
    const moveInput: MoveInput = {
      fwd: input.state.fwd,
      strafe: input.state.strafe,
      jump: input.state.jump,
      sneak: input.state.sneak,
      sprint: sprintState.active,
      fly: input.state.fly,
      flyUp: input.state.flyUp,
      flyDown: input.state.flyDown,
    };
    const step = stepPlayer(player, moveInput, world, dt);
    // 撞牆夾角立刻更新：下一幀的狀態機要拿它判定 8° 門檻（延遲一幀是刻意的
    // ——本幀的碰撞結果不可能回頭改變本幀的疾跑）。
    lastWallAngleDeg = step.wallAngleDeg;

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
      if (amount > 0) {
        deathCause = 'fall'; // Task 13: fall damage landed (last write wins toward the death line)
        setVitals(damage(vitals, amount)); // emits vitals-changed via setVitals
      }
    }

    // ---- 音效：腳步（Phase 3 Task 10）----
    // Grounded walk/run only (airborne, flying and swimming are silent); the
    // cadence comes from horizontal speed (footstepInterval), the material from
    // the block 0.05 below the feet.
    const horSpeed = Math.hypot(player.velocity.x, player.velocity.z);
    if (player.onGround && !player.flying && !player.inWater && horSpeed > 0.5) {
      stepAcc += dt;
      if (stepAcc >= footstepInterval(horSpeed)) {
        stepAcc = 0;
        const groundId = world.getBlock(
          Math.floor(player.position.x),
          Math.floor(player.position.y - 0.05),
          Math.floor(player.position.z),
        );
        audio.play('step', materialGroup(groundId), {
          pos: player.position,
          listener: player.position,
        });
      }
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
      // Task 12: record which items actually entered the inventory; the unlock
      // events fire AFTER the loop (the drop entities are gone by then).
      const obtained: ItemId[] = [];
      // back-to-front: removing index i must not shift the ones still to process
      for (let i = near.length - 1; i >= 0; i--) {
        const idx = near[i];
        const item = drops[idx]?.item;
        const countBefore = drops[idx]?.count ?? 0;
        const res = pickup(drops, idx, inventory);
        drops = res.drops;
        if (item && res.overflow < countBefore) {
          pickedUp = true; // at least 1 item entered the inventory
          obtained.push(item);
        }
      }
      if (pickedUp) {
        hud.setHotbar(hotbar, selected); // inventory changed → refresh counts
        bus.emit('drops-changed', {});
      }
      for (const item of obtained) {
        applyAdvancement({ type: 'obtain', item, mode: currentMode });
      }
    }

    // ---- 粒子（Task 4）：same solidity test as the player (water falls through)
    particles = stepParticles(particles, dt, (x, y, z) => world.isSolid(x, y, z));

    // ---- 熔爐（Task 6）：every placed furnace smelts on its own state ----
    for (const [key, fst] of furnaces) {
      const stepped = stepFurnace(fst, dt);
      if (stepped.state !== fst) furnaces.set(key, stepped.state);
    }

    // ---- 生物（Task 8）：AI → events → vitals/arrows；死亡/超距移除 ----
    const mobsBefore = mobs.length;
    const isSolidAt = (x: number, y: number, z: number): boolean => world.isSolid(x, y, z);
    const stepped = stepMobs(mobs, { playerPos: player.position, isSolidAt, dt });
    mobs = stepped.mobs;
    for (const ev of stepped.events) applyMobEvent(ev);
    const shot = stepArrows(arrows, dt, isSolidAt, player.position);
    arrows = shot.arrows;
    for (const ev of shot.events) applyMobEvent(ev, true);
    // dead mobs despawn past 48 blocks (kill loot — zombie apples — is
    // spawned at the melee kill site above, not here)
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
      const hpBeforeTick = v.hp;
      const moving = input.state.fwd !== 0 || input.state.strafe !== 0;
      if (sprintState.active && moving && !player.flying && !player.inWater) {
        // Vanilla bills each metre actually sprinted; the bank (and the
        // > 4-point drain) lives in survival.ts `exhaust`.
        const moved = Math.hypot(player.position.x - preStepX, player.position.z - preStepZ);
        v = exhaust(v, moved * EXHAUST_SPRINT_PER_METER);
      }
      if (jumpStarted) v = exhaust(v, sprintState.active && moving ? EXHAUST_SPRINT_JUMP : EXHAUST_JUMP);
      v = tickVitals(v, dt); // regen (fast 0.5 s / slow 4 s) + starve: 1 hp per 4 s
      // Task 13: the only hp drop possible here is the starvation tick
      // (exhaust never touches hp, regen only heals) — an hp loss at ~0 hunger
      // marks this life's death cause as starvation.
      if (v.hp < hpBeforeTick && v.hunger <= 0) deathCause = 'starve';
      setVitals(v); // repaint + emit only on an integer change (see setVitals)
      if (isPlayerDead(v) && state === 'playing') {
        // B2.1：死亡＝這條命的疾跑狀態結束 → 鎖存清掉（重生不會莫名疾跑）。
        // FOV 也一併拉回 70（死亡畫面不會停在 77° 的疾跑視野）；下面的
        // `setState('dead')` 另有一道「離開 playing → FOV 回基準」的保險。
        resetSprintAndFov();
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

      // Phase 4 Task 4 checkpoint (c): cloud snapshot every 60 s while playing
      // — alongside the IDB autosave, never blocking it (both fire-and-forget
      // best-effort). rAF only ticks in 'playing', so background tabs and dead
      // sessions never accumulate; close-tab saves are deliberately NOT relied
      // on (settled: no beforeunload cloud save).
      cloudAcc += dt;
      if (cloudAcc >= CLOUD_INTERVAL_SEC) {
        cloudAcc = 0;
        void saveCloudNow('interval');
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

      // ---- B2.1 疾跑 FOV（Task 9 接線）----
      // core/fov.ts 只算數值：目標值（疾跑 70 → 77）＋指數平滑。這裡負責套用
      // 到相機。**相機層的守衛**：只接受「有限且為正」的值——`sprintFov` 只擋
      // 非有限的 base，不擋負數；壞值一律退回 `BASE_FOV`，且不污染
      // `fovCurrent`（下一幀重新平滑，不會卡在壞值上）。
      const fovTarget = sprintState.active ? sprintFov(BASE_FOV) : BASE_FOV;
      const fovNext = stepFov(fovCurrent, fovTarget, dt);
      if (Number.isFinite(fovNext) && fovNext > 0) {
        fovCurrent = fovNext;
        // 差異小於 0.01° 時不動相機 → 不必每幀重算投影矩陣。
        if (Math.abs(gs.camera.fov - fovCurrent) > 0.01) {
          gs.camera.fov = fovCurrent;
          gs.camera.updateProjectionMatrix();
        }
      } else {
        fovCurrent = BASE_FOV;
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
          viewmodel.startSwing(); // Phase 3 Task 8: every attack attempt swings
          if (atk.hitId !== null) {
            attacking = true;
            mobs = atk.mobs;
            attackCd = ATTACK_COOLDOWN_SEC;
            mobRenderer.flashMob(atk.hitId); // 0.1 s white hit flash
            // B2.1：攻擊命中取消疾跑——設一次性旗標，由**下一幀**的狀態機讀取
            // （攻擊分支在本幀的狀態機之後才跑，本幀無法回頭取消）。
            attackedThisFrame = true;
            // Task 9: a landed hit (not a swing) banks vanilla's 0.1
            // exhaustion — hidden until the bank drains saturation/hunger,
            // same path as sprint/jump. Creative (vitals null) never banks.
            if (vitals) setVitals(exhaust(vitals, EXHAUST_ATTACK));
            const beforeKill = mobs.length;
            const dead = mobs.filter((m) => isDead(m));
            mobs = mobs.filter((m) => !isDead(m));
            if (mobs.length !== beforeKill) {
              bus.emit('mobs-changed', { count: mobs.length });
              // Task 12: the kill filter actually removed a mob → unlock event
              applyAdvancement({ type: 'mob-killed', mode: currentMode });
              // Phase 4 verification fix: a zombie kill drops 1 apple in
              // survival — Task 8 shipped the eat/tasty side but no drop
              // source, so apples were unobtainable and the promised
              // 殭屍蘋果掉落→進食 chain dead-ended. Guaranteed (not chance):
              // deterministic for progression, modest (+4 hunger) for balance.
              // Creative spawns nothing (spawnBlockDrop convention); skeletons
              // drop nothing (their arrows are ammo, not loot — minimal fix).
              if (currentMode === 'survival') {
                let spilled = false;
                for (const d of dead) {
                  if (d.kind !== 'zombie') continue;
                  drops = spawnDrop(drops, 'apple', 1, {
                    x: d.pos.x, y: d.pos.y + 0.9, z: d.pos.z,
                  });
                  spilled = true;
                }
                if (spilled) bus.emit('drops-changed', {});
              }
            }
          }
        }
      }

      // Task 3: crack overlay target — the block being dug this frame, when it
      // CAN break (bedrock/water never accumulate progress, so never crack).
      // Phase 3 Task 10: pre-update progress — the dig scrape below fires only
      // on frames where this frame's digStep actually advanced it.
      const digProgressBefore = dig.progress;
      let digTarget: RayHit | null = null;
      if (hit && input.state.dig && !attacking) {
        const id = world.getBlock(hit.x, hit.y, hit.z);
        const held = hotbar[selected];
        // digStep owns the mode branch and resolves the vanilla break time
        // (hardness × 1.5/×5 ÷ tool speed) from the held stack inside — no
        // external speed needed (creative breaks instantly regardless)
        if (Number.isFinite(getBreakTime(id, held))) digTarget = hit;
        if (digStep(currentMode, dig, id, hit, dt, held)) {
          world.setBlock(hit.x, hit.y, hit.z, BLOCK.AIR);
          // Task 7: the broken block becomes a world drop (survival only; creative
          // spawns nothing). Task 6: the held stack gates the drop (bare hands
          // can't harvest stone/iron ore) and breaking costs exhaustion — one
          // small constant per break (exhaust caps before draining, never batch).
          const spawned = spawnBlockDrop(drops, currentMode, id, {
            x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5, // block centre
          }, held);
          if (spawned.length !== drops.length) bus.emit('drops-changed', {});
          drops = spawned;
          if (vitals) setVitals(exhaust(vitals, EXHAUST_BREAK_BLOCK));
          // Task 6: a mined furnace spills its whole contents and loses its state.
          if (id === BLOCK.FURNACE) {
            const key = furnaceKey(hit.x, hit.y, hit.z);
            const fst = furnaces.get(key);
            if (fst) {
              furnaces.delete(key);
              let spilled = false;
              for (const held of [fst.input, fst.fuel, fst.output]) {
                if (!held || !Number.isFinite(held.count) || held.count < 1) continue;
                drops = spawnDrop(drops, held.item, held.count, {
                  x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5,
                });
                spilled = true;
              }
              if (spilled) bus.emit('drops-changed', {});
            }
          }
          // Task 4: break burst — 12 debris particles in BOTH modes (creative
          // keeps the visual payoff; only the drop is survival-gated).
          particles = spawnBreakBurst(particles, id, {
            x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5, // block centre
          });
          viewmodel.startSwing(); // Phase 3 Task 8: the break lands with a swing
          // Phase 3 Task 10: break crack — material from the broken id, at the
          // block centre (now air); distance to the eye attenuates the gain.
          audio.play('break', materialGroup(id), {
            pos: { x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5 },
            listener: player.position,
          });
          dig.reset(); // post-break bookkeeping — clears survival progress after isDone
          digTarget = null; // block is gone: no crack quad hanging on air this frame
        }
      } else {
        dig.reset();
      }
      // Task 4: dig chips — one 2-particle batch per accumulated 0.1 s of
      // progress, spawned half a block OUTSIDE the hit face: block centre
      // (block coords + 0.5) plus normal·1 — the face plane sits at
      // centre + normal·0.5, so +0.5 more clears the still-solid block.
      // digTarget is null on the frame a block breaks (and every non-digging
      // frame), so the timer resets there and chips never spawn from an
      // already-broken block.
      if (digTarget) {
        digChipAcc += dt;
        if (digChipAcc >= DIG_CHIP_INTERVAL_SEC) {
          digChipAcc = 0;
          const chipId = world.getBlock(digTarget.x, digTarget.y, digTarget.z);
          particles = spawnDigChip(particles, chipId, {
            x: digTarget.x + 0.5 + digTarget.nx,
            y: digTarget.y + 0.5 + digTarget.ny,
            z: digTarget.z + 0.5 + digTarget.nz,
          });
        }
      } else {
        digChipAcc = 0;
      }
      // Phase 3 Task 10: dig scrape — one sound per DIG_SOUND_INTERVAL_SEC of
      // REAL progress (digProgressBefore compare above; the breaking frame
      // resets progress, so it stays silent and the break crack alone lands).
      if (digTarget && dig.progress > digProgressBefore) {
        digSoundAcc += dt;
        if (digSoundAcc >= DIG_SOUND_INTERVAL_SEC) {
          digSoundAcc = 0;
          const digId = world.getBlock(digTarget.x, digTarget.y, digTarget.z);
          audio.play('dig', materialGroup(digId), {
            pos: { x: digTarget.x + 0.5, y: digTarget.y + 0.5, z: digTarget.z + 0.5 },
            listener: player.position,
          });
        }
      }
      // stage follows dig.progress (stage 9 just below a break); hidden when the
      // target is null — no cracks for miss/attack/unbreakable/off-hand frames
      crackOverlay.set(digTarget, dig.progress);

      // Phase 3 Task 8: while mining, re-trigger the swing once per 0.25 s; the
      // accumulator rests "due" so the first mining frame swings at once.
      if (digTarget) {
        digSwingAcc += dt;
        if (digSwingAcc >= MINE_SWING_INTERVAL_SEC) {
          digSwingAcc = 0;
          viewmodel.startSwing();
        }
      } else {
        digSwingAcc = MINE_SWING_INTERVAL_SEC; // due again on the next dig frame
      }

      // consume even on miss so a right-click into air can't fire later (aim-then-place bug)
      const wantPlace = input.consumePlace();
      if (wantPlace) {
        // Task 11: interacting with a crafting table ALWAYS opens the 3×3 UI
        // (settled — never place a block onto the table itself, even while
        // holding one). creative: crafting hidden (plan 12.4) → the gate fails
        // and the click falls through to the normal place path (place AGAINST
        // the table when holding a block, otherwise nothing).
        const hitBlock = hit ? world.getBlock(hit.x, hit.y, hit.z) : null;
        if (
          currentMode === 'survival' &&
          hit &&
          hitBlock === BLOCK.CRAFTING_TABLE
        ) {
          setState('crafting');
          document.exitPointerLock?.(); // same order as the inventory open below
        } else if (hit && hitBlock === BLOCK.FURNACE) {
          // Task 6: interacting with a furnace ALWAYS opens its panel (both
          // modes) — never place a block onto the furnace itself.
          openFurnaceAt(hit.x, hit.y, hit.z);
        } else {
          // Task 8: eat one apple — raycast miss OR a non-interactive face
          // while holding an apple. eatFromSlot no-ops (ate false) for any
          // other held item, so blocks/tools fall through to placing below.
          // Full hunger still eats (overflow waste, Minecraft parity); the
          // single setVitals path emits vitals-changed when hunger visibly
          // moves and carries saturation silently otherwise (Task 9 gate).
          // `v` is a const snapshot so the null guard below narrows for tsc.
          const v = currentMode === 'survival' ? vitals : null;
          const eaten = v !== null ? eatFromSlot(hotbar, selected) : null;
          if (v !== null && eaten?.ate) {
            inventory.setSlot(selected, eaten.slots[selected] ?? null);
            setVitals(eat(v, APPLE_FOOD, APPLE_SAT));
            hud.setHotbar(hotbar, selected);
            // apple has no block form — reuse the soft place thud, no new timbre
            audio.play('place', 'grass', { pos: player.position });
            applyAdvancement({ type: 'ate', item: 'apple', mode: currentMode });
          } else if (hit) {
            viewmodel.startSwing(); // Phase 3 Task 8: any right-click place attempt swings
            // B2.2（Task 10）：「放方塊」已抽成 tryPlaceBlock() —— 首次使用路徑與
            // 連放路徑共用同一份實作（見下方連放段）。
            tryPlaceBlock(hit);
          }
        }
      }

      // ---- B2.2 放置連放（Task 10 接線）----
      // **第一次右鍵 vs 之後的連放**：上面那段 `wantPlace` 是「完整使用」（開工作台／
      // 開熔爐／吃蘋果／放方塊），**只有它會開介面、吃東西**；連放只重複
      // `tryPlaceBlock()`（放方塊）—— 不重複開介面、不重複進食。
      // 節拍：`stepRepeat` 只負責「按住之後的重複」，第一次觸發由上面的完整流程
      // 負責；按住需累積滿 0.2 秒（PLACE_REPEAT_SEC ＝ 4 tick）才發火。
      // 滑鼠解鎖／視窗失焦 → `input.state.placeHeld` 歸 false → 節拍歸零（放開即停）。
      const placeStep = stepRepeat(placeRepeat, input.state.placeHeld, dt, PLACE_REPEAT_SEC);
      placeRepeat = placeStep.state;
      if (placeStep.fired && hit) tryPlaceBlock(hit); // 沒瞄到方塊就不放

      // ---- B2.5 Q 丟棄（Task 10 接線）----
      // 單次：Q 丟 1 個、Ctrl+Q 丟整疊（wiki Controls「Control+Q drops the whole
      // stack of items.」）。連丟：按住 Q 每 0.2 秒（DROP_REPEAT_SEC）丟一次；
      // 按住 Ctrl 時連丟的是整疊（`input.state.sprint` ＝「Ctrl 是否按住」，
      // **不是**疾跑狀態機的 active —— 兩者不可混用）。
      // 創造模式：`dropSelected` 直接回 false（不丟、不消耗）。
      const dropReq = input.consumeDrop();
      if (dropReq) dropSelected(dropReq.wholeStack);
      const dropStep = stepRepeat(dropRepeat, input.state.dropHeld, dt, DROP_REPEAT_SEC);
      dropRepeat = dropStep.state;
      if (dropStep.fired) dropSelected(input.state.sprint); // 按住 Ctrl 時連丟整疊

      // UI 脈衝
      if (input.consumeToggleDebug()) showDebug = !showDebug;
      if (input.consumeToggleView()) thirdPerson = !thirdPerson;
      if (input.consumeToggleInventory()) {
        setState('inventory');
        document.exitPointerLock?.();
      }
      // 全螢幕短按 Esc（Keyboard Lock 下送達的 keydown）：開暫停選單並釋放
      // pointer，讓選單按鈕可點。隨後的 pointerlockchange 因 state 已是
      // 'paused' 而成為 no-op，不會重複觸發。
      if (input.consumeRequestPause() && state === 'playing') {
        setState('paused');
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
        // triangles: read BEFORE the render below — three.js resets info at the
        // START of render(), so this yields the previous frame's (non-zero) count
        hud.setDebug(
          formatDebugLines({
            fps,
            x: p.x,
            y: p.y,
            z: p.z,
            chunks: world.chunks.size,
            seed: settings.seed,
            biome: biomeNow,
            mode: currentMode,
            flying: player.flying,
            triangles: gs.renderer.info.render.triangles,
          }),
        );
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
    // paused | inventory | crafting | furnace | dead: keep the frozen world view (plan's single
    // else ran the orbit here too — that would yank the camera on pause).
    // 'dead' renders the world behind the death-screen overlay (Task 10).
    hud.setDebug(null);
  }

  // Task 16: camera-in-water → underwater fog (one cheap block lookup;
  // runs every frame so quitting to title/saving while submerged restores
  // the day fog too — getBlock floors the coords and yields AIR when out of
  // range or outside loaded chunks)
  const cam = gs.camera.position;
  gs.setUnderwater(
    world.getBlock(Math.floor(cam.x), Math.floor(cam.y), Math.floor(cam.z)) === BLOCK.WATER,
  );

  // Phase 3 Task 5: keep the sun shadow focus on the camera — setSunFocus
  // stores x/z and the next setDayNight snaps it to the 2-block grid
  // (shadowFollow), so the shadow box follows without subpixel swim.
  gs.setSunFocus(cam.x, cam.z);

  // Phase 3 Task 7: re-anchor the cloud tile to the camera (whole-period snap
  // combined with the time drift; the matching tile period hides the snaps).
  clouds.update(cam.x, cam.z, now / 1000);

  // Phase 3 Task 8: held-item viewmodel — a cheap cached compare tracks the
  // selected slot (this tail runs after spendFromSlot/slot switches, so the
  // model swaps the same frame), then the swing/bob pose is applied. Swing and
  // bob advance only while playing; third person and every non-playing state
  // hide the group.
  const heldItem = hotbar[selected]?.item ?? null;
  if (heldItem !== heldViewmodelItem) {
    heldViewmodelItem = heldItem;
    viewmodel.setItem(heldItem);
  }
  viewmodel.update(
    state === 'playing' ? dt : 0,
    state === 'playing' && !thirdPerson,
    Math.hypot(player.velocity.x, player.velocity.z),
  );

  dropRenderer.syncDrops(drops); // reconcile sprites every frame (cheap <50)
  particleRenderer.sync(particles, gs.camera); // Task 4 (empty list → nothing drawn)
  mobRenderer.syncMobs(mobs, state === 'playing' ? dt : 0); // frozen off-play (no walk cycle)
  mobRenderer.syncArrows(arrows);
  // Task 3: cracks belong to the dig loop only — the playing branch above
  // drives set(digTarget, dig.progress); every other state (title/paused/
  // inventory/crafting/dead) clears any quad left hanging on the frozen view.
  if (state !== 'playing') crackOverlay.set(null, 0);
  gs.renderer.render(gs.scene, gs.camera);
});
