/** Short hammered piano tone built from a few harmonics. */

const noise = new Map<number, AudioBuffer>();

function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  let buffer = noise.get(ctx.sampleRate);
  if (buffer) return buffer;
  const len = Math.floor(ctx.sampleRate * 0.05);
  buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  noise.set(ctx.sampleRate, buffer);
  return buffer;
}

export function playPiano(ctx: AudioContext, dest: AudioNode, midi: number, velocity: number) {
  const t = ctx.currentTime;
  const freq = midiToFreq(midi);
  const master = ctx.createGain();
  const peak = 0.34 + velocity * 0.4;
  master.gain.setValueAtTime(0.0001, t);
  master.gain.exponentialRampToValueAtTime(peak, t + 0.006);
  master.gain.exponentialRampToValueAtTime(peak * 0.32, t + 0.22);
  master.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
  master.connect(dest);

  const partials = [1, 2, 3, 4];
  const levels = [1, 0.42, 0.16, 0.06];
  partials.forEach((n, i) => {
    const osc = ctx.createOscillator();
    osc.type = i === 0 ? "triangle" : "sine";
    osc.frequency.setValueAtTime(freq * n, t);
    const gain = ctx.createGain();
    gain.gain.value = levels[i]!;
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + 1.55);
  });

  const hammer = ctx.createBufferSource();
  hammer.buffer = noiseBuffer(ctx);
  const hammerGain = ctx.createGain();
  hammerGain.gain.value = 0.18 * velocity;
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 1800;
  hammer.connect(filter);
  filter.connect(hammerGain);
  hammerGain.connect(dest);
  hammer.start(t);
  hammer.stop(t + 0.05);
}
