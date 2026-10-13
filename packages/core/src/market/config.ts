import { isRecord, numberOr } from "../games/index.ts";
import { COIN_IDS, COINS, type CoinId } from "./coins.ts";

/**
 * config/market. Every knob of the exchange; firestore.rules reads the same fields
 * (with these defaults when a field is missing), so keep both in step.
 */
export interface MarketConfig {
  enabled: boolean;
  /** Fee on notional for opening and for closing, in basis points; never below minFee. */
  feeBps: number;
  minFee: number;
  /** 지배인 이자: per started hour on the borrowed part (notional − margin), in basis points. */
  interestBps: number;
  /** Forced close once the loss reaches this share of the margin. */
  liquidationBps: number;
  /** Automatic take-profit once the profit reaches margin × capMultiple. */
  capMultiple: number;
  minMargin: number;
  maxMargin: number;
  /** Positions open at once per player. */
  maxOpen: number;
  /** New positions per limit period (config/economy limitPeriod). */
  dailyLimit: number;
  leverage: {
    steps: number[];
    /** Before the house opens. */
    mainLocked: number;
    altLocked: number;
    /** After the house opens. */
    mainOpen: number;
    altOpen: number;
  };
  /** 무월리 체크아웃: closing MWL between 0 and 5 KST multiplies the closing fee. */
  nightFeeMultiplier: number;
  /** GM 전용: FTN's anchor follows the city's total debt. */
  debtLink: boolean;
  /** Trading refuses a price older than this (the price recorder may be down). */
  staleSeconds: number;
  /** Seconds between prices (10–60); the price recorder reads it within a minute. */
  tickSeconds: number;
  /** Per coin: trading switch (circuit breaker) and a volatility multiplier. */
  coins: Record<CoinId, { enabled: boolean; volMult: number }>;
}

export const DEFAULT_MARKET: MarketConfig = {
  enabled: true,
  feeBps: 10,
  minFee: 1,
  interestBps: 20,
  liquidationBps: 9_000,
  capMultiple: 10,
  minMargin: 10,
  maxMargin: 2_000,
  maxOpen: 3,
  dailyLimit: 10,
  leverage: { steps: [1, 2, 3, 5, 10, 20], mainLocked: 5, altLocked: 3, mainOpen: 20, altOpen: 10 },
  nightFeeMultiplier: 2,
  debtLink: true,
  staleSeconds: 90,
  tickSeconds: 15,
  coins: Object.fromEntries(COIN_IDS.map((id) => [id, { enabled: true, volMult: 1 }])) as MarketConfig["coins"],
};

const int = (value: unknown, fallback: number, min = 0, max = 1e9) => Math.round(numberOr(value, fallback, min, max));
const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

export function normalizeMarket(raw: unknown): MarketConfig {
  const source = isRecord(raw) ? raw : {}, d = DEFAULT_MARKET;
  const leverage = isRecord(source.leverage) ? source.leverage : {};
  const coins = isRecord(source.coins) ? source.coins : {};
  const steps = Array.isArray(leverage.steps) && leverage.steps.length > 0 && leverage.steps.every((step) => Number.isSafeInteger(step) && (step as number) >= 1 && (step as number) <= 100)
    ? [...new Set(leverage.steps as number[])].sort((a, b) => a - b) : [...d.leverage.steps];
  return {
    enabled: bool(source.enabled, d.enabled),
    feeBps: int(source.feeBps, d.feeBps, 0, 1_000),
    minFee: int(source.minFee, d.minFee, 0, 1_000),
    interestBps: int(source.interestBps, d.interestBps, 0, 1_000),
    liquidationBps: int(source.liquidationBps, d.liquidationBps, 1_000, 10_000),
    capMultiple: int(source.capMultiple, d.capMultiple, 1, 1_000),
    minMargin: int(source.minMargin, d.minMargin, 1),
    maxMargin: int(source.maxMargin, d.maxMargin, 1),
    maxOpen: int(source.maxOpen, d.maxOpen, 1, 20),
    dailyLimit: int(source.dailyLimit, d.dailyLimit, 0, 1_000),
    leverage: {
      steps,
      mainLocked: int(leverage.mainLocked, d.leverage.mainLocked, 1, 100), altLocked: int(leverage.altLocked, d.leverage.altLocked, 1, 100),
      mainOpen: int(leverage.mainOpen, d.leverage.mainOpen, 1, 100), altOpen: int(leverage.altOpen, d.leverage.altOpen, 1, 100),
    },
    nightFeeMultiplier: int(source.nightFeeMultiplier, d.nightFeeMultiplier, 1, 10),
    debtLink: bool(source.debtLink, d.debtLink),
    staleSeconds: int(source.staleSeconds, d.staleSeconds, 20, 3_600),
    tickSeconds: int(source.tickSeconds, d.tickSeconds, 10, 60),
    coins: Object.fromEntries(COIN_IDS.map((id) => {
      const stored = isRecord(coins[id]) ? coins[id] : {};
      return [id, { enabled: bool(stored.enabled, true), volMult: numberOr(stored.volMult, 1, 0, 5) }];
    })) as MarketConfig["coins"],
  };
}

/** Highest leverage a coin allows right now. */
export function maxLeverage(config: MarketConfig, coin: CoinId, houseOpen: boolean): number {
  const main = COINS[coin].main;
  return houseOpen ? (main ? config.leverage.mainOpen : config.leverage.altOpen) : (main ? config.leverage.mainLocked : config.leverage.altLocked);
}

export function leverageChoices(config: MarketConfig, coin: CoinId, houseOpen: boolean): number[] {
  const cap = maxLeverage(config, coin, houseOpen);
  return config.leverage.steps.filter((step) => step <= cap);
}
