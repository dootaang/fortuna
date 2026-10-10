import { useEffect, useRef, useState } from "react";

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
  const ratio = Math.max(0, Math.min(1, left / total));
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs text-mist"><span>남은 시간</span><span className="num">{Math.ceil(left)}초</span></div>
      <div className="mt-1 h-2 overflow-hidden rounded-full border border-gold-400/40 bg-ink" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.ceil(left)}>
        <div className="h-full bg-gradient-to-r from-gold-500 to-gold-200 transition-[width] duration-100" style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

export function Score({ correct, wrong }: { correct: number; wrong: number }) {
  return (
    <div className="flex justify-center gap-3 text-sm">
      <span className="chip chip-jade">맞음 <b className="num">{correct}</b></span>
      <span className="chip chip-ruby">틀림 <b className="num">{wrong}</b></span>
    </div>
  );
}

export interface WorkGameProps { seed: string; onFinish: (performance: number) => void; }
