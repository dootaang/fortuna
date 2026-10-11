import { useEffect, useMemo, useRef, useState } from "react";
import { MEMORY_SHOW_MS, makeMemoryRounds, memoryPerformance, type MemorySkin } from "@fortuna/core";
import { Frame, cx } from "../ui/kit.tsx";
import { shake } from "../fx/effects.ts";
import { cue } from "../fx/cues.ts";
import { Pops, Score, usePops, type WorkGameProps } from "./shared.tsx";

const STAGGER = 380;

export function MemoryGame({ skin, seed, onFinish }: WorkGameProps & { skin: MemorySkin }) {
  const rounds = useMemo(() => makeMemoryRounds(skin, seed), [skin, seed]);
  const [round, setRound] = useState(0);
  const [showing, setShowing] = useState(true);
  const [picked, setPicked] = useState<number[]>([]);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [pops, pop] = usePops();
  const board = useRef<HTMLDivElement>(null);
  const current = rounds[round];
  // Items appear one after another, then everything stays up for the base viewing time.
  const showFor = current ? MEMORY_SHOW_MS + current.order.length * STAGGER : 0;

  useEffect(() => {
    if (!current) return undefined;
    setShowing(true); setPicked([]);
    current.order.forEach((_, slot) => window.setTimeout(() => cue("tick", slot), slot * STAGGER));
    const timer = window.setTimeout(() => setShowing(false), showFor);
    return () => window.clearTimeout(timer);
  }, [round, current]);

  if (!current) return null;

  function pick(index: number) {
    if (showing || !current || picked.includes(index)) return;
    const next = [...picked, index], right = current.order.includes(index);
    setPicked(next);
    if (right) cue("correct"); else { cue("wrong"); shake(board.current, 4, 240); }
    if (next.length === current.order.length) {
      const hits = next.filter((value) => current.order.includes(value)).length;
      const nextCorrect = correct + hits, nextWrong = wrong + (next.length - hits);
      setCorrect(nextCorrect); setWrong(nextWrong);
      if (hits === next.length) { pop("PERFECT", "perfect"); cue("perfect"); } else pop(`${hits}/${next.length}`, hits > next.length / 2 ? "good" : "miss");
      window.setTimeout(() => {
        if (round + 1 >= rounds.length) onFinish(memoryPerformance(nextCorrect, nextWrong));
        else setRound(round + 1);
      }, 800);
    }
  }

  const reveal = picked.length === current.order.length;
  return (
    <Frame>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="deco-caps">{skin.noun} {round + 1} / {rounds.length}</span>
        <Score correct={correct} wrong={wrong} />
      </div>
      <div ref={board} className="relative">
        <Pops pops={pops} />
        {showing ? (
          <div key={round}>
            <p className="mb-3 text-center text-sm text-mist">이 {skin.noun}을(를) 기억하세요 ({current.order.length}개)</p>
            <div className="flex flex-wrap justify-center gap-2">
              {current.order.map((index, slot) => {
                const item = skin.items[index];
                return item ? <span key={index} className="chip chip-gold slide-in-top px-3 py-2 text-base" style={{ animationDelay: `${slot * STAGGER}ms` }}><span aria-hidden="true">{item.icon}</span>{item.label}</span> : null;
              })}
            </div>
            <div className="mx-auto mt-4 h-1 max-w-48 overflow-hidden rounded-full bg-ink">
              <div className="h-full origin-left bg-gold-400" style={{ animation: `shrink ${showFor}ms linear both` }} />
            </div>
          </div>
        ) : (
          <div>
            <p className="mb-3 text-center text-sm text-mist">기억한 것을 모두 고르세요 ({picked.length}/{current.order.length})</p>
            <div className="grid grid-cols-3 gap-2">
              {current.choices.map((index, slot) => {
                const item = skin.items[index];
                if (!item) return null;
                const chosen = picked.includes(index), right = current.order.includes(index);
                return (
                  <button
                    key={index} type="button" onClick={() => pick(index)} disabled={chosen || reveal} style={{ animationDelay: `${slot * 30}ms` }}
                    className={cx("btn btn-dark slide-in-top min-h-20 flex-col gap-1 text-sm", chosen && (right ? "!border-jade !bg-jade/15 punch" : "!border-ruby !bg-ruby/15"), reveal && right && !chosen && "!border-gold-300")}
                  >
                    <span aria-hidden="true" className="text-2xl">{item.icon}</span>{item.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Frame>
  );
}
