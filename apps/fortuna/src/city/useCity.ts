import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { limit, onSnapshot, orderBy, query, where, type Query } from "firebase/firestore";
import { isPlaceId, normalizeSprite, type LineId, type PlaceId } from "@fortuna/core";
import {
  cityRefs, sessionOpen,
  type ActorDoc, type ActivityDoc, type ContestDoc, type MessageDoc, type NpcDoc, type SceneDoc, type SceneImageDoc, type SessionDoc,
} from "@fortuna/data";
import { db } from "../firebase.ts";

/** Server times of our own pending writes are estimated locally. */
const ESTIMATE = { serverTimestamps: "estimate" } as const;
const ms = (value: { toMillis?: () => number } | null | undefined) => value?.toMillis?.() ?? Date.now();

function useSnapshotList<T>(build: () => Query<T> | null, key: string): { ready: boolean; rows: { id: string; data: T }[] } {
  const [state, setState] = useState<{ ready: boolean; rows: { id: string; data: T }[] }>({ ready: false, rows: [] });
  useEffect(() => {
    const q = build();
    if (!q) { setState({ ready: true, rows: [] }); return undefined; }
    setState({ ready: false, rows: [] });
    return onSnapshot(q, (snapshot) => setState({ ready: true, rows: snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data(ESTIMATE) as T })) }), () => setState({ ready: true, rows: [] }));
  }, [key]);
  return state;
}

export interface ActorRow { id: string; data: ActorDoc; seenMs: number; }

export function useActors(): { ready: boolean; actors: ActorRow[] } {
  const { ready, rows } = useSnapshotList(() => cityRefs.actors(db), "actors");
  return useMemo(() => ({
    ready,
    actors: rows.filter((row) => isPlaceId(row.data.place)).map((row) => ({ id: row.id, data: { ...row.data, sprite: normalizeSprite(row.data.sprite), portrait: row.data.portrait ?? null }, seenMs: ms(row.data.seenAt) })),
  }), [ready, rows]);
}

export interface MessageRow { id: string; data: MessageDoc; atMs: number; pending: boolean; }

/** The newest `count` messages of a channel, oldest first. */
export function useMessages(channel: string | null, count: number): { ready: boolean; messages: MessageRow[] } {
  const [state, setState] = useState<{ ready: boolean; messages: MessageRow[] }>({ ready: false, messages: [] });
  useEffect(() => {
    if (!channel) { setState({ ready: true, messages: [] }); return undefined; }
    setState({ ready: false, messages: [] });
    return onSnapshot(query(cityRefs.messages(db), where("channel", "==", channel), orderBy("at", "desc"), limit(count)), { includeMetadataChanges: true }, (snapshot) => {
      setState({
        ready: true,
        messages: snapshot.docs.map((doc) => {
          const data = doc.data(ESTIMATE) as MessageDoc;
          return { id: doc.id, data: { ...data, authorKind: data.authorKind ?? "pc", pinned: data.pinned ?? false }, atMs: ms(data.at), pending: doc.metadata.hasPendingWrites };
        }).reverse(),
      });
    }, () => setState({ ready: true, messages: [] }));
  }, [channel, count]);
  return state;
}

export function usePinned(count = 60): MessageRow[] {
  const { rows } = useSnapshotList(() => query(cityRefs.messages(db), where("pinned", "==", true), where("public", "==", true), orderBy("at", "desc"), limit(count)), `pinned:${count}`);
  return useMemo(() => rows.filter((row) => !row.data.deleted).map((row) => ({ id: row.id, data: row.data, atMs: ms(row.data.at), pending: false })), [rows]);
}

export function useActivities(): Map<PlaceId, { lastMs: number; lastName: string }> {
  const { rows } = useSnapshotList(() => cityRefs.activities(db), "activities");
  return useMemo(() => new Map(rows.filter((row) => isPlaceId(row.id)).map((row) => [row.id as PlaceId, { lastMs: ms((row.data as ActivityDoc).lastAt), lastName: (row.data as ActivityDoc).lastName }])), [rows]);
}

export function useReads(pid: string | null): Map<PlaceId, number> {
  const [reads, setReads] = useState<Map<PlaceId, number>>(new Map());
  useEffect(() => {
    if (!pid) return undefined;
    return onSnapshot(cityRefs.reads(db, pid), (snapshot) => {
      const data = snapshot.data(ESTIMATE) ?? {};
      setReads(new Map(Object.entries(data).filter(([key]) => isPlaceId(key)).map(([key, value]) => [key as PlaceId, ms(value as { toMillis?: () => number })])));
    }, () => undefined);
  }, [pid]);
  return reads;
}

export function useScene(place: PlaceId | null): SceneDoc | null {
  const [scene, setScene] = useState<SceneDoc | null>(null);
  useEffect(() => {
    setScene(null);
    if (!place) return undefined;
    return onSnapshot(cityRefs.scene(db, place), (snapshot) => setScene((snapshot.data(ESTIMATE) as SceneDoc | undefined) ?? null), () => setScene(null));
  }, [place]);
  return scene;
}

export interface CityData {
  images: Map<string, SceneImageDoc & { id: string }>;
  npcs: Map<string, NpcDoc & { id: string }>;
  closedLines: Set<LineId>;
  session: (SessionDoc & { id: string }) | null;
}

/** Images, NPCs, closed lines and the open session: small collections every city screen needs. */
export function useCityData(nowMs: number): CityData {
  const images = useSnapshotList(() => cityRefs.images(db), "images");
  const npcs = useSnapshotList(() => cityRefs.npcs(db), "npcs");
  const sessions = useSnapshotList(() => query(cityRefs.sessions(db), where("closedAt", "==", null)), "sessions:open");
  const [closedLines, setClosedLines] = useState<Set<LineId>>(new Set());
  useEffect(() => onSnapshot(cityRefs.config(db), (snapshot) => setClosedLines(new Set(snapshot.data()?.closedLines ?? [])), () => undefined), []);
  return useMemo(() => {
    const open = sessions.rows.map((row) => ({ ...row.data, id: row.id })).filter((session) => sessionOpen(session, nowMs))
      .sort((a, b) => ms(b.openedAt) - ms(a.openedAt))[0] ?? null;
    return {
      images: new Map(images.rows.map((row) => [row.id, { ...row.data, id: row.id }])),
      npcs: new Map(npcs.rows.map((row) => [row.id, { ...row.data, id: row.id }])),
      closedLines,
      session: open,
    };
  }, [images.rows, npcs.rows, sessions.rows, closedLines, Math.floor(nowMs / 60_000)]);
}

export function useOpenContest(place: PlaceId): (ContestDoc & { id: string }) | null {
  const { rows } = useSnapshotList(() => query(cityRefs.contests(db), where("place", "==", place), where("status", "==", "open")), `contest:${place}`);
  return rows[0] ? { ...rows[0].data, id: rows[0].id } : null;
}

/** Skill payments made for a contest, highest score first. */
export function useContestEntries(contestId: string | null): MessageRow[] {
  const { rows } = useSnapshotList(() => (contestId ? query(cityRefs.messages(db), where("contestId", "==", contestId), where("public", "==", true)) : null), `entries:${contestId}`);
  return useMemo(() => rows.filter((row) => row.data.kind === "skill" && row.data.skill && !row.data.deleted)
    .map((row) => ({ id: row.id, data: row.data, atMs: ms(row.data.at), pending: false }))
    .sort((a, b) => b.data.skill!.used - a.data.skill!.used || a.atMs - b.atMs), [rows]);
}

export function useSessions(): (SessionDoc & { id: string })[] {
  const { rows } = useSnapshotList(() => query(cityRefs.sessions(db), orderBy("openedAt", "desc"), limit(40)), "sessions:all");
  return rows.map((row) => ({ ...row.data, id: row.id }));
}

/** Re-render every `ms` (for "away" states and highlights that expire). */
export function useTicker(every: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), every); return () => window.clearInterval(timer); }, [every]);
  return now;
}

export const AWAY_MS = 3 * 60_000;
export const SPEAKING_MS = 6_000;

/** Lookups messages need to draw faces and images. */
export interface CityLookups { actors: Map<string, ActorRow>; data: CityData; }
const LookupContext = createContext<CityLookups | null>(null);
export const CityLookupProvider = LookupContext.Provider;
export function useLookups(): CityLookups {
  const value = useContext(LookupContext);
  if (!value) throw new Error("useLookups outside CityLookupProvider");
  return value;
}
