import { Link } from "react-router";
import { GAME_CONTENT, GAME_IDS, TEXT, usedThisWeek, type Venue } from "@fortuna/core";
import { usePlayer } from "../session/player.tsx";
import { Frame, Notice, PageTitle, cx } from "../ui/kit.tsx";

export function VenueList({ venue }: { venue: Venue }) {
  const { config, wallet, session } = usePlayer();
  const house = venue === "house", locked = house && !config.gambling.houseOpen;
  const left = Math.max(0, config.gambling.weeklyLimit - usedThisWeek(wallet, "gamble", session.clock.now()));
  const maxBet = house ? config.gambling.houseMaxBet : config.gambling.alleyMaxBet;
  const games = [...GAME_IDS].filter((id) => config.gambling.games[id][venue].enabled).sort((a, b) => GAME_CONTENT[a].tier - GAME_CONTENT[b].tier);

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Link to="/alley" className={cx("btn", !house ? "btn-gold" : "btn-ghost")}>♣ {TEXT.lobby.alley}</Link>
        <Link to="/house" className={cx("btn", house ? "btn-gold" : "btn-ghost")}>{config.gambling.houseOpen ? "♛" : "🔒"} {TEXT.lobby.house}</Link>
      </div>
      <PageTitle eyebrow={house ? "THE HOUSE" : "BACK ALLEY"} title={house ? TEXT.lobby.house : TEXT.lobby.alley} line={locked ? TEXT.lobby.houseLocked : house ? TEXT.lobby.houseLine : TEXT.lobby.alleyLine} />

      {locked ? (
        <Frame className="sunburst text-center">
          <div className="mx-auto grid h-36 w-28 place-items-center rounded-t-full border-2 border-gold-400 bg-ink/70 text-4xl shadow-[inset_0_0_30px_#000]" aria-hidden="true">🔒</div>
          <p className="deco-title mt-4 text-xl">굳게 닫힌 금빛 문</p>
          <p className="mt-2 text-sm text-mist">문 너머로 샹들리에 불빛과 칩 소리가 새어 나옵니다. 지배인이 문을 열 때까지 기다려야 합니다.</p>
        </Frame>
      ) : (
        <>
          <Frame className="mb-4">
            <p className="flex flex-wrap justify-between gap-2 text-sm">
              <span>1판 최대 <b className="num text-gold-200">{maxBet.toLocaleString("ko-KR")}</b></span>
              <span>이번 주 남은 판 <b className="num text-gold-200">{left}</b> / {config.gambling.weeklyLimit}</span>
            </p>
            <p className="mt-1 text-xs text-mist">{house ? "하우스 엣지는 약 5%. 잃은 판돈은 지배인 금고로 들어갑니다." : "주민들끼리의 판이라 기대값은 거의 본전입니다."}</p>
          </Frame>
          {left === 0 && <div className="mb-4"><Notice>{TEXT.gamble.limitReached}</Notice></div>}
          <div className="grid gap-3 sm:grid-cols-2">
            {games.map((id) => {
              const info = GAME_CONTENT[id];
              return (
                <Link key={id} to={`/table/${venue}/${id}`} className="block rise">
                  <Frame as="div" className="h-full">
                    <div className="flex items-start gap-3">
                      <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-gold-400/60 bg-ink/60 text-2xl">{info.icon}</span>
                      <div>
                        <h2 className="deco-title text-lg">{info.title}</h2>
                        <p className="text-sm text-mist">{info.tagline}</p>
                      </div>
                    </div>
                  </Frame>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
