import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { XorShift32 } from "../rng.ts";
import { DAY_MS, KST_OFFSET_MS, WEEK_MS, dayIndexAt, weekIndexAt, weekStartMs } from "../week.ts";
import { COIN_IDS, COINS, coinForDistrict, isMoonlessNight, type CoinId } from "./coins.ts";
import type { MarketConfig } from "./config.ts";
import { FEED_TEXT, NEWS_SIZES, liberationFeed, type FeedItem, type NewsSize } from "./feed.ts";

/**
 * 시세 엔진. The price recorder (apps/notifier, cron) calls `stepMarket` once per tick.
 * Everything here is public except the secret behind the seeds, so nobody can compute the next tick.
 * docs/SPEC-COIN-MARKET.md 3절.
 */
export interface CoinTick {
  /** Price in cents. */
  p: number;
  /** Permanent anchor factor (liberation rallies). */
  af: number;
  storm: boolean;
  /** Volatility boost and the tick it ends at (밸런스 패치, dealer news). */
  boost: number;
  boostUntil: number;
  /** Smoothed recent return, for momentum. */
  mom: number;
}

export interface MarketState {
  seq: number;
  atMs: number;
  coins: Record<CoinId, CoinTick>;
  /** Prices one tick earlier: the recorder checks liquidations against both. */
  prev: Record<CoinId, number>;
  prevSeq: number;
  liberated: string[];
  houseOpen: boolean;
  /** FTN anchor factor from the city's debt (GM 단서). */
  debtF: number;
  /** WHL anchor factor from recent table activity. */
  heatF: number;
}

export interface WorldInput { liberated: string[]; houseOpen: boolean; debtF: number; heatF: number; }

export interface NewsShock { id: string; coin: CoinId; dir: 1 | -1 | 0; size: NewsSize; minutes: number; headline: string; }

export interface StepSeeds { tick: number; blcNow: number; blcPast: number; s9Week: number; }

export interface StepInput {
  seq: number;
  atMs: number;
  seeds: StepSeeds;
  config: Pick<MarketConfig, "tickSeconds" | "debtLink" | "coins">;
  world?: WorldInput | undefined;
  news?: NewsShock[] | undefined;
}

/** The 32-bit seed behind one random decision; only the recorder knows `secret`. */
export function marketSeed(secret: string, key: string): number {
  const digest = hmac(sha256, new TextEncoder().encode(secret), new TextEncoder().encode(key));
  return ((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0;
}

export function tickSeq(epochMs: number, tickSeconds: number): number { return Math.floor(epochMs / (tickSeconds * 1000)); }

/** Seed keys for tick `seq`: the BLC rumour decided 10 minutes earlier is revealed now. */
export function seedKeys(seq: number, atMs: number, tickSeconds: number): Record<keyof StepSeeds, string> {
  return { tick: `t:${seq}`, blcNow: `blc:${seq}`, blcPast: `blc:${seq - blcLagTicks(tickSeconds)}`, s9Week: `s9:${weekIndexAt(atMs)}` };
}

export function blcLagTicks(tickSeconds: number): number { return Math.round(600 / tickSeconds); }

export function initialMarketState(seq: number, atMs: number): MarketState {
  const coins = Object.fromEntries(COIN_IDS.map((id) => [id, { p: COINS[id].anchor, af: 1, storm: false, boost: 1, boostUntil: 0, mom: 0 }])) as Record<CoinId, CoinTick>;
  return {
    seq, atMs, coins, prev: Object.fromEntries(COIN_IDS.map((id) => [id, COINS[id].anchor])) as Record<CoinId, number>, prevSeq: seq,
    liberated: [], houseOpen: false, debtF: 1, heatF: 1,
  };
}

/** 0.85 when nobody owes anything, 1 at the welcome debt, up to 1.15. */
export function debtFactor(totalDebt: number, players: number, perPlayer = 1_500): number {
  if (players <= 0) return 1;
  return Math.min(1.15, Math.max(0.85, 0.85 + 0.15 * (totalDebt / (players * perPlayer))));
}

/** 0.95 on a quiet hour, up to 1.10 when 40 or more table plays happened in the last hour. */
export function heatFactor(betsLastHour: number): number { return 0.95 + 0.15 * Math.min(1, Math.max(0, betsLastHour) / 40); }

export interface BlcPlan { scheduled: boolean; dir: 1 | -1; hint: 1 | -1; size: number; }

/** Two rumours a day on average; the hint is right 65% of the time. */
export function blcPlan(seed: number, tickSeconds: number): BlcPlan {
  const rng = new XorShift32(seed);
  const scheduled = rng.next() < (2 * tickSeconds) / 86_400;
  const dir = rng.next() < 0.5 ? 1 : -1, right = rng.next() < 0.65, size = 0.06 + rng.next() * 0.06;
  return { scheduled, dir, hint: right ? dir : (-dir as 1 | -1), size };
}

function normal(rng: XorShift32): number {
  const u = Math.max(rng.next(), 1e-12), v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const HOUR_MS = 3_600_000;

/** Did a daily KST clock time fall in (prevMs, atMs]? */
export function dailyCrossed(prevMs: number, atMs: number, hourKst: number): boolean {
  let t = dayIndexAt(atMs) * DAY_MS - KST_OFFSET_MS + hourKst * HOUR_MS;
  if (t > atMs) t -= DAY_MS;
  return prevMs < t && t <= atMs;
}

/** Sunday 21:00 KST (임대료 납부일). */
export function rentCrossed(prevMs: number, atMs: number): boolean {
  let t = weekStartMs(weekIndexAt(atMs)) + 6 * DAY_MS + 21 * HOUR_MS;
  if (t > atMs) t -= WEEK_MS;
  return prevMs < t && t <= atMs;
}

/** 00:00 KST on the 15th of a month (보름 상납금). */
export function fullMoonCrossed(prevMs: number, atMs: number): boolean {
  const dayStart = dayIndexAt(atMs) * DAY_MS - KST_OFFSET_MS;
  return prevMs < dayStart && dayStart <= atMs && new Date(atMs + KST_OFFSET_MS).getUTCDate() === 15;
}

/** S9's weekly terms revision lands at a secret moment of the week. */
export function s9RevisionAt(weekIndex: number, seed: number): number {
  return weekStartMs(weekIndex) + Math.floor(new XorShift32(seed).next() * WEEK_MS);
}

export function anchorOf(state: MarketState, id: CoinId, debtLink: boolean): number {
  const base = COINS[id].anchor * state.coins[id].af;
  if (id === "FTN" && debtLink) return base * state.debtF;
  if (id === "WHL") return base * state.heatF;
  return base;
}

export function stepMarket(state: MarketState, input: StepInput): { state: MarketState; feed: FeedItem[] } {
  const ticks = input.seq - state.seq;
  if (ticks <= 0) return { state, feed: [] };
  const { config, seq, atMs } = input, tickSeconds = config.tickSeconds;
  const hours = (Math.min(ticks, 240) * tickSeconds) / 3600;
  const rng = new XorShift32(input.seeds.tick);
  const feed: FeedItem[] = [];
  const jump: Record<string, number> = {}, afMult: Record<string, number> = {};
  const addJump = (id: CoinId, factor: number) => { jump[id] = (jump[id] ?? 0) + Math.log(factor); };
  const prevMs = state.atMs;

  // World changes reported by the recorder.
  const world = input.world ?? { liberated: state.liberated, houseOpen: state.houseOpen, debtF: state.debtF, heatF: state.heatF };
  for (const districtId of world.liberated) {
    if (state.liberated.includes(districtId)) continue;
    const coin = coinForDistrict(districtId);
    if (!coin || coin === "WHL") continue;
    addJump(coin, 1.2 + rng.next() * 0.2); afMult[coin] = (afMult[coin] ?? 1) * 1.3;
    addJump("FTN", 0.95); afMult.FTN = (afMult.FTN ?? 1) * 0.95;
    feed.push(liberationFeed(coin));
  }
  if (world.houseOpen && !state.houseOpen) { addJump("WHL", 1.1); feed.push({ kind: "houseOpen", coin: "WHL", tone: "up", text: FEED_TEXT.houseOpen }); }

  // Calendar effects.
  if (dailyCrossed(prevMs, atMs, 9)) { addJump("HBT", 0.985); feed.push({ kind: "hbtFee", coin: "HBT", tone: "down", text: FEED_TEXT.hbtFee }); }
  if (rentCrossed(prevMs, atMs)) { addJump("LNH", 0.97); feed.push({ kind: "lnhTax", coin: "LNH", tone: "down", text: FEED_TEXT.lnhTax }); }
  if (fullMoonCrossed(prevMs, atMs)) { addJump("JWN", 0.96); feed.push({ kind: "jwnTribute", coin: "JWN", tone: "down", text: FEED_TEXT.jwnTribute }); }
  const s9At = s9RevisionAt(weekIndexAt(atMs), input.seeds.s9Week);
  if (prevMs < s9At && s9At <= atMs) { addJump("S9", 1.08); feed.push({ kind: "s9Terms", coin: "S9", tone: "up", text: FEED_TEXT.s9Terms }); }
  if (dailyCrossed(prevMs, atMs, 0)) feed.push({ kind: "mwlNight", coin: "MWL", tone: "warn", text: FEED_TEXT.mwlNight });
  if (dailyCrossed(prevMs, atMs, 5)) feed.push({ kind: "mwlDawn", coin: "MWL", tone: "info", text: FEED_TEXT.mwlDawn });

  // 벨루체 rumours: whispered now, true (or not) ten minutes later.
  const whisper = blcPlan(input.seeds.blcNow, tickSeconds);
  if (whisper.scheduled) feed.push({ kind: "blcWhisper", coin: "BLC", tone: "info", text: whisper.hint > 0 ? FEED_TEXT.blcWhisperUp : FEED_TEXT.blcWhisperDown });
  const due = blcPlan(input.seeds.blcPast, tickSeconds);
  if (due.scheduled && ticks <= blcLagTicks(tickSeconds)) { addJump("BLC", 1 + due.dir * due.size); feed.push({ kind: "blcReveal", coin: "BLC", tone: due.dir > 0 ? "up" : "down", text: FEED_TEXT.blcReveal }); }

  const boosts: Partial<Record<CoinId, { boost: number; until: number }>> = {};
  const ticksPerHour = Math.round(3600 / tickSeconds);
  if (rng.next() < (2 * hours) / 24) { boosts.HBT = { boost: 1.5, until: seq + ticksPerHour }; feed.push({ kind: "hbtPatch", coin: "HBT", tone: "warn", text: FEED_TEXT.hbtPatch }); }

  // Dealer news.
  for (const shock of input.news ?? []) {
    const dir = shock.dir === 0 ? (rng.next() < 0.5 ? 1 : -1) : shock.dir;
    addJump(shock.coin, 1 + dir * NEWS_SIZES[shock.size]);
    boosts[shock.coin] = { boost: 2, until: seq + Math.round((shock.minutes * 60) / tickSeconds) };
    feed.push({ kind: "news", coin: shock.coin, tone: shock.dir === 0 || shock.size === "z" ? "info" : dir > 0 ? "up" : "down", text: shock.headline });
  }

  const next: MarketState = {
    seq, atMs, prevSeq: state.seq, prev: { ...state.prev }, coins: { ...state.coins },
    liberated: [...world.liberated], houseOpen: world.houseOpen, debtF: world.debtF, heatF: world.heatF,
  };
  const common = normal(rng);
  for (const id of COIN_IDS) {
    const def = COINS[id], cs = state.coins[id];
    next.prev[id] = cs.p;
    const af = cs.af * (afMult[id] ?? 1);
    const anchor = anchorOf({ ...next, coins: { ...next.coins, [id]: { ...cs, af } } }, id, config.debtLink);
    const storm = cs.storm ? rng.next() >= Math.min(1, hours) : rng.next() < hours / 24;
    const boost = boosts[id] ?? (seq < cs.boostUntil ? { boost: cs.boost, until: cs.boostUntil } : { boost: 1, until: 0 });
    const night = id === "MWL" && isMoonlessNight(atMs) ? 4 : 1;
    const vol = def.volH * (config.coins[id]?.volMult ?? 1) * (storm ? 2.5 : 1) * boost.boost * night * Math.sqrt(hours);
    const e = id === "FTN" ? common : def.beta * common + Math.sqrt(1 - def.beta * def.beta) * normal(rng);
    const noise = vol * e;
    let r = noise - (vol * vol) / 2 + def.revertH * hours * Math.log(anchor / cs.p) + def.momentum * cs.mom;
    if (rng.next() < (def.jumpsPerDay * hours) / 24) {
      const size = def.jumpMin + rng.next() * (def.jumpMax - def.jumpMin);
      const down = def.jumpDownOnly || rng.next() < 0.5;
      r += Math.log(down ? 1 - size : 1 + size);
      if (id === "ORB") feed.push({ kind: "orbSaving", coin: "ORB", tone: "down", text: FEED_TEXT.orbSaving });
    }
    r += jump[id] ?? 0;
    const base = def.anchor;
    // A halted coin (dealer circuit breaker) keeps its price, so nothing liquidates while nobody can trade it.
    const halted = config.coins[id]?.enabled === false;
    const p = halted ? cs.p : Math.min(base * 50, Math.max(Math.max(1, Math.round(base / 50)), Math.round(cs.p * Math.exp(r))));
    next.coins[id] = { p, af, storm, boost: boost.boost, boostUntil: boost.until, mom: 0.8 * cs.mom + 0.2 * noise };
  }
  return { state: next, feed };
}
