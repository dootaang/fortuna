import { RANK_LABEL, SUIT_SYMBOL, card, isRedSuit } from "@fortuna/core";
import { cx } from "./kit.tsx";

export function PlayingCard({ id, className, label }: { id: string | null; className?: string; label?: string }) {
  if (id === null) return <div className={cx("playing-card back", className)} aria-label={label ?? "뒤집힌 카드"} role="img" />;
  if (id === "joker") return <div className={cx("playing-card joker", className)} role="img" aria-label="조커"><span className="suit">🃏</span></div>;
  const face = card(id), rank = RANK_LABEL[face.rank], suit = SUIT_SYMBOL[face.suit];
  return (
    <div className={cx("playing-card", isRedSuit(id) && "red", className)} role="img" aria-label={`${suitName(face.suit)} ${rank}`}>
      <span className="rank">{rank}</span>
      <span className="suit">{suit}</span>
    </div>
  );
}

function suitName(suit: string): string { return ({ clubs: "클럽", diamonds: "다이아몬드", hearts: "하트", spades: "스페이드" } as Record<string, string>)[suit] ?? suit; }

/** Pip positions on a 3×3 grid, 1-based cells. */
const PIPS: Record<number, number[]> = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

export function Die({ value, held, red, onClick, className }: { value: number; held?: boolean; red?: boolean; onClick?: (() => void) | undefined; className?: string }) {
  const cells = Array.from({ length: 9 }, (_, index) => (PIPS[value] ?? []).includes(index + 1));
  const body = (
    <span className={cx("die", held && "held", red && "red", className)} role="img" aria-label={`주사위 ${value}${held ? " (고정)" : ""}`}>
      {cells.map((on, index) => <i key={index} style={{ visibility: on ? "visible" : "hidden" }} />)}
    </span>
  );
  return onClick ? <button type="button" className="rounded-[10px]" onClick={onClick} aria-pressed={held}>{body}</button> : body;
}
