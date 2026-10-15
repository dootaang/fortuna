import { LINES, type LineId } from "@fortuna/core";

/**
 * 장면 기본 그림: 구역 색 그라데이션 + 금선 햇살 무늬 + 그 구역의 실루엣 하나 (아르데코 포스터풍).
 * 딜러 이미지가 없을 때 쓴다. 같은 구역의 역들은 같은 실루엣을 쓴다. docs/SPEC-CITY-MAP.md 3-2절.
 */
const GOLD = "#d4af37";

function Rays({ light }: { light: string }) {
  const rays = Array.from({ length: 19 }, (_, i) => (i / 18) * Math.PI);
  return (
    <g opacity="0.16">
      {rays.map((a, i) => <line key={i} x1="600" y1="640" x2={600 + Math.cos(Math.PI + a) * 900} y2={640 + Math.sin(Math.PI + a) * 900} stroke={i % 2 ? light : GOLD} strokeWidth={i % 2 ? 2 : 5} />)}
      {[160, 240, 320].map((r) => <circle key={r} cx="600" cy="640" r={r} fill="none" stroke={GOLD} strokeWidth="2" />)}
    </g>
  );
}

const silhouettes: Record<LineId, (light: string) => React.ReactNode> = {
  wheel: (light) => (
    <g>
      <rect x="520" y="150" width="160" height="450" fill="#0b0809" />
      <path d="M540 150 L600 90 L660 150 Z" fill="#0b0809" />
      <circle cx="600" cy="230" r="46" fill="none" stroke={GOLD} strokeWidth="6" />
      <line x1="600" y1="230" x2="600" y2="198" stroke={GOLD} strokeWidth="5" /><line x1="600" y1="230" x2="624" y2="242" stroke={GOLD} strokeWidth="4" />
      <rect x="380" y="330" width="140" height="270" fill="#0b0809" /><rect x="680" y="330" width="140" height="270" fill="#0b0809" />
      {[400, 450, 700, 750].map((x) => <rect key={x} x={x} y="370" width="30" height="80" rx="15" fill={light} opacity="0.35" />)}
      <g transform="translate(600 520)">
        <circle r="70" fill="none" stroke={GOLD} strokeWidth="8" />
        {Array.from({ length: 12 }, (_, i) => <line key={i} x1="0" y1="0" x2={Math.cos((i / 12) * Math.PI * 2) * 66} y2={Math.sin((i / 12) * Math.PI * 2) * 66} stroke={i % 2 ? "#c4473a" : GOLD} strokeWidth="5" />)}
        <circle r="14" fill={GOLD} />
      </g>
    </g>
  ),
  modern: (light) => (
    <g>
      {[[80, 360, 90], [190, 300, 70], [930, 330, 100], [1050, 280, 80], [300, 410, 80], [820, 400, 90]].map(([x, h, w]) => <rect key={x} x={x} y={600 - h!} width={w} height={h} fill="#0b0809" />)}
      <path d="M555 600 L570 40 L600 0 L630 40 L645 600 Z" fill="#050405" />
      <path d="M600 0 L600 600" stroke={light} strokeWidth="2" opacity="0.5" />
      <rect x="380" y="430" width="150" height="70" fill="#0b0809" stroke={light} strokeWidth="3" />
      {[0, 1, 2].map((i) => <rect key={i} x={392} y={444 + i * 18} width={60 + i * 25} height="8" fill={light} opacity="0.7" />)}
      {Array.from({ length: 30 }, (_, i) => <rect key={i} x={95 + (i % 6) * 14 + Math.floor(i / 6) * 180} y={300 + (i % 5) * 40} width="6" height="10" fill={light} opacity="0.5" />)}
    </g>
  ),
  medieval: (light) => (
    <g>
      <path d="M0 600 Q300 380 600 330 Q900 380 1200 600 Z" fill="#0b0809" />
      <g fill="#050405">
        <rect x="470" y="200" width="260" height="150" />
        {[440, 540, 640, 730].map((x) => <rect key={x} x={x} y="150" width="50" height="200" />)}
        {[440, 540, 640, 730].map((x) => <path key={x} d={`M${x - 8} 150 L${x + 25} 70 L${x + 58} 150 Z`} />)}
        <rect x="575" y="80" width="50" height="150" /><path d="M565 80 L600 0 L635 80 Z" />
      </g>
      <rect x="592" y="120" width="16" height="22" fill={light} opacity="0.8" />
      {[460, 760].map((x) => <rect key={x} x={x} y="220" width="12" height="18" fill={light} opacity="0.5" />)}
    </g>
  ),
  wuxia: (light) => (
    <g>
      <path d="M0 600 L0 420 Q300 300 520 360 Q620 200 760 300 Q980 260 1200 400 L1200 600 Z" fill="#0b0809" opacity="0.8" />
      <g fill="#050405">
        <rect x="560" y="140" width="80" height="120" />
        <path d="M500 150 Q600 110 700 150 L720 140 Q600 90 480 140 Z" /><path d="M520 100 Q600 70 680 100 L695 92 Q600 50 505 92 Z" />
        {[[150, 470], [860, 450]].map(([x, y]) => (
          <g key={x}><rect x={x! + 30} y={y} width="180" height="130" /><path d={`M${x} ${y! + 10} Q${x! + 120} ${y! - 40} ${x! + 240} ${y! + 10} L${x! + 255} ${y} Q${x! + 120} ${y! - 70} ${x! - 15} ${y} Z`} /></g>
        ))}
      </g>
      <ellipse cx="600" cy="270" rx="260" ry="26" fill={light} opacity="0.12" />
      {[260, 340, 930, 1010].map((x) => <g key={x}><line x1={x} y1="440" x2={x} y2="470" stroke="#050405" strokeWidth="3" /><ellipse cx={x} cy="485" rx="14" ry="18" fill="#c4473a" /><ellipse cx={x} cy="485" rx="8" ry="12" fill={light} opacity="0.6" /></g>)}
    </g>
  ),
  cyberpunk: (light) => (
    <g>
      {[[40, 420], [150, 520], [290, 380], [760, 540], [880, 460], [1020, 560], [1110, 400]].map(([x, h]) => <rect key={x} x={x} y={600 - h!} width="100" height={h} fill="#0b0809" />)}
      <rect x="450" y="20" width="300" height="580" fill="#050405" />
      <circle cx="600" cy="120" r="56" fill="none" stroke={light} strokeWidth="8" /><path d="M570 120 L600 90 L630 120 L600 150 Z" fill={light} />
      {Array.from({ length: 44 }, (_, i) => <line key={i} x1={(i * 97) % 1200} y1={(i * 53) % 600} x2={(i * 97) % 1200 - 12} y2={(i * 53) % 600 + 40} stroke={light} strokeWidth="2" opacity="0.25" />)}
      {[170, 790, 900].map((x, i) => <rect key={x} x={x} y={200 + i * 40} width="60" height="22" fill={i === 1 ? "#5effc0" : light} opacity="0.7" />)}
    </g>
  ),
  scifi: (light) => (
    <g>
      <rect x="0" y="0" width="1200" height="600" fill="#050405" opacity="0.4" />
      <circle cx="600" cy="300" r="250" fill="#030203" stroke={GOLD} strokeWidth="10" />
      <circle cx="600" cy="300" r="225" fill="none" stroke={light} strokeWidth="2" opacity="0.6" />
      <ellipse cx="600" cy="300" rx="180" ry="56" fill="none" stroke={light} strokeWidth="5" transform="rotate(-18 600 300)" />
      <circle cx="600" cy="300" r="44" fill={light} opacity="0.5" />
      {Array.from({ length: 16 }, (_, i) => <circle key={i} cx={420 + ((i * 71) % 360)} cy={120 + ((i * 113) % 360)} r={1.5 + (i % 3)} fill="#ffffff" opacity="0.7" />)}
      {[0, 1].map((side) => <rect key={side} x={side ? 1000 : 0} y="0" width="200" height="600" fill="#0b0809" />)}
      {[80, 200, 320, 440].map((y) => <g key={y}><line x1="0" y1={y} x2="200" y2={y} stroke={light} opacity="0.3" /><line x1="1000" y1={y} x2="1200" y2={y} stroke={light} opacity="0.3" /></g>)}
    </g>
  ),
  romance: (light) => (
    <g>
      <g fill="none" stroke={GOLD} strokeWidth="5">
        <line x1="600" y1="0" x2="600" y2="90" />
        <path d="M420 200 Q600 300 780 200" /><path d="M460 150 Q600 230 740 150" /><path d="M500 110 Q600 160 700 110" />
      </g>
      {Array.from({ length: 13 }, (_, i) => <line key={i} x1={430 + i * 28} y1={205 + Math.sin((i / 12) * Math.PI) * 50} x2={430 + i * 28} y2={250 + Math.sin((i / 12) * Math.PI) * 50} stroke={light} strokeWidth="3" />)}
      <circle cx="600" cy="95" r="20" fill={GOLD} />
      <path d="M0 600 Q150 420 300 520 Q420 380 520 600 Z" fill="#0b0809" /><path d="M1200 600 Q1050 420 900 520 Q780 380 680 600 Z" fill="#0b0809" />
      {[[140, 470], [260, 520], [380, 460], [1060, 470], [940, 520], [820, 460]].map(([x, y]) => (
        <g key={x}><circle cx={x} cy={y} r="18" fill="#a0283a" /><circle cx={x} cy={y} r="9" fill={light} opacity="0.7" /></g>
      ))}
    </g>
  ),
  horror: (light) => (
    <g>
      <rect x="380" y="90" width="440" height="510" fill="#050405" />
      <path d="M360 90 L600 20 L840 90 Z" fill="#050405" />
      {Array.from({ length: 40 }, (_, i) => <rect key={i} x={410 + (i % 8) * 52} y={130 + Math.floor(i / 8) * 80} width="22" height="34" fill={i === 13 ? light : "#1a1f18"} opacity={i === 13 ? 0.8 : 1} />)}
      <rect x="560" y="500" width="80" height="100" fill="#1a1f18" />
      {[0, 1, 2].map((i) => <ellipse key={i} cx={300 + i * 320} cy={480 + i * 30} rx="420" ry="50" fill={light} opacity={0.08 + i * 0.03} />)}
      <g><line x1="240" y1="380" x2="240" y2="600" stroke="#050405" strokeWidth="6" /><ellipse cx="240" cy="380" rx="16" ry="22" fill="#2a2f28" /></g>
    </g>
  ),
};

export function DefaultArt({ line }: { line: LineId }) {
  const def = LINES[line];
  return (
    <svg viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden="true">
      <defs>
        <linearGradient id={`sky-${line}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#050405" /><stop offset="0.55" stopColor={def.dark} /><stop offset="1" stopColor={def.dark} />
        </linearGradient>
        <radialGradient id={`glow-${line}`} cx="0.5" cy="0.92" r="0.75">
          <stop offset="0" stopColor={def.light} stopOpacity="0.42" /><stop offset="0.5" stopColor={def.light} stopOpacity="0.12" /><stop offset="1" stopColor={def.light} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1200" height="600" fill={`url(#sky-${line})`} />
      <rect width="1200" height="600" fill={`url(#glow-${line})`} />
      <Rays light={def.light} />
      {silhouettes[line](def.light)}
      <rect width="1200" height="600" fill="none" stroke={GOLD} strokeWidth="6" opacity="0.4" />
    </svg>
  );
}
