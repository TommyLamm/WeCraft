import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createParticleRenderer } from './particles';
import { MAX_PARTICLES, type Particle } from '../world/particles';
import { getTextureArray } from './textures';

function particle(over: Partial<Particle> = {}): Particle {
  return {
    id: 1,
    tile: 3,
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    life: 1,
    maxLife: 1,
    size: 0.1,
    ...over,
  };
}

/** Lens into the renderer: its single billboard mesh (added eagerly). */
function setup(): {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: ReturnType<typeof createParticleRenderer>;
  mesh: THREE.Mesh;
} {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(); // identity matrixWorld: x right, y up
  const renderer = createParticleRenderer(scene);
  const mesh = scene.children[0] as THREE.Mesh;
  return { scene, camera, renderer, mesh };
}

function fakeShader() {
  return {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ['#include <common>', 'void main() {', '#include <begin_vertex>', '}'].join(
      '\n',
    ),
    fragmentShader: [
      '#include <common>',
      'void main() {',
      '#include <map_fragment>',
      '#include <alphatest_fragment>',
      '}',
    ].join('\n'),
  };
}

describe('createParticleRenderer', () => {
  it('sync: 2 particles → drawRange 12; capacity MAX×4; slot data (positions/uv/texIndex/color)', () => {
    const { renderer, camera, mesh } = setup();
    renderer.sync(
      [
        particle({ tile: 3, pos: { x: 0, y: 0, z: 0 }, size: 0.1 }),
        particle({ id: 2, tile: 7 }),
      ],
      camera,
    );
    const geo = mesh.geometry;
    expect(geo.getAttribute('position').count).toBe(MAX_PARTICLES * 4); // fixed capacity
    expect(geo.drawRange.count).toBe(2 * 6); // 2 billboard quads, indexed
    const tex = geo.getAttribute('texIndex').array as Float32Array;
    expect(Array.from(tex.slice(0, 4))).toEqual([3, 3, 3, 3]); // quad 1 samples its tile
    expect(Array.from(tex.slice(4, 8))).toEqual([7, 7, 7, 7]); // quad 2 too
    const uv = geo.getAttribute('uv').array as Float32Array;
    expect(Array.from(uv.slice(0, 8))).toEqual([0, 0, 1, 0, 0, 1, 1, 1]); // tile-local
    const color = geo.getAttribute('color').array as Float32Array;
    expect(Array.from(color.slice(0, 3))).toEqual([1, 1, 1]); // white × texture
    // identity camera → right = +x, up = +y: a size-0.1 quad spans ±0.05
    const pos = geo.getAttribute('position').array as Float32Array;
    expect(pos[0]).toBeCloseTo(-0.05); // vertex 0: −right −up
    expect(pos[1]).toBeCloseTo(-0.05);
    expect(pos[9]).toBeCloseTo(0.05); // vertex 3: +right +up
    expect(pos[10]).toBeCloseTo(0.05);
  });

  it('sync: empty list → drawRange 0 (nothing drawn)', () => {
    const { renderer, camera, mesh } = setup();
    renderer.sync([], camera);
    expect(mesh.geometry.drawRange.count).toBe(0);
  });

  it('material: vertex-colored MeshBasicMaterial (alphaTest 0.1, DoubleSide) sampling the shared array', () => {
    const { renderer, camera, mesh } = setup();
    renderer.sync([particle()], camera);
    const mat = mesh.material as THREE.MeshBasicMaterial;
    expect(mat).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(mat.vertexColors).toBe(true);
    expect(mat.alphaTest).toBe(0.1);
    expect(mat.side).toBe(THREE.DoubleSide);
    const shader = fakeShader();
    (mat.onBeforeCompile as (s: typeof shader) => void)(shader);
    expect(shader.uniforms.mapArray.value).toBe(getTextureArray()); // the shared memo

    // Guard: the patch must land on the REAL basic material sources (same
    // rationale as chunk-renderer.test's lambert guard) — a renamed include
    // would silently no-op and render white, untextured quads.
    const real = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    };
    (mat.onBeforeCompile as (s: typeof real) => void)(real);
    expect(real.vertexShader).toContain('attribute float texIndex;');
    expect(real.vertexShader).toContain('vTexIndex = texIndex;'); // begin_vertex hook fired
    expect(real.fragmentShader).toContain('uniform sampler2DArray mapArray;');
    expect(real.fragmentShader).not.toContain('#include <map_fragment>');
  });

  it('the particle material keeps the plain patch (no terrain light uniforms)', () => {
    // B6 Task 4 守門：粒子幾何沒有 lightSky／lightBlock 屬性 → 若掛上地形光照
    // patch，缺省屬性 0 → lf = max(0.05, 0) = 0.05 → 粒子只剩 5% 亮度（近乎全黑）。
    const { mesh } = setup();
    const mat = mesh.material as THREE.MeshBasicMaterial;
    const shader = fakeShader();
    (mat.onBeforeCompile as (s: typeof shader) => void)(shader);
    expect(shader.vertexShader).not.toContain('lightSky');
    expect(shader.vertexShader).not.toContain('lightBlock');
    expect(shader.fragmentShader).not.toContain('uSkyScale');
    expect(shader.fragmentShader).not.toContain('uMinLight');
  });

  it('dispose: detaches the mesh and never disposes the shared texture array', () => {
    const { scene, renderer, camera } = setup();
    renderer.sync([particle()], camera);
    const tex = getTextureArray();
    let textureDisposed = false;
    tex.addEventListener('dispose', () => {
      textureDisposed = true;
    });
    expect(() => renderer.dispose()).not.toThrow();
    expect(scene.children).toHaveLength(0); // mesh detached
    expect(textureDisposed).toBe(false); // shared array survives
  });
});
