import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PLACES, normalizeSprite, parseDice, rollDice, type PlaceId } from "@fortuna/core";
import { GLOBAL_CHANNEL, deleteMessage, editMessage, parseChatInput, placeChannel, sendMessage } from "@fortuna/data";
import { usePlayer } from "../session/player.tsx";
import { cue } from "../fx/cues.ts";
import { cx, useAction, useToast } from "../ui/kit.tsx";
import { Markdown } from "./markdown.tsx";
import { faceUrl } from "./sprites.ts";
import { useMessages, type ActorRow, type MessageRow } from "./useCity.ts";

/**
 * RP 채팅. 장소 채널(지금 있는 곳)과 전체 채널. 마크다운, /행동, /주사위.
 * docs/SPEC-CITY-MAP.md 4절.
 */
const PAGE = 50;

const time = (ms: number) => new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(ms);

export function ChatPanel({ place, actors }: { place: PlaceId; actors: Map<string, ActorRow> }) {
  const { session, player } = usePlayer();
  const [tab, setTab] = useState<"place" | "global">("place");
  const [count, setCount] = useState(PAGE);
  const channel = tab === "place" ? placeChannel(place) : GLOBAL_CHANNEL;
  const { ready, messages } = useMessages(channel, count);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastId = useRef<string | null>(null);

  useEffect(() => { setCount(PAGE); stick.current = true; }, [channel]);

  // Keep the newest message in view unless the reader scrolled up.
  useLayoutEffect(() => {
    const box = list.current;
    if (!box) return;
    const newest = messages.at(-1)?.id ?? null;
    if (stick.current) box.scrollTop = box.scrollHeight;
    if (newest && lastId.current && newest !== lastId.current && messages.at(-1)?.data.authorId !== session.pid) cue("tap");
    lastId.current = newest;
  }, [messages]);

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-felt-950/80" aria-label="채팅">
      <div className="flex shrink-0 gap-1 border-b border-gold-400/25 px-2 pt-2" role="tablist">
        {(["place", "global"] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id}
            className={cx("rounded-t-sm px-3 py-1.5 text-sm", tab === id ? "bg-gold-400/15 font-bold text-gold-200" : "text-mist")}
            onClick={() => setTab(id)}>
            {id === "place" ? PLACES[place].name : "전체"}
          </button>
        ))}
      </div>
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto px-3 py-2" onScroll={(event) => {
        const box = event.currentTarget;
        stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
      }}>
        {ready && messages.length >= count && (
          <button type="button" className="mx-auto mb-2 block text-xs text-mist underline" onClick={() => { stick.current = false; setCount((value) => value + PAGE); }}>지난 이야기 더 보기</button>
        )}
        {ready && messages.length === 0 && <p className="py-6 text-center text-sm text-mist">{tab === "place" ? `${PLACES[place].name}은(는) 아직 조용하다.` : "아직 아무도 말하지 않았다."}</p>}
        <ul className="space-y-2.5">
          {messages.map((row, index) => (
            <MessageItem key={row.id} row={row} actor={actors.get(row.data.authorId)} mine={row.data.authorId === session.pid}
              grouped={index > 0 && messages[index - 1]!.data.authorId === row.data.authorId && row.atMs - messages[index - 1]!.atMs < 120_000 && row.data.kind === "say" && messages[index - 1]!.data.kind === "say"} />
          ))}
        </ul>
      </div>
      <Composer channel={channel} name={player.name} onSent={() => { stick.current = true; }} />
    </section>
  );
}

function MessageItem({ row, actor, mine, grouped }: { row: MessageRow; actor: ActorRow | undefined; mine: boolean; grouped: boolean }) {
  const { session } = usePlayer();
  const { busy, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.data.text);
  const m = row.data, face = faceUrl(normalizeSprite(actor?.data.sprite));

  if (m.deleted) return <li className="pl-10 text-xs italic text-mist/70">{m.authorName}님이 글을 지웠다.</li>;

  const body = m.kind === "roll" ? <DiceResult row={row} />
    : m.kind === "act" ? <div className="italic text-gold-200"><Markdown text={`**${m.authorName}** ${m.text}`} /></div>
    : <Markdown text={m.text} />;

  return (
    <li className={cx("group flex gap-2", grouped && "-mt-1.5")}>
      <div className="w-8 shrink-0">{!grouped && <img src={face} alt="" width={32} height={32} className="pixelated h-8 w-8 rounded-sm border border-gold-400/30 bg-ink/60" />}</div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <p className="flex items-baseline gap-2 text-xs">
            <span className={cx("font-bold", mine ? "text-gold-200" : "text-ivory")}>{m.authorName}</span>
            <span className="text-mist/70">{time(row.atMs)}{m.editedAt ? " · 고침" : ""}</span>
          </p>
        )}
        {editing ? (
          <div className="mt-1">
            <textarea className="field min-h-16 text-sm" value={draft} maxLength={2_000} onChange={(event) => setDraft(event.target.value)} />
            <div className="mt-1 flex gap-1">
              <button type="button" className="btn btn-gold btn-sm" disabled={busy || !draft.trim()} onClick={() => void run(async () => { await editMessage(session, row.id, draft); setEditing(false); })}>저장</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setDraft(m.text); }}>취소</button>
            </div>
          </div>
        ) : (
          <div className="text-[0.92rem] leading-relaxed text-ivory">{body}</div>
        )}
      </div>
      {mine && m.kind !== "roll" && !editing && !row.pending && (
        <div className="flex shrink-0 items-start gap-1 opacity-60 transition group-hover:opacity-100">
          <button type="button" className="text-xs text-mist hover:text-gold-200" aria-label="고치기" onClick={() => { setDraft(m.text); setEditing(true); }}>✎</button>
          <button type="button" className="text-xs text-mist hover:text-[#f2b3aa]" aria-label="지우기" disabled={busy}
            onClick={() => { if (window.confirm("이 글을 지울까요?")) void run(() => deleteMessage(session, row.id)); }}>✕</button>
        </div>
      )}
    </li>
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

function Composer({ channel, name, onSent }: { channel: string; name: string; onSent: () => void }) {
  const { session } = usePlayer();
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [tools, setTools] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  /** Clears the box at once (like any chat) and puts the text back if sending fails. */
  async function send(input = text) {
    const parsed = parseChatInput(input);
    if ("error" in parsed) { toast("error", parsed.error); return; }
    const typed = input === text;
    if (typed) setText("");
    cue(parsed.kind === "roll" ? "dice" : "tap");
    onSent();
    setBusy(true);
    try {
      await sendMessage(session, name, channel, parsed.kind, parsed.text);
    } catch (error) {
      if (typed) setText((current) => current || input);
      toast("error", error instanceof Error ? error.message : "보내지 못했습니다.");
    } finally { setBusy(false); }
  }

  return (
    <div className="shrink-0 border-t border-gold-400/25 bg-felt-950 p-2">
      {tools && (
        <div className="mb-2 grid grid-cols-2 gap-1 text-sm">
          {["1d20", "2d6", "1d100", "3d6"].map((expr) => (
            <button key={expr} type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => { setTools(false); void send(`/주사위 ${expr}`); }}>🎲 {expr} 굴리기</button>
          ))}
          <button type="button" className="btn btn-dark btn-sm col-span-2" onClick={() => { setTools(false); setText((value) => (value.startsWith("/행동 ") ? value : `/행동 ${value}`)); area.current?.focus(); }}>행동 묘사로 쓰기</button>
          <p className="col-span-2 text-xs leading-relaxed text-mist">
            **굵게** · *기울임* · ~~취소선~~ · ||가리기|| · `코드` · 줄 앞에 &gt; 를 쓰면 인용(시스템 창·안내문).
            <br />/주사위 2d6+1 · /행동 잔을 내려놓는다 · *잔을 내려놓는다*
          </p>
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <button type="button" className={cx("btn btn-sm h-10 w-10 shrink-0 px-0", tools ? "btn-gold" : "btn-dark")} aria-label="주사위와 행동" aria-expanded={tools} onClick={() => setTools((value) => !value)}>⚡</button>
        <textarea
          ref={area} rows={1} value={text} maxLength={2_000} placeholder="말하기 · /주사위 2d6 · *행동*"
          className="field min-h-10 flex-1 resize-none py-2 text-[0.95rem] leading-snug" aria-label="메시지"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (text.trim()) void send(); }
          }}
        />
        <button type="button" className="btn btn-gold btn-sm h-10 shrink-0" disabled={!text.trim()} onClick={() => void send()}>보내기</button>
      </div>
    </div>
  );
}
