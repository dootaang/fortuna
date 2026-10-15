import { useState } from "react";
import { STATIONS, type PlaceId } from "@fortuna/core";
import { sessionLog, type ContestDoc } from "@fortuna/data";
import { db } from "../firebase.ts";
import { cx, formatDate, useAction } from "../ui/kit.tsx";
import { MessageItem, channelLabel, type ChatIdentity } from "./Chat.tsx";
import { ActorFace, NpcFace } from "./SceneCard.tsx";
import { AWAY_MS, SPEAKING_MS, useContestEntries, useLookups, usePinned, useSessions, type ActorRow, type MessageRow } from "./useCity.ts";

/** 장면 아래 "여기 있는 사람" 줄: 캐릭터 얼굴, 무대 위 NPC, 방금 말한 사람은 금테. */
export function Presence({ here, npcIds, recent, nowMs, meId }: { here: ActorRow[]; npcIds: string[]; recent: MessageRow[]; nowMs: number; meId: string | null }) {
  const { data } = useLookups();
  const speaking = new Set(recent.filter((row) => nowMs - row.atMs < SPEAKING_MS).map((row) => (row.data.authorKind === "npc" ? `npc:${row.data.npcId}` : row.data.authorId)));
  const npcs = npcIds.map((id) => data.npcs.get(id)).filter((npc) => npc !== undefined);
  if (!here.length && !npcs.length) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto bg-felt-950/90 px-3 py-1.5" aria-label="여기 있는 사람">
      {npcs.map((npc) => (
        <span key={npc.id} className="flex shrink-0 items-center gap-1 text-xs">
          <NpcFace npcId={npc.id} name={npc.name} data={data} size={28} className={cx(speaking.has(`npc:${npc.id}`) && "face-speaking")} />
          <span className="text-gold-300">{npc.name}</span>
        </span>
      ))}
      {npcs.length > 0 && here.length > 0 && <span className="h-5 w-px shrink-0 bg-gold-400/30" aria-hidden="true" />}
      {here.map((row) => (
        <span key={row.id} className={cx("flex shrink-0 items-center gap-1 text-xs", nowMs - row.seenMs > AWAY_MS && "opacity-45")} title={nowMs - row.seenMs > AWAY_MS ? "자리 비움" : undefined}>
          <ActorFace actor={row} data={data} size={28} className={cx(speaking.has(row.id) && "face-speaking")} />
          <span className={row.id === meId ? "text-gold-200" : "text-ivory"}>{row.data.name}</span>
        </span>
      ))}
    </div>
  );
}

/** 맞붙기: 딜러가 연 대결에 이 장소에서 쓴 특기 결제가 점수로 쌓인다. */
export function ContestPanel({ contest, controls }: { contest: ContestDoc & { id: string }; controls?: React.ReactNode }) {
  const entries = useContestEntries(contest.id);
  return (
    <section className="shrink-0 border-t border-gold-400/25 bg-ink/70 px-3 py-2" aria-label="맞붙기">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm"><span className="deco-caps mr-1 text-[0.6rem]">맞붙기</span><b className="text-gold-200">{contest.title}</b></p>
        {contest.bossName && <p className="text-xs text-mist">{contest.bossName} <b className="text-lg text-[#f2b3aa]">{contest.bossScore}</b>점</p>}
      </div>
      {entries.length > 0 ? (
        <ol className="mt-1 flex gap-2 overflow-x-auto text-xs">
          {entries.map((row, index) => (
            <li key={row.id} className={cx("shrink-0 rounded-sm border px-2 py-1", index === 0 ? "border-gold-300 text-gold-200" : "border-gold-400/30 text-ivory")}>
              {row.data.authorName} · {row.data.skill!.name} <b>{row.data.skill!.used}</b>점
              {contest.bossName && <span className={row.data.skill!.used > contest.bossScore ? "ml-1 text-[#9fe0b4]" : "ml-1 text-[#f2b3aa]"}>{row.data.skill!.used > contest.bossScore ? "▲" : "▼"}</span>}
            </li>
          ))}
        </ol>
      ) : <p className="mt-1 text-xs text-mist">아직 아무도 나서지 않았다. ⚡ › 특기 쓰기로 겨루세요.</p>}
      {controls}
    </section>
  );
}

/** 기록: 명장면(★)과 세션별 로그 내려받기. */
export function Records({ identity, names }: { identity: ChatIdentity | null; names: Map<string, string> }) {
  const [tab, setTab] = useState<"pins" | "sessions">("pins");
  const pinned = usePinned();
  const sessions = useSessions();
  const { busy, run } = useAction();

  async function download(id: string, title: string) {
    const text = await sessionLog(db, id, title, (channel) => channelLabel(channel, names));
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${title.replace(/[\\/:*?"<>|]/g, "_")}.md`; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-4">
      <div className="mb-3 flex gap-1" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "pins"} className={cx("btn btn-sm", tab === "pins" ? "btn-gold" : "btn-dark")} onClick={() => setTab("pins")}>★ 명장면</button>
        <button type="button" role="tab" aria-selected={tab === "sessions"} className={cx("btn btn-sm", tab === "sessions" ? "btn-gold" : "btn-dark")} onClick={() => setTab("sessions")}>세션 기록</button>
      </div>
      {tab === "pins" ? (
        pinned.length ? (
          <ul className="space-y-3">
            {pinned.map((row) => (
              <li key={row.id} className="deco-frame p-3">
                <p className="mb-1 text-[0.7rem] text-mist">{channelLabel(row.data.channel, names)} · {formatDate(row.atMs)}</p>
                <ul><MessageItem row={row} identity={identity} /></ul>
              </li>
            ))}
          </ul>
        ) : <p className="py-8 text-center text-sm text-mist">아직 남긴 명장면이 없습니다. 채팅에서 ☆를 누르면 여기 모입니다.</p>
      ) : (
        sessions.length ? (
          <ul className="space-y-2">
            {sessions.map((session) => (
              <li key={session.id} className="deco-frame flex items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="truncate font-bold">{session.title}</p>
                  <p className="text-xs text-mist">{session.openedAt ? formatDate(session.openedAt.toMillis()) : ""}{session.closedAt ? " · 닫힘" : " · 진행 중"}</p>
                </div>
                <button type="button" className="btn btn-dark btn-sm shrink-0" disabled={busy} onClick={() => void run(() => download(session.id, session.title))}>기록 받기 (.md)</button>
              </li>
            ))}
          </ul>
        ) : <p className="py-8 text-center text-sm text-mist">아직 열린 세션이 없습니다. 딜러가 세션을 열면 그동안의 공개 대화가 묶여 기록됩니다.</p>
      )}
    </div>
  );
}

export function placeName(place: PlaceId): string { return STATIONS[place].name; }
