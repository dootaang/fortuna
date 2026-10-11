import confetti from "canvas-confetti";
import { prefersReducedMotion } from "./settings.ts";

const GOLD = ["#f1d98a", "#d4af37", "#b38f22", "#fbf3d5", "#0f4634"];
let shapes: confetti.Shape[] | null = null;

function decoShapes(): confetti.Shape[] {
  shapes ??= [confetti.shapeFromText({ text: "◆", scalar: 2, color: "#d4af37" }), confetti.shapeFromText({ text: "✦", scalar: 2, color: "#f1d98a" }), "circle"];
  return shapes;
}

/** Gold confetti scaled to the size of a win (1 = small … 3 = jackpot). */
export function celebrate(size: 1 | 2 | 3): void {
  if (prefersReducedMotion()) return;
  const base = { colors: GOLD, shapes: decoShapes(), disableForReducedMotion: true, zIndex: 70, scalar: 1.1 };
  confetti({ ...base, particleCount: [0, 40, 90, 160][size], spread: 55 + size * 15, startVelocity: 28 + size * 8, origin: { x: 0.5, y: 0.75 } });
  if (size >= 2) window.setTimeout(() => confetti({ ...base, particleCount: 50, angle: 60, spread: 55, origin: { x: 0, y: 0.8 } }), 180);
  if (size >= 2) window.setTimeout(() => confetti({ ...base, particleCount: 50, angle: 120, spread: 55, origin: { x: 1, y: 0.8 } }), 260);
}

/** Shake an element with the Web Animations API (transform only). */
export function shake(element: Element | null, intensity = 4, duration = 320): void {
  if (!element || prefersReducedMotion()) return;
  const step = (sign: number, factor: number) => `translate3d(${sign * intensity * factor}px, 0, 0) rotate(${sign * intensity * factor * 0.08}deg)`;
  element.animate(
    [{ transform: "none" }, { transform: step(1, 1) }, { transform: step(-1, 0.85) }, { transform: step(1, 0.6) }, { transform: step(-1, 0.35) }, { transform: "none" }],
    { duration, easing: "ease-out" },
  );
}

/** A brief full-screen tint: gold for a perfect hit, red for a loss. */
export function flash(color: "gold" | "ruby", duration = 260): void {
  if (prefersReducedMotion()) return;
  const overlay = document.createElement("div");
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.cssText = `position:fixed;inset:0;z-index:65;pointer-events:none;background:${color === "gold" ? "radial-gradient(circle, #f1d98a55, transparent 70%)" : "radial-gradient(circle, transparent 40%, #c4473a66)"}`;
  document.body.appendChild(overlay);
  overlay.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { duration, easing: "ease-out" }).onfinish = () => overlay.remove();
}
