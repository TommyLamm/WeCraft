import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createXpOrbRenderer } from './xp-orbs';
import type { XpOrb } from '../world/xp-orbs';

// jsdom builds（不需要 WebGL）：Scene / Mesh / BoxGeometry / MeshBasicMaterial
// 都是純物件，只有 Renderer 才需要 GL context（與 `fishing.test.ts`／
// `b9-mobs.test.ts` 同一個前提）。

function orb(over: Partial<XpOrb> = {}): XpOrb {
  return {
    id: 1,
    value: 1,
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    age: 0,
    pickupDelay: 0,
    ...over,
  };
}

function setup(): {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  view: ReturnType<typeof createXpOrbRenderer>;
} {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 10, 0);
  return { scene, camera, view: createXpOrbRenderer(scene) };
}

const meshesOf = (scene: THREE.Scene): THREE.Mesh[] =>
  scene.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);

describe('createXpOrbRenderer (B17 Task 3)', () => {
  it('adds one mesh per orb and keys them by id', () => {
    const { scene, camera, view } = setup();
    view.syncOrbs([orb({ id: 3 }), orb({ id: 7 })], camera, 0.1);

    const meshes = meshesOf(scene);
    expect(meshes).toHaveLength(2);
    expect(meshes.map((m) => m.name)).toEqual(
      expect.arrayContaining([expect.stringContaining('3'), expect.stringContaining('7')]),
    );
    // 共用一份 geometry ＋一份 material（不是每顆球各配一份 → 不會洩漏材質）
    expect(meshes[0].geometry).toBe(meshes[1].geometry);
    expect(meshes[0].material).toBe(meshes[1].material);
    expect(meshes[0].geometry).toBeInstanceOf(THREE.BoxGeometry);
    expect((meshes[0].geometry as THREE.BoxGeometry).parameters.width).toBeCloseTo(0.25, 5);
    expect((meshes[0].geometry as THREE.BoxGeometry).parameters.height).toBeCloseTo(0.25, 5);
    expect((meshes[0].geometry as THREE.BoxGeometry).parameters.depth).toBeCloseTo(0.25, 5);
    expect((meshes[0].material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x9bff5a);

    // id-keyed：再同步一次同樣的 id → 沿用同一批 mesh（不重建、不增生）
    view.syncOrbs([orb({ id: 3 }), orb({ id: 7 })], camera, 0.1);
    const again = meshesOf(scene);
    expect(again).toHaveLength(2);
    expect(again[0]).toBe(meshes[0]);
    expect(again[1]).toBe(meshes[1]);
  });

  it('updates positions with a bob and rotates while dt > 0', () => {
    const { scene, camera, view } = setup();
    const o = orb({ id: 2, pos: { x: 2, y: 1, z: -3 }, age: 0.5 });
    view.syncOrbs([o], camera, 0.1);

    const mesh = meshesOf(scene)[0];
    const bob = 0.08 * Math.sin(o.age * 4);
    expect(mesh.position.x).toBeCloseTo(o.pos.x, 5);
    expect(mesh.position.z).toBeCloseTo(o.pos.z, 5);
    expect(mesh.position.y).toBeCloseTo(o.pos.y + 0.5 + bob, 5);
    // 浮動幅度不超過 0.1（球心浮在 pos + 0.5 附近）
    expect(Math.abs(mesh.position.y - (o.pos.y + 0.5))).toBeLessThanOrEqual(0.1);

    expect(mesh.rotation.y).toBeGreaterThan(0);
    const spun = mesh.rotation.y;
    expect(spun).toBeCloseTo(0.1 * 3, 5);

    // dt = 0 → 不再自轉（位置仍會跟著 orb 更新）
    view.syncOrbs([{ ...o, pos: { x: 5, y: 1, z: -3 } }], camera, 0);
    expect(mesh.rotation.y).toBe(spun);
    expect(mesh.position.x).toBeCloseTo(5, 5);

    // dt < 0 或 NaN 也一樣不轉（`if (dt > 0)` 那道閘真的有擋）
    view.syncOrbs([o], camera, -0.1);
    expect(mesh.rotation.y).toBe(spun);
    view.syncOrbs([o], camera, NaN);
    expect(mesh.rotation.y).toBe(spun);
  });

  it('removes meshes for vanished orbs', () => {
    const { scene, camera, view } = setup();
    view.syncOrbs([orb({ id: 1 }), orb({ id: 2 })], camera, 0.1);
    expect(meshesOf(scene)).toHaveLength(2);

    view.syncOrbs([orb({ id: 2 })], camera, 0.1);
    expect(meshesOf(scene)).toHaveLength(1);

    view.syncOrbs([], camera, 0.1);
    expect(meshesOf(scene)).toHaveLength(0);
  });

  it('recreates the mesh when the same id comes back', () => {
    const { scene, camera, view } = setup();
    view.syncOrbs([orb({ id: 1 })], camera, 0.1);
    const first = meshesOf(scene)[0];
    expect(first.rotation.y).toBeCloseTo(0.3, 5);

    view.syncOrbs([], camera, 0.1); // 球消失 → mesh 被移除
    expect(meshesOf(scene)).toHaveLength(0);

    view.syncOrbs([orb({ id: 1 })], camera, 0.1); // id 重用 → 新 mesh（旋轉歸零）
    const second = meshesOf(scene)[0];
    expect(second).not.toBe(first);
    expect(second.rotation.y).toBeCloseTo(0.3, 5);
  });

  it('dispose removes every mesh', () => {
    const { scene, camera, view } = setup();
    view.syncOrbs([orb({ id: 1 }), orb({ id: 2 })], camera, 0.1);
    view.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('disposes the shared geometry and material exactly once', () => {
    const { scene, camera, view } = setup();
    view.syncOrbs([orb({ id: 1 }), orb({ id: 2 })], camera, 0.1);
    const mesh = meshesOf(scene)[0];
    const geoSpy = vi.spyOn(mesh.geometry, 'dispose');
    const matSpy = vi.spyOn(mesh.material as THREE.Material, 'dispose');

    view.dispose();
    expect(geoSpy).toHaveBeenCalledTimes(1); // 共用 → 每份只 dispose 一次
    expect(matSpy).toHaveBeenCalledTimes(1);

    expect(() => view.dispose()).not.toThrow(); // 可重複呼叫
    expect(geoSpy).toHaveBeenCalledTimes(1);
    expect(matSpy).toHaveBeenCalledTimes(1);

    // dispose 之後再 sync → 不再把 mesh 加回場景
    view.syncOrbs([orb({ id: 1 })], camera, 0.1);
    expect(meshesOf(scene)).toHaveLength(0);
  });
});
