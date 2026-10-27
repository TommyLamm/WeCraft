/** B6 光照引擎：方塊光（Task 1）＋天空光（Task 2）＋生命週期（Task 3）。
 *
 *  資料模型：每格 1 byte（存在 `Chunk.light`，延遲配置）——bit 7..4 天空光、
 *  bit 3..0 方塊光。所有讀寫走**世界座標**；目標區塊不存在時讀 0、寫不進去
 *  （也不建立區塊）→ 鄰塊後生成時由「重算掃 3×3 群組來源」把光帶回來。
 *
 *  原版依據（minecraft.wiki/Light、minecraft.wiki/Torch，2026-10-20 查證，
 *  原文摘錄見 docs/superpowers/plans/2026-10-20-wecraft-b6-lighting.md §1）：
 *  - 16 個等級 0..15；火把 = 14。
 *  - 方塊光每格 −1（taxi-cab：6 方向各 −1，斜對角 = −2）。
 *  - 天空光垂直下傳不衰減（直曝柱），其餘每格 −1。
 *  - 「Opaque blocks can prevent the spread of sky light」→ 不透明方塊擋光，
 *    且**不持有光**（值恆 0）——光源格本身除外：種子寫入不受遮蔽檢查限制。
 *
 *  佇列終止（2026-10-20 稽核修正）：`setLight` 對不存在的區塊寫不進去，此時
 *  **絕對不可把該格 push 進佇列**——否則「寫不進去 → 讀回恆 0 → 永遠比 next
 *  小 → 每次 pop 再生 6 個新項」→ 佇列無限膨脹 → RangeError／OOM。
 *
 *  生命週期（Task 3，重算粒度＝**3×3 群組**）：放置／破壞方塊 → `World.setBlock`
 *  標 `lightDirty`（本區塊＋八鄰）→ 下一幀由 main 的光照佇列重算（每幀取 2 項、
 *  近→遠排序；一項重算整個 3×3 群組，同群組的其他項因旗標已清而跳過）並重網格化。
 *  **不做逐格 remove-BFS**：逐格版本要處理「光要往回吸」的邊界條件，錯誤率高、
 *  難測；群組重算冪等（2026-10-25 整合審查修正：單塊版本會讓對角區塊失去光源，
 *  見 `computeChunkLight` 的說明）。
 *
 *  效能註記（Task 3 實測）：BFS 內層每個候選格要解析「屬於哪個區塊」2-3 次，
 *  逐格走 `world.getChunk` 的字串鍵 Map（`${cx},${cz}` 組合＋雜湊）時，單次
 *  群組天空播種實測 ~150 ms、16 區塊生成＋點光 ~6.2 s（超出 B3 預算 4 倍）。
 *  → 熱迴圈（柱掃描＋兩條 BFS）改走「4 槽 parity 區塊快取＋直寫 light 陣列」
 *  （見下方解析快取），寫入內容與公開逐格 API **逐位元相同**；公開 API
 *  （`lightAt`／`setLight`／`isOpaqueAt`…）維持原路徑，供測試與冷路徑使用。
 *
 *  已知簡化（寫進 README〈與原版的差異〉）：透明格（水／玻璃／葉／植被）不做
 *  過濾衰減（原版每格再 −1）。Task 1 時代「從未被水平照到的開闊天空柱恆 0」
 *  的簡化已隨 Task 2 的全高柱掃描（R-T2-1）消失——開闊柱一律種滿 15。 */

import { CHUNK_HEIGHT, CHUNK_SIZE, chunkIndex, type Chunk } from './chunk';
import { BLOCK, getBlockDef, isCross, isTransparent, isSolid } from './blocks';
import type { World } from './world';
import { torchAttachAt } from './mesher';
import { dayFactor } from '../core/daynight';
// 生怪判準的形狀（type-only import → 無運行期循環依賴；判準本體在 spawn-rules）
import type { SpawnLight } from './spawn-rules';

/** 最高光照等級（16 個等級 0..15）。 */
export const MAX_LIGHT = 15;
/** 火把的發光等級（minecraft.wiki/Torch：Luminous 14；Task 5 落地方塊）。 */
export const TORCH_LIGHT = 14;

/** 透明度查表（**熱路徑專用**）：模組載入時從 DEFS 快照。BFS 內層每個候選格
 *  都要問一次「擋不擋光」，逐格 `getBlockDef(id).transparent` 是 Record 查找＋
 *  屬性存取；Uint8Array 查表是單次陣列讀取。快照安全的原因：執行期只會變異
 *  `emission`（lighting.test.ts 借 POPPY 暫補 14 當測試光源），`transparent`
 *  從不被改動 → 方塊光／天空光的 emission 仍走逐格 `getBlockDef(...).emission
 *  ?? 0` 正是為了尊重這類執行期變異。未知 id → fallback 空氣（透明）＝與
 *  `isTransparent` 同義。 */
const TRANSPARENT = new Uint8Array(256);
for (let id = 0; id < TRANSPARENT.length; id++) {
  TRANSPARENT[id] = getBlockDef(id).transparent ? 1 : 0;
}

export interface LightLevels {
  sky: number;
  block: number;
}

/** 6 方向鄰居（±x ±y ±z），攤平儲存——熱迴圈以索引取用，避免 iterator／
 *  解構的每格開銷（順序與原本的陣列一致，傳播結果不變）。 */
const NEIGHBORS6 = new Int8Array([
  1, 0, 0, // +x
  -1, 0, 0, // −x
  0, 1, 0, // +y
  0, -1, 0, // −y
  0, 0, 1, // +z
  0, 0, -1, // −z
]);

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

// ── 熱路徑的區塊解析快取（Task 3）────────────────────────────────────────────
//
// 每個「會解析區塊」的公開入口先 `resetResolveCache()`：公開呼叫之間區塊可能
// 被新增／移除（gen 回應、視距卸載、resetWorld）；而單一同步操作內部引擎從不
// 增刪區塊 → 操作內的快取命中絕對安全。
//
// 4 槽 direct-mapped，槽號 = (cx&1) | (cz&1)<<1：**3×3 群組的九個區塊恰好每個
// parity 槽各一塊** → 群組掃描零碰撞；光最多再往群組外傳 15 格，最壞情況驅逐
// 群組內的槽 → 退回一次 Map 查詢，只損速度、不損正確性。
const RESOLVE_SLOTS = 4;
const rcWorld: Array<World | null> = new Array(RESOLVE_SLOTS).fill(null);
const rcCx = new Int32Array(RESOLVE_SLOTS);
const rcCz = new Int32Array(RESOLVE_SLOTS);
const rcChunk: Array<Chunk | undefined> = new Array(RESOLVE_SLOTS).fill(undefined);

function resetResolveCache(): void {
  rcWorld.fill(null);
}

/** 帶快取的 `world.getChunk`。只能在公開入口 reset 之後的同步操作內使用。 */
function chunkCached(world: World, cx: number, cz: number): Chunk | undefined {
  const s = (cx & 1) | ((cz & 1) << 1);
  if (rcWorld[s] === world && rcCx[s] === cx && rcCz[s] === cz) return rcChunk[s];
  const chunk = world.getChunk(cx, cz);
  rcWorld[s] = world;
  rcCx[s] = cx;
  rcCz[s] = cz;
  rcChunk[s] = chunk;
  return chunk;
}

// 位元位移（`>> CHUNK_SHIFT`／`& CHUNK_MASK`）取代 floor 除法／取模：負座標下
// 算術右移正是 floor 除法（-1 >> 4 = -1）、遮罩取出的是正餘數（-1 & 15 = 15），
// 與 `Math.floor(x / CHUNK_SIZE)` 逐值相同。載入時靜態檢查守住「2 的冪」前提。
const CHUNK_SHIFT = Math.round(Math.log2(CHUNK_SIZE));
const CHUNK_MASK = CHUNK_SIZE - 1;
if ((1 << CHUNK_SHIFT) !== CHUNK_SIZE) {
  throw new Error(`lighting.ts: CHUNK_SIZE must be a power of two, got ${CHUNK_SIZE}`);
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
  resetResolveCache();
  resetQueue(); // 保險：即使前一次 propagate 異常中斷也從乾淨狀態開始
  pushQueue(Math.floor(sx), Math.floor(sy), Math.floor(sz), level);
  expandBlockQueue(world);
  resetQueue();
}

/** 方塊光 BFS 主循環（由 {@link propagateBlockLight} 驅動）：pop 一格 → 6 鄰居
 *  擴張。衰減＝每格 −1（taxi-cab）；不透明擋光；只寫比現值高的格；目標區塊
 *  不存在 → **不寫也不 push**（見檔頭的佇列終止規則）。
 *
 *  與逐格呼叫公開 API（`isOpaqueAt`／`blockLightAt`／`setLight`）**逐位元等價**，
 *  但內層走解析快取＋直寫 light 陣列（見解析快取註記）；`chunk.dirty = true`
 *  與 `setLight` 尾端的 `world.markDirty` 同義（markDirty = getChunk + dirty
 *  = true，而這裡的 chunk 正是剛解析出來的那一個）。 */
function expandBlockQueue(world: World): void {
  while (queueHead < queueTail) {
    const px = queue[queueHead * 4];
    const py = queue[queueHead * 4 + 1];
    const pz = queue[queueHead * 4 + 2];
    const lv = queue[queueHead * 4 + 3];
    queueHead += 1;
    if (lv <= 1) continue; // 再傳就是 0，不值得寫
    for (let n = 0; n < 6; n++) {
      const nx = px + NEIGHBORS6[n * 3];
      const ny = py + NEIGHBORS6[n * 3 + 1];
      const nz = pz + NEIGHBORS6[n * 3 + 2];
      if (ny < 0 || ny >= CHUNK_HEIGHT) continue;
      const cx = nx >> CHUNK_SHIFT;
      const cz = nz >> CHUNK_SHIFT;
      const chunk = chunkCached(world, cx, cz);
      if (!chunk) continue; // ★ 缺席區塊：不寫、也不 push（與 setLight 回 false 同義）
      const idx = chunkIndex(nx & CHUNK_MASK, ny, nz & CHUNK_MASK);
      if (TRANSPARENT[chunk.data[idx]] === 0) continue; // 不透明方塊擋光（也不持有光）
      const cur = chunk.light ? chunk.light[idx] : 0;
      const next = lv - 1; // 每格 −1（taxi-cab）
      if ((cur & 0x0f) >= next) continue; // 只寫比現值高的格
      chunk.ensureLight()[idx] = (cur & 0xf0) | next; // 方塊光進低位、天空光保留
      chunk.dirty = true; // 光變了 → 該區塊要重網格（等價於 setLight 的 markDirty）
      pushQueue(nx, ny, nz, next);
    }
  }
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

/** 把「群組外圈」已算好的光餵進群組邊界（單一通道）。
 *
 *  為什麼需要：群組整體重算＝清掉九塊再從**群組內**的來源播種；但群組邊界
 *  的格子也可能被**群組外**（最多 15 格）的來源照亮。外圈鄰塊若仍是乾淨的
 *  （lightDirty=false），它的光就是正確的 → 以 `level − 1` 餵進群組邊界即可；
 *  髒的鄰塊跳過（它稍後自己的重算會把光寫回來——寫入規則「只寫更高」保證
 *  「先算成較暗、再被鄰塊補亮」是安全方向）。
 *
 *  （2026-10-25 整合審查修正：原本只清目標區塊、BFS 只寫更高 → 已亮的鄰塊
 *  不會被重推，光無法穿過它進入「只清了自己的對角區塊」→ 火把放在區塊角落
 *  時，對角區塊會整片失去這支火把的光。群組整體重算＋邊界播種收口。） */
function seedGroupBoundary(
  world: World,
  group: readonly Chunk[],
  channel: 'sky' | 'block',
): void {
  const inGroup = new Set<string>();
  for (const c of group) inGroup.add(`${c.cx},${c.cz}`);
  for (const c of group) {
    for (let s = 0; s < 4; s++) {
      const ox = s === 0 ? 1 : s === 1 ? -1 : 0;
      const oz = s === 2 ? 1 : s === 3 ? -1 : 0;
      const ncx = c.cx + ox;
      const ncz = c.cz + oz;
      if (inGroup.has(`${ncx},${ncz}`)) continue; // 群組內：稍後由本輪 BFS 供光
      const n = world.getChunk(ncx, ncz);
      if (!n || n.lightDirty || !n.light) continue; // 髒鄰塊：留給它自己的重算
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        for (let k = 0; k < CHUNK_SIZE; k++) {
          const clx = ox === 1 ? CHUNK_SIZE - 1 : ox === -1 ? 0 : k;
          const clz = oz === 1 ? CHUNK_SIZE - 1 : oz === -1 ? 0 : k;
          const cIdx = chunkIndex(clx, y, clz);
          if (TRANSPARENT[c.data[cIdx]] === 0) continue;
          const nlx = ox === 1 ? 0 : ox === -1 ? CHUNK_SIZE - 1 : k;
          const nlz = oz === 1 ? 0 : oz === -1 ? CHUNK_SIZE - 1 : k;
          const nIdx = chunkIndex(nlx, y, nlz);
          if (TRANSPARENT[n.data[nIdx]] === 0) continue;
          const b = n.light[nIdx];
          const level = channel === 'sky' ? b >> 4 : b & 0x0f;
          if (level <= 1) continue;
          const next = level - 1;
          const light = c.ensureLight();
          const cur = light[cIdx];
          const curLevel = channel === 'sky' ? cur >> 4 : cur & 0x0f;
          if (curLevel >= next) continue; // 只寫更高（與 BFS 同一條規則）
          light[cIdx] =
            channel === 'sky' ? (next << 4) | (cur & 0x0f) : (cur & 0xf0) | next;
          c.dirty = true;
          pushQueue(c.cx * CHUNK_SIZE + clx, y, c.cz * CHUNK_SIZE + clz, next);
        }
      }
    }
  }
}

/** 重算 3×3 群組的光照（清 0 → 播種 → BFS），並把九塊都標成已點光。
 *
 *  **為什麼是群組而不是單塊**（2026-10-25 整合審查修正）：只清目標區塊時，
 *  BFS 從來源出發，若來源的鄰格已持有同級的光，`只寫更高` 會讓它**不推**——
 *  光就無法穿過「已亮的正交鄰塊」進入「剛清空的對角鄰塊」。火把在區塊角落、
 *  主迴圈按近→遠（來源→正交→對角）處理時，對角區塊會整片失去這支火把的光。
 *  九塊一起清、一起播種、一起 BFS，結果與處理順序無關；外圈邊界再從乾淨鄰塊
 *  補光（見 {@link seedGroupBoundary}）。
 *
 *  代價：原本 9 塊各自重算時，每塊都要掃一次 3×3 群組（9 × 47 ms）；群組
 *  整體重算只掃一次群組＋一次九塊 BFS，總成本反而下降。佇列裡同群組的其他
 *  八塊在 `lightDirty=false` 後由 main 的守門直接跳過。
 *
 *  天空光的播種語意（Task 2）不變：群組所有開闊柱一次播種＋一次多來源 BFS；
 *  柱掃描上界仍是全高（R-T2-1：topY 之上必為空氣）。 */
export function computeChunkLight(world: World, cx: number, cz: number): void {
  const chunk = world.getChunk(cx, cz);
  if (!chunk) return;
  resetResolveCache(); // 公開入口：下面的熱迴圈（BFS）要用解析快取
  const group = groupChunks(world, cx, cz);
  for (const c of group) c.ensureLight().fill(0); // 九塊一起清（見上方說明）
  const cells = CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT;
  // ── 方塊光：群組內所有發光來源一次播種＋一次多來源 BFS ──
  resetQueue();
  for (const src of group) {
    const light = src.ensureLight();
    for (let i = 0; i < cells; i++) {
      const emission = getBlockDef(src.data[i]).emission ?? 0;
      if (emission <= 0) continue;
      // 攤平索引 → (lx, ly, lz)；與 chunkIndex 的 layout 一致（x + z*16 + y*256）
      const ly = Math.floor(i / (CHUNK_SIZE * CHUNK_SIZE));
      const rem = i - ly * CHUNK_SIZE * CHUNK_SIZE;
      const lz = Math.floor(rem / CHUNK_SIZE);
      const lx = rem - lz * CHUNK_SIZE;
      const cur = light[i];
      if (emission <= (cur & 0x0f)) continue;
      // 種子寫入：光源格本身持有 emission（不受「不透明不持有光」限制——
      // 那條規則管的是 BFS 傳播不寫進不透明格）。
      light[i] = (cur & 0xf0) | emission;
      src.dirty = true;
      pushQueue(src.cx * CHUNK_SIZE + lx, ly, src.cz * CHUNK_SIZE + lz, emission);
    }
  }
  seedGroupBoundary(world, group, 'block');
  expandBlockQueue(world);
  // ── 天空光：群組開闊柱一次播種＋外圈邊界補光＋一次多來源 BFS ──
  resetQueue();
  for (const src of group) seedColumnsIntoQueue(src);
  seedGroupBoundary(world, group, 'sky');
  expandSkyQueue(world);
  resetQueue();
  for (const c of group) c.lightDirty = false;
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
 *  沒有這一步，生成出來的區塊 topY 會停在 0。**光照已不依賴 topY**（R-T2-1：
 *  柱掃描改全高），此值保留給 topY 的其他消費者與除錯。 */
export function computeChunkTopY(chunk: Chunk): number {
  for (let ly = CHUNK_HEIGHT - 1; ly >= 0; ly--) {
    const base = ly * CHUNK_SIZE * CHUNK_SIZE;
    for (let i = base; i < base + CHUNK_SIZE * CHUNK_SIZE; i++) {
      if (chunk.data[i] !== BLOCK.AIR) return ly + 1;
    }
  }
  return 0;
}

// ── 每幀光照佇列的排序與預算（B6 Task 8）────────────────────────────────────
//
// main.ts 把「近→遠排序」與「每幀最多取幾項」的判斷委託給這兩支**純函式**
// （判斷本體住進 lighting.ts 才能被單元測試釘死，見 lighting-perf.test.ts）；
// main.ts 只留接線。行為與 Task 3 的內聯版本逐位元相同：排序鍵同為
// `(cx - pcx) ** 2 + (cz - pcz) ** 2`、每幀預算同為 2 項（每項重算一個
// 3×3 群組；同群組的其餘項由 lightDirty 守門跳過）。

/** 取出本幀要點光的佇列項，數量 ≤ budget（讓「每幀 2 項」的預算可被單元
 *  測試釘死）。純函式：回傳**新陣列**（原佇列的前 `budget` 項）、不改動
 *  原佇列——消費（splice）由呼叫端負責，佇列可能還有下一幀要用的項目。
 *  預算 ≤ 0 → 空批次；預算 ≥ 佇列長度 → 全量的副本。 */
export function takeLightBudget(
  queue: Array<[number, number]>,
  budget: number,
): Array<[number, number]> {
  return queue.slice(0, Math.max(0, budget));
}

/** 依「到玩家的距離平方」遞增排序（近→遠）；回傳新陣列，不改動原陣列。
 *  座標單位：佇列項與 `playerX`／`playerZ` 都是**區塊座標**（main.ts 的
 *  pcx/pcz）——main.ts 先前的排序鍵正是 `(cx - pcx) ** 2 + (cz - pcz) ** 2`，
 *  本函式逐值相同。平手時維持原相對順序（`Array.prototype.sort` 穩定排序），
 *  與先前的原地 sort 行為一致。 */
export function sortLightQueueByDistance(
  queue: ReadonlyArray<[number, number]>,
  playerX: number,
  playerZ: number,
): Array<[number, number]> {
  return [...queue].sort(
    (a, b) =>
      (a[0] - playerX) ** 2 +
      (a[1] - playerZ) ** 2 -
      ((b[0] - playerX) ** 2 + (b[1] - playerZ) ** 2),
  );
}

// ── 天空光（B6 Task 2）───────────────────────────────────────────────────────

/** 夜間的渲染用天空比例（正午 1.0 → 夜間 0.85；Task 4 餵給著色器 uniform）。 */
export const SKY_SCALE_NIGHT = 0.85;
/** 極暗下限（Task 4 的頂點光 factor 夾在此之上，避免全黑）。 */
export const MIN_LIGHT_FACTOR = 0.05;

/** 渲染用天空比例：正午 1.0、夜間 `SKY_SCALE_NIGHT`（與日夜曲線同源）。 */
export function skyLightScale(t: number): number {
  return SKY_SCALE_NIGHT + (1 - SKY_SCALE_NIGHT) * dayFactor(t);
}

/** 內部天空光（生怪判準用，原版地下亮度曲線）：正午 15、午夜 4；
 *  天空光不足 15 時再減 (15 − skyLevel)（洞穴裡 = 0，永不為負）。 */
export function internalSkyLight(skyLevel: number, t: number): number {
  const base = 4 + (MAX_LIGHT - 4) * dayFactor(t); // 正午 15、午夜 4
  return Math.max(0, Math.round(base - (MAX_LIGHT - skyLevel)));
}

/** 某格的生怪光照（把區塊光照換算成生怪判準用的三個值；B6 Task 7）：
 *  `sky`＝客戶端天空光（時間無關；MC: sky light is not reduced at night）、
 *  `internalSky`＝內部天空光（隨日夜衰減——敵對判準吃這個值）、
 *  `block`＝方塊光（火把）。`SpawnLight` 以 type-only 從 `./spawn-rules`
 *  引入（判準常數住那邊、引擎住這邊 → 無運行期循環依賴）。
 *
 *  **B3：`lit` 區分「未知」與「暗」**。區塊不存在或還沒點光（`chunk.light`
 *  仍為 null）時三個數值本來就都回 0——但生怪判準不能把「沒有資料」讀成
 *  「全黑」（否則白天在剛載入的區塊生成敵對生物）。這裡一次 `locate` 同時
 *  回報數值與 `lit`：缺區塊／未點光 → `{0,0,0, lit:false}`。 */
export function spawnLightAt(
  world: World,
  x: number,
  y: number,
  z: number,
  t: number,
): SpawnLight {
  const cell = locate(world, x, y, z);
  if (!cell || !cell.chunk.light) {
    return { sky: 0, internalSky: 0, block: 0, lit: false };
  }
  const raw = cell.chunk.light[chunkIndex(cell.lx, cell.ly, cell.lz)];
  const sky = raw >> 4;
  const block = raw & 0x0f;
  return { sky, internalSky: internalSkyLight(sky, t), block, lit: true };
}

/** 天空光 BFS 主循環：pop 一格 → 6 鄰居擴張。衰減規則與方塊光唯一的差別：
 *  **往下且 level = 15 時不衰減**（垂直下傳，minecraft.wiki/Light 的 sky light
 *  直曝柱）；其餘每格 −1。只寫比現值高的格；不透明擋光；目標區塊不存在 →
 *  **不寫也不 push**（與方塊光同一條終止規則）。內層與 {@link expandBlockQueue}
 *  同樣走解析快取＋直寫 light 陣列（逐位元等價於公開逐格 API）。 */
function expandSkyQueue(world: World): void {
  while (queueHead < queueTail) {
    const px = queue[queueHead * 4];
    const py = queue[queueHead * 4 + 1];
    const pz = queue[queueHead * 4 + 2];
    const lv = queue[queueHead * 4 + 3];
    queueHead += 1;
    if (lv <= 1) continue; // 再傳就是 0，不值得寫
    for (let n = 0; n < 6; n++) {
      const dx = NEIGHBORS6[n * 3];
      const dy = NEIGHBORS6[n * 3 + 1];
      const nx = px + dx;
      const ny = py + dy;
      const nz = pz + NEIGHBORS6[n * 3 + 2];
      if (ny < 0 || ny >= CHUNK_HEIGHT) continue;
      const cx = nx >> CHUNK_SHIFT;
      const cz = nz >> CHUNK_SHIFT;
      const chunk = chunkCached(world, cx, cz);
      if (!chunk) continue; // ★ 缺席區塊：不寫、也不 push（佇列必終止）
      const idx = chunkIndex(nx & CHUNK_MASK, ny, nz & CHUNK_MASK);
      if (TRANSPARENT[chunk.data[idx]] === 0) continue; // 不透明方塊擋光（也不持有光）
      const cur = chunk.light ? chunk.light[idx] : 0;
      const next = dy === -1 && lv === MAX_LIGHT ? MAX_LIGHT : lv - 1;
      if ((cur >> 4) >= next) continue; // 只寫比現值高的格
      chunk.ensureLight()[idx] = (next << 4) | (cur & 0x0f); // 天空進高位、方塊光保留
      chunk.dirty = true; // 光變了 → 重網格（等價於 setLight 的 markDirty）
      pushQueue(nx, ny, nz, next);
    }
  }
}

/** 單來源天空光 flood-fill（世界座標；種子格持 `level`）。
 *  多來源的大量播種請用 {@link seedSkyColumns}（整區塊一次 BFS，快得多）。 */
export function propagateSkyLight(
  world: World,
  sx: number,
  sy: number,
  sz: number,
  level: number,
): void {
  resetResolveCache(); // 公開入口：熱迴圈（expandSkyQueue）要用解析快取
  resetQueue(); // 保險：即使前一次異常中斷也從乾淨狀態開始
  pushQueue(Math.floor(sx), Math.floor(sy), Math.floor(sz), level);
  expandSkyQueue(world);
  resetQueue();
}

/** 逐柱斷點高度（模組層暫存，`seedColumnsIntoQueue` 專用；引擎為單執行緒、
 *  無重入）。值 = 該柱從頂往下掃到的第一個**不透明**格 y（開闊格 = y > 值）；
 *  全柱開闊 = −1。 */
const colBreak = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);

/** 單一區塊的開闊天空柱掃描＋播種（種子進共用佇列；BFS 由呼叫端統一驅動）。
 *  回傳是否有種子寫入（→ 呼叫端據此標記網格髒）。**全部在本區塊自己的陣列上
 *  直讀直寫**：世界座標版的 isOpaqueAt／setLight 每格要組字串鍵查 Map（probe
 *  實測單次 ~150 ms），本地陣列版寫入內容逐位元相同（見 expandSkyQueue 的
 *  等價說明）。
 *
 *  播種修剪（Task 3 效能；**最終光值與「全部推進佇列」完全相同**，只刪掉
 *  註定空轉的佇列項）：開闊格（=15）只有在「某個水平鄰格可能收到光」時才需要
 *  進 BFS——上鄰必同柱更上方（開闊 15）、下鄰要嘛開闊 15 要嘛不透明擋光，
 *  都收不到；唯一收得到的是「水平鄰柱在 ly 之上還有不透明方塊」（屋簷／懸崖
 *  下的陰影格）→ 用階段一記下的逐柱斷點高度判斷：`hb(鄰柱) > ly` 且該格透明
 *  才推進。水平越出本區塊的鄰柱斷點未知 → 整柱保守推進（寧多勿漏；收斂值
 *  不變，只多花幾個佇列項）。 */
function seedColumnsIntoQueue(chunk: Chunk): boolean {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const data = chunk.data;
  let light = chunk.light;
  let seeded = false;
  // ── 階段一：逐柱掃描，寫入 15、記錄斷點高度（不進佇列）──
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      let ly = CHUNK_HEIGHT - 1;
      for (; ly >= 0; ly--) {
        const idx = chunkIndex(lx, ly, lz);
        if (TRANSPARENT[data[idx]] === 0) break; // 第一個不透明方塊 → 柱結束
        if (!light) light = chunk.ensureLight(); // 維持「有種子才配置」的延遲語意
        light[idx] = (MAX_LIGHT << 4) | (light[idx] & 0x0f); // 種子保留既有方塊光
        seeded = true;
      }
      colBreak[lx * CHUNK_SIZE + lz] = ly; // 迴圈退出時：不透明格 y（全開 = −1）
    }
  }
  if (seeded) chunk.dirty = true; // 等價於原逐格 setLight → world.markDirty（冪等）
  // ── 階段二：只把「有鄰格可能收光」的開闊格推進佇列（見上方修剪說明）──
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const hb = colBreak[lx * CHUNK_SIZE + lz];
      const west = lx > 0;
      const east = lx < CHUNK_SIZE - 1;
      const north = lz > 0;
      const south = lz < CHUNK_SIZE - 1;
      for (let ly = hb + 1; ly < CHUNK_HEIGHT; ly++) {
        // 邊界柱（鄰柱跨區塊、斷點未知）→ 保守推進
        let need = !(west && east && north && south);
        if (!need) {
          need =
            (colBreak[(lx - 1) * CHUNK_SIZE + lz] > ly &&
              TRANSPARENT[data[chunkIndex(lx - 1, ly, lz)]] === 1) ||
            (colBreak[(lx + 1) * CHUNK_SIZE + lz] > ly &&
              TRANSPARENT[data[chunkIndex(lx + 1, ly, lz)]] === 1) ||
            (colBreak[lx * CHUNK_SIZE + (lz - 1)] > ly &&
              TRANSPARENT[data[chunkIndex(lx, ly, lz - 1)]] === 1) ||
            (colBreak[lx * CHUNK_SIZE + (lz + 1)] > ly &&
              TRANSPARENT[data[chunkIndex(lx, ly, lz + 1)]] === 1);
        }
        if (need) pushQueue(baseX + lx, ly, baseZ + lz, MAX_LIGHT);
      }
    }
  }
  return seeded;
}

/** 逐柱播種單一區塊的開闊天空光 15（遇第一個不透明方塊即停；透明格含水、
 *  玻璃、葉、植被——簡化：不做過濾衰減），**整區塊一次多來源 BFS**（結果與
 *  「每個種子各跑一次 BFS」完全相同）。掃描／修剪本體見
 *  {@link seedColumnsIntoQueue}；computeChunkLight 的群組播種走的則是「整個
 *  3×3 群組一次播種＋一次 BFS」（同一收斂點，見該函式的效能註記）。
 *
 *  **掃描上界 = CHUNK_HEIGHT−1（全高），不是 `chunk.topY`**（2026-10-23 裁決，
 *  覆寫稽核的 topY 上界）：topY 只涵蓋「地形最高方塊 + 1」，其上的開闊天空柱
 *  若不播種就恆 0——(a) 稽核自己的跨區塊測試要求 `(15,69,5) === 15`（69 在
 *  只有地板的區塊的 topY=64 之上）；(b) 玩家在山上蓋塔時，塔的可見面取樣的
 *  正是 topY 之上的格子 → 光照會錯。topY 只增不減 ⇒ topY 之上的格子**必然
 *  全是空氣** ⇒ 全高掃描的結果就是物理正確值；topY 的維護保留（T3 生成接線、
 *  其他消費者），光照不再依賴它。 */
export function seedSkyColumns(world: World, cx: number, cz: number): void {
  const chunk = world.getChunk(cx, cz);
  if (!chunk) return;
  resetResolveCache();
  resetQueue();
  seedColumnsIntoQueue(chunk);
  expandSkyQueue(world);
  resetQueue();
}

// ── 火把的支撐與收回（B6 Task 6）──────────────────────────────────────────────

/** 某格是否可作為火把的支撐（實心方塊：玻璃算支撐、cross 植被與水不算）。
 *  對齊原版「Torches can be placed on the top or the sides of most solid
 *  blocks」「can be placed on top of glass blocks」（minecraft.wiki/Torch）。
 *  與 mesher.ts 的 `torchAttachAt` 內聯的是同一條 isSolid 規則——torchAttachAt
 *  不能反向 import 本模組（popUnsupportedTorches 在這裡用它 → 會成循環），
 *  一行謂詞的等價性由兩側的行為測試各自釘住。 */
export function isFullSupport(world: World, x: number, y: number, z: number): boolean {
  return isSolid(world.getBlock(x, y, z));
}

/** 支撐被挖掉後，把依附其上的火把收回（回傳被收回的位置清單）。
 *
 *  原版（minecraft.wiki/Torch）：「A torch is removed and drops itself as an
 *  item if its attachment block is moved, removed, or destroyed」。依附方向
 *  由世界推導、不存狀態（見 mesher.ts 的 TorchAttach）→ 「支撐消失即掉落」
 *  不需要任何額外的方塊狀態：檢查被改動格的**上方 1 格＋四側 4 格**（火把只
 *  可能依附在這 5 個位置），若該格是火把且 `torchAttachAt(...) === 'free'`
 *  （下方與四側都沒有實心支撐）→ 收回該火把並記下位置。
 *
 *  收回走 `world.setBlock(..., AIR)`：`modified` overlay 記 AIR（存檔往返
 *  一致）、光照重算旗標照常觸發（火把的 emission 14 消失）。火把**不支撐
 *  火把**（支撐必須是實心方塊）→ 不需要級聯收回。呼叫端（main.ts 破壞分支）
 *  負責為回傳的每個位置生成掉落物（生存掉自身、創造不掉）。 */
export function popUnsupportedTorches(
  world: World,
  x: number,
  y: number,
  z: number,
): Array<{ x: number; y: number; z: number }> {
  const popped: Array<{ x: number; y: number; z: number }> = [];
  const candidates: ReadonlyArray<readonly [number, number, number]> = [
    [x, y + 1, z], // 上方（地板依附）
    [x + 1, y, z], // 四側（牆面依附）
    [x - 1, y, z],
    [x, y, z + 1],
    [x, y, z - 1],
  ];
  for (const [cx, cy, cz] of candidates) {
    if (world.getBlock(cx, cy, cz) !== BLOCK.TORCH) continue;
    if (torchAttachAt(world, cx, cy, cz) !== 'free') continue; // 還有別的支撐 → 留著
    world.setBlock(cx, cy, cz, BLOCK.AIR);
    popped.push({ x: cx, y: cy, z: cz });
  }
  return popped;
}

/** 支撐被挖掉後，把長在上面的 cross 植被收回（回傳被收回的位置清單）。
 *
 *  cross（蒲公英／罌粟／短草，`shape === 'cross'`）畫在**下方那一格**的支撐
 *  上——沒有支撐就是懸空植被（審查 B2：mesher 照畫，花／草飄在空中）。原版
 *  的花草在支撐消失時掉落自身。這裡只檢查被改動格的**上方 1 格**：若是 cross
 *  且下方（＝剛被改動的那一格）已不是實心方塊 → 收回並記下位置。
 *
 *  與 `popUnsupportedTorches` 同一個契約：`setBlock(..., AIR)`（`modified`
 *  overlay 記 AIR → 存檔往返一致；自然生成的植被不會在區塊生成之後**長回來**）、
 *  光照重算旗標照常觸發。呼叫端（main.ts 破壞分支）負責為回傳的每個位置生成
 *  掉落物（生存掉自身、創造不掉）。植被**不支撐植被**（支撐必須是實心方塊）
 *  → 不需要級聯收回。 */
export function popUnsupportedCrosses(
  world: World,
  x: number,
  y: number,
  z: number,
): Array<{ x: number; y: number; z: number }> {
  const popped: Array<{ x: number; y: number; z: number }> = [];
  const candidates: ReadonlyArray<readonly [number, number, number]> = [
    [x, y + 1, z], // 長在被改動格上的 cross（支撐＝被改動的那一格）
  ];
  for (const [cx, cy, cz] of candidates) {
    if (!isCross(world.getBlock(cx, cy, cz))) continue;
    if (isFullSupport(world, cx, cy - 1, cz)) continue; // 還有支撐 → 留著
    world.setBlock(cx, cy, cz, BLOCK.AIR);
    popped.push({ x: cx, y: cy, z: cz });
  }
  return popped;
}
