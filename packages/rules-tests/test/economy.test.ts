import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDoc, getDocs, query, serverTimestamp, updateDoc, where, writeBatch, increment } from "firebase/firestore";
import { GAMES, normalizeEconomy, replayWager, wagerTrace, type GameId } from "@fortuna/core";
import {
  adminUseItem, arrive, bootstrapCity, buyItem, economyNeedsUpgrade, contributeFund, depositJoint, openBet, paySkill, refs, repayDebt, saveEconomy, saveFund, saveItem, sealStep, setDistrict,
  settleBet, submitWork, useItem, withdrawJoint, type PlayerSession,
} from "@fortuna/data";
import { cityWithPlayer, closeAll, resetData, rootData, asRoot } from "./harness.ts";

const denied = async (promise: Promise<unknown>) => { await expect(promise).rejects.toMatchObject({ code: "permission-denied" }); };

beforeEach(resetData);
afterAll(closeAll);

async function arrived() {
  const city = await cityWithPlayer();
  await arrive(city.player);
  return city;
}

/** Plays a wager to the end with a fixed policy, sealing every step. */
async function playOut(player: PlayerSession, choose: (state: any) => string): Promise<void> {
  for (let guard = 0; guard < 40; guard += 1) {
    const wager = (await getDoc(refs.wallet(player.db, player.pid))).data()?.openWager;
    if (!wager) return;
    const game = GAMES[wager.game], state = replayWager(game, wager.bet, wager.params, wagerTrace(wager));
    if (game.isDone(state)) return;
    await sealStep(player, choose(state));
  }
}

describe("work", () => {
  it("pays gross minus the dealer's cut, and the cut goes to the vault", async () => {
    const { player, pid } = await arrived();
    const result = await submitWork(player, "sort", 0.5);
    expect(result).toMatchObject({ gross: 200, deduction: 100, net: 100, deductionBps: 5_000 });
    expect(await rootData(`wallets/${pid}`)).toMatchObject({ balance: 1_000, workUsed: 1, periodIndex: player.clock.period("day") });
    expect((await rootData("vault/main"))?.amount).toBe(1_000_200);
  });

  it("a liberated district keeps the whole wage", async () => {
    const { admin, player } = await arrived();
    await setDistrict(admin, "medieval", { liberated: true, deductionBps: 5_000 }, "간부 격파");
    expect(await submitWork(player, "timing", 1)).toMatchObject({ gross: 250, deduction: 0, net: 250 });
  });

  it("stops at the daily limit", async () => {
    const { admin, player } = await arrived();
    const config = normalizeEconomy((await getDoc(refs.config(admin.db))).data());
    await saveEconomy(admin, { ...config, work: { ...config.work, limit: 2 } }, config);
    await submitWork(player, "sort", 0.5);
    await submitWork(player, "sort", 0.5);
    await expect(submitWork(player, "sort", 0.5)).rejects.toMatchObject({ code: "work-limit" });
  });

  it("rejects a forged wage or a skipped deduction", async () => {
    const { player, pid } = await arrived();
    const forge = (gross: number, deduction: number) => {
      const batch = writeBatch(player.db);
      batch.update(refs.wallet(player.db, pid), { balance: 900 + gross - deduction, seq: 2, periodIndex: player.clock.period("day"), workUsed: 1, gambleUsed: 0 });
      batch.set(refs.ledger(player.db, `${pid}_2`), {
        playerId: pid, seq: 2, type: "work", delta: gross - deduction, debtDelta: 0, vaultDelta: deduction, balanceAfter: 900 + gross - deduction, debtAfter: 1_500,
        weekIndex: player.clock.week(), actor: "player", actorUid: player.uid, memo: "",
        detail: { template: "sort", performance: 1, districtId: "medieval", gross, deductionBps: 5_000, deduction, net: gross - deduction }, at: serverTimestamp() as never,
      });
      if (deduction) batch.update(refs.vault(player.db), { amount: increment(deduction), lastLedger: `${pid}_2` });
      return batch.commit();
    };
    await denied(forge(5_000, 2_500));
    await denied(forge(200, 0));
    await forge(200, 100); // the honest version of the same write goes through
  });
});

describe("configs saved before later updates", () => {
  it("work, bets and pvp still work with a pre-update config and wallet", async () => {
    const { admin, player, pid } = await arrived();
    // Recreate what an early deployment stored: weekly-named limits, no period/pvp/shop keys, wallets without periodIndex.
    const current = normalizeEconomy((await getDoc(refs.config(admin.db))).data());
    const { limitPeriod: _period, shopEnabled: _shop, pvp: _pvp, ...legacy } = JSON.parse(JSON.stringify(current));
    legacy.work.weeklyLimit = legacy.work.limit; delete legacy.work.limit;
    legacy.gambling.weeklyLimit = legacy.gambling.limit; delete legacy.gambling.limit;
    await asRoot(async (root) => {
      await root.doc("config/economy").set(legacy);
      const { periodIndex: _index, ...wallet } = (await root.doc(`wallets/${pid}`).get()).data() as Record<string, unknown>;
      await root.doc(`wallets/${pid}`).set({ ...wallet, weekIndex: 0 });
    });
    expect(economyNeedsUpgrade((await asRoot((root) => root.doc("config/economy").get())).data())).toBe(true);
    await submitWork(player, "sort", 0.5);
    await openBet(player, "odd-even", "alley", 50);
    await sealStep(player, "odd");
    await settleBet(player, () => "");
    // The dealer's bootstrap fills the missing keys without touching what was set.
    expect(await bootstrapCity(admin, { pvpDeals: false })).toContain("경제 설정 갱신");
    expect(economyNeedsUpgrade((await getDoc(refs.config(admin.db))).data())).toBe(false);
  });
});

describe("gambling", () => {
  it("odd-even: open, seal, settle with the replayed payout", async () => {
    const { player, pid } = await arrived();
    await openBet(player, "odd-even", "alley", 100);
    expect(await rootData(`wallets/${pid}`)).toMatchObject({ balance: 800, gambleUsed: 1 });
    await sealStep(player, "odd");
    const result = await settleBet(player, () => "홀");
    expect([0, 200]).toContain(result.payout);
    expect(await rootData(`wallets/${pid}`)).toMatchObject({ balance: 800 + result.payout, openWager: null });
  });

  it("house: closed until the dealer opens it; the vault takes the net", async () => {
    const { admin, player } = await arrived();
    await expect(openBet(player, "high-low", "house", 500)).rejects.toMatchObject({ code: "house-closed" });
    const config = normalizeEconomy((await getDoc(refs.config(admin.db))).data());
    await saveEconomy(admin, { ...config, gambling: { ...config.gambling, houseOpen: true } }, config);
    const vaultBefore = (await rootData("vault/main"))?.amount as number;
    await openBet(player, "high-low", "house", 500);
    await playOut(player, (state) => (state.streak >= 1 ? "cashout" : "higher"));
    const { payout } = await settleBet(player, () => "");
    expect((await rootData("vault/main"))?.amount).toBe(vaultBefore + 500 - payout);
    const events = await asRoot(async (root) => (await root.collection("events").where("kind", "==", "houseOpen").get()).size);
    expect(events).toBe(1);
  });

  it("caps bets and enforces one open wager", async () => {
    const { player } = await arrived();
    await expect(openBet(player, "blackjack", "alley", 500)).rejects.toMatchObject({ code: "bet-range" });
    await openBet(player, "blackjack", "alley", 200);
    await expect(openBet(player, "odd-even", "alley", 10)).rejects.toMatchObject({ code: "wager-open" });
  });

  it("refuses inflated payouts and batch-sealed steps", async () => {
    const { player, pid } = await arrived();
    await openBet(player, "last-train", "alley", 100);
    // Two decisions in one write.
    await denied(updateDoc(refs.wallet(player.db, pid), { "openWager.stepCount": 2, "openWager.steps.1": { a: "roll", t: serverTimestamp() }, "openWager.steps.2": { a: "roll", t: serverTimestamp() } }));
    // A step stamped with a client-chosen time.
    await denied(updateDoc(refs.wallet(player.db, pid), { "openWager.stepCount": 1, "openWager.steps.1": { a: "roll", t: new Date(0) } }));
    const wager = (await getDoc(refs.wallet(player.db, pid))).data()!.openWager!;
    const batch = writeBatch(player.db);
    const payout = 100 * 100;
    batch.update(refs.wallet(player.db, pid), { balance: 800 + payout, seq: 3, openWager: null });
    batch.set(refs.ledger(player.db, `${pid}_3`), {
      playerId: pid, seq: 3, type: "betSettle", delta: payout, debtDelta: 0, vaultDelta: 0, balanceAfter: 800 + payout, debtAfter: 1_500,
      weekIndex: player.clock.week(), actor: "player", actorUid: player.uid, memo: "",
      detail: { wagerId: wager.wagerId, game: wager.game, venue: wager.venue, bet: wager.bet, params: wager.params, payout, openedAt: wager.openedAt, stepCount: 0, steps: {}, summary: "" },
      at: serverTimestamp() as never,
    });
    await denied(batch.commit());
  });

  it("every table can be played to the end through the rules", async () => {
    const { admin, player } = await arrived();
    await updateDoc(refs.wallet(admin.db, player.pid), {}).catch(() => undefined);
    const pick: Record<GameId, (state: any) => string> = {
      "odd-even": () => "even",
      "high-low": (state) => (state.streak ? "cashout" : "lower"),
      blackjack: () => "stand",
      "last-train": (state) => (state.stations ? "stop" : "roll"),
      roulette: () => "red",
      "dice-poker": () => "hold:11000",
      "old-maid": () => "pick:0",
      "draw-poker": () => "hold:00000",
    };
    for (const game of Object.keys(pick) as GameId[]) {
      await openBet(player, game, "alley", 10);
      await playOut(player, pick[game]);
      await settleBet(player, () => game);
    }
    expect((await rootData(`wallets/${player.pid}`))?.gambleUsed).toBe(8);
  });
});

describe("skills, debt, joint wallet, funds", () => {
  it("charges every level paid and can borrow the shortfall", async () => {
    const { player, pid } = await arrived(); // balance 900, sword 4
    await paySkill(player, { skillId: "sword", usedLevel: 4, note: "베기", borrow: false });
    expect((await rootData(`wallets/${pid}`))?.balance).toBe(600);
    await expect(paySkill(player, { skillId: "sword", usedLevel: 6, note: "", borrow: false })).rejects.toMatchObject({ code: "insufficient" });
    await paySkill(player, { skillId: "sword", usedLevel: 6, note: "필살", borrow: true }); // 4,300; borrows 3,700 → debt +5,550
    expect(await rootData(`wallets/${pid}`)).toMatchObject({ balance: 0, debt: 1_500 + 5_550 });
    expect(await rootData(`ledger/${pid}_3`)).toMatchObject({ detail: { cost: 4_300, borrowed: 3_700 } });
  });

  it("repayment lowers debt and fills the vault, never past zero", async () => {
    const { player, pid } = await arrived();
    await repayDebt(player, 400);
    expect(await rootData(`wallets/${pid}`)).toMatchObject({ balance: 500, debt: 1_100 });
    expect((await rootData("vault/main"))?.amount).toBe(1_000_500);
    await expect(repayDebt(player, 5_000)).rejects.toMatchObject({ code: "debt-negative" });
  });

  it("joint wallet: anyone deposits, only the dealer withdraws", async () => {
    const { admin, player, pid } = await arrived();
    await depositJoint(player, 300);
    expect((await rootData("treasury/joint"))?.amount).toBe(300);
    await denied(updateDoc(refs.treasury(player.db), { amount: 0, lastLedger: `${pid}_2` }));
    await withdrawJoint(admin, 100, "최종전 준비", pid);
    expect((await rootData("treasury/joint"))?.amount).toBe(200);
    expect((await rootData(`wallets/${pid}`))?.balance).toBe(700);
  });

  it("funds fill up to the goal and flag completion", async () => {
    const { admin, player } = await arrived();
    const fundId = await saveFund(admin, null, { title: "열차 수리비", description: "", goal: 500, status: "open", visible: true, sortOrder: 0 });
    await contributeFund(player, fundId, 300);
    await expect(contributeFund(player, fundId, 300)).rejects.toMatchObject({ code: "fund-overflow" });
    expect(await contributeFund(player, fundId, 200)).toMatchObject({ filled: true });
    expect(await rootData(`funds/${fundId}`)).toMatchObject({ current: 500, status: "filled" });
    await denied(updateDoc(refs.fund(player.db, fundId), { current: 0, status: "open" }));
  });
});

describe("shop", () => {
  it("sells, limits, hides secrets from non-buyers, and records use", async () => {
    const { admin, player, pid } = await arrived();
    const base = { description: "", category: "rumor" as const, perPlayerLimit: 1, visible: true, consumable: false, hasSecret: true, revealNote: "", sortOrder: 0 };
    const rumorId = await saveItem(admin, null, { ...base, name: "간부의 약점", price: 300, stock: 2 }, "왼쪽 어깨가 약하다");
    const potionId = await saveItem(admin, null, { ...base, name: "재굴림권", price: 100, stock: null, perPlayerLimit: null, category: "consumable", consumable: true, hasSecret: false }, null);
    const hiddenId = await saveItem(admin, null, { ...base, name: "숨은 품목", price: 1, stock: null, visible: false }, null);

    await denied(getDoc(refs.secret(player.db, rumorId)));
    await buyItem(player, rumorId);
    expect((await getDoc(refs.secret(player.db, rumorId))).data()?.text).toBe("왼쪽 어깨가 약하다");
    expect((await rootData(`shopItems/${rumorId}`))?.stock).toBe(1);
    await expect(buyItem(player, rumorId)).rejects.toMatchObject({ code: "limit" });
    await denied(buyItem(player, hiddenId)); // hidden items are not even readable

    await buyItem(player, potionId, 2);
    await useItem(player, potionId);
    expect(await rootData(`inventory/${pid}_${potionId}`)).toMatchObject({ purchased: 2, quantity: 1, used: 1 });
    await expect(useItem(player, rumorId)).rejects.toMatchObject({ code: "not-consumable" });
    await adminUseItem(admin, pid, rumorId, "원정에서 사용");
    expect((await rootData(`wallets/${pid}`))?.balance).toBe(900 - 300 - 200);

    const mine = await getDocs(query(refs.inventories(player.db), where("playerId", "==", pid)));
    expect(mine.size).toBe(2);
    // Stock cannot be refilled by a player.
    await denied(updateDoc(refs.item(player.db, rumorId), { stock: 99 }));
  });
});
