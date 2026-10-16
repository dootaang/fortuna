import {
  REGIME_ORDER_TEXT, addFunding, fundingDue, isRegimeKind, type Regime,
  ANALYSTS, COIN_IDS, activityRatio, analystBand, anchorOf, buildStructure, coinForDistrict, debtFactor, fundamentalsInput, playerShare, reportAt, reportSeedKey, weekIndexAt, weekStartMs, foldCandle, heatFactor, hourDocId, hourIndexAt, initialMarketState, isCoinId, marketSeed, minuteKey, normalizeMarket, normalizeNotify,
  seedKeys, stateFromTick, stepMarket, tickFromState, tickSeq, triggerAt,
  type Candle, type CoinId, type OpenLot, type FeedItem, type MarketConfig, type MarketState, type NewsShock, type NewsSize, type TickDoc, type WorldInput,
} from "@fortuna/core";
import { CommitConflict, FirestoreRest, Stamp, encode, encodeFields, type Doc, type Write } from "./firestore-rest.ts";

/**
 * 시세 기록원. A cron Worker that signs in as a dedicated account listed in oracles/{uid}
 * and writes one tick every `tickSeconds`: prices (market/h{hour}), feed lines (marketFeed),
 * dealer news it published, and positions the new price liquidated or capped — all in one commit,
 * so a stale price can never close a position that is already gone. It never touches coins.
 */
export interface RecorderEnv {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_API_KEY: string;
  ORACLE_REFRESH_TOKEN: string;
  MARKET_SECRET: string;
  DISCORD_WEBHOOK_URL: string;
  FIRESTORE_HOST?: string;
  AUTH_HOST?: string;
}

export interface Recorder {
  fs: FirestoreRest;
  secret: string;
  config: MarketConfig;
  state: MarketState | null;
  hour: number;
  /** updateTime of market/h{hour}, or null when that document does not exist yet. */
  hourUpdateTime: string | null;
  minute: string;
  candle: Record<CoinId, Candle> | null;
}

export interface TickResult { status: "written" | "skipped"; seq: number; feed: FeedItem[]; closed: string[]; }

const toMs = (value: unknown) => (typeof value === "string" ? Date.parse(value) : 0);

function tickOf(data: Record<string, unknown> | undefined): { tick: TickDoc; atMs: number } | null {
  const last = data?.last as (TickDoc & { at: unknown }) | undefined;
  return last && typeof last.seq === "number" ? { tick: last as TickDoc, atMs: toMs(last.at) } : null;
}

export async function loadRecorder(fs: FirestoreRest, secret: string, atMs: number): Promise<Recorder> {
  const config = normalizeMarket((await fs.get("config/market"))?.data);
  const hour = hourIndexAt(atMs), minute = minuteKey(atMs);
  const current = await fs.get(`market/${hourDocId(hour)}`, ["last", `c.${minute}`]);
  const found = tickOf(current?.data) ?? tickOf((await fs.get(`market/${hourDocId(hour - 1)}`, ["last"]))?.data);
  const candle = ((current?.data.c as Record<string, unknown> | undefined)?.[minute] as Record<CoinId, Candle> | undefined) ?? null;
  const state = found ? stateFromTick(found.tick, found.atMs) : null;
  // The regime is not in the public tick; it lives in a document only the recorder and the dealer read.
  const kept = state ? (await fs.get("oracleState/regime").catch(() => null))?.data : null;
  if (state && kept && isRegimeKind(kept.kind)) {
    state.regime = { kind: kept.kind, since: toMs(kept.since), forcedUntil: toMs(kept.forcedUntil), dirs: (kept.dirs as Regime["dirs"]) ?? undefined };
  }
  return {
    fs, secret, config, hour, minute, candle,
    state,
    hourUpdateTime: current ? current.updateTime : null,
  };
}

/** Residents' activity this week (거래소 2부 4-1): ratio against an ordinary week, per coin. */
export interface Activity { ratio: number | null; residents: number; }

export interface World extends WorldInput { activity?: Record<CoinId, Activity> | undefined; activityError?: string | undefined; }

/** Liberations, house, total debt, table heat and resident activity — read every ten minutes. */
export async function observeWorld(fs: FirestoreRest, atMs: number): Promise<World> {
  const [districts, economy, wallets, bets] = await Promise.all([
    fs.list("districts"), fs.get("config/economy", ["gambling"]), fs.list("wallets"), fs.countSince("ledger", "type", "betOpen", "at", atMs - 3_600_000),
  ]);
  const arrived = wallets.filter((wallet) => wallet.data.arrived === true);
  const totalDebt = arrived.reduce((sum, wallet) => sum + Number(wallet.data.debt ?? 0), 0);
  const world: World = {
    liberated: districts.filter((district) => district.data.liberated === true).map((district) => district.id).sort(),
    houseOpen: (economy?.data.gambling as { houseOpen?: unknown } | undefined)?.houseOpen === true,
    debtF: arrived.length ? debtFactor(totalDebt, arrived.length) : 1,
    heatF: heatFactor(bets),
  };
  // Resident activity is an extra; prices keep their world even if it fails.
  try {
    const players = await fs.list("players");
    const since = weekStartMs(weekIndexAt(atMs)), ids = new Set(arrived.map((wallet) => wallet.id));
    const residents = players.filter((player) => ids.has(player.id));
    const counts = await Promise.all(residents.map(async (player) => {
      const [work, repay, skill] = await Promise.all([
        fs.aggregate("ledger", { playerId: player.id, type: "work" }, "at", since, { count: true }),
        // Repayments are few; read them rather than sum (a sum aggregation needs its own index).
        fs.query("ledger", { playerId: player.id, type: "repay" }, 300)
          .then((rows) => rows.filter((row) => toMs(row.data.at) >= since).reduce((sum, row) => sum + Number((row.data.detail as { amount?: unknown } | undefined)?.amount ?? 0), 0)),
        fs.aggregate("ledger", { playerId: player.id, type: "skill" }, "at", since, { count: true }),
      ]);
      return { coin: coinForDistrict(String(player.data.districtId ?? "")), work, repay, skill };
    }));
    const activity = {} as Record<CoinId, Activity>, spc: Partial<Record<CoinId, number>> = {};
    for (const coin of COIN_IDS) {
      const mine = coin === "FTN" ? counts : counts.filter((entry) => entry.coin === coin);
      const total = mine.reduce((sum, entry) => ({ work: sum.work + entry.work, repay: sum.repay + entry.repay, skill: sum.skill + entry.skill }), { work: 0, repay: 0, skill: 0 });
      const ratio = activityRatio({ ...total, residents: mine.length });
      activity[coin] = { ratio, residents: mine.length };
      if (coin !== "WHL") spc[coin] = playerShare(ratio);
    }
    world.activity = activity; world.spc = spc;
  } catch (error) {
    console.error("activity", error);
    world.activityError = String(error instanceof Error ? error.message : error).slice(0, 300);
  }
  return world;
}

/** HMAC seeds are a little costly; the same keys come back every tick of a day or week. */
const seedCache = new Map<string, number>();
function cachedSeed(secret: string, key: string): number {
  let seed = seedCache.get(key);
  if (seed === undefined) {
    if (seedCache.size > 400) seedCache.clear();
    seed = marketSeed(secret, key);
    seedCache.set(key, seed);
  }
  return seed;
}

function shockOf(doc: Doc): NewsShock | null {
  const { coin, dir, size, minutes, headline } = doc.data;
  if (!isCoinId(coin) || (dir !== 1 && dir !== -1 && dir !== 0) || (size !== "z" && size !== "s" && size !== "m" && size !== "l")) return null;
  return { id: doc.id, coin, dir, size: size as NewsSize, minutes: Math.max(1, Math.min(1_440, Number(minutes) || 30)), headline: String(headline ?? "").slice(0, 200) };
}

export interface TickOptions { world?: World | undefined; news?: Doc[] | undefined; events?: Doc[] | undefined; regimes?: Doc[] | undefined; }

export async function recordTick(recorder: Recorder, atMs: number, options: TickOptions = {}, retry = true): Promise<TickResult> {
  const { fs, config } = recorder, tickMs = config.tickSeconds * 1000;
  // seq counts ticks; it does not depend on the interval, so the dealer can change the interval freely.
  const base = recorder.state ?? initialMarketState(tickSeq(atMs, config.tickSeconds) - 1, atMs - tickMs);
  const seq = base.seq + 1;
  if (base.atMs >= atMs) return { status: "skipped", seq: base.seq, feed: [], closed: [] };

  const pending = options.news ?? [];
  const due = pending.filter((doc) => toMs(doc.data.publishAt) <= atMs);
  const whispers = pending.filter((doc) => !due.includes(doc) && doc.data.whispered !== true && typeof doc.data.whisper === "string" && doc.data.whisper && toMs(doc.data.whisperAt) <= atMs);
  const shocks = due.map(shockOf).filter((shock): shock is NewsShock => shock !== null);

  const keys = seedKeys(seq, atMs, config.tickSeconds);
  const seeds = { tick: marketSeed(recorder.secret, keys.tick), blcNow: marketSeed(recorder.secret, keys.blcNow), blcPast: marketSeed(recorder.secret, keys.blcPast), s9Week: marketSeed(recorder.secret, keys.s9Week) };
  const sign = (key: string) => cachedSeed(recorder.secret, key);
  const fundamentals = config.earnings ? fundamentalsInput(sign, atMs) : undefined;
  // 지배인 금리 결정: the first announced decision whose time has come.
  const rateDoc = (options.events ?? []).find((doc) => doc.data.kind === "rate" && toMs(doc.data.at) <= atMs && Number.isInteger(doc.data.bps));
  const rate = rateDoc ? { fromBps: config.interestBps, toBps: Number(rateDoc.data.bps) } : undefined;
  // 국면 발동: the first dealer order whose time has come.
  const orderDoc = (options.regimes ?? []).find((doc) => isRegimeKind(doc.data.kind) && toMs(doc.data.at) <= atMs);
  const regimeOrder = orderDoc && isRegimeKind(orderDoc.data.kind) ? { kind: orderDoc.data.kind, minutes: Math.max(5, Math.min(1_440, Number(orderDoc.data.minutes) || 30)) } : undefined;
  const stepped = stepMarket(base, { seq, atMs, seeds, config, world: options.world, news: shocks, fundamentals, rate, regimeOrder });
  if (regimeOrder && REGIME_ORDER_TEXT[regimeOrder.kind]) stepped.feed.push({ kind: "regime", coin: null, tone: "warn", text: REGIME_ORDER_TEXT[regimeOrder.kind]! });
  const feed: FeedItem[] = [
    ...whispers.map((doc) => ({ kind: "whisper", coin: isCoinId(doc.data.coin) ? doc.data.coin : null, tone: "info" as const, text: String(doc.data.whisper).slice(0, 200) })),
    ...stepped.feed,
  ];
  const state = stepped.state;

  // Positions the move ended: check the previous tick too, for positions opened before it.
  const open = await fs.query("positions", { status: "open" });
  const ends: { doc: Doc; status: "liquidated" | "capped"; exit: number }[] = [];
  for (const doc of open) {
    const coin = doc.data.coin, side = doc.data.side, liq = Number(doc.data.liq), cap = Number(doc.data.cap);
    if (!isCoinId(coin) || (side !== "long" && side !== "short")) continue;
    const prices = Number(doc.data.entrySeq) < base.seq ? [base.coins[coin].p, state.coins[coin].p] : [state.coins[coin].p];
    for (const price of prices) {
      const hit = triggerAt({ side, liq, cap }, price);
      if (hit) { ends.push({ doc, status: hit === "cap" ? "capped" : "liquidated", exit: hit === "cap" ? cap : liq }); break; }
    }
  }

  // 거래소 2부: players' share of the structure and volume (new positions since the last tick), liquidations into the hour's tally.
  const lots: OpenLot[] = [], volume = { ...stepped.flow };
  const ended = new Set(ends.map(({ doc }) => doc.id));
  for (const doc of open) {
    const coin = doc.data.coin, side = doc.data.side, notional = Number(doc.data.margin) * Number(doc.data.leverage);
    if (!isCoinId(coin) || (side !== "long" && side !== "short") || !Number.isFinite(notional)) continue;
    if (Number(doc.data.entrySeq) === base.seq) volume[coin] += notional;
    if (ended.has(doc.id)) {
      const tick = state.coins[coin];
      if (ends.find((end) => end.doc.id === doc.id)?.status === "liquidated") state.coins[coin] = { ...tick, lq: (tick.lq ?? 0) + notional };
      continue;
    }
    lots.push({ coin, side, notional, liq: Number(doc.data.liq) });
  }

  // 애널리스트 리포트: the day after each announcement, scoring the previous band against today's price.
  const reports: Write[] = [];
  const week = weekIndexAt(atMs);
  for (const coin of COIN_IDS) {
    const due = reportAt(coin, week), analyst = ANALYSTS[coin];
    if (!analyst || !config.earnings || !(base.atMs < due && due <= atMs)) continue;
    const tick = state.coins[coin], trend = tick.lp === undefined ? 0 : Math.log(tick.p) - tick.lp;
    const band = analystBand(coin, Math.round(anchorOf(state, coin, config.debtLink)), tick.p, trend, sign(reportSeedKey(coin, week)));
    if (!band) continue;
    const prev = tick.rb ? { low: tick.rb[0], high: tick.rb[1], price: tick.p, hit: tick.p >= tick.rb[0] && tick.p <= tick.rb[1] } : null;
    state.coins[coin] = { ...tick, rb: [band.low, band.high] };
    reports.push({
      update: { name: fs.name(`marketReports/${week}_${coin}`), fields: encodeFields({ coin, week, writer: analyst.name, ...band, price: tick.p, at: new Stamp(atMs), prev }) },
      currentDocument: { exists: false },
    });
    feed.push({ kind: "report", coin, tone: "info", text: `${analyst.name}: ${coin} 적정가 ${(band.low / 100).toFixed(2)} ~ ${(band.high / 100).toFixed(2)}` });
  }

  const hour = hourIndexAt(atMs), minute = minuteKey(atMs);
  const previous = recorder.hour === hour && recorder.minute === minute ? recorder.candle : null;
  const candle = Object.fromEntries(COIN_IDS.map((id) => [id, foldCandle(previous?.[id], state.coins[id].p, Math.round(volume[id]))])) as Record<CoinId, Candle>;
  const fx = buildStructure(state, lots, (coin) => config.coins[coin]?.volMult ?? 1);
  // 5단계 펀딩: at each full hour every coin's index moves by the hour's rate from the book (crowd + players).
  if (config.funding && fundingDue(base.atMs, atMs)) {
    const index = addFunding(Object.fromEntries(COIN_IDS.map((coin) => [coin, state.coins[coin].F ?? 0])), fx.ls);
    for (const coin of COIN_IDS) state.coins[coin] = { ...state.coins[coin], F: index[coin] };
  }
  const last = { ...tickFromState(state, new Stamp(atMs)), fx };
  const sameDoc = recorder.hour === hour && recorder.hourUpdateTime !== null;
  const writes: Write[] = [
    sameDoc
      ? { update: { name: fs.name(`market/${hourDocId(hour)}`), fields: { last: encode(last), c: { mapValue: { fields: { [minute]: encode(candle) } } } } }, updateMask: { fieldPaths: ["last", `c.${minute}`] }, currentDocument: { updateTime: recorder.hourUpdateTime! } }
      : { update: { name: fs.name(`market/${hourDocId(hour)}`), fields: encodeFields({ hour, last, c: { [minute]: candle } }) }, currentDocument: { exists: false } },
    ...feed.map((item, index) => ({
      update: { name: fs.name(`marketFeed/${seq}_${index}`), fields: encodeFields({ ...item, seq, at: new Stamp(atMs) }) },
      currentDocument: { exists: false },
    })),
    ...due.map((doc) => ({ update: { name: doc.name, fields: encodeFields({ status: "published", publishedSeq: seq }) }, updateMask: { fieldPaths: ["status", "publishedSeq"] }, currentDocument: { updateTime: doc.updateTime } })),
    ...whispers.map((doc) => ({ update: { name: doc.name, fields: encodeFields({ whispered: true }) }, updateMask: { fieldPaths: ["whispered"] }, currentDocument: { updateTime: doc.updateTime } })),
    ...reports,
    ...(orderDoc ? [{ update: { name: orderDoc.name, fields: encodeFields({ status: "done", appliedSeq: seq }) }, updateMask: { fieldPaths: ["status", "appliedSeq"] }, currentDocument: { updateTime: orderDoc.updateTime } }] : []),
    ...(state.regime && (state.regime.since !== base.regime?.since || state.regime.kind !== base.regime?.kind || !base.regime) ? [{
      update: {
        name: fs.name("oracleState/regime"),
        fields: encodeFields({ kind: state.regime.kind, since: new Stamp(state.regime.since), forcedUntil: new Stamp(state.regime.forcedUntil), dirs: state.regime.dirs ?? null, at: new Stamp(atMs) }),
      },
    }] : []),
    ...(rateDoc && rate ? [
      { update: { name: rateDoc.name, fields: encodeFields({ status: "done", appliedSeq: seq }) }, updateMask: { fieldPaths: ["status", "appliedSeq"] }, currentDocument: { updateTime: rateDoc.updateTime } },
      { update: { name: fs.name("config/market"), fields: encodeFields({ interestBps: rate.toBps, lastRate: rateDoc.id }) }, updateMask: { fieldPaths: ["interestBps", "lastRate"] } },
    ] : []),
    ...(options.world && fundamentals ? [{
      update: {
        name: fs.name("market/fundamentals"),
        fields: encodeFields({
          at: new Stamp(atMs), week,
          coins: Object.fromEntries(COIN_IDS.map((coin) => [coin, {
            mood: fundamentals.mood[coin], ratio: options.world!.activity?.[coin].ratio ?? null, residents: options.world!.activity?.[coin].residents ?? 0, spc: state.coins[coin].spc ?? 0,
          }])),
          // Shown on the dealer's exchange tab: resident activity could not be counted.
          error: options.world.activityError ?? null,
        }),
      },
    }] : []),
    ...ends.map(({ doc, status, exit }) => ({
      update: { name: doc.name, fields: encodeFields({ status, exit, exitSeq: seq, exitAt: new Stamp(atMs), exitF: isCoinId(doc.data.coin) ? state.coins[doc.data.coin].F ?? 0 : 0 }) },
      updateMask: { fieldPaths: ["status", "exit", "exitSeq", "exitAt", "exitF"] }, currentDocument: { updateTime: doc.updateTime },
    })),
  ];
  try {
    const times = await fs.commit(writes);
    recorder.state = state; recorder.hour = hour; recorder.minute = minute; recorder.candle = candle; recorder.hourUpdateTime = times[0] ?? null;
    if (orderDoc) options.regimes?.splice(options.regimes.indexOf(orderDoc), 1);
    if (rateDoc && rate) {
      recorder.config = { ...recorder.config, interestBps: rate.toBps };
      options.events?.splice(options.events.indexOf(rateDoc), 1);
    }
    if (options.news) {
      // Writes go [hour, ...feed, ...due, ...whispers, ...ends]; keep whispered news with its new updateTime.
      const whisperTimes = new Map(whispers.map((doc, index) => [doc.name, times[1 + feed.length + due.length + index] ?? doc.updateTime]));
      const rest = pending.filter((doc) => !due.includes(doc))
        .map((doc) => (whisperTimes.has(doc.name) ? { ...doc, data: { ...doc.data, whispered: true }, updateTime: whisperTimes.get(doc.name)! } : doc));
      options.news.splice(0, options.news.length, ...rest);
    }
    return { status: "written", seq, feed, closed: ends.map(({ doc }) => doc.id) };
  } catch (error) {
    if (!(error instanceof CommitConflict) || !retry) throw error;
    // Someone else wrote first (an overlapping run, or a player settled a position): reload and try once more.
    const fresh = await loadRecorder(fs, recorder.secret, atMs);
    Object.assign(recorder, fresh);
    const news = options.news ? await fs.query("marketNews", { status: "pending" }) : undefined;
    if (options.events) options.events.splice(0, options.events.length, ...(await fs.query("marketEvents", { status: "pending" }).catch(() => [])));
    if (options.regimes) options.regimes.splice(0, options.regimes.length, ...(await fs.query("marketRegimes", { status: "pending" }).catch(() => [])));
    if (options.news && news) options.news.splice(0, options.news.length, ...news);
    return recordTick(recorder, atMs, { ...options, news: options.news }, false);
  }
}

/** Exchange an oracle refresh token for an ID token. */
export async function oracleToken(env: RecorderEnv): Promise<string> {
  const host = env.AUTH_HOST ? `${env.AUTH_HOST}/securetoken.googleapis.com` : "https://securetoken.googleapis.com";
  const response = await fetch(`${host}/v1/token?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: env.ORACLE_REFRESH_TOKEN }).toString(),
  });
  if (!response.ok) throw new Error(`oracle_token_${response.status}`);
  return ((await response.json()) as { id_token: string }).id_token;
}

const FEED_TO_DISCORD = new Set(["news", "liberation", "houseOpen", "earnings", "report", "rate", "regime"]);
/** 거래소 2부: at most this many market posts a day (KST), so the channel does not drown. */
const DISCORD_DAILY_MAX = 4;

/** When the tick after `nowMs` is due (a little after the boundary, so its time is already past). */
export function nextTickAt(nowMs: number, tickMs: number): number { return (Math.floor(nowMs / tickMs) + 1) * tickMs + 300; }

/**
 * One tick per call, at the tick boundary that `nowMs` falls in. Keeps the recorder, the ID token,
 * pending news and notify settings between calls (the Durable Object holds it while it stays in memory)
 * and refreshes settings once a minute and the world every ten minutes.
 */
export class TickRunner {
  private recorder: Recorder | null = null;
  private token: { value: string; until: number } | null = null;
  private news: Doc[] = [];
  private events: Doc[] = [];
  private regimes: Doc[] = [];
  private posted = { day: -1, count: 0 };
  private notify = normalizeNotify(undefined);
  private minuteChecked = -1;
  private worldChecked = -1;

  constructor(private readonly env: RecorderEnv, private readonly post: typeof fetch = fetch) {}

  tickMs(): number { return (this.recorder?.config.tickSeconds ?? 15) * 1000; }

  /** Forget everything; the next call reloads from Firestore. */
  reset(): void { this.recorder = null; this.minuteChecked = -1; this.worldChecked = -1; }

  /**
   * What survives the Durable Object being evicted between ticks (it usually is: 15 s of idle).
   * Without it every tick would log in again and reread settings and the world — about 15 reads a tick.
   */
  snapshot(): RunnerSnapshot {
    const { fs: _fs, secret: _secret, ...recorder } = this.recorder ?? ({} as Recorder);
    return {
      token: this.token, recorder: this.recorder ? recorder : null, news: this.news, events: this.events, regimes: this.regimes, notify: this.notify,
      minuteChecked: this.minuteChecked, worldChecked: this.worldChecked, posted: this.posted,
    };
  }

  restore(snapshot: RunnerSnapshot, nowMs: number): void {
    this.token = snapshot.token;
    this.news = snapshot.news;
    this.events = snapshot.events ?? [];
    this.regimes = snapshot.regimes ?? [];
    this.posted = snapshot.posted ?? { day: -1, count: 0 };
    this.notify = snapshot.notify;
    this.minuteChecked = snapshot.minuteChecked;
    this.worldChecked = snapshot.worldChecked;
    this.recorder = snapshot.recorder
      ? { ...snapshot.recorder, secret: this.env.MARKET_SECRET, fs: new FirestoreRest(this.env.FIREBASE_PROJECT_ID, this.token?.value ?? "", this.env.FIRESTORE_HOST) }
      : null;
    // A snapshot from long ago (clock stopped for a while) is not trusted: reload.
    if (this.recorder?.state && nowMs - this.recorder.state.atMs > 10 * 60_000) this.reset();
  }

  async run(nowMs: number): Promise<TickResult | null> {
    if (!this.env.ORACLE_REFRESH_TOKEN || !this.env.MARKET_SECRET) return null;
    const fs = await this.rest(nowMs);
    const minute = Math.floor(nowMs / 60_000);
    if (!this.recorder || minute !== this.minuteChecked) {
      if (!this.recorder) this.recorder = await loadRecorder(fs, this.env.MARKET_SECRET, nowMs);
      else this.recorder.config = normalizeMarket((await fs.get("config/market"))?.data);
      const [news, notify, events, regimes] = await Promise.all([
        fs.query("marketNews", { status: "pending" }).catch(() => this.news), fs.get("config/notify").catch(() => null),
        fs.query("marketEvents", { status: "pending" }).catch(() => this.events),
        fs.query("marketRegimes", { status: "pending" }).catch(() => this.regimes),
      ]);
      this.news = news;
      this.events = events;
      this.regimes = regimes;
      this.notify = normalizeNotify(notify?.data);
      this.minuteChecked = minute;
    }
    const recorder = this.recorder;
    recorder.fs = fs;
    if (!recorder.config.enabled) return null;
    const tickMs = recorder.config.tickSeconds * 1000, at = Math.floor(nowMs / tickMs) * tickMs;
    const tenth = Math.floor(minute / 10);
    let world: World | undefined;
    if (recorder.state === null || tenth !== this.worldChecked) {
      // Prices keep moving even if the world read fails; it is tried again in ten minutes.
      world = await observeWorld(fs, at).catch((error) => { console.error("observe", error); return undefined; });
      this.worldChecked = tenth;
    }
    const result = await recordTick(recorder, at, { world, news: this.news, events: this.events, regimes: this.regimes });
    if (result.status === "written") await this.announce(result.feed);
    return result;
  }

  private async rest(nowMs: number): Promise<FirestoreRest> {
    if (!this.token || this.token.until < nowMs) this.token = { value: await oracleToken(this.env), until: nowMs + 50 * 60_000 };
    return new FirestoreRest(this.env.FIREBASE_PROJECT_ID, this.token.value, this.env.FIRESTORE_HOST);
  }

  private async announce(feed: FeedItem[]): Promise<void> {
    const day = Math.floor((Date.now() + 9 * 3_600_000) / 86_400_000);
    if (this.posted.day !== day) this.posted = { day, count: 0 };
    // Dealer news, liberations and the house always go out; earnings, reports and rates share a daily budget.
    const always = feed.filter((item) => ["news", "liberation", "houseOpen"].includes(item.kind));
    // Earnings, reports, rate decisions and big automatic stories (with their corrections) share a daily budget.
    const budget = feed.filter((item) => (FEED_TO_DISCORD.has(item.kind) || item.big === true) && !always.includes(item)).slice(0, Math.max(0, DISCORD_DAILY_MAX - this.posted.count));
    const lines = [...always, ...budget].map((item) => `📈 **환전가 소식** ${item.coin ? `[${item.coin}] ` : ""}${item.text}`);
    if (lines.length && this.notify.enabled.market && this.env.DISCORD_WEBHOOK_URL) this.posted.count += budget.length;
    if (!lines.length || !this.notify.enabled.market || !this.env.DISCORD_WEBHOOK_URL) return;
    await this.post(this.env.DISCORD_WEBHOOK_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "포르투나 환전가", content: lines.join("\n"), allowed_mentions: { parse: [] } }),
    }).catch(() => undefined);
  }
}

export interface RunnerSnapshot {
  token: { value: string; until: number } | null;
  recorder: Omit<Recorder, "fs" | "secret"> | null;
  news: Doc[];
  notify: ReturnType<typeof normalizeNotify>;
  events?: Doc[];
  regimes?: Doc[];
  posted?: { day: number; count: number };
  minuteChecked: number;
  worldChecked: number;
}

interface AlarmStorage {
  getAlarm(): Promise<number | null>;
  setAlarm(time: number): Promise<void>;
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

/**
 * 시세 시계. A Durable Object whose alarm fires every tick (15 s), one tick per wake-up.
 * Cron starts late and unevenly (observed 10–40 s into the minute) and the free plan allows only
 * ~10 ms CPU per invocation, so the clock lives here; the minute cron only re-arms it.
 */
export class MarketClock {
  private readonly runner: TickRunner;
  private restored = false;
  constructor(private readonly state: { storage: AlarmStorage }, env: RecorderEnv) { this.runner = new TickRunner(env); }

  /** Arm the alarm if it is missing or stuck. */
  async fetch(): Promise<Response> {
    const alarm = await this.state.storage.getAlarm();
    if (alarm === null || alarm < Date.now() - 60_000) await this.state.storage.setAlarm(nextTickAt(Date.now(), this.runner.tickMs()));
    return new Response(alarm === null ? "armed" : "running");
  }

  async alarm(): Promise<void> {
    if (!this.restored) {
      const snapshot = await this.state.storage.get<RunnerSnapshot>("runner");
      if (snapshot) this.runner.restore(snapshot, Date.now());
      this.restored = true;
    }
    try { await this.runner.run(Date.now()); } catch (error) { console.error("tick", error); this.runner.reset(); }
    await this.state.storage.put("runner", this.runner.snapshot());
    await this.state.storage.setAlarm(nextTickAt(Date.now(), this.runner.tickMs()));
  }
}
