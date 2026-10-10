import { RANKS, type CardId } from "../cards.ts";
import { shuffle, type XorShift32 } from "../rng.ts";
import { floorCoins, isRecord, numberOr, type GameDefinition } from "./types.ts";

export const JOKER = "joker" as const;
export type OldMaidCard = CardId | typeof JOKER;

export interface OldMaidParams { payout: number; }
export interface OldMaidState {
  bet: number;
  hand: OldMaidCard[];
  /** The dealer's cards. Their order is re-shuffled at every draw, so a slot index reveals nothing in advance. */
  dealer: OldMaidCard[];
  discards: OldMaidCard[];
  /** Latest exchange, for the table animation. */
  log: { by: "player" | "dealer"; card: OldMaidCard; paired: boolean }[];
  done: boolean;
  win: boolean;
  payout: number;
}

const PAIR_SUITS = ["hearts", "spades"] as const;

function pairKey(cardId: OldMaidCard): string { return cardId === JOKER ? JOKER : cardId.split("-")[1] ?? cardId; }

/** Remove every pair, keeping single cards. */
export function discardPairs(cards: readonly OldMaidCard[]): { kept: OldMaidCard[]; removed: OldMaidCard[] } {
  const byKey = new Map<string, OldMaidCard[]>();
  for (const cardId of cards) byKey.set(pairKey(cardId), [...(byKey.get(pairKey(cardId)) ?? []), cardId]);
  const kept: OldMaidCard[] = [], removed: OldMaidCard[] = [];
  for (const group of byKey.values()) { const pairs = Math.floor(group.length / 2) * 2; removed.push(...group.slice(0, pairs)); kept.push(...group.slice(pairs)); }
  return { kept, removed };
}

function finish(state: OldMaidState, params: OldMaidParams): OldMaidState {
  if (state.hand.length > 0 && state.dealer.length > 0) return state;
  const win = !state.hand.includes(JOKER);
  return { ...state, done: true, win, payout: win ? floorCoins(state.bet * params.payout) : 0 };
}

/** 도둑잡기 head-to-head: 13 pairs plus one joker. Whoever holds the joker at the end loses. */
export const oldMaid: GameDefinition<OldMaidParams, OldMaidState> = {
  id: "old-maid",
  defaults: { alley: { payout: 2.06 }, house: { payout: 1.96 } },
  params(raw, venue) { const base = this.defaults[venue]; return isRecord(raw) ? { payout: numberOr(raw.payout, base.payout, 1, 10) } : base; },
  maxMultiplier: (params) => params.payout,
  start(bet, params, rng) {
    const deck = shuffle<OldMaidCard>([...RANKS.flatMap((rank) => PAIR_SUITS.map((suit) => `${suit}-${rank}` as CardId)), JOKER], rng);
    const player = discardPairs(deck.filter((_, index) => index % 2 === 0)), dealer = discardPairs(deck.filter((_, index) => index % 2 === 1));
    return finish({ bet, hand: player.kept, dealer: shuffle(dealer.kept, rng), discards: [...player.removed, ...dealer.removed], log: [], done: false, win: false, payout: 0 }, params);
  },
  canApply(state, action) {
    const match = /^pick:(\d{1,2})$/.exec(action);
    return !state.done && match !== null && Number(match[1]) < state.dealer.length;
  },
  apply(state, action, params, rng) {
    // Player draws: the dealer's fan is shuffled with this step's randomness first.
    const fan = shuffle(state.dealer, rng), index = Number(action.slice(5));
    const drawn = fan[index] as OldMaidCard, dealerAfter = fan.filter((_, slot) => slot !== index);
    const playerPair = discardPairs([...state.hand, drawn]);
    let next: OldMaidState = { ...state, hand: playerPair.kept, dealer: dealerAfter, discards: [...state.discards, ...playerPair.removed], log: [{ by: "player", card: drawn, paired: playerPair.removed.length > 0 }] };
    next = finish(next, params);
    if (next.done) return next;
    // Dealer draws blindly from the player's hand.
    const stolen = next.hand[rng.int(next.hand.length)] as OldMaidCard;
    const dealerPair = discardPairs([...next.dealer, stolen]);
    next = { ...next, hand: next.hand.filter((cardId) => cardId !== stolen), dealer: shuffle(dealerPair.kept, rng), discards: [...next.discards, ...dealerPair.removed], log: [...next.log, { by: "dealer", card: stolen, paired: dealerPair.removed.length > 0 }] };
    return finish(next, params);
  },
  isDone: (state) => state.done,
  payout: (state) => state.payout,
};
