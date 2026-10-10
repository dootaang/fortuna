import { useState } from "react";
import { limit, orderBy, query } from "firebase/firestore";
import { adjustVault, refs, withdrawJoint } from "@fortuna/data";
import { useLiveQuery } from "../session/live.ts";
import { Coins, Empty, Frame, NumberField, TextField, formatDate, useAction } from "../ui/kit.tsx";
import { SectionTitle, useDealer } from "./DealerApp.tsx";

const LOG_LABELS: Record<string, string> = { vault: "금고 조정", joint: "공동 지갑 인출", liberate: "구역 해방", district: "구역 설정" };

export function VaultAdmin() {
  const { vault, treasury, session, players } = useDealer();
  const vaultAction = useAction(), jointAction = useAction();
  const [vaultDelta, setVaultDelta] = useState(0);
  const [vaultMemo, setVaultMemo] = useState("");
  const [amount, setAmount] = useState(0);
  const [memo, setMemo] = useState("");
  const [target, setTarget] = useState("");
  const logs = useLiveQuery(query(refs.adminLog(session.db), orderBy("at", "desc"), limit(50)), "dealer:adminLog");
  const names = new Map(players.map((row) => [row.id, row.data.name]));

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Frame>
          <SectionTitle title="지배인 금고" />
          <p className="deco-title text-3xl"><Coins value={vault?.amount ?? 0} /></p>
          <p className="mt-1 text-xs text-mist">하우스 순손익, 임금 공제, 빚 상환, 개찰구 요금이 자동으로 들어옵니다.</p>
          <div className="mt-3 space-y-2">
            <NumberField label="조정 (+/−)" value={vaultDelta} onChange={setVaultDelta} />
            <TextField label="사유 (필수)" value={vaultMemo} onChange={setVaultMemo} placeholder="예: 간부 격파로 금고 타격" />
            <button type="button" className="btn btn-gold w-full" disabled={vaultAction.busy || !vaultDelta || !vaultMemo.trim()}
              onClick={() => void vaultAction.run(async () => { await adjustVault(session, vaultDelta, vaultMemo); setVaultDelta(0); setVaultMemo(""); }, "금고를 조정했습니다.")}>금고 조정</button>
          </div>
        </Frame>
        <Frame>
          <SectionTitle title="공동 지갑" />
          <p className="deco-title text-3xl"><Coins value={treasury?.amount ?? 0} /></p>
          <p className="mt-1 text-xs text-mist">플레이어가 넣은 코인. 딜러만 꺼낼 수 있습니다.</p>
          <div className="mt-3 space-y-2">
            <NumberField label="인출 금액" value={amount} onChange={setAmount} min={1} max={treasury?.amount ?? 0} />
            <label className="block">
              <span className="field-label">보낼 곳</span>
              <select className="field" value={target} onChange={(event) => setTarget(event.target.value)}>
                <option value="">소멸 (최종전 등에 사용)</option>
                {players.map((row) => <option key={row.id} value={row.id}>{row.data.name}에게 지급</option>)}
              </select>
            </label>
            <TextField label="사유 (필수)" value={memo} onChange={setMemo} placeholder="예: 최종전 투입" />
            <button type="button" className="btn btn-gold w-full" disabled={jointAction.busy || amount <= 0 || !memo.trim()}
              onClick={() => void jointAction.run(async () => { await withdrawJoint(session, amount, memo, target || null); setAmount(0); setMemo(""); }, "인출했습니다.")}>인출</button>
          </div>
        </Frame>
      </div>
      <section>
        <SectionTitle title="딜러 작업 기록" />
        <div className="deco-frame overflow-x-auto p-2">
          <table className="table min-w-[32rem]">
            <thead><tr><th>시각</th><th>종류</th><th>대상</th><th className="text-right">금액</th><th>사유</th></tr></thead>
            <tbody>
              {(logs.status === "ready" ? logs.data : []).map(({ id, data }) => (
                <tr key={id}>
                  <td className="whitespace-nowrap text-xs text-mist">{data.at ? formatDate(data.at.toMillis()) : "…"}</td>
                  <td>{LOG_LABELS[data.kind] ?? data.kind}</td>
                  <td>{names.get(data.target) ?? data.target}</td>
                  <td className="text-right num">{data.amount.toLocaleString("ko-KR")}</td>
                  <td className="text-xs">{data.memo}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.status === "ready" && logs.data.length === 0 && <Empty>기록이 없습니다.</Empty>}
        </div>
      </section>
    </div>
  );
}
