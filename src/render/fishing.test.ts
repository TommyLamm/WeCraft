import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createFishingRenderer } from './fishing';

// jsdom builds（不需要 WebGL）：Scene / Group / Line / Mesh 都是純物件。

function setup() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 10, 0);
  camera.lookAt(0, 10, -1);
  const renderer = createFishingRenderer(scene);
  return { scene, camera, renderer };
}

describe('fishing renderer (B14)', () => {
  it('adds one line + bobber group and hides it when the line is null', () => {
    const { scene, camera, renderer } = setup();
    expect(scene.children).toHaveLength(1);
    renderer.sync(null, camera);
    expect(scene.children[0].visible).toBe(false);

    renderer.sync({ bobber: { x: 2, y: 5, z: -3 }, biting: false }, camera);
    expect(scene.children[0].visible).toBe(true);
    renderer.dispose();
  });

  it('places the bobber at the water point and dips it while biting', () => {
    const { scene, camera, renderer } = setup();
    renderer.sync({ bobber: { x: 2, y: 5, z: -3 }, biting: false }, camera);
    const group = scene.children[0] as THREE.Group;
    const bobber = group.children.find((c) => c.name === 'fishing-bobber') as THREE.Group;
    expect(bobber.position.x).toBeCloseTo(2, 5);
    expect(bobber.position.y).toBeCloseTo(5, 5);
    expect(bobber.position.z).toBeCloseTo(-3, 5);

    renderer.sync({ bobber: { x: 2, y: 5, z: -3 }, biting: true }, camera);
    expect(bobber.position.y).toBeCloseTo(4.95, 5);
    renderer.dispose();
  });

  it('draws a two-point line from the camera-side rod tip to the bobber', () => {
    const { scene, camera, renderer } = setup();
    renderer.sync({ bobber: { x: 2, y: 5, z: -3 }, biting: false }, camera);
    const group = scene.children[0] as THREE.Group;
    const line = group.children.find((c) => c.name === 'fishing-line') as THREE.Line;
    const pos = line.geometry.getAttribute('position');
    expect(pos.count).toBe(2);
    // 起點＝相機空間的「竿尖近似」：右手邊 0.35、下方 0.22、前方 0.85
    // （與 viewmodel 的 BASE_X = 0.42 同一側：竿在畫面右下角）。
    expect(pos.getX(0)).toBeCloseTo(0.35, 5);
    expect(pos.getY(0)).toBeLessThan(10); // below the eye (rod-tip approximation)
    expect(pos.getZ(0)).toBeGreaterThan(-1); // slightly in front of the camera
    // 終點＝浮標（水面那一點；浮標本體畫在群組原點下方，線正好接在帽子上）。
    expect(pos.getX(1)).toBeCloseTo(2, 5);
    expect(pos.getY(1)).toBeCloseTo(5, 5);
    expect(pos.getZ(1)).toBeCloseTo(-3, 5);
    renderer.dispose();
  });

  it('dispose is idempotent and removes the group', () => {
    const { scene, camera, renderer } = setup();
    renderer.sync({ bobber: { x: 0, y: 5, z: -2 }, biting: false }, camera);
    renderer.dispose();
    expect(scene.children).toHaveLength(0);
    expect(() => renderer.dispose()).not.toThrow();
  });
});
