import { bestPokerHand, comparePokerValues, rankValue, type CardId, type PokerHandValue } from "../cards.ts";
import type { XorShift32 } from "../rng.ts";
import { drawUnseen } from "./high-low.ts";
import { floorCoins, isRecord, numberOr, type GameDefinition } from "./types.ts";

export interface DrawPokerParams { winPayout: number; tiesPush: boolean; }
export interface DrawPokerState {
  bet: number;
  player: CardId[];
  dealer: CardId[] | null;
  playerHand: PokerHandValue | null;
  dealerHand: PokerHandValue | null;
  done: boolean;
  outcome: "win" | "tie" | "loss" | null;
  payout: number;
}

/** Hold mask for a reasonable draw: keep made hands and pairs, four to a flush/straight, else the two highest. */
export function suggestPokerHold(cards: readonly CardId[]): string {
  const hand = bestPokerHand(cards);
  if (hand.category >= 4) return "11111";
  const ranks = cards.map(rankValue), counts = new Map<number, number>();
  for (const value of ranks) counts.set(value, (counts.get(value) ?? 0) + 1);
  if (hand.category >= 1) return ranks.map((value) => ((counts.get(value) ?? 0) >= 2 ? "1" : "0")).join("");
  const suits = cards.map((cardId) => cardId.split("-")[0]);
  const flushSuit = suits.find((suit) => suits.filter((other) => other === suit).length === 4);
  if (flushSuit) return suits.map((suit) => (suit === flushSuit ? "1" : "0")).join("");
  const sorted = [...ranks].sort((a, b) => b - a);
  const keep = new Set(sorted.slice(0, 2));
  return ranks.map((value) => (keep.has(value) ? "1" : "0")).join("");
}

function draw(cards: readonly CardId[], hold: string, seen: CardId[], rng: XorShift32): CardId[] {
  return cards.map((cardId, index) => {
    if (hold[index] === "1") return cardId;
    const next = drawUnseen(seen, rng); seen.push(next); return next;
  });
}

/** 포커: heads-up five-card draw with one exchange, against a dealer using `suggestPokerHold`. */
export const drawPoker: GameDefinition<DrawPokerParams, DrawPokerState> = {
  id: "draw-poker",
  defaults: { alley: { winPayout: 2, tiesPush: true }, house: { winPayout: 1.9, tiesPush: true } },
  params(raw, venue) {
    const base = this.defaults[venue];
    if (!isRecord(raw)) return base;
    return { winPayout: numberOr(raw.winPayout, base.winPayout, 1, 5), tiesPush: typeof raw.tiesPush === "boolean" ? raw.tiesPush : base.tiesPush };
  },
  maxMultiplier: (params) => Math.max(params.winPayout, 1),
  start(bet, _params, rng) {
    const seen: CardId[] = [];
    const player = Array.from({ length: 5 }, () => { const next = drawUnseen(seen, rng); seen.push(next); return next; });
    return { bet, player, dealer: null, playerHand: null, dealerHand: null, done: false, outcome: null, payout: 0 };
  },
  canApply: (state, action) => !state.done && /^hold:[01]{5}$/.test(action),
  apply(state, action, params, rng) {
    // The dealer's cards are dealt only now, from the cards the player has not seen.
    const seen: CardId[] = [...state.player];
    const player = draw(state.player, action.slice(5), seen, rng);
    const dealerFirst = Array.from({ length: 5 }, () => { const next = drawUnseen(seen, rng); seen.push(next); return next; });
    const dealer = draw(dealerFirst, suggestPokerHold(dealerFirst), seen, rng);
    const playerHand = bestPokerHand(player), dealerHand = bestPokerHand(dealer), compare = comparePokerValues(playerHand, dealerHand);
    const outcome = compare > 0 ? "win" : compare < 0 ? "loss" : "tie";
    const multiplier = outcome === "win" ? params.winPayout : outcome === "tie" && params.tiesPush ? 1 : 0;
    return { ...state, player, dealer, playerHand, dealerHand, done: true, outcome, payout: floorCoins(state.bet * multiplier) };
  },
  isDone: (state) => state.done,
  payout: (state) => state.payout,
};
