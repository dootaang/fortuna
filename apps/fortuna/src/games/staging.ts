import type { GameId } from "@fortuna/core";

/**
 * Every decision plays out in three beats:
 *  rolling — the decision is being sealed on the server; show motion that does not depend on the result,
 *  landing — the sealed result is known; animate it into place,
 *  idle    — waiting for the player.
 */
export type Phase = "idle" | "rolling" | "landing";

/** Minimum time the rolling beat lasts, so a fast server still gets a moment of suspense. */
export function minRollMs(game: GameId, state: any): number {
  switch (game) {
    case "last-train": return 650 + Math.min(1_000, (state?.stations ?? 0) * 110); // more tension the further you ride
    case "high-low": return 600 + (state?.streak ?? 0) * 120;
    case "roulette": return 900;
    case "odd-even": return 900;
    default: return 600;
  }
}

/** How long the landing beat runs before the table accepts the next decision. */
export function landingMs(game: GameId, previous: any, next: any, opening: boolean): number {
  if (opening) {
    switch (game) {
      case "blackjack": return 1_350 + (next?.done ? 900 : 0);
      case "high-low": return 700;
      case "draw-poker": return 1_250;
      case "old-maid": return 900;
      case "dice-poker": return 900;
      default: return 0;
    }
  }
  switch (game) {
    case "odd-even": return 1_200;
    case "high-low": return 1_150;
    case "blackjack": {
      const added = (next?.dealer?.length ?? 0) - (previous?.dealer?.length ?? 0);
      return 700 + Math.max(0, added) * 520;
    }
    case "last-train": return next?.caught ? 1_700 : 750;
    case "roulette": return 4_200;
    case "dice-poker": return 2_000;
    case "old-maid": return 1_300;
    case "draw-poker": return 2_100;
  }
}

/** Win size for celebration: 1 small, 2 good, 3 huge (relative to the bet). */
export function winSize(bet: number, payout: number): 0 | 1 | 2 | 3 {
  const ratio = payout / Math.max(1, bet);
  if (payout <= bet) return 0;
  return ratio >= 4 ? 3 : ratio >= 2.2 ? 2 : 1;
}
