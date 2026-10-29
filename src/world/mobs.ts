import { BLOCK } from './blocks';
import { CHUNK_HEIGHT } from './chunk';

/** Mob entities & AI: zombie (melee chaser) and skeleton (keep-distance
 *  shooter), plus their arrows (pure — no Three/DOM; the renderer lives in
 *  render/scene.ts). Follows the world/drops.ts pattern: plain entities,
 *  injected `isSolidAt` callback (no World import), NaN guards on every step.
 *
 *  **敵對生怪已統一到 `src/world/b9-spawn.ts`**（B9）：四種敵對（殭屍／骷髏／
 *  苦力怕／蜘蛛）共用一份權重表與同一道光照閘門；`trySpawnMob`／
 *  `chooseSpawnKind` 已移除。本檔只保留 `findSpawnPos`／`surfaceYAt`／
 *  `createMob` 等被分配器重用的零件。
 *
 *  Distances: STATE DECISIONS ARE XZ-ONLY (chase/retreat/wander bands ignore
 *  height), the zombie MELEE RANGE IS 3D (can swipe a player on a ledge).
 *  Physics mirrors player physics: gravity 32, direct velocity set, and an
 *  auto step-up — a jump impulse (8) when the forward probe is solid and the
 *  mob is grounded, which walks it over 1-block obstacles. Arrows are a
 *  separate, lazier projectile: gravity 9.8, 30 s lifetime.
 *
 *  B4.4（敵對側對齊）：生成距離 24–128 格、上限 12 隻、超過 128 格消失；
 *  白天在**日光直射**下，不死系會著火（1 點血/秒）→ 白天在露天會被燒死，
 *  屋簷下（頭頂有實心方塊）或站在水裡則不會。生成判準（光照）集中在
 *  `world/spawn-rules.ts`；B6 起餵的是真的 per-block 光照
 *  （`lighting.spawnLightAt`，不再是 B4 的時鐘近似）。 */

// ---- Tuning constants (Task 8) ----

/** XZ distance (blocks) at which a mob engages the player → chase/retreat.
 *
 *  **35 = 原版的 follow range**（wiki，2026-10-22 查證）：Zombie 條目「Zombies pursue
 *  the player on sight from **35 blocks** away」、`follow_range` 屬性的 base value 是 35
 *  （另有 ±5% 隨機加成）；Skeleton 條目「follow players when approached, much like
 *  zombies」→ 同一個 35。
 *
 *  本作原本的 **16 是 B4 之前的舊值**，與 Task 5 把生成距離改成 **24–128** 直接矛盾：
 *  生成出來的生物最近也要 24 格，卻只有 ≤ 16 格才會追人 → **新生成的殭屍／骷髏幾乎
 *  永遠不會走進攻擊範圍、幾乎不會攻擊玩家**（B4 之前生成在 12–24 格，落在 12–16 的
 *  會直接追人）。原版沒有這個矛盾：偵測／追擊範圍 35 > 最近生成距離 24 → 生成在
 *  24–35 格的生物會直接來找玩家。 */
export const CHASE_RANGE = 35;
/** XZ distance beyond which a mob gives up and wanders (target cleared).
 *
 *  **必須 > {@link CHASE_RANGE}**，否則 `distXZ > WANDER_RANGE` 那一支會先攔截、追擊
 *  分支永遠走不到。保留既有的「遲滯帶」設計（避免追擊／遊蕩的邊界來回跳動）：
 *  35 < 距離 ≤ 40 維持原狀態，超過 40 才放棄追擊並清掉目標。 */
export const WANDER_RANGE = 40;
/** 3D melee reach of the zombie, blocks. */
export const ATTACK_RANGE = 1.6;
/** Zombie swipe: damage and the 1.0 s gate before the next one. */
export const ZOMBIE_ATTACK_DAMAGE = 3;
export const ZOMBIE_ATTACK_COOLDOWN = 1.0;
/** Skeleton volley gate — reuses `attackCooldown` (settled in the plan). */
export const SKELETON_SHOOT_COOLDOWN = 2.0;
/** XZ distance (blocks) within which a skeleton starts shooting arrows.
 *
 *  **15 = 原版的射箭距離**（wiki，2026-10-22 查證，Skeleton 條目）：「When within
 *  **15 blocks** of a target, with a clear line of sight, a skeleton starts shooting
 *  arrows, once every 3 seconds on Easy and Normal difficulties or once every 2
 *  seconds on Hard difficulty.」
 *
 *  **與追擊範圍（{@link CHASE_RANGE} = 35，`follow_range`）是原版兩個獨立的量**：
 *  原版_detection 是 35、射箭只有 15 —— 骨骸會追著玩家走，但只有靠近到 15 格內才開弓。
 *  本作先前把射箭條件綁在 `CHASE_RANGE` 上（那時 `CHASE_RANGE` 是 16、剛好接近 15，
 *  看不出問題），追擊範圍調成 35 之後就變成「從 35 格外射箭」→ 這裡拆開。
 *
 *  **刻意簡化（列進 Task 12 的 README 差異清單）**：原版離開 15 格後會「弓箭上膛等待」，
 *  玩家一回到射程內就立刻射；**本作沒有實作「上膛等待」** —— 離開射程只是不射，
 *  cooldown 照常走完。
 *
 *  **量綱說明**：原版的 15 格是**三維球距**；**本作以水平（XZ）距離近似** —— 玩家在腳下
 *  10 格、水平 15 格時仍會被射。這是既有的量綱慣例，非本批引入。 */
export const SKELETON_SHOOT_RANGE = 15;
/** Line-of-sight sampling: a solid cell anywhere along the eye→eye segment
 *  blocks the swipe/shot. 0.5 < the 1-block wall thickness, so terrain can't
 *  slip between samples. */
export const LOS_STEP = 0.5;
/** Skeleton keeps ~8 blocks: retreats below 7, approaches above 9. */
export const KEEP_MIN = 7;
export const KEEP_MAX = 9;
/** Horizontal speeds, blocks/s. **只對齊原版的比例，不對齊絕對值**：原版移動速度
 *  屬性是殭屍 0.23、骷髏 0.25（0.25 / 0.23 ≈ 1.087），本作殭屍維持既有的 3.2
 *  格/秒，骷髏＝3.2 × 1.087 ≈ 3.5（原版殭屍約 4.6 格/秒 → 本作整體較慢，是
 *  既有的刻意簡化，寫進 README 差異清單）。 */
export const ZOMBIE_CHASE_SPEED = 3.2;
export const SKELETON_CHASE_SPEED = 3.5;
export const WANDER_SPEED = 1.5;
/** Wander turns: fresh random heading with a 2–4 s countdown. */
export const WANDER_TURN_MIN = 2;
export const WANDER_TURN_MAX = 4;
/** Mob gravity — matches player physics (physics.ts GRAVITY 32). */
export const MOB_GRAVITY = 32;
/** Jump impulse when blocked front + grounded → auto step-up over 1 block. */
export const JUMP_IMPULSE = 8;
/** Knockback impulse (blocks/s) applied by `damageMob`; decays ×0.1^dt per
 *  second and clears below 0.1 (settle note: vel is overwritten by AI each
 *  step, so knockback rides its own `kbVel` field). */
export const KNOCKBACK_SPEED = 6;
export const KNOCKBACK_DECAY_PER_SEC = 0.1;
export const KNOCKBACK_MIN = 0.1;
/** Eye height used for arrow aim and the arrow→player hit sphere. */
export const EYE_OFFSET = 1.4;
/** Upward bias added before normalizing the shoot direction ("slight arc" —
 *  the actual drop comes from ARROW_GRAVITY in stepArrows, not from dir). */
export const SHOOT_ARC_BIAS = 0.15;
/** Arrow flight speed (blocks/s) and gravity (blocks/s², plan: 9.8). */
export const ARROW_SPEED = 40;
export const ARROW_GRAVITY = 9.8;
/** Longest distance (blocks) an arrow travels between two solidity checks —
 *  40 b/s × the 0.1 s dt clamp is 4 blocks/tick, so the move is split into
 *  substeps ≤ this, otherwise a fast arrow tunnels through 1-block walls. */
export const ARROW_SUBSTEP = 0.25;
/** Substep cap per tick: absurd velocities degrade to coarser checks instead
 *  of looping forever (64 × 0.25 = 16 blocks covers any legitimate frame). */
export const ARROW_MAX_SUBSTEPS = 64;
/** Seconds before an arrow despawns (never flies forever). */
export const ARROW_MAX_AGE = 30;
/** 3D radius around the player's eye point that an arrow hit registers in. */
export const ARROW_HIT_RADIUS = 0.6;
export const ARROW_DAMAGE = 2;
/** Spawn policy (main.ts uses these): tick every 5 s, cap 12 mobs,
 *  spawn 24–128 blocks out, despawn beyond 128 (原版數值，wiki 2026-10-20 查證：
 *  敵對生成距離 24–128 格、離玩家超過 128 格立即消失)。 */
export const SPAWN_INTERVAL_SEC = 5;
export const MAX_MOBS = 12;
export const SPAWN_MIN_DIST = 24;
export const SPAWN_MAX_DIST = 128;
export const DESPAWN_DISTANCE = 128;
/** 白天日照下的燃燒旗標值（秒）：原版 Java 在日光直射時對不死系呼叫
 *  `setSecondsOnFire(8)`——8 秒是「著火持續時間的旗標值」，**wiki 的 Zombie／Mob
 *  頁查不到這個數字**（只寫燃燒的抑制條件與「日光直射下著火」）。實作上每幀只要
 *  仍在日光下就會把 `burn` 重設為 8 → 它其實是「正在燃燒」的旗標，**真正的死亡
 *  時間由 1 HP/s × 20 HP ≈ 20 秒決定**。 */
export const SUN_BURN_SEC = 8;
/** 燃燒中每秒扣 1 點血。 */
export const SUN_BURN_DPS = 1;
/** Forward probe lead FLOOR for the horizontal block test (blocks): the
 *  destination cell is checked this far ahead so the mob stops before its box
 *  visually clips into the wall. The effective lead covers the body's front —
 *  `hSpeed·step + max(PROBE_LEAD, width/2)`, the same formula as the passive
 *  side (`stepPassiveMob`); see {@link MOB_WIDTHS}. */
const PROBE_LEAD = 0.3;

/** Per-kind body width (X/Z, blocks) — what the forward probe must clear.
 *  Hostile mobs carry no width field (`PassiveMob` does), so `stepMob` reads it
 *  here: the renderer draws the humanoid 1.0 wide (body 0.5 + arms 0.25×2, ×0.9
 *  group scale) → 0.9 — half-width 0.45, the same number as the cow whose
 *  clipping motivated the B4 passive-side fix. */
const MOB_WIDTHS: Record<MobKind, number> = { zombie: 0.9, skeleton: 0.9 };

export type MobKind = 'zombie' | 'skeleton';
export type MobState = 'wander' | 'chase' | 'retreat';

/** A mob standing in the world (feet-centre `pos`). Pure data — stepped by
 *  `stepMob`/`stepMobs`, rendered by render/scene.ts. */
export interface Mob {
  id: number;
  kind: MobKind;
  hp: number;
  /** `kind === 'skeleton'` — kept as a field so stepMob branches on one read. */
  ranged: boolean;
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  state: MobState;
  /** Seconds until the next attack/shoot is allowed (0 = ready); −dt per step. */
  attackCooldown: number;
  /** Wander heading (radians) + seconds until the next random turn. */
  wanderDir: number;
  wanderTimer: number;
  /** Last known player position while engaged; null while wandering. */
  target: { x: number; y: number; z: number } | null;
  /** Knockback impulse (blocks/s, horizontal), decaying ×0.1^dt — separate
   *  from `vel` because AI overwrites `vel` every step. */
  kbVel: { x: number; z: number };
  /** 白天日照下的燃燒剩餘秒數（> 0 = 正在燃燒）。只對不死系有意義。 */
  burn: number;
  /** 已累積的燃燒傷害秒數（每滿 1 秒扣 1 點血，餘數留在這裡）。 */
  burnAcc: number;
}

/** One arrow in flight (plain entity, same file as its shooter). */
export interface Arrow {
  id: number;
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  age: number; // seconds since spawn
  ownerId: number; // mob id — carries through to the damage event
}

/** Events produced by one step: player damage (zombie swipe / arrow hit) or a
 *  skeleton volley the caller turns into an Arrow. */
export type MobEvent =
  | { type: 'damage'; target: 'player'; amount: number; mobId: number }
  | { type: 'shoot'; from: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number }; mobId: number };

/** `stepMob` context: player feet position, injected solidity (as in drops)
 *  and the frame's dt (cooldowns decrement by dt — no `now`, settle note). */
export interface MobCtx {
  playerPos: { x: number; y: number; z: number };
  isSolidAt: (x: number, y: number, z: number) => boolean;
  dt: number;
}

/** 白天燃燒的上下文（**獨立於 `MobCtx`**——`stepMob` 不需要日照與水，動到
 *  `MobCtx` 會連帶影響 `stepMobs` 的所有呼叫端）。 */
export interface SunBurnCtx {
  /** 此刻是白天嗎（`spawn-rules.isDaylight(clock.t)`）。 */
  isDaylight: boolean;
  /** 該格是不是實心方塊（判斷頭頂有沒有屋簷）。 */
  isSolidAt: (x: number, y: number, z: number) => boolean;
  /** 該格是不是水（站在水裡就不會被曬傷）。 */
  isWaterAt: (x: number, y: number, z: number) => boolean;
  /** 這一幀的 dt（秒）。 */
  dt: number;
}

/** Monotonic id counter for `createMob` (module instance scope — unique
 *  across every spawn within one session, like drops' max+1 pattern). */
let nextMobId = -1;

/** Fresh mob at `pos` (copied): hp 20, wander state, ready to attack, a random
 *  wander heading with a 2–4 s countdown, zero velocity/knockback. Ids are
 *  monotonic per module instance (unique across spawns in one session). */
export function createMob(kind: MobKind, pos: { x: number; y: number; z: number }): Mob {
  nextMobId += 1;
  return {
    id: nextMobId,
    kind,
    hp: 20,
    ranged: kind === 'skeleton',
    pos: { x: pos.x, y: pos.y, z: pos.z }, // copy — never alias the caller's vector
    vel: { x: 0, y: 0, z: 0 },
    state: 'wander',
    attackCooldown: 0,
    wanderDir: Math.random() * Math.PI * 2,
    wanderTimer: WANDER_TURN_MIN + Math.random() * (WANDER_TURN_MAX - WANDER_TURN_MIN),
    target: null,
    kbVel: { x: 0, z: 0 },
    burn: 0, // 未著火
    burnAcc: 0,
  };
}

/** Horizontal (XZ) distance between two points — the metric every state
 *  decision uses (height never engages or disengages a mob). */
export function xzDistance(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** True when the mob has no hp left — callers filter these out of the list
 *  (corpse removed by the caller; loot granted by `dropsForDeaths`). */
export function isDead(m: Mob): boolean {
  return m.hp <= 0;
}

/** Cheap line of sight (review Minor #4): sample `isSolidAt` every ~0.5 blocks
 *  along the `from`→`to` segment, endpoints excluded (neither eye ever sits in
 *  a solid cell). 0.5 < the 1-block wall thickness, so a wall can't slip
 *  between samples. Used before the zombie swipe and the skeleton shot —
 *  blocked means no event, while the movement above keeps chasing. */
export function hasLineOfSight(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  isSolidAt: (x: number, y: number, z: number) => boolean,
): boolean {
  const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const samples = Math.ceil(len / LOS_STEP);
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    const z = from.z + (to.z - from.z) * t;
    if (isSolidAt(Math.floor(x), Math.floor(y), Math.floor(z))) return false;
  }
  return true;
}

/** Apply `dmg` damage: returns a NEW mob with hp clamped ≥ 0. Non-finite or
 *  non-positive damage is a no-op (repo NaN-guard norm). `knockbackDir` (any
 *  horizontal vector — a 3D hit direction also fits, y is ignored — normalized
 *  internally) adds a `KNOCKBACK_SPEED` impulse along it: the direction the
 *  mob should fly AWAY from the hit. */
export function damageMob(
  m: Mob,
  dmg: number,
  knockbackDir?: { x: number; y?: number; z: number },
): Mob {
  const hp = Number.isFinite(dmg) && dmg > 0 ? Math.max(0, m.hp - dmg) : m.hp;
  const kbVel = { x: m.kbVel.x, z: m.kbVel.z };
  if (knockbackDir) {
    const len = Math.hypot(knockbackDir.x, knockbackDir.z);
    if (Number.isFinite(len) && len > 0) {
      kbVel.x += (knockbackDir.x / len) * KNOCKBACK_SPEED;
      kbVel.z += (knockbackDir.z / len) * KNOCKBACK_SPEED;
    }
  }
  return { ...m, hp, kbVel };
}

/** One AI + physics tick for a single mob — returns a NEW mob plus the events
 *  it produced (never mutates the input).
 *
 *  Order: NaN-guard dt → cooldowns tick → XZ-only state machine (with a
 *  35–40 hysteresis band so the chase/wander edge doesn't flicker) → attacks
 *  → desired horizontal velocity → gravity/step-up probe → knockback →
 *  integrate → landing sweep (drops.ts cell-sweep pattern, no tunnelling). */
export function stepMob(m: Mob, ctx: MobCtx): { mob: Mob; events: MobEvent[] } {
  const step = Number.isFinite(ctx.dt) && ctx.dt > 0 ? ctx.dt : 0;
  const events: MobEvent[] = [];

  const pos = { x: m.pos.x, y: m.pos.y, z: m.pos.z };
  const vel = { x: m.vel.x, y: m.vel.y, z: m.vel.z };
  const kbVel = { x: m.kbVel.x, z: m.kbVel.z };
  let state = m.state;
  let attackCooldown = Math.max(0, m.attackCooldown - step);
  let wanderDir = m.wanderDir;
  let wanderTimer = m.wanderTimer - step;

  const p = ctx.playerPos;
  const dx = p.x - pos.x;
  const dz = p.z - pos.z;
  const distXZ = Math.hypot(dx, dz);

  // ---- state (XZ-only) ----
  if (distXZ > WANDER_RANGE) {
    state = 'wander';
  } else if (distXZ <= CHASE_RANGE) {
    if (m.ranged) state = distXZ < KEEP_MIN ? 'retreat' : 'chase';
    else state = 'chase';
  } // else 35 < distXZ ≤ 40: keep the current state (hysteresis)
  const target = state === 'wander' ? null : { x: p.x, y: p.y, z: p.z };

  // ---- desired horizontal velocity ----
  let desX = 0;
  let desZ = 0;
  if (state === 'chase') {
    // skeleton holds its band: approach only beyond KEEP_MAX, stand ground inside it
    const inBand = m.ranged && distXZ <= KEEP_MAX;
    if (!inBand && distXZ > 0) {
      const speed = m.ranged ? SKELETON_CHASE_SPEED : ZOMBIE_CHASE_SPEED;
      desX = (dx / distXZ) * speed;
      desZ = (dz / distXZ) * speed;
    }
  } else if (state === 'retreat' && distXZ > 0) {
    const speed = SKELETON_CHASE_SPEED;
    desX = (-dx / distXZ) * speed;
    desZ = (-dz / distXZ) * speed;
  } else {
    if (wanderTimer <= 0) {
      wanderDir = Math.random() * Math.PI * 2;
      wanderTimer = WANDER_TURN_MIN + Math.random() * (WANDER_TURN_MAX - WANDER_TURN_MIN);
    }
    desX = Math.sin(wanderDir) * WANDER_SPEED;
    desZ = Math.cos(wanderDir) * WANDER_SPEED;
  }

  // ---- attacks (line of sight: a wall swallows the swipe / the shot — the
  // chase itself is untouched, they keep closing in) ----
  if (!m.ranged) {
    const dist3D = Math.hypot(dx, p.y - pos.y, dz); // melee range counts height
    if (
      dist3D <= ATTACK_RANGE &&
      attackCooldown <= 0 &&
      hasLineOfSight(
        { x: pos.x, y: pos.y + EYE_OFFSET, z: pos.z },
        { x: p.x, y: p.y + EYE_OFFSET, z: p.z },
        ctx.isSolidAt,
      )
    ) {
      events.push({ type: 'damage', target: 'player', amount: ZOMBIE_ATTACK_DAMAGE, mobId: m.id });
      attackCooldown = ZOMBIE_ATTACK_COOLDOWN;
    }
  } else {
    const from = { x: pos.x, y: pos.y + EYE_OFFSET, z: pos.z };
    const to = { x: p.x, y: p.y + EYE_OFFSET, z: p.z };
    if (
      distXZ <= SKELETON_SHOOT_RANGE &&
      attackCooldown <= 0 &&
      hasLineOfSight(from, to, ctx.isSolidAt)
    ) {
      const aim = { x: to.x - from.x, y: to.y - from.y + SHOOT_ARC_BIAS, z: to.z - from.z };
      const len = Math.hypot(aim.x, aim.y, aim.z);
      const k = len > 0 && Number.isFinite(len) ? 1 / len : 0;
      events.push({
        type: 'shoot',
        from,
        dir: { x: aim.x * k, y: aim.y * k, z: aim.z * k },
        mobId: m.id,
      });
      attackCooldown = SKELETON_SHOOT_COOLDOWN;
    }
  }

  // ---- physics: gravity / step-up probe ----
  const cx = Math.floor(pos.x);
  const cz = Math.floor(pos.z);
  const grounded = ctx.isSolidAt(cx, Math.floor(pos.y - 0.05), cz); // solid at feet

  let blocked = false;
  let stepUp = false; // blocked at FOOT level → jumpable (a 1-block step-up)
  const hSpeed = Math.hypot(desX, desZ);
  if (hSpeed > 0) {
    // **探測距離要蓋到身體前端**（半寬 `width / 2`）：只探 `PROBE_LEAD`（0.3）時，
    // 0.9 寬的身體前端比探測點遠 0.15 → 會先插進牆裡（B4 修了被動側、B6 收口
    // 敵對側——與 `passive-mobs.ts` 的 `stepPassiveMob` 同一條公式）。
    const lead = hSpeed * step + Math.max(PROBE_LEAD, MOB_WIDTHS[m.kind] / 2);
    const nx = Math.floor(pos.x + (desX / hSpeed) * lead);
    const nz = Math.floor(pos.z + (desZ / hSpeed) * lead);
    const feetBlocked = ctx.isSolidAt(nx, Math.floor(pos.y + 0.1), nz);
    const headBlocked = ctx.isSolidAt(nx, Math.floor(pos.y + 1.5), nz);
    blocked = feetBlocked || headBlocked;
    stepUp = feetBlocked;
    if (blocked) {
      desX = 0;
      desZ = 0;
    }
  }

  if (grounded && vel.y <= 0) vel.y = 0;
  else vel.y -= MOB_GRAVITY * step;
  // auto step-up: the jump impulse is applied AFTER gravity so it stays exact;
  // a 2-high wall keeps the probe solid through the whole arc → falls back.
  if (stepUp && grounded) vel.y = JUMP_IMPULSE;

  vel.x = desX;
  vel.z = desZ;

  // ---- knockback: nudges the position, decays multiplicatively ----
  if (kbVel.x !== 0 || kbVel.z !== 0) {
    const kbX = pos.x + kbVel.x * step;
    const kbZ = pos.z + kbVel.z * step;
    // embed guard: skip the step when the destination cell is solid — a hit
    // near a wall must not push the mob permanently inside the geometry.
    if (!ctx.isSolidAt(Math.floor(kbX), Math.floor(pos.y), Math.floor(kbZ))) {
      pos.x = kbX;
      pos.z = kbZ;
    }
    const decay = Math.pow(KNOCKBACK_DECAY_PER_SEC, step);
    kbVel.x *= decay;
    kbVel.z *= decay;
    if (Math.hypot(kbVel.x, kbVel.z) < KNOCKBACK_MIN) {
      kbVel.x = 0;
      kbVel.z = 0;
    }
  }

  // ---- integrate ----
  pos.x += vel.x * step;
  pos.z += vel.z * step;
  const prevY = pos.y;
  pos.y += vel.y * step;

  // landing: cell sweep from the previous feet cell down to the entered one —
  // the first solid cell wins, snap to its top face (drops.ts pattern, so a
  // fast fall can't tunnel through a floor).
  if (vel.y <= 0) {
    const toY = Math.floor(pos.y - 0.05);
    for (let cy = Math.floor(prevY - 0.05); cy >= toY; cy--) {
      if (!ctx.isSolidAt(Math.floor(pos.x), cy, Math.floor(pos.z))) continue;
      pos.y = cy + 1;
      vel.y = 0;
      break;
    }
  }

  return {
    mob: { ...m, pos, vel, state, attackCooldown, wanderDir, wanderTimer, target, kbVel },
    events,
  };
}

/** Step every mob with the same context — maps `stepMob` and concatenates the
 *  events (new array; inputs untouched). */
export function stepMobs(
  mobs: readonly Mob[],
  ctx: MobCtx,
): { mobs: Mob[]; events: MobEvent[] } {
  const out: Mob[] = [];
  const events: MobEvent[] = [];
  for (const m of mobs) {
    const res = stepMob(m, ctx);
    out.push(res.mob);
    for (const e of res.events) events.push(e);
  }
  return { mobs: out, events };
}

/** 白天日照下的燃燒步驟（純函式，回傳**新**的 mob；不動輸入）。
 *
 *  規則（spec §B4.4）：
 *  - 只有**不死系**（殭屍／骷髏）會著火——被動生物不會（Task 6 的被動生物是另一個
 *    型別，完全不經過這裡）。
 *  - 只有**日光直射**時才燃燒（夜晚不燃）。
 *  - 遮蔽判定是**刻意簡化**，兩條規則：
 *    (a) **頭格**（生物自己的頭格，殭屍腳底 0 時是 y=1）有實心方塊 → 不燃
 *        （那代表生物**卡在方塊裡**，不該被點燃）；
 *    (b) **頭頂正上方那一格**（腳底 +2 = y=2，屋簷／樹冠葉片的位置）是實心方塊 → 不燃。
 *    腳下格是水 → 不燃；**不判斷天氣、不判斷頭盔**。
 *  - `burn` 是「正在燃燒」的旗標（仍在日光下就每幀重設為 {@link SUN_BURN_SEC}），
 *    真正的死亡時間由 1 HP/s × 20 HP ≈ 20 秒決定；`burnAcc` 只在燃燒中累積，
 *    每滿 1 秒扣 {@link SUN_BURN_DPS} 點血，熄火時歸零。 */
export function stepSunBurn(m: Mob, ctx: SunBurnCtx): Mob {
  const step = Number.isFinite(ctx.dt) && ctx.dt > 0 ? ctx.dt : 0;
  const x = Math.floor(m.pos.x);
  const z = Math.floor(m.pos.z);
  // `head` = 身體占到的**最高格**（殭屍身高 2 格 → 腳底 0 時 y=1 是牠自己的頭格）。
  // **遮蔽要查 `head + 1`**（腳底正上方那一格）：屋簷／樹冠的方塊放在頭格的**正
  // 上方**（腳底 0 → 屋簷在 y=2；腳底 6 → 屋簷在 y=8）。
  //
  // 教訓（2026-10-22 審查）：先前**只查 `head`** → 那一格是生物自己的頭格、幾乎
  // 恆為空氣 → **屋簷下的殭屍白天照樣被燒死**（遮蔽條款形同虛設）。
  // 保留 `head` 那一格的理由：頭格有方塊 = 生物卡在方塊裡 → 也不點燃。
  // 用 `head + 1` 而不是 `Math.floor(pos.y + 2)`：後者在非整數腳底時會算錯
  // （腳底 6.9 → floor(8.9) = 8 ＝ 頭格）；`head + 1` 對整數與非整數腳底都對。
  const head = Math.floor(m.pos.y + 1.9);
  const roofed = ctx.isSolidAt(x, head, z) || ctx.isSolidAt(x, head + 1, z);
  const inWater = ctx.isWaterAt(x, Math.floor(m.pos.y), z);
  const burning = m.kind === 'zombie' || m.kind === 'skeleton';
  const exposed = ctx.isDaylight && !roofed && !inWater;

  const burn = exposed ? SUN_BURN_SEC : Math.max(0, m.burn - step);
  let hp = m.hp;
  let acc = 0;
  if (burning && exposed) {
    acc = m.burnAcc + step;
    const dealt = Math.floor(acc); // 每整秒 1 點血
    acc -= dealt;
    hp = Math.max(0, hp - dealt * SUN_BURN_DPS);
  }
  return { ...m, burn, burnAcc: acc, hp };
}

// ---- arrows ----

/** Append an arrow shot from `from` along `dir` (normalized internally to
 *  `ARROW_SPEED`) — max+1 id like drops, age 0, owner attached. */
export function spawnArrow(
  arrows: readonly Arrow[],
  from: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  ownerId: number,
): Arrow[] {
  let maxId = -1;
  for (const a of arrows) if (a.id > maxId) maxId = a.id;
  const len = Math.hypot(dir.x, dir.y, dir.z);
  const k = len > 0 && Number.isFinite(len) ? ARROW_SPEED / len : 0;
  return [
    ...arrows,
    {
      id: maxId + 1,
      pos: { x: from.x, y: from.y, z: from.z },
      vel: { x: dir.x * k, y: dir.y * k, z: dir.z * k },
      age: 0,
      ownerId,
    },
  ];
}

/** Distance from point `p` to the segment `from`→`to` (projection clamped to
 *  [0,1]) — the swept player-hit test: an endpoint-only check misses a shot
 *  that grazes the eye at < ARROW_HIT_RADIUS between its endpoints. */
function segmentDistance(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  p: { x: number; y: number; z: number },
): number {
  const ex = to.x - from.x;
  const ey = to.y - from.y;
  const ez = to.z - from.z;
  const len2 = ex * ex + ey * ey + ez * ez;
  let t = len2 > 0 ? ((p.x - from.x) * ex + (p.y - from.y) * ey + (p.z - from.z) * ez) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(p.x - (from.x + ex * t), p.y - (from.y + ey * t), p.z - (from.z + ez * t));
}

/** One projectile tick for every arrow → `{ arrows, events }` (new arrays).
 *
 *  Per arrow, in order: `dt` must be finite and > 0 (else step 0 — no NaN can
 *  poison a position); age ≥ 30 s despawns; gravity 9.8 on `vel.y`; then the
 *  move is SWEPT in substeps of ≤ `ARROW_SUBSTEP` (0.25) blocks, capped at
 *  `ARROW_MAX_SUBSTEPS` iterations so an absurd velocity degrades to coarser
 *  checks instead of running away. PER SUBSTEP THE SOLID CELL IS CHECKED
 *  FIRST — the player's AABB never occupies a solid cell, so a wall hit must
 *  consume the arrow even when that cell sits within eye range (review
 *  Minor #7 ordering) — then the PLAYER: point-to-SEGMENT distance from the
 *  substep's prev→new path to the eye point (`playerPos.y + EYE_OFFSET`, the
 *  same point `stepMob` aims at) within `ARROW_HIT_RADIUS` (0.6) consumes the
 *  arrow and emits damage 2; the segment form closes the grazing-miss band an
 *  endpoint-only test leaves open at large dt. First solid cell / first hit
 *  along the path wins; a surviving arrow keeps flying.
 *
 *  `isSolidAt` is injected (no World import) — water is NOT solid. */
export function stepArrows(
  arrows: readonly Arrow[],
  dt: number,
  isSolidAt: (x: number, y: number, z: number) => boolean,
  playerPos: { x: number; y: number; z: number },
): { arrows: Arrow[]; events: MobEvent[] } {
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const out: Arrow[] = [];
  const events: MobEvent[] = [];
  const eye = { x: playerPos.x, y: playerPos.y + EYE_OFFSET, z: playerPos.z };

  for (const a of arrows) {
    const age = a.age + step;
    if (age >= ARROW_MAX_AGE) continue; // despawned

    const vel = { x: a.vel.x, y: a.vel.y - ARROW_GRAVITY * step, z: a.vel.z };
    const dx = vel.x * step;
    const dy = vel.y * step;
    const dz = vel.z * step;
    const dist = Math.hypot(dx, dy, dz);
    const substeps = Math.min(ARROW_MAX_SUBSTEPS, Math.max(1, Math.ceil(dist / ARROW_SUBSTEP)));
    const sub = dist / substeps;
    const ux = dist > 0 ? dx / dist : 0;
    const uy = dist > 0 ? dy / dist : 0;
    const uz = dist > 0 ? dz / dist : 0;

    const pos = { x: a.pos.x, y: a.pos.y, z: a.pos.z };
    let consumed = false;
    for (let i = 0; i < substeps && !consumed; i++) {
      const prev = { x: pos.x, y: pos.y, z: pos.z };
      pos.x += ux * sub;
      pos.y += uy * sub;
      pos.z += uz * sub;
      if (isSolidAt(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z))) {
        consumed = true; // solid first: the AABB never occupies a solid cell
        break;
      }
      if (segmentDistance(prev, pos, eye) <= ARROW_HIT_RADIUS) {
        events.push({ type: 'damage', target: 'player', amount: ARROW_DAMAGE, mobId: a.ownerId });
        consumed = true;
        break;
      }
    }
    if (!consumed) out.push({ ...a, pos, vel, age });
  }
  return { arrows: out, events };
}

// ---- spawn selection (pure — main.ts only supplies world callbacks) ----

/** Feet position on the surface of a column (column scan — settled over a
 *  DDA raycast): topmost non-bedrock solid block, +1. Because the scan runs
 *  top-down, everything above it was already seen as air, so the 2-block mob
 *  body always fits. Null when the column is ungenerated or only bedrock —
 *  the spawn tick then just skips this cycle. Callbacks injected like
 *  `isSolidAt` (no World import, stays pure). */
export function surfaceYAt(
  wx: number,
  wz: number,
  isSolidAt: (x: number, y: number, z: number) => boolean,
  blockIdAt: (x: number, y: number, z: number) => number,
): number | null {
  const x = Math.floor(wx);
  const z = Math.floor(wz);
  for (let y = CHUNK_HEIGHT - 2; y >= 1; y--) {
    if (!isSolidAt(x, y, z)) continue;
    return blockIdAt(x, y, z) === BLOCK.BEDROCK ? null : y + 1;
  }
  return null;
}

/** Candidate spawn XZ: uniform angle and a distance ∈ [24, 128] blocks from the
 *  player (rng injectable for deterministic tests; defaults to Math.random). */
export function findSpawnPos(
  playerPos: { x: number; y: number; z: number },
  rng: () => number = Math.random,
): { x: number; z: number } {
  const angle = rng() * Math.PI * 2;
  const dist = SPAWN_MIN_DIST + rng() * (SPAWN_MAX_DIST - SPAWN_MIN_DIST);
  return {
    x: playerPos.x + Math.sin(angle) * dist,
    z: playerPos.z + Math.cos(angle) * dist,
  };
}
