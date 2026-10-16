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

  it("stays informative on coins the dealer made more volatile (production: FTN ×4, the rest ×2)", () => {
    const start = Date.UTC(2026, 9, 12, 3, 0);
    const config = { ...DEFAULT_MARKET, coins: Object.fromEntries(COIN_IDS.map((id) => [id, { enabled: true, paused: false, volMult: id === "FTN" ? 4 : 2 }])) as typeof DEFAULT_MARKET.coins };
    let state = initialMarketState(tickSeq(start, TICK), start);
    const pinned: Record<string, number> = {}, size: Record<string, number> = {};
    const ticks = 2 * 24 * 240;
    for (let index = 1; index <= ticks; index += 1) {
      const atMs = start + index * TICK * 1000, seq = tickSeq(atMs, TICK), keys = seedKeys(seq, atMs, TICK);
      state = stepMarket(state, { seq, atMs, seeds: { tick: marketSeed(SECRET, keys.tick), blcNow: marketSeed(SECRET, keys.blcNow), blcPast: marketSeed(SECRET, keys.blcPast), s9Week: marketSeed(SECRET, keys.s9Week) }, config }).state;
      for (const id of COIN_IDS) {
        const crowd = state.coins[id].npc!;
        if (crowd.lr <= 0.2 || crowd.lr >= 0.8) pinned[id] = (pinned[id] ?? 0) + 1;
        size[id] = (size[id] ?? 0) + crowd.oi / CROWD_BASE[id];
      }
    }
    for (const id of COIN_IDS) {
      expect((pinned[id] ?? 0) / ticks, `${id} long share pinned to a bound`).toBeLessThan(0.15);
      expect(size[id]! / ticks, `${id} average crowd size`).toBeGreaterThan(0.75);
    }
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

describe("earnings (2단계)", () => {
  it("announces each coin once a week at 21:00 KST, prices in hints, moves the anchor and stays bounded for 13 weeks", async () => {
    const { earningsAt, fundamentalsInput, weekIndexAt, consensus, COINS } = await import("../src/index.ts");
    const start = Date.UTC(2026, 9, 11, 15, 0); // Monday 00:00 KST
    const week0 = weekIndexAt(start);
    expect(earningsAt("HBT", week0)).toBe(start + 21 * 3_600_000);
    expect(earningsAt("FTN", week0)).toBe(start + 6 * 86_400_000 + 21 * 3_600_000);
    const cache = new Map<string, number>(), sign = (key: string) => { if (!cache.has(key)) cache.set(key, marketSeed(SECRET, key)); return cache.get(key)!; };
    const tick = 60; // coarser ticks keep the 13-week run quick; the engine steps by elapsed time
    let state = initialMarketState(tickSeq(start, tick), start), feeds = 0;
    const weeks = 13, steps = (weeks * 7 * 86_400) / tick;
    let maxPre = 0;
    for (let index = 1; index <= steps; index += 1) {
      const atMs = start + index * tick * 1000, seq = state.seq + 1, keys = seedKeys(seq, atMs, tick);
      const stepped = stepMarket(state, {
        seq, atMs, seeds: { tick: marketSeed(SECRET, keys.tick), blcNow: marketSeed(SECRET, keys.blcNow), blcPast: marketSeed(SECRET, keys.blcPast), s9Week: marketSeed(SECRET, keys.s9Week) }, config: { ...DEFAULT_MARKET, tickSeconds: tick },
        fundamentals: fundamentalsInput(sign, atMs),
      });
      state = stepped.state;
      feeds += stepped.feed.filter((item) => item.kind === "earnings").length;
      for (const id of COIN_IDS) maxPre = Math.max(maxPre, Math.abs(state.coins[id].pre ?? 0));
    }
    expect(feeds).toBe(weeks * COIN_IDS.length);
    expect(maxPre).toBeLessThanOrEqual(0.06 + 1e-9);
    for (const id of COIN_IDS) {
      const coin = state.coins[id];
      expect(coin.eh).toHaveLength(4);
      expect(coin.ff).toBeGreaterThanOrEqual(0.8);
      expect(coin.ff).toBeLessThanOrEqual(1.3);
      expect(coin.p).toBeGreaterThan(COINS[id].anchor / 50);
      expect(coin.p).toBeLessThan(COINS[id].anchor * 50);
      expect(Math.abs(consensus(coin.eh))).toBeLessThan(0.36);
    }
  }, 120_000);

  it("measures resident activity against an ordinary week, capping the players' share at ±6%", async () => {
    const { activityRatio, playerShare, heatShare, rateShock, weekCalendar, analystBand, moodWords } = await import("../src/index.ts");
    expect(activityRatio({ work: 35, repay: 300, skill: 2, residents: 1 })).toBe(1);
    expect(activityRatio({ work: 0, repay: 0, skill: 0, residents: 0 })).toBeNull();
    expect(playerShare(1.4)).toBeCloseTo(0.024);
    expect(playerShare(5)).toBe(0.06);
    expect(playerShare(null)).toBe(0);
    expect(heatShare(1.1)).toBeCloseTo(0.06);
    expect(rateShock("FTN", 5)).toBeCloseTo(0.98);
    expect(rateShock("HBT", 5)).toBeCloseTo(0.974);
    const week = 2_962, calendar = weekCalendar(week, [{ atMs: Date.UTC(2026, 9, 14, 3), bps: 25 }]);
    expect(calendar.filter((item) => item.kind === "earnings")).toHaveLength(9);
    expect(calendar.some((item) => item.kind === "rate")).toBe(true);
    expect(analystBand("FTN", 100_000, 100_000, 0, 1)).toBeNull();
    const band = analystBand("LNH", 12_000, 12_000, 0, 7)!;
    expect(band.low).toBeLessThan(band.mid);
    expect(band.high).toBeGreaterThan(band.mid);
    expect(moodWords(0.2)).toContain("아주 좋다");
  });
});

describe("balance (원칙 4)", () => {
  it("keeps the hint reader under 103% and a blind bettor near the house edge", async () => {
    const { earningsAt, fundamentalsInput, weekIndexAt, quoteOpen, quoteClose } = await import("../src/index.ts");
    const start = Date.UTC(2026, 9, 11, 15, 0), tick = 60, weeks = 26;
    const cache = new Map<string, number>(), sign = (key: string) => { if (!cache.has(key)) cache.set(key, marketSeed(SECRET + "b", key)); return cache.get(key)!; };
    let state = initialMarketState(tickSeq(start, tick), start);
    type Bet = { coin: CoinId; side: "long" | "short"; entry: number; openedAtMs: number; closeAt: number; fee: number; blind: boolean };
    const open: Bet[] = [], paid = { reader: 0, blind: 0 }, cost = { reader: 0, blind: 0 };
    let flip = 0;
    for (let index = 1; index <= (weeks * 7 * 86_400) / tick; index += 1) {
      const atMs = start + index * tick * 1000, seq = state.seq + 1, keys = seedKeys(seq, atMs, tick);
      const fundamentals = fundamentalsInput(sign, atMs);
      state = stepMarket(state, { seq, atMs, seeds: { tick: marketSeed(SECRET, keys.tick), blcNow: marketSeed(SECRET, keys.blcNow), blcPast: marketSeed(SECRET, keys.blcPast), s9Week: marketSeed(SECRET, keys.s9Week) }, config: { ...DEFAULT_MARKET, tickSeconds: tick }, fundamentals }).state;
      for (const coin of COIN_IDS) {
        const due = earningsAt(coin, weekIndexAt(atMs));
        if (due - atMs > 3_540_000 && due - atMs <= 3_600_000) {
          const read = fundamentals.mood[coin] + (state.coins[coin].spc ?? 0);
          const price = state.coins[coin].p;
          if (Math.abs(read) > 0.1) open.push({ coin, side: read > 0 ? "long" : "short", entry: price, openedAtMs: atMs, closeAt: due + 3_600_000, fee: quoteOpen(DEFAULT_MARKET, coin, "long", 5, 100, price).fee, blind: false });
          open.push({ coin, side: flip++ % 2 ? "long" : "short", entry: price, openedAtMs: atMs, closeAt: due + 3_600_000, fee: quoteOpen(DEFAULT_MARKET, coin, "long", 5, 100, price).fee, blind: true });
        }
      }
      for (let i = open.length - 1; i >= 0; i -= 1) {
        const bet = open[i]!, price = state.coins[bet.coin].p;
        const liq = bet.side === "long" ? price <= bet.entry * (1 - 0.9 / 5) : price >= bet.entry * (1 + 0.9 / 5);
        if (atMs < bet.closeAt && !liq) continue;
        const quote = quoteClose(DEFAULT_MARKET, { coin: bet.coin, side: bet.side, leverage: 5, margin: 100, fee: bet.fee, entry: bet.entry, openedAtMs: bet.openedAtMs }, liq ? "liquidated" : "close", price, atMs);
        const who = bet.blind ? "blind" : "reader";
        paid[who] += quote.payout; cost[who] += 100 + bet.fee;
        open.splice(i, 1);
      }
    }
    const reader = paid.reader / cost.reader, blind = paid.blind / cost.blind;
    expect(cost.reader).toBeGreaterThan(0);
    expect(reader).toBeLessThan(1.03);
    expect(blind).toBeGreaterThan(0.9);
    expect(blind).toBeLessThan(1.0);
    console.info(`balance: hint reader ${(reader * 100).toFixed(1)}%, blind ${(blind * 100).toFixed(1)}%`);
  }, 180_000);
});

describe("automatic news balance (3단계, 원칙 4)", () => {
  it("lets no simple news strategy beat 103%, at high leverage or none", async () => {
    const { quoteClose, tradeFee } = await import("../src/index.ts");
    const start = Date.UTC(2026, 9, 11, 15, 0), tick = 30, days = 120;
    let state = initialMarketState(tickSeq(start, tick), start);
    type Bet = { name: string; coin: CoinId; side: "long" | "short"; lev: number; entry: number; openedAtMs: number; closeAt: number; fee: number };
    const open: Bet[] = [], paid: Record<string, number> = {}, cost: Record<string, number> = {}, count: Record<string, number> = {};
    const enter = (name: string, coin: CoinId, dir: number, holdMs: number, atMs: number) => {
      for (const lev of [1, coin === "FTN" ? 20 : 10]) {
        const entry = state.coins[coin].p, fee = tradeFee(100 * lev, DEFAULT_MARKET);
        open.push({ name: `${name}@${lev}x`, coin, side: dir > 0 ? "long" : "short", lev, entry, openedAtMs: atMs, closeAt: atMs + holdMs, fee });
      }
    };
    for (let index = 1; index <= (days * 86_400) / tick; index += 1) {
      const atMs = start + index * tick * 1000, seq = state.seq + 1, keys = seedKeys(seq, atMs, tick);
      const stepped = stepMarket(state, { seq, atMs, seeds: { tick: marketSeed(SECRET, keys.tick), blcNow: marketSeed(SECRET, keys.blcNow), blcPast: marketSeed(SECRET, keys.blcPast), s9Week: marketSeed(SECRET, keys.s9Week) }, config: { ...DEFAULT_MARKET, tickSeconds: tick } });
      state = stepped.state;
      for (const item of stepped.feed) {
        if (!item.coin) continue;
        const dir = item.tone === "up" ? 1 : item.tone === "down" ? -1 : 0;
        if (!dir) continue;
        if (item.kind === "autoOfficial") enter("follow official", item.coin, dir, 2 * 3_600_000, atMs);
        if (item.kind === "autoPaper") { enter("follow paper", item.coin, dir, 91 * 60_000, atMs); enter("fade paper", item.coin, -dir, 91 * 60_000, atMs); }
        if (item.kind === "autoRumor") enter("follow rumor", item.coin, dir, 11 * 60_000, atMs);
        if (item.kind === "autoTrue") enter("sell the news", item.coin, -dir, 3_600_000, atMs);
      }
      for (let i = open.length - 1; i >= 0; i -= 1) {
        const bet = open[i]!, price = state.coins[bet.coin].p, move = 0.9 / bet.lev;
        const liq = bet.lev > 1 && (bet.side === "long" ? price <= bet.entry * (1 - move) : price >= bet.entry * (1 + move));
        if (atMs < bet.closeAt && !liq) continue;
        const quote = quoteClose(DEFAULT_MARKET, { coin: bet.coin, side: bet.side, leverage: bet.lev, margin: 100, fee: bet.fee, entry: bet.entry, openedAtMs: bet.openedAtMs }, liq ? "liquidated" : "close", price, atMs);
        paid[bet.name] = (paid[bet.name] ?? 0) + quote.payout; cost[bet.name] = (cost[bet.name] ?? 0) + 100 + bet.fee; count[bet.name] = (count[bet.name] ?? 0) + 1;
        open.splice(i, 1);
      }
    }
    const ratios = Object.fromEntries(Object.keys(paid).map((name) => [name, Math.round((paid[name]! / cost[name]!) * 1_000) / 10]));
    for (const [name, ratio] of Object.entries(ratios)) expect(ratio, name).toBeLessThan(103);
    expect(count["follow official@1x"]).toBeGreaterThan(100);
  }, 300_000);
});
