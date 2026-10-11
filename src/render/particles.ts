import * as THREE from 'three';
import { MAX_PARTICLES, type Particle } from '../world/particles';
import { patchTextureArrayShader } from './chunk-renderer';
import { getTextureArray } from './textures';

/** Billboard particle renderer: ONE indexed mesh whose fixed capacity is
 *  `MAX_PARTICLES` quads (4 vertices / 6 indices each). Every frame `sync`
 *  rewrites the first `list.length` slots as camera-facing quads and sets the
 *  draw range, so unused capacity costs nothing at draw time. Sampling rides
 *  the chunk terrain's shared texture array via `patchTextureArrayShader`
 *  (per-vertex `texIndex` = the particle's block tile); `MeshBasicMaterial`
 *  keeps debris at full brightness through day/night. */
export interface ParticleRenderer {
  /** Write `list`'s particles into the mesh (capacity-capped at
   *  `MAX_PARTICLES`) and set the draw range; an empty list draws nothing. */
  sync(list: readonly Particle[], camera: THREE.Camera): void;
  /** Detach and free the mesh's geometry/material. The shared texture array
   *  is NOT disposed. */
  dispose(): void;
}

export function createParticleRenderer(scene: THREE.Scene): ParticleRenderer {
  const capacity = MAX_PARTICLES;
  const verts = capacity * 4;
  const geometry = new THREE.BufferGeometry();

  // Slot-fixed data written once: each slot's 4 corners carry the same
  // tile-local uv (0,0) (1,0) (0,1) (1,1) and the white vertex color that
  // multiplies the sampled texture; only position + texIndex change per sync.
  const uvs = new Float32Array(verts * 2);
  const colors = new Float32Array(verts * 3);
  for (let i = 0; i < capacity; i++) {
    const v = i * 4;
    uvs.set([0, 0, 1, 0, 0, 1, 1, 1], v * 2);
    colors.fill(1, v * 3, v * 3 + 12);
  }
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute(
    'texIndex',
    new THREE.BufferAttribute(new Float32Array(verts), 1).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // Fixed index buffer: each quad is (0,1,2) + (2,1,3) of its 4 vertices.
  const indices = new Uint16Array(capacity * 6); // 800 verts < 65536 → Uint16
  for (let i = 0; i < capacity; i++) {
    const v = i * 4;
    const o = i * 6;
    indices[o] = v;
    indices[o + 1] = v + 1;
    indices[o + 2] = v + 2;
    indices[o + 3] = v + 2;
    indices[o + 4] = v + 1;
    indices[o + 5] = v + 3;
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setDrawRange(0, 0);

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    alphaTest: 0.1,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    patchTextureArrayShader(shader, getTextureArray());
  };

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; // positions are rewritten every frame — a stale bound would cull wrongly
  scene.add(mesh);

  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const texIndexAttr = geometry.getAttribute('texIndex') as THREE.BufferAttribute;

  return {
    sync(list, camera) {
      // three updates camera.matrixWorld during render(), which runs AFTER
      // this per-frame sync — refresh it now so billboards use THIS frame's
      // view direction, not the previous frame's.
      camera.updateMatrixWorld();
      // Columns 0/1 of the world matrix are the camera's right/up axes.
      const e = camera.matrixWorld.elements;
      const rx = e[0], ry = e[1], rz = e[2];
      const ux = e[4], uy = e[5], uz = e[6];
      const count = Math.min(list.length, capacity);
      const pos = positionAttr.array as Float32Array;
      const tex = texIndexAttr.array as Float32Array;
      for (let i = 0; i < count; i++) {
        const p = list[i];
        const h = p.size / 2;
        const rX = rx * h, rY = ry * h, rZ = rz * h;
        const uX = ux * h, uY = uy * h, uZ = uz * h;
        const o = i * 12;
        // corners: (−r−u), (+r−u), (−r+u), (+r+u) — matches the index buffer
        pos[o] = p.pos.x - rX - uX;
        pos[o + 1] = p.pos.y - rY - uY;
        pos[o + 2] = p.pos.z - rZ - uZ;
        pos[o + 3] = p.pos.x + rX - uX;
        pos[o + 4] = p.pos.y + rY - uY;
        pos[o + 5] = p.pos.z + rZ - uZ;
        pos[o + 6] = p.pos.x - rX + uX;
        pos[o + 7] = p.pos.y - rY + uY;
        pos[o + 8] = p.pos.z - rZ + uZ;
        pos[o + 9] = p.pos.x + rX + uX;
        pos[o + 10] = p.pos.y + rY + uY;
        pos[o + 11] = p.pos.z + rZ + uZ;
        const t = i * 4;
        tex[t] = p.tile;
        tex[t + 1] = p.tile;
        tex[t + 2] = p.tile;
        tex[t + 3] = p.tile;
      }
      positionAttr.needsUpdate = true;
      texIndexAttr.needsUpdate = true;
      // Indexed geometry: drawRange.count counts INDICES (6 per quad).
      geometry.setDrawRange(0, count * 6);
    },

    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
      // getTextureArray() is shared with the chunk/water passes — never dispose it here.
    },
  };
}
