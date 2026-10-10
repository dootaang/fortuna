import { floorCoins, isRecord, numberOr, type GameDefinition } from "./types.ts";

export interface LastTrainParams {
  /** Multiplier gained per station. 1.2 with a 5/6 survival chance keeps EV flat at every stop. */
  factor: number;
  /** Return rate applied to the whole table (alley ~0.99, house ~0.95). */
  returnRate: number;
  /** The terminus: reaching it cashes out automatically. */
  stations: number;
}
export interface LastTrainState {
  bet: number;
  stations: number;
  rolls: number[];
  done: boolean;
  caught: boolean;
  payout: number;
}

export function lastTrainMultiplier(params: LastTrainParams, stations: number): number {
  return stations <= 0 ? 0 : params.returnRate * params.factor ** stations;
}

/**
 * 막차: keep rolling a die to ride one more station. A 1 is the conductor —
 * the ticket is void and everything is lost. Stop any time to cash out.
 */
export const lastTrain: GameDefinition<LastTrainParams, LastTrainState> = {
  id: "last-train",
  defaults: { alley: { factor: 1.2, returnRate: 0.99, stations: 10 }, house: { factor: 1.2, returnRate: 0.95, stations: 10 } },
  params(raw, venue) {
    const base = this.defaults[venue];
    if (!isRecord(raw)) return base;
    return { factor: numberOr(raw.factor, base.factor, 1, 2), returnRate: numberOr(raw.returnRate, base.returnRate, 0.5, 1.1), stations: Math.round(numberOr(raw.stations, base.stations, 1, 20)) };
  },
  maxMultiplier: (params) => lastTrainMultiplier(params, params.stations),
  start: (bet) => ({ bet, stations: 0, rolls: [], done: false, caught: false, payout: 0 }),
  canApply: (state, action) => !state.done && (action === "roll" || (action === "stop" && state.stations > 0)),
  apply(state, action, params, rng) {
    if (action === "stop") return { ...state, done: true, payout: floorCoins(state.bet * lastTrainMultiplier(params, state.stations)) };
    const roll = rng.die(), rolls = [...state.rolls, roll];
    if (roll === 1) return { ...state, rolls, done: true, caught: true, payout: 0 };
    const stations = state.stations + 1;
    return stations >= params.stations
      ? { ...state, rolls, stations, done: true, payout: floorCoins(state.bet * lastTrainMultiplier(params, stations)) }
      : { ...state, rolls, stations };
  },
  isDone: (state) => state.done,
  payout: (state) => state.payout,
};
