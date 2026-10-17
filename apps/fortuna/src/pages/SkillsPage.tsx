import { useState } from "react";
import { Link } from "react-router";
import { limit, orderBy, query, where, type Timestamp } from "firebase/firestore";
import { TEXT, borrowDebt, fill, skillCost, type LedgerEntry } from "@fortuna/core";
import { paySkill, paySkillInChat, refs } from "@fortuna/data";
import { usePlayer } from "../session/player.tsx";
import { useLiveQuery } from "../session/live.ts";
import { Coins, Empty, Frame, Modal, PageTitle, TextField, cx, formatDate, useAction } from "../ui/kit.tsx";
import { Counter } from "../fx/Counter.tsx";
import { flash } from "../fx/effects.ts";
import { cue } from "../fx/cues.ts";
import { relay } from "../relay.ts";
import { ContestPanel } from "../city/Stage.tsx";
import { useOpenContests } from "../city/useCity.ts";

export default function SkillsPage() {
  return (
    <div className="space-y-4">
      <PageTitle eyebrow="SKILLS" title={TEXT.skill.title} />
      <SkillPay />
      <SkillHistory />
    </div>
  );
}

/** 위쪽 ✦ 단추가 여는 창: 어느 화면에서든 특기를 바로 결제한다(디스코드 RP 중에 가장 자주 쓴다). */
export function SkillQuick({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={TEXT.skill.title}>
      <SkillPay compact />
      <Link to="/skills" className="mt-3 block text-center text-xs text-mist underline-offset-2 hover:underline" onClick={onClose}>최근 사용 기록 보기 →</Link>
    </Modal>
  );
}

/** 특기 결제: 특기와 점수를 고르고 낸다. 간부전·맞붙기가 열려 있으면 그 판에 걸 수 있다. */
function SkillPay({ compact = false }: { compact?: boolean }) {
  const { player, config, wallet, session, notify } = usePlayer();
  const { busy, run } = useAction();
  const skills = Object.entries(player.skills).sort((a, b) => a[1].name.localeCompare(b[1].name, "ko"));
  const [skillId, setSkillId] = useState(skills[0]?.[0] ?? "");
  const [boost, setBoost] = useState(0);
  const [note, setNote] = useState("");
  const [stamp, setStamp] = useState<{ key: number; cost: number; name: string } | null>(null);
  const skill = player.skills[skillId];
  const maxLevel = config.skill.cumulative.length - 1;
  const used = skill ? Math.min(maxLevel, skill.level + boost) : 0;
  const cost = skill ? skillCost(skill.level, used, config.skill.cumulative) : 0;
  const shortfall = Math.max(0, cost - wallet.balance);
  const canBorrow = config.borrow.enabled && shortfall > 0;
  // 디스코드에서 RP를 하므로, 간부전·맞붙기 점수는 여기서 결제할 때 건다.
  const contest = useOpenContests()[0] ?? null;
  const [stake, setStake] = useState(true);
  const staking = contest !== null && stake;

  async function pay() {
    if (!skill) return;
    const payment = { skillId, usedLevel: used, note, borrow: shortfall > 0 };
    const id = await run(async () => (staking
      ? (await paySkillInChat(session, player.name, contest.place, payment, { contestId: contest.id })).replace(/^skill_/, "")
      : paySkill(session, payment)));
    if (!id) return;
    setStamp({ key: Date.now(), cost, name: `${skill.name} ${used}점` });
    flash("gold", 360); cue("perfect");
    relay(notify.relayUrl, id);
    setNote(""); setBoost(0);
    window.setTimeout(() => setStamp(null), 1_800);
  }

  if (!skills.length) return <Frame><Empty>{TEXT.skill.noSkills}</Empty></Frame>;
  return (
    <div className="space-y-3">
      {contest && <Frame className="!p-0 overflow-hidden"><ContestPanel contest={contest} /></Frame>}
      <div className={cx("grid", compact ? "grid-cols-2 gap-2 sm:grid-cols-3" : "grid-cols-2 gap-3")} role="radiogroup" aria-label="특기">
        {skills.map(([id, entry]) => (
          <button
            key={id} type="button" role="radio" aria-checked={id === skillId} onClick={() => { cue("tap"); setSkillId(id); setBoost(0); }}
            className={cx("deco-frame text-left transition", compact ? "p-2" : "p-3", id === skillId ? "!border-gold-300 shadow-[0_0_0_1px_var(--color-gold-300),0_0_24px_-6px_var(--color-gold-400)]" : "opacity-80 hover:opacity-100")}
          >
            <span className="block truncate font-bold">{entry.name}</span>
            <span className="mt-1 flex items-baseline gap-1">
              <span className={cx("deco-title", compact ? "text-2xl" : "text-3xl")}>{entry.level}</span><span className="text-sm text-mist">점</span>
            </span>
            {!compact && <span className="mt-1 block text-xs text-mist">기본 <Coins value={config.skill.costs[entry.level] ?? 0} /></span>}
          </button>
        ))}
      </div>

      {skill && (
        <Frame className="relative overflow-hidden">
          <p className="field-label">사용할 점수 (기본 {skill.level}점 + 웃돈)</p>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: Math.max(1, maxLevel - skill.level + 1) }, (_, step) => (
              <button key={step} type="button" className={cx("btn btn-sm min-w-12 num", step === boost ? "btn-gold" : "btn-dark")} onClick={() => { cue("chip"); setBoost(step); }}>{skill.level + step}점</button>
            ))}
          </div>
          {!compact && (
            <ul className="mt-4 space-y-0.5 text-sm">
              {Array.from({ length: used - skill.level + 1 }, (_, step) => {
                const level = skill.level + step, price = config.skill.costs[level] ?? 0;
                return <li key={level} className="flex justify-between text-mist slide-in-top"><span>{step === 0 ? `기본 ${level}점` : `웃돈 ${level}점`}</span><Coins value={price} /></li>;
              })}
            </ul>
          )}
          <div className="mt-2 flex items-end justify-between border-t border-gold-400/30 pt-2">
            <span className="font-bold">총액</span>
            <span className={cx("deco-title", compact ? "text-2xl" : "text-3xl")}><span className="coin"><Counter value={cost} duration={350} /></span></span>
          </div>
          <div className="mt-3"><TextField label="장면 메모 (선택)" value={note} onChange={setNote} maxLength={200} placeholder="예: 간부의 검을 받아낸다" /></div>
          {contest && (
            <label className={cx("mt-3 flex items-center gap-2 rounded-sm border px-3 py-2 text-sm", stake ? "border-gold-300 bg-gold-400/10 text-gold-200" : "border-gold-400/25 text-mist")}>
              <input type="checkbox" checked={stake} onChange={(event) => setStake(event.target.checked)} />
              「{contest.title}」에 걸기 — 이 결제를 {contest.mode === "boss" || contest.mode === "final" ? "이번 판 우리 편" : "맞붙기"} 점수로 올립니다
            </label>
          )}
          {shortfall > 0 && (
            <p className="mt-3 text-sm text-[#f2b3aa]">
              {canBorrow ? fill(TEXT.skill.borrowOffer, { amount: shortfall, debt: borrowDebt(shortfall, config.borrow.feeBps) }) : "잔액이 부족합니다."}
            </p>
          )}
          <button type="button" className={cx("btn btn-gold mt-4 w-full text-lg", compact ? "min-h-12" : "min-h-14")} disabled={busy || (shortfall > 0 && !canBorrow)} onClick={() => void pay()}>
            {busy ? "결제 중…" : `${shortfall > 0 ? "빌려서 결제" : "결제"} · ${cost.toLocaleString("ko-KR")}`}
          </button>
          {stamp && (
            <div key={stamp.key} className="pointer-events-none absolute inset-0 grid place-items-center bg-felt-950/70" aria-live="polite">
              <div className="stamp rounded-sm border-4 border-gold-400 px-6 py-3 text-center text-gold-200 shadow-[0_0_40px_#d4af3766]">
                <p className="deco-caps">PAID</p>
                <p className="deco-title text-3xl">{stamp.cost.toLocaleString("ko-KR")}</p>
                <p className="text-sm">{stamp.name}</p>
              </div>
            </div>
          )}
        </Frame>
      )}
    </div>
  );
}

function SkillHistory() {
  const { session } = usePlayer();
  const rows = useLiveQuery(query(refs.ledgers(session.db), where("playerId", "==", session.pid), where("type", "==", "skill"), orderBy("at", "desc"), limit(15)), `skills:history:${session.pid}`);
  const entries = rows.status === "ready" ? rows.data : [];
  return (
    <Frame>
      <h2 className="deco-title text-lg">최근 사용</h2>
      {entries.length ? (
        <ul className="mt-2 divide-y divide-gold-400/15 text-sm">
          {entries.map(({ id, data }) => <HistoryRow key={id} entry={data} />)}
        </ul>
      ) : <Empty>{rows.status === "error" ? "기록을 불러오지 못했습니다." : "아직 특기를 쓴 적이 없습니다."}</Empty>}
    </Frame>
  );
}

function HistoryRow({ entry }: { entry: LedgerEntry<Timestamp> }) {
  const detail = entry.detail as { skillName?: string; baseLevel?: number; usedLevel?: number; cost?: number; borrowed?: number; note?: string };
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="font-bold">{detail.skillName} <span className="num text-gold-200">{detail.usedLevel}점</span>{detail.usedLevel !== detail.baseLevel && <span className="text-xs text-mist"> (기본 {detail.baseLevel})</span>}</p>
        {detail.note && <p className="truncate text-xs text-mist">{detail.note}</p>}
        <p className="text-xs text-mist">{entry.at ? formatDate(entry.at.toMillis()) : ""}{detail.borrowed ? ` · 차입 ${detail.borrowed.toLocaleString("ko-KR")}` : ""}</p>
      </div>
      <span className="shrink-0 font-bold text-[#f2b3aa]"><Coins value={-(detail.cost ?? 0)} /></span>
    </li>
  );
}
