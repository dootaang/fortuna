import { useEffect, useRef, useState } from "react";
import { COINS, formatPrice, type CoinId, type HourDoc } from "@fortuna/core";
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
