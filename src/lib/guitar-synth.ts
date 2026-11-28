/** Karplus-Strong pluck with a short body resonance. Cached per note. */

const cache = new Map<string, AudioBuffer>();

function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function renderPluck(ctx: AudioContext, freq: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const seconds = 2.6;
  const period = Math.max(8, Math.round(sr / freq));
  const len = Math.floor(sr * seconds);
  const buffer = ctx.createBuffer(1, len, sr);
  const data = buffer.getChannelData(0);
  const ring = new Float32Array(period);
  for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
  let idx = 0;
  let prev = 0;
  const loss = 0.9962 - Math.min(0.012, freq / 12000);
  for (let i = 0; i < len; i++) {
    const y = (ring[idx]! + prev) * 0.5 * loss;
    prev = ring[idx]!;
    ring[idx] = y;
    data[i] = y;
    idx = (idx + 1) % period;
  }
  let peak = 0.0001;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(data[i]!));
  const gain = 0.9 / peak;
  for (let i = 0; i < 80; i++) data[i] = data[i]! * (i / 80) * gain;
  for (let i = 80; i < len; i++) data[i] = data[i]! * gain;
  return buffer;
}

export function playPluck(ctx: AudioContext, dest: AudioNode, midi: number, velocity: number) {
  const key = `${ctx.sampleRate}:${midi}`;
  let buffer = cache.get(key);
  if (!buffer) {
    buffer = renderPluck(ctx, midiToFreq(midi));
    cache.set(key, buffer);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const amp = ctx.createGain();
  const t = ctx.currentTime;
  const level = 0.55 + velocity * 0.4;
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(level, t + 0.004);
  amp.gain.exponentialRampToValueAtTime(level * 0.4, t + 0.12);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
  src.connect(amp);
  amp.connect(dest);
  src.start(t);
  src.stop(t + 2);

  const pick = ctx.createOscillator();
  pick.type = "triangle";
  pick.frequency.setValueAtTime(midiToFreq(midi), t);
  const pickGain = ctx.createGain();
  pickGain.gain.setValueAtTime(0.0001, t);
  pickGain.gain.exponentialRampToValueAtTime(0.28 + velocity * 0.22, t + 0.004);
  pickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  pick.connect(pickGain);
  pickGain.connect(dest);
  pick.start(t);
  pick.stop(t + 0.4);
}
