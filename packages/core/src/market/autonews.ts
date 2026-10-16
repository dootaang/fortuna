import { XorShift32 } from "../rng.ts";
import { fill } from "../content/text.ts";
import { COINS, type CoinId } from "./coins.ts";
import { COIN_NEWS } from "./autonews-text.ts";
import type { FeedItem } from "./feed.ts";

/**
 * 거래소 2부 3단계 (docs/SPEC-MARKET-DEPTH.md 5-2): automatic news with three grades of credibility.
 * Calibrated so no simple rule beats the house (원칙 4): what a story is worth is priced in at once by its
 * odds, and the rest arrives when it resolves — so following or fading the news is a coin flip after fees.
 *
 * - 공식 공지 (20%): always true. Jumps fully; a small follow-through after (≤0.4% over 2 h).
 * - 신문 (40%): true 80%. Jumps 80% of the way; 30–90 min later a follow-up adds the rest, or a correction takes it back.
 * - 골목 소문 (40%): true 60%. Moves 60% of the way; 10 min later it comes true (with a brief overshoot that fades
 *   within the hour) or dies down and the price falls back.
 */
export type NewsSource = "official" | "paper" | "rumor";

export const AUTO_NEWS_PER_DAY = 3;
export const AUTO_NEWS_SIZES = [{ size: 0.03, weight: 6, word: "소" }, { size: 0.07, weight: 3, word: "중" }, { size: 0.15, weight: 1, word: "대" }] as const;
const SOURCES: readonly { source: NewsSource; weight: number; truth: number }[] = [
  { source: "official", weight: 2, truth: 1 }, { source: "paper", weight: 4, truth: 0.8 }, { source: "rumor", weight: 4, truth: 0.6 },
];

/** A story waiting to resolve. */
export interface PendingNews {
  source: NewsSource;
  dir: 1 | -1;
  size: number;
  truth: boolean;
  /** When it resolves (epoch ms). */
  at: number;
}

/** Log-return drift (per hour) after a story, and until when. */
export interface NewsDrift { perHour: number; until: number; }

const SOURCE_LABEL: Record<NewsSource, string> = { official: "공식", paper: "신문", rumor: "소문" };

/** Follow-ups shared by every coin; the opening lines are each district's own (autonews-text.ts). */
const TEXT = {
  paper: {
    confirm: ["포르투나 석간 후속: {place} 소식, 사실로 확인.", "포르투나 석간 후속: {place} 관계자가 보도 내용을 인정했다."],
    fix: ["포르투나 석간 정정 보도: 앞서 낸 {place} 기사는 사실과 다릅니다.", "포르투나 석간 정정: {place} 관련 보도를 바로잡습니다. 독자께 사과드립니다."],
  },
  rumor: {
    true: ["소문이 맞았다. {place}이(가) 술렁인다.", "{place} 골목의 말이 사실로 드러났다."],
    fade: ["{place} 골목의 소문이 사그라들었다.", "{place}의 그 이야기, 아무도 다시 꺼내지 않는다."],
  },
} as const;

function pick<T>(rng: XorShift32, items: readonly T[]): T { return items[Math.floor(rng.next() * items.length)]!; }

function weighted<T extends { weight: number }>(rng: XorShift32, items: readonly T[]): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = rng.next() * total;
  for (const item of items) { roll -= item.weight; if (roll < 0) return item; }
  return items[items.length - 1]!;
}

const say = (coin: CoinId, lines: readonly string[], rng: XorShift32) => fill(pick(rng, lines), { place: COINS[coin].place });

export interface NewsStep {
  /** Log return to add this tick. */
  move: number;
  /** The part of `move` that is real information: the anchor moves with it (news factor), so mean reversion does not undo it. */
  lasting: number;
  pending: PendingNews | null;
  drift: NewsDrift | null;
  feed: FeedItem[];
}

const ln = (factor: number) => Math.log(factor);
const MAX_FOLLOW = 0.004;

/**
 * One coin, one tick: resolve a pending story when its time comes, otherwise maybe start a new one.
 * `hours` is the tick length; `rng` is this coin's news stream for the tick.
 */
export function stepAutoNews(coin: CoinId, pending: PendingNews | null, atMs: number, hours: number, enabled: boolean, rng: XorShift32): NewsStep {
  const tone = (dir: number) => (dir > 0 ? "up" : "down") as "up" | "down";
  if (pending && atMs >= pending.at) {
    const { source, dir, size, truth } = pending;
    if (source === "paper") {
      return truth
        ? { move: ln(1 + dir * size) - ln(1 + dir * size * 0.8), lasting: ln(1 + dir * size) - ln(1 + dir * size * 0.8), pending: null, drift: null, feed: [{ kind: "autoConfirm", coin, tone: tone(dir), text: say(coin, TEXT.paper.confirm, rng) }] }
        : { move: -ln(1 + dir * size * 0.8), lasting: -ln(1 + dir * size * 0.8), pending: null, drift: null, feed: [{ kind: "autoFix", coin, tone: tone(-dir), text: say(coin, TEXT.paper.fix, rng), ...(size >= 0.15 ? { big: true } : {}) }] };
    }
    // Rumour: comes true with a brief overshoot that fades within the hour, or dies down.
    if (truth) {
      const overshoot = Math.min(0.3 * size, 0.003);
      return {
        move: ln(1 + dir * size) - ln(1 + dir * size * 0.6) + dir * overshoot, lasting: ln(1 + dir * size) - ln(1 + dir * size * 0.6), pending: null,
        drift: { perHour: -dir * overshoot, until: atMs + 3_600_000 },
        feed: [{ kind: "autoTrue", coin, tone: tone(dir), text: say(coin, TEXT.rumor.true, rng) }],
      };
    }
    return { move: -ln(1 + dir * size * 0.6), lasting: -ln(1 + dir * size * 0.6), pending: null, drift: null, feed: [{ kind: "autoFade", coin, tone: "info", text: say(coin, TEXT.rumor.fade, rng) }] };
  }
  if (pending || !enabled || rng.next() >= (AUTO_NEWS_PER_DAY * hours) / 24) return { move: 0, lasting: 0, pending, drift: null, feed: [] };

  const { source, truth: odds } = weighted(rng, SOURCES), { size } = weighted(rng, AUTO_NEWS_SIZES);
  const dir: 1 | -1 = rng.next() < 0.5 ? 1 : -1, truth = rng.next() < odds, big = size >= 0.15;
  const label = `[${SOURCE_LABEL[source]}]`, opening = COIN_NEWS[coin][source][tone(dir)];
  if (source === "official") {
    const follow = Math.min(0.1 * size, MAX_FOLLOW);
    return {
      move: ln(1 + dir * size), lasting: ln(1 + dir * size), pending: null, drift: { perHour: (dir * follow) / 2, until: atMs + 2 * 3_600_000 },
      feed: [{ kind: "autoOfficial", coin, tone: tone(dir), text: `${label} ${say(coin, opening, rng)}`, ...(big ? { big: true } : {}) }],
    };
  }
  if (source === "paper") {
    const at = atMs + (30 + Math.floor(rng.next() * 61)) * 60_000;
    return {
      move: ln(1 + dir * size * 0.8), lasting: ln(1 + dir * size * 0.8), pending: { source, dir, size, truth, at }, drift: null,
      feed: [{ kind: "autoPaper", coin, tone: tone(dir), text: `${label} ${say(coin, opening, rng)}`, ...(big ? { big: true } : {}) }],
    };
  }
  return {
    move: ln(1 + dir * size * 0.6), lasting: ln(1 + dir * size * 0.6), pending: { source, dir, size, truth, at: atMs + 10 * 60_000 }, drift: null,
    feed: [{ kind: "autoRumor", coin, tone: tone(dir), text: `${label} ${say(coin, opening, rng)}` }],
  };
}

/** The news factor on the anchor fades back to 1 with this time constant (about two days' half-life). */
export const NEWS_FACTOR_HOURS = 72;

export function newsSeed(tickSeed: number, coinIndex: number): number { return (tickSeed ^ Math.imul(0x27d4eb2d, coinIndex + 1)) >>> 0; }
