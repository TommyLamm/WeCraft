/**
 * 被動生物（雞／豬／羊／牛）的**方塊化**渲染（B4 Task 8）。
 *
 * **為什麼另開一個模組、而不是塞進 `render/scene.ts`**：`scene.ts` 的
 * `createMobRenderer` 渲染的是**敵對生物**（殭屍／骷髏 → 人形的方塊人）；
 * 被動生物是**四足、體型依種類而異**的動物 → 模型版面、調色盤與體型來源都
 * 不同（體型直接取 `PASSIVE_DEFS` 的 width／height）→ 獨立成一個模組，兩邊
 * 互不干擾（也不會動到既有的敵對生物渲染行為）。
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
 * **體型直接用 `PASSIVE_DEFS` 的 width／height**：模型建在「身高 = 1」的**參考
 * 空間**裡（各部件的尺寸與位置都先除以身高），再以 `group.scale = 身高` 整體
 * 放大 → 畫面上的高矮胖瘦**就是**命中盒的大小 → 玩家的瞄準判斷
 * （`hitPassiveMobId` 用的是同一組 width／height）與視覺一致（牛比雞大、
 * 羊比豬高）。
 *
 * **朝向用 AI 算好的 `yaw`**（不是自己從速度算）：`stepPassiveMob` 已經在水平
 * 速度 > 0.01 時算好 `yaw = atan2(vel.x, vel.z)`，停下時**保留**上一次的方向
 * → 這裡直接套用，生物停下時不會突然轉回去。
 *
 * **走路擺動**沿用 `createMobRenderer` 的做法（`phase += 水平速度 · dt · 4`、
 * `swing = sin(phase) · 0.6`），停下時擺動衰減歸零（停在正中間，不是定格在
 * 半步）。
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

/** 一條腿：樞紐在髖部（`hipY`），方塊從樞紐往下垂 → `rotation.x` 就能擺動。 */
interface LegSpec {
  /** 離身體中線的距離（世界單位；左腿為正）。 */
  x: number;
  /** 髖部高度（世界單位）。 */
  hipY: number;
  /** 腿的邊長（世界單位；方形的腿）。 */
  size: number;
}

/** 一種動物的模型版面（身體朝向 **+z**，與 `createMobRenderer` 的前方慣例一致）。 */
interface PassiveLayout {
  blocks: BlockSpec[];
  /** 兩條腿：[左, 右]。本作用**兩條腿**（不做四足的四條腿 → 簡化）。 */
  legs: readonly [LegSpec, LegSpec];
}

/** 雞：小白身 ＋ 紅冠（accent）＋ 黃喙（accent2）。 */
function chickenLayout(): PassiveLayout {
  return {
    legs: [
      { x: 0.09, hipY: 0.15, size: 0.07 },
      { x: -0.09, hipY: 0.15, size: 0.07 },
    ],
    blocks: [
      { name: 'body', slot: 'body', size: { x: 0.28, y: 0.26, z: 0.3 }, pos: { x: 0, y: 0.28, z: -0.04 } },
      { name: 'head', slot: 'head', size: { x: 0.19, y: 0.19, z: 0.19 }, pos: { x: 0, y: 0.48, z: 0.09 } },
      { name: 'comb', slot: 'accent', size: { x: 0.05, y: 0.07, z: 0.11 }, pos: { x: 0, y: 0.61, z: 0.09 } },
      { name: 'beak', slot: 'accent2', size: { x: 0.07, y: 0.05, z: 0.09 }, pos: { x: 0, y: 0.45, z: 0.23 } },
    ],
  };
}

/** 豬：粉身 ＋ 深色豬鼻（accent）。 */
function pigLayout(): PassiveLayout {
  return {
    legs: [
      { x: 0.22, hipY: 0.2, size: 0.16 },
      { x: -0.22, hipY: 0.2, size: 0.16 },
    ],
    blocks: [
      { name: 'body', slot: 'body', size: { x: 0.62, y: 0.44, z: 0.58 }, pos: { x: 0, y: 0.42, z: -0.14 } },
      { name: 'head', slot: 'head', size: { x: 0.36, y: 0.36, z: 0.36 }, pos: { x: 0, y: 0.5, z: 0.32 } },
      { name: 'snout', slot: 'accent', size: { x: 0.18, y: 0.13, z: 0.1 }, pos: { x: 0, y: 0.45, z: 0.55 } },
    ],
  };
}

/** 羊：白身（**蓬鬆＝身體高一點、也寬一點**）＋ 灰臉（head 槽是灰的）＋ 背上的羊毛。 */
function sheepLayout(): PassiveLayout {
  return {
    legs: [
      { x: 0.2, hipY: 0.28, size: 0.15 },
      { x: -0.2, hipY: 0.28, size: 0.15 },
    ],
    blocks: [
      { name: 'body', slot: 'body', size: { x: 0.78, y: 0.66, z: 0.74 }, pos: { x: 0, y: 0.61, z: -0.06 } },
      { name: 'wool', slot: 'accent', size: { x: 0.7, y: 0.12, z: 0.66 }, pos: { x: 0, y: 0.95, z: -0.06 } },
      { name: 'head', slot: 'head', size: { x: 0.3, y: 0.3, z: 0.3 }, pos: { x: 0, y: 0.92, z: 0.42 } },
    ],
  };
}

/** 牛：棕身 ＋ 白斑（accent）＋ 深色角（accent2）。 */
function cowLayout(): PassiveLayout {
  return {
    legs: [
      { x: 0.22, hipY: 0.32, size: 0.17 },
      { x: -0.22, hipY: 0.32, size: 0.17 },
    ],
    blocks: [
      { name: 'body', slot: 'body', size: { x: 0.66, y: 0.62, z: 0.74 }, pos: { x: 0, y: 0.63, z: -0.08 } },
      { name: 'head', slot: 'head', size: { x: 0.36, y: 0.36, z: 0.36 }, pos: { x: 0, y: 1.0, z: 0.4 } },
      { name: 'hornL', slot: 'accent2', size: { x: 0.07, y: 0.13, z: 0.07 }, pos: { x: 0.13, y: 1.22, z: 0.38 } },
      { name: 'hornR', slot: 'accent2', size: { x: 0.07, y: 0.13, z: 0.07 }, pos: { x: -0.13, y: 1.22, z: 0.38 } },
      { name: 'spotL', slot: 'accent', size: { x: 0.05, y: 0.26, z: 0.28 }, pos: { x: 0.335, y: 0.72, z: -0.06 } },
      { name: 'spotR', slot: 'accent', size: { x: 0.05, y: 0.26, z: 0.28 }, pos: { x: -0.335, y: 0.72, z: -0.06 } },
      { name: 'spotTop', slot: 'accent', size: { x: 0.24, y: 0.05, z: 0.24 }, pos: { x: 0, y: 0.95, z: -0.12 } },
    ],
  };
}

/** 四種動物的版面表（單一真值來源）。 */
const LAYOUTS: Record<PassiveKind, () => PassiveLayout> = {
  chicken: chickenLayout,
  pig: pigLayout,
  sheep: sheepLayout,
  cow: cowLayout,
};

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
 *  **實作要點**：
 * - **共用 unit geometry**（`BoxGeometry(1,1,1)`）＋ 每個部件用 `scale` 決定
 *   尺寸 → 一個場景一份幾何。
 * - **每隻生物一份材質** → 受擊閃白（改 `emissive`）只影響被打到的那一隻。
 * - **id-keyed 快取** → 同一個 id 每幀只更新位置／朝向／動畫，不重建 mesh。
 * - **模型建在「身高 = 1」的參考空間** → `group.scale = 身高` → 體型直接等於
 *   `PASSIVE_DEFS` 的 height（牛比雞大、羊比豬高），與命中盒一致。
 */
export function createPassiveMobRenderer(scene: THREE.Scene): PassiveMobRenderer {
  // 共用的 unit geometry（所有部件、 所有動物都用這一份）—— 釋放於 dispose()。
  const unitGeo = new THREE.BoxGeometry(1, 1, 1);
  const mobs = new Map<number, PassiveParts>();

  /** 建立一隻動物的模型（群組已加入場景）。 */
  function buildPassiveMob(kind: PassiveKind): PassiveParts {
    const def = PASSIVE_DEFS[kind];
    const layout = LAYOUTS[kind]();
    const palette = PASSIVE_PALETTE[kind];
    const height = def.height;

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
    // 參考空間是「身高 = 1」→ 整體縮放成動物的實際身高（格）。
    group.scale.setScalar(height);

    for (const spec of layout.blocks) {
      const mesh = new THREE.Mesh(unitGeo, materialFor(spec.slot));
      mesh.name = spec.name;
      // 世界單位 → 參考空間（除以身高；`group.scale` 之後會還原回來）。
      mesh.scale.set(spec.size.x / height, spec.size.y / height, spec.size.z / height);
      mesh.position.set(spec.pos.x / height, spec.pos.y / height, spec.pos.z / height);
      group.add(mesh);
    }

    /** 一條腿：樞紐在髖部，方塊往下垂 → `pivot.rotation.x` 就是前後擺動。 */
    function buildLeg(name: 'legL' | 'legR', spec: LegSpec): THREE.Group {
      const pivot = new THREE.Group();
      pivot.name = name;
      pivot.position.set(spec.x / height, spec.hipY / height, 0);
      const mesh = new THREE.Mesh(unitGeo, materialFor('leg'));
      mesh.scale.setScalar(spec.size / height);
      mesh.position.y = -spec.size / height / 2; // 方塊從髖部往下垂
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

    return {
      kind,
      group,
      legL,
      legR,
      materials: [...materials.values()],
      phase: 0,
      swing: 0,
      flash: 0,
    };
  }

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
          entry = buildPassiveMob(mob.kind);
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
      // **立刻**變白（不等下一幀的 sync）→ 玩家揮下去的那一帧就看得到閃白。
      for (const m of entry.materials) m.emissive.setHex(0xffffff);
    },

    dispose() {
      for (const id of [...mobs.keys()]) removePassiveMob(id);
      unitGeo.dispose();
    },
  };
}
