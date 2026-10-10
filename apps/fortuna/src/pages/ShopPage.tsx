import { useMemo, useState } from "react";
import { getDoc, query, where } from "firebase/firestore";
import { TEXT } from "@fortuna/core";
import { SHOP_CATEGORIES, SHOP_CATEGORY_LABELS, buyItem, contributeFund, friendlyError, refs, type FundDoc, type InventoryDoc, type ShopCategory, type ShopItemDoc } from "@fortuna/data";
import { usePlayer } from "../session/player.tsx";
import { useLiveQuery, type Row } from "../session/live.ts";
import { Coins, Empty, Frame, Modal, Notice, PageTitle, cx, useAction } from "../ui/kit.tsx";

export default function ShopPage() {
  const { session } = usePlayer();
  const [tab, setTab] = useState<ShopCategory | "all" | "funds">("all");
  const items = useLiveQuery(query(refs.items(session.db), where("visible", "==", true)), "shop:items");
  const funds = useLiveQuery(query(refs.funds(session.db), where("visible", "==", true)), "shop:funds");
  const owned = useLiveQuery(query(refs.inventories(session.db), where("playerId", "==", session.pid)), `shop:inv:${session.pid}`);
  const ownedById = useMemo(() => new Map((owned.status === "ready" ? owned.data : []).map((row) => [row.data.itemId, row.data])), [owned]);
  const list = (items.status === "ready" ? items.data : []).filter((row) => tab === "all" || row.data.category === tab).sort((a, b) => a.data.sortOrder - b.data.sortOrder || a.data.price - b.data.price);
  const fundList = (funds.status === "ready" ? funds.data : []).sort((a, b) => a.data.sortOrder - b.data.sortOrder);

  return (
    <div>
      <PageTitle eyebrow="EMPORIUM" title={TEXT.lobby.shop} line={TEXT.lobby.shopLine} />
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist">
        {(["all", ...SHOP_CATEGORIES, "funds"] as const).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={cx("btn btn-sm shrink-0", tab === key ? "btn-gold" : "btn-dark")} onClick={() => setTab(key)}>
            {key === "all" ? "전체" : key === "funds" ? `${TEXT.fund.title}${fundList.length ? ` ${fundList.length}` : ""}` : SHOP_CATEGORY_LABELS[key]}
          </button>
        ))}
      </div>
      {tab === "funds" ? (
        fundList.length ? <div className="space-y-3">{fundList.map((row) => <FundCard key={row.id} row={row} />)}</div> : <Empty>지금 열려 있는 모금함이 없습니다.</Empty>
      ) : items.status === "loading" ? <Empty>진열장을 여는 중…</Empty> : list.length ? (
        <div className="grid gap-3 sm:grid-cols-2">{list.map((row) => <ItemCard key={row.id} row={row} owned={ownedById.get(row.id)} />)}</div>
      ) : <Empty>이 진열장은 비어 있습니다.</Empty>}
    </div>
  );
}

function ItemCard({ row, owned }: { row: Row<ShopItemDoc>; owned: InventoryDoc | undefined }) {
  const { session, wallet } = usePlayer();
  const { busy, run } = useAction();
  const [quantity, setQuantity] = useState(1);
  const [secret, setSecret] = useState<string | null>(null);
  const item = row.data;
  const soldOut = item.stock !== null && item.stock <= 0;
  const limitLeft = item.perPlayerLimit === null ? Infinity : item.perPlayerLimit - (owned?.purchased ?? 0);
  const maxQuantity = Math.max(1, Math.min(99, limitLeft, item.stock ?? 99, Math.floor(wallet.balance / Math.max(1, item.price))));
  const canBuy = !soldOut && limitLeft > 0 && wallet.balance >= item.price * quantity;

  async function openSecret() {
    try { setSecret((await getDoc(refs.secret(session.db, row.id))).data()?.text ?? ""); } catch (error) { setSecret(friendlyError(error)); }
  }

  return (
    <Frame as="article" className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="deco-caps !text-[0.6rem]">{SHOP_CATEGORY_LABELS[item.category]}{item.hasSecret ? " · 비밀" : ""}</p>
          <h2 className="deco-title text-lg leading-snug">{item.name}</h2>
        </div>
        <span className="chip chip-gold shrink-0"><Coins value={item.price} /></span>
      </div>
      {item.description && <p className="mt-2 whitespace-pre-line text-sm text-mist">{item.description}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
        {item.stock !== null && <span className={cx("chip", soldOut && "chip-ruby")}>{soldOut ? TEXT.shop.soldOut : `재고 ${item.stock}`}</span>}
        {item.perPlayerLimit !== null && <span className="chip">1인 {item.perPlayerLimit}개</span>}
        {owned && <span className="chip chip-jade">보유 {owned.quantity}{owned.used ? ` · 사용 ${owned.used}` : ""}</span>}
      </div>
      <div className="mt-auto pt-3">
        {owned && item.hasSecret && <button type="button" className="btn btn-ghost btn-sm mb-2 w-full" onClick={() => void openSecret()}>🔏 {TEXT.shop.secret}</button>}
        {limitLeft <= 0 ? <Notice>{TEXT.shop.limit}</Notice> : (
          <div className="flex gap-2">
            {item.consumable && maxQuantity > 1 && (
              <select className="field w-20" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} aria-label="수량">
                {Array.from({ length: maxQuantity }, (_, index) => <option key={index} value={index + 1}>{index + 1}개</option>)}
              </select>
            )}
            <button type="button" className="btn btn-gold flex-1" disabled={busy || !canBuy} onClick={() => void run(() => buyItem(session, row.id, quantity), TEXT.shop.bought)}>
              {soldOut ? TEXT.shop.soldOut : busy ? "포장 중…" : `구매 · ${(item.price * quantity).toLocaleString("ko-KR")}`}
            </button>
          </div>
        )}
      </div>
      <Modal open={secret !== null} onClose={() => setSecret(null)} title={item.name}>
        <p className="deco-caps mb-2">{TEXT.shop.secret}</p>
        <p className="whitespace-pre-line rounded-sm border border-gold-400/30 bg-ink/50 p-3 font-display leading-7">{secret || "내용이 비어 있습니다."}</p>
      </Modal>
    </Frame>
  );
}

function FundCard({ row }: { row: Row<FundDoc> }) {
  const { session, wallet } = usePlayer();
  const { busy, run } = useAction();
  const fund = row.data, room = Math.max(0, fund.goal - fund.current), ratio = Math.min(1, fund.current / Math.max(1, fund.goal));
  const [amount, setAmount] = useState(Math.min(100, room));
  return (
    <Frame>
      <div className="flex items-start justify-between gap-2">
        <h2 className="deco-title text-lg">{fund.title}</h2>
        {fund.status !== "open" && <span className="chip chip-jade">{fund.status === "filled" ? "달성" : "마감"}</span>}
      </div>
      {fund.description && <p className="mt-1 whitespace-pre-line text-sm text-mist">{fund.description}</p>}
      <div className="mt-3 h-4 overflow-hidden rounded-full border border-gold-400/50 bg-ink" role="progressbar" aria-valuemin={0} aria-valuemax={fund.goal} aria-valuenow={fund.current}>
        <div className="h-full bg-gradient-to-r from-gold-500 via-gold-300 to-gold-200 transition-[width] duration-500" style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className="mt-1 text-right text-sm"><Coins value={fund.current} /> / <span className="num">{fund.goal.toLocaleString("ko-KR")}</span></p>
      {fund.status === "open" ? (
        <div className="mt-3 flex gap-2">
          <input type="number" inputMode="numeric" className="field num" min={1} max={room} value={amount} onChange={(event) => setAmount(Math.max(0, Math.floor(Number(event.target.value) || 0)))} aria-label="보탤 금액" />
          <button type="button" className="btn btn-gold shrink-0" disabled={busy || amount <= 0 || amount > room || amount > wallet.balance}
            onClick={() => void run(async () => { const result = await contributeFund(session, row.id, amount); return result; }, "모금함에 보탰습니다.")}>보태기</button>
        </div>
      ) : <p className="mt-2 text-center text-sm text-gold-200">{TEXT.fund.filled}</p>}
    </Frame>
  );
}
