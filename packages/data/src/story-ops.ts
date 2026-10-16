import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch, type CollectionReference, type DocumentReference, type Firestore } from "firebase/firestore";
import { COIN_IDS, COINS, FRONT_DISTRICTS, FRONT_MAX, FRONT_TEXT, LINES, LINE_IDS, bookInputFrom, deriveBook, type BookDoc, type CoinId, type PageState, type FrontDistrict, type LineId, type PlaceId } from "@fortuna/core";
import { FortunaError, type PlayerSession, type Session } from "./ledger-write.ts";
import { cityRefs, placeChannel, sendMessage, type ContestDoc } from "./city-ops.ts";
import { scheduleNews } from "./market-ops.ts";
import { refs } from "./refs.ts";

/** 이야기 장치 (전선 시계 등). 설계는 비공개 문서에 있다. */

export interface FrontDoc { step: number; updatedAt: Timestamp; }

export type ClueKind = "collateral" | "clue";
/** clues/{id} (dealer only): the card, and whether anyone has found it yet. */
export interface ClueDoc { title: string; district: string | null; kind: ClueKind; public: string; secret: string; how: string; found: boolean; createdAt: Timestamp; }
/** clueCards/{pid}_{clueId}: a player's copy (they and the dealer read it). */
export interface ClueCardDoc { playerId: string; clueId: string; title: string; district: string | null; kind: ClueKind; public: string; secret: string; from: string; givenAt: Timestamp; }
export type AssistEffect = { kind: "score" | "fizzle" | "blank"; amount: number };
/** assists/{id} (dealer only): a district boss's one-time help in the final. */
export interface AssistDoc { district: string; title: string; effect: AssistEffect; line: string; }
/** lore/bookTitles (dealer and recorder): page names per district (4 + the black page) and the passenger page pattern. */
export interface BookTitlesDoc { chapters: Partial<Record<FrontDistrict, string[]>>; passenger: string; }
export interface SecretNews { coin: CoinId; kind: "official" | "paper" | "rumor"; tone: "up" | "down"; text: string; }
/** lore/fightLines (dealer only): what each boss says when raising or losing a round, and the manager at a blank page. Keyed by district, "manager" for the final. */
export type FightLines = Record<string, Partial<Record<"raise" | "lose" | "blank", string[]>>>;

const typed = <T>(ref: DocumentReference) => ref as DocumentReference<T>;
const typedCollection = <T>(ref: CollectionReference) => ref as CollectionReference<T>;

export const storyRefs = {
  front: (db: Firestore, district: FrontDistrict) => typed<FrontDoc>(doc(db, "fronts", district)),
  fronts: (db: Firestore) => typedCollection<FrontDoc>(collection(db, "fronts")),
  clue: (db: Firestore, id: string) => typed<ClueDoc>(doc(db, "clues", id)),
  clues: (db: Firestore) => typedCollection<ClueDoc>(collection(db, "clues")),
  card: (db: Firestore, pid: string, clueId: string) => typed<ClueCardDoc>(doc(db, "clueCards", `${pid}_${clueId}`)),
  cards: (db: Firestore) => typedCollection<ClueCardDoc>(collection(db, "clueCards")),
  assist: (db: Firestore, id: string) => typed<AssistDoc>(doc(db, "assists", id)),
  assists: (db: Firestore) => typedCollection<AssistDoc>(collection(db, "assists")),
  bookTitles: (db: Firestore) => typed<BookTitlesDoc>(doc(db, "lore", "bookTitles")),
  secretNews: (db: Firestore) => typed<{ items: SecretNews[] }>(doc(db, "lore", "secretNews")),
  fightLines: (db: Firestore) => typed<{ lines: FightLines }>(doc(db, "lore", "fightLines")),
  revealScenes: (db: Firestore) => typed<{ items: string[] }>(doc(db, "lore", "revealScenes")),
  book: (db: Firestore) => typed<BookDoc<Timestamp>>(doc(db, "book", "main")),
};

const now = () => serverTimestamp() as unknown as Timestamp;
const DISTRICT_IDS = [...FRONT_DISTRICTS, "downtown"] as const;
const isDistrict = (value: unknown): value is string => typeof value === "string" && (DISTRICT_IDS as readonly string[]).includes(value);
export function lineOfDistrict(district: string): LineId { return LINE_IDS.find((id) => LINES[id].district === district) ?? "wheel"; }

export function districtCoin(district: string): CoinId {
  return COIN_IDS.find((id) => COINS[id].districtId === district) ?? "FTN";
}

/**
 * Move a district's clock one step. Going up sends that step's three lines to the exchange:
 * the alley rumour a minute early, the official notice as bad news for the district's coin, the paper half an hour later.
 */
export async function stepFront(session: Session, district: FrontDistrict, direction: 1 | -1): Promise<number> {
  const { db } = session;
  const current = (await getDoc(storyRefs.front(db, district))).data()?.step ?? 0;
  const next = current + direction;
  if (next < 0 || next > FRONT_MAX) throw new FortunaError("front", "시계는 0~4칸입니다.");
  if (direction > 0 && (await getDoc(refs.district(db, district))).data()?.liberated) throw new FortunaError("liberated", "해방된 구역의 시계는 더 오르지 않습니다.");
  await setDoc(storyRefs.front(db, district), { step: next, updatedAt: serverTimestamp() as unknown as Timestamp });
  if (direction > 0) {
    const text = FRONT_TEXT[district][next - 1]!, coin = districtCoin(district);
    await scheduleNews(session, { coin, dir: -1, size: next >= FRONT_MAX ? "l" : "m", minutes: 60, headline: text.official, whisper: text.rumor, whisperMinutes: 1, delayMinutes: 1 });
    await scheduleNews(session, { coin, dir: -1, size: "z", minutes: 30, headline: text.paper, whisper: "", whisperMinutes: 1, delayMinutes: 31 });
  }
  await refreshBook(session).catch(() => undefined);
  return next;
}

// ── 단서 ──

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const CLUE_ID = /^[a-z0-9-]{1,60}$/;

export interface ClueInput { title: string; district: string | null; kind: ClueKind; public: string; secret: string; how: string; }

export async function saveClue(session: Session, id: string | null, input: ClueInput): Promise<string> {
  const title = text(input.title, 80);
  if (!title) throw new FortunaError("title", "단서 이름을 적어 주십시오.");
  if (id !== null && !CLUE_ID.test(id)) throw new FortunaError("id", "단서 id는 영문 소문자·숫자·하이픈만 씁니다.");
  const ref = id ? storyRefs.clue(session.db, id) : doc(storyRefs.clues(session.db));
  const before = (await getDoc(ref)).data();
  await setDoc(ref, {
    title, district: isDistrict(input.district) ? input.district : null, kind: input.kind === "collateral" ? "collateral" : "clue",
    public: text(input.public, 1_000), secret: text(input.secret, 2_000), how: text(input.how, 500), found: before?.found ?? false, createdAt: before?.createdAt ?? now(),
  });
  return ref.id;
}

/**
 * Hand a clue to players in a scene: each gets a copy in their notebook, the clue counts as found,
 * and the place's chat shows its title and public face.
 */
export async function giveClue(session: Session, clueId: string, pids: string[], place: PlaceId, names: string[], sessionId: string | null): Promise<void> {
  const clue = (await getDoc(storyRefs.clue(session.db, clueId))).data();
  if (!clue) throw new FortunaError("clue", "단서를 찾지 못했습니다.");
  if (!pids.length) throw new FortunaError("pids", "받을 사람을 골라 주십시오.");
  const batch = writeBatch(session.db);
  for (const pid of pids) {
    batch.set(storyRefs.card(session.db, pid, clueId), { playerId: pid, clueId, title: clue.title, district: clue.district, kind: clue.kind, public: clue.public, secret: clue.secret, from: "gm", givenAt: now() });
  }
  batch.update(storyRefs.clue(session.db, clueId), { found: true });
  await batch.commit();
  const face = clue.public ? `\n${clue.public.split("\n").map((line) => `> ${line}`).join("\n")}` : "";
  await refreshBook(session).catch(() => undefined);
  await sendMessage(session, session.uid, { authorKind: "narration" }, placeChannel(place), `🔎 **단서 — ${clue.title}**${face}\n\n_${names.join(", ")}의 수첩에 적혔다._`, { sessionId, place });
}

/** Show one of my clues to another player: they get the same card, marked as shown by me. */
export async function shareClue(session: PlayerSession, clueId: string, to: string): Promise<void> {
  if (to === session.pid) throw new FortunaError("to", "자기 자신에게는 보여 줄 수 없습니다.");
  const mine = (await getDoc(storyRefs.card(session.db, session.pid, clueId))).data();
  if (!mine) throw new FortunaError("card", "수첩에 없는 단서입니다.");
  const { givenAt: _givenAt, ...card } = mine;
  await setDoc(storyRefs.card(session.db, to, clueId), { ...card, playerId: to, from: session.pid, givenAt: now() });
}

// ── 이야기 자료 가져오기 (lore pack) ──

export interface LoreImportResult { clues: number; assists: number; npcs: number; titles: boolean; secretNews: number; fightLines: number; revealScenes: number; }

/** Import the lore pack (JSON pasted by the dealer). Ids are kept, so importing again overwrites; cards already given stay as they are. */
export async function importLorePack(session: Session, raw: string): Promise<LoreImportResult> {
  let pack: Record<string, unknown>;
  try { pack = JSON.parse(raw) as Record<string, unknown>; } catch { throw new FortunaError("json", "JSON 형식이 아닙니다. 파일 내용을 그대로 붙여 넣어 주십시오."); }
  const result: LoreImportResult = { clues: 0, assists: 0, npcs: 0, titles: false, secretNews: 0, fightLines: 0, revealScenes: 0 };
  for (const entry of Array.isArray(pack.clues) ? pack.clues as Record<string, unknown>[] : []) {
    if (typeof entry.id !== "string" || !CLUE_ID.test(entry.id)) continue;
    await saveClue(session, entry.id, {
      title: text(entry.title, 80), district: isDistrict(entry.district) ? entry.district : null, kind: entry.kind === "collateral" ? "collateral" : "clue",
      public: text(entry.public, 1_000), secret: text(entry.secret, 2_000), how: text(entry.how, 500),
    });
    result.clues += 1;
  }
  const batch = writeBatch(session.db);
  for (const entry of Array.isArray(pack.assists) ? pack.assists as Record<string, unknown>[] : []) {
    const effect = entry.effect as Record<string, unknown> | undefined;
    // "free" (the first raise costs nothing) cannot undo a payment, so it counts as +1 score.
    const kind = effect?.kind === "score" || effect?.kind === "fizzle" || effect?.kind === "blank" ? effect.kind : effect?.kind === "free" ? "score" : null;
    if (typeof entry.id !== "string" || !CLUE_ID.test(entry.id) || !isDistrict(entry.district) || !kind) continue;
    const amount = Math.max(1, Math.min(5, Math.round(Number(effect?.amount) || 1)));
    batch.set(storyRefs.assist(session.db, entry.id), { district: entry.district, title: text(entry.title, 60), effect: { kind, amount }, line: text(entry.line, 300) });
    result.assists += 1;
  }
  const pages = pack.pages as Record<string, unknown> | undefined;
  if (pages && typeof pages === "object") {
    const chapters: Partial<Record<FrontDistrict, string[]>> = {};
    for (const district of FRONT_DISTRICTS) {
      const list = pages[district];
      if (Array.isArray(list)) chapters[district] = list.slice(0, 5).map((title) => text(title, 120));
    }
    batch.set(storyRefs.bookTitles(session.db), { chapters, passenger: text(pages.passenger, 120) || "승객 [{name}]의 차용증" });
    result.titles = true;
  }
  const news = (Array.isArray(pack.secretNews) ? pack.secretNews as Record<string, unknown>[] : [])
    .filter((entry) => typeof entry.coin === "string" && (COIN_IDS as readonly string[]).includes(entry.coin) && typeof entry.text === "string")
    .map((entry) => ({
      coin: entry.coin as CoinId, kind: (["official", "paper", "rumor"].includes(String(entry.kind)) ? entry.kind : "rumor") as SecretNews["kind"],
      tone: entry.tone === "up" ? "up" as const : "down" as const, text: text(entry.text, 200),
    }));
  if (news.length) { batch.set(storyRefs.secretNews(session.db), { items: news }); result.secretNews = news.length; }
  const fight = pack.fightLines as Record<string, Record<string, unknown>> | undefined;
  if (fight && typeof fight === "object") {
    const lines: FightLines = {};
    for (const [who, byKind] of Object.entries(fight)) {
      if (!isDistrict(who) && who !== "manager") continue;
      for (const kind of ["raise", "lose", "blank"] as const) {
        const list = Array.isArray(byKind?.[kind]) ? (byKind[kind] as unknown[]).map((line) => text(line, 200)).filter(Boolean) : [];
        if (list.length) { (lines[who] ??= {})[kind] = list; result.fightLines += list.length; }
      }
    }
    batch.set(storyRefs.fightLines(session.db), { lines });
  }
  const scenes = (Array.isArray(pack.revealScenes) ? pack.revealScenes as unknown[] : []).map((scene) => text(scene, 2_000)).filter(Boolean);
  if (scenes.length) { batch.set(storyRefs.revealScenes(session.db), { items: scenes }); result.revealScenes = scenes.length; }
  await batch.commit();
  for (const entry of Array.isArray(pack.npcs) ? pack.npcs as Record<string, unknown>[] : []) {
    if (typeof entry.id !== "string" || !CLUE_ID.test(entry.id) || !text(entry.name, 40)) continue;
    const existing = (await getDoc(cityRefs.npc(session.db, entry.id))).data();
    await setDoc(cityRefs.npc(session.db, entry.id), {
      name: existing?.name ?? text(entry.name, 40), line: existing?.line ?? lineOfDistrict(String(entry.district ?? "")), portraitId: existing?.portraitId ?? null, createdAt: existing?.createdAt ?? now(),
    });
    if (text(entry.memo, 2_000)) await setDoc(cityRefs.npcNotes(session.db, entry.id), { text: text(entry.memo, 2_000) });
    result.npcs += 1;
  }
  return result;
}

// ── 장부 ──

const rows = <T>(snapshot: { docs: { id: string; data: () => T }[] }) => snapshot.docs.map((entry) => ({ id: entry.id, data: entry.data() as Record<string, unknown> }));

/** Recompute the ledger from the dealer's view (the price recorder does the same every ten minutes). */
export async function refreshBook(session: Session): Promise<void> {
  const { db } = session;
  const [districts, clues, funds, fronts, players, wallets, titles] = await Promise.all([
    getDocs(refs.districts(db)), getDocs(query(storyRefs.clues(db), where("kind", "==", "collateral"))), getDocs(query(refs.funds(db), where("visible", "==", true))), getDocs(storyRefs.fronts(db)),
    getDocs(refs.players(db)), getDocs(refs.wallets(db)), getDoc(storyRefs.bookTitles(db)),
  ]);
  const book = deriveBook(bookInputFrom({
    districts: rows(districts), clues: rows(clues), funds: rows(funds), fronts: rows(fronts), players: rows(players), wallets: rows(wallets),
    titles: (titles.data() as Record<string, unknown> | undefined) ?? null,
  }));
  await setDoc(storyRefs.book(db), { ...book, at: now() });
}

export async function setBookRevealed(session: Session, revealed: boolean): Promise<void> {
  await setDoc(cityRefs.config(session.db), { bookRevealed: revealed }, { merge: true });
  if (revealed) await refreshBook(session);
}

// ── 간부전 탁자 (맞붙기의 라운드제) ──

export type FightMode = "simple" | "boss" | "final";
export interface FightPage { title: string; state: PageState; }
export interface FightAssist { id: string; title: string; line: string; effect: AssistEffect; used: boolean; }

/** The fight fields a contest gains in 간부전/최종전 mode (absent on a plain 맞붙기). */
export interface FightFields {
  mode: FightMode;
  district: string | null;
  /** Rounds to play; the first side to win more than half takes the fight. */
  rounds: number;
  round: number;
  roundStartedAt: Timestamp;
  wins: { party: number; boss: number };
  /** What the boss can still pay for raises (shown only; no coins move). */
  bossVault: number;
  /** Bonus added to the party's score this round (help cards). */
  bonus: number;
  /** The boss's next raises that fizzle (help cards). */
  fizzle: number;
  log: string[];
  /** 최종전: the ledger pages in the order the manager turns them. */
  pages: FightPage[];
  pageIndex: number;
  assists: FightAssist[];
}

export function winsNeeded(rounds: number): number { return Math.floor(rounds / 2) + 1; }

export interface FightInput { title: string; bossName: string; mode: Exclude<FightMode, "simple">; district: string | null; rounds: number; bossVault: number; }

/** Open a boss fight at a place. The final takes the ledger (shuffled) and the help cards the party has earned. */
export async function openFight(session: Session, place: PlaceId, input: FightInput): Promise<string> {
  const { db } = session;
  const rounds = Math.max(1, Math.min(7, Math.round(input.rounds) || 3));
  let pages: FightPage[] = [], assists: FightAssist[] = [], vault = Math.max(0, Math.round(input.bossVault) || 0);
  if (input.mode === "final") {
    await refreshBook(session).catch(() => undefined);
    const book = (await getDoc(storyRefs.book(db))).data();
    if (!book) throw new FortunaError("book", "장부를 먼저 계산해 주십시오 (도시 › 이야기 › 지금 다시 계산).");
    pages = [...FRONT_DISTRICTS.flatMap((district) => book.chapters[district] ?? []), ...book.passengers].map((page) => ({ title: page.title, state: page.state }));
    for (let i = pages.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [pages[i], pages[j]] = [pages[j]!, pages[i]!]; }
    const earned = new Set(FRONT_DISTRICTS.filter((district) => (book.chapters[district] ?? []).slice(0, 3).every((page) => page.state === "blank")));
    assists = (await getDocs(storyRefs.assists(db))).docs.map((entry) => ({ id: entry.id, ...entry.data() }))
      .filter((entry) => earned.has(entry.district as FrontDistrict)).map((entry) => ({ id: entry.id, title: entry.title, line: entry.line, effect: entry.effect, used: false }));
    if (!vault) vault = (await getDoc(refs.vault(db))).data()?.amount ?? 0;
  }
  const fight: FightFields = {
    mode: input.mode, district: input.district, rounds, round: 1, roundStartedAt: now(), wins: { party: 0, boss: 0 }, bossVault: vault,
    bonus: 0, fizzle: 0, log: [], pages, pageIndex: 0, assists,
  };
  const ref = doc(cityRefs.contests(db));
  await setDoc(ref, {
    place, title: input.title.trim().slice(0, 80) || (input.mode === "final" ? "최종전" : "간부전"), bossName: input.bossName.trim().slice(0, 40) || "보스",
    bossScore: 0, bossSpent: 0, status: "open", result: "", openedAt: now(), ...fight,
  } as ContestDoc & FightFields);
  return ref.id;
}

type FightDoc = ContestDoc & Partial<FightFields>;

async function fightOf(session: Session, id: string): Promise<FightDoc & FightFields> {
  const fight = (await getDoc(cityRefs.contest(session.db, id))).data() as FightDoc | undefined;
  if (!fight || !fight.mode || fight.mode === "simple" || fight.status !== "open") throw new FortunaError("fight", "진행 중인 간부전이 아닙니다.");
  return fight as FightDoc & FightFields;
}

const say = (session: Session, fight: FightDoc, id: string, line: string, sessionId: string | null) =>
  sendMessage(session, session.uid, { authorKind: "narration" }, placeChannel(fight.place), line, { sessionId, place: fight.place, contestId: id });

/**
 * The boss raises by one step and pays the skill cost of the new score from its vault.
 * In the final the manager turns a ledger page for every raise: a blank page and the raise fizzles.
 */
/** A line for the boss to say (from the imported lore), or "" when there is none. */
async function bossLine(session: Session, who: string | null, kind: "raise" | "lose" | "blank"): Promise<string> {
  if (!who) return "";
  const list = (await getDoc(storyRefs.fightLines(session.db)).catch(() => null))?.data()?.lines?.[who]?.[kind] ?? [];
  return list.length ? list[Math.floor(Math.random() * list.length)]! : "";
}

export async function raiseBoss(session: Session, id: string, costs: readonly number[], sessionId: string | null): Promise<string> {
  const fight = await fightOf(session, id);
  const who = fight.mode === "final" ? "manager" : fight.district;
  const quote = (line: string) => (line ? ` “${line}”` : "");
  const next = fight.bossScore + 1, cost = costs[next] ?? costs[costs.length - 1] ?? 0, log = [...fight.log];
  let line: string, patch: Partial<FightDoc>;
  if (fight.fizzle > 0) {
    line = `🛡 ${fight.bossName}의 웃돈이 막혔다. (조력)`;
    patch = { fizzle: fight.fizzle - 1 };
  } else if (fight.mode === "final") {
    const page = fight.pages[fight.pageIndex];
    if (!page) throw new FortunaError("pages", "넘길 쪽이 남지 않았습니다. 지배인은 더 올릴 수 없습니다.");
    if (page.state === "blank") {
      line = `📄 ${fight.bossName}이(가) 장부를 넘겼다 — 「${page.title}」. 하얀 백지다. 웃돈이 불발됐다.${quote(await bossLine(session, who, "blank"))}`;
      patch = { pageIndex: fight.pageIndex + 1 };
    } else {
      line = `📕 ${fight.bossName}이(가) 장부를 넘겨 차용증을 태웠다 — 「${page.title}」. ${next}점.${quote(await bossLine(session, who, "raise"))}`;
      patch = { pageIndex: fight.pageIndex + 1, bossScore: next, bossSpent: fight.bossSpent + cost, bossVault: Math.max(0, fight.bossVault - cost) };
    }
  } else {
    if (fight.bossVault < cost) throw new FortunaError("vault", `${fight.bossName}의 금고가 모자랍니다 (${cost.toLocaleString("ko-KR")}코인 필요).`);
    line = `💰 ${fight.bossName}이(가) 웃돈을 얹었다 — ${next}점. (${cost.toLocaleString("ko-KR")}코인)${quote(await bossLine(session, who, "raise"))}`;
    patch = { bossScore: next, bossSpent: fight.bossSpent + cost, bossVault: fight.bossVault - cost };
  }
  log.push(line);
  await updateDoc(cityRefs.contest(session.db, id), { ...patch, log: log.slice(-30) });
  await say(session, fight, id, line, sessionId);
  return line;
}

/** Close the round: the higher score wins it (a tie is a draw). The next round starts with the boss at 0 until the dealer sets it. */
export async function closeRound(session: Session, id: string, partyScore: number, sessionId: string | null): Promise<{ party: number; boss: number; decided: "party" | "boss" | null }> {
  const fight = await fightOf(session, id);
  const party = partyScore + fight.bonus, verdict = party > fight.bossScore ? "party" : party < fight.bossScore ? "boss" : "draw";
  const wins = { party: fight.wins.party + (verdict === "party" ? 1 : 0), boss: fight.wins.boss + (verdict === "boss" ? 1 : 0) };
  const need = winsNeeded(fight.rounds), decided = wins.party >= need ? "party" : wins.boss >= need ? "boss" : null;
  const lost = verdict === "party" ? await bossLine(session, fight.mode === "final" ? "manager" : fight.district, "lose") : "";
  const line = `⚔ 제${fight.round}판 — 우리 편 ${party}점 : ${fight.bossName} ${fight.bossScore}점. ${verdict === "party" ? "우리 편 승리" : verdict === "boss" ? `${fight.bossName} 승리` : "무승부"} (${wins.party}:${wins.boss})${lost ? ` ${fight.bossName}: “${lost}”` : ""}`;
  await updateDoc(cityRefs.contest(session.db, id), {
    wins, round: fight.round + 1, roundStartedAt: now(), bossScore: 0, bonus: 0, log: [...fight.log, line].slice(-30),
  });
  await say(session, fight, id, line, sessionId);
  return { ...wins, decided };
}

/** Play a help card (final): extra score this round, a fizzled raise, or blank pages ahead in the manager's ledger. */
export async function playAssist(session: Session, id: string, assistId: string, sessionId: string | null): Promise<void> {
  const fight = await fightOf(session, id);
  const card = fight.assists.find((entry) => entry.id === assistId);
  if (!card || card.used) throw new FortunaError("assist", "쓸 수 없는 조력 카드입니다.");
  const patch: Partial<FightFields> = { assists: fight.assists.map((entry) => (entry.id === assistId ? { ...entry, used: true } : entry)) };
  let effect: string;
  if (card.effect.kind === "score") { patch.bonus = fight.bonus + card.effect.amount; effect = `이번 판 우리 편 +${card.effect.amount}점`; }
  else if (card.effect.kind === "fizzle") { patch.fizzle = fight.fizzle + card.effect.amount; effect = `${fight.bossName}의 다음 웃돈 ${card.effect.amount}번 불발`; }
  else {
    let left = card.effect.amount;
    patch.pages = fight.pages.map((page, index) => {
      if (left > 0 && index >= fight.pageIndex && page.state !== "blank") { left -= 1; return { ...page, state: "blank" as const }; }
      return page;
    });
    effect = `장부 ${card.effect.amount - left}쪽이 하얗게 지워졌다`;
  }
  const line = `✦ 조력 — ${card.title}: “${card.line}” (${effect})`;
  await updateDoc(cityRefs.contest(session.db, id), { ...patch, log: [...fight.log, line].slice(-30) });
  await say(session, fight, id, line, sessionId);
}
