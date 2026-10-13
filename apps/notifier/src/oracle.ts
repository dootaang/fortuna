import {
  COIN_IDS, debtFactor, foldCandle, heatFactor, hourDocId, hourIndexAt, initialMarketState, isCoinId, marketSeed, minuteKey, normalizeMarket, normalizeNotify,
  seedKeys, stateFromTick, stepMarket, tickFromState, tickSeq, triggerAt,
  type Candle, type CoinId, type FeedItem, type MarketConfig, type MarketState, type NewsShock, type NewsSize, type TickDoc, type WorldInput,
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
  return {
    fs, secret, config, hour, minute, candle,
    state: found ? stateFromTick(found.tick, found.atMs) : null,
    hourUpdateTime: current ? current.updateTime : null,
  };
}

/** Liberations, house, total debt and table heat — read every ten minutes. */
export async function observeWorld(fs: FirestoreRest, atMs: number): Promise<WorldInput> {
  const [districts, economy, wallets, bets] = await Promise.all([
    fs.list("districts"), fs.get("config/economy", ["gambling"]), fs.list("wallets"), fs.countSince("ledger", "type", "betOpen", "at", atMs - 3_600_000),
  ]);
  const arrived = wallets.filter((wallet) => wallet.data.arrived === true);
  const totalDebt = arrived.reduce((sum, wallet) => sum + Number(wallet.data.debt ?? 0), 0);
  return {
    liberated: districts.filter((district) => district.data.liberated === true).map((district) => district.id).sort(),
    houseOpen: (economy?.data.gambling as { houseOpen?: unknown } | undefined)?.houseOpen === true,
    debtF: arrived.length ? debtFactor(totalDebt, arrived.length) : 1,
    heatF: heatFactor(bets),
  };
}

function shockOf(doc: Doc): NewsShock | null {
  const { coin, dir, size, minutes, headline } = doc.data;
  if (!isCoinId(coin) || (dir !== 1 && dir !== -1 && dir !== 0) || (size !== "z" && size !== "s" && size !== "m" && size !== "l")) return null;
  return { id: doc.id, coin, dir, size: size as NewsSize, minutes: Math.max(1, Math.min(1_440, Number(minutes) || 30)), headline: String(headline ?? "").slice(0, 200) };
}

export interface TickOptions { world?: WorldInput | undefined; news?: Doc[] | undefined; }

export async function recordTick(recorder: Recorder, atMs: number, options: TickOptions = {}, retry = true): Promise<TickResult> {
  const { fs, config } = recorder, tickMs = config.tickSeconds * 1000;
  const seq = tickSeq(atMs, config.tickSeconds);
  const base = recorder.state ?? initialMarketState(seq - 1, atMs - tickMs);
  if (base.seq >= seq) return { status: "skipped", seq, feed: [], closed: [] };

  const pending = options.news ?? [];
  const due = pending.filter((doc) => toMs(doc.data.publishAt) <= atMs);
  const whispers = pending.filter((doc) => !due.includes(doc) && doc.data.whispered !== true && typeof doc.data.whisper === "string" && doc.data.whisper && toMs(doc.data.whisperAt) <= atMs);
  const shocks = due.map(shockOf).filter((shock): shock is NewsShock => shock !== null);

  const keys = seedKeys(seq, atMs, config.tickSeconds);
  const seeds = { tick: marketSeed(recorder.secret, keys.tick), blcNow: marketSeed(recorder.secret, keys.blcNow), blcPast: marketSeed(recorder.secret, keys.blcPast), s9Week: marketSeed(recorder.secret, keys.s9Week) };
  const stepped = stepMarket(base, { seq, atMs, seeds, config, world: options.world, news: shocks });
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

  const hour = hourIndexAt(atMs), minute = minuteKey(atMs);
  const previous = recorder.hour === hour && recorder.minute === minute ? recorder.candle : null;
  const candle = Object.fromEntries(COIN_IDS.map((id) => [id, foldCandle(previous?.[id], state.coins[id].p)])) as Record<CoinId, Candle>;
  const last = tickFromState(state, new Stamp(atMs));
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
    ...ends.map(({ doc, status, exit }) => ({
      update: { name: doc.name, fields: encodeFields({ status, exit, exitSeq: seq, exitAt: new Stamp(atMs) }) },
      updateMask: { fieldPaths: ["status", "exit", "exitSeq", "exitAt"] }, currentDocument: { updateTime: doc.updateTime },
    })),
  ];
  try {
    const times = await fs.commit(writes);
    recorder.state = state; recorder.hour = hour; recorder.minute = minute; recorder.candle = candle; recorder.hourUpdateTime = times[0] ?? null;
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const FEED_TO_DISCORD = new Set(["news", "liberation", "houseOpen"]);

/** One cron run: the ticks of the current minute. */
export async function runMinute(env: RecorderEnv, scheduledMs: number, post: typeof fetch = fetch): Promise<number> {
  if (!env.ORACLE_REFRESH_TOKEN || !env.MARKET_SECRET) return 0;
  const fs = new FirestoreRest(env.FIREBASE_PROJECT_ID, await oracleToken(env), env.FIRESTORE_HOST);
  const start = Math.floor(scheduledMs / 60_000) * 60_000;
  const recorder = await loadRecorder(fs, env.MARKET_SECRET, Math.max(start, Date.now()));
  if (!recorder.config.enabled) return 0;
  const tickMs = recorder.config.tickSeconds * 1000;
  const observe = recorder.state === null || Math.floor(start / 60_000) % 10 === 0;
  const [world, news, notifyDoc] = await Promise.all([
    observe ? observeWorld(fs, start) : Promise.resolve(undefined), fs.query("marketNews", { status: "pending" }), fs.get("config/notify"),
  ]);
  const notify = normalizeNotify(notifyDoc?.data);
  let written = 0, first = true;
  for (let at = start; at < start + 60_000; at += tickMs) {
    const wait = at - Date.now();
    if (wait > 0) await sleep(wait);
    if (Date.now() - at > tickMs) continue;
    const result = await recordTick(recorder, at, { world: first ? world : undefined, news });
    first = false;
    if (result.status !== "written") continue;
    written += 1;
    const lines = result.feed.filter((item) => FEED_TO_DISCORD.has(item.kind)).map((item) => `📈 **환전가 소식** ${item.coin ? `[${item.coin}] ` : ""}${item.text}`);
    if (lines.length && notify.enabled.market && env.DISCORD_WEBHOOK_URL) {
      await post(env.DISCORD_WEBHOOK_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "포르투나 환전가", content: lines.join("\n"), allowed_mentions: { parse: [] } }),
      }).catch(() => undefined);
    }
  }
  return written;
}
