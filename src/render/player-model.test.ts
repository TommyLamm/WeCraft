import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createPlayerModel } from './player-model';

// jsdom 建得出真正的 Three 物件（Scene / Group / Mesh / 幾何 / 材質）——不需要
// WebGL context（比照 src/render/scene.test.ts 的做法：只建場景物件，不建 Renderer）。

/** 三角形數：indexed 幾何以 index.count/3 計算（非 indexed 用頂點數/3）。 */
function triangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  if (index) return index.count / 3;
  return geometry.getAttribute('position').count / 3;
}

/** 盒子的尺寸參數（brief 部位表的 width／height／depth）。 */
function boxSize(mesh: THREE.Mesh): { width: number; height: number; depth: number } {
  const geo = mesh.geometry as THREE.BoxGeometry;
  return { width: geo.parameters.width, height: geo.parameters.height, depth: geo.parameters.depth };
}

/** 平面貼片的尺寸參數（brief 部位表的 width／height）。 */
function planeSize(mesh: THREE.Mesh): { width: number; height: number } {
  const geo = mesh.geometry as THREE.PlaneGeometry;
  return { width: geo.parameters.width, height: geo.parameters.height };
}

/** 材質顏色（hex）。 */
function meshColor(mesh: THREE.Mesh): number {
  return (mesh.material as THREE.MeshLambertMaterial).color.getHex();
}

describe('createPlayerModel', () => {
  it('the model is added to the scene with a head, a body, arms and legs', () => {
    const scene = new THREE.Scene();
    const model = createPlayerModel(scene);
    expect(scene.children).toHaveLength(1);
    const g = scene.children[0] as THREE.Group;
    expect(model.group).toBe(g); // 回傳的 group 就是場景裡的那一個
    expect(g.getObjectByName('head')).toBeInstanceOf(THREE.Mesh);
    expect(g.getObjectByName('body')).toBeInstanceOf(THREE.Mesh);
    expect(g.getObjectByName('armL')).toBeInstanceOf(THREE.Mesh);
    expect(g.getObjectByName('armR')).toBeInstanceOf(THREE.Mesh);
    expect(g.getObjectByName('legL')).toBeInstanceOf(THREE.Mesh);
    expect(g.getObjectByName('legR')).toBeInstanceOf(THREE.Mesh);
  });

  it('the model is 1.8 blocks tall like the player hitbox', () => {
    const scene = new THREE.Scene();
    createPlayerModel(scene);
    const g = scene.children[0] as THREE.Group;
    // 模型原高 2.0 格 × 0.9 ＝ 1.8 格（與玩家 hitbox 同高）
    expect(g.scale.y).toBeCloseTo(0.9, 6);
  });

  it('the model has no animated parts', () => {
    const scene = new THREE.Scene();
    createPlayerModel(scene);
    const g = scene.children[0] as THREE.Group;

    // 肢體是靜態 Mesh，不是可旋轉的樞紐 Group
    const pivots: string[] = [];
    g.traverse((obj) => {
      if ((obj.name === 'legL' || obj.name === 'legR') && obj instanceof THREE.Group) {
        pivots.push(obj.name);
      }
    });
    expect(pivots).toEqual([]);
    // 整個 group 的子節點都是 Mesh → 沒有任何樞紐層級（無行走循環）
    expect(g.children.every((child) => child instanceof THREE.Mesh)).toBe(true);

    // 沒有 animation clip／skeleton（本模型完全不動畫）。
    // 註：brief 原本寫 `expect(g.animations).toBeUndefined()`，但 three 0.170.0 的
    // `Object3D` 构造函数**必定**建立 `this.animations = []`（node_modules/three/
    // src/core/Object3D.js:117）→ 任何 THREE.Group 的 `animations` 都不可能是
    // undefined，該斷言無法成立。此處改驗其**意圖**「模型沒有任何動畫資料」：
    // clip 陣列為空、且沒有 skeleton（bone 綁定）屬性。
    //
    // **邊界（這組斷言攔不到什麼）**：`THREE.SkinnedMesh` 是 `Mesh` 的子類別 →
    // 一個「帶骨骼的子節點」仍會通過「子節點都是 Mesh」與「**根 group** 的
    // `skeleton` 為 undefined」兩項檢查（`skeleton` 屬性掛在子節點上，不掛在
    // group 上）。現行模型**沒有任何骨骼**（無實害）→ 若日後引入骨骼，這組斷言
    // 不足以攔下，須另加「子節點不得是 SkinnedMesh」的檢查。
    const asRecord = g as unknown as Record<string, unknown>;
    expect(asRecord.animations).toEqual([]);
    expect(asRecord.skeleton).toBeUndefined();
  });

  it('setPose moves the model to the feet and turns it to the player yaw', () => {
    const scene = new THREE.Scene();
    const model = createPlayerModel(scene);
    const g = scene.children[0] as THREE.Group;
    model.setPose({ x: 1, y: 65, z: 2 }, Math.PI / 2);
    expect(g.position.x).toBe(1);
    expect(g.position.y).toBe(65);
    expect(g.position.z).toBe(2);
    expect(g.rotation.y).toBeCloseTo(Math.PI / 2, 10);
    // 契約：`feet` 是**腳底**位置（`player.position`），不是眼睛高度（+1.62）
    // → 模型底面貼合腳底、頂端 = 腳底 + 1.8 格（與玩家 hitbox `PLAYER_HEIGHT` 同高）
    const box = new THREE.Box3().setFromObject(g);
    expect(box.min.y).toBeCloseTo(65, 6);
    expect(box.max.y).toBeCloseTo(66.8, 6);
  });

  it('setVisible toggles the whole group', () => {
    const scene = new THREE.Scene();
    const model = createPlayerModel(scene);
    const g = scene.children[0] as THREE.Group;
    model.setVisible(false);
    expect(g.visible).toBe(false);
    model.setVisible(true);
    expect(g.visible).toBe(true);
  });

  it('dispose removes the model from the scene', () => {
    const scene = new THREE.Scene();
    const model = createPlayerModel(scene);
    expect(scene.children).toHaveLength(1);
    model.dispose();
    expect(scene.children).toHaveLength(0);
  });

  // ---- 釘住 brief Step 3 的明文行為（尺寸／位置／顏色／效能預算） ----

  it('the model stands 1.8 blocks tall with its feet on the ground', () => {
    const scene = new THREE.Scene();
    createPlayerModel(scene);
    const g = scene.children[0] as THREE.Group;
    // 量世界座標（group.scale 0.9 已套用）：腳底貼地（min.y = 0）、頭頂 = 1.8 格
    const box = new THREE.Box3().setFromObject(g);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(1.8, 6);
    expect(box.max.y - box.min.y).toBeCloseTo(1.8, 6);
  });

  it('the head and the body match the brief sizes and positions', () => {
    const scene = new THREE.Scene();
    createPlayerModel(scene);
    const g = scene.children[0] as THREE.Group;

    // 頭：0.5×0.5×0.5、y 1.5–2.0（中心 1.75）
    const head = g.getObjectByName('head') as THREE.Mesh;
    expect(head.position.y).toBeCloseTo(1.75, 10);
    expect(boxSize(head)).toEqual({ width: 0.5, height: 0.5, depth: 0.5 });
    expect(head.scale.toArray()).toEqual([1, 1, 1]); // 尺寸來自幾何，不是部件縮放

    // 身：0.5×0.75×0.25、y 0.75–1.5（中心 1.125）
    const body = g.getObjectByName('body') as THREE.Mesh;
    expect(body.position.y).toBeCloseTo(1.125, 10);
    expect(boxSize(body)).toEqual({ width: 0.5, height: 0.75, depth: 0.25 });
    expect(body.scale.toArray()).toEqual([1, 1, 1]);
  });

  it('the arms and the legs match the brief sizes and positions', () => {
    const scene = new THREE.Scene();
    createPlayerModel(scene);
    const g = scene.children[0] as THREE.Group;

    // 手臂：0.25×0.75×0.25、x = ±0.375、y 0.75–1.5（中心 1.125）
    const armL = g.getObjectByName('armL') as THREE.Mesh;
    const armR = g.getObjectByName('armR') as THREE.Mesh;
    expect(armL.position.x).toBeCloseTo(0.375, 10);
    expect(armL.position.y).toBeCloseTo(1.125, 10);
    expect(armR.position.x).toBeCloseTo(-0.375, 10);
    expect(armR.position.y).toBeCloseTo(1.125, 10);
    for (const arm of [armL, armR]) {
      expect(boxSize(arm)).toEqual({ width: 0.25, height: 0.75, depth: 0.25 });
      expect(arm.scale.toArray()).toEqual([1, 1, 1]);
    }

    // 腿：0.25×0.75×0.25、x = ±0.125、y 0–0.75（中心 0.375）
    const legL = g.getObjectByName('legL') as THREE.Mesh;
    const legR = g.getObjectByName('legR') as THREE.Mesh;
    expect(legL.position.x).toBeCloseTo(0.125, 10);
    expect(legL.position.y).toBeCloseTo(0.375, 10);
    expect(legR.position.x).toBeCloseTo(-0.125, 10);
    expect(legR.position.y).toBeCloseTo(0.375, 10);
    for (const leg of [legL, legR]) {
      expect(boxSize(leg)).toEqual({ width: 0.25, height: 0.75, depth: 0.25 });
      expect(leg.scale.toArray()).toEqual([1, 1, 1]);
    }
  });

  it('every part uses the brief palette colors', () => {
    const scene = new THREE.Scene();
    createPlayerModel(scene);
    const g = scene.children[0] as THREE.Group;
    const part = (name: string): THREE.Mesh => g.getObjectByName(name) as THREE.Mesh;
    // 膚色 0xc9915f：頭＋手臂；上衣 0x3f6fb5：身；褲子 0x35415c：腿；臉 0x2b1d12
    expect(meshColor(part('head'))).toBe(0xc9915f);
    expect(meshColor(part('armL'))).toBe(0xc9915f);
    expect(meshColor(part('armR'))).toBe(0xc9915f);
    expect(meshColor(part('body'))).toBe(0x3f6fb5);
    expect(meshColor(part('legL'))).toBe(0x35415c);
    expect(meshColor(part('legR'))).toBe(0x35415c);
    expect(meshColor(part('face'))).toBe(0x2b1d12);
  });

  it('the face patch sits on the front of the head, facing the player front', () => {
    const scene = new THREE.Scene();
    createPlayerModel(scene);
    const g = scene.children[0] as THREE.Group;
    const face = g.getObjectByName('face') as THREE.Mesh;
    expect(face).toBeInstanceOf(THREE.Mesh);
    // 貼片尺寸 0.4×0.25
    expect(planeSize(face)).toEqual({ width: 0.4, height: 0.25 });
    // 頭的 −z 面（半深 0.25）＋ 0.01 浮出量 → z = −0.26；y = 1.75（頭中央）
    expect(face.position.z).toBeCloseTo(-0.26, 10);
    expect(face.position.y).toBeCloseTo(1.75, 10);
    // yaw=0 時貼片法線朝 −z（玩家前方）→ 面前視角看得到正面
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(face.quaternion);
    expect(normal.z).toBeCloseTo(-1, 6);
    expect(Math.abs(normal.x)).toBeLessThan(1e-6);
  });

  it('every part casts a shadow and the model stays at 74 triangles', () => {
    const scene = new THREE.Scene();
    createPlayerModel(scene);
    const g = scene.children[0] as THREE.Group;
    const meshes: THREE.Mesh[] = [];
    g.traverse((obj) => {
      if (obj instanceof THREE.Mesh) meshes.push(obj);
    });
    // 頭／貼片／身／2 手臂／2 腿 ＝ 7 個 Mesh
    expect(meshes).toHaveLength(7);
    for (const mesh of meshes) expect(mesh.castShadow).toBe(true);
    // 6 個盒子 × 12 三角形 ＋ 貼片（PlaneGeometry）2 三角形 ＝ 74
    const triangles = meshes.reduce((sum, mesh) => sum + triangleCount(mesh.geometry), 0);
    expect(triangles).toBe(74);
  });

  it('dispose frees the geometries and the materials', () => {
    const scene = new THREE.Scene();
    const model = createPlayerModel(scene);
    const g = scene.children[0] as THREE.Group;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    g.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      geometries.add(obj.geometry);
      materials.add(obj.material as THREE.Material);
    });
    const geoSpies = [...geometries].map((geo) => vi.spyOn(geo, 'dispose'));
    const matSpies = [...materials].map((mat) => vi.spyOn(mat, 'dispose'));
    model.dispose();
    // **只斷言「被呼叫過」**（不鎖定次數）：`dispose()` **非冪等** → 呼叫一次會
    // 對 **4 個幾何**與 **4 個材質**各送一次 dispose 事件；呼叫兩次就送兩次
    // （Three 的 dispose 事件可重複送出）。**加冪等＝改行為**，故不釘死次數；
    // 呼叫端只應在釋放時呼叫一次（見 `PlayerModel.dispose` 的 JSDoc）。
    for (const spy of [...geoSpies, ...matSpies]) expect(spy).toHaveBeenCalled();
  });
});
