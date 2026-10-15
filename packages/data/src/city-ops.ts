import { addDoc, collection, doc, serverTimestamp, setDoc, updateDoc, type CollectionReference, type DocumentReference, type Firestore, type Timestamp } from "firebase/firestore";
import { ARRIVAL_PLACE, diceText, spawnNear, normalizeSprite, parseDice, type Cell, type PlaceId, type SpriteChoice } from "@fortuna/core";
import { FortunaError, type PlayerSession } from "./ledger-write.ts";

/** docs/SPEC-CITY-MAP.md. Movement and chat are cosmetic: no coins move here. */

/** actors/{pid}: a player's character on the city map. */
export interface ActorDoc {
  kind: "pc";
  name: string;
  sprite: SpriteChoice;
  place: PlaceId;
  /** Walk from (fx, fy) to (tx, ty), leaving at `at` (server time). */
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  at: Timestamp;
  /** Last heartbeat; older than a few minutes = away. */
  seenAt: Timestamp;
}

export type ChatKind = "say" | "act" | "roll";
export const GLOBAL_CHANNEL = "global";
export function placeChannel(place: PlaceId): string { return `place:${place}`; }

/** messages/{id} */
export interface MessageDoc {
  channel: string;
  kind: ChatKind;
  authorId: string;
  authorName: string;
  text: string;
  at: Timestamp;
  editedAt: Timestamp | null;
  deleted: boolean;
}

export const MESSAGE_MAX = 2_000;

export const cityRefs = {
  actor: (db: Firestore, pid: string) => doc(db, "actors", pid) as DocumentReference<ActorDoc>,
  actors: (db: Firestore) => collection(db, "actors") as CollectionReference<ActorDoc>,
  message: (db: Firestore, id: string) => doc(db, "messages", id) as DocumentReference<MessageDoc>,
  messages: (db: Firestore) => collection(db, "messages") as CollectionReference<MessageDoc>,
};

const now = () => serverTimestamp() as unknown as Timestamp;

/** Create or restyle the character. A new one appears at the station plaza. */
export async function saveCharacter(session: PlayerSession, name: string, sprite: SpriteChoice, existing: ActorDoc | null): Promise<void> {
  const ref = cityRefs.actor(session.db, session.pid), choice = normalizeSprite(sprite);
  if (existing) { await updateDoc(ref, { sprite: choice, name, seenAt: now() }); return; }
  const [x, y] = spawnNear(ARRIVAL_PLACE, session.pid);
  await setDoc(ref, { kind: "pc", name, sprite: choice, place: ARRIVAL_PLACE, fx: x, fy: y, tx: x, ty: y, at: now(), seenAt: now() });
}

/** Start walking from where the character is now to `to` (already resolved to a reachable cell). */
export async function walkTo(session: PlayerSession, from: Cell, to: Cell): Promise<void> {
  await updateDoc(cityRefs.actor(session.db, session.pid), { fx: from[0], fy: from[1], tx: to[0], ty: to[1], at: now(), seenAt: now() });
}

/** Step through a door: appear standing at `at` in `place`. */
export async function enterPlace(session: PlayerSession, place: PlaceId, at: Cell): Promise<void> {
  await updateDoc(cityRefs.actor(session.db, session.pid), { place, fx: at[0], fy: at[1], tx: at[0], ty: at[1], at: now(), seenAt: now() });
}

export async function cityHeartbeat(session: PlayerSession): Promise<void> {
  await updateDoc(cityRefs.actor(session.db, session.pid), { seenAt: now() });
}

/** Turn what was typed into a message: `/주사위 2d6`, `/행동 …` or `*…*`, otherwise speech. */
export function parseChatInput(input: string): { kind: ChatKind; text: string } | { error: string } {
  const text = input.trim();
  if (!text) return { error: "내용을 입력해 주세요." };
  const dice = /^\/(?:주사위|굴림|r|roll)\s+(.+)$/i.exec(text);
  if (dice) {
    const expr = parseDice(dice[1]!.replace(/\s+/g, ""));
    return expr ? { kind: "roll", text: diceText(expr) } : { error: "주사위는 2d6, 1d20+3 처럼 적어 주세요 (최대 20개, 100면)." };
  }
  const act = /^\/(?:행동|me)\s+([\s\S]+)$/i.exec(text);
  if (act) return { kind: "act", text: act[1]!.trim() };
  if (/^\*[^*][\s\S]*\*$/.test(text) && !text.startsWith("**")) return { kind: "act", text: text.slice(1, -1).trim() };
  if (text.length > MESSAGE_MAX) return { error: `한 번에 ${MESSAGE_MAX.toLocaleString("ko-KR")}자까지 쓸 수 있습니다.` };
  return { kind: "say", text };
}

export async function sendMessage(session: PlayerSession, authorName: string, channel: string, kind: ChatKind, text: string): Promise<string> {
  if (!text || text.length > MESSAGE_MAX) throw new FortunaError("message", "메시지 길이를 확인해 주세요.");
  const ref = await addDoc(cityRefs.messages(session.db), {
    channel, kind, authorId: session.pid, authorName, text, at: now(), editedAt: null, deleted: false,
  });
  return ref.id;
}

export async function editMessage(session: PlayerSession, id: string, text: string): Promise<void> {
  const body = text.trim();
  if (!body || body.length > MESSAGE_MAX) throw new FortunaError("message", "메시지 길이를 확인해 주세요.");
  await updateDoc(cityRefs.message(session.db, id), { text: body, editedAt: now() });
}

export async function deleteMessage(session: PlayerSession, id: string): Promise<void> {
  await updateDoc(cityRefs.message(session.db, id), { text: "", deleted: true, editedAt: now() });
}
