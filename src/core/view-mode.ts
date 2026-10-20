/** F5 三態視角與相機姿態（B2.4）——純邏輯，不 import Three、不碰 DOM。
 *
 *  **視角循環**：`first → back → front → first`。
 *  - 已查證（minecraft.wiki/Controls，2026-10-20）「Toggle Perspective」：
 *    「Toggles between **first person, third person from the back and third
 *    person from the front**.」→ 原版本就是三態，依此順序循環。
 *
 *  **相機距離 4 格**：已查證（minecraft.wiki/Third-person view，2026-10-20）：
 *    「The third-person camera is positioned **4 blocks** from the player's
 *    front/back by default」→ 本模組取 `THIRD_PERSON_DISTANCE = 4`（沿用 repo
 *    既有 `back = 4` 的值）、高度偏移 `THIRD_PERSON_HEIGHT_OFFSET = 0.5`。
 *
 *  **yaw 慣例**：yaw=0 面向 **−z**（與 `src/player/physics.ts` 一致）→ 玩家的
 *  前方水平方向為 `fx = −sin(yaw)`、`fz = −cos(yaw)`。
 *
 *  **面後視角（back）**：相機放在玩家的**後方**（yaw=0 時是 **+z** 方向），
 *  `yaw`／`pitch` 維持玩家值 → 視線方向與玩家一致。
 *  **（既有 bug 提醒）**：repo 既有 `src/main.ts` 的第三身相機放在玩家的
 *  **前方**（射線與畫面不一致）；Task 11 會改成以本模組回傳的姿態為準。
 *
 *  **面前視角（front）**：相機放在玩家的**前方**（yaw=0 時是 −z 方向），且
 *  **yaw 反轉 180°**（`yaw + π`）→ 相機面向玩家、看得見玩家正面，與原版
 *  「third person from the front」一致。
 *
 *  **互動射線一律以本模組回傳的姿態為準**（相機位置＋yaw／pitch）：Task 11 的
 *  挖掘／放置／攻擊射線都從 `viewPose()` 的結果推導，不再另外算一份方向，
 *  否則「畫面看到的方向」與「實際互動的方向」會不一致。
 *
 *  **防 NaN**：eye／yaw／pitch 任一非有限（NaN／±∞）→ 該值視為 0，避免壞值
 *  經過 sin／cos 擴散成 NaN 汙染相機姿態。
 *
 *  純度：本模組回傳全新物件（`pos` 不與入參 `eye` 別名），入參一律不被修改，
 *  也不持有任何狀態。 */

/** 視角模式：`first`＝第一人稱、`back`＝面後第三身、`front`＝面前第三身。 */
export type ViewMode = 'first' | 'back' | 'front';

/** 視角循環順序（`nextViewMode` 依此前進，到尾端繞回第一個）。 */
export const VIEW_MODE_ORDER: readonly ViewMode[] = ['first', 'back', 'front'];

/** 第三身相機與玩家的水平距離（格）。 */
export const THIRD_PERSON_DISTANCE = 4;

/** 第三身相機相對眼睛的高度偏移（格）。 */
export const THIRD_PERSON_HEIGHT_OFFSET = 0.5;

/** 一幀的相機姿態（純數值；套用到 Three 相機由 `src/main.ts` 負責）。 */
export interface ViewPose {
  /** 相機位置（世界座標）。 */
  pos: { x: number; y: number; z: number };
  /** 相機水平朝向（弧度；yaw=0 面向 −z）。 */
  yaw: number;
  /** 相機俯仰（弧度；正數為上看）。 */
  pitch: number;
}

/** 下一個視角模式：`first → back → front → first`（繞回，無終止）。
 *
 *  `mode` 不在 `VIEW_MODE_ORDER` 內（型別已擋掉，此處僅為防護）→ 回第一個
 *  模式 `first`。 */
export function nextViewMode(mode: ViewMode): ViewMode {
  const i = VIEW_MODE_ORDER.indexOf(mode);
  if (i < 0) return VIEW_MODE_ORDER[0];
  return VIEW_MODE_ORDER[(i + 1) % VIEW_MODE_ORDER.length];
}

/** 非有限值（NaN／±∞）→ 0；防壞值經 sin／cos 擴散成 NaN 汙染相機姿態。 */
function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** 依視角模式算出相機姿態。**回傳全新物件，入參 `eye` 不被修改。**
 *
 *  - `first`：相機就在眼睛（`pos = eye`），yaw／pitch 為玩家值。
 *  - `back`：相機在玩家**後方**（沿前方水平方向的反向 `THIRD_PERSON_DISTANCE`
 *    格，再加 `THIRD_PERSON_HEIGHT_OFFSET` 的高度），yaw／pitch 維持玩家值。
 *  - `front`：相機在玩家**前方**（沿前方水平方向 `THIRD_PERSON_DISTANCE` 格，
 *    高度偏移同上），**yaw 反轉 180°**（`yaw + π`）、pitch 維持玩家值 → 相機
 *    面向玩家（與原版「third person from the front」一致）。
 *
 *  `eye`／`yaw`／`pitch` 的任一分量非有限 → 該分量視為 0。 */
export function viewPose(
  mode: ViewMode,
  eye: { x: number; y: number; z: number },
  yaw: number,
  pitch: number,
): ViewPose {
  const ex = finiteOrZero(eye.x);
  const ey = finiteOrZero(eye.y);
  const ez = finiteOrZero(eye.z);
  const y = finiteOrZero(yaw);
  const p = finiteOrZero(pitch);

  if (mode === 'first') {
    return { pos: { x: ex, y: ey, z: ez }, yaw: y, pitch: p };
  }

  // 前方水平方向（yaw 慣例：yaw=0 面向 −z，與 src/player/physics.ts 一致）
  const fx = -Math.sin(y);
  const fz = -Math.cos(y);
  // 面前視角：相機在前方（+f）；面後視角：相機在後方（−f）
  // （非預期的 mode 字串走面後分支；型別已擋掉，僅為防護）
  const front = mode === 'front';
  const dx = (front ? fx : -fx) * THIRD_PERSON_DISTANCE;
  const dz = (front ? fz : -fz) * THIRD_PERSON_DISTANCE;

  return {
    pos: { x: ex + dx, y: ey + THIRD_PERSON_HEIGHT_OFFSET, z: ez + dz },
    yaw: front ? y + Math.PI : y,
    pitch: p,
  };
}
