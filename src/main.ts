import './style.css';
import { createGameScene, createDropRenderer, createMobRenderer } from './render/scene';
import { ChunkRenderer } from './render/chunk-renderer';
import { createCrackOverlay } from './render/crack';
import { createParticleRenderer } from './render/particles';
// B4 Task 8：被動生物（雞／豬／羊／牛）的方塊模型渲染（方塊身 ＋ 頭 ＋ 兩條腿）
import { createPassiveMobRenderer } from './render/passive-mobs';
import { createSky } from './render/sky';
import { createClouds } from './render/clouds';
import { createViewmodel } from './render/viewmodel';
// B2.4 方塊人玩家模型（第三身顯示）：模型本身無動畫、不參與碰撞，只負責
// 外觀；位置（腳底）與可見性由 main 每幀餵入。
import { createPlayerModel } from './render/player-model';
import { World, chunkKey } from './world/world';
import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT } from './world/chunk';
// B6 Task 3：光照生命週期接線——生成／改方塊後以「區塊」為粒度重算（每幀
// 2 區塊預算、近→遠排序），規則本體在 world/lighting.ts。
import { computeChunkLight, computeChunkLightOnly, computeChunkTopY, markLightDirty, popUnsupportedCrosses, popUnsupportedTorches, skyLightScale, sortLightQueueByDistance, spawnLightAt, takeLightBudget } from './world/lighting';
import { TerrainWorkerClient } from './world/worker-client';
import { raycast, reachFor, type RayHit } from './world/raycast';
import { BLOCK } from './world/blocks';
import { stepFurnace, SMELT_RECIPES, FUEL_VALUES, type FurnaceState } from './world/furnace';
// B3 Task 7／8：世界生成版本戳記 + 「這份存檔需不需要跳提示」的判斷。
import { WORLDGEN_VERSION, needsWorldgenNotice } from './world/worldgen';
import { shouldArmNotice, shouldFlushNotice } from './world/worldgen-notice';
import { blockFromItem, stackName, maxStack, sanitizeSlots, starterSlots, INVENTORY_SLOTS, type ItemId, type ItemStack } from './core/items';
// B7 Task 5：耐久扣損的純邏輯（`damageStack` 一次吃當下的堆疊 → 挖完／命中各 −1）
import { damageStack } from './core/durability';
// Ruling I/J: the pure boot entry decision (which session 繼續遊戲 enters).
import { titleEntry, titleTriState } from './core/boot-entry';
import { createInventoryModel, type GameMode } from './core/inventory';
import { createModeStash, normalizeModeStash, saveModeState, loadModeSlots } from './core/mode-stash';
import { createBus, type GameEvents } from './core/bus';
import { createPlayer, stepPlayer, EYE_HEIGHT, PLAYER_HALF_WIDTH, PLAYER_HEIGHT, type MoveInput, type PlayerState } from './player/physics';
import { createInput } from './player/input';
// B2.1 疾跑狀態機：規則本體（取消條件／飢餓門檻／鎖存）在 player/sprint.ts，
// main 只餵每幀上下文並取用 `sprintState.active`。
import { createSprintState, updateSprint, type SprintState } from './player/sprint';
// B2.1 疾跑 FOV：core/fov.ts 只算數值（目標值＋指數平滑），相機的套用與
// `updateProjectionMatrix()` 由 main 負責（見主迴圈相機區）。
import { BASE_FOV, sprintFov, stepFov } from './core/fov';
// B2.4 F5 三態視角與相機姿態：規則本體（視角循環、相機位置與 yaw／pitch）在
// core/view-mode.ts，是純邏輯、不碰 Three／DOM；main 只把回傳的姿態套到相機，
// 並讓互動射線一律以相機姿態為準（畫面看到的方向 == 實際互動的方向）。
import { nextViewMode, viewPose, THIRD_PERSON_DISTANCE, type ViewMode } from './core/view-mode';
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
// B3 Task 6: 仙人掌接觸傷害（純邏輯層；規則本體在 world/hazards.ts）
import { createHazardState, stepHazards, touchesCactus } from './world/hazards';
import { updateFall, resetFall, type FallState } from './player/fallstate';
import {
  DigProgress,
  resolvePlacementTarget,
  canPlaceBlockAt,
  spawnBlockDrop,
  digStep,
  getBreakTime,
  toolDamage,
  hitMobId,
  attackMob,
} from './player/interact';
// B4 Task 9：進食 —— 規則（按住右鍵 1.6 秒、食物值表、扣物品）都在
// `player/eat.ts` 的純邏輯裡；vitals／音效／成就留在 main 這層組裝根。
// **食用的食物值一律來自 `foodFor()`**（食物值表的單一真值）→ 不寫死蘋果。
import {
  EAT_TIME_SEC,
  EatProgress,
  canEat,
  eatFromSlot,
  eatTick,
  foodFor,
} from './player/eat';
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
// B2.5：Q 丟棄的**決策規則**（純函式）：創造模式不消耗、單個 vs 整疊、丟出數量
// 不得超過持有數量 —— 三條不變式由 `src/player/drop.test.ts` 把關。
import { dropCount } from './player/drop';
import {
  stepDrops,
  pickable,
  pickup,
  spawnDrop,
  PLAYER_DROP_PICKUP_DELAY,
  PLAYER_DROP_THROW_SPEED,
  PLAYER_DROP_LIFT_SPEED,
  PLAYER_DROP_FORWARD_OFFSET,
  PLAYER_DROP_HEIGHT_OFFSET,
  type DropEntity,
} from './world/drops';
import { spawnBreakBurst, spawnDigChip, stepParticles, type Particle } from './world/particles';
// B4 Task 4：生物的擊殺掉落表（殭屍腐肉／骷髏骨頭與箭／之後的被動生物）。
import { dropsForDeaths } from './world/mob-drops';
import {
  stepMobs,
  stepArrows,
  stepSunBurn,
  spawnArrow,
  trySpawnMob,
  isDead,
  xzDistance,
  SPAWN_INTERVAL_SEC,
  DESPAWN_DISTANCE,
  type Mob,
  type MobKind,
  type Arrow,
  type MobEvent,
} from './world/mobs';
// B4 Task 5：生怪光照判準（判準集中在 spawn-rules；B6 起餵真的 per-block 光照）。
import { isDaylight } from './world/spawn-rules';
// B4 Task 6：被動生物（雞／豬／羊／牛）的模型與 AI（純邏輯層，渲染是後續任務）。
// **被動生物與敵對生物是兩套東西**：不會主動攻擊、不會 despawn、不進
// `mobs-changed`（那是敵對生物的計數事件）。
import {
  stepPassiveMobs,
  isPassiveDead,
  hitPassiveMobId,
  attackPassiveMob,
  trySpawnPassiveGroup,
  PASSIVE_SPAWN_INTERVAL_SEC,
  type PassiveMob,
  type PassiveKind,
} from './world/passive-mobs';
// B4 Task 10：被動生物的持久化（附加欄位 `passiveMobs`；B4 當時本機 payload 是 v3、
// 雲端是 format 1——當時兩邊都只是多蓋一個可選的鍵；B7 後格式已另行升版）。
import { passiveMobsForLoad, restorePassiveMobs } from './world/passive-save';
import { createHud, formatDebugLines } from './ui/hud';
import { itemIcon } from './ui/icons';
import { renderVitals } from './ui/survival-hud';
import { confirmQuitToTitle, createMenus } from './ui/menus';
import { createDeathScreen, deathMessageFor, type DamageSource } from './ui/death';
import { createInventory } from './ui/inventory';
import { createCrafting, type CraftingParams } from './ui/crafting';
// A4: the session-boundary reset of the UI-owned state (crafting grid /
// cursor) — the rules live in a pure module, main only wires it to the UI.
import { flushCraftGrid } from './ui/session-boundary';
import { createFurnace } from './ui/furnace';
import { createToasts } from './ui/toast';
import { createHurtFlash } from './ui/hurt';
// B4 Task 9：進食進度條（可選的視覺回饋；**規則不依賴它**）。
import { createEatProgress } from './ui/eat-progress';
// B5：疾跑取消原因／撞牆角度的提示（純 UI；何時顯示由每幀接線決定）
import { createHudHint, sprintCancelHint } from './ui/hud-hint';
// B3 Task 8：「地形已改變」一次性提示（**toast** 路徑，與 B1.4 的模態確認框
// `menus.showConfirm` 分開——這裡只 import 提示模組，不碰 menus）。
import { pushWorldgenNotice } from './ui/worldgen-notice';
import { loadSettings, saveSettings } from './core/settings';
import { createClock, tickClock, phaseOf, sunDirection, skyColors, type Clock } from './core/daynight';
import { applyBiomeTint } from './core/biome-fog';
import { generateChunk, surfaceHeight, biomeAt, SEA_LEVEL } from './world/terrain';
// Phase 3 Task 10: audio facade + pure helpers — all wiring lives here in main
// (composition root); the engine is gesture-gated and inert until ensureStarted.
import { createGameAudio, footstepInterval, materialGroup } from './audio';
// Task 14: save/continue — payload assembly is pure (save.ts), all call sites
// here are thin (composition-root convention).
import { collectSavePayload, loadGame, saveGame, type SavePayload } from './world/save';
import {
  blockEntityKey,
  emptyFurnaceEntity,
  entityToFurnaceState,
  furnaceStateToEntity,
  sameFurnaceState,
  spillBlockEntity,
  type BlockEntity,
} from './world/block-entities';
// Phase 4 Task 4: cloud save — pure data rules (cloud-save.ts) + the visitor-safe
// platform client (platform/playroom.ts); all state/load/checkpoint wiring below
// lives here at the composition root.
import { createCloudClient, type CloudStatus } from './platform/playroom';
import { CloudSession, cloudRowState } from './platform/cloud-session';
// A3: the local-save failure policy (pure rules — what the UI does when a
// save fails) lives in core/; main.ts only wires it to the toast/pause menu.
import { saveFailurePolicy } from './core/save-failure';
import {
  acceptCloudData,
  buildCloudData,
  byteSizeOf,
  shouldAllowSave,
  // B5 Task 9：讀取檢查改用「可讀格式集合」；`CLOUD_FORMAT_VERSION` 只剩
  // 寫入端（checkpoint 上傳）在用。
  isReadableCloudFormat,
  CLOUD_FORMAT_VERSION,
  CLOUD_MAX_BYTES,
  type CloudData,
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
// 本機遊戲資料，沒有敏感資訊。（`viewMode` 欄位已於 Task 11 補上。）
interface WecraftDebug {
  /** 本幀是否處於疾跑（= `sprintState.active`，也就是真正餵給物理層的旗標）。 */
  sprint: () => boolean;
  /** 相機目前的垂直 FOV（度）。 */
  fov: () => number;
  /** 當前飢餓值；創造模式為 `null`（沒有飢餓條）。 */
  hunger: () => number | null;
  /** 玩家腳底中心的座標。 */
  pos: () => { x: number; y: number; z: number };
  /** 背包 36 格的（物品、數量）快照；前 9 格是熱鍵欄，空格為 `null`。
   *  名稱沿用舊介面（既有 Playwright 腳本依賴 `hotbar()`）。
   *  B7 Task 5：工具堆疊另帶 `dur`（剩餘耐久；非工具沒有這個欄位）。 */
  hotbar: () => Array<{ item: ItemId; count: number; dur?: number } | null>;
  /** 地面上尚未被拾取的掉落物數量。 */
  drops: () => number;
  /** 世界中被玩家改動過的方塊數。 */
  modified: () => number;
  /** 目前的視角模式（`first`／`back`／`front`）。 */
  viewMode: () => ViewMode;
  /** 世界上活著的敵對生物數量（B4 Task 5：白天燃燒驗收要看生物數的變化）。 */
  mobs: () => number;
  /** 世界上活著的**被動生物**數量（B4 Task 7：白天生成／夜間不生成的驗收要看
   *  數量的變化；被動生物還沒渲染 → 這是唯一能從外部觀察到的線索）。 */
  passiveMobs: () => number;
  /** 晝夜的時鐘相位（0–1：0.5 以下是白天）——驗收要對齊「白天／夜間」。 */
  clock: () => number;
  /** 被動生物腳底座標的快照（驗收「離玩家 ≥ 24 格」要用；純唯讀）。 */
  passiveMobPositions: () => Array<{ x: number; y: number; z: number }>;
  /** 被動生物**逐隻**的狀態快照（id／種類／座標／血量）。
   *
   *  **純唯讀**：只是把當下的 `passiveMobs` 映射成一份新陣列（不修改任何遊戲
   *  狀態、不產生副作用）→ 驗收要確認「打中一隻 → 那一隻的血量下降」時用。 */
  passiveMobStates: () => Array<{
    id: number;
    kind: PassiveKind;
    x: number;
    y: number;
    z: number;
    hp: number;
  }>;
  /** **敵對**生物的逐隻狀態（id／種類／座標／血量／白天燃燒剩餘秒數）。
   *
   *  **用途**：B4 Task 12 的**批末真實瀏覽器驗收**（repo 外的 Playwright 探針）
   *  需要讀到「每一隻敵對生物的 hp／burn／位置」→ 驗「屋簷下的殭屍不掉血」
   *  （看 `hp`／`burn`）與「20 格外的骷髏不射箭」（看 `pos`）。先前只有
   *  `mobs: () => mobs.length`（只有數量）→ 補不出這兩條。
   *
   *  **純唯讀**：只是把當下的 `mobs` 映射成一份**新**陣列（不修改任何遊戲狀態、
   *  不產生副作用、不改變任何遊戲行為）。內容只有本機遊戲資料。 */
  mobStates: () => Array<{
    id: number;
    kind: MobKind;
    x: number;
    y: number;
    z: number;
    hp: number;
    /** 白天日照下的燃燒剩餘秒數（> 0 = 正在燃燒）。 */
    burn: number;
  }>;
  /** 玩家的生命／飢餓／飽食度現況（創造模式 → `null`，沒有飢餓條）。
   *
   *  **用途**：B4 Task 12 的**批末真實瀏覽器驗收**（repo 外的 Playwright 探針）
   *  需要讀「進食後的飽食度值」→ 欄位名沿用 `player/survival.ts` 的 `Vitals`
   *  （`hp`／`maxHp`／`hunger`／`maxHunger`／`saturation`；血量欄位是 `hp`）。
   *
   *  **純唯讀**：回傳當下 `vitals` 的一份**新**快照（不修改任何遊戲狀態、不產生
   *  副作用）。 */
  vitalsState: () => {
    hp: number;
    maxHp: number;
    hunger: number;
    maxHunger: number;
    saturation: number;
  } | null;
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
// B4 Task 8：被動生物渲染（方塊化的雞／豬／羊／牛；與敵對生物的模型分開）
const passiveRenderer = createPassiveMobRenderer(gs.scene);
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
// B2.4：第三身視角（面後／面前）顯示的方塊人玩家模型。模型只建一次並加入場景；
// 每幀由 main 餵入玩家的**腳底**位置與朝向，並切換可見性（第一人稱隱藏）。
const playerModel = createPlayerModel(gs.scene);
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
// B4 Task 15：worker 逾時／messageerror → **一次性** toast（「備援模式」）。
// 為什麼放這裡而不是建構子的參數：`terrain` 在 `toasts` 之前就建好（上面的
// 建構子若當場失敗，這個回呼還沒接上——那種情況下玩家看到的仍是一樣的地形，
// 只是少一個提示）。降級後的世界由主執行緒分幀生成（drainFallback）。
const onTerrainDegrade = (): void => {
  toasts.push({
    title: '世界生成已切換至備援模式',
    description: '地形改由主執行緒分幀生成（較慢）',
    icon: 'dirt',
  });
};
terrain.onDegrade = onTerrainDegrade;
// Task 9: red hurt vignette — flashed by applyMobEvent on every landed hit
const hurtFlash = createHurtFlash(uiRoot);
// B4 Task 9：進食進度條（按住右鍵吃東西時的視覺回饋；規則不依賴它）
const eatProgressUi = createEatProgress(uiRoot);
// B5：疾跑取消提示（撞牆角度／原因）——被動、3 秒節流、2 秒淡出（ui/hud-hint.ts）。
// 什麼時候值得提示由下面的每幀接線決定；UI 只管顯示。
const hudHint = createHudHint(uiRoot);
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
// B1.3: per-mode slots + survival vitals, carried across mode switches — the
// mode-changed handler below saves the OUTGOING mode's live state here, then
// loads the INCOMING mode's. Re-created on every New Game (startGame).
let modeStash = createModeStash();
// Current game mode (Task 5): mirrors settings.mode at boot and follows the
// pause-menu toggle via the mode-changed event below.
let currentMode: GameMode = settings.mode;
// Flight is creative-only (spec §95): gate the double-tap Space toggle at the
// input layer — synced at every `currentMode` assignment below.
input.setFlyEnabled(currentMode === 'creative');
// Stack-based model owns the 36 inventory slots; `slots` is the live reference
// the HUD and crafting read (B5 Task 7: first 9 = hotbar row, then 27 main slots).
// Mode comes from settings (default survival since Task 5); creative add/remove
// no-op inside the model. starterSlots: survival starts EMPTY, so fits() has
// room for drops and craft results (Task 17.5 Critical).
const inventory = createInventoryModel(starterSlots(settings.mode), settings.mode);
const slots = inventory.slots;
let selected = 0;
let showDebug = false;
// B2.4：目前視角（`first`／`back`／`front`）——取代舊的兩態 `thirdPerson` 布林。
// 這是**工作階段層級**的狀態：不進存檔（重置點見 `resetViewMode()`）。
let viewMode: ViewMode = 'first';
/** B2.4：視角回到第一人稱（`resetViewMode()` 唯一的重置點）。
 *
 *  新局、讀檔、切換遊戲模式時一律重置 → 玩家不會在下一局突然看到自己的背面
 *  （也不會留著上一局的第三身姿態）。 */
function resetViewMode(): void {
  viewMode = 'first';
}
let itemNameTimer: ReturnType<typeof setTimeout> | undefined;
const dig = new DigProgress();

// ---- B4.3 進食狀態（Task 9 接線）----
// 進度的規則本體在 `player/eat.ts`（純邏輯：`eatTick` 把「右鍵是否仍按住」與
// 進度綁在一起）；這裡只持有**跨幀的進度狀態**並在每幀餵上下文。
// **旗標欄位 `input.state.placeHeld` 由 B2（0.5.0）擁有 —— 這裡只讀它。**
const eatProgress = new EatProgress();

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
 *    也不讓模式切換（只能從暫停選單觸發）時的凍結世界停在 ≈77°。
 *  - 一併清掉上一幀的撞牆角度（`lastWallAngleDeg = null`）→ 避免新局／切模式
 *    的**第一幀**誤判：狀態機吃的是「上一幀的撞牆夾角」，若上一局最後一幀是
 *    正面撞牆（> 8°），新局第一幀會讀到那個殘留值而誤判成「撞牆取消」→
 *    該幀不疾跑（即使同時按住 Ctrl）。 */
function resetSprintAndFov(): void {
  sprintState = createSprintState();
  lastWallAngleDeg = null;
  // B5：收起上一場次的取消提示（它只有 2 秒生命，但換場次／死亡／回標題時
  // 不該還掛在畫面下緣）。`hide()` 也重置節流 → 新場次同一個原因可立刻再提示
  // （這裡刻意不是 `dispose()`：那會把元素永久移除，而這個函式每次換場次都跑）。
  hudHint.hide();
  resetCameraFov();
}

// ---- Crafting state (Task 11) ----
// The grid is owned here (not by the UI) so items staged in it survive between
// opens of the same size. `craftExcess` parks leftovers that didn't fit a full
// inventory — retried on the next reset, so items are never destroyed.
const craftGrid: Array<ItemStack | null> = [];
const craftExcess: ItemStack[] = [];

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
 *  B7 R6：`dur` 是這疊的剩餘耐久，**必須一路帶到底**——受損工具經 UI 往返
 *  （合成格交還、游標歸還、`resetCraftGrid` 沖刷）不得被洗成滿耐久；
 *  非耐久物品照舊沒有 `dur`（呼叫端傳 undefined → 模型 materialize 成滿耐久，
 *  但工具堆疊上限 1，合併迴圈永遠不會合併它們）。
 *  Creative's `addItem` is a no-op (infinite supply), so creative writes the
 *  stacks directly (merge partials, then empty slots). That branch is NOT dead
 *  (review #3): the crafting take/give-back paths are survival-only now, but
 *  `resetCraftGrid`'s flush below runs on every inventory open in ANY mode —
 *  a grid staged in survival and then mode-toggled must still hand its items
 *  back instead of losing them to the creative no-op. */
function giveItem(item: ItemId, count: number, dur?: number): number {
  if (inventory.mode !== 'creative') return inventory.addItem(item, count, dur);
  const cap = maxStack(item);
  let rest = count;
  for (let i = 0; i < slots.length && rest > 0; i++) {
    const s = slots[i];
    if (!s || s.item !== item || s.count >= cap) continue;
    const put = Math.min(cap - s.count, rest);
    inventory.setSlot(i, { item, count: s.count + put, ...(dur !== undefined ? { dur } : {}) });
    rest -= put;
  }
  for (let i = 0; i < slots.length && rest > 0; i++) {
    if (slots[i]) continue;
    const put = Math.min(cap, rest);
    inventory.setSlot(i, { item, count: put, ...(dur !== undefined ? { dur } : {}) });
    rest -= put;
  }
  return rest;
}

/** Rebuild `craftGrid` for `size`, handing every leftover (plus anything
 *  parked in `craftExcess`) back to the inventory first; items that still
 *  don't fit land in the FRONT cells of the new grid — visible and craftable,
 *  never lost. Called on every crafting open (the grid starts empty) and on
 *  every inventory open (see the call site — it must flush in creative too).
 *  Task 13: flush craftGrid before save (staged items live only in this array).
 *
 *  A4: the grid is emptied **IN PLACE** — the open panel captured the array
 *  reference at open time (the UI writes cells in place); reassigning the
 *  module variable would orphan the UI's grid (its clicks would hand the same
 *  item over AGAIN → duplication, and anything staged afterwards would live
 *  only in the orphan → loss). `dropOverflow` (session boundaries) takes the
 *  stacks that fit nowhere instead of re-staging them — a re-staged stack
 *  would leak into the NEXT session's inventory. */
function resetCraftGrid(size: 2 | 3, dropOverflow?: (stack: ItemStack) => void): void {
  flushCraftGrid({ grid: craftGrid, excess: craftExcess }, size, { giveItem, dropOverflow });
  // The flush hands items back to the slots → the hotbar HUD must show them
  // (the save-time flush can fire mid-game with no panel open).
  hud.setHotbar(slots, selected);
  // The open panel holds the SAME (now empty) array → it must be re-rendered.
  if (craftUi.isOpen()) craftUi.refresh();
  if (inv.isOpen()) inv.refreshCrafting();
}

/** A4: 把一疊「哪裡都放不下」的物品丟在玩家腳邊（地面掉落）。
 *  地面不是洗衣機：受損工具帶著 `dur` 丟出去（撿回來仍是受損的）。 */
function dropAtPlayer(stack: ItemStack): void {
  if (!Number.isFinite(stack.count) || stack.count < 1) return;
  drops = spawnDrop(drops, stack.item, stack.count, player.position, {
    ...(stack.dur !== undefined ? { dur: stack.dur } : {}),
  });
}

/** A4: **session 邊界**——UI 擁有的狀態（合成格／背包游標）一律不得跨場次。
 *
 *  兩種跨界的傷害（審查 A4）：
 *  ① 舞台化的材料在「繼續遊戲」後被沖刷進**已還原的背包** → 複製；
 *  ② 背包滿時的游標餘量留在 UI closure → 下一場次開背包時多出一份 → 複製。
 *
 *  做法（不升 payload 版本——UI 狀態不進存檔）：
 *  1. `inv.close()`：面板可能還開著 → 游標那一疊交還擁有者（`onReturnCursor`
 *     → 回到背包）；放不下的部分留在游標上。
 *  2. `inv.returnCursor()`：把游標**清空**並把剩下的交出來——它**不得**活到
 *     下一場次（還原後的背包很可能已經有那件物品了 → 留著就是複製）。
 *  3. `resetCraftGrid()`：舞台材料交還背包（它們被舞台化時就是從背包拿走的）
 *     —— 放不下的部分交給 `dropOverflow`，**不再重新停在格子里**（重新停放
 *     ＝ 洩漏進下一場次的背包）。
 *
 *  `dropOverflow` 沒有給 → 剩下的東西**丟棄**（隨它所屬的那場次一起結束：
 *  新局／讀檔／套用雲端都會換掉整個世界）。給了 → 丟到玩家腳邊（回到標題
 *  時世界還在，玩家撿得回來）。 */
function resetUiOwnedState(dropOverflow?: (stack: ItemStack) => void): void {
  // 1. 面板可能還開著 → 關掉（游標交還擁有者；close 是冪等的）。
  inv.close();
  // 2. 清空游標：剩下的那一疊交出去（不得活到下一場次）。
  const leftover = inv.returnCursor();
  if (leftover) {
    if (dropOverflow) dropOverflow(leftover);
    // 沒有 sink → 隨舊場次一起丟棄（不留在 UI 狀態裡）。
  }
  // 3. 舞台材料交還背包；放不下的部分不重新停放（否則會洩漏進下一場次）。
  resetCraftGrid(craftUi.isOpen() ? 3 : 2, dropOverflow ?? (() => {}));
  craftExcess.length = 0; // 邊界上不留任何「停放中」的東西
}

/** Callback bundle for ui/crafting (Decision A: plain callbacks, no bus).
 *  Mutations go through the inventory model (`setSlot`/`giveItem`); the HUD is
 *  refreshed after each so the hotbar below stays in sync live. */
function craftingParams(size: 2 | 3): CraftingParams {
  return {
    size,
    grid: craftGrid, // live array — the UI writes cells in place
    // 傳同一個活的 36 格陣列（不要 slice）：crafting.ts 每次 render 依
    // `sourceCount` 重新 slice（來自 inventory 面板內嵌的 2×2 只取 9 格）。
    slots,
    selected, // source slot for the first transfer (UI-local afterwards)
    // no onSlotSelect: the craft row's source selection is local to the widget.
    // Syncing it into `selected` would desync the inventory palette, whose
    // heading + onPick snapshot `selected` at open time (keys are gated while
    // unlocked, so nothing else can move it mid-open).
    onSpend: (slot, item) => {
      const s = slots[slot];
      if (!s || s.item !== item || !Number.isFinite(s.count) || s.count < 1) return false;
      inventory.setSlot(slot, s.count > 1 ? { item: s.item, count: s.count - 1 } : null);
      hud.setHotbar(slots, selected);
      return true;
    },
    // B7 R6：交還的是「合成格裡那一疊」→ 它的 `dur` 要一起傳（受損工具
    // 從合成格拿回來仍是受損的）。
    onGiveBack: (item, dur) => {
      const overflow = giveItem(item, 1, dur);
      hud.setHotbar(slots, selected);
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
      hud.setHotbar(slots, selected);
      // Task 12: a successful craft take is an obtain event (creative never
      // reaches this path, and checkAdvancements would suppress it anyway).
      applyAdvancement({ type: 'obtain', item: result.item, mode: currentMode });
      return true;
    },
  };
}

// ---- 塊實體（B8）—— 箱子內容與熔爐狀態，隨存檔走 ----
// key ＝ `blockEntityKey(x,y,z)`（`${x},${y},${z}`）。熔爐的 live 狀態住在
// 這裡（B8 Task 6 起；先前是 session-only 的 `furnaces` Map，重開遊戲必消失）。
const blockEntities = new Map<string, BlockEntity>();
let openFurnaceKey: string | null = null;

/** Take the whole output stack into the inventory (blocked when full). */
function takeFurnaceOutput(): void {
  if (!openFurnaceKey) return;
  const entity = blockEntities.get(openFurnaceKey);
  if (!entity || entity.kind !== 'furnace') return;
  const st = entityToFurnaceState(entity);
  const out = st.output;
  if (!out || !Number.isFinite(out.count) || out.count < 1) return;
  if (!inventory.fits(out.item, out.count)) return; // full → blocked
  giveItem(out.item, out.count, out.dur);
  const next: FurnaceState = { ...st, output: null };
  blockEntities.set(openFurnaceKey, furnaceStateToEntity(next, entity.x, entity.y, entity.z));
  hud.setHotbar(slots, selected);
  applyAdvancement({ type: 'smelt-take', mode: currentMode });
  furnaceUi.open(next);
}

/** Input/fuel slot click — crafting-cell semantics, moved by main (the UI only
 *  notifies): filled → 1 returns to the inventory; empty → 1 moves in from the
 *  selected hotbar slot when it holds an accepted item (smeltable/burnable). */
function clickFurnaceSlot(which: 'input' | 'fuel'): void {
  if (!openFurnaceKey) return;
  const entity = blockEntities.get(openFurnaceKey);
  if (!entity || entity.kind !== 'furnace') return;
  const st = entityToFurnaceState(entity);
  const stack = which === 'input' ? st.input : st.fuel;
  let next: FurnaceState | null = null;
  if (stack && Number.isFinite(stack.count) && stack.count >= 1) {
    // B7 R6：耐久跟著回背包（熔爐只吃可熔／可燃物 → 對工具不可達，順手一致）
    if (giveItem(stack.item, 1, stack.dur) > 0) return; // inventory full → stays put
    const rest = stack.count > 1 ? { item: stack.item, count: stack.count - 1 } : null;
    next = which === 'input' ? { ...st, input: rest } : { ...st, fuel: rest };
  } else {
    const src = slots[selected];
    if (!src || !Number.isFinite(src.count) || src.count < 1) return;
    const accepted = which === 'input'
      ? src.item in SMELT_RECIPES
      : src.item in FUEL_VALUES;
    if (!accepted) return;
    if (!inventory.spendFromSlot(selected, 1)) return;
    const moved = { item: src.item, count: 1 };
    next = which === 'input' ? { ...st, input: moved } : { ...st, fuel: moved };
  }
  blockEntities.set(openFurnaceKey, furnaceStateToEntity(next, entity.x, entity.y, entity.z));
  hud.setHotbar(slots, selected);
  furnaceUi.open(next);
}

/** Right-click on a placed furnace → standalone panel (both modes). */
function openFurnaceAt(x: number, y: number, z: number): void {
  const key = blockEntityKey(x, y, z);
  const existing = blockEntities.get(key);
  // kind 一致性：同座標若是另一 kind 的實體（雲端還原造成），直接覆蓋成空
  // 熔爐 —— 否則「內容物卡住」，玩家打開看到的是別 kind 的欄位。
  if (!existing || existing.kind !== 'furnace') {
    blockEntities.set(key, emptyFurnaceEntity(x, y, z));
  }
  openFurnaceKey = key;
  setState('furnace');
  document.exitPointerLock?.();
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
 *  arrows → 'skeleton', starvation ticks → 'starve', cactus contact → 'cactus'
 *  — last write wins) and read once at the `setState('dead')` transition via
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
// 需要讀 `drops`／`slots`／`selected` 等模組層狀態。
/** 在 `target` 命中的那一面放一個方塊 —— 「放置」這一件事的完整實作。
 *
 *  **為什麼要抽出來**：B2.2 的連放要求「第一次右鍵照完整流程（開工作台／開熔爐／
 *  吃東西／放方塊），之後每 0.2 秒**只重複放方塊**」。把放置抽成獨立函式，
 *  首次使用路徑與連放路徑共用同一份實作 → 不會兩邊走樣（音效語意、扣物品的
 *  順序、與玩家重疊的判定都只有一份）。
 *
 *  **沒有回傳值**：呼叫端（首次使用路徑與連放路徑）都不消費「是否成功」——
 *  結果本來就看得見（熱鍵欄計數、世界裡的方塊），留一個沒人用的回傳值只會
 *  誤導後人（審查 Minor 1）。放不成時什麼都不做即可。
 *
 *  **放置目標是 world-aware 的（B3 Task 9 Step 4；承接 Task 5 審查 Important
 *  I-1）**：目標格的判定要讀「被點擊那一格」是什麼方塊 → 這是**組裝根**的
 *  活（規則本體在 `player/interact.ts` 的 `resolvePlacementTarget`，可單元測試）。
 *  - 被點擊的格**可被取代**（空氣／水／cross 植被）→ 放進**同一格**：
 *    瞄準花右鍵＝**花被方塊取代、位置不變**（原版語意：可被取代 → 取代同一格）。
 *    這是 Task 5 只做語意層（`canPlaceAt` 放行）而沒有接線的那一段 —— 沒有它，
 *    瞄準花右鍵會在**鄰格**多放一塊、**原花還在**。
 *  - 不可取代（實心方塊）→ 維持既有的「命中格 ＋ 命中面法線」（面鄰格）。
 *
 *  **覆蓋植被時植被不掉落**：原版是被取代、不掉。`world.setBlock()` 是直接覆寫
 *  → 已符合；**這裡刻意不放任何掉落流程**（放了就是「蓋掉花還撿到花」）。
 *
 *  **AABB 規則不放寬**：`canPlaceAt` 的玩家重疊檢查原樣保留 → 站在花格裡放方塊
 *  仍然被擋下（與原版一致）。**唯一的例外是火把（B6 Task 6）**：放行走統一的
 *  `canPlaceBlockAt`——火把是 non-solid（無碰撞盒），沿用重疊檢查的話玩家永遠
 *  放不進腳下的火把；其餘方塊在 `canPlaceBlockAt` 內部照走 `canPlaceAt`。 */
function tryPlaceBlock(target: RayHit): void {
  const t = resolvePlacementTarget(
    target,
    world.getBlock(target.x, target.y, target.z),
  );
  const held = slots[selected];
  const placeId = held ? blockFromItem(held.item) : null;
  if (placeId === null || !canPlaceBlockAt(world, t.x, t.y, t.z, player.position, placeId)) return;
  // no pay, no place: the stack is spent FIRST (creative's spendFromSlot is a
  // free `true`), so a rejected spend never writes the world — unreachable in
  // practice, structural defense
  if (!inventory.spendFromSlot(selected, 1)) return;
  world.setBlock(t.x, t.y, t.z, placeId); // placeId is BlockId | null, guarded above
  hud.setHotbar(slots, selected);
  // Phase 3 Task 10: material-accurate place thud at the target centre
  // (listener defaults to pos → full volume).
  audio.play('place', materialGroup(placeId), {
    pos: { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 },
  });
}

/** B4 Task 9：手上拿的是不是**食物**（＝食物值表裡有值的物品）。
 *
 *  判準一律走 `foodFor()`（食物值表的單一真值）→ 不認得的食物就是「不是食物」
 *  （方塊、工具、空手……）。右手拿食物時右鍵＝進食（不放置），這是原版的
 *  優先序。 */
function heldIsFood(): boolean {
  const held = slots[selected];
  return held !== null && foodFor(held.item) !== null;
}

/** B2.5：丟棄選取格（Q）。`wholeStack` ＝整疊丟棄（Ctrl+Q），否則只丟 1 個。
 *
 *  **「丟幾個」由純函式決定**（`src/player/drop.ts` 的 `dropCount`）→ 創造模式
 *  不消耗、單個 vs 整疊、丟出數量不得超過持有數量這三條不變式有單元測試把關
 *  （Task 10 review Important 1）。這裡只負責「執行」：扣物品 → 生成掉落物。
 *
 *  語意（minecraft.wiki/Controls，2026-10-20）：「If items are stacked, only one
 *  gets thrown/tossed/dropped.」「**Control+Q drops the whole stack of items.**」
 *  → 普通 Q 丟 1 個、Ctrl+Q 丟整疊。
 *
 *  - **創造模式不作用**（不丟、不消耗）：本批的簡化（Task 14 收斂 README 時要寫的
 *    內容之一）。
 *  - **不複製也不吞物品**：`count` 先算出來、`spendFromSlot` 先扣掉，再以同一個
 *    `count` 生成掉落物 → 熱鍵欄減掉的數量與地上出現的數量必然相等。
 *  - **玩家丟出的物品 2 秒（40 tick）內不可拾**：minecraft.wiki/Item (entity)
 *    「or 40 ticks (2 seconds) if thrown by a player」→ 傳
 *    `pickupDelay: PLAYER_DROP_PICKUP_DELAY`（方塊破壞掉落仍是 0.5 秒）。
 *  - 拋出方向＝玩家視線的水平分量（`yaw`）；距離是簡化值（原版約 2～3 格，見
 *    `src/world/drops.ts` 的拋出幾何常數）。
 *
 *  **沒有回傳值**（審查 Minor 1）：呼叫端不消費「是否丟成功」，結果看得見
 *  （熱鍵欄計數、地上有沒有東西）。 */
function dropSelected(wholeStack: boolean): void {
  const stack = slots[selected];
  // 決策交給純函式：創造模式 → 0；空手／數量不合法 → 0；普通 Q → 1；Ctrl+Q → 整疊
  const count = dropCount(stack, wholeStack, currentMode);
  if (!stack || count <= 0) return; // 不丟、不消耗
  if (!inventory.spendFromSlot(selected, count)) return;
  const fx = -Math.sin(player.yaw);
  const fz = -Math.cos(player.yaw);
  drops = spawnDrop(
    drops,
    stack.item,
    count,
    {
      x: player.position.x + fx * PLAYER_DROP_FORWARD_OFFSET,
      y: player.position.y + PLAYER_DROP_HEIGHT_OFFSET,
      z: player.position.z + fz * PLAYER_DROP_FORWARD_OFFSET,
    },
    {
      pickupDelay: PLAYER_DROP_PICKUP_DELAY,
      vel: {
        x: fx * PLAYER_DROP_THROW_SPEED,
        y: PLAYER_DROP_LIFT_SPEED,
        z: fz * PLAYER_DROP_THROW_SPEED,
      },
      // B7：掉落物帶著 `dur`，撿回來不會洗成滿耐久（非工具沒有 `dur`，
      // spawnDrop 不會把 `dur: undefined` 寫進實體）。
      dur: stack.dur,
    },
  );
  hud.setHotbar(slots, selected); // 熱鍵欄計數變了 → 刷新
  bus.emit('drops-changed', {}); // 掉落物清單變了（與其它生成路徑一致）
}

/** B7 Task 5：對**手持堆疊**施加耐久傷害（生存模式才消耗；創造模式的工具耐無限
 *  —— minecraft.wiki/Tool：Java 1.3.1 起「Tools now have infinite durability in
 *  Creative mode」）。
 *
 *  工具歸零 → 清空該格（`inventory.setSlot(selected, null)`：熱鍵列與主背包是
 *  同一個 36 格模型 → 一起清掉）、播損壞音效（固定音色 `tool_break`）、跳
 *  「工具損壞」toast；回傳是否損壞。
 *
 *  **呼叫時機只有兩個**（minecraft.wiki/Durability：「a use is counted if a
 *  player completely breaks apart one block or hits a mob. **If a block is
 *  partially broken, this is not counted as a full use.**」）：挖完一格
 *  （`digStep` 回 true）與攻擊命中（`hitId !== null`）；挖到一半、落空、
 *  冷卻查詢帧、放置、進食都不扣。徒手沒有耐久可扣（`damageStack` 對非工具
 *  是 no-op）。
 *
 *  明示簡化：原版鎬／斧／鏟**打生物**是 −2，本作一律 −1（spec §B7；README
 *  〈與原版的差異〉有記）。 */
function damageHeldTool(amount: number): boolean {
  if (currentMode === 'creative') return false;
  const stack = slots[selected]; // B5 後是 slots（36 格）
  if (!stack) return false;
  const res = damageStack(stack, amount);
  if (res.broke) {
    inventory.setSlot(selected, null); // 熱鍵列與主背包是同一個模型 → 一起清掉
    audio.play('tool_break', 'wood', { listener: player.position }); // group 在此 kind 被忽略
    toasts.push({ title: '工具損壞', description: `${stackName(stack.item)} 壞掉了`, icon: stack.item });
    return true;
  }
  if (res.stack && res.stack.dur !== stack.dur) {
    inventory.setSlot(selected, res.stack);
  }
  return false;
}

// ---- 生物与箭矢（Task 8）----
// Pure mob AI (world/mobs.ts) stepped each frame while playing; night spawns
// them on the surface, distance despawns them, death removes them (no loot).
let mobs: Mob[] = [];
let arrows: Arrow[] = [];
let spawnAcc = 0; // seconds toward the next 5 s spawn tick
/**
 * 被動生物（雞／豬／羊／牛；B4 Task 6）。**與敵對生物分開存**：
 * - 步進規則不同（漫遊／panic／水中漂浮，不追玩家）；
 * - **不 despawn**（原版被動生物不會自然消失）→ 沒有距離過濾；
 * - **不進 `mobs-changed`**（那是敵對生物的計數事件）。
 * 生成規則在 B4 Task 7（`world/passive-mobs.ts` 的 `trySpawnPassiveGroup`：亮度 ≥ 9
 * ——B6 起逐隻查 per-block 光照（`spawnLightAt`），夜間地表仍可生成——、
 * 離玩家 ≥ 24、成群 2-4、上限 12）。
 */
let passiveMobs: PassiveMob[] = [];
/**
 * 被動生物的生成排程（B4 Task 7）：每 {@link PASSIVE_SPAWN_INTERVAL_SEC} 秒嘗試
 * 一次（與敵對生物的 5 秒排程**並列**，互不影響）。
 */
let passiveSpawnAcc = 0;

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
/** A1: true until the boot check (local + cloud) settles. The title's
 *  繼續遊戲 state itself is NOT cached — see {@link titleSaveStateNow}. The
 *  title mounts on `'pending'` (Continue disabled) so a slow network can never
 *  hold the title screen hostage. */
let bootCheckPending = true;

/** A1／B1.4（修復波 review CR-1）：標題三態**每次 render 由 titleEntry 推導**。
 *  曾經快取在一個只在開機 settle 時寫入的變數 → `savedPayload` 在場中存檔
 *  （autosave／儲存並離開）之後，回到標題的快取仍是舊的 `'no'`：**「繼續遊戲」
 *  消失**，而且新遊戲直接開局、**不再問 B1.4 的覆蓋確認**（下一次 autosave
 *  就把剛存的進度蓋掉）——正是這個修復波要消滅的「靜默丟進度」。
 *  `bootCheckPending` 是唯一真正需要狀態的部分（答案還可能被雲端改寫）；
 *  settle 之後永遠可由現況決定。 */
function titleSaveStateNow(): 'pending' | 'yes' | 'no' {
  return titleTriState({
    pending: bootCheckPending,
    hasLocalSave: savedPayload !== null,
    cloudApplied: cloudAppliedAtBoot,
  });
}
/** A1: the player pressed 單人遊戲 while the boot check was still running —
 *  the title shows 「檢查進度中…」 until the settle decides the overwrite
 *  warning (a cloud-only entry must be warned about too). */
let newGameWaiting = false;
/** A1: resolves when the whole boot check (local read → cloud init/read/apply
 *  → title settle) is done. Reassigned by the boot block below. */
let bootSettled: Promise<void> = Promise.resolve();
/** True from game entry (new game OR continue) until a quit-to-title — the
 *  honest guard for the beforeunload save: on the title with no session
 *  there is nothing worth saving (settled). */
let sessionStarted = false;
/** Seconds accumulator toward the 30 s autosave while playing. */
let saveAcc = 0;
const AUTOSAVE_INTERVAL_SEC = 30;
/** A3: when a FAILED autosave should be retried (ms epoch; 0 = none pending).
 *  Set by `persistNow`'s catch, consumed by the playing loop. */
let localSaveRetryDue = 0;
/** A3: true once the player has been told about the current failure streak —
 *  a retry that fails again must not re-push the same toast every 10 s. */
let localSaveFailureNotified = false;
/** Last backgrounding-save timestamp (ms) + debounce — review #1: rapid
 *  hidden/visible flips must not spam IDB. */
let lastBgSave = 0;
const BG_SAVE_DEBOUNCE_MS = 2000;

// ---- 雲端進度（Phase 4 Task 4）----
// The platform client is visitor/standalone-safe (Task 3): every SDK failure
// degrades to a status, init/load/save never throw for a missing SDK —
// save() rethrows only genuine platform errors for classification below.
// The checkpoint lifecycle lives in `CloudSession` (src/platform/cloud-session.ts):
// ONE pending snapshot with a FROZEN requestId, the revision advancing only on
// a confirmed save, and the error classification deciding retry/lock/stop.
const cloud = createCloudClient();
/** The checkpoint state machine — the single owner of the revision, the frozen
 *  snapshot, the in-flight guard and the failure classification. */
const cloudSession = new CloudSession({
  transport: {
    save: (data, revision, formatVersion, requestId) =>
      cloud.save(data, revision, formatVersion, requestId),
  },
  formatVersion: CLOUD_FORMAT_VERSION,
});
/** Ruling I/J: true iff the boot read succeeded AND its payload was validated
 *  and applied to the live state (set in the boot IIFE's apply branch, cleared
 *  at session start). Drives the title entry — with BOTH a local save and this
 *  flag, the cloud state wins the entry (Ruling J) via the pure titleEntry(). */
let cloudAppliedAtBoot = false;
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

// ---- B3 Task 8：「地形已改變」提示狀態 ----
/** 一份**舊的**雲端進度已經套用到 live state，但還沒告知玩家 → 等玩家**進場**
 *  的那一刻才跳提示。為什麼不立刻跳：`applyCloudData` 在**開機時**就跑完了（早於
 *  標題畫面 render），那時跳的 toast 疊在**標題畫面**上、4 秒後自動消失 → 玩家
 *  進遊戲後可能永遠看不到。計畫 §8 的語意是「**進遊戲的同時**跳一次 toast」。 */
let worldgenNoticePending = false;
/** 這個 play session 已經跳過提示 → **同一個 session 不重複**跳。進場時歸零
 *  （新的 session 可以再跳一次：那是下一個 session 的事）。 */
let worldgenNoticeShown = false;

/** 開一個新的 play session —— 「同一個 session 只提示一次」的記號歸零。 */
function beginNoticeSession(): void {
  worldgenNoticeShown = false;
}

/** 記下「這份雲端進度是舊的，進場時要跳提示」。**不直接跳**（見上面的說明）。
 *  規則本體（要提示＋這個 session 還沒跳過）住在 `world/worldgen-notice.ts`
 *  的 `shouldArmNotice`（行為測試在 `worldgen-notice.test.ts`）；這裡只留
 *  旗標。 */
function armWorldgenNotice(saved: number | undefined): void {
  if (!shouldArmNotice(saved, worldgenNoticeShown)) return;
  worldgenNoticePending = true;
}

/** 跳「地形已改變」toast —— 呼叫端必須是「玩家看得到 toast 的那一刻」
 *  （進場、或場中套用雲端進度）。跳完就清掉旗標 → 同一筆進度不重複跳。
 *  規則本體住 `world/worldgen-notice.ts` 的 `shouldFlushNotice`。 */
function flushWorldgenNotice(): void {
  const armed = worldgenNoticePending;
  worldgenNoticePending = false; // 這次 flush 消費掉排隊旗標（無論跳不跳，與舊碼相同）
  if (!shouldFlushNotice(armed, worldgenNoticeShown)) return;
  worldgenNoticeShown = true;
  pushWorldgenNotice(toasts);
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
 *  one hit per 0.5 s (a lone zombie's 1 s cooldown is already slower).
 *  B3 Task 6: the **hazard** damage (cactus contact) goes through the SAME
 *  0.5 s gate (`canBeHurt`／`markHurt` in the frame loop) → mob damage and
 *  hazard damage share one window. Fall damage and starvation keep their own
 *  cadence — they never consult `invuln`. */
let invuln = createInvuln();

/** 危險狀態（B3 Task 6）：仙人掌的接觸計時（累積到 1 秒 → 1 點傷害）。
 * 純資料、由 `stepHazards` 每幀更新；`resetWorld()`／`startGame()` 會歸零。 */
let hazardState = createHazardState();

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
  // B1.3: stash the OUTGOING mode first — its slots and (in survival) vitals
  // survive the switch instead of being destroyed. saveModeState snapshots
  // deep copies, so later gameplay can never leak into the stash; saving runs
  // before loading, so the default stash never clobbers live state.
  modeStash = saveModeState(modeStash, currentMode, [...slots], vitals);
  currentMode = mode;
  input.setFlyEnabled(currentMode === 'creative'); // survival: force a landing
  // B2.1：疾跑狀態與 FOV 一起歸零 → 跨模式不殘留「雙擊 W 鎖存」（創造模式
  // 切回生存時不會莫名其妙地處於疾跑），且 FOV 立刻回到 70。**必須硬重置**：
  // 模式切換只能從暫停選單觸發（此時 state !== 'playing' → 主迴圈的 FOV
  // 平滑分支不跑），不重置的話暫停選單背後的凍結世界會停在 ≈77°。
  resetSprintAndFov();
  // B2.4：切換模式 → 視角回到第一人稱（視角不進存檔、不跨模式殘留）。
  resetViewMode();
  settings.mode = mode; // keep in-memory settings fresh (title/new-game read it)
  saveSettings({ mode }); // single persist point
  inventory.setMode(mode);
  if (mode === 'creative') {
    // creative: restore its stashed slots (the starter kit on first entry)
    loadModeSlots(modeStash, mode).forEach((s, i) => inventory.setSlot(i, s));
    hud.setHotbar(slots, selected);
    setVitals(null); // hide the bar; Task 9 owns the vitals lifecycle
  } else {
    // survival: restore its stashed slots + vitals — each mode keeps its own
    // inventory and vitals across round-trips (B1.3; no more fresh-vitals reset)
    loadModeSlots(modeStash, mode).forEach((s, i) => inventory.setSlot(i, s));
    hud.setHotbar(slots, selected);
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
// B6 Task 3：光照重算佇列——lightDirty 的區塊進這裡（先有光再建網格）。
// **A8（0.10.1）**：每幀只重算 **1 塊**（`computeChunkLightOnly`，~5–8 ms）——
// 舊版一項就同步重算整個 3×3 群組（~48 ms），是編輯卡頓的來源。一次編輯
// 標髒 9 塊 → 佇列近→遠排序（玩家附近先）→ 最多 9 幀收斂。B6 Task 8：排序與
// 預算判斷抽成 lighting.ts 的純函式（sortLightQueueByDistance／takeLightBudget），
// 佇列項只留 [cx, cz]（距離由排序函式自己算）。
let pendingLight: Array<[number, number]> = [];
const generated = new Set<string>();
const genInFlight = new Set<string>();

// ---- 出生點：同步生成 (0,0)，spawn on surfaceHeight(0.5,0.5)+1 ----

/**
 * 出生點的候選柱順序：以 (0,0) 為中心**螺旋外掃**（B3 Task 9 Step 3 的
 * 「出生點不可在水裡」保護用）。
 *
 * **分圈方式**：以「切比雪夫距離」（Chebyshev distance ＝ max(|x|,|z|)）分圈，
 * 每圈先走 z = r 的上邊（x 由 0 到 r）、再走 x = r 的右邊（z 由 0 到 r−1）。
 * 區塊 (0,0) 的柱座標只有非負（0..15）→ 每一圈是 L 形的兩條邊；這個順序把
 * 區塊裡的 256 根柱**恰好各拜訪一次**，而且**離 (0,0) 越近的柱越早被拜訪**
 * （先找到離出生點最近的陸地，而不是隨便找一個天涯海角）。
 */
function* spawnColumnOrder(): Generator<[number, number]> {
  const max = CHUNK_SIZE - 1; // 區塊 (0,0) 的柱座標是 0..15
  for (let r = 0; r <= max; r++) {
    for (let x = 0; x <= r; x++) yield [x, r]; // 上邊（z = r）
    for (let z = 0; z < r; z++) yield [r, z]; // 右邊（x = r）
  }
}

/**
 * 在**已同步生成的 (0,0) 區塊內**找第一根「地表高於海平面」的柱；整塊都在水裡
 * 時回傳 null。
 *
 * **為什麼只搜 (0,0) 區塊**：`spawnPoint()` 只**同步生成**了 (0,0) 這一塊，
 * 其它區塊要等 worker 回應 → 把出生點移到尚未生成的區塊＝**玩家掉進虛空**
 * （腳下沒有方塊、碰撞判定找不到地面）。所以搜尋範圍硬性限制在 (0,0) 區塊內。
 *
 * **為什麼用整數座標取高度**：`generateChunk` 的每柱高度用的是**整數**格點
 * （`surfaceHeight(wx, wz, seed)`，wx/wz 為整數）→ 搜尋也用整數座標 → 判定與
 * 實際生成的區塊**逐格一致**（差半格會讓「判定為陸地」的柱其實頂端還泡在水裡）。
 */
function findDrySpawnColumn(seed: number): { x: number; z: number; h: number } | null {
  for (const [x, z] of spawnColumnOrder()) {
    const h = surfaceHeight(x, z, seed);
    if (h > SEA_LEVEL) return { x, z, h };
  }
  return null;
}

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
    // B6 Task 3 生成接線（與 worker 回應 handler 同一套）：整塊寫入不經
    // setBlock → topY 與 lightDirty 要自己補。
    chunk.topY = computeChunkTopY(chunk);
    markLightDirty(world, 0, 0);
    // 開局同步點亮出生區（玩家所在區塊半徑 2 的 5×5 = 25 塊）：開局時實際
    // 存在的只有 (0,0)（其餘 24 塊對 computeChunkLight 是 no-op）→ 玩家眼前
    // 第一幀就是正確的光；周圍區塊由生成回應的 markLightDirty 進佇列，A8 起
    // 以**每幀 1 塊**（單塊重算）、近→遠的預算補齊。放在 markLightDirty 之後：
    // computeChunkLight 收尾會清掉 (0,0) 的 lightDirty → 不會再進佇列重算一次。
    // （開局這一下仍是**同步的群組重算**——只有 (0,0) 存在，成本 = 單塊等級。）
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) computeChunkLight(world, dx, dz);
    }
  }
  generated.add(chunkKey(0, 0));
  // **為什麼用 `(0.5, 0.5)` 而不是整數**：柱（column）是 1×1 的格子，**整數座標
  // 正好落在格子的邊界上**（四根柱交會的角點）→ 高度取樣與玩家落點都壓在邊界
  // 上、容易在相鄰柱之間浮動。`(0.5, 0.5)` 是**柱的中心** → 取樣與落點都穩定
  // 落在同一根柱的中央。
  // （螺旋搜尋 `findDrySpawnColumn` 取高度時用**整數**座標，是為了與
  // `generateChunk` 的逐柱取樣點一致；找到的柱再用 `dry.x + 0.5` 落到柱心。）
  const h0 = surfaceHeight(0.5, 0.5, settings.seed);
  let x = 0.5;
  let z = 0.5;
  let y = h0 + 1;
  // B3 Task 9 Step 3：**出生點不可在水裡**。B3 的新高度公式讓海陸分佈大改
  // （海洋約 33% 的面積）→ (0,0) 有可能落在水裡 → 玩家一出生就在水裡。
  // 解法：在**已同步生成的 (0,0) 區塊內**螺旋找第一根陸地柱（不移動到未生成
  // 的區塊，否則玩家會掉進虛空）；整塊都在水裡 → 退回原公式並留下警告。
  if (h0 <= SEA_LEVEL) {
    const dry = findDrySpawnColumn(settings.seed);
    if (dry) {
      x = dry.x + 0.5;
      z = dry.z + 0.5;
      y = dry.h + 1; // 站在該柱的地表之上（h > SEA_LEVEL → 那一格不是水）
    } else {
      console.warn(
        '[WeCraft] 出生點：區塊 (0,0) 整塊都在水裡 → 退回原本的高度公式（玩家可能出生在水裡）',
      );
    }
  }
  // walk up out of trees/leaves so the player AABB never starts inside solid blocks
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  const blocked = (yy: number): boolean =>
    world.isSolid(cx, Math.floor(yy), cz) ||
    world.isSolid(cx, Math.floor(yy + 0.9), cz) ||
    world.isSolid(cx, Math.floor(yy + 1.7), cz);
  while (y < CHUNK_HEIGHT - 3 && blocked(y)) y++;
  return { x, y, z };
}

// ---- Task 8: mob spawning + event application ----

/** Every 5 s while playing: delegate to the pure `trySpawnMob` (world/mobs.ts)
 *  — the cap, candidate XZ 24–128 out, surface Y, per-block light gate and kind
 *  all live there; this composition-root wrapper only supplies the world
 *  callbacks and pushes the result. Count changes are announced by the caller.
 *  **光照判準**（B6 Task 7）：B4 的 `clockLight` 時鐘近似已刪除 → 每次嘗試用
 *  `spawnLightAt(world, x, y, z, clock.t)` 查候選格的**真的** per-block 光照。
 *  **B3**：未點光的區塊回 `lit:false` → `canSpawnHostile` 不生成（未知不是暗；
 *  這裡不必另外判斷——同一個 `SpawnLight` 流進純判準層）。 */
function spawnTick(): void {
  const mob = trySpawnMob(mobs, player.position, {
    lightAt: (x, y, z) => spawnLightAt(world, x, y, z, clock.t),
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

/**
 * **生物死亡 → 掉落**（B4 Task 4 審查 I-2）：**死因無關**的單一路徑。
 *
 * 掉落表在 `mob-drops.ts`（`dropsForDeaths`）→ 這裡只負責把清單變成地上的掉落物。
 * 兩條死因路徑都走這個函式：
 * 1. **近戰擊殺**（當場把死掉的生物從名單移走的那一支）；
 * 2. **死亡移除**（生物因為任何其他原因死了、被過濾掉的那一支：箭、之後的白天
 *    燃燒…）。
 *
 * 為什麼要抽成共用函式：先前掉落只接在近戰那一支 → 被箭打死的生物**什麼都不掉**，
 * 掉落表裡的項目也就不可達。現在「誰死了」與「掉什麼」是分開的 → 每種死因都走
 * 同一份掉落表。**不會重複生成**：近戰支會立刻把死掉的生物從 `mobs` 名單移除，
 * 死亡移除那一支就看不到牠（同一幀內也不會二次觸發）。
 *
 * 回傳「有沒有真的掉東西」→ 呼叫端才知道要不要發 `drops-changed`。
 */
function spawnMobDeathDrops(dead: readonly Mob[]): boolean {
  if (currentMode !== 'survival') return false; // 創造模式不掉落
  let spilled = false;
  for (const d of dropsForDeaths(dead)) {
    drops = spawnDrop(drops, d.item, d.count, d.pos);
    spilled = true;
  }
  return spilled;
}

/**
 * **被動生物死亡 → 掉落**（B4 Task 6）：與敵對生物**共用同一份掉落表**
 * （`mob-drops.ts` 的 `dropsForDeaths` → `rollMobDrops`，雞掉生雞肉＋羽毛、
 * 豬掉生豬肉、羊掉生羊肉＋羊毛、牛掉生牛肉＋皮革），**創造模式不掉落**。
 *
 * 為什麼不直接呼叫 `rollMobDrops`：`main.ts` 裡掉落表只有 `dropsForDeaths` 這一個
 * 入口（`main.wiring.test.ts` 的釘子釘的就是這件事）→ 兩種生物共用同一條路徑。
 * `PassiveKind` 與 `MobDropKind` 的被動分支是同一組字面量 → 不需要轉型。
 */
function spawnPassiveDeathDrops(dead: readonly PassiveMob[]): boolean {
  if (currentMode !== 'survival') return false; // 創造模式不掉落
  let spilled = false;
  const table = dead.map((m) => ({ kind: m.kind, pos: m.pos }));
  for (const d of dropsForDeaths(table)) {
    drops = spawnDrop(drops, d.item, d.count, d.pos);
    spilled = true;
  }
  return spilled;
}

function refreshQueues(): void {
  const pcx = Math.floor(player.position.x / CHUNK_SIZE);
  const pcz = Math.floor(player.position.z / CHUNK_SIZE);
  const r = settings.renderDistance;
  const rg = r + 1; // gen one ring past mesh radius so edge chunks have all 4 neighbors
  pendingGen.length = 0;
  pendingMesh.length = 0;
  pendingLight.length = 0;

  for (let dz = -rg; dz <= rg; dz++) {
    for (let dx = -rg; dx <= rg; dx++) {
      const cx = pcx + dx;
      const cz = pcz + dz;
      const key = chunkKey(cx, cz);
      const c = world.getChunk(cx, cz);
      // generated-keyed, not hasChunk (Task 6 deviation)
      if ((c?.generated !== true) && !generated.has(key)) {
        pendingGen.push([cx, cz]);
      } else if (Math.abs(dx) <= r && Math.abs(dz) <= r && c) {
        // B6 Task 3：光照佇列與 mesh **同一個 ring**，且各自獨立收集——同一塊
        // 可以同時待重光＋待重網格。若用 else-if 串接，同時髒的區塊只會進
        // 網格佇列，而網格迴圈的守門（!lightDirty，見 processQueues）會永遠
        // 等不到重光 → 死鎖不渲染。
        if (c.lightDirty) {
          pendingLight.push([cx, cz]);
        }
        if (c.dirty) pendingMesh.push([cx, cz]);
      }
    }
  }

  // 近→遠排序，優先載入腳下
  pendingGen.sort((a, b) => dist2(a, pcx, pcz) - dist2(b, pcx, pcz));
  pendingMesh.sort((a, b) => dist2(a, pcx, pcz) - dist2(b, pcx, pcz));
  // 光照佇列同樣近→遠（2026-10-20 稽核修正）：原設計的 ring 掃描順序會讓遠處
  // 角落優先點亮、玩家附近最後才亮；依「區塊中心到玩家的距離平方」排序後，
  // 玩家周圍先亮，其餘在後續幀以**每幀 1 塊**（A8：單塊重算）的預算補齊。
  // B6 Task 8：排序判斷抽成純函式（回傳新陣列）→ 重建佇列。
  pendingLight = sortLightQueueByDistance(pendingLight, pcx, pcz);

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
  // B4 Task 15：worker 降級後的退路——每幀同步生成至多 2 塊（舊碼的
  // `drainPendingSync` 在降級當下一次排空整個佇列＝一次大凍結）。降級後
  // `terrain.request()` 不再發給 worker，全部由這裡逐幀 settle。
  terrain.drainFallback(2);
  let budgetGen = 2;
  // A8（0.10.1 審查）：每幀只重算 **1 塊**（`computeChunkLightOnly`，~5–8 ms）。
  // 舊版一項就同步重算整個 3×3 群組（~48 ms，審查實測 52.6 ms）＝每挖／放
  // 一格主執行緒停 3 幀以上。分幀後一次編輯標髒的 9 塊最多 9 幀收斂；佇列
  // 近→遠排序 → 編輯當幀先算玩家附近那一塊（腳下立刻正確），其餘鄰塊逐幀補。
  // 收斂性（新增光由後續塊補、移除光不留幽靈）見 computeChunkLightOnly 的說明。
  const budgetLight = 1;
  let budgetMesh = 2;
  // B6 Task 3：先跑光照預算，再跑網格預算——lightDirty 尚未清除的區塊不能
  // 建網格（會用 0 光烘焙出全黑 mesh）。
  // B6 Task 8：「單幀最多取幾項」的判斷抽成純函式（takeLightBudget，單元釘死）。
  const lightBatch = takeLightBudget(pendingLight, budgetLight);
  pendingLight.splice(0, lightBatch.length);
  for (const [cx, cz] of lightBatch) {
    const c = world.getChunk(cx, cz);
    if (c?.lightDirty) {
      computeChunkLightOnly(world, cx, cz); // 收尾會把 lightDirty 清掉（lighting.ts）
    }
  }
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
      // B6 Task 3 生成接線（與 spawnPoint 的同步生成分支同一套）：
      //  - 地形是整塊寫入（data.set / new Chunk(data)、不經 setBlock）→
      //    `topY` 不會被 setBlock 的維護推進 → 這裡自己掃一次（放在 reapply
      //    之後：玩家編輯經 setBlock 也會推 topY，這裡重掃冪等）。
      //  - `markLightDirty`（本區塊＋存在的八鄰）：新地形可能擋掉／改變鄰塊
      //    既有的光，鄰塊也要重算才一致；本區塊則由光照佇列在後續幀點亮。
      //    （reapply 的 setBlock 本身也會標記——這裡的標記是冪等的，且在
      //    「沒有任何編輯」的常規路徑上是唯一的標記點。）
      const relit = world.getChunk(cx, cz);
      if (relit) {
        relit.topY = computeChunkTopY(relit);
        markLightDirty(world, cx, cz);
      }
    }).catch(() => genInFlight.delete(key));
    budgetGen--;
  }
  // A8：預算維持 2 塊，但**先挑已光照就緒的**——分幀後佇列頭可能還在等光
  // （lightDirty 未清），後面的塊已經可以建網格；照舊只看隊頭會讓 mesh 白等
  // （編輯那塊的網格也會多延一幀才更新）。找不到就緒的就整批留給下一幀的
  // refreshQueues（不 shift 丟掉——下一幀重收時位置與排序可能已不同）。
  while (budgetMesh > 0 && pendingMesh.length > 0) {
    const readyAt = pendingMesh.findIndex(([cx, cz]) => {
      const c = world.getChunk(cx, cz);
      // B6 Task 3：`!c.lightDirty` 守門——先有光再網格（光照預算在上面已先跑，
      // 同一幀內剛重算完的區塊可以立刻建網格）。
      return c?.dirty === true && !c.lightDirty && neighborsReady(cx, cz);
    });
    if (readyAt === -1) break;
    const [cx, cz] = pendingMesh.splice(readyAt, 1)[0];
    chunkRenderer.rebuild(world, cx, cz);
    world.getChunk(cx, cz)!.dirty = false;
    budgetMesh--;
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
    // B4 Task 9：離開 playing → **收掉進度條的 DOM 節點**。進度條平常是靠
    // playing 分支裡每幀的 `hide()` 收掉的；離開後那個分支不再跑 → 節點會留在
    // 畫面上（一條不會再動的進度條，掛在暫停選單／死亡畫面／標題底下）。
    // 同時歸零進度（回來要重新按住 → 從零開始累積）。
    eatProgressUi.hide();
    eatProgress.reset();
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
    // B1.4: the 新遊戲 overwrite confirm reads the SAME derived state as the
    // button, so they can never disagree (both call titleSaveStateNow()).
    // A1: the button state is tri-state while the boot check runs (Continue
    // disabled until the answer is final).
    // 修復波 review CR-1：**推導、不快取**——場中存檔會改變 savedPayload，
    // 快取會讓這裡顯示過期的 'no'（見 titleSaveStateNow 的說明）。
    const saveState = titleSaveStateNow();
    menus.showTitle({
      saveState,
      statusText: newGameWaiting
        ? '檢查進度中…'
        : saveState === 'pending'
          ? '正在檢查雲端進度…'
          : undefined,
      onContinue: handleContinue,
      // B1.4: 新遊戲 discards the session that 繼續遊戲 offers — an entry
      // (local or boot-applied cloud) must be confirmed first. 取消 returns to
      // the title (save untouched); with no entry it stays the one-click start.
      // A1: while the check is pending the click waits for the settle (a
      // cloud-only entry must be warned about too) — see handleNewGame.
      onNewGame: handleNewGame,
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
      // B9（審查）：「回到標題」是**不存檔**離開，卻和「儲存並離開」並排 → 誤按
      // 即丟掉最多一個 autosave 間隔（30 秒）的進度。離開前先跳二次確認（確認框
      // 由 ui/menus.ts 組裝；取消 → 回到暫停選單）。死亡畫面的離開**不**確認
      // （已無進度可救，維持現狀）。
      onQuit: () => confirmQuitToTitle(menus, quitToTitle, () => setState('paused')),
      // Task 14 save point (a): 儲存並離開 — snapshot the live session FIRST,
      // save, then quit (both callbacks are separate buttons; the death
      // screen's quit below deliberately has neither — see handleQuitToTitle).
      onSaveQuit: handleSaveQuit,
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
    // B5 Task 8：面板已重構成 36 格（27 主背包＋9 熱鍵列）。slots 是活的模型
    // 陣列（UI 只讀）：所有變動走 options 的 callbacks 寫回，並即時刷新 HUD。
    inv.open(
      slots,
      selected,
      (slot, stack) => {
        inventory.setSlot(slot, stack);
        hud.setHotbar(slots, selected);
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
      // B1.2: survival 走純 36 格面板（無免費清單）；creative 另有全物品清單。
      currentMode,
      {
        // 面板不持有任何副本：槽位變動一律寫回 inventory model＋刷新 HUD。
        onSlotChange: (index, stack) => {
          inventory.setSlot(index, stack);
          hud.setHotbar(slots, selected);
        },
        // 關閉面板 → 把游標上的堆疊交回背包；回傳放不下的餘量（null ＝ 全部
        // 放回了）。背包滿時餘量留在 UI 上，下次開面板還看得到（不再憑空消失）。
        // B7 R6：游標上的堆疊帶著 `dur` 原樣交回（受損工具不會在關面板時復活）。
        onReturnCursor: (stack) => {
          const overflow = giveItem(stack.item, stack.count, stack.dur);
          hud.setHotbar(slots, selected);
          // B7 R6：放不下而留在游標上的餘量也要帶著 `dur`（下次開面板再放下
          // 才不會洗白；工具堆疊 1 → 餘量必是整把）。
          return overflow > 0
            ? { item: stack.item, count: overflow, ...(stack.dur !== undefined ? { dur: stack.dur } : {}) }
            : null;
        },
      },
    );
  } else if (next === 'crafting') {
    // Task 11: right-click on a placed crafting table → standalone 3×3 overlay.
    // Reachable in survival only: the sole entry point is the gated place-path
    // above (creative: crafting hidden, plan 12.4).
    resetCraftGrid(3);
    craftUi.open({
      ...craftingParams(3),
      // 工作台 3×3 面板裡沒有背包網格 → 來源列要能取到主背包：整包 36 格當
      // 來源（預設 9 只看得到熱鍵列，主背包的東西就取不到了）。
      sourceCount: INVENTORY_SLOTS,
      onClose: () => {
        setState('playing');
        relockCanvas();
      },
    });
  } else if (next === 'furnace') {
    // Task 6: right-click on a placed furnace → standalone panel over the
    // block's live state (both modes; the entry is created on open).
    if (openFurnaceKey) {
      const entity = blockEntities.get(openFurnaceKey);
      if (entity && entity.kind === 'furnace') furnaceUi.open(entityToFurnaceState(entity));
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

/** 把「目前模式」的 live 槽位與血量寫回 `modeStash`——**與切換模式時同一個
 *  動作**（同一個 `saveModeState`，見 mode-changed 的處理）。
 *
 *  為什麼存檔前要再同步一次：`modeStash` 是**快照**語意，它只在切模式的那一刻
 *  記下當時的狀態。之後 live 槽位可能早就變了——工具被用到壞掉（整格變 null）、
 *  被丟棄、被合成吃料——而存檔寫出去的是那份舊快照 → 壞掉的工具留在快照裡，
 *  下次載入（`normalizeModeStash` 會把它撿回來）或切模式往返後就**復活**。
 *  所以組 payload 之前用 live 槽位覆寫「目前模式」那一側；另一側（沒在玩的
 *  那個模式）本來就只能靠快照，維持不動。
 *
 *  ★ **兩條存檔路徑都要呼叫**：
 *  - 本機：`sessionSavePayload()`（`persistNow`／autosave／visibilitychange／
 *    Save & Quit 全都經過它）；
 *  - 雲端檢查點：`saveCloudNow()`——它**不經過** `collectSavePayload`，直接呼叫
 *    `buildCloudData`，所以要自己同步；漏了它，雲端檢查點寫出的仍是舊快照，
 *    下次讀雲端時壞掉的工具照樣復活（雲端才是跨裝置的主要進度）。
 *  純記憶體操作（`saveModeState` 回傳新 stash、逐格深拷貝）→ 不碰 IDB／DOM。 */
function syncModeStash(): void {
  modeStash = saveModeState(modeStash, currentMode, slots, vitals);
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
 *    overflow, nothing is destroyed). A4: the flush is **unconditional** —
 *    skipping it while a panel is open would LOSE the staged materials
 *    (the grid is not part of the payload); the flush empties the grid IN
 *    PLACE, so the open panel keeps working on the same array. */
function sessionSavePayload(): SavePayload | null {
  // A4: **無條件**先把舞台材料沖刷回背包再快照——合成格只活在 `craftGrid`
  // 裡、**不在 payload 裡**；面板開著時的存檔（alt-tab 的 visibilitychange
  // 會觸發）若跳過沖刷，那些材料就**掉料**了（審查 A4 ③）。
  // 沖刷是**原地**的（`craftGrid` 陣列本身不換），所以開著的面板仍然寫得到
  // 它（`resetCraftGrid` 順便重繪它）。大小跟著開著的面板走：工作台 3×3、
  // 背包內嵌 2×2、沒開面板 2×2。
  resetCraftGrid(craftUi.isOpen() ? 3 : 2);
  if (vitals && vitals.hp <= 0) return null; // dead — see doc above
  // B7 Task 2：存檔前用 live 槽位覆寫「目前模式」的 stash 快照（見 syncModeStash）。
  // **必須在 resetCraftGrid 之後**：那一步才把合成格裡的材料交還 inventory，
  // 槽位是活的參照 → 先同步的話快照會少了剛交還的那些堆疊。
  syncModeStash();
  return collectSavePayload({
    world: { seed: settings.seed, serializeModified: () => world.serializeModified() },
    player: {
      pos: [player.position.x, player.position.y, player.position.z],
      yaw: player.yaw,
      mode: currentMode,
      inventory: [...slots],
    },
    vitals,
    clockT: clock.t,
    advancements,
    stash: modeStash, // B1.3: the other mode's slots + survival vitals
    passiveMobs, // B4 Task 10: 被動生物（種類／座標／血量／朝向）跨存檔
    blockEntities: [...blockEntities.values()], // B8 Task 4: 箱子內容＋熔爐狀態
  });
}

/** 「儲存並離開」（Task 14 save point (a)）：先快照場上狀態、存檔，成功才退出。
 *  失敗時**不退出**（A3 → `onSaveQuitFailed`）。 */
function handleSaveQuit(): void {
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
    // A3: a failed 儲存並離開 must NOT quit silently — the player would
    // believe the session was saved. Stay in the pause menu (they can
    // press 儲存並離開 again) and say so.
    onSaveQuitFailed,
  );
}

/** 「儲存並離開」失敗（A3）：**不得**退出到標題——玩家會以為存好了，其實
 *  沒有。留在暫停選單（畫面沒有消失，玩家可以再按一次）＋ 明確告知。 */
function onSaveQuitFailed(): void {
  const policy = saveFailurePolicy('save-quit');
  toasts.push({ title: policy.title, description: policy.description, icon: 'chest' });
  setState('paused');
}

/** Fire-and-forget save of the current session (Task 14): the payload is
 *  snapshotted synchronously (state can't drift mid-save); a success caches
 *  it for the title's Continue button. A rejection is NO LONGER silent (A3):
 *  the player gets a toast and the save is retried once after a delay (the
 *  main loop's `localSaveRetryDue` check) — an invisible failed save is how
 *  progress silently disappears. */
function persistNow(): void {
  const payload = sessionSavePayload(); // snapshot once — save + cache are identical
  if (!payload) return; // nothing honest to save (review #6: dead session)
  void saveGame(payload)
    .then(() => {
      savedPayload = payload;
      localSaveRetryDue = 0; // a success cancels any pending retry
      localSaveFailureNotified = false;
    })
    .catch(() => {
      // A3: surface the failure (once per failure streak) and schedule a retry.
      const policy = saveFailurePolicy('autosave');
      if (!localSaveFailureNotified) {
        localSaveFailureNotified = true;
        toasts.push({ title: policy.title, description: policy.description, icon: 'chest' });
      }
      localSaveRetryDue = Date.now() + policy.retryInMs;
      /* savedPayload keeps its previous value — it stays honest */
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
  // A4（邊界）：UI 擁有的狀態（游標／舞台材料）不得活到雲端進度套用之後——
  // 雲端背包是另一份資料，本機的游標餘量若混進去就是複製。舞台材料交還
  // **套用前**的背包；放不下的餘量隨本機那一場次丟棄（雲端套用會換掉整個
  // 世界，丟在腳邊也會被 `resetWorld()` 清掉）。
  resetUiOwnedState();
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
  terrain.onDegrade = onTerrainDegrade; // B4 Task 15：重建也要接回單次提示
  resetWorld();
  // B8 Task 5：塊實體——`resetWorld()` 剛清空，這裡從雲端 payload 還原。
  // **已知限制**：雲端 payload 不帶 voxel 編輯 → 座標可能對應不到世界裡的
  // 箱子／熔爐（內容不會消失，只是暫時不可達；發布說明會揭露）。
  blockEntities.clear();
  for (const e of data.blockEntities ?? []) {
    blockEntities.set(blockEntityKey(e.x, e.y, e.z), e);
  }
  resetSessionEntities(); // entities are never persisted — drop stale ones
  // B4 Task 10：被動生物**是**會存檔的（附加欄位 `passiveMobs`）→ 清掉舊的之後
  // 從雲端進度還原。舊的 format-1 payload 沒有這個欄位 → 空陣列（沒有生物）。
  // B5 Task 7b：世界生成版本不同（地形已改）→ 舊座標不可信 → **不還原**動物
  // （與敵對生物「每場重來」一致）；同版本才照常還原。
  // `restorePassiveMobs` 會把暫態的 `vel`／`kbVel` 補成零（否則下一幀 TypeError）。
  passiveMobs = restorePassiveMobs(
    passiveMobsForLoad(data.passiveMobs, needsWorldgenNotice(data.worldgenVersion)),
  );
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
  // inventory width and drops junk ENTRY by entry (never the whole inventory) —
  // then setSlot floors + clamps counts to maxStack.
  const restoredSlots = sanitizeSlots(data.inventory, slots.length);
  for (let i = 0; i < slots.length; i++) inventory.setSlot(i, restoredSlots[i]);
  hud.setHotbar(slots, selected);
  setVitals(
    currentMode === 'survival'
      ? data.vitals
        ? { ...data.vitals }
        : createVitals()
      : null,
  );
  // B1.3: restore the per-mode stash that travelled with the payload (the
  // other mode's slots + survival vitals). acceptCloudData always hands one
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
  // B3 Task 8：雲端進度若是**舊存檔**（`worldgenVersion` 缺漏或 ≠ 當前版本）
  // → **只記下**「玩家進場時要跳一次『地形已改變』的 toast」，**不在這裡跳**。
  // 為什麼不跳：這個函式在**開機時**就跑完了（早於標題畫面 render）→ 那時跳的
  // toast 疊在標題畫面上、4 秒後消失，玩家進遊戲後可能永遠看不到；計畫 §8 的
  // 語意是「**進遊戲的同時**跳一次 toast」→ 提示改在 `continueFromCloud` 進場
  // 時跳（見 flushWorldgenNotice）。
  // 這裡也**不**急著把新版本寫回雲端：下一次 checkpoint 送出時自然會帶上當前的
  // `WORLDGEN_VERSION`（`buildCloudData` 是唯一蓋值的地方）。
  armWorldgenNotice(data.worldgenVersion);
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
    if (!shouldAllowSave({ revision: cloudSession.revision })) return;
    if (cloudSession.revision === null || cloudSession.locked || cloudSession.authStopped) {
      return;
    }
    // B7 Task 2：雲端檢查點走的是 `buildCloudData`（**不經過** `collectSavePayload`）
    // → 這裡要自己同步一次，否則送出的 stash 仍是切模式時的舊快照（含已壞掉的
    // 工具），下次讀雲端就把它撿回來。與本機路徑共用同一個 `syncModeStash`。
    syncModeStash();
    const data = buildCloudData({
      seed: settings.seed,
      pos: [player.position.x, player.position.y, player.position.z],
      yaw: player.yaw,
      vitals: vitals ? { ...vitals } : null,
      clockT: clock.t,
      inventory: [...slots],
      advancements,
      settings,
      stash: modeStash,
      passiveMobs, // B4 Task 10: 被動生物隨雲端進度一起旅行
      blockEntities: [...blockEntities.values()], // B8 Task 5: 箱子內容＋熔爐狀態
    });
    if (byteSizeOf(data) > CLOUD_MAX_BYTES) {
      pushCloudToast('雲端空間不足，僅本機存檔');
      return;
    }
    // C1：若還有一個未確認的快照，這裡**重送那個快照**（同一 requestId），
    // 絕不換新的資料／新的 ID —— 回應遺失時平台要求沿用原 ID。
    await runCloudSend(() => cloudSession.checkpoint(data));
  } catch {
    /* best-effort: local snapshot failures must not break gameplay (the
       cloud.save throw is classified inside the session, not here) */
  }
}

/** Run one send and handle what the session cannot own: the conflict flow
 *  (the session only classifies the error) and the user-facing toasts. */
async function runCloudSend(send: () => Promise<void>): Promise<void> {
  await send();
  const kind = cloudSession.failureKind;
  if (kind === 'CONFLICT') {
    await resolveCloudConflict();
    return;
  }
  if (kind === 'FORMAT') {
    pushCloudToast('雲端格式不相容，僅本機存檔');
  } else if (kind === 'REQUEST_REUSED') {
    pushCloudToast('雲端同步失敗，僅本機存檔');
  } else if (kind === 'AUTH') {
    pushCloudToast('請重新登入');
  }
}

/** Resend the pending snapshot with its frozen requestId. */
async function sendPendingCloud(): Promise<void> {
  await runCloudSend(() => cloudSession.retry());
}

/** Re-render the pause menu after a conflict decision — unless a NEW conflict
 *  dialog is up (a resolution send that 409'd again), which must stay mounted. */
function rerenderPauseUnlessConflict(): void {
  if (state === 'paused' && !cloudSession.conflict) setState('paused');
}

/** The conflict choice is modal: a checkpoint that lands mid-play must not
 *  fight pointer lock, so leave the running session first. Releasing the lock
 *  also pauses (its listener does that); the explicit `setState` covers the
 *  case where the lock was already gone. */
function enterModalChoiceState(): void {
  if (state === 'playing') {
    document.exitPointerLock?.();
    if (state === 'playing') setState('paused');
  }
}

/** CONFLICT tail (C1): re-read the slot, validate it, then **ASK THE PLAYER**.
 *
 *  The upstream contract is explicit — a 409 means another device moved the
 *  slot and the player decides what happens next. The old behavior applied the
 *  remote payload on the spot (silently discarding the live session's
 *  progress); now nothing is applied, nothing is sent and no revision is
 *  adopted until one of the three choices fires. While the choice is pending
 *  the session refuses every write, so a stray autosave cannot overwrite the
 *  slot either way.
 *
 *  An unreadable reload keeps the local snapshot and offers 重試 (a later
 *  retry re-conflicts and asks again); a format mismatch locks instead of
 *  retrying forever. Total. */
async function resolveCloudConflict(): Promise<void> {
  try {
    const fresh = await cloud.load();
    // B5 Task 9：格式檢查改「可讀格式集合」——format 1／2 的舊資料照常套用
    // （`acceptCloudData` 已完成 9→36 遷移與 `dur` materialize；熱鍵列保留舊
    // 物品、其餘 27 格留空），下一次檢查點就會以 format 3 覆寫（升級路徑）。
    // 只有**集合外**的格式才鎖。
    if (fresh && !isReadableCloudFormat(fresh.formatVersion)) {
      cloudSession.lock('FORMAT');
      pushCloudToast('雲端格式不相容，僅本機存檔');
      return;
    }
    const accepted = fresh ? acceptCloudData(fresh.data) : null;
    if (!fresh || !accepted) {
      cloudSession.markReadFailure();
      return;
    }
    cloudSession.setConflict({ data: accepted, revision: fresh.revision });
    enterModalChoiceState();
    pushCloudToast('雲端有其他裝置的進度，請選擇處理方式');
    menus.showConflictChoice({
      message: '雲端有其他裝置的進度，要保留本機、採用雲端，還是合併？',
      onKeepLocal: () => {
        // 在**遠端 revision** 上重送本機快照（新 requestId）→ 本機進度勝出。
        void runCloudSend(() => cloudSession.resolveConflict('keep-local')).finally(
          rerenderPauseUnlessConflict,
        );
      },
      onTakeCloud: () => {
        // 採用遠端：session 收下遠端 revision、丟棄本機快照；這裡把資料就
        // 地套用到進行中的世界（玩家自己選的，才會有覆蓋）。
        void (async () => {
          await cloudSession.resolveConflict('take-cloud');
          // 修復波 review CR-2：對話框也可能**疊在標題畫面上**（儲存並離開的檢
          // 查點撞 409 → 標題已掛、玩家還沒進場）。那時候套用等同「開機套用過的
          // 雲端進度」→ 記號必須補上，否則標題的「繼續遊戲」會走本機分支、用舊的
          // savedPayload 蓋掉剛採用的遠端進度（下一次檢查點再把遠端較新的資料
          // 蓋掉）——玩家選了「採用雲端」卻得到相反結果，正是 C1 要消滅的。
          const onTitle = state === 'title' && !sessionStarted;
          applyCloudData(accepted);
          if (onTitle) {
            cloudAppliedAtBoot = true;
            setState('title'); // 重繪標題：繼續遊戲改走 continueFromCloud()
          } else {
            // B3 Task 8：這裡是**場中**套用（玩家已經在遊戲裡，看得到 toast）→
            // 舊的雲端進度就地告知一次。`applyCloudData` 本身只排隊不跳。
            // （標題上的套用**不**在此跳：與開機套用同一條規則——進場時才 flush，
            // 否則 toast 疊在標題畫面上、玩家進遊戲後看不到。）
            flushWorldgenNotice();
          }
          pushCloudToast('已採用雲端進度');
          rerenderPauseUnlessConflict();
        })();
      },
      onMerge: () => {
        // 以本機為基底＋雲端獨有物品＋成就聯集，在遠端 revision 上送出。
        void runCloudSend(() => cloudSession.resolveConflict('merge')).finally(
          rerenderPauseUnlessConflict,
        );
      },
    });
  } catch {
    cloudSession.markReadFailure();
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
      cloudSession.setRevision(0);
      cloudSession.clearReadFailure();
      return;
    }
    // B5 Task 9：同 resolveCloudConflict——「可讀格式集合」取代單一版本比較。
    if (!isReadableCloudFormat(res.formatVersion)) {
      cloudSession.lock('FORMAT');
      return;
    }
    const accepted = acceptCloudData(res.data);
    if (!accepted) {
      cloudSession.markReadFailure();
      // revision stays null — unreadable payload = still an unread slot (a
      // later retry may succeed if another device rewrites it validly).
      return;
    }
    cloudSession.setRevision(res.revision);
    cloudSession.clearReadFailure();
  } catch {
    cloudSession.markReadFailure();
  }
}

/** Pause-menu 重試: resend the kept snapshot (same requestId), or a fresh
 *  checkpoint when there is none (post-conflict row). Drops when a send is
 *  already in flight; re-renders the pause row if still paused so the retry
 *  gives immediate feedback. Minor 1: when the boot read never landed
 *  (revision null, not locked/stopped) the retry is a LOAD-ONLY re-read —
 *  never a mid-session apply. */
function retryCloudNow(): void {
  if (cloudSession.busy) return;
  if (cloudSession.revision === null && !cloudSession.locked && !cloudSession.authStopped) {
    void retryCloudRead().finally(() => {
      if (state === 'paused') setState('paused');
    });
    return;
  }
  const done = cloudSession.pending ? sendPendingCloud() : saveCloudNow('retry');
  void done.finally(() => {
    if (state === 'paused') setState('paused');
  });
}

/** Snapshot the pause menu's cloud opts (Phase 4 Task 4): the row comes from
 *  the pure `cloudRowState(session, clientStatus)` (A2) — an unconfirmed save
 *  reads 尚未同步 (syncing) with a 重試 button; a thrown NETWORK failure reads
 *  同步失敗 (error); a locked REQUEST_REUSED stays an error WITHOUT the button
 *  (Ruling D). The session owns the flags, the client owns the connection. */
function cloudPauseOpts(): {
  cloudStatus: CloudStatus;
  cloudRetryable: boolean;
  onRetryCloud: () => void;
} {
  const row = cloudRowState(cloudSession, cloud.status);
  return { cloudStatus: row.status, cloudRetryable: row.retryable, onRetryCloud: retryCloudNow };
}

/** Shared quit-to-title tail (pause 回到標題 / 儲存並離開 / death quit): ends
 *  the session (beforeunload stops saving) and resets the player — the title
 *  orbit queues key off player.position, so leaving it far away would orbit a
 *  one-chunk island (Task 17 CR fix). No save happens here — saving is the
 *  explicit job of 儲存並離開 / autosave / beforeunload (Task 14 settled).
 *
 *  A4: 這是 session 邊界之一——UI 擁有的狀態（游標／舞台材料）不得活到下一
 *  場次。世界還在（回到標題不換世界），所以放不下的餘量丟在玩家腳邊（玩家
 *  還在這一頁裡，撿得回來）；舞台材料交還背包。 */
function quitToTitle(): void {
  audio.stopAmbience(); // Phase 3 Task 10: kill the wind bed + chirp/cricket timer
  sessionStarted = false;
  resetUiOwnedState(dropAtPlayer); // A4：邊界先清 UI 狀態（再重置玩家位置）
  resetPlayerToSpawn();
  // B2.1：標題畫面的環繞相機也用同一台相機 → 疾跑 FOV 必須在離開遊戲時
  // 歸零（否則標題畫面會停在 77° 的疾跑視野）。
  resetSprintAndFov();
  setState('title');
}

/** Drop the live entities (review #4): mobs, passive mobs, ground drops and
 * arrows are NOT persisted (plan: they respawn naturally), so a session
 * restart must never inherit the previous session's. Called by resetWorld
 * (New Game) and continueGame (stale in-page predecessors). No
 * mobs-changed/drops-changed emit — nothing on the bus consumes them yet.
 *
 * **B4 Task 10 的例外**：被動生物**是**會存檔的（附加欄位 `passiveMobs`）→
 * 這裡清空之後，由 `continueGame`／`applyCloudData` 從存檔／雲端進度**還原**
 * （見那兩個函式裡的 `restorePassiveMobs`）。**新遊戲**（`startGame` →
 * `resetWorld` → 這裡）則是真的清空（沒有存檔可還原）。 */
function resetSessionEntities(): void {
  mobs = [];
  passiveMobs = []; // B4 Task 10：清空後由 continueGame／applyCloudData 從存檔還原
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
  pendingLight.length = 0; // B6 Task 3：光照佇列與其他佇列同樣不跨世界沿用
  resetSessionEntities();
  // B8 Task 6：新世界的塊實體歸零（箱子／熔爐都不跨世界；不再有「熔爐進度已
  // 重置」的 toast——熔爐進度現在會存檔，只有真的開新局才清）。
  blockEntities.clear();
  hazardState = createHazardState(); // B3 Task 6: 仙人掌的接觸計時不跨世界沿用
  eatProgress.reset(); // B4 Task 9: 進食進度不跨局沿用（重新按住要從零開始）
}

function startGame(): void {
  // B5 Task 8（防禦）＋ A4（邊界）：關掉可能還開著的面板 → 游標堆疊交回**舊**
  // 背包（在新遊戲清空背包之前），才不會把舊游標灌進新局；close 是冪等的。
  // A4：這同時清掉合成格（舞台材料交還**舊**背包），新局不會繼承它。
  // 沒有 sink → 放不下的餘量隨舊場次一起丟棄（新局本來就換掉整個世界，
  // 丟在腳邊也會被 `resetWorld()` 一起清掉；丟進**新**世界才是洩漏）。
  resetUiOwnedState();
  resetWorld(); // review #4: New Game starts from a fresh world, not the boot one
  modeStash = createModeStash(); // B1.3: fresh per-mode state for the fresh session
  // Plan 14.3 "new → fresh state" for everything the world reset can't see.
  // Task 17.5 Critical (verified live; B5 Task 7 widened the inventory to 36):
  // inheriting the previous session's inventory deadlocks a fresh survival game
  // — fits() counts slack only from empty slots / partial stacks of the same
  // item, and a full inventory of unrelated 64/64 stacks has ZERO: mined drops
  // can't be picked up (addItem overflows → pickup rejected) and craft results
  // can't be taken (craftingParams.onTake pre-checks fits() → blocked forever).
  // Vitals/clock carried stale values the same way (quit at hp 6/20 → new game
  // at 6/20; quit at night → new game at night), and staged craftGrid/craftExcess
  // items would flush into the NEW session's inventory on its first inventory open.
  const fresh = loadModeSlots(modeStash, currentMode);
  for (let i = 0; i < slots.length; i++) inventory.setSlot(i, fresh[i] ?? null);
  selected = 0;
  hud.setHotbar(slots, selected);
  setVitals(currentMode === 'survival' ? { ...modeStash.survivalVitals } : null);
  clock = createClock(settings.dayLengthSec);
  // Phase 3 Task 10: arm the engine (this click IS the gesture), start the wind
  // bed and pin the ambience phase to the fresh clock (day).
  audio.ensureStarted();
  audio.startAmbience();
  audio.setPhase(phaseOf(clock.t));
  // A4: the crafting grid is already empty (resetUiOwnedState flushed it into
  // the OLD inventory above) — the new session starts with an empty grid.
  advancements = emptyAdvancements(); // Task 11: New Game → fresh progress
  deathCause = null; // Task 13: explicit (resetPlayerToSpawn below also nulls it)
  hazardState = createHazardState(); // B3 Task 6: 新局 → 仙人掌計時歸零
  resetSprintAndFov(); // B2.1: fresh sprint latch + FOV back to 70
  resetViewMode(); // B2.4: 新局 → 視角回到第一人稱（不帶上一局的第三身姿態）
  cloudAppliedAtBoot = false; // Ruling I: a fresh game replaces any boot-applied cloud state
  // B3 Task 8：新遊戲沒有「舊地形」→ 不提示；開機時排隊的雲端提示也一併作廢
  // （新遊戲丟掉了那份雲端進度，告知它沒有意義）。
  beginNoticeSession();
  worldgenNoticePending = false;
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
  // B5 Task 8（防禦）＋ A4（邊界）：同 startGame —— 先把可能留著的游標堆疊交回
  // **還原前**的背包，再覆寫進度（否則舊游標會在還原後的第一個面板互動被灌進
  // 新進度＝複製）。A4：合成格也一併清掉（舞台材料交還**還原前**的背包，
  // 放不下的餘量隨舊場次丟棄——不得活到還原後的新場次）。
  resetUiOwnedState();
  world.applyModified(payload.modified); // 1. world edits (see doc above)
  // B8 Task 4：塊實體（箱子內容與熔爐狀態）——清掉本頁先前的 session，再從
  // 存檔還原。`payload.blockEntities` 已被 `loadGame` 正規化過（27 格、合法
  // item id、座標合法、座標去重）。
  blockEntities.clear();
  for (const e of payload.blockEntities) {
    blockEntities.set(blockEntityKey(e.x, e.y, e.z), e);
  }
  // Review #4: entities are never persisted — drop any stale in-page session's
  // mobs/drops/arrows so Continue doesn't inherit them. Chunks + modified are
  // deliberately NOT cleared here: Continue applies onto the existing world.
  resetSessionEntities();
  // B4 Task 10：被動生物**是**會存檔的（附加欄位 `passiveMobs`）→ 清掉舊的之後
  // 從存檔還原。舊的 v3 記錄沒有這個欄位 → 空陣列（沒有生物，不報錯）。
  // B5 Task 7b：世界生成版本不同（地形已改）→ 舊座標不可信 → **不還原**動物
  // （與敵對生物「每場重來」一致；動物之後白天仍會自然重生，全場上限 12）；
  // 同版本才照常還原。payload v3→v4 遷移仍保留 `passiveMobs` 欄位（資料層）。
  // `restorePassiveMobs` 會把暫態的 `vel`／`kbVel` 補成零（否則下一幀 TypeError）。
  passiveMobs = restorePassiveMobs(
    passiveMobsForLoad(payload.passiveMobs, needsWorldgenNotice(payload.worldgenVersion)),
  );

  const [px, py, pz] = payload.player.pos;
  player = createPlayer(px, py, pz);
  player.yaw = payload.player.yaw;
  // Session-scoped resets, mirroring resetPlayerToSpawn (a stale fall apex or
  // carried attack cooldown must not leak into the restored session).
  fallState = resetFall();
  attackCd = 0;
  deathCause = null; // Task 13: Continue restores a living player — no death cause
  hazardState = createHazardState(); // B3 Task 6: 讀檔進場 → 仙人掌計時歸零

  currentMode = payload.player.mode; // 3. mode
  input.setFlyEnabled(currentMode === 'creative'); // survival save → stay grounded
  settings.mode = currentMode;
  saveSettings({ mode: currentMode }); // keep menu labels in sync
  inventory.setMode(currentMode);
  // B1.3: restore the per-mode stash that travelled with the payload — the
  // OTHER mode's inventory and the survival vitals survive a quit/reload. The
  // LIVE inventory below comes from `player.inventory`, never from the stash's
  // side for the mode being entered: that side is only refreshed when the mode
  // is LEFT, so it can legitimately be older than the live slots (the save-first
  // order in the mode-changed handler is what keeps the pair sound). For v1/v2
  // records, normalizeModeStash derives both sides.
  modeStash = normalizeModeStash(payload.stash, {
    mode: payload.player.mode,
    inventory: payload.player.inventory,
    vitals: payload.player.vitals,
  });
  // The record's inventory is untrusted even after shape validation (unknown
  // ids, junk counts, any length): sanitizeSlots pads/truncates to the live
  // inventory width and drops junk rather than writing it into the model.
  const restoredSlots = sanitizeSlots(payload.player.inventory, slots.length);
  for (let i = 0; i < slots.length; i++) {
    const s = restoredSlots[i];
    inventory.setSlot(i, s ? { ...s } : null); // setSlot copies + validates; clears the tail
  }
  hud.setHotbar(slots, selected);
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
  resetViewMode(); // B2.4: 讀檔 → 視角回到第一人稱（視角不進存檔）
  // Phase 3 Task 10: arm + start audio for the restored session (the Continue
  // click IS the gesture); ambience follows the restored time-of-day.
  audio.ensureStarted();
  audio.startAmbience();
  audio.setPhase(phaseOf(clock.t));

  cloudAppliedAtBoot = false; // Ruling I: this local payload is the session now
  beginNoticeSession(); // B3 Task 8: 新的 play session → 「只提示一次」的記號歸零
  sessionStarted = true;

  // B3 Task 8：舊存檔（`worldgenVersion` 缺漏或 ≠ 當前版本）→ 進遊戲時跳一次
  // 「地形已改變」的**非模態 toast**（右上角、自動消失），並**立刻**把新版本
  // 寫回本機存檔 → 下次載入不再提示（一次性）。
  //
  // 三個要分清楚的地方：
  // 1) **不是** B1.4 的 `menus.showConfirm` 模態確認框（那是標題畫面、防止誤
  //    覆蓋進度用的）——這裡是進遊戲後的 toast，兩條路徑互不干擾。
  // 2) 寫回的是「**現在這個 session 的 payload**」（還原後的現況），
  //    **不是**把欄位補到「讀到的舊記錄」上——補到舊記錄上會掩蓋「它是舊存檔」
  //    這件事（Task 7 的讀取端刻意不補值）。
  // 3) 寫入失敗只吞掉：存檔是 best-effort，**不得**阻擋進遊戲（也不記未標記事故）。
  if (needsWorldgenNotice(payload.worldgenVersion)) {
    // 進場的這一刻跳（玩家看得到 toast）；同一個 session 只跳一次。
    if (!worldgenNoticeShown) {
      worldgenNoticeShown = true;
      pushWorldgenNotice(toasts);
    }
    // 寫回**不**受「有沒有跳過提示」影響：舊存檔一定要被蓋上新的版本戳記，
    // 否則每次進來都會再判一次「要不要提示」。
    const current = sessionSavePayload(); // 現況快照（還原後的 session）
    if (current) {
      const stamped: SavePayload = { ...current, worldgenVersion: WORLDGEN_VERSION };
      void saveGame(stamped).then(
        () => {
          savedPayload = stamped; // 標題畫面的「繼續遊戲」用這份新存檔
        },
        () => {
          /* 寫入失敗不阻擋進遊戲（存檔是 best-effort；下次存檔會再帶上版本） */
        },
      );
    }
  }

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
  beginNoticeSession(); // B3 Task 8: 新的 play session → 「只提示一次」的記號歸零
  resetSprintAndFov(); // B2.1: fresh sprint latch + FOV back to 70
  resetViewMode(); // B2.4: 進場 → 視角回到第一人稱
  hazardState = createHazardState(); // B3 Task 6: 進場 → 仙人掌計時歸零（與 continueGame 同一路徑）
  audio.ensureStarted();
  audio.startAmbience();
  audio.setPhase(phaseOf(clock.t));
  // B3 Task 8：**進場的這一刻**才跳「地形已改變」的**非模態 toast**（舊存檔才跳）。
  // 開機時的 `applyCloudData` 只排隊不跳（那時玩家還在標題畫面，看不到）。
  flushWorldgenNotice();
  sessionStarted = true;
  setState('playing');
  relockCanvas(); // the click is a user gesture → controls live
}

/** B1.4 overwrite guard for 新遊戲: an entry (local or boot-applied cloud) is
 *  discarded by a new game, so it must be confirmed first. */
function showNewGameConfirm(): void {
  menus.showConfirm({
    message: '將覆蓋現有進度。確定要開始新遊戲嗎？',
    onConfirm: startGame,
    onCancel: () => setState('title'),
  });
}

/** 新遊戲 (B1.4 + A1): an entry → confirm first; no entry → straight to the
 *  new game. While the boot check is still pending the overwrite answer is not
 *  final yet (the cloud may still produce an entry), so the click WAITS for
 *  the settle instead of guessing; the title shows 檢查進度中… meanwhile. */
function handleNewGame(): void {
  // 修復波 review CR-1：問**推導後**的三態（與按鈕顯示同一個來源）——快取會
  // 在場中存檔後過期，讓「有存檔」的新局不再跳 B1.4 的覆蓋確認。
  const st = titleSaveStateNow();
  if (st !== 'pending') {
    if (st === 'yes') showNewGameConfirm();
    else startGame();
    return;
  }
  if (savedPayload !== null) {
    // A LOCAL entry is already known — the warning does not depend on the
    // cloud's answer (either entry leads to the same confirm).
    showNewGameConfirm();
    return;
  }
  newGameWaiting = true;
  if (state === 'title') setState('title'); // immediate feedback: 檢查進度中…
  void bootSettled.then(() => {
    newGameWaiting = false;
    if (state !== 'title') return; // the player left the title meanwhile
    if (titleSaveStateNow() === 'yes') showNewGameConfirm();
    else startGame();
  });
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
  // B8 Task 6：重生不清熔爐 —— 死亡不該讓熔爐的內容消失（原版行為）。
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

hud.setHotbar(slots, selected);
// B2.1 唯讀 debug hook（Task 9）：**僅供 Playwright 驗收讀取**（Task 13）——
// 全部是 getter，唯讀、不改變任何遊戲行為，內容只有本機遊戲資料。
// getter 讀的是模組層級的 live binding（`sprintState`／`vitals`／`player`／
// `slots`／`drops`），所以每次取值都是當下的狀態。
window.__wecraft = {
  sprint: () => sprintState.active,
  fov: () => gs.camera.fov,
  hunger: () => (vitals ? vitals.hunger : null), // 創造模式 → null（無飢餓條）
  pos: () => ({ x: player.position.x, y: player.position.y, z: player.position.z }),
  // 名稱沿用 `hotbar`（既有 Playwright 驗收腳本依賴）；B5 Task 7 起回傳 36 格。
  // B7 Task 5：工具堆疊多帶 `dur`（`dur !== undefined` 才加欄位——非工具的既有
  // 形狀不變）；人工驗收靠它讀出剩餘耐久。
  hotbar: () =>
    slots.map((s) =>
      s ? { item: s.item, count: s.count, ...(s.dur !== undefined ? { dur: s.dur } : {}) } : null,
    ),
  drops: () => drops.length,
  modified: () => world.modified.size,
  viewMode: () => viewMode,
  mobs: () => mobs.length,
  passiveMobs: () => passiveMobs.length,
  clock: () => clock.t,
  passiveMobPositions: () => passiveMobs.map((m) => ({ x: m.pos.x, y: m.pos.y, z: m.pos.z })),
  // 逐隻的狀態（血量在這裡；座標快照沒有血量 → 驗收「命中 → 扣血」用這個）
  passiveMobStates: () =>
    passiveMobs.map((m) => ({
      id: m.id,
      kind: m.kind,
      x: m.pos.x,
      y: m.pos.y,
      z: m.pos.z,
      hp: m.hp,
    })),
  // 敵對生物的逐隻狀態（血量／燃燒／座標）→ 供 repo 外的驗收探針讀：
  // 驗「屋簷下不掉血」「20 格外不射箭」。**純唯讀**（只映射出新陣列）。
  mobStates: () =>
    mobs.map((m) => ({
      id: m.id,
      kind: m.kind,
      x: m.pos.x,
      y: m.pos.y,
      z: m.pos.z,
      hp: m.hp,
      burn: m.burn,
    })),
  // 玩家的生命／飢餓／飽食度（創造模式 → null）→ 供驗收探針讀「進食後的飽食度」。
  // **純唯讀**（只複製出一份新物件）。
  vitalsState: () =>
    vitals
      ? {
          hp: vitals.hp,
          maxHp: vitals.maxHp,
          hunger: vitals.hunger,
          maxHunger: vitals.maxHunger,
          saturation: vitals.saturation,
        }
      : null,
};
/** A1: the boot check (local read → cloud init/read/apply → title settle).
 *  Runs in the BACKGROUND — the title is already on screen while it works.
 *  `bootSettled` resolves when it is done (the 新遊戲 overwrite decision waits
 *  for it: a cloud-only entry must be warned about too). */
async function runBootCheck(): Promise<void> {
  // The local read is fast (IndexedDB) and decides the 新遊戲 overwrite
  // warning; the cloud read decides the rest of the title entry (Ruling J:
  // a boot-applied cloud payload wins over a local save).
  try {
    savedPayload = await loadGame();
  } catch {
    /* loadGame never rejects (null on any failure) — defensive only */
  }
  try {
    await cloud.init();
  } catch {
    /* defensive: createCloudClient.init never rejects — the title mounts anyway */
  }
  if (cloud.status !== 'guest' && cloud.status !== 'unsupported') {
    try {
      const res = await cloud.load();
      if (!res) {
        cloudSession.setRevision(0); // empty slot — the first checkpoint may claim it
      } else if (!isReadableCloudFormat(res.formatVersion)) {
        cloudSession.setRevision(null); // never overwrite an unreadable-format slot
        cloudSession.lock('FORMAT');
      } else {
        const data = acceptCloudData(res.data);
        if (data) {
          // A1: a session that started while this read was in flight keeps its
          // own state — the boot payload is never applied over a live session.
          if (state === 'title' && !sessionStarted) {
            applyCloudData(data);
            // Ruling I: the live state now IS this cloud payload — the title
            // enters it via continueFromCloud() (never re-applies).
            cloudAppliedAtBoot = true;
          }
          cloudSession.setRevision(res.revision);
        } else {
          // Minor 1: honesty + recovery — the read succeeded but the payload
          // could not be accepted; the row must say so and offer a retry
          // (revision stays null: still no send may overwrite the slot).
          cloudSession.markReadFailure();
          pushCloudToast('雲端讀取失敗，本機繼續');
        }
      }
    } catch {
      // Minor 1: same honesty + recovery as the null-payload branch above.
      cloudSession.markReadFailure(); // revision stays null: no send may overwrite an unread slot
      pushCloudToast('雲端讀取失敗，本機繼續');
    }
  } else {
    cloudSession.setRevision(null); // guest/standalone — local saves only, zero noise
  }
  // Settle the title: from here the entry is final (the button becomes live
  // or disappears). Ruling J: a boot-applied cloud payload wins the entry.
  // 修復波 review CR-1：這裡只翻「不再 pending」的旗標；三態本身在每次 render
  // 由 titleSaveStateNow() 推導（場中存檔會改變它，不得快取）。
  bootCheckPending = false;
  if (state === 'title') setState('title');
}

// A1: the title mounts **IMMEDIATELY** (saveState 'pending' → Continue is
// rendered but disabled) and the boot check runs in the background. The title
// used to mount only AFTER the cloud answered — a slow or dead network left
// the player staring at an empty screen (the audit's A1).
setState('title');
bootSettled = runBootCheck();

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
    // B6 Task 4：天空比例只進著色器 uniform（每幀一行）→ 太陽落下時地形即時
    // 變暗，不觸發重算光照、不重網格（Review Focus #4：不得引發重網格風暴）。
    chunkRenderer.setSkyScale(skyLightScale(clock.t));
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
    const sprintWasActive = sprintState.active; // 狀態機之前：上一幀是否真的在疾跑
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

    // B5：**真的取消了一次疾跑**才提示（`lastCancel` 每幀都算——站著按 Shift
    // 也會有 'sneaking'，那不是「取消」）。'no-forward' 是玩家自己放開 W（已知
    // 的動作）→ 不提示；型別上 `sprintCancelHint` 也不接受它。同一文案 3 秒內
    // 不重複（hud-hint 節流）；撞牆角度用的是餵進狀態機的那個值（上一幀實測）。
    const cancelReason = sprintState.lastCancel;
    if (sprintWasActive && cancelReason !== null && cancelReason !== 'no-forward') {
      hudHint.show(sprintCancelHint(cancelReason, lastWallAngleDeg));
    }

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

    // ---- 危險（B3 Task 6）：仙人掌接觸傷害（每秒 1 點，累積器式）----
    // 接觸判定是**整格判定**（`touchesCactus`）：踩在仙人掌上、或跳過仙人掌
    // 時身體框與仙人掌格重疊才算接觸；站在仙人掌旁邊不會扣血（與原版的差異，
    // 見 `src/world/hazards.ts` 的檔頭註解）。**B1**：腳下層的候選格還要
    // 「與身體框之間沒有實心方塊」才算接觸——平台下的仙人掌不再穿透扣血。
    // 傷害節奏由 `stepHazards` 的累積器決定（與幀率無關）；扣血照樣走
    // `setVitals` 路徑，並沿用生物傷害的 0.5 s 無敵幀（`invuln`）。
    // **受擊回饋與生物傷害完全同一套**（審查 I-1）：`exhaust(..., EXHAUST_HURT)`
    // ＋ `hurtFlash.flash()`，不多不少。
    const hazard = stepHazards(
      hazardState,
      touchesCactus(world, player.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT),
      dt,
    );
    hazardState = hazard.state;
    if (hazard.damage > 0 && vitals) {
      const nowSec = performance.now() / 1000;
      if (canBeHurt(invuln, nowSec)) {
        invuln = markHurt(invuln, nowSec);
        deathCause = 'cactus'; // Task 13 的慣例：著實的傷害記錄死因（讀取時機＝死亡轉場）
        setVitals(exhaust(damage(vitals, hazard.damage), EXHAUST_HURT)); // emits vitals-changed via setVitals
        hurtFlash.flash(); // 與生物傷害同一套受擊回饋（紅色閃爍）
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
        hud.setHotbar(slots, selected); // inventory changed → refresh counts
        bus.emit('drops-changed', {});
      }
      for (const item of obtained) {
        applyAdvancement({ type: 'obtain', item, mode: currentMode });
      }
    }

    // ---- 粒子（Task 4）：same solidity test as the player (water falls through)
    particles = stepParticles(particles, dt, (x, y, z) => world.isSolid(x, y, z));

    // ---- 熔爐（B8 Task 6）：live 狀態住在 blockEntities；只在真的變化時寫回
    // （`entityToFurnaceState` 每次回傳新物件 → 直接比 `!==` 恆真，必須用
    // `sameFurnaceState` 的內容比較，否則每幀為每個塊實體配置並寫回 map）。 ----
    for (const [key, e] of blockEntities) {
      if (e.kind !== 'furnace') continue;
      const before = entityToFurnaceState(e);
      const stepped = stepFurnace(before, dt);
      const after = stepped.state;
      if (!sameFurnaceState(before, after)) {
        blockEntities.set(key, furnaceStateToEntity(after, e.x, e.y, e.z));
      }
    }

    // ---- 生物（Task 8）：AI → events → vitals/arrows；死亡/超距移除 ----
    const mobsBefore = mobs.length;
    const isSolidAt = (x: number, y: number, z: number): boolean => world.isSolid(x, y, z);
    const isWaterAt = (x: number, y: number, z: number): boolean =>
      world.getBlock(x, y, z) === BLOCK.WATER;
    const stepped = stepMobs(mobs, { playerPos: player.position, isSolidAt, dt });
    mobs = stepped.mobs;
    // **事件的套用不能省略**（`stepped.events` 是殭屍近戰／骷髏射箭的來源）。
    for (const ev of stepped.events) applyMobEvent(ev);
    // ---- 白天燃燒（B4.4）：AI 與攻擊事件之後才結算傷害 ----
    // 不死系在**日光直射**下會著火（1 點血/秒）；頭頂有實心方塊（屋簷）或站在
    // 水裡就不會；夜晚也不會。`stepSunBurn` 是純函式 → 回傳新的 mob 陣列。
    const sunCtx = {
      isDaylight: isDaylight(clock.t),
      isSolidAt,
      isWaterAt,
      dt,
    };
    mobs = mobs.map((m) => stepSunBurn(m, sunCtx));
    const shot = stepArrows(arrows, dt, isSolidAt, player.position);
    arrows = shot.arrows;
    for (const ev of shot.events) applyMobEvent(ev, true);
    // **死亡 → 掉落（死因無關的單一路徑）**：任何死因（箭、白天燃燒…）的生物都要
    // 掉掉落表裡的東西 → 在牠們被移出世界**之前**先算掉落。
    const deadNow = mobs.filter((m) => isDead(m));
    const spilled = deadNow.length > 0 && spawnMobDeathDrops(deadNow);
    // dead mobs despawn past 128 blocks (超距的生物不是死的 → 不掉東西)
    mobs = mobs.filter((m) => !isDead(m) && xzDistance(m.pos, player.position) <= DESPAWN_DISTANCE);
    if (mobs.length !== mobsBefore) bus.emit('mobs-changed', { count: mobs.length });
    // 不會重複掉：近戰支與這一支都**同步**把死掉的生物從 `mobs` 移走 → 每一隻死掉的
    // 生物只會被其中一支看到（這一支先跑、近戰支後跑）→ 不會掉兩次。
    if (spilled) bus.emit('drops-changed', {});

    // ---- 被動生物（B4 Task 6）：AI 步進 → 死亡移除（**不 despawn**）----
    // 與敵對生物同一套物理慣例（重力 32、跳上 1 格台階），但規則不同：漫遊／panic／
    // 水中漂浮、**不主動攻擊**、**不會自然消失**（沒有距離過濾）。
    passiveMobs = stepPassiveMobs(passiveMobs, {
      playerPos: player.position,
      isSolidAt,
      isWaterAt,
      dt,
    });
    // 死亡 → 掉落（生存模式）→ 移除屍體；**被動生物不進 `mobs-changed`**
    // （那是敵對生物的計數事件）。
    const deadPassive = passiveMobs.filter((m) => isPassiveDead(m));
    if (deadPassive.length > 0) {
      passiveMobs = passiveMobs.filter((m) => !isPassiveDead(m));
      if (spawnPassiveDeathDrops(deadPassive)) bus.emit('drops-changed', {});
    }

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
        // ≥ 4-point drain) lives in survival.ts `exhaust`.
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

      // 被動生物生成排程（B4 Task 7）：每 10 s 嘗試一次 → 離玩家 ≥ 24 +
      // 成群 2-4 + 上限 12（規則都在 `world/passive-mobs.ts` 這個純邏輯層，
      // 這裡只提供世界查詢與光照）。**白天閘門（A5）**：`isDaylight(clock.t)`
      // ——亮度判準看的是客戶端天空光（時間無關），夜間要由時間擋。
      // **光照（B6 Task 7）**：per-block 的 `spawnLightAt`、逐隻檢查——夜間地表
      // （客戶端天空光 15）亮但**不生成**（A5），全黑（遮蔽＋無方塊光）也擋。
      // **沒有生成時回同一個參考** → 直接賦回去即可。
      passiveSpawnAcc += dt;
      if (passiveSpawnAcc >= PASSIVE_SPAWN_INTERVAL_SEC) {
        passiveSpawnAcc = 0;
        passiveMobs = trySpawnPassiveGroup(passiveMobs, player.position, {
          isDaylight: () => isDaylight(clock.t),
          lightAt: (x, y, z) => spawnLightAt(world, x, y, z, clock.t),
          isSolidAt: (x, y, z) => world.isSolid(x, y, z),
          blockIdAt: (x, y, z) => world.getBlock(x, y, z),
        });
      }

      // Task 14 save point (c): autosave every 30 s while playing — BOTH modes
      // (mode is part of the payload; creative worlds save too — plan §7).
      saveAcc += dt;
      if (saveAcc >= AUTOSAVE_INTERVAL_SEC) {
        saveAcc = 0;
        persistNow();
      }

      // A3: a failed autosave is retried after the policy delay (10 s). The
      // failure already toasted once — the retry itself stays quiet until it
      // succeeds (or the streak continues).
      if (localSaveRetryDue !== 0 && Date.now() >= localSaveRetryDue) {
        localSaveRetryDue = 0;
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

      // ---- B2.4 相機姿態（三態視角）----
      // 姿態本體在 core/view-mode.ts（純邏輯、無狀態）；這裡只把回傳值套到 Three
      // 相機上：
      //  - `first`：相機＝眼睛位置，yaw／pitch＝玩家值（第一人稱）。
      //  - `back` ：相機在玩家**後方** 4 格（高度 +0.5），yaw／pitch＝玩家值
      //            → 視線方向與玩家一致，畫面裡看得到玩家背面。
      //  - `front`：相機在玩家**前方** 4 格（高度 +0.5），yaw **反轉 180°**
      //            （yaw + π）→ 相機面向玩家，看得到玩家正面與臉部貼片。
      // （修正既有 bug：舊的第三身相機放在玩家的**前方**卻沿用玩家 yaw，
      //   畫面看到的與實際互動的方向相反。）
      const eye = { x: player.position.x, y: player.position.y + EYE_HEIGHT, z: player.position.z };
      const pose = viewPose(viewMode, eye, player.yaw, player.pitch);
      gs.camera.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
      gs.camera.rotation.order = 'YXZ';
      gs.camera.rotation.y = pose.yaw;
      gs.camera.rotation.x = pose.pitch;
      gs.camera.rotation.z = 0; // defensive: never let residue become roll

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

      // ---- 互動射線：一律以「相機姿態」為準（B2.4）----
      // 原點＝相機位置、方向＝相機的 yaw／pitch → 準心指向的方塊就是被挖／被放
      // 的方塊（第一人稱時相機＝眼睛位置，與既有行為等價）。
      // 面前視角的 `pose.yaw`＝玩家 yaw + π → 射線因此朝**玩家背後**方向，
      // 與畫面上看到的方向一致（不是「玩家面向的方向」）。
      const dir = {
        x: -Math.sin(pose.yaw) * Math.cos(pose.pitch),
        y: Math.sin(pose.pitch),
        z: -Math.cos(pose.yaw) * Math.cos(pose.pitch),
      };
      const rayOrigin = { x: gs.camera.position.x, y: gs.camera.position.y, z: gs.camera.position.z };
      // reach 依視角補回「相機 ↔ 玩家」的 4 格距離：第三身時射線是從相機出發的，
      // 必須多走 4 格才等於「從玩家眼睛出發的 reach」→ 補回後兩種視角的實際
      // 可互動距離相同（第一人稱補 0 格）。
      // **精度事實**：相機實際位移是水平 4 格 **＋垂直 0.5 格** → 相機↔眼距為
      // √(4² + 0.5²) ≈ 4.031，這裡仍補 4（計畫明訂「補回 4 格」）→ 第三身的
      // 等效可互動距離比第一人稱**短約 0.03 格**。取捨：補實際距離會讓第三身
      // 比第一人稱多挖到 0.03 格（可忽略），而「補 4」與計畫／規格一致、也與
      // `THIRD_PERSON_DISTANCE` 同一個常數 → 日後若做相機夾牆，把這裡改成實際
      // 距離即可（屆時兩者會一起變動）。
      const back = viewMode === 'first' ? 0 : THIRD_PERSON_DISTANCE;
      // reach 依模式（Task 5）：創造 5、生存 4.5（第三身再加上相機的 back-offset）
      const reach = reachFor(currentMode) + back;
      // **第三身護欄**：相機可能被地形夾住（玩家背靠土坡／面前有牆）→ 原點落在
      // 實心方塊內時，一般 DDA 會在 t=0 命中「相機所在的那一格」——那是玩家
      // **看不到**的方塊，挖它／在它上面放方塊都等於操作看不見的目標。
      // → 第三身跳過原點所在的那一格（射線走出那一格後再找目標，法線是真正的
      // 入射面；reach 預算仍從原點起算）。
      // 第一人稱**不跳過**：原點是**眼睛**，被卡在方塊裡時挖那一格正是玩家要的
      // （挖出來）→ 第一人稱行為逐值不變。
      const hit = raycast(world, rayOrigin, dir, reach, {
        skipOriginBlock: viewMode !== 'first',
      });
      // 近戰 reach 是另一個常數（計畫：「ray hits mob within 3.5 blocks」）——方塊的
      // reach 仍由上面的 `reachFor` 主導。第三身同樣加上相機的 back-offset，兩種
      // 視角「從眼睛算起」的有效距離都維持 3.5。
      const meleeReach = MELEE_REACH + back;
      // （近戰射線打的是**生物實體**、不是方塊 → 不需要上面的「跳過原點格」護欄：
      //   生物不會長在實心方塊裡，原點在牆中不影響生物命中。）

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
          // 查詢而已（不造成傷害）：**先敵對、再被動** → 兩者都擋住挖掘。
          attacking =
            hitMobId(mobs, rayOrigin, dir, meleeReach) !== null ||
            hitPassiveMobId(passiveMobs, rayOrigin, dir, meleeReach) !== null;
        } else {
          const heldStack = slots[selected];
          const dmg = toolDamage(heldStack?.item ?? null);
          const atk = attackMob(
            mobs,
            rayOrigin,
            dir,
            meleeReach,
            dmg,
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
            // B7 Task 5：**命中才扣**——傷害已套用（`mobs = atk.mobs` 在上面），
            // 這一擊確實打中了才扣 1 耐久；冷卻中的查詢帧與落空都到不了這裡。
            // 先傷害、再扣工具：這一下壞掉時，下面的擊殺掉落照樣生成。
            damageHeldTool(1);
            hud.setHotbar(slots, selected);
            const beforeKill = mobs.length;
            const dead = mobs.filter((m) => isDead(m));
            mobs = mobs.filter((m) => !isDead(m));
            if (mobs.length !== beforeKill) {
              bus.emit('mobs-changed', { count: mobs.length });
              // Task 12: the kill filter actually removed a mob → unlock event
              applyAdvancement({ type: 'mob-killed', mode: currentMode });
              // B4 Task 4：擊殺掉落走**生物掉落表**（`rollMobDrops`）——
              // 殭屍掉腐肉 0–2、骷髏掉骨頭／箭 0–2。
              // **舊的「殭屍必掉 1 顆蘋果」已移除**：那是 Phase 4 為了讓
              // 「吃蘋果」有來源而加的臨時手段，現在蘋果的來源改成
              // **橡木／白樺樹葉 0.5% 機率掉落**（`chanceDropFor`）→ 兩條鏈分開，
              // 殭屍不再靠「必掉蘋果」硬塞食物。
              // 掉落走**共用**的 `spawnMobDeathDrops`（死因無關）→ 與「死亡移除」
              // 那一支同一份掉落表，且不會重複生成（這裡把死掉的生物從 `mobs`
              // 移走了 → 死亡移除支看不到牠）。
              if (spawnMobDeathDrops(dead)) bus.emit('drops-changed', {});
            }
          } else {
            // ---- 被動生物（B4 Task 6）：沒打到敵對 → 試試被動生物 ----
            // **順序：先敵對、再被動**（同一個瞄準只能打中一隻 → 敵對優先）。
            const patk = attackPassiveMob(
              passiveMobs,
              rayOrigin,
              dir,
              meleeReach,
              dmg,
              dir, // 擊退沿著水平視線方向（attackPassiveMob 只看 XZ）
            );
            if (patk.hitId !== null) {
              attacking = true;
              passiveMobs = patk.mobs;
              attackCd = ATTACK_COOLDOWN_SEC;
              // B4 Task 8：受擊閃白 0.1 秒（與敵對生物同一個做法）。
              passiveRenderer.flashPassiveMob(patk.hitId);
              attackedThisFrame = true;
              if (vitals) setVitals(exhaust(vitals, EXHAUST_ATTACK));
              // B7 Task 5：命中**被動**生物同樣是一次攻擊命中（wiki 的 −2／本作
              // −1 規則涵蓋「hostile, neutral or passive」）→ 與敵對分支同一條扣損。
              damageHeldTool(1);
              hud.setHotbar(slots, selected);
              // 死亡 → 掉落（生存模式）→ 移除屍體。
              // **被動生物不進 `mobs-changed`**（那是敵對生物的計數事件）。
              const deadPassive = passiveMobs.filter((m) => isPassiveDead(m));
              if (deadPassive.length > 0) {
                passiveMobs = passiveMobs.filter((m) => !isPassiveDead(m));
                if (spawnPassiveDeathDrops(deadPassive)) bus.emit('drops-changed', {});
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
        const held = slots[selected];
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
          // B6 Task 6：支撐被挖掉的火把跟著收回（依附方向由世界推導——支撐
          // 消失後 torchAttachAt 變 'free'）。每個被收回的火把走與上面同一條
          // 掉落路徑（生存掉自身、創造不掉）；popUnsupportedTorches 內部已把
          // 火把格 setBlock 回 AIR（modified overlay 記 AIR、光照重算照常觸發）。
          for (const t of popUnsupportedTorches(world, hit.x, hit.y, hit.z)) {
            const torchDrops = spawnBlockDrop(drops, currentMode, BLOCK.TORCH, {
              x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5, // block centre
            }, held);
            if (torchDrops.length !== drops.length) bus.emit('drops-changed', {});
            drops = torchDrops;
          }
          // B2 Task 11：支撐被挖掉的 cross 植被跟著收回（與火把同一條路：
          // setBlock AIR → `modified` 記 AIR → 地形重生成不會讓它長回來）。
          // 掉落要用**挖除前**讀到的 id——popUnsupportedCrosses 內部已把格子
          // 設成 AIR，之後就查不到了（唯一候選＝上面那一格，所以一個 id 夠）。
          const aboveId = world.getBlock(hit.x, hit.y + 1, hit.z);
          for (const c of popUnsupportedCrosses(world, hit.x, hit.y, hit.z)) {
            const crossDrops = spawnBlockDrop(drops, currentMode, aboveId, {
              x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5, // block centre
            }, held);
            if (crossDrops.length !== drops.length) bus.emit('drops-changed', {});
            drops = crossDrops;
          }
          if (vitals) setVitals(exhaust(vitals, EXHAUST_BREAK_BLOCK));
          // B7 Task 5：**挖完才扣**（`digStep` 回 true ＝這一幀真正破壞了方塊；
          // 挖到一半不扣）——方塊掉落已在上面生成 → 現在才扣，工具在這一下壞掉
          // 時掉落物照樣出現在地上。創造模式由 `damageHeldTool` 內守門（耐無限）。
          damageHeldTool(1);
          hud.setHotbar(slots, selected);
          // Task 6／B8 Task 6: a mined furnace spills its whole contents and
          // loses its state. 溢出改走共用的 `spillBlockEntity`（B7 的 `dur`
          // 傳遞由該函式統一處理，行為不變）；創造模式不灑內容物。
          if (id === BLOCK.FURNACE) {
            const key = blockEntityKey(hit.x, hit.y, hit.z);
            const entity = blockEntities.get(key) ?? null;
            const before = drops.length;
            drops = spillBlockEntity(drops, entity, {
              x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5,
            }, currentMode);
            if (drops.length !== before) bus.emit('drops-changed', {});
            blockEntities.delete(key);
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
        } else if (currentMode === 'survival' && vitals !== null && heldIsFood()) {
          // B4 Task 9：手上拿食物時右鍵＝**進食**（不放置）。
          // 這裡**不吃** —— 只把進度歸零，等下面的每幀 `eatTick()` 依
          // `input.state.placeHeld` 累積到 1.6 秒才真的吃下去。
          // （舊的「右鍵脈衝即吃」整段已刪除：快速點一下右鍵就吃掉東西，
          //  等於沒有「按住 1.6 秒」這條規則。）
          eatProgress.reset();
        } else if (hit) {
          viewmodel.startSwing(); // Phase 3 Task 8: any right-click place attempt swings
          // B2.2（Task 10）：「放方塊」已抽成 tryPlaceBlock() —— 首次使用路徑與
          // 連放路徑共用同一份實作（見下方連放段）。
          tryPlaceBlock(hit);
        }
      }

      // ---- B2.2 放置連放（Task 10 接線）----
      // **第一次右鍵 vs 之後的連放**：上面那段 `wantPlace` 是「完整使用」（開工作台／
      // 開熔爐／放方塊），**只有它會開介面**；連放只重複 `tryPlaceBlock()`
      // （放方塊）—— 不重複開介面。**進食不走這條路**（進食是「按住 1.6 秒」，
      // 由下面的 `eatTick` 推進）。
      // 節拍：`stepRepeat` 只負責「按住之後的重複」，第一次觸發由上面的完整流程
      // 負責；按住需累積滿 0.2 秒（PLACE_REPEAT_SEC ＝ 4 tick）才發火。
      // 滑鼠解鎖／視窗失焦 → `input.state.placeHeld` 歸 false → 節拍歸零（放開即停）。
      const placeStep = stepRepeat(placeRepeat, input.state.placeHeld, dt, PLACE_REPEAT_SEC);
      placeRepeat = placeStep.state;
      if (placeStep.fired && hit) tryPlaceBlock(hit); // 沒瞄到方塊就不放

      // ---- B4.3 進食：按住右鍵 1.6 秒才吃 ----
      // **規則本體在 `player/eat.ts` 的 `eatTick()`（純邏輯，可單元測試）**；
      // 這裡只負責把每幀的上下文餵進去：
      //  - `held` ＝ `input.state.placeHeld`（**B2 擁有的旗標，本批只讀**）；
      //  - `item` ＝ 手上拿的東西；`allowed` ＝ 生存模式 ＋ 沒吃飽（`canEat`）
      //    → **滿飢餓不可進食**（不開始進食、也不消耗物品）。
      // 放開右鍵 → `eatTick` 自行歸零並回 'idle'（進度條也跟著收掉）。
      const eatStack = slots[selected];
      const eatItem = eatStack ? eatStack.item : null;
      // `v` 是 const 快照 → 下面的 null 守門對 tsc 有型別效果（與既有寫法一致）。
      const eatVitals = currentMode === 'survival' ? vitals : null;
      const eatAllowed =
        eatVitals !== null && eatItem !== null && canEat(eatVitals, eatItem);
      const eatState = eatTick(eatProgress, {
        held: input.state.placeHeld, // ← B2（0.5.0）擁有的欄位，本批只讀
        item: eatItem,
        allowed: eatAllowed,
        dtSec: dt,
      });
      // 進度條（可選的視覺回饋；規則不依賴它）。
      if (eatState === 'eating' && eatProgress.elapsed > 0) {
        eatProgressUi.show(eatProgress.elapsed / EAT_TIME_SEC);
      } else {
        eatProgressUi.hide();
      }
      if (eatState === 'eaten' && eatVitals !== null && eatItem !== null) {
        // 吃東西的**食物值一律來自 `foodFor()`**（食物值表的單一真值）→
        // 不寫死蘋果的 4／2.4。
        const def = foodFor(eatItem);
        const eaten = eatFromSlot(slots, selected);
        if (eaten.ate && def !== null) {
          inventory.setSlot(selected, eaten.slots[selected] ?? null);
          setVitals(eat(eatVitals, def.food, def.saturation));
          hud.setHotbar(slots, selected);
          // 食物沒有方塊形式 —— 沿用放置的軟 thud，不新增音色。
          audio.play('place', 'grass', { pos: player.position });
          // `tasty` 只在吃蘋果時解鎖（advancements.ts 的既有規則不變）。
          applyAdvancement({ type: 'ate', item: eatItem, mode: currentMode });
        }
      }

      // ---- B2.5 Q 丟棄（Task 10 接線）----
      // 單次：Q 丟 1 個、Ctrl+Q 丟整疊（wiki Controls「Control+Q drops the whole
      // stack of items.」）。連丟：按住 Q 每 0.2 秒（DROP_REPEAT_SEC）丟一次；
      // 按住 Ctrl 時連丟的是整疊（`input.state.sprint` ＝「Ctrl 是否按住」，
      // **不是**疾跑狀態機的 active —— 兩者不可混用）。
      // 創造模式：`dropCount()` 回 0 → 不丟、不消耗（純函式層已有單元測試）。
      //
      // **Ctrl 的取樣時機（統一語意：每一次觸發都以「該觸發當下」的 Ctrl 為準）**：
      //  - 單次丟棄的觸發點＝Q 的 **keydown** → 輸入層在 keydown 當下快照 Ctrl
      //    （`input.ts` 的 `dropWholeStack = state.sprint`）。
      //  - 連續丟棄的觸發點＝每 0.2 秒的**節拍發火幀** → 讀當下的
      //    `input.state.sprint`。
      // 兩者同屬「觸發當下的 Ctrl」，差別只在觸發點如何定義。實務後果（刻意、
      // 寫在這裡免得被當成 bug）：「先按住 Q、之後才按 Ctrl」→ **後續的連丟**會
      // 變成整疊丟棄；而那一次 Ctrl+Q 的**首次**丟棄仍以 keydown 當下的 Ctrl 為準
      // （當下沒按 Ctrl → 只丟 1 個）。
      const dropReq = input.consumeDrop();
      if (dropReq) dropSelected(dropReq.wholeStack);
      const dropStep = stepRepeat(dropRepeat, input.state.dropHeld, dt, DROP_REPEAT_SEC);
      dropRepeat = dropStep.state;
      if (dropStep.fired) dropSelected(input.state.sprint); // 按住 Ctrl 時連丟整疊

      // UI 脈衝
      if (input.consumeToggleDebug()) showDebug = !showDebug;
      // B2.4：F5 循環切換三態視角（first → back → front → first）。
      // **只切視角**：不碰 pointer lock、不碰 Esc／iframe 的既有路由。
      // 切換在下一幀生效（姿態是每幀從 viewMode 重算的）。
      if (input.consumeToggleView()) viewMode = nextViewMode(viewMode);
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
        const held = slots[selected];
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
  // model swaps the same frame), then the swing/bob pose is applied.
  // B2.4：揮手／擺動只在 playing 時推進；第三身（面後／面前）與所有非 playing
  // 狀態都隱藏手持模型（第一人稱才看得到手上的東西）。
  const heldItem = slots[selected]?.item ?? null;
  if (heldItem !== heldViewmodelItem) {
    heldViewmodelItem = heldItem;
    viewmodel.setItem(heldItem);
  }
  viewmodel.update(
    state === 'playing' ? dt : 0,
    state === 'playing' && viewMode === 'first',
    Math.hypot(player.velocity.x, player.velocity.z),
  );

  // B2.4 玩家模型（方塊人）：只在第三身（面後／面前）顯示，第一人稱隱藏；
  // 非 playing 狀態（標題／暫停／背包／死亡）一律隱藏。
  // **位置傳玩家腳底**（`player.position`，不是眼睛高度 +1.62）→ 模型底面貼地。
  // 姿態每幀同步（模型無動畫，只需要位置與朝向）。
  //
  // **暫停／覆蓋層期間的樣子（刻意行為）**：相機姿態只在 playing 分支更新，
  // 非 playing 時相機停在最後一幀的第三身位置，但玩家模型依上面「非 playing
  // 一律隱藏」的規則被隱藏 → 暫停選單背後會看到「第三身視角、卻沒有玩家」。
  // 這是 brief Step 1.9 明訂的行為（覆蓋層一律不顯示模型）；是否要在非 playing
  // 也擺放玩家，留給 Task 12（暫停選單提示）一併決定（已記入計畫文件的
  // 〈已知問題／後續〉）。
  playerModel.setPose(player.position, player.yaw);
  playerModel.setVisible(state === 'playing' && viewMode !== 'first');

  dropRenderer.syncDrops(drops); // reconcile sprites every frame (cheap <50)
  particleRenderer.sync(particles, gs.camera); // Task 4 (empty list → nothing drawn)
  mobRenderer.syncMobs(mobs, state === 'playing' ? dt : 0); // frozen off-play (no walk cycle)
  mobRenderer.syncArrows(arrows);
  // B4 Task 8：被動生物（雞／豬／羊／牛）的方塊模型 —— 非 playing 時 dt = 0
  // → 走路擺動凍結（與敵對生物同一個處理）。
  passiveRenderer.syncPassiveMobs(passiveMobs, state === 'playing' ? dt : 0);
  // Task 3: cracks belong to the dig loop only — the playing branch above
  // drives set(digTarget, dig.progress); every other state (title/paused/
  // inventory/crafting/dead) clears any quad left hanging on the frozen view.
  if (state !== 'playing') crackOverlay.set(null, 0);
  gs.renderer.render(gs.scene, gs.camera);
});
