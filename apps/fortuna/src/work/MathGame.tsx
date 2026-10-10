import { useMemo, useState } from "react";
import { MATH_SECONDS, makeMathQuestions, mathPerformance, type MathSkin } from "@fortuna/core";
import { Frame, cx } from "../ui/kit.tsx";
import { Score, TimerBar, useCountdown, type WorkGameProps } from "./shared.tsx";

export function MathGame({ skin, seed, onFinish }: WorkGameProps & { skin: MathSkin }) {
  const questions = useMemo(() => makeMathQuestions(skin, seed), [skin, seed]);
  const [index, setIndex] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [flash, setFlash] = useState<"hit" | "miss" | null>(null);
  const [done, setDone] = useState(false);

  const end = (finalCorrect = correct, finalWrong = wrong) => { if (done) return; setDone(true); onFinish(mathPerformance(finalCorrect, finalWrong)); };
  const left = useCountdown(MATH_SECONDS, () => end());
  const question = questions[index];

  function answer(value: number) {
    if (!question || done) return;
    const hit = value === question.answer;
    const nextCorrect = correct + (hit ? 1 : 0), nextWrong = wrong + (hit ? 0 : 1);
    setCorrect(nextCorrect); setWrong(nextWrong); setFlash(hit ? "hit" : "miss");
    window.setTimeout(() => setFlash(null), 200);
    if (index + 1 >= questions.length) end(nextCorrect, nextWrong); else setIndex(index + 1);
  }

  return (
    <Frame>
      <TimerBar left={left} total={MATH_SECONDS} />
      <Score correct={correct} wrong={wrong} />
      <div className={cx("my-5 rounded-sm border bg-ink/40 p-5 text-center transition", flash === "hit" ? "border-jade" : flash === "miss" ? "border-ruby" : "border-gold-400/30")} aria-live="polite">
        {question && <p key={index} className="rise text-lg font-bold leading-snug">{question.prompt} <span className="text-mist">= ? {skin.unit}</span></p>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {question?.choices.map((value) => (
          <button key={`${index}-${value}`} type="button" className="btn btn-dark min-h-14 text-xl num" onClick={() => answer(value)} disabled={done}>{value.toLocaleString("ko-KR")}</button>
        ))}
      </div>
    </Frame>
  );
}
