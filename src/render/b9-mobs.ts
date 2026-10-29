import * as THREE from 'three';
import { CREEPER_HEIGHT, CREEPER_WIDTH, creeperFuseProgress, type Creeper } from '../world/creeper';
import { SPIDER_HEIGHT, SPIDER_WIDTH, type Spider } from '../world/spider';

// ---- 苦力怕與蜘蛛的方塊化渲染（B9 Task 10）----
//
// **為什麼另開一個模組**：`render/scene.ts` 的 `createMobRenderer` 骨架是「頭＋
// 身＋兩腿＋兩臂」的直立人形；蜘蛛是 1.4 寬 0.9 高的橫向八足體，苦力怕是沒有
// 手臂的四足綠色身體 → 硬塞進人形骨架只會互相礙事。這與 B4 另開
// `render/passive-mobs.ts` 的理由相同。
//
// **結構完全比照 `createMobRenderer`／`createPassiveMobRenderer`**：
// - 共用 unit geometry（一份 `BoxGeometry(1,1,1)`，尺寸靠 `mesh.scale`）。
// - **每隻生物一份材質**：受擊閃白是改這一隻的 `emissive` → 不會整群一起閃。
// - **id-keyed 快取**：同 id 只更新位置／動畫，不重建。
// - `dispose()` 移除所有 group、釋放材質與共用幾何。
//
// **模型是簡化的方塊模型**（README 的差異清單會列）：苦力怕＝綠色身體＋頭＋
// **四條腿**（`legFL`／`legFR`／`legBL`／`legBR`）＋深色臉部斑塊；蜘蛛＝深色
// 軀幹＋頭＋兩點紅眼＋**八條腿**（每條兩段）。所有部件都落在命中盒
// （`world/creeper.ts`／`world/spider.ts`）之內：腳底 y = 0 起算、頭頂不超過
// `CREEPER_HEIGHT`／`SPIDER_HEIGHT`。
//
// **朝向**：兩種實體都沒有 `yaw` 欄位 → 由水平速度推導（停下時保留上一次的
// 方向，不會突然轉回去）；與 `passive-mobs.ts` 讀 AI 算好的 yaw 同一個效果。
//
// **苦力怕的引信閃白**：`creeperFuseProgress` 0→1 時，`emissive` 由黑插值到
// 全白 → 玩家看得出「快要爆了」。受擊閃白（0.1 秒）優先於引信閃白。

/** 受擊閃白的秒數（與其他生物一致）。 */
const FLASH_SEC = 0.1;
/** 擺動幅度（弧度）。 */
const SWING_AMPLITUDE = 0.6;
/** 行走相位推進速度：`phase += 水平速度 · dt · 4`。 */
const WALK_FREQ = 4;
/** 水平速度低於這個值 → 視為「站著不動」。 */
const MOVE_EPS = 0.01;

/** 苦力怕的調色盤（原版綠）。 */
const CREEPER_COLORS = { body: 0x4a7a3a, detail: 0x2b3a2a };
/** 蜘蛛的調色盤（深褐＋紅眼）。 */
const SPIDER_COLORS = { body: 0x2b1b16, detail: 0xb02020 };

interface CreeperParts {
  group: THREE.Group;
  materials: THREE.MeshLambertMaterial[];
  legs: [THREE.Group, THREE.Group, THREE.Group, THREE.Group];
  phase: number;
  swing: number;
  flash: number;
  yaw: number;
}

interface SpiderParts {
  group: THREE.Group;
  materials: THREE.MeshLambertMaterial[];
  legs: THREE.Group[];
  phase: number;
  swing: number;
  flash: number;
  yaw: number;
}

export interface B9MobRenderer {
  /** 建立／移動／轉向／動畫化每一隻苦力怕（引信閃白也在這裡更新）。 */
  syncCreepers(list: readonly Creeper[], dt: number): void;
  /** 建立／移動／轉向／動畫化每一隻蜘蛛（攀爬時腿部不擺動）。 */
  syncSpiders(list: readonly Spider[], dt: number): void;
  /** 讓指定的苦力怕閃白 0.1 秒（未知 id → 什麼都不做）。 */
  flashCreeper(id: number): void;
  /** 讓指定的蜘蛛閃白 0.1 秒（未知 id → 什麼都不做）。 */
  flashSpider(id: number): void;
  /** 移除所有 group、釋放每隻的材質與共用的幾何（可重複呼叫）。 */
  dispose(): void;
}

/** 建立一隻苦力怕的模型（尺寸由 `CREEPER_WIDTH`／`CREEPER_HEIGHT` 推導）。 */
function buildCreeper(unitGeo: THREE.BufferGeometry): {
  group: THREE.Group;
  materials: THREE.MeshLambertMaterial[];
  legs: [THREE.Group, THREE.Group, THREE.Group, THREE.Group];
} {
  const bodyMat = new THREE.MeshLambertMaterial({ color: CREEPER_COLORS.body });
  const detailMat = new THREE.MeshLambertMaterial({ color: CREEPER_COLORS.detail });
  const materials = [bodyMat, detailMat];
  const group = new THREE.Group();

  const w = CREEPER_WIDTH; // 0.6
  const h = CREEPER_HEIGHT; // 1.7
  const legH = h * 0.206; // 0.35
  const legT = w * 0.27; // 0.162
  const bodyH = h * 0.529; // 0.9
  const bodyW = w * 0.833; // 0.5
  const bodyD = w * 0.6; // 0.36
  const headSide = w * 0.833; // 0.5
  const headH = h * 0.265; // 0.45

  // 身體：從腿頂（legH）到頭底（h - headH）
  const body = new THREE.Mesh(unitGeo, bodyMat);
  body.name = 'body';
  body.scale.set(bodyW, bodyH, bodyD);
  body.position.set(0, legH + bodyH / 2, 0);
  group.add(body);

  const head = new THREE.Mesh(unitGeo, bodyMat);
  head.name = 'head';
  head.scale.set(headSide, headH, headSide);
  head.position.set(0, h - headH / 2, 0);
  group.add(head);

  // 臉：兩個深色眼斑＋一張嘴（貼在頭的前面）
  const frontZ = headSide / 2 + 0.011;
  for (const [name, x, y, sx, sy] of [
    ['eyeL', -headSide * 0.22, h - headH * 0.35, headSide * 0.22, headH * 0.22],
    ['eyeR', headSide * 0.22, h - headH * 0.35, headSide * 0.22, headH * 0.22],
    ['mouth', 0, h - headH * 0.7, headSide * 0.34, headH * 0.18],
  ] as const) {
    const patch = new THREE.Mesh(unitGeo, detailMat);
    patch.name = name;
    patch.scale.set(sx, sy, 0.02);
    patch.position.set(x, y, frontZ);
    group.add(patch);
  }

  // 四條腿：樞紐在腿頂（y = legH），方塊往下垂到腳底 0
  const legX = bodyW / 2 - legT / 2;
  const legZ = bodyD / 2 - legT / 2;
  const legs: [THREE.Group, THREE.Group, THREE.Group, THREE.Group] = [
    new THREE.Group(),
    new THREE.Group(),
    new THREE.Group(),
    new THREE.Group(),
  ];
  const names = ['legFL', 'legFR', 'legBL', 'legBR'] as const;
  const spots: Array<[number, number]> = [
    [legX, legZ],
    [-legX, legZ],
    [legX, -legZ],
    [-legX, -legZ],
  ];
  legs.forEach((pivot, i) => {
    pivot.name = names[i];
    pivot.position.set(spots[i][0], legH, spots[i][1]);
    const mesh = new THREE.Mesh(unitGeo, bodyMat);
    mesh.scale.set(legT, legH, legT);
    mesh.position.y = -legH / 2;
    pivot.add(mesh);
    group.add(pivot);
  });

  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.castShadow = true;
  });
  return { group, materials, legs };
}

/** 建立一隻蜘蛛的模型（尺寸由 `SPIDER_WIDTH`／`SPIDER_HEIGHT` 推導）。 */
function buildSpider(unitGeo: THREE.BufferGeometry): {
  group: THREE.Group;
  materials: THREE.MeshLambertMaterial[];
  legs: THREE.Group[];
} {
  const bodyMat = new THREE.MeshLambertMaterial({ color: SPIDER_COLORS.body });
  const eyeMat = new THREE.MeshLambertMaterial({ color: SPIDER_COLORS.detail });
  const materials = [bodyMat, eyeMat];
  const group = new THREE.Group();

  const w = SPIDER_WIDTH; // 1.4
  const h = SPIDER_HEIGHT; // 0.9

  const body = new THREE.Mesh(unitGeo, bodyMat);
  body.name = 'body';
  body.scale.set(w * 0.5, h * 0.39, w * 0.43); // 0.7 × 0.35 × 0.6
  body.position.set(0, h * 0.61, 0); // 0.375..0.725
  group.add(body);

  const head = new THREE.Mesh(unitGeo, bodyMat);
  head.name = 'head';
  head.scale.set(w * 0.36, h * 0.33, w * 0.29); // 0.5 × 0.3 × 0.4
  head.position.set(0, h * 0.61, w * 0.32); // 前緣 z = 0.65
  group.add(head);

  // 兩點紅眼（貼在頭的前面）
  for (const x of [-w * 0.086, w * 0.086]) {
    const eye = new THREE.Mesh(unitGeo, eyeMat);
    eye.name = 'eye';
    eye.scale.set(w * 0.064, h * 0.1, 0.03);
    eye.position.set(x, h * 0.67, w * 0.47);
    group.add(eye);
  }

  // 八條腿（每邊四條）：樞紐在身體側面，兩段方塊（上段外伸、下段下垂）。
  const legs: THREE.Group[] = [];
  const zs = [-0.27, -0.09, 0.09, 0.27];
  for (const side of [1, -1] as const) {
    for (const z of zs) {
      const pivot = new THREE.Group();
      pivot.name = `leg${legs.length + 1}`;
      pivot.position.set(side * w * 0.2, h * 0.56, z * w);
      const upper = new THREE.Mesh(unitGeo, bodyMat);
      upper.scale.set(w * 0.17, h * 0.067, h * 0.067);
      upper.position.set(side * w * 0.085, -h * 0.02, 0);
      pivot.add(upper);
      const lower = new THREE.Mesh(unitGeo, bodyMat);
      lower.scale.set(h * 0.067, h * 0.4, h * 0.067);
      lower.position.set(side * w * 0.17, -h * 0.26, 0);
      pivot.add(lower);
      group.add(pivot);
      legs.push(pivot);
    }
  }

  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.castShadow = true;
  });
  return { group, materials, legs };
}

/** 把水平速度換成朝向（停下時保留上一次的方向）。 */
function yawFromVelocity(vx: number, vz: number, prev: number): number {
  const hSpeed = Math.hypot(vx, vz);
  if (hSpeed <= MOVE_EPS || !Number.isFinite(hSpeed)) return prev;
  const yaw = Math.atan2(vx, vz);
  return Number.isFinite(yaw) ? yaw : prev;
}

/** 走路擺動：有速度就推進相位，停下時衰減回正中間（與其他生物一致）。 */
function advanceSwing(
  hSpeed: number,
  step: number,
  phase: number,
  swing: number,
): { phase: number; swing: number } {
  if (hSpeed > MOVE_EPS && step > 0) {
    const nextPhase = phase + hSpeed * step * WALK_FREQ;
    return { phase: nextPhase, swing: Math.sin(nextPhase) * SWING_AMPLITUDE };
  }
  if (step > 0) {
    const next = swing * Math.pow(0.01, step);
    if (Math.abs(next) < 1e-4) return { phase: 0, swing: 0 };
    return { phase, swing: next };
  }
  return { phase, swing };
}

/** 蜘蛛的擺動：攀爬時**凍結**（腿部不擺動），其餘照一般走路規則。 */
function climbableSwing(
  hSpeed: number,
  step: number,
  current: { phase: number; swing: number },
  climbing: boolean,
): { phase: number; swing: number } {
  if (climbing) return { phase: current.phase, swing: 0 };
  return advanceSwing(hSpeed, step, current.phase, current.swing);
}

/** 建立苦力怕與蜘蛛的渲染器。 */
export function createB9MobRenderer(scene: THREE.Scene): B9MobRenderer {
  const unitGeo = new THREE.BoxGeometry(1, 1, 1);
  const creepers = new Map<number, CreeperParts>();
  const spiders = new Map<number, SpiderParts>();

  const removeCreeper = (id: number): void => {
    const entry = creepers.get(id);
    if (!entry) return;
    scene.remove(entry.group);
    for (const m of entry.materials) m.dispose();
    creepers.delete(id);
  };
  const removeSpider = (id: number): void => {
    const entry = spiders.get(id);
    if (!entry) return;
    scene.remove(entry.group);
    for (const m of entry.materials) m.dispose();
    spiders.delete(id);
  };

  const creeperEmissive = (flash: number, progress: number): number => {
    if (flash > 0) return 0xffffff;
    const v = Math.max(0, Math.min(1, progress));
    const level = Math.round(v * 255);
    return (level << 16) | (level << 8) | level;
  };

  return {
    syncCreepers(list, dt) {
      const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
      const live = new Set<number>();
      for (const c of list) {
        live.add(c.id);
        let entry = creepers.get(c.id);
        if (!entry) {
          const built = buildCreeper(unitGeo);
          built.group.name = `creeper:${c.id}`;
          entry = { ...built, phase: 0, swing: 0, flash: 0, yaw: 0 };
          creepers.set(c.id, entry);
          scene.add(entry.group);
        }
        // NaN 防護：壞座標會經過矩陣計算擴散成 NaN 汙染整個場景。
        const px = Number.isFinite(c.pos.x) ? c.pos.x : 0;
        const py = Number.isFinite(c.pos.y) ? c.pos.y : 0;
        const pz = Number.isFinite(c.pos.z) ? c.pos.z : 0;
        entry.group.position.set(px, py, pz);
        const vx = Number.isFinite(c.vel.x) ? c.vel.x : 0;
        const vz = Number.isFinite(c.vel.z) ? c.vel.z : 0;
        entry.yaw = yawFromVelocity(vx, vz, entry.yaw);
        entry.group.rotation.y = entry.yaw;

        const moved = advanceSwing(Math.hypot(vx, vz), step, entry.phase, entry.swing);
        entry.phase = moved.phase;
        entry.swing = moved.swing;
        // 對角步態：FL/BR 同相、FR/BL 反相。
        entry.legs[0].rotation.x = entry.swing;
        entry.legs[3].rotation.x = entry.swing;
        entry.legs[1].rotation.x = -entry.swing;
        entry.legs[2].rotation.x = -entry.swing;

        entry.flash = Math.max(0, entry.flash - step);
        const emissive = creeperEmissive(entry.flash, creeperFuseProgress(c));
        for (const m of entry.materials) m.emissive.setHex(emissive);
      }
      for (const id of [...creepers.keys()]) if (!live.has(id)) removeCreeper(id);
    },

    syncSpiders(list, dt) {
      const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
      const live = new Set<number>();
      for (const s of list) {
        live.add(s.id);
        let entry = spiders.get(s.id);
        if (!entry) {
          const built = buildSpider(unitGeo);
          built.group.name = `spider:${s.id}`;
          entry = { ...built, phase: 0, swing: 0, flash: 0, yaw: 0 };
          spiders.set(s.id, entry);
          scene.add(entry.group);
        }
        const px = Number.isFinite(s.pos.x) ? s.pos.x : 0;
        const py = Number.isFinite(s.pos.y) ? s.pos.y : 0;
        const pz = Number.isFinite(s.pos.z) ? s.pos.z : 0;
        entry.group.position.set(px, py, pz);
        const vx = Number.isFinite(s.vel.x) ? s.vel.x : 0;
        const vz = Number.isFinite(s.vel.z) ? s.vel.z : 0;
        entry.yaw = yawFromVelocity(vx, vz, entry.yaw);
        entry.group.rotation.y = entry.yaw;

        // 攀牆時腿部不擺動（原版：貼著牆往上走，腳不會前後擺）。
        const climbing = s.state === 'climb';
        const moved = climbableSwing(Math.hypot(vx, vz), step, entry, climbing);
        entry.phase = moved.phase;
        entry.swing = moved.swing;
        entry.legs.forEach((leg, i) => {
          leg.rotation.x = i % 2 === 0 ? entry.swing : -entry.swing;
        });

        entry.flash = Math.max(0, entry.flash - step);
        const emissive = entry.flash > 0 ? 0xffffff : 0x000000;
        for (const m of entry.materials) m.emissive.setHex(emissive);
      }
      for (const id of [...spiders.keys()]) if (!live.has(id)) removeSpider(id);
    },

    flashCreeper(id) {
      const entry = creepers.get(id);
      if (!entry) return;
      entry.flash = FLASH_SEC;
      for (const m of entry.materials) m.emissive.setHex(0xffffff);
    },
    flashSpider(id) {
      const entry = spiders.get(id);
      if (!entry) return;
      entry.flash = FLASH_SEC;
      for (const m of entry.materials) m.emissive.setHex(0xffffff);
    },

    dispose() {
      for (const id of [...creepers.keys()]) removeCreeper(id);
      for (const id of [...spiders.keys()]) removeSpider(id);
      unitGeo.dispose();
    },
  };
}
