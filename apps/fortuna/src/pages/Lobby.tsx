import type { ReactNode } from "react";
import { Link } from "react-router";
import { MarketQuote } from "../market/MarketQuote.tsx";
import { GAME_CONTENT, TEXT, periodIndexAt, periodStartMs, periodWords, usesLeft } from "@fortuna/core";
import { usePlayer } from "../session/player.tsx";
import { Coins, Frame, Ornament, Stat, cx, formatDate } from "../ui/kit.tsx";

export function Lobby() {
  const { player, wallet, config, district, content, vault, treasury, session } = usePlayer();
  const now = session.clock.now();
  const workLeft = usesLeft(wallet, config, "work", now), gambleLeft = usesLeft(wallet, config, "gamble", now);
  const nextReset = periodStartMs(periodIndexAt(now, config.limitPeriod) + 1, config.limitPeriod);
  const deduction = district?.liberated ? 0 : (district?.deductionBps ?? 0) / 100;
  const open = wallet.openWager;

  return (
    <div className="space-y-5">
      <section className="sunburst -mx-4 px-4 pb-5 pt-2 text-center rise">
        <p className="deco-caps">{content.emblem} {content.name} 구역</p>
        <h1 className="deco-title mt-1 text-[1.8rem] leading-snug">{player.name}</h1>
      </section>

      {open && (
        <Link to={`/table/${open.venue}/${open.game}`} className="block">
          <Frame className="border-gold-300 pulse-gold">
            <p className="deco-caps">진행 중인 판</p>
            <p className="mt-1 font-bold">{GAME_CONTENT[open.game].icon} {GAME_CONTENT[open.game].title} · 판돈 <Coins value={open.bet} /></p>
          </Frame>
        </Link>
      )}

      <Frame className="rise">
        <div className="grid grid-cols-2 gap-y-2 sm:grid-cols-4 sm:divide-x sm:divide-gold-400/20">
          <Stat label="잔액" tone="gold"><Coins value={wallet.balance} /></Stat>
          <Stat label="빚" tone={wallet.debt > 0 ? "ruby" : "jade"}><span className="num">{wallet.debt.toLocaleString("ko-KR")}</span></Stat>
          <Stat label={`${periodWords(config.limitPeriod).now} 남은 일`}><span className="num">{workLeft}</span><span className="text-sm text-mist"> / {config.work.limit}</span></Stat>
          <Stat label={`${periodWords(config.limitPeriod).now} 남은 판`}><span className="num">{gambleLeft}</span><span className="text-sm text-mist"> / {config.gambling.limit}</span></Stat>
        </div>
        <p className="mt-3 text-center text-xs text-mist">다음 초기화: {formatDate(nextReset)} ({periodWords(config.limitPeriod).reset})</p>
      </Frame>

      <div className="grid gap-3 sm:grid-cols-2">
        <VenueCard to="/work" icon="⚒" title={TEXT.lobby.work} meta={district?.liberated ? "구역 해방 · 공제 없음" : `지배인 몫 ${deduction}%`} />
        <VenueCard to="/alley" icon="♣" title={TEXT.lobby.alley} meta={`1판 최대 ${config.gambling.alleyMaxBet.toLocaleString("ko-KR")}`} />
        <VenueCard to="/house" icon="♛" title={TEXT.lobby.house} meta={config.gambling.houseOpen ? `1판 최대 ${config.gambling.houseMaxBet.toLocaleString("ko-KR")}` : "잠김"} locked={!config.gambling.houseOpen} />
        <VenueCard to="/market" icon="📈" title="환전가 거래소" meta={<MarketQuote />} />
        <VenueCard to="/skills" icon="✦" title={TEXT.skill.title} meta={Object.values(player.skills).map((skill) => `${skill.name} ${skill.level}점`).join(" · ") || "등록된 특기 없음"} />
        {config.shopEnabled && <VenueCard to="/shop" icon="✧" title={TEXT.lobby.shop} meta="소문 · 소모품 · 도전권" />}
      </div>

      <Frame>
        <Ornament label="CITY" />
        <div className="mt-3 grid grid-cols-2 gap-2 text-center">
          <div>
            <p className="text-xs text-mist">지배인 금고</p>
            <p className="deco-title text-xl"><Coins value={vault?.amount ?? 0} /></p>
          </div>
          <div>
            <p className="text-xs text-mist">공동 지갑</p>
            <p className="deco-title text-xl"><Coins value={treasury?.amount ?? 0} /></p>
          </div>
        </div>
      </Frame>
    </div>
  );
}

function VenueCard({ to, icon, title, meta, locked }: { to: string; icon: string; title: string; meta: ReactNode; locked?: boolean }) {
  return (
    <Link to={to} className={cx("group block rise", locked && "opacity-80")}>
      <Frame as="div" className="h-full transition group-hover:border-gold-300">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-gold-400/60 bg-ink/60 text-xl text-gold-300">{locked ? "🔒" : icon}</span>
          <div className="min-w-0">
            <h2 className="deco-title text-lg">{title}</h2>
            <p className="mt-0.5 text-sm text-gold-300">{meta}</p>
          </div>
        </div>
      </Frame>
    </Link>
  );
}
