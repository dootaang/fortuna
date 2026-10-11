import { increment, serverTimestamp, type Firestore, type Timestamp, type Transaction } from "firebase/firestore";
import { ledgerId, weekIndexAt, type LedgerType, type Wallet } from "@fortuna/core";
import { refs, type EventKind } from "./refs.ts";

export class FortunaError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "FortunaError"; }
}

/** Local clock corrected by the measured server offset (see syncClock). */
export class Clock {
  offsetMs = 0;
  now(): number { return Date.now() + this.offsetMs; }
  week(): number { return weekIndexAt(this.now()); }
}

export interface Session { db: Firestore; uid: string; clock: Clock; }
export interface PlayerSession extends Session { pid: string; }

export interface EntrySpec {
  type: LedgerType;
  actor: "player" | "admin";
  memo?: string;
  delta: number;
  debtDelta?: number;
  vaultDelta?: number;
  detail: Record<string, unknown>;
  /** Extra wallet fields to write alongside balance/debt/seq. */
  wallet?: Record<string, unknown>;
  event?: { kind: EventKind; payload?: Record<string, string | number | boolean> };
}

/**
 * Append one ledger entry and the wallet change it justifies, inside `tx`.
 * All reads must already be done. Returns the ledger id.
 */
export function writeEntry(tx: Transaction, session: Session, pid: string, wallet: Wallet<Timestamp>, spec: EntrySpec): string {
  const seq = wallet.seq + 1, id = ledgerId(pid, seq);
  // `|| 0` turns -0 into 0: the SDK would store -0 as a double and the rules require ints.
  const delta = spec.delta || 0, debtDelta = spec.debtDelta || 0, vaultDelta = spec.vaultDelta || 0;
  const balance = wallet.balance + delta || 0, debt = wallet.debt + debtDelta || 0;
  if (balance < 0) throw new FortunaError("insufficient", "잔액이 부족합니다.");
  if (debt < 0) throw new FortunaError("debt-negative", "빚보다 많이 갚을 수는 없습니다.");
  tx.update(refs.wallet(session.db, pid), { ...spec.wallet, balance, debt, seq });
  tx.set(refs.ledger(session.db, id), {
    playerId: pid, seq, type: spec.type, delta, debtDelta, vaultDelta, balanceAfter: balance, debtAfter: debt,
    weekIndex: session.clock.week(), actor: spec.actor, actorUid: session.uid, memo: spec.memo ?? "", detail: spec.detail,
    at: serverTimestamp() as unknown as Timestamp,
  });
  if (vaultDelta !== 0) tx.update(refs.vault(session.db), { amount: increment(vaultDelta), lastLedger: id });
  if (spec.event) {
    tx.set(refs.event(session.db, id), {
      kind: spec.event.kind, ledgerId: id, playerId: pid, actorUid: session.uid, at: serverTimestamp() as unknown as Timestamp, sentAt: null, payload: spec.event.payload ?? {},
    });
  }
  return id;
}

/** Translate SDK failures into something a player can read. */
export function friendlyError(error: unknown): string {
  if (error instanceof FortunaError) return error.message;
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  if (code === "permission-denied") return "요청이 거부되었습니다. 새로고침한 뒤 다시 시도해 주세요.";
  if (code === "unavailable" || code === "deadline-exceeded") return "연결이 끊겼습니다. 잠시 후 다시 시도해 주세요.";
  if (code === "aborted") return "다른 요청과 겹쳤습니다. 다시 시도해 주십시오.";
  return error instanceof Error ? error.message : String(error);
}
