import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createPassiveMobRenderer } from './passive-mobs';
import { createPassiveMob, PASSIVE_DEFS, type PassiveKind, type PassiveMob } from '../world/passive-mobs';

// jsdom builds（不需要 WebGL）：Scene / Group / Mesh / MeshLambertMaterial 都是
// 純物件，只有 Renderer 才需要 GL context，而我們從不建立它
// （與 `scene.test.ts` 同一個前提）。

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
    const { scene, renderer } = setup();
    renderer.syncPassiveMobs([passive('chicken'), passive('cow', { id: 1 })], 0.016);
    const chicken = scene.children[0] as THREE.Group;
    const cow = scene.children[1] as THREE.Group;
    // 體型直接用 `PASSIVE_DEFS` 的 height → 群組的縮放就是身高（格）
    expect(chicken.scale.y).toBeCloseTo(PASSIVE_DEFS.chicken.height, 10);
    expect(cow.scale.y).toBeCloseTo(PASSIVE_DEFS.cow.height, 10);
    expect(cow.scale.y).toBeGreaterThan(chicken.scale.y); // 牛比雞大
    renderer.dispose();
  });

  it('the sheep is taller than the pig', () => {
    const { scene, renderer } = setup();
    renderer.syncPassiveMobs([passive('pig'), passive('sheep', { id: 1 })], 0.016);
    const pig = scene.children[0] as THREE.Group;
    const sheep = scene.children[1] as THREE.Group;
    expect(sheep.scale.y).toBeGreaterThan(pig.scale.y); // 羊比豬高
    renderer.dispose();
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
