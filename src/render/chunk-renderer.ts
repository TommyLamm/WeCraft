import * as THREE from 'three';
import type { World } from '../world/world';
import { chunkKey } from '../world/world';
import { meshChunk, type ChunkMesh } from '../world/mesher';
import type { AtlasImage } from './textures';
import { buildTextureArray } from './textures';

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

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

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

/** Build one BufferGeometry from a `ChunkMesh`. Returns null when the chunk
 *  has no visible faces at all.
 *
 *  Task 16: translucent water pass — water currently rides in the SAME mesh
 *  (same opaque Lambert material) so it never visually vanishes; the deferred
 *  pass splits it onto its own material using the mesher's `water` mesh. */
function buildChunkGeometry(mesh: ChunkMesh): THREE.BufferGeometry | null {
  const { opaque, water } = mesh;
  if (opaque.quadCount === 0 && water.quadCount === 0) return null;

  const indices = new Uint32Array(opaque.indices.length + water.indices.length);
  indices.set(opaque.indices, 0);
  const waterOffset = opaque.positions.length / 3;
  for (let i = 0; i < water.indices.length; i++) {
    indices[opaque.indices.length + i] = water.indices[i] + waterOffset;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(concat(opaque.positions, water.positions), 3),
  );
  geometry.setAttribute(
    'normal',
    new THREE.BufferAttribute(concat(opaque.normals, water.normals), 3),
  );
  geometry.setAttribute('uv', new THREE.BufferAttribute(concat(opaque.uvs, water.uvs), 2));
  geometry.setAttribute(
    'texIndex',
    new THREE.BufferAttribute(concat(opaque.texIndex, water.texIndex), 1),
  );
  geometry.setAttribute(
    'color',
    new THREE.BufferAttribute(
      concat(shadeColors(opaque.shades), shadeColors(water.shades)),
      3,
    ),
  );
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

export class ChunkRenderer {
  private meshes = new Map<string, THREE.Mesh>();
  private material: THREE.MeshLambertMaterial;
  private textureArray: THREE.DataArrayTexture;

  constructor(private scene: THREE.Scene, atlas: AtlasImage) {
    this.textureArray = buildTextureArray(atlas);
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
  }

  rebuild(world: World, cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const old = this.meshes.get(key);
    const geometry = buildChunkGeometry(meshChunk(world, cx, cz));

    if (!geometry) {
      if (old) {
        this.scene.remove(old);
        old.geometry.dispose();
        this.meshes.delete(key);
      }
      return;
    }

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();

    if (old) {
      this.scene.remove(old);
      old.geometry.dispose();
    }
    this.scene.add(mesh);
    this.meshes.set(key, mesh);
  }

  remove(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const mesh = this.meshes.get(key);
    if (mesh) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      this.meshes.delete(key);
    }
  }

  has(cx: number, cz: number): boolean {
    return this.meshes.has(chunkKey(cx, cz));
  }

  dispose(): void {
    for (const m of this.meshes.values()) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.meshes.clear();
    this.textureArray.dispose();
    this.material.dispose();
  }
}
