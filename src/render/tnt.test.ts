import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createTntRenderer } from './tnt';
import { createPrimedTnt, tntBlinkBright } from '../world/tnt';

// jsdom builds（不需要 WebGL）：Scene / Mesh / DataTexture 都是純物件，只有
// Renderer 才需要 GL context（與 b9-mobs.test.ts 同一個前提）。

describe('primed tnt renderer (B11 Task 6)', () => {
  it('syncs one mesh per primed tnt at the feet + half height', () => {
    const scene = new THREE.Scene();
    const renderer = createTntRenderer(scene);
    const t = createPrimedTnt({ x: 2, y: 5, z: -3 }, { rng: () => 0 });

    renderer.syncTnts([t], 0.1);

    expect(scene.children).toHaveLength(1);
    const mesh = scene.children[0] as THREE.Mesh;
    expect(mesh.position.x).toBeCloseTo(2, 5);
    expect(mesh.position.y).toBeCloseTo(5.49, 5); // 腳底 + 0.98/2
    expect(mesh.position.z).toBeCloseTo(-3, 5);

    // 同一個 id 的下一幀只更新位置，不重建 mesh
    renderer.syncTnts([{ ...t, pos: { x: 4, y: 5, z: -3 } }], 0.1);
    expect(scene.children).toHaveLength(1);
    expect((scene.children[0] as THREE.Mesh).position.x).toBeCloseTo(4, 5);

    renderer.dispose();
  });

  it('removes the mesh after the explosion', () => {
    const scene = new THREE.Scene();
    const renderer = createTntRenderer(scene);
    const t = createPrimedTnt({ x: 0, y: 5, z: 0 }, { rng: () => 0 });
    renderer.syncTnts([t], 0.1);
    expect(scene.children).toHaveLength(1);

    renderer.syncTnts([], 0.1);
    expect(scene.children).toHaveLength(0);
    renderer.dispose();
  });

  it('switches the material set when the blink phase flips', () => {
    const scene = new THREE.Scene();
    const renderer = createTntRenderer(scene);
    const t = createPrimedTnt({ x: 0, y: 5, z: 0 }, { fuse: 4, rng: () => 0 });
    renderer.syncTnts([t], 0.1);

    const mesh = scene.children[0] as THREE.Mesh;
    const dark = mesh.material;
    expect(tntBlinkBright(t)).toBe(false);

    renderer.syncTnts([{ ...t, fuse: 3.5 }], 0.1); // 第 0.5 秒 → 亮
    expect(mesh.material).not.toBe(dark);

    renderer.syncTnts([{ ...t, fuse: 3.0 }], 0.1); // 第 1.0 秒 → 暗（同一組共享材質）
    expect(mesh.material).toBe(dark);

    renderer.dispose();
  });

  it('dispose is idempotent and clears every mesh', () => {
    const scene = new THREE.Scene();
    const renderer = createTntRenderer(scene);
    renderer.syncTnts(
      [
        createPrimedTnt({ x: 0, y: 5, z: 0 }, { rng: () => 0 }),
        createPrimedTnt({ x: 2, y: 5, z: 0 }, { rng: () => 0 }),
      ],
      0.1,
    );
    expect(scene.children).toHaveLength(2);

    renderer.dispose();
    expect(scene.children).toHaveLength(0);
    expect(() => renderer.dispose()).not.toThrow(); // 二次 dispose 安全
    // dispose 後再 sync 仍可運作（重新建立 mesh）——避免半死狀態
    renderer.syncTnts([createPrimedTnt({ x: 0, y: 5, z: 0 }, { rng: () => 0 })], 0.1);
    expect(scene.children).toHaveLength(1);
    renderer.dispose();
  });
});
