import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  RAIN_DROP_COUNT,
  RAIN_RADIUS,
  RAIN_TOP,
  RAIN_BOTTOM,
  RAIN_MIN_SPEED,
  RAIN_MAX_SPEED,
  RAIN_LENGTH,
  createWeatherRenderer,
} from './weather';

function setup() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(3, 8, -2);
  camera.lookAt(3, 8, -3);
  const renderer = createWeatherRenderer(scene);
  const rain = scene.getObjectByName('weather-rain') as THREE.LineSegments;
  return { scene, camera, renderer, rain };
}

function positions(rain: THREE.LineSegments): THREE.BufferAttribute {
  return rain.geometry.getAttribute('position') as THREE.BufferAttribute;
}

describe('weather renderer (B15)', () => {
  it('pins the rain field constants', () => {
    expect(RAIN_DROP_COUNT).toBe(600);
    expect(RAIN_RADIUS).toBe(14);
    expect(RAIN_TOP).toBe(12);
    expect(RAIN_BOTTOM).toBe(-6);
    expect(RAIN_MIN_SPEED).toBe(18);
    expect(RAIN_MAX_SPEED).toBe(26);
    expect(RAIN_LENGTH).toBe(0.7);
  });

  it('creates one line-segments object with two vertices per drop', () => {
    const { scene, rain } = setup();
    expect(rain).toBeInstanceOf(THREE.LineSegments);
    expect(rain.name).toBe('weather-rain');
    expect(positions(rain).count).toBe(RAIN_DROP_COUNT * 2);
    expect(rain.frustumCulled).toBe(false);

    const material = rain.material as THREE.LineBasicMaterial;
    expect(material).toBeInstanceOf(THREE.LineBasicMaterial);
    expect(material.color.getHex()).toBe(0xaecbe8);
    expect(material.transparent).toBe(true);
    expect(material.fog).toBe(false);
    expect(material.depthWrite).toBe(false);
    expect(scene.children).toHaveLength(1);
  });

  it('hides in clear weather and when the player is not exposed', () => {
    const { camera, renderer, rain } = setup();
    const group = rain.parent as THREE.Group;

    renderer.sync({ mode: 'clear', visible: true }, camera, 1);
    expect(group.visible).toBe(false);

    renderer.sync({ mode: 'rain', visible: false }, camera, 1);
    expect(group.visible).toBe(false);

    renderer.sync({ mode: 'rain', visible: true }, camera, 1);
    expect(group.visible).toBe(true);
  });

  it('uses rain/thunder opacity and follows the camera', () => {
    const { camera, renderer, rain } = setup();
    const group = rain.parent as THREE.Group;
    const material = rain.material as THREE.LineBasicMaterial;

    renderer.sync({ mode: 'rain', visible: true }, camera, 1);
    expect(material.opacity).toBeCloseTo(0.5, 10);
    expect(group.position.x).toBeCloseTo(camera.position.x, 10);
    expect(group.position.y).toBeCloseTo(camera.position.y, 10);
    expect(group.position.z).toBeCloseTo(camera.position.z, 10);

    renderer.sync({ mode: 'thunder', visible: true }, camera, 1);
    expect(material.opacity).toBeCloseTo(0.65, 10);
  });

  it('falls over time, keeps x/z, and never leaves the field bounds', () => {
    const { camera, renderer, rain } = setup();
    const pos = positions(rain);
    // 找一條離下界夠遠的雨絲（dt=0.01 不可能讓它繞回上方）。
    let index = -1;
    for (let i = 0; i < pos.count; i += 2) {
      if (pos.getY(i) > RAIN_BOTTOM + 2) {
        index = i;
        break;
      }
    }
    expect(index).toBeGreaterThanOrEqual(0);
    const beforeX = pos.getX(index);
    const beforeY = pos.getY(index);
    const beforeZ = pos.getZ(index);

    renderer.sync({ mode: 'rain', visible: true }, camera, 0.01);
    expect(pos.getY(index)).toBeLessThan(beforeY);
    expect(pos.getX(index)).toBeCloseTo(beforeX, 10);
    expect(pos.getZ(index)).toBeCloseTo(beforeZ, 10);

    // 大雨滴在 dt=10 時會跨過下界；每條雨絲仍必須留在 [BOTTOM, TOP) 內。
    for (let n = 0; n < 20; n++) renderer.sync({ mode: 'rain', visible: true }, camera, 10);
    for (let i = 0; i < pos.count; i += 2) {
      expect(pos.getY(i)).toBeGreaterThanOrEqual(RAIN_BOTTOM);
      expect(pos.getY(i)).toBeLessThan(RAIN_TOP);
      // 線的終點在起點下方 RAIN_LENGTH。
      expect(pos.getY(i + 1)).toBeCloseTo(pos.getY(i) - RAIN_LENGTH, 5);
    }
  });

  it('non-finite dt does not move the drops', () => {
    const { camera, renderer, rain } = setup();
    const pos = positions(rain);
    renderer.sync({ mode: 'rain', visible: true }, camera, 1);
    const y = pos.getY(0);
    renderer.sync({ mode: 'rain', visible: true }, camera, Number.NaN);
    expect(pos.getY(0)).toBe(y);
  });

  it('dispose is idempotent and removes the rain group', () => {
    const { scene, camera, renderer } = setup();
    renderer.sync({ mode: 'rain', visible: true }, camera, 1);
    renderer.dispose();
    expect(scene.children).toHaveLength(0);
    expect(() => renderer.dispose()).not.toThrow();
  });
});
