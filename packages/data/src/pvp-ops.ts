import {
  collection, deleteField, doc, getDoc, runTransaction, serverTimestamp, setDoc, updateDoc, writeBatch,
  type CollectionReference, type DocumentReference, type Firestore, type Timestamp,
} from "firebase/firestore";
import {
  PVP_DEAL_TABLE_SIZE, PVP_JOKER, XorShift32, applyPvpDraw, dealIndexFor, makePvpDeal, normalizeEconomy, nextPvpTurn, pvpSettlement, randomSeed, shuffle,
  type Venue,
} from "@fortuna/core";
import { FortunaError, writeEntry, type PlayerSession, type Session } from "./ledger-write.ts";
import { readWallet } from "./player-ops.ts";
import { refs } from "./refs.ts";

export type PvpStatus = "waiting" | "dealing" | "playing" | "finished" | "void" | "closed";

export interface PvpTurn {
  actor: string;
  target: string;
  since: Timestamp;
  offerReady: boolean;
  /** Card the target holds up (public bluff), by position. */
  raised: number | null;
  reorders: number;
  pick: { index: number | null; at: Timestamp; auto: boolean } | null;
}

export interface PvpMove { actor: string; target: string; card: string; thrown: string[]; auto: boolean; at: Timestamp; }

export interface PvpRoomDoc {
  game: "old-maid";
  venue: Venue;
  stake: number;
  maxSeats: number;
  rakeBps: number;
  status: PvpStatus;
  hostPid: string;
  createdAt: Timestamp;
  seats: Record<string, { name: string; joinedAt: Timestamp }>;
  seatCount: number;
  pot: number;
  op: string;
  lastLedger: string;
  order?: string[];
  pos?: Record<string, number>;
  startedAt?: Timestamp;
  dealIndex?: number;
  sets?: Record<string, string[]>;
  discards?: string[];
  turn?: PvpTurn | null;
  moves?: number;
  lastMove?: PvpMove | null;
  winners?: string[];
  jokerHolder?: string;
  rake?: number;
  share?: number;
  remainder?: number;
  claimed?: Record<string, boolean>;
}

export interface PvpHandDoc { order: string[]; }
export interface PvpPresenceDoc { lastSeen: Timestamp; emote: string | null; emoteAt: Timestamp | null; hover: number | null; }
export interface PvpDealDoc { seats: Record<string, string[]>; discards: string[]; }

export const pvpRefs = {
  room: (db: Firestore, id: string) => doc(db, "pvpRooms", id) as DocumentReference<PvpRoomDoc>,
  rooms: (db: Firestore) => collection(db, "pvpRooms") as CollectionReference<PvpRoomDoc>,
  hand: (db: Firestore, roomId: string, pid: string) => doc(db, "pvpRooms", roomId, "hands", pid) as DocumentReference<PvpHandDoc>,
  presence: (db: Firestore, roomId: string, pid: string) => doc(db, "pvpRooms", roomId, "presence", pid) as DocumentReference<PvpPresenceDoc>,
  presences: (db: Firestore, roomId: string) => collection(db, "pvpRooms", roomId, "presence") as CollectionReference<PvpPresenceDoc>,
  deal: (db: Firestore, seats: number, index: number) => doc(db, "pvpDeals", `${seats}_${index}`) as DocumentReference<PvpDealDoc>,
};

const ts = () => serverTimestamp() as unknown as Timestamp;

async function readRoom(tx: Parameters<Parameters<typeof runTransaction>[1]>[0], db: Firestore, roomId: string): Promise<PvpRoomDoc> {
  const room = (await tx.get(pvpRefs.room(db, roomId))).data();
  if (!room) throw new FortunaError("no-room", "방을 찾을 수 없습니다.");
  return room;
}

// ── 대기실 ──

export interface NewRoom { venue: Venue; stake: number; maxSeats: number; }

export async function createPvpRoom(session: PlayerSession, input: NewRoom): Promise<string> {
  const roomRef = doc(pvpRefs.rooms(session.db));
  await runTransaction(session.db, async (tx) => {
    const wallet = await readWallet(tx, session);
    const config = normalizeEconomy((await tx.get(refs.config(session.db))).data());
    const player = (await tx.get(refs.player(session.db, session.pid))).data();
    if (!player) throw new FortunaError("no-player", "등록되지 않은 승객입니다.");
    if (!wallet.arrived) throw new FortunaError("not-arrived", "먼저 도착 절차를 마쳐야 합니다.");
    if (wallet.room) throw new FortunaError("in-room", "이미 다른 방에 앉아 있습니다.");
    if (!config.pvp.enabled) throw new FortunaError("pvp-off", "지금은 대결 테이블이 닫혀 있습니다.");
    if (input.venue === "house" && !config.gambling.houseOpen) throw new FortunaError("house-closed", "하우스가 아직 열리지 않았습니다.");
    const max = input.venue === "house" ? config.pvp.houseMaxStake : config.pvp.alleyMaxStake;
    if (!Number.isInteger(input.stake) || input.stake < config.pvp.minStake || input.stake > max) throw new FortunaError("stake", `판돈은 ${config.pvp.minStake}~${max}코인 사이여야 합니다.`);
    if (![2, 3, 4].includes(input.maxSeats)) throw new FortunaError("seats", "인원은 2~4명입니다.");
    const ledgerId = writeEntry(tx, session, session.pid, wallet, {
      type: "pvpStake", actor: "player", delta: -input.stake, detail: { roomId: roomRef.id, stake: input.stake, venue: input.venue }, wallet: { room: roomRef.id },
    });
    tx.set(roomRef, {
      game: "old-maid", venue: input.venue, stake: input.stake, maxSeats: input.maxSeats,
      rakeBps: input.venue === "house" ? config.pvp.houseRakeBps : config.pvp.alleyRakeBps,
      status: "waiting", hostPid: session.pid, createdAt: ts(),
      seats: { [session.pid]: { name: player.name, joinedAt: ts() } }, seatCount: 1, pot: input.stake, op: "create", lastLedger: ledgerId,
    });
  });
  return roomRef.id;
}

export async function joinPvpRoom(session: PlayerSession, roomId: string): Promise<void> {
  await runTransaction(session.db, async (tx) => {
    const wallet = await readWallet(tx, session), room = await readRoom(tx, session.db, roomId);
    const player = (await tx.get(refs.player(session.db, session.pid))).data();
    if (!player) throw new FortunaError("no-player", "등록되지 않은 승객입니다.");
    if (wallet.room) throw new FortunaError("in-room", "이미 다른 방에 앉아 있습니다.");
    if (room.status !== "waiting") throw new FortunaError("room-started", "이미 시작된 판입니다.");
    if (room.seatCount >= room.maxSeats) throw new FortunaError("room-full", "자리가 다 찼습니다.");
    const ledgerId = writeEntry(tx, session, session.pid, wallet, {
      type: "pvpStake", actor: "player", delta: -room.stake, detail: { roomId, stake: room.stake, venue: room.venue }, wallet: { room: roomId },
    });
    tx.update(pvpRefs.room(session.db, roomId), {
      [`seats.${session.pid}`]: { name: player.name, joinedAt: ts() }, seatCount: room.seatCount + 1, pot: room.pot + room.stake, op: "join", lastLedger: ledgerId,
    });
  });
}

export async function leavePvpRoom(session: PlayerSession, roomId: string): Promise<void> {
  await runTransaction(session.db, async (tx) => {
    const wallet = await readWallet(tx, session), room = await readRoom(tx, session.db, roomId);
    if (room.status !== "waiting") throw new FortunaError("room-started", "시작된 판에서는 나갈 수 없습니다.");
    if (!room.seats[session.pid]) throw new FortunaError("not-seated", "이 방에 앉아 있지 않습니다.");
    const rest = Object.entries(room.seats).filter(([pid]) => pid !== session.pid).sort((a, b) => a[1].joinedAt.toMillis() - b[1].joinedAt.toMillis());
    const ledgerId = writeEntry(tx, session, session.pid, wallet, { type: "pvpPayout", actor: "player", delta: room.stake, detail: { roomId, kind: "leave" }, wallet: { room: null } });
    tx.update(pvpRefs.room(session.db, roomId), {
      [`seats.${session.pid}`]: deleteField(), seatCount: room.seatCount - 1, pot: room.pot - room.stake, op: "leave", lastLedger: ledgerId,
      hostPid: room.hostPid === session.pid ? rest[0]?.[0] ?? room.hostPid : room.hostPid,
      status: rest.length === 0 ? "closed" : "waiting",
    });
  });
}

/** Host: seal the start time and the seat order (join order). */
export async function startPvpRoom(session: PlayerSession, roomId: string): Promise<void> {
  const room = (await getDoc(pvpRefs.room(session.db, roomId))).data();
  if (!room) throw new FortunaError("no-room", "방을 찾을 수 없습니다.");
  if (room.hostPid !== session.pid) throw new FortunaError("not-host", "방장만 시작할 수 있습니다.");
  if (room.seatCount < 2) throw new FortunaError("too-few", "두 명 이상이 앉아야 시작할 수 있습니다.");
  const order = Object.entries(room.seats).sort((a, b) => a[1].joinedAt.toMillis() - b[1].joinedAt.toMillis()).map(([pid]) => pid);
  await updateDoc(pvpRefs.room(session.db, roomId), { status: "dealing", op: "start", order, pos: Object.fromEntries(order.map((pid, index) => [pid, index])), startedAt: ts() });
}

/** Anyone seated: copy the deal-table entry chosen by the sealed start time. */
export async function dealPvpRoom(session: Session, roomId: string): Promise<void> {
  await runTransaction(session.db, async (tx) => {
    const room = await readRoom(tx, session.db, roomId);
    if (room.status !== "dealing" || !room.startedAt || !room.order) return;
    const index = dealIndexFor(room.startedAt.toMillis());
    const deal = (await tx.get(pvpRefs.deal(session.db, room.order.length, index))).data();
    if (!deal) throw new FortunaError("no-deal", "배분표가 없습니다. 딜러에게 도시 초기화를 요청하세요.");
    const sets = Object.fromEntries(room.order.map((pid, seat) => [pid, deal.seats[String(seat)] ?? []]));
    tx.update(pvpRefs.room(session.db, roomId), {
      status: "playing", op: "deal", dealIndex: index, sets, discards: deal.discards, moves: 0, lastMove: null,
      turn: { actor: room.order[0], target: room.order[1], since: ts(), offerReady: false, raised: null, reorders: 0, pick: null },
    });
  });
}

// ── 판 진행 ──

/** Keep the private order in step with the public set: drop what left, add what arrived at a random spot. */
export function reconcileOrder(previous: readonly string[] | undefined, set: readonly string[]): string[] {
  const kept = (previous ?? []).filter((card) => set.includes(card));
  const arrived = set.filter((card) => !kept.includes(card));
  const order = [...kept];
  const rng = new XorShift32(randomSeed());
  for (const card of arrived) order.splice(rng.int(order.length + 1), 0, card);
  return previous ? order : shuffle(order, rng);
}

export async function writeHand(session: PlayerSession, roomId: string, order: string[]): Promise<void> {
  await setDoc(pvpRefs.hand(session.db, roomId, session.pid), { order });
}

/** Target: rearrange privately; the public count of rearrangements goes up by one. */
export async function reorderHand(session: PlayerSession, roomId: string, order: string[], reorders: number): Promise<void> {
  const batch = writeBatch(session.db);
  batch.set(pvpRefs.hand(session.db, roomId, session.pid), { order });
  batch.update(pvpRefs.room(session.db, roomId), { "turn.reorders": reorders + 1, op: "reorder" });
  await batch.commit();
}

export async function raiseCard(session: PlayerSession, roomId: string, index: number | null): Promise<void> {
  await updateDoc(pvpRefs.room(session.db, roomId), { "turn.raised": index, op: "raise" });
}

export async function offerReady(session: PlayerSession, roomId: string): Promise<void> {
  await updateDoc(pvpRefs.room(session.db, roomId), { "turn.offerReady": true, op: "ready" });
}

export async function pickCard(session: PlayerSession, roomId: string, index: number): Promise<void> {
  await updateDoc(pvpRefs.room(session.db, roomId), { "turn.pick": { index, at: ts(), auto: false }, op: "pick" });
}

/** Anyone seated, after the drawer's time ran out: position chosen by the sealed write time. */
export async function autoPick(session: Session, roomId: string): Promise<void> {
  await updateDoc(pvpRefs.room(session.db, roomId), { "turn.pick": { index: null, at: ts(), auto: true }, op: "autoPick" });
}

function finishFields(room: PvpRoomDoc, sets: Record<string, string[]>, emptied: string[]) {
  const settlement = pvpSettlement(room.pot, room.rakeBps, emptied.length);
  const jokerHolder = Object.entries(sets).find(([, hand]) => hand.includes(PVP_JOKER))?.[0] ?? "";
  return { status: "finished", turn: null, winners: emptied, jokerHolder, rake: settlement.rake, share: settlement.share, remainder: settlement.remainder, claimed: {} };
}

function drawFields(room: PvpRoomDoc, card: string, auto: boolean) {
  const turn = room.turn as PvpTurn, order = room.order as string[];
  const outcome = applyPvpDraw(room.sets ?? {}, turn.actor, turn.target, card);
  const base = {
    [`sets.${turn.actor}`]: outcome.sets[turn.actor], [`sets.${turn.target}`]: outcome.sets[turn.target],
    discards: [...(room.discards ?? []), ...outcome.thrown], moves: (room.moves ?? 0) + 1,
    lastMove: { actor: turn.actor, target: turn.target, card, thrown: outcome.thrown, auto, at: ts() },
    op: auto ? "autoResolve" : "resolve",
  };
  if (outcome.emptied.length) return { fields: { ...base, ...finishFields(room, outcome.sets, outcome.emptied) }, outcome };
  const next = nextPvpTurn(order, turn.target);
  return { fields: { ...base, turn: { ...next, since: ts(), offerReady: false, raised: null, reorders: 0, pick: null } }, outcome };
}

/** Target: hand over the card at the picked position of the private order. */
export async function resolvePick(session: PlayerSession, roomId: string): Promise<void> {
  await runTransaction(session.db, async (tx) => {
    const room = await readRoom(tx, session.db, roomId);
    const turn = room.turn, pick = turn?.pick;
    if (room.status !== "playing" || !turn || !pick || turn.target !== session.pid) return;
    const hand = (await tx.get(pvpRefs.hand(session.db, roomId, session.pid))).data();
    const set = room.sets?.[session.pid] ?? [];
    if (!hand || hand.order.length !== set.length || hand.order.some((card) => !set.includes(card))) throw new FortunaError("hand-stale", "패 순서를 맞추는 중입니다.");
    const index = pick.index ?? pick.at.toMillis() % set.length;
    const card = hand.order[index] as string;
    const { fields } = drawFields(room, card, false);
    tx.update(pvpRefs.room(session.db, roomId), fields);
    tx.set(pvpRefs.hand(session.db, roomId, session.pid), { order: hand.order.filter((entry) => entry !== card) });
  });
}

/** Anyone seated, when the target did not answer in time: public set at the sealed pick time. */
export async function autoResolvePick(session: Session, roomId: string): Promise<void> {
  await runTransaction(session.db, async (tx) => {
    const room = await readRoom(tx, session.db, roomId);
    const pick = room.turn?.pick, set = room.sets?.[room.turn?.target ?? ""] ?? [];
    if (room.status !== "playing" || !pick || !set.length) return;
    const card = set[pick.at.toMillis() % set.length] as string;
    tx.update(pvpRefs.room(session.db, roomId), drawFields(room, card, true).fields);
  });
}

// ── 정산과 정리 ──

export async function claimPvp(session: PlayerSession, roomId: string): Promise<{ amount: number; kind: string }> {
  return runTransaction(session.db, async (tx) => {
    const wallet = await readWallet(tx, session), room = await readRoom(tx, session.db, roomId);
    if (room.status !== "finished" && room.status !== "void") throw new FortunaError("not-over", "아직 끝나지 않은 판입니다.");
    if (room.claimed?.[session.pid]) throw new FortunaError("claimed", "이미 정산했습니다.");
    const won = room.status === "finished" && (room.winners ?? []).includes(session.pid);
    const kind = room.status === "void" ? "refund" : won ? "win" : "lose";
    const amount = kind === "refund" ? room.stake : won ? room.share ?? 0 : 0;
    const houseCut = room.status === "finished" && room.winners?.[0] === session.pid ? (room.rake ?? 0) + (room.remainder ?? 0) : 0;
    const ledgerId = writeEntry(tx, session, session.pid, wallet, {
      type: "pvpPayout", actor: "player", delta: amount, vaultDelta: houseCut, detail: { roomId, kind }, wallet: { room: null },
    });
    tx.update(pvpRefs.room(session.db, roomId), { [`claimed.${session.pid}`]: true, op: "claim", lastLedger: ledgerId });
    return { amount, kind };
  });
}

export async function closePvpRoom(session: Session, roomId: string, op: "cancel" | "abandon" | "void"): Promise<void> {
  await updateDoc(pvpRefs.room(session.db, roomId), { status: "void", op, claimed: {} });
}

export async function heartbeat(session: PlayerSession, roomId: string, patch: Partial<Pick<PvpPresenceDoc, "emote" | "hover">> = {}): Promise<void> {
  const ref = pvpRefs.presence(session.db, roomId, session.pid);
  const current = (await getDoc(ref).catch(() => null))?.data();
  await setDoc(ref, {
    lastSeen: ts(), emote: patch.emote !== undefined ? patch.emote : current?.emote ?? null,
    emoteAt: patch.emote !== undefined ? ts() : current?.emoteAt ?? null, hover: patch.hover !== undefined ? patch.hover : current?.hover ?? null,
  });
}

// ── 배분표 (딜러) ──

/** Generate the 3 × 256 deal tables once; idempotent. */
export async function ensurePvpDeals(session: Session): Promise<boolean> {
  if ((await getDoc(pvpRefs.deal(session.db, 4, PVP_DEAL_TABLE_SIZE - 1))).exists()) return false;
  for (const seats of [2, 3, 4]) {
    for (let start = 0; start < PVP_DEAL_TABLE_SIZE; start += 200) {
      const batch = writeBatch(session.db);
      for (let index = start; index < Math.min(PVP_DEAL_TABLE_SIZE, start + 200); index += 1) {
        const deal = makePvpDeal(seats, new XorShift32(randomSeed()));
        batch.set(pvpRefs.deal(session.db, seats, index), { seats: Object.fromEntries(deal.seats.map((hand, seat) => [String(seat), hand])), discards: deal.discards });
      }
      await batch.commit();
    }
  }
  return true;
}
