import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createDropRenderer, createMobRenderer, sunLightPosition } from './scene';
import { sunDirection } from '../core/daynight';
import type { DropEntity } from '../world/drops';
import { createMob, type Mob, type Arrow } from '../world/mobs';
import type { ItemId } from '../core/items';

// jsdom builds (no WebGL needed): Scene / Sprite / SpriteMaterial / CanvasTexture
// are plain objects — only the Renderer would need a GL context, and we never
// create one. chunk-renderer.test.ts precedent: construct the real things.

function drop(over: Partial<DropEntity> = {}): DropEntity {
  return {
    id: 0,
    item: 'stone',
    count: 1,
    pos: { x: 1, y: 2, z: 3 },
    vel: { x: 0, y: 0, z: 0 },
    age: 0, // bob = sin(0) · 0.05 = 0 → position assertions are exact
    pickupDelay: 0,
    bounced: false,
    ...over,
  };
}

/** Stub icon factory: one stable canvas per item, so a texture's
 *  `map.image` identifies WHICH item's icon it holds. */
function makeIconFactory(): (item: ItemId) => HTMLCanvasElement {
  const canvases = new Map<ItemId, HTMLCanvasElement>();
  return (item) => {
    let c = canvases.get(item);
    if (!c) {
      c = document.createElement('canvas');
      canvases.set(item, c);
    }
    return c;
  };
}

function setup(): {
  scene: THREE.Scene;
  renderer: ReturnType<typeof createDropRenderer>;
  iconFor: (item: ItemId) => HTMLCanvasElement;
} {
  const scene = new THREE.Scene();
  const iconFor = makeIconFactory();
  return { scene, renderer: createDropRenderer(scene, iconFor), iconFor };
}

describe('createDropRenderer', () => {
  it('creates a sprite for a new id: added to the scene, lifted +0.2, scale 0.4', () => {
    const { scene, renderer } = setup();
    renderer.syncDrops([drop()]);
    expect(scene.children).toHaveLength(1);
    const sprite = scene.children[0] as THREE.Sprite;
    expect(sprite).toBeInstanceOf(THREE.Sprite);
    expect(sprite.position.x).toBe(1);
    expect(sprite.position.y).toBeCloseTo(2.2, 10); // pos.y + half-scale lift, bob 0
    expect(sprite.position.z).toBe(3);
    expect(sprite.scale.x).toBe(0.4);
    expect(sprite.scale.y).toBe(0.4);
    renderer.dispose();
  });

  it('updates position for an existing id without recreating the sprite', () => {
    const { scene, renderer } = setup();
    renderer.syncDrops([drop()]);
    const first = scene.children[0];
    renderer.syncDrops([drop({ pos: { x: 9, y: 8, z: 7 }, age: 1 })]);
    expect(scene.children).toHaveLength(1); // no duplicate
    expect(scene.children[0]).toBe(first); // same instance, not rebuilt
    expect((first as THREE.Sprite).position.x).toBe(9);
    expect((first as THREE.Sprite).position.z).toBe(7);
    renderer.dispose();
  });

  it('removes the sprite when the drop disappears', () => {
    const { scene, renderer } = setup();
    renderer.syncDrops([drop({ id: 1 }), drop({ id: 2, item: 'dirt' })]);
    expect(scene.children).toHaveLength(2);
    renderer.syncDrops([drop({ id: 2, item: 'dirt' })]); // id 1 picked up/despawned
    expect(scene.children).toHaveLength(1);
    renderer.syncDrops([]);
    expect(scene.children).toHaveLength(0);
    renderer.dispose();
  });

  it('refreshes the material when a live id is reused for a different item', () => {
    // Pins review Important #1: pickup/despawn can remove a drop and a new drop
    // can reuse its id — all within ONE frame (mining near drops), so syncDrops
    // never sees the intermediate empty state. Without the refresh the sprite
    // keeps showing the old item's icon until it despawns (up to 300 s).
    const { scene, renderer, iconFor } = setup();
    renderer.syncDrops([drop({ id: 3, item: 'stone' })]);
    const sprite = scene.children[0] as THREE.Sprite;
    const stoneMat = sprite.material;
    expect(stoneMat.map?.image).toBe(iconFor('stone')); // starts as stone

    // same frame: stone id 3 removed, dirt drop reuses id 3, then one sync
    renderer.syncDrops([drop({ id: 3, item: 'dirt' })]);
    expect(scene.children[0]).toBe(sprite); // same sprite instance
    expect(sprite.material).not.toBe(stoneMat); // material swapped, not stale
    expect(sprite.material.map?.image).toBe(iconFor('dirt')); // shows DIRT now
    renderer.dispose();
  });

  it('dispose detaches every sprite (scene left empty)', () => {
    const { scene, renderer } = setup();
    renderer.syncDrops([drop({ id: 1 }), drop({ id: 2, item: 'dirt' })]);
    expect(scene.children).toHaveLength(2);
    renderer.dispose();
    expect(scene.children).toHaveLength(0);
  });
});

// ---- Task 8: mob renderer ----

function mobFixture(over: Partial<Mob> = {}): Mob {
  const base = createMob('zombie', { x: 1, y: 2, z: 3 });
  return {
    ...base,
    // stable ids/headings keep position assertions exact
    id: 0,
    wanderDir: 0,
    wanderTimer: 3,
    ...over,
  };
}

function arrowFixture(over: Partial<Arrow> = {}): Arrow {
  return {
    id: 0,
    pos: { x: 1, y: 2, z: 3 },
    vel: { x: 0, y: 0, z: 5 },
    age: 0,
    ownerId: 0,
    ...over,
  };
}

function mobSetup(): { scene: THREE.Scene; renderer: ReturnType<typeof createMobRenderer> } {
  const scene = new THREE.Scene();
  return { scene, renderer: createMobRenderer(scene) };
}

describe('createMobRenderer', () => {
  it('creates a blocky humanoid group for a new mob: 7 boxes, scaled 0.9', () => {
    const { scene, renderer } = mobSetup();
    renderer.syncMobs([mobFixture()], 0.016);
    expect(scene.children).toHaveLength(1);
    const group = scene.children[0] as THREE.Group;
    expect(group).toBeInstanceOf(THREE.Group);
    expect(group.scale.x).toBe(0.9);
    expect(group.position).toMatchObject({ x: 1, y: 2, z: 3 });
    // head + body + 4 limbs = 6 meshes inside (group itself is the 7th child of scene? no — 6)
    expect(group.children).toHaveLength(6);
    for (const name of ['head', 'body', 'legL', 'legR', 'armL', 'armR']) {
      expect(group.getObjectByName(name)).toBeTruthy();
    }
    renderer.dispose();
  });

  it('updates position for an existing mob without rebuilding the group', () => {
    const { scene, renderer } = mobSetup();
    renderer.syncMobs([mobFixture()], 0.016);
    const first = scene.children[0];
    renderer.syncMobs([mobFixture({ pos: { x: 9, y: 8, z: 7 } })], 0.016);
    expect(scene.children).toHaveLength(1); // no duplicate
    expect(scene.children[0]).toBe(first); // same instance, not rebuilt
    expect((first as THREE.Group).position.x).toBe(9);
    renderer.dispose();
  });

  it('rebuilds when an id is reused for a different kind (drops Important #1)', () => {
    const { scene, renderer } = mobSetup();
    renderer.syncMobs([mobFixture({ kind: 'zombie', ranged: false })], 0.016);
    const zombieGroup = scene.children[0] as THREE.Group;
    renderer.syncMobs([mobFixture({ kind: 'skeleton', ranged: true })], 0.016);
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]).not.toBe(zombieGroup); // rebuilt for the new kind
    expect((scene.children[0] as THREE.Group).name).toBe('mob:skeleton');
    renderer.dispose();
  });

  it('removes the group when the mob disappears; dispose empties the scene', () => {
    const { scene, renderer } = mobSetup();
    renderer.syncMobs([mobFixture({ id: 1 }), mobFixture({ id: 2 })], 0.016);
    expect(scene.children).toHaveLength(2);
    renderer.syncMobs([mobFixture({ id: 2 })], 0.016); // id 1 died/despawned
    expect(scene.children).toHaveLength(1);
    renderer.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('swings limbs with sin(phase) while moving and settles them at rest', () => {
    const { scene, renderer } = mobSetup();
    // phase = 3.2 · 0.1 · 4 = 1.28 → swing = sin(1.28)·0.6 ≈ 0.575
    renderer.syncMobs([mobFixture({ vel: { x: 3.2, y: 0, z: 0 } })], 0.1);
    const group = scene.children[0] as THREE.Group;
    const part = (name: string): THREE.Group => group.getObjectByName(name) as THREE.Group;
    const first = part('legL').rotation.x;
    expect(first).toBeCloseTo(Math.sin(1.28) * 0.6, 10);
    expect(part('legR').rotation.x).toBeCloseTo(-first, 10); // legs counter-swing
    expect(part('armL').rotation.x).toBeCloseTo(-first, 10); // arms counter-swing
    expect(part('armR').rotation.x).toBeCloseTo(first, 10);

    // phase keeps advancing with speed
    renderer.syncMobs([mobFixture({ vel: { x: 3.2, y: 0, z: 0 } })], 0.1);
    const second = part('legL').rotation.x;
    expect(second).toBeCloseTo(Math.sin(2.56) * 0.6, 10);
    expect(second).not.toBeCloseTo(first, 6);

    // stopped → swing decays back to neutral instead of freezing mid-stride
    for (let i = 0; i < 120; i++) renderer.syncMobs([mobFixture()], 0.05);
    expect(part('legL').rotation.x).toBe(0);
    expect(part('armR').rotation.x).toBe(0);

    // faces the movement direction (velocity +x → yaw +90°)
    renderer.syncMobs([mobFixture({ vel: { x: 3.2, y: 0, z: 0 } })], 0.1);
    expect(group.rotation.y).toBeCloseTo(Math.PI / 2, 10);
    renderer.dispose();
  });

  it('white-flashes a mob for 0.1 s on flashMob, then restores flat color', () => {
    const { scene, renderer } = mobSetup();
    renderer.syncMobs([mobFixture()], 0.016);
    const head = (scene.children[0] as THREE.Group).getObjectByName('head') as THREE.Mesh;
    const mat = head.material as THREE.MeshLambertMaterial;
    expect(mat.emissive.getHex()).toBe(0x000000); // flat by default

    renderer.flashMob(0);
    renderer.syncMobs([mobFixture()], 0.05); // 0.1 − 0.05 > 0 → flashing
    expect(mat.emissive.getHex()).toBe(0xffffff);
    renderer.syncMobs([mobFixture()], 0.1); // burned through → flat again
    expect(mat.emissive.getHex()).toBe(0x000000);
    renderer.dispose();
  });

  it('creates arrow boxes oriented along their velocity', () => {
    const { scene, renderer } = mobSetup();
    renderer.syncArrows([arrowFixture({ pos: { x: 5, y: 6, z: 7 }, vel: { x: 0, y: 0, z: 4 } })]);
    expect(scene.children).toHaveLength(1);
    const mesh = scene.children[0] as THREE.Mesh;
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    expect(mesh.position).toMatchObject({ x: 5, y: 6, z: 7 });
    // +Z axis of the box points along +z velocity → identity-ish rotation
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
    expect(dir.z).toBeCloseTo(1, 6);

    renderer.syncArrows([arrowFixture({ id: 1, vel: { x: 10, y: 0, z: 0 } })]);
    expect(scene.children).toHaveLength(1); // id 0 arrow gone
    renderer.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('treats non-finite dt as 0 in the walk cycle (no NaN in limb rotations)', () => {
    const { scene, renderer } = mobSetup();
    renderer.syncMobs([mobFixture({ vel: { x: 3.2, y: 0, z: 0 } })], Number.NaN);
    const legL = (scene.children[0] as THREE.Group).getObjectByName('legL') as THREE.Group;
    expect(legL.rotation.x).toBe(0); // phase never advanced
    expect(Number.isFinite(legL.rotation.x)).toBe(true);
    renderer.dispose();
  });
});

// ---- Task 15 (deferred Task 6 fix): night sun must light terrain from ABOVE ----

describe('sunLightPosition', () => {
  const DIST = 100; // setDayNight's light distance — direction is what matters

  it('day (sun above horizon): position = sunDir × dist, unchanged from Task 6', () => {
    const day = sunDirection(0.25); // noon: {0, 1, 0}
    expect(day.y).toBeGreaterThan(0);
    const p = sunLightPosition(day);
    expect(p.x).toBeCloseTo(day.x * DIST, 10);
    expect(p.y).toBeCloseTo(day.y * DIST, 10);
    expect(p.z).toBeCloseTo(day.z * DIST, 10);
    expect(p.y).toBeGreaterThan(0);
  });

  it('night (sun below horizon): light stays ABOVE the horizon (moon = anti-sun)', () => {
    const night = sunDirection(0.75); // midnight: {0, -1, 0}
    expect(night.y).toBeLessThan(0); // the bug: raw position would be y < 0
    const p = sunLightPosition(night);
    expect(p.y).toBeGreaterThan(0); // lit from above → terrain not black
    expect(p.y).toBeCloseTo(-night.y * DIST, 10); // negated through origin
  });

  it('night at an angle: mirrors x/y/z (anti-sun), y strictly positive', () => {
    const d = sunDirection(0.6); // after dusk: y < 0, z ≠ 0
    expect(d.y).toBeLessThan(0);
    const p = sunLightPosition(d);
    expect(p.y).toBeGreaterThan(0);
    expect(p.x).toBeCloseTo(-d.x * DIST, 10);
    expect(p.y).toBeCloseTo(-d.y * DIST, 10);
    expect(p.z).toBeCloseTo(-d.z * DIST, 10);
  });

  it('day at an angle (t=0.4, still day phase): position untouched', () => {
    const d = sunDirection(0.4); // elevation cos((0.4-0.25)·2π) ≈ 0.809 > 0
    expect(d.y).toBeGreaterThan(0);
    const p = sunLightPosition(d);
    expect(p.y).toBeCloseTo(d.y * DIST, 10);
    expect(p.z).toBeCloseTo(d.z * DIST, 10);
  });
});
