import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "../firebase.ts";

export type AuthState = { status: "loading" } | { status: "ready"; user: User | null };

export function useAuthUser(): AuthState {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  useEffect(() => onAuthStateChanged(auth, (user) => setState({ status: "ready", user })), []);
  return state;
}
