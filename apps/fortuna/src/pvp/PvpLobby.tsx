import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { query, where } from "firebase/firestore";
import type { Venue } from "@fortuna/core";
import { claimPvp, createPvpRoom, pvpRefs } from "@fortuna/data";
import { usePlayer } from "../session/player.tsx";
import { useLiveDoc, useLiveQuery } from "../session/live.ts";
import { Coins, Frame, Notice, cx, useAction } from "../ui/kit.tsx";
import { cue } from "../fx/cues.ts";
import { relay } from "../relay.ts";

/** Open PvP rooms for a venue, plus a form to open one. */
export function PvpLobby({ venue }: { venue: Venue }) {
  const { session, wallet, config } = usePlayer();
  const rooms = useLiveQuery(query(pvpRefs.rooms(session.db), where("status", "in", ["waiting", "dealing", "playing"])), "pvp:lobby");
  const list = (rooms.status === "ready" ? rooms.data : []).filter((row) => row.data.venue === venue).sort((a, b) => (a.data.status === "waiting" ? 0 : 1) - (b.data.status === "waiting" ? 0 : 1) || (b.data.createdAt?.toMillis() ?? 0) - (a.data.createdAt?.toMillis() ?? 0));
  const [open, setOpen] = useState(false);
  if (!config.pvp.enabled) return null;
  return (
    <section className="mt-6">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h2 className="deco-title text-xl">🃏 대결 · 도둑잡기</h2>
          <p className="text-xs text-mist">다른 승객과 겨룹니다. 1등이 판 전체를 가져갑니다. 하루 횟수를 쓰지 않습니다.</p>
        </div>
        {!wallet.room && <button type="button" className={cx("btn btn-sm", open ? "btn-ghost" : "btn-gold")} onClick={() => setOpen(!open)}>{open ? "닫기" : "방 만들기"}</button>}
      </div>
      {wallet.room && <Link to={`/pvp/${wallet.room}`} className="mb-3 block"><Notice>앉아 있는 대결 판이 있습니다. 눌러서 돌아가기</Notice></Link>}
      {open && !wallet.room && <CreateRoom venue={venue} onClose={() => setOpen(false)} />}
      {list.length === 0 ? <p className="py-4 text-center text-sm text-mist">열린 판이 없습니다. 먼저 판을 열어 보세요.</p> : (
        <ul className="grid gap-2">
          {list.map(({ id, data }) => (
            <li key={id}>
              <Link to={`/pvp/${id}`} className="block">
                <Frame as="div" className="flex items-center justify-between gap-3 !p-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold">{data.seats[data.hostPid]?.name ?? "?"}의 판</p>
                    <p className="text-xs text-mist">{Object.values(data.seats).map((seat) => seat.name).join(", ")}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p><Coins value={data.stake} /></p>
                    <p className={cx("text-xs", data.status === "waiting" ? "text-[#a9ecc9]" : "text-mist")}>{data.status === "waiting" ? `${data.seatCount}/${data.maxSeats} 대기 중` : "진행 중"}</p>
                  </div>
                </Frame>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CreateRoom({ venue, onClose }: { venue: Venue; onClose: () => void }) {
  const { session, wallet, config, notify } = usePlayer();
  const { busy, run } = useAction();
  const navigate = useNavigate();
  const max = venue === "house" ? config.pvp.houseMaxStake : config.pvp.alleyMaxStake, min = config.pvp.minStake;
  const [stake, setStake] = useState(Math.min(max, Math.max(min, Math.round(max / 2))));
  const [seats, setSeats] = useState(4);
  const rake = venue === "house" ? config.pvp.houseRakeBps : config.pvp.alleyRakeBps;
  return (
    <Frame className="mb-3">
      <p className="field-label">판돈</p>
      <p className="deco-title text-center text-3xl"><Coins value={stake} /></p>
      <input type="range" className="w-full accent-[var(--color-gold-400)]" min={min} max={Math.min(max, Math.max(min, wallet.balance))} step={min} value={stake} onChange={(event) => setStake(Number(event.target.value))} aria-label="판돈" />
      <p className="field-label mt-3">인원</p>
      <div className="grid grid-cols-3 gap-2">
        {[2, 3, 4].map((count) => <button key={count} type="button" className={cx("btn btn-sm", seats === count ? "btn-gold" : "btn-dark")} onClick={() => setSeats(count)}>{count}명</button>)}
      </div>
      <p className="mt-3 text-center text-xs text-mist">다 차면 1등이 <Coins value={stake * seats - Math.floor((stake * seats * rake) / 10_000)} />{rake ? ` (지배인 몫 ${rake / 100}% 제외)` : ""}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-ghost" onClick={onClose}>취소</button>
        <button type="button" className="btn btn-gold" disabled={busy || stake > wallet.balance} onClick={() => { cue("chip"); void run(() => createPvpRoom(session, { venue, stake, maxSeats: seats })).then((created) => { if (!created) return; relay(notify.relayUrl, created.ledgerId); navigate(`/pvp/${created.roomId}`); }); }}>판 열기</button>
      </div>
    </Frame>
  );
}

const claiming = new Map<string, Promise<{ amount: number; kind: string; ledgerId: string } | null>>();

/** One settlement attempt per room at a time, shared by the result panel and the background claim. */
export function claimOnce(session: Parameters<typeof claimPvp>[0], roomId: string, relayUrl = ""): Promise<{ amount: number; kind: string; ledgerId: string } | null> {
  const running = claiming.get(roomId);
  if (running) return running;
  const attempt = claimPvp(session, roomId)
    .then((result) => { if (result.kind === "win") relay(relayUrl, result.ledgerId); return result; })
    .catch(() => null).finally(() => claiming.delete(roomId));
  claiming.set(roomId, attempt);
  return attempt;
}

/** Settle a finished or voided room the player is still seated in (e.g. they left before the end). */
export function useAutoClaim() {
  const { session, wallet, notify } = usePlayer();
  const roomId = wallet.room ?? null;
  const room = useLiveDoc(roomId ? pvpRefs.room(session.db, roomId) : null, `pvp:auto:${roomId}`);
  const status = room.status === "ready" ? room.data?.status : undefined;
  const claimed = room.status === "ready" ? Boolean(room.data?.claimed?.[session.pid]) : false;
  useEffect(() => {
    if (!roomId || claimed || (status !== "finished" && status !== "void")) return;
    void claimOnce(session, roomId, notify.relayUrl);
  }, [roomId, status, claimed]);
}
