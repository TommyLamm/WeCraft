import { afterEach, describe, it, expect, vi } from 'vitest';
import { createGameAudio } from './index';
import { FakeAudioContext } from './testing';

function setup() {
  const fake = new FakeAudioContext();
  const audio = createGameAudio({ createContext: () => fake as unknown as AudioContext });
  return { fake, audio };
}

describe('createGameAudio', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('before start: play and startAmbience are no-ops (no nodes, no timers)', () => {
    vi.useFakeTimers();
    const { fake, audio } = setup();

    audio.play('dig', 'stone', { pos: { x: 0, y: 0, z: 0 } });
    audio.startAmbience();
    vi.advanceTimersByTime(60_000);

    expect(fake.created).toHaveLength(0);
    audio.dispose(); // never started → nothing to close
    expect(fake.closeCalls).toBe(0);
  });

  it('play at distance 20 → envelope gain 0, still routed through the master bus', () => {
    const { fake, audio } = setup();
    audio.ensureStarted();
    const master = fake.gains[0];

    audio.play('dig', 'stone', {
      pos: { x: 20, y: 0, z: 0 },
      listener: { x: 0, y: 0, z: 0 },
    });

    expect(fake.gains).toHaveLength(2); // master + one-shot envelope
    const envelope = fake.gains[1];
    expect(envelope.gain.peak).toBe(0);
    expect(envelope.outputs).toContain(master);
    expect(fake.bufferSources).toHaveLength(1);
  });

  it('play at distance 11.5 → 0.5 × base gain; missing positions → distance 0; opts.volume multiplies', () => {
    const { fake, audio } = setup();
    audio.ensureStarted();

    audio.play('dig', 'stone', {
      pos: { x: 11.5, y: 0, z: 0 },
      listener: { x: 0, y: 0, z: 0 },
    });
    expect(fake.gains[1].gain.peak).toBeCloseTo(0.25); // 0.5 distance × dig/stone base 0.5

    audio.play('dig', 'stone'); // no positions at all → distance 0
    expect(fake.gains[2].gain.peak).toBeCloseTo(0.5);

    audio.play('dig', 'stone', {
      pos: { x: 11.5, y: 0, z: 0 },
      listener: { x: 0, y: 0, z: 0 },
      volume: 2,
    });
    expect(fake.gains[3].gain.peak).toBeCloseTo(0.5); // 2 × 0.5 distance × 0.5 base
  });

  // ---- B9 Task 11：苦力怕引信聲（加分項）----
  it('playCreeperHiss synthesises one band-passed hiss through the master bus', () => {
    const { fake, audio } = setup();
    audio.ensureStarted();
    const master = fake.gains[0];

    audio.playCreeperHiss();

    expect(fake.bufferSources).toHaveLength(1);
    const filter = fake.biquads.find((b) => b.type === 'bandpass');
    expect(filter).toBeTruthy();
    expect(filter!.frequency.value).toBeCloseTo(900, 5);
    expect(filter!.Q.value).toBeCloseTo(1.2, 5);
    // 音量包絡（最後一個 gain）接到 master，峰値 > 0
    const envelope = fake.gains[fake.gains.length - 1];
    expect(envelope.outputs).toContain(master);
    expect(envelope.gain.peak).toBeGreaterThan(0);
    // 0.5 秒的嘶聲（source 在同一個時間點停止）
    expect(fake.bufferSources[0].stopCalls[0].when).toBeCloseTo(0.5, 5);
  });

  it('the creeper hiss is silent beyond the audible distance', () => {
    const { fake, audio } = setup();
    audio.ensureStarted();
    audio.playCreeperHiss({
      pos: { x: 40, y: 0, z: 0 },
      listener: { x: 0, y: 0, z: 0 },
    });
    const envelope = fake.gains[fake.gains.length - 1];
    expect(envelope.gain.peak).toBe(0);
    expect(envelope.outputs).toContain(fake.gains[0]);
  });

  it('before start: playCreeperHiss stays inert (no nodes)', () => {
    const { fake, audio } = setup();
    audio.playCreeperHiss();
    expect(fake.created).toHaveLength(0);
  });

  // ---- B10 Task 9：弓與箭的音效（加分項）----
  it('playBowShoot synthesises one band-passed whoosh through the master bus', () => {
    const { fake, audio } = setup();
    audio.ensureStarted();
    const master = fake.gains[0];

    audio.playBowShoot();

    expect(fake.bufferSources).toHaveLength(1);
    const filter = fake.biquads.find((b) => b.type === 'bandpass');
    expect(filter).toBeTruthy();
    const envelope = fake.gains[fake.gains.length - 1];
    expect(envelope.outputs).toContain(master);
    expect(envelope.gain.peak).toBeGreaterThan(0);
  });

  it('playArrowHit synthesises a wood knock (low-passed noise + short sine)', () => {
    const { fake, audio } = setup();
    audio.ensureStarted();
    const master = fake.gains[0];

    audio.playArrowHit();

    expect(fake.bufferSources).toHaveLength(1);
    const filter = fake.biquads.find((b) => b.type === 'lowpass');
    expect(filter).toBeTruthy();
    expect(fake.oscillators).toHaveLength(1); // 短振盪（木頭「咚」的音高）
    const envelope = fake.gains[fake.gains.length - 1];
    expect(envelope.outputs).toContain(master);
    expect(envelope.gain.peak).toBeGreaterThan(0);
  });

  it('the bow/arrow sounds are silent beyond the audible distance and inert before start', () => {
    const far = { pos: { x: 40, y: 0, z: 0 }, listener: { x: 0, y: 0, z: 0 } };
    const { fake, audio } = setup();
    audio.ensureStarted();
    audio.playBowShoot(far);
    audio.playArrowHit(far);
    for (const g of fake.gains.slice(1)) expect(g.gain.peak).toBe(0);

    const fresh = new FakeAudioContext();
    const inert = createGameAudio({ createContext: () => fresh as unknown as AudioContext });
    inert.playBowShoot();
    inert.playArrowHit();
    expect(fresh.created).toHaveLength(0);
  });

  // ---- B11 Task 5：TNT 嘶聲與爆炸聲 ----
  it('playTntFuse synthesises one band-passed fizz through the master bus', () => {
    const { fake, audio } = setup();
    audio.ensureStarted();
    const master = fake.gains[0];

    audio.playTntFuse();

    expect(fake.bufferSources).toHaveLength(1);
    const filter = fake.biquads.find((b) => b.type === 'bandpass');
    expect(filter).toBeTruthy();
    expect(filter!.frequency.value).toBeCloseTo(1100, 5);
    const envelope = fake.gains[fake.gains.length - 1];
    expect(envelope.outputs).toContain(master);
    expect(envelope.gain.peak).toBeGreaterThan(0);
    expect(fake.bufferSources[0].stopCalls[0].when).toBeCloseTo(0.6, 5); // 0.6 秒的嘶聲
  });

  it('playExplosion synthesises a low-passed boom with a sub-bass tone', () => {
    const { fake, audio } = setup();
    audio.ensureStarted();
    const master = fake.gains[0];

    audio.playExplosion();

    expect(fake.bufferSources).toHaveLength(1);
    const filter = fake.biquads.find((b) => b.type === 'lowpass');
    expect(filter).toBeTruthy();
    expect(filter!.frequency.value).toBeCloseTo(220, 5);
    expect(fake.oscillators).toHaveLength(1); // 低頻「砰」的音高
    const envelope = fake.gains[fake.gains.length - 1];
    expect(envelope.outputs).toContain(master);
    expect(envelope.gain.peak).toBeGreaterThan(0);
  });

  it('the explosion layers stay below clipping when summed (noise + sub-bass)', () => {
    // 批末審查：噪音與低頻正弦兩層若都到 1.0，疊加會硬切（> master 1.0）。
    const { fake, audio } = setup();
    audio.ensureStarted();
    audio.playExplosion();
    const peaks = fake.gains.slice(1).map((g) => g.gain.peak);
    expect(peaks).toHaveLength(2);
    const sum = peaks.reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(1.25); // 預設 master 0.8 → 疊加 ≤ 1.0，不硬切
  });

  it('the tnt sounds are silent beyond the audible distance and inert before start', () => {
    const far = { pos: { x: 40, y: 0, z: 0 }, listener: { x: 0, y: 0, z: 0 } };
    const { fake, audio } = setup();
    audio.ensureStarted();
    audio.playTntFuse(far);
    audio.playExplosion(far);
    for (const g of fake.gains.slice(1)) expect(g.gain.peak).toBe(0);

    const fresh = new FakeAudioContext();
    const inert = createGameAudio({ createContext: () => fresh as unknown as AudioContext });
    inert.playTntFuse();
    inert.playExplosion();
    expect(fresh.created).toHaveLength(0);
  });

  // ---- B14：釣魚的潑水聲與魚訊聲 ----
  it('playFishingSplash and playFishingBite route through the master bus', () => {
    const { fake, audio } = setup();
    audio.ensureStarted();
    const master = fake.gains[0];

    audio.playFishingSplash();
    audio.playFishingBite();

    expect(fake.bufferSources).toHaveLength(1);
    expect(fake.oscillators).toHaveLength(1);
    for (const g of fake.gains.slice(1)) expect(g.outputs).toContain(master);
  });

  it('the fishing sounds are silent beyond the audible distance and inert before start', () => {
    const far = { pos: { x: 40, y: 0, z: 0 }, listener: { x: 0, y: 0, z: 0 } };
    const { fake, audio } = setup();
    audio.ensureStarted();
    audio.playFishingSplash(far);
    audio.playFishingBite(far);
    for (const g of fake.gains.slice(1)) expect(g.gain.peak).toBe(0);

    const fresh = new FakeAudioContext();
    const inert = createGameAudio({ createContext: () => fresh as unknown as AudioContext });
    inert.playFishingSplash();
    inert.playFishingBite();
    expect(fresh.created).toHaveLength(0);
  });

  it('handleVisibility suspends when hidden and resumes when visible', () => {
    const { fake, audio } = setup();
    audio.ensureStarted(); // initial suspended state → resume
    expect(fake.state).toBe('running');
    expect(fake.resumeCalls).toBe(1);

    audio.handleVisibility(true);
    expect(fake.state).toBe('suspended');
    expect(fake.suspendCalls).toBe(1);

    audio.handleVisibility(false);
    expect(fake.state).toBe('running');
    expect(fake.resumeCalls).toBe(2);
  });

  it('ambience: wind + recursive scheduling (day chirp / night cricket), setPhase cue, idempotent stop/dispose', () => {
    vi.useFakeTimers();
    const { fake, audio } = setup();
    audio.ensureStarted();
    const master = fake.gains[0];

    audio.startAmbience();
    audio.startAmbience(); // idempotent — no second wind
    expect(fake.bufferSources).toHaveLength(1);
    const wind = fake.bufferSources[0];
    expect(wind.loop).toBe(true);
    expect(fake.biquads[0].type).toBe('lowpass');
    expect(fake.gains[1].gain.value).toBeCloseTo(0.04);
    expect(fake.gains[1].outputs).toContain(master);

    // day: the first chirp only lands after 4–9 s
    vi.advanceTimersByTime(3_999);
    expect(fake.oscillators).toHaveLength(0);
    vi.advanceTimersByTime(9_000 - 3_999);
    expect(fake.oscillators.length).toBeGreaterThanOrEqual(1);

    // setPhase('night'): one phaseCue (bandpass 200→800) + reschedule
    const sourcesBeforeCue = fake.bufferSources.length;
    audio.setPhase('night');
    expect(fake.bufferSources).toHaveLength(sourcesBeforeCue + 1);
    const cue = fake.biquads.at(-1)!;
    expect(cue.type).toBe('bandpass');
    expect(cue.frequency.sets[0].value).toBe(200);
    expect(cue.frequency.ramps[0].value).toBe(800);

    // night crickets arrive within 3–7 s
    const sourcesBeforeCricket = fake.bufferSources.length;
    vi.advanceTimersByTime(7_000);
    expect(fake.bufferSources.length).toBeGreaterThan(sourcesBeforeCricket);

    // stop is idempotent, stops the wind and clears the recursive timer
    const sourcesAtStop = fake.bufferSources.length;
    const oscillatorsAtStop = fake.oscillators.length;
    audio.stopAmbience();
    audio.stopAmbience();
    expect(wind.stopCalls).toHaveLength(1);
    vi.advanceTimersByTime(60_000);
    expect(fake.bufferSources).toHaveLength(sourcesAtStop);
    expect(fake.oscillators).toHaveLength(oscillatorsAtStop);

    audio.dispose();
    audio.dispose(); // idempotent
    expect(fake.closeCalls).toBe(1);
  });

  it("throttles rapid 'break' plays to one per 80 ms (Task 14 T10 ruling: creative instant-break machine-gun guard)", () => {
    let t = 1000;
    const fake = new FakeAudioContext();
    const audio = createGameAudio({
      createContext: () => fake as unknown as AudioContext,
      now: () => t,
    });
    audio.ensureStarted();

    audio.play('break', 'stone', { pos: { x: 0, y: 0, z: 0 } });
    audio.play('break', 'stone', { pos: { x: 0, y: 0, z: 0 } });
    audio.play('break', 'stone', { pos: { x: 0, y: 0, z: 0 } });
    expect(fake.bufferSources).toHaveLength(1); // two swallowed inside the window

    t += 79;
    audio.play('break', 'stone', { pos: { x: 0, y: 0, z: 0 } });
    expect(fake.bufferSources).toHaveLength(1); // still inside the window

    t += 1;
    audio.play('break', 'stone', { pos: { x: 0, y: 0, z: 0 } });
    expect(fake.bufferSources).toHaveLength(2); // window elapsed → plays again

    // other kinds are never throttled, even back-to-back
    audio.play('dig', 'stone');
    audio.play('dig', 'stone');
    audio.play('place', 'stone');
    expect(fake.bufferSources).toHaveLength(5);
    audio.dispose();
  });
});

describe('createGameAudio play records (B4 triage ⑧: played() ring, capacity 64)', () => {
  it('records every play call in order (kind + group) even before the engine starts — inert, no AudioContext', () => {
    const { fake, audio } = setup();

    // Never started: recording must not touch the lazy engine (B4 ⑧'s whole
    // point — jsdom tests can ask "what was just played" with no audio stack).
    audio.play('dig', 'stone');
    audio.play('place', 'grass');

    const played = audio.played();
    expect(played).toHaveLength(2);
    expect(played[0]).toEqual({ kind: 'dig', group: 'stone' });
    expect(played[1]).toEqual({ kind: 'place', group: 'grass' });
    expect(fake.created).toHaveLength(0); // not a single node was created
    audio.dispose(); // never started → nothing to close (unchanged laziness)
    expect(fake.closeCalls).toBe(0);
  });

  it("records a private copy of pos when present and omits the field entirely when it isn't", () => {
    const { audio } = setup();

    const pos = { x: 1, y: 2, z: 3 };
    audio.play('step', 'grass', { pos });
    pos.x = 99; // the caller mutating its pos afterwards must not rewrite history
    pos.y = 99;
    pos.z = 99;
    const [withPos] = audio.played();
    expect(withPos.pos).toEqual({ x: 1, y: 2, z: 3 });

    audio.play('dig', 'stone'); // no pos → the field does not exist at all
    const [, noPos] = audio.played();
    expect('pos' in noPos).toBe(false);
    expect(noPos.pos).toBeUndefined();
  });

  it('keeps only the newest 64 records — 70 plays evict the 6 oldest', () => {
    const { audio } = setup();

    for (let i = 0; i < 70; i++) {
      audio.play('step', 'stone', { pos: { x: i, y: 0, z: 0 } });
    }

    const played = audio.played();
    expect(played).toHaveLength(64); // ring cap, not 70
    // The 6 oldest (x = 0..5) were shifted out → the first survivor is #7 (x = 6).
    expect(played[0].pos).toEqual({ x: 6, y: 0, z: 0 });
    expect(played[63].pos).toEqual({ x: 69, y: 0, z: 0 });
    expect(played[63].kind).toBe('step');
  });
});

// ---- B15：天氣音效生命週期 ----
describe('createGameAudio weather (B15)', () => {
  it('setWeather before the first gesture never creates a context; ensureStarted starts the rain bed', () => {
    const { fake, audio } = setup();

    audio.setWeather('rain');
    expect(fake.created).toHaveLength(0);

    audio.ensureStarted();
    expect(fake.bufferSources).toHaveLength(1);
    const rain = fake.bufferSources[0];
    expect(rain.loop).toBe(true);
    expect(fake.biquads[0].frequency.value).toBe(3000);

    // idempotent: a second rain request must not stack a second loop
    audio.setWeather('rain');
    expect(fake.bufferSources).toHaveLength(1);

    audio.setWeather('clear');
    expect(rain.stopCalls).toHaveLength(1);

    audio.setWeather('rain');
    expect(fake.bufferSources).toHaveLength(2);
    audio.stopAmbience();
    expect(fake.bufferSources[1].stopCalls).toHaveLength(1);

    audio.dispose();
  });

  it('stopAmbience stops the rain bed but keeps the desired weather for the next start', () => {
    const { fake, audio } = setup();
    audio.ensureStarted();
    audio.setWeather('thunder');
    const first = fake.bufferSources[0];
    audio.stopAmbience();
    expect(first.stopCalls).toHaveLength(1);

    audio.startAmbience();
    // source 0 = the first rain bed, 1 = wind, 2 = the re-armed rain bed
    expect(fake.bufferSources).toHaveLength(3);
    expect(fake.bufferSources[2].loop).toBe(true);
    audio.dispose();
  });

  it('playThunder routes through the master bus and obeys distance attenuation', () => {
    const { fake, audio } = setup();
    audio.ensureStarted();
    const master = fake.gains[0];

    audio.playThunder();
    const near = fake.gains.at(-1)!;
    expect(near.outputs).toContain(master);
    expect(near.gain.peak).toBeGreaterThan(0);

    audio.playThunder({ pos: { x: 40, y: 0, z: 0 }, listener: { x: 0, y: 0, z: 0 } });
    const far = fake.gains.at(-1)!;
    expect(far.outputs).toContain(master);
    expect(far.gain.peak).toBe(0);

    audio.dispose();
  });

  it('playThunder before the engine starts stays inert', () => {
    const { fake, audio } = setup();
    audio.playThunder();
    expect(fake.created).toHaveLength(0);
    audio.dispose();
  });

  // ---- B17：經驗球吸收聲 ----
  it('playXpPickup routes through the master bus and is inert before start', () => {
    const { fake, audio } = setup();
    audio.playXpPickup(); // 引擎未啟動 → 惰性（不建 AudioContext、不建任何節點）
    expect(fake.created).toHaveLength(0);
    audio.dispose();

    audio.ensureStarted();
    const master = fake.gains[0];
    audio.playXpPickup();
    expect(fake.oscillators).toHaveLength(1); // 單一正弦，無噪音層
    const envelope = fake.gains[fake.gains.length - 1];
    expect(envelope.outputs).toContain(master);
    expect(envelope.gain.peak).toBeGreaterThan(0);

    // 距離衰減與其他音效同一條 gainForDistance：可聽距離外峰值 0
    audio.playXpPickup({ pos: { x: 40, y: 0, z: 0 }, listener: { x: 0, y: 0, z: 0 } });
    expect(fake.gains[fake.gains.length - 1].gain.peak).toBe(0);
    audio.dispose();
  });
});
