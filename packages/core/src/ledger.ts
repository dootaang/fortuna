import type { GameId, Venue, WagerTrace } from "./games/types.ts";

/** Firestore Timestamp without importing the SDK into the pure core. */
export interface TimestampLike { toMillis(): number; }

export const LEDGER_TYPES = ["arrival", "work", "betOpen", "betSettle", "skill", "repay", "jointDeposit", "fundContribution", "shop", "itemUse", "adminAdjust"] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

export interface WagerStep<T = TimestampLike> { a: string; t: T; }

export interface OpenWager<T = TimestampLike> {
  wagerId: string;
  game: GameId;
  venue: Venue;
  bet: number;
  maxMultiplier: number;
  /** Table params frozen at open, so a mid-game config change cannot alter the replay. */
  params: unknown;
  openedAt: T;
  stepCount: number;
  /** "1".."n" → decision and the server time that sealed it (arrays cannot hold server timestamps). */
  steps: Record<string, WagerStep<T>>;
}

export function wagerTrace(wager: Pick<OpenWager, "wagerId" | "openedAt" | "stepCount" | "steps">): WagerTrace {
  const actions: string[] = [], timesMs: number[] = [];
  for (let step = 1; step <= wager.stepCount; step += 1) {
    const entry = wager.steps[String(step)];
    if (!entry) throw new Error("wager_step_missing");
    actions.push(entry.a); timesMs.push(entry.t.toMillis());
  }
  return { wagerId: wager.wagerId, openedAtMs: wager.openedAt.toMillis(), actions, timesMs };
}

/** wallets/{playerId} */
export interface Wallet<T = TimestampLike> {
  playerId: string;
  balance: number;
  debt: number;
  /** Sequence of the latest ledger entry. */
  seq: number;
  arrived: boolean;
  /** Day or week index (config.limitPeriod) the two counters belong to. */
  periodIndex: number;
  workUsed: number;
  gambleUsed: number;
  openWager: OpenWager<T> | null;
}

/** ledger/{playerId}_{seq}; append-only. */
export interface LedgerEntry<T = TimestampLike> {
  playerId: string;
  seq: number;
  type: LedgerType;
  delta: number;
  debtDelta: number;
  vaultDelta: number;
  balanceAfter: number;
  debtAfter: number;
  weekIndex: number;
  actor: "player" | "admin";
  actorUid: string;
  memo: string;
  detail: Record<string, unknown>;
  at: T;
}

export function ledgerId(playerId: string, seq: number): string { return `${playerId}_${seq}`; }

export const LEDGER_LABELS: Readonly<Record<LedgerType, string>> = {
  arrival: "도착",
  work: "일",
  betOpen: "판돈",
  betSettle: "도박 정산",
  skill: "특기 결제",
  repay: "빚 상환",
  jointDeposit: "공동 지갑",
  fundContribution: "모금함",
  shop: "상점 구매",
  itemUse: "물품 사용",
  adminAdjust: "딜러 조정",
};

/** Ledger filter groups for the admin history view. */
export const LEDGER_GROUPS: Readonly<Record<string, readonly LedgerType[]>> = {
  일: ["work"],
  도박: ["betOpen", "betSettle"],
  "특기 결제": ["skill"],
  "상점 구매": ["shop"],
  "물품 사용": ["itemUse"],
  상환: ["repay"],
  "공동·모금": ["jointDeposit", "fundContribution"],
  "관리자 조정": ["adminAdjust"],
  도착: ["arrival"],
};

export function emptyWallet(playerId: string): Wallet<never> {
  return { playerId, balance: 0, debt: 0, seq: 0, arrived: false, periodIndex: 0, workUsed: 0, gambleUsed: 0, openWager: null };
}
