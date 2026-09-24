import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createDropRenderer } from './scene';
import type { DropEntity } from '../world/drops';
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
