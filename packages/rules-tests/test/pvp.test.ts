import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { normalizeEconomy, PVP_JOKER } from "@fortuna/core";
import {
  arrive, autoPick, autoResolvePick, claimPvp, closePvpRoom, createPvpRoom, dealPvpRoom, ensurePvpDeals, joinPvpRoom, leavePvpRoom, offerReady,
  pickCard, pvpRefs, raiseCard, reconcileOrder, refs, resolvePick, saveEconomy, startPvpRoom, writeHand, type PlayerSession, type PvpRoomDoc, type Session,
} from "@fortuna/data";
import { addPlayer, adminSession, asRoot, closeAll, resetData, rootData } from "./harness.ts";
import { bootstrapCity } from "@fortuna/data";

const denied = async (promise: Promise<unknown>) => { await expect(promise).rejects.toMatchObject({ code: "permission-denied" }); };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let admin: Session;
let players: PlayerSession[];

/** Deal tables are expensive to write, so they survive between tests; everything else is reset. */
beforeAll(async () => {
  await resetData();
  admin = await adminSession();
  await bootstrapCity(admin);
});

beforeEach(async () => {
  await asRoot(async (root) => {
    for (const name of ["pvpRooms", "wallets", "players", "ledger", "bindings", "accessCodes", "playerSecrets", "events"]) {
      const docs = await root.collection(name).get();
      await Promise.all(docs.docs.map((entry) => entry.ref.delete()));
    }
    await root.doc("vault/main").set({ amount: 1_000_000, lastLedger: "" });
  });
  const config = normalizeEconomy((await getDoc(refs.config(admin.db))).data());
  await saveEconomy(admin, { ...config, gambling: { ...config.gambling, houseOpen: true }, pvp: { ...config.pvp, offerSeconds: 1, pickSeconds: 1, resolveSeconds: 1 } }, config);
  players = [];
  for (const name of ["에이든", "벨라", "카이", "도윤"]) {
    const player = await addPlayer(admin, name);
    await arrive(player);
    players.push(player);
  }
});
afterAll(closeAll);

const room = async (id: string) => (await rootData(`pvpRooms/${id}`)) as PvpRoomDoc;

async function seatAll(id: string, seated: PlayerSession[]) {
  for (const player of seated) {
    const set = (await room(id)).sets?.[player.pid] ?? [];
    await writeHand(player, id, reconcileOrder(undefined, set));
  }
}

/** Open a 3-seat alley room, fill it, start and deal. */
async function playingRoom(venue: "alley" | "house" = "alley", stake = 100): Promise<string> {
  const [a, b, c] = players as [PlayerSession, PlayerSession, PlayerSession];
  const id = (await createPvpRoom(a, { venue, stake, maxSeats: 3 })).roomId;
  await joinPvpRoom(b, id);
  await joinPvpRoom(c, id);
  await startPvpRoom(a, id);
  await dealPvpRoom(b, id);
  await seatAll(id, [a, b, c]);
  return id;
}

function sessionOf(pid: string): PlayerSession { return players.find((player) => player.pid === pid) as PlayerSession; }

describe("pvp rooms", () => {
  it("stakes on create and join, refunds on leave, caps the seats", async () => {
    const [a, b, c, d] = players as [PlayerSession, PlayerSession, PlayerSession, PlayerSession];
    const id = (await createPvpRoom(a, { venue: "alley", stake: 100, maxSeats: 3 })).roomId;
    expect(await rootData(`wallets/${a.pid}`)).toMatchObject({ balance: 800, room: id });
    await joinPvpRoom(b, id);
    await joinPvpRoom(c, id);
    await expect(joinPvpRoom(d, id)).rejects.toMatchObject({ code: "room-full" });
    expect(await room(id)).toMatchObject({ seatCount: 3, pot: 300 });
    await leavePvpRoom(c, id);
    expect(await rootData(`wallets/${c.pid}`)).toMatchObject({ balance: 900, room: null });
    expect(await room(id)).toMatchObject({ seatCount: 2, pot: 200 });
    await expect(createPvpRoom(a, { venue: "alley", stake: 100, maxSeats: 2 })).rejects.toMatchObject({ code: "in-room" });
    await expect(createPvpRoom(d, { venue: "alley", stake: 5_000, maxSeats: 2 })).rejects.toMatchObject({ code: "stake" });
  });

  it("only the host starts; the deal must be the table entry for the sealed time", async () => {
    const [a, b] = players as [PlayerSession, PlayerSession];
    const id = (await createPvpRoom(a, { venue: "alley", stake: 50, maxSeats: 2 })).roomId;
    await joinPvpRoom(b, id);
    // A guest forging the start write is refused by the rules (the client refuses earlier).
    await denied(updateDoc(pvpRefs.room(b.db, id), { status: "dealing", op: "start", order: [b.pid, a.pid], pos: { [b.pid]: 0, [a.pid]: 1 }, startedAt: serverTimestamp() }));
    await startPvpRoom(a, id);
    // A forged deal (everyone gets a single card) is refused.
    await denied(updateDoc(pvpRefs.room(b.db, id), {
      status: "playing", op: "deal", dealIndex: 0, sets: { [a.pid]: ["hearts-a"], [b.pid]: ["joker"] }, discards: [], moves: 0, lastMove: null,
      turn: { actor: a.pid, target: b.pid, since: serverTimestamp(), offerReady: false, raised: null, reorders: 0, pick: null },
    }));
    await dealPvpRoom(b, id);
    const dealt = await room(id);
    expect(dealt.status).toBe("playing");
    const table = await rootData(`pvpDeals/2_${dealt.dealIndex}`);
    expect(dealt.sets?.[a.pid]).toEqual(table?.seats["0"]);
  });

  it("keeps each player's card order private", async () => {
    const id = await playingRoom();
    const [a, b] = players as [PlayerSession, PlayerSession];
    expect((await getDoc(pvpRefs.hand(a.db, id, a.pid))).exists()).toBe(true);
    await denied(getDoc(pvpRefs.hand(b.db, id, a.pid)));
    // A hand order must be a permutation of the public set.
    await denied(writeHand(a, id, ["joker", "hearts-a", "spades-a"]));
  });

  it("enforces whose move it is and hands over exactly the picked card", async () => {
    const id = await playingRoom();
    let current = await room(id);
    const actor = sessionOf(current.turn!.actor), target = sessionOf(current.turn!.target);
    const bystander = players.find((player) => player.pid !== actor.pid && player.pid !== target.pid && current.seats[player.pid]) as PlayerSession;
    await denied(pickCard(bystander, id, 0));
    await denied(raiseCard(actor, id, 0));
    await raiseCard(target, id, 1);
    await offerReady(target, id);
    await pickCard(actor, id, 1);
    // The target cannot swap in a different card than the one at that position.
    const hand = (await getDoc(pvpRefs.hand(target.db, id, target.pid))).data()!.order;
    const wrong = hand[0] === hand[1] ? hand[2] : hand[0];
    current = await room(id);
    await denied(updateDoc(pvpRefs.room(target.db, id), {
      [`sets.${target.pid}`]: current.sets![target.pid]!.filter((card) => card !== wrong), [`sets.${actor.pid}`]: [...current.sets![actor.pid]!, wrong!],
      moves: 1, op: "resolve", lastMove: { actor: actor.pid, target: target.pid, card: wrong, thrown: [], auto: false, at: serverTimestamp() },
      turn: { actor: target.pid, target: actor.pid, since: serverTimestamp(), offerReady: false, raised: null, reorders: 0, pick: null },
    }));
    await resolvePick(target, id);
    current = await room(id);
    expect(current.lastMove?.card).toBe(hand[1]);
    expect(current.moves).toBe(1);
    expect(current.turn?.actor).toBe(target.pid);
  });

  it("lets anyone seated take over a stalled turn after the time limits", async () => {
    const id = await playingRoom();
    const current = await room(id);
    const bystander = players.find((player) => player.pid !== current.turn!.actor && player.pid !== current.turn!.target && current.seats[player.pid]) as PlayerSession;
    await denied(autoPick(bystander, id)); // too early
    await sleep(2_300);
    await autoPick(bystander, id);
    await denied(autoResolvePick(bystander, id).then(async () => { if ((await room(id)).moves !== 0) throw new Error("resolved too early"); throw { code: "permission-denied" }; }));
    await sleep(1_300);
    await autoResolvePick(bystander, id);
    expect((await room(id)).lastMove?.auto).toBe(true);
  });

  it("plays to the end: winner takes the pot, others get nothing, nobody claims twice", async () => {
    const id = await playingRoom("house", 100);
    for (let guard = 0; guard < 120; guard += 1) {
      const current = await room(id);
      if (current.status !== "playing") break;
      const turn = current.turn!;
      const actor = sessionOf(turn.actor), target = sessionOf(turn.target);
      // Hands drift as cards arrive; each player keeps theirs in step with the public set.
      for (const pid of Object.keys(current.sets!)) {
        const owner = sessionOf(pid), hand = (await getDoc(pvpRefs.hand(owner.db, id, pid))).data()?.order;
        await writeHand(owner, id, reconcileOrder(hand, current.sets![pid]!));
      }
      await offerReady(target, id);
      await pickCard(actor, id, 0);
      await resolvePick(target, id);
    }
    const done = await room(id);
    expect(done.status).toBe("finished");
    expect(done.winners!.length).toBeGreaterThan(0);
    expect(done.sets![done.jokerHolder!]).toContain(PVP_JOKER);
    expect(done.rake).toBe(15); // 5% of 300 at the house
    const vaultBefore = (await rootData("vault/main"))!.amount as number;
    for (const pid of Object.keys(done.seats)) {
      const result = await claimPvp(sessionOf(pid), id);
      expect(result.kind).toBe(done.winners!.includes(pid) ? "win" : "lose");
      expect(await rootData(`wallets/${pid}`)).toMatchObject({ room: null, balance: 800 + result.amount });
    }
    expect((await rootData("vault/main"))!.amount).toBe(vaultBefore + done.rake! + done.remainder!);
    await expect(claimPvp(sessionOf(done.winners![0]!), id)).rejects.toMatchObject({ code: "claimed" });
  });

  it("refunds everyone when the host cancels or the dealer voids", async () => {
    const [a, b] = players as [PlayerSession, PlayerSession];
    const waiting = (await createPvpRoom(a, { venue: "alley", stake: 70, maxSeats: 2 })).roomId;
    await joinPvpRoom(b, waiting);
    await denied(closePvpRoom(b, waiting, "cancel"));
    await closePvpRoom(a, waiting, "cancel");
    expect((await claimPvp(a, waiting)).kind).toBe("refund");
    expect((await claimPvp(b, waiting)).amount).toBe(70);
    expect(await rootData(`wallets/${b.pid}`)).toMatchObject({ balance: 900, room: null });

    const live = await playingRoom();
    await denied(closePvpRoom(sessionOf((await room(live)).turn!.actor), live, "void"));
    await closePvpRoom(admin, live, "void");
    for (const pid of Object.keys((await room(live)).seats)) expect((await claimPvp(sessionOf(pid), live)).amount).toBe(100);
  });

  it("deal tables are generated once", async () => {
    expect(await ensurePvpDeals(admin)).toBe(false);
    expect(await rootData("pvpDeals/4_255")).toBeTruthy();
  });
});
