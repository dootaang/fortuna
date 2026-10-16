import { useState } from "react";
import { collection, orderBy, query, limit, where, type CollectionReference, type Timestamp } from "firebase/firestore";
import {
  COINS, COIN_IDS, NEWS_SIZE_LABELS, entryPaused, weekIndexAt, formatPrice, formatUnits, holdingValue, hourIndexAt, liveEquity, normalizeMarket,
  type CoinId, type MarketConfig, type NewsSize, type RateEventDoc,
} from "@fortuna/core";
import { announceBossFight, cancelNews, cancelRate, refs, scheduleRate, registerOracle, saveMarket, scheduleNews, setCoinPaused, voidPosition, type NewsInput } from "@fortuna/data";
import { useLiveDoc, useLiveQuery } from "../session/live.ts";
import { Coins, Empty, Frame, Notice, NumberField, Stat, TextField, Toggle, cx, formatDate, useAction, useToast } from "../ui/kit.tsx";
import { SectionTitle, useDealer } from "./DealerApp.tsx";

export function MarketAdmin() {
  const { session } = useDealer();
  const config = useLiveDoc(refs.marketConfig(session.db), "dealer:market:config");
  const market = config.status === "ready" && config.data ? normalizeMarket(config.data) : null;
  if (config.status === "loading") return <Empty>불러오는 중…</Empty>;
  if (!market) return <Notice>거래소 설정이 없습니다. 설정 › 도시 초기화를 한 번 누르십시오.</Notice>;
  return (
    <div className="space-y-6">
      <Recorder market={market} />
      <OpenPositions market={market} />
      <Holdings />
      <NewsDesk />
      <RateDesk market={market} />
      <WeekLevies market={market} />
      <MarketEditor key={JSON.stringify(market)} market={market} />
    </div>
  );
}

function useLatest() {
  const { session } = useDealer();
  const hour = hourIndexAt(session.clock.now());
  const current = useLiveDoc(refs.marketHour(session.db, hour), `dealer:market:h${hour}`);
  const previous = useLiveDoc(refs.marketHour(session.db, hour - 1), `dealer:market:h${hour - 1}`);
  const doc = (current.status === "ready" && current.data) || (previous.status === "ready" && previous.data) || null;
  return doc ? doc.last : null;
}

/** 시세 기록원 상태와 등록. */
function Recorder({ market }: { market: MarketConfig }) {
  const { session } = useDealer();
  const tick = useLatest();
  const oracles = useLiveQuery(refs.oracles(session.db), "dealer:oracles");
  const [uid, setUid] = useState("");
  const { busy, run } = useAction();
  const ageSeconds = tick ? Math.round((session.clock.now() - tick.at.toMillis()) / 1000) : null;
  const healthy = ageSeconds !== null && ageSeconds <= market.staleSeconds;
  return (
    <Frame>
      <SectionTitle title="시세 기록원" />
      <Notice tone={healthy ? "success" : "error"}>
        {tick ? <>마지막 시세 {formatDate(tick.at.toMillis())} ({ageSeconds}초 전) · 틱 #{tick.seq}{healthy ? " · 정상" : " · 멈춤: 거래가 막혀 있습니다"}</> : "아직 시세가 한 번도 찍히지 않았습니다."}
      </Notice>
      {tick && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs sm:grid-cols-9">
          {COIN_IDS.map((coin) => (
            <div key={coin} className="rounded-sm border border-gold-400/20 p-1.5">
              <p style={{ color: COINS[coin].accent }} className="font-bold">{coin}</p>
              <p className="num">{formatPrice(tick.p[coin])}</p>
              <p className="text-mist">{!market.coins[coin].enabled ? "정지" : tick.st.coins[coin].storm ? "폭풍" : "평온"}</p>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-mist">FTN 빚 연동 {tick ? `×${tick.st.debtF.toFixed(3)}` : ""} · 휠 열기 {tick ? `×${tick.st.heatF.toFixed(3)}` : ""} · 해방 반영 {tick?.st.liberated.length ?? 0}곳</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <TextField label="기록원 UID 등록 (scripts/create-oracle.mjs가 알려 준 값)" value={uid} onChange={setUid} />
        <button type="button" className="btn btn-gold" disabled={busy || !uid.trim()} onClick={() => void run(async () => { await registerOracle(session, uid); setUid(""); }, "등록했습니다.")}>등록</button>
      </div>
      <p className="mt-2 text-xs text-mist">등록된 기록원: {oracles.status === "ready" && oracles.data.length ? oracles.data.map((row) => row.id).join(", ") : "없음"}</p>
    </Frame>
  );
}

function OpenPositions({ market }: { market: MarketConfig }) {
  const { session, players } = useDealer();
  const tick = useLatest();
  const live = useLiveQuery(query(refs.positions(session.db), where("status", "in", ["open", "capped", "liquidated", "void"])), "dealer:positions:open");
  const { busy, run } = useAction();
  const rows = live.status === "ready" ? live.data : [];
  const names = new Map(players.map((row) => [row.id, row.data.name]));
  const now = session.clock.now();
  const figures = rows.filter((row) => row.data.status === "open").map((row) => {
    const position = row.data, price = tick?.p[position.coin] ?? position.entry;
    return { row, price, ...liveEquity(market, { ...position, openedAtMs: position.openedAt?.toMillis?.() ?? now }, price, now) };
  });
  const pnl = figures.reduce((sum, item) => sum + item.pnl, 0);
  const worst = rows.filter((row) => row.data.status === "open").reduce((sum, row) => sum + row.data.margin * (market.capMultiple + 1), 0);
  return (
    <section>
      <SectionTitle title="열린 포지션" />
      <Frame className="mb-3">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="열린 포지션">{figures.length}</Stat>
          <Stat label="플레이어 미실현 손익" tone={pnl > 0 ? "ruby" : "jade"}><Coins value={pnl} signed /></Stat>
          <Stat label="금고 최대 노출" tone="gold"><Coins value={worst} /></Stat>
        </div>
      </Frame>
      {rows.length === 0 ? <Empty>열린 포지션이 없습니다.</Empty> : (
        <div className="deco-frame overflow-x-auto p-2">
          <table className="table min-w-[48rem]">
            <thead><tr><th>플레이어</th><th>종목</th><th>방향</th><th className="text-right">증거금</th><th className="text-right">진입</th><th className="text-right">청산가</th><th className="text-right">손익</th><th>상태</th><th /></tr></thead>
            <tbody>
              {rows.map((row) => {
                const position = row.data, figure = figures.find((item) => item.row.id === row.id);
                return (
                  <tr key={row.id}>
                    <td className="font-bold">{names.get(position.playerId) ?? position.playerId}</td>
                    <td style={{ color: COINS[position.coin].accent }}>{position.coin}</td>
                    <td>{position.side === "long" ? "롱" : "숏"} {position.leverage}배</td>
                    <td className="text-right"><Coins value={position.margin} /></td>
                    <td className="text-right num">{formatPrice(position.entry)}</td>
                    <td className="text-right num">{formatPrice(position.liq)}</td>
                    <td className={cx("text-right num", (figure?.pnl ?? 0) >= 0 ? "text-[#a9ecc9]" : "text-[#f2b3aa]")}>{figure ? figure.pnl.toLocaleString("ko-KR") : "—"}</td>
                    <td className="text-xs">{{ open: "열림", capped: "익절 대기", liquidated: "청산 대기", void: "무효 대기", closed: "정산됨" }[position.status]}</td>
                    <td>
                      {position.status === "open" && (
                        <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => {
                          const memo = window.prompt("무효 사유 (증거금을 돌려줍니다)");
                          if (memo) void run(() => voidPosition(session, row.id, memo), "무효로 했습니다. 플레이어 앱이 증거금을 돌려받습니다.");
                        }}>무효</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const EMPTY_NEWS: NewsInput = { coin: "FTN", dir: 1, size: "s", minutes: 60, headline: "", whisper: "", whisperMinutes: 10, delayMinutes: 0 };

function NewsDesk() {
  const { session, districts } = useDealer();
  const [draft, setDraft] = useState<NewsInput>(EMPTY_NEWS);
  const { busy, run } = useAction();
  const news = useLiveQuery(query(refs.newsList(session.db), orderBy("publishAt", "desc"), limit(15)), "dealer:news");
  const rows = news.status === "ready" ? news.data : [];

  function bossNotice(coin: CoinId) {
    const place = COINS[coin].place;
    if (!window.confirm(`${place} 간부전을 예고합니다.

· 시세판에 예고 소식이 뜨고 ${coin}이(가) 6시간 출렁입니다.
· 해방이 시세에 반영될 때까지 ${coin} 새 진입·매수가 멈춥니다(가진 것은 팔 수 있음).
· 간부전이 무산되면 아래 "간부전 대기" 목록에서 해제하십시오.`)) return;
    void run(() => announceBossFight(session, coin), `${place} 간부전을 예고했습니다.`);
  }

  return (
    <section>
      <SectionTitle title="환전가 소식 발행" />
      <Frame>
        <p className="mb-3 text-sm text-mist">발표 시각이 되면 기록원이 시세에 충격을 넣고 시세판 아래와 디스코드에 문구를 띄웁니다. 발표 전에는 플레이어가 볼 수 없습니다.</p>
        <PausedCoins />
        <div className="mb-3 flex flex-wrap gap-1">
          <span className="text-xs text-mist">간부전 예고 (예고 + 새 진입 정지):</span>
          {COIN_IDS.filter((coin) => COINS[coin].districtId && COINS[coin].districtId !== "downtown").map((coin) => (
            <button key={coin} type="button" className="btn btn-dark btn-sm" disabled={districts.get(COINS[coin].districtId!)?.liberated} onClick={() => bossNotice(coin)}>{COINS[coin].place}</button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">종목</span>
            <select className="field" value={draft.coin} onChange={(event) => setDraft({ ...draft, coin: event.target.value as CoinId })}>
              {COIN_IDS.map((coin) => <option key={coin} value={coin}>{coin} · {COINS[coin].name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="field-label">방향</span>
            <select className="field" value={draft.dir} onChange={(event) => setDraft({ ...draft, dir: Number(event.target.value) as 1 | -1 | 0 })}>
              <option value={1}>오름 ▲</option><option value={-1}>내림 ▼</option><option value={0}>모름 (무작위)</option>
            </select>
          </label>
          <label className="block">
            <span className="field-label">세기</span>
            <select className="field" value={draft.size} onChange={(event) => setDraft({ ...draft, size: event.target.value as NewsSize })}>
              {(Object.keys(NEWS_SIZE_LABELS) as NewsSize[]).map((size) => <option key={size} value={size}>{NEWS_SIZE_LABELS[size]}</option>)}
            </select>
          </label>
          <NumberField label="출렁임 지속 (분, 변동성 2배)" value={draft.minutes} onChange={(minutes) => setDraft({ ...draft, minutes })} min={1} max={1440} />
          <NumberField label="몇 분 뒤 발표" value={draft.delayMinutes} onChange={(delayMinutes) => setDraft({ ...draft, delayMinutes })} min={0} />
          <NumberField label="귓속말은 발표 몇 분 전" value={draft.whisperMinutes} onChange={(whisperMinutes) => setDraft({ ...draft, whisperMinutes })} min={1} />
        </div>
        <div className="mt-3 space-y-3">
          <TextField label="소식 문구 (구역의 목소리로 한 줄)" value={draft.headline} onChange={(headline) => setDraft({ ...draft, headline })} maxLength={200} />
          <TextField label="미리 도는 귓속말 (선택, 비워 두면 없음)" value={draft.whisper} onChange={(whisper) => setDraft({ ...draft, whisper })} maxLength={200} />
        </div>
        <button type="button" className="btn btn-gold mt-4" disabled={busy || !draft.headline.trim()} onClick={() => void run(async () => { await scheduleNews(session, draft); setDraft(EMPTY_NEWS); }, "예약했습니다.")}>발행 예약</button>

        <ul className="mt-5 divide-y divide-gold-400/15 text-sm">
          {rows.map((row) => (
            <li key={row.id} className="flex items-start justify-between gap-2 py-2">
              <span>
                <span style={{ color: COINS[row.data.coin].accent }}>{row.data.coin}</span> · {row.data.headline}
                <span className="block text-xs text-mist">
                  {formatDate(row.data.publishAt.toMillis())} · {{ pending: row.data.whispered ? "귓속말 나감" : "대기", published: "발표됨", cancelled: "취소됨" }[row.data.status]}
                  {" · "}{row.data.dir === 1 ? "▲" : row.data.dir === -1 ? "▼" : "?"} {NEWS_SIZE_LABELS[row.data.size]}
                </span>
              </span>
              {row.data.status === "pending" && <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => void run(() => cancelNews(session, row.id), "취소했습니다.")}>취소</button>}
            </li>
          ))}
        </ul>
      </Frame>
    </section>
  );
}

const FIELD_LABELS: [keyof MarketConfig, string][] = [
  ["feeBps", "수수료"], ["minFee", "최소 수수료"], ["interestBps", "이자"], ["liquidationBps", "강제 청산"], ["capMultiple", "자동 익절"],
  ["minMargin", "최소 증거금"], ["maxMargin", "최대 증거금"], ["maxOpen", "동시 포지션"], ["dailyLimit", "하루 새 거래"], ["spotDailyLimit", "하루 현물 매수"], ["spotMaxOrder", "현물 1회 최대"],
  ["nightFeeMultiplier", "밤 수수료 배수"], ["tickSeconds", "시세 간격(10~60초)"], ["staleSeconds", "시세 유효 시간(20초 이상)"],
];

/** Labels of the fields normalizeMarket had to change (out of range or not a number). */
function adjustedFields(draft: MarketConfig, saved: MarketConfig): string[] {
  const fields = FIELD_LABELS.filter(([key]) => draft[key] !== saved[key]).map(([key, label]) => `${label} → ${String(saved[key])}`);
  const leverage = (Object.keys(saved.leverage) as (keyof MarketConfig["leverage"])[]).some((key) => JSON.stringify(draft.leverage[key]) !== JSON.stringify(saved.leverage[key]));
  return leverage ? [...fields, "배율"] : fields;
}

function MarketEditor({ market }: { market: MarketConfig }) {
  const { session } = useDealer();
  const toast = useToast();
  const [draft, setDraft] = useState(market);
  const { busy, run } = useAction();
  const set = (patch: Partial<MarketConfig>) => setDraft({ ...draft, ...patch });
  const setLeverage = (patch: Partial<MarketConfig["leverage"]>) => setDraft({ ...draft, leverage: { ...draft.leverage, ...patch } });
  return (
    <section>
      <SectionTitle title="거래소 설정" />
      <Frame>
        <div className="grid gap-x-6 sm:grid-cols-2">
          <Toggle label="거래소 열기" checked={draft.enabled} onChange={(enabled) => set({ enabled })} hint="끄면 새 진입이 막히고 기록원도 쉽니다." />
          <Toggle label="FTN 빚 연동 (GM 단서)" checked={draft.debtLink} onChange={(debtLink) => set({ debtLink })} hint="도시 빚이 줄면 FTN 기준가가 내려갑니다. 화면엔 이유를 쓰지 않습니다." />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <NumberField label="수수료 (bp, 진입·청산 각각)" value={draft.feeBps} onChange={(feeBps) => set({ feeBps })} min={0} />
          <NumberField label="최소 수수료" value={draft.minFee} onChange={(minFee) => set({ minFee })} min={0} suffix="코인" />
          <NumberField label="이자 (bp/시간, 빌린 돈)" value={draft.interestBps} onChange={(interestBps) => set({ interestBps })} min={0} />
          <NumberField label="강제 청산 (증거금 대비 손실 bp)" value={draft.liquidationBps} onChange={(liquidationBps) => set({ liquidationBps })} min={1000} max={10000} />
          <NumberField label="자동 익절 (증거금의 몇 배 수익)" value={draft.capMultiple} onChange={(capMultiple) => set({ capMultiple })} min={1} />
          <NumberField label="무월리 밤 청산 수수료 배수" value={draft.nightFeeMultiplier} onChange={(nightFeeMultiplier) => set({ nightFeeMultiplier })} min={1} />
          <NumberField label="최소 증거금" value={draft.minMargin} onChange={(minMargin) => set({ minMargin })} min={1} suffix="코인" />
          <NumberField label="최대 증거금" value={draft.maxMargin} onChange={(maxMargin) => set({ maxMargin })} min={1} suffix="코인" />
          <NumberField label="동시 포지션" value={draft.maxOpen} onChange={(maxOpen) => set({ maxOpen })} min={1} />
          <NumberField label="하루 새 거래 (선물)" value={draft.dailyLimit} onChange={(dailyLimit) => set({ dailyLimit })} min={0} />
          <NumberField label="하루 현물 매수" value={draft.spotDailyLimit} onChange={(spotDailyLimit) => set({ spotDailyLimit })} min={0} />
          <NumberField label="현물 1회 최대 매수" value={draft.spotMaxOrder} onChange={(spotMaxOrder) => set({ spotMaxOrder })} min={1} suffix="코인" />
          <NumberField label="시세 간격 (초, 10~60)" value={draft.tickSeconds} onChange={(tickSeconds) => set({ tickSeconds })} min={10} max={60} />
          <NumberField label="시세 유효 시간 (초)" value={draft.staleSeconds} onChange={(staleSeconds) => set({ staleSeconds })} min={20} />
          <NumberField label="FTN 배율 (하우스 전)" value={draft.leverage.mainLocked} onChange={(mainLocked) => setLeverage({ mainLocked })} min={1} />
          <NumberField label="알트 배율 (하우스 전)" value={draft.leverage.altLocked} onChange={(altLocked) => setLeverage({ altLocked })} min={1} />
          <NumberField label="FTN 배율 (하우스 후)" value={draft.leverage.mainOpen} onChange={(mainOpen) => setLeverage({ mainOpen })} min={1} />
          <NumberField label="알트 배율 (하우스 후)" value={draft.leverage.altOpen} onChange={(altOpen) => setLeverage({ altOpen })} min={1} />
          <NumberField label="주간 수익 상한 (0이면 끔)" value={draft.weeklyProfitCap} onChange={(weeklyProfitCap) => set({ weeklyProfitCap })} min={0} suffix="코인" />
        </div>
        <p className="field-label mt-4">거래소 2부 · 시장 구조</p>
        <div className="grid gap-x-6 sm:grid-cols-2">
          <Toggle label="NPC 거래자 (주민 군중)" checked={draft.npc.enabled} onChange={(enabled) => set({ npc: { ...draft.npc, enabled } })} hint="가상 포지션 묶음. 코인은 오가지 않고, 롱/숏·청산 지도·거래량에 섞여 보입니다." />
          <NumberField label="군중 규모 ×" value={draft.npc.scale} step={0.1} onChange={(scale) => set({ npc: { ...draft.npc, scale } })} min={0} max={5} />
          <Toggle label="구역 실적·리포트" checked={draft.earnings} onChange={(earnings) => set({ earnings })} hint="매일 21시 실적 발표, 다음 날 정오 리포트. 끄면 기준가 배율은 그대로 멈춥니다." />
        </div>
        <p className="field-label mt-4">종목별 거래 정지 · 변동성 배수</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {COIN_IDS.map((coin) => (
            <div key={coin} className="rounded-sm border border-gold-400/20 p-2">
              <Toggle label={`${coin} 거래`} checked={draft.coins[coin].enabled} onChange={(enabled) => setDraft({ ...draft, coins: { ...draft.coins, [coin]: { ...draft.coins[coin], enabled } } })} hint="끄면 가격도 멈춥니다" />
              <Toggle label="간부전 대기" checked={draft.coins[coin].paused} onChange={(paused) => setDraft({ ...draft, coins: { ...draft.coins, [coin]: { ...draft.coins[coin], paused } } })} hint="새 진입·매수만 정지, 해방 반영 시 자동 해제" />
              <NumberField label="변동성 ×" value={draft.coins[coin].volMult} step={0.1} onChange={(volMult) => setDraft({ ...draft, coins: { ...draft.coins, [coin]: { ...draft.coins[coin], volMult } } })} min={0} max={5} />
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-gold mt-4" disabled={busy} onClick={() => void run(async () => {
          await saveMarket(session, draft);
          const fixed = adjustedFields(draft, normalizeMarket(draft));
          toast(fixed.length ? "info" : "success", fixed.length ? `저장했습니다. 허용 범위를 벗어난 값은 바꿔 저장했습니다: ${fixed.join(", ")}` : "저장했습니다.");
        })}>저장</button>
      </Frame>
    </section>
  );
}

/** 지배인 금리 결정: announced ahead on the calendar, it moves prices when it lands (FTN −2% per +5bp, alts 1.3×). */
function RateDesk({ market }: { market: MarketConfig }) {
  const { session } = useDealer();
  const events = useLiveQuery(query(collection(session.db, "marketEvents") as CollectionReference<RateEventDoc<Timestamp>>, where("status", "==", "pending")), "dealer:marketEvents");
  const [bps, setBps] = useState(market.interestBps + 5);
  const [hours, setHours] = useState(24);
  const { busy, run } = useAction();
  const pending = events.status === "ready" ? [...events.data].sort((a, b) => (a.data.at?.toMillis?.() ?? 0) - (b.data.at?.toMillis?.() ?? 0)) : [];
  return (
    <Frame>
      <SectionTitle title="지배인 금리 결정" />
      <p className="mb-2 text-xs text-mist">
        지금 이자 시간당 {(market.interestBps / 100).toFixed(2)}%. 예고하면 시장 정보 일정에 바로 뜨고, 발표 순간 시세가 움직이고 이자율이 바뀝니다
        (0.05%p 인상마다 FTN −2%, 알트는 1.3배). 플레이어는 결과(새 금리)를 미리 볼 수 있습니다.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-36"><NumberField label="새 이자 (bp/시간)" value={bps} onChange={setBps} min={0} max={1000} /></div>
        <div className="w-36"><NumberField label="몇 시간 뒤" value={hours} onChange={setHours} min={0} max={168} suffix="시간" /></div>
        <button type="button" className="btn btn-gold btn-sm mb-0.5" disabled={busy || !Number.isInteger(bps) || !Number.isFinite(hours)}
          onClick={() => void run(() => scheduleRate(session, session.clock.now() + Math.round(hours * 3_600_000), bps))}>예고하기</button>
      </div>
      {pending.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {pending.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 rounded-sm border border-gold-400/20 px-2 py-1">
              <span>{formatDate(row.data.at?.toMillis?.() ?? 0)} · 시간당 {(row.data.bps / 100).toFixed(2)}%</span>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run(() => cancelRate(session, row.id))}>취소</button>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

/** 이번 주 거래소 순이익 (환전가 특별 징수 기준). */
function WeekLevies({ market }: { market: MarketConfig }) {
  const { players, wallets, session } = useDealer();
  const week = weekIndexAt(session.clock.now());
  const rows = players.map((row) => {
    const stored = wallets.get(row.id)?.marketWeek;
    return { id: row.id, name: row.data.name, net: stored && stored.week === week ? stored.net : 0 };
  }).filter((row) => row.net !== 0).sort((a, b) => b.net - a.net);
  return (
    <Frame>
      <SectionTitle title="이번 주 거래소 순이익" />
      <p className="mb-2 text-xs text-mist">
        {market.weeklyProfitCap > 0 ? `${market.weeklyProfitCap.toLocaleString("ko-KR")}코인을 넘는 몫은 지급하지 않고 금고에 남깁니다(환전가 특별 징수). 같은 주 손실은 이익을 깎고, 월요일 0시에 새로 셉니다.` : "주간 수익 상한이 꺼져 있습니다."}
      </p>
      {rows.length ? (
        <ul className="grid gap-1 sm:grid-cols-2">
          {rows.map((row) => (
            <li key={row.id} className="flex justify-between rounded-sm border border-gold-400/20 px-2 py-1 text-sm">
              <span>{row.name}</span>
              <span className={cx("num", row.net > 0 ? "text-[#a9ecc9]" : "text-[#f2b3aa]")}>{row.net > 0 ? "+" : ""}{row.net.toLocaleString("ko-KR")}{market.weeklyProfitCap > 0 && row.net >= market.weeklyProfitCap ? " · 상한" : ""}</span>
            </li>
          ))}
        </ul>
      ) : <Empty>이번 주 거래소 정산이 아직 없습니다.</Empty>}
    </Frame>
  );
}

/** Coins waiting on a 간부전: buys and new positions are stopped until liberation reaches the price. */
function PausedCoins() {
  const { session } = useDealer();
  const config = useLiveDoc(refs.marketConfig(session.db), "dealer:market:config:paused");
  const tick = useLatest();
  const { busy, run } = useAction();
  const market = config.status === "ready" && config.data ? normalizeMarket(config.data) : null;
  const paused = market ? COIN_IDS.filter((coin) => entryPaused(market, coin, tick?.st.liberated ?? [])) : [];
  if (paused.length === 0) return null;
  return (
    <div className="mb-3">
      <Notice>
        간부전 대기 (새 진입·매수 정지):{" "}
        {paused.map((coin) => (
          <span key={coin} className="mr-2 inline-flex items-center gap-1">
            <b style={{ color: COINS[coin].accent }}>{COINS[coin].place}</b>
            <button type="button" className="btn btn-dark btn-sm !min-h-0 !py-0.5" disabled={busy} onClick={() => void run(() => setCoinPaused(session, coin, false), `${coin} 정지를 풀었습니다.`)}>해제</button>
          </span>
        ))}
      </Notice>
    </div>
  );
}

/** 현물 보유: what every player holds and what the vault would pay if they all sold now. */
function Holdings() {
  const { session, players } = useDealer();
  const live = useLiveQuery(refs.holdings(session.db), "dealer:holdings");
  const tick = useLatest();
  const rows = live.status === "ready" ? live.data.filter((row) => row.data.units > 0) : [];
  const names = new Map(players.map((row) => [row.id, row.data.name]));
  const value = (units: number, coin: CoinId) => (tick ? holdingValue(units, tick.p[coin]) : 0);
  const total = rows.reduce((sum, row) => sum + value(row.data.units, row.data.coin), 0);
  const cost = rows.reduce((sum, row) => sum + row.data.cost, 0);
  return (
    <section>
      <SectionTitle title="현물 보유" />
      {rows.length === 0 ? <Empty>아무도 현물을 들고 있지 않습니다.</Empty> : (
        <div className="deco-frame overflow-x-auto p-2">
          <p className="mb-2 px-1 text-sm text-mist">지금 모두 판다면 금고에서 나갈 돈 <Coins value={total} /> · 산 값 <Coins value={cost} /></p>
          <table className="table min-w-[32rem]">
            <thead><tr><th>플레이어</th><th>종목</th><th className="text-right">수량</th><th className="text-right">산 값</th><th className="text-right">지금 가치</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="font-bold">{names.get(row.data.playerId) ?? row.data.playerId}</td>
                  <td style={{ color: COINS[row.data.coin].accent }}>{row.data.coin}</td>
                  <td className="text-right num">{formatUnits(row.data.units)}</td>
                  <td className="text-right"><Coins value={row.data.cost} /></td>
                  <td className="text-right"><Coins value={value(row.data.units, row.data.coin)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
