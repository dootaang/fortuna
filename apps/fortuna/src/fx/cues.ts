import { haptic } from "./settings.ts";

/** Named moments in play. Each maps to a vibration (Android) and, later, a sound. */
export type Cue =
  | "tap" | "chip" | "card" | "flip" | "dice" | "shake" | "land" | "tick" | "drum"
  | "win" | "bigWin" | "lose" | "push" | "caught" | "correct" | "wrong" | "perfect" | "combo" | "spin" | "ball";

const VIBRATION: Partial<Record<Cue, number | number[]>> = {
  tap: 8, chip: 12, land: 18, correct: 10, wrong: [30, 40, 30], perfect: [12, 30, 24], win: [20, 40, 60], bigWin: [30, 50, 30, 50, 90], lose: 60, caught: [80, 60, 120],
};

let player: ((cue: Cue, intensity: number) => void) | null = null;

/** Installed by the sound module once loaded. */
export function setCuePlayer(play: (cue: Cue, intensity: number) => void): void { player = play; }

const lastPlayed = new Map<Cue, number>();

export function cue(name: Cue, intensity = 0): void {
  // Several dice landing together should sound like one thud, not a stack.
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -Infinity) < 60) return;
  lastPlayed.set(name, now);
  const pattern = VIBRATION[name];
  if (pattern !== undefined) haptic(pattern);
  player?.(name, intensity);
}
