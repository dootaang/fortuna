import { useEffect, useState } from "react";
import { getDoc } from "firebase/firestore";
import { SHOP_CATEGORIES, SHOP_CATEGORY_LABELS, deleteFund, deleteItem, refs, saveFund, saveItem, type FundDoc, type FundInput, type ItemInput, type ShopCategory, type ShopItemDoc } from "@fortuna/data";
import { useLiveQuery, type Row } from "../session/live.ts";
import { Coins, Empty, Frame, Modal, NumberField, TextField, Toggle, cx, useAction } from "../ui/kit.tsx";
import { SectionTitle, useDealer } from "./DealerApp.tsx";

/** 분류별 기본값 (브리프의 예시 가격대). */
const PRESETS: Record<ShopCategory, Partial<ItemInput>> = {
  rumor: { price: 300, consumable: false, perPlayerLimit: 1, stock: null },
  consumable: { price: 200, consumable: true, perPlayerLimit: null, stock: null },
  challenge: { price: 1_500, consumable: true, perPlayerLimit: null, stock: null },
  skillPoint: { price: 8_000, consumable: true, perPlayerLimit: null, stock: null },
  misc: { price: 100, consumable: false, perPlayerLimit: null, stock: null },
};

const blankItem = (category: ShopCategory = "rumor"): ItemInput => ({
  name: "", description: "", price: 0, category, stock: null, perPlayerLimit: null, visible: false, consumable: false, hasSecret: false, revealNote: "", sortOrder: 0, ...PRESETS[category],
});

export function ShopAdmin() {
  const { session } = useDealer();
  const items = useLiveQuery(refs.items(session.db), "dealer:items");
  const funds = useLiveQuery(refs.funds(session.db), "dealer:funds");
  const [editing, setEditing] = useState<{ id: string | null; data: ItemInput } | null>(null);
  const [fundEditing, setFundEditing] = useState<{ id: string | null; data: FundInput & { current: number } } | null>(null);
  const itemRows = (items.status === "ready" ? items.data : []).sort((a, b) => Number(b.data.visible) - Number(a.data.visible) || a.data.category.localeCompare(b.data.category) || a.data.sortOrder - b.data.sortOrder);
  const fundRows = funds.status === "ready" ? funds.data : [];

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle title="상점 품목"><button type="button" className="btn btn-gold btn-sm" onClick={() => setEditing({ id: null, data: blankItem() })}>+ 품목 추가</button></SectionTitle>
        <div className="deco-frame overflow-x-auto p-2">
          <table className="table min-w-[46rem]">
            <thead><tr><th>노출</th><th>이름</th><th>분류</th><th className="text-right">가격</th><th className="text-right">재고</th><th className="text-right">1인 한도</th><th>메모</th><th /></tr></thead>
            <tbody>
              {itemRows.map((row) => (
                <tr key={row.id} className={cx(!row.data.visible && "opacity-60")}>
                  <td><ItemVisibility row={row} /></td>
                  <td className="font-bold">{row.data.name}{row.data.hasSecret && <span className="chip ml-1 !py-0 text-[0.65rem]">비밀</span>}{row.data.consumable && <span className="chip ml-1 !py-0 text-[0.65rem]">소모</span>}</td>
                  <td>{SHOP_CATEGORY_LABELS[row.data.category]}</td>
                  <td className="text-right"><Coins value={row.data.price} /></td>
                  <td className="text-right num">{row.data.stock ?? "∞"}</td>
                  <td className="text-right num">{row.data.perPlayerLimit ?? "—"}</td>
                  <td className="max-w-48 text-xs text-mist">{row.data.revealNote}</td>
                  <td className="whitespace-nowrap text-right">
                    <button type="button" className="btn btn-dark btn-sm" onClick={() => setEditing({ id: row.id, data: stripLedger(row.data) })}>수정</button>
                    <button type="button" className="btn btn-ghost btn-sm ml-1" onClick={() => setEditing({ id: null, data: { ...stripLedger(row.data), name: `${row.data.name} (복사)`, visible: false } })}>복제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.status === "ready" && itemRows.length === 0 && <Empty>아직 품목이 없습니다.</Empty>}
        </div>
      </section>

      <section>
        <SectionTitle title="모금함"><button type="button" className="btn btn-gold btn-sm" onClick={() => setFundEditing({ id: null, data: { title: "", description: "", goal: 5_000, current: 0, status: "open", visible: true, sortOrder: 0 } })}>+ 모금함 추가</button></SectionTitle>
        <div className="grid gap-3 md:grid-cols-2">
          {fundRows.map((row) => <FundRow key={row.id} row={row} onEdit={() => setFundEditing({ id: row.id, data: { ...row.data } })} />)}
        </div>
        {funds.status === "ready" && fundRows.length === 0 && <Empty>모금함이 없습니다.</Empty>}
      </section>

      {editing && <ItemEditor initial={editing} onClose={() => setEditing(null)} />}
      {fundEditing && <FundEditor initial={fundEditing} onClose={() => setFundEditing(null)} />}
    </div>
  );
}

function stripLedger(item: ShopItemDoc): ItemInput { const { lastLedger: _unused, ...rest } = item; return rest; }

function ItemVisibility({ row }: { row: Row<ShopItemDoc> }) {
  const { session } = useDealer();
  const { busy, run } = useAction();
  return (
    <button type="button" className={cx("btn btn-sm", row.data.visible ? "btn-gold" : "btn-dark")} disabled={busy}
      onClick={() => void run(() => saveItem(session, row.id, { ...stripLedger(row.data), visible: !row.data.visible }, null))}>{row.data.visible ? "보임" : "숨김"}</button>
  );
}

function ItemEditor({ initial, onClose }: { initial: { id: string | null; data: ItemInput }; onClose: () => void }) {
  const { session } = useDealer();
  const { busy, run } = useAction();
  const [item, setItem] = useState<ItemInput>(initial.data);
  const [secret, setSecret] = useState<string>("");
  const [secretLoaded, setSecretLoaded] = useState(initial.id === null);
  const set = <K extends keyof ItemInput>(key: K, value: ItemInput[K]) => setItem((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!initial.id) return;
    void getDoc(refs.secret(session.db, initial.id)).then((snapshot) => { setSecret(snapshot.data()?.text ?? ""); setSecretLoaded(true); }).catch(() => setSecretLoaded(true));
  }, [initial.id, session.db]);

  return (
    <Modal open onClose={onClose} title={initial.id ? "품목 수정" : "품목 추가"} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><TextField label="이름" value={item.name} onChange={(value) => set("name", value)} maxLength={60} /></div>
        <label className="block">
          <span className="field-label">분류</span>
          <select className="field" value={item.category} onChange={(event) => { const category = event.target.value as ShopCategory; setItem((current) => ({ ...current, ...PRESETS[category], category, name: current.name, description: current.description })); }}>
            {SHOP_CATEGORIES.map((category) => <option key={category} value={category}>{SHOP_CATEGORY_LABELS[category]}</option>)}
          </select>
        </label>
        <NumberField label="가격" value={item.price} onChange={(value) => set("price", value)} min={0} suffix="코인" />
        <div className="sm:col-span-2"><TextField label="설명 (모두에게 보임)" value={item.description} onChange={(value) => set("description", value)} multiline /></div>
        <div>
          <Toggle label="재고 무제한" checked={item.stock === null} onChange={(value) => set("stock", value ? null : 1)} />
          {item.stock !== null && <NumberField label="재고 수량" value={item.stock} onChange={(value) => set("stock", value)} min={0} />}
        </div>
        <div>
          <Toggle label="1인당 구매 한도 없음" checked={item.perPlayerLimit === null} onChange={(value) => set("perPlayerLimit", value ? null : 1)} />
          {item.perPlayerLimit !== null && <NumberField label="1인당 최대" value={item.perPlayerLimit} onChange={(value) => set("perPlayerLimit", value)} min={1} />}
        </div>
        <Toggle label="상점에 노출" checked={item.visible} onChange={(value) => set("visible", value)} />
        <Toggle label="소모품 (플레이어가 '사용' 가능)" checked={item.consumable} onChange={(value) => set("consumable", value)} />
        <NumberField label="정렬 순서" value={item.sortOrder} onChange={(value) => set("sortOrder", value)} />
        <TextField label="노출 조건 메모 (딜러만 봄)" value={item.revealNote} onChange={(value) => set("revealNote", value)} placeholder="예: 무협 구역 해방 후 공개" />
        <div className="sm:col-span-2">
          <TextField label="비밀 내용 (산 사람만 열람)" value={secret} onChange={setSecret} multiline placeholder={secretLoaded ? "비워 두면 비밀 없음" : "불러오는 중…"} />
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        {initial.id && (
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => {
            if (!window.confirm("이 품목을 삭제할까요? 이미 산 사람의 보유 물품 기록은 남습니다. 보통은 '숨김'을 권합니다.")) return;
            void run(async () => { await deleteItem(session, initial.id as string); onClose(); }, "삭제했습니다.");
          }}>삭제</button>
        )}
        <button type="button" className="btn btn-gold flex-1" disabled={busy || !secretLoaded || !item.name.trim() || !Number.isInteger(item.price)}
          onClick={() => void run(async () => { await saveItem(session, initial.id, { ...item, hasSecret: secret.trim().length > 0 }, secret); onClose(); }, "저장했습니다.")}>저장</button>
      </div>
    </Modal>
  );
}

function FundRow({ row, onEdit }: { row: Row<FundDoc>; onEdit: () => void }) {
  const fund = row.data, ratio = Math.min(1, fund.current / Math.max(1, fund.goal));
  return (
    <Frame className={cx(!fund.visible && "opacity-60")}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="deco-title text-lg">{fund.title}</h3>
        <span className={cx("chip", fund.status === "filled" ? "chip-jade pulse-gold" : fund.status === "closed" ? "" : "chip-gold")}>{fund.status === "filled" ? "달성!" : fund.status === "closed" ? "마감" : "모금 중"}</span>
      </div>
      <div className="mt-2 h-3 overflow-hidden rounded-full border border-gold-400/40 bg-ink"><div className="h-full bg-gold-400" style={{ width: `${ratio * 100}%` }} /></div>
      <p className="mt-1 text-right text-sm"><Coins value={fund.current} /> / {fund.goal.toLocaleString("ko-KR")}</p>
      <button type="button" className="btn btn-dark btn-sm mt-2" onClick={onEdit}>수정</button>
    </Frame>
  );
}

function FundEditor({ initial, onClose }: { initial: { id: string | null; data: FundInput & { current: number } }; onClose: () => void }) {
  const { session } = useDealer();
  const { busy, run } = useAction();
  const [fund, setFund] = useState(initial.data);
  const set = <K extends keyof typeof fund>(key: K, value: (typeof fund)[K]) => setFund((current) => ({ ...current, [key]: value }));
  return (
    <Modal open onClose={onClose} title={initial.id ? "모금함 수정" : "모금함 추가"}>
      <div className="space-y-3">
        <TextField label="이름" value={fund.title} onChange={(value) => set("title", value)} />
        <TextField label="설명" value={fund.description} onChange={(value) => set("description", value)} multiline />
        <NumberField label="목표 금액" value={fund.goal} onChange={(value) => set("goal", value)} min={1} suffix="코인" />
        <NumberField label="현재 금액 (수동 보정)" value={fund.current} onChange={(value) => set("current", value)} min={0} suffix="코인" />
        <label className="block">
          <span className="field-label">상태</span>
          <select className="field" value={fund.status} onChange={(event) => set("status", event.target.value as FundDoc["status"])}>
            <option value="open">모금 중</option><option value="filled">달성</option><option value="closed">마감</option>
          </select>
        </label>
        <Toggle label="상점에 노출" checked={fund.visible} onChange={(value) => set("visible", value)} />
        <NumberField label="정렬 순서" value={fund.sortOrder} onChange={(value) => set("sortOrder", value)} />
        <div className="flex gap-2">
          {initial.id && <button type="button" className="btn btn-danger" disabled={busy} onClick={() => { if (window.confirm("모금함을 삭제할까요? 보탠 기록은 장부에 남습니다.")) void run(async () => { await deleteFund(session, initial.id as string); onClose(); }); }}>삭제</button>}
          <button type="button" className="btn btn-gold flex-1" disabled={busy || !fund.title.trim()} onClick={() => void run(async () => { await saveFund(session, initial.id, fund); onClose(); }, "저장했습니다.")}>저장</button>
        </div>
      </div>
    </Modal>
  );
}
