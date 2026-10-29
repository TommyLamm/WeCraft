import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createB9MobRenderer } from './b9-mobs';
import { createCreeper } from '../world/creeper';
import { createSpider } from '../world/spider';

// jsdom builds（不需要 WebGL）：Scene / Group / Mesh / MeshLambertMaterial 都是
// 純物件，只有 Renderer 才需要 GL context（與 `scene.test.ts`／`passive-mobs.test.ts`
// 同一個前提）。

const creeper = (over: Partial<ReturnType<typeof createCreeper>> = {}) => ({
  ...createCreeper({ x: 0, y: 0, z: 0 }, () => 0.5),
  id: 1,
  ...over,
});

const spider = (over: Partial<ReturnType<typeof createSpider>> = {}) => ({
  ...createSpider({ x: 0, y: 0, z: 0 }, () => 0.5),
  id: 2,
  ...over,
});

const setup = (): {
  scene: THREE.Scene;
  renderer: ReturnType<typeof createB9MobRenderer>;
} => {
  const scene = new THREE.Scene();
  return { scene, renderer: createB9MobRenderer(scene) };
};

const groupOf = (scene: THREE.Scene, name: string): THREE.Group => {
  const g = scene.children.find((c) => c.name === name);
  if (!g) throw new Error(`group not found: ${name}`);
  return g as THREE.Group;
};

const renderedBox = (group: THREE.Group): THREE.Box3 => {
  group.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(group);
};

describe('createB9MobRenderer (B9 Task 10)', () => {
  it('creates a blocky group per creeper', () => {
    const { scene, renderer } = setup();
    renderer.syncCreepers([creeper({ pos: { x: 1, y: 2, z: 3 } })], 0.016);
    expect(scene.children).toHaveLength(1);
    const group = scene.children[0] as THREE.Group;
    expect(group).toBeInstanceOf(THREE.Group);
    expect(group.name).toBe('creeper:1');
    expect(group.position).toMatchObject({ x: 1, y: 2, z: 3 });
    // 方塊身＋頭＋**四條腿**（前後 × 左右）
    for (const name of ['head', 'body', 'legFL', 'legFR', 'legBL', 'legBR']) {
      expect(group.getObjectByName(name)).toBeTruthy();
    }
  });

  it('creates a blocky group per spider', () => {
    const { scene, renderer } = setup();
    renderer.syncSpiders([spider({ pos: { x: -1, y: 4, z: 2 } })], 0.016);
    expect(scene.children).toHaveLength(1);
    const group = scene.children[0] as THREE.Group;
    expect(group.name).toBe('spider:2');
    expect(group.position).toMatchObject({ x: -1, y: 4, z: 2 });
    expect(group.getObjectByName('head')).toBeTruthy();
    expect(group.getObjectByName('body')).toBeTruthy();
  });

  it('the creeper is taller than the spider', () => {
    const { scene, renderer } = setup();
    renderer.syncCreepers([creeper()], 0.016);
    renderer.syncSpiders([spider()], 0.016);
    const cb = renderedBox(groupOf(scene, 'creeper:1'));
    const sb = renderedBox(groupOf(scene, 'spider:2'));
    expect(cb.max.y - cb.min.y).toBeCloseTo(1.7, 5); // CREEPER_HEIGHT
    expect(sb.max.y - sb.min.y).toBeLessThanOrEqual(0.9 + 1e-6); // SPIDER_HEIGHT（不超過命中盒）
    expect(cb.max.y - cb.min.y).toBeGreaterThan(sb.max.y - sb.min.y);
  });

  it('the spider has eight legs', () => {
    const { scene, renderer } = setup();
    renderer.syncSpiders([spider()], 0.016);
    const group = groupOf(scene, 'spider:2');
    const legs: THREE.Object3D[] = [];
    group.traverse((obj) => {
      if (obj.name.startsWith('leg')) legs.push(obj);
    });
    expect(legs).toHaveLength(8);
  });

  it('the creeper flashes white as the fuse runs out', () => {
    const { scene, renderer } = setup();
    const c = creeper();
    // fuse 0.75 / total 1.5 → 進度 0.5；fuse 0 → 進度 1.0（快爆了）
    renderer.syncCreepers([{ ...c, fuse: 0.75, fuseTotal: 1.5 }], 0.016);
    const body = groupOf(scene, 'creeper:1').getObjectByName('body') as THREE.Mesh;
    const mat = body.material as THREE.MeshLambertMaterial;
    const before = mat.emissive.getHex();
    renderer.syncCreepers([{ ...c, fuse: 0, fuseTotal: 1.5 }], 0.016);
    const after = mat.emissive.getHex();
    expect(after).toBeGreaterThan(before);
    expect(after).toBe(0xffffff);
  });

  it('moves an existing mob without rebuilding', () => {
    const { scene, renderer } = setup();
    renderer.syncCreepers([creeper({ pos: { x: 0, y: 0, z: 0 } })], 0.016);
    renderer.syncCreepers([creeper({ pos: { x: 5, y: 6, z: 7 } })], 0.016);
    expect(scene.children).toHaveLength(1);
    const group = scene.children[0] as THREE.Group;
    expect(group.position).toMatchObject({ x: 5, y: 6, z: 7 });
  });

  it('removes the group when the mob disappears', () => {
    const { scene, renderer } = setup();
    renderer.syncCreepers([creeper()], 0.016);
    renderer.syncSpiders([spider()], 0.016);
    renderer.syncCreepers([], 0.016);
    expect(scene.children.filter((c) => c.name.startsWith('creeper:'))).toHaveLength(0);
    renderer.syncSpiders([], 0.016);
    expect(scene.children).toHaveLength(0);
  });

  it('treats non-finite dt as zero', () => {
    const { scene, renderer } = setup();
    renderer.syncCreepers([creeper({ pos: { x: 1, y: 2, z: 3 } })], NaN);
    const group = groupOf(scene, 'creeper:1');
    expect(Number.isFinite(group.position.x)).toBe(true);
    expect(Number.isFinite(group.position.y)).toBe(true);
    expect(Number.isFinite(group.position.z)).toBe(true);
    // 再同步一次壞 dt 也不會壞：位置照樣是有限值
    renderer.syncSpiders([spider()], Infinity);
    const sg = groupOf(scene, 'spider:2');
    expect(Number.isFinite(sg.position.x)).toBe(true);
  });

  it('flashes a hit mob white immediately (0.1 s)', () => {
    const { scene, renderer } = setup();
    renderer.syncCreepers([creeper()], 0.016);
    renderer.flashCreeper(1);
    const body = groupOf(scene, 'creeper:1').getObjectByName('body') as THREE.Mesh;
    const mat = body.material as THREE.MeshLambertMaterial;
    expect(mat.emissive.getHex()).toBe(0xffffff);
    // 0.1 秒後熄滅
    renderer.syncCreepers([creeper()], 0.11);
    expect(mat.emissive.getHex()).toBe(0x000000);
  });

  it('dispose removes every group and is idempotent', () => {
    const { scene, renderer } = setup();
    renderer.syncCreepers([creeper()], 0.016);
    renderer.syncSpiders([spider()], 0.016);
    renderer.dispose();
    expect(scene.children).toHaveLength(0);
    renderer.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
