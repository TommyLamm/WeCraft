import { describe, it, expect } from 'vitest';
import { FakeAudioBuffer, FakeAudioContext } from './testing';
import type { SynthParams } from './sounds';
import { chirp, createNoiseBuffer, cricket, phaseCue, playOneShot, startWind } from './voices';

const asCtx = (fake: FakeAudioContext): BaseAudioContext => fake as unknown as BaseAudioContext;
const asNode = (node: unknown): AudioNode => node as AudioNode;
const asBuffer = (buffer: FakeAudioBuffer): AudioBuffer => buffer as unknown as AudioBuffer;

describe('voices', () => {
  it('createNoiseBuffer builds one second of mono white noise at the context sample rate', () => {
    const fake = new FakeAudioContext();
    const buffer = createNoiseBuffer(asCtx(fake));

    expect(fake.buffers).toHaveLength(1);
    expect(buffer.length).toBe(fake.sampleRate);
    expect(buffer.numberOfChannels).toBe(1);
    expect(buffer.sampleRate).toBe(fake.sampleRate);

    const data = buffer.getChannelData(0);
    expect(data).toBeInstanceOf(Float32Array);
    expect(data).toHaveLength(fake.sampleRate);
    let max = 0;
    for (const sample of data) max = Math.max(max, Math.abs(sample));
    expect(max).toBeGreaterThan(0); // actually noise, not silence
    expect(max).toBeLessThanOrEqual(1);
  });

  it('playOneShot wires source → biquad(filter) → gain(envelope) → dest and schedules start/stop', () => {
    const fake = new FakeAudioContext();
    fake.currentTime = 5;
    const dest = fake.destination;
    const noise = new FakeAudioBuffer(1, fake.sampleRate, fake.sampleRate);
    const params: SynthParams = {
      filter: 'bandpass',
      freq: 1100,
      q: 1.2,
      durationSec: 0.12,
      gain: 0.5,
    };

    playOneShot(asCtx(fake), asNode(dest), params, 0.4, asBuffer(noise));

    const source = fake.bufferSources[0];
    const filter = fake.biquads[0];
    const gain = fake.gains[0];
    expect(source.buffer).toBe(noise);
    expect(filter.type).toBe('bandpass');
    expect(filter.frequency.value).toBe(1100);
    expect(filter.Q.value).toBe(1.2);
    expect(source.outputs).toContain(filter);
    expect(filter.outputs).toContain(gain);
    expect(gain.outputs).toContain(dest);

    expect(source.startCalls).toHaveLength(1);
    expect(source.stopCalls).toHaveLength(1);
    expect(source.stopCalls[0].when).toBeCloseTo(5 + 0.12 + 0.05);

    // 5 ms attack → plateau at volume × params.gain → 50 ms release after durationSec
    expect(gain.gain.sets[0].value).toBe(0);
    expect(gain.gain.sets[0].time).toBeCloseTo(5);
    expect(gain.gain.ramps[0].value).toBeCloseTo(0.2);
    expect(gain.gain.ramps[0].time).toBeCloseTo(5.005);
    expect(gain.gain.sets[1].value).toBeCloseTo(0.2);
    expect(gain.gain.sets[1].time).toBeCloseTo(5.12);
    expect(gain.gain.ramps[1].value).toBe(0);
    expect(gain.gain.ramps[1].time).toBeCloseTo(5.17);
  });

  it('startWind loops noise through lowpass 300 at gain 0.04; stop() stops the source and is idempotent', () => {
    const fake = new FakeAudioContext();
    const dest = fake.destination;
    const noise = new FakeAudioBuffer(1, fake.sampleRate, fake.sampleRate);

    const wind = startWind(asCtx(fake), asNode(dest), asBuffer(noise));

    const source = fake.bufferSources[0];
    const filter = fake.biquads[0];
    const gain = fake.gains[0];
    expect(source.buffer).toBe(noise);
    expect(source.loop).toBe(true);
    expect(filter.type).toBe('lowpass');
    expect(filter.frequency.value).toBe(300);
    expect(gain.gain.value).toBeCloseTo(0.04);
    expect(source.startCalls).toHaveLength(1);
    expect(source.stopCalls).toHaveLength(0);
    expect(source.outputs).toContain(filter);
    expect(filter.outputs).toContain(gain);
    expect(gain.outputs).toContain(dest);

    wind.stop();
    wind.stop(); // idempotent
    expect(source.stopCalls).toHaveLength(1);
  });

  it('chirp sweeps a sine 1800→2600 Hz over 0.15 s; cricket/phaseCue are the night ambience bursts', () => {
    const fake = new FakeAudioContext();
    const dest = fake.destination;
    const noise = new FakeAudioBuffer(1, fake.sampleRate, fake.sampleRate);
    const ctx = asCtx(fake);

    chirp(ctx, asNode(dest));
    const osc = fake.oscillators[0];
    expect(osc.type).toBe('sine');
    expect(osc.frequency.sets[0]).toEqual({ value: 1800, time: 0 });
    expect(osc.frequency.ramps[0].value).toBe(2600);
    expect(osc.frequency.ramps[0].time).toBeCloseTo(0.15);
    expect(osc.startCalls).toHaveLength(1);
    expect(osc.stopCalls[0].when).toBeCloseTo(0.15);
    const chirpGain = fake.gains[0];
    expect(chirpGain.gain.ramps.at(-1)!.value).toBe(0); // envelope closes again
    expect(chirpGain.outputs).toContain(dest);

    cricket(ctx, asNode(dest), asBuffer(noise));
    const cricketSource = fake.bufferSources[0];
    expect(cricketSource.buffer).toBe(noise);
    expect(fake.biquads[0].type).toBe('highpass');
    expect(fake.biquads[0].frequency.value).toBe(4000);
    expect(cricketSource.startCalls).toHaveLength(1);
    expect(cricketSource.stopCalls[0].when).toBeCloseTo(0.08);

    phaseCue(ctx, asNode(dest), asBuffer(noise));
    const cueSource = fake.bufferSources[1];
    const cueFilter = fake.biquads[1];
    expect(cueFilter.type).toBe('bandpass');
    expect(cueFilter.frequency.sets[0].value).toBe(200);
    expect(cueFilter.frequency.ramps[0].value).toBe(800);
    expect(cueFilter.frequency.ramps[0].time).toBeCloseTo(0.8);
    expect(cueSource.startCalls).toHaveLength(1);
    expect(cueSource.stopCalls[0].when).toBeCloseTo(0.8);
  });
});
