/** Test doubles for the Web Audio API — jsdom ships no AudioContext, so every
 *  audio test injects these through `AudioEngineDeps.createContext` or calls
 *  the `voices` entry points with them. Only test files import this module, so
 *  it never reaches the production bundle.
 *
 *  Every node records the calls the voices make (property writes, connects,
 *  start/stop schedules) so tests can assert the exact graph and envelope. */

export interface FakeParamEvent {
  value: number;
  time: number;
}

/** Records `AudioParam` writes and automation calls. `value` reflects direct
 *  `param.value = x` writes only; scheduled values live in `sets`/`ramps`. */
export class FakeAudioParam {
  /** Every `param.value = x` write, in order. */
  readonly valueWrites: number[] = [];
  /** Every `setValueAtTime(value, time)` call. */
  readonly sets: FakeParamEvent[] = [];
  /** Every `linearRampToValueAtTime(value, time)` call. */
  readonly ramps: FakeParamEvent[] = [];
  private current = 0;

  get value(): number {
    return this.current;
  }

  set value(v: number) {
    this.current = v;
    this.valueWrites.push(v);
  }

  setValueAtTime(value: number, time: number): FakeAudioParam {
    this.sets.push({ value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): FakeAudioParam {
    this.ramps.push({ value, time });
    return this;
  }

  /** Highest magnitude ever written or scheduled (envelope peak). */
  get peak(): number {
    return Math.max(
      0,
      ...this.valueWrites,
      ...this.sets.map((e) => e.value),
      ...this.ramps.map((e) => e.value),
    );
  }
}

/** Base node: `outputs` is the connect() graph, in connection order. */
export class FakeAudioNode {
  /** Nodes this node feeds. */
  readonly outputs: FakeAudioNode[] = [];
  disconnectCalls = 0;

  constructor(readonly kind: string) {}

  connect(target: FakeAudioNode): FakeAudioNode {
    this.outputs.push(target);
    return target;
  }

  disconnect(): void {
    this.disconnectCalls++;
    this.outputs.length = 0;
  }
}

export class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam();

  constructor() {
    super('gain');
  }
}

export class FakeBiquadFilterNode extends FakeAudioNode {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new FakeAudioParam();
  readonly Q = new FakeAudioParam();

  constructor() {
    super('biquad');
  }
}

export interface FakeStartCall {
  when?: number;
  offset?: number;
  duration?: number;
}

export interface FakeStopCall {
  when?: number;
}

export class FakeAudioBufferSourceNode extends FakeAudioNode {
  buffer: FakeAudioBuffer | null = null;
  loop = false;
  readonly startCalls: FakeStartCall[] = [];
  readonly stopCalls: FakeStopCall[] = [];

  constructor() {
    super('bufferSource');
  }

  start(when?: number, offset?: number, duration?: number): void {
    this.startCalls.push({ when, offset, duration });
  }

  stop(when?: number): void {
    this.stopCalls.push({ when });
  }
}

export class FakeOscillatorNode extends FakeAudioNode {
  type: OscillatorType = 'sine';
  readonly frequency = new FakeAudioParam();
  readonly startCalls: FakeStartCall[] = [];
  readonly stopCalls: FakeStopCall[] = [];

  constructor() {
    super('oscillator');
  }

  start(when?: number): void {
    this.startCalls.push({ when });
  }

  stop(when?: number): void {
    this.stopCalls.push({ when });
  }
}

export class FakeAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly duration: number;
  private readonly channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel];
    if (!data) throw new RangeError(`FakeAudioBuffer has no channel ${channel}`);
    return data;
  }
}

export class FakeAudioContext {
  state: AudioContextState = 'suspended';
  readonly sampleRate = 44100;
  currentTime = 0;
  readonly destination = new FakeAudioNode('destination');
  /** Every node created through this context, in creation order. */
  readonly created: FakeAudioNode[] = [];
  readonly gains: FakeGainNode[] = [];
  readonly biquads: FakeBiquadFilterNode[] = [];
  readonly bufferSources: FakeAudioBufferSourceNode[] = [];
  readonly oscillators: FakeOscillatorNode[] = [];
  readonly buffers: FakeAudioBuffer[] = [];
  resumeCalls = 0;
  suspendCalls = 0;
  closeCalls = 0;
  /** Flip to make the matching promise reject — for failure-swallow tests. */
  resumeFails = false;
  suspendFails = false;
  closeFails = false;

  private track<T extends FakeAudioNode>(node: T): T {
    this.created.push(node);
    return node;
  }

  createGain(): FakeGainNode {
    const node = this.track(new FakeGainNode());
    this.gains.push(node);
    return node;
  }

  createBiquadFilter(): FakeBiquadFilterNode {
    const node = this.track(new FakeBiquadFilterNode());
    this.biquads.push(node);
    return node;
  }

  createBufferSource(): FakeAudioBufferSourceNode {
    const node = this.track(new FakeAudioBufferSourceNode());
    this.bufferSources.push(node);
    return node;
  }

  createOscillator(): FakeOscillatorNode {
    const node = this.track(new FakeOscillatorNode());
    this.oscillators.push(node);
    return node;
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): FakeAudioBuffer {
    const buffer = new FakeAudioBuffer(numberOfChannels, length, sampleRate);
    this.buffers.push(buffer);
    return buffer;
  }

  resume(): Promise<void> {
    this.resumeCalls++;
    if (this.resumeFails) return Promise.reject(new Error('fake: resume failed'));
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.suspendCalls++;
    if (this.suspendFails) return Promise.reject(new Error('fake: suspend failed'));
    this.state = 'suspended';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCalls++;
    if (this.closeFails) return Promise.reject(new Error('fake: close failed'));
    this.state = 'closed';
    return Promise.resolve();
  }
}
