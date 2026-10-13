import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, terminate } from "firebase/firestore";
import { DEFAULT_ECONOMY } from "@fortuna/core";
import { Clock, bootstrapCity, createPlayer, saveEconomy, saveItem, saveFund, type Session } from "@fortuna/data";

const PROJECT = "demo-fortuna";
const FIRESTORE = "127.0.0.1:8080";
const AUTH = "127.0.0.1:9099";

export async function resetEmulators(): Promise<void> {
  await fetch(`http://${FIRESTORE}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
}

/** Register a uid as dealer the way the console would (rules bypassed with the emulator owner token). */
export async function allowDealer(uid: string): Promise<void> {
  const response = await fetch(`http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/admins?documentId=${uid}`, {
    method: "POST", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify({ fields: {} }),
  });
  if (!response.ok && response.status !== 409) throw new Error(`allowDealer failed: ${response.status} ${await response.text()}`);
}

export async function withDealer<T>(email: string, fn: (session: Session) => Promise<T>): Promise<T> {
  const app = initializeApp({ projectId: PROJECT, apiKey: "demo-key", authDomain: `${PROJECT}.firebaseapp.com` }, `seed-${Date.now()}-${Math.random()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH}`, { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  try {
    const { user } = await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true })));
    await allowDealer(user.uid);
    return await fn({ db, uid: user.uid, clock: new Clock() });
  } finally {
    await terminate(db).catch(() => undefined);
    await deleteApp(app).catch(() => undefined);
  }
}

export interface SeededCity { code: string; pid: string; rumorId: string; }

export async function seedCity(shopEnabled = true): Promise<SeededCity> {
  return withDealer("dealer@example.com", async (session) => {
    await bootstrapCity(session);
    await saveEconomy(session, { ...DEFAULT_ECONOMY, shopEnabled, gambling: { ...DEFAULT_ECONOMY.gambling, houseOpen: true } }, DEFAULT_ECONOMY);
    const { pid, code } = await createPlayer(session, { name: "에이든", districtId: "wuxia", skills: [{ id: "blade", name: "쾌검", level: 4 }, { id: "qinggong", name: "경공", level: 2 }], note: "" });
    const rumorId = await saveItem(session, null, {
      name: "무협 간부의 버릇", description: "객잔 주인이 슬쩍 흘린 이야기.", price: 300, category: "rumor", stock: 3, perPlayerLimit: 1,
      visible: true, consumable: false, hasSecret: true, revealNote: "", sortOrder: 1,
    }, "검을 뽑기 전에 왼손으로 소매를 턴다.");
    await saveItem(session, null, { name: "재굴림권", description: "원정에서 주사위를 한 번 다시 굴린다.", price: 150, category: "consumable", stock: null, perPlayerLimit: null, visible: true, consumable: true, hasSecret: false, revealNote: "", sortOrder: 2 }, null);
    await saveFund(session, null, { title: "막차 정비 기금", description: "멈춰 선 기관차를 다시 움직이자.", goal: 2_000, status: "open", visible: true, sortOrder: 0 });
    return { code, pid, rumorId };
  });
}

/** Bind a fresh anonymous device to `code`, arrive, and play a few alley games through the real data layer. */
export async function playSomeGames(code: string, rounds = 4): Promise<void> {
  const { signInAnonymously } = await import("firebase/auth");
  const { getDoc } = await import("firebase/firestore");
  const { GAMES, replayWager, wagerTrace } = await import("@fortuna/core");
  const { arrive, bindAccessCode, openBet, refs, sealStep, settleBet, submitWork } = await import("@fortuna/data");
  const app = initializeApp({ projectId: PROJECT, apiKey: "demo-key", authDomain: `${PROJECT}.firebaseapp.com` }, `player-${Date.now()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH}`, { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  try {
    const { user } = await signInAnonymously(auth);
    const pid = await bindAccessCode({ db, uid: user.uid, clock: new Clock() }, code);
    const session = { db, uid: user.uid, pid, clock: new Clock() };
    await arrive(session);
    await submitWork(session, "sort", 0.8);
    for (let round = 0; round < rounds; round += 1) {
      await openBet(session, "high-low", "alley", 50);
      for (let guard = 0; guard < 10; guard += 1) {
        const wager = (await getDoc(refs.wallet(db, pid))).data()?.openWager;
        if (!wager) break;
        const state = replayWager(GAMES["high-low"], wager.bet, wager.params, wagerTrace(wager));
        if (GAMES["high-low"].isDone(state)) break;
        await sealStep(session, state.streak >= 1 ? "cashout" : "higher");
      }
      await settleBet(session, () => "e2e");
    }
  } finally {
    await terminate(db).catch(() => undefined);
    await deleteApp(app).catch(() => undefined);
  }
}

/** Extra passengers for multiplayer tests. */
export async function seedPlayers(names: string[]): Promise<string[]> {
  return withDealer("dealer@example.com", async (session) => {
    const codes: string[] = [];
    for (const name of names) codes.push((await createPlayer(session, { name, districtId: "downtown", skills: [], note: "" })).code);
    return codes;
  });
}

/**
 * A stand-in for the Cloudflare price recorder: an oracle account that records a tick every
 * `everyMs` of real time, each 15 s of market time later than the last (so tests need not wait).
 */
export async function startRecorder(everyMs = 1_000): Promise<{ stop: () => Promise<void>; recorder: import("../apps/notifier/src/oracle.ts").Recorder; tick: () => Promise<unknown> }> {
  const { signInAnonymously } = await import("firebase/auth");
  const { FirestoreRest } = await import("../apps/notifier/src/firestore-rest.ts");
  const { loadRecorder, recordTick } = await import("../apps/notifier/src/oracle.ts");
  const app = initializeApp({ projectId: PROJECT, apiKey: "demo-key", authDomain: `${PROJECT}.firebaseapp.com` }, `oracle-${Date.now()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH}`, { disableWarnings: true });
  const { user } = await signInAnonymously(auth);
  const response = await fetch(`http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/oracles?documentId=${user.uid}`, {
    method: "POST", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify({ fields: {} }),
  });
  if (!response.ok) throw new Error(`oracle registration failed: ${response.status}`);
  const rest = new FirestoreRest(PROJECT, await user.getIdToken(), `http://${FIRESTORE}`);
  let at = Math.floor(Date.now() / 15_000) * 15_000 - 30_000;
  const recorder = await loadRecorder(rest, "e2e-secret", at);
  const tick = async () => { at += 15_000; return recordTick(recorder, at); };
  await tick();
  let running = true;
  const loop = (async () => { while (running) { await new Promise((resolve) => setTimeout(resolve, everyMs)); if (running) await tick().catch(() => undefined); } })();
  return {
    recorder, tick,
    stop: async () => { running = false; await loop; await deleteApp(app).catch(() => undefined); },
  };
}
