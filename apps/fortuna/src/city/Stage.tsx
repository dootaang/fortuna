import { useState } from "react";
import { STATIONS, type PlaceId } from "@fortuna/core";
import { sessionLog, winsNeeded } from "@fortuna/data";
import { db } from "../firebase.ts";
import { cx, formatDate, useAction } from "../ui/kit.tsx";
import { MessageItem, channelLabel, type ChatIdentity } from "./Chat.tsx";
import { ActorFace, NpcFace } from "./SceneCard.tsx";
import { AWAY_MS, SPEAKING_MS, useContestEntries, useLookups, usePinned, useSessions, type ActorRow, type MessageRow, type OpenContest } from "./useCity.ts";

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

/** This round's best skill score (간부전), or every entry (맞붙기). */
export function roundEntries(contest: OpenContest, entries: MessageRow[]): MessageRow[] {
  if (!contest.mode || contest.mode === "simple") return entries;
  const since = contest.roundStartedAt?.toMillis?.() ?? 0;
  return entries.filter((row) => row.atMs >= since);
}

/** 맞붙기: 딜러가 연 대결에 이 장소에서 쓴 특기 결제가 점수로 쌓인다. 간부전·최종전은 라운드제로 보인다. */
export function ContestPanel({ contest, controls }: { contest: OpenContest; controls?: React.ReactNode }) {
  const all = useContestEntries(contest.id);
  if (contest.mode === "boss" || contest.mode === "final") return <FightPanel contest={contest} entries={roundEntries(contest, all)} controls={controls} />;
  const entries = all;
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
      ) : <p className="mt-1 text-xs text-mist">아직 아무도 나서지 않았다. 특기를 결제할 때 「걸기」를 켜면 점수로 오른다.</p>}
      {controls}
    </section>
  );
}

function FightPanel({ contest, entries, controls }: { contest: OpenContest; entries: MessageRow[]; controls?: React.ReactNode }) {
  const best = entries[0]?.data.skill?.used ?? 0, party = best + (contest.bonus ?? 0), boss = contest.bossScore;
  const final = contest.mode === "final", pages = contest.pages ?? [], left = pages.length - (contest.pageIndex ?? 0);
  const need = winsNeeded(contest.rounds ?? 3), assists = (contest.assists ?? []).filter((card) => !card.used);
  return (
    <section className="shrink-0 border-t border-[#c4473a]/40 bg-ink/80 px-3 py-2" aria-label={final ? "최종전" : "간부전"}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm"><span className="deco-caps mr-1 text-[0.6rem] text-[#f2b3aa]">{final ? "최종전" : "간부전"}</span><b className="text-gold-200">{contest.title}</b></p>
        <p className="text-xs text-mist">제{contest.round ?? 1}판 · {contest.wins?.party ?? 0}:{contest.wins?.boss ?? 0} (먼저 {need}승)</p>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-sm border border-gold-400/30 py-1">
          <p className="text-[0.65rem] text-mist">우리 편{contest.bonus ? ` (조력 +${contest.bonus})` : ""}</p>
          <p className={cx("text-xl font-bold", party > boss ? "text-[#9fe0b4]" : "text-ivory")}>{party}</p>
          <p className="truncate text-[0.65rem] text-mist">{entries[0] ? `${entries[0].data.authorName} · ${entries[0].data.skill!.name}` : "아직 아무도"}</p>
        </div>
        <div className="rounded-sm border border-[#c4473a]/40 py-1">
          <p className="text-[0.65rem] text-mist">{contest.bossName}</p>
          <p className={cx("text-xl font-bold", boss >= party ? "text-[#f2b3aa]" : "text-ivory")}>{boss}</p>
          <p className="text-[0.65rem] text-mist">{final ? `남은 장부 ${left}쪽` : `금고 ${(contest.bossVault ?? 0).toLocaleString("ko-KR")}`}{contest.fizzle ? ` · 불발 ${contest.fizzle}` : ""}</p>
        </div>
      </div>
      {final && assists.length > 0 && <p className="mt-1 text-[0.7rem] text-gold-200">조력 카드: {assists.map((card) => card.title).join(" · ")} — 쓰겠다고 말하면 딜러가 펼친다.</p>}
      {(contest.log ?? []).length > 0 && <ol className="mt-1 max-h-20 space-y-0.5 overflow-y-auto text-[0.7rem] text-ivory/80">{(contest.log ?? []).slice(-4).map((line, index) => <li key={index}>{line}</li>)}</ol>}
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
