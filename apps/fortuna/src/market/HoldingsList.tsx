import { Link } from "react-router";
import { COINS, averagePrice, formatUnits, holdingValue } from "@fortuna/core";
import { usePlayer } from "../session/player.tsx";
import { Coins, Frame, cx } from "../ui/kit.tsx";
import { CoinBadge, priceText } from "./pieces.tsx";
import { useMyHoldings, useTape } from "./useMarket.ts";

/** 보유 코인 (현물): quantity, average price and what it is worth now. Renders nothing when empty. */
export function HoldingsList({ title = "보유 코인" }: { title?: string }) {
  const { session } = usePlayer();
  const holdings = useMyHoldings();
  const tape = useTape(() => session.clock.now(), 0);
  if (holdings.length === 0) return null;
  const prices = tape.latest?.tick.p;
  const total = holdings.reduce((sum, row) => sum + (prices ? holdingValue(row.data.units, prices[row.data.coin]) : 0), 0);
  return (
    <Frame>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="deco-title text-lg">{title}</h2>
        <span className="text-sm text-mist">합계 <Coins value={total} /></span>
      </div>
      <ul className="divide-y divide-gold-400/15">
        {holdings.map((row) => {
          const { coin, units, cost } = row.data, price = prices?.[coin], value = price ? holdingValue(units, price) : 0, pnl = value - cost;
          return (
            <li key={row.id}>
              <Link to={`/market/${coin}`} className="flex items-center gap-3 py-2">
                <CoinBadge coin={coin} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold" style={{ color: COINS[coin].accent }}>{formatUnits(units)} {coin}</p>
                  <p className="text-[0.7rem] text-mist">평균 <span className="num">{priceText(averagePrice(row.data))}</span> · 지금 <span className="num">{priceText(price)}</span></p>
                </div>
                <div className="text-right">
                  <p className="text-sm"><Coins value={value} /></p>
                  <p className={cx("num text-[0.7rem]", pnl >= 0 ? "text-[#a9ecc9]" : "text-[#f2b3aa]")}>{pnl >= 0 ? "+" : ""}{pnl.toLocaleString("ko-KR")}</p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Frame>
  );
}
