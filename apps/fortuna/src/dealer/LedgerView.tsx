import { useMemo, useState } from "react";
import { limit, orderBy, query, where, type QueryConstraint, type Timestamp } from "firebase/firestore";
import { GAMES, GAME_CONTENT, LEDGER_GROUPS, LEDGER_LABELS, replayWager, wagerTrace, type GameId, type LedgerEntry } from "@fortuna/core";
import { refs } from "@fortuna/data";
import { useLiveQuery, type Row } from "../session/live.ts";
import { Coins, Empty, Notice, cx, formatDate } from "../ui/kit.tsx";
import { describeEntry } from "../pages/WalletPage.tsx";
import { SectionTitle, useDealer } from "./DealerApp.tsx";

type Audit = "ok" | "mismatch" | "error";

/** Replay a settled wager from its ledger detail and compare the payout. */
export function auditSettle(entry: LedgerEntry<Timestamp>): Audit {
  try {
    const detail = entry.detail as Record<string, any>;
    const game = GAMES[detail.game as GameId];
    const state = replayWager(game, detail.bet, detail.params, wagerTrace({ wagerId: detail.wagerId, openedAt: detail.openedAt, stepCount: detail.stepCount, steps: detail.steps }));
    return game.isDone(state) && game.payout(state) === detail.payout ? "ok" : "mismatch";
  } catch { return "error"; }
}

export function LedgerView() {
  const { players, session } = useDealer();
  const [pid, setPid] = useState("");
  const [group, setGroup] = useState("");
  const [size, setSize] = useState(100);
  const names = useMemo(() => new Map(players.map((row) => [row.id, row.data.name])), [players]);
  const constraints: QueryConstraint[] = [];
  if (pid) constraints.push(where("playerId", "==", pid));
  if (group) constraints.push(where("type", "in", [...(LEDGER_GROUPS[group] ?? [])]));
  const rows = useLiveQuery(query(refs.ledgers(session.db), ...constraints, orderBy("at", "desc"), limit(size)), `dealer:ledger:${pid}:${group}:${size}`);
  const entries = rows.status === "ready" ? rows.data : [];

  return (
    <div className="space-y-5">
      <SectionTitle title="전체 기록">
        <select className="field !min-h-9 w-auto py-1 text-sm" value={pid} onChange={(event) => setPid(event.target.value)} aria-label="플레이어">
          <option value="">모든 플레이어</option>
          {players.map((row) => <option key={row.id} value={row.id}>{row.data.name}</option>)}
        </select>
        <select className="field !min-h-9 w-auto py-1 text-sm" value={group} onChange={(event) => setGroup(event.target.value)} aria-label="종류">
          <option value="">모든 종류</option>
          {Object.keys(LEDGER_GROUPS).map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </SectionTitle>
      {rows.status === "error" && <Notice tone="error">기록을 불러오지 못했습니다. 색인이 아직 만들어지는 중일 수 있습니다(배포 후 몇 분). {rows.error.message}</Notice>}
      <div className="deco-frame overflow-x-auto p-2">
        <table className="table min-w-[52rem]">
          <thead><tr><th>시각</th><th>플레이어</th><th>종류</th><th>내용</th><th className="text-right">코인</th><th className="text-right">빚</th><th className="text-right">잔액</th><th>검증</th></tr></thead>
          <tbody>{entries.map((row) => <LedgerRow key={row.id} row={row} name={names.get(row.data.playerId) ?? row.data.playerId} />)}</tbody>
        </table>
        {rows.status === "ready" && entries.length === 0 && <Empty>기록이 없습니다.</Empty>}
      </div>
      {entries.length >= size && <button type="button" className="btn btn-ghost w-full" onClick={() => setSize(size + 200)}>더 보기</button>}
      <GamblingStats />
    </div>
  );
}

function LedgerRow({ row, name }: { row: Row<LedgerEntry<Timestamp>>; name: string }) {
  const entry = row.data;
  const [audit, setAudit] = useState<Audit | null>(null);
  return (
    <tr>
      <td className="whitespace-nowrap text-xs text-mist">{entry.at ? formatDate(entry.at.toMillis()) : "…"}</td>
      <td className="whitespace-nowrap">{name}</td>
      <td className="whitespace-nowrap"><span className={cx("chip !py-0 text-[0.7rem]", entry.actor === "admin" && "chip-gold")}>{LEDGER_LABELS[entry.type]}</span></td>
      <td className="max-w-80 text-xs">{describeEntry(entry)}{entry.actor === "admin" && entry.type !== "adminAdjust" && entry.memo ? ` · ${entry.memo}` : ""}</td>
      <td className={cx("text-right", entry.delta > 0 ? "text-[#a9ecc9]" : entry.delta < 0 ? "text-[#f2b3aa]" : "")}>{entry.delta ? <Coins value={entry.delta} signed /> : "—"}</td>
      <td className="text-right num text-xs">{entry.debtDelta ? `${entry.debtDelta > 0 ? "+" : ""}${entry.debtDelta.toLocaleString("ko-KR")}` : ""}</td>
      <td className="text-right num text-xs text-mist">{entry.balanceAfter.toLocaleString("ko-KR")}</td>
      <td>
        {entry.type === "betSettle" && (audit === null
          ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAudit(auditSettle(entry))}>재생</button>
          : <span className={cx("chip", audit === "ok" ? "chip-jade" : "chip-ruby")}>{audit === "ok" ? "✔ 일치" : audit === "mismatch" ? "✖ 불일치" : "✖ 재생 실패"}</span>)}
      </td>
    </tr>
  );
}

/** Per-player realised return, plus an audit of every settlement in the window. */
function GamblingStats() {
  const { players, session } = useDealer();
  const [span, setSpan] = useState(500);
  const rows = useLiveQuery(query(refs.ledgers(session.db), where("type", "==", "betSettle"), orderBy("at", "desc"), limit(span)), `dealer:settles:${span}`);
  const [audited, setAudited] = useState<Map<string, Audit> | null>(null);
  const settles = rows.status === "ready" ? rows.data : [];
  const stats = useMemo(() => {
    const byPlayer = new Map<string, { plays: number; bet: number; paid: number; games: Map<string, number> }>();
    for (const { data } of settles) {
      const detail = data.detail as Record<string, any>;
      const entry = byPlayer.get(data.playerId) ?? { plays: 0, bet: 0, paid: 0, games: new Map() };
      entry.plays += 1; entry.bet += detail.bet; entry.paid += detail.payout;
      entry.games.set(detail.game, (entry.games.get(detail.game) ?? 0) + 1);
      byPlayer.set(data.playerId, entry);
    }
    return byPlayer;
  }, [settles]);
  const failures = audited ? [...audited.entries()].filter(([, result]) => result !== "ok") : [];

  return (
    <section>
      <SectionTitle title="도박 통계와 감사">
        <select className="field !min-h-9 w-auto py-1 text-sm" value={span} onChange={(event) => setSpan(Number(event.target.value))} aria-label="범위">
          {[200, 500, 2000].map((value) => <option key={value} value={value}>최근 {value}판</option>)}
        </select>
        <button type="button" className="btn btn-gold btn-sm" disabled={!settles.length} onClick={() => setAudited(new Map(settles.map((row) => [row.id, auditSettle(row.data)])))}>모두 재생 검증</button>
      </SectionTitle>
      {audited && (failures.length
        ? <Notice tone="error">재생 결과와 다른 정산 {failures.length}건: {failures.map(([id]) => id).join(", ")}</Notice>
        : <Notice tone="success">최근 {audited.size}판 모두 재생 결과와 일치합니다.</Notice>)}
      <div className="deco-frame mt-3 overflow-x-auto p-2">
        <table className="table min-w-[36rem]">
          <thead><tr><th>플레이어</th><th className="text-right">판 수</th><th className="text-right">건 돈</th><th className="text-right">받은 돈</th><th className="text-right">환수율</th><th>많이 한 게임</th></tr></thead>
          <tbody>
            {players.map((player) => {
              const stat = stats.get(player.id);
              if (!stat) return null;
              const rtp = stat.paid / Math.max(1, stat.bet);
              const top = [...stat.games.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([game, count]) => `${GAME_CONTENT[game as GameId]?.title ?? game} ${count}`).join(", ");
              return (
                <tr key={player.id}>
                  <td>{player.data.name}</td>
                  <td className="text-right num">{stat.plays}</td>
                  <td className="text-right"><Coins value={stat.bet} /></td>
                  <td className="text-right"><Coins value={stat.paid} /></td>
                  <td className={cx("text-right num", stat.plays >= 15 && rtp > 1.4 && "font-bold text-[#f2b3aa]")}>{(rtp * 100).toFixed(1)}%</td>
                  <td className="text-xs text-mist">{top}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 px-2 text-xs text-mist">기대 환수율은 뒷골목 ≈ 100%, 하우스 ≈ 95%입니다. 판 수가 많은데 환수율이 지나치게 높으면 붉게 표시됩니다.</p>
      </div>
    </section>
  );
}
