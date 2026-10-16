import { Link } from "react-router";
import {
  ANALYSTS, COINS, COIN_IDS, consensus, earningsIndex, moodWords, nextEarnings, weekCalendar, weekIndexAt,
  type CoinId, type FundamentalsDoc, type TickDoc,
} from "@fortuna/core";
import type { Timestamp } from "firebase/firestore";
import { usePlayer } from "../session/player.tsx";
import { Frame, PageTitle, cx } from "../ui/kit.tsx";
import { VenueTabs } from "../pages/VenueList.tsx";
import { CoinBadge, FearGreedGauge, priceText } from "./pieces.tsx";
import { latestReports, useFundamentals, useRateEvents, useReports, useTape } from "./useMarket.ts";
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
      <VenueTabs active="market" />
      <Link to="/market" className="btn btn-ghost btn-sm mb-3">← 시세판</Link>
      <PageTitle eyebrow="MARKET INFO" title="시장 정보" line="실적, 리포트, 일정. 진짜 기준가는 아무도 말해 주지 않는다." />

      {tick?.fx && (
        <Frame className="mb-4">
          <h2 className="deco-title mb-2 text-lg">오늘의 분위기</h2>
          <FearGreedGauge value={tick.fx.fg} />
          <p className="mt-2 text-xs text-mist">오른 종목 비율, FTN 추세, 변동성, 강제 청산, 롱 쏠림으로 계산합니다. 시장의 숨은 흐름을 비추는 계기판일 뿐, 예언은 아닙니다.</p>
        </Frame>
      )}

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
