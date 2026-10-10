import { floorCoins, isRecord, type GameDefinition } from "./types.ts";

export interface RouletteParams { zeros: 0 | 1 | 2; }
export type RouletteBet = "red" | "black" | "odd" | "even" | "low" | "high" | "dozen1" | "dozen2" | "dozen3" | `n${number}`;
export interface RouletteState {
  bet: number;
  wager: RouletteBet | null;
  /** 1..36, 0, or -1 for 00. */
  pocket: number | null;
  done: boolean;
  payout: number;
}

export const RED_NUMBERS: ReadonlySet<number> = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export function rouletteGross(wager: RouletteBet): number {
  if (wager.startsWith("n")) return 36;
  return wager.startsWith("dozen") ? 3 : 2;
}

export function rouletteWins(wager: RouletteBet, pocket: number): boolean {
  if (pocket <= 0) return false;
  switch (wager) {
    case "red": return RED_NUMBERS.has(pocket);
    case "black": return !RED_NUMBERS.has(pocket);
    case "odd": return pocket % 2 === 1;
    case "even": return pocket % 2 === 0;
    case "low": return pocket <= 18;
    case "high": return pocket >= 19;
    case "dozen1": return pocket <= 12;
    case "dozen2": return pocket >= 13 && pocket <= 24;
    case "dozen3": return pocket >= 25;
    default: return Number(wager.slice(1)) === pocket;
  }
}

function validWager(action: string): action is RouletteBet {
  if (["red", "black", "odd", "even", "low", "high", "dozen1", "dozen2", "dozen3"].includes(action)) return true;
  const match = /^n(\d{1,2})$/.exec(action);
  return match !== null && Number(match[1]) >= 1 && Number(match[1]) <= 36;
}

/** 룰렛: one bet per spin. Every bet returns 36/(36+zeros), so zeros set the edge. */
export const roulette: GameDefinition<RouletteParams, RouletteState> = {
  id: "roulette",
  defaults: { alley: { zeros: 0 }, house: { zeros: 2 } },
  params(raw, venue) {
    const base = this.defaults[venue];
    return isRecord(raw) && (raw.zeros === 0 || raw.zeros === 1 || raw.zeros === 2) ? { zeros: raw.zeros } : base;
  },
  maxMultiplier: () => 36,
  start: (bet) => ({ bet, wager: null, pocket: null, done: false, payout: 0 }),
  canApply: (state, action) => !state.done && validWager(action),
  apply(state, action, params, rng) {
    const wager = action as RouletteBet, slot = rng.int(36 + params.zeros);
    const pocket = slot < 36 ? slot + 1 : slot === 36 ? 0 : -1;
    return { ...state, wager, pocket, done: true, payout: rouletteWins(wager, pocket) ? floorCoins(state.bet * rouletteGross(wager)) : 0 };
  },
  isDone: (state) => state.done,
  payout: (state) => state.payout,
};
