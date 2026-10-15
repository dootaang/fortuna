import type { TimestampLike } from "../ledger.ts";
import { COIN_IDS, type CoinId } from "./coins.ts";
import type { CoinTick, MarketState } from "./engine.ts";
import type { MarketStructure } from "./crowd.ts";

/**
 * market/h{hour}: one document per hour, written by the price recorder every tick.
 * `last` is the latest tick (prices + public engine state); `c.mMM` holds the 1-minute candles.
 * Trades quote `last` and firestore.rules checks it is still the newest tick.
 */
export type Candle = [open: number, high: number, low: number, close: number, volume?: number];

export interface TickDoc<T = TimestampLike> {
  seq: number;
  at: T;
  p: Record<CoinId, number>;
  prev: Record<CoinId, number>;
  prevSeq: number;
  st: {
    coins: Record<CoinId, Omit<CoinTick, "p">>;
    liberated: string[];
    houseOpen: boolean;
    debtF: number;
    heatF: number;
  };
  /** 거래소 2부: long/short, liquidation map and fear & greed (missing on older ticks). */
  fx?: MarketStructure;
}

export interface HourDoc<T = TimestampLike> {
  hour: number;
  last: TickDoc<T>;
  /** "m00".."m59" → coin → candle. */
  c: Record<string, Record<CoinId, Candle>>;
}

export const MARKET_HOUR_MS = 3_600_000;
export function hourIndexAt(epochMs: number): number { return Math.floor(epochMs / MARKET_HOUR_MS); }
export function hourDocId(hour: number): string { return `h${hour}`; }
export function minuteKey(epochMs: number): string { return `m${String(Math.floor((epochMs % MARKET_HOUR_MS) / 60_000)).padStart(2, "0")}`; }
export function minuteStartMs(hour: number, key: string): number { return hour * MARKET_HOUR_MS + Number(key.slice(1)) * 60_000; }

export function tickFromState<T>(state: MarketState, at: T): TickDoc<T> {
  const coins = Object.fromEntries(COIN_IDS.map((id) => {
    const { p: _price, ...rest } = state.coins[id];
    // Firestore cannot store undefined (the crowd is missing while the dealer has it switched off).
    return [id, Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined))];
  })) as TickDoc["st"]["coins"];
  return {
    seq: state.seq, at, p: Object.fromEntries(COIN_IDS.map((id) => [id, state.coins[id].p])) as Record<CoinId, number>,
    prev: { ...state.prev }, prevSeq: state.prevSeq,
    st: { coins, liberated: [...state.liberated], houseOpen: state.houseOpen, debtF: state.debtF, heatF: state.heatF },
  };
}

export function stateFromTick(tick: TickDoc<unknown>, atMs: number): MarketState {
  const coins = Object.fromEntries(COIN_IDS.map((id) => [id, { p: tick.p[id], ...tick.st.coins[id] }])) as Record<CoinId, CoinTick>;
  return {
    seq: tick.seq, atMs, coins, prev: { ...tick.prev }, prevSeq: tick.prevSeq,
    liberated: [...tick.st.liberated], houseOpen: tick.st.houseOpen, debtF: tick.st.debtF, heatF: tick.st.heatF,
  };
}

/** Fold a price (and the tick's volume) into the minute candle. */
export function foldCandle(candle: Candle | undefined, price: number, volume = 0): Candle {
  return candle
    ? [candle[0], Math.max(candle[1], price), Math.min(candle[2], price), price, (candle[4] ?? 0) + volume]
    : [price, price, price, price, volume];
}

export interface ChartBar { time: number; open: number; high: number; low: number; close: number; volume: number; }

/** Candles of one coin from hour docs, merged into bars of `minutes` length (seconds-based time for charts). */
export function barsFor(hours: readonly Pick<HourDoc, "hour" | "c">[], coin: CoinId, minutes: number): ChartBar[] {
  const buckets = new Map<number, ChartBar>();
  const sorted = [...hours].sort((a, b) => a.hour - b.hour);
  for (const doc of sorted) {
    for (const key of Object.keys(doc.c).sort()) {
      const candle = doc.c[key]?.[coin];
      if (!candle) continue;
      const startMs = minuteStartMs(doc.hour, key), bucket = Math.floor(startMs / (minutes * 60_000)) * minutes * 60;
      const bar = buckets.get(bucket);
      if (!bar) buckets.set(bucket, { time: bucket, open: candle[0] / 100, high: candle[1] / 100, low: candle[2] / 100, close: candle[3] / 100, volume: candle[4] ?? 0 });
      else { bar.high = Math.max(bar.high, candle[1] / 100); bar.low = Math.min(bar.low, candle[2] / 100); bar.close = candle[3] / 100; bar.volume += candle[4] ?? 0; }
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}
