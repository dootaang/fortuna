import { COIN_IDS, type CoinId } from "./coins.ts";

/**
 * 거래소 2부 5단계 (docs/SPEC-MARKET-DEPTH.md 6-1): hourly funding. When longs outweigh shorts (crowd + players),
 * longs pay and shorts receive (the manager's vault is the other side). The cumulative index `F` per coin is kept in
 * parts per million in the public tick so firestore.rules can recompute a settlement with integers.
 */
export const FUNDING_SCALE = 1_000_000;
/** M₀ in the rate formula: a small book barely moves the rate. */
export const FUNDING_DEPTH = 5_000;
export const FUNDING_MAX = 0.001;

/** Hourly rate for long and short notional (coins), as a fraction: positive = longs pay. */
export function fundingRate(long: number, short: number): number {
  return Math.min(FUNDING_MAX, Math.max(-FUNDING_MAX, (0.0005 * (long - short)) / (long + short + FUNDING_DEPTH)));
}

/** The same in ppm, as added to the index. */
export function fundingPpm(long: number, short: number): number { return Math.round(fundingRate(long, short) * FUNDING_SCALE); }

/** Funding is charged at every full hour. */
export function fundingDue(prevMs: number, atMs: number): boolean { return Math.floor(prevMs / 3_600_000) < Math.floor(atMs / 3_600_000); }
export function nextFundingAt(ms: number): number { return (Math.floor(ms / 3_600_000) + 1) * 3_600_000; }

/** Add one hour of funding to each coin's index, from the long/short book of the tick. */
export function addFunding(index: Partial<Record<CoinId, number>>, book: Record<CoinId, [number, number]>): Record<CoinId, number> {
  return Object.fromEntries(COIN_IDS.map((id) => [id, (index[id] ?? 0) + fundingPpm(book[id][0], book[id][1])])) as Record<CoinId, number>;
}
