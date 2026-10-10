import { blackjackValue, isSoftBlackjack, type CardId } from "../cards.ts";
import type { XorShift32 } from "../rng.ts";
import { drawUnseen } from "./high-low.ts";
import { floorCoins, isRecord, numberOr, type GameDefinition } from "./types.ts";

export interface BlackjackParams {
  /** Gross return for a natural 21 (3:2 = 2.5). */
  naturalPayout: number;
  dealerHitsSoft17: boolean;
}
export type BlackjackResult = "natural" | "win" | "push" | "loss" | "bust" | null;
export interface BlackjackState {
  bet: number;
  player: CardId[];
  /** Dealer starts with one card; the second is drawn only after the player stands (no hole card to peek at). */
  dealer: CardId[];
  done: boolean;
  result: BlackjackResult;
  payout: number;
}

/** 스물하나: single deck, hit/stand, no hole card. Rules adapted from lucky-arcade casino-cards. */
export const blackjack: GameDefinition<BlackjackParams, BlackjackState> = {
  id: "blackjack",
  defaults: { alley: { naturalPayout: 3, dealerHitsSoft17: false }, house: { naturalPayout: 2, dealerHitsSoft17: true } },
  params(raw, venue) {
    const base = this.defaults[venue];
    if (!isRecord(raw)) return base;
    return { naturalPayout: numberOr(raw.naturalPayout, base.naturalPayout, 1, 5), dealerHitsSoft17: typeof raw.dealerHitsSoft17 === "boolean" ? raw.dealerHitsSoft17 : base.dealerHitsSoft17 };
  },
  maxMultiplier: (params) => Math.max(2, params.naturalPayout),
  start(bet, params, rng) {
    const seen: CardId[] = [];
    const take = () => { const next = drawUnseen(seen, rng); seen.push(next); return next; };
    const player = [take(), take()], dealer = [take()];
    const state: BlackjackState = { bet, player, dealer, done: false, result: null, payout: 0 };
    return blackjackValue(player) === 21 ? dealerPlay(state, params, rng) : state;
  },
  canApply: (state, action) => !state.done && (action === "hit" || action === "stand"),
  apply(state, action, params, rng) {
    if (action === "stand") return dealerPlay(state, params, rng);
    const player = [...state.player, drawUnseen([...state.player, ...state.dealer], rng)];
    const value = blackjackValue(player);
    if (value > 21) return { ...state, player, done: true, result: "bust", payout: 0 };
    return value === 21 ? dealerPlay({ ...state, player }, params, rng) : { ...state, player };
  },
  isDone: (state) => state.done,
  payout: (state) => state.payout,
};

function dealerPlay(state: BlackjackState, params: BlackjackParams, rng: XorShift32): BlackjackState {
  const dealer = [...state.dealer];
  const draw = () => dealer.push(drawUnseen([...state.player, ...dealer], rng));
  draw();
  const playerNatural = state.player.length === 2 && blackjackValue(state.player) === 21;
  const dealerNatural = dealer.length === 2 && blackjackValue(dealer) === 21;
  if (playerNatural) return settle(state, dealer, dealerNatural ? "push" : "natural", params);
  if (dealerNatural) return settle(state, dealer, "loss", params);
  while (blackjackValue(dealer) < 17 || (params.dealerHitsSoft17 && blackjackValue(dealer) === 17 && isSoftBlackjack(dealer))) draw();
  const player = blackjackValue(state.player), house = blackjackValue(dealer);
  return settle(state, dealer, house > 21 || player > house ? "win" : player === house ? "push" : "loss", params);
}

function settle(state: BlackjackState, dealer: CardId[], result: Exclude<BlackjackResult, null>, params: BlackjackParams): BlackjackState {
  const multiplier = result === "natural" ? params.naturalPayout : result === "win" ? 2 : result === "push" ? 1 : 0;
  return { ...state, dealer, done: true, result, payout: floorCoins(state.bet * multiplier) };
}

/** Hit/stand basic strategy, used by RTP tests and the "딜러의 조언" hint. */
export function basicStrategyHits(player: readonly string[], dealerUp: string): boolean {
  const total = blackjackValue(player), up = Math.min(blackjackValue([dealerUp]), 11);
  if (isSoftBlackjack(player)) return total <= 17 || (total === 18 && up >= 9);
  if (total <= 11) return true;
  if (total === 12) return up < 4 || up > 6;
  if (total <= 16) return up >= 7;
  return false;
}
