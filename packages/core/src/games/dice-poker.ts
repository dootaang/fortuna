import { comparePokerValues, evaluateGroups, type PokerHandValue } from "../cards.ts";
import type { XorShift32 } from "../rng.ts";
import { floorCoins, isRecord, numberOr, type GameDefinition } from "./types.ts";

export interface DicePokerParams { winPayout: number; tiesPush: boolean; }
export interface DicePokerState {
  bet: number;
  player: number[];
  dealer: number[] | null;
  playerHand: PokerHandValue | null;
  dealerHand: PokerHandValue | null;
  done: boolean;
  outcome: "win" | "tie" | "loss" | null;
  payout: number;
}

export const DICE_HAND_LABELS = ["노 페어", "원 페어", "투 페어", "트리플", "스트레이트", "", "풀하우스", "포카드", "", "파이브다이스"] as const;

export function diceHand(dice: readonly number[]): PokerHandValue {
  const value = evaluateGroups([...dice].sort((a, b) => b - a), false, false);
  return { ...value, label: DICE_HAND_LABELS[value.category] ?? value.label };
}

/** Keep the strongest group(s); with nothing, keep a 4-run toward a straight. Returns a 5-char hold mask. */
export function suggestDiceHold(dice: readonly number[]): string {
  const counts = new Map<number, number>(); for (const face of dice) counts.set(face, (counts.get(face) ?? 0) + 1);
  const hand = diceHand(dice);
  if (hand.category === 4 || hand.category === 6 || hand.category >= 7) return "11111";
  if (hand.category === 0) {
    const set = new Set(dice);
    const run = [[2, 3, 4, 5], [3, 4, 5, 6], [1, 2, 3, 4]].find((candidate) => candidate.every((face) => set.has(face)));
    if (run) { const used = new Set<number>(); return dice.map((face) => (run.includes(face) && !used.has(face) && used.add(face) ? "1" : "0")).join(""); }
    const high = Math.max(...dice); let kept = false;
    return dice.map((face) => (face === high && !kept && (kept = true) ? "1" : "0")).join("");
  }
  return dice.map((face) => ((counts.get(face) ?? 0) >= 2 ? "1" : "0")).join("");
}

function reroll(dice: readonly number[], hold: string, rng: XorShift32): number[] {
  return dice.map((face, index) => (hold[index] === "1" ? face : rng.die()));
}

/** 주사위 포커: five dice, one reroll, against the dealer who plays the same suggested strategy. */
export const dicePoker: GameDefinition<DicePokerParams, DicePokerState> = {
  id: "dice-poker",
  defaults: { alley: { winPayout: 2, tiesPush: true }, house: { winPayout: 1.9, tiesPush: true } },
  params(raw, venue) {
    const base = this.defaults[venue];
    if (!isRecord(raw)) return base;
    return { winPayout: numberOr(raw.winPayout, base.winPayout, 1, 5), tiesPush: typeof raw.tiesPush === "boolean" ? raw.tiesPush : base.tiesPush };
  },
  maxMultiplier: (params) => Math.max(params.winPayout, 1),
  start: (bet, _params, rng) => ({ bet, player: [rng.die(), rng.die(), rng.die(), rng.die(), rng.die()], dealer: null, playerHand: null, dealerHand: null, done: false, outcome: null, payout: 0 }),
  canApply: (state, action) => !state.done && /^hold:[01]{5}$/.test(action),
  apply(state, action, params, rng) {
    const player = reroll(state.player, action.slice(5), rng);
    const first = [rng.die(), rng.die(), rng.die(), rng.die(), rng.die()];
    const dealer = reroll(first, suggestDiceHold(first), rng);
    const playerHand = diceHand(player), dealerHand = diceHand(dealer), compare = comparePokerValues(playerHand, dealerHand);
    const outcome = compare > 0 ? "win" : compare < 0 ? "loss" : "tie";
    const multiplier = outcome === "win" ? params.winPayout : outcome === "tie" && params.tiesPush ? 1 : 0;
    return { ...state, player, dealer, playerHand, dealerHand, done: true, outcome, payout: floorCoins(state.bet * multiplier) };
  },
  isDone: (state) => state.done,
  payout: (state) => state.payout,
};
