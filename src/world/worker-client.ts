import type { GenRequest, GenResponse } from './worker';
import { generateChunk } from './terrain';

interface Job {
  id: number;
  cx: number;
  cz: number;
}

export class TerrainWorkerClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private inflight = new Map<number, Job>();
  private queue: Job[] = [];
  private failed = false;
  private readonly maxConcurrent: number;
  /** 一次請求對應一次 callback（簡化版：只保留 deferred，移除 waiting） */
  private deferred = new Map<number, Array<(r: GenResponse) => void>>();

  constructor(private seed: number, maxConcurrent = 4) {
    this.maxConcurrent = maxConcurrent;
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (e: MessageEvent<GenResponse>) => this.onResponse(e.data);
      this.worker.onerror = () => this.degrade();
    } catch {
      this.degrade();
    }
  }

  private degrade(): void {
    this.failed = true;
    this.worker?.terminate();
    this.worker = null;
    // 把排隊中與執行中的請求改用主執行緒同步生成
    const jobs = [...this.queue, ...this.inflight.values()];
    this.queue = [];
    this.inflight.clear();
    for (const job of jobs) {
      const buffer = generateChunk(job.cx, job.cz, this.seed).buffer as ArrayBuffer;
      const resp: GenResponse = { type: 'gen', id: job.id, cx: job.cx, cz: job.cz, buffer };
      this.drainDeferred(resp);
    }
  }

  private onResponse(resp: GenResponse): void {
    this.inflight.delete(resp.id);
    this.drainDeferred(resp);
    this.pump();
  }

  private drainDeferred(resp: GenResponse): void {
    const cbs = this.deferred.get(resp.id) ?? [];
    this.deferred.delete(resp.id);
    for (const cb of cbs) cb(resp);
  }

  request(cx: number, cz: number): Promise<GenResponse> {
    const id = this.nextId++;
    if (this.failed || !this.worker) {
      const buffer = generateChunk(cx, cz, this.seed).buffer as ArrayBuffer;
      return Promise.resolve({ type: 'gen', id, cx, cz, buffer });
    }
    const job: Job = { id, cx, cz };
    return new Promise((resolve) => {
      this.deferred.set(id, [resolve]);
      this.queue.push(job);
      this.pump();
    });
  }

  private pump(): void {
    if (!this.worker) return;
    while (this.inflight.size < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.inflight.set(job.id, job);
      const msg: GenRequest = { type: 'gen', ...job, seed: this.seed };
      this.worker.postMessage(msg);
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
