// 환전가 시세 기록원 계정 만들기.
//
// 1. Firebase 익명 계정을 하나 새로 만든다 (기록원 전용).
// 2. 그 계정의 refresh token과 새 시세 비밀값을 Worker 비밀값으로 바로 등록한다
//    (ORACLE_REFRESH_TOKEN, MARKET_SECRET). 비밀값은 화면에 찍지 않는다.
// 3. 계정 UID를 출력한다 → 딜러 화면 › 거래소 › "기록원 UID 등록"에 붙여 넣는다.
//
// Usage: node scripts/create-oracle.mjs            (production, wrangler 로그인 필요)
//        node scripts/create-oracle.mjs --dry-run  (계정만 만들고 비밀값 등록은 건너뜀)
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const toml = readFileSync(new URL("../apps/notifier/wrangler.toml", import.meta.url), "utf8");
const apiKey = /FIREBASE_API_KEY\s*=\s*"([^"]+)"/.exec(toml)?.[1];
if (!apiKey) { console.error("FIREBASE_API_KEY not found in apps/notifier/wrangler.toml"); process.exit(1); }
const dryRun = process.argv.includes("--dry-run");

const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnSecureToken: true }),
});
if (!response.ok) { console.error(`sign-up failed: ${response.status} ${await response.text()}`); process.exit(1); }
const { localId, refreshToken } = await response.json();

function putSecret(name, value) {
  const result = spawnSync("corepack pnpm --filter @fortuna/notifier exec wrangler secret put " + name, {
    input: value, shell: true, stdio: ["pipe", "inherit", "inherit"],
  });
  if (result.status !== 0) { console.error(`wrangler secret put ${name} failed`); process.exit(1); }
}

if (!dryRun) {
  putSecret("ORACLE_REFRESH_TOKEN", refreshToken);
  putSecret("MARKET_SECRET", randomBytes(32).toString("hex"));
}

console.log("\n시세 기록원 UID:", localId);
console.log("딜러 화면 › 거래소 › 기록원 UID 등록에 이 값을 붙여 넣으십시오.");
if (dryRun) console.log("(--dry-run: Worker 비밀값은 등록하지 않았습니다.)");
