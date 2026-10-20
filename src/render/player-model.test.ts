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

  // ---- 以下釘住 brief Step 3 的明文行為（尺寸／貼片位置／效能預算） ----

  it('the face patch sits on the front of the head, facing the player front', () => {
    const scene = new THREE.Scene();
    createPlayerModel(scene);
    const g = scene.children[0] as THREE.Group;
    const face = g.getObjectByName('face') as THREE.Mesh;
    expect(face).toBeInstanceOf(THREE.Mesh);
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
    for (const spy of [...geoSpies, ...matSpies]) expect(spy).toHaveBeenCalled();
  });
});
