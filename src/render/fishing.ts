import * as THREE from 'three';

/** 釣魚線與浮標的視覺（B14）。
 *
 *  **這是視覺簡化**（README〈與原版的差異〉要列）：
 *  - 沒有釣魚線物理（線是兩點直線，不會被方塊擋住、也不會有重力下垂）；
 *  - 浮標是**靜態**的（浮在水面上，不隨波漂移，也沒有魚群實體）；
 *  - 第三人稱時線從**相機附近**出發（竿尖的近似位置），不是從手持模型精準長出。
 *
 *  模組本身沒有狀態：`sync(line, camera)` 每幀被呼叫一次，傳 `null` 就把整組
 *  隱藏（離開遊戲／打開背包／魚跑掉時都走這條路）。 */

export interface FishingLineView {
  /** 浮標在水面的位置（方塊座標；y 是水面高度）。 */
  bobber: { x: number; y: number; z: number };
  /** 魚訊窗口內 → 浮標下沉的動畫。 */
  biting: boolean;
}

export interface FishingRenderer {
  /** null → 隱藏整條線；否則把線重新錨到相機並把浮標放到水面上。 */
  sync(line: FishingLineView | null, camera: THREE.Camera): void;
  /** 從場景移除並釋放自建資源（可重複呼叫）。 */
  dispose(): void;
}

/** 竿尖在相機空間的近似位置（右 0.35、下 0.22、前 0.85）。
 *  右手邊與 viewmodel 的 `BASE_X = 0.42` 同一側 —— 線要從畫面右下角射出來。 */
const ROD_RIGHT = 0.35;
const ROD_DOWN = 0.22;
const ROD_FORWARD = 0.85;
/** 魚訊時浮標下沉的高度。 */
const BITE_DIP = 0.05;

export function createFishingRenderer(scene: THREE.Scene): FishingRenderer {
  const group = new THREE.Group();
  group.name = 'fishing-rig';
  group.visible = false;

  // 線：兩個點的 BufferGeometry（每幀只改這 6 個 float）。
  const lineGeometry = new THREE.BufferGeometry();
  const linePositions = new THREE.Float32BufferAttribute(new Float32Array(6), 3);
  linePositions.setUsage(THREE.DynamicDrawUsage);
  lineGeometry.setAttribute('position', linePositions);
  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0xf4f4f4,
    transparent: true,
    opacity: 0.75,
    fog: false,
  });
  const line = new THREE.Line(lineGeometry, lineMaterial);
  line.name = 'fishing-line';
  group.add(line);

  // 浮標：紅色身體 ＋ 上方白色帽子。**群組原點＝水面那一點**（帽頂），
  // 線的終點就接在原點 → 看起來是從帽頂拉出來的線。
  const bobber = new THREE.Group();
  bobber.name = 'fishing-bobber';
  const bodyGeometry = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  const bodyMaterial = new THREE.MeshBasicMaterial({ color: 0xd03b3b, fog: false });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = -0.06;
  bobber.add(body);
  const capGeometry = new THREE.BoxGeometry(0.08, 0.06, 0.08);
  const capMaterial = new THREE.MeshBasicMaterial({ color: 0xf4f4f4, fog: false });
  const cap = new THREE.Mesh(capGeometry, capMaterial);
  cap.position.y = 0.03;
  bobber.add(cap);
  group.add(bobber);

  scene.add(group);

  let disposed = false;

  return {
    sync(line: FishingLineView | null, camera: THREE.Camera): void {
      if (disposed) return;
      group.visible = line !== null;
      if (!line) return;

      camera.updateMatrixWorld();
      const e = camera.matrixWorld.elements;
      // 相機的右軸／上軸／前軸（three 的相機看向 −Z → 前軸是第三欄的相反數）。
      const rx = e[0];
      const ry = e[1];
      const rz = e[2];
      const ux = e[4];
      const uy = e[5];
      const uz = e[6];
      const fx = -e[8];
      const fy = -e[9];
      const fz = -e[10];

      const startX = camera.position.x + rx * ROD_RIGHT - ux * ROD_DOWN + fx * ROD_FORWARD;
      const startY = camera.position.y + ry * ROD_RIGHT - uy * ROD_DOWN + fy * ROD_FORWARD;
      const startZ = camera.position.z + rz * ROD_RIGHT - uz * ROD_DOWN + fz * ROD_FORWARD;

      const bobY = line.bobber.y - (line.biting ? BITE_DIP : 0);
      bobber.position.set(line.bobber.x, bobY, line.bobber.z);

      const attr = lineGeometry.getAttribute('position') as THREE.BufferAttribute;
      attr.setXYZ(0, startX, startY, startZ);
      attr.setXYZ(1, line.bobber.x, bobY, line.bobber.z);
      attr.needsUpdate = true;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      scene.remove(group);
      lineGeometry.dispose();
      lineMaterial.dispose();
      bodyGeometry.dispose();
      bodyMaterial.dispose();
      capGeometry.dispose();
      capMaterial.dispose();
    },
  };
}
