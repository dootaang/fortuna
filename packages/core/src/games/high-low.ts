import { DECK, rankValue, type CardId } from "../cards.ts";
import type { XorShift32 } from "../rng.ts";
import { floorCoins, isRecord, type GameDefinition } from "./types.ts";

export interface HighLowParams { multipliers: number[]; }
export interface HighLowState {
  bet: number;
  current: CardId;
  seen: CardId[];
  streak: number;
  last: { card: CardId; guess: "higher" | "lower"; correct: boolean } | null;
  done: boolean;
  payout: number;
}

/** Draw a card not seen yet this game. */
export function drawUnseen(seen: readonly string[], rng: XorShift32): CardId {
  const pool = DECK.filter((entry) => !seen.includes(entry.id));
  const picked = pool[rng.int(pool.length)];
  if (!picked) throw new Error("deck_empty");
  return picked.id;
}

/**
 * 하이로우 (logic adapted from lucky-arcade casino-cards). Equal ranks lose.
 * Tables are tuned by test/rtp.test.ts (alley ≈ 99%, house ≈ 95%).
 */
export const highLow: GameDefinition<HighLowParams, HighLowState> = {
  id: "high-low",
  defaults: { alley: { multipliers: [1.17, 1.72, 2.4, 3.45, 4.9] }, house: { multipliers: [1.12, 1.63, 2.25, 3.25, 4.6] } },
  params(raw, venue) {
    const base = this.defaults[venue];
    if (!isRecord(raw) || !Array.isArray(raw.multipliers) || raw.multipliers.length < 1 || raw.multipliers.length > 10) return base;
    const list = raw.multipliers.map(Number);
    return list.every((value) => Number.isFinite(value) && value >= 1 && value <= 50) ? { multipliers: list } : base;
  },
  maxMultiplier: (params) => Math.max(...params.multipliers),
  start(bet, _params, rng) { const current = drawUnseen([], rng); return { bet, current, seen: [current], streak: 0, last: null, done: false, payout: 0 }; },
  canApply: (state, action) => !state.done && (action === "higher" || action === "lower" || (action === "cashout" && state.streak > 0)),
  apply(state, action, params, rng) {
    if (action === "cashout") return { ...state, done: true, payout: cashout(state.bet, state.streak, params) };
    const guess = action === "higher" ? "higher" : "lower";
    const next = drawUnseen(state.seen, rng), difference = rankValue(next) - rankValue(state.current);
    const correct = guess === "higher" ? difference > 0 : difference < 0;
    const base = { ...state, current: next, seen: [...state.seen, next], last: { card: next, guess, correct } as const };
    if (!correct) return { ...base, done: true, payout: 0 };
    const streak = state.streak + 1;
    return streak >= params.multipliers.length ? { ...base, streak, done: true, payout: cashout(state.bet, streak, params) } : { ...base, streak };
  },
  isDone: (state) => state.done,
  payout: (state) => state.payout,
};

function cashout(bet: number, streak: number, params: HighLowParams): number {
  const multiplier = params.multipliers[streak - 1];
  if (multiplier === undefined) throw new Error("high_low_streak_invalid");
  return floorCoins(bet * multiplier);
}

/** Probability the next unseen card beats `current` in each direction. */
export function highLowOdds(state: Pick<HighLowState, "current" | "seen">): { higher: number; lower: number } {
  const value = rankValue(state.current), pool = DECK.filter((entry) => !state.seen.includes(entry.id));
  const higher = pool.filter((entry) => rankValue(entry.id) > value).length, lower = pool.filter((entry) => rankValue(entry.id) < value).length;
  return { higher: higher / pool.length, lower: lower / pool.length };
}
