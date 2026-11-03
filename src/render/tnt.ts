import * as THREE from 'three';
import { T } from '../world/blocks';
import { TNT_HEIGHT, TNT_WIDTH, tntBlinkBright, type PrimedTnt } from '../world/tnt';
import { TILE_PX, brightenTile, drawAtlas, tilePixels, type AtlasImage } from './textures';

// ---- 引信 TNT 的方塊渲染（B11 Task 6）----
//
// **為什麼另開一個模組**：TNT 是**貼圖方塊**（不是純色模型）；苦力怕／蜘蛛的
// `b9-mobs.ts` 用純色材質，塞不進貼圖。這裡比照同一套結構：id-keyed 快取、
// 共用幾何、每幀只更新位置／材質、`dispose()` 可重複呼叫。
//
// **貼圖**：`tilePixels`／`brightenTile` 從 atlas 抽出 16×16 像素 → `DataTexture`
// （jsdom 可建、不需要 canvas 2D；`NearestFilter` 保持像素感、`flipY` 對齊
// BoxGeometry 的 UV 方向）。六面材質順序＝BoxGeometry 的 [+x,−x,+y,−y,+z,−z]
// → [側,側,頂,頂,側,側]（底面沿用頂面——已揭露的簡化）。
//
// **閃爍**：每顆 TNT 依自己的 `tntBlinkBright` 相位在「暗版／亮版」兩組共享材質
// 之間切換（原版每 0.5 秒切一次；起爆瞬間為暗版）。
//
// **`dispose()` 後可再 `syncTnts`**：資源改為惰性重建（`ensureResources`），
// dispose 釋放幾何／材質／貼圖後再次 sync 會重新建一份——避免「半死」狀態。

export interface TntRenderer {
  /** 建立／移動每一顆引信 TNT，並依相位切換材質；清單中消失的 mesh 會被移除。 */
  syncTnts(list: readonly PrimedTnt[], dt: number): void;
  /** 移除所有 mesh、釋放自建資源（可重複呼叫；之後仍可再 sync）。 */
  dispose(): void;
}

interface Resources {
  geo: THREE.BoxGeometry;
  /** 六面材質（BoxGeometry 順序）：暗版與亮版各一組，跨實體共用。 */
  dark: THREE.MeshLambertMaterial[];
  bright: THREE.MeshLambertMaterial[];
  textures: THREE.DataTexture[];
}

function makeTileTexture(atlas: AtlasImage, tile: number, bright: boolean): THREE.DataTexture {
  const px = bright ? brightenTile(atlas, tile) : tilePixels(atlas, tile);
  // DataTexture 需要 Uint8Array（由 Uint8ClampedArray 拷貝一份；1 KB／張）。
  const bytes = new Uint8Array(px);
  const tex = new THREE.DataTexture(bytes, TILE_PX, TILE_PX, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = true; // 影像列序（row 0 = top）→ BoxGeometry UV（v=0 在下）
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createTntRenderer(scene: THREE.Scene, deps: { atlas?: AtlasImage } = {}): TntRenderer {
  const atlas = deps.atlas ?? drawAtlas();
  const meshes = new Map<number, THREE.Mesh>();
  let resources: Resources | null = null;

  function ensureResources(): Resources {
    if (resources) return resources;
    const geo = new THREE.BoxGeometry(TNT_WIDTH, TNT_HEIGHT, TNT_WIDTH);
    const top = makeTileTexture(atlas, T.TNT_TOP, false);
    const side = makeTileTexture(atlas, T.TNT_SIDE, false);
    const topBright = makeTileTexture(atlas, T.TNT_TOP, true);
    const sideBright = makeTileTexture(atlas, T.TNT_SIDE, true);
    // 六面各自一個材質物件（BoxGeometry 的材質索引順序：+x,−x,+y,−y,+z,−z
    // → [側,側,頂,頂,側,側]；側面與頂面不同貼圖）。
    const dark = [
      new THREE.MeshLambertMaterial({ map: side }),
      new THREE.MeshLambertMaterial({ map: side }),
      new THREE.MeshLambertMaterial({ map: top }),
      new THREE.MeshLambertMaterial({ map: top }),
      new THREE.MeshLambertMaterial({ map: side }),
      new THREE.MeshLambertMaterial({ map: side }),
    ];
    const bright = [
      new THREE.MeshLambertMaterial({ map: sideBright }),
      new THREE.MeshLambertMaterial({ map: sideBright }),
      new THREE.MeshLambertMaterial({ map: topBright }),
      new THREE.MeshLambertMaterial({ map: topBright }),
      new THREE.MeshLambertMaterial({ map: sideBright }),
      new THREE.MeshLambertMaterial({ map: sideBright }),
    ];
    resources = { geo, dark, bright, textures: [top, side, topBright, sideBright] };
    return resources;
  }

  return {
    syncTnts(list: readonly PrimedTnt[], _dt: number): void {
      const res = ensureResources();
      const alive = new Set<number>();
      for (const t of list) {
        alive.add(t.id);
        let mesh = meshes.get(t.id);
        if (!mesh) {
          mesh = new THREE.Mesh(res.geo, res.dark);
          mesh.name = `primed-tnt-${t.id}`;
          scene.add(mesh);
          meshes.set(t.id, mesh);
        }
        mesh.position.set(t.pos.x, t.pos.y + TNT_HEIGHT / 2, t.pos.z);
        mesh.material = tntBlinkBright(t) ? res.bright : res.dark;
      }
      for (const [id, mesh] of meshes) {
        if (alive.has(id)) continue;
        scene.remove(mesh);
        meshes.delete(id);
      }
    },

    dispose(): void {
      for (const mesh of meshes.values()) scene.remove(mesh);
      meshes.clear();
      if (!resources) return;
      resources.geo.dispose();
      for (const m of [...resources.dark, ...resources.bright]) m.dispose();
      for (const t of resources.textures) t.dispose();
      resources = null;
    },
  };
}
