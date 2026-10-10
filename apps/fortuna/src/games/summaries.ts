import { RANK_LABEL, SUIT_SYMBOL, blackjackValue, card, type GameId } from "@fortuna/core";

const cardText = (id: string) => (id === "joker" ? "조커" : `${SUIT_SYMBOL[card(id).suit]}${RANK_LABEL[card(id).rank]}`);

/** One line for the ledger and the dealer's audit view. */
export function summarize(game: GameId, state: any): string {
  switch (game) {
    case "odd-even": return `${state.pick === "odd" ? "홀" : "짝"} 선택 · ${state.dice?.join("+")}=${(state.dice?.[0] ?? 0) + (state.dice?.[1] ?? 0)}`;
    case "high-low": return `${state.streak}연속 적중 · 마지막 ${cardText(state.current)}`;
    case "blackjack": return `손님 ${blackjackValue(state.player)} (${state.player.map(cardText).join(" ")}) · 딜러 ${blackjackValue(state.dealer)} · ${state.result}`;
    case "last-train": return state.caught ? `${state.stations}번째 역에서 검표원에게 걸림` : `${state.stations}번째 역에서 하차`;
    case "roulette": return `${state.wager} 에 걸고 ${state.pocket === -1 ? "00" : state.pocket}`;
    case "dice-poker": return `손님 ${state.player.join("")} ${state.playerHand?.label} · 딜러 ${state.dealer?.join("")} ${state.dealerHand?.label}`;
    case "old-maid": return state.win ? "조커를 넘기고 승리" : "조커를 떠안음";
    case "draw-poker": return `손님 ${state.playerHand?.label} · 딜러 ${state.dealerHand?.label}`;
  }
}
