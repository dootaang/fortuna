import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import { Clock } from "@fortuna/data";

/** Web config is public by design; security lives in firestore.rules. */
const PRODUCTION = {
  apiKey: "AIzaSyBj01v9rEnfq-R4ADS5D_2z-BWStcU5aY4",
  authDomain: "fortuna-472e3.firebaseapp.com",
  projectId: "fortuna-472e3",
  storageBucket: "fortuna-472e3.firebasestorage.app",
  messagingSenderId: "478708184543",
  appId: "1:478708184543:web:056d80a347a021d92a806a",
};

export const usingEmulators = import.meta.env.VITE_USE_EMULATORS === "1";

export const app = initializeApp(usingEmulators ? { ...PRODUCTION, projectId: "demo-fortuna", apiKey: "demo-key" } : PRODUCTION);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const clock = new Clock();

if (usingEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}
