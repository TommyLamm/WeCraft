import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { crackStageFor, crackQuadEuler, crackQuadCenter, createCrackOverlay } from './crack';
import type { RayHit } from '../world/raycast';

/** Lens into the overlay: the single mesh it adds to the scene. */
function setup(): { scene: THREE.Scene; overlay: ReturnType<typeof createCrackOverlay>; mesh: THREE.Mesh } {
  const scene = new THREE.Scene();
  const overlay = createCrackOverlay(scene);
  const mesh = scene.children[0] as THREE.Mesh;
  return { scene, overlay, mesh };
}

function hit(over: Partial<RayHit> = {}): RayHit {
  return { x: 3, y: 4, z: 5, nx: 0, ny: 1, nz: 0, t: 1, ...over };
}

describe('crackStageFor', () => {
  it('maps progress 0..1 to stage 0..9; negative/non-finite → 0', () => {
    expect(crackStageFor(0)).toBe(0);
    expect(crackStageFor(0.45)).toBe(4);
    expect(crackStageFor(0.99)).toBe(9);
    expect(crackStageFor(1)).toBe(9);
    expect(crackStageFor(-1)).toBe(0);
    expect(crackStageFor(NaN)).toBe(0);
  });
});

describe('crackQuadEuler', () => {
  it('lays a +Z plane flush on each face normal (±y → X, ±x → Y, ±z flat)', () => {
    expect(crackQuadEuler({ x: 0, y: 0, z: 1 })).toEqual([0, 0, 0]);
    expect(crackQuadEuler({ x: 0, y: 0, z: -1 })).toEqual([0, Math.PI, 0]);
    expect(crackQuadEuler({ x: 1, y: 0, z: 0 })).toEqual([0, Math.PI / 2, 0]);
    expect(crackQuadEuler({ x: -1, y: 0, z: 0 })).toEqual([0, -Math.PI / 2, 0]);
    expect(crackQuadEuler({ x: 0, y: 1, z: 0 })).toEqual([-Math.PI / 2, 0, 0]);
    expect(crackQuadEuler({ x: 0, y: -1, z: 0 })).toEqual([Math.PI / 2, 0, 0]);
  });
});

describe('crackQuadCenter', () => {
  it('block centre + normal · (0.5 + inset): 0.003 proud of the hit face', () => {
    // hit(3,4,5) top face: centre (3.5, 4.5, 5.5), y=5 face → y = 5.003.
    // Controller ruling: the formula (0.5 + inset) is authoritative; the plan's
    // {y: 5.503} literal double-counted the inset (0.5 + 0.503).
    expect(crackQuadCenter(hit())).toEqual({ x: 3.5, y: 5.003, z: 5.5 });
    // the normal term is per-axis — +x face moves x, not y/z
    expect(crackQuadCenter(hit({ nx: 1, ny: 0 }))).toEqual({ x: 4.003, y: 4.5, z: 5.5 });
    // custom inset is honoured
    expect(crackQuadCenter(hit(), 0.1)).toEqual({ x: 3.5, y: 5.1, z: 5.5 });
  });
});

describe('createCrackOverlay', () => {
  it('set(null) hides, set(hit, progress) shows at the face with its stage material, set(null) hides again', () => {
    const { overlay, mesh } = setup();
    overlay.set(null, 0);
    expect(mesh.visible).toBe(false);

    overlay.set(hit(), 0.45); // stage 4, +y face
    expect(mesh.visible).toBe(true);
    expect(mesh.position.x).toBeCloseTo(3.5, 10);
    expect(mesh.position.y).toBeCloseTo(5.003, 10);
    expect(mesh.position.z).toBeCloseTo(5.5, 10);
    expect(mesh.rotation.x).toBeCloseTo(-Math.PI / 2, 10);
    expect(mesh.rotation.y).toBeCloseTo(0, 10);
    expect(mesh.rotation.z).toBeCloseTo(0, 10);
    const stage4 = mesh.material;

    // Integration regression (review Critical): the euler must come from the
    // hit NORMAL. hit().y = 4 > 0 coincidentally matches ny = 1 in the ±y
    // branch, so a side face is the case that pins the contract.
    overlay.set(hit({ nx: 1, ny: 0 }), 0.45); // +x face
    expect(mesh.rotation.x).toBeCloseTo(0, 10);
    expect(mesh.rotation.y).toBeCloseTo(Math.PI / 2, 10);
    expect(mesh.rotation.z).toBeCloseTo(0, 10);
    expect(mesh.position.x).toBeCloseTo(4.003, 10);
    expect(mesh.position.y).toBeCloseTo(4.5, 10);
    expect(mesh.position.z).toBeCloseTo(5.5, 10);

    // Corner hit where every coordinate-derived euler branch is wrong:
    // block (0,0,0) (−z face) must flip, not stay flat.
    overlay.set(hit({ x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: -1 }), 0.45);
    expect(mesh.rotation.x).toBeCloseTo(0, 10);
    expect(mesh.rotation.y).toBeCloseTo(Math.PI, 10);
    expect(mesh.rotation.z).toBeCloseTo(0, 10);
    expect(mesh.position.x).toBeCloseTo(0.5, 10);
    expect(mesh.position.y).toBeCloseTo(0.5, 10);
    expect(mesh.position.z).toBeCloseTo(-0.003, 10);

    overlay.set(hit({ y: 9 }), 0.05); // stage 0 at another block
    expect(mesh.material).not.toBe(stage4); // stage swap, not a rebuild
    expect(mesh.position.y).toBeCloseTo(10.003, 10);

    overlay.set(null, 0);
    expect(mesh.visible).toBe(false);
    overlay.dispose();
  });

  it('adds exactly one transparent polygon-offset quad; jsdom has no 2D canvas → map null', () => {
    const { scene, overlay, mesh } = setup();
    expect(scene.children).toHaveLength(1);
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    expect(mesh.visible).toBe(false);
    const mat = mesh.material as THREE.MeshBasicMaterial;
    expect(mat).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.polygonOffset).toBe(true);
    expect(mat.polygonOffsetFactor).toBe(-1);
    expect(mat.polygonOffsetUnits).toBe(-1);
    expect(mat.map).toBeNull(); // canvas-free environment → null map, never a throw
    overlay.dispose();
  });

  it('dispose() detaches the quad and frees it without throwing', () => {
    const { scene, overlay, mesh } = setup();
    overlay.set(hit(), 0.45);
    expect(scene.children).toContain(mesh);
    expect(() => overlay.dispose()).not.toThrow();
    expect(scene.children).toHaveLength(0);
  });
});
