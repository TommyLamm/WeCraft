import * as THREE from 'three';
import { hash2 } from '../core/noise';

// Phase 3 Task 7: blocky volumetric cloud layer. ONE 512×512 pattern tile of
// white boxes, built once as an InstancedMesh and re-anchored to the camera in
// whole-period steps each frame. The tile repeats on the same 512 period, so
// the period snaps are invisible and the layer reads as world-anchored.

/** One cloud box in tile-local coordinates: `x`/`z` are the box ORIGIN (the
 *  cell's 2-block margin included), `w`/`d` its footprint, `h` its height
 *  above the shared cloud base altitude. */
export interface CloudCell {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

/** Deterministic cloud tile: a 16-block grid (32×32 cells for the 512 period)
 *  where `hash2(gx, gz, seed ^ 0xc10d)` decides coverage — the cell survives
 *  when its draw falls under `density` (0.3 → ≈30% cover, per the Task 7
 *  spec). Survivors are 12×12 boxes (2-block margins) with h ∈ {3, 4, 5}.
 *  Same seed → same tile; x/z stay inside [0, period). */
export function cloudPattern(seed: number, period = 512, cell = 16, density = 0.3): CloudCell[] {
  const cells: CloudCell[] = [];
  const n = Math.floor(period / cell);
  for (let gz = 0; gz < n; gz++) {
    for (let gx = 0; gx < n; gx++) {
      const hash = hash2(gx, gz, seed ^ 0xc10d);
      if (hash % 100 < density * 100) {
        cells.push({
          // spec values at the default cell=16: origin gx*16+2, size 12
          x: gx * 16 + 2,
          z: gz * 16 + 2,
          w: 12,
          d: 12,
          h: 3 + ((hash >>> 8) % 3),
        });
      }
    }
  }
  return cells;
}

/** Whole-period tile origin for one axis: the tile slice that contains
 *  `cam − drift`. The drift only chooses WHERE the snap boundary sits (it is
 *  continuous in world coordinates); the group itself always lands on an
 *  integer period, and the matching tile period keeps that invisible. */
export function cloudFieldOffset(cam: number, drift: number, period = 512): number {
  return Math.floor((cam - drift) / period) * period;
}

/** Cloud base altitude (blocks): every box spans [BASE_Y, BASE_Y + h]. */
const BASE_Y = 150;
/** Tile period: grid span, drift wrap and group snap all share it. */
const PERIOD = 512;
/** Drift speeds (blocks/s): a faster x drift and a barely-there z drift. */
const DRIFT_X_PER_SEC = 0.6;
const DRIFT_Z_PER_SEC = 0.1;

export interface Clouds {
  /** Re-anchor the tile to the camera: each axis snaps to a whole period of
   *  `cam − drift(t)` — call once per rendered frame. */
  update(camX: number, camZ: number, timeSec: number): void;
  /** Show/hide the whole layer (settings toggle). */
  setEnabled(on: boolean): void;
  /** Detach the group and free its geometry/material/instance buffers. */
  dispose(): void;
}

export function createClouds(scene: THREE.Scene, seed: number): Clouds {
  const cells = cloudPattern(seed);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const mesh = new THREE.InstancedMesh(geometry, material, cells.length);
  mesh.name = 'clouds-mesh';
  // The unit-box bounds ignore the instance matrices, so three's automatic
  // culling would pop the whole layer at most camera angles — keep it drawn.
  mesh.frustumCulled = false;
  // Clouds are scenery: never part of the sun-shadow pass (Phase 3 Task 5).
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  const matrix = new THREE.Matrix4();
  cells.forEach((c, i) => {
    matrix.makeScale(c.w, c.h, c.d);
    matrix.setPosition(c.x + c.w / 2, BASE_Y + c.h / 2, c.z + c.d / 2);
    mesh.setMatrixAt(i, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'clouds';
  group.add(mesh);
  scene.add(group);

  return {
    update(camX, camZ, timeSec) {
      const driftX = (timeSec * DRIFT_X_PER_SEC) % PERIOD;
      const driftZ = (timeSec * DRIFT_Z_PER_SEC) % PERIOD;
      group.position.set(cloudFieldOffset(camX, driftX), 0, cloudFieldOffset(camZ, driftZ));
    },
    setEnabled(on) {
      group.visible = on;
    },
    dispose() {
      scene.remove(group);
      mesh.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
