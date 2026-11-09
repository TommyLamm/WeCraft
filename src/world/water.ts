/** B16 流動水的純邏輯模擬。不碰渲染、不碰 main.ts——只吃一個 `WaterGrid`
 *  抽象介面，把「水怎麼流」完整封裝在這裡（整合是後面 Task 的工作）。
 *
 *  規則總覽（照 brief 實作，不另創規則）：
 *  - 水源（`BLOCK.WATER`，id 9）永不改寫；流動水是 `WATER_FLOW_1..7`（水平距離
 *    1–7）與 `WATER_FALL`（下落水柱）。
 *  - 每滿 `WATER_TICK_SEC`（0.25 秒）處理一批，每批最多
 *    `WATER_MAX_UPDATES_PER_TICK`（256）格；`dt` 累加到門檻就**歸零**，不補償
 *    大量 tick（畫面掉幀時水只變慢，不會暴衝）。
 *  - 先往下、再落地、再水平：供給格下方是空氣 → `WATER_FALL`；有水在上、下方
 *    是固體 → `WATER_FLOW_1`（落地）；只有水平供給 → 距離＋1 的 `WATER_FLOW_n`。
 *  - 水平供給是**方向性的**（Ruling T2-1）：已是流動水的格子只接受「更近水源」
 *    的新水位——候選水位大於現況代表原供給鏈斷了，直接退成空氣（單調退去，
 *    移除水源絕不出現「水位先迴漲」的波）；空氣格照常採用候選水位流入，但
 *    **垂死的鄰居不算供給**（它自己都保不住，才不會從它生出迴漲波）。
 *  - `WATER_FALL` 不向側面供給（`waterSpreadLevel` 回 null）——水柱只往下。
 *  - 未載入的區塊一律不讀寫：不排程、不當空氣、不供水。 */

import { BLOCK, isWaterBlock, type BlockId } from './blocks';
import { CHUNK_HEIGHT, CHUNK_SIZE } from './chunk';
import { SEA_LEVEL } from './terrain-noise';

export const WATER_TICK_SEC = 0.25;
export const WATER_MAX_UPDATES_PER_TICK = 256;
export const WATER_MAX_LEVEL = 7;

/** 水模擬對世界的最小介面：讀寫方塊＋「這格的區塊載入了嗎」。
 *  未載入的格子一律不讀寫（`isLoaded` false → 模擬當它不存在）。 */
export interface WaterGrid {
  getBlock(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, id: BlockId): void;
  /** 該 x/z 所屬區塊是否已載入；未載入的格子一律不讀寫。 */
  isLoaded(x: number, z: number): boolean;
}

const FLOW_MIN = BLOCK.WATER_FLOW_1;
const FLOW_MAX = BLOCK.WATER_FLOW_7;

/** 水的「水平距離」：水源 0、FLOW_1..FLOW_7 1..7、WATER_FALL 與非水 null。 */
export function waterFlowLevel(id: number): number | null {
  if (id === BLOCK.WATER) return 0;
  if (id >= FLOW_MIN && id <= FLOW_MAX) return id - FLOW_MIN + 1;
  return null;
}

/** 與 `waterFlowLevel` 相同，但 `WATER_FALL` 回 null——下落水柱不向側面供給。 */
export function waterSpreadLevel(id: number): number | null {
  if (id === BLOCK.WATER_FALL) return null;
  return waterFlowLevel(id);
}

/** 距離 → 方塊：0 → 水源、1..7 → FLOW_n；非有限值／非整數／越界 → AIR
 *  （永遠不憑空生出水源，也不產生非法 id）。 */
export function waterBlockForLevel(level: number): BlockId {
  if (!Number.isFinite(level) || !Number.isInteger(level)) return BLOCK.AIR;
  if (level < 0 || level > WATER_MAX_LEVEL) return BLOCK.AIR;
  if (level === 0) return BLOCK.WATER;
  return (FLOW_MIN + level - 1) as BlockId;
}

/** 流動水（可被模擬改寫的水）：FLOW_1..7 與 WATER_FALL。水源不算——水源永不改寫。 */
const isFlowingWater = (id: number): boolean => id >= FLOW_MIN && id <= BLOCK.WATER_FALL;

/** 排程／擴散用的固定方向（順序固定 → 佇列順序可重現、模擬結果確定性）。 */
const NEIGHBORS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
const HORIZONTAL: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

export class WaterSim {
  private readonly grid: WaterGrid;
  /** 待處理格。`Map` 保留插入順序（FIFO 批次）；重複排程同一格不改變位置。 */
  private queue = new Map<string, readonly [number, number, number]>();
  /** 距下一次批次的累積時間（秒）。 */
  private acc = 0;

  constructor(grid: WaterGrid) {
    this.grid = grid;
  }

  get pendingCount(): number {
    return this.queue.size;
  }

  /** 外部方塊變更（setBlock）後呼叫：排程該格與 6 鄰居。
   *  只排程已載入、y 在 `0..CHUNK_HEIGHT-1` 的格子（逐格過濾）。 */
  notifyBlockChanged(x: number, y: number, z: number): void {
    this.schedule(x, y, z);
    for (const [dx, dy, dz] of NEIGHBORS) this.schedule(x + dx, y + dy, z + dz);
  }

  /** 從 modified overlay 重排程；給 `chunk` 時只收該區塊 ±1 範圍的條目。
   *  key 格式 `"x,y,z"`（三個整數）；解析失敗的條目略過、不拋錯。
   *  回傳實際排程（呼叫 notifyBlockChanged）的條目數。 */
  scheduleFromModified(
    entries: Iterable<readonly [string, number]>,
    chunk?: { cx: number; cz: number },
  ): number {
    let scheduled = 0;
    const minX = chunk ? chunk.cx * CHUNK_SIZE - 1 : -Infinity;
    const maxX = chunk ? (chunk.cx + 1) * CHUNK_SIZE : Infinity;
    const minZ = chunk ? chunk.cz * CHUNK_SIZE - 1 : -Infinity;
    const maxZ = chunk ? (chunk.cz + 1) * CHUNK_SIZE : Infinity;
    for (const entry of entries) {
      const parts = entry[0].split(',');
      if (parts.length !== 3) continue;
      if (!parts.every((p) => /^-?\d+$/.test(p))) continue;
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      const z = Number(parts[2]);
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      this.notifyBlockChanged(x, y, z);
      scheduled++;
    }
    return scheduled;
  }

  /** B16 最終審查修正（I-2）：**區塊生成後**掃描「緊鄰水的空氣格」並排程。
   *
   *  **為什麼需要**：生成的地形**不進** `modified`（它不是編輯）→ 只靠
   *  `scheduleFromModified` 永遠看不到「生成時就開在海水旁的洞穴口」
   *  （`terrain.ts` 的洞穴切挖會把海平面以下、旁邊是海的格子挖成空氣）→
   *  海水不會灌進那個洞穴口。這個方法在生成後補掃一次。
   *
   *  **規則**（對稱的兩條，兩種生成順序都涵蓋）：
   *  - 空氣格的 6 鄰居有水 → 排程**那個空氣格**。
   *  - 水格的 6 鄰居有空氣 → 排程**那個空氣鄰居**（涵蓋「洞穴區塊先生成、
   *    海的區塊後生成」的順序）。
   *
   *  **海平面帶（`y ∈ [1, min(SEA_LEVEL, CHUNK_HEIGHT-1)]`）是刻意的**：生成
   *  的海水只存在於海平面以下；把「海面上方那一層空氣」也排進去只會白灌
   *  256 格／批的預算（那格永遠不會變）。鄰居也限在同一條帶內。
   *
   *  未載入的鄰居**既不當空氣、也不供水**（`read` 回 null → 直接略過）；
   *  排程仍走既有的 `schedule`（未載入／y 越界 → 不排程）。
   *  回傳**新排入佇列**的格數（重複排程由佇列的 Map 去重）。 */
  scheduleWaterEdges(cx: number, cz: number): number {
    const yMax = Math.min(SEA_LEVEL, CHUNK_HEIGHT - 1);
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    const before = this.queue.size;
    for (let y = 1; y <= yMax; y++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const x = x0 + lx;
          const z = z0 + lz;
          const id = this.read(x, y, z);
          if (id === null) continue; // 未載入 → 當它不存在
          if (id === BLOCK.AIR) {
            // 空氣格：鄰居有水 → 排程自己（水會從那裡流進來）。
            for (const [dx, dy, dz] of NEIGHBORS) {
              const ny = y + dy;
              if (ny < 1 || ny > yMax) continue; // 鄰居限在同一條海平面帶內
              const nid = this.read(x + dx, ny, z + dz);
              if (nid !== null && isWaterBlock(nid)) {
                this.schedule(x, y, z);
                break;
              }
            }
          } else if (isWaterBlock(id)) {
            // 水格：鄰居有空氣 → 排程那個空氣鄰居（海先生成、洞穴後生成時）。
            for (const [dx, dy, dz] of NEIGHBORS) {
              const ny = y + dy;
              if (ny < 1 || ny > yMax) continue;
              const nx = x + dx;
              const nz = z + dz;
              if (this.read(nx, ny, nz) === BLOCK.AIR) this.schedule(nx, ny, nz);
            }
          }
        }
      }
    }
    return this.queue.size - before; // 去重後「新排入」的格數
  }

  /** 推進 dt；每滿 `WATER_TICK_SEC` 處理一批（最多 256 格）。
   *  回傳本批「實際變更」的格數（setBlock 呼叫數）。 */
  tick(dtSec: number): number {
    if (!Number.isFinite(dtSec) || dtSec <= 0) return 0;
    this.acc += dtSec;
    if (this.acc < WATER_TICK_SEC) return 0;
    this.acc = 0; // 歸零不補償：掉幀時水變慢，不會一次補跑幾十批

    // 先取本批 key 快照；批次中新增的排程（變更格的鄰居）只進下一批。
    // 已在快照內的格子被重複排程時 `Map.set` 保留原位，仍屬本批。
    const batch = Array.from(this.queue.keys()).slice(0, WATER_MAX_UPDATES_PER_TICK);
    let changed = 0;
    for (const key of batch) {
      const pos = this.queue.get(key);
      if (!pos) continue; // 理論上到不了（自己才會刪自己），防禦性保留
      this.queue.delete(key);
      if (this.process(pos[0], pos[1], pos[2])) changed++;
    }
    return changed;
  }

  reset(): void {
    this.queue.clear();
    this.acc = 0;
  }

  /** 排程一格（自己或鄰居共用）：未載入／y 越界 → 不排程。
   *  已在佇列的格子 `Map.set` 保留插入位置（重複排程不重排）。 */
  private schedule(x: number, y: number, z: number): void {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    if (!this.grid.isLoaded(x, z)) return;
    this.queue.set(`${x},${y},${z}`, [x, y, z]);
  }

  /** 變更格只排程 6 鄰居（不排程自己）——自己剛算完，不用重算。 */
  private scheduleNeighbors(x: number, y: number, z: number): void {
    for (const [dx, dy, dz] of NEIGHBORS) this.schedule(x + dx, y + dy, z + dz);
  }

  /** 讀一格：未載入或 y 越界 → null（呼叫端視為「不可流入／不存在」，
   *  **不當空氣**——未載入的格子既不供水也不接收水）。 */
  private read(x: number, y: number, z: number): number | null {
    if (y < 0 || y >= CHUNK_HEIGHT) return null;
    if (!this.grid.isLoaded(x, z)) return null;
    return this.grid.getBlock(x, y, z);
  }

  /** 處理佇列一格。回傳是否有變更。 */
  private process(x: number, y: number, z: number): boolean {
    if (!this.grid.isLoaded(x, z)) return false; // 未載入 → 跳過（也永不寫入）
    const id = this.grid.getBlock(x, y, z);
    if (id === BLOCK.WATER) return false; // 水源永不改寫
    // 只有空氣與流動水參與：空氣是「可能變成水」的目標格（只算流動水的話
    // 水永遠流不進新格子）；固體／花草／火把都不會被水取代。
    if (id !== BLOCK.AIR && !isFlowingWater(id)) return false;
    const next = this.nextFor(x, y, z, id as BlockId);
    if (next === id) return false;
    this.grid.setBlock(x, y, z, next);
    this.scheduleNeighbors(x, y, z);
    return true;
  }

  /** 這格下一步該是什麼。規則（brief 釘死＋Ruling T2-1）：先找供給，沒供給 → AIR；
   *  有供給時下方是空氣 → 先往下（WATER_FALL）；上方是水且下方也是水 →
   *  維持水柱（WATER_FALL）；上方是水但下方不是水 → 落地（FLOW_1）；
   *  只有水平供給 → 方向性：空氣採用候選水位；流動水只能變濃或退去（候選大於
   *  現況 = 供給鏈斷了 → AIR），等級絕不上升（單調退去、無迴漲波）。
   *
   *  `checkSupplyStability`（單調性的落地機制）：true 時，**垂死的**水平鄰居
   *  不算供給——用 plain 規則（`checkSupplyStability: false`，不再往下探、
   *  不遞迴）算它自己的下一步，回不到自己＝它的供給鏈斷了。讓空氣格從垂死
   *  鄰居拿候選，會在移除水源後生出「退去後又迴漲」的波（實測：移除源頭後
   *  (0) 先閃成 F2 → 漣漪 F3/F4 → 把已退成空氣的 (1) 重新淹成 F5）。
   *  水源永不改寫 → 視為永遠穩定。 */
  private nextFor(
    x: number, y: number, z: number, id: BlockId,
    checkSupplyStability = true,
  ): BlockId {
    const above = this.read(x, y + 1, z);
    const below = this.read(x, y - 1, z);
    const aboveWater = above !== null && isWaterBlock(above);

    // 水平供給：4 鄰居取 `waterSpreadLevel` 的最小值 +1；只接受 < 7 的鄰居
    // （FLOW_7 不再往外供給）。鄰居未載入 → 視為不可流入（不當空氣、不供水）。
    let minLevel: number | null = null;
    for (const [dx, dz] of HORIZONTAL) {
      const nx = x + dx;
      const nz = z + dz;
      const nid = this.read(nx, y, nz);
      if (nid === null) continue;
      const lvl = waterSpreadLevel(nid);
      if (lvl === null || lvl >= WATER_MAX_LEVEL) continue;
      if (checkSupplyStability && nid !== BLOCK.WATER
        && this.nextFor(nx, y, nz, nid as BlockId, false) !== nid) continue;
      if (minLevel === null || lvl < minLevel) minLevel = lvl;
    }

    if (!aboveWater && minLevel === null) return BLOCK.AIR; // 兩者都沒有 → 退縮成空氣

    if (below === BLOCK.AIR) return BLOCK.WATER_FALL; // 下方是空氣 → 先往下，不管水平距離
    if (aboveWater) {
      const belowWater = below !== null && isWaterBlock(below);
      // 上方是水：下方也是水 → 維持下落水柱；下方是固體／花草／火把 → 落地
      return belowWater ? BLOCK.WATER_FALL : BLOCK.WATER_FLOW_1;
    }
    // 只有水平供給（Ruling T2-1：方向性供給 → 單調退去）：
    //  - 空氣（或失去上供水的水柱）→ 採用候選水位，水照樣流進新格子。
    //  - 已是流動水：候選 < 現在 → 變濃（出現更近水源）；候選 == → 不變；
    //    候選 > 現在 → 原供給鏈斷了 → 直接退成空氣。等級**不得上升**
    //    （否則移除水源會出現「先迴漲再消失」的波）。
    const candidate = (minLevel as number) + 1;
    if (id === BLOCK.AIR || id === BLOCK.WATER_FALL) return waterBlockForLevel(candidate);
    const current = waterFlowLevel(id) as number; // id 必為 FLOW_1..7 → 1..7
    if (candidate <= current) return waterBlockForLevel(candidate);
    return BLOCK.AIR;
  }
}
