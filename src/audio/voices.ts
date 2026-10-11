import type { SynthParams } from './sounds';

/** One-shot envelope: fast attack, then a release starting at `durationSec`. */
const ATTACK_SEC = 0.005;
const RELEASE_SEC = 0.05;

/** Ambience levels (wind is pinned at 0.04; the one-shots sit just above it,
 *  since they are meant to be separate events over the wind bed). */
const WIND_HZ = 300;
const WIND_GAIN = 0.04;
const CHIRP_FROM_HZ = 1800;
const CHIRP_TO_HZ = 2600;
const CHIRP_SEC = 0.15;
const CHIRP_GAIN = 0.12;
const CRICKET_HZ = 4000;
const CRICKET_SEC = 0.08;
const CRICKET_GAIN = 0.15;
const PHASE_FROM_HZ = 200;
const PHASE_TO_HZ = 800;
const PHASE_SEC = 0.8;
const PHASE_GAIN = 0.2;

/** One second of white noise, mono, at the context's sample rate. Callers
 *  memoize — a fresh buffer per dig would allocate ~176 KB each time. */
export function createNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** One filtered noise burst routed dest ← gain ← biquad ← bufferSource.
 *  `volume` already carries distance attenuation; `params.gain` the per-kind
 *  level, so the envelope plateau is `volume × params.gain`. */
export function playOneShot(
  ctx: BaseAudioContext,
  dest: AudioNode,
  params: SynthParams,
  volume: number,
  noise: AudioBuffer,
): void {
  const now = ctx.currentTime;
  const peak = volume * params.gain;

  const source = ctx.createBufferSource();
  source.buffer = noise;

  const filter = ctx.createBiquadFilter();
  filter.type = params.filter;
  filter.frequency.value = params.freq;
  filter.Q.value = params.q;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + ATTACK_SEC);
  gain.gain.setValueAtTime(peak, now + params.durationSec);
  gain.gain.linearRampToValueAtTime(0, now + params.durationSec + RELEASE_SEC);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  source.start();
  source.stop(now + params.durationSec + RELEASE_SEC);
}

/** Looping wind bed: noise → lowpass 300 → gain 0.04. `stop()` stops the
 *  looped source and frees the chain; calling it twice is safe. */
export function startWind(
  ctx: BaseAudioContext,
  dest: AudioNode,
  noise: AudioBuffer,
): { stop(): void } {
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = WIND_HZ;

  const gain = ctx.createGain();
  gain.gain.value = WIND_GAIN;

  source.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  source.start();

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      source.stop();
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    },
  };
}

/** Day ambience: a short sine chirp sweeping 1800→2600 Hz. */
export function chirp(ctx: BaseAudioContext, dest: AudioNode): void {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(CHIRP_FROM_HZ, now);
  osc.frequency.linearRampToValueAtTime(CHIRP_TO_HZ, now + CHIRP_SEC);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(CHIRP_GAIN, now + 0.02);
  gain.gain.linearRampToValueAtTime(0, now + CHIRP_SEC);

  osc.connect(gain);
  gain.connect(dest);
  osc.start();
  osc.stop(now + CHIRP_SEC);
}

/** Night ambience: a 80 ms noise tick through a highpass. */
export function cricket(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer): void {
  const now = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = noise;

  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = CRICKET_HZ;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(CRICKET_GAIN, now + 0.01);
  gain.gain.linearRampToValueAtTime(0, now + CRICKET_SEC);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  source.start();
  source.stop(now + CRICKET_SEC);
}

/** Day→night transition: a 0.8 s bandpass sweep from 200 to 800 Hz. */
export function phaseCue(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer): void {
  const now = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = noise;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(PHASE_FROM_HZ, now);
  filter.frequency.linearRampToValueAtTime(PHASE_TO_HZ, now + PHASE_SEC);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(PHASE_GAIN, now + 0.05);
  gain.gain.linearRampToValueAtTime(0, now + PHASE_SEC);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  source.start();
  source.stop(now + PHASE_SEC);
}
