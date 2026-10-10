import { useEffect, useState } from "react";
import { onSnapshot, type DocumentReference, type Query } from "firebase/firestore";

export type Live<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: Error };

/** Subscribe to one document. `null` ref = idle. Missing documents resolve to `null`. */
export function useLiveDoc<T>(ref: DocumentReference<T> | null, key: string): Live<T | null> {
  const [state, setState] = useState<Live<T | null>>({ status: "loading" });
  useEffect(() => {
    if (!ref) { setState({ status: "loading" }); return undefined; }
    setState({ status: "loading" });
    return onSnapshot(ref, (snapshot) => setState({ status: "ready", data: snapshot.exists() ? snapshot.data() : null }), (error) => setState({ status: "error", error }));
    // Re-subscribe only when `key` changes; callers rebuild refs every render.
  }, [key]);
  return state;
}

export interface Row<T> { id: string; data: T; }

export function useLiveQuery<T>(query: Query<T> | null, key: string): Live<Row<T>[]> {
  const [state, setState] = useState<Live<Row<T>[]>>({ status: "loading" });
  useEffect(() => {
    if (!query) { setState({ status: "loading" }); return undefined; }
    setState({ status: "loading" });
    return onSnapshot(query, (snapshot) => setState({ status: "ready", data: snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() })) }), (error) => setState({ status: "error", error }));
  }, [key]);
  return state;
}

export function dataOr<T>(live: Live<T>, fallback: T): T { return live.status === "ready" ? live.data : fallback; }
