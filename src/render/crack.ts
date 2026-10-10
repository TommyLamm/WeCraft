import * as THREE from 'three';
import type { RayHit } from '../world/raycast';
import { TILE_PX, drawCrackStage } from './textures';

// Task 3: mining crack overlay (10 stages) — one 1×1 quad decal that hugs the
// face being dug, swapping between 10 stage textures as `dig.progress` grows.
// The pixel bytes come from `drawCrackStage` (canvas-free, deterministic); this
// module only uploads them and positions the quad.

/** Stage index for a dig progress in 0..1: stage 9 is held at progress 1.
 *  Negative/non-finite progress → 0 (nothing dug yet), higher → clamped to 9. */
export function crackStageFor(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(9, Math.floor(progress * 10)));
}

/** Euler that lays a +Z-facing unit plane flush on a hit face: `n` is the face
 *  NORMAL — RayHit's nx/ny/nz, never the block coordinates (the shapes are
 *  structurally identical, so call sites must pick the normal fields). Raycast
 *  normals are single-axis: ±y faces rotate about X, ±x about Y, +z stays flat
 *  and −z flips half a turn. */
export function crackQuadEuler(n: { x: number; y: number; z: number }): [number, number, number] {
  if (n.y !== 0) return n.y > 0 ? [-Math.PI / 2, 0, 0] : [Math.PI / 2, 0, 0];
  if (n.x !== 0) return n.x > 0 ? [0, Math.PI / 2, 0] : [0, -Math.PI / 2, 0];
  return n.z < 0 ? [0, Math.PI, 0] : [0, 0, 0];
}

/** World position of the crack quad for a hit: block centre plus
 *  `normal · (0.5 + inset)` — 0.003 outside the hit face plane, so the quad
 *  sits proud of the block like a decal instead of z-fighting it.
 *  For hit(3,4,5) with n=(0,1,0): (3.5, 5.003, 5.5) (controller ruling — the
 *  plan's 5.503 literal double-counted the inset). */
export function crackQuadCenter(hit: RayHit, inset = 0.003): { x: number; y: number; z: number } {
  const off = 0.5 + inset;
  return {
    x: hit.x + 0.5 + hit.nx * off,
    y: hit.y + 0.5 + hit.ny * off,
    z: hit.z + 0.5 + hit.nz * off,
  };
}

export interface CrackOverlay {
  /** Show the crack quad on `hit`'s face at the stage for `progress`; `null`
   *  hides it (nothing under the crosshair / not digging / not playing). */
  set(hit: RayHit | null, progress: number): void;
  /** Detach the quad and free its geometry, materials and textures. */
  dispose(): void;
}

/** One material per stage; `set` swaps the mesh's material, no rebuild. */
const CRACK_STAGES = 10;

/** Transparent canvas backend probe shared by every stage texture: null =
 *  untested, false = this platform has no 2D canvas (jsdom tests) → maps stay
 *  null and we don't retry. */
let ctx2dAvailable: boolean | null = null;

/** Upload one stage's pixels into a CanvasTexture, or null when no 2D canvas
 *  exists (jsdom) — callers keep `map: null` then and never throw.
 *
 *  `render/` never imports `ui/icons`' canvas helper; this is the local
 *  try/catch the plan asks for. The additional interface check skips the call
 *  entirely on platforms without `CanvasRenderingContext2D` — jsdom's
 *  getContext stub logs a noisy "Not implemented" error otherwise, and if the
 *  interface is missing the call could only return null or throw anyway. */
function crackCanvasTexture(stage: number): THREE.CanvasTexture | null {
  if (ctx2dAvailable === false) return null;
  if (typeof CanvasRenderingContext2D === 'undefined') {
    ctx2dAvailable = false;
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = TILE_PX;
  canvas.height = TILE_PX;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx) {
    ctx2dAvailable = false;
    return null;
  }
  ctx2dAvailable = true;
  const img = ctx.createImageData(TILE_PX, TILE_PX);
  img.data.set(drawCrackStage(stage));
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter; // chunk-atlas crispness conventions
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The overlay: one invisible 1×1 quad + 10 stage materials (black crack
 *  lines, alpha-blended). `polygonOffset` pulls it a hair toward the camera on
 *  top of the 0.003 geometric inset, so it never z-fights the block face. */
export function createCrackOverlay(scene: THREE.Scene): CrackOverlay {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const textures: (THREE.CanvasTexture | null)[] = [];
  const materials: THREE.MeshBasicMaterial[] = [];
  for (let stage = 0; stage < CRACK_STAGES; stage++) {
    const tex = crackCanvasTexture(stage);
    textures.push(tex);
    materials.push(
      new THREE.MeshBasicMaterial({
        map: tex, // null off-canvas (jsdom) — visibility tests still run
        transparent: true,
        depthWrite: false, // decal: never occlude water/other transparents
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
  }
  const mesh = new THREE.Mesh(geometry, materials[0]);
  mesh.name = 'crack-overlay';
  mesh.visible = false;
  scene.add(mesh);

  return {
    set(hit, progress) {
      if (!hit) {
        mesh.visible = false;
        return;
      }
      const c = crackQuadCenter(hit);
      mesh.position.set(c.x, c.y, c.z);
      // hit.nx/ny/nz — the face NORMAL; passing `hit` itself would feed block
      // coords into the x/y/z fields and mis-orient every side face.
      const [ex, ey, ez] = crackQuadEuler({ x: hit.nx, y: hit.ny, z: hit.nz });
      mesh.rotation.set(ex, ey, ez);
      mesh.material = materials[crackStageFor(progress)];
      mesh.visible = true;
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      for (const mat of materials) mat.dispose();
      for (const tex of textures) tex?.dispose();
    },
  };
}
