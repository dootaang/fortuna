import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { PlayingCard } from "../ui/pieces.tsx";
import { cx } from "../ui/kit.tsx";
import { ms, prefersReducedMotion } from "./settings.ts";
import { cue } from "./cues.ts";

/** Small, stable tilt per card so a hand does not look machine-placed. */
function tilt(id: string): number { let hash = 0; for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0; return ((hash % 7) - 3) * 0.8; }

/**
 * A card dealt from the deck (top right) and then turned over.
 * `squeeze` lifts a corner first for a slow, tense reveal.
 * `id === null` stays face down.
 */
export function FlipCard({ id, delay = 0, squeeze = false, dealt = true, faceDown = false, from = [90, -110], className }: {
  id: string | null; delay?: number; squeeze?: boolean; dealt?: boolean;
  /** Keep the face hidden even though the id is known (dealer's cards before reveal). */
  faceDown?: boolean;
  /** Where the card flies in from, relative to its slot. */
  from?: [number, number]; className?: string;
}) {
  const [stage, setStage] = useState<"back" | "peek" | "face">(id === null ? "back" : dealt ? "back" : "face");
  const deal = ms(380), wait = ms(delay);

  useEffect(() => {
    if (id === null || faceDown) { setStage("back"); return undefined; }
    if (!dealt) { setStage("face"); return undefined; }
    const timers: number[] = [];
    const flipAt = wait + deal + (squeeze ? ms(650) : ms(60));
    timers.push(window.setTimeout(() => cue("card"), wait));
    if (squeeze) timers.push(window.setTimeout(() => setStage("peek"), wait + deal));
    timers.push(window.setTimeout(() => { setStage("face"); cue("flip"); }, flipAt));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [id, dealt, squeeze, wait, deal, faceDown]);

  const reduced = prefersReducedMotion();
  return (
    <motion.span
      layout={!reduced}
      className={cx("flip", className)}
      initial={dealt && !reduced ? { x: from[0], y: from[1], rotate: 18, opacity: 0 } : false}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -50, scale: 0.8, transition: { duration: 0.28 } }}
      animate={{ x: 0, y: 0, rotate: id ? tilt(id) : 0, opacity: 1 }}
      transition={{ delay: wait / 1000, duration: deal / 1000, ease: [0.2, 0.8, 0.3, 1], layout: { duration: 0.3, delay: 0 } }}
    >
      <span className={cx("flip-inner", stage === "back" && "back", stage === "peek" && "peek")}>
        <span className="flip-face block">{id ? <PlayingCard id={id} /> : <PlayingCard id={null} />}</span>
        <span className="flip-face rear block" aria-hidden="true"><PlayingCard id={null} /></span>
      </span>
    </motion.span>
  );
}
