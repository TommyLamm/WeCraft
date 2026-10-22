/**
 * 被動生物的持久化（B4 Task 10）——**附加欄位**，格式**沒有**升版。
 *
 * **本批只是附加欄位、格式未升版**：本機 payload 仍是 v3、雲端仍是 format 1
 * （`game.json` 的 `cloudSave` 一字不動）→ 兩邊都只是多蓋一個**可選**的
 * `passiveMobs` 鍵。舊版程式讀到不認識的欄位會直接忽略 → 舊存檔照樣能讀；
 * 新版讀舊存檔 → 舊記錄沒有這個鍵 → 沒有生物（空陣列），**不是**壞檔。
 *
 * **存什麼**：每隻一筆 `{ kind, x, y, z, hp, yaw }`（種類、座標、血量、朝向）。
 * - `width`／`height` **不存**（由 `kind` 推導）→ 存檔與定義表不會不同步。
 * - **`vel`／`kbVel` 是暫態，不序列化**：AI 每幀會把 `vel` 的水平速度換成自己的
 *   目標值、`kbVel` 每幀衰減 → 存下來只會還原出一個「正在被推」的幽靈狀態。
 *   **但載入後的物件必須有這兩個欄位且是有限數字**：`stepPassiveMob` 直接讀
 *   `m.kbVel.x`（沒有守衛）→ 少了欄位就是下一幀 TypeError。見
 *   {@link restorePassiveMobs}。
 *
 * **壞資料怎麼辦**：**丟棄該筆，不丟整包**（與 B1 的 `sanitizeStack`／
 * `normalizeModeStash` 同一風格）——一筆壞的紀錄不該讓整份存檔變成「無存檔」。
 *
 * **數量上限**：`MAX_PASSIVE_MOBS`（12，與生成上限**同一個常數**）→ 超過就只
 * 保留前 12 筆，後面的丟棄（存／讀之間不會有生物無聲消失）。
 * **兩條路徑都夾制**：`normalizePassiveMobs`（載入）與 `restorePassiveMobs`
 * （還原）各自都保證不超過 12 → **防禦縱深**，不依賴呼叫端有沒有先正規化。
 */

import {
  PASSIVE_DEFS,
  MAX_PASSIVE_MOBS,
  createPassiveMob,
  type PassiveKind,
  type PassiveMob,
} from './passive-mobs';

/** 一隻被動生物的**持久化記錄**（存檔／雲端 payload 裡的一筆）。 */
export interface PassiveMobRecord {
  /** 種類（雞／豬／羊／牛）。 */
  kind: PassiveKind;
  /** 腳底中心的 X 座標。 */
  x: number;
  /** 腳底中心的 Y 座標。 */
  y: number;
  /** 腳底中心的 Z 座標。 */
  z: number;
  /** 血量（0 < hp ≤ 該種類的上限）。 */
  hp: number;
  /** 面向（弧度）。停下時的面向是唯一能還原的姿態資訊 → 值得存。 */
  yaw: number;
}

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 種類是否在定義表裡。
 *
 * **原型鍵守門**（repo 慣例）：`PASSIVE_DEFS` 是物件字面值 → `PASSIVE_DEFS['toString']`
 * 會命中 `Object.prototype`（不是 `undefined`）→ 必須用 `hasOwnProperty` 判定，
 * 否則一個 `kind: 'toString'` 的髒紀錄就會變成「一種叫 toString 的生物」。 */
function isPassiveKind(v: unknown): v is PassiveKind {
  return (
    typeof v === 'string' && Object.prototype.hasOwnProperty.call(PASSIVE_DEFS, v)
  );
}

/**
 * 把場上的被動生物快照成持久化記錄（**純函式**、深拷貝）。
 *
 * 只取種類／座標／血量／朝向；`vel`／`kbVel`／`wander*`／`panic*` 等**暫態**
 * 欄位一律不寫（見檔頭說明）。回傳全新物件 → 呼叫端之後改動回傳值不會影響
 * 場上的生物。
 */
export function serializePassiveMobs(mobs: readonly PassiveMob[]): PassiveMobRecord[] {
  return mobs.map((m) => ({
    kind: m.kind,
    x: m.pos.x,
    y: m.pos.y,
    z: m.pos.z,
    hp: m.hp,
    yaw: m.yaw,
  }));
}

/**
 * 逐筆驗證一筆記錄 → 回傳**正規化後**的記錄；不合法 → `null`（這一筆要丟棄）。
 *
 * **這是「壞資料怎麼辦」的單一真值**：`normalizePassiveMobs`（載入路徑）與
 * `restorePassiveMobs`（還原路徑）**共用**這一支 → 兩邊的驗證規則不會漂移。
 * 檢查項目（六項，語意不可更動）：
 * 1. 種類在 {@link PASSIVE_DEFS}（含原型鍵守門）。
 * 2. 三個座標都是有限數字。
 * 3. `hp` 是有限數字且 **> 0**（死掉的生物不該被還原）。
 * 4. `hp` **夾到該種類的上限**（雞 4／羊 8／豬牛 10）。
 * 5. `yaw` 不是有限數字（或缺漏）→ 記成 `0`（該筆仍留著：朝向只是附帶資訊）。
 * 6. 整包不是陣列 → 由呼叫端處理（`normalizePassiveMobs` 回 `[]`）。
 */
function normalizePassiveRecord(item: unknown): PassiveMobRecord | null {
  if (typeof item !== 'object' || item === null) return null;
  const r = item as Record<string, unknown>;
  if (!isPassiveKind(r.kind)) return null;
  const { x, y, z } = r;
  if (!isFiniteNum(x) || !isFiniteNum(y) || !isFiniteNum(z)) return null;
  const hp = r.hp;
  if (!isFiniteNum(hp) || hp <= 0) return null;
  return {
    kind: r.kind,
    x,
    y,
    z,
    hp: Math.min(PASSIVE_DEFS[r.kind].hp, hp),
    yaw: isFiniteNum(r.yaw) ? r.yaw : 0,
  };
}

/**
 * 把（不可信的）原始資料正規化成一份**安全**的記錄清單。
 *
 * 規則（逐筆檢查，**壞的丟棄該筆、好的留著**；細節見
 * {@link normalizePassiveRecord}）：
 * - 整包不是陣列 → 回 `[]`。
 * - 累積到 {@link MAX_PASSIVE_MOBS}（12）就停止 → 後面的丟棄。
 *
 * 這是**載入路徑**的單一真值：本機存檔（`loadGame`）與雲端存檔
 * （`acceptCloudData`）都呼叫它 → 兩邊的行為不會漂移。
 */
export function normalizePassiveMobs(raw: unknown): PassiveMobRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: PassiveMobRecord[] = [];
  for (const item of raw) {
    // 上限先到就停（後面的記錄一律丟棄）——與生成端的「全場上限 12」同一個
    // 常數 → 存／讀之間不會有生物無聲消失。
    if (out.length >= MAX_PASSIVE_MOBS) break;
    const rec = normalizePassiveRecord(item);
    if (rec) out.push(rec);
  }
  return out;
}

/**
 * 把記錄還原成場上的被動生物（**純函式**；回傳全新物件）。
 *
 * 逐筆 `createPassiveMob(kind, {x, y, z})`（體型由定義表推導）→ 再覆寫血量與
 * 朝向（`createPassiveMob` 給的是滿血與隨機初始方向）。
 *
 * **`kbVel`／`vel` 一定要補成合法的有限值**：`stepPassiveMob` 直接讀
 * `m.kbVel.x`／`m.vel.x`（**沒有任何守衛**）、渲染器也讀 `mob.vel.x`（算行走
 * 週期）→ 這兩個欄位若缺漏，載入後的下一幀就會 TypeError（整局直接壞掉）。
 * 它們是**暫態**（不序列化），所以「載入後必須存在」這件事只能由還原端保證 ——
 * 這就是本函式明確把它們寫成零的原因。
 *
 * **數量上限也在這裡夾制**（**防禦縱深**）：本函式**自己**保證還原出來的生物
 * 不超過 {@link MAX_PASSIVE_MOBS}（12）→ 不管呼叫端有沒有先跑
 * {@link normalizePassiveMobs}，全場上限都不會被突破（否則有人直接呼叫這支
 * 傳 20 筆進來，就會還原 20 隻、違反「全場上限 12」的不變量）。
 *
 * 記錄本身若不合法（未知種類／非有限座標／非正血量）→ **跳過該筆**（不生出
 * 幽靈生物）；逐筆的驗證規則與 {@link normalizePassiveMobs} 共用同一支
 * {@link normalizePassiveRecord} → 兩邊不會漂移。
 */
export function restorePassiveMobs(records: readonly PassiveMobRecord[]): PassiveMob[] {
  const out: PassiveMob[] = [];
  for (const item of records) {
    // **全場上限（12）**——與生成端、存檔端同一個常數（防禦縱深：不依賴呼叫端
    // 有沒有先正規化）。
    if (out.length >= MAX_PASSIVE_MOBS) break;
    const rec = normalizePassiveRecord(item);
    if (!rec) continue;
    const mob = createPassiveMob(rec.kind, { x: rec.x, y: rec.y, z: rec.z });
    out.push({
      ...mob,
      hp: rec.hp, // 已由 normalizePassiveRecord 夾到該種類的上限
      yaw: rec.yaw, // 已由 normalizePassiveRecord 正規化（非有限 → 0）
      // **暫態欄位不序列化，但載入後必須存在且是有限數字**（否則 stepPassiveMob
      // 下一幀就 TypeError）→ 這裡明確寫成零。
      vel: { x: 0, y: 0, z: 0 },
      kbVel: { x: 0, z: 0 },
    });
  }
  return out;
}
