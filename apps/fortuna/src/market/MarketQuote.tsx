import { formatPrice } from "@fortuna/core";
import { usePlayer } from "../session/player.tsx";
import { changeText } from "./pieces.tsx";
import { openingPrice, useMyPositions, useTape } from "./useMarket.ts";

/** One line for the lobby card: FTN now, its move this hour, and open positions. */
export function MarketQuote() {
  const { session } = usePlayer();
  const tape = useTape(() => session.clock.now(), 0);
  const positions = useMyPositions().filter((row) => row.data.status === "open").length;
  const price = tape.latest?.tick.p.FTN;
  if (!price) return <>시세 준비 중</>;
  const change = changeText(price, openingPrice(tape.hours, "FTN"));
  return (
    <>
      FTN <span className="num">{formatPrice(price)}</span>{" "}
      <span className={change.tone === "up" ? "text-[#a9ecc9]" : change.tone === "down" ? "text-[#f2b3aa]" : "text-mist"}>{change.text}</span>
      {positions > 0 && <span className="text-mist"> · 포지션 {positions}</span>}
    </>
  );
}
