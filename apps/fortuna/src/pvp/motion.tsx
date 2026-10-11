/**
 * Card motion for PvP 도둑잡기, ported from lucky-arcade
 * cabinets/old-maid/src/react/old-maid-screen.tsx (GPL-3.0-or-later):
 * useHandFlip, flightTransform, DrawReveal → DrawFlight, DiscardPile, DealingAnimation, pileOffset.
 * Changes: seats are player ids with a relative direction, cards are vector playing cards,
 * and nothing dispatches game actions — motion only follows Firestore state.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { XorShift32 } from "@fortuna/core";
import { PlayingCard } from "../ui/pieces.tsx";
import { prefersReducedMotion } from "../fx/settings.ts";
import { cue } from "../fx/cues.ts";

export type Direction = "me" | "left" | "top" | "right";
export type Rect = { left: number; top: number; width: number; height: number };

const seatElement = (pid: string) => document.querySelector<HTMLElement>(`[data-seat="${pid}"]`);

/** FLIP: cards keep visual continuity when the order changes. */
export function useHandFlip(containerRef: RefObject<HTMLElement | null>, orderKey: string, duration = 600): void {
  const previousRects = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const nextRects = new Map<string, DOMRect>();
    for (const element of container.querySelectorAll<HTMLElement>("[data-card-id]")) {
      const cardId = element.dataset.cardId;
      if (!cardId) continue;
      const next = element.getBoundingClientRect();
      nextRects.set(cardId, next);
      const previous = previousRects.current.get(cardId);
      if (!previous || duration <= 0 || prefersReducedMotion()) continue;
      const dx = previous.left - next.left, dy = previous.top - next.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      try {
        element.animate([{ transform: `translate(${dx}px, ${dy}px)`, zIndex: 4 }, { transform: "translate(0, 0)", zIndex: 1 }], { duration, easing: "cubic-bezier(.2,.75,.2,1)" });
      } catch { /* presentational only */ }
    }
    previousRects.current = nextRects;
  }, [containerRef, orderKey, duration]);
}

export function flightTransform(source: Rect, resting: Rect, forcedScale?: number): string {
  const dx = source.left + source.width / 2 - (resting.left + resting.width / 2);
  const dy = source.top + source.height / 2 - (resting.top + resting.height / 2);
  const scale = forcedScale ?? Math.min(source.width / Math.max(1, resting.width), source.height / Math.max(1, resting.height));
  return `translate(${dx}px,${dy}px) scale(${scale})`;
}

export function pileOffset(seed: string, index: number): { x: number; y: number; rotation: number } {
  const rng = new XorShift32(`${seed}:pile:${index}`);
  return { x: (rng.nextUint32() % 57) - 28, y: (rng.nextUint32() % 57) - 28, rotation: (rng.nextUint32() % 21) - 10 };
}

export interface Flight {
  key: string;
  card: string;
  actor: string;
  target: string;
  /** Where the card left from; falls back to the target's seat. */
  origin: Rect | null;
  /** Actor and target see the card turned over in the middle; everyone else sees it travel face down. */
  centerReveal: boolean;
  /** The target already knows the card, so it starts face up. */
  startFaceUp: boolean;
}

/** One drawn card's journey (lucky-arcade DrawReveal). Calls onDone when it has landed. */
export function DrawFlight({ flight, centerRef, onDone }: { flight: Flight; centerRef: RefObject<HTMLElement | null>; onDone: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  const [phase, setPhase] = useState<"back" | "flipping" | "face" | "collecting">(flight.startFaceUp ? "face" : "back");

  useLayoutEffect(() => {
    const element = cardRef.current;
    const reduced = prefersReducedMotion();
    const source = flight.origin ?? seatElement(flight.target)?.getBoundingClientRect() ?? null;
    const destination = seatElement(flight.actor)?.getBoundingClientRect() ?? null;
    const timers: number[] = [];
    if (!element || !source || !destination) { timers.push(window.setTimeout(() => done.current(), 50)); return () => timers.forEach(window.clearTimeout); }
    const resting = element.getBoundingClientRect();
    const from = flightTransform(source, resting), to = flightTransform(destination, resting, .42);
    cue("card");
    if (!flight.centerReveal) {
      element.animate([{ transform: from, opacity: 1 }, { transform: to, opacity: .45 }], { duration: reduced ? 180 : 460, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" });
      timers.push(window.setTimeout(() => done.current(), reduced ? 190 : 470));
      return () => timers.forEach(window.clearTimeout);
    }
    const center = centerRef.current?.getBoundingClientRect() ?? resting;
    const middle = flightTransform(center, resting, 1);
    element.animate([{ transform: from, opacity: .75 }, { transform: middle, opacity: 1 }], { duration: reduced ? 220 : 620, easing: "cubic-bezier(.2,.75,.2,1)", fill: "forwards" });
    if (!flight.startFaceUp) {
      timers.push(window.setTimeout(() => { setPhase(reduced ? "face" : "flipping"); cue("flip"); }, reduced ? 220 : 620));
      if (!reduced) timers.push(window.setTimeout(() => setPhase("face"), 960));
    }
    timers.push(window.setTimeout(() => {
      setPhase("collecting");
      try { element.animate([{ transform: middle, opacity: 1 }, { transform: to, opacity: .35 }], { duration: reduced ? 120 : 430, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" }); } catch { /* ignore */ }
    }, reduced ? 520 : 1_480));
    timers.push(window.setTimeout(() => done.current(), reduced ? 650 : 1_920));
    return () => timers.forEach(window.clearTimeout);
  }, [flight.key]);

  return createPortal(
    <div className="om-flight-layer" aria-hidden="true">
      <div className="om-flight-card" ref={cardRef}>
        <div className="om-flight-inner" data-phase={phase}>
          <div className="om-flight-side"><PlayingCard id={null} /></div>
          <div className="om-flight-side om-flight-front"><PlayingCard id={flight.centerReveal || flight.startFaceUp ? flight.card : null} /></div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export interface PilePair { cards: [string, string]; dir: Direction | null; owner: string | null; }

/** Thrown pairs; the newest lands from its owner's seat (lucky-arcade DiscardPile). */
export function DiscardPile({ pairs, seed }: { pairs: PilePair[]; seed: string }) {
  const refs = useRef(new Map<number, HTMLDivElement>());
  const seen = useRef(pairs.length);
  useEffect(() => {
    if (pairs.length <= seen.current) { seen.current = pairs.length; return undefined; }
    const fresh = Array.from({ length: pairs.length - seen.current }, (_, offset) => seen.current + offset);
    seen.current = pairs.length;
    const frame = window.requestAnimationFrame(() => {
      fresh.forEach((index, order) => {
        const element = refs.current.get(index), pair = pairs[index];
        const source = pair?.owner ? seatElement(pair.owner) : null;
        const slot = element?.closest<HTMLElement>(".om-pile-slot");
        if (!element || !slot) return;
        const target = element.getBoundingClientRect(), origin = source?.getBoundingClientRect() ?? target;
        const dx = origin.left + origin.width / 2 - (target.left + target.width / 2), dy = origin.top + origin.height / 2 - (target.top + target.height / 2);
        slot.dataset.arriving = "true";
        const duration = prefersReducedMotion() ? 90 : 560;
        element.animate([{ transform: `translate(${dx}px,${dy}px) scale(.55)`, opacity: .35 }, { transform: "translate(0,0) scale(1)", opacity: 1 }], { duration, delay: order * 120, easing: "cubic-bezier(.18,.8,.2,1)", fill: "backwards" });
        window.setTimeout(() => { delete slot.dataset.arriving; }, duration + order * 120);
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pairs.length]);
  return (
    <div className="om-pile" aria-label={`버린 짝 ${pairs.length}쌍`}>
      {pairs.map((pair, index) => {
        const offset = pileOffset(seed, index);
        const style = { "--jitter-x": `${offset.x}px`, "--jitter-y": `${offset.y}px`, "--jitter-r": `${offset.rotation}deg` } as CSSProperties;
        return (
          <div key={`${pair.cards[0]}-${index}`} className="om-pile-slot" data-dir={pair.dir ?? undefined} style={style}>
            <div className="om-pile-pair" ref={(node) => { if (node) refs.current.set(index, node); else refs.current.delete(index); }}>
              <PlayingCard id={pair.cards[0]} /><PlayingCard id={pair.cards[1]} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Cards fly from the deck to each seat in turn (lucky-arcade DealingAnimation). */
export function DealingAnimation({ seats, cardCount, onComplete }: { seats: string[]; cardCount: number; onComplete: () => void }) {
  const layer = useRef<HTMLDivElement>(null);
  const complete = useRef(onComplete);
  complete.current = onComplete;
  useEffect(() => {
    let timer = 0;
    const frame = window.requestAnimationFrame(() => {
      const root = layer.current;
      if (!root) { complete.current(); return; }
      const rootRect = root.getBoundingClientRect(), reduced = prefersReducedMotion();
      [...root.querySelectorAll<HTMLElement>(".om-deal-card")].forEach((element, index) => {
        const rect = seatElement(seats[index % seats.length] as string)?.getBoundingClientRect();
        const dx = rect ? rect.left + rect.width / 2 - (rootRect.left + rootRect.width / 2) : 0;
        const dy = rect ? rect.top + rect.height / 2 - (rootRect.top + rootRect.height / 2) : 0;
        element.animate([
          { transform: "translate(-50%, -50%) scale(.72) rotate(-7deg)", opacity: 0 },
          { transform: "translate(-50%, -50%) scale(1) rotate(0deg)", opacity: 1, offset: .18 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.45) rotate(${(index % 5 - 2) * 3}deg)`, opacity: 1 },
        ], { duration: reduced ? 90 : 430, delay: reduced ? index * 4 : index * 70, easing: "cubic-bezier(.2,.75,.2,1)", fill: "forwards" });
        if (!reduced && index % 3 === 0) window.setTimeout(() => cue("card"), index * 70);
      });
      timer = window.setTimeout(() => complete.current(), reduced ? 190 : 430 + Math.max(0, cardCount - 1) * 70 + 220);
    });
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, []);
  return (
    <div className="om-deal-layer" ref={layer} aria-hidden="true">
      <div className="om-deck" />
      {Array.from({ length: cardCount }, (_, index) => <div key={index} className="om-deal-card" style={{ zIndex: 100 + index }} />)}
    </div>
  );
}
