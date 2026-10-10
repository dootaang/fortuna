import { Link } from "react-router";
import { TEXT, WORK_TEMPLATES, usedThisWeek, type WorkTemplate } from "@fortuna/core";
import { usePlayer } from "../session/player.tsx";
import { Frame, Notice, PageTitle } from "../ui/kit.tsx";

const TEMPLATE_HINT: Record<WorkTemplate, string> = {
  sort: "제한 시간 안에 알맞은 곳으로 분류",
  memory: "보여 준 것을 기억했다가 그대로 고르기",
  math: "빠르고 정확한 셈",
  timing: "알맞은 순간에 누르기",
};

export default function WorkHub() {
  const { wallet, config, content, district, session } = usePlayer();
  const used = usedThisWeek(wallet, "work", session.clock.now()), left = Math.max(0, config.work.weeklyLimit - used);
  const deductionPct = district?.liberated ? 0 : (district?.deductionBps ?? 0) / 100;
  return (
    <div>
      <PageTitle eyebrow={`${content.emblem} ${content.name}`} title={TEXT.lobby.work} line={TEXT.lobby.workLine} />
      <Frame className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>이번 주 남은 일 <b className="num text-gold-200">{left}</b> / {config.work.weeklyLimit}</span>
          <span>기본 임금 <b className="num text-gold-200">{config.work.baseWage}</b> <span className="text-mist">({config.work.wageMin}~{config.work.wageMax})</span></span>
          <span className={district?.liberated ? "chip chip-jade" : "chip chip-ruby"}>{district?.liberated ? "해방 구역 · 공제 없음" : `지배인 몫 ${deductionPct}%`}</span>
        </div>
      </Frame>
      {left === 0 && <div className="mb-4"><Notice>{TEXT.work.limitReached}</Notice></div>}
      <div className="grid gap-3 sm:grid-cols-2">
        {WORK_TEMPLATES.map((template) => {
          const skin = content.work[template];
          const card = (
            <Frame as="article" className="h-full">
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="text-3xl">{skin.icon}</span>
                <div>
                  <h2 className="deco-title text-lg">{skin.title}</h2>
                  <p className="text-sm text-mist">{skin.intro}</p>
                  <p className="mt-1 text-xs text-gold-300">{TEMPLATE_HINT[template]}</p>
                </div>
              </div>
            </Frame>
          );
          return left > 0 ? <Link key={template} to={`/work/${template}`} className="block rise">{card}</Link> : <div key={template} className="opacity-50">{card}</div>;
        })}
      </div>
    </div>
  );
}
