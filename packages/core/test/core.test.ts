import { describe, expect, it } from "vitest";
import {
  DEFAULT_ECONOMY, GAMES, accessCodeHash, arrivalSlip, blackjackValue, borrowDebt, bumpCounters, cumulativeCosts, deductionFor, diceHand,
  generateAccessCode, lastTrain, normalizeAccessCode, normalizeEconomy, replayWager, skillCost, stepSeed, usedInPeriod, usesLeft, dayIndexAt, periodStartMs, limitReachedText, wageFor, wageSlip,
  weekIndexAt, weekStartMs, XorShift32, DISTRICTS, WORK_TEMPLATES, makeMathQuestions, makeMemoryRounds, makeSortQueue, makeTimingRounds,
  timingAccuracy, needleAt, fill, oddEven, highLow, oldMaid, JOKER,
} from "../src/index.ts";

describe("week index (KST Monday 00:00)", () => {
  it("rolls over exactly at Monday 00:00 KST", () => {
    const monday = Date.UTC(2026, 9, 11, 15, 0, 0); // 2026-10-12 00:00 KST (Mon)
    expect(weekIndexAt(monday) - weekIndexAt(monday - 1)).toBe(1);
    expect(weekStartMs(weekIndexAt(monday))).toBe(monday);
    expect(weekIndexAt(monday + 6 * 86_400_000 + 86_399_999)).toBe(weekIndexAt(monday));
  });
  it("daily periods roll over at 00:00 KST", () => {
    const midnight = Date.UTC(2026, 9, 13, 15, 0, 0); // 2026-10-14 00:00 KST
    expect(dayIndexAt(midnight) - dayIndexAt(midnight - 1)).toBe(1);
    expect(periodStartMs(dayIndexAt(midnight), "day")).toBe(midnight);
    expect(periodStartMs(weekIndexAt(midnight), "week")).toBe(weekStartMs(weekIndexAt(midnight)));
  });
  it("treats a stale period as unused and resets both counters", () => {
    const now = Date.UTC(2026, 9, 14);
    const counters = { periodIndex: dayIndexAt(now) - 1, workUsed: 10, gambleUsed: 30 };
    expect(usedInPeriod(counters, "work", now, "day")).toBe(0);
    expect(bumpCounters(counters, "gamble", dayIndexAt(now))).toEqual({ periodIndex: dayIndexAt(now), workUsed: 0, gambleUsed: 1 });
    expect(bumpCounters({ ...counters, periodIndex: dayIndexAt(now) }, "work", dayIndexAt(now))).toMatchObject({ workUsed: 11, gambleUsed: 30 });
    expect(usesLeft({ ...counters, periodIndex: dayIndexAt(now), workUsed: 4 }, DEFAULT_ECONOMY, "work", now)).toBe(6);
    expect(limitReachedText(DEFAULT_ECONOMY, "gamble")).toContain("오늘");
  });
});

describe("economy", () => {
  it("prices skills by every level paid (4→6 = 4,300)", () => {
    const cumulative = DEFAULT_ECONOMY.skill.cumulative;
    expect(skillCost(4, 4, cumulative)).toBe(300);
    expect(skillCost(4, 6, cumulative)).toBe(4_300);
    expect(skillCost(1, 8, cumulative)).toBe(10 + 30 + 100 + 300 + 1_000 + 3_000 + 10_000 + 30_000);
    expect(() => skillCost(5, 4, cumulative)).toThrow();
    expect(cumulativeCosts([0, 10, 30])).toEqual([0, 10, 40]);
  });
  it("shows wage, deduction and take-home; liberation zeroes the deduction", () => {
    expect(wageSlip(200, { liberated: false, deductionBps: 5_000 })).toEqual({ gross: 200, deductionBps: 5_000, deduction: 100, net: 100 });
    expect(wageSlip(200, { liberated: true, deductionBps: 5_000 }).deduction).toBe(0);
    expect(deductionFor(155, 3_333)).toBe(51);
  });
  it("maps performance onto the wage grid", () => {
    const work = DEFAULT_ECONOMY.work;
    expect(wageFor(0, work)).toBe(150);
    expect(wageFor(0.5, work)).toBe(200);
    expect(wageFor(1, work)).toBe(250);
    expect(wageFor(0.73, work) % 10).toBe(0);
    expect(wageFor(Number.NaN, work)).toBe(150);
  });
  it("arrival: +1,000 envelope, -100 gate, debt 1,500", () => {
    expect(arrivalSlip(DEFAULT_ECONOMY.welcome)).toEqual({ delta: 900, debtDelta: 1_500, vaultDelta: 100 });
    expect(borrowDebt(400, 5_000)).toBe(600);
  });
  it("normalises partial config and recomputes derived fields", () => {
    const config = normalizeEconomy({ work: { weeklyLimit: 12 }, skill: { costs: [0, 5, 7] }, gambling: { limit: 40, games: { "odd-even": { house: { enabled: false, params: { payout: 1.8 } } } } } });
    expect(config.work.limit).toBe(12); // legacy key still read
    expect(config.gambling.limit).toBe(40);
    expect(config.limitPeriod).toBe("day");
    expect(normalizeEconomy({ limitPeriod: "week" }).limitPeriod).toBe("week");
    expect(config.work.wageMax).toBe(250);
    expect(config.skill.cumulative).toEqual([0, 5, 12]);
    expect(config.gambling.games["odd-even"].house).toEqual({ enabled: false, params: { payout: 1.8 }, maxMultiplier: 1.8 });
    expect(config.gambling.games.blackjack.alley.enabled).toBe(true);
  });
});

describe("access codes", () => {
  it("normalises human typing to the same hash", () => {
    const code = generateAccessCode();
    expect(code).toMatch(/^FRT-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(accessCodeHash(code.toLowerCase().replaceAll("-", " "))).toBe(accessCodeHash(code));
    expect(normalizeAccessCode("frt-abcd-efgh-jkmn")).toBe("FRT-ABCD-EFGH-JKMN");
    expect(normalizeAccessCode("abcdefghjkmn")).toBe("FRT-ABCD-EFGH-JKMN");
    expect(accessCodeHash("FRT-AAAA-AAAA-AAAA")).not.toBe(accessCodeHash("FRT-AAAA-AAAA-AAAB"));
  });
});

describe("sealed wagers", () => {
  it("replays the same trace to the same result", () => {
    const trace = { wagerId: "p1_7", openedAtMs: 1_000, actions: ["stand"], timesMs: [2_000] };
    const params = GAMES.blackjack.defaults.house;
    const opening = GAMES.blackjack.start(100, params, new XorShift32(stepSeed(trace, 0)));
    const actions = opening.done ? [] : trace.actions, timesMs = opening.done ? [] : trace.timesMs;
    const first = replayWager(GAMES.blackjack, 100, params, { ...trace, actions, timesMs });
    expect(replayWager(GAMES.blackjack, 100, params, { ...trace, actions, timesMs })).toEqual(first);
    expect(first.done).toBe(true);
  });
  it("a different server time changes the outcome stream", () => {
    const outcomes = new Set<string>();
    for (let time = 0; time < 40; time += 1) {
      const state = replayWager(oddEven, 100, oddEven.defaults.alley, { wagerId: "w", openedAtMs: 1, actions: ["odd"], timesMs: [time] });
      outcomes.add(String(state.dice));
    }
    expect(outcomes.size).toBeGreaterThan(5);
    expect(stepSeed({ wagerId: "w", openedAtMs: 5, timesMs: [] }, 0)).toBe("w:open:5");
  });
  it("rejects illegal actions during replay", () => {
    expect(() => replayWager(highLow, 100, highLow.defaults.alley, { wagerId: "w", openedAtMs: 1, actions: ["cashout"], timesMs: [2] })).toThrow(/illegal/);
  });
});

describe("game rules", () => {
  it("blackjack values aces softly", () => {
    expect(blackjackValue(["hearts-a", "spades-k"])).toBe(21);
    expect(blackjackValue(["hearts-a", "spades-a", "clubs-9"])).toBe(21);
    expect(blackjackValue(["hearts-k", "spades-q", "clubs-2"])).toBe(22);
  });
  it("blackjack deals one dealer card until the player stands", () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const state = GAMES.blackjack.start(100, GAMES.blackjack.defaults.alley, new XorShift32(`bj${seed}`));
      if (!state.done) expect(state.dealer).toHaveLength(1);
    }
  });
  it("last train pays returnRate × 1.2^stations and the conductor takes all", () => {
    const params = lastTrain.defaults.house;
    let state = lastTrain.start(1_000, params, new XorShift32(1));
    let guard = 0;
    while (!state.done && guard++ < 50) state = lastTrain.apply(state, "roll", params, new XorShift32(`lt${guard}`));
    if (state.caught) expect(state.payout).toBe(0);
    else expect(state.payout).toBe(Math.floor(1_000 * 0.95 * 1.2 ** 10));
  });
  it("dice hands rank five of a kind over four of a kind over straight", () => {
    expect(diceHand([6, 6, 6, 6, 6]).category).toBeGreaterThan(diceHand([1, 1, 1, 1, 2]).category);
    expect(diceHand([2, 3, 4, 5, 6]).label).toBe("스트레이트");
    expect(diceHand([1, 2, 3, 4, 6]).label).toBe("노 페어");
  });
  it("old maid always ends with exactly one joker holder", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const params = oldMaid.defaults.alley;
      let state = oldMaid.start(100, params, new XorShift32(`om${seed}`));
      let step = 0;
      while (!state.done) { state = oldMaid.apply(state, `pick:${step % state.dealer.length}`, params, new XorShift32(`om${seed}:${step}`)); step += 1; }
      expect(state.win).toBe(!state.hand.includes(JOKER));
      expect(state.hand.length === 0 || state.dealer.length === 0).toBe(true);
    }
  });
  it("every default maxMultiplier covers the largest possible payout", () => {
    for (const game of Object.values(GAMES)) for (const venue of ["alley", "house"] as const) {
      const params = game.defaults[venue], cap = game.maxMultiplier(params);
      for (let seed = 0; seed < 300; seed += 1) {
        let state = game.start(100, params, new XorShift32(`cap${seed}`)), step = 0;
        while (!game.isDone(state) && step < 60) {
          const options = ["odd", "roll", "higher", "lower", "hit", "stand", "n7", "red", "hold:00000", "hold:11111", "pick:0", "cashout", "stop"].filter((action) => game.canApply(state, action));
          state = game.apply(state, options[seed % options.length] as string, params, new XorShift32(`cap${seed}:${step}`)); step += 1;
        }
        expect(game.payout(state)).toBeLessThanOrEqual(100 * cap + 1e-9);
      }
    }
  });
});

describe("work content", () => {
  it("every district has all four skins with enough material", () => {
    expect(new Set(DISTRICTS.map((district) => district.id)).size).toBe(DISTRICTS.length);
    for (const district of DISTRICTS) {
      for (const template of WORK_TEMPLATES) expect(district.work[template].title).toBeTruthy();
      const bins = new Set(district.work.sort.bins.map((bin) => bin.id));
      expect(district.work.sort.items.every((item) => bins.has(item.bin))).toBe(true);
      expect(district.work.memory.items.length).toBeGreaterThanOrEqual(9);
      expect(makeSortQueue(district.work.sort, "s")).toHaveLength(40);
      expect(makeMemoryRounds(district.work.memory, "m").every((round) => round.order.every((index) => round.choices.includes(index)))).toBe(true);
      expect(makeMathQuestions(district.work.math, "q").every((question) => question.choices.includes(question.answer))).toBe(true);
    }
  });
  it("timing accuracy peaks at the mark", () => {
    const [round] = makeTimingRounds("t");
    expect(timingAccuracy(round!, round!.center)).toBe(1);
    expect(timingAccuracy(round!, round!.center + round!.zone)).toBe(0);
    expect(needleAt(round!, 0)).toBe(0);
  });
  it("fills placeholders with Korean number formatting", () => {
    expect(fill("{name} 님 {amount}코인", { name: "가", amount: 1500 })).toBe("가 님 1,500코인");
  });
});

describe("discord lines", () => {
  it("formats events in the manager's voice and never leaks secrets", async () => {
    const { formatNotification } = await import("../src/index.ts");
    expect(formatNotification({ kind: "arrival", playerName: "에이든", districtId: "wuxia", detail: { debt: 1500 }, payload: {} }, 1000)).toContain("중원 구역");
    expect(formatNotification({ kind: "bigGamble", playerName: "에이든", districtId: "", detail: { bet: 2000, payout: 0, game: "blackjack" }, payload: {} }, 1000)).toContain("2,000코인을 잃었습니다");
    expect(formatNotification({ kind: "bigGamble", playerName: "에이든", districtId: "", detail: { bet: 500, payout: 950, game: "odd-even" }, payload: {} }, 1000)).toBeNull();
    expect(formatNotification({ kind: "skill", playerName: "에이든", districtId: "", detail: { skillName: "쾌검", usedLevel: 6, cost: 4300, borrowed: 3700, note: "" }, payload: {} }, 1000)).toContain("3,700코인은 지배인에게");
    expect(formatNotification({ kind: "shop", playerName: "에이든", districtId: "", detail: { itemName: "간부의 약점", secret: "비밀" }, payload: {} }, 1000)).not.toContain("비밀");
    expect(formatNotification({ kind: "liberation", playerName: "", districtId: "", detail: {}, payload: { districtId: "horror" } }, 1000)).toContain("무월리");
    expect(formatNotification({ kind: "story", playerName: "", districtId: "", detail: {}, payload: { text: "⚔ 제1판" } }, 1000)).toBe("⚔ 제1판");
    expect(formatNotification({ kind: "story", playerName: "", districtId: "", detail: {}, payload: {} }, 1000)).toBeNull();
  });
});
