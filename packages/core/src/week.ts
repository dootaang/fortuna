/**
 * Weekly counters reset at Monday 00:00 KST. The Unix epoch fell on a
 * Thursday, so shifting by +9h (KST) and -4 days aligns week 0 to a Monday.
 * firestore.rules repeats this exact formula; keep them in sync.
 */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const MONDAY_ALIGN_MS = 4 * 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function weekIndexAt(epochMs: number): number { return Math.floor((epochMs + KST_OFFSET_MS - MONDAY_ALIGN_MS) / WEEK_MS); }

/** UTC epoch ms of the Monday 00:00 KST that starts `weekIndex`. */
export function weekStartMs(weekIndex: number): number { return weekIndex * WEEK_MS + MONDAY_ALIGN_MS - KST_OFFSET_MS; }

export interface WeeklyCounters { weekIndex: number; workUsed: number; gambleUsed: number; }

/** Uses spent in the week containing `nowMs`; a stale week counts as fresh. */
export function usedThisWeek(counters: WeeklyCounters, kind: "work" | "gamble", nowMs: number): number {
  if (counters.weekIndex !== weekIndexAt(nowMs)) return 0;
  return kind === "work" ? counters.workUsed : counters.gambleUsed;
}

/** Counter state after one more use, mirroring firestore.rules. */
export function bumpCounters(counters: WeeklyCounters, kind: "work" | "gamble", weekIndex: number): WeeklyCounters {
  const fresh = counters.weekIndex !== weekIndex;
  return {
    weekIndex,
    workUsed: (fresh ? 0 : counters.workUsed) + (kind === "work" ? 1 : 0),
    gambleUsed: (fresh ? 0 : counters.gambleUsed) + (kind === "gamble" ? 1 : 0),
  };
}
