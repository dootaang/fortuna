import { useMemo, useState } from "react";
import { getDoc, limit, orderBy, query, where, type Timestamp } from "firebase/firestore";
import { LEDGER_LABELS, TEXT, usesLeft, type LedgerEntry } from "@fortuna/core";
import { depositJoint, friendlyError, refs, repayDebt, useItem, type InventoryDoc } from "@fortuna/data";
import { usePlayer } from "../session/player.tsx";
import { useLiveQuery, type Row } from "../session/live.ts";
import { Coins, Empty, Frame, Modal, NumberField, PageTitle, Stat, cx, formatDate, useAction } from "../ui/kit.tsx";
import { relay } from "../relay.ts";
import { FundsSection } from "./Funds.tsx";
import { HoldingsList } from "../market/HoldingsList.tsx";

export default function WalletPage() {
  const { wallet, config, session, player } = usePlayer();
  const now = session.clock.now();
  return (
    <div className="space-y-4">
      <PageTitle eyebrow="WALLET" title={`${player.name}의 지갑`} />
      <Frame>
        <div className="grid grid-cols-2 gap-y-2 sm:grid-cols-4 sm:divide-x sm:divide-gold-400/20">
          <Stat label={TEXT.wallet.balance} tone="gold"><Coins value={wallet.balance} /></Stat>
          <Stat label={TEXT.wallet.debt} tone={wallet.debt ? "ruby" : "jade"}><span className="num">{wallet.debt.toLocaleString("ko-KR")}</span></Stat>
          <Stat label={TEXT.wallet.workLeft}><span className="num">{usesLeft(wallet, config, "work", now)}</span></Stat>
          <Stat label={TEXT.wallet.gambleLeft}><span className="num">{usesLeft(wallet, config, "gamble", now)}</span></Stat>
        </div>
      </Frame>
      <HoldingsList />
      <Repay />
      <JointWallet />
      <FundsSection />
      <Inventory />
      <History />
    </div>
  );
}

function Repay() {
  const { wallet, session, notify } = usePlayer();
  const { busy, run } = useAction();
  const max = Math.min(wallet.debt, wallet.balance);
  const [amount, setAmount] = useState(Math.min(500, max));
  if (wallet.debt === 0) return <Frame><h2 className="deco-title text-lg">{TEXT.repay.title}</h2><p className="mt-1 text-sm text-[#a9ecc9]">{TEXT.repay.cleared}</p></Frame>;
  return (
    <Frame>
      <h2 className="deco-title text-lg">{TEXT.repay.title}</h2>
      <p className="text-sm text-mist">남은 빚 <Coins value={wallet.debt} /></p>
      <div className="mt-3 flex items-end gap-2">
        <div className="flex-1"><NumberField label="상환 금액" value={amount} onChange={setAmount} min={1} max={max} /></div>
        <button type="button" className="btn btn-ghost" onClick={() => setAmount(max)}>전액</button>
      </div>
      <button type="button" className="btn btn-gold mt-3 w-full" disabled={busy || !Number.isInteger(amount) || amount <= 0 || amount > max}
        onClick={() => { const clears = amount === wallet.debt; void run(() => repayDebt(session, amount), clears ? TEXT.repay.cleared : TEXT.repay.done).then((id) => { if (clears) relay(notify.relayUrl, id); }); }}>상환</button>
    </Frame>
  );
}

function Inventory() {
  const { session } = usePlayer();
  const owned = useLiveQuery(query(refs.inventories(session.db), where("playerId", "==", session.pid)), `wallet:inv:${session.pid}`);
  const { config } = usePlayer();
  const rows = (owned.status === "ready" ? owned.data : []).filter((row) => row.data.quantity > 0 || row.data.used > 0).sort((a, b) => a.data.itemName.localeCompare(b.data.itemName, "ko"));
  if (!config.shopEnabled && rows.length === 0) return null;
  return (
    <Frame>
      <h2 className="deco-title text-lg">{TEXT.wallet.items}</h2>
      {rows.length ? <ul className="mt-2 divide-y divide-gold-400/15">{rows.map((row) => <InventoryRow key={row.id} row={row} />)}</ul> : <Empty>{TEXT.wallet.noItems}</Empty>}
    </Frame>
  );
}

function InventoryRow({ row }: { row: Row<InventoryDoc> }) {
  const { session } = usePlayer();
  const { busy, run } = useAction();
  const [secret, setSecret] = useState<string | null>(null);
  const item = row.data;
  async function openSecret() {
    try { setSecret((await getDoc(refs.secret(session.db, item.itemId))).data()?.text ?? ""); } catch (error) { setSecret(friendlyError(error)); }
  }
  return (
    <li className="flex items-center justify-between gap-2 py-2">
      <div className="min-w-0">
        <p className="truncate font-bold">{item.itemName}</p>
        <p className="text-xs text-mist">보유 {item.quantity}{item.used ? ` · 사용 ${item.used}` : ""}</p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        {item.category === "rumor" && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void openSecret()}>열람</button>}
        {item.consumable && item.quantity > 0 && <button type="button" className="btn btn-gold btn-sm" disabled={busy} onClick={() => void run(() => useItem(session, item.itemId), `${item.itemName}을(를) 사용했습니다.`)}>{TEXT.shop.use}</button>}
      </div>
      <Modal open={secret !== null} onClose={() => setSecret(null)} title={item.itemName}>
        <p className="whitespace-pre-line rounded-sm border border-gold-400/30 bg-ink/50 p-3 font-display leading-7">{secret || "이 물품에는 비밀 내용이 없습니다."}</p>
      </Modal>
    </li>
  );
}

function JointWallet() {
  const { session, treasury, wallet } = usePlayer();
  const { busy, run } = useAction();
  const [amount, setAmount] = useState(100);
  return (
    <Frame>
      <h2 className="deco-title text-lg">{TEXT.joint.title}</h2>
      <p className="text-sm text-mist">{TEXT.joint.intro}</p>
      <p className="deco-title my-2 text-center text-2xl"><Coins value={treasury?.amount ?? 0} /></p>
      <div className="flex items-end gap-2">
        <div className="flex-1"><NumberField label="넣을 금액" value={amount} onChange={setAmount} min={1} max={wallet.balance} /></div>
        <button type="button" className="btn btn-gold" disabled={busy || !Number.isInteger(amount) || amount <= 0 || amount > wallet.balance}
          onClick={() => void run(() => depositJoint(session, amount), "공동 지갑에 넣었습니다.")}>넣기</button>
      </div>
    </Frame>
  );
}

function History() {
  const { session } = usePlayer();
  const rows = useLiveQuery(query(refs.ledgers(session.db), where("playerId", "==", session.pid), orderBy("seq", "desc"), limit(30)), `wallet:ledger:${session.pid}`);
  const entries = useMemo(() => (rows.status === "ready" ? rows.data : []), [rows]);
  return (
    <Frame>
      <h2 className="deco-title text-lg">{TEXT.wallet.history}</h2>
      {rows.status === "error" ? <Empty>기록을 불러오지 못했습니다.</Empty> : entries.length ? (
        <ul className="mt-2 divide-y divide-gold-400/15 text-sm">
          {entries.map(({ id, data }) => <HistoryRow key={id} entry={data} />)}
        </ul>
      ) : <Empty>아직 기록이 없습니다.</Empty>}
    </Frame>
  );
}

export function describeEntry(entry: LedgerEntry<Timestamp>): string {
  const detail = entry.detail as Record<string, any>;
  switch (entry.type) {
    case "work": return `임금 ${detail.gross} − 지배인 몫 ${detail.deduction}`;
    case "betOpen": return `${detail.venue === "house" ? "하우스" : "뒷골목"} 판돈`;
    case "betSettle": return detail.summary || "정산";
    case "skill": return `${detail.skillName} ${detail.baseLevel}→${detail.usedLevel}점${detail.borrowed ? ` (차입 ${detail.borrowed})` : ""}${detail.note ? ` · ${detail.note}` : ""}`;
    case "shop": return `${detail.itemName} ×${detail.quantity}`;
    case "itemUse": return `${detail.itemName} 사용`;
    case "fundContribution": return `${detail.title}`;
    case "adminAdjust": return entry.memo;
    case "arrival": return `환영 봉투 ${detail.loan} · 개찰구 ${detail.gateFee}`;
    case "marketOpen": return `${detail.coin} ${detail.side === "short" ? "숏" : "롱"} ${detail.leverage}배 · 증거금 ${detail.margin} + 수수료 ${detail.fee}`;
    case "marketClose": {
      const kind = ({ close: "청산", cap: "자동 익절", liquidated: "강제 청산", refund: "무효 환불" } as Record<string, string>)[detail.kind] ?? "정산";
      return `${detail.coin} ${detail.side === "short" ? "숏" : "롱"} ${detail.leverage}배 ${kind}${detail.kind === "close" || detail.kind === "cap" ? ` · 손익 ${detail.pnl} · 이자 ${detail.interest} · 수수료 ${detail.fee}` : ""}`;
    }
    case "spotBuy": return `${detail.coin} ${(detail.units / 10_000).toFixed(4)}개 매수 · 가격 ${(detail.price / 100).toFixed(2)} · 수수료 ${detail.fee}`;
    case "spotSell": return `${detail.coin} ${(detail.units / 10_000).toFixed(4)}개 매도 · 가격 ${(detail.price / 100).toFixed(2)} · 손익 ${detail.payout - detail.costOut}`;
    default: return "";
  }
}

function HistoryRow({ entry }: { entry: LedgerEntry<Timestamp> }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p><span className="chip mr-1.5 !py-0 text-[0.7rem]">{LEDGER_LABELS[entry.type]}</span><span className="text-mist">{entry.at ? formatDate(entry.at.toMillis()) : ""}</span></p>
        <p className="mt-0.5 truncate text-xs text-mist">{describeEntry(entry)}</p>
      </div>
      <div className="shrink-0 text-right">
        {entry.delta !== 0 && <p className={cx("font-bold", entry.delta > 0 ? "text-[#a9ecc9]" : "text-[#f2b3aa]")}><Coins value={entry.delta} signed /></p>}
        {entry.debtDelta !== 0 && <p className="text-xs text-[#f2b3aa]">빚 {entry.debtDelta > 0 ? "+" : ""}{entry.debtDelta.toLocaleString("ko-KR")}</p>}
      </div>
    </li>
  );
}
