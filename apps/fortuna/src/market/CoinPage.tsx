import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ANALYSTS, COINS, consensus, fundingRate, nextFundingAt, earningsIndex, entryPaused, isCoinId, leverageChoices, maxLeverage, moodWords, nextEarnings, quoteOpen, type CoinId, type MarketConfig, type OpenQuote, type Side } from "@fortuna/core";
import { openPosition } from "@fortuna/data";
import { usePlayer } from "../session/player.tsx";
import { cue } from "../fx/cues.ts";
import { wait } from "../fx/settings.ts";
import { Coins, Frame, Modal, Notice, cx, formatDate, useAction } from "../ui/kit.tsx";
import { ChartBoundary, INDICATORS, PriceChart, type ChartFlag, type ChartLine, type Indicator } from "./PriceChart.tsx";
import { PositionCard } from "./Positions.tsx";
import { SpotPanel } from "./SpotPanel.tsx";
import { CoinBadge, FlapText, LiquidationMap, LongShortBar, changeText, priceText } from "./pieces.tsx";
import { directionOf, latestReports, openingPrice, useCountdown, useFeed, useFundamentals, useMarketConfig, useMyPositions, useReports, useTape } from "./useMarket.ts";
import "./market.css";

const INDICATOR_KEY = "fortuna:market:indicators";
function readIndicators(): Indicator[] {
  try { return (window.localStorage.getItem(INDICATOR_KEY) ?? "vol").split(",").filter((id): id is Indicator => INDICATORS.some((entry) => entry.id === id)); } catch { return ["vol"]; }
}

const FRAMES = [{ minutes: 1, label: "1분" }, { minutes: 5, label: "5분" }, { minutes: 15, label: "15분" }, { minutes: 60, label: "1시간" }] as const;

export default function CoinPage() {
  const { coin: raw } = useParams();
  if (!isCoinId(raw)) return <Notice>없는 종목입니다. <Link to="/market" className="underline">시세판으로</Link></Notice>;
  return <CoinView coin={raw} />;
}

function CoinView({ coin }: { coin: CoinId }) {
  const { session } = usePlayer();
  const now = () => session.clock.now();
  const def = COINS[coin];
  const [minutes, setMinutes] = useState<number>(5);
  const history = minutes >= 60 ? 22 : minutes >= 15 ? 10 : minutes >= 5 ? 4 : 0;
  const { config: market } = useMarketConfig();
  const tape = useTape(now, history);
  const tick = tape.latest?.tick ?? null;
  const price = tick?.p[coin];
  const left = useCountdown(tick, market.tickSeconds, now);
  const change = changeText(price ?? 0, openingPrice(tape.hours, coin));
  const positions = useMyPositions().filter((row) => row.data.coin === coin);
  const feed = useFeed(40, coin);
  const direction = directionOf(tick, coin);
  const [indicators, setIndicators] = useState<Indicator[]>(readIndicators);
  const [lastChip, setLastChip] = useState<Indicator | null>(null);
  function toggle(id: Indicator) {
    const next = indicators.includes(id) ? indicators.filter((entry) => entry !== id) : [...indicators, id];
    setLastChip(next.includes(id) ? id : null);
    setIndicators(next);
    try { window.localStorage.setItem(INDICATOR_KEY, next.join(",")); } catch { /* not remembered */ }
  }
  const fx = tick?.fx;
  const fundamentals = useFundamentals();
  const report = latestReports(useReports(20)).get(coin);
  const earned = tick?.st.coins[coin].eh ?? [];

  const lines: ChartLine[] = positions.filter((row) => row.data.status === "open").flatMap((row) => [
    { price: row.data.entry, color: "#e6c564", title: `${row.data.side === "long" ? "롱" : "숏"} 진입` },
    { price: row.data.liq, color: "#e06a5c", title: "청산가" },
  ]);
  const flags: ChartFlag[] = feed.filter((row) => row.data.coin === coin).map((row) => ({ atMs: row.data.at?.toMillis?.() ?? 0, tone: row.data.tone, text: row.data.text }));

  return (
    <div>
      <Link to="/market" className="btn btn-ghost btn-sm mb-3">← 시세판</Link>
      <header className="mb-3 flex items-center gap-3">
        <CoinBadge coin={coin} />
        <div className="min-w-0 flex-1">
          <h1 className="deco-title text-2xl leading-tight" style={{ color: def.accent }}>{def.name}</h1>
          <p className="text-xs text-mist">{coin} · {def.place}</p>
        </div>
        <div className="text-right">
          <span key={tick?.seq} className={cx("inline-block rounded-sm px-1 text-xl", direction > 0 && "tick-up", direction < 0 && "tick-down")}><FlapText text={priceText(price)} /></span>
          <p className={cx("num text-xs", `tone-${change.tone}`)}>{change.text} · {left > 0 ? `다음 ${left}초` : "갱신 중…"}</p>
        </div>
      </header>
      <p className="mb-3 text-sm text-mist">{def.trait}</p>

      <Frame className="mb-4 !p-2">
        <div className="mb-2 flex gap-1" role="tablist" aria-label="봉 단위">
          {FRAMES.map((frame) => (
            <button key={frame.minutes} type="button" role="tab" aria-selected={minutes === frame.minutes} className={cx("btn btn-sm", minutes === frame.minutes ? "btn-gold" : "btn-dark")} onClick={() => setMinutes(frame.minutes)}>{frame.label}</button>
          ))}
        </div>
        <ChartBoundary resetKey={`${coin}:${minutes}`}>
          <PriceChart hours={tape.hours} coin={coin} minutes={minutes} lines={lines} flags={flags} accent={def.accent} indicators={indicators} />
        </ChartBoundary>
        <div className="mt-2 flex flex-wrap gap-1" aria-label="보조지표">
          {INDICATORS.map((entry) => (
            <button key={entry.id} type="button" title={entry.hint} aria-pressed={indicators.includes(entry.id)} onClick={() => toggle(entry.id)}
              className={cx("btn btn-sm", indicators.includes(entry.id) ? "btn-gold" : "btn-dark")}>{entry.label}</button>
          ))}
        </div>
        {lastChip && <p className="mt-1 px-1 text-[0.7rem] leading-snug text-mist">{INDICATORS.find((entry) => entry.id === lastChip)!.label}: {INDICATORS.find((entry) => entry.id === lastChip)!.hint}</p>}
      </Frame>

      {market.earnings && (
        <Frame className="mb-4">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="deco-title text-lg">가치</h2>
            <Link to="/market/info" className="text-xs text-mist underline">시장 정보</Link>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-mist">다음 {coin === "FTN" ? "경기 보고" : "실적 발표"}</dt>
            <dd className="text-right">{new Intl.DateTimeFormat("ko-KR", { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Seoul" }).format(nextEarnings(coin, now()))}</dd>
            <dt className="text-mist">예상치 · 지난 실적</dt>
            <dd className="num text-right">{earningsIndex(consensus(earned))} · {earned.length ? earningsIndex(earned.at(-1)!) : "—"}</dd>
            <dt className="text-mist">활동 배수</dt>
            <dd className="num text-right" title="가격 ÷ (원래 기준가 × 지난 실적 지수). 낮을수록 활동에 비해 싸다.">{price && earned.length ? (price / (def.anchor * (1 + earned.at(-1)!))).toFixed(2) : "—"}</dd>
            <dt className="text-mist">업계 분위기</dt>
            <dd className="text-right">{fundamentals ? moodWords(fundamentals.coins[coin].mood) : "—"}</dd>
            {ANALYSTS[coin] && <>
              <dt className="text-mist">{ANALYSTS[coin]!.name}</dt>
              <dd className="num text-right">{report ? `${priceText(report.report.low)}~${priceText(report.report.high)}` : "리포트 전"}</dd>
            </>}
            {report && price && <>
              <dt className="text-mist">리포트 적정가 대비</dt>
              <dd className={cx("num text-right", price < report.report.mid ? "tone-up" : "tone-down")}>{((price / report.report.mid) * 100).toFixed(0)}%</dd>
            </>}
          </dl>
        </Frame>
      )}

      {fx && (
        <Frame className="mb-4">
          <div className="mb-3">
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-[#a9ecc9]">롱 {fx.ls[coin][0].toLocaleString("ko-KR")}</span>
              <span className="text-mist">롱/숏 (주민 군중 + 플레이어)</span>
              <span className="text-[#f2b3aa]">숏 {fx.ls[coin][1].toLocaleString("ko-KR")}</span>
            </div>
            <LongShortBar ls={fx.ls[coin]} />
            {market.funding && (() => {
              const rate = fundingRate(fx.ls[coin][0], fx.ls[coin][1]);
              const left = Math.max(0, Math.ceil((nextFundingAt(now()) - now()) / 60_000));
              return (
                <p className="mt-1 text-xs text-mist" title="매 정시에 롱·숏 쏠림만큼 펀딩을 주고받습니다. 많은 쪽이 내고 적은 쪽이 받습니다(상대는 지배인 금고).">
                  펀딩률 <b className={cx("num", rate > 0 ? "text-[#f2b3aa]" : rate < 0 ? "text-[#a9ecc9]" : "text-ivory")}>{rate >= 0 ? "+" : ""}{(rate * 100).toFixed(3)}%</b>/시간
                  · {rate > 0 ? "롱이 내고 숏이 받음" : rate < 0 ? "숏이 내고 롱이 받음" : "주고받을 것 없음"} · 다음 정산 {left}분 뒤
                </p>
              );
            })()}
          </div>
          <LiquidationMap lm={fx.lm[coin]} price={priceText(price)} />
        </Frame>
      )}

      {positions.length > 0 && (
        <section className="mb-4 space-y-3" aria-label="이 종목의 내 포지션">
          {positions.map((row) => <PositionCard key={row.id} row={row} tick={tick} market={market} />)}
        </section>
      )}

      <TradePanel coin={coin} market={market} price={price ?? null} stale={!tick || now() - tick.at.toMillis() > market.staleSeconds * 1000} paused={entryPaused(market, coin, tick?.st.liberated ?? [])} />

      {feed.some((row) => row.data.coin === coin) && (
        <section className="mt-5" aria-label="이 종목 소식">
          <h2 className="deco-title mb-2 text-lg">{def.place} 소식</h2>
          <ul className="space-y-2">
            {feed.filter((row) => row.data.coin === coin).slice(0, 8).map((row) => (
              <li key={row.id} className={cx("feed-line bg-ink/30 px-3 py-2 text-sm", `feed-${row.data.tone}`)}>
                <p className="text-[0.7rem] text-mist">{formatDate(row.data.at?.toMillis?.() ?? 0)}</p>
                <p className="mt-0.5">{row.data.text}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const MARGIN_STEPS = [10, 50, 100, 500];

type Mode = "spot" | "futures";
const MODE_KEY = "fortuna:market:mode";

function readMode(): Mode {
  try { return window.localStorage.getItem(MODE_KEY) === "futures" ? "futures" : "spot"; } catch { return "spot"; }
}

/** 현물 | 선물. The last choice is remembered on this device. */
function TradePanel(props: { coin: CoinId; market: MarketConfig; price: number | null; stale: boolean; paused: boolean }) {
  const [mode, setMode] = useState<Mode>(readMode);
  function choose(next: Mode) {
    setMode(next);
    try { window.localStorage.setItem(MODE_KEY, next); } catch { /* private mode: not remembered */ }
  }
  return (
    <Frame>
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-sm border border-gold-400/30 bg-ink/60 p-1" role="tablist" aria-label="거래 방식">
        <button type="button" role="tab" aria-selected={mode === "spot"} className={cx("btn btn-sm", mode === "spot" ? "btn-gold" : "btn-dark border-0")} onClick={() => choose("spot")}>현물 · 사고팔기</button>
        <button type="button" role="tab" aria-selected={mode === "futures"} className={cx("btn btn-sm", mode === "futures" ? "btn-gold" : "btn-dark border-0")} onClick={() => choose("futures")}>선물 · 레버리지</button>
      </div>
      {mode === "spot" ? <SpotPanel {...props} /> : <OrderPanel {...props} />}
    </Frame>
  );
}

function OrderPanel({ coin, market, price, stale, paused }: { coin: CoinId; market: MarketConfig; price: number | null; stale: boolean; paused: boolean }) {
  const { session, wallet, player, config: economy } = usePlayer();
  const { busy, run } = useAction();
  const houseOpen = economy.gambling.houseOpen;
  const choices = leverageChoices(market, coin, houseOpen);
  const [side, setSide] = useState<Side>("long");
  const [leverage, setLeverage] = useState<number>(choices.includes(3) ? 3 : choices[0] ?? 1);
  const [margin, setMargin] = useState<number>(100);
  const [slip, setSlip] = useState<OpenQuote | null>(null);
  const [stamped, setStamped] = useState(false);
  const counters = wallet.market ?? { period: -1, used: 0, open: 0 };
  const usedToday = counters.period === session.clock.period(economy.limitPeriod) ? counters.used : 0;
  const quote = useMemo(() => (price ? quoteOpen(market, coin, side, leverage, Number.isFinite(margin) ? margin : 0, price) : null), [market, coin, side, leverage, margin, price]);
  const maxAffordable = Math.max(0, Math.min(market.maxMargin, wallet.balance - (quote ? quote.fee : market.minFee) - 1));
  const lockedSteps = market.leverage.steps.filter((step) => step > maxLeverage(market, coin, houseOpen) && step <= maxLeverage(market, coin, true));

  const problem = !market.coins[coin].enabled ? "이 종목은 거래가 잠시 멈췄습니다."
    : paused ? "간부전 결과가 나올 때까지 이 종목의 새 진입이 멈췄습니다. 가진 포지션은 청산할 수 있습니다."
    : stale ? "시세 기록원이 멈춰 있습니다. 잠시 후 다시 시도해 주세요."
    : usedToday >= market.dailyLimit ? "오늘 새 거래를 모두 열었습니다."
    : counters.open >= market.maxOpen ? `포지션은 동시에 ${market.maxOpen}개까지입니다.`
    : !Number.isInteger(margin) || margin < market.minMargin || margin > market.maxMargin ? `증거금은 ${market.minMargin}~${market.maxMargin.toLocaleString("ko-KR")}코인입니다.`
    : quote && quote.cost > wallet.balance ? "잔액이 부족합니다." : null;

  async function submit(target: OpenQuote) {
    const result = await run(() => openPosition(session, { coin, side: target.side, leverage: target.leverage, margin: target.margin }));
    if (!result) { setSlip(null); setStamped(false); return; }
    cue("chip");
    if (target.leverage > 1) { setStamped(true); cue("stamp"); await wait(900); }
    setSlip(null); setStamped(false);
  }

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <button type="button" className={cx("btn border", side === "long" ? "btn-gold" : "btn-dark side-long")} aria-pressed={side === "long"} onClick={() => setSide("long")}>롱 ▲ 오른다</button>
        <button type="button" className={cx("btn border", side === "short" ? "btn-gold" : "btn-dark side-short")} aria-pressed={side === "short"} onClick={() => setSide("short")}>숏 ▼ 내린다</button>
      </div>

      <label className="block">
        <span className="field-label">증거금 (코인)</span>
        <input className="field num" type="number" inputMode="numeric" min={market.minMargin} max={market.maxMargin} value={Number.isFinite(margin) ? margin : ""}
          onChange={(event) => setMargin(event.target.value === "" ? Number.NaN : Math.floor(Number(event.target.value)))} />
      </label>
      <div className="mt-2 flex flex-wrap gap-1">
        {MARGIN_STEPS.map((step) => <button key={step} type="button" className="btn btn-dark btn-sm" onClick={() => setMargin(step)}>{step}</button>)}
        <button type="button" className="btn btn-dark btn-sm" onClick={() => setMargin(maxAffordable)}>최대</button>
      </div>

      <p className="field-label mt-3">배율</p>
      <div className="flex flex-wrap gap-1">
        {choices.map((step) => (
          <button key={step} type="button" aria-pressed={leverage === step} className={cx("btn btn-sm min-w-12", leverage === step ? "btn-gold" : "btn-dark")} onClick={() => setLeverage(step)}>{step}배</button>
        ))}
        {lockedSteps.map((step) => <span key={step} className="btn btn-sm min-w-12 cursor-not-allowed opacity-40" title="하우스가 열리면">🔒 {step}배</span>)}
      </div>

      {quote && (
        <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-mist">진입가 (현재)</dt><dd className="num text-right">{priceText(quote.entry)}</dd>
          <dt className="text-mist">명목가</dt><dd className="text-right"><Coins value={quote.notional} /></dd>
          <dt className="text-mist">지배인에게 빌림</dt><dd className="text-right"><Coins value={quote.borrowed} /></dd>
          <dt className="text-mist">강제 청산가</dt><dd className="num text-right text-[#f2b3aa]">{priceText(quote.liq)}</dd>
          <dt className="text-mist">자동 익절가</dt><dd className="num text-right text-[#a9ecc9]">{quote.cap > 0 ? priceText(quote.cap) : "없음"}</dd>
          <dt className="text-mist">수수료 (진입 / 청산)</dt><dd className="text-right"><Coins value={quote.fee} /> / <Coins value={quote.fee} /></dd>
          <dt className="text-mist">이자 (시간당)</dt><dd className="text-right"><Coins value={quote.interestPerHour} /></dd>
          <dt className="font-bold">지금 내는 돈</dt><dd className="text-right font-bold"><Coins value={quote.cost} /></dd>
        </dl>
      )}

      {problem && <div className="mt-3"><Notice>{problem}</Notice></div>}
      <button
        type="button" className="btn btn-gold mt-4 w-full" disabled={busy || !quote || Boolean(problem)}
        onClick={() => { if (!quote) return; if (quote.leverage > 1) { cue("tap"); setSlip(quote); } else void submit(quote); }}
      >
        {side === "long" ? "롱 진입" : "숏 진입"} · {leverage}배
      </button>

      <Modal open={slip !== null} onClose={() => { if (!busy) { setSlip(null); setStamped(false); } }} title="지배인 대출 약정서">
        {slip && (
          <div className="loan-slip relative rounded-sm p-4 text-sm leading-7">
            <p className="text-center font-bold tracking-widest">대 출 약 정 서</p>
            <p className="mt-2">차용인 <b>{player.name}</b>은(는) {COINS[slip.coin].name} {slip.side === "long" ? "롱" : "숏"} {slip.leverage}배 거래를 위하여 아래 금액을 빌린다.</p>
            <ul className="mt-1 list-disc pl-5">
              <li>빌리는 돈 <b className="num">{slip.borrowed.toLocaleString("ko-KR")}</b>코인 · 증거금 <b className="num">{slip.margin.toLocaleString("ko-KR")}</b>코인</li>
              <li>이자: 시작한 한 시간마다 <b className="num">{slip.interestPerHour.toLocaleString("ko-KR")}</b>코인</li>
              <li>손실이 증거금의 {market.liquidationBps / 100}%에 닿으면 담보를 회수한다 (청산가 <span className="num">{priceText(slip.liq)}</span>)</li>
            </ul>
            <p className="mt-2 text-right text-xs">포르투나 환전가 · 대여인 지배인</p>
            {stamped && <span className="loan-stamp stamp-in absolute bottom-6 left-6 px-3 py-1 text-base">접 수</span>}
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setSlip(null); setStamped(false); }}>그만두기</button>
          <button type="button" className="btn btn-gold" disabled={busy || stamped} onClick={() => { if (slip) void submit(slip); }}>{busy ? "접수 중…" : "서명하고 진입"}</button>
        </div>
      </Modal>
    </>
  );
}

