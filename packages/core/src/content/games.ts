import type { GameId } from "../games/types.ts";

export interface GameContent {
  title: string;
  icon: string;
  tagline: string;
  rules: string[];
  /** 1 = 기본, 2 = 추가, 3 = 특별 테이블. Only used for ordering. */
  tier: 1 | 2 | 3;
}

export const GAME_CONTENT: Readonly<Record<GameId, GameContent>> = {
  "odd-even": {
    title: "홀짝", icon: "🎲", tier: 1, tagline: "주사위 두 개의 합, 홀일까 짝일까.",
    rules: ["홀 또는 짝을 고르면 딜러가 주사위 두 개를 굴립니다.", "맞히면 배당만큼 돌려받습니다."],
  },
  "high-low": {
    title: "하이로우", icon: "🃏", tier: 1, tagline: "다음 카드는 더 높을까, 낮을까.",
    rules: ["다음 카드가 지금 카드보다 높을지 낮을지 고릅니다.", "같은 숫자가 나오면 집니다.", "맞힐 때마다 배수가 오르고, 언제든 멈춰서 받을 수 있습니다."],
  },
  blackjack: {
    title: "스물하나", icon: "♠️", tier: 1, tagline: "21을 넘지 않게, 딜러보다 높게.",
    rules: ["카드를 더 받거나(히트) 멈춥니다(스탠드).", "21을 넘으면 즉시 집니다.", "딜러는 멈춘 뒤에 두 번째 카드를 받고, 17 이상이 될 때까지 받습니다.", "처음 두 장으로 21이면 '스물하나' 배당을 받습니다."],
  },
  "last-train": {
    title: "막차", icon: "🚂", tier: 1, tagline: "한 정거장만 더. 검표원만 만나지 않는다면.",
    rules: ["주사위를 굴려 정거장을 하나씩 지납니다.", "1이 나오면 검표원에게 걸려 모두 잃습니다.", "언제든 내리면 지난 정거장만큼의 배당을 받습니다.", "종점에 닿으면 자동으로 내립니다."],
  },
  roulette: {
    title: "룰렛", icon: "🎡", tier: 2, tagline: "한 번의 회전, 한 번의 선택.",
    rules: ["빨강·검정, 홀·짝, 전반·후반은 2배.", "12칸 묶음은 3배, 숫자 하나는 36배.", "0과 00은 하우스의 칸입니다."],
  },
  "dice-poker": {
    title: "주사위 포커", icon: "🎯", tier: 2, tagline: "다섯 개의 주사위로 족보를 만드세요.",
    rules: ["주사위 다섯 개를 굴리고, 남길 주사위를 골라 한 번 다시 굴립니다.", "딜러도 같은 방식으로 굴립니다.", "파이브다이스 > 포카드 > 풀하우스 > 스트레이트 > 트리플 > 투 페어 > 원 페어."],
  },
  "old-maid": {
    title: "도둑잡기", icon: "🃏", tier: 3, tagline: "마지막에 조커를 쥔 사람이 진다.",
    rules: ["딜러와 번갈아 상대 패에서 한 장씩 뽑습니다.", "같은 숫자 두 장은 버립니다.", "마지막까지 조커를 들고 있으면 집니다."],
  },
  "draw-poker": {
    title: "포커", icon: "♦️", tier: 3, tagline: "다섯 장, 한 번의 교환, 딜러와의 승부.",
    rules: ["카드 다섯 장을 받고, 남길 카드를 골라 한 번 교환합니다.", "딜러도 교환한 뒤 족보를 비교합니다."],
  },
};
