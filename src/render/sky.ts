import * as THREE from 'three';
import type { Vec3 } from '../core/daynight';

// Phase 3 Task 6: sky dome + sun/moon quads. Render-only module — every color
// arrives as 0xRRGGBB hex from core/daynight (main.ts maps
// `{ zenith: c.zenith, horizon: c.sky }` in); this file never samples the
// clock or the world.

/** Sky-dome radius: inside the camera's far plane (1000) with margin, and
 *  larger than the sun/moon orbit (800) so the quads stay in front of it. */
const DOME_RADIUS = 900;
/** Flat day-sky fallback for both uniforms until the first `setSky` (matches
 *  scene.background's default, so the title screen looks unchanged). */
const DEFAULT_SKY = 0x87ceeb;
/** Sun/moon quad distance from the world origin. */
const SUN_MOON_RADIUS = 800;
const SUN_SIZE = 60;
const SUN_COLOR = 0xffec8a;
const MOON_SIZE = 40;
const MOON_COLOR = 0xe8edf2;

/** Sun/moon quad positions for a sun direction: `sun = sunDir · r` and the
 *  moon the exact opposite (`−sunDir · r`), so midnight's overhead moon is
 *  noon's sun point mirrored. Plain vec3s — main.ts feeds them straight into
 *  `Object3D.position.set`. */
export function sunMoonPositions(sunDir: Vec3, r = SUN_MOON_RADIUS): { sun: Vec3; moon: Vec3 } {
  return {
    sun: { x: sunDir.x * r, y: sunDir.y * r, z: sunDir.z * r },
    moon: { x: -sunDir.x * r, y: -sunDir.y * r, z: -sunDir.z * r },
  };
}

/** Vertex: pass the unit sphere direction to the fragment stage (the dome is
 *  centred at the origin, so `position` IS the view direction). */
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
  /** Point the dome gradient at `colors` (`horizon` = skyColors(t).sky,
   *  `zenith` = skyColors(t).zenith) and move + face the sun/moon quads for
   *  `sunDir`, billboarded at the camera. */
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
      const pos = sunMoonPositions(sunDir);
      sunQuad.position.set(pos.sun.x, pos.sun.y, pos.sun.z);
      moonQuad.position.set(pos.moon.x, pos.moon.y, pos.moon.z);
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
