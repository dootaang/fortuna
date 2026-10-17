import { useEffect, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { DISTRICTS, FRONT_DISTRICTS, FRONT_MAX, FRONT_TEXT, HOTEL_RULES, type FrontDistrict, type PlaceId } from "@fortuna/core";
import {
  closeRound, districtCoin, giveClue, importLorePack, openFight, playAssist, raiseBoss, refreshBook, saveClue, scheduleNews, setBookRevealed, stepFront, storyEvent, storyRefs, winsNeeded,
  type ClueDoc, type ClueInput, type LoreImportResult, type SecretNews,
} from "@fortuna/data";
import { db } from "../firebase.ts";
import { useContestEntries, useLookups, type OpenContest } from "../city/useCity.ts";
import { roundEntries } from "../city/Stage.tsx";
import { LedgerBook, useBook } from "../city/LedgerBook.tsx";
import { Frame, Notice, NumberField, TextField, cx, useAction } from "../ui/kit.tsx";
import { SectionTitle, useDealer } from "./DealerApp.tsx";
import { relay } from "../relay.ts";

/** Post a story line to Discord (best effort: a failed post is listed on the notification page for resending). */
export function useTell(): (text: string) => Promise<void> {
  const { session, notify } = useDealer();
  return async (text: string) => {
    const id = await storyEvent(session, text).catch(() => null);
    relay(notify.relayUrl, id);
  };
}

/** 딜러 › 도시 › 이야기: 전선 시계, 이야기 자료, 단서, 장부. 설계는 비공개 문서(자료/fortuna-gm/SPEC-STORY.md). */
export function StoryAdmin() {
  return (
    <div className="space-y-4">
      <FrontDesk />
      <BookDesk />
      <ClueManager />
      <SecretNewsDesk />
      <LoreImport />
    </div>
  );
}

const nameOf = (district: FrontDistrict) => DISTRICTS.find((entry) => entry.id === district)?.name ?? district;

function FrontDesk() {
  const { session, districts } = useDealer();
  const { data } = useLookups();
  const { busy, run } = useAction();
  return (
    <Frame>
      <SectionTitle title="전선 시계" />
      <p className="mb-3 text-xs text-mist">
        한 칸 올리면 그 칸의 소식이 환전가로 나갑니다: 골목 소문(바로) → 1분 뒤 공식 공지(그 구역 코인 악재, 1~3칸 7%, 4칸 15%) → 30분 뒤 포르투나 석간(출렁임만). 공식 공지와 석간은 디스코드에도 올라갑니다.
        내리면 소식은 없습니다. 해방된 구역은 올릴 수 없습니다. 4칸(파국)인 동안 그 구역 장부에 검은 쪽이 붙습니다.
      </p>
      <ul className="grid gap-2 md:grid-cols-2">
        {FRONT_DISTRICTS.map((district) => {
          const step = data.fronts.get(district) ?? 0, next = step < FRONT_MAX ? FRONT_TEXT[district][step] : null;
          const liberated = districts.get(district)?.liberated ?? false;
          return (
            <li key={district} className="rounded-sm border border-gold-400/25 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold text-gold-200">{nameOf(district)} <span className="font-normal text-mist">· {districtCoin(district)}</span>{liberated && <span className="ml-1 text-xs text-[#9fe0b4]">해방됨</span>}</p>
                <div className="flex items-center gap-1">
                  <button type="button" className="btn btn-dark btn-sm" disabled={busy || step <= 0} onClick={() => void run(() => stepFront(session, district, -1))} aria-label="한 칸 내리기">－</button>
                  <b className="w-10 text-center text-lg">{step}/{FRONT_MAX}</b>
                  <button type="button" className="btn btn-gold btn-sm" disabled={busy || step >= FRONT_MAX || liberated}
                    onClick={() => { if (window.confirm(`${nameOf(district)} 시계를 ${step + 1}칸으로 올리고 소식을 내보낼까요?`)) void run(() => stepFront(session, district, 1)); }} aria-label="한 칸 올리기">＋</button>
                </div>
              </div>
              {next ? (
                <div className="mt-1.5 space-y-0.5 text-xs">
                  <p className="text-mist">다음 칸 ({step + 1}/{FRONT_MAX}){district === "horror" ? ` · ${HOTEL_RULES[step]?.slice(0, 14)}…` : ""}</p>
                  <p>공식: {next.official}</p>
                  <p className="text-mist">석간: {next.paper}</p>
                  <p className="text-mist">소문: {next.rumor}</p>
                </div>
              ) : <p className="mt-1.5 text-xs font-bold text-[#f2b3aa]">파국</p>}
            </li>
          );
        })}
      </ul>
    </Frame>
  );
}

// ── 이야기 자료 가져오기 ──

function LoreImport() {
  const { session } = useDealer();
  const { busy, run } = useAction();
  const [raw, setRaw] = useState("");
  const [result, setResult] = useState<LoreImportResult | null>(null);
  return (
    <Frame>
      <SectionTitle title="이야기 자료 가져오기" />
      <p className="mb-2 text-xs text-mist">
        컴퓨터의 자료/fortuna-gm/gemini/lore-pack.json 파일을 고르면 됩니다. 단서 카드, 장부 쪽 이름, 조력 카드, NPC 말투 메모, 단서 소문, 간부전 대사, 장부 공개 장면이 딜러만 읽는 곳에 저장됩니다.
        다시 가져오면 같은 id는 덮어씁니다(이미 건넨 수첩 카드는 그대로).
      </p>
      <label className="btn btn-gold btn-sm cursor-pointer">
        {busy ? "가져오는 중…" : "📂 lore-pack.json 파일 고르기"}
        <input type="file" accept=".json,application/json" className="sr-only" disabled={busy} onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void run(async () => setResult(await importLorePack(session, await file.text())), "이야기 자료를 가져왔습니다.");
        }} />
      </label>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-mist">파일 대신 내용을 붙여 넣기</summary>
        <TextField label="lore-pack.json 내용" value={raw} onChange={setRaw} multiline maxLength={200_000} placeholder='{ "version": 1, "clues": [ … ] }' />
        <button type="button" className="btn btn-dark btn-sm mt-2" disabled={busy || !raw.trim()} onClick={() => void run(async () => { setResult(await importLorePack(session, raw)); setRaw(""); }, "이야기 자료를 가져왔습니다.")}>가져오기</button>
      </details>
      {result && <p className="mt-2 text-xs text-gold-200">단서 {result.clues} · 조력 카드 {result.assists} · NPC {result.npcs} · 장부 쪽 이름 {result.titles ? "있음" : "없음"} · 단서 소문 {result.secretNews} · 간부전 대사 {result.fightLines} · 장부 공개 장면 {result.revealScenes}</p>}
    </Frame>
  );
}

// ── 단서 ──

export function useClues(): (ClueDoc & { id: string })[] {
  const [clues, setClues] = useState<(ClueDoc & { id: string })[]>([]);
  useEffect(() => onSnapshot(storyRefs.clues(db), (snapshot) => setClues(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }))
    .sort((a, b) => Number(b.kind === "collateral") - Number(a.kind === "collateral") || a.title.localeCompare(b.title, "ko"))), () => setClues([])), []);
  return clues;
}

const DISTRICT_OPTIONS: [string, string][] = [["", "구역 없음"], ...DISTRICTS.map((entry) => [entry.id, entry.name] as [string, string])];
const BLANK_CLUE: ClueInput = { title: "", district: null, kind: "clue", public: "", secret: "", how: "" };

function ClueManager() {
  const { session } = useDealer();
  const clues = useClues();
  const { busy, run } = useAction();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<ClueInput>(BLANK_CLUE);
  const edit = (id: string | "new") => {
    const clue = id === "new" ? null : clues.find((entry) => entry.id === id);
    setForm(clue ? { title: clue.title, district: clue.district, kind: clue.kind, public: clue.public, secret: clue.secret, how: clue.how } : BLANK_CLUE);
    setEditing(id);
  };
  return (
    <Frame>
      <SectionTitle title="단서" />
      <p className="mb-2 text-xs text-mist">건네기는 위의 「🔎 단서 주기」에서 합니다. ◆는 담보 단서(찾으면 그 구역 장부 3쪽이 백지가 됩니다).</p>
      {clues.length === 0 ? <Notice>단서가 없습니다. 이야기 자료를 가져오거나 새로 만드십시오.</Notice> : (
        <ul className="divide-y divide-gold-400/15 text-sm">
          {clues.map((clue) => (
            <li key={clue.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="min-w-0 truncate">{clue.kind === "collateral" ? "◆ " : "🔎 "}<b>{clue.title}</b> <span className="text-xs text-mist">{DISTRICTS.find((entry) => entry.id === clue.district)?.name ?? ""}</span></span>
              <span className="flex shrink-0 items-center gap-2">
                <span className={cx("text-xs", clue.found ? "text-[#9fe0b4]" : "text-mist")}>{clue.found ? "찾음" : "아직"}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => edit(clue.id)}>고치기</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-dark btn-sm mt-2" onClick={() => edit("new")}>＋ 새 단서</button>
      {editing && (
        <div className="mt-3 space-y-2 rounded-sm border border-gold-400/25 p-3">
          <TextField label="이름" value={form.title} onChange={(title) => setForm({ ...form, title })} maxLength={80} />
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-mist">구역
              <select className="field mt-1" value={form.district ?? ""} onChange={(event) => setForm({ ...form, district: event.target.value || null })}>
                {DISTRICT_OPTIONS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label className="text-xs text-mist">종류
              <select className="field mt-1" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value === "collateral" ? "collateral" : "clue" })}>
                <option value="clue">일반 단서</option><option value="collateral">담보 단서</option>
              </select>
            </label>
          </div>
          <TextField label="앞면 (받은 사람 수첩에, 웹앱 장면 채팅에도)" value={form.public} onChange={(value) => setForm({ ...form, public: value })} multiline maxLength={1_000} />
          <TextField label="뒷면 (가진 사람만)" value={form.secret} onChange={(value) => setForm({ ...form, secret: value })} multiline maxLength={2_000} />
          <TextField label="얻는 장면 메모 (딜러만)" value={form.how} onChange={(value) => setForm({ ...form, how: value })} multiline maxLength={500} />
          <div className="flex gap-2">
            <button type="button" className="btn btn-gold btn-sm" disabled={busy} onClick={() => void run(async () => { await saveClue(session, editing === "new" ? null : editing, form); setEditing(null); }, "저장했습니다.")}>저장</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>취소</button>
          </div>
        </div>
      )}
    </Frame>
  );
}

/** 단서를 건넨다: 받은 사람의 수첩에 들어가고, 디스코드에 한 줄 알린다. 장면 콘솔에서는 그 장소에 있는 사람이 먼저 골라져 있다. */
export function GiveClueDesk({ place, here, sessionId }: { place: PlaceId; here: { id: string; name: string }[]; sessionId: string | null }) {
  const { session, players } = useDealer();
  const clues = useClues();
  const tell = useTell();
  const { busy, run } = useAction();
  const [clueId, setClueId] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const hereKey = here.map((row) => row.id).join(",");
  useEffect(() => { setPicked(new Set(here.map((row) => row.id))); }, [place, hereKey]);
  const everyone = players.map((row) => ({ id: row.id, name: row.data.name }));
  return (
    <Frame>
      <SectionTitle title="🔎 단서 주기" />
      {clues.length === 0 ? <Notice>단서가 없습니다. 도시 › 이야기에서 가져오거나 만드십시오.</Notice> : (
        <div className="space-y-2">
          <select className="field" value={clueId} onChange={(event) => setClueId(event.target.value)} aria-label="단서">
            <option value="">단서 고르기…</option>
            {clues.map((clue) => <option key={clue.id} value={clue.id}>{clue.kind === "collateral" ? "◆ " : ""}{clue.title}{clue.found ? " (찾음)" : ""}</option>)}
          </select>
          <div className="flex flex-wrap gap-1.5">
            {everyone.map((row) => (
              <label key={row.id} className={cx("flex items-center gap-1 rounded-sm border px-2 py-1 text-sm", picked.has(row.id) ? "border-gold-300 bg-gold-400/15" : "border-gold-400/25")}>
                <input type="checkbox" checked={picked.has(row.id)} onChange={(event) => {
                  const next = new Set(picked);
                  if (event.target.checked) next.add(row.id); else next.delete(row.id);
                  setPicked(next);
                }} />
                {row.name}
              </label>
            ))}
          </div>
          <button type="button" className="btn btn-gold btn-sm" disabled={busy || !clueId || picked.size === 0}
            onClick={() => void run(async () => {
              const ids = [...picked], names = ids.map((id) => everyone.find((row) => row.id === id)?.name ?? id);
              const title = clues.find((clue) => clue.id === clueId)?.title ?? "";
              await giveClue(session, clueId, ids, place, names, sessionId);
              await tell(`📒 **${names.join(", ")}**의 수첩에 단서 「${title}」이(가) 적혔습니다. (웹앱 › 도시 › 📒 수첩)`);
              setClueId("");
            }, "단서를 건넸습니다.")}>건네기 (디스코드에 알림)</button>
        </div>
      )}
    </Frame>
  );
}

// ── 단서 소문 ──

const SOURCE_LABEL = { official: "공식", paper: "석간", rumor: "소문" } as const;

function SecretNewsDesk() {
  const { session } = useDealer();
  const { busy, run } = useAction();
  const [items, setItems] = useState<SecretNews[]>([]);
  const [sent, setSent] = useState<Set<number>>(new Set());
  useEffect(() => onSnapshot(storyRefs.secretNews(db), (snapshot) => setItems(snapshot.data()?.items ?? []), () => setItems([])), []);
  if (!items.length) return null;
  return (
    <Frame>
      <SectionTitle title="단서 소문" />
      <p className="mb-2 text-xs text-mist">비밀에 가까운 소문이라 자동 뉴스에서 뺀 줄입니다. 때가 되면 눌러서 환전가 소식으로 냅니다(그 코인에 중(7%) 크기, 1분 뒤).</p>
      <ul className="space-y-1.5 text-sm">
        {items.map((item, index) => (
          <li key={index} className="flex items-start justify-between gap-2">
            <span><span className="mr-1 text-xs text-mist">[{item.coin} · {SOURCE_LABEL[item.kind]} · {item.tone === "up" ? "호재" : "악재"}]</span>{item.text}</span>
            <button type="button" className="btn btn-dark btn-sm shrink-0" disabled={busy || sent.has(index)}
              onClick={() => { if (window.confirm("이 소문을 환전가 소식으로 낼까요?")) void run(async () => {
                await scheduleNews(session, { coin: item.coin, dir: item.tone === "up" ? 1 : -1, size: "m", minutes: 60, headline: item.text, whisper: "", whisperMinutes: 1, delayMinutes: 1 });
                setSent(new Set([...sent, index]));
              }, "소식을 예약했습니다."); }}>{sent.has(index) ? "냄" : "내기"}</button>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

// ── 장부 ──

function BookDesk() {
  const { session } = useDealer();
  const { data } = useLookups();
  const book = useBook();
  const { busy, run } = useAction();
  return (
    <Frame>
      <SectionTitle title="가죽 장부" />
      <p className="mb-2 text-xs text-mist">
        해방(1·2쪽), 담보 단서(3쪽), 장부 연결 모금함 달성(4쪽), 플레이어 빚 0(승객 쪽)이면 그 쪽이 지워집니다. 시계 4칸 동안은 검은 쪽이 붙습니다.
        딜러가 바꾸는 것은 바로, 플레이어의 빚 상환과 모금은 시세 기록원이 10분마다 반영합니다.
        <b className="text-gold-200"> 공개 전에는 플레이어에게 보이지 않습니다.</b> 공개하면 역 게시판에 「가죽 장부」 탭이 생깁니다.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" className={cx("btn btn-sm", data.bookRevealed ? "btn-dark" : "btn-gold")} disabled={busy}
          onClick={() => { if (window.confirm(data.bookRevealed ? "장부를 다시 숨길까요?" : "장부를 플레이어에게 공개할까요? (지배인의 비밀에 닿는 단서입니다)")) void run(() => setBookRevealed(session, !data.bookRevealed)); }}>
          {data.bookRevealed ? "공개 중 — 숨기기" : "장부 공개"}
        </button>
        <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => void run(() => refreshBook(session), "다시 계산했습니다.")}>지금 다시 계산</button>
      </div>
      <RevealScenes />
      <LedgerBook book={book} />
    </Frame>
  );
}

/** 장부를 공개할 때 쓰는 묘사 (이야기 자료에서): 복사하거나 디스코드에 올린다. */
function RevealScenes() {
  const tell = useTell();
  const { busy, run } = useAction();
  const [items, setItems] = useState<string[]>([]);
  useEffect(() => onSnapshot(storyRefs.revealScenes(db), (snapshot) => setItems(snapshot.data()?.items ?? []), () => setItems([])), []);
  if (!items.length) return null;
  return (
    <details className="mb-3 rounded-sm border border-gold-400/25 p-2">
      <summary className="cursor-pointer text-sm text-gold-200">장부 공개 장면 ({items.length}안)</summary>
      <ul className="mt-2 space-y-3">
        {items.map((scene, index) => (
          <li key={index} className="text-sm">
            <p className="whitespace-pre-line text-ivory/90">{scene}</p>
            <div className="mt-1 flex gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void navigator.clipboard?.writeText(scene).catch(() => undefined)}>복사 (디스코드용)</button>
              <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => { if (window.confirm("디스코드에 올릴까요?")) void run(() => tell(scene), "올렸습니다."); }}>디스코드에 올리기</button>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

// ── 간부전 탁자 ──

/** 장면 콘솔 › 맞붙기 아래: 간부전·최종전 열기. */
export function FightOpener({ place }: { place: PlaceId }) {
  const { session, config } = useDealer();
  const tell = useTell();
  const { busy, run } = useAction();
  const [mode, setMode] = useState<"boss" | "final">("boss");
  const [district, setDistrict] = useState<string>("medieval");
  const [boss, setBoss] = useState("");
  const [rounds, setRounds] = useState(3);
  const [vault, setVault] = useState(20_000);
  return (
    <details className="mt-3 rounded-sm border border-[#c4473a]/40 p-2">
      <summary className="cursor-pointer text-sm text-[#f2b3aa]">간부전 · 최종전 열기 (라운드제)</summary>
      <p className="my-2 text-xs text-mist">
        라운드마다 보스 점수를 걸고, 플레이어가 특기 탭에서 「걸기」를 켜고 결제합니다(우리 편 = 이번 판 최고 점수 + 조력). 진행은 디스코드에 그대로 올라갑니다. 「웃돈 +1」은 보스 금고에서 특기 비용표만큼 빠집니다.
        최종전은 웃돈마다 지배인이 장부를 한 쪽 넘기고, 백지 쪽이면 불발입니다. 조력 카드는 해방 + 담보 단서를 모두 갖춘 구역 것만 나옵니다.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-mist">종류
          <select className="field mt-1" value={mode} onChange={(event) => setMode(event.target.value === "final" ? "final" : "boss")}><option value="boss">간부전</option><option value="final">최종전</option></select>
        </label>
        {mode === "boss" && (
          <label className="text-xs text-mist">구역
            <select className="field mt-1" value={district} onChange={(event) => setDistrict(event.target.value)}>
              {FRONT_DISTRICTS.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
            </select>
          </label>
        )}
        <TextField label="보스 이름" value={boss} onChange={setBoss} placeholder={mode === "final" ? "지배인" : "마왕"} maxLength={40} />
        <NumberField label="판 수 (과반 선승)" value={rounds} onChange={setRounds} min={1} max={7} />
        <NumberField label={mode === "final" ? "지배인 금고 (0 = 실제 금고)" : "보스 금고 (웃돈 한도)"} value={vault} onChange={setVault} min={0} suffix="코인" />
      </div>
      <p className="mt-1 text-[0.7rem] text-mist">특기 비용표: {config.skill.costs.slice(1, 9).map((cost, index) => `${index + 1}점 ${cost.toLocaleString("ko-KR")}`).join(" · ")}</p>
      <button type="button" className="btn btn-danger btn-sm mt-2" disabled={busy}
        onClick={() => void run(async () => {
          const bossName = boss.trim() || (mode === "final" ? "지배인" : "보스");
          await openFight(session, place, { title: "", bossName, mode, district: mode === "boss" ? district : null, rounds, bossVault: vault });
          await tell(`⚔️ **${mode === "final" ? "최종전" : "간부전"} — ${bossName}**\n${rounds}판 ${winsNeeded(rounds)}선승. 웹앱 특기 탭에서 「걸기」를 켜고 결제하면 이번 판 우리 편 점수가 됩니다.`);
        }, "열었습니다.")}>
        {mode === "final" ? "최종전 열기" : "간부전 열기"}
      </button>
    </details>
  );
}

/** 진행 중인 간부전의 딜러 단추: 웃돈, 라운드 닫기, 조력 카드. */
export function FightControls({ contest, sessionId }: { contest: OpenContest; sessionId: string | null }) {
  const { session, config } = useDealer();
  const tell = useTell();
  const { busy, run } = useAction();
  const entries = roundEntries(contest, useContestEntries(contest.id));
  const best = entries[0]?.data.skill?.used ?? 0;
  const next = contest.bossScore + 1, cost = config.skill.costs[next] ?? 0;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void run(async () => tell(await raiseBoss(session, contest.id, config.skill.costs, sessionId)))}>
          웃돈 +1 ({next}점{contest.mode === "final" ? " · 장부 한 쪽" : ` · ${cost.toLocaleString("ko-KR")}코인`})
        </button>
        <button type="button" className="btn btn-gold btn-sm" disabled={busy}
          onClick={() => { if (window.confirm(`제${contest.round ?? 1}판을 닫을까요? 우리 편 ${best + (contest.bonus ?? 0)} : ${contest.bossName} ${contest.bossScore}`)) void run(async () => {
            const result = await closeRound(session, contest.id, best, sessionId);
            await tell(result.decided ? `${result.line}\n🏁 **${result.decided === "party" ? "우리 편" : contest.bossName}이(가) 이겼다.**` : result.line);
            if (result.decided) window.alert(result.decided === "party" ? "우리 편이 이겼습니다. 아래 결과를 발표하고, 간부전이면 구역 탭에서 해방을 켜십시오." : `${contest.bossName}이(가) 이겼습니다. 결과를 발표하고 닫으십시오.`);
          }); }}>
          제{contest.round ?? 1}판 닫기
        </button>
      </div>
      {contest.mode === "final" && (contest.assists ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(contest.assists ?? []).map((card) => (
            <button key={card.id} type="button" className={cx("btn btn-sm", card.used ? "btn-ghost" : "btn-dark")} disabled={busy || card.used} title={card.line}
              onClick={() => { if (window.confirm(`조력 카드 「${card.title}」를 펼칠까요?`)) void run(async () => tell(await playAssist(session, contest.id, card.id, sessionId))); }}>
              ✦ {card.title} <span className="text-[0.65rem] text-mist">{card.effect.kind === "score" ? `+${card.effect.amount}점` : card.effect.kind === "fizzle" ? `불발 ${card.effect.amount}` : `백지 ${card.effect.amount}쪽`}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
