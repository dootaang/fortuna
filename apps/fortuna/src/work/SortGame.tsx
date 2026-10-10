import { useMemo, useState } from "react";
import { SORT_SECONDS, makeSortQueue, sortPerformance, type SortSkin } from "@fortuna/core";
import { Frame, cx } from "../ui/kit.tsx";
import { Score, TimerBar, useCountdown, type WorkGameProps } from "./shared.tsx";

export function SortGame({ skin, seed, onFinish }: WorkGameProps & { skin: SortSkin }) {
  const queue = useMemo(() => makeSortQueue(skin, seed), [skin, seed]);
  const [index, setIndex] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [flash, setFlash] = useState<"hit" | "miss" | null>(null);
  const [done, setDone] = useState(false);

  const end = (finalCorrect = correct, finalWrong = wrong) => { if (done) return; setDone(true); onFinish(sortPerformance(finalCorrect, finalWrong)); };
  const left = useCountdown(SORT_SECONDS, () => end());
  const item = queue[index];

  function choose(bin: string) {
    if (!item || done) return;
    const hit = item.bin === bin;
    const nextCorrect = correct + (hit ? 1 : 0), nextWrong = wrong + (hit ? 0 : 1);
    setCorrect(nextCorrect); setWrong(nextWrong); setFlash(hit ? "hit" : "miss");
    window.setTimeout(() => setFlash(null), 180);
    if (index + 1 >= queue.length) end(nextCorrect, nextWrong); else setIndex(index + 1);
  }

  return (
    <Frame>
      <TimerBar left={left} total={SORT_SECONDS} />
      <Score correct={correct} wrong={wrong} />
      <div className={cx("my-5 grid min-h-36 place-items-center rounded-sm border bg-ink/40 p-4 text-center transition", flash === "hit" ? "border-jade" : flash === "miss" ? "border-ruby" : "border-gold-400/30")} aria-live="polite">
        {item && (
          <div key={index} className="rise">
            <div className="text-5xl" aria-hidden="true">{item.icon}</div>
            <p className="mt-2 text-lg font-bold">{item.label}</p>
          </div>
        )}
      </div>
      <div className={cx("grid gap-2", skin.bins.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
        {skin.bins.map((bin) => (
          <button key={bin.id} type="button" className="btn btn-dark min-h-20 flex-col gap-1 text-base" onClick={() => choose(bin.id)} disabled={done}>
            <span aria-hidden="true" className="text-2xl">{bin.icon}</span>{bin.label}
          </button>
        ))}
      </div>
    </Frame>
  );
}
