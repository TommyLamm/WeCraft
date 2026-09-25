import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  ChunkRenderer,
  patchTextureArrayShader,
  waterMaterialParams,
  WATER_RENDER_ORDER,
} from './chunk-renderer';
import { drawAtlas } from './textures';
import { World } from '../world/world';
import { Chunk } from '../world/chunk';
import { BLOCK, type BlockId } from '../world/blocks';

function worldWithBlock(x: number, y: number, z: number, id: BlockId): World {
  const w = new World();
  w.addChunk(new Chunk(Math.floor(x / 16), Math.floor(z / 16)));
  w.setBlock(x, y, z, id);
  return w;
}

function setup(): { scene: THREE.Scene; renderer: ChunkRenderer } {
  const scene = new THREE.Scene();
  return { scene, renderer: new ChunkRenderer(scene, drawAtlas()) };
}

function fakeShader() {
  return {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: [
      '#include <common>',
      'void main() {',
      '#include <begin_vertex>',
      '#include <project_vertex>',
      '}',
    ].join('\n'),
    fragmentShader: [
      '#include <common>',
      'void main() {',
      '#include <map_fragment>',
      '#include <alphatest_fragment>',
      '}',
    ].join('\n'),
  };
}

describe('patchTextureArrayShader', () => {
  it('vertex: declares texIndex + varyings and forwards them to the fragment stage', () => {
    const shader = fakeShader();
    patchTextureArrayShader(shader, new THREE.DataArrayTexture());
    expect(shader.vertexShader).toContain('attribute float texIndex;');
    expect(shader.vertexShader).toContain('varying vec2 vTileUv;');
    expect(shader.vertexShader).toContain('varying float vTexIndex;');
    expect(shader.vertexShader).toContain('vTileUv = uv;');
    expect(shader.vertexShader).toContain('vTexIndex = texIndex;');
  });

  it('fragment: sampler2DArray mapArray replaces map_fragment; alphaTest untouched', () => {
    const shader = fakeShader();
    patchTextureArrayShader(shader, new THREE.DataArrayTexture());
    expect(shader.uniforms.mapArray).toBeDefined();
    expect(shader.fragmentShader).toContain('uniform sampler2DArray mapArray;');
    expect(shader.fragmentShader).toContain(
      'texture( mapArray, vec3( vTileUv, vTexIndex ) )',
    );
    expect(shader.fragmentShader).toContain('diffuseColor *= sampledDiffuseColor;');
    expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
    // alphaTest runs AFTER the sample → glass/leaves cutouts keep working
    expect(shader.fragmentShader).toContain('#include <alphatest_fragment>');
  });

  it('lands on the REAL THREE.ShaderLib.lambert sources (includes still exist)', () => {
    // Guard against three renaming/moving the includes: our patch is a plain
    // String.replace, so a rename would silently no-op — green tests, but flat
    // untextured terrain at runtime. Note we patch a WRAPPER object, never
    // THREE.ShaderLib itself (the source strings are shared).
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: THREE.ShaderLib.lambert.vertexShader,
      fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
    };
    patchTextureArrayShader(shader, new THREE.DataArrayTexture());
    expect(shader.vertexShader).toContain('attribute float texIndex;');
    expect(shader.vertexShader).toContain('vTileUv = uv;'); // begin_vertex hook fired
    expect(shader.fragmentShader).toContain('uniform sampler2DArray mapArray;');
    expect(shader.fragmentShader).toContain(
      'texture( mapArray, vec3( vTileUv, vTexIndex ) )',
    );
    expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
  });
});

// ---- Task 16: translucent water pass (pure params) ----

describe('waterMaterialParams', () => {
  it('is the exact translucent-water contract', () => {
    expect(waterMaterialParams()).toEqual({
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      // DoubleSide: the surface top face's front points up — from underwater
      // looking up you'd otherwise see only its culled back side
      side: THREE.DoubleSide,
    });
  });

  it('WATER_RENDER_ORDER is 3000 and draws after opaque geometry (default 0)', () => {
    expect(WATER_RENDER_ORDER).toBe(3000);
    expect(WATER_RENDER_ORDER).toBeGreaterThan(0); // opaque meshes keep three's default renderOrder 0
  });
});

describe('ChunkRenderer', () => {
  it('material contract: Lambert + alphaTest 0.1 + texture array via onBeforeCompile', () => {
    const { scene, renderer } = setup();
    renderer.rebuild(worldWithBlock(5, 64, 5, BLOCK.STONE), 0, 0);
    const mesh = scene.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.MeshLambertMaterial;
    expect(mat).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(mat.alphaTest).toBe(0.1); // must stay == 0.1 (glass/leaves contract)
    expect(mat.vertexColors).toBe(true); // mesher shades keep driving face brightness
    expect(mat.map).toBeNull(); // array texture rides the custom mapArray uniform
    expect(typeof mat.onBeforeCompile).toBe('function');
    renderer.dispose();
  });

  it('geometry carries texIndex/normal/uv per vertex from the greedy mesher', () => {
    const { scene, renderer } = setup();
    renderer.rebuild(worldWithBlock(5, 64, 5, BLOCK.GRASS), 0, 0);
    const geom = (scene.children[0] as THREE.Mesh).geometry;
    const pos = geom.getAttribute('position');
    const tex = geom.getAttribute('texIndex');
    expect(tex).toBeDefined();
    expect(tex.count).toBe(pos.count); // one tile index per vertex
    expect(geom.getAttribute('normal')!.count).toBe(pos.count);
    expect(geom.getAttribute('uv')!.count).toBe(pos.count);
    expect(geom.getIndex()!.count).toBe(6 * 6); // isolated block: 6 quads
    // grass uses tiles {top 0, side 1, bottom 2}
    expect(new Set(Array.from(tex.array as Float32Array))).toEqual(new Set([0, 1, 2]));
    renderer.dispose();
  });

  it('water-only chunk: water mesh visible with 6 quads; the opaque slot stays hidden', () => {
    const { scene, renderer } = setup();
    renderer.rebuild(worldWithBlock(5, 60, 5, BLOCK.WATER), 0, 0);
    expect(scene.children).toHaveLength(2); // per-chunk pair: opaque slot + water slot
    const opaqueMesh = scene.children[0] as THREE.Mesh;
    const waterMesh = scene.children[1] as THREE.Mesh;
    expect(opaqueMesh.visible).toBe(false); // no opaque geometry → nothing to draw
    expect(waterMesh.visible).toBe(true); // water must not vanish
    expect(waterMesh.geometry.getAttribute('position').count).toBe(6 * 4); // 6 water quads
    expect(waterMesh.renderOrder).toBe(WATER_RENDER_ORDER);
    renderer.dispose();
  });

  it('mixed chunk: water rides its own mesh with 0-based indices (no cross-mesh rebase)', () => {
    const { scene, renderer } = setup();
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    w.setBlock(5, 60, 5, BLOCK.WATER); // same chunk, not adjacent
    renderer.rebuild(w, 0, 0);
    expect(scene.children).toHaveLength(2);
    const opaqueMesh = scene.children[0] as THREE.Mesh;
    const waterMesh = scene.children[1] as THREE.Mesh;

    // The mesher emits each pass into its OWN fresh builder (emitQuad's
    // vertBase = positions.length/3 starts at 0 there), so water indices are
    // already 0-based relative to the water positions — with the Task 15
    // concatenation gone, NO rebasing across passes happens (or is needed).
    const opaqueIdx = Array.from(opaqueMesh.geometry.getIndex()!.array as Uint32Array);
    const waterIdx = Array.from(waterMesh.geometry.getIndex()!.array as Uint32Array);
    expect(opaqueMesh.geometry.getAttribute('position').count).toBe(24); // stone: 6 quads
    expect(waterMesh.geometry.getAttribute('position').count).toBe(24); // water: 6 quads
    expect(opaqueIdx).toHaveLength(36); // opaque run only
    expect(waterIdx).toHaveLength(36); // water run only — no shared buffer
    expect(Math.max(...opaqueIdx)).toBeLessThan(24); // opaque in-bounds in ITS buffer
    expect(Math.max(...waterIdx)).toBeLessThan(24); // water in-bounds in ITS buffer
    expect(Math.min(...waterIdx)).toBe(0); // starts at 0 — not rebased past opaque
    expect(opaqueMesh.renderOrder).toBe(0); // opaque keeps three's default
    expect(waterMesh.renderOrder).toBe(WATER_RENDER_ORDER);
    renderer.dispose();
  });

  it('water material: transparent 0.62 / depthWrite off / DoubleSide / alphaTest 0, SHARED texture array', () => {
    const { scene, renderer } = setup();
    renderer.rebuild(worldWithBlock(5, 60, 5, BLOCK.WATER), 0, 0);
    const opaqueMat = (scene.children[0] as THREE.Mesh).material as THREE.MeshLambertMaterial;
    const waterMesh = scene.children[1] as THREE.Mesh;
    const waterMat = waterMesh.material as THREE.MeshLambertMaterial;
    expect(waterMat).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(waterMat).not.toBe(opaqueMat); // separate materials per pass
    expect(waterMat.transparent).toBe(true);
    expect(waterMat.opacity).toBe(0.62);
    expect(waterMat.depthWrite).toBe(false);
    expect(waterMat.side).toBe(THREE.DoubleSide);
    expect(waterMat.alphaTest).toBe(0); // transparency from opacity — no cutout discard
    expect(waterMat.vertexColors).toBe(true); // mesher shades still drive brightness
    expect(waterMat.map).toBeNull(); // array texture rides the custom mapArray uniform

    // ONE DataArrayTexture: both passes patch the SAME instance into mapArray
    // (no duplicate texture array built for water)
    const s1 = fakeShader();
    const s2 = fakeShader();
    (opaqueMat.onBeforeCompile as (s: typeof s1) => void)(s1);
    (waterMat.onBeforeCompile as (s: typeof s2) => void)(s2);
    expect(s1.uniforms.mapArray.value).toBeInstanceOf(THREE.DataArrayTexture);
    expect(s2.uniforms.mapArray.value).toBe(s1.uniforms.mapArray.value);
    renderer.dispose();
  });

  it('chunk that loses its water: water mesh hidden (visible = false), opaque keeps rendering', () => {
    const { scene, renderer } = setup();
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    w.setBlock(5, 60, 5, BLOCK.WATER);
    renderer.rebuild(w, 0, 0);
    expect((scene.children[1] as THREE.Mesh).visible).toBe(true);
    w.setBlock(5, 60, 5, BLOCK.AIR);
    renderer.rebuild(w, 0, 0);
    expect(scene.children).toHaveLength(2); // pair persists while the chunk is live
    expect((scene.children[0] as THREE.Mesh).visible).toBe(true);
    expect((scene.children[1] as THREE.Mesh).visible).toBe(false); // empty water geometry
    renderer.dispose();
  });

  it('chunk that GAINS water: water mesh visible again with geometry', () => {
    const { scene, renderer } = setup();
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    renderer.rebuild(w, 0, 0);
    expect((scene.children[1] as THREE.Mesh).visible).toBe(false); // starts dry
    w.setBlock(5, 60, 5, BLOCK.WATER);
    renderer.rebuild(w, 0, 0);
    const waterMesh = scene.children[1] as THREE.Mesh;
    expect(waterMesh.visible).toBe(true); // non-null branch must re-enable the pass
    expect(waterMesh.geometry.getAttribute('position').count).toBe(6 * 4);
    renderer.dispose();
  });

  it('rebuilding an emptied chunk removes its mesh', () => {
    const { scene, renderer } = setup();
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    renderer.rebuild(w, 0, 0);
    expect(scene.children).toHaveLength(2); // the chunk's opaque+water pair
    w.setBlock(5, 64, 5, BLOCK.AIR);
    renderer.rebuild(w, 0, 0);
    expect(scene.children).toHaveLength(0); // both passes empty → pair gone
    renderer.dispose();
  });

  it('dispose detaches every mesh', () => {
    const { scene, renderer } = setup();
    renderer.rebuild(worldWithBlock(5, 64, 5, BLOCK.STONE), 0, 0);
    renderer.rebuild(worldWithBlock(20, 64, 5, BLOCK.STONE), 1, 0);
    expect(scene.children).toHaveLength(4); // 2 chunks × the opaque+water pair
    renderer.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
