import { describe, expect, it } from "vitest";
import {
  COIN_IDS, COINS, DEFAULT_MARKET, XorShift32, barsFor, blcPlan, capPrice, debtFactor, floorDiv, foldCandle, hourIndexAt, initialMarketState, liquidationPrice,
  marketSeed, maxLeverage, minuteKey, normalizeMarket, quoteClose, quoteOpen, rentCrossed, seedKeys, stateFromTick, stepMarket, tickFromState, tickSeq, triggerAt,
  type CoinId, type MarketState,
} from "../src/index.ts";

const TICK = DEFAULT_MARKET.tickSeconds;
const SECRET = "test-secret";

function run(state: MarketState, ticks: number, startMs: number, world?: Parameters<typeof stepMarket>[1]["world"]): MarketState {
  let current = state;
  for (let index = 1; index <= ticks; index += 1) {
    const atMs = startMs + index * TICK * 1000, seq = tickSeq(atMs, TICK);
    const keys = seedKeys(seq, atMs, TICK);
    const seeds = { tick: marketSeed(SECRET, keys.tick), blcNow: marketSeed(SECRET, keys.blcNow), blcPast: marketSeed(SECRET, keys.blcPast), s9Week: marketSeed(SECRET, keys.s9Week) };
    current = stepMarket(current, { seq, atMs, seeds, config: DEFAULT_MARKET, world }).state;
  }
  return current;
}

describe("market config", () => {
  it("fills defaults and caps leverage by house state", () => {
    const config = normalizeMarket({ feeBps: 25, coins: { MWL: { enabled: false } } });
    expect(config.feeBps).toBe(25);
    expect(config.coins.MWL).toEqual({ enabled: false, volMult: 1, paused: false, autoNews: true });
    expect(config.leverage.steps).toEqual([1, 2, 3, 5, 10, 20]);
    expect(maxLeverage(config, "FTN", false)).toBe(5);
    expect(maxLeverage(config, "HBT", false)).toBe(3);
    expect(maxLeverage(config, "FTN", true)).toBe(20);
    expect(maxLeverage(config, "S9", true)).toBe(10);
  });
});

describe("position math", () => {
  it("floors exactly", () => {
    expect(floorDiv(7, 2)).toBe(3);
    expect(floorDiv(-7, 2)).toBe(-4);
    expect(floorDiv(40_000 * 123_457, 100_000)).toBe(49_382);
  });

  it("quotes an opening with fee, liquidation and cap", () => {
    const quote = quoteOpen(DEFAULT_MARKET, "FTN", "long", 10, 200, 100_000);
    expect(quote).toMatchObject({ notional: 2_000, borrowed: 1_800, fee: 2, cost: 202, liq: 91_000, cap: 200_000, interestPerHour: 3 });
    const short = quoteOpen(DEFAULT_MARKET, "FTN", "short", 5, 100, 100_000);
    expect(short.liq).toBe(118_000);
    expect(short.cap).toBe(0);
    expect(quoteOpen(DEFAULT_MARKET, "FTN", "short", 20, 100, 100_000).cap).toBe(50_000);
    expect(quoteOpen(DEFAULT_MARKET, "MWL", "long", 1, 10, 1_300).fee).toBe(1);
  });

  it("settles a close with pnl, interest and fee", () => {
    const terms = { coin: "HBT" as CoinId, side: "long" as const, leverage: 10, margin: 200, fee: 2, entry: 25_000, openedAtMs: 0 };
    const win = quoteClose(DEFAULT_MARKET, terms, "close", 25_500, 30 * 60_000);
    expect(win).toMatchObject({ hours: 1, pnl: 40, interest: 3, fee: 2, payout: 235 });
    const loss = quoteClose(DEFAULT_MARKET, { ...terms, side: "short" }, "close", 25_500, 3 * 3_600_000 + 1);
    expect(loss).toMatchObject({ hours: 4, pnl: -40, interest: 14, fee: 2, payout: 144 });
    expect(quoteClose(DEFAULT_MARKET, terms, "liquidated", 22_750, 1).payout).toBe(0);
    expect(quoteClose(DEFAULT_MARKET, terms, "refund", 0, 1).payout).toBe(200);
    const capped = quoteClose(DEFAULT_MARKET, terms, "cap", capPrice(25_000, "long", 10, 10), 60_000);
    expect(capped.payout).toBe(200 + 2_000 - 3 - 2);
  });

  it("doubles MWL closing fee during the moonless night", () => {
    const terms = { coin: "MWL" as CoinId, side: "long" as const, leverage: 3, margin: 1_000, fee: 3, entry: 1_300, openedAtMs: 0 };
    const nightMs = Date.UTC(2026, 9, 13, 16, 30); // 01:30 KST
    const dayMs = Date.UTC(2026, 9, 13, 3, 0); // 12:00 KST
    expect(quoteClose(DEFAULT_MARKET, { ...terms, openedAtMs: nightMs - 60_000 }, "close", 1_300, nightMs).fee).toBe(6);
    expect(quoteClose(DEFAULT_MARKET, { ...terms, openedAtMs: dayMs - 60_000 }, "close", 1_300, dayMs).fee).toBe(3);
  });

  it("triggers liquidation and cap on the right side", () => {
    expect(triggerAt({ side: "long", liq: 91_000, cap: 200_000 }, 90_999)).toBe("liquidated");
    expect(triggerAt({ side: "long", liq: 91_000, cap: 200_000 }, 200_000)).toBe("cap");
    expect(triggerAt({ side: "short", liq: 118_000, cap: 0 }, 1)).toBeNull();
    expect(triggerAt({ side: "short", liq: 118_000, cap: 0 }, 118_000)).toBe("liquidated");
    expect(liquidationPrice(12_345, "long", 3, 9_000)).toBe(12_345 - 3_703);
  });
});

describe("price engine", () => {
  const start = Date.UTC(2026, 9, 12, 3, 0);

  it("is deterministic for the same seeds and differs for another secret", () => {
    const a = run(initialMarketState(tickSeq(start, TICK), start), 200, start);
    const b = run(initialMarketState(tickSeq(start, TICK), start), 200, start);
    expect(a).toEqual(b);
    expect(a.coins.FTN.p).not.toBe(COINS.FTN.anchor);
    expect(marketSeed("other", "t:1")).not.toBe(marketSeed(SECRET, "t:1"));
  });

  it("round-trips through the hour document (all but the hidden regime)", () => {
    const state = run(initialMarketState(tickSeq(start, TICK), start), 10, start);
    const { regime: _hidden, ...open } = state;
    expect(stateFromTick(tickFromState(state, "now"), state.atMs)).toEqual(open);
  });

  it("stays near its anchors over a simulated week", () => {
    const state = run(initialMarketState(tickSeq(start, TICK), start), 7 * 24 * 240, start);
    for (const id of COIN_IDS) {
      const ratio = state.coins[id].p / COINS[id].anchor;
      expect(ratio, id).toBeGreaterThan(0.4);
      expect(ratio, id).toBeLessThan(2.5);
    }
  });

  it("rallies a liberated district and sinks FTN", () => {
    const base = initialMarketState(tickSeq(start, TICK), start);
    const world = { liberated: ["wuxia"], houseOpen: false, debtF: 1, heatF: 1 };
    const atMs = start + TICK * 1000, seq = tickSeq(atMs, TICK);
    const { state, feed } = stepMarket(base, { seq, atMs, seeds: { tick: 1, blcNow: 1, blcPast: 1, s9Week: 1 }, config: DEFAULT_MARKET, world });
    expect(state.coins.JWN.p / base.coins.JWN.p).toBeGreaterThan(1.15);
    expect(state.coins.JWN.af).toBeCloseTo(1.3);
    expect(state.coins.FTN.af).toBeCloseTo(0.95);
    expect(feed.map((item) => item.kind)).toContain("liberation");
    const again = stepMarket(state, { seq: seq + 1, atMs: atMs + TICK * 1000, seeds: { tick: 2, blcNow: 2, blcPast: 2, s9Week: 1 }, config: DEFAULT_MARKET, world });
    expect(again.feed.map((item) => item.kind)).not.toContain("liberation");
  });

  it("knows the calendar", () => {
    const sunday21 = Date.UTC(2026, 9, 18, 12, 0); // 2026-10-18 21:00 KST, a Sunday
    expect(rentCrossed(sunday21 - 1_000, sunday21)).toBe(true);
    expect(rentCrossed(sunday21, sunday21 + 1_000)).toBe(false);
    expect(debtFactor(0, 5)).toBe(0.85);
    expect(debtFactor(7_500, 5)).toBe(1);
    const plans = Array.from({ length: 200_000 }, (_, index) => blcPlan(new XorShift32(index).nextUint32(), TICK)).filter((plan) => plan.scheduled);
    expect(plans.length).toBeGreaterThan(30);
    expect(plans.length).toBeLessThan(110);
  });
});

describe("candles", () => {
  it("folds ticks into bars", () => {
    const hour = hourIndexAt(Date.UTC(2026, 9, 12, 3, 0));
    let candle = foldCandle(undefined, 100, 5);
    candle = foldCandle(candle, 120, 1); candle = foldCandle(candle, 90); candle = foldCandle(candle, 110, 4);
    expect(candle).toEqual([100, 120, 90, 110, 10]);
    const doc = { hour, c: { m00: { FTN: candle }, m01: { FTN: [110, 130, 105, 125] }, m05: { FTN: [1, 2, 1, 2] } } } as never;
    const bars = barsFor([doc], "FTN", 5);
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ open: 1, high: 1.3, low: 0.9, close: 1.25, volume: 10 });
    expect(minuteKey(Date.UTC(2026, 9, 12, 3, 7, 30))).toBe("m07");
  });
});

describe("exchange return to player", () => {
  // Hold for a fixed time at a given leverage on a simulated tape; average payout / cost.
  it("keeps the house a few percent ahead", () => {
    const start = Date.UTC(2026, 9, 12, 3, 0);
    let state = initialMarketState(tickSeq(start, TICK), start);
    const prices: number[] = [], ticks = 60 * 24 * 4 * 6;
    const coin: CoinId = "HBT";
    for (let index = 1; index <= ticks; index += 1) {
      const atMs = start + index * TICK * 1000, seq = tickSeq(atMs, TICK);
      state = stepMarket(state, { seq, atMs, seeds: { tick: marketSeed(SECRET, `t:${seq}`), blcNow: 0, blcPast: 0, s9Week: 0 }, config: DEFAULT_MARKET }).state;
      prices.push(state.coins[coin].p);
    }
    const hold = 120; // 30 minutes
    for (const leverage of [3, 10]) {
      let paid = 0, cost = 0;
      for (let open = 0; open + hold < prices.length; open += 7) for (const side of ["long", "short"] as const) {
        const entry = prices[open]!, quote = quoteOpen(DEFAULT_MARKET, coin, side, leverage, 1_000, entry);
        let kind: "close" | "cap" | "liquidated" = "close", exit = prices[open + hold]!;
        for (let step = open + 1; step <= open + hold; step += 1) {
          const trigger = triggerAt(quote, prices[step]!);
          if (trigger) { kind = trigger; exit = trigger === "cap" ? quote.cap : quote.liq; break; }
        }
        const terms = { coin, side, leverage, margin: 1_000, fee: quote.fee, entry, openedAtMs: 0 };
        paid += quoteClose(DEFAULT_MARKET, terms, kind, exit, hold * TICK * 1000).payout;
        cost += quote.cost;
      }
      const rtp = paid / cost;
      expect(rtp, `x${leverage}`).toBeGreaterThan(0.9);
      expect(rtp, `x${leverage}`).toBeLessThan(0.995);
    }
  });
});
