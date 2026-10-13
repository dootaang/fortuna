import { GAME_IDS, GAMES, VENUES, isRecord, numberOr, type GameId, type Venue } from "./games/index.ts";
import { periodWords, usedInPeriod, type LimitPeriod, type UsageCounters } from "./week.ts";
import { fill, TEXT } from "./content/text.ts";

export interface GameVenueConfig {
  enabled: boolean;
  params: unknown;
  /** Derived from params by `finalizeEconomy`; firestore.rules caps payouts with it. */
  maxMultiplier: number;
}

/**
 * All balance knobs. Stored at config/economy; DEFAULT_ECONOMY seeds it.
 * Always pass through `finalizeEconomy` before saving.
 */
export interface EconomyConfig {
  /** How often the work/gamble counters refill (00:00 KST). */
  limitPeriod: LimitPeriod;
  /** The item shop is optional; skill payments are the main coin sink. */
  shopEnabled: boolean;
  welcome: { loan: number; debt: number; gateFee: number };
  borrow: { enabled: boolean; feeBps: number };
  work: { limit: number; baseWage: number; wageMin: number; wageMax: number; wageStep: number };
  gambling: {
    /** Plays per limit period. */
    limit: number;
    minBet: number;
    alleyMaxBet: number;
    houseMaxBet: number;
    houseOpen: boolean;
    games: Record<GameId, Record<Venue, GameVenueConfig>>;
  };
  skill: { costs: number[]; cumulative: number[] };
  vaultInitial: number;
  /** Player-vs-player tables (도둑잡기). Not counted against the daily gamble limit. */
  pvp: {
    enabled: boolean;
    minStake: number;
    alleyMaxStake: number;
    houseMaxStake: number;
    alleyRakeBps: number;
    houseRakeBps: number;
    /** Target may rearrange before the drawer can pick anyway. */
    offerSeconds: number;
    /** Drawer must pick within this, or anyone seated may pick for them. */
    pickSeconds: number;
    /** Target must hand over the card within this, or anyone seated may resolve it. */
    resolveSeconds: number;
    /** A waiting room older than this can be closed by anyone (stakes refunded). */
    abandonMinutes: number;
  };
}

export const DEFAULT_SKILL_COSTS = [0, 10, 30, 100, 300, 1_000, 3_000, 10_000, 30_000, 100_000, 300_000] as const;

function defaultGames(): EconomyConfig["gambling"]["games"] {
  return Object.fromEntries(GAME_IDS.map((id) => [id, Object.fromEntries(VENUES.map((venue) => {
    const params = GAMES[id].defaults[venue];
    return [venue, { enabled: true, params, maxMultiplier: GAMES[id].maxMultiplier(params) }];
  }))])) as EconomyConfig["gambling"]["games"];
}

export const DEFAULT_ECONOMY: EconomyConfig = {
  limitPeriod: "day",
  shopEnabled: false,
  welcome: { loan: 1_000, debt: 1_500, gateFee: 100 },
  borrow: { enabled: true, feeBps: 5_000 },
  work: { limit: 10, baseWage: 200, wageMin: 150, wageMax: 250, wageStep: 10 },
  gambling: { limit: 30, minBet: 10, alleyMaxBet: 200, houseMaxBet: 2_000, houseOpen: false, games: defaultGames() },
  skill: { costs: [...DEFAULT_SKILL_COSTS], cumulative: cumulativeCosts(DEFAULT_SKILL_COSTS) },
  vaultInitial: 1_000_000,
  pvp: { enabled: true, minStake: 10, alleyMaxStake: 200, houseMaxStake: 2_000, alleyRakeBps: 0, houseRakeBps: 500, offerSeconds: 12, pickSeconds: 20, resolveSeconds: 8, abandonMinutes: 30 },
};

/** cumulative[n] = costs[1] + … + costs[n]; cumulative[0] = 0. */
export function cumulativeCosts(costs: readonly number[]): number[] {
  const output: number[] = [];
  costs.forEach((cost, index) => output.push(index === 0 ? 0 : (output[index - 1] ?? 0) + cost));
  return output;
}

const int = (value: unknown, fallback: number, min = 0, max = 1e12) => Math.round(numberOr(value, fallback, min, max));

/** Merge a stored (possibly partial or older) config over the defaults. */
export function normalizeEconomy(raw: unknown): EconomyConfig {
  const source = isRecord(raw) ? raw : {};
  const d = DEFAULT_ECONOMY;
  const welcome = isRecord(source.welcome) ? source.welcome : {};
  const borrow = isRecord(source.borrow) ? source.borrow : {};
  const work = isRecord(source.work) ? source.work : {};
  const gambling = isRecord(source.gambling) ? source.gambling : {};
  const skill = isRecord(source.skill) ? source.skill : {};
  const storedGames = isRecord(gambling.games) ? gambling.games : {};
  const pvp = isRecord(source.pvp) ? source.pvp : {};
  const games = Object.fromEntries(GAME_IDS.map((id) => {
    const perGame = isRecord(storedGames[id]) ? storedGames[id] : {};
    return [id, Object.fromEntries(VENUES.map((venue) => {
      const stored = isRecord(perGame[venue]) ? perGame[venue] : {};
      const params = GAMES[id].params(stored.params, venue);
      return [venue, { enabled: typeof stored.enabled === "boolean" ? stored.enabled : true, params, maxMultiplier: GAMES[id].maxMultiplier(params) }];
    }))];
  })) as EconomyConfig["gambling"]["games"];
  const costs = Array.isArray(skill.costs) && skill.costs.length >= 2 && skill.costs.every((cost) => Number.isSafeInteger(cost) && (cost as number) >= 0) ? (skill.costs as number[]) : [...d.skill.costs];
  return {
    limitPeriod: source.limitPeriod === "week" ? "week" : source.limitPeriod === "day" ? "day" : d.limitPeriod,
    shopEnabled: typeof source.shopEnabled === "boolean" ? source.shopEnabled : d.shopEnabled,
    welcome: { loan: int(welcome.loan, d.welcome.loan), debt: int(welcome.debt, d.welcome.debt), gateFee: int(welcome.gateFee, d.welcome.gateFee) },
    borrow: { enabled: typeof borrow.enabled === "boolean" ? borrow.enabled : d.borrow.enabled, feeBps: int(borrow.feeBps, d.borrow.feeBps, 0, 100_000) },
    work: {
      limit: int(work.limit ?? work.weeklyLimit, d.work.limit, 0, 1_000), baseWage: int(work.baseWage, d.work.baseWage),
      wageMin: int(work.wageMin, d.work.wageMin), wageMax: int(work.wageMax, d.work.wageMax), wageStep: int(work.wageStep, d.work.wageStep, 1),
    },
    gambling: {
      limit: int(gambling.limit ?? gambling.weeklyLimit, d.gambling.limit, 0, 10_000), minBet: int(gambling.minBet, d.gambling.minBet, 1),
      alleyMaxBet: int(gambling.alleyMaxBet, d.gambling.alleyMaxBet, 1), houseMaxBet: int(gambling.houseMaxBet, d.gambling.houseMaxBet, 1),
      houseOpen: typeof gambling.houseOpen === "boolean" ? gambling.houseOpen : d.gambling.houseOpen, games,
    },
    skill: { costs, cumulative: cumulativeCosts(costs) },
    vaultInitial: int(source.vaultInitial, d.vaultInitial),
    pvp: {
      enabled: typeof pvp.enabled === "boolean" ? pvp.enabled : d.pvp.enabled,
      minStake: int(pvp.minStake, d.pvp.minStake, 1), alleyMaxStake: int(pvp.alleyMaxStake, d.pvp.alleyMaxStake, 1), houseMaxStake: int(pvp.houseMaxStake, d.pvp.houseMaxStake, 1),
      alleyRakeBps: int(pvp.alleyRakeBps, d.pvp.alleyRakeBps, 0, 10_000), houseRakeBps: int(pvp.houseRakeBps, d.pvp.houseRakeBps, 0, 10_000),
      offerSeconds: int(pvp.offerSeconds, d.pvp.offerSeconds, 1, 600), pickSeconds: int(pvp.pickSeconds, d.pvp.pickSeconds, 1, 600),
      resolveSeconds: int(pvp.resolveSeconds, d.pvp.resolveSeconds, 1, 600), abandonMinutes: int(pvp.abandonMinutes, d.pvp.abandonMinutes, 1, 10_000),
    },
  };
}

/** Recompute every derived field. Call right before writing config/economy. */
export function finalizeEconomy(config: EconomyConfig): EconomyConfig { return normalizeEconomy(config); }

export const NOTIFY_EVENTS = ["arrival", "bigGamble", "skill", "shop", "fundFilled", "liberation", "repaid", "houseOpen", "pvp", "market"] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

/** Stored at config/notify. */
export interface NotifyConfig {
  enabled: Record<NotifyEvent, boolean>;
  /** Net win or loss at or above this counts as a big gamble. */
  bigGamble: number;
  /** Relay endpoint (Cloudflare Worker). Empty = notifications off. */
  relayUrl: string;
}

export const DEFAULT_NOTIFY: NotifyConfig = {
  enabled: { arrival: true, bigGamble: true, skill: true, shop: true, fundFilled: true, liberation: true, repaid: true, houseOpen: true, pvp: true, market: true },
  bigGamble: 1_000,
  relayUrl: "",
};

export function normalizeNotify(raw: unknown): NotifyConfig {
  const source = isRecord(raw) ? raw : {}, enabled = isRecord(source.enabled) ? source.enabled : {};
  return {
    enabled: Object.fromEntries(NOTIFY_EVENTS.map((event) => [event, typeof enabled[event] === "boolean" ? enabled[event] : DEFAULT_NOTIFY.enabled[event]])) as NotifyConfig["enabled"],
    bigGamble: int(source.bigGamble, DEFAULT_NOTIFY.bigGamble),
    relayUrl: typeof source.relayUrl === "string" ? source.relayUrl : "",
  };
}

/** Work shifts or table plays still available in the current period. */
export function usesLeft(counters: UsageCounters, config: EconomyConfig, kind: "work" | "gamble", nowMs: number): number {
  const limit = kind === "work" ? config.work.limit : config.gambling.limit;
  return Math.max(0, limit - usedInPeriod(counters, kind, nowMs, config.limitPeriod));
}

export function limitReachedText(config: EconomyConfig, kind: "work" | "gamble"): string {
  return fill(kind === "work" ? TEXT.work.limitReached : TEXT.gamble.limitReached, periodWords(config.limitPeriod));
}
