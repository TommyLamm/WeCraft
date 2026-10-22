import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createPassiveMobRenderer, buildPassiveMobModel } from './passive-mobs';
import { createPassiveMob, PASSIVE_DEFS, type PassiveKind, type PassiveMob } from '../world/passive-mobs';

// jsdom builds（不需要 WebGL）：Scene / Group / Mesh / MeshLambertMaterial 都是
// 純物件，只有 Renderer 才需要 GL context，而我們從不建立它
// （與 `scene.test.ts` 同一個前提）。

/** 四種動物的順序（體型由小到大）。 */
const KINDS: readonly PassiveKind[] = ['chicken', 'pig', 'sheep', 'cow'];

/** 浮點容差（比較 AABB 邊界用）。 */
const EPS = 1e-6;

/** 一隻被動生物（預設＝站在原點的雞；id 固定 0 → 測試的位置斷言才精確）。 */
function passive(kind: PassiveKind = 'chicken', over: Partial<PassiveMob> = {}): PassiveMob {
  const base = createPassiveMob(kind, { x: 0, y: 0, z: 0 });
  return { ...base, id: 0, ...over };
}

function setup(): {
  scene: THREE.Scene;
  renderer: ReturnType<typeof createPassiveMobRenderer>;
} {
  const scene = new THREE.Scene();
  return { scene, renderer: createPassiveMobRenderer(scene) };
}

/**
 * 命中盒（**以 `world/passive-mobs.ts` 的 `hitPassiveMobId` 為準**）：
 * `x ± width/2`、`z ± width/2`、`y .. y + height`。
 */
function hitBoxOf(kind: PassiveKind, pos: { x: number; y: number; z: number }): THREE.Box3 {
  const def = PASSIVE_DEFS[kind];
  const half = def.width / 2;
  return new THREE.Box3(
    new THREE.Vector3(pos.x - half, pos.y, pos.z - half),
    new THREE.Vector3(pos.x + half, pos.y + def.height, pos.z + half),
  );
}

/** 渲染出來的**實際 AABB**（世界座標）——體型測試量的是這個，不是 `group.scale`。 */
function renderedBox(group: THREE.Group): THREE.Box3 {
  group.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(group);
}

describe('createPassiveMobRenderer', () => {
  it('creates a blocky group per passive mob', () => {
    const { scene, renderer } = setup();
    renderer.syncPassiveMobs([passive('chicken', { pos: { x: 1, y: 2, z: 3 } })], 0.016);
    expect(scene.children).toHaveLength(1);
    const group = scene.children[0] as THREE.Group;
    expect(group).toBeInstanceOf(THREE.Group);
    expect(group.name).toBe('passive:chicken');
    expect(group.position).toMatchObject({ x: 1, y: 2, z: 3 });
    // 「方塊身 ＋ 頭 ＋ 兩條腿」的四個具名節點
    for (const name of ['head', 'body', 'legL', 'legR']) {
      expect(group.getObjectByName(name)).toBeTruthy();
    }
    // **共用 unit geometry**：所有部件用同一份 BoxGeometry（尺寸靠 scale）→
    // 一個場景只有一份幾何記憶體。
    const head = group.getObjectByName('head') as THREE.Mesh;
    const body = group.getObjectByName('body') as THREE.Mesh;
    expect(head.geometry).toBe(body.geometry);
    // 材質是扁平的 Lambert（受日光／環境光影響，與生物模型同一風格）
    expect((head.material as THREE.MeshLambertMaterial).type).toBe('MeshLambertMaterial');
    renderer.dispose();
  });

  it('the cow is bigger than the chicken', () => {
    // **量實際渲染出來的 AABB**（不是 `group.scale` —— 舊版那個值被「乘 height
    // 又除 height」抵消 → 這條測試是**假綠**的，改定義表也抓不到回歸）。
    const { scene, renderer } = setup();
    renderer.syncPassiveMobs([passive('chicken'), passive('cow', { id: 1 })], 0);
    const chicken = renderedBox(scene.children[0] as THREE.Group);
    const cow = renderedBox(scene.children[1] as THREE.Group);
    const chickenH = chicken.max.y - chicken.min.y;
    const cowH = cow.max.y - cow.min.y;
    expect(cowH).toBeGreaterThan(chickenH); // 牛比雞大
    // 渲染高度＝定義表的 height（模型最高點就是身高）
    expect(cowH).toBeCloseTo(PASSIVE_DEFS.cow.height, 6);
    expect(chickenH).toBeCloseTo(PASSIVE_DEFS.chicken.height, 6);
    renderer.dispose();
  });

  it('the sheep is taller than the pig', () => {
    const { scene, renderer } = setup();
    renderer.syncPassiveMobs([passive('pig'), passive('sheep', { id: 1 })], 0);
    const pig = renderedBox(scene.children[0] as THREE.Group);
    const sheep = renderedBox(scene.children[1] as THREE.Group);
    expect(sheep.max.y - sheep.min.y).toBeGreaterThan(pig.max.y - pig.min.y); // 羊比豬高
    expect(sheep.max.y - sheep.min.y).toBeCloseTo(PASSIVE_DEFS.sheep.height, 6);
    expect(pig.max.y - pig.min.y).toBeCloseTo(PASSIVE_DEFS.pig.height, 6);
    renderer.dispose();
  });

  it('the visual size difference follows the hitbox size ratio (the pig vs the chicken)', () => {
    // 審查要求：**視覺**大小差異要反映命中盒的比例（舊版豬與雞只差 13%，
    // 但命中盒差 29% → 玩家分不出兩者）。
    const { scene, renderer } = setup();
    renderer.syncPassiveMobs([passive('chicken'), passive('pig', { id: 1 })], 0);
    const chickenH =
      renderedBox(scene.children[0] as THREE.Group).max.y -
      renderedBox(scene.children[0] as THREE.Group).min.y;
    const pigH =
      renderedBox(scene.children[1] as THREE.Group).max.y -
      renderedBox(scene.children[1] as THREE.Group).min.y;
    expect(pigH / chickenH).toBeCloseTo(
      PASSIVE_DEFS.pig.height / PASSIVE_DEFS.chicken.height,
      3,
    );
    renderer.dispose();
  });

  it('the rendered volume fits inside the hitbox and the feet touch the ground', () => {
    // 命中盒（`hitPassiveMobId`）：`x ± width/2`、`z ± width/2`、`y .. y + height`。
    // **渲染體積必須 ⊆ 命中盒** → 不會有「看得到卻打不到」的隱形命中區。
    const pos = { x: 3, y: 7, z: -2 };
    for (const kind of KINDS) {
      const { scene, renderer } = setup();
      renderer.syncPassiveMobs([passive(kind, { pos })], 0); // dt = 0 → 靜止（腳底貼地）
      const group = scene.children[0] as THREE.Group;
      const box = renderedBox(group);
      const hit = hitBoxOf(kind, pos);

      // ① 腳底貼地（命中盒的下緣就是地面）
      expect(box.min.y).toBeCloseTo(hit.min.y, 6);
      // ② 三個軸都不得超出命中盒
      expect(box.min.x).toBeGreaterThanOrEqual(hit.min.x - EPS);
      expect(box.max.x).toBeLessThanOrEqual(hit.max.x + EPS);
      expect(box.min.z).toBeGreaterThanOrEqual(hit.min.z - EPS);
      expect(box.max.z).toBeLessThanOrEqual(hit.max.z + EPS);
      expect(box.max.y).toBeLessThanOrEqual(hit.max.y + EPS);
      renderer.dispose();
    }
  });

  it('the rendered height follows the definition height (cow > sheep > pig > chicken)', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const heights: Partial<Record<PassiveKind, number>> = {};
    for (const kind of KINDS) {
      const { scene, renderer } = setup();
      renderer.syncPassiveMobs([passive(kind)], 0);
      const box = renderedBox(scene.children[0] as THREE.Group);
      heights[kind] = box.max.y - box.min.y;
      renderer.dispose();

      // **渲染器確實吃的是定義表的尺寸**：與「用 `PASSIVE_DEFS` 直接建出的模型」
      // 比對 → 這條和下一條（尺寸真的由參數推導）合起來＝「改定義表就會改畫面」。
      const model = buildPassiveMobModel(kind, PASSIVE_DEFS[kind], geo);
      const modelBox = renderedBox(model.group);
      expect(box.max.y).toBeCloseTo(modelBox.max.y, 6);
      expect(box.max.x).toBeCloseTo(modelBox.max.x, 6);
      expect(box.min.y).toBeCloseTo(modelBox.min.y, 6);
      for (const m of model.materials) m.dispose();
    }
    geo.dispose();

    expect(heights.cow!).toBeGreaterThan(heights.sheep!);
    expect(heights.sheep!).toBeGreaterThan(heights.pig!);
    expect(heights.pig!).toBeGreaterThan(heights.chicken!);
    // 每種動物的渲染高度＝定義表的 height
    for (const kind of KINDS) {
      expect(heights[kind]).toBeCloseTo(PASSIVE_DEFS[kind].height, 6);
    }
  });

  it('the rendered model changes when the definition size changes', () => {
    // **回歸釘子（關鍵）**：舊版的模型尺寸是寫死的字面值、而且被「乘 height 又
    // 除 height」抵消 → 改 `PASSIVE_DEFS.chicken.height` 對畫面**毫無影響**。
    // 這裡用**注入尺寸**的建模函式驗「尺寸真的由定義表推導」（不必改動全域的
    // 定義表 → 不會污染其他測試）。
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const base = buildPassiveMobModel('chicken', PASSIVE_DEFS.chicken, geo);
    const tall = buildPassiveMobModel('chicken', { width: 0.4, height: 2 }, geo);
    const wide = buildPassiveMobModel('chicken', { width: 0.8, height: 0.7 }, geo);

    const baseBox = renderedBox(base.group);
    const tallBox = renderedBox(tall.group);
    const wideBox = renderedBox(wide.group);

    expect(baseBox.max.y - baseBox.min.y).toBeCloseTo(PASSIVE_DEFS.chicken.height, 6);
    // 高度改 → 渲染高度跟著改
    expect(tallBox.max.y - tallBox.min.y).toBeCloseTo(2, 6);
    expect(tallBox.max.y).toBeGreaterThan(baseBox.max.y);
    // 寬度改 → 渲染寬度跟著改
    expect(wideBox.max.x).toBeGreaterThan(baseBox.max.x);
    // 腳底永遠貼地（不論尺寸怎麼改）
    expect(baseBox.min.y).toBeCloseTo(0, 6);
    expect(tallBox.min.y).toBeCloseTo(0, 6);
    expect(wideBox.min.y).toBeCloseTo(0, 6);

    for (const m of [...base.materials, ...tall.materials, ...wide.materials]) m.dispose();
    geo.dispose();
  });

  it('moves an existing mob without rebuilding', () => {
    const { scene, renderer } = setup();
    renderer.syncPassiveMobs([passive('pig', { pos: { x: 1, y: 2, z: 3 } })], 0.016);
    const first = scene.children[0];
    renderer.syncPassiveMobs([passive('pig', { pos: { x: 9, y: 8, z: 7 } })], 0.016);
    expect(scene.children).toHaveLength(1); // 沒有重複
    expect(scene.children[0]).toBe(first); // 同一個實例（沒有重建）
    expect((first as THREE.Group).position.x).toBe(9);
    expect((first as THREE.Group).position.z).toBe(7);
    renderer.dispose();
  });

  it('removes the group when the mob disappears', () => {
    const { scene, renderer } = setup();
    renderer.syncPassiveMobs([passive('pig', { id: 1 }), passive('cow', { id: 2 })], 0.016);
    expect(scene.children).toHaveLength(2);
    renderer.syncPassiveMobs([passive('cow', { id: 2 })], 0.016); // id 1 死了
    expect(scene.children).toHaveLength(1);
    renderer.syncPassiveMobs([], 0.016);
    expect(scene.children).toHaveLength(0);
    renderer.dispose();
  });

  it('white-flashes a passive mob on hit', () => {
    const { scene, renderer } = setup();
    renderer.syncPassiveMobs([passive('cow', { id: 3 })], 0.016);
    const head = (scene.children[0] as THREE.Group).getObjectByName('head') as THREE.Mesh;
    const mat = head.material as THREE.MeshLambertMaterial;
    expect(mat.emissive.getHex()).toBe(0x000000); // 預設平色

    renderer.flashPassiveMob(3);
    expect(mat.emissive.getHex()).toBe(0xffffff); // 受擊 → 閃白
    renderer.syncPassiveMobs([passive('cow', { id: 3 })], 0.05); // 0.1 − 0.05 > 0 → 還在閃
    expect(mat.emissive.getHex()).toBe(0xffffff);
    renderer.syncPassiveMobs([passive('cow', { id: 3 })], 0.1); // 時間到 → 回到平色
    expect(mat.emissive.getHex()).toBe(0x000000);
    renderer.dispose();
  });

  it('treats non-finite dt as 0', () => {
    const { scene, renderer } = setup();
    renderer.syncPassiveMobs(
      [passive('chicken', { vel: { x: 1.9, y: 0, z: 0 } })],
      Number.NaN,
    );
    const group = scene.children[0] as THREE.Group;
    const legL = group.getObjectByName('legL') as THREE.Group;
    expect(legL.rotation.x).toBe(0); // 相位沒有前進
    expect(Number.isFinite(legL.rotation.x)).toBe(true);
    renderer.dispose();
  });

  it('gives every mob its own materials so a hit flash only affects that mob', () => {
    const { scene, renderer } = setup();
    renderer.syncPassiveMobs([passive('pig'), passive('pig', { id: 1 })], 0.016);
    const headA = (scene.children[0] as THREE.Group).getObjectByName('head') as THREE.Mesh;
    const headB = (scene.children[1] as THREE.Group).getObjectByName('head') as THREE.Mesh;
    const matA = headA.material as THREE.MeshLambertMaterial;
    const matB = headB.material as THREE.MeshLambertMaterial;
    expect(matA).not.toBe(matB); // 每隻生物一份材質
    expect(matA.color.getHex()).toBe(matB.color.getHex()); // 但顏色相同
    expect(headA.geometry).toBe(headB.geometry); // geometry 仍然共用
    renderer.flashPassiveMob(0);
    expect(matA.emissive.getHex()).toBe(0xffffff);
    expect(matB.emissive.getHex()).toBe(0x000000); // 另一隻不受影響
    renderer.dispose();
  });

  it('swings the legs while walking and turns to face its yaw', () => {
    const { scene, renderer } = setup();
    // 雞的速度 1.9 格/秒 → phase = 1.9 · 0.1 · 4 = 0.76 → swing = sin(0.76) · 0.6
    renderer.syncPassiveMobs(
      [passive('chicken', { vel: { x: 1.9, y: 0, z: 0 }, yaw: Math.PI / 2 })],
      0.1,
    );
    const group = scene.children[0] as THREE.Group;
    const legL = group.getObjectByName('legL') as THREE.Group;
    const legR = group.getObjectByName('legR') as THREE.Group;
    expect(legL.rotation.x).toBeCloseTo(Math.sin(0.76) * 0.6, 10);
    expect(legR.rotation.x).toBeCloseTo(-legL.rotation.x, 10); // 兩條腿反向擺
    // **朝向用 AI 算好的 `yaw`**（停下時保留 → 不會突然轉回去）
    expect(group.rotation.y).toBeCloseTo(Math.PI / 2, 10);

    // 停下 → 擺動衰減歸零（停在正中間，不是定格在半步）
    for (let i = 0; i < 120; i++) {
      renderer.syncPassiveMobs([passive('chicken', { yaw: Math.PI / 2 })], 0.05);
    }
    expect(legL.rotation.x).toBe(0);
    expect(group.rotation.y).toBeCloseTo(Math.PI / 2, 10); // 朝向不變
    renderer.dispose();
  });
});
