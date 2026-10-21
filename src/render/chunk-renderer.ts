import * as THREE from 'three';
import type { World } from '../world/world';
import { chunkKey } from '../world/world';
import { meshChunk, type MeshData } from '../world/mesher';
import { getTextureArray } from './textures';

/** The slice of three's onBeforeCompile shader object this patch touches —
 *  structural, so tests can drive it with a plain fake. */
export interface TextureArrayShader {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

/** Wire the greedy mesher's per-vertex `texIndex` into a `sampler2DArray`
 *  sample. three already declares `attribute vec2 uv` in the vertex prefix and
 *  never defines USE_UV for this material (no `material.map`), so `vUv` does
 *  not exist — we carry our own varyings instead. The sample REPLACES
 *  `#include <map_fragment>`, so `diffuseColor` is multiplied BEFORE
 *  `#include <alphatest_fragment>` discards cutouts: glass/leaves keep their
 *  holes (alphaTest 0.1 contract). Deliberately NOT `material.map = arrayTex`
 *  — three would then declare `uniform sampler2D map` and bind an array
 *  texture to TEXTURE_2D → GL error. Built-in materials compile as GLSL 3.00
 *  (`#version 300 es`), so `texture()` + `sampler2DArray` are legal here. */
export function patchTextureArrayShader(
  shader: TextureArrayShader,
  mapArray: THREE.DataArrayTexture,
): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      '#include <common>\nattribute float texIndex;\nvarying vec2 vTileUv;\nvarying float vTexIndex;',
    )
    .replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvTileUv = uv;\nvTexIndex = texIndex;',
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      '#include <common>\nuniform sampler2DArray mapArray;\nvarying vec2 vTileUv;\nvarying float vTexIndex;',
    )
    .replace(
      '#include <map_fragment>',
      'vec4 sampledDiffuseColor = texture( mapArray, vec3( vTileUv, vTexIndex ) );\n\tdiffuseColor *= sampledDiffuseColor;',
    );
  shader.uniforms.mapArray = { value: mapArray };
}

/** Task 16: the translucent water pass contract, as a pure params fn so tests
 *  can pin it without a material instance.
 *
 *  - `transparent` + `opacity: 0.62` — water is see-through; the tile's own
 *    alpha (200/255 in the atlas) multiplies on top of it.
 *  - `depthWrite: false` — water surfaces never occlude what's behind them
 *    (depth TEST stays on, so opaque terrain still rejects water behind it).
 *  - `side: DoubleSide` — the surface top face's front points up, so from
 *    underwater looking up you'd otherwise see only its culled back side. */
export function waterMaterialParams(): {
  transparent: boolean;
  opacity: number;
  depthWrite: boolean;
  side: THREE.Side;
} {
  return { transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide };
}

/** Task 16: water draws AFTER opaque geometry — three's default renderOrder
 *  is 0, and the transparent pass also renders after the opaque pass. The
 *  explicit 3000 pins water after other transparent objects too (e.g. drop
 *  sprites at 0): sprites write depth first, then water depth-tests against
 *  it, so a submerged sprite stays hidden behind the surface correctly. */
export const WATER_RENDER_ORDER = 3000;

/** Mesher shades are one float per vertex; vertexColors wants vec3. */
function shadeColors(shades: Float32Array): Float32Array {
  const out = new Float32Array(shades.length * 3);
  for (let i = 0; i < shades.length; i++) {
    out[i * 3] = shades[i];
    out[i * 3 + 1] = shades[i];
    out[i * 3 + 2] = shades[i];
  }
  return out;
}

/** Build one BufferGeometry for ONE pass (opaque, water or foliage) of a
 *  `ChunkMesh`.
 *  Returns null when that pass has no quads. Mesher indices are already
 *  0-based within their pass — each pass is emitted into its own fresh
 *  builder (emitQuad's vertBase starts at 0 there) — so no rebasing happens
 *  here; the Task 15 concatenation that needed it is gone. */
function buildMeshGeometry(data: MeshData): THREE.BufferGeometry | null {
  if (data.quadCount === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
  geometry.setAttribute('texIndex', new THREE.BufferAttribute(data.texIndex, 1));
  geometry.setAttribute('color', new THREE.BufferAttribute(shadeColors(data.shades), 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** A chunk's render trio: BOTH/ALL meshes always exist while the chunk is live;
 *  an empty pass is represented by `visible = false` behind a blank geometry
 *  (nothing drawn, nothing in the way). */
interface ChunkMeshes {
  opaque: THREE.Mesh;
  water: THREE.Mesh;
  foliage: THREE.Mesh;
}

/** Point a pass's mesh at freshly built geometry; null means the pass is
 *  empty → dispose the old buffers, hide the mesh behind a blank stand-in. */
function applyGeometry(mesh: THREE.Mesh, geometry: THREE.BufferGeometry | null): void {
  if (geometry) {
    mesh.geometry.dispose();
    mesh.geometry = geometry;
    mesh.visible = true;
  } else if (mesh.visible) {
    mesh.geometry.dispose(); // frees the GPU buffers of the old water/opaque run
    mesh.geometry = new THREE.BufferGeometry(); // blank stand-in for the empty pass
    mesh.visible = false;
  }
  // else: already blank + hidden — nothing to rebuild
}

export class ChunkRenderer {
  private chunks = new Map<string, ChunkMeshes>();
  private material: THREE.MeshLambertMaterial;
  private waterMaterial: THREE.MeshLambertMaterial;
  private foliageMaterial: THREE.MeshLambertMaterial;
  /** Task 4: the SHARED texture array (getTextureArray) — chunks, water and
   *  particles all sample the same upload. Owned by the module memo, so this
   *  class never disposes it (dispose() frees only its own materials). */
  private textureArray: THREE.DataArrayTexture;

  constructor(private scene: THREE.Scene) {
    this.textureArray = getTextureArray();
    // Lambert: the mesher's per-face normals + shades do the lighting.
    // alphaTest MUST stay 0.1 (glass interior 0 / leaves holes contract).
    this.material = new THREE.MeshLambertMaterial({
      alphaTest: 0.1,
      vertexColors: true,
      side: THREE.FrontSide,
      fog: true,
    });
    this.material.onBeforeCompile = (shader) => {
      patchTextureArrayShader(shader, this.textureArray);
    };
    // Task 16: translucent water pass — SAME DataArrayTexture instance as the
    // opaque pass (no second texture array), same onBeforeCompile patch.
    // alphaTest 0: transparency comes from `opacity`, not cutout discard —
    // water tiles are full tiles, nothing needs its pixels punched out.
    this.waterMaterial = new THREE.MeshLambertMaterial({
      ...waterMaterialParams(),
      alphaTest: 0,
      vertexColors: true,
      fog: true,
    });
    this.waterMaterial.onBeforeCompile = (shader) => {
      patchTextureArrayShader(shader, this.textureArray);
    };
    // B3 Task 4: cross 型植被 pass（花／草）。同一張 DataArrayTexture、同一個
    // onBeforeCompile patch；alphaTest 0.1 讓花莖與草葉的透明背景被裁掉；
    // DoubleSide 因為每株植物是兩片對角平面，背面也必須看得見。
    this.foliageMaterial = new THREE.MeshLambertMaterial({
      alphaTest: 0.1,
      vertexColors: true,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.foliageMaterial.onBeforeCompile = (shader) => {
      patchTextureArrayShader(shader, this.textureArray);
    };
  }

  rebuild(world: World, cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const mesh = meshChunk(world, cx, cz);
    const opaqueGeometry = buildMeshGeometry(mesh.opaque);
    const waterGeometry = buildMeshGeometry(mesh.water);
    const foliageGeometry = buildMeshGeometry(mesh.foliage);

    // 早退條件必須納入 foliage：只有植被、沒有方塊的 chunk 不能被整塊移除
    // （否則花／草會整批看不見）。
    if (!opaqueGeometry && !waterGeometry && !foliageGeometry) {
      this.remove(cx, cz); // nothing visible at all → chunk leaves the scene
      return;
    }

    let pair = this.chunks.get(key);
    if (!pair) {
      pair = {
        opaque: new THREE.Mesh(new THREE.BufferGeometry(), this.material),
        water: new THREE.Mesh(new THREE.BufferGeometry(), this.waterMaterial),
        foliage: new THREE.Mesh(new THREE.BufferGeometry(), this.foliageMaterial),
      };
      // Phase 3 Task 5: terrain both casts and receives the sun shadow; the
      // translucent water pass only receives it — water casting an opaque
      // full-cell shadow would darken the terrain it floats over, which reads
      // wrong through the transparency (castShadow stays three's default false).
      pair.opaque.castShadow = true;
      pair.opaque.receiveShadow = true;
      pair.water.receiveShadow = true;
      // B3 Task 4: 植被只接收陰影、不投影 —— 十字模型若投影會在地上投出一整格
      // 的方塊陰影（原版的花草不會），看起來像地上有塊黑斑。
      pair.foliage.castShadow = false;
      pair.foliage.receiveShadow = true;
      for (const m of [pair.opaque, pair.water, pair.foliage]) {
        m.matrixAutoUpdate = false;
        m.updateMatrix(); // positions are world-space; the matrix never changes
      }
      pair.water.renderOrder = WATER_RENDER_ORDER; // draw after opaque geometry
      // Honest note on water-vs-water order (don't assume a real painter's
      // algorithm): three's transparent sort (reversePainterSortStable) orders
      // water MESHES back-to-front by one projected z per mesh — each chunk's
      // water bounding-sphere centre — so cross-chunk order is only chunk-
      // granularity; triangles WITHIN one water geometry draw in mesher index
      // order (the sort never sees them). Harmless either way: depthWrite
      // false means no water surface ever occludes another.
      // children 順序固定：opaque(0)／water(1)／foliage(2)。
      this.scene.add(pair.opaque, pair.water, pair.foliage);
      this.chunks.set(key, pair);
    }
    applyGeometry(pair.opaque, opaqueGeometry);
    applyGeometry(pair.water, waterGeometry);
    applyGeometry(pair.foliage, foliageGeometry);
  }

  remove(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const pair = this.chunks.get(key);
    if (!pair) return;
    this.scene.remove(pair.opaque, pair.water, pair.foliage);
    pair.opaque.geometry.dispose();
    pair.water.geometry.dispose(); // per-chunk water geometry freed here
    pair.foliage.geometry.dispose(); // per-chunk foliage geometry freed here
    this.chunks.delete(key);
  }

  has(cx: number, cz: number): boolean {
    return this.chunks.has(chunkKey(cx, cz));
  }

  dispose(): void {
    for (const pair of this.chunks.values()) {
      this.scene.remove(pair.opaque, pair.water, pair.foliage);
      pair.opaque.geometry.dispose();
      pair.water.geometry.dispose();
      pair.foliage.geometry.dispose();
    }
    this.chunks.clear();
    // The shared texture array is deliberately NOT disposed here: other chunk
    // renderers and the particle renderer sample the same upload — chunk
    // teardown must never break them.
    this.material.dispose();
    this.waterMaterial.dispose();
    this.foliageMaterial.dispose();
  }
}
