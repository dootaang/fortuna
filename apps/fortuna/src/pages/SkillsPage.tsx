import { useState } from "react";
import { limit, orderBy, query, where, type Timestamp } from "firebase/firestore";
import { TEXT, borrowDebt, fill, skillCost, type LedgerEntry } from "@fortuna/core";
import { paySkill, refs } from "@fortuna/data";
import { usePlayer } from "../session/player.tsx";
import { useLiveQuery } from "../session/live.ts";
import { Coins, Empty, Frame, PageTitle, TextField, cx, formatDate, useAction } from "../ui/kit.tsx";
import { Counter } from "../fx/Counter.tsx";
import { flash } from "../fx/effects.ts";
import { cue } from "../fx/cues.ts";
import { relay } from "../relay.ts";

export default function SkillsPage() {
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

  async function pay() {
    if (!skill) return;
    const id = await run(() => paySkill(session, { skillId, usedLevel: used, note, borrow: shortfall > 0 }));
    if (!id) return;
    setStamp({ key: Date.now(), cost, name: `${skill.name} ${used}점` });
    flash("gold", 360); cue("perfect");
    relay(notify.relayUrl, id);
    setNote(""); setBoost(0);
    window.setTimeout(() => setStamp(null), 1_800);
  }

  return (
    <div className="space-y-4">
      <PageTitle eyebrow="SKILLS" title={TEXT.skill.title} />
      {!skills.length ? <Frame><Empty>{TEXT.skill.noSkills}</Empty></Frame> : (
        <>
          <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="특기">
            {skills.map(([id, entry]) => (
              <button
                key={id} type="button" role="radio" aria-checked={id === skillId} onClick={() => { cue("tap"); setSkillId(id); setBoost(0); }}
                className={cx("deco-frame p-3 text-left transition", id === skillId ? "!border-gold-300 shadow-[0_0_0_1px_var(--color-gold-300),0_0_24px_-6px_var(--color-gold-400)]" : "opacity-80 hover:opacity-100")}
              >
                <span className="block truncate font-bold">{entry.name}</span>
                <span className="mt-1 flex items-baseline gap-1">
                  <span className="deco-title text-3xl">{entry.level}</span><span className="text-sm text-mist">점</span>
                </span>
                <span className="mt-1 block text-xs text-mist">기본 <Coins value={config.skill.costs[entry.level] ?? 0} /></span>
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
              <ul className="mt-4 space-y-0.5 text-sm">
                {Array.from({ length: used - skill.level + 1 }, (_, step) => {
                  const level = skill.level + step, price = config.skill.costs[level] ?? 0;
                  return <li key={level} className="flex justify-between text-mist slide-in-top"><span>{step === 0 ? `기본 ${level}점` : `웃돈 ${level}점`}</span><Coins value={price} /></li>;
                })}
              </ul>
              <div className="mt-2 flex items-end justify-between border-t border-gold-400/30 pt-2">
                <span className="font-bold">총액</span>
                <span className="deco-title text-3xl"><span className="coin"><Counter value={cost} duration={350} /></span></span>
              </div>
              <div className="mt-3"><TextField label="장면 메모 (선택)" value={note} onChange={setNote} maxLength={200} placeholder="예: 간부의 검을 받아낸다" /></div>
              {shortfall > 0 && (
                <p className="mt-3 text-sm text-[#f2b3aa]">
                  {canBorrow ? fill(TEXT.skill.borrowOffer, { amount: shortfall, debt: borrowDebt(shortfall, config.borrow.feeBps) }) : "잔액이 부족합니다."}
                </p>
              )}
              <button type="button" className="btn btn-gold mt-4 min-h-14 w-full text-lg" disabled={busy || (shortfall > 0 && !canBorrow)} onClick={() => void pay()}>
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
        </>
      )}
      <SkillHistory />
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
