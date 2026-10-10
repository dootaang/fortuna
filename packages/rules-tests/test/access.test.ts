import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, orderBy, limit, serverTimestamp, writeBatch } from "firebase/firestore";
import { accessCodeHash } from "@fortuna/core";
import { adjustWallet, arrive, bindAccessCode, bootstrapCity, createPlayer, refs, reissueCode, syncClock } from "@fortuna/data";
import { adminSession, anonymousSession, cityWithPlayer, closeAll, resetData, rootData } from "./harness.ts";

const denied = async (promise: Promise<unknown>) => { await expect(promise).rejects.toMatchObject({ code: "permission-denied" }); };

beforeEach(resetData);
afterAll(closeAll);

describe("admin gate", () => {
  it("only an allow-listed account can configure the city", async () => {
    const stranger = await anonymousSession();
    await denied(setDoc(refs.config(stranger.db), { hacked: true }));
    await denied(setDoc(doc(stranger.db, "admins", stranger.uid), {}));
    const admin = await adminSession();
    expect(await bootstrapCity(admin)).toContain("경제 설정");
    expect(await bootstrapCity(admin)).toEqual([]);
    expect((await rootData("vault/main"))?.amount).toBe(1_000_000);
  });
  it("any signed-in visitor can read public settings", async () => {
    const admin = await adminSession();
    await bootstrapCity(admin);
    const visitor = await anonymousSession();
    await expect(getDoc(refs.config(visitor.db))).resolves.toBeTruthy();
  });
});

describe("access codes", () => {
  it("binds with the right code, rejects a wrong one, and survives a device change", async () => {
    const { admin, player, pid, code } = await cityWithPlayer();
    expect((await getDoc(refs.wallet(player.db, pid))).data()?.balance).toBe(0);
    const wrong = await anonymousSession();
    await expect(bindAccessCode(wrong, "FRT-0000-0000-0000")).rejects.toMatchObject({ code: "invalid-code" });
    await denied(getDoc(refs.wallet(wrong.db, pid)));
    // Forging a binding to someone else's player with a made-up hash fails.
    await denied(setDoc(refs.binding(wrong.db, wrong.uid), { playerId: pid, codeHash: accessCodeHash("FRT-0000-0000-0000"), version: 1, boundAt: serverTimestamp() as never }));
    // New phone, same code.
    const phone = await anonymousSession();
    await bindAccessCode(phone, code);
    expect((await getDoc(refs.wallet(phone.db, pid))).exists()).toBe(true);
    // Players cannot list access codes or read the stored plaintext.
    await denied(getDocs(collection(phone.db, "accessCodes")));
    await denied(getDoc(refs.playerSecret(phone.db, pid)));
    expect((await getDoc(refs.playerSecret(admin.db, pid))).data()?.code).toBe(code);
  });

  it("reissuing a code cuts off every old device", async () => {
    const { admin, player, pid, code } = await cityWithPlayer();
    const fresh = await reissueCode(admin, pid);
    expect(fresh).not.toBe(code);
    await denied(getDoc(refs.wallet(player.db, pid)));
    const again = await anonymousSession();
    await expect(bindAccessCode(again, code)).rejects.toMatchObject({ code: "invalid-code" });
    await bindAccessCode(again, fresh);
    expect((await getDoc(refs.wallet(again.db, pid))).exists()).toBe(true);
  });

  it("players cannot see each other", async () => {
    const { admin, player } = await cityWithPlayer();
    const other = await createPlayer(admin, { name: "벨라", districtId: "romance", skills: [], note: "" });
    await denied(getDoc(refs.wallet(player.db, other.pid)));
    await denied(getDoc(refs.player(player.db, other.pid)));
  });
});

describe("arrival and wallet integrity", () => {
  it("arrival pays the envelope, books the debt and the gate fee to the vault — once", async () => {
    const { player, pid } = await cityWithPlayer();
    await syncClock(player.db, player.uid, player.clock);
    await arrive(player);
    const wallet = await rootData(`wallets/${pid}`);
    expect(wallet).toMatchObject({ balance: 900, debt: 1_500, seq: 1, arrived: true });
    expect((await rootData("vault/main"))?.amount).toBe(1_000_100);
    expect((await rootData(`ledger/${pid}_1`))).toMatchObject({ type: "arrival", delta: 900, debtDelta: 1_500, vaultDelta: 100, actor: "player" });
    await expect(arrive(player)).rejects.toMatchObject({ code: "already-arrived" });
  });

  it("a wallet cannot change without a matching ledger entry", async () => {
    const { player, pid } = await cityWithPlayer();
    await arrive(player);
    await denied(updateDoc(refs.wallet(player.db, pid), { balance: 99_999 }));
    // A ledger entry whose delta disagrees with the wallet change is rejected.
    const batch = writeBatch(player.db);
    batch.update(refs.wallet(player.db, pid), { balance: 5_000, seq: 2 });
    batch.set(refs.ledger(player.db, `${pid}_2`), {
      playerId: pid, seq: 2, type: "adminAdjust", delta: 4_100, debtDelta: 0, vaultDelta: 0, balanceAfter: 5_000, debtAfter: 1_500,
      weekIndex: player.clock.week(), actor: "admin", actorUid: player.uid, memo: "self-grant", detail: { reason: "x", source: "x" }, at: serverTimestamp() as never,
    });
    await denied(batch.commit());
  });

  it("ledger entries are append-only, even for the dealer", async () => {
    const { admin, player, pid } = await cityWithPlayer();
    await arrive(player);
    await denied(updateDoc(refs.ledger(admin.db, `${pid}_1`), { delta: 0 }));
    await denied(deleteDoc(refs.ledger(admin.db, `${pid}_1`)));
    const own = await getDocs(query(refs.ledgers(player.db), where("playerId", "==", pid), orderBy("seq", "desc"), limit(10)));
    expect(own.size).toBe(1);
  });

  it("dealer adjustments need a memo and leave a trace", async () => {
    const { admin, player, pid } = await cityWithPlayer();
    await arrive(player);
    await expect(adjustWallet(admin, pid, { delta: 500, debtDelta: 0, memo: " " })).rejects.toMatchObject({ code: "memo" });
    await adjustWallet(admin, pid, { delta: 500, debtDelta: -200, memo: "원정 보상" });
    expect(await rootData(`wallets/${pid}`)).toMatchObject({ balance: 1_400, debt: 1_300, seq: 2 });
    expect(await rootData(`ledger/${pid}_2`)).toMatchObject({ type: "adminAdjust", actor: "admin", memo: "원정 보상" });
    await expect(adjustWallet(admin, pid, { delta: -99_999, debtDelta: 0, memo: "너무 많이" })).rejects.toMatchObject({ code: "insufficient" });
  });
});
