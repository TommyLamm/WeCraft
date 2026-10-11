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

export interface GameAudio {
  /** Arm the audio engine from a user gesture (idempotent). */
  ensureStarted(): void;
  setVolume(v: number): void;
  handleVisibility(hidden: boolean): void;
  play(kind: SoundKind, group: MaterialGroup, opts?: PlayOptions): void;
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
    startAmbience,
    stopAmbience,
    setPhase,
    dispose,
  };
}
