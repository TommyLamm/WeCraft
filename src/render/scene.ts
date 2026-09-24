import * as THREE from 'three';
import type { Vec3, DayNightColors } from '../core/daynight';

export interface GameScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  setSize(w: number, h: number): void;
  /** Apply the day/night state (Task 6): sun light direction + intensity,
   *  ambient intensity, background and fog color from `skyColors(t)`. */
  setDayNight(sunDir: Vec3, colors: DayNightColors): void;
  dispose(): void;
}

export function createGameScene(canvas: HTMLCanvasElement): GameScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 40, 140);

  // Task 6: sun + ambient lights live here (Phase 1 had none — chunks are still
  // MeshBasicMaterial, so they only start reacting in Task 15's Lambert switch;
  // sky/fog already respond above). Directional light shines from position →
  // target (origin), so position = sunDir × distance.
  const sunLight = new THREE.DirectionalLight(0xffffff, 0.9);
  scene.add(sunLight);
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
  scene.add(ambientLight);

  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  // y=96 clears seed-1337 orbit terrain (peaks ~86+trees); dy=14 to lookAt keeps plan framing
  camera.position.set(0.5, 96, 0.5);
  // YXZ before any lookAt/rotation: default XYZ + lookAt leaves residual z that
  // becomes pure roll once the play loop assigns only y/x (Task 17 CR fix)
  camera.rotation.order = 'YXZ';

  return {
    scene,
    camera,
    renderer,
    setSize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    },
    setDayNight(sunDir, colors) {
      const dist = 100; // light distance — directional color is distance-invariant
      sunLight.position.set(sunDir.x * dist, sunDir.y * dist, sunDir.z * dist);
      sunLight.intensity = colors.sunIntensity;
      ambientLight.intensity = colors.ambient;
      if (scene.background instanceof THREE.Color) scene.background.setHex(colors.sky);
      if (scene.fog) scene.fog.color.setHex(colors.fog);
    },
    dispose() {
      renderer.dispose();
    },
  };
}
