import { COIN_IDS, COINS, type CoinId } from "./coins.ts";

/**
 * 거래소 2부 7단계 (docs/SPEC-MARKET-DEPTH.md 3-2, 3-4, 3-5): sectors, FTN dominance and the correlation table.
 */
export const SECTORS = {
  old: { label: "옛 세계", coins: ["LNH", "JWN", "BLC"] as CoinId[], note: "왕국과 강호와 무도회" },
  new: { label: "새 세계", coins: ["HBT", "S9", "ORB"] as CoinId[], note: "탑과 회사와 정거장" },
  night: { label: "밤과 판", coins: ["WHL", "MWL"] as CoinId[], note: "판돈로와 호텔" },
} as const;
export type SectorId = keyof typeof SECTORS;
export const SECTOR_IDS = Object.keys(SECTORS) as SectorId[];
/** Weight of the shared sector noise in an alt's move. */
export const SECTOR_WEIGHT = 0.4;

export function sectorOf(coin: CoinId): SectorId | null {
  return SECTOR_IDS.find((id) => (SECTORS[id].coins as readonly CoinId[]).includes(coin)) ?? null;
}

/**
 * Noise weights for an alt with FTN coupling `beta`: common, sector and own parts with
 * beta² + s² ≤ 0.95 so the coin keeps a little of its own life.
 */
export function noiseWeights(beta: number): { common: number; sector: number; own: number } {
  let sector = SECTOR_WEIGHT;
  if (beta * beta + sector * sector > 0.95) sector = Math.sqrt(Math.max(0, 0.95 - beta * beta));
  return { common: beta, sector, own: Math.sqrt(Math.max(0, 1 - beta * beta - sector * sector)) };
}

/** Fixed supply (3-4): FTN 10,000; each alt's anchor value is 1/8 of FTN's, so dominance starts near 50%. */
export const SUPPLY: Readonly<Record<CoinId, number>> = Object.fromEntries(COIN_IDS.map((id) => [
  id, id === "FTN" ? 10_000 : Math.round((COINS.FTN.anchor * 10_000) / 8 / COINS[id].anchor),
])) as Record<CoinId, number>;

/** FTN's share of the total market value, 0–1. */
export function dominance(prices: Record<CoinId, number>): number {
  const caps = COIN_IDS.map((id) => prices[id] * SUPPLY[id]), total = caps.reduce((sum, cap) => sum + cap, 0);
  return total > 0 ? (prices.FTN * SUPPLY.FTN) / total : 0;
}

/** Pearson correlation of two return series (same length). */
export function correlation(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i += 1) { ma += a[i]!; mb += b[i]!; }
  ma /= n; mb /= n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i += 1) { const da = a[i]! - ma, db = b[i]! - mb; cov += da * db; va += da * da; vb += db * db; }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
}

/** market/stats, rewritten by the recorder every full hour. */
export interface StatsDoc<T = unknown> {
  at: T;
  /** Hourly closes per coin, oldest first, up to 7 days (the recorder keeps its own short history here). */
  hourly: Record<CoinId, number[]>;
  /** 24-hour change per coin (fraction). */
  change: Record<CoinId, number>;
  /** Correlation of hourly returns over the last 3 days: a row per coin, columns in COIN_IDS order, two decimals (Firestore allows no nested arrays). */
  corr: Record<CoinId, number[]>;
  /** FTN dominance now, and hourly for up to 7 days (oldest first). */
  dominance: number;
  domHistory: number[];
  /** 24-hour change per sector (average of its coins). */
  sectors: Record<SectorId, number>;
}

export const STATS_KEEP_HOURS = 168;
export const CORRELATION_HOURS = 72;

/**
 * The next market/stats from the previous one and the prices now. Hourly returns over three days stand in for the
 * spec's 24 hours of 1-minute candles: reading those would cost the recorder far more time than it has per tick.
 */
export function buildStats(previous: Pick<StatsDoc, "hourly" | "domHistory"> | null, prices: Record<CoinId, number>, at: unknown): StatsDoc {
  const hourly = Object.fromEntries(COIN_IDS.map((id) => [id, [...(previous?.hourly?.[id] ?? []), prices[id]].slice(-STATS_KEEP_HOURS)])) as Record<CoinId, number[]>;
  const returns = Object.fromEntries(COIN_IDS.map((id) => {
    const series = hourly[id].slice(-(CORRELATION_HOURS + 1));
    return [id, series.slice(1).map((close, i) => Math.log(close / series[i]!))];
  })) as Record<CoinId, number[]>;
  const change = Object.fromEntries(COIN_IDS.map((id) => {
    const series = hourly[id], from = series[Math.max(0, series.length - 25)]!;
    return [id, series.length > 1 ? Math.round((series.at(-1)! / from - 1) * 10_000) / 10_000 : 0];
  })) as Record<CoinId, number>;
  const corr = Object.fromEntries(COIN_IDS.map((a) => [a, COIN_IDS.map((b) => (a === b ? 1 : Math.round(correlation(returns[a], returns[b]) * 100) / 100))])) as Record<CoinId, number[]>;
  const dom = Math.round(dominance(prices) * 10_000) / 10_000;
  const sectors = Object.fromEntries(SECTOR_IDS.map((id) => {
    const coins = SECTORS[id].coins;
    return [id, Math.round((coins.reduce((sum, coin) => sum + change[coin], 0) / coins.length) * 10_000) / 10_000];
  })) as Record<SectorId, number>;
  return { at, hourly, change, corr, dominance: dom, domHistory: [...(previous?.domHistory ?? []), dom].slice(-STATS_KEEP_HOURS), sectors };
}
