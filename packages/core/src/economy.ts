import type { EconomyConfig } from "./config.ts";

export const BPS = 10_000;

/** Map a 0..1 performance to a wage on the configured step grid. */
export function wageFor(performance: number, work: EconomyConfig["work"]): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(performance) ? performance : 0));
  const raw = work.wageMin + (work.wageMax - work.wageMin) * clamped;
  const stepped = work.wageMin + Math.round((raw - work.wageMin) / work.wageStep) * work.wageStep;
  return Math.min(work.wageMax, Math.max(work.wageMin, stepped));
}

/** 지배인 몫. firestore.rules: deduction == gross * bps / 10000 floored. */
export function deductionFor(gross: number, deductionBps: number): number { return Math.floor((gross * deductionBps) / BPS); }

export interface WageSlip { gross: number; deductionBps: number; deduction: number; net: number; }
export function wageSlip(gross: number, district: { liberated: boolean; deductionBps: number }): WageSlip {
  const deductionBps = district.liberated ? 0 : district.deductionBps, deduction = deductionFor(gross, deductionBps);
  return { gross, deductionBps, deduction, net: gross - deduction };
}

/**
 * Cost of using a skill rated `base` at `used` points: every level from base
 * up to used is paid (4 → 6 = 300 + 1,000 + 3,000).
 */
export function skillCost(base: number, used: number, cumulative: readonly number[]): number {
  if (!Number.isInteger(base) || !Number.isInteger(used) || base < 1 || used < base) throw new Error("skill_level_invalid");
  const top = cumulative[used], below = cumulative[base - 1];
  if (top === undefined || below === undefined) throw new Error("skill_level_out_of_table");
  return top - below;
}

/** Debt recorded for borrowing `amount` from the 지배인. */
export function borrowDebt(amount: number, feeBps: number): number { return amount + Math.floor((amount * feeBps) / BPS); }

export function arrivalSlip(welcome: EconomyConfig["welcome"]): { delta: number; debtDelta: number; vaultDelta: number } {
  return { delta: welcome.loan - welcome.gateFee, debtDelta: welcome.debt, vaultDelta: welcome.gateFee };
}

export function formatCoins(value: number): string { return `${value.toLocaleString("ko-KR")}`; }
