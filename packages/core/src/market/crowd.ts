import { XorShift32 } from "../rng.ts";
import { COIN_IDS, COINS, type CoinId } from "./coins.ts";
import type { Side } from "./position.ts";
import type { MarketState } from "./engine.ts";

/**
 * 거래소 2부 1단계 (docs/SPEC-MARKET-DEPTH.md 2절): the city's other traders as one virtual crowd per coin,
 * and the market structure everyone sees (long/short, liquidation map, volume, fear & greed).
 * The crowd moves no coins and does not move prices; it moves with the secret tick seed, so its share
 * cannot be subtracted to reveal what the players hold.
 */
export interface Crowd {
  /** Total notional, coins. */
  oi: number;
  /** Long share of the notional, 0.2–0.8. */
  lr: number;
  /** Average entry price, cents (an EMA of recent prices). */
  px: number;
}

/** Leverage mix of the crowd. */
export const CROWD_LEVERAGE: readonly { lev: number; w: number }[] = [{ lev: 2, w: 0.35 }, { lev: 5, w: 0.35 }, { lev: 10, w: 0.2 }, { lev: 20, w: 0.1 }];

/** Usual crowd size per coin: about ten times a day of player trading. */
export const CROWD_BASE: Readonly<Record<CoinId, number>> = {
  FTN: 30_000, WHL: 15_000, HBT: 12_000, LNH: 9_000, JWN: 10_000, S9: 12_000, ORB: 8_000, BLC: 10_000, MWL: 8_000,
};

/** Where a leveraged crowd position is liquidated: entry ∓ 90% of a 1/leverage move, spread ±35% of that move. */
const SPREAD = 0.35, POINTS = 8;

export function initialCrowd(coin: CoinId, price: number, scale = 1): Crowd {
  return { oi: Math.round(CROWD_BASE[coin] * scale), lr: 0.5, px: price };
}

/** Fraction of the crowd's longs (or shorts) of one leverage already liquidated at `price`. */
function goneFraction(side: Side, px: number, lev: number, price: number): number {
  const move = 0.9 / lev, centre = side === "long" ? px * (1 - move) : px * (1 + move), half = px * move * SPREAD;
  const f = side === "long" ? (centre + half - price) / (2 * half) : (price - (centre - half)) / (2 * half);
  return Math.min(1, Math.max(0, f));
}

function normal(rng: XorShift32): number {
  const u = Math.max(rng.next(), 1e-12), v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface CrowdStep {
  crowd: Crowd;
  /** Notional the move liquidated, coins. */
  liquidated: number;
  /** Notional that changed hands (entries, exits, liquidations), coins: the virtual volume. */
  flow: number;
}

/**
 * One tick of the crowd. It follows the trend late (`z` = last hour's return in hourly sigmas),
 * leans back to even, is liquidated when the price runs through its liquidation band, and refills
 * toward its usual size (larger when the market is wild).
 */
export function stepCrowd(crowd: Crowd, coin: CoinId, prevPrice: number, price: number, hours: number, z: number, wild: number, scale: number, rng: XorShift32): CrowdStep {
  let long = crowd.oi * crowd.lr, short = crowd.oi * (1 - crowd.lr), liquidated = 0;
  for (const { lev, w } of CROWD_LEVERAGE) {
    for (const side of ["long", "short"] as const) {
      const before = goneFraction(side, crowd.px, lev, prevPrice), after = goneFraction(side, crowd.px, lev, price);
      if (after <= before || before >= 1) continue;
      const share = w * ((after - before) / (1 - before));
      if (side === "long") { const cut = long * share; long -= cut; liquidated += cut; }
      else { const cut = short * share; short -= cut; liquidated += cut; }
    }
  }
  const oi0 = long + short;
  let lr = oi0 > 0 ? long / oi0 : 0.5;
  lr += (0.15 * Math.max(-3, Math.min(3, z)) - 0.5 * (lr - 0.5)) * hours + 0.05 * Math.sqrt(hours) * normal(rng);
  lr = Math.min(0.8, Math.max(0.2, lr));
  const target = CROWD_BASE[coin] * scale * (1 + 0.5 * Math.min(1, Math.max(0, wild - 1)));
  const refill = (target - oi0) * (1 - Math.exp(-hours / 3));
  const oi = Math.max(0, oi0 + refill);
  const churn = oi * (6 / 24) * hours * (1 + Math.min(3, Math.abs(z)));
  const px = crowd.px + (price - crowd.px) * (1 - Math.exp(-hours / 2));
  return { crowd: { oi: Math.round(oi), lr: Math.round(lr * 1_000) / 1_000, px: Math.round(px) }, liquidated, flow: churn + Math.abs(refill) + liquidated };
}

// ── 보이는 시장 구조 ──

/** An open player position as the recorder sees it. */
export interface OpenLot { coin: CoinId; side: Side; notional: number; liq: number; }

/** Liquidation map bands, as distance from the price: 0–2%, 2–5%, 5–10%, 10–20%, 20%+. */
export const LIQ_BANDS = [0.02, 0.05, 0.1, 0.2, Number.POSITIVE_INFINITY] as const;

function band(distance: number): number { return LIQ_BANDS.findIndex((edge) => distance < edge); }

const round100 = (value: number) => Math.round(value / 100) * 100;

export interface CoinStructure {
  /** Long and short notional, crowd + players, to 100 coins. */
  ls: [number, number];
  /** Notional liquidated if the price moves down into each band (longs), then up (shorts); to 100 coins. */
  lm: number[];
}

/** Long/short and the liquidation map of one coin. */
export function coinStructure(coin: CoinId, price: number, crowd: Crowd | undefined, lots: readonly OpenLot[]): CoinStructure {
  let long = 0, short = 0;
  const down = [0, 0, 0, 0, 0], up = [0, 0, 0, 0, 0];
  if (crowd) {
    long += crowd.oi * crowd.lr; short += crowd.oi * (1 - crowd.lr);
    for (const { lev, w } of CROWD_LEVERAGE) {
      const move = 0.9 / lev, half = crowd.px * move * SPREAD;
      for (const side of ["long", "short"] as const) {
        const centre = side === "long" ? crowd.px * (1 - move) : crowd.px * (1 + move);
        const points = Array.from({ length: POINTS }, (_, i) => centre - half + (2 * half * (i + 0.5)) / POINTS)
          .filter((at) => (side === "long" ? at < price : at > price));
        const total = (side === "long" ? crowd.oi * crowd.lr : crowd.oi * (1 - crowd.lr)) * w;
        for (const at of points) (side === "long" ? down : up)[band(Math.abs(price - at) / price)]! += total / Math.max(1, points.length);
      }
    }
  }
  for (const lot of lots) {
    if (lot.coin !== coin) continue;
    if (lot.side === "long") long += lot.notional; else short += lot.notional;
    if (lot.side === "long" ? lot.liq < price : lot.liq > price) (lot.side === "long" ? down : up)[band(Math.abs(price - lot.liq) / price)]! += lot.notional;
  }
  return { ls: [round100(long), round100(short)], lm: [...down, ...up].map(round100) };
}

export interface FearGreedInput {
  /** Per coin: last hour's log return and the expected hourly sigma, realised hourly sigma. */
  coins: Record<CoinId, { ret1h: number; sigma: number; realised: number }>;
  /** Notional liquidated in about the last hour, and the total open notional. */
  liquidated: number;
  open: number;
  /** Long share of all open notional. */
  longShare: number;
}

/** 0 (extreme fear) – 100 (extreme greed), from what anyone can observe. */
export function fearGreed(input: FearGreedInput): number {
  const rising = COIN_IDS.filter((id) => input.coins[id].ret1h > 0).length / COIN_IDS.length;
  const ftn = input.coins.FTN, trend = (Math.max(-2, Math.min(2, ftn.ret1h / Math.max(1e-9, ftn.sigma))) + 2) / 4;
  const wild = COIN_IDS.reduce((sum, id) => sum + input.coins[id].realised / Math.max(1e-9, input.coins[id].sigma), 0) / COIN_IDS.length;
  const calm = Math.min(1, Math.max(0, 0.5 - (wild - 1) * 0.5));
  const liq = Math.min(1, Math.max(0, 1 - input.liquidated / Math.max(1, input.open) / 0.08));
  const lean = Math.min(1, Math.max(0, (input.longShare - 0.3) / 0.4));
  return Math.round(100 * (0.25 * rising + 0.25 * trend + 0.2 * calm + 0.15 * liq + 0.15 * lean));
}

export function fearGreedLabel(value: number): string {
  return value < 20 ? "극도의 공포" : value < 40 ? "공포" : value <= 60 ? "중립" : value <= 80 ? "탐욕" : "극도의 탐욕";
}

/** Public structure written next to each tick (`last.fx`). */
export interface MarketStructure {
  ls: Record<CoinId, [number, number]>;
  lm: Record<CoinId, number[]>;
  fg: number;
}

export function crowdSeed(tickSeed: number): number { return (tickSeed ^ 0x5bd1e995) >>> 0; }

export function usualSigma(coin: CoinId, volMult = 1): number { return COINS[coin].volH * volMult; }

/** Everything the recorder publishes next to a tick, from the stepped state and the open player positions. */
export function buildStructure(state: Pick<MarketState, "coins">, lots: readonly OpenLot[], volMult: (coin: CoinId) => number = () => 1): MarketStructure {
  const ls = {} as MarketStructure["ls"], lm = {} as MarketStructure["lm"];
  let long = 0, open = 0, liquidated = 0;
  const coins = {} as FearGreedInput["coins"];
  for (const id of COIN_IDS) {
    const tick = state.coins[id], structure = coinStructure(id, tick.p, tick.npc, lots);
    ls[id] = structure.ls; lm[id] = structure.lm;
    long += structure.ls[0]; open += structure.ls[0] + structure.ls[1]; liquidated += tick.lq ?? 0;
    const sigma = usualSigma(id, volMult(id));
    coins[id] = { ret1h: tick.lp === undefined ? 0 : Math.log(tick.p) - tick.lp, sigma, realised: tick.rv === undefined ? sigma : Math.sqrt(tick.rv) };
  }
  return { ls, lm, fg: fearGreed({ coins, liquidated, open, longShare: open > 0 ? long / open : 0.5 }) };
}
