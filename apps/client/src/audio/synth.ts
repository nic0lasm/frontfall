import type { Cue } from "./cues.ts";

/** C5, E5, G5 and C6 in hertz. */
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;

/** One soft note: a short attack and an exponential fade, so nothing clicks. */
function note(
  ctx: AudioContext,
  out: AudioNode,
  at: number,
  type: OscillatorType,
  from: number,
  to: number,
  seconds: number,
  level: number,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + seconds);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(level, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + seconds + 0.02);
}

/** A burst of filtered noise that falls in pitch, for the missile. */
function whoosh(ctx: AudioContext, out: AudioNode, at: number): void {
  const seconds = 0.6;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(1400, at);
  filter.frequency.exponentialRampToValueAtTime(300, at + seconds);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.5, at + 0.08);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  source.connect(filter).connect(gain).connect(out);
  source.start(at);
}

/** Plays one cue on `out` from `at` (seconds on the context's clock). */
export function play(ctx: AudioContext, out: AudioNode, cue: Cue, at: number): void {
  switch (cue) {
    case "attack":
      note(ctx, out, at, "sawtooth", 200, 110, 0.14, 0.18);
      break;
    case "conquest":
      note(ctx, out, at, "sine", C5, C5, 0.14, 0.3);
      note(ctx, out, at + 0.1, "sine", E5, E5, 0.2, 0.3);
      break;
    case "build":
      note(ctx, out, at, "square", 420, 380, 0.05, 0.12);
      note(ctx, out, at + 0.08, "square", 640, 600, 0.07, 0.12);
      break;
    case "missile":
      whoosh(ctx, out, at);
      break;
    case "alliance":
      note(ctx, out, at, "sine", C5, C5, 0.5, 0.22);
      note(ctx, out, at, "sine", E5, E5, 0.5, 0.22);
      note(ctx, out, at, "sine", G5, G5, 0.5, 0.22);
      break;
    case "victory":
      [C5, E5, G5, C6].forEach((hz, i) => {
        note(ctx, out, at + i * 0.13, "triangle", hz, hz, 0.35, 0.3);
      });
      break;
    case "defeat":
      [220, 174.6, 146.8].forEach((hz, i) => {
        note(ctx, out, at + i * 0.22, "triangle", hz, hz * 0.97, 0.4, 0.3);
      });
      break;
  }
}
