import * as THREE from 'three';
import type { World } from '../world/world';
import { chunkKey } from '../world/world';
import { meshChunk } from '../world/mesher';
import type { AtlasImage } from './textures';
import { ATLAS_SIZE, TILES_PER_ROW } from './textures';

/** mesher 的 0..1 uv + layer 烘成圖集座標（0.5px inset 防滲色） */
export function bakeAtlasUvs(uvs: Float32Array, layers: Float32Array): Float32Array {
  const out = new Float32Array(uvs.length);
  const tile = 1 / TILES_PER_ROW;
  const inset = 0.5 / ATLAS_SIZE;
  for (let i = 0; i < uvs.length; i += 2) {
    const layer = layers[i / 2];
    const tx = layer % TILES_PER_ROW;
    const ty = Math.floor(layer / TILES_PER_ROW);
    const u0 = tx * tile;
    const v0 = 1 - (ty + 1) * tile; // 圖像 y 向下 → WebGL uv y 向上
    const uu = uvs[i];
    const vv = uvs[i + 1];
    out[i] = uu === 0 ? u0 + inset : u0 + tile - inset;
    out[i + 1] = vv === 0 ? v0 + inset : v0 + tile - inset;
  }
  return out;
}

export class ChunkRenderer {
  private meshes = new Map<string, THREE.Mesh>();
  private material: THREE.MeshBasicMaterial;

  constructor(private scene: THREE.Scene, atlas: AtlasImage) {
    const canvas = document.createElement('canvas');
    canvas.width = atlas.width;
    canvas.height = atlas.height;
    const ctx = canvas.getContext('2d')!;
    // ImageData(...) blocked by TS 5.7 ArrayBufferLike vs ArrayBuffer — createImageData+set is pixel-identical
    const imageData = ctx.createImageData(atlas.width, atlas.height);
    imageData.data.set(atlas.data);
    ctx.putImageData(imageData, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    // NearestFilter (mag+min) + generateMipmaps:false + 0.5px inset are load-bearing — never "improve" to LinearFilter
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;

    // Phase 1: no transparent:true → water renders OPAQUE (accepted; real translucency deferred to phase 2)
    this.material = new THREE.MeshBasicMaterial({
      map: tex,
      vertexColors: true,
      // must stay > glass interior 0 and == 0.1 contract
      alphaTest: 0.1,
      side: THREE.FrontSide,
      fog: true,
    });
  }

  rebuild(world: World, cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const old = this.meshes.get(key);
    const data = meshChunk(world, cx, cz);

    if (data.quadCount === 0) {
      if (old) {
        this.scene.remove(old);
        old.geometry.dispose();
        this.meshes.delete(key);
      }
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(bakeAtlasUvs(data.uvs, data.layers), 2),
    );
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));

    const colors = new Float32Array(data.shades.length * 3);
    for (let i = 0; i < data.shades.length; i++) {
      colors[i * 3] = data.shades[i];
      colors[i * 3 + 1] = data.shades[i];
      colors[i * 3 + 2] = data.shades[i];
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();

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
    this.material.map?.dispose();
    this.material.dispose();
  }
}
