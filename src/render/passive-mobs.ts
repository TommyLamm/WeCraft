/**
 * 被動生物（雞／豬／羊／牛）的**方塊化**渲染（B4 Task 8）。
 *
 * **為什麼另開一個模組、而不是塞進 `render/scene.ts`**：`scene.ts` 的
 * `createMobRenderer` 渲染的是**敵對生物**（殭屍／骷髏 → 人形的方塊人）；
 * 被動生物是**四足、體型依種類而異**的動物 → 模型版面、調色盤與體型來源都
 * 不同 → 獨立成一個模組，兩邊互不干擾（也不會動到既有的敵對生物渲染行為）。
 *
 * **結構完全比照 `createMobRenderer`**（同一套慣例，方便日後維護）：
 * - **共用 unit geometry**：所有部件都用同一份 `BoxGeometry(1, 1, 1)`，尺寸
 *   靠 `mesh.scale` 決定 → 整個場景只有一份幾何記憶體。
 * - **每隻生物一份材質**（`MeshLambertMaterial`）：受擊閃白是**改這一隻的材質**
 *   的 `emissive` → 若共用材質，整群會一起閃白。
 * - **id-keyed 快取**：同一個 id 只更新、不重建；id 被另一種動物重用時才重建。
 * - `dispose()`：移除所有 group、釋放每隻的材質與那份共用幾何。
 *
 * **模型是簡化的方塊模型（要寫進 Task 12 的 README 簡化清單）**：原版是多部件
 * 的細緻模型（雞有翅膀與尾羽、豬有捲尾、牛有分趾蹄與更細的斑紋…），本作只做
 * 「方塊身 ＋ 頭 ＋ 兩條腿」＋ 每種動物的特徵配件（雞冠與喙、豬鼻、灰臉、
 * 角與白斑）→ 辨識度靠**顏色與配件**，不是原版那樣的細節。
 *
 * **體型由 `PASSIVE_DEFS` 的 width／height 推導（不是寫死的字面值）**：
 * 每種動物只定義一組**比例參數**（{@link PassiveShape}，例如「腿高＝身高的
 * 18%」），實際的世界單位尺寸由 `width`／`height` 算出來（見
 * {@link baseShape}）→ **改動定義表，渲染結果一定跟著改**。
 * `buildPassiveMobModel` 可注入尺寸 → 測試能乾淨地驗這件事（不必改動全域的
 * 定義表 → 不會污染其他測試）。
 *
 * **渲染體積 ⊆ 命中盒（yaw = 0 時）**：命中盒（`world/passive-mobs.ts` 的
 * `hitPassiveMobId`）是 `x ± width/2`、`z ± width/2`、`y .. y + height` → 模型被
 * **算在**這個盒子裡面：**腳底貼地**（局部 y = 0 起算）、頭頂不超過 `height`。
 *
 * - **yaw = 0 時**：渲染體積完全落在命中盒之內 → 不會有「看得到卻打不到」的
 *   隱形命中區。
 * - **命中盒多出來的邊緣是「打得到卻看不到」的** —— 刻意讓渲染體積**小於**命中盒
 *   （**寧可小不可大**：寧可讓邊緣打得到，也不要讓玩家看得見卻打不到）。模型只
 *   用掉命中盒寬度的 66–82%（比例見 `PassiveShape`）。
 * - **yaw ≠ 0 時**（模型跟著 AI 的 yaw 轉、而命中盒是**軸對齊**的）→ 旋轉後的
 *   外接半徑必然可能超過 `width/2`（除非把模型縮成半徑 `width/2` 的圓 → 會看
 *   起來明顯偏小，**不做**）：實測最壞超出 **0.0655 格（羊 @224°）**（豬 0.0547
 *   ／牛 0.0284／雞 0）→ **這是「命中盒軸對齊 vs 模型旋轉」的幾何必然，不是建模
 *   誤差**；0.07 格 ≈ 7 cm，玩家瞄準幾乎不會感覺得到（測試有掃 0–359° 的上限
 *   釘子，擋住「未來有人把模型改大」）。
 *
 * **朝向用 AI 算好的 `yaw`**（不是自己從速度算）：`stepPassiveMob` 已經在水平
 * 速度 > 0.01 時算好 `yaw = atan2(vel.x, vel.z)`，停下時**保留**上一次的方向
 * → 這裡直接套用，生物停下時不會突然轉回去。
 *
 * **走路擺動**沿用 `createMobRenderer` 的做法（`phase += 水平速度 · dt · 4`、
 * `swing = sin(phase) · 0.6`），停下時擺動衰減歸零（停在正中間，不是定格在
 * 半步）。**腿是繞「髖部」樞紐擺動** → 擺動中腳尖會暫時**下沉**（實測最多約
 * 1.3 cm：豬 −0.0127／羊 −0.0086／牛 −0.0083／雞 −0.0040 格；與 `scene.ts` 的
 * 敵對生物模型同一個現象）→ **靜止時腳底回到精確的 y = 0**。
 */
import * as THREE from 'three';
import { PASSIVE_DEFS, type PassiveKind, type PassiveMob } from '../world/passive-mobs';

/** 受擊閃白的秒數（與敵對生物一致）。 */
const FLASH_SEC = 0.1;
/** 擺動幅度（弧度）。 */
const SWING_AMPLITUDE = 0.6;
/** 行走相位推進速度：`phase += 水平速度 · dt · 4`。 */
const WALK_FREQ = 4;
/** 水平速度低於這個值 → 視為「站著不動」（與敵對生物同一個門檻）。 */
const MOVE_EPS = 0.01;

/** 材質槽：每種動物最多五種顏色（身／頭／腿／裝飾／第二種裝飾）。 */
type MaterialSlot = 'body' | 'head' | 'leg' | 'accent' | 'accent2';

/**
 * 每種動物的扁平調色盤（與 `render/scene.ts` 的 `MOB_PALETTE` 同一風格：
 * 無貼圖、純色 Lambert → 會受日光與環境光影響）。
 *
 * - 雞＝**小白身** ＋ **紅冠** ＋ **黃喙**
 * - 豬＝**粉身** ＋ **深色豬鼻**
 * - 羊＝**白身**（蓬鬆＝身體高一點）＋ **灰臉**
 * - 牛＝**棕身** ＋ **白斑** ＋ **深色角**
 */
const PASSIVE_PALETTE: Record<PassiveKind, Record<MaterialSlot, number>> = {
  chicken: { body: 0xf4f4f4, head: 0xf4f4f4, leg: 0xe8a33d, accent: 0xd8453f, accent2: 0xf2c53d },
  pig: { body: 0xeda3b0, head: 0xeda3b0, leg: 0xdb8b99, accent: 0xc97383, accent2: 0xc97383 },
  sheep: { body: 0xf2f2ec, head: 0xb6b6ad, leg: 0xdcdcd2, accent: 0xfafaf4, accent2: 0xb6b6ad },
  cow: { body: 0x6d4b30, head: 0x6d4b30, leg: 0x4b3624, accent: 0xf2f2ea, accent2: 0x3a2b1d },
};

/**
 * 一種動物的**比例參數**（全部是比例，**不是**世界單位）→ 實際尺寸由
 * `width`／`height` 推導出來（見 {@link baseShape}）。
 *
 * **這是「體型由定義表推導」的落點**：這裡只寫「身體寬是命中盒寬的幾成」，
 * 寫死的是**比例**，不是格數 → 定義表的 `width`／`height` 一改，模型就改。
 */
interface PassiveShape {
  /** 腿的高度（占 `height` 的比例）。 */
  legH: number;
  /** 腿的粗細（占 `width` 的比例）。 */
  legW: number;
  /** 腿離身體中線的距離（占 `width` 的比例）。 */
  legX: number;
  /** 身體的寬（占 `width` 的比例）。 */
  bodyW: number;
  /** 身體的深（占 `width` 的比例）。 */
  bodyD: number;
  /** 身體中心在 z 的位置（占 `width` 的比例；負＝偏後，讓頭在前）。 */
  bodyZ: number;
  /** 頭的邊長（占 `min(width, height)` 的比例 → 頭保持正方體）。 */
  headSide: number;
  /** 頭中心在 z 的位置（占 `width` 的比例）。 */
  headZ: number;
  /** 頭沉進身體的比例（占頭邊長的比例）→ 頭不會浮在空中。 */
  headSink: number;
  /** 頭頂之上還有的配件高度（占 `height` 的比例；0＝沒有）。 */
  topExtra: number;
}

/** 一個方塊部件：尺寸與位置都是**世界單位**（格）。 */
interface BlockSpec {
  /** 節點名稱（`body`／`head`／裝飾…）。 */
  name: string;
  /** 用哪一個材質槽。 */
  slot: MaterialSlot;
  size: { x: number; y: number; z: number };
  /** 相對腳底、x/z 置中的位置。 */
  pos: { x: number; y: number; z: number };
}

/**
 * 一條腿：樞紐在腿的**頂端**（局部 y = `height`），方塊從樞紐往下垂 →
 * 腿的下緣正好在局部 y = 0 → **腳底貼地**；`pivot.rotation.x` 就是前後擺動。
 */
interface LegSpec {
  /** 離身體中線的距離（世界單位；左腿為正）。 */
  x: number;
  /** 腿的高度（世界單位；腳底 0 → 髖部 `height`）。 */
  height: number;
  /** 腿的粗細（世界單位）。 */
  thickness: number;
}

/** 一種動物的模型版面（身體朝向 **+z**，與 `createMobRenderer` 的前方慣例一致）。 */
interface PassiveLayout {
  blocks: BlockSpec[];
  /** 兩條腿：[左, 右]。本作用**兩條腿**（不做四足的四條腿 → 簡化）。 */
  legs: readonly [LegSpec, LegSpec];
}

/** 依比例參數算出的**基準數值**（全部是世界單位）。 */
interface BaseShape {
  /** 腿高（髖部高度）。 */
  legH: number;
  /** 腿的粗細。 */
  legSize: number;
  /** 腿離中線的距離。 */
  legX: number;
  /** 頭的邊長。 */
  headSide: number;
  /** 頭頂的高度。 */
  headTop: number;
  /** 頭中心的 y。 */
  headCenterY: number;
  /** 頭中心的 z。 */
  headZ: number;
  /** 頭的前緣 z（喙／豬鼻要接在這裡）。 */
  headFrontZ: number;
  /** 身體的高度。 */
  bodyH: number;
  /** 身體中心的 y。 */
  bodyCenterY: number;
  /** 身體的寬／深／z 中心。 */
  bodyW: number;
  bodyD: number;
  bodyZ: number;
  /** 頭頂之上的配件高度（0＝沒有）。 */
  topExtra: number;
}

/**
 * 把**比例參數**換算成**世界單位**的基準數值（尺寸推導的唯一入口）。
 *
 * - 腿：`legH × height` → 腿從 y = 0 到 `legH`（腳底貼地）。
 * - 頭：邊長 `headSide × min(width, height)`（保持正方體）；頭頂＝
 *   `height − topExtra`（配件要佔的高度）→ **模型最高點＝`height`**。
 * - 身：上緣＝頭的下緣 ＋ `headSink × 頭邊長`（頭沉進身體 → 不會浮在空中）。
 */
function baseShape(shape: PassiveShape, w: number, h: number): BaseShape {
  const legH = shape.legH * h;
  const headSide = shape.headSide * Math.min(w, h);
  const topExtra = shape.topExtra * h;
  const headTop = h - topExtra;
  const headCenterY = headTop - headSide / 2;
  const headBottom = headTop - headSide;
  const bodyTop = headBottom + shape.headSink * headSide;
  return {
    legH,
    legSize: shape.legW * w,
    legX: shape.legX * w,
    headSide,
    headTop,
    headCenterY,
    headZ: shape.headZ * w,
    headFrontZ: shape.headZ * w + headSide / 2,
    bodyH: Math.max(0.05, bodyTop - legH),
    bodyCenterY: (legH + bodyTop) / 2,
    bodyW: shape.bodyW * w,
    bodyD: shape.bodyD * w,
    bodyZ: shape.bodyZ * w,
    topExtra,
  };
}

/** 雞：小白身 ＋ 紅冠（accent）＋ 黃喙（accent2）。 */
function chickenLayout(w: number, h: number): PassiveLayout {
  const shape: PassiveShape = {
    legH: 0.18,
    legW: 0.16,
    legX: 0.2,
    bodyW: 0.66,
    bodyD: 0.52,
    bodyZ: -0.1,
    headSide: 0.4,
    headZ: 0.1,
    headSink: 0.3,
    topExtra: 0.09, // 紅冠
  };
  const b = baseShape(shape, w, h);
  const combH = b.topExtra;
  const beakD = 0.16 * w;
  return {
    legs: [
      { x: b.legX, height: b.legH, thickness: b.legSize },
      { x: -b.legX, height: b.legH, thickness: b.legSize },
    ],
    blocks: [
      {
        name: 'body',
        slot: 'body',
        size: { x: b.bodyW, y: b.bodyH, z: b.bodyD },
        pos: { x: 0, y: b.bodyCenterY, z: b.bodyZ },
      },
      {
        name: 'head',
        slot: 'head',
        size: { x: b.headSide, y: b.headSide, z: b.headSide },
        pos: { x: 0, y: b.headCenterY, z: b.headZ },
      },
      {
        name: 'comb',
        slot: 'accent',
        size: { x: 0.14 * w, y: combH, z: 0.26 * w },
        pos: { x: 0, y: b.headTop + combH / 2, z: b.headZ },
      },
      {
        name: 'beak',
        slot: 'accent2',
        size: { x: 0.18 * w, y: 0.07 * h, z: beakD },
        pos: { x: 0, y: b.headCenterY - 0.12 * b.headSide, z: b.headFrontZ + beakD / 2 },
      },
    ],
  };
}

/** 豬：粉身 ＋ 深色豬鼻（accent）。 */
function pigLayout(w: number, h: number): PassiveLayout {
  const shape: PassiveShape = {
    legH: 0.22,
    legW: 0.16,
    legX: 0.24,
    bodyW: 0.72,
    bodyD: 0.74,
    bodyZ: -0.06,
    headSide: 0.38,
    headZ: 0.22,
    headSink: 0.3,
    topExtra: 0,
  };
  const b = baseShape(shape, w, h);
  const snoutD = 0.08 * w;
  return {
    legs: [
      { x: b.legX, height: b.legH, thickness: b.legSize },
      { x: -b.legX, height: b.legH, thickness: b.legSize },
    ],
    blocks: [
      {
        name: 'body',
        slot: 'body',
        size: { x: b.bodyW, y: b.bodyH, z: b.bodyD },
        pos: { x: 0, y: b.bodyCenterY, z: b.bodyZ },
      },
      {
        name: 'head',
        slot: 'head',
        size: { x: b.headSide, y: b.headSide, z: b.headSide },
        pos: { x: 0, y: b.headCenterY, z: b.headZ },
      },
      {
        name: 'snout',
        slot: 'accent',
        size: { x: 0.2 * w, y: 0.14 * h, z: snoutD },
        pos: { x: 0, y: b.headCenterY - 0.1 * b.headSide, z: b.headFrontZ + snoutD / 2 },
      },
    ],
  };
}

/** 羊：白身（**蓬鬆＝身體高一點、也寬一點**）＋ 灰臉（head 槽是灰的）＋ 背上的羊毛。 */
function sheepLayout(w: number, h: number): PassiveLayout {
  const shape: PassiveShape = {
    legH: 0.2,
    legW: 0.15,
    legX: 0.21,
    bodyW: 0.82,
    bodyD: 0.72,
    bodyZ: -0.04,
    headSide: 0.32,
    headZ: 0.24,
    headSink: 0.3,
    topExtra: 0,
  };
  const b = baseShape(shape, w, h);
  const woolH = 0.08 * h;
  const bodyTop = b.bodyCenterY + b.bodyH / 2;
  return {
    legs: [
      { x: b.legX, height: b.legH, thickness: b.legSize },
      { x: -b.legX, height: b.legH, thickness: b.legSize },
    ],
    blocks: [
      {
        name: 'body',
        slot: 'body',
        size: { x: b.bodyW, y: b.bodyH, z: b.bodyD },
        pos: { x: 0, y: b.bodyCenterY, z: b.bodyZ },
      },
      {
        name: 'wool',
        slot: 'accent',
        size: { x: 0.68 * w, y: woolH, z: 0.44 * w },
        pos: { x: 0, y: bodyTop + woolH / 2, z: -0.15 * w },
      },
      {
        name: 'head',
        slot: 'head',
        size: { x: b.headSide, y: b.headSide, z: b.headSide },
        pos: { x: 0, y: b.headCenterY, z: b.headZ },
      },
    ],
  };
}

/** 牛：棕身 ＋ 白斑（accent）＋ 深色角（accent2）。 */
function cowLayout(w: number, h: number): PassiveLayout {
  const shape: PassiveShape = {
    legH: 0.22,
    legW: 0.16,
    legX: 0.23,
    bodyW: 0.7,
    bodyD: 0.72,
    bodyZ: -0.04,
    headSide: 0.38,
    headZ: 0.24,
    headSink: 0.3,
    topExtra: 0.09, // 角
  };
  const b = baseShape(shape, w, h);
  const hornH = b.topExtra;
  const bodyTop = b.bodyCenterY + b.bodyH / 2;
  return {
    legs: [
      { x: b.legX, height: b.legH, thickness: b.legSize },
      { x: -b.legX, height: b.legH, thickness: b.legSize },
    ],
    blocks: [
      {
        name: 'body',
        slot: 'body',
        size: { x: b.bodyW, y: b.bodyH, z: b.bodyD },
        pos: { x: 0, y: b.bodyCenterY, z: b.bodyZ },
      },
      {
        name: 'head',
        slot: 'head',
        size: { x: b.headSide, y: b.headSide, z: b.headSide },
        pos: { x: 0, y: b.headCenterY, z: b.headZ },
      },
      {
        name: 'hornL',
        slot: 'accent2',
        size: { x: 0.07 * w, y: hornH, z: 0.07 * w },
        pos: { x: 0.13 * w, y: b.headTop + hornH / 2, z: 0.2 * w },
      },
      {
        name: 'hornR',
        slot: 'accent2',
        size: { x: 0.07 * w, y: hornH, z: 0.07 * w },
        pos: { x: -0.13 * w, y: b.headTop + hornH / 2, z: 0.2 * w },
      },
      {
        name: 'spotL',
        slot: 'accent',
        size: { x: 0.04 * w, y: 0.2 * h, z: 0.28 * w },
        pos: { x: b.bodyW / 2 - 0.01, y: b.bodyCenterY, z: b.bodyZ },
      },
      {
        name: 'spotR',
        slot: 'accent',
        size: { x: 0.04 * w, y: 0.2 * h, z: 0.28 * w },
        pos: { x: -(b.bodyW / 2 - 0.01), y: b.bodyCenterY, z: b.bodyZ },
      },
      {
        name: 'spotTop',
        slot: 'accent',
        size: { x: 0.24 * w, y: 0.03 * h, z: 0.22 * w },
        pos: { x: 0, y: bodyTop + 0.013, z: -0.12 * w },
      },
    ],
  };
}

/** 四種動物的版面表（單一真值來源）。 */
const LAYOUTS: Record<PassiveKind, (w: number, h: number) => PassiveLayout> = {
  chicken: chickenLayout,
  pig: pigLayout,
  sheep: sheepLayout,
  cow: cowLayout,
};

/** 一隻被動生物的模型（群組 ＋ 兩條腿 ＋ 這一隻自己的材質）。 */
export interface PassiveMobModel {
  kind: PassiveKind;
  group: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  /** 這一隻自己的材質（每隻一份 → 閃白只影響這一隻）。 */
  materials: THREE.MeshLambertMaterial[];
}

/**
 * 建立一隻被動生物的**模型**（尺寸由 `size` 推導）。
 *
 *  **為什麼把建模函式匯出**：體型必須**真的**由 `PASSIVE_DEFS` 推導 → 測試要能
 *  在**不改動全域定義表**的前提下驗這件事（改完還原會污染其他測試）→ 尺寸由
 *  參數注入。
 *
 *  - `size` ＝ `{ width, height }`（命中盒的尺寸）→ **必填參數**：渲染器內部傳的
 *    是 `PASSIVE_DEFS[kind]` 的 width／height；測試則傳自訂尺寸來驗「尺寸真的由
 *    參數推導」（不必改動全域的定義表）。
 *  - `unitGeo` ＝ 共用的 unit geometry（由呼叫端持有與釋放）。
 *
 *  **群組本身沒有縮放**（`scale` ＝ 1）：尺寸全部直接算成世界單位 → 沒有
 *  「先乘 height 又除 height」這種互相抵消的組合 → 定義表一改，模型就改。
 */
export function buildPassiveMobModel(
  kind: PassiveKind,
  size: { width: number; height: number },
  unitGeo: THREE.BufferGeometry,
): PassiveMobModel {
  const w = size.width;
  const h = size.height;
  const layout = LAYOUTS[kind](w, h);
  const palette = PASSIVE_PALETTE[kind];

  // **每隻生物一份材質**：同一隻的各部件共用，但不同隻之間不共用
  // （共用 → 閃白會讓整群一起閃）。
  const materials = new Map<MaterialSlot, THREE.MeshLambertMaterial>();
  function materialFor(slot: MaterialSlot): THREE.MeshLambertMaterial {
    const cached = materials.get(slot);
    if (cached) return cached;
    const mat = new THREE.MeshLambertMaterial({ color: palette[slot] });
    materials.set(slot, mat);
    return mat;
  }

  const group = new THREE.Group();
  group.name = `passive:${kind}`;

  for (const spec of layout.blocks) {
    const mesh = new THREE.Mesh(unitGeo, materialFor(spec.slot));
    mesh.name = spec.name;
    // 尺寸與位置都是**世界單位** → 直接就是最終大小（沒有群組縮放）。
    mesh.scale.set(spec.size.x, spec.size.y, spec.size.z);
    mesh.position.set(spec.pos.x, spec.pos.y, spec.pos.z);
    group.add(mesh);
  }

  /** 一條腿：樞紐在腿的頂端，方塊往下垂到 y = 0 → 腳底貼地。 */
  function buildLeg(name: 'legL' | 'legR', spec: LegSpec): THREE.Group {
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.set(spec.x, spec.height, 0);
    const mesh = new THREE.Mesh(unitGeo, materialFor('leg'));
    mesh.scale.set(spec.thickness, spec.height, spec.thickness);
    mesh.position.y = -spec.height / 2; // 方塊從髖部往下垂（腳底 = 0）
    pivot.add(mesh);
    group.add(pivot);
    return pivot;
  }
  const legL = buildLeg('legL', layout.legs[0]);
  const legR = buildLeg('legR', layout.legs[1]);

  // 與生物模型一致：每個方塊都投影（Phase 3 Task 5 的太陽陰影）。
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.castShadow = true;
  });

  return { kind, group, legL, legR, materials: [...materials.values()] };
}

/** 一隻被動生物的渲染狀態。 */
interface PassiveParts {
  kind: PassiveKind;
  group: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  /** 這一隻自己的材質（每隻一份 → 閃白只影響這一隻）。 */
  materials: THREE.MeshLambertMaterial[];
  phase: number; // 累積的行走相位
  swing: number; // 當前的擺動（停下時衰減到 0）
  flash: number; // 白色受擊閃光剩下的秒數
}

/** 被動生物的渲染器（每幀與 AI 的名單對帳）。 */
export interface PassiveMobRenderer {
  /** 建立／移動／轉向／動畫化每一隻被動生物，讓畫面與 `mobs` 一致。
   *
   *  `dt` 推進行走週期並燒掉受擊閃光（**非有限值 → 0**，相位不會變成 NaN）。 */
  syncPassiveMobs(mobs: readonly PassiveMob[], dt: number): void;
  /** 讓指定的被動生物閃白 0.1 秒（未知 id → 什麼都不做）。 */
  flashPassiveMob(id: number): void;
  /** 移除所有 group、釋放每隻的材質與共用的幾何。 */
  dispose(): void;
}

/**
 * 建立被動生物的渲染器。
 *
 * **實作要點**：
 * - **共用 unit geometry**（`BoxGeometry(1,1,1)`）＋ 每個部件用 `scale` 決定
 *   尺寸 → 一個場景一份幾何。
 * - **每隻生物一份材質** → 受擊閃白（改 `emissive`）只影響被打到的那一隻。
 * - **id-keyed 快取** → 同一個 id 每幀只更新位置／朝向／動畫，不重建 mesh。
 * - **體型由 `PASSIVE_DEFS` 的 width／height 推導**（見
 *   {@link buildPassiveMobModel}）→ 定義表一改，渲染就改。
 */
export function createPassiveMobRenderer(scene: THREE.Scene): PassiveMobRenderer {
  // 共用的 unit geometry（所有部件、所有動物都用這一份）—— 釋放於 dispose()。
  const unitGeo = new THREE.BoxGeometry(1, 1, 1);
  const mobs = new Map<number, PassiveParts>();

  /** 移除一隻（並釋放它自己的材質）。 */
  function removePassiveMob(id: number): void {
    const entry = mobs.get(id);
    if (!entry) return;
    scene.remove(entry.group);
    for (const m of entry.materials) m.dispose(); // 只有每隻自己的材質
    mobs.delete(id);
  }

  return {
    syncPassiveMobs(list, dt) {
      const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
      const live = new Set<number>();
      for (const mob of list) {
        live.add(mob.id);
        let entry = mobs.get(mob.id);
        // 同一個 id 被換成另一種動物 → 重建（模型不同，不能沿用）。
        if (entry && entry.kind !== mob.kind) {
          removePassiveMob(mob.id);
          entry = undefined;
        }
        if (!entry) {
          // **體型由定義表推導**（不是寫死的字面值）→ 定義表改了模型就跟著改。
          const def = PASSIVE_DEFS[mob.kind];
          const model = buildPassiveMobModel(mob.kind, { width: def.width, height: def.height }, unitGeo);
          entry = { ...model, phase: 0, swing: 0, flash: 0 };
          mobs.set(mob.id, entry);
          scene.add(entry.group);
        }

        // NaN 防護：壞座標會經過矩陣計算擴散成 NaN 汙染整個場景。
        const px = Number.isFinite(mob.pos.x) ? mob.pos.x : 0;
        const py = Number.isFinite(mob.pos.y) ? mob.pos.y : 0;
        const pz = Number.isFinite(mob.pos.z) ? mob.pos.z : 0;
        entry.group.position.set(px, py, pz);
        // **朝向用 AI 算好的 `yaw`**（停下時保留 → 不會突然轉回去）。
        entry.group.rotation.y = Number.isFinite(mob.yaw) ? mob.yaw : 0;

        const vx = Number.isFinite(mob.vel.x) ? mob.vel.x : 0;
        const vz = Number.isFinite(mob.vel.z) ? mob.vel.z : 0;
        const hSpeed = Math.hypot(vx, vz);

        // 行走週期：相位跟著水平速度推進；停下時擺動衰減回正中間
        // （停在正中間，而不是定格在半步）。
        if (hSpeed > MOVE_EPS && step > 0) {
          entry.phase += hSpeed * step * WALK_FREQ;
          entry.swing = Math.sin(entry.phase) * SWING_AMPLITUDE;
        } else if (step > 0) {
          entry.swing *= Math.pow(0.01, step); // 站著不動約 1 秒後就歸零
          if (Math.abs(entry.swing) < 1e-4) {
            entry.swing = 0;
            entry.phase = 0;
          }
        }
        entry.legL.rotation.x = entry.swing;
        entry.legR.rotation.x = -entry.swing;

        // 受擊閃白：白色 emissive 持續 FLASH_SEC，之後回到平色。
        entry.flash = Math.max(0, entry.flash - step);
        const emissive = entry.flash > 0 ? 0xffffff : 0x000000;
        for (const m of entry.materials) m.emissive.setHex(emissive);
      }
      for (const id of [...mobs.keys()]) if (!live.has(id)) removePassiveMob(id);
    },

    flashPassiveMob(id) {
      const entry = mobs.get(id);
      if (!entry) return;
      entry.flash = FLASH_SEC;
      // **立刻**變白（不等下一幀的 sync）→ 玩家揮下去的那一幀就看得到閃白。
      for (const m of entry.materials) m.emissive.setHex(0xffffff);
    },

    dispose() {
      for (const id of [...mobs.keys()]) removePassiveMob(id);
      unitGeo.dispose();
    },
  };
}
