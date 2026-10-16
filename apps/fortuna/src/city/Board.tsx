import { useState } from "react";
import { DISTRICTS, FRONT_DISTRICTS, FRONT_MAX, FRONT_TEXT, HOTEL_RULES, LINES, LINE_IDS, type FrontDistrict } from "@fortuna/core";
import { Modal, cx } from "../ui/kit.tsx";
import { useLookups } from "./useCity.ts";

/** 역 게시판: 일곱 구역의 전선 시계와 그 칸의 소식. 무월리는 늘어난 호텔 이용 수칙으로 보인다. */
export function BoardModal({ open, onClose, extraTabs }: {
  open: boolean;
  onClose: () => void;
  /** More boards (the ledger, once revealed) as [label, content]. */
  extraTabs?: [string, React.ReactNode][];
}) {
  const tabs: [string, React.ReactNode][] = [["전선", <Fronts key="fronts" />], ...(extraTabs ?? [])];
  const [tab, setTab] = useState(0);
  return (
    <Modal open={open} onClose={onClose} title="역 게시판" wide>
      {tabs.length > 1 && (
        <div className="mb-3 flex gap-1" role="tablist">
          {tabs.map(([label], index) => (
            <button key={label} type="button" role="tab" aria-selected={tab === index} className={cx("btn btn-sm", tab === index ? "btn-gold" : "btn-dark")} onClick={() => setTab(index)}>{label}</button>
          ))}
        </div>
      )}
      {tabs[Math.min(tab, tabs.length - 1)]![1]}
    </Modal>
  );
}

const lineOf = (district: FrontDistrict) => LINES[LINE_IDS.find((id) => LINES[id].district === district)!];

function Fronts() {
  const { data } = useLookups();
  return (
    <div className="space-y-3">
      <p className="text-xs text-mist">구역마다 하우스가 조여 오는 정도입니다. 네 칸이 다 차면 파국입니다. 해방된 구역의 시계는 멈춥니다.</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {FRONT_DISTRICTS.map((district) => {
          const step = data.fronts.get(district) ?? 0, line = lineOf(district), name = DISTRICTS.find((entry) => entry.id === district)?.name ?? district;
          const now = step > 0 ? FRONT_TEXT[district][step - 1] : null, hotel = district === "horror";
          return (
            <li key={district} className="rounded-sm border border-gold-400/25 bg-ink/40 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold" style={{ color: line.light }}>{name}</p>
                {hotel ? <span className="text-xs italic text-mist">{step ? `수칙 ${7 + step}항까지` : "수칙 7항"}</span> : (
                  <span className="flex gap-1" aria-label={`전선 시계 ${step}/${FRONT_MAX}`}>
                    {Array.from({ length: FRONT_MAX }, (_, i) => (
                      <span key={i} className="h-2.5 w-4 rounded-[2px] border" style={{ borderColor: line.light, background: i < step ? (step >= FRONT_MAX ? "#e5484d" : line.light) : "transparent" }} />
                    ))}
                  </span>
                )}
              </div>
              {hotel ? (
                step > 0
                  ? <ol className="mt-1.5 space-y-1 text-xs text-ivory/85">{HOTEL_RULES.slice(0, step).map((rule) => <li key={rule}>{rule}</li>)}</ol>
                  : <p className="mt-1.5 text-xs text-mist">로비 안내문은 일곱 줄 그대로다.</p>
              ) : now ? (
                <div className="mt-1.5 space-y-1 text-xs">
                  <p className="text-ivory/90">{now.official}</p>
                  <p className="text-mist">{now.paper}</p>
                </div>
              ) : <p className="mt-1.5 text-xs text-mist">아직 조용하다.</p>}
              {step >= FRONT_MAX && <p className="mt-1 text-[0.7rem] font-bold text-[#f2b3aa]">파국</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
