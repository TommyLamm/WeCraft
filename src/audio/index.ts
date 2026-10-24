import { createAudioEngine, type AudioEngineDeps } from './engine';
import { gainForDistance, synthParams, type MaterialGroup, type SoundKind } from './sounds';
import { chirp, cricket, createNoiseBuffer, phaseCue, playOneShot, startWind } from './voices';

export { createAudioEngine } from './engine';
export type { AudioEngine, AudioEngineDeps } from './engine';
export { footstepInterval, gainForDistance, materialGroup, synthParams } from './sounds';
export type { MaterialGroup, SynthParams, SoundKind } from './sounds';

/** Minimal vec3 — `audio/` must not depend on Three. */
interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlayOptions {
  /** World position of the sound source. */
  pos?: Vec3;
  /** Listener position (usually the player); defaults to `pos` (distance 0). */
  listener?: Vec3;
  /** Extra volume multiplier on top of distance attenuation (default 1). */
  volume?: number;
}

/** 一次播放的紀錄（inert ring buffer，容量 64；生產環境零行為變化）。 */
export interface PlayRecord {
  kind: SoundKind;
  group: MaterialGroup;
  /** 播放時的 opts 淺拷貝（pos 有則記，無則略）。 */
  pos?: { x: number; y: number; z: number };
}

export interface GameAudio {
  /** Arm the audio engine from a user gesture (idempotent). */
  ensureStarted(): void;
  setVolume(v: number): void;
  handleVisibility(hidden: boolean): void;
  play(kind: SoundKind, group: MaterialGroup, opts?: PlayOptions): void;
  /** 最近播放的紀錄（facade 層的 play-call 紀錄，與 `audio/testing.ts` 的節點
   *  紀錄是兩層）；上限 64、新的擠掉最舊的。唯讀視圖——測試用來問「剛剛播了
   *  什麼」。 */
  played(): readonly PlayRecord[];
  startAmbience(): void;
  stopAmbience(): void;
  setPhase(phase: 'day' | 'night'): void;
  dispose(): void;
}

type Phase = 'day' | 'night';

/** Ambience gap between one-shots per phase, in seconds. */
const AMBIENCE_SEC: Record<Phase, [number, number]> = {
  day: [4, 9],
  night: [3, 7],
};

/** Minimum gap between two 'break' cracks (ms) — Task 14 T10 ruling: creative
 *  instant-breaks fire one break per frame (probe
 *  /tmp/opencode/wecraft-p3-shots/14-3-10-t10probe.json: 13/s at 10 fps
 *  headless ≈ 60/s at 60 fps), stacking overlapping one-shots into harsh
 *  noise; survival breaks are seconds apart so the gate never touches them.
 *  Only 'break' is gated — dig/place/step keep every call. */
export const BREAK_SOUND_MIN_INTERVAL_MS = 80;

/** `played()` ring 上限——超過就擠掉最舊的（B4 分診⑧）。 */
const PLAY_RECORD_LIMIT = 64;

export function createGameAudio(deps: AudioEngineDeps = {}): GameAudio {
  const engine = createAudioEngine(deps);

  /** Memoized 1 s noise buffer, rebuilt only for a fresh context. */
  let noise: AudioBuffer | null = null;
  let wind: { stop(): void } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let phase: Phase = 'day';
  /** Last played 'break' timestamp (deps.now / performance.now); reset on dispose. */
  let lastBreakAt = Number.NEGATIVE_INFINITY;
  const now = deps.now ?? (() => performance.now());
  /** 播放紀錄（inert ring buffer）——只在 `play()` 開頭多 push 一筆，不碰 engine。 */
  const played: PlayRecord[] = [];

  function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
    if (!noise) noise = createNoiseBuffer(ctx);
    return noise;
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /** Recursive ambience: one chirp (day) / cricket (night) per random gap. */
  function scheduleNext(): void {
    const [minSec, maxSec] = AMBIENCE_SEC[phase];
    const delayMs = (minSec + Math.random() * (maxSec - minSec)) * 1000;
    timer = setTimeout(() => {
      timer = null;
      const ctx = engine.context;
      const dest = engine.master;
      if (!ctx || !dest) return; // ambience stopped/disposed while waiting
      if (phase === 'day') chirp(ctx, dest);
      else cricket(ctx, dest, noiseBuffer(ctx));
      scheduleNext();
    }, delayMs);
  }

  function play(kind: SoundKind, group: MaterialGroup, opts: PlayOptions = {}): void {
    // B4 分診⑧：先錄後播（inert——context 還沒建也照錄，不改變惰性建構時機）。
    // pos 記**淺拷貝**：呼叫端事後改自己的 pos 物件不影響紀錄。
    played.push({ kind, group, ...(opts.pos ? { pos: { ...opts.pos } } : {}) });
    if (played.length > PLAY_RECORD_LIMIT) played.shift();
    const ctx = engine.context;
    const dest = engine.master;
    if (!ctx || !dest) return;
    if (kind === 'break') {
      const t = now();
      if (t - lastBreakAt < BREAK_SOUND_MIN_INTERVAL_MS) return;
      lastBreakAt = t;
    }
    const from = opts.listener ?? opts.pos;
    const distance =
      from && opts.pos
        ? Math.hypot(opts.pos.x - from.x, opts.pos.y - from.y, opts.pos.z - from.z)
        : 0;
    const requested = opts.volume ?? 1;
    const volume = (Number.isFinite(requested) ? requested : 0) * gainForDistance(distance);
    playOneShot(ctx, dest, synthParams(group, kind), volume, noiseBuffer(ctx));
  }

  function startAmbience(): void {
    const ctx = engine.context;
    const dest = engine.master;
    if (!ctx || !dest || wind) return; // not started → no-op; already on → no double wind
    wind = startWind(ctx, dest, noiseBuffer(ctx));
    scheduleNext();
  }

  function stopAmbience(): void {
    clearTimer();
    if (wind) {
      wind.stop();
      wind = null;
    }
  }

  function setPhase(next: Phase): void {
    phase = next;
    const ctx = engine.context;
    const dest = engine.master;
    if (ctx && dest) phaseCue(ctx, dest, noiseBuffer(ctx));
    if (wind) {
      clearTimer();
      scheduleNext();
    }
  }

  function dispose(): void {
    stopAmbience();
    noise = null;
    lastBreakAt = Number.NEGATIVE_INFINITY;
    engine.dispose();
  }

  return {
    ensureStarted() {
      engine.ensureStarted();
    },
    setVolume(v) {
      engine.setVolume(v);
    },
    handleVisibility(hidden) {
      if (hidden) engine.suspend();
      else engine.resume();
    },
    play,
    played: () => played,
    startAmbience,
    stopAmbience,
    setPhase,
    dispose,
  };
}
