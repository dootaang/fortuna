import { XorShift32 } from "../rng.ts";

export const GAME_IDS = ["odd-even", "high-low", "blackjack", "last-train", "roulette", "dice-poker", "old-maid", "draw-poker"] as const;
export type GameId = (typeof GAME_IDS)[number];
export const VENUES = ["alley", "house"] as const;
export type Venue = (typeof VENUES)[number];

/**
 * A PVE table game. Every random draw comes from `rng`, which the caller seeds
 * per step from server timestamps (see `stepSeed`), so a decision is always
 * committed before the randomness that resolves it can be known.
 */
export interface GameDefinition<P, S> {
  readonly id: GameId;
  /** Normalise stored params (admin JSON) against the venue default. */
  params(raw: unknown, venue: Venue): P;
  readonly defaults: Readonly<Record<Venue, P>>;
  /** Upper bound of payout / bet. Saved to config so firestore.rules can cap settlements. */
  maxMultiplier(params: P): number;
  start(bet: number, params: P, rng: XorShift32): S;
  /** Whether `action` is legal now. */
  canApply(state: S, action: string): boolean;
  apply(state: S, action: string, params: P, rng: XorShift32): S;
  isDone(state: S): boolean;
  /** Gross coins returned to the player (0 = lost the bet). */
  payout(state: S): number;
}

/** Registry element type: each game has its own P/S. */
export type AnyGame = GameDefinition<any, any>;

/** Everything needed to replay one wager deterministically. */
export interface WagerTrace {
  wagerId: string;
  openedAtMs: number;
  actions: readonly string[];
  /** Server time of each action write, same length as `actions`. */
  timesMs: readonly number[];
}

/** Seed for the randomness that follows `step` actions (0 = the opening deal). */
export function stepSeed(trace: Pick<WagerTrace, "wagerId" | "openedAtMs" | "timesMs">, step: number): string {
  if (step === 0) return `${trace.wagerId}:open:${trace.openedAtMs}`;
  const time = trace.timesMs[step - 1];
  if (time === undefined) throw new Error("wager_step_time_missing");
  return `${trace.wagerId}:${step}:${time}`;
}

export function replayWager<P, S>(game: GameDefinition<P, S>, bet: number, params: P, trace: WagerTrace): S {
  if (trace.actions.length !== trace.timesMs.length) throw new Error("wager_trace_invalid");
  let state = game.start(bet, params, new XorShift32(stepSeed(trace, 0)));
  trace.actions.forEach((action, index) => {
    if (!game.canApply(state, action)) throw new Error(`wager_action_illegal:${index}:${action}`);
    state = game.apply(state, action, params, new XorShift32(stepSeed(trace, index + 1)));
  });
  return state;
}

export function floorCoins(value: number): number { return Math.floor(value + 1e-9); }

export function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
export function numberOr(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}
