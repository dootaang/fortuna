import { Timestamp, addDoc, collection, doc, getDoc, type DocumentReference, getDocs, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, type Firestore, type Transaction } from "firebase/firestore";
import {
  COINS, DEFAULT_MARKET, HOUR_MS, KST_OFFSET_MS, entryPaused, weekIndexAt, weeklyLevy, hourIndexAt, leverageChoices, normalizeMarket, periodWords, quoteBuy, quoteClose, quoteOpen, quoteSell,
  type DividendClaim, type InfoKind, type RegimeKind, type BuyQuote, type CloseKind, type SellQuote, type CloseQuote, type CoinId, type HourDoc, type MarketConfig, type NewsSize, type OpenQuote, type Side, type TickDoc,
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

/**
 * The rules take only the newest tick (tickOk), so a tick the recorder writes between a transaction's reads and its
 * commit comes back as permission-denied instead of an SDK retry. Run the trade again while the price has moved on.
 */
async function onNewestTick<T>(session: Session, trade: (seen: (seq: number) => void) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    let used: number | null = null;
    try {
      return await trade((seq) => { used = seq; });
    } catch (error) {
      if (attempt >= 3 || used === null || (error as { code?: unknown }).code !== "permission-denied") throw error;
      if ((await readNewestSeq(session.db, session.clock.now())) === used) throw error;
    }
  }
}

async function readNewestSeq(db: Firestore, nowMs: number): Promise<number | null> {
  const hour = hourIndexAt(nowMs);
  for (const index of [hour + 1, hour, hour - 1]) {
    const data = (await getDoc(refs.marketHour(db, index))).data();
    if (data) return data.last.seq;
  }
  return null;
}

function requireFresh(tick: TickDoc<Timestamp>, config: MarketConfig, nowMs: number) {
  if (nowMs - tick.at.toMillis() > (config.staleSeconds - 5) * 1000) throw new FortunaError("stale-price", "시세가 멈춰 있습니다. 잠시 후 다시 시도해 주세요.");
}

const PAUSED_TEXT = "간부전 결과가 나올 때까지 이 종목의 새 진입과 매수가 멈췄습니다.";

const counters = (wallet: { market?: { period: number; used: number; open: number } }) => wallet.market ?? { period: -1, used: 0, open: 0 };

export interface OpenRequest { coin: CoinId; side: Side; leverage: number; margin: number; }

export async function openPosition(session: PlayerSession, request: OpenRequest): Promise<{ positionId: string; quote: OpenQuote }> {
  const { db } = session;
  return onNewestTick(session, (seen) => runTransaction(db, async (tx) => {
    const wallet = await readWallet(tx, session), economy = await readEconomy(tx, db), market = await readMarket(tx, db);
    const { hour, tick } = await readLatestTick(tx, db, session.clock.now());
    seen(tick.seq);
    if (!wallet.arrived) throw new FortunaError("not-arrived", "먼저 도착 절차를 마쳐야 합니다.");
    if (!market.enabled) throw new FortunaError("market-closed", "거래소가 닫혀 있습니다.");
    if (!market.coins[request.coin].enabled) throw new FortunaError("coin-halted", "이 종목은 거래가 잠시 멈췄습니다.");
    if (entryPaused(market, request.coin, tick.st.liberated)) throw new FortunaError("coin-paused", PAUSED_TEXT);
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
      F0: tick.st.coins[request.coin].F ?? 0,
    });
    return { positionId, quote };
  }));
}

const KIND_BY_STATUS: Partial<Record<PositionDoc["status"], CloseKind>> = { open: "close", capped: "cap", liquidated: "liquidated", void: "refund" };

export interface CloseResult { ledgerId: string; positionId: string; quote: CloseQuote; margin: number; eventId: string | null; levy: number; }

/**
 * Settle a position: close an open one at the newest price, or book what the price recorder
 * (cap, liquidation) or the dealer (void) already decided.
 */
export async function closePosition(session: PlayerSession, positionId: string, bigGamble = Number.POSITIVE_INFINITY): Promise<CloseResult> {
  const { db } = session;
  // The rules count started hours (and 무월리의 밤) from the server's time; step off a boundary first.
  const peek = (await getDoc(refs.position(db, positionId))).data();
  if (peek?.status === "open") await awayFromBoundary(peek, session.clock.now.bind(session.clock));
  return onNewestTick(session, (seen) => runTransaction(db, async (tx) => {
    const wallet = await readWallet(tx, session), market = await readMarket(tx, db);
    const position = (await tx.get(refs.position(db, positionId))).data();
    if (!position || position.playerId !== session.pid) throw new FortunaError("no-position", "포지션을 찾을 수 없습니다.");
    const kind = KIND_BY_STATUS[position.status];
    if (!kind) throw new FortunaError("settled", "이미 정산된 포지션입니다.");
    const terms = { coin: position.coin, side: position.side, leverage: position.leverage, margin: position.margin, fee: position.fee, entry: position.entry, openedAtMs: position.openedAt.toMillis(), F0: position.F0 ?? null };
    let hour: number | null = null, seq: number | null = null, exit = position.exit ?? position.entry, closedAtMs = position.exitAt?.toMillis() ?? session.clock.now();
    let fundingIndex: number | null = position.exitF ?? position.F0 ?? null;
    if (kind === "close") {
      const latest = await readLatestTick(tx, db, session.clock.now());
      seen(latest.tick.seq);
      requireFresh(latest.tick, market, session.clock.now());
      hour = latest.hour; seq = latest.tick.seq; exit = latest.tick.p[position.coin]; closedAtMs = session.clock.now();
      fundingIndex = latest.tick.st.coins[position.coin].F ?? 0;
    }
    const quote = quoteClose(market, terms, kind, exit, closedAtMs, fundingIndex);
    const week = weeklyLevy(wallet.marketWeek, weekIndexAt(session.clock.now()), quote.payout - (position.margin + position.fee), market.weeklyProfitCap);
    const paid = quote.payout - week.levy;
    const before = counters(wallet), net = paid - position.margin;
    const notify = kind === "cap" || Math.abs(net) >= bigGamble || (kind === "liquidated" && position.margin * 2 >= bigGamble);
    const ledgerId = writeEntry(tx, session, session.pid, wallet, {
      type: "marketClose", actor: "player", delta: paid, vaultDelta: -paid,
      detail: {
        positionId, coin: position.coin, side: position.side, leverage: position.leverage, margin: position.margin, kind,
        exit: quote.exit, hour, seq, hours: quote.hours, pnl: quote.pnl, interest: quote.interest, fee: quote.fee, funding: quote.funding, payout: quote.payout, levy: week.levy,
      },
      wallet: { market: { ...before, open: before.open - 1 }, marketWeek: week.after },
      ...(notify ? { event: { kind: net > 0 ? ("marketWin" as const) : ("marketLoss" as const) } } : {}),
    });
    tx.update(refs.position(db, positionId), {
      status: "closed", outcome: kind, payout: quote.payout, lastLedger: ledgerId,
      ...(kind === "close" ? { exit, exitSeq: seq, exitAt: serverTimestamp() } : {}),
    });
    return { ledgerId, positionId, quote, margin: position.margin, eventId: notify ? ledgerId : null, levy: week.levy };
  }));
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

// ── 현물 ──

export async function buySpot(session: PlayerSession, coin: CoinId, amount: number): Promise<{ ledgerId: string; quote: BuyQuote }> {
  const { db } = session;
  return onNewestTick(session, (seen) => runTransaction(db, async (tx) => {
    const wallet = await readWallet(tx, session), economy = await readEconomy(tx, db), market = await readMarket(tx, db);
    const { hour, tick } = await readLatestTick(tx, db, session.clock.now());
    seen(tick.seq);
    const holdingRef = refs.holding(db, session.pid, coin), held = (await tx.get(holdingRef)).data();
    if (!wallet.arrived) throw new FortunaError("not-arrived", "먼저 도착 절차를 마쳐야 합니다.");
    if (!market.enabled) throw new FortunaError("market-closed", "거래소가 닫혀 있습니다.");
    if (!market.coins[coin].enabled) throw new FortunaError("coin-halted", "이 종목은 거래가 잠시 멈췄습니다.");
    if (entryPaused(market, coin, tick.st.liberated)) throw new FortunaError("coin-paused", PAUSED_TEXT);
    if (!Number.isInteger(amount) || amount < market.minMargin || amount > market.spotMaxOrder) {
      throw new FortunaError("amount", `한 번에 ${market.minMargin}~${market.spotMaxOrder.toLocaleString("ko-KR")}코인어치까지 살 수 있습니다.`);
    }
    requireFresh(tick, market, session.clock.now());
    const before = wallet.spot ?? { period: -1, used: 0 }, period = session.clock.period(economy.limitPeriod);
    const used = (before.period === period ? before.used : 0) + 1;
    if (used > market.spotDailyLimit) throw new FortunaError("spot-limit", `${periodWords(economy.limitPeriod).now} 현물 매수를 모두 했습니다.`);
    const quote = quoteBuy(market, amount, tick.p[coin]);
    if (quote.units < 1) throw new FortunaError("amount", "금액이 너무 적어 살 수 있는 양이 없습니다.");
    const ledgerId = writeEntry(tx, session, session.pid, wallet, {
      type: "spotBuy", actor: "player", delta: -quote.cost, vaultDelta: quote.cost,
      detail: { coin, amount, fee: quote.fee, price: quote.price, units: quote.units, hour, seq: tick.seq },
      wallet: { spot: { period, used } },
    });
    tx.set(holdingRef, { playerId: session.pid, coin, units: (held?.units ?? 0) + quote.units, cost: (held?.cost ?? 0) + amount, lastLedger: ledgerId });
    return { ledgerId, quote };
  }));
}

/** Sell `units` (1/10,000 coin) of a holding at the newest price; selling works even while buying is paused. */
export async function sellSpot(session: PlayerSession, coin: CoinId, units: number): Promise<{ ledgerId: string; quote: SellQuote; levy: number }> {
  const { db } = session;
  return onNewestTick(session, (seen) => runTransaction(db, async (tx) => {
    const wallet = await readWallet(tx, session), market = await readMarket(tx, db);
    const { hour, tick } = await readLatestTick(tx, db, session.clock.now());
    seen(tick.seq);
    const holdingRef = refs.holding(db, session.pid, coin), held = (await tx.get(holdingRef)).data();
    if (!held || held.units < 1) throw new FortunaError("no-holding", `가진 ${COINS[coin].name}이(가) 없습니다.`);
    if (!Number.isInteger(units) || units < 1 || units > held.units) throw new FortunaError("units", "팔 수량을 확인해 주세요.");
    requireFresh(tick, market, session.clock.now());
    const quote = quoteSell(market, units, tick.p[coin], held);
    const week = weeklyLevy(wallet.marketWeek, weekIndexAt(session.clock.now()), quote.payout - quote.costOut, market.weeklyProfitCap);
    const paid = quote.payout - week.levy;
    const ledgerId = writeEntry(tx, session, session.pid, wallet, {
      type: "spotSell", actor: "player", delta: paid, vaultDelta: -paid,
      detail: { coin, units, price: quote.price, gross: quote.gross, fee: quote.fee, payout: quote.payout, costOut: quote.costOut, levy: week.levy, hour, seq: tick.seq },
      wallet: { marketWeek: week.after },
    });
    tx.set(holdingRef, { playerId: session.pid, coin, units: held.units - units, cost: held.cost - quote.costOut, lastLedger: ledgerId });
    return { ledgerId, quote, levy: week.levy };
  }));
}

// ── 딜러 ──

/** 간부전 예고: a news line that stirs the coin for six hours, and new entries/buys paused until liberation or release. */
export async function announceBossFight(session: Session, coin: CoinId): Promise<string> {
  const market = normalizeMarket((await getDoc(refs.marketConfig(session.db))).data());
  await saveMarket(session, { ...market, coins: { ...market.coins, [coin]: { ...market.coins[coin], paused: true } } });
  return scheduleNews(session, {
    coin, dir: 0, size: "z", minutes: 360, headline: `${COINS[coin].place} 간부전이 예고되었다. 거리의 말소리가 낮아진다.`,
    whisper: "", whisperMinutes: 10, delayMinutes: 0,
  });
}

export async function setCoinPaused(session: Session, coin: CoinId, paused: boolean): Promise<void> {
  const market = normalizeMarket((await getDoc(refs.marketConfig(session.db))).data());
  await saveMarket(session, { ...market, coins: { ...market.coins, [coin]: { ...market.coins[coin], paused } } });
}



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

// ── 거래소 2부: 지배인 금리 결정 ──

/** Announce a rate decision: it shows on the calendar now and moves prices when it lands. */
export async function scheduleRate(session: Session, atMs: number, bps: number): Promise<string> {
  if (!Number.isInteger(bps) || bps < 0 || bps > 1_000) throw new FortunaError("bps", "이자율은 0~1000bp 사이 정수로 적어 주십시오.");
  if (!Number.isFinite(atMs) || atMs < session.clock.now() - 60_000) throw new FortunaError("at", "발표 시각을 확인해 주십시오.");
  const ref = await addDoc(collection(session.db, "marketEvents"), { kind: "rate", bps, at: Timestamp.fromMillis(atMs), status: "pending", appliedSeq: null, createdAt: serverTimestamp() });
  await adminLog(session, "rate", "FTN", bps, `금리 결정 예고 ${new Date(atMs).toISOString()}`);
  return ref.id;
}

export async function cancelRate(session: Session, id: string): Promise<void> {
  await updateDoc(doc(session.db, "marketEvents", id), { status: "cancelled" });
}

// ── 거래소 2부 4단계: 국면 발동 ──

/** Start a regime (e.g. a panic before a 간부전) in `delayMinutes`, holding for `minutes`. Players never see its name. */
export async function scheduleRegime(session: Session, kind: RegimeKind, minutes: number, delayMinutes: number): Promise<string> {
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1_440) throw new FortunaError("minutes", "지속 시간은 5~1440분 사이로 적어 주십시오.");
  const ref = await addDoc(collection(session.db, "marketRegimes"), {
    kind, minutes, at: Timestamp.fromMillis(session.clock.now() + Math.max(0, Math.round(delayMinutes * 60_000))), status: "pending", appliedSeq: null, createdAt: serverTimestamp(),
  });
  await adminLog(session, "regime", kind, minutes, `국면 발동 예약`);
  return ref.id;
}

export async function cancelRegime(session: Session, id: string): Promise<void> {
  await updateDoc(doc(session.db, "marketRegimes", id), { status: "cancelled" });
}

// ── 거래소 2부 6단계: 배당 수령 ──

/** Collect what the recorder credited in a week's dividend claim (the vault pays it). */
export async function claimDividend(session: PlayerSession, claimId: string): Promise<{ ledgerId: string; amount: number }> {
  const { db } = session;
  return runTransaction(db, async (tx) => {
    const wallet = await readWallet(tx, session);
    const ref = doc(db, "dividendClaims", claimId) as DocumentReference<DividendClaim<Timestamp>>;
    const claim = (await tx.get(ref)).data();
    if (!claim || claim.playerId !== session.pid) throw new FortunaError("no-claim", "배당 명세를 찾을 수 없습니다.");
    const amount = claim.total - claim.claimed;
    if (amount <= 0) throw new FortunaError("claimed", "이미 받은 배당입니다.");
    const ledgerId = writeEntry(tx, session, session.pid, wallet, { type: "dividend", actor: "player", delta: amount, vaultDelta: -amount, detail: { claimId, amount } });
    tx.update(ref, { claimed: claim.total, lastLedger: ledgerId });
    return { ledgerId, amount };
  });
}

// ── 거래소 2부 7단계: 정보 구매 ──

/** Pay for a hint; the recorder answers it in about a minute (infoRequests/{ledgerId}). */
export async function buyInfo(session: PlayerSession, kind: InfoKind, coin: CoinId): Promise<string> {
  const { db } = session;
  return runTransaction(db, async (tx) => {
    const wallet = await readWallet(tx, session), economy = await readEconomy(tx, db), market = await readMarket(tx, db);
    if (!market.info.enabled) throw new FortunaError("info-closed", "지금은 정보를 팔지 않습니다.");
    const price = kind === "rumor" ? market.info.rumorPrice : market.info.peekPrice;
    if (wallet.balance < price) throw new FortunaError("balance", "잔액이 부족합니다.");
    const before = wallet.info ?? { period: -1, used: 0 }, period = session.clock.period(economy.limitPeriod);
    const used = (before.period === period ? before.used : 0) + 1;
    if (used > market.info.dailyLimit) throw new FortunaError("info-limit", `${periodWords(economy.limitPeriod).now} 정보는 다 샀습니다.`);
    const ledgerId = writeEntry(tx, session, session.pid, wallet, {
      type: "marketInfo", actor: "player", delta: -price, vaultDelta: price, detail: { kind, coin, price }, wallet: { info: { period, used } },
    });
    tx.set(doc(db, "infoRequests", ledgerId), { playerId: session.pid, kind, coin, status: "pending", answer: null, createdAt: serverTimestamp(), answeredAt: null });
    return ledgerId;
  });
}
