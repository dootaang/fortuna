import { useState } from "react";
import { Link } from "react-router";
import type { Timestamp } from "firebase/firestore";
import { COINS, liveEquity, type MarketConfig, type TickDoc } from "@fortuna/core";
import { closePosition, type PositionDoc } from "@fortuna/data";
import { usePlayer } from "../session/player.tsx";
import { relay } from "../relay.ts";
import { Counter } from "../fx/Counter.tsx";
import { cue } from "../fx/cues.ts";
import { celebrate, flash } from "../fx/effects.ts";
import { Coins, Frame, cx, useAction, useToast } from "../ui/kit.tsx";
import type { Row } from "../session/live.ts";
import { CoinBadge, percent, priceText } from "./pieces.tsx";

const STATUS_LINE: Partial<Record<PositionDoc["status"], string>> = {
  liquidated: "강제 청산되었습니다. 장부에 옮기는 중…",
  capped: "수익 상한에 닿아 자동 익절되었습니다. 정산하는 중…",
  void: "딜러가 무효로 했습니다. 증거금을 돌려받는 중…",
};

export function PositionCard({ row, tick, market, compact }: { row: Row<PositionDoc>; tick: TickDoc<Timestamp> | null; market: MarketConfig; compact?: boolean }) {
  const { session, notify } = usePlayer();
  const { busy, run } = useAction();
  const toast = useToast();
  const [closing, setClosing] = useState(false);
  const position = row.data, def = COINS[position.coin];
  const price = tick?.p[position.coin] ?? position.entry;
  const openedAtMs = position.openedAt?.toMillis?.() ?? session.clock.now();
  const live = liveEquity(market, { ...position, openedAtMs, F0: position.F0 ?? null }, price, session.clock.now(), tick?.st.coins[position.coin].F ?? null);
  const ended = position.status !== "open";
  // 0 at the liquidation line, 1 at entry or better.
  const distance = Math.max(0, Math.min(1, position.side === "long" ? (price - position.liq) / (position.entry - position.liq) : (position.liq - price) / (position.liq - position.entry)));
  const danger = !ended && distance < 0.35;

  async function close() {
    setClosing(true);
    const result = await run(() => closePosition(session, row.id, notify.bigGamble));
    setClosing(false);
    if (!result) return;
    relay(notify.relayUrl, result.eventId);
    const paid = result.quote.payout - result.levy, net = paid - result.margin;
    if (net > 0) { cue(net >= result.margin ? "bigWin" : "win"); if (net >= result.margin) celebrate(2); }
    else { cue("lose"); flash("ruby"); }
    toast(net >= 0 ? "success" : "info", `${position.coin} 정산: ${paid.toLocaleString("ko-KR")}코인 (${net >= 0 ? "+" : ""}${net.toLocaleString("ko-KR")})${result.levy ? ` · 환전가 특별 징수 ${result.levy.toLocaleString("ko-KR")}코인` : ""}`);
  }

  return (
    <Frame as="article" className={cx("relative", danger && "danger-pulse", position.status === "liquidated" && "burning")}>
      <div className="flex items-start gap-3">
        <CoinBadge coin={position.coin} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/market/${position.coin}`} className="font-bold" style={{ color: def.accent }}>{def.name}</Link>
            <span className={cx("chip border", position.side === "long" ? "side-long" : "side-short")}>{position.side === "long" ? "롱 ▲" : "숏 ▼"} {position.leverage}배</span>
          </div>
          <p className="mt-1 text-xs text-mist">
            증거금 <Coins value={position.margin} /> · 진입 <span className="num">{priceText(position.entry)}</span> · 청산가 <span className="num text-[#f2b3aa]">{priceText(position.liq)}</span>
            {position.cap > 0 && <> · 상한 <span className="num text-[#a9ecc9]">{priceText(position.cap)}</span></>}
          </p>
        </div>
        {!ended && (
          <div className="text-right">
            <p className={cx("text-lg font-bold num", live.pnl >= 0 ? "tone-up" : "tone-down")}>
              {live.pnl >= 0 ? "+" : ""}<Counter value={live.pnl} duration={400} />
            </p>
            <p className={cx("text-xs num", live.pnl >= 0 ? "tone-up" : "tone-down")}>{percent(live.ratio)}</p>
          </div>
        )}
      </div>
      {ended ? (
        <p className="mt-3 text-sm text-gold-200">{STATUS_LINE[position.status]}</p>
      ) : (
        <>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink" aria-label={`청산가까지 ${Math.round(distance * 100)}%`}>
            <div className={cx("h-full transition-[width] duration-500", danger ? "bg-ruby" : "bg-gold-400")} style={{ width: `${Math.round(distance * 100)}%` }} />
          </div>
          {!compact && (
            <div className="mt-3 flex items-center justify-between gap-2 text-xs text-mist">
              <span>현재 <span className="num text-ivory">{priceText(price)}</span> · 이자 <span className="num">{live.interest}</span>코인{live.funding ? <> · 펀딩 <span className={cx("num", live.funding > 0 ? "text-[#f2b3aa]" : "text-[#a9ecc9]")}>{live.funding > 0 ? `−${live.funding}` : `+${-live.funding}`}</span></> : null} · 정산 예상 <Coins value={Math.max(0, live.equity - position.fee)} /></span>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy || closing} onClick={() => void close()}>{closing ? "정산 중…" : "청산"}</button>
            </div>
          )}
        </>
      )}
    </Frame>
  );
}
