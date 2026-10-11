import { useMemo, useRef, useState } from "react";
import { SORT_SECONDS, makeSortQueue, sortPerformance, type SortSkin } from "@fortuna/core";
import { Frame, cx } from "../ui/kit.tsx";
import { shake } from "../fx/effects.ts";
import { cue } from "../fx/cues.ts";
import { prefersReducedMotion } from "../fx/settings.ts";
import { Pops, Score, TimerBar, useCountdown, usePops, type WorkGameProps } from "./shared.tsx";

export function SortGame({ skin, seed, onFinish }: WorkGameProps & { skin: SortSkin }) {
  const queue = useMemo(() => makeSortQueue(skin, seed), [skin, seed]);
  const [index, setIndex] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [combo, setCombo] = useState(0);
  const [done, setDone] = useState(false);
  const [pops, pop] = usePops();
  const stage = useRef<HTMLDivElement>(null), card = useRef<HTMLDivElement>(null), locked = useRef(false);

  const end = (finalCorrect = correct, finalWrong = wrong) => { if (done) return; setDone(true); onFinish(sortPerformance(finalCorrect, finalWrong)); };
  const left = useCountdown(SORT_SECONDS, () => end());
  const item = queue[index];

  function choose(bin: string, slot: number) {
    if (!item || done || locked.current) return;
    locked.current = true;
    const hit = item.bin === bin, count = skin.bins.length;
    const nextCorrect = correct + (hit ? 1 : 0), nextWrong = wrong + (hit ? 0 : 1), nextCombo = hit ? combo + 1 : 0;
    setCorrect(nextCorrect); setWrong(nextWrong); setCombo(nextCombo);
    // The parcel flies toward the bin that was tapped.
    const offset = (slot - (count - 1) / 2) * (count === 2 ? 120 : 105);
    if (!prefersReducedMotion()) card.current?.animate([{ transform: "none", opacity: 1 }, { transform: `translate(${offset}px, 150px) scale(.45) rotate(${offset / 6}deg)`, opacity: 0 }], { duration: 230, easing: "cubic-bezier(.4,0,.7,.4)" });
    if (hit) { pop(nextCombo >= 3 ? `+1 ×${nextCombo}` : "+1", nextCombo >= 5 ? "perfect" : "good", 50 + offset / 4); cue(nextCombo >= 3 ? "combo" : "correct", nextCombo); }
    else { pop("✕", "miss", 50 + offset / 4); cue("wrong"); shake(stage.current, 5, 260); }
    window.setTimeout(() => { locked.current = false; if (index + 1 >= queue.length) end(nextCorrect, nextWrong); else setIndex((current) => current + 1); }, 200);
  }

  return (
    <Frame>
      <TimerBar left={left} total={SORT_SECONDS} />
      <Score correct={correct} wrong={wrong} combo={combo} />
      <div ref={stage} className="relative my-5 grid min-h-36 place-items-center rounded-sm border border-gold-400/30 bg-ink/40 p-4 text-center" aria-live="polite">
        <Pops pops={pops} />
        {item && (
          <div key={index} ref={card} className="slide-in-top">
            <div className="text-5xl" aria-hidden="true">{item.icon}</div>
            <p className="mt-2 text-lg font-bold">{item.label}</p>
          </div>
        )}
      </div>
      <div className={cx("grid gap-2", skin.bins.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
        {skin.bins.map((bin, slot) => (
          <button key={bin.id} type="button" className="btn btn-dark min-h-20 flex-col gap-1 text-base active:scale-95" onClick={() => choose(bin.id, slot)} disabled={done}>
            <span aria-hidden="true" className="text-2xl">{bin.icon}</span>{bin.label}
          </button>
        ))}
      </div>
    </Frame>
  );
}
