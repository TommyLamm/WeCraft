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
/** 苦力怕引信聲：帶通中心／Q／長度／包絡峰値（B9 Task 11）。 */
const HISS_BPF_HZ = 900;
const HISS_Q = 1.2;
const HISS_SEC = 0.5;
const HISS_GAIN = 0.9;

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

/** 苦力怕引信聲（B9 Task 11，加分項）：0.5 秒的**帶通白噪音**（中心 900 Hz、
 *  Q 1.2）＋緩慢上升的音量包絡（0 → 0.9 → 0）——模擬原版 `entity.creeper.primed`
 *  的「嘶——」（Volume 1.0、Pitch 0.5，2026-10-20 查證）。
 *
 *  `volume`（可選，預設 1）已含距離衰減：`index.ts` 的 `playCreeperHiss` 用既有的
 *  `gainForDistance` 算好再傳進來 → 包絡峰値＝`volume × HISS_GAIN`。
 *  與 `playOneShot` 同一條 dest ← gain ← biquad ← bufferSource 慣例。 */
export function creeperHiss(
  ctx: BaseAudioContext,
  dest: AudioNode,
  noise: AudioBuffer,
  volume = 1,
): void {
  const now = ctx.currentTime;
  const peak = Math.max(0, Number.isFinite(volume) ? volume : 0) * HISS_GAIN;

  const source = ctx.createBufferSource();
  source.buffer = noise;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = HISS_BPF_HZ;
  filter.Q.value = HISS_Q;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + HISS_SEC * 0.6);
  gain.gain.linearRampToValueAtTime(0, now + HISS_SEC);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  source.start();
  source.stop(now + HISS_SEC);
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

/** 弓的發射聲（B10 Task 9，加分項）：0.14 秒的**帶通白噪音**「咻」——
 *  濾波噪音近似原版 `entity.arrow.shoot` 的短促弦聲（原版是取樣；本作程序合成）。
 *  `volume`（可選，預設 1）已含距離衰減（`index.ts` 算好再傳進來）。 */
export const BOW_SHOOT_BPF_HZ = 1400;
const BOW_SHOOT_Q = 0.9;
const BOW_SHOOT_SEC = 0.14;
const BOW_SHOOT_GAIN = 0.5;

export function bowShoot(
  ctx: BaseAudioContext,
  dest: AudioNode,
  noise: AudioBuffer,
  volume = 1,
): void {
  const now = ctx.currentTime;
  const peak = Math.max(0, Number.isFinite(volume) ? volume : 0) * BOW_SHOOT_GAIN;

  const source = ctx.createBufferSource();
  source.buffer = noise;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = BOW_SHOOT_BPF_HZ;
  filter.Q.value = BOW_SHOOT_Q;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.02);
  gain.gain.linearRampToValueAtTime(0, now + BOW_SHOOT_SEC);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  source.start();
  source.stop(now + BOW_SHOOT_SEC);
}

/** TNT 引信嘶聲（B11 Task 5，加分項）：0.6 秒的**帶通白噪音**（中心 1100 Hz、
 *  Q 1.0）＋上升再收的包絡——近似原版 `entity.tnt.primed` 的引信嘶聲
 *  （Volume 1.0；程序合成，無取樣）。`volume` 已含距離衰減。 */
export const TNT_FUSE_BPF_HZ = 1100;
const TNT_FUSE_Q = 1.0;
const TNT_FUSE_SEC = 0.6;
const TNT_FUSE_GAIN = 0.9;

export function tntFuse(
  ctx: BaseAudioContext,
  dest: AudioNode,
  noise: AudioBuffer,
  volume = 1,
): void {
  const now = ctx.currentTime;
  const peak = Math.max(0, Number.isFinite(volume) ? volume : 0) * TNT_FUSE_GAIN;

  const source = ctx.createBufferSource();
  source.buffer = noise;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = TNT_FUSE_BPF_HZ;
  filter.Q.value = TNT_FUSE_Q;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + TNT_FUSE_SEC * 0.5);
  gain.gain.linearRampToValueAtTime(0, now + TNT_FUSE_SEC);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  source.start();
  source.stop(now + TNT_FUSE_SEC);
}

/** 爆炸聲（B11 Task 5）：0.6 秒**低通噪音**（220 Hz）＋ 70→30 Hz 下滑正弦
 *  ——近似原版 `entity.generic.explode`（Volume 4.0、Pitch 0.56–0.84；程序合成）。
 *  苦力怕爆炸過去完全無聲（B9 已知缺口）——本批起與 TNT 共用這一顆音。 */
export const EXPLOSION_LPF_HZ = 220;
const EXPLOSION_OSC_FROM_HZ = 70;
const EXPLOSION_OSC_TO_HZ = 30;
const EXPLOSION_SEC = 0.6;
const EXPLOSION_GAIN = 1.0;

export function explosionBoom(
  ctx: BaseAudioContext,
  dest: AudioNode,
  noise: AudioBuffer,
  volume = 1,
): void {
  const now = ctx.currentTime;
  const peak = Math.max(0, Number.isFinite(volume) ? volume : 0) * EXPLOSION_GAIN;

  // 低通噪音（爆裂的「轟」）
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = EXPLOSION_LPF_HZ;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peak, now);
  gain.gain.linearRampToValueAtTime(0, now + EXPLOSION_SEC);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  source.start();
  source.stop(now + EXPLOSION_SEC);

  // 低頻正弦（爆炸的胸口「砰」；70 → 30 Hz 下滑）
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(EXPLOSION_OSC_FROM_HZ, now);
  osc.frequency.linearRampToValueAtTime(EXPLOSION_OSC_TO_HZ, now + EXPLOSION_SEC);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(peak, now);
  oscGain.gain.linearRampToValueAtTime(0, now + EXPLOSION_SEC);
  osc.connect(oscGain);
  oscGain.connect(dest);
  osc.start();
  osc.stop(now + EXPLOSION_SEC);
}

/** 箭的命中聲（B10 Task 9，加分項）：0.08 秒**低通噪音**＋ 220 Hz 短正弦衰減
 *  ——木頭「咚」（近似原版命中方塊／生物的悶響；程序合成，無取樣）。 */
export const ARROW_HIT_LPF_HZ = 500;
const ARROW_HIT_OSC_HZ = 220;
const ARROW_HIT_SEC = 0.08;
const ARROW_HIT_GAIN = 0.6;

export function arrowHit(
  ctx: BaseAudioContext,
  dest: AudioNode,
  noise: AudioBuffer,
  volume = 1,
): void {
  const now = ctx.currentTime;
  const peak = Math.max(0, Number.isFinite(volume) ? volume : 0) * ARROW_HIT_GAIN;

  // 低通噪音（撞擊的「啪」）
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = ARROW_HIT_LPF_HZ;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peak, now);
  gain.gain.linearRampToValueAtTime(0, now + ARROW_HIT_SEC);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  source.start();
  source.stop(now + ARROW_HIT_SEC);

  // 短正弦（木頭「咚」的音高）
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = ARROW_HIT_OSC_HZ;
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(peak, now);
  oscGain.gain.linearRampToValueAtTime(0, now + ARROW_HIT_SEC);
  osc.connect(oscGain);
  oscGain.connect(dest);
  osc.start();
  osc.stop(now + ARROW_HIT_SEC);
}
