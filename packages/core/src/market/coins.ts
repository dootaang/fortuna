/**
 * 환전가 거래소 종목. 가격은 1/100 단위 정수(센트)로 다룬다: 1,000.00 → 100000.
 * 성격(변동성·복원력·점프)은 세계관 문서(04-districts)의 구역 설정에서 왔다. docs/SPEC-COIN-MARKET.md 2절.
 */
export const COIN_IDS = ["FTN", "WHL", "HBT", "LNH", "JWN", "S9", "ORB", "BLC", "MWL"] as const;
export type CoinId = (typeof COIN_IDS)[number];

export interface CoinDef {
  id: CoinId;
  name: string;
  /** districts/{id} this coin belongs to; null for the city index. */
  districtId: string | null;
  place: string;
  /** The city index: higher leverage cap, every alt follows it a little. */
  main: boolean;
  /** Long-run price the coin drifts back to, in cents. */
  anchor: number;
  /** Standard deviation of log returns per hour. */
  volH: number;
  /** Correlation of the coin's noise with FTN's (0..1). */
  beta: number;
  /** Share of the log gap to the anchor closed per hour. */
  revertH: number;
  /** Weight of the smoothed recent return added to the next one (중원: 강한 자가 갖는다). */
  momentum: number;
  /** Expected sudden moves per day and their size range. */
  jumpsPerDay: number;
  jumpMin: number;
  jumpMax: number;
  /** Jumps only ever go down (궤도 정거장 절약 모드). */
  jumpDownOnly: boolean;
  /** One line on the board. */
  trait: string;
  accent: string;
}

export const COINS: Readonly<Record<CoinId, CoinDef>> = {
  FTN: {
    id: "FTN", name: "포르투나 코인", districtId: null, place: "도시 전체", main: true,
    anchor: 100_000, volH: 0.010, beta: 1, revertH: 0.02, momentum: 0, jumpsPerDay: 0.3, jumpMin: 0.03, jumpMax: 0.06, jumpDownOnly: false,
    trait: "도시 지수. 모든 종목이 조금씩 따라 움직인다. 구역이 해방될 때마다 한 계단 내려앉는다.", accent: "#d4af37",
  },
  WHL: {
    id: "WHL", name: "휠 코인", districtId: "downtown", place: "휠 광장", main: false,
    anchor: 10_000, volH: 0.015, beta: 0.6, revertH: 0.04, momentum: 0, jumpsPerDay: 0.5, jumpMin: 0.03, jumpMax: 0.08, jumpDownOnly: false,
    trait: "판돈로의 열기. 도시에서 판이 많이 돌수록 오르는 경향이 있다.", accent: "#e6c76a",
  },
  HBT: {
    id: "HBT", name: "한빛 코인", districtId: "modern", place: "한빛특구", main: false,
    anchor: 25_000, volH: 0.025, beta: 0.5, revertH: 0.03, momentum: 0, jumpsPerDay: 0.6, jumpMin: 0.04, jumpMax: 0.10, jumpDownOnly: false,
    trait: "탑의 밸런스 패치가 뜨면 한 시간 동안 1.5배로 출렁인다. 매일 아침 9시 입장료가 빠진다.", accent: "#7fb7d9",
  },
  LNH: {
    id: "LNH", name: "로엔 금화", districtId: "medieval", place: "로엔하임", main: false,
    anchor: 12_000, volH: 0.018, beta: 0.4, revertH: 0.04, momentum: 0, jumpsPerDay: 0.2, jumpMin: 0.03, jumpMax: 0.06, jumpDownOnly: false,
    trait: "가장 정직한 종목. 매주 일요일 21시 임대료 납부일에 빠졌다가 하루에 걸쳐 돌아온다.", accent: "#c9a46b",
  },
  JWN: {
    id: "JWN", name: "중원 전표", districtId: "wuxia", place: "중원", main: false,
    anchor: 8_800, volH: 0.025, beta: 0.4, revertH: 0.015, momentum: 0.35, jumpsPerDay: 0.4, jumpMin: 0.04, jumpMax: 0.09, jumpDownOnly: false,
    trait: "강한 자가 갖는다. 한번 붙은 추세가 쉽게 꺾이지 않는다. 보름마다 상납금이 빠진다.", accent: "#d97a5b",
  },
  S9: {
    id: "S9", name: "S9 크레딧", districtId: "cyberpunk", place: "섹터9", main: false,
    anchor: 40_400, volH: 0.030, beta: 0.5, revertH: 0.03, momentum: 0, jumpsPerDay: 0.6, jumpMin: 0.05, jumpMax: 0.12, jumpDownOnly: false,
    trait: "일주일에 한 번, 예고 없는 약관 개정으로 계단처럼 뛰었다가 천천히 흘러내린다.", accent: "#d35fd1",
  },
  ORB: {
    id: "ORB", name: "오비탈", districtId: "scifi", place: "궤도 정거장", main: false,
    anchor: 30_000, volH: 0.008, beta: 0.3, revertH: 0.12, momentum: 0, jumpsPerDay: 0.35, jumpMin: 0.10, jumpMax: 0.15, jumpDownOnly: true,
    trait: "마더가 돌보는 가장 얌전한 종목. 드물게 절약 모드로 뚝 떨어졌다가 금방 돌아온다.", accent: "#8fd0c4",
  },
  BLC: {
    id: "BLC", name: "벨루체 장미", districtId: "romance", place: "벨루체", main: false,
    anchor: 77_700, volH: 0.020, beta: 0.4, revertH: 0.03, momentum: 0, jumpsPerDay: 0.2, jumpMin: 0.04, jumpMax: 0.08, jumpDownOnly: false,
    trait: "큰 움직임 10분 전에 부채 뒤의 귓속말이 먼저 돈다. 다만 소문은 셋 중 하나꼴로 틀린다.", accent: "#e8a0b4",
  },
  MWL: {
    id: "MWL", name: "무월 코인", districtId: "horror", place: "무월리", main: false,
    anchor: 1_300, volH: 0.010, beta: 0.2, revertH: 0.03, momentum: 0, jumpsPerDay: 0.4, jumpMin: 0.05, jumpMax: 0.12, jumpDownOnly: false,
    trait: "달 없는 밤(0~5시)에만 깨어나 네 배로 출렁인다. 그 시간의 청산은 수수료가 두 배다.", accent: "#9aa36b",
  },
};

export function isCoinId(value: unknown): value is CoinId { return typeof value === "string" && (COIN_IDS as readonly string[]).includes(value); }

/** Whether the coin's district is in a tick's liberated list (FTN has none). */
export function coinDistrictLiberated(coin: CoinId, liberated: readonly string[]): boolean {
  const district = COINS[coin].districtId;
  return district !== null && liberated.includes(district);
}

export function coinForDistrict(districtId: string): CoinId | null {
  return COIN_IDS.find((id) => COINS[id].districtId === districtId) ?? null;
}

/** "1,024.37" */
export function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Hours 0..23 in KST for an epoch time. */
export function kstHour(epochMs: number): number { return Math.floor(((epochMs + 9 * 3_600_000) % 86_400_000) / 3_600_000); }

/** 무월리의 밤: 0시 ~ 5시 KST. firestore.rules repeats this. */
export function isMoonlessNight(epochMs: number): boolean { return kstHour(epochMs) < 5; }
