import { Link } from "react-router";
import { GAME_CONTENT, GAME_IDS, TEXT, limitReachedText, periodWords, usesLeft, type Venue } from "@fortuna/core";
import { usePlayer } from "../session/player.tsx";
import { PvpLobby } from "../pvp/PvpLobby.tsx";
import { Frame, Notice, PageTitle, cx } from "../ui/kit.tsx";

export function VenueList({ venue }: { venue: Venue }) {
  const { config, wallet, session } = usePlayer();
  const house = venue === "house", locked = house && !config.gambling.houseOpen;
  const left = usesLeft(wallet, config, "gamble", session.clock.now());
  const maxBet = house ? config.gambling.houseMaxBet : config.gambling.alleyMaxBet;
  const games = [...GAME_IDS].filter((id) => config.gambling.games[id][venue].enabled).sort((a, b) => GAME_CONTENT[a].tier - GAME_CONTENT[b].tier);

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Link to="/alley" className={cx("btn", !house ? "btn-gold" : "btn-ghost")}>♣ {TEXT.lobby.alley}</Link>
        <Link to="/house" className={cx("btn", house ? "btn-gold" : "btn-ghost")}>{config.gambling.houseOpen ? "♛" : "🔒"} {TEXT.lobby.house}</Link>
      </div>
      <PageTitle eyebrow={house ? "THE HOUSE" : "BACK ALLEY"} title={house ? TEXT.lobby.house : TEXT.lobby.alley} />

      {locked ? (
        <Frame className="sunburst text-center">
          <div className="mx-auto grid h-36 w-28 place-items-center rounded-t-full border-2 border-gold-400 bg-ink/70 text-4xl shadow-[inset_0_0_30px_#000]" aria-hidden="true">🔒</div>
          <p className="deco-title mt-4 text-xl">{TEXT.lobby.houseLocked}</p>
        </Frame>
      ) : (
        <>
          <Frame className="mb-4">
            <p className="flex flex-wrap justify-between gap-2 text-sm">
              <span>1판 최대 <b className="num text-gold-200">{maxBet.toLocaleString("ko-KR")}</b></span>
              <span>{periodWords(config.limitPeriod).now} 남은 판 <b className="num text-gold-200">{left}</b> / {config.gambling.limit}</span>
            </p>
            <p className="mt-1 text-xs text-mist">{house ? "하우스 엣지 약 5% · 하우스 손익은 지배인 금고에 반영" : "기대값은 거의 본전"}</p>
          </Frame>
          {left === 0 && <div className="mb-4"><Notice>{limitReachedText(config, "gamble")}</Notice></div>}
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
          <PvpLobby venue={venue} />
        </>
      )}
    </div>
  );
}
