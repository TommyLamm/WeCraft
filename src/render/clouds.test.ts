import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { cloudPattern, cloudFieldOffset, createClouds } from './clouds';

/** Period shared by the tile, the drift wrap and the group snap (blocks). */
const PERIOD = 512;
/** Two pattern cells — the consecutive-frame displacement bound. */
const TWO_CELLS = 32;

function setup(seed = 1337): {
  scene: THREE.Scene;
  clouds: ReturnType<typeof createClouds>;
  group: THREE.Group;
  mesh: THREE.InstancedMesh;
} {
  const scene = new THREE.Scene();
  const clouds = createClouds(scene, seed);
  return {
    scene,
    clouds,
    group: scene.getObjectByName('clouds') as THREE.Group,
    mesh: scene.getObjectByName('clouds-mesh') as THREE.InstancedMesh,
  };
}

describe('cloudPattern', () => {
  it('is deterministic: the same seed yields the same tile', () => {
    expect(cloudPattern(1337)).toEqual(cloudPattern(1337));
  });

  it('yields a different tile for a different seed', () => {
    const a = cloudPattern(1337);
    const b = cloudPattern(4242);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a).not.toEqual(b);
  });

  it('keeps 25–35% of the 32×32 cell grid (density 0.3)', () => {
    for (const seed of [1337, 7, 999_999]) {
      const cells = cloudPattern(seed);
      expect(cells.length).toBeGreaterThanOrEqual(0.25 * 32 * 32);
      expect(cells.length).toBeLessThanOrEqual(0.35 * 32 * 32);
    }
  });

  it('places every cell inside [0, 512)² with the spec footprint and height', () => {
    const cells = cloudPattern(1337);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(PERIOD);
      expect(c.z).toBeGreaterThanOrEqual(0);
      expect(c.z + c.d).toBeLessThanOrEqual(PERIOD);
      expect(c.w).toBe(12);
      expect(c.d).toBe(12);
      expect(c.h).toBeGreaterThanOrEqual(3);
      expect(c.h).toBeLessThanOrEqual(5);
    }
  });
});

describe('cloudFieldOffset', () => {
  it('keeps cam − drift inside [offset, offset + period)', () => {
    const cases: Array<[number, number]> = [
      [0, 0],
      [100, 25],
      [511.9, 0.1],
      [512, 0], // exact boundary lands on the NEW tile
      [512.5, 0],
      [1000, 6],
      [-3, 0.5], // negative world coordinates (roaming south/west)
      [-600.25, 12.5],
      [1234.5, 511.75],
    ];
    for (const [cam, drift] of cases) {
      const offset = cloudFieldOffset(cam, drift);
      expect(Math.abs(offset % PERIOD)).toBe(0); // whole-period snap
      const inTile = cam - drift - offset;
      expect(inTile).toBeGreaterThanOrEqual(0);
      expect(inTile).toBeLessThan(PERIOD);
    }
  });
});

describe('createClouds', () => {
  it('instances one 12×h×12 box per pattern cell at the spec altitude', () => {
    const { mesh } = setup();
    const cells = cloudPattern(1337);
    expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(mesh.count).toBe(cells.length);

    const geo = mesh.geometry as THREE.BoxGeometry;
    expect(geo.parameters.width).toBe(1);
    expect(geo.parameters.height).toBe(1);
    expect(geo.parameters.depth).toBe(1);
    const mat = mesh.material as THREE.MeshLambertMaterial;
    expect(mat).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(mat.color.getHex()).toBe(0xffffff);
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(false);

    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    cells.forEach((c, i) => {
      mesh.getMatrixAt(i, m);
      m.decompose(pos, quat, scale);
      expect(scale.x).toBeCloseTo(c.w, 5);
      expect(scale.y).toBeCloseTo(c.h, 5);
      expect(scale.z).toBeCloseTo(c.d, 5);
      expect(pos.x).toBeCloseTo(c.x + c.w / 2, 5); // x/z are box origins
      expect(pos.y).toBeCloseTo(150 + c.h / 2, 5); // y is the box CENTER
      expect(pos.z).toBeCloseTo(c.z + c.d / 2, 5);
    });
  });

  it('setEnabled toggles the group visibility and dispose() detaches it cleanly', () => {
    const { scene, clouds, group } = setup();
    expect(group.visible).toBe(true);
    clouds.setEnabled(false);
    expect(group.visible).toBe(false);
    clouds.setEnabled(true);
    expect(group.visible).toBe(true);

    expect(() => clouds.dispose()).not.toThrow();
    expect(scene.getObjectByName('clouds')).toBeUndefined();
  });

  it('update() snaps to whole periods plus a continuous drift (< 2 cells per frame)', () => {
    const { clouds, group } = setup();
    const t = 10;
    const camX = 1536.5; // positive world side
    const camZ = -700.25; // negative world side
    clouds.update(camX, camZ, t);

    const driftX = (t * 0.6) % PERIOD;
    const driftZ = (t * 0.1) % PERIOD;
    // group position = whole-period snap of (cam − drift) PLUS the drift …
    const snappedX = group.position.x - driftX;
    const snappedZ = group.position.z - driftZ;
    expect(Math.abs(snappedX % PERIOD)).toBeCloseTo(0, 6); // multiple of the period
    expect(Math.abs(snappedZ % PERIOD)).toBeCloseTo(0, 6);
    expect(snappedX).toBeCloseTo(cloudFieldOffset(camX, driftX), 10);
    expect(snappedZ).toBeCloseTo(cloudFieldOffset(camZ, driftZ), 10);
    // … and the tile still covers the camera: 0 ≤ cam − position < period
    expect(camX - group.position.x).toBeGreaterThanOrEqual(0);
    expect(camX - group.position.x).toBeLessThan(PERIOD);
    expect(camZ - group.position.z).toBeGreaterThanOrEqual(0);
    expect(camZ - group.position.z).toBeLessThan(PERIOD);

    // one 60 fps step later (same camera, no period boundary crossed) the field
    // moves by exactly the drift delta — visible movement, capped at 2 cells
    const before = { x: group.position.x, z: group.position.z };
    clouds.update(camX, camZ, t + 1 / 60);
    const dx = group.position.x - before.x;
    const dz = group.position.z - before.z;
    const deltaX = ((t + 1 / 60) * 0.6) % PERIOD - driftX;
    const deltaZ = ((t + 1 / 60) * 0.1) % PERIOD - driftZ;
    expect(dx).toBeCloseTo(deltaX, 10);
    expect(dz).toBeCloseTo(deltaZ, 10);
    expect(dx).toBeGreaterThan(0); // the field visibly drifts east …
    expect(dz).toBeGreaterThan(0); // … and south
    expect(Math.abs(dx)).toBeLessThan(TWO_CELLS);
    expect(Math.abs(dz)).toBeLessThan(TWO_CELLS);
  });
});
