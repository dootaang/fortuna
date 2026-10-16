import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDoc, limit, orderBy, query, where, type CollectionReference, type DocumentReference, type Timestamp } from "firebase/firestore";
import { COIN_IDS, DEFAULT_MARKET, hourIndexAt, normalizeMarket, type CoinId, type DividendClaim, type FundamentalsDoc, type HourDoc, type MarketConfig, type RateEventDoc, type ReportDoc, type TickDoc } from "@fortuna/core";
import { refs, settleEndedPositions, type FeedDoc, type HoldingDoc, type PositionDoc } from "@fortuna/data";
import { db } from "../firebase.ts";
import { usePlayer } from "../session/player.tsx";
import { useLiveDoc, useLiveQuery, type Row } from "../session/live.ts";
import { relay } from "../relay.ts";

export function useMarketConfig(): { config: MarketConfig; ready: boolean; exists: boolean } {
  const live = useLiveDoc(refs.marketConfig(db), "market:config");
  return useMemo(() => ({
    config: live.status === "ready" && live.data ? normalizeMarket(live.data) : DEFAULT_MARKET,
    ready: live.status !== "loading",
    exists: live.status === "ready" && Boolean(live.data),
  }), [live]);
}

/** Changes every minute so hour-based subscriptions roll over. */
function useHourNow(now: () => number): number {
  const [hour, setHour] = useState(() => hourIndexAt(now()));
  useEffect(() => {
    const timer = window.setInterval(() => setHour(hourIndexAt(now())), 20_000);
    return () => window.clearInterval(timer);
  }, []);
  return hour;
}

/** Finished hours never change; keep them for the whole session. */
const pastHours = new Map<number, HourDoc<Timestamp> | null>();

export interface Tape {
  /** Newest tick and the hour it belongs to; null before the first price. */
  latest: { hour: number; tick: TickDoc<Timestamp> } | null;
  /** Price one tick before `latest`, for the board's up/down flash. */
  hours: HourDoc<Timestamp>[];
}

/** Live prices: the current and previous hour live, `history` older hours once. */
export function useTape(now: () => number, history = 0): Tape {
  const hour = useHourNow(now);
  // The next hour too: a device clock running a little behind still sees the newest tick.
  const next = useLiveDoc(refs.marketHour(db, hour + 1), `market:h${hour + 1}`);
  const current = useLiveDoc(refs.marketHour(db, hour), `market:h${hour}`);
  const previous = useLiveDoc(refs.marketHour(db, hour - 1), `market:h${hour - 1}`);
  const [older, setOlder] = useState<HourDoc<Timestamp>[]>([]);

  useEffect(() => {
    let cancelled = false;
    const wanted = Array.from({ length: history }, (_, index) => hour - 2 - index);
    void Promise.all(wanted.map(async (index) => {
      if (!pastHours.has(index)) pastHours.set(index, (await getDoc(refs.marketHour(db, index)).catch(() => null))?.data() ?? null);
      return pastHours.get(index) ?? null;
    })).then((docs) => { if (!cancelled) setOlder(docs.filter((doc): doc is HourDoc<Timestamp> => doc !== null)); });
    return () => { cancelled = true; };
  }, [hour, history]);

  return useMemo(() => {
    const live = [next, current, previous].flatMap((entry) => (entry.status === "ready" && entry.data ? [entry.data] : []));
    const hours = [...older, ...live].sort((a, b) => a.hour - b.hour);
    const newest = hours.at(-1);
    return { latest: newest ? { hour: newest.hour, tick: newest.last } : null, hours };
  }, [next, current, previous, older]);
}

/** Seconds until the next tick should land (for the board clock). */
export function useCountdown(tick: TickDoc<Timestamp> | null, tickSeconds: number, now: () => number): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const update = () => setLeft(tick ? Math.max(0, Math.ceil((tick.at.toMillis() + tickSeconds * 1000 - now()) / 1000)) : 0);
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [tick?.seq, tickSeconds]);
  return left;
}

/** Positions still on the books (open, or ended and waiting for this app to settle). */
export function useMyPositions(): Row<PositionDoc>[] {
  const { session } = usePlayer();
  const live = useLiveQuery(
    query(refs.positions(db), where("playerId", "==", session.pid), where("status", "in", ["open", "capped", "liquidated", "void"])),
    `positions:${session.pid}`,
  );
  return useMemo(() => (live.status === "ready" ? [...live.data].sort((a, b) => b.data.openedAt?.toMillis?.() - a.data.openedAt?.toMillis?.()) : []), [live]);
}

export function useFeed(count = 20, coin?: CoinId): Row<FeedDoc>[] {
  const live = useLiveQuery(query(refs.marketFeed(db), orderBy("at", "desc"), limit(count)), `feed:${count}`);
  return useMemo(() => {
    const rows = live.status === "ready" ? live.data : [];
    return coin ? rows.filter((row) => row.data.coin === coin || row.data.coin === null) : rows;
  }, [live, coin]);
}

/** Book positions the recorder liquidated or capped, or the dealer voided, as soon as they show up. */
export function useAutoSettle(onSettled?: (count: number) => void) {
  const { session, notify } = usePlayer();
  const live = useLiveQuery(
    query(refs.positions(db), where("playerId", "==", session.pid), where("status", "in", ["capped", "liquidated", "void"])),
    `positions:ended:${session.pid}`,
  );
  const busy = useRef(false);
  const ids = live.status === "ready" ? live.data.map((row) => row.id).join(",") : "";
  useEffect(() => {
    if (!ids || busy.current) return;
    busy.current = true;
    void settleEndedPositions(session, notify.bigGamble)
      .then((results) => { results.forEach((result) => relay(notify.relayUrl, result.eventId)); onSettled?.(results.length); })
      .catch(() => undefined)
      .finally(() => { busy.current = false; });
  }, [ids]);
}

/** Previous price per coin, so the board can flash the direction of the last move. */
export function directionOf(tick: TickDoc<Timestamp> | null, coin: CoinId): -1 | 0 | 1 {
  if (!tick) return 0;
  const now = tick.p[coin], before = tick.prev?.[coin] ?? now;
  return now > before ? 1 : now < before ? -1 : 0;
}

/** First price of the window held in `hours` (for "change" figures). */
export function openingPrice(hours: readonly HourDoc<Timestamp>[], coin: CoinId): number | null {
  for (const doc of hours) {
    const keys = Object.keys(doc.c ?? {}).sort();
    for (const key of keys) { const candle = doc.c[key]?.[coin]; if (candle) return candle[0]; }
  }
  return null;
}

export const ALL_COINS = COIN_IDS;

/** Spot holdings with something left in them. */
export function useMyHoldings(): Row<HoldingDoc>[] {
  const { session } = usePlayer();
  const live = useLiveQuery(query(refs.holdings(db), where("playerId", "==", session.pid)), `holdings:${session.pid}`);
  return useMemo(() => (live.status === "ready" ? live.data.filter((row) => row.data.units > 0) : []), [live]);
}

// ── 거래소 2부 2단계: 실적·리포트·금리 결정 ──

export function useFundamentals(): FundamentalsDoc<Timestamp> | null {
  const live = useLiveDoc(doc(db, "market", "fundamentals") as DocumentReference<FundamentalsDoc<Timestamp>>, "market:fundamentals");
  return live.status === "ready" ? live.data : null;
}

/** The latest reports (a few weeks of them), newest first. */
export function useReports(count = 40): ReportDoc<Timestamp>[] {
  const live = useLiveQuery(query(collection(db, "marketReports") as CollectionReference<ReportDoc<Timestamp>>, orderBy("at", "desc"), limit(count)), `reports:${count}`);
  return useMemo(() => (live.status === "ready" ? live.data.map((row) => row.data) : []), [live]);
}

/** Rate decisions announced and not yet applied. */
export function useRateEvents(): Row<RateEventDoc<Timestamp>>[] {
  const live = useLiveQuery(query(collection(db, "marketEvents") as CollectionReference<RateEventDoc<Timestamp>>, where("status", "==", "pending")), "marketEvents:pending");
  return live.status === "ready" ? live.data : [];
}

/** Latest report per coin, with that writer's hit record. */
export function latestReports(reports: readonly ReportDoc<Timestamp>[]): Map<CoinId, { report: ReportDoc<Timestamp>; hits: number; scored: number }> {
  const out = new Map<CoinId, { report: ReportDoc<Timestamp>; hits: number; scored: number }>();
  for (const report of reports) {
    const entry = out.get(report.coin) ?? { report, hits: 0, scored: 0 };
    if (report.prev) { entry.scored += 1; if (report.prev.hit) entry.hits += 1; }
    out.set(report.coin, entry);
  }
  return out;
}

/** Dividend claims with something left to collect (거래소 2부 6단계). */
export function useDividendClaims(): Row<DividendClaim<Timestamp>>[] {
  const { session } = usePlayer();
  const live = useLiveQuery(query(collection(db, "dividendClaims") as CollectionReference<DividendClaim<Timestamp>>, where("playerId", "==", session.pid)), `dividends:${session.pid}`);
  return useMemo(() => (live.status === "ready" ? live.data.filter((row) => row.data.total > row.data.claimed) : []), [live]);
}

