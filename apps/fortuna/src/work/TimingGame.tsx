import { useEffect, useMemo, useRef, useState } from "react";
import { TIMING_ATTEMPTS, makeTimingRounds, needleAt, timingAccuracy, timingPerformance, type TimingSkin } from "@fortuna/core";
import { Frame, cx } from "../ui/kit.tsx";
import { flash, shake } from "../fx/effects.ts";
import { cue } from "../fx/cues.ts";
import { Pops, usePops, type WorkGameProps } from "./shared.tsx";

/** Accuracy at or above this counts as PERFECT (hit-stop + gold flash). */
const PERFECT = 0.8;

export function TimingGame({ skin, seed, onFinish }: WorkGameProps & { skin: TimingSkin }) {
  const rounds = useMemo(() => makeTimingRounds(seed), [seed]);
  const [attempt, setAttempt] = useState(0);
  const [results, setResults] = useState<number[]>([]);
  const [position, setPosition] = useState(0);
  const [feedback, setFeedback] = useState<{ text: string; good: boolean } | null>(null);
  const [streak, setStreak] = useState(0);
  const [pops, pop] = usePops();
  const started = useRef(performance.now()), frozen = useRef(false), track = useRef<HTMLDivElement>(null), mark = useRef<HTMLDivElement>(null);
  const round = rounds[attempt];

  useEffect(() => {
    started.current = performance.now(); frozen.current = false;
    let frame = 0;
    const tick = () => {
      if (!frozen.current && round) setPosition(needleAt(round, performance.now() - started.current));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [attempt, round]);

  function strike() {
    if (!round || frozen.current) return;
    frozen.current = true;
    const at = needleAt(round, performance.now() - started.current), accuracy = timingAccuracy(round, at);
    setPosition(at);
    const next = [...results, accuracy], perfect = accuracy >= PERFECT, hit = accuracy > 0;
    setResults(next); setStreak(hit ? streak + 1 : 0);
    if (perfect) {
      pop("PERFECT", "perfect", at * 100); cue("perfect"); flash("gold", 220);
      mark.current?.animate([{ transform: "scaleY(1)" }, { transform: "scaleY(1.35)" }, { transform: "scaleY(1)" }], { duration: 240, easing: "ease-out" });
    } else if (hit) { pop("GOOD", "good", at * 100); cue("correct"); }
    else { pop("MISS", "miss", at * 100); cue("wrong"); shake(track.current, 6, 260); }
    setFeedback({ text: perfect ? `${skin.hit}! 완벽` : hit ? skin.hit : skin.miss, good: hit });
    // Perfect hits hold the frame a beat longer (hit-stop).
    window.setTimeout(() => {
      setFeedback(null);
      if (attempt + 1 >= rounds.length) onFinish(timingPerformance(next)); else setAttempt(attempt + 1);
    }, perfect ? 780 : 650);
  }

  if (!round) return null;
  return (
    <Frame>
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="deco-caps">{attempt + 1} / {TIMING_ATTEMPTS}</span>
        <span className="flex items-center gap-2">
          {streak >= 3 && <span key={streak} className="chip chip-gold punch">연속 <b className="num">×{streak}</b></span>}
          <span className="text-mist">적중 {results.filter((value) => value > 0).length}</span>
        </span>
      </div>
      <div className="relative">
        <Pops pops={pops} />
        <div ref={track} className="relative my-6 h-14 overflow-hidden rounded-sm border border-gold-400/40 bg-ink/60">
          <div ref={mark} className="absolute inset-y-0 bg-gold-400/25 ring-1 ring-gold-300" style={{ left: `${(round.center - round.zone) * 100}%`, width: `${round.zone * 200}%` }} />
          <div className="absolute inset-y-0 bg-gold-400/40" style={{ left: `${(round.center - round.zone * (1 - PERFECT)) * 100}%`, width: `${round.zone * (1 - PERFECT) * 200}%` }} />
          <div className="absolute inset-y-0 w-px bg-gold-200" style={{ left: `${round.center * 100}%` }} />
          <div className="absolute inset-y-1 w-1.5 -translate-x-1/2 rounded bg-ivory shadow-[0_0_10px_#fff8]" style={{ left: `${position * 100}%` }} />
        </div>
      </div>
      <p className={cx("h-6 text-center font-bold", feedback?.good ? "text-[#a9ecc9]" : "text-[#f2b3aa]")} aria-live="polite">{feedback?.text ?? ""}</p>
      <button type="button" className="btn btn-gold mt-3 min-h-16 w-full text-lg active:scale-95" onPointerDown={strike} onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); strike(); } }}>
        {skin.icon} {skin.action}
      </button>
    </Frame>
  );
}
