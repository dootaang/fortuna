import { XorShift32 } from "../rng.ts";
import { COINS, type CoinId } from "./coins.ts";

/**
 * 거래소 2부 7단계 정보 구매 (docs/SPEC-MARKET-DEPTH.md 5-3): probabilistic hints only, never a seed or a next-tick value.
 * Sold on the market info page (the shop is off in this city). The recorder answers within about a minute.
 */
export type InfoKind = "rumor" | "peek";

export const INFO_PRODUCTS: Readonly<Record<InfoKind, { name: string; accuracy: number; blurb: string }>> = {
  rumor: { name: "소문 감정서", accuracy: 0.75, blurb: "지금 이 종목에 도는 골목 소문이 진짜인지 감정한다. 넷 중 셋은 맞는다." },
  peek: { name: "장부 엿보기", accuracy: 0.7, blurb: "다음 실적 발표가 예상을 웃돌지 밑돌지 엿본다. 열 번 중 일곱 번은 맞는다." },
};

/** infoRequests/{ledgerId} */
export interface InfoRequest<T = unknown> {
  playerId: string;
  kind: InfoKind;
  coin: CoinId;
  status: "pending" | "answered";
  answer: string | null;
  createdAt: T;
  answeredAt: T | null;
}

/** The answer text: `truth` is the real outcome (null when there is nothing to tell). */
export function infoAnswer(kind: InfoKind, coin: CoinId, truth: boolean | null, seed: number): string {
  const place = COINS[coin].place;
  if (truth === null) return kind === "rumor" ? `${place} 골목에 지금 감정할 소문이 없다. 감정사가 어깨를 으쓱한다.` : `${place} 장부는 아직 아무도 펼쳐 보지 못했다.`;
  const right = new XorShift32(seed).next() < INFO_PRODUCTS[kind].accuracy;
  const says = right ? truth : !truth;
  if (kind === "rumor") return says ? `감정 결과: ${place}의 그 소문, 진짜 같다.` : `감정 결과: ${place}의 그 소문, 헛소리 같다.`;
  return says ? `${place}의 다음 장부는 두꺼워 보인다 (예상 상회 쪽).` : `${place}의 다음 장부는 얇아 보인다 (예상 하회 쪽).`;
}

export function infoSeedKey(requestId: string): string { return `info:${requestId}`; }
