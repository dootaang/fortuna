import { useEffect, useMemo, useState } from "react";
import { getDoc } from "firebase/firestore";
import {
  IMAGE_FILTERS, LINES, LINE_IDS, SCENE_EFFECTS, STATIONS, stationsOf,
  type ImageFilter, type LineId, type PlaceId, type SceneEffect,
} from "@fortuna/core";
import {
  cityRefs, closeSession, ensurePresetNpcs, fireEffect, openContest, openSession, placeChannel, saveNpc, sendMessage, setLineClosed, setPersistentEffect,
  setSceneImage, setSceneSense, setStageNpcs, updateContest, updateSceneImage, uploadSceneImage,
  type ImageOwner, type SceneImageDoc, type Speaker,
} from "@fortuna/data";
import { storage } from "../firebase.ts";
import { ChatPanel, PAGE, type ChatIdentity } from "../city/Chat.tsx";
import { MAX_SIDE, imageStyle, shrinkImage } from "../city/images.ts";
import { SceneCard, NpcFace } from "../city/SceneCard.tsx";
import { ContestPanel, Presence, Records } from "../city/Stage.tsx";
import { CityLookupProvider, useActors, useCityData, useLookups, useMessages, useOpenContest, useScene, useTicker } from "../city/useCity.ts";
import { Empty, Frame, Notice, NumberField, TextField, cx, useAction, useToast } from "../ui/kit.tsx";
import { SectionTitle, useDealer } from "./DealerApp.tsx";
import { FightControls, FightOpener, GiveClueDesk, StoryAdmin } from "./StoryAdmin.tsx";
import "../city/city.css";

/**
 * 딜러 › 도시: 장면 콘솔(이미지·효과·NPC·말하기), NPC, 컷 보관함, 세션·노선.
 * docs/SPEC-CITY-MAP.md 6~10절.
 */
const SUBTABS = [
  { id: "scene", label: "장면 콘솔" },
  { id: "story", label: "이야기" },
  { id: "npcs", label: "NPC" },
  { id: "cuts", label: "장면 컷" },
  { id: "ops", label: "세션·노선" },
  { id: "records", label: "기록" },
] as const;
type SubTab = (typeof SUBTABS)[number]["id"];

export function CityAdmin() {
  const { actors } = useActors();
  const now = useTicker(15_000);
  const data = useCityData(now);
  const byId = useMemo(() => new Map(actors.map((row) => [row.id, row])), [actors]);
  const [tab, setTab] = useState<SubTab>("scene");
  return (
    <CityLookupProvider value={{ actors: byId, data }}>
      <div className="mb-4 flex flex-wrap gap-1">
        {SUBTABS.map((entry) => (
          <button key={entry.id} type="button" className={cx("btn btn-sm", tab === entry.id ? "btn-gold" : "btn-dark")} onClick={() => setTab(entry.id)}>{entry.label}</button>
        ))}
      </div>
      {tab === "scene" && <SceneConsole nowMs={now} />}
      {tab === "story" && <StoryAdmin />}
      {tab === "npcs" && <NpcManager />}
      {tab === "cuts" && <ImageShelf owner="cut" refId="" title="장면 컷" hint="채팅에 끼워 보내는 그림입니다. 장면 콘솔 채팅의 ⚡ 메뉴에서 보냅니다." />}
      {tab === "ops" && <Operations />}
      {tab === "records" && <Records identity={null} names={new Map(actors.map((row) => [row.id, row.data.name]))} />}
    </CityLookupProvider>
  );
}

// ── 장면 콘솔 ──

function PlacePicker({ value, onChange }: { value: PlaceId; onChange: (place: PlaceId) => void }) {
  const { actors } = useLookups();
  const count = (place: PlaceId) => [...actors.values()].filter((row) => row.data.place === place).length;
  return (
    <select className="field" value={value} onChange={(event) => onChange(event.target.value as PlaceId)} aria-label="장소">
      {LINE_IDS.map((line) => (
        <optgroup key={line} label={LINES[line].name}>
          {stationsOf(line).map((station) => <option key={station.id} value={station.id}>{station.name}{count(station.id) ? ` · ${count(station.id)}명` : ""}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

function SceneConsole({ nowMs }: { nowMs: number }) {
  const { session } = useDealer();
  const { actors, data } = useLookups();
  const toast = useToast();
  const [place, setPlace] = useState<PlaceId>(() => {
    try { const saved = localStorage.getItem("fortuna.dealer.place"); if (saved && saved in STATIONS) return saved as PlaceId; } catch { /* ignore */ }
    return "wheel-plaza";
  });
  useEffect(() => { try { localStorage.setItem("fortuna.dealer.place", place); } catch { /* ignore */ } }, [place]);
  const [speaker, setSpeaker] = useState<Speaker>({ authorKind: "narration" });
  const scene = useScene(place);
  const contest = useOpenContest(place);
  const recent = useMessages(placeChannel(place), PAGE).messages;
  const here = [...actors.values()].filter((row) => row.data.place === place && nowMs - row.seenMs < 6 * 60 * 60_000);
  const image = scene?.imageId ? data.images.get(scene.imageId) ?? null : null;
  const { busy, run } = useAction();

  const cuts = [...data.images.values()].filter((entry) => entry.owner === "cut").sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  const identity: ChatIdentity = { kind: "dealer", session, speaker, setSpeaker, cuts: cuts.map((cut) => ({ id: cut.id, name: cut.name })) };
  const people = new Map([...actors.values()].map((row) => [row.id, row.data.name]));
  const stage = scene?.npcs ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="space-y-4">
        <Frame>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="min-w-48 flex-1"><PlacePicker value={place} onChange={setPlace} /></div>
            {data.session ? <span className="text-xs text-gold-200">세션: {data.session.title}</span> : <span className="text-xs text-mist">세션 닫힘</span>}
          </div>
          <div className="overflow-hidden rounded-sm border border-gold-400/30">
            <SceneCard place={place} scene={scene} image={image} />
            <Presence here={here} npcIds={stage} recent={recent} nowMs={nowMs} meId={null} />
          </div>
        </Frame>

        <ImageShelf owner="place" refId={place} title="이 장소의 배경" hint="누르면 지금 장면에 바로 걸립니다. 그림은 1600px WebP로 줄여 올라가고, 필터가 카드 톤을 맞춥니다."
          activeId={scene?.imageId ?? null} onActivate={(id) => void run(() => setSceneImage(session, place, id))} />

        <Frame>
          <SectionTitle title="효과" />
          <div className="flex flex-wrap gap-1">
            {(Object.keys(SCENE_EFFECTS) as SceneEffect[]).filter((id) => SCENE_EFFECTS[id].oneShot).map((id) => (
              <button key={id} type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => void run(() => fireEffect(session, place, id))}>⚡ {SCENE_EFFECTS[id].label}</button>
            ))}
            <span className="mx-1 h-8 w-px bg-gold-400/30" aria-hidden="true" />
            <button type="button" aria-pressed={!scene?.persistent} className={cx("btn btn-sm", !scene?.persistent ? "btn-gold" : "btn-dark")} disabled={busy} onClick={() => void run(() => setPersistentEffect(session, place, null))}>없음</button>
            {(Object.keys(SCENE_EFFECTS) as SceneEffect[]).filter((id) => !SCENE_EFFECTS[id].oneShot).map((id) => (
              <button key={id} type="button" aria-pressed={scene?.persistent === id} className={cx("btn btn-sm", scene?.persistent === id ? "btn-gold" : "btn-dark")} disabled={busy}
                onClick={() => void run(() => setPersistentEffect(session, place, id))}>{SCENE_EFFECTS[id].label}</button>
            ))}
          </div>
          <SenseEditor key={`${place}:${scene?.sense ?? ""}`} current={scene?.sense ?? ""} fallback={image?.sense || STATIONS[place].sense}
            onSave={(text) => run(() => setSceneSense(session, place, text || null))} />
        </Frame>

        <Frame>
          <SectionTitle title="무대 위 NPC" />
          {data.npcs.size === 0 ? <Notice>NPC가 없습니다. NPC 탭에서 만들거나 「세계관 NPC 만들기」를 누르십시오.</Notice> : (
            <div className="flex flex-wrap gap-1.5">
              {[...data.npcs.values()].sort((a, b) => Number(b.line === STATIONS[place].line) - Number(a.line === STATIONS[place].line) || a.name.localeCompare(b.name, "ko")).map((npc) => {
                const on = stage.includes(npc.id);
                return (
                  <span key={npc.id} className={cx("flex items-center gap-1 rounded-sm border px-1.5 py-1 text-sm", on ? "border-gold-300 bg-gold-400/15" : "border-gold-400/25")}>
                    <button type="button" className="flex items-center gap-1" aria-pressed={on} disabled={busy}
                      onClick={() => void run(() => setStageNpcs(session, place, on ? stage.filter((id) => id !== npc.id) : [...stage, npc.id]))}>
                      <NpcFace npcId={npc.id} name={npc.name} data={data} size={22} />{npc.name}
                    </button>
                    <button type="button" className={cx("text-xs", speaker.authorKind === "npc" && speaker.npcId === npc.id ? "text-gold-200" : "text-mist")} title="이 NPC로 말하기"
                      onClick={() => setSpeaker({ authorKind: "npc", npcId: npc.id, name: npc.name })}>💬</button>
                  </span>
                );
              })}
            </div>
          )}
          <p className="mt-2 text-xs text-mist">이름을 누르면 무대에 올리고 내립니다. 💬는 채팅에서 그 NPC로 말하기.</p>
        </Frame>

        <ContestDesk place={place} contest={contest} speaker={speaker} sessionId={data.session?.id ?? null} onError={(message) => toast("error", message)} />
        <GiveClueDesk place={place} here={here.map((row) => ({ id: row.id, name: row.data.name }))} sessionId={data.session?.id ?? null} />
      </div>

      <div className="lg:sticky lg:top-28 lg:h-[calc(100dvh-8rem)]">
        <div className="flex h-[70vh] flex-col overflow-hidden rounded-sm border border-gold-400/30 lg:h-full">
          <ChatPanel identity={identity} place={place} sessionId={data.session?.id ?? null} contestId={null} people={people} />
        </div>
      </div>
    </div>
  );
}

function SenseEditor({ current, fallback, onSave }: { current: string; fallback: string; onSave: (text: string) => Promise<unknown> }) {
  const [text, setText] = useState(current);
  return (
    <div className="mt-3 flex items-end gap-2">
      <div className="flex-1"><TextField label="감각 한 줄 (비우면 그림·역 기본값)" value={text} onChange={setText} placeholder={fallback} maxLength={120} /></div>
      <button type="button" className="btn btn-dark btn-sm mb-0.5" onClick={() => void onSave(text)}>걸기</button>
    </div>
  );
}

function ContestDesk({ place, contest, speaker, sessionId, onError }: {
  place: PlaceId; contest: ReturnType<typeof useOpenContest>; speaker: Speaker; sessionId: string | null; onError: (message: string) => void;
}) {
  const { session } = useDealer();
  const { busy, run } = useAction();
  const [title, setTitle] = useState("");
  const [boss, setBoss] = useState("");
  const [bossScore, setBossScore] = useState(contest?.bossScore ?? 0);
  const [result, setResult] = useState("");
  useEffect(() => { setBossScore(contest?.bossScore ?? 0); }, [contest?.id, contest?.bossScore]);

  if (!contest) {
    return (
      <Frame>
        <SectionTitle title="맞붙기" />
        <p className="mb-2 text-xs text-mist">열어 두면 이 장소에서 쓰는 특기 결제가 점수판에 오릅니다. 상대(보스)의 점수는 딜러가 정합니다.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <TextField label="제목" value={title} onChange={setTitle} placeholder="흑전각 앞 결투" maxLength={80} />
          <TextField label="상대 (비우면 플레이어끼리)" value={boss} onChange={setBoss} placeholder="천마" maxLength={40} />
        </div>
        <button type="button" className="btn btn-gold btn-sm mt-2" disabled={busy} onClick={() => void run(async () => { await openContest(session, place, title, boss); setTitle(""); setBoss(""); })}>맞붙기 열기</button>
        <FightOpener place={place} />
      </Frame>
    );
  }
  return (
    <Frame className="!p-0">
      <ContestPanel contest={contest} controls={
        <div className="mt-2 space-y-2 border-t border-gold-400/20 pt-2">
          {(contest.mode === "boss" || contest.mode === "final") && <FightControls contest={contest} sessionId={sessionId} />}
          {contest.bossName && (
            <div className="flex items-end gap-2">
              <div className="w-32"><NumberField label={`${contest.bossName} 점수`} value={bossScore} onChange={setBossScore} min={0} max={99} /></div>
              <button type="button" className="btn btn-dark btn-sm mb-0.5" disabled={busy || !Number.isFinite(bossScore)} onClick={() => void run(() => updateContest(session, contest.id, { bossScore }))}>점수 걸기</button>
            </div>
          )}
          <TextField label="결과 (채팅에 판정으로 올라갑니다)" value={result} onChange={setResult} placeholder="벨라의 검이 먼저 닿았다." multiline maxLength={1_000} />
          <div className="flex gap-2">
            <button type="button" className="btn btn-gold btn-sm" disabled={busy || !result.trim()} onClick={() => void run(async () => {
              const who: Speaker = speaker.authorKind === "pc" ? { authorKind: "gm" } : speaker;
              await sendMessage(session, session.uid, who, placeChannel(place), `**${contest.title}** — ${result.trim()}`, { kind: "result", sessionId, place, contestId: contest.id })
                .catch((error: unknown) => { onError(error instanceof Error ? error.message : "결과를 올리지 못했습니다."); throw error; });
              await updateContest(session, contest.id, { status: "closed", result: result.trim() });
              setResult("");
            })}>결과 발표하고 닫기</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { if (window.confirm("결과 없이 맞붙기를 닫을까요?")) void run(() => updateContest(session, contest.id, { status: "closed" })); }}>그냥 닫기</button>
          </div>
        </div>
      } />
    </Frame>
  );
}

// ── 이미지 선반 ──

function ImageShelf({ owner, refId, title, hint, activeId, onActivate }: {
  owner: ImageOwner; refId: string; title: string; hint: string; activeId?: string | null; onActivate?: (id: string | null) => void;
}) {
  const { session } = useDealer();
  const { data } = useLookups();
  const { busy, run } = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const images = [...data.images.values()].filter((entry) => entry.owner === owner && entry.ref === refId)
    .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
  const edit = editing ? data.images.get(editing) : undefined;

  async function upload(files: FileList) {
    for (const file of [...files].slice(0, 8)) {
      const blob = await shrinkImage(file, owner === "npc" ? MAX_SIDE.portrait : MAX_SIDE.scene, owner === "npc");
      const id = await uploadSceneImage(session, storage, blob, { owner, ref: refId, name: file.name.replace(/\.[^.]+$/, "").slice(0, 60), filter: "soft", focus: "center", sense: "", credit: "" });
      setEditing(id);
    }
  }

  return (
    <Frame>
      <SectionTitle title={title}>
        <label className={cx("btn btn-gold btn-sm cursor-pointer", busy && "pointer-events-none opacity-50")}>
          {busy ? "올리는 중…" : "그림 올리기"}
          <input type="file" accept="image/*" multiple className="sr-only" disabled={busy} onChange={(event) => {
            const files = event.target.files;
            if (files?.length) void run(() => upload(files));
            event.target.value = "";
          }} />
        </label>
      </SectionTitle>
      <p className="mb-2 text-xs text-mist">{hint}</p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {onActivate && (
          <button type="button" aria-pressed={!activeId} onClick={() => onActivate(null)}
            className={cx("grid h-20 w-32 shrink-0 place-items-center rounded-sm border text-xs", !activeId ? "border-gold-300 text-gold-200" : "border-gold-400/30 text-mist")}>기본 그림</button>
        )}
        {images.map((entry) => (
          <div key={entry.id} className={cx("relative shrink-0 overflow-hidden rounded-sm border", activeId === entry.id ? "border-gold-300 ring-2 ring-gold-400/50" : "border-gold-400/30")}>
            <button type="button" className="block" aria-pressed={activeId === entry.id} title={onActivate ? "장면에 걸기" : entry.name} onClick={() => (onActivate ? onActivate(entry.id) : setEditing(entry.id))}>
              <img src={entry.url} alt={entry.name} className={cx("object-cover", owner === "npc" ? "h-20 w-20" : "h-20 w-32")} style={imageStyle(entry)} loading="lazy" />
            </button>
            <button type="button" className="absolute right-1 top-1 rounded-sm bg-ink/80 px-1 text-xs text-gold-200" aria-label={`${entry.name} 설정`} onClick={() => setEditing(editing === entry.id ? null : entry.id)}>⚙</button>
            <p className="max-w-32 truncate bg-ink/80 px-1 text-[0.65rem]">{entry.name}</p>
          </div>
        ))}
        {!images.length && !onActivate && <Empty>아직 그림이 없습니다.</Empty>}
      </div>
      {edit && <ImageEditor key={edit.id} image={edit} />}
    </Frame>
  );
}

function ImageEditor({ image }: { image: SceneImageDoc & { id: string } }) {
  const { session } = useDealer();
  const { busy, run } = useAction();
  const [draft, setDraft] = useState({ name: image.name, sense: image.sense, credit: image.credit });
  const save = (patch: Partial<Pick<SceneImageDoc, "name" | "filter" | "focus" | "sense" | "credit">>) => void run(() => updateSceneImage(session, image.id, patch));
  return (
    <div className="mt-3 grid gap-3 rounded-sm border border-gold-400/25 p-3 sm:grid-cols-[160px_1fr]">
      <img src={image.url} alt="" className="h-28 w-full rounded-sm object-cover" style={imageStyle(image)} />
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="text-mist">필터</span>
          {(Object.keys(IMAGE_FILTERS) as ImageFilter[]).map((filter) => (
            <button key={filter} type="button" aria-pressed={image.filter === filter} className={cx("btn btn-sm", image.filter === filter ? "btn-gold" : "btn-dark")} disabled={busy} onClick={() => save({ filter })}>{IMAGE_FILTERS[filter]}</button>
          ))}
          <span className="ml-2 text-mist">초점</span>
          {(["top", "center", "bottom"] as const).map((focus) => (
            <button key={focus} type="button" aria-pressed={image.focus === focus} className={cx("btn btn-sm", image.focus === focus ? "btn-gold" : "btn-dark")} disabled={busy} onClick={() => save({ focus })}>{focus === "top" ? "위" : focus === "center" ? "가운데" : "아래"}</button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <TextField label="이름" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} maxLength={60} />
          <TextField label="출처 (화면 구석에 작게)" value={draft.credit} onChange={(credit) => setDraft({ ...draft, credit })} maxLength={200} />
        </div>
        <TextField label="감각 한 줄 (이 그림이 걸릴 때)" value={draft.sense} onChange={(sense) => setDraft({ ...draft, sense })} maxLength={120} />
        <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => save({ name: draft.name.trim() || image.name, sense: draft.sense.trim(), credit: draft.credit.trim() })}>글 저장</button>
      </div>
    </div>
  );
}

// ── NPC ──

function NpcManager() {
  const { session } = useDealer();
  const { data } = useLookups();
  const { busy, run } = useAction();
  const toast = useToast();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const npcs = [...data.npcs.values()].sort((a, b) => LINE_IDS.indexOf(a.line) - LINE_IDS.indexOf(b.line) || a.name.localeCompare(b.name, "ko"));
  return (
    <div className="space-y-4">
      <Frame>
        <SectionTitle title="NPC">
          <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => void run(async () => { const n = await ensurePresetNpcs(session); toast("success", n ? `세계관 NPC ${n}명을 만들었습니다.` : "이미 모두 있습니다."); })}>세계관 NPC 만들기</button>
          <button type="button" className="btn btn-gold btn-sm" onClick={() => setEditing("new")}>새 NPC</button>
        </SectionTitle>
        <p className="mb-3 text-xs text-mist">이름과 초상화는 플레이어에게 보입니다. 비밀 메모는 딜러만 봅니다.</p>
        {npcs.length ? (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {npcs.map((npc) => (
              <li key={npc.id}>
                <button type="button" className={cx("flex w-full items-center gap-2 rounded-sm border p-2 text-left", editing === npc.id ? "border-gold-300" : "border-gold-400/25")} onClick={() => setEditing(npc.id)}>
                  <NpcFace npcId={npc.id} name={npc.name} data={data} size={40} />
                  <span className="min-w-0">
                    <span className="block truncate font-bold">{npc.name}</span>
                    <span className="block text-xs" style={{ color: LINES[npc.line].light }}>{LINES[npc.line].name}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : <Empty>아직 NPC가 없습니다.</Empty>}
      </Frame>
      {editing && <NpcEditor key={editing} id={editing === "new" ? null : editing} onDone={(id) => setEditing(id)} />}
    </div>
  );
}

function NpcEditor({ id, onDone }: { id: string | null; onDone: (id: string | null) => void }) {
  const { session } = useDealer();
  const { data } = useLookups();
  const { busy, run } = useAction();
  const npc = id ? data.npcs.get(id) : undefined;
  const [name, setName] = useState(npc?.name ?? "");
  const [line, setLine] = useState<LineId>(npc?.line ?? "wheel");
  const [notes, setNotes] = useState<string | null>(id ? null : "");
  useEffect(() => {
    if (!id) return;
    void getDoc(cityRefs.npcNotes(session.db, id)).then((snapshot) => setNotes((snapshot.data()?.text as string | undefined) ?? "")).catch(() => setNotes(""));
  }, [id]);

  return (
    <Frame>
      <SectionTitle title={npc ? `${npc.name} 고치기` : "새 NPC"} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="이름" value={name} onChange={setName} maxLength={40} />
        <label className="block">
          <span className="field-label">구역</span>
          <select className="field" value={line} onChange={(event) => setLine(event.target.value as LineId)}>
            {LINE_IDS.map((entry) => <option key={entry} value={entry}>{LINES[entry].name}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-3">
        <TextField label="비밀 메모 (딜러만)" value={notes ?? ""} onChange={setNotes} multiline maxLength={2_000} placeholder={notes === null ? "불러오는 중…" : "말투, 숨긴 목적, 약점…"} />
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn btn-gold btn-sm" disabled={busy || !name.trim() || notes === null} onClick={() => void run(async () => {
          const saved = await saveNpc(session, id, { name, line, portraitId: npc?.portraitId ?? null }, notes ?? undefined);
          onDone(saved);
        })}>저장</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDone(null)}>닫기</button>
      </div>
      {id && npc && (
        <div className="mt-4">
          <ImageShelf owner="npc" refId={id} title="초상화" hint="누르면 이 NPC의 얼굴로 씁니다. 정사각형으로 잘라 줄여서 올라갑니다."
            activeId={npc.portraitId} onActivate={(portraitId) => void run(() => saveNpc(session, id, { name: npc.name, line: npc.line, portraitId }))} />
        </div>
      )}
    </Frame>
  );
}

// ── 세션·노선 ──

function Operations() {
  const { session } = useDealer();
  const { data } = useLookups();
  const { busy, run } = useAction();
  const [title, setTitle] = useState("");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Frame>
        <SectionTitle title="세션" />
        {data.session ? (
          <div className="space-y-2">
            <Notice tone="success">진행 중: <b>{data.session.title}</b> · 새벽 4시에 저절로 닫힙니다.</Notice>
            <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => void run(() => closeSession(session, data.session!.id))}>세션 닫기</button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-mist">세션을 열면 그동안의 공개 대화가 세션에 묶여, 기록 탭에서 한 파일로 내려받을 수 있습니다.</p>
            <TextField label="제목" value={title} onChange={setTitle} placeholder="3화 — 흑전각의 밤" maxLength={80} />
            <button type="button" className="btn btn-gold btn-sm" disabled={busy || !title.trim()} onClick={() => void run(async () => { await openSession(session, title); setTitle(""); })}>세션 열기</button>
          </div>
        )}
      </Frame>
      <Frame>
        <SectionTitle title="노선 운행" />
        <p className="mb-2 text-xs text-mist">운휴인 노선의 역으로는 새로 갈 수 없습니다. 이미 있는 사람은 그대로 머뭅니다.</p>
        <div className="space-y-1">
          {LINE_IDS.filter((line) => line !== "wheel").map((line) => {
            const closed = data.closedLines.has(line);
            return (
              <div key={line} className="flex items-center justify-between gap-2 rounded-sm border border-gold-400/20 px-2 py-1.5">
                <span className="text-sm" style={{ color: LINES[line].light }}>{LINES[line].name}</span>
                <button type="button" className={cx("btn btn-sm", closed ? "btn-gold" : "btn-dark")} disabled={busy}
                  onClick={() => void run(() => setLineClosed(session, line, !closed, [...data.closedLines]))}>{closed ? "운휴 중 — 다시 열기" : "운행 중 — 닫기"}</button>
              </div>
            );
          })}
        </div>
      </Frame>
    </div>
  );
}
