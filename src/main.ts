import './style.css';
import { createGameScene } from './render/scene';
import { ChunkRenderer } from './render/chunk-renderer';
import { drawAtlas } from './render/textures';
import { World, chunkKey } from './world/world';
import { Chunk, CHUNK_SIZE } from './world/chunk';
import { TerrainWorkerClient } from './world/worker-client';
import { loadSettings } from './core/settings';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const gs = createGameScene(canvas);
const world = new World();
const chunkRenderer = new ChunkRenderer(gs.scene, drawAtlas());
const settings = loadSettings();
const terrain = new TerrainWorkerClient(settings.seed);
const genInFlight = new Set<string>();

const pendingGen: Array<[number, number]> = [];
const pendingMesh: Array<[number, number]> = [];
const generated = new Set<string>();

function refreshQueues(): void {
  const pcx = Math.floor(gs.camera.position.x / CHUNK_SIZE);
  const pcz = Math.floor(gs.camera.position.z / CHUNK_SIZE);
  const r = settings.renderDistance;
  const rg = r + 1; // gen one ring past mesh radius so edge chunks have all 4 neighbors
  pendingGen.length = 0;
  pendingMesh.length = 0;

  for (let dz = -rg; dz <= rg; dz++) {
    for (let dx = -rg; dx <= rg; dx++) {
      const cx = pcx + dx;
      const cz = pcz + dz;
      const key = chunkKey(cx, cz);
      if (!world.hasChunk(cx, cz) && !generated.has(key)) {
        pendingGen.push([cx, cz]);
      } else if (
        Math.abs(dx) <= r &&
        Math.abs(dz) <= r &&
        world.getChunk(cx, cz)?.dirty
      ) {
        pendingMesh.push([cx, cz]);
      }
    }
  }

  // 近→遠排序，優先載入腳下
  pendingGen.sort((a, b) => dist2(a, pcx, pcz) - dist2(b, pcx, pcz));
  pendingMesh.sort((a, b) => dist2(a, pcx, pcz) - dist2(b, pcx, pcz));

  for (const key of [...world.chunks.keys()]) {
    const [cx, cz] = key.split(',').map(Number);
    if (Math.abs(cx - pcx) > r + 2 || Math.abs(cz - pcz) > r + 2) {
      chunkRenderer.remove(cx, cz);
      world.removeChunk(cx, cz);
      generated.delete(key);
    }
  }
}

function dist2([cx, cz]: [number, number], pcx: number, pcz: number): number {
  return (cx - pcx) ** 2 + (cz - pcz) ** 2;
}

function processQueues(): void {
  let budgetGen = 2;
  let budgetMesh = 2;
  while (budgetGen > 0 && pendingGen.length > 0) {
    const [cx, cz] = pendingGen[0];
    const key = chunkKey(cx, cz);
    if (genInFlight.has(key)) break;
    pendingGen.shift();
    genInFlight.add(key);
    void terrain.request(cx, cz).then((resp) => {
      genInFlight.delete(key);
      const data = new Uint8Array(resp.buffer);
      const existing = world.getChunk(cx, cz);
      if (existing) {
        if (existing.generated) return;
        existing.data.set(data);
        existing.generated = true;
        existing.dirty = true;
      } else {
        const chunk = new Chunk(cx, cz, data);
        chunk.generated = true;
        chunk.dirty = true;
        world.addChunk(chunk);
      }
      generated.add(key);
    });
    budgetGen--;
  }
  while (budgetMesh > 0 && pendingMesh.length > 0) {
    const [cx, cz] = pendingMesh.shift()!;
    const c = world.getChunk(cx, cz);
    // 相鄰區塊可能還沒生成 → 等鄰居就緒再 mesh（避免邊界洞）；
    // not-ready entries are dropped (not re-pushed): readiness cannot change mid-pass,
    // and refreshQueues re-queues dirty chunks next frame — re-pushing would spin forever.
    if (c?.dirty && neighborsReady(cx, cz)) {
      chunkRenderer.rebuild(world, cx, cz);
      c.dirty = false;
      budgetMesh--;
    }
  }
}

function neighborsReady(cx: number, cz: number): boolean {
  return (
    world.getChunk(cx + 1, cz)?.generated === true &&
    world.getChunk(cx - 1, cz)?.generated === true &&
    world.getChunk(cx, cz + 1)?.generated === true &&
    world.getChunk(cx, cz - 1)?.generated === true
  );
}

window.addEventListener('resize', () =>
  gs.setSize(window.innerWidth, window.innerHeight),
);

gs.camera.position.set(0.5, 96, 0.5);
let angle = 0;

gs.renderer.setAnimationLoop(() => {
  angle += 0.003;
  const r = 30;
  gs.camera.position.x = Math.cos(angle) * r + 0.5;
  gs.camera.position.z = Math.sin(angle) * r + 0.5;
  gs.camera.lookAt(0.5, 82, 0.5);
  refreshQueues();
  processQueues();
  gs.renderer.render(gs.scene, gs.camera);
});
