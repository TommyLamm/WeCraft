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
