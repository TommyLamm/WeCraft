import * as THREE from 'three';
import type { Vec3 } from '../core/daynight';

// Phase 3 Task 6: sky dome + sun/moon quads. Render-only module — every color
// arrives as 0xRRGGBB hex from core/daynight (main.ts maps
// `{ zenith: c.zenith, horizon: c.sky }` in); this file never samples the
// clock or the world.
//
// Camera-relative anchoring (Task 6 review Important fix): the camera far
// plane is 1000, and the player roams far past the world origin (render
// distance 10 ≈ 160 blocks of visible terrain does not bound movement), so
// every `setSky` re-centres the 900-radius dome on the camera and places the
// 800-distance sun/moon quads AT the camera. The dome's vertex shader uses
// the LOCAL normalized position (= the true view direction from its centre),
// so the gradient is unchanged by the move.

/** Sky-dome radius: inside the camera's far plane (1000) with margin, and
 *  larger than the sun/moon orbit (800) so the quads stay in front of it. */
const DOME_RADIUS = 900;
/** Flat day-sky fallback for both uniforms until the first `setSky` (matches
 *  scene.background's default, so the title screen looks unchanged). */
const DEFAULT_SKY = 0x87ceeb;
/** Sun/moon quad radius: the distance from the CAMERA (the quads orbit the
 *  camera, staying well inside the dome). */
const SUN_MOON_RADIUS = 800;
const SUN_SIZE = 60;
const SUN_COLOR = 0xffec8a;
const MOON_SIZE = 40;
const MOON_COLOR = 0xe8edf2;

/** Camera-relative sun/moon offsets for a sun direction: `sun = sunDir · r`
 *  and the moon the exact opposite (`−sunDir · r`), so midnight's overhead
 *  moon is noon's sun point mirrored. `setSky` adds `cameraPos` to these and
 *  writes the result straight into `Object3D.position.set`. */
export function sunMoonPositions(sunDir: Vec3, r = SUN_MOON_RADIUS): { sun: Vec3; moon: Vec3 } {
  return {
    sun: { x: sunDir.x * r, y: sunDir.y * r, z: sunDir.z * r },
    moon: { x: -sunDir.x * r, y: -sunDir.y * r, z: -sunDir.z * r },
  };
}

/** Vertex: pass the unit sphere direction to the fragment stage (the dome is
 *  centred on the camera, so the LOCAL `position` IS the view direction). */
const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Fragment: horizon → zenith ramp — full zenith above dir.y ≈ 0.53, full
 *  horizon below dir.y ≈ −0.09, linear in between. `colorspace_fragment`
 *  applies the renderer's output conversion, so the linear uniform colors
 *  match scene.background/fog exactly instead of rendering darker. */
const SKY_FRAGMENT = /* glsl */ `
uniform vec3 horizon;
uniform vec3 zenith;
varying vec3 vDir;
void main() {
  gl_FragColor = vec4(mix(horizon, zenith, clamp(vDir.y * 1.6 + 0.15, 0.0, 1.0)), 1.0);
  #include <colorspace_fragment>
}
`;

export interface Sky {
  /** Re-anchor the sky to `cameraPos` (the 900-radius dome is centred on the
   *  camera, the sun/moon quads orbit it at ±sunDir·800), point the dome
   *  gradient at `colors` (`horizon` = skyColors(t).sky, `zenith` =
   *  skyColors(t).zenith) and face the quads at the camera. */
  setSky(sunDir: Vec3, colors: { zenith: number; horizon: number }, cameraPos: Vec3): void;
  /** Detach the dome and both quads, freeing their geometries + materials. */
  dispose(): void;
}

export function createSky(scene: THREE.Scene): Sky {
  const domeGeo = new THREE.SphereGeometry(DOME_RADIUS, 32, 16);
  const domeMat = new THREE.ShaderMaterial({
    uniforms: {
      horizon: { value: new THREE.Color(DEFAULT_SKY) },
      zenith: { value: new THREE.Color(DEFAULT_SKY) },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false, // pure background: never occludes terrain or the quads
  });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.name = 'sky-dome';
  dome.renderOrder = -2; // draw first; the rest of the scene paints over it

  const sunGeo = new THREE.PlaneGeometry(SUN_SIZE, SUN_SIZE);
  const sunMat = new THREE.MeshBasicMaterial({ color: SUN_COLOR, fog: false });
  const sunQuad = new THREE.Mesh(sunGeo, sunMat);
  sunQuad.name = 'sky-sun';

  const moonGeo = new THREE.PlaneGeometry(MOON_SIZE, MOON_SIZE);
  const moonMat = new THREE.MeshBasicMaterial({ color: MOON_COLOR, fog: false });
  const moonQuad = new THREE.Mesh(moonGeo, moonMat);
  moonQuad.name = 'sky-moon';

  scene.add(dome, sunQuad, moonQuad);

  return {
    setSky(sunDir, colors, cameraPos) {
      // Camera-relative anchoring (review fix): dome centred on the camera,
      // quads at cameraPos ± sunDir·800 — every element is ≤ 900 from the
      // camera, so nothing can cross the far plane (1000) mid-exploration.
      dome.position.set(cameraPos.x, cameraPos.y, cameraPos.z);
      const pos = sunMoonPositions(sunDir);
      sunQuad.position.set(
        cameraPos.x + pos.sun.x,
        cameraPos.y + pos.sun.y,
        cameraPos.z + pos.sun.z,
      );
      moonQuad.position.set(
        cameraPos.x + pos.moon.x,
        cameraPos.y + pos.moon.y,
        cameraPos.z + pos.moon.z,
      );
      // face the quads at the camera — otherwise they stay edge-on and vanish
      // as the player looks around
      sunQuad.lookAt(cameraPos.x, cameraPos.y, cameraPos.z);
      moonQuad.lookAt(cameraPos.x, cameraPos.y, cameraPos.z);
      domeMat.uniforms.horizon.value.setHex(colors.horizon);
      domeMat.uniforms.zenith.value.setHex(colors.zenith);
    },
    dispose() {
      scene.remove(dome, sunQuad, moonQuad);
      domeGeo.dispose();
      domeMat.dispose();
      sunGeo.dispose();
      sunMat.dispose();
      moonGeo.dispose();
      moonMat.dispose();
    },
  };
}
