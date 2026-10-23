/** B6 方塊光引擎（Task 1）：方塊光的儲存、傳播、衰減與遮蔽。
 *
 *  資料模型：每格 1 byte（存在 `Chunk.light`，延遲配置）——bit 7..4 天空光、
 *  bit 3..0 方塊光。所有讀寫走**世界座標**；目標區塊不存在時讀 0、寫不進去
 *  （也不建立區塊）→ 鄰塊後生成時由「重算掃 3×3 群組來源」把光帶回來。
 *
 *  原版依據（minecraft.wiki/Light、minecraft.wiki/Torch，2026-10-20 查證，
 *  原文摘錄見 docs/superpowers/plans/2026-10-20-wecraft-b6-lighting.md §1）：
 *  - 16 個等級 0..15；火把 = 14。
 *  - 方塊光每格 −1（taxi-cab：6 方向各 −1，斜對角 = −2）。
 *  - 「Opaque blocks can prevent the spread of sky light」→ 不透明方塊擋光，
 *    且**不持有光**（值恆 0）——光源格本身除外：種子寫入不受遮蔽檢查限制。
 *
 *  佇列終止（2026-10-20 稽核修正）：`setLight` 對不存在的區塊寫不進去，此時
 *  **絕對不可把該格 push 進佇列**——否則「寫不進去 → 讀回恆 0 → 永遠比 next
 *  小 → 每次 pop 再生 6 個新項」→ 佇列無限膨脹 → RangeError／OOM。
 *
 *  已知簡化（寫進 README〈與原版的差異〉）：本引擎的 BFS 只從「種子格」往外
 *  傳播——天空光的水平傳播必須先被某個格「照亮」才會發生 → 從未被水平照到的
 *  開闊天空柱永遠是 0（天空光在 Task 2 接上時同理；垂直直曝柱由柱掃描種下）。 */

import { CHUNK_HEIGHT, CHUNK_SIZE, chunkIndex, type Chunk } from './chunk';
import { BLOCK, getBlockDef, isTransparent } from './blocks';
import type { World } from './world';

/** 最高光照等級（16 個等級 0..15）。 */
export const MAX_LIGHT = 15;
/** 火把的發光等級（minecraft.wiki/Torch：Luminous 14；Task 5 落地方塊）。 */
export const TORCH_LIGHT = 14;

export interface LightLevels {
  sky: number;
  block: number;
}

/** 6 方向鄰居（±x ±y ±z）。 */
const NEIGHBORS6: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** 把世界座標收斂成「整數格 + 區塊引用」。本引擎**內部一律用整數格座標**
 *  （入口處 Math.floor；`World.getBlock`／`setBlock` 的座標契約由 T1b 收口，
 *  本模組不動 world.ts 的座標處理）。回傳 null = 超出世界高度或區塊不存在。 */
function locate(
  world: World,
  x: number,
  y: number,
  z: number,
): { chunk: Chunk; lx: number; ly: number; lz: number; cx: number; cz: number } | null {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  if (iy < 0 || iy >= CHUNK_HEIGHT) return null;
  const cx = Math.floor(ix / CHUNK_SIZE);
  const cz = Math.floor(iz / CHUNK_SIZE);
  const chunk = world.getChunk(cx, cz);
  if (!chunk) return null;
  return { chunk, lx: ix - cx * CHUNK_SIZE, ly: iy, lz: iz - cz * CHUNK_SIZE, cx, cz };
}

/** 某格的方塊光（低 4 位）。區塊不存在 / 未點光 / 越界 → 0。 */
export function blockLightAt(world: World, x: number, y: number, z: number): number {
  const cell = locate(world, x, y, z);
  if (!cell || !cell.chunk.light) return 0;
  return cell.chunk.light[chunkIndex(cell.lx, cell.ly, cell.lz)] & 0x0f;
}

/** 某格的天空光（高 4 位）。區塊不存在 / 未點光 / 越界 → 0。 */
export function skyLightAt(world: World, x: number, y: number, z: number): number {
  const cell = locate(world, x, y, z);
  if (!cell || !cell.chunk.light) return 0;
  return cell.chunk.light[chunkIndex(cell.lx, cell.ly, cell.lz)] >> 4;
}

/** 某格的兩條光照通道。 */
export function lightAt(world: World, x: number, y: number, z: number): LightLevels {
  return { sky: skyLightAt(world, x, y, z), block: blockLightAt(world, x, y, z) };
}

/** 設定某格的光照；目標區塊不存在時**不寫入也不建立區塊**（回傳 false）。
 *  寫入成功會把該區塊標記為需要重網格（光變了 → 畫面要跟上）。 */
export function setLight(
  world: World,
  x: number,
  y: number,
  z: number,
  levels: LightLevels,
): boolean {
  const cell = locate(world, x, y, z);
  if (!cell) return false;
  const light = cell.chunk.ensureLight();
  light[chunkIndex(cell.lx, cell.ly, cell.lz)] = ((levels.sky & 0x0f) << 4) | (levels.block & 0x0f);
  world.markDirty(cell.cx, cell.cz);
  return true;
}

/** 某格是否為不透明（擋光）方塊。缺席區塊／越界 → 空氣 → 不擋光。 */
export function isOpaqueAt(world: World, x: number, y: number, z: number): boolean {
  return !isTransparent(world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
}

// 佇列以模組層級的可成長 Int32Array 儲存（每格 4 ints：x,y,z,level），
// head 索引前進、push 時容量不足就翻倍——避免每格配置物件。
let queue = new Int32Array(4096 * 4);
let queueHead = 0; // 下一個 pop 的格（單位：格，每格 4 ints）
let queueTail = 0; // 下一個 push 寫入的位置（單位：格）

function pushQueue(x: number, y: number, z: number, level: number): void {
  if ((queueTail + 1) * 4 > queue.length) {
    const grown = new Int32Array(queue.length * 2);
    grown.set(queue);
    queue = grown;
  }
  const base = queueTail * 4;
  queue[base] = x;
  queue[base + 1] = y;
  queue[base + 2] = z;
  queue[base + 3] = level;
  queueTail += 1;
}

function resetQueue(): void {
  queueHead = 0;
  queueTail = 0;
}

/** 由光源做 flood-fill 傳播（方塊光通道）：6 方向每格 −1（taxi-cab），
 *  不透明方塊擋光，只寫入比現值高的格。
 *
 *  ★ 目標格所在區塊不存在 → 不寫、**也不 push**（見檔頭註解）：
 *    `setLight` 回傳 false 時直接跳過，佇列必然耗盡。 */
export function propagateBlockLight(
  world: World,
  sx: number,
  sy: number,
  sz: number,
  level: number,
): void {
  resetQueue(); // 保險：即使前一次 propagate 異常中斷也從乾淨狀態開始
  pushQueue(Math.floor(sx), Math.floor(sy), Math.floor(sz), level);
  while (queueHead < queueTail) {
    const px = queue[queueHead * 4];
    const py = queue[queueHead * 4 + 1];
    const pz = queue[queueHead * 4 + 2];
    const lv = queue[queueHead * 4 + 3];
    queueHead += 1;
    if (lv <= 1) continue; // 再傳就是 0，不值得寫
    for (const [dx, dy, dz] of NEIGHBORS6) {
      const nx = px + dx;
      const ny = py + dy;
      const nz = pz + dz;
      if (ny < 0 || ny >= CHUNK_HEIGHT) continue;
      if (isOpaqueAt(world, nx, ny, nz)) continue; // 不透明方塊擋光（也不持有光）
      const next = lv - 1; // 每格 −1（taxi-cab）
      if (blockLightAt(world, nx, ny, nz) >= next) continue; // 只寫比現值高的格
      // ★ 目標區塊不存在 → setLight 回 false → 不寫、也不 push（否則佇列無限膨脹）
      if (!setLight(world, nx, ny, nz, { sky: skyLightAt(world, nx, ny, nz), block: next })) {
        continue;
      }
      pushQueue(nx, ny, nz, next);
    }
  }
  resetQueue();
}

/** (cx,cz) 與其八個鄰塊（含對角）中**已存在**的區塊（沒有就略過）。
 *  半徑 15 的光只可能從 3×3 群組內的來源到達本區塊 → 群組就是完整的來源集合。 */
export function groupChunks(world: World, cx: number, cz: number): Chunk[] {
  const group: Chunk[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const c = world.getChunk(cx + dx, cz + dz);
      if (c) group.push(c);
    }
  }
  return group;
}

/** 重算整個區塊的光照（清 0 → 播種 → BFS）。
 *
 *  粒度＝一個區塊，但播種範圍＝3×3 群組（2026-10-20 稽核修正）：
 *  - 只清空並重算區塊 (cx,cz) 自己；鄰塊由它們自己的重算負責。
 *  - 播種時掃描周圍 3×3 群組（含對角）內所有已存在區塊的發光來源；
 *    鄰塊不存在就跳過 → 光寫不進不存在的區塊（後生成時由它自己的重算拉回）。
 *  - 本任務只做方塊光通道；天空光在 Task 2 接上（骨架在此建立）。 */
export function computeChunkLight(world: World, cx: number, cz: number): void {
  const chunk = world.getChunk(cx, cz);
  if (!chunk) return;
  chunk.ensureLight().fill(0); // ★ 只清本區塊；鄰塊由它們自己的重算負責
  const cells = CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT;
  for (const src of groupChunks(world, cx, cz)) {
    for (let i = 0; i < cells; i++) {
      const emission = getBlockDef(src.data[i]).emission ?? 0;
      if (emission <= 0) continue;
      // 攤平索引 → (lx, ly, lz)；與 chunkIndex 的 layout 一致（x + z*16 + y*256）
      const ly = Math.floor(i / (CHUNK_SIZE * CHUNK_SIZE));
      const rem = i - ly * CHUNK_SIZE * CHUNK_SIZE;
      const lz = Math.floor(rem / CHUNK_SIZE);
      const lx = rem - lz * CHUNK_SIZE;
      const wx = src.cx * CHUNK_SIZE + lx;
      const wz = src.cz * CHUNK_SIZE + lz;
      // 種子寫入：光源格本身持有 emission（不受「不透明不持有光」限制——
      // 那條規則管的是 BFS 傳播不寫進不透明格）。
      if (!setLight(world, wx, ly, wz, { sky: skyLightAt(world, wx, ly, wz), block: emission })) {
        continue;
      }
      propagateBlockLight(world, wx, ly, wz, emission);
    }
  }
  chunk.lightDirty = false;
}

/** 把區塊與其**八個**鄰塊（含對角）標成需要重算光照。
 *  （2026-10-20 稽核修正：只標 4 個正交鄰塊會讓「挖掉區塊角落的火把」在對角
 *  鄰塊留下永久幽靈光——BFS 走 6 鄰居時會經過正交鄰塊寫進對角區塊。）
 *  不存在的鄰塊跳過；後生成的鄰塊由 3×3 群組播種把光帶回來。 */
export function markLightDirty(world: World, cx: number, cz: number): void {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const c = world.getChunk(cx + dx, cz + dz);
      if (c) c.lightDirty = true;
    }
  }
}

/** 掃一次區塊資料 → 最高的非空氣格 y + 1（生成完成時呼叫，呼叫端寫回
 *  `chunk.topY`）。地形是整塊寫入（`chunk.data.set(terrain)`、不經 setBlock），
 *  沒有這一步，生成出來的區塊 topY 會是 0 → 天空光柱不會往下掃（Task 2/3）。 */
export function computeChunkTopY(chunk: Chunk): number {
  for (let ly = CHUNK_HEIGHT - 1; ly >= 0; ly--) {
    const base = ly * CHUNK_SIZE * CHUNK_SIZE;
    for (let i = base; i < base + CHUNK_SIZE * CHUNK_SIZE; i++) {
      if (chunk.data[i] !== BLOCK.AIR) return ly + 1;
    }
  }
  return 0;
}
