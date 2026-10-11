import { districtContent } from "./districts.ts";
import { GAME_CONTENT } from "./games.ts";
import { fill } from "./text.ts";
import type { GameId } from "../games/types.ts";

/**
 * 디스코드 알림 문구. 플레이어가 RP로 반응할 수 있게 지배인의 말투로 쓴다.
 * 비밀 품목의 내용은 절대 넣지 않는다.
 */
export const NOTIFY_TEXT = {
  arrival: "🚉 새 승객 **{name}** 님이 {district} 구역에 내렸습니다. 기차는 이미 사라졌군요. 지배인이 환영 봉투를 건넸습니다. (차용증 {debt}코인)",
  bigWin: "🎰 하우스의 {game} 테이블에서 **{name}** 님이 {net}코인을 따냈습니다. 지배인이 미소를 잃지 않으려 애쓰는군요.",
  bigLoss: "🎰 **{name}** 님이 하우스의 {game} 테이블에서 {net}코인을 잃었습니다. 지배인의 금고가 조금 더 무거워졌습니다.",
  skill: "✨ **{name}** 님이 특기 「{skill}」을(를) {used}점으로 펼쳤습니다. 값은 {cost}코인.{borrowed}{note}",
  skillBorrowed: " (그중 {amount}코인은 지배인에게 빌렸습니다)",
  shop: "🛍️ **{name}** 님이 상점에서 「{item}」을(를) 샀습니다.",
  fundFilled: "🏮 모금함 「{title}」이 가득 찼습니다! 마지막 {amount}코인은 **{name}** 님이 보탰습니다.",
  repaid: "📜 **{name}** 님이 지배인에게 진 빚을 모두 갚았습니다. 지배인은 정중히 고개를 숙였습니다.",
  liberation: "🔓 **{district}** 구역이 해방되었습니다! 이제 이 구역 주민의 임금에서 지배인 몫이 떼이지 않습니다.",
  houseOpen: "♛ 하우스의 금빛 문이 열렸습니다. 지배인이 정중히 손님들을 기다립니다. 행운이 함께하기를.",
  pvpOpen: "🃏 **{name}** 님이 {venue}에 도둑잡기 판을 열었습니다. 판돈 {stake}코인 · 1등이 전부 가져갑니다.",
  pvpWin: "👑 **{name}** 님이 도둑잡기 판에서 {amount}코인을 쓸어 담았습니다."
} as const;

export interface NotifyInput {
  kind: string;
  playerName: string;
  districtId: string;
  /** Ledger entry detail for player events. */
  detail: Record<string, unknown>;
  /** Admin event payload. */
  payload: Record<string, unknown>;
  /** Coins moved by the ledger entry, when the line needs it. */
  delta?: number;
}

const n = (value: unknown) => (typeof value === "number" ? value : Number(value) || 0);
const s = (value: unknown) => (typeof value === "string" ? value : "");

/** The Discord line for an event, or null when it should not be posted. */
export function formatNotification(input: NotifyInput, bigGamble: number): string | null {
  const { detail, payload } = input, name = input.playerName;
  switch (input.kind) {
    case "arrival": return fill(NOTIFY_TEXT.arrival, { name, district: districtContent(input.districtId).name, debt: n(detail.debt) });
    case "bigGamble": {
      const net = n(detail.payout) - n(detail.bet);
      if (Math.abs(net) < bigGamble) return null;
      const game = GAME_CONTENT[s(detail.game) as GameId]?.title ?? s(detail.game);
      return fill(net > 0 ? NOTIFY_TEXT.bigWin : NOTIFY_TEXT.bigLoss, { name, game, net: Math.abs(net) });
    }
    case "skill": return fill(NOTIFY_TEXT.skill, {
      name, skill: s(detail.skillName), used: n(detail.usedLevel), cost: n(detail.cost),
      borrowed: n(detail.borrowed) > 0 ? fill(NOTIFY_TEXT.skillBorrowed, { amount: n(detail.borrowed) }) : "",
      note: s(detail.note) ? `\n> ${s(detail.note)}` : "",
    });
    case "shop": return fill(NOTIFY_TEXT.shop, { name, item: s(detail.itemName) });
    case "fundFilled": return fill(NOTIFY_TEXT.fundFilled, { name, title: s(detail.title), amount: n(detail.amount) });
    case "repaid": return fill(NOTIFY_TEXT.repaid, { name });
    case "liberation": return fill(NOTIFY_TEXT.liberation, { district: districtContent(s(payload.districtId)).name });
    case "houseOpen": return NOTIFY_TEXT.houseOpen;
    case "pvpOpen": return fill(NOTIFY_TEXT.pvpOpen, { name, venue: s(detail.venue) === "house" ? "하우스" : "뒷골목", stake: n(detail.stake) });
    case "pvpWin": return fill(NOTIFY_TEXT.pvpWin, { name, amount: n(input.delta) });
    default: return null;
  }
}
