import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TerrainWorkerClient } from './worker-client';
import { generateChunk } from './terrain';
import type { GenRequest, GenResponse } from './worker';

class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((e: MessageEvent<GenResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly posted: GenRequest[] = [];
  terminated = false;

  constructor() {
    MockWorker.instances.push(this);
  }

  postMessage(msg: GenRequest): void {
    this.posted.push(msg);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(req: GenRequest): void {
    const resp: GenResponse = {
      type: 'gen',
      id: req.id,
      cx: req.cx,
      cz: req.cz,
      buffer: new ArrayBuffer(16),
    };
    this.onmessage?.({ data: resp } as MessageEvent<GenResponse>);
  }

  fail(): void {
    this.onerror?.();
  }
}

function lastWorker(): MockWorker {
  return MockWorker.instances[MockWorker.instances.length - 1];
}

describe('TerrainWorkerClient', () => {
  beforeEach(() => {
    MockWorker.instances = [];
    vi.stubGlobal('Worker', MockWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts at most maxConcurrent before first response', () => {
    const client = new TerrainWorkerClient(1, 2);
    const w = lastWorker();
    const ps = [0, 1, 2, 3].map((i) => client.request(i, 0));
    expect(w.posted.length).toBe(2);
    w.respond(w.posted[0]);
    expect(w.posted.length).toBe(3);
    w.respond(w.posted[1]);
    w.respond(w.posted[2]);
    w.respond(w.posted[3]);
    return Promise.all(ps);
  });

  it('resolves requests in FIFO order', async () => {
    const client = new TerrainWorkerClient(1, 1);
    const w = lastWorker();
    const order: number[] = [];
    const ps = [0, 1, 2].map((i) =>
      client.request(i, 0).then((r) => {
        order.push(r.id);
      }),
    );
    expect(w.posted.length).toBe(1);
    w.respond(w.posted[0]);
    expect(w.posted.length).toBe(2);
    w.respond(w.posted[1]);
    expect(w.posted.length).toBe(3);
    w.respond(w.posted[2]);
    await Promise.all(ps);
    expect(order).toEqual([1, 2, 3]);
  });

  it('dispose resolves every queued and inflight deferred exactly once', async () => {
    const client = new TerrainWorkerClient(1, 2);
    const w = lastWorker();
    const settled = new Map<number, number>();
    const ps = [0, 1, 2, 3, 4].map((i) =>
      client.request(i, 0).then((r) => {
        settled.set(r.id, (settled.get(r.id) ?? 0) + 1);
      }),
    );
    expect(w.posted.length).toBe(2);
    client.dispose();
    expect(w.terminated).toBe(true);
    await Promise.all(ps);
    expect(settled.size).toBe(5);
    for (const n of settled.values()) expect(n).toBe(1);
    const before = w.posted.length;
    const late = await client.request(9, 9);
    expect(late.buffer.byteLength).toBeGreaterThan(0);
    expect(w.posted.length).toBe(before);
  });

  it('degrade resolves every queued and inflight deferred exactly once', async () => {
    const client = new TerrainWorkerClient(1, 2);
    const w = lastWorker();
    const settled = new Map<number, number>();
    const ps = [0, 1, 2, 3, 4].map((i) =>
      client.request(i, 0).then((r) => {
        settled.set(r.id, (settled.get(r.id) ?? 0) + 1);
      }),
    );
    w.fail();
    expect(w.terminated).toBe(true);
    await Promise.all(ps);
    expect(settled.size).toBe(5);
    for (const n of settled.values()) expect(n).toBe(1);
  });

  it('request resolves via sync fallback after failure', async () => {
    const client = new TerrainWorkerClient(1, 2);
    const w = lastWorker();
    const pending = client.request(0, 0);
    w.fail();
    const drained = await pending;
    expect(drained.buffer.byteLength).toBeGreaterThan(0);
    const before = w.posted.length;
    const fallback = await client.request(5, 5);
    expect(fallback.buffer.byteLength).toBeGreaterThan(0);
    expect(fallback.id).toBeGreaterThan(drained.id);
    expect(w.posted.length).toBe(before);
  });

  /**
   * B3 Task 9（Step 2）：**同步退路**回傳的位元組必須與主執行緒的 `generateChunk`
   * 完全相同。
   *
   * 為什麼要這條：worker 失效後（`degrade()`）所有請求改由主執行緒同步生成 →
   * 兩條路徑**必須產生同一片地形**，否則「worker 掛掉的那一刻」世界會整片變形
   * （玩家看到自己腳下的地形突然換掉）。
   *
   * **範圍說明（誠實）**：`MockWorker` 只會回 16 bytes 的假 buffer → 這條案例
   * 驗的是「**同步退路 vs 主執行緒**」，**不是**「worker 路徑 vs 主執行緒」
   * （後者需要真的 worker，見回報的〈已知未測面〉）。
   */
  it('the sync fallback returns exactly the terrain generateChunk produces', async () => {
    const client = new TerrainWorkerClient(1337, 1);
    const w = lastWorker();
    const pending = client.request(2, -3);
    w.fail(); // 模擬 worker 失效 → 走同步退路
    const resp = await pending;
    expect(new Uint8Array(resp.buffer)).toEqual(generateChunk(2, -3, 1337));
  });

  /** 同步退路的**後續**請求也必須與主執行緒一致（不是只有失效當下的那一筆）。 */
  it('requests made after the degradation still match generateChunk byte for byte', async () => {
    const client = new TerrainWorkerClient(1337, 1);
    const w = lastWorker();
    w.fail();
    const resp = await client.request(-5, 4);
    expect(new Uint8Array(resp.buffer)).toEqual(generateChunk(-5, 4, 1337));
  });
});
