import { floorDiv } from "./position.ts";

/**
 * 거래소 2부 6단계 (docs/SPEC-MARKET-DEPTH.md 6-3): a symbolic dividend to spot holders at each earnings
 * announcement — 1% of the holding's value × an earnings multiplier (0.5–1.5), doubled in a liberated district,
 * and never more than an ordinary day's wage (200 coins) per player per week across all coins.
 */
export const DIVIDEND_BPS = 100;
export const DIVIDEND_WEEKLY_CAP = 200;

/** 실적 배율: 1 + surprise, within 0.5–1.5. */
export function dividendMultiplier(surprise: number): number { return Math.min(1.5, Math.max(0.5, 1 + surprise)); }

/** Coins for a holding worth `value` coins at the announcement. */
export function dividendFor(value: number, surprise: number, liberated: boolean): number {
  if (value <= 0) return 0;
  const permille = Math.round(dividendMultiplier(surprise) * 1_000) * (liberated ? 2 : 1);
  return floorDiv(value * DIVIDEND_BPS * permille, 10_000 * 1_000);
}

/** dividendClaims/{week}_{pid}: what the recorder credited this week and what the player has collected. */
export interface DividendClaim<T = unknown> {
  playerId: string;
  week: number;
  /** Per coin, coins credited. */
  items: Record<string, number>;
  total: number;
  claimed: number;
  at: T;
  lastLedger: string | null;
}

/** Add `amount` for `coin` to a week's claim without going over the weekly cap. */
export function creditClaim(claim: Pick<DividendClaim, "items" | "total"> | null, coin: string, amount: number): { items: Record<string, number>; total: number; added: number } {
  const total0 = claim?.total ?? 0, added = Math.max(0, Math.min(amount, DIVIDEND_WEEKLY_CAP - total0));
  const items = { ...(claim?.items ?? {}) };
  if (added > 0) items[coin] = (items[coin] ?? 0) + added;
  return { items, total: total0 + added, added };
}
