import { useEffect, useRef, useState } from "react";
import { COINS, fearGreedLabel, formatPrice, type CoinId, type HourDoc } from "@fortuna/core";
import type { Timestamp } from "firebase/firestore";
import { cue } from "../fx/cues.ts";
import { prefersReducedMotion } from "../fx/settings.ts";
import { cx } from "../ui/kit.tsx";

/**
 * 역 출발 안내판의 넘김판 글자. Only the characters that changed flip, left to right.
 */
export function FlapText({ text, className, sound = false }: { text: string; className?: string; sound?: boolean }) {
  const previous = useRef(text);
  const [generation, setGeneration] = useState<number[]>(() => [...text].map(() => 0));
  useEffect(() => {
    const before = previous.current;
    if (before === text) return;
    previous.current = text;
    setGeneration((current) => [...text].map((char, index) => (char !== before[before.length - text.length + index] ? (current[index] ?? 0) + 1 : current[index] ?? 0)));
    if (sound) cue("flap");
  }, [text]);
  const still = prefersReducedMotion();
  return (
    <span className={cx("flap-text num", className)} aria-label={text}>
      {[...text].map((char, index) => (
        <span key={`${index}:${generation[index] ?? 0}`} aria-hidden="true" className={cx("flap-cell", !still && (generation[index] ?? 0) > 0 && "flap-turn")} style={{ animationDelay: `${index * 35}ms` }}>
          {char}
        </span>
      ))}
    </span>
  );
}

/** Last hour of 1-minute closes as a tiny line. */
export function Sparkline({ hours, coin, className }: { hours: readonly HourDoc<Timestamp>[]; coin: CoinId; className?: string }) {
  const closes: number[] = [];
  for (const doc of hours.slice(-2)) for (const key of Object.keys(doc.c ?? {}).sort()) { const candle = doc.c[key]?.[coin]; if (candle) closes.push(candle[3]); }
  const points = closes.slice(-60);
  if (points.length < 2) return <span className={cx("inline-block h-6 w-20", className)} aria-hidden="true" />;
  const min = Math.min(...points), max = Math.max(...points), span = Math.max(1, max - min);
  const path = points.map((value, index) => `${(index / (points.length - 1)) * 80},${22 - ((value - min) / span) * 20}`).join(" ");
  const up = points.at(-1)! >= points[0]!;
  return (
    <svg viewBox="0 0 80 24" className={cx("h-6 w-20", className)} aria-hidden="true">
      <polyline points={path} fill="none" stroke={up ? "#4fc08d" : "#e06a5c"} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function changeText(now: number, from: number | null): { text: string; tone: "up" | "down" | "flat" } {
  if (!from) return { text: "—", tone: "flat" };
  const ratio = (now - from) / from;
  const text = `${ratio > 0 ? "+" : ""}${(ratio * 100).toFixed(2)}%`;
  return { text, tone: ratio > 0.00005 ? "up" : ratio < -0.00005 ? "down" : "flat" };
}

export function CoinBadge({ coin, size = "md" }: { coin: CoinId; size?: "sm" | "md" }) {
  const def = COINS[coin];
  return (
    <span
      className={cx("coin-badge", size === "sm" ? "h-7 w-7 text-[0.55rem]" : "h-10 w-10 text-[0.7rem]")}
      style={{ borderColor: def.accent, color: def.accent }}
      aria-hidden="true"
    >
      {coin}
    </span>
  );
}

export function priceText(cents: number | undefined): string { return cents === undefined ? "—" : formatPrice(cents); }

/** "+12.5%" style ratio for PnL. */
export function percent(ratio: number): string { return `${ratio > 0 ? "+" : ""}${(ratio * 100).toFixed(1)}%`; }

/** 공포·탐욕 계기판: a half dial, 0 (extreme fear) on the left, 100 (extreme greed) on the right. */
export function FearGreedGauge({ value, compact }: { value: number; compact?: boolean }) {
  const angle = Math.PI * (1 - value / 100), x = 50 + Math.cos(angle) * 34, y = 46 - Math.sin(angle) * 34;
  const colour = value < 20 ? "#c4473a" : value < 40 ? "#e06a5c" : value <= 60 ? "#e6c564" : value <= 80 ? "#8fd0a8" : "#4fc08d";
  const arc = (from: number, to: number, stroke: string) => {
    const a0 = Math.PI * (1 - from / 100), a1 = Math.PI * (1 - to / 100);
    return <path d={`M${50 + Math.cos(a0) * 40} ${46 - Math.sin(a0) * 40} A40 40 0 0 1 ${50 + Math.cos(a1) * 40} ${46 - Math.sin(a1) * 40}`} stroke={stroke} strokeWidth="7" fill="none" />;
  };
  return (
    <div className={cx("flex items-center gap-2", compact && "gap-1.5")} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={`공포·탐욕 지수 ${value}, ${fearGreedLabel(value)}`}>
      <svg viewBox="0 0 100 52" className={compact ? "h-8 w-14" : "h-14 w-24"} aria-hidden="true">
        {arc(0, 20, "#7a2a22")}{arc(20, 40, "#a8473a")}{arc(40, 60, "#8a7a3a")}{arc(60, 80, "#4f7a5a")}{arc(80, 100, "#2f7a55")}
        <line x1="50" y1="46" x2={x} y2={y} stroke={colour} strokeWidth="3" strokeLinecap="round" />
        <circle cx="50" cy="46" r="4" fill={colour} />
      </svg>
      <div className="leading-tight">
        <p className={cx("num font-bold", compact ? "text-sm" : "text-xl")} style={{ color: colour }}>{value}</p>
        <p className="text-[0.65rem] text-mist">{fearGreedLabel(value)}</p>
      </div>
    </div>
  );
}

/** Long share of the coin's open notional (crowd + players). */
export function LongShortBar({ ls, thin }: { ls: [number, number] | undefined; thin?: boolean }) {
  if (!ls || ls[0] + ls[1] <= 0) return null;
  const long = ls[0] / (ls[0] + ls[1]);
  return (
    <div className={cx("ls-bar", thin && "ls-bar-thin")} role="img" aria-label={`롱 ${Math.round(long * 100)}% · 숏 ${100 - Math.round(long * 100)}%`}>
      <span className="ls-long" style={{ width: `${long * 100}%` }} />
    </div>
  );
}

const BAND_LABELS = ["0~2%", "2~5%", "5~10%", "10~20%", "20%~"];

/**
 * 청산 지도: open positions (crowd + players) that would be force-closed if the price moved into each band.
 * Shorts above, longs below, nearest bands next to the price.
 */
export function LiquidationMap({ lm, price }: { lm: number[] | undefined; price: string }) {
  if (!lm || lm.length !== 10) return null;
  const max = Math.max(1, ...lm), down = lm.slice(0, 5), up = lm.slice(5);
  const row = (value: number, label: string, side: "up" | "down") => (
    <li key={`${side}${label}`} className="flex items-center gap-2 text-[0.7rem]">
      <span className="w-12 shrink-0 text-right text-mist">{side === "up" ? "+" : "−"}{label}</span>
      <span className="relative h-3 flex-1 rounded-sm bg-ink/50">
        <span className={cx("absolute inset-y-0 left-0 rounded-sm", side === "up" ? "bg-[#c4473a]/70" : "bg-[#4fc08d]/60")} style={{ width: `${(value / max) * 100}%` }} />
      </span>
      <span className="num w-14 shrink-0 text-right">{value ? value.toLocaleString("ko-KR") : "·"}</span>
    </li>
  );
  return (
    <div aria-label="청산 지도">
      <ul className="space-y-1">{[...up].map((value, index) => ({ value, index })).reverse().map(({ value, index }) => row(value, BAND_LABELS[index]!, "up"))}</ul>
      <p className="my-1 border-y border-gold-400/30 py-0.5 text-center text-xs text-gold-200">현재가 {price}</p>
      <ul className="space-y-1">{down.map((value, index) => row(value, BAND_LABELS[index]!, "down"))}</ul>
      <p className="mt-1.5 text-[0.65rem] leading-snug text-mist">그 가격대에 닿으면 강제 청산되는 포지션(주민 군중 + 플레이어, 100코인 단위). 위는 숏, 아래는 롱.</p>
    </div>
  );
}
