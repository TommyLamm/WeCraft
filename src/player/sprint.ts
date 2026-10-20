/** 疾跑狀態機（B2.1）——純邏輯，不碰 DOM／Three，也不自己持有時鐘。
 *
 *  兩種「開始疾跑」的來源，語意不同，不可混為一談：
 *  - **鎖存（latched）**：雙擊 W 一次即成立，之後不必再按任何鍵；屬於
 *    **一次性**語意——任何取消條件發生時鎖存一併被清掉，阻擋解除後**不會**
 *    自己恢復（要再雙擊一次才會重新鎖存）。
 *  - **按住 Ctrl（ctrlHeld）**：屬於**暫時性**語意——只是暫時性的阻擋
 *    （例如撞牆）解除後，下一幀就自動恢復疾跑。
 *
 *  取消原因（`SprintCancelReason`）與原版 wiki 的對應（2026-10-20 查證）：
 *  - `no-forward`：停止前進。原版：疾跑需要「moving」才持續。
 *  - `sneaking`：潛行（Shift）與疾跑互斥。
 *  - `flying`：飛行中不疾跑。
 *  - `in-water`：水中不疾跑。
 *  - `hunger`：飢餓門檻。minecraft.wiki/Sprinting §Activating：
 *    「The player cannot sprint if their hunger bar is at 6 (🍗) or below」，
 *    §History（Java Edition Combat Tests）：「Reintroduced the rule that
 *    sprinting requires more than 6 points of food」。
 *    → **開始**門檻是 `hunger > 6`（即 ≥ 7 才可以開始）；**疾跑中**掉到
 *    `≤ 6` 立即取消（Sprinting §Usage：sprint ends if the hunger bar reduces
 *    to 6 or less）；回到 `≥ 7` 即可再次開始，**不設「> 7」的額外鎖定**。
 *    （Food 頁那句「until the hunger value exceeds 7」被解讀為「失去能力後
 *    要恢復」的敘述用詞，不採用其字面的 ≥ 8 解讀——見計畫 §1。）
 *    `hunger === null` 代表創造模式（無飢餓條）→ 不受此門檻限制。
 *  - `wall`：撞牆角度。minecraft.wiki/Sprinting §Usage：「Sprinting
 *    ends when the player collides with a solid block at an angle of greater
 *    than 8 degrees」，§History **21w41a（1.18）**：「Increased the angle at
 *    which colliding with blocks does not prevent sprinting from 5.5 to 8
 *    degrees」→ 門檻是**嚴格大於** 8°（剛好 8° 不取消）。
 *    （出處是 21w41a／1.18，不是 24w44a。另：24w44a（1.21.4）另有「使玩家
 *    減速的動作會取消疾跑」的規則，本模組**未實作**該規則——本模組沒有
 *    「減速即取消」這個取消原因，勿以為已涵蓋。）
 *  - `attacked`：攻擊命中取消疾跑。Sprinting §Usage：「Players who attack
 *    while sprinting deal a sprint-knockback attack … and canceling the
 *    sprint」。
 *
 *  雙擊時間窗：`SPRINT_DOUBLE_TAP_WINDOW_SEC`（7 tick ＝ 0.35 秒）來自
 *  minecraft.wiki/Options §Controls 的「Sprint Window … default 7（tick）」。
 *  本批固定 0.35 秒（原版可在選項調整）。**計時判定在輸入層**（Task 2 用
 *  keydown 當下的時間戳比對），本模組只吃 `sprintRequested` 這個脈衝，
 *  因此不受影格率影響。
 *
 *  **與原版的刻意差異（計畫 §1 已定案，勿誤讀為原版行為）**：`in-water`、
 *  `flying` 這兩條取消原因是**刻意簡化**——原版允許在水中疾跑（游泳時照樣
 *  可疾跑），創造模式飛行中按住疾跑鍵也可讓飛行加速；本批刻意收斂成
 *  「水中／飛行中即取消疾跑」，屬本批的取捨，**不是**原版行為。
 *
 *  純度：本模組每個函式都回傳**全新物件**，入參一律不被修改（與
 *  survival.ts／fallstate.ts／invuln.ts 同一慣例）。 */

export const SPRINT_DOUBLE_TAP_WINDOW_SEC = 0.35;
export const SPRINT_MIN_HUNGER = 6;
export const SPRINT_WALL_ANGLE_DEG = 8;

/** 疾跑被取消的原因；`null` 代表沒有任何取消條件成立。 */
export type SprintCancelReason =
  | 'no-forward'
  | 'sneaking'
  | 'flying'
  | 'in-water'
  | 'hunger'
  | 'wall'
  | 'attacked';

export interface SprintState {
  /** 本幀是否處於疾跑（真正拿去餵給物理層的是這個旗標）。 */
  active: boolean;
  /** 是否處於「雙擊 W 鎖存」狀態（一次性：被取消即清掉）。 */
  latched: boolean;
  /** 記錄**當前幀**的 `ctx.ctrlHeld`（Ctrl 是否按住）——僅供除錯／後續擴充
   *  用的紀錄欄位。**所有判定一律以 `ctx.ctrlHeld` 為準**，本批不依賴此欄位。 */
  ctrlHeld: boolean;
  /** **本幀**的取消原因；下一幀若沒有新的取消條件就會被清成 `null`
   *  （不是歷程記錄，只反映當下這一幀的結果）。 */
  lastCancel: SprintCancelReason | null;
}

/** 一幀的疾跑判定輸入（由 main.ts 每幀組裝）。 */
export interface SprintContext {
  /** 是否正在向前移動（W）。 */
  forward: boolean;
  /** 是否正在潛行（Shift）。 */
  sneak: boolean;
  /** Ctrl 是否按住。 */
  ctrlHeld: boolean;
  /** 本幀是否收到雙擊 W 的請求脈衝（輸入層已判過時間窗）。 */
  sprintRequested: boolean;
  /** 當前飢餓值；`null` 代表創造模式（無飢餓條，不受門檻限制）。 */
  hunger: number | null;
  /** 是否飛行中。 */
  flying: boolean;
  /** 是否在水中。 */
  inWater: boolean;
  /** 本幀撞到方塊的角度（度）；`null` 代表沒有撞到。 */
  wallAngleDeg: number | null;
  /** 本幀是否打中了東西（攻擊命中）。 */
  attacked: boolean;
}

/** 初始狀態：沒有疾跑、沒有鎖存。 */
export function createSprintState(): SprintState {
  return { active: false, latched: false, ctrlHeld: false, lastCancel: null };
}

/** 撞牆角度是否大到足以取消疾跑（嚴格大於 8°；剛好 8° 不取消）。 */
export function isWallBlock(angleDeg: number | null): boolean {
  return angleDeg !== null && angleDeg > SPRINT_WALL_ANGLE_DEG;
}

/** 判定本幀的取消原因；沒有任何條件成立則回傳 `null`。
 *
 *  判定順序固定（前者優先），與測試逐條對應：
 *  `no-forward` → `sneaking` → `flying` → `in-water` → `hunger` →
 *  `wall` → `attacked`。
 *
 *  飢餓門檻只認 6 這個值：生存模式 `hunger ≤ 6` 一律不疾跑（`null`＝創造
 *  模式，不受限制）；回到 `≥ 7` 即可再次開始，沒有額外的鎖定狀態。 */
export function cancelReason(ctx: SprintContext): SprintCancelReason | null {
  if (!ctx.forward) return 'no-forward';
  if (ctx.sneak) return 'sneaking';
  if (ctx.flying) return 'flying';
  if (ctx.inWater) return 'in-water';
  if (ctx.hunger !== null && ctx.hunger <= SPRINT_MIN_HUNGER) return 'hunger';
  if (isWallBlock(ctx.wallAngleDeg)) return 'wall';
  if (ctx.attacked) return 'attacked';
  return null;
}

/** 前進一幀的疾跑狀態。**回傳全新物件，入參 `state` 不被修改。**
 *
 *  - 有取消條件 → 疾跑停止，且**鎖存一併清掉**（一次性語意：撞牆／受攻擊
 *    之後不會自己恢復疾跑）；`lastCancel` 記錄原因。
 *  - 沒有取消條件 → 疾跑成立於「已鎖存」或「Ctrl 按住」任一者；
 *    `lastCancel` 歸 `null`（取消原因只反映當下這一幀，不會延續到下一幀）。 */
export function updateSprint(state: SprintState, ctx: SprintContext): SprintState {
  const latched = state.latched || ctx.sprintRequested;
  const reason = cancelReason(ctx);
  if (reason !== null) {
    return { active: false, latched: false, ctrlHeld: ctx.ctrlHeld, lastCancel: reason };
  }
  return { active: latched || ctx.ctrlHeld, latched, ctrlHeld: ctx.ctrlHeld, lastCancel: null };
}
