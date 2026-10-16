import { describe, expect, it } from "vitest";
import { XorShift32 } from "../src/rng.ts";
import {
  COIN_IDS, FRONT_DISTRICTS, FRONT_TEXT, HOTEL_RULES, SEALED_TITLE, bookInputFrom, deriveBook, stepAutoNews,
} from "../src/index.ts";
import { COIN_NEWS } from "../src/market/autonews-text.ts";

describe("fronts and district news", () => {
  it("has three lines for every step of every district, and four hotel rules", () => {
    for (const district of FRONT_DISTRICTS) {
      expect(FRONT_TEXT[district]).toHaveLength(4);
      for (const step of FRONT_TEXT[district]) for (const line of [step.official, step.paper, step.rumor]) expect(line.length).toBeGreaterThan(5);
    }
    expect(HOTEL_RULES).toHaveLength(4);
  });

  it("gives every coin its own openings for each source and tone", () => {
    for (const coin of COIN_IDS) for (const source of ["official", "paper", "rumor"] as const) for (const tone of ["up", "down"] as const) {
      expect(COIN_NEWS[coin][source][tone].length).toBeGreaterThanOrEqual(2);
    }
  });

  it("opens stories with the district's own lines", () => {
    // A line is picked with one draw however long the list, so the random stream (and the prices) stay as they were.
    const rng = new XorShift32(42);
    let started = false;
    for (let i = 0; i < 5_000 && !started; i += 1) {
      const step = stepAutoNews("LNH", null, i * 15_000, 15 / 3600, true, rng);
      if (step.feed.length) {
        started = true;
        expect(step.feed[0]!.text.startsWith("[")).toBe(true);
        expect(step.feed[0]!.text).not.toContain("{place}");
      }
    }
    expect(started).toBe(true);
  });
});

describe("the ledger", () => {
  const raw = (over: Partial<Parameters<typeof bookInputFrom>[0]> = {}) => bookInputFrom({
    districts: [{ id: "medieval", data: { liberated: true } }, { id: "wuxia", data: { liberated: false } }],
    clues: [{ id: "c1", data: { kind: "collateral", found: true, district: "medieval" } }, { id: "c2", data: { kind: "collateral", found: false, district: "wuxia" } }],
    funds: [{ id: "f1", data: { book: "wuxia", current: 5_000, goal: 5_000 } }, { id: "f2", data: { book: "modern", current: 10, goal: 5_000 } }],
    fronts: [{ id: "horror", data: { step: 4 } }, { id: "romance", data: { step: 3 } }],
    players: [{ id: "p1", data: { name: "벨라" } }, { id: "p2", data: { name: "에이든" } }, { id: "p3", data: { name: "아직" } }],
    wallets: [{ id: "p1", data: { arrived: true, debt: 0 } }, { id: "p2", data: { arrived: true, debt: 700 } }, { id: "p3", data: { arrived: false, debt: 0 } }],
    titles: { chapters: { medieval: ["원장", "장부", "셋째 쪽 제목", "차용증", "[파국] 봉쇄"] }, passenger: "승객 [{name}]의 차용증" },
    ...over,
  });

  it("blanks pages for liberation, a found collateral, a full fund and a cleared debt", () => {
    const book = deriveBook(raw());
    expect(book.chapters.medieval.map((page) => page.state)).toEqual(["blank", "blank", "blank", "ink"]);
    expect(book.chapters.medieval[2]!.title).toBe("셋째 쪽 제목");
    expect(book.chapters.wuxia.map((page) => page.state)).toEqual(["ink", "ink", "ink", "blank"]);
    expect(book.chapters.wuxia[2]!.title).toBe(SEALED_TITLE);
    expect(book.chapters.modern[3]!.state).toBe("ink");
    expect(book.passengers.map((page) => [page.name, page.state])).toEqual([["벨라", "blank"], ["에이든", "ink"]]);
    expect(book.passengers[0]!.title).toBe("승객 [벨라]의 차용증");
  });

  it("adds a black page while a clock is full and counts what is left", () => {
    const book = deriveBook(raw());
    expect(book.chapters.horror.at(-1)!.state).toBe("black");
    expect(book.chapters.romance).toHaveLength(4);
    expect(book.total).toBe(7 * 4 + 1 + 2);
    expect(book.remaining).toBe(book.total - 3 - 1 - 1);
  });

  it("is blank everywhere only when every condition holds", () => {
    const all = (ids: readonly string[]) => ids.map((id) => ({ id, data: { liberated: true } }));
    const book = deriveBook(raw({
      districts: all(FRONT_DISTRICTS), fronts: [],
      clues: FRONT_DISTRICTS.map((district) => ({ id: district, data: { kind: "collateral", found: true, district } })),
      funds: FRONT_DISTRICTS.map((district) => ({ id: district, data: { book: district, current: 1, goal: 1 } })),
      wallets: [{ id: "p1", data: { arrived: true, debt: 0 } }, { id: "p2", data: { arrived: true, debt: 0 } }],
    }));
    expect(book.remaining).toBe(0);
  });
});
