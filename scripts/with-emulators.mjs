// Start the Auth + Firestore emulators, run a command against them, then tear the
// whole process tree down. `firebase emulators:exec` leaves the Java emulator
// running on Windows, which blocks the next run's ports.
//
// Usage: node scripts/with-emulators.mjs <command...>
import { spawn, execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PROJECT = "demo-fortuna";
const FIRESTORE = "127.0.0.1:8080";
const AUTH = "127.0.0.1:9099";
const isWindows = process.platform === "win32";

const command = process.argv.slice(2).join(" ");
if (!command) { console.error("usage: with-emulators.mjs <command>"); process.exit(2); }

const emulators = spawn(`corepack pnpm exec firebase emulators:start --only auth,firestore --project ${PROJECT}`, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
emulators.stdout.on("data", (chunk) => { log += chunk; });
emulators.stderr.on("data", (chunk) => { log += chunk; });

function stop() {
  if (emulators.exitCode !== null) return;
  try {
    if (isWindows) execSync(`taskkill /pid ${emulators.pid} /T /F`, { stdio: "ignore" });
    else process.kill(-emulators.pid, "SIGTERM");
  } catch { /* already gone */ }
}
process.on("exit", stop);
process.on("SIGINT", () => { stop(); process.exit(130); });

async function ready(url) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (emulators.exitCode !== null) throw new Error(`emulators exited early:\n${log}`);
    try { await fetch(url); return; } catch { await sleep(500); }
  }
  throw new Error(`emulator at ${url} did not start:\n${log}`);
}

try {
  await ready(`http://${FIRESTORE}/`);
  await ready(`http://${AUTH}/`);
  const child = spawn(command, { shell: true, stdio: "inherit", env: { ...process.env, FIRESTORE_EMULATOR_HOST: FIRESTORE, FIREBASE_AUTH_EMULATOR_HOST: AUTH, GCLOUD_PROJECT: PROJECT } });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  stop();
  process.exit(code ?? 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stop();
  process.exit(1);
}
