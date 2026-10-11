import { useEffect, useRef, useState } from "react";
import { cx } from "../ui/kit.tsx";
import { prefersReducedMotion } from "./settings.ts";

/** Number that rolls to its new value and glows green/red for a moment. */
export function Counter({ value, className, duration = 700 }: { value: number; className?: string; duration?: number }) {
  const [shown, setShown] = useState(value);
  const [glow, setGlow] = useState<"up" | "down" | null>(null);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    if (start === value) return undefined;
    from.current = value;
    setGlow(value > start ? "up" : "down");
    if (prefersReducedMotion()) { setShown(value); return undefined; }
    const began = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / duration), eased = 1 - (1 - t) ** 3;
      setShown(Math.round(start + (value - start) * eased));
      if (t < 1) frame = requestAnimationFrame(tick); else window.setTimeout(() => setGlow(null), 400);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return (
    <span className={cx("num transition-[color,text-shadow] duration-300", glow === "up" && "text-[#a9ecc9] [text-shadow:0_0_12px_#4fc08d88]", glow === "down" && "text-[#f2b3aa]", className)}>
      {shown.toLocaleString("ko-KR")}
    </span>
  );
}
