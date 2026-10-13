import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getAuth } from "firebase/auth";
import { deleteField, doc, getDoc, runTransaction, serverTimestamp, setDoc, updateDoc, type Timestamp } from "firebase/firestore";
import { DEFAULT_MARKET, normalizeEconomy, quoteBuy, quoteClose, quoteOpen, quoteSell, type CoinId } from "@fortuna/core";
import {
  announceBossFight, arrive, buySpot, closePosition, openPosition, sellSpot, setCoinPaused, setDistrict, readLatestTick, readWallet, refs, registerOracle, saveEconomy, saveMarket, scheduleNews, settleEndedPositions, voidPosition, writeEntry,
  type PlayerSession, type Session,
} from "@fortuna/data";
import { FirestoreRest } from "../../../apps/notifier/src/firestore-rest.ts";
import { TickRunner, loadRecorder, nextTickAt, recordTick, type Recorder } from "../../../apps/notifier/src/oracle.ts";
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
    await saveMarket(admin, { ...DEFAULT_MARKET, coins: { ...DEFAULT_MARKET.coins, ORB: { enabled: false, volMult: 1, paused: false } } });
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
