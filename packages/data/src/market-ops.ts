import { Timestamp, addDoc, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, type Firestore, type Transaction } from "firebase/firestore";
import {
  DEFAULT_MARKET, HOUR_MS, KST_OFFSET_MS, hourIndexAt, leverageChoices, normalizeMarket, periodWords, quoteClose, quoteOpen,
  type CloseKind, type CloseQuote, type CoinId, type HourDoc, type MarketConfig, type NewsSize, type OpenQuote, type Side, type TickDoc,
} from "@fortuna/core";
import { FortunaError, writeEntry, type PlayerSession, type Session } from "./ledger-write.ts";
import { readEconomy, readWallet } from "./player-ops.ts";
import { refs, type PositionDoc } from "./refs.ts";

/** docs/SPEC-COIN-MARKET.md. Every coin movement is a ledger entry that firestore.rules recomputes. */

export async function readMarket(tx: Transaction, db: Firestore): Promise<MarketConfig> {
  const snapshot = await tx.get(refs.marketConfig(db));
  if (!snapshot.exists()) throw new FortunaError("no-market", "거래소가 아직 준비되지 않았습니다. 딜러에게 문의하세요.");
  return normalizeMarket(snapshot.data());
}

export interface LatestTick { hour: number; tick: TickDoc<Timestamp>; }

/** The newest price: the last tick of the newest hour document around now. */
export async function readLatestTick(tx: Transaction, db: Firestore, nowMs: number): Promise<LatestTick> {
  const hour = hourIndexAt(nowMs);
  const docs = await Promise.all([hour + 1, hour, hour - 1].map(async (index) => ({ hour: index, doc: (await tx.get(refs.marketHour(db, index))).data() })));
  const found = docs.find((entry) => entry.doc);
  if (!found?.doc) throw new FortunaError("no-price", "아직 시세가 없습니다. 시세 기록원이 첫 시세를 찍을 때까지 기다려 주세요.");
  return { hour: found.hour, tick: found.doc.last };
}

function requireFresh(tick: TickDoc<Timestamp>, config: MarketConfig, nowMs: number) {
  if (nowMs - tick.at.toMillis() > (config.staleSeconds - 5) * 1000) throw new FortunaError("stale-price", "시세가 멈춰 있습니다. 잠시 후 다시 시도해 주세요.");
}

const counters = (wallet: { market?: { period: number; used: number; open: number } }) => wallet.market ?? { period: -1, used: 0, open: 0 };

export interface OpenRequest { coin: CoinId; side: Side; leverage: number; margin: number; }

export async function openPosition(session: PlayerSession, request: OpenRequest): Promise<{ positionId: string; quote: OpenQuote }> {
  const { db } = session;
  return runTransaction(db, async (tx) => {
    const wallet = await readWallet(tx, session), economy = await readEconomy(tx, db), market = await readMarket(tx, db);
    const { hour, tick } = await readLatestTick(tx, db, session.clock.now());
    if (!wallet.arrived) throw new FortunaError("not-arrived", "먼저 도착 절차를 마쳐야 합니다.");
    if (!market.enabled) throw new FortunaError("market-closed", "거래소가 닫혀 있습니다.");
    if (!market.coins[request.coin].enabled) throw new FortunaError("coin-halted", "이 종목은 거래가 잠시 멈췄습니다.");
    if (!leverageChoices(market, request.coin, economy.gambling.houseOpen).includes(request.leverage)) throw new FortunaError("leverage", "지금 쓸 수 없는 배율입니다.");
    if (!Number.isInteger(request.margin) || request.margin < market.minMargin || request.margin > market.maxMargin) {
      throw new FortunaError("margin", `증거금은 ${market.minMargin}~${market.maxMargin.toLocaleString("ko-KR")}코인 사이여야 합니다.`);
    }
    requireFresh(tick, market, session.clock.now());
    const before = counters(wallet), period = session.clock.period(economy.limitPeriod);
    const used = (before.period === period ? before.used : 0) + 1;
    if (used > market.dailyLimit) throw new FortunaError("trade-limit", `${periodWords(economy.limitPeriod).now} 새 거래를 모두 열었습니다.`);
    if (before.open + 1 > market.maxOpen) throw new FortunaError("open-limit", `포지션은 동시에 ${market.maxOpen}개까지 열 수 있습니다.`);
    const quote = quoteOpen(market, request.coin, request.side, request.leverage, request.margin, tick.p[request.coin]);
    const positionId = writeEntry(tx, session, session.pid, wallet, {
      type: "marketOpen", actor: "player", delta: -quote.cost, vaultDelta: quote.cost,
      detail: { coin: quote.coin, side: quote.side, leverage: quote.leverage, margin: quote.margin, fee: quote.fee, entry: quote.entry, hour, seq: tick.seq },
      wallet: { market: { period, used, open: before.open + 1 } },
    });
    tx.set(refs.position(db, positionId), {
      playerId: session.pid, coin: quote.coin, side: quote.side, leverage: quote.leverage, margin: quote.margin, fee: quote.fee,
      entry: quote.entry, entrySeq: tick.seq, openedAt: serverTimestamp() as unknown as Timestamp, liq: quote.liq, cap: quote.cap,
      status: "open", exit: null, exitSeq: null, exitAt: null, outcome: null, payout: null, lastLedger: positionId,
    });
    return { positionId, quote };
  });
}

const KIND_BY_STATUS: Partial<Record<PositionDoc["status"], CloseKind>> = { open: "close", capped: "cap", liquidated: "liquidated", void: "refund" };

export interface CloseResult { ledgerId: string; positionId: string; quote: CloseQuote; margin: number; eventId: string | null; }

/**
 * Settle a position: close an open one at the newest price, or book what the price recorder
 * (cap, liquidation) or the dealer (void) already decided.
 */
export async function closePosition(session: PlayerSession, positionId: string, bigGamble = Number.POSITIVE_INFINITY): Promise<CloseResult> {
  const { db } = session;
  // The rules count started hours (and 무월리의 밤) from the server's time; step off a boundary first.
  const peek = (await getDoc(refs.position(db, positionId))).data();
  if (peek?.status === "open") await awayFromBoundary(peek, session.clock.now.bind(session.clock));
  return runTransaction(db, async (tx) => {
    const wallet = await readWallet(tx, session), market = await readMarket(tx, db);
    const position = (await tx.get(refs.position(db, positionId))).data();
    if (!position || position.playerId !== session.pid) throw new FortunaError("no-position", "포지션을 찾을 수 없습니다.");
    const kind = KIND_BY_STATUS[position.status];
    if (!kind) throw new FortunaError("settled", "이미 정산된 포지션입니다.");
    const terms = { coin: position.coin, side: position.side, leverage: position.leverage, margin: position.margin, fee: position.fee, entry: position.entry, openedAtMs: position.openedAt.toMillis() };
    let hour: number | null = null, seq: number | null = null, exit = position.exit ?? position.entry, closedAtMs = position.exitAt?.toMillis() ?? session.clock.now();
    if (kind === "close") {
      const latest = await readLatestTick(tx, db, session.clock.now());
      requireFresh(latest.tick, market, session.clock.now());
      hour = latest.hour; seq = latest.tick.seq; exit = latest.tick.p[position.coin]; closedAtMs = session.clock.now();
    }
    const quote = quoteClose(market, terms, kind, exit, closedAtMs);
    const before = counters(wallet), net = quote.payout - position.margin;
    const notify = kind === "cap" || Math.abs(net) >= bigGamble || (kind === "liquidated" && position.margin * 2 >= bigGamble);
    const ledgerId = writeEntry(tx, session, session.pid, wallet, {
      type: "marketClose", actor: "player", delta: quote.payout, vaultDelta: -quote.payout,
      detail: {
        positionId, coin: position.coin, side: position.side, leverage: position.leverage, margin: position.margin, kind,
        exit: quote.exit, hour, seq, hours: quote.hours, pnl: quote.pnl, interest: quote.interest, fee: quote.fee, payout: quote.payout,
      },
      wallet: { market: { ...before, open: before.open - 1 } },
      ...(notify ? { event: { kind: net > 0 ? ("marketWin" as const) : ("marketLoss" as const) } } : {}),
    });
    tx.update(refs.position(db, positionId), {
      status: "closed", outcome: kind, payout: quote.payout, lastLedger: ledgerId,
      ...(kind === "close" ? { exit, exitSeq: seq, exitAt: serverTimestamp() } : {}),
    });
    return { ledgerId, positionId, quote, margin: position.margin, eventId: notify ? ledgerId : null };
  });
}

/** Wait out the few seconds around an hour boundary of the position, or 0/5 o'clock KST for MWL. */
async function awayFromBoundary(position: PositionDoc, now: () => number): Promise<void> {
  const margin = 3_000, opened = position.openedAt.toMillis();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const at = now() + 500, sinceOpen = (at - opened) % HOUR_MS, kstDay = (at + KST_OFFSET_MS) % 86_400_000;
    const nearHour = sinceOpen < margin || HOUR_MS - sinceOpen < margin;
    const nearNight = position.coin === "MWL" && [0, 5 * HOUR_MS].some((edge) => Math.abs(kstDay - edge) < margin || Math.abs(kstDay - 86_400_000 - edge) < margin);
    if (!nearHour && !nearNight) return;
    await new Promise((resolve) => setTimeout(resolve, margin * 2));
  }
}

/** Book every position the recorder or the dealer already ended. */
export async function settleEndedPositions(session: PlayerSession, bigGamble = Number.POSITIVE_INFINITY): Promise<CloseResult[]> {
  const ended = await getDocs(query(refs.positions(session.db), where("playerId", "==", session.pid), where("status", "in", ["capped", "liquidated", "void"])));
  const results: CloseResult[] = [];
  for (const row of ended.docs) results.push(await closePosition(session, row.id, bigGamble));
  return results;
}

// ── 딜러 ──

async function adminLog(session: Session, kind: string, target: string, amount: number, memo: string) {
  await addDoc(refs.adminLog(session.db), { kind, target, amount, memo, actorUid: session.uid, at: serverTimestamp() as unknown as Timestamp });
}

export async function saveMarket(session: Session, config: MarketConfig): Promise<void> {
  await setDoc(refs.marketConfig(session.db), normalizeMarket(config));
}

/** config/market is created with defaults the first time; returns true when it did so. */
export async function ensureMarket(session: Session): Promise<boolean> {
  if ((await getDoc(refs.marketConfig(session.db))).exists()) return false;
  await setDoc(refs.marketConfig(session.db), DEFAULT_MARKET);
  return true;
}

/** Return the margin of an open position (the player's app books it as a refund). */
export async function voidPosition(session: Session, positionId: string, memo: string): Promise<void> {
  if (!memo.trim()) throw new FortunaError("memo", "사유 메모를 꼭 적어 주십시오.");
  const position = (await getDoc(refs.position(session.db, positionId))).data();
  if (!position || position.status !== "open") throw new FortunaError("not-open", "열려 있는 포지션만 무효로 할 수 있습니다.");
  await updateDoc(refs.position(session.db, positionId), { status: "void" });
  await adminLog(session, "voidPosition", positionId, position.margin, memo.trim());
}

export interface NewsInput {
  coin: CoinId;
  dir: 1 | -1 | 0;
  size: NewsSize;
  minutes: number;
  headline: string;
  /** Optional rumour posted `whisperMinutes` before the news. */
  whisper: string;
  whisperMinutes: number;
  /** Minutes from now until the news lands. */
  delayMinutes: number;
}

export async function scheduleNews(session: Session, input: NewsInput): Promise<string> {
  const headline = input.headline.trim(), whisper = input.whisper.trim();
  if (!headline) throw new FortunaError("headline", "소식 문구를 입력해 주십시오.");
  if (!Number.isFinite(input.delayMinutes) || input.delayMinutes < 0 || input.delayMinutes > 7 * 24 * 60) throw new FortunaError("delay", "발표 시각을 확인해 주십시오.");
  const publishMs = session.clock.now() + Math.round(input.delayMinutes * 60_000);
  const whisperMs = whisper ? publishMs - Math.max(1, Math.round(input.whisperMinutes)) * 60_000 : null;
  const ref = await addDoc(refs.newsList(session.db), {
    coin: input.coin, dir: input.dir, size: input.size, minutes: Math.max(1, Math.min(1_440, Math.round(input.minutes))),
    headline: headline.slice(0, 200), whisper: whisper.slice(0, 200), whisperAt: whisperMs === null ? null : Timestamp.fromMillis(whisperMs),
    publishAt: Timestamp.fromMillis(publishMs), status: "pending", whispered: false, publishedSeq: null, createdAt: serverTimestamp() as unknown as Timestamp,
  });
  await adminLog(session, "news", input.coin, input.dir, headline.slice(0, 200));
  return ref.id;
}

export async function cancelNews(session: Session, newsId: string): Promise<void> {
  await updateDoc(refs.news(session.db, newsId), { status: "cancelled" });
}

/** Allow the price recorder's account (its uid is printed by scripts/create-oracle.mjs). */
export async function registerOracle(session: Session, uid: string): Promise<void> {
  const id = uid.trim();
  if (!/^[A-Za-z0-9]{10,128}$/.test(id)) throw new FortunaError("uid", "기록원 UID를 확인해 주십시오.");
  await setDoc(refs.oracle(session.db, id), { addedAt: serverTimestamp() });
  await adminLog(session, "oracle", id, 0, "시세 기록원 등록");
}

export type { HourDoc };
