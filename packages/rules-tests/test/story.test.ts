import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { doc, getDoc, getDocs, query, runTransaction, setDoc, updateDoc, where, writeBatch, serverTimestamp } from "firebase/firestore";
import { DEFAULT_ECONOMY, DEFAULT_SPRITE, FRONT_TEXT, ledgerId } from "@fortuna/core";
import {
  adjustWallet, arrive, cityRefs, closeRound, giveClue, importLorePack, openFight, playAssist, raiseBoss, readWallet, refreshBook, refs, repayFor,
  saveCharacter, saveClue, saveFund, setBookRevealed, setDistrict, shareClue, stepFront, storyRefs, writeEntry,
  type PlayerSession, type Session,
} from "@fortuna/data";
import { getAuth } from "firebase/auth";
import { registerOracle } from "@fortuna/data";
import { FirestoreRest } from "../../../apps/notifier/src/firestore-rest.ts";
import { writeBook } from "../../../apps/notifier/src/oracle.ts";
import { addPlayer, anonymousSession, cityWithPlayer, closeAll, resetData, rootData } from "./harness.ts";

const denied = async (promise: Promise<unknown>) => { await expect(promise).rejects.toMatchObject({ code: "permission-denied" }); };

let admin: Session, player: PlayerSession, other: PlayerSession;

beforeEach(async () => {
  await resetData();
  ({ admin, player } = await cityWithPlayer());
  other = await addPlayer(admin, "벨라");
  for (const p of [player, other]) await arrive(p);
  await saveCharacter(player, "에이든", DEFAULT_SPRITE, null);
  await saveCharacter(other, "벨라", DEFAULT_SPRITE, null);
});
afterAll(closeAll);

const PACK = JSON.stringify({
  clues: [
    { id: "collateral-medieval", district: "medieval", kind: "collateral", title: "봉인된 양피지 사본", public: "앞면의 설명.", secret: "뒷면에 적힌 비밀.", how: "" },
    { id: "rumor-1", district: null, kind: "clue", title: "쪽지", public: "앞면", secret: "뒷면", how: "" },
  ],
  assists: [{ id: "assist-medieval", district: "medieval", title: "마왕의 위압", effect: { kind: "score", amount: 2 }, line: "길 비켜라." }],
  pages: { medieval: ["원장", "장부", "셋째 쪽 제목", "차용증", "[파국] 봉쇄"], passenger: "승객 [{name}]의 차용증" },
  npcs: [{ id: "kang-mujin", name: "강무진", district: "modern", memo: "무뚝뚝하다." }],
  secretNews: [{ coin: "LNH", kind: "rumor", tone: "down", text: "비밀 소문" }],
});

describe("fronts", () => {
  it("moves a clock one step and sends that step's news; players can read it but not move it", async () => {
    expect(await stepFront(admin, "medieval", 1)).toBe(1);
    expect((await getDoc(storyRefs.front(player.db, "medieval"))).data()?.step).toBe(1);
    const news = await getDocs(query(refs.newsList(admin.db), where("coin", "==", "LNH")));
    expect(news.docs.map((row) => row.data().headline).sort()).toEqual([FRONT_TEXT.medieval[0]!.official, FRONT_TEXT.medieval[0]!.paper].sort());
    expect(news.docs.find((row) => row.data().headline === FRONT_TEXT.medieval[0]!.official)?.data().whisper).toBe(FRONT_TEXT.medieval[0]!.rumor);
    await denied(setDoc(doc(player.db, "fronts", "medieval"), { step: 4, updatedAt: serverTimestamp() }));
    await denied(setDoc(doc(admin.db, "fronts", "medieval"), { step: 5, updatedAt: serverTimestamp() }));
  });

  it("does not move a liberated district's clock up", async () => {
    await setDistrict(admin, "wuxia", { liberated: true, deductionBps: 0 }, "해방");
    await expect(stepFront(admin, "wuxia", 1)).rejects.toMatchObject({ code: "liberated" });
  });
});

describe("clues and the lore pack", () => {
  it("imports the pack into dealer-only places", async () => {
    const result = await importLorePack(admin, PACK);
    expect(result).toEqual({ clues: 2, assists: 1, npcs: 1, titles: true, secretNews: 1 });
    expect((await rootData("npcs/kang-mujin/secret/notes"))?.text).toBe("무뚝뚝하다.");
    await denied(getDoc(storyRefs.clue(player.db, "collateral-medieval")));
    await denied(getDoc(storyRefs.bookTitles(player.db)));
    await denied(getDoc(storyRefs.secretNews(player.db)));
    await denied(getDoc(storyRefs.assist(player.db, "assist-medieval")));
  });

  it("hands a clue to players, who read their own card and can show it to a friend", async () => {
    await importLorePack(admin, PACK);
    await giveClue(admin, "collateral-medieval", [player.pid], "loen-castle", ["에이든"], null);
    expect((await rootData("clues/collateral-medieval"))?.found).toBe(true);
    const mine = (await getDocs(query(storyRefs.cards(player.db), where("playerId", "==", player.pid)))).docs;
    expect(mine.map((row) => row.data().secret)).toEqual(["뒷면에 적힌 비밀."]);
    await denied(getDoc(storyRefs.card(other.db, player.pid, "collateral-medieval")));
    const chat = await getDocs(query(cityRefs.messages(player.db), where("channel", "==", "place:loen-castle")));
    expect(chat.docs[0]?.data().text).toContain("봉인된 양피지 사본");
    expect(chat.docs[0]?.data().text).not.toContain("뒷면에 적힌");

    await shareClue(player, "collateral-medieval", other.pid);
    expect((await getDoc(storyRefs.card(other.db, other.pid, "collateral-medieval"))).data()).toMatchObject({ from: player.pid, secret: "뒷면에 적힌 비밀." });
    // A forged card, or one shown without owning it, is refused.
    await denied(setDoc(storyRefs.card(player.db, other.pid, "rumor-1"), { playerId: other.pid, clueId: "rumor-1", title: "쪽지", district: null, kind: "clue", public: "앞면", secret: "뒷면", from: player.pid, givenAt: serverTimestamp() as never }));
    await denied(setDoc(storyRefs.card(other.db, player.pid, "collateral-medieval"), { playerId: player.pid, clueId: "collateral-medieval", title: "봉인된 양피지 사본", district: "medieval", kind: "collateral", public: "앞면의 설명.", secret: "가짜", from: other.pid, givenAt: serverTimestamp() as never }));
  });
});

describe("the ledger", () => {
  it("stays hidden until revealed and follows liberation, collateral, funds, clocks and debts", async () => {
    await importLorePack(admin, PACK);
    await refreshBook(admin);
    await denied(getDoc(storyRefs.book(player.db)));
    await setBookRevealed(admin, true);
    let book = (await getDoc(storyRefs.book(player.db))).data()!;
    expect(book.chapters.medieval.map((page) => page.state)).toEqual(["ink", "ink", "ink", "ink"]);
    expect(book.chapters.medieval[2]!.title).toBe("봉인된 담보");
    expect(book.passengers.map((page) => page.state)).toEqual(["ink", "ink"]);

    await setDistrict(admin, "medieval", { liberated: true, deductionBps: 0 }, "해방");
    await giveClue(admin, "collateral-medieval", [player.pid], "loen-castle", ["에이든"], null);
    await saveFund(admin, null, { title: "칼드록 대납", description: "", goal: 100, current: 100, status: "filled", visible: true, sortOrder: 0, book: "medieval" });
    for (let i = 0; i < 4; i += 1) await stepFront(admin, "horror", 1);
    await refreshBook(admin);
    book = (await getDoc(storyRefs.book(player.db))).data()!;
    expect(book.chapters.medieval.map((page) => page.state)).toEqual(["blank", "blank", "blank", "blank"]);
    expect(book.chapters.medieval[2]!.title).toBe("셋째 쪽 제목");
    expect(book.chapters.horror.at(-1)?.state).toBe("black");
    await denied(setDoc(storyRefs.book(player.db), { ...book, remaining: 0 }));
  });

  it("is recomputed by the price recorder with the same result", async () => {
    await importLorePack(admin, PACK);
    await setDistrict(admin, "medieval", { liberated: true, deductionBps: 0 }, "해방");
    await refreshBook(admin);
    const dealer = (await rootData("book/main"))!;
    const oracle = await anonymousSession();
    await registerOracle(admin, oracle.uid);
    const host = `http://${process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080"}`;
    await writeBook(new FirestoreRest("demo-fortuna", await getAuth(oracle.db.app).currentUser!.getIdToken(), host), Date.now());
    const recorded = (await rootData("book/main"))!;
    expect(recorded.chapters).toEqual(dealer.chapters);
    expect(recorded.passengers).toEqual(dealer.passengers);
    expect(recorded.remaining).toBe(dealer.remaining);
  });
});

describe("paying a friend's debt", () => {
  it("moves my coins to the vault and lowers their debt, as two entries that point at each other", async () => {
    await adjustWallet(admin, player.pid, { delta: 2_000, debtDelta: 0, memo: "테스트 자금" });
    const before = (await rootData(`wallets/${other.pid}`))!, mine0 = (await rootData(`wallets/${player.pid}`))!, vault0 = (await rootData("vault/main"))!.amount;
    await repayFor(player, other.pid, 600);
    const after = (await rootData(`wallets/${other.pid}`))!, mine1 = (await rootData(`wallets/${player.pid}`))!;
    expect(after.debt).toBe(before.debt - 600);
    expect(after.balance).toBe(before.balance);
    expect(mine1.balance).toBe(mine0.balance - 600);
    expect((await rootData("vault/main"))!.amount).toBe(vault0 + 600);
    expect((await rootData(`ledger/${ledgerId(other.pid, after.seq)}`))).toMatchObject({ type: "repaidBy", actor: "friend", detail: { from: player.pid, amount: 600 } });
    await expect(repayFor(player, other.pid, after.debt + 1)).rejects.toMatchObject({ code: "debt-negative" });
  });

  it("refuses a relief entry without a matching payment, or for more than was paid", async () => {
    await adjustWallet(admin, player.pid, { delta: 2_000, debtDelta: 0, memo: "테스트 자금" });
    // Only the friend's side: their debt goes down for free.
    await denied(runTransaction(player.db, async (tx) => {
      const theirs = (await tx.get(refs.wallet(player.db, other.pid))).data()!;
      writeEntry(tx, player, other.pid, theirs, { type: "repaidBy", actor: "friend", delta: 0, debtDelta: -500, detail: { from: player.pid, amount: 500, ledger: ledgerId(player.pid, 99) } });
    }));
    // Paying 100 but clearing 500.
    await denied(runTransaction(player.db, async (tx) => {
      const wallet = await readWallet(tx, player), theirs = (await tx.get(refs.wallet(player.db, other.pid))).data()!;
      const mine = ledgerId(player.pid, wallet.seq + 1), other2 = ledgerId(other.pid, theirs.seq + 1);
      writeEntry(tx, player, other.pid, theirs, { type: "repaidBy", actor: "friend", delta: 0, debtDelta: -500, detail: { from: player.pid, amount: 500, ledger: mine } });
      writeEntry(tx, player, player.pid, wallet, { type: "repayFor", actor: "player", delta: -100, vaultDelta: 100, detail: { to: other.pid, amount: 100, ledger: other2 } });
    }));
  });
});

describe("boss fights", () => {
  it("raises from the boss's vault, scores rounds and decides the fight", async () => {
    const id = await openFight(admin, "loen-castle", { title: "", bossName: "마왕", mode: "boss", district: "medieval", rounds: 3, bossVault: 400 });
    await updateDoc(cityRefs.contest(admin.db, id), { bossScore: 3 });
    await raiseBoss(admin, id, DEFAULT_ECONOMY.skill.costs, null);
    let fight = (await rootData(`contests/${id}`))!;
    expect(fight).toMatchObject({ bossScore: 4, bossVault: 100, bossSpent: 300 });
    await expect(raiseBoss(admin, id, DEFAULT_ECONOMY.skill.costs, null)).rejects.toMatchObject({ code: "vault" });
    expect(await closeRound(admin, id, 5, null)).toEqual({ party: 1, boss: 0, decided: null });
    expect(await closeRound(admin, id, 6, null)).toEqual({ party: 2, boss: 0, decided: "party" });
    fight = (await rootData(`contests/${id}`))!;
    expect(fight.round).toBe(3);
    expect(fight.log).toHaveLength(3);
    await denied(updateDoc(cityRefs.contest(player.db, id), { bossScore: 0 }));
  });

  it("turns the manager's ledger in the final: blank pages fizzle, and earned help cards play", async () => {
    await importLorePack(admin, PACK);
    await setDistrict(admin, "medieval", { liberated: true, deductionBps: 0 }, "해방");
    await giveClue(admin, "collateral-medieval", [player.pid], "loen-castle", ["에이든"], null);
    const id = await openFight(admin, "wheel-house", { title: "", bossName: "지배인", mode: "final", district: null, rounds: 1, bossVault: 0 });
    let fight = (await rootData(`contests/${id}`))!;
    expect(fight.pages).toHaveLength(7 * 4 + 2);
    expect(fight.pages.filter((page: { state: string }) => page.state === "blank")).toHaveLength(3);
    expect(fight.assists.map((card: { id: string }) => card.id)).toEqual(["assist-medieval"]);
    expect(fight.bossVault).toBe((await rootData("vault/main"))!.amount);

    await playAssist(admin, id, "assist-medieval", null);
    for (let i = 0; i < 5; i += 1) await raiseBoss(admin, id, DEFAULT_ECONOMY.skill.costs, null);
    fight = (await rootData(`contests/${id}`))!;
    const turned = fight.pages.slice(0, 5), inked = turned.filter((page: { state: string }) => page.state !== "blank").length;
    expect(fight.pageIndex).toBe(5);
    expect(fight.bossScore).toBe(inked);
    expect(fight.bonus).toBe(2);
    expect((await closeRound(admin, id, fight.bossScore, null)).decided).toBe("party");
    await expect(playAssist(admin, id, "assist-medieval", null)).rejects.toMatchObject({ code: "assist" });
  });
});

void writeBatch;
