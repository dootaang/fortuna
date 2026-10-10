// Run: node packages/core/test/rtp-report.ts [rounds]
import { GAME_IDS, GAMES, VENUES } from "../src/games/index.ts";
import { simulateRtp } from "./simulate.ts";

const rounds = Number(process.argv[2] ?? 200_000);
for (const id of GAME_IDS) {
  const line = VENUES.map((venue) => `${venue} ${(simulateRtp(GAMES[id], GAMES[id].defaults[venue], rounds) * 100).toFixed(2)}%`).join("  ");
  console.log(`${id.padEnd(11)} ${line}`);
}
