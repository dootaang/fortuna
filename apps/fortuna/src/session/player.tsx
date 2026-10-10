import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { deleteDoc, type Timestamp } from "firebase/firestore";
import { DEFAULT_ECONOMY, DEFAULT_NOTIFY, districtContent, normalizeEconomy, normalizeNotify, type DistrictContent, type EconomyConfig, type NotifyConfig, type Wallet } from "@fortuna/core";
import { refs, syncClock, type DistrictDoc, type PlayerDoc, type PlayerSession, type PoolDoc } from "@fortuna/data";
import { clock, db } from "../firebase.ts";
import { useLiveDoc } from "./live.ts";

export interface PlayerContextValue {
  session: PlayerSession;
  player: PlayerDoc;
  wallet: Wallet<Timestamp>;
  config: EconomyConfig;
  notify: NotifyConfig;
  district: DistrictDoc | null;
  content: DistrictContent;
  vault: PoolDoc | null;
  treasury: PoolDoc | null;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayer(): PlayerContextValue {
  const value = useContext(PlayerContext);
  if (!value) throw new Error("usePlayer outside PlayerProvider");
  return value;
}

export type BindingState =
  | { status: "loading" }
  | { status: "unbound"; reason: "none" | "revoked" }
  | { status: "bound"; value: PlayerContextValue };

/** Everything a bound anonymous browser needs, live. */
export function usePlayerBinding(uid: string): BindingState {
  const binding = useLiveDoc(refs.binding(db, uid), `binding:${uid}`);
  const pid = binding.status === "ready" && binding.data ? binding.data.playerId : null;
  const player = useLiveDoc(pid ? refs.player(db, pid) : null, `player:${pid}`);
  const wallet = useLiveDoc(pid ? refs.wallet(db, pid) : null, `wallet:${pid}`);
  const config = useLiveDoc(pid ? refs.config(db) : null, `config:${pid}`);
  const notify = useLiveDoc(pid ? refs.notify(db) : null, `notify:${pid}`);
  const districtId = player.status === "ready" ? player.data?.districtId ?? null : null;
  const district = useLiveDoc(districtId ? refs.district(db, districtId) : null, `district:${districtId}`);
  const vault = useLiveDoc(pid ? refs.vault(db) : null, `vault:${pid}`);
  const treasury = useLiveDoc(pid ? refs.treasury(db) : null, `treasury:${pid}`);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (!pid) return;
    void syncClock(db, uid, clock).catch(() => undefined).finally(() => setSynced(true));
  }, [pid, uid]);

  // A reissued code makes the old binding unreadable for the player document: drop it and ask again.
  const revoked = player.status === "error";
  useEffect(() => { if (revoked) void deleteDoc(refs.binding(db, uid)).catch(() => undefined); }, [revoked, uid]);

  return useMemo<BindingState>(() => {
    if (binding.status === "loading") return { status: "loading" };
    if (binding.status === "error" || !binding.data) return { status: "unbound", reason: "none" };
    if (revoked) return { status: "unbound", reason: "revoked" };
    if (player.status !== "ready" || wallet.status !== "ready" || config.status !== "ready" || !synced) return { status: "loading" };
    if (!player.data || !wallet.data || !pid) return { status: "unbound", reason: "revoked" };
    const value: PlayerContextValue = {
      session: { db, uid, pid, clock },
      player: player.data,
      wallet: wallet.data,
      config: config.data ? normalizeEconomy(config.data) : DEFAULT_ECONOMY,
      notify: notify.status === "ready" && notify.data ? normalizeNotify(notify.data) : DEFAULT_NOTIFY,
      district: district.status === "ready" ? district.data : null,
      content: districtContent(player.data.districtId),
      vault: vault.status === "ready" ? vault.data : null,
      treasury: treasury.status === "ready" ? treasury.data : null,
    };
    return { status: "bound", value };
  }, [binding, player, wallet, config, notify, district, vault, treasury, synced, revoked, pid, uid]);
}

export function PlayerProvider({ value, children }: { value: PlayerContextValue; children: ReactNode }) {
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
