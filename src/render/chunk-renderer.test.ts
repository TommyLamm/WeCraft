import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  ChunkRenderer,
  patchTextureArrayShader,
  patchTerrainLightShader,
  type LightUniforms,
  waterMaterialParams,
  WATER_RENDER_ORDER,
} from './chunk-renderer';
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
  return { scene, renderer: new ChunkRenderer(scene) };
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

// ---- B6 Task 4: 地形光照 patch（頂點光屬性＋天空比例 uniform）----

/** 與 ChunkRenderer 建構時同一組預設值的 LightUniforms。 */
function lightUniforms(): LightUniforms {
  return { uSkyScale: { value: 1 }, uMinLight: { value: 0.05 } };
}

describe('patchTerrainLightShader (B6 Task 4)', () => {
  it('the terrain light patch declares the light attributes and uniforms', () => {
    const shader = fakeShader();
    const light = lightUniforms();
    patchTerrainLightShader(shader, new THREE.DataArrayTexture(), light);
    expect(shader.vertexShader).toContain('attribute float lightSky;');
    expect(shader.vertexShader).toContain('attribute float lightBlock;');
    expect(shader.vertexShader).toContain('vLightSky = lightSky;');
    expect(shader.vertexShader).toContain('vLightBlock = lightBlock;');
    expect(shader.fragmentShader).toContain('uniform float uSkyScale;');
    expect(shader.fragmentShader).toContain('uniform float uMinLight;');
    // 塞進來的是**外部 uniform 物件本身**（不是複製品）→ setSkyScale 一次全部生效
    expect(shader.uniforms.uSkyScale).toBe(light.uSkyScale);
    expect(shader.uniforms.uMinLight).toBe(light.uMinLight);

    // hook 必須落在 REAL lambert sources（include 改名會靜默 no-op → 夜間不變暗）
    const real = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: THREE.ShaderLib.lambert.vertexShader,
      fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
    };
    patchTerrainLightShader(real, new THREE.DataArrayTexture(), light);
    expect(real.vertexShader).toContain('attribute float lightSky;');
    expect(real.fragmentShader).toContain('diffuseColor.rgb *= lf;');
  });

  it('the fragment multiplies the diffuse colour by the light factor', () => {
    const shader = fakeShader();
    patchTerrainLightShader(shader, new THREE.DataArrayTexture(), lightUniforms());
    // lf = max(天空光/15 × 天空比例, 方塊光/15)，再夾 uMinLight 下限
    expect(shader.fragmentShader).toContain(
      'max(vLightSky * (1.0/15.0) * uSkyScale, vLightBlock * (1.0/15.0))',
    );
    expect(shader.fragmentShader).toContain('lf = max(lf, uMinLight);');
    expect(shader.fragmentShader).toContain('diffuseColor.rgb *= lf;');
  });

  it('the plain texture patch does not touch the light attributes', () => {
    // 粒子（particles.ts）與手持物（viewmodel.ts）用的就是這個 patch：它們的
    // 幾何沒有 lightSky／lightBlock 屬性 → 若掛上光照 patch，缺省屬性 0 →
    // lf = max(0.05, 0) = 0.05 → 只剩 5% 亮度（近乎全黑）→ 不得掛上。
    const shader = fakeShader();
    patchTextureArrayShader(shader, new THREE.DataArrayTexture());
    expect(shader.vertexShader).not.toContain('lightSky');
    expect(shader.vertexShader).not.toContain('lightBlock');
    expect(shader.fragmentShader).not.toContain('uSkyScale');
    expect(shader.fragmentShader).not.toContain('uMinLight');
  });
});

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
    // B6 Task 6：每個 chunk 在場景裡是 4 個 child —— opaque(0)／water(1)／
    // foliage(2)／torches(3)
    expect(scene.children).toHaveLength(4);
    const opaqueMesh = scene.children[0] as THREE.Mesh;
    const waterMesh = scene.children[1] as THREE.Mesh;
    expect(opaqueMesh.visible).toBe(false); // no opaque geometry → nothing to draw
    expect(waterMesh.visible).toBe(true); // water must not vanish
    expect(waterMesh.geometry.getAttribute('position').count).toBe(6 * 4); // 6 water quads
    expect(waterMesh.renderOrder).toBe(WATER_RENDER_ORDER);
    expect((scene.children[2] as THREE.Mesh).visible).toBe(false); // no foliage here
    expect((scene.children[3] as THREE.Mesh).visible).toBe(false); // no torches here
    renderer.dispose();
  });

  it('mixed chunk: water rides its own mesh with 0-based indices (no cross-mesh rebase)', () => {
    const { scene, renderer } = setup();
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    w.setBlock(5, 60, 5, BLOCK.WATER); // same chunk, not adjacent
    renderer.rebuild(w, 0, 0);
    expect(scene.children).toHaveLength(4); // opaque(0) + water(1) + foliage(2) + torches(3)
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
    expect(scene.children).toHaveLength(4); // the chunk's four-pass quartet persists
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
    expect(scene.children).toHaveLength(4); // the chunk's opaque+water+foliage+torches quartet
    w.setBlock(5, 64, 5, BLOCK.AIR);
    renderer.rebuild(w, 0, 0);
    expect(scene.children).toHaveLength(0); // all four passes empty → chunk gone
    renderer.dispose();
  });

  it('dispose detaches every mesh', () => {
    const { scene, renderer } = setup();
    renderer.rebuild(worldWithBlock(5, 64, 5, BLOCK.STONE), 0, 0);
    renderer.rebuild(worldWithBlock(20, 64, 5, BLOCK.STONE), 1, 0);
    expect(scene.children).toHaveLength(8); // 2 chunks × the opaque+water+foliage+torches quartet
    renderer.dispose();
    expect(scene.children).toHaveLength(0);
  });

  // ---- B3 Task 4: 第三條 mesh（foliage）----
  it('a chunk with only cross foliage stays in the scene and the foliage mesh is visible', () => {
    const { scene, renderer } = setup();
    renderer.rebuild(worldWithBlock(5, 64, 5, BLOCK.DANDELION), 0, 0);
    // 早退條件必須納入 foliage：只有植被的 chunk 不能被整塊移除
    expect(scene.children).toHaveLength(4);
    expect((scene.children[0] as THREE.Mesh).visible).toBe(false); // no opaque geometry
    expect((scene.children[1] as THREE.Mesh).visible).toBe(false); // no water geometry
    expect((scene.children[3] as THREE.Mesh).visible).toBe(false); // no torches here
    const foliage = scene.children[2] as THREE.Mesh;
    expect(foliage.visible).toBe(true);
    expect(foliage.geometry.getAttribute('position').count).toBe(2 * 4); // 兩片對角平面
    expect(foliage.castShadow).toBe(false); // 植被不投影（否則會投出整格方塊陰影）
    expect(foliage.receiveShadow).toBe(true);
    renderer.dispose();
  });

  it('foliage material: Lambert + alphaTest 0.1 + DoubleSide + the SHARED texture array', () => {
    const { scene, renderer } = setup();
    renderer.rebuild(worldWithBlock(5, 64, 5, BLOCK.DANDELION), 0, 0);
    const opaqueMat = (scene.children[0] as THREE.Mesh).material as THREE.MeshLambertMaterial;
    const foliageMat = (scene.children[2] as THREE.Mesh).material as THREE.MeshLambertMaterial;
    expect(foliageMat).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(foliageMat).not.toBe(opaqueMat); // separate material per pass
    expect(foliageMat.alphaTest).toBe(0.1); // 植被圖樣是 alpha 裁切
    expect(foliageMat.vertexColors).toBe(true);
    expect(foliageMat.side).toBe(THREE.DoubleSide); // 兩片對角平面都要看得見背面
    expect(foliageMat.map).toBeNull(); // array texture rides the custom mapArray uniform
    // 與不透明 pass 共用同一張 DataArrayTexture
    const s1 = fakeShader();
    const s2 = fakeShader();
    (opaqueMat.onBeforeCompile as (s: typeof s1) => void)(s1);
    (foliageMat.onBeforeCompile as (s: typeof s2) => void)(s2);
    expect(s2.uniforms.mapArray.value).toBe(s1.uniforms.mapArray.value);
    renderer.dispose();
  });

  it('shares ONE texture array across instances; unload/dispose never disposes it', () => {
    const sceneA = new THREE.Scene();
    const sceneB = new THREE.Scene();
    const a = new ChunkRenderer(sceneA);
    const b = new ChunkRenderer(sceneB);
    a.rebuild(worldWithBlock(5, 64, 5, BLOCK.STONE), 0, 0);
    b.rebuild(worldWithBlock(5, 64, 5, BLOCK.STONE), 0, 0);
    const matA = (sceneA.children[0] as THREE.Mesh).material as THREE.MeshLambertMaterial;
    const matB = (sceneB.children[0] as THREE.Mesh).material as THREE.MeshLambertMaterial;
    const sA = fakeShader();
    const sB = fakeShader();
    (matA.onBeforeCompile as (s: typeof sA) => void)(sA);
    (matB.onBeforeCompile as (s: typeof sB) => void)(sB);
    const shared = sA.uniforms.mapArray.value as THREE.DataArrayTexture;
    expect(shared).toBeInstanceOf(THREE.DataArrayTexture);
    expect(sB.uniforms.mapArray.value).toBe(shared); // same shared ref, two renderers

    let disposed = false;
    shared.addEventListener('dispose', () => {
      disposed = true;
    });
    a.dispose();
    b.dispose();
    expect(disposed).toBe(false); // chunk teardown must not break the shared array
  });

  // ---- B6 Task 4：日夜只改 uniform，四個 pass 一起變暗 ----
  it('setSkyScale updates every material of the renderer', () => {
    // jsdom 沒有 WebGL → 材質從不 render → onBeforeCompile 永不執行 →
    // 依照既有慣例**手動呼叫**每個材質的 onBeforeCompile（fake shader）。
    const { scene, renderer } = setup();
    renderer.rebuild(worldWithBlock(5, 64, 5, BLOCK.STONE), 0, 0);
    // B6 Task 6 收口（R-T4-3 交接）：第四個 pass（火把）落地 → 一併釘進
    // 「四個 pass 共用同一個 uniform 物件」的守門（Review Focus #4）。
    const mats = [0, 1, 2, 3].map(
      (i) => (scene.children[i] as THREE.Mesh).material as THREE.MeshLambertMaterial,
    );
    const shaders = mats.map(() => fakeShader());
    mats.forEach((m, i) => (m.onBeforeCompile as (s: typeof shaders[0]) => void)(shaders[i]));
    // 四個 pass 共用**同一個** uniform 物件 → setSkyScale 一次全部生效
    // （若每個材質各自保存一份、只指到最後編譯的那個 → 其餘 pass 夜間不變暗）。
    for (const s of shaders.slice(1)) {
      expect(s.uniforms.uSkyScale).toBe(shaders[0].uniforms.uSkyScale);
    }
    renderer.setSkyScale(0.5);
    for (const s of shaders) expect(s.uniforms.uSkyScale.value).toBe(0.5);
    // 首次 render 前呼叫也要有效（uniform 初始值 1 頂著，不依賴 onBeforeCompile）
    renderer.setSkyScale(1);
    expect(shaders[0].uniforms.uSkyScale.value).toBe(1);
    renderer.dispose();
  });

  // ---- B6 Task 6：火把 pass（第四條 mesh ＋ 地形光照 patch）----
  it('a torch chunk gains a fourth mesh carrying the small-box geometry', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    w.setBlock(5, 65, 5, BLOCK.TORCH);
    const { scene, renderer } = setup();
    renderer.rebuild(w, 0, 0);
    // children 順序固定：opaque(0)／water(1)／foliage(2)／torches(3)
    expect(scene.children.length).toBe(4);
    const torchMesh = scene.children[3] as THREE.Mesh;
    expect(torchMesh.visible).toBe(true);
    expect(torchMesh.geometry.getAttribute('position').count).toBe(6 * 4); // 一個盒子 6 面
    expect(torchMesh.geometry.getIndex()!.count).toBe(6 * 6);
    // 光屬性跟著幾何走（缺一個 → 該 pass 全黑，Task 4 的約定）
    expect(torchMesh.geometry.getAttribute('lightSky').count).toBe(6 * 4);
    expect(torchMesh.geometry.getAttribute('lightBlock').count).toBe(6 * 4);
    // 小盒子不投影（投影會是一整格的黑方塊）、接收陰影、矩陣凍結
    expect(torchMesh.castShadow).toBe(false);
    expect(torchMesh.receiveShadow).toBe(true);
    expect(torchMesh.matrixAutoUpdate).toBe(false);
    renderer.dispose();
  });

  it('the torch material: Lambert + alphaTest 0.1 + FrontSide + the terrain light patch on the SHARED uniforms', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.TORCH); // 只有火把的 chunk
    const { scene, renderer } = setup();
    renderer.rebuild(w, 0, 0);
    const opaqueMat = (scene.children[0] as THREE.Mesh).material as THREE.MeshLambertMaterial;
    const torchMat = (scene.children[3] as THREE.Mesh).material as THREE.MeshLambertMaterial;
    expect(torchMat).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(torchMat).not.toBe(opaqueMat); // 獨立材質
    expect(torchMat.alphaTest).toBe(0.1); // 火把貼圖是 alpha 裁切
    expect(torchMat.vertexColors).toBe(true);
    expect(torchMat.side).toBe(THREE.FrontSide);
    expect(torchMat.map).toBeNull(); // array texture rides the custom mapArray uniform
    // 掛的是**地形版** patch（含光屬性）：uniform 與 opaque pass 共用同一參考
    const sO = fakeShader();
    const sT = fakeShader();
    (opaqueMat.onBeforeCompile as (s: typeof sO) => void)(sO);
    (torchMat.onBeforeCompile as (s: typeof sT) => void)(sT);
    expect(sT.uniforms.mapArray.value).toBe(sO.uniforms.mapArray.value); // 同一張 DataArrayTexture
    expect(sT.uniforms.uSkyScale).toBe(sO.uniforms.uSkyScale);
    expect(sT.uniforms.uMinLight).toBe(sO.uniforms.uMinLight);
    expect(sT.vertexShader).toContain('attribute float lightSky;'); // patchTerrainLightShader 而非 plain patch
    renderer.dispose();
  });

  it('a chunk without torches hides the torch pass (blank stand-in, chunk stays)', () => {
    const { scene, renderer } = setup();
    renderer.rebuild(worldWithBlock(5, 64, 5, BLOCK.STONE), 0, 0);
    expect(scene.children.length).toBe(4); // chunk 仍留場上（opaque 非空）
    const torchMesh = scene.children[3] as THREE.Mesh;
    expect(torchMesh.visible).toBe(false); // 空 pass = 隱藏 + 空幾何
    expect(torchMesh.geometry.getAttribute('position')).toBeUndefined();
    renderer.dispose();
  });
});
