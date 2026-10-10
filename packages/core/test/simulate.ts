import { XorShift32 } from "../src/rng.ts";
import { basicStrategyHits, highLowOdds, stepSeed, suggestDiceHold, suggestPokerHold, type AnyGame, type GameId } from "../src/games/index.ts";

/** Picks the next action for a simulated player. */
export type Policy = (state: any, params: any, rng: XorShift32) => string;

export const POLICIES: Readonly<Record<GameId, Policy>> = {
  "odd-even": (_s, _p, rng) => (rng.int(2) ? "odd" : "even"),
  "high-low": (state, params) => {
    const odds = highLowOdds(state), direction = odds.higher >= odds.lower ? "higher" : "lower", chance = Math.max(odds.higher, odds.lower);
    if (state.streak === 0) return direction;
    const now = params.multipliers[state.streak - 1], next = params.multipliers[state.streak];
    return next !== undefined && chance * next > now ? direction : "cashout";
  },
  blackjack: (state) => (basicStrategyHits(state.player, state.dealer[0]) ? "hit" : "stand"),
  "last-train": (state, _p, rng) => (state.stations > 0 && rng.int(4) === 0 ? "stop" : "roll"),
  roulette: (_s, _p, rng) => ["red", "black", "odd", "even", "low", "high", "dozen1", "dozen2", "dozen3", `n${1 + rng.int(36)}`][rng.int(10)] as string,
  "dice-poker": (state) => `hold:${suggestDiceHold(state.player)}`,
  "old-maid": (state, _p, rng) => `pick:${rng.int(state.dealer.length)}`,
  "draw-poker": (state) => `hold:${suggestPokerHold(state.player)}`,
};

/** Average payout / bet over `rounds` games with fresh step seeds, as the server would produce. */
export function simulateRtp(game: AnyGame, params: unknown, rounds: number, salt = "sim"): number {
  const bet = 1_000, policyRng = new XorShift32(`${salt}:policy`);
  let paid = 0;
  for (let round = 0; round < rounds; round += 1) {
    const trace = { wagerId: `${salt}-${round}`, openedAtMs: 1_700_000_000_000 + round, timesMs: [] as number[] };
    let state = game.start(bet, params, new XorShift32(stepSeed(trace, 0)));
    let step = 0;
    while (!game.isDone(state)) {
      const action = POLICIES[game.id](state, params, policyRng);
      if (!game.canApply(state, action)) throw new Error(`policy produced illegal ${action}`);
      step += 1; trace.timesMs.push(trace.openedAtMs + step * 997);
      state = game.apply(state, action, params, new XorShift32(stepSeed(trace, step)));
    }
    paid += game.payout(state);
  }
  return paid / (bet * rounds);
}
