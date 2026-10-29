import { createCreeper, type Creeper } from './creeper';
import {
  MAX_MOBS,
  createMob,
  findSpawnPos,
  surfaceYAt,
  type Mob,
} from './mobs';
import { createSpider, type Spider } from './spider';
import { canSpawnHostile, type SpawnLight } from './spawn-rules';

// ---- 統一生怪分配器（B9 Task 7）----
//
// **為什麼要一個新的分配器**：B4 的 `trySpawnMob` 內部固定抽「殭屍／骷髏
// 50/50」。若只在外面加判斷，就會出現兩條生怪路徑各自抽權重（總體機率錯亂）。
// `trySpawnHostile` 是**唯一**的敵對生怪入口，四種生物一起抽同一份權重表；
// B4 的 `trySpawnMob`／`chooseSpawnKind` 已被移除（不是重定義）。
//
// 數值（minecraft.wiki，2026-10-20 查證）：
// - 四種敵對的生成權重都是 100 ⇒ 各 25%；
// - 生成需要亮度 0（沿用 B6 的 `canSpawnHostile`：內部天空光 ≤ 7 且無方塊光）；
// - 生成距離 24–128 格（沿用 B4 的 `findSpawnPos`）；
// - 原版成群 4 隻 → 本作沿用 B4 的「每 5 秒 1 隻」（簡化）。
//
// **rng 消耗順序（固定）**：① `findSpawnPos` 2 次（角度、距離）
// → ② `chooseHostileKind` 1 次 → ③ 苦力怕子上限的重抽，每次 1 次（最多 4 次）。
// 測試靠這個順序控制「種類」；`createCreeper`／`createSpider` 會再吃 2 次
// rng（wanderDir／wanderTimer），所以想釘死種類的測試要用 `seq(...)`。

export type HostileKind = 'zombie' | 'skeleton' | 'creeper' | 'spider';

/** 原版權重（四種都是 100）。**鍵序＝累積抽籤順序**：
 *  zombie → skeleton → creeper → spider（`chooseHostileKind` 依此順序累減）。 */
export const HOSTILE_SPAWN_WEIGHTS: Readonly<Record<HostileKind, number>> = {
  zombie: 100,
  skeleton: 100,
  creeper: 100,
  spider: 100,
};

/** 苦力怕子上限（本作自訂；原版沒有）。理由：苦力怕會摧毀玩家建築，靠子上限
 *  控制風險比調高總上限安全（見計畫〈已查證與設計決策〉§4）。 */
export const MAX_CREEPERS = 4;

export interface HostileSpawnCtx {
  /** B6 的 `lighting.spawnLightAt`（per-block 光照）。 */
  lightAt: (x: number, y: number, z: number) => SpawnLight;
  isSolidAt: (x: number, y: number, z: number) => boolean;
  blockIdAt: (x: number, y: number, z: number) => number;
  rng?: () => number;
}

/** 三條敵對清單的現在數量（總上限＝三者相加，沿用 `MAX_MOBS = 12`）。 */
export interface HostileCounts {
  mobs: number;
  creepers: number;
  spiders: number;
}

/** 一次生成的結果：`kind` 與對應的實體（其餘兩欄為 null）。 */
export interface HostileSpawn {
  kind: HostileKind;
  mob: Mob | null;
  creeper: Creeper | null;
  spider: Spider | null;
}

/** 依權重抽一種敵對（累積權重；四個都是 100 ⇒ 等機率 1/4）。 */
export function chooseHostileKind(rng: () => number = Math.random): HostileKind {
  const total = Object.values(HOSTILE_SPAWN_WEIGHTS).reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (const k of Object.keys(HOSTILE_SPAWN_WEIGHTS) as HostileKind[]) {
    r -= HOSTILE_SPAWN_WEIGHTS[k];
    if (r < 0) return k;
  }
  return 'spider'; // 浮點誤差的保底（r 剛好等於 total 時落在最後一項）
}

/** 一次敵對生成嘗試（純函式；世界讀取全部由呼叫端注入）：
 *  總上限 → 候選點 24–128 格 → 地表高度 → per-block 光照 → 種類（＋苦力怕子
 *  上限的重抽）→ 建立實體。任何一道閘門沒過就回 null（呼叫端跳過這一輪）。 */
export function trySpawnHostile(
  counts: HostileCounts,
  playerPos: { x: number; y: number; z: number },
  ctx: HostileSpawnCtx,
): HostileSpawn | null {
  if (counts.mobs + counts.creepers + counts.spiders >= MAX_MOBS) return null;
  const rng = ctx.rng ?? Math.random;

  const spot = findSpawnPos(playerPos, rng);
  const y = surfaceYAt(spot.x, spot.z, ctx.isSolidAt, ctx.blockIdAt);
  if (y === null) return null;

  // 光照判準（B6）：在「真的要站的那一格」查 per-block 光照。
  if (!canSpawnHostile(ctx.lightAt(Math.floor(spot.x), y, Math.floor(spot.z)))) return null;

  let kind = chooseHostileKind(rng);
  if (kind === 'creeper' && counts.creepers >= MAX_CREEPERS) {
    // 子上限：重抽最多 4 次；仍是苦力怕 → 放棄這次生成（不改成別的物種硬生）。
    let replaced = false;
    for (let i = 0; i < 4; i++) {
      kind = chooseHostileKind(rng);
      if (kind !== 'creeper') {
        replaced = true;
        break;
      }
    }
    if (!replaced) return null;
  }

  const at = { x: spot.x, y, z: spot.z };
  if (kind === 'creeper') {
    return { kind, mob: null, creeper: createCreeper(at, rng), spider: null };
  }
  if (kind === 'spider') {
    return { kind, mob: null, creeper: null, spider: createSpider(at, rng) };
  }
  return { kind, mob: createMob(kind, at), creeper: null, spider: null };
}
