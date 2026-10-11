import { describe, expect, it } from "vitest";
import { PVP_JOKER, XorShift32, applyPvpDraw, autoResolveIndex, dealIndexFor, makePvpDeal, nextPvpTurn, partnerOf, pvpDeck, pvpSettlement, throwPairs } from "../src/index.ts";

describe("pvp old maid", () => {
  it("builds decks of pairs plus one joker per seat count", () => {
    expect(pvpDeck(2)).toHaveLength(21);
    expect(pvpDeck(3)).toHaveLength(25);
    expect(pvpDeck(4)).toHaveLength(27);
    expect(() => pvpDeck(5)).toThrow();
    expect(partnerOf("hearts-10")).toBe("spades-10");
    expect(partnerOf(PVP_JOKER)).toBeNull();
  });

  it("deals partitions of the deck with starting pairs thrown and no empty seat", () => {
    for (const seats of [2, 3, 4]) for (let k = 0; k < 60; k += 1) {
      const deal = makePvpDeal(seats, new XorShift32(`deal:${seats}:${k}`));
      const all = [...deal.seats.flat(), ...deal.discards].sort();
      expect(all).toEqual([...pvpDeck(seats)].sort());
      expect(deal.seats.every((hand) => hand.length > 0)).toBe(true);
      for (const hand of deal.seats) expect(throwPairs(hand).thrown).toEqual([]);
      expect(deal.seats.filter((hand) => hand.includes(PVP_JOKER))).toHaveLength(1);
    }
  });

  it("moves a card, throws a completed pair and reports who emptied", () => {
    const sets = { a: ["hearts-5", "spades-9"], b: ["spades-5"], c: ["joker", "hearts-9"] };
    const paired = applyPvpDraw(sets, "a", "b", "spades-5");
    expect(paired.thrown).toEqual(["spades-5", "hearts-5"]);
    expect(paired.sets).toMatchObject({ a: ["spades-9"], b: [] });
    expect(paired.emptied).toEqual(["b"]);
    const plain = applyPvpDraw(sets, "c", "a", "hearts-5");
    expect(plain.sets.c).toEqual(["joker", "hearts-9", "hearts-5"]);
    expect(plain.thrown).toEqual([]);
    const both = applyPvpDraw({ a: ["hearts-2"], b: ["spades-2"] }, "a", "b", "spades-2");
    expect(both.emptied.sort()).toEqual(["a", "b"]);
    expect(() => applyPvpDraw(sets, "a", "b", "joker")).toThrow();
  });

  it("passes the turn to the seat that was drawn from", () => {
    expect(nextPvpTurn(["a", "b", "c"], "b")).toEqual({ actor: "b", target: "c" });
    expect(nextPvpTurn(["a", "b", "c"], "c")).toEqual({ actor: "c", target: "a" });
  });

  it("settles winner takes all, with rake and split ties", () => {
    expect(pvpSettlement(400, 0, 1)).toEqual({ rake: 0, share: 400, remainder: 0 });
    expect(pvpSettlement(400, 500, 1)).toEqual({ rake: 20, share: 380, remainder: 0 });
    expect(pvpSettlement(301, 0, 2)).toEqual({ rake: 0, share: 150, remainder: 1 });
  });

  it("derives table and fallback indexes from sealed times", () => {
    expect(dealIndexFor(1_700_000_000_123)).toBe(1_700_000_000_123 % 256);
    expect(autoResolveIndex(1_700_000_000_005, 3)).toBe(1_700_000_000_005 % 3);
  });
});
