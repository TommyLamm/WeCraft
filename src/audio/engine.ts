/** Web Audio lifecycle: gesture-gated context creation, master volume, tab
 *  visibility. The context is NEVER built eagerly — browsers block autoplay,
 *  so the game calls `ensureStarted()` from the first user gesture. Audio must
 *  never throw into the game loop: missing APIs and failed calls degrade to a
 *  permanent no-op. */

export interface AudioEngineDeps {
  /** Test seam / custom factory; falls back to window.AudioContext. */
  createContext?: () => AudioContext;
}

export interface AudioEngine {
  readonly started: boolean;
  readonly context: AudioContext | null;
  /** Master output bus every voice connects into; null until started.
   *  `GameAudio` routes all voices through it so `setVolume` is audible. */
  readonly master: GainNode | null;
  ensureStarted(): void;
  setVolume(v: number): void;
  suspend(): void;
  resume(): void;
  dispose(): void;
}

type AudioContextCtor = new () => AudioContext;

function defaultContextCtor(): AudioContextCtor | undefined {
  const w = window as typeof window & { webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function createAudioEngine(deps: AudioEngineDeps = {}): AudioEngine {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let volume = 1;

  /** Swallow synchronous throws and promise rejections alike. */
  const quietly = (call: () => Promise<unknown>): void => {
    try {
      call().catch(() => {});
    } catch {
      // a failed audio call must never reach the game loop
    }
  };

  function makeContext(): AudioContext | null {
    if (deps.createContext) return deps.createContext();
    const Ctor = defaultContextCtor();
    return Ctor ? new Ctor() : null;
  }

  function ensureStarted(): void {
    if (ctx) return;
    let created: AudioContext | null;
    try {
      created = makeContext();
    } catch {
      return; // unavailable/failing constructor → stay a no-op
    }
    if (!created) return;
    ctx = created;
    master = created.createGain();
    master.gain.value = volume;
    master.connect(created.destination);
    if (created.state === 'suspended') quietly(() => created.resume());
  }

  return {
    get started() {
      return ctx !== null;
    },
    get context() {
      return ctx;
    },
    get master() {
      return master;
    },
    ensureStarted,
    setVolume(v) {
      volume = Number.isFinite(v) ? clamp01(v) : 0;
      if (master) master.gain.value = volume;
    },
    suspend() {
      const c = ctx;
      if (c) quietly(() => c.suspend());
    },
    resume() {
      const c = ctx;
      if (c) quietly(() => c.resume());
    },
    dispose() {
      const c = ctx;
      ctx = null;
      master = null;
      if (c) quietly(() => c.close());
    },
  };
}
