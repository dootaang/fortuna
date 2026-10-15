import { isMoonlessNight, type CoinId } from "./coins.ts";
import type { MarketConfig } from "./config.ts";

/**
 * Position arithmetic. All integers (coins, price cents); firestore.rules redoes every
 * line of this, so any change here must be mirrored there.
 */
export type Side = "long" | "short";
export const HOUR_MS = 3_600_000;

/** floor(a / b) for integers, exact even where float division would round. */
export function floorDiv(a: number, b: number): number {
  let q = Math.floor(a / b);
  while (q * b > a) q -= 1;
  while ((q + 1) * b <= a) q += 1;
  return q;
}

export function tradeFee(notional: number, config: Pick<MarketConfig, "feeBps" | "minFee">): number {
  return Math.max(config.minFee, floorDiv(notional * config.feeBps, 10_000));
}

/** Price at which the loss reaches liquidationBps of the margin. */
export function liquidationPrice(entry: number, side: Side, leverage: number, liquidationBps: number): number {
  const move = floorDiv(entry * liquidationBps, leverage * 10_000);
  return side === "long" ? entry - move : entry + move;
}

/** Price at which the profit reaches margin × capMultiple; 0 when a short could never get there. */
export function capPrice(entry: number, side: Side, leverage: number, capMultiple: number): number {
  const move = floorDiv(entry * capMultiple, leverage);
  if (side === "long") return entry + move;
  return entry - move > 0 ? entry - move : 0;
}

export function pnlAt(notional: number, entry: number, exit: number, side: Side): number {
  return floorDiv(notional * (side === "long" ? exit - entry : entry - exit), entry);
}

/** Started hours, at least one. */
export function heldHours(openedMs: number, closedMs: number): number {
  return Math.max(1, Math.ceil((closedMs - openedMs) / HOUR_MS));
}

export function interestFor(borrowed: number, hours: number, interestBps: number): number {
  return floorDiv(borrowed * interestBps * hours, 10_000);
}

export interface OpenQuote {
  coin: CoinId;
  side: Side;
  leverage: number;
  margin: number;
  notional: number;
  borrowed: number;
  entry: number;
  fee: number;
  /** Total taken from the balance. */
  cost: number;
  liq: number;
  cap: number;
  /** Interest for each started hour. */
  interestPerHour: number;
}

export function quoteOpen(config: MarketConfig, coin: CoinId, side: Side, leverage: number, margin: number, entry: number): OpenQuote {
  const notional = margin * leverage, fee = tradeFee(notional, config);
  return {
    coin, side, leverage, margin, notional, borrowed: notional - margin, entry, fee, cost: margin + fee,
    liq: liquidationPrice(entry, side, leverage, config.liquidationBps),
    cap: capPrice(entry, side, leverage, config.capMultiple),
    interestPerHour: interestFor(notional - margin, 1, config.interestBps),
  };
}

/** What a stored position needs for settlement. */
export interface PositionTerms {
  coin: CoinId;
  side: Side;
  leverage: number;
  margin: number;
  /** Opening fee; the closing fee is the same amount. */
  fee: number;
  entry: number;
  openedAtMs: number;
}

export type CloseKind = "close" | "cap" | "liquidated" | "refund";

export interface CloseQuote {
  kind: CloseKind;
  exit: number;
  hours: number;
  pnl: number;
  interest: number;
  fee: number;
  payout: number;
}

/**
 * Settlement. `close` and `cap` pay margin + pnl − interest − closing fee (= the opening fee; doubled for MWL at night) (never below 0, profit
 * capped at margin × capMultiple); `liquidated` pays nothing; `refund` (dealer void) returns the margin.
 */
export function quoteClose(config: MarketConfig, position: PositionTerms, kind: CloseKind, exit: number, closedAtMs: number): CloseQuote {
  const notional = position.margin * position.leverage;
  if (kind === "liquidated") return { kind, exit, hours: 0, pnl: -position.margin, interest: 0, fee: 0, payout: 0 };
  if (kind === "refund") return { kind, exit: position.entry, hours: 0, pnl: 0, interest: 0, fee: 0, payout: position.margin };
  const hours = heldHours(position.openedAtMs, closedAtMs);
  const pnl = pnlAt(notional, position.entry, exit, position.side);
  const interest = interestFor(notional - position.margin, hours, config.interestBps);
  const night = position.coin === "MWL" && isMoonlessNight(closedAtMs);
  const fee = position.fee * (night ? config.nightFeeMultiplier : 1);
  const payout = Math.max(0, position.margin + Math.min(pnl, position.margin * config.capMultiple) - interest - fee);
  return { kind, exit, hours, pnl, interest, fee, payout };
}

/** Whether a price ends the position on its own (checked by the price recorder every tick). */
export function triggerAt(position: { side: Side; liq: number; cap: number }, price: number): "liquidated" | "cap" | null {
  if (position.side === "long") {
    if (price <= position.liq) return "liquidated";
    if (price >= position.cap) return "cap";
  } else {
    if (price >= position.liq) return "liquidated";
    if (position.cap > 0 && price <= position.cap) return "cap";
  }
  return null;
}

/** Live equity for display: margin + pnl − interest so far. */
export function liveEquity(config: MarketConfig, position: PositionTerms, price: number, nowMs: number): { pnl: number; interest: number; equity: number; ratio: number } {
  const notional = position.margin * position.leverage;
  const pnl = pnlAt(notional, position.entry, price, position.side);
  const interest = interestFor(notional - position.margin, heldHours(position.openedAtMs, nowMs), config.interestBps);
  const equity = position.margin + pnl - interest;
  return { pnl, interest, equity, ratio: pnl / position.margin };
}

// ── 환전가 특별 징수 (docs/SPEC-MARKET-DEPTH.md 6-5) ──

export interface MarketWeek { week: number; net: number; }

export interface LevyQuote {
  /** Profit of this settlement before the levy (negative for a loss). */
  profit: number;
  /** Coins kept by the house. */
  levy: number;
  /** The wallet's marketWeek afterwards. */
  after: MarketWeek;
}

/**
 * Futures: profit = payout − (margin + opening fee). Spot: payout − cost of the units sold.
 * Losses in the same week offset gains; a new week starts from 0. Only the part of the week's net
 * above `cap` is levied, never more than this settlement's own profit. firestore.rules repeats this.
 */
export function weeklyLevy(stored: MarketWeek | undefined, week: number, profit: number, cap: number): LevyQuote {
  const net0 = stored && stored.week === week ? stored.net : 0;
  const over = net0 + profit - cap, gain = Math.max(0, profit);
  const levy = cap <= 0 || over <= 0 ? 0 : Math.min(over, gain);
  return { profit, levy, after: { week, net: net0 + profit - levy } };
}
