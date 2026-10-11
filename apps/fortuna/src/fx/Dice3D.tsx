import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cx } from "../ui/kit.tsx";
import { ms } from "./settings.ts";

/** Cube rotation that puts each face toward the viewer (faces: front 1, back 6, right 2, left 5, top 3, bottom 4). */
const FACE: Record<number, [number, number]> = { 1: [0, 0], 6: [0, 180], 2: [0, -90], 5: [0, 90], 3: [-90, 0], 4: [90, 0] };
const PIPS: Record<number, number[]> = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

function Face({ value }: { value: number }) {
  return (
    <div className={`die3d-face f${value}`}>
      {Array.from({ length: 9 }, (_, cell) => <i key={cell} style={{ visibility: (PIPS[value] ?? []).includes(cell + 1) ? "visible" : "hidden" }} />)}
    </div>
  );
}

/**
 * A die that tumbles while `rolling` and lands on `value` with a couple of extra
 * turns, so even a repeated value visibly rolls.
 */
export function Dice3D({ value, rolling: rollingProp = false, red, held, onClick, size, label, entrance = 0 }: {
  value: number; rolling?: boolean; red?: boolean; held?: boolean; onClick?: (() => void) | undefined; size?: string; label?: string;
  /** Tumble for this many ms after mounting before landing (dice that appear already decided). */
  entrance?: number;
}) {
  const [entering, setEntering] = useState(entrance > 0);
  useEffect(() => {
    if (entrance <= 0) return undefined;
    const timer = window.setTimeout(() => setEntering(false), ms(entrance));
    return () => window.clearTimeout(timer);
  }, []);
  const rolling = rollingProp || entering;
  // Derived during render so the landing transform is applied in the same frame the tumble stops.
  const memory = useRef({ value, rolling, turns: 0, landing: 0 });
  const seen = memory.current;
  if (seen.value !== value || (seen.rolling && !rolling)) memory.current = { value, rolling, turns: seen.turns + 2, landing: seen.landing + 1 };
  else if (seen.rolling !== rolling) memory.current = { ...seen, rolling };
  const { turns, landing } = memory.current;
  const hop = useRef<HTMLSpanElement>(null);

  // A little bounce as it lands (replayed per landing without remounting the cube mid-transition).
  useEffect(() => {
    if (landing === 0 || rolling) return;
    hop.current?.animate(
      [{ transform: "translateY(-26px)" }, { transform: "translateY(0)", offset: 0.55 }, { transform: "translateY(-7px)", offset: 0.72 }, { transform: "translateY(0)" }],
      { duration: ms(700), easing: "cubic-bezier(.3,.7,.4,1)" },
    );
  }, [landing, rolling]);

  const [x, y] = FACE[value] ?? [0, 0];
  const spin = turns * 360;
  const style = { "--land": `${ms(700)}ms`, ...(size ? { "--die": size } : {}) } as CSSProperties;
  const body = (
    <span className={cx("die3d", red && "red", held && "held")} style={style} role="img" aria-label={label ?? `주사위 ${value}${held ? " (고정)" : ""}`}>
      <span ref={hop} className="block h-full w-full">
        <span className={cx("die3d-cube", rolling && "tumbling")} style={{ transform: `rotateX(${x + spin}deg) rotateY(${y + spin}deg)` }}>
          {[1, 2, 3, 4, 5, 6].map((face) => <Face key={face} value={face} />)}
        </span>
      </span>
    </span>
  );
  return onClick ? <button type="button" onClick={onClick} aria-pressed={held} className="rounded-xl transition-transform active:scale-95">{body}</button> : body;
}
