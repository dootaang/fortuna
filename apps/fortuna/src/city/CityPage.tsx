import { useEffect, useMemo, useRef, useState } from "react";
import { PLACES, TILE, exitAt, gridOf, mapSize, resolveTarget, walkPose, type Cell, type Exit, type PlaceId } from "@fortuna/core";
import { enterPlace, placeChannel, walkTo } from "@fortuna/data";
import { usePlayer } from "../session/player.tsx";
import { cue } from "../fx/cues.ts";
import { Splash, cx, useToast } from "../ui/kit.tsx";
import { ChatPanel } from "./Chat.tsx";
import { CharacterMaker } from "./CharacterMaker.tsx";
import { sceneOf, type SceneActor } from "./scene.ts";
import { walkFrame } from "./sprites.ts";
import { AWAY_MS, BUBBLE_MS, useActorMap, useActors, useCityHeartbeat, useMessages, useTicker, type ActorRow, type MessageRow } from "./useCity.ts";
import "./city.css";

/** 도시: 도트 지도 위를 걸어 다니며 RP. docs/SPEC-CITY-MAP.md */
export default function CityPage() {
  const { session } = usePlayer();
  const { ready, actors } = useActors();
  const me = actors.find((row) => row.id === session.pid) ?? null;
  const [editing, setEditing] = useState(false);
  if (!ready) return <Splash line="도시 지도를 펼치는 중…" />;
  if (!me || editing) return <div className="px-4 pb-10 pt-5"><CharacterMaker existing={me?.data ?? null} onDone={() => setEditing(false)} /></div>;
  return <CityView me={me} actors={actors} onEdit={() => setEditing(true)} />;
}

function CityView({ me, actors, onEdit }: { me: ActorRow; actors: ActorRow[]; onEdit: () => void }) {
  const { session } = usePlayer();
  const toast = useToast();
  const place = me.data.place;
  const here = actors.filter((row) => row.data.place === place);
  const byId = useActorMap(actors);
  const bubbles = useMessages(placeChannel(place), 8).messages;
  const now = useTicker(15_000);
  const [chatTall, setChatTall] = useState(false);
  useCityHeartbeat(true);

  async function walk(from: Cell, tapped: Cell) {
    const target = resolveTarget(gridOf(place), from, tapped);
    if (target[0] === from[0] && target[1] === from[1]) return;
    cue("tap");
    await walkTo(session, from, target).catch(() => toast("error", "걸음을 옮기지 못했습니다. 잠시 후 다시 시도해 주세요."));
  }

  async function exit(door: Exit) {
    cue("flip");
    await enterPlace(session, door.to, door.at).catch(() => toast("error", "문을 열지 못했습니다."));
  }

  return (
    <div className={cx("city-shell", chatTall && "city-chat-tall")}>
      <div className="city-map relative">
        <MapView place={place} rows={here} meId={me.id} bubbles={bubbles} onWalk={walk} onExit={exit} />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2">
          <div className="city-plate pointer-events-auto">
            <p className="deco-caps text-[0.58rem]">{PLACES[place].district}</p>
            <p className="deco-title text-base leading-tight">{PLACES[place].name}</p>
          </div>
          <div className="city-plate pointer-events-auto max-w-[45%] text-right">
            <p className="text-[0.65rem] text-mist">여기 있는 사람</p>
            <p className="text-xs leading-snug">
              {here.map((row, index) => (
                <span key={row.id} className={cx(now - row.seenMs > AWAY_MS && "opacity-50", row.id === me.id && "text-gold-200")}>
                  {index ? ", " : ""}{row.data.name}
                </span>
              ))}
            </p>
          </div>
        </div>
        <div className="absolute bottom-2 right-2 flex flex-col gap-1">
          <button type="button" className="city-btn" onClick={onEdit} aria-label="모습 고치기">✂</button>
          <button type="button" className="city-btn md:hidden" onClick={() => setChatTall((value) => !value)} aria-label={chatTall ? "지도 크게" : "채팅 크게"}>{chatTall ? "▼" : "▲"}</button>
        </div>
      </div>
      <div className="city-chat flex min-h-0 flex-col">
        <ChatPanel place={place} actors={byId} />
      </div>
    </div>
  );
}

function MapView({ place, rows, meId, bubbles, onWalk, onExit }: {
  place: PlaceId; rows: ActorRow[]; meId: string; bubbles: MessageRow[];
  onWalk: (from: Cell, to: Cell) => void; onExit: (exit: Exit) => void;
}) {
  const { session } = usePlayer();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(() => (window.innerWidth < 640 ? 2 : 3));
  const live = useRef({ rows, bubbles, place, zoom, onWalk, onExit });
  live.current = { rows, bubbles, place, zoom, onWalk, onExit };
  const camera = useRef<{ x: number; y: number } | null>(null);
  const follow = useRef(true);
  const myCell = useRef<Cell>([0, 0]);
  const handledExit = useRef("");
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);

  useEffect(() => { camera.current = null; follow.current = true; }, [place]);

  useEffect(() => {
    let frameId = 0;
    const tick = () => {
      frameId = requestAnimationFrame(tick);
      const el = canvas.current, container = box.current;
      if (!el || !container) return;
      const dpr = Math.min(3, window.devicePixelRatio || 1), cssW = container.clientWidth, cssH = container.clientHeight;
      if (el.width !== Math.round(cssW * dpr) || el.height !== Math.round(cssH * dpr)) { el.width = Math.round(cssW * dpr); el.height = Math.round(cssH * dpr); }
      const ctx = el.getContext("2d");
      if (!ctx) return;
      const { rows: current, bubbles: said, place: id, zoom: z } = live.current;
      const scene = sceneOf(id), grid = gridOf(id), now = session.clock.now();
      const recent = new Map<string, string>();
      for (const message of said) if ((message.data.kind === "say" || message.data.kind === "act") && !message.data.deleted && now - message.atMs < BUBBLE_MS) recent.set(message.data.authorId, (message.data.kind === "act" ? `*${message.data.text}*` : message.data.text).split("\n")[0]!);
      let mine: SceneActor | null = null;
      const actors = current.map((row): SceneActor => {
        const d = row.data, pose = walkPose(grid, id, [d.fx, d.fy], [d.tx, d.ty], now - row.atMs);
        const actor: SceneActor = {
          id: row.id, name: d.name, sprite: d.sprite, x: pose.x, y: pose.y, facing: pose.facing, frame: walkFrame(pose.step, pose.moving),
          away: now - row.seenMs > AWAY_MS, me: row.id === meId, bubble: recent.get(row.id) ?? null,
        };
        if (actor.me) {
          mine = actor; myCell.current = pose.cell;
          const door = pose.arrived ? exitAt(PLACES[id], pose.cell[0], pose.cell[1]) : null;
          const key = `${id}:${row.atMs}:${pose.cell}`;
          if (door && handledExit.current !== key) { handledExit.current = key; live.current.onExit(door); }
        }
        return actor;
      });
      // Camera: follow my character smoothly, never show past the map edge.
      const { width, height } = mapSize(PLACES[id]), worldW = width * TILE, worldH = height * TILE;
      const viewW = cssW / z, viewH = cssH / z;
      const me = mine as SceneActor | null;
      const target = me && follow.current ? { x: me.x * TILE + 8, y: me.y * TILE } : camera.current ?? { x: worldW / 2, y: worldH / 2 };
      const cam = camera.current ?? { ...target };
      if (follow.current) { cam.x += (target.x - cam.x) * 0.18; cam.y += (target.y - cam.y) * 0.18; }
      cam.x = worldW <= viewW ? worldW / 2 : Math.min(worldW - viewW / 2, Math.max(viewW / 2, cam.x));
      cam.y = worldH <= viewH ? worldH / 2 : Math.min(worldH - viewH / 2, Math.max(viewH / 2, cam.y));
      camera.current = cam;
      scene.draw(ctx, { x: cam.x, y: cam.y, scale: z * dpr, dpr }, el.width, el.height, now, actors);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [meId]);

  function tileAt(clientX: number, clientY: number): Cell | null {
    const el = canvas.current, cam = camera.current;
    if (!el || !cam) return null;
    const rect = el.getBoundingClientRect();
    const wx = cam.x + (clientX - rect.left - rect.width / 2) / zoom, wy = cam.y + (clientY - rect.top - rect.height / 2) / zoom;
    const { width, height } = mapSize(PLACES[place]);
    const x = Math.floor(wx / TILE), y = Math.floor(wy / TILE);
    return x >= 0 && y >= 0 && x < width && y < height ? [x, y] : null;
  }

  return (
    <div ref={box} className="absolute inset-0 touch-none select-none">
      <canvas
        ref={canvas} className="pixelated block h-full w-full cursor-pointer" role="img" aria-label={`${PLACES[place].name} 지도. 누르면 그곳으로 걸어간다.`}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); const cam = camera.current; drag.current = { x: event.clientX, y: event.clientY, cx: cam?.x ?? 0, cy: cam?.y ?? 0, moved: false }; }}
        onPointerMove={(event) => {
          const d = drag.current;
          if (!d) return;
          const dx = event.clientX - d.x, dy = event.clientY - d.y;
          if (!d.moved && Math.hypot(dx, dy) > 8) { d.moved = true; follow.current = false; }
          if (d.moved && camera.current) { camera.current.x = d.cx - dx / zoom; camera.current.y = d.cy - dy / zoom; }
        }}
        onPointerUp={(event) => {
          const d = drag.current;
          drag.current = null;
          if (!d || d.moved) return;
          const tile = tileAt(event.clientX, event.clientY);
          if (!tile) return;
          follow.current = true;
          onWalk(myCell.current, tile);
        }}
        onPointerCancel={() => { drag.current = null; }}
      />
      <div className="absolute bottom-2 left-2 flex gap-1">
        <button type="button" className="city-btn" aria-label="축소" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value - 1))}>−</button>
        <button type="button" className="city-btn" aria-label="확대" disabled={zoom >= 4} onClick={() => setZoom((value) => Math.min(4, value + 1))}>＋</button>
        <button type="button" className="city-btn" aria-label="내 캐릭터로" onClick={() => { follow.current = true; }}>◎</button>
      </div>
    </div>
  );
}
