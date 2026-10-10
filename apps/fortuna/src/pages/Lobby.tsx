import { Link } from "react-router";
import { GAME_CONTENT, TEXT, fill, usedThisWeek, weekStartMs } from "@fortuna/core";
import { usePlayer } from "../session/player.tsx";
import { Coins, Frame, Ornament, Stat, cx, formatDate } from "../ui/kit.tsx";

export function Lobby() {
  const { player, wallet, config, district, content, vault, treasury, session } = usePlayer();
  const now = session.clock.now();
  const workLeft = Math.max(0, config.work.weeklyLimit - usedThisWeek(wallet, "work", now));
  const gambleLeft = Math.max(0, config.gambling.weeklyLimit - usedThisWeek(wallet, "gamble", now));
  const nextReset = weekStartMs(session.clock.week() + 1);
  const deduction = district?.liberated ? 0 : (district?.deductionBps ?? 0) / 100;
  const open = wallet.openWager;

  return (
    <div className="space-y-5">
      <section className="sunburst -mx-4 px-4 pb-5 pt-2 text-center rise">
        <p className="deco-caps">{content.emblem} {content.name} 구역</p>
        <h1 className="deco-title mt-1 text-[1.6rem] leading-snug">{fill(TEXT.lobby.welcomeBack, { name: player.name })}</h1>
        <p className="mt-1 text-sm text-mist">{TEXT.greeting}</p>
      </section>

      {open && (
        <Link to={`/table/${open.venue}/${open.game}`} className="block">
          <Frame className="border-gold-300 pulse-gold">
            <p className="deco-caps">진행 중인 판</p>
            <p className="mt-1 font-bold">{GAME_CONTENT[open.game].icon} {GAME_CONTENT[open.game].title} · 판돈 <Coins value={open.bet} /></p>
            <p className="text-sm text-mist">{TEXT.gamble.resume}</p>
          </Frame>
        </Link>
      )}

      <Frame className="rise">
        <div className="grid grid-cols-2 gap-y-2 sm:grid-cols-4 sm:divide-x sm:divide-gold-400/20">
          <Stat label="잔액" tone="gold"><Coins value={wallet.balance} /></Stat>
          <Stat label="빚" tone={wallet.debt > 0 ? "ruby" : "jade"}><span className="num">{wallet.debt.toLocaleString("ko-KR")}</span></Stat>
          <Stat label="남은 일"><span className="num">{workLeft}</span><span className="text-sm text-mist"> / {config.work.weeklyLimit}</span></Stat>
          <Stat label="남은 판"><span className="num">{gambleLeft}</span><span className="text-sm text-mist"> / {config.gambling.weeklyLimit}</span></Stat>
        </div>
        <p className="mt-3 text-center text-xs text-mist">다음 주간 초기화: {formatDate(nextReset)} (월요일 0시)</p>
      </Frame>

      <div className="grid gap-3 sm:grid-cols-2">
        <VenueCard to="/work" icon="⚒" title={TEXT.lobby.work} line={TEXT.lobby.workLine} meta={district?.liberated ? "구역 해방 · 공제 없음" : `지배인 몫 ${deduction}%`} />
        <VenueCard to="/alley" icon="♣" title={TEXT.lobby.alley} line={TEXT.lobby.alleyLine} meta={`1판 최대 ${config.gambling.alleyMaxBet.toLocaleString("ko-KR")}`} />
        <VenueCard to="/house" icon="♛" title={TEXT.lobby.house} line={config.gambling.houseOpen ? TEXT.lobby.houseLine : TEXT.lobby.houseLocked} meta={config.gambling.houseOpen ? `1판 최대 ${config.gambling.houseMaxBet.toLocaleString("ko-KR")}` : "잠김"} locked={!config.gambling.houseOpen} />
        <VenueCard to="/shop" icon="✦" title={TEXT.lobby.shop} line={TEXT.lobby.shopLine} meta="소문 · 소모품 · 도전권" />
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
        <p className="mt-3 text-center text-xs text-mist">최종전에서는 모두의 코인을 합쳐 지배인과 맞섭니다. 결국 코인이 많은 쪽이 이깁니다.</p>
      </Frame>
    </div>
  );
}

function VenueCard({ to, icon, title, line, meta, locked }: { to: string; icon: string; title: string; line: string; meta: string; locked?: boolean }) {
  return (
    <Link to={to} className={cx("group block rise", locked && "opacity-80")}>
      <Frame as="div" className="h-full transition group-hover:border-gold-300">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-gold-400/60 bg-ink/60 text-xl text-gold-300">{locked ? "🔒" : icon}</span>
          <div className="min-w-0">
            <h2 className="deco-title text-lg">{title}</h2>
            <p className="text-sm text-mist">{line}</p>
            <p className="mt-1.5 text-xs text-gold-300">{meta}</p>
          </div>
        </div>
      </Frame>
    </Link>
  );
}
