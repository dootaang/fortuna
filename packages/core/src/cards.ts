// Deck model and hand evaluators ported from lucky-arcade
// packages/card-table and cabinets/casino-cards/src/deck.ts (GPL-3.0-or-later).
import { shuffle, XorShift32 } from "./rng.ts";

export const SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "j", "q", "k", "a"] as const;
export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
export type CardId = `${Suit}-${Rank}`;
export interface Card { id: CardId; suit: Suit; rank: Rank; }

export const DECK: readonly Card[] = RANKS.flatMap((rank) => SUITS.map((suit) => ({ id: `${suit}-${rank}` as CardId, suit, rank })));
const BY_ID = new Map(DECK.map((entry) => [entry.id, entry]));

export function card(id: string): Card {
  const found = BY_ID.get(id as CardId);
  if (!found) throw new Error(`card_missing:${id}`);
  return found;
}

/** 2..14, ace high. */
export function rankValue(id: string): number { return RANKS.indexOf(card(id).rank) + 2; }

export function shuffledDeck(seed: string): CardId[] { return shuffle(DECK.map((entry) => entry.id), new XorShift32(seed)); }

export function blackjackValue(cards: readonly string[]): number {
  let total = 0, aces = 0;
  for (const id of cards) { const rank = card(id).rank; if (rank === "a") { total += 11; aces += 1; } else total += rank === "j" || rank === "q" || rank === "k" ? 10 : Number(rank); }
  while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
  return total;
}

/** True when the hand counts an ace as 11 without busting. */
export function isSoftBlackjack(cards: readonly string[]): boolean {
  let hard = 0, aces = 0;
  for (const id of cards) { const rank = card(id).rank; if (rank === "a") { hard += 1; aces += 1; } else hard += rank === "j" || rank === "q" || rank === "k" ? 10 : Number(rank); }
  return aces > 0 && hard + 10 <= 21;
}

export interface PokerHandValue { category: number; kickers: number[]; label: string; }

export const POKER_LABELS = ["하이 카드", "원 페어", "투 페어", "트리플", "스트레이트", "플러시", "풀하우스", "포카드", "스트레이트 플러시", "파이브카드"] as const;

export function bestPokerHand(cards: readonly string[]): PokerHandValue {
  if (cards.length < 5 || cards.length > 7) throw new Error("poker_hand_size_invalid");
  if (new Set(cards).size !== cards.length) throw new Error("poker_card_duplicate");
  let best: PokerHandValue | null = null;
  for (const five of combinations(cards, 5)) { const value = evaluateFive(five); if (!best || comparePokerValues(value, best) > 0) best = value; }
  return best as PokerHandValue;
}

export function comparePokerValues(left: PokerHandValue, right: PokerHandValue): number {
  if (left.category !== right.category) return left.category - right.category;
  for (let index = 0; index < Math.max(left.kickers.length, right.kickers.length); index += 1) {
    const difference = (left.kickers[index] ?? 0) - (right.kickers[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function evaluateFive(ids: readonly string[]): PokerHandValue {
  const cards = ids.map(card), values = cards.map((entry) => RANKS.indexOf(entry.rank) + 2).sort((a, b) => b - a);
  const flush = cards.every((entry) => entry.suit === cards[0]?.suit);
  return evaluateGroups(values, flush, true);
}

/**
 * Shared ranking for card and dice hands. `values` must be sorted descending.
 * Dice poker reuses it with flush disabled and no ace-low straight.
 */
export function evaluateGroups(values: readonly number[], flush: boolean, aceLow: boolean): PokerHandValue {
  const counts = new Map<number, number>(); for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const unique = [...new Set(values)]; if (aceLow && unique[0] === 14) unique.push(1);
  let straightHigh = 0;
  for (let index = 0; index <= unique.length - 5; index += 1) if ((unique[index] ?? 0) - (unique[index + 4] ?? 0) === 4) { straightHigh = unique[index] ?? 0; break; }
  const rest = (skip: number) => groups.slice(skip).map(([value]) => value).sort((a, b) => b - a);
  if (groups[0]?.[1] === 5) return { category: 9, kickers: [groups[0][0]], label: POKER_LABELS[9] };
  if (flush && straightHigh) return { category: 8, kickers: [straightHigh], label: POKER_LABELS[8] };
  if (groups[0]?.[1] === 4) return { category: 7, kickers: [groups[0][0], groups[1]?.[0] ?? 0], label: POKER_LABELS[7] };
  if (groups[0]?.[1] === 3 && groups[1]?.[1] === 2) return { category: 6, kickers: [groups[0][0], groups[1][0]], label: POKER_LABELS[6] };
  if (flush) return { category: 5, kickers: [...values], label: POKER_LABELS[5] };
  if (straightHigh) return { category: 4, kickers: [straightHigh], label: POKER_LABELS[4] };
  if (groups[0]?.[1] === 3) return { category: 3, kickers: [groups[0][0], ...rest(1)], label: POKER_LABELS[3] };
  if (groups[0]?.[1] === 2 && groups[1]?.[1] === 2) return { category: 2, kickers: [Math.max(groups[0][0], groups[1][0]), Math.min(groups[0][0], groups[1][0]), groups[2]?.[0] ?? 0], label: POKER_LABELS[2] };
  if (groups[0]?.[1] === 2) return { category: 1, kickers: [groups[0][0], ...rest(1)], label: POKER_LABELS[1] };
  return { category: 0, kickers: [...values], label: POKER_LABELS[0] };
}

function combinations<T>(values: readonly T[], count: number): T[][] {
  const output: T[][] = [];
  const visit = (start: number, chosen: T[]) => {
    if (chosen.length === count) { output.push(chosen); return; }
    for (let index = start; index <= values.length - (count - chosen.length); index += 1) visit(index + 1, [...chosen, values[index] as T]);
  };
  visit(0, []);
  return output;
}

export const SUIT_SYMBOL: Readonly<Record<Suit, string>> = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" };
export const RANK_LABEL: Readonly<Record<Rank, string>> = { "2": "2", "3": "3", "4": "4", "5": "5", "6": "6", "7": "7", "8": "8", "9": "9", "10": "10", j: "J", q: "Q", k: "K", a: "A" };
export function isRedSuit(id: string): boolean { const suit = card(id).suit; return suit === "hearts" || suit === "diamonds"; }
