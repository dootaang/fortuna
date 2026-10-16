import { useLayoutEffect, useRef } from "react";
import { FRONT_MAX, LINES, LINE_IDS, STATIONS, stationsOf, type FrontDistrict, type LineId, type PlaceId, type Station } from "@fortuna/core";
import { cx } from "../ui/kit.tsx";

/**
 * 노선도: 휠 광장을 가운데 둔 지하철 노선도. 역을 누르면 그 역으로 간다.
 * 사람 수, 새 글 점(읽지 않은 이야기), 가 본 역(속이 찬 점), 닫힌 노선(흐리게)을 보여 준다. docs/SPEC-CITY-MAP.md 2절.
 */
export interface StopInfo { people: number; unread: boolean; visited: boolean; }

const GOLD = "#d4af37", INK = "#0b0809", IVORY = "#f3ead2";

function labelAt(station: Station): { x: number; y: number; anchor: "start" | "middle" | "end" } {
  // District stops: on the clockwise side of the line (the lines are evenly spaced, so each gap holds one line's names).
  // Wheel stops: outward from the centre, except 판돈로 whose spoke runs outward.
  let dx: number, dy: number;
  if (station.line === "wheel") {
    if (station.id === "wheel-plaza") return { x: 500, y: 545, anchor: "middle" };
    const len = Math.hypot(station.x - 500, station.y - 500) || 1;
    dx = (station.x - 500) / len; dy = (station.y - 500) / len;
    if (station.id === "wheel-pandon" || station.id === "wheel-house") { const [px, py] = [dy, -dx]; dx = px; dy = py; }
  } else {
    const a = (LINES[station.line].angle * Math.PI) / 180;
    dx = -Math.sin(a); dy = Math.cos(a);
  }
  const x = station.x + dx * 24, y = station.y + dy * 24 + 7;
  return { x, y, anchor: dx > 0.35 ? "start" : dx < -0.35 ? "end" : "middle" };
}

export function LineMap({ here, info, closed, fronts, onPick, selected }: {
  here: PlaceId | null;
  info: Map<PlaceId, StopInfo>;
  closed: Set<LineId>;
  /** Clock steps per district; drawn as four pips under the line's name (무월리: the count of hotel rules). */
  fronts?: Map<FrontDistrict, number>;
  onPick: (place: PlaceId) => void;
  selected?: PlaceId | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  // Start with the current stop in view.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const s = STATIONS[here ?? "wheel-plaza"], sx = el.scrollWidth / 1140, sy = el.scrollHeight / 1100;
    el.scrollLeft = (s.x + 70) * sx - el.clientWidth / 2;
    el.scrollTop = (s.y + 50) * sy - el.clientHeight / 2;
  }, []);

  return (
    <div ref={box} className="h-full w-full overflow-auto">
      <svg viewBox="-70 -50 1140 1100" className="line-map min-h-[790px] min-w-[820px]" role="group" aria-label="포르투나 노선도">
        <defs>
          <radialGradient id="map-glow"><stop offset="0" stopColor="#3a2c10" /><stop offset="0.6" stopColor="#0b0809" /></radialGradient>
        </defs>
        <rect x="-70" y="-50" width="1140" height="1100" fill="url(#map-glow)" />
        {Array.from({ length: 24 }, (_, i) => {
          const a = (i / 24) * Math.PI * 2;
          return <line key={i} x1="500" y1="500" x2={500 + Math.cos(a) * 700} y2={500 + Math.sin(a) * 700} stroke={GOLD} strokeOpacity={i % 2 ? 0.03 : 0.06} strokeWidth="2" />;
        })}
        {[230, 330, 430].map((r) => <circle key={r} cx="500" cy="500" r={r} fill="none" stroke={GOLD} strokeOpacity="0.07" strokeDasharray="2 10" />)}

        {/* District lines: from the wheel ring out through each stop. */}
        {LINE_IDS.filter((id) => id !== "wheel").map((id) => {
          const def = LINES[id], stops = stationsOf(id), a = (def.angle * Math.PI) / 180;
          const points = [[500 + Math.cos(a) * 86, 500 + Math.sin(a) * 86], ...stops.map((s) => [s.x, s.y])].map(([x, y]) => `${x},${y}`).join(" ");
          const end = stops.at(-1)!, tx = end.x + Math.cos(a) * 42, ty = end.y + Math.sin(a) * 42 + 6;
          return (
            <g key={id} className={cx(closed.has(id) && "closed")}>
              <polyline points={points} fill="none" stroke={INK} strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points={points} fill="none" stroke={def.light} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
              <text x={tx} y={ty} textAnchor={Math.cos(a) > 0.35 ? "start" : Math.cos(a) < -0.35 ? "end" : "middle"} fill={def.light} fontSize="17" fontWeight="700" letterSpacing="1">
                {def.name}{closed.has(id) ? " · 운휴" : ""}
              </text>
              {fronts && <FrontPips x={tx} y={ty + 14} anchor={Math.cos(a) > 0.35 ? "start" : Math.cos(a) < -0.35 ? "end" : "middle"} step={fronts.get(def.district as FrontDistrict) ?? 0} color={def.light} hotel={id === "horror"} />}
            </g>
          );
        })}

        {/* The wheel: a gold ring around the plaza. */}
        <circle cx="500" cy="500" r="86" fill="none" stroke={INK} strokeWidth="20" />
        <circle cx="500" cy="500" r="86" fill="none" stroke={GOLD} strokeWidth="10" />
        <line x1={STATIONS["wheel-pandon"].x} y1={STATIONS["wheel-pandon"].y} x2={STATIONS["wheel-house"].x} y2={STATIONS["wheel-house"].y} stroke={GOLD} strokeWidth="10" strokeLinecap="round" />
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return <line key={i} x1="500" y1="500" x2={500 + Math.cos(a) * 60} y2={500 + Math.sin(a) * 60} stroke={i % 2 ? "#c4473a" : GOLD} strokeOpacity="0.5" strokeWidth="3" />;
        })}

        {(Object.values(STATIONS) as Station[]).map((station) => {
          const stop = info.get(station.id), isHere = station.id === here, label = labelAt(station), def = LINES[station.line];
          const shut = closed.has(station.line) && !isHere;
          const big = station.id === "wheel-plaza" || station.outer;
          return (
            <g key={station.id} className={cx("stop", shut && "closed")} role="button" tabIndex={0}
              aria-label={`${station.name}${isHere ? " (현재 위치)" : ""}${stop?.people ? `, ${stop.people}명` : ""}${stop?.unread ? ", 새 이야기" : ""}${shut ? ", 운휴" : ""}`}
              onClick={() => onPick(station.id)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPick(station.id); } }}>
              <circle cx={station.x} cy={station.y} r="30" fill="transparent" />
              {isHere && <circle cx={station.x} cy={station.y} r="24" fill="none" stroke={GOLD} strokeWidth="3"><animate attributeName="r" values="18;28;18" dur="2.4s" repeatCount="indefinite" /><animate attributeName="opacity" values="1;0.2;1" dur="2.4s" repeatCount="indefinite" /></circle>}
              {selected === station.id && <circle cx={station.x} cy={station.y} r="22" fill="none" stroke={IVORY} strokeWidth="2" strokeDasharray="4 4" />}
              <circle className="ring" cx={station.x} cy={station.y} r={big ? 14 : 11} fill={INK} stroke={station.line === "wheel" ? GOLD : def.light} strokeWidth="5" />
              <circle cx={station.x} cy={station.y} r={big ? 6 : 4.5} fill={stop?.visited || isHere ? IVORY : "#3a3230"} />
              {stop?.unread && <circle className="stop-unread" cx={station.x + 12} cy={station.y - 12} r="6" fill="#e5484d" stroke={INK} strokeWidth="2" />}
              {Boolean(stop?.people) && (
                <g>
                  <rect x={station.x - 30} y={station.y - 34} width="22" height="18" rx="4" fill={GOLD} />
                  <text x={station.x - 19} y={station.y - 20.5} textAnchor="middle" fontSize="13" fontWeight="800" fill={INK}>{stop!.people}</text>
                </g>
              )}
              <text x={label.x} y={label.y} textAnchor={label.anchor} fontSize={station.id === "wheel-plaza" ? 20 : 17} fontWeight={isHere ? 800 : 600}
                fill={isHere ? GOLD : IVORY} stroke={INK} strokeWidth="4" paintOrder="stroke">{station.name}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Four pips for a district's clock (red when full); 무월리 shows how many hotel rules have grown instead. */
function FrontPips({ x, y, anchor, step, color, hotel }: { x: number; y: number; anchor: "start" | "middle" | "end"; step: number; color: string; hotel: boolean }) {
  if (hotel) {
    return step > 0 ? <text x={x} y={y + 10} textAnchor={anchor} fontSize="13" fill={color} fontStyle="italic">수칙 {7 + step}항</text> : null;
  }
  const w = FRONT_MAX * 16, left = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
  return (
    <g aria-label={`전선 시계 ${step}/${FRONT_MAX}`}>
      {Array.from({ length: FRONT_MAX }, (_, i) => (
        <rect key={i} x={left + i * 16} y={y} width="12" height="8" rx="1.5" stroke={color} strokeWidth="1.5"
          fill={i < step ? (step >= FRONT_MAX ? "#e5484d" : color) : "transparent"} fillOpacity={i < step ? 0.9 : 0} />
      ))}
    </g>
  );
}
