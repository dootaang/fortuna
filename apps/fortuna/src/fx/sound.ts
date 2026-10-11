/**
 * Synthesised casino sounds (no audio files): chips, cards, dice, the roulette
 * ball, a conductor's whistle, win arpeggios. Web Audio only starts after a
 * user gesture, so the context is created on the first tap.
 */
import { setCuePlayer, type Cue } from "./cues.ts";
import { fxSettings } from "./settings.ts";

let context: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
    master = context.createGain();
    master.gain.value = 0.45;
    master.connect(context.destination);
    noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = noise.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  }
  if (context.state === "suspended") void context.resume();
  return context;
}

/** Unlock on the first gesture anywhere (autoplay policy). */
export function installSound(): void {
  const unlock = () => { if (fxSettings().sound) audio(); window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  setCuePlayer(play);
}

interface Tone { freq: number; to?: number; type?: OscillatorType; at?: number; dur: number; gain?: number; }

function tone(ctx: AudioContext, { freq, to, type = "sine", at = 0, dur, gain = 0.4 }: Tone): void {
  const start = ctx.currentTime + at, osc = ctx.createOscillator(), env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, start + dur);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(env).connect(master as GainNode);
  osc.start(start); osc.stop(start + dur + 0.02);
}

interface Hiss { at?: number; dur: number; gain?: number; filter?: BiquadFilterType; freq?: number; to?: number; q?: number; }

function hiss(ctx: AudioContext, { at = 0, dur, gain = 0.3, filter = "bandpass", freq = 2_000, to, q = 1 }: Hiss): void {
  if (!noise) return;
  const start = ctx.currentTime + at, source = ctx.createBufferSource(), band = ctx.createBiquadFilter(), env = ctx.createGain();
  source.buffer = noise;
  band.type = filter; band.Q.value = q;
  band.frequency.setValueAtTime(freq, start);
  if (to) band.frequency.exponentialRampToValueAtTime(to, start + dur);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  source.connect(band).connect(env).connect(master as GainNode);
  source.start(start, Math.random() * 0.5); source.stop(start + dur + 0.02);
}

const click = (ctx: AudioContext, at = 0, gain = 0.25, freq = 3_500) => hiss(ctx, { at, dur: 0.018, gain, filter: "highpass", freq });
/** Pentatonic steps so combos climb pleasantly. */
const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760];

function play(cue: Cue, intensity: number): void {
  if (!fxSettings().sound) return;
  const ctx = audio();
  if (!ctx) return;
  switch (cue) {
    case "tap": click(ctx, 0, 0.12); break;
    case "chip": click(ctx, 0, 0.3, 2_500); click(ctx, 0.045, 0.22, 3_200); tone(ctx, { freq: 2_300, dur: 0.07, gain: 0.06 }); break;
    case "card": hiss(ctx, { dur: 0.14, gain: 0.16, freq: 1_200, to: 4_000, q: 0.7 }); break;
    case "flip": click(ctx, 0, 0.22, 2_000); hiss(ctx, { dur: 0.05, gain: 0.12, freq: 3_000 }); break;
    case "dice": for (let hit = 0; hit < 7; hit += 1) click(ctx, hit * 0.045 + Math.random() * 0.02, 0.2 + Math.random() * 0.1, 1_800 + Math.random() * 1_500); break;
    case "shake": for (let hit = 0; hit < 14; hit += 1) click(ctx, hit * 0.055 + Math.random() * 0.02, 0.14, 1_500 + Math.random() * 1_000); break;
    case "land": tone(ctx, { freq: 140, to: 60, dur: 0.14, gain: 0.35 }); click(ctx, 0, 0.18, 1_500); break;
    case "tick": tone(ctx, { freq: SCALE[Math.min(SCALE.length - 1, intensity)] ?? 660, dur: 0.08, gain: 0.12, type: "triangle" }); break;
    case "drum": {
      const length = 0.45 + Math.min(1, intensity * 0.12);
      for (let at = 0; at < length; at += 0.035) hiss(ctx, { at, dur: 0.04, gain: 0.05 + (at / length) * 0.18, filter: "lowpass", freq: 900 });
      break;
    }
    case "spin": for (let at = 0, gap = 0.06; at < 1.6; at += gap, gap *= 1.04) click(ctx, at, 0.1, 4_000); break;
    case "ball": click(ctx, 0, 0.3, 2_500); click(ctx, 0.11, 0.2, 2_800); click(ctx, 0.19, 0.12, 3_000); break;
    case "correct": tone(ctx, { freq: 880, dur: 0.07, gain: 0.14, type: "triangle" }); break;
    case "combo": tone(ctx, { freq: SCALE[Math.min(SCALE.length - 1, Math.max(0, intensity - 2))] ?? 880, dur: 0.1, gain: 0.16, type: "triangle" }); break;
    case "wrong": tone(ctx, { freq: 150, dur: 0.16, gain: 0.12, type: "square" }); break;
    case "perfect": tone(ctx, { freq: 1_318.5, dur: 0.35, gain: 0.16 }); tone(ctx, { freq: 1_975.5, at: 0.03, dur: 0.35, gain: 0.1 }); break;
    case "win": [523.25, 659.25, 783.99, 1046.5].forEach((freq, step) => tone(ctx, { freq, at: step * 0.08, dur: 0.22, gain: 0.18, type: "triangle" })); break;
    case "bigWin":
      [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98].forEach((freq, step) => tone(ctx, { freq, at: step * 0.07, dur: 0.3, gain: 0.2, type: "triangle" }));
      for (let sparkle = 0; sparkle < 8; sparkle += 1) tone(ctx, { freq: 2_000 + Math.random() * 2_000, at: 0.45 + sparkle * 0.06, dur: 0.12, gain: 0.05 });
      break;
    case "lose": tone(ctx, { freq: 392, to: 294, dur: 0.35, gain: 0.14, type: "triangle" }); tone(ctx, { freq: 294, to: 220, at: 0.18, dur: 0.45, gain: 0.12, type: "triangle" }); break;
    case "push": tone(ctx, { freq: 660, dur: 0.08, gain: 0.1 }); tone(ctx, { freq: 660, at: 0.12, dur: 0.08, gain: 0.1 }); break;
    case "caught":
      for (const at of [0, 0.32]) {
        const start = ctx.currentTime + at, osc = ctx.createOscillator(), lfo = ctx.createOscillator(), depth = ctx.createGain(), env = ctx.createGain();
        osc.type = "square"; osc.frequency.value = 2_100; lfo.frequency.value = 28; depth.gain.value = 120;
        lfo.connect(depth).connect(osc.frequency);
        env.gain.setValueAtTime(0.0001, start); env.gain.exponentialRampToValueAtTime(0.07, start + 0.02); env.gain.exponentialRampToValueAtTime(0.0001, start + 0.26);
        osc.connect(env).connect(master as GainNode);
        osc.start(start); lfo.start(start); osc.stop(start + 0.3); lfo.stop(start + 0.3);
      }
      break;
  }
}
