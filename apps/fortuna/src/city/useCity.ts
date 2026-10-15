import { useEffect, useMemo, useState } from "react";
import { limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { isPlaceId, normalizeSprite } from "@fortuna/core";
import { cityHeartbeat, cityRefs, type ActorDoc, type MessageDoc } from "@fortuna/data";
import { db } from "../firebase.ts";
import { usePlayer } from "../session/player.tsx";

/** Server times of our own pending writes are estimated locally, so a walk starts the moment you tap. */
const ESTIMATE = { serverTimestamps: "estimate" } as const;

export interface ActorRow { id: string; data: ActorDoc; atMs: number; seenMs: number; }

/** Every character in the city (a handful of documents). */
export function useActors(): { ready: boolean; actors: ActorRow[] } {
  const [state, setState] = useState<{ ready: boolean; actors: ActorRow[] }>({ ready: false, actors: [] });
  useEffect(() => onSnapshot(cityRefs.actors(db), (snapshot) => {
    const actors = snapshot.docs.flatMap((doc) => {
      const data = doc.data(ESTIMATE) as ActorDoc;
      if (!isPlaceId(data.place)) return [];
      return [{ id: doc.id, data: { ...data, sprite: normalizeSprite(data.sprite) }, atMs: data.at?.toMillis?.() ?? Date.now(), seenMs: data.seenAt?.toMillis?.() ?? Date.now() }];
    });
    setState({ ready: true, actors });
  }, () => setState({ ready: true, actors: [] })), []);
  return state;
}

export interface MessageRow { id: string; data: MessageDoc; atMs: number; pending: boolean; }

/** The newest `count` messages of a channel, oldest first. */
export function useMessages(channel: string, count: number): { ready: boolean; messages: MessageRow[] } {
  const [state, setState] = useState<{ ready: boolean; messages: MessageRow[] }>({ ready: false, messages: [] });
  useEffect(() => {
    setState({ ready: false, messages: [] });
    return onSnapshot(query(cityRefs.messages(db), where("channel", "==", channel), orderBy("at", "desc"), limit(count)), { includeMetadataChanges: true }, (snapshot) => {
      const messages = snapshot.docs.map((doc) => {
        const data = doc.data(ESTIMATE) as MessageDoc;
        return { id: doc.id, data, atMs: data.at?.toMillis?.() ?? Date.now(), pending: doc.metadata.hasPendingWrites };
      }).reverse();
      setState({ ready: true, messages });
    }, () => setState({ ready: true, messages: [] }));
  }, [channel, count]);
  return state;
}

/** Tell the others we are here, once a minute while the city is open and visible. */
export function useCityHeartbeat(enabled: boolean): void {
  const { session } = usePlayer();
  useEffect(() => {
    if (!enabled) return undefined;
    const beat = () => { if (document.visibilityState === "visible") void cityHeartbeat(session).catch(() => undefined); };
    beat();
    const timer = window.setInterval(beat, 60_000);
    document.addEventListener("visibilitychange", beat);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", beat); };
  }, [enabled]);
}

/** Re-render every `ms` (for "away" states and bubbles that expire). */
export function useTicker(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), ms); return () => window.clearInterval(timer); }, [ms]);
  return now;
}

export const AWAY_MS = 3 * 60_000;
export const BUBBLE_MS = 6_000;

export function useActorMap(actors: ActorRow[]): Map<string, ActorRow> {
  return useMemo(() => new Map(actors.map((row) => [row.id, row])), [actors]);
}
