import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { PVP_JOKER } from "@fortuna/core";
import {
  autoPick, autoResolvePick, closePvpRoom, dealPvpRoom, friendlyError, heartbeat, joinPvpRoom, leavePvpRoom, offerReady, pickCard, pvpRefs,
  raiseCard, reconcileOrder, reorderHand, resolvePick, startPvpRoom, writeHand, type PvpRoomDoc,
} from "@fortuna/data";
import { usePlayer } from "../session/player.tsx";
import { useLiveDoc, useLiveQuery } from "../session/live.ts";
import { Coins, Frame, Notice, PageTitle, cx, useAction, useToast } from "../ui/kit.tsx";
import { PlayingCard } from "../ui/pieces.tsx";
import { celebrate, flash, shake } from "../fx/effects.ts";
import { cue } from "../fx/cues.ts";
import { Counter } from "../fx/Counter.tsx";
import { DealingAnimation, DiscardPile, DrawFlight, useHandFlip, type Direction, type Flight, type PilePair, type Rect } from "./motion.tsx";
import { claimOnce } from "./PvpLobby.tsx";
import "./pvp.css";

const EMOTES = ["😏", "😰", "😂", "🙏"];
const OFFLINE_MS = 25_000;

/** Seats around me: whoever I draw from sits on my left, then across, then right. */
function layout(order: string[], me: string): { pid: string; dir: Direction }[] {
  const index = Math.max(0, order.indexOf(me)), n = order.length;
  const others = Array.from({ length: n - 1 }, (_, step) => order[(index + 1 + step) % n] as string);
  const dirs: Direction[] = n === 2 ? ["top"] : n === 3 ? ["left", "right"] : ["left", "top", "right"];
  return others.map((pid, slot) => ({ pid, dir: dirs[slot] ?? "top" }));
}

export default function PvpRoomPage() {
  const { roomId = "" } = useParams();
  const { session, config } = usePlayer();
  const me = session.pid;
  const roomLive = useLiveDoc(pvpRefs.room(session.db, roomId), `pvp:room:${roomId}`);
  const handLive = useLiveDoc(pvpRefs.hand(session.db, roomId, me), `pvp:hand:${roomId}:${me}`);
  const presenceLive = useLiveQuery(pvpRefs.presences(session.db, roomId), `pvp:presence:${roomId}`);
  const room = roomLive.status === "ready" ? roomLive.data : null;
  const myOrder = handLive.status === "ready" ? handLive.data?.order : undefined;
  const presence = useMemo(() => new Map((presenceLive.status === "ready" ? presenceLive.data : []).map((row) => [row.id, row.data])), [presenceLive]);
  const [now, setNow] = useState(() => session.clock.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(session.clock.now()), 250); return () => window.clearInterval(timer); }, [session.clock]);

  const seated = Boolean(room?.seats[me]);
  const active = room && (room.status === "waiting" || room.status === "dealing" || room.status === "playing");

  // Heartbeat so others can see who is still at the table.
  useEffect(() => {
    if (!seated || !active) return undefined;
    void heartbeat(session, roomId).catch(() => undefined);
    const timer = window.setInterval(() => void heartbeat(session, roomId).catch(() => undefined), 10_000);
    return () => window.clearInterval(timer);
  }, [seated, active, roomId]);

  if (roomLive.status === "loading") return <Notice>방을 불러오는 중…</Notice>;
  if (!room) return <div><Notice tone="error">방을 찾을 수 없습니다.</Notice><Link to="/alley" className="btn btn-ghost mt-3 w-full">도박장으로</Link></div>;

  const venueLabel = room.venue === "house" ? "하우스" : "뒷골목";
  return (
    <div className="space-y-4">
      <PageTitle eyebrow={`${venueLabel} · 대결`} title="🃏 도둑잡기" line={`판돈 ${room.stake.toLocaleString("ko-KR")} · ${room.seatCount}/${room.maxSeats}명 · 1등이 판 전체를 가져갑니다`} />
      {room.status === "waiting" || room.status === "closed"
        ? <WaitingRoom room={room} roomId={roomId} now={now} presence={presence} />
        : <Table room={room} roomId={roomId} myOrder={myOrder} now={now} presence={presence} offerSeconds={config.pvp.offerSeconds} pickSeconds={config.pvp.pickSeconds} resolveSeconds={config.pvp.resolveSeconds} />}
      <Link to={room.venue === "house" ? "/house" : "/alley"} className="btn btn-ghost w-full">{venueLabel}으로</Link>
    </div>
  );
}

// ── 대기실 ──

function WaitingRoom({ room, roomId, now, presence }: { room: PvpRoomDoc; roomId: string; now: number; presence: Map<string, { lastSeen: { toMillis(): number } | null }> }) {
  const { session, config } = usePlayer();
  const { busy, run } = useAction();
  const me = session.pid, seated = Boolean(room.seats[me]), host = room.hostPid === me;
  const seats = Object.entries(room.seats).sort((a, b) => (a[1].joinedAt?.toMillis?.() ?? 0) - (b[1].joinedAt?.toMillis?.() ?? 0));
  const stale = room.createdAt && now - room.createdAt.toMillis() > config.pvp.abandonMinutes * 60_000;
  if (room.status === "closed") return <Notice>모두 나가서 닫힌 방입니다.</Notice>;
  return (
    <Frame>
      <p className="deco-caps text-center">대기실</p>
      <p className="deco-title my-2 text-center text-3xl"><Coins value={room.pot} /></p>
      <ul className="mt-3 grid grid-cols-2 gap-2">
        {Array.from({ length: room.maxSeats }, (_, slot) => {
          const seat = seats[slot];
          const online = seat ? now - (presence.get(seat[0])?.lastSeen?.toMillis() ?? 0) < OFFLINE_MS : false;
          return (
            <li key={slot} className={cx("rounded-sm border p-3 text-center", seat ? "border-gold-400/50" : "border-dashed border-gold-400/20 text-mist")}>
              {seat ? (<><p className="font-bold">{seat[1].name}{seat[0] === room.hostPid && <span className="chip chip-gold ml-1 !py-0 text-[0.65rem]">방장</span>}</p><p className="text-xs text-mist">{online ? "접속 중" : "자리 비움"}</p></>) : "빈 자리"}
            </li>
          );
        })}
      </ul>
      <div className="mt-4 grid gap-2">
        {host && <button type="button" className="btn btn-gold" disabled={busy || room.seatCount < 2} onClick={() => void run(() => startPvpRoom(session, roomId))}>{room.seatCount < 2 ? "상대를 기다리는 중…" : `${room.seatCount}명으로 시작`}</button>}
        {!seated && <JoinButton room={room} roomId={roomId} />}
        {seated && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void run(() => leavePvpRoom(session, roomId), "판돈을 돌려받았습니다.")}>나가기 (판돈 환불)</button>}
        {host && <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => { if (window.confirm("방을 닫을까요? 모두 판돈을 돌려받습니다.")) void run(() => closePvpRoom(session, roomId, "cancel")); }}>방 닫기</button>}
        {seated && !host && stale && <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => void run(() => closePvpRoom(session, roomId, "abandon"))}>오래된 방 정리 (전원 환불)</button>}
      </div>
    </Frame>
  );
}

function JoinButton({ room, roomId }: { room: PvpRoomDoc; roomId: string }) {
  const { session, wallet } = usePlayer();
  const { busy, run } = useAction();
  const blocked = wallet.room ? "이미 다른 방에 앉아 있습니다." : room.seatCount >= room.maxSeats ? "자리가 다 찼습니다." : wallet.balance < room.stake ? "판돈이 부족합니다." : null;
  if (blocked) return <Notice>{blocked}</Notice>;
  return <button type="button" className="btn btn-gold" disabled={busy} onClick={() => { cue("chip"); void run(() => joinPvpRoom(session, roomId)); }}>판돈 {room.stake.toLocaleString("ko-KR")} 걸고 앉기</button>;
}

// ── 테이블 ──

interface TableProps {
  room: PvpRoomDoc; roomId: string; myOrder: string[] | undefined; now: number;
  presence: Map<string, { lastSeen: { toMillis(): number } | null; emote: string | null; emoteAt: { toMillis(): number } | null; hover: number | null }>;
  offerSeconds: number; pickSeconds: number; resolveSeconds: number;
}

function Table({ room, roomId, myOrder, now, presence, offerSeconds, pickSeconds, resolveSeconds }: TableProps) {
  const { session } = usePlayer();
  const toast = useToast();
  const me = session.pid, order = room.order ?? Object.keys(room.seats), seated = order.includes(me);
  const mySeatIndex = Math.max(0, order.indexOf(me));
  const sets = room.sets ?? {};
  const turn = room.turn ?? null;
  const centerRef = useRef<HTMLDivElement>(null), tableRef = useRef<HTMLDivElement>(null);
  const others = layout(order, me);
  const dirOf = (pid: string): Direction => (pid === me ? "me" : others.find((entry) => entry.pid === pid)?.dir ?? "top");

  // ── 배분 연출: 이 화면에서 dealing → playing을 본 경우에만 ──
  const [dealing, setDealing] = useState(false);
  const lastStatus = useRef(room.status);
  useEffect(() => {
    if (lastStatus.current === "dealing" && room.status === "playing") setDealing(true);
    lastStatus.current = room.status;
  }, [room.status]);

  // ── 자동 진행: 배분, 내 패 순서 맞추기, 내가 뽑힐 때 카드 넘기기, 시간 초과 대행 ──
  useEffect(() => {
    if (room.status !== "dealing" || !seated) return undefined;
    const timer = window.setTimeout(() => void dealPvpRoom(session, roomId).catch(() => undefined), 500 + mySeatIndex * 400);
    return () => window.clearTimeout(timer);
  }, [room.status, seated]);

  const mySet = sets[me];
  useEffect(() => {
    if (!mySet || room.status !== "playing") return;
    const synced = myOrder && myOrder.length === mySet.length && myOrder.every((card) => mySet.includes(card));
    if (!synced) void writeHand(session, roomId, reconcileOrder(myOrder, mySet)).catch(() => undefined);
  }, [mySet?.join("|"), myOrder?.join("|"), room.status]);

  const pickKey = turn?.pick ? `${turn.pick.at?.toMillis?.() ?? "pending"}` : "";
  useEffect(() => {
    if (!turn?.pick || turn.target !== me || !turn.pick.at) return;
    void resolvePick(session, roomId).catch((error) => { if ((error as { code?: string }).code !== "hand-stale") toast("error", friendlyError(error)); });
  }, [pickKey, myOrder?.join("|")]);

  const offerDeadline = turn?.since ? turn.since.toMillis() + offerSeconds * 1000 : 0;
  const pickDeadline = offerDeadline + pickSeconds * 1000;
  const resolveDeadline = turn?.pick?.at ? turn.pick.at.toMillis() + resolveSeconds * 1000 : 0;
  // Stagger takeovers by seat so one client usually wins and the rest are refused quietly.
  const grace = 400 + mySeatIndex * 500;
  useEffect(() => {
    if (room.status !== "playing" || !turn || !seated) return;
    if (!turn.pick && now > pickDeadline + grace) void autoPick(session, roomId).catch(() => undefined);
    if (turn.pick?.at && turn.target !== me && now > resolveDeadline + grace) void autoResolvePick(session, roomId).catch(() => undefined);
  }, [Math.floor(now / 500)]);

  // ── 뽑힌 카드의 비행 ──
  const handRects = useRef(new Map<string, DOMRect>()), fanRects = useRef(new Map<number, DOMRect>());
  const [flight, setFlight] = useState<Flight | null>(null);
  const [pairOwners] = useState(() => new Map<number, string>());
  const moveKey = room.lastMove?.at?.toMillis?.() ?? 0;
  const seenMove = useRef(moveKey);
  const lastPick = useRef<number | null>(null);
  if (turn?.pick && turn.pick.index !== null) lastPick.current = turn.pick.index;
  useLayoutEffect(() => {
    const move = room.lastMove;
    if (!move || moveKey === seenMove.current) return;
    seenMove.current = moveKey;
    if (move.thrown.length) pairOwners.set((room.discards?.length ?? 2) / 2 - 1, move.actor);
    const involved = move.actor === me || move.target === me;
    const origin: Rect | null = move.target === me ? handRects.current.get(move.card) ?? null : lastPick.current !== null ? fanRects.current.get(lastPick.current) ?? null : null;
    setFlight({ key: String(moveKey), card: move.card, actor: move.actor, target: move.target, origin, centerReveal: involved, startFaceUp: move.target === me });
    if (move.actor === me && move.card === PVP_JOKER) window.setTimeout(() => { flash("ruby", 380); shake(tableRef.current, 5, 300); cue("wrong"); }, 900);
    else if (move.target === me && move.card === PVP_JOKER) window.setTimeout(() => { cue("perfect"); }, 600);
  }, [moveKey]);
  useLayoutEffect(() => {
    handRects.current = new Map([...document.querySelectorAll<HTMLElement>(".om-hand [data-card-id]")].map((element) => [element.dataset.cardId as string, element.getBoundingClientRect()]));
    fanRects.current = new Map([...document.querySelectorAll<HTMLElement>(".om-offer [data-fan-index]")].map((element) => [Number(element.dataset.fanIndex), element.getBoundingClientRect()]));
  });

  // While a card is in the air, keep it out of the actor's hand and its pair off the pile.
  const flying = flight ? room.lastMove : null;
  const discards = room.discards ?? [];
  const visibleDiscards = flying?.thrown.length ? discards.slice(0, discards.length - 2) : discards;
  const pairs: PilePair[] = Array.from({ length: Math.floor(visibleDiscards.length / 2) }, (_, index) => {
    const owner = pairOwners.get(index) ?? null;
    return { cards: [visibleDiscards[index * 2] as string, visibleDiscards[index * 2 + 1] as string], owner, dir: owner ? dirOf(owner) : null };
  });

  const finished = room.status === "finished" || room.status === "void";
  const meActor = turn?.actor === me, meTarget = turn?.target === me;
  const targetCount = turn ? (sets[turn.target]?.length ?? 0) : 0;
  const actorHover = turn ? presence.get(turn.actor)?.hover ?? null : null;
  const deadlineInfo = !turn ? null : turn.pick ? { label: "카드를 넘기는 중", until: resolveDeadline, total: resolveSeconds } : turn.offerReady || now > offerDeadline ? { label: "고르는 중", until: pickDeadline, total: pickSeconds } : { label: "패를 내미는 중", until: offerDeadline, total: offerSeconds };

  return (
    <div ref={tableRef} className="om-table">
      <div className="om-seats-top" style={{ "--om-top": others.length } as React.CSSProperties}>
        {others.map(({ pid }) => <SeatPanel key={pid} room={room} pid={pid} now={now} presence={presence} hidden={dealing} flyingTo={flying?.actor === pid} />)}
      </div>

      <div className="om-center" ref={centerRef}>
        <p className="om-center-copy">{centerCopy(room, me)}</p>
        {!dealing && <DiscardPile pairs={pairs} seed={roomId} />}
        {dealing && <DealingAnimation seats={order} cardCount={Object.values(sets).reduce((sum, hand) => sum + hand.length, 0) + discards.length} onComplete={() => setDealing(false)} />}
        {!dealing && room.status === "playing" && turn && !meTarget && (
          <OfferFan count={targetCount} raised={turn.raised} eyed={actorHover} canPick={meActor && !turn.pick && (turn.offerReady || now > offerDeadline)} picked={turn.pick?.index ?? null} roomId={roomId} />
        )}
      </div>

      {deadlineInfo && room.status === "playing" && (
        <div>
          <p className="mb-1 flex justify-between text-xs text-mist"><span>{room.seats[turn!.target]?.name} ← {room.seats[turn!.actor]?.name} · {deadlineInfo.label}</span><span className="num">{Math.max(0, Math.ceil((deadlineInfo.until - now) / 1000))}초</span></p>
          <div className="om-deadline"><i style={{ transform: `scaleX(${Math.max(0, Math.min(1, (deadlineInfo.until - now) / (deadlineInfo.total * 1000)))})` }} /></div>
        </div>
      )}

      {seated && <MyArea room={room} roomId={roomId} myOrder={myOrder} hiddenCard={flying?.actor === me ? flying.card : null} eyed={meTarget ? actorHover : null} dealing={dealing} />}

      {flight && <DrawFlight key={flight.key} flight={flight} centerRef={centerRef} onDone={() => setFlight(null)} />}
      {finished && !flight && <ResultPanel room={room} roomId={roomId} />}
    </div>
  );
}

function centerCopy(room: PvpRoomDoc, me: string): string {
  if (room.status === "dealing") return "카드를 나누는 중…";
  if (room.status === "void") return "무효가 된 판입니다. 판돈은 모두 돌려받습니다.";
  if (room.status === "finished") return "판이 끝났습니다.";
  const turn = room.turn;
  if (!turn) return "";
  const actor = room.seats[turn.actor]?.name ?? "", target = room.seats[turn.target]?.name ?? "";
  if (turn.actor === me) return turn.offerReady ? `${target}의 패에서 한 장을 고르세요` : `${target}이(가) 패를 내미는 중…`;
  if (turn.target === me) return `${actor}이(가) 당신의 패를 노립니다`;
  return `${actor} → ${target}`;
}

function SeatPanel({ room, pid, now, presence, hidden, flyingTo }: { room: PvpRoomDoc; pid: string; now: number; presence: TableProps["presence"]; hidden: boolean; flyingTo: boolean }) {
  const seat = room.seats[pid], count = room.sets?.[pid]?.length ?? 0, turn = room.turn;
  const info = presence.get(pid);
  const offline = now - (info?.lastSeen?.toMillis() ?? 0) > OFFLINE_MS;
  const emoteFresh = info?.emote && info.emoteAt && now - info.emoteAt.toMillis() < 2_400;
  const winner = room.status === "finished" && room.winners?.includes(pid);
  return (
    <div className="om-seat" data-seat={pid} data-active={turn?.actor === pid ? "actor" : turn?.target === pid ? "target" : undefined} data-offline={offline && room.status === "playing" ? "true" : undefined}>
      {emoteFresh && <span key={info.emoteAt!.toMillis()} className="om-emote" aria-label={`${seat?.name}의 반응`}>{info.emote}</span>}
      <p className="om-seat-name truncate">{winner && "👑 "}{seat?.name}</p>
      <p className="om-seat-meta">{offline && room.status === "playing" ? "연결 끊김" : hidden ? "…" : `${Math.max(0, count - (flyingTo ? 1 : 0))}장`}{turn?.target === pid && turn.reorders > 0 && ` · 섞음 ${turn.reorders}`}</p>
      {!hidden && <div className="om-mini-fan" aria-hidden="true">{Array.from({ length: Math.min(count, 9) }, (_, index) => <span key={index} />)}</div>}
    </div>
  );
}

/** The target's cards face down in the middle; the actor taps twice (or clicks) to draw. */
function OfferFan({ count, raised, eyed, canPick, picked, roomId }: { count: number; raised: number | null; eyed: number | null; canPick: boolean; picked: number | null; roomId: string }) {
  const { session } = usePlayer();
  const toast = useToast();
  const [inspected, setInspected] = useState<number | null>(null);
  const pointerKind = useRef("");
  const lastHover = useRef(0);
  function inspect(index: number | null) {
    setInspected(index);
    if (index !== null) cue("tap");
    if (Date.now() - lastHover.current > 300) { lastHover.current = Date.now(); void heartbeat(session, roomId, { hover: index }).catch(() => undefined); }
  }
  function draw(index: number) {
    cue("chip");
    void pickCard(session, roomId, index).catch((error) => toast("error", friendlyError(error)));
    void heartbeat(session, roomId, { hover: null }).catch(() => undefined);
  }
  return (
    <div className="om-offer">
      <div className="om-offer-hand">
        {Array.from({ length: count }, (_, index) => (
          <button
            type="button" key={index} data-fan-index={index} disabled={!canPick} data-raised={raised === index || picked === index ? "true" : undefined} data-eyed={!canPick && eyed === index ? "true" : undefined}
            className={cx("om-offer-card", inspected === index && "inspected")}
            aria-label={`${index + 1}번째 카드${canPick ? (inspected === index ? ", 한 번 더 누르면 뽑기" : ", 뽑기") : ""}`}
            onPointerEnter={(event) => { if (canPick && event.pointerType === "mouse") inspect(index); }}
            onPointerLeave={(event) => { if (canPick && event.pointerType === "mouse") inspect(null); }}
            onPointerDown={(event) => {
              if (!canPick) return;
              pointerKind.current = event.pointerType;
              if (event.pointerType === "mouse") return;
              event.preventDefault();
              if (inspected === index) draw(index); else inspect(index);
            }}
            onClick={() => {
              if (!canPick) return;
              if (pointerKind.current && pointerKind.current !== "mouse") { pointerKind.current = ""; return; }
              pointerKind.current = "";
              draw(index);
            }}
          ><PlayingCard id={null} /></button>
        ))}
      </div>
    </div>
  );
}

/** My hand: rearrange privately, hold a card up as a bluff, and offer it when I am the one being drawn from. */
function MyArea({ room, roomId, myOrder, hiddenCard, eyed, dealing }: { room: PvpRoomDoc; roomId: string; myOrder: string[] | undefined; hiddenCard: string | null; eyed: number | null; dealing: boolean }) {
  const { session } = usePlayer();
  const toast = useToast();
  const me = session.pid, turn = room.turn, set = room.sets?.[me] ?? [];
  const order = (myOrder ?? set).filter((card) => set.includes(card)).concat(set.filter((card) => !(myOrder ?? set).includes(card)));
  const handRef = useRef<HTMLDivElement>(null);
  useHandFlip(handRef, order.join("|"));
  const [mode, setMode] = useState<"none" | "move" | "raise">("none");
  const [selected, setSelected] = useState<number | null>(null);
  const meTarget = room.status === "playing" && turn?.target === me && !turn.pick;
  const reordersLeft = meTarget ? 3 - (turn?.reorders ?? 0) : Infinity;
  const won = room.status === "finished" && room.winners?.includes(me);

  async function tapCard(index: number) {
    cue("tap");
    if (mode === "raise" && meTarget) { await raiseCard(session, roomId, turn?.raised === index ? null : index).catch((error) => toast("error", friendlyError(error))); return; }
    if (mode !== "move") return;
    if (selected === null) { setSelected(index); return; }
    if (selected !== index) {
      const next = [...order], [card] = next.splice(selected, 1);
      next.splice(index, 0, card as string);
      const write = meTarget ? reorderHand(session, roomId, next, turn?.reorders ?? 0) : writeHand(session, roomId, next);
      await write.catch((error) => toast("error", friendlyError(error)));
    }
    setSelected(null);
    if (meTarget && reordersLeft <= 1) setMode("none");
  }

  return (
    <section className="deco-frame p-3" data-seat={me}>
      <div className="flex items-center justify-between text-sm">
        <span className="font-bold">{won && "👑 "}내 패 <span className="num text-gold-200">{dealing ? "…" : set.length}</span>장</span>
        <span className="flex gap-1">{EMOTES.map((emote) => <button key={emote} type="button" className="rounded px-1 text-lg transition active:scale-90" aria-label={`반응 ${emote}`} onClick={() => void heartbeat(session, roomId, { emote }).catch(() => undefined)}>{emote}</button>)}</span>
      </div>
      {!dealing && (
        <div className="om-hand" ref={handRef}>
          {order.map((card, index) => (
            <button
              key={card} type="button" data-card-id={card} className="om-hand-card" onClick={() => void tapCard(index)}
              data-raised={meTarget && turn?.raised === index ? "true" : undefined} data-selected={selected === index ? "true" : undefined}
              data-eyed={eyed === index ? "true" : undefined} data-joker={card === PVP_JOKER ? "true" : undefined}
              style={card === hiddenCard ? { opacity: 0 } : undefined} aria-label={`${index + 1}번째 카드`}
            ><PlayingCard id={card} /></button>
          ))}
        </div>
      )}
      {meTarget && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          <button type="button" className={cx("btn btn-sm", mode === "move" ? "btn-gold" : "btn-dark")} disabled={reordersLeft <= 0} onClick={() => { setMode(mode === "move" ? "none" : "move"); setSelected(null); }}>섞기 {Math.max(0, reordersLeft)}/3</button>
          <button type="button" className={cx("btn btn-sm", mode === "raise" ? "btn-gold" : "btn-dark")} onClick={() => setMode(mode === "raise" ? "none" : "raise")}>내밀기</button>
          <button type="button" className="btn btn-gold btn-sm" disabled={turn?.offerReady} onClick={() => { cue("chip"); setMode("none"); void offerReady(session, roomId).catch((error) => toast("error", friendlyError(error))); }}>{turn?.offerReady ? "내밀었음" : "이대로 내밀기"}</button>
        </div>
      )}
      {meTarget && mode !== "none" && <p className="mt-1 text-center text-xs text-mist">{mode === "move" ? (selected === null ? "옮길 카드를 누르세요" : "놓을 자리를 누르세요") : "들어 올릴 카드를 누르세요 (모두에게 보입니다)"}</p>}
      {!meTarget && room.status === "playing" && <button type="button" className={cx("btn btn-ghost btn-sm mt-2 w-full", mode === "move" && "!border-gold-300")} onClick={() => { setMode(mode === "move" ? "none" : "move"); setSelected(null); }}>{mode === "move" ? "정리 끝" : "패 정리하기"}</button>}
    </section>
  );
}

function ResultPanel({ room, roomId }: { room: PvpRoomDoc; roomId: string }) {
  const { session, notify } = usePlayer();
  const me = session.pid;
  const [claimed, setClaimed] = useState<{ amount: number; kind: string } | null>(null);
  const reacted = useRef(false);
  useEffect(() => {
    if (room.claimed?.[me] || !room.seats[me]) return;
    void claimOnce(session, roomId, notify.relayUrl).then((result) => { if (result) setClaimed(result); });
  }, [room.status]);
  const won = room.status === "finished" && room.winners?.includes(me);
  useEffect(() => {
    if (reacted.current || room.status !== "finished") return;
    reacted.current = true;
    if (won) { celebrate(room.winners!.length > 1 ? 2 : 3); cue("bigWin"); } else cue("lose");
  }, [room.status]);
  const names = (pids: string[] = []) => pids.map((pid) => room.seats[pid]?.name ?? "").join(", ");
  const net = won ? (room.share ?? 0) - room.stake : -room.stake;
  return (
    <Frame className="slide-in-top text-center">
      {room.status === "void" ? (
        <><p className="deco-title text-2xl">무효</p><p className="mt-1 text-sm text-mist">판돈 {room.stake.toLocaleString("ko-KR")}을 돌려받았습니다.</p></>
      ) : (
        <>
          <p className="deco-caps">WINNER TAKES ALL</p>
          <p className={cx("deco-title mt-1 text-3xl", won ? "shimmer-text" : "")}>{won ? "1등!" : `${names(room.winners)} 승리`}</p>
          <p className={cx("mt-2 text-3xl font-bold", won ? "text-[#a9ecc9]" : "text-[#f2b3aa]")}>{net > 0 ? "+" : "−"}<Counter value={Math.abs(net)} /></p>
          <p className="mt-2 text-sm text-mist">판 전체 {room.pot.toLocaleString("ko-KR")}{room.rake ? ` · 지배인 몫 ${room.rake.toLocaleString("ko-KR")}` : ""}</p>
          <p className="mt-1 text-sm">🃏 조커는 <b className="text-[#f2b3aa]">{room.seats[room.jokerHolder ?? ""]?.name}</b>의 손에 남았습니다</p>
        </>
      )}
      {claimed === null && !room.claimed?.[me] && <p className="mt-2 text-xs text-mist">정산 중…</p>}
      <Link to={room.venue === "house" ? "/house" : "/alley"} className="btn btn-gold mt-4 w-full">새 판 찾기</Link>
    </Frame>
  );
}
