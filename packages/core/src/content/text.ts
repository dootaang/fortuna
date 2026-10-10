/**
 * 앱 문구. 지배인은 손님을 맞이하는 정중한 신사의 말투를 쓴다.
 * {name} {district} {amount} 같은 자리표시자는 `fill`이 채운다.
 */
export const TEXT = {
  greeting: "행운이 함께하기를.",
  city: "종점도시 포르투나",
  manager: "지배인",
  dealer: "딜러",

  gate: {
    title: "개찰구",
    prompt: "승차권 번호를 보여 주시겠습니까?",
    hint: "딜러에게 받은 접속 코드를 입력하십시오. 기기를 바꾸셔도 같은 번호로 다시 들어오실 수 있습니다.",
    submit: "개찰구 통과",
    invalid: "그런 승차권은 이 역에 등록되어 있지 않군요. 번호를 다시 확인해 주시겠습니까?",
    revoked: "이 승차권은 효력이 다했습니다. 딜러에게 새 번호를 받아 오십시오.",
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
    envelopeLine: "봉투에는 {amount}코인이 들어 있습니다.",
    debtLine: "차용증: 상환 금액 {amount}코인",
    gateLine: "개찰구 통과 요금 {amount}코인",
    startLine: "남은 {amount}코인으로 도시 생활을 시작합니다.",
    accept: "봉투를 받는다",
    enter: "도시로 들어선다",
  },

  lobby: {
    welcomeBack: "다시 뵙게 되어 기쁩니다, {name} 님.",
    work: "일터",
    workLine: "정직한 노동에는 정직한 몫이 따르지요. 물론 제 몫도요.",
    alley: "뒷골목 판",
    alleyLine: "주민들이 몰래 여는 작은 판입니다. 저는 못 본 척하고 있지요.",
    house: "하우스",
    houseLine: "지배인의 카지노. 큰 판은 언제나 이곳에서 벌어집니다.",
    houseLocked: "아직 문을 열 때가 아니군요. 준비가 되면 정중히 모시겠습니다.",
    shop: "상점",
    shopLine: "필요한 것은 무엇이든. 값만 맞는다면요.",
    wallet: "지갑",
    walletLine: "잔액과 빚, 그리고 이번 주의 남은 기회.",
  },

  work: {
    limitReached: "이번 주 일거리는 모두 끝났습니다. 월요일 자정에 새 일감이 들어옵니다.",
    slipTitle: "임금 명세서",
    wage: "임금",
    deduction: "지배인 몫",
    received: "수령",
    liberated: "구역이 해방되어 지배인 몫이 떼이지 않았습니다.",
    deductionLine: "언제나 그렇듯, 제 몫을 먼저 챙겼습니다.",
  },

  gamble: {
    limitReached: "이번 주에는 충분히 즐기셨군요. 월요일 자정에 다시 판을 펴 드리지요.",
    betLabel: "판돈",
    open: "판을 연다",
    resume: "진행 중인 판이 있습니다. 하던 판부터 마저 하시지요.",
    win: "축하드립니다. 오늘은 행운이 손님 편이군요.",
    lose: "아쉽군요. 판돈은 제가 잘 보관하겠습니다.",
    push: "비겼습니다. 판돈은 그대로 돌려드리지요.",
    sealing: "딜러가 결정을 봉인하고 있습니다…",
  },

  wallet: {
    balance: "잔액",
    debt: "빚",
    workLeft: "남은 일",
    gambleLeft: "남은 판",
    items: "보유 물품",
    noItems: "아직 가진 것이 없군요.",
    history: "최근 기록",
  },

  skill: {
    title: "특기 결제",
    intro: "특기는 공짜가 아닙니다. 한 단계 더 끌어올릴 때마다 값이 붙지요.",
    noSkills: "등록된 특기가 없습니다. 딜러에게 문의하십시오.",
    borrowOffer: "잔액이 모자라시는군요. 부족한 {amount}코인은 제가 빌려 드리지요. 빚은 {debt}코인 늘어납니다.",
    paid: "결제되었습니다. 멋진 장면이 되기를.",
  },

  repay: {
    title: "빚 상환",
    intro: "갚으시겠다니, 성실한 손님이시군요.",
    done: "상환이 기록되었습니다.",
    cleared: "빚을 모두 갚으셨습니다. 이제 손님과 저는 대등한 사이로군요.",
  },

  joint: {
    title: "공동 지갑",
    intro: "모두의 코인을 한데 모으는 금고입니다. 한번 넣은 코인은 딜러만 꺼낼 수 있습니다.",
  },

  shop: {
    soldOut: "품절",
    limit: "구매 한도에 도달했습니다.",
    bought: "좋은 선택입니다.",
    secret: "구매하신 분께만 보이는 내용",
    use: "사용",
    used: "사용됨",
  },

  fund: {
    title: "모금함",
    filled: "목표 금액이 모두 모였습니다.",
  },
} as const;

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : typeof value === "number" ? value.toLocaleString("ko-KR") : value;
  });
}
