import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { STATIONS, isPlaceId, parseDice, rollDice, type PlaceId } from "@fortuna/core";
import {
  GLOBAL_CHANNEL, cityRefs, deleteMessage, editMessage, parseChatInput, pinMessage, placeChannel, sendMessage, whisperChannel, whisperParties,
  type MessageDoc, type PlayerSession, type Session, type Speaker,
} from "@fortuna/data";
import { db } from "../firebase.ts";
import { cue } from "../fx/cues.ts";
import { cx, useAction, useToast } from "../ui/kit.tsx";
import { imageStyle } from "./images.ts";
import { Markdown } from "./markdown.tsx";
import { ActorFace, DealerFace, NpcFace } from "./SceneCard.tsx";
import { useLookups, useMessages, type MessageRow } from "./useCity.ts";

/**
 * RP 채팅: 장소 · 전체 · 귓속말. 플레이어는 자기 캐릭터로, 딜러는 딜러·서술·NPC로 말한다.
 * 마크다운, /행동, /주사위, /귓, 특기 결제 카드, 장면 컷, 명장면(★). docs/SPEC-CITY-MAP.md 8절.
 */
export const PAGE = 50;

export type ChatIdentity =
  | { kind: "player"; session: PlayerSession; name: string; onSkill: (prefill?: { skillId: string; usedLevel: number }) => void; skills: { id: string; name: string }[] }
  | { kind: "dealer"; session: Session; speaker: Speaker; setSpeaker: (speaker: Speaker) => void; cuts: { id: string; name: string }[] };

const selfId = (identity: ChatIdentity) => (identity.kind === "player" ? identity.session.pid : identity.session.uid);
const whisperSelf = (identity: ChatIdentity) => (identity.kind === "player" ? identity.session.pid : "gm");

const time = (ms: number) => new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(ms);

export function channelLabel(channel: string, names: Map<string, string>): string {
  if (channel === GLOBAL_CHANNEL) return "전체";
  if (channel.startsWith("place:")) { const id = channel.slice(6); return isPlaceId(id) ? STATIONS[id].name : id; }
  const parties = whisperParties(channel);
  if (parties.length) return `귓속말 · ${parties.map((p) => (p === "gm" ? "딜러" : names.get(p) ?? "?")).join(" ↔ ")}`;
  return channel;
}

// ── 귓속말 받은 편지함 ──

interface WhisperThread { channel: string; partner: string; lastMs: number; lastFromMe: boolean; }

const seenKey = (channel: string) => `fortuna.whisperSeen.${channel}`;
function readSeen(channel: string): number { try { return Number(localStorage.getItem(seenKey(channel)) ?? 0); } catch { return 0; } }
function writeSeen(channel: string, ms: number) { try { localStorage.setItem(seenKey(channel), String(ms)); } catch { /* private window */ } }

/** Latest whisper per conversation the viewer can see. Players query their own channels (≤30 per query); the dealer sees all. */
function useWhisperThreads(identity: ChatIdentity, partners: string[]): WhisperThread[] {
  const me = whisperSelf(identity), isDealer = identity.kind === "dealer";
  const channels = useMemo(() => partners.filter((p) => p !== me).map((p) => whisperChannel(me, p)), [me, partners.join(",")]);
  const [rows, setRows] = useState<Map<string, MessageDoc & { atMs: number }>>(new Map());
  useEffect(() => {
    const queries = isDealer
      ? [query(cityRefs.messages(db), where("public", "==", false), orderBy("at", "desc"), limit(200))]
      : Array.from({ length: Math.ceil(channels.length / 30) }, (_, i) => query(cityRefs.messages(db), where("channel", "in", channels.slice(i * 30, i * 30 + 30)), orderBy("at", "desc"), limit(60)));
    const parts = new Map<number, (MessageDoc & { atMs: number })[]>();
    const unsubscribe = queries.map((q, index) => onSnapshot(q, (snapshot) => {
      parts.set(index, snapshot.docs.map((row) => { const data = row.data({ serverTimestamps: "estimate" }); return { ...data, atMs: data.at?.toMillis?.() ?? Date.now() }; }));
      const latest = new Map<string, MessageDoc & { atMs: number }>();
      for (const list of parts.values()) for (const m of list) if (!latest.has(m.channel) || latest.get(m.channel)!.atMs < m.atMs) latest.set(m.channel, m);
      setRows(latest);
    }, () => undefined));
    return () => unsubscribe.forEach((stop) => stop());
  }, [isDealer, channels.join(",")]);
  return useMemo(() => [...rows.values()].map((m) => {
    const parties = whisperParties(m.channel);
    const partner = isDealer ? parties.filter((p) => p !== "gm").join("~") : parties.find((p) => p !== me) ?? "";
    return { channel: m.channel, partner, lastMs: m.atMs, lastFromMe: m.authorId === selfId(identity) };
  }).sort((a, b) => b.lastMs - a.lastMs), [rows, me]);
}

// ── 패널 ──

export function ChatPanel({ identity, place, sessionId, contestId, people, className }: {
  identity: ChatIdentity;
  place: PlaceId | null;
  sessionId: string | null;
  contestId: string | null;
  /** Everyone who can be whispered: id → name. */
  people: Map<string, string>;
  className?: string;
}) {
  const [tab, setTab] = useState<"place" | "global" | "whisper">(place ? "place" : "global");
  const [partner, setPartner] = useState<string | null>(null);
  const me = whisperSelf(identity);
  const partners = useMemo(() => ["gm", ...people.keys()], [people]);
  const threads = useWhisperThreads(identity, partners);
  const [seenTick, setSeenTick] = useState(0);
  useEffect(() => { if (!place && tab === "place") setTab("global"); }, [place]);

  const whisperChannelNow = partner ? (identity.kind === "dealer" && partner.includes("~") ? `whisper:${partner}` : whisperChannel(me, partner)) : null;
  const channel = tab === "place" && place ? placeChannel(place) : tab === "global" ? GLOBAL_CHANNEL : whisperChannelNow;
  const unread = threads.filter((t) => !t.lastFromMe && t.lastMs > readSeen(t.channel) && t.channel !== (tab === "whisper" ? whisperChannelNow : null));
  void seenTick;

  useEffect(() => {
    if (tab !== "whisper" || !whisperChannelNow) return;
    writeSeen(whisperChannelNow, Date.now()); setSeenTick((n) => n + 1);
  }, [tab, whisperChannelNow, threads]);

  const nameOf = (id: string) => (id === "gm" ? "딜러" : id.includes("~") ? id.split("~").map((p) => people.get(p) ?? "?").join(" ↔ ") : people.get(id) ?? "?");
  const canWrite = !(identity.kind === "dealer" && partner?.includes("~"));

  return (
    <section className={cx("flex min-h-0 flex-1 flex-col bg-felt-950/80", className)} aria-label="채팅">
      <div className="flex shrink-0 gap-1 border-b border-gold-400/25 px-2 pt-2" role="tablist">
        {place && <Tab active={tab === "place"} onClick={() => setTab("place")}>{STATIONS[place].name}</Tab>}
        <Tab active={tab === "global"} onClick={() => setTab("global")}>전체</Tab>
        <Tab active={tab === "whisper"} onClick={() => setTab("whisper")}>
          귓속말{unread.length > 0 && <span className="ml-1 inline-block h-2 w-2 rounded-full bg-[#e5484d]" aria-label="새 귓속말" />}
        </Tab>
      </div>
      {tab === "whisper" && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-gold-400/15 px-2 py-1.5" aria-label="귓속말 상대">
          {[...new Set([...threads.map((t) => t.partner), ...(identity.kind === "player" ? ["gm"] : []), ...people.keys()])].filter((id) => id && id !== me).map((id) => {
            const thread = threads.find((t) => t.partner === id), isNew = thread && unread.includes(thread);
            return (
              <button key={id} type="button" aria-pressed={partner === id} onClick={() => setPartner(id)}
                className={cx("btn btn-sm shrink-0", partner === id ? "btn-gold" : "btn-dark")}>
                {nameOf(id)}{isNew && <span className="ml-1 inline-block h-2 w-2 rounded-full bg-[#e5484d]" />}
              </button>
            );
          })}
        </div>
      )}
      {channel ? (
        <>
          <MessageList key={channel} channel={channel} identity={identity} names={people} />
          {canWrite
            ? <Composer identity={identity} channel={channel} place={tab === "place" ? place : null} sessionId={sessionId} contestId={tab === "place" ? contestId : null} people={people} onWhisper={(to) => { setTab("whisper"); setPartner(to); }} />
            : <p className="shrink-0 border-t border-gold-400/25 p-3 text-center text-xs text-mist">플레이어끼리의 귓속말은 읽기만 할 수 있습니다.</p>}
        </>
      ) : (
        <p className="flex-1 p-6 text-center text-sm text-mist">귓속말할 상대를 고르세요. 두 사람{identity.kind === "player" ? "과 딜러" : ""}만 볼 수 있습니다.</p>
      )}
    </section>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick}
      className={cx("max-w-[40%] truncate rounded-t-sm px-3 py-1.5 text-sm", active ? "bg-gold-400/15 font-bold text-gold-200" : "text-mist")}>{children}</button>
  );
}

function MessageList({ channel, identity, names }: { channel: string; identity: ChatIdentity; names: Map<string, string> }) {
  const [count, setCount] = useState(PAGE);
  const { ready, messages } = useMessages(channel, count);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastId = useRef<string | null>(null);
  const mine = selfId(identity);

  // Keep the newest message in view unless the reader scrolled up.
  useLayoutEffect(() => {
    const box = list.current;
    if (!box) return;
    const newest = messages.at(-1) ?? null;
    if (stick.current || newest?.data.authorId === mine && newest.id !== lastId.current) box.scrollTop = box.scrollHeight;
    if (newest && lastId.current && newest.id !== lastId.current && newest.data.authorId !== mine) cue("tap");
    lastId.current = newest?.id ?? null;
  }, [messages]);

  const empty = channel.startsWith("place:") ? `${channelLabel(channel, names)}은(는) 아직 조용하다.` : channel === GLOBAL_CHANNEL ? "아직 아무도 말하지 않았다." : "아직 나눈 귓속말이 없다.";
  return (
    <div ref={list} className="min-h-0 flex-1 overflow-y-auto px-3 py-2" onScroll={(event) => {
      const box = event.currentTarget;
      stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    }}>
      {ready && messages.length >= count && (
        <button type="button" className="mx-auto mb-2 block text-xs text-mist underline" onClick={() => { stick.current = false; setCount((value) => value + PAGE); }}>지난 이야기 더 보기</button>
      )}
      {ready && messages.length === 0 && <p className="py-6 text-center text-sm text-mist">{empty}</p>}
      <ul className="space-y-2.5">
        {messages.map((row, index) => {
          const prev = messages[index - 1]?.data;
          const grouped = Boolean(prev && prev.authorId === row.data.authorId && prev.authorKind === row.data.authorKind && prev.npcId === row.data.npcId
            && row.data.kind === "say" && prev.kind === "say" && row.atMs - messages[index - 1]!.atMs < 120_000 && !prev.deleted);
          return <MessageItem key={row.id} row={row} identity={identity} grouped={grouped} />;
        })}
      </ul>
    </div>
  );
}

export function MessageItem({ row, identity, grouped, readOnly }: { row: MessageRow; identity: ChatIdentity | null; grouped?: boolean; readOnly?: boolean }) {
  const { actors, data } = useLookups();
  const { busy, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.data.text);
  const m = row.data;
  const mine = identity ? m.authorId === selfId(identity) : false;

  if (m.deleted) return <li className="pl-10 text-xs italic text-mist/70">{m.authorKind === "narration" ? "서술" : m.authorName}{m.authorKind === "pc" ? "님이" : "이(가)"} 글을 지웠다.</li>;

  const actions = identity && !readOnly && !editing && !row.pending && (
    <div className="flex shrink-0 items-start gap-1 opacity-50 transition group-hover:opacity-100 group-focus-within:opacity-100">
      {m.public && (
        <button type="button" className={cx("text-xs", m.pinned ? "text-gold-300" : "text-mist hover:text-gold-200")} aria-label={m.pinned ? "명장면에서 빼기" : "명장면으로 남기기"} aria-pressed={m.pinned} disabled={busy}
          onClick={() => void run(() => pinMessage(identity.session, row.id, !m.pinned))}>{m.pinned ? "★" : "☆"}</button>
      )}
      {mine && !["roll", "skill"].includes(m.kind) && <>
        {m.kind !== "image" && <button type="button" className="text-xs text-mist hover:text-gold-200" aria-label="고치기" onClick={() => { setDraft(m.text); setEditing(true); }}>✎</button>}
        <button type="button" className="text-xs text-mist hover:text-[#f2b3aa]" aria-label="지우기" disabled={busy}
          onClick={() => { if (window.confirm("이 글을 지울까요?")) void run(() => deleteMessage(identity.session, row.id)); }}>✕</button>
      </>}
    </div>
  );

  const editor = editing && identity && (
    <div className="mt-1">
      <textarea className="field min-h-16 text-sm" value={draft} maxLength={2_000} onChange={(event) => setDraft(event.target.value)} />
      <div className="mt-1 flex gap-1">
        <button type="button" className="btn btn-gold btn-sm" disabled={busy || !draft.trim()} onClick={() => void run(async () => { await editMessage(identity.session, row.id, draft); setEditing(false); })}>저장</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setDraft(m.text); }}>취소</button>
      </div>
    </div>
  );

  // Narration: no face, a framed line across the chat.
  if (m.authorKind === "narration" && m.kind !== "image") {
    return (
      <li className="group flex gap-1">
        <div className="narration min-w-0 flex-1">{editor || <Markdown text={m.text} />}</div>
        {actions}
      </li>
    );
  }
  if (m.kind === "result") {
    return (
      <li className="group flex gap-1">
        <div className="result-card min-w-0 flex-1">
          <p className="deco-caps text-[0.6rem]">판정 · {m.authorName}</p>
          {editor || <div className="mt-0.5"><Markdown text={m.text} /></div>}
        </div>
        {actions}
      </li>
    );
  }

  const face = m.authorKind === "pc" ? <ActorFace actor={actors.get(m.authorId)} data={data} />
    : m.authorKind === "npc" ? <NpcFace npcId={m.npcId} name={m.authorName} data={data} />
    : m.authorKind === "gm" ? <DealerFace /> : null;
  const image = m.imageId ? data.images.get(m.imageId) : undefined;
  const body = m.kind === "roll" ? <DiceResult row={row} />
    : m.kind === "skill" && m.skill ? <SkillStamp m={m} />
    : m.kind === "image" ? (
      <figure className="mt-1">
        {image ? <img src={image.url} alt={m.text || image.name} className="max-h-72 w-full rounded-sm border border-gold-400/40 object-cover" style={imageStyle(image)} loading="lazy" /> : <p className="text-mist">(지워진 그림)</p>}
        {m.text && <figcaption className="mt-1 text-sm italic text-ivory/80">{m.text}</figcaption>}
      </figure>
    )
    : m.kind === "act" ? <div className="italic text-gold-200"><Markdown text={`**${m.authorName || "누군가"}** ${m.text}`} /></div>
    : <Markdown text={m.text} />;

  return (
    <li className={cx("group flex gap-2", grouped && "-mt-1.5")}>
      <div className="w-8 shrink-0">{!grouped && face}</div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <p className="flex items-baseline gap-2 text-xs">
            <span className={cx("font-bold", m.authorKind === "npc" ? "text-gold-300" : m.authorKind === "gm" ? "text-gold-200" : mine ? "text-gold-200" : "text-ivory")}>{m.authorKind === "narration" ? "서술" : m.authorName}</span>
            {m.authorKind === "npc" && <span className="rounded-sm border border-gold-400/40 px-1 text-[0.6rem] text-gold-300">NPC</span>}
            {m.authorKind === "gm" && <span className="rounded-sm bg-gold-400/20 px-1 text-[0.6rem] text-gold-200">GM</span>}
            <span className="text-mist/70">{time(row.atMs)}{m.editedAt ? " · 고침" : ""}</span>
          </p>
        )}
        {editor || <div className="text-[0.92rem] leading-relaxed text-ivory">{body}</div>}
      </div>
      {actions}
    </li>
  );
}

function SkillStamp({ m }: { m: MessageDoc }) {
  const s = m.skill!;
  return (
    <div className="skill-stamp">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-gold-300" aria-hidden="true">✦</span>
        <strong className="text-gold-50">{s.name}</strong>
        <span className="text-sm text-mist">{s.base}점 → <b className="text-gold-200">{s.used}점</b></span>
        <span className="ml-auto text-xs text-mist">{s.cost.toLocaleString("ko-KR")}코인 결제</span>
      </p>
      {m.text && <div className="mt-0.5 text-ivory"><Markdown text={m.text} /></div>}
    </div>
  );
}

/** Sealed dice: the result comes from the message id and its server time, the same on every screen. */
function DiceResult({ row }: { row: MessageRow }) {
  const expr = parseDice(row.data.text);
  if (!expr) return <p className="text-mist">🎲 {row.data.text}</p>;
  if (row.pending) return <p className="text-mist">🎲 {row.data.text} · 주사위가 구르는 중…</p>;
  const { faces, total } = rollDice(expr, row.id, row.atMs);
  return (
    <p className="flex flex-wrap items-center gap-1.5">
      <span aria-hidden="true">🎲</span>
      <span className="text-mist">{row.data.text}</span>
      <span aria-hidden="true" className="text-mist">→</span>
      {faces.map((face, index) => <span key={index} className="grid h-6 min-w-6 place-items-center rounded-sm border border-gold-400/50 bg-ivory px-1 text-xs font-bold text-ink">{face}</span>)}
      {expr.bonus !== 0 && <span className="text-sm text-mist">{expr.bonus > 0 ? `+${expr.bonus}` : expr.bonus}</span>}
      <span className="text-sm">=</span>
      <strong className="text-lg text-gold-200">{total}</strong>
    </p>
  );
}

// ── 입력 ──

function speakerLabel(speaker: Speaker): string {
  return speaker.authorKind === "gm" ? "딜러" : speaker.authorKind === "narration" ? "서술" : speaker.authorKind === "npc" ? speaker.name : speaker.name;
}

function Composer({ identity, channel, place, sessionId, contestId, people, onWhisper }: {
  identity: ChatIdentity; channel: string; place: PlaceId | null; sessionId: string | null; contestId: string | null; people: Map<string, string>; onWhisper: (to: string) => void;
}) {
  const toast = useToast();
  const { data } = useLookups();
  const [text, setText] = useState("");
  const [tools, setTools] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const dealer = identity.kind === "dealer";
  const speaker: Speaker = identity.kind === "player" ? { authorKind: "pc", name: identity.name } : identity.speaker;

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  /** Clears the box at once (like any chat) and puts the text back if sending fails. */
  async function send(input = text) {
    const typed = input === text;
    const result = /^\/판정\s+([\s\S]+)$/.exec(input.trim());
    const parsed = dealer && result ? { kind: "result" as const, text: result[1]!.trim() }
      : parseChatInput(input, identity.kind === "player" ? identity.skills : [], [...people].map(([id, name]) => ({ id, name })));
    if ("error" in parsed) { toast("error", parsed.error); return; }
    if (parsed.kind === "skill") {
      if (identity.kind === "player") { if (typed) setText(""); identity.onSkill({ skillId: parsed.skillId, usedLevel: parsed.usedLevel }); }
      return;
    }
    if (typed) setText("");
    cue(parsed.kind === "roll" ? "dice" : "tap");
    let target = channel, kind: "say" | "act" | "roll" | "result" = "say", body: string;
    if (parsed.kind === "whisper") { target = whisperChannel(whisperSelf(identity), parsed.to); body = parsed.text; onWhisper(parsed.to); }
    else { kind = parsed.kind; body = parsed.text; }
    try {
      await sendMessage(identity.session, dealer ? identity.session.uid : identity.session.pid, speaker, target, body, {
        kind, sessionId, place: target === channel ? place : null, contestId: null,
      });
    } catch (error) {
      if (typed) setText((current) => current || input);
      toast("error", error instanceof Error ? error.message : "보내지 못했습니다.");
    }
  }

  async function sendCut(imageId: string, caption: string) {
    try {
      await sendMessage(identity.session, identity.session.uid, speaker.authorKind === "pc" ? { authorKind: "narration" } : speaker, channel, caption, { kind: "image", imageId, sessionId, place });
      cue("flip");
    } catch (error) { toast("error", error instanceof Error ? error.message : "보내지 못했습니다."); }
  }

  const npcs = [...data.npcs.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return (
    <div className="shrink-0 border-t border-gold-400/25 bg-felt-950 p-2">
      {identity.kind === "dealer" && (
        <div className="mb-1.5 flex items-center gap-1 overflow-x-auto text-xs" aria-label="말하는 사람">
          <span className="shrink-0 text-mist">말하는 이</span>
          {([{ authorKind: "narration" }, { authorKind: "gm" }] as Speaker[]).map((option) => (
            <button key={option.authorKind} type="button" aria-pressed={identity.speaker.authorKind === option.authorKind}
              className={cx("btn btn-sm shrink-0", identity.speaker.authorKind === option.authorKind ? "btn-gold" : "btn-dark")} onClick={() => identity.setSpeaker(option)}>{speakerLabel(option)}</button>
          ))}
          <select className="field h-8 w-auto min-w-0 py-0 text-xs" aria-label="NPC로 말하기"
            value={identity.speaker.authorKind === "npc" ? identity.speaker.npcId : ""}
            onChange={(event) => { const npc = data.npcs.get(event.target.value); if (npc) identity.setSpeaker({ authorKind: "npc", npcId: npc.id, name: npc.name }); }}>
            <option value="">NPC…</option>
            {npcs.map((npc) => <option key={npc.id} value={npc.id}>{npc.name}</option>)}
          </select>
        </div>
      )}
      {tools && (
        <div className="mb-2 grid grid-cols-2 gap-1 text-sm">
          {["1d20", "2d6", "1d100", "3d6"].map((expr) => (
            <button key={expr} type="button" className="btn btn-dark btn-sm" onClick={() => { setTools(false); void send(`/주사위 ${expr}`); }}>🎲 {expr} 굴리기</button>
          ))}
          <button type="button" className="btn btn-dark btn-sm" onClick={() => { setTools(false); setText((value) => (value.startsWith("/행동 ") ? value : `/행동 ${value}`)); area.current?.focus(); }}>행동 묘사로 쓰기</button>
          {identity.kind === "player"
            ? <button type="button" className="btn btn-gold btn-sm" disabled={!place} onClick={() => { setTools(false); identity.onSkill(); }}>✦ 특기 쓰기 (결제)</button>
            : <button type="button" className="btn btn-dark btn-sm" onClick={() => { setTools(false); setText((value) => (value.startsWith("/판정 ") ? value : `/판정 ${value}`)); area.current?.focus(); }}>판정 결과로 쓰기</button>}
          {identity.kind === "dealer" && identity.cuts.length > 0 && (
            <div className="col-span-2">
              <p className="field-label">장면 컷 보내기</p>
              <div className="flex gap-1 overflow-x-auto">
                {identity.cuts.map((cut) => {
                  const image = data.images.get(cut.id);
                  return (
                    <button key={cut.id} type="button" className="shrink-0 rounded-sm border border-gold-400/40" title={cut.name}
                      onClick={() => { setTools(false); void sendCut(cut.id, text.trim() || cut.name); setText(""); }}>
                      {image && <img src={image.url} alt={cut.name} className="h-14 w-20 object-cover" style={imageStyle(image)} />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <p className="col-span-2 text-xs leading-relaxed text-mist">
            **굵게** · *기울임* · ~~취소선~~ · ||가리기|| · `코드` · 줄 앞에 &gt; 를 쓰면 인용(시스템 창·안내문).
            <br />/주사위 2d6+1 · /행동 잔을 내려놓는다 · *잔을 내려놓는다* · /귓 이름 할 말{identity.kind === "player" ? " · /특기 검술 5" : " · /판정 성공 — 문이 열린다"}
          </p>
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <button type="button" className={cx("btn btn-sm h-10 w-10 shrink-0 px-0", tools ? "btn-gold" : "btn-dark")} aria-label="주사위와 행동" aria-expanded={tools} onClick={() => setTools((value) => !value)}>⚡</button>
        <textarea
          ref={area} rows={1} value={text} maxLength={2_000}
          placeholder={dealer ? `${speakerLabel(speaker)}(으)로 쓰기 · /판정 · /주사위` : "말하기 · /주사위 2d6 · *행동*"}
          className="field min-h-10 flex-1 resize-none py-2 text-[0.95rem] leading-snug" aria-label="메시지"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (text.trim()) void send(); }
          }}
        />
        <button type="button" className="btn btn-gold btn-sm h-10 shrink-0" disabled={!text.trim()} onClick={() => void send()}>보내기</button>
      </div>
      {contestId && <p className="mt-1 text-[0.7rem] text-gold-300">맞붙기 진행 중 — 이 장소에서 쓰는 특기는 맞붙기 점수로 올라갑니다.</p>}
    </div>
  );
}
