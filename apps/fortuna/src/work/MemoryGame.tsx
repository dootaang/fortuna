import { useEffect, useMemo, useState } from "react";
import { MEMORY_SHOW_MS, makeMemoryRounds, memoryPerformance, type MemorySkin } from "@fortuna/core";
import { Frame, cx } from "../ui/kit.tsx";
import { Score, type WorkGameProps } from "./shared.tsx";

export function MemoryGame({ skin, seed, onFinish }: WorkGameProps & { skin: MemorySkin }) {
  const rounds = useMemo(() => makeMemoryRounds(skin, seed), [skin, seed]);
  const [round, setRound] = useState(0);
  const [showing, setShowing] = useState(true);
  const [picked, setPicked] = useState<number[]>([]);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const current = rounds[round];

  useEffect(() => {
    if (!current) return undefined;
    setShowing(true); setPicked([]);
    const timer = window.setTimeout(() => setShowing(false), MEMORY_SHOW_MS + current.order.length * 450);
    return () => window.clearTimeout(timer);
  }, [round, current]);

  if (!current) return null;

  function pick(index: number) {
    if (showing || !current || picked.includes(index)) return;
    const next = [...picked, index];
    setPicked(next);
    if (next.length === current.order.length) {
      const hits = next.filter((value) => current.order.includes(value)).length;
      const nextCorrect = correct + hits, nextWrong = wrong + (next.length - hits);
      setCorrect(nextCorrect); setWrong(nextWrong);
      window.setTimeout(() => {
        if (round + 1 >= rounds.length) onFinish(memoryPerformance(nextCorrect, nextWrong));
        else setRound(round + 1);
      }, 700);
    }
  }

  const reveal = picked.length === current.order.length;
  return (
    <Frame>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="deco-caps">{skin.noun} {round + 1} / {rounds.length}</span>
        <Score correct={correct} wrong={wrong} />
      </div>
      {showing ? (
        <div className="rise">
          <p className="mb-3 text-center text-sm text-mist">이 {skin.noun}을(를) 기억하세요 ({current.order.length}개)</p>
          <div className="flex flex-wrap justify-center gap-2">
            {current.order.map((index) => {
              const item = skin.items[index];
              return item ? <span key={index} className="chip chip-gold px-3 py-2 text-base"><span aria-hidden="true">{item.icon}</span>{item.label}</span> : null;
            })}
          </div>
        </div>
      ) : (
        <div>
          <p className="mb-3 text-center text-sm text-mist">기억한 것을 모두 고르세요 ({picked.length}/{current.order.length})</p>
          <div className="grid grid-cols-3 gap-2">
            {current.choices.map((index) => {
              const item = skin.items[index];
              if (!item) return null;
              const chosen = picked.includes(index), right = current.order.includes(index);
              return (
                <button
                  key={index} type="button" onClick={() => pick(index)} disabled={chosen || reveal}
                  className={cx("btn btn-dark min-h-20 flex-col gap-1 text-sm", chosen && (right ? "!border-jade" : "!border-ruby"), reveal && right && !chosen && "!border-gold-300")}
                >
                  <span aria-hidden="true" className="text-2xl">{item.icon}</span>{item.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Frame>
  );
}
