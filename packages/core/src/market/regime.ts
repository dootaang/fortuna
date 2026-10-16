import { XorShift32 } from "../rng.ts";
import { COIN_IDS, type CoinId } from "./coins.ts";

/**
 * 거래소 2부 4단계 (docs/SPEC-MARKET-DEPTH.md 3-1): one hidden regime over the whole city.
 * Never written to the public tick; players infer it from fear & greed and how the coins move together.
 * Drifts are below the cost of holding (fees 10bp × 2 + interest 20bp an hour), so even a player who
 * always knew the regime would not beat 103% (원칙 4, tested).
 */
export const REGIMES = ["sideways", "bull", "bear", "fear", "altseason"] as const;
export type RegimeKind = (typeof REGIMES)[number];

export interface RegimeDef {
  label: string;
  /** Mean duration, hours. */
  hours: number;
  /** FTN drift per hour (log). Alts get it through their coupling. */
  ftnDrift: number;
  /** Alt coupling to FTN from the coin's own beta. */
  beta: (beta: number) => number;
  /** Multiplier on the alt's own noise. */
  ownVol: number;
}

export const REGIME: Readonly<Record<RegimeKind, RegimeDef>> = {
  sideways: { label: "횡보", hours: 6, ftnDrift: 0, beta: (beta) => beta, ownVol: 1 },
  bull: { label: "상승장", hours: 4, ftnDrift: 0.002, beta: (beta) => beta, ownVol: 1 },
  // Bear is gentler than bull because panics (fear) also fall: over time the drifts net to zero, so the pull
  // back to the anchor does not hand the bull side a free edge.
  bear: { label: "하락장", hours: 4, ftnDrift: -0.0013, beta: (beta) => Math.min(0.9, beta * 1.3), ownVol: 1.2 },
  fear: { label: "공포", hours: 40 / 60, ftnDrift: -0.006, beta: (beta) => 1 - (1 - beta) * 0.2, ownVol: 1.5 },
  altseason: { label: "알트 시즌", hours: 3, ftnDrift: 0, beta: (beta) => beta * 0.3, ownVol: 1.6 },
};

/** Next regime given the current one (rows sum to 1). */
const NEXT: Readonly<Record<RegimeKind, readonly [RegimeKind, number][]>> = {
  sideways: [["bull", 0.35], ["bear", 0.35], ["fear", 0.1], ["altseason", 0.2]],
  bull: [["sideways", 0.5], ["bear", 0.15], ["fear", 0.1], ["altseason", 0.25]],
  bear: [["sideways", 0.5], ["bull", 0.2], ["fear", 0.25], ["altseason", 0.05]],
  fear: [["sideways", 0.3], ["bull", 0.3], ["bear", 0.4]],
  altseason: [["sideways", 0.5], ["bull", 0.2], ["bear", 0.2], ["fear", 0.1]],
};

/** ORB is the shelter in a panic. */
export const FEAR_SHELTER: CoinId = "ORB";
export const FEAR_SHELTER_DRIFT = 0.004;
/** Each alt's drift in an alt season, its direction drawn when the season starts. */
export const ALTSEASON_DRIFT = 0.0025;

export interface Regime {
  kind: RegimeKind;
  since: number;
  /** A dealer-forced regime holds until then (epoch ms); 0 = natural. */
  forcedUntil: number;
  /** Alt season directions. */
  dirs?: Partial<Record<CoinId, 1 | -1>> | undefined;
}

export function initialRegime(atMs: number): Regime { return { kind: "sideways", since: atMs, forcedUntil: 0 }; }

function enter(kind: RegimeKind, atMs: number, rng: XorShift32, forcedUntil = 0): Regime {
  const regime: Regime = { kind, since: atMs, forcedUntil };
  if (kind === "altseason") regime.dirs = Object.fromEntries(COIN_IDS.filter((id) => id !== "FTN").map((id) => [id, rng.next() < 0.5 ? 1 : -1]));
  return regime;
}

/** One tick: a dealer order starts a forced regime; otherwise the regime may end and hand over. */
export function stepRegime(current: Regime, atMs: number, hours: number, rng: XorShift32, order?: { kind: RegimeKind; minutes: number } | undefined): Regime {
  if (order) return enter(order.kind, atMs, rng, atMs + order.minutes * 60_000);
  if (current.forcedUntil) return atMs < current.forcedUntil ? current : enter("sideways", atMs, rng);
  if (rng.next() >= hours / REGIME[current.kind].hours) return current;
  let roll = rng.next();
  for (const [kind, p] of NEXT[current.kind]) { roll -= p; if (roll < 0) return enter(kind, atMs, rng); }
  return enter("sideways", atMs, rng);
}

/** Per-hour drift the regime gives a coin, and its coupling/own-noise adjustments. */
export function regimeEffect(regime: Regime | undefined, coin: CoinId, beta: number): { drift: number; beta: number; ownVol: number } {
  if (!regime) return { drift: 0, beta, ownVol: 1 };
  const def = REGIME[regime.kind];
  if (coin === "FTN") return { drift: def.ftnDrift, beta: 1, ownVol: 1 };
  const coupled = def.beta(beta);
  let drift = coupled * def.ftnDrift;
  if (regime.kind === "fear" && coin === FEAR_SHELTER) drift = FEAR_SHELTER_DRIFT;
  if (regime.kind === "altseason") drift += (regime.dirs?.[coin] ?? 0) * ALTSEASON_DRIFT;
  return { drift, beta: coupled, ownVol: def.ownVol };
}

/** What the street feels when the dealer starts a regime (never names it). */
export const REGIME_ORDER_TEXT: Readonly<Record<RegimeKind, string | null>> = {
  sideways: null,
  bull: "광장 분위기가 들뜬다. 환전가 창구 앞 줄이 길어진다.",
  bear: "광장이 조용히 가라앉는다. 환전가 셔터가 반쯤 내려와 있다.",
  fear: "광장에 불안한 웅성거림이 번진다. 누군가 환전가 창구로 뛰어간다.",
  altseason: "구역 상인들이 저마다 바쁘다. FTN 전광판을 보는 사람이 없다.",
};

export function regimeSeed(tickSeed: number): number { return (tickSeed ^ 0x6c8e9cf5) >>> 0; }

export function isRegimeKind(value: unknown): value is RegimeKind { return typeof value === "string" && (REGIMES as readonly string[]).includes(value); }
