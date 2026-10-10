import { useState } from "react";
import { DISTRICTS, type DistrictContent } from "@fortuna/core";
import { bootstrapCity, setDistrict, type DistrictDoc } from "@fortuna/data";
import { Frame, Notice, NumberField, TextField, Toggle, useAction } from "../ui/kit.tsx";
import { SectionTitle, useDealer } from "./DealerApp.tsx";

export function Districts() {
  const { districts, players, session } = useDealer();
  const { busy, run } = useAction();
  const missing = DISTRICTS.filter((district) => !districts.has(district.id));
  return (
    <div>
      <SectionTitle title="도시구역">
        <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => void run(async () => { const created = await bootstrapCity(session); return created; }, "구역을 동기화했습니다.")}>구역 동기화</button>
      </SectionTitle>
      <p className="mb-4 text-sm text-mist">구역 이름과 일 게임 겉모습은 <code>packages/core/src/content/districts.ts</code>에서 고칩니다. 새 구역을 추가했다면 배포 후 "구역 동기화"를 누르십시오.</p>
      {missing.length > 0 && <div className="mb-4"><Notice>상태값이 없는 구역: {missing.map((district) => district.name).join(", ")} — 구역 동기화를 누르십시오.</Notice></div>}
      <div className="grid gap-3 md:grid-cols-2">
        {DISTRICTS.map((content) => {
          const state = districts.get(content.id);
          const residents = players.filter((row) => row.data.districtId === content.id).map((row) => row.data.name);
          return state ? <DistrictCard key={content.id} content={content} state={state} residents={residents} /> : null;
        })}
      </div>
    </div>
  );
}

function DistrictCard({ content, state, residents }: { content: DistrictContent; state: DistrictDoc; residents: string[] }) {
  const { session } = useDealer();
  const { busy, run } = useAction();
  const [liberated, setLiberated] = useState(state.liberated);
  const [percent, setPercent] = useState(state.deductionBps / 100);
  const [memo, setMemo] = useState("");
  const dirty = liberated !== state.liberated || Math.round(percent * 100) !== state.deductionBps;
  return (
    <Frame>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="deco-title text-lg">{content.emblem} {content.name}</h3>
          <p className="text-xs text-mist">{content.hasOfficer ? content.officerTitle : "간부 없음 · 해방 조건은 딜러가 정함"}</p>
        </div>
        <span className={state.liberated ? "chip chip-jade" : "chip chip-ruby"}>{state.liberated ? "해방" : `공제 ${state.deductionBps / 100}%`}</span>
      </div>
      <p className="mt-2 text-xs text-mist">주민: {residents.join(", ") || "없음"}</p>
      <div className="mt-3 space-y-2">
        <Toggle label="해방됨" hint="해방되면 이 구역 주민의 임금 공제가 0이 됩니다." checked={liberated} onChange={setLiberated} />
        <NumberField label="공제율" value={percent} onChange={setPercent} min={0} max={100} step={1} suffix="%" />
        <TextField label="메모 (기록용)" value={memo} onChange={setMemo} placeholder="예: 간부 격파" />
      </div>
      <button type="button" className="btn btn-gold mt-3 w-full" disabled={busy || !dirty || !Number.isFinite(percent)}
        onClick={() => void run(() => setDistrict(session, content.id, { liberated, deductionBps: Math.round(percent * 100) }, memo || (liberated && !state.liberated ? "구역 해방" : "공제율 변경")), liberated && !state.liberated ? `${content.name} 구역이 해방되었습니다!` : "저장했습니다.")}>저장</button>
    </Frame>
  );
}
