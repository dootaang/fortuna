import { query, where } from "firebase/firestore";
import { GAME_CONTENT, districtContent, periodWords, usedInPeriod } from "@fortuna/core";
import { closePvpRoom, pvpRefs, refs } from "@fortuna/data";
import { useLiveQuery } from "../session/live.ts";
import { Coins, Frame, Notice, Stat, cx, useAction } from "../ui/kit.tsx";
import { SectionTitle, useDealer } from "./DealerApp.tsx";

export function Overview() {
  const { players, wallets, config, vault, treasury, session } = useDealer();
  const inventories = useLiveQuery(refs.inventories(session.db), "dealer:inventories");
  const filledFunds = useLiveQuery(query(refs.funds(session.db), where("status", "==", "filled")), "dealer:funds:filled");
  const now = session.clock.now();
  const totals = players.reduce((sum, row) => {
    const wallet = wallets.get(row.id);
    return { coins: sum.coins + (wallet?.balance ?? 0), debt: sum.debt + (wallet?.debt ?? 0) };
  }, { coins: 0, debt: 0 });
  const items = new Map<string, { name: string; quantity: number }[]>();
  if (inventories.status === "ready") for (const row of inventories.data) if (row.data.quantity > 0) items.set(row.data.playerId, [...(items.get(row.data.playerId) ?? []), { name: row.data.itemName, quantity: row.data.quantity }]);
  const openWagers = players.filter((row) => wallets.get(row.id)?.openWager);

  return (
    <div className="space-y-5">
      <Frame>
        <div className="grid grid-cols-2 gap-y-2 sm:grid-cols-4">
          <Stat label="지배인 금고" tone="gold"><Coins value={vault?.amount ?? 0} /></Stat>
          <Stat label="공동 지갑" tone="gold"><Coins value={treasury?.amount ?? 0} /></Stat>
          <Stat label="플레이어 코인 합계"><Coins value={totals.coins} /></Stat>
          <Stat label="빚 합계" tone="ruby"><span className="num">{totals.debt.toLocaleString("ko-KR")}</span></Stat>
        </div>
        <p className="mt-2 text-center text-xs text-mist">하우스 {config.gambling.houseOpen ? "영업 중" : "닫힘"} · 한도({periodWords(config.limitPeriod).now} 기준) 일 {config.work.limit}회 / 도박 {config.gambling.limit}판</p>
      </Frame>

      {filledFunds.status === "ready" && filledFunds.data.length > 0 && (
        <Notice tone="success">🎉 목표를 채운 모금함: {filledFunds.data.map((row) => row.data.title).join(", ")} — 상점·모금 탭에서 마감 처리하십시오.</Notice>
      )}
      {openWagers.length > 0 && (
        <Notice>진행 중인 판: {openWagers.map((row) => `${row.data.name}(${GAME_CONTENT[wallets.get(row.id)!.openWager!.game].title})`).join(", ")}</Notice>
      )}

      <PvpRooms />

      <section>
        <SectionTitle title="플레이어 한눈에 보기" />
        <div className="deco-frame overflow-x-auto p-2">
          <table className="table min-w-[44rem]">
            <thead><tr><th>이름</th><th>구역</th><th className="text-right">잔액</th><th className="text-right">빚</th><th className="text-center">일</th><th className="text-center">도박</th><th>보유 물품</th></tr></thead>
            <tbody>
              {players.map((row) => {
                const wallet = wallets.get(row.id);
                return (
                  <tr key={row.id}>
                    <td className="font-bold">{row.data.name}{wallet && !wallet.arrived && <span className="chip ml-1 !py-0 text-[0.65rem]">미도착</span>}</td>
                    <td>{districtContent(row.data.districtId).name}</td>
                    <td className="text-right"><Coins value={wallet?.balance ?? 0} /></td>
                    <td className="text-right num">{(wallet?.debt ?? 0).toLocaleString("ko-KR")}</td>
                    <td className="text-center num">{wallet ? usedInPeriod(wallet, "work", now, config.limitPeriod) : 0}/{config.work.limit}</td>
                    <td className="text-center num">{wallet ? usedInPeriod(wallet, "gamble", now, config.limitPeriod) : 0}/{config.gambling.limit}</td>
                    <td className="text-xs text-mist">{(items.get(row.id) ?? []).map((item) => `${item.name}×${item.quantity}`).join(", ") || "—"}</td>
                  </tr>
                );
              })}
              {players.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-mist">등록된 플레이어가 없습니다. 플레이어 탭에서 등록하십시오.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** Live PvP tables; the dealer can void one (everyone gets their stake back). */
function PvpRooms() {
  const { session } = useDealer();
  const { busy, run } = useAction();
  const rooms = useLiveQuery(query(pvpRefs.rooms(session.db), where("status", "in", ["waiting", "dealing", "playing"])), "dealer:pvp");
  const rows = rooms.status === "ready" ? rooms.data : [];
  if (!rows.length) return null;
  return (
    <section>
      <SectionTitle title="진행 중인 대결" />
      <div className="grid gap-2 md:grid-cols-2">
        {rows.map(({ id, data }) => (
          <Frame key={id} className="flex items-center justify-between gap-3 !p-3">
            <div className="min-w-0 text-sm">
              <p className="font-bold">{data.venue === "house" ? "하우스" : "뒷골목"} · 판돈 <Coins value={data.stake} /> · <span className={cx(data.status === "playing" ? "text-gold-200" : "text-mist")}>{data.status === "waiting" ? "대기" : data.status === "dealing" ? "배분 중" : `진행 ${data.moves ?? 0}수`}</span></p>
              <p className="truncate text-xs text-mist">{Object.values(data.seats).map((seat) => seat.name).join(", ")}</p>
            </div>
            <button type="button" className="btn btn-danger btn-sm shrink-0" disabled={busy} onClick={() => { if (window.confirm("이 판을 무효로 할까요? 모두 판돈을 돌려받습니다.")) void run(() => closePvpRoom(session, id, "void"), "무효 처리했습니다."); }}>무효</button>
          </Frame>
        ))}
      </div>
    </section>
  );
}
