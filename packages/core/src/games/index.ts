import { blackjack } from "./blackjack.ts";
import { dicePoker } from "./dice-poker.ts";
import { drawPoker } from "./draw-poker.ts";
import { highLow } from "./high-low.ts";
import { lastTrain } from "./last-train.ts";
import { oddEven } from "./odd-even.ts";
import { oldMaid } from "./old-maid.ts";
import { roulette } from "./roulette.ts";
import type { AnyGame, GameId } from "./types.ts";

export * from "./types.ts";
export * from "./odd-even.ts";
export * from "./high-low.ts";
export * from "./blackjack.ts";
export * from "./last-train.ts";
export * from "./roulette.ts";
export * from "./dice-poker.ts";
export * from "./old-maid.ts";
export * from "./draw-poker.ts";

export const GAMES: Readonly<Record<GameId, AnyGame>> = {
  "odd-even": oddEven,
  "high-low": highLow,
  blackjack,
  "last-train": lastTrain,
  roulette,
  "dice-poker": dicePoker,
  "old-maid": oldMaid,
  "draw-poker": drawPoker,
};
