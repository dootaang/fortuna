import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { COINS, COIN_IDS, periodWords, type CoinId } from "@fortuna/core";
import { usePlayer } from "../session/player.tsx";
import { cue } from "../fx/cues.ts";
import { Frame, Notice, PageTitle, cx, formatDate } from "../ui/kit.tsx";
import { VenueTabs } from "../pages/VenueList.tsx";
import { PositionCard } from "./Positions.tsx";
import { CoinBadge, FlapText, Sparkline, changeText, priceText } from "./pieces.tsx";
import { directionOf, openingPrice, useCountdown, useFeed, useMarketConfig, useMyPositions, useTape } from "./useMarket.ts";
import "./market.css";

/** 환전가 거래소: the departure board of prices. */
export default function MarketPage() {
  const { session, wallet, config: economy } = usePlayer();
  const now = () => session.clock.now();
  const { config: market, exists } = useMarketConfig();
  const tape = useTape(now, 22);
  const tick = tape.latest?.tick ?? null;
  const left = useCountdown(tick, market.tickSeconds, now);
  const positions = useMyPositions();
  const feed = useFeed(12);
  const counters = wallet.market ?? { period: -1, used: 0, open: 0 };
  const usedToday = counters.period === session.clock.period(economy.limitPeriod) ? counters.used : 0;
  const stale = tick ? now() - tick.at.toMillis() > market.staleSeconds * 1000 : true;

  // One soft clack per tick, and the station bell when news lands.
  const lastSeq = useRef<number | null>(null);
  useEffect(() => {
    if (!tick) return;
    if (lastSeq.current !== null && tick.seq !== lastSeq.current) cue("flap");
    lastSeq.current = tick.seq;
  }, [tick?.seq]);
  const lastFeed = useRef<string | null>(null);
  useEffect(() => {
    const top = feed[0]?.id ?? null;
    if (lastFeed.current !== null && top && top !== lastFeed.current) cue("bell");
    lastFeed.current = top;
  }, [feed[0]?.id]);

  return (
    <div>
      <VenueTabs active="market" />
      <PageTitle eyebrow="EXCHANGE STREET" title="환전가 거래소" line="휠 광장 환전가. 구역마다 시세가 있고, 모자란 돈은 지배인이 빌려준다." />

      {!exists || !market.enabled ? (
        <Notice>거래소가 아직 문을 열지 않았습니다.</Notice>
      ) : (
        <>
          <section className="departure-board mb-4 p-3" aria-label="시세판">
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <p className="deco-caps">Departures · 시세</p>
              <div className="flex items-center gap-2 text-xs text-mist">
                {stale ? <span className="text-[#f2b3aa]">시세 기록원 대기 중</span> : left > 0 ? <span>다음 시세 <span className="num text-gold-200">{left}</span>초</span> : <span className="text-gold-200">시세 갱신 중…</span>}
                <span className="station-clock" style={{ ["--turn" as string]: String(1 - left / market.tickSeconds) }} aria-hidden="true" />
              </div>
            </div>
            <ul>
              {COIN_IDS.map((coin) => <BoardRow key={coin} coin={coin} tape={tape} halted={!market.coins[coin].enabled} />)}
            </ul>
          </section>

          <Frame className="mb-4">
            <p className="flex flex-wrap justify-between gap-2 text-sm">
              <span>{periodWords(economy.limitPeriod).now} 새 거래 <b className="num text-gold-200">{Math.max(0, market.dailyLimit - usedToday)}</b> / {market.dailyLimit}</span>
              <span>열린 포지션 <b className="num text-gold-200">{counters.open}</b> / {market.maxOpen}</span>
            </p>
            <p className="mt-1 text-xs text-mist">수수료 진입·청산 각 {market.feeBps / 100}% · 빌린 돈 이자 시간당 {market.interestBps / 100}% · 손실이 증거금의 {market.liquidationBps / 100}%에 닿으면 강제 청산 · 수익이 증거금의 {market.capMultiple}배면 자동 익절</p>
            {!economy.gambling.houseOpen && <p className="mt-1 text-xs text-gold-200">하우스가 열리면 배율 한도가 올라갑니다.</p>}
          </Frame>

          {positions.length > 0 && (
            <section className="mb-4 space-y-3" aria-label="내 포지션">
              <h2 className="deco-title text-lg">내 포지션</h2>
              {positions.map((row) => <PositionCard key={row.id} row={row} tick={tick} market={market} />)}
            </section>
          )}

          <section aria-label="환전가 소식">
            <h2 className="deco-title mb-2 text-lg">환전가 소식</h2>
            {feed.length === 0 ? <p className="text-sm text-mist">아직 조용합니다.</p> : (
              <ul className="space-y-2">
                {feed.map((row) => (
                  <li key={row.id} className={cx("feed-line bg-ink/30 px-3 py-2 text-sm", `feed-${row.data.tone}`)}>
                    <p className="text-[0.7rem] text-mist">{row.data.coin ? <span style={{ color: COINS[row.data.coin].accent }}>{row.data.coin}</span> : "도시"} · {formatDate(row.data.at?.toMillis?.() ?? 0)}</p>
                    <p className="mt-0.5">{row.data.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function BoardRow({ coin, tape, halted }: { coin: CoinId; tape: ReturnType<typeof useTape>; halted: boolean }) {
  const def = COINS[coin], tick = tape.latest?.tick ?? null;
  const price = tick?.p[coin];
  const direction = directionOf(tick, coin);
  const change = changeText(price ?? 0, openingPrice(tape.hours, coin));
  const state = tick?.st.coins[coin];
  const liberated = def.districtId !== null && tick?.st.liberated.includes(def.districtId);
  return (
    <li className="board-row">
      <Link to={`/market/${coin}`} className="flex items-center gap-3 px-1 py-2.5">
        <CoinBadge coin={coin} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold" style={{ color: def.accent }}>{def.name}</p>
          <p className="truncate text-[0.7rem] text-mist">
            {def.place}
            {halted && <span className="ml-1 text-[#f2b3aa]">· 거래 정지</span>}
            {!halted && state?.storm && <span className="ml-1 text-gold-200">· 폭풍</span>}
            {liberated && <span className="ml-1 text-[#a9ecc9]">· 해방</span>}
          </p>
        </div>
        <Sparkline hours={tape.hours} coin={coin} className="hidden min-[380px]:block" />
        <div className="text-right">
          <span key={tick?.seq} className={cx("inline-block rounded-sm px-0.5 text-base", direction > 0 && "tick-up", direction < 0 && "tick-down")}>
            <FlapText text={priceText(price)} />
          </span>
          <p className={cx("num text-[0.7rem]", `tone-${change.tone}`)}>{change.text}</p>
        </div>
      </Link>
    </li>
  );
}
