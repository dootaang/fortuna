import { useState } from "react";
import { getDoc, query, where } from "firebase/firestore";
import { DISTRICTS, districtContent } from "@fortuna/core";
import { adjustWallet, adminUseItem, createPlayer, refs, reissueCode, updatePlayer, type PlayerDoc, type PlayerInput } from "@fortuna/data";
import { useLiveQuery, type Row } from "../session/live.ts";
import { Coins, Frame, Modal, Notice, NumberField, TextField, Toggle, useAction, useToast } from "../ui/kit.tsx";
import { SectionTitle, useDealer } from "./DealerApp.tsx";

export function Players() {
  const { players, wallets } = useDealer();
  const [editing, setEditing] = useState<Row<PlayerDoc> | "new" | null>(null);
  const [adjusting, setAdjusting] = useState<Row<PlayerDoc> | null>(null);
  const [codeFor, setCodeFor] = useState<{ name: string; code: string } | null>(null);
  return (
    <div>
      <SectionTitle title="플레이어"><button type="button" className="btn btn-gold btn-sm" onClick={() => setEditing("new")}>+ 플레이어 등록</button></SectionTitle>
      <div className="grid gap-3 md:grid-cols-2">
        {players.map((row) => {
          const wallet = wallets.get(row.id);
          return (
            <Frame key={row.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="deco-title text-lg">{row.data.name}</h3>
                  <p className="text-xs text-mist">{districtContent(row.data.districtId).name} · 코드 {row.data.codeVersion}판</p>
                </div>
                <div className="text-right text-sm">
                  <p><Coins value={wallet?.balance ?? 0} /></p>
                  <p className="text-xs text-[#f2b3aa]">빚 {(wallet?.debt ?? 0).toLocaleString("ko-KR")}</p>
                </div>
              </div>
              <p className="mt-2 text-sm">{Object.values(row.data.skills).map((skill) => `${skill.name} ${skill.level}점`).join(" · ") || <span className="text-mist">특기 없음</span>}</p>
              {row.data.note && <p className="mt-1 text-xs text-mist">{row.data.note}</p>}
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button type="button" className="btn btn-dark btn-sm" onClick={() => setEditing(row)}>수정</button>
                <button type="button" className="btn btn-dark btn-sm" onClick={() => setAdjusting(row)}>지급·차감</button>
                <CodeButtons row={row} onShow={setCodeFor} />
              </div>
              <PlayerItems pid={row.id} />
            </Frame>
          );
        })}
      </div>
      {players.length === 0 && <Notice>아직 등록된 플레이어가 없습니다.</Notice>}
      {editing && <PlayerEditor row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onCreated={(name, code) => { setEditing(null); setCodeFor({ name, code }); }} />}
      {adjusting && <AdjustModal row={adjusting} onClose={() => setAdjusting(null)} />}
      <Modal open={codeFor !== null} onClose={() => setCodeFor(null)} title={`${codeFor?.name ?? ""}의 접속 코드`}>
        <p className="text-sm text-mist">이 코드를 플레이어에게 개인 메시지로 전해 주십시오. 기기를 바꿔도 같은 코드로 다시 들어올 수 있습니다.</p>
        <p className="my-4 select-all rounded-sm border border-gold-400 bg-ink/60 p-3 text-center font-deco text-xl tracking-[0.15em] text-gold-200">{codeFor?.code}</p>
        <button type="button" className="btn btn-gold w-full" onClick={() => void navigator.clipboard?.writeText(codeFor?.code ?? "")}>복사</button>
      </Modal>
    </div>
  );
}

function CodeButtons({ row, onShow }: { row: Row<PlayerDoc>; onShow: (value: { name: string; code: string }) => void }) {
  const { session } = useDealer();
  const { busy, run } = useAction();
  return (
    <>
      <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => void run(async () => {
        const code = (await getDoc(refs.playerSecret(session.db, row.id))).data()?.code;
        if (code) onShow({ name: row.data.name, code });
      })}>코드 보기</button>
      <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => {
        if (!window.confirm(`${row.data.name}의 접속 코드를 새로 발급할까요? 지금 연결된 모든 기기가 끊어집니다.`)) return;
        void run(async () => onShow({ name: row.data.name, code: await reissueCode(session, row.id) }), "새 코드를 발급했습니다.");
      }}>코드 재발급</button>
      <DeviceCount pid={row.id} />
    </>
  );
}

function DeviceCount({ pid }: { pid: string }) {
  const { session } = useDealer();
  const bindings = useLiveQuery(query(refs.bindings(session.db), where("playerId", "==", pid)), `dealer:bindings:${pid}`);
  return <span className="chip self-center text-xs">연결 기기 {bindings.status === "ready" ? bindings.data.length : "…"}</span>;
}

function PlayerItems({ pid }: { pid: string }) {
  const { session } = useDealer();
  const owned = useLiveQuery(query(refs.inventories(session.db), where("playerId", "==", pid)), `dealer:inv:${pid}`);
  const { busy, run } = useAction();
  const rows = owned.status === "ready" ? owned.data.filter((row) => row.data.quantity > 0) : [];
  if (!rows.length) return null;
  return (
    <ul className="mt-3 space-y-1 border-t border-gold-400/20 pt-2 text-sm">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-2">
          <span>{row.data.itemName} <span className="text-mist">×{row.data.quantity}</span></span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => {
            const memo = window.prompt(`${row.data.itemName} 1개를 사용됨으로 표시합니다. 사유를 적어 주십시오.`, "원정에서 사용");
            if (memo) void run(() => adminUseItem(session, pid, row.data.itemId, memo), "사용 처리했습니다.");
          }}>사용 처리</button>
        </li>
      ))}
    </ul>
  );
}

function PlayerEditor({ row, onClose, onCreated }: { row: Row<PlayerDoc> | null; onClose: () => void; onCreated: (name: string, code: string) => void }) {
  const { session } = useDealer();
  const { busy, run } = useAction();
  const [name, setName] = useState(row?.data.name ?? "");
  const [districtId, setDistrictId] = useState(row?.data.districtId ?? DISTRICTS[0]?.id ?? "downtown");
  const [note, setNote] = useState(row?.data.note ?? "");
  const [skills, setSkills] = useState<PlayerInput["skills"]>(row ? Object.entries(row.data.skills).map(([id, skill]) => ({ id, ...skill })) : [{ id: "", name: "", level: 1 }]);

  async function save() {
    const input: PlayerInput = { name, districtId, note, skills: skills.map((skill, index) => ({ ...skill, id: skill.id || `skill${Date.now().toString(36)}${index}` })) };
    if (row) { await updatePlayer(session, row.id, input); onClose(); }
    else { const { code } = await createPlayer(session, input); onCreated(name, code); }
  }

  return (
    <Modal open onClose={onClose} title={row ? `${row.data.name} 수정` : "플레이어 등록"} wide>
      <div className="space-y-3">
        <TextField label="캐릭터 이름" value={name} onChange={setName} maxLength={40} />
        <label className="block">
          <span className="field-label">소속 구역</span>
          <select className="field" value={districtId} onChange={(event) => setDistrictId(event.target.value)}>
            {DISTRICTS.map((district) => <option key={district.id} value={district.id}>{district.emblem} {district.name}</option>)}
          </select>
        </label>
        <div>
          <p className="field-label">특기 (이름, 점수 1~)</p>
          <div className="space-y-2">
            {skills.map((skill, index) => (
              <div key={index} className="flex gap-2">
                <input className="field" placeholder="특기 이름" value={skill.name} onChange={(event) => setSkills(skills.map((entry, slot) => slot === index ? { ...entry, name: event.target.value } : entry))} />
                <input className="field w-24 num" type="number" min={1} max={20} value={skill.level} aria-label="점수" onChange={(event) => setSkills(skills.map((entry, slot) => slot === index ? { ...entry, level: Number(event.target.value) } : entry))} />
                <button type="button" className="btn btn-ghost btn-sm" aria-label="특기 삭제" onClick={() => setSkills(skills.filter((_, slot) => slot !== index))}>✕</button>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-dark btn-sm mt-2" onClick={() => setSkills([...skills, { id: "", name: "", level: 1 }])}>+ 특기 추가</button>
          <p className="mt-1 text-xs text-mist">특기 포인트를 사면 여기서 점수를 올려 반영하십시오.</p>
        </div>
        <TextField label="메모 (딜러만 봄)" value={note} onChange={setNote} multiline />
        <button type="button" className="btn btn-gold w-full" disabled={busy || !name.trim()} onClick={() => void run(save, row ? "저장했습니다." : undefined)}>{row ? "저장" : "등록하고 접속 코드 발급"}</button>
      </div>
    </Modal>
  );
}

function AdjustModal({ row, onClose }: { row: Row<PlayerDoc>; onClose: () => void }) {
  const { session, wallets } = useDealer();
  const toast = useToast();
  const { busy, run } = useAction();
  const wallet = wallets.get(row.id);
  const [delta, setDelta] = useState(0);
  const [debtDelta, setDebtDelta] = useState(0);
  const [memo, setMemo] = useState("");
  const [closeWager, setCloseWager] = useState(false);
  const [resetArrival, setResetArrival] = useState(false);
  return (
    <Modal open onClose={onClose} title={`${row.data.name} · 지급과 차감`}>
      <p className="text-sm text-mist">현재 잔액 <Coins value={wallet?.balance ?? 0} /> · 빚 {(wallet?.debt ?? 0).toLocaleString("ko-KR")}</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <NumberField label="코인 (+지급 / −차감)" value={delta} onChange={setDelta} />
        <NumberField label="빚 (+증가 / −탕감)" value={debtDelta} onChange={setDebtDelta} />
      </div>
      <div className="mt-3"><TextField label="사유 메모 (필수)" value={memo} onChange={setMemo} placeholder="예: 3주차 원정 보상" maxLength={300} /></div>
      {wallet?.openWager && <Toggle label="진행 중인 판 강제 종료" hint="판돈은 돌려주지 않습니다. 돌려주려면 위에 금액을 함께 입력하십시오." checked={closeWager} onChange={setCloseWager} />}
      <Toggle label="도착 연출 다시 보기" hint="테스트용. 다시 도착하면 환영 봉투가 또 지급됩니다." checked={resetArrival} onChange={setResetArrival} />
      <button type="button" className="btn btn-gold mt-4 w-full" disabled={busy || !memo.trim() || (!delta && !debtDelta && !closeWager && !resetArrival)}
        onClick={() => void run(async () => { await adjustWallet(session, row.id, { delta, debtDelta, memo, closeWager, resetArrival }); toast("success", "기록했습니다."); onClose(); })}>기록하고 적용</button>
    </Modal>
  );
}

