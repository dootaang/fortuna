import { COINS, type CoinId } from "./coins.ts";
import { fill } from "../content/text.ts";

/**
 * 시세판 아래에 흐르는 소식. 구역의 목소리로 한 줄, 정보가 먼저.
 * 지배인은 여기서 말하지 않는다. 문체는 자료/fortuna-gm 02-style을 따른다(짧게, 사물로, 이모지 없이).
 */
export const FEED_TEXT = {
  hbtPatch: "[공지] 밸런스 패치가 적용되었습니다. HBT 변동 폭이 한 시간 동안 1.5배로 조정됩니다. 이용에 불편을 드려 죄송합니다.",
  hbtFee: "[시스템] 오전 9시. 일일 입장료가 자동 차감되었습니다. 건투를 빕니다.",
  lnhTax: "임대료 납부일. 마왕성 꼭대기 창문 하나에 밤새 불이 켜져 있다.",
  jwnTribute: "보름. 비단옷 사내가 장부를 들고 운표가의 문을 두드린다.",
  s9Terms: "서비스 약관 제14조가 개정되었습니다. 이용료는 사전 고지 없이 인상될 수 있습니다. 귀하께서는 이미 동의하셨습니다.",
  orbSaving: "제3갑판 여러분, 잠깐 절약 모드로 바꿀게요. 조금 졸릴 거예요. 위험하지는 않게 제가 보고 있을게요.",
  blcWhisperUp: "공작부인의 부채가 오늘 두 번 펼쳐졌다고 합니다. 좋은 소식이라는 쪽이 많습니다.",
  blcWhisperDown: "공작부인의 부채가 소리 없이 접혔다고 합니다. 누군가 초대장을 잃을 거라는 말이 돕니다.",
  blcReveal: "부채 뒤의 소문이 무도회장 밖으로 나왔다. BLC가 움직인다.",
  mwlNight: "자정. 무월리의 등이 하나씩 꺼진다. 지금부터 다섯 시까지 MWL 체크아웃 수수료는 두 배다.",
  mwlDawn: "새벽 다섯 시. 안개가 걷히고 호텔 회전문이 멈춘다.",
  liberation: "{place} 해방. 요금 청구서가 벽에서 떨어진다. {coin} 급등, FTN 하락.",
  houseOpen: "하우스의 금빛 문이 열렸다. 판돈로 인파가 광장까지 이어진다. 거래소 레버리지 한도가 오른다.",
} as const;

export type FeedTone = "up" | "down" | "warn" | "info";
/** `big`: a large automatic story (goes to Discord within the daily budget). */
export interface FeedItem { kind: string; coin: CoinId | null; tone: FeedTone; text: string; big?: boolean; }

export function liberationFeed(coin: CoinId): FeedItem {
  return { kind: "liberation", coin, tone: "up", text: fill(FEED_TEXT.liberation, { place: COINS[coin].place, coin }) };
}

/** News sizes the dealer can pick: the jump they cause. */
export const NEWS_SIZES = { z: 0, s: 0.03, m: 0.07, l: 0.15 } as const;
export type NewsSize = keyof typeof NEWS_SIZES;
export const NEWS_SIZE_LABELS: Readonly<Record<NewsSize, string>> = { z: "출렁임만 (점프 없음)", s: "소 (3%)", m: "중 (7%)", l: "대 (15%)" };
