import { useMemo, useState } from "react";
import { Navigate } from "react-router";
import { getDoc, query, where } from "firebase/firestore";
import { TEXT } from "@fortuna/core";
import { SHOP_CATEGORIES, SHOP_CATEGORY_LABELS, buyItem, friendlyError, refs, type InventoryDoc, type ShopCategory, type ShopItemDoc } from "@fortuna/data";
import { usePlayer } from "../session/player.tsx";
import { useLiveQuery, type Row } from "../session/live.ts";
import { Coins, Empty, Frame, Modal, Notice, PageTitle, cx, useAction } from "../ui/kit.tsx";
import { relay } from "../relay.ts";

export default function ShopPage() {
  const { session, config } = usePlayer();
  if (!config.shopEnabled) return <Navigate to="/" replace />;
  return <Shop key={session.pid} />;
}

function Shop() {
  const { session } = usePlayer();
  const [tab, setTab] = useState<ShopCategory | "all">("all");
  const items = useLiveQuery(query(refs.items(session.db), where("visible", "==", true)), "shop:items");
  const owned = useLiveQuery(query(refs.inventories(session.db), where("playerId", "==", session.pid)), `shop:inv:${session.pid}`);
  const ownedById = useMemo(() => new Map((owned.status === "ready" ? owned.data : []).map((row) => [row.data.itemId, row.data])), [owned]);
  const list = (items.status === "ready" ? items.data : []).filter((row) => tab === "all" || row.data.category === tab).sort((a, b) => a.data.sortOrder - b.data.sortOrder || a.data.price - b.data.price);

  return (
    <div>
      <PageTitle eyebrow="EMPORIUM" title={TEXT.lobby.shop} />
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist">
        {(["all", ...SHOP_CATEGORIES] as const).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={cx("btn btn-sm shrink-0", tab === key ? "btn-gold" : "btn-dark")} onClick={() => setTab(key)}>
            {key === "all" ? "전체" : SHOP_CATEGORY_LABELS[key]}
          </button>
        ))}
      </div>
      {items.status === "loading" ? <Empty>진열장을 여는 중…</Empty> : list.length ? (
        <div className="grid gap-3 sm:grid-cols-2">{list.map((row) => <ItemCard key={row.id} row={row} owned={ownedById.get(row.id)} />)}</div>
      ) : <Empty>이 진열장은 비어 있습니다.</Empty>}
    </div>
  );
}

function ItemCard({ row, owned }: { row: Row<ShopItemDoc>; owned: InventoryDoc | undefined }) {
  const { session, wallet, notify } = usePlayer();
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
            <button type="button" className="btn btn-gold flex-1" disabled={busy || !canBuy} onClick={() => void run(() => buyItem(session, row.id, quantity), TEXT.shop.bought).then((id) => relay(notify.relayUrl, id))}>
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
