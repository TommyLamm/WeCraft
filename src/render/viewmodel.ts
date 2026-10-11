import * as THREE from 'three';
import type { ItemId } from '../core/items';
import {
  bobCurve,
  startSwing as beginSwing,
  stepSwing,
  swingCurve,
  viewmodelItem,
  type Swing,
} from '../core/viewmodel';
import { getBlockDef } from '../world/blocks';
import { patchTextureArrayShader } from './chunk-renderer';
import { getTextureArray } from './textures';

/** Phase 3 Task 8: first-person held item — a group attached to the camera
 *  showing EITHER a block cube (sampling the shared block texture array via
 *  the chunk material patch) OR a flat item-icon plane. The icon canvas
 *  factory is injected by main: `render/` never imports `ui/`. Swing/bob math
 *  lives in `core/viewmodel.ts` (pure); this module only maps it onto Three. */
export interface Viewmodel {
  /** Swap the held item (null = empty slot); only the matching child shows. */
  setItem(item: ItemId | null): void;
  /** Restart the swing animation (attack / place / mining tick / break). */
  startSwing(): void;
  /** Per-frame: advance swing + bob and apply the pose. `visible` gates the
   *  whole group (third person / any non-playing state); `horSpeed` is the
   *  horizontal speed in blocks/s that drives the walk bob phase. */
  update(dt: number, visible: boolean, horSpeed: number): void;
  /** Detach the group and free its geometry/materials/textures. The shared
   *  block texture array (getTextureArray) is NOT disposed. */
  dispose(): void;
}

/** Base pose in camera space (right, down, forward) + the display yaw. */
const BASE_X = 0.42;
const BASE_Y = -0.42;
const BASE_Z = -0.75;
const BASE_YAW = -0.6;
/** Cube edge (blocks) and icon plane edge. */
const BLOCK_SIZE = 0.38;
const ICON_SIZE = 0.45;

/** BoxGeometry's face groups are +x, −x, +y, −y, +z, −z × 4 vertices each —
 *  so this is the brief's [side, side, top, bottom, side, side]. */
const FACE_TILES = ['side', 'side', 'top', 'bottom', 'side', 'side'] as const;

/** Rewrite the cube's per-vertex `texIndex` with the block's face tiles (each
 *  face's 4 vertices share its tile layer in the shared texture array). */
function fillBlockTiles(attr: THREE.BufferAttribute, blockId: number): void {
  const def = getBlockDef(blockId);
  const array = attr.array as Float32Array;
  for (let face = 0; face < FACE_TILES.length; face++) {
    const tile = def[FACE_TILES[face]];
    for (let v = 0; v < 4; v++) array[face * 4 + v] = tile;
  }
  attr.needsUpdate = true;
}

export function createViewmodel(
  scene: THREE.Scene,
  camera: THREE.Camera,
  iconFor: (item: ItemId) => HTMLCanvasElement,
): Viewmodel {
  // Camera children only render when the camera itself is in the scene graph
  // (three skips a detached camera's subtree) — main never adds it elsewhere.
  scene.add(camera);

  const group = new THREE.Group();
  group.name = 'viewmodel';
  group.position.set(BASE_X, BASE_Y, BASE_Z);
  group.rotation.y = BASE_YAW;
  camera.add(group);

  // Block child: one cube whose `texIndex` attribute selects the block's tile
  // per face in the shared array — the same sampler2DArray patch as terrain.
  // alphaTest keeps glass/leaf cutouts (same 0.1 contract as chunk terrain).
  const blockGeometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
  const texIndexAttr = new THREE.BufferAttribute(new Float32Array(24), 1);
  blockGeometry.setAttribute('texIndex', texIndexAttr);
  const blockMaterial = new THREE.MeshBasicMaterial({ alphaTest: 0.1 });
  blockMaterial.onBeforeCompile = (shader) => {
    patchTextureArrayShader(shader, getTextureArray());
  };
  const blockMesh = new THREE.Mesh(blockGeometry, blockMaterial);
  blockMesh.visible = false;

  // Icon child: a flat double-sided plane carrying the injected item icon.
  const iconGeometry = new THREE.PlaneGeometry(ICON_SIZE, ICON_SIZE);
  const iconMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    alphaTest: 0.1,
    side: THREE.DoubleSide,
  });
  const iconMesh = new THREE.Mesh(iconGeometry, iconMaterial);
  iconMesh.visible = false;

  group.add(blockMesh, iconMesh);

  let swing: Swing = { t: 0, active: false };
  let bobPhase = 0;

  function setItem(item: ItemId | null): void {
    const next = viewmodelItem(item);
    blockMesh.visible = next.kind === 'block';
    iconMesh.visible = next.kind === 'icon';
    if (next.kind === 'block') {
      fillBlockTiles(texIndexAttr, next.blockId);
    } else if (next.kind === 'icon') {
      const map = new THREE.CanvasTexture(iconFor(next.item));
      map.colorSpace = THREE.SRGBColorSpace; // icon canvases are sRGB, like the HUD
      iconMaterial.map?.dispose(); // the previous icon texture is ours to free
      iconMaterial.map = map;
      iconMaterial.needsUpdate = true; // USE_MAP appeared/changed → recompile
    }
  }

  function startSwing(): void {
    swing = beginSwing(swing);
  }

  function update(dt: number, visible: boolean, horSpeed: number): void {
    group.visible = visible;
    // An idle swing must not drift: stepSwing only advances after startSwing.
    if (swing.active) swing = stepSwing(swing, dt);
    bobPhase += horSpeed * dt; // 1 rad per block travelled
    const pose = swingCurve(swing.t);
    const bob = bobCurve(bobPhase);
    group.position.set(BASE_X + bob.posX, BASE_Y + pose.posY + bob.posY, BASE_Z + pose.posZ);
    group.rotation.x = pose.rotX;
    group.rotation.z = bob.rotZ;
  }

  function dispose(): void {
    camera.remove(group);
    blockGeometry.dispose();
    blockMaterial.dispose();
    iconGeometry.dispose();
    iconMaterial.map?.dispose();
    iconMaterial.dispose();
    // The shared texture array is owned by its module memo — never dispose it
    // here (chunk terrain and particles sample the same upload).
  }

  return { setItem, startSwing, update, dispose };
}
