import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, type RulesTestContext, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInAnonymously, signInWithCredential, signOut } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, terminate, type Firestore } from "firebase/firestore";
import { Clock, bindAccessCode, bootstrapCity, createPlayer, type PlayerSession, type Session } from "@fortuna/data";

export const PROJECT_ID = "demo-fortuna";
const [firestoreHost, firestorePort] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

let env: RulesTestEnvironment | null = null;
const apps: FirebaseApp[] = [];
let counter = 0;

export async function testEnv(): Promise<RulesTestEnvironment> {
  env ??= await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(fileURLToPath(new URL("../../../firestore.rules", import.meta.url)), "utf8"), host: firestoreHost ?? "127.0.0.1", port: Number(firestorePort ?? 8080) },
  });
  return env;
}

export async function resetData(): Promise<void> {
  await (await testEnv()).clearFirestore();
  await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" });
}

export async function closeAll(): Promise<void> {
  for (const app of apps.splice(0)) { await terminate(getFirestore(app)).catch(() => undefined); await deleteApp(app).catch(() => undefined); }
  await env?.cleanup(); env = null;
}

function client(): { app: FirebaseApp; db: Firestore } {
  const app = initializeApp({ projectId: PROJECT_ID, apiKey: "demo-key", authDomain: `${PROJECT_ID}.firebaseapp.com` }, `client-${counter += 1}`);
  apps.push(app);
  connectAuthEmulator(getAuth(app), `http://${authHost}`, { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, firestoreHost ?? "127.0.0.1", Number(firestorePort ?? 8080));
  return { app, db };
}

/** A Google-signed-in dealer, registered in admins/ with rules disabled (as the console would). */
export async function adminSession(): Promise<Session> {
  const { app, db } = client();
  const credential = GoogleAuthProvider.credential(JSON.stringify({ sub: `dealer-${counter}`, email: `dealer${counter}@example.com`, email_verified: true }));
  const { user } = await signInWithCredential(getAuth(app), credential);
  await asRoot((root) => root.doc(`admins/${user.uid}`).set({}));
  return { db, uid: user.uid, clock: new Clock() };
}

/** A fresh anonymous browser. */
export async function anonymousSession(): Promise<Session> {
  const { app, db } = client();
  const { user } = await signInAnonymously(getAuth(app));
  return { db, uid: user.uid, clock: new Clock() };
}

export async function signOutAll(): Promise<void> { for (const app of apps) await signOut(getAuth(app)).catch(() => undefined); }

/** Bootstrapped city with one registered, bound (not yet arrived) player. */
export async function cityWithPlayer(name = "에이든", districtId = "medieval", skills = [{ id: "sword", name: "검술", level: 4 }]) {
  const admin = await adminSession();
  await bootstrapCity(admin);
  const { pid, code } = await createPlayer(admin, { name, districtId, skills, note: "" });
  const browser = await anonymousSession();
  await bindAccessCode(browser, code);
  const player: PlayerSession = { ...browser, pid };
  return { admin, player, pid, code };
}

export type RootDb = ReturnType<RulesTestContext["firestore"]>;

/** Rules-disabled (compat API) access for setup and for reading state back. */
export async function asRoot<T>(fn: (db: RootDb) => Promise<T>): Promise<T> {
  let result: T | undefined;
  await (await testEnv()).withSecurityRulesDisabled(async (context) => { result = await fn(context.firestore()); });
  return result as T;
}

/** Read one document's data with rules disabled. */
export async function rootData(path: string): Promise<Record<string, any> | undefined> {
  return asRoot(async (root) => (await root.doc(path).get()).data());
}
