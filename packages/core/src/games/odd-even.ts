import { floorCoins, isRecord, numberOr, type GameDefinition } from "./types.ts";

export interface OddEvenParams { payout: number; }
export interface OddEvenState {
  bet: number;
  pick: "odd" | "even" | null;
  dice: [number, number] | null;
  win: boolean;
  done: boolean;
  payout: number;
}

/** 홀짝: two dice, guess whether the sum is odd or even. */
export const oddEven: GameDefinition<OddEvenParams, OddEvenState> = {
  id: "odd-even",
  defaults: { alley: { payout: 2 }, house: { payout: 1.9 } },
  params(raw, venue) { const base = this.defaults[venue]; return isRecord(raw) ? { payout: numberOr(raw.payout, base.payout, 1, 10) } : base; },
  maxMultiplier: (params) => params.payout,
  start: (bet) => ({ bet, pick: null, dice: null, win: false, done: false, payout: 0 }),
  canApply: (state, action) => !state.done && (action === "odd" || action === "even"),
  apply(state, action, params, rng) {
    const pick = action === "odd" ? "odd" : "even";
    const dice: [number, number] = [rng.die(), rng.die()];
    const odd = (dice[0] + dice[1]) % 2 === 1, win = odd === (pick === "odd");
    return { ...state, pick, dice, win, done: true, payout: win ? floorCoins(state.bet * params.payout) : 0 };
  },
  isDone: (state) => state.done,
  payout: (state) => state.payout,
};
