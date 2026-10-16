import { XorShift32 } from "../rng.ts";
import { DAY_MS, WEEK_MS, weekIndexAt, weekStartMs } from "../week.ts";
import { COIN_IDS, COINS, type CoinId } from "./coins.ts";
import type { FeedItem } from "./feed.ts";

/**
 * 거래소 2부 2단계 (docs/SPEC-MARKET-DEPTH.md 4·5-1절): weekly district earnings, the hints before them,
 * analyst reports, the manager's rate decisions and the week's calendar. Secret parts come from seeds
 * only the price recorder can compute; everything else here is public arithmetic.
 */
const HOUR_MS = 3_600_000;

/** Day of the week (0 = Monday) each coin reports, at 21:00 KST. */
export const EARNINGS_DAY: Readonly<Record<CoinId, number>> = { HBT: 0, ORB: 0, S9: 1, LNH: 2, JWN: 3, BLC: 4, MWL: 4, WHL: 5, FTN: 6 };
export const EARNINGS_HOUR_KST = 21;
/** Reports come out the next day at noon. */
export const REPORT_DELAY_MS = 15 * HOUR_MS;

export function earningsAt(coin: CoinId, week: number): number {
  return weekStartMs(week) + EARNINGS_DAY[coin] * DAY_MS + EARNINGS_HOUR_KST * HOUR_MS;
}

/** The next announcement at or after `ms`. */
export function nextEarnings(coin: CoinId, ms: number): number {
  const week = weekIndexAt(ms), t = earningsAt(coin, week);
  return t >= ms ? t : earningsAt(coin, week + 1);
}

export function reportAt(coin: CoinId, week: number): number { return earningsAt(coin, week) + REPORT_DELAY_MS; }

function normal(rng: XorShift32): number {
  const u = Math.max(rng.next(), 1e-12), v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const round3 = (value: number) => Math.round(value * 1_000) / 1_000;

/** Seed keys the recorder signs: the residents' (NPC) surprise of a week, and the day's noise on its hint. */
export function earningsSeedKey(coin: CoinId, week: number): string { return `earn:${coin}:${week}`; }
export function moodSeedKey(coin: CoinId, week: number, day: number): string { return `mood:${coin}:${week}:${day}`; }

/** NPC residents' share of the surprise: mean 0, sd 0.12, kept within ±3 sd. */
export function npcSurprise(seed: number): number { return round3(clamp(normal(new XorShift32(seed)) * 0.12, -0.36, 0.36)); }

/**
 * 업계 분위기: the NPC surprise seen through noise that narrows as the announcement nears
 * (sd 0.20 at the start of the week, 0.10 right before).
 */
export function moodHint(sNpc: number, noiseSeed: number, coin: CoinId, atMs: number): number {
  const week = weekIndexAt(atMs), start = weekStartMs(week), end = earningsAt(coin, week);
  const progress = end > start ? clamp((atMs - start) / (end - start), 0, 1) : 1;
  const sd = 0.2 - 0.1 * progress;
  return round3(sNpc + normal(new XorShift32(noiseSeed)) * sd);
}

/** One player's ordinary week, the yardstick of resident activity. */
export const NORMAL_WEEK = { work: 35, repay: 300, skill: 2 } as const;

export interface ResidentActivity { work: number; repay: number; skill: number; residents: number; }

/** A ÷ A₀: residents' activity this week against an ordinary week (1 = ordinary). Null without residents. */
export function activityRatio(input: ResidentActivity): number | null {
  if (input.residents <= 0) return null;
  const a = 0.55 * (input.work / NORMAL_WEEK.work) + 0.25 * (input.repay / NORMAL_WEEK.repay) + 0.2 * (input.skill / NORMAL_WEEK.skill);
  return round3(a / input.residents);
}

/** Players' share of the surprise: ±6% at most, so no single player decides the result. */
export function playerShare(ratio: number | null): number { return ratio === null ? 0 : round3(clamp(0.06 * (ratio - 1), -0.06, 0.06)); }

/** WHL: the tables' heat stands in for its residents (heatF 0.95–1.10). */
export function heatShare(heatF: number): number { return round3(clamp(0.06 * ((heatF - 1) / 0.1), -0.06, 0.06)); }

/** Price jump for a surprise `s`, before what the week already priced in. */
export function earningsJump(s: number): number { return clamp(0.5 * s, -0.12, 0.12); }
/** Half the jump the hints point to is priced in slowly during the week. */
export const PRE_BAKE = 0.5;
/** Post-earnings drift: 30% of the jump again, over the next 24 hours. */
export const PEAD = 0.3;
export const PEAD_HOURS = 24;

/** The anchor's fundamental factor after a surprise, within 0.8–1.3. */
export function nextFf(ff: number, s: number): number { return Math.round(clamp(ff * (1 + 0.25 * s), 0.8, 1.3) * 10_000) / 10_000; }

/** 실적 지수 (100 = as expected). */
export function earningsIndex(s: number): number { return Math.round(100 * (1 + s)); }

/** 예상치: the average of the last four results (as surprises; 0 when there is no history). */
export function consensus(history: readonly number[] | undefined): number {
  const last = (history ?? []).slice(-4);
  return last.length ? round3(last.reduce((sum, value) => sum + value, 0) / last.length) : 0;
}

// ── 피드 문구: 구역의 목소리 (짧게, 사물로) ──

const EARNINGS_TEXT: Record<CoinId, { up: string; down: string; flat: string }> = {
  FTN: { up: "도시 경기 보고. 개찰구 통과 기록이 지난주보다 두껍다.", down: "도시 경기 보고. 승강장 벤치가 지난주보다 비어 있다.", flat: "도시 경기 보고. 지난주와 다를 것 없는 숫자들." },
  WHL: { up: "휠 광장 주간 정산. 분수 바닥의 동전이 평소보다 많다.", down: "휠 광장 주간 정산. 분수 바닥이 드문드문 보인다.", flat: "휠 광장 주간 정산. 동전 소리는 늘 그만큼이다." },
  HBT: { up: "[공지] 주간 공략 통계가 게시되었습니다. 클리어율이 예상을 웃돌았습니다.", down: "[공지] 주간 공략 통계가 게시되었습니다. 클리어율이 예상을 밑돌았습니다.", flat: "[공지] 주간 공략 통계가 게시되었습니다. 특이 사항 없음." },
  LNH: { up: "마왕성 서기관이 이번 주 장부를 걸었다. 예상보다 두꺼운 장부다.", down: "마왕성 서기관이 이번 주 장부를 걸었다. 몇 장이 비어 있다.", flat: "마왕성 서기관이 이번 주 장부를 걸었다. 두께는 지난주와 같다." },
  JWN: { up: "운표가 장부꾼이 주판을 내려놓았다. 이번 주 전표가 넘친다.", down: "운표가 장부꾼이 주판을 내려놓았다. 전표가 모자란다.", flat: "운표가 장부꾼이 주판을 내려놓았다. 셈이 맞는다." },
  S9: { up: "[IR] 섹터9 주간 실적: 컨센서스 상회. 주주 여러분께 감사드립니다.", down: "[IR] 섹터9 주간 실적: 컨센서스 하회. 일시적 요인으로 판단됩니다.", flat: "[IR] 섹터9 주간 실적: 컨센서스 부합." },
  ORB: { up: "마더의 주간 보고. 정거장 산소 잔량이 계획보다 넉넉해요. 걱정 마세요.", down: "마더의 주간 보고. 정거장 산소 잔량이 계획보다 조금 적어요. 걱정 마세요.", flat: "마더의 주간 보고. 모든 수치가 계획대로예요." },
  BLC: { up: "벨루체 사교 시즌 결산. 무도회장의 장미가 다 팔렸다.", down: "벨루체 사교 시즌 결산. 시든 장미가 화병에 남았다.", flat: "벨루체 사교 시즌 결산. 꽃값은 그대로다." },
  MWL: { up: "호텔 프런트의 주간 안내문. 빈방이 줄었습니다. 4층은 여전히 없습니다.", down: "호텔 프런트의 주간 안내문. 빈방이 늘었습니다. 4층은 여전히 없습니다.", flat: "호텔 프런트의 주간 안내문. 숙박 현황 변동 없음." },
};

export function earningsFeed(coin: CoinId, surprise: number): FeedItem {
  const tone = surprise > 0.02 ? "up" : surprise < -0.02 ? "down" : "info";
  const text = EARNINGS_TEXT[coin][tone === "up" ? "up" : tone === "down" ? "down" : "flat"];
  return { kind: "earnings", coin, tone, text: `${text} (실적 지수 ${earningsIndex(surprise)})` };
}

// ── 애널리스트 리포트 (4-4) ──

export interface Analyst {
  name: string;
  /** Fixed bias on the fair value. */
  bias: number;
  /** Error sd. */
  error: number;
  /** Half width of the band. */
  band: number;
  /** Special habits. */
  habit?: "trend" | "contrary" | "wild";
}

/** Who writes about what. Biases are never shown; players learn them from the hit record. */
export const ANALYSTS: Readonly<Record<CoinId, Analyst | null>> = {
  HBT: { name: "탑의 공략 게시판", bias: 0, error: 0.03, band: 0.1 },
  S9: { name: "회장실 IR 담당", bias: 0.08, error: 0.03, band: 0.05 },
  LNH: { name: "마왕성 서기관", bias: 0, error: 0.015, band: 0.05 },
  JWN: { name: "운표가 장부꾼", bias: 0, error: 0.03, band: 0.05, habit: "trend" },
  ORB: { name: "마더", bias: -0.03, error: 0.02, band: 0.05 },
  BLC: { name: "공작부인의 시녀", bias: 0, error: 0.025, band: 0.05, habit: "contrary" },
  MWL: { name: "호텔 프런트", bias: 0, error: 0.015, band: 0.05, habit: "wild" },
  WHL: { name: "역 전광판", bias: 0, error: 0.04, band: 0.05 },
  FTN: null,
};

export function reportSeedKey(coin: CoinId, week: number): string { return `report:${coin}:${week}`; }

export interface ReportBand { low: number; mid: number; high: number; }

/**
 * A fair-value band in cents. `anchor` is the coin's real (hidden) anchor; `trend` is last hour's log return.
 */
export function analystBand(coin: CoinId, anchor: number, price: number, trend: number, seed: number): ReportBand | null {
  const analyst = ANALYSTS[coin];
  if (!analyst) return null;
  const rng = new XorShift32(seed);
  let mid = anchor * (1 + analyst.bias + normal(rng) * analyst.error);
  if (analyst.habit === "trend") mid *= 1 + clamp(trend * 3, -0.1, 0.1);
  if (analyst.habit === "contrary" && rng.next() < 1 / 3) mid = 2 * price - mid;
  if (analyst.habit === "wild" && rng.next() < 0.15) mid *= 1 + (rng.next() < 0.5 ? -1 : 1) * (0.2 + rng.next() * 0.15);
  mid = Math.max(1, Math.round(mid));
  return { low: Math.round(mid * (1 - analyst.band)), mid, high: Math.round(mid * (1 + analyst.band)) };
}

// ── 지배인 금리 결정 (4-5) ──

/** Price factor when interest moves by `deltaBps`: −2% on FTN per +5bp, alts 1.3×, within ±30%. */
export function rateShock(coin: CoinId, deltaBps: number): number {
  const ftn = -0.02 * (deltaBps / 5);
  return clamp(1 + (coin === "FTN" ? ftn : ftn * 1.3), 0.7, 1.3);
}

export function rateFeed(fromBps: number, toBps: number): FeedItem {
  const up = toBps > fromBps;
  return {
    kind: "rate", coin: null, tone: toBps === fromBps ? "info" : up ? "down" : "up",
    text: toBps === fromBps
      ? `지배인 금리 결정: 시간당 ${(toBps / 100).toFixed(2)}% 동결.`
      : `지배인 금리 결정: 시간당 ${(fromBps / 100).toFixed(2)}% → ${(toBps / 100).toFixed(2)}%. 금고 문이 ${up ? "조금 더 무거워졌다" : "조금 가벼워졌다"}.`,
  };
}

// ── 경제 캘린더 (5-1) ──

export interface CalendarItem {
  /** When, or null for "sometime this week" (S9 약관 개정). */
  atMs: number | null;
  coin: CoinId | null;
  kind: "earnings" | "report" | "rate" | "rent" | "tribute" | "fee" | "night" | "terms";
  text: string;
}

/** The week's schedule, from public rules plus the dealer's announced rate decisions. */
export function weekCalendar(week: number, rates: readonly { atMs: number; bps: number }[] = []): CalendarItem[] {
  const start = weekStartMs(week), end = start + WEEK_MS;
  const items: CalendarItem[] = [];
  for (const coin of COIN_IDS) {
    items.push({ atMs: earningsAt(coin, week), coin, kind: "earnings", text: coin === "FTN" ? "도시 경기 보고 (FTN)" : `${COINS[coin].place} 실적 발표` });
    if (ANALYSTS[coin] && reportAt(coin, week) < end) items.push({ atMs: reportAt(coin, week), coin, kind: "report", text: `${ANALYSTS[coin]!.name} 리포트` });
  }
  items.push({ atMs: start + 6 * DAY_MS + 21 * HOUR_MS, coin: "LNH", kind: "rent", text: "로엔하임 임대료 납부일" });
  for (let day = 0; day < 7; day += 1) {
    const dayStart = start + day * DAY_MS, date = new Date(dayStart + 9 * HOUR_MS).getUTCDate();
    if (date === 15) items.push({ atMs: dayStart, coin: "JWN", kind: "tribute", text: "중원 보름 상납금" });
  }
  items.push({ atMs: null, coin: "HBT", kind: "fee", text: "한빛특구 일일 입장료 (매일 09시)" });
  items.push({ atMs: null, coin: "MWL", kind: "night", text: "무월리의 밤 (매일 0~5시, 청산 수수료 2배)" });
  items.push({ atMs: null, coin: "S9", kind: "terms", text: "섹터9 약관 개정 (이번 주 어느 때)" });
  for (const rate of rates) if (rate.atMs >= start && rate.atMs < end) items.push({ atMs: rate.atMs, coin: "FTN", kind: "rate", text: `지배인 금리 결정 (시간당 ${(rate.bps / 100).toFixed(2)}% 예정)` });
  return items.sort((a, b) => (a.atMs ?? Number.POSITIVE_INFINITY) - (b.atMs ?? Number.POSITIVE_INFINITY));
}

/** 업계 분위기 in words (the number is only a blurred clue). */
export function moodWords(mood: number): string {
  return mood > 0.15 ? "아주 좋다는 말이 돈다" : mood > 0.05 ? "좋다는 말이 돈다" : mood >= -0.05 ? "별말이 없다" : mood >= -0.15 ? "나쁘다는 말이 돈다" : "아주 나쁘다는 말이 돈다";
}

/** The secret earnings inputs for a tick at `atMs`; `sign` turns a seed key into the recorder's HMAC seed. */
export function fundamentalsInput(sign: (key: string) => number, atMs: number): { sNpc: Record<CoinId, number>; mood: Record<CoinId, number> } {
  const week = weekIndexAt(atMs), day = Math.floor((atMs + 9 * HOUR_MS) / DAY_MS);
  const sNpc = {} as Record<CoinId, number>, mood = {} as Record<CoinId, number>;
  for (const coin of COIN_IDS) {
    sNpc[coin] = npcSurprise(sign(earningsSeedKey(coin, week)));
    mood[coin] = moodHint(sNpc[coin], sign(moodSeedKey(coin, week, day)), coin, atMs);
  }
  return { sNpc, mood };
}

/** market/fundamentals, written by the recorder every ten minutes. */
export interface FundamentalsDoc<T = unknown> {
  at: T;
  week: number;
  coins: Record<CoinId, { mood: number; ratio: number | null; residents: number; spc: number }>;
  /** Why resident activity could not be counted (the dealer sees it). */
  error?: string | null;
}

/** marketReports/{week}_{coin} */
export interface ReportDoc<T = unknown> {
  coin: CoinId;
  week: number;
  writer: string;
  low: number;
  mid: number;
  high: number;
  /** Price when the report came out. */
  price: number;
  at: T;
  /** The previous band, scored against this report's price. */
  prev: { low: number; high: number; price: number; hit: boolean } | null;
}

/** marketEvents/{id}: a rate decision announced by the dealer. */
export interface RateEventDoc<T = unknown> { kind: "rate"; bps: number; at: T; status: "pending" | "done" | "cancelled"; appliedSeq: number | null; }
