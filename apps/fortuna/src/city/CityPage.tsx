import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { LINES, STATIONS, type PlaceId } from "@fortuna/core";
import { cityHeartbeat, markRead, moveTo, placeChannel } from "@fortuna/data";
import { usePlayer } from "../session/player.tsx";
import { cue } from "../fx/cues.ts";
import { Splash, cx, useToast } from "../ui/kit.tsx";
import { ChatPanel, PAGE, type ChatIdentity } from "./Chat.tsx";
import { CharacterMaker } from "./CharacterMaker.tsx";
import { LineMap, type StopInfo } from "./LineMap.tsx";
import { SceneCard } from "./SceneCard.tsx";
import { SkillSheet } from "./SkillSheet.tsx";
import { ContestPanel, Presence, Records } from "./Stage.tsx";
import {
  AWAY_MS, CityLookupProvider, useActivities, useLookups, useActors, useCityData, useMessages, useOpenContest, useReads, useScene, useTicker, type ActorRow,
} from "./useCity.ts";
import "./city.css";

/** 도시 2판: 노선도에서 역을 고르고, 장면 카드 아래에서 이야기한다. docs/SPEC-CITY-MAP.md */
export default function CityPage() {
  const { session } = usePlayer();
  const { ready, actors } = useActors();
  const me = actors.find((row) => row.id === session.pid) ?? null;
  const [editing, setEditing] = useState(false);
  if (!ready) return <Splash line="노선도를 펼치는 중…" />;
  if (!me || editing) return <div className="px-4 pb-10 pt-5"><CharacterMaker existing={me?.data ?? null} onDone={() => setEditing(false)} /></div>;
  return <CityView me={me} actors={actors} onEdit={() => setEditing(true)} />;
}

type View = "scene" | "map" | "log";

function CityView({ me, actors, onEdit }: { me: ActorRow; actors: ActorRow[]; onEdit: () => void }) {
  const { session, player } = usePlayer();
  const now = useTicker(15_000);
  const data = useCityData(now);
  const [params, setParams] = useSearchParams();
  const view = (["map", "log"].includes(params.get("v") ?? "") ? params.get("v") : "scene") as View;
  const go = (next: View) => setParams(next === "scene" ? {} : { v: next });
  const byId = useMemo(() => new Map(actors.map((row) => [row.id, row])), [actors]);
  const names = useMemo(() => new Map(actors.filter((row) => row.id !== me.id).map((row) => [row.id, row.data.name])), [actors, me.id]);

  // Present while the page is open and visible.
  useEffect(() => {
    const beat = () => { if (document.visibilityState === "visible") void cityHeartbeat(session).catch(() => undefined); };
    beat();
    const timer = window.setInterval(beat, 60_000);
    document.addEventListener("visibilitychange", beat);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", beat); };
  }, []);

  const identity: ChatIdentity = {
    kind: "player", session, name: player.name,
    skills: Object.entries(player.skills).map(([id, entry]) => ({ id, name: entry.name })),
    onSkill: () => undefined,
  };

  return (
    <CityLookupProvider value={{ actors: byId, data }}>
      {view === "map" ? <MapView me={me} actors={actors} onArrive={() => go("scene")} onBack={() => go("scene")} />
        : view === "log" ? (
          <div className="city-shell overflow-y-auto">
            <div className="w-full">
              <div className="flex items-center gap-2 px-4 pt-3"><button type="button" className="city-btn" onClick={() => go("scene")}>← 장면으로</button></div>
              <Records identity={identity} names={new Map(actors.map((row) => [row.id, row.data.name]))} />
            </div>
          </div>
        )
        : <SceneView me={me} actors={actors} nowMs={now} identity={identity} names={names} onMap={() => go("map")} onLog={() => go("log")} onEdit={onEdit} />}
    </CityLookupProvider>
  );
}

function SceneView({ me, actors, nowMs, identity, names, onMap, onLog, onEdit }: {
  me: ActorRow; actors: ActorRow[]; nowMs: number; identity: ChatIdentity; names: Map<string, string>; onMap: () => void; onLog: () => void; onEdit: () => void;
}) {
  const { session } = usePlayer();
  const place = me.data.place;
  const { data } = useLookups();
  const scene = useScene(place);
  const contest = useOpenContest(place);
  const recent = useMessages(placeChannel(place), PAGE).messages;
  const here = actors.filter((row) => row.data.place === place && nowMs - row.seenMs < 6 * 60 * 60_000);
  const [tall, setTall] = useState(false);
  const [skill, setSkill] = useState<{ skillId: string; usedLevel: number } | null | undefined>(undefined);
  const image = scene?.imageId ? data.images.get(scene.imageId) ?? null : null;

  // Reading the place counts as having read it (and visited it).
  const lastRead = useRef(0);
  const newest = recent.at(-1)?.atMs ?? 0;
  useEffect(() => {
    if (Date.now() - lastRead.current < 20_000 && newest) return;
    lastRead.current = Date.now();
    void markRead(session, place).catch(() => undefined);
  }, [place, newest]);

  const sceneIdentity: ChatIdentity = identity.kind === "player" ? { ...identity, onSkill: (prefill) => setSkill(prefill ?? null) } : identity;

  return (
    <div className={cx("city-shell", tall && "city-chat-tall")}>
      <div className="city-stage">
        <SceneCard place={place} scene={scene} image={image} compact={tall}>
          <div className="absolute right-3 top-3 z-10 flex gap-1.5">
            <button type="button" className="city-btn" onClick={onLog} aria-label="기록과 명장면">★</button>
            <button type="button" className="city-btn" onClick={onEdit} aria-label="모습 꾸미기">✎</button>
            <button type="button" className="city-btn md:hidden" onClick={() => setTall((value) => !value)} aria-label={tall ? "장면 크게" : "채팅 크게"}>{tall ? "▼" : "▲"}</button>
          </div>
          <button type="button" className="city-btn absolute left-3 top-3 z-10 gap-1" onClick={() => { cue("flip"); onMap(); }}>
            <span aria-hidden="true">◎</span> 노선도
          </button>
        </SceneCard>
        {data.session && <p className="shrink-0 bg-gold-400/10 px-3 py-1 text-center text-[0.72rem] text-gold-200">세션 진행 중 · {data.session.title}</p>}
        <Presence here={here} npcIds={scene?.npcs ?? []} recent={recent} nowMs={nowMs} meId={me.id} />
        {contest && <ContestPanel contest={contest} />}
      </div>
      <div className="city-chat">
        <ChatPanel identity={sceneIdentity} place={place} sessionId={data.session?.id ?? null} contestId={contest?.id ?? null} people={names} />
      </div>
      {skill !== undefined && <SkillSheet open onClose={() => setSkill(undefined)} prefill={skill} place={place} sessionId={data.session?.id ?? null} contestId={contest?.id ?? null} />}
    </div>
  );
}

function MapView({ me, actors, onArrive, onBack }: { me: ActorRow; actors: ActorRow[]; onArrive: () => void; onBack: () => void }) {
  const { session } = usePlayer();
  const toast = useToast();
  const now = useTicker(30_000);
  const { data } = useLookups();
  const activity = useActivities();
  const reads = useReads(session.pid);
  const [selected, setSelected] = useState<PlaceId | null>(null);
  const [moving, setMoving] = useState(false);
  const here = me.data.place;

  const info = useMemo(() => {
    const map = new Map<PlaceId, StopInfo>();
    for (const id of Object.keys(STATIONS) as PlaceId[]) {
      const act = activity.get(id), read = reads.get(id);
      map.set(id, { people: 0, unread: Boolean(act && id !== here && act.lastMs > (read ?? 0) && act.lastName !== me.data.name), visited: read !== undefined });
    }
    for (const row of actors) if (now - row.seenMs < AWAY_MS * 10) { const stop = map.get(row.data.place); if (stop) stop.people += 1; }
    return map;
  }, [activity, reads, actors, here, now]);

  const pick = selected ? STATIONS[selected] : null;
  const closed = pick ? data.closedLines.has(pick.line) && pick.id !== here : false;
  const people = pick ? actors.filter((row) => row.data.place === pick.id) : [];

  async function travel(place: PlaceId) {
    setMoving(true);
    try {
      cue("bell");
      await moveTo(session, place);
      void markRead(session, place).catch(() => undefined);
      onArrive();
    } catch { toast("error", "기차를 타지 못했습니다. 잠시 후 다시 시도해 주십시오."); }
    finally { setMoving(false); }
  }

  return (
    <div className="city-shell">
      <div className="relative min-h-0 flex-1">
        <LineMap here={here} info={info} closed={data.closedLines} onPick={(id) => { cue("tap"); setSelected(id); }} selected={selected} />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-2">
          <button type="button" className="city-btn pointer-events-auto" onClick={onBack}>← {STATIONS[here].name}</button>
          <p className="city-plate text-[0.7rem] text-mist">● 가 본 역 · <span className="text-[#e5484d]">●</span> 새 이야기 · 숫자 = 사람</p>
        </div>
      </div>
      {pick && (
        <div className="shrink-0 border-t border-gold-400/40 bg-felt-950 p-3 md:absolute md:bottom-4 md:right-4 md:w-96 md:rounded-sm md:border">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="deco-caps text-[0.6rem]" style={{ color: LINES[pick.line].light }}>{LINES[pick.line].name}</p>
              <p className="deco-title text-xl">{pick.name}</p>
            </div>
            <button type="button" className="text-mist" aria-label="닫기" onClick={() => setSelected(null)}>✕</button>
          </div>
          <p className="mt-1 text-sm italic text-ivory/80">{pick.sense}</p>
          <p className="mt-1 text-xs text-mist">{people.length ? `여기 있는 사람: ${people.map((row) => row.data.name).join(", ")}` : "지금은 아무도 없다."}</p>
          <button type="button" className="btn btn-gold mt-3 w-full" disabled={moving || closed}
            onClick={() => (pick.id === here ? onArrive() : void travel(pick.id))}>
            {pick.id === here ? "이 역에 있다 — 장면으로" : closed ? "운휴 중인 노선" : moving ? "기차가 출발하는 중…" : "이 역으로 가기"}
          </button>
        </div>
      )}
    </div>
  );
}
