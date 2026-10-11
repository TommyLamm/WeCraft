import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { sunMoonPositions, createSky } from './sky';

describe('sunMoonPositions', () => {
  it('places the sun at sunDir · r and the moon at the exact opposite', () => {
    const p = sunMoonPositions({ x: 0, y: 1, z: 0 });
    expect(p.sun).toEqual({ x: 0, y: 800, z: 0 });
    expect(p.moon.y).toBe(-800);
    // opposite of a zero component is -0 (sign is meaningless for a position)
    expect(p.moon.x).toBeCloseTo(0, 10);
    expect(p.moon.z).toBeCloseTo(0, 10);
  });

  it('honours a custom radius on off-axis directions', () => {
    const p = sunMoonPositions({ x: 0, y: 0.6, z: 0.8 }, 10);
    expect(p.sun.x).toBeCloseTo(0, 10);
    expect(p.sun.y).toBeCloseTo(6, 10);
    expect(p.sun.z).toBeCloseTo(8, 10);
    expect(p.moon.x).toBeCloseTo(0, 10);
    expect(p.moon.y).toBeCloseTo(-6, 10);
    expect(p.moon.z).toBeCloseTo(-8, 10);
  });
});

function setup(): {
  scene: THREE.Scene;
  sky: ReturnType<typeof createSky>;
  dome: THREE.Mesh;
  sun: THREE.Mesh;
  moon: THREE.Mesh;
} {
  const scene = new THREE.Scene();
  const sky = createSky(scene);
  const dome = scene.getObjectByName('sky-dome') as THREE.Mesh;
  const sun = scene.getObjectByName('sky-sun') as THREE.Mesh;
  const moon = scene.getObjectByName('sky-moon') as THREE.Mesh;
  return { scene, sky, dome, sun, moon };
}

describe('createSky', () => {
  it('builds a 900-radius BackSide gradient dome: no fog, no depth write, renderOrder −2', () => {
    const { dome } = setup();
    const geo = dome.geometry as THREE.SphereGeometry;
    expect(geo.parameters.radius).toBe(900);
    const mat = dome.material as THREE.ShaderMaterial;
    expect(mat).toBeInstanceOf(THREE.ShaderMaterial);
    expect(mat.side).toBe(THREE.BackSide);
    expect(mat.fog).toBe(false);
    expect(mat.depthWrite).toBe(false);
    expect(dome.renderOrder).toBe(-2);
    expect(mat.uniforms.horizon).toBeDefined();
    expect(mat.uniforms.zenith).toBeDefined();
    // the brief's horizon→zenith ramp is compiled into the fragment shader
    expect(mat.fragmentShader).toContain('clamp');
    expect(mat.fragmentShader).toContain('1.6');
    expect(mat.fragmentShader).toContain('0.15');
    // linear uniforms are converted at output like built-in materials, so the
    // dome horizon matches scene.background/fog instead of rendering darker
    expect(mat.fragmentShader).toContain('colorspace_fragment');
  });

  it('builds 60² sun (0xffec8a) and 40² moon (0xe8edf2) quads, unfogged', () => {
    const { sun, moon } = setup();
    const cases: Array<[THREE.Mesh, number, number]> = [
      [sun, 60, 0xffec8a],
      [moon, 40, 0xe8edf2],
    ];
    for (const [mesh, size, color] of cases) {
      const geo = mesh.geometry as THREE.PlaneGeometry;
      expect(geo.parameters.width).toBe(size);
      expect(geo.parameters.height).toBe(size);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      expect(mat).toBeInstanceOf(THREE.MeshBasicMaterial);
      expect(mat.color.getHex()).toBe(color);
      expect(mat.fog).toBe(false);
    }
  });

  it('setSky anchors the dome + quads to the camera, face-corrects the quads, updates uniforms', () => {
    const { sky, dome, sun, moon } = setup();
    const camPos = { x: 150, y: 80, z: -220 };
    expect(() =>
      sky.setSky({ x: 0, y: 1, z: 0 }, { zenith: 0x3d6fc9, horizon: 0x87ceeb }, camPos),
    ).not.toThrow();

    // camera-relative anchoring (review Important fix): the 900-radius dome and
    // the 800-distance quads must travel with the camera, so they always stay
    // inside the camera's far plane (1000). getWorldPosition — also passes for
    // a camera-anchored group implementation.
    const world = new THREE.Vector3();
    dome.getWorldPosition(world);
    expect(world.x).toBeCloseTo(150, 10);
    expect(world.y).toBeCloseTo(80, 10);
    expect(world.z).toBeCloseTo(-220, 10);

    expect(sun.getWorldPosition(world).y).toBeCloseTo(880, 10); // camPos.y + 1·800
    expect(world.x).toBeCloseTo(150, 10);
    expect(world.z).toBeCloseTo(-220, 10);
    expect(moon.getWorldPosition(world).y).toBeCloseTo(-720, 10); // camPos.y − 1·800

    // lookAt(cameraPos): each quad's +Z (its plane normal) points at the camera
    const cam = new THREE.Vector3(camPos.x, camPos.y, camPos.z);
    const face = new THREE.Vector3();
    const sunWorld = sun.getWorldPosition(new THREE.Vector3());
    sun.getWorldDirection(face);
    expect(face.dot(cam.clone().sub(sunWorld).normalize())).toBeCloseTo(1, 5);
    const moonWorld = moon.getWorldPosition(new THREE.Vector3());
    moon.getWorldDirection(face);
    expect(face.dot(cam.clone().sub(moonWorld).normalize())).toBeCloseTo(1, 5);

    const mat = dome.material as THREE.ShaderMaterial;
    expect((mat.uniforms.horizon.value as THREE.Color).getHex()).toBe(0x87ceeb);
    expect((mat.uniforms.zenith.value as THREE.Color).getHex()).toBe(0x3d6fc9);
  });

  it('re-anchors the dome to each new camera position (never exceeds the far plane)', () => {
    const { sky, dome } = setup();
    const colors = { zenith: 0x3d6fc9, horizon: 0x87ceeb };
    const world = new THREE.Vector3();
    sky.setSky({ x: 0, y: 1, z: 0 }, colors, { x: 150, y: 80, z: -220 });
    dome.getWorldPosition(world);
    expect(world.x).toBeCloseTo(150, 10);
    expect(world.y).toBeCloseTo(80, 10);
    expect(world.z).toBeCloseTo(-220, 10);
    sky.setSky({ x: 0, y: 1, z: 0 }, colors, { x: -40, y: 70, z: 500 });
    dome.getWorldPosition(world);
    expect(world.x).toBeCloseTo(-40, 10);
    expect(world.y).toBeCloseTo(70, 10);
    expect(world.z).toBeCloseTo(500, 10);
  });

  it('setSky tracks a moving sun across the cycle (camera-relative)', () => {
    const { sky, sun, moon } = setup();
    const camPos = { x: 0, y: 64, z: 0 };
    sky.setSky({ x: 0, y: 0, z: 1 }, { zenith: 0x05070f, horizon: 0x0a0e1a }, camPos);
    expect(sun.position.z).toBeCloseTo(800, 10); // camPos.z + 1·800
    expect(sun.position.y).toBeCloseTo(64, 10); // camera height carried along
    expect(moon.position.z).toBeCloseTo(-800, 10);
    sky.setSky({ x: 0, y: -1, z: 0 }, { zenith: 0x05070f, horizon: 0x0a0e1a }, camPos);
    expect(sun.position.y).toBeCloseTo(-736, 10); // camPos.y + (−1)·800
    expect(moon.position.y).toBeCloseTo(864, 10); // camPos.y + 1·800
  });

  it('dispose() detaches every mesh and frees them without throwing', () => {
    const { scene, sky } = setup();
    sky.setSky({ x: 0, y: 1, z: 0 }, { zenith: 0x3d6fc9, horizon: 0x87ceeb }, { x: 0, y: 64, z: 0 });
    expect(scene.children).toHaveLength(3);
    expect(() => sky.dispose()).not.toThrow();
    expect(scene.children).toHaveLength(0);
  });
});
