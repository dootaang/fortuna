import { describe, expect, it } from "vitest";
import { GAME_IDS, GAMES } from "../src/games/index.ts";
import { simulateRtp } from "./simulate.ts";

// Monte Carlo guard for every default table: alley ≈ break-even, house ≈ 5% edge.
// Run `node packages/core/test/rtp-report.ts 200000` for tighter numbers when retuning.
const ROUNDS = 30_000;

describe("default tables return what the brief promises", () => {
  it("roulette: every bet returns exactly 36/(36+zeros)", () => {
    expect(36 / (36 + GAMES.roulette.defaults.alley.zeros)).toBe(1);
    expect(36 / (36 + GAMES.roulette.defaults.house.zeros)).toBeCloseTo(0.947, 3);
  });
  // Roulette's straight-up bets make Monte Carlo too noisy; it is exact above.
  for (const id of GAME_IDS.filter((game) => game !== "roulette")) {
    it(`${id}: alley 97.5–102%, house 93–97%`, () => {
      const alley = simulateRtp(GAMES[id], GAMES[id].defaults.alley, ROUNDS, `${id}-a`);
      const house = simulateRtp(GAMES[id], GAMES[id].defaults.house, ROUNDS, `${id}-h`);
      expect(alley).toBeGreaterThan(0.975);
      expect(alley).toBeLessThan(1.02);
      expect(house).toBeGreaterThan(0.93);
      expect(house).toBeLessThan(0.97);
      expect(house).toBeLessThan(alley);
    }, 60_000);
  }
});
