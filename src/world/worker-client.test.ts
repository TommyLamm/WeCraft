import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TerrainWorkerClient } from './worker-client';
import { generateChunk } from './terrain';
import type { GenRequest, GenResponse } from './worker';

class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((e: MessageEvent<GenResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
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

  failMessageError(): void {
    this.onmessageerror?.();
  }
}

function lastWorker(): MockWorker {
  return MockWorker.instances[MockWorker.instances.length - 1];
}

describe('TerrainWorkerClient', () => {
  beforeEach(() => {
    vi.useFakeTimers(); // B4 Task 15：每個 job 都有逾時計時器
    MockWorker.instances = [];
    vi.stubGlobal('Worker', MockWorker);
  });

  afterEach(() => {
    vi.useRealTimers();
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
    // dispose 後的請求：走分幀退路（B4 Task 15）→ 要 pump 才會 settle。
    const lateP = client.request(9, 9);
    client.drainFallback(1);
    const late = await lateP;
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
    client.drainFallback(99); // B4：降級不再同步排空 → 由主迴圈分幀 pump
    await Promise.all(ps);
    expect(settled.size).toBe(5);
    for (const n of settled.values()) expect(n).toBe(1);
  });

  it('request resolves via the frame-drained fallback after failure', async () => {
    const client = new TerrainWorkerClient(1, 2);
    const w = lastWorker();
    const pending = client.request(0, 0);
    w.fail();
    client.drainFallback(99);
    const drained = await pending;
    expect(drained.buffer.byteLength).toBeGreaterThan(0);
    const before = w.posted.length;
    const fallbackP = client.request(5, 5);
    client.drainFallback(99);
    const fallback = await fallbackP;
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
    w.fail(); // 模擬 worker 失效 → 走退路
    client.drainFallback(99);
    const resp = await pending;
    expect(new Uint8Array(resp.buffer)).toEqual(generateChunk(2, -3, 1337));
  });

  /** 退路的**後續**請求也必須與主執行緒一致（不是只有失效當下的那一筆）。 */
  it('requests made after the degradation still match generateChunk byte for byte', async () => {
    const client = new TerrainWorkerClient(1337, 1);
    const w = lastWorker();
    w.fail();
    const p = client.request(-5, 4);
    client.drainFallback(1);
    const resp = await p;
    expect(new Uint8Array(resp.buffer)).toEqual(generateChunk(-5, 4, 1337));
  });

  // ---- B4 Task 15：job 逾時＋分幀退路 --------------------------------------

  it('a job that never answers rejects after the deadline and degrades the client', async () => {
    const client = new TerrainWorkerClient(1, 2, 10_000);
    const w = lastWorker();
    const p = client.request(0, 0);
    expect(w.posted.length).toBe(1);
    vi.advanceTimersByTime(9_999); // 未到期限 → 不得拒絕
    let rejected = false;
    p.catch(() => {
      rejected = true;
    });
    await Promise.resolve();
    expect(rejected).toBe(false);
    vi.advanceTimersByTime(1); // 到期
    await expect(p).rejects.toThrow(/timed out/);
    // 逾時＝worker 失效 → 降級（終止 worker）；後續請求走分幀退路。
    expect(w.terminated).toBe(true);
    const q = client.request(1, 0);
    let qDone = false;
    void q.then(() => {
      qDone = true;
    });
    await Promise.resolve();
    expect(qDone).toBe(false); // 還沒 pump → 不 settle（不是舊碼的同步生成）
    expect(client.drainFallback(1)).toBe(1);
    const resp = await q;
    expect(new Uint8Array(resp.buffer)).toEqual(generateChunk(1, 0, 1));
  });

  it('a job answered in time clears its deadline (no late rejection)', async () => {
    const client = new TerrainWorkerClient(1, 2, 10_000);
    const w = lastWorker();
    const p = client.request(0, 0);
    w.respond(w.posted[0]);
    const resp = await p;
    expect(resp.buffer.byteLength).toBeGreaterThan(0);
    // 時鐘走過期限也不得對已 settle 的請求做任何事（計時器已清）。
    expect(() => vi.advanceTimersByTime(20_000)).not.toThrow();
    expect(w.terminated).toBe(false); // 沒有誤觸降級
  });

  it('a messageerror degrades the client', async () => {
    const client = new TerrainWorkerClient(1, 2);
    const w = lastWorker();
    const p = client.request(0, 0);
    w.failMessageError(); // 反序列化失敗（結構化複製壞掉）→ 與 onerror 同等
    expect(w.terminated).toBe(true);
    client.drainFallback(2);
    const resp = await p;
    expect(resp.buffer.byteLength).toBeGreaterThan(0);
  });

  it('degrade drains the fallback across frames, at most two jobs per call', async () => {
    const client = new TerrainWorkerClient(1, 1);
    const w = lastWorker();
    const settled: number[] = [];
    const ps = [0, 1, 2].map((i) => client.request(i, 0).then((r) => settled.push(r.id)));
    expect(w.posted.length).toBe(1); // 1 個 inflight、2 個排隊
    w.fail();
    // 降級本身**不生成任何東西**——舊碼在這裡同步排空（每次降級＝一次凍結）。
    expect(settled).toEqual([]);
    expect(client.drainFallback()).toBe(2); // 預設預算＝2
    await Promise.resolve();
    await Promise.resolve();
    expect(settled.length).toBe(2);
    expect(client.drainFallback()).toBe(1); // 剩下的下一幀
    await Promise.all(ps);
    expect(settled.length).toBe(3);
  });

  it('the degrade callback fires once (single toast, not one per failure)', () => {
    const client = new TerrainWorkerClient(1, 2);
    const w = lastWorker();
    let calls = 0;
    client.onDegrade = () => {
      calls++;
    };
    w.fail();
    w.fail(); // 二次失敗（例如 terminate 後的殘訊）不得再跳一次
    expect(calls).toBe(1);
  });
});
