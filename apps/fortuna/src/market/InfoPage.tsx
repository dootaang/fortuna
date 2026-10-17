import { Link } from "react-router";
import {
  ANALYSTS, COINS, COIN_IDS, INFO_PRODUCTS, SECTORS, SECTOR_IDS, consensus, earningsIndex, moodWords, nextEarnings, weekCalendar, weekIndexAt,
  type CoinId, type InfoKind, type FundamentalsDoc, type StatsDoc, type TickDoc,
} from "@fortuna/core";
import type { Timestamp } from "firebase/firestore";
import { usePlayer } from "../session/player.tsx";
import { Frame, PageTitle, cx } from "../ui/kit.tsx";
import { CoinBadge, FearGreedGauge, priceText } from "./pieces.tsx";
import { latestReports, useFundamentals, useInfoRequests, useMarketConfig, useRateEvents, useReports, useStats, useTape } from "./useMarket.ts";
import { useState } from "react";
import { buyInfo } from "@fortuna/data";
import { Coins, useAction, useToast } from "../ui/kit.tsx";
import { cue } from "../fx/cues.ts";
import "./market.css";

/**
 * 시장 정보 (docs/SPEC-MARKET-DEPTH.md 7절): 오늘의 분위기, 경제 캘린더, 구역 실적판, 리포트.
 * Only a few documents; nothing here moves money.
 */
const when = (ms: number) => new Intl.DateTimeFormat("ko-KR", { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Seoul" }).format(ms);

export default function InfoPage() {
  const { session } = usePlayer();
  const now = session.clock.now();
  const tape = useTape(() => session.clock.now(), 0);
  const tick = tape.latest?.tick ?? null;
  const fundamentals = useFundamentals();
  const reports = latestReports(useReports());
  const rates = useRateEvents().map((row) => ({ atMs: row.data.at?.toMillis?.() ?? 0, bps: row.data.bps }));
  const week = weekIndexAt(now);
  const calendar = weekCalendar(week, rates);

  return (
    <div>
      <Link to="/market" className="btn btn-ghost btn-sm mb-3">← 시세판</Link>
      <PageTitle eyebrow="MARKET INFO" title="시장 정보" line="실적, 리포트, 일정. 진짜 기준가는 아무도 말해 주지 않는다." />

      {tick?.fx && (
        <Frame className="mb-4">
          <h2 className="deco-title mb-2 text-lg">오늘의 분위기</h2>
          <FearGreedGauge value={tick.fx.fg} />
          <p className="mt-2 text-xs text-mist">오른 종목 비율, FTN 추세, 변동성, 강제 청산, 롱 쏠림으로 계산합니다. 시장의 숨은 흐름을 비추는 계기판일 뿐, 예언은 아닙니다.</p>
        </Frame>
      )}

      <StatsPanels />

      <Frame className="mb-4">
        <h2 className="deco-title mb-2 text-lg">이번 주 일정</h2>
        <ul className="space-y-1 text-sm">
          {calendar.map((item, index) => {
            const past = item.atMs !== null && item.atMs < now;
            return (
              <li key={index} className={cx("flex gap-3", past && "opacity-45")}>
                <span className="num w-24 shrink-0 whitespace-nowrap text-mist">{item.atMs === null ? "수시" : when(item.atMs)}</span>
                <span className="min-w-0 flex-1">{item.coin && <span className="mr-1 font-bold" style={{ color: COINS[item.coin].accent }}>{item.coin}</span>}{item.text}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-mist">결과는 모르지만 언제 출렁일지는 압니다. 실적 발표 한 시간 전부터 그 종목은 조금 더 흔들립니다.</p>
      </Frame>

      <section className="mb-4" aria-label="구역 실적판">
        <h2 className="deco-title mb-2 text-lg">구역 실적판</h2>
        <ul className="space-y-2">
          {COIN_IDS.map((coin) => <EarningsRow key={coin} coin={coin} tick={tick} fundamentals={fundamentals} nowMs={now} />)}
        </ul>
        <p className="mt-2 text-xs leading-relaxed text-mist">
          실적 = 그 구역 NPC 주민 몫(비밀) + 플레이어 주민 몫(공개, 최대 ±6%). 주민 활동은 일·빚 상환·특기 사용을 한 사람의 보통 한 주(일 35회, 상환 300코인, 특기 2회)와 비교합니다.
          업계 분위기는 흐린 단서이고, 발표가 가까울수록 덜 흐려집니다. 휠 광장은 도박 판 열기, FTN은 도시 전체 주민으로 셉니다.
        </p>
      </section>

      <InfoShop />

      <section aria-label="리포트">
        <h2 className="deco-title mb-2 text-lg">애널리스트 리포트</h2>
        {reports.size === 0 ? <p className="text-sm text-mist">아직 나온 리포트가 없습니다. 실적 발표 다음 날 정오에 나옵니다.</p> : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {[...reports.values()].map(({ report, hits, scored }) => (
              <li key={report.coin} className="deco-frame p-3 text-sm">
                <p className="flex items-center gap-2">
                  <CoinBadge coin={report.coin} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{report.writer}</span>
                    <span className="block text-[0.7rem] text-mist">{report.at ? when(report.at.toMillis()) : ""} · 적중 {scored ? `${hits}/${scored}` : "기록 없음"}</span>
                  </span>
                </p>
                <p className="num mt-2">적정가 <b className="text-gold-200">{priceText(report.low)} ~ {priceText(report.high)}</b></p>
                {tick && <p className="text-xs text-mist">지금 {priceText(tick.p[report.coin])} · 적정가 중앙 대비 {((tick.p[report.coin] / report.mid) * 100).toFixed(0)}%</p>}
                {report.prev && <p className={cx("mt-1 text-xs", report.prev.hit ? "text-[#a9ecc9]" : "text-[#f2b3aa]")}>지난 리포트 {priceText(report.prev.low)}~{priceText(report.prev.high)} → {report.prev.hit ? "적중" : "빗나감"}</p>}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-mist">필자마다 버릇이 있습니다. 누구 말을 믿을지는 적중 기록을 보고 정하십시오. 지배인은 FTN에 대해 말하지 않습니다.</p>
      </section>
    </div>
  );
}

function EarningsRow({ coin, tick, fundamentals, nowMs }: { coin: CoinId; tick: TickDoc<Timestamp> | null; fundamentals: FundamentalsDoc<Timestamp> | null; nowMs: number }) {
  const def = COINS[coin], state = tick?.st.coins[coin], f = fundamentals?.coins[coin];
  const history = state?.eh ?? [], last = history.at(-1);
  const expect = consensus(history);
  return (
    <li className="deco-frame p-3 text-sm">
      <div className="flex items-center gap-2">
        <CoinBadge coin={coin} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="font-bold" style={{ color: def.accent }}>{coin === "FTN" ? "도시 경기" : def.place}</p>
          <p className="text-[0.7rem] text-mist">다음 발표 {when(nextEarnings(coin, nowMs))}{ANALYSTS[coin] ? ` · ${ANALYSTS[coin]!.name}` : ""}</p>
        </div>
        <div className="text-right text-xs">
          <p>예상치 <b className="num text-gold-200">{earningsIndex(expect)}</b></p>
          {last !== undefined && <p className={cx("num", last > expect ? "tone-up" : last < expect ? "tone-down" : "text-mist")}>지난 실적 {earningsIndex(last)}</p>}
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-mist">업계 분위기</dt><dd className="text-right">{f ? moodWords(f.mood) : "—"}</dd>
        <dt className="text-mist">{coin === "WHL" ? "판 열기" : "주민 활동"}</dt>
        <dd className="text-right">
          {coin === "WHL" ? (tick ? `보통 대비 ${Math.round((tick.st.heatF - 1) * 1_000) / 10}%` : "—")
            : f?.ratio === null || f?.ratio === undefined ? "플레이어 주민 없음" : `보통 대비 ${f.ratio >= 1 ? "+" : ""}${Math.round((f.ratio - 1) * 100)}% (${f.residents}명)`}
        </dd>
        <dt className="text-mist">플레이어 몫</dt><dd className={cx("num text-right", (f?.spc ?? 0) > 0 ? "tone-up" : (f?.spc ?? 0) < 0 ? "tone-down" : "")}>{f ? `${f.spc > 0 ? "+" : ""}${(f.spc * 100).toFixed(1)}%` : "—"}</dd>
      </dl>
    </li>
  );
}

/** 도미넌스 · 섹터 · 상관계수 (7단계). */
function StatsPanels() {
  const stats = useStats();
  if (!stats) return null;
  return (
    <>
      <Frame className="mb-4">
        <h2 className="deco-title mb-1 text-lg">FTN 도미넌스 <span className="num text-gold-200">{(stats.dominance * 100).toFixed(1)}%</span></h2>
        <p className="mb-2 text-xs text-mist">도시 전체 시가총액 가운데 FTN의 몫. 빠지기 시작하면 돈이 구역 코인으로 옮겨 가는 중이라는 뜻일 수 있다.</p>
        <DominanceLine values={stats.domHistory} />
      </Frame>

      <Frame className="mb-4">
        <h2 className="deco-title mb-2 text-lg">섹터 24시간</h2>
        <div className="grid grid-cols-3 gap-2">
          {SECTOR_IDS.map((id) => {
            const change = stats.sectors[id];
            return (
              <div key={id} className={cx("rounded-sm border p-2 text-center", change > 0.002 ? "border-[#4fc08d]/50 bg-[#4fc08d]/15" : change < -0.002 ? "border-[#c4473a]/50 bg-[#c4473a]/15" : "border-gold-400/20")}>
                <p className="text-sm font-bold">{SECTORS[id].label}</p>
                <p className={cx("num text-sm", change > 0 ? "tone-up" : change < 0 ? "tone-down" : "")}>{change > 0 ? "+" : ""}{(change * 100).toFixed(2)}%</p>
                <p className="text-[0.65rem] text-mist">{SECTORS[id].coins.join(" · ")}</p>
              </div>
            );
          })}
        </div>
      </Frame>

      <Frame className="mb-4">
        <h2 className="deco-title mb-1 text-lg">함께 움직이는 정도</h2>
        <p className="mb-2 text-xs text-mist">최근 3일 시간별 등락의 상관계수. 진할수록 같이 움직인다. 칸이 전부 진해지면 시장이 한 몸처럼 움직이는 중이다.</p>
        <CorrelationGrid corr={stats.corr} />
      </Frame>
    </>
  );
}

function DominanceLine({ values }: { values: number[] }) {
  if (values.length < 2) return <p className="text-xs text-mist">기록이 쌓이는 중입니다.</p>;
  const min = Math.min(...values), max = Math.max(...values), span = Math.max(0.005, max - min);
  const path = values.map((value, index) => `${(index / (values.length - 1)) * 300},${58 - ((value - min) / span) * 52}`).join(" ");
  const day = values.length > 24 ? values.at(-1)! - values.at(-25)! : null, week = values.at(-1)! - values[0]!;
  return (
    <div>
      <svg viewBox="0 0 300 60" className="h-16 w-full" role="img" aria-label="FTN 도미넌스 추이">
        <polyline points={path} fill="none" stroke="#e6c564" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <p className="text-xs text-mist">
        {day !== null && <>24시간 <span className={cx("num", day > 0 ? "tone-up" : day < 0 ? "tone-down" : "")}>{day > 0 ? "+" : ""}{(day * 100).toFixed(1)}%p</span> · </>}
        {Math.round(values.length / 24)}일 <span className={cx("num", week > 0 ? "tone-up" : week < 0 ? "tone-down" : "")}>{week > 0 ? "+" : ""}{(week * 100).toFixed(1)}%p</span>
      </p>
    </div>
  );
}

function CorrelationGrid({ corr }: { corr: Record<CoinId, number[]> }) {
  return (
    <div className="overflow-x-auto">
      <table className="num mx-auto text-[0.65rem]">
        <thead>
          <tr><th />{COIN_IDS.map((id) => <th key={id} className="px-0.5 font-normal" style={{ color: COINS[id].accent }}>{id}</th>)}</tr>
        </thead>
        <tbody>
          {COIN_IDS.map((row, i) => (
            <tr key={row}>
              <th className="pr-1 text-right font-normal" style={{ color: COINS[row].accent }}>{row}</th>
              {COIN_IDS.map((col, j) => {
                const value = corr[row]?.[j] ?? 0;
                return (
                  <td key={col} className="h-7 w-8 text-center" title={`${row}–${col} ${value.toFixed(2)}`}
                    style={{ background: value >= 0 ? `rgba(212,175,55,${Math.min(1, Math.abs(value)) * 0.75})` : `rgba(127,183,217,${Math.min(1, Math.abs(value)) * 0.75})`, color: Math.abs(value) > 0.55 ? "#0b0809" : undefined }}>
                    {i === j ? "" : value.toFixed(1)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 정보 구매 (7단계): paid hints answered by the recorder within about a minute. */
function InfoShop() {
  const { session } = usePlayer();
  const { config: market } = useMarketConfig();
  const requests = useInfoRequests();
  const [coin, setCoin] = useState<CoinId>("LNH");
  const { busy, run } = useAction();
  const toast = useToast();
  if (!market.info.enabled) return null;
  async function buy(kind: InfoKind) {
    const id = await run(() => buyInfo(session, kind, coin));
    if (id) { cue("chip"); toast("success", `${INFO_PRODUCTS[kind].name}를 샀습니다. 곧 답이 옵니다.`); }
  }
  return (
    <Frame className="mb-4">
      <h2 className="deco-title mb-1 text-lg">정보 사기</h2>
      <p className="mb-2 text-xs text-mist">확률로만 맞는 귀띔입니다. {market.info.dailyLimit}건까지 살 수 있고, 답은 1분쯤 뒤에 옵니다.</p>
      <label className="mb-2 block">
        <span className="field-label">종목</span>
        <select className="field" value={coin} onChange={(event) => setCoin(event.target.value as CoinId)}>
          {COIN_IDS.map((id) => <option key={id} value={id}>{id} · {COINS[id].place}</option>)}
        </select>
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        {(["rumor", "peek"] as const).map((kind) => (
          <div key={kind} className="rounded-sm border border-gold-400/25 p-2">
            <p className="font-bold">{INFO_PRODUCTS[kind].name} <Coins value={kind === "rumor" ? market.info.rumorPrice : market.info.peekPrice} /></p>
            <p className="mt-0.5 text-xs text-mist">{INFO_PRODUCTS[kind].blurb}</p>
            <button type="button" className="btn btn-dark btn-sm mt-2 w-full" disabled={busy} onClick={() => void buy(kind)}>{coin} {INFO_PRODUCTS[kind].name} 사기</button>
          </div>
        ))}
      </div>
      {requests.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm" aria-label="받은 답">
          {requests.map((row) => (
            <li key={row.id} className="rounded-sm bg-ink/40 px-2 py-1">
              <span className="text-[0.7rem] text-mist">{row.data.coin} · {INFO_PRODUCTS[row.data.kind].name} · </span>
              {row.data.answer ?? <span className="text-mist">답을 기다리는 중…</span>}
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

