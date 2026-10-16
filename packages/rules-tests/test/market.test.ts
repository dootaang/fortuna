import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getAuth } from "firebase/auth";
import { deleteField, doc, getDoc, runTransaction, serverTimestamp, setDoc, updateDoc, type Timestamp } from "firebase/firestore";
import { DEFAULT_MARKET, normalizeEconomy, quoteBuy, quoteClose, quoteOpen, quoteSell, reportAt, weekIndexAt, type CoinId } from "@fortuna/core";
import {
  announceBossFight, arrive, buySpot, scheduleRate, cancelRate, scheduleRegime, cancelRegime, closePosition, openPosition, sellSpot, setCoinPaused, setDistrict, readLatestTick, readWallet, refs, registerOracle, saveEconomy, saveMarket, scheduleNews, settleEndedPositions, voidPosition, writeEntry,
  type PlayerSession, type Session,
} from "@fortuna/data";
import { FirestoreRest } from "../../../apps/notifier/src/firestore-rest.ts";
import { TickRunner, loadRecorder, nextTickAt, observeWorld, recordTick, type Recorder } from "../../../apps/notifier/src/oracle.ts";
import { anonymousSession, asRoot, cityWithPlayer, closeAll, resetData, rootData } from "./harness.ts";

const denied = async (promise: Promise<unknown>) => { await expect(promise).rejects.toMatchObject({ code: "permission-denied" }); };
const host = `http://${process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080"}`;

let admin: Session, player: PlayerSession, oracle: Session, recorder: Recorder, clockMs: number;

async function oracleRest(session: Session) { return new FirestoreRest("demo-fortuna", await getAuth(session.db.app).currentUser!.getIdToken(), host); }

/** Record the next tick (15 s later than the previous one). */
async function tick(options: Parameters<typeof recordTick>[2] = {}) {
  clockMs += 15_000;
  return recordTick(recorder, clockMs, options);
}

beforeEach(async () => {
  await resetData();
  ({ admin, player } = await cityWithPlayer());
  await arrive(player);
  oracle = await anonymousSession();
  await registerOracle(admin, oracle.uid);
  clockMs = Math.floor(Date.now() / 15_000) * 15_000 - 15_000;
  recorder = await loadRecorder(await oracleRest(oracle), "secret", clockMs);
  await tick();
});
afterAll(closeAll);

/** Open a position the way openPosition does, with fields overridden to probe the rules. */
async function rawOpen(session: PlayerSession, coin: CoinId, leverage: number, margin: number, patch: { detail?: Record<string, unknown>; position?: Record<string, unknown> } = {}) {
  await runTransaction(session.db, async (tx) => {
    const wallet = await readWallet(tx, session), { hour, tick: last } = await readLatestTick(tx, session.db, Date.now());
    const quote = quoteOpen(DEFAULT_MARKET, coin, "long", leverage, margin, last.p[coin]);
    const before = wallet.market ?? { period: -1, used: 0, open: 0 }, period = session.clock.period("day");
    const id = writeEntry(tx, session, session.pid, wallet, {
      type: "marketOpen", actor: "player", delta: -quote.cost, vaultDelta: quote.cost,
      detail: { coin, side: "long", leverage, margin, fee: quote.fee, entry: quote.entry, hour, seq: last.seq, ...patch.detail },
      wallet: { market: { period, used: (before.period === period ? before.used : 0) + 1, open: before.open + 1 } },
    });
    tx.set(refs.position(session.db, id), {
      playerId: session.pid, coin, side: "long", leverage, margin, fee: quote.fee, entry: quote.entry, entrySeq: last.seq, openedAt: serverTimestamp() as unknown as Timestamp,
      liq: quote.liq, cap: quote.cap, status: "open", exit: null, exitSeq: null, exitAt: null, outcome: null, payout: null, lastLedger: id, ...patch.position,
    });
  });
}

describe("price recorder", () => {
  it("writes ticks and candles; nobody else can", async () => {
    const hour = Math.floor(clockMs / 3_600_000);
    const doc1 = await rootData(`market/h${hour}`);
    expect(doc1?.last.seq).toBe(Math.floor(clockMs / 15_000));
    expect(Object.keys(doc1?.c ?? {})).toHaveLength(1);
    expect((await tick()).status).toBe("written");
    await denied(setDoc(doc(player.db, "market", `h${hour + 5}`), { last: { seq: 1 } }));
    const stranger = await anonymousSession();
    await denied(setDoc(doc(stranger.db, "market", `h${hour + 5}`), { last: { seq: 1 } }));
    await denied(updateDoc(refs.wallet(oracle.db, player.pid), { balance: 1_000_000 }));
  });

  it("publishes the crowd, long/short, the liquidation map, fear & greed and volume (거래소 2부)", async () => {
    const { quote } = await openPosition(player, { coin: "LNH", side: "short", leverage: 3, margin: 300 });
    await tick();
    const hourDoc = (await rootData(`market/h${Math.floor(clockMs / 3_600_000)}`))!;
    const fx = hourDoc.last.fx;
    expect(fx.fg).toBeGreaterThanOrEqual(0);
    expect(fx.fg).toBeLessThanOrEqual(100);
    expect(fx.ls.LNH[1]).toBeGreaterThanOrEqual(Math.floor(quote.notional / 100) * 100);
    expect(fx.lm.LNH).toHaveLength(10);
    expect(hourDoc.last.st.coins.LNH.npc.oi).toBeGreaterThan(0);
    const candles = Object.values(hourDoc.c as Record<string, Record<string, number[]>>);
    expect(candles.some((candle) => (candle.LNH![4] ?? 0) >= quote.notional)).toBe(true);
  });

  it("publishes dealer news and its whisper, which players cannot read early", async () => {
    const id = await scheduleNews(admin, { coin: "LNH", dir: 1, size: "m", minutes: 30, headline: "마왕성 창문의 불이 꺼졌다.", whisper: "성문 광장 줄이 짧아졌다는 말이 돈다.", whisperMinutes: 1, delayMinutes: 0.5 });
    await denied(getDoc(refs.news(player.db, id)));
    const rest = await oracleRest(oracle);
    const pending = await rest.query("marketNews", { status: "pending" });
    const first = await tick({ news: pending });
    expect(first.feed.map((item) => item.kind)).toContain("whisper");
    clockMs += 30_000;
    const second = await tick({ news: pending });
    expect(second.feed.find((item) => item.kind === "news")?.text).toBe("마왕성 창문의 불이 꺼졌다.");
    expect((await rootData(`marketNews/${id}`))?.status).toBe("published");
    expect((await getDoc(doc(player.db, "marketFeed", `${second.seq}_0`))).exists()).toBe(true);
  });
});

describe("market clock", () => {
  it("writes one tick per wake-up with a refreshed oracle token", async () => {
    const authHost = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099"}`;
    const runner = new TickRunner({
      FIREBASE_PROJECT_ID: "demo-fortuna", FIREBASE_API_KEY: "demo-key", ORACLE_REFRESH_TOKEN: getAuth(oracle.db.app).currentUser!.refreshToken,
      MARKET_SECRET: "secret", DISCORD_WEBHOOK_URL: "", FIRESTORE_HOST: host, AUTH_HOST: authHost,
    });
    const first = await runner.run(clockMs + 15_000 + 2_000);
    const second = await runner.run(clockMs + 30_000 + 400);
    const again = await runner.run(clockMs + 30_000 + 9_000);
    // An evicted Durable Object comes back from its snapshot and carries on.
    const revived = new TickRunner({
      FIREBASE_PROJECT_ID: "demo-fortuna", FIREBASE_API_KEY: "demo-key", ORACLE_REFRESH_TOKEN: "unused-after-restore",
      MARKET_SECRET: "secret", DISCORD_WEBHOOK_URL: "", FIRESTORE_HOST: host, AUTH_HOST: authHost,
    });
    revived.restore(JSON.parse(JSON.stringify(runner.snapshot())), clockMs + 45_000);
    const third = await revived.run(clockMs + 45_000 + 300);
    expect(third?.status).toBe("written");
    expect(third!.seq).toBe(second!.seq + 1);
    expect(first?.status).toBe("written");
    expect(second?.status).toBe("written");
    expect(second!.seq).toBe(first!.seq + 1);
    expect(again?.status).toBe("skipped");
    expect(nextTickAt(clockMs + 30_400, 15_000)).toBe(clockMs + 45_300);
  });
});

describe("tick interval", () => {
  it("keeps ticking when the dealer changes the interval down and back up", async () => {
    const start = clockMs, seq0 = (await rootData(`market/h${Math.floor(start / 3_600_000)}`))!.last.seq;
    recorder.config = { ...recorder.config, tickSeconds: 10 };
    const fast = [await recordTick(recorder, start + 10_000), await recordTick(recorder, start + 20_000)];
    recorder.config = { ...recorder.config, tickSeconds: 15 };
    const slow = await recordTick(recorder, start + 30_000);
    expect([...fast, slow].map((result) => result.status)).toEqual(["written", "written", "written"]);
    expect([...fast, slow].map((result) => result.seq)).toEqual([seq0 + 1, seq0 + 2, seq0 + 3]);
    expect((await recordTick(recorder, start + 30_000)).status).toBe("skipped");
  });
});

describe("positions", () => {
  it("opens at the newest price and settles exactly", async () => {
    const vault0 = (await rootData("vault/main"))?.amount;
    const { positionId, quote } = await openPosition(player, { coin: "FTN", side: "long", leverage: 5, margin: 200 });
    const wallet1 = (await rootData(`wallets/${player.pid}`))!;
    expect(wallet1.balance).toBe(900 - quote.cost);
    expect(wallet1.market).toMatchObject({ used: 1, open: 1 });
    expect((await rootData("vault/main"))?.amount).toBe(vault0 + quote.cost);
    await tick();
    const result = await closePosition(player, positionId);
    const price = (await rootData(`market/h${Math.floor(clockMs / 3_600_000)}`))!.last.p.FTN;
    const expected = quoteClose(DEFAULT_MARKET, { coin: "FTN", side: "long", leverage: 5, margin: 200, fee: quote.fee, entry: quote.entry, openedAtMs: Date.now() }, "close", price, Date.now());
    expect(result.quote.payout).toBe(expected.payout);
    const wallet2 = (await rootData(`wallets/${player.pid}`))!;
    expect(wallet2.balance).toBe(900 - quote.cost + expected.payout);
    expect(wallet2.market.open).toBe(0);
    expect((await rootData(`positions/${positionId}`))).toMatchObject({ status: "closed", outcome: "close", payout: expected.payout });
    await expect(closePosition(player, positionId)).rejects.toMatchObject({ code: "settled" });
  });

  it("rejects a wrong price, a stale tick, too much leverage and too many positions", async () => {
    await denied(rawOpen(player, "FTN", 5, 100, { detail: { entry: 1 }, position: { entry: 1 } }));
    await denied(rawOpen(player, "FTN", 20, 100));
    await denied(rawOpen(player, "HBT", 5, 100));
    await denied(rawOpen(player, "FTN", 5, 100, { position: { liq: 1 } }));
    await denied(rawOpen(player, "FTN", 5, 5));
    const economy = normalizeEconomy((await getDoc(refs.config(admin.db))).data());
    await saveEconomy(admin, { ...economy, gambling: { ...economy.gambling, houseOpen: true } }, economy);
    await rawOpen(player, "FTN", 20, 100);
    await saveMarket(admin, { ...DEFAULT_MARKET, maxOpen: 1 });
    await denied(rawOpen(player, "FTN", 5, 100));
    await saveMarket(admin, { ...DEFAULT_MARKET, coins: { ...DEFAULT_MARKET.coins, ORB: { ...DEFAULT_MARKET.coins.ORB, enabled: false } } });
    await denied(rawOpen(player, "ORB", 3, 100));
    const hour = Math.floor(clockMs / 3_600_000);
    await asRoot((root) => root.doc(`market/h${hour}`).update({ "last.at": new Date(Date.now() - 120_000) }));
    await denied(rawOpen(player, "WHL", 3, 100));
  });

  it("counts a wallet made before the exchange as fresh", async () => {
    await asRoot((root) => root.doc(`wallets/${player.pid}`).update({ market: deleteField() }));
    await openPosition(player, { coin: "WHL", side: "short", leverage: 3, margin: 100 });
    expect((await rootData(`wallets/${player.pid}`))?.market).toMatchObject({ used: 1, open: 1 });
  });

  it("is liquidated by the recorder and can then only be booked at zero", async () => {
    const { positionId } = await openPosition(player, { coin: "FTN", side: "long", leverage: 5, margin: 300 });
    // Pretend the price fell through the liquidation line on the next tick.
    await asRoot((root) => root.doc(`positions/${positionId}`).update({ liq: 10_000_000 }));
    const result = await tick();
    expect(result.closed).toEqual([positionId]);
    expect(await rootData(`positions/${positionId}`)).toMatchObject({ status: "liquidated", exit: 10_000_000 });
    await denied(updateDoc(refs.position(player.db, positionId), { status: "open" }));
    const [settled] = await settleEndedPositions(player);
    expect(settled?.quote).toMatchObject({ kind: "liquidated", payout: 0 });
    expect((await rootData(`wallets/${player.pid}`))?.market.open).toBe(0);
  });

  it("is capped by the recorder and pays the capped profit", async () => {
    const { positionId, quote } = await openPosition(player, { coin: "FTN", side: "long", leverage: 5, margin: 100 });
    await asRoot((root) => root.doc(`positions/${positionId}`).update({ cap: 1 }));
    await tick();
    const position = (await rootData(`positions/${positionId}`))!;
    expect(position.status).toBe("capped");
    const result = await closePosition(player, positionId);
    expect(result.quote.kind).toBe("cap");
    expect(result.quote.payout).toBe(quoteClose(DEFAULT_MARKET, { coin: "FTN", side: "long", leverage: 5, margin: 100, fee: quote.fee, entry: quote.entry, openedAtMs: 0 }, "cap", 1, 1).payout);
  });

  it("refunds the margin when the dealer voids a position", async () => {
    const { positionId } = await openPosition(player, { coin: "JWN", side: "long", leverage: 2, margin: 150 });
    await denied(updateDoc(refs.position(player.db, positionId), { status: "void" }));
    await voidPosition(admin, positionId, "기록원 정지");
    const before = (await rootData(`wallets/${player.pid}`))!.balance;
    const result = await closePosition(player, positionId);
    expect(result.quote).toMatchObject({ kind: "refund", payout: 150 });
    expect((await rootData(`wallets/${player.pid}`))!.balance).toBe(before + 150);
  });

  it("keeps other players and the oracle away from a position", async () => {
    const { positionId } = await openPosition(player, { coin: "FTN", side: "short", leverage: 2, margin: 100 });
    const stranger = await anonymousSession();
    await denied(getDoc(refs.position(stranger.db, positionId)));
    await denied(updateDoc(refs.position(oracle.db, positionId), { status: "liquidated", exit: 1, exitSeq: 1, exitAt: serverTimestamp() }));
    await denied(updateDoc(refs.position(oracle.db, positionId), { margin: 1 }));
  });
});

describe("spot", () => {
  it("buys and sells at the newest price with the holding and money in step", async () => {
    const vault0 = (await rootData("vault/main"))!.amount;
    const bought = await buySpot(player, "LNH", 300);
    const price = bought.quote.price;
    expect(bought.quote).toEqual(quoteBuy(DEFAULT_MARKET, 300, price));
    expect(await rootData(`holdings/${player.pid}_LNH`)).toMatchObject({ units: bought.quote.units, cost: 300 });
    expect((await rootData(`wallets/${player.pid}`))!.balance).toBe(900 - bought.quote.cost);
    await tick();
    const half = Math.floor(bought.quote.units / 2);
    const sold = await sellSpot(player, "LNH", half);
    const nowPrice = (await rootData(`market/h${Math.floor(clockMs / 3_600_000)}`))!.last.p.LNH;
    expect(sold.quote).toEqual(quoteSell(DEFAULT_MARKET, half, nowPrice, { units: bought.quote.units, cost: 300 }));
    expect(await rootData(`holdings/${player.pid}_LNH`)).toMatchObject({ units: bought.quote.units - half, cost: 300 - sold.quote.costOut });
    const rest = await sellSpot(player, "LNH", bought.quote.units - half);
    expect(await rootData(`holdings/${player.pid}_LNH`)).toMatchObject({ units: 0, cost: 0 });
    expect((await rootData("vault/main"))!.amount).toBe(vault0 + bought.quote.cost - sold.quote.payout - rest.quote.payout);
    expect((await rootData(`wallets/${player.pid}`))?.spot).toMatchObject({ used: 1 });
  });

  it("refuses a forged holding, a wrong price and selling what is not owned", async () => {
    await buySpot(player, "ORB", 100);
    const held = (await rootData(`holdings/${player.pid}_ORB`))! as { units: number; cost: number };
    await denied(updateDoc(refs.holding(player.db, player.pid, "ORB"), { units: held.units * 10 }));
    await expect(sellSpot(player, "ORB", held.units + 1)).rejects.toMatchObject({ code: "units" });
    await denied(runTransaction(player.db, async (tx) => {
      const wallet = await readWallet(tx, player), { hour, tick: last } = await readLatestTick(tx, player.db, Date.now());
      const quote = quoteSell(DEFAULT_MARKET, held.units, last.p.ORB * 2, held);
      const id = writeEntry(tx, player, player.pid, wallet, {
        type: "spotSell", actor: "player", delta: quote.payout, vaultDelta: -quote.payout,
        detail: { coin: "ORB", units: held.units, price: last.p.ORB * 2, gross: quote.gross, fee: quote.fee, payout: quote.payout, costOut: quote.costOut, hour, seq: last.seq },
      });
      tx.set(refs.holding(player.db, player.pid, "ORB"), { playerId: player.pid, coin: "ORB", units: 0, cost: 0, lastLedger: id });
    }));
  });

  it("pauses buys and new positions on a 간부전 coin until its liberation reaches the price", async () => {
    await buySpot(player, "JWN", 100);
    await announceBossFight(admin, "JWN");
    await expect(buySpot(player, "JWN", 100)).rejects.toMatchObject({ code: "coin-paused" });
    await denied(rawOpen(player, "JWN", 2, 100));
    const held = (await rootData(`holdings/${player.pid}_JWN`))!;
    await sellSpot(player, "JWN", held.units); // selling stays open
    await buySpot(player, "LNH", 100); // other coins unaffected
    await setDistrict(admin, "wuxia", { liberated: true, deductionBps: 0 }, "천마 격파");
    const rest = await oracleRest(oracle);
    const { observeWorld } = await import("../../../apps/notifier/src/oracle.ts");
    await tick({ world: await observeWorld(rest, clockMs + 15_000) });
    await buySpot(player, "JWN", 100);
    await announceBossFight(admin, "LNH");
    await setCoinPaused(admin, "LNH", false); // the fight was called off
    await buySpot(player, "LNH", 100);
  });
});

describe("weekly profit cap (환전가 특별 징수)", () => {
  /** Double a coin's newest price (rules off) so the next sale is a sure profit. */
  async function pump(coin: CoinId, factor = 2) {
    const path = `market/h${Math.floor(clockMs / 3_600_000)}`;
    const price = (await rootData(path))!.last.p[coin] as number;
    await asRoot((root) => root.doc(path).update({ [`last.p.${coin}`]: price * factor }));
  }

  it("keeps the week's profit above the cap, offsets nothing it should not, and starts over each week", async () => {
    await saveMarket(admin, { ...DEFAULT_MARKET, weeklyProfitCap: 50 });
    const bought = await buySpot(player, "LNH", 300);
    await pump("LNH");
    const half = Math.floor(bought.quote.units / 2);
    const vault0 = (await rootData("vault/main"))!.amount;
    const sold = await sellSpot(player, "LNH", half);
    const profit = sold.quote.payout - sold.quote.costOut;
    expect(profit).toBeGreaterThan(50);
    expect(sold.levy).toBe(profit - 50);
    const week = weekIndexAt(Date.now());
    expect((await rootData(`wallets/${player.pid}`))!.marketWeek).toEqual({ week, net: 50 });
    const entry = (await rootData(`ledger/${sold.ledgerId}`))!;
    expect(entry.delta).toBe(sold.quote.payout - sold.levy);
    expect(entry.detail.levy).toBe(sold.levy);
    expect((await rootData("vault/main"))!.amount).toBe(vault0 - entry.delta);

    // A sale that skips the levy is refused.
    await denied(runTransaction(player.db, async (tx) => {
      const wallet = await readWallet(tx, player), { hour, tick: last } = await readLatestTick(tx, player.db, Date.now());
      const held = (await tx.get(refs.holding(player.db, player.pid, "LNH"))).data()!;
      const units = Math.floor(held.units / 2), quote = quoteSell(DEFAULT_MARKET, units, last.p.LNH, held);
      const id = writeEntry(tx, player, player.pid, wallet, {
        type: "spotSell", actor: "player", delta: quote.payout, vaultDelta: -quote.payout,
        detail: { coin: "LNH", units, price: quote.price, gross: quote.gross, fee: quote.fee, payout: quote.payout, costOut: quote.costOut, levy: 0, hour, seq: last.seq },
        wallet: { marketWeek: { week, net: 50 + quote.payout - quote.costOut } },
      });
      tx.set(refs.holding(player.db, player.pid, "LNH"), { playerId: player.pid, coin: "LNH", units: held.units - units, cost: held.cost - quote.costOut, lastLedger: id });
      expect(quote.payout - quote.costOut).toBeGreaterThan(0);
    }));

    // Last week's profit does not count: a new week starts from zero.
    await asRoot((root) => root.doc(`wallets/${player.pid}`).update({ marketWeek: { week: week - 1, net: 9_999 } }));
    const rest = await sellSpot(player, "LNH", bought.quote.units - half);
    expect(rest.levy).toBe(Math.max(0, rest.quote.payout - rest.quote.costOut - 50));

    // A futures loss in the same week makes room again.
    await saveMarket(admin, { ...DEFAULT_MARKET, weeklyProfitCap: 5_000 });
    const { positionId, quote } = await openPosition(player, { coin: "FTN", side: "long", leverage: 5, margin: 100 });
    await tick();
    await updateDoc(refs.position(admin.db, positionId), { status: "void" });
    const refund = await closePosition(player, positionId);
    expect(refund.levy).toBe(0);
    expect((await rootData(`wallets/${player.pid}`))!.marketWeek).toEqual({ week, net: 50 - quote.fee });
  });

  it("is off at 0, and a wallet from before the cap counts as zero this week", async () => {
    await saveMarket(admin, { ...DEFAULT_MARKET, weeklyProfitCap: 0 });
    const bought = await buySpot(player, "ORB", 200);
    await pump("ORB", 3);
    const sold = await sellSpot(player, "ORB", bought.quote.units);
    expect(sold.levy).toBe(0);
    expect((await rootData(`wallets/${player.pid}`))!.marketWeek.net).toBe(sold.quote.payout - sold.quote.costOut);
  });
});

describe("earnings, reports and rate decisions (거래소 2부 2단계)", () => {
  it("publishes fundamentals with resident activity and applies an announced rate decision", async () => {
    const rest = await oracleRest(oracle);
    const eventId = await scheduleRate(admin, Date.now() - 1_000, 25);
    const cancelled = await scheduleRate(admin, Date.now() + 3_600_000, 40);
    await cancelRate(admin, cancelled);
    const events = await rest.query("marketEvents", { status: "pending" });
    expect(events.map((doc) => doc.id)).toEqual([eventId]);
    const world = await observeWorld(rest, clockMs + 15_000);
    expect(world.activity?.FTN.residents).toBe(1);
    const result = await tick({ world, events });
    expect(result.feed.some((item) => item.kind === "rate")).toBe(true);
    expect((await rootData("config/market"))!.interestBps).toBe(25);
    expect(await rootData(`marketEvents/${eventId}`)).toMatchObject({ status: "done" });
    const fundamentals = (await rootData("market/fundamentals"))!;
    expect(Object.keys(fundamentals.coins)).toHaveLength(9);
    expect(typeof fundamentals.coins.LNH.mood).toBe("number");
    // Nobody else changes the rate: not a player, not the recorder without an announced decision.
    await denied(updateDoc(doc(player.db, "config", "market"), { interestBps: 1 }));
    await denied(updateDoc(doc(oracle.db, "config", "market"), { interestBps: 1, lastRate: eventId }));
  });

  it("writes an analyst report the day after an announcement, once", async () => {
    const week = weekIndexAt(Date.now()) + 1, due = reportAt("LNH", week);
    clockMs = Math.max(clockMs, due - 5_000);
    await tick();
    const report = (await rootData(`marketReports/${week}_LNH`))!;
    expect(report).toMatchObject({ coin: "LNH", week, writer: "마왕성 서기관", prev: null });
    expect(report.low).toBeLessThan(report.mid);
    await tick();
    await denied(setDoc(doc(player.db, "marketReports", `${week}_S9`), { coin: "S9" }));
  });
});

describe("hidden regime (거래소 2부 4단계)", () => {
  it("keeps the regime private, survives a reload, and applies a dealer's 국면 발동", async () => {
    const rest = await oracleRest(oracle);
    const orderId = await scheduleRegime(admin, "fear", 30, 0);
    const skipped = await scheduleRegime(admin, "bull", 60, 600);
    await cancelRegime(admin, skipped);
    const regimes = await rest.query("marketRegimes", { status: "pending" });
    expect(regimes.map((row) => row.id)).toEqual([orderId]);
    const result = await tick({ regimes });
    expect(result.feed.some((item) => item.kind === "regime")).toBe(true);
    expect(await rootData(`marketRegimes/${orderId}`)).toMatchObject({ status: "done" });
    expect(await rootData("oracleState/regime")).toMatchObject({ kind: "fear" });
    // Not in the public tick, and not readable by players.
    const hour = (await rootData(`market/h${Math.floor(clockMs / 3_600_000)}`))!;
    expect(JSON.stringify(hour.last)).not.toContain("fear");
    await denied(getDoc(doc(player.db, "oracleState", "regime")));
    await denied(getDoc(doc(player.db, "marketRegimes", orderId)));
    await denied(setDoc(doc(player.db, "marketRegimes", "x"), { kind: "bull", minutes: 30, at: serverTimestamp(), status: "pending" }));
    // A reload restores it from the private document.
    const again = await loadRecorder(rest, "secret", clockMs + 15_000);
    expect(again.state?.regime).toMatchObject({ kind: "fear" });
  });
});

describe("funding (거래소 2부 5단계)", () => {
  /** Move a coin's funding index in the newest tick (rules off), as an hour of funding would. */
  async function fund(coin: CoinId, ppm: number) {
    const path = `market/h${Math.floor(clockMs / 3_600_000)}`;
    await asRoot((root) => root.doc(path).update({ [`last.st.coins.${coin}.F`]: ppm }));
  }

  it("charges longs and pays shorts as the index moves, and refuses a settlement that skips it", async () => {
    await saveMarket(admin, { ...DEFAULT_MARKET, weeklyProfitCap: 1 });
    const long = await openPosition(player, { coin: "FTN", side: "long", leverage: 5, margin: 200 });
    const short = await openPosition(player, { coin: "FTN", side: "short", leverage: 5, margin: 200 });
    expect((await rootData(`positions/${long.positionId}`))!.F0).toBe(0);
    await tick();
    await fund("FTN", 1_000); // +0.1%: longs pay, shorts receive

    // Skipping the funding is refused.
    await denied(runTransaction(player.db, async (tx) => {
      const wallet = await readWallet(tx, player), { hour, tick: last } = await readLatestTick(tx, player.db, Date.now());
      const position = (await tx.get(refs.position(player.db, long.positionId))).data()!;
      const quote = quoteClose(DEFAULT_MARKET, { coin: "FTN", side: "long", leverage: 5, margin: 200, fee: position.fee, entry: position.entry, openedAtMs: position.openedAt.toMillis(), F0: 0 }, "close", last.p.FTN, Date.now(), 0);
      const id = writeEntry(tx, player, player.pid, wallet, {
        type: "marketClose", actor: "player", delta: quote.payout, vaultDelta: -quote.payout,
        detail: { positionId: long.positionId, coin: "FTN", side: "long", leverage: 5, margin: 200, kind: "close", exit: quote.exit, hour, seq: last.seq, hours: quote.hours, pnl: quote.pnl, interest: quote.interest, fee: quote.fee, funding: 0, payout: quote.payout, levy: 0 },
        wallet: { market: { ...(wallet.market ?? { period: 0, used: 0, open: 2 }), open: (wallet.market?.open ?? 2) - 1 }, marketWeek: { week: weekIndexAt(Date.now()), net: quote.payout - 200 - position.fee } },
      });
      tx.update(refs.position(player.db, long.positionId), { status: "closed", outcome: "close", payout: quote.payout, lastLedger: id, exit: quote.exit, exitSeq: last.seq, exitAt: serverTimestamp() });
    }));

    const closedLong = await closePosition(player, long.positionId);
    const closedShort = await closePosition(player, short.positionId);
    expect(closedLong.quote.funding).toBe(1); // floor(1000 × 1000 / 1e6)
    expect(closedShort.quote.funding).toBe(-1);
    expect((await rootData(`ledger/${closedLong.ledgerId}`))!.detail.funding).toBe(1);
  });

  it("books a capped position with the index the recorder stamped when it ended it", async () => {
    const { positionId, quote } = await openPosition(player, { coin: "LNH", side: "long", leverage: 3, margin: 100 });
    await fund("LNH", 2_000);
    // The recorder caps it on the next tick and stamps exitF.
    const hour = `market/h${Math.floor((clockMs + 15_000) / 3_600_000)}`;
    void hour;
    await asRoot((root) => root.doc(`positions/${positionId}`).update({ status: "capped", exit: quote.cap, exitSeq: 1, exitAt: new Date(), exitF: 2_000 }));
    const result = await closePosition(player, positionId);
    expect(result.quote.funding).toBe(Math.floor((300 * 2_000) / 1_000_000));
  });
});

