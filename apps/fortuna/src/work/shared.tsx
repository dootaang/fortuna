import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "../ui/kit.tsx";

/** Seconds left; calls onEnd once at zero. Starts immediately. */
export function useCountdown(seconds: number, onEnd: () => void): number {
  const [left, setLeft] = useState(seconds);
  const ended = useRef(false), endRef = useRef(onEnd);
  endRef.current = onEnd;
  useEffect(() => {
    const started = performance.now();
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, seconds - (performance.now() - started) / 1000);
      setLeft(remaining);
      if (remaining <= 0 && !ended.current) { ended.current = true; window.clearInterval(timer); endRef.current(); }
    }, 100);
    return () => window.clearInterval(timer);
  }, [seconds]);
  return left;
}

export function TimerBar({ left, total }: { left: number; total: number }) {
  const ratio = Math.max(0, Math.min(1, left / total)), urgent = left <= 5 && left > 0;
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs text-mist"><span>남은 시간</span><span className={cx("num", urgent && "font-bold text-[#f2b3aa]")}>{Math.ceil(left)}초</span></div>
      <div className={cx("mt-1 h-2 overflow-hidden rounded-full border bg-ink", urgent ? "border-ruby/70 timer-urgent" : "border-gold-400/40")} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.ceil(left)}>
        <div className={cx("h-full transition-[width] duration-100", urgent ? "bg-ruby" : "bg-gradient-to-r from-gold-500 to-gold-200")} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

/** Correct / wrong tally plus the current combo, which bumps each time it grows. */
export function Score({ correct, wrong, combo = 0 }: { correct: number; wrong: number; combo?: number }) {
  return (
    <div className="flex items-center justify-center gap-2 text-sm">
      <span className="chip chip-jade">맞음 <b className="num">{correct}</b></span>
      <span className="chip chip-ruby">틀림 <b className="num">{wrong}</b></span>
      {combo >= 3 && <span key={combo} className="chip chip-gold punch">콤보 <b className="num">×{combo}</b></span>}
    </div>
  );
}

export type PopTone = "perfect" | "good" | "miss";
interface Pop { id: number; text: string; tone: PopTone; x: number; }

/** Floating judgement words ("PERFECT", "+1", "✕") that rise and fade inside a relative container. */
export function usePops(): [Pop[], (text: string, tone: PopTone, x?: number) => void] {
  const [pops, setPops] = useState<Pop[]>([]);
  const push = useCallback((text: string, tone: PopTone, x = 50) => {
    const id = performance.now() + Math.random();
    setPops((list) => [...list.slice(-3), { id, text, tone, x }]);
    window.setTimeout(() => setPops((list) => list.filter((pop) => pop.id !== id)), 760);
  }, []);
  return [pops, push];
}

export function Pops({ pops }: { pops: Pop[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-visible" aria-hidden="true">
      {pops.map((pop) => (
        <span key={pop.id} className={cx("float-up absolute top-1/3 font-deco text-2xl font-bold tracking-widest drop-shadow-[0_2px_6px_#000]",
          pop.tone === "perfect" ? "text-gold-200" : pop.tone === "good" ? "text-[#a9ecc9]" : "text-[#f2b3aa]")} style={{ left: `${pop.x}%` }}>{pop.text}</span>
      ))}
    </div>
  );
}

export interface WorkGameProps { seed: string; onFinish: (performance: number) => void; }
