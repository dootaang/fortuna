import { XorShift32 } from "../rng.ts";
import { fill } from "../content/text.ts";
import { COINS, type CoinId } from "./coins.ts";
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

/** Who speaks for each coin's official notices. */
const OFFICE: Record<CoinId, string> = {
  FTN: "도시 공보", WHL: "휠 광장 게시판", HBT: "공지", LNH: "왕국 포고", JWN: "운표가 방", S9: "보도자료", ORB: "마더 방송", BLC: "공작가 서신", MWL: "호텔 안내",
};

const TEXT = {
  official: {
    up: ["{place}에 새 일감이 들어왔다는 공고가 붙었다.", "{place} 창고가 예정보다 일찍 채워졌다.", "{place}의 통행 제한이 오늘부로 풀린다.", "{place}의 묵은 빚 하나가 정리되었다."],
    down: ["{place} 정기 수송이 하루 늦어진다.", "{place} 금고 점검으로 지급이 잠시 멈춘다.", "{place}에 새 세금이 붙는다.", "{place}의 보수 공사가 길어진다."],
  },
  paper: {
    up: ["포르투나 석간: {place}에 큰손이 들어왔다는 소식.", "포르투나 석간: {place} 주문서가 두 배로 늘었다고.", "포르투나 석간: {place} 간부가 웃으며 회의실을 나왔다.", "포르투나 석간: {place} 거래처가 늘었다는 관계자 전언."],
    down: ["포르투나 석간: {place} 창고에 물이 샜다는 소식.", "포르투나 석간: {place} 거래처 하나가 발을 뺐다고.", "포르투나 석간: {place} 간부들이 밤늦게까지 불을 켜 두었다.", "포르투나 석간: {place} 주문 취소가 이어진다는 관계자 전언."],
    confirm: ["포르투나 석간 후속: {place} 소식, 사실로 확인.", "포르투나 석간 후속: {place} 관계자가 보도 내용을 인정했다."],
    fix: ["포르투나 석간 정정 보도: 앞서 낸 {place} 기사는 사실과 다릅니다.", "포르투나 석간 정정: {place} 관련 보도를 바로잡습니다. 독자께 사과드립니다."],
  },
  rumor: {
    up: ["{place} 골목에서 좋은 말이 돈다. 누가 처음 했는지는 모른다.", "{place} 술집 구석에서 들은 이야기: 곧 돈이 풀린다더라.", "{place} 짐꾼들이 오늘따라 발걸음이 가볍다.", "{place}에 누가 금화 자루를 들고 들어가는 걸 봤다는 말."],
    down: ["{place} 골목에서 나쁜 말이 돈다. 누가 처음 했는지는 모른다.", "{place} 술집 구석에서 들은 이야기: 곧 장부가 비어 보일 거라더라.", "{place} 상인들이 오늘따라 셔터를 일찍 내린다.", "{place}에서 누가 빈 상자를 몰래 내가는 걸 봤다는 말."],
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
  const label = `[${source === "official" ? OFFICE[coin] : SOURCE_LABEL[source]}]`;
  if (source === "official") {
    const follow = Math.min(0.1 * size, MAX_FOLLOW);
    return {
      move: ln(1 + dir * size), lasting: ln(1 + dir * size), pending: null, drift: { perHour: (dir * follow) / 2, until: atMs + 2 * 3_600_000 },
      feed: [{ kind: "autoOfficial", coin, tone: tone(dir), text: `${label} ${say(coin, TEXT.official[tone(dir)], rng)}`, ...(big ? { big: true } : {}) }],
    };
  }
  if (source === "paper") {
    const at = atMs + (30 + Math.floor(rng.next() * 61)) * 60_000;
    return {
      move: ln(1 + dir * size * 0.8), lasting: ln(1 + dir * size * 0.8), pending: { source, dir, size, truth, at }, drift: null,
      feed: [{ kind: "autoPaper", coin, tone: tone(dir), text: `${label} ${say(coin, TEXT.paper[tone(dir)], rng)}`, ...(big ? { big: true } : {}) }],
    };
  }
  return {
    move: ln(1 + dir * size * 0.6), lasting: ln(1 + dir * size * 0.6), pending: { source, dir, size, truth, at: atMs + 10 * 60_000 }, drift: null,
    feed: [{ kind: "autoRumor", coin, tone: tone(dir), text: `${label} ${say(coin, TEXT.rumor[tone(dir)], rng)}` }],
  };
}

/** The news factor on the anchor fades back to 1 with this time constant (about two days' half-life). */
export const NEWS_FACTOR_HOURS = 72;

export function newsSeed(tickSeed: number, coinIndex: number): number { return (tickSeed ^ Math.imul(0x27d4eb2d, coinIndex + 1)) >>> 0; }
