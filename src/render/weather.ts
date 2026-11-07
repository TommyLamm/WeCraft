import * as THREE from 'three';
import type { WeatherMode } from '../world/weather';

/** 雨絲視覺（B15）。
 *
 *  **明示簡化**（README〈與原版的差異〉）：
 *  - 雨絲只跟相機、不逐格遮蔽；玩家在室內／洞穴／水下時整片隱藏（不會從窗戶
 *    看到外面的雨）。
 *  - 沒有雨滴濺射、積水、雪或雷電實體；雷電只有 `main.ts` 的天色閃光與音效。
 *
 *  效能：600 條線共用一個 `LineSegments` 與一個 position buffer，每幀只改
 *  y 與 buffer；不在每幀重建 geometry。 */

export interface WeatherView {
  mode: WeatherMode;
  /** 玩家有没有曝光在天空下（室内／水下由 main 算好）。 */
  visible: boolean;
}

export interface WeatherRenderer {
  sync(view: WeatherView, camera: THREE.Camera, dtSec: number): void;
  dispose(): void;
}

export const RAIN_DROP_COUNT = 600;
export const RAIN_RADIUS = 14;
export const RAIN_TOP = 12;
export const RAIN_BOTTOM = -6;
export const RAIN_MIN_SPEED = 18;
export const RAIN_MAX_SPEED = 26;
export const RAIN_LENGTH = 0.7;
/** 下雨／雷雨的雨絲不透明度。 */
const RAIN_OPACITY = 0.5;
const THUNDER_OPACITY = 0.65;
const RAIN_COLOR = 0xaecbe8;

/** 一條雨絲的局部狀態（x/z 固定，y 下落）。 */
interface RainDrop {
  x: number;
  y: number;
  z: number;
  speed: number;
}

const RAIN_SPAN = RAIN_TOP - RAIN_BOTTOM;

function randomIn(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** 把 y 循環回 [RAIN_BOTTOM, RAIN_TOP)。即使 dt 很大也不會留下界外座標。 */
function wrapY(y: number): number {
  return RAIN_BOTTOM + (((y - RAIN_BOTTOM) % RAIN_SPAN) + RAIN_SPAN) % RAIN_SPAN;
}

export function createWeatherRenderer(scene: THREE.Scene): WeatherRenderer {
  const drops: RainDrop[] = [];
  for (let i = 0; i < RAIN_DROP_COUNT; i++) {
    drops.push({
      x: randomIn(-RAIN_RADIUS, RAIN_RADIUS),
      y: randomIn(RAIN_BOTTOM, RAIN_TOP),
      z: randomIn(-RAIN_RADIUS, RAIN_RADIUS),
      speed: randomIn(RAIN_MIN_SPEED, RAIN_MAX_SPEED),
    });
  }

  const geometry = new THREE.BufferGeometry();
  // `Float32BufferAttribute` copies a Float32Array into its own storage, so all
  // writes below must go through `attribute.array` (not a separate array).
  const attribute = new THREE.Float32BufferAttribute(RAIN_DROP_COUNT * 2 * 3, 3);
  const positions = attribute.array as Float32Array;
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', attribute);

  const material = new THREE.LineBasicMaterial({
    color: RAIN_COLOR,
    transparent: true,
    opacity: RAIN_OPACITY,
    fog: false,
    depthWrite: false,
  });

  const rain = new THREE.LineSegments(geometry, material);
  rain.name = 'weather-rain';
  rain.frustumCulled = false; // the group follows the camera; culling adds nothing
  rain.renderOrder = 1;

  const group = new THREE.Group();
  group.name = 'weather';
  group.visible = false;
  group.add(rain);
  scene.add(group);

  /** Write one drop's two vertices into the shared buffer. */
  function writeDrop(i: number, drop: RainDrop): void {
    const at = i * 6;
    positions[at] = drop.x;
    positions[at + 1] = drop.y;
    positions[at + 2] = drop.z;
    positions[at + 3] = drop.x;
    positions[at + 4] = drop.y - RAIN_LENGTH;
    positions[at + 5] = drop.z;
  }

  drops.forEach((drop, i) => writeDrop(i, drop));
  attribute.needsUpdate = true;

  let disposed = false;

  return {
    sync(view, camera, dtSec) {
      if (disposed) return;
      const visible = view.visible && view.mode !== 'clear';
      group.visible = visible;
      material.opacity = view.mode === 'thunder' ? THUNDER_OPACITY : RAIN_OPACITY;
      group.position.set(camera.position.x, camera.position.y, camera.position.z);
      if (!visible) return;

      const step = Number.isFinite(dtSec) && dtSec > 0 ? dtSec : 0;
      if (step === 0) return;

      for (let i = 0; i < drops.length; i++) {
        const drop = drops[i];
        drop.y = wrapY(drop.y - drop.speed * step);
        writeDrop(i, drop);
      }
      attribute.needsUpdate = true;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(group);
      geometry.dispose();
      material.dispose();
    },
  };
}
