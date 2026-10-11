import { describe, it, expect } from 'vitest';
import { createAudioEngine } from './engine';
import { FakeAudioContext } from './testing';

const asContext = (fake: FakeAudioContext): AudioContext => fake as unknown as AudioContext;

describe('createAudioEngine', () => {
  it('stays inert until ensureStarted: no context is created (no autoplay)', () => {
    const fake = new FakeAudioContext();
    let created = 0;
    const engine = createAudioEngine({
      createContext: () => {
        created++;
        return asContext(fake);
      },
    });

    expect(engine.started).toBe(false);
    expect(engine.context).toBeNull();
    expect(engine.master).toBeNull();
    expect(created).toBe(0);
    expect(fake.created).toHaveLength(0);
  });

  it('ensureStarted builds ctx + master gain (current volume) → destination, resumes when suspended', () => {
    const fake = new FakeAudioContext();
    const engine = createAudioEngine({ createContext: () => asContext(fake) });

    engine.ensureStarted();

    expect(engine.started).toBe(true);
    expect(engine.context).toBe(fake);
    expect(engine.master).toBe(fake.gains[0]);
    const master = fake.gains[0];
    expect(master.gain.value).toBe(1);
    expect(master.outputs).toContain(fake.destination);
    expect(fake.resumeCalls).toBe(1);
    expect(fake.state).toBe('running');
  });

  it('ensureStarted is idempotent (one ctx/master); dispose closes once and clears state', () => {
    const fake = new FakeAudioContext();
    let created = 0;
    const engine = createAudioEngine({
      createContext: () => {
        created++;
        return asContext(fake);
      },
    });

    engine.ensureStarted();
    const master = engine.master;
    engine.ensureStarted();

    expect(created).toBe(1);
    expect(engine.master).toBe(master);
    expect(fake.gains).toHaveLength(1);

    engine.dispose();
    expect(engine.started).toBe(false);
    expect(engine.context).toBeNull();
    expect(engine.master).toBeNull();
    expect(fake.closeCalls).toBe(1);

    engine.dispose();
    expect(fake.closeCalls).toBe(1);
  });

  it('setVolume clamps to [0,1] and updates the live master gain', () => {
    const fake = new FakeAudioContext();
    const engine = createAudioEngine({ createContext: () => asContext(fake) });
    engine.ensureStarted();

    engine.setVolume(2);
    expect(engine.master!.gain.value).toBe(1);
    engine.setVolume(-1);
    expect(engine.master!.gain.value).toBe(0);
    engine.setVolume(0.35);
    expect(engine.master!.gain.value).toBe(0.35);
  });

  it('remembers a volume set before start and applies it to the master gain', () => {
    const fake = new FakeAudioContext();
    const engine = createAudioEngine({ createContext: () => asContext(fake) });

    engine.setVolume(0.4);
    engine.ensureStarted();

    expect(engine.master!.gain.value).toBe(0.4);
  });

  it('is a permanent no-op without a context constructor; suspend/resume only act once started and swallow failures', () => {
    // jsdom ships no AudioContext and no webkit fallback.
    const bare = createAudioEngine();
    expect(() => {
      bare.ensureStarted();
      bare.setVolume(0.5);
      bare.suspend();
      bare.resume();
      bare.dispose();
    }).not.toThrow();
    expect(bare.started).toBe(false);
    expect(bare.context).toBeNull();

    const fake = new FakeAudioContext();
    fake.resumeFails = true;
    fake.suspendFails = true;
    const engine = createAudioEngine({ createContext: () => asContext(fake) });

    engine.suspend();
    engine.resume();
    expect(fake.suspendCalls).toBe(0);
    expect(fake.resumeCalls).toBe(0);

    expect(() => engine.ensureStarted()).not.toThrow(); // resume rejects → swallowed
    expect(fake.resumeCalls).toBe(1);
    expect(fake.state).toBe('suspended'); // failed resume leaves the state alone

    expect(() => {
      engine.suspend();
      engine.resume();
    }).not.toThrow();
    expect(fake.suspendCalls).toBe(1);
    expect(fake.resumeCalls).toBe(2);
  });
});
