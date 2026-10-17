import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch,
  type CollectionReference, type DocumentReference, type Firestore,
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes, type FirebaseStorage } from "firebase/storage";
import {
  ARRIVAL_PLACE, PRESET_NPCS, diceText, normalizeSprite, parseDice,
  type ImageFilter, type LineId, type PlaceId, type SceneEffect, type SpriteChoice,
} from "@fortuna/core";
import { FortunaError, type PlayerSession, type Session } from "./ledger-write.ts";
import { paySkill, type SkillPayment } from "./player-ops.ts";
import { refs } from "./refs.ts";

/** docs/SPEC-CITY-MAP.md (2판): 노선도와 장면. 코인은 특기 결제 장부로만 움직인다. */

// ── 문서 모양 ──

/** actors/{pid}: a player's character in the city. */
export interface ActorDoc {
  kind: "pc";
  name: string;
  sprite: SpriteChoice;
  /** sceneImages id of an uploaded portrait; null = the dot portrait. */
  portrait: string | null;
  place: PlaceId;
  seenAt: Timestamp;
}

export type AuthorKind = "pc" | "npc" | "gm" | "narration";
export type ChatKind = "say" | "act" | "roll" | "skill" | "image" | "result";

/** messages/{id} */
export interface MessageDoc {
  channel: string;
  /** False only for whispers; lets session logs query public messages. */
  public: boolean;
  kind: ChatKind;
  authorKind: AuthorKind;
  /** Player id for pc, the dealer's uid otherwise. */
  authorId: string;
  authorName: string;
  npcId: string | null;
  text: string;
  at: Timestamp;
  editedAt: Timestamp | null;
  deleted: boolean;
  pinned: boolean;
  sessionId: string | null;
  /** Skill payments: the ledger entry and what it paid. */
  ledgerId: string | null;
  skill: { name: string; base: number; used: number; cost: number } | null;
  imageId: string | null;
  contestId: string | null;
}

export interface SceneDoc {
  imageId: string | null;
  /** Overrides the station's sense line; null = the image's or the station's. */
  sense: string | null;
  /** A one-shot effect and when it fired. */
  pulse: { kind: SceneEffect; at: Timestamp } | null;
  /** An effect that stays on. */
  persistent: SceneEffect | null;
  /** NPC ids standing in the scene. */
  npcs: string[];
  updatedAt: Timestamp;
}

export type ImageOwner = "place" | "npc" | "player" | "cut";
export interface SceneImageDoc {
  owner: ImageOwner;
  /** Place id, npc id, player id, or "" for cuts. */
  ref: string;
  path: string;
  url: string;
  name: string;
  filter: ImageFilter;
  focus: "top" | "center" | "bottom";
  sense: string;
  credit: string;
  createdAt: Timestamp;
  createdBy: string;
}

export interface NpcDoc { name: string; line: LineId; portraitId: string | null; createdAt: Timestamp; }
export interface SessionDoc { title: string; openedAt: Timestamp; closesAt: Timestamp; closedAt: Timestamp | null; }
export interface ContestDoc {
  place: PlaceId;
  title: string;
  bossName: string;
  bossScore: number;
  bossSpent: number;
  status: "open" | "closed";
  result: string;
  openedAt: Timestamp;
}
export interface ActivityDoc { lastAt: Timestamp; lastName: string; }
export interface CityConfig {
  closedLines: LineId[];
  /** The ledger is shown to players only after the dealer reveals it. */
  bookRevealed?: boolean;
  /** Scenes and chat in the city tab. Off (the default) while the RP runs on Discord: players see the line map, the board and their notebook. */
  scenes?: boolean;
}

export const MESSAGE_MAX = 2_000;
export const GLOBAL_CHANNEL = "global";
export function placeChannel(place: PlaceId): string { return `place:${place}`; }
/** Whisper between two parties: player ids, or "gm" for the dealer. Sorted so both sides share one channel. */
export function whisperChannel(a: string, b: string): string { return `whisper:${[a, b].sort().join("~")}`; }
export function whisperParties(channel: string): string[] { return channel.startsWith("whisper:") ? channel.slice(8).split("~") : []; }

const typed = <T>(ref: DocumentReference) => ref as DocumentReference<T>;
const typedCollection = <T>(ref: CollectionReference) => ref as CollectionReference<T>;

export const cityRefs = {
  actor: (db: Firestore, pid: string) => typed<ActorDoc>(doc(db, "actors", pid)),
  actors: (db: Firestore) => typedCollection<ActorDoc>(collection(db, "actors")),
  message: (db: Firestore, id: string) => typed<MessageDoc>(doc(db, "messages", id)),
  messages: (db: Firestore) => typedCollection<MessageDoc>(collection(db, "messages")),
  reads: (db: Firestore, pid: string) => doc(db, "reads", pid),
  activity: (db: Firestore, place: PlaceId) => typed<ActivityDoc>(doc(db, "placeActivity", place)),
  activities: (db: Firestore) => typedCollection<ActivityDoc>(collection(db, "placeActivity")),
  scene: (db: Firestore, place: PlaceId) => typed<SceneDoc>(doc(db, "scenes", place)),
  scenes: (db: Firestore) => typedCollection<SceneDoc>(collection(db, "scenes")),
  image: (db: Firestore, id: string) => typed<SceneImageDoc>(doc(db, "sceneImages", id)),
  images: (db: Firestore) => typedCollection<SceneImageDoc>(collection(db, "sceneImages")),
  npc: (db: Firestore, id: string) => typed<NpcDoc>(doc(db, "npcs", id)),
  npcs: (db: Firestore) => typedCollection<NpcDoc>(collection(db, "npcs")),
  npcNotes: (db: Firestore, id: string) => doc(db, "npcs", id, "secret", "notes"),
  session: (db: Firestore, id: string) => typed<SessionDoc>(doc(db, "sessions", id)),
  sessions: (db: Firestore) => typedCollection<SessionDoc>(collection(db, "sessions")),
  contest: (db: Firestore, id: string) => typed<ContestDoc>(doc(db, "contests", id)),
  contests: (db: Firestore) => typedCollection<ContestDoc>(collection(db, "contests")),
  config: (db: Firestore) => typed<CityConfig>(doc(db, "config", "city")),
};

const now = () => serverTimestamp() as unknown as Timestamp;

// ── 캐릭터와 이동 ──

export async function saveCharacter(session: PlayerSession, name: string, sprite: SpriteChoice, existing: ActorDoc | null): Promise<void> {
  const ref = cityRefs.actor(session.db, session.pid), choice = normalizeSprite(sprite);
  if (existing) { await updateDoc(ref, { sprite: choice, name, seenAt: now() }); return; }
  await setDoc(ref, { kind: "pc", name, sprite: choice, portrait: null, place: ARRIVAL_PLACE, seenAt: now() });
}

export async function setPortrait(session: PlayerSession, imageId: string | null): Promise<void> {
  await updateDoc(cityRefs.actor(session.db, session.pid), { portrait: imageId, seenAt: now() });
}

/** Take the line to another stop. */
export async function moveTo(session: PlayerSession, place: PlaceId): Promise<void> {
  await updateDoc(cityRefs.actor(session.db, session.pid), { place, seenAt: now() });
}

export async function cityHeartbeat(session: PlayerSession): Promise<void> {
  await updateDoc(cityRefs.actor(session.db, session.pid), { seenAt: now() });
}

/** Remember that this place has been read up to now (also marks it visited). */
export async function markRead(session: PlayerSession, place: PlaceId): Promise<void> {
  await setDoc(cityRefs.reads(session.db, session.pid), { [place]: now() }, { merge: true });
}

// ── 채팅 ──

export type ChatInput =
  | { kind: "say" | "act" | "roll"; text: string }
  | { kind: "skill"; skillId: string; usedLevel: number }
  | { kind: "whisper"; to: string; text: string }
  | { error: string };

/**
 * Typed text → message. `/주사위 2d6+1`, `/행동 …` or `*…*`, `/특기 이름 점수`, `/귓 이름 텍스트`, otherwise speech.
 * `skills` and `people` resolve names for skills and whispers.
 */
export function parseChatInput(input: string, skills: { id: string; name: string }[] = [], people: { id: string; name: string }[] = []): ChatInput {
  const text = input.trim();
  if (!text) return { error: "내용을 입력해 주세요." };
  const dice = /^\/(?:주사위|굴림|r|roll)\s+(.+)$/i.exec(text);
  if (dice) {
    const expr = parseDice(dice[1]!.replace(/\s+/g, ""));
    return expr ? { kind: "roll", text: diceText(expr) } : { error: "주사위는 2d6, 1d20+3 처럼 적어 주세요 (최대 20개, 100면)." };
  }
  const skill = /^\/(?:특기|skill)\s+(.+?)\s+(\d{1,2})$/i.exec(text);
  if (skill) {
    const name = skill[1]!.trim(), found = skills.find((entry) => entry.name === name || entry.id === name);
    return found ? { kind: "skill", skillId: found.id, usedLevel: Number(skill[2]) } : { error: `"${name}" 특기가 없습니다.` };
  }
  const whisper = /^\/(?:귓|w)\s+(\S+)\s+([\s\S]+)$/i.exec(text);
  if (whisper) {
    const target = people.find((person) => person.name === whisper[1]);
    return target ? { kind: "whisper", to: target.id, text: whisper[2]!.trim() } : { error: `"${whisper[1]}"님을 찾을 수 없습니다.` };
  }
  const act = /^\/(?:행동|me)\s+([\s\S]+)$/i.exec(text);
  if (act) return { kind: "act", text: act[1]!.trim() };
  if (/^\*[^*][\s\S]*\*$/.test(text) && !text.startsWith("**")) return { kind: "act", text: text.slice(1, -1).trim() };
  if (text.length > MESSAGE_MAX) return { error: `한 번에 ${MESSAGE_MAX.toLocaleString("ko-KR")}자까지 쓸 수 있습니다.` };
  return { kind: "say", text };
}

/** Who is speaking: a player as their character, or the dealer as GM, an NPC or plain narration. */
export type Speaker =
  | { authorKind: "pc"; name: string }
  | { authorKind: "gm" }
  | { authorKind: "narration" }
  | { authorKind: "npc"; npcId: string; name: string };

export interface SendOptions { kind?: Exclude<ChatKind, "skill">; imageId?: string | null; contestId?: string | null; sessionId?: string | null; place?: PlaceId | null; }

function speakerFields(speaker: Speaker, authorId: string): Pick<MessageDoc, "authorKind" | "authorId" | "authorName" | "npcId"> {
  switch (speaker.authorKind) {
    case "pc": return { authorKind: "pc", authorId, authorName: speaker.name, npcId: null };
    case "npc": return { authorKind: "npc", authorId, authorName: speaker.name, npcId: speaker.npcId };
    case "gm": return { authorKind: "gm", authorId, authorName: "딜러", npcId: null };
    case "narration": return { authorKind: "narration", authorId, authorName: "", npcId: null };
  }
}

const BLANK = { editedAt: null, deleted: false, pinned: false, ledgerId: null, skill: null, imageId: null, contestId: null } as const;

/** Post a message (and bump the place's activity so the line map can show a new-message dot). */
export async function sendMessage(session: Session, authorId: string, speaker: Speaker, channel: string, text: string, options: SendOptions = {}): Promise<string> {
  const kind = options.kind ?? "say";
  if ((kind !== "image" && !text) || text.length > MESSAGE_MAX) throw new FortunaError("message", "메시지 길이를 확인해 주세요.");
  const ref = doc(cityRefs.messages(session.db)), batch = writeBatch(session.db);
  batch.set(ref, {
    ...BLANK, channel, public: !channel.startsWith("whisper:"), kind, ...speakerFields(speaker, authorId), text, at: now(),
    sessionId: options.sessionId ?? null, imageId: options.imageId ?? null, contestId: options.contestId ?? null,
  });
  if (options.place && channel === placeChannel(options.place)) {
    batch.set(cityRefs.activity(session.db, options.place), { lastAt: now(), lastName: speaker.authorKind === "pc" || speaker.authorKind === "npc" ? speaker.name : "" });
  }
  await batch.commit();
  return ref.id;
}

/**
 * Pay for a skill through the ordinary skill ledger, then show it in the scene. The message id is tied
 * to the ledger entry, so one payment can be shown only once.
 */
export async function paySkillInChat(session: PlayerSession, name: string, place: PlaceId, payment: SkillPayment, options: { sessionId?: string | null; contestId?: string | null } = {}): Promise<string> {
  const ledgerId = await paySkill(session, payment);
  const entry = (await getDoc(refs.ledger(session.db, ledgerId))).data();
  const detail = entry?.detail as { skillName: string; baseLevel: number; usedLevel: number; cost: number } | undefined;
  if (!detail) throw new FortunaError("ledger", "결제 기록을 찾지 못했습니다.");
  const id = `skill_${ledgerId}`, batch = writeBatch(session.db);
  batch.set(cityRefs.message(session.db, id), {
    ...BLANK, channel: placeChannel(place), public: true, kind: "skill", authorKind: "pc", authorId: session.pid, authorName: name, npcId: null,
    text: payment.note.trim() || `${detail.skillName} ${detail.usedLevel}점`, at: now(), sessionId: options.sessionId ?? null,
    ledgerId, skill: { name: detail.skillName, base: detail.baseLevel, used: detail.usedLevel, cost: detail.cost }, contestId: options.contestId ?? null,
  });
  batch.set(cityRefs.activity(session.db, place), { lastAt: now(), lastName: name });
  await batch.commit();
  return id;
}

export async function editMessage(session: Session, id: string, text: string): Promise<void> {
  const body = text.trim();
  if (!body || body.length > MESSAGE_MAX) throw new FortunaError("message", "메시지 길이를 확인해 주세요.");
  await updateDoc(cityRefs.message(session.db, id), { text: body, editedAt: now() });
}

export async function deleteMessage(session: Session, id: string): Promise<void> {
  await updateDoc(cityRefs.message(session.db, id), { text: "", deleted: true, editedAt: now() });
}

/** 명장면: anyone in the city may pin or unpin. */
export async function pinMessage(session: Session, id: string, pinned: boolean): Promise<void> {
  await updateDoc(cityRefs.message(session.db, id), { pinned });
}

// ── 세션 ──

/** The next 04:00 KST after `ms`: a forgotten session closes then. */
export function nextDawn(ms: number): number {
  const kstDay = Math.floor((ms + 9 * 3_600_000) / 86_400_000) * 86_400_000;
  const dawn = kstDay + 4 * 3_600_000 - 9 * 3_600_000;
  return dawn > ms ? dawn : dawn + 86_400_000;
}

export function sessionOpen(session: SessionDoc | undefined, nowMs: number): boolean {
  return Boolean(session && !session.closedAt && session.closesAt && session.closesAt.toMillis() > nowMs);
}

export async function openSession(session: Session, title: string): Promise<string> {
  const name = title.trim();
  if (!name) throw new FortunaError("title", "세션 제목을 적어 주십시오.");
  const ref = await addDoc(cityRefs.sessions(session.db), { title: name.slice(0, 80), openedAt: now(), closesAt: Timestamp.fromMillis(nextDawn(session.clock.now())), closedAt: null });
  return ref.id;
}

export async function closeSession(session: Session, id: string): Promise<void> {
  await updateDoc(cityRefs.session(session.db, id), { closedAt: now() });
}

/** Every public message of a session, oldest first, as Markdown. */
export async function sessionLog(db: Firestore, sessionId: string, title: string, channelName: (channel: string) => string): Promise<string> {
  const snapshot = await getDocs(query(cityRefs.messages(db), where("sessionId", "==", sessionId), where("public", "==", true), orderBy("at", "asc"), limit(5_000)));
  const lines = [`# ${title}`];
  let lastChannel = "";
  const time = (ms: number) => new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(ms);
  for (const row of snapshot.docs) {
    const m = row.data();
    if (m.deleted) continue;
    if (m.channel !== lastChannel) { lines.push("", `## ${channelName(m.channel)}`, ""); lastChannel = m.channel; }
    const at = m.at?.toMillis?.() ?? 0, who = m.authorKind === "narration" ? "" : `**${m.authorName}** `;
    if (m.kind === "act") lines.push(`- ${time(at)} *${m.authorName} ${m.text}*`);
    else if (m.kind === "roll") lines.push(`- ${time(at)} ${who}🎲 ${m.text}`);
    else if (m.kind === "skill" && m.skill) lines.push(`- ${time(at)} ${who}✦ ${m.skill.name} ${m.skill.used}점 · ${m.skill.cost.toLocaleString("ko-KR")}코인 — ${m.text}`);
    else if (m.kind === "image") lines.push(`- ${time(at)} ${who}[장면 컷] ${m.text}`);
    else lines.push(`- ${time(at)} ${who}${m.text.replace(/\n/g, "\n  ")}`);
  }
  return lines.join("\n");
}

// ── 딜러: 장면, 이미지, NPC, 노선, 맞붙기 ──

export async function setSceneImage(session: Session, place: PlaceId, imageId: string | null): Promise<void> {
  await setDoc(cityRefs.scene(session.db, place), { imageId, sense: null, updatedAt: now() }, { merge: true });
}

export async function setSceneSense(session: Session, place: PlaceId, sense: string | null): Promise<void> {
  await setDoc(cityRefs.scene(session.db, place), { sense: sense?.trim() ? sense.trim().slice(0, 120) : null, updatedAt: now() }, { merge: true });
}

export async function fireEffect(session: Session, place: PlaceId, effect: SceneEffect): Promise<void> {
  await setDoc(cityRefs.scene(session.db, place), { pulse: { kind: effect, at: now() }, updatedAt: now() }, { merge: true });
}

export async function setPersistentEffect(session: Session, place: PlaceId, effect: SceneEffect | null): Promise<void> {
  await setDoc(cityRefs.scene(session.db, place), { persistent: effect, updatedAt: now() }, { merge: true });
}

export async function setStageNpcs(session: Session, place: PlaceId, npcs: string[]): Promise<void> {
  await setDoc(cityRefs.scene(session.db, place), { npcs: [...new Set(npcs)].slice(0, 12), updatedAt: now() }, { merge: true });
}

/**
 * Upload an already-shrunk image (the app resizes it) to the caller's own folder and register it.
 * Players may only register their own portrait; everything else is the dealer's.
 */
export async function uploadSceneImage(session: Session, storage: FirebaseStorage, blob: Blob, meta: Omit<SceneImageDoc, "path" | "url" | "createdAt" | "createdBy">): Promise<string> {
  const ref = doc(cityRefs.images(session.db));
  const path = `uploads/${session.uid}/${ref.id}.webp`;
  const file = storageRef(storage, path);
  await uploadBytes(file, blob, { contentType: blob.type || "image/webp", cacheControl: "public, max-age=31536000, immutable" });
  const url = await getDownloadURL(file);
  await setDoc(ref, {
    ...meta, name: meta.name.trim().slice(0, 60) || "이미지", sense: meta.sense.trim().slice(0, 120), credit: meta.credit.trim().slice(0, 200),
    path, url, createdAt: now(), createdBy: session.uid,
  });
  return ref.id;
}

export async function updateSceneImage(session: Session, id: string, patch: Partial<Pick<SceneImageDoc, "name" | "filter" | "focus" | "sense" | "credit">>): Promise<void> {
  await updateDoc(cityRefs.image(session.db, id), patch);
}

export async function saveNpc(session: Session, id: string | null, input: { name: string; line: LineId; portraitId: string | null }, notes?: string): Promise<string> {
  if (!input.name.trim()) throw new FortunaError("name", "NPC 이름을 적어 주십시오.");
  const ref = id ? cityRefs.npc(session.db, id) : doc(cityRefs.npcs(session.db));
  await setDoc(ref, { name: input.name.trim().slice(0, 40), line: input.line, portraitId: input.portraitId, createdAt: now() }, { merge: true });
  if (notes !== undefined) await setDoc(cityRefs.npcNotes(session.db, ref.id), { text: notes.slice(0, 2_000) });
  return ref.id;
}

/** Create the lore NPCs (names and districts only) that do not exist yet. */
export async function ensurePresetNpcs(session: Session): Promise<number> {
  let created = 0;
  for (const npc of PRESET_NPCS) {
    if ((await getDoc(cityRefs.npc(session.db, npc.id))).exists()) continue;
    await setDoc(cityRefs.npc(session.db, npc.id), { name: npc.name, line: npc.line, portraitId: null, createdAt: now() });
    created += 1;
  }
  return created;
}

export async function setLineClosed(session: Session, line: LineId, closed: boolean, current: LineId[]): Promise<void> {
  const next = closed ? [...new Set([...current, line])] : current.filter((entry) => entry !== line);
  await setDoc(cityRefs.config(session.db), { closedLines: next }, { merge: true });
}

export async function setCityScenes(session: Session, scenes: boolean): Promise<void> {
  await setDoc(cityRefs.config(session.db), { scenes }, { merge: true });
}

export async function openContest(session: Session, place: PlaceId, title: string, bossName: string): Promise<string> {
  const ref = await addDoc(cityRefs.contests(session.db), {
    place, title: title.trim().slice(0, 80) || "맞붙기", bossName: bossName.trim().slice(0, 40), bossScore: 0, bossSpent: 0, status: "open", result: "", openedAt: now(),
  });
  return ref.id;
}

export async function updateContest(session: Session, id: string, patch: Partial<Pick<ContestDoc, "bossScore" | "bossSpent" | "status" | "result">>): Promise<void> {
  await updateDoc(cityRefs.contest(session.db, id), patch);
}
