import { useState } from "react";
import { query, where } from "firebase/firestore";
import { TEXT } from "@fortuna/core";
import { contributeFund, refs, type FundDoc } from "@fortuna/data";
import { usePlayer } from "../session/player.tsx";
import { useLiveQuery, type Row } from "../session/live.ts";
import { Coins, Frame, useAction } from "../ui/kit.tsx";
import { celebrate } from "../fx/effects.ts";
import { cue } from "../fx/cues.ts";
import { relay } from "../relay.ts";

/** Open fund drives, shown on the wallet page next to the joint wallet. Renders nothing when there are none. */
export function FundsSection() {
  const { session } = usePlayer();
  const funds = useLiveQuery(query(refs.funds(session.db), where("visible", "==", true)), "funds:visible");
  const rows = (funds.status === "ready" ? funds.data : []).sort((a, b) => a.data.sortOrder - b.data.sortOrder);
  if (!rows.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="deco-title px-1 text-lg">{TEXT.fund.title}</h2>
      {rows.map((row) => <FundCard key={row.id} row={row} />)}
    </section>
  );
}

export function FundCard({ row }: { row: Row<FundDoc> }) {
  const { session, wallet, notify } = usePlayer();
  const { busy, run } = useAction();
  const fund = row.data, room = Math.max(0, fund.goal - fund.current), ratio = Math.min(1, fund.current / Math.max(1, fund.goal));
  const [amount, setAmount] = useState(Math.min(100, room));

  async function give() {
    const result = await run(() => contributeFund(session, row.id, amount), "모금함에 보탰습니다.");
    if (!result) return;
    cue("chip");
    if (result.filled) { celebrate(2); cue("bigWin"); relay(notify.relayUrl, result.ledgerId); }
  }

  return (
    <Frame>
      <div className="flex items-start justify-between gap-2">
        <h3 className="deco-title text-lg">{fund.title}</h3>
        {fund.status !== "open" && <span className="chip chip-jade">{fund.status === "filled" ? "달성" : "마감"}</span>}
      </div>
      {fund.description && <p className="mt-1 whitespace-pre-line text-sm text-mist">{fund.description}</p>}
      <div className="mt-3 h-4 overflow-hidden rounded-full border border-gold-400/50 bg-ink" role="progressbar" aria-valuemin={0} aria-valuemax={fund.goal} aria-valuenow={fund.current}>
        <div className="h-full bg-gradient-to-r from-gold-500 via-gold-300 to-gold-200 transition-[width] duration-700" style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className="mt-1 text-right text-sm"><Coins value={fund.current} /> / <span className="num">{fund.goal.toLocaleString("ko-KR")}</span></p>
      {fund.status === "open" ? (
        <div className="mt-3 flex gap-2">
          <input type="number" inputMode="numeric" className="field num" min={1} max={room} value={amount} onChange={(event) => setAmount(Math.max(0, Math.floor(Number(event.target.value) || 0)))} aria-label="보탤 금액" />
          <button type="button" className="btn btn-gold shrink-0" disabled={busy || amount <= 0 || amount > room || amount > wallet.balance} onClick={() => void give()}>보태기</button>
        </div>
      ) : <p className="mt-2 text-center text-sm text-gold-200">{TEXT.fund.filled}</p>}
    </Frame>
  );
}
