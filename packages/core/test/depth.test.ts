import { describe, expect, it } from "vitest";
import {
  COIN_IDS, CROWD_BASE, DEFAULT_MARKET, XorShift32, coinStructure, fearGreed, fearGreedLabel, initialCrowd, initialMarketState, marketSeed, seedKeys, stepCrowd,
  stepMarket, tickFromState, tickSeq, weeklyLevy, type CoinId, type MarketState,
} from "../src/index.ts";

/** docs/SPEC-MARKET-DEPTH.md 1단계: the crowd, market structure and the weekly profit cap. */
const TICK = DEFAULT_MARKET.tickSeconds;
const SECRET = "depth-secret";

function run(state: MarketState, ticks: number, startMs: number, config: Parameters<typeof stepMarket>[1]["config"] = DEFAULT_MARKET) {
  let current = state, flow = 0;
  for (let index = 1; index <= ticks; index += 1) {
    const atMs = startMs + index * TICK * 1000, seq = tickSeq(atMs, TICK), keys = seedKeys(seq, atMs, TICK);
    const seeds = { tick: marketSeed(SECRET, keys.tick), blcNow: marketSeed(SECRET, keys.blcNow), blcPast: marketSeed(SECRET, keys.blcPast), s9Week: marketSeed(SECRET, keys.s9Week) };
    const stepped = stepMarket(current, { seq, atMs, seeds, config });
    current = stepped.state; flow += stepped.flow.FTN;
  }
  return { state: current, flow };
}

describe("crowd", () => {
  it("does not change the price path", () => {
    const start = Date.UTC(2026, 9, 12, 3, 0), base = initialMarketState(tickSeq(start, TICK), start);
    const withCrowd = run(base, 400, start).state, without = run(base, 400, start, { ...DEFAULT_MARKET, npc: { enabled: false, scale: 1 } }).state;
    for (const id of COIN_IDS) expect(withCrowd.coins[id].p).toBe(without.coins[id].p);
    expect(without.coins.FTN.npc).toBeUndefined();
    expect(withCrowd.coins.FTN.npc!.oi).toBeGreaterThan(0);
  });

  it("stays within its bounds over a simulated week and produces volume", () => {
    const start = Date.UTC(2026, 9, 12, 3, 0);
    const { state, flow } = run(initialMarketState(tickSeq(start, TICK), start), 7 * 24 * 240, start);
    for (const id of COIN_IDS) {
      const crowd = state.coins[id].npc!;
      expect(crowd.lr).toBeGreaterThanOrEqual(0.2);
      expect(crowd.lr).toBeLessThanOrEqual(0.8);
      expect(crowd.oi).toBeGreaterThan(CROWD_BASE[id] * 0.2);
      expect(crowd.oi).toBeLessThan(CROWD_BASE[id] * 2);
      expect(Number.isFinite(state.coins[id].lp!)).toBe(true);
    }
    // About six turnovers a day of 30,000 FTN, and more when it moves.
    expect(flow / 7).toBeGreaterThan(30_000 * 3);
    expect(flow / 7).toBeLessThan(30_000 * 40);
    // Ticks stay storable: no undefined, no NaN.
    expect(JSON.stringify(tickFromState(state, 0))).not.toMatch(/NaN|null/);
  });

  it("follows a rally late, then a sharp drop liquidates its longs", () => {
    const rng = new XorShift32(7);
    let crowd = initialCrowd("HBT", 25_000), price = 25_000;
    for (let i = 0; i < 240; i += 1) { const next = Math.round(price * 1.0004); crowd = stepCrowd(crowd, "HBT", price, next, 1 / 240, 3, 1, 1, rng).crowd; price = next; }
    expect(crowd.lr).toBeGreaterThan(0.6);
    const crash = stepCrowd(crowd, "HBT", price, Math.round(price * 0.85), 1 / 240, -5, 2, 1, rng);
    expect(crash.liquidated).toBeGreaterThan(crowd.oi * crowd.lr * 0.12);
    expect(crash.crowd.lr).toBeLessThan(crowd.lr);
  });
});

describe("market structure", () => {
  it("mixes the crowd with player positions and maps where liquidations sit", () => {
    const crowd = { oi: 10_000, lr: 0.6, px: 10_000 };
    const lots = [
      { coin: "WHL" as CoinId, side: "long" as const, notional: 1_000, liq: 9_700 },
      { coin: "WHL" as CoinId, side: "short" as const, notional: 500, liq: 10_400 },
      { coin: "FTN" as CoinId, side: "long" as const, notional: 9_999, liq: 1 },
    ];
    const s = coinStructure("WHL", 10_000, crowd, lots);
    expect(s.ls).toEqual([7_000, 4_500]);
    expect(s.lm).toHaveLength(10);
    expect(s.lm[1]).toBeGreaterThanOrEqual(1_000); // the player's long, 3% below
    expect(s.lm[5 + 1]).toBeGreaterThanOrEqual(500); // the player's short, 4% above
    expect(s.lm.every((value) => value % 100 === 0)).toBe(true);
    // Without the crowd only player positions show (rounded to 100).
    expect(coinStructure("WHL", 10_000, undefined, lots).ls).toEqual([1_000, 500]);
  });

  it("reads fear and greed from what anyone can see", () => {
    const calm = Object.fromEntries(COIN_IDS.map((id) => [id, { ret1h: 0.01, sigma: 0.02, realised: 0.015 }])) as Parameters<typeof fearGreed>[0]["coins"];
    const panic = Object.fromEntries(COIN_IDS.map((id) => [id, { ret1h: -0.05, sigma: 0.02, realised: 0.06 }])) as Parameters<typeof fearGreed>[0]["coins"];
    const greed = fearGreed({ coins: calm, liquidated: 0, open: 100_000, longShare: 0.7 });
    const fear = fearGreed({ coins: panic, liquidated: 20_000, open: 100_000, longShare: 0.3 });
    expect(greed).toBeGreaterThan(70);
    expect(fear).toBeLessThan(10);
    expect(fearGreedLabel(fear)).toBe("극도의 공포");
    expect(fearGreedLabel(50)).toBe("중립");
  });
});

describe("weekly profit cap", () => {
  it("levies only the week's net above the cap, offsets losses and starts over each week", () => {
    expect(weeklyLevy(undefined, 10, 3_000, 5_000)).toEqual({ profit: 3_000, levy: 0, after: { week: 10, net: 3_000 } });
    expect(weeklyLevy({ week: 10, net: 3_000 }, 10, 4_000, 5_000)).toEqual({ profit: 4_000, levy: 2_000, after: { week: 10, net: 5_000 } });
    expect(weeklyLevy({ week: 10, net: 5_000 }, 10, -1_500, 5_000)).toEqual({ profit: -1_500, levy: 0, after: { week: 10, net: 3_500 } });
    expect(weeklyLevy({ week: 10, net: 5_000 }, 11, 4_000, 5_000).levy).toBe(0);
    expect(weeklyLevy({ week: 10, net: 50_000 }, 10, 4_000, 0).levy).toBe(0);
    // The dealer lowered the cap mid-week: never more than this settlement's own profit.
    expect(weeklyLevy({ week: 10, net: 8_000 }, 10, 300, 5_000).levy).toBe(300);
  });
});

describe("chart indicators", () => {
  it("computes moving averages, Bollinger bands and RSI", async () => {
    const { sma, bollinger, rsi } = await import("../src/index.ts");
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    const band = bollinger([2, 2, 2, 2], 2, 2);
    expect(band[3]).toEqual({ mid: 2, upper: 2, lower: 2 });
    const rising = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(rsi(rising, 14)[29]).toBe(100);
    const zigzag = Array.from({ length: 60 }, (_, i) => 100 + (i % 2 ? 1 : -1));
    expect(rsi(zigzag, 14)[59]).toBeGreaterThan(40);
    expect(rsi(zigzag, 14)[59]).toBeLessThan(60);
    expect(rsi(zigzag, 14)[5]).toBeNull();
  });
});
