import { useEffect, useMemo } from "react";
import { animate, motion, useMotionValue, type AnimationPlaybackControls } from "motion/react";
import { RED_NUMBERS } from "@fortuna/core";
import { ms, prefersReducedMotion } from "./settings.ts";
import { cue } from "./cues.ts";

const EUROPEAN = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const AMERICAN = [0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1, -1, 27, 10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2];

/** Pocket order clockwise from the top. -1 is 00; with no zeros the 0 pocket is dropped. */
export function wheelOrder(zeros: 0 | 1 | 2): number[] {
  return zeros === 2 ? AMERICAN : zeros === 1 ? EUROPEAN : EUROPEAN.filter((pocket) => pocket !== 0);
}

const label = (pocket: number) => (pocket === -1 ? "00" : String(pocket));
const color = (pocket: number) => (pocket <= 0 ? "#155a43" : RED_NUMBERS.has(pocket) ? "#a8322a" : "#111");

function sector(index: number, total: number, inner: number, outer: number): string {
  const step = (Math.PI * 2) / total, start = index * step - step / 2 - Math.PI / 2, end = start + step;
  const point = (radius: number, angle: number) => `${(radius * Math.cos(angle)).toFixed(2)} ${(radius * Math.sin(angle)).toFixed(2)}`;
  return `M ${point(inner, start)} L ${point(outer, start)} A ${outer} ${outer} 0 0 1 ${point(outer, end)} L ${point(inner, end)} A ${inner} ${inner} 0 0 0 ${point(inner, start)} Z`;
}

/**
 * Spins at a steady pace while the bet is being sealed, then decelerates onto
 * the sealed pocket while the ball circles the other way and drops in at the top.
 */
export function RouletteWheel({ zeros, pocket, phase }: { zeros: 0 | 1 | 2; pocket: number | null; phase: "idle" | "rolling" | "landing" }) {
  const order = useMemo(() => wheelOrder(zeros), [zeros]);
  const step = 360 / order.length;
  const wheel = useMotionValue(0), ball = useMotionValue(0);
  const restAngle = (target: number) => -order.indexOf(target) * step;

  // Finished boards render at rest on the result.
  useEffect(() => { if (pocket !== null && phase === "idle") { wheel.set(restAngle(pocket)); ball.set(0); } }, []);

  useEffect(() => {
    const controls: AnimationPlaybackControls[] = [];
    if (phase === "rolling") {
      cue("spin");
      controls.push(animate(wheel, wheel.get() + 360, { duration: 2.2, ease: "linear", repeat: Infinity }));
      controls.push(animate(ball, ball.get() - 360, { duration: 1.1, ease: "linear", repeat: Infinity }));
    }
    if (phase === "landing" && pocket !== null) {
      const duration = ms(3_600) / 1000;
      if (prefersReducedMotion()) { wheel.set(restAngle(pocket)); ball.set(0); return undefined; }
      const now = wheel.get(), base = now + 360 * 3;
      const target = base + ((((restAngle(pocket) - base) % 360) + 360) % 360);
      const ballNow = ball.get(), ballTarget = Math.floor((ballNow - 360 * 4) / 360) * 360;
      controls.push(animate(wheel, target, { duration, ease: [0.12, 0.62, 0.16, 1] }));
      controls.push(animate(ball, ballTarget, { duration: duration * 0.92, ease: [0.2, 0.7, 0.2, 1] }));
      const timer = window.setTimeout(() => cue("ball"), duration * 920);
      return () => { window.clearTimeout(timer); controls.forEach((control) => control.stop()); };
    }
    return () => controls.forEach((control) => control.stop());
  }, [phase, pocket]);

  return (
    <svg viewBox="-110 -110 220 220" className="mx-auto block w-64 max-w-full drop-shadow-[0_10px_20px_#000a]" role="img" aria-label={pocket === null ? "룰렛 휠" : `룰렛 결과 ${label(pocket)}`}>
      <circle r="108" fill="#3a2a0c" stroke="#d4af37" strokeWidth="3" />
      <motion.g style={{ rotate: wheel }}>
        <circle r="100" fill="#0b0c0b" />
        {order.map((value, index) => (
          <g key={`${value}-${index}`}>
            <path d={sector(index, order.length, 66, 100)} fill={color(value)} stroke="#d4af3766" strokeWidth="0.6" />
            <text x="0" y="-86" transform={`rotate(${index * step})`} textAnchor="middle" dominantBaseline="middle" fontSize="8" fontFamily="Cinzel, serif" fill="#fbf3d5">{label(value)}</text>
          </g>
        ))}
        <circle r="66" fill="#0f4634" stroke="#d4af37" strokeWidth="1.5" />
        {Array.from({ length: 8 }, (_, index) => <line key={index} x1="0" y1="0" x2="0" y2="-58" stroke="#d4af37" strokeWidth="2" transform={`rotate(${index * 45})`} />)}
        <circle r="14" fill="#d4af37" />
        <circle r="6" fill="#6f5713" />
      </motion.g>
      <motion.g style={{ rotate: ball }}>
        <circle r="100" fill="none" />
        <circle cx="0" cy="-76" r="5" fill="#fffaf0" stroke="#0004" />
      </motion.g>
      <path d="M -7 -112 L 7 -112 L 0 -98 Z" fill="#f1d98a" stroke="#6f5713" />
    </svg>
  );
}
