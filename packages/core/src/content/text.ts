/**
 * 앱 문구. 안내는 담백하게 쓰고, 지배인의 목소리는 도착 편지와 디스코드 알림에만 둔다.
 * {name} {district} {amount} 같은 자리표시자는 `fill`이 채운다.
 */
export const TEXT = {
  greeting: "행운이 함께하기를.",
  city: "종점도시 포르투나",
  manager: "지배인",
  dealer: "딜러",

  gate: {
    title: "개찰구",
    prompt: "접속 코드를 입력하세요.",
    hint: "딜러에게 받은 코드입니다. 기기를 바꿔도 같은 코드로 다시 들어올 수 있습니다.",
    submit: "개찰구 통과",
    invalid: "등록되지 않은 접속 코드입니다. 다시 확인해 주세요.",
    revoked: "만료된 접속 코드입니다. 딜러에게 새 코드를 받으세요.",
  },

  arrival: {
    letterTitle: "지배인의 편지",
    letter: [
      "{name} 님, 포르투나에 오신 것을 진심으로 환영합니다.",
      "타고 오신 기차는 방금 사라졌습니다. 이 역에서 나가는 기차는 없습니다. 놀라셨겠지만, 곧 익숙해지실 겁니다.",
      "{district} 구역에 거처를 마련해 두었습니다. 새 출발에는 언제나 비용이 드는 법이지요.",
      "약소하나마 환영 봉투를 준비했습니다. 갚으실 날은 서두르지 않으셔도 됩니다. 저는 기다리는 일에 꽤 능숙하거든요.",
    ],
    sign: "— 포르투나의 지배인",
    envelope: "환영 봉투",
    envelopeLine: "환영 봉투",
    debtLine: "상환 금액 {amount}코인",
    gateLine: "개찰구 요금",
    startLine: "시작 잔액 {amount}코인",
    accept: "봉투를 받는다",
    enter: "도시로 들어선다",
  },

  lobby: {
    work: "일터",
    alley: "뒷골목 판",
    house: "하우스",
    houseLocked: "아직 열리지 않았습니다.",
    shop: "상점",
    wallet: "지갑",
  },

  work: {
    limitReached: "{now} 일을 모두 했습니다. {reset}에 다시 채워집니다.",
    slipTitle: "임금 명세서",
    wage: "임금",
    deduction: "지배인 몫",
    received: "수령",
    liberated: "해방 구역이라 공제가 없습니다.",
  },

  gamble: {
    limitReached: "{now} 도박 횟수를 모두 썼습니다. {reset}에 다시 채워집니다.",
    betLabel: "판돈",
    open: "판을 연다",
    resume: "진행 중인 판이 있습니다.",
    sealing: "기록 중…",
  },

  wallet: {
    balance: "잔액",
    debt: "빚",
    workLeft: "남은 일",
    gambleLeft: "남은 판",
    items: "보유 물품",
    noItems: "보유한 물품이 없습니다.",
    history: "최근 기록",
  },

  skill: {
    title: "특기 결제",
    noSkills: "등록된 특기가 없습니다.",
    borrowOffer: "{amount}코인이 부족합니다. 부족분을 빌리면 빚이 {debt}코인 늘어납니다.",
    paid: "결제했습니다.",
  },

  repay: {
    title: "빚 상환",
    done: "상환했습니다.",
    cleared: "빚을 모두 갚았습니다.",
  },

  joint: {
    title: "공동 지갑",
    intro: "최종전용 공용 금고. 넣은 코인은 딜러만 꺼낼 수 있습니다.",
  },

  shop: {
    soldOut: "품절",
    limit: "구매 한도에 도달했습니다.",
    bought: "구매했습니다.",
    secret: "비밀 내용 보기",
    use: "사용",
    used: "사용됨",
  },

  fund: {
    title: "모금함",
    filled: "목표 금액을 채웠습니다.",
  },
} as const;

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : typeof value === "number" ? value.toLocaleString("ko-KR") : value;
  });
}
