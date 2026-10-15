import { useMemo, useState } from "react";
import { COINS, SPOT_UNITS, averagePrice, formatUnits, holdingValue, periodWords, quoteBuy, quoteSell, type CoinId, type MarketConfig } from "@fortuna/core";
import { buySpot, sellSpot } from "@fortuna/data";
import { usePlayer } from "../session/player.tsx";
import { cue } from "../fx/cues.ts";
import { Coins, Notice, cx, useAction, useToast } from "../ui/kit.tsx";
import { priceText } from "./pieces.tsx";
import { useMyHoldings } from "./useMarket.ts";

const AMOUNT_STEPS = [10, 50, 100, 500];
const SELL_SHARES = [25, 50, 75, 100];

/** 현물: buy an amount of coins' worth, sell part or all of what you hold. No leverage, no liquidation. */
export function SpotPanel({ coin, market, price, stale, paused }: { coin: CoinId; market: MarketConfig; price: number | null; stale: boolean; paused: boolean }) {
  const { session, wallet, config: economy } = usePlayer();
  const { busy, run } = useAction();
  const toast = useToast();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState<number>(100);
  const [share, setShare] = useState<number>(100);
  const holding = useMyHoldings().find((row) => row.data.coin === coin)?.data ?? null;
  const name = COINS[coin].name;

  const counters = wallet.spot ?? { period: -1, used: 0 };
  const usedToday = counters.period === session.clock.period(economy.limitPeriod) ? counters.used : 0;
  const buy = useMemo(() => (price && Number.isFinite(amount) ? quoteBuy(market, amount, price) : null), [market, amount, price]);
  const sellUnits = holding ? (share >= 100 ? holding.units : Math.floor((holding.units * share) / 100)) : 0;
  const sell = useMemo(() => (price && holding && sellUnits > 0 ? quoteSell(market, sellUnits, price, holding) : null), [market, price, holding, sellUnits]);
  const maxAffordable = Math.max(0, Math.min(market.spotMaxOrder, wallet.balance - Math.max(market.minFee, Math.floor((wallet.balance * market.feeBps) / 10_000)) - 1));
  const value = holding && price ? holdingValue(holding.units, price) : 0;
  const pnl = holding ? value - holding.cost : 0;

  const buyProblem = !market.coins[coin].enabled ? "이 종목은 거래가 잠시 멈췄습니다."
    : paused ? "간부전 결과가 나올 때까지 이 종목의 매수가 멈췄습니다. 가진 코인은 팔 수 있습니다."
    : stale ? "시세 기록원이 멈춰 있습니다. 잠시 후 다시 시도해 주세요."
    : usedToday >= market.spotDailyLimit ? `${periodWords(economy.limitPeriod).now} 현물 매수를 모두 했습니다.`
    : !Number.isInteger(amount) || amount < market.minMargin || amount > market.spotMaxOrder ? `한 번에 ${market.minMargin}~${market.spotMaxOrder.toLocaleString("ko-KR")}코인어치까지 살 수 있습니다.`
    : buy && buy.cost > wallet.balance ? "잔액이 부족합니다." : null;
  const sellProblem = stale ? "시세 기록원이 멈춰 있습니다. 잠시 후 다시 시도해 주세요." : !holding ? `가진 ${name}이(가) 없습니다.` : sellUnits < 1 ? "팔 수량이 너무 적습니다." : null;

  async function submitBuy() {
    const result = await run(() => buySpot(session, coin, amount));
    if (!result) return;
    cue("chip");
    toast("success", `${coin} ${formatUnits(result.quote.units)}개를 샀습니다 (${result.quote.cost.toLocaleString("ko-KR")}코인).`);
  }

  async function submitSell() {
    if (!holding) return;
    const result = await run(() => sellSpot(session, coin, sellUnits));
    if (!result) return;
    const paid = result.quote.payout - result.levy, net = paid - result.quote.costOut;
    cue(net >= 0 ? "win" : "lose");
    toast(net >= 0 ? "success" : "info", `${coin} ${formatUnits(result.quote.units)}개를 팔았습니다: ${paid.toLocaleString("ko-KR")}코인 (${net >= 0 ? "+" : ""}${net.toLocaleString("ko-KR")})${result.levy ? ` · 환전가 특별 징수 ${result.levy.toLocaleString("ko-KR")}코인` : ""}`);
  }

  return (
    <>
      {holding && (
        <dl className="mb-4 grid grid-cols-2 gap-x-3 gap-y-1 rounded-sm border border-gold-400/20 bg-ink/40 p-3 text-sm">
          <dt className="text-mist">보유</dt><dd className="num text-right">{formatUnits(holding.units)} {coin}</dd>
          <dt className="text-mist">평균 매입가</dt><dd className="num text-right">{priceText(averagePrice(holding))}</dd>
          <dt className="text-mist">지금 가치</dt><dd className="text-right"><Coins value={value} /></dd>
          <dt className="text-mist">평가 손익</dt><dd className={cx("num text-right", pnl >= 0 ? "tone-up" : "tone-down")}>{pnl >= 0 ? "+" : ""}{pnl.toLocaleString("ko-KR")} ({holding.cost ? `${((pnl / holding.cost) * 100).toFixed(1)}%` : "—"})</dd>
        </dl>
      )}

      <div className="mb-3 grid grid-cols-2 gap-2">
        <button type="button" className={cx("btn border", side === "buy" ? "btn-gold" : "btn-dark side-long")} aria-pressed={side === "buy"} onClick={() => setSide("buy")}>사기</button>
        <button type="button" className={cx("btn border", side === "sell" ? "btn-gold" : "btn-dark side-short")} aria-pressed={side === "sell"} onClick={() => setSide("sell")}>팔기</button>
      </div>

      {side === "buy" ? (
        <>
          <label className="block">
            <span className="field-label">살 금액 (코인)</span>
            <input className="field num" type="number" inputMode="numeric" min={market.minMargin} max={market.spotMaxOrder} value={Number.isFinite(amount) ? amount : ""}
              onChange={(event) => setAmount(event.target.value === "" ? Number.NaN : Math.floor(Number(event.target.value)))} />
          </label>
          <div className="mt-2 flex flex-wrap gap-1">
            {AMOUNT_STEPS.map((step) => <button key={step} type="button" className="btn btn-dark btn-sm" onClick={() => setAmount(step)}>{step}</button>)}
            <button type="button" className="btn btn-dark btn-sm" onClick={() => setAmount(maxAffordable)}>최대</button>
          </div>
          {buy && (
            <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-mist">가격 (현재)</dt><dd className="num text-right">{priceText(buy.price)}</dd>
              <dt className="text-mist">받는 양</dt><dd className="num text-right">{formatUnits(buy.units)} {coin}</dd>
              <dt className="text-mist">수수료</dt><dd className="text-right"><Coins value={buy.fee} /></dd>
              <dt className="font-bold">지금 내는 돈</dt><dd className="text-right font-bold"><Coins value={buy.cost} /></dd>
            </dl>
          )}
          <p className="mt-2 text-xs text-mist">강제 청산도 이자도 없습니다. 오래 들고 있어도 됩니다. {periodWords(economy.limitPeriod).now} 매수 {Math.max(0, market.spotDailyLimit - usedToday)} / {market.spotDailyLimit}회 남음.</p>
          {buyProblem && <div className="mt-3"><Notice>{buyProblem}</Notice></div>}
          <button type="button" className="btn btn-gold mt-4 w-full" disabled={busy || !buy || Boolean(buyProblem)} onClick={() => void submitBuy()}>{name} 사기</button>
        </>
      ) : (
        <>
          <p className="field-label">팔 비율</p>
          <div className="flex flex-wrap gap-1">
            {SELL_SHARES.map((step) => <button key={step} type="button" aria-pressed={share === step} className={cx("btn btn-sm min-w-14", share === step ? "btn-gold" : "btn-dark")} onClick={() => setShare(step)}>{step === 100 ? "전부" : `${step}%`}</button>)}
          </div>
          {sell && (
            <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-mist">파는 양</dt><dd className="num text-right">{formatUnits(sell.units)} {coin}</dd>
              <dt className="text-mist">가격 (현재)</dt><dd className="num text-right">{priceText(sell.price)}</dd>
              <dt className="text-mist">판 금액</dt><dd className="text-right"><Coins value={sell.gross} /></dd>
              <dt className="text-mist">수수료</dt><dd className="text-right"><Coins value={sell.fee} /></dd>
              <dt className="font-bold">받는 돈</dt><dd className="text-right font-bold"><Coins value={sell.payout} /></dd>
            </dl>
          )}
          {sellProblem && <div className="mt-3"><Notice>{sellProblem}</Notice></div>}
          <button type="button" className="btn btn-gold mt-4 w-full" disabled={busy || !sell || Boolean(sellProblem)} onClick={() => void submitSell()}>{name} 팔기</button>
        </>
      )}
      <p className="mt-3 text-[0.7rem] text-mist">수량은 1/{SPOT_UNITS.toLocaleString("ko-KR")}개 단위까지 셉니다. 사고팔 때 수수료가 각각 붙습니다.</p>
    </>
  );
}
