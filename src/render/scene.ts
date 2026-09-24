import * as THREE from 'three';
import type { Vec3, DayNightColors } from '../core/daynight';
import type { ItemId } from '../core/items';
import type { DropEntity } from '../world/drops';

export interface GameScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  setSize(w: number, h: number): void;
  /** Apply the day/night state (Task 6): sun light direction + intensity,
   *  ambient intensity, background and fog color from `skyColors(t)`. */
  setDayNight(sunDir: Vec3, colors: DayNightColors): void;
  dispose(): void;
}

export function createGameScene(canvas: HTMLCanvasElement): GameScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 40, 140);

  // Task 6: sun + ambient lights live here (Phase 1 had none — chunks are still
  // MeshBasicMaterial, so they only start reacting in Task 15's Lambert switch;
  // sky/fog already respond above). Directional light shines from position →
  // target (origin), so position = sunDir × distance.
  const sunLight = new THREE.DirectionalLight(0xffffff, 0.9);
  scene.add(sunLight);
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
  scene.add(ambientLight);

  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  // y=96 clears seed-1337 orbit terrain (peaks ~86+trees); dy=14 to lookAt keeps plan framing
  camera.position.set(0.5, 96, 0.5);
  // YXZ before any lookAt/rotation: default XYZ + lookAt leaves residual z that
  // becomes pure roll once the play loop assigns only y/x (Task 17 CR fix)
  camera.rotation.order = 'YXZ';

  return {
    scene,
    camera,
    renderer,
    setSize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    },
    setDayNight(sunDir, colors) {
      const dist = 100; // light distance — directional color is distance-invariant
      sunLight.position.set(sunDir.x * dist, sunDir.y * dist, sunDir.z * dist);
      sunLight.intensity = colors.sunIntensity;
      ambientLight.intensity = colors.ambient;
      if (scene.background instanceof THREE.Color) scene.background.setHex(colors.sky);
      if (scene.fog) scene.fog.color.setHex(colors.fog);
    },
    dispose() {
      renderer.dispose();
    },
  };
}

// ---- Task 7: item drops → billboard sprites ----

/** One THREE.Sprite per drop entity, reconciled against the drops array.
 *  Icons come from the injected `iconFor` factory (main.ts passes
 *  `itemIcon` from ui/icons — render/ never imports ui itself); the icon
 *  canvas is turned into a cached per-item CanvasTexture (NearestFilter, like
 *  the chunk atlas), so block and non-block items render uniformly. */
export interface DropRenderer {
  /** Create/move/remove sprites to match `drops` — cheap for <50 drops, so the
   *  loop calls it every frame. Sprites billboard by themselves; a gentle
   *  vertical bob (sin of the drop's age) sells "loose item on the ground". */
  syncDrops(drops: readonly DropEntity[]): void;
  /** Remove every sprite and free textures/materials. */
  dispose(): void;
}

export function createDropRenderer(
  scene: THREE.Scene,
  iconFor: (item: ItemId) => HTMLCanvasElement,
): DropRenderer {
  const textures = new Map<ItemId, THREE.Texture>();
  const materials = new Map<ItemId, THREE.SpriteMaterial>();
  const sprites = new Map<number, THREE.Sprite>();

  function materialFor(item: ItemId): THREE.SpriteMaterial {
    const cached = materials.get(item);
    if (cached) return cached;
    const tex = new THREE.CanvasTexture(iconFor(item));
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace; // match the chunk-atlas convention
    textures.set(item, tex);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.1 });
    materials.set(item, mat);
    return mat;
  }

  return {
    syncDrops(drops) {
      const live = new Set<number>();
      for (const d of drops) {
        live.add(d.id);
        let sprite = sprites.get(d.id);
        if (!sprite) {
          sprite = new THREE.Sprite(materialFor(d.item));
          sprite.scale.set(0.4, 0.4, 1); // ~½ block item
          sprites.set(d.id, sprite);
          scene.add(sprite);
        } else if (sprite.material !== materialFor(d.item)) {
          // Important #1: spawnDrop's max+1 reuses a removed id when pickup/
          // despawn ran earlier in the SAME frame — no empty sync intervenes,
          // so without this refresh the sprite would show the old item's icon.
          // materialFor is a Map hit when cached → cheap per frame.
          sprite.material = materialFor(d.item);
        }
        // Sprite is centre-anchored: lift by half the scale so a grounded drop
        // sits ON the block top instead of half-sunk into it.
        const bob = Math.sin(d.age * 3) * 0.05;
        sprite.position.set(d.pos.x, d.pos.y + 0.2 + bob, d.pos.z);
      }
      for (const [id, sprite] of sprites) {
        if (live.has(id)) continue;
        scene.remove(sprite);
        sprites.delete(id); // material/texture stay cached for item reuse
      }
    },
    dispose() {
      for (const sprite of sprites.values()) scene.remove(sprite);
      sprites.clear();
      for (const mat of materials.values()) mat.dispose();
      materials.clear();
      for (const tex of textures.values()) tex.dispose();
      textures.clear();
    },
  };
}
