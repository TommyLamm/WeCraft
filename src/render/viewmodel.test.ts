import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createViewmodel } from './viewmodel';
import { getBlockDef, BLOCK } from '../world/blocks';
import { getTextureArray } from './textures';
import type { ItemId } from '../core/items';

/** Lens into the viewmodel: the group is the camera's single child, and its
 *  children are [block cube, icon plane] in creation order. */
function setup(): {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  viewmodel: ReturnType<typeof createViewmodel>;
  group: THREE.Group;
  blockMesh: THREE.Mesh;
  iconMesh: THREE.Mesh;
} {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const viewmodel = createViewmodel(scene, camera, () => document.createElement('canvas'));
  const group = camera.children[0] as THREE.Group;
  const [blockMesh, iconMesh] = group.children as THREE.Mesh[];
  return { scene, camera, viewmodel, group, blockMesh, iconMesh };
}

describe('createViewmodel', () => {
  it('adds the camera to the scene and builds the group at the base pose', () => {
    const { scene, camera, group, blockMesh, iconMesh } = setup();
    // Camera children render only when the camera is part of the scene graph.
    expect(scene.children).toContain(camera);
    expect(group.parent).toBe(camera);
    expect(group.position.x).toBeCloseTo(0.42);
    expect(group.position.y).toBeCloseTo(-0.42);
    expect(group.position.z).toBeCloseTo(-0.75);
    expect(group.rotation.y).toBeCloseTo(-0.6);

    // Idle: both children exist but neither shows.
    expect(group.children).toHaveLength(2);
    expect(blockMesh.visible).toBe(false);
    expect(iconMesh.visible).toBe(false);

    // Block cube: BoxGeometry(0.38) + MeshBasicMaterial.
    const blockGeo = blockMesh.geometry as THREE.BoxGeometry;
    expect(blockGeo.parameters.width).toBe(0.38);
    expect(blockGeo.parameters.height).toBe(0.38);
    expect(blockGeo.parameters.depth).toBe(0.38);
    expect(blockMesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);

    // Icon plane: PlaneGeometry(0.45) + cutout, double-sided basic material.
    const iconGeo = iconMesh.geometry as THREE.PlaneGeometry;
    expect(iconGeo.parameters.width).toBe(0.45);
    expect(iconGeo.parameters.height).toBe(0.45);
    const iconMat = iconMesh.material as THREE.MeshBasicMaterial;
    expect(iconMat).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(iconMat.transparent).toBe(true);
    expect(iconMat.alphaTest).toBe(0.1);
    expect(iconMat.side).toBe(THREE.DoubleSide);
  });

  it('setItem: block/icon/none switch the visible child and build its content', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const iconCalls: ItemId[] = [];
    const iconCanvas = document.createElement('canvas');
    const viewmodel = createViewmodel(scene, camera, (item) => {
      iconCalls.push(item);
      return iconCanvas;
    });
    const group = camera.children[0] as THREE.Group;
    const [blockMesh, iconMesh] = group.children as THREE.Mesh[];

    // grass → cube sampling the block's atlas tiles per face
    viewmodel.setItem('grass');
    expect(blockMesh.visible).toBe(true);
    expect(iconMesh.visible).toBe(false);
    const def = getBlockDef(BLOCK.GRASS);
    const tiles = Array.from(blockMesh.geometry.getAttribute('texIndex').array as Float32Array);
    expect(tiles).toEqual(
      [def.side, def.side, def.top, def.bottom, def.side, def.side].flatMap((t) => [t, t, t, t]),
    );

    // The cube's material must ride the shared texture array through the same
    // shader patch as chunk terrain.
    const blockMat = blockMesh.material as THREE.MeshBasicMaterial;
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: ['#include <common>', '#include <begin_vertex>'].join('\n'),
      fragmentShader: ['#include <common>', '#include <map_fragment>'].join('\n'),
    };
    (blockMat.onBeforeCompile as (s: typeof shader) => void)(shader);
    expect(shader.uniforms.mapArray.value).toBe(getTextureArray()); // the shared memo

    // Guard: the patch must land on the REAL basic material sources (same
    // rationale as particles.test) — a renamed include would render white.
    const real = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    };
    (blockMat.onBeforeCompile as (s: typeof real) => void)(real);
    expect(real.vertexShader).toContain('attribute float texIndex;');
    expect(real.fragmentShader).toContain('uniform sampler2DArray mapArray;');
    expect(real.fragmentShader).not.toContain('#include <map_fragment>');

    // stick → icon plane with the injected canvas as its texture
    viewmodel.setItem('stick');
    expect(blockMesh.visible).toBe(false);
    expect(iconMesh.visible).toBe(true);
    expect(iconCalls).toEqual(['stick']);
    const map = (iconMesh.material as THREE.MeshBasicMaterial).map;
    expect(map).toBeInstanceOf(THREE.CanvasTexture);
    expect(map!.image).toBe(iconCanvas);

    // null (empty slot) → nothing visible
    viewmodel.setItem(null);
    expect(blockMesh.visible).toBe(false);
    expect(iconMesh.visible).toBe(false);
  });

  it('startSwing + update: the group swings, then horSpeed drives the walk bob', () => {
    const { viewmodel, group } = setup();
    viewmodel.setItem('grass');
    viewmodel.update(0, true, 0);
    expect(group.rotation.x).toBeCloseTo(0);
    expect(group.position.y).toBeCloseTo(-0.42);

    viewmodel.startSwing();
    viewmodel.update(0.125, true, 0); // half of the 0.25 s swing → the peak pose
    expect(group.rotation.x).toBeCloseTo(-1.4);
    expect(group.position.y).toBeCloseTo(-0.42 - 0.15);
    expect(group.position.z).toBeCloseTo(-0.75 - 0.25);

    viewmodel.update(0.125, true, 0); // t = 1 → back to rest
    expect(group.rotation.x).toBeCloseTo(0);
    expect(group.position.z).toBeCloseTo(-0.75);

    viewmodel.update(0.1, true, 5); // bob phase 0.5 rad
    expect(group.position.x).toBeCloseTo(0.42 + 0.015 * Math.sin(0.25));
    expect(group.position.y).toBeCloseTo(-0.42 + 0.02 * Math.sin(0.5));
    expect(group.rotation.z).toBeCloseTo(0.03 * Math.sin(0.5));
  });

  it('update: visible=false hides the group and visible=true shows it again', () => {
    const { viewmodel, group } = setup();
    viewmodel.update(1 / 60, true, 0);
    expect(group.visible).toBe(true);
    viewmodel.update(1 / 60, false, 0); // third person / menus / title
    expect(group.visible).toBe(false);
    viewmodel.update(1 / 60, true, 0);
    expect(group.visible).toBe(true);
  });

  it('dispose: detaches the group and never disposes the shared texture array', () => {
    const { viewmodel, group, iconMesh } = setup();
    viewmodel.setItem('grass');
    viewmodel.setItem('stick'); // icon texture is owned by the viewmodel
    let iconDisposed = false;
    (iconMesh.material as THREE.MeshBasicMaterial).map!.addEventListener('dispose', () => {
      iconDisposed = true;
    });
    const tex = getTextureArray();
    let sharedDisposed = false;
    tex.addEventListener('dispose', () => {
      sharedDisposed = true;
    });
    expect(() => viewmodel.dispose()).not.toThrow();
    expect(group.parent).toBeNull(); // detached from the camera
    expect(iconDisposed).toBe(true); // the icon texture is freed
    expect(sharedDisposed).toBe(false); // shared array survives
  });
});
