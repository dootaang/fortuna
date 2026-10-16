import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { XorShift32 } from "../rng.ts";
import { DAY_MS, KST_OFFSET_MS, WEEK_MS, dayIndexAt, weekIndexAt, weekStartMs } from "../week.ts";
import { COIN_IDS, COINS, coinForDistrict, isMoonlessNight, type CoinId } from "./coins.ts";
import type { MarketConfig } from "./config.ts";
import { FEED_TEXT, NEWS_SIZES, liberationFeed, type FeedItem, type NewsSize } from "./feed.ts";
import { cascadeMove, crowdSeed, initialCrowd, liquidateCrowd, stepCrowd, usualSigma, type Crowd } from "./crowd.ts";
import { SECTOR_IDS, noiseWeights, sectorOf, type SectorId } from "./stats.ts";
import { initialRegime, regimeEffect, regimeSeed, stepRegime, type Regime, type RegimeKind } from "./regime.ts";
import { NEWS_FACTOR_HOURS, newsSeed, stepAutoNews, type PendingNews } from "./autonews.ts";
import { PEAD, PEAD_HOURS, PRE_BAKE, earningsAt, earningsFeed, earningsJump, heatShare, nextFf, rateFeed, rateShock } from "./fundamentals.ts";

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
  /** Volatility boost and when it ends, epoch ms (밸런스 패치, dealer news). */
  boost: number;
  boostUntil: number;
  /** Smoothed recent return, for momentum. */
  mom: number;
  /** 거래소 2부 (missing on ticks from before it): the NPC crowd, */
  npc?: Crowd | undefined;
  /** an hour-long EMA of the log price (last hour's return ≈ log p − lp), */
  lp?: number | undefined;
  /** an hour-long EMA of the realised hourly variance, */
  rv?: number | undefined;
  /** and notional liquidated, decaying over about an hour (crowd + players). */
  lq?: number | undefined;
  /** 2단계 실적: the anchor's fundamental factor (0.8–1.3), */
  ff?: number | undefined;
  /** the log return already priced in from this week's hints, */
  pre?: number | undefined;
  /** post-earnings drift (log return per hour) and when it stops, */
  drift?: number | undefined;
  driftUntil?: number | undefined;
  /** the players' share of the coming surprise (last observed), */
  spc?: number | undefined;
  /** the last four surprises (public after each announcement), */
  eh?: number[] | undefined;
  /** and the latest analyst band [low, high] in cents, so the next report can score it. */
  rb?: [number, number] | undefined;
  /** 3단계 자동 뉴스: a story waiting to resolve, and the follow-through drift after one. */
  an?: PendingNews | null | undefined;
  nd?: number | undefined;
  ndu?: number | undefined;
  /** News factor on the anchor (0.7–1.4): the lasting part of stories, fading back to 1 over days. */
  nf?: number | undefined;
  /** 5단계 펀딩: cumulative funding index in ppm (the recorder adds an hour's rate at each full hour). */
  F?: number | undefined;
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
  /** 4단계: the hidden market regime. Never written to the public tick (the recorder keeps it privately). */
  regime?: Regime | undefined;
}

export interface WorldInput {
  liberated: string[];
  houseOpen: boolean;
  debtF: number;
  heatF: number;
  /** Players' share of each coin's coming surprise (2단계), from resident activity. */
  spc?: Partial<Record<CoinId, number>> | undefined;
}

/** What only the recorder can compute for earnings: the residents' (NPC) surprise of this week and today's blurred hint. */
export interface FundamentalsInput { sNpc: Record<CoinId, number>; mood: Record<CoinId, number>; }

export interface NewsShock { id: string; coin: CoinId; dir: 1 | -1 | 0; size: NewsSize; minutes: number; headline: string; }

export interface StepSeeds { tick: number; blcNow: number; blcPast: number; s9Week: number; }

export interface StepInput {
  seq: number;
  atMs: number;
  seeds: StepSeeds;
  config: Pick<MarketConfig, "tickSeconds" | "debtLink" | "coins"> & { npc?: MarketConfig["npc"] | undefined; earnings?: boolean | undefined; autoNews?: boolean | undefined; regimes?: boolean | undefined; cascade?: boolean | undefined };
  world?: WorldInput | undefined;
  news?: NewsShock[] | undefined;
  fundamentals?: FundamentalsInput | undefined;
  /** A rate decision landing this tick: change of the hourly interest in basis points. */
  rate?: { fromBps: number; toBps: number } | undefined;
  /** A dealer-ordered regime starting this tick (국면 발동). */
  regimeOrder?: { kind: RegimeKind; minutes: number } | undefined;
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
  const base = COINS[id].anchor * state.coins[id].af * (state.coins[id].ff ?? 1) * (state.coins[id].nf ?? 1);
  if (id === "FTN" && debtLink) return base * state.debtF;
  if (id === "WHL") return base * state.heatF;
  return base;
}

export interface StepResult {
  state: MarketState;
  feed: FeedItem[];
  /** Virtual (crowd) volume of this tick per coin, coins of notional. */
  flow: Record<CoinId, number>;
}

export function stepMarket(state: MarketState, input: StepInput): StepResult {
  // Elapsed time, not tick count, sets the step: the dealer may change the tick interval at any time.
  const { config, seq, atMs } = input, tickSeconds = config.tickSeconds;
  const elapsedMs = atMs - state.atMs;
  const noFlow = Object.fromEntries(COIN_IDS.map((id) => [id, 0])) as Record<CoinId, number>;
  if (seq <= state.seq || elapsedMs <= 0) return { state, feed: [], flow: noFlow };
  const hours = Math.min(elapsedMs, 3_600_000) / 3_600_000;
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
  if (due.scheduled && elapsedMs <= 600_000) { addJump("BLC", 1 + due.dir * due.size); feed.push({ kind: "blcReveal", coin: "BLC", tone: due.dir > 0 ? "up" : "down", text: FEED_TEXT.blcReveal }); }

  const boosts: Partial<Record<CoinId, { boost: number; until: number }>> = {};
  if (rng.next() < (2 * hours) / 24) { boosts.HBT = { boost: 1.5, until: atMs + 3_600_000 }; feed.push({ kind: "hbtPatch", coin: "HBT", tone: "warn", text: FEED_TEXT.hbtPatch }); }

  // Dealer news.
  for (const shock of input.news ?? []) {
    const dir = shock.dir === 0 ? (rng.next() < 0.5 ? 1 : -1) : shock.dir;
    addJump(shock.coin, 1 + dir * NEWS_SIZES[shock.size]);
    boosts[shock.coin] = { boost: 2, until: atMs + shock.minutes * 60_000 };
    feed.push({ kind: "news", coin: shock.coin, tone: shock.dir === 0 || shock.size === "z" ? "info" : dir > 0 ? "up" : "down", text: shock.headline });
  }

  // 지배인 금리 결정.
  if (input.rate) {
    const delta = input.rate.toBps - input.rate.fromBps;
    if (delta !== 0) for (const id of COIN_IDS) addJump(id, rateShock(id, delta));
    feed.push(rateFeed(input.rate.fromBps, input.rate.toBps));
  }

  // 4단계: the hidden regime (its own random stream).
  const regime = config.regimes === false ? undefined
    : stepRegime(state.regime ?? initialRegime(prevMs), atMs, hours, new XorShift32(regimeSeed(input.seeds.tick)), input.regimeOrder);

  const next: MarketState = {
    seq, atMs, prevSeq: state.seq, prev: { ...state.prev }, coins: { ...state.coins },
    liberated: [...world.liberated], houseOpen: world.houseOpen, debtF: world.debtF, heatF: world.heatF,
    ...(regime ? { regime } : {}),
  };
  const common = normal(rng);
  // 7단계 섹터: one shared draw per sector (its own stream, so the other draws stay as they were).
  const sectorRng = new XorShift32((input.seeds.tick ^ 0x3c6ef372) >>> 0);
  const sectorNoise = Object.fromEntries(SECTOR_IDS.map((id) => [id, normal(sectorRng)])) as Record<SectorId, number>;
  // The crowd draws from its own stream so the price path stays exactly as before.
  const crowdRng = new XorShift32(crowdSeed(input.seeds.tick));
  const npc = config.npc ?? { enabled: true, scale: 1 };
  const flow = { ...noFlow };
  for (const id of COIN_IDS) {
    const def = COINS[id], cs = state.coins[id];
    next.prev[id] = cs.p;
    const af = cs.af * (afMult[id] ?? 1);
    const anchor = anchorOf({ ...next, coins: { ...next.coins, [id]: { ...cs, af } } }, id, config.debtLink);
    const storm = cs.storm ? rng.next() >= Math.min(1, hours) : rng.next() < hours / 24;
    const boost = boosts[id] ?? (atMs < cs.boostUntil ? { boost: cs.boost, until: cs.boostUntil } : { boost: 1, until: 0 });
    const night = id === "MWL" && isMoonlessNight(atMs) ? 4 : 1;
    // 2단계 실적: price in half of what the week's hints point to, jump on the announcement, then drift.
    let ff = cs.ff ?? 1, pre = cs.pre ?? 0, drift = cs.drift ?? 0, driftUntil = cs.driftUntil ?? 0, eh = cs.eh;
    let earningsMove = 0, tense = 1;
    const spc = id === "WHL" ? heatShare(world.heatF) : world.spc?.[id] ?? cs.spc ?? 0;
    if (config.earnings !== false && input.fundamentals) {
      const due = earningsAt(id, weekIndexAt(atMs));
      if (prevMs < due && due <= atMs) {
        const surprise = Math.round((input.fundamentals.sNpc[id] + spc) * 1_000) / 1_000, full = earningsJump(surprise);
        earningsMove = full - pre;
        pre = 0; ff = nextFf(ff, surprise); drift = (PEAD * full) / PEAD_HOURS; driftUntil = atMs + PEAD_HOURS * 3_600_000;
        eh = [...(eh ?? []), surprise].slice(-4);
        feed.push(earningsFeed(id, surprise));
      } else if (atMs < due) {
        const target = PRE_BAKE * earningsJump(input.fundamentals.mood[id] + spc), left = (due - atMs) / 3_600_000;
        const step = (target - pre) * Math.min(1, hours / Math.max(hours, left));
        earningsMove = step; pre += step;
        if (left <= 1) tense = 1.3;
      }
    }
    if (atMs < driftUntil) earningsMove += drift * hours; else drift = 0;
    // 3단계 자동 뉴스 (its own random stream; a halted coin gets no news and keeps its pending story).
    const haltedNow = config.coins[id]?.enabled === false;
    let an = cs.an ?? null, nd = cs.nd ?? 0, ndu = cs.ndu ?? 0, lognf = Math.log(cs.nf ?? 1) * Math.exp(-hours / NEWS_FACTOR_HOURS);
    if (atMs < ndu) earningsMove += nd * hours; else { nd = 0; ndu = 0; }
    if (!haltedNow) {
      const story = stepAutoNews(id, an, atMs, hours, config.autoNews !== false && config.coins[id]?.autoNews !== false, new XorShift32(newsSeed(input.seeds.tick, COIN_IDS.indexOf(id))));
      earningsMove += story.move; an = story.pending; feed.push(...story.feed);
      lognf = Math.min(Math.log(1.4), Math.max(Math.log(0.7), lognf + story.lasting));
      if (story.drift) { nd = story.drift.perHour; ndu = story.drift.until; }
    }
    const vol = def.volH * (config.coins[id]?.volMult ?? 1) * (storm ? 2.5 : 1) * boost.boost * night * tense * Math.sqrt(hours);
    const mood = regimeEffect(regime, id, def.beta);
    const sector = sectorOf(id), weights = noiseWeights(mood.beta);
    const e = id === "FTN" ? common
      : sector ? weights.common * common + weights.sector * sectorNoise[sector] + weights.own * mood.ownVol * normal(rng)
      : mood.beta * common + Math.sqrt(1 - mood.beta * mood.beta) * mood.ownVol * normal(rng);
    const noise = vol * e;
    let r = noise - (vol * vol) / 2 + def.revertH * hours * Math.log(anchor / cs.p) + def.momentum * cs.mom;
    if (rng.next() < (def.jumpsPerDay * hours) / 24) {
      const size = def.jumpMin + rng.next() * (def.jumpMax - def.jumpMin);
      const down = def.jumpDownOnly || rng.next() < 0.5;
      r += Math.log(down ? 1 - size : 1 + size);
      if (id === "ORB") feed.push({ kind: "orbSaving", coin: "ORB", tone: "down", text: FEED_TEXT.orbSaving });
    }
    r += (jump[id] ?? 0) + earningsMove + mood.drift * hours;
    // 선행·후행: S9 follows HBT a few minutes late (섹터9 buys the tower's data).
    if (id === "S9") r += 0.25 * state.coins.HBT.mom;
    const base = def.anchor;
    // A halted coin (dealer circuit breaker) keeps its price, so nothing liquidates while nobody can trade it.
    const halted = config.coins[id]?.enabled === false;
    let p = halted ? cs.p : Math.min(base * 50, Math.max(Math.max(1, Math.round(base / 50)), Math.round(cs.p * Math.exp(r))));
    // 거래소 2부: hour-long averages and the crowd.
    const k = 1 - Math.exp(-hours), sigma = usualSigma(id, config.coins[id]?.volMult ?? 1);
    const lp0 = cs.lp ?? Math.log(cs.p), step = Math.log(p / cs.p);
    const rv0 = cs.rv ?? sigma * sigma, rv = rv0 + ((step * step) / Math.max(hours, 1e-6) - rv0) * k;
    const z = (Math.log(p) - lp0) / Math.max(1e-9, sigma);
    let crowd: Crowd | undefined, liquidated = 0;
    if (npc.enabled && npc.scale > 0) {
      const volScale = config.coins[id]?.volMult ?? 1;
      const moved = stepCrowd(cs.npc ?? initialCrowd(id, cs.p, npc.scale), id, cs.p, p, hours, z, Math.sqrt(rv) / Math.max(1e-9, sigma), npc.scale, crowdRng, volScale);
      crowd = moved.crowd; liquidated = moved.liquidated; flow[id] = Math.round(moved.flow);
      // 청산 연쇄: one more push the same way, within this tick, without cascading again.
      const extra = halted || config.cascade === false ? 0 : cascadeMove(moved);
      if (extra) {
        const pushed = Math.min(base * 50, Math.max(Math.max(1, Math.round(base / 50)), Math.round(p * Math.exp(extra))));
        const after = liquidateCrowd(crowd, p, pushed, volScale);
        crowd = after.crowd; liquidated += after.liquidated; flow[id] += Math.round(after.liquidated);
        p = pushed;
      }
    }
    next.coins[id] = {
      p, af, storm, boost: boost.boost, boostUntil: boost.until, mom: 0.8 * cs.mom + 0.2 * noise,
      npc: crowd, lp: Math.round((lp0 + (Math.log(p) - lp0) * k) * 1e6) / 1e6, rv: Math.round(rv * 1e8) / 1e8,
      lq: Math.round((cs.lq ?? 0) * Math.exp(-hours) + liquidated),
      ff, pre: Math.round(pre * 1e6) / 1e6, drift: Math.round(drift * 1e7) / 1e7, driftUntil, spc, eh,
      an: an ?? undefined, nd: Math.round(nd * 1e7) / 1e7, ndu, nf: Math.round(Math.exp(lognf) * 1e5) / 1e5, F: cs.F,
    };
  }
  return { state: next, feed, flow };
}
