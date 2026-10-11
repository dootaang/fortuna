/**
 * PvP 도둑잡기 (winner takes all). Pure helpers shared by the app, the data
 * layer and the tests; firestore.rules re-checks the same arithmetic.
 *
 * - Deck: hearts/spades pairs of a fixed rank list per player count, plus one joker.
 * - Deals come from a pre-generated table (pvpDeals/{n}_{k}); the index is the
 *   sealed start time modulo the table size, so nobody can choose a deal.
 * - The game ends the moment any hand is empty; everyone still holds cards until
 *   then, so the next actor is always the one just drawn from.
 */
import { shuffle, type XorShift32 } from "../rng.ts";

export const PVP_MIN_SEATS = 2;
export const PVP_MAX_SEATS = 4;
export const PVP_DEAL_TABLE_SIZE = 256;
export const PVP_JOKER = "joker";

const RANK_ORDER = ["a", "k", "q", "j", "10", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
const PAIRS_BY_SEATS: Readonly<Record<number, number>> = { 2: 10, 3: 12, 4: 13 };

export function pvpDeck(seats: number): string[] {
  const pairs = PAIRS_BY_SEATS[seats];
  if (!pairs) throw new Error("pvp_seat_count_invalid");
  return [...RANK_ORDER.slice(0, pairs).flatMap((rank) => [`hearts-${rank}`, `spades-${rank}`]), PVP_JOKER];
}

/** The other card of a pair (hearts ↔ spades of the same rank); the joker has none. */
export function partnerOf(card: string): string | null {
  if (card === PVP_JOKER) return null;
  const [suit, rank] = card.split("-");
  return `${suit === "hearts" ? "spades" : "hearts"}-${rank}`;
}

/** Remove every pair from a hand; returns what stays and what was thrown. */
export function throwPairs(hand: readonly string[]): { kept: string[]; thrown: string[] } {
  const kept: string[] = [], thrown: string[] = [];
  for (const card of hand) {
    const partner = partnerOf(card);
    if (partner && kept.includes(partner)) { kept.splice(kept.indexOf(partner), 1); thrown.push(partner, card); }
    else kept.push(card);
  }
  return { kept, thrown };
}

export interface PvpDeal { seats: string[][]; discards: string[]; }

/** One deal-table entry: shuffle, round-robin, throw the starting pairs. Never leaves a seat empty. */
export function makePvpDeal(seats: number, rng: XorShift32): PvpDeal {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const deck = shuffle(pvpDeck(seats), rng);
    const hands = Array.from({ length: seats }, (_, seat) => deck.filter((_, index) => index % seats === seat));
    const thrown = hands.map(throwPairs);
    if (thrown.every((hand) => hand.kept.length > 0)) {
      return { seats: thrown.map((hand) => [...hand.kept].sort()), discards: thrown.flatMap((hand) => hand.thrown) };
    }
  }
  throw new Error("pvp_deal_failed");
}

export function dealIndexFor(startedAtMs: number): number { return startedAtMs % PVP_DEAL_TABLE_SIZE; }

export interface DrawOutcome {
  sets: Record<string, string[]>;
  /** The pair thrown by the actor, if the drawn card completed one. */
  thrown: string[];
  /** Seats left with no cards — the winners. */
  emptied: string[];
}

/** Move `card` from target to actor, throwing a completed pair. Mirrors firestore.rules. */
export function applyPvpDraw(sets: Record<string, readonly string[]>, actor: string, target: string, card: string): DrawOutcome {
  const from = sets[target] ?? [], to = sets[actor] ?? [];
  if (!from.includes(card)) throw new Error("pvp_card_not_held");
  const partner = partnerOf(card);
  const paired = partner !== null && to.includes(partner);
  const next: Record<string, string[]> = Object.fromEntries(Object.entries(sets).map(([uid, hand]) => [uid, [...hand]]));
  next[target] = from.filter((entry) => entry !== card);
  next[actor] = paired ? to.filter((entry) => entry !== partner) : [...to, card];
  const emptied = [target, actor].filter((uid, index, list) => list.indexOf(uid) === index && (next[uid]?.length ?? 0) === 0);
  return { sets: next, thrown: paired ? [card, partner as string] : [], emptied };
}

/** After A draws from B, B draws from the seat after B. */
export function nextPvpTurn(order: readonly string[], drawnFrom: string): { actor: string; target: string } {
  const index = order.indexOf(drawnFrom);
  if (index < 0) throw new Error("pvp_seat_unknown");
  return { actor: drawnFrom, target: order[(index + 1) % order.length] as string };
}

/** Rake goes to the vault; winners split the rest; the remainder of the split also goes to the vault. */
export function pvpSettlement(pot: number, rakeBps: number, winners: number): { rake: number; share: number; remainder: number } {
  const rake = Math.floor((pot * rakeBps) / 10_000);
  if (winners <= 0) return { rake, share: 0, remainder: pot - rake };
  const share = Math.floor((pot - rake) / winners);
  return { rake, share, remainder: pot - rake - share * winners };
}

/** Fallback card when a target does not respond: public set index chosen by the sealed pick time. */
export function autoResolveIndex(pickAtMs: number, count: number): number { return pickAtMs % count; }
