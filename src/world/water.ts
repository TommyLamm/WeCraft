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
 *  - `WATER_FALL` 不向側面供給（`waterSpreadLevel` 回 null）——水柱只往下。
 *  - 未載入的區塊一律不讀寫：不排程、不當空氣、不供水。 */

import { BLOCK, isWaterBlock, type BlockId } from './blocks';
import { CHUNK_HEIGHT, CHUNK_SIZE } from './chunk';

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
    const next = this.nextFor(x, y, z);
    if (next === id) return false;
    this.grid.setBlock(x, y, z, next);
    this.scheduleNeighbors(x, y, z);
    return true;
  }

  /** 這格下一步該是什麼。規則（brief 釘死）：先找供給，沒供給 → AIR；
   *  有供給時下方是空氣 → 先往下（WATER_FALL）；上方是水且下方也是水 →
   *  維持水柱（WATER_FALL）；上方是水但下方不是水 → 落地（FLOW_1）；
   *  只有水平供給 → 距離＋1。 */
  private nextFor(x: number, y: number, z: number): BlockId {
    const above = this.read(x, y + 1, z);
    const below = this.read(x, y - 1, z);
    const aboveWater = above !== null && isWaterBlock(above);

    // 水平供給：4 鄰居取 `waterSpreadLevel` 的最小值 +1；只接受 < 7 的鄰居
    // （FLOW_7 不再往外供給）。鄰居未載入 → 視為不可流入（不當空氣、不供水）。
    let minLevel: number | null = null;
    for (const [dx, dz] of HORIZONTAL) {
      const nid = this.read(x + dx, y, z + dz);
      if (nid === null) continue;
      const lvl = waterSpreadLevel(nid);
      if (lvl === null || lvl >= WATER_MAX_LEVEL) continue;
      if (minLevel === null || lvl < minLevel) minLevel = lvl;
    }

    if (!aboveWater && minLevel === null) return BLOCK.AIR; // 兩者都沒有 → 退縮成空氣

    if (below === BLOCK.AIR) return BLOCK.WATER_FALL; // 下方是空氣 → 先往下，不管水平距離
    if (aboveWater) {
      const belowWater = below !== null && isWaterBlock(below);
      // 上方是水：下方也是水 → 維持下落水柱；下方是固體／花草／火把 → 落地
      return belowWater ? BLOCK.WATER_FALL : BLOCK.WATER_FLOW_1;
    }
    // 只有水平供給 → 距離＋1（minLevel 此處必不為 null）
    return waterBlockForLevel((minLevel as number) + 1);
  }
}
