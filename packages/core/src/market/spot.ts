import { floorDiv, tradeFee } from "./position.ts";
import type { MarketConfig } from "./config.ts";

/**
 * 현물. Holdings are counted in 1/10,000 of a coin ("units"); prices are in cents.
 * Value in coins = units × price / 1,000,000. firestore.rules repeats every line.
 */
export const SPOT_UNITS = 10_000;
const SCALE = SPOT_UNITS * 100;

export interface BuyQuote { amount: number; fee: number; cost: number; price: number; units: number; }
export interface SellQuote { units: number; price: number; gross: number; fee: number; payout: number; costOut: number; }

/** Spend `amount` coins (plus the fee) at `price`. */
export function quoteBuy(config: Pick<MarketConfig, "feeBps" | "minFee">, amount: number, price: number): BuyQuote {
  const fee = tradeFee(amount, config);
  return { amount, fee, cost: amount + fee, price, units: floorDiv(amount * SCALE, price) };
}

/** Sell `units` of a holding (`held` units bought for `cost` coins in total). */
export function quoteSell(config: Pick<MarketConfig, "feeBps" | "minFee">, units: number, price: number, held: { units: number; cost: number }): SellQuote {
  const gross = floorDiv(units * price, SCALE), fee = tradeFee(gross, config);
  const costOut = units >= held.units ? held.cost : floorDiv(held.cost * units, held.units);
  return { units, price, gross, fee, payout: Math.max(0, gross - fee), costOut };
}

/** Coins the holding would bring at `price`, before fees. */
export function holdingValue(units: number, price: number): number { return floorDiv(units * price, SCALE); }

/** Average price paid per coin, in cents (0 when empty). */
export function averagePrice(held: { units: number; cost: number }): number { return held.units > 0 ? Math.round((held.cost * SCALE) / held.units) : 0; }

/** "0.2500" */
export function formatUnits(units: number): string { return (units / SPOT_UNITS).toLocaleString("ko-KR", { minimumFractionDigits: 4, maximumFractionDigits: 4 }); }
