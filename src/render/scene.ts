import * as THREE from 'three';
import type { Vec3, DayNightColors } from '../core/daynight';
import type { ItemId } from '../core/items';
import type { DropEntity } from '../world/drops';
import type { Mob, MobKind, Arrow } from '../world/mobs';

export interface GameScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  setSize(w: number, h: number): void;
  /** Apply the day/night state (Task 6): sun light direction + intensity,
   *  ambient intensity, background and fog color from `skyColors(t)`. */
  setDayNight(sunDir: Vec3, colors: DayNightColors): void;
  /** Task 16: while `inside` (camera in a water block) the fog is a deep-blue
   *  FogExp2; on exit the day/night fog from `setDayNight` is restored — the
   *  two compose regardless of call order (see `createFogController`). */
  setUnderwater(inside: boolean): void;
  /** Task 16 review fix: apply the render-distance fog `far` (world units) —
   *  stored on the day fog even while submerged, so a change made underwater
   *  isn't lost (scene.fog is the FogExp2 there and has no `far`). */
  setDayFogFar(far: number): void;
  dispose(): void;
}

/** Position of the scene's directional sun light for a given sun direction
 *  (distance `dist`; directional color is distance-invariant).
 *
 *  Deferred Task 6 fix: at night the sun sits below the horizon, and raw
 *  `sunDir × dist` put the light at y < 0 — lighting the world from BELOW,
 *  which went visibly wrong once Task 15 switched chunks to MeshLambertMaterial.
 *  Mirroring ONLY the vertical component keeps the light above the horizon
 *  while preserving the sun's azimuth (x/z untouched). That matters because
 *  `sunDirection` moves in the y–z plane and its y crosses 0 at mid brightness
 *  (~0.51 intensity): a full-vector mirror would jump the position ≈ 2·dist in
 *  one frame at every dusk/dawn — flipping the whole world's lighting side
 *  twice per game day. The vertical mirror is continuous across the crossing
 *  and matches the old behavior at night zenith (y = −1 → +1). Intensity and
 *  color are NOT touched here — they still come from `skyColors` in
 *  `setDayNight`. */
export function sunLightPosition(sunDir: Vec3, dist = 100): Vec3 {
  return { x: sunDir.x * dist, y: Math.abs(sunDir.y) * dist, z: sunDir.z * dist };
}

// ---- Task 16: underwater fog, composed with Task 6's day/night fog ----

/** Initial (and default) day fog — `createGameScene`'s starting scene fog. */
const DEFAULT_SKY_FOG = 0x87ceeb;
const FOG_NEAR = 40;
const FOG_FAR = 140;
/** Fog while the camera is inside a water block: deep blue, dense FogExp2. */
const UNDERWATER_FOG_COLOR = 0x1c4e8a;
const UNDERWATER_FOG_DENSITY = 0.09;

/** Fog ownership split between Task 6 (day/night color) and Task 16
 *  (underwater tint), extracted from `createGameScene` so jsdom tests can
 *  drive it without a WebGLRenderer. */
export interface FogController {
  /** Store the day/night fog color (Task 6's `skyColors.fog`): recolors the
   *  day fog in place every frame — no allocation — and while submerged only
   *  stores it, so the underwater tint isn't clobbered as time passes. */
  setDayFogColor(hex: number): void;
  /** Store the render-distance fog `far` in world units (main.ts's
   *  applyRenderDistanceFog): updates the day fog's `far` and — only when
   *  surfaced — makes sure it's the active fog. Mirrors `setDayFogColor`, so
   *  a render-distance change made WHILE submerged is applied on surfacing
   *  instead of being dropped (scene.fog is the FogExp2 there — no `far`). */
  setDayFogFar(far: number): void;
  /** Enter/leave the underwater FogExp2; exit restores the persistent day
   *  fog object with the latest stored color. */
  setUnderwater(inside: boolean): void;
}

/** Compose the day/night fog (Task 6) with the underwater tint (Task 16) on
 *  one scene:
 *
 *  - The day fog is ONE persistent `THREE.Fog` adopted from the scene (or a
 *    fresh default): `setDayNight` recolors it in place every frame, and
 *    main.ts mutates its `far` for render distance — leaving the water
 *    restores THIS object, so both survive an underwater round-trip.
 *  - The underwater fog is likewise a single reused `FogExp2`
 *    (0x1c4e8a @ 0.09): entering swaps `scene.fog` to it, exiting swaps back
 *    — two object references, zero per-frame allocation.
 *  - Because `scene.fog` is the FogExp2 while submerged, `setDayNight`'s
 *    color and main.ts's render-distance `far` writes go through
 *    `setDayFogColor`/`setDayFogFar` to the STORED day fog instead of the
 *    visible underwater one; composition is therefore order-free. */
export function createFogController(scene: THREE.Scene): FogController {
  let dayFog = scene.fog instanceof THREE.Fog ? scene.fog : null;
  if (!dayFog) {
    dayFog = new THREE.Fog(DEFAULT_SKY_FOG, FOG_NEAR, FOG_FAR);
    scene.fog = dayFog;
  }
  const underwaterFog = new THREE.FogExp2(UNDERWATER_FOG_COLOR, UNDERWATER_FOG_DENSITY);
  let underwater = false;

  return {
    setDayFogColor(hex) {
      dayFog.color.setHex(hex); // stored regardless of submersion
      if (!underwater) scene.fog = dayFog;
    },
    setDayFogFar(far) {
      dayFog.far = far; // stored regardless of submersion (the fix under review)
      if (!underwater) scene.fog = dayFog;
    },
    setUnderwater(inside) {
      if (inside === underwater) return; // idempotent — called every frame
      underwater = inside;
      scene.fog = inside ? underwaterFog : dayFog;
    },
  };
}

export function createGameScene(canvas: HTMLCanvasElement): GameScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(DEFAULT_SKY_FOG);
  scene.fog = new THREE.Fog(DEFAULT_SKY_FOG, FOG_NEAR, FOG_FAR);
  // Task 16: day/night + underwater fog compose here (order-free — see JSDoc)
  const fogCtl = createFogController(scene);

  // Task 6: sun + ambient lights here (Task 15 switched chunks to
  // MeshLambertMaterial, so terrain now reacts to both; sky/fog respond
  // above). Directional light shines from position → target (origin), so
  // position = sunLightPosition(sunDir) — the vertical component is mirrored
  // at night so the light never dips below the horizon, with azimuth (and
  // therefore dusk/dawn continuity) preserved (deferred Task 6 fix).
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
      const p = sunLightPosition(sunDir); // y = |sunDir.y| — never below horizon
      sunLight.position.set(p.x, p.y, p.z);
      sunLight.intensity = colors.sunIntensity;
      ambientLight.intensity = colors.ambient;
      if (scene.background instanceof THREE.Color) scene.background.setHex(colors.sky);
      fogCtl.setDayFogColor(colors.fog); // stored even while underwater
    },
    setUnderwater(inside) {
      fogCtl.setUnderwater(inside);
    },
    setDayFogFar(far) {
      fogCtl.setDayFogFar(far);
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

// ---- Task 8: mobs → blocky humanoids + arrows ----

/** Per-kind flat palette (spec §5 pixel look: untextured boxes, flat colors —
 *  MeshLambertMaterial so the Task 6 scene lights shade them). Zombie: green
 *  head, blue body/legs, teal arms; skeleton: white-gray with darker limbs. */
const MOB_PALETTE: Record<MobKind, { head: number; body: number; legs: number; arms: number }> = {
  zombie: { head: 0x6a9a5a, body: 0x3d5a80, legs: 0x3a4f7a, arms: 0x5a8f7a },
  skeleton: { head: 0xd8d8d0, body: 0xd8d8d0, legs: 0xb0b0a8, arms: 0xc4c4bc },
};

/** Seconds a `flashMob` hit stays white. */
const FLASH_SEC = 0.1;
/** Limb swing amplitude (radians) and how fast the walk phase advances
 *  (phase += horizontal speed · dt · 4 → zombie 3.2 b/s ≈ 2 swings/s). */
const SWING_AMPLITUDE = 0.6;
const WALK_FREQ = 4;

interface MobParts {
  kind: MobKind;
  group: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  /** Flat-color materials of THIS mob (cloned per mob so a hit flash lights
   *  only the mob that was struck). */
  materials: THREE.MeshLambertMaterial[];
  phase: number; // accumulated walk phase
  swing: number; // current limb swing (decays to 0 when stopped)
  flash: number; // seconds left of the white hit flash
}

/** Reconciled renderer for mobs and arrows (one Group of BoxGeometry limbs per
 *  mob, one small oriented box per arrow). Follows the DropRenderer pattern:
 *  id-keyed cache, rebuilt when an id is reused for a different kind, full
 *  `dispose()` detaching everything and freeing GPU resources. */
export interface MobRenderer {
  /** Create/move/reorient/animate mobs to match `mobs` — cheap for the ≤8 mob
   *  cap, so the loop calls it every frame. `dt` advances walk cycles and
   *  burns down hit flashes (non-finite dt → 0, no NaN in phases). */
  syncMobs(mobs: readonly Mob[], dt: number): void;
  /** Create/move/remove arrow boxes to match `arrows`, oriented along velocity. */
  syncArrows(arrows: readonly Arrow[]): void;
  /** White hit flash for 0.1 s on the given mob (no-op for unknown ids). */
  flashMob(id: number): void;
  /** Remove every group/mesh and free geometries/materials. */
  dispose(): void;
}

export function createMobRenderer(scene: THREE.Scene): MobRenderer {
  // shared unit geometries (kind-independent) — freed on dispose()
  const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  const bodyGeo = new THREE.BoxGeometry(0.5, 0.75, 0.25);
  const limbGeo = new THREE.BoxGeometry(0.25, 0.75, 0.25);
  const arrowGeo = new THREE.BoxGeometry(0.1, 0.1, 0.5);
  const arrowMat = new THREE.MeshLambertMaterial({ color: 0x4a4a4a });
  const solids = [headGeo, bodyGeo, limbGeo, arrowGeo];

  const mobs = new Map<number, MobParts>();
  const arrows = new Map<number, THREE.Mesh>();

  /** A limb: pivot Group at the joint with the box hanging down from it, so
   *  `pivot.rotation.x` swings it naturally. */
  function limb(geom: THREE.BufferGeometry, mat: THREE.Material, x: number, pivotY: number, name: string): THREE.Group {
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.set(x, pivotY, 0);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = -0.375; // hang the 0.75-long box below the joint
    pivot.add(mesh);
    return pivot;
  }

  function buildMob(kind: MobKind): MobParts {
    const p = MOB_PALETTE[kind];
    const mat = (hex: number): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color: hex });
    const headMat = mat(p.head);
    const bodyMat = mat(p.body);
    const legMat = mat(p.legs);
    const armMat = mat(p.arms);
    const materials = [headMat, bodyMat, legMat, armMat];

    const group = new THREE.Group();
    group.name = `mob:${kind}`;
    group.scale.setScalar(0.9); // 2.0 blocks tall × 0.9 ≈ the player's 1.8 hitbox

    const head = new THREE.Mesh(headGeo, headMat);
    head.name = 'head';
    head.position.y = 1.75; // spans 1.5–2.0, atop the body
    group.add(head);

    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.name = 'body';
    body.position.y = 1.125; // spans 0.75–1.5
    group.add(body);

    const legL = limb(limbGeo, legMat, 0.125, 0.75, 'legL'); // hip pivot, spans 0–0.75
    const legR = limb(limbGeo, legMat, -0.125, 0.75, 'legR');
    const armL = limb(limbGeo, armMat, 0.375, 1.5, 'armL'); // shoulder pivot, spans 0.75–1.5
    const armR = limb(limbGeo, armMat, -0.375, 1.5, 'armR');
    group.add(legL, legR, armL, armR);

    return { kind, group, legL, legR, armL, armR, materials, phase: 0, swing: 0, flash: 0 };
  }

  function removeMob(id: number): void {
    const entry = mobs.get(id);
    if (!entry) return;
    scene.remove(entry.group);
    for (const m of entry.materials) m.dispose(); // per-mob materials only
    mobs.delete(id);
  }

  return {
    syncMobs(list, dt) {
      const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
      const live = new Set<number>();
      for (const mob of list) {
        live.add(mob.id);
        let entry = mobs.get(mob.id);
        // same id reused for a different kind → rebuild (drops Important #1)
        if (entry && entry.kind !== mob.kind) {
          removeMob(mob.id);
          entry = undefined;
        }
        if (!entry) {
          entry = buildMob(mob.kind);
          mobs.set(mob.id, entry);
          scene.add(entry.group);
        }

        entry.group.position.set(mob.pos.x, mob.pos.y, mob.pos.z);
        const hSpeed = Math.hypot(mob.vel.x, mob.vel.z);
        if (hSpeed > 0.01) entry.group.rotation.y = Math.atan2(mob.vel.x, mob.vel.z);

        // walk cycle: advance the phase with horizontal speed, otherwise decay
        // the swing back to neutral (a stopped mob settles, not mid-stride)
        if (hSpeed > 0.01 && step > 0) {
          entry.phase += hSpeed * step * WALK_FREQ;
          entry.swing = Math.sin(entry.phase) * SWING_AMPLITUDE;
        } else if (step > 0) {
          entry.swing *= Math.pow(0.01, step); // ≈0 after ~1 s at rest
          if (Math.abs(entry.swing) < 1e-4) {
            entry.swing = 0;
            entry.phase = 0;
          }
        }
        entry.legL.rotation.x = entry.swing;
        entry.legR.rotation.x = -entry.swing;
        entry.armL.rotation.x = -entry.swing;
        entry.armR.rotation.x = entry.swing;

        // hit flash: white emissive for FLASH_SEC, then back to flat color
        entry.flash = Math.max(0, entry.flash - step);
        const emissive = entry.flash > 0 ? 0xffffff : 0x000000;
        for (const m of entry.materials) m.emissive.setHex(emissive);
      }
      for (const id of [...mobs.keys()]) if (!live.has(id)) removeMob(id);
    },

    syncArrows(list) {
      const live = new Set<number>();
      for (const a of list) {
        live.add(a.id);
        let mesh = arrows.get(a.id);
        if (!mesh) {
          mesh = new THREE.Mesh(arrowGeo, arrowMat);
          arrows.set(a.id, mesh);
          scene.add(mesh);
        }
        mesh.position.set(a.pos.x, a.pos.y, a.pos.z);
        const speed = Math.hypot(a.vel.x, a.vel.y, a.vel.z);
        if (speed > 1e-6) {
          // box depth is along +Z, so point +Z down the velocity vector
          mesh.lookAt(a.pos.x + a.vel.x, a.pos.y + a.vel.y, a.pos.z + a.vel.z);
        }
      }
      for (const [id, mesh] of arrows) {
        if (live.has(id)) continue;
        scene.remove(mesh);
        arrows.delete(id); // shared geometry/material stay cached
      }
    },

    flashMob(id) {
      const entry = mobs.get(id);
      if (entry) entry.flash = FLASH_SEC;
    },

    dispose() {
      for (const id of [...mobs.keys()]) removeMob(id);
      for (const mesh of arrows.values()) scene.remove(mesh);
      arrows.clear();
      for (const geom of solids) geom.dispose();
      arrowMat.dispose();
    },
  };
}
