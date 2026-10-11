/**
 * Usage limits reset at 00:00 KST, every day or every Monday (config.limitPeriod).
 * The Unix epoch fell on a Thursday, so shifting by +9h (KST) and -4 days aligns
 * week 0 to a Monday. firestore.rules repeats these formulas; keep them in sync.
 */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const MONDAY_ALIGN_MS = 4 * DAY_MS;
export const WEEK_MS = 7 * DAY_MS;

export type LimitPeriod = "day" | "week";

export function weekIndexAt(epochMs: number): number { return Math.floor((epochMs + KST_OFFSET_MS - MONDAY_ALIGN_MS) / WEEK_MS); }
export function dayIndexAt(epochMs: number): number { return Math.floor((epochMs + KST_OFFSET_MS) / DAY_MS); }
export function periodIndexAt(epochMs: number, period: LimitPeriod): number { return period === "week" ? weekIndexAt(epochMs) : dayIndexAt(epochMs); }

/** UTC epoch ms of the Monday 00:00 KST that starts `weekIndex`. */
export function weekStartMs(weekIndex: number): number { return weekIndex * WEEK_MS + MONDAY_ALIGN_MS - KST_OFFSET_MS; }
/** UTC epoch ms of 00:00 KST starting the given period. */
export function periodStartMs(index: number, period: LimitPeriod): number { return period === "week" ? weekStartMs(index) : index * DAY_MS - KST_OFFSET_MS; }

/** "오늘" / "이번 주" and when it refills, for player-facing copy. */
export function periodWords(period: LimitPeriod): { now: string; reset: string } {
  return period === "week" ? { now: "이번 주", reset: "월요일 0시" } : { now: "오늘", reset: "매일 0시" };
}

export interface UsageCounters { periodIndex: number; workUsed: number; gambleUsed: number; }

/** Uses spent in the period containing `nowMs`; a stale period counts as fresh. */
export function usedInPeriod(counters: UsageCounters, kind: "work" | "gamble", nowMs: number, period: LimitPeriod): number {
  if (counters.periodIndex !== periodIndexAt(nowMs, period)) return 0;
  return kind === "work" ? counters.workUsed : counters.gambleUsed;
}

/** Counter state after one more use, mirroring firestore.rules. */
export function bumpCounters(counters: UsageCounters, kind: "work" | "gamble", periodIndex: number): UsageCounters {
  const fresh = counters.periodIndex !== periodIndex;
  return {
    periodIndex,
    workUsed: (fresh ? 0 : counters.workUsed) + (kind === "work" ? 1 : 0),
    gambleUsed: (fresh ? 0 : counters.gambleUsed) + (kind === "gamble" ? 1 : 0),
  };
}
