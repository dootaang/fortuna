import { useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { TEXT, WORK_TEMPLATES, randomSeed, usedThisWeek, wageFor, type WorkTemplate } from "@fortuna/core";
import { submitWork, type WorkResult } from "@fortuna/data";
import { usePlayer } from "../session/player.tsx";
import { Coins, Frame, Notice, Ornament, PageTitle, useAction } from "../ui/kit.tsx";
import { SortGame } from "./SortGame.tsx";
import { MemoryGame } from "./MemoryGame.tsx";
import { MathGame } from "./MathGame.tsx";
import { TimingGame } from "./TimingGame.tsx";

const RULES: Record<WorkTemplate, string> = {
  sort: "나오는 물건을 알맞은 칸으로 보내세요. 틀리면 감점입니다.",
  memory: "잠깐 보여 주는 목록을 외웠다가, 같은 것들을 모두 고르세요.",
  math: "제한 시간 동안 최대한 많이 맞히세요. 틀리면 감점입니다.",
  timing: "바늘이 금빛 표시 안에 들어왔을 때 누르세요. 가운데일수록 좋습니다.",
};

type Phase = { name: "intro" } | { name: "play"; seed: string } | { name: "slip"; result: WorkResult; performance: number };

export default function WorkShift() {
  const { template } = useParams();
  const { session, wallet, config, content } = usePlayer();
  const [phase, setPhase] = useState<Phase>({ name: "intro" });
  const { busy, run } = useAction();
  const valid = WORK_TEMPLATES.includes(template as WorkTemplate);
  const kind = (valid ? template : "sort") as WorkTemplate;
  const skin = content.work[kind];
  const left = Math.max(0, config.work.weeklyLimit - usedThisWeek(wallet, "work", session.clock.now()));

  const finish = useMemo(() => async (performance: number) => {
    const result = await run(() => submitWork(session, kind, performance));
    if (result) setPhase({ name: "slip", result, performance });
    else setPhase({ name: "intro" });
  }, [run, session, kind]);

  if (!valid) return <Navigate to="/work" replace />;

  if (phase.name === "play") {
    const props = { seed: phase.seed, onFinish: (performance: number) => void finish(performance) };
    return (
      <div>
        <p className="deco-caps mb-2 text-center">{skin.icon} {skin.title}</p>
        {busy ? <Notice>임금을 계산하고 있습니다…</Notice> : (
          kind === "sort" ? <SortGame skin={content.work.sort} {...props} />
          : kind === "memory" ? <MemoryGame skin={content.work.memory} {...props} />
          : kind === "math" ? <MathGame skin={content.work.math} {...props} />
          : <TimingGame skin={content.work.timing} {...props} />
        )}
      </div>
    );
  }

  if (phase.name === "slip") {
    const { result } = phase;
    return (
      <div>
        <PageTitle eyebrow={skin.title} title={TEXT.work.slipTitle} />
        <Frame className="rise">
          <dl className="space-y-2 text-base">
            <div className="flex justify-between"><dt>{TEXT.work.wage}</dt><dd><Coins value={result.gross} /></dd></div>
            <div className="flex justify-between text-[#f2b3aa]"><dt>{TEXT.work.deduction} ({result.deductionBps / 100}%)</dt><dd><Coins value={-result.deduction} /></dd></div>
            <div className="flex justify-between border-t border-gold-400/40 pt-2 text-lg font-bold text-gold-200"><dt>{TEXT.work.received}</dt><dd><Coins value={result.net} /></dd></div>
          </dl>
          <div className="my-4"><Ornament /></div>
          <p className="text-center text-sm text-mist">성과 {Math.round(phase.performance * 100)}% · {result.deduction === 0 ? TEXT.work.liberated : TEXT.work.deductionLine}</p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Link to="/work" className="btn btn-ghost">일터로</Link>
            <button type="button" className="btn btn-gold" disabled={left === 0} onClick={() => setPhase({ name: "intro" })}>{left === 0 ? "이번 주 끝" : "한 번 더"}</button>
          </div>
        </Frame>
      </div>
    );
  }

  return (
    <div>
      <PageTitle eyebrow={`${content.name} · 일터`} title={`${skin.icon} ${skin.title}`} line={skin.intro} />
      <Frame>
        <p>{RULES[kind]}</p>
        <p className="mt-2 text-sm text-mist">임금은 성과에 따라 <Coins value={wageFor(0, config.work)} />~<Coins value={wageFor(1, config.work)} /> 사이에서 정해지고, 지배인 몫이 먼저 떼입니다.</p>
        {left === 0 ? <div className="mt-4"><Notice>{TEXT.work.limitReached}</Notice></div> : (
          <button type="button" className="btn btn-gold mt-5 w-full" onClick={() => setPhase({ name: "play", seed: randomSeed() })}>근무 시작 (남은 {left}회)</button>
        )}
      </Frame>
    </div>
  );
}
