import { shuffle, XorShift32 } from "../rng.ts";
import type { MathSkin, MemorySkin, SortSkin } from "./types.ts";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

// ── 분류 ──
export const SORT_SECONDS = 40;
export const SORT_TARGET = 18;
export function makeSortQueue(skin: SortSkin, seed: string, count = 40): SortSkin["items"] {
  const rng = new XorShift32(`sort:${seed}`);
  return Array.from({ length: count }, () => skin.items[rng.int(skin.items.length)] as SortSkin["items"][number]);
}
export function sortPerformance(correct: number, wrong: number): number { return clamp01((correct - wrong) / SORT_TARGET); }

// ── 기억 ──
export const MEMORY_ROUNDS = [3, 4, 5, 6] as const;
export const MEMORY_SHOW_MS = 2_600;
export const MEMORY_CHOICES = 9;
export interface MemoryRound { order: number[]; choices: number[]; }
export function makeMemoryRounds(skin: MemorySkin, seed: string): MemoryRound[] {
  const rng = new XorShift32(`memory:${seed}`);
  const indexes = skin.items.map((_, index) => index);
  return MEMORY_ROUNDS.map((size) => {
    const choices = shuffle(indexes, rng).slice(0, Math.max(size, MEMORY_CHOICES));
    return { order: shuffle(choices, rng).slice(0, size), choices };
  });
}
/** Correct picks count; wrong picks cost one each. */
export function memoryPerformance(correct: number, wrong: number): number {
  const total = MEMORY_ROUNDS.reduce((sum, size) => sum + size, 0);
  return clamp01((correct - wrong) / total);
}

// ── 빠른 셈 ──
export const MATH_SECONDS = 45;
export const MATH_TARGET = 12;
export interface MathQuestion { prompt: string; answer: number; choices: number[]; }
export function makeMathQuestions(skin: MathSkin, seed: string, count = 30): MathQuestion[] {
  const rng = new XorShift32(`math:${seed}`);
  return Array.from({ length: count }, (_, index) => {
    const level = Math.min(3, Math.floor(index / 5));
    const kind = rng.int(3);
    let a: number, b: number, answer: number, templates: string[];
    if (kind === 0) { a = 10 + rng.int(40 + level * 60); b = 5 + rng.int(30 + level * 40); answer = a + b; templates = skin.add; }
    else if (kind === 1) { a = 40 + rng.int(60 + level * 80); b = 5 + rng.int(a - 10); answer = a - b; templates = skin.sub; }
    else { a = 2 + rng.int(7 + level * 2); b = 3 + rng.int(7 + level); answer = a * b; templates = skin.mul; }
    const template = templates[rng.int(templates.length)] ?? "{a} ? {b}";
    const offsets = shuffle([-10, -2, -1, 1, 2, 10, 5, -5], rng).slice(0, 3);
    const choices = shuffle([answer, ...offsets.map((offset) => Math.max(0, answer + offset))], rng);
    return { prompt: template.replaceAll("{a}", String(a)).replaceAll("{b}", String(b)), answer, choices: [...new Set(choices)] };
  });
}
export function mathPerformance(correct: number, wrong: number): number { return clamp01((correct - wrong * 0.5) / MATH_TARGET); }

// ── 타이밍 ──
export const TIMING_ATTEMPTS = 8;
export interface TimingRound { /** Full sweeps per second. */ speed: number; /** Half-width of the mark, 0..0.5 of the track. */ zone: number; center: number; }
export function makeTimingRounds(seed: string): TimingRound[] {
  const rng = new XorShift32(`timing:${seed}`);
  return Array.from({ length: TIMING_ATTEMPTS }, (_, index) => ({ speed: 0.55 + index * 0.08 + rng.next() * 0.1, zone: Math.max(0.05, 0.12 - index * 0.008), center: 0.25 + rng.next() * 0.5 }));
}
/** Needle position 0..1 at `elapsedMs` (ping-pong sweep). */
export function needleAt(round: TimingRound, elapsedMs: number): number {
  const phase = ((elapsedMs / 1000) * round.speed) % 2;
  return phase <= 1 ? phase : 2 - phase;
}
/** 1 at the centre, 0 at the edge of the mark or outside. */
export function timingAccuracy(round: TimingRound, position: number): number { return clamp01(1 - Math.abs(position - round.center) / round.zone); }
export function timingPerformance(accuracies: readonly number[]): number {
  if (accuracies.length === 0) return 0;
  return clamp01(accuracies.reduce((sum, value) => sum + Math.min(1, value * 1.25), 0) / TIMING_ATTEMPTS);
}
