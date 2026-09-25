import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ChunkRenderer, patchTextureArrayShader } from './chunk-renderer';
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

  it('water-only chunk still gets a mesh (Task 16 seam: opaque material for now)', () => {
    const { scene, renderer } = setup();
    renderer.rebuild(worldWithBlock(5, 60, 5, BLOCK.WATER), 0, 0);
    expect(scene.children).toHaveLength(1); // water must not vanish
    const geom = (scene.children[0] as THREE.Mesh).geometry;
    expect(geom.getAttribute('position').count).toBe(6 * 4); // 6 water quads
    renderer.dispose();
  });

  it('mixed chunk: water indices rebase past the opaque vertex run', () => {
    const { scene, renderer } = setup();
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    w.setBlock(5, 60, 5, BLOCK.WATER); // same chunk, not adjacent
    renderer.rebuild(w, 0, 0);
    const geom = (scene.children[0] as THREE.Mesh).geometry;
    const idx = Array.from(geom.getIndex()!.array as Uint32Array);
    // Layout from buildChunkGeometry: opaque run first (stone 6 quads → 36
    // indices over verts 0..23), then water rebased (water 6 quads → 36
    // indices that MUST point at verts ≥ 24, not restart at 0 and draw the
    // stone quads a second time).
    expect(geom.getAttribute('position').count).toBe(48); // 12 quads × 4 verts
    expect(idx).toHaveLength(72); // 12 quads × 6 indices
    expect(Math.max(...idx)).toBeLessThan(48); // nothing reads past the buffer
    expect(Math.max(...idx.slice(0, 36))).toBeLessThan(24); // opaque run in-bounds
    const waterRun = idx.slice(36);
    expect(Math.min(...waterRun)).toBeGreaterThanOrEqual(24); // ≥ opaque vertex count
    expect(Math.max(...waterRun)).toBeLessThan(48); // …and still in-bounds
    renderer.dispose();
  });

  it('rebuilding an emptied chunk removes its mesh', () => {
    const { scene, renderer } = setup();
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    renderer.rebuild(w, 0, 0);
    expect(scene.children).toHaveLength(1);
    w.setBlock(5, 64, 5, BLOCK.AIR);
    renderer.rebuild(w, 0, 0);
    expect(scene.children).toHaveLength(0);
    renderer.dispose();
  });

  it('dispose detaches every mesh', () => {
    const { scene, renderer } = setup();
    renderer.rebuild(worldWithBlock(5, 64, 5, BLOCK.STONE), 0, 0);
    renderer.rebuild(worldWithBlock(20, 64, 5, BLOCK.STONE), 1, 0);
    expect(scene.children).toHaveLength(2);
    renderer.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
