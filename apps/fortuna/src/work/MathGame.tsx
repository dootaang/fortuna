import { useMemo, useRef, useState } from "react";
import { MATH_SECONDS, makeMathQuestions, mathPerformance, type MathSkin } from "@fortuna/core";
import { Frame, cx } from "../ui/kit.tsx";
import { shake } from "../fx/effects.ts";
import { cue } from "../fx/cues.ts";
import { Pops, Score, TimerBar, useCountdown, usePops, type WorkGameProps } from "./shared.tsx";

export function MathGame({ skin, seed, onFinish }: WorkGameProps & { skin: MathSkin }) {
  const questions = useMemo(() => makeMathQuestions(skin, seed), [skin, seed]);
  const [index, setIndex] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [combo, setCombo] = useState(0);
  const [marked, setMarked] = useState<{ value: number; hit: boolean } | null>(null);
  const [done, setDone] = useState(false);
  const [pops, pop] = usePops();
  const board = useRef<HTMLDivElement>(null);

  const end = (finalCorrect = correct, finalWrong = wrong) => { if (done) return; setDone(true); onFinish(mathPerformance(finalCorrect, finalWrong)); };
  const left = useCountdown(MATH_SECONDS, () => end());
  const question = questions[index];

  function answer(value: number) {
    if (!question || done || marked) return;
    const hit = value === question.answer;
    const nextCorrect = correct + (hit ? 1 : 0), nextWrong = wrong + (hit ? 0 : 1), nextCombo = hit ? combo + 1 : 0;
    setCorrect(nextCorrect); setWrong(nextWrong); setCombo(nextCombo); setMarked({ value, hit });
    if (hit) { pop(nextCombo >= 3 ? `+1 ×${nextCombo}` : "+1", nextCombo >= 5 ? "perfect" : "good"); cue(nextCombo >= 3 ? "combo" : "correct", nextCombo); }
    else { pop("✕", "miss"); cue("wrong"); shake(board.current, 5, 260); }
    window.setTimeout(() => {
      setMarked(null);
      if (index + 1 >= questions.length) end(nextCorrect, nextWrong); else setIndex((current) => current + 1);
    }, hit ? 220 : 420);
  }

  return (
    <Frame>
      <TimerBar left={left} total={MATH_SECONDS} />
      <Score correct={correct} wrong={wrong} combo={combo} />
      <div ref={board} className="relative my-5 rounded-sm border border-gold-400/30 bg-ink/40 p-5 text-center" aria-live="polite">
        <Pops pops={pops} />
        {question && <p key={index} className="slide-in-top text-lg font-bold leading-snug">{question.prompt} <span className="text-mist">= ? {skin.unit}</span></p>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {question?.choices.map((value) => {
          const isMarked = marked?.value === value, reveal = marked && !marked.hit && value === question.answer;
          return (
            <button key={`${index}-${value}`} type="button" onClick={() => answer(value)} disabled={done}
              className={cx("btn btn-dark min-h-14 text-xl num", isMarked && (marked.hit ? "!border-jade !bg-jade/20 punch" : "!border-ruby !bg-ruby/20"), reveal && "!border-jade")}>
              {value.toLocaleString("ko-KR")}
            </button>
          );
        })}
      </div>
    </Frame>
  );
}
