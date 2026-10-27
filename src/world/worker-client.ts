// Types imported with import type — worker.ts has top-level self.onmessage side effect; never value-import it on the main thread.
import type { GenRequest, GenResponse } from './worker';
import { generateChunk } from './terrain';

interface Job {
  id: number;
  cx: number;
  cz: number;
}

/** 每個 job 的預設期限（B4 Task 15）：worker 沉默超過這個時間＝失效，走退路。
 *  10 秒對「正常生成 ~10-50 ms、最壞區塊數百 ms」的實測值有巨大餘裕，只攔
 *  「永遠不回來」的 hung worker（審查 B4：沒有 timeout 時 request() 永不 settle
 *  → genInFlight 永久佔位、區塊永不生成、玩家眼前一片虛空）。 */
export const TERRAIN_JOB_TIMEOUT_MS = 10_000;

export class TerrainWorkerClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private inflight = new Map<number, Job>();
  private queue: Job[] = [];
  private failed = false;
  private readonly maxConcurrent: number;
  private readonly jobTimeoutMs: number;
  /** 一次請求對應一次 callback（簡化版：只保留 deferred，移除 waiting） */
  private deferred = new Map<
    number,
    Array<{ resolve: (r: GenResponse) => void; reject: (e: Error) => void }>
  >();
  /** 每個 inflight job 的逾時計時器（回應／降級／dispose 都要清）。 */
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  /**
   * **B4 Task 15：分幀退路。** 降級之後（或 worker 缺席時）的請求不再「當場
   * 同步 `generateChunk`」——那會讓主執行緒每收一塊就凍結（審查 B4 的後半）。
   * 全部進這個陣列，由主迴圈每幀呼叫 {@link drainFallback} 生成至多 `budget`
   * 塊；請求在各自的幀才 settle。
   */
  private pendingFallback: Job[] = [];
  /** 降級時的單次回呼（main.ts 接一次性的「備援模式」toast）。 */
  onDegrade: (() => void) | null = null;

  constructor(
    private seed: number,
    maxConcurrent = 4,
    jobTimeoutMs = TERRAIN_JOB_TIMEOUT_MS,
  ) {
    this.maxConcurrent = maxConcurrent;
    this.jobTimeoutMs = jobTimeoutMs;
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (e: MessageEvent<GenResponse>) => this.onResponse(e.data);
      this.worker.onerror = () => this.degrade();
      // messageerror＝訊息存在但反序列化失敗（結構化複製壞掉）→ 與 onerror 同等
      this.worker.onmessageerror = () => this.degrade();
    } catch {
      this.degrade();
    }
  }

  private degrade(): void {
    if (this.failed) return; // 一次轉場、一次回呼（toast 只跳一次）
    this.failed = true;
    this.worker?.terminate();
    this.worker = null;
    this.clearAllTimers();
    // 排隊中與執行中的請求**移進**分幀退路（不在這裡同步生成——舊碼的
    // drainPendingSync 就是「降級當下凍結一幀」的來源）。
    for (const job of this.inflight.values()) this.pendingFallback.push(job);
    this.inflight.clear();
    this.pendingFallback.push(...this.queue);
    this.queue = [];
    this.onDegrade?.();
  }

  private clearAllTimers(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /** 逾時（B4 Task 15）：拒絕該 job（呼叫端的 catch 會清 `genInFlight`；重新
   *  排隊時走退路），其餘請求交給分幀退路——逾時＝worker 失效。 */
  private onTimeout(id: number): void {
    this.timers.delete(id);
    const job = this.inflight.get(id);
    if (!job) return; // 已回應／已降級／已 dispose
    this.inflight.delete(id);
    const cbs = this.deferred.get(id) ?? [];
    this.deferred.delete(id);
    for (const cb of cbs) cb.reject(new Error(`terrain worker job ${id} timed out`));
    this.degrade();
  }

  /** 主迴圈每幀呼叫：生成至多 `budget` 塊並 settle 對應請求。回傳實際生成數。 */
  drainFallback(budget = 2): number {
    let done = 0;
    while (done < budget && this.pendingFallback.length > 0) {
      const job = this.pendingFallback.shift()!;
      const buffer = generateChunk(job.cx, job.cz, this.seed).buffer as ArrayBuffer;
      const resp: GenResponse = { type: 'gen', id: job.id, cx: job.cx, cz: job.cz, buffer };
      this.drainDeferred(resp);
      done++;
    }
    return done;
  }

  private onResponse(resp: GenResponse): void {
    const timer = this.timers.get(resp.id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(resp.id);
    }
    this.inflight.delete(resp.id);
    this.drainDeferred(resp);
    this.pump();
  }

  private drainDeferred(resp: GenResponse): void {
    const cbs = this.deferred.get(resp.id) ?? [];
    this.deferred.delete(resp.id);
    for (const cb of cbs) cb.resolve(resp);
  }

  request(cx: number, cz: number): Promise<GenResponse> {
    const id = this.nextId++;
    const job: Job = { id, cx, cz };
    if (this.failed || !this.worker) {
      // 分幀退路：不在這裡同步生成（舊碼同步＝每個請求都卡一幀）；由主迴圈
      // 的 drainFallback 在後續幀逐批 settle。
      return new Promise((resolve, reject) => {
        this.deferred.set(id, [{ resolve, reject }]);
        this.pendingFallback.push(job);
      });
    }
    return new Promise((resolve, reject) => {
      this.deferred.set(id, [{ resolve, reject }]);
      this.queue.push(job);
      this.pump();
    });
  }

  private pump(): void {
    if (!this.worker) return;
    while (this.inflight.size < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.inflight.set(job.id, job);
      const timer = setTimeout(() => this.onTimeout(job.id), this.jobTimeoutMs);
      this.timers.set(job.id, timer);
      const msg: GenRequest = { type: 'gen', ...job, seed: this.seed };
      this.worker.postMessage(msg);
    }
  }

  dispose(): void {
    if (this.failed) {
      // 已經降級：退路裡可能還有沒排空的請求 → 一次生成（dispose 是收尾，
      // 同步成本只發生一次，且之後不會再有新請求）。
      this.drainFallback(Number.POSITIVE_INFINITY);
      return;
    }
    this.failed = true;
    this.clearAllTimers();
    const jobs = [...this.queue, ...this.inflight.values()];
    this.queue = [];
    this.inflight.clear();
    for (const job of jobs) {
      const buffer = generateChunk(job.cx, job.cz, this.seed).buffer as ArrayBuffer;
      const resp: GenResponse = { type: 'gen', id: job.id, cx: job.cx, cz: job.cz, buffer };
      this.drainDeferred(resp);
    }
    this.worker?.terminate();
    this.worker = null;
  }
}
